import { accessoryLinksForAccessories, allAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { allDocumentLinks, allDocuments, documentLinksForParts, getDocuments } from "@/lib/stores/part-documents";
import { buildCoverageIndex, type CoverageIndex, type CoveragePartInput } from "./coverage";
import { backfillLegacyDatasheets, type LegacyPart } from "./legacy";
import type { PartAccessoryLink, PartDocument, PartDocumentLink } from "./types";

/**
 * One load of everything coverage needs (#207) — the three collections, once
 * per request, plus the idempotent legacy backfill (which writes only when a
 * part still has an un-backfilled `datasheetBlobKey`). Server-only. Callers
 * pass the catalog they already loaded; this never lists it again.
 */
export type PartDocsState = {
  documents: PartDocument[];
  links: PartDocumentLink[];
  accessoryLinks: PartAccessoryLink[];
  index: CoverageIndex;
};

export async function loadPartDocsState(parts: ReadonlyArray<CoveragePartInput & LegacyPart>): Promise<PartDocsState> {
  const [docs0, links0, accessoryLinks] = await Promise.all([allDocuments(), allDocumentLinks(), allAccessoryLinks()]);
  const { created } = await backfillLegacyDatasheets(parts, { knownIds: new Set(docs0.map((d) => d.id)) });
  const [documents, links] = created ? await Promise.all([allDocuments(), allDocumentLinks()]) : [docs0, links0];
  const index = buildCoverageIndex({ documents, links, accessoryLinks, parts: [...parts] });
  return { documents, links, accessoryLinks, index };
}

/**
 * #301 slice C — the coverage index for ONE quote's parts (Slice C
 * adaptation 1), from three filtered reads: those parts' document links,
 * those documents, and the accessory links whose accessory is one of them.
 * Coverage in a quote's context only follows parents that are on the same
 * quote, so `slotCoverage(index, sku, kind, context)` with `context` = these
 * skus answers exactly as the full index would. No legacy backfill: the
 * package routes are public reads and never write.
 */
export async function loadScopedCoverage(parts: ReadonlyArray<CoveragePartInput>): Promise<CoverageIndex> {
  const skus = [...new Set(parts.map((p) => p.sku).filter(Boolean))];
  if (!skus.length) return buildCoverageIndex({ documents: [], links: [], accessoryLinks: [], parts: [] });
  const [links, accessoryLinks] = await Promise.all([documentLinksForParts(skus), accessoryLinksForAccessories(skus)]);
  const documents = await getDocuments(links.map((l) => l.documentId));
  return buildCoverageIndex({ documents, links, accessoryLinks, parts: [...parts] });
}
