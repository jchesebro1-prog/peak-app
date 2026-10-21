/**
 * Estimator handoff — the slicer's pure rules (no I/O). Every field that reaches the
 * prototype's data/*.js passes through an allow-list here; anything token- or
 * secret-shaped is scrubbed from free text and, as a final backstop, refused in the
 * emitted file bodies (scanForSecrets). Plan: PR 2 Task 1.
 */

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
 *  estimateEmails bid assistDraft portal* leadId pdf reviewComments emailSending wonRev — and, as data
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
] as const;

/** QuoteReview (the approval gate's record). */
export const REVIEW_FIELDS = [
  "state", "reviewer", "submittedBy", "submittedAt", "decidedBy", "decidedAt", "note", "method", "auto", "approvedAgainst",
] as const;

/** QuotePdfOptions (src/lib/quote-pdf/pdf-options.ts). */
export const PDF_OPTIONS_FIELDS = [
  "detail", "pdfQty", "pdfNotes", "pdfPrices", "pdfCover", "pdfTerms", "pdfOptions", "pdfItemizedAppendix", "pdfCutSheets",
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

/** Live (not deleted) system quotes with at least one line item — not Daylite history, not portal-built
 *  (EXCLUDED_SOURCES) — sanitized (sanitizeQuote), sorted by id. */
export function selectEstimates(rows: DocRow[]): QuoteDoc[] {
  const out: QuoteDoc[] = [];
  for (const row of rows) {
    if (row.deleted) continue;
    const doc = (row.doc ?? {}) as Record<string, unknown>;
    if (((doc.quoteType as string | undefined) ?? "system") !== "system") continue;
    if ((EXCLUDED_SOURCES as readonly unknown[]).includes(doc.source)) continue;
    const sections = (doc.spec as { sections?: unknown } | undefined)?.sections;
    if (!Array.isArray(sections)) continue;
    if (!sections.some((s) => Array.isArray((s as { items?: unknown }).items) && ((s as { items: unknown[] }).items.length > 0))) continue;
    out.push({ ...sanitizeQuote(doc), id: row.id });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
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
