import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { sendMessage, fetchNewMessages, fetchWidgetTriggers, type WidgetTrigger } from './api';

interface Msg {
  id: string;
  role: 'user' | 'bot' | 'agent';
  body: string;
  time: string;
  error?: boolean;
  /** Display name of the agent, when role === 'agent'. */
  agentName?: string;
  /** Optional list of KB articles the AI cited when composing this reply. */
  sources?: Array<{ title: string; url?: string }>;
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

/**
 * Render a bot message with inline markdown-style links `[label](url)`,
 * plus bare `https://…` URLs auto-linked. Links open in a new tab so the
 * chat stays open in the current tab. Everything else renders as plain
 * text — no HTML escaping issue since we never dangerouslySetInnerHTML.
 */
type Part = { type: 'text' | 'link'; text: string; href?: string };

function parseRich(body: string): Part[] {
  const parts: Part[] = [];
  // Markdown links first — [label](url), url must start with http(s) or /.
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g;
  const bareUrl = /(?<![("])(https?:\/\/[^\s<>()"']+)/g;

  let cursor = 0;
  const matches: Array<{ start: number; end: number; text: string; href: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(body))) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[1], href: m[2] });
  }
  // Bare URLs — skip ranges already claimed by a markdown link.
  const claimed = matches.slice();
  while ((m = bareUrl.exec(body))) {
    const s = m.index;
    const e = s + m[0].length;
    if (claimed.some((c) => s >= c.start && s < c.end)) continue;
    matches.push({ start: s, end: e, text: m[1], href: m[1] });
  }
  matches.sort((a, b) => a.start - b.start);

  for (const mm of matches) {
    if (mm.start > cursor) parts.push({ type: 'text', text: body.slice(cursor, mm.start) });
    parts.push({ type: 'link', text: mm.text, href: mm.href });
    cursor = mm.end;
  }
  if (cursor < body.length) parts.push({ type: 'text', text: body.slice(cursor) });
  return parts.length ? parts : [{ type: 'text', text: body }];
}

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
  // Which agents we've already announced ("Aniket is joining in ~2 mins")
  // as an inline system message. Sticky per-agent so the same person doesn't
  // trigger repeat announcements every time they send another line.
  const announcedAgentsRef = useRef<Set<string>>(new Set());
  // The human agent currently handling this thread, if any. Powers the small
  // "<agent> is talking" line in the header subtitle — a compact presence cue,
  // NOT the old full-width banner that covered the customer's messages. Once a
  // real person joins we keep showing them for the rest of the session.
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  // Proactive-trigger scheduling. Loaded once per session and de-duped in
  // localStorage so a returning visitor doesn't get the same nudge every
  // page they touch. Only fires if the widget is currently closed.
  const triggerFiredKey = `_tc_trig_${workspaceId}`;
  const alreadyFiredIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      const stored = localStorage.getItem(triggerFiredKey);
      if (stored) alreadyFiredIds.current = new Set(JSON.parse(stored));
    } catch { /* fresh set */ }
  }, [triggerFiredKey]);
  const [triggers, setTriggers] = useState<WidgetTrigger[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchWidgetTriggers(apiUrl, workspaceId).then((list) => {
      if (!cancelled) setTriggers(list);
    });
    return () => { cancelled = true; };
  }, [apiUrl, workspaceId]);

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

  // Evaluate proactive triggers once triggers have loaded. We check every
  // second — cheap, and the visitor's on-page time is only meaningful at
  // that granularity anyway. Firing is one-shot per rule per browser
  // (persisted in localStorage) so a returning visitor doesn't get spammed.
  useEffect(() => {
    if (triggers.length === 0) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      // Only fire if widget is closed AND no conversation is going yet AND
      // the tab is visible. Once the customer is chatting, further nudges
      // would be interruptive.
      if (openRef.current || conversationId || document.hidden) return;
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const path = typeof window !== 'undefined' ? window.location.href : '';
      const ready = triggers.find((t) => {
        if (alreadyFiredIds.current.has(t.id)) return false;
        const c = t.conditions ?? {};
        if (c.secondsOnPage != null && seconds < c.secondsOnPage) return false;
        if (c.urlPattern) {
          const p = c.urlPattern.trim();
          if (p.startsWith('/') && p.endsWith('/') && p.length > 2) {
            // /regex/ form — anchored anywhere, case-insensitive.
            try {
              if (!new RegExp(p.slice(1, -1), 'i').test(path)) return false;
            } catch { return false; }
          } else if (!path.toLowerCase().includes(p.toLowerCase())) {
            return false;
          }
        }
        return true;
      });
      if (!ready) return;

      alreadyFiredIds.current.add(ready.id);
      try {
        localStorage.setItem(triggerFiredKey, JSON.stringify([...alreadyFiredIds.current]));
      } catch { /* private mode, ignore */ }

      setMsgs((prev) => [
        ...prev,
        { id: `trig-${ready.id}`, role: 'bot', body: ready.message, time: fmt() },
      ]);
      setOpen(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [triggers, conversationId, triggerFiredKey]);

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
        let unseenReplies = 0;
        let latestAgent: string | null = null;
        setMsgs(prev => {
          const additions: Msg[] = [];
          for (const m of news) {
            // Advance the watermark for every message we see, including our
            // own echoed user turns — otherwise the next poll fetches them
            // again and we test the id set on unbounded history.
            if (m.createdAt > lastSeenAtRef.current) {
              lastSeenAtRef.current = m.createdAt;
            }
            // Skip user-role messages: the widget already inserted them
            // optimistically on send with a client-side id, so a poll
            // echoing them back would double-render every message the
            // customer typed. Only agent/bot messages come from outside.
            if (m.role === 'user') continue;
            if (seenIdsRef.current.has(m.id)) continue;
            seenIdsRef.current.add(m.id);

            // First message from any specific agent → inject a small bot
            // announcement right before their bubble so the customer knows
            // the person by name and doesn't feel dumped mid-thread. Using
            // agent name as the dedup key means the same person taking over
            // again on a later day only announces once.
            if (m.role === 'agent') {
              const name = m.agentName ?? 'A teammate';
              latestAgent = name;
              if (!announcedAgentsRef.current.has(name)) {
                announcedAgentsRef.current.add(name);
                additions.push({
                  id: `sys-join-${name}-${m.id}`,
                  role: 'bot',
                  body: `${name} is joining in ~2 mins.`,
                  time: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                });
              }
            }

            additions.push({
              id: m.id,
              role: m.role,
              body: m.body,
              agentName: m.agentName,
              time: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            });
            if (m.role === 'bot' || m.role === 'agent') unseenReplies++;
          }
          return additions.length ? [...prev, ...additions] : prev;
        });
        // A human replied this tick → surface "<agent> is talking" in the
        // header subtitle. Sticky for the rest of the session.
        if (latestAgent) setActiveAgent(latestAgent);
        // Rename for clarity — everything unseen goes to the badge, not just AI.
        const unseenBotArrivals = unseenReplies;
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
      setMsgs(prev => [
        ...prev,
        {
          id: botId,
          role: 'bot',
          body: res.reply,
          time: fmt(),
          sources: res.sources && res.sources.length > 0 ? res.sources : undefined,
        },
      ]);
      seenIdsRef.current.add(botId);
      // Advance the poll watermark past the AI reply we just added. Otherwise
      // the first poll (which fires as soon as conversationId is set) would
      // fetch every message since epoch — including this reply — and re-add
      // it under the server's UUID, since our client-side `b-{ts}` id isn't
      // in seenIdsRef under that key. Any subsequent agent reply arrives with
      // a createdAt > this timestamp and still gets picked up normally.
      lastSeenAtRef.current = new Date().toISOString();
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
        {/* Header — stays a fixed height so it never covers messages. When a
             human agent is on the thread, the SUBTITLE swaps to "<agent> is
             talking" with a live dot; the title stays "Support Chat". */}
        <div id="tc-header">
          <div>
            <h2>Support Chat</h2>
            {activeAgent ? (
              <p class="tc-agent-live">
                <span class="tc-agent-dot" aria-hidden="true" />
                {activeAgent} is talking
              </p>
            ) : (
              <p>We typically reply within a few minutes</p>
            )}
          </div>
          <button class="tc-close" onClick={() => setOpen(false)} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Messages */}
        <div id="tc-messages">
          {msgs.map(m => (
            <div key={m.id} class={`tc-msg tc-${m.role}`}>
              {m.role === 'agent' && m.agentName && (
                <div class="tc-msg-author">{m.agentName}</div>
              )}
              <div class={`tc-bubble${m.error ? ' tc-err' : ''}`}>
                {m.role !== 'user'
                  ? parseRich(m.body).map((p, i) =>
                      p.type === 'link' && p.href ? (
                        <a
                          key={i}
                          class="tc-link"
                          href={p.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {p.text}
                        </a>
                      ) : (
                        <span key={i}>{p.text}</span>
                      ),
                    )
                  : m.body}
              </div>
              {m.role === 'bot' && m.sources && m.sources.length > 0 && (
                <div class="tc-sources">
                  {m.sources.slice(0, 3).map((s) => (
                    s.url ? (
                      <a
                        key={s.url}
                        class="tc-source-chip"
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={s.title}
                      >
                        <span class="tc-source-icon" aria-hidden="true">↗</span>
                        <span class="tc-source-title">{s.title}</span>
                      </a>
                    ) : null
                  ))}
                </div>
              )}
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
