/**
 * The Estimator's persisted pricing domain: the spec shapes saved on
 * quote.spec ({ sections, mobs }) and the configurator drafts the pricing
 * helpers read. Moved here from src/app/(app)/estimator/types.ts (estimator
 * handoff, spec 2026-10-20 §3); that file re-exports everything below.
 * Must stay browser-pure: `npm run core:check`.
 */
import type { AssemblyRole } from "@/lib/fixture-assemblies";
import type { CurtainRequest } from "@/lib/portal-cart-types";
import type { TrackConfig } from "@/lib/track-engine";
import type { TrackMounting, TrackOperation } from "@/lib/track-series";

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
   *  markup) that still needs Peak to confirm measurements + fabric — stays
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
  /**
   * Estimator bonuses (2026-10-12 spec): an automatic, internal-only line.
   * "package" = 5% of the system's cost (only when it has labor), marked up at
   * the system's blended markup; "estimator" = 2% of the system's price, at
   * cost. Written only by `withBonusLines` (src/lib/estimate-bonus/rules.ts);
   * folded into other rows on every customer surface by `customerLines`.
   */
  bonus?: "package" | "estimator";
  /** Jeff 2026-10-15 #19 — the rate (fraction) a bonus line was figured at, present only when it isn't the default
   *  5 % / 2 % (Estimating Rules → Estimator bonuses). Written only by `withBonusLines`. */
  bonusPct?: number;
  /** #270: a mobilization's travel cost as its own internal line (mileage,
   *  hotel, per diem, lift rental). Like `laborOverhead` the CUSTOMER
   *  document never shows it — `customerLines` folds its sell into the
   *  mobilization line sharing its `laborMobKey`. */
  laborTravel?: LaborTravelKind;
  /** #270: links a mobilization line and its travel lines (same key). */
  laborMobKey?: string;
  /** #292: shared by a curtain line and the track line that hangs it (laborMobKey idiom) — "ct-<curtain line id at add time>". */
  curtainTrackKey?: string;
  /** #269: every line one "Add labor" inserted shares this id; the draft
   *  that built them is `SpecSection.laborGroups[id]` (labor-group.ts). */
  laborGroup?: string;
  /** Orderable component detail for a catalog-backed fixture assembly.
   *  #366: a part with a project discount carries catalogCost / projectDiscountPct like a line (applyProjectDiscounts). */
  components?: Array<{ sku: string; label: string; role: AssemblyRole; qty: number; unit: string; cost: number; price: number; catalogCost?: number; projectDiscountPct?: number }>;
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
  /** #296 — the rack assembly this line was configured from (D578). */
  rackId?: string;
  /** #245 Task 13 — the free-text curtain request this line was priced from
   *  (portal-pricing.ts priceCurtain), carried the same way as `fixtureId`
   *  above so the line can be rebuilt into a cart line. */
  curtainInputs?: CurtainRequest;
  /** #274: a configured track line — the configurator inputs, kept so the
   *  line reopens the track modal (track-modal.tsx). The line is one lot;
   *  its priced parts ride in `components` (so the PM parts list explodes
   *  them) and the customer document shows only the one line. Built by
   *  track-bom.ts `trackLine`. */
  track?: TrackConfig;
  /** #282 phase 2: the quote's Rewards credit — one line on the LAST system,
   *  qty 1, cost 0, negative `price` (the only line a negative price is
   *  allowed on). Every system-level rule skips it; `totals()` subtracts it
   *  from the grand total. See src/lib/rewards/credit-line.ts. */
  rewardCredit?: boolean;
  /** #366 — the line's normal (undiscounted) cost while a project discount applies; absent otherwise.
   *  On an assembly line: its cost before its discounted parts. Written only by applyProjectDiscounts
   *  (src/lib/project-discounts/rules.ts); freight, the 5% package bonus and the tier re-price read it. */
  catalogCost?: number;
  /** #366 — the project discount % applied to this line (a mirror of spec.projectDiscounts[sku].pct; never
   *  set on an assembly line, whose parts may differ). Written only by applyProjectDiscounts. */
  projectDiscountPct?: number;
};

/** #293: a product the customer narrative features — its paragraph prints
 *  (Narrative presentation only) with the part's photo floated beside it.
 *  Anchored to one line of THIS section: item ids are unique per section
 *  only (computeNid / placeSystemInEstimate keeps ids on Copy-to-existing). */
export type KeyProduct = {
  /** String(SpecItem.id) of a line in THIS section. */
  lineKey: string;
  /** The line's sku when marked — resolution requires it to still match. */
  sku: string;
  /** The paragraph as it prints: plain text, narrativeBlocks() rules (D488). */
  text: string;
  /** Print the part's primary photo beside the paragraph. */
  photo: boolean;
};

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
   *  re-rounded, never pushed into the line prices; the markup follows it and
   *  the customer document spreads the difference across the visible lines
   *  (`customerLines`). Cleared by this system's Markup slider, the global
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
  /** #293: ordered; at most one block per lineKey and per sku. Absent on
   *  every pre-#293 section (which therefore prints exactly as before). */
  keyProducts?: KeyProduct[];
  /** #301: the survey discipline this system answers (the Discipline select in
   *  the system header). Absent = inferred from the name for goal matching only
   *  (inferDiscipline) — never stored by inference. Cleaned on save. */
  discipline?: "lighting" | "rigging" | "curtain" | "av";
  /** Phase 2a: the group (spec.groups) this system sits under; absent = ungrouped. A group id
   *  that names no group is dropped on read and on save (normalizeSystemOrder). */
  groupId?: string;
  /** Phase 2a: staff-only "built" mark (collapsed in the Build step). Never printed, never in the
   *  PDF doc key; absent when not built (never false). Any other edit to the system clears it. */
  built?: true;
  /** Phase 2b: derived — only normalizeSystemOrder writes it. `true` exactly when this system's group
   *  (spec.groups) is an Alternate group ("priced separately — not in the total"); absent otherwise
   *  (never false). totals() keeps an alternate out of the grand total (it goes to `alt`). A posted
   *  value is never trusted (sanitizeSectionGroupMeta strips it); a system leaving the estimate drops it. */
  alternate?: true;
  /** #301: the client's goals for this scope (≤ 1,000, plain text). Copied
   *  from the site visit; dropped by Load system (R5). */
  clientGoals?: string;
  /** #301: the cover PDF's paragraph override (≤ 1,500). Absent = the intro's
   *  first paragraph (coverParagraphFor). Dropped by Load system (R5). */
  coverText?: string;
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
  /** #302 — "1" = Unit sell follows Unit cost at the flat custom-part markup
   *  (`customPartSell`); typing a sell turns it off, clearing it turns it on. */
  priceAuto: string;
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
  /** #292 — "grommets" | "pipe-pocket" | "hook-loop" (vocab.ts). `hang` and `bottom` above are legacy and read by nothing.
   *  The three #292 fields are optional only so drafts built before #292 still type; every
   *  Estimator draft sets them (freshCurtain, curtainDraftFromLine) and readers default a blank. */
  topFinish?: string;
  /** #292 — "chain" | "pipe-pocket" | "hem". */
  bottomFinish?: string;
  /** #292 — a CURTAIN_MOUNT_TYPES id; used only when no track is linked. */
  mountType?: string;
  /** Real vendor (Rose Brand) unit cost; when set, overrides the make-it cost. */
  vendorCostOverride?: string;
  /** #292 — the override Edit curtain SEEDED from the line (curtainDraftFromLine); the
   *  "Kept from the quote" hint shows only while the field still holds it. Never stored. */
  seededVendorCost?: string;
};

/** #274: the track configurator's form (strings while editing, like every
 *  other draft); `trackConfigFromDraft` (track-bom.ts) turns it into the
 *  TrackConfig the engine prices and the line stores. Blank spacing = the
 *  series default. */
export type TrackDraft = {
  seriesId: string;
  operation: TrackOperation;
  curved: boolean;
  radius: string;
  run: string;
  mounting: TrackMounting;
  trim: string;
  qty: string;
  label: string;
  carrierSpacing: string;
  hangerSpacing: string;
  /** Oct 15 #45 — walk-along only: two curtain halves (a walk-along bi-part). */
  walkAlongBipart?: boolean;
};

/** #274: one catalog part a track series maps a role to, as the Estimator
 *  page hands it to the client (read from the live catalog on load). */
export type TrackPart = { sku: string; desc: string; cost: number; list: number; unit: string; mfr: string };

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

/** Travel estimate for a (customer, venue) pair, precomputed server-side. */
export type TravelLite = {
  miles: number | null;
  minutes: number | null;
  officeName: string | null;
};
