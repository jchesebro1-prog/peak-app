CREATE TABLE "site_visits" (
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
CREATE INDEX "site_visits_seq_idx" ON "site_visits" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "site_visits_deleted_idx" ON "site_visits" USING btree ("deleted");