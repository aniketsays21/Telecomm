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
