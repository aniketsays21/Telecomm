'use server';

import { redirect } from 'next/navigation';
import { api } from './api';
import { setSession, clearSession } from './session';

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
  const name = formData.get('name') as string;
  const url = formData.get('url') as string | null;

  try {
    const { api } = await import('./api');
    await api.addSource(session.token, { type, name, url: url ?? undefined });
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
  if (!session) redirect('/login');
  const { api } = await import('./api');
  await api.completeOnboarding(session!.token);
  redirect('/inbox');
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

export async function inviteUserAction(_prev: unknown, formData: FormData) {
  const { getSession } = await import('./session');
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const email = formData.get('email') as string;
  const name = formData.get('name') as string;
  const role = formData.get('role') as string;

  try {
    const res = await api.inviteUser(session.token, { email, name, role });
    return { success: true, inviteLink: res.inviteLink };
  } catch (e: any) {
    return { error: e.message };
  }
}
