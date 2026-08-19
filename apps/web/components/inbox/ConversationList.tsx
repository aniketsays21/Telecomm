'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ConversationSummary } from '@/lib/api';

function timeAgo(isoStr: string) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function slaStatus(slaDueAt: string | null): 'breached' | 'warning' | null {
  if (!slaDueAt) return null;
  const msLeft = new Date(slaDueAt).getTime() - Date.now();
  if (msLeft < 0) return 'breached';
  if (msLeft < 30 * 60 * 1000) return 'warning';
  return null;
}

type Props = {
  conversations: ConversationSummary[];
  hasMore: boolean;
};

export function ConversationList({ conversations, hasMore }: Props) {
  const pathname = usePathname();

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <span className="text-4xl mb-3">🎉</span>
        <p className="text-sm font-medium text-gray-700">All caught up!</p>
        <p className="text-xs text-gray-400 mt-1">No open conversations.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 overflow-y-auto h-full">
      {conversations.map(conv => {
        const isActive = pathname.endsWith(conv.id);
        const isEscalated = !conv.aiHandled && !!conv.escalatedAt;
        const sla = slaStatus(conv.slaDueAt);

        return (
          <Link
            key={conv.id}
            href={`/inbox/${conv.id}`}
            className={`block px-4 py-3.5 hover:bg-gray-50 transition-colors ${isActive ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''}`}
          >
            <div className="flex items-start gap-3">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600 shrink-0">
                {(conv.contact.name ?? conv.contact.email ?? '?')[0].toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {conv.contact.name ?? conv.contact.email ?? 'Unknown'}
                  </p>
                  <span className="text-xs text-gray-400 shrink-0 ml-2">{timeAgo(conv.lastMessageAt)}</span>
                </div>

                <p className="text-xs text-gray-500 truncate">
                  {conv.subject ?? (conv.channel === 'chat' ? 'Chat session' : 'Email')}
                </p>

                <div className="flex items-center gap-1.5 mt-1.5">
                  {/* Channel chip */}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    conv.channel === 'chat' ? 'bg-blue-50 text-blue-600' : 'bg-yellow-50 text-yellow-700'
                  }`}>
                    {conv.channel === 'chat' ? '💬 Chat' : '✉ Email'}
                  </span>

                  {/* Escalated badge */}
                  {isEscalated && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
                      Needs agent
                    </span>
                  )}

                  {/* AI handled */}
                  {conv.aiHandled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">
                      AI resolved
                    </span>
                  )}

                  {/* SLA badge */}
                  {sla === 'breached' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                      SLA breached
                    </span>
                  )}
                  {sla === 'warning' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                      SLA at risk
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        );
      })}

      {hasMore && (
        <div className="px-4 py-3 text-center">
          <span className="text-xs text-gray-400">Scroll for more…</span>
        </div>
      )}
    </div>
  );
}
