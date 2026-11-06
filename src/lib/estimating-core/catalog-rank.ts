import { isPerLengthUnit } from "@/lib/design/grid-bom";
import { isFabricPart } from "@/lib/fabric-part";
import { partSearchHaystack, type SearchPartLike } from "@/lib/catalog-rename/sku";

/** The catalog fields the Estimator ranking reads (a CatalogPart satisfies this). */
export type RankablePart = SearchPartLike & { category?: string; unit?: string };

/**
 * Estimator catalog ranking (moved out of searchCatalog, #334) — pure, request-scope free.
 * `searchCatalog` and the Assist estimate draft both rank through this one function.
 */
export function rankCatalogParts<P extends RankablePart>(
  parts: P[],
  query: string,
  opts: { category?: string; perLengthOnly?: boolean } = {}
): Array<{ p: P; score: number }> {
  const q = (query || "").trim().toLowerCase();
  const cat = (opts.category || "").trim();
  return (
    parts
      // #264: "Fabric" means every fabric part (isFabricPart — Fabric, or
      // Theatrical/Soft Goods sold per sq ft); any other category is exact.
      .filter((p) => (!cat ? true : cat === "Fabric" ? isFabricPart(p) : (p.category || "") === cat))
      .filter((p) => !opts.perLengthOnly || isPerLengthUnit(p.unit || ""))
      .map((p) => {
        const sku = (p.sku || "").toLowerCase();
        const desc = (p.desc || "").toLowerCase();
        const pcat = (p.category || "").toLowerCase();
        // #304: the Model # and old order numbers rank like the SKU does.
        const names = [sku, (p.manufacturerModelNumber || "").toLowerCase(), ...(p.formerSkus ?? []).map((s) => s.toLowerCase())].filter(Boolean);
        if (!q) return { p, score: 0 };
        let score = -1;
        if (names.includes(q) || desc === q) score = 5;
        else if (names.some((n) => n.startsWith(q)) || desc.startsWith(q)) score = 4;
        else if (desc.includes(q) || names.some((n) => n.includes(q))) score = 2;
        else if (pcat.includes(q) || partSearchHaystack(p).includes(q)) score = 1; // mfr, MFR P/N …
        return { p, score };
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score || (a.p.desc || "").localeCompare(b.p.desc || ""))
  );
}
