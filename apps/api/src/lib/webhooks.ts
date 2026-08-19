import { createHmac, randomBytes } from 'crypto';
import { db } from '@telecomm/db';
import { webhooks, webhookDeliveries } from '@telecomm/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Outbound webhooks: fire-and-forget event delivery to workspace-registered
 * HTTPS endpoints. Each attempt is HMAC-SHA256 signed with the per-webhook
 * secret so the receiver can verify authenticity.
 *
 * Reliability model:
 *   • The API server fires the delivery immediately (not queued through
 *     BullMQ) but does NOT await it — the caller returns in the normal path.
 *   • Failed deliveries retry up to 5 times with exponential backoff, then
 *     stop and increment `consecutive_failures` on the webhook row. Once a
 *     webhook hits 20 consecutive failures we auto-disable it so a dead
 *     endpoint doesn't burn the API forever.
 *   • Every attempt (success + fail) is logged to `webhook_deliveries` for
 *     the admin "Deliveries" table.
 */

export type WebhookEvent =
  | 'conversation.created'
  | 'conversation.resolved'
  | 'conversation.escalated'
  | 'message.created'
  | 'message.agent_reply';

const MAX_ATTEMPTS = 5;
const AUTO_DISABLE_AFTER = 20;
const DELIVERY_TIMEOUT_MS = 8_000;

/**
 * Generate a random per-webhook secret (128 bits of entropy encoded as hex).
 * Long enough that guessing is not practical; short enough to paste.
 */
export function generateWebhookSecret(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Emit an event to every enabled webhook in the workspace that is
 * subscribed to it. Returns immediately; deliveries run in the background.
 */
export function emitWebhookEvent(
  workspaceId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): void {
  // Fire and forget — any error inside must never break the caller.
  deliverEventInBackground(workspaceId, event, payload).catch(() => {
    /* swallowed; each attempt records its own failure to webhook_deliveries */
  });
}

async function deliverEventInBackground(
  workspaceId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.enabled, true)));
  if (subs.length === 0) return;

  const body = JSON.stringify({
    event,
    workspaceId,
    createdAt: new Date().toISOString(),
    data: payload,
  });

  await Promise.all(
    subs
      .filter((sub) => sub.events.length === 0 || sub.events.includes(event))
      .map((sub) => attemptDelivery(sub, event, body, payload, 1)),
  );
}

async function attemptDelivery(
  sub: typeof webhooks.$inferSelect,
  event: WebhookEvent,
  body: string,
  payload: Record<string, unknown>,
  attempt: number,
): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signaturePayload = `${timestamp}.${body}`;
  const signature = createHmac('sha256', sub.secret).update(signaturePayload).digest('hex');

  let statusCode: number | undefined;
  let responseBody: string | undefined;
  let error: string | undefined;

  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Telecomm-Webhooks/1.0',
        'X-Telecomm-Event': event,
        'X-Telecomm-Delivery-Attempt': attempt.toString(),
        'X-Telecomm-Timestamp': timestamp,
        'X-Telecomm-Signature': `t=${timestamp},v1=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    statusCode = res.status;
    // Keep response bodies bounded — some receivers hand back HTML error pages
    // that would balloon the deliveries table.
    responseBody = (await res.text()).slice(0, 2000);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Log the attempt regardless of outcome.
  await db.insert(webhookDeliveries).values({
    webhookId: sub.id,
    workspaceId: sub.workspaceId,
    event,
    payload,
    statusCode,
    responseBody,
    error,
    attempt,
  });

  const succeeded = typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300;

  if (succeeded) {
    await db.update(webhooks).set({
      lastDeliveryAt: new Date(),
      lastDeliveryStatus: statusCode,
      lastDeliveryError: null,
      consecutiveFailures: 0,
    }).where(eq(webhooks.id, sub.id));
    return;
  }

  // Retry on failure with exponential backoff (1s, 2s, 4s, 8s, 16s).
  if (attempt < MAX_ATTEMPTS) {
    const delay = Math.pow(2, attempt - 1) * 1000;
    setTimeout(() => {
      attemptDelivery(sub, event, body, payload, attempt + 1).catch(() => {});
    }, delay);
    return;
  }

  // Exhausted — bump failure counter and possibly auto-disable.
  const nextFailureCount = sub.consecutiveFailures + 1;
  await db.update(webhooks).set({
    lastDeliveryAt: new Date(),
    lastDeliveryStatus: statusCode ?? null,
    lastDeliveryError: error ?? (statusCode ? `HTTP ${statusCode}` : 'Unknown error'),
    consecutiveFailures: nextFailureCount,
    ...(nextFailureCount >= AUTO_DISABLE_AFTER ? { enabled: false } : {}),
  }).where(eq(webhooks.id, sub.id));
}
