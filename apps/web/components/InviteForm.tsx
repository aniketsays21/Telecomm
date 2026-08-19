'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { inviteUserAction } from '@/lib/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
    >
      {pending ? 'Sending…' : 'Send invite'}
    </button>
  );
}

export function InviteForm() {
  const [state, formAction] = useActionState(inviteUserAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            name="name"
            type="text"
            required
            minLength={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            name="email"
            type="email"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="jane@company.com"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
        <select
          name="role"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {state && 'error' in state && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state && 'success' in state && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-100 px-3 py-2 rounded-lg space-y-1">
          {state.emailSent ? (
            <p>Invite email sent — they&apos;ll receive a link to join the workspace and set their password.</p>
          ) : (
            <p>Invite created, but the email didn&apos;t send. Share this link with them directly:</p>
          )}
          <p className="font-mono break-all text-xs text-green-900">{state.inviteLink}</p>
        </div>
      )}
      <SubmitButton />
    </form>
  );
}
