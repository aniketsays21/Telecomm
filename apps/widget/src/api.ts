export interface ChatResponse {
  conversationId: string;
  reply: string;
  escalated: boolean;
  aiConfidence?: number;
}

export interface WidgetMessage {
  id: string;
  role: 'user' | 'bot';
  body: string;
  createdAt: string;
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
