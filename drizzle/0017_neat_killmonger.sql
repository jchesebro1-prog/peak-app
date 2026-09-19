CREATE TABLE "grid_catalog" (
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
CREATE INDEX "grid_catalog_seq_idx" ON "grid_catalog" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "grid_catalog_deleted_idx" ON "grid_catalog" USING btree ("deleted");
--> statement-breakpoint
CREATE TRIGGER grid_catalog_seq_bump BEFORE UPDATE ON "grid_catalog" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
