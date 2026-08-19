/**
 * Resolve the public URLs the API embeds in outbound artifacts — widget
 * snippets, invite links, mail body links — without hard-coding a localhost
 * fallback that ships to production.
 *
 * Priority for the API's own public URL:
 *   1. Explicit env var (`API_URL` / `PUBLIC_API_URL`) — always wins.
 *   2. Railway's auto-injected `RAILWAY_PUBLIC_DOMAIN` — the domain of
 *      whichever service this process is running under. Works with zero
 *      configuration on Railway.
 *   3. `http://localhost:4000` — local dev only.
 *
 * The Web app runs as a separate service, so its URL cannot be inferred from
 * Railway env alone. `WEB_URL` must be set explicitly; if it isn't, we still
 * fall back to localhost so local dev keeps working, but a warning is logged
 * once per process so a misconfigured production deploy is visible.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function railwayPublicUrl(): string | undefined {
  const raw = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (!raw) return undefined;
  // Belt-and-braces: Railway ships bare host (`foo.up.railway.app`), but a
  // user could paste a full URL by mistake — don't produce `https://https://…`.
  if (/^https?:\/\//i.test(raw)) return stripTrailingSlash(raw);
  return `https://${raw}`;
}

/** URL the widget snippet embeds; where `widget.js` and the widget API live. */
export function apiUrl(): string {
  const explicit = process.env.API_URL?.trim() || process.env.PUBLIC_API_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  const railway = railwayPublicUrl();
  if (railway) return railway;
  return 'http://localhost:4000';
}

/** URL used in mail body links pointing back at the API (e.g. tracking pixels). */
export function publicApiUrl(): string {
  const explicit = process.env.PUBLIC_API_URL?.trim() || process.env.API_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  const railway = railwayPublicUrl();
  if (railway) return railway;
  return 'http://localhost:4000';
}

let webUrlWarned = false;

/** URL of the Web dashboard; used in invite links, mail body links. */
export function webUrl(): string {
  const explicit = process.env.WEB_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  if (process.env.NODE_ENV === 'production' && !webUrlWarned) {
    webUrlWarned = true;
    console.warn(
      '[urls] WEB_URL is not set. Invite emails and dashboard links will point at ' +
        'http://localhost:3000, which is broken for customers. Set WEB_URL on the API ' +
        'service to the Web app\'s public URL (e.g. https://telecomm-production-fcdb.up.railway.app).',
    );
  }
  return 'http://localhost:3000';
}
