CREATE TABLE "gmail_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL UNIQUE,
  "email_address" text NOT NULL,
  "google_user_id" text NOT NULL,
  "access_token" text NOT NULL,
  "access_token_expires_at" timestamptz NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "scope" text NOT NULL,
  "history_id" text,
  "connected_by_user_id" uuid,
  "last_polled_at" timestamptz,
  "last_error" text,
  "connected_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "gmail_accounts_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "gmail_accounts_user_fk"
    FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_routing_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "subject_pattern" text NOT NULL,
  "match_mode" text NOT NULL,
  "assignee_id" uuid NOT NULL,
  "priority" int NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "gmail_routing_rules_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "gmail_routing_rules_assignee_fk"
    FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "gmail_routing_rules_workspace_priority_idx"
  ON "gmail_routing_rules" ("workspace_id", "priority");
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "email_provider" text;
