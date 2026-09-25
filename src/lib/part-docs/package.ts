import { slotCoverage, type CoverageIndex } from "./coverage";
import type { PartDocKind } from "./types";

/**
 * Which documents a client package carries (#207, spec §3 "Client
 * package"). Pure. The context is the package's own SKU list: an accessory
 * is covered only by a fixture that is on the same quote/design; one quoted
 * without any of its fixtures is a `missing-datasheet` gap on that package
 * only. Every document is listed ONCE with every SKU it serves, so a fixture
 * datasheet that also covers its lens and clamps goes in the zip one time.
 */

export type PackageDocRef = { documentId: string; name: string };
export type PackageDocument = PackageDocRef & { kind: PartDocKind; skus: string[] };

export type PackageSkuDocs = {
  datasheet: PackageDocRef | null;
  /** Fixture SKUs whose datasheet covers this part on this package. */
  datasheetCoveredBy: string[];
  /** True when no datasheet is needed (own, covered, or marked not needed). */
  datasheetOk: boolean;
  specsheet: PackageDocRef | null;
};

export function resolvePackageDocs(
  index: CoverageIndex | null | undefined,
  skus: readonly string[]
): { bySku: Map<string, PackageSkuDocs>; documents: PackageDocument[] } {
  const bySku = new Map<string, PackageSkuDocs>();
  const documents = new Map<string, PackageDocument>();
  const context = new Set(skus);
  const take = (kind: PartDocKind, sku: string, id: string, name: string): PackageDocRef => {
    let d = documents.get(id);
    if (!d) documents.set(id, (d = { documentId: id, name, kind, skus: [] }));
    if (!d.skus.includes(sku)) d.skus.push(sku);
    return { documentId: id, name };
  };
  for (const sku of context) {
    if (!index) {
      bySku.set(sku, { datasheet: null, datasheetCoveredBy: [], datasheetOk: false, specsheet: null });
      continue;
    }
    const ds = slotCoverage(index, sku, "datasheet", context);
    const ss = slotCoverage(index, sku, "specsheet", context);
    const firstFile = (s: typeof ds) => (s.state === "own" || s.state === "covered" ? s.docs[0] ?? null : null);
    const dsDoc = firstFile(ds);
    const ssDoc = firstFile(ss);
    bySku.set(sku, {
      datasheet: dsDoc ? take("datasheet", sku, dsDoc.id, dsDoc.fileName) : null,
      datasheetCoveredBy: ds.state === "covered" ? ds.parents : [],
      datasheetOk: ds.state === "own" || ds.state === "covered" || ds.state === "not-needed",
      specsheet: ssDoc ? take("specsheet", sku, ssDoc.id, ssDoc.fileName) : null,
    });
  }
  return { bySku, documents: [...documents.values()] };
}

/** A zip entry name per document, unique within one package. */
export function packageEntryName(doc: Pick<PackageDocument, "documentId" | "kind" | "name">, used: Set<string>, safe: (s: string) => string): string {
  const folder = doc.kind === "datasheet" ? "datasheets" : "specsheets";
  let name = `${folder}/${safe(doc.name)}`;
  if (used.has(name)) name = `${folder}/${doc.documentId}-${safe(doc.name)}`;
  used.add(name);
  return name;
}
