import nodemailer from 'nodemailer';

// Transporter is lazily created and reused
let _transport: nodemailer.Transporter | null = null;
let _isEthereal = false;

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

export interface MailOptions {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
}

export async function sendMail(opts: MailOptions) {
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'support@telecomm.app';
  const transport = await getTransport();

  const info = await transport.sendMail({
    from,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, '<br>'),
    inReplyTo: opts.inReplyTo,
    references: opts.references,
    messageId: opts.messageId,
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
}) {
  const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const base = `${apiUrl}/csat/${opts.conversationId}/rate?rating=`;

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
    subject: `How did we do? — ${opts.subject}`,
    text: textBody,
    html: htmlBody,
  });
}
