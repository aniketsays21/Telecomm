'use client';

import { useState, useRef, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessageAction, updateConversationAction, suggestReplyAction } from '@/lib/actions';
import type { CannedResponse } from '@/lib/api';

type Props = {
  conversationId: string;
  status: 'open' | 'snoozed' | 'resolved';
  cannedResponses?: CannedResponse[];
};

export function ReplyBox({ conversationId, status, cannedResponses = [] }: Props) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerIndex, setPickerIndex] = useState(0);

  // AI draft state — sources travel with the draft so the agent can see (and
  // click through to verify) the KB articles the AI leaned on.
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestSources, setSuggestSources] = useState<Array<{ title: string; url: string | null }>>([]);

  async function suggest() {
    setSuggestError(null);
    setIsSuggesting(true);
    try {
      const res = await suggestReplyAction(conversationId);
      if ('error' in res) {
        setSuggestError(res.error);
        return;
      }
      setText(res.draft);
      setSuggestSources(res.sources);
      // Focus + move caret to end so the agent can start editing immediately.
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        setTimeout(() => { ta.selectionStart = ta.selectionEnd = ta.value.length; }, 0);
      }
    } finally {
      setIsSuggesting(false);
    }
  }

  const filteredCanned = cannedResponses.filter((r) => {
    if (!pickerQuery) return true;
    const q = pickerQuery.toLowerCase();
    return r.title.toLowerCase().includes(q)
      || (r.tags?.[0] ?? '').toLowerCase().includes(q)
      || r.body.toLowerCase().includes(q);
  }).slice(0, 6);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (val.startsWith('/') && !val.includes('\n')) {
      setPickerQuery(val.slice(1));
      setShowPicker(true);
      setPickerIndex(0);
    } else {
      setShowPicker(false);
    }
  }, []);

  const insertCanned = useCallback((r: CannedResponse) => {
    setText(r.body);
    setShowPicker(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  async function send() {
    if (!text.trim()) return;
    startTransition(async () => {
      await sendMessageAction(conversationId, text.trim(), isNote);
      setText('');
      router.refresh();
    });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (showPicker) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex((i) => Math.min(i + 1, filteredCanned.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredCanned[pickerIndex]) insertCanned(filteredCanned[pickerIndex]);
        return;
      }
      if (e.key === 'Escape') { setShowPicker(false); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  async function resolve() {
    startTransition(async () => {
      await updateConversationAction(conversationId, { status: 'resolved' });
      router.refresh();
    });
  }

  if (status === 'resolved') {
    return (
      <div
        className="px-6 py-5 text-center"
        style={{ background: 'var(--paper)', borderTop: '1px solid var(--rule)' }}
      >
        <p className="text-sm mb-2" style={{ color: 'var(--ash)' }}>
          This conversation is <span style={{ color: 'var(--forest)' }} className="status-dot">resolved</span>.
        </p>
        <button
          onClick={() => startTransition(async () => { await updateConversationAction(conversationId, { status: 'open' }); router.refresh(); })}
          className="text-sm link-underline"
          style={{ color: 'var(--forest)' }}
        >
          Reopen conversation
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ background: 'var(--paper)', borderTop: '1px solid var(--rule)' }}
    >
      {/* Canned response picker */}
      {showPicker && filteredCanned.length > 0 && (
        <div
          className="absolute bottom-full left-0 right-0 z-10 overflow-hidden shadow-lg"
          style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}
        >
          <div
            className="eyebrow px-4 py-2"
            style={{ background: 'var(--bone)', borderBottom: '1px solid var(--rule-2)' }}
          >
            Canned · ↑↓ navigate · ↵ insert · Esc close
          </div>
          {filteredCanned.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={(e) => { e.preventDefault(); insertCanned(r); }}
              className="w-full text-left px-4 py-3 transition-colors"
              style={{
                background: i === pickerIndex ? 'var(--forest-soft)' : 'transparent',
                borderTop: i === 0 ? 'none' : '1px solid var(--rule-2)',
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{r.title}</span>
                {r.tags?.[0] && (
                  <span className="font-numeric text-[11px]" style={{ color: 'var(--forest)' }}>
                    /{r.tags[0]}
                  </span>
                )}
              </div>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--ash)' }}>{r.body}</p>
            </button>
          ))}
        </div>
      )}

      {/* Mode tabs — inline text with a hairline underline */}
      <div
        className="flex items-center gap-4 px-6 pt-3"
        style={{ borderBottom: '1px solid var(--rule-2)' }}
      >
        <button
          onClick={() => setIsNote(false)}
          className="pb-2 text-xs -mb-px transition-colors"
          style={{
            color: !isNote ? 'var(--ink)' : 'var(--ash)',
            borderBottom: !isNote ? '1px solid var(--ink)' : '1px solid transparent',
            fontWeight: !isNote ? 500 : 400,
          }}
        >
          Reply
        </button>
        <button
          onClick={() => setIsNote(true)}
          className="pb-2 text-xs -mb-px transition-colors"
          style={{
            color: isNote ? 'var(--ochre)' : 'var(--ash)',
            borderBottom: isNote ? '1px solid var(--ochre)' : '1px solid transparent',
            fontWeight: isNote ? 500 : 400,
          }}
        >
          Internal note
        </button>
        <div className="ml-auto flex items-center gap-4 pb-2">
          {cannedResponses.length > 0 && (
            <span className="text-[11px]" style={{ color: 'var(--dust)' }}>
              Type <kbd className="font-numeric px-1" style={{ background: 'var(--bone)', border: '1px solid var(--rule)' }}>/</kbd> for canned
            </span>
          )}
          {!isNote && (
            <button
              type="button"
              onClick={suggest}
              disabled={isSuggesting || isPending}
              className="text-[11px] flex items-center gap-1.5 transition-colors disabled:opacity-60"
              style={{ color: 'var(--forest)' }}
              title="Draft a reply from your knowledge base"
            >
              <span aria-hidden="true" style={{ fontSize: 12 }}>✧</span>
              {isSuggesting ? 'Drafting…' : 'Suggest reply'}
            </button>
          )}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={isNote ? 'Add an internal note (not sent to customer)…' : 'Reply to customer…  (⌘↵ to send)'}
        rows={3}
        className="w-full px-6 py-3 text-sm resize-none outline-none font-body leading-relaxed"
        style={{
          color: 'var(--ink)',
          background: isNote ? 'var(--ochre-soft)' : 'transparent',
        }}
      />

      {(suggestError || suggestSources.length > 0) && (
        <div className="px-6 pb-2">
          {suggestError && (
            <p className="text-xs" style={{ color: 'var(--brick)' }}>{suggestError}</p>
          )}
          {suggestSources.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="text-[11px]" style={{ color: 'var(--dust)' }}>Drafted from:</span>
              {suggestSources.filter((s) => s.url).map((s, i) => (
                <a
                  key={i}
                  href={s.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] link-underline"
                  style={{ color: 'var(--forest)' }}
                >
                  {s.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        className="flex items-center justify-between px-6 pb-4"
        style={{ borderTop: '1px solid var(--rule-2)', paddingTop: '10px' }}
      >
        <button onClick={resolve} disabled={isPending} className="btn-ghost">
          Resolve
        </button>
        <button
          onClick={send}
          disabled={isPending || !text.trim()}
          className="btn-ink"
        >
          {isPending ? 'Sending…' : isNote ? 'Save note' : 'Send reply'}
          <span aria-hidden="true" className="ml-2" style={{ opacity: 0.6 }}>↵</span>
        </button>
      </div>
    </div>
  );
}
