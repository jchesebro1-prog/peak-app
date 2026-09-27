/**
 * Datasheet page-1 thumbnail batch (#242, spec §5/§1.1): which parts still
 * need a rendered thumbnail. Pure — no store, no Blob, no Chrome — so the
 * harness tests candidate selection without a DB or a headless browser.
 *
 * A SKU qualifies only when:
 *  1. it has an OWN blob-backed datasheet (not covered by a parent fixture's
 *     datasheet, not a link-only URL nobody has fetched yet), and
 *  2. it has NO image of any source yet — including a hidden one. A hidden
 *     image is a human's deliberate "not this one" call; regenerating over
 *     it would silently undo that choice the next time this batch runs.
 */

export type ThumbnailCandidate = { sku: string; datasheetId: string };

export function thumbnailCandidates(input: {
  skus: readonly string[];
  imagesBySku: Map<string, unknown[]>;
  ownDatasheetBySku: Map<string, { id: string; blobKey: string | null }>;
}): ThumbnailCandidate[] {
  const out: ThumbnailCandidate[] = [];
  for (const sku of input.skus) {
    if ((input.imagesBySku.get(sku)?.length ?? 0) > 0) continue;
    const datasheet = input.ownDatasheetBySku.get(sku);
    if (!datasheet || !datasheet.blobKey) continue;
    out.push({ sku, datasheetId: datasheet.id });
  }
  return out;
}

/** Group candidates by datasheet (#242) — one render per PDF, attached to
 *  every SKU that shares it, not one render per SKU. */
export function groupCandidatesByDatasheet(
  candidates: readonly ThumbnailCandidate[]
): Array<{ datasheetId: string; skus: string[] }> {
  const bySheet = new Map<string, string[]>();
  for (const c of candidates) {
    const list = bySheet.get(c.datasheetId);
    if (list) list.push(c.sku);
    else bySheet.set(c.datasheetId, [c.sku]);
  }
  return [...bySheet.entries()].map(([datasheetId, skus]) => ({ datasheetId, skus }));
}
