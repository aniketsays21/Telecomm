ALTER TABLE "messages" ADD COLUMN "email_references" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_workspace_email_message_id_key" ON "messages" USING btree ("workspace_id","email_message_id") WHERE "messages"."email_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_support_email_key" ON "workspaces" USING btree (lower("settings" ->> 'supportEmail'));