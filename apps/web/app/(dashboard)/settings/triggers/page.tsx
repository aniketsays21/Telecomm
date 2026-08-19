import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { TriggersPanel } from '@/components/settings/TriggersPanel';

export const dynamic = 'force-dynamic';

export default async function TriggersPage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  const data = await api.listTriggers(session.token).catch(() => ({ triggers: [] }));

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Proactive triggers</h1>
      <p className="text-gray-500 mb-8">
        Open the chat with a greeting when a visitor lingers on a page — a common way to lift widget engagement 3–5x
        on checkout, pricing, and doc pages.
      </p>
      <TriggersPanel initial={data.triggers} />
    </div>
  );
}
