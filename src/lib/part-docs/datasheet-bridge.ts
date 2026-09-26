import { getDocRows } from "@/db/doc-store";
import { documentLinkId, linkedDocumentsForParts } from "@/lib/stores/part-documents";
import { legacyDocumentId } from "./legacy";

/**
 * What `/api/part-datasheet/<sku>` (the SKU-keyed bridge the Grid editor,
 * the pre-v1 Displays route and bookmarks still use) serves for a part.
 * Server-only.
 *
 * Final fix wave (I1): the part's own LIVE datasheet documents decide —
 * a stored file first, else a link-only one — so a replace or detach of the
 * backfilled legacy document is honoured. The legacy `datasheetBlobKey` is
 * streamed only when the part has no live datasheet link AND the legacy
 * LINK ROW has never existed (final fix wave 2, I4: gate on the LINK, not
 * the document — legacy.ts creates the document and links it in two steps,
 * so an interrupted backfill can leave a minted document with no link at
 * all; that must still stream the legacy blob, not 404). Once a link has
 * existed at least once, the documents are the truth: a detached legacy
 * link stays detached (404) instead of resurfacing.
 *
 * Two small reads by SKU (links, then their documents), plus one id lookup
 * only on the no-link path — never a scan of either collection.
 */
export type DatasheetTarget = { kind: "document"; documentId: string } | { kind: "legacy"; blobKey: string } | null;

export async function resolvePartDatasheet(part: { sku: string; datasheetBlobKey?: string }): Promise<DatasheetTarget> {
  const docs = (await linkedDocumentsForParts([part.sku], "datasheet")).get(part.sku) ?? [];
  const best = docs.find((d) => !!d.blobKey) ?? docs.find((d) => !!d.sourceUrl);
  if (best) return { kind: "document", documentId: best.id };
  if (docs.length) return null;
  if (!part.datasheetBlobKey) return null;
  const linkId = documentLinkId(part.sku, legacyDocumentId(part.sku));
  const everLinked = (await getDocRows("part_document_links", [linkId])).length > 0;
  return everLinked ? null : { kind: "legacy", blobKey: part.datasheetBlobKey };
}

/**
 * The SKUs among `parts` that have their OWN datasheet file by the coverage
 * rule (a live linked datasheet document holding a stored file) — or, for a
 * part whose legacy link has never existed (backfill hasn't reached it, or
 * reached it only halfway — final fix wave 2, I4), its `datasheetBlobKey`
 * (the same fallback the bridge above serves). Gated on the LINK, same rule
 * as resolvePartDatasheet, so an interrupted backfill never drops the
 * marker. For a page of rows (the catalog list's "Datasheet" marker, final
 * fix wave M5): two reads keyed by the page's SKUs, plus one id lookup only
 * when a row still carries a legacy key and has no live datasheet link —
 * never a per-row load.
 */
export async function partsWithOwnDatasheet(parts: ReadonlyArray<{ sku: string; datasheetBlobKey?: string }>): Promise<Set<string>> {
  const out = new Set<string>();
  if (!parts.length) return out;
  const linked = await linkedDocumentsForParts(parts.map((p) => p.sku), "datasheet");
  const legacy: string[] = [];
  for (const p of parts) {
    const docs = linked.get(p.sku) ?? [];
    if (docs.some((d) => !!d.blobKey)) out.add(p.sku);
    else if (!docs.length && p.datasheetBlobKey) legacy.push(p.sku);
  }
  if (legacy.length) {
    const linkIds = legacy.map((sku) => documentLinkId(sku, legacyDocumentId(sku)));
    const everLinked = new Set((await getDocRows("part_document_links", linkIds)).map((r) => r.id));
    for (const sku of legacy) if (!everLinked.has(documentLinkId(sku, legacyDocumentId(sku)))) out.add(sku);
  }
  return out;
}
