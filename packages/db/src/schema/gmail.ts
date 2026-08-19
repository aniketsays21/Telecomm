import { pgTable, text, timestamp, uuid, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';

export const gmailAccounts = pgTable('gmail_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  emailAddress: text('email_address').notNull(),
  googleUserId: text('google_user_id').notNull(),
  accessToken: text('access_token').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  scope: text('scope').notNull(),
  // Cursor into Gmail's history stream. Null on first connect — the poller
  // seeds it after the initial backfill of recent messages.
  historyId: text('history_id'),
  connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('gmail_accounts_workspace_unique').on(t.workspaceId),
]);

export const gmailRoutingRules = pgTable('gmail_routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subjectPattern: text('subject_pattern').notNull(),
  // 'contains' | 'starts_with' | 'exact' | 'regex' — stored as text so the
  // set can be widened without a migration.
  matchMode: text('match_mode').notNull(),
  assigneeId: uuid('assignee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('gmail_routing_rules_workspace_priority_idx').on(t.workspaceId, t.priority),
]);

export type GmailMatchMode = 'contains' | 'starts_with' | 'exact' | 'regex';
