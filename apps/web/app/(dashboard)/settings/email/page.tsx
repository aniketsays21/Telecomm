import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { EmailSettings } from '@/components/settings/EmailSettings';

export const dynamic = 'force-dynamic';

export default async function EmailSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/inbox');

  const workspace = await api.getWorkspace(session.token);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const webhookUrl = `${apiUrl}/inbound/email/${workspace.id}`;

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Email Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure inbound email so customer emails become support conversations automatically.
        </p>
      </div>

      <EmailSettings webhookUrl={webhookUrl} workspaceId={workspace.id} />
    </div>
  );
}
