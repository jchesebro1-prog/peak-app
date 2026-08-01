import { curtainCost, curtainPrice, makingRateFor, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
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
  MobDraft,
  SpecSection,
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

/* ---------------- section + quote totals ---------------- */

export function systemItemsRev(sec: SpecSection): number {
  return sec.items.filter((x) => !x.option).reduce((a, x) => a + x.qty * x.price, 0);
}

export function systemItemsCost(sec: SpecSection): number {
  return sec.items.filter((x) => !x.option).reduce((a, x) => a + x.qty * x.cost, 0);
}

/** Freight is a % of the section's item COST. */
export function systemFreight(sec: SpecSection): number {
  return Math.round(systemItemsCost(sec) * ((sec.freightPct || 0) / 100) * 100) / 100;
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
};

export function totals(sections: SpecSection[], taxRatePct: number): QuoteTotals {
  let mat = 0,
    lab = 0,
    fr = 0,
    opt = 0,
    rev = 0,
    cost = 0;
  for (const sec of sections) {
    for (const it of sec.items) {
      const ext = it.qty * it.price;
      if (it.option) {
        opt += ext;
        continue;
      }
      rev += ext;
      cost += it.qty * it.cost;
      if (sec.kind === "labor" || it.labor) lab += ext;
      else mat += ext;
    }
    fr += systemFreight(sec);
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
  };
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
 * CURTAIN PRICING — two-term make-it model (area × fabricRate + sewn width ×
 * makingRate), shared with the budget side (src/lib/design/curtain-pricing.ts,
 * spec 2026-07-24-curtain-pricing-rebuild). A per-line Rose Brand vendor cost
 * overrides the computed make-it cost when set.
 */
export function computeCurtain(
  d: CurtainDraft,
  fabrics: FabricOpt[],
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
  const fabricRate = fab.curtainAreaRate ?? SEED_FABRIC_RATES[fab.sku] ?? fab.costPerSqft ?? 0;
  const override =
    d.vendorCostOverride != null && d.vendorCostOverride !== "" ? parseFloat(d.vendorCostOverride) : null;
  const cc = curtainCost(
    { finishedWidthFt: w, finishedHeightFt: h, fullnessPct: fullness, qty: 1, vendorCostOverride: override },
    { fabricRate, makingRate: makingRateFor(fullness) }
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
  const up = parseFloat(d.price);
  const unitSell = isNaN(up) ? fxm.list || 0 : up;
  const baseCost = isC ? Math.round(unitSell * addOns.customCostFactor) : fxm.cost || 0;
  const mt = addOns.mounts[d.mount] || { price: 0, cost: 0 };
  const accs = (d.accessories || []).map((k) => addOns.acc[k]).filter(Boolean);
  const pwr = (d.power || []).map((k) => addOns.pwr[k]).filter(Boolean);
  const lmp = addOns.lamps[d.lamp] || { price: 0, cost: 0 };
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
  labor: number;
  trav: number;
  cost: number;
};

/** Per-mobilization cost build-up (cleaned from the Rigging Labor sheet). */
export function computeMob(m: MobDraft, disc: string, rate: RateFn): MobCalc {
  const people = Math.max(0, parseInt(m.people, 10) || 0);
  const days = Math.max(0, parseFloat(m.days) || 0);
  const travel = m.tripType === "travel";
  const reg = people * days * 8; // straight-time man-hours
  const regCost = reg * rate(disc + "-LBR");
  const otHrs = Math.max(0, parseFloat(m.otHrs) || 0);
  const otCost = otHrs * rate(disc + "-OT");
  const supHrs = m.sup ? days * 8 : 0; // one supervisor for the trip
  const supCost = supHrs * rate(disc + "-SUP");
  const vehicles = people > 0 ? Math.ceil(people / 2) : 0; // 2 crew per vehicle/room
  const milesRT = Math.max(0, parseFloat(m.milesRT) || 0);
  // local = drive round-trip every day; travel = drive there once
  const mileCost = (travel ? milesRT * vehicles : milesRT * vehicles * days) * rate("TVL-MIL");
  const hotelCost = travel ? days * vehicles * rate("TVL-HTL") : 0;
  const foodCost = travel ? people * days * rate("TVL-FOD") : 0;
  const lifts = m.lift && days > 0 ? Math.ceil(days / 5) * Math.max(1, vehicles) : 0;
  const liftCost = lifts * rate("EQP-LIFT");
  const labor = regCost + otCost + supCost;
  const trav = mileCost + hotelCost + foodCost + liftCost;
  return {
    people,
    days,
    travel,
    reg,
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
  const drfAutoHrs = Math.round(totalReg * pct); // drafting hrs default = same equation
  const pmAuto = draft.pmAuto !== false;
  const drfAuto = draft.drfAuto !== false;
  const pmHrs = pmAuto ? pmAutoHrs : Math.max(0, parseFloat(draft.pmHrs) || 0);
  const drfHrs = drfAuto ? drfAutoHrs : Math.max(0, parseFloat(draft.drfHrs) || 0);
  const shopHrs = Math.max(0, parseFloat(draft.shopHrs) || 0); // in-house (fab) hrs — manual
  const shopCost = pmHrs * rate("SHP-PM") + shopHrs * rate("SHP-IN") + drfHrs * rate("DRF-SUB");
  const misc = Math.max(0, parseFloat(draft.misc) || 0);
  const totalCost = mobCost + shopCost + misc;
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
    totalCost,
    margin,
    totalPrice,
  };
}

/** h/m label — local copy of Geo.fmtTime (lib/geo is server-only). */
export function fmtTime(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return m + "m";
  return m ? h + "h " + m + "m" : h + "h";
}
