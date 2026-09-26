import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/seed-data";
import type { DashboardLayout } from "@/lib/dashboard-layout";

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
  /** #145 D165/D166 — phase weight by phase NAME; absent reads as 1. */
  consultingPhaseWeights?: Record<string, number>;
  /** #145 D165 — the discipline vocabulary; whole-list override. */
  consultingDisciplines?: string[];
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
   *  validation (Task 4) — both editor.tsx's client-side pre-check and
   *  addRouteAction's server-side authority resolve this same list, rather
   *  than falling back to DEFAULT_WIRE_TYPES. Edited in Design → Grid
   *  Settings (/design/grid/settings). */
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
  /** Pre-#FXB Assemblies-tab records. Since the fixture builder they are
   *  converted into `subassemblies` fixture rows (src/lib/fixtures-migrate.ts)
   *  and this array is a read-only backup — never written by the app. */
  fixtureAssemblies?: import("@/lib/fixture-assemblies").FixtureAssembly[];
  /** Per-manufacturer "price list effective" date (PUNCHLIST #133, D156),
   *  keyed by mfrKey() from lib/catalog-books (lowercase alphanumerics) →
   *  epoch ms. Written by the Catalog banner's date input (the one-time
   *  backfill for parts that predate `pricedAt`) and by both importers when
   *  an import writes rows. A part's effective date is the LATER of its own
   *  `pricedAt` and this — see effectivePriceDate. Absent = no book dates. */
  priceListEffective?: Record<string, number>;
  /** Grid symbol per catalog category (#131, D154) — FULL REPLACEMENT on
   *  save (the wireTypes idiom): resolveCategoryShapes in
   *  lib/design/grid-symbols returns the seed when absent and exactly the
   *  stored map when present. Edited in Design → Grid Settings
   *  (/design/grid/settings) — moved off Settings → Admin (D154 shipped
   *  there; the card was dropped from Settings without a new home until
   *  this route). */
  gridCategoryShapes?: Record<string, import("@/lib/design/grid-symbols").GridShape>;
  /** Stock symbols (spec 2026-09-25) — SPARSE per-category icon overrides
   *  (category → grid-icons id) MERGED over DEFAULT_CATEGORY_ICONS by
   *  resolveCategoryIcons; absent/null = the shipped defaults. Edited in
   *  Design → Grid Settings → Category icons. gridCategoryShapes above is
   *  now read only as a legacy fallback (symbolLook). */
  gridCategoryIcons?: Record<string, string> | null;
  /** Stock symbols — SPARSE colour overrides keyed by catalog group, trade
   *  or "Other" (SYMBOL_COLOR_KEYS), merged over DEFAULT_SYMBOL_COLORS by
   *  resolveSymbolColors. Edited in Design → Grid Settings → Symbol colours. */
  gridSymbolColors?: Record<string, string> | null;
  /** Drawing set (#209) — the "Standard general notes" printed on every
   *  set's cover (T-001) unless that set has its own. One note per line;
   *  null/absent = none. Edited in Design → Grid Settings. */
  gridStandardNotes?: string | null;
  /** Pipelines (spec 2026-09-24 §3) — FULL REPLACEMENT lists (the wireTypes
   *  idiom). resolvePipelines in lib/pipelines returns the Daylite seeds when
   *  absent or invalid. Edited in Settings → Pipelines. */
  projectPipelines?: import("@/lib/pipelines").ProjectPipeline[];
  quotePipelines?: import("@/lib/pipelines").QuotePipeline[];
  defaultQuotePipelineId?: string;
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
  /** #122 — Settings → Catalog: who receives the vendor price-list tasks
   *  (spec §1). null/absent = the default rule in resolveCatalogOwner()
   *  (the user named "Jena Tolksdorf" if present, else the first Admin). */
  catalogOwner?: { userId: string } | null;
  /** Company-wide dashboard layout; users may override sparsely. */
  dashboardDefaults: DashboardLayout;
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

/** #145 — the intake four (survey-intake.ts DISCIPLINE_GROUPS) as defaults. */
export const DEFAULT_CONSULTING_DISCIPLINES = ["rigging", "curtain", "lighting", "av"];

export function mergedConsultingDisciplines(stored?: string[] | null): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CONSULTING_DISCIPLINES;
}

/**
 * #155 D231 — the save-side rule for a consulting quote's disciplines.
 *
 * `posted` is untrusted form input (a public server action), so it is
 * allowlisted rather than trusted: a value survives only if it is in the
 * live Settings vocabulary OR already on the quote being edited. The
 * second clause is the fix — a discipline an admin has since deleted from
 * Settings stays on an old quote (and so keeps gating its template tasks)
 * unless the user actually unticks it, which the builder's "(removed)"
 * checkbox says it does. The first clause is the guardrail that was always
 * here: a value in neither list is refused, so a hand-crafted POST still
 * can't stash an arbitrary string onto the quote (and, at spawn, the
 * engagement). `existing` comes from the stored quote, never from the
 * form, so it can't be widened by the caller.
 *
 * Values are trimmed, lowercased (how the vocabulary is stored —
 * saveConsultingDisciplinesAction) and de-duplicated; both allowlists are
 * matched case-insensitively so a legacy mixed-case stored vocabulary
 * still matches. Pass `existing` as empty/null on the create path, where
 * there is no prior quote and the rule is the plain allowlist.
 */
export function resolveDisciplines(
  posted: unknown,
  live: readonly string[] | null | undefined,
  existing?: readonly string[] | null
): string[] {
  const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();
  const allowed = new Set(
    [...(live || []), ...(existing || [])].map(norm).filter(Boolean)
  );
  return Array.from(
    new Set((Array.isArray(posted) ? posted : []).map(norm).filter((d) => d && allowed.has(d)))
  );
}

/**
 * #145 — pair each phase NAME with its stored weight (absent/invalid → 1)
 * and a stable id. The id is the phase name slugged, so it survives a
 * settings edit that reorders the list and matches across regenerations.
 */
export function phaseWeightsFor(
  stored: Record<string, number> | null | undefined,
  phaseNames: readonly string[]
): Array<{ phaseId: string; name: string; weight: number }> {
  return phaseNames.map((name) => {
    const w = Number(stored?.[name]);
    return {
      phaseId: "ph-" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name,
      weight: Number.isFinite(w) && w > 0 ? w : 1,
    };
  });
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

/**
 * Strict counterpart to getSettingsPatch: a DB error PROPAGATES instead of
 * resolving to `{}`. getSettingsPatch's swallow exists so settings can never
 * take the whole app down (e.g. before the first migration has run) — right
 * for a page render, wrong for a writer that would otherwise mistake "the
 * read failed" for "there is nothing configured" and act on an empty patch
 * as if it were the truth (#207 final fix wave: the one-time assembly-graph
 * sync — a transient failure here must not silently sync subassemblies only
 * and still mark the pass complete). Use this wherever an empty read must
 * never be treated as legitimately empty.
 */
export async function getSettingsPatchStrict(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, "main"))
    .limit(1);
  return rows[0]?.data ?? {};
}

export async function getSettingsStrict(): Promise<AppSettingsData> {
  const patch = await getSettingsPatchStrict();
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
