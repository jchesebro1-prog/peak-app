import { sanitizeDiscipline, type ScopeDiscipline } from "@/lib/estimate-output/fields";

/**
 * Estimator Phase 6 — System categories (spec §13). Admin-editable categories
 * ("Controls", "Fixtures"…) whose typical catalog parts drop into a new system
 * from "+ Add system". Pure: types, defaults, the sanitizer (the one gate every
 * save and read passes through) and the list operations the admin page uses.
 * Every operation returns the SAME list reference when nothing changed.
 * Persistence is src/lib/stores/system-categories.ts (one settings blob).
 */

export const SYSTEM_CATEGORIES_BLOB = "system_categories";

export const MAX_CATEGORIES = 40;
export const MAX_ITEMS = 100;
export const QTY_MIN = 0.01;
export const QTY_MAX = 100_000;
export const NAME_MAX = 60;
export const NOTE_MAX = 200;
export const SKU_MAX = 120;

export type CategoryItem = { sku: string; qty: number; note?: string };
export type SystemCategory = { id: string; name: string; discipline?: ScopeDiscipline; items: CategoryItem[] };

const DEFAULT_NAMES = ["Controls", "Fixtures", "Rigging", "Video", "Infrastructure", "Wireless", "Communications"] as const;

/** The seven starter categories, empty item lists, stable ids (`cat-controls`…). */
export const DEFAULT_SYSTEM_CATEGORIES: readonly SystemCategory[] = DEFAULT_NAMES.map((name) => ({
  id: `cat-${name.toLowerCase()}`,
  name,
  items: [],
}));

/** A fresh `cat-<base36>` id. */
export function newCategoryId(): string {
  return "cat-" + Date.now().toString(36) + Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, "0");
}

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

export function cleanQty(v: unknown): number {
  // Blank / whitespace is "no quantity given", like junk (Number("") would be 0).
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.round(n * 100) / 100 || QTY_MIN));
}

function cleanItems(raw: unknown): CategoryItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CategoryItem[] = [];
  for (const r of raw) {
    if (out.length >= MAX_ITEMS) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const sku = clean(o.sku, SKU_MAX);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const note = clean(o.note, NOTE_MAX);
    out.push({ sku, qty: cleanQty(o.qty), ...(note ? { note } : {}) });
  }
  return out;
}

/**
 * Whatever arrives (the blob object `{ categories }`, a bare array, junk) →
 * a valid list: ≤ 40 categories with a name, unique `cat-` ids, optional
 * discipline, ≤ 100 unique-SKU items, qty 0.01–100,000. Missing/non-list input
 * → the seven defaults; a real empty list stays empty.
 */
export function sanitizeSystemCategories(raw: unknown): SystemCategory[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).categories)
      ? ((raw as Record<string, unknown>).categories as unknown[])
      : null;
  if (!arr) return DEFAULT_SYSTEM_CATEGORIES.map((c) => ({ ...c, items: [] }));
  const ids = new Set<string>();
  const out: SystemCategory[] = [];
  for (const r of arr) {
    if (out.length >= MAX_CATEGORIES) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = clean(o.name, NAME_MAX);
    if (!name) continue;
    let id = clean(o.id, 40);
    if (!/^cat-[a-z0-9-]+$/.test(id) || ids.has(id)) {
      do id = newCategoryId();
      while (ids.has(id));
    }
    ids.add(id);
    const discipline = sanitizeDiscipline(o.discipline);
    out.push({ id, name, ...(discipline ? { discipline } : {}), items: cleanItems(o.items) });
  }
  return out;
}

/* ---------------- list operations (same reference when unchanged) ---------------- */

type List = readonly SystemCategory[];

function patchCat(list: List, id: string, fn: (c: SystemCategory) => SystemCategory): List {
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return list;
  const next = fn(list[i]);
  if (next === list[i]) return list;
  const out = list.slice();
  out[i] = next;
  return out;
}

function swap<T>(arr: readonly T[], i: number, dir: -1 | 1): readonly T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function addCategory(list: List, name: string, id: string = newCategoryId()): List {
  const n = clean(name, NAME_MAX);
  if (!n || list.length >= MAX_CATEGORIES || list.some((c) => c.id === id)) return list;
  return [...list, { id, name: n, items: [] }];
}

export function renameCategory(list: List, id: string, name: string): List {
  const n = clean(name, NAME_MAX);
  if (!n) return list;
  return patchCat(list, id, (c) => (c.name === n ? c : { ...c, name: n }));
}

export function removeCategory(list: List, id: string): List {
  return list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list;
}

export function moveCategory(list: List, id: string, dir: -1 | 1): List {
  return swap(list, list.findIndex((c) => c.id === id), dir) as List;
}

/** `null`/blank/unknown clears the discipline. */
export function setCategoryDiscipline(list: List, id: string, discipline: unknown): List {
  const d = sanitizeDiscipline(discipline);
  return patchCat(list, id, (c) => {
    if ((c.discipline ?? null) === d) return c;
    const { discipline: _drop, ...rest } = c;
    void _drop;
    return d ? { ...rest, discipline: d } : rest;
  });
}

/** Appends a SKU (qty 1 unless given); a SKU already in the category, a blank SKU, or a full category changes nothing. */
export function addItem(list: List, id: string, sku: string, qty: unknown = 1): List {
  const s = clean(sku, SKU_MAX);
  if (!s) return list;
  return patchCat(list, id, (c) =>
    c.items.length >= MAX_ITEMS || c.items.some((it) => it.sku === s) ? c : { ...c, items: [...c.items, { sku: s, qty: cleanQty(qty) }] },
  );
}

export function removeItem(list: List, id: string, sku: string): List {
  return patchCat(list, id, (c) => (c.items.some((it) => it.sku === sku) ? { ...c, items: c.items.filter((it) => it.sku !== sku) } : c));
}

export function setItemQty(list: List, id: string, sku: string, qty: unknown): List {
  const q = cleanQty(qty);
  return patchCat(list, id, (c) => {
    const i = c.items.findIndex((it) => it.sku === sku);
    if (i < 0 || c.items[i].qty === q) return c;
    const items = c.items.slice();
    items[i] = { ...items[i], qty: q };
    return { ...c, items };
  });
}

export function setItemNote(list: List, id: string, sku: string, note: unknown): List {
  const n = clean(note, NOTE_MAX);
  return patchCat(list, id, (c) => {
    const i = c.items.findIndex((it) => it.sku === sku);
    if (i < 0 || (c.items[i].note ?? "") === n) return c;
    const items = c.items.slice();
    const { note: _drop, ...rest } = items[i];
    void _drop;
    items[i] = n ? { ...rest, note: n } : rest;
    return { ...c, items };
  });
}

export function moveItem(list: List, id: string, sku: string, dir: -1 | 1): List {
  return patchCat(list, id, (c) => {
    const items = swap(c.items, c.items.findIndex((it) => it.sku === sku), dir);
    return items === c.items ? c : { ...c, items: items as CategoryItem[] };
  });
}
