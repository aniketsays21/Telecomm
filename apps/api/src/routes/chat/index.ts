import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { workspaces, contacts, conversations, messages } from '@telecomm/db/schema';
import { embedQuery, generateAnswer } from '@telecomm/ai';
import { searchChunks } from '../../lib/search.js';
import { Queue } from 'bullmq';
import { QUEUES } from '@telecomm/shared';
import { broadcastToWorkspace } from '../ws/index.js';
import { redisConnection } from '../../lib/redis.js';

const ingestQueue = new Queue(QUEUES.INGEST, { connection: redisConnection() });

export async function chatRoutes(app: FastifyInstance) {
  // POST /widget/chat  — public endpoint called by the embedded widget
  app.post('/widget/chat', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = z.object({
      workspaceId: z.string().uuid(),
      sessionId: z.string().min(8),       // random string from widget (identifies anonymous session)
      message: z.string().min(1).max(2000),
      contactEmail: z.string().email().optional(),
      contactName: z.string().optional(),
    }).safeParse(request.body);

    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { workspaceId, sessionId, message, contactEmail, contactName } = body.data;

    // Load workspace
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) return reply.code(404).send({ error: 'Workspace not found' });

    // Find or create contact (keyed by sessionId as externalId)
    let [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.externalId, sessionId)))
      .limit(1);

    if (!contact) {
      [contact] = await db.insert(contacts).values({
        workspaceId,
        externalId: sessionId,
        email: contactEmail,
        name: contactName ?? 'Visitor',
        lastSeenAt: new Date(),
      }).returning();
    } else if (contactEmail && !contact.email) {
      await db.update(contacts).set({ email: contactEmail, lastSeenAt: new Date() })
        .where(eq(contacts.id, contact.id));
    }

    // Find open conversation for this session or create one
    let [conversation] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.contactId, contact.id),
        eq(conversations.status, 'open'),
        eq(conversations.channel, 'chat'),
      ))
      .limit(1);

    if (!conversation) {
      const slaSeconds = (ws.settings as any)?.defaultSlaChat ?? 4 * 3600;
      const slaDueAt = new Date(Date.now() + slaSeconds * 1000);
      [conversation] = await db.insert(conversations).values({
        workspaceId,
        contactId: contact.id,
        channel: 'chat',
        status: 'open',
        aiHandled: true,
        lastMessageAt: new Date(),
        slaDueAt,
      }).returning();
    }

    // Save customer message
    await db.insert(messages).values({
      conversationId: conversation.id,
      workspaceId,
      authorType: 'contact',
      authorId: contact.id,
      body: message,
    });

    // RAG: embed the query → search → generate answer
    let replyText: string;
    let escalated = false;
    let aiConfidence: string | undefined;

    try {
      const queryEmbedding = await embedQuery(message);
      const chunks = await searchChunks(workspaceId, queryEmbedding, 5);
      const aiAnswer = await generateAnswer(message, chunks, ws.settings as any);

      replyText = aiAnswer.answer;
      aiConfidence = String(aiAnswer.confidence.toFixed(2));

      if (aiAnswer.shouldEscalate) {
        escalated = true;
        await db.update(conversations).set({
          aiHandled: false,
          escalatedAt: new Date(),
          escalationReason: aiAnswer.escalationReason,
          lastMessageAt: new Date(),
        }).where(eq(conversations.id, conversation.id));
      } else {
        await db.update(conversations).set({ lastMessageAt: new Date() })
          .where(eq(conversations.id, conversation.id));
      }

      // Save AI reply message
      const [aiMsg] = await db.insert(messages).values({
        conversationId: conversation.id,
        workspaceId,
        authorType: 'ai',
        body: replyText,
        aiConfidence,
        aiSources: aiAnswer.sources,
      }).returning();
      broadcastToWorkspace(workspaceId, { type: 'message', conversationId: conversation.id, message: aiMsg });

    } catch (err: any) {
      // AI unavailable — escalate gracefully
      replyText = "I'm having trouble right now. A human agent will follow up shortly.";
      escalated = true;
      await db.update(conversations).set({
        aiHandled: false,
        escalatedAt: new Date(),
        escalationReason: 'AI error: ' + err.message,
        lastMessageAt: new Date(),
      }).where(eq(conversations.id, conversation.id));

      await db.insert(messages).values({
        conversationId: conversation.id,
        workspaceId,
        authorType: 'ai',
        body: replyText,
      });
    }

    return {
      conversationId: conversation.id,
      reply: replyText,
      escalated,
      aiConfidence: aiConfidence ? parseFloat(aiConfidence) : undefined,
    };
  });

  // GET /widget/messages — poll for new messages on a conversation.
  //
  // Public endpoint so the embedded widget can pick up agent replies from the
  // dashboard without an authenticated session. Access is scoped by requiring
  // both the workspace and the customer's `sessionId` (stored in the contact's
  // externalId), so a third party cannot enumerate conversations without
  // guessing both a workspace UUID and the anonymous session token.
  app.get('/widget/messages', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const q = z.object({
      workspaceId: z.string().uuid(),
      conversationId: z.string().uuid(),
      sessionId: z.string().min(8),
      since: z.string().datetime().optional(),
    }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });

    const { workspaceId, conversationId, sessionId, since } = q.data;

    // Verify the conversation belongs to this workspace AND to this session's
    // contact — otherwise anyone with a workspaceId could read any conversation.
    const [convo] = await db
      .select({ id: conversations.id, contactId: conversations.contactId })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId),
        eq(contacts.externalId, sessionId),
      ))
      .limit(1);
    if (!convo) return reply.code(404).send({ error: 'Conversation not found' });

    const sinceDate = since ? new Date(since) : new Date(0);
    const rows = await db
      .select({
        id: messages.id,
        authorType: messages.authorType,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(
        eq(messages.conversationId, conversationId),
        // Only surface messages the customer should see; internal notes stay
        // in the agent view. `>` (not `>=`) prevents re-serving the boundary.
        eq(messages.isInternalNote, false),
      ))
      .orderBy(messages.createdAt);

    const newer = rows.filter((r) => r.createdAt.getTime() > sinceDate.getTime());
    return {
      messages: newer.map((m) => ({
        id: m.id,
        // Map the API-side taxonomy to the widget's simple two-role model:
        // contact = the customer themself (already displayed optimistically),
        // ai/agent = the "bot" side of the widget UI.
        role: m.authorType === 'contact' ? 'user' : 'bot',
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

  // POST /widget/ingest — trigger source ingestion (called from onboarding or settings)
  app.post('/widget/ingest/:sourceId', async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    ingestQueue
      .add('ingest-source', { sourceId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      })
      .catch((err) => request.log.error({ err, sourceId }, 'Failed to enqueue ingest job'));
    return { queued: true, sourceId };
  });
}
