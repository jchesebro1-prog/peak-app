import type { PackageSelection } from "@/lib/estimate-output/package-selection";
import type { ClientResponse } from "@/lib/estimate-output/responses";
import type { BonusRecord, BonusSplit } from "@/lib/estimate-bonus/record";
import type { RackPartFacts } from "@/lib/rack/types";
import type { QuoteReview, QuoteStatus } from "@/lib/stores/quotes";
import type { FixtureRates } from "@/lib/stores/pricing";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import type { ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import type { Pipelines } from "@/lib/pipelines";
import type { FreightRule } from "@/lib/freight-rule";
import type { CategoryOption } from "@/lib/system-categories";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import type { PackageDoc } from "@/lib/package-doc/types";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import type { TrackSeries } from "@/lib/track-series";
import type { SystemIntro } from "@/lib/narrative/intros";
import type { EstimateSuggestionView, SuggestionParts } from "@/lib/assist/features/suggestion-panel";
import type { VendorPdfExtraction } from "@/lib/vendor-pdf/extraction";
import type { VendorPdfReadUi } from "@/lib/vendor-pdf/fill";
import type { ProjectDiscounts } from "@/lib/project-discounts/rules";
import type { PaymentTerms, SpecSection, TrackPart, FabricOpt, TravelLite } from "@/lib/estimating-core/types";
export * from "@/lib/estimating-core/types";

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
  /** #348 slice 5 — index into extracted.data.lines this line was filled from (absent = typed). */
  extractedIndex?: number;
};

/** #348 slice 5 — the Read-the-PDF result a saved vendor quote keeps (server-verified at save). */
export type VendorQuoteExtracted = { runId: string; model: string; at: number; data: VendorPdfExtraction };

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
  /** #348 slice 4 — the vendor company (Customers directory, a vendor type); `vendor` stays the display / typed fallback. Absent on legacy quotes. */
  vendorCompanyId?: string | null;
  /** #348 slice 4 — first saved (server-stamped; absent on quotes saved before slice 4). */
  addedAt?: number;
  /** #348 slice 4 — the email thread this quote came from (Add as vendor quote…). */
  fromThreadId?: string | null;
  /** #348 slice 5 — what Read the PDF read from this quote's file (absent = never read). */
  extracted?: VendorQuoteExtracted | null;
};

/** Data-URL characters the estimate's vendor attachments already spend of
 *  VENDOR_ATTACHMENT_BUDGET. Bytes moved into Blob storage cost nothing. */
export function vendorAttachmentLoad(quotes: VendorQuote[]): number {
  return quotes.reduce((a, v) => a + (v.attachment?.dataUrl?.length || 0), 0);
}

/** One typed materials row in the vendor-quote form (strings while editing). */
export type VendorLineDraft = {
  id: number;
  description: string;
  manufacturerPartNumber: string;
  qty: string;
  unit: string;
  amount: string;
  /** #348 slice 5 — the extracted line this row was filled from (absent = typed). */
  fromRead?: number;
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
  /** #348 slice 4 — the picked vendor company (null = typed name only) and the email the quote came from. */
  vendorCompanyId: string | null;
  fromThreadId: string | null;
  /** #348 slice 5 — the read this form keeps (saved with the quote) and the banner state (never persisted). */
  extracted: VendorQuoteExtracted | null;
  pdfRead: VendorPdfReadUi | null;
};

/* ---------------- server → client props ---------------- */

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
  /** Oct 15 #32 — the last priced file that listed this part (lib/catalog-books). */
  priceDate?: number;
  /** #304 — Model # and MFR P/N (omitted when blank): the staff row leads with the model, the order # beside it. */
  model?: string;
  mpn?: string;
  /** #296 — rack data when the part carries any (omitted otherwise). */
  rack?: RackPartFacts;
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
    /** Jeff 2026-10-15 #15 — the signer and PO # typed at Accept. */
    signerName?: string;
    signerTitle?: string;
    poNumber?: string;
  } | null;
  portalDecline: { at: number; by: string; note: string } | null;
  porItems: Array<{ desc: string; qty: number }>;
  confirmItems: Array<{ desc: string; qty: number }>;
  /** Where the Approve (→ won) status button redirects back to on refusal. */
  back: string;
};

export type InitialQuote = {
  /** Estimator Phase 6 — the admin-set system categories with each typical part resolved against the live catalog
   *  (the Add a system modal). Read-only server data, never saved with the quote. */
  systemCategories: CategoryOption[];
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
  /** #287 task B — the Lead estimator ("" when the stored quote has none). */
  owner: string;
  /** #287 task B — Prepared by; prints on the customer document ("" falls back to the owner). */
  preparedBy: string;
  revNum: number;
  revDateMs: number;
  /** Customer pricing-tier stamp (item 11, D87) — seeds labor/curtain
   *  margins; re-stamped server-side when the customer/contact changes. */
  pricingTier: string | null;
  tierMargin: number | null;
  /** Saved builder state (spec.sections) — null starts a clean estimate. */
  sections: SpecSection[] | null;
  /** Phase 2a: named system groups (spec.groups) — [] when none. */
  groups: SystemGroup[];
  /** Estimator Phase 5 — the Build package document (spec.document, sanitized); null = none. */
  document: PackageDoc | null;
  /** #366 — the estimate's project discounts (spec.projectDiscounts, sanitized); absent / {} = none. */
  projectDiscounts?: ProjectDiscounts;
  /** Imported vendor quotes (#143) — top-level on the doc, not in spec. */
  vendorQuotes: VendorQuote[];
  /** #160 / D205 — the draft this new estimate replaces ("Change type"); "" otherwise.
   *  Sent with the FIRST save only, which retires that draft server-side. */
  replaces: string;
  /** Saved Show-on-PDF choices (#222) — DEFAULT_PDF_OPTIONS for a new estimate. */
  /** #301 — the cover PDF's overall summary ("" = the scope-list sentence). */
  coverSummary: string;
  /** #301 — Not included as stored; null = never stored (the editor starts
   *  from the Settings → Estimate output default list). */
  notIncluded: string | null;
  /** #333 — the Client package selection, normalised (defaults for a new estimate). */
  packageSelection: PackageSelection;
  pdfOptions: QuotePdfOptions;
  /** The saved PDF's state (#222) — null for a new or never-rendered estimate. */
  pdf: QuotePdfView | null;
  /** #245 Task 13 — set only for a loaded `source === "portal-catalog"` quote. */
  portal: PortalPanelData | null;
  /** Estimator bonuses — the loaded quote's source / quoteType (a new
   *  estimate reads "estimator" / "system"); feeds `bonusRulesApply`. */
  bonusSource: string;
  bonusQuoteType: string;
  /** Estimator bonuses — store-owned, display-only (never in the save payload). */
  clientResponses: ClientResponse[] | null;
  bonusRecord: BonusRecord | null;
  estimatorBonusSplit: BonusSplit | null;
  /** Estimate suggestion (spec 2026-10-13 §2) — the lead this estimate is for:
   *  the stored one on a saved quote (never changed by a save), else the
   *  hand-off's / suggestion's; sent with the CREATE save only. */
  leadId: string | null;
  /** Box goods sale (spec 2026-10-21) — the stored flag (boxSaleOf); false for a new estimate unless the
   *  + New quote card opened it (?box=1). Rides every Save. */
  boxSale: boolean;
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

/** #334 (D877) — what the Build banner shows for an Assist-drafted estimate:
 *  the source email, the model's notes, and why each still-present line was picked. */
export type AssistDraftView = {
  quoteId: string;
  threadId: string;
  notes: string;
  reasons: { desc: string; reason: string }[];
};

export type EstimatorProps = {
  initial: InitialQuote;
  /** #348 slice 4 — ?vq= hand-off ref (validated shape), else null. */
  vendorFromThread?: string | null;
  /** Settings → Pipelines (Task 6) — the Daylite stage bar reads the loaded
   *  quote's pipeline from here; loaded once server-side (loadPipelines()). */
  pipelines: Pipelines;
  /** Branding for the customer document (Settings → Branding, D69). */
  companyName: string;
  logoDark: string | null;
  fabrics: FabricOpt[];
  /** #227 late: the curtain sewing % (Estimating Rules curtains.sewingPct), read on the server. */
  curtainSewingPct: number;
  /** #274: every track series (Estimating Rules → Track series), active or
   *  not — the modal lists active ones; a saved line on an inactive one still
   *  reopens. A deleted series is simply absent. */
  trackSeries: TrackSeries[];
  /** #274: the live catalog part behind every SKU a series maps, keyed by
   *  SKU. A mapped SKU missing here was deleted from the catalog. */
  trackParts: Record<string, TrackPart>;
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
  /** #284 — the next-step control's view for this viewer (null for a new
   *  quote). Replaces the review bar's reviewers / me / canApprove props and
   *  carries the #242 review-limit chip as its strip. */
  next: QuoteNextStepView | null;
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
  /** #334 (D877) — the Build banner for an estimate Assist drafted from an
   *  email (null when not an Assist draft, or once dismissed). */
  assistDraft: AssistDraftView | null;
  /** Spec records design §6 — the Spec select's options: every non-archived
   *  system record's match key (`systemMatchKeys`), read on the server so the
   *  client never imports the records store. */
  specKeys: string[];
  /** #282 phase 2 — may this user apply Rewards credit (`create`)? */
  canApplyCredit: boolean;
  /** #287 task B — the signed-in user's name (the one Lead estimator they may always pick). */
  viewerName: string;
  /** #287 task B — may this user make someone else the lead estimator (`approve`)? */
  viewerCanApprove: boolean;
  /** Jeff 2026-10-15 #18 — the loaded quote has been sent at least once (quoteSentOnce): Lead estimator and
   *  Prepared by are then read-only for non-approvers. Absent = false. */
  peopleSentOnce?: boolean;
  /** Jeff 2026-10-15 #19 — Estimating Rules' bonus rates (fractions) for a draft's live bonus lines. Absent = 5 % / 2 %. */
  bonusRates?: import("@/lib/estimate-bonus/flags").BonusRates;
  /** Estimator Phase 4 — the signed-in user's roles, for the review-comment
   *  rules (src/lib/estimate-review/comments.ts: add / resolve / delete). */
  viewerRoles: string[];
  /** #293 — may this user save product paragraphs / system intros (`create`)? */
  canWriteNarrativeLibrary: boolean;
  /** #293 — the system-intro library (Settings blob `narrative_intros`). */
  narrativeIntros: SystemIntro[];
  /** #301 — Settings → Estimate output: the default Not included list (Reset to default). */
  notIncludedDefault: string;
  /** Estimate suggestion (spec 2026-10-13 §2) — the Suggested BOM panel's view:
   *  from `?suggestion=` on a new estimate, or the suggestion a saved quote was
   *  built from; null/absent = no panel. */
  suggestion?: EstimateSuggestionView | null;
  /** The live catalog part behind each suggestion sku, keyed by the
   *  suggestion's own sku (a rename resolves to the new part); a sku missing
   *  here lands as an unpriced custom line. */
  suggestionParts?: SuggestionParts;
  /** #348 slice 5 — Read the PDF is offered: `vendorPdfGateFor` passed on the server (a pilot user, the feature on,
   *  the kill switch off, and a Claude key). Never derived from assistUiFlags, which reports true under the local
   *  provider with no key. */
  vendorPdfEnabled: boolean;
};

/** #348 slice 5 — the vendor form's Read the PDF state (transient; reset whenever the form or its file changes).
 *  `error.hard` = the failed attempt was a Try harder, so it isn't offered again. */
export type VendorPdfFormState = {
  busy: null | "read" | "hard";
  error: { text: string; tooLarge: boolean; hard: boolean } | null;
};
