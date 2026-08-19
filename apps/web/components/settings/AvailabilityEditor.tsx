'use client';

import { useState, useTransition } from 'react';
import type { AgentAvailability } from '@/lib/api';
import { updateMyAvailabilityAction, updateTeamMemberAction } from '@/lib/actions';

const DAYS: Array<{ n: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 0, label: 'Sun' },
];

const DEFAULT_TZ = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

type Props = {
  initial: AgentAvailability | null;
  target: 'self' | { userId: string };
  onSaved?: () => void;
  compact?: boolean;
};

type DayState = { enabled: boolean; open: string; close: string };

function buildInitialDays(initial: AgentAvailability | null): Record<number, DayState> {
  const base: Record<number, DayState> = {};
  for (const d of DAYS) base[d.n] = { enabled: false, open: '09:00', close: '17:00' };
  for (const slot of initial?.schedule ?? []) {
    base[slot.day] = { enabled: true, open: slot.open, close: slot.close };
  }
  // Sensible default for first-time setup: Mon-Fri 09:00-17:00.
  const anyEnabled = Object.values(base).some((d) => d.enabled);
  if (!anyEnabled) {
    for (const d of [1, 2, 3, 4, 5]) base[d].enabled = true;
  }
  return base;
}

export function AvailabilityEditor({ initial, target, onSaved, compact }: Props) {
  const [tz, setTz] = useState<string>(initial?.timezone || DEFAULT_TZ);
  const [days, setDays] = useState<Record<number, DayState>>(() => buildInitialDays(initial));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggleDay(day: number) {
    setDays((d) => ({ ...d, [day]: { ...d[day], enabled: !d[day].enabled } }));
  }
  function setDayField(day: number, field: 'open' | 'close', value: string) {
    setDays((d) => ({ ...d, [day]: { ...d[day], [field]: value } }));
  }

  function save() {
    const schedule = DAYS
      .filter((d) => days[d.n].enabled)
      .map((d) => ({ day: d.n, open: days[d.n].open, close: days[d.n].close }));
    const payload = { timezone: tz, schedule };
    startTransition(async () => {
      const res = target === 'self'
        ? await updateMyAvailabilityAction(payload)
        : await updateTeamMemberAction(target.userId, { availability: payload });
      if ('success' in res && res.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        onSaved?.();
      }
    });
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Timezone</label>
        <input
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400"
          placeholder="e.g. Asia/Kolkata"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Working hours</label>
        <div className="space-y-1.5">
          {DAYS.map((d) => (
            <div key={d.n} className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 w-16 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={days[d.n].enabled}
                  onChange={() => toggleDay(d.n)}
                  className="rounded"
                />
                {d.label}
              </label>
              <input
                type="time"
                value={days[d.n].open}
                disabled={!days[d.n].enabled}
                onChange={(e) => setDayField(d.n, 'open', e.target.value)}
                className="text-sm border border-gray-200 rounded px-2 py-1 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="time"
                value={days[d.n].close}
                disabled={!days[d.n].enabled}
                onChange={(e) => setDayField(d.n, 'close', e.target.value)}
                className="text-sm border border-gray-200 rounded px-2 py-1 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={isPending}
          className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save hours'}
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}
