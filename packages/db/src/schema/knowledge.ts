import { pgTable, text, jsonb, timestamp, uuid, integer, index, pgEnum, vector, boolean } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';

export const articleStatusEnum = pgEnum('article_status', ['draft', 'published']);
export const sourceTypeEnum = pgEnum('source_type', ['website', 'shopify', 'teachable', 'thinkific', 'file', 'manual', 'api']);
export const sourceStatusEnum = pgEnum('source_status', ['pending', 'syncing', 'ready', 'error']);

export const kbCategories = pgTable('kb_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbArticles = pgTable('kb_articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  categoryId: uuid('category_id').references(() => kbCategories.id),
  status: articleStatusEnum('status').notNull().default('draft'),
  authorId: uuid('author_id').references(() => users.id),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('kb_articles_workspace_status_idx').on(t.workspaceId, t.status),
]);

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
}, (t) => [
  index('chunks_workspace_idx').on(t.workspaceId),
]);
// Note: HNSW index on embedding is added in migration SQL (drizzle-kit doesn't generate vector indexes yet)

export const actions = pgTable('actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'order_lookup' | 'enrollment_check' | 'custom_http'
  schema: jsonb('schema').$type<Record<string, unknown>>().default({}),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const escalationRules = pgTable('escalation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  condition: jsonb('condition').$type<EscalationCondition>().notNull(),
  action: text('action').notNull().default('assign_human'),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EscalationCondition =
  | { type: 'keyword'; keywords: string[] }
  | { type: 'order_value_above'; amount: number }
  | { type: 'sentiment'; value: 'angry' | 'frustrated' }
  | { type: 'repeat_escalation'; count: number };

export const cannedResponses = pgTable('canned_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: text('tags').array().default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
