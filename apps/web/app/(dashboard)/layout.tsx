import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bone)' }}>
      <Sidebar role={session.role} name={session.name} email={session.email} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
