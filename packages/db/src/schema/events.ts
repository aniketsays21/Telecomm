import { pgTable, text, jsonb, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  conversationId: uuid('conversation_id'),
  actor: text('actor'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('events_workspace_type_idx').on(t.workspaceId, t.type),
  index('events_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('events_conversation_idx').on(t.conversationId),
]);

export const dailyMetrics = pgTable('daily_metrics', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  conversationsTotal: text('conversations_total').default('0'),
  aiResolved: text('ai_resolved').default('0'),
  agentResolved: text('agent_resolved').default('0'),
  abandoned: text('abandoned').default('0'),
  avgFirstResponseS: text('avg_first_response_s'),
  avgResolutionS: text('avg_resolution_s'),
  csatSum: text('csat_sum').default('0'),
  csatCount: text('csat_count').default('0'),
  agentMinutes: text('agent_minutes').default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('daily_metrics_workspace_date_idx').on(t.workspaceId, t.date),
]);
