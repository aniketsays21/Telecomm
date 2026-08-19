import { db } from '@telecomm/db';
import { conversations, users } from '@telecomm/db/schema';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { sendMail } from '../lib/mailer.js';

// Tracks IDs already alerted this process lifetime to avoid repeat emails.
// Cleared hourly so alerts resume if a conversation stays open very long.
const alerted = new Set<string>();

async function checkSlaBreaches() {
  try {
    const now = new Date();

    // Find open conversations that have breached their SLA and have an assignee
    const breached = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        channel: conversations.channel,
        assigneeId: conversations.assigneeId,
        slaDueAt: conversations.slaDueAt,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(conversations)
      .innerJoin(users, eq(users.id, conversations.assigneeId))
      .where(
        and(
          eq(conversations.status, 'open'),
          isNotNull(conversations.slaDueAt),
          isNotNull(conversations.assigneeId),
          lt(conversations.slaDueAt, now),
        ),
      );

    for (const conv of breached) {
      if (alerted.has(conv.id)) continue;
      alerted.add(conv.id);

      const subject = conv.subject ?? (conv.channel === 'chat' ? 'Chat session' : 'Email conversation');
      const overMinutes = Math.round((now.getTime() - conv.slaDueAt!.getTime()) / 60000);

      sendMail({
        to: conv.assigneeEmail,
        subject: `SLA breached: ${subject}`,
        text: [
          `Hi ${conv.assigneeName},`,
          '',
          `A conversation assigned to you has breached its SLA by ${overMinutes} minute${overMinutes !== 1 ? 's' : ''}.`,
          '',
          `Subject: ${subject}`,
          `Channel: ${conv.channel}`,
          `SLA was due: ${conv.slaDueAt!.toUTCString()}`,
          '',
          'Please respond as soon as possible.',
        ].join('\n'),
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[sla-worker] Error checking SLA breaches:', err);
  }
}

export function startSlaWorker() {
  // Check every 5 minutes
  const interval = setInterval(checkSlaBreaches, 5 * 60 * 1000);
  // Clear the alerted set hourly so very long-open conversations get re-alerted
  const reset = setInterval(() => alerted.clear(), 60 * 60 * 1000);

  // Initial check shortly after startup
  setTimeout(checkSlaBreaches, 30_000);

  console.log('[workers] SLA alert worker started (checks every 5 min)');
  return { interval, reset };
}
