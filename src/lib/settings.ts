import { eq, sql } from "drizzle-orm";
import { getDb, withTransaction } from "@/db";
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
  /** #372 — company website for the contact card (Settings → Branding); absent/empty = none. */
  website?: string;
  federalHolidays: boolean;
  seedDemo: boolean;
  feedbackEmail: string;
  offices: Office[];
  /** Stored settings of the removed Venue Assessments / site visits (the intake type catalog, the visit-reason
   *  picklist, the Final thoughts tags). Nothing reads or edits them any more; the values stay in the settings row. */
  intakeCatalog?: unknown;
  visitReasons?: unknown;
  surveyInternalTags?: unknown;
  /** Stored settings of the removed Consulting module (phase menu, phase weights, discipline vocabulary, review
   *  checklists). Nothing reads or edits them any more; the values stay in the settings row. */
  consultingPhases?: unknown;
  consultingPhaseWeights?: unknown;
  consultingDisciplines?: unknown;
  reviewChecklistTemplates?: unknown;
  /** The assumptions library the Estimator offers (Settings → Sales → Assumptions library) — see
   *  DEFAULT_CONSULTING_ASSUMPTIONS in lib/assumptions.ts; empty/absent means use the defaults. The key keeps the
   *  name it had when the Consulting builder shared it. */
  consultingAssumptions?: string[];
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
  /** Stored wording overrides of the removed Templates screen (it held only consulting documents). Unread. */
  templates?: unknown;
  templatesMeta?: unknown;
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
  /** #216 — Settings → Venue types. FULL REPLACEMENT list; resolved by
   *  venueTypesFrom (lib/venue-types) — absent = the seed (5 built-ins +
   *  Gym Stage). sites.venue_kind stores a type key. */
  venueTypes?: import("@/lib/venue-types").VenueType[];
  /** #242 — Settings → Admin → Review limits: per person (users.id) per
   *  review kind, a whole-dollar self-approval ceiling or "none" (No limit);
   *  a missing key = blank = always needs review. FULL REPLACEMENT on save,
   *  read through reviewLimitsFrom (lib/review-limits); absent = {}. */
  reviewLimits?: import("@/lib/review-limits").ReviewLimits;
  /** Stored venue-class guidance of the removed Venue Assessments (D132). Nothing reads or edits it any more. */
  venueDoctrine?: unknown;
  /** Pre-#210 Assemblies-tab records. Since the fixture builder they are
   *  converted into `subassemblies` fixture rows (src/lib/fixtures-migrate.ts)
   *  and this array is a read-only backup — never written by the app. */
  fixtureAssemblies?: import("@/lib/fixture-assemblies").FixtureAssembly[];
  /** Per-manufacturer "price list effective" date (PUNCHLIST #133, D156),
   *  keyed by mfrKey() from lib/catalog-books (lowercase alphanumerics) →
   *  epoch ms. Written only by the Catalog banner's date input (a by-hand
   *  "the whole book is confirmed as of D"); since Oct 15 #32 the importers
   *  date each part they carry (`priceDate`) instead of the whole book. A
   *  part's effective date is the LATEST of its own `pricedAt`, its
   *  `priceDate` and this — see effectivePriceDate. Absent = no book dates. */
  priceListEffective?: Record<string, number>;
  /** Stored Grid Settings of the removed Grid (category symbols and icons, symbol colours, the standard general
   *  notes, designator digits). Nothing reads or edits them any more; the values stay in the settings row. */
  gridCategoryShapes?: unknown;
  gridCategoryIcons?: unknown;
  gridSymbolColors?: unknown;
  gridStandardNotes?: unknown;
  designatorDigits?: unknown;
  /** Pipelines (spec 2026-09-24 §3) — FULL REPLACEMENT lists (the wireTypes
   *  idiom). resolvePipelines in lib/pipelines returns the Daylite seeds when
   *  absent or invalid. Edited in Settings → Pipelines. */
  projectPipelines?: import("@/lib/pipelines").ProjectPipeline[];
  quotePipelines?: import("@/lib/pipelines").QuotePipeline[];
  defaultQuotePipelineId?: string;
  /** One-time pipeline fixes already applied to the stored lists (Jeff 2026-10-15 #42: "bid-spec-lead-qualify"). */
  pipelineFixes?: string[];
  /** #122 — Settings → Catalog: who receives the vendor price-list tasks
   *  (spec §1). null/absent = the default rule in resolveCatalogOwner()
   *  (the user named "Jena Tolksdorf" if present, else the first Admin). */
  catalogOwner?: { userId: string } | null;
  /** Company-wide dashboard layout; users may override sparsely. */
  dashboardDefaults: DashboardLayout;
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

