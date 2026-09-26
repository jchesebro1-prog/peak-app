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
  compute,
  hydrateAState,
  scaleSets,
  tierDefsDefault,
  tierTotals,
  TIERS,
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

/**
 * tierDefsDefault() with the design's own line-set counts (`config.tierSets`,
 * D-GEM-23) — the per-browser line-sets dial, snapshotted at save. It only
 * rescales rigging QUANTITIES (like qtyOverrides, which `config` already
 * carries); no price comes from the client.
 */
export function tierDefsFor(s: Pick<AState, "tierSets">): TierDefs {
  const td = tierDefsDefault();
  const sets = s.tierSets;
  if (sets && typeof sets === "object") {
    for (const t of TIER_KEYS) {
      const v = (sets as Record<string, unknown>)[t];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) td[t].sets = Math.min(Math.round(v), 999);
    }
  }
  return td;
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
    const s = hydrateAState(d, rates.contingencyPct);
    const tier = TIER_KEYS.includes(s.tier) ? s.tier : "better";
    const td = TIERS.find((t) => t.key === tier) || TIERS[1];
    const systems = tierSystems(compute(s), s, tier, tierDefsFor(s), table, fixtureOverridesFor(s.fixtureAssemblies, fixturePrices));
    const tot = tierTotals(systems, td, rates.installPct / 100, rates.freightPct / 100, (Number(s.contingency) || 0) / 100);
    // Whole dollars — what the screen shows (moneyRound) and what a quote stores.
    return { needsPart: needsPartCount(systems), budget: Number.isFinite(tot.grand) ? Math.round(tot.grand) : 0 };
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
