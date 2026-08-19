import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { workspaces, contacts, conversations, messages } from '@telecomm/db/schema';
import { embedQuery, generateAnswer } from '@telecomm/ai';
import { searchChunks } from '../../lib/search.js';
import { sendMail } from '../../lib/mailer.js';
import { broadcastToWorkspace } from '../ws/index.js';

export async function inboundEmailRoutes(app: FastifyInstance) {
  // POST /inbound/email/:workspaceId
  // Public webhook — no JWT required. Each workspace gets a unique URL.
  // Accepts: our own JSON format, Postmark inbound JSON, or Mailgun/SendGrid form posts.
  // Configure your email provider's inbound webhook to POST to this URL.
  app.post<{ Params: { workspaceId: string } }>(
    '/inbound/email/:workspaceId',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const raw = request.body as Record<string, any>;

      // Normalize fields — compatible with Postmark, Mailgun, SendGrid, and plain JSON
      const from: string = (raw.From ?? raw.from ?? '').trim();
      const fromName: string = (raw.FromName ?? raw.fromName ?? '').trim();
      const rawSubject: string = (raw.Subject ?? raw.subject ?? '(no subject)').trim();
      const text: string = (raw.TextBody ?? raw.text ?? raw.body ?? '').trim();
      const html: string | undefined = raw.HtmlBody ?? raw.html ?? undefined;
      const messageId: string | undefined = raw.MessageID ?? raw.messageId ?? raw['Message-ID'] ?? undefined;
      // Postmark puts In-Reply-To inside a Headers array; other providers use top-level fields
      const headersArr: Array<{ Name: string; Value: string }> = Array.isArray(raw.Headers) ? raw.Headers : [];
      const headerInReplyTo = headersArr.find(h => h.Name === 'In-Reply-To')?.Value;
      const inReplyTo: string | undefined = raw.InReplyTo ?? raw.inReplyTo ?? raw['In-Reply-To'] ?? headerInReplyTo ?? undefined;

      if (!from) return reply.code(400).send({ error: 'Missing from address' });
      if (!text && !html) return reply.code(400).send({ error: 'Missing email body' });

      // Load workspace
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws) return reply.code(404).send({ error: 'Workspace not found' });

      // Find or create contact keyed by email + workspace
      let [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, from)))
        .limit(1);

      if (!contact) {
        [contact] = await db.insert(contacts).values({
          workspaceId,
          email: from,
          name: fromName || from.split('@')[0],
          lastSeenAt: new Date(),
        }).returning();
      } else {
        const nameUpdate = fromName && !contact.name ? { name: fromName, lastSeenAt: new Date() } : { lastSeenAt: new Date() };
        await db.update(contacts).set(nameUpdate).where(eq(contacts.id, contact.id));
      }

      // Thread matching via In-Reply-To → emailThreadId
      // This lets reply chains stay in one conversation
      let conversation: typeof conversations.$inferSelect | undefined;

      if (inReplyTo) {
        const [existing] = await db
          .select()
          .from(conversations)
          .where(and(
            eq(conversations.workspaceId, workspaceId),
            eq(conversations.emailThreadId, inReplyTo),
          ))
          .limit(1);
        conversation = existing;
      }

      if (!conversation) {
        // New thread — strip Re: prefix for clean subject storage
        const cleanSubject = rawSubject.replace(/^(Re:\s*)+/i, '').trim();
        const threadId = messageId ?? `thread-${Date.now()}-${contact.id}`;
        const slaSeconds = (ws.settings as any)?.defaultSlaEmail ?? 8 * 3600;
        const slaDueAt = new Date(Date.now() + slaSeconds * 1000);
        [conversation] = await db.insert(conversations).values({
          workspaceId,
          contactId: contact.id,
          channel: 'email',
          status: 'open',
          subject: cleanSubject,
          emailThreadId: threadId,
          aiHandled: true,
          lastMessageAt: new Date(),
          slaDueAt,
        }).returning();
      } else if (conversation.status === 'resolved') {
        // Customer replied after resolution — reopen
        await db.update(conversations)
          .set({ status: 'open' } as any)
          .where(eq(conversations.id, conversation.id));
        conversation = { ...conversation, status: 'open' };
      }

      // Save the inbound message
      await db.insert(messages).values({
        conversationId: conversation.id,
        workspaceId,
        authorType: 'contact',
        authorId: contact.id,
        body: text || '(no text body)',
        bodyHtml: html,
        emailMessageId: messageId,
        emailInReplyTo: inReplyTo,
      });

      await db.update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conversation.id));

      // Notify dashboard of the new/updated conversation
      broadcastToWorkspace(workspaceId, { type: 'new_conversation', conversationId: conversation.id });

      // AI reply pipeline
      let replyText: string;
      let escalated = false;

      try {
        const queryEmbedding = await embedQuery(text || rawSubject);
        const chunks = await searchChunks(workspaceId, queryEmbedding, 5);
        const aiAnswer = await generateAnswer(text || rawSubject, chunks, ws.settings as any);

        replyText = aiAnswer.answer;

        if (aiAnswer.shouldEscalate) {
          escalated = true;
          await db.update(conversations).set({
            aiHandled: false,
            escalatedAt: new Date(),
            escalationReason: aiAnswer.escalationReason,
          }).where(eq(conversations.id, conversation.id));
        }
      } catch (err: any) {
        app.log.error({ err }, 'AI reply failed for inbound email');
        replyText = 'Thanks for reaching out. A member of our team will get back to you shortly.';
        escalated = true;
        await db.update(conversations).set({
          aiHandled: false,
          escalatedAt: new Date(),
          escalationReason: 'AI error: ' + err.message,
        }).where(eq(conversations.id, conversation.id));
      }

      // Save AI reply message
      const [aiMsg] = await db.insert(messages).values({
        conversationId: conversation.id,
        workspaceId,
        authorType: 'ai',
        body: replyText,
        emailInReplyTo: messageId,
      }).returning();

      broadcastToWorkspace(workspaceId, { type: 'message', conversationId: conversation.id, message: aiMsg });

      // Send the email reply back to the customer
      // Uses emailThreadId as the thread anchor (In-Reply-To + References)
      const replySubject = rawSubject.startsWith('Re:') ? rawSubject : `Re: ${rawSubject}`;
      try {
        await sendMail({
          to: from,
          subject: replySubject,
          text: replyText,
          inReplyTo: messageId ?? conversation.emailThreadId ?? undefined,
          references: conversation.emailThreadId ?? undefined,
        });
      } catch (err: any) {
        app.log.error({ err }, 'Failed to send inbound email reply');
      }

      return reply.code(200).send({ ok: true, conversationId: conversation.id, escalated });
    },
  );
}
