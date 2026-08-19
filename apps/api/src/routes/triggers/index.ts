import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { widgetTriggers } from '@telecomm/db/schema';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';

/**
 * Proactive chat triggers — rules the widget evaluates client-side to open
 * the chat with a pre-written greeting. v1 supports "N seconds on this page"
 * and "URL contains X" as the only conditions; both stored as JSON so we
 * can grow the DSL without a migration per rule type.
 */

const conditionsSchema = z
  .object({
    secondsOnPage: z.number().int().min(1).max(3600).optional(),
    urlPattern: z.string().min(1).max(500).optional(),
  })
  .refine((c) => c.secondsOnPage != null || c.urlPattern, {
    message: 'A trigger needs at least one condition (secondsOnPage or urlPattern).',
  });

const triggerBody = z.object({
  name: z.string().min(1).max(120),
  message: z.string().min(1).max(500),
  conditions: conditionsSchema,
  enabled: z.boolean().default(true),
});

export const triggersRoutes: FastifyPluginAsync = async (app) => {
  // Admin CRUD ---------------------------------------------------------------
  app.get('/triggers', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;
    const rows = await db
      .select()
      .from(widgetTriggers)
      .where(eq(widgetTriggers.workspaceId, session.workspaceId))
      .orderBy(asc(widgetTriggers.createdAt));
    return { triggers: rows };
  });

  app.post('/triggers', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const body = triggerBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const [row] = await db.insert(widgetTriggers).values({
      workspaceId: session.workspaceId,
      name: body.data.name,
      message: body.data.message,
      conditions: body.data.conditions,
      enabled: body.data.enabled,
      createdBy: session.userId,
    }).returning();
    return reply.code(201).send({ trigger: row });
  });

  app.patch('/triggers/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const body = triggerBody.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    await db.update(widgetTriggers)
      .set(body.data)
      .where(and(eq(widgetTriggers.id, id), eq(widgetTriggers.workspaceId, session.workspaceId)));
    return { ok: true };
  });

  app.delete('/triggers/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    await db.delete(widgetTriggers)
      .where(and(eq(widgetTriggers.id, id), eq(widgetTriggers.workspaceId, session.workspaceId)));
    return reply.code(204).send();
  });

  // Public — the widget calls this on load with the workspace id so it can
  // evaluate triggers client-side. Only returns enabled rows and only the
  // fields the widget needs (no createdBy / createdAt / etc).
  app.get('/widget/triggers', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const q = z.object({ workspaceId: z.string().uuid() }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const rows = await db
      .select({
        id: widgetTriggers.id,
        message: widgetTriggers.message,
        conditions: widgetTriggers.conditions,
      })
      .from(widgetTriggers)
      .where(and(eq(widgetTriggers.workspaceId, q.data.workspaceId), eq(widgetTriggers.enabled, true)));
    return { triggers: rows };
  });
};
