import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { users, conversations } from '@telecomm/db/schema';
import type { AgentAvailability } from '@telecomm/db/schema';

type Candidate = {
  id: string;
  name: string;
  availability: AgentAvailability | null;
  maxConcurrent: number;
  status: 'online' | 'away' | 'offline';
  openCount: number;
};

// Is `now` (in the agent's timezone) inside any of their scheduled windows?
// An agent with no schedule is considered always-available so a fresh workspace
// with no hours configured doesn't leave every escalation unassigned.
function isOnDuty(availability: AgentAvailability | null, now: Date): boolean {
  const schedule = availability?.schedule;
  if (!schedule || schedule.length === 0) return true;
  const tz = availability?.timezone || 'UTC';

  // Get weekday + HH:MM in the agent's timezone. Intl gives us both without
  // pulling in a full tz library.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[weekday];
  const nowHM = `${hour}:${minute}`;

  return schedule.some((slot) => slot.day === day && slot.open <= nowHM && nowHM < slot.close);
}

/**
 * Pick the best agent to take a new escalated conversation.
 *
 * Preference order:
 *   1. On-duty per their schedule (empty schedule = always on-duty)
 *   2. status != 'offline'
 *   3. Fewer currently-open assigned conversations (load balancing)
 *   4. Under maxConcurrentChats
 *
 * Returns null if nobody qualifies — caller should leave the conversation
 * unassigned so any agent can grab it manually.
 */
export async function pickBestAgent(workspaceId: string, now: Date = new Date()): Promise<string | null> {
  const roster = await db
    .select({
      id: users.id,
      name: users.name,
      availability: users.availability,
      maxConcurrent: users.maxConcurrentChats,
      status: users.status,
      role: users.role,
      inviteAcceptedAt: users.inviteAcceptedAt,
    })
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), inArray(users.role, ['admin', 'agent'])));

  // Only agents who have actually joined (invite accepted or no invite token needed)
  const active = roster.filter((r) => r.inviteAcceptedAt != null || r.role === 'admin');
  if (active.length === 0) return null;

  const openCounts = await db
    .select({
      assigneeId: conversations.assigneeId,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.status, 'open'),
        // Only count rows with a non-null assignee; drizzle needs the explicit check.
        sql`${conversations.assigneeId} is not null`,
      ),
    )
    .groupBy(conversations.assigneeId);

  const loadByAgent = new Map<string, number>();
  for (const row of openCounts) {
    if (row.assigneeId) loadByAgent.set(row.assigneeId, Number(row.count));
  }

  const candidates: Candidate[] = active.map((a) => ({
    id: a.id,
    name: a.name,
    availability: a.availability ?? null,
    maxConcurrent: Number(a.maxConcurrent ?? 5) || 5,
    status: a.status,
    openCount: loadByAgent.get(a.id) ?? 0,
  }));

  const ranked = candidates
    .filter((c) => c.openCount < c.maxConcurrent)
    .sort((a, b) => {
      const aOn = isOnDuty(a.availability, now) ? 0 : 1;
      const bOn = isOnDuty(b.availability, now) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      const aOnline = a.status === 'offline' ? 1 : 0;
      const bOnline = b.status === 'offline' ? 1 : 0;
      if (aOnline !== bOnline) return aOnline - bOnline;
      if (a.openCount !== b.openCount) return a.openCount - b.openCount;
      return a.name.localeCompare(b.name);
    });

  return ranked[0]?.id ?? null;
}
