'use client';

import { useState } from 'react';

type Props = {
  webhookUrl: string;
  testWebhookUrl: string;
  workspaceId: string;
  supportEmail: string | null;
  smtpFromAddress: string | null;
};

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700 font-mono break-all">
        {value}
      </code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="shrink-0 px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export function EmailSettings({
  webhookUrl,
  testWebhookUrl,
  supportEmail,
  smtpFromAddress,
}: Props) {
  const sender = smtpFromAddress ?? supportEmail;

  return (
    <div className="space-y-8">
      {/* Sending identity */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-medium text-gray-800">Your sending address</h2>
          <p className="text-sm text-gray-500 mt-1">
            Replies, AI answers and CSAT emails all go out from this address — not from a shared
            platform address. It must be a verified sender signature in Postmark.
          </p>
        </div>
        {sender ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              Active
            </span>
            <code className="font-mono text-gray-800">{sender}</code>
          </div>
        ) : (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No sending address configured — email currently goes out from the platform default.
            Set your support address in onboarding, or PATCH{' '}
            <code className="font-mono">settings.smtpFromAddress</code> on this workspace.
          </p>
        )}
        {supportEmail && (
          <p className="text-xs text-gray-500">
            Inbound mail addressed to <code className="font-mono">{supportEmail}</code> is routed to
            this workspace.
          </p>
        )}
      </section>

      {/* Webhook URL */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-medium text-gray-800">Inbound Webhook URL</h2>
          <p className="text-sm text-gray-500 mt-1">
            One webhook serves every workspace. Mail is routed to yours by its recipient address,
            so there is nothing workspace-specific in this URL.
          </p>
        </div>
        <CopyRow value={webhookUrl} />
        <p className="text-xs text-gray-500">
          Postmark authenticates with Basic credentials in the URL —{' '}
          <code className="font-mono">https://user:pass@host/inbound/email</code> — matching{' '}
          <code className="font-mono">POSTMARK_WEBHOOK_USER</code>/
          <code className="font-mono">POSTMARK_WEBHOOK_PASS</code> on the API. In production,
          unauthenticated requests are rejected.
        </p>
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer text-indigo-600 hover:underline">
            Testing URL (pins this workspace explicitly)
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              Use this only to exercise the pipeline before your support address is forwarded to
              Postmark. It bypasses recipient routing.
            </p>
            <CopyRow value={testWebhookUrl} />
          </div>
        </details>
      </section>

      {/* Provider instructions */}
      <section className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        <div className="px-6 py-4">
          <h2 className="text-base font-medium text-gray-800">Setup Instructions</h2>
          <p className="text-sm text-gray-500 mt-1">Choose your email provider below.</p>
        </div>

        <ProviderCard
          name="Postmark"
          badge="Recommended"
          steps={[
            'In Postmark → Servers → your server → Settings → Inbound',
            'Set "Inbound webhook URL" to the URL above, with Basic credentials embedded: https://user:pass@host/inbound/email',
            'Add your support address as a verified Sender Signature so replies send from it',
            'Forward your support address to the Postmark inbound address (POSTMARK_INBOUND_ADDRESS), or MX-route it to Postmark',
          ]}
          testCurl={`curl -X POST "${webhookUrl}" \\
  -u "$POSTMARK_WEBHOOK_USER:$POSTMARK_WEBHOOK_PASS" \\
  -H "Content-Type: application/json" \\
  -d '{
    "From": "customer@example.com",
    "FromName": "Alice",
    "To": "${supportEmail ?? 'support@yourbrand.com'}",
    "Subject": "Need help with billing",
    "TextBody": "Hi, I have a question about my invoice.",
    "MessageID": "test-001@example.com"
  }'`}
        />

        <ProviderCard
          name="Mailgun"
          steps={[
            'In Mailgun → Receiving → Create Route',
            'Filter expression: match_recipient("support@yourdomain.com")',
            'Actions: forward to the webhook URL above',
            'Mailgun POSTs fields: From, Subject, body-plain, Message-Id, In-Reply-To',
          ]}
          testCurl={`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "customer@example.com",
    "fromName": "Bob",
    "to": "${supportEmail ?? 'support@yourbrand.com'}",
    "subject": "Shipping question",
    "text": "Where is my order?",
    "messageId": "test-002@mailgun.net"
  }'`}
        />

        <ProviderCard
          name="SendGrid Inbound Parse"
          steps={[
            'In SendGrid → Settings → Inbound Parse → Add Host & URL',
            'Set the POST URL to the webhook URL above',
            'MX-route your support domain to mx.sendgrid.net',
            'SendGrid POSTs multipart/form-data — use a proxy to convert to JSON if needed',
          ]}
          testCurl={`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "customer@example.com",
    "to": "${supportEmail ?? 'support@yourbrand.com'}",
    "subject": "Account access issue",
    "text": "I cannot log in to my account.",
    "messageId": "test-003@sendgrid.net"
  }'`}
        />

        <ProviderCard
          name="Cloudflare Email Routing + Workers"
          steps={[
            'Enable Cloudflare Email Routing for your domain',
            'Create a catch-all rule → send to an Email Worker',
            'In the Worker, parse the email and POST JSON to this webhook URL',
            'Use the email-forwarding Worker template from Cloudflare docs',
          ]}
        />
      </section>

      {/* Local dev instructions */}
      <section className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h2 className="text-sm font-medium text-amber-800 mb-2">Local development</h2>
        <p className="text-sm text-amber-700 mb-3">
          No SMTP config needed. When <code className="font-mono bg-amber-100 px-1 rounded">SMTP_HOST</code> is
          not set, the API uses Ethereal (a fake inbox). After sending, check the API terminal for a preview URL like:
        </p>
        <code className="block text-xs font-mono bg-amber-100 text-amber-900 rounded-lg px-3 py-2">
          [mailer] Preview URL: https://ethereal.email/message/abc123...
        </code>
      </section>
    </div>
  );
}

function ProviderCard({
  name,
  badge,
  steps,
  testCurl,
}: {
  name: string;
  badge?: string;
  steps: string[];
  testCurl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);

  return (
    <div className="px-6 py-4 space-y-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{name}</span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
              {badge}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3 pl-1">
          <ol className="space-y-1.5 text-sm text-gray-600 list-decimal list-inside">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {testCurl && (
            <div>
              <button
                onClick={() => setCurlOpen(!curlOpen)}
                className="text-xs text-indigo-600 hover:underline"
              >
                {curlOpen ? 'Hide' : 'Show'} test curl command
              </button>
              {curlOpen && (
                <pre className="mt-2 text-xs bg-gray-900 text-green-400 rounded-lg px-4 py-3 overflow-x-auto">
                  {testCurl}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
