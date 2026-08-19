'use client';

import { useState, useTransition } from 'react';
import type { Webhook } from '@/lib/api';
import { createWebhookAction, updateWebhookAction, deleteWebhookAction } from '@/lib/actions';

type Props = {
  initialWebhooks: Webhook[];
  events: string[];
};

export function WebhooksPanel({ initialWebhooks, events }: Props) {
  const [hooks, setHooks] = useState<Webhook[]>(initialWebhooks);
  const [showNew, setShowNew] = useState(hooks.length === 0);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(events);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [revealSecretId, setRevealSecretId] = useState<string | null>(null);

  function toggleEvent(name: string) {
    setSelectedEvents((prev) =>
      prev.includes(name) ? prev.filter((e) => e !== name) : [...prev, name],
    );
  }

  function createHook() {
    setError(null);
    if (!url.trim()) { setError('Enter a URL.'); return; }
    startTransition(async () => {
      const res = await createWebhookAction({ url: url.trim(), events: selectedEvents, description: description.trim() || undefined });
      if ('error' in res && res.error) { setError(res.error); return; }
      if ('webhook' in res && res.webhook) {
        setHooks((prev) => [res.webhook!, ...prev]);
        setUrl('');
        setDescription('');
        setShowNew(false);
        setRevealSecretId(res.webhook.id);
      }
    });
  }

  function toggleEnabled(h: Webhook) {
    const next = !h.enabled;
    setHooks((prev) => prev.map((x) => (x.id === h.id ? { ...x, enabled: next } : x)));
    startTransition(async () => {
      await updateWebhookAction(h.id, { enabled: next });
    });
  }

  function removeHook(id: string) {
    if (!confirm('Delete this webhook? Future events will stop being delivered.')) return;
    setHooks((prev) => prev.filter((h) => h.id !== id));
    startTransition(() => { void deleteWebhookAction(id); });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {hooks.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No webhooks yet.</p>
        ) : hooks.map((h) => (
          <div key={h.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900 break-all">{h.url}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${h.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {h.enabled ? 'enabled' : 'disabled'}
                  </span>
                  {h.consecutiveFailures > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-rose-100 text-rose-700">
                      {h.consecutiveFailures} failed
                    </span>
                  )}
                </div>
                {h.description && (
                  <p className="text-xs text-gray-500 mt-1">{h.description}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-2">
                  Events: <span className="font-mono">{h.events.length === 0 ? 'all' : h.events.join(', ')}</span>
                </p>
                {h.lastDeliveryAt && (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Last delivery {new Date(h.lastDeliveryAt).toLocaleString()} · status {h.lastDeliveryStatus ?? '—'}
                    {h.lastDeliveryError && <span className="text-rose-500"> · {h.lastDeliveryError}</span>}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  {revealSecretId === h.id ? (
                    <>
                      <code className="text-xs font-mono bg-gray-50 px-2 py-1 rounded border border-gray-200 break-all">{h.secret}</code>
                      <button
                        onClick={() => { void navigator.clipboard.writeText(h.secret); }}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Copy
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setRevealSecretId(h.id)}
                      className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
                    >
                      Reveal signing secret
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleEnabled(h)}
                  className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                >
                  {h.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => removeHook(h.id)}
                  className="text-xs px-2 py-1 border border-rose-200 text-rose-700 rounded hover:bg-rose-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!showNew && (
        <button
          onClick={() => setShowNew(true)}
          className="text-sm px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Add webhook
        </button>
      )}

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-900">New webhook</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://api.yourservice.com/telecomm-webhook"
              className="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="Push to HubSpot"
              className="w-full text-sm border border-gray-200 rounded px-3 py-2"
            />
          </div>
          <div>
            <p className="block text-xs font-medium text-gray-600 mb-2">Events</p>
            <div className="flex flex-wrap gap-2">
              {events.map((e) => (
                <label key={e} className="text-xs flex items-center gap-1.5 px-2 py-1 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(e)}
                    onChange={() => toggleEvent(e)}
                    className="w-3 h-3"
                  />
                  <span className="font-mono">{e}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Leave all unchecked to receive every event.</p>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={createHook}
              disabled={isPending}
              className="text-sm px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60"
            >
              {isPending ? 'Creating…' : 'Create webhook'}
            </button>
            <button
              onClick={() => { setShowNew(false); setError(null); }}
              className="text-sm px-3 py-2 text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg border border-gray-100 p-4 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-800">Verifying signatures</p>
        <p>Each request carries a <code className="font-mono">X-Telecomm-Signature</code> header of the form <code className="font-mono">t=&lt;timestamp&gt;,v1=&lt;hex&gt;</code>.</p>
        <p>Compute <code className="font-mono">HMAC-SHA256(secret, `${'{'}timestamp{'}'}.${'{'}rawBody{'}'}`)</code> and compare with the <code className="font-mono">v1</code> value.</p>
      </div>
    </div>
  );
}
