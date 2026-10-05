import type { Calibration } from "@/lib/annotations";
import type { GridPlacement, GridRoute, GridSpace } from "@/lib/stores/grid-projects";
import type { PartLite } from "./grid-bom";
import { symbolLook, type SymbolContext, type SymbolEntry } from "./grid-icons";
import { optionSlice, type GridOption } from "./grid-options";
import { riserGraph, type RiserGroup } from "./grid-riser";
import { buildRiserView, type RiserDoc, type RiserView } from "./grid-riser-doc";
import type { SymbolMode } from "./grid-symbol-display";
import type { ObjectSymbolUrls } from "./object-symbols";

/**
 * One option's riser, ready to draw (#209): the derived graph (riserGraph,
 * D112) + the saved riser document + each device row's stock-symbol look
 * (the same symbolLook the plan uses). Shared by the riser editor page, the
 * drawing set's E-501 and the schedule's wire runs. Pure.
 *
 * #300: in Object mode a row carries its part's riser drawing (the server-
 * built `symbolUrls` map — riser drawing, else plan drawing) and every row
 * is the taller Object-mode row (nodeRowHeight).
 */
export type RiserProjectLite = {
  placements?: GridPlacement[];
  routes?: GridRoute[];
  spaces?: GridSpace[];
  calibrations?: Calibration[];
  options?: GridOption[];
  quoteId?: string | null;
  createdAt?: number;
  riser?: Record<string, RiserDoc>;
};

export function riserViewForOption(input: {
  project: RiserProjectLite;
  optionId: string;
  parts: PartLite[];
  symCtx: SymbolContext;
  /** #300: the design's symbol mode (Generic when absent). */
  symbolMode?: SymbolMode;
  /** #300: partId → drawing URLs (symbolUrlsFor), used only in Object mode. */
  symbolUrls?: Record<string, ObjectSymbolUrls>;
}): RiserView {
  const { project, optionId, parts, symCtx, symbolMode, symbolUrls } = input;
  const slice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
  const graph = riserGraph(slice.placements, slice.routes, spaces, parts, project.calibrations || []);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const entryOf = (g: RiserGroup): SymbolEntry => partById.get(g.partId) || { category: g.category, shape: g.shape };
  return buildRiserView({
    graph,
    spaces,
    placements: slice.placements,
    routes: slice.routes,
    doc: project.riser?.[optionId],
    look: (g) => {
      const l = symbolLook(entryOf(g), symCtx);
      return { iconId: l.iconId, color: l.color };
    },
    partDesc: (id) => partById.get(id)?.desc || id,
    partCode: (id) => partById.get(id)?.sku || id,
    symbolMode,
    riserHref: (id) => (symbolUrls && Object.hasOwn(symbolUrls, id) ? symbolUrls[id].riser : undefined),
  });
}
