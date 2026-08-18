import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white">
      {children}
    </div>
  );
}
