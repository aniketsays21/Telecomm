'use client';

import { useState, useTransition, useRef } from 'react';
import type { Contact, Conversation, ConversationInsight } from '@/lib/api';
import { updateConversationAction } from '@/lib/actions';

interface Props {
  contact: Contact;
  conversation: Conversation;
  summary?: ConversationInsight | null;
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

function TagsEditor({ conversation }: { conversation: Conversation }) {
  const [tags, setTags] = useState<string[]>(conversation.tags);
  const [input, setInput] = useState('');
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function save(next: string[]) {
    setTags(next);
    startTransition(() => updateConversationAction(conversation.id, { tags: next }));
  }

  function addTag() {
    const trimmed = input.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed || tags.includes(trimmed)) { setInput(''); return; }
    save([...tags, trimmed]);
    setInput('');
  }

  function removeTag(t: string) {
    save(tags.filter(x => x !== t));
  }

  return (
    <div>
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Tags</p>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {tags.map(t => (
          <span key={t} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full">
            {t}
            <button
              onClick={() => removeTag(t)}
              className="ml-0.5 text-indigo-400 hover:text-indigo-700 leading-none"
              title={`Remove ${t}`}
            >×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          placeholder="Add tag…"
          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-400 min-w-0"
          disabled={isPending}
        />
        <button
          onClick={addTag}
          disabled={isPending || !input.trim()}
          className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100 disabled:opacity-40"
        >+</button>
      </div>
    </div>
  );
}

export function ContactSidebar({ contact, conversation, summary }: Props) {
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
          {/* AI summary */}
          {summary && (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">AI Summary</p>
                <p className="text-sm text-gray-800 leading-snug">{summary.summary}</p>
                <div className="mt-3 space-y-2">
                  {summary.whatCustomerWants && (
                    <div>
                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">What they want</p>
                      <p className="text-xs text-gray-700 mt-0.5 leading-snug">{summary.whatCustomerWants}</p>
                    </div>
                  )}
                  {summary.whatsBeenTried && (
                    <div>
                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">What's been tried</p>
                      <p className="text-xs text-gray-700 mt-0.5 leading-snug">{summary.whatsBeenTried}</p>
                    </div>
                  )}
                  {summary.currentStatus && (
                    <div>
                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Current status</p>
                      <p className="text-xs text-gray-700 mt-0.5 leading-snug">{summary.currentStatus}</p>
                    </div>
                  )}
                  {summary.keyDetails && summary.keyDetails.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Key details</p>
                      <ul className="text-xs text-gray-700 mt-0.5 space-y-0.5 list-disc list-inside">
                        {summary.keyDetails.map((d, i) => (
                          <li key={i} className="leading-snug">{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">Updated {relativeTime(summary.updatedAt)}</p>
              </div>
              <hr className="border-gray-100" />
            </>
          )}

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
              <TagsEditor conversation={conversation} />
              {typeof conversation.priority === 'number' && (
                <Row label="Priority" value={conversation.priority === 0 ? 'Normal' : conversation.priority > 0 ? 'High' : 'Low'} />
              )}
              {conversation.sentiment && (
                <Row label="Sentiment" value={conversation.sentiment} />
              )}
              {typeof conversation.csatRating === 'number' && (
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">CSAT</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-amber-400 text-base leading-none">
                      {'★'.repeat(conversation.csatRating)}{'☆'.repeat(5 - conversation.csatRating)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][conversation.csatRating]}
                    </span>
                  </div>
                  {conversation.csatComment && (
                    <p className="text-xs text-gray-500 mt-1 italic">"{conversation.csatComment}"</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
