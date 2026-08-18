'use client';

import { useState } from 'react';
import { markWidgetSeenAction, completeOnboardingAction } from '@/lib/actions';

type Props = {
  snippet: string;
  workspaceName: string;
};

export function WidgetStep({ snippet, workspaceName }: Props) {
  const [copied, setCopied] = useState(false);

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // mark widget step as seen server-side (fire and forget)
    markWidgetSeenAction().catch(() => {});
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

      {/* Code block */}
      <div className="relative mb-6">
        <pre className="bg-gray-900 text-green-400 text-sm rounded-xl p-5 overflow-x-auto font-mono leading-relaxed">
          {snippet}
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
            { icon: '🔄', text: 'We index your knowledge sources in the background (takes a few minutes).' },
            { icon: '🤖', text: 'The AI bot will answer your customers using your knowledge base.' },
            { icon: '👤', text: 'Queries the AI can\'t handle are escalated to you in the inbox.' },
            { icon: '🧪', text: 'You can chat with your own bot in the sandbox before it goes live.' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-blue-800">
              <span>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          You can paste this snippet later from Settings → Widget.
        </p>
        <form action={completeOnboardingAction}>
          <button
            type="submit"
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Go to inbox →
          </button>
        </form>
      </div>
    </div>
  );
}
