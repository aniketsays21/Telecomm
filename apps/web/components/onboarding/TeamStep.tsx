'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentAvailability } from '@/lib/api';
import { inviteUserAction, completeOnboardingAction, updateMyAvailabilityAction } from '@/lib/actions';

type Invite = {
  id: string;
  name: string;
  email: string;
  status: 'sent' | 'sending' | 'error' | 'created_no_email';
  errorMessage?: string;
  inviteLink?: string;
};

const DAY_LABELS: Array<{ n: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 0, label: 'Sun' },
];

const DEFAULT_OPEN = '09:00';
const DEFAULT_CLOSE = '17:00';

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type Props = {
  initialAvailability: AgentAvailability | null;
};

export function TeamStep({ initialAvailability }: Props) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, startInvite] = useTransition();
  const [isPublishing, startPublish] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);
  const router = useRouter();

  // Working hours — reuse the availability shape used elsewhere in the app,
  // but with a friendlier onboarding UI (weekday toggles, one open/close for
  // enabled days). Editing per-day hours can happen later in Team settings.
  const initialDays = new Set<number>(
    (initialAvailability?.schedule ?? []).map((s) => s.day),
  );
  const [enabledDays, setEnabledDays] = useState<Set<number>>(
    initialDays.size ? initialDays : new Set([1, 2, 3, 4, 5]),
  );
  const [openTime, setOpenTime] = useState<string>(
    initialAvailability?.schedule?.[0]?.open ?? DEFAULT_OPEN,
  );
  const [closeTime, setCloseTime] = useState<string>(
    initialAvailability?.schedule?.[0]?.close ?? DEFAULT_CLOSE,
  );
  const [timezone] = useState<string>(initialAvailability?.timezone ?? guessTimezone());

  function toggleDay(d: number) {
    setEnabledDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function addInvite() {
    setInviteError(null);
    if (!name.trim() || !email.trim()) {
      setInviteError('Enter both name and email.');
      return;
    }
    const tmpId = `t-${Date.now()}`;
    const nextName = name.trim();
    const nextEmail = email.trim();
    setInvites((prev) => [...prev, { id: tmpId, name: nextName, email: nextEmail, status: 'sending' }]);
    setName('');
    setEmail('');
    startInvite(async () => {
      const res = await inviteUserAction(undefined, formDataFrom({ name: nextName, email: nextEmail, role: 'agent' }));
      if (res && 'error' in res && res.error) {
        setInvites((prev) => prev.map((i) => (i.id === tmpId ? { ...i, status: 'error', errorMessage: res.error } : i)));
        return;
      }
      // Even on success, SMTP might not be wired up in this environment — the
      // invite row is created either way, but we want to surface the link so
      // the admin can copy it manually until email is set up.
      if (res && 'success' in res && res.success) {
        setInvites((prev) => prev.map((i) => (
          i.id === tmpId
            ? { ...i, status: res.emailSent ? 'sent' : 'created_no_email', inviteLink: res.inviteLink }
            : i
        )));
      }
    });
  }

  function copyInviteLink(link: string) {
    try {
      void navigator.clipboard.writeText(link);
    } catch { /* clipboard blocked, ignore */ }
  }

  function removeInvite(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }

  async function publish() {
    setPublishError(null);
    startPublish(async () => {
      // Save the admin's own working hours first so the on-duty logic has
      // something to work from once the workspace is live.
      const schedule = Array.from(enabledDays)
        .sort((a, b) => a - b)
        .map((day) => ({ day: day as 0 | 1 | 2 | 3 | 4 | 5 | 6, open: openTime, close: closeTime }));
      if (schedule.length > 0) {
        try {
          await updateMyAvailabilityAction({ timezone, schedule });
        } catch {
          /* non-blocking — don't stop the publish if this fails */
        }
      }
      const res = await completeOnboardingAction();
      if (res && 'error' in res && res.error) {
        setPublishError(res.error);
        return;
      }
      const next = (res && 'next' in res && res.next) || '/analytics';
      router.push(next);
      router.refresh();
    });
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
          <span className="text-amber-600 text-lg">👥</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Invite your team and set hours</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Add teammates so escalations get routed to whoever&apos;s on-duty. They&apos;ll
            receive an invite email to set their own password.
          </p>
        </div>
      </div>

      {/* Team invites */}
      <section>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Agents</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Agent name"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="agent@company.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={addInvite}
            disabled={isInviting}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isInviting ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        {inviteError && <p className="text-sm text-red-600 mb-3">{inviteError}</p>}

        {invites.length === 0 ? (
          <p className="text-xs text-gray-400">
            No agents added yet. You can also add them later from Team settings.
          </p>
        ) : (
          <ul className="space-y-2">
            {invites.map((i) => (
              <li
                key={i.id}
                className="px-4 py-3 bg-gray-50 rounded-xl border border-gray-100"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-xs font-semibold text-indigo-700">
                    {i.name[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{i.name}</p>
                    <p className="text-xs text-gray-500 truncate">{i.email}</p>
                    {i.status === 'error' && i.errorMessage && (
                      <p className="text-xs text-red-600 mt-0.5">{i.errorMessage}</p>
                    )}
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      i.status === 'sent' ? 'bg-emerald-100 text-emerald-700'
                      : i.status === 'created_no_email' ? 'bg-amber-100 text-amber-700'
                      : i.status === 'error' ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {i.status === 'sent' ? 'Invite sent'
                     : i.status === 'created_no_email' ? 'Copy link'
                     : i.status === 'error' ? 'Failed'
                     : 'Sending…'}
                  </span>
                  <button
                    onClick={() => removeInvite(i.id)}
                    className="text-gray-300 hover:text-red-400 text-lg leading-none"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
                {i.status === 'created_no_email' && i.inviteLink && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                    <p className="text-[11px] text-amber-800 flex-1">
                      Email sending isn&apos;t configured. Copy this invite link and share it directly:
                    </p>
                    <button
                      type="button"
                      onClick={() => copyInviteLink(i.inviteLink!)}
                      className="text-[11px] px-2 py-1 border border-amber-300 rounded text-amber-800 hover:bg-amber-100"
                    >
                      Copy link
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Working hours */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Working hours</p>
          <p className="text-[11px] text-gray-400">{timezone}</p>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {DAY_LABELS.map(({ n, label }) => {
            const on = enabledDays.has(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggleDay(n)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  on
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-500 text-xs">Open</span>
            <input
              type="time"
              value={openTime}
              onChange={(e) => setOpenTime(e.currentTarget.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <span className="text-gray-400">→</span>
          <label className="flex items-center gap-2">
            <span className="text-gray-500 text-xs">Close</span>
            <input
              type="time"
              value={closeTime}
              onChange={(e) => setCloseTime(e.currentTarget.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Applied to every selected day. You can tune per-agent hours later from Team settings.
        </p>
      </section>

      <div className="pt-4 border-t border-gray-100 space-y-3">
        {publishError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {publishError}
          </p>
        )}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            Ready when you are — you can invite more teammates any time.
          </p>
          <button
            type="button"
            onClick={publish}
            disabled={isPublishing}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {isPublishing ? 'Publishing…' : 'Publish & continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formDataFrom(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
