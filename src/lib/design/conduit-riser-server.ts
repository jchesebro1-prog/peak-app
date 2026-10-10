// SERVER ONLY — reads the catalog, settings, device types, fixtures and the
// riser settings blobs. Never import from a "use client" file.
import { designatorDigitsOf, getSettings, type AppSettingsData } from "@/lib/settings";
import type { GridPlacement, GridProject, GridRoute } from "@/lib/stores/grid-projects";
import { getMany as getCatalogParts, getManyBySku, type CatalogPart } from "@/lib/stores/catalog";
import { listGridSymbols, type GridSymbol } from "@/lib/stores/grid-catalog";
import { getDocRows } from "@/db/doc-store";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { resolveWireTypes, type WireType } from "@/lib/catalog-connect";
import { hasOption, optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { getDeviceTypes, getTypeMap, loadDeviceTypeContext } from "@/lib/stores/device-types";
import { getFixture } from "@/lib/stores/fixtures";
import { fixtureLineParts } from "@/lib/fixture-assemblies";
import { parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { getRiserBoxTypes } from "@/lib/stores/riser-box-types";
import { getConduitSizes } from "@/lib/stores/conduit-sizes";
import { placementQty, routeLengthFt, type PartLite } from "@/lib/design/grid-bom";
import { conduitRiserSheetNumber, drawingArea, placementSystem, resolveSheetSize, routeSystem, type SheetSizeKey } from "@/lib/design/grid-drawing-set";
import { getProject } from "@/lib/stores/grid-projects";
import { attachmentDisposition } from "@/lib/document-files";
import { safeName } from "@/lib/blob";
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
import { effectivePricing, type ConduitSize } from "@/lib/design/conduit-riser/pricing";
import { layoutDetail, type DetailLayout } from "@/lib/design/conduit-riser/layout";
import { geometryToDxf } from "@/lib/design/conduit-riser/dxf";
import { composeSheets, detailGeometry, type SheetPage } from "@/lib/design/conduit-riser/drawing";

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

/** Every part id the project's riser can read: devices, wires and RiserLinks
 *  across all options (curtains never reach the riser). */
function riserPartIds(project: GridProject): string[] {
  const ids = new Set<string>();
  for (const pl of project.placements || []) if (!pl.curtain && pl.partId) ids.add(pl.partId);
  for (const r of project.routes || []) if (r.partId) ids.add(r.partId);
  for (const doc of Object.values(project.riser || {})) for (const l of normalizeRiserDoc(doc).links) if (l.partId) ids.add(l.partId);
  return [...ids];
}

/**
 * Only the parts this project names (#321 final review): their Grid-library
 * docs by id, the catalog rows behind them (and behind each symbol's pricing
 * part), and the virtual Auto parts — never the whole book. Read-only: the
 * stored type map is read as is, so a click never writes the type-map blob.
 * Modelled on `designatorContext`; the same `gridPartsFrom` builds each part,
 * so a device or wire reads exactly as it does from the full catalog.
 */
async function scopedRiserParts(
  project: GridProject,
  settings: AppSettingsData,
  deviceTypesIn: DeviceTypeContext | undefined
): Promise<{ parts: PartLite[]; deviceTypes: DeviceTypeContext }> {
  const ids = riserPartIds(project);
  const virtualIds = ids.filter((id) => parseVirtualPartId(id));
  const realIds = ids.filter((id) => !parseVirtualPartId(id) && !isSeedPlaceholder(id));
  const [types, map, symbolRows, virtual] = await Promise.all([
    deviceTypesIn ? Promise.resolve(deviceTypesIn.types) : getDeviceTypes(),
    deviceTypesIn ? Promise.resolve(deviceTypesIn.map) : getTypeMap(),
    realIds.length ? getDocRows<GridSymbol>("grid_catalog", realIds) : Promise.resolve([]),
    virtualIds.length ? loadVirtualParts(virtualIds) : Promise.resolve([]),
  ]);
  const symbols = symbolRows.filter((r) => !r.deleted).map((r) => r.doc);
  const pricingIds = [...new Set([...realIds, ...symbols.flatMap((s) => (s.pricingPartId ? [s.pricingPartId] : []))])];
  const catalog = pricingIds.length ? await getCatalogParts(pricingIds) : [];
  const deviceTypes = { types, map };
  return {
    parts: [...gridPartsFrom(symbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }), ...virtual],
    deviceTypes,
  };
}

/** Parts (catalog, Grid library, virtual), device types, digits, wire types
 *  and rack contents — the drawing-set-data parts, plus racks. With
 *  `deps.catalog` (a page that already loaded the book) it builds from that;
 *  otherwise only the parts this project names are read (scoped mode). */
export async function loadRiserPartsContext(project: GridProject, deps: ConduitRiserDeps = {}): Promise<RiserPartsContext & { settings: AppSettingsData }> {
  const settings = deps.settings ?? (await getSettings());
  let parts: PartLite[];
  let deviceTypes: DeviceTypeContext;
  const full = deps.catalog;
  if (full) {
    const gridSymbols = deps.gridSymbols ?? (await listGridSymbols());
    deviceTypes = deps.deviceTypes ?? (await loadDeviceTypeContext(full));
    parts = [
      ...gridPartsFrom(gridSymbols, full, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
      ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), full)),
    ];
  } else {
    ({ parts, deviceTypes } = await scopedRiserParts(project, settings, deps.deviceTypes));
  }
  const partById = new Map(parts.map((p) => [p.id, p]));
  // A rack is an `asm:` part whose fixture record is kind "rack" (#296) —
  // one fixture read per distinct assembly placed.
  const asmIds = [...new Set((project.placements || []).filter((pl) => !pl.curtain).map((pl) => pl.partId))].filter(
    (id) => parseVirtualPartId(id)?.kind === "assembly"
  );
  const rackFixtures = (
    await Promise.all(
      asmIds.map(async (partId) => {
        const ref = parseVirtualPartId(partId);
        const f = ref?.kind === "assembly" ? await getFixture(ref.id) : null;
        return f && f.kind === "rack" ? { partId, lines: fixtureLineParts(f).filter(({ slot, line }) => slot === "rack" && line.qty > 0).map(({ line }) => line) } : null;
      })
    )
  ).filter((x): x is NonNullable<typeof x> => !!x);
  // Each rack line's description: the catalog row behind its SKU — only the
  // member SKUs in scoped mode.
  const memberSkus = [...new Set(rackFixtures.flatMap((r) => r.lines.map((l) => l.sku)).filter(Boolean))];
  const bySku: ReadonlyMap<string, CatalogPart> = full
    ? new Map(full.map((p) => [p.sku, p]))
    : memberSkus.length
      ? await getManyBySku(memberSkus)
      : new Map();
  const racks = new Map<string, { desc: string; qty: number }[]>();
  for (const { partId, lines } of rackFixtures) {
    const items = new Map<string, number>();
    for (const line of lines) {
      const desc = bySku.get(line.sku)?.desc || line.label || line.sku;
      items.set(desc, (items.get(desc) || 0) + line.qty);
    }
    racks.set(partId, [...items].map(([desc, qty]) => ({ desc, qty })));
  }
  return { partById, deviceTypes, digits: designatorDigitsOf(settings), wireTypes: resolveWireTypes(settings.wireTypes), racks, settings };
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

/**
 * The lighting control riser's printed pages (#321): every detail laid out,
 * packed with the tables and general notes into `area` inches. Nothing until
 * the riser has a conduit run. A caller that already laid the details out
 * (the riser page does, for its editor) passes `layouts` — one per
 * `view.details` entry, in order — so nothing is laid out twice.
 */
export function conduitRiserPagesOf(
  data: Pick<ConduitRiserData, "doc" | "view" | "tables">,
  area: { w: number; h: number },
  layouts?: readonly DetailLayout[]
): SheetPage[] {
  if (!data.doc.runs.length) return [];
  const details = data.view.details.map((v, i) => detailGeometry(layouts?.[i] ?? layoutDetail(v, data.doc), v));
  return composeSheets({ details, tables: data.tables, notes: data.doc.notes, area });
}

/**
 * E-502… for one option at one sheet size — the one computation the drawing
 * set's sheets and the DXF download both read, so the printed sheet and the
 * CAD file can't disagree. Skips the loader when there is no run.
 */
export async function conduitRiserSheetPages(project: GridProject, optionId: string, size: SheetSizeKey, deps: ConduitRiserDeps = {}): Promise<SheetPage[]> {
  if (!hasOption(project, optionId) || !liveConduitRiser(project, optionId).runs.length) return [];
  return conduitRiserPagesOf(await loadConduitRiser(project, optionId, deps), drawingArea(size));
}

const NO_STORE = "private, no-store";
const dxfMiss = (error: string) => Response.json({ error }, { status: 404, headers: { "cache-control": NO_STORE } });

/**
 * The DXF download behind `/api/grid/[id]/conduit-riser/dxf` (#321) — one
 * lighting control riser sheet (E-502, E-503…) as a CAD file. `option` resolves
 * like the set, `size` (b|d) like the set (else the saved size), `page` is
 * 1-based. The geometry is the drawing set's own page, so the printed sheet and
 * the file can't disagree; no title block. The route authenticates first.
 */
export async function conduitRiserDxfResponse(id: string, query: URLSearchParams): Promise<Response> {
  try {
    let projectId: string;
    try {
      projectId = decodeURIComponent(id);
    } catch {
      return dxfMiss("Design not found."); // a malformed escape is just an unknown design
    }
    const project = await getProject(projectId);
    if (!project) return dxfMiss("Design not found.");
    const optionId = resolveOptionId(project, query.get("option"));
    const size = resolveSheetSize(query.get("size"), project.drawingSet?.size);
    const pages = await conduitRiserSheetPages(project, optionId, size);
    if (!pages.length) return dxfMiss("This design has no lighting control riser yet — add a conduit run first.");
    const n = Number(query.get("page") ?? "1");
    if (!Number.isInteger(n) || n < 1 || n > pages.length) return dxfMiss("That riser sheet doesn't exist.");
    const page = pages[n - 1];
    const name = `${safeName(project.name || project.id)}-${conduitRiserSheetNumber(n - 1)}-lighting-control-riser.dxf`;
    return new Response(geometryToDxf(page.geo, page), {
      headers: {
        "content-type": "application/dxf",
        "content-disposition": attachmentDisposition(name),
        "cache-control": NO_STORE,
      },
    });
  } catch (e) {
    console.error("[grid] conduit riser DXF failed", e);
    return new Response("The DXF couldn't be built.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": NO_STORE } });
  }
}

export type RiserPrompt =
  | { show: false }
  | {
      show: true;
      key: string;
      label: string;
      joins: boolean;
      /** The pair's wire would be listed "by others" — its effective wire
       *  pricing (the run's override ?? the doc default; a new run takes the
       *  default) is off. Never on an estimate-owned option. */
      byOthers: boolean;
    };

/**
 * The plan's "Add to the lighting control riser?" (#321): shown only when
 * the engine offers a suggestion that includes this route — so an audio
 * pair, a loose wire, a wire already in a run and a dismissed pair say
 * nothing. `label` names the ends in the direction the wire was drawn;
 * `joins` means the pair already has a run, so Add extends it; `byOthers`
 * says its wire won't be priced.
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
  const run = s.kind === "join" ? data.doc.runs.find((r) => r.id === s.runId) : undefined;
  const byOthers = !data.estimateOwned && !(run ? effectivePricing(run, data.doc.defaults).wire : data.doc.defaults.priceWire);
  return { show: true, key: s.key, label: `${from} → ${to}`, joins: s.kind === "join", byOthers };
}
