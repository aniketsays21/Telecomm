const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Request failed');
  return data as T;
}

export type AuthResponse = {
  token: string;
  user: { id: string; name: string; email: string; role: string };
  workspace?: { id: string; slug: string; name: string };
};

export type OnboardingData = {
  onboardingState: {
    emailConnected?: boolean;
    sourcesConnected?: boolean;
    widgetInstalled?: boolean;
  };
  isLive: boolean;
  slug: string;
  inboundEmail: string;
  widgetSnippet: string;
  sources: Array<{ id: string; type: string; name: string; status: string }>;
};

export const api = {
  signup: (body: { name: string; email: string; password: string; workspaceName: string }) =>
    request<AuthResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  acceptInvite: (body: { token: string; name: string; password: string }) =>
    request<AuthResponse>('/auth/accept-invite', { method: 'POST', body: JSON.stringify(body) }),

  me: (token: string) =>
    request<{ id: string; name: string; email: string; role: string; status: string }>(
      '/users/me', {}, token
    ),

  listUsers: (token: string) =>
    request<Array<{ id: string; name: string; email: string; role: string }>>('/users', {}, token),

  inviteUser: (token: string, body: { email: string; name: string; role: string }) =>
    request<{ id: string; email: string; inviteLink: string }>(
      '/users/invite', { method: 'POST', body: JSON.stringify(body) }, token
    ),

  // Onboarding
  getOnboarding: (token: string) =>
    request<OnboardingData>('/onboarding', {}, token),

  connectEmail: (token: string, supportEmail: string) =>
    request<{ inboundEmail: string; forwardingInstructions: string }>(
      '/onboarding/email', { method: 'POST', body: JSON.stringify({ supportEmail }) }, token
    ),

  addSource: (token: string, body: { type: string; name: string; url?: string; fileName?: string; fileMime?: string }) =>
    request<{ source: { id: string; type: string; name: string } }>(
      '/onboarding/sources', { method: 'POST', body: JSON.stringify(body) }, token
    ),

  deleteSource: (token: string, id: string) =>
    fetch(`${API}/onboarding/sources/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  markWidgetSeen: (token: string) =>
    request<{ ok: boolean }>('/onboarding/widget-seen', { method: 'POST', body: '{}' }, token),

  completeOnboarding: (token: string) =>
    request<{ ok: boolean; isLive: boolean }>('/onboarding/complete', { method: 'POST', body: '{}' }, token),

  // Inbox
  listConversations: (token: string, params?: { status?: string; limit?: number; cursor?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    return request<{
      conversations: ConversationSummary[];
      hasMore: boolean;
    }>(`/inbox/conversations?${qs}`, {}, token);
  },

  getConversation: (token: string, id: string) =>
    request<{ conversation: Conversation; contact: Contact; messages: Message[] }>(
      `/inbox/conversations/${id}`, {}, token
    ),

  sendMessage: (token: string, conversationId: string, body: { body: string; isInternalNote?: boolean }) =>
    request<Message>(
      `/inbox/conversations/${conversationId}/messages`,
      { method: 'POST', body: JSON.stringify(body) }, token
    ),

  updateConversation: (token: string, id: string, updates: {
    status?: 'open' | 'snoozed' | 'resolved';
    assigneeId?: string | null;
    priority?: number;
    tags?: string[];
  }) =>
    request<Conversation>(
      `/inbox/conversations/${id}`,
      { method: 'PATCH', body: JSON.stringify(updates) }, token
    ),
};

export type ConversationSummary = {
  id: string;
  status: 'open' | 'snoozed' | 'resolved';
  channel: 'chat' | 'email';
  subject: string | null;
  aiHandled: boolean;
  escalatedAt: string | null;
  escalationReason: string | null;
  lastMessageAt: string;
  createdAt: string;
  contact: { id: string; name: string | null; email: string | null };
  assigneeId: string | null;
  priority: number;
  sentiment: string | null;
  tags: string[];
};

export type Conversation = ConversationSummary & {
  contactId: string;
};

export type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  externalId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  workspaceId: string;
  authorType: 'contact' | 'agent' | 'ai' | 'system';
  authorId: string | null;
  body: string;
  isInternalNote: boolean;
  aiConfidence: string | null;
  aiSources: unknown[];
  createdAt: string;
};
