import type { QuoteReview, QuoteStatus } from "@/lib/stores/quotes";
import type { FixtureRates } from "@/lib/stores/pricing";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { ResolvedFixtureAssembly, AssemblyRole } from "@/lib/fixture-assemblies";

export const PAYMENT_TERMS = ["Deposit with terms", "100% prepay", "Net 30", "Net 60", "Unknown"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/**
 * Estimator types. The spec shapes (SpecItem / SpecSection / SpecMob) are the
 * prototype's in-memory section/item field names EXACTLY — they are persisted
 * on quote.spec ({ sections, mobs }) and read back verbatim, and
 * projects.ts consumes spec.sections (kind/items) + spec.mobs on quote win.
 */

/** Structured mobilization stamped on labor line items (flows to the project). */
export type SpecMob = {
  type: string;
  days: number;
  crew: number;
  discipline: string;
};

/** One quote line item — prototype field names, do not rename. */
export type SpecItem = {
  id: number;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  /** flags set by the add flows (custom part / curtain / fixture / labor) */
  custom?: boolean;
  curtain?: boolean;
  fixture?: boolean;
  labor?: boolean;
  /** optional-scope item — excluded from totals (prototype carried the flag) */
  option?: boolean;
  /** budget allowance — a priced line with no committed SKU (BOM allowance pattern, punch #36) */
  allowance?: boolean;
  /** customer-facing note (shows under the line + on the PDF) */
  comment?: string;
  /** internal-only note (never shown to the customer) */
  internalNote?: string;
  /** Optional vendor/product page for this material. */
  link?: string;
  mob?: SpecMob;
  /** Orderable component detail for a catalog-backed fixture assembly. */
  components?: Array<{ sku: string; label: string; role: AssemblyRole; qty: number; unit: string; cost: number; price: number }>;
  /** Links this line to its VendorQuote record (#143) — one priced line per
   *  vendor quote; the materials list lives on the record, not as siblings. */
  vendorQuoteId?: string;
  /** Section freight is not charged on this line (#143, D162) — the vendor's
   *  own price already includes it. */
  noFreight?: boolean;
};

/* ---------------- vendor quotes (#143, D162) ---------------- */

/**
 * What the vendor-quote attachments on ONE estimate may weigh, as data-URL
 * characters (#143 re-review).
 *
 * Attachments ride to the server inside `saveQuoteAction`'s payload, and
 * next.config.ts caps a server-action request body at 1200 kb. Blob storage
 * only changes where the bytes END UP — the request that carries them is the
 * same one — and with no BLOB_READ_WRITE_TOKEN (the dev default) the
 * data-URL stays in the document and is re-sent on every later save. So the
 * budget is per-ESTIMATE, not per-file: 820 kB of data-URL leaves ~380 kB of
 * the body for the sections, items and header fields. Past it Next rejects
 * the whole request and the estimate stops saving at all, so the form
 * refuses the file instead and points at the Link field.
 */
export const VENDOR_ATTACHMENT_BUDGET = 820_000;

/** One material line off a vendor's quote — descriptive only; the money for
 *  the whole quote rides on the single spawned SpecItem. */
export type VendorQuoteLine = {
  id: number;
  description: string;
  qty: number;
  unit: string;
  amount: number;
};

/**
 * A vendor's quote imported into an estimate. Persisted TOP-LEVEL on the
 * quote doc (`quote.vendorQuotes`), not inside `spec`: the attachment proxy
 * route reads it there, and burying file bytes in `spec` would duplicate the
 * payload into every revision snapshot.
 */
export type VendorQuote = {
  id: string;
  vendor: string;
  quoteNumber: string;
  description: string;
  /** Shape matched EXACTLY to /api/vendor-quote-attachments/[quoteId]/[id]. */
  attachment?: { name?: string; mime?: string; dataUrl?: string; blobPath?: string };
  link?: string;
  lines: VendorQuoteLine[];
  /** Internal only — never rendered on the customer document (Jeff, #143). */
  terms: string;
  /** Internal only — never rendered on the customer document (Jeff, #143). */
  notes: string;
  total: number;
  /** Jeff's freight exemption: the vendor's price already includes freight,
   *  so the section freight slider skips this line. */
  includesFreight: boolean;
  /** LIVE on the record, not frozen at add time — flippable from the row. */
  display: "single" | "itemized";
};

/** Data-URL characters the estimate's vendor attachments already spend of
 *  VENDOR_ATTACHMENT_BUDGET. Bytes moved into Blob storage cost nothing. */
export function vendorAttachmentLoad(quotes: VendorQuote[]): number {
  return quotes.reduce((a, v) => a + (v.attachment?.dataUrl?.length || 0), 0);
}

/** One system card. */
export type SpecSection = {
  id: string;
  name: string;
  /** 'materials' | 'labor' */
  kind: string;
  mfr: string;
  freightPct: number;
  items: SpecItem[];
};

/* ---------------- configurator drafts (prototype state shapes) ---------------- */

export type CustomDraft = {
  desc: string;
  link: string;
  sku: string;
  unit: string;
  qty: string;
  cost: string;
  price: string;
  /** budget allowance — priced line, no SKU (punch #36) */
  allowance: string;
};

export type CurtainDraft = {
  name: string;
  hang: string;
  fabric: string;
  qty: string;
  height: string;
  width: string;
  fullness: string;
  bottom: string;
  /** Real vendor (Rose Brand) unit cost; when set, overrides the make-it cost. */
  vendorCostOverride?: string;
};

/** One typed materials row in the vendor-quote form (strings while editing). */
export type VendorLineDraft = {
  id: number;
  description: string;
  qty: string;
  unit: string;
  amount: string;
};

export type VendorDraft = {
  /** The record's id, minted when the form OPENS (#143). The attachment is
   *  uploaded under it before the estimate has an id of its own, so exactly
   *  one id must exist per record — `addVendorQuote` reuses this one rather
   *  than minting a second. */
  id: string;
  vendor: string;
  quoteNumber: string;
  description: string;
  link: string;
  /**
   * With Blob storage on (#143) the file is POSTed to
   * /api/vendor-quote-attachments/upload the moment it is selected and only
   * `blobPath` is held here — the bytes never enter the save payload. With
   * Blob off it stays a `dataUrl`, in-memory until save, and the server moves
   * it to Blob later if a token ever appears.
   */
  attachment: { name: string; mime: string; dataUrl?: string; blobPath?: string } | null;
  /** Transient object-URL for the file just selected, so the form (and the
   *  line, until the estimate is saved) can offer a download of a file whose
   *  bytes are already in Blob storage. NEVER persisted — it dies with the
   *  page. */
  attachmentPreview: string | null;
  lines: VendorLineDraft[];
  terms: string;
  notes: string;
  /** Blank falls back to the sum of the material lines. */
  total: string;
  includesFreight: boolean;
  display: "single" | "itemized";
};

export type FixtureDraft = {
  assemblyId: string;
  qty: string;
  componentQty: Record<string, string>;
  position: string;
  circuit: string;
  /** Legacy configurator fields retained only for old pricing snapshots/tests;
   * the UI now selects catalog-backed assemblies exclusively. */
  model?: string;
  custom?: boolean;
  name?: string;
  price?: string;
  mount?: string;
  accessories?: string[];
  power?: string[];
  lamp?: string;
};

export type MobDraft = {
  name: string;
  nameCustom: boolean;
  tripType: "local" | "travel";
  /** true until the user manually picks Local/Travel (the >1h auto-rule applies) */
  tripAuto: boolean;
  people: string;
  days: string;
  /** Total scheduled hours per person/day; first 8 are regular, the rest OT. */
  hoursPerDay?: string;
  /** Legacy manual total OT hours; read only when hoursPerDay is absent. */
  otHrs: string;
  sup: boolean;
  milesRT: string;
  lift: boolean;
  /** Per-rental lift cost override. Blank uses the live catalog rate. */
  liftRate?: string;
  comments: string;
  internalNote: string;
};

export type LaborDraft = {
  discipline: string;
  margin: string;
  mobs: MobDraft[];
  pmHrs: string;
  pmAuto: boolean;
  shopHrs: string;
  drfHrs: string;
  drfAuto: boolean;
  misc: string;
};

/* ---------------- server → client props ---------------- */

export type FabricOpt = { sku: string; name: string; costPerSqft: number; curtainAreaRate?: number };

/** One catalog search hit for the estimator's "Add part from catalog" picker. */
export type CatalogHit = {
  sku: string;
  desc: string;
  category: string;
  unit: string;
  cost: number;
  list: number;
  mfr: string;
};

/** A page of catalog search results (total = matches before the display cap). */
export type CatalogSearch = { hits: CatalogHit[]; total: number };

/** One estimate hit for the "move system to existing estimate" picker. */
export type QuoteLite = {
  id: string;
  name: string;
  customer: string;
  status: QuoteStatus;
  updatedAt: number;
};

export type CustomerLite = {
  id: string;
  name: string;
  locations: { id: string; label: string; city: string; primary: boolean }[];
  contacts: { name: string; role: string; primary: boolean }[];
};

/** Travel estimate for a (customer, venue) pair, precomputed server-side. */
export type TravelLite = {
  miles: number | null;
  minutes: number | null;
  officeName: string | null;
};

export type InitialQuote = {
  loadedId: string | null;
  quoteId: string;
  status: QuoteStatus;
  review: QuoteReview;
  projectName: string;
  custName: string;
  customerId: string | null;
  locationId: string | null;
  contactName: string;
  quoteNote: string;
  paymentTerms: PaymentTerms;
  /** User-named quote category (#110) — "" when none. */
  category: string;
  owner: string;
  revNum: number;
  revDateMs: number;
  /** Customer pricing-tier stamp (item 11, D87) — seeds labor/curtain
   *  margins; re-stamped server-side when the customer/contact changes. */
  pricingTier: string | null;
  tierMargin: number | null;
  /** Saved builder state (spec.sections) — null starts a clean estimate. */
  sections: SpecSection[] | null;
  /** Imported vendor quotes (#143) — top-level on the doc, not in spec. */
  vendorQuotes: VendorQuote[];
  /** #160 / D205 — the draft this new estimate replaces ("Change type"); "" otherwise.
   *  Sent with the FIRST save only, which retires that draft server-side. */
  replaces: string;
};

/**
 * The venue-assessment / inspection this quote is drafting from (Phase 8, D4).
 * Resolved server-side in page.tsx from ?surveyId= / ?inspectionId= and passed
 * in only when the AI gate is on. `null` → no source linked (button hidden).
 */
export type AiSource = {
  kind: "survey" | "inspection";
  id: string;
  /** Human label for the button/modal (venue or customer, falls back to id). */
  label: string;
};

export type EstimatorProps = {
  initial: InitialQuote;
  /** Branding for the customer document (Settings → Branding, D69). */
  companyName: string;
  logoDark: string | null;
  fabrics: FabricOpt[];
  /** Live labor/travel rates from catalog category 'Labor' (sku → cost). */
  laborRates: Record<string, number>;
  /** Live fixture add-on rates (Estimating Rules → fixture group). */
  fixtureRates: FixtureRates;
  fixtureAssemblies: ResolvedFixtureAssembly[];
  /** Distinct catalog manufacturers — the vendor-name datalist (#143). */
  vendors: string[];
  /** Whether Blob storage is configured (#143). Computed in page.tsx and
   *  passed as data: src/lib/blob.ts is server-only (it holds the token) and
   *  must never be imported from a client component. False keeps the
   *  data-URL + VENDOR_ATTACHMENT_BUDGET path. */
  blobUploads: boolean;
  customers: CustomerLite[];
  /** Keys: `${customerId}|${locationId}` and `${customerId}|` (primary) and `name|${custName}`. */
  travel: Record<string, TravelLite>;
  /** Names of users with the approve permission (Users.reviewers()). */
  reviewers: string[];
  me: string;
  canApprove: boolean;
  /** Linked survey/inspection to assemble the scope from, or null
   *  (S12/D83 — rules-based, no AI gate). */
  aiSource: AiSource | null;
  /** Active roster for the quote Tasks card's assignee picker (PUNCHLIST #17 remainder). */
  people: { id: string; name: string }[];
  /** This quote's rows from the shared tasks collection, keyed by loadedId —
   *  empty for a quote that's never been saved (no id to attach tasks to yet). */
  quoteTasks: TaskRecord[];
  /** Reusable task-template sets applicable to quotes (D149, #118), for the
   *  "Apply template" control next to the Tasks card. */
  templateSets: { id: string; name: string }[];
};
