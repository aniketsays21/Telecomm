'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { WorkspaceSettings } from '@/lib/api';
import { updateWidgetSettingsAction } from '@/lib/actions';

const PRESET_COLORS = [
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Slate', value: '#475569' },
  { label: 'Black', value: '#111827' },
];

interface Props {
  settings: WorkspaceSettings;
  workspaceId: string;
}

export function WidgetSettings({ settings, workspaceId }: Props) {
  const [state, action, pending] = useActionState(updateWidgetSettingsAction, undefined);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const currentColor = settings.widgetColor ?? '#4f46e5';
  const currentGreeting = settings.widgetGreeting ?? '';
  const currentBotName = settings.botName ?? '';
  const currentPreviewUrl = settings.widgetPreviewUrl ?? '';

  return (
    <form action={action} className="space-y-6">
      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">Settings saved successfully.</p>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Widget Color</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_COLORS.map(c => (
            <label key={c.value} className="cursor-pointer">
              <input
                type="radio"
                name="widgetColor"
                value={c.value}
                defaultChecked={currentColor === c.value}
                className="sr-only peer"
              />
              <span
                className="block w-8 h-8 rounded-full ring-2 ring-transparent peer-checked:ring-offset-2 peer-checked:ring-gray-900 transition-all"
                style={{ background: c.value }}
                title={c.label}
              />
            </label>
          ))}
          {/* Custom color */}
          <label className="cursor-pointer">
            <input
              type="radio"
              name="widgetColor"
              value="custom"
              className="sr-only peer"
              onChange={() => colorInputRef.current?.click()}
            />
            <span className="block w-8 h-8 rounded-full ring-2 ring-transparent peer-checked:ring-offset-2 peer-checked:ring-gray-900 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs">
              +
            </span>
          </label>
          <input
            ref={colorInputRef}
            type="color"
            name="widgetColorCustom"
            defaultValue={currentColor}
            className="sr-only"
          />
        </div>
      </div>

      <div>
        <label htmlFor="widgetGreeting" className="block text-sm font-medium text-gray-700 mb-1">
          Greeting Message
        </label>
        <input
          id="widgetGreeting"
          name="widgetGreeting"
          type="text"
          defaultValue={currentGreeting}
          placeholder="Hi! How can I help you today?"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-400 mt-1">The first message visitors see when they open the chat widget.</p>
      </div>

      <div>
        <label htmlFor="botName" className="block text-sm font-medium text-gray-700 mb-1">
          Bot Name
        </label>
        <input
          id="botName"
          name="botName"
          type="text"
          defaultValue={currentBotName}
          placeholder="Support Chat"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="widgetPreviewUrl" className="block text-sm font-medium text-gray-700 mb-1">
          Preview on your website
        </label>
        <input
          id="widgetPreviewUrl"
          name="widgetPreviewUrl"
          type="url"
          defaultValue={currentPreviewUrl}
          placeholder="https://yourstore.com"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-400 mt-1">
          Paste your site URL and save. The Live Preview above will render your page with the widget floating over it — the same experience your visitors will see.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
        <div className="flex gap-3">
          {(['bottom-right', 'bottom-left'] as const).map(pos => (
            <label key={pos} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="widgetPosition"
                value={pos}
                defaultChecked={(settings.widgetPosition ?? 'bottom-right') === pos}
                className="accent-indigo-600"
              />
              <span className="text-sm text-gray-600 capitalize">{pos.replace('-', ' ')}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  );
}
