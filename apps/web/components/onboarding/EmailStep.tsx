'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { gmailStartOAuthAction } from '@/lib/actions';

type Props = {
  onDone: () => void;
  initiallyConnectedAs?: string | null;
};

/**
 * Gmail OAuth is the only supported email integration now — Postmark forwarding
 * was retired to remove the confusing "forward mail to this address" step.
 * Admins click Connect Gmail → Google → land back here with `?connected=1`.
 */
export function EmailStep({ onDone, initiallyConnectedAs = null }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [connectedAs, setConnectedAs] = useState<string | null>(initiallyConnectedAs);
  const params = useSearchParams();

  // If Gmail OAuth just completed, the callback bounces us to
  // /settings/gmail?connected=1 — but for onboarding we bounce here instead.
  useEffect(() => {
    if (params?.get('connected') === '1' && !connectedAs) {
      // We don't know the mailbox address without another API call; the
      // parent page passed it via `initiallyConnectedAs` on a fresh load,
      // but on the same-tab OAuth return the parent didn't get a chance to
      // re-render with fresh data. Show a generic "connected" state.
      setConnectedAs('your Gmail account');
    }
  }, [params, connectedAs]);

  function connectGmail() {
    setError(null);
    startTransition(async () => {
      const res = await gmailStartOAuthAction();
      if ('url' in res && res.url) {
        window.location.href = res.url;
      } else if ('error' in res) {
        setError(res.error ?? 'Could not start Gmail OAuth');
      }
    });
  }

  if (connectedAs) {
    return (
      <div className="p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-green-600 text-lg">✓</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Gmail connected</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Emails from{' '}
              <span className="font-medium text-gray-800">{connectedAs}</span>
              {' '}will appear in your inbox based on the routing rules you set later.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end">
          <button
            onClick={onDone}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
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
          <h2 className="text-lg font-semibold text-gray-900">Connect your support Gmail</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Sign in with the Gmail account customers write to. Only emails matching
            your rules become conversations — everything else stays in Gmail.
          </p>
        </div>
      </div>

      <ul className="text-sm text-gray-600 space-y-2 mb-6 list-none">
        {[
          'Google prompts for permission — you approve the exact mailbox.',
          'We only read messages matching subject rules you configure.',
          'Agents reply from the dashboard; replies send from your Gmail address.',
        ].map((line, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="w-5 h-5 bg-gray-100 text-gray-500 rounded-full text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-gray-400">
          You can skip this and connect later from Settings → Gmail.
        </p>
        <button
          type="button"
          onClick={connectGmail}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? 'Opening Google…' : 'Connect Gmail'}
        </button>
      </div>
    </div>
  );
}
