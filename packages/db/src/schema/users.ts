import { AnyPgColumn, pgTable, text, jsonb, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const userRoleEnum = pgEnum('user_role', ['admin', 'agent', 'readonly']);
export const userStatusEnum = pgEnum('user_status', ['online', 'away', 'offline']);

// Self-references on a table need an explicit return type on the arrow function
// so TypeScript can type the object without walking through itself. Drizzle's
// `AnyPgColumn` is the documented escape hatch for exactly this case.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('agent'),
  availability: jsonb('availability').$type<AgentAvailability>().default({} as AgentAvailability),
  status: userStatusEnum('status').notNull().default('offline'),
  maxConcurrentChats: text('max_concurrent_chats').default('5'),
  invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id),
  inviteToken: text('invite_token'),
  inviteAcceptedAt: timestamp('invite_accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AgentAvailability = {
  timezone: string;
  schedule: Array<{ day: 0|1|2|3|4|5|6; open: string; close: string }>;
};
