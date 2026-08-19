'use client';

import { useState, useEffect } from 'react';
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

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ACCEPTED_TYPES = '.pdf,.docx,.doc,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

const SOURCE_TYPES = [
  { value: 'website', label: 'Website / help center URL', placeholder: 'https://help.yourbrand.com', icon: '🌐' },
  { value: 'file', label: 'Upload a file (up to 25 MB)', placeholder: 'PDF, DOCX, TXT, MD', icon: '📄' },
];

export function SourcesStep({ sources, onSourceAdded, onSourceRemoved, onDone }: Props) {
  const [activeType, setActiveType] = useState<'website' | 'file'>('website');
  const [fileError, setFileError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  // Fake but honest progress: we don't know the real crawl duration, so we
  // ease the bar up to 90% and hold there until the user's next action. The
  // real indexing happens in a background worker.
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!indexing) return;
    const id = setInterval(() => {
      setProgress((p) => (p < 90 ? p + Math.max(1, Math.round((92 - p) / 12)) : p));
    }, 220);
    return () => clearInterval(id);
  }, [indexing]);

  const [addState, addAction] = useActionState(
    async (prev: unknown, fd: FormData) => {
      // Client-side guard for file size — anything larger will be rejected
      // by the server anyway, but this stops the upload before it starts.
      if (fd.get('type') === 'file') {
        const f = fd.get('file') as File | null;
        if (!f || f.size === 0) {
          return { error: 'Choose a file to upload.' };
        }
        if (f.size > MAX_FILE_BYTES) {
          return { error: `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.` };
        }
      }
      const result = await addSourceAction(prev, fd);
      if (result && 'success' in result) {
        // optimistic: add a placeholder source
        const name = (fd.get('name') as string) || (fd.get('file') as File | null)?.name || 'Untitled';
        const type = fd.get('type') as string;
        onSourceAdded({ id: Date.now().toString(), type, name, status: 'pending' });
      }
      return result;
    },
    undefined,
  );

  async function remove(id: string) {
    await deleteSourceAction(id);
    onSourceRemoved(id);
  }

  function handleContinue() {
    if (sources.length === 0) return;
    setIndexing(true);
    setProgress(6);
    // Give the visual feedback a beat before moving on. The AI worker keeps
    // crawling in the background; nothing depends on the bar reaching 100%
    // before advancing to the next step.
    setTimeout(() => {
      setProgress(100);
      setTimeout(() => onDone(), 400);
    }, 1400);
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
            onClick={() => { setActiveType(st.value as 'website' | 'file'); setFileError(null); }}
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
      <form action={addAction} encType="multipart/form-data" className="flex gap-2 mb-6">
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
                const nameInput = e.currentTarget.form?.querySelector('[name="name"]') as HTMLInputElement | null;
                if (nameInput) nameInput.value = e.currentTarget.value;
              }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </>
        ) : (
          <input
            name="file"
            type="file"
            required
            accept={ACCEPTED_TYPES}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              setFileError(null);
              if (!f) return;
              if (f.size > MAX_FILE_BYTES) {
                setFileError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.`);
                e.currentTarget.value = '';
              }
            }}
            className="flex-1 text-sm text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-xs file:font-medium hover:file:bg-indigo-100"
          />
        )}
        <AddBtn label="Add" />
      </form>

      {fileError && (
        <p className="text-sm text-red-600 -mt-4 mb-4">{fileError}</p>
      )}

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
                disabled={indexing}
                className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar overlay — shows while we advance to the next step */}
      {indexing && (
        <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium text-indigo-900">
              Gathering knowledge base of your website…
            </p>
            <p className="text-xs font-mono text-indigo-700">{progress}%</p>
          </div>
          <div className="h-2 w-full rounded-full bg-white/70 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11px] text-indigo-700/80 mt-2">
            We keep indexing in the background — the AI starts answering as soon as the first source is ready.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          {sources.length === 0
            ? 'Add at least one source so the AI has something to work from.'
            : `${sources.length} source${sources.length > 1 ? 's' : ''} added. You can add more later.`}
        </p>
        <button
          onClick={handleContinue}
          disabled={sources.length === 0 || indexing}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {indexing ? 'Indexing…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
