import { acceptInviteAction } from '@/lib/actions';
import { AuthForm } from '@/components/AuthForm';

type Props = { params: Promise<{ token: string }> };

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  async function accept(prev: unknown, formData: FormData) {
    'use server';
    return acceptInviteAction(token, prev, formData);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Telecomm</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold mb-2">Accept your invite</h2>
          <p className="text-sm text-gray-500 mb-6">Set your name and password to join the workspace.</p>
          <AuthForm action={accept} submitLabel="Join workspace">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
                <input
                  name="name"
                  type="text"
                  required
                  minLength={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Min 8 characters"
                />
              </div>
            </div>
          </AuthForm>
        </div>
      </div>
    </div>
  );
}
