import { Worker } from 'bullmq';
import { db } from '@telecomm/db';
import { chunks } from '@telecomm/db/schema';
import { QUEUES } from '@telecomm/shared';
import { embedTexts } from '@telecomm/ai';
import { eq, inArray } from 'drizzle-orm';

const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export function startEmbedWorker() {
  const worker = new Worker(
    QUEUES.EMBED,
    async (job) => {
      const { chunkId } = job.data as { chunkId: string };

      const [chunk] = await db
        .select({ id: chunks.id, content: chunks.content })
        .from(chunks)
        .where(eq(chunks.id, chunkId))
        .limit(1);

      if (!chunk) return { error: 'Chunk not found' };

      const [embedding] = await embedTexts([chunk.content]);

      // pgvector column expects a number[]; embedTexts already returns number[][].
      // The old `as unknown as string` cast would have written the array's
      // toString() representation and produced malformed vectors at runtime.
      await db
        .update(chunks)
        .set({ embedding })
        .where(eq(chunks.id, chunkId));

      return { ok: true };
    },
    {
      connection: redisConnection,
      concurrency: 5, // embed 5 chunks in parallel
    },
  );

  worker.on('completed', job => console.log(`[embed] Chunk ${job.data.chunkId} embedded`));
  worker.on('failed', (job, err) => console.error(`[embed] Job ${job?.id} failed:`, err.message));

  return worker;
}
