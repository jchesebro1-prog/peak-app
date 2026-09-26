/**
 * Auto intake cards (#GEM, spec §5) — the equations' items for each chosen
 * Grid scope, priced at that scope's tier from the Equipment map (or a
 * per-row swap), with editable quantities. Server-side: it prices through
 * equipment-pricing.ts (cost-bearing). Clients receive sellOnlyCards() and
 * import only its TYPES.
 */
import {
  LIM,
  SYS_ORDER,
  compute,
  defaultAState,
  type AState,
  type DimField,
  type DrapeGeom,
  type QuickScopeInputs,
  type SysKey,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROW_BY_KEY, type EquipPlace } from "./equipment-vocab";
import { priceCell, sellFromCost, type EquipmentPriceTable, type EquipPriceCtx, type PricedStatus, type UnitPrice } from "./equipment-map";
import { applyEquipment } from "./equipment-pricing";
import { TRACKABLE_SYS_KEYS } from "./grid-scopes";
import type { AutoEstimate, AutoOverride } from "./grid-auto-model";
import type { ScopeTargets } from "./scope-targets";

/** Auto fills only the five Grid scopes (D-GEM-7). */
export const AUTO_SCOPES: readonly SysKey[] = TRACKABLE_SYS_KEYS;

export type AutoLine = {
  rowKey: string;
  scope: SysKey;
  /** The equation's item name. */
  label: string;
  unit: string;
  place: EquipPlace;
  /** What the equations call for; `qty` is that or the designer's edit. */
  eqQty: number;
  qty: number;
  status: PricedStatus | "needs-part";
  /** needs-part only: why (not mapped, deleted part, …). */
  reason?: string;
  ref?: string;
  refDesc?: string;
  unitCost: number;
  unitSell: number;
  /** qty × unitSell (0 for needs-part). */
  total: number;
  swapped: boolean;
  drape?: DrapeGeom;
};
export type AutoCard = { scope: SysKey; tier: TierKey; lines: AutoLine[]; total: number; needsPart: number; allowances: number };
export type SellLine = Omit<AutoLine, "unitCost">;
export type SellCard = Omit<AutoCard, "lines"> & { lines: SellLine[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Client-sent scope inputs, made safe for the equations: finite, non-negative, capped dims; boolean systems. */
export function clampScopeInputs(inputs: QuickScopeInputs): QuickScopeInputs {
  const dim = (f: DimField) => {
    const v = Number(inputs[f]);
    return Number.isFinite(v) ? Math.max(0, Math.min(LIM[f][1], v)) : LIM[f][0];
  };
  const sys = Object.fromEntries(SYS_ORDER.map((k) => [k, !!inputs.sys?.[k]])) as Record<SysKey, boolean>;
  return { ...inputs, width: dim("width"), depth: dim("depth"), grid: dim("grid"), wing: dim("wing"), ph: dim("ph"), sys };
}

/** Price each row's swap (a catalog SKU or an assembly) through the same resolver as the map. */
export function priceOverrides(overrides: Record<string, AutoOverride>, ctx: EquipPriceCtx): Record<string, UnitPrice> {
  const out: Record<string, UnitPrice> = {};
  for (const [rowKey, o] of Object.entries(overrides)) {
    const def = EQUIPMENT_ROW_BY_KEY.get(rowKey);
    if (!def) continue;
    if (o.sku) out[rowKey] = priceCell({ kind: "part", sku: o.sku }, def, ctx);
    else if (o.assemblyId) out[rowKey] = priceCell({ kind: "assembly", id: o.assemblyId }, def, ctx);
  }
  return out;
}

export function autoEstimateCards(
  rawInputs: QuickScopeInputs,
  est: AutoEstimate,
  table: EquipmentPriceTable,
  overridePrices: Record<string, UnitPrice>
): AutoCard[] {
  const inputs = clampScopeInputs(rawInputs);
  const s: AState = { ...defaultAState(0), ...inputs, tier: "better" };
  const C = compute(s);
  const cards: AutoCard[] = [];
  for (const scope of AUTO_SCOPES) {
    if (!inputs.sys[scope]) continue;
    const sys = C.systems.find((x) => x.key === scope);
    if (!sys) continue;
    const tier = est.tierByScope[scope] ?? "better";
    const [priced] = applyEquipment([sys], tier, table, overridePrices);
    const lines: AutoLine[] = [];
    for (const it of priced.items) {
      if (it.qty <= 0) continue;
      const def = EQUIPMENT_ROW_BY_KEY.get(it.key);
      if (!def) continue;
      const o = est.overrides[it.key];
      const qty = o?.qty ?? it.qty;
      const status = it.status ?? "needs-part";
      const needs = status === "needs-part";
      const src = overridePrices[it.key] ?? table.byTier[tier][it.key];
      lines.push({
        rowKey: it.key,
        scope,
        label: it.desc,
        unit: it.unit,
        place: def.place,
        eqQty: it.qty,
        qty,
        status,
        ...(needs ? { reason: src && src.status === "needs-part" ? src.reason : "Not mapped yet" } : {}),
        ...(it.ref ? { ref: it.ref } : {}),
        ...(it.refDesc ? { refDesc: it.refDesc } : {}),
        unitCost: needs ? 0 : it.cost,
        unitSell: needs ? 0 : it.price,
        total: needs ? 0 : round2(qty * it.price),
        swapped: !!(o?.sku || o?.assemblyId),
        ...(it.drape ? { drape: it.drape } : {}),
      });
    }
    cards.push({
      scope,
      tier,
      lines,
      total: round2(lines.reduce((sum, l) => sum + l.total, 0)),
      needsPart: lines.filter((l) => l.status === "needs-part").length,
      allowances: lines.filter((l) => l.status === "allowance").length,
    });
  }
  return cards;
}

/**
 * The needs-a-part lines of an option's Auto choices that a quote would
 * silently leave out (#GEM final review, D-GEM-22): Auto never places a
 * needs-a-part line, so the Grid's BOM — and its quote — are missing that
 * equipment. Only the scopes Auto was asked to fill (those with a chosen
 * tier) count, and a line edited to qty 0 was dropped on purpose.
 */
export function autoQuoteNeedsPart(cards: ReadonlyArray<Pick<AutoCard, "scope" | "lines">>, est: Pick<AutoEstimate, "tierByScope">): number {
  let n = 0;
  for (const c of cards) {
    if (!est.tierByScope[c.scope]) continue;
    for (const l of c.lines) if (l.status === "needs-part" && l.qty > 0) n += 1;
  }
  return n;
}

function sellLine(l: AutoLine): SellLine {
  return {
    rowKey: l.rowKey,
    scope: l.scope,
    label: l.label,
    unit: l.unit,
    place: l.place,
    eqQty: l.eqQty,
    qty: l.qty,
    status: l.status,
    ...(l.reason ? { reason: l.reason } : {}),
    ...(l.ref ? { ref: l.ref } : {}),
    ...(l.refDesc ? { refDesc: l.refDesc } : {}),
    unitSell: l.unitSell,
    total: l.total,
    swapped: l.swapped,
    ...(l.drape ? { drape: l.drape } : {}),
  };
}

/** What a client may see: every line without its unit cost. */
export function sellOnlyCards(cards: AutoCard[]): SellCard[] {
  return cards.map((c) => ({ scope: c.scope, tier: c.tier, lines: c.lines.map(sellLine), total: c.total, needsPart: c.needsPart, allowances: c.allowances }));
}

/** The Scope panel's target for Auto scopes = the chosen cards. */
export function autoTargets(cards: Array<AutoCard | SellCard>): ScopeTargets {
  const out: ScopeTargets = {};
  for (const c of cards) out[c.scope] = { sell: c.total, needsPart: c.needsPart, allowances: c.allowances };
  return out;
}

/* ---------------- swap picker pure helpers (#GEM fix wave 1, I2/M1) ---------------- */

export type AutoEquipHit = { kind: "part" | "assembly"; ref: string; desc: string; unit: string; unitSell: number };

/**
 * A curtain row's swap candidates (I2): a Fabric part is a candidate only
 * when it has a positive area rate — a list-less, cost-less fabric priced
 * only by area rate (the normal case) is still findable, and nothing here is
 * ever an assembly (a curtain row maps to a Fabric part, never a System).
 * The area rate is a COST basis, so it is shown as a per-sq-ft SELL through
 * the catalog margin (the same list-less rule the Equipment map prices a
 * fabric row with) — the client never sees the raw cost rate.
 */
export function curtainSwapHits(parts: ReadonlyArray<{ sku: string; desc: string; curtainAreaRate?: number }>, margin: number): AutoEquipHit[] {
  return parts
    .filter((p) => Number(p.curtainAreaRate ?? 0) > 0)
    .map((p) => ({ kind: "part", ref: p.sku, desc: p.desc, unit: "sq ft", unitSell: sellFromCost(Number(p.curtainAreaRate), margin) }));
}

/** A non-curtain row's part candidates: priced (a cost or a list), sell-only. */
export function partSwapHits(
  hits: ReadonlyArray<{ sku: string; desc: string; unit: string; cost: number; list: number }>,
  margin: number
): AutoEquipHit[] {
  return hits
    .filter((h) => h.cost > 0 || h.list > 0)
    .map((h) => ({ kind: "part", ref: h.sku, desc: h.desc, unit: h.unit, unitSell: h.list > 0 ? h.list : sellFromCost(h.cost, margin) }));
}

/**
 * Which fixtures/systems are swap candidates for a scope (M1): a System
 * assembly only when its own scope matches the card's (`f.scope`, the
 * capitalized SysKey label — "Lighting", "Audio", …); a Fixture assembly only
 * on a Lighting row, the one scope where a bare light fixture is a sensible
 * swap for an equation line.
 */
export function assemblySwapCandidates<F extends { kind: "fixture" | "system"; scope?: string }>(
  fixtures: ReadonlyArray<F>,
  scopeLabel: string
): F[] {
  return fixtures.filter((f) => (f.kind === "fixture" ? scopeLabel === "Lighting" : f.scope === scopeLabel));
}

/** A SysKey ("lighting") → the capitalized SystemScope label ("Lighting") a System assembly's `scope` field stores. */
export function scopeLabelOf(scope: SysKey): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}
