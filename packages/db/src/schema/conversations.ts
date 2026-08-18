import { pgTable, text, jsonb, timestamp, uuid, boolean, smallint, index, pgEnum } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { contacts } from './contacts';
import { users } from './users';

export const channelEnum = pgEnum('channel', ['chat', 'email']);
export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'snoozed', 'resolved']);
export const resolvedByEnum = pgEnum('resolved_by', ['ai', 'agent']);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  channel: channelEnum('channel').notNull(),
  status: conversationStatusEnum('status').notNull().default('open'),
  assigneeId: uuid('assignee_id').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  priority: smallint('priority').notNull().default(0),
  sentiment: text('sentiment'),
  tags: text('tags').array().notNull().default([]),
  subject: text('subject'),
  emailThreadId: text('email_thread_id'),
  aiHandled: boolean('ai_handled').notNull().default(true),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  escalationReason: text('escalation_reason'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: resolvedByEnum('resolved_by'),
  csatRating: smallint('csat_rating'),
  csatComment: text('csat_comment'),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('conversations_workspace_status_idx').on(t.workspaceId, t.status),
  index('conversations_workspace_assignee_idx').on(t.workspaceId, t.assigneeId),
  index('conversations_workspace_last_message_idx').on(t.workspaceId, t.lastMessageAt),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  authorType: text('author_type').notNull(), // 'contact' | 'agent' | 'ai' | 'system'
  authorId: uuid('author_id'),
  body: text('body').notNull(),
  bodyHtml: text('body_html'),
  attachments: jsonb('attachments').$type<Attachment[]>().default([]),
  isInternalNote: boolean('is_internal_note').notNull().default(false),
  mentions: uuid('mentions').array().default([]),
  emailMessageId: text('email_message_id'),
  emailInReplyTo: text('email_in_reply_to'),
  deliveryState: text('delivery_state').default('sent'),
  readAt: timestamp('read_at', { withTimezone: true }),
  aiConfidence: text('ai_confidence'),
  aiSources: jsonb('ai_sources').$type<AiSource[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('messages_conversation_idx').on(t.conversationId),
  index('messages_email_message_id_idx').on(t.emailMessageId),
]);

export const conversationSummaries = pgTable('conversation_summaries', {
  conversationId: uuid('conversation_id').primaryKey().references(() => conversations.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  whatCustomerWants: text('what_customer_wants'),
  whatsBeenTried: text('whats_been_tried'),
  currentStatus: text('current_status'),
  keyDetails: text('key_details').array().default([]),
  upToMessageId: uuid('up_to_message_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Attachment = { id: string; url: string; name: string; mimeType: string; size: number };
export type AiSource = { documentId: string; title: string; url?: string; excerpt: string; similarity: number };
