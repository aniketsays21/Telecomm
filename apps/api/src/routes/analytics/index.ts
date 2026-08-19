import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lt, sql, count, isNotNull } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { conversations, contacts } from '@telecomm/db/schema';
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
        // avg minutes from open → resolved. Excludes conversations still open.
        avgResolutionMinutes: sql<number>`avg(extract(epoch from (${conversations.resolvedAt} - ${conversations.createdAt})) / 60.0) filter (where ${conversations.resolvedAt} is not null)`,
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

    // Top contacts by conversation volume in the period.
    const contactRows = await db.execute(
      sql`
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
      `,
    );

    // Top problem topics — sourced from the AI-inferred tags array on
    // conversations. Falls back to the empty state gracefully if the
    // workspace hasn't accumulated any tagged conversations yet.
    const topicRows = await db.execute(
      sql`
        SELECT
          unnest(tags) AS topic,
          count(*)::int AS cnt
        FROM conversations
        WHERE workspace_id = ${wid}
          AND created_at >= ${since}
          AND array_length(tags, 1) IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
      `,
    );

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
      // db.execute() returns postgres.js's RowList (array of rows). Two
      // serialization pitfalls to defuse before this payload crosses the
      // React-Server-Component boundary in the Next.js dashboard:
      //   • Postgres `date` (from ::date) comes back as a JS Date. Force ISO
      //     string so the client component always gets the same shape.
      //   • `count()` / count(*) from Postgres is int8; postgres.js returns
      //     it as a BigInt in some versions, which RSC serialization rejects
      //     with "Do not know how to serialize a BigInt". `Number()` normalises.
      daily: dailyRows.map((r: Record<string, unknown>) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
        conversations: Number(r.conversations ?? 0),
        escalations: Number(r.escalations ?? 0),
      })),
      topEscalationReasons: reasonRows.map((r: Record<string, unknown>) => ({
        reason: String(r.escalation_reason ?? ''),
        count: Number(r.cnt ?? 0),
      })),
      channelSplit: channelRows.map((r) => ({
        channel: String(r.channel ?? ''),
        count: Number(r.cnt ?? 0),
      })),
      topContacts: contactRows.map((r: Record<string, unknown>) => ({
        id: String(r.id ?? ''),
        label: String(r.label ?? 'Anonymous'),
        email: r.email ? String(r.email) : null,
        count: Number(r.cnt ?? 0),
      })),
      topTopics: topicRows.map((r: Record<string, unknown>) => ({
        topic: String(r.topic ?? ''),
        count: Number(r.cnt ?? 0),
      })),
    };
  });
}
