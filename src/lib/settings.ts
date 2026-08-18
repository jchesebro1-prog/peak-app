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
  venueDoctrine?: import("@/lib/venue-doctrine").VenueDoctrine;
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
};

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
