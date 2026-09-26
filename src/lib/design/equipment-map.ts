/**
 * The Grid Equipment map (#GEM, spec §3, D-GEM-2/D-GEM-3) — pure.
 *
 * Every equation item × tier maps to a catalog part, a fixture / System
 * assembly (the one builder, #210) or a CONFIRMED allowance. Anything else is
 * "needs a part" and never prices: there is no fallback dollar anywhere in
 * this module. Stored as one settings blob with one TOP-LEVEL key per row, so
 * setBlob's atomic per-key jsonb merge keeps two admins' edits to different
 * rows independent (the spec's `{ rows: … }` nesting would let them clobber
 * each other). A cleared row is written as null and dropped on read.
 *
 * Pricing (spec §3):
 *  - part      → live catalog cost; sell = list, or cost ÷ (1 − catalog
 *                margin) when the part has no list of its own;
 *  - assembly  → resolveFixture's included cost / sell;
 *  - allowance → the confirmed amount is a unit cost, sold like a list-less
 *                part;
 *  - fabric rows (curtains) → the mapped Fabric part's area rate
 *                (curtainAreaRate, else costPerSqft) — the per-drape cost is
 *                computed from the venue geometry in equipment-pricing.ts.
 *                No SEED_FABRIC_RATES fallback.
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROWS, EQUIPMENT_ROW_BY_KEY, type EquipRowDef } from "./equipment-vocab";
import { fixtureSkus, resolveFixture, type FixtureCatalogPart, type FixtureRecord } from "@/lib/fixture-assemblies";

export const EQUIPMENT_MAP_BLOB = "grid_equipment_map";
export const EQUIP_TIERS: readonly TierKey[] = ["good", "better", "best"];
/** Typo guard on one allowance's unit cost, not a policy. */
export const ALLOWANCE_MAX = 10_000_000;

export type EquipCell =
  | { kind: "part"; sku: string }
  | { kind: "assembly"; id: string }
  | { kind: "allowance"; amount: number; confirmedBy: string; confirmedAt: number; note?: string };

export type EquipRow = {
  tiers: Partial<Record<TierKey, EquipCell>>;
  /** "Same for all tiers": the Good cell is canonical (saved into all three). */
  sameAll?: boolean;
  updatedBy: string;
  updatedAt: number;
};

export type EquipmentMap = Record<string, EquipRow>;
export type EquipRowStatus = "mapped" | "allowance" | "needs-part";

/** What the editor posts for one tier. An allowance must arrive `confirmed`. */
export type EquipCellInput =
  | { kind: "part"; sku: string }
  | { kind: "assembly"; id: string }
  | { kind: "allowance"; amount: number; note?: string; confirmed: boolean }
  | null;
export type EquipRowInput = { tiers: Partial<Record<TierKey, EquipCellInput>>; sameAll?: boolean };

export function isTierKey(v: unknown): v is TierKey {
  return v === "good" || v === "better" || v === "best";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function sanitizeEquipCell(raw: unknown): EquipCell | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "part") {
    const sku = String(r.sku ?? "").trim().slice(0, 120);
    return sku ? { kind: "part", sku } : null;
  }
  if (r.kind === "assembly") {
    const id = String(r.id ?? "").trim().slice(0, 120);
    return id ? { kind: "assembly", id } : null;
  }
  if (r.kind === "allowance") {
    const amount = round2(Number(r.amount));
    const confirmedBy = String(r.confirmedBy ?? "").trim().slice(0, 80);
    const confirmedAt = Number(r.confirmedAt);
    if (!(amount > 0) || amount > ALLOWANCE_MAX || !confirmedBy || !(confirmedAt > 0)) return null;
    const note = String(r.note ?? "").trim().slice(0, 200);
    return { kind: "allowance", amount, confirmedBy, confirmedAt, ...(note ? { note } : {}) };
  }
  return null;
}

/** The stored blob → a clean map: known rows only, valid cells only, cleared (null) rows dropped. */
export function sanitizeEquipmentMap(raw: unknown): EquipmentMap {
  const out: EquipmentMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!EQUIPMENT_ROW_BY_KEY.has(key) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const tiersRaw = (v.tiers && typeof v.tiers === "object" ? v.tiers : {}) as Record<string, unknown>;
    const tiers: Partial<Record<TierKey, EquipCell>> = {};
    for (const t of EQUIP_TIERS) {
      const c = sanitizeEquipCell(tiersRaw[t]);
      if (c) tiers[t] = c;
    }
    out[key] = {
      tiers,
      ...(v.sameAll ? { sameAll: true } : {}),
      updatedBy: String(v.updatedBy ?? ""),
      updatedAt: Number(v.updatedAt) || 0,
    };
  }
  return out;
}

export function cellFor(row: EquipRow | undefined, tier: TierKey): EquipCell | null {
  if (!row) return null;
  return (row.sameAll ? row.tiers.good : row.tiers[tier]) ?? null;
}

/** Spec §3: Mapped (every tier part/assembly) · Allowance (any tier an allowance) · Needs a part (any tier empty). */
export function rowStatus(row: EquipRow | undefined): EquipRowStatus {
  const cells = EQUIP_TIERS.map((t) => cellFor(row, t));
  if (cells.some((c) => !c)) return "needs-part";
  return cells.some((c) => c!.kind === "allowance") ? "allowance" : "mapped";
}

/**
 * One row save → the stored row. An allowance needs `confirmed`; its
 * confirmedBy / confirmedAt are re-stamped only when the amount or note
 * changes, so re-saving a row never silently re-attributes someone else's
 * confirmation. "Same for all tiers" keeps the Good cell and copies it to
 * Better and Best.
 */
export function mergeEquipRow(
  prev: EquipRow | undefined,
  input: EquipRowInput,
  by: string,
  now: number
): { ok: true; row: EquipRow } | { ok: false; error: string } {
  const sameAll = !!input?.sameAll;
  const tiers: Partial<Record<TierKey, EquipCell>> = {};
  for (const t of sameAll ? (["good"] as TierKey[]) : EQUIP_TIERS) {
    const c = input?.tiers?.[t];
    if (!c) continue;
    if (c.kind === "allowance") {
      if (!c.confirmed) return { ok: false, error: "Tick “I confirm this allowance” — an unconfirmed allowance is never used." };
      const amount = round2(Number(c.amount));
      if (!(amount > 0) || amount > ALLOWANCE_MAX) return { ok: false, error: "An allowance needs a unit cost above $0." };
      const note = String(c.note ?? "").trim().slice(0, 200);
      const old = cellFor(prev, t);
      const unchanged = old?.kind === "allowance" && old.amount === amount && (old.note ?? "") === note;
      tiers[t] = {
        kind: "allowance",
        amount,
        confirmedBy: unchanged ? old.confirmedBy : by,
        confirmedAt: unchanged ? old.confirmedAt : now,
        ...(note ? { note } : {}),
      };
      continue;
    }
    const cell = sanitizeEquipCell(c);
    if (!cell) return { ok: false, error: "Pick a catalog part or an assembly for every filled tier." };
    tiers[t] = cell;
  }
  if (sameAll && tiers.good) {
    tiers.better = tiers.good;
    tiers.best = tiers.good;
  }
  return { ok: true, row: { tiers, ...(sameAll ? { sameAll: true } : {}), updatedBy: by, updatedAt: now } };
}

/* -------------------------------- pricing -------------------------------- */

export type PricingPart = FixtureCatalogPart & { category?: string; curtainAreaRate?: number; costPerSqft?: number };
export type EquipPriceCtx = {
  /** Catalog parts by SKU — the rows the map (and any override) references. */
  parts: ReadonlyMap<string, PricingPart>;
  /** Fixtures and systems by id (listFixtures). */
  fixtures: ReadonlyMap<string, FixtureRecord>;
  /** catalog_rates.defaultMargin — the list-less part / allowance sell rule. */
  margin: number;
};
export type PricedStatus = "part" | "assembly" | "allowance";
export type PricedUnit = {
  status: PricedStatus;
  /** SKU (part), fixture id (assembly) or row key (allowance). */
  ref: string;
  desc: string;
  unit: string;
  unitCost: number;
  unitSell: number;
  /** Fabric rows only: $/sq ft of sewn fabric; the per-drape cost comes from the venue geometry. */
  areaRate?: number;
};
export type UnitPrice = PricedUnit | { status: "needs-part"; reason: string };
export type EquipmentPriceTable = { margin: number; byTier: Record<TierKey, Record<string, UnitPrice>> };

/** cost ÷ (1 − margin), cents-rounded. The margin is a rate (catalog_rates), never a dollar. */
export function sellFromCost(cost: number, margin: number): number {
  const m = margin >= 0 && margin < 0.95 ? margin : 0.3;
  return round2(cost / (1 - m));
}

const needs = (reason: string): UnitPrice => ({ status: "needs-part", reason });

export function priceCell(cell: EquipCell | null, def: EquipRowDef, ctx: EquipPriceCtx): UnitPrice {
  if (!cell) return needs("Not mapped yet");
  if (cell.kind === "allowance") {
    if (!(cell.amount > 0) || !cell.confirmedBy || !(cell.confirmedAt > 0)) return needs("Allowance not confirmed");
    // desc is bare (no "(allowance)" suffix here) — the one consumer that
    // shows a mapped-part description alongside the row's own name (Quick
    // Design's BOM label) already appends "· Allowance" from `status`; a
    // suffix here would show it twice (#GEM M3).
    return { status: "allowance", ref: def.key, desc: def.label, unit: def.unit, unitCost: cell.amount, unitSell: sellFromCost(cell.amount, ctx.margin) };
  }
  if (cell.kind === "part") {
    const p = ctx.parts.get(cell.sku);
    if (!p) return needs(`${cell.sku} is no longer in the catalog`);
    if (def.curtain) {
      const rate = p.category === "Fabric" ? Number(p.curtainAreaRate ?? p.costPerSqft ?? 0) : 0;
      if (!(rate > 0)) return needs(`${p.sku} is not a fabric with an area rate`);
      return { status: "part", ref: p.sku, desc: p.desc, unit: def.unit, unitCost: 0, unitSell: 0, areaRate: rate };
    }
    const cost = Number(p.cost) || 0;
    const list = Number(p.list) || 0;
    if (!(cost > 0) && !(list > 0)) return needs(`${p.sku} has no price in the catalog`);
    return { status: "part", ref: p.sku, desc: p.desc, unit: p.unit || def.unit, unitCost: cost, unitSell: list > 0 ? list : sellFromCost(cost, ctx.margin) };
  }
  if (def.curtain) return needs("A curtain row maps to a Fabric part");
  const f = ctx.fixtures.get(cell.id);
  if (!f) return needs(`Assembly ${cell.id} was deleted`);
  const r = resolveFixture(f, ctx.parts);
  if (!(r.cost > 0) && !(r.sell > 0)) return needs(`${f.label} has no priced parts`);
  return { status: "assembly", ref: f.id, desc: f.label, unit: "ea", unitCost: r.cost, unitSell: r.sell > 0 ? r.sell : sellFromCost(r.cost, ctx.margin) };
}

export function buildEquipmentPriceTable(map: EquipmentMap, ctx: EquipPriceCtx): EquipmentPriceTable {
  const byTier = { good: {}, better: {}, best: {} } as Record<TierKey, Record<string, UnitPrice>>;
  for (const def of EQUIPMENT_ROWS) {
    for (const t of EQUIP_TIERS) byTier[t][def.key] = priceCell(cellFor(map[def.key], t), def, ctx);
  }
  return { margin: ctx.margin, byTier };
}

/** Every catalog SKU the map prices — mapped parts plus the parts of mapped assemblies (one getMany). */
export function mapSkus(map: EquipmentMap, fixtures: ReadonlyMap<string, FixtureRecord>): string[] {
  const out = new Set<string>();
  for (const row of Object.values(map)) {
    for (const t of EQUIP_TIERS) {
      const c = row.tiers[t];
      if (c?.kind === "part") out.add(c.sku);
      if (c?.kind === "assembly") {
        const f = fixtures.get(c.id);
        if (f) for (const sku of fixtureSkus(f)) out.add(sku);
      }
    }
  }
  return [...out];
}
