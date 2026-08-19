import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { WebhooksPanel } from '@/components/settings/WebhooksPanel';

export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  const data = await api.listWebhooks(session.token).catch(() => ({ webhooks: [], events: [] as string[] }));

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Webhooks</h1>
      <p className="text-gray-500 mb-8">
        Send Telecomm events to your own systems — CRM, ticketing, Slack, whatever fits.
        Every delivery is HMAC-signed so you can verify it came from us.
      </p>
      <WebhooksPanel initialWebhooks={data.webhooks} events={data.events} />
    </div>
  );
}
