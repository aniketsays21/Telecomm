-- Sentiment analysis, outbound webhooks, and proactive chat triggers.
--
-- 1. Per-message sentiment lives on the message row so we can build
--    conversation- and workspace-level rollups without re-running the AI.
-- 2. Webhooks: a workspace can register N HTTPS endpoints; each event we
--    care about is delivered with an HMAC signature and retried on failure.
-- 3. Proactive chat triggers: rules attached to a workspace's widget that
--    fire based on time-on-page (v1), later URL/scroll (v2). Stored as
--    JSONB so the widget can consume them without a schema change per rule
--    type.

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "sentiment" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "url"           text NOT NULL,
  "secret"        text NOT NULL,
  "events"        text[] NOT NULL DEFAULT '{}'::text[],
  "enabled"       boolean NOT NULL DEFAULT true,
  "description"   text,
  "created_by"    uuid REFERENCES "users"("id"),
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "last_delivery_at"        timestamptz,
  "last_delivery_status"    integer,
  "last_delivery_error"     text,
  "consecutive_failures"    integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhooks_workspace_idx" ON "webhooks" ("workspace_id");
--> statement-breakpoint

-- Delivery attempt log — kept lean so we don't blow up storage. Only failed
-- attempts and the last successful one per webhook are useful; a cleanup
-- job (later) can prune.
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
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
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_idx"
  ON "webhook_deliveries" ("webhook_id", "delivered_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "widget_triggers" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "enabled"       boolean NOT NULL DEFAULT true,
  -- Conditions (all must match): stored as JSON so we can extend without
  -- migration. Current supported keys: {"secondsOnPage": number, "urlPattern": string}.
  "conditions"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "message"       text NOT NULL,
  "created_by"    uuid REFERENCES "users"("id"),
  "created_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "widget_triggers_workspace_idx"
  ON "widget_triggers" ("workspace_id");
