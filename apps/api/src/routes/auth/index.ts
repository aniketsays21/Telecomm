import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@telecomm/db';
import { users, workspaces } from '@telecomm/db/schema';
import { hashPassword, verifyPassword } from '../../lib/hash.js';
import { signSession } from '../../lib/token.js';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';

const signupBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  workspaceName: z.string().min(2),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string(),
  workspaceSlug: z.string().optional(),
});

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /auth/signup — create workspace + admin user
  app.post('/auth/signup', async (request, reply) => {
    const body = signupBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { name, email, password, workspaceName } = body.data;

    // Check email not already used in this context
    const existing = await db.select({ id: users.id })
      .from(users)
      .innerJoin(workspaces, eq(users.workspaceId, workspaces.id))
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length) return reply.code(409).send({ error: 'Email already registered' });

    // Create workspace
    let slug = slugify(workspaceName);
    const slugExists = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (slugExists.length) slug = `${slug}-${randomBytes(3).toString('hex')}`;

    const [workspace] = await db.insert(workspaces).values({ name: workspaceName, slug }).returning();

    // Create admin user
    const [user] = await db.insert(users).values({
      workspaceId: workspace.id,
      email,
      name,
      passwordHash: hashPassword(password),
      role: 'admin',
      inviteAcceptedAt: new Date(),
    }).returning();

    const token = await signSession({ userId: user.id, workspaceId: workspace.id, role: 'admin' });
    return reply.code(201).send({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name } });
  });

  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const body = loginBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { email, password, workspaceSlug } = body.data;

    const query = db.select({ user: users, workspace: workspaces })
      .from(users)
      .innerJoin(workspaces, eq(users.workspaceId, workspaces.id))
      .where(workspaceSlug ? and(eq(users.email, email), eq(workspaces.slug, workspaceSlug)) : eq(users.email, email))
      .limit(1);

    const rows = await query;
    if (!rows.length) return reply.code(401).send({ error: 'Invalid credentials' });

    const { user, workspace } = rows[0];
    if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    if (!user.inviteAcceptedAt) return reply.code(403).send({ error: 'Invite not yet accepted' });

    const token = await signSession({ userId: user.id, workspaceId: workspace.id, role: user.role as 'admin' | 'agent' | 'readonly' });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name } };
  });

  // POST /auth/accept-invite — agent sets password via invite token
  app.post('/auth/accept-invite', async (request, reply) => {
    const body = z.object({ token: z.string(), password: z.string().min(8), name: z.string().min(2) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { token, password, name } = body.data;
    const [user] = await db.select().from(users).where(eq(users.inviteToken, token)).limit(1);
    if (!user) return reply.code(404).send({ error: 'Invalid or expired invite' });
    if (user.inviteAcceptedAt) return reply.code(409).send({ error: 'Invite already accepted' });

    const [updated] = await db.update(users).set({
      name,
      passwordHash: hashPassword(password),
      inviteToken: null,
      inviteAcceptedAt: new Date(),
    }).where(eq(users.id, user.id)).returning();

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1);
    const jwt = await signSession({ userId: updated.id, workspaceId: workspace.id, role: updated.role as 'admin' | 'agent' | 'readonly' });
    return reply.code(200).send({ token: jwt, user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } });
  });
};
