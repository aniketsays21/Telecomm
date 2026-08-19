'use client';

import { useState } from 'react';

type Props = {
  webhookUrl: string;
  workspaceId: string;
};

export function EmailSettings({ webhookUrl }: Props) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      {/* Webhook URL */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-medium text-gray-800">Inbound Webhook URL</h2>
          <p className="text-sm text-gray-500 mt-1">
            Point your email provider&apos;s inbound webhook to this URL. Every email sent to your
            support address will become a conversation in the inbox.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700 font-mono break-all">
            {webhookUrl}
          </code>
          <button
            onClick={copy}
            className="shrink-0 px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
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
            'Set "Inbound webhook URL" to the URL above',
            'Set your inbound email address (e.g. support@yourapp.com) in Postmark',
            'Forward or MX-route that address to Postmark\'s inbound domain',
          ]}
          testCurl={`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "From": "customer@example.com",
    "FromName": "Alice",
    "Subject": "Need help with billing",
    "TextBody": "Hi, I have a question about my invoice.",
    "MessageID": "<test-001@example.com>"
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
    "subject": "Shipping question",
    "text": "Where is my order?",
    "messageId": "<test-002@mailgun.net>"
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
    "subject": "Account access issue",
    "text": "I cannot log in to my account.",
    "messageId": "<test-003@sendgrid.net>"
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
