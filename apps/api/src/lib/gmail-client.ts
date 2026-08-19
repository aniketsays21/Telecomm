/**
 * Thin fetch-based wrapper around the Gmail REST API. Kept intentionally small
 * — we only touch the endpoints the shared inbox needs. Avoids pulling in the
 * `googleapis` SDK which is a huge tree of classes for other Google products.
 *
 * All calls take a raw access token; refresh handling lives in `gmail-oauth`.
 */

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function req<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // Try to surface Google's structured error verbatim — it's the most
    // actionable thing when a scope / quota / auth problem surfaces.
    throw new GmailApiError(res.status, text);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export class GmailApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Gmail API ${status}: ${body}`);
  }
}

export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

export function getProfile(token: string): Promise<GmailProfile> {
  return req<GmailProfile>(token, '/profile');
}

export type GmailHeader = { name: string; value: string };
export type GmailPayloadPart = {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPayloadPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
  sizeEstimate?: number;
};

export function getMessage(token: string, id: string, format = 'full'): Promise<GmailMessage> {
  return req<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=${format}`);
}

export type GmailThread = {
  id: string;
  historyId?: string;
  messages: GmailMessage[];
};

export function getThread(token: string, id: string, format = 'full'): Promise<GmailThread> {
  return req<GmailThread>(token, `/threads/${encodeURIComponent(id)}?format=${format}`);
}

// ---- History-based sync -----------------------------------------------------
export type GmailHistoryMessageAdded = { message: { id: string; threadId: string; labelIds?: string[] } };
export type GmailHistoryEntry = {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: GmailHistoryMessageAdded[];
};
export type GmailHistoryResponse = {
  history?: GmailHistoryEntry[];
  nextPageToken?: string;
  historyId: string;
};

/**
 * Fetch every change since `startHistoryId`. Filter to messagesAdded and
 * labelId=INBOX so we only see freshly-delivered mail, not our own sent items
 * or drafts. `startHistoryId` older than ~7 days will 404 (Gmail's window);
 * caller handles that by re-seeding via messages.list.
 */
export async function listHistory(
  token: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<GmailHistoryResponse> {
  const params = new URLSearchParams({
    startHistoryId,
    labelId: 'INBOX',
    historyTypes: 'messageAdded',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return req<GmailHistoryResponse>(token, `/history?${params.toString()}`);
}

export type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

/**
 * Fallback when we don't have a valid startHistoryId (fresh connect, or
 * historyId aged out of Gmail's 7-day window). `q` is a Gmail search query.
 */
export async function listMessages(
  token: string,
  q: string,
  maxResults = 25,
): Promise<GmailListResponse> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) });
  return req<GmailListResponse>(token, `/messages?${params.toString()}`);
}

// ---- Sending ----------------------------------------------------------------
export type GmailSendInput = {
  to: string;
  from?: string; // omitted → Gmail uses the account owner's address
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

/**
 * Build an RFC 822 message and base64url-encode it, per Gmail's
 * `messages.send` contract.
 */
function buildRaw(input: GmailSendInput): string {
  const boundary = 'tc' + Math.random().toString(36).slice(2, 12);
  const headers: string[] = [
    `To: ${input.to}`,
    input.from ? `From: ${input.from}` : '',
    `Subject: ${encodeSubject(input.subject)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (input.inReplyTo) headers.push(`In-Reply-To: <${input.inReplyTo}>`);
  if (input.references) headers.push(`References: ${input.references.split(/\s+/).map((r) => `<${r}>`).join(' ')}`);

  let body: string;
  if (input.bodyHtml) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.bodyText,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.bodyHtml,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: 7bit');
    body = `\r\n${input.bodyText}`;
  }

  const raw = headers.join('\r\n') + '\r\n' + body;
  // Gmail expects URL-safe base64: `+` → `-`, `/` → `_`, strip `=`.
  return Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2047 encode non-ASCII subjects so recipients see them correctly.
function encodeSubject(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

export async function sendMessage(token: string, input: GmailSendInput): Promise<GmailMessage> {
  const raw = buildRaw(input);
  const payload: Record<string, unknown> = { raw };
  if (input.threadId) payload.threadId = input.threadId;
  return req<GmailMessage>(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---- Header helpers ---------------------------------------------------------
export function headerValue(msg: GmailMessage, name: string): string | undefined {
  const target = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === target)?.value;
}

function decodeB64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Walk the MIME tree, returning the first text/plain and text/html bodies we
 * find. Attachments (bodies without inline text) are skipped for now.
 */
export function extractBody(msg: GmailMessage): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;

  function walk(part: GmailPayloadPart | undefined): void {
    if (!part) return;
    const mime = part.mimeType.toLowerCase();
    if (part.body?.data) {
      const decoded = decodeB64Url(part.body.data);
      if (mime === 'text/plain' && text == null) text = decoded;
      else if (mime === 'text/html' && html == null) html = decoded;
    }
    for (const child of part.parts ?? []) walk(child);
  }

  walk(msg.payload);
  return { text, html };
}
