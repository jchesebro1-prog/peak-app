import type { SpecItem, SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import { customerLines } from "@/app/(app)/estimator/pricing";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { isPlaceholderSku } from "@/lib/specs/record-keys";
import { lineModel } from "@/lib/catalog-rename/sku";

/**
 * #301 slice B (spec §2, R6) — the package page's parts list: Qty ·
 * Manufacturer · Model · Description from the customer's own rows
 * (customerLines — options, the Rewards credit and the overhead lines never
 * appear). Manufacturer / Model come from the line first (frozen with the
 * revision), then the catalog part by sku, else blank. Labor lines are
 * dropped, except that a labor system is its one document row. PackageBomRow
 * has NO money field — nothing priced can leak through it. Pure.
 */

export type PackageBomRow = { key: string; qty: number | null; unit: string; manufacturer: string; part: string; description: string };
/** #302: `part` prints the Model # (lineModel), never the order # when a model exists. */
export type BomCatalogPart = { mfr?: string | null; manufacturerPartNumber?: string | null; manufacturerModelNumber?: string | null };

export const LABOR_BOM_DESC = "Installation, commissioning & project management";
export const MAX_BOM_SKUS = 2000;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The sku to look up in the catalog — "" for an allowance, a vendor line,
 *  or a blank / oversize / placeholder sku (CUSTOM, AI…). */
export function bomCatalogSku(it: Pick<SpecItem, "sku"> & Partial<Pick<SpecItem, "allowance" | "vendorQuoteId">>): string {
  if (it.allowance || it.vendorQuoteId) return "";
  const s = str(it.sku);
  if (!s || s.length > 128 || isPlaceholderSku(s)) return "";
  return s;
}

/** The skus the page's BOM needs from the catalog (printed systems only). */
export function packageBomSkus(sections: SpecSection[]): string[] {
  const out = new Set<string>();
  for (const sec of Array.isArray(sections) ? sections : []) {
    if (!sec || sec.kind === "labor" || !systemPrintsInBody(sec)) continue;
    for (const cl of customerLines(sec)) {
      if (!cl.item || cl.item.labor) continue;
      const s = bomCatalogSku(cl.item);
      if (s) out.add(s);
      if (out.size >= MAX_BOM_SKUS) return [...out];
    }
  }
  return [...out];
}

export function packageBomRows(sec: SpecSection, catalog: ReadonlyMap<string, BomCatalogPart>, vendorQuotes: readonly VendorQuote[] = []): PackageBomRow[] {
  if (!sec) return [];
  if (sec.kind === "labor") return [{ key: "labor", qty: null, unit: "", manufacturer: "", part: "", description: LABOR_BOM_DESC }];
  const rows: PackageBomRow[] = [];
  for (const cl of customerLines(sec)) {
    const it = cl.item;
    if (!it || it.labor) continue;
    const vq = it.vendorQuoteId ? vendorQuotes.find((v) => v.id === it.vendorQuoteId) : undefined;
    const sku = bomCatalogSku(it);
    const part = sku ? catalog.get(sku) : undefined;
    rows.push({
      key: String(it.id),
      qty: typeof it.qty === "number" && Number.isFinite(it.qty) ? it.qty : null,
      unit: str(it.unit),
      manufacturer: str(it.manufacturer) || str(part?.mfr),
      part: lineModel(
        { sku: it.sku, manufacturerModelNumber: it.manufacturerModelNumber, manufacturerPartNumber: it.manufacturerPartNumber },
        part ? { manufacturerModelNumber: str(part.manufacturerModelNumber), manufacturerPartNumber: str(part.manufacturerPartNumber) } : undefined
      ),
      description: vq
        ? `${vq.vendor} · ${vq.quoteNumber} — ${vq.description}`
        : it.allowance
          ? "Budget allowance — " + str(it.desc)
          : str(it.desc),
    });
  }
  return rows;
}
