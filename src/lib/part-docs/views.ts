import {
  COVERED_COLLAPSE,
  slotCoverage,
  type CoverageIndex,
  type DocRef,
  type SlotCoverage,
} from "./coverage";
import type { QuotedPartStat } from "./quoted-parts";
import { compareImages, type DocSlotKind, type PartDocKind, type PartDocument, type PartDocumentLink, type PartDocumentSource } from "./types";

/**
 * Serializable view models for the Datasheets page and the part editor
 * (#207). Pure. The server computes these from one CoverageIndex; client
 * components receive only these small objects, never the collections.
 */

export type PartRef = { sku: string; desc: string };

export type SlotView =
  | { state: "own"; docs: DocRef[] }
  | { state: "not-needed" }
  /** Final fix wave (M7): a popular accessory can sit under hundreds of
   *  fixtures, so the server ships only the first COVERED_COLLAPSE parents
   *  and parent documents plus the full counts (`docCount` is the N of
   *  "Covered on N fixture datasheets"). */
  | { state: "covered"; docs: DocRef[]; docCount: number; parents: PartRef[]; parentCount: number }
  | { state: "link-only"; docs: DocRef[]; urls: string[]; error: string | null }
  | { state: "missing" };

export function toSlotView(s: SlotCoverage, index: CoverageIndex, descOf: (sku: string) => string): SlotView {
  switch (s.state) {
    case "own":
    case "not-needed":
    case "missing":
      return s;
    case "covered":
      return {
        state: "covered",
        docs: s.docs.slice(0, COVERED_COLLAPSE),
        docCount: s.docs.length,
        parents: s.parents.slice(0, COVERED_COLLAPSE).map((sku) => ({ sku, desc: descOf(sku) })),
        parentCount: s.parents.length,
      };
    case "link-only": {
      let error: string | null = null;
      let at = -1;
      for (const d of s.docs) {
        const f = index.docsById.get(d.id)?.lastFetch;
        if (f && !f.ok && f.at > at) {
          at = f.at;
          error = f.error || "Fetch failed.";
        }
      }
      return { state: "link-only", docs: s.docs, urls: s.urls, error };
    }
  }
}

export function slotViewFor(index: CoverageIndex, sku: string, kind: DocSlotKind, descOf: (sku: string) => string): SlotView {
  return toSlotView(slotCoverage(index, sku, kind), index, descOf);
}

/** The same answer as coverage.slotSatisfied, on a view. */
export function viewSatisfied(v: SlotView): boolean {
  return v.state === "own" || v.state === "not-needed" || v.state === "covered";
}

/**
 * Images (#242) are a gallery, not a coverage slot — `buildCoverageIndex`
 * drops them entirely (coverage.ts:86), so they need their own data path
 * into these views rather than riding through `CoverageIndex`. `ImageRef` is
 * the small, pure shape both `documentRow` and `partDocsView` take; the
 * server builds one `Map<sku, ImageRef[]>` per request with `buildImageIndex`
 * from the same `documents`/`links` arrays `loadPartDocsState` already loads
 * (no extra query).
 */
export type ImageRef = { id: string; title: string; source: PartDocumentSource; hidden: boolean; sort: number | null; uploadedAt: number };

export type ImageSlotView = { count: number; first: { id: string; title: string } | null };

/** Gallery order (#242): `compareImages` (types.ts) — a datasheet-render
 *  thumbnail always sorts after every real image, then explicit `sort`
 *  ascending (missing sorts last), then source rank, then upload time. The
 *  same comparator `visibleImagesForParts` uses for the customer-facing
 *  read; staff (this module) additionally see hidden images, unlike that
 *  customer read. */
function sortImages(images: readonly ImageRef[]): ImageRef[] {
  return [...images].sort(compareImages);
}

/** Every live image link, by SKU, in gallery order — hidden ones included
 *  (staff see all; #242). Built from the same `documents`/`links` arrays
 *  `loadPartDocsState` already loads, so this needs no extra query. */
export function buildImageIndex(documents: readonly PartDocument[], links: readonly PartDocumentLink[]): Map<string, ImageRef[]> {
  const docsById = new Map(documents.map((d) => [d.id, d] as const));
  const bySku = new Map<string, ImageRef[]>();
  const seen = new Set<string>();
  for (const l of links) {
    const doc = docsById.get(l.documentId);
    if (!doc || doc.kind !== "image") continue;
    const key = `${l.partSku}\u0000${doc.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref: ImageRef = { id: doc.id, title: doc.title, source: doc.source, hidden: !!l.hidden, sort: l.sort ?? null, uploadedAt: doc.uploadedAt };
    const list = bySku.get(l.partSku);
    if (list) list.push(ref);
    else bySku.set(l.partSku, [ref]);
  }
  for (const [sku, list] of bySku) bySku.set(sku, sortImages(list));
  return bySku;
}

export function imagesFor(index: ReadonlyMap<string, ImageRef[]>, sku: string): ImageRef[] {
  return index.get(sku) ?? [];
}

/** `count` includes hidden images — staff see all (#242); `first` is the
 *  gallery's lead image for a thumbnail. */
export function imageSlotView(images: readonly ImageRef[]): ImageSlotView {
  const sorted = sortImages(images);
  return { count: sorted.length, first: sorted[0] ? { id: sorted[0].id, title: sorted[0].title } : null };
}

export type DocumentRow = {
  sku: string;
  mfr: string;
  model: string;
  desc: string;
  category: string;
  quotes: number;
  lastQuotedAt: number | null;
  datasheet: SlotView;
  specsheet: SlotView;
  image: ImageSlotView;
};

export type RowPart = { sku: string; desc: string; category: string; mfr?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };

export function documentRow(stat: QuotedPartStat, part: RowPart, index: CoverageIndex, descOf: (sku: string) => string, images: readonly ImageRef[] = []): DocumentRow {
  return {
    sku: part.sku,
    mfr: part.mfr || "",
    model: part.manufacturerModelNumber || part.manufacturerPartNumber || "",
    desc: part.desc,
    category: part.category || "",
    quotes: stat.quotes,
    lastQuotedAt: stat.lastQuotedAt,
    datasheet: slotViewFor(index, part.sku, "datasheet", descOf),
    specsheet: slotViewFor(index, part.sku, "specsheet", descOf),
    image: imageSlotView(images),
  };
}

export type DocumentsShow = "all" | "missing-datasheet" | "missing-specsheet" | "missing-image" | "link" | "covered";
export const DOCUMENTS_SHOW: Array<{ value: DocumentsShow; label: string }> = [
  { value: "all", label: "All quoted parts" },
  { value: "missing-datasheet", label: "Missing datasheet" },
  { value: "missing-specsheet", label: "Missing spec sheet" },
  { value: "missing-image", label: "Missing image" },
  { value: "link", label: "Link to fetch" },
  { value: "covered", label: "Covered by a fixture" },
];

export type DocumentsFilter = { show: DocumentsShow; mfr: string; cat: string; q: string };

export function parseDocumentsFilter(sp: Record<string, string | string[] | undefined>): DocumentsFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const show = one(sp.show) as DocumentsShow;
  return {
    show: DOCUMENTS_SHOW.some((s) => s.value === show) ? show : "all",
    mfr: one(sp.mfr).trim(),
    cat: one(sp.cat).trim(),
    q: one(sp.q).trim(),
  };
}

export function documentRowMatches(r: DocumentRow, f: DocumentsFilter): boolean {
  if (f.mfr && r.mfr !== f.mfr) return false;
  if (f.cat && r.category !== f.cat) return false;
  if (f.show === "missing-datasheet" && viewSatisfied(r.datasheet)) return false;
  if (f.show === "missing-specsheet" && viewSatisfied(r.specsheet)) return false;
  if (f.show === "missing-image" && r.image.count > 0) return false;
  if (f.show === "link" && r.datasheet.state !== "link-only" && r.specsheet.state !== "link-only") return false;
  if (f.show === "covered" && r.datasheet.state !== "covered" && r.specsheet.state !== "covered") return false;
  if (f.q) {
    const hay = `${r.sku} ${r.mfr} ${r.model} ${r.desc}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** "412 of 1,180 quoted parts have a datasheet" (spec §3). */
export function progressLine(rows: readonly DocumentRow[], kind: DocSlotKind): string {
  const done = rows.filter((r) => viewSatisfied(r[kind])).length;
  const noun = kind === "datasheet" ? "a datasheet" : "a spec sheet";
  return `${done.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} quoted parts have ${noun}`;
}

export type PartDocRow = {
  id: string;
  kind: PartDocKind;
  title: string;
  fileName: string;
  hasFile: boolean;
  sourceUrl: string | null;
  source: string;
  uploadedAt: number;
  uploadedBy: string;
  history: Array<{ index: number; fileName: string; replacedAt: number; replacedBy: string }>;
};

/** One image in the part editor's gallery (#242) — staff see hidden images
 *  too, with their `sort`/`hidden` and a source label the client maps to
 *  copy ("Upload" / "From URL" / "Datasheet thumbnail" / …). */
export type PartDocsImage = { id: string; title: string; source: PartDocumentSource; hidden: boolean; sort: number | null };

/** The part editor's Documents section (#207, spec §3). */
export type PartDocsView = {
  sku: string;
  slots: Record<DocSlotKind, SlotView>;
  /** Every document linked to this part, either kind, newest first. */
  documents: PartDocRow[];
  /** Fixtures whose documents cover this part, and for which kinds. */
  coveredBy: Array<PartRef & { kinds: PartDocKind[] }>;
  /** Parts this one covers (its accessories). */
  accessories: PartRef[];
  /** The image gallery, in display order (#242). */
  images: PartDocsImage[];
};

export function partDocsView(index: CoverageIndex, sku: string, descOf: (sku: string) => string, images: readonly ImageRef[] = []): PartDocsView {
  const linked = index.docsBySku.get(sku);
  const documents = [...(linked?.datasheet ?? []), ...(linked?.specsheet ?? [])]
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      fileName: d.fileName,
      hasFile: !!d.blobKey,
      sourceUrl: d.sourceUrl,
      source: d.source,
      uploadedAt: d.uploadedAt,
      uploadedBy: d.uploadedBy,
      history: (d.history || []).map((h, i) => ({ index: i, fileName: h.fileName, replacedAt: h.replacedAt, replacedBy: h.replacedBy })),
    }));
  const coveredBy: PartDocsView["coveredBy"] = [];
  for (const p of index.parentsOf.get(sku) ?? []) {
    if (p.ownDatasheet) continue;
    const kinds = (["datasheet", "specsheet"] as const).filter((k) => (index.docsBySku.get(p.parentSku)?.[k] ?? []).some((d) => !!d.blobKey));
    if (kinds.length) coveredBy.push({ sku: p.parentSku, desc: descOf(p.parentSku), kinds: [...kinds] });
  }
  return {
    sku,
    slots: { datasheet: slotViewFor(index, sku, "datasheet", descOf), specsheet: slotViewFor(index, sku, "specsheet", descOf) },
    documents,
    coveredBy,
    accessories: (index.childrenOf.get(sku) ?? []).map((s) => ({ sku: s, desc: descOf(s) })),
    images: sortImages(images).map(({ id, title, source, hidden, sort }) => ({ id, title, source, hidden, sort })),
  };
}
