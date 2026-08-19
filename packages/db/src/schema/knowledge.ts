import { pgTable, text, jsonb, timestamp, uuid, integer, index, pgEnum, vector, boolean } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';

// kb_categories / kb_articles / escalation_rules / actions tables were part of
// an earlier "self-hosted help centre + custom rules" scope that never
// shipped — the schema references were removed to keep drizzle-kit output
// clean, but the tables (if any exist in old databases) are left in place.
// Drop them manually when you're ready with:
//   DROP TABLE IF EXISTS kb_articles, kb_categories, escalation_rules, actions;
//
// `sourceTypeEnum` still lists shopify/teachable/thinkific for the same
// reason: the enum values are cheap to keep and removing them requires an
// ALTER TYPE dance. They just never get inserted.
export const sourceTypeEnum = pgEnum('source_type', ['website', 'shopify', 'teachable', 'thinkific', 'file', 'manual', 'api']);
export const sourceStatusEnum = pgEnum('source_status', ['pending', 'syncing', 'ready', 'error']);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: sourceTypeEnum('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  credentialsEncrypted: text('credentials_encrypted'),
  status: sourceStatusEnum('status').notNull().default('pending'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncFrequency: integer('sync_frequency').default(3600), // seconds
  lastError: text('last_error'),
  docCount: integer('doc_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isDemo: boolean('is_demo').notNull().default(false),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  title: text('title').notNull(),
  url: text('url'),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  docType: text('doc_type').notNull().default('article'), // article|product|lecture|faq|page|file
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('documents_workspace_idx').on(t.workspaceId),
  index('documents_source_idx').on(t.sourceId),
]);

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }),
  tokenCount: integer('token_count').notNull().default(0),
  position: integer('position').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('chunks_workspace_idx').on(t.workspaceId),
]);
// Note: HNSW index on embedding is added in migration SQL (drizzle-kit doesn't generate vector indexes yet)

export const cannedResponses = pgTable('canned_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: text('tags').array().default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isDemo: boolean('is_demo').notNull().default(false),
});
