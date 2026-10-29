/**
 * Estimator handoff — curtain cut sheets from the browser store: the browser port of
 * src/lib/curtain-cut-sheets/load.ts (loadCutSheets). The collector and the sheet model are imported
 * (collect.ts collectCurtainTypes, model.ts cutSheetModel); the reads become:
 *
 *   stores/quotes get(id)                   → quoteRepo(store).get
 *   track-series listTrackSeries()          → blob `track_series` (sanitizeTrackSeriesBlob)
 *   curtain-mounts listCurtainMounts()      → blob `curtain_mount_hardware` (sanitizeCurtainMounts)
 *   settings getSettings()                  → ports.settingsView
 *   stores/customers get(customerId)        → ports.customers.resolve
 *   grid-projects getProject()              → null: the Grid is not in the prototype (a Grid quote's sheets
 *                                             collect without its project, as when the project is gone)
 *   catalog getMany / fabricPartsByCategory → the store's catalog (fabric parts; renames followed)
 *   catalog getManyBySku (hardware info)    → the store's catalog
 *   photos (part documents)                 → none until Task 11 packages photos (a sheet prints without them)
 *
 * Plan: PR 2 Task 5.
 */
import { partModel } from "@/lib/catalog-rename/sku";
import { isFabricPart, SOFT_GOODS_CATEGORY } from "@/lib/fabric-part";
import { CURTAIN_MOUNTS_BLOB, sanitizeCurtainMounts } from "@/lib/curtain-mounts";
import { sanitizeTrackSeriesBlob, TRACK_SERIES_BLOB } from "@/lib/track-series";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { collectCurtainTypes, type CollectInput, type CollectResult } from "@/lib/curtain-cut-sheets/collect";
import { curtainFabricLookups } from "@/lib/curtain-cut-sheets/estimator-curtains";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE, cutSheetModel, isCutSheetQuoteType, submittalSheetIndexes, type CutSheetModel, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { Quote } from "@/lib/stores/quotes";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
import type { HandoffStore } from "../store";
import { blobData, customers, refreshPortsFromStore, settingsView } from "../ports";
import { quoteRepo } from "../quote-repo";
import { bySkuResolver, liveCatalog, type LivePart } from "../readers";

export type LocalCutSheets = { ok: true; quote: Quote; result: CollectResult; models: Record<CutSheetStyle, CutSheetModel[]>; photos: Map<string, string[]> };

/**
 * load.ts cutSheetFabricRows over the store's rows: the fabric parts the curtains name by sku (renames
 * followed, listed under the sku asked for — #304's underRequestedSkus), and the fabric categories only
 * when a line must be matched by its printed fabric NAME.
 */
export function cutSheetFabricRowsLocal(need: ReturnType<typeof curtainFabricLookups>, rows: readonly LivePart[], renames: ReadonlyMap<string, string>): CatalogPart[] {
  const resolve = bySkuResolver(rows, renames);
  const bySku: CatalogPart[] = [];
  for (const sku of need.skus) {
    const p = resolve(sku);
    if (p && isFabricPart(p)) bySku.push(p.sku === sku ? p : { ...p, sku });
  }
  const found = new Set(bySku.map((p) => p.sku));
  if (!need.byName && need.byNameIfMissing.every((s) => found.has(s))) return bySku;
  const all = rows.filter((p) => (p.category === "Fabric" || p.category === SOFT_GOODS_CATEGORY) && isFabricPart(p));
  const have = new Set(all.map((p) => p.sku));
  return [...all, ...bySku.filter((p) => !have.has(p.sku))];
}

/** loadCutSheets(quoteId, { images: "url" }) over the store. */
export async function loadCutSheetsLocal(store: HandoffStore, quoteId: string | null | undefined): Promise<LocalCutSheets | { ok: false; error: string }> {
  await refreshPortsFromStore(store);
  const quote = quoteId ? await quoteRepo(store).get(quoteId) : null;
  if (!quote) return { ok: false, error: CUT_SHEETS_NO_QUOTE };
  if (!isCutSheetQuoteType(quote.quoteType)) return { ok: false, error: CUT_SHEETS_WRONG_TYPE };
  const rows = await liveCatalog(store);
  const resolve = bySkuResolver(rows, store.catalogRenames);
  const settings = settingsView();
  const base: CollectInput = {
    quote,
    fabrics: cutSheetFabricRowsLocal(curtainFabricLookups(quote.spec, null, quote.id), rows, store.catalogRenames).map((p) => ({
      sku: p.sku,
      desc: p.desc,
      oz: p.oz,
      ozBasis: p.ozBasis,
      boltWidthIn: p.boltWidthIn,
      flameRating: p.flameRating,
    })),
    trackSeries: sanitizeTrackSeriesBlob(blobData(TRACK_SERIES_BLOB)),
    mounts: sanitizeCurtainMounts(blobData(CURTAIN_MOUNTS_BLOB)),
    partInfo: new Map(),
    grid: null,
  };
  // Pass 1 names the hardware SKUs; their live desc/unit from the catalog; pass 2 prints them.
  const first = collectCurtainTypes(base);
  const skus = [...new Set(first.types.flatMap((t) => t.hardware.map((h) => h.sku)))];
  const partInfo = new Map<string, { desc: string; unit: string; model?: string }>();
  for (const sku of skus) {
    const p = resolve(sku);
    if (p) partInfo.set(sku, { desc: p.desc, unit: p.unit || "ea", model: partModel(p) });
  }
  const result = skus.length ? collectCurtainTypes({ ...base, partInfo }) : first;
  const doc = quoteDocumentDataFor(quote, customers.resolve(quote.customerId), settings);
  const now = Date.now();
  // #369: a curved type's layout sheet takes the next number, so the set's total counts it
  const { starts, total } = submittalSheetIndexes(result.types);
  const ctx = (style: CutSheetStyle, index: number) => ({
    style,
    quote: { id: quote.id, number: doc.quoteId, name: quote.name || "", customer: doc.custName, venue: doc.venueLabel, revisions: quote.revisions },
    company: { name: settings.companyName, logoDark: (settings.logoDark as string | null | undefined) ?? null, offices: settings.offices },
    preparedBy: doc.preparedByName,
    index,
    total, // the Submittal set's total; the Client style has no title block, so it never prints it
    now,
  });
  const models: Record<CutSheetStyle, CutSheetModel[]> = {
    submittal: result.types.map((t, i) => cutSheetModel(t, ctx("submittal", starts[i]))),
    client: result.types.map((t, i) => cutSheetModel(t, ctx("client", i + 1))),
  };
  return { ok: true, quote, result, models, photos: new Map() };
}

/**
 * The print route's cut-sheet appendix (src/app/print/quote/[id]/page.tsx): the Client-style sheets printed
 * after the estimate — only when the saved quote's PDF options ask for them (and never on a box goods sale, whose
 * whole PDF is the BOM layout — `bomLayout`)
 * (`normalizePdfOptions(q.pdfOptions).pdfCutSheets`) and they loaded; none on a failed load, an estimate
 * with no curtains, or the option off. Pure.
 */
export function cutSheetAppendixModels(loaded: LocalCutSheets | { ok: false; error: string } | null | undefined): CutSheetModel[] {
  if (!loaded || !loaded.ok || boxSaleOf(loaded.quote) || !normalizePdfOptions(loaded.quote.pdfOptions).pdfCutSheets) return [];
  return loaded.models.client;
}
