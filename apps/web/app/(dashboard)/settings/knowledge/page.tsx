import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function KnowledgePage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Knowledge Base</h1>
      <p className="text-gray-500 mb-8">Connect data sources and manage help articles. Coming in Phase 1.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="text-4xl mb-3">📚</div>
        <h2 className="text-lg font-semibold text-gray-700">Knowledge base setup</h2>
        <p className="text-sm text-gray-500 mt-1">Article editor, source connectors, and embedding pipeline coming next.</p>
      </div>
    </div>
  );
}
