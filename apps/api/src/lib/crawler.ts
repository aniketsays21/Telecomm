/**
 * Website crawler for knowledge-base ingestion.
 *
 * Strategy, in priority order:
 *   1. Try `<site>/sitemap.xml` (and the sitemapindex fan-out). Almost every
 *      modern CMS, e-commerce, and doc platform ships one, and a sitemap
 *      lists hundreds of pages you'd never reach from the homepage nav in
 *      a reasonable hop count. This is the single biggest coverage win.
 *   2. Fall back to breadth-first link-following from the start URL.
 *   3. Regardless of how a URL is discovered, filter out obvious
 *      non-content paths (cart, checkout, /wp-admin, etc.) and binary
 *      file extensions (.pdf/.jpg/.zip/...) BEFORE fetching, so the
 *      politeness delay isn't wasted on garbage.
 *   4. Respect robots.txt for our User-Agent — one cheap fetch, treats a
 *      404 as "allow everything" like every well-behaved crawler does.
 *
 * The crawler has no JS runtime, so pure client-side SPAs will look empty
 * to it. That's a headless-browser upgrade for later; every server-rendered
 * platform (Shopify, WordPress, Ghost, Notion-as-site, docs generators,
 * Next.js SSR) works fine.
 */

export type CrawledPage = { url: string; title: string; content: string };

const USER_AGENT = 'Telecomm-Crawler/1.0 (+https://telecomm.io/bot)';

/** Cap on total pages ingested per source. Tune via env; default 500. */
const MAX_PAGES = Number(process.env.MAX_CRAWL_PAGES ?? 500);

/** Politeness delay between fetches to the same origin. */
const CRAWL_DELAY_MS = 500;

/** Per-fetch network timeout. */
const FETCH_TIMEOUT_MS = 10_000;

/** Reject pages larger than this — usually a sign of binary content mislabeled as HTML. */
const MAX_PAGE_BYTES = 2_000_000;

/** File extensions we skip before fetching — none of these carry content the AI can use. */
const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|mp4|mp3|wav|zip|tar|gz|rar|7z|dmg|exe|css|js|woff2?|ttf|eot|xml|json|rss|atom|txt)(\?|$)/i;

/**
 * URL path patterns we skip. Most of these are either transactional flows
 * (cart, checkout, account, wishlist) or platform-specific admin/technical
 * routes with zero customer-support signal.
 */
const SKIP_PATH_PATTERNS: RegExp[] = [
  // Commerce transactional
  /\/cart(\/|$)/i,
  /\/checkout(\/|$)/i,
  /\/(account|my-account|login|signin|signup|register|logout|password)(\/|$)/i,
  /\/(wishlist|compare|thank[-_]?you|order[-_]?confirmation)(\/|$)/i,
  // Search results (dupes of real pages)
  /\/search\?/i,
  /\/(catalogsearch|search)(\/|$)/i,
  // CMS admin
  /\/wp-(admin|login|json|content\/uploads)(\/|$)/i,
  /\/admin(\/|$)/i,
  // Faceted-navigation / filter noise (query-string bloat)
  /[?&](sort|filter|orderby|price|dir|mode|limit|utm_)/i,
];

// ---------------- robots.txt ----------------

/**
 * Minimal robots.txt parser: we only care about `Disallow` under our
 * User-Agent or `*`. Wildcards `*` and end-anchors `$` are handled;
 * anything more exotic is treated as literal (matches the spec's
 * "conservative default" behavior).
 */
async function fetchDisallowedPaths(origin: string): Promise<RegExp[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    let matches = false;
    const paths: string[] = [];
    for (const raw of lines) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      const [k, ...rest] = line.split(':');
      const key = k.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') {
        // A new group starts. Match if it targets our UA or the wildcard.
        matches = value === '*' || USER_AGENT.toLowerCase().startsWith(value.toLowerCase());
      } else if (key === 'disallow' && matches && value) {
        paths.push(value);
      }
    }
    return paths.map(disallowToRegex);
  } catch {
    return [];
  }
}

function disallowToRegex(pattern: string): RegExp {
  // Escape regex metachars, then re-enable `*` (wildcard) and `$` (end).
  const escaped = pattern
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  return new RegExp('^' + escaped);
}

function isDisallowed(pathname: string, disallowed: RegExp[]): boolean {
  return disallowed.some((rx) => rx.test(pathname));
}

// ---------------- sitemap ----------------

/**
 * Fetch sitemap.xml (or the sitemapindex tree) and return every URL
 * listed. Returns an empty array on any failure — the caller falls back
 * to BFS link-crawling and still gets useful coverage.
 */
async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const urls = new Set<string>();
  const queue: string[] = [`${origin}/sitemap.xml`];
  const visited = new Set<string>();

  while (queue.length > 0 && urls.size < MAX_PAGES * 4) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const xml = await res.text();

      // sitemapindex → recurse into each referenced sitemap
      const nestedSitemaps = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi)];
      for (const m of nestedSitemaps) queue.push(m[1].trim());

      // urlset → collect the actual page URLs
      const pageUrls = [...xml.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/gi)];
      for (const m of pageUrls) urls.add(m[1].trim());
    } catch {
      // ignore this sitemap and continue
    }
  }
  return [...urls];
}

// ---------------- fetch + content extraction ----------------

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len && len > MAX_PAGE_BYTES) return null;
    const body = await res.text();
    if (body.length > MAX_PAGE_BYTES) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Extract the readable text from a page. Prefer `<main>` or `<article>`
 * when present — those give us the actual content minus the header /
 * nav / sidebar / footer noise. Fall back to whole body with those
 * regions stripped.
 */
function extractText(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
    : 'Untitled';

  // Prefer semantic content roots when the page provides them.
  const main = pickFirstMatch(html, [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  ]);

  const region = main ?? html;

  const clean = region
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<template[\s\S]*?<\/template>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, '')
    .replace(/<header\b[\s\S]*?<\/header>/gi, '')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, '')
    .replace(/<form\b[\s\S]*?<\/form>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const text = decodeEntities(clean.replace(/<[^>]+>/g, ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { title, content: text };
}

function pickFirstMatch(html: string, patterns: RegExp[]): string | null {
  for (const rx of patterns) {
    const m = html.match(rx);
    if (m) return m[1];
  }
  return null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function resolveLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = [];
  const matches = html.matchAll(/href=["']([^"']+)["']/gi);
  for (const [, href] of matches) {
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin === baseUrl.origin) {
        resolved.hash = '';
        links.push(resolved.href);
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return links;
}

function shouldSkip(url: string): boolean {
  if (SKIP_EXTENSIONS.test(url)) return true;
  if (SKIP_PATH_PATTERNS.some((rx) => rx.test(url))) return true;
  return false;
}

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Drop trailing slash for dedup, keep root `/`.
    return u.pathname === '/' ? u.href : u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

// ---------------- main crawl ----------------

export async function crawlSite(
  startUrl: string,
  onPage?: (page: CrawledPage, index: number, total: number) => void,
): Promise<CrawledPage[]> {
  const base = new URL(startUrl);
  const origin = base.origin;

  const disallowed = await fetchDisallowedPaths(origin);
  const isBlocked = (url: string): boolean => {
    try {
      const u = new URL(url);
      if (u.origin !== origin) return true;
      return isDisallowed(u.pathname, disallowed) || shouldSkip(url);
    } catch {
      return true;
    }
  };

  // Seed the queue: start URL first, then everything sitemap.xml advertises.
  // Sitemap URLs go behind the start URL so an obviously-important landing
  // page indexes first, but ahead of link-follow discoveries (see below).
  const queue: string[] = [startUrl];
  const sitemapUrls = await fetchSitemapUrls(origin);
  for (const u of sitemapUrls) {
    if (!isBlocked(u) && !queue.includes(u)) queue.push(u);
  }

  const visited = new Set<string>();
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    const norm = normalize(url);
    if (visited.has(norm)) continue;
    visited.add(norm);
    if (isBlocked(url)) continue;

    const html = await fetchPage(url);
    if (!html) continue;

    const { title, content } = extractText(html);
    if (content.length < 100) continue;

    const page: CrawledPage = { url, title, content };
    pages.push(page);
    onPage?.(page, pages.length, MAX_PAGES);

    // Only follow links from pages we actually rendered — this bounds
    // discovery on sites without a sitemap while still respecting robots.
    for (const link of resolveLinks(html, base)) {
      const n = normalize(link);
      if (visited.has(n)) continue;
      if (isBlocked(link)) continue;
      if (!queue.includes(link)) queue.push(link);
    }

    if (queue.length > 0) await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
  }

  return pages;
}
