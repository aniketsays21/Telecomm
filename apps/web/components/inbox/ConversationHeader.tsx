'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Conversation, Contact } from '@/lib/api';
import { updateConversationAction } from '@/lib/actions';

type Props = {
  conversation: Conversation;
  contact: Contact;
};

export function ConversationHeader({ conversation, contact }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function resolve() {
    startTransition(async () => { await updateConversationAction(conversation.id, { status: 'resolved' }); router.refresh(); });
  }

  function reopen() {
    startTransition(async () => { await updateConversationAction(conversation.id, { status: 'open' }); router.refresh(); });
  }

  const isEscalated = !conversation.aiHandled && !!conversation.escalatedAt;

  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-white">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
          {(contact.name ?? contact.email ?? '?')[0].toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {contact.name ?? contact.email ?? 'Unknown visitor'}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {contact.email && (
              <span className="text-xs text-gray-400">{contact.email}</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              conversation.channel === 'chat'
                ? 'bg-blue-50 text-blue-600'
                : 'bg-yellow-50 text-yellow-700'
            }`}>
              {conversation.channel === 'chat' ? '💬 Chat' : '✉ Email'}
            </span>
            {isEscalated && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
                Needs agent
              </span>
            )}
            {conversation.aiHandled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">
                AI resolved
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {conversation.status !== 'resolved' ? (
          <button
            onClick={resolve}
            disabled={isPending}
            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? '…' : 'Resolve ✓'}
          </button>
        ) : (
          <button
            onClick={reopen}
            disabled={isPending}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? '…' : 'Reopen'}
          </button>
        )}
      </div>
    </div>
  );
}
