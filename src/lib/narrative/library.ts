import { getMany } from "@/lib/stores/catalog";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import { MAX_LIBRARY_SKUS, type KeyProductLibraryRow } from "@/app/(app)/estimator/narrative";

/**
 * #293 — what the Estimator's narrative column needs per sku: whether it's a
 * live catalog part, its description (Draft's fallback text), its saved
 * paragraph + stamp, and its primary visible image. Batched primary-key reads
 * — never the whole catalog. Every distinct requested sku gets a row, so the
 * client caches misses too.
 */
export async function keyProductLibrary(skus: readonly string[]): Promise<Record<string, KeyProductLibraryRow>> {
  const wanted = [...new Set((skus || []).filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LIBRARY_SKUS);
  if (!wanted.length) return {};
  const [parts, images] = await Promise.all([getMany(wanted), visibleImagesForParts(wanted)]);
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  const out: Record<string, KeyProductLibraryRow> = {};
  for (const sku of wanted) {
    const p = bySku.get(sku);
    const text = p?.narrativeText && p.narrativeText.trim() ? p.narrativeText : null;
    out[sku] = {
      inCatalog: !!p,
      desc: p?.desc || "",
      paragraph: text,
      paragraphUpdatedAt: text ? p?.narrativeUpdatedAt ?? null : null,
      paragraphUpdatedBy: text ? p?.narrativeUpdatedBy ?? null : null,
      photoDocId: p ? images.get(sku)?.[0]?.id ?? null : null,
    };
  }
  return out;
}
