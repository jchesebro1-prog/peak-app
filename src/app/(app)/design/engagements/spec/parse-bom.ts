import type { BomRow } from "@/lib/bid-spec";

/**
 * BOM paste parsing (D94) — a trimmed sibling of the catalog price-book
 * importer (catalog/parse.ts): same CSV/TSV handling and column-alias idea,
 * but only the three columns a specification needs. Dependency-free so the
 * client can preview a paste without a round trip.
 */

export type BomParse =
  | { ok: true; rows: BomRow[]; skipped: number }
  | { ok: false; error: string };

const ALIASES = {
  sku: ["sku", "item", "itemnumber", "item number", "part", "partnumber", "part number", "partno", "model", "catalog", "code"],
  desc: ["description", "desc", "product", "productdescription", "product description", "name", "item description", "equipment"],
  qty: ["qty", "quantity", "count", "ea", "each", "amount"],
};

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function headerIndex(headers: string[], names: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseCsv(text: string): BomParse {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { ok: false, error: "Paste a header row plus at least one equipment line." };
  }

  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], delim);
  const iSku = headerIndex(headers, ALIASES.sku);
  const iDesc = headerIndex(headers, ALIASES.desc);
  const iQty = headerIndex(headers, ALIASES.qty);

  if (iSku < 0 && iDesc < 0) {
    return {
      ok: false,
      error: "Couldn't find a SKU or description column. Expected a header row naming at least one of them.",
    };
  }

  const rows: BomRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delim);
    const sku = iSku >= 0 ? cells[iSku] || "" : "";
    const desc = iDesc >= 0 ? cells[iDesc] || "" : "";
    if (!sku && !desc) {
      skipped++;
      continue;
    }
    const qtyRaw = iQty >= 0 ? cells[iQty] || "" : "";
    const qty = Number(qtyRaw.replace(/[^0-9.-]/g, "")) || 0;
    rows.push({ sku, desc, qty });
  }

  if (!rows.length) return { ok: false, error: "No usable equipment lines found." };
  return { ok: true, rows, skipped };
}
