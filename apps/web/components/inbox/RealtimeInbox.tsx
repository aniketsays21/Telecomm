'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Props {
  token: string;
  fallbackInterval?: number;
}

export function RealtimeInbox({ token, fallbackInterval = 15_000 }: Props) {
  const router = useRouter();
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let failed = false;

    function startFallback() {
      if (fallbackRef.current) return;
      fallbackRef.current = setInterval(() => router.refresh(), fallbackInterval);
    }

    function connect() {
      const wsUrl = API_URL.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'message' || data.type === 'update') {
            router.refresh();
          }
        } catch { /* ignore malformed frames */ }
      };

      ws.onopen = () => {
        // Connected — stop fallback polling if it was running
        if (fallbackRef.current) {
          clearInterval(fallbackRef.current);
          fallbackRef.current = null;
        }
      };

      ws.onerror = () => { failed = true; };
      ws.onclose = () => {
        // Reconnect after 3s, or fall back to polling if it keeps failing
        if (failed) {
          startFallback();
        } else {
          setTimeout(connect, 3000);
        }
      };
    }

    try {
      connect();
    } catch {
      startFallback();
    }

    return () => {
      wsRef.current?.close();
      if (fallbackRef.current) clearInterval(fallbackRef.current);
    };
  }, [token, router, fallbackInterval]);

  return null;
}
