'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  workspaceId: string;
  color: string;
  greeting: string;
  botName: string;
  previewUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Two modes:
 *  1. No previewUrl → inject the real widget.js into THIS page so the admin
 *     can play with a real conversation against their workspace.
 *  2. previewUrl set → render the customer's own site in an iframe with a
 *     visually-accurate widget bubble floating on top. This is a mock — we
 *     cannot inject scripts into third-party origins from the browser — but
 *     it gives a truthful sense of how the widget will look on the page.
 */
export function WidgetSandbox({ workspaceId, color, greeting, botName, previewUrl, position = 'bottom-right' }: Props) {
  const [copied, setCopied] = useState(false);
  const embedSnippet = buildEmbedSnippet({ workspaceId, color, greeting });

  return (
    <div>
      {previewUrl ? (
        <SitePreview url={previewUrl} color={color} greeting={greeting} botName={botName} position={position} />
      ) : (
        <SelfPreview workspaceId={workspaceId} color={color} greeting={greeting} />
      )}

      <div className="mt-4 rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
            Embed snippet for your website
          </p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(embedSnippet);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-xs px-2 py-0.5 border border-gray-200 rounded bg-white hover:bg-gray-100"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="p-3 bg-gray-900 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre">
{embedSnippet}
        </pre>
      </div>
    </div>
  );
}

function buildEmbedSnippet({ workspaceId, color, greeting }: { workspaceId: string; color: string; greeting: string }) {
  const lines = [
    '<script>',
    '  window.TelecommConfig = {',
    `    workspaceId: "${workspaceId}",`,
    `    color: "${color}",`,
  ];
  if (greeting) lines.push(`    greeting: ${JSON.stringify(greeting)},`);
  lines.push('  };');
  lines.push('</script>');
  lines.push(`<script src="${API_URL}/widget.js" async></script>`);
  return lines.join('\n');
}

/** Injects the real widget.js into the current page — used when no preview URL is set. */
function SelfPreview({ workspaceId, color, greeting }: { workspaceId: string; color: string; greeting: string }) {
  const injectedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (injectedRef.current) return;
    injectedRef.current = true;
    (window as unknown as { TelecommConfig?: unknown }).TelecommConfig = {
      workspaceId,
      apiUrl: API_URL,
      color,
      greeting: greeting || undefined,
    };
    const script = document.createElement('script');
    script.src = `${API_URL}/widget.js`;
    script.async = true;
    script.onload = () => setLoaded(true);
    script.onerror = () => setError('Could not load widget.js — is the API server running?');
    document.head.appendChild(script);
    return () => {
      const el = document.getElementById('telecomm-widget-root');
      if (el) el.remove();
      if (script.parentNode) document.head.removeChild(script);
      injectedRef.current = false;
    };
  }, [workspaceId, color, greeting]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 min-h-[220px] flex flex-col items-center justify-center text-center">
      {error ? (
        <div className="text-sm text-red-600">
          <p className="font-medium mb-1">Widget load failed</p>
          <p className="text-red-500">{error}</p>
        </div>
      ) : loaded ? (
        <div className="text-sm text-gray-500">
          <p className="font-medium text-gray-700 mb-1">Widget is live on this page</p>
          <p>Look for the chat bubble in the bottom-right corner.</p>
          <p className="mt-3 text-xs text-gray-400">
            Add your website URL below to preview the widget floating on your own site.
          </p>
        </div>
      ) : (
        <div className="text-sm text-gray-400">
          <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
          Loading widget preview…
        </div>
      )}
    </div>
  );
}

/**
 * Renders the customer's site in an iframe with a mock widget bubble overlay.
 *
 * We deliberately don't try to open a full conversation UI here — the goal is
 * "look, this is where it will sit" not "chat with the bot from this preview".
 * Live chatting still works from the SelfPreview panel when no URL is set.
 */
function SitePreview({
  url,
  color,
  greeting,
  botName,
  position,
}: {
  url: string;
  color: string;
  greeting: string;
  botName: string;
  position: 'bottom-right' | 'bottom-left';
}) {
  const [open, setOpen] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);

  // Many production sites send X-Frame-Options: DENY or a CSP frame-ancestors
  // that blocks framing. We can't detect that reliably from the parent frame,
  // so we time-out the load and offer an "Open in new tab" fallback.
  useEffect(() => {
    const t = setTimeout(() => {
      // If the iframe hasn't fired load in 6s, most likely it was blocked.
      const el = document.getElementById('telecomm-preview-iframe') as HTMLIFrameElement | null;
      if (el && !el.dataset.loaded) setIframeFailed(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [url]);

  const posStyles: React.CSSProperties =
    position === 'bottom-left'
      ? { left: 20, bottom: 20 }
      : { right: 20, bottom: 20 };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Fake browser chrome — signals "this is what your site looks like" */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-300" />
        </div>
        <div className="flex-1 mx-2 px-3 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded truncate">
          {url}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Open ↗
        </a>
      </div>

      <div className="relative" style={{ height: 520 }}>
        {iframeFailed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-gray-50 text-sm text-gray-600">
            <p className="font-medium text-gray-800 mb-1">This site can&apos;t be shown in a preview.</p>
            <p className="max-w-md text-gray-500">
              Many sites block being embedded in an iframe for security. Your widget will still
              work once you install the embed snippet on the site itself.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-white"
            >
              Open your site in a new tab ↗
            </a>
          </div>
        ) : (
          <iframe
            id="telecomm-preview-iframe"
            src={url}
            title="Website preview"
            className="absolute inset-0 w-full h-full border-0"
            onLoad={(e) => { (e.currentTarget as HTMLIFrameElement).dataset.loaded = '1'; }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        )}

        {/* Floating widget mock — matches the look of the real widget.js so
            the admin can judge color/position without embedding anything. */}
        <div
          className="absolute pointer-events-none"
          style={{ ...posStyles, zIndex: 20 }}
        >
          {open && (
            <div
              className="mb-3 rounded-2xl shadow-2xl border border-black/5 bg-white overflow-hidden pointer-events-auto"
              style={{ width: 320, maxHeight: 380 }}
            >
              <div
                className="px-4 py-3 text-white flex items-center justify-between"
                style={{ background: color }}
              >
                <div>
                  <p className="text-sm font-semibold leading-tight">{botName || 'Support Chat'}</p>
                  <p className="text-[11px] opacity-80">We reply in minutes</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-white/80 hover:text-white text-lg leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="p-4 bg-gray-50" style={{ minHeight: 200 }}>
                <div className="inline-block max-w-[85%] px-3 py-2 bg-white border border-gray-200 rounded-lg rounded-tl-sm text-sm text-gray-800">
                  {greeting || 'Hi! How can I help you today?'}
                </div>
              </div>
              <div className="px-3 py-2 border-t border-gray-100 bg-white text-xs text-gray-400">
                Type a message…
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="pointer-events-auto rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105"
            style={{ background: color, width: 56, height: 56 }}
            aria-label={open ? 'Close chat' : 'Open chat'}
          >
            {open ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <p className="px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-100">
        Preview only — the widget above is a mock. Install the embed snippet on your site to make it live.
      </p>
    </div>
  );
}
