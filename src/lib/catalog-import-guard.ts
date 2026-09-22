/**
 * Catalog import guards (PUNCHLIST #132, #134; D157). Pure and DB-free —
 * callers pass the catalog in — so the Catalog page importer, the Import
 * hub's `catalog` type (server commit AND client preview via a server
 * action) and the spec harness share one definition of "wrong manufacturer"
 * and "too big".
 */
import { mfrKey } from "./catalog-books";

/** 1 MB, exactly. Applies to the CSV/TSV file, the pasted text, and .xlsx uploads for the catalog type. */
export const MAX_CATALOG_IMPORT_BYTES = 1_048_576;

export type SizeCheck = { ok: true } | { ok: false; error: string };

export function formatBytes(n: number): string {
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return Math.round(n) + " B";
}

export function checkSize(bytes: number): SizeCheck {
  if (!Number.isFinite(bytes) || bytes < 0) return { ok: false, error: "Couldn't read the file size — try the upload again." };
  if (bytes <= MAX_CATALOG_IMPORT_BYTES) return { ok: true };
  return {
    ok: false,
    error: `That file is ${formatBytes(bytes)} — the catalog import limit is 1 MB. Split the price list into smaller files, or remove columns you don't need.`,
  };
}

export type ManufacturerCheck =
  | { ok: true; normalizedMfr: string; isNew: boolean; overlap: number }
  | { ok: false; reason: "missing"; detail: string }
  | { ok: false; reason: "no-overlap"; detail: string }
  | { ok: false; reason: "foreign-skus"; detail: string; examples: Array<{ sku: string; mfr: string }>; total: number };

type CatalogRef = { sku: string; mfr?: string };

/** SKUs compare case/punctuation-insensitively — the same `norm` the Import
 *  hub's dedupe (`ci()` in import/registry) already uses for SKUs. */
function skuKey(sku: string): string {
  return mfrKey(sku);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The wrong-manufacturer double check (#132):
 * - blank → `missing`;
 * - the name normalizes (mfrKey) to an existing manufacturer → that spelling
 *   is used (`normalizedMfr`), so "meyer-sound" files under "Meyer Sound";
 * - any file SKU filed under a DIFFERENT manufacturer → `foreign-skus`
 *   (checked first: it names exactly which rows are wrong);
 * - the manufacturer already has parts and the file overlaps none of them →
 *   `no-overlap` (the whole file is probably the wrong manufacturer);
 * - a new manufacturer, or any overlap → ok.
 * Unbranded parts (no mfr) are never foreign: importing them under a
 * manufacturer is how they get one.
 */
export function checkManufacturer(input: {
  mfr: string;
  fileSkus: string[];
  catalog: CatalogRef[];
}): ManufacturerCheck {
  const typed = (input.mfr || "").trim();
  const key = mfrKey(typed);
  if (!key) {
    return { ok: false, reason: "missing", detail: "Choose a manufacturer for this price list — every imported part is filed under one." };
  }

  const spellings = new Map<string, number>();
  const mine = new Set<string>();
  const foreignBySku = new Map<string, string>();
  for (const p of input.catalog) {
    const pm = (p.mfr || "").trim();
    const pk = mfrKey(pm);
    if (!pk) continue;
    if (pk === key) {
      spellings.set(pm, (spellings.get(pm) || 0) + 1);
      mine.add(skuKey(p.sku));
    } else {
      foreignBySku.set(skuKey(p.sku), pm);
    }
  }
  const normalizedMfr = spellings.size
    ? [...spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
    : typed;

  const fileSkus = Array.from(new Set(input.fileSkus.map((s) => (s || "").trim()).filter(Boolean)));
  const n = fileSkus.length;

  const foreign = fileSkus
    .filter((s) => foreignBySku.has(skuKey(s)) && !mine.has(skuKey(s)))
    .map((s) => ({ sku: s, mfr: foreignBySku.get(skuKey(s)) as string }));
  if (foreign.length) {
    const examples = foreign.slice(0, 10);
    const more = foreign.length - examples.length;
    return {
      ok: false,
      reason: "foreign-skus",
      total: foreign.length,
      examples,
      detail:
        `${foreign.length} of the ${plural(n, "SKU")} in this file ${foreign.length === 1 ? "is" : "are"} filed under a different manufacturer: ` +
        examples.map((e) => `${e.sku} is filed under ${e.mfr}`).join("; ") +
        (more > 0 ? ` (+${more} more)` : "") +
        ". Pick the right manufacturer, or remove those rows.",
    };
  }

  const overlap = fileSkus.filter((s) => mine.has(skuKey(s))).length;
  if (mine.size > 0 && n > 0 && overlap === 0) {
    return {
      ok: false,
      reason: "no-overlap",
      detail: `None of the ${plural(n, "SKU")} in this file belong to ${normalizedMfr} (${plural(mine.size, "part")} on file); pick the right manufacturer.`,
    };
  }
  return { ok: true, normalizedMfr, isNew: mine.size === 0, overlap };
}

export type ManufacturerGroup = { mfr: string; skus: string[] };

/** Rows → one group per mfrKey, keeping the first spelling seen. Blank
 *  manufacturers form their own group (which then fails as `missing`). */
export function groupRowsByManufacturer(rows: Array<{ mfr: string; sku: string }>): ManufacturerGroup[] {
  const by = new Map<string, ManufacturerGroup>();
  for (const r of rows) {
    const mfr = (r.mfr || "").trim();
    const key = mfrKey(mfr);
    const g = by.get(key) || { mfr, skus: [] };
    const sku = (r.sku || "").trim();
    if (sku) g.skus.push(sku);
    by.set(key, g);
  }
  return [...by.values()];
}

export type GroupCheck = { mfr: string; count: number; result: ManufacturerCheck };

export function checkManufacturerGroups(groups: ManufacturerGroup[], catalog: CatalogRef[]): GroupCheck[] {
  return groups.map((g) => ({
    mfr: g.mfr,
    count: g.skus.length,
    result: checkManufacturer({ mfr: g.mfr, fileSkus: g.skus, catalog }),
  }));
}
