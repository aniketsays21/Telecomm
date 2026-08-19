import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { sendMessage, fetchNewMessages } from './api';

interface Msg {
  id: string;
  role: 'user' | 'bot';
  body: string;
  time: string;
  error?: boolean;
}

// How often the widget checks for agent replies from the dashboard. Runs as
// long as a conversation exists — open OR closed — so agent replies sent
// while the customer has the widget closed still arrive and show up as an
// unread badge on the launcher.
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

// The conversation id survives a page reload so the customer walks back into
// their thread instead of starting a fresh one every time. Keyed on
// workspaceId so multiple embedded widgets on the same host don't collide.
function convoKey(workspaceId: string): string { return `_tc_cid_${workspaceId}`; }
function loadStoredConversationId(workspaceId: string): string | null {
  try { return localStorage.getItem(convoKey(workspaceId)); } catch { return null; }
}
function persistConversationId(workspaceId: string, id: string): void {
  try { localStorage.setItem(convoKey(workspaceId), id); } catch { /* no-op */ }
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
  // Hydrate conversationId from localStorage so a reload doesn't lose the
  // thread. Null only until the customer has actually sent their first
  // message and we have nothing stored.
  const [conversationId, setConversationId] = useState<string | null>(() => loadStoredConversationId(workspaceId));
  // Unread count for the launcher badge — bumps every time a bot/agent message
  // arrives while the window is closed, resets to 0 when the customer opens it.
  const [unread, setUnread] = useState(0);

  // Most recent server-issued timestamp we've displayed. The polling loop
  // asks the server "anything newer than this?" — the ref avoids re-triggering
  // the polling useEffect on every message.
  const lastSeenAtRef = useRef<string>(new Date(0).toISOString());
  // Dedupe by server message id so an agent reply that arrives via polling
  // isn't re-added if the same id shows up on a later poll.
  const seenIdsRef = useRef<Set<string>>(new Set(['0']));
  // Read the latest `open` value inside the polling tick without making
  // `open` a dependency of the effect (which would tear down + rebuild the
  // interval every time the user toggles).
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
      // Opening the panel means the customer has now seen whatever agent
      // messages arrived while closed. Drop the badge.
      setUnread(0);
    }
  }, [open]);

  // Poll for agent replies (dashboard → widget). Runs as long as we know a
  // conversationId, whether the widget is open or closed. Skips the request
  // if the browser tab is hidden — a hidden tab can't render anyway, and
  // Chrome throttles our interval there.
  useEffect(() => {
    if (!conversationId) return;
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
        let unseenBotArrivals = 0;
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
            if (m.role === 'bot') unseenBotArrivals++;
            if (m.createdAt > lastSeenAtRef.current) {
              lastSeenAtRef.current = m.createdAt;
            }
          }
          return additions.length ? [...prev, ...additions] : prev;
        });
        // Only badge messages the customer hasn't seen yet — if the panel is
        // open at this moment, they're already looking.
        if (!openRef.current && unseenBotArrivals > 0) {
          setUnread(u => u + unseenBotArrivals);
        }
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
  }, [conversationId, apiUrl, workspaceId, sessionId]);

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
      persistConversationId(workspaceId, res.conversationId);
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
        aria-label={open ? 'Close chat' : unread > 0 ? `Open chat, ${unread} new message${unread === 1 ? '' : 's'}` : 'Open chat'}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && unread > 0 && (
          <span id="tc-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>
        )}
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
