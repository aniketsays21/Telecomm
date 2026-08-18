import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@telecomm/db';
import { workspaces } from '@telecomm/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';

const updateBody = z.object({
  name: z.string().min(2).optional(),
  settings: z.record(z.unknown()).optional(),
  businessHours: z.object({
    timezone: z.string(),
    schedule: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string(), close: z.string() })),
  }).optional(),
});

export const workspacesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/workspaces/current', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, request.session.workspaceId)).limit(1);
    if (!ws) return reply.code(404).send({ error: 'Not found' });
    return ws;
  });

  app.patch('/workspaces/current', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = updateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.name) updates.name = body.data.name;
    if (body.data.settings) updates.settings = body.data.settings;
    if (body.data.businessHours) updates.businessHours = body.data.businessHours;

    const [updated] = await db.update(workspaces).set(updates as Parameters<typeof db.update>[0])
      .where(eq(workspaces.id, request.session.workspaceId)).returning();
    return updated;
  });
};
