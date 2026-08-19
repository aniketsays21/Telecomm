export interface ChatResponse {
  conversationId: string;
  reply: string;
  escalated: boolean;
  aiConfidence?: number;
  /** Knowledge-base articles the AI drew on, in relevance order. */
  sources?: Array<{ title: string; url?: string }>;
}

export interface WidgetMessage {
  id: string;
  /**
   * user  = the customer themself
   * bot   = the AI assistant
   * agent = a human teammate replying from the dashboard (live hand-off)
   */
  role: 'user' | 'bot' | 'agent';
  body: string;
  createdAt: string;
  /** Display name of the agent, when role === 'agent'. */
  agentName?: string;
}

/** A proactive-chat trigger rule, evaluated in the browser. */
export interface WidgetTrigger {
  id: string;
  message: string;
  conditions: { secondsOnPage?: number; urlPattern?: string };
}

export async function fetchWidgetTriggers(
  apiUrl: string,
  workspaceId: string,
): Promise<WidgetTrigger[]> {
  try {
    const res = await fetch(`${apiUrl}/widget/triggers?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!res.ok) return [];
    const data = await res.json() as { triggers?: WidgetTrigger[] };
    return data.triggers ?? [];
  } catch {
    return [];
  }
}

export async function sendMessage(
  apiUrl: string,
  workspaceId: string,
  sessionId: string,
  message: string,
): Promise<ChatResponse> {
  const res = await fetch(`${apiUrl}/widget/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, sessionId, message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `API error ${res.status}`);
  }

  return res.json() as Promise<ChatResponse>;
}

/**
 * Poll for messages the customer hasn't seen yet — specifically the agent
 * replies that come from the dashboard side after the initial AI answer.
 * `since` is the ISO timestamp of the last message the widget already knows
 * about; the server returns everything strictly newer than that.
 */
/**
 * Fire-and-forget page-view ping. Any failure is silent — a page view we
 * couldn't record must never break the customer's site or throw into the
 * host page's error handlers.
 */
export function trackPageView(
  apiUrl: string,
  workspaceId: string,
  sessionId: string,
  url: string,
  title?: string,
  referrer?: string,
): void {
  const body = JSON.stringify({ workspaceId, sessionId, url, title, referrer });
  // sendBeacon survives page unloads (SPA navigations that unload the JS
  // context); fall back to fetch on browsers or contexts where it isn't
  // available.
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      const ok = navigator.sendBeacon(`${apiUrl}/widget/page-view`, blob);
      if (ok) return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch(`${apiUrl}/widget/page-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // swallow
  }
}

export async function fetchNewMessages(
  apiUrl: string,
  workspaceId: string,
  sessionId: string,
  conversationId: string,
  since: string,
): Promise<WidgetMessage[]> {
  const params = new URLSearchParams({ workspaceId, sessionId, conversationId, since });
  const res = await fetch(`${apiUrl}/widget/messages?${params}`);
  if (!res.ok) return [];
  const data = await res.json() as { messages?: WidgetMessage[] };
  return data.messages ?? [];
}
