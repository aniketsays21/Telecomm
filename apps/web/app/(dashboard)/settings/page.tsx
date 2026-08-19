import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function SettingsPage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');
  redirect('/settings/team');
}
