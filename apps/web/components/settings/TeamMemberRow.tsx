'use client';

import { useState, useTransition } from 'react';
import type { TeamMember } from '@/lib/api';
import { AvailabilityEditor } from './AvailabilityEditor';
import { updateTeamMemberAction } from '@/lib/actions';

function scheduleSummary(m: TeamMember): string {
  const sched = m.availability?.schedule;
  if (!sched || sched.length === 0) return 'Always available';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...sched]
    .sort((a, b) => a.day - b.day)
    .map((s) => `${dayNames[s.day]} ${s.open}–${s.close}`);
  const tz = m.availability?.timezone ? ` · ${m.availability.timezone}` : '';
  return days.join(', ') + tz;
}

export function TeamMemberRow({ member }: { member: TeamMember }) {
  const [open, setOpen] = useState(false);
  const [capInput, setCapInput] = useState(String(member.maxConcurrentChats ?? '5'));
  const [isPending, startTransition] = useTransition();

  function saveCap() {
    const n = Number(capInput);
    if (!Number.isFinite(n) || n < 1 || n > 50) return;
    startTransition(() => {
      void updateTeamMemberAction(member.id, { maxConcurrentChats: n });
    });
  }

  return (
    <div className="p-5">
      <div className="flex items-center gap-4">
        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
          <span className="text-sm font-semibold text-indigo-700">{member.name[0]?.toUpperCase() ?? '?'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
              member.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
            }`}>{member.role}</span>
            {!member.inviteAcceptedAt && member.role !== 'admin' && (
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">pending</span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">{member.email}</p>
          <p className="text-xs text-gray-400 mt-0.5">{scheduleSummary(member)}</p>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-0.5 mr-4 shrink-0">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Chats</p>
          <p className="text-sm font-numeric" style={{ color: 'var(--ink)' }}>
            <span className="font-semibold">{member.chatsHandled ?? 0}</span>
            <span className="text-gray-400"> handled</span>
          </p>
          {(member.chatsOpen ?? 0) > 0 && (
            <p className="text-[11px] font-numeric" style={{ color: 'var(--forest)' }}>
              {member.chatsOpen} open now
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Max chats</label>
          <input
            type="number"
            min={1}
            max={50}
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            onBlur={saveCap}
            disabled={isPending}
            className="w-14 text-sm border border-gray-200 rounded px-1.5 py-1 text-center"
          />
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-2.5 py-1 border border-gray-200 rounded hover:bg-gray-50"
          >
            {open ? 'Close' : 'Edit hours'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <AvailabilityEditor
            initial={member.availability}
            target={{ userId: member.id }}
            onSaved={() => setOpen(false)}
            compact
          />
        </div>
      )}
    </div>
  );
}
