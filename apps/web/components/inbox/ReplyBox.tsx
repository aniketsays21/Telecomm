'use client';

import { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessageAction, updateConversationAction } from '@/lib/actions';

type Props = {
  conversationId: string;
  status: 'open' | 'snoozed' | 'resolved';
};

export function ReplyBox({ conversationId, status }: Props) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    if (!text.trim()) return;
    startTransition(async () => {
      await sendMessageAction(conversationId, text.trim(), isNote);
      setText('');
      router.refresh();
    });
  }

  function handleKey(e: React.KeyboardEvent) {
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
    <div className="border-t border-gray-100 bg-white">
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
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKey}
        placeholder={isNote ? 'Add an internal note (not sent to customer)…' : 'Reply to customer… (⌘↵ to send)'}
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
