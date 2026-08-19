import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { KbSourceList } from '@/components/knowledge/KbSourceList';
import { AddSourceForm } from '@/components/knowledge/AddSourceForm';
import { SeedSampleButton } from '@/components/knowledge/SeedSampleButton';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/inbox');

  const { sources } = await api.listSources(session.token).catch(() => ({ sources: [] }));

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Sources are chunked, indexed, and searched by the AI when answering customer questions.
          </p>
        </div>
        <SeedSampleButton />
      </div>

      {/* Source list */}
      {sources.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center mb-6">
          <div className="text-4xl mb-3">📚</div>
          <h2 className="text-lg font-semibold text-gray-700">No knowledge sources yet</h2>
          <p className="text-sm text-gray-500 mt-1">
            Add a website URL or paste in help content below to get started.
          </p>
        </div>
      ) : (
        <KbSourceList sources={sources} />
      )}

      {/* Add source */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Add knowledge source</h2>
        <AddSourceForm />
      </div>
    </div>
  );
}
