import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { InviteForm } from '@/components/InviteForm';
import { TeamMemberRow } from '@/components/settings/TeamMemberRow';

export default async function TeamPage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  const members = await api.listUsers(session.token).catch(() => []);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Team</h1>
      <p className="text-gray-500 mb-8">Set working hours and capacity so escalations route to whoever is free.</p>

      <div className="bg-white rounded-xl border border-gray-200 mb-8 divide-y divide-gray-100">
        {members.map((m) => (
          <TeamMemberRow key={m.id} member={m} />
        ))}
        {members.length === 0 && (
          <p className="p-6 text-sm text-gray-400">No members yet.</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Invite a teammate</h2>
        <InviteForm />
      </div>
    </div>
  );
}
