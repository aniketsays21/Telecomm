import { render } from 'preact';
import { Widget } from './Widget';
import { CSS } from './styles';
import { trackPageView } from './api';

function colorVars(hex: string = '#4f46e5'): string {
  const r = parseInt(hex.slice(1, 3), 16) || 79;
  const g = parseInt(hex.slice(3, 5), 16) || 70;
  const b = parseInt(hex.slice(5, 7), 16) || 229;
  const dr = Math.max(0, r - 18);
  const dg = Math.max(0, g - 18);
  const db = Math.min(255, b + 8);
  return `:host {
    --tc-color: ${hex};
    --tc-shadow: rgba(${r},${g},${b},0.45);
    --tc-shadow-lg: rgba(${r},${g},${b},0.55);
    --tc-gradient: linear-gradient(135deg, ${hex} 0%, rgb(${dr},${dg},${db}) 100%);
    --tc-highlight: rgba(${r},${g},${b},0.15);
  }`;
}

declare global {
  interface Window {
    TelecommConfig?: { workspaceId?: string; apiUrl?: string; color?: string; greeting?: string };
  }
}

function mount() {
  const config = window.TelecommConfig;
  if (!config?.workspaceId) {
    console.warn('[Telecomm] window.TelecommConfig.workspaceId is required');
    return;
  }

  // Infer API base URL from the script tag that loaded this file
  const scriptEl = document.querySelector('script[src*="widget.js"]') as HTMLScriptElement | null;
  const apiUrl = config.apiUrl ?? (scriptEl ? new URL(scriptEl.src).origin : 'http://localhost:4000');

  // Mount in shadow DOM for full CSS isolation from the host page
  const host = document.createElement('div');
  host.id = 'telecomm-widget-root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = colorVars(config.color) + '\n' + CSS;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  render(<Widget workspaceId={config.workspaceId} apiUrl={apiUrl} greeting={config.greeting} />, mountPoint);

  // Reuse the same anonymous session id the chat uses, so a page view and a
  // subsequent chat land on the same contact row.
  const sidKey = `_tc_sid_${config.workspaceId}`;
  let sid = localStorage.getItem(sidKey);
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(sidKey, sid);
  }

  let lastTrackedUrl = '';
  function trackCurrent() {
    const href = location.href;
    if (href === lastTrackedUrl) return;
    lastTrackedUrl = href;
    trackPageView(apiUrl, config!.workspaceId!, sid!, href, document.title, document.referrer || undefined);
  }
  trackCurrent();

  // SPA route changes: pushState / replaceState don't emit any event, so we
  // wrap them. popstate fires on back/forward. Never intercept clicks — that
  // way we don't interfere with the host site's own routing.
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: Parameters<typeof origPush>) {
    origPush.apply(this, args);
    trackCurrent();
  };
  history.replaceState = function (...args: Parameters<typeof origReplace>) {
    origReplace.apply(this, args);
    trackCurrent();
  };
  window.addEventListener('popstate', trackCurrent);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
