'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
    >
      {pending ? 'Please wait…' : label}
    </button>
  );
}

type Props = {
  action: (formData: FormData) => Promise<{ error: string } | void>;
  submitLabel: string;
  children: React.ReactNode;
};

export function AuthForm({ action, submitLabel, children }: Props) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {children}
      {state && 'error' in state && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{state.error}</p>
      )}
      <SubmitButton label={submitLabel} />
    </form>
  );
}
