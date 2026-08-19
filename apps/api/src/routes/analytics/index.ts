import type { FastifyInstance } from 'fastify';
import { eq, and, gte, sql, count } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';

/**
 * Wrap a query so one broken piece of the dashboard doesn't 500 the whole
 * endpoint. Whatever failed gets logged with a label so the API logs point
 * straight at the culprit, and the response comes back with a null / [] for
 * that field. The Web page already treats missing fields as empty state.
 */
async function safe<T>(label: string, app: FastifyInstance, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    app.log.error({ err, analyticsSection: label }, 'analytics query failed');
    return fallback;
  }
}

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /analytics?days=30
  app.get('/analytics', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const days = Math.min(Number((request.query as any).days ?? 30), 90);
    const since = new Date(Date.now() - days * 86400_000);
    const wid = session.workspaceId;

    const totals = await safe(
      'totals',
      app,
      async () => {
        const [row] = await db
          .select({
            total: count(),
            escalated: sql<number>`count(*) filter (where ${conversations.escalatedAt} is not null)`,
            aiResolved: sql<number>`count(*) filter (where ${conversations.aiHandled} = true and ${conversations.status} = 'resolved')`,
            agentResolved: sql<number>`count(*) filter (where ${conversations.aiHandled} = false and ${conversations.status} = 'resolved')`,
            avgFirstResponseMs: sql<number>`avg(extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt})) * 1000) filter (where ${conversations.firstResponseAt} is not null)`,
            avgResolutionMinutes: sql<number>`avg(extract(epoch from (${conversations.resolvedAt} - ${conversations.createdAt})) / 60.0) filter (where ${conversations.resolvedAt} is not null)`,
          })
          .from(conversations)
          .where(and(
            eq(conversations.workspaceId, wid),
            gte(conversations.createdAt, since),
          ));
        return row;
      },
      {
        total: 0, escalated: 0, aiResolved: 0, agentResolved: 0,
        avgFirstResponseMs: null as number | null,
        avgResolutionMinutes: null as number | null,
      },
    );

    const openNow = await safe(
      'openNow',
      app,
      async () => {
        const [row] = await db
          .select({ count: count() })
          .from(conversations)
          .where(and(eq(conversations.workspaceId, wid), eq(conversations.status, 'open')));
        return row;
      },
      { count: 0 },
    );

    const dailyRows = await safe('daily', app, () =>
      db.execute(sql`
        SELECT
          date_trunc('day', created_at)::date AS day,
          count(*)::int AS conversations,
          count(*) filter (where escalated_at is not null)::int AS escalations
        FROM conversations
        WHERE workspace_id = ${wid}
          AND created_at >= ${since}
        GROUP BY 1
        ORDER BY 1
      `), [] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const reasonRows = await safe('reasons', app, () =>
      db.execute(sql`
        SELECT escalation_reason, count(*)::int AS cnt
        FROM conversations
        WHERE workspace_id = ${wid}
          AND created_at >= ${since}
          AND escalation_reason IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 6
      `), [] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const channelRows = await safe('channels', app, () =>
      db
        .select({ channel: conversations.channel, cnt: count() })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, wid), gte(conversations.createdAt, since)))
        .groupBy(conversations.channel),
    [] as Array<{ channel: string; cnt: number }>);

    const contactRows = await safe('contacts', app, () =>
      db.execute(sql`
        SELECT
          c.id::text AS id,
          COALESCE(NULLIF(c.name, ''), c.email, 'Anonymous') AS label,
          c.email,
          count(*)::int AS cnt
        FROM conversations conv
        JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.workspace_id = ${wid}
          AND conv.created_at >= ${since}
        GROUP BY c.id, c.name, c.email
        ORDER BY 4 DESC
        LIMIT 8
      `), [] as unknown as Awaited<ReturnType<typeof db.execute>>);

    // Guard array_length: if `tags` is null the aggregate skips it, so the
    // where clause avoids unnest(null) which raises in older Postgres.
    const topicRows = await safe('topics', app, () =>
      db.execute(sql`
        SELECT
          unnest(tags) AS topic,
          count(*)::int AS cnt
        FROM conversations
        WHERE workspace_id = ${wid}
          AND created_at >= ${since}
          AND tags IS NOT NULL
          AND array_length(tags, 1) IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
      `), [] as unknown as Awaited<ReturnType<typeof db.execute>>);

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
        avgResolutionMinutes: totals.avgResolutionMinutes
          ? Math.round(Number(totals.avgResolutionMinutes) * 10) / 10
          : null,
      },
      daily: (dailyRows as unknown as Array<Record<string, unknown>>).map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
        conversations: Number(r.conversations ?? 0),
        escalations: Number(r.escalations ?? 0),
      })),
      topEscalationReasons: (reasonRows as unknown as Array<Record<string, unknown>>).map((r) => ({
        reason: String(r.escalation_reason ?? ''),
        count: Number(r.cnt ?? 0),
      })),
      channelSplit: channelRows.map((r) => ({
        channel: String(r.channel ?? ''),
        count: Number(r.cnt ?? 0),
      })),
      topContacts: (contactRows as unknown as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id ?? ''),
        label: String(r.label ?? 'Anonymous'),
        email: r.email ? String(r.email) : null,
        count: Number(r.cnt ?? 0),
      })),
      topTopics: (topicRows as unknown as Array<Record<string, unknown>>).map((r) => ({
        topic: String(r.topic ?? ''),
        count: Number(r.cnt ?? 0),
      })),
    };
  });
}
