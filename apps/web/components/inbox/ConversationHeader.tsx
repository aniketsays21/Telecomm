'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Conversation, Contact } from '@/lib/api';
import { updateConversationAction } from '@/lib/actions';

type Agent = { id: string; name: string; email: string };

type Props = {
  conversation: Conversation;
  contact: Contact;
  agents?: Agent[];
};

export function ConversationHeader({ conversation, contact, agents = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function resolve() {
    startTransition(async () => {
      await updateConversationAction(conversation.id, { status: 'resolved' });
      router.refresh();
    });
  }
  function reopen() {
    startTransition(async () => {
      await updateConversationAction(conversation.id, { status: 'open' });
      router.refresh();
    });
  }
  function assign(agentId: string | null) {
    startTransition(async () => {
      await updateConversationAction(conversation.id, { assigneeId: agentId });
      router.refresh();
    });
  }

  const isEscalated = !conversation.aiHandled && !!conversation.escalatedAt;
  const displayName = contact.name ?? contact.email ?? 'Unknown visitor';

  return (
    <div
      className="flex items-center justify-between px-6 py-4"
      style={{ background: 'var(--paper)', borderBottom: '1px solid var(--rule)' }}
    >
      <div className="min-w-0">
        <h2 className="font-display text-xl leading-none mb-1.5" style={{ color: 'var(--ink)' }}>
          {displayName}
        </h2>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ash)' }}>
          {contact.email && (
            <span className="truncate">{contact.email}</span>
          )}
          <span style={{ color: 'var(--rule)' }}>·</span>
          <span>{conversation.channel === 'chat' ? 'Chat' : 'Email'}</span>
          {isEscalated && (
            <>
              <span style={{ color: 'var(--rule)' }}>·</span>
              <span className="status-dot" style={{ color: 'var(--brick)' }}>Needs agent</span>
            </>
          )}
          {conversation.aiHandled && !isEscalated && (
            <>
              <span style={{ color: 'var(--rule)' }}>·</span>
              <span className="status-dot" style={{ color: 'var(--forest)' }}>AI handled</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {agents.length > 0 && (
          <select
            value={conversation.assigneeId ?? ''}
            onChange={(e) => assign(e.target.value || null)}
            disabled={isPending}
            className="text-xs px-2.5 py-1.5 bg-transparent focus:outline-none appearance-none pr-6"
            style={{
              color: 'var(--ash)',
              borderBottom: '1px solid var(--rule)',
              // Custom caret so the select doesn't look like a form default
              backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--ash) 50%), linear-gradient(135deg, var(--ash) 50%, transparent 50%)',
              backgroundPosition: 'calc(100% - 12px) 50%, calc(100% - 8px) 50%',
              backgroundSize: '4px 4px, 4px 4px',
              backgroundRepeat: 'no-repeat',
            }}
          >
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name || a.email}</option>
            ))}
          </select>
        )}

        {conversation.status !== 'resolved' ? (
          <button onClick={resolve} disabled={isPending} className="btn-ink">
            {isPending ? '…' : 'Resolve'}
          </button>
        ) : (
          <button onClick={reopen} disabled={isPending} className="btn-ghost">
            {isPending ? '…' : 'Reopen'}
          </button>
        )}
      </div>
    </div>
  );
}
