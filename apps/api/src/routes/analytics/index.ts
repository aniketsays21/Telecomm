import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lt, sql, count, isNotNull } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /analytics?days=30
  app.get('/analytics', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const days = Math.min(Number((request.query as any).days ?? 30), 90);
    const since = new Date(Date.now() - days * 86400_000);
    const wid = session.workspaceId;

    // All conversations in period
    const [totals] = await db
      .select({
        total: count(),
        escalated: sql<number>`count(*) filter (where ${conversations.escalatedAt} is not null)`,
        aiResolved: sql<number>`count(*) filter (where ${conversations.aiHandled} = true and ${conversations.status} = 'resolved')`,
        agentResolved: sql<number>`count(*) filter (where ${conversations.aiHandled} = false and ${conversations.status} = 'resolved')`,
        avgFirstResponseMs: sql<number>`avg(extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt})) * 1000) filter (where ${conversations.firstResponseAt} is not null)`,
      })
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, wid),
        gte(conversations.createdAt, since),
      ));

    // Open conversations right now
    const [openNow] = await db
      .select({ count: count() })
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, wid),
        eq(conversations.status, 'open'),
      ));

    // Daily volume for the period (conversations created per day)
    const dailyRows = await db.execute(
      sql`
        SELECT
          date_trunc('day', created_at)::date AS day,
          count(*)::int AS conversations,
          count(*) filter (where escalated_at is not null)::int AS escalations
        FROM conversations
        WHERE workspace_id = ${wid}
          AND created_at >= ${since}
        GROUP BY 1
        ORDER BY 1
      `
    );

    // Top escalation reasons
    const reasonRows = await db.execute(
      sql`
        SELECT escalation_reason, count(*)::int AS cnt
        FROM conversations
        WHERE workspace_id = ${wid}
          AND created_at >= ${since}
          AND escalation_reason IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 6
      `
    );

    // Channel split
    const channelRows = await db
      .select({
        channel: conversations.channel,
        cnt: count(),
      })
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, wid),
        gte(conversations.createdAt, since),
      ))
      .groupBy(conversations.channel);

    const total = Number(totals.total) || 0;
    const escalated = Number(totals.escalated) || 0;
    const aiResolved = Number(totals.aiResolved) || 0;

    return {
      period: { days, since: since.toISOString() },
      summary: {
        total,
        openNow: Number(openNow.count) || 0,
        escalated,
        aiResolved,
        agentResolved: Number(totals.agentResolved) || 0,
        escalationRate: total > 0 ? Math.round((escalated / total) * 1000) / 10 : 0,
        aiResolutionRate: total > 0 ? Math.round((aiResolved / total) * 1000) / 10 : 0,
        avgFirstResponseMs: totals.avgFirstResponseMs ? Math.round(Number(totals.avgFirstResponseMs)) : null,
      },
      daily: (dailyRows.rows as any[]).map(r => ({
        day: r.day,
        conversations: Number(r.conversations),
        escalations: Number(r.escalations),
      })),
      topEscalationReasons: (reasonRows.rows as any[]).map(r => ({
        reason: r.escalation_reason as string,
        count: Number(r.cnt),
      })),
      channelSplit: channelRows.map(r => ({ channel: r.channel, count: Number(r.cnt) })),
    };
  });
}
