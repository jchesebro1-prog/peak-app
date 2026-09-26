import { getDocRows } from "@/db/doc-store";
import { linkedDocumentsForParts } from "@/lib/stores/part-documents";
import { legacyDocumentId } from "./legacy";

/**
 * What `/api/part-datasheet/<sku>` (the SKU-keyed bridge the Grid editor,
 * the pre-v1 Displays route and bookmarks still use) serves for a part.
 * Server-only.
 *
 * Final fix wave (I1): the part's own LIVE datasheet documents decide —
 * a stored file first, else a link-only one — so a replace or detach of the
 * backfilled legacy document is honoured. The legacy `datasheetBlobKey` is
 * streamed only when the part has no live datasheet link AND its legacy
 * document was never minted (the backfill has not reached it yet); once the
 * backfill ran, the documents are the truth, and a detached legacy file
 * stays detached (404) instead of resurfacing.
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
  const minted = (await getDocRows("part_documents", [legacyDocumentId(part.sku)])).length > 0;
  return minted ? null : { kind: "legacy", blobKey: part.datasheetBlobKey };
}

/**
 * The SKUs among `parts` that have their OWN datasheet file by the coverage
 * rule (a live linked datasheet document holding a stored file) — or, for a
 * part the legacy backfill has not reached yet, its `datasheetBlobKey`
 * (the same fallback the bridge above serves). For a page of rows (the
 * catalog list's "Datasheet" marker, final fix wave M5): two reads keyed by
 * the page's SKUs, plus one id lookup only when a row still carries a
 * legacy key and has no live datasheet link — never a per-row load.
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
    const minted = new Set((await getDocRows("part_documents", legacy.map(legacyDocumentId))).map((r) => r.id));
    for (const sku of legacy) if (!minted.has(legacyDocumentId(sku))) out.add(sku);
  }
  return out;
}
