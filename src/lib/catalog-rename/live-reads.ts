// SERVER ONLY — reads the catalog and part-document stores (never import from a client component).
import { getManyBySku, type CatalogPart } from "@/lib/stores/catalog";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import type { PartDocument } from "@/lib/part-docs/types";

/**
 * #302 — frozen history (a sent quote revision, a Grid revision, an outside
 * link) keeps the SKU it was written with; a rename moved the part AND its
 * document links to the new SKU. These reads take the SKUs as written and
 * answer keyed by them, so a caller that looks a line up by its own `sku`
 * keeps working: `parts.get(oldSku)` is the live part, `images.get(oldSku)`
 * that part's images (read under its live SKU).
 *
 * A book that was never renamed reads exactly as before: the catalog and the
 * image reads run in parallel over the requested SKUs, and only a SKU that
 * resolved to a DIFFERENT live SKU costs one more image read.
 */
export async function partsAndImagesBySku(
  skus: readonly string[]
): Promise<{ parts: Map<string, CatalogPart>; images: Map<string, PartDocument[]> }> {
  const [parts, own] = await Promise.all([getManyBySku(skus), visibleImagesForParts(skus)]);
  const moved = [...new Set(skus.flatMap((s) => (parts.has(s) && parts.get(s)!.sku !== s ? [parts.get(s)!.sku] : [])))];
  if (!moved.length) return { parts, images: own };
  const live = await visibleImagesForParts(moved);
  const images = new Map(own);
  for (const s of skus) {
    const p = parts.get(s);
    if (!p || p.sku === s) continue;
    const list = live.get(p.sku);
    if (list) images.set(s, list);
    else images.delete(s);
  }
  return { parts, images };
}

/** requested SKU → its live SKU, only for SKUs a rename moved (#302). */
export function movedSkus(parts: ReadonlyMap<string, Pick<CatalogPart, "sku">>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [requested, p] of parts) if (p.sku !== requested) out.set(requested, p.sku);
  return out;
}
