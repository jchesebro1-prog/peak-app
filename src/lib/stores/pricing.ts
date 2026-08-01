import { getBlob, setBlob } from "@/db/doc-store";

/**
 * PricingRules — server port of app/pricing.js: the single master registry of
 * every estimating equation & rate in the app (General → Estimating Rules).
 *
 * Two kinds of entry:
 *   • rate    — an editable number (labor $/hr, margin %, freight %,
 *               tier multiplier, mileage rate…).
 *   • formula — a documented calculation (read-only reference), so the list
 *               shows HOW numbers combine, not just the knobs.
 *
 * Storage (blobs replace the prototype's localStorage keys):
 *   • Flame-test rates proxy to blob `flametest_rates` (rss_flametest_rates_v1),
 *     repair rates to blob `repair_rates` (rss_repair_rates_v1), inspection
 *     rates to blob `inspection_rates`, travel/mileage fallback rates to blob
 *     `travel_rates`, catalog margin to blob `catalog_rates`, and Estimator
 *     fixture add-on rates to blob `fixture_rates` — editing any of these here
 *     is LIVE: the engines/screens read the same blobs, so quotes reprice
 *     immediately.
 *   • All other editable rates persist to blob `pricing_rules`
 *     (rss_pricing_rules_v1) and are the canonical defaults. Quick Design
 *     reads its install / freight / contingency defaults from here (see num()).
 *
 * Server deltas: the `rss-pricing` window event and the DOM download() helper
 * are dropped (screens re-read per request; a route can serve exportCSV /
 * exportJSON with exportFileName). Registration (register/addRate/addFormula)
 * mutates the per-process registry, same as the prototype's window registry.
 */

/* ---------- live engine rate defaults ---------- */

export type FlametestRates = {
  /** $/mile — federal (IRS) standard mileage rate at time of estimate */
  mileageRate: number;
  /** $/hour — testing & travel labor */
  laborRate: number;
  /** minutes to test one curtain */
  curtainMinutes: number;
  /** $ minimum for the whole job (after mileage + travel + testing) */
  baseFee: number;
  /** 30 points, margin of the sell price */
  margin: number;
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
};

/** flametest.js DEFAULTS — seed/fallback for blob `flametest_rates`. */
export const FLAMETEST_RATE_DEFAULTS: FlametestRates = {
  mileageRate: 0.70,
  laborRate: 30,
  curtainMinutes: 5,
  baseFee: 150,
  margin: 0.30,
  travelRoundMin: 15,
};

export type RepairRates = {
  /** $/hour — skilled rigging / repair labor */
  laborRate: number;
  /** $/mile — federal standard mileage rate */
  mileageRate: number;
  /** $ minimum service call (floor on the service sell, before parts) */
  minCallout: number;
  /** 30 points on parts (sell = cost / (1 - partsMargin)) */
  partsMargin: number;
  /** 30 points on labor + travel */
  margin: number;
  /** labor-rate multiplier for emergency / after-hours work */
  emergencyMult: number;
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
};

/** repair.js DEFAULTS — seed/fallback for blob `repair_rates`. */
export const REPAIR_RATE_DEFAULTS: RepairRates = {
  laborRate: 95,
  mileageRate: 0.70,
  minCallout: 350,
  partsMargin: 0.30,
  margin: 0.30,
  emergencyMult: 1.5,
  travelRoundMin: 15,
};

export type InspectionRates = {
  /** $/hour — rigging-inspection labor */
  laborRate: number;
  /** $/mile — federal standard mileage rate */
  mileageRate: number;
  /** minutes to inspect one line set (Level 1 visual pass) */
  lineSetMinutes: number;
  /** fixed on-site hours per visit (setup, walkthrough, findings write-up) */
  baseHours: number;
  /** inspection-time multiplier for a Level 2 (5-year in-depth) inspection */
  level2Mult: number;
  /** $ minimum for the whole job */
  minFee: number;
  /** 30 points, margin of the sell price */
  margin: number;
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
};

/** Inspection estimating defaults — seed/fallback for blob `inspection_rates`.
 *  New under IDEAS #44 (no prototype engine existed); numbers are placeholders
 *  editable in Estimating Rules, same as every other rate. */
export const INSPECTION_RATE_DEFAULTS: InspectionRates = {
  laborRate: 95,
  mileageRate: 0.70,
  lineSetMinutes: 15,
  baseHours: 2,
  level2Mult: 1.75,
  minFee: 650,
  margin: 0.30,
  travelRoundMin: 15,
};

export type TravelRates = {
  /** Straight-line → on-road distance fudge (offline fallback only). */
  roadFactor: number;
  /** Assumed average door-to-door driving speed, mph (offline fallback only). */
  mph: number;
};

/** geo.js / flametest-engine.js DEFAULTS — seed/fallback for blob `travel_rates`.
 *  Live OSRM road routing overrides these when available; offline (or when a
 *  route hasn't been cached yet) these are the fallback used to turn
 *  straight-line distance into an estimated road distance / drive time. */
export const TRAVEL_RATE_DEFAULTS: TravelRates = {
  roadFactor: 1.25,
  mph: 50,
};

export type CatalogRates = {
  /** Default markup for a catalog part with no list price (fraction, 0.30 = 30%). */
  defaultMargin: number;
};

/** Catalog margin DEFAULTS — seed/fallback for blob `catalog_rates`. */
export const CATALOG_RATE_DEFAULTS: CatalogRates = {
  defaultMargin: 0.30,
};

export type FixtureRates = {
  mountCclamp: number;
  mountHalfCoupler: number;
  mountFloorBase: number;
  mountTruss: number;
  accColorFrame: number;
  accGel: number;
  accGobo: number;
  accBarnDoor: number;
  accTopHat: number;
  accSafety: number;
  pwrEdison: number;
  pwrTwistLock: number;
  pwrSoca: number;
  dataDMX: number;
  pwrDimmer: number;
  lamp575: number;
  lamp750: number;
  lamp1000: number;
  /** When a fixture is entered manually, cost = unit price × this. */
  customCostFactor: number;
};

/** Estimator fixture-configurator add-on PRICE defaults — seed/fallback for
 *  blob `fixture_rates`. This is the single source of truth for add-on
 *  price; estimator-data.ts's fixMounts()/fixAcc()/fixPwr()/fixLamps() read
 *  the live values from here and keep only the (non-editable-here) cost side. */
export const FIXTURE_RATE_DEFAULTS: FixtureRates = {
  mountCclamp: 18,
  mountHalfCoupler: 24,
  mountFloorBase: 45,
  mountTruss: 32,
  accColorFrame: 14,
  accGel: 9,
  accGobo: 34,
  accBarnDoor: 58,
  accTopHat: 26,
  accSafety: 12,
  pwrEdison: 22,
  pwrTwistLock: 34,
  pwrSoca: 78,
  dataDMX: 26,
  pwrDimmer: 55,
  lamp575: 22,
  lamp750: 26,
  lamp1000: 34,
  customCostFactor: 0.66,
};

export const FLAMETEST_RATES_BLOB = "flametest_rates";
export const REPAIR_RATES_BLOB = "repair_rates";
export const INSPECTION_RATES_BLOB = "inspection_rates";
export const TRAVEL_RATES_BLOB = "travel_rates";
export const CATALOG_RATES_BLOB = "catalog_rates";
export const FIXTURE_RATES_BLOB = "fixture_rates";
/** General editable rates — replaces rss_pricing_rules_v1. */
const PRICING_RULES_BLOB = "pricing_rules";

/* ---------- engine rate accessors (getRates/setRates of the prototype engines) ---------- */

export async function getFlametestRates(): Promise<FlametestRates> {
  return getBlob(FLAMETEST_RATES_BLOB, { ...FLAMETEST_RATE_DEFAULTS });
}

export async function setFlametestRates(
  patch: Partial<FlametestRates>
): Promise<void> {
  await setBlob(FLAMETEST_RATES_BLOB, patch);
}

export async function getRepairRates(): Promise<RepairRates> {
  return getBlob(REPAIR_RATES_BLOB, { ...REPAIR_RATE_DEFAULTS });
}

export async function setRepairRates(
  patch: Partial<RepairRates>
): Promise<void> {
  await setBlob(REPAIR_RATES_BLOB, patch);
}

export async function getInspectionRates(): Promise<InspectionRates> {
  return getBlob(INSPECTION_RATES_BLOB, { ...INSPECTION_RATE_DEFAULTS });
}

export async function setInspectionRates(
  patch: Partial<InspectionRates>
): Promise<void> {
  await setBlob(INSPECTION_RATES_BLOB, patch);
}

export async function getTravelRates(): Promise<TravelRates> {
  return getBlob(TRAVEL_RATES_BLOB, { ...TRAVEL_RATE_DEFAULTS });
}

export async function setTravelRates(
  patch: Partial<TravelRates>
): Promise<void> {
  await setBlob(TRAVEL_RATES_BLOB, patch);
}

export async function getCatalogRates(): Promise<CatalogRates> {
  return getBlob(CATALOG_RATES_BLOB, { ...CATALOG_RATE_DEFAULTS });
}

export async function setCatalogRates(
  patch: Partial<CatalogRates>
): Promise<void> {
  await setBlob(CATALOG_RATES_BLOB, patch);
}

export async function getFixtureRates(): Promise<FixtureRates> {
  return getBlob(FIXTURE_RATES_BLOB, { ...FIXTURE_RATE_DEFAULTS });
}

export async function setFixtureRates(
  patch: Partial<FixtureRates>
): Promise<void> {
  await setBlob(FIXTURE_RATES_BLOB, patch);
}

/* ---------- registry entry types & builders ---------- */

export type RateStore =
  | "general"
  | "flame"
  | "repair"
  | "inspection"
  | "travel"
  | "catalog"
  | "fixture";

export type RateEntry = {
  kind: "rate";
  id: string;
  label: string;
  /** Default value (display units — % rates store def as the percent number). */
  def: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Which store holds the live value; 'flame'/'repair' proxy to the engine blobs. */
  store: RateStore;
  /** Key inside the engine blob (defaults to id). */
  key: string;
  /** True when the engine stores a fraction (0.30) but the UI shows percent (30). */
  pctStored: boolean;
  /** Documented reference only — lives in estimating code, not wired to storage. */
  ref: boolean;
  help: string;
};

export type FormulaEntry = {
  kind: "formula";
  id: string;
  label: string;
  expr: string;
  help: string;
};

export type PricingEntry = RateEntry | FormulaEntry;

export type PricingGroup = {
  key: string;
  label: string;
  live: boolean;
  sub: string;
  note: string;
  items: PricingEntry[];
};

export type RateOptions = {
  min?: number;
  max?: number;
  step?: number;
  store?: RateStore;
  key?: string;
  pctStored?: boolean;
  ref?: boolean;
  help?: string;
};

export function rate(
  id: string,
  label: string,
  def: number,
  unit?: string,
  o: RateOptions = {}
): RateEntry {
  return {
    kind: "rate",
    id,
    label,
    def,
    unit: unit || "",
    min: o.min != null ? o.min : 0,
    max: o.max != null ? o.max : 100,
    step: o.step != null ? o.step : 1,
    store: o.store || "general",
    key: o.key || id,
    pctStored: !!o.pctStored,
    ref: !!o.ref,
    help: o.help || "",
  };
}

export function formula(
  id: string,
  label: string,
  expr: string,
  help?: string
): FormulaEntry {
  return { kind: "formula", id, label, expr, help: help || "" };
}

/* ---------- the master registry (ported verbatim from pricing.js) ---------- */

export const GROUPS: PricingGroup[] = [
  {
    key: "system", label: "System design", live: true,
    sub: "Quick Design budgetary roll-up + Estimator defaults",
    note: "Install / freight / contingency below drive the Quick Design estimate live. Tier multipliers, base margin and the fabric rate are the documented reference the estimators are built on.",
    items: [
      rate("system.installPct", "Installation & commissioning", 18, "%", { min: 0, max: 40, step: 1, help: "Install labor as a % of materials.  install = materials × this" }),
      rate("system.freightPct", "Freight & delivery", 5, "%", { min: 0, max: 20, step: 0.5, help: "freight = materials × this" }),
      rate("system.contingencyPct", "Default contingency", 10, "%", { min: 0, max: 25, step: 1, help: "Applied to materials + install + freight. New designs start at this value." }),
      rate("system.baseMargin", "Base margin", 30, "%", { min: 0, max: 60, step: 1, ref: true, help: "Baseline margin baked into catalog list vs cost.  sell = cost ÷ (1 − margin)" }),
      rate("system.tierGoodCost", "Good tier — cost ×", 0.80, "×", { min: 0.3, max: 1.5, step: 0.01, ref: true, help: "Good multiplies each line’s cost by this." }),
      rate("system.tierGoodPrice", "Good tier — price ×", 0.84, "×", { min: 0.3, max: 1.5, step: 0.01, ref: true }),
      rate("system.tierBetterCost", "Better tier — cost ×", 1.00, "×", { min: 0.3, max: 2, step: 0.01, ref: true }),
      rate("system.tierBetterPrice", "Better tier — price ×", 1.00, "×", { min: 0.3, max: 2, step: 0.01, ref: true }),
      rate("system.tierBestCost", "Best tier — cost ×", 1.30, "×", { min: 0.5, max: 2.5, step: 0.01, ref: true }),
      rate("system.tierBestPrice", "Best tier — price ×", 1.42, "×", { min: 0.5, max: 2.5, step: 0.01, ref: true }),
      rate("system.curtainFabric", "Curtain fabric fallback", 3.00, "$/ft²", { min: 0, max: 20, step: 0.25, ref: true, help: "Used when a fabric SKU has no catalog rate." }),
      formula("system.rollup", "Budgetary total", "materials + install + freight, then + contingency  →  materials + (materials × install%) + (materials × freight%), × (1 + contingency%)"),
      formula("system.sell", "Sell price from cost", "sell = cost ÷ (1 − margin)"),
      formula("system.tier", "Good / Better / Best", "each line: cost × (tier cost ×), price × (tier price ×)"),
      formula("system.margin", "Blended margin", "margin = (materialsRevenue − materialsCost) ÷ materialsRevenue"),
      formula("system.estline", "Estimator line (detailed quotes)", "ext price = qty × unit price   ·   ext cost = qty × unit cost   ·   per-section margin 0–55%, freight 0–15% of materials"),
    ],
  },
  {
    key: "tiers", label: "Customer tiers", live: true,
    sub: "Per-customer margin — punch item 11 (D87). Tier lives on the PERSON, company is fallback.",
    note: "The resolved tier's margin SEEDS pricing everywhere (estimator labor & curtains, flame/repair/inspection quotes, Quick Design promotion, the portal) and is stamped onto each quote at creation — estimators can still override per quote. Not visible to customers. Resolution: quote's attn contact → their company → Base.",
    items: [
      rate("tiers.base", "Base margin", 30, "%", { min: 0, max: 60, step: 1, help: "The default tier — every customer without an assigned tier prices here.  sell = cost ÷ (1 − margin)" }),
      rate("tiers.copper", "Copper margin", 27, "%", { min: 0, max: 60, step: 1 }),
      rate("tiers.silver", "Silver margin", 22, "%", { min: 0, max: 60, step: 1 }),
      rate("tiers.gold", "Gold margin", 20, "%", { min: 0, max: 60, step: 1 }),
      rate("tiers.platinum", "Platinum margin", 15, "%", { min: 0, max: 60, step: 1 }),
      rate("tiers.reseller", "Reseller margin", 10, "%", { min: 0, max: 60, step: 1 }),
      rate("tiers.employee", "Employee margin", 5, "%", { min: 0, max: 60, step: 1 }),
      formula("tiers.resolution", "Tier resolution (design §4.7)", "quote's designated contact's tier  →  else their company's tier  →  else Base   ·   stamped on the quote at creation; each revision re-stamps at cut time"),
    ],
  },
  {
    key: "sizing", label: "Auto BOM & sizing", live: false,
    sub: "How Quick Design turns venue size into quantities — the equations built into the estimator",
    note: "Read-only reference (these live in the estimating code, not wired to the fields above). W = stage width, D = depth, G = grid height, PH = proscenium height (ft). clamp(x, lo, hi) keeps x within range.",
    items: [
      formula("size.mul", "Size preset → dimensions", "each dimension × size multiplier:   Small ×0.78   ·   Medium ×1.0   ·   Large ×1.28"),
      formula("size.linesets", "Line sets (battens)", "lineSets = clamp( round(D × 1.5), 12, 72 )"),
      formula("size.electrics", "Lighting electrics (pipes)", "electrics = clamp( round(D ÷ 12), 2, 5 )"),
      formula("size.drape", "Drape area", "drapeArea = W × G"),
      formula("size.dimmers", "Dimmer racks", "dimmerRacks = max( 1, ceil( conventional fixtures ÷ 48 ) )"),
      formula("size.array", "Line-array boxes & subwoofers", "boxes = clamp( round(W ÷ 3), 6, 24 )   ·   subs = clamp( round(W ÷ 12), 2, 8 )"),
      formula("rig.cw", "Rigging — counterweight, per line set", "headblock · footblock · arbor · T-bar track · lock rail = 1 each   ·   handline = 2 × G   ·   batten pipe = W   ·   loftblocks = floor(W ÷ 10)   ·   cable = loftblocks × (2G + W)"),
      formula("rig.motor", "Rigging — motorized", "electric hoists = tier mix × max( 2, floor(D ÷ 30) )"),
      formula("rig.dead", "Rigging — dead-hung", "sets = (5–7 by tier) × depth factor   ·   rigging points = sets × floor(W ÷ 10)"),
      formula("curtain.cost", "Curtains — fabric cost", "cost = area × fabric $/ft²   ·   Draw area = (2W + 2) × PH   ·   Legs = 2 × (6 × PH)"),
      formula("light.fix", "Lighting — fixtures per position", "count = round( electrics × width unit × tier factor )"),
    ],
  },
  {
    key: "flame", label: "Flame-test pricing", live: true,
    sub: "NFPA 705 annual flame testing",
    note: "Live — editing any rate here reprices every flame-test quote immediately (shared with the flame-test engine).",
    items: [
      rate("mileageRate", "Mileage rate", 0.70, "$/mi", { min: 0, max: 2, step: 0.01, store: "flame", help: "Round-trip miles from the nearest office, shared across venues on one trip." }),
      rate("laborRate", "Labor rate (testing & travel)", 30, "$/hr", { min: 0, max: 200, step: 1, store: "flame" }),
      rate("curtainMinutes", "Minutes to test one curtain", 5, "min", { min: 1, max: 30, step: 1, store: "flame" }),
      rate("baseFee", "Base minimum (whole job)", 150, "$", { min: 0, max: 1000, step: 5, store: "flame", help: "Floor on the whole job after mileage + travel + testing." }),
      rate("margin", "Flame-test margin", 30, "%", { min: 0, max: 60, step: 1, store: "flame", pctStored: true }),
      rate("travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "flame" }),
      formula("flame.total", "Flame-test total", "max( $base ,  miles × mileageRate  +  travelHrs × laborRate  +  curtains × curtainMin × (laborRate ÷ 60) )  ÷  (1 − margin)"),
    ],
  },
  {
    key: "repair", label: "Repair pricing", live: true,
    sub: "Rigging / curtain / motor repair & service calls",
    note: "Live — editing any rate here reprices every repair quote immediately (shared with the repair estimating engine).",
    items: [
      rate("repair.laborRate", "Labor rate (repair & service)", 95, "$/hr", { min: 0, max: 300, step: 1, store: "repair", key: "laborRate" }),
      rate("repair.mileageRate", "Mileage rate", 0.70, "$/mi", { min: 0, max: 2, step: 0.01, store: "repair", key: "mileageRate", help: "Round-trip miles from the nearest office, shared across venues on one trip." }),
      rate("repair.minCallout", "Minimum service call", 350, "$", { min: 0, max: 2000, step: 5, store: "repair", key: "minCallout", help: "Floor on the service sell (labor + travel), before parts." }),
      rate("repair.partsMargin", "Parts margin", 30, "%", { min: 0, max: 60, step: 1, store: "repair", key: "partsMargin", pctStored: true, help: "Markup on parts.  partsSell = partsCost ÷ (1 − partsMargin)" }),
      rate("repair.margin", "Repair margin (labor + travel)", 30, "%", { min: 0, max: 60, step: 1, store: "repair", key: "margin", pctStored: true }),
      rate("repair.emergencyMult", "Emergency / after-hours ×", 1.5, "×", { min: 1, max: 3, step: 0.05, store: "repair", key: "emergencyMult", help: "Multiplies the labor rate for emergency or after-hours work." }),
      rate("repair.travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "repair", key: "travelRoundMin" }),
      formula("repair.total", "Repair total", "max( $callout ,  (laborHrs × laborRate  +  miles × mileageRate  +  travelHrs × laborRate)  ÷  (1 − margin) )  +  parts ÷ (1 − partsMargin)"),
    ],
  },
  {
    key: "inspection", label: "Inspection pricing", live: true,
    sub: "Rigging inspections — Level 1 annual · Level 2 every 5 years",
    note: "Live — editing any rate here reprices every inspection quote immediately (shared with the inspection estimating engine). Placeholder numbers — adjust as pricing firms up.",
    items: [
      rate("inspection.laborRate", "Labor rate (inspection & travel)", 95, "$/hr", { min: 0, max: 300, step: 1, store: "inspection", key: "laborRate" }),
      rate("inspection.mileageRate", "Mileage rate", 0.70, "$/mi", { min: 0, max: 2, step: 0.01, store: "inspection", key: "mileageRate", help: "Round-trip miles from the nearest office, shared across venues on one trip." }),
      rate("inspection.lineSetMinutes", "Minutes to inspect one line set", 15, "min", { min: 1, max: 120, step: 1, store: "inspection", key: "lineSetMinutes", help: "Level 1 visual pass, per line set — covers the full component walkthrough." }),
      rate("inspection.baseHours", "Base on-site hours (per visit)", 2, "hr", { min: 0, max: 16, step: 0.5, store: "inspection", key: "baseHours", help: "Setup, venue walkthrough, and findings write-up — charged once per visit." }),
      rate("inspection.level2Mult", "Level 2 (5-year) ×", 1.75, "×", { min: 1, max: 4, step: 0.05, store: "inspection", key: "level2Mult", help: "Multiplies inspection time for the in-depth 5-year inspection." }),
      rate("inspection.minFee", "Minimum inspection fee", 650, "$", { min: 0, max: 5000, step: 25, store: "inspection", key: "minFee", help: "Floor on the whole job after labor + travel." }),
      rate("inspection.margin", "Inspection margin", 30, "%", { min: 0, max: 60, step: 1, store: "inspection", key: "margin", pctStored: true }),
      rate("inspection.travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "inspection", key: "travelRoundMin" }),
      formula("inspection.hours", "Inspection hours", "hours = ( baseHours + lineSets × lineSetMin ÷ 60 ) × (level 2 ? level2× : 1)"),
      formula("inspection.total", "Inspection total", "max( $minimum ,  (hours × laborRate  +  miles × mileageRate  +  travelHrs × laborRate)  ÷  (1 − margin) )"),
    ],
  },
  {
    key: "travel", label: "Travel & mileage", live: true,
    sub: "Distance / drive-time estimate (feeds flame-test + any travel line)",
    note: "Live — feeds the flame-test travel estimate's offline fallback. Live road routing (OSRM) still overrides these when a cached/live route is available; these are only used for the straight-line fallback.",
    items: [
      rate("travel.roadFactor", "Straight-line → road factor", 1.25, "×", { min: 1, max: 2, step: 0.05, store: "travel", key: "roadFactor", help: "Bumps as-the-crow-flies distance up to road distance." }),
      rate("travel.mph", "Assumed average speed", 50, "mph", { min: 20, max: 75, step: 1, store: "travel", key: "mph" }),
      formula("travel.miles", "Estimated road miles", "miles = straightLineMiles × roadFactor"),
      formula("travel.time", "Estimated drive time", "minutes = (miles ÷ mph) × 60"),
    ],
  },
  {
    key: "catalog", label: "Catalog margin", live: false,
    sub: "Parts & price books",
    // NOT marked live on purpose (Claude, 2026-08-01). The value IS persisted to
    // blob `catalog_rates` — the wiring is done, so this becomes live in one word
    // — but NOTHING in the codebase reads it yet: a part with no list price is
    // filtered out, never defaulted through this margin. Tagging the row "live"
    // would tell the user that editing it reprices something, which is false: the
    // same UI-claims-what-isn't-true problem as punch #70 and #14. Flip `live` and
    // drop `ref` in the same breath as adding the first real consumer.
    note: "Reference — the value is saved, but no pricing path consumes it yet: a part with no list price is skipped rather than defaulted through this margin. Per-part list vs. cost is maintained in the Catalog.",
    items: [
      rate("catalog.defaultMargin", "Default part margin", 30, "%", { min: 0, max: 60, step: 1, store: "catalog", key: "defaultMargin", pctStored: true, ref: true }),
      formula("catalog.list", "List price from cost", "list = cost ÷ (1 − margin)"),
    ],
  },
  {
    key: "fixture", label: "Lighting fixtures", live: true,
    sub: "Estimator → Configure fixture pop-out",
    note: "Live — editing a rate here reprices the Estimator's fixture configurator immediately (shared with estimator-data.ts's fixMounts()/fixAcc()/fixPwr()/fixLamps(), which source PRICE from this store). Each fixture adds one combined priced line; hang/focus labor is left to Configure labor. Cost (for margin) isn't editable here — it stays in the estimator's fixture tables. Placeholder add-on rates — swap for real numbers as pricing firms up.",
    items: [
      rate("fixture.mountCclamp", "Mount — C-clamp", 18, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "mountCclamp" }),
      rate("fixture.mountHalfCoupler", "Mount — half-coupler", 24, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "mountHalfCoupler" }),
      rate("fixture.mountFloorBase", "Mount — floor base", 45, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "mountFloorBase" }),
      rate("fixture.mountTruss", "Mount — truss", 32, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "mountTruss" }),
      rate("fixture.accColorFrame", "Accessory — color frame", 14, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "accColorFrame" }),
      rate("fixture.accGel", "Accessory — gel / media", 9, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "accGel" }),
      rate("fixture.accGobo", "Accessory — gobo", 34, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "accGobo" }),
      rate("fixture.accBarnDoor", "Accessory — barn door", 58, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "accBarnDoor" }),
      rate("fixture.accTopHat", "Accessory — top hat", 26, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "accTopHat" }),
      rate("fixture.accSafety", "Accessory — safety cable", 12, "$", { min: 0, max: 100, step: 1, store: "fixture", key: "accSafety" }),
      rate("fixture.pwrEdison", "Power — edison cable", 22, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "pwrEdison" }),
      rate("fixture.pwrTwistLock", "Power — twist-lock cable", 34, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "pwrTwistLock" }),
      rate("fixture.pwrSoca", "Power — soca / multicable", 78, "$", { min: 0, max: 500, step: 1, store: "fixture", key: "pwrSoca" }),
      rate("fixture.dataDMX", "Data — DMX cable", 26, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "dataDMX" }),
      rate("fixture.pwrDimmer", "Power — dimmer / relay channel", 55, "$", { min: 0, max: 400, step: 1, store: "fixture", key: "pwrDimmer" }),
      rate("fixture.lamp575", "Lamp — 575W HPL", 22, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "lamp575" }),
      rate("fixture.lamp750", "Lamp — 750W HPL", 26, "$", { min: 0, max: 200, step: 1, store: "fixture", key: "lamp750" }),
      rate("fixture.lamp1000", "Lamp — 1000W", 34, "$", { min: 0, max: 300, step: 1, store: "fixture", key: "lamp1000" }),
      rate("fixture.customCostFactor", "Manual entry — cost basis", 0.66, "×", { min: 0.3, max: 1, step: 0.01, store: "fixture", key: "customCostFactor", help: "When a fixture is entered manually, cost = unit price × this." }),
      formula("fixture.unit", "Fixture unit price", "unit = fixtureList (or manual) + mounting + Σ accessories + Σ power/data + lamp"),
      formula("fixture.line", "Fixture line (one combined line)", "ext = unit × qty   ·   cost/ea = fixtureCost + add-on costs   ·   hang/focus labor left to Configure labor"),
    ],
  },
];

let BY_ID: Record<string, PricingEntry> = {};
function reindex(): void {
  BY_ID = {};
  for (const g of GROUPS) for (const it of g.items) BY_ID[it.id] = it;
}
reindex();

/* ---------- engine-backed stores (rates proxied to a pricing engine's own blob, so editing is LIVE) ---------- */

type EngineStore = "flame" | "repair" | "inspection" | "travel" | "catalog" | "fixture";

const ENGINE_BLOBS: Record<EngineStore, [string, Record<string, number>]> = {
  flame: [FLAMETEST_RATES_BLOB, FLAMETEST_RATE_DEFAULTS],
  repair: [REPAIR_RATES_BLOB, REPAIR_RATE_DEFAULTS],
  inspection: [INSPECTION_RATES_BLOB, INSPECTION_RATE_DEFAULTS],
  travel: [TRAVEL_RATES_BLOB, TRAVEL_RATE_DEFAULTS],
  catalog: [CATALOG_RATES_BLOB, CATALOG_RATE_DEFAULTS],
  fixture: [FIXTURE_RATES_BLOB, FIXTURE_RATE_DEFAULTS],
};

async function engineGet(store: EngineStore): Promise<Record<string, number>> {
  const [blob, defaults] = ENGINE_BLOBS[store];
  return getBlob(blob, { ...defaults });
}

async function engineSet(
  store: EngineStore,
  patch: Record<string, number>
): Promise<void> {
  await setBlob(ENGINE_BLOBS[store][0], patch);
}

/* ---------- value get / set ---------- */

export async function value(
  item: PricingEntry | string
): Promise<number | null> {
  const it = typeof item === "string" ? BY_ID[item] : item;
  if (!it || it.kind !== "rate") return null;
  if (it.store !== "general") {
    const r = await engineGet(it.store);
    let v: number | undefined = r[it.key || it.id];
    if (v == null) v = it.pctStored ? it.def / 100 : it.def;
    return it.pctStored ? Math.round(v * 1000) / 10 : v;
  }
  const g = await getBlob<Record<string, number | null>>(PRICING_RULES_BLOB, {});
  const gv = g[it.id];
  return gv == null ? it.def : gv;
}

export async function setValue(
  item: PricingEntry | string,
  val: number | string
): Promise<void> {
  const it = typeof item === "string" ? BY_ID[item] : item;
  if (!it || it.kind !== "rate") return;
  let v = typeof val === "number" ? val : parseFloat(val);
  if (isNaN(v)) return;
  v = Math.max(it.min, Math.min(it.max, v));
  if (it.store !== "general") {
    await engineSet(it.store, { [it.key || it.id]: it.pctStored ? v / 100 : v });
    return;
  }
  await setBlob(PRICING_RULES_BLOB, { [it.id]: v });
}

export async function isDefault(item: PricingEntry | string): Promise<boolean> {
  const it = typeof item === "string" ? BY_ID[item] : item;
  if (!it || it.kind !== "rate") return true;
  const v = await value(it);
  return v == null || Math.abs(v - it.def) < 1e-9;
}

export async function resetAll(): Promise<void> {
  // writeGeneral({}) in the prototype replaced the blob; setBlob merges, so
  // overrides are cleared by nulling every general rate key (value() treats
  // null as "no override" and falls back to def).
  const clear: Record<string, null> = {};
  for (const g of GROUPS)
    for (const it of g.items)
      if (it.kind === "rate" && it.store === "general") clear[it.id] = null;
  await setBlob(PRICING_RULES_BLOB, clear);
  await setBlob(FLAMETEST_RATES_BLOB, { ...FLAMETEST_RATE_DEFAULTS });
  await setBlob(REPAIR_RATES_BLOB, { ...REPAIR_RATE_DEFAULTS });
  await setBlob(INSPECTION_RATES_BLOB, { ...INSPECTION_RATE_DEFAULTS });
  await setBlob(TRAVEL_RATES_BLOB, { ...TRAVEL_RATE_DEFAULTS });
  await setBlob(CATALOG_RATES_BLOB, { ...CATALOG_RATE_DEFAULTS });
  await setBlob(FIXTURE_RATES_BLOB, { ...FIXTURE_RATE_DEFAULTS });
}

/** Read a general rate by id with fallback (Quick Design install/freight/contingency). */
export async function num(id: string, fb: number): Promise<number> {
  const it = BY_ID[id];
  if (!it) return fb;
  const v = await value(it);
  return v == null ? fb : v;
}

/** num() as a fraction: frac('system.installPct', 0.18) → 0.18 when default. */
export async function frac(id: string, fb?: number): Promise<number> {
  return (await num(id, fb != null ? fb * 100 : 0)) / 100;
}

/* ---------- export ---------- */

function csvCell(s: unknown): string {
  const str = s == null ? "" : String(s);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

export async function exportCSV(): Promise<string> {
  const lines = ["Area,Item,Type,Value,Unit,Detail"];
  for (const g of GROUPS) {
    for (const it of g.items) {
      if (it.kind === "rate")
        lines.push(
          [g.label, it.label, "Rate", await value(it), it.unit, it.help]
            .map(csvCell)
            .join(",")
        );
      else
        lines.push(
          [g.label, it.label, "Formula", "", "", it.expr].map(csvCell).join(",")
        );
    }
  }
  return lines.join("\n") + "\n";
}

export async function exportJSON(): Promise<string> {
  const out: {
    exportedAt: string;
    version: number;
    rates: Record<string, number | null>;
  } = { exportedAt: new Date().toISOString(), version: 1, rates: {} };
  for (const g of GROUPS)
    for (const it of g.items)
      if (it.kind === "rate") out.rates[it.id] = await value(it);
  return JSON.stringify(out, null, 2);
}

/** Download filename the prototype used: Peak_estimating_rules_YYYYMMDD.<ext>. */
export function exportFileName(ext: "csv" | "json"): string {
  const d = new Date();
  const p = (n: number): string => (n < 10 ? "0" + n : "" + n);
  return `Peak_estimating_rules_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${ext}`;
}

/* ---------- registration: keep the master list complete as estimating code grows ---------- */

function groupOf(key: string): PricingGroup | null {
  for (const g of GROUPS) if (g.key === key) return g;
  return null;
}

export type GroupDef = {
  key: string;
  label?: string;
  sub?: string;
  note?: string;
  live?: boolean;
};

export function defineGroup(def: GroupDef): PricingGroup {
  const existing = groupOf(def.key);
  if (existing) {
    if (def.label != null) existing.label = def.label;
    if (def.sub != null) existing.sub = def.sub;
    if (def.note != null) existing.note = def.note;
    if (def.live != null) existing.live = !!def.live;
    return existing;
  }
  const g: PricingGroup = {
    key: def.key,
    label: def.label || def.key,
    sub: def.sub || "",
    note: def.note || "",
    live: !!def.live,
    items: [],
  };
  GROUPS.push(g);
  return g;
}

export function register(
  groupKey: string,
  entry: PricingEntry
): PricingEntry | null {
  if (!entry || !entry.id) return null;
  const g = groupOf(groupKey) || defineGroup({ key: groupKey, label: groupKey });
  const idx = g.items.findIndex((it) => it.id === entry.id);
  if (idx >= 0) g.items[idx] = entry;
  else g.items.push(entry);
  reindex();
  return entry;
}

export function addRate(
  groupKey: string,
  id: string,
  label: string,
  def: number,
  unit?: string,
  o?: RateOptions
): RateEntry {
  return register(groupKey, rate(id, label, def, unit, o)) as RateEntry;
}

export function addFormula(
  groupKey: string,
  id: string,
  label: string,
  expr: string,
  help?: string
): FormulaEntry {
  return register(groupKey, formula(id, label, expr, help)) as FormulaEntry;
}
