'use client';

import { useActionState, useTransition } from 'react';
import type { CannedResponse } from '@/lib/api';
import { cannedCreateAction, cannedDeleteAction } from '@/lib/actions';

function CreateForm() {
  const [state, action, pending] = useActionState(cannedCreateAction, undefined);

  return (
    <form action={action} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Add New Response</h3>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-green-600">Response added.</p>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          placeholder="e.g. Greeting"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="shortcut" className="block text-sm font-medium text-gray-700 mb-1">
          Shortcut <span className="text-gray-400 font-normal">(optional — type after /)</span>
        </label>
        <input
          id="shortcut"
          name="shortcut"
          type="text"
          placeholder="e.g. greet"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-1">Message Body</label>
        <textarea
          id="body"
          name="body"
          required
          rows={4}
          placeholder="Hi {{name}}, thanks for reaching out…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Adding…' : 'Add Response'}
      </button>
    </form>
  );
}

function ResponseRow({ response }: { response: CannedResponse }) {
  const [pending, startTransition] = useTransition();
  const shortcut = response.tags?.[0];

  return (
    <div className="flex items-start gap-4 py-4 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900">{response.title}</p>
          {shortcut && (
            <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-mono">/{shortcut}</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{response.body}</p>
      </div>
      <button
        onClick={() => startTransition(() => cannedDeleteAction(response.id))}
        disabled={pending}
        className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors shrink-0"
      >
        Delete
      </button>
    </div>
  );
}

interface Props {
  responses: CannedResponse[];
}

export function CannedManager({ responses }: Props) {
  return (
    <div className="space-y-8">
      <CreateForm />

      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Saved Responses ({responses.length})</h3>
        {responses.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-6 py-10 text-center text-sm text-gray-400">
            No canned responses yet. Add one above.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl px-6">
            {responses.map(r => <ResponseRow key={r.id} response={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
