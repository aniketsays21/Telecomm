import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { workspaces, contacts, conversations, messages, conversationSummaries, contactPageViews } from '@telecomm/db/schema';
import { generateAnswer, summarizeConversation } from '@telecomm/ai';
import { searchChunks } from '../../lib/search.js';
import { Queue } from 'bullmq';
import { QUEUES } from '@telecomm/shared';
import { broadcastToWorkspace } from '../ws/index.js';
import { redisConnection } from '../../lib/redis.js';
import { pickBestAgent } from '../../lib/assign.js';

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
      // Load the last ~10 turns so the AI can respond in context rather than
      // treat every message as a cold open. Ordered oldest → newest.
      const priorRows = await db
        .select({ authorType: messages.authorType, body: messages.body })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(messages.createdAt);
      const history = priorRows.slice(-10).map((r) => ({
        role: (r.authorType === 'contact' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: r.body,
      }));

      const chunks = await searchChunks(workspaceId, message, 5);
      const aiAnswer = await generateAnswer(
        message,
        chunks,
        { ...(ws.settings as any), brandName: ws.name },
        history,
      );

      replyText = aiAnswer.answer;
      aiConfidence = String(aiAnswer.confidence.toFixed(2));

      // Persist anything the AI extracted from the customer's message so the
      // human agent picks up an already-identified visitor and repeat sessions
      // recognise them.
      if (aiAnswer.extracted) {
        const contactUpdate: Record<string, unknown> = {};
        if (aiAnswer.extracted.email && !contact.email) contactUpdate.email = aiAnswer.extracted.email;
        if (aiAnswer.extracted.name && (!contact.name || contact.name === 'Visitor')) {
          contactUpdate.name = aiAnswer.extracted.name;
        }
        if (Object.keys(contactUpdate).length) {
          await db.update(contacts).set(contactUpdate).where(eq(contacts.id, contact.id));
        }
      }

      // Attach the AI's inferred topic as a tag so analytics can group by it.
      // We de-dupe against existing tags to avoid growing the array unboundedly.
      const nextConvoUpdate: Record<string, unknown> = { lastMessageAt: new Date() };
      if (aiAnswer.topic) {
        const existingTags = (conversation.tags ?? []) as string[];
        if (!existingTags.includes(aiAnswer.topic)) {
          nextConvoUpdate.tags = [...existingTags, aiAnswer.topic];
        }
      }
      if (aiAnswer.shouldEscalate) {
        escalated = true;
        nextConvoUpdate.aiHandled = false;
        nextConvoUpdate.escalatedAt = new Date();
        nextConvoUpdate.escalationReason = aiAnswer.escalationReason;
        // Auto-assign to the best available agent so escalations don't sit in
        // limbo. Falls back to unassigned (null) if nobody qualifies — any
        // agent can still pick it up manually.
        if (!conversation.assigneeId) {
          try {
            const agentId = await pickBestAgent(workspaceId);
            if (agentId) {
              nextConvoUpdate.assigneeId = agentId;
              nextConvoUpdate.assignedAt = new Date();
            }
          } catch (assignErr) {
            request.log.warn({ err: assignErr, conversationId: conversation.id }, 'Auto-assign failed');
          }
        }
      }
      await db.update(conversations).set(nextConvoUpdate)
        .where(eq(conversations.id, conversation.id));

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

      // Refresh the conversation summary in the background so the agent
      // panel always has an up-to-date TL;DR. Not awaited — the customer
      // has already received their reply.
      const historyForSummary = [
        ...history,
        { role: 'user' as const, content: message },
        { role: 'assistant' as const, content: replyText },
      ];
      summarizeConversation(historyForSummary, ws.name)
        .then((s) =>
          db
            .insert(conversationSummaries)
            .values({
              conversationId: conversation.id,
              summary: s.summary,
              whatCustomerWants: s.whatCustomerWants || null,
              whatsBeenTried: s.whatsBeenTried || null,
              currentStatus: s.currentStatus || null,
              keyDetails: s.keyDetails,
              upToMessageId: aiMsg.id,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: conversationSummaries.conversationId,
              set: {
                summary: s.summary,
                whatCustomerWants: s.whatCustomerWants || null,
                whatsBeenTried: s.whatsBeenTried || null,
                currentStatus: s.currentStatus || null,
                keyDetails: s.keyDetails,
                upToMessageId: aiMsg.id,
                updatedAt: new Date(),
              },
            }),
        )
        .catch((err) => request.log.error({ err, conversationId: conversation.id }, 'Summary generation failed'));

    } catch (err: any) {
      // AI unavailable — escalate gracefully AND still auto-assign so the
      // conversation lands on a real agent's queue instead of the void.
      replyText = "I'm having trouble right now. A human agent will follow up shortly.";
      escalated = true;
      const fallbackUpdate: Record<string, unknown> = {
        aiHandled: false,
        escalatedAt: new Date(),
        escalationReason: 'AI error: ' + err.message,
        lastMessageAt: new Date(),
      };
      if (!conversation.assigneeId) {
        try {
          const agentId = await pickBestAgent(workspaceId);
          if (agentId) {
            fallbackUpdate.assigneeId = agentId;
            fallbackUpdate.assignedAt = new Date();
          }
        } catch (assignErr) {
          request.log.warn({ err: assignErr, conversationId: conversation.id }, 'Auto-assign on AI failure failed');
        }
      }
      await db.update(conversations).set(fallbackUpdate).where(eq(conversations.id, conversation.id));

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

  // POST /widget/page-view — record which page of the customer's site the
  // visitor is on. Fire-and-forget from the widget; the row is used later to
  // reconstruct the visitor's journey in the agent inbox. Anonymous by
  // sessionId (same key as chat), so a visitor who never opens the chat still
  // gets a contact row we can later merge if they identify themselves.
  app.post('/widget/page-view', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = z.object({
      workspaceId: z.string().uuid(),
      sessionId: z.string().min(8),
      url: z.string().url().max(2000),
      title: z.string().max(500).optional(),
      referrer: z.string().max(2000).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { workspaceId, sessionId, url, title, referrer } = body.data;

    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) return reply.code(404).send({ error: 'Workspace not found' });

    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return reply.code(400).send({ error: 'Invalid url' });
    }

    let [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.externalId, sessionId)))
      .limit(1);
    if (!contact) {
      [contact] = await db.insert(contacts).values({
        workspaceId,
        externalId: sessionId,
        name: 'Visitor',
        lastSeenAt: new Date(),
      }).returning({ id: contacts.id });
    } else {
      await db.update(contacts).set({ lastSeenAt: new Date() }).where(eq(contacts.id, contact.id));
    }

    await db.insert(contactPageViews).values({
      workspaceId,
      contactId: contact.id,
      sessionId,
      url,
      path,
      title,
      referrer,
    });

    return reply.code(204).send();
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
