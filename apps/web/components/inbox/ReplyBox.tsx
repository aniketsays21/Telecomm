'use client';

import { useState, useRef, useTransition, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessageAction, updateConversationAction } from '@/lib/actions';
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

  // Canned response picker state
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerIndex, setPickerIndex] = useState(0);

  const filteredCanned = cannedResponses.filter(r => {
    if (!pickerQuery) return true;
    const q = pickerQuery.toLowerCase();
    return r.title.toLowerCase().includes(q) ||
      (r.tags?.[0] ?? '').toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q);
  }).slice(0, 6);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Trigger picker when the textarea starts with "/"
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
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => Math.min(i + 1, filteredCanned.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(i => Math.max(i - 1, 0)); return; }
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
      <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-center">
        <p className="text-sm text-gray-500 mb-2">This conversation is resolved.</p>
        <button
          onClick={() => startTransition(async () => { await updateConversationAction(conversationId, { status: 'open' }); router.refresh(); })}
          className="text-sm text-indigo-600 hover:underline"
        >
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 bg-white relative">
      {/* Canned response picker */}
      {showPicker && filteredCanned.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 bg-white border border-gray-200 rounded-t-xl shadow-lg z-10 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
            Canned Responses — ↑↓ to navigate, ↵ to insert, Esc to close
          </div>
          {filteredCanned.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={e => { e.preventDefault(); insertCanned(r); }}
              className={`w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 transition-colors ${i === pickerIndex ? 'bg-indigo-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{r.title}</span>
                  {r.tags?.[0] && <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">/{r.tags[0]}</span>}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{r.body}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <button
          onClick={() => setIsNote(false)}
          className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
            !isNote ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Reply
        </button>
        <button
          onClick={() => setIsNote(true)}
          className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
            isNote ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Internal note
        </button>
        {cannedResponses.length > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">Type <kbd className="font-mono bg-gray-100 px-1 rounded">/</kbd> for canned responses</span>
        )}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={isNote ? 'Add an internal note (not sent to customer)…' : 'Reply to customer… (⌘↵ to send, / for canned)'}
        rows={3}
        className={`w-full px-4 pt-2 pb-1 text-sm resize-none outline-none ${
          isNote ? 'bg-amber-50' : 'bg-white'
        }`}
      />

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="flex gap-2">
          <button
            onClick={resolve}
            disabled={isPending}
            className="text-xs px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            Resolve ✓
          </button>
        </div>
        <button
          onClick={send}
          disabled={isPending || !text.trim()}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? 'Sending…' : isNote ? 'Save note' : 'Send reply'}
        </button>
      </div>
    </div>
  );
}
