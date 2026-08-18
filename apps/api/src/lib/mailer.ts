import nodemailer from 'nodemailer';

// Transporter is lazily created and reused
let _transport: nodemailer.Transporter | null = null;

function getTransport() {
  if (_transport) return _transport;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Dev: use Ethereal (fake SMTP — emails are captured, not sent)
    _transport = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: 'dev@ethereal.email', pass: 'dev' },
    });
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
  const transport = getTransport();

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

  return info;
}

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
