'use client';

import { useMemo, useState } from 'react';
import { markWidgetSeenAction } from '@/lib/actions';

type Props = {
  snippet: string;
  workspaceName: string;
  workspaceId: string;
  onDone: () => void;
};

const CLIENT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Rebuild the embed snippet from client-side inputs so it can't ever end up
 * pointing at `http://localhost:4000` in production. The API's server-side
 * `snippet` is used as a fallback only.
 *
 * The customer's site will load `widget.js` from wherever they got the URL —
 * so the URL the copy button hands them MUST be the API's public URL, which
 * the browser side of the dashboard always knows via NEXT_PUBLIC_API_URL.
 */
function buildSnippet(workspaceId: string): string {
  return [
    '<script>',
    `  window.TelecommConfig = { workspaceId: '${workspaceId}' };`,
    '</script>',
    `<script src="${CLIENT_API_URL}/widget.js" async></script>`,
  ].join('\n');
}

export function WidgetStep({ snippet, workspaceId, onDone }: Props) {
  const [copied, setCopied] = useState(false);
  // Prefer the client-built snippet — API-side snippet is fallback only for
  // dev environments where NEXT_PUBLIC_API_URL isn't set.
  const displaySnippet = useMemo(
    () => (workspaceId ? buildSnippet(workspaceId) : snippet),
    [workspaceId, snippet],
  );

  async function copySnippet() {
    await navigator.clipboard.writeText(displaySnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    markWidgetSeenAction().catch(() => {});
  }

  function handleContinue() {
    markWidgetSeenAction().catch(() => {});
    onDone();
  }

  return (
    <div className="p-8">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
          <span className="text-green-600 text-lg">{'</>'}</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Install the chat widget</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Paste this snippet before the closing <code className="text-xs bg-gray-100 px-1 rounded">&lt;/body&gt;</code> tag on every page of your site.
          </p>
        </div>
      </div>

      {/* Code block — the snippet the server hands us already contains the
          real workspaceId and the actual API URL for this deployment. */}
      <div className="relative mb-6">
        <pre className="bg-gray-900 text-green-400 text-sm rounded-xl p-5 overflow-x-auto font-mono leading-relaxed">
          {displaySnippet}
        </pre>
        <button
          onClick={copySnippet}
          className="absolute top-3 right-3 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3">What happens next</p>
        <div className="space-y-2">
          {[
            'We index your knowledge sources in the background (takes a few minutes).',
            'The AI bot answers your customers using your knowledge base.',
            "Queries the AI can't handle are escalated to your agents.",
            'You can chat with your own bot in the sandbox before it goes live.',
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-blue-800">
              <span className="mt-0.5">•</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleContinue}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
