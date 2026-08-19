import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { webhooks, webhookDeliveries } from '@telecomm/db/schema';
import { requireAdmin } from '../../middleware/auth.js';
import { generateWebhookSecret } from '../../lib/webhooks.js';

const KNOWN_EVENTS = [
  'conversation.created',
  'conversation.resolved',
  'conversation.escalated',
  'message.created',
  'message.agent_reply',
] as const;

const createBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(KNOWN_EVENTS)).default([]),
  description: z.string().max(500).optional(),
});

const updateBody = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(KNOWN_EVENTS)).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/webhooks', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.workspaceId, session.workspaceId))
      .orderBy(desc(webhooks.createdAt));
    return {
      webhooks: rows,
      events: KNOWN_EVENTS,
    };
  });

  app.post('/webhooks', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const body = createBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const [row] = await db.insert(webhooks).values({
      workspaceId: session.workspaceId,
      url: body.data.url,
      events: body.data.events,
      description: body.data.description,
      secret: generateWebhookSecret(),
      createdBy: session.userId,
    }).returning();
    // Return the secret ONCE at creation. The list endpoint returns it too
    // (admins need it to verify signatures), so this is the same secret they'll
    // see again — no rotation-hiding flow yet.
    return reply.code(201).send({ webhook: row });
  });

  app.patch('/webhooks/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const body = updateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    await db.update(webhooks)
      .set(body.data)
      .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, session.workspaceId)));
    return { ok: true };
  });

  app.delete('/webhooks/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    await db.delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, session.workspaceId)));
    return reply.code(204).send();
  });

  // Deliveries: newest 50 attempts for a webhook, for the admin log view.
  app.get('/webhooks/:id/deliveries', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const rows = await db
      .select({
        id: webhookDeliveries.id,
        event: webhookDeliveries.event,
        statusCode: webhookDeliveries.statusCode,
        error: webhookDeliveries.error,
        attempt: webhookDeliveries.attempt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookId, id), eq(webhookDeliveries.workspaceId, session.workspaceId)))
      .orderBy(desc(webhookDeliveries.deliveredAt))
      .limit(50);
    return { deliveries: rows };
  });
};
