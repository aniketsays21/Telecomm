'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { seedSampleKbAction } from '@/lib/actions';

/**
 * One-click loader for a ready-made course-creator help centre (session
 * timings, refunds, join links, certificates, etc.). Seeds real KB sources
 * into this workspace so the widget AI can answer immediately — useful for a
 * fresh workspace or a demo before a real site is crawled.
 */
export function SeedSampleButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function seed() {
    setMsg(null);
    start(async () => {
      const res = await seedSampleKbAction();
      if ('error' in res && res.error) { setMsg(res.error); return; }
      if ('ok' in res) {
        const created = res.created ?? 0;
        setMsg(
          created > 0
            ? `Added ${created} sample article${created === 1 ? '' : 's'} — indexing now.`
            : 'Sample content is already loaded.',
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={seed}
        disabled={busy}
        className="text-sm px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? 'Loading…' : 'Load sample content'}
      </button>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}
