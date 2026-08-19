'use client';

import { useState, useTransition } from 'react';
import type { WidgetTriggerRow } from '@/lib/api';
import { createTriggerAction, updateTriggerAction, deleteTriggerAction } from '@/lib/actions';

type Props = { initial: WidgetTriggerRow[] };

export function TriggersPanel({ initial }: Props) {
  const [items, setItems] = useState<WidgetTriggerRow[]>(initial);
  const [showNew, setShowNew] = useState(items.length === 0);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [seconds, setSeconds] = useState<string>('20');
  const [urlPattern, setUrlPattern] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function createTrigger() {
    setError(null);
    if (!name.trim() || !message.trim()) {
      setError('Name and message are required.');
      return;
    }
    const secs = seconds ? Number(seconds) : undefined;
    const conditions: { secondsOnPage?: number; urlPattern?: string } = {};
    if (secs && Number.isFinite(secs) && secs >= 1) conditions.secondsOnPage = secs;
    if (urlPattern.trim()) conditions.urlPattern = urlPattern.trim();
    if (Object.keys(conditions).length === 0) {
      setError('Pick at least one condition (seconds on page or URL contains).');
      return;
    }
    startTransition(async () => {
      const res = await createTriggerAction({ name: name.trim(), message: message.trim(), conditions });
      if ('error' in res && res.error) { setError(res.error); return; }
      if ('trigger' in res && res.trigger) {
        setItems((prev) => [...prev, res.trigger!]);
        setName('');
        setMessage('');
        setSeconds('20');
        setUrlPattern('');
        setShowNew(false);
      }
    });
  }

  function toggleEnabled(t: WidgetTriggerRow) {
    const next = !t.enabled;
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: next } : x)));
    startTransition(async () => {
      await updateTriggerAction(t.id, { enabled: next });
    });
  }

  function remove(id: string) {
    if (!confirm('Delete this trigger?')) return;
    setItems((prev) => prev.filter((x) => x.id !== id));
    startTransition(() => { void deleteTriggerAction(id); });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No triggers yet.</p>
        ) : items.map((t) => (
          <div key={t.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {t.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-2 italic">&ldquo;{t.message}&rdquo;</p>
                <p className="text-[11px] text-gray-500 mt-2">
                  Fires after{' '}
                  {t.conditions.secondsOnPage != null ? <><span className="font-numeric">{t.conditions.secondsOnPage}</span>s on page</> : 'any time'}
                  {t.conditions.urlPattern && <> · URL contains <code className="font-mono">{t.conditions.urlPattern}</code></>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleEnabled(t)} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">
                  {t.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => remove(t.id)} className="text-xs px-2 py-1 border border-rose-200 text-rose-700 rounded hover:bg-rose-50">
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
          Add trigger
        </button>
      )}

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-900">New trigger</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="Checkout nudge"
                className="w-full text-sm border border-gray-200 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Seconds on page</label>
              <input
                type="number"
                min={1}
                value={seconds}
                onChange={(e) => setSeconds(e.currentTarget.value)}
                className="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL contains (optional)</label>
            <input
              value={urlPattern}
              onChange={(e) => setUrlPattern(e.currentTarget.value)}
              placeholder="/checkout or /pricing"
              className="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono"
            />
            <p className="text-[11px] text-gray-400 mt-1">Wrap in <code className="font-mono">/…/</code> to use a regex.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Message the widget opens with</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.currentTarget.value)}
              placeholder="Need help finishing checkout? I'm here."
              rows={2}
              className="w-full text-sm border border-gray-200 rounded px-3 py-2"
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={createTrigger}
              disabled={isPending}
              className="text-sm px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60"
            >
              {isPending ? 'Creating…' : 'Create trigger'}
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
    </div>
  );
}
