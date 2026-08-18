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
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function MessageThread({ messages, contact }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No messages yet.
      </div>
    );
  }

  let lastDate = '';

  return (
    <div className="flex flex-col gap-3 p-5 overflow-y-auto h-full">
      {messages.map(msg => {
        const dateLabel = formatDate(msg.createdAt);
        const showDate = dateLabel !== lastDate;
        if (showDate) lastDate = dateLabel;

        const isContact = msg.authorType === 'contact';
        const isAI = msg.authorType === 'ai';
        const isAgent = msg.authorType === 'agent';
        const isSystem = msg.authorType === 'system';

        return (
          <div key={msg.id}>
            {showDate && (
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-400">{dateLabel}</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
            )}

            {isSystem ? (
              <p className="text-xs text-center text-gray-400 my-1">{msg.body}</p>
            ) : (
              <div className={`flex gap-2.5 ${isContact ? '' : 'flex-row-reverse'}`}>
                {/* Avatar */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isContact ? 'bg-gray-200 text-gray-600' :
                  isAI ? 'bg-indigo-100 text-indigo-600' :
                  'bg-emerald-100 text-emerald-700'
                }`}>
                  {isContact ? (contact.name ?? '?')[0].toUpperCase() :
                   isAI ? '🤖' : '👤'}
                </div>

                <div className={`max-w-[70%] ${isContact ? '' : 'items-end'} flex flex-col`}>
                  {/* Bubble */}
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    isContact
                      ? 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
                      : isAI
                      ? 'bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-tr-sm'
                      : 'bg-emerald-600 text-white rounded-tr-sm'
                  } ${msg.isInternalNote ? 'opacity-70 border-dashed' : ''}`}>
                    {msg.body}
                  </div>

                  {/* Meta row */}
                  <div className={`flex items-center gap-2 mt-1 ${isContact ? '' : 'flex-row-reverse'}`}>
                    <span className="text-[10px] text-gray-400">{formatTime(msg.createdAt)}</span>
                    {isAI && msg.aiConfidence && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        parseFloat(msg.aiConfidence) >= 0.8 ? 'bg-green-50 text-green-600' :
                        parseFloat(msg.aiConfidence) >= 0.6 ? 'bg-yellow-50 text-yellow-600' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {Math.round(parseFloat(msg.aiConfidence) * 100)}% confident
                      </span>
                    )}
                    {msg.isInternalNote && (
                      <span className="text-[10px] text-gray-400 italic">internal note</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
