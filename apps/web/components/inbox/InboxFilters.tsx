'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'all', label: 'All' },
];

const CHANNELS = [
  { value: '', label: 'All channels' },
  { value: 'chat', label: 'Chat' },
  { value: 'email', label: 'Email' },
];

export function InboxFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);

  const status = params.get('status') ?? 'open';
  const channel = params.get('channel') ?? '';
  const q = params.get('q') ?? '';

  async function handleExport() {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (channel) qs.set('channel', channel);
      if (q) qs.set('q', q);
      const res = await fetch(`/api/export/conversations?${qs}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversations-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const update = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      // Navigate to base inbox (not a specific conversation) when filters change
      const basePath = pathname.startsWith('/inbox/') ? '/inbox' : pathname;
      router.push(`${basePath}?${next.toString()}`);
    });
  }, [params, pathname, router]);

  return (
    <div className="px-3 py-2 border-b border-gray-100 space-y-2">
      {/* Export */}
      <div className="flex justify-end">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="text-[10px] px-2 py-1 rounded-md font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-40 flex items-center gap-1"
          title="Export current view as CSV"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
      {/* Search */}
      <input
        type="search"
        placeholder="Search by name or email…"
        defaultValue={q}
        className="w-full text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-indigo-400 bg-gray-50"
        onChange={e => update('q', e.target.value)}
      />

      {/* Status tabs */}
      <div className="flex gap-1">
        {STATUSES.map(s => (
          <button
            key={s.value}
            onClick={() => update('status', s.value)}
            className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
              status === s.value
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Channel filter */}
      <div className="flex gap-1">
        {CHANNELS.map(c => (
          <button
            key={c.value}
            onClick={() => update('channel', c.value)}
            className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
              channel === c.value
                ? 'bg-gray-200 text-gray-800'
                : 'text-gray-400 hover:bg-gray-100'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
