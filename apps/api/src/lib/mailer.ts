import { randomUUID } from 'crypto';
import nodemailer from 'nodemailer';
import { publicApiUrl } from './urls.js';

// SMTP credentials are PLATFORM-level and shared by every workspace: one relay,
// one set of credentials, one sending infrastructure. What is per-workspace is
// the `From` address — each brand sends under its own verified sender signature
// on that shared relay. Never derive a brand's sender from SMTP_FROM.

// Transporter is lazily created and reused
let _transport: nodemailer.Transporter | null = null;
let _isEthereal = false;
// Sender for the dev/Ethereal transport, captured when the test account is made.
// Only used as a last-resort fallback so local dev works with no SMTP config.
let _etherealFrom: string | null = null;

async function getTransport() {
  if (_transport) return _transport;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Dev: create a real Ethereal test account — emails are captured, not sent
    const testAccount = await nodemailer.createTestAccount();
    _transport = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    _isEthereal = true;
    _etherealFrom = testAccount.user;
    console.log('[mailer] Using Ethereal (dev) — emails will not be delivered');
    return _transport;
  }

  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return _transport;
}

/**
 * Platform-level sender, used only for mail that belongs to no workspace.
 * Workspace mail must pass an explicit `from` — see `resolveWorkspaceSender`.
 */
function platformFrom(): string {
  const configured = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (configured) return configured;
  if (_etherealFrom) return _etherealFrom;
  throw new Error(
    '[mailer] No sender address available. Set the workspace smtpFromAddress, ' +
      'or configure SMTP_FROM for platform-level mail.',
  );
}

/** Format an address as `"Display Name" <addr@example.com>` when a name is given. */
function formatAddress(address: string, name?: string): string {
  if (!name) return address;
  return `${JSON.stringify(name)} <${address}>`;
}

/**
 * Strip the angle brackets from a Message-ID so header values and provider
 * payloads compare equal. Postmark's `MessageID` field arrives bare while the
 * raw `Message-ID`/`In-Reply-To` headers are bracketed; we store bare
 * everywhere and re-add brackets only when writing headers.
 */
export function normalizeMessageId(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const trimmed = id.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  return trimmed || undefined;
}

/** Wrap a bare Message-ID in angle brackets for use in an email header. */
export function bracketMessageId(id: string | null | undefined): string | undefined {
  const bare = normalizeMessageId(id);
  return bare ? `<${bare}>` : undefined;
}

/**
 * Generate the Message-ID for an outbound email BEFORE sending it, so the value
 * can be persisted on the message row in the same transaction that creates it.
 * When the customer replies, their In-Reply-To points at this ID and the inbound
 * handler resolves the existing conversation from it.
 */
export function buildOutboundMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1]?.trim() || 'telecomm.local';
  return `${randomUUID()}@${domain}`;
}

export interface MailOptions {
  to: string;
  /**
   * Workspace sender address. Required for any mail sent on behalf of a brand;
   * omit only for genuinely platform-level mail, which falls back to SMTP_FROM.
   */
  from?: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  /** Bare or bracketed Message-ID; brackets are normalised before sending. */
  messageId?: string;
}

export async function sendMail(opts: MailOptions) {
  // Create the transport first so the Ethereal fallback sender is available.
  const transport = await getTransport();
  const fromAddress = opts.from ?? platformFrom();

  const info = await transport.sendMail({
    from: formatAddress(fromAddress, opts.fromName),
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, '<br>'),
    inReplyTo: bracketMessageId(opts.inReplyTo),
    references: opts.references
      ? opts.references
          .split(/\s+/)
          .map((r) => bracketMessageId(r))
          .filter(Boolean)
          .join(' ')
      : undefined,
    messageId: bracketMessageId(opts.messageId),
  });

  if (_isEthereal) {
    console.log('[mailer] Preview URL:', nodemailer.getTestMessageUrl(info));
  }

  return info;
}

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendCsatRequest(opts: {
  to: string;
  conversationId: string;
  subject: string;
  /** Workspace sender — CSAT must reach the customer under the brand's address. */
  from?: string;
  fromName?: string;
  messageId?: string;
}) {
  const base = `${publicApiUrl()}/csat/${opts.conversationId}/rate?rating=`;

  const stars = [1, 2, 3, 4, 5];
  const labels = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'];
  const starChar = ['★', '★★', '★★★', '★★★★', '★★★★★'];

  const textBody = [
    `How was your recent support experience regarding: "${opts.subject}"?`,
    '',
    'Click a rating below:',
    ...stars.map((n, i) => `  ${starChar[i]} ${labels[i]}: ${base}${n}`),
    '',
    'Your feedback helps us improve.',
  ].join('\n');

  const htmlLinks = stars
    .map(
      (n, i) =>
        `<a href="${base}${n}" style="display:inline-block;margin:0 6px;padding:10px 18px;background:#f3f4f6;border-radius:8px;text-decoration:none;color:#111827;font-size:14px;font-weight:600;">${starChar[i]}<br><span style="font-size:11px;color:#6b7280;">${labels[i]}</span></a>`,
    )
    .join('');

  const htmlBody = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#111827;">
  <p style="font-size:16px;margin:0 0 8px;">How was your recent support experience?</p>
  <p style="font-size:13px;color:#6b7280;margin:0 0 24px;">${opts.subject}</p>
  <div style="text-align:center;margin-bottom:24px;">${htmlLinks}</div>
  <p style="font-size:12px;color:#9ca3af;margin:0;">Your feedback helps us improve our support.</p>
</div>`;

  return sendMail({
    to: opts.to,
    from: opts.from,
    fromName: opts.fromName,
    subject: `How did we do? — ${opts.subject}`,
    text: textBody,
    html: htmlBody,
    messageId: opts.messageId,
  });
}
