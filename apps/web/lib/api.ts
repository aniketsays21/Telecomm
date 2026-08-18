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
};
