import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { workspaces, contacts, conversations, messages } from '@telecomm/db/schema';
import { embedQuery, generateAnswer } from '@telecomm/ai';
import { searchChunks } from '../../lib/search.js';
import { sendMail, buildOutboundMessageId } from '../../lib/mailer.js';
import { verifyInboundWebhookAuth } from '../../lib/postmark-auth.js';
import { resolveWorkspaceSender, findWorkspaceBySupportEmail } from '../../lib/workspace-email.js';
import {
  parseHeaders,
  extractRecipients,
  extractFrom,
  extractFromName,
  extractMessageId,
  extractInReplyTo,
  extractReferences,
  threadCandidates,
  detectAutomated,
  extractText,
  extractHtml,
  extractSubject,
  cleanSubject,
  buildReferences,
} from '../../lib/inbound-email.js';
import { broadcastToWorkspace } from '../ws/index.js';
import { pickBestAgent } from '../../lib/assign.js';

/** Postgres unique-violation. Raised when two webhook retries race each other. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

export async function inboundEmailRoutes(app: FastifyInstance) {
  /**
   * Inbound email webhook.
   *
   * Primary route (`POST /inbound/email`) carries no workspace in the URL: a
   * SINGLE Postmark inbound address and a single webhook URL serve every
   * workspace, and the owning workspace is resolved from the recipient of the
   * email (`OriginalRecipient` / `Delivered-To` / `To` / `Cc`) matched against
   * each workspace's configured support address. That is what lets Brand B
   * onboard `support@brandB.com` with no code, no new Postmark server, and no
   * per-brand webhook.
   *
   * The `:workspaceId` variant is kept only as a compatibility and testing
   * path — it pins the workspace explicitly so a brand can be exercised end to
   * end before its real support address is routed to Postmark.
   *
   * Accepts Postmark inbound JSON, Mailgun/SendGrid field names, or plain JSON.
   */
  const handler = async (
    request: FastifyRequest<{ Params: { workspaceId?: string } }>,
    reply: FastifyReply,
  ) => {
    // 1. Authenticate the webhook before touching the payload.
    const auth = verifyInboundWebhookAuth(request);
    if (!auth.ok) {
      app.log.warn({ reason: auth.reason }, 'Rejected inbound email webhook');
      return reply.code(auth.status).send({ error: auth.reason });
    }

    const raw = (request.body ?? {}) as Record<string, any>;
    const headers = parseHeaders(raw);

    // 2. Normalize the payload.
    const from = extractFrom(raw);
    const fromName = extractFromName(raw);
    const rawSubject = extractSubject(raw);
    const text = extractText(raw);
    const html = extractHtml(raw);
    const messageId = extractMessageId(raw, headers);
    const inReplyTo = extractInReplyTo(raw, headers);
    const references = extractReferences(raw, headers);

    if (!from) return reply.code(400).send({ error: 'Missing or invalid from address' });
    if (!text && !html) return reply.code(400).send({ error: 'Missing email body' });

    // 3. Resolve the workspace: explicit param (compat) or recipient routing.
    const recipients = extractRecipients(raw, headers);
    let ws;
    if (request.params.workspaceId) {
      [ws] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, request.params.workspaceId))
        .limit(1);
    } else {
      ws = await findWorkspaceBySupportEmail(recipients);
    }

    if (!ws) {
      app.log.warn({ recipients }, 'Inbound email did not match any workspace');
      // 404 rather than a retryable 5xx: redelivery cannot change the outcome,
      // and Postmark stops retrying on a 4xx.
      return reply.code(404).send({
        error: 'No workspace matches the recipient address',
        recipients,
      });
    }
    const workspaceId = ws.id;

    // 4. Idempotency. Postmark retries on any non-2xx or timeout; without this
    // a retry would duplicate the message AND send a second AI reply.
    if (messageId) {
      const [existing] = await db
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(and(eq(messages.workspaceId, workspaceId), eq(messages.emailMessageId, messageId)))
        .limit(1);
      if (existing) {
        app.log.info({ messageId }, 'Duplicate inbound email ignored');
        return reply
          .code(200)
          .send({ ok: true, duplicate: true, conversationId: existing.conversationId });
      }
    }

    // 5. Loop protection. Store the message so agents still see it, but never
    // auto-reply to an autoresponder or mailing list.
    const automation = detectAutomated(raw, headers);

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

    // 6. Thread resolution.
    // Match the reply against every Message-ID we have ever stored for this
    // workspace — inbound AND outbound. Outbound ids are persisted when we send,
    // so customer → agent → customer → agent stays one conversation instead of
    // forking a new one on every round trip.
    let conversation: typeof conversations.$inferSelect | undefined;
    const candidates = threadCandidates(raw, headers);

    if (candidates.length > 0) {
      const [priorMessage] = await db
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(and(
          eq(messages.workspaceId, workspaceId),
          inArray(messages.emailMessageId, candidates),
        ))
        .limit(1);

      if (priorMessage) {
        [conversation] = await db
          .select()
          .from(conversations)
          .where(and(
            eq(conversations.id, priorMessage.conversationId),
            eq(conversations.workspaceId, workspaceId),
          ))
          .limit(1);
      }

      // Fall back to the conversation-level thread anchor for rows created
      // before outbound Message-IDs were persisted.
      if (!conversation) {
        [conversation] = await db
          .select()
          .from(conversations)
          .where(and(
            eq(conversations.workspaceId, workspaceId),
            inArray(conversations.emailThreadId, candidates),
          ))
          .limit(1);
      }
    }

    if (!conversation) {
      const slaSeconds = (ws.settings as any)?.defaultSlaEmail ?? 8 * 3600;
      const slaDueAt = new Date(Date.now() + slaSeconds * 1000);
      const threadId = messageId ?? `thread-${Date.now()}-${contact.id}`;
      [conversation] = await db.insert(conversations).values({
        workspaceId,
        contactId: contact.id,
        channel: 'email',
        status: 'open',
        subject: cleanSubject(rawSubject),
        emailThreadId: threadId,
        // Automated mail gets no AI reply, so it must land in the human queue.
        aiHandled: !automation.automated,
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

    // 7. Save the inbound message. The unique index on
    // (workspace_id, email_message_id) is the real idempotency guarantee: it
    // catches two retries that both passed the check above concurrently.
    try {
      await db.insert(messages).values({
        conversationId: conversation.id,
        workspaceId,
        authorType: 'contact',
        authorId: contact.id,
        body: text || '(no text body)',
        bodyHtml: html,
        emailMessageId: messageId,
        emailInReplyTo: inReplyTo,
        emailReferences: references.length ? references.join(' ') : undefined,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        app.log.info({ messageId }, 'Concurrent duplicate inbound email ignored');
        return reply.code(200).send({ ok: true, duplicate: true, conversationId: conversation.id });
      }
      throw err;
    }

    await db.update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    // Notify dashboard of the new/updated conversation
    broadcastToWorkspace(workspaceId, { type: 'new_conversation', conversationId: conversation.id });

    if (automation.automated) {
      app.log.info(
        { reason: automation.reason, conversationId: conversation.id },
        'Automated email stored without auto-reply',
      );
      await db.update(conversations)
        .set({
          aiHandled: false,
          escalatedAt: conversation.escalatedAt ?? new Date(),
          escalationReason: conversation.escalationReason ?? `Automated email: ${automation.reason}`,
        } as any)
        .where(eq(conversations.id, conversation.id));
      return reply.code(200).send({
        ok: true,
        conversationId: conversation.id,
        escalated: true,
        autoReplySkipped: automation.reason,
      });
    }

    // 8. AI reply pipeline
    let replyText: string;
    let escalated = false;

    try {
      const priorRows = await db
        .select({ authorType: messages.authorType, body: messages.body })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(messages.createdAt);
      const history = priorRows.slice(-10).map((r) => ({
        role: (r.authorType === 'contact' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: r.body,
      }));

      const queryEmbedding = await embedQuery(text || rawSubject);
      const chunks = await searchChunks(workspaceId, queryEmbedding, 5);
      const aiAnswer = await generateAnswer(
        text || rawSubject,
        chunks,
        { ...(ws.settings as any), brandName: ws.name },
        history,
      );

      replyText = aiAnswer.answer;

      // Persist any info the AI parsed from the email body so agents don't
      // re-ask for it.
      if (aiAnswer.extracted?.name && (!contact.name || contact.name === contact.email?.split('@')[0])) {
        await db.update(contacts).set({ name: aiAnswer.extracted.name }).where(eq(contacts.id, contact.id));
      }

      const convoUpdate: Record<string, unknown> = {};
      if (aiAnswer.topic) {
        const existingTags = (conversation.tags ?? []) as string[];
        if (!existingTags.includes(aiAnswer.topic)) {
          convoUpdate.tags = [...existingTags, aiAnswer.topic];
        }
      }
      if (aiAnswer.shouldEscalate) {
        escalated = true;
        convoUpdate.aiHandled = false;
        convoUpdate.escalatedAt = new Date();
        convoUpdate.escalationReason = aiAnswer.escalationReason;
        if (!conversation.assigneeId) {
          try {
            const agentId = await pickBestAgent(workspaceId);
            if (agentId) {
              convoUpdate.assigneeId = agentId;
              convoUpdate.assignedAt = new Date();
            }
          } catch (assignErr) {
            app.log.warn({ err: assignErr, conversationId: conversation.id }, 'Auto-assign failed');
          }
        }
      }
      if (Object.keys(convoUpdate).length) {
        await db.update(conversations).set(convoUpdate as any).where(eq(conversations.id, conversation.id));
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

    // 9. Send the reply under the WORKSPACE's verified sender address.
    const sender = resolveWorkspaceSender(ws);
    // Generate the outbound Message-ID up front so it is persisted on the row
    // even if delivery fails — the customer's reply still resolves this thread.
    const outboundMessageId = buildOutboundMessageId(sender.from ?? `noreply@${ws.slug}.invalid`);
    const outboundReferences = buildReferences(references, messageId);

    const [aiMsg] = await db.insert(messages).values({
      conversationId: conversation.id,
      workspaceId,
      authorType: 'ai',
      body: replyText,
      emailMessageId: outboundMessageId,
      emailInReplyTo: messageId,
      emailReferences: outboundReferences,
    }).returning();

    broadcastToWorkspace(workspaceId, { type: 'message', conversationId: conversation.id, message: aiMsg });

    const replySubject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
    try {
      const info = await sendMail({
        to: from,
        from: sender.from,
        fromName: sender.fromName,
        subject: replySubject,
        text: replyText,
        messageId: outboundMessageId,
        inReplyTo: messageId ?? conversation.emailThreadId ?? undefined,
        references: outboundReferences ?? conversation.emailThreadId ?? undefined,
      });
      // Reconcile if the transport overrode our Message-ID.
      const delivered = info?.messageId?.replace(/^<|>$/g, '');
      if (delivered && delivered !== outboundMessageId) {
        await db.update(messages)
          .set({ emailMessageId: delivered })
          .where(eq(messages.id, aiMsg.id));
      }
    } catch (err: any) {
      app.log.error({ err }, 'Failed to send inbound email reply');
      await db.update(messages)
        .set({ deliveryState: 'failed' })
        .where(eq(messages.id, aiMsg.id));
    }

    return reply.code(200).send({ ok: true, conversationId: conversation.id, escalated });
  };

  const routeConfig = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  // Primary: one shared inbound address for the whole platform.
  app.post<{ Params: { workspaceId?: string } }>('/inbound/email', routeConfig, handler);
  // Compatibility/testing: pin the workspace explicitly.
  app.post<{ Params: { workspaceId?: string } }>('/inbound/email/:workspaceId', routeConfig, handler);
}
