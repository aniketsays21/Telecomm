import { db } from '@telecomm/db';
import { gmailAccounts } from '@telecomm/db/schema';
import { eq } from 'drizzle-orm';
import { getFreshAccessToken } from '../lib/gmail-oauth.js';
import { listHistory, listMessages, getProfile, GmailApiError } from '../lib/gmail-client.js';
import { processGmailMessage } from '../lib/gmail-inbound.js';

/**
 * Per-workspace Gmail sync loop. Runs every POLL_INTERVAL_MS on a single
 * setInterval — one process, no fan-out. Each tick:
 *
 *   1. Pull every gmail_accounts row.
 *   2. For each, refresh the access token if needed (done inside
 *      getFreshAccessToken).
 *   3. If we have a historyId, list changes since it (label=INBOX,
 *      historyTypes=messageAdded). Otherwise do a small backfill via
 *      messages.list(q="in:inbox newer_than:1d") and seed historyId from
 *      profile.
 *   4. Feed each new gmail messageId through processGmailMessage.
 *   5. Persist the new historyId and last_polled_at.
 *
 * Concurrency: overlapping ticks are prevented by an in-process lock; per
 * workspace, at most one sync runs at a time. Multiple API replicas would
 * each run their own loop — for this workload dedup on messages.emailMessageId
 * makes that safe, but for cost we recommend keeping API to a single
 * replica or splitting the worker into its own process later.
 */

const POLL_INTERVAL_MS = Number(process.env.GMAIL_POLL_INTERVAL_MS ?? 30_000);
const running = new Set<string>();

async function syncOne(accountId: string, workspaceId: string): Promise<void> {
  if (running.has(accountId)) return;
  running.add(accountId);
  try {
    const { accessToken, emailAddress, historyId } = await getFreshAccessToken(workspaceId);

    let currentHistoryId: string | null = historyId;
    let newIds: string[] = [];

    if (!currentHistoryId) {
      // First run: pull the last day of INBOX and seed the cursor from profile.
      const listed = await listMessages(accessToken, 'in:inbox newer_than:1d', 25);
      newIds = (listed.messages ?? []).map((m) => m.id);
      const prof = await getProfile(accessToken);
      currentHistoryId = prof.historyId;
    } else {
      // Incremental: pull messagesAdded since our stored cursor. Gmail's
      // history window is ~7 days — a 404 here means we've fallen off the
      // window and must re-seed via messages.list.
      try {
        let pageToken: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await listHistory(accessToken, currentHistoryId!, pageToken);
          for (const entry of page.history ?? []) {
            for (const added of entry.messagesAdded ?? []) {
              seen.add(added.message.id);
            }
          }
          currentHistoryId = page.historyId;
          pageToken = page.nextPageToken;
        } while (pageToken);
        newIds = Array.from(seen);
      } catch (err) {
        if (err instanceof GmailApiError && err.status === 404) {
          const listed = await listMessages(accessToken, 'in:inbox newer_than:1d', 25);
          newIds = (listed.messages ?? []).map((m) => m.id);
          const prof = await getProfile(accessToken);
          currentHistoryId = prof.historyId;
        } else {
          throw err;
        }
      }
    }

    // Process serially: rate limits + preserving order matter more than
    // throughput at this volume.
    for (const id of newIds) {
      try {
        await processGmailMessage({
          workspaceId,
          gmailMessageId: id,
          ownerEmail: emailAddress,
          accessToken,
        });
      } catch (err) {
        // One bad message must not stall the rest.
        console.warn('[gmail-poll] processGmailMessage failed', { workspaceId, id, err: (err as Error).message });
      }
    }

    await db.update(gmailAccounts)
      .set({
        historyId: currentHistoryId ?? historyId,
        lastPolledAt: new Date(),
        lastError: null,
      })
      .where(eq(gmailAccounts.id, accountId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[gmail-poll] sync failed', { workspaceId, message });
    await db.update(gmailAccounts)
      .set({ lastPolledAt: new Date(), lastError: message.slice(0, 500) })
      .where(eq(gmailAccounts.id, accountId));
  } finally {
    running.delete(accountId);
  }
}

async function tick(): Promise<void> {
  const accounts = await db
    .select({ id: gmailAccounts.id, workspaceId: gmailAccounts.workspaceId })
    .from(gmailAccounts);
  await Promise.all(accounts.map((a) => syncOne(a.id, a.workspaceId)));
}

export function startGmailPoller(): { stop: () => void } {
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  // Kick once at boot so a fresh deploy syncs without waiting a full interval.
  void tick();
  console.log(`[gmail-poll] started (every ${POLL_INTERVAL_MS}ms)`);
  return { stop: () => clearInterval(interval) };
}
