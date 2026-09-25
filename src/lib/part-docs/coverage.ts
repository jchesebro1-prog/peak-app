import type { DocNotNeeded, PartAccessoryLink, PartDocKind, PartDocument, PartDocumentLink } from "./types";

/**
 * The coverage rule (#DOC, spec §4) — pure, so the to-do page, the part
 * editor, the Assembly Builder, the Specs coverage table and the client
 * package all read one answer. Every pass is a single walk over its input
 * into Maps: production has ~37,400 catalog parts, so nothing here may scan
 * one collection per element of another.
 *
 * For a part P and a kind K:
 *  1. P has its OWN document of kind K with a stored file → "own".
 *  2. Else P is marked not needed for K → "not-needed".
 *  3. Else P is an accessory of parents that have their own K document →
 *     "covered". With a context (the SKUs on one quote), only parents present
 *     in it count; none present → P is not covered on that quote. A pair
 *     marked `ownDatasheet` never covers (for either kind — D-DOC-2).
 *  4. Else P has only a URL nobody has fetched → "link-only" (not satisfied).
 *  5. Else → "missing".
 */

export type CoveragePartInput = {
  sku: string;
  docNotNeeded?: DocNotNeeded;
  /** DaVinci manufacturer links (#162). */
  docs?: Array<{ kind: string; url: string }>;
  /** Imported Datasheet URL / Guide Spec URL columns. */
  productMetadata?: { datasheets?: Array<{ kind: string; sourceUrl?: string }> };
};

type ByKind<T> = { datasheet: T[]; specsheet: T[] };

export type CoverageIndex = {
  docsById: Map<string, PartDocument>;
  /** Live documents linked to each part, split by kind. */
  docsBySku: Map<string, ByKind<PartDocument>>;
  /** Accessory SKU → its parents, one entry per parent (pairs collapsed). */
  parentsOf: Map<string, Array<{ parentSku: string; ownDatasheet: boolean }>>;
  /** Parent SKU → its accessory SKUs. */
  childrenOf: Map<string, string[]>;
  notNeeded: Map<string, DocNotNeeded>;
  /** URLs the catalog row itself carries, not yet on any linked document. */
  catalogUrls: Map<string, ByKind<string>>;
};

export type DocRef = { id: string; title: string; fileName: string; hasFile: boolean; sourceUrl: string | null };

export type SlotCoverage =
  | { state: "own"; docs: DocRef[] }
  | { state: "not-needed" }
  | { state: "covered"; parents: string[]; docs: DocRef[] }
  | { state: "link-only"; docs: DocRef[]; urls: string[] }
  | { state: "missing" };

export type SlotState = SlotCoverage["state"];

/** "Covered on N fixture datasheets" lists at most this many before collapsing (§4). */
export const COVERED_COLLAPSE = 5;

const empty = <T,>(): ByKind<T> => ({ datasheet: [], specsheet: [] });

/** Which slot a catalog-held URL feeds. Manuals and "other" feed neither. */
export function urlKindOf(kind: string): PartDocKind | null {
  if (kind === "datasheet" || kind === "cut-sheet") return "datasheet";
  if (kind === "guide-spec") return "specsheet";
  return null;
}

export function toDocRef(d: PartDocument): DocRef {
  return { id: d.id, title: d.title, fileName: d.fileName, hasFile: !!d.blobKey, sourceUrl: d.sourceUrl };
}

export function buildCoverageIndex(input: {
  documents: PartDocument[];
  links: PartDocumentLink[];
  accessoryLinks: PartAccessoryLink[];
  parts: CoveragePartInput[];
}): CoverageIndex {
  const docsById = new Map<string, PartDocument>();
  for (const d of input.documents) docsById.set(d.id, d);

  const docsBySku = new Map<string, ByKind<PartDocument>>();
  const seenLink = new Set<string>();
  for (const l of input.links) {
    const doc = docsById.get(l.documentId);
    if (!doc) continue; // a link to a removed document covers nothing
    const key = `${l.partSku}\u0000${doc.id}`;
    if (seenLink.has(key)) continue;
    seenLink.add(key);
    let slot = docsBySku.get(l.partSku);
    if (!slot) docsBySku.set(l.partSku, (slot = empty()));
    slot[doc.kind].push(doc);
  }

  const pair = new Map<string, { parentSku: string; accessorySku: string; ownDatasheet: boolean }>();
  for (const a of input.accessoryLinks) {
    if (!a.parentSku || !a.accessorySku || a.parentSku === a.accessorySku) continue;
    const key = `${a.parentSku}\u0000${a.accessorySku}`;
    const current = pair.get(key);
    if (current) current.ownDatasheet = current.ownDatasheet || !!a.ownDatasheet;
    else pair.set(key, { parentSku: a.parentSku, accessorySku: a.accessorySku, ownDatasheet: !!a.ownDatasheet });
  }
  const parentsOf = new Map<string, Array<{ parentSku: string; ownDatasheet: boolean }>>();
  const childrenOf = new Map<string, string[]>();
  for (const p of pair.values()) {
    const ps = parentsOf.get(p.accessorySku);
    if (ps) ps.push({ parentSku: p.parentSku, ownDatasheet: p.ownDatasheet });
    else parentsOf.set(p.accessorySku, [{ parentSku: p.parentSku, ownDatasheet: p.ownDatasheet }]);
    const cs = childrenOf.get(p.parentSku);
    if (cs) cs.push(p.accessorySku);
    else childrenOf.set(p.parentSku, [p.accessorySku]);
  }

  const notNeeded = new Map<string, DocNotNeeded>();
  const catalogUrls = new Map<string, ByKind<string>>();
  for (const part of input.parts) {
    if (part.docNotNeeded && (part.docNotNeeded.datasheet || part.docNotNeeded.specsheet)) notNeeded.set(part.sku, part.docNotNeeded);
    const known = new Set<string>();
    const linked = docsBySku.get(part.sku);
    for (const d of [...(linked?.datasheet ?? []), ...(linked?.specsheet ?? [])]) if (d.sourceUrl) known.add(d.sourceUrl);
    let urls: ByKind<string> | null = null;
    const add = (kind: PartDocKind | null, url: string | undefined) => {
      const u = (url || "").trim();
      if (!kind || !/^https?:\/\//i.test(u) || known.has(u)) return;
      known.add(u);
      if (!urls) urls = empty();
      urls[kind].push(u);
    };
    for (const d of part.docs ?? []) add(d.kind === "datasheet" ? "datasheet" : null, d.url);
    for (const d of part.productMetadata?.datasheets ?? []) add(urlKindOf(d.kind), d.sourceUrl);
    if (urls) catalogUrls.set(part.sku, urls);
  }

  return { docsById, docsBySku, parentsOf, childrenOf, notNeeded, catalogUrls };
}

/** Every live document of kind K linked to this part, file or not. */
export function linkedDocuments(index: CoverageIndex, sku: string, kind: PartDocKind): PartDocument[] {
  return index.docsBySku.get(sku)?.[kind] ?? [];
}

/** The part's own documents of kind K that hold a stored file. */
export function ownFiles(index: CoverageIndex, sku: string, kind: PartDocKind): PartDocument[] {
  return linkedDocuments(index, sku, kind).filter((d) => !!d.blobKey);
}

/** The SKUs whose documents cover `sku` for kind K — before any context filter. */
export function coveringParents(index: CoverageIndex, sku: string, kind: PartDocKind): string[] {
  const out: string[] = [];
  for (const p of index.parentsOf.get(sku) ?? []) {
    if (p.ownDatasheet) continue;
    if (ownFiles(index, p.parentSku, kind).length) out.push(p.parentSku);
  }
  return out;
}

export function slotCoverage(
  index: CoverageIndex,
  sku: string,
  kind: PartDocKind,
  context?: ReadonlySet<string> | null
): SlotCoverage {
  const own = ownFiles(index, sku, kind);
  if (own.length) return { state: "own", docs: own.map(toDocRef) };

  if (index.notNeeded.get(sku)?.[kind]) return { state: "not-needed" };

  let parents = coveringParents(index, sku, kind);
  if (context) parents = parents.filter((p) => context.has(p));
  if (parents.length) {
    const docs = new Map<string, DocRef>();
    for (const p of parents) for (const d of ownFiles(index, p, kind)) if (!docs.has(d.id)) docs.set(d.id, toDocRef(d));
    return { state: "covered", parents, docs: [...docs.values()] };
  }

  const linkOnly = linkedDocuments(index, sku, kind).filter((d) => !d.blobKey && !!d.sourceUrl);
  const urls = index.catalogUrls.get(sku)?.[kind] ?? [];
  if (linkOnly.length || urls.length) return { state: "link-only", docs: linkOnly.map(toDocRef), urls: [...urls] };

  return { state: "missing" };
}

/** own, not-needed and covered satisfy the slot; link-only and missing do not. */
export function slotSatisfied(s: SlotCoverage): boolean {
  return s.state === "own" || s.state === "not-needed" || s.state === "covered";
}

/** The SKUs among `skus` whose datasheet slot is satisfied with no context —
 *  the Specs coverage table's "datasheet" column (§7). */
export function datasheetSatisfiedSkus(index: CoverageIndex, skus: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const sku of skus) if (slotSatisfied(slotCoverage(index, sku, "datasheet"))) out.add(sku);
  return out;
}

/** Show the first `max`, count the rest (§4 — collapse the list above 5). */
export function collapseList<T>(items: readonly T[], max = COVERED_COLLAPSE): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** "Covered on 1 fixture datasheet" / "Covered on 3 fixture spec sheets". */
export function coveredLabel(n: number, kind: PartDocKind): string {
  const noun = kind === "datasheet" ? "datasheet" : "spec sheet";
  return `Covered on ${n} fixture ${noun}${n === 1 ? "" : "s"}`;
}
