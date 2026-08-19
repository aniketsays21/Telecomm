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

  // POST /kb/sources/seed-samples — load a ready-made course-creator help
  // centre into the caller's workspace as REAL knowledge (not demo data, so
  // it survives the demo toggle). Idempotent: skips articles already present
  // by name. Each becomes a manual source → the ingest worker chunks + indexes
  // it, so the widget AI can answer from it immediately.
  app.post('/kb/sources/seed-samples', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const existing = await db
      .select({ name: sources.name })
      .from(sources)
      .where(eq(sources.workspaceId, session.workspaceId));
    const existingNames = new Set(existing.map((s) => s.name));

    let created = 0;
    for (const article of SAMPLE_COURSE_KB) {
      if (existingNames.has(article.name)) continue;
      const [source] = await db.insert(sources).values({
        workspaceId: session.workspaceId,
        type: 'manual',
        name: article.name,
        config: { content: article.content },
        status: 'pending',
      }).returning();
      created++;
      ingestQueue
        .add('ingest-source', { sourceId: source.id }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        })
        .catch((err) => request.log.error({ err, sourceId: source.id }, 'Failed to enqueue sample ingest'));
    }

    return { ok: true, created, alreadyPresent: SAMPLE_COURSE_KB.length - created };
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

/**
 * Ready-made help-centre content for a course-creator / masterclass business.
 * Loaded on demand via POST /kb/sources/seed-samples so a new workspace can
 * see the AI answer real questions without crawling a site first. Each entry
 * becomes one manual KB source (one searchable document).
 */
const SAMPLE_COURSE_KB: Array<{ name: string; content: string }> = [
  {
    name: 'Live session timings & schedule',
    content:
      'Live session timings and schedule. ' +
      'Live masterclass sessions run every week on Tuesday and Thursday at 7:00 PM IST (1:30 PM UTC). ' +
      'Cohort-based courses meet on Saturdays at 11:00 AM IST. ' +
      'You will receive the exact date and time for your enrolled session in your confirmation email and again as a reminder 24 hours and 1 hour before the session starts. ' +
      'The join link for every live session appears on your course dashboard under "Upcoming sessions" and is also emailed to you 30 minutes before it begins. ' +
      'If you cannot attend live, every session is recorded and the recording is added to your dashboard within 24 hours.',
  },
  {
    name: 'How to join a live session (join link)',
    content:
      'How to join a live session and where to find the join link. ' +
      'To join a live masterclass: 1) Log in to your account, 2) Open the course from "My Courses", 3) Click the "Join live session" button on the course dashboard — it turns green and becomes clickable 15 minutes before the session starts. ' +
      'The same join link is emailed to you 30 minutes before the session and is available under "Upcoming sessions" on your dashboard. ' +
      'Sessions are hosted on Zoom — no separate Zoom account is needed, the link opens directly in your browser or the Zoom app. ' +
      'If the join button is greyed out, the session has not opened yet; if the link says "expired", the session has ended and the recording will be posted within 24 hours.',
  },
  {
    name: 'Refund policy & how to get a refund',
    content:
      'Refund policy and how to request a refund. ' +
      'We offer a 7-day money-back guarantee on all courses and masterclasses. ' +
      'You are eligible for a full refund if you request it within 7 days of purchase AND have completed less than 25% of the course content. ' +
      'To request a refund, email support with your order ID and the email address used at purchase, or use the "Request refund" option under Account → Orders. ' +
      'Approved refunds are processed within 5–7 business days back to your original payment method. ' +
      'Cohort-based programs and live bootcamps can be refunded up to 48 hours before the first live session; after the first session begins they are non-refundable. ' +
      'Downloadable digital products (templates, ebooks) are non-refundable once downloaded.',
  },
  {
    name: 'Accessing course content & recordings',
    content:
      'Accessing your course content, materials, and recordings. ' +
      'All purchased courses appear under "My Courses" once you log in. ' +
      'Recordings of live sessions are added to the same course dashboard within 24 hours of the session ending, under the "Recordings" tab. ' +
      'You have lifetime access to self-paced course recordings and materials. ' +
      'Live cohort recordings are available for 12 months from your enrolment date. ' +
      'Downloadable resources (slides, worksheets, templates) are under the "Resources" tab of each lesson. ' +
      'If a lesson appears locked, it unlocks either on its scheduled release date (for drip-content courses) or after you complete the previous module.',
  },
  {
    name: 'Certificates of completion',
    content:
      'Certificates of completion. ' +
      'You earn a certificate of completion once you finish 100% of the course lessons and pass the final assessment (where applicable) with a score of 70% or higher. ' +
      'Your certificate is generated automatically and appears under Account → Certificates, from where you can download it as a PDF or share a verification link on LinkedIn. ' +
      'Certificates include your name as it appears on your account — update your name under Account → Profile before completing the course if needed. ' +
      'Live masterclasses issue a certificate of attendance if you attend at least 80% of the live session.',
  },
  {
    name: 'Payments, invoices & GST',
    content:
      'Payments, invoices, and GST. ' +
      'We accept all major credit and debit cards, UPI, net banking, and international cards. EMI options are available on select cards for courses above a certain price. ' +
      'A GST invoice is emailed automatically within 24 hours of purchase. To include your GSTIN on the invoice, enter it at checkout or add it under Account → Billing before purchasing. ' +
      'If your payment failed but money was deducted, it is an authorization hold and will be auto-reversed by your bank within 5–7 business days — no action needed. ' +
      'For any billing discrepancy, contact support with your order ID.',
  },
  {
    name: 'Transferring or rescheduling your enrolment',
    content:
      'Transferring or rescheduling your enrolment. ' +
      'If you cannot attend the cohort you enrolled in, you can transfer to the next available cohort at no cost, as long as you request it at least 48 hours before your cohort starts. ' +
      'To transfer, go to Account → Orders → "Reschedule enrolment", or contact support with your order ID and preferred cohort. ' +
      'Enrolments are personal and cannot be transferred to another person. ' +
      'Self-paced courses do not need rescheduling — you can start and progress any time with lifetime access.',
  },
  {
    name: 'Login & account access issues',
    content:
      'Login and account access help. ' +
      'If you cannot log in: use "Forgot password" on the login page to receive a reset link (valid for 30 minutes; check spam if it does not arrive in 2 minutes). ' +
      'Make sure you are logging in with the same email address you used at purchase — course access is tied to that email. ' +
      'If you purchased with one email but want access on another, contact support to merge or move your enrolment. ' +
      'Your account works on web, and on our mobile app (iOS and Android) — log in with the same credentials. ' +
      'If a course you paid for is missing from "My Courses", confirm you are on the correct account, then contact support with your order ID and we will restore access.',
  },
];
