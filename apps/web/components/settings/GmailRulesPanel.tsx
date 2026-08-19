'use client';

import { useState, useTransition } from 'react';
import type { GmailRule, TeamMember } from '@/lib/api';
import {
  gmailCreateRuleAction,
  gmailUpdateRuleAction,
  gmailDeleteRuleAction,
} from '@/lib/actions';

type MatchMode = 'contains' | 'starts_with' | 'exact' | 'regex';

const MODE_LABELS: Record<MatchMode, string> = {
  contains: 'contains',
  starts_with: 'starts with',
  exact: 'is exactly',
  regex: 'matches regex',
};

type Props = {
  initialRules: GmailRule[];
  members: TeamMember[];
  connected: boolean;
};

function RuleRow({
  rule,
  members,
  onChange,
  onDelete,
}: {
  rule: GmailRule;
  members: TeamMember[];
  onChange: (patch: Partial<GmailRule>) => void;
  onDelete: () => void;
}) {
  const [, startTransition] = useTransition();

  function save(patch: Partial<GmailRule>) {
    onChange(patch);
    startTransition(() => {
      void gmailUpdateRuleAction(rule.id, patch as never);
    });
  }

  return (
    <div className="p-4 flex items-center gap-2 flex-wrap">
      <label className="flex items-center gap-2 mr-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => save({ enabled: e.currentTarget.checked })}
          className="rounded"
        />
        <span className="text-xs text-gray-500">on</span>
      </label>
      <input
        value={rule.name}
        onChange={(e) => onChange({ name: e.currentTarget.value })}
        onBlur={(e) => save({ name: e.currentTarget.value })}
        placeholder="Rule name"
        className="text-sm border border-gray-200 rounded px-2 py-1 w-36"
      />
      <span className="text-xs text-gray-400">subject</span>
      <select
        value={rule.matchMode}
        onChange={(e) => save({ matchMode: e.currentTarget.value as MatchMode })}
        className="text-sm border border-gray-200 rounded px-1.5 py-1"
      >
        {(Object.keys(MODE_LABELS) as MatchMode[]).map((m) => (
          <option key={m} value={m}>{MODE_LABELS[m]}</option>
        ))}
      </select>
      <input
        value={rule.subjectPattern}
        onChange={(e) => onChange({ subjectPattern: e.currentTarget.value })}
        onBlur={(e) => save({ subjectPattern: e.currentTarget.value })}
        placeholder={rule.matchMode === 'regex' ? '^\\[urgent\\]' : 'refund'}
        className="text-sm border border-gray-200 rounded px-2 py-1 flex-1 min-w-[8rem] font-mono"
      />
      <span className="text-xs text-gray-400">→</span>
      <select
        value={rule.assigneeId}
        onChange={(e) => save({ assigneeId: e.currentTarget.value })}
        className="text-sm border border-gray-200 rounded px-1.5 py-1"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        max={999}
        value={rule.priority}
        onChange={(e) => onChange({ priority: Number(e.currentTarget.value) })}
        onBlur={(e) => save({ priority: Number(e.currentTarget.value) })}
        className="text-sm border border-gray-200 rounded px-1.5 py-1 w-14 text-center"
        title="Priority — lower runs first"
      />
      <button
        onClick={onDelete}
        className="text-xs text-gray-400 hover:text-rose-600 px-1"
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

export function GmailRulesPanel({ initialRules, members, connected }: Props) {
  const [rules, setRules] = useState<GmailRule[]>(initialRules);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // New-rule form state
  const [nName, setNName] = useState('');
  const [nPattern, setNPattern] = useState('');
  const [nMode, setNMode] = useState<MatchMode>('contains');
  const [nAssignee, setNAssignee] = useState<string>(members[0]?.id ?? '');

  function addRule() {
    setError(null);
    if (!nName.trim() || !nPattern.trim() || !nAssignee) {
      setError('Fill in name, subject pattern, and assignee');
      return;
    }
    startTransition(async () => {
      const res = await gmailCreateRuleAction({
        name: nName.trim(),
        subjectPattern: nPattern,
        matchMode: nMode,
        assigneeId: nAssignee,
        priority: rules.length,
      });
      if ('error' in res && res.error) {
        setError(res.error);
        return;
      }
      if ('rule' in res && res.rule) {
        const member = members.find((m) => m.id === res.rule!.assigneeId);
        setRules((prev) => [
          ...prev,
          {
            ...res.rule!,
            assigneeName: member?.name ?? null,
            assigneeEmail: member?.email ?? null,
          },
        ]);
        setNName('');
        setNPattern('');
      }
    });
  }

  function updateLocal(id: string, patch: Partial<GmailRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function deleteRule(id: string) {
    if (!confirm('Delete this rule? Emails matching only this rule will stop becoming conversations.')) return;
    setRules((prev) => prev.filter((r) => r.id !== id));
    startTransition(() => {
      void gmailDeleteRuleAction(id);
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-5 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Routing rules</h2>
        <p className="text-xs text-gray-500 mt-1">
          Rules run in priority order (lower first). The first match wins and assigns the conversation to that agent.
          Emails that match no rule are silently dropped.
        </p>
      </div>

      {!connected && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
          Connect Gmail above before rules will do anything.
        </div>
      )}

      <div className="divide-y divide-gray-50">
        {rules.length === 0 && (
          <p className="p-5 text-sm text-gray-400">No rules yet. Add one below.</p>
        )}
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            members={members}
            onChange={(patch) => updateLocal(r.id, patch)}
            onDelete={() => deleteRule(r.id)}
          />
        ))}
      </div>

      <div className="p-4 bg-gray-50 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Add rule</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={nName}
            onChange={(e) => setNName(e.currentTarget.value)}
            placeholder="Rule name"
            className="text-sm border border-gray-200 rounded px-2 py-1 w-36"
          />
          <span className="text-xs text-gray-400">subject</span>
          <select
            value={nMode}
            onChange={(e) => setNMode(e.currentTarget.value as MatchMode)}
            className="text-sm border border-gray-200 rounded px-1.5 py-1"
          >
            {(Object.keys(MODE_LABELS) as MatchMode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
          <input
            value={nPattern}
            onChange={(e) => setNPattern(e.currentTarget.value)}
            placeholder={nMode === 'regex' ? '^\\[urgent\\]' : 'refund'}
            className="text-sm border border-gray-200 rounded px-2 py-1 flex-1 min-w-[8rem] font-mono"
          />
          <span className="text-xs text-gray-400">→</span>
          <select
            value={nAssignee}
            onChange={(e) => setNAssignee(e.currentTarget.value)}
            className="text-sm border border-gray-200 rounded px-1.5 py-1"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button
            onClick={addRule}
            disabled={isPending}
            className="text-sm px-3 py-1 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-60"
          >
            Add
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
