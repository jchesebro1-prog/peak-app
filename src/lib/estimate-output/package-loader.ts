import { getMany } from "@/lib/stores/catalog";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import { keyProductPhotoLinks, loadQuoteDocumentProps } from "@/lib/quote-pdf/document-loader";
import { onlineHeaderLine } from "@/lib/quote-share/view";
import type { SharedPackage } from "@/lib/quote-share/links";
import { packageBomSkus, type BomCatalogPart } from "./bom";
import { packageFrozenFields, packagePhotoSections, packageViewModel, type PackageViewProps } from "./package-model";

/**
 * #301 slice B — the package page's props for a resolved v2 link. The
 * document is the pinned SENT revision through the #293 web loader (which
 * fails closed for anything else and is the only place an as-sent quote is
 * built). The cover fields come from that revision's docFields only (R12 —
 * never the live quote). Photos: every scope's key products (the v2 set).
 * BOM: line fields first, then the catalog by sku (R6). Server-only.
 */
export async function loadPackageViewProps(
  hit: SharedPackage,
  opts: { base: string; view: "narrative" | "bom"; letterheadSrc: string }
): Promise<PackageViewProps | null> {
  const href = (docId: string) => `${opts.base}/photo/${encodeURIComponent(docId)}`;
  const doc = await loadQuoteDocumentProps(hit.q, { revision: hit.rev, photos: { href } });
  if (!doc) return null;
  const [photos, catalog, defaults] = await Promise.all([
    keyProductPhotoLinks(packagePhotoSections(doc.sections), href),
    catalogFor(packageBomSkus(doc.sections)),
    getEstimateOutputDefaults(),
  ]);
  return packageViewModel({
    doc,
    photos,
    catalog,
    frozen: packageFrozenFields(hit.rev.docFields, defaults.notIncluded),
    state: hit.state,
    headerLine: onlineHeaderLine(hit.q, hit.rev),
    currentHref: hit.currentPath,
    view: opts.view,
    base: opts.base,
    letterheadSrc: opts.letterheadSrc,
  });
}

/** Never fails the page: a catalog read error leaves Manufacturer / Part blank. */
async function catalogFor(skus: string[]): Promise<Map<string, BomCatalogPart>> {
  const out = new Map<string, BomCatalogPart>();
  if (!skus.length) return out;
  try {
    for (const p of await getMany(skus)) out.set(p.sku, { mfr: p.mfr ?? null, manufacturerPartNumber: p.manufacturerPartNumber ?? null, manufacturerModelNumber: p.manufacturerModelNumber ?? null });
  } catch (e) {
    console.warn("[package] catalog lookup failed", e instanceof Error ? e.message : e);
  }
  return out;
}
