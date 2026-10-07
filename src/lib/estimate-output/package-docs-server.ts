import { quoteBom } from "@/lib/client-package-server";
import { internalSkuCheck } from "@/lib/design/grid-virtual-parts";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadScopedCoverage } from "@/lib/part-docs/load";
import { resolvePackageDocs, type PackageDocument, type PackageSkuDocs } from "@/lib/part-docs/package";
import { isDocumentId, type PartDocument } from "@/lib/part-docs/types";
import { getManyBySku, type CatalogPart } from "@/lib/stores/catalog";
import { movedSkus } from "@/lib/catalog-rename/live-reads";
import { listFixtures } from "@/lib/stores/fixtures";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";

/**
 * #301 slice C (D-l) — the documents an estimate package offers, for one
 * quote spec (a sent revision's for the client; the live quote's for the
 * staff gap chip). The staff client package's BOM rule (quoteBom: rack
 * lines expand into their members, labor / credit / zero-qty lines drop
 * out) and its coverage rule (resolvePackageDocs in the quote's own
 * context), over scoped reads only (Slice C adaptation 1). Server-only.
 */

export type RevisionPackageDocs = {
  bom: Array<{ sku: string; desc: string; qty: number }>;
  parts: CatalogPart[];
  index: CoverageIndex;
  bySku: Map<string, PackageSkuDocs>;
  documents: PackageDocument[];
  /** #302: the spec's SKU → its live SKU, for SKUs a rename moved. `bom`,
   *  `parts` and `bySku` speak live SKUs; a caller keyed by the spec's own
   *  line SKU (the package page's per-key-product datasheet) maps through this. */
  moved: Map<string, string>;
};

function hasAssemblyLines(spec: unknown): boolean {
  const s = spec as { sections?: Array<{ items?: Array<{ rackId?: unknown; fixtureId?: unknown }> }> } | null | undefined;
  return (s?.sections || []).some((sec) => (sec?.items || []).some((it) => !!it?.rackId || !!it?.fixtureId));
}

export async function specPackageDocs(spec: unknown): Promise<RevisionPackageDocs> {
  const src = { spec } as Pick<Quote, "spec">;
  const fixtures = hasAssemblyLines(spec) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
  const rackOf = (id: string) => fixtures.get(id);
  // Pass 1 lists every sku a rack expands to, so one catalog read covers the
  // internal-row check pass 2 needs (labor members drop out, #296).
  // #302: a sent revision keeps a renamed part's old SKU — its row is read,
  // covered and listed under the live SKU.
  const found = await getManyBySku(quoteBom(src, rackOf).map((r) => r.sku));
  const parts0 = [...new Map([...found.values()].map((p) => [p.sku, p] as const)).values()];
  const moved = movedSkus(found);
  const bom = liveBom(quoteBom(src, rackOf, internalSkuCheck(parts0)), moved);
  const inBom = new Set(bom.map((r) => r.sku));
  const parts = parts0.filter((p) => inBom.has(p.sku));
  const index = await loadScopedCoverage(parts);
  const known = new Set(parts.map((p) => p.sku));
  const { bySku, documents } = resolvePackageDocs(index, bom.filter((r) => known.has(r.sku)).map((r) => r.sku));
  return { bom, parts, index, bySku, documents, moved };
}

/** BOM rows under their live SKUs; an old and a new SKU on one spec merge into one row. */
function liveBom(rows: Array<{ sku: string; desc: string; qty: number }>, moved: ReadonlyMap<string, string>): Array<{ sku: string; desc: string; qty: number }> {
  if (!moved.size) return rows;
  const out = new Map<string, { sku: string; desc: string; qty: number }>();
  for (const r of rows) {
    const sku = moved.get(r.sku) ?? r.sku;
    const cur = out.get(sku);
    if (cur) cur.qty += r.qty;
    else out.set(sku, { ...r, sku });
  }
  return [...out.values()];
}

export function revisionPackageDocs(rev: Pick<QuoteRevision, "spec">): Promise<RevisionPackageDocs> {
  return specPackageDocs(rev.spec);
}

const SERVED_KINDS: ReadonlySet<string> = new Set(["datasheet", "specsheet"]);

/** The blob-backed datasheet / spec sheet `docId` IF this revision's package lists it; else null. */
export async function packageDocForRevision(rev: Pick<QuoteRevision, "spec">, docId: string): Promise<PartDocument | null> {
  if (!isDocumentId(docId)) return null;
  const d = await revisionPackageDocs(rev);
  if (!d.documents.some((x) => x.documentId === docId && SERVED_KINDS.has(x.kind))) return null;
  const doc = d.index.docsById.get(docId);
  return doc && doc.blobKey && SERVED_KINDS.has(doc.kind) ? doc : null;
}

/** Staff gap chip: catalog parts on this spec whose datasheet slot is not satisfied. */
export async function datasheetGapCount(spec: unknown): Promise<number> {
  const d = await specPackageDocs(spec);
  return [...d.bySku.values()].filter((x) => !x.datasheetOk).length;
}
