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

/**
 * The server's own needs-a-part count for a saved (or about-to-be-saved)
 * Quick Design record (#GEM D-GEM-19): hydrate its config (or reconstruct a
 * pre-config seed record from its display fields), run the equations and
 * price the chosen tier from the Equipment map. The client's `incomplete`
 * is never read. Uses tierDefsDefault() — the per-browser line-sets dial
 * only rescales rigging quantities, and the server never sees it (as
 * D-GEM-5's Grid targets). A config that won't compute counts as 1 (never
 * promotable) rather than throwing.
 */
export function quickDesignNeedsPart(
  d: DesignRecordLike,
  table: EquipmentPriceTable,
  fixturePrices: Record<string, UnitPrice>
): number {
  try {
    const s = hydrateAState(d, 0);
    const tier = TIER_KEYS.includes(s.tier) ? s.tier : "better";
    const systems = tierSystems(compute(s), s, tier, tierDefsDefault(), table, fixtureOverridesFor(s.fixtureAssemblies, fixturePrices));
    return needsPartCount(systems);
  } catch {
    return 1;
  }
}
