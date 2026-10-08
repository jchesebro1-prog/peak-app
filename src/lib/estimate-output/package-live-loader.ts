import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { get as getCustomer } from "@/lib/stores/customers";
import { getSettings } from "@/lib/settings";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { keyProductPhotoLinks } from "@/lib/quote-pdf/document-loader";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { latestSentRevision } from "@/lib/quote-pdf/state";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import { allSections } from "@/lib/stores/spec-sections";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import type { VisiblePackageState } from "@/lib/quote-share/package-view";
import { packageBomSkus } from "./bom";
import { cleanPackageFiles } from "./package-files";
import { specPackageDocs } from "./package-docs-server";
import { catalogFor } from "./package-loader";
import { packageFrozenFields, packagePhotoSections, packageViewModel, type PackageViewProps } from "./package-model";
import { specReadyFor } from "./package-spec-ready";
import { previewHeaderLine, previewPath, staffPackageExtras, staffPartDocHref, type StaffPackageExtras } from "./package-preview";

/**
 * Estimator Phase 4 (spec §11.1) — the staff preview's data, from the SAVED
 * live quote (a draft too — never a share token or a sent revision; the
 * share loader, package-loader.ts, keeps the client's own rules). The same
 * calls the print route makes (customer, settings, purchase perks → the pure
 * quoteDocumentDataFor), the same pure package model, links to staff routes
 * only (package-preview.ts). Server-only.
 */

/** The customer document's props for the live saved quote (the print route's calls, no photos). */
export async function liveQuoteDocumentProps(q: Quote): Promise<QuoteDocumentProps> {
  const [cust, settings, perks] = await Promise.all([getCustomer(q.customerId), getSettings(), purchasePerksForCompany(q.customerId)]);
  return { ...quoteDocumentDataFor(q, cust, settings), rewardsLine: purchasePerksDocLine(perks) };
}

/** An open estimate's state, so packageBanner shows nothing (the preview is "as it will read once sent"). */
function previewState(q: Pick<Quote, "revisions">): VisiblePackageState {
  const rev = latestSentRevision(q.revisions) ?? ({ rev: 0 } as unknown as QuoteRevision);
  return { kind: "ok", rev, closed: false, won: false };
}

/** The package page's extras from the live quote. Never throws — a failed document read leaves those cards out. */
async function liveExtras(q: Quote): Promise<StaffPackageExtras> {
  const files = cleanPackageFiles(q.packageFiles);
  try {
    const docs = await specPackageDocs(q.spec);
    return staffPackageExtras(docs, specReadyFor(docs.parts, await allSections()), files, q.id);
  } catch (e) {
    console.warn("[package-preview] documents unavailable", e instanceof Error ? e.message : e);
    return staffPackageExtras(null, false, files, q.id);
  }
}

export async function loadLivePackagePreview(
  q: Quote,
  opts: { view: "narrative" | "bom"; letterheadSrc: string },
): Promise<{ model: PackageViewProps; extras: StaffPackageExtras }> {
  const doc = await liveQuoteDocumentProps(q);
  const [photos, catalog, defaults, extras] = await Promise.all([
    keyProductPhotoLinks(packagePhotoSections(doc.sections), staffPartDocHref, doc.document),
    catalogFor(packageBomSkus(doc.sections)),
    getEstimateOutputDefaults(),
    liveExtras(q),
  ]);
  const model = packageViewModel({
    doc,
    photos,
    catalog,
    // The live quote's own cover fields (a revision freezes these at send).
    frozen: packageFrozenFields({ coverSummary: q.coverSummary ?? "", notIncluded: q.notIncluded ?? null }, defaults.notIncluded),
    state: previewState(q),
    headerLine: previewHeaderLine(q),
    currentHref: null,
    view: opts.view,
    base: previewPath(q.id, "package"),
    letterheadSrc: opts.letterheadSrc,
  });
  // The page's Narrative / BOM toggle stays on the package tab.
  return { model: { ...model, narrativeHref: previewPath(q.id, "package"), bomHref: previewPath(q.id, "package", "bom") }, extras };
}
