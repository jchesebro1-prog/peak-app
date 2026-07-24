CREATE TABLE "grid_projects" (
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
CREATE TABLE "grid_sheets" (
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
CREATE INDEX "grid_projects_seq_idx" ON "grid_projects" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "grid_projects_deleted_idx" ON "grid_projects" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "grid_sheets_seq_idx" ON "grid_sheets" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "grid_sheets_deleted_idx" ON "grid_sheets" USING btree ("deleted");