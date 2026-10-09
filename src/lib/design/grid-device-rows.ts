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
};

export type DeviceColumnKey = "designator" | "type" | "model" | "desc" | "space" | "sheet" | "qty" | "category";
export type DeviceColumn = { key: DeviceColumnKey; label: string; width: number; editable?: boolean; mono?: boolean };
export type EditCol = "designator" | "category";

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
];

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
      display: formatDesignator(designator, qty),
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
  }
}

/** null = reading order. Ties keep reading order. */
export function sortDeviceRows(rows: readonly DeviceRow[], sort: DeviceSort): DeviceRow[] {
  const out = [...rows];
  if (!sort) return out.sort((a, b) => a.order - b.order);
  return out.sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    const c = typeof x === "number" && typeof y === "number" ? x - y : byText(String(x), String(y));
    return c * sort.dir || a.order - b.order;
  });
}

export function cellText(r: DeviceRow, key: DeviceColumnKey): string {
  if (key === "designator") return r.display;
  if (key === "qty") return String(r.qty);
  return String(sortValue(r, key));
}

/** Where an edit goes next: down / up stay in the column; right goes
 *  Designator → Category → the next row's Designator; left the reverse. */
export function nextCell(rows: readonly DeviceRow[], id: string, col: EditCol, move: "down" | "up" | "right" | "left"): { id: string; col: EditCol } | null {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  if (move === "down") return i + 1 < rows.length ? { id: rows[i + 1].id, col } : null;
  if (move === "up") return i > 0 ? { id: rows[i - 1].id, col } : null;
  if (move === "right") return col === "designator" ? { id, col: "category" } : i + 1 < rows.length ? { id: rows[i + 1].id, col: "designator" } : null;
  return col === "category" ? { id, col: "designator" } : i > 0 ? { id: rows[i - 1].id, col: "category" } : null;
}
