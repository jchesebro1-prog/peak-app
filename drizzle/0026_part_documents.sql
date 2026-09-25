-- Part documents (#DOC, docs/superpowers/specs/2026-09-25-part-documents-design.md §5) —
-- shared datasheet/spec-sheet records, the part↔document links, and the
-- fixture→accessory graph that computes accessory coverage.
--
-- Hand-rewritten from the generated DDL so it is idempotent per D141: this
-- file runs against a shared Neon database that more than one branch's build
-- migrates, and the 2026-07 production failure on 0020 was exactly a
-- non-idempotent CREATE. Column-for-column `docTable()`; each table needs its
-- own `_seq_bump` trigger or pull-sync's `WHERE seq > cursor` goes blind.
CREATE TABLE IF NOT EXISTS "part_documents" (
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
CREATE INDEX IF NOT EXISTS "part_documents_seq_idx" ON "part_documents" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_documents_deleted_idx" ON "part_documents" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER part_documents_seq_bump BEFORE UPDATE ON "part_documents" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_document_links" (
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
CREATE INDEX IF NOT EXISTS "part_document_links_seq_idx" ON "part_document_links" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_document_links_deleted_idx" ON "part_document_links" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER part_document_links_seq_bump BEFORE UPDATE ON "part_document_links" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_accessory_links" (
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
CREATE INDEX IF NOT EXISTS "part_accessory_links_seq_idx" ON "part_accessory_links" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_accessory_links_deleted_idx" ON "part_accessory_links" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER part_accessory_links_seq_bump BEFORE UPDATE ON "part_accessory_links" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
