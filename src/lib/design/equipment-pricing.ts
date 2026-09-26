/**
 * Equipment pricing (#GEM, D-GEM-4) — the estimate pipeline's ONLY pricing
 * step. compute() (quick/engine.ts) emits quantities; this prices every item
 * from the Equipment map's price table, or from a per-design override (a
 * Quick Design fixture pick, an Auto intake swap). A needs-a-part item stays
 * at $0 with status "needs-part" — never a fallback number.
 *
 * Cost-bearing (unit costs, curtain making rates): server code and the Quick
 * Design / Designs dashboard clients (already cost views) may import it. NO
 * Grid client file does — the #GEM T5 spec guard walks them.
 */
import { curtainCost, makingRateFor } from "./curtain-pricing";
import {
  applyOverrides,
  clamp,
  compute,
  hydrateAState,
  scaleSets,
  tierDefsDefault,
  tierTotals,
  TIERS,
  OVERRIDE_UNITS,
  type AState,
  type DesignRecordLike,
  type BomItem,
  type ComputeResult,
  type DrapeGeom,
  type SystemBlock,
  type TierDefs,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import { sellFromCost, type EquipmentPriceTable, type UnitPrice } from "./equipment-map";
import { needsPartCount } from "./scope-targets";

/** One drape's make-it cost at a fabric's area rate — the shared two-term model (curtain-pricing.ts). */
export function drapeUnitCost(drape: DrapeGeom, areaRate: number): number {
  return Math.round(
    curtainCost(
      { finishedWidthFt: drape.w, finishedHeightFt: drape.h, fullnessPct: drape.fullness, qty: drape.qty },
      { fabricRate: areaRate, makingRate: makingRateFor(drape.fullness) }
    ).costTotal
  );
}

type Priced = { cost: number; price: number; status: NonNullable<BomItem["status"]>; ref?: string; refDesc?: string };

function priceItem(it: BomItem, p: UnitPrice | undefined, margin: number): Priced {
  if (!p || p.status === "needs-part") return { cost: 0, price: 0, status: "needs-part" };
  // A drape costs per drape from the mapped fabric's area rate; a confirmed
  // allowance on a curtain row is already a per-drape unit cost.
  if (it.drape && p.status !== "allowance") {
    if (!(p.areaRate && p.areaRate > 0)) return { cost: 0, price: 0, status: "needs-part" };
    const cost = drapeUnitCost(it.drape, p.areaRate);
    return { cost, price: sellFromCost(cost, margin), status: p.status, ref: p.ref, refDesc: p.desc };
  }
  return { cost: p.unitCost, price: p.unitSell, status: p.status, ref: p.ref, refDesc: p.desc };
}

/** Price every item of every system at one tier. Every system comes back tierFixed (no global tier multiplier). */
export function applyEquipment(
  systems: SystemBlock[],
  tierKey: TierKey,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {}
): SystemBlock[] {
  const prices = table.byTier[tierKey] || {};
  return systems.map((sys) => {
    let rev = 0;
    let cost = 0;
    const items = sys.items.map((it) => {
      const r = priceItem(it, overrides[it.key] ?? prices[it.key], table.margin);
      rev += it.qty * r.price;
      cost += it.qty * r.cost;
      const next: BomItem = { ...it, cost: r.cost, price: r.price, status: r.status };
      if (r.ref) {
        next.ref = r.ref;
        next.refDesc = r.refDesc;
      } else {
        delete next.ref;
        delete next.refDesc;
      }
      return next;
    });
    return { ...sys, items, rev, cost, tierFixed: true };
  });
}

/** The BOM's base rows for a tier: line-set scaling → map pricing (no qty overrides). */
export function tierSystemsBase(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {}
): SystemBlock[] {
  return applyEquipment(scaleSets(C.systems, C, tierKey, tierDefs), tierKey, table, overrides);
}

/** The full per-tier pipeline: line-set scaling → map pricing → the tier's qty overrides. */
export function tierSystems(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {}
): SystemBlock[] {
  return applyOverrides(tierSystemsBase(C, s, tierKey, tierDefs, table, overrides), s, tierKey);
}

/**
 * Quick Design fixture picks (fixture type → fixture id) → per-row price
 * overrides (#GEM final review I3). `fixturePrices` is built on the SERVER
 * with priceCell({ kind: "assembly", id }) — the same resolver the Equipment
 * map prices an assembly cell with — so a pick sells at its included sell
 * (or cost ÷ (1 − margin) when list-less), and a pick that prices
 * needs-a-part STAYS needs-a-part. A pick with no entry at all (the assembly
 * was deleted) leaves the row on its map price.
 */
export function fixtureOverridesFor(
  picks: Record<string, string> | null | undefined,
  fixturePrices: Record<string, UnitPrice>
): Record<string, UnitPrice> {
  const out: Record<string, UnitPrice> = {};
  for (const [fixtureKey, id] of Object.entries(picks || {})) {
    const hit = id ? fixturePrices[id] : undefined;
    if (hit) out[`lighting:${fixtureKey}`] = hit;
  }
  return out;
}

const TIER_KEYS: readonly TierKey[] = ["good", "better", "best"];

/** The pricing-rule percentages a Quick Design total uses (Settings → system.*Pct). */
export type QuickRates = { installPct: number; freightPct: number; contingencyPct: number };

/** A Quick design's server-derived price (#GEM D-GEM-19/D-GEM-23). */
export type QuickDesignPrice = { needsPart: number; budget: number };

/** One tier's line-set count as the screen's dial accepts it (1–300, whole),
 *  or null — the rigging equation's own count — for anything else. */
export function lineSetsValue(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? clamp(Math.round(v), 1, 300) : null;
}

/**
 * The tier definitions a design prices with (D-GEM-23, fix wave 3): `base`
 * (the authored defaults on the server; this browser's own tier defs on the
 * screen) with the design's line-set counts (`config.tierSets`) laid over it.
 * A state with `tierSets` — every hydrated (saved) design — takes ALL THREE
 * counts from it (a missing / junk one = the equation's count), so a saved
 * design prices the same in every browser and on the server; only a brand-new
 * design (no `tierSets` yet) follows the browser's dial. It rescales rigging
 * QUANTITIES only; no price comes from the client.
 */
export function tierDefsFor(s: Pick<AState, "tierSets">, base: TierDefs = tierDefsDefault()): TierDefs {
  const td = JSON.parse(JSON.stringify(base)) as TierDefs;
  const sets = s.tierSets;
  if (sets && typeof sets === "object" && !Array.isArray(sets)) {
    for (const t of TIER_KEYS) td[t].sets = lineSetsValue((sets as Record<string, unknown>)[t]);
  }
  return td;
}

/**
 * Quick Design's live figure for its current state (#GEM fix wave 3) — the
 * same calls the screen's selected-tier total makes (map pricing on the
 * line-set-scaled BOM, the tier's qty overrides, tierTotals), in whole
 * dollars as the screen shows it. The parity specs hold this equal to
 * quickDesignPrice() of the record the screen saves.
 */
export function quickScreenPrice(
  a: AState,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  fixturePrices: Record<string, UnitPrice>,
  rates: QuickRates
): QuickDesignPrice {
  const tier = (a.tier || "better") as TierKey;
  const td = TIERS.find((t) => t.key === tier) || TIERS[1];
  const base = tierSystemsBase(compute(a), a, tier, tierDefs, table, fixtureOverridesFor(a.fixtureAssemblies, fixturePrices));
  const systems = applyOverrides(base, a, tier);
  const tot = tierTotals(systems, td, rates.installPct / 100, rates.freightPct / 100, (a.contingency ?? 0) / 100);
  return { needsPart: needsPartCount(systems), budget: Number.isFinite(tot.grand) ? Math.round(tot.grand) : 0 };
}

/** The `config` a Quick Design save sends: the whole live state, the line-set
 *  counts it priced with (D-GEM-23) and the override-units marker (D-GEM-24). */
export function quickSaveConfig(a: AState, tierDefs: TierDefs): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(a)) as Record<string, unknown>),
    tierSets: { good: tierDefs.good.sets, better: tierDefs.better.sets, best: tierDefs.best.sets },
    overrideUnits: { ...OVERRIDE_UNITS },
  };
}

/**
 * The server's own price for a saved (or about-to-be-saved) Quick Design
 * record (#GEM D-GEM-19, D-GEM-23): hydrate its config (or reconstruct a
 * pre-config seed record from its display fields), run the equations, price
 * the chosen tier from the Equipment map and total it exactly as the screen
 * does (tierTotals with the install / freight / contingency percentages).
 * Neither the client's `incomplete` nor its `budget` is ever read. A config
 * that won't compute counts as 1 needs-a-part line and $0 (never promotable)
 * rather than throwing.
 */
export function quickDesignPrice(
  d: DesignRecordLike,
  table: EquipmentPriceTable,
  fixturePrices: Record<string, UnitPrice>,
  rates: QuickRates
): QuickDesignPrice {
  try {
    // hydrateAState applies the screen's own clamps (contingency 0–25, qty
    // overrides whole ≥ 0, a known tier; the versioned Scenery-track
    // override, D-GEM-24) and tierDefsFor the dial's (line sets 1–300), so
    // this is the figure the screen shows for the same saved record.
    const s = hydrateAState(d, rates.contingencyPct);
    return quickScreenPrice(s, tierDefsFor(s), table, fixturePrices, rates);
  } catch {
    return { needsPart: 1, budget: 0 };
  }
}

/** The needs-a-part half of quickDesignPrice (D-GEM-19). */
export function quickDesignNeedsPart(
  d: DesignRecordLike,
  table: EquipmentPriceTable,
  fixturePrices: Record<string, UnitPrice>
): number {
  return quickDesignPrice(d, table, fixturePrices, { installPct: 0, freightPct: 0, contingencyPct: 0 }).needsPart;
}
