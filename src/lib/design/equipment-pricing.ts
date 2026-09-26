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
  scaleSets,
  type AState,
  type BomItem,
  type ComputeResult,
  type DrapeGeom,
  type SystemBlock,
  type TierDefs,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import { sellFromCost, type EquipmentPriceTable, type UnitPrice } from "./equipment-map";

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
