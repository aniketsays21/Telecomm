'use client';

import { useTransition } from 'react';
import type { KbSource } from '@/lib/api';
import { kbDeleteSourceAction, kbSyncSourceAction } from '@/lib/actions';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700',
  syncing: 'bg-blue-50 text-blue-700',
  ready: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  syncing: 'Syncing…',
  ready: 'Ready',
  error: 'Error',
};

function relativeTime(iso: string | null) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function typeIcon(type: string) {
  if (type === 'website') return '🌐';
  if (type === 'file') return '📄';
  return '✏️';
}

function SourceRow({ source }: { source: KbSource }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xl mt-0.5">{typeIcon(source.type)}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900 truncate">{source.name}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[source.status] ?? ''}`}>
              {STATUS_LABELS[source.status] ?? source.status}
            </span>
          </div>

          <p className="text-xs text-gray-500 mt-0.5">
            {source.docCount} chunk{source.docCount !== 1 ? 's' : ''} indexed
            {' · '}
            Last synced {relativeTime(source.lastSyncedAt)}
          </p>

          {source.status === 'error' && source.lastError && (
            <p className="text-xs text-red-600 mt-1 truncate max-w-xs" title={source.lastError}>
              {source.lastError}
            </p>
          )}

          {typeof source.config.startUrl === 'string' && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {source.config.startUrl}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => startTransition(() => kbSyncSourceAction(source.id))}
          disabled={pending || source.status === 'syncing'}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {pending ? 'Syncing…' : 'Sync'}
        </button>
        <button
          onClick={() => {
            if (!confirm(`Delete "${source.name}"? This removes all indexed chunks.`)) return;
            startTransition(() => kbDeleteSourceAction(source.id));
          }}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function KbSourceList({ sources }: { sources: KbSource[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-6">
      {sources.map(s => (
        <SourceRow key={s.id} source={s} />
      ))}
    </div>
  );
}
