'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

const STATUSES = [
  { value: 'open',     label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'snoozed',  label: 'Snoozed' },
  { value: 'all',      label: 'All' },
];

const CHANNELS = [
  { value: '',      label: 'All' },
  { value: 'chat',  label: 'Chat' },
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
      const basePath = pathname.startsWith('/inbox/') ? '/inbox' : pathname;
      router.push(`${basePath}?${next.toString()}`);
    });
  }, [params, pathname, router]);

  return (
    <div className="px-5 py-4 space-y-3" style={{ borderBottom: '1px solid var(--rule)' }}>
      <input
        type="search"
        placeholder="Search conversations…"
        defaultValue={q}
        className="input-flat"
        onChange={(e) => update('q', e.target.value)}
      />

      {/* Status — the primary filter, styled as tabs with hairline underline */}
      <div className="flex items-center gap-4" style={{ borderBottom: '1px solid var(--rule-2)' }}>
        {STATUSES.map((s) => {
          const active = status === s.value;
          return (
            <button
              key={s.value}
              onClick={() => update('status', s.value)}
              className="pb-2 text-xs transition-colors -mb-px"
              style={{
                color: active ? 'var(--ink)' : 'var(--ash)',
                borderBottom: active ? '1px solid var(--ink)' : '1px solid transparent',
                fontWeight: active ? 500 : 400,
              }}
            >
              {s.label}
            </button>
          );
        })}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto pb-2 text-[11px] transition-colors"
          style={{ color: 'var(--dust)' }}
          title="Export current view as CSV"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Channel — subordinate, styled as inline prose choices */}
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ash)' }}>
        <span className="eyebrow" style={{ color: 'var(--dust)' }}>Channel</span>
        {CHANNELS.map((c, i) => {
          const active = channel === c.value;
          return (
            <span key={c.value}>
              {i > 0 && <span style={{ color: 'var(--rule)' }} className="mx-1.5">·</span>}
              <button
                onClick={() => update('channel', c.value)}
                className="transition-colors"
                style={{
                  color: active ? 'var(--forest)' : 'var(--ash)',
                  fontWeight: active ? 500 : 400,
                  textDecoration: active ? 'underline' : 'none',
                  textUnderlineOffset: '3px',
                }}
              >
                {c.label}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
