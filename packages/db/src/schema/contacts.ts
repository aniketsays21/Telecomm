import { pgTable, text, jsonb, timestamp, uuid, index, boolean } from 'drizzle-orm/pg-core';
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
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('contacts_workspace_email_idx').on(t.workspaceId, t.email),
  index('contacts_workspace_external_idx').on(t.workspaceId, t.externalId),
]);

export const contactPageViews = pgTable('contact_page_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  url: text('url').notNull(),
  path: text('path').notNull(),
  title: text('title'),
  referrer: text('referrer'),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('contact_page_views_contact_idx').on(t.contactId, t.viewedAt),
  index('contact_page_views_workspace_idx').on(t.workspaceId, t.viewedAt),
]);
