-- Convergence repair (punch #120, follows D141): production's shared Neon DB
-- was migrated by preview builds of two branches on 2026-09-21, so its
-- __drizzle_migrations high-water mark may sit past 0019_long_the_enforcers
-- (customer_domains, punch #96) without that table having been created —
-- drizzle-orm selects work by created_at < when only. Re-issue it
-- idempotently with a fresh timestamp so every database converges: fresh
-- (0019 created it → no-op here), production (creates it if 0019 was
-- skipped), local datadirs that first migrated on the broken journal.
CREATE TABLE IF NOT EXISTS "customer_domains" (
	"domain" text NOT NULL,
	"customer_id" text NOT NULL,
	"source" text NOT NULL,
	"added_by" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "customer_domains_domain_customer_id_pk" PRIMARY KEY("domain","customer_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_domains_domain_idx" ON "customer_domains" USING btree ("domain");
