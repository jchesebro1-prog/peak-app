-- Specs module (D-SPEC), Phase A — the three new library collections.
--
-- Hand-rewritten from the generated DDL so it is idempotent per D141: this
-- file runs against a shared Neon database that more than one branch's build
-- migrates, and the 2026-07 production failure on 0020 was exactly a
-- non-idempotent CREATE. Column-for-column `docTable()`; each table needs its
-- own `_seq_bump` trigger or pull-sync's `WHERE seq > cursor` goes blind.
CREATE TABLE IF NOT EXISTS "spec_articles" (
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
CREATE INDEX IF NOT EXISTS "spec_articles_seq_idx" ON "spec_articles" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_articles_deleted_idx" ON "spec_articles" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_articles_seq_bump BEFORE UPDATE ON "spec_articles" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spec_templates" (
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
CREATE INDEX IF NOT EXISTS "spec_templates_seq_idx" ON "spec_templates" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_templates_deleted_idx" ON "spec_templates" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_templates_seq_bump BEFORE UPDATE ON "spec_templates" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spec_curtain_templates" (
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
CREATE INDEX IF NOT EXISTS "spec_curtain_templates_seq_idx" ON "spec_curtain_templates" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_curtain_templates_deleted_idx" ON "spec_curtain_templates" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_curtain_templates_seq_bump BEFORE UPDATE ON "spec_curtain_templates" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
