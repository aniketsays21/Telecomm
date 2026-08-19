'use server';

import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? 'dev-secret-change-me'
);
const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'telecomm_session';

export type SessionData = {
  token: string;
  userId: string;
  role: 'admin' | 'agent' | 'readonly';
  workspaceId: string;
  name: string;
  email: string;
};

export async function setSession(data: SessionData) {
  const jar = await cookies();
  jar.set(COOKIE, JSON.stringify(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
}

export async function getSession(): Promise<SessionData | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
