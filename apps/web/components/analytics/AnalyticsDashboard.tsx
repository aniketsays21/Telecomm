'use client';

import { useState } from 'react';
import type { AnalyticsData } from '@/lib/api';

function fmtMs(ms: number | null) {
  if (ms === null) return '—';
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  return `${Math.round(m / 60)}h ${Math.round(m % 60)}m`;
}

// A numeric readout card — big serif number, small caption, hairline top rule.
function Stat({
  label,
  value,
  caption,
  emphasis,
}: {
  label: string;
  value: string | number;
  caption?: string;
  emphasis?: 'default' | 'forest' | 'brick';
}) {
  const color =
    emphasis === 'brick' ? 'var(--brick)' :
    emphasis === 'forest' ? 'var(--forest)' :
    'var(--ink)';
  return (
    <div className="py-5" style={{ borderTop: '1px solid var(--rule)' }}>
      <p className="eyebrow">{label}</p>
      <p
        className="font-display leading-none mt-3"
        style={{ color, fontSize: '2.75rem' }}
      >
        {value}
      </p>
      {caption && (
        <p className="text-xs mt-2 font-numeric" style={{ color: 'var(--dust)' }}>
          {caption}
        </p>
      )}
    </div>
  );
}

function BarChart({ data }: { data: AnalyticsData['daily'] }) {
  if (!data.length) {
    return (
      <p className="text-sm py-12 text-center italic" style={{ color: 'var(--dust)' }}>
        No data in this period.
      </p>
    );
  }

  const maxConv = Math.max(...data.map((d) => d.conversations), 1);
  const H = 140;
  const W = 640;
  const barW = Math.max(4, Math.floor((W / data.length) * 0.55));
  const gap = W / data.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 34}`} className="w-full" style={{ minWidth: 320 }}>
        {/* Baseline */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--rule)" strokeWidth="1" />
        {data.map((d, i) => {
          const x = i * gap + gap / 2;
          const convH = (d.conversations / maxConv) * H;
          const escH = (d.escalations / maxConv) * H;
          const label = new Date(d.day).toLocaleDateString([], { month: 'short', day: 'numeric' });
          return (
            <g key={d.day}>
              <rect
                x={x - barW / 2}
                y={H - convH}
                width={barW}
                height={convH}
                fill="var(--ink)"
                opacity={0.88}
              />
              {d.escalations > 0 && (
                <rect
                  x={x - barW / 2}
                  y={H - escH}
                  width={barW}
                  height={escH}
                  fill="var(--brick)"
                  opacity={0.9}
                />
              )}
              {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
                <text
                  x={x}
                  y={H + 20}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--dust)"
                  fontFamily="var(--font-mono)"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-6 justify-end mt-3 text-[11px]" style={{ color: 'var(--ash)' }}>
        <span className="status-dot" style={{ color: 'var(--ink)' }}>Conversations</span>
        <span className="status-dot" style={{ color: 'var(--brick)' }}>Escalations</span>
      </div>
    </div>
  );
}

interface Props {
  initial: AnalyticsData;
}

export function AnalyticsDashboard({ initial }: Props) {
  const [data] = useState(initial);
  const summary = data.summary ?? ({} as AnalyticsData['summary']);
  const daily = data.daily ?? [];
  const topEscalationReasons = data.topEscalationReasons ?? [];
  const channelSplit = data.channelSplit ?? [];
  const topContacts = data.topContacts ?? [];
  const topTopics = data.topTopics ?? [];

  const resolutionLabel =
    summary.avgResolutionMinutes == null ? '—'
    : summary.avgResolutionMinutes < 60 ? `${summary.avgResolutionMinutes}m`
    : `${Math.round(summary.avgResolutionMinutes / 6) / 10}h`;

  return (
    <div className="space-y-14">
      {/* Primary KPI row */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8">
          <Stat
            label="Conversations"
            value={summary.total ?? 0}
            caption={`Last ${data.period?.days ?? 30} days`}
          />
          <Stat
            label="Open now"
            value={summary.openNow ?? 0}
            emphasis="forest"
          />
          <Stat
            label="AI resolution"
            value={`${summary.aiResolutionRate ?? 0}%`}
            caption={`${summary.aiResolved ?? 0} handled by AI`}
            emphasis="forest"
          />
          <Stat
            label="Escalation rate"
            value={`${summary.escalationRate ?? 0}%`}
            caption={`${summary.escalated ?? 0} escalated`}
            emphasis={(summary.escalationRate ?? 0) > 20 ? 'brick' : 'default'}
          />
        </div>
      </section>

      {/* Secondary readouts */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8">
          <Stat label="First response" value={fmtMs(summary.avgFirstResponseMs)} caption="Agent replies" />
          <Stat label="Resolution time" value={resolutionLabel} caption="Open → resolved" />
          <Stat label="Agent resolved" value={summary.agentResolved ?? 0} />
          <div className="py-5" style={{ borderTop: '1px solid var(--rule)' }}>
            <p className="eyebrow">Channels</p>
            <div className="mt-3 space-y-2">
              {channelSplit.length === 0 ? (
                <p className="text-sm italic" style={{ color: 'var(--dust)' }}>—</p>
              ) : channelSplit.map((c) => (
                <div key={c.channel} className="flex items-baseline justify-between">
                  <span className="text-sm capitalize" style={{ color: 'var(--ink)' }}>{c.channel}</span>
                  <span className="font-numeric text-sm" style={{ color: 'var(--ash)' }}>{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Volume chart */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl italic" style={{ color: 'var(--ink)' }}>Daily volume</h3>
          <p className="text-xs" style={{ color: 'var(--ash)' }}>{daily.length} days</p>
        </div>
        <div className="p-6" style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}>
          <BarChart data={daily} />
        </div>
      </section>

      {/* Top problems + top contacts, editorial two-column */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div>
          <h3 className="font-display text-2xl italic mb-4" style={{ color: 'var(--ink)' }}>
            Top problems
          </h3>
          {topTopics.length === 0 ? (
            <p className="text-sm italic" style={{ color: 'var(--dust)' }}>
              The AI tags each thread by topic; nothing tagged yet in this period.
            </p>
          ) : (
            <ol className="space-y-3">
              {topTopics.map((t, i) => {
                const max = topTopics[0].count;
                const pct = Math.round((t.count / max) * 100);
                return (
                  <li key={i}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-sm capitalize" style={{ color: 'var(--ink)' }}>
                        <span className="font-numeric text-xs mr-2" style={{ color: 'var(--dust)' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {t.topic.replace(/-/g, ' ')}
                      </span>
                      <span className="font-numeric text-xs" style={{ color: 'var(--ash)' }}>{t.count}</span>
                    </div>
                    <div className="h-px w-full" style={{ background: 'var(--rule)' }}>
                      <div className="h-px" style={{ background: 'var(--forest)', width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div>
          <h3 className="font-display text-2xl italic mb-4" style={{ color: 'var(--ink)' }}>
            Top contacts
          </h3>
          {topContacts.length === 0 ? (
            <p className="text-sm italic" style={{ color: 'var(--dust)' }}>No contacts yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {topContacts.map((c, i) => (
                <li
                  key={c.id}
                  className="flex items-baseline justify-between py-2"
                  style={{ borderBottom: i === topContacts.length - 1 ? 'none' : '1px solid var(--rule-2)' }}
                >
                  <div className="min-w-0 mr-3">
                    <p className="text-sm truncate" style={{ color: 'var(--ink)' }}>{c.label}</p>
                    {c.email && c.email !== c.label && (
                      <p className="text-xs truncate" style={{ color: 'var(--dust)' }}>{c.email}</p>
                    )}
                  </div>
                  <span className="font-numeric text-sm" style={{ color: 'var(--ash)' }}>{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Escalation reasons */}
      {topEscalationReasons.length > 0 && (
        <section>
          <h3 className="font-display text-2xl italic mb-4" style={{ color: 'var(--ink)' }}>
            Why the AI escalated
          </h3>
          <div className="space-y-3">
            {topEscalationReasons.map((r, i) => {
              const max = topEscalationReasons[0].count;
              const pct = Math.round((r.count / max) * 100);
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-sm truncate mr-3" style={{ color: 'var(--ink)' }}>{r.reason}</span>
                    <span className="font-numeric text-xs" style={{ color: 'var(--ash)' }}>{r.count}</span>
                  </div>
                  <div className="h-px w-full" style={{ background: 'var(--rule)' }}>
                    <div className="h-px" style={{ background: 'var(--brick)', width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
