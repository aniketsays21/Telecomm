import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { cannedResponses } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';

export async function cannedRoutes(app: FastifyInstance) {
  // GET /canned-responses
  app.get('/canned-responses', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const rows = await db
      .select()
      .from(cannedResponses)
      .where(eq(cannedResponses.workspaceId, session.workspaceId))
      .orderBy(cannedResponses.createdAt);

    return { responses: rows };
  });

  // POST /canned-responses
  app.post('/canned-responses', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const schema = z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1),
      shortcut: z.string().max(50).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }

    const { title, body, shortcut } = parsed.data;

    const [row] = await db
      .insert(cannedResponses)
      .values({
        workspaceId: session.workspaceId,
        title,
        body,
        tags: shortcut ? [shortcut] : [],
        createdBy: session.userId,
      })
      .returning();

    reply.status(201).send({ response: row });
  });

  // DELETE /canned-responses/:id
  app.delete('/canned-responses/:id', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const result = await db
      .delete(cannedResponses)
      .where(and(
        eq(cannedResponses.id, id),
        eq(cannedResponses.workspaceId, session.workspaceId)
      ))
      .returning();

    if (!result.length) {
      reply.status(404).send({ error: 'Not found' });
      return;
    }

    return { ok: true };
  });
}
