import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { sources } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';
import { Queue } from 'bullmq';
import { QUEUES } from '@telecomm/shared';
import { redisConnection } from '../../lib/redis.js';

const ingestQueue = new Queue(QUEUES.INGEST, { connection: redisConnection() });

export async function knowledgeRoutes(app: FastifyInstance) {
  // GET /kb/sources — list all sources for the workspace
  app.get('/kb/sources', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const rows = await db
      .select()
      .from(sources)
      .where(eq(sources.workspaceId, session.workspaceId))
      .orderBy(sources.createdAt);

    return { sources: rows };
  });

  // POST /kb/sources — create a source and immediately enqueue ingestion
  app.post('/kb/sources', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const body = z.object({
      type: z.enum(['website', 'file', 'manual']),
      name: z.string().min(1).max(200),
      // Website source: crawl from startUrl
      startUrl: z.string().url().optional(),
      // Manual/file source: inline content
      content: z.string().optional(),
      fileName: z.string().optional(),
      fileMime: z.string().optional(),
    }).safeParse(request.body);

    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { type, name, startUrl, content, fileName, fileMime } = body.data;

    const config: Record<string, unknown> = {};
    if (startUrl) config.startUrl = startUrl;
    if (content) config.content = content;
    if (fileName) config.fileName = fileName;
    if (fileMime) config.fileMime = fileMime;

    const [source] = await db.insert(sources).values({
      workspaceId: session.workspaceId,
      type,
      name,
      config,
      status: 'pending',
    }).returning();

    ingestQueue
      .add('ingest-source', { sourceId: source.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      })
      .catch((err) => request.log.error({ err, sourceId: source.id }, 'Failed to enqueue ingest job'));

    return reply.code(201).send({ source });
  });

  // POST /kb/sources/:id/sync — re-trigger ingestion for an existing source
  app.post('/kb/sources/:id/sync', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, id), eq(sources.workspaceId, session.workspaceId)))
      .limit(1);

    if (!source) return reply.code(404).send({ error: 'Source not found' });

    await db.update(sources).set({ status: 'pending', lastError: null }).where(eq(sources.id, id));

    ingestQueue
      .add('ingest-source', { sourceId: id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      })
      .catch((err) => request.log.error({ err, sourceId: id }, 'Failed to enqueue ingest job'));

    return { queued: true, sourceId: id };
  });

  // DELETE /kb/sources/:id — remove a source (cascades to documents + chunks)
  app.delete('/kb/sources/:id', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const [source] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, id), eq(sources.workspaceId, session.workspaceId)))
      .limit(1);

    if (!source) return reply.code(404).send({ error: 'Source not found' });

    await db.delete(sources).where(eq(sources.id, id));
    return reply.code(204).send();
  });
}
