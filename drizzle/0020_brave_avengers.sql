CREATE TABLE "calendar_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"google_email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"expires_at" bigint,
	"scope" text,
	"calendars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "calendar_connections_user_idx" ON "calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_templates_seq_idx" ON "task_templates" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "task_templates_deleted_idx" ON "task_templates" USING btree ("deleted");--> statement-breakpoint
-- Hand-added, per the NOTE in 0012_seq_bump_trigger.sql: bump_doc_seq()
-- cannot retroactively attach itself to a table that didn't exist yet.
-- Without this, every UPDATE (patchDoc, softDeleteDoc, setReview) would
-- leave `seq` stale and pull-sync's `WHERE seq > cursor ORDER BY seq` would
-- stop reporting changes to this table — the same failure 0012/0014 fixed
-- for the tables that existed before them.
CREATE TRIGGER task_templates_seq_bump BEFORE UPDATE ON "task_templates" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
