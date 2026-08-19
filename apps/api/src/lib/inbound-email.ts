import { normalizeMessageId } from './mailer.js';

/**
 * Provider-agnostic parsing for inbound email webhooks.
 *
 * Everything here is pure so it can be unit-tested without a database or a
 * live provider. Postmark is the primary shape; Mailgun/SendGrid/plain JSON
 * field names are accepted as fallbacks.
 */

export type RawInbound = Record<string, any>;

export type PostmarkHeader = { Name?: string; Value?: string };

/** Lower-cased header name → value, from Postmark's `Headers: [{Name, Value}]`. */
export type HeaderMap = Map<string, string>;

export function parseHeaders(raw: RawInbound): HeaderMap {
  const map: HeaderMap = new Map();
  const list: PostmarkHeader[] = Array.isArray(raw?.Headers) ? raw.Headers : [];
  for (const h of list) {
    if (!h || typeof h.Name !== 'string') continue;
    // Keep the first occurrence; later duplicates (e.g. Received) do not matter here.
    const key = h.Name.toLowerCase();
    if (!map.has(key)) map.set(key, typeof h.Value === 'string' ? h.Value : '');
  }
  return map;
}

export function headerValue(headers: HeaderMap, name: string): string | undefined {
  const v = headers.get(name.toLowerCase());
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Split an address list on commas that are not inside quotes or angle brackets,
 * so `"Doe, Jane" <jane@x.com>, bob@y.com` yields two entries.
 */
function splitAddressList(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<' && !inQuotes) inAngle = true;
    else if (ch === '>' && !inQuotes) inAngle = false;
    if (ch === ',' && !inQuotes && !inAngle) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Reduce `"Support Team" <Help@Example.COM>` to `help@example.com`.
 * Returns undefined when the input holds no plausible address.
 */
export function normalizeAddress(input: string | null | undefined): string | undefined {
  if (!input || typeof input !== 'string') return undefined;
  let value = input.trim();
  const angle = value.match(/<([^>]*)>/);
  if (angle) value = angle[1];
  value = value.trim().replace(/^["']|["']$/g, '').trim();
  if (!value.includes('@')) return undefined;
  // Reject anything with internal whitespace left over — not a bare address.
  if (/\s/.test(value)) return undefined;
  return value.toLowerCase();
}

/**
 * Drop a plus-tag: `help+order123@brand.com` → `help@brand.com`. Used as an
 * additional routing candidate so sub-addressed mail still finds its workspace.
 */
export function stripPlusTag(address: string): string | undefined {
  const [local, domain] = address.split('@');
  if (!local || !domain) return undefined;
  const plus = local.indexOf('+');
  if (plus === -1) return undefined;
  const base = local.slice(0, plus);
  if (!base) return undefined;
  return `${base}@${domain}`;
}

function pushAddress(out: string[], seen: Set<string>, value: string | undefined) {
  const addr = normalizeAddress(value);
  if (!addr || seen.has(addr)) return;
  seen.add(addr);
  out.push(addr);
  const stripped = stripPlusTag(addr);
  if (stripped && !seen.has(stripped)) {
    seen.add(stripped);
    out.push(stripped);
  }
}

/**
 * All addresses this email could have been delivered to, most authoritative
 * first. The owning workspace is whichever of these matches a configured
 * support address.
 *
 * Order matters because both routes are real:
 *  - MX-routed directly to Postmark → `OriginalRecipient` is the true address.
 *  - Forwarded from the brand's mailbox → `OriginalRecipient` is Postmark's own
 *    inbound address and the brand address survives only in `To`/`Delivered-To`.
 */
export function extractRecipients(raw: RawInbound, headers?: HeaderMap): string[] {
  const hdrs = headers ?? parseHeaders(raw);
  const out: string[] = [];
  const seen = new Set<string>();

  pushAddress(out, seen, raw?.OriginalRecipient ?? raw?.originalRecipient);
  pushAddress(out, seen, headerValue(hdrs, 'Delivered-To'));
  pushAddress(out, seen, headerValue(hdrs, 'X-Original-To'));
  pushAddress(out, seen, headerValue(hdrs, 'X-Forwarded-To'));

  for (const entry of Array.isArray(raw?.ToFull) ? raw.ToFull : []) {
    pushAddress(out, seen, entry?.Email);
  }
  for (const value of splitAddressList(String(raw?.To ?? raw?.to ?? ''))) {
    pushAddress(out, seen, value);
  }
  for (const entry of Array.isArray(raw?.CcFull) ? raw.CcFull : []) {
    pushAddress(out, seen, entry?.Email);
  }
  for (const value of splitAddressList(String(raw?.Cc ?? raw?.cc ?? ''))) {
    pushAddress(out, seen, value);
  }
  for (const entry of Array.isArray(raw?.BccFull) ? raw.BccFull : []) {
    pushAddress(out, seen, entry?.Email);
  }

  return out;
}

/** Sender address, normalised. */
export function extractFrom(raw: RawInbound): string | undefined {
  const full = raw?.FromFull?.Email ?? raw?.fromFull?.Email;
  return normalizeAddress(full) ?? normalizeAddress(raw?.From ?? raw?.from ?? raw?.sender);
}

export function extractFromName(raw: RawInbound): string {
  const full = raw?.FromFull?.Name;
  const value = full ?? raw?.FromName ?? raw?.fromName ?? '';
  return typeof value === 'string' ? value.trim() : '';
}

/** Message-ID of the inbound email, bare (no angle brackets). */
export function extractMessageId(raw: RawInbound, headers?: HeaderMap): string | undefined {
  const hdrs = headers ?? parseHeaders(raw);
  return normalizeMessageId(
    raw?.MessageID ??
      raw?.messageId ??
      raw?.['Message-ID'] ??
      raw?.['message-id'] ??
      headerValue(hdrs, 'Message-ID'),
  );
}

/** In-Reply-To of the inbound email, bare. */
export function extractInReplyTo(raw: RawInbound, headers?: HeaderMap): string | undefined {
  const hdrs = headers ?? parseHeaders(raw);
  return normalizeMessageId(
    raw?.InReplyTo ??
      raw?.inReplyTo ??
      raw?.['In-Reply-To'] ??
      raw?.['in-reply-to'] ??
      headerValue(hdrs, 'In-Reply-To'),
  );
}

/** References chain, oldest first, bare ids. */
export function extractReferences(raw: RawInbound, headers?: HeaderMap): string[] {
  const hdrs = headers ?? parseHeaders(raw);
  const value =
    raw?.References ?? raw?.references ?? headerValue(hdrs, 'References') ?? '';
  if (typeof value !== 'string' || !value.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(/\s+/)) {
    const id = normalizeMessageId(part);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Candidate Message-IDs this email is a reply to, most specific first.
 * In-Reply-To names the direct parent; References walks back up the thread,
 * so the last entry is the nearest ancestor after the direct parent.
 */
export function threadCandidates(raw: RawInbound, headers?: HeaderMap): string[] {
  const hdrs = headers ?? parseHeaders(raw);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  add(extractInReplyTo(raw, hdrs));
  for (const ref of extractReferences(raw, hdrs).reverse()) add(ref);
  return out;
}

const AUTOMATED_LOCAL_PARTS = new Set([
  'mailer-daemon',
  'postmaster',
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'bounce',
  'bounces',
  'notifications',
  'notification',
]);

const BULK_PRECEDENCE = new Set(['bulk', 'list', 'junk', 'auto_reply', 'auto-reply']);

export type AutomationCheck = { automated: boolean; reason?: string };

/**
 * Detect mail we must never auto-reply to. Replying to an autoresponder or a
 * mailing list creates a mail loop that burns the shared sending reputation of
 * every workspace on the platform.
 *
 * Follows RFC 3834 (Auto-Submitted), the de-facto Precedence convention, and
 * RFC 2369 list headers, plus common vendor headers.
 */
export function detectAutomated(raw: RawInbound, headers?: HeaderMap): AutomationCheck {
  const hdrs = headers ?? parseHeaders(raw);

  // RFC 3834: anything other than "no" marks an automatically generated message.
  const autoSubmitted = headerValue(hdrs, 'Auto-Submitted');
  if (autoSubmitted && autoSubmitted.split(';')[0].trim().toLowerCase() !== 'no') {
    return { automated: true, reason: `Auto-Submitted: ${autoSubmitted}` };
  }

  const precedence = headerValue(hdrs, 'Precedence');
  if (precedence && BULK_PRECEDENCE.has(precedence.toLowerCase())) {
    return { automated: true, reason: `Precedence: ${precedence}` };
  }

  // Sender explicitly asking us not to auto-respond.
  const suppress = headerValue(hdrs, 'X-Auto-Response-Suppress');
  if (suppress) return { automated: true, reason: `X-Auto-Response-Suppress: ${suppress}` };

  for (const listHeader of ['List-Id', 'List-Unsubscribe', 'List-Help', 'List-Post']) {
    const value = headerValue(hdrs, listHeader);
    if (value) return { automated: true, reason: `${listHeader} present` };
  }

  for (const vendorHeader of ['X-Autoreply', 'X-Autorespond', 'X-Autoresponder', 'X-Mailer-Daemon']) {
    if (headerValue(hdrs, vendorHeader)) {
      return { automated: true, reason: `${vendorHeader} present` };
    }
  }

  // A null Return-Path marks a bounce or other notification message.
  const returnPath = headerValue(hdrs, 'Return-Path');
  if (returnPath === '<>') return { automated: true, reason: 'Null Return-Path (bounce)' };

  const from = extractFrom(raw);
  if (from) {
    const local = from.split('@')[0];
    const base = local.split('+')[0];
    if (AUTOMATED_LOCAL_PARTS.has(base)) {
      return { automated: true, reason: `Automated sender: ${from}` };
    }
  }

  return { automated: false };
}

/** Plain-text body, falling back across provider field names. */
export function extractText(raw: RawInbound): string {
  const value =
    raw?.TextBody ?? raw?.StrippedTextReply ?? raw?.text ?? raw?.['body-plain'] ?? raw?.body ?? '';
  return typeof value === 'string' ? value.trim() : '';
}

export function extractHtml(raw: RawInbound): string | undefined {
  const value = raw?.HtmlBody ?? raw?.html ?? raw?.['body-html'];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function extractSubject(raw: RawInbound): string {
  const value = raw?.Subject ?? raw?.subject ?? '';
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || '(no subject)';
}

/** Strip any number of leading Re:/Fwd: prefixes for clean subject storage. */
export function cleanSubject(subject: string): string {
  return subject.replace(/^((re|fwd|fw)\s*:\s*)+/i, '').trim() || '(no subject)';
}

/** Build the References header for our reply: the inbound chain plus its own id. */
export function buildReferences(existing: string[], parentId?: string): string | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...existing, parentId]) {
    const bare = normalizeMessageId(id ?? undefined);
    if (bare && !seen.has(bare)) {
      seen.add(bare);
      out.push(bare);
    }
  }
  return out.length ? out.join(' ') : undefined;
}
