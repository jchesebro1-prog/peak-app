/**
 * Virtual parts (#211, D306) — pure. Auto places assemblies and confirmed
 * allowances as ORDINARY placements whose partId is a virtual id:
 *   asm:<fixtureId>          a fixture, System, Hardware or Rack assembly (#210, #228)
 *   allow:<rowKey>:<tier>    a confirmed Equipment map allowance
 * The server resolves each id LIVE into a PartLite (desc, unit, list = sell,
 * cost, scope) appended to the page's parts, so the BOM, space rollups, riser,
 * schedule, drawing set and quote price and label them with no second code
 * path. `virtual` keeps them out of the device palette; `allowance` flags the
 * line internally (its desc is the allowance's description, else the row's
 * plain label — customer text stays normal, D315, #212). A virtual part with
 * nothing real behind it — a deleted
 * assembly, an assembly with no priced member, an allowance no longer
 * confirmed — prices $0, says why in its desc and carries `virtualDead`: the
 * quote refuses it by name and the editor says "needs a part" (D313).
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { PartLite } from "./grid-bom";
import { EQUIPMENT_ROWS, EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { isLaborSku } from "./wire-labor";
import { EQUIP_TIERS, NOT_INCLUDED, cellFor, isTierKey, sellFromCost, type EquipmentMap, type EquipPriceCtx } from "./equipment-map";
import { GRID_SCOPE_OF_SYS, UNSCOPED, type GridLayer } from "./grid-scopes";
import { resolveFixture, type FixtureCatalogPart, type FixtureResolvable } from "@/lib/fixture-assemblies";
import { isInternalCategory } from "@/lib/portal-visibility";

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

/**
 * #228: a Hardware assembly has no scope of its own — it draws on the Grid
 * layer of the Equipment map row it is mapped on (the first such row in
 * vocabulary order, any tier; Controls / Acoustical / Pit → Unscoped). Not
 * mapped anywhere (swapped in on an Auto card, which offers hardware on
 * Rigging rows only) → Rigging.
 */
export function hardwareLayerFor(fixtureId: string, map: EquipmentMap): GridLayer {
  for (const def of EQUIPMENT_ROWS) {
    const row = map[def.key];
    if (!row) continue;
    for (const t of EQUIP_TIERS) {
      const c = cellFor(row, t);
      if (c?.kind === "assembly" && c.id === fixtureId) return GRID_SCOPE_OF_SYS[def.system] ?? UNSCOPED;
    }
  }
  return "Rigging";
}

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
        gridScope: f?.kind === "system" || f?.kind === "rack" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : f?.kind === "hardware" ? hardwareLayerFor(f.id, map) : "Lighting",
        kind: "device",
        virtual: true,
        ...(dead ? { virtualDead: true as const } : {}),
      });
      continue;
    }
    const def = EQUIPMENT_ROW_BY_KEY.get(ref.rowKey)!;
    const cell = cellFor(map[ref.rowKey], ref.tier);
    const amount = cell?.kind === "allowance" && cell.amount > 0 ? cell.amount : 0;
    // #212: the allowance's customer-facing description, else the row's label.
    const label = cell?.kind === "allowance" && cell.description ? cell.description : def.label;
    out.push({
      id,
      sku: "ALLOWANCE",
      // #229: a row since switched to Not included can't be re-confirmed —
      // the fix is a re-fill of this scope, which drops the line.
      desc:
        amount > 0
          ? label
          : cell?.kind === "none"
            ? `${label} (row is now ${NOT_INCLUDED} — re-fill this scope)`
            : `${label} (allowance no longer confirmed)`,
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
/**
 * `isInternal` for `gridSpecBomRows`, from catalog rows the caller already
 * holds: a SKU whose row's category is internal (Labor — `isInternalCategory`).
 */
export function internalSkuCheck(parts: Iterable<{ sku: string; category?: unknown }>): (sku: string) => boolean {
  const internal = new Set<string>();
  for (const p of parts) if (p && isInternalCategory(p.category)) internal.add(p.sku);
  return (sku) => internal.has(sku);
}

export function gridSpecBomRows(
  lines: ReadonlyArray<{ sku?: string; desc?: string; qty?: number; allowance?: boolean; specKey?: string }>,
  fixtureOf: (id: string) => FixtureResolvable | null | undefined,
  /** #296: a member SKU this flags (an internal catalog row — labor) is left out of an assembly's expansion. */
  isInternal?: (sku: string) => boolean
): Array<{ sku: string; desc: string; qty: number; specKey?: string }> {
  const rows: Array<{ sku: string; desc: string; qty: number; specKey?: string }> = [];
  for (const l of lines) {
    const sku = String(l.sku || "").trim();
    const desc = String(l.desc || "").trim();
    const qty = Number(l.qty) || 0;
    if (l.allowance || sku.startsWith(ALLOWANCE_PART_PREFIX)) continue;
    // #232: labor is a service line, not a product the spec can name.
    if (isLaborSku(sku)) continue;
    const ref = sku ? parseVirtualPartId(sku) : null;
    if (ref?.kind === "assembly") {
      const f = fixtureOf(ref.id);
      const members = f ? resolveFixture(f, new Map<string, FixtureCatalogPart>()).parts.filter((m) => m.included && m.sku) : [];
      if (f && members.length) {
        // #232 / #296: labor is a service line, not a product — a labor member (Grid labor id or an internal catalog row) is left out.
        for (const m of members) {
          if (isLaborSku(m.sku) || isInternal?.(m.sku)) continue;
          rows.push({ sku: m.sku, desc: `${m.label} (${f.label})`, qty: qty * m.qty });
        }
        continue;
      }
      rows.push({ sku: "", desc: desc || f?.label || ref.id, qty });
      continue;
    }
    if (!sku && !desc) continue;
    rows.push({ sku, desc, qty, ...(l.specKey ? { specKey: l.specKey } : {}) });
  }
  return rows;
}
