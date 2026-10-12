import { ownFiles, slotCoverage, type CoverageIndex } from "./coverage";
import { datasheetLooseName, zipEntrySafe } from "./datasheet-book";
import { datasheetExclusion, type DatasheetExclusion } from "./exclusions";
import { isDocSlotKind, type DocSlotKind, type PartDocKind } from "./types";

/**
 * Which documents a client package carries (#207, spec §3 "Client
 * package"). Pure. The context is the package's own SKU list: an accessory
 * is covered only by a fixture that is on the same quote/design; one quoted
 * without any of its fixtures is a `missing-datasheet` gap on that package
 * only. Every document is listed ONCE with every SKU it serves, so a fixture
 * datasheet that also covers its lens and clamps goes in the zip one time.
 *
 * #333: `opts.excludedDatasheets` (a project's left-out datasheets) leaves a
 * SKU's datasheet out — itself, or an accessory every covering fixture of
 * which is out (exclusions.ts). An excluded SKU is no gap and never `take`s
 * its datasheet, so a document reaches `documents` only through an included
 * SKU; an accessory still covered by an included fixture takes that
 * fixture's datasheet. Spec sheets and manuals are untouched (Q1). With no
 * opts the output is exactly the pre-#333 output.
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
  /** The part's own manual, or a fixture manual covering it (#290). */
  manual: PackageDocRef | null;
  /** #333: this project leaves the datasheet out — the SKU itself, or every fixture covering it. Absent = included. */
  datasheetExcluded?: DatasheetExclusion;
};

export function resolvePackageDocs(
  index: CoverageIndex | null | undefined,
  skus: readonly string[],
  opts?: { excludedDatasheets?: ReadonlySet<string> }
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
      bySku.set(sku, { datasheet: null, datasheetCoveredBy: [], datasheetOk: false, specsheet: null, manual: null });
      continue;
    }
    const ds = slotCoverage(index, sku, "datasheet", context);
    const firstFile = (s: typeof ds) => (s.state === "own" || s.state === "covered" ? s.docs[0] ?? null : null);
    const excluded = opts?.excludedDatasheets;
    const ex = excluded ? datasheetExclusion({ sku, state: ds.state, coveredBy: ds.state === "covered" ? ds.parents : [] }, excluded) : null;
    let dsDoc: { id: string; fileName: string } | null = ex ? null : firstFile(ds);
    let coveredBy = ds.state === "covered" ? ds.parents : [];
    if (!ex && excluded && ds.state === "covered" && coveredBy.some((p) => excluded.has(p))) {
      // Some covering fixtures are left out: cover through the included ones' datasheets only.
      coveredBy = coveredBy.filter((p) => !excluded.has(p));
      const f = ownFiles(index, coveredBy[0], "datasheet")[0];
      dsDoc = f ? { id: f.id, fileName: f.fileName } : null;
    }
    const ssDoc = firstFile(slotCoverage(index, sku, "specsheet", context));
    const mnDoc = firstFile(slotCoverage(index, sku, "manual", context));
    const row: PackageSkuDocs = {
      datasheet: dsDoc ? take("datasheet", sku, dsDoc.id, dsDoc.fileName) : null,
      datasheetCoveredBy: coveredBy,
      datasheetOk: ex ? true : ds.state === "own" || ds.state === "covered" || ds.state === "not-needed",
      specsheet: ssDoc ? take("specsheet", sku, ssDoc.id, ssDoc.fileName) : null,
      manual: mnDoc ? take("manual", sku, mnDoc.id, mnDoc.fileName) : null,
    };
    if (ex) row.datasheetExcluded = ex;
    bySku.set(sku, row);
  }
  return { bySku, documents: [...documents.values()] };
}

/** The zip folder per slot kind (#290: manuals get their own). */
const PACKAGE_FOLDER: Record<DocSlotKind, string> = { datasheet: "datasheets", specsheet: "specsheets", manual: "manuals" };

/** A zip entry name per document, unique within one package. */
export function packageEntryName(doc: Pick<PackageDocument, "documentId" | "kind" | "name">, used: Set<string>, safe: (s: string) => string): string {
  // #300: resolvePackageDocs only ever takes slot kinds, so a symbol/riser drawing never reaches a package; "drawings" only keeps this total.
  const folder = doc.kind === "image" ? "images" : isDocSlotKind(doc.kind) ? PACKAGE_FOLDER[doc.kind] : "drawings";
  let name = `${folder}/${safe(doc.name)}`;
  // #329 review: keyed case-insensitively — "ETC - S4.pdf" and "ETC - s4.pdf" are one file on macOS/Windows extraction.
  if (used.has(name.toLowerCase())) name = `${folder}/${doc.documentId}-${safe(doc.name)}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * #329 — a datasheet's loose zip entry, manufacturer first
 * (`datasheets/ETC - ColorSource Spot.pdf`) so the folder sorts by
 * manufacturer; spaces kept; the same clash rule as packageEntryName.
 * `mfr` is the book plan's docMfr ("" keeps the file's own name).
 */
export function datasheetEntryName(doc: Pick<PackageDocument, "documentId" | "kind" | "name">, mfr: string, used: Set<string>): string {
  return packageEntryName({ ...doc, name: datasheetLooseName(mfr, doc.name) }, used, zipEntrySafe);
}
