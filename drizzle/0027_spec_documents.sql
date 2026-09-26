-- Spec builder (#205 Phase B) — saved specs, one per CSI section.
--
-- Idempotent per D141 (the shared Neon database is migrated by more than one
-- branch's build). Column-for-column docTable(); the _seq_bump trigger keeps
-- pull-sync's `WHERE seq > cursor` honest.
CREATE TABLE IF NOT EXISTS "spec_documents" (
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
CREATE INDEX IF NOT EXISTS "spec_documents_seq_idx" ON "spec_documents" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_documents_deleted_idx" ON "spec_documents" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_documents_seq_bump BEFORE UPDATE ON "spec_documents" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
