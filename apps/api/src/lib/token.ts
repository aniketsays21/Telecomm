import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
const ALG = 'HS256';

export type SessionPayload = {
  userId: string;
  workspaceId: string;
  role: 'admin' | 'agent' | 'readonly';
};

export async function signSession(payload: SessionPayload, expiresIn = '7d') {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as SessionPayload;
}
