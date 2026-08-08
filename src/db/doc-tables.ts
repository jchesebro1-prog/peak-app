import {
  pgTable,
  text,
  jsonb,
  integer,
  bigint,
  bigserial,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/**
 * Document-collection tables — the server side of the prototype's store
 * seam (docs/specs/sync-architecture.json). Each prototype store becomes
 * one table of whole JSON documents:
 *
 * - id:   the prototype's human id ('Q-2042', 'FT-3001', 'lakefront', …)
 * - doc:  the full record, exactly the prototype's shape (field names are
 *         the spec — do not rename)
 * - rev:  optimistic-concurrency counter (prototype's dirty() rev)
 * - seq:  monotonic per-table write cursor — powers Phase 6 pull sync.
 *         bigserial only assigns on INSERT, so a `..._seq_bump` BEFORE
 *         UPDATE trigger (drizzle/0012_seq_bump_trigger.sql) re-draws it
 *         from the same sequence on every UPDATE, including soft-deletes
 *         (a plain UPDATE setting deleted:true). New tables added via
 *         docTable() need a matching trigger added in a later migration —
 *         see that file's header comment.
 * - review: server-owned triage subdoc (CloudStore._put preserved it on
 *         re-push; same rule here — client pushes never overwrite it)
 * - deleted: soft delete so offline clients learn about removals via pull
 *
 * Business volumes are small (hundreds of records); screens filter in JS
 * like the prototype did. Promote hot fields to real columns only when a
 * query actually needs it (documented upgrade path in AGENTS.md).
 */
function docTable(name: string) {
  return pgTable(
    name,
    {
      id: text("id").primaryKey(),
      doc: jsonb("doc").$type<Record<string, unknown>>().notNull(),
      rev: integer("rev").notNull().default(1),
      seq: bigserial("seq", { mode: "number" }).notNull(),
      updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
      receivedAt: bigint("received_at", { mode: "number" }).notNull(),
      review: jsonb("review").$type<Record<string, unknown> | null>(),
      deleted: boolean("deleted").notNull().default(false),
    },
    (t) => [
      // Pull-sync hot path: `WHERE seq > cursor ORDER BY seq` (doc-store
      // listSince) — a full scan+sort without this. seq is kept monotonic
      // per row by the BEFORE UPDATE trigger installed in
      // drizzle/0012_seq_bump_trigger.sql (bigserial alone only covers INSERT).
      index(`${name}_seq_idx`).on(t.seq),
      // Every listDocs filters `deleted = false`; keeps deleted tombstones
      // from dragging on scans as they accumulate.
      index(`${name}_deleted_idx`).on(t.deleted),
    ]
  );
}

/** Prototype store → table (localStorage key it replaces in comments). */
export const quotes = docTable("quotes"); // rss_pipeline_v2 (QuoteStore)
export const customers = docTable("customers"); // rss_customer_dir_v1 (CustomerStore)
export const leads = docTable("leads"); // rss_leads_v1 (LeadStore)
export const surveys = docTable("surveys"); // rss_surveys_v4 (SurveyStore)
export const comms = docTable("comms"); // rss_comms_v2 (CommStore threads)
export const flameJobs = docTable("flame_jobs"); // rss_flamejobs_v1 (FlameJobStore)
export const inspections = docTable("inspections"); // rss_inspections_v1 (InspectionStore)
export const repairJobs = docTable("repair_jobs"); // rss_repairjobs_v1 (RepairStore)
export const projects = docTable("projects"); // rss_projects_v2 (ProjectStore)
export const designs = docTable("designs"); // rss_sandbox_v2 (SandboxStore)
export const catalogParts = docTable("catalog_parts"); // catalog-data.js MASTER_CATALOG
export const siteVisits = docTable("site_visits"); // site visits + .ics invites (D76, no prototype ancestor)
export const consultingEngagements = docTable("consulting_engagements"); // ConsultingEngagement records (D90, no prototype ancestor)
export const reviewSnapshots = docTable("review_snapshots"); // frozen copies of what an approval approved (D92)
export const assignments = docTable("assignments"); // ad-hoc delegated tasks feeding My Queue (D93)
export const specSections = docTable("spec_sections"); // CSI bid-spec section templates (D94)
export const generatedSpecs = docTable("generated_specs"); // assembled bid specs per engagement (D94)
export const gridProjects = docTable("grid_projects"); // The Grid system-design projects (D108, no prototype ancestor)
export const gridSheets = docTable("grid_sheets"); // The Grid plan-sheet backgrounds — heavy dataUrls kept out of the placement-patched project doc (D108)
export const tasks = docTable("tasks"); // cross-record task rows, promoted from embedded ProjectTask[] (#17)
export const notes = docTable("notes"); // attachable note records — the customer Activity feed's note-taking surface (#21)
export const equipmentItems = docTable("equipment_items"); // Rentals module — gear catalog + per-location stock (D129, no prototype ancestor)
export const equipmentLocations = docTable("equipment_locations"); // Rentals module — warehouse/trailer locations gear stock lives at (D129)
export const equipmentBookings = docTable("equipment_bookings"); // Rentals module — booking/reservation records against equipment items (D129, Task 2)

export const DOC_TABLES = {
  quotes,
  customers,
  leads,
  surveys,
  comms,
  flame_jobs: flameJobs,
  inspections,
  repair_jobs: repairJobs,
  projects,
  designs,
  catalog_parts: catalogParts,
  site_visits: siteVisits,
  consulting_engagements: consultingEngagements,
  review_snapshots: reviewSnapshots,
  assignments,
  spec_sections: specSections,
  generated_specs: generatedSpecs,
  grid_projects: gridProjects,
  grid_sheets: gridSheets,
  tasks,
  notes,
  equipment_items: equipmentItems,
  equipment_locations: equipmentLocations,
  equipment_bookings: equipmentBookings,
} as const;

export type CollectionName = keyof typeof DOC_TABLES;

/**
 * Collections a browser client is allowed to write through the open
 * /api/sync/push endpoint. This MUST mirror FIELD_COLLECTIONS in
 * src/lib/sync/engine.ts — the offline outbox only ever captures these.
 *
 * Everything else (quotes, designs, leads, comms, catalog_parts) is managed
 * exclusively through permission-checked server actions and must NEVER be
 * writable via sync push. Quotes/designs carry the approval `review` subdoc
 * inside their doc, and catalog_parts carries list prices — if those were
 * pushable, any signed-in user could self-approve a quote or rewrite prices
 * by POSTing a crafted document. Keeping the endpoint scoped to genuinely
 * offline-synced, non-approval collections is the guardrail.
 *
 * "customers" left this list with the identity core (D85, spec §3.2): the
 * directory is now relational (companies/sites/contacts) and
 * server-authoritative — field staff don't create contacts offline. The
 * customers doc table remains registered read-only as rollback history.
 */
export const SYNCABLE_COLLECTIONS: CollectionName[] = [
  "surveys",
  "inspections",
  "flame_jobs",
  "repair_jobs",
  "projects",
  "tasks",
];
export const SYNCABLE_SET: ReadonlySet<string> = new Set(SYNCABLE_COLLECTIONS);

/**
 * Small-blob singletons (prototype localStorage blobs that aren't
 * collections): pricing_rules (rss_pricing_rules_v1), flametest_rates
 * (rss_flametest_rates_v1), repair_rates (rss_repair_rates_v1).
 */
export const blobs = pgTable("blobs", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** Per-user notification category mutes — rss_notifprefs_v1 (notifprefs.js). */
export const notifPrefs = pgTable("notif_prefs", {
  userName: text("user_name").primaryKey(),
  prefs: jsonb("prefs").$type<Record<string, boolean>>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** Cached geocode/route results — rss_geo_routecache_v1 (geo.js). */
export const geoCache = pgTable("geo_cache", {
  key: text("key").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
