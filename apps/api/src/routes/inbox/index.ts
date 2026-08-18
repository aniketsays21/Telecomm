import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations, messages, contacts, users } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';

export async function inboxRoutes(app: FastifyInstance) {
  // GET /inbox/conversations?status=open&limit=25&cursor=<id>
  app.get('/inbox/conversations', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const query = z.object({
      status: z.enum(['open', 'snoozed', 'resolved']).default('open'),
      limit: z.coerce.number().min(1).max(50).default(25),
      cursor: z.string().uuid().optional(),
    }).parse(request.query);

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        channel: conversations.channel,
        subject: conversations.subject,
        aiHandled: conversations.aiHandled,
        escalatedAt: conversations.escalatedAt,
        escalationReason: conversations.escalationReason,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        contact: {
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
        },
        assigneeId: conversations.assigneeId,
        priority: conversations.priority,
        sentiment: conversations.sentiment,
        tags: conversations.tags,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(
        eq(conversations.workspaceId, session.workspaceId),
        eq(conversations.status, query.status),
        // cursor-based pagination
        query.cursor
          ? sql`${conversations.lastMessageAt} < (SELECT last_message_at FROM conversations WHERE id = ${query.cursor}::uuid)`
          : undefined,
      ))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(query.limit);

    return { conversations: rows, hasMore: rows.length === query.limit };
  });

  // GET /inbox/conversations/:id — with full message thread
  app.get('/inbox/conversations/:id', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.workspaceId, session.workspaceId)))
      .limit(1);

    if (!conv) return reply.code(404).send({ error: 'Not found' });

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conv.contactId))
      .limit(1);

    const thread = await db
      .select()
      .from(messages)
      .where(and(
        eq(messages.conversationId, id),
        eq(messages.isInternalNote, false),
      ))
      .orderBy(messages.createdAt);

    return { conversation: conv, contact, messages: thread };
  });

  // POST /inbox/conversations/:id/messages — agent reply
  app.post('/inbox/conversations/:id/messages', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const body = z.object({
      body: z.string().min(1).max(10000),
      isInternalNote: z.boolean().default(false),
    }).safeParse(request.body);

    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.workspaceId, session.workspaceId)))
      .limit(1);

    if (!conv) return reply.code(404).send({ error: 'Not found' });

    const [msg] = await db.insert(messages).values({
      conversationId: id,
      workspaceId: session.workspaceId,
      authorType: 'agent',
      authorId: session.userId,
      body: body.data.body,
      isInternalNote: body.data.isInternalNote,
    }).returning();

    if (!body.data.isInternalNote) {
      await db.update(conversations).set({
        lastMessageAt: new Date(),
        firstResponseAt: conv.firstResponseAt ?? new Date(),
      }).where(eq(conversations.id, id));
    }

    return msg;
  });

  // PATCH /inbox/conversations/:id — update status, assignee, priority
  app.patch('/inbox/conversations/:id', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const body = z.object({
      status: z.enum(['open', 'snoozed', 'resolved']).optional(),
      assigneeId: z.string().uuid().nullable().optional(),
      priority: z.number().min(0).max(3).optional(),
      tags: z.string().array().optional(),
    }).safeParse(request.body);

    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const updates: Record<string, unknown> = {};
    if (body.data.status !== undefined) {
      updates.status = body.data.status;
      if (body.data.status === 'resolved') {
        updates.resolvedAt = new Date();
        updates.resolvedBy = 'agent';
      }
    }
    if (body.data.assigneeId !== undefined) {
      updates.assigneeId = body.data.assigneeId;
      updates.assignedAt = body.data.assigneeId ? new Date() : null;
    }
    if (body.data.priority !== undefined) updates.priority = body.data.priority;
    if (body.data.tags !== undefined) updates.tags = body.data.tags;

    const [updated] = await db
      .update(conversations)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(and(eq(conversations.id, id), eq(conversations.workspaceId, session.workspaceId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'Not found' });

    return updated;
  });
}
