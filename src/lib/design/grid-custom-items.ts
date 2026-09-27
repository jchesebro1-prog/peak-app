/**
 * Per-design custom items (#212) — pure and client-safe (the grid-bom.ts
 * rule): imported by the store, the quote builder, the editor page AND the
 * client BOM section.
 *
 * A custom item is "a product that just doesn't have a catalog item": a
 * described line on ONE Grid option, priced exactly like an Equipment-map
 * allowance — sell = unit cost ÷ (1 − the customer's tier margin). It is
 * always priced (never "Incomplete"), flagged `allowance` on the quote, and
 * left out of the bid spec (gridSpecBomRows drops allowance lines). It is
 * never placed on the plan sheet and never enters the catalog.
 *
 * Stored on the option itself (`GridOption.customItems`), so revision
 * snapshots, restores and option removal carry it with no second code path;
 * option copy re-ids it (copyCustomItems).
 */
import type { BomLine } from "./grid-bom";
import { ALLOWANCE_MAX, sellFromCost } from "./equipment-map";
import { isGridLayer, type GridLayer } from "./grid-scopes";

export const CUSTOM_ITEM_PREFIX = "custom:";
export const CUSTOM_ITEM_DESC_MAX = 200;
export const CUSTOM_ITEM_MAKER_MAX = 80;
export const CUSTOM_ITEM_QTY_MAX = 100_000;
/** Typo/abuse guard per option, not a policy. */
export const CUSTOM_ITEMS_MAX = 200;

/** The BOM category a custom item prints under (#230): a Grid layer, or
 *  "Controls" (the BOM's Controls heading has no Grid layer). Absent =
 *  General. */
export type CustomItemSystem = GridLayer | "Controls";

export function isCustomItemSystem(v: unknown): v is CustomItemSystem {
  return isGridLayer(v) || v === "Controls";
}

export type GridCustomItem = {
  id: string; // "ci-" + 12 hex
  /** Customer-facing text — required, trimmed, ≤ 200. */
  desc: string;
  mfr?: string;
  model?: string;
  /** The BOM category it prints under (#230); absent = General. */
  system?: CustomItemSystem;
  /** Whole number, 1…100,000. */
  qty: number;
  /** Unit COST, > 0 and ≤ ALLOWANCE_MAX. */
  unitCost: number;
};

/** What the editor posts. `id` present = edit that item; absent = add one. */
export type GridCustomItemInput = {
  id?: string | null;
  desc: string;
  mfr?: string;
  model?: string;
  system?: string;
  qty: number;
  unitCost: number;
};

const ID_RE = /^ci-[0-9a-f]{12}$/;

export function isCustomItemId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/** The BOM / quote-spec sku of a custom item. */
export function customItemPartId(id: string): string {
  return CUSTOM_ITEM_PREFIX + id;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function sanitizeCustomItem(
  raw: unknown,
  id: string
): { ok: true; item: GridCustomItem } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const desc = text(r.desc, CUSTOM_ITEM_DESC_MAX);
  if (!desc) return { ok: false, error: "Describe the item — that text prints on the quote." };
  const qty = Number(r.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > CUSTOM_ITEM_QTY_MAX)
    return { ok: false, error: "Quantity must be a whole number from 1 to 100,000." };
  const unitCost = round2(Number(r.unitCost));
  if (!(unitCost > 0) || unitCost > ALLOWANCE_MAX) return { ok: false, error: "A custom item needs a unit cost above $0." };
  const mfr = text(r.mfr, CUSTOM_ITEM_MAKER_MAX);
  const model = text(r.model, CUSTOM_ITEM_MAKER_MAX);
  return {
    ok: true,
    item: {
      id,
      desc,
      ...(mfr ? { mfr } : {}),
      ...(model ? { model } : {}),
      ...(isCustomItemSystem(r.system) ? { system: r.system } : {}),
      qty,
      unitCost,
    },
  };
}

/** A stored list → clean items: valid ids and fields only, no duplicates, capped. */
export function customItemsOf(raw: unknown): GridCustomItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GridCustomItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (out.length >= CUSTOM_ITEMS_MAX) break;
    if (!x || typeof x !== "object") continue;
    const id = (x as { id?: unknown }).id;
    if (!isCustomItemId(id) || seen.has(id)) continue;
    const s = sanitizeCustomItem(x, id);
    if (!s.ok) continue;
    seen.add(id);
    out.push(s.item);
  }
  return out;
}

/** The line text: description — manufacturer — model (blanks skipped). */
export function customItemDesc(it: Pick<GridCustomItem, "desc" | "mfr" | "model">): string {
  return [it.desc, it.mfr, it.model].filter(Boolean).join(" — ");
}

/** BOM lines in the order the person added them; sell = cost ÷ (1 − margin). */
export function customItemBomLines(items: readonly GridCustomItem[], margin: number): BomLine[] {
  return items.map((it) => {
    const list = sellFromCost(it.unitCost, margin);
    return {
      partId: customItemPartId(it.id),
      desc: customItemDesc(it),
      unit: "ea",
      qty: it.qty,
      list,
      ext: round2(it.qty * list),
      allowance: true as const,
      custom: true as const,
    };
  });
}

/** The cost basis the quote's margin is computed from. */
export function customItemsCost(items: readonly GridCustomItem[]): number {
  return round2(items.reduce((a, it) => a + it.qty * it.unitCost, 0));
}

export type CustomItemSave =
  | { ok: true; items: GridCustomItem[]; item: GridCustomItem }
  | { ok: false; reason: "no-such-item" | "invalid" | "too-many"; error: string };

/** Add (no id) or edit (existing id) one item in a list. Never mutates `items`. */
export function applyCustomItemSave(items: readonly GridCustomItem[], raw: unknown, makeId: () => string): CustomItemSave {
  const wanted = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
  const editId = typeof wanted === "string" && wanted ? wanted : null;
  if (editId !== null && !items.some((it) => it.id === editId))
    return { ok: false, reason: "no-such-item", error: "That custom item was removed — refresh the page." };
  if (editId === null && items.length >= CUSTOM_ITEMS_MAX)
    return { ok: false, reason: "too-many", error: `An option holds at most ${CUSTOM_ITEMS_MAX} custom items.` };
  const s = sanitizeCustomItem(raw, editId ?? makeId());
  if (!s.ok) return { ok: false, reason: "invalid", error: s.error };
  const next = editId !== null ? items.map((it) => (it.id === editId ? s.item : it)) : [...items, s.item];
  return { ok: true, items: next, item: s.item };
}

export function withoutCustomItem(items: readonly GridCustomItem[], id: string): GridCustomItem[] {
  return items.filter((it) => it.id !== id);
}

/** A copied option's items: same content, fresh ids. */
export function copyCustomItems(items: readonly GridCustomItem[], makeId: () => string): GridCustomItem[] {
  return items.map((it) => ({ ...it, id: makeId() }));
}
