import { pgTable, text, uuid, timestamp, boolean, integer, index, jsonb } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';

/**
 * Outbound webhooks — a workspace registers URLs to receive events (like
 * `conversation.created`, `message.created`, `conversation.resolved`).
 * Deliveries are HMAC-SHA256 signed with the per-webhook secret so the
 * receiver can verify the payload actually came from Telecomm.
 */
export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').array().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  description: text('description'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastDeliveryStatus: integer('last_delivery_status'),
  lastDeliveryError: text('last_delivery_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
}, (t) => [
  index('webhooks_workspace_idx').on(t.workspaceId),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  error: text('error'),
  attempt: integer('attempt').notNull().default(1),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('webhook_deliveries_webhook_idx').on(t.webhookId, t.deliveredAt),
]);
