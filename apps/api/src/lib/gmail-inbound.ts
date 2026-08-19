import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@telecomm/db';
import {
  gmailRoutingRules,
  conversations,
  contacts,
  messages,
} from '@telecomm/db/schema';
import type { GmailMatchMode } from '@telecomm/db/schema';
import { getMessage, headerValue, extractBody } from './gmail-client.js';
import { broadcastToWorkspace } from '../routes/ws/index.js';

// ---- Rule matching ----------------------------------------------------------
type Rule = {
  id: string;
  name: string;
  subjectPattern: string;
  matchMode: GmailMatchMode;
  assigneeId: string;
  priority: number;
  enabled: boolean;
};

function subjectMatches(subject: string, rule: Rule): boolean {
  const s = subject ?? '';
  const p = rule.subjectPattern ?? '';
  switch (rule.matchMode) {
    case 'contains':    return s.toLowerCase().includes(p.toLowerCase());
    case 'starts_with': return s.toLowerCase().startsWith(p.toLowerCase());
    case 'exact':       return s.trim().toLowerCase() === p.trim().toLowerCase();
    case 'regex':
      try { return new RegExp(p, 'i').test(s); } catch { return false; }
    default:            return false;
  }
}

async function loadRules(workspaceId: string): Promise<Rule[]> {
  const rows = await db
    .select({
      id: gmailRoutingRules.id,
      name: gmailRoutingRules.name,
      subjectPattern: gmailRoutingRules.subjectPattern,
      matchMode: gmailRoutingRules.matchMode,
      assigneeId: gmailRoutingRules.assigneeId,
      priority: gmailRoutingRules.priority,
      enabled: gmailRoutingRules.enabled,
    })
    .from(gmailRoutingRules)
    .where(and(eq(gmailRoutingRules.workspaceId, workspaceId), eq(gmailRoutingRules.enabled, true)))
    .orderBy(gmailRoutingRules.priority);
  return rows.map((r) => ({ ...r, matchMode: r.matchMode as GmailMatchMode }));
}

function firstMatch(subject: string, rules: Rule[]): Rule | null {
  for (const r of rules) if (subjectMatches(subject, r)) return r;
  return null;
}

// ---- From-address parsing ---------------------------------------------------
export function parseFromHeader(header: string | undefined): { email: string | null; name: string | null } {
  if (!header) return { email: null, name: null };
  const angle = header.match(/^\s*(?:"?([^"<]+?)"?\s*)?<([^>]+)>\s*$/);
  if (angle) return { name: angle[1]?.trim() || null, email: angle[2].trim().toLowerCase() };
  const plain = header.trim().toLowerCase();
  return { email: plain.includes('@') ? plain : null, name: null };
}

// ---- Pipeline ---------------------------------------------------------------
export type ProcessResult =
  | { skipped: 'no_match'; messageId: string }
  | { skipped: 'own_send'; messageId: string }
  | { skipped: 'duplicate'; messageId: string; conversationId: string }
  | { created: true; conversationId: string; matchedRuleId: string; assigneeId: string }
  | { appended: true; conversationId: string };

/**
 * Ingest a single Gmail message id for a workspace. Idempotent: if we've
 * already stored this Gmail messageId (customer resend, our own send bouncing
 * back through history), we no-op. Only messages whose subject matches an
 * active routing rule are turned into conversations — everything else is
 * intentionally dropped, per product requirement.
 */
export async function processGmailMessage(params: {
  workspaceId: string;
  gmailMessageId: string;
  ownerEmail: string;
  accessToken: string;
}): Promise<ProcessResult> {
  const { workspaceId, gmailMessageId, ownerEmail, accessToken } = params;

  // Dedup: same Gmail messageId already recorded → nothing to do. This is the
  // primary defense against our own outbound replies re-entering via history.
  const [existing] = await db
    .select({ id: messages.id, conversationId: messages.conversationId })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.emailMessageId, gmailMessageId)))
    .limit(1);
  if (existing) return { skipped: 'duplicate', messageId: gmailMessageId, conversationId: existing.conversationId };

  const full = await getMessage(accessToken, gmailMessageId, 'full');
  const from = parseFromHeader(headerValue(full, 'From'));
  const subject = headerValue(full, 'Subject') ?? '(no subject)';
  const rfcMessageId = (headerValue(full, 'Message-ID') ?? headerValue(full, 'Message-Id') ?? '').replace(/^<|>$/g, '');
  const inReplyTo = (headerValue(full, 'In-Reply-To') ?? '').replace(/^<|>$/g, '');
  const referencesHeader = headerValue(full, 'References') ?? '';
  const references = referencesHeader.split(/\s+/).filter(Boolean).map((r) => r.replace(/^<|>$/g, ''));

  // Guardrail: if the message came from the owner's own mailbox address, it
  // is either a self-test or, more likely, an echo of our own outbound reply
  // that appeared in INBOX via a mail rule. Skip.
  if (from.email && from.email === ownerEmail.toLowerCase()) {
    return { skipped: 'own_send', messageId: gmailMessageId };
  }

  // Is this message a reply on a thread we're already tracking? Look up by
  // gmail threadId first, then by RFC In-Reply-To / References as a fallback
  // for threads that may have originated outside Gmail.
  let conversation: typeof conversations.$inferSelect | undefined;
  const threadCandidates: string[] = [];
  if (full.threadId) threadCandidates.push(full.threadId);
  if (inReplyTo) threadCandidates.push(inReplyTo);
  threadCandidates.push(...references);

  if (threadCandidates.length) {
    // Match by conversations.emailThreadId (we store the Gmail threadId there
    // on creation) OR by any prior message's RFC Message-ID.
    const [byConv] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, workspaceId),
        inArray(conversations.emailThreadId, threadCandidates),
      ))
      .limit(1);
    if (byConv) conversation = byConv;

    if (!conversation) {
      const [priorMsg] = await db
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(and(
          eq(messages.workspaceId, workspaceId),
          inArray(messages.emailMessageId, threadCandidates),
        ))
        .limit(1);
      if (priorMsg) {
        const [byMsg] = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, priorMsg.conversationId), eq(conversations.workspaceId, workspaceId)))
          .limit(1);
        if (byMsg) conversation = byMsg;
      }
    }
  }

  const { text, html } = extractBody(full);
  const bodyText = text ?? (html ? htmlToText(html) : '(no body)');
  const fromEmail = from.email ?? 'unknown@unknown';

  // Find-or-create contact keyed by email.
  let [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, fromEmail)))
    .limit(1);
  if (!contact) {
    [contact] = await db.insert(contacts).values({
      workspaceId,
      email: fromEmail,
      name: from.name || fromEmail.split('@')[0],
      lastSeenAt: new Date(),
    }).returning();
  } else {
    await db.update(contacts).set({ lastSeenAt: new Date() }).where(eq(contacts.id, contact.id));
  }

  if (conversation) {
    // Existing thread — append the message, reopen if resolved, refresh
    // lastMessageAt so the inbox reorders it to the top.
    await db.insert(messages).values({
      conversationId: conversation.id,
      workspaceId,
      authorType: 'contact',
      authorId: contact.id,
      body: bodyText,
      bodyHtml: html ?? undefined,
      emailMessageId: rfcMessageId || gmailMessageId,
      emailInReplyTo: inReplyTo || undefined,
      emailReferences: references.length ? references.join(' ') : undefined,
    });
    const update: Record<string, unknown> = { lastMessageAt: new Date() };
    if (conversation.status === 'resolved') update.status = 'open';
    await db.update(conversations).set(update).where(eq(conversations.id, conversation.id));
    broadcastToWorkspace(workspaceId, { type: 'message', conversationId: conversation.id });
    return { appended: true, conversationId: conversation.id };
  }

  // New thread — must match a routing rule to become a conversation.
  const rules = await loadRules(workspaceId);
  const rule = firstMatch(subject, rules);
  if (!rule) return { skipped: 'no_match', messageId: gmailMessageId };

  const [created] = await db.insert(conversations).values({
    workspaceId,
    contactId: contact.id,
    channel: 'email',
    status: 'open',
    subject,
    // Store Gmail's threadId as the anchor — customer replies land on the
    // same threadId and we look it up here.
    emailThreadId: full.threadId,
    emailProvider: 'gmail',
    aiHandled: false,
    assigneeId: rule.assigneeId,
    assignedAt: new Date(),
    tags: [rule.name],
    lastMessageAt: new Date(),
  }).returning();

  await db.insert(messages).values({
    conversationId: created.id,
    workspaceId,
    authorType: 'contact',
    authorId: contact.id,
    body: bodyText,
    bodyHtml: html ?? undefined,
    emailMessageId: rfcMessageId || gmailMessageId,
    emailInReplyTo: inReplyTo || undefined,
    emailReferences: references.length ? references.join(' ') : undefined,
  });

  broadcastToWorkspace(workspaceId, { type: 'new_conversation', conversationId: created.id });

  return { created: true, conversationId: created.id, matchedRuleId: rule.id, assigneeId: rule.assigneeId };
}

// Minimal HTML → text so an HTML-only email still stores something legible.
// Not perfect, but avoids pulling in a full HTML parser.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Exposed for tests. Not part of the public runtime surface.
export const __internal = { subjectMatches, firstMatch, htmlToText, parseFromHeader };
