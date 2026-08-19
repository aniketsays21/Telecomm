'use client';

import { useRef, useEffect } from 'react';
import type { Message, Contact } from '@/lib/api';

type Props = {
  messages: Message[];
  contact: Contact;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function authorLabel(t: Message['authorType'], contact: Contact): string {
  if (t === 'contact') return contact.name || contact.email || 'Visitor';
  if (t === 'ai') return 'AI assistant';
  if (t === 'agent') return 'You';
  return 'System';
}

export function MessageThread({ messages, contact }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm" style={{ color: 'var(--dust)' }}>No messages yet.</p>
      </div>
    );
  }

  let lastDate = '';

  return (
    <div className="overflow-y-auto h-full px-8 py-6" style={{ background: 'var(--bone)' }}>
      <div className="max-w-2xl mx-auto space-y-6">
        {messages.map((msg) => {
          const dateLabel = formatDate(msg.createdAt);
          const showDate = dateLabel !== lastDate;
          if (showDate) lastDate = dateLabel;

          if (msg.authorType === 'system') {
            return (
              <p
                key={msg.id}
                className="text-center text-[11px] italic"
                style={{ color: 'var(--dust)' }}
              >
                {msg.body}
              </p>
            );
          }

          const isContact = msg.authorType === 'contact';
          const isAI = msg.authorType === 'ai';
          const isAgent = msg.authorType === 'agent';
          const label = authorLabel(msg.authorType, contact);

          // Uniform layout: everyone gets an eyebrow (author · time), then the
          // message body. No colored bubbles — the alignment + eyebrow color
          // is enough signal, and it reads like a magazine transcript.
          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex items-center gap-4 my-8">
                  <div className="flex-1 h-px" style={{ background: 'var(--rule)' }} />
                  <span
                    className="font-numeric text-[10px] uppercase tracking-widest"
                    style={{ color: 'var(--dust)' }}
                  >
                    {dateLabel}
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'var(--rule)' }} />
                </div>
              )}

              <article className={isContact ? '' : 'text-right'}>
                <div
                  className="flex items-baseline gap-2 mb-1.5 text-[11px]"
                  style={{
                    color: 'var(--ash)',
                    justifyContent: isContact ? 'flex-start' : 'flex-end',
                  }}
                >
                  <span
                    className="status-dot font-medium"
                    style={{
                      color: isContact ? 'var(--sky)' : isAI ? 'var(--forest)' : 'var(--ink)',
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ color: 'var(--rule)' }}>·</span>
                  <span className="font-numeric" style={{ color: 'var(--dust)' }}>
                    {formatTime(msg.createdAt)}
                  </span>
                  {isAI && msg.aiConfidence && (
                    <>
                      <span style={{ color: 'var(--rule)' }}>·</span>
                      <span className="font-numeric" style={{ color: 'var(--dust)' }}>
                        {Math.round(parseFloat(msg.aiConfidence) * 100)}% conf
                      </span>
                    </>
                  )}
                  {msg.isInternalNote && (
                    <>
                      <span style={{ color: 'var(--rule)' }}>·</span>
                      <span className="italic" style={{ color: 'var(--ochre)' }}>internal</span>
                    </>
                  )}
                </div>

                <div
                  className="inline-block max-w-full text-sm leading-relaxed whitespace-pre-wrap text-left"
                  style={{
                    color: 'var(--ink)',
                    background: msg.isInternalNote ? 'var(--ochre-soft)' : 'var(--paper)',
                    border: '1px solid ' + (msg.isInternalNote ? '#E8D9AE' : 'var(--rule-2)'),
                    borderLeft: isAgent && !msg.isInternalNote ? '2px solid var(--ink)'
                      : isAI ? '2px solid var(--forest)'
                      : isContact ? '2px solid var(--sky)'
                      : '1px solid var(--rule-2)',
                    padding: '12px 16px',
                    borderRadius: '2px',
                  }}
                >
                  {msg.body}
                </div>
              </article>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
