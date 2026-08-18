import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@telecomm/db';
import { users } from '@telecomm/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { randomBytes } from 'crypto';

const inviteBody = z.object({
  email: z.string().email(),
  name: z.string().min(2).optional(),
  role: z.enum(['agent', 'readonly']).default('agent'),
});

export const usersRoutes: FastifyPluginAsync = async (app) => {
  // GET /users/me
  app.get('/users/me', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const [user] = await db.select({
      id: users.id, email: users.email, name: users.name, role: users.role, status: users.status,
    }).from(users).where(eq(users.id, request.session.userId)).limit(1);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    return user;
  });

  // GET /users — list workspace members (admin only)
  app.get('/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const members = await db.select({
      id: users.id, email: users.email, name: users.name, role: users.role, status: users.status,
      availability: users.availability, inviteAcceptedAt: users.inviteAcceptedAt, createdAt: users.createdAt,
    }).from(users).where(eq(users.workspaceId, request.session.workspaceId));
    return members;
  });

  // POST /users/invite — admin invites a teammate
  app.post('/users/invite', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const body = inviteBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    // Prevent duplicate invite for same email in same workspace
    const existing = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.workspaceId, request.session.workspaceId), eq(users.email, body.data.email)))
      .limit(1);
    if (existing.length) return reply.code(409).send({ error: 'This email is already a member' });

    const inviteToken = randomBytes(32).toString('hex');
    const [invited] = await db.insert(users).values({
      workspaceId: request.session.workspaceId,
      email: body.data.email,
      name: body.data.name ?? body.data.email.split('@')[0],
      role: body.data.role,
      inviteToken,
      invitedBy: request.session.userId,
    }).returning({ id: users.id, email: users.email, name: users.name, role: users.role, inviteToken: users.inviteToken });

    // TODO: send invite email via Postmark when key is configured
    const inviteLink = `${process.env.WEB_URL ?? 'http://localhost:3000'}/invite/${inviteToken}`;
    return reply.code(201).send({ ...invited, inviteLink });
  });

  // DELETE /users/:id — admin removes a member
  app.delete('/users/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (id === request.session.userId) return reply.code(400).send({ error: 'Cannot remove yourself' });
    await db.delete(users).where(and(eq(users.id, id), eq(users.workspaceId, request.session.workspaceId)));
    return reply.code(204).send();
  });
};
