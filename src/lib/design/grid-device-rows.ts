/**
 * The Grid's Spreadsheet → Devices tab model (#320): one row per non-curtain
 * placement of the option, in reading order, plus the column list, filters,
 * sort and cell-to-cell movement. Pure and client-safe (the grid-bom rule);
 * the table component only renders this. A later slice adds a device field
 * by adding a column to DEVICE_COLUMNS and a case to cellText/sortValue.
 */
import type { GridPlacement, GridSpace } from "@/lib/stores/grid-projects";
import { placementQty } from "./grid-bom";
import { spaceOf } from "./grid-geometry";
import { normalizeCategory } from "./grid-scopes";
import { cleanDesignator, formatDesignator, readingOrder } from "./designators";
import { cleanPlacementTag, effectiveTag, TAG_LIMITS, type EffectiveTag, type PlacementTag, type TagFields } from "./conduit-riser/tags";

export type DeviceRow = {
  id: string;
  /** Reading-order position — the default sort. */
  order: number;
  /** Stored designator ("" when none) — what an edit starts from. */
  designator: string;
  /** What the cell shows (a lot's range). */
  display: string;
  typeKey: string;
  typeLabel: string;
  model: string;
  desc: string;
  spaceId: string | null;
  space: string;
  sheetId: string;
  /** Sheet name, with "· p<n>" past page 1. */
  sheet: string;
  page: number;
  qty: number;
  category: string;
  duplicate: boolean;
  /** #321: the riser tag as printed — the device's own fields over its part's defaults (location: its space). */
  tag: EffectiveTag;
  /** #321: just the device's own overrides; a field absent here is inherited. */
  own: PlacementTag;
};

/** #321: the riser tag fields, in tag order — each is also a Devices column. */
export const TAG_COLUMN_KEYS = ["box", "face", "mount", "height", "pd", "location", "power", "contents"] as const;
export type TagColumnKey = (typeof TAG_COLUMN_KEYS)[number];
export const isTagColumn = (key: string): key is TagColumnKey => (TAG_COLUMN_KEYS as readonly string[]).includes(key);

export type DeviceColumnKey = "designator" | "type" | "model" | "desc" | "space" | "sheet" | "qty" | "category" | TagColumnKey;
export type DeviceColumn = { key: DeviceColumnKey; label: string; width: number; editable?: boolean; mono?: boolean };
export type EditCol = "designator" | "category" | TagColumnKey;

/** Width 0 = takes the rest of the row. */
export const DEVICE_COLUMNS: readonly DeviceColumn[] = [
  { key: "designator", label: "Designator", width: 120, editable: true, mono: true },
  { key: "type", label: "Type", width: 140 },
  { key: "model", label: "Model", width: 130, mono: true },
  { key: "desc", label: "Description", width: 0 },
  { key: "space", label: "Space", width: 120 },
  { key: "sheet", label: "Sheet", width: 120 },
  { key: "qty", label: "Qty", width: 52 },
  { key: "category", label: "Category", width: 130, editable: true },
  // #321 riser tag fields — all editable; a blank cell falls back to the part's default.
  { key: "box", label: "Box", width: 52, editable: true, mono: true },
  { key: "face", label: "Face", width: 64, editable: true, mono: true },
  { key: "mount", label: "Mount", width: 56, editable: true, mono: true },
  { key: "height", label: "Ht", width: 64, editable: true, mono: true },
  { key: "pd", label: "P/D", width: 52, editable: true, mono: true },
  { key: "location", label: "Location", width: 120, editable: true },
  { key: "power", label: "Pwr", width: 48, editable: true, mono: true },
  { key: "contents", label: "Contents", width: 150, editable: true },
];

/** The columns a cell edit can visit, in table order — what Tab walks. */
export const EDIT_COLUMNS: readonly EditCol[] = DEVICE_COLUMNS.filter((c) => c.editable).map((c) => c.key as EditCol);

export const NO_SPACE = "__none";
export type DeviceFilter = { type?: string; space?: string; sheet?: string };
export type DeviceSort = { key: DeviceColumnKey; dir: 1 | -1 } | null;

export type DeviceRowInput = {
  placements: readonly GridPlacement[];
  /** In sheet order. */
  sheets: ReadonlyArray<{ id: string; name: string }>;
  spaces: readonly GridSpace[];
  typeKeyOf: (pl: GridPlacement) => string;
  typeLabelOf: (key: string) => string;
  modelOf: (pl: GridPlacement) => string;
  descOf: (pl: GridPlacement) => string;
  duplicates: ReadonlySet<string>;
  /** #321: designator number padding (2 = CRO-01); absent = 1. */
  digits?: 1 | 2;
  /** #321: a device's part's riser tag defaults; absent = none. */
  tagDefaultsOf?: (pl: GridPlacement) => TagFields | undefined;
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function deviceRows(i: DeviceRowInput): DeviceRow[] {
  const sheetName = new Map(i.sheets.map((s) => [s.id, s.name]));
  const spaces = [...i.spaces];
  const devices = i.placements.filter((pl) => !pl.curtain);
  return readingOrder(devices, { sheetIds: i.sheets.map((s) => s.id), spaces }).map((pl, order) => {
    const home = spaceOf(pl, spaces);
    const typeKey = i.typeKeyOf(pl);
    const qty = placementQty(pl);
    const designator = cleanDesignator(pl.designator) ?? "";
    const name = sheetName.get(pl.sheetId) ?? "—";
    return {
      id: pl.id,
      order,
      designator,
      display: formatDesignator(designator, qty, i.digits),
      typeKey,
      typeLabel: i.typeLabelOf(typeKey),
      model: i.modelOf(pl),
      desc: i.descOf(pl),
      spaceId: home?.id ?? null,
      space: home?.name ?? "—",
      sheetId: pl.sheetId,
      sheet: pl.page > 1 ? `${name} · p${pl.page}` : name,
      page: pl.page,
      qty,
      category: normalizeCategory(pl.category) ?? "",
      duplicate: i.duplicates.has(pl.id),
      tag: effectiveTag(pl.tag, i.tagDefaultsOf?.(pl), home?.name ?? ""),
      own: pl.tag ?? {},
    };
  });
}

export function filterDeviceRows(rows: readonly DeviceRow[], f: DeviceFilter): DeviceRow[] {
  return rows.filter(
    (r) =>
      (!f.type || r.typeKey === f.type) &&
      (!f.space || (f.space === NO_SPACE ? r.spaceId === null : r.spaceId === f.space)) &&
      (!f.sheet || r.sheetId === f.sheet)
  );
}

export function sortValue(r: DeviceRow, key: DeviceColumnKey): string | number {
  switch (key) {
    case "designator":
      return r.designator;
    case "type":
      return r.typeLabel;
    case "model":
      return r.model;
    case "desc":
      return r.desc;
    case "space":
      return r.space;
    case "sheet":
      return r.sheet;
    case "qty":
      return r.qty;
    case "category":
      return r.category;
    case "box":
    case "face":
    case "mount":
    case "height":
    case "pd":
    case "location":
    case "power":
    case "contents":
      return r.tag[key];
  }
}

/** null = reading order. Ties keep reading order; blank text cells sort last in both directions. */
export function sortDeviceRows(rows: readonly DeviceRow[], sort: DeviceSort): DeviceRow[] {
  const out = [...rows];
  if (!sort) return out.sort((a, b) => a.order - b.order);
  return out.sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir || a.order - b.order;
    // A blank cell (no designator, no category…) sorts last whichever way the column runs.
    const xb = String(x) === "";
    const yb = String(y) === "";
    if (xb !== yb) return xb ? 1 : -1;
    return byText(String(x), String(y)) * sort.dir || a.order - b.order;
  });
}

export function cellText(r: DeviceRow, key: DeviceColumnKey): string {
  if (key === "designator") return r.display;
  if (key === "qty") return String(r.qty);
  return String(sortValue(r, key));
}

/** Where an edit goes next: down / up stay in the column; right walks the
 *  editable columns in table order, then on to the next row's first; left the reverse. */
export function nextCell(rows: readonly DeviceRow[], id: string, col: EditCol, move: "down" | "up" | "right" | "left"): { id: string; col: EditCol } | null {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  if (move === "down") return i + 1 < rows.length ? { id: rows[i + 1].id, col } : null;
  if (move === "up") return i > 0 ? { id: rows[i - 1].id, col } : null;
  const c = EDIT_COLUMNS.indexOf(col);
  if (move === "right") {
    if (c >= 0 && c + 1 < EDIT_COLUMNS.length) return { id, col: EDIT_COLUMNS[c + 1] };
    return i + 1 < rows.length ? { id: rows[i + 1].id, col: EDIT_COLUMNS[0] } : null;
  }
  if (c > 0) return { id, col: EDIT_COLUMNS[c - 1] };
  return i > 0 ? { id: rows[i - 1].id, col: EDIT_COLUMNS[EDIT_COLUMNS.length - 1] } : null;
}

/* ------------------------------ riser tag edits (#321) ------------------------------ */

/** Longest text a tag column takes (the P/D cell is at most "P/D"). */
export const TAG_INPUT_MAX: Record<TagColumnKey, number> = { ...TAG_LIMITS, pd: 3 };

export const PD_PROBLEM = "P/D takes P, D, P/D or nothing.";

/** The P/D cell's text: "p / d" → "P/D"; blank → ""; anything else → null. */
export function parsePd(text: string): "P" | "D" | "P/D" | "" | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, "");
  return t === "P" || t === "D" || t === "P/D" || t === "" ? t : null;
}

/**
 * One tag field edited on a device that already carries `own` overrides. A
 * blank removes that field's override (the part's default shows again); no
 * overrides left = `tag: null`. `changed` says whether anything differs, so a
 * click-away with no edit writes nothing.
 */
export function tagAfterEdit(
  own: PlacementTag | undefined,
  field: TagColumnKey,
  text: string
): { ok: true; tag: PlacementTag | null; changed: boolean } | { ok: false; error: string } {
  let value = text;
  if (field === "pd") {
    const pd = parsePd(text);
    if (pd === null) return { ok: false, error: PD_PROBLEM };
    value = pd;
  }
  const next: Record<string, string> = { ...(own || {}) };
  const cleaned = value.trim() === "" ? undefined : (cleanPlacementTag({ [field]: value }) as Record<string, string> | undefined)?.[field];
  if (cleaned === undefined || cleaned === "") delete next[field];
  else next[field] = cleaned;
  const tag = Object.keys(next).length ? (next as PlacementTag) : null;
  return { ok: true, tag, changed: ((own as Record<string, string> | undefined)?.[field] ?? "") !== (next[field] ?? "") };
}

/** Set one tag field on several devices, each keeping its other fields. Only
 *  devices whose tag would change are returned. */
export function bulkTagItems(
  pls: ReadonlyArray<{ id: string; tag?: PlacementTag }>,
  field: TagColumnKey,
  text: string
): { ok: true; items: { id: string; tag: PlacementTag | null }[] } | { ok: false; error: string } {
  const items: { id: string; tag: PlacementTag | null }[] = [];
  for (const pl of pls) {
    const r = tagAfterEdit(pl.tag, field, text);
    if (!r.ok) return r;
    if (r.changed) items.push({ id: pl.id, tag: r.tag });
  }
  return { ok: true, items };
}
