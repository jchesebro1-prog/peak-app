CREATE TABLE "equipment_bookings" (
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
CREATE TABLE "equipment_items" (
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
CREATE TABLE "equipment_locations" (
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
CREATE INDEX "equipment_bookings_seq_idx" ON "equipment_bookings" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "equipment_bookings_deleted_idx" ON "equipment_bookings" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "equipment_items_seq_idx" ON "equipment_items" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "equipment_items_deleted_idx" ON "equipment_items" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "equipment_locations_seq_idx" ON "equipment_locations" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "equipment_locations_deleted_idx" ON "equipment_locations" USING btree ("deleted");