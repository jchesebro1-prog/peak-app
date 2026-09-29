import type { QuoteReview, QuoteStatus } from "@/lib/stores/quotes";
import type { FixtureRates } from "@/lib/stores/pricing";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import type { ResolvedFixtureAssembly, AssemblyRole } from "@/lib/fixture-assemblies";
import type { Pipelines } from "@/lib/pipelines";
import type { FreightRule } from "@/lib/freight-rule";
import type { CurtainRequest } from "@/lib/portal-cart-types";
import type { ReviewLimitChipData } from "@/lib/review-limits";

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

/** #270: the travel costs a mobilization inserts as their own lines. */
export type LaborTravelKind = "mileage" | "hotel" | "perdiem" | "lift";

/** #269: the Labor configurator draft behind one labor group, kept once per
 *  group on its section so any of its lines can reopen the configurator.
 *  `lines` = how many lines it produced (to tell the user some were removed). */
export type LaborGroupRecord = { draft: LaborDraft; lines: number };

/** One quote line item — prototype field names, do not rename. */
export type SpecItem = {
  id: number;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  /** True when the sell value was explicitly edited on this line. */
  sellOverride?: boolean;
  /** Optional manual extended sell override; otherwise qty × unit sell is used. */
  extSellOverride?: number;
  /** Stable display ordering within its system; array order remains the legacy fallback. */
  lineOrder?: number;
  manufacturer?: string;
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  priceGoodThrough?: string;
  /** flags set by the add flows (custom part / curtain / fixture / labor) */
  custom?: boolean;
  curtain?: boolean;
  fixture?: boolean;
  labor?: boolean;
  /** #250: a portal curtain line priced live (Estimator curtain math, tier
   *  margin) that still needs Peak to confirm measurements + fabric — stays
   *  set through Save; only sending the quote (or staff replacing the line)
   *  resolves it (clearPricedPor's `anyConfirm`, portal-quote-mode.ts). */
  portalConfirm?: boolean;
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
  /** Marks a labor line as shop & engineering / performance-bonus / misc-
   *  allowance overhead (owner request): the internal estimate keeps it as
   *  its own editable line, but the CUSTOMER document never shows it — its
   *  sell folds into the mobilization line(s) instead (see `customerLines`
   *  in pricing.ts). Older quotes built during the brief window when these
   *  folded into the mobilization line predate this flag; `isLaborOverheadItem`
   *  also recognizes their LAB-SHOP-/LAB-BONUS-/LAB-MISC- SKU prefixes. */
  laborOverhead?: "shop" | "bonus" | "misc";
  /** #270: a mobilization's travel cost as its own internal line (mileage,
   *  hotel, per diem, lift rental). Like `laborOverhead` the CUSTOMER
   *  document never shows it — `customerLines` folds its sell into the
   *  mobilization line sharing its `laborMobKey`. */
  laborTravel?: LaborTravelKind;
  /** #270: links a mobilization line and its travel lines (same key). */
  laborMobKey?: string;
  /** #269: every line one "Add labor" inserted shares this id; the draft
   *  that built them is `SpecSection.laborGroups[id]` (labor-group.ts). */
  laborGroup?: string;
  /** Orderable component detail for a catalog-backed fixture assembly. */
  components?: Array<{ sku: string; label: string; role: AssemblyRole; qty: number; unit: string; cost: number; price: number }>;
  /** Links this line to its VendorQuote record (#143) — one priced line per
   *  vendor quote; the materials list lives on the record, not as siblings. */
  vendorQuoteId?: string;
  /** Section freight is not charged on this line (#143, D162) — the vendor's
   *  own price already includes it. */
  noFreight?: boolean;
  /** #245: customer-requested line still waiting on a Peak price. */
  por?: boolean;
  /** Spec records design §6 — a system record's match key, set at the
   *  source (the custom-part form, the curtain add, and the Spec select on a
   *  custom/curtain line — spec-key-select.tsx) so
   *  `bomFromQuote`/`record-match.ts` can match this line with no catalog
   *  part number. */
  specKey?: string;
  /** #245 Task 13 — the fixture record this line was configured from, and the
   *  add-on quantities chosen (keyed `slot:sku`, as on a portal cart line).
   *  Carried ONLY on a `fixture: true` item written by the portal
   *  (portal-pricing.ts priceFixtureLine) so Copy to new quote / a pricing
   *  refresh can rebuild the cart line that produced it; a hand-built
   *  Estimator fixture line (fixture-bom.ts) never sets these. */
  fixtureId?: string;
  fixtureOptions?: Record<string, number>;
  /** #245 Task 13 — the free-text curtain request this line was priced from
   *  (portal-pricing.ts priceCurtain), carried the same way as `fixtureId`
   *  above so the line can be rebuilt into a cart line. */
  curtainInputs?: CurtainRequest;
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
  manufacturerPartNumber?: string;
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
  /** Whether the saved cost came from an explicit total or summed quote lines. */
  totalSource?: "manual" | "lines";
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
  narrative?: string;
  /** #262: the room this system is in, for the PM parts list; blank = the quote's venue. Internal only. */
  room?: string;
  presentation?: "itemized" | "narrative";
  /** 'materials' | 'labor' */
  kind: string;
  mfr: string;
  freightPct: number;
  /** #245: freight was set by the distance rule and staff haven't touched it. */
  freightAuto?: boolean;
  /** #245: one-way drive miles the freight rule priced from (null = venue not located). */
  freightMiles?: number | null;
  /** #267: a typed system sell (items + freight), used exactly — never
   *  re-rounded, never pushed into the line prices; the margin follows it and
   *  the customer document spreads the difference across the visible lines
   *  (`customerLines`). Cleared by this system's Margin slider, the global
   *  "Reprice every line" slider, or Reset to auto. Valid only when finite,
   *  > 0 and ≤ PRICE_OVERRIDE_MAX; anything else is ignored (and dropped by
   *  the server on save). Not carried by Copy (the copy's costs differ). */
  sellOverride?: number;
  /** #267: the step the AUTO system price rounds UP to (25 → the next $25).
   *  Absent = the pre-#267 exact price (sent/won quotes keep it until the
   *  user turns rounding on). The server accepts only 25. */
  priceRound?: number;
  items: SpecItem[];
  /** #269: labor group id → the configurator draft that built its lines.
   *  Internal only; carried by save, move and copy like any section field. */
  laborGroups?: Record<string, LaborGroupRecord>;
};

/* ---------------- configurator drafts (prototype state shapes) ---------------- */

export type CustomDraft = {
  desc: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  vendor: string;
  priceGoodThrough: string;
  link: string;
  sku: string;
  unit: string;
  qty: string;
  cost: string;
  price: string;
  /** budget allowance — priced line, no SKU (punch #36) */
  allowance: string;
  /** Add this non-allowance custom part to the shared catalog after saving. */
  addToCatalog: string;
  /** Spec records design §6 — optional system match key ("" = none). */
  specKey: string;
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
  manufacturerPartNumber: string;
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
  /**
   * #272: true while `milesRT` was filled from the route (not typed). A route
   * change replaces auto-filled miles; typing in the box clears the flag.
   * Absent on drafts saved before #272 — those count as typed, never overwritten.
   */
  milesAuto?: boolean;
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
  pricedAt?: number;
};

/** A page of catalog search results (total = matches before the display cap). */
export type CatalogSearch = { hits: CatalogHit[]; total: number };

/** One estimate hit for the "move system to existing estimate" picker. */
export type QuoteLite = {
  id: string;
  /** #223 — the estimate number shown in the picker. */
  number: string;
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

/**
 * The staff Portal panel's data (#245 Task 13, spec §5) — present only for a
 * loaded quote with `source === "portal-catalog"`; null otherwise (a fresh
 * estimate, or any other quote type/source never renders the panel).
 * `porItems` is a point-in-time read of the loaded spec's `por` lines (the
 * next Save recomputes what remains — see `clearPricedPor`). `confirmItems`
 * (#250) is the same read of `portalConfirm` lines — priced curtains still
 * awaiting Peak's confirmation.
 */
export type PortalPanelData = {
  quoteId: string;
  portalFirm: { generatedAt: number; validUntil: number } | null;
  portalReview: { requestedAt: number; reasons: string[] } | null;
  portalAcceptance: {
    at: number;
    by: string;
    byEmail: string;
    purchaseMethod?: "po" | "card" | "check" | "other";
    notes?: string;
    poDocumentId?: string | null;
  } | null;
  portalDecline: { at: number; by: string; note: string } | null;
  porItems: Array<{ desc: string; qty: number }>;
  confirmItems: Array<{ desc: string; qty: number }>;
  /** Where the Approve (→ won) status button redirects back to on refusal. */
  back: string;
};

export type InitialQuote = {
  loadedId: string | null;
  quoteId: string;
  status: QuoteStatus;
  review: QuoteReview;
  /** Undefined/"system" on a fresh estimate — the Daylite stage bar (Task 6)
   *  only renders for quotes carriesPipeline() says carry a pipeline. */
  quoteType?: string | null;
  /** Normalized on read by the quotes store (normalizeQuotePipeline) — null
   *  for a quote type that carries no pipeline, or an unsaved estimate. */
  pipelineId: string | null;
  stage: string | null;
  projectName: string;
  custName: string;
  customerId: string | null;
  locationId: string | null;
  contactName: string;
  quoteNote: string;
  /** Editable quote-level assumptions/exceptions carried into the customer document. */
  assumptions: string;
  installTimeframe: string;
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
  /** Saved Show-on-PDF choices (#222) — DEFAULT_PDF_OPTIONS for a new estimate. */
  pdfOptions: QuotePdfOptions;
  /** The saved PDF's state (#222) — null for a new or never-rendered estimate. */
  pdf: QuotePdfView | null;
  /** #245 Task 13 — set only for a loaded `source === "portal-catalog"` quote. */
  portal: PortalPanelData | null;
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
  /** Settings → Pipelines (Task 6) — the Daylite stage bar reads the loaded
   *  quote's pipeline from here; loaded once server-side (loadPipelines()). */
  pipelines: Pipelines;
  /** Branding for the customer document (Settings → Branding, D69). */
  companyName: string;
  logoDark: string | null;
  fabrics: FabricOpt[];
  /** #227 late: the curtain sewing % (Estimating Rules curtains.sewingPct), read on the server. */
  curtainSewingPct: number;
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
  /** #242 — the saved quote's review-limit chip, evaluated on the server
   *  (null for a new quote or when the owner has no limit for its kind). */
  reviewLimit: ReviewLimitChipData | null;
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
  /** #245: the freight-by-distance rule (Estimating Rules), loaded server-side
   *  via loadFreightRule() — plain numbers, client-safe. */
  freightRule: FreightRule;
  /** Company-managed checked assumptions shared with consulting proposals. */
  assumptionLibrary: string[];
  /** #245 Task 13 — a Portal panel Approve refusal's message (?statusError=
   *  from the Quotes-hub status action), or null. */
  portalStatusError: string | null;
  /** Spec records design §6 — the Spec select's options: every non-archived
   *  system record's match key (`systemMatchKeys`), read on the server so the
   *  client never imports the records store. */
  specKeys: string[];
};
