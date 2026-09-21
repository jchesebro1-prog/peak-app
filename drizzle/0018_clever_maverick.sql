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
ALTER TABLE "sites" ADD COLUMN "location_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "previous_login_at" bigint;--> statement-breakpoint
CREATE INDEX "grid_catalog_seq_idx" ON "grid_catalog" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "grid_catalog_deleted_idx" ON "grid_catalog" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "subassemblies_seq_idx" ON "subassemblies" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "subassemblies_deleted_idx" ON "subassemblies" USING btree ("deleted");