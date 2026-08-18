export type CrawledPage = { url: string; title: string; content: string };

const USER_AGENT = 'Telecomm-Crawler/1.0 (+https://telecomm.io/bot)';
const MAX_PAGES = 25;
const CRAWL_DELAY_MS = 500;

function extractText(html: string): { title: string; content: string } {
  // Strip scripts, styles, nav, footer, head
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Extract title
  const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : 'Untitled';

  // Strip all remaining tags and decode common entities
  const text = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { title, content: text };
}

function resolveLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = [];
  const matches = html.matchAll(/href=["']([^"'#?]+)["']/gi);
  for (const [, href] of matches) {
    try {
      const resolved = new URL(href, baseUrl);
      // Only same-origin links
      if (resolved.origin === baseUrl.origin) {
        resolved.search = '';
        resolved.hash = '';
        links.push(resolved.href);
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return links;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function crawlSite(
  startUrl: string,
  onPage?: (page: CrawledPage, index: number, total: number) => void,
): Promise<CrawledPage[]> {
  const base = new URL(startUrl);
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    const normalized = url.replace(/\/$/, '');
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const html = await fetchPage(url);
    if (!html) continue;

    const { title, content } = extractText(html);
    if (content.length < 100) continue; // skip nearly empty pages

    const page: CrawledPage = { url, title, content };
    pages.push(page);
    onPage?.(page, pages.length, MAX_PAGES);

    // Discover more links from the same site
    const links = resolveLinks(html, base);
    for (const link of links) {
      const norm = link.replace(/\/$/, '');
      if (!visited.has(norm) && !queue.includes(link)) {
        queue.push(link);
      }
    }

    if (queue.length > 0) await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
  }

  return pages;
}
