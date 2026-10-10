// SERVER ONLY — reads the catalog, settings, device types, fixtures and the
// riser settings blobs. Never import from a "use client" file.
import { designatorDigitsOf, getSettings, type AppSettingsData } from "@/lib/settings";
import type { GridPlacement, GridProject, GridRoute } from "@/lib/stores/grid-projects";
import { list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { listGridSymbols, type GridSymbol } from "@/lib/stores/grid-catalog";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { resolveWireTypes, type WireType } from "@/lib/catalog-connect";
import { hasOption, optionSlice } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { getFixture } from "@/lib/stores/fixtures";
import { fixtureLineParts } from "@/lib/fixture-assemblies";
import { parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { getRiserBoxTypes } from "@/lib/stores/riser-box-types";
import { getConduitSizes } from "@/lib/stores/conduit-sizes";
import { placementQty, routeLengthFt, type PartLite } from "@/lib/design/grid-bom";
import { placementSystem, routeSystem } from "@/lib/design/grid-drawing-set";
import { spaceOf } from "@/lib/design/grid-geometry";
import { levelOfPlacement } from "@/lib/design/grid-levels";
import { normalizeRiserDoc } from "@/lib/design/grid-riser-doc";
import { designatorCodeOf, fillDesignators, formatDesignator, readingCtxOf } from "@/lib/design/designators";
import { partModel } from "@/lib/catalog-rename/sku";
import type { DeviceTypeContext } from "@/lib/design/device-types";
import type { CRBoxType, CRDevice, CRLevel, CRSignal, CRWire, CRWireType } from "@/lib/design/conduit-riser/input";
import type { ConduitRiserDoc } from "@/lib/design/conduit-riser/model";
import { liveConduitRiser } from "@/lib/design/conduit-riser/live";
import { deriveView, type CRView, type DeriveInput } from "@/lib/design/conduit-riser/derive";
import { suggestions, type SuggestResult } from "@/lib/design/conduit-riser/suggest";
import { riserTables, type TableModel } from "@/lib/design/conduit-riser/tables";
import { effectiveTag } from "@/lib/design/conduit-riser/tags";
import type { ConduitSize } from "@/lib/design/conduit-riser/pricing";

/**
 * The conduit riser's server loader (#321). Turns a Grid project's option
 * into the engine's plain input — devices, wires, levels, wire types — and
 * runs the engine once, so the riser page, the plan prompt, pricing and the
 * drawing set all read one thing. Devices and wires are derived from the
 * plan on every load (the D112 rule); the stored document is normalized and
 * pruned against the live plan before anything reads it.
 */

/** Anything the caller already loaded — skipped here instead of re-read. */
export type ConduitRiserDeps = {
  catalog?: CatalogPart[];
  gridSymbols?: GridSymbol[];
  settings?: AppSettingsData;
  deviceTypes?: DeviceTypeContext;
  boxTypes?: CRBoxType[];
  sizes?: ConduitSize[];
};

/** What turning plan records into riser input needs. */
export type RiserPartsContext = {
  partById: ReadonlyMap<string, PartLite>;
  deviceTypes: DeviceTypeContext;
  digits: 1 | 2;
  wireTypes: readonly WireType[];
  /** Rack assembly part id (`asm:<id>`) → its contents grouped by part. */
  racks: ReadonlyMap<string, { desc: string; qty: number }[]>;
};

export const RACK_TYPE_KEY = "racks-cases";

/** Parts (catalog, Grid library, virtual), device types, digits, wire types
 *  and rack contents — the drawing-set-data parts, plus racks. */
export async function loadRiserPartsContext(
  project: GridProject,
  deps: ConduitRiserDeps = {}
): Promise<RiserPartsContext & { settings: AppSettingsData; catalog: CatalogPart[] }> {
  const [catalog, gridSymbols, settings] = await Promise.all([
    deps.catalog ?? listCatalog(),
    deps.gridSymbols ?? listGridSymbols(),
    deps.settings ?? getSettings(),
  ]);
  const deviceTypes = deps.deviceTypes ?? (await loadDeviceTypeContext(catalog));
  const parts = [
    ...gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
    ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), catalog)),
  ];
  const partById = new Map(parts.map((p) => [p.id, p]));
  // A rack is an `asm:` part whose fixture record is kind "rack" (#296) —
  // one fixture read per distinct assembly placed.
  const asmIds = [...new Set((project.placements || []).filter((pl) => !pl.curtain).map((pl) => pl.partId))].filter(
    (id) => parseVirtualPartId(id)?.kind === "assembly"
  );
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const racks = new Map<string, { desc: string; qty: number }[]>();
  await Promise.all(
    asmIds.map(async (partId) => {
      const ref = parseVirtualPartId(partId);
      const f = ref?.kind === "assembly" ? await getFixture(ref.id) : null;
      if (!f || f.kind !== "rack") return;
      const items = new Map<string, number>();
      for (const { slot, line } of fixtureLineParts(f)) {
        if (slot !== "rack" || !(line.qty > 0)) continue;
        const desc = bySku.get(line.sku)?.desc || line.label || line.sku;
        items.set(desc, (items.get(desc) || 0) + line.qty);
      }
      racks.set(partId, [...items].map(([desc, qty]) => ({ desc, qty })));
    })
  );
  return { partById, deviceTypes, digits: designatorDigitsOf(settings), wireTypes: resolveWireTypes(settings.wireTypes), racks, settings, catalog };
}

/** Wire types the riser can print a bubble for (a non-empty symbol). */
export function riserWireTypes(wireTypes: readonly WireType[]): CRWireType[] {
  return wireTypes
    .filter((t) => (t.symbol || "").trim())
    .map((t) => ({ id: t.id, label: t.label, symbol: t.symbol!.trim(), signal: (t.signal || "").trim() || t.label }));
}

/**
 * A cable's signal: the wire type whose `cableSku` is this part (its SKU,
 * its Grid-library pricing part or one of its former SKUs), else the first
 * wire type carrying the wire's `connectionType`. Only a type with a symbol
 * counts — anything else prints "?".
 */
export function signalOf(partId: string, part: PartLite | undefined, connectionType: string | undefined, wireTypes: readonly WireType[]): CRSignal | null {
  const skus = new Set([partId, part?.sku, part?.pricingPartId, ...(part?.formerSkus || [])].filter((s): s is string => !!s));
  const type =
    wireTypes.find((t) => !!t.cableSku && skus.has(t.cableSku.trim())) ||
    (connectionType ? wireTypes.find((t) => t.connectionTypes.includes(connectionType)) : undefined);
  const symbol = (type?.symbol || "").trim();
  return type && symbol ? { wireTypeId: type.id, symbol, signal: (type.signal || "").trim() || type.label } : null;
}

const modelOf = (part: PartLite | undefined) => (part && !part.virtual ? partModel(part) : "");

/** Every non-curtain device of the option, as the riser sees it. */
export function riserDevices(project: GridProject, optionId: string, ctx: RiserPartsContext): CRDevice[] {
  const spaces = project.spaces || [];
  const raw = optionSlice(project, optionId).placements.filter((pl) => !pl.curtain);
  const filled = fillDesignators(raw, designatorCodeOf(ctx.partById, ctx.deviceTypes), readingCtxOf(project, ctx.digits));
  return filled.map((pl) => {
    const part = ctx.partById.get(pl.partId);
    const space = spaceOf(pl, spaces);
    const rack = ctx.racks.get(pl.partId);
    const desc = part?.desc || pl.partId;
    return {
      id: pl.id,
      label: formatDesignator(pl.designator, placementQty(pl), ctx.digits) || desc,
      desc,
      model: modelOf(part),
      typeKey: rack ? RACK_TYPE_KEY : part && !part.virtual ? part.deviceType ?? null : null,
      inSystem: placementSystem(pl, ctx.partById) === "lighting",
      spaceId: space?.id ?? null,
      spaceName: space?.name ?? "",
      levelId: levelOfPlacement(pl, (x) => spaceOf(x, spaces), project),
      tag: effectiveTag(pl.tag, part?.tagDefaults, space?.name ?? ""),
      ...(rack ? { rack: { items: rack } } : {}),
    };
  });
}

/** Every plan wire of the option, plus its RiserLinks between two devices. */
export function riserWires(project: GridProject, optionId: string, ctx: RiserPartsContext): CRWire[] {
  const slice = optionSlice(project, optionId);
  const placementById = new Map<string, GridPlacement>(slice.placements.map((pl) => [pl.id, pl]));
  const cals = project.calibrations || [];
  const cable = (partId: string) => {
    const part = ctx.partById.get(partId);
    return modelOf(part) || part?.desc || partId;
  };
  const wires: CRWire[] = slice.routes.map((r: GridRoute) => ({
    id: r.id,
    kind: "route" as const,
    ...(r.fromPlacementId ? { from: r.fromPlacementId } : {}),
    ...(r.toPlacementId ? { to: r.toPlacementId } : {}),
    partId: r.partId,
    cable: cable(r.partId),
    signal: signalOf(r.partId, ctx.partById.get(r.partId), r.connectionType, ctx.wireTypes),
    lengthFt: routeLengthFt(r, cals),
    inSystem: routeSystem(r, placementById, ctx.partById) === "lighting",
  }));
  const lit = (id: string) => {
    const pl = placementById.get(id);
    return !!pl && placementSystem(pl, ctx.partById) === "lighting";
  };
  for (const l of normalizeRiserDoc(project.riser?.[optionId]).links) {
    if (l.from.kind !== "placement" || l.to.kind !== "placement") continue;
    const from = l.from.placementId;
    const to = l.to.placementId;
    wires.push({
      id: l.id,
      kind: "link",
      from,
      to,
      partId: l.partId,
      cable: cable(l.partId),
      signal: signalOf(l.partId, ctx.partById.get(l.partId), undefined, ctx.wireTypes),
      lengthFt: l.lengthFt,
      inSystem: lit(from) || lit(to),
    });
  }
  return wires;
}

export type ConduitRiserData = {
  doc: ConduitRiserDoc;
  input: DeriveInput;
  view: CRView;
  suggestions: SuggestResult;
  tables: TableModel[];
  boxTypes: CRBoxType[];
  sizes: ConduitSize[];
  wireTypes: CRWireType[];
  estimateOwned: boolean;
  /** The option's non-curtain device ids — what an op's ends may name. */
  placementIds: Set<string>;
};

export async function loadConduitRiser(project: GridProject, optionId: string, deps: ConduitRiserDeps = {}): Promise<ConduitRiserData> {
  const [ctx, boxTypes, sizes] = await Promise.all([
    loadRiserPartsContext(project, deps),
    deps.boxTypes ?? getRiserBoxTypes(),
    deps.sizes ?? getConduitSizes(),
  ]);
  const doc = liveConduitRiser(project, optionId);
  const devices = riserDevices(project, optionId, ctx);
  const wires = riserWires(project, optionId, ctx);
  const levels: CRLevel[] = (project.levels || []).map((l) => ({ id: l.id, label: l.label, ...(l.elevation ? { elevation: l.elevation } : {}), order: l.order }));
  const wireTypes = riserWireTypes(ctx.wireTypes);
  const input: DeriveInput = { doc, devices, wires, levels, wireTypes };
  const view = deriveView(input);
  const option = (project.options || []).find((o) => o.id === optionId);
  return {
    doc,
    input,
    view,
    suggestions: suggestions(doc, wires),
    tables: riserTables({ view, doc, wireTypes, boxTypes }),
    boxTypes,
    sizes,
    wireTypes,
    estimateOwned: option?.estimateOwned === true,
    placementIds: new Set(devices.map((d) => d.id)),
  };
}

export type RiserPrompt = { show: false } | { show: true; key: string; label: string; joins: boolean };

/**
 * The plan's "Add to the lighting control riser?" (#321): shown only when
 * the engine offers a suggestion that includes this route — so an audio
 * pair, a loose wire, a wire already in a run and a dismissed pair say
 * nothing. `label` names the ends in the direction the wire was drawn;
 * `joins` means the pair already has a run, so Add extends it.
 */
export async function riserPromptFor(project: GridProject, optionId: string, routeId: string, deps: ConduitRiserDeps = {}): Promise<RiserPrompt> {
  const none: RiserPrompt = { show: false };
  if (!hasOption(project, optionId)) return none;
  const data = await loadConduitRiser(project, optionId, deps);
  const s = data.suggestions.items.find((x) => x.routeIds.includes(routeId));
  if (!s) return none;
  const wire = data.input.wires.find((w) => w.kind === "route" && w.id === routeId);
  const label = (id: string | undefined) => data.input.devices.find((d) => d.id === id)?.label || "";
  const from = label(wire?.from ?? s.a);
  const to = label(wire?.to ?? s.b);
  if (!from || !to) return none;
  return { show: true, key: s.key, label: `${from} → ${to}`, joins: s.kind === "join" };
}
