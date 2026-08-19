import { SignJWT, jwtVerify } from 'jose';
import { db } from '@telecomm/db';
import { gmailAccounts } from '@telecomm/db/schema';
import { eq } from 'drizzle-orm';
import { publicApiUrl } from './urls.js';
import { encrypt, decrypt } from './gmail-crypto.js';

/**
 * Gmail OAuth helper. Uses the standard Google Web-app OAuth 2.0 flow:
 *   /oauth2/v2/auth?client_id=…&redirect_uri=…&scope=…&response_type=code
 * Google redirects back with ?code=… → we exchange for an access + refresh
 * token pair via /oauth2/v4/token.
 *
 * The refresh token is only returned on the first consent (or when
 * `prompt=consent` is forced), so we ALWAYS force consent on connect —
 * a customer reconnecting after disconnect needs a fresh refresh token.
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify openid email';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function clientId(): string { return requireEnv('GOOGLE_CLIENT_ID'); }
function clientSecret(): string { return requireEnv('GOOGLE_CLIENT_SECRET'); }

/**
 * The Google-registered redirect_uri. Must match what's on file in the Google
 * Cloud Console OAuth Client. Explicit env var wins over the auto-inferred
 * Railway URL so cross-environment deploys can point at the right one.
 */
export function redirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${publicApiUrl()}/gmail/oauth/callback`;
}

// ---- OAuth state (round-trips through Google's redirect) --------------------
// We embed workspaceId + userId into a short-lived signed JWT so the callback
// can trust which workspace to attach the token to, without a server-side
// session store.
const stateSecret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
type OAuthState = { workspaceId: string; userId: string };

export async function signState(payload: OAuthState): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(stateSecret);
}

export async function verifyState(token: string): Promise<OAuthState> {
  const { payload } = await jwtVerify(token, stateSecret);
  return payload as unknown as OAuthState;
}

// ---- Auth URL ---------------------------------------------------------------
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    // Force re-consent so we always get a fresh refresh_token, even if the
    // user had previously granted access under a different Telecomm workspace.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

// ---- Token exchange ---------------------------------------------------------
type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json as unknown as GoogleTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json as unknown as GoogleTokenResponse;
}

// ---- Fresh-token accessor ---------------------------------------------------
/**
 * Return a usable access token for the workspace's connected Gmail. Refreshes
 * and persists in place when the stored token is within 60s of expiring, so
 * callers never have to think about the refresh dance.
 */
export async function getFreshAccessToken(workspaceId: string): Promise<{
  accessToken: string;
  emailAddress: string;
  historyId: string | null;
  accountId: string;
}> {
  const [account] = await db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.workspaceId, workspaceId))
    .limit(1);
  if (!account) throw new Error('Gmail not connected for this workspace');

  const now = Date.now();
  const expiresAt = new Date(account.accessTokenExpiresAt).getTime();
  const skew = 60_000;
  if (expiresAt - now > skew) {
    return {
      accessToken: account.accessToken,
      emailAddress: account.emailAddress,
      historyId: account.historyId,
      accountId: account.id,
    };
  }

  const refresh = decrypt(account.refreshTokenEncrypted);
  const fresh = await refreshAccessToken(refresh);
  const newExpiresAt = new Date(now + fresh.expires_in * 1000);
  await db.update(gmailAccounts)
    .set({
      accessToken: fresh.access_token,
      accessTokenExpiresAt: newExpiresAt,
      // Google occasionally rotates the refresh token — persist if returned.
      ...(fresh.refresh_token
        ? { refreshTokenEncrypted: encrypt(fresh.refresh_token) }
        : {}),
      lastError: null,
    })
    .where(eq(gmailAccounts.id, account.id));

  return {
    accessToken: fresh.access_token,
    emailAddress: account.emailAddress,
    historyId: account.historyId,
    accountId: account.id,
  };
}
