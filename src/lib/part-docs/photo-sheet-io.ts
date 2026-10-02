// SERVER ONLY — exceljs + stores. Never import from a "use client" file.
import ExcelJS from "exceljs";
import { parseCsv } from "@/app/(app)/import/parse";
import type { DriveListedPhoto } from "@/lib/google/drive-photos";
import { cellText } from "@/lib/import/xlsx-to-csv";
import { departmentOfCategory } from "@/lib/portal-departments";
import { list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { allGeneratedSpecs } from "@/lib/stores/generated-specs";
import { listProjects } from "@/lib/stores/grid-projects";
import { allDocumentLinks, allDocuments, detachedDocumentLinks } from "@/lib/stores/part-documents";
import { getDepartments } from "@/lib/stores/portal-departments";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { listDrivePhotosForSheet } from "./drive-photo-sync";
import { buildPartMatcher, driveIdOf, exportRows, PHOTO_SHEET_HEADERS, PHOTO_SHEET_NAME, rowsToGrid, type PartMatcher, type PhotoSheetRow, type SheetImage } from "./photo-sheet";
import { quotedPartStats } from "./quoted-parts";
import { buildImageIndex } from "./views";

/**
 * Catalog photo sheet — the server half's I/O: read an uploaded .xlsx/.csv
 * into a grid, write the workbook, and load everything a plan needs (the
 * catalog matcher, each part's real images, the Drive listing).
 */

export type ListDrive = () => Promise<{ files: DriveListedPhoto[] } | { files: null; reason: string }>;

export async function readSheetFile(buf: Buffer, fileName: string): Promise<{ ok: true; grid: string[][] } | { ok: false; error: string }> {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    const t = parseCsv(buf.toString("utf8"));
    if (!t.ok) return { ok: false, error: t.error || "That CSV couldn't be read." };
    return { ok: true, grid: [t.headers, ...t.rows] };
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn't be read as an Excel workbook or CSV." };
  }
  const ws = wb.worksheets.find((w) => w.name === PHOTO_SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { ok: false, error: "That workbook has no sheets." };
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = sheetCellText(cell.value);
    });
    for (let i = 0; i < cells.length; i++) cells[i] ??= "";
    grid[n - 1] = cells;
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return { ok: true, grid };
}

/** A hyperlinked cell ("Photo" → https://…) reads as its http(s) link, not
 *  its display text; everything else reads as the shared cellText does. */
function sheetCellText(v: ExcelJS.CellValue): string {
  if (v && typeof v === "object" && "hyperlink" in v) {
    const link = String((v as { hyperlink?: unknown }).hyperlink ?? "").trim();
    if (/^https?:\/\//i.test(link)) return link;
  }
  return cellText(v);
}

/** One "Photos" sheet: bold, frozen header; widths sized for the content. */
export async function writePhotoSheet(rows: readonly PhotoSheetRow[], statuses?: ReadonlyMap<number, string>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(PHOTO_SHEET_NAME);
  for (const line of rowsToGrid(rows, statuses)) ws.addRow(line);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const widths: Record<string, number> = { Manufacturer: 18, "MFR Part #": 20, SKU: 22, Description: 40, Category: 16, "Photos now": 11, "Photo 1": 40, "Photo 2": 40, "Photo 3": 40, Status: 40 };
  PHOTO_SHEET_HEADERS.forEach((h, i) => (ws.getColumn(i + 1).width = widths[h]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type PhotoSheetContext = {
  parts: CatalogPart[];
  match: PartMatcher;
  imagesBySku: Map<string, SheetImage[]>;
  imageByUrl: Map<string, string>;
  imageByDriveId: Map<string, string>;
  /** Each part's images a person detached (live documents only). */
  removedBySku: Map<string, SheetImage[]>;
  drive: DriveListedPhoto[] | null;
  driveReason: string;
  driveNames: Map<string, string>;
};

export async function loadPhotoSheetContext(listDrive: ListDrive = listDrivePhotosForSheet): Promise<PhotoSheetContext> {
  const [parts, documents, links, detached, driveList] = await Promise.all([listCatalog(), allDocuments(), allDocumentLinks(), detachedDocumentLinks(), listDrive()]);
  const docsById = new Map(documents.map((d) => [d.id, d] as const));
  const sheetImage = (d: (typeof documents)[number]): SheetImage => ({ id: d.id, source: d.source, sourceUrl: d.sourceUrl, ...(d.sourceRef ? { sourceRef: d.sourceRef } : {}), fileName: d.fileName });
  const imagesBySku = new Map<string, SheetImage[]>();
  for (const [sku, refs] of buildImageIndex(documents, links)) {
    const real: SheetImage[] = [];
    for (const r of refs) {
      const d = docsById.get(r.id);
      if (!d || d.source === "datasheet-render") continue;
      real.push(sheetImage(d));
    }
    if (real.length) imagesBySku.set(sku, real);
  }
  // A detached link stays detached: the planner refuses a cell naming one.
  const removedBySku = new Map<string, SheetImage[]>();
  for (const l of detached) {
    const d = docsById.get(l.documentId);
    if (!d || d.kind !== "image" || d.source === "datasheet-render") continue;
    const list = removedBySku.get(l.partSku);
    if (list) list.push(sheetImage(d));
    else removedBySku.set(l.partSku, [sheetImage(d)]);
  }
  const imageByUrl = new Map<string, string>();
  const imageByDriveId = new Map<string, string>();
  for (const d of documents) {
    if (d.kind !== "image" || d.source === "datasheet-render") continue;
    if (d.sourceUrl && !imageByUrl.has(d.sourceUrl)) imageByUrl.set(d.sourceUrl, d.id);
    const drive = driveIdOf(d);
    if (drive && !imageByDriveId.has(drive)) imageByDriveId.set(drive, d.id);
  }
  const drive = driveList.files;
  return {
    parts,
    match: buildPartMatcher(parts),
    imagesBySku,
    imageByUrl,
    imageByDriveId,
    removedBySku,
    drive,
    driveReason: driveList.files ? "" : driveList.reason,
    driveNames: new Map((drive ?? []).map((f) => [f.id, f.name] as const)),
  };
}

/** Export rows: every part quoted anywhere or in a portal department. */
export async function buildPhotoSheetExport(listDrive: ListDrive = listDrivePhotosForSheet): Promise<PhotoSheetRow[]> {
  const [ctx, quotes, gridProjects, generated, departments] = await Promise.all([loadPhotoSheetContext(listDrive), allQuotes(), listProjects(), allGeneratedSpecs(), getDepartments()]);
  const bySku = new Map(ctx.parts.map((p) => [p.sku, p] as const));
  const stats = quotedPartStats({ quotes, gridProjects, generated }, (sku) => {
    const p = bySku.get(sku);
    return !!p && p.category !== "Labor";
  });
  const deptCats = departmentOfCategory(departments);
  const include = new Set<string>([...stats.keys()]);
  for (const p of ctx.parts) if (deptCats.has(p.category)) include.add(p.sku);
  return exportRows(ctx.parts, include, ctx.imagesBySku, ctx.driveNames);
}
