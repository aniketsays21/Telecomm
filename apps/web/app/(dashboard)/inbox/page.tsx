import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { ConversationList } from '@/components/inbox/ConversationList';
import { RealtimeInbox } from '@/components/inbox/RealtimeInbox';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const session = await getSession();
  if (!session) return null;

  const { conversations, hasMore } = await api.listConversations(session.token, { status: 'open', limit: 30 });

  return (
    <div className="flex h-full">
      <RealtimeInbox token={session.token} />
      {/* Conversation list panel */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">Inbox</h1>
          <p className="text-xs text-gray-400 mt-0.5">{conversations.length} open conversation{conversations.length !== 1 ? 's' : ''}</p>
        </div>
        <ConversationList conversations={conversations} hasMore={hasMore} />
      </div>

      {/* Empty state when no conversation selected */}
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4">💬</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-1">Select a conversation</h2>
          <p className="text-sm text-gray-400">Click on a conversation to view messages and reply.</p>
        </div>
      </div>
    </div>
  );
}
