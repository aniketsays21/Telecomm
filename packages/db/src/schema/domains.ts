import { pgTable, text, uuid, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';

/**
 * Custom domains — a workspace can point their own subdomain
 * (e.g. `help.theirbrand.com`) at the Telecomm-hosted help centre by adding
 * a CNAME. We verify the CNAME target matches ours, then ask the SSL
 * layer (Cloudflare-for-SaaS in production, Let's Encrypt as a fallback)
 * to issue a cert.
 *
 * ssl_status states:
 *   'pending'    → row created, no cert yet
 *   'issuing'    → provisioning in flight
 *   'active'     → cert live; requests will terminate SSL and route by Host
 *   'error'      → provisioning failed; see ssl_error
 */
export const customDomains = pgTable('custom_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull(),
  // Random per-domain token the workspace also proves ownership of via a
  // TXT record (belt-and-braces alongside the CNAME check, so a shared CDN
  // hostname can't be hijacked).
  verificationToken: text('verification_token').notNull(),
  // What we EXPECT the CNAME to point at. Stored so verification tells the
  // customer "your CNAME points at X, we expected Y".
  expectedCnameTarget: text('expected_cname_target').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  sslStatus: text('ssl_status').notNull().default('pending'),
  sslError: text('ssl_error'),
  sslIssuedAt: timestamp('ssl_issued_at', { withTimezone: true }),
  sslProvider: text('ssl_provider'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('custom_domains_workspace_idx').on(t.workspaceId),
  // A hostname can only ever route to one workspace — enforced by the DB.
  uniqueIndex('custom_domains_hostname_key').on(t.hostname),
]);
