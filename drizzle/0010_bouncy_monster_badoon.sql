CREATE TABLE "notes" (
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
CREATE INDEX "notes_seq_idx" ON "notes" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "notes_deleted_idx" ON "notes" USING btree ("deleted");