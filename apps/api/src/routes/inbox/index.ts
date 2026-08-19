import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations, messages, contacts, users, conversationSummaries, contactPageViews } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';
import { broadcastToWorkspace } from '../ws/index.js';
import {
  sendMail,
  isEmailConfigured,
  sendCsatRequest,
  buildOutboundMessageId,
} from '../../lib/mailer.js';
import { loadWorkspaceSender } from '../../lib/workspace-email.js';
import { buildReferences } from '../../lib/inbound-email.js';
import { isNotNull } from 'drizzle-orm';
import { getFreshAccessToken } from '../../lib/gmail-oauth.js';
import { sendMessage as gmailSend, GmailApiError } from '../../lib/gmail-client.js';

/**
 * Newest message in the thread that carries a Message-ID, so an agent reply can
 * be anchored to it via In-Reply-To/References and stay in the same thread in
 * the customer's mail client.
 */
async function latestEmailMessage(conversationId: string) {
  const [row] = await db
    .select({
      emailMessageId: messages.emailMessageId,
      emailReferences: messages.emailReferences,
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNotNull(messages.emailMessageId)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row;
}

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
        slaDueAt: conversations.slaDueAt,
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

    const [summary] = await db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, id))
      .limit(1);

    // Recent pages this contact has visited on the customer's site — capped so
    // long-running visitors don't drown the sidebar. Ordered newest first.
    const journeyRows = await db
      .select({
        id: contactPageViews.id,
        url: contactPageViews.url,
        path: contactPageViews.path,
        title: contactPageViews.title,
        referrer: contactPageViews.referrer,
        viewedAt: contactPageViews.viewedAt,
      })
      .from(contactPageViews)
      .where(eq(contactPageViews.contactId, contact.id))
      .orderBy(desc(contactPageViews.viewedAt))
      .limit(30);

    const journey = journeyRows.map((r) => ({
      ...r,
      viewedAt: r.viewedAt.toISOString(),
    }));

    return { conversation: conv, contact, messages: thread, summary: summary ?? null, journey };
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

    // Agent replies go out under the workspace's own verified sender, never the
    // platform address. Resolve it before inserting so the outbound Message-ID
    // can be derived from the sending domain and persisted with the message.
    const replyToEmail =
      !body.data.isInternalNote && conv.channel === 'email' ? contact?.email ?? undefined : undefined;
    const isEmailReply = !!replyToEmail;
    const sender = isEmailReply ? await loadWorkspaceSender(session.workspaceId) : {};

    // Most recent outbound/inbound email in this thread, so the reply carries a
    // correct In-Reply-To and References chain.
    const parent = isEmailReply ? await latestEmailMessage(id) : undefined;
    const outboundMessageId = isEmailReply
      ? buildOutboundMessageId(sender.from ?? 'noreply@telecomm.local')
      : undefined;
    const outboundReferences = isEmailReply
      ? buildReferences(
          parent?.emailReferences ? parent.emailReferences.split(/\s+/) : [],
          parent?.emailMessageId ?? conv.emailThreadId ?? undefined,
        )
      : undefined;

    const [msg] = await db.insert(messages).values({
      conversationId: id,
      workspaceId: session.workspaceId,
      authorType: 'agent',
      authorId: session.userId,
      body: body.data.body,
      isInternalNote: body.data.isInternalNote,
      emailMessageId: outboundMessageId,
      emailInReplyTo: parent?.emailMessageId ?? undefined,
      emailReferences: outboundReferences,
    }).returning();

    if (!body.data.isInternalNote) {
      await db.update(conversations).set({
        lastMessageAt: new Date(),
        firstResponseAt: conv.firstResponseAt ?? new Date(),
      }).where(eq(conversations.id, id));
    }

    // Send the reply out. Branch on the mail transport this conversation
    // lives on: Gmail-born threads send via the connected mailbox so they
    // stay in the customer's Gmail thread; everything else uses the existing
    // Postmark/SMTP path.
    if (replyToEmail) {
      const subject = conv.subject
        ? (/^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject}`)
        : 'Re: Your support request';

      if (conv.emailProvider === 'gmail') {
        try {
          const { accessToken } = await getFreshAccessToken(session.workspaceId);
          const sent = await gmailSend(accessToken, {
            to: replyToEmail,
            subject,
            bodyText: body.data.body,
            threadId: conv.emailThreadId ?? undefined,
            inReplyTo: parent?.emailMessageId ?? undefined,
            references: outboundReferences ?? undefined,
          });
          // Persist the Gmail message id as our emailMessageId so the poller's
          // dedup on messages.emailMessageId no-ops when this send re-appears
          // through history.
          if (sent.id) {
            await db.update(messages)
              .set({ emailMessageId: sent.id })
              .where(eq(messages.id, msg.id));
          }
        } catch (err) {
          const detail = err instanceof GmailApiError ? err.body : err instanceof Error ? err.message : String(err);
          app.log.error({ err: detail }, 'Failed to send Gmail reply');
          await db.update(messages)
            .set({ deliveryState: 'failed' })
            .where(eq(messages.id, msg.id));
        }
      } else if (isEmailConfigured()) {
        try {
          const info = await sendMail({
            to: replyToEmail,
            from: sender.from,
            fromName: sender.fromName,
            subject,
            text: body.data.body,
            messageId: outboundMessageId,
            inReplyTo: parent?.emailMessageId ?? conv.emailThreadId ?? undefined,
            references: outboundReferences ?? conv.emailThreadId ?? undefined,
          });
          const delivered = info?.messageId?.replace(/^<|>$/g, '');
          if (delivered && delivered !== outboundMessageId) {
            await db.update(messages)
              .set({ emailMessageId: delivered })
              .where(eq(messages.id, msg.id));
          }
        } catch (err: any) {
          app.log.error({ err }, 'Failed to send email reply');
          await db.update(messages)
            .set({ deliveryState: 'failed' })
            .where(eq(messages.id, msg.id));
        }
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
        // CSAT reaches the customer, so it must come from the brand's address —
        // not the platform sender.
        loadWorkspaceSender(session.workspaceId)
          .then((sender) =>
            sendCsatRequest({
              to: contactEmail,
              conversationId: id,
              subject,
              from: sender.from,
              fromName: sender.fromName,
              messageId: buildOutboundMessageId(sender.from ?? 'noreply@telecomm.local'),
            }),
          )
          .catch((err: any) => app.log.error({ err }, 'Failed to send CSAT email'));
      }
    }

    return updated;
  });
}
