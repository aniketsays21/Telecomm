import { getSession } from '@/lib/session';

export default async function InboxPage() {
  const session = await getSession();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Inbox</h1>
      <p className="text-gray-500 mb-8">Conversations will appear here once the chat widget and email channel are connected.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="text-4xl mb-3">💬</div>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">No conversations yet</h2>
        <p className="text-sm text-gray-500">
          {session?.role === 'admin'
            ? 'Set up your knowledge base and paste the widget on your site to start receiving messages.'
            : 'Conversations assigned to you will appear here.'}
        </p>
      </div>
    </div>
  );
}
