import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { GmailConnectPanel } from '@/components/settings/GmailConnectPanel';
import { GmailRulesPanel } from '@/components/settings/GmailRulesPanel';

type Props = { searchParams: Promise<{ connected?: string; error?: string }> };

export default async function GmailSettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  const { connected, error } = await searchParams;

  const [status, rules, members] = await Promise.all([
    api.gmailStatus(session.token).catch(() => ({ connected: false, account: null, redirectUri: '', redirectUriMisconfigured: false })),
    api.gmailListRules(session.token).catch(() => ({ rules: [] })),
    api.listUsers(session.token).catch(() => []),
  ]);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Gmail</h1>
      <p className="text-gray-500 mb-8">
        Connect a support Gmail account, and route matching emails into Telecomm.
      </p>

      {connected === '1' && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Connected! Emails matching your rules will start appearing in the inbox within a minute.
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          Couldn&apos;t connect Gmail: <span className="font-mono">{error}</span>
        </div>
      )}

      <GmailConnectPanel initial={status} />

      <div className="mt-8">
        <GmailRulesPanel initialRules={rules.rules} members={members} connected={status.connected} />
      </div>
    </div>
  );
}
