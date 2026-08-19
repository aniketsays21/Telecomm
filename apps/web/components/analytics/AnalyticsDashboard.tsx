'use client';

import { useState } from 'react';
import type { AnalyticsData } from '@/lib/api';

function fmt(ms: number | null) {
  if (ms === null) return '—';
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  return `${Math.round(m / 60)}h ${Math.round(m % 60)}m`;
}

function StatCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function BarChart({ data }: { data: AnalyticsData['daily'] }) {
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-8">No data yet.</p>;

  const maxConv = Math.max(...data.map(d => d.conversations), 1);
  const H = 120;
  const W = 600;
  const barW = Math.max(4, Math.floor((W / data.length) * 0.6));
  const gap = W / data.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full" style={{ minWidth: 320 }}>
        {data.map((d, i) => {
          const x = i * gap + gap / 2;
          const convH = (d.conversations / maxConv) * H;
          const escH = (d.escalations / maxConv) * H;
          const label = new Date(d.day).toLocaleDateString([], { month: 'short', day: 'numeric' });
          return (
            <g key={d.day}>
              {/* Conversation bar */}
              <rect
                x={x - barW / 2}
                y={H - convH}
                width={barW}
                height={convH}
                rx={2}
                fill="#6366f1"
                opacity={0.85}
              />
              {/* Escalation bar (overlay) */}
              {d.escalations > 0 && (
                <rect
                  x={x - barW / 2}
                  y={H - escH}
                  width={barW}
                  height={escH}
                  rx={2}
                  fill="#f43f5e"
                  opacity={0.8}
                />
              )}
              {/* Day label — every nth label to avoid crowding */}
              {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
                <text x={x} y={H + 16} textAnchor="middle" fontSize={8} fill="#9ca3af">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 justify-end mt-1">
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Conversations
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500" /> Escalations
        </span>
      </div>
    </div>
  );
}

interface Props {
  initial: AnalyticsData;
}

export function AnalyticsDashboard({ initial }: Props) {
  const [data] = useState(initial);
  // Defensive against an API deployment that pre-dates any of these fields —
  // an out-of-sync API rollout should not blank the whole page.
  const summary = data.summary ?? ({} as AnalyticsData['summary']);
  const daily = data.daily ?? [];
  const topEscalationReasons = data.topEscalationReasons ?? [];
  const channelSplit = data.channelSplit ?? [];
  const topContacts = data.topContacts ?? [];
  const topTopics = data.topTopics ?? [];
  const resolutionLabel = summary.avgResolutionMinutes == null
    ? '—'
    : summary.avgResolutionMinutes < 60
      ? `${summary.avgResolutionMinutes}m`
      : `${Math.round(summary.avgResolutionMinutes / 6) / 10}h`;

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Conversations" value={summary.total} sub={`Last ${data.period.days} days`} />
        <StatCard label="Open Now" value={summary.openNow} color="text-indigo-600" />
        <StatCard
          label="AI Resolution Rate"
          value={`${summary.aiResolutionRate}%`}
          sub={`${summary.aiResolved} resolved by AI`}
          color="text-emerald-600"
        />
        <StatCard
          label="Escalation Rate"
          value={`${summary.escalationRate}%`}
          sub={`${summary.escalated} escalated`}
          color={summary.escalationRate > 20 ? 'text-rose-600' : 'text-gray-900'}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Avg First Response"
          value={fmt(summary.avgFirstResponseMs)}
          sub="Agent replies only"
        />
        <StatCard
          label="Avg Resolution Time"
          value={resolutionLabel}
          sub="Open → resolved"
        />
        <StatCard label="Agent Resolved" value={summary.agentResolved} />
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Channels</p>
          {channelSplit.length === 0
            ? <p className="text-sm text-gray-400">No data</p>
            : channelSplit.map(c => (
              <div key={c.channel} className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600 capitalize">{c.channel}</span>
                <span className="font-semibold text-gray-900">{c.count}</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* Volume chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Daily Volume</h3>
        <BarChart data={daily} />
      </div>

      {/* Two-column: top topics + top contacts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Problems Customers Face</h3>
          {topTopics.length === 0 ? (
            <p className="text-sm text-gray-400">No tagged conversations yet — the AI tags each thread with its topic (shipping / refund / sizing…) as it replies.</p>
          ) : (
            <div className="space-y-2">
              {topTopics.map((t, i) => {
                const max = topTopics[0].count;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-sm text-gray-700 truncate capitalize">{t.topic.replace(/-/g, ' ')}</p>
                        <span className="text-xs text-gray-500 ml-2 shrink-0">{t.count}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(t.count / max) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Contacts by Volume</h3>
          {topContacts.length === 0 ? (
            <p className="text-sm text-gray-400">No conversations yet.</p>
          ) : (
            <div className="space-y-2">
              {topContacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-none">
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-gray-800 truncate">{c.label}</p>
                    {c.email && c.email !== c.label && (
                      <p className="text-xs text-gray-400 truncate">{c.email}</p>
                    )}
                  </div>
                  <span className="font-semibold text-gray-900 shrink-0">{c.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Escalation reasons */}
      {topEscalationReasons.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Escalation Reasons</h3>
          <div className="space-y-2">
            {topEscalationReasons.map((r, i) => {
              const max = topEscalationReasons[0].count;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-sm text-gray-700 truncate">{r.reason}</p>
                      <span className="text-xs text-gray-500 ml-2 shrink-0">{r.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-rose-400 rounded-full"
                        style={{ width: `${(r.count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
