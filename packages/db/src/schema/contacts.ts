import { pgTable, text, jsonb, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email'),
  name: text('name'),
  externalId: text('external_id'),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().default({}),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('contacts_workspace_email_idx').on(t.workspaceId, t.email),
  index('contacts_workspace_external_idx').on(t.workspaceId, t.externalId),
]);
