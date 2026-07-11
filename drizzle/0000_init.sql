CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"google_email" text,
	"roles" jsonb NOT NULL,
	"color" text NOT NULL,
	"initials" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"photo_url" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
