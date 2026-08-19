CREATE TABLE "contact_page_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "session_id" text,
  "url" text NOT NULL,
  "path" text NOT NULL,
  "title" text,
  "referrer" text,
  "viewed_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "contact_page_views_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "contact_page_views_contact_fk"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "contact_page_views_contact_idx" ON "contact_page_views" ("contact_id", "viewed_at" DESC);
--> statement-breakpoint
CREATE INDEX "contact_page_views_workspace_idx" ON "contact_page_views" ("workspace_id", "viewed_at" DESC);
