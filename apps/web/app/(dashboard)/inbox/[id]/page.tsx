import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { ReplyBox } from '@/components/inbox/ReplyBox';
import { ConversationHeader } from '@/components/inbox/ConversationHeader';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function ConversationPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return null;

  const [listResult, threadResult] = await Promise.allSettled([
    api.listConversations(session.token, { status: 'open', limit: 30 }),
    api.getConversation(session.token, id),
  ]);

  if (threadResult.status === 'rejected') notFound();

  const { conversations, hasMore } = listResult.status === 'fulfilled'
    ? listResult.value
    : { conversations: [], hasMore: false };

  const { conversation, contact, messages } = threadResult.value;

  return (
    <div className="flex h-full">
      {/* Conversation list panel */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">Inbox</h1>
          <p className="text-xs text-gray-400 mt-0.5">{conversations.length} open conversation{conversations.length !== 1 ? 's' : ''}</p>
        </div>
        <ConversationList conversations={conversations} hasMore={hasMore} />
      </div>

      {/* Thread panel */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        <ConversationHeader conversation={conversation} contact={contact} />

        <div className="flex-1 overflow-hidden">
          <MessageThread messages={messages} contact={contact} />
        </div>

        <ReplyBox
          conversationId={id}
          status={conversation.status}
        />
      </div>
    </div>
  );
}
