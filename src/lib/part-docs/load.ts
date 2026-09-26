import { allAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { allDocumentLinks, allDocuments } from "@/lib/stores/part-documents";
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
