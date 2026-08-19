import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard';
import { EmptyDashboard } from '@/components/analytics/EmptyDashboard';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ days?: string }> };

export default async function AnalyticsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { days: daysStr } = await searchParams;
  const days = Math.min(Number(daysStr ?? 30), 90);

  let data: Awaited<ReturnType<typeof api.getAnalytics>> | null = null;
  let loadError: string | null = null;
  try {
    data = await api.getAnalytics(session.token, days);
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Failed to load analytics';
  }

  return (
    <div className="max-w-6xl mx-auto pt-12 pb-16 px-10">
      <div className="flex items-end justify-between mb-12 pb-6" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div>
          <p className="eyebrow">Dashboard · Last {days} days</p>
          <h1 className="font-display text-5xl italic leading-none mt-3" style={{ color: 'var(--ink)' }}>
            How things are going.
          </h1>
        </div>
        <div className="flex items-center gap-4 text-xs font-numeric" style={{ color: 'var(--ash)' }}>
          {[7, 30, 90].map((d, i) => (
            <span key={d} className="flex items-center gap-3">
              {i > 0 && <span style={{ color: 'var(--rule)' }}>·</span>}
              <a
                href={`/analytics?days=${d}`}
                className="transition-colors"
                style={{
                  color: days === d ? 'var(--ink)' : 'var(--ash)',
                  fontWeight: days === d ? 500 : 400,
                  textDecoration: days === d ? 'underline' : 'none',
                  textUnderlineOffset: '4px',
                }}
              >
                {d} days
              </a>
            </span>
          ))}
        </div>
      </div>
      {loadError && (
        <div
          className="mb-8 p-5"
          style={{ background: 'var(--brick-soft)', border: '1px solid #E4C0B4' }}
        >
          <p className="eyebrow" style={{ color: 'var(--brick)' }}>Couldn&apos;t load analytics</p>
          <p className="text-sm mt-2 break-all" style={{ color: 'var(--ink)' }}>{loadError}</p>
          <p className="text-xs mt-2" style={{ color: 'var(--ash)' }}>
            Common causes: the API service was redeployed with a newer schema than the DB,
            or the request timed out. Check the API service logs on Railway.
          </p>
        </div>
      )}
      {data && ((data.summary?.total ?? 0) === 0
        ? <EmptyDashboard />
        : <AnalyticsDashboard initial={data} />
      )}
    </div>
  );
}
