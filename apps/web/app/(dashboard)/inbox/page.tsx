import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { ConversationList } from '@/components/inbox/ConversationList';
import { InboxFilters } from '@/components/inbox/InboxFilters';
import { RealtimeInbox } from '@/components/inbox/RealtimeInbox';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ status?: string; channel?: string; q?: string }> };

export default async function InboxPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) return null;

  const { status = 'open', channel, q } = await searchParams;

  const { conversations, hasMore } = await api.listConversations(session.token, {
    status, channel, q, limit: 30,
  });

  return (
    <div className="flex h-full">
      <RealtimeInbox token={session.token} />

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

      {/* Empty state — editorial "select something" prompt */}
      <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bone)' }}>
        <div className="text-center max-w-sm px-6">
          <p className="eyebrow mb-4" style={{ color: 'var(--dust)' }}>Nothing selected</p>
          <h2 className="font-display text-4xl italic leading-tight" style={{ color: 'var(--ink)' }}>
            Pick a conversation to open the thread.
          </h2>
          <p className="text-sm mt-4" style={{ color: 'var(--ash)' }}>
            Your inbox on the left is ordered by most recent message.
          </p>
        </div>
      </div>
    </div>
  );
}
