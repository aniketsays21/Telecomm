'use client';

import { useActionState } from 'react';
import { updateSlaSettingsAction } from '@/lib/actions';

type Props = {
  chatHours: number;
  emailHours: number;
};

export function SlaSettings({ chatHours, emailHours }: Props) {
  const [state, action, pending] = useActionState(updateSlaSettingsAction, undefined);

  return (
    <form action={action} className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Chat SLA (hours)
          </label>
          <input
            type="number"
            name="chatHours"
            min="0.5"
            max="720"
            step="0.5"
            defaultValue={chatHours}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
          />
          <p className="text-xs text-gray-400 mt-1">First response deadline for chat conversations</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email SLA (hours)
          </label>
          <input
            type="number"
            name="emailHours"
            min="0.5"
            max="720"
            step="0.5"
            defaultValue={emailHours}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
          />
          <p className="text-xs text-gray-400 mt-1">First response deadline for email conversations</p>
        </div>
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-green-600">SLA settings saved.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
