import type { QuoteReview, QuoteStatus } from "@/lib/stores/quotes";
import type { FixtureRates } from "@/lib/stores/pricing";
import type { TaskRecord } from "@/lib/stores/tasks";

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
  mob?: SpecMob;
};

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

export type FixtureDraft = {
  model: string;
  custom: boolean;
  name: string;
  price: string;
  qty: string;
  mount: string;
  accessories: string[];
  power: string[];
  lamp: string;
  position: string;
  circuit: string;
};

export type MobDraft = {
  name: string;
  nameCustom: boolean;
  tripType: "local" | "travel";
  /** true until the user manually picks Local/Travel (the >1h auto-rule applies) */
  tripAuto: boolean;
  people: string;
  days: string;
  otHrs: string;
  sup: boolean;
  milesRT: string;
  lift: boolean;
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
  owner: string;
  revNum: number;
  revDateMs: number;
  /** Customer pricing-tier stamp (item 11, D87) — seeds labor/curtain
   *  margins; re-stamped server-side when the customer/contact changes. */
  pricingTier: string | null;
  tierMargin: number | null;
  /** Saved builder state (spec.sections) — null falls back to the demo sections. */
  sections: SpecSection[] | null;
};

/**
 * The field-survey / inspection this quote is drafting from (Phase 8, D4).
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
};
