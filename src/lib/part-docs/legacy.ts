import { createHash } from "node:crypto";
import { listDocs } from "@/db/doc-store";
import { createDocument, ensureLinks } from "@/lib/stores/part-documents";

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
  if (candidates.every((p) => known.has(legacyDocumentId(p.sku)))) return { created: 0 };
  const pairs: Array<{ partSku: string; documentId: string; kind: "datasheet" }> = [];
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
    if (doc) pairs.push({ partSku: p.sku, documentId: id, kind: "datasheet" });
  }
  await ensureLinks(pairs, by);
  return { created: pairs.length };
}
