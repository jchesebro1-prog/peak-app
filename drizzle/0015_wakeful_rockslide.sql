ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "office_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "certifications" text;--> statement-breakpoint
-- PUNCHLIST #9 (D129): preserve existing deactivated members' state — the
-- new `status` column defaults every row to 'active', which would silently
-- reactivate anyone previously deactivated via the old `active` boolean.
-- `active` is dropped in the next migration; this must run first, while it
-- still exists to read.
UPDATE "users" SET "status" = 'archived' WHERE "active" = false;