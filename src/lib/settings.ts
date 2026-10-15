import { eq, sql } from "drizzle-orm";
import { getDb, withTransaction } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/seed-data";
import type { DashboardLayout } from "@/lib/dashboard-layout";
import { resolveVenueDoctrine, type VenueDoctrineEntry } from "@/lib/venue-doctrine";
import type { VenueClass } from "@/lib/stores/venue-classes";

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
  /** Grid notes #9 — "Put the Peak header on documents" (Settings →
   *  Branding): the company default for the letterhead on specs (first page)
   *  and the plain-name PDFs. Absent = ON; only an explicit false turns it
   *  off. Each document can override it (src/lib/letterhead.ts). */
  peakHeader?: boolean;
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
  /** Documents (#218) — the category list for company / venue / project
   *  files. FULL REPLACEMENT on save (the customerFieldDefs idiom);
   *  resolveDocumentCategories in lib/document-categories returns the seed
   *  when absent. Edited in Settings → Admin → Document categories. */
  documentCategories?: import("@/lib/document-categories").DocumentCategory[];
  /** #344 — Venue Assessments Final thoughts: internal tags. FULL REPLACEMENT on save; resolveSurveyTags in
   *  lib/survey-tags returns the starter list when absent. Edited in Settings → Field. */
  surveyInternalTags?: import("@/lib/survey-tags").SurveyTag[];
  /** #216 — Settings → Venue types. FULL REPLACEMENT list; resolved by
   *  venueTypesFrom (lib/venue-types) — absent = the seed (5 built-ins +
   *  Gym Stage). sites.venue_kind stores a type key. */
  venueTypes?: import("@/lib/venue-types").VenueType[];
  /** #242 — Settings → Admin → Review limits: per person (users.id) per
   *  review kind, a whole-dollar self-approval ceiling or "none" (No limit);
   *  a missing key = blank = always needs review. FULL REPLACEMENT on save,
   *  read through reviewLimitsFrom (lib/review-limits); absent = {}. */
  reviewLimits?: import("@/lib/review-limits").ReviewLimits;
  /** Venue-class soft-goods and lighting guidance (D132), stored sparsely
   * over the source-sheet defaults in lib/venue-doctrine.ts. */
  venueDoctrine?: import("@/lib/venue-doctrine").VenueDoctrinePatch;
  /** Pre-#210 Assemblies-tab records. Since the fixture builder they are
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
  /** Device designators (#321): digits an issued number is padded to —
   *  2 = `CRO-01` (Bray's drawings), 1 = `CRO-1`. Absent = 2. Changing it never
   *  rewrites a stored designator; Renumber (Devices tab) does. Edited in
   *  Design → Grid Settings → Designator numbers. */
  designatorDigits?: 1 | 2;
  /** Pipelines (spec 2026-09-24 §3) — FULL REPLACEMENT lists (the wireTypes
   *  idiom). resolvePipelines in lib/pipelines returns the Daylite seeds when
   *  absent or invalid. Edited in Settings → Pipelines. */
  projectPipelines?: import("@/lib/pipelines").ProjectPipeline[];
  quotePipelines?: import("@/lib/pipelines").QuotePipeline[];
  defaultQuotePipelineId?: string;
  /** One-time pipeline fixes already applied to the stored lists (Jeff 2026-10-15 #42: "bid-spec-lead-qualify"). */
  pipelineFixes?: string[];
  /** Recordings → Drive archive (Krisp recordings spec §1.3). Connection key
   *  of the mailbox whose Google account owns the archive; null = not
   *  configured, the nightly archive job waits. */
  recordingsArchiveMailbox: string | null;
  /** #283 — connection key of the mailbox whose Google account can read the
   *  Peak Product Photos folder (drive.readonly); null = not set. */
  catalogPhotosMailbox: string | null;
  /** Cached Drive id of the root `Peak Recordings` folder (spec §5.2). */
  recordingsArchiveFolderId: string | null;
  /** Cached per-customer Drive subfolder ids, keyed by customerId (spec §5.2). */
  recordingsArchiveFolders: Record<string, string>;
  /** Pilot gate (spec §1.3, Settings → Beta): user ids allowed to see the
   *  Record button. Empty = everyone. See canRecord(). */
  recordingsBetaUsers: string[];
  /** #334 Assist pilot (Settings → Beta): allow-listed user ids. Empty = NOBODY (unlike recordingsBetaUsers). Read via assistSettingsOf(). */
  assistUsers?: string[];
  /** #334: per-feature switches; a missing key counts as on, except the
   *  opt-in ones (file, promise, brief, ask, vendorpdf — OPT_IN_FEATURES), which count as off. */
  assistFeatures?: { tasks?: boolean; reply?: boolean; estimate?: boolean; file?: boolean; promise?: boolean; brief?: boolean; ask?: boolean; vendorpdf?: boolean };
  /** #334: monthly API spend cap in dollars (default 200). */
  assistMonthlyCapUsd?: number;
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

/** #321: the digits an issued designator number is padded to (default 2). */
export function designatorDigitsOf(s: { designatorDigits?: 1 | 2 | null } | null | undefined): 1 | 2 {
  return s?.designatorDigits === 1 ? 1 : 2;
}

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
  return settingsFrom(await getSettingsPatch());
}

/** The stored sparse patch over DEFAULT_SETTINGS — what getSettings() returns
 *  for a given row. Pure; updateSettings callbacks use it to read the same
 *  defaulted view a getSettings() caller sees. */
export function settingsFrom(patch: Record<string, unknown>): AppSettingsData {
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

/**
 * Merge a patch into the stored settings (port of AppSettings.set).
 *
 * ONE atomic statement (#342): `INSERT … ON CONFLICT DO UPDATE SET data =
 * data || patch`, so two concurrent writers of different keys can never lose
 * each other (the old read → spread → write-back did, and a failed read
 * swallowed to `{}` would have wiped every setting). Same meaning as the old
 * `{ ...current, ...patch }`: a top-level shallow merge, a patch key replaces
 * the whole stored value. A key whose patch value is `undefined` used to be
 * written back as undefined, which JSON storage drops — i.e. it DELETED the
 * stored key; `||` alone would keep the old value, so those keys are removed
 * explicitly (`data - 'key'`) before the merge to stay equivalent.
 */
export async function setSettings(
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const { kept, expr } = settingsPatchSql(patch);
  const now = Date.now();
  await db
    .insert(appSettings)
    .values({ id: "main", data: kept, updatedAt: now })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { data: expr, updatedAt: now },
    });
}

/** The in-database merge setSettings and updateSettings write: keys whose
 *  patch value is `undefined` are removed (`data - 'key'`), then the rest is
 *  merged on top (`|| kept`). Values bind as one jsonb parameter. */
function settingsPatchSql(patch: Record<string, unknown>) {
  const dropped: string[] = [];
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) dropped.push(k);
    else kept[k] = v;
  }
  let base = sql`${appSettings.data}`;
  for (const k of dropped) base = sql`(${base} - ${k}::text)`;
  return { kept, expr: sql`${base} || ${JSON.stringify(kept)}::jsonb` };
}

/** Keys mergeSettingsObject may nest-merge. A fixed list, never caller text:
 *  the key is bound as a parameter AND must be on this list. */
const MERGEABLE_OBJECT_KEYS = ["assistFeatures"] as const;
export type MergeableSettingsObjectKey = (typeof MERGEABLE_OBJECT_KEYS)[number];

/**
 * Atomically shallow-merge `partial` INTO the object stored under settings key
 * `key` (#342) — `data = jsonb_set(data, {key}, coalesce(data->key, {}) ||
 * partial)` in one upsert, so concurrent writers of different nested keys
 * (seven Assist feature switches clicked in a row) all persist. Keys absent
 * from `partial` keep their stored value. A non-object stored value is
 * replaced by `partial`. Values bind as parameters; `key` must be allow-listed.
 */
export async function mergeSettingsObject(
  key: MergeableSettingsObjectKey,
  partial: Record<string, unknown>
): Promise<void> {
  if (!(MERGEABLE_OBJECT_KEYS as readonly string[]).includes(key)) {
    throw new Error(`mergeSettingsObject: "${key}" is not a mergeable settings key`);
  }
  const db = await getDb();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) if (v !== undefined) clean[k] = v;
  const json = JSON.stringify(clean);
  const now = Date.now();
  const cur = sql`CASE WHEN jsonb_typeof(${appSettings.data} -> ${key}::text) = 'object' THEN ${appSettings.data} -> ${key}::text ELSE '{}'::jsonb END`;
  await db
    .insert(appSettings)
    .values({ id: "main", data: { [key]: clean }, updatedAt: now })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        data: sql`jsonb_set(${appSettings.data}, ARRAY[${key}::text], ${cur} || ${json}::jsonb, true)`,
        updatedAt: now,
      },
    });
}

/**
 * setSettings' merge, in JS (#343): each patch key replaces the stored value;
 * an `undefined` value removes the key. Pure — never mutates `current`.
 */
export function applySettingsPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}

/**
 * Read-modify-write of the settings row under a row lock (#343). For a writer
 * whose new value depends on the current one — one entry of a shared map or
 * list (an office, a template, a manufacturer's price date) — so two people
 * editing different entries at the same moment both keep their change.
 *
 * Runs in a transaction (joins an outer one): `SELECT data … FOR UPDATE`,
 * then `fn(current)` returns a top-level patch merged exactly like setSettings
 * (a key replaces the stored value, `undefined` deletes it), or `null` to
 * write nothing. `current` is the raw stored patch — wrap it in settingsFrom()
 * for the defaulted view. `fn` must be pure, synchronous and fast: it can run
 * more than once (see below) and runs while the row is locked.
 *
 * No row yet: `fn({})` is asked first, and `null` returns without writing.
 * Otherwise `INSERT … ON CONFLICT DO NOTHING` (a racing first writer may land
 * it instead — this one then waits on it) and the row is re-selected FOR
 * UPDATE, so `fn` sees whatever the winner wrote. Returns the stored patch
 * after the call.
 */
export async function updateSettings(
  fn: (current: Record<string, unknown>) => Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  return withTransaction(async () => {
    const db = await getDb();
    const lock = () =>
      db
        .select({ data: appSettings.data })
        .from(appSettings)
        .where(eq(appSettings.id, "main"))
        .for("update")
        .limit(1);
    let rows = await lock();
    if (!rows.length) {
      if (fn({}) === null) return {};
      await db
        .insert(appSettings)
        .values({ id: "main", data: {}, updatedAt: Date.now() })
        .onConflictDoNothing({ target: appSettings.id });
      rows = await lock();
    }
    const current = (rows[0]?.data ?? {}) as Record<string, unknown>;
    const patch = fn(current);
    if (patch === null) return current;
    // Only the patched keys travel (`(data - dropped) || kept`, as setSettings
    // writes them), never the whole document — the logos stay where they are.
    await db
      .update(appSettings)
      .set({ data: settingsPatchSql(patch).expr, updatedAt: Date.now() })
      .where(eq(appSettings.id, "main"));
    return applySettingsPatch(current, patch);
  });
}

/** #133 — set (or with `at: null`, clear) one manufacturer's price-list
 *  effective date. `key` must already be an mfrKey(); an empty key is a
 *  no-op. Returns the full map after the write. #343: the one entry is edited
 *  under the settings row lock (updateSettings), so two manufacturers' dates
 *  set at the same moment both persist. */
export async function setPriceListEffective(
  key: string,
  at: number | null
): Promise<Record<string, number>> {
  if (!key) return { ...((await getSettings()).priceListEffective || {}) };
  let next: Record<string, number> = {};
  await updateSettings((cur) => {
    next = { ...(settingsFrom(cur).priceListEffective || {}) };
    if (at == null) delete next[key];
    else next[key] = at;
    return { priceListEffective: next };
  });
  return next;
}

/* ---- Locations (offices) — #343 per-entry writes under the row lock ----
   The Settings → Locations actions validate and build the Office, then call
   these; each edits one entry of `offices` inside updateSettings so two
   admins saving different locations at once both keep their change. */

/** Add (`isNew`) or update one office. A new office becomes the quote default
 *  when none is; an update merges over the stored entry (an unknown id is
 *  appended, as before). */
export async function upsertOffice(office: Office, isNew: boolean): Promise<void> {
  await updateSettings((cur) => {
    const s = settingsFrom(cur);
    const offices = Array.isArray(s.offices) ? s.offices.slice() : [];
    const clean: Office = { ...office };
    if (isNew) {
      if (!offices.some((o) => o.quoteDefault)) clean.quoteDefault = true;
      offices.push(clean);
    } else {
      const i = offices.findIndex((o) => o.id === clean.id);
      if (i >= 0) offices[i] = { ...offices[i], ...clean };
      else offices.push(clean);
    }
    return { offices };
  });
}

/** Remove one office; if that leaves no quote default, the first becomes it. */
export async function removeOffice(id: string): Promise<void> {
  await updateSettings((cur) => {
    const s = settingsFrom(cur);
    const offices = (Array.isArray(s.offices) ? s.offices : []).filter((o) => o.id !== id);
    if (offices.length && !offices.some((o) => o.quoteDefault)) offices[0] = { ...offices[0], quoteDefault: true };
    return { offices };
  });
}

/** Make one office the quote default. False (nothing written) for an unknown id. */
export async function setDefaultQuoteOffice(id: string): Promise<boolean> {
  let found = false;
  await updateSettings((cur) => {
    const s = settingsFrom(cur);
    const current = Array.isArray(s.offices) ? s.offices : [];
    found = current.some((o) => o.id === id);
    if (!found) return null;
    return { offices: current.map((o) => ({ ...o, quoteDefault: o.id === id })) };
  });
  return found;
}

/** Templates screen (#343): set or clear the wording overrides of the named
 *  templates and stamp each one's "last edited" meta, under the settings row
 *  lock — every other template's overrides and meta are the stored ones, so
 *  two people saving different templates at once both keep their edit. A
 *  non-empty field map replaces that template's overrides; `null` or `{}`
 *  removes them (back to the built-in defaults). Validation is the caller's. */
export async function writeTemplateOverrides(
  changes: Record<string, Record<string, string> | null>,
  stamp: { by: string; at: number }
): Promise<void> {
  await updateSettings((cur) => {
    const s = settingsFrom(cur);
    const templates: NonNullable<AppSettingsData["templates"]> = { ...(s.templates || {}) };
    const templatesMeta = { ...(s.templatesMeta || {}) };
    for (const [id, fields] of Object.entries(changes)) {
      if (fields && Object.keys(fields).length) templates[id] = fields;
      else delete templates[id];
      templatesMeta[id] = { ...stamp };
    }
    return { templates, templatesMeta };
  });
}

/** Estimating Rules → venue doctrine (#343): replace one venue class's entry
 *  under the settings row lock. The stored map is resolved over the source-
 *  sheet defaults first and written whole, exactly as the action did before. */
export async function setVenueDoctrineEntry(
  venueClass: VenueClass,
  entry: VenueDoctrineEntry
): Promise<void> {
  await updateSettings((cur) => {
    const venueDoctrine = resolveVenueDoctrine(settingsFrom(cur).venueDoctrine);
    venueDoctrine[venueClass] = { ...entry };
    return { venueDoctrine };
  });
}
