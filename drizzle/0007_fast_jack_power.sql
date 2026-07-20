CREATE TABLE "assignments" (
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
CREATE TABLE "generated_specs" (
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
CREATE TABLE "review_snapshots" (
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
CREATE TABLE "spec_sections" (
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
CREATE INDEX "assignments_seq_idx" ON "assignments" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "assignments_deleted_idx" ON "assignments" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "generated_specs_seq_idx" ON "generated_specs" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "generated_specs_deleted_idx" ON "generated_specs" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "review_snapshots_seq_idx" ON "review_snapshots" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "review_snapshots_deleted_idx" ON "review_snapshots" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "spec_sections_seq_idx" ON "spec_sections" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "spec_sections_deleted_idx" ON "spec_sections" USING btree ("deleted");