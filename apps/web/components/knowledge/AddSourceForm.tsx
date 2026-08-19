'use client';

import { useActionState, useState } from 'react';
import { kbCreateSourceAction } from '@/lib/actions';

const TYPES = [
  { value: 'website', label: 'Website', desc: 'Crawl and index pages from a URL' },
  { value: 'file',    label: 'Upload document', desc: 'PDF, DOCX, TXT, MD — up to 25 MB' },
  { value: 'manual',  label: 'Manual text', desc: 'Paste in help content directly' },
];

export function AddSourceForm() {
  const [state, action, pending] = useActionState(kbCreateSourceAction, null);
  const [type, setType] = useState('website');

  return (
    <form action={action} encType="multipart/form-data" className="space-y-4">
      {/* Type selector */}
      <div className="flex gap-3">
        {TYPES.map(t => (
          <label
            key={t.value}
            className={`flex-1 flex items-start gap-3 rounded-lg border p-3.5 cursor-pointer transition-colors ${
              type === t.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="type"
              value={t.value}
              checked={type === t.value}
              onChange={() => setType(t.value)}
              className="mt-0.5 accent-indigo-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">{t.label}</p>
              <p className="text-xs text-gray-500">{t.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Source name
        </label>
        <input
          type="text"
          name="name"
          required
          placeholder={type === 'website' ? 'Help Centre' : 'FAQ document'}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {/* URL, file, or content depending on type */}
      {type === 'website' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Start URL
          </label>
          <input
            type="url"
            name="startUrl"
            required
            placeholder="https://help.yoursite.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">We&apos;ll crawl up to 500 pages starting from this URL.</p>
        </div>
      )}
      {type === 'file' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Choose a file
          </label>
          <input
            type="file"
            name="file"
            required
            accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            className="w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-xs file:font-medium hover:file:bg-indigo-100"
          />
          <p className="text-xs text-gray-400 mt-1">PDF, DOCX, TXT or MD. 25 MB maximum.</p>
        </div>
      )}
      {type === 'manual' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Content
          </label>
          <textarea
            name="content"
            required
            rows={6}
            placeholder="Paste your FAQ, knowledge base articles, or help text here…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
          />
        </div>
      )}

      {/* Feedback */}
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-green-600">Source added and queued for indexing.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add source'}
      </button>
    </form>
  );
}
