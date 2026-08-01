-- Punch #61: `seq` (bigserial) is only assigned by Postgres on INSERT — an
-- UPDATE (patchDoc, softDeleteDoc, setReview, and the direct writes in
-- /api/sync/push) left the old row's seq untouched, so pull-sync's
-- `WHERE seq > cursor ORDER BY seq` hot path (doc-store.ts listSince) could
-- silently stop reporting changes to a row a client had already synced past.
--
-- A BEFORE UPDATE trigger closes this for every write path, including ones
-- that reach a doc table directly instead of going through
-- src/db/doc-store.ts — an in-code seq bump could only cover paths someone
-- remembered to update. Soft-delete is a plain UPDATE (deleted:true), so
-- this single trigger covers inserts (via bigserial's own default),
-- updates, and soft-deletes without a separate case for any of them.
--
-- NOTE for future doc tables: `docTable()` in src/db/doc-tables.ts creates
-- the `seq` column and its index, but a brand-new table still needs its own
-- `CREATE TRIGGER ..._seq_bump` statement added in a later migration — this
-- trigger cannot retroactively attach itself to tables that don't exist yet.
CREATE OR REPLACE FUNCTION bump_doc_seq() RETURNS trigger AS $$
BEGIN
  NEW.seq := nextval(pg_get_serial_sequence(TG_TABLE_NAME, 'seq'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quotes_seq_bump BEFORE UPDATE ON "quotes" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER customers_seq_bump BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER leads_seq_bump BEFORE UPDATE ON "leads" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER surveys_seq_bump BEFORE UPDATE ON "surveys" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER comms_seq_bump BEFORE UPDATE ON "comms" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER flame_jobs_seq_bump BEFORE UPDATE ON "flame_jobs" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER inspections_seq_bump BEFORE UPDATE ON "inspections" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER repair_jobs_seq_bump BEFORE UPDATE ON "repair_jobs" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER projects_seq_bump BEFORE UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER designs_seq_bump BEFORE UPDATE ON "designs" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER catalog_parts_seq_bump BEFORE UPDATE ON "catalog_parts" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER site_visits_seq_bump BEFORE UPDATE ON "site_visits" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER consulting_engagements_seq_bump BEFORE UPDATE ON "consulting_engagements" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER review_snapshots_seq_bump BEFORE UPDATE ON "review_snapshots" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER assignments_seq_bump BEFORE UPDATE ON "assignments" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER spec_sections_seq_bump BEFORE UPDATE ON "spec_sections" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER generated_specs_seq_bump BEFORE UPDATE ON "generated_specs" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER grid_projects_seq_bump BEFORE UPDATE ON "grid_projects" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER grid_sheets_seq_bump BEFORE UPDATE ON "grid_sheets" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER tasks_seq_bump BEFORE UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
--> statement-breakpoint
CREATE TRIGGER notes_seq_bump BEFORE UPDATE ON "notes" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
