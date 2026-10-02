/**
 * #296 — the rack-data sheet: the CSV Jeff downloads, fills in and uploads to
 * backfill RU height / depth / weight / watts on catalog parts. Pure (no
 * store/db imports) — the page's client half imports it. Validation is
 * cleanRackFacts', so a sheet cell obeys exactly the rules the part editor does.
 *
 * Import is ADDITIVE: a blank cell is skipped and never clears what's saved.
 */
import { cleanRackFacts, RACK_FACT_LABEL } from "./part-facts";
import { RACK_FACT_KEYS, type RackFactKey, type RackPartFacts } from "./types";

export const RACK_SHEET_HEADERS = [
  "SKU",
  "Manufacturer",
  "Description",
  "Rack mount",
  "RU height",
  "Rack width",
  "Depth (in)",
  "Weight (lb)",
  "Power (W)",
  "Max power (W)",
  "Outlet capacity (W)",
  "Mount face",
  "Airflow",
  "Rack notes",
] as const;

export const MAX_RACK_SHEET_ROWS = 5000;
/** Server actions cap bodies at 1200 KB; the sheet text rides in one. */
export const MAX_RACK_SHEET_BYTES = 800 * 1024;
export const RACK_SHEET_TOO_BIG = "The sheet is too large — split it into files of 5,000 rows or fewer.";
export const RACK_SHEET_NO_SKU = "The sheet needs a SKU column.";

export type RackImportStatus = "updated" | "unchanged" | "unknown-sku" | "invalid";
export type RackImportResult = { line: number; sku: string; status: RackImportStatus; message?: string };

const headerKey = (h: unknown) => String(h ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const CANONICAL: Record<string, (typeof RACK_SHEET_HEADERS)[number]> = {};
for (const h of RACK_SHEET_HEADERS) CANONICAL[headerKey(h)] = h;

/** Sheet header → the catalog key it writes (Manufacturer/Description are informational). */
const KEY_OF_HEADER: Record<string, RackFactKey> = {};
for (const k of RACK_FACT_KEYS) KEY_OF_HEADER[RACK_FACT_LABEL[k]] = k;

const RACK_COLUMNS = RACK_SHEET_HEADERS.filter((h) => h in KEY_OF_HEADER);

export type RackSheetRow = { line: number; sku: string; cells: Record<string, string> };

/**
 * A grid (header row first) → rows. `line` is the row's own number in the file
 * (the header is line 1). Headers match case- and spacing-insensitively;
 * unknown columns are ignored; wholly blank rows are skipped.
 */
export function rackSheetRows(
  grid: readonly (readonly string[])[]
): { ok: true; rows: RackSheetRow[] } | { ok: false; error: string } {
  const col = new Map<string, number>();
  (grid[0] ?? []).forEach((h, i) => {
    const canon = CANONICAL[headerKey(h)];
    if (canon && !col.has(canon)) col.set(canon, i);
  });
  if (!col.has("SKU")) return { ok: false, error: RACK_SHEET_NO_SKU };
  const rows: RackSheetRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r] ?? [];
    const cells: Record<string, string> = {};
    for (const [h, i] of col) cells[h] = String(raw[i] ?? "").trim();
    const sku = cells.SKU ?? "";
    if (Object.values(cells).every((v) => !v)) continue;
    rows.push({ line: r + 1, sku, cells });
  }
  return { ok: true, rows };
}

/** The additive patch a row carries: non-blank rack cells only, validated by cleanRackFacts. */
export function rackSheetPatch(
  cells: Record<string, string>
): { ok: true; patch: Partial<RackPartFacts> } | { ok: false; error: string } {
  const input: Record<string, unknown> = {};
  for (const h of RACK_COLUMNS) {
    const v = String(cells[h] ?? "").trim();
    if (v) input[KEY_OF_HEADER[h]] = v;
  }
  return cleanRackFacts(input);
}

const cellOf = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** Export grid: header row, then one row per part with whatever it already carries. */
export function rackSheetExportGrid(
  parts: ReadonlyArray<{ sku: string; mfr?: string; desc: string } & Partial<RackPartFacts>>
): string[][] {
  const grid: string[][] = [[...RACK_SHEET_HEADERS]];
  for (const p of parts) {
    const facts = p as Partial<Record<RackFactKey, unknown>>;
    grid.push(
      RACK_SHEET_HEADERS.map((h) => {
        if (h === "SKU") return p.sku;
        if (h === "Manufacturer") return p.mfr ?? "";
        if (h === "Description") return p.desc;
        return cellOf(facts[KEY_OF_HEADER[h]]);
      })
    );
  }
  return grid;
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV text for a grid — CRLF rows, UTF-8 BOM so Excel reads accents and keeps the columns. */
export function rackSheetCsv(grid: readonly (readonly string[])[]): string {
  return "﻿" + grid.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** "12 updated · 3 unchanged · 1 unknown SKU · 2 invalid" — zero counts left out. */
export function rackImportSummary(results: readonly RackImportResult[]): string {
  const n = (s: RackImportStatus) => results.filter((r) => r.status === s).length;
  const bits: string[] = [];
  if (n("updated")) bits.push(`${n("updated")} updated`);
  if (n("unchanged")) bits.push(`${n("unchanged")} unchanged`);
  if (n("unknown-sku")) bits.push(`${n("unknown-sku")} unknown SKU`);
  if (n("invalid")) bits.push(`${n("invalid")} invalid`);
  return bits.join(" · ") || "No rows to import";
}
