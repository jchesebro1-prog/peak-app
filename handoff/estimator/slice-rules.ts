/**
 * Estimator handoff — the slicer's pure rules (no I/O). Every field that reaches the
 * prototype's data/*.js passes through an allow-list here; anything token- or
 * secret-shaped is scrubbed from free text and, as a final backstop, refused in the
 * emitted file bodies (scanForSecrets). Plan: PR 2 Task 1.
 */

import { isFabricPart } from "@/lib/fabric-part";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";

/** Catalog part fields the Estimator reads (pricing, rack data, narrative, spec facts). */
export const CATALOG_FIELDS = [
  "id", "sku", "desc", "category", "unit", "cost", "list", "mfr", "manufacturerPartNumber",
  "manufacturerModelNumber", "formerSkus", "pricedAt", "priceDate", "costPerSqft", "curtainAreaRate", "renamedTo",
  "rackMount", "ruHeight", "rackWidth", "depthIn", "weightLb", "powerWatts", "maxPowerWatts",
  "powerCapacityWatts", "mountFace", "airflow", "rackNotes",
  "narrativeText", "narrativeUpdatedAt", "narrativeUpdatedBy", "flameRating", "oz", "ozBasis", "note",
  "discipline", "role", "trade", "updatedAt",
  // cut sheets: a fabric whose oz is per linear yard (ozBasis "lin-yd") needs its bolt width to weigh a curtain
  "boltWidthIn",
] as const;

/** Settings blobs (table `blobs`) the pricing/estimating code reads. */
export const BLOB_IDS = [
  "pricing_rules", "fixture_rates", "travel_rates", "catalog_rates", "track_series", "system_categories",
  "curtain_mount_hardware", "estimate_output_defaults", "narrative_intros", "rack_defaults", "fixtures_convert",
] as const;

/** Fields of `appSettings` row "main" (.data) that reach the prototype. */
export const SETTINGS_FIELDS = [
  "companyName", "logoDark", "offices", "reviewLimits", "peakHeader", "catalogCategoryMap",
  "priceListEffective", "fixtureAssemblies", "quotePipelines", "defaultQuotePipelineId", "consultingAssumptions", "accent",
] as const;

/** Every quote field the Estimator page reads. Excluded on purpose: shareLink shareOpens packageFiles
 *  estimateEmails bid assistDraft portal* leadId pdf reviewComments emailSending — and, as data
 *  minimization (a controller decision, to be confirmed by Jeff later): clientResponses (third-party respondent
 *  emails), bonusRecord and estimatorBonusSplit (staff pay). The prototype does not need them to price an
 *  estimate. `vendorQuotes` ships render-only (VENDOR_QUOTE_FIELDS); `revisions`, `review`, `pdfOptions`,
 *  `packageSelection` and `history` are allow-listed one level down too (sanitizeQuote). */
export const QUOTE_FIELDS = [
  "id", "estNo", "estSuffix", "status", "quoteType", "source", "pipelineId", "stage", "name", "category",
  "customer", "customerId", "locationId", "contactName", "quoteNote", "assumptions", "installTimeframe",
  "paymentTerms", "coverSummary", "notIncluded",
  "owner", "preparedBy", "revisions", "history", "updatedAt", "createdAt", "pricingTier", "tierMargin", "spec",
  "pdfOptions", "packageSelection", "review", "groups", "vendorQuotes",
  // wonRev: the revision number of the version that won (its revisions ship, so a reopened Won estimate can restore
  // it); packagePeakHeader: the Build package "Peak header" switch the package actions read.
  "wonRev", "packagePeakHeader",
  // boxSale (#362): the Box goods sale flag — the Estimator's switch, its BOM-only document and Build package.
  "boxSale",
] as const;

/** One revision (src/lib/stores/quotes.ts QuoteRevision) — the priced snapshot and its frozen header. Dropped:
 *  pdfBlobPath / pdfSavedAt (a private Blob pathname), the service payloads (flameTest repair inspection
 *  consulting rental — system estimates only ship). `vendorQuotes` and `docFields` are allow-listed again. */
export const REVISION_FIELDS = [
  "rev", "at", "by", "reason", "note", "name", "customerId", "value", "margin", "pricingTier", "tierMargin",
  "status", "quoteType", "spec", "docFields", "vendorQuotes",
] as const;

/** A revision's frozen header (QuoteRevisionDocFields / revisionDocFields) — only the fields the document loaders
 *  print. Dropped: packageFiles (private Blob pathnames of the drawings), bid and awardedPartyId (bidders are not
 *  in the prototype), portalFirm (portal data never ships). */
export const DOC_FIELDS = [
  "customer", "locationId", "contactName", "quoteNote", "assumptions", "installTimeframe", "preparedBy", "owner",
  "termsText", "paymentTerms", "pdfOptions", "source", "coverSummary", "notIncluded", "packageSelection",
  "revNo", "issuedAt",
  // boxSale (#362): a sent revision's frozen flag (absent on a normal estimate and on revisions cut before the field).
  "boxSale",
] as const;

/** QuoteReview (the approval gate's record). */
export const REVIEW_FIELDS = [
  "state", "reviewer", "submittedBy", "submittedAt", "decidedBy", "decidedAt", "note", "method", "auto", "approvedAgainst",
] as const;

/** QuotePdfOptions (src/lib/quote-pdf/pdf-options.ts). The four bom* switches are #364's Show on BOM. */
export const PDF_OPTIONS_FIELDS = [
  "detail", "pdfQty", "pdfNotes", "pdfPrices", "pdfCover", "pdfTerms", "pdfOptions", "pdfItemizedAppendix", "pdfCutSheets",
  "bomLinePrices", "bomMaterials", "bomLabor", "bomFreight",
] as const;

/** PackageSelection (src/lib/estimate-output/package-selection.ts). */
export const PACKAGE_SELECTION_FIELDS = ["estimatePdf", "coverPdf", "drawings", "excludedDatasheets"] as const;

/** QuoteHistoryEntry. */
export const HISTORY_FIELDS = ["at", "from", "to"] as const;

/** A vendor quote (src/app/(app)/estimator/types.ts VendorQuote) — only what the section card, the customer
 *  document, the BOM / parts list and the Vendors card RENDER. Dropped: attachment (data-URL bytes or a private
 *  Blob pathname), link (a vendor portal URL can carry a token), terms and notes (internal — the staff Build view's
 *  amber box shows them, the customer document never does), fromThreadId (an email thread), extracted (the Read the
 *  PDF run), vendorCompanyId (the vendor company is not in the package; the card falls back to `vendor`). */
export const VENDOR_QUOTE_FIELDS = [
  "id", "vendor", "quoteNumber", "description", "lines", "total", "totalSource", "includesFreight", "display", "addedAt",
] as const;

/** VendorQuoteLine — `extractedIndex` (an index into the dropped `extracted`) is not kept. */
export const VENDOR_LINE_FIELDS = ["id", "description", "manufacturerPartNumber", "qty", "unit", "amount"] as const;

/** FixtureRecord shape (src/lib/fixture-assemblies.ts) — anything else on a subassemblies doc is dropped. */
export const FIXTURE_FIELDS = [
  "id", "kind", "label", "description", "scope", "portalCategory", "lightEngineSku", "lensSku",
  "lightEngineLine", "lensLine", "lamp", "position", "circuit", "lines", "parts", "rack", "snapshot",
  "needsReview", "createdAt", "createdBy", "updatedAt", "updatedBy", "legacy",
] as const;

export const COMPANY_COLS = [
  "id", "name", "type", "lifecycle", "website", "mainPhone", "address", "city", "state", "zip", "pricingTier", "shortCode",
] as const;
export const SITE_COLS = [
  "id", "companyId", "name", "locationName", "legacyLocId", "isPrimary", "address", "city", "state", "zip", "kind",
  "lat", "lng", "venueKind", "nameAuto", "travelMiles", "travelMin", "geoStatus", "createdAt",
] as const;
export const CONTACT_COLS = [
  "id", "firstName", "lastName", "homeCompanyId", "title", "pricingTier", "status", "isPrimary",
] as const;
export const CONTACT_EMAIL_COLS = ["id", "contactId", "email", "label", "isPrimary"] as const;
export const CONTACT_PHONE_COLS = ["id", "contactId", "phone", "label", "isPrimary"] as const;
export const TEAM_FIELDS = ["id", "name", "roles", "status", "title", "initials", "color"] as const;
/** An inactive user rides along for name resolution only (the bonus record's roster): nothing else about them. */
export const INACTIVE_TEAM_FIELDS = ["id", "name", "roles", "status"] as const;

/** A document row as db:export writes it. */
export type DocRow = { id: string; doc?: Record<string, unknown> | null; deleted?: boolean | null };
export type QuoteDoc = Record<string, unknown> & { id: string };

/** Copies only the allow-listed keys the doc actually has (undefined skipped). */
export function pickFields(doc: Record<string, unknown>, allow: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined) out[k] = doc[k];
  }
  return out;
}

const SECRET_RULES: Array<[string, RegExp]> = [
  ["sk-ant", /sk-ant-/],
  // not preceded by a letter/digit, so ordinary words ("risk-based-assessment-plan…") do not trip it;
  // but the final scan runs on JSON.stringify output, where a newline/tab is the two characters \n / \t,
  // so a key right after one of those escapes is also a boundary
  ["sk-key", /(?:(?<![A-Za-z0-9])|(?<=\\[nrtbf]))sk-[A-Za-z0-9_-]{20,}/],
  ["github-token", /ghp_[A-Za-z0-9]{30,}/],
  ["github-pat", /github_pat_[A-Za-z0-9_]{20,}/],
  ["github-oauth-token", /gh[opsu]_[A-Za-z0-9]{30,}/],
  ["google-api-key", /AIza[0-9A-Za-z_-]{35}/],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ["bearer-token", /Bearer [A-Za-z0-9._~+/=-]{20,}/],
  ["postgres-credentials", /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/],
  ["google-refresh-token", /1\/\/0[A-Za-z0-9_-]{10,}/],
  ["google-access-token", /ya29\./],
  ["slack-token", /xox[baprs]-/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["vercel-blob-token", /vercel_blob_rw_/],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/],
];

/** Names of the secret rules that match `json` (empty = clean). */
export function scanForSecrets(json: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of SECRET_RULES) if (re.test(json)) hits.push(name);
  return hits;
}

/** One free-text value replaced with "" because it was secret-shaped. */
export type ScrubEntry = { id: string; field: string; rule: string };

/** Deep-copies `value`, blanking any string that is secret-shaped. `field` is the top-level key. */
export function scrubValue(value: unknown, id: string, field: string, log: ScrubEntry[]): unknown {
  if (typeof value === "string") {
    const rules = scanForSecrets(value);
    if (rules.length === 0) return value;
    for (const rule of rules) log.push({ id, field, rule });
    return "";
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, id, field, log));
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = scrubValue(v, id, field, log);
    return o;
  }
  return value;
}

/** pickFields, then blank secret-shaped text anywhere in the picked values. */
export function pickAndScrub(doc: Record<string, unknown>, allow: readonly string[], id: string, log: ScrubEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pickFields(doc, allow))) out[k] = scrubValue(v, id, k, log);
  return out;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
/** pickFields on an object (anything else — null, a string — passes through unchanged). */
const pickObj = (v: unknown, allow: readonly string[]) => (isRec(v) ? pickFields(v, allow) : v);
/** pickObj over every element of an array (a non-array passes through unchanged). */
const pickEach = (v: unknown, allow: readonly string[], each?: (o: Rec) => Rec) =>
  Array.isArray(v) ? v.map((x) => { const o = pickObj(x, allow); return each && isRec(o) ? each(o) : o; }) : v;

/** One vendor quote, render fields only (VENDOR_QUOTE_FIELDS / VENDOR_LINE_FIELDS). */
export function sanitizeVendorQuotes(v: unknown): unknown {
  return pickEach(v, VENDOR_QUOTE_FIELDS, (o) => ("lines" in o ? { ...o, lines: pickEach(o.lines, VENDOR_LINE_FIELDS) } : o));
}

/** A revision's frozen header — DOC_FIELDS, its pdfOptions / packageSelection allow-listed again. */
export function sanitizeDocFields(df: unknown): unknown {
  if (!isRec(df)) return df;
  const o = pickFields(df, DOC_FIELDS);
  if ("pdfOptions" in o) o.pdfOptions = pickObj(o.pdfOptions, PDF_OPTIONS_FIELDS);
  if ("packageSelection" in o) o.packageSelection = pickObj(o.packageSelection, PACKAGE_SELECTION_FIELDS);
  return o;
}

/** One revision — REVISION_FIELDS, then its docFields and vendorQuotes allow-listed again. */
export function sanitizeRevision(r: unknown): unknown {
  if (!isRec(r)) return r;
  const o = pickFields(r, REVISION_FIELDS);
  if ("docFields" in o) o.docFields = sanitizeDocFields(o.docFields);
  if ("vendorQuotes" in o) o.vendorQuotes = sanitizeVendorQuotes(o.vendorQuotes);
  return o;
}

/** A quote doc as it ships: QUOTE_FIELDS, then every nested record that can carry private data allow-listed again
 *  (revisions, vendorQuotes, review, pdfOptions, packageSelection, history). `spec` is the priced payload itself and
 *  is deep-scrubbed by the slicer, not allow-listed. */
export function sanitizeQuote(doc: Rec): Rec {
  const o = pickFields(doc, QUOTE_FIELDS);
  if ("revisions" in o) o.revisions = Array.isArray(o.revisions) ? o.revisions.map(sanitizeRevision) : o.revisions;
  if ("vendorQuotes" in o) o.vendorQuotes = sanitizeVendorQuotes(o.vendorQuotes);
  if ("review" in o) o.review = pickObj(o.review, REVIEW_FIELDS);
  if ("pdfOptions" in o) o.pdfOptions = pickObj(o.pdfOptions, PDF_OPTIONS_FIELDS);
  if ("packageSelection" in o) o.packageSelection = pickObj(o.packageSelection, PACKAGE_SELECTION_FIELDS);
  if ("history" in o) o.history = pickEach(o.history, HISTORY_FIELDS);
  return o;
}

/** Sources that never ship: Daylite history, and the customer portal's self-built catalog quotes (portal data). */
export const EXCLUDED_SOURCES = ["daylite", "portal-catalog"] as const;

/**
 * Which `source` values count as "an Estimator quote" (Jeff, Oct 20: the bundle is the recent Estimator estimates only).
 * A system quote's `source` is the builder that last saved it: the Estimator stamps "estimator" on every save
 * (src/app/(app)/estimator/actions.ts → sourceForSave, which keeps only portal-catalog / portal-service), so an
 * estimate opened and saved in the Estimator reads "estimator"; "" / absent is a doc written before the field existed
 * or by a path that never set one. Everything else is another builder's quote that was never opened in the Estimator and
 * is left out: "grid" (a Grid design promoted to a quote), "quick" (Quick Design / the createQuote default), "inbox"
 * (a placeholder made from an email thread), "daylite" (imported history), "portal-catalog" / "portal-self-serve"
 * (customer-built), "rental" / "consulting" / "flame" / … (not system quotes at all). Found by reading every
 * `source:` a quote is created or saved with in src/ (createQuote callers, sourceForSave, daylite/history-commit).
 */
export const ESTIMATOR_SOURCES = ["estimator", ""] as const;
export const isEstimatorSource = (source: unknown): boolean =>
  source == null || (typeof source === "string" && (ESTIMATOR_SOURCES as readonly string[]).includes(source));

// ---------------------------------------------------------------------------------------------------------------
// The recent-estimates window. One definition, shared by handoff:slice and handoff:photos so they cannot drift.

export const DEFAULT_RECENT_DAYS = 28;
export const MAX_RECENT_DAYS = 3650;
const DAY_MS = 86_400_000;

/** A selection problem the CLIs report instead of a stack trace. `code` picks the exit status (no-estimates → 1, the rest → 2). */
export class SelectionError extends Error {
  constructor(readonly code: "bad-recent-days" | "no-exported-at" | "no-estimates", message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

/** `--recent-days <n>`: undefined → the default (28); otherwise a whole number of days, 1 … 3650. */
export function parseRecentDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RECENT_DAYS;
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_RECENT_DAYS) {
    throw new SelectionError("bad-recent-days", `--recent-days must be a whole number of days from 1 to ${MAX_RECENT_DAYS} (got "${raw}").`);
  }
  return n;
}

export type RecentWindow = {
  days: number;
  /** The export's own timestamp (meta.exportedAt) — the window is anchored here, never to the clock, so a slice is reproducible. */
  exportedAt: string;
  /** Inclusive lower bound, epoch ms: exportedAt − days. */
  fromMs: number;
  toMs: number;
};

/** The window ending at the export's `meta.exportedAt`. An export without a usable one is refused. */
export function recentWindow(exportedAt: unknown, days: number = DEFAULT_RECENT_DAYS): RecentWindow {
  const t = typeof exportedAt === "string" ? Date.parse(exportedAt) : typeof exportedAt === "number" ? exportedAt : NaN;
  if (!Number.isFinite(t) || t <= 0) {
    throw new SelectionError("no-exported-at", "the export has no usable meta.exportedAt, so the recent-estimates window cannot be anchored — re-run npm run db:export.");
  }
  return { days, exportedAt: new Date(t).toISOString(), fromMs: t - days * DAY_MS, toMs: t };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const windowLabel = (w: RecentWindow) => `last ${w.days} days (${isoDay(w.fromMs)} → ${isoDay(w.toMs)})`;

/** The message when nothing qualifies — names the window and how to widen it. */
export function noEstimatesMessage(w: RecentWindow): string {
  return `no Estimator estimates qualify: none was updated in the ${windowLabel(w)} before the export (a live system quote with at least one line, saved from the Estimator). ` +
    "Widen the window with --recent-days <n> (and check this is the right export).";
}

/** A quote's last-change time: `updatedAt`, else `createdAt` (epoch ms); null when it has neither. */
export function quoteStamp(doc: Record<string, unknown>): number | null {
  for (const k of ["updatedAt", "createdAt"]) {
    const n = Number(doc[k]);
    if (doc[k] != null && doc[k] !== "" && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Inside the window: stamp ≥ exportedAt − days (inclusive) and not after the export. A quote with no stamp is not recent. */
export function inRecentWindow(doc: Record<string, unknown>, w: RecentWindow): boolean {
  const t = quoteStamp(doc);
  return t !== null && t >= w.fromMs && t <= w.toMs;
}

/**
 * The Estimator's estimates: live (not deleted) system quotes built in the Estimator (ESTIMATOR_SOURCES; never Daylite
 * history or a portal-built quote — EXCLUDED_SOURCES) with at least one line item — sanitized (sanitizeQuote), sorted by
 * id. With a `window` only quotes last changed inside it qualify; without one (dev `--extra-estimates` only) every
 * such quote does.
 */
export function selectEstimates(rows: DocRow[], window?: RecentWindow | null): QuoteDoc[] {
  const out: QuoteDoc[] = [];
  for (const row of rows) {
    if (row.deleted) continue;
    const doc = (row.doc ?? {}) as Record<string, unknown>;
    if (((doc.quoteType as string | undefined) ?? "system") !== "system") continue;
    if ((EXCLUDED_SOURCES as readonly unknown[]).includes(doc.source)) continue;
    if (!isEstimatorSource(doc.source)) continue;
    const sections = (doc.spec as { sections?: unknown } | undefined)?.sections;
    if (!Array.isArray(sections)) continue;
    if (!sections.some((s) => Array.isArray((s as { items?: unknown }).items) && ((s as { items: unknown[] }).items.length > 0))) continue;
    if (window && !inRecentWindow(doc, window)) continue;
    out.push({ ...sanitizeQuote(doc), id: row.id });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The export's bundled estimates and their window — what handoff:slice and handoff:photos both start from. May be empty. */
export function selectBundledEstimates(rows: DocRow[], exportedAt: unknown, recentDays: number = DEFAULT_RECENT_DAYS): { window: RecentWindow; estimates: QuoteDoc[] } {
  const window = recentWindow(exportedAt, recentDays);
  return { window, estimates: selectEstimates(rows, window) };
}

export type EstimateSummary = { id: string; estNo: number | null; name: string; customer: string; updatedAt: number | null; extra: boolean };

/** One line per bundled estimate for the slice summary. */
export function summarizeEstimate(q: Record<string, unknown>, extra = false): EstimateSummary {
  const t = quoteStamp(q);
  return {
    id: String(q.id),
    estNo: typeof q.estNo === "number" && Number.isFinite(q.estNo) ? q.estNo : null,
    name: typeof q.name === "string" ? q.name : "",
    customer: typeof q.customer === "string" ? q.customer : "",
    updatedAt: t,
    extra,
  };
}

/** The window and the bundled estimates, as printable lines (slice summary and photos dry run). */
export function describeEstimateSelection(w: RecentWindow, rows: readonly EstimateSummary[]): string[] {
  const lines = [`recent-estimates window: ${windowLabel(w)} (anchored to the export's exportedAt ${w.exportedAt})`, `bundled estimates: ${rows.length}`];
  for (const r of rows) {
    const when = r.updatedAt === null ? "no date" : new Date(r.updatedAt).toISOString().slice(0, 10);
    lines.push(`  ${r.id}  ${r.estNo === null ? "—" : `#${r.estNo}`}  ${r.name || "(unnamed)"}  ·  ${r.customer || "(no customer)"}  ·  updated ${when}${r.extra ? "  [--extra-estimates, outside the window]" : ""}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Which catalog parts ship. The prototype does not carry the ~37,000-part book: only what the bundled estimates,
// every assembly and the Estimator's own pickers actually read (Jeff, Oct 20).

/** Keys that hold a catalog SKU on an estimate line, a revision, a fixture / System / Hardware / rack record. `fabricSku` is
 *  a curtain line's structured fabric (SpecItem.curtainInputs.fabricSku). */
const ESTIMATE_SKU_KEYS = new Set(["sku", "lightEngineSku", "lensSku", "fabricSku"]);
/** …and in the settings blobs: the rack defaults' blank / vent panel (`blankSku`, `ventSku`); track series, curtain mounts
 *  and system categories all use a plain `sku`. */
const BLOB_SKU_KEYS = new Set([...ESTIMATE_SKU_KEYS, "blankSku", "ventSku"]);

/** Every sku-shaped value anywhere in `value` (nested objects and arrays; depth-capped). */
export function collectSkuValues(value: unknown, keys: ReadonlySet<string>, into: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 14 || value == null) return into;
  if (Array.isArray(value)) {
    for (const v of value) collectSkuValues(v, keys, into, depth + 1);
    return into;
  }
  if (typeof value !== "object") return into;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(k) && typeof v === "string") {
      const s = v.trim();
      if (s) into.add(s);
    } else if (v && typeof v === "object") {
      collectSkuValues(v, keys, into, depth + 1);
    }
  }
  return into;
}

/** Why a catalog part ships. A part can have several. */
export type CatalogSource =
  | "estimate"          // a SKU on a line (or revision) of a bundled estimate; a curtain line's fabric
  | "assembly"          // a member / placement SKU of any fixture, System, Hardware assembly or rack (all assemblies ship)
  | "fabric"            // the Estimator's curtain fabric picker lists every fabric part that has an area rate
  | "labor"             // the Estimator prices a new labor line from the catalog's Labor-category parts (laborRates)
  | "rename"            // a retired SKU stub: an estimate/assembly/rule names the old SKU, or its target ships
  | `rule:${string}`;   // a SKU a shipped rules blob names (track_series, curtain_mount_hardware, system_categories, rack_defaults…)

export type CatalogScope = {
  /** Live part ids to ship, sorted. */
  live: string[];
  /** Retired SKU stub ids to ship ({ id, sku, renamedTo } only), sorted. */
  retired: string[];
  /** id → why (live parts and stubs). */
  reasons: Map<string, CatalogSource[]>;
  /** source → how many parts it brought in (not exclusive: a part named by two sources counts under both). */
  bySource: Record<string, number>;
  /** SKUs the estimates / assemblies / blobs name that are in neither the live nor the retired catalog (custom lines, deleted parts). */
  unresolved: string[];
};

const FABRIC_RATE_KEYS = ["curtainAreaRate", "costPerSqft", "cost", "unit", "sku"] as const;

/**
 * The catalog parts the prototype needs — pure. The union of:
 *  - every SKU on a bundled estimate (all systems, alternates, options and revisions; a vendor-quote line has no catalog SKU),
 *  - every SKU of every assembly (`fixtures` — the whole `subassemblies` collection ships) and of the legacy
 *    `settings.fixtureAssemblies` backup,
 *  - every SKU in a shipped rules blob (`blobs`: track series sticks and roles, curtain mount hardware, system categories'
 *    typical items, rack defaults' blank and vent panels) so the configurators still price,
 *  - the Estimator's pickers: every fabric part with an area rate (the curtain modal's fabric list, EstimatorProps.fabrics)
 *    and every Labor-category part (EstimatorProps.laborRates — a new labor line looks its rate up there),
 *  - retired SKU stubs where the old SKU is named by any of the above, or the stub's target ships.
 * An old SKU on an estimate follows `renamedTo` to the live part (chains up to 8 hops, like photo-select's renameFollower).
 * Everything else — the other ~37,000 parts — stays out.
 */
export function selectCatalogScope(input: {
  estimates: readonly Record<string, unknown>[];
  fixtures: readonly Record<string, unknown>[];
  blobs: Record<string, unknown>;
  settings: Record<string, unknown>;
  catalog: readonly DocRow[];
}): CatalogScope {
  const live = new Map<string, Record<string, unknown>>();
  const stubTo = new Map<string, string>();
  for (const r of input.catalog) {
    const doc = (r.doc ?? {}) as Record<string, unknown>;
    if (!r.deleted) {
      live.set(r.id, { ...doc, id: r.id, sku: typeof doc.sku === "string" && doc.sku ? doc.sku : r.id });
    } else if (typeof doc.renamedTo === "string" && doc.renamedTo !== "") {
      stubTo.set(r.id, doc.renamedTo);
    }
  }

  const reasons = new Map<string, Set<CatalogSource>>();
  const add = (id: string, why: CatalogSource) => {
    const set = reasons.get(id) ?? new Set<CatalogSource>();
    set.add(why);
    reasons.set(id, set);
  };
  const unresolved = new Set<string>();
  const follow = (sku: string, why: CatalogSource) => {
    let k = sku;
    for (let i = 0; i < 8 && stubTo.has(k) && stubTo.get(k) !== k; i++) {
      add(k, "rename"); // the old SKU the estimate / assembly / rule names rides along as a stub
      k = stubTo.get(k)!;
    }
    if (live.has(k)) add(k, why);
    else unresolved.add(k);
  };

  for (const s of collectSkuValues(input.estimates, ESTIMATE_SKU_KEYS)) follow(s, "estimate");
  for (const s of collectSkuValues(input.fixtures, ESTIMATE_SKU_KEYS)) follow(s, "assembly");
  for (const s of collectSkuValues(input.settings.fixtureAssemblies, ESTIMATE_SKU_KEYS)) follow(s, "assembly");
  for (const [id, data] of Object.entries(input.blobs)) for (const s of collectSkuValues(data, BLOB_SKU_KEYS)) follow(s, `rule:${id}`);
  for (const [id, p] of live) {
    if (isFabricPart({ category: p.category as string | undefined, unit: p.unit as string | undefined }) && fabricAreaRateOf(pickFields(p, FABRIC_RATE_KEYS) as Parameters<typeof fabricAreaRateOf>[0]) > 0) add(id, "fabric");
    if (typeof p.category === "string" && p.category.trim() === "Labor") add(id, "labor");
  }

  // A retired stub also ships when its target ships (so an old SKU still resolves); chains settle in a few passes.
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, to] of stubTo) if (!reasons.has(id) && reasons.has(to)) { add(id, "rename"); changed = true; }
  }

  const ids = [...reasons.keys()];
  const liveIds = ids.filter((id) => live.has(id)).sort();
  const retiredIds = ids.filter((id) => stubTo.has(id)).sort();
  const bySource: Record<string, number> = {};
  for (const set of reasons.values()) for (const why of set) bySource[why] = (bySource[why] ?? 0) + 1;
  return {
    live: liveIds,
    retired: retiredIds,
    reasons: new Map([...reasons].map(([id, set]) => [id, [...set].sort()])),
    bySource,
    unresolved: [...unresolved].sort(),
  };
}

/** `push(...)` spreads its argument list; engines cap that (~65k), so a chunk also stops at this many parts. */
export const CATALOG_MAX_ITEMS = 20_000;
const CATALOG_PREFIX = "(window.PEAK_CATALOG = window.PEAK_CATALOG || []).push(...[\n";
const CATALOG_SUFFIX = "\n]);\n";

/** Greedy packing of catalog parts into groups whose file body stays ≤ maxBytes. */
export function packCatalog<T>(parts: T[], maxBytes: number, maxItems = CATALOG_MAX_ITEMS): T[][] {
  const overhead = Buffer.byteLength(CATALOG_PREFIX) + Buffer.byteLength(CATALOG_SUFFIX);
  const groups: T[][] = [];
  let cur: T[] = [];
  let size = overhead;
  for (const p of parts) {
    const json = Buffer.byteLength(JSON.stringify(p));
    if (overhead + json > maxBytes) throw new Error(`one catalog part (${json} bytes) cannot fit in ${maxBytes} bytes`);
    if (cur.length > 0 && (size + 2 + json > maxBytes || cur.length >= maxItems)) {
      groups.push(cur);
      cur = [];
      size = overhead;
    }
    size += json + (cur.length > 0 ? 2 : 0); // ",\n" between parts
    cur.push(p);
  }
  if (cur.length > 0 || groups.length === 0) groups.push(cur);
  return groups;
}

export const catalogBody = (parts: unknown[]) => CATALOG_PREFIX + parts.map((p) => JSON.stringify(p)).join(",\n") + CATALOG_SUFFIX;

/** The data/catalog-<n>.js bodies; each is ≤ maxBytes. */
export function catalogChunks(parts: unknown[], maxBytes: number, maxItems = CATALOG_MAX_ITEMS): string[] {
  return packCatalog(parts, maxBytes, maxItems).map(catalogBody);
}
