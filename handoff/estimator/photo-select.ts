/**
 * Estimator handoff — which product photo each part ships with, and the browser's photo map (PR 2 Task 11).
 * Pure: no I/O, no store. Shared by handoff:slice (data/photo-manifest.json, data/photos.js) and handoff:photos.
 *
 * The rule is the app's own, ported over the export's collections instead of the store:
 *   own photo       src/lib/stores/part-documents.ts visibleImagesForParts — a part's live, non-hidden image links in
 *                   compareImages order (src/lib/part-docs/types.ts, imported — it is pure); the first is the primary.
 *   fallback        src/lib/narrative/photos.ts keyProductPhotoDocs — a part with no photo of its own gets its
 *                   manufacturer's image (src/lib/stores/manufacturers.ts manufacturerImageLookup: the `manufacturers`
 *                   collection, mfrKey of the part's `mfr`, merged spellings follow canonicalKeyMap).
 * Port drift: handoff/estimator/port-sources.json lists the originals.
 *
 * Scope: only parts the sliced estimates and fixtures name (their line skus, assembly members, light engine / lens),
 * followed through SKU renames. Every other part's Catalog thumbnail stays the placeholder.
 *
 * ONE scheme feeds both browser lookups (runtime/assets.ts): `bySku[sku] = docId` and `byDoc[docId] = "images/<file>"`.
 * partPhotoSrc (Catalog thumbnails) and the quote document's key-product photos both go sku → docId → file.
 */
import { compareImages, type PartDocumentSource } from "@/lib/part-docs/types";
import { mfrKey } from "@/lib/catalog-books";
import { canonicalKeyMap } from "@/lib/manufacturer-aliases";

type Row = Record<string, unknown>;
type DocRowLike = { id: string; doc?: Row | null; deleted?: boolean | null };
/** The slice of a db:export (format 2) this module reads. */
export type PhotoExport = { collections?: Record<string, DocRowLike[] | undefined> };

export type PhotoPick = {
  sku: string;
  docId: string;
  /** Private Blob pathname; null = a link-only document (nothing to download). */
  blobKey: string | null;
  /** scheme + host + path only (signed-URL query strings never leave the export). */
  sourceUrl: string | null;
  /** "own" = the part's primary visible image; "manufacturer" = its manufacturer's image. */
  via: "own" | "manufacturer";
};

export type PhotoSelection = {
  /** The skus the sliced estimates and fixtures name (renames followed), sorted. */
  scopeSkus: string[];
  /** One pick per sku that has a photo, sorted by sku. */
  picks: PhotoPick[];
  /** In-scope skus with no photo at all (the placeholder shows). */
  withoutPhoto: string[];
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** scheme + host + path only: signed-URL query strings, fragments and credentials never reach a manifest. */
export function cleanSourceUrl(u: unknown): string | null {
  if (typeof u !== "string" || u === "") return null;
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname}`;
  } catch {
    return u.split(/[?#]/)[0] || null;
  }
}

const SKU_KEYS = new Set(["sku", "lightEngineSku", "lensSku"]);

/** Every sku-shaped value anywhere in `value` (line skus, components, light engine / lens, rack placements…). */
function collectSkus(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) collectSkus(v, into, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Row)) {
    if (SKU_KEYS.has(k) && typeof v === "string") {
      const s = v.trim();
      if (s) into.add(s);
    } else if (v && typeof v === "object") {
      collectSkus(v, into, depth + 1);
    }
  }
}

/** The skus the given estimates and fixtures name. Pure. */
export function photoScopeSkus(estimates: readonly Row[], fixtures: readonly Row[]): string[] {
  const s = new Set<string>();
  for (const q of estimates) collectSkus(q, s);
  for (const f of fixtures) collectSkus(f, s);
  return [...s].sort();
}

const live = (exp: PhotoExport, collection: string): Array<{ id: string; doc: Row }> =>
  (exp.collections?.[collection] ?? []).filter((r) => !r.deleted).map((r) => ({ id: r.id, doc: (r.doc ?? {}) as Row }));

/** old sku → current sku, from the catalog's retired parts (`renamedTo`); chains followed, loops stop. */
function renameFollower(exp: PhotoExport): (sku: string) => string {
  const to = new Map<string, string>();
  for (const r of exp.collections?.catalog_parts ?? []) {
    const t = str((r.doc as Row | null | undefined)?.renamedTo);
    if (r.deleted && t) to.set(r.id, t);
  }
  return (sku) => {
    let k = sku;
    for (let i = 0; i < 8 && to.has(k) && to.get(k) !== k; i++) k = to.get(k)!;
    return k;
  };
}

type ImageDoc = { id: string; blobKey: string | null; sourceUrl: string | null; source: PartDocumentSource; uploadedAt: number };

function imageDoc(r: { id: string; doc: Row } | undefined): ImageDoc | null {
  if (!r || r.doc.kind !== "image") return null;
  const blobKey = str(r.doc.blobKey) || null;
  const sourceUrl = str(r.doc.sourceUrl) || null;
  // A document with neither a stored file nor a link is dead — the app's own route 404s on it.
  if (!blobKey && !sourceUrl) return null;
  const source = (typeof r.doc.source === "string" ? r.doc.source : "upload") as PartDocumentSource;
  return { id: r.id, blobKey, sourceUrl, source, uploadedAt: Number(r.doc.uploadedAt) || 0 };
}

/** Port of manufacturers.ts manufacturerImageLookup over the export's `manufacturers` docs: mfr name → image document id. */
export function manufacturerImageIds(records: ReadonlyArray<Row>): (mfr: string) => string | null {
  const recs = records.map((r) => ({
    key: str(r.key),
    aliasKeys: Array.isArray(r.aliasKeys) ? r.aliasKeys.filter((k): k is string => typeof k === "string" && !!k) : [],
    mergedInto: str(r.mergedInto) || null,
    imageDocumentId: str(r.imageDocumentId) || null,
  }));
  const canon = canonicalKeyMap(recs);
  const byKey = new Map<string, string>();
  for (const m of recs) {
    if (!m.imageDocumentId || m.mergedInto || canon(m.key) !== m.key) continue;
    for (const k of [m.key, ...m.aliasKeys]) byKey.set(k, m.imageDocumentId);
  }
  return (mfr) => byKey.get(mfrKey(mfr)) ?? null;
}

/**
 * Each in-scope sku's photo: its primary visible image (compareImages order), else its manufacturer's image.
 * `estimates` / `fixtures` are the docs being sliced (the slicer passes its final lists).
 */
export function selectPhotos(exp: PhotoExport, estimates: readonly Row[], fixtures: readonly Row[]): PhotoSelection {
  const follow = renameFollower(exp);
  const scopeSkus = [...new Set(photoScopeSkus(estimates, fixtures).map(follow))].sort();
  const inScope = new Set(scopeSkus);

  const docs = new Map(live(exp, "part_documents").map((d) => [d.id, d]));
  const mfrOf = new Map<string, string>();
  for (const p of live(exp, "catalog_parts")) {
    const sku = str(p.doc.sku) || p.id;
    if (inScope.has(sku)) mfrOf.set(sku, str(p.doc.mfr));
  }
  const mfrImage = manufacturerImageIds(live(exp, "manufacturers").map((m) => m.doc));

  // visibleImagesForParts: live, non-hidden image links; one entry per document; compareImages(link.sort, doc.source/uploadedAt).
  const bySku = new Map<string, Array<{ doc: ImageDoc; sort: number | null }>>();
  for (const l of live(exp, "part_document_links")) {
    if (l.doc.kind !== "image" || l.doc.hidden) continue;
    const sku = follow(str(l.doc.partSku));
    if (!inScope.has(sku)) continue;
    const d = imageDoc(docs.get(str(l.doc.documentId)));
    if (!d) continue;
    const list = bySku.get(sku) ?? [];
    if (!list.some((x) => x.doc.id === d.id)) list.push({ doc: d, sort: typeof l.doc.sort === "number" ? l.doc.sort : null });
    bySku.set(sku, list);
  }

  const toPick = (sku: string, d: ImageDoc, via: PhotoPick["via"]): PhotoPick => ({ sku, docId: d.id, blobKey: d.blobKey, sourceUrl: cleanSourceUrl(d.sourceUrl), via });
  const picks: PhotoPick[] = [];
  const withoutPhoto: string[] = [];
  for (const sku of scopeSkus) {
    const own = bySku.get(sku);
    if (own?.length) {
      own.sort((a, b) => compareImages({ source: a.doc.source, sort: a.sort, uploadedAt: a.doc.uploadedAt }, { source: b.doc.source, sort: b.sort, uploadedAt: b.doc.uploadedAt }));
      picks.push(toPick(sku, own[0].doc, "own"));
      continue;
    }
    const mfr = mfrOf.get(sku);
    const mid = mfr ? mfrImage(mfr) : null;
    const md = mid ? imageDoc(docs.get(mid)) : null;
    if (md) picks.push(toPick(sku, md, "manufacturer"));
    else withoutPhoto.push(sku);
  }
  return { scopeSkus, picks, withoutPhoto };
}

/** The photos handoff:photos downloads: the picks' distinct documents with a stored file, plus the link-only ones it records. */
export function downloadPlan(picks: readonly PhotoPick[]): { download: Array<{ docId: string; blobKey: string }>; linkOnly: Array<{ sku: string; docId: string; sourceUrl: string | null }> } {
  const seen = new Set<string>();
  const download: Array<{ docId: string; blobKey: string }> = [];
  const linkOnly: Array<{ sku: string; docId: string; sourceUrl: string | null }> = [];
  for (const p of picks) {
    if (p.blobKey === null) {
      linkOnly.push({ sku: p.sku, docId: p.docId, sourceUrl: p.sourceUrl });
      continue;
    }
    if (seen.has(p.docId)) continue;
    seen.add(p.docId);
    download.push({ docId: p.docId, blobKey: p.blobKey });
  }
  return { download, linkOnly };
}

// ---------------------------------------------------------------------------------------------------------------
// images/manifest.json  (written by handoff:photos)  and  data/photos.js  (written by handoff:slice)

export const PHOTO_MANIFEST_VERSION = 1;
export type PhotoManifest = {
  version: typeof PHOTO_MANIFEST_VERSION;
  /** sku → document id of the photo that sku shows. */
  bySku: Record<string, string>;
  /** document id → file name inside images/. */
  byDoc: Record<string, string>;
  /** Picks whose document is link-only (no stored file): recorded, not downloaded. */
  linkOnly: Array<{ sku: string; docId: string }>;
  /** Documents that could not be downloaded (after retries). */
  failed: Array<{ docId: string; error: string }>;
};

/** `<docId>.<ext>` — nothing else is ever referenced from the page. */
export const IMAGE_FILE_RE = /^[A-Za-z0-9_-]{1,64}\.(webp|png|jpg|gif)$/;
export const DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A manifest read from disk, validated; null when it isn't one. Entries naming an unsafe file or an unknown doc are dropped. */
export function parsePhotoManifest(raw: unknown): PhotoManifest | null {
  const m = raw as Partial<PhotoManifest> | null;
  if (!m || typeof m !== "object" || m.version !== PHOTO_MANIFEST_VERSION || !m.byDoc || typeof m.byDoc !== "object" || !m.bySku || typeof m.bySku !== "object") return null;
  const byDoc: Record<string, string> = Object.create(null);
  for (const [id, file] of Object.entries(m.byDoc)) if (DOC_ID_RE.test(id) && typeof file === "string" && IMAGE_FILE_RE.test(file)) byDoc[id] = file;
  const bySku: Record<string, string> = Object.create(null);
  for (const [sku, id] of Object.entries(m.bySku)) if (typeof id === "string" && id in byDoc) bySku[sku] = id;
  return {
    version: PHOTO_MANIFEST_VERSION,
    bySku: { ...bySku },
    byDoc: { ...byDoc },
    linkOnly: Array.isArray(m.linkOnly) ? m.linkOnly.filter((x) => x && typeof x.sku === "string" && typeof x.docId === "string") : [],
    failed: Array.isArray(m.failed) ? m.failed.filter((x) => x && typeof x.docId === "string").map((x) => ({ docId: x.docId, error: String(x.error ?? "") })) : [],
  };
}

/** The body of data/photos.js: `window.PEAK_PHOTOS = { bySku: {sku: docId}, byDoc: {docId: "images/<file>"} }`. */
export function photosScript(m: PhotoManifest): string {
  const byDoc: Record<string, string> = {};
  for (const [id, file] of Object.entries(m.byDoc)) byDoc[id] = `images/${file}`;
  return `window.PEAK_PHOTOS = ${JSON.stringify({ bySku: m.bySku, byDoc })};\n`;
}
