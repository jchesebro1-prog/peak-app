CREATE TABLE "gmail_connections" (
	"mailbox_key" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"user_id" text,
	"connected_by" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"expires_at" bigint,
	"scope" text,
	"history_id" text,
	"initial_import_done" boolean DEFAULT false NOT NULL,
	"last_sync_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
