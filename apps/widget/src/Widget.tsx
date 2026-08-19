import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { sendMessage, fetchNewMessages } from './api';

interface Msg {
  id: string;
  role: 'user' | 'bot';
  body: string;
  time: string;
  error?: boolean;
}

// How often the widget checks for agent replies from the dashboard. Only runs
// while the chat window is open, so bandwidth stays negligible.
const POLL_INTERVAL_MS = 3000;

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
  // Server-side conversation id, learned from the first sendMessage response.
  // Null until the customer sends their first message.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Most recent server-issued timestamp we've displayed. The polling loop
  // asks the server "anything newer than this?" — the ref avoids re-triggering
  // the polling useEffect on every message.
  const lastSeenAtRef = useRef<string>(new Date(0).toISOString());
  // Dedupe by server message id so an agent reply that arrives via polling
  // isn't re-added if the same id shows up on a later poll.
  const seenIdsRef = useRef<Set<string>>(new Set(['0']));

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // Poll for agent replies (dashboard → widget). Runs only while the chat
  // window is open AND a conversation exists (learned from the first send).
  // Skips the request if the tab is hidden to keep costs down.
  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    async function tick() {
      if (cancelled || document.hidden) return;
      try {
        const news = await fetchNewMessages(
          apiUrl,
          workspaceId,
          sessionId,
          conversationId!,
          lastSeenAtRef.current,
        );
        if (cancelled || news.length === 0) return;
        setMsgs(prev => {
          const additions: Msg[] = [];
          for (const m of news) {
            if (seenIdsRef.current.has(m.id)) continue;
            seenIdsRef.current.add(m.id);
            additions.push({
              id: m.id,
              role: m.role,
              body: m.body,
              time: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            });
            if (m.createdAt > lastSeenAtRef.current) {
              lastSeenAtRef.current = m.createdAt;
            }
          }
          return additions.length ? [...prev, ...additions] : prev;
        });
      } catch {
        // Silent: transient network errors just mean we retry on the next tick.
      }
    }
    const id = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, conversationId, apiUrl, workspaceId, sessionId]);

  const doSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMsgs(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', body: text, time: fmt() }]);
    setLoading(true);

    try {
      const res = await sendMessage(apiUrl, workspaceId, sessionId, text);
      const botId = `b-${Date.now()}`;
      setMsgs(prev => [...prev, { id: botId, role: 'bot', body: res.reply, time: fmt() }]);
      seenIdsRef.current.add(botId);
      setConversationId(res.conversationId);
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
