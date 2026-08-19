import { createHash, timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Inbound webhook authentication.
 *
 * Postmark does not HMAC-sign webhook payloads. Its documented mechanism is
 * HTTP Basic Auth credentials embedded in the webhook URL, which Postmark then
 * sends as an Authorization header on every POST:
 *
 *   https://user:pass@api.example.com/inbound/email
 *
 * So we verify that Authorization header. A bearer token is also accepted for
 * providers (or proxies) that cannot carry Basic credentials in the URL.
 *
 * Configure with either:
 *   POSTMARK_WEBHOOK_USER + POSTMARK_WEBHOOK_PASS   (Basic — recommended)
 *   POSTMARK_WEBHOOK_TOKEN                          (Bearer / X-Webhook-Token)
 *
 * Without configuration the endpoint is unauthenticated, which would let anyone
 * who learns the URL inject messages and make the platform send mail on a
 * brand's behalf. That is refused outright in production; in development it is
 * allowed with a warning so local testing needs no setup.
 */

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; reason: string };

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/** Constant-time comparison over SHA-256 digests, so unequal lengths are safe. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

let warnedUnconfigured = false;

export function verifyInboundWebhookAuth(request: FastifyRequest): WebhookAuthResult {
  const user = process.env.POSTMARK_WEBHOOK_USER;
  const pass = process.env.POSTMARK_WEBHOOK_PASS;
  const token = process.env.POSTMARK_WEBHOOK_TOKEN;

  const header = request.headers.authorization ?? '';

  if (user && pass) {
    const [scheme, encoded] = header.split(' ');
    if (scheme?.toLowerCase() !== 'basic' || !encoded) {
      return { ok: false, status: 401, reason: 'Missing Basic credentials' };
    }
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      return { ok: false, status: 401, reason: 'Malformed Basic credentials' };
    }
    // Split on the first colon only — passwords may contain colons.
    const sep = decoded.indexOf(':');
    if (sep === -1) return { ok: false, status: 401, reason: 'Malformed Basic credentials' };
    const gotUser = decoded.slice(0, sep);
    const gotPass = decoded.slice(sep + 1);
    // Compare both halves unconditionally so failure timing does not reveal
    // which half was wrong.
    const userOk = safeEqual(gotUser, user);
    const passOk = safeEqual(gotPass, pass);
    if (!userOk || !passOk) {
      return { ok: false, status: 401, reason: 'Invalid credentials' };
    }
    return { ok: true };
  }

  if (token) {
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined;
    const custom = request.headers['x-webhook-token'];
    const provided = bearer ?? (typeof custom === 'string' ? custom : undefined);
    if (!provided) return { ok: false, status: 401, reason: 'Missing webhook token' };
    if (!safeEqual(provided, token)) {
      return { ok: false, status: 401, reason: 'Invalid webhook token' };
    }
    return { ok: true };
  }

  if (isProduction()) {
    return {
      ok: false,
      status: 500,
      reason:
        'Inbound webhook authentication is not configured. Set POSTMARK_WEBHOOK_USER and ' +
        'POSTMARK_WEBHOOK_PASS (and put the same credentials in the Postmark webhook URL), ' +
        'or set POSTMARK_WEBHOOK_TOKEN.',
    };
  }

  if (!warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn(
      '[inbound] Webhook authentication is NOT configured — accepting unauthenticated ' +
        'requests because NODE_ENV is not "production". Set POSTMARK_WEBHOOK_USER/' +
        'POSTMARK_WEBHOOK_PASS before deploying.',
    );
  }
  return { ok: true };
}
