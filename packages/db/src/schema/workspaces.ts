import { sql } from 'drizzle-orm';
import { pgTable, text, jsonb, boolean, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  businessHours: jsonb('business_hours').$type<BusinessHours>().default(defaultBusinessHours()),
  settings: jsonb('settings').$type<WorkspaceSettings>().default({} as WorkspaceSettings),
  onboardingState: jsonb('onboarding_state').$type<OnboardingState>().default({} as OnboardingState),
  isLive: boolean('is_live').notNull().default(false),
  customDomain: text('custom_domain'),
  customDomainVerified: boolean('custom_domain_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Inbound routing key. A single shared Postmark inbound webhook resolves the
  // owning workspace by matching the recipient address against this value, so
  // two workspaces must never claim the same support address.
  uniqueIndex('workspaces_support_email_key').on(sql`lower(${t.settings} ->> 'supportEmail')`),
]);

export type BusinessHours = {
  timezone: string;
  schedule: Array<{ day: 0|1|2|3|4|5|6; open: string; close: string }>;
};
export type WorkspaceSettings = {
  widgetColor?: string;
  widgetPosition?: 'bottom-right' | 'bottom-left';
  widgetGreeting?: string;
  botName?: string;
  escalationThreshold?: 'cautious' | 'balanced' | 'confident';
  defaultSlaChat?: number;  // seconds
  defaultSlaEmail?: number; // seconds
  roiHourlyRate?: number;
  /**
   * The brand's own support address (e.g. support@brandb.com), captured during
   * onboarding. Doubles as the inbound routing key: a single shared Postmark
   * inbound webhook resolves the owning workspace by matching the recipient of
   * the incoming email against this value. Enforced unique across workspaces.
   */
  supportEmail?: string;
  /**
   * Verified sender address used as the `From` on every outbound email for this
   * workspace. Must be a verified Postmark sender signature on the shared
   * Postmark server. Falls back to `supportEmail` when unset, so a brand that
   * only completed onboarding still sends under its own address.
   */
  smtpFromAddress?: string;
  /** Display name shown alongside `smtpFromAddress`. Defaults to the workspace name. */
  smtpFromName?: string;
};
export type OnboardingState = {
  emailConnected?: boolean;
  sourcesConnected?: boolean;
  agentsAdded?: boolean;
  widgetInstalled?: boolean;
  kbBuilt?: boolean;
  sandboxUsed?: boolean;
};

function defaultBusinessHours(): BusinessHours {
  return {
    timezone: 'UTC',
    schedule: [1,2,3,4,5].map(day => ({ day: day as 0|1|2|3|4|5|6, open: '09:00', close: '17:00' })),
  };
}
