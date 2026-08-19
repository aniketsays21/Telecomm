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

// A minimal, editorial pie/donut chart. Two-tone palette drawn from the
// design system tokens so it matches the rest of the page. Legend printed
// beneath the chart to keep the ring itself clean.
function ChannelPie({ data }: { data: AnalyticsData['channelSplit'] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) {
    return (
      <p className="text-sm py-12 text-center italic" style={{ color: 'var(--dust)' }}>
        No conversations in this period.
      </p>
    );
  }

  // Palette: chat = forest, email = ink, other = ash. Kept intentionally
  // small — this is a two-channel product for now.
  const paletteFor = (channel: string): string => {
    const c = channel.toLowerCase();
    if (c === 'chat') return 'var(--forest)';
    if (c === 'email') return 'var(--ink)';
    return 'var(--ash)';
  };

  const R_OUTER = 90;
  const R_INNER = 58;
  const CX = 110;
  const CY = 110;

  // Special-case a single slice: an arc from 0→2π is a no-op in SVG, so
  // draw a full ring instead.
  const only = data.length === 1;
  let acc = 0;
  const slices = data.map((d) => {
    const frac = d.count / total;
    const start = acc;
    const end = acc + frac;
    acc = end;
    const startAng = start * 2 * Math.PI - Math.PI / 2;
    const endAng = end * 2 * Math.PI - Math.PI / 2;
    const largeArc = frac > 0.5 ? 1 : 0;
    const x1 = CX + R_OUTER * Math.cos(startAng);
    const y1 = CY + R_OUTER * Math.sin(startAng);
    const x2 = CX + R_OUTER * Math.cos(endAng);
    const y2 = CY + R_OUTER * Math.sin(endAng);
    const x3 = CX + R_INNER * Math.cos(endAng);
    const y3 = CY + R_INNER * Math.sin(endAng);
    const x4 = CX + R_INNER * Math.cos(startAng);
    const y4 = CY + R_INNER * Math.sin(startAng);
    const path = only
      ? `M ${CX - R_OUTER} ${CY} A ${R_OUTER} ${R_OUTER} 0 1 1 ${CX + R_OUTER - 0.01} ${CY} L ${CX + R_INNER - 0.01} ${CY} A ${R_INNER} ${R_INNER} 0 1 0 ${CX - R_INNER} ${CY} Z`
      : `M ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return {
      channel: d.channel,
      count: d.count,
      pct: Math.round(frac * 100),
      color: paletteFor(d.channel),
      path,
    };
  });

  return (
    <div className="flex flex-col md:flex-row items-center gap-8">
      <svg viewBox="0 0 220 220" width="220" height="220" className="shrink-0">
        {slices.map((s) => (
          <path key={s.channel} d={s.path} fill={s.color} />
        ))}
        <text
          x={CX}
          y={CY - 4}
          textAnchor="middle"
          fontSize="28"
          fontFamily="var(--font-display)"
          fontStyle="italic"
          fill="var(--ink)"
        >
          {total}
        </text>
        <text
          x={CX}
          y={CY + 16}
          textAnchor="middle"
          fontSize="9"
          letterSpacing="0.12em"
          fontFamily="var(--font-mono)"
          fill="var(--dust)"
        >
          TOTAL
        </text>
      </svg>
      <ul className="flex-1 space-y-3 w-full">
        {slices.map((s) => (
          <li key={s.channel} className="flex items-baseline justify-between gap-4">
            <span className="flex items-center gap-3">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className="text-sm capitalize" style={{ color: 'var(--ink)' }}>
                {s.channel}
              </span>
            </span>
            <span className="flex items-baseline gap-3">
              <span className="font-numeric text-xs" style={{ color: 'var(--ash)' }}>{s.count}</span>
              <span
                className="font-display italic text-lg"
                style={{ color: 'var(--ink)', minWidth: '3.2rem', textAlign: 'right' }}
              >
                {s.pct}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Small pill that labels a section as demo/sample data. Prevents a viewer
// mistaking the placeholder chart for real numbers.
function SampleTag() {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide"
      style={{ background: 'var(--rule-2)', color: 'var(--ash)', letterSpacing: '0.06em' }}
    >
      Sample
    </span>
  );
}

// Segmented horizontal bar for sentiment distribution. Neutral tones for
// neutral/positive so the palette doesn't scream; brick and ochre pull
// attention to negative/frustrated/angry — the ones an operator should act on.
// When real data is empty, we render a representative sample so the section
// still communicates what the chart will look like once messages flow in.
function SentimentStrip({ data }: { data: Array<{ sentiment: string; count: number }> }) {
  const order: Array<{ key: string; label: string; color: string; text: string }> = [
    { key: 'positive',   label: 'Positive',   color: 'var(--forest)',      text: 'var(--paper)' },
    { key: 'neutral',    label: 'Neutral',    color: 'var(--dust)',        text: 'var(--ink)' },
    { key: 'negative',   label: 'Negative',   color: 'var(--ochre)',       text: 'var(--ink)' },
    { key: 'frustrated', label: 'Frustrated', color: '#C67341',            text: 'var(--paper)' },
    { key: 'angry',      label: 'Angry',      color: 'var(--brick)',       text: 'var(--paper)' },
  ];
  const realTotal = data.reduce((s, r) => s + r.count, 0);
  const isSample = realTotal === 0;
  // Plausible distribution when nothing is classified yet — biased toward
  // positive/neutral like most inbound support traffic.
  const sampleData = isSample
    ? [
        { sentiment: 'positive', count: 42 },
        { sentiment: 'neutral', count: 31 },
        { sentiment: 'negative', count: 15 },
        { sentiment: 'frustrated', count: 8 },
        { sentiment: 'angry', count: 4 },
      ]
    : data;
  const total = sampleData.reduce((s, r) => s + r.count, 0);
  const bucket = new Map(sampleData.map((r) => [r.sentiment.toLowerCase(), r.count]));
  const rows = order
    .map((o) => ({ ...o, count: bucket.get(o.key) ?? 0 }))
    .filter((r) => r.count > 0);

  return (
    <div style={{ opacity: isSample ? 0.75 : 1 }}>
      <div className="flex w-full overflow-hidden rounded" style={{ height: 44, border: '1px solid var(--rule)' }}>
        {rows.map((r) => {
          const pct = (r.count / total) * 100;
          return (
            <div
              key={r.key}
              className="flex items-center justify-center text-[11px] font-numeric"
              style={{ width: `${pct}%`, background: r.color, color: r.text, minWidth: '2rem' }}
              title={`${r.label} — ${r.count}`}
            >
              {pct >= 6 ? `${Math.round(pct)}%` : ''}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-4">
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-2 text-xs" style={{ color: 'var(--ink)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />
              <span>{r.label}</span>
              <span className="font-numeric" style={{ color: 'var(--ash)' }}>{r.count}</span>
            </li>
          ))}
        </ul>
        {isSample && <SampleTag />}
      </div>
    </div>
  );
}

function BarChart({ data }: { data: AnalyticsData['daily'] }) {
  const isSample = !data.length;
  // Fabricate 14 days of plausible traffic so the panel isn't blank on a
  // brand-new workspace. Wave-shaped counts read as "look, real support
  // volume swings by day" rather than a random noise line.
  const rows = isSample
    ? Array.from({ length: 14 }, (_, i) => {
        const day = new Date(Date.now() - (13 - i) * 86400_000);
        const base = 18 + Math.round(10 * Math.sin(i * 0.7));
        return {
          day: day.toISOString().slice(0, 10),
          conversations: Math.max(4, base + Math.round(6 * Math.sin(i * 1.9))),
          escalations: Math.max(0, Math.round(base / 6) + (i % 3 === 0 ? 1 : 0)),
        };
      })
    : data;
  const maxConv = Math.max(...rows.map((d) => d.conversations), 1);
  const H = 140;
  const W = 640;
  const barW = Math.max(4, Math.floor((W / rows.length) * 0.55));
  const gap = W / rows.length;

  return (
    <div className="overflow-x-auto" style={{ opacity: isSample ? 0.75 : 1 }}>
      <svg viewBox={`0 0 ${W} ${H + 34}`} className="w-full" style={{ minWidth: 320 }}>
        {/* Baseline */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--rule)" strokeWidth="1" />
        {rows.map((d, i) => {
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
              {(rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0) && (
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
      <div className="flex gap-6 justify-end items-center mt-3 text-[11px]" style={{ color: 'var(--ash)' }}>
        <span className="status-dot" style={{ color: 'var(--ink)' }}>Conversations</span>
        <span className="status-dot" style={{ color: 'var(--brick)' }}>Escalations</span>
        {isSample && <SampleTag />}
      </div>
    </div>
  );
}

function TopProblemsPanel({ topics }: { topics: AnalyticsData['topTopics'] }) {
  const isSample = topics.length === 0;
  const rows = isSample
    ? [
        { topic: 'shipping', count: 48 },
        { topic: 'refund', count: 34 },
        { topic: 'sizing', count: 27 },
        { topic: 'account', count: 21 },
        { topic: 'pricing', count: 15 },
        { topic: 'tech-issue', count: 11 },
      ]
    : topics;
  const max = rows[0].count;
  return (
    <div style={{ opacity: isSample ? 0.75 : 1 }}>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Top problems</h3>
        {isSample && <SampleTag />}
      </div>
      <ol className="space-y-3">
        {rows.map((t, i) => {
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
              <div className="h-1 w-full rounded-full" style={{ background: 'var(--rule-2)' }}>
                <div className="h-1 rounded-full" style={{ background: 'var(--forest)', width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TopContactsPanel({ contacts }: { contacts: AnalyticsData['topContacts'] }) {
  const isSample = contacts.length === 0;
  const rows = isSample
    ? [
        { id: '1', label: 'Priya Sharma',   email: 'priya.sharma42@gmail.com',    count: 12 },
        { id: '2', label: 'Rohan Verma',    email: 'rohan.verma17@outlook.com',   count: 9 },
        { id: '3', label: 'Emily Johnson',  email: 'emily.j@yahoo.com',           count: 7 },
        { id: '4', label: 'Aditi Iyer',     email: 'aditi.iyer23@gmail.com',      count: 6 },
        { id: '5', label: 'Karan Kapoor',   email: 'karan.k11@icloud.com',        count: 5 },
        { id: '6', label: 'Meera Nair',     email: 'meera.nair@protonmail.com',   count: 4 },
      ]
    : contacts;
  return (
    <div style={{ opacity: isSample ? 0.75 : 1 }}>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Top contacts</h3>
        {isSample && <SampleTag />}
      </div>
      <ul className="space-y-2.5">
        {rows.map((c, i) => (
          <li
            key={c.id}
            className="flex items-baseline justify-between py-2"
            style={{ borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--rule-2)' }}
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
  const sentimentBreakdown = data.sentimentBreakdown ?? [];

  const resolutionLabel =
    summary.avgResolutionMinutes == null ? '—'
    : summary.avgResolutionMinutes < 60 ? `${summary.avgResolutionMinutes}m`
    : `${Math.round(summary.avgResolutionMinutes / 6) / 10}h`;

  return (
    <div className="space-y-14">
      {/* Primary KPI row: the numbers a support manager glances at first. */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8">
          <Stat
            label="Total conversations"
            value={summary.total ?? 0}
            caption={`Last ${data.period?.days ?? 30} days`}
          />
          <Stat
            label="Open now"
            value={summary.openNow ?? 0}
            emphasis="forest"
          />
          <Stat
            label="Resolved"
            value={(summary.aiResolved ?? 0) + (summary.agentResolved ?? 0)}
            caption={`${summary.agentResolved ?? 0} by agent · ${summary.aiResolved ?? 0} by AI`}
          />
          <Stat
            label="Escalation rate"
            value={`${summary.escalationRate ?? 0}%`}
            caption={`${summary.escalated ?? 0} escalated`}
            emphasis={(summary.escalationRate ?? 0) > 20 ? 'brick' : 'default'}
          />
        </div>
      </section>

      {/* Secondary readouts — response times and channel breakdown pie. */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-10">
        <div className="md:col-span-1 grid grid-cols-1 gap-y-6">
          <Stat label="First response" value={fmtMs(summary.avgFirstResponseMs)} caption="Agent replies" />
          <Stat label="Resolution time" value={resolutionLabel} caption="Open → resolved" />
        </div>
        <div className="md:col-span-2">
          <div className="pt-5" style={{ borderTop: '1px solid var(--rule)' }}>
            <div className="flex items-baseline justify-between mb-6">
              <p className="eyebrow">Conversations by channel</p>
              <p className="text-[11px] font-numeric" style={{ color: 'var(--dust)' }}>
                Last {data.period?.days ?? 30} days
              </p>
            </div>
            <ChannelPie data={channelSplit} />
          </div>
        </div>
      </section>

      {/* Volume chart */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Daily volume</h3>
          <p className="text-xs" style={{ color: 'var(--ash)' }}>
            {daily.length > 0 ? `${daily.length} days` : 'preview'}
          </p>
        </div>
        <div className="p-6 rounded-lg" style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}>
          <BarChart data={daily} />
        </div>
      </section>

      {/* Sentiment strip — one horizontal bar with each label as a segment,
          proportional to its share of conversations. Reads faster than a
          five-line list. */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>How customers are feeling</h3>
          <p className="text-xs" style={{ color: 'var(--ash)' }}>
            {sentimentBreakdown.reduce((s, r) => s + r.count, 0) > 0
              ? `${sentimentBreakdown.reduce((s, r) => s + r.count, 0)} classified`
              : 'preview'}
          </p>
        </div>
        <SentimentStrip data={sentimentBreakdown} />
      </section>

      {/* Top problems + top contacts, editorial two-column. Both fall back to
          a realistic sample when real data is empty so the panels never look
          broken — every sample is labeled so it can't be mistaken for real. */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <TopProblemsPanel topics={topTopics} />
        <TopContactsPanel contacts={topContacts} />
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
