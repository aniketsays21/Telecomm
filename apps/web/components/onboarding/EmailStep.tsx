'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { connectEmailAction } from '@/lib/actions';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
    >
      {pending ? 'Saving…' : 'Connect & continue'}
    </button>
  );
}

type Props = {
  inboundEmail: string;
  onDone: (inboundEmail: string) => void;
};

export function EmailStep({ inboundEmail, onDone }: Props) {
  const [state, formAction] = useActionState(connectEmailAction, undefined);
  const [confirmed, setConfirmed] = useState(false);

  // If server returned success, show forwarding instructions
  if (state && 'success' in state && state.inboundEmail) {
    // Capture the narrowed value into a local const — inside the closures
    // below TypeScript drops the narrowing on `state.inboundEmail` and
    // widens it back to `string | undefined`.
    const connectedInbound: string = state.inboundEmail;
    return (
      <div className="p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-green-600 text-lg">✓</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Email connected</h2>
            <p className="text-sm text-gray-500 mt-0.5">Now set up forwarding in your email provider.</p>
          </div>
        </div>

        <div className="bg-indigo-50 rounded-xl p-5 mb-6">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-2">Your Telecomm inbound address</p>
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono text-indigo-900 bg-white px-3 py-1.5 rounded-lg border border-indigo-100 flex-1">
              {connectedInbound}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(connectedInbound)}
              className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              Copy
            </button>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <p className="text-sm font-medium text-gray-700">What to do next:</p>
          <ol className="space-y-2 text-sm text-gray-600 list-none">
            {[
              `Go to your email provider (Gmail, Outlook, etc.)`,
              `Set up forwarding from your support address to the Telecomm address above`,
              `Or set the Telecomm address as the reply-to on your support email`,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 bg-gray-100 text-gray-500 rounded-full text-xs flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600"
            />
            <span className="text-sm text-gray-700">I've set up forwarding</span>
          </label>
          <button
            disabled={!confirmed}
            onClick={() => onDone(connectedInbound)}
            className="ml-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
          <span className="text-blue-600 text-lg">✉</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Connect your support email</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Customer emails will arrive as tickets in your inbox. You'll forward them to a Telecomm address.
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Your support email address
          </label>
          <input
            name="supportEmail"
            type="email"
            required
            placeholder="support@yourbrand.com"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            The address customers email. We'll tell you where to forward it.
          </p>
        </div>

        {state && 'error' in state && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{state.error}</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-400">
            Already using {inboundEmail}?{' '}
            <button type="button" onClick={() => onDone(inboundEmail)} className="text-indigo-500 hover:underline">
              Skip
            </button>
          </p>
          <SubmitBtn />
        </div>
      </form>
    </div>
  );
}
