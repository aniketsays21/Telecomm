import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { sendMessage } from './api';

interface Msg {
  id: string;
  role: 'user' | 'bot';
  body: string;
  time: string;
  error?: boolean;
}

interface Props {
  workspaceId: string;
  apiUrl: string;
  greeting?: string;
}

function fmt() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function genSessionId(workspaceId: string): string {
  const key = `_tc_sid_${workspaceId}`;
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  localStorage.setItem(key, id);
  return id;
}

const ChatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <path stroke-linecap="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export function Widget({ workspaceId, apiUrl, greeting }: Props) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: '0', role: 'bot', body: greeting || 'Hi! How can I help you today?', time: fmt() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [sessionId] = useState(() => genSessionId(workspaceId));

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const doSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMsgs(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', body: text, time: fmt() }]);
    setLoading(true);

    try {
      const res = await sendMessage(apiUrl, workspaceId, sessionId, text);
      setMsgs(prev => [...prev, { id: `b-${Date.now()}`, role: 'bot', body: res.reply, time: fmt() }]);
      if (res.escalated) setEscalated(true);
    } catch {
      setMsgs(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'bot',
        body: "I'm having trouble connecting. Please try again.",
        time: fmt(),
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, apiUrl, workspaceId, sessionId]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const autoResize = (e: Event) => {
    const ta = e.currentTarget as HTMLTextAreaElement;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
  };

  return (
    <>
      {/* Launcher bubble */}
      <button
        id="tc-launcher"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close chat' : 'Open chat'}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>

      {/* Chat window */}
      <div id="tc-window" class={open ? '' : 'tc-hidden'} role="dialog" aria-label="Support chat">
        {/* Header */}
        <div id="tc-header">
          <div>
            <h2>Support Chat</h2>
            <p>We typically reply within a few minutes</p>
          </div>
          <button class="tc-close" onClick={() => setOpen(false)} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Messages */}
        <div id="tc-messages">
          {msgs.map(m => (
            <div key={m.id} class={`tc-msg tc-${m.role}`}>
              <div class={`tc-bubble${m.error ? ' tc-err' : ''}`}>{m.body}</div>
              <div class="tc-time">{m.time}</div>
            </div>
          ))}

          {loading && (
            <div class="tc-msg tc-bot">
              <div class="tc-bubble">
                <div class="tc-typing">
                  <div class="tc-dot" />
                  <div class="tc-dot" />
                  <div class="tc-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Escalation banner */}
        {escalated && (
          <div id="tc-escalated">
            A human agent has been notified and will follow up shortly.
          </div>
        )}

        {/* Input area */}
        <div id="tc-input-area">
          <textarea
            ref={textareaRef}
            placeholder="Type a message… (Enter to send)"
            value={input}
            onInput={(e) => { setInput((e.currentTarget as HTMLTextAreaElement).value); autoResize(e); }}
            onKeyDown={onKey}
            rows={1}
            disabled={loading}
          />
          <button
            id="tc-send"
            onClick={doSend}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>

        <div id="tc-footer">Powered by Telecomm AI</div>
      </div>
    </>
  );
}
