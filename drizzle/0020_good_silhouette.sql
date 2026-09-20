CREATE TABLE "subassemblies" (
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
CREATE INDEX "subassemblies_seq_idx" ON "subassemblies" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "subassemblies_deleted_idx" ON "subassemblies" USING btree ("deleted");--> statement-breakpoint
CREATE TRIGGER subassemblies_seq_bump BEFORE UPDATE ON "subassemblies" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
