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
      <div
        className="w-[22rem] flex flex-col"
        style={{ background: 'var(--paper)', borderRight: '1px solid var(--rule)' }}
      >
        <div className="px-5 pt-6 pb-4" style={{ borderBottom: '1px solid var(--rule)' }}>
          <h1 className="font-display text-3xl italic leading-none" style={{ color: 'var(--ink)' }}>
            Inbox
          </h1>
          <p className="text-xs mt-2 font-numeric" style={{ color: 'var(--ash)' }}>
            {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <InboxFilters />
        <ConversationList conversations={conversations} hasMore={hasMore} />
      </div>

      {/* Thread panel */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bone)' }}>
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
