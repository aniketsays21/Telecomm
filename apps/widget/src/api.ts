export interface ChatResponse {
  conversationId: string;
  reply: string;
  escalated: boolean;
  aiConfidence?: number;
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
