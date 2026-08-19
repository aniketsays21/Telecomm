import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/inbox');

  const [data, me, gmailStatus] = await Promise.all([
    api.getOnboarding(session.token).catch(() => null),
    api.me(session.token).catch(() => null),
    api.gmailStatus(session.token).catch(() => ({ connected: false, account: null })),
  ]);
  if (!data) redirect('/inbox');

  // If already live, send to dashboard
  if (data.isLive) redirect('/analytics');

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-4">
          <span className="text-white text-xl font-bold">T</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Set up your workspace</h1>
        <p className="text-gray-500 mt-1 text-sm">Takes about 5 minutes. You can always change these later.</p>
      </div>

      <OnboardingWizard
        initialData={data}
        workspaceName={session.name}
        initialAvailability={me?.availability ?? null}
        initialGmailAddress={gmailStatus.connected ? (gmailStatus.account?.emailAddress ?? null) : null}
      />
    </div>
  );
}
