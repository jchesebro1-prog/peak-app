-- Vendors module (#122, docs/superpowers/specs/2026-09-21-vendors-module-design.md §1):
-- `vendor_profiles` — one JSON document per vendor company, id = the company id.
-- Hand-rewritten from the generated DDL so it is idempotent per D141: it
-- converges on the shared Neon database whether or not a preview build
-- already applied it. The block is column-for-column docTable() — compare
-- drizzle/0021_krisp_recordings.sql.
CREATE TABLE IF NOT EXISTS "vendor_profiles" (
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
CREATE INDEX IF NOT EXISTS "vendor_profiles_seq_idx" ON "vendor_profiles" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_profiles_deleted_idx" ON "vendor_profiles" USING btree ("deleted");--> statement-breakpoint
-- Per the NOTE in 0012_seq_bump_trigger.sql: a new doc table needs its own
-- BEFORE UPDATE trigger or pull-sync's `WHERE seq > cursor` stops seeing updates.
CREATE OR REPLACE TRIGGER vendor_profiles_seq_bump BEFORE UPDATE ON "vendor_profiles" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
