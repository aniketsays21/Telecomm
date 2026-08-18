import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function BillingPage() {
  const session = await getSession();
  if (session?.role !== 'admin') redirect('/inbox');

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Billing</h1>
      <p className="text-gray-500 mb-8">Subscription and usage details. Coming soon.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="text-4xl mb-3">💳</div>
        <h2 className="text-lg font-semibold text-gray-700">Billing setup</h2>
        <p className="text-sm text-gray-500 mt-1">Pricing model TBD — usage-based, seat-based, or flat subscription.</p>
      </div>
    </div>
  );
}
