import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { SlaSettings } from '@/components/settings/SlaSettings';

export const dynamic = 'force-dynamic';

export default async function SlaSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/inbox');

  const workspace = await api.getWorkspace(session.token);
  const chatHours = (workspace.settings.defaultSlaChat ?? 4 * 3600) / 3600;
  const emailHours = (workspace.settings.defaultSlaEmail ?? 8 * 3600) / 3600;

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">SLA Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set response deadlines for new conversations. Breached conversations show a red badge in the inbox,
          and assigned agents receive an email alert.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <SlaSettings chatHours={chatHours} emailHours={emailHours} />
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm font-medium text-amber-800 mb-1">How SLA works</p>
        <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
          <li>The SLA clock starts when a new conversation is created.</li>
          <li>Conversations within 30 minutes of breach show an orange "SLA at risk" badge.</li>
          <li>Breached conversations show a red "SLA breached" badge in the inbox list.</li>
          <li>If a conversation is assigned to an agent, they receive an email alert when the SLA breaches.</li>
          <li>Defaults: 4 h for chat, 8 h for email.</li>
        </ul>
      </div>
    </div>
  );
}
