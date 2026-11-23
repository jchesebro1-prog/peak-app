/**
 * Quote-line id helpers — pure. Moved out of the Grid's modules when the
 * Grid was removed: quotes the Grid made keep `asm:`, `allow:`, `custom:` and
 * `labor:` SKUs forever, so reports, review limits, client packages and rack
 * submittals must keep recognising them.
 *   asm:<fixtureId>          a fixture, System, Hardware or Rack assembly
 *   allow:<rowKey>:<tier>    an Equipment-map allowance (tier good | better | best)
 *   custom:<id>              a per-design custom item
 *   labor:<system>           a Grid labor line
 */
import { resolveFixture, type FixtureCatalogPart, type FixtureResolvable } from "@/lib/fixture-assemblies";
import { isInternalCategory } from "@/lib/catalog-internal";

export const ASSEMBLY_PART_PREFIX = "asm:";
export const ALLOWANCE_PART_PREFIX = "allow:";
export const CUSTOM_ITEM_PREFIX = "custom:";
export const LABOR_SKU_PREFIX = "labor:";

export type VirtualTier = "good" | "better" | "best";
export type VirtualRef = { kind: "assembly"; id: string } | { kind: "allowance"; rowKey: string; tier: VirtualTier };

export function isLaborSku(sku: unknown): boolean {
  return typeof sku === "string" && sku.startsWith(LABOR_SKU_PREFIX);
}

/** Units that price by run length (ft, lin ft, lf). */
export function isPerLengthUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase().replace(/^\//, "");
  return u === "ft" || u === "lin ft" || u === "linear ft" || u === "lf";
}

/** SKUs a row carries when it has no real part number — a vendor
 *  allowance, an AI-drafted line, a curtain, a custom line. Any sku
 *  starting `CRT-` (a Grid curtain placeholder id) is also a placeholder. */
export const PLACEHOLDER_SKUS: ReadonlySet<string> = new Set(["", "CUSTOM", "AI", "CURTAIN"]);

export function isPlaceholderSku(sku: string): boolean {
  const s = (sku ?? "").trim().toUpperCase();
  return PLACEHOLDER_SKUS.has(s) || s.startsWith("CRT-");
}

/**
 * `asm:<id>` / `allow:<rowKey>:<tier>` → what it names, else null. The
 * Equipment-map vocabulary is gone with the Grid, so an allowance id is
 * accepted on its shape (a row key and one of the three tiers).
 */
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
    return tier === "good" || tier === "better" || tier === "best" ? { kind: "allowance", rowKey, tier } : null;
  }
  return null;
}

/**
 * `isInternal` for `gridSpecBomRows`, from catalog rows the caller already
 * holds: a SKU whose row's category is internal (Labor — `isInternalCategory`).
 */
export function internalSkuCheck(parts: Iterable<{ sku: string; category?: unknown }>): (sku: string) => boolean {
  const internal = new Set<string>();
  for (const p of parts) if (p && isInternalCategory(p.category)) internal.add(p.sku);
  return (sku) => internal.has(sku);
}

/**
 * A Grid-made quote's flat `spec.lines` → product rows, pure:
 *  - allowance lines (flagged, or an `allow:` sku) and labor lines are left out;
 *  - an `asm:` line is expanded into its assembly's included members (SKU,
 *    "member (assembly label)", line qty × member qty). An assembly that no
 *    longer resolves stays one row under its quoted description.
 * Every other line passes through unchanged.
 */
export function gridSpecBomRows(
  lines: ReadonlyArray<{ sku?: string; desc?: string; qty?: number; allowance?: boolean }>,
  fixtureOf: (id: string) => FixtureResolvable | null | undefined,
  /** A member SKU this flags (an internal catalog row — labor) is left out of an assembly's expansion. */
  isInternal?: (sku: string) => boolean
): Array<{ sku: string; desc: string; qty: number }> {
  const rows: Array<{ sku: string; desc: string; qty: number }> = [];
  for (const l of lines) {
    const sku = String(l.sku || "").trim();
    const desc = String(l.desc || "").trim();
    const qty = Number(l.qty) || 0;
    if (l.allowance || sku.startsWith(ALLOWANCE_PART_PREFIX)) continue;
    if (isLaborSku(sku)) continue;
    const ref = sku ? parseVirtualPartId(sku) : null;
    if (ref?.kind === "assembly") {
      const f = fixtureOf(ref.id);
      const members = f ? resolveFixture(f, new Map<string, FixtureCatalogPart>()).parts.filter((m) => m.included && m.sku) : [];
      if (f && members.length) {
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
    rows.push({ sku, desc, qty });
  }
  return rows;
}
