/**
 * Curtain cut sheets (#292 §3) — the one server loader. SERVER ONLY (reads
 * stores and blobs): never import from a client component.
 */
import { getBlobStream } from "@/lib/blob";
import { fabricParts, getMany } from "@/lib/stores/catalog";
import { listCurtainMounts } from "@/lib/stores/curtain-mounts";
import { get as getCustomer } from "@/lib/stores/customers";
import { getProject } from "@/lib/stores/grid-projects";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { listTrackSeries } from "@/lib/stores/track-series";
import { getSettings } from "@/lib/settings";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import type { PartDocument } from "@/lib/part-docs/types";
import { collectCurtainTypes, type CollectInput, type CollectResult } from "./collect";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE, cutSheetModel, isCutSheetQuoteType, type CutSheetModel, type CutSheetStyle } from "./model";

export const CUT_SHEET_PHOTOS_MAX = 6;
export type LoadedCutSheets = { ok: true; quote: Quote; result: CollectResult; models: Record<CutSheetStyle, CutSheetModel[]>; photos: Map<string, string[]> };

export async function loadCutSheets(quoteId: string, opts: { images: "url" | "data" | "none" }): Promise<LoadedCutSheets | { ok: false; error: string }> {
  const quote = quoteId ? await getQuote(quoteId) : null;
  if (!quote) return { ok: false, error: CUT_SHEETS_NO_QUOTE };
  if (!isCutSheetQuoteType(quote.quoteType)) return { ok: false, error: CUT_SHEETS_WRONG_TYPE };
  const spec = (quote.spec || {}) as { kind?: unknown; gridProjectId?: unknown; sections?: unknown };
  const isGrid = !(Array.isArray(spec.sections) && spec.sections.length) && spec.kind === "grid";
  const [fabricRows, trackSeries, mounts, settings, customer, project] = await Promise.all([
    fabricParts(),
    listTrackSeries(),
    listCurtainMounts(),
    getSettings(),
    getCustomer(quote.customerId),
    isGrid && typeof spec.gridProjectId === "string" ? getProject(spec.gridProjectId) : Promise.resolve(null),
  ]);
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
    ? collectCurtainTypes({ ...base, partInfo: new Map((await getMany(skus)).map((p) => [p.sku, { desc: p.desc, unit: p.unit || "ea" }])) })
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
  const photos = opts.images === "none" ? new Map<string, string[]>() : await cutSheetPhotos(result, opts.images);
  return { ok: true, quote, result, models, photos };
}

/** Per sheet: the fabric SKU, then the hardware SKUs — first visible image each, at most 6. A failed read drops that photo, never the page. */
async function cutSheetPhotos(result: CollectResult, mode: "url" | "data"): Promise<Map<string, string[]>> {
  const wanted = new Map(
    result.types.map((t) => [t.sheetNo, [...new Set([t.curtains[0].fabric?.sku, ...t.hardware.map((h) => h.sku)].filter((s): s is string => !!s))]] as const)
  );
  const all = [...new Set([...wanted.values()].flat())];
  const images = all.length ? await visibleImagesForParts(all) : new Map<string, PartDocument[]>();
  const cache = new Map<string, string | null>();
  const out = new Map<string, string[]>();
  for (const [sheet, skus] of wanted) {
    const urls: string[] = [];
    for (const sku of skus) {
      if (urls.length >= CUT_SHEET_PHOTOS_MAX) break;
      const doc = images.get(sku)?.[0];
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

/** Headless Chrome has no session, so the print route inlines images (≤ 1600 px WebP since #283). */
async function dataUrlOf(doc: PartDocument): Promise<string | null> {
  try {
    if (!doc.blobKey) return null;
    const stream = await getBlobStream(doc.blobKey);
    if (!stream) return null;
    const bytes = Buffer.from(await new Response(stream).arrayBuffer());
    return `data:${doc.contentType || "image/webp"};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
