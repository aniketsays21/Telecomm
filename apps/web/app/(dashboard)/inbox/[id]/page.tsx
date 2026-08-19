import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { ConversationList } from '@/components/inbox/ConversationList';
import { InboxFilters } from '@/components/inbox/InboxFilters';
import { MessageThread } from '@/components/inbox/MessageThread';
import { ReplyBox } from '@/components/inbox/ReplyBox';
import { ConversationHeader } from '@/components/inbox/ConversationHeader';
import { RealtimeInbox } from '@/components/inbox/RealtimeInbox';
import { ContactSidebar } from '@/components/inbox/ContactSidebar';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; channel?: string; q?: string }> };

export default async function ConversationPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { status = 'open', channel, q } = await searchParams;
  const session = await getSession();
  if (!session) return null;

  const [listResult, threadResult, cannedResult, usersResult] = await Promise.allSettled([
    api.listConversations(session.token, { status, channel, q, limit: 30 }),
    api.getConversation(session.token, id),
    api.listCannedResponses(session.token),
    api.listUsers(session.token),
  ]);

  if (threadResult.status === 'rejected') notFound();

  const { conversations, hasMore } = listResult.status === 'fulfilled'
    ? listResult.value
    : { conversations: [], hasMore: false };

  const { conversation, contact, messages, summary, journey } = threadResult.value;
  const cannedResponses = cannedResult.status === 'fulfilled' ? cannedResult.value.responses : [];
  const agents = usersResult.status === 'fulfilled' ? usersResult.value : [];

  return (
    <div className="flex h-full">
      <RealtimeInbox token={session.token} />
      {/* Conversation list panel */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">Inbox</h1>
          <p className="text-xs text-gray-400 mt-0.5">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</p>
        </div>
        <InboxFilters />
        <ConversationList conversations={conversations} hasMore={hasMore} />
      </div>

      {/* Thread panel */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        <ConversationHeader conversation={conversation} contact={contact} agents={agents} />

        <div className="flex-1 overflow-hidden">
          <MessageThread messages={messages} contact={contact} />
        </div>

        <ReplyBox
          conversationId={id}
          status={conversation.status}
          cannedResponses={cannedResponses}
        />
      </div>

      {/* Contact/conversation details sidebar */}
      <ContactSidebar contact={contact} conversation={conversation} summary={summary} journey={journey} />
    </div>
  );
}
