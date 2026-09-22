CREATE TABLE "customer_domains" (
	"domain" text NOT NULL,
	"customer_id" text NOT NULL,
	"source" text NOT NULL,
	"added_by" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "customer_domains_domain_customer_id_pk" PRIMARY KEY("domain","customer_id")
);
--> statement-breakpoint
CREATE INDEX "customer_domains_domain_idx" ON "customer_domains" USING btree ("domain");