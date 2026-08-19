'use server';

import { redirect } from 'next/navigation';
import { api } from './api';
import { setSession, clearSession } from './session';

// ---- Custom domains -------------------------------------------------------

export async function addDomainAction(hostname: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await api.createDomain(session.token, hostname);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/domains');
    return { domain: res.domain };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not add domain' };
  }
}

export async function verifyDomainAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await api.verifyDomain(session.token, id);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/domains');
    return res;
  } catch (e: any) {
    return { error: e?.message ?? 'Verification failed' };
  }
}

export async function deleteDomainAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  await api.deleteDomain(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/domains');
}

// ---- Demo mode ------------------------------------------------------------

export async function demoStatusAction(): Promise<{ enabled: boolean; seededConversations: number } | { error: string }> {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    return await api.demoStatus(session.token);
  } catch (e: any) {
    return { error: e?.message ?? 'Could not read demo status' };
  }
}

export async function demoEnableAction() {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await api.demoEnable(session.token);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/', 'layout');
    return { ...res, ok: true as const };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not enable demo mode' };
  }
}

export async function demoDisableAction() {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await api.demoDisable(session.token);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/', 'layout');
    return { ...res, ok: true as const };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not disable demo mode' };
  }
}

// ---- Webhooks -------------------------------------------------------------

export async function createWebhookAction(input: { url: string; events: string[]; description?: string }) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await api.createWebhook(session.token, input);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/webhooks');
    return { webhook: res.webhook };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not create webhook' };
  }
}

export async function updateWebhookAction(
  id: string,
  patch: Partial<{ url: string; events: string[]; enabled: boolean; description: string }>,
) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    await api.updateWebhook(session.token, id, patch);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/webhooks');
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not update webhook' };
  }
}

export async function deleteWebhookAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  await api.deleteWebhook(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/webhooks');
}

// ---- Proactive triggers ---------------------------------------------------

export async function createTriggerAction(input: {
  name: string;
  message: string;
  conditions: { secondsOnPage?: number; urlPattern?: string };
  enabled?: boolean;
}) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await api.createTrigger(session.token, input);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/triggers');
    return { trigger: res.trigger };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not create trigger' };
  }
}

export async function updateTriggerAction(
  id: string,
  patch: Partial<{ name: string; message: string; conditions: { secondsOnPage?: number; urlPattern?: string }; enabled: boolean }>,
) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    await api.updateTrigger(session.token, id, patch);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/triggers');
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not update trigger' };
  }
}

export async function deleteTriggerAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  await api.deleteTrigger(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/triggers');
}

export async function suggestReplyAction(conversationId: string): Promise<
  { draft: string; sources: Array<{ title: string; url: string | null }> } | { error: string }
> {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    return await api.suggestReply(session.token, conversationId);
  } catch (e: any) {
    return { error: e?.message ?? 'Could not draft a reply.' };
  }
}

// useActionState passes (prevState, formData) — prevState is first arg
export async function signupAction(_prev: unknown, formData: FormData) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const workspaceName = formData.get('workspaceName') as string;

  try {
    const res = await api.signup({ name, email, password, workspaceName });
    await setSession({
      token: res.token,
      userId: res.user.id,
      role: res.user.role as 'admin',
      workspaceId: res.workspace!.id,
      name: res.user.name,
      email: res.user.email,
    });
  } catch (e: any) {
    return { error: e.message };
  }
  redirect('/onboarding');
}

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  try {
    const res = await api.login({ email, password });
    await setSession({
      token: res.token,
      userId: res.user.id,
      role: res.user.role as 'admin' | 'agent',
      workspaceId: res.workspace?.id ?? '',
      name: res.user.name,
      email: res.user.email,
    });
  } catch (e: any) {
    return { error: e.message };
  }
  // Agents go straight to inbox; admins go through onboarding if not complete
  redirect('/inbox');
}

export async function acceptInviteAction(token: string, _prev: unknown, formData: FormData) {
  const name = formData.get('name') as string;
  const password = formData.get('password') as string;

  try {
    const res = await api.acceptInvite({ token, name, password });
    await setSession({
      token: res.token,
      userId: res.user.id,
      role: res.user.role as 'agent',
      workspaceId: '',
      name: res.user.name,
      email: res.user.email,
    });
  } catch (e: any) {
    return { error: e.message };
  }
  redirect('/onboarding');
}

export async function logoutAction() {
  await clearSession();
  redirect('/login');
}

export async function connectEmailAction(_prev: unknown, formData: FormData) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const supportEmail = formData.get('supportEmail') as string;
  try {
    const { api } = await import('./api');
    const res = await api.connectEmail(session.token, supportEmail);
    return { success: true, inboundEmail: res.inboundEmail, instructions: res.forwardingInstructions };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function addSourceAction(_prev: unknown, formData: FormData) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const type = formData.get('type') as string;
  const nameField = formData.get('name') as string | null;
  const url = formData.get('url') as string | null;
  const file = formData.get('file') as File | null;

  // File uploads arrive as multipart/form-data. We base64-encode server-side
  // and forward as `content` — the API accepts either a URL (crawled) or an
  // inline content string (indexed directly). 25 MB is the hard cap.
  let name = nameField ?? '';
  let content: string | undefined;
  let fileName: string | undefined;
  let fileMime: string | undefined;
  if (type === 'file') {
    if (!file || file.size === 0) return { error: 'Choose a file to upload.' };
    if (file.size > 25 * 1024 * 1024) {
      return { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.` };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    content = buf.toString('base64');
    fileName = file.name;
    fileMime = file.type || 'application/octet-stream';
    if (!name) name = file.name;
  }

  try {
    const { api } = await import('./api');
    await api.addSource(session.token, {
      type,
      name,
      url: url ?? undefined,
      ...(content ? { content, fileName, fileMime } : {}),
    });
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function deleteSourceAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.deleteSource(session.token, id);
}

export async function markWidgetSeenAction() {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.markWidgetSeen(session.token);
}

export async function completeOnboardingAction() {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  const { api } = await import('./api');
  try {
    await api.completeOnboarding(session.token);
  } catch (e: any) {
    return { error: e?.message ?? 'Could not complete onboarding' };
  }
  // Caller navigates on the client — a server-side redirect inside a
  // useTransition would get swallowed and leave the button "Publishing…"
  // forever. Returning success lets the client do a router.push cleanly.
  return { ok: true, next: session.role === 'admin' ? '/analytics' : '/inbox' };
}

export async function sendMessageAction(conversationId: string, body: string, isInternalNote = false) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.sendMessage(session.token, conversationId, { body, isInternalNote });
  const { revalidatePath } = await import('next/cache');
  revalidatePath(`/inbox/${conversationId}`);
}

export async function updateConversationAction(
  conversationId: string,
  updates: { status?: 'open' | 'snoozed' | 'resolved'; assigneeId?: string | null; tags?: string[] }
) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.updateConversation(session.token, conversationId, updates);
  const { revalidatePath } = await import('next/cache');
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath('/inbox');
}

export async function kbCreateSourceAction(_prev: unknown, formData: FormData) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const type = formData.get('type') as string;
  const nameField = formData.get('name') as string | null;
  const startUrl = formData.get('startUrl') as string | null;
  let content = (formData.get('content') as string | null) ?? undefined;
  const file = formData.get('file') as File | null;

  // File type gets forwarded as base64-encoded `content` (same path the
  // onboarding step uses). 25 MB hard cap; anything larger is rejected here
  // before we hit Next's server-action body limit.
  if (type === 'file') {
    if (!file || file.size === 0) return { error: 'Choose a file to upload.' };
    if (file.size > 25 * 1024 * 1024) {
      return { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.` };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    content = buf.toString('base64');
  }
  const name = nameField || (type === 'file' ? file?.name ?? 'Uploaded doc' : 'Untitled');

  try {
    const { api } = await import('./api');
    await api.createSource(session.token, {
      type,
      name,
      startUrl: startUrl || undefined,
      content: content || undefined,
    });
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/knowledge');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function kbDeleteSourceAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.deleteKbSource(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/knowledge');
}

export async function kbSyncSourceAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.syncSource(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/knowledge');
}

export async function updateWidgetSettingsAction(
  _prev: unknown,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const color = formData.get('widgetColor') as string | null;
  const greeting = formData.get('widgetGreeting') as string | null;
  const botName = formData.get('botName') as string | null;
  const position = formData.get('widgetPosition') as string | null;
  const previewUrlRaw = (formData.get('widgetPreviewUrl') as string | null)?.trim() ?? '';
  // Empty string clears the preview URL; anything else must parse as an http(s) URL.
  let previewUrlPatch: { widgetPreviewUrl: string } | undefined;
  if (previewUrlRaw === '') {
    previewUrlPatch = { widgetPreviewUrl: '' };
  } else {
    try {
      const u = new URL(previewUrlRaw.match(/^https?:\/\//i) ? previewUrlRaw : `https://${previewUrlRaw}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      previewUrlPatch = { widgetPreviewUrl: u.toString() };
    } catch {
      return { error: 'Preview URL must be a valid website address (e.g. https://example.com).' };
    }
  }

  try {
    const { api } = await import('./api');
    await api.updateWorkspaceSettings(session.token, {
      ...(color ? { widgetColor: color } : {}),
      ...(greeting ? { widgetGreeting: greeting } : {}),
      ...(botName ? { botName } : {}),
      ...(position ? { widgetPosition: position as 'bottom-right' | 'bottom-left' } : {}),
      ...(previewUrlPatch ?? {}),
    });
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/widget');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function updateSlaSettingsAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const chatHours = Number(formData.get('chatHours'));
  const emailHours = Number(formData.get('emailHours'));

  if (!Number.isFinite(chatHours) || chatHours < 0.5 || chatHours > 720) {
    return { error: 'Chat SLA must be between 0.5 and 720 hours' };
  }
  if (!Number.isFinite(emailHours) || emailHours < 0.5 || emailHours > 720) {
    return { error: 'Email SLA must be between 0.5 and 720 hours' };
  }

  try {
    const { api } = await import('./api');
    const ws = await api.getWorkspace(session.token);
    await api.updateWorkspaceSettings(session.token, {
      ...ws.settings,
      defaultSlaChat: Math.round(chatHours * 3600),
      defaultSlaEmail: Math.round(emailHours * 3600),
    });
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/sla');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function cannedCreateAction(_prev: unknown, formData: FormData) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const title = formData.get('title') as string;
  const body = formData.get('body') as string;
  const shortcut = formData.get('shortcut') as string | null;

  try {
    const { api } = await import('./api');
    await api.createCannedResponse(session.token, { title, body, shortcut: shortcut || undefined });
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/canned');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function cannedDeleteAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  const { api } = await import('./api');
  await api.deleteCannedResponse(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/canned');
}

export async function updateMyAvailabilityAction(availability: {
  timezone: string;
  schedule: Array<{ day: 0 | 1 | 2 | 3 | 4 | 5 | 6; open: string; close: string }>;
}) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    await api.updateMe(session.token, { availability });
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/team');
    revalidatePath('/onboarding');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function updateTeamMemberAction(
  id: string,
  patch: Partial<{
    name: string;
    role: string;
    maxConcurrentChats: number;
    availability: {
      timezone: string;
      schedule: Array<{ day: 0 | 1 | 2 | 3 | 4 | 5 | 6; open: string; close: string }>;
    };
  }>,
) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    await api.updateUser(session.token, id, patch);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/team');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

// ---- Gmail --------------------------------------------------------------
export async function gmailStartOAuthAction() {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const { url } = await api.gmailStartOAuth(session.token);
    return { url };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function gmailDisconnectAction() {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    await api.gmailDisconnect(session.token);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/gmail');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function gmailCreateRuleAction(body: {
  name: string;
  subjectPattern: string;
  matchMode: 'contains' | 'starts_with' | 'exact' | 'regex';
  assigneeId: string;
  priority?: number;
  enabled?: boolean;
}) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const { rule } = await api.gmailCreateRule(session.token, body);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/gmail');
    return { success: true, rule };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function gmailUpdateRuleAction(id: string, patch: Partial<{
  name: string; subjectPattern: string;
  matchMode: 'contains' | 'starts_with' | 'exact' | 'regex';
  assigneeId: string; priority: number; enabled: boolean;
}>) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    await api.gmailUpdateRule(session.token, id, patch);
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/settings/gmail');
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function gmailDeleteRuleAction(id: string) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return;
  await api.gmailDeleteRule(session.token, id);
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/settings/gmail');
}

export async function inviteUserAction(_prev: unknown, formData: FormData) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const email = formData.get('email') as string;
  const name = formData.get('name') as string;
  const role = formData.get('role') as string;

  try {
    const res = await api.inviteUser(session.token, { email, name, role });
    return { success: true, inviteLink: res.inviteLink, emailSent: res.emailSent, emailError: res.emailError };
  } catch (e: any) {
    return { error: e.message };
  }
}
