import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { workspaces } from '@telecomm/db/schema';
import type { WorkspaceSettings } from '@telecomm/db/schema';

/**
 * The `From` identity a workspace sends under. SMTP credentials stay global —
 * only this address is per-workspace, and it must be a verified sender
 * signature on the shared Postmark server.
 */
export interface WorkspaceSender {
  from?: string;
  fromName?: string;
}

type WorkspaceLike = {
  name?: string | null;
  settings?: unknown;
};

/**
 * Resolve the outbound sender for a workspace, in priority order:
 *   1. settings.smtpFromAddress — the explicitly verified sender signature
 *   2. settings.supportEmail    — captured during onboarding, so a brand that
 *                                only finished the wizard still sends branded
 *   3. undefined                — caller falls back to the platform SMTP_FROM
 *
 * Returning `from: undefined` is deliberate: `sendMail` then uses the platform
 * sender rather than silently sending a brand's mail under another brand's
 * address.
 */
export function resolveWorkspaceSender(ws: WorkspaceLike | null | undefined): WorkspaceSender {
  if (!ws) return {};
  const settings = (ws.settings ?? {}) as WorkspaceSettings;
  const from = settings.smtpFromAddress?.trim() || settings.supportEmail?.trim();
  if (!from) return {};
  return {
    from,
    fromName: settings.smtpFromName?.trim() || ws.name?.trim() || undefined,
  };
}

/** Load a workspace and resolve its sender in one step. */
export async function loadWorkspaceSender(workspaceId: string): Promise<WorkspaceSender> {
  const [ws] = await db
    .select({ name: workspaces.name, settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return resolveWorkspaceSender(ws);
}

/**
 * Find the workspace that owns an inbound recipient address. Backs the shared
 * Postmark inbound webhook: one address/webhook for the whole platform, routed
 * to a workspace by whichever recipient of the email matches a configured
 * support address. Comparison is case-insensitive and index-backed by
 * `workspaces_support_email_key`.
 */
export async function findWorkspaceBySupportEmail(candidates: string[]) {
  if (candidates.length === 0) return undefined;
  const normalized = candidates.map((c) => c.toLowerCase());
  // inArray() expands the JS array into individual bound parameters
  // (`... IN ($1, $2, …)`), which sidesteps two adjacent Postgres pitfalls with
  // `= ANY(…)`: an untyped bound array (SQLSTATE 42809) and a record-typed
  // parameter list that can't be cast to text[] (SQLSTATE 42846).
  const matches = await db
    .select()
    .from(workspaces)
    .where(inArray(sql`lower(${workspaces.settings} ->> 'supportEmail')`, normalized));
  if (matches.length <= 1) return matches[0];
  // Mail addressed to two brands at once: prefer the most authoritative
  // recipient, which is the earliest candidate (envelope before To before Cc).
  const rank = (ws: (typeof matches)[number]) => {
    const email = ((ws.settings ?? {}) as WorkspaceSettings).supportEmail?.toLowerCase();
    const idx = email ? normalized.indexOf(email) : -1;
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...matches].sort((a, b) => rank(a) - rank(b))[0];
}
