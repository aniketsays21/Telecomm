'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Refreshes the current RSC tree every `interval` ms so the inbox stays current
// without a full page reload. 10s is a good trade-off for a support inbox.
export function InboxPoller({ interval = 10_000 }: { interval?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), interval);
    return () => clearInterval(id);
  }, [router, interval]);

  return null;
}
