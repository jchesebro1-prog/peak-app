CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"lifecycle" text DEFAULT 'none' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website" text,
	"main_phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"pricing_tier" text,
	"owner_user_id" text,
	"referred_by_contact_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"email" text NOT NULL,
	"label" text DEFAULT 'work' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_phones" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"phone" text NOT NULL,
	"label" text DEFAULT 'work' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"home_company_id" text,
	"title" text DEFAULT '' NOT NULL,
	"pricing_tier" text,
	"status" text DEFAULT 'active' NOT NULL,
	"user_id" text,
	"owner_user_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"legacy_loc_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" text,
	"lng" text,
	"venue_kind" text DEFAULT 'proscenium' NOT NULL,
	"travel_miles" text,
	"travel_min" text,
	"drive_folder_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "companies_deleted_idx" ON "companies" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "contact_emails_contact_idx" ON "contact_emails" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_emails_email_idx" ON "contact_emails" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contact_phones_contact_idx" ON "contact_phones" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_home_company_idx" ON "contacts" USING btree ("home_company_id");--> statement-breakpoint
CREATE INDEX "contacts_deleted_idx" ON "contacts" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX "sites_company_idx" ON "sites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "sites_deleted_idx" ON "sites" USING btree ("deleted");