/**
 * Virtual parts (#GEM, D-GEM-6) — pure. Auto places assemblies and confirmed
 * allowances as ORDINARY placements whose partId is a virtual id:
 *   asm:<fixtureId>          a fixture or System assembly (#210)
 *   allow:<rowKey>:<tier>    a confirmed Equipment map allowance
 * The server resolves each id LIVE into a PartLite (desc, unit, list = sell,
 * cost, scope) appended to the page's parts, so the BOM, space rollups, riser,
 * schedule, drawing set and quote price and label them with no second code
 * path. `virtual` keeps them out of the device palette; `allowance` flags the
 * line internally. An allowance whose map cell is no longer a confirmed
 * allowance prices $0 and says so — never a stale dollar.
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { PartLite } from "./grid-bom";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { cellFor, isTierKey, sellFromCost, type EquipmentMap, type EquipPriceCtx } from "./equipment-map";
import { GRID_SCOPE_OF_SYS, UNSCOPED, type GridLayer } from "./grid-scopes";
import { resolveFixture } from "@/lib/fixture-assemblies";

export const ASSEMBLY_PART_PREFIX = "asm:";
export const ALLOWANCE_PART_PREFIX = "allow:";

export function assemblyPartId(fixtureId: string): string {
  return `${ASSEMBLY_PART_PREFIX}${fixtureId}`;
}

export function allowancePartId(rowKey: string, tier: TierKey): string {
  return `${ALLOWANCE_PART_PREFIX}${rowKey}:${tier}`;
}

export type VirtualRef = { kind: "assembly"; id: string } | { kind: "allowance"; rowKey: string; tier: TierKey };

export function parseVirtualPartId(partId: string): VirtualRef | null {
  if (partId.startsWith(ASSEMBLY_PART_PREFIX)) {
    const id = partId.slice(ASSEMBLY_PART_PREFIX.length);
    return id ? { kind: "assembly", id } : null;
  }
  if (partId.startsWith(ALLOWANCE_PART_PREFIX)) {
    const rest = partId.slice(ALLOWANCE_PART_PREFIX.length);
    const i = rest.lastIndexOf(":");
    if (i <= 0) return null;
    const rowKey = rest.slice(0, i);
    const tier = rest.slice(i + 1);
    return EQUIPMENT_ROW_BY_KEY.has(rowKey) && isTierKey(tier) ? { kind: "allowance", rowKey, tier } : null;
  }
  return null;
}

/** A System assembly's scope → the Grid layer it draws on (Controls / Acoustical / Pit / Other → Unscoped). */
const SYSTEM_SCOPE_LAYER: Record<string, GridLayer> = {
  Lighting: "Lighting",
  Rigging: "Rigging",
  Curtains: "Curtains",
  Audio: "Audio",
  Video: "Video",
};

export function virtualPartsFor(partIds: Iterable<string>, map: EquipmentMap, ctx: EquipPriceCtx): PartLite[] {
  const out: PartLite[] = [];
  const seen = new Set<string>();
  for (const id of partIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ref = parseVirtualPartId(id);
    if (!ref) continue;
    if (ref.kind === "assembly") {
      const f = ctx.fixtures.get(ref.id);
      const r = f ? resolveFixture(f, ctx.parts) : null;
      const cost = r?.cost ?? 0;
      out.push({
        id,
        sku: ref.id,
        desc: f ? f.label : `${ref.id} (assembly deleted — replace this device)`,
        category: "Assembly",
        unit: "ea",
        list: r ? (r.sell > 0 ? r.sell : cost > 0 ? sellFromCost(cost, ctx.margin) : 0) : 0,
        cost,
        gridScope: f?.kind === "system" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : "Lighting",
        kind: "device",
        virtual: true,
      });
      continue;
    }
    const def = EQUIPMENT_ROW_BY_KEY.get(ref.rowKey)!;
    const cell = cellFor(map[ref.rowKey], ref.tier);
    const amount = cell?.kind === "allowance" && cell.amount > 0 ? cell.amount : 0;
    out.push({
      id,
      sku: "ALLOWANCE",
      desc: amount > 0 ? `${def.label} (allowance)` : `${def.label} (allowance no longer confirmed — re-fill or replace)`,
      category: "Allowance",
      unit: def.unit,
      list: amount > 0 ? sellFromCost(amount, ctx.margin) : 0,
      cost: amount,
      gridScope: GRID_SCOPE_OF_SYS[def.system] ?? UNSCOPED,
      kind: "device",
      virtual: true,
      allowance: true,
    });
  }
  return out;
}
