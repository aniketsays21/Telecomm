import { db } from '@telecomm/db';
import { sql } from 'drizzle-orm';

/**
 * Idempotent schema patches applied at boot so a Railway deploy without
 * an out-of-band `pnpm --filter @telecomm/db migrate` step still works.
 * Every statement uses IF EXISTS / IF NOT EXISTS so re-running is a no-op.
 *
 * Keep this focused on RECENT additions the code depends on. For older
 * columns / tables, trust the proper migrations. This is a self-heal for
 * "I forgot to run migrations" — not a migration replacement.
 */
export async function runStartupMigrations(): Promise<void> {
  const statements: Array<[string, string]> = [
    // --- 0005: sentiment / webhooks / triggers ---
    [
      'messages.sentiment column',
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sentiment" text`,
    ],
    [
      'webhooks table',
      `CREATE TABLE IF NOT EXISTS "webhooks" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "url"           text NOT NULL,
        "secret"        text NOT NULL,
        "events"        text[] NOT NULL DEFAULT '{}'::text[],
        "enabled"       boolean NOT NULL DEFAULT true,
        "description"   text,
        "created_by"    uuid REFERENCES "users"("id"),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "last_delivery_at"     timestamptz,
        "last_delivery_status" integer,
        "last_delivery_error"  text,
        "consecutive_failures" integer NOT NULL DEFAULT 0
      )`,
    ],
    [
      'webhooks_workspace_idx',
      `CREATE INDEX IF NOT EXISTS "webhooks_workspace_idx" ON "webhooks" ("workspace_id")`,
    ],
    [
      'webhook_deliveries table',
      `CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "webhook_id"    uuid NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
        "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "event"         text NOT NULL,
        "payload"       jsonb NOT NULL,
        "status_code"   integer,
        "response_body" text,
        "error"         text,
        "attempt"       integer NOT NULL DEFAULT 1,
        "delivered_at"  timestamptz NOT NULL DEFAULT now()
      )`,
    ],
    [
      'webhook_deliveries_webhook_idx',
      `CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_idx"
         ON "webhook_deliveries" ("webhook_id", "delivered_at" DESC)`,
    ],
    [
      'widget_triggers table',
      `CREATE TABLE IF NOT EXISTS "widget_triggers" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "name"          text NOT NULL,
        "enabled"       boolean NOT NULL DEFAULT true,
        "conditions"    jsonb NOT NULL DEFAULT '{}'::jsonb,
        "message"       text NOT NULL,
        "created_by"    uuid REFERENCES "users"("id"),
        "created_at"    timestamptz NOT NULL DEFAULT now()
      )`,
    ],
    [
      'widget_triggers_workspace_idx',
      `CREATE INDEX IF NOT EXISTS "widget_triggers_workspace_idx"
         ON "widget_triggers" ("workspace_id")`,
    ],
  ];

  for (const [label, ddl] of statements) {
    try {
      await db.execute(sql.raw(ddl));
    } catch (err) {
      console.warn(`[startup-migrations] ${label} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log('[startup-migrations] Schema patches applied');
}
