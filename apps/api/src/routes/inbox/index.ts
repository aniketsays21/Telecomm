import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations, messages, contacts, users } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';
import { broadcastToWorkspace } from '../ws/index.js';
import { sendMail, isEmailConfigured, sendCsatRequest } from '../../lib/mailer.js';

export async function inboxRoutes(app: FastifyInstance) {
  // GET /inbox/conversations?status=open&limit=25&cursor=<id>
  app.get('/inbox/conversations', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const query = z.object({
      status: z.enum(['open', 'snoozed', 'resolved', 'all']).default('open'),
      channel: z.enum(['chat', 'email']).optional(),
      assigneeId: z.string().uuid().optional(),
      q: z.string().max(200).optional(),
      limit: z.coerce.number().min(1).max(50).default(25),
      cursor: z.string().uuid().optional(),
    }).parse(request.query);

    const filters = [
      eq(conversations.workspaceId, session.workspaceId),
      query.status !== 'all' ? eq(conversations.status, query.status as any) : undefined,
      query.channel ? eq(conversations.channel, query.channel) : undefined,
      query.assigneeId ? eq(conversations.assigneeId, query.assigneeId) : undefined,
      query.cursor
        ? sql`${conversations.lastMessageAt} < (SELECT last_message_at FROM conversations WHERE id = ${query.cursor}::uuid)`
        : undefined,
      // Full-text search: match contact name, email, or subject
      query.q
        ? or(
            ilike(contacts.name, `%${query.q}%`),
            ilike(contacts.email, `%${query.q}%`),
            ilike(conversations.subject, `%${query.q}%`),
          )
        : undefined,
    ].filter(Boolean) as any[];

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
      .where(and(...filters))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(query.limit);

    return { conversations: rows, hasMore: rows.length === query.limit };
  });

  // GET /inbox/conversations/export — CSV download (same filters, no pagination)
  app.get('/inbox/conversations/export', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const query = z.object({
      status: z.enum(['open', 'snoozed', 'resolved', 'all']).default('open'),
      channel: z.enum(['chat', 'email']).optional(),
      assigneeId: z.string().uuid().optional(),
      q: z.string().max(200).optional(),
    }).parse(request.query);

    const filters = [
      eq(conversations.workspaceId, session.workspaceId),
      query.status !== 'all' ? eq(conversations.status, query.status as any) : undefined,
      query.channel ? eq(conversations.channel, query.channel) : undefined,
      query.assigneeId ? eq(conversations.assigneeId, query.assigneeId) : undefined,
      query.q
        ? or(
            ilike(contacts.name, `%${query.q}%`),
            ilike(contacts.email, `%${query.q}%`),
            ilike(conversations.subject, `%${query.q}%`),
          )
        : undefined,
    ].filter(Boolean) as any[];

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        channel: conversations.channel,
        subject: conversations.subject,
        aiHandled: conversations.aiHandled,
        escalatedAt: conversations.escalatedAt,
        escalationReason: conversations.escalationReason,
        priority: conversations.priority,
        sentiment: conversations.sentiment,
        tags: conversations.tags,
        csatRating: conversations.csatRating,
        firstResponseAt: conversations.firstResponseAt,
        resolvedAt: conversations.resolvedAt,
        createdAt: conversations.createdAt,
        lastMessageAt: conversations.lastMessageAt,
        contactName: contacts.name,
        contactEmail: contacts.email,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(...filters))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(10000);

    function esc(v: unknown): string {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }

    const header = [
      'id', 'status', 'channel', 'subject', 'contact_name', 'contact_email',
      'priority', 'sentiment', 'tags', 'csat_rating', 'ai_handled',
      'escalated_at', 'escalation_reason', 'first_response_at', 'resolved_at',
      'created_at', 'last_message_at',
    ].join(',');

    const lines = rows.map(r => [
      esc(r.id),
      esc(r.status),
      esc(r.channel),
      esc(r.subject),
      esc(r.contactName),
      esc(r.contactEmail),
      esc(r.priority),
      esc(r.sentiment),
      esc(r.tags?.join(';')),
      esc(r.csatRating),
      esc(r.aiHandled),
      esc(r.escalatedAt?.toISOString()),
      esc(r.escalationReason),
      esc(r.firstResponseAt?.toISOString()),
      esc(r.resolvedAt?.toISOString()),
      esc(r.createdAt.toISOString()),
      esc(r.lastMessageAt?.toISOString()),
    ].join(','));

    const csv = [header, ...lines].join('\n');
    const filename = `conversations-${new Date().toISOString().slice(0, 10)}.csv`;

    return reply
      .type('text/csv')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
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

    // Fetch contact for email replies
    const contactRows = await db
      .select({ email: contacts.email, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, conv.contactId))
      .limit(1);
    const contact = contactRows[0];

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

    // Send email reply if this is an email conversation and SMTP is configured
    if (!body.data.isInternalNote && conv.channel === 'email' && contact?.email && isEmailConfigured()) {
      try {
        await sendMail({
          to: contact.email,
          subject: conv.subject ? `Re: ${conv.subject}` : 'Re: Your support request',
          text: body.data.body,
          inReplyTo: conv.emailThreadId ?? undefined,
          references: conv.emailThreadId ?? undefined,
        });
      } catch (err: any) {
        app.log.error({ err }, 'Failed to send email reply');
      }
    }

    // Broadcast to all dashboard clients connected to this workspace
    broadcastToWorkspace(session.workspaceId, { type: 'message', conversationId: id, message: msg });

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

    // Send CSAT email when resolving a conversation that has a contact email
    if (body.data.status === 'resolved') {
      const contactRows = await db
        .select({ email: contacts.email })
        .from(contacts)
        .where(eq(contacts.id, updated.contactId))
        .limit(1);
      const contactEmail = contactRows[0]?.email;
      if (contactEmail) {
        const subject = updated.subject ?? 'your recent support request';
        sendCsatRequest({ to: contactEmail, conversationId: id, subject }).catch(
          (err: any) => app.log.error({ err }, 'Failed to send CSAT email'),
        );
      }
    }

    return updated;
  });
}
