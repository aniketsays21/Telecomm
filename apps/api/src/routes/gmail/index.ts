import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { gmailAccounts, gmailRoutingRules, users } from '@telecomm/db/schema';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { buildAuthUrl, exchangeCode, signState, verifyState, GMAIL_SCOPE, redirectUri } from '../../lib/gmail-oauth.js';
import { encrypt } from '../../lib/gmail-crypto.js';
import { getProfile } from '../../lib/gmail-client.js';
import { webUrl } from '../../lib/urls.js';

const ruleBody = z.object({
  name: z.string().min(1).max(120),
  subjectPattern: z.string().min(1).max(500),
  matchMode: z.enum(['contains', 'starts_with', 'exact', 'regex']),
  assigneeId: z.string().uuid(),
  priority: z.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
});

export const gmailRoutes: FastifyPluginAsync = async (app) => {
  // ---- Status -------------------------------------------------------------
  app.get('/gmail/status', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;
    const [account] = await db
      .select({
        id: gmailAccounts.id,
        emailAddress: gmailAccounts.emailAddress,
        connectedAt: gmailAccounts.connectedAt,
        lastPolledAt: gmailAccounts.lastPolledAt,
        lastError: gmailAccounts.lastError,
        historyId: gmailAccounts.historyId,
      })
      .from(gmailAccounts)
      .where(eq(gmailAccounts.workspaceId, session.workspaceId))
      .limit(1);
    // Return the redirect URI too, so the UI can show admins the exact URL
    // to register in Google Cloud Console — the #1 cause of failed connects
    // is a mismatched or missing redirect URI.
    return { connected: !!account, account: account ?? null, redirectUri: redirectUri() };
  });

  // ---- OAuth start --------------------------------------------------------
  app.get('/gmail/oauth/start', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    // Guard early: without env vars set, the auth URL builds but Google
    // returns redirect_uri_mismatch / invalid_client. Say so plainly instead.
    try {
      const state = await signState({ workspaceId: session.workspaceId, userId: session.userId });
      const url = buildAuthUrl(state);
      return { url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  // ---- OAuth callback -----------------------------------------------------
  // Google redirects the browser here with ?code=&state=. We exchange the
  // code, learn which mailbox this is, and store it against the workspace
  // encoded in `state`. Then we bounce the browser back to /settings/gmail.
  const settingsUrl = () => `${webUrl()}/settings/gmail`;

  app.get('/gmail/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = z.object({
      code: z.string().min(1).optional(),
      state: z.string().min(1).optional(),
      error: z.string().optional(),
    }).safeParse(request.query);
    if (!q.success) return reply.redirect(`${settingsUrl()}?error=bad_request`);

    if (q.data.error) return reply.redirect(`${settingsUrl()}?error=${encodeURIComponent(q.data.error)}`);
    if (!q.data.code || !q.data.state) return reply.redirect(`${settingsUrl()}?error=missing_params`);

    let sessionState: Awaited<ReturnType<typeof verifyState>>;
    try {
      sessionState = await verifyState(q.data.state);
    } catch (err) {
      app.log.warn({ err }, 'gmail oauth: bad state');
      return reply.redirect(`${settingsUrl()}?error=bad_state`);
    }

    let tokens;
    try {
      tokens = await exchangeCode(q.data.code);
    } catch (err) {
      app.log.error({ err }, 'gmail oauth: token exchange failed');
      return reply.redirect(`${settingsUrl()}?error=token_exchange`);
    }

    if (!tokens.refresh_token) {
      // Should not happen because we set prompt=consent, but be explicit.
      return reply.redirect(`${settingsUrl()}?error=no_refresh_token`);
    }

    // Learn the actual mailbox we're connecting + get the initial historyId.
    let profile;
    try {
      profile = await getProfile(tokens.access_token);
    } catch (err) {
      app.log.error({ err }, 'gmail oauth: profile fetch failed');
      return reply.redirect(`${settingsUrl()}?error=profile`);
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Upsert — a workspace can only have one connected Gmail at a time.
    // Reconnecting replaces the previous credentials in-place.
    await db
      .insert(gmailAccounts)
      .values({
        workspaceId: sessionState.workspaceId,
        emailAddress: profile.emailAddress,
        googleUserId: profile.emailAddress, // openid `sub` would be better, but email is stable + unique per Gmail
        accessToken: tokens.access_token,
        accessTokenExpiresAt: expiresAt,
        refreshTokenEncrypted: encrypt(tokens.refresh_token),
        scope: tokens.scope || GMAIL_SCOPE,
        historyId: profile.historyId,
        connectedByUserId: sessionState.userId,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: gmailAccounts.workspaceId,
        set: {
          emailAddress: profile.emailAddress,
          googleUserId: profile.emailAddress,
          accessToken: tokens.access_token,
          accessTokenExpiresAt: expiresAt,
          refreshTokenEncrypted: encrypt(tokens.refresh_token),
          scope: tokens.scope || GMAIL_SCOPE,
          historyId: profile.historyId,
          connectedByUserId: sessionState.userId,
          lastError: null,
        },
      });

    return reply.redirect(`${settingsUrl()}?connected=1`);
  });

  // ---- Disconnect ---------------------------------------------------------
  app.post('/gmail/disconnect', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    await db.delete(gmailAccounts).where(eq(gmailAccounts.workspaceId, session.workspaceId));
    return { ok: true };
  });

  // ---- Rules --------------------------------------------------------------
  app.get('/gmail/rules', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;
    const rows = await db
      .select({
        id: gmailRoutingRules.id,
        name: gmailRoutingRules.name,
        subjectPattern: gmailRoutingRules.subjectPattern,
        matchMode: gmailRoutingRules.matchMode,
        assigneeId: gmailRoutingRules.assigneeId,
        priority: gmailRoutingRules.priority,
        enabled: gmailRoutingRules.enabled,
        createdAt: gmailRoutingRules.createdAt,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(gmailRoutingRules)
      .leftJoin(users, eq(users.id, gmailRoutingRules.assigneeId))
      .where(eq(gmailRoutingRules.workspaceId, session.workspaceId))
      .orderBy(asc(gmailRoutingRules.priority), asc(gmailRoutingRules.createdAt));
    return { rules: rows };
  });

  app.post('/gmail/rules', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const body = ruleBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    // Verify assignee belongs to workspace.
    const [assignee] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, body.data.assigneeId), eq(users.workspaceId, session.workspaceId)))
      .limit(1);
    if (!assignee) return reply.code(400).send({ error: 'Assignee is not a member of this workspace' });

    // Regex mode: compile early so a bad pattern is rejected on save, not at match time.
    if (body.data.matchMode === 'regex') {
      try { new RegExp(body.data.subjectPattern, 'i'); }
      catch { return reply.code(400).send({ error: 'Invalid regex' }); }
    }

    const [row] = await db.insert(gmailRoutingRules).values({
      workspaceId: session.workspaceId,
      name: body.data.name,
      subjectPattern: body.data.subjectPattern,
      matchMode: body.data.matchMode,
      assigneeId: body.data.assigneeId,
      priority: body.data.priority,
      enabled: body.data.enabled,
    }).returning();
    return reply.code(201).send({ rule: row });
  });

  app.patch('/gmail/rules/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const body = ruleBody.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const patch = body.data;
    if (patch.matchMode === 'regex' && patch.subjectPattern) {
      try { new RegExp(patch.subjectPattern, 'i'); }
      catch { return reply.code(400).send({ error: 'Invalid regex' }); }
    }
    if (patch.assigneeId) {
      const [assignee] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, patch.assigneeId), eq(users.workspaceId, session.workspaceId)))
        .limit(1);
      if (!assignee) return reply.code(400).send({ error: 'Assignee is not a member of this workspace' });
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'No fields to update' });

    await db.update(gmailRoutingRules)
      .set(patch)
      .where(and(eq(gmailRoutingRules.id, id), eq(gmailRoutingRules.workspaceId, session.workspaceId)));
    return { ok: true };
  });

  app.delete('/gmail/rules/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    await db.delete(gmailRoutingRules)
      .where(and(eq(gmailRoutingRules.id, id), eq(gmailRoutingRules.workspaceId, session.workspaceId)));
    return reply.code(204).send();
  });
};
