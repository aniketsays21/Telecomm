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
  redirect('/inbox');
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
  redirect('/inbox');
}

export async function logoutAction() {
  await clearSession();
  redirect('/login');
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
