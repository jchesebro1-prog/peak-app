import { partModel } from "@/lib/catalog-rename/sku";

/**
 * Spec 2026-10-16 §5 — the estimate PDF's datasheet links page: the same
 * datasheets the client package includes (specPackageDocs: the package BOM,
 * scoped coverage, the project's left-out datasheets), datasheet kind only,
 * one row per (part, datasheet) in BOM order. Only a datasheet with a stored
 * file has a hosted copy to link to (`hosted`), the share route's own rule.
 * Pure; client-safe.
 */

export type DatasheetLinkRow = { key: string; manufacturer: string; model: string; description: string; href: string };

export const DATASHEET_LINK_ROWS_MAX = 500;

export function datasheetLinkRows(i: {
  bom: ReadonlyArray<{ sku: string }>;
  parts: ReadonlyArray<{ sku: string; mfr?: string | null; desc?: string | null; manufacturerModelNumber?: string; manufacturerPartNumber?: string }>;
  documents: ReadonlyArray<{ documentId: string; kind: string; skus: readonly string[] }>;
  hosted: (docId: string) => boolean;
  href: (docId: string) => string;
}): DatasheetLinkRow[] {
  const partOf = new Map(i.parts.map((p) => [p.sku, p] as const));
  const sheets = i.documents.filter((d) => d.kind === "datasheet" && i.hosted(d.documentId));
  const out: DatasheetLinkRow[] = [];
  const seen = new Set<string>();
  for (const r of i.bom) {
    const p = partOf.get(r.sku);
    if (!p) continue;
    for (const d of sheets) {
      if (!d.skus.includes(r.sku)) continue;
      const key = r.sku + "|" + d.documentId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        manufacturer: String(p.mfr ?? "").trim(),
        model: partModel({ sku: p.sku, manufacturerModelNumber: p.manufacturerModelNumber, manufacturerPartNumber: p.manufacturerPartNumber }),
        description: String(p.desc ?? "").trim(),
        href: i.href(d.documentId),
      });
      if (out.length >= DATASHEET_LINK_ROWS_MAX) return out;
    }
  }
  return out;
}
