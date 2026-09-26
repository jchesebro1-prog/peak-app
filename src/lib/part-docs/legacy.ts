import { createHash } from "node:crypto";
import { getDocRows, listDocs } from "@/db/doc-store";
import { createDocument, documentLinkId, ensureLinks } from "@/lib/stores/part-documents";

/**
 * Legacy backfill (#207, spec §5): every part that still carries the old
 * single-file `datasheetBlobKey` gets a shared `part_documents` row (source
 * "legacy") and a link. Server-only.
 *
 * Idempotent by construction: the document id is derived from the SKU, and
 * a part is only backfilled when that id has never existed (live or not) —
 * so a second run writes nothing, and a human who later detaches the legacy
 * document is never overruled. `datasheetBlobKey` itself is left in place for
 * the readers that have not switched yet.
 *
 * Final fix wave 2 (I4): document creation and linking are two separate
 * writes, so a run interrupted between them used to leave a document with no
 * link — and every later call skipped that SKU entirely (its id was already
 * "known"), so the link was never written and the bridge/marker read that as
 * a detached, permanent 404. Every candidate's link is now checked (and
 * repaired if it has never existed) regardless of whether this call is the
 * one that minted its document — reads are bounded to just these
 * candidates' deterministic ids (getDocRows, chunked), never a scan of the
 * whole link table.
 */

export type LegacyPart = { sku: string; datasheetBlobKey?: string; datasheetName?: string; updatedAt?: number };

export function legacyDocumentId(sku: string): string {
  return `PD-L${createHash("sha1").update(sku).digest("hex").slice(0, 15)}`;
}

export async function backfillLegacyDatasheets(
  parts: readonly LegacyPart[],
  opts: { by?: string; knownIds?: ReadonlySet<string> } = {}
): Promise<{ created: number }> {
  const by = opts.by ?? "Legacy datasheet backfill";
  const candidates = parts.filter((p) => !!p.datasheetBlobKey);
  if (!candidates.length) return { created: 0 };
  // Documents are never deleted, so a caller that already listed them can
  // hand their ids over and save this read.
  const known = opts.knownIds ?? new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));

  let created = 0;
  for (const p of candidates) {
    const id = legacyDocumentId(p.sku);
    if (known.has(id)) continue;
    const fileName = p.datasheetName || `${p.sku}.pdf`;
    const doc = await createDocument({
      id,
      kind: "datasheet",
      fileName,
      contentType: "application/pdf",
      size: 0, // the legacy action never recorded it
      blobKey: p.datasheetBlobKey!,
      sourceUrl: null,
      source: "legacy",
      sourceRef: p.sku,
      by,
      at: p.updatedAt,
    });
    if (doc) created++;
  }

  // Repair pass: every candidate (new this run or already minted earlier)
  // gets its link written if — and only if — that link has never existed.
  // ensureLinks' own "ever" gate (part_document_links, includeDeleted) means
  // a human's later detach is still never overruled by this.
  const linkIds = candidates.map((p) => documentLinkId(p.sku, legacyDocumentId(p.sku)));
  const everLinked = new Set((await getDocRows("part_document_links", linkIds)).map((r) => r.id));
  const pairs: Array<{ partSku: string; documentId: string; kind: "datasheet" }> = candidates
    .filter((p) => !everLinked.has(documentLinkId(p.sku, legacyDocumentId(p.sku))))
    .map((p) => ({ partSku: p.sku, documentId: legacyDocumentId(p.sku), kind: "datasheet" as const }));
  if (pairs.length) await ensureLinks(pairs, by);

  return { created };
}
