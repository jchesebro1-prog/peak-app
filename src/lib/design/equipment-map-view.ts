/**
 * Equipment map page view models (#GEM, spec §3) — pure. Built on the server
 * from the map + resolved prices so the client resolves nothing. Row status is
 * computed from RESOLVED prices: a cell pointing at a deleted part or an
 * unpriced assembly reads "Needs a part" (Auto would skip it) even though a
 * cell is stored.
 */
import type { SysKey, TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROWS, EQUIP_SYSTEM_LABEL, type EquipRowDef } from "./equipment-vocab";
import {
  EQUIP_TIERS,
  cellFor,
  priceCell,
  sellFromCost,
  type EquipCellInput,
  type EquipmentMap,
  type EquipPriceCtx,
  type EquipRowStatus,
} from "./equipment-map";
import { resolveFixture, type FixtureRecord } from "@/lib/fixture-assemblies";

export type EquipCellVM = {
  tier: TierKey;
  kind: "part" | "assembly" | "allowance" | "empty";
  title: string;
  detail: string;
  /** Unit cost (admin page only) — a fabric row's $/sq ft area rate. */
  unitCost: number | null;
  unitSell: number | null;
  perSqft: boolean;
  /** Why a stored cell does not price (deleted part, unpriced assembly …). */
  problem: string | null;
  /** A mapped part whose catalog unit differs from the row's (#GEM final
   *  review): the equation's quantity is in the ROW's unit, so a per-foot row
   *  priced by a per-each part (or the reverse) misprices. Advisory only. */
  unitWarning?: string | null;
  confirmedBy?: string;
  confirmedAt?: number;
  /** What the editor re-posts for this tier. */
  input: EquipCellInput;
};

export type EquipRowVM = {
  key: string;
  system: SysKey;
  systemLabel: string;
  label: string;
  unit: string;
  curtain: boolean;
  status: EquipRowStatus;
  sameAll: boolean;
  hint: string;
  hintSkus: string[];
  updatedBy: string;
  updatedAt: number;
  cells: EquipCellVM[];
};

export type AssemblyOption = { id: string; label: string; kind: "fixture" | "system"; scope: string; unitCost: number; unitSell: number };

/** Unit spellings that mean the same thing, folded for the mismatch check. */
const UNIT_ALIASES: Record<string, string> = {
  ea: "ea", each: "ea", pc: "ea", pcs: "ea", piece: "ea", unit: "ea",
  ft: "ft", lf: "ft", foot: "ft", feet: "ft", linft: "ft",
  sqft: "sqft", sf: "sqft", ft2: "sqft",
  lot: "lot", ls: "lot",
};
export function normalizeUnit(u: string | null | undefined): string {
  const k = String(u ?? "").toLowerCase().replace(/[\s.'’_-]/g, "");
  return UNIT_ALIASES[k] ?? k;
}

/** The mismatch warning for a mapped part, or null when the units agree (or the part has none). */
export function unitMismatch(rowUnit: string, partUnit: string | null | undefined): string | null {
  if (!partUnit || !String(partUnit).trim()) return null;
  if (normalizeUnit(rowUnit) === normalizeUnit(partUnit)) return null;
  return `Catalog unit is “${partUnit}” but this row counts in “${rowUnit}” — check the part prices per ${rowUnit}.`;
}

function cellVM(def: EquipRowDef, tier: TierKey, map: EquipmentMap, ctx: EquipPriceCtx): EquipCellVM {
  const cell = cellFor(map[def.key], tier);
  const perSqft = !!def.curtain;
  if (!cell) return { tier, kind: "empty", title: "Needs a part", detail: "", unitCost: null, unitSell: null, perSqft, problem: null, input: null };
  const price = priceCell(cell, def, ctx);
  const priced = price.status === "needs-part" ? null : price;
  const problem = price.status === "needs-part" ? price.reason : null;
  if (cell.kind === "part") {
    const part = ctx.parts.get(cell.sku);
    return {
      tier, kind: "part", title: cell.sku, detail: priced?.desc ?? "",
      // Fabric rows price by area whatever the fabric's own unit — never warned.
      unitWarning: perSqft || !part ? null : unitMismatch(def.unit, part.unit),
      unitCost: perSqft ? priced?.areaRate ?? null : priced?.unitCost ?? null,
      unitSell: perSqft ? null : priced?.unitSell ?? null,
      perSqft, problem, input: { kind: "part", sku: cell.sku },
    };
  }
  if (cell.kind === "assembly") {
    const f = ctx.fixtures.get(cell.id);
    return {
      tier, kind: "assembly", title: f?.label ?? cell.id,
      detail: f ? (f.kind === "system" ? `System · ${f.scope ?? "Other"}` : "Fixture") : "",
      unitCost: priced?.unitCost ?? null, unitSell: priced?.unitSell ?? null,
      perSqft, problem, input: { kind: "assembly", id: cell.id },
    };
  }
  return {
    tier, kind: "allowance", title: "Allowance", detail: cell.note ?? "",
    unitCost: cell.amount, unitSell: priced?.unitSell ?? null, perSqft, problem,
    confirmedBy: cell.confirmedBy, confirmedAt: cell.confirmedAt,
    input: { kind: "allowance", amount: cell.amount, note: cell.note ?? "", confirmed: true },
  };
}

export function equipmentMapView(
  map: EquipmentMap,
  ctx: EquipPriceCtx,
  hints: Record<string, { text: string; skus: string[] }>
): EquipRowVM[] {
  return EQUIPMENT_ROWS.map((def) => {
    const cells = EQUIP_TIERS.map((t) => cellVM(def, t, map, ctx));
    const status: EquipRowStatus = cells.some((c) => c.kind === "empty" || c.problem)
      ? "needs-part"
      : cells.some((c) => c.kind === "allowance")
        ? "allowance"
        : "mapped";
    const row = map[def.key];
    const h = hints[def.key];
    return {
      key: def.key, system: def.system, systemLabel: EQUIP_SYSTEM_LABEL[def.system], label: def.label, unit: def.unit,
      curtain: !!def.curtain, status, sameAll: !!row?.sameAll, hint: h?.text ?? "", hintSkus: h?.skus ?? [],
      updatedBy: row?.updatedBy ?? "", updatedAt: row?.updatedAt ?? 0, cells,
    };
  });
}

export function mapSummary(rows: EquipRowVM[]): Record<EquipRowStatus, number> {
  const out: Record<EquipRowStatus, number> = { mapped: 0, allowance: 0, "needs-part": 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** Every fixture and system with its live included totals — the assembly picker. */
export function assemblyOptions(fixtures: Iterable<FixtureRecord>, ctx: EquipPriceCtx): AssemblyOption[] {
  const out: AssemblyOption[] = [];
  for (const f of fixtures) {
    const r = resolveFixture(f, ctx.parts);
    out.push({
      id: f.id, label: f.label, kind: f.kind,
      scope: f.kind === "system" ? f.scope ?? "Other" : "Lighting",
      unitCost: r.cost, unitSell: r.sell > 0 ? r.sell : sellFromCost(r.cost, ctx.margin),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * Suggested catalog matches for one row (spec §3, "help filling it"): the old
 * per-tier fabric SKUs first, then parts whose description / category contain
 * the row's search words. Fabric rows see Fabric parts only; other rows never
 * see Fabric or Labor. One pass over the given parts.
 */
export function suggestParts<P extends { sku: string; desc: string; category?: string }>(
  parts: Iterable<P>,
  def: EquipRowDef,
  hintSkus: readonly string[],
  limit = 8
): P[] {
  const words = def.search.map((w) => w.toLowerCase());
  const hinted = new Set(hintSkus);
  const scored: Array<{ p: P; score: number }> = [];
  for (const p of parts) {
    const cat = p.category || "";
    if (def.curtain ? cat !== "Fabric" : cat === "Fabric" || cat === "Labor") continue;
    const text = `${p.desc} ${cat}`.toLowerCase();
    let score = hinted.has(p.sku) ? 10 : 0;
    for (const w of words) if (text.includes(w)) score += 1;
    if (score > 0) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.p.desc.localeCompare(b.p.desc))
    .slice(0, Math.max(1, limit))
    .map((s) => s.p);
}
