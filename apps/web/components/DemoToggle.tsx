'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { demoStatusAction, demoEnableAction, demoDisableAction } from '@/lib/actions';

/**
 * Admin-only toggle that seeds the workspace with realistic demo data
 * (~350 conversations, ~1250 messages, 30 KB docs, 8 canned replies) or
 * wipes just that seed. Every row is tagged is_demo, so real conversations
 * you already have are never touched.
 */
export function DemoToggle() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await demoStatusAction();
      if (cancelled) return;
      if ('enabled' in res) setEnabled(res.enabled);
      else setEnabled(false);
    })();
    return () => { cancelled = true; };
  }, []);

  function toggle() {
    if (enabled == null || busy) return;
    setMessage(null);
    startTransition(async () => {
      const res = enabled ? await demoDisableAction() : await demoEnableAction();
      if ('error' in res && res.error) {
        setMessage(res.error);
        return;
      }
      const next = !enabled;
      setEnabled(next);
      setMessage(next ? 'Seeded — refreshing…' : 'Cleared — refreshing…');
      router.refresh();
      setTimeout(() => setMessage(null), 2500);
    });
  }

  const loading = enabled == null;

  return (
    <div
      className="px-3 py-2.5 rounded-md flex items-center gap-2.5"
      style={{
        background: enabled ? 'var(--forest-soft)' : 'transparent',
        border: enabled ? '1px solid #C7D2FE' : '1px solid var(--rule-2)',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={loading || busy}
        aria-pressed={!!enabled}
        aria-label={enabled ? 'Disable demo mode' : 'Enable demo mode'}
        className="relative inline-flex items-center rounded-full transition-colors disabled:opacity-50 shrink-0"
        style={{
          width: 32,
          height: 18,
          background: enabled ? 'var(--forest)' : 'var(--dust)',
        }}
      >
        <span
          className="absolute rounded-full bg-white shadow-sm transition-transform"
          style={{
            width: 14,
            height: 14,
            top: 2,
            left: 2,
            transform: enabled ? 'translateX(14px)' : 'translateX(0)',
          }}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p
          className="text-[11px] font-semibold leading-tight"
          style={{ color: enabled ? 'var(--forest)' : 'var(--ink)' }}
        >
          {busy ? (enabled ? 'Clearing demo…' : 'Seeding demo…') : 'Demo data'}
        </p>
        <p className="text-[10px] leading-tight truncate" style={{ color: 'var(--ash)' }}>
          {loading ? 'Checking…' : enabled ? '~350 sample conversations loaded' : 'Fill with sample data'}
        </p>
      </div>
      {message && (
        <span className="text-[10px] shrink-0" style={{ color: 'var(--forest)' }}>{message}</span>
      )}
    </div>
  );
}
