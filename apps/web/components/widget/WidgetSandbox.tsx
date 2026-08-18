'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  workspaceId: string;
  color: string;
  greeting: string;
  botName: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function WidgetSandbox({ workspaceId, color, greeting, botName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const injectedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (injectedRef.current) return;
    injectedRef.current = true;

    // Set the config before injecting the script
    (window as any).TelecommConfig = {
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
      // Clean up widget host element on unmount
      const el = document.getElementById('telecomm-widget-root');
      if (el) el.remove();
      document.head.removeChild(script);
      injectedRef.current = false;
    };
  }, []); // Only mount once

  return (
    <div ref={containerRef} className="relative">
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
            <p className="mt-2 text-xs text-gray-400">Conversations are real — use a test workspace or dummy data.</p>
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
            Loading widget preview…
          </div>
        )}
      </div>

      <div className="mt-4 p-4 bg-gray-900 rounded-lg text-xs font-mono text-gray-300 overflow-x-auto">
        <p className="text-gray-500 mb-1">// Embed snippet for your website</p>
        <p>{'<script>'}</p>
        <p>{'  window.TelecommConfig = {'}</p>
        <p>{`    workspaceId: "${workspaceId}",`}</p>
        <p>{`    color: "${color}",`}</p>
        {greeting && <p>{`    greeting: "${greeting}",`}</p>}
        <p>{'  };'}</p>
        <p>{'</script>'}</p>
        <p>{`<script src="${API_URL}/widget.js" async></script>`}</p>
      </div>
    </div>
  );
}
