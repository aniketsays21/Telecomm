import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { CannedManager } from '@/components/canned/CannedManager';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CannedResponsesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { responses } = await api.listCannedResponses(session.token);

  return (
    <div className="max-w-2xl mx-auto py-10 px-6">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900">Canned Responses</h1>
        <p className="text-sm text-gray-500 mt-1">
          Save frequently-used replies. Type <kbd className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">/</kbd> in the reply box to search and insert them.
        </p>
      </div>
      <CannedManager responses={responses} />
    </div>
  );
}
