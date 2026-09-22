-- Recordings: in-app site-visit capture → Krisp transcription → write-back →
-- Drive archive (docs/superpowers/specs/2026-09-21-krisp-recordings-design.md).
-- Hand-written (drizzle-kit generate needs the single-process dev DB); the
-- `recordings` block is column-for-column the task_templates block from 0020.
CREATE TABLE IF NOT EXISTS "recordings" (
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
CREATE TABLE IF NOT EXISTS "krisp_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"api_key" text NOT NULL,
	"krisp_user_id" integer,
	"krisp_email" text,
	"krisp_name" text,
	"connected_at" bigint NOT NULL,
	"last_used_at" bigint,
	"last_error" text,
	"import_claimed_at" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recordings_seq_idx" ON "recordings" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recordings_deleted_idx" ON "recordings" USING btree ("deleted");--> statement-breakpoint
-- Hand-added, per the NOTE in 0012_seq_bump_trigger.sql: bump_doc_seq()
-- cannot retroactively attach itself to a table that didn't exist yet.
-- Without this, every UPDATE (patchDoc, softDeleteDoc, setReview) would
-- leave `seq` stale and pull-sync's `WHERE seq > cursor ORDER BY seq` would
-- stop reporting changes to this table — the same failure 0012/0014 fixed
-- for the tables that existed before them.
CREATE OR REPLACE TRIGGER recordings_seq_bump BEFORE UPDATE ON "recordings" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
