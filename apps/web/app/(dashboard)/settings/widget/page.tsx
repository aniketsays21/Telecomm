import { getSession } from '@/lib/session';
import { api } from '@/lib/api';
import { WidgetSettings } from '@/components/widget/WidgetSettings';
import { WidgetSandbox } from '@/components/widget/WidgetSandbox';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function WidgetSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const workspace = await api.getWorkspace(session.token);
  const settings = workspace.settings;

  const color = settings.widgetColor ?? '#4f46e5';
  const greeting = settings.widgetGreeting ?? '';
  const botName = settings.botName ?? '';
  const previewUrl = settings.widgetPreviewUrl ?? '';

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Widget Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Customize the chat widget that appears on your website.</p>
      </div>

      {/* Live preview sandbox */}
      <section>
        <h2 className="text-base font-medium text-gray-800 mb-3">Live Preview</h2>
        <WidgetSandbox
          workspaceId={workspace.id}
          color={color}
          greeting={greeting}
          botName={botName}
          previewUrl={previewUrl}
          position={settings.widgetPosition ?? 'bottom-right'}
        />
      </section>

      {/* Settings form */}
      <section>
        <h2 className="text-base font-medium text-gray-800 mb-4">Customize</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <WidgetSettings settings={settings} workspaceId={workspace.id} />
        </div>
      </section>
    </div>
  );
}
