'use client';

import { useState, useTransition } from 'react';
import type { GmailAccount } from '@/lib/api';
import { gmailStartOAuthAction, gmailDisconnectAction } from '@/lib/actions';

type Props = {
  initial: { connected: boolean; account: GmailAccount | null; redirectUri: string };
};

function CopyableUri({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
          Redirect URI to register in Google Cloud Console
        </p>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(uri);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-xs px-2 py-0.5 border border-gray-200 rounded bg-white hover:bg-gray-50"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="text-xs text-gray-800 break-all font-mono">{uri}</code>
      <p className="text-[11px] text-gray-500 mt-2">
        Google Cloud Console → APIs &amp; Services → Credentials → your OAuth Client →
        Authorized redirect URIs. It must match this exactly, or you&apos;ll see
        &quot;Access blocked: redirect_uri_mismatch&quot;.
      </p>
    </div>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleString();
}

export function GmailConnectPanel({ initial }: Props) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function connect() {
    setError(null);
    startTransition(async () => {
      const res = await gmailStartOAuthAction();
      if ('url' in res && res.url) {
        window.location.href = res.url;
      } else if ('error' in res) {
        setError(res.error ?? 'Could not start OAuth');
      }
    });
  }

  function disconnect() {
    if (!confirm('Disconnect Gmail? Existing conversations will stay, but no new emails will be pulled and agents will not be able to reply from the dashboard.')) return;
    setError(null);
    startTransition(async () => {
      const res = await gmailDisconnectAction();
      if ('error' in res && res.error) setError(res.error);
      else setState((s) => ({ connected: false, account: null, redirectUri: s.redirectUri }));
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Support mailbox</h2>
          {state.connected && state.account ? (
            <>
              <p className="text-sm text-gray-700">
                Connected as <span className="font-medium">{state.account.emailAddress}</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Last synced {relTime(state.account.lastPolledAt)} · Connected {relTime(state.account.connectedAt)}
              </p>
              {state.account.lastError && (
                <p className="text-xs text-rose-600 mt-2 break-all">
                  Last error: {state.account.lastError}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">
              Grant access to a Gmail account. Only emails matching your subject rules become conversations — everything else is ignored.
            </p>
          )}
        </div>
        <div className="shrink-0">
          {state.connected ? (
            <button
              onClick={disconnect}
              disabled={isPending}
              className="text-sm px-4 py-2 border border-rose-200 text-rose-700 rounded hover:bg-rose-50 disabled:opacity-60"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={isPending}
              className="text-sm px-4 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {isPending ? 'Opening Google…' : 'Connect Gmail'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-xs text-rose-600">{error}</p>
      )}
      {!state.connected && <CopyableUri uri={state.redirectUri} />}
    </div>
  );
}
