CREATE TABLE "gmail_labels" (
	"mailbox_key" text NOT NULL,
	"label_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"text_color" text,
	"background_color" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "gmail_labels_mailbox_key_label_id_pk" PRIMARY KEY("mailbox_key","label_id")
);
--> statement-breakpoint
CREATE INDEX "gmail_labels_mailbox_idx" ON "gmail_labels" USING btree ("mailbox_key");