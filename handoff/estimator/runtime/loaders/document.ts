/**
 * Estimator handoff — the customer QuoteDocument's props from the browser store: the browser port of
 * src/lib/quote-pdf/document-loader.ts (loadQuoteDocumentProps, photos "inline", no revision — the
 * print route's live quote) and of package-live-loader.ts liveQuoteDocumentProps.
 *
 * Same pure core (quote-document-data.ts quoteDocumentDataFor); the store reads it made become:
 *
 *   stores/quotes get(id)                → quoteRepo(store).get (pipeline-normalized read view)
 *   stores/customers get(customerId)     → ports.customers.resolve (data/customers.js)
 *   settings getSettings()               → ports.settingsView (rules.js settings over the defaults)
 *   reward-perks purchasePerksForCompany → none: Rewards is off in the prototype (rewardsLine "")
 *   parties documentAddressee(q)         → null: no parties in the prototype (owner-addressed, as a quote with no award)
 *   narrative/photos keyProductPhoto*    → keyProductPhotosLocal: the packaged photo (Task 11), else none
 *   narrative/photos loadKeyProductModels → keyProductModelsFor over the store's catalog
 *   bom-models-server loadBomModelPartsFor → bomModelPartsLocal over the store's catalog (#365: "Model — Description")
 *   print route's box-sale branch         → quoteDocumentDataFor already returns the BOM view for a box sale; this adds
 *                                           the web layout, the model parts and no cut-sheet appendix (cut-sheets.ts)
 *
 * Plan: PR 2 Task 5.
 */
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { photoSkusOf } from "@/app/(app)/estimator/narrative";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { documentApplies, keyProductPrintSections } from "@/lib/package-doc/print";
import { docPhotoSkus } from "@/lib/package-doc/text";
import type { PackageDoc } from "@/lib/package-doc/types";
import { memberAliases } from "@/lib/quote-line-members";
import { keyProductModelsFor } from "@/lib/estimate-output/photo-models";
import { bomModelPartOf, bomModelSkus, type BomModelParts } from "@/lib/estimate-output/bom-models";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
import type { Quote } from "@/lib/stores/quotes";
import type { HandoffStore } from "../store";
import { customers, refreshPortsFromStore, settingsView } from "../ports";
import { quoteRepo } from "../quote-repo";
import { bySkuResolver, liveCatalog, type LivePart } from "../readers";
import { partDocumentSrc, photoDocIdForSku } from "../assets";

/**
 * photos.ts photoReadPlan, ported (that module reaches the part-documents store): the photo skus a document
 * prints — key products of the systems printed as bands, then the package document's photo-on product blocks —
 * and how each is read (#332: an assembly line reads its primary member's part).
 */
export function photoReadPlan(sections: SpecSection[], document?: PackageDoc | null): { skus: string[]; read: (sku: string) => string } {
  const kpSections = keyProductPrintSections(sections, document);
  const docSkus = documentApplies(document) ? docPhotoSkus(document) : [];
  const skus = [...photoSkusOf(kpSections)];
  for (const s of docSkus) if (!skus.includes(s)) skus.push(s);
  const wanted = new Set(skus);
  const items = (Array.isArray(sections) ? sections : []).flatMap((s) => (s && Array.isArray(s.items) ? s.items : [])).filter((it) => it && wanted.has(String(it.sku || "").trim()));
  const alias = items.length ? memberAliases(items) : new Map<string, string>();
  return { skus, read: (sku: string) => alias.get(sku) ?? sku };
}

/** The part document a sku prints as its photo (its primary visible image, else its manufacturer's): the packaged
 *  photo map's sku → docId (assets.ts photoDocIdForSku); null when the package ships none for it. */
export { photoDocIdForSku };

/** sku → { src, alt } for the printed photo-on blocks, through the one asset rewrite (assets.ts). Never throws. */
export function keyProductPhotosLocal(sections: SpecSection[], document: PackageDoc | null | undefined, partOf: (sku: string) => LivePart | undefined): Record<string, { src: string; alt: string }> {
  const out: Record<string, { src: string; alt: string }> = {};
  try {
    const { skus, read } = photoReadPlan(sections, document);
    for (const sku of skus) {
      const part = partOf(read(sku));
      const id = part ? photoDocIdForSku(part.sku) : null;
      if (id) out[sku] = { src: partDocumentSrc(id), alt: part?.desc || sku };
    }
  } catch (e) {
    console.warn("[handoff] key-product photos unavailable", e);
  }
  return out;
}

/** loadKeyProductModels over the store's catalog. Never throws. */
export function keyProductModelsLocal(sections: SpecSection[], document: PackageDoc | null | undefined, partOf: (sku: string) => LivePart | undefined): Record<string, string> {
  try {
    const { skus, read } = photoReadPlan(sections, document);
    if (!skus.length) return {};
    const parts = new Map<string, LivePart>();
    for (const sku of new Set(skus.map(read))) {
      const p = partOf(sku);
      if (p) parts.set(sku, p);
    }
    return keyProductModelsFor({ sections, document: documentApplies(document) ? document : null, skus, parts, readSku: read });
  } catch (e) {
    console.warn("[handoff] key-product models unavailable", e);
    return {};
  }
}

/**
 * loadBomModelPartsFor over the store's catalog (#365): the catalog facts the BOM view's models read, keyed by the SKU as
 * the line names it (renames followed, live parts only). Never throws — undefined prints descriptions only.
 */
export function bomModelPartsLocal(sections: SpecSection[], partOf: (sku: string) => LivePart | undefined): BomModelParts | undefined {
  try {
    const out: BomModelParts = {};
    for (const sku of bomModelSkus(sections)) {
      const p = partOf(sku);
      if (p) out[sku] = bomModelPartOf(p);
    }
    return out;
  } catch (e) {
    console.warn("[handoff] BOM line models unavailable", e);
    return undefined;
  }
}

/** The store's catalog as a sku resolver (renames followed), read once per document. */
export async function catalogResolver(store: HandoffStore): Promise<(sku: string) => LivePart | undefined> {
  return bySkuResolver(await liveCatalog(store), store.catalogRenames);
}

/** liveQuoteDocumentProps / loadQuoteDocumentProps(q, { photos: "inline" }) for a quote already read. */
export function quoteDocumentPropsFor(q: Quote, partOf: (sku: string) => LivePart | undefined): QuoteDocumentProps {
  const doc = quoteDocumentDataFor(q, customers.resolve(q.customerId), settingsView(), null);
  return {
    ...doc,
    keyProductPhotos: keyProductPhotosLocal(doc.sections, doc.document, partOf),
    keyProductModels: keyProductModelsLocal(doc.sections, doc.document, partOf),
    // #365: only a BOM view (bomViewProps' showModels) reads these; every other document ignores them.
    bomModelParts: bomModelPartsLocal(doc.sections, partOf),
    // Box goods sale (spec 2026-10-21): the whole customer document is the BOM quote PDF's layout (#360) — the print
    // route's `layout="web"` branch (no title page, the investment band kept).
    ...(boxSaleOf(q) ? { layout: "web" as const } : {}),
    rewardsLine: "",
  };
}

/** The SAVED quote's customer document, or null when the store has no such quote. */
export async function loadQuoteDocumentPropsLocal(store: HandoffStore, quoteId: string | null | undefined): Promise<QuoteDocumentProps | null> {
  if (!quoteId) return null;
  await refreshPortsFromStore(store);
  const q = await quoteRepo(store).get(quoteId);
  if (!q) return null;
  return quoteDocumentPropsFor(q, await catalogResolver(store));
}
