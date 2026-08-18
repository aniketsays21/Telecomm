'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addSourceAction, deleteSourceAction } from '@/lib/actions';

function AddBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
    >
      {pending ? 'Adding…' : label}
    </button>
  );
}

type Source = { id: string; type: string; name: string; status: string };
type Props = {
  sources: Source[];
  onSourceAdded: (src: Source) => void;
  onSourceRemoved: (id: string) => void;
  onDone: () => void;
};

const SOURCE_TYPES = [
  { value: 'website', label: 'Website / help center URL', placeholder: 'https://help.yourbrand.com', icon: '🌐' },
  { value: 'file', label: 'Upload a file', placeholder: 'PDF, DOCX, TXT', icon: '📄' },
];

export function SourcesStep({ sources, onSourceAdded, onSourceRemoved, onDone }: Props) {
  const [activeType, setActiveType] = useState<'website' | 'file'>('website');
  const [addState, addAction] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const result = await addSourceAction(prev, fd);
      if (result && 'success' in result) {
        // optimistic: add a placeholder source
        const name = fd.get('name') as string;
        const type = fd.get('type') as string;
        onSourceAdded({ id: Date.now().toString(), type, name, status: 'pending' });
      }
      return result;
    },
    undefined
  );

  async function remove(id: string) {
    await deleteSourceAction(id);
    onSourceRemoved(id);
  }

  return (
    <div className="p-8">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
          <span className="text-purple-600 text-lg">📚</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Add your knowledge base</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            The AI uses these to answer customer questions. Add help docs, your website, or upload files.
          </p>
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex gap-2 mb-5">
        {SOURCE_TYPES.map(st => (
          <button
            key={st.value}
            onClick={() => setActiveType(st.value as 'website' | 'file')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeType === st.value
                ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span>{st.icon}</span> {st.label}
          </button>
        ))}
      </div>

      {/* Add form */}
      <form action={addAction} className="flex gap-2 mb-6">
        <input type="hidden" name="type" value={activeType} />
        {activeType === 'website' ? (
          <>
            <input type="hidden" name="name" value="" />
            <input
              name="url"
              type="url"
              required
              placeholder="https://help.yourbrand.com"
              onChange={e => {
                // auto-fill name from URL
                const nameInput = e.currentTarget.form?.querySelector('[name="name"]') as HTMLInputElement;
                if (nameInput) nameInput.value = e.currentTarget.value;
              }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </>
        ) : (
          <input
            name="name"
            type="text"
            required
            placeholder="My help docs.pdf"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        )}
        <AddBtn label="Add" />
      </form>

      {addState && 'error' in addState && (
        <p className="text-sm text-red-600 mb-4">{addState.error}</p>
      )}

      {/* Sources list */}
      {sources.length > 0 && (
        <div className="space-y-2 mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Added sources</p>
          {sources.map(src => (
            <div key={src.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-lg">{src.type === 'website' ? '🌐' : '📄'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{src.name}</p>
                <p className="text-xs text-gray-400 capitalize">{src.type} · {src.status === 'pending' ? 'Queued for indexing' : src.status}</p>
              </div>
              <button
                onClick={() => remove(src.id)}
                className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          {sources.length === 0
            ? 'Add at least one source so the AI has something to work from.'
            : `${sources.length} source${sources.length > 1 ? 's' : ''} added. You can add more later.`}
        </p>
        <button
          onClick={onDone}
          disabled={sources.length === 0}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
