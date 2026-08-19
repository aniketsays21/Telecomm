'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ConversationSummary } from '@/lib/api';

function timeAgo(isoStr: string) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
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
      <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
        <p className="font-display text-2xl italic mb-1" style={{ color: 'var(--ink)' }}>
          Nothing waiting.
        </p>
        <p className="text-xs" style={{ color: 'var(--ash)' }}>
          You&apos;re fully caught up on this view.
        </p>
      </div>
    );
  }

  return (
    <ul className="overflow-y-auto h-full" style={{ background: 'var(--paper)' }}>
      {conversations.map((conv, i) => {
        const isActive = pathname.endsWith(conv.id);
        const isEscalated = !conv.aiHandled && !!conv.escalatedAt;
        const sla = slaStatus(conv.slaDueAt);
        const displayName = conv.contact.name ?? conv.contact.email ?? 'Unknown';

        return (
          <li key={conv.id}>
            <Link
              href={`/inbox/${conv.id}`}
              className="block px-5 py-4 transition-colors"
              style={{
                background: isActive ? 'var(--bone)' : 'transparent',
                borderTop: i === 0 ? 'none' : '1px solid var(--rule-2)',
                borderLeft: isActive ? '2px solid var(--forest)' : '2px solid transparent',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--rule-2)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <p
                  className="text-sm truncate"
                  style={{
                    color: 'var(--ink)',
                    fontWeight: isActive ? 600 : 500,
                  }}
                >
                  {displayName}
                </p>
                <span className="font-numeric text-[11px] shrink-0" style={{ color: 'var(--dust)' }}>
                  {timeAgo(conv.lastMessageAt)}
                </span>
              </div>

              <p className="text-xs truncate mb-2" style={{ color: 'var(--ash)' }}>
                {conv.subject ?? (conv.channel === 'chat' ? 'Chat session' : 'Email')}
              </p>

              <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--ash)' }}>
                <span style={{ color: 'var(--dust)' }}>
                  {conv.channel === 'chat' ? 'Chat' : 'Email'}
                </span>

                {isEscalated && (
                  <span className="status-dot" style={{ color: 'var(--brick)' }}>Needs agent</span>
                )}
                {conv.aiHandled && !isEscalated && (
                  <span className="status-dot" style={{ color: 'var(--forest)' }}>AI handled</span>
                )}
                {sla === 'breached' && (
                  <span className="status-dot font-numeric" style={{ color: 'var(--brick)' }}>SLA over</span>
                )}
                {sla === 'warning' && (
                  <span className="status-dot font-numeric" style={{ color: 'var(--ochre)' }}>SLA close</span>
                )}
              </div>
            </Link>
          </li>
        );
      })}

      {hasMore && (
        <li
          className="px-5 py-3 text-center text-[11px]"
          style={{ color: 'var(--dust)', borderTop: '1px solid var(--rule-2)' }}
        >
          Scroll for more
        </li>
      )}
    </ul>
  );
}
