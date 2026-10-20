/**
 * Estimator handoff — the package page's model from the browser store: the browser port of
 * src/lib/estimate-output/package-live-loader.ts (loadLivePackagePreview, the staff preview's data from the
 * SAVED live quote). The pure model (package-model.ts packageViewModel) is imported; the reads become:
 *
 *   liveQuoteDocumentProps(q)            → document.ts quoteDocumentPropsFor (customer / settings ports)
 *   keyProductPhotoLinks / Models        → document.ts keyProductPhotosLocal / keyProductModelsLocal
 *   package-loader catalogFor(skus)      → the store's catalog (mfr / MFR P/N / model per BOM sku)
 *   getEstimateOutputDefaults()          → blob `estimate_output_defaults` (sanitizeEstimateOutputDefaults)
 *   liveExtras(q)                        → staffPackageExtras(null, …): the slice has no part documents and no
 *                                          spec sections, so no datasheet links and no Specifications download;
 *                                          the quote's own package files (Plans & risers) still list
 *
 * Plan: PR 2 Task 5.
 */
import { packageBomSkus, type BomCatalogPart } from "@/lib/estimate-output/bom";
import { ESTIMATE_OUTPUT_BLOB, sanitizeEstimateOutputDefaults } from "@/lib/estimate-output/fields";
import { cleanPackageFiles, shownPackageFiles } from "@/lib/estimate-output/package-files";
import { packageFrozenFields, packagePhotoSections, packageViewModel, type PackageViewProps } from "@/lib/estimate-output/package-model";
import { previewHeaderLine, previewPath, staffPackageExtras, type StaffPackageExtras } from "@/lib/estimate-output/package-preview";
import { latestSentRevision } from "@/lib/quote-pdf/state";
import type { VisiblePackageState } from "@/lib/quote-share/package-view";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import type { HandoffStore } from "../store";
import { blobData, refreshPortsFromStore } from "../ports";
import { quoteRepo } from "../quote-repo";
import type { LivePart } from "../readers";
import { catalogResolver, keyProductModelsLocal, keyProductPhotosLocal, quoteDocumentPropsFor } from "./document";

export type LocalPackagePreview = { model: PackageViewProps; extras: StaffPackageExtras };

/** package-loader catalogFor over the store: keyed by the line's own sku (a renamed part's old sku resolves). */
export function catalogForLocal(skus: string[], partOf: (sku: string) => LivePart | undefined): Map<string, BomCatalogPart> {
  const out = new Map<string, BomCatalogPart>();
  for (const sku of skus) {
    const p = partOf(sku);
    if (p) out.set(sku, { mfr: p.mfr ?? null, manufacturerPartNumber: p.manufacturerPartNumber ?? null, manufacturerModelNumber: p.manufacturerModelNumber ?? null });
  }
  return out;
}

/** An open estimate's state, so packageBanner shows nothing (the preview is "as it will read once sent"). */
function previewState(q: Pick<Quote, "revisions">): VisiblePackageState {
  const rev = latestSentRevision(q.revisions) ?? ({ rev: 0 } as unknown as QuoteRevision);
  return { kind: "ok", rev, closed: false, won: false };
}

/** loadLivePackagePreview for a quote already read (pure apart from the resolver). */
/** `letterheadSrc` — the baked letterhead image (the caller imports it; a .jpg import would keep this module out of Node tests). */
export function packagePreviewFor(q: Quote, partOf: (sku: string) => LivePart | undefined, view: "narrative" | "bom", letterheadSrc: string): LocalPackagePreview {
  const doc = quoteDocumentPropsFor(q, partOf);
  const photoSections = packagePhotoSections(doc.sections);
  const defaults = sanitizeEstimateOutputDefaults(blobData(ESTIMATE_OUTPUT_BLOB));
  const files = shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection);
  const extras = staffPackageExtras(null, false, files, q.id);
  const model = packageViewModel({
    doc,
    photos: keyProductPhotosLocal(photoSections, doc.document, partOf),
    models: keyProductModelsLocal(photoSections, doc.document, partOf),
    catalog: catalogForLocal(packageBomSkus(doc.sections), partOf),
    frozen: packageFrozenFields({ coverSummary: q.coverSummary ?? "", notIncluded: q.notIncluded ?? null }, defaults.notIncluded),
    state: previewState(q),
    headerLine: previewHeaderLine(q),
    currentHref: null,
    view,
    base: previewPath(q.id, "package"),
    letterheadSrc,
  });
  // The page's Narrative / BOM toggle stays on the package tab (the review tab intercepts these links).
  return { model: { ...model, narrativeHref: previewPath(q.id, "package"), bomHref: previewPath(q.id, "package", "bom") }, extras };
}

/** The SAVED quote's package page, or null when the store has no such quote. */
export async function loadPackagePreviewLocal(store: HandoffStore, quoteId: string | null | undefined, view: "narrative" | "bom", letterheadSrc: string): Promise<LocalPackagePreview | null> {
  if (!quoteId) return null;
  await refreshPortsFromStore(store);
  const q = await quoteRepo(store).get(quoteId);
  if (!q) return null;
  return packagePreviewFor(q, await catalogResolver(store), view, letterheadSrc);
}
