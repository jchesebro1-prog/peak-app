// SERVER ONLY — reads the catalog, settings, sheets and part documents.
import { designatorDigitsOf, getSettings } from "@/lib/settings";
import { listSheets, type GridProject, type GridSheet } from "@/lib/stores/grid-projects";
import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { legendRows, symbolContext, type SymbolEntry } from "@/lib/design/grid-icons";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule, paginateSchedule, scheduleGroups, scheduleModelOf, scheduleWiresFromView } from "@/lib/design/grid-schedule";
import { SHEET_SIZES, type SheetSizeKey, buildSheetList, drawingArea, planSheetGroups, resolveGeneralNotes, resolveSheetSize, revisionRows } from "@/lib/design/grid-drawing-set";
import { cleanSymbolDisplay } from "@/lib/design/grid-symbol-display";
import { symbolUrlsFor } from "@/lib/design/object-symbols-server";
import { partDocumentUrl, type ObjectSymbolUrls } from "@/lib/design/object-symbols";
import { designatorCodeOf, fillDesignators, readingCtxOf } from "@/lib/design/designators";
import { conduitRiserSheetPages } from "@/lib/design/conduit-riser-server";

/**
 * The drawing set's data (#209, #300), shared since #301 slice C (R8a) by
 * the signed-in set page and the signed /print/grid-set/[id] route. Every
 * asset URL the sheets draw comes from `assets`: the team page uses the
 * signed-in proxies; the print route uses per-asset signed URLs.
 */

/** Schedule rows per column; two columns per E-60x sheet (the whole sheet,
 *  type included, scales with the size, so this holds at 24×36 too). */
export const SCHEDULE_ROWS_PER_COLUMN = 30;

export type DrawingSetAssets = {
  sheet: (src: Pick<GridSheet, "id">) => string;
  doc: (docId: string) => string;
  /** #321: a lighting control riser sheet's DXF download (1-based page). The
   *  team page only — it prints a screen-only link under each E-502…; the
   *  signed print route has none. */
  conduitRiserDxf?: (q: { projectId: string; optionId: string; size: SheetSizeKey; page: number }) => string;
};

export const TEAM_DRAWING_SET_ASSETS: DrawingSetAssets = {
  // Every sheet streams through the authenticated proxy (#209 I6) — Blob and
  // in-database alike — so a sheet shared by several plan pages is one cached
  // download, never a data-URL inlined once per page.
  sheet: (src) => `/api/grid-sheets/${encodeURIComponent(src.id)}`,
  doc: partDocumentUrl,
  conduitRiserDxf: (q) =>
    `/api/grid/${encodeURIComponent(q.projectId)}/conduit-riser/dxf?option=${encodeURIComponent(q.optionId)}&size=${q.size}&page=${q.page}`,
};

const DOC_URL = /^\/api\/part-documents\/([^/?#]+)$/;

/** Re-point #300's drawing URLs (`/api/part-documents/<id>`) through `doc`.
 *  Anything else is dropped, so that marker draws the generic symbol. */
export function rehrefSymbolUrls(urls: Record<string, ObjectSymbolUrls>, doc: (docId: string) => string): Record<string, ObjectSymbolUrls> {
  const re = (u: string | undefined) => {
    const m = u ? DOC_URL.exec(u) : null;
    return m ? doc(decodeURIComponent(m[1])) : undefined;
  };
  const out: Record<string, ObjectSymbolUrls> = {};
  for (const [k, v] of Object.entries(urls)) {
    const plan = re(v.plan);
    const riser = re(v.riser);
    if (plan || riser) out[k] = { ...(plan ? { plan } : {}), ...(riser ? { riser } : {}) };
  }
  return out;
}

export async function loadDrawingSetData(
  project: GridProject,
  opts: { requestedOption?: string | null; requestedSize?: string | null; assets: DrawingSetAssets }
) {
  const requestedOption = opts.requestedOption ?? undefined;
  const requestedSize = opts.requestedSize ?? undefined;
  const optionId = resolveOptionId(project, requestedOption);
  const options = project.options!;
  const option = options.find((o) => o.id === optionId)!;
  const rawSlice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
  const cals = project.calibrations || [];

  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  // #226: device types — the scope fix and type-grouped legend labels.
  const deviceTypes = await loadDeviceTypeContext(catalog);
  const accent = settings.accent || "#b08d4a";
  const digits = designatorDigitsOf(settings);
  const symCtx = symbolContext(settings, deviceTypes.types);
  const parts = [
    ...gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
    ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), catalog)),
  ];
  const partById = new Map(parts.map((p) => [p.id, p]));
  // #320: plan marks, keys and E-60x read designators; one not yet assigned
  // prints the number the editor will give it (filled here, never written —
  // this also serves the signed print route).
  const slice = { ...rawSlice, placements: fillDesignators(rawSlice.placements, designatorCodeOf(partById, deviceTypes), readingCtxOf(project, digits)) };
  const set = project.drawingSet || {};
  const size = resolveSheetSize(requestedSize, set.size);
  const k = SHEET_SIZES[size].k;
  const area = drawingArea(size);
  // Print date for the title strip — a server-render-time clock read.
  const now = Date.now();

  // E-501 + E-60x
  const symbolDisplay = cleanSymbolDisplay(project.symbolDisplay);
  // #300 (D609): in Object mode, the drawing URLs of the parts this option
  // places (never the whole catalog fallback). A lookup failure prints the
  // generic symbols instead of failing the set. #301 slice C: re-pointed
  // through `assets.doc`.
  const symbolUrls =
    symbolDisplay.mode === "object"
      ? rehrefSymbolUrls(
          await symbolUrlsFor(
            [...new Set(slice.placements.filter((pl) => !pl.curtain).map((pl) => pl.partId))].flatMap((pid) => partById.get(pid) ?? []),
            deviceTypes.types
          ).catch((e: unknown) => {
            console.error("[grid set] object symbol lookup failed:", e);
            return {} as Record<string, ObjectSymbolUrls>;
          }),
          opts.assets.doc
        )
      : {};
  // E-501 follows the design's mode too (#300): the same map — riser drawing, else plan drawing.
  const view = riserViewForOption({ project, optionId, parts, symCtx, symbolMode: symbolDisplay.mode, symbolUrls });

  const schedule = buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    modelOf: (pid) => scheduleModelOf(partById.get(pid)),
    wires: scheduleWiresFromView(view),
    digits,
  });
  const schedulePages = paginateSchedule(scheduleGroups(schedule), SCHEDULE_ROWS_PER_COLUMN, 2);

  // The set
  const groups = planSheetGroups({ sheetOrder: project.sheetIds || [], placements: slice.placements, routes: slice.routes, partById });
  const sourceNames = Object.fromEntries(sheets.map((s) => [s.id, s.name]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  // E-502… (#321): the lighting control riser, once the option has a conduit
  // run — the same pages the DXF download writes.
  const conduitRiserPages = await conduitRiserSheetPages(project, optionId, size, { catalog, gridSymbols, settings, deviceTypes });
  const { all, included } = buildSheetList({
    planGroups: groups,
    sourceNames,
    schedulePages: schedulePages.length,
    conduitRiserPages: conduitRiserPages.length,
    excluded: set.excluded,
  });
  const revRows = revisionRows(project.revisions, set.revisionLabels);
  const notes = resolveGeneralNotes(set, settings.gridStandardNotes);
  const legend = legendRows(
    slice.placements
      .filter((pl) => !pl.curtain)
      .map((pl): SymbolEntry & { id?: string; desc?: string } => partById.get(pl.partId) || { category: pl.category || "", desc: pl.category || pl.partId, deviceType: null }),
    symCtx
  );

  // #223 — printed as the estimate number; the option still keys by id.
  const optionQuoteNo = option.quoteId ? (await quoteNumbersFor([option.quoteId])).get(option.quoteId) ?? option.quoteId : null;

  return {
    project, optionId, options, option, slice, spaces, cals, partById, symCtx, accent, set, size, k, area, now,
    symbolDisplay, symbolUrls, view, schedule, schedulePages, conduitRiserPages, sheetById, all, included, revRows, notes, legend, optionQuoteNo, digits,
    company: { name: settings.companyName, logoDark: settings.logoDark, offices: settings.offices },
    gridStandardNotes: settings.gridStandardNotes || "",
  };
}

export type DrawingSetData = Awaited<ReturnType<typeof loadDrawingSetData>>;
