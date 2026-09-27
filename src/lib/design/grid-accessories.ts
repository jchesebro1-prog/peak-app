/**
 * BOM accessories (#230) — pure and client-safe (the grid-bom.ts rule):
 * imported by the store, the quote builder, the editor and its accessory
 * picker.
 *
 * An accessory is a Grid-library part added under one BOM heading without
 * being placed on the plan ("+ Add accessory"). It is stored on ONE Grid
 * option (`GridOption.accessories`, like #212's customItems), so revision
 * snapshots, restores and option removal carry it with no second code path;
 * option copy re-ids it (copyAccessories).
 *
 * Pricing is a placed part's, exactly: an accessory line reads the SAME part
 * row a placement of that partId reads — the editor's `parts` and the quote's
 * tier catalog (cost ÷ (1 − tier margin), the #63/#76 list fallback
 * included). It is a real product line on the quote and the bid spec, never
 * an allowance. A part that has left the library prices $0 and says so
 * (the bomLines rule) — never dropped.
 */
import type { BomLine, PartLite } from "./grid-bom";
import { groupOfPart, isBomGroupKey, type BomGroupKey } from "./grid-bom-groups";

export const ACCESSORY_QTY_MAX = 100_000;
/** Typo/abuse guard per option, not a policy. */
export const ACCESSORIES_MAX = 200;
export const ACCESSORY_PART_ID_MAX = 200;
/** Rows the picker shows at once (the palette's cap). */
export const ACCESSORY_SEARCH_CAP = 60;

export type GridAccessory = {
  id: string; // "ba-" + 12 hex
  /** A Grid-library part id — the id a placement of it would carry. */
  partId: string;
  /** Whole number, 1…100,000, in the part's unit. */
  qty: number;
  /** The BOM heading it was added under. */
  scope: BomGroupKey;
};

/** What the editor posts: `id` = edit that line's qty; no `id` = add partId × qty under scope. */
export type GridAccessoryInput = { id?: string | null; partId?: string; qty: number; scope?: string };

export type AccessoryBomLine = BomLine & { accessoryId: string; group: BomGroupKey };

const ID_RE = /^ba-[0-9a-f]{12}$/;
/** Ids that are never a Grid-library part: Auto's virtual parts, custom items, seed placeholders, #232 labor lines. */
const NOT_A_PART = /^(asm:|allow:|custom:|grid-seed:|labor:)/;
const QTY_ERROR = "Quantity must be a whole number from 1 to 100,000.";

export function isAccessoryId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

export function isAccessoryPartId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= ACCESSORY_PART_ID_MAX && v === v.trim() && !NOT_A_PART.test(v);
}

function cleanQty(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= ACCESSORY_QTY_MAX ? n : null;
}

export function sanitizeAccessory(
  raw: unknown,
  id: string
): { ok: true; item: GridAccessory } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const partId = String(r.partId ?? "").trim();
  if (!isAccessoryPartId(partId)) return { ok: false, error: "Pick a catalog part for the accessory." };
  const qty = cleanQty(r.qty);
  if (qty === null) return { ok: false, error: QTY_ERROR };
  const scope = r.scope;
  if (!isBomGroupKey(scope)) return { ok: false, error: "Pick the BOM category the accessory belongs to." };
  return { ok: true, item: { id, partId, qty, scope } };
}

/** A stored list → clean lines: valid ids and fields only, no duplicate ids, capped. */
export function accessoriesOf(raw: unknown): GridAccessory[] {
  if (!Array.isArray(raw)) return [];
  const out: GridAccessory[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (out.length >= ACCESSORIES_MAX) break;
    if (!x || typeof x !== "object") continue;
    const id = (x as { id?: unknown }).id;
    if (!isAccessoryId(id) || seen.has(id)) continue;
    const s = sanitizeAccessory(x, id);
    if (!s.ok) continue;
    seen.add(id);
    out.push(s.item);
  }
  return out;
}

export type AccessorySave =
  | { ok: true; items: GridAccessory[]; item: GridAccessory }
  | { ok: false; reason: "no-such-accessory" | "invalid" | "too-many"; error: string };

/**
 * Edit (existing `id`: qty only — part and heading are fixed) or add (no id).
 * Adding a part already under that heading bumps that line's qty (capped)
 * instead of a second row. Never mutates `items`.
 */
export function applyAccessorySave(items: readonly GridAccessory[], raw: unknown, makeId: () => string): AccessorySave {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const editId = typeof r.id === "string" && r.id ? r.id : null;
  if (editId !== null) {
    const cur = items.find((a) => a.id === editId);
    if (!cur) return { ok: false, reason: "no-such-accessory", error: "That accessory was removed — refresh the page." };
    const qty = cleanQty(r.qty);
    if (qty === null) return { ok: false, reason: "invalid", error: QTY_ERROR };
    const item = { ...cur, qty };
    return { ok: true, items: items.map((a) => (a.id === editId ? item : a)), item };
  }
  const s = sanitizeAccessory(r, "");
  if (!s.ok) return { ok: false, reason: "invalid", error: s.error };
  const same = items.find((a) => a.partId === s.item.partId && a.scope === s.item.scope);
  if (same) {
    const item = { ...same, qty: Math.min(ACCESSORY_QTY_MAX, same.qty + s.item.qty) };
    return { ok: true, items: items.map((a) => (a.id === same.id ? item : a)), item };
  }
  if (items.length >= ACCESSORIES_MAX)
    return { ok: false, reason: "too-many", error: `An option holds at most ${ACCESSORIES_MAX} accessories.` };
  const item = { ...s.item, id: makeId() };
  return { ok: true, items: [...items, item], item };
}

export function withoutAccessory(items: readonly GridAccessory[], id: string): GridAccessory[] {
  return items.filter((a) => a.id !== id);
}

/** A copied option's accessories: same content, fresh ids. */
export function copyAccessories(items: readonly GridAccessory[], makeId: () => string): GridAccessory[] {
  return items.map((a) => ({ ...a, id: makeId() }));
}

/** BOM lines in the order the person added them, priced from `parts` —
 *  pass the rows a placement would price from (editor: `parts`; quote:
 *  `tierCatalog`). ext = qty × list, unrounded, like bomLines. */
export function accessoryBomLines(
  items: readonly GridAccessory[],
  parts: ReadonlyArray<Pick<PartLite, "id" | "desc" | "unit" | "list">>
): AccessoryBomLine[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return items.map((a) => {
    const part = byId.get(a.partId);
    const list = part ? part.list : 0;
    return {
      partId: a.partId,
      desc: part ? part.desc : `${a.partId} (removed part — no longer in the catalog)`,
      unit: part ? part.unit : "ea",
      qty: a.qty,
      list,
      ext: a.qty * list,
      accessoryId: a.id,
      group: a.scope,
    };
  });
}

/** The cost basis the quote's margin is computed from (bomTotals' rule). */
export function accessoriesCost(
  items: readonly GridAccessory[],
  parts: ReadonlyArray<Pick<PartLite, "id" | "cost">>
): number {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return items.reduce((a, it) => a + it.qty * (byId.get(it.partId)?.cost || 0), 0);
}

/** The palette's placeable rule (grid-palette.ts). */
const placeable = (p: PartLite) => !p.virtual && p.category !== "Fabric" && p.category !== "Labor";
const byName = (a: PartLite, b: PartLite) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku);

/**
 * The "+ Add accessory" picker's rows. Default: mapped parts (a device type)
 * whose own heading is `group`, narrowed by `search`. `all` ("Search all
 * categories"): every placeable part matching `search` — nothing until
 * something is typed. Name order, capped.
 */
export function accessoryCandidates(parts: readonly PartLite[], group: BomGroupKey, search: string, all: boolean): PartLite[] {
  const q = search.trim().toLowerCase();
  if (all && !q) return [];
  const hit = (p: PartLite) => !q || `${p.desc} ${p.modelNumber || p.sku} ${p.manufacturer || ""}`.toLowerCase().includes(q);
  const inGroup = (p: PartLite) => !!p.deviceType && groupOfPart(p) === group;
  return parts
    .filter((p) => placeable(p) && (all || inGroup(p)) && hit(p))
    .sort(byName)
    .slice(0, ACCESSORY_SEARCH_CAP);
}
