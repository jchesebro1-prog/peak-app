import {
  COVERED_COLLAPSE,
  SLOT_NOUN,
  slotCoverage,
  type CoverageIndex,
  type DocRef,
  type SlotCoverage,
} from "./coverage";
import type { QuotedPartStat } from "./quoted-parts";
import { compareImages, DOC_SLOT_KINDS, isDrawingKind, type DocSlotKind, type DrawingKind, type PartDocKind, type PartDocument, type PartDocumentLink, type PartDocumentSource } from "./types";

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
 * Images (#245) are a gallery, not a coverage slot — `buildCoverageIndex`
 * drops them entirely (coverage.ts:86), so they need their own data path
 * into these views rather than riding through `CoverageIndex`. `ImageRef` is
 * the small, pure shape both `documentRow` and `partDocsView` take; the
 * server builds one `Map<sku, ImageRef[]>` per request with `buildImageIndex`
 * from the same `documents`/`links` arrays `loadPartDocsState` already loads
 * (no extra query).
 */
export type ImageRef = { id: string; title: string; source: PartDocumentSource; hidden: boolean; sort: number | null; uploadedAt: number };

export type ImageSlotView = { count: number; first: { id: string; title: string } | null };

/** Gallery order (#245): `compareImages` (types.ts) — a datasheet-render
 *  thumbnail always sorts after every real image, then explicit `sort`
 *  ascending (missing sorts last), then source rank, then upload time. The
 *  same comparator `visibleImagesForParts` uses for the customer-facing
 *  read; staff (this module) additionally see hidden images, unlike that
 *  customer read. */
function sortImages(images: readonly ImageRef[]): ImageRef[] {
  return [...images].sort(compareImages);
}

/** Every live image link, by SKU, in gallery order — hidden ones included
 *  (staff see all; #245). Built from the same `documents`/`links` arrays
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

/** A part's current symbol / riser drawing (#300) for the part editor's
 *  Drawings slots — `removed` is what the SVG sanitizer stripped (empty = nothing). */
export type PartDrawingRef = { id: string; title: string; fileName: string; source: PartDocumentSource; uploadedAt: number; uploadedBy: string; removed: string[] };
export type PartDrawingSlots = Record<DrawingKind, PartDrawingRef | null>;

/** The part's live symbol and riser drawings, from the same `documents` /
 *  `links` arrays `loadPartDocsState` loads (no extra query). attachDocument
 *  keeps one current link per kind; should two ever be live, the newest link
 *  wins, ties to the later one (the same rule as symbolUrlsFor). A document's own kind is
 *  authoritative and one with no stored file is skipped. Pure. */
export function drawingSlotsFor(documents: readonly PartDocument[], links: readonly PartDocumentLink[], sku: string): PartDrawingSlots {
  const docsById = new Map(documents.map((d) => [d.id, d] as const));
  const out: PartDrawingSlots = { symbol: null, riser: null };
  // Stable ascending sort by createdAt, last wins — symbolUrlsFor's rule, so the editor and the canvas agree on ties.
  for (const l of [...links].sort((a, b) => a.createdAt - b.createdAt)) {
    if (l.partSku !== sku) continue;
    const d = docsById.get(l.documentId);
    if (!d || !d.blobKey || !isDrawingKind(d.kind)) continue;
    out[d.kind] = { id: d.id, title: d.title, fileName: d.fileName, source: d.source, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy, removed: [...(d.svgRemoved ?? [])] };
  }
  return out;
}

/** `count` includes hidden images — staff see all (#245); `first` is the
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
  image: ImageSlotView;
} & Record<DocSlotKind, SlotView>;

/** One SlotView per coverage slot (#290: iterate DOC_SLOT_KINDS, never a
 *  hard-coded pair). */
function slotViews(index: CoverageIndex, sku: string, descOf: (sku: string) => string): Record<DocSlotKind, SlotView> {
  const out = {} as Record<DocSlotKind, SlotView>;
  for (const k of DOC_SLOT_KINDS) out[k] = slotViewFor(index, sku, k, descOf);
  return out;
}

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
    ...slotViews(index, part.sku, descOf),
    image: imageSlotView(images),
  };
}

export type DocumentsShow = "all" | "missing-datasheet" | "missing-specsheet" | "missing-manual" | "missing-image" | "link" | "covered";
export const DOCUMENTS_SHOW: Array<{ value: DocumentsShow; label: string }> = [
  { value: "all", label: "All quoted parts" },
  { value: "missing-datasheet", label: "Missing datasheet" },
  { value: "missing-specsheet", label: "Missing spec sheet" },
  { value: "missing-manual", label: "Missing manual" },
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
  if (f.show === "missing-manual" && viewSatisfied(r.manual)) return false;
  if (f.show === "missing-image" && r.image.count > 0) return false;
  if (f.show === "link" && !DOC_SLOT_KINDS.some((k) => r[k].state === "link-only")) return false;
  if (f.show === "covered" && !DOC_SLOT_KINDS.some((k) => r[k].state === "covered")) return false;
  if (f.q) {
    const hay = `${r.sku} ${r.mfr} ${r.model} ${r.desc}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** "412 of 1,180 quoted parts have a datasheet" (spec §3). */
export function progressLine(rows: readonly DocumentRow[], kind: DocSlotKind): string {
  const done = rows.filter((r) => viewSatisfied(r[kind])).length;
  const noun = `a ${SLOT_NOUN[kind]}`;
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

/** One image in the part editor's gallery (#245) — staff see hidden images
 *  too, with their `sort`/`hidden` and a source label the client maps to
 *  copy ("Upload" / "From URL" / "Datasheet thumbnail" / …). */
export type PartDocsImage = { id: string; title: string; source: PartDocumentSource; hidden: boolean; sort: number | null };

/** The part editor's Documents section (#207, spec §3). */
export type PartDocsView = {
  sku: string;
  slots: Record<DocSlotKind, SlotView>;
  /** Every document linked to this part, any slot kind, newest first. */
  documents: PartDocRow[];
  /** Fixtures whose documents cover this part, and for which kinds. */
  coveredBy: Array<PartRef & { kinds: PartDocKind[] }>;
  /** Parts this one covers (its accessories). */
  accessories: PartRef[];
  /** The image gallery, in display order (#245). */
  images: PartDocsImage[];
  /** The part's current symbol / riser drawings (#300) — set by the catalog page via drawingSlotsFor. */
  drawings?: PartDrawingSlots;
};

export function partDocsView(index: CoverageIndex, sku: string, descOf: (sku: string) => string, images: readonly ImageRef[] = []): PartDocsView {
  const linked = index.docsBySku.get(sku);
  const documents = DOC_SLOT_KINDS.flatMap((k) => linked?.[k] ?? [])
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
    const kinds = DOC_SLOT_KINDS.filter((k) => (index.docsBySku.get(p.parentSku)?.[k] ?? []).some((d) => !!d.blobKey));
    if (kinds.length) coveredBy.push({ sku: p.parentSku, desc: descOf(p.parentSku), kinds: [...kinds] });
  }
  return {
    sku,
    slots: slotViews(index, sku, descOf),
    documents,
    coveredBy,
    accessories: (index.childrenOf.get(sku) ?? []).map((s) => ({ sku: s, desc: descOf(s) })),
    images: sortImages(images).map(({ id, title, source, hidden, sort }) => ({ id, title, source, hidden, sort })),
  };
}

/**
 * Make-primary reorder (#290): move `id` to index 0 of the image id list and
 * keep every other id (hidden ones included) in its existing order, so the
 * result is the full list `setImageOrder` requires. `autoBoundary` is the
 * index where the datasheet-render thumbnails start (-1 = none); an id that
 * is absent, or at/beyond the boundary, returns the list unchanged — an auto
 * thumbnail always sorts after every real image (`compareImages`). Pure;
 * never mutates its input.
 */
export function moveImageToFront(ids: readonly string[], id: string, autoBoundary: number): string[] {
  const at = ids.indexOf(id);
  if (at === -1 || (autoBoundary !== -1 && at >= autoBoundary)) return [...ids];
  return [id, ...ids.slice(0, at), ...ids.slice(at + 1)];
}

/**
 * Index of the image the customer portal leads with (#290): the first
 * non-hidden REAL image — a datasheet-render thumbnail (index at/beyond
 * `autoBoundary`, -1 = none) never counts. -1 when there is none. The
 * editor's Primary tag marks exactly this image.
 */
export function primaryImageIndex(images: readonly { hidden?: boolean }[], autoBoundary: number): number {
  const end = autoBoundary === -1 ? images.length : autoBoundary;
  for (let i = 0; i < end; i++) if (!images[i].hidden) return i;
  return -1;
}
