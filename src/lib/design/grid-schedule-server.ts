/**
 * The Grid — one option's equipment schedule, built server-side (#299). The
 * schedule page and the editor's Spreadsheet view both call this, so the two
 * show the same sections and wire runs from the same inputs: the Grid-library
 * PartLite rows with the catalog fallback, the placed virtual parts (#211),
 * the option's riser view (routes + typed RiserLinks, #209) and the one pure
 * buildSchedule. Server-only (it reads stores); the editor receives the
 * result as a prop.
 *
 * `equip` is optional: a caller that already loaded the Equipment map price
 * context over this same catalog (the editor page) passes it, and the virtual
 * parts resolve from it instead of a second identical load — the same rows
 * loadVirtualParts(ids, catalog) would build.
 */

import type { CatalogPart } from "@/lib/stores/catalog";
import type { AppSettingsData } from "@/lib/settings";
import type { GridProject } from "@/lib/stores/grid-projects";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import type { DeviceTypeContext } from "@/lib/design/device-types";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { optionSlice } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { virtualPartsFor } from "@/lib/design/grid-virtual-parts";
import type { EquipmentMap, EquipPriceCtx } from "@/lib/design/equipment-map";
import { symbolContext } from "@/lib/design/grid-icons";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule, catalogForSchedule, scheduleModelOf, scheduleWiresFromView, type ScheduleData } from "@/lib/design/grid-schedule";

export async function scheduleForOption(
  project: GridProject,
  optionId: string,
  deps: {
    catalog: CatalogPart[];
    gridSymbols: GridSymbol[];
    settings: AppSettingsData;
    deviceTypes: DeviceTypeContext;
    equip?: { map: EquipmentMap; ctx: EquipPriceCtx };
  }
): Promise<ScheduleData> {
  const { catalog, gridSymbols, settings, deviceTypes, equip } = deps;
  const placedIds = (project.placements || []).map((pl) => pl.partId);
  const slice = optionSlice(project, optionId);
  // Only the parts this option places or routes can be looked up by id (a
  // curtain's fabric and the riser document's typed links too), so the
  // catalog fallback is built over that slice, not every catalog row.
  const needed = [
    ...slice.placements.flatMap((pl) => (pl.curtain ? [pl.partId, pl.curtain.fabricSku] : [pl.partId])),
    ...slice.routes.map((r) => r.partId),
    ...(project.riser?.[optionId]?.links || []).map((l) => l.partId),
  ];
  const parts = [
    ...gridPartsFrom(gridSymbols, catalogForSchedule(catalog, gridSymbols, needed), resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
    ...(equip ? virtualPartsFor(placedIds, equip.map, equip.ctx) : await loadVirtualParts(placedIds, catalog)),
  ];
  const partById = new Map(parts.map((p) => [p.id, p]));
  const spaces = project.spaces || [];
  const view = riserViewForOption({ project, optionId, parts, symCtx: symbolContext(settings, deviceTypes.types) });
  return buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    modelOf: (pid) => scheduleModelOf(partById.get(pid)),
    wires: scheduleWiresFromView(view),
  });
}
