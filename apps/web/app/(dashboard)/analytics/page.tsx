import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ days?: string }> };

export default async function AnalyticsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { days: daysStr } = await searchParams;
  const days = Math.min(Number(daysStr ?? 30), 90);

  const data = await api.getAnalytics(session.token, days);

  return (
    <div className="max-w-5xl mx-auto py-10 px-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">AI performance and conversation volume.</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map(d => (
            <a
              key={d}
              href={`/analytics?days=${d}`}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                days === d
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {d}d
            </a>
          ))}
        </div>
      </div>
      <AnalyticsDashboard initial={data} />
    </div>
  );
}
