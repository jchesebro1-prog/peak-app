/**
 * Curtain cut sheets (#292 §3) — the one server loader. SERVER ONLY (reads
 * stores and blobs): never import from a client component.
 */
import { getBlobStream } from "@/lib/blob";
import { partModel } from "@/lib/catalog-rename/sku";
import { isFabricPart } from "@/lib/fabric-part";
import { shrinkImage } from "@/lib/part-docs/shrink";
import { fabricPartsByCategory, getMany, type CatalogPart } from "@/lib/stores/catalog";
import { listCurtainMounts } from "@/lib/stores/curtain-mounts";
import { get as getCustomer } from "@/lib/stores/customers";
import { getProject } from "@/lib/stores/grid-projects";
import { listManufacturers, manufacturerImageLookup } from "@/lib/stores/manufacturers";
import { getDocuments, visibleImagesForParts } from "@/lib/stores/part-documents";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { listTrackSeries } from "@/lib/stores/track-series";
import { getSettings } from "@/lib/settings";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import type { PartDocument } from "@/lib/part-docs/types";
import { collectCurtainTypes, type CollectInput, type CollectResult } from "./collect";
import { curtainFabricLookups } from "./estimator-curtains";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE, cutSheetModel, isCutSheetQuoteType, type CutSheetModel, type CutSheetStyle } from "./model";

export const CUT_SHEET_PHOTOS_MAX = 6;
/** The photo tile prints 1.1 in wide: a ~400 px WebP is plenty, and keeps an inlined (data URI) page small. */
export const CUT_SHEET_PHOTO_EDGE_PX = 400;
export type LoadedCutSheets = { ok: true; quote: Quote; result: CollectResult; models: Record<CutSheetStyle, CutSheetModel[]>; photos: Map<string, string[]> };

type FabricReaders = { getMany: (skus: readonly string[]) => Promise<CatalogPart[]>; byCategory: () => Promise<CatalogPart[]> };

/**
 * Only the fabric rows the curtains name (final review #2): their SKUs by
 * primary key; the fabric categories (never the whole catalog) only when a
 * line must be matched by its printed fabric NAME. `read` is a harness seam.
 */
export async function cutSheetFabricRows(
  need: ReturnType<typeof curtainFabricLookups>,
  read: FabricReaders = { getMany, byCategory: fabricPartsByCategory },
): Promise<CatalogPart[]> {
  const bySku = need.skus.length ? (await read.getMany(need.skus)).filter(isFabricPart) : [];
  const found = new Set(bySku.map((p) => p.sku));
  if (!need.byName && need.byNameIfMissing.every((s) => found.has(s))) return bySku;
  const all = await read.byCategory();
  const have = new Set(all.map((p) => p.sku));
  return [...all, ...bySku.filter((p) => !have.has(p.sku))];
}

/**
 * `sheet` (a print route rendering ONE sheet, e.g. each client-package
 * render): only that sheet's photos are read. Every sheet is still collected —
 * numbering depends on all of them.
 */
export async function loadCutSheets(quoteId: string, opts: { images: "url" | "data" | "none"; sheet?: string }): Promise<LoadedCutSheets | { ok: false; error: string }> {
  const quote = quoteId ? await getQuote(quoteId) : null;
  if (!quote) return { ok: false, error: CUT_SHEETS_NO_QUOTE };
  if (!isCutSheetQuoteType(quote.quoteType)) return { ok: false, error: CUT_SHEETS_WRONG_TYPE };
  const spec = (quote.spec || {}) as { kind?: unknown; gridProjectId?: unknown; sections?: unknown };
  const isGrid = !(Array.isArray(spec.sections) && spec.sections.length) && spec.kind === "grid";
  const [trackSeries, mounts, settings, customer, project] = await Promise.all([
    listTrackSeries(),
    listCurtainMounts(),
    getSettings(),
    getCustomer(quote.customerId),
    isGrid && typeof spec.gridProjectId === "string" ? getProject(spec.gridProjectId) : Promise.resolve(null),
  ]);
  const fabricRows = await cutSheetFabricRows(curtainFabricLookups(quote.spec, project, quote.id));
  const base: CollectInput = {
    quote,
    fabrics: fabricRows.map((p) => ({ sku: p.sku, desc: p.desc, oz: p.oz, ozBasis: p.ozBasis, boltWidthIn: p.boltWidthIn, flameRating: p.flameRating })),
    trackSeries,
    mounts,
    partInfo: new Map(),
    grid: isGrid ? { project } : null,
  };
  // Pass 1 names the hardware SKUs; one getMany reads their live desc/unit; pass 2 prints them.
  const first = collectCurtainTypes(base);
  const skus = [...new Set(first.types.flatMap((t) => t.hardware.map((h) => h.sku)))];
  const result = skus.length
    ? collectCurtainTypes({ ...base, partInfo: new Map((await getMany(skus)).map((p) => [p.sku, { desc: p.desc, unit: p.unit || "ea", model: partModel(p) }])) })
    : first;

  const doc = quoteDocumentDataFor(quote, customer, settings);
  const now = Date.now();
  const total = result.types.length;
  const ctx = (style: CutSheetStyle, index: number) => ({
    style,
    quote: { id: quote.id, number: doc.quoteId, name: quote.name || "", customer: doc.custName, venue: doc.venueLabel, revisions: quote.revisions },
    company: { name: settings.companyName, logoDark: settings.logoDark ?? null, offices: settings.offices },
    preparedBy: doc.preparedByName,
    index,
    total,
    now,
  });
  const models: Record<CutSheetStyle, CutSheetModel[]> = {
    submittal: result.types.map((t, i) => cutSheetModel(t, ctx("submittal", i + 1))),
    client: result.types.map((t, i) => cutSheetModel(t, ctx("client", i + 1))),
  };
  const photos = opts.images === "none" ? new Map<string, string[]>() : await cutSheetPhotos(result, opts.images, opts.sheet);
  return { ok: true, quote, result, models, photos };
}

/**
 * Each sku's one photo document: its own first visible image, else its
 * manufacturer's image (document chain — cut sheets never print a placeholder,
 * so a part with neither is absent). The manufacturer list is only read when
 * some sku has no image of its own; a fallback must be a live image with bytes.
 */
export async function cutSheetPhotoDocs(skus: readonly string[]): Promise<Map<string, PartDocument>> {
  const out = new Map<string, PartDocument>();
  if (!skus.length) return out;
  const images = await visibleImagesForParts(skus);
  const bare: string[] = [];
  for (const sku of skus) {
    const own = images.get(sku)?.[0];
    if (own) out.set(sku, own);
    else bare.push(sku);
  }
  if (!bare.length) return out;
  const imageIdFor = manufacturerImageLookup(await listManufacturers());
  const idBySku = new Map<string, string>();
  for (const p of await getMany(bare)) {
    const id = p.mfr ? imageIdFor(p.mfr) : null;
    if (id) idBySku.set(p.sku, id);
  }
  if (!idBySku.size) return out;
  const docs = new Map((await getDocuments([...idBySku.values()])).map((d) => [d.id, d]));
  for (const [sku, id] of idBySku) {
    const d = docs.get(id);
    if (d && d.kind === "image" && d.blobKey) out.set(sku, d);
  }
  return out;
}

/** Per sheet: the fabric SKU, then the hardware SKUs — first visible image each, at most 6. A failed read drops that photo, never the page. */
async function cutSheetPhotos(result: CollectResult, mode: "url" | "data", sheet?: string): Promise<Map<string, string[]>> {
  const wanted = new Map(
    result.types
      .filter((t) => !sheet || t.sheetNo === sheet)
      .map((t) => [t.sheetNo, [...new Set([t.curtains[0].fabric?.sku, ...t.hardware.map((h) => h.sku)].filter((s): s is string => !!s))]] as const)
  );
  const all = [...new Set([...wanted.values()].flat())];
  const images = await cutSheetPhotoDocs(all);
  const cache = new Map<string, string | null>();
  const out = new Map<string, string[]>();
  for (const [sheet, skus] of wanted) {
    const urls: string[] = [];
    for (const sku of skus) {
      if (urls.length >= CUT_SHEET_PHOTOS_MAX) break;
      const doc = images.get(sku);
      if (!doc) continue;
      let src = cache.get(doc.id);
      if (src === undefined) {
        src = mode === "url" ? `/api/part-documents/${encodeURIComponent(doc.id)}` : await dataUrlOf(doc);
        cache.set(doc.id, src);
      }
      if (src && !urls.includes(src)) urls.push(src);
    }
    if (urls.length) out.set(sheet, urls);
  }
  return out;
}

/** Headless Chrome has no session, so the print route inlines images — shrunk to the tile first (a stored photo is up to 1600 px since #283). */
async function dataUrlOf(doc: PartDocument): Promise<string | null> {
  try {
    if (!doc.blobKey) return null;
    const stream = await getBlobStream(doc.blobKey);
    if (!stream) return null;
    return await cutSheetPhotoDataUrl(Buffer.from(await new Response(stream).arrayBuffer()));
  } catch {
    return null;
  }
}

/** Image bytes → a ≤ CUT_SHEET_PHOTO_EDGE_PX WebP data URI; null (the photo is skipped) when it can't be shrunk. */
export async function cutSheetPhotoDataUrl(bytes: Uint8Array): Promise<string | null> {
  const small = await shrinkImage(bytes, { maxEdge: CUT_SHEET_PHOTO_EDGE_PX });
  return small.ok ? `data:${small.contentType};base64,${small.bytes.toString("base64")}` : null;
}
