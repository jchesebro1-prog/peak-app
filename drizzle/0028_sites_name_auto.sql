-- #216 — venues: `name` is derived "Location — Type" when name_auto is true,
-- and re-derives when an admin renames a venue type (lib/venue-types
-- planVenueRenames). Existing venues keep their hand-kept names (false).
-- Idempotent per D141: one Neon database is migrated by every branch's build.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "name_auto" boolean DEFAULT false NOT NULL;
