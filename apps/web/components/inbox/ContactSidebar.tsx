'use client';

import { useState, useTransition, useRef } from 'react';
import type { Contact, Conversation, ConversationInsight, PageView } from '@/lib/api';
import { updateConversationAction } from '@/lib/actions';

interface Props {
  contact: Contact;
  conversation: Conversation;
  summary?: ConversationInsight | null;
  journey?: PageView[];
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

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

// A single labeled field with an eyebrow above the value.
function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p
        className={`text-sm mt-1 break-all ${mono ? 'font-numeric' : ''}`}
        style={{ color: 'var(--ink)' }}
      >
        {value}
      </p>
    </div>
  );
}

// Section separator — an eyebrow followed by a hairline under it.
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="eyebrow">{children}</p>
      <div className="h-px mt-1.5" style={{ background: 'var(--rule)' }} />
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
  function removeTag(t: string) { save(tags.filter((x) => x !== t)); }

  return (
    <div>
      <p className="eyebrow mb-2">Tags</p>
      <div className="flex flex-wrap gap-1 mb-2">
        {tags.length === 0 && (
          <span className="text-xs italic" style={{ color: 'var(--dust)' }}>none</span>
        )}
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 font-numeric"
            style={{
              color: 'var(--forest)',
              background: 'var(--forest-soft)',
              border: '1px solid #CFD8CF',
              borderRadius: '2px',
            }}
          >
            {t}
            <button
              onClick={() => removeTag(t)}
              style={{ color: 'var(--forest)', opacity: 0.5 }}
              title={`Remove ${t}`}
            >×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          placeholder="Add tag…"
          className="input-flat flex-1 py-1 text-xs"
          disabled={isPending}
        />
        <button
          onClick={addTag}
          disabled={isPending || !input.trim()}
          className="btn-ghost text-xs py-1"
        >
          +
        </button>
      </div>
    </div>
  );
}

function JourneySection({ views }: { views: PageView[] }) {
  if (!views.length) return null;
  return (
    <section>
      <SectionTitle>Recent pages</SectionTitle>
      <ol className="space-y-3">
        {views.slice(0, 12).map((v, i) => (
          <li key={v.id} className="relative pl-5">
            {/* Timeline dot + line */}
            <span
              className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--forest)' }}
            />
            {i < views.slice(0, 12).length - 1 && (
              <span
                className="absolute left-[3px] top-3 bottom-[-8px] w-px"
                style={{ background: 'var(--rule)' }}
              />
            )}
            <a
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs link-underline truncate"
              title={v.url}
              style={{ color: 'var(--ink)' }}
            >
              {v.title || v.path || v.url}
            </a>
            <p className="text-[11px] mt-0.5 truncate font-numeric" style={{ color: 'var(--dust)' }}>
              {hostOf(v.url)}{v.path} · {relativeTime(v.viewedAt)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ContactSidebar({ contact, conversation, summary, journey }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <aside
      className="flex flex-col transition-all duration-200"
      style={{
        width: open ? '17rem' : '2.5rem',
        background: 'var(--paper)',
        borderLeft: '1px solid var(--rule)',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center h-10 w-10 shrink-0 transition-colors"
        style={{ color: 'var(--ash)', borderBottom: '1px solid var(--rule)' }}
        title={open ? 'Collapse' : 'Expand'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {open
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />}
        </svg>
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
          {/* AI Summary — editorial pull-quote style */}
          {summary && (
            <section>
              <SectionTitle>AI Summary</SectionTitle>
              <p
                className="font-display text-lg leading-snug italic"
                style={{ color: 'var(--ink)' }}
              >
                &ldquo;{summary.summary}&rdquo;
              </p>
              <div className="mt-4 space-y-3">
                <Field label="What they want" value={summary.whatCustomerWants} />
                <Field label="What&apos;s been tried" value={summary.whatsBeenTried} />
                <Field label="Current status" value={summary.currentStatus} />
                {summary.keyDetails && summary.keyDetails.length > 0 && (
                  <div>
                    <p className="eyebrow">Key details</p>
                    <ul className="text-xs mt-1 space-y-1" style={{ color: 'var(--ink)' }}>
                      {summary.keyDetails.map((d, i) => (
                        <li key={i} className="flex gap-2">
                          <span style={{ color: 'var(--forest)' }}>—</span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p className="text-[11px] mt-3 font-numeric" style={{ color: 'var(--dust)' }}>
                Updated {relativeTime(summary.updatedAt)}
              </p>
            </section>
          )}

          {/* Journey */}
          {journey && <JourneySection views={journey} />}

          {/* Contact */}
          <section>
            <SectionTitle>Contact</SectionTitle>
            <p className="font-display text-xl" style={{ color: 'var(--ink)' }}>
              {contact.name ?? '—'}
            </p>
            {contact.email && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--ash)' }}>{contact.email}</p>
            )}
            <div className="mt-4 space-y-3">
              <Field label="External ID" value={contact.externalId} mono />
              <Field label="First seen" value={relativeTime(contact.firstSeenAt)} />
              <Field label="Last seen" value={relativeTime(contact.lastSeenAt)} />
            </div>
          </section>

          {/* Conversation */}
          <section>
            <SectionTitle>Conversation</SectionTitle>
            <div className="space-y-3">
              <Field label="Channel" value={conversation.channel} />
              <Field label="Status" value={conversation.status} />
              <Field label="Created" value={relativeTime(conversation.createdAt)} />
              {conversation.escalatedAt && (
                <div>
                  <p className="eyebrow">Escalated</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--brick)' }}>
                    {relativeTime(conversation.escalatedAt)}
                  </p>
                  {conversation.escalationReason && (
                    <p className="text-xs mt-1" style={{ color: 'var(--ash)' }}>
                      {conversation.escalationReason}
                    </p>
                  )}
                </div>
              )}
              <TagsEditor conversation={conversation} />
              {conversation.sentiment && (
                <Field label="Sentiment" value={conversation.sentiment} />
              )}
              {typeof conversation.csatRating === 'number' && (
                <div>
                  <p className="eyebrow mb-1">CSAT</p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-2xl" style={{ color: 'var(--ochre)' }}>
                      {conversation.csatRating}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--ash)' }}>
                      of 5 · {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][conversation.csatRating]}
                    </span>
                  </div>
                  {conversation.csatComment && (
                    <p
                      className="text-xs italic mt-2 pl-3"
                      style={{ color: 'var(--ash)', borderLeft: '2px solid var(--rule)' }}
                    >
                      &ldquo;{conversation.csatComment}&rdquo;
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
