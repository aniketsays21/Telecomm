'use client';

import { useState } from 'react';
import type { Contact, Conversation } from '@/lib/api';

interface Props {
  contact: Contact;
  conversation: Conversation;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5 break-all">{value}</p>
    </div>
  );
}

export function ContactSidebar({ contact, conversation }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`border-l border-gray-200 bg-white flex flex-col transition-all duration-200 ${open ? 'w-64' : 'w-10'}`}>
      {/* Toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center h-10 w-10 shrink-0 text-gray-400 hover:text-gray-700 hover:bg-gray-50 border-b border-gray-100"
        title={open ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {open
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />}
        </svg>
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Contact */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contact</p>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-indigo-700">
                  {(contact.name ?? contact.email ?? '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{contact.name ?? '—'}</p>
                <p className="text-xs text-gray-500 truncate">{contact.email ?? '—'}</p>
              </div>
            </div>
            <div className="space-y-3">
              <Row label="External ID" value={contact.externalId} />
              <Row label="First seen" value={relativeTime(contact.firstSeenAt)} />
              <Row label="Last seen" value={relativeTime(contact.lastSeenAt)} />
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Conversation */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conversation</p>
            <div className="space-y-3">
              <Row label="Channel" value={conversation.channel} />
              <Row label="Status" value={conversation.status} />
              <div>
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Created</p>
                <p className="text-sm text-gray-800 mt-0.5">{relativeTime(conversation.createdAt)}</p>
              </div>
              {conversation.escalatedAt && (
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Escalated</p>
                  <p className="text-sm text-red-600 mt-0.5">{relativeTime(conversation.escalatedAt)}</p>
                  {conversation.escalationReason && (
                    <p className="text-xs text-gray-500 mt-0.5">{conversation.escalationReason}</p>
                  )}
                </div>
              )}
              {conversation.tags.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {conversation.tags.map(t => (
                      <span key={t} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {typeof conversation.priority === 'number' && (
                <Row label="Priority" value={conversation.priority === 0 ? 'Normal' : conversation.priority > 0 ? 'High' : 'Low'} />
              )}
              {conversation.sentiment && (
                <Row label="Sentiment" value={conversation.sentiment} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
