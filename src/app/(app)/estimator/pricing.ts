import { curtainCost, curtainPrice, fabricAreaRateOf, type CurtainSewing } from "@/lib/design/curtain-pricing";
import { ceilToStep, PRICE_OVERRIDE_MAX, typedPriceWarning, type PriceWarning } from "@/lib/service-pricing";
import {
  DISC_LABEL,
  FIXTURES,
  fixtureAddOns,
  LABOR_PCT,
  LABOR_RATES_FALLBACK,
  type FixtureAddOns,
  type FixtureDef,
} from "./estimator-data";
import type {
  CurtainDraft,
  FabricOpt,
  FixtureDraft,
  LaborDraft,
  LaborTravelKind,
  MobDraft,
  SpecSection,
  SpecItem,
} from "./types";

/**
 * Estimator pricing math — EXACT port of the prototype logic class
 * (Estimator.dc.html). Every equation, rounding step and threshold matches;
 * margins price as sell = cost / (1 − margin).
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** $1,234.56 (prototype fmt). */
export function fmt(n: number): string {
  return (
    "$" +
    round2(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** $88.3k / $845 (prototype short — sidebar amounts). */
export function short(n: number): string {
  return n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + Math.round(n);
}

/** Margin readout color: ≥30% green, ≥18% amber, else red-brown. */
export function marginColor(m: number): string {
  return m >= 0.3 ? "#1f8a5b" : m >= 0.18 ? "#9a7d1f" : "#c0683a";
}

/**
 * The margin fraction a priced line is ALREADY carrying, or null when it has
 * none that can be rescaled (#144, D163). A sell price of 0 has no margin to
 * read, and a margin of exactly 1 (a real price against a $0 cost) rescales
 * through a division by zero. A negative margin — a line hand-priced below its
 * cost — is a real margin and is kept: the caller's job is to preserve what the
 * user set, not to quietly correct it.
 */
export function lineMarginOf(cost: number, price: number): number | null {
  if (!(price > 0)) return null;
  const m = (price - cost) / price;
  return Number.isFinite(m) && m < 1 ? m : null;
}

/** The customer-facing extended sell for a line, including a manual override. */
export function lineExtSellOf(it: Pick<SpecItem, "qty" | "price" | "extSellOverride">): number {
  return it.extSellOverride != null && Number.isFinite(it.extSellOverride)
    ? Math.max(0, it.extSellOverride)
    : it.qty * it.price;
}

/**
 * Back-solve for a manually typed UNIT sell price — the other numbers (ext
 * sell, margin) follow from qty × price once this lands, so any standing
 * extended-sell override is cleared.
 */
export function priceFromUnitSellEdit(value: number): Pick<SpecItem, "price" | "sellOverride" | "extSellOverride"> {
  return { price: round2(value), sellOverride: true, extSellOverride: undefined };
}

/**
 * Back-solve for a manually typed EXTENDED sell: price = ext ÷ qty, so qty ×
 * price reproduces the typed ext exactly — kept at FULL precision (not
 * rounded to cents) rather than round-tripped through round2, which could
 * land the reproduced ext a cent off. A qty of 0 has nothing to divide by, so
 * it is treated as 1 and the line's qty is set to 1 along with it. Clears the
 * extended-sell override itself: from here the line's ext follows qty ×
 * price like any other line, including a later qty edit.
 */
export function backSolveExtSell(ext: number, qty: number): Pick<SpecItem, "price" | "qty" | "extSellOverride"> {
  const q = qty > 0 ? qty : 1;
  return { price: ext / q, qty: q, extSellOverride: undefined };
}

/**
 * A line repriced by the system margin slider / Sell field (setMarginAll /
 * setSystemMargin, estimator-client.tsx) — same price math as before, plus
 * clearing any per-line extended-sell override so a line that was back-solved
 * from a typed ext sell still follows the new margin instead of staying
 * stuck at its old ext.
 */
export function repriceAtMargin(cost: number, marginFraction: number): Pick<SpecItem, "price" | "extSellOverride"> {
  return { price: round2(cost / (1 - marginFraction)), extSellOverride: undefined };
}

/**
 * A line repriced to a new cost at the margin it is already carrying (#144,
 * D163) — the rule behind editing a stored vendor quote's total.
 *
 * The margin is PRESERVED rather than re-seeded from the customer tier: the
 * user may have dragged the system margin slider or typed a sell price since
 * the line was created, and re-seeding would silently undo that. Changing the
 * vendor's cost should move the sell price the way the slider would.
 *
 * An unchanged cost returns the existing price verbatim rather than
 * round-tripping it through the margin, which could land a cent away. With no
 * usable margin on the line, `seedMargin` applies — itself guarded, so this can
 * never emit NaN or Infinity.
 */
export function repricedAtLineMargin(
  cost: number,
  price: number,
  newCost: number,
  seedMargin: number
): number {
  if (newCost === cost) return price;
  const m = lineMarginOf(cost, price);
  const use = m != null ? m : seedMargin > 0 && seedMargin < 1 ? seedMargin : 0.3;
  return round2(newCost / (1 - use));
}

/**
 * The "Total cost" field a stored vendor quote seeds its EDIT form with (#144).
 *
 * Blank when the stored total is just the lines' sum, which is how the field
 * stood when the quote was entered: a filled field is a TYPED total and wins
 * over the lines from then on, so seeding it unconditionally would convert
 * every lines-driven quote on its first edit — and the line a vendor's revision
 * adds would then sit in the customer's itemized breakdown without being in the
 * price. A total that genuinely disagrees with its lines is kept as typed, so
 * an untouched edit re-saves the same number either way.
 */
export function vendorTotalSeed(storedTotal: number, linesTotal: number): string {
  return round2(linesTotal) === round2(storedTotal) ? "" : String(storedTotal);
}

/* ---------------- section + quote totals ---------------- */

export function systemItemsRev(sec: SpecSection): number {
  return sec.items.filter((x) => !x.option).reduce((a, x) => a + lineExtSellOf(x), 0);
}

export function systemItemsCost(sec: SpecSection): number {
  return sec.items.filter((x) => !x.option).reduce((a, x) => a + x.qty * x.cost, 0);
}

/**
 * The cost freight is charged on (#143, D162 — Jeff's exemption): every
 * non-option line EXCEPT one whose own price already includes freight (a
 * vendor quote added with "Quote includes freight"). Deliberately NOT
 * systemItemsCost, which still counts every line for the margin readout and
 * the cost column.
 */
export function systemFreightBase(sec: SpecSection): number {
  return sec.items.filter((x) => !x.option && !x.noFreight).reduce((a, x) => a + x.qty * x.cost, 0);
}

/** Freight is a % of the section's freight-bearing item COST. */
export function systemFreight(sec: SpecSection): number {
  return Math.round(systemFreightBase(sec) * ((sec.freightPct || 0) / 100) * 100) / 100;
}

/* ---------------- #267 system sell: typed price + $25 rounding ---------------- */

/** #267: the one rounding step the Estimator's system price accepts. */
export const SYSTEM_PRICE_STEP = 25;

/** #267: a typed system sell as stored — finite, > 0, ≤ PRICE_OVERRIDE_MAX
 *  (to the cent); anything else is no override. */
export function validSellOverride(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const c = round2(v);
  return c > 0 && c <= PRICE_OVERRIDE_MAX ? c : undefined;
}

/**
 * #267: what the user typed in a system's Sell box → the override to store,
 * or undefined to clear it (D364 parse: `$`, commas and spaces stripped, then
 * plain digits with an optional decimal — no hex, exponent or minus; empty,
 * 0 or junk clears).
 */
export function parseSellOverride(raw: string): number | undefined {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  return validSellOverride(Number(s));
}

/**
 * #267 server sanitizer for one posted section: `sellOverride` survives only
 * when valid (else it is dropped), `priceRound` only when it is exactly
 * SYSTEM_PRICE_STEP. Everything else on the section passes through untouched.
 */
export function sanitizeSystemSell<T extends SpecSection>(sec: T): T {
  if (!sec || typeof sec !== "object") return sec;
  const out = { ...sec } as T;
  const o = validSellOverride(sec.sellOverride);
  if (o == null) delete out.sellOverride;
  else out.sellOverride = o;
  if (sec.priceRound !== SYSTEM_PRICE_STEP) delete out.priceRound;
  return out;
}

/** #267: the system's price from its lines alone — items + freight, unrounded. */
export function systemComputedSell(sec: SpecSection): number {
  return systemItemsRev(sec) + systemFreight(sec);
}

/**
 * #267: the price the system actually sells for (items + freight) — a valid
 * typed `sellOverride` exactly; else, when the section carries `priceRound`,
 * the computed price rounded UP to the next multiple of it (an exact multiple
 * stays put — Jeff: always up, never nearest); else (a pre-#267 section) the
 * computed price exactly.
 */
export function systemSellTotal(sec: SpecSection): number {
  const o = validSellOverride(sec.sellOverride);
  if (o != null) return o;
  const c = systemComputedSell(sec);
  const step = sec.priceRound;
  if (typeof step === "number" && Number.isFinite(step) && step > 0 && c > 0) return ceilToStep(c, step);
  return c;
}

/** #267: systemSellTotal − systemComputedSell, to the cent (0 for a legacy/exact system). */
export function systemSellAdjustment(sec: SpecSection): number {
  return round2(systemSellTotal(sec) - systemComputedSell(sec));
}

/** #267: the section without a typed sell (the Margin sliders and Reset to auto). */
export function clearSellOverride<T extends SpecSection>(sec: T): T {
  if (!("sellOverride" in sec)) return sec;
  const out = { ...sec };
  delete out.sellOverride;
  return out;
}

/**
 * #267: turns the $25 round-up on for every section that has no `priceRound`
 * yet — what the Estimator does to a new section and, on load, to a draft
 * (or unsaved) estimate's sections. A section already carrying the field
 * is returned as-is.
 */
export function withPriceRound(sections: SpecSection[]): SpecSection[] {
  return sections.map((sec) => (sec && sec.priceRound == null ? { ...sec, priceRound: SYSTEM_PRICE_STEP } : sec));
}

/** #267: true when the system's price is a typed override. */
export function hasSellOverride(sec: SpecSection): boolean {
  return validSellOverride(sec.sellOverride) != null;
}

/** #267: the system's margin at its actual price — (items sell + adjustment
 *  − items cost) ÷ (items sell + adjustment), freight left out as before. */
export function systemMargin(sec: SpecSection): number {
  const rev = systemItemsRev(sec) + systemSellAdjustment(sec);
  return rev > 0 ? (rev - systemItemsCost(sec)) / rev : 0;
}

/** #267: the warning (never a block) under a typed system sell — below the
 *  system's cost (items + freight) or under a 10% margin; null when auto. */
export function systemSellWarning(sec: SpecSection): PriceWarning {
  if (!hasSellOverride(sec)) return null;
  return typedPriceWarning(systemSellTotal(sec), systemItemsCost(sec) + systemFreight(sec), systemMargin(sec));
}

export type QuoteTotals = {
  mat: number;
  lab: number;
  fr: number;
  opt: number;
  rev: number;
  cost: number;
  tax: number;
  grand: number;
  margin: number;
  /** #267: the systems' price adjustments (typed sells + $25 rounding), already inside rev/mat/lab. */
  adj?: number;
};

export function totals(sections: SpecSection[], taxRatePct: number): QuoteTotals {
  let mat = 0,
    lab = 0,
    fr = 0,
    opt = 0,
    rev = 0,
    cost = 0,
    adjSum = 0;
  for (const sec of sections) {
    let secMat = 0,
      secLab = 0;
    for (const it of sec.items) {
      const ext = lineExtSellOf(it);
      if (it.option) {
        opt += ext;
        continue;
      }
      rev += ext;
      cost += it.qty * it.cost;
      if (sec.kind === "labor" || it.labor) {
        lab += ext;
        secLab += ext;
      } else {
        mat += ext;
        secMat += ext;
      }
    }
    fr += systemFreight(sec);
    // #267: the system's price adjustment rides in revenue, split between
    // materials and labor the way the section's own lines are (a labor
    // section → all labor; a mixed section by its lines' sell, to the cent).
    const adj = systemSellAdjustment(sec);
    if (adj !== 0) {
      const base = secMat + secLab;
      const labShare = base > 0 ? round2((adj * secLab) / base) : sec.kind === "labor" ? adj : 0;
      lab += labShare;
      mat += round2(adj - labShare);
      rev += adj;
      adjSum += adj;
    }
  }
  const taxRate = (taxRatePct ?? 0) / 100;
  const tax = (rev + fr) * taxRate;
  return {
    mat,
    lab,
    fr,
    opt,
    rev,
    cost,
    tax,
    grand: rev + fr + tax,
    margin: rev > 0 ? (rev - cost) / rev : 0,
    adj: round2(adjSum),
  };
}

/**
 * #251 (Jeff, Sep 28): the customer document's "Materials, installation &
 * freight included" header line names only what the quote actually carries
 * — a quote with no labor doesn't say it includes installation, and same
 * for freight sitting at $0. Materials is named whenever the quote carries
 * any (mat > 0); installation only when there's labor sell; freight only
 * when there's freight sell. Joined with commas and a trailing "&" (never
 * an Oxford comma before it), e.g. "Materials, installation & freight
 * included", "Materials & freight included", "Materials included". Empty
 * when none apply (a POR-only quote, say) — the caller omits the line.
 */
export function inclusionsLine(t: Pick<QuoteTotals, "mat" | "lab" | "fr">): string {
  const parts: string[] = [];
  if (t.mat > 0) parts.push("materials");
  if (t.lab > 0) parts.push("installation");
  if (t.fr > 0) parts.push("freight");
  if (parts.length === 0) return "";
  const joined =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
      ? parts.join(" & ")
      : parts.slice(0, -1).join(", ") + " & " + parts[parts.length - 1];
  return joined.charAt(0).toUpperCase() + joined.slice(1) + " included";
}

/**
 * #242 final — the value a saved Estimator quote carries is the server's own
 * figure, never a client-posted one: the review-limit gate auto-approves on
 * the stored value. Recomputes totals() (tax 0, as the builder does) over a
 * numerically coerced copy of the posted sections; a posted value within a
 * cent of it is kept as posted (rounding), anything else is replaced by the
 * recomputed value and margin. Pure — the save action calls it.
 */
export function reconcileEstimatorValue(
  sections: unknown,
  posted: { value: unknown; margin: unknown }
): { value: number; margin: number; adjusted: boolean } {
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const safe: SpecSection[] = (Array.isArray(sections) ? sections : [])
    .filter((sec): sec is SpecSection => !!sec && typeof sec === "object")
    .map((sec) => ({
      ...sanitizeSystemSell(sec),
      freightPct: n(sec.freightPct),
      items: (Array.isArray(sec.items) ? sec.items : [])
        .filter((it) => !!it && typeof it === "object")
        .map((it) => ({
          ...it,
          qty: n(it.qty),
          cost: n(it.cost),
          price: n(it.price),
          extSellOverride: typeof it.extSellOverride === "number" && Number.isFinite(it.extSellOverride) ? it.extSellOverride : undefined,
        })),
    }));
  const t = totals(safe, 0);
  const grand = n(t.grand);
  const pv = posted.value;
  if (typeof pv === "number" && Number.isFinite(pv) && Math.abs(pv - grand) <= 0.01) {
    const pm = posted.margin;
    return { value: pv, margin: typeof pm === "number" && Number.isFinite(pm) ? pm : n(t.margin), adjusted: false };
  }
  return { value: grand, margin: n(t.margin), adjusted: true };
}

/* ---------------- curtain configurator ---------------- */

export type CurtainCalc = {
  fab: FabricOpt;
  faceArea: number;
  fabricArea: number;
  costEach: number;
  priceEach: number;
};

/**
 * CURTAIN PRICING — sewn area × the fabric's $/sq ft × (1 + sewing %) (#227,
 * #227 late), the shared model on the budget side too
 * (src/lib/design/curtain-pricing.ts). The fabric rate comes from
 * fabricAreaRateOf, the one chain every curtain path reads; the sewing % is
 * the Estimating Rule the server page reads and passes in as data. A per-line
 * Rose Brand vendor cost is the full cost: it replaces the computed make-it
 * cost, with no sewing on top.
 */
export function computeCurtain(
  d: CurtainDraft,
  fabrics: FabricOpt[],
  /** #227 late: the sewing rule (loadCurtainSewingPct, on the server). */
  sewing: CurtainSewing,
  /** Margin-on-price fraction; the customer tier stamp seeds this (item 11,
   *  D87) — 0.30 is Peak's flat curtain margin, the no-tier default. */
  margin: number = 0.3
): CurtainCalc {
  const fab =
    fabrics.find((f) => f.sku === d.fabric) ||
    fabrics[0] ||
    ({ sku: "", name: "", costPerSqft: 0 } as FabricOpt);
  const h = parseFloat(d.height) || 0; // finished height (ft)
  const w = parseFloat(d.width) || 0; // finished width (ft)
  const fullness = parseFloat(d.fullness) || 0; // percent, e.g. 50
  const override =
    d.vendorCostOverride != null && d.vendorCostOverride !== "" ? parseFloat(d.vendorCostOverride) : null;
  const cc = curtainCost(
    { finishedWidthFt: w, finishedHeightFt: h, fullnessPct: fullness, qty: 1, vendorCostOverride: override },
    { fabricRate: fabricAreaRateOf(fab), sewingPct: sewing.sewingPct }
  );
  return {
    fab,
    faceArea: h * w,
    fabricArea: cc.sewnAreaSqft,
    costEach: cc.costEach,
    priceEach: curtainPrice(cc.costEach, margin),
  };
}

/* ---------------- fixture configurator ---------------- */

export type FixtureCalc = {
  fx: FixtureDef;
  unitSell: number;
  accSell: number;
  unit: number;
  cost: number;
  ext: number;
  qty: number;
};

export function computeFixture(
  d: FixtureDraft,
  addOns: FixtureAddOns = fixtureAddOns()
): FixtureCalc {
  const isC = !!d.custom;
  const fxm: FixtureDef = isC
    ? {
        sku: "FIX",
        name: (d.name || "").trim() || "Custom fixture",
        family: "Custom",
        list: 0,
        cost: 0,
      }
    : FIXTURES.find((f) => f.sku === d.model) || FIXTURES[0];
  const up = parseFloat(d.price || "");
  const unitSell = isNaN(up) ? fxm.list || 0 : up;
  const baseCost = isC ? Math.round(unitSell * addOns.customCostFactor) : fxm.cost || 0;
  const mt = addOns.mounts[d.mount || ""] || { price: 0, cost: 0 };
  const accs = (d.accessories || []).map((k) => addOns.acc[k]).filter(Boolean);
  const pwr = (d.power || []).map((k) => addOns.pwr[k]).filter(Boolean);
  const lmp = addOns.lamps[d.lamp || ""] || { price: 0, cost: 0 };
  const accSell = accs.reduce((a, x) => a + x.price, 0);
  const addSell = mt.price + accSell + pwr.reduce((a, x) => a + x.price, 0) + lmp.price;
  const addCost =
    mt.cost +
    accs.reduce((a, x) => a + x.cost, 0) +
    pwr.reduce((a, x) => a + x.cost, 0) +
    lmp.cost;
  let qty = parseInt(d.qty, 10);
  if (isNaN(qty) || qty < 1) qty = 1;
  const unit = unitSell + addSell,
    cost = baseCost + addCost;
  return {
    fx: fxm,
    unitSell,
    accSell,
    unit: round2(unit),
    cost: round2(cost),
    ext: round2(unit * qty),
    qty,
  };
}

/* ---------------- labor configurator ---------------- */

/**
 * Where a resolved rate came from:
 *  - `catalog`: a live `catalog_parts` row (category 'Labor')
 *  - `fallback`: the hardcoded LABOR_RATES_FALLBACK map (no catalog row)
 *  - `none`: neither; the rate resolves to 0
 */
export type RateSource = "catalog" | "fallback" | "none";

export type RateFn = ((sku: string) => number) & {
  /** Provenance of `rate(sku)`, present on rate fns built by makeLaborRate.
   *  Optional so a plain `(sku) => number` still satisfies RateFn. */
  source?: (sku: string) => RateSource;
};

/** Provenance of a single sku against a live catalog rate map. */
export function rateSource(live: Record<string, number>, sku: string): RateSource {
  if (live && live[sku] != null) return "catalog";
  return LABOR_RATES_FALLBACK[sku] != null ? "fallback" : "none";
}

/** Live catalog rates (sku → cost) with the built-in fallback underneath. */
export function makeLaborRate(live: Record<string, number>): RateFn {
  const fn: RateFn = (sku: string) => {
    if (live && live[sku] != null) return live[sku];
    return LABOR_RATES_FALLBACK[sku] != null ? LABOR_RATES_FALLBACK[sku] : 0;
  };
  fn.source = (sku: string) => rateSource(live, sku);
  return fn;
}

export type MobCalc = {
  people: number;
  days: number;
  travel: boolean;
  reg: number;
  otHrs: number;
  regCost: number;
  otCost: number;
  supHrs: number;
  supCost: number;
  vehicles: number;
  milesRT: number;
  mileCost: number;
  hotelCost: number;
  foodCost: number;
  lifts: number;
  liftCost: number;
  /** #270: the unit rates the travel costs above were priced at (the basis
   *  each travel line shows). */
  mileRate: number;
  hotelRate: number;
  foodRate: number;
  liftRate: number;
  labor: number;
  trav: number;
  cost: number;
};

/** Per-mobilization cost build-up (cleaned from the Rigging Labor sheet). */
export function computeMob(m: MobDraft, disc: string, rate: RateFn): MobCalc {
  const people = Math.max(0, parseInt(m.people, 10) || 0);
  const days = Math.max(0, parseFloat(m.days) || 0);
  const travel = m.tripType === "travel";
  const scheduled = Math.min(24, Math.max(0, parseFloat(m.hoursPerDay || "8") || 0));
  const regularPerDay = Math.min(8, scheduled);
  const reg = people * days * regularPerDay;
  const supHrs = people > 0 ? days * regularPerDay : 0;
  const installerHrs = Math.max(0, reg - supHrs);
  const regCost = installerHrs * rate(disc + "-LBR") + supHrs * rate(disc + "-SUP");
  const otHrs = m.hoursPerDay == null
    ? Math.max(0, parseFloat(m.otHrs) || 0)
    : people * days * Math.max(0, scheduled - 8);
  const otCost = otHrs * rate(disc + "-OT");
  const supCost = supHrs * rate(disc + "-SUP");
  const vehicles = people > 0 ? Math.ceil(people / 2) : 0; // 2 crew per vehicle/room
  const milesRT = Math.max(0, parseFloat(m.milesRT) || 0);
  // local = drive round-trip every day; travel = drive there once
  const mileRate = rate("TVL-MIL");
  const hotelRate = rate("TVL-HTL");
  const foodRate = rate("TVL-FOD");
  const mileCost = (travel ? milesRT * vehicles : milesRT * vehicles * days) * mileRate;
  const hotelCost = travel ? days * vehicles * hotelRate : 0;
  const foodCost = travel ? people * days * foodRate : 0;
  const lifts = m.lift && days > 0 ? Math.ceil(days / 5) : 0;
  const liftRate = Math.max(0, parseFloat(m.liftRate || "") || rate("EQP-LIFT"));
  const liftCost = lifts * liftRate;
  const labor = regCost + otCost;
  const trav = mileCost + hotelCost + foodCost + liftCost;
  return {
    people,
    days,
    travel,
    reg,
    otHrs,
    regCost,
    otCost,
    supHrs,
    supCost,
    vehicles,
    milesRT,
    mileCost,
    hotelCost,
    foodCost,
    lifts,
    liftCost,
    mileRate,
    hotelRate,
    foodRate,
    liftRate,
    labor,
    trav,
    cost: labor + trav,
  };
}

export type LaborCalc = {
  disc: string;
  discLabel: string;
  mobs: (MobCalc & { raw: MobDraft })[];
  mobCost: number;
  totalReg: number;
  pct: number;
  pmAuto: boolean;
  drfAuto: boolean;
  pmAutoHrs: number;
  drfAutoHrs: number;
  pmHrs: number;
  shopHrs: number;
  drfHrs: number;
  shopCost: number;
  misc: number;
  baseCost: number;
  performanceBonus: number;
  totalCost: number;
  margin: number;
  totalPrice: number;
};

export function computeLabor(draft: LaborDraft, rate: RateFn): LaborCalc {
  const disc = draft.discipline || "RIG";
  const mobs = (draft.mobs || []).map((m) => ({ ...computeMob(m, disc, rate), raw: m }));
  const mobCost = mobs.reduce((a, x) => a + x.cost, 0);
  const totalReg = mobs.reduce((a, x) => a + x.reg, 0); // total straight-time man-hours across mobs
  const pct = LABOR_PCT[disc] != null ? LABOR_PCT[disc] : 0.1;
  const pmAutoHrs = Math.round(totalReg * pct); // PM hrs default = pct of reg hrs
  const drfAutoHrs = Math.round(totalReg * 0.02 * 10) / 10;
  const pmAuto = draft.pmAuto !== false;
  const drfAuto = draft.drfAuto !== false;
  const pmHrs = pmAuto ? pmAutoHrs : Math.max(0, parseFloat(draft.pmHrs) || 0);
  const drfHrs = drfAuto ? drfAutoHrs : Math.max(0, parseFloat(draft.drfHrs) || 0);
  const shopHrs = Math.max(0, parseFloat(draft.shopHrs) || 0); // in-house (fab) hrs — manual
  const shopCost = pmHrs * rate("SHP-PM") + shopHrs * rate("SHP-IN") + drfHrs * rate("DRF-SUB");
  const misc = Math.max(0, parseFloat(draft.misc) || 0);
  const baseCost = mobCost + shopCost + misc;
  const performanceBonus = baseCost * 0.05;
  const totalCost = baseCost + performanceBonus;
  const margin = Math.min(0.95, Math.max(0, (parseFloat(draft.margin) || 0) / 100));
  const totalPrice = margin < 1 ? totalCost / (1 - margin) : totalCost;
  return {
    disc,
    discLabel: DISC_LABEL[disc] || disc,
    mobs,
    mobCost,
    totalReg,
    pct,
    pmAuto,
    drfAuto,
    pmAutoHrs,
    drfAutoHrs,
    pmHrs,
    shopHrs,
    drfHrs,
    shopCost,
    misc,
    baseCost,
    performanceBonus,
    totalCost,
    margin,
    totalPrice,
  };
}

/** #270: one travel cost of a mobilization, with the basis it was priced on. */
export type MobTravelPart = { kind: LaborTravelKind; label: string; cost: number; basis: string };

/** $0.7 → "$0.70", $150 → "$150" — a unit rate in a basis line. */
function unitRate(n: number): string {
  const v = round2(n);
  return "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2));
}
const plural = (n: number, one: string, many = one + "s") => n + " " + (n === 1 ? one : many);

/**
 * #270: a mobilization's travel costs, split out in a fixed order (mileage,
 * hotel, per diem, lift rental) — only the ones that cost something. The
 * same numbers `computeMob` summed into `trav`, so Σ cost === m.trav.
 */
export function mobTravelParts(m: MobCalc): MobTravelPart[] {
  const parts: MobTravelPart[] = [];
  if (m.mileCost > 0) {
    const miles = m.milesRT.toLocaleString("en-US");
    const perMile = unitRate(m.mileRate) + "/mi";
    parts.push({
      kind: "mileage",
      label: "Mileage",
      cost: m.mileCost,
      basis: m.travel
        ? plural(m.vehicles, "vehicle") + " × " + miles + " mi RT × " + perMile
        : plural(m.vehicles, "vehicle") + " × " + miles + " mi RT × " + plural(m.days, "day") + " × " + perMile,
    });
  }
  if (m.hotelCost > 0)
    parts.push({
      kind: "hotel",
      label: "Hotel",
      cost: m.hotelCost,
      basis: plural(m.vehicles, "room") + " × " + plural(m.days, "night") + " × " + unitRate(m.hotelRate),
    });
  if (m.foodCost > 0)
    parts.push({
      kind: "perdiem",
      label: "Per diem",
      cost: m.foodCost,
      basis: m.people + " crew × " + plural(m.days, "day") + " × " + unitRate(m.foodRate),
    });
  if (m.liftCost > 0)
    parts.push({
      kind: "lift",
      label: "Lift rental",
      cost: m.liftCost,
      basis: plural(m.lifts, "rental") + " × " + unitRate(m.liftRate),
    });
  return parts;
}

const TRAVEL_SKU: Record<LaborTravelKind, string> = { mileage: "MIL", hotel: "HTL", perdiem: "FOD", lift: "LIFT" };

/**
 * Pure line-building half of `addLabor` (estimator-client.tsx): per active
 * mobilization, one crew-labor line followed by #270's travel lines
 * (mileage, hotel, per diem, lift rental — each its own line when it costs
 * something), plus shop & engineering / the misc allowance / the
 * performance bonus as their own separate lines when present (owner
 * request: "I like setting the shop and engineering as separate lines ...
 * and the bonus"). The caller still owns `pushItems`/`closeInput`/the
 * `r.totalCost <= 0` early-out; `nextId` is injected so this stays a pure
 * function of its inputs.
 *
 * The overhead lines carry `laborOverhead`, the travel lines `laborTravel`
 * plus their mobilization's `laborMobKey`, so `customerLines` (below) can
 * hide them from the CUSTOMER document without a SKU-prefix guess — each
 * travel line folds back into its own mobilization line there.
 *
 * #270 keeps every number the pre-split build produced: a mobilization's
 * lines together cost exactly round2(m.cost) and sell exactly its old
 * single-line sell (the labor line takes the rounding remainder of both),
 * so estimate totals and the customer document are unchanged to the cent.
 *
 * The modal rounds its "Price · ext" total once (`r.totalPrice`) while each
 * line here rounds its own share, so bounded rounding drift (≤5¢, scaled by
 * line count) can appear between the lines' own sum and that total — it
 * lands on the LAST emitted line, the same bound `foldLaborMobLines` uses
 * for its own target-total nudge.
 *
 * `group` (#269) tags every line with the labor group id and keys each
 * mobilization's lines `<group>:<index>`; without one the key is `mob<id>`.
 */
export function buildLaborItems(r: LaborCalc, discLabel: string, nextId: () => number, group?: string): SpecItem[] {
  const price = (c: number) => (r.margin < 1 ? round2(c / (1 - r.margin)) : c);
  const items: SpecItem[] = [];
  const tag: Pick<SpecItem, "laborGroup"> = group ? { laborGroup: group } : {};
  r.mobs.forEach((m, i) => {
    if (m.cost <= 0) return;
    const label = m.raw.name && m.raw.name.trim() ? m.raw.name.trim() : "Mobilization " + (i + 1);
    const desc = label + " — " + discLabel;
    const comment = (m.raw.comments || "").trim();
    const internalNote = (m.raw.internalNote || "").trim();
    const idN = nextId();
    const skuN = nextId();
    const mobKey = group ? group + ":" + i : "mob" + idN;
    const travel = mobTravelParts(m).map((t) => ({ ...t, cost: round2(t.cost), price: price(t.cost) }));
    const travelCost = travel.reduce((a, t) => a + t.cost, 0);
    const travelPrice = travel.reduce((a, t) => a + t.price, 0);
    items.push({
      id: idN,
      sku: "LAB-" + r.disc + "-" + skuN,
      desc,
      qty: 1,
      unit: "lot",
      cost: round2(round2(m.cost) - travelCost),
      price: round2(price(m.cost) - travelPrice),
      labor: true,
      comment,
      internalNote,
      mob: { type: label, days: m.days, crew: m.people, discipline: discLabel },
      laborMobKey: mobKey,
      ...tag,
    });
    for (const t of travel) {
      const tId = nextId();
      const tSku = nextId();
      items.push({
        id: tId,
        sku: "LAB-" + TRAVEL_SKU[t.kind] + "-" + tSku,
        desc: t.label + " — " + label,
        qty: 1,
        unit: "lot",
        cost: t.cost,
        price: t.price,
        labor: true,
        internalNote: t.basis,
        laborTravel: t.kind,
        laborMobKey: mobKey,
        ...tag,
      });
    }
  });
  if (r.shopCost > 0) {
    const idN = nextId();
    const skuN = nextId();
    items.push({
      id: idN,
      sku: "LAB-SHOP-" + skuN,
      desc: "Shop & engineering — PM, fabrication & drafting",
      qty: 1,
      unit: "lot",
      cost: round2(r.shopCost),
      price: price(r.shopCost),
      labor: true,
      laborOverhead: "shop",
      ...tag,
    });
  }
  if (r.misc > 0) {
    const idN = nextId();
    const skuN = nextId();
    items.push({
      id: idN,
      sku: "LAB-MISC-" + skuN,
      desc: "Project allowance / misc",
      qty: 1,
      unit: "lot",
      cost: round2(r.misc),
      price: price(r.misc),
      labor: true,
      laborOverhead: "misc",
      ...tag,
    });
  }
  if (r.performanceBonus > 0) {
    const idN = nextId();
    const skuN = nextId();
    items.push({
      id: idN,
      sku: "LAB-BONUS-" + skuN,
      desc: "Performance bonus — 5% of labor cost",
      qty: 1,
      unit: "lot",
      cost: round2(r.performanceBonus),
      price: price(r.performanceBonus),
      labor: true,
      laborOverhead: "bonus",
      ...tag,
    });
  }
  if (items.length) {
    const target = round2(r.totalPrice);
    const drift = round2(target - items.reduce((a, it) => a + it.price, 0));
    if (drift !== 0 && Math.abs(drift) <= 0.05 * items.length) {
      const last = items[items.length - 1];
      last.price = round2(last.price + drift);
    }
  }
  return items;
}

/** One labor extra (shop & engineering / performance bonus / allowance)
 *  folded by foldLaborMobLines into one or more home lines. */
export type LaborExtra = { label: string; cost: number; price: number };

/** One home line after folding, cost/price/internalNote only — the caller
 *  fills in the rest of the SpecItem (addLabor) or discards cost/internalNote
 *  entirely (customerLines, which only wants the folded sell). */
export type FoldedMobLine = { cost: number; price: number; internalNote: string };

/**
 * Proportionally folds a set of "extra" cost/price amounts into a set of
 * home lines, weighted by each home line's own cost (evenly when every
 * weight is $0); the LAST home line absorbs the rounding remainder, so the
 * folded lines' cost and price sum to EXACTLY the pre-fold home lines' + the
 * extras' cost/price, to the cent.
 *
 * Two callers, two different reasons to fold:
 *
 * - `addLabor` (estimator-client.tsx) no longer folds shop & engineering /
 *   performance bonus / allowance into the mobilization lines — those are
 *   separate, editable lines in the INTERNAL estimate again (reverted, owner
 *   request: "I like setting the shop and engineering as separate lines").
 * - `customerLines` below is the fold that replaced it: those same overhead
 *   lines must never appear on the CUSTOMER document, so their sell gets
 *   folded into a home line (a mobilization line, or another labor line)
 *   purely for display — the internal estimate's own lines are untouched.
 *   The per-home-line share of each extra lands in `internalNote`, which
 *   `customerLines` ignores; when addLabor folded, that note was what kept
 *   the estimate readable (section-card.tsx only shows it when isInternal).
 *
 * `mobCosts`/`mobPrices` (the "weights"/starting values) and every
 * `extras[].cost`/`.price` must already be round2'd — this function only
 * redistributes them, it does not re-derive them from a margin.
 *
 * With `targetTotalPrice` passed, bounded rounding drift (≤5¢, scaled by
 * line count) between the lines' own summed price and that already-rounded
 * total lands on the last line, so the lines always match a caller's single
 * rounded total (e.g. the labor modal's "Price · ext").
 */
export function foldLaborMobLines(
  mobCosts: number[],
  mobPrices: number[],
  extras: LaborExtra[],
  targetTotalPrice?: number,
): FoldedMobLine[] {
  const n = mobCosts.length;
  if (n === 0) return [];
  const weights = mobCosts.some((c) => c > 0) ? mobCosts : mobCosts.map(() => 1);
  const weightSum = weights.reduce((a, w) => a + w, 0) || 1;

  // Per extra: each mobilization's rounded share, with the last mobilization
  // taking whatever the rounded shares before it didn't — so the shares
  // always sum to the extra's own cost/price exactly, to the cent.
  const perExtra = extras.map((extra) => {
    const costShares = new Array(n).fill(0) as number[];
    const priceShares = new Array(n).fill(0) as number[];
    let costAcc = 0;
    let priceAcc = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        costShares[i] = round2(extra.cost - costAcc);
        priceShares[i] = round2(extra.price - priceAcc);
      } else {
        const c = round2((extra.cost * weights[i]) / weightSum);
        const p = round2((extra.price * weights[i]) / weightSum);
        costShares[i] = c;
        priceShares[i] = p;
        costAcc += c;
        priceAcc += p;
      }
    }
    return { extra, costShares, priceShares };
  });

  const lines = mobCosts.map((mobCost, i) => {
    const addCost = perExtra.reduce((a, s) => a + s.costShares[i], 0);
    const addPrice = perExtra.reduce((a, s) => a + s.priceShares[i], 0);
    const parts = perExtra
      .filter((s) => s.costShares[i] > 0)
      .map((s) => s.extra.label + " " + fmt(s.costShares[i]));
    return {
      cost: round2(mobCost + addCost),
      price: round2(mobPrices[i] + addPrice),
      internalNote: parts.length ? "Includes " + parts.join(" · ") : "",
    };
  });

  if (typeof targetTotalPrice === "number" && Number.isFinite(targetTotalPrice) && lines.length > 0) {
    const drift = round2(round2(targetTotalPrice) - lines.reduce((a, l) => a + l.price, 0));
    if (drift !== 0 && Math.abs(drift) <= 0.05 * Math.max(1, lines.length + extras.length)) {
      const last = lines[lines.length - 1];
      last.price = round2(last.price + drift);
    }
  }

  return lines;
}

/* ---------------- customer-facing labor-overhead fold ---------------- */

/** True for a shop & engineering / performance-bonus / misc-allowance labor
 *  line — addLabor tags these `laborOverhead` (types.ts); older quotes built
 *  during the brief window when these folded into the mobilization line
 *  predate the flag, so their LAB-SHOP-/LAB-BONUS-/LAB-MISC- SKU prefix is
 *  the fallback (mobilization SKUs use
 *  LAB-<discipline>-, e.g. LAB-RIG-/LAB-LIG-/LAB-AUD-/LAB-VID-/LAB-OTH-, so
 *  the two can't collide). */
export function isLaborOverheadItem(it: Pick<SpecItem, "labor" | "sku" | "laborOverhead">): boolean {
  if (it.laborOverhead) return true;
  return !!(it.labor && /^LAB-(SHOP|MISC|BONUS)-/.test(it.sku || ""));
}

/** #270: a mobilization's mileage / hotel / per diem / lift-rental line —
 *  internal only; `customerLines` folds it into its mobilization line. */
export function isLaborTravelItem(it: Pick<SpecItem, "laborTravel">): boolean {
  return !!it.laborTravel;
}

/** A labor line the CUSTOMER document never shows by itself: overhead
 *  (shop & engineering / bonus / allowance) or #270 travel. */
export function isLaborInternalItem(it: Pick<SpecItem, "labor" | "sku" | "laborOverhead" | "laborTravel">): boolean {
  return isLaborOverheadItem(it) || isLaborTravelItem(it);
}

/** One row of the CUSTOMER document: either a real spec line with its
 *  customer-facing `ext` (overhead sell already folded in when this is the
 *  home line it folded onto), or — only when a section has overhead lines
 *  but nothing to fold them into — a synthetic combined row that carries
 *  their summed sell without naming any category. */
export type CustomerLine = { item: SpecItem; ext: number } | { item: null; desc: string; ext: number };

/**
 * The rows the CUSTOMER sees for a section: every non-option line MINUS the
 * shop & engineering / performance-bonus / allowance overhead lines, with
 * each overhead line's SELL folded into a home line via `foldLaborMobLines`
 * so the section's displayed total is unchanged (matches `systemItemsRev`)
 * even though the overhead lines themselves never appear. Home line,
 * in order of preference:
 *
 *  1. the section's mobilization line(s) (`it.labor && it.mob`), weighted by
 *     each one's own cost (qty × cost) — the same weighting addLabor once
 *     used to fold these into the estimate, now reused here for display.
 *  2. no mobilization line — the section's other labor line(s), weighted by
 *     their own sell.
 *  3. no labor line at all — one neutral "Project management, engineering &
 *     shop" row carrying the summed sell. Never mentions the bonus by name,
 *     never drops the amount.
 *
 * Non-labor lines and option lines are untouched (options are excluded, as
 * they already are everywhere else on this document).
 */
function customerLinesRaw(sec: SpecSection): CustomerLine[] {
  const visible = sec.items.filter((it) => !it.option);

  // #270: each travel line (mileage / hotel / per diem / lift) folds into the
  // mobilization line sharing its laborMobKey — sell AND cost, so that line
  // reads, and weighs in the overhead fold below, exactly as the one
  // mobilization line did before the split. A travel line whose
  // mobilization line is gone (removed, or an option) is folded like overhead.
  const mobByKey = new Map<string, SpecItem>();
  for (const it of visible) {
    if (it.labor && it.mob && !isLaborTravelItem(it) && it.laborMobKey && !mobByKey.has(it.laborMobKey))
      mobByKey.set(it.laborMobKey, it);
  }
  const travelAdd = new Map<SpecItem, { sell: number; cost: number }>();
  const orphanTravel: SpecItem[] = [];
  for (const it of visible) {
    if (!isLaborTravelItem(it)) continue;
    const home = it.laborMobKey ? mobByKey.get(it.laborMobKey) : undefined;
    if (!home) {
      orphanTravel.push(it);
      continue;
    }
    const cur = travelAdd.get(home) || { sell: 0, cost: 0 };
    travelAdd.set(home, { sell: cur.sell + lineExtSellOf(it), cost: cur.cost + it.qty * it.cost });
  }
  const extOf = (it: SpecItem) => round2(lineExtSellOf(it) + (travelAdd.get(it)?.sell || 0));

  const overhead = [...visible.filter(isLaborOverheadItem), ...orphanTravel];
  const rest = visible.filter((it) => !isLaborOverheadItem(it) && !isLaborTravelItem(it));
  if (!overhead.length) return rest.map((item) => ({ item, ext: travelAdd.has(item) ? extOf(item) : lineExtSellOf(item) }));

  const overheadTotal = round2(overhead.reduce((a, it) => a + lineExtSellOf(it), 0));
  const extras: LaborExtra[] = overhead.map((it) => ({ label: it.desc, cost: 0, price: round2(lineExtSellOf(it)) }));

  const mobLines = rest.filter((it) => it.labor && it.mob);
  const otherLaborLines = rest.filter((it) => it.labor && !it.mob);
  const homeLines = mobLines.length ? mobLines : otherLaborLines;
  if (!homeLines.length) {
    // Nothing to fold onto — one neutral combined row rather than dropping
    // the amount or naming the overhead category on the customer document.
    return [
      ...rest.map((item) => ({ item, ext: lineExtSellOf(item) })),
      { item: null, desc: "Project management, engineering & shop", ext: overheadTotal },
    ];
  }

  const weights = homeLines.map((it) =>
    mobLines.length ? round2(it.qty * it.cost + (travelAdd.get(it)?.cost || 0)) : round2(lineExtSellOf(it))
  );
  const homePrices = homeLines.map(extOf);
  const folded = foldLaborMobLines(weights, homePrices, extras);
  const foldedByLine = new Map(homeLines.map((it, i) => [it, folded[i].price]));

  return rest.map((item) => ({
    item,
    ext: foldedByLine.has(item) ? (foldedByLine.get(item) as number) : travelAdd.has(item) ? extOf(item) : lineExtSellOf(item),
  }));
}

/**
 * The rows the CUSTOMER sees for a section (see `customerLinesRaw` for the
 * labor-overhead fold), with the system's #267 price adjustment — a typed
 * sell or the $25 round-up — spread over them so the rows plus the
 * section's freight always add up to `systemSellTotal(sec)`.
 */
export function customerLines(sec: SpecSection): CustomerLine[] {
  return absorbSellAdjustment(customerLinesRaw(sec), systemSellAdjustment(sec));
}

/**
 * #267: spreads `adj` over the rows in proportion to their ext (whole cents),
 * the rounding remainder landing on the largest row. A row never goes below
 * $0: a share that would take it negative is clamped and the rest moves to
 * the largest row (itself clamped at $0 — only an override below the
 * system's freight can leave the rows short of the total). Rows with no
 * sell take no share unless every row is $0, when the first row carries it.
 */
export function absorbSellAdjustment(lines: CustomerLine[], adj: number): CustomerLine[] {
  const a = round2(adj);
  if (!a || !lines.length) return lines;
  const exts = lines.map((l) => round2(l.ext));
  const w = exts.reduce((s, e) => s + Math.max(0, e), 0);
  let largest = 0;
  exts.forEach((e, i) => {
    if (e > exts[largest]) largest = i;
  });
  const next = exts.slice();
  let applied = 0;
  if (w > 0) {
    exts.forEach((e, i) => {
      if (!(e > 0)) return;
      const v = Math.max(0, round2(e + round2((a * e) / w)));
      applied = round2(applied + (v - e));
      next[i] = v;
    });
  }
  next[largest] = Math.max(0, round2(next[largest] + round2(a - applied)));
  return lines.map((l, i) => ({ ...l, ext: next[i] }));
}

/** h/m label — local copy of Geo.fmtTime (lib/geo is server-only). */
export function fmtTime(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return m + "m";
  return m ? h + "h " + m + "m" : h + "h";
}

/** #160 — the catalog picker's per-row qty box: a whole number ≥ 1; anything else adds 1. */
export function parseAddQty(v: string): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
