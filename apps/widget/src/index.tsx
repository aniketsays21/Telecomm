import { render } from 'preact';
import { Widget } from './Widget';
import { CSS } from './styles';

declare global {
  interface Window {
    TelecommConfig?: { workspaceId?: string; apiUrl?: string };
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
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  render(<Widget workspaceId={config.workspaceId} apiUrl={apiUrl} />, mountPoint);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
