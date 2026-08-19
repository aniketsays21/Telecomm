import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { DomainsPanel } from '@/components/settings/DomainsPanel';

export const dynamic = 'force-dynamic';

export default async function DomainsPage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  const data = await api.listDomains(session.token).catch(() => ({ domains: [], cnameTarget: 'domains.telecomm.io' }));

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Custom domains</h1>
      <p className="text-gray-500 mb-8">
        Host your knowledge base at your own subdomain, e.g.{' '}
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">help.yourbrand.com</code>.
      </p>
      <DomainsPanel initial={data.domains} cnameTarget={data.cnameTarget} />
    </div>
  );
}
