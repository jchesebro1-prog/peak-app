/**
 * Virtual parts (#211, D306) — pure. Auto places assemblies and confirmed
 * allowances as ORDINARY placements whose partId is a virtual id:
 *   asm:<fixtureId>          a fixture or System assembly (#210)
 *   allow:<rowKey>:<tier>    a confirmed Equipment map allowance
 * The server resolves each id LIVE into a PartLite (desc, unit, list = sell,
 * cost, scope) appended to the page's parts, so the BOM, space rollups, riser,
 * schedule, drawing set and quote price and label them with no second code
 * path. `virtual` keeps them out of the device palette; `allowance` flags the
 * line internally (its desc is the row's plain label — customer text stays
 * normal, D315). A virtual part with nothing real behind it — a deleted
 * assembly, an assembly with no priced member, an allowance no longer
 * confirmed — prices $0, says why in its desc and carries `virtualDead`: the
 * quote refuses it by name and the editor says "needs a part" (D313).
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { PartLite } from "./grid-bom";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { cellFor, isTierKey, sellFromCost, type EquipmentMap, type EquipPriceCtx } from "./equipment-map";
import { GRID_SCOPE_OF_SYS, UNSCOPED, type GridLayer } from "./grid-scopes";
import { resolveFixture, type FixtureCatalogPart, type FixtureResolvable } from "@/lib/fixture-assemblies";

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
      // Dead: deleted, or not one included member resolves to a cost or a sell.
      const dead = !r || !(r.cost > 0 || r.sell > 0);
      const cost = dead ? 0 : r.cost;
      out.push({
        id,
        sku: ref.id,
        desc: !f ? `${ref.id} (assembly deleted)` : dead ? `${f.label} (assembly has no priced parts)` : f.label,
        category: "Assembly",
        unit: "ea",
        list: dead ? 0 : r.sell > 0 ? r.sell : sellFromCost(cost, ctx.margin),
        cost,
        gridScope: f?.kind === "system" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : "Lighting",
        kind: "device",
        virtual: true,
        ...(dead ? { virtualDead: true as const } : {}),
      });
      continue;
    }
    const def = EQUIPMENT_ROW_BY_KEY.get(ref.rowKey)!;
    const cell = cellFor(map[ref.rowKey], ref.tier);
    const amount = cell?.kind === "allowance" && cell.amount > 0 ? cell.amount : 0;
    out.push({
      id,
      sku: "ALLOWANCE",
      desc: amount > 0 ? def.label : `${def.label} (allowance no longer confirmed)`,
      category: "Allowance",
      unit: def.unit,
      list: amount > 0 ? sellFromCost(amount, ctx.margin) : 0,
      cost: amount,
      gridScope: GRID_SCOPE_OF_SYS[def.system] ?? UNSCOPED,
      kind: "device",
      virtual: true,
      allowance: true,
      ...(amount > 0 ? {} : { virtualDead: true as const }),
    });
  }
  return out;
}

/**
 * A Grid quote's flat `spec.lines` → bid-spec BOM rows (#211 fix wave 1, M4,
 * D316), pure. The bid spec specifies products, so:
 *  - allowance lines (flagged, or an `allow:` sku on an older quote) are
 *    left out, as the estimator path leaves out its allowance/labor lines;
 *  - an `asm:` line is expanded into its assembly's included members (SKU,
 *    "member (assembly label)", line qty × member qty), which match the
 *    catalog like any part. An assembly that no longer resolves stays one
 *    row under its quoted description, for the person to map or waive.
 * Every other line passes through unchanged.
 */
export function gridSpecBomRows(
  lines: ReadonlyArray<{ sku?: string; desc?: string; qty?: number; allowance?: boolean }>,
  fixtureOf: (id: string) => FixtureResolvable | null | undefined
): Array<{ sku: string; desc: string; qty: number }> {
  const rows: Array<{ sku: string; desc: string; qty: number }> = [];
  for (const l of lines) {
    const sku = String(l.sku || "").trim();
    const desc = String(l.desc || "").trim();
    const qty = Number(l.qty) || 0;
    if (l.allowance || sku.startsWith(ALLOWANCE_PART_PREFIX)) continue;
    const ref = sku ? parseVirtualPartId(sku) : null;
    if (ref?.kind === "assembly") {
      const f = fixtureOf(ref.id);
      const members = f ? resolveFixture(f, new Map<string, FixtureCatalogPart>()).parts.filter((m) => m.included && m.sku) : [];
      if (f && members.length) {
        for (const m of members) rows.push({ sku: m.sku, desc: `${m.label} (${f.label})`, qty: qty * m.qty });
        continue;
      }
      rows.push({ sku: "", desc: desc || f?.label || ref.id, qty });
      continue;
    }
    if (!sku && !desc) continue;
    rows.push({ sku, desc, qty });
  }
  return rows;
}
