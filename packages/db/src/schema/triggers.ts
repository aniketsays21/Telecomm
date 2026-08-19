import { pgTable, text, uuid, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';

/**
 * Proactive chat triggers — rules the widget evaluates in the visitor's
 * browser to auto-open the chat with a pre-filled message.
 *
 * `conditions` shape (all must match to fire):
 *   {
 *     secondsOnPage?: number   // fire after visitor has been here N seconds
 *     urlPattern?: string      // substring OR /regex/ that must appear in URL
 *   }
 *
 * Kept as JSONB so we can extend to scroll depth, exit intent, referrer,
 * etc. without a migration per trigger type.
 */
export const widgetTriggers = pgTable('widget_triggers', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions').$type<TriggerConditions>().notNull().default({}),
  message: text('message').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('widget_triggers_workspace_idx').on(t.workspaceId),
]);

export type TriggerConditions = {
  secondsOnPage?: number;
  urlPattern?: string;
};
