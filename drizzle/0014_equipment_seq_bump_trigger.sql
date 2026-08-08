-- Rentals module (Task 1, D129): the three new doc tables added in
-- 0013_colossal_silver_samurai.sql (equipment_items, equipment_locations,
-- equipment_bookings) need their own BEFORE UPDATE triggers, per the note in
-- 0012_seq_bump_trigger.sql — bump_doc_seq() cannot retroactively attach
-- itself to tables that didn't exist yet when it was created. Without this,
-- every UPDATE path (patchDoc, softDeleteDoc, setReview, and upsertDoc's
-- onConflictDoUpdate branch — which fires on every re-upsert of an existing
-- equipment item, e.g. a rate change) would leave `seq` stale, breaking
-- pull-sync's `WHERE seq > cursor ORDER BY seq` for these collections.
CREATE TRIGGER equipment_items_seq_bump BEFORE UPDATE ON "equipment_items" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER equipment_locations_seq_bump BEFORE UPDATE ON "equipment_locations" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER equipment_bookings_seq_bump BEFORE UPDATE ON "equipment_bookings" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
