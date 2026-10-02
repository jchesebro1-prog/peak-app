import { normalizeSku } from "@/lib/davinci/sku";
import type { PartDocumentSource } from "./types";

/**
 * Catalog photo sheet (spec 2026-10-01-catalog-photo-sheet-design.md) — the
 * pure half: the sheet's columns, grid ↔ rows, row → part matching, what each
 * Photo slot shows on export, and where a new image lands in a part's
 * gallery. No I/O; safe in client components.
 */

export const PHOTO_SHEET_NAME = "Photos";
export const PHOTO_SLOTS = 3;
export const PHOTO_SHEET_HEADERS = ["Manufacturer", "MFR Part #", "SKU", "Description", "Category", "Photos now", "Photo 1", "Photo 2", "Photo 3", "Status"] as const;
export const MAX_SHEET_ROWS = 5000;
/** Server actions cap bodies at 1200 KB, and the results sheet re-sends the file. */
export const MAX_SHEET_BYTES = 800 * 1024;

export type PhotoSheetRow = {
  /** The row's own number in the sheet (the header is row 1). */
  rowNumber: number;
  manufacturer: string;
  mfrPart: string;
  sku: string;
  description: string;
  category: string;
  photosNow: string;
  /** Always PHOTO_SLOTS long; "" = empty slot. */
  photos: string[];
  status: string;
};

/** What an import needs from a row — what the browser sends back per batch. */
export type ImportRow = Pick<PhotoSheetRow, "rowNumber" | "manufacturer" | "mfrPart" | "sku" | "photos">;

type Field = "manufacturer" | "mfrPart" | "sku" | "description" | "category" | "photosNow" | "photo1" | "photo2" | "photo3" | "status";
const HEADER_FIELD: Record<string, Field> = {
  manufacturer: "manufacturer",
  "mfr part #": "mfrPart",
  sku: "sku",
  description: "description",
  category: "category",
  "photos now": "photosNow",
  "photo 1": "photo1",
  "photo 2": "photo2",
  "photo 3": "photo3",
  status: "status",
};

const headerKey = (h: unknown) => String(h ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const lower = (s: string | undefined) => String(s ?? "").trim().toLowerCase();

export function rowsFromGrid(grid: readonly (readonly string[])[]): { ok: true; rows: PhotoSheetRow[] } | { ok: false; error: string } {
  const col = new Map<Field, number>();
  (grid[0] ?? []).forEach((h, i) => {
    const f = HEADER_FIELD[headerKey(h)];
    if (f && !col.has(f)) col.set(f, i);
  });
  if (!col.has("photo1") || (!col.has("mfrPart") && !col.has("sku"))) {
    return { ok: false, error: "This doesn't look like a photo sheet — it needs a Photo 1 column and an MFR Part # or SKU column." };
  }
  const rows: PhotoSheetRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const get = (f: Field) => {
      const i = col.get(f);
      return i == null ? "" : String(cells[i] ?? "").trim();
    };
    const row: PhotoSheetRow = {
      rowNumber: r + 1,
      manufacturer: get("manufacturer"),
      mfrPart: get("mfrPart"),
      sku: get("sku"),
      description: get("description"),
      category: get("category"),
      photosNow: get("photosNow"),
      photos: [get("photo1"), get("photo2"), get("photo3")],
      status: get("status"),
    };
    if (!row.manufacturer && !row.mfrPart && !row.sku && row.photos.every((p) => !p)) continue;
    rows.push(row);
  }
  if (rows.length > MAX_SHEET_ROWS) return { ok: false, error: `That sheet has ${rows.length} rows — split it into sheets of ${MAX_SHEET_ROWS} or fewer.` };
  return { ok: true, rows };
}

/** Header + one line per row; `statuses` (by rowNumber) overrides Status. */
export function rowsToGrid(rows: readonly PhotoSheetRow[], statuses?: ReadonlyMap<number, string>): string[][] {
  return [
    [...PHOTO_SHEET_HEADERS],
    ...rows.map((r) => [r.manufacturer, r.mfrPart, r.sku, r.description, r.category, r.photosNow, ...r.photos.slice(0, PHOTO_SLOTS), statuses?.get(r.rowNumber) ?? r.status]),
  ];
}

export function toImportRows(rows: readonly PhotoSheetRow[]): ImportRow[] {
  return rows
    .filter((r) => r.photos.some((p) => p.trim()))
    .map((r) => ({ rowNumber: r.rowNumber, manufacturer: r.manufacturer, mfrPart: r.mfrPart, sku: r.sku, photos: [...r.photos] }));
}

export type SheetPart = { sku: string; desc: string; category: string; mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string };
export type RowMatch = { kind: "matched"; sku: string } | { kind: "none" } | { kind: "ambiguous"; skus: string[] };
export type PartMatcher = (row: Pick<ImportRow, "manufacturer" | "mfrPart" | "sku">) => RowMatch;

/** Manufacturer + MFR P/N (or M/N), normalized like the filename rule; SKU
 *  narrows; a SKU-only row matches by SKU. Labor is never a target. */
export function buildPartMatcher(parts: readonly SheetPart[]): PartMatcher {
  const byKey = new Map<string, SheetPart[]>();
  const bySku = new Map<string, SheetPart[]>();
  const push = (m: Map<string, SheetPart[]>, k: string, p: SheetPart) => {
    const l = m.get(k);
    if (l) l.push(p);
    else m.set(k, [p]);
  };
  for (const p of parts) {
    if (p.category === "Labor") continue;
    for (const k of new Set([normalizeSku(p.manufacturerPartNumber || ""), normalizeSku(p.manufacturerModelNumber || "")])) if (k) push(byKey, k, p);
    push(bySku, lower(p.sku), p);
  }
  return (row) => {
    const key = normalizeSku(row.mfrPart || "");
    const sku = lower(row.sku);
    let cands: SheetPart[];
    if (key) {
      cands = byKey.get(key) ?? [];
      const mfr = lower(row.manufacturer);
      if (mfr) cands = cands.filter((p) => lower(p.mfr) === mfr);
      if (sku) cands = cands.filter((p) => lower(p.sku) === sku);
    } else if (sku) {
      cands = bySku.get(sku) ?? [];
    } else {
      return { kind: "none" };
    }
    const skus = [...new Set(cands.map((p) => p.sku))];
    if (skus.length === 1) return { kind: "matched", sku: skus[0] };
    return skus.length ? { kind: "ambiguous", skus } : { kind: "none" };
  };
}

export type SheetImage = { id: string; source: PartDocumentSource; sourceUrl: string | null; sourceRef?: string; fileName: string };

/** The Drive file an image came from — a #283 sync photo or a sheet one. */
export function driveIdOf(img: Pick<SheetImage, "source" | "sourceRef">): string | null {
  if (img.source === "drive" && img.sourceRef) return img.sourceRef;
  if (img.source === "sheet" && img.sourceRef?.startsWith("drive:")) return img.sourceRef.slice(6) || null;
  return null;
}

/** The dropped file name a sheet image came from. */
export function droppedNameOf(img: Pick<SheetImage, "source" | "sourceRef">): string | null {
  return img.source === "sheet" && img.sourceRef?.startsWith("file:") ? img.sourceRef.slice(5) || null : null;
}

/** What a Photo slot shows on export — and what a re-import treats as "already there". */
export function slotSource(img: SheetImage, driveNames: ReadonlyMap<string, string>): string {
  const d = driveIdOf(img);
  if (d && driveNames.has(d)) return driveNames.get(d)!;
  const f = droppedNameOf(img);
  if (f) return f;
  return img.sourceUrl || img.fileName;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** `imagesBySku` holds each part's REAL images (no datasheet-render), in gallery order. */
export function exportRows(
  parts: readonly SheetPart[],
  include: ReadonlySet<string>,
  imagesBySku: ReadonlyMap<string, readonly SheetImage[]>,
  driveNames: ReadonlyMap<string, string>
): PhotoSheetRow[] {
  const rows = parts
    .filter((p) => include.has(p.sku) && p.category !== "Labor")
    .map((p) => {
      const imgs = imagesBySku.get(p.sku) ?? [];
      return {
        rowNumber: 0,
        manufacturer: p.mfr ?? "",
        mfrPart: p.manufacturerPartNumber || p.manufacturerModelNumber || "",
        sku: p.sku,
        description: p.desc,
        category: p.category,
        photosNow: String(imgs.length),
        photos: Array.from({ length: PHOTO_SLOTS }, (_, i) => (imgs[i] ? slotSource(imgs[i], driveNames) : "")),
        status: imgs.length ? `Has ${imgs.length}` : "Missing",
      };
    });
  rows.sort((a, b) => Number(a.photosNow !== "0") - Number(b.photosNow !== "0") || byText(a.manufacturer, b.manufacturer) || byText(a.mfrPart, b.mfrPart) || byText(a.sku, b.sku));
  rows.forEach((r, i) => (r.rowNumber = i + 2));
  return rows;
}

/** The full image order after placing `id` (already linked): front when
 *  primary, else last among real photos; datasheet-render thumbnails last. */
export function placeNewImage(ordered: readonly { id: string; source: PartDocumentSource }[], id: string, primary: boolean): string[] {
  const others = ordered.filter((i) => i.id !== id);
  const real = others.filter((i) => i.source !== "datasheet-render").map((i) => i.id);
  const auto = others.filter((i) => i.source === "datasheet-render").map((i) => i.id);
  return primary ? [id, ...real, ...auto] : [...real, id, ...auto];
}

/** Drive file ids a sheet import owns — the Drive sync leaves these alone. */
export function sheetDriveClaims(docs: readonly Pick<SheetImage, "source" | "sourceRef">[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs) if (d.source === "sheet") {
    const id = driveIdOf(d);
    if (id) out.add(id);
  }
  return out;
}
