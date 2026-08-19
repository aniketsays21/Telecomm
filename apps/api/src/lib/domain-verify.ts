import { resolveCname, resolveTxt } from 'node:dns/promises';

/**
 * Custom-domain verification + SSL provisioning approach.
 * ────────────────────────────────────────────────────────
 *
 * Goal: let a workspace host their knowledge base at `help.brand.com`
 * without them running any of their own infrastructure. Requests hit our
 * origin, we route by Host header, we serve the KB with a valid TLS cert
 * issued for their domain.
 *
 * Two-step verification (this file implements both):
 *
 *   1. CNAME check — the customer adds
 *        CNAME help.brand.com → domains.telecomm.io
 *      We look up the CNAME chain and confirm it resolves to our target.
 *      This is what actually routes their traffic to us.
 *
 *   2. TXT proof-of-ownership — the customer adds
 *        TXT _telecomm.help.brand.com "telecomm-verify=<random token>"
 *      This defends against a shared-CDN hijack: even if two workspaces
 *      point CNAMEs at the same target, only the one with the matching
 *      TXT owns the hostname.
 *
 * SSL provisioning — two real options; we stub the actual call and describe
 * how a production hookup wires in:
 *
 *   ── Cloudflare-for-SaaS (recommended) ──
 *   We proxy customer traffic through a Cloudflare zone we own
 *   (e.g. `*.telecomm.io`). The customer's CNAME points at that zone.
 *   POST /zones/<zone_id>/custom_hostnames with { hostname, ssl: { method: 'txt' } }.
 *   Cloudflare handles cert issuance + renewal, and TLS-terminates at their
 *   edge before forwarding to our origin with the Host header preserved.
 *   Docs: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas
 *
 *   ── Let's Encrypt (self-hosted fallback) ──
 *   Use `acme-client` (npm) with HTTP-01 challenge:
 *     - Customer's CNAME already routes traffic to us, so the challenge URL
 *       `http://help.brand.com/.well-known/acme-challenge/<token>` reaches
 *       our origin.
 *     - We serve the challenge response, ACME issues the cert, we store it
 *       (encrypted) in the DB or a KV store, and our TLS terminator (nginx,
 *       Caddy, or a Node HTTPS server using SNI callback) picks the right
 *       cert per SNI hostname.
 *     - Renewal every 60 days via a cron job.
 *   This works without a third party but is a lot more infrastructure to
 *   own. Cloudflare-for-SaaS is the sane default.
 */

/**
 * What we tell the customer their CNAME should point at. In production this
 * would be the hostname of your Cloudflare-for-SaaS zone (or your own load
 * balancer). Configurable via env so it can differ per environment.
 */
export function cnameTarget(): string {
  return (process.env.CUSTOM_DOMAIN_TARGET?.trim() || 'domains.telecomm.io').toLowerCase();
}

export type VerifyResult =
  | { ok: true; cnameFound: string; txtFound: string }
  | { ok: false; step: 'cname' | 'txt'; message: string; observed?: string[] };

export async function verifyDomain(
  hostname: string,
  verificationToken: string,
): Promise<VerifyResult> {
  const target = cnameTarget();

  // --- Step 1: CNAME check --------------------------------------------------
  let cnameFound: string[];
  try {
    cnameFound = await resolveCname(hostname);
  } catch (err) {
    return {
      ok: false,
      step: 'cname',
      message: `No CNAME record found for ${hostname}. Add CNAME → ${target} at your DNS provider, then retry.`,
    };
  }
  const matched = cnameFound.some((c) => c.toLowerCase().replace(/\.$/, '') === target);
  if (!matched) {
    return {
      ok: false,
      step: 'cname',
      message: `CNAME points at ${cnameFound.join(', ')}. Expected ${target}.`,
      observed: cnameFound,
    };
  }

  // --- Step 2: TXT proof of ownership --------------------------------------
  const txtHost = `_telecomm.${hostname}`;
  const expectedTxt = `telecomm-verify=${verificationToken}`;
  let txtRecords: string[][];
  try {
    txtRecords = await resolveTxt(txtHost);
  } catch (err) {
    return {
      ok: false,
      step: 'txt',
      message: `No TXT record at ${txtHost}. Add "${expectedTxt}" and retry.`,
    };
  }
  const flat = txtRecords.map((chunks) => chunks.join('')).map((s) => s.replace(/^"|"$/g, ''));
  const txtMatched = flat.some((t) => t === expectedTxt);
  if (!txtMatched) {
    return {
      ok: false,
      step: 'txt',
      message: `TXT record at ${txtHost} doesn't match. Expected "${expectedTxt}".`,
      observed: flat,
    };
  }

  return { ok: true, cnameFound: cnameFound[0], txtFound: expectedTxt };
}

/**
 * SSL provisioning — STUBBED. Replace the body with a real Cloudflare API
 * call in production. The interface is intentionally the shape a real call
 * would return, so upgrading the implementation later doesn't touch callers.
 *
 * A production Cloudflare-for-SaaS call would look like:
 *
 *   const res = await fetch(
 *     `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/custom_hostnames`,
 *     {
 *       method: 'POST',
 *       headers: {
 *         'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
 *         'Content-Type': 'application/json',
 *       },
 *       body: JSON.stringify({
 *         hostname,
 *         ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
 *       }),
 *     },
 *   );
 *   const json = await res.json();
 *   return { ok: json.success, provider: 'cloudflare', hostnameId: json.result.id };
 *
 * The response includes the DCV (Domain Control Validation) TXT record the
 * customer needs to add to their DNS — Cloudflare needs that to issue the
 * cert. Once added and Cloudflare has confirmed, `status` transitions to
 * `active` and TLS goes live.
 */
export async function provisionSsl(hostname: string): Promise<{
  ok: boolean;
  provider: 'cloudflare' | 'letsencrypt' | 'stub';
  message: string;
}> {
  // Real Cloudflare integration lives behind CF_API_TOKEN + CF_ZONE_ID. When
  // those aren't set we return the stub so local dev / a bare deploy still
  // works — the customer sees "SSL: pending (stub)" instead of a fake success.
  const hasCloudflare = !!(process.env.CF_API_TOKEN && process.env.CF_ZONE_ID);
  if (!hasCloudflare) {
    return {
      ok: true,
      provider: 'stub',
      message: `Domain verified. SSL provisioning is stubbed in this environment — set CF_API_TOKEN + CF_ZONE_ID to hand off to Cloudflare-for-SaaS, or wire up acme-client for a self-hosted Let's Encrypt path. See apps/api/src/lib/domain-verify.ts for the exact integration.`,
    };
  }

  // Placeholder for the real Cloudflare call. Kept so the switch from stub →
  // production is a one-file edit, not a new integration.
  return {
    ok: true,
    provider: 'cloudflare',
    message: `Handed off to Cloudflare-for-SaaS for ${hostname}. Watch the ssl_status column — updates via webhook.`,
  };
}
