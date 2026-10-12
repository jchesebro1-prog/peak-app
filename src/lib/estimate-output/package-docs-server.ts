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
import { memberAliases, needsFixtureLookup, specItems } from "@/lib/quote-line-members";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { normalizePackageSelection, type PackageSelection } from "./package-selection";

/**
 * #301 slice C (D-l) — the documents an estimate package offers, for one
 * quote spec (a sent revision's for the client; the live quote's for the
 * staff gap chip). The staff client package's BOM rule (quoteBom: rack
 * lines expand into their members, labor / credit / zero-qty lines drop
 * out) and its coverage rule (resolvePackageDocs in the quote's own
 * context), over scoped reads only (Slice C adaptation 1). Server-only.
 *
 * #333: `sel` — the project's package selection (a sent revision's frozen
 * `docFields.packageSelection`, or the live quote's). Its left-out SKUs join
 * the catalog read so a #304 rename maps them onto the live SKU, then
 * resolvePackageDocs leaves those datasheets out (exclusions.ts). `bom`
 * keeps every row; bookRows() is the datasheet book's rows. With no
 * selection (or nothing left out) the output is exactly the pre-#333 one.
 */

export type RevisionPackageDocs = {
  bom: Array<{ sku: string; desc: string; qty: number }>;
  parts: CatalogPart[];
  index: CoverageIndex;
  bySku: Map<string, PackageSkuDocs>;
  documents: PackageDocument[];
  /** #304: the spec's SKU → its live SKU, for SKUs a rename moved. `bom`,
   *  `parts` and `bySku` speak live SKUs; a caller keyed by the spec's own
   *  line SKU (the package page's per-key-product datasheet) maps through this. */
  moved: Map<string, string>;
  /** #332: an assembly line's SKU → its primary member's SKU (the light
   *  engine, else the first included part) — a starred assembly's
   *  key-product datasheet is that member's. Assembly lines only (never a
   *  rack or a track — quote-line-members.ts `isAssemblyLine`), read from the
   *  line's own components exactly as the Estimator's library and the
   *  customer photos read them. Keyed by the spec's own line SKU; the member
   *  SKU is the spec's too (map it through `moved` for live). */
  aliases: Map<string, string>;
};

/** #332: any line that expands only through a live fixture read — a rack, an
 *  `asm:` line, a portal `fixtureId`, a bare `fixture: true` line with no
 *  components of its own (quote-line-members.ts `needsFixtureLookup`). */
function hasAssemblyLines(spec: unknown): boolean {
  return specItems(spec).some((it) => !!it.rackId || !!it.fixtureId || needsFixtureLookup(it));
}

export type DatasheetSelection = Pick<PackageSelection, "excludedDatasheets">;

export async function specPackageDocs(spec: unknown, sel?: DatasheetSelection | null): Promise<RevisionPackageDocs> {
  const excludedIn = sel ? normalizePackageSelection(sel).excludedDatasheets : [];
  const src = { spec } as Pick<Quote, "spec">;
  const fixtures = hasAssemblyLines(spec) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
  const rackOf = (id: string) => fixtures.get(id);
  // Pass 1 lists every sku a rack expands to, so one catalog read covers the
  // internal-row check pass 2 needs (labor members drop out, #296).
  // #304: a sent revision keeps a renamed part's old SKU — its row is read,
  // covered and listed under the live SKU.
  // #333: a left-out SKU joins the read so `moved` covers a renamed one.
  const bomSkus = quoteBom(src, rackOf).map((r) => r.sku);
  const found = await getManyBySku(excludedIn.length ? [...bomSkus, ...excludedIn] : bomSkus);
  const parts0 = [...new Map([...found.values()].map((p) => [p.sku, p] as const)).values()];
  const moved = movedSkus(found);
  // The internal-row check is asked about the SKU each line names (old or live).
  const isInternal = internalSkuCheck([...found].map(([sku, p]) => ({ sku, category: p.category })));
  const bom = liveBom(quoteBom(src, rackOf, isInternal), moved);
  const inBom = new Set(bom.map((r) => r.sku));
  const parts = parts0.filter((p) => inBom.has(p.sku));
  const index = await loadScopedCoverage(parts);
  const known = new Set(parts.map((p) => p.sku));
  const excluded = excludedIn.length ? new Set(excludedIn.map((s) => moved.get(s) ?? s)) : null;
  const { bySku, documents } = resolvePackageDocs(index, bom.filter((r) => known.has(r.sku)).map((r) => r.sku), excluded ? { excludedDatasheets: excluded } : undefined);
  const aliases = memberAliases(specItems(spec));
  return { bom, parts, index, bySku, documents, moved, aliases };
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

/** #333: the BOM rows whose datasheet goes to the client — the datasheet book's rows (Q2: a left-out product is not in its index). */
export function bookRows(docs: Pick<RevisionPackageDocs, "bom" | "bySku">): RevisionPackageDocs["bom"] {
  return docs.bom.filter((r) => !docs.bySku.get(r.sku)?.datasheetExcluded);
}

/** A sent revision's package documents, with the selection it was sent with (#333; absent = everything). */
export function revisionPackageDocs(rev: Pick<QuoteRevision, "spec" | "docFields">): Promise<RevisionPackageDocs> {
  return specPackageDocs(rev.spec, rev.docFields?.packageSelection ?? null);
}

const SERVED_KINDS: ReadonlySet<string> = new Set(["datasheet", "specsheet"]);

/** The blob-backed datasheet / spec sheet `docId` IF this revision's package lists it; else null. */
export async function packageDocForRevision(rev: Pick<QuoteRevision, "spec" | "docFields">, docId: string): Promise<PartDocument | null> {
  if (!isDocumentId(docId)) return null;
  const d = await revisionPackageDocs(rev);
  if (!d.documents.some((x) => x.documentId === docId && SERVED_KINDS.has(x.kind))) return null;
  const doc = d.index.docsById.get(docId);
  return doc && doc.blobKey && SERVED_KINDS.has(doc.kind) ? doc : null;
}

/** Staff gap chip: catalog parts on this spec whose datasheet slot is not satisfied (#333: a left-out one is never a gap). */
export async function datasheetGapCount(spec: unknown, sel?: DatasheetSelection | null): Promise<number> {
  const d = await specPackageDocs(spec, sel ?? null);
  return [...d.bySku.values()].filter((x) => !x.datasheetOk).length;
}
