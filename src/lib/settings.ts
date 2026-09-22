import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/seed-data";

/**
 * AppSettings — port of settings.js. The DB row stores a sparse patch over
 * DEFAULTS, exactly like the prototype's localStorage blob (rss_settings_v1).
 * The prototype's live `rss-settings` event becomes router.refresh() after
 * the update action (server components re-read per request).
 */

export type Office = {
  id: string;
  type?: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  lat: number | null;
  lng: number | null;
  /** Explicit travel origin for quote pricing. Exactly one is selected in Settings. */
  quoteDefault?: boolean;
  /** IANA timezone used for dashboard greetings and local office time. */
  timezone?: string;
};

export type AppSettingsData = {
  accent: string;
  companyName: string;
  federalHolidays: boolean;
  seedDemo: boolean;
  feedbackEmail: string;
  offices: Office[];
  /** Site-intake type catalog overrides, keyed by category (e.g.
   * "lighting.fixture") — see DEFAULT_INTAKE_CATALOG in survey-intake.ts. */
  intakeCatalog?: Record<string, string[]>;
  /** Site-visit reason picklist overrides (D76) — see DEFAULT_VISIT_REASONS
   *  in stores/site-visits.ts; empty/absent means use the defaults. */
  visitReasons?: string[];
  /** Consulting phase-menu overrides (D90) — see DEFAULT_CONSULTING_PHASES
   *  in stores/engagements.ts; empty/absent means use the defaults. */
  consultingPhases?: string[];
  /** Consulting proposal assumptions library (#35) — see
   *  DEFAULT_CONSULTING_ASSUMPTIONS in lib/consulting-stages.ts;
   *  empty/absent means use the (DRAFT-seed) defaults. The estimator's
   *  shared assumptions model (spec §4, wave ③) will consume this key. */
  consultingAssumptions?: string[];
  /** Peak-standards review checklists (D91), keyed by phase name — see
   *  DEFAULT_REVIEW_CHECKLISTS in stores/engagements.ts. Kept here beside
   *  consultingPhases rather than in its own collection: same kind of small
   *  admin-edited config list. A phase absent from this map falls back to
   *  the defaults; a phase mapped to [] deliberately has no checklist. */
  reviewChecklistTemplates?: Record<string, string[]>;
  /** Brand marks (IDEAS #32) — small data-URL images uploaded in Settings →
   *  Branding. `logoLight` sits on the dark nav bar; `logoDark` heads white
   *  documents (letters + reports) in place of the baked-in letterhead. */
  logoLight?: string | null;
  logoDark?: string | null;
  /** Document-template wording overrides (IDEAS — centralized templates),
   *  a sparse map { [templateId]: { [fieldId]: string } } over the built-in
   *  defaults in lib/templates.ts. Edited in the Templates screen. */
  templates?: import("@/lib/templates").TemplateOverrides;
  /** Per-template "last edited by/when" stamp (replace-in-place). */
  templatesMeta?: Record<string, { by: string; at: number }>;
  /** Catalog category → group/trade mapping overrides (punch #39), sparse
   *  patch over DEFAULT_CATEGORY_MAP in lib/catalog-taxonomy.ts, resolved
   *  via resolveCategoryMap. Absent = defaults; a stored entry wins over the
   *  default for that category key. Edited in Catalog → Categories & trades. */
  catalogCategoryMap?: import("@/lib/catalog-taxonomy").CategoryMap;
  /** Wire-type registry override (punch #39) — a full replacement list
   *  resolved via resolveWireTypes in lib/catalog-connect (stored ?? the
   *  DEFAULT_WIRE_TYPES seed list, not a per-key merge). Feeds Grid wiring
   *  validation (Task 4). */
  wireTypes?: import("@/lib/catalog-connect").WireType[];
  /** Customer custom-field DEFINITIONS (#23) — FULL REPLACEMENT on save
   *  (the wireTypes idiom, never a per-key merge): resolveFieldDefs in
   *  lib/customer-fields resolves `stored ?? []` and there are NO code
   *  defaults. ≤30 defs; edited in Settings → Admin → Customer fields.
   *  VALUES live per-company in the relational companies.custom column,
   *  keyed by CustomFieldDef.id. */
  customerFieldDefs?: import("@/lib/customer-fields").CustomFieldDef[];
  /** Venue-class soft-goods and lighting guidance (D132), stored sparsely
   * over the source-sheet defaults in lib/venue-doctrine.ts. */
  venueDoctrine?: import("@/lib/venue-doctrine").VenueDoctrinePatch;
  /** User-authored catalog-backed fixture assemblies. Full replacement. */
  fixtureAssemblies?: import("@/lib/fixture-assemblies").FixtureAssembly[];
  /** Per-manufacturer "price list effective" date (PUNCHLIST #133, D156),
   *  keyed by mfrKey() from lib/catalog-books (lowercase alphanumerics) →
   *  epoch ms. Written by the Catalog banner's date input (the one-time
   *  backfill for parts that predate `pricedAt`) and by both importers when
   *  an import writes rows. A part's effective date is the LATER of its own
   *  `pricedAt` and this — see effectivePriceDate. Absent = no book dates. */
  priceListEffective?: Record<string, number>;
  /** Recordings → Drive archive (Krisp recordings spec §1.3). Connection key
   *  of the mailbox whose Google account owns the archive; null = not
   *  configured, the nightly archive job waits. */
  recordingsArchiveMailbox: string | null;
  /** Cached Drive id of the root `Peak Recordings` folder (spec §5.2). */
  recordingsArchiveFolderId: string | null;
  /** Cached per-customer Drive subfolder ids, keyed by customerId (spec §5.2). */
  recordingsArchiveFolders: Record<string, string>;
  /** Pilot gate (spec §1.3, Settings → Beta): user ids allowed to see the
   *  Record button. Empty = everyone. See canRecord(). */
  recordingsBetaUsers: string[];
  /** Outcome of the last nightly archive pass (lib/krisp/archive.ts) — shown
   *  on Settings → Recordings. Optional: absent until the job has run once. */
  recordingsArchiveLastRun?: RecordingsArchiveLastRun | null;
};

export type RecordingsArchiveLastRun = {
  at: number;
  archived: number;
  failed: number;
  skipped: string | null;
};

/**
 * Pilot gate for the Record button (Recordings spec §1.3 / §7): an empty
 * `recordingsBetaUsers` list means the feature is open to everyone; a
 * non-empty list restricts it to those user ids. Pure — settings come from
 * getSettings() so the caller can gate a whole render in one read.
 */
export function canRecord(
  userId: string,
  settings: Pick<AppSettingsData, "recordingsBetaUsers">
): boolean {
  const allowed = Array.isArray(settings.recordingsBetaUsers) ? settings.recordingsBetaUsers : [];
  return allowed.length === 0 || allowed.includes(userId);
}

export async function getSettingsPatch(): Promise<Record<string, unknown>> {
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, "main"))
      .limit(1);
    return rows[0]?.data ?? {};
  } catch {
    // Settings must never take the app down (e.g. before first migration).
    return {};
  }
}

export async function getSettings(): Promise<AppSettingsData> {
  const patch = await getSettingsPatch();
  return { ...DEFAULT_SETTINGS, ...patch } as AppSettingsData;
}

/** Merge a patch into the stored settings (port of AppSettings.set). */
export async function setSettings(
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const current = await getSettingsPatch();
  const next = { ...current, ...patch };
  const rows = await db
    .select({ id: appSettings.id })
    .from(appSettings)
    .where(eq(appSettings.id, "main"))
    .limit(1);
  if (rows.length) {
    await db
      .update(appSettings)
      .set({ data: next, updatedAt: Date.now() })
      .where(eq(appSettings.id, "main"));
  } else {
    await db
      .insert(appSettings)
      .values({ id: "main", data: next, updatedAt: Date.now() });
  }
}

/** #133 — set (or with `at: null`, clear) one manufacturer's price-list
 *  effective date. `key` must already be an mfrKey(); an empty key is a
 *  no-op. Returns the full map after the write. */
export async function setPriceListEffective(
  key: string,
  at: number | null
): Promise<Record<string, number>> {
  const current = await getSettings();
  const next: Record<string, number> = { ...(current.priceListEffective || {}) };
  if (!key) return next;
  if (at == null) delete next[key];
  else next[key] = at;
  await setSettings({ priceListEffective: next });
  return next;
}
