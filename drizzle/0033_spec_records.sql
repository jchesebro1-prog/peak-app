-- Spec Library records — one record per product/system/companion spec,
-- matched against BOM rows any number of times, plus the prior-revision
-- history for each (docs/superpowers/specs/2026-09-28-spec-records-design.md
-- §1.1/§1.2).
--
-- Idempotent per D141 (the shared Neon database is migrated by more than one
-- branch's build). Column-for-column docTable(); the _seq_bump trigger keeps
-- pull-sync's `WHERE seq > cursor` honest.
CREATE TABLE IF NOT EXISTS "spec_records" (
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
CREATE INDEX IF NOT EXISTS "spec_records_seq_idx" ON "spec_records" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_records_deleted_idx" ON "spec_records" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_records_seq_bump BEFORE UPDATE ON "spec_records" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spec_record_revisions" (
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
CREATE INDEX IF NOT EXISTS "spec_record_revisions_seq_idx" ON "spec_record_revisions" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_record_revisions_deleted_idx" ON "spec_record_revisions" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_record_revisions_seq_bump BEFORE UPDATE ON "spec_record_revisions" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
