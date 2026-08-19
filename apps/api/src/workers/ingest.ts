import { Worker } from 'bullmq';
import { db } from '@telecomm/db';
import { sources, documents, chunks } from '@telecomm/db/schema';
import { QUEUES } from '@telecomm/shared';
import { eq } from 'drizzle-orm';
import { crawlSite } from '../lib/crawler.js';
import { chunkText } from '../lib/chunker.js';
import { createHash } from 'crypto';
import { redisConnection } from '../lib/redis.js';

// Retrieval switched from vector embeddings to Postgres full-text search
// (chunks.tsv). Chunk rows are ready for search the moment they're inserted;
// no embed queue, no async worker, no provider dependency.

export function startIngestWorker() {
  const worker = new Worker(
    QUEUES.INGEST,
    async (job) => {
      const { sourceId } = job.data as { sourceId: string };

      const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
      if (!source) return { error: 'Source not found' };

      await db.update(sources).set({ status: 'syncing' }).where(eq(sources.id, sourceId));

      try {
        if (source.type === 'website') {
          // Both onboarding and the knowledge route write the URL as
          // `config.startUrl`. Also accept `config.url` for any legacy row
          // written before the endpoints converged on startUrl.
          const cfg = (source.config as any) ?? {};
          const url = (cfg.startUrl ?? cfg.url) as string | undefined;
          if (!url) throw new Error('No URL in source config');

          let docCount = 0;
          const pages = await crawlSite(url, (page, i) => {
            job.updateProgress(Math.round((i / 25) * 50)); // 0-50% for crawling
          });

          for (let pi = 0; pi < pages.length; pi++) {
            const page = pages[pi];
            const contentHash = createHash('sha256').update(page.content).digest('hex');

            // Upsert document
            const [doc] = await db
              .insert(documents)
              .values({
                workspaceId: source.workspaceId,
                sourceId: source.id,
                title: page.title,
                url: page.url,
                content: page.content,
                contentHash,
                docType: 'page',
              })
              .onConflictDoUpdate({
                target: [documents.workspaceId, documents.sourceId, documents.url],
                set: { title: page.title, content: page.content, contentHash, updatedAt: new Date() },
              })
              .returning();

            // Delete old chunks for this document (re-chunking)
            await db.delete(chunks).where(eq(chunks.documentId, doc.id));

            // Create chunk records (embedding happens in embed worker)
            const textChunks = chunkText(page.content);
            if (textChunks.length > 0) {
              await db.insert(chunks).values(textChunks.map(c => ({
                documentId: doc.id,
                workspaceId: source.workspaceId,
                content: c.content,
                tokenCount: c.tokenCount,
                position: c.position,
              })));
            }

            docCount++;
            await job.updateProgress(50 + Math.round((pi / pages.length) * 50));
          }

          await db.update(sources).set({
            status: 'ready',
            docCount,
            lastSyncedAt: new Date(),
            lastError: null,
          }).where(eq(sources.id, sourceId));

        } else if (source.type === 'file' || source.type === 'manual') {
          // For file/manual sources, content is stored directly in config
          const content = (source.config as any)?.content as string ?? source.name;
          const contentHash = createHash('sha256').update(content).digest('hex');

          const [doc] = await db
            .insert(documents)
            .values({
              workspaceId: source.workspaceId,
              sourceId: source.id,
              title: source.name,
              content,
              contentHash,
              docType: 'file',
            })
            .returning();

          await db.delete(chunks).where(eq(chunks.documentId, doc.id));

          const textChunks = chunkText(content);
          if (textChunks.length > 0) {
            await db.insert(chunks).values(textChunks.map(c => ({
              documentId: doc.id,
              workspaceId: source.workspaceId,
              content: c.content,
              tokenCount: c.tokenCount,
              position: c.position,
            })));
          }

          await db.update(sources).set({
            status: 'ready',
            docCount: 1,
            lastSyncedAt: new Date(),
            lastError: null,
          }).where(eq(sources.id, sourceId));
        }

        return { ok: true };
      } catch (err: any) {
        await db.update(sources).set({
          status: 'error',
          lastError: err.message,
        }).where(eq(sources.id, sourceId));
        throw err;
      }
    },
    {
      connection: redisConnection(),
      concurrency: 2,
    },
  );

  worker.on('completed', job => console.log(`[ingest] Job ${job.id} done`));
  worker.on('failed', (job, err) => console.error(`[ingest] Job ${job?.id} failed:`, err.message));

  return worker;
}
