"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  type Calibration,
  calibrationScale,
  clamp01,
  findCalibration,
  type MeasureUnit,
  type Point,
} from "@/lib/annotations";
import {
  bomBySpace,
  bomLines,
  bomTotals,
  curtainLines,
  curtainSpecOf,
  isPerLengthUnit,
  routeLines,
  type GridCurtain,
  type GridCurtainType,
  type PartLite,
  type BomLine,
} from "@/lib/design/grid-bom";
import {
  isLayerVisible,
  normalizeCategory,
  scopeLayerKey,
  scopeOfPart,
  typeLayerKey,
  type GridLayer,
} from "@/lib/design/grid-scopes";
import { legendRows, symbolLook, type SymbolContext, type SymbolEntry, type SymbolLook } from "@/lib/design/grid-icons";
import { curtainPriceEach, type FabricSell } from "@/lib/curtain-geom";
import { distToPolyline, spaceOf } from "@/lib/design/grid-geometry";
import { validateDeviceWire, type WireType } from "@/lib/catalog-connect";
import type { GridLaborLine } from "@/lib/design/wire-labor";
import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL } from "@/lib/grid-sheet-file";
import { optionSlice } from "@/lib/design/grid-options";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { riserLinksOf, type RiserDoc } from "@/lib/design/grid-riser-doc";
import type { QuickScopeInputs } from "@/app/(app)/design/quick/engine";
import type { ScopeTargets, ScopeTargetsByTier } from "@/lib/design/scope-targets";
import type { SellCard } from "@/lib/design/auto-estimate";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import type { GridOption, GridPlacement, GridRevision, GridRoute, GridSpace } from "@/lib/stores/grid-projects";
import {
  addRouteAction,
  addSpaceAction,
  calibrateAction,
  createDraftQuoteAction,
  deleteProjectAction,
  movePlacementAction,
  placeCurtainAction,
  placeDeviceAction,
  removePlacementAction,
  setPlacementCategoryAction,
  setSymbolLookAction,
  setVenueAction,
  linkLinesetDesignAction,
  createClientPackageAction,
} from "./actions";
import type { CustomerComboboxOption } from "@/components/customer-combobox";
import { DRAPERY_TYPE_KEY, typeKeyOfPart, typeLayerRows, UNMAPPED_TYPE, type DeviceType } from "@/lib/design/device-types";
import { customItemsOf } from "@/lib/design/grid-custom-items";
import { accessoriesOf, accessoryBomLines } from "@/lib/design/grid-accessories";
import { bomGroups, groupedBomLines, type BomGroupKey } from "@/lib/design/grid-bom-groups";
import { activeTool, fitZoom, TOOL_KEYS, ZOOM_MAX, ZOOM_MIN, type GridTool } from "@/lib/design/grid-tools";
import type { SysKey } from "@/app/(app)/design/quick/engine";

/**
 * The Grid editor's state, memos and handlers (#299 Task 2) — moved out of
 * editor.tsx unchanged so the docked workspace can be built on top of one
 * object. The JSX still lives in editor.tsx and reads everything from here.
 */

/** Device marker hit-test radius (normalized 0..1 x-units; the existing
 *  selection test below divides by aspect for y, keeping the on-screen
 *  target circular on tall pages) — same value the click-to-select test
 *  under `onDown` uses. Route-endpoint snapping (Task 4) uses a wider,
 *  ~1.5x radius: a waypoint should count as "on the device" even when it
 *  isn't pixel-perfect on the marker center. */
const DEVICE_HIT_RADIUS = 0.028;
const DEVICE_SNAP_RADIUS = DEVICE_HIT_RADIUS * 1.5;

/** Click-vs-drag threshold (punch #47), in SCREEN pixels rather than
 *  normalized units: the plan zooms, and a "did the hand move?" test that
 *  changes meaning with the zoom level would make a steady click write at one
 *  zoom and not another. Below this the gesture is a plain click and keeps its
 *  old toggle-select behavior: nothing is ever persisted. */
const DRAG_PX = 4;

/** Arrow-key nudge (punch #47) in normalized x-units; y divides by aspect so
 *  a nudge covers the same on-screen distance both ways. Shift = coarse. */
const NUDGE = 0.002;
const NUDGE_FAST = 0.01;

/** Coalesce key-repeat into one write, holding an arrow must not fire a
 *  server action per keystroke. */
const NUDGE_COMMIT_MS = 400;

/** An in-flight marker drag (punch #47). `off` is the grab offset (pointer to
 *  marker center) so the marker doesn't jump under the cursor; `cx/cy` are the
 *  screen-pixel origin for the DRAG_PX test; `toggleOff` remembers that the
 *  marker was already selected, so a click that never became a drag still
 *  deselects exactly as it did before. */
type MarkerDrag = {
  id: string;
  off: Point;
  cx: number;
  cy: number;
  at: Point;
  moved: boolean;
  toggleOff: boolean;
};

/** An optimistic position (punch #47): where the client put a device, plus
 *  the server position it replaces. Holding `base` is what makes the override
 *  self-expiring WITHOUT an effect, it applies only while the server copy
 *  still reads `base`, so the moment the refresh lands (or anything else, a
 *  revision restore included, moves that device) the entry goes inert on its
 *  own. Clearing it from an effect instead both races the refresh and trips
 *  the compiler's no-setState-in-effect rule. */
type MoveOverride = { at: Point; base: Point };

/** Placement (if any) on `placements` whose marker the point `p` snaps to,
 *  using the same box-tolerance shape as the existing hit-test. Scans
 *  in the same reversed order as the marker-select hit-test below (`onDown`)
 *  so overlapping devices prefer the topmost/most-recent placement. */
function snappedPlacement(
  p: Point,
  placements: GridPlacement[],
  aspect: number
): GridPlacement | null {
  return (
    [...placements]
      .reverse()
      .find(
        (pl) =>
          Math.abs(pl.x - p.x) < DEVICE_SNAP_RADIUS &&
          Math.abs(pl.y - p.y) < DEVICE_SNAP_RADIUS / (aspect || 1)
      ) || null
  );
}

export type SheetLite = { id: string; name: string; mime: string; dataUrl: string };
export type ProjectLite = {
  id: string;
  name: string;
  customer: string;
  /** #244 — the linked customer's id, for the header's customer control. */
  customerId: string | null;
  siteId: string | null;
  siteName: string;
  quoteId: string | null;
  options: GridOption[];
  placements: GridPlacement[];
  calibrations: Calibration[];
  spaces: GridSpace[];
  routes: GridRoute[];
  revisions: GridRevision[];
  scopeInputs: QuickScopeInputs | null;
  linesetDesignId: string | null;
  /** Riser documents per option (#209) — the sidebar BOM counts RiserLinks. */
  riser: Record<string, RiserDoc>;
};

type Pending =
  | { kind: "calibrate"; a: Point; b: Point }
  | { kind: "space"; points: Point[] }
  | null;

export type GridEditorProps = {
  project: ProjectLite;
  /** #223 — option quoteId → estimate number. */
  quoteNumbers: Record<string, string>;
  sheets: SheetLite[];
  parts: PartLite[];
  /** Catalog fabric rows with SELL price/sq ft (punch #49) - never cost. */
  fabrics: FabricSell[];
  /** Spec records design §6 — system match keys for the curtain dialog's
   *  optional Spec override (grid/[id]/page.tsx, systemMatchKeys). */
  specKeys: string[];
  /** Scope panel Good/Better/Best targets per scope (#211, D305) — SELL
   *  numbers computed server-side (grid/[id]/page.tsx); no cost crosses. */
  scopeTargets: ScopeTargetsByTier | null;
  /** Auto designs (#211): the chosen cards (sell-only) + their targets; null for Blank. */
  auto: { estimate: AutoEstimate; cards: SellCard[]; targets: ScopeTargets } | null;
  /** The customer's venues, for the picker (D113.6). */
  venues: Array<{ id: string; name: string }>;
  /** #244 — every customer (id, name, type), for linking or changing the design's customer. */
  customerOptions: CustomerComboboxOption[];
  /** Gates delete — a Reviewer approves designs but has never made one. */
  canCreate: boolean;
  /** Stock-symbol resolution context (spec 2026-09-25) — category icons,
   *  colours and the category map, resolved server-side by symbolContext(). */
  symbolCtx: SymbolContext;
  /** Resolved by page.tsx from ?option= — always a real option id. */
  activeOptionId: string;
  linesetDesigns: Array<{ id: string; name: string }>;
  /** Admin-edited wire-type registry (Design → Grid Settings), resolved
   *  server-side — resolveWireTypes(settings.wireTypes). Used for the
   *  client-side canConnect() pre-check only; addRouteAction re-derives the
   *  same registry server-side as the authority. */
  wireTypes: WireType[];
  /** #212: the active option's custom items, priced server-side (sell only). */
  customLines: BomLine[];
  /** #232: the active option's labor lines, computed server-side by buildGridQuote (sell only). */
  laborLines: GridLaborLine[];
  /** #226: the curated device types (palette chips, Layers). */
  deviceTypes: DeviceType[];
  /** #226: this user's starred parts and last-placed parts (newest first). */
  favorites: string[];
  recent: string[];
};

function useGridEditorImpl(props: GridEditorProps) {
  const {
    project,
    sheets,
    parts,
    fabrics,
    specKeys,
    scopeTargets,
    auto,
    venues,
    customerOptions,
    canCreate,
    quoteNumbers,
    symbolCtx,
    activeOptionId,
    linesetDesigns,
    wireTypes,
    customLines,
    laborLines,
    deviceTypes,
    favorites,
    recent,
  } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<string | null>(null);
  /** Punch #76 — lines the last successful draft/update quoted at plain list
   *  price because the part had no usable cost (or the resolved tier margin
   *  itself was out of range), even though this quote's pricingTier/tierMargin
   *  stamp implies every line got the tier treatment. Non-blocking, mirrors
   *  the Lineset Builder's fabric-unresolved banner (#64): names the lines,
   *  impossible to miss, never refuses the quote. Cleared on every new
   *  mint/update so a fixed catalog makes the warning go away on its own. */
  const [tierFallbackLines, setTierFallbackLines] = useState<string[]>([]);
  /** D322: the server refused the quote because Auto lines still need a
   *  part — the message, until the person confirms "Quote anyway" or leaves. */
  const [incompleteQuote, setIncompleteQuote] = useState<string | null>(null);
  /** Members of the ACTIVE option only (Spec 1). Every read below goes
   *  through this slice; the whole-project arrays are used only for the
   *  switcher's per-option counts. */
  const active = useMemo(() => optionSlice(project, activeOptionId), [project, activeOptionId]);
  const placements = active.placements;
  const routes = active.routes;
  const optionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of project.placements) m.set(pl.optionId || project.options[0].id, (m.get(pl.optionId || project.options[0].id) || 0) + 1);
    return m;
  }, [project.placements, project.options]);
  const activeOption = project.options.find((o) => o.id === activeOptionId) || project.options[0];
  const switchOption = useCallback(
    (id: string) => {
      setSelected(null);
      setTierFallbackLines([]);
      router.replace(`${pathname}?option=${encodeURIComponent(id)}`, { scroll: false });
    },
    [pathname, router]
  );
  // Two-step arm/confirm; this app doesn't use window.confirm.
  const [armDelete, setArmDelete] = useState(false);
  const [activeSheetId, setActiveSheetId] = useState(sheets[0]?.id || "");
  const sheet = sheets.find((s) => s.id === activeSheetId) || sheets[0];
  const isPdf = sheet?.mime === "application/pdf" || sheet?.name.toLowerCase().endsWith(".pdf");

  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [size, setSize] = useState({ w: 900, h: 1200 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The status bar's "Last action" (#299) — what the last successful edit
   *  did, in words. View state only; never persisted. */
  const [lastAction, setLastAction] = useState<string | null>(null);
  const noteAction = useCallback((text: string) => setLastAction(text), []);
  /** Plan view / Spreadsheet view under the canvas (#299). */
  const [view, setView] = useState<"plan" | "sheet">("plan");
  /** The Auto scope whose "Change equipment…" dialog is open — one state
   *  for the Scope panel's button and the toolbar's (#299). */
  const [refillScope, setRefillScope] = useState<SysKey | null>(null);
  const [linesetBusy, setLinesetBusy] = useState(false);
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageUrl, setPackageUrl] = useState<string | null>(null);
  const [packageGapCount, setPackageGapCount] = useState<number | null>(null);
  /* #292: curtains the cut sheets couldn't read (staff-only — never in the zip). */
  const [packageUnreadable, setPackageUnreadable] = useState<Array<{ where: string; desc: string; reason: string }>>([]);

  async function linkLineset(designId: string) {
    setLinesetBusy(true);
    const result = await linkLinesetDesignAction(project.id, designId || null);
    setLinesetBusy(false);
    if (!result.ok) setErr(result.error);
    else {
      noteAction(designId ? "Linked a lineset design" : "Unlinked the lineset design");
      router.refresh();
    }
  }

  async function buildClientPackage() {
    setPackageBusy(true);
    setPackageUrl(null);
    setPackageUnreadable([]);
    const result = await createClientPackageAction(project.id, activeOptionId);
    setPackageBusy(false);
    if (!result.ok) setErr(result.error);
    else {
      setPackageUrl(result.url);
      setPackageGapCount(result.gapCount);
      setPackageUnreadable(result.cutSheetsUnreadable);
      noteAction("Built the client package");
    }
  }

  const [armedPartId, setArmedPartId] = useState<string | null>(null);

  /** Hidden LAYERS (punch #48) - namespaced keys, scopes and user categories
   *  together (grid-scopes). View state, not design state: which layers one
   *  person has folded away is not a property of the drawing, so it is not
   *  persisted and never rides in a revision. */
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const hiddenSet = useMemo(() => new Set(hiddenLayers), [hiddenLayers]);
  const toggleLayer = useCallback((key: string) => {
    setHiddenLayers((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  // Curtain drop-in (punch #49): arm a type, click the plan, spec it there.
  const [armedCurtainType, setArmedCurtainType] = useState<GridCurtainType | null>(null);
  const [curtainAt, setCurtainAt] = useState<Point | null>(null);
  /** Inline category editor for the selected placement (null = closed). */
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null);

  // Repositioning (punch #47). Two pieces of local truth, both required:
  //  - `drag` is the live gesture (nothing has been written yet);
  //  - `movedLocal` is the OPTIMISTIC position of placements whose move has
  //    been sent but whose refresh hasn't landed. Without it the marker snaps
  //    back to its old spot the instant the pointer lifts: `project` is a
  //    server prop and `router.refresh()` is fire-and-forget, so there is a
  //    window where the action has committed and the props still say old.
  //    Each entry expires by itself (see MoveOverride).
  const [drag, setDrag] = useState<MarkerDrag | null>(null);
  const [movedLocal, setMovedLocal] = useState<Record<string, MoveOverride>>({});
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [calibrating, setCalibrating] = useState(false);
  const [calDraft, setCalDraft] = useState<Point[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [entry, setEntry] = useState("");
  const [calUnit, setCalUnit] = useState<MeasureUnit>("ft");

  // Space drawing (D109): vertices accumulate on click; closing the loop
  // (click near the first corner) opens the inline name entry.
  const [spaceDrawing, setSpaceDrawing] = useState(false);
  const [spaceDraft, setSpaceDraft] = useState<Point[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  // Wire routing (D110): waypoints accumulate; clicking the last one again
  // finishes the run (the part was picked up front, so no popover).
  const [wireDrawing, setWireDrawing] = useState(false);
  const [wireDraft, setWireDraft] = useState<Point[]>([]);
  const [wirePartId, setWirePartId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  /** Hand tool (#299): the H tool, or Space held over the plan
   *  (PlanCanvas tracks the key). Either way a pointerdown pans the plan's
   *  scroll box and never reaches the plan dispatcher (onDown). */
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const tool: GridTool = activeTool({ armedPartId, armedCurtainType, wireDrawing, spaceDrawing, calibrating, panning });

  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** The plan's scrolling box — Fit measures it, the hand tool scrolls it. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onLoaded = useCallback((n: number) => setPages(n), []);
  const onSize = useCallback((w: number, h: number) => setSize({ w, h }), []);

  /** Guarded: an image that reports no size yet must not poison the math
   *  with NaN — calibration would silently fail with a misleading error. */
  const aspect = size.w > 0 && size.h > 0 ? size.h / size.w : 1;
  const cal = sheet ? findCalibration(project.calibrations, sheet.id, page) : null;

  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  /** Every part's resolved badge (icon + colour), computed once per prop
   *  change — the plan re-renders on every drag step. */
  const lookById = useMemo(() => new Map(parts.map((p) => [p.id, symbolLook(p, symbolCtx)])), [parts, symbolCtx]);
  const lookOf = useCallback(
    (part: PartLite | null | undefined): SymbolLook => (part && lookById.get(part.id)) || symbolLook(part, symbolCtx),
    [lookById, symbolCtx]
  );
  /** How the status bar names a part / a placement: the part number (a
   *  virtual Auto part by its description, as the BOM does). */
  const partLabel = useCallback(
    (partId: string) => {
      const p = partById.get(partId);
      return p?.virtual ? p.desc : partId;
    },
    [partById]
  );
  const placementLabel = useCallback(
    (pl: GridPlacement) =>
      pl.curtain ? pl.curtain.name : isSeedPlaceholder(pl.partId) ? pl.category || "device" : partLabel(pl.partId),
    [partLabel]
  );
  /* ------------------------- scopes + layers (#48) ------------------------- */

  /** The scope one placement belongs to. A curtain IS the Curtains scope by
   *  construction (#49); everything else resolves through the catalog
   *  taxonomy, so remapping a category in the Catalog re-buckets it here. */
  const scopeOfPlacement = useCallback(
    (pl: GridPlacement): GridLayer =>
      pl.curtain ? "Curtains" : scopeOfPart(partById.get(pl.partId)),
    [partById]
  );
  /** #226: the device-type layer a placement belongs to — a curtain drop-in
   *  is Drapery by construction, the way its scope is Curtains. */
  const typeKeyOfPlacement = useCallback(
    (pl: GridPlacement): string => (pl.curtain ? DRAPERY_TYPE_KEY : typeKeyOfPart(partById.get(pl.partId))),
    [partById]
  );

  const placementVisible = useCallback(
    (pl: GridPlacement) =>
      isLayerVisible(scopeOfPlacement(pl), normalizeCategory(pl.category), hiddenSet, typeKeyOfPlacement(pl)),
    [scopeOfPlacement, hiddenSet, typeKeyOfPlacement]
  );

  /** Whole-project counts for the layer list - a scope you can't see on this
   *  page is still a scope in this design. */
  const scopeCounts = useMemo(() => {
    const m = new Map<GridLayer, number>();
    for (const pl of placements) {
      const s = scopeOfPlacement(pl);
      m.set(s, (m.get(s) || 0) + 1);
    }
    for (const r of routes || []) {
      const s = scopeOfPart(partById.get(r.partId));
      m.set(s, (m.get(s) || 0) + 1);
    }
    return m;
  }, [placements, routes, scopeOfPlacement, partById]);
  /** #226: Layers groups each scope's items by device type (Unmapped last;
   *  an unmapped item's raw/seeded category rides along as a sub-label, never
   *  as a layer of its own). Same items as scopeCounts, so the numbers agree. */
  const typeRows = useMemo(() => {
    const items: Array<{ scope: GridLayer; typeKey: string; sub: string | null }> = [];
    for (const pl of placements) {
      const typeKey = typeKeyOfPlacement(pl);
      const part = partById.get(pl.partId);
      items.push({ scope: scopeOfPlacement(pl), typeKey, sub: typeKey === UNMAPPED_TYPE ? part?.category ?? pl.category ?? null : null });
    }
    for (const r of routes || []) {
      const part = partById.get(r.partId);
      const typeKey = typeKeyOfPart(part);
      items.push({ scope: scopeOfPart(part), typeKey, sub: typeKey === UNMAPPED_TYPE ? part?.category ?? null : null });
    }
    return typeLayerRows(items, deviceTypes);
  }, [placements, routes, partById, scopeOfPlacement, typeKeyOfPlacement, deviceTypes]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of placements) {
      const c = normalizeCategory(pl.category);
      if (c) m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [placements]);

  /** Per-placement displacement from what the server currently says (punch
   *  #47): the live drag plus any committed-but-unrefreshed move. One map
   *  drives BOTH the markers and the attached wire endpoints, so the picture
   *  on screen mid-gesture is exactly what the store will write. */
  const placementOffsets = useMemo(() => {
    const m = new Map<string, { dx: number; dy: number }>();
    const put = (id: string, at: Point) => {
      const base = placements.find((q) => q.id === id);
      if (!base) return;
      const dx = at.x - base.x;
      const dy = at.y - base.y;
      if (dx !== 0 || dy !== 0) m.set(id, { dx, dy });
      else m.delete(id);
    };
    for (const [id, o] of Object.entries(movedLocal)) {
      const server = placements.find((q) => q.id === id);
      // Spent: the refresh landed, or that device moved some other way.
      if (!server || server.x !== o.base.x || server.y !== o.base.y) continue;
      put(id, o.at);
    }
    if (drag && drag.moved) put(drag.id, drag.at); // the live gesture wins
    return m;
  }, [placements, movedLocal, drag]);

  const sheetPlacements = useMemo(() => {
    const base = placements.filter((pl) => pl.sheetId === sheet?.id && pl.page === page);
    if (!placementOffsets.size) return base;
    return base.map((pl) => {
      const d = placementOffsets.get(pl.id);
      return d ? { ...pl, x: clamp01(pl.x + d.dx), y: clamp01(pl.y + d.dy) } : pl;
    });
  }, [placements, sheet?.id, page, placementOffsets]);
  /**
   * What the canvas may show, hit-test, select and drag (punch #48). Every
   * gesture on the plan reads THIS list, never `sheetPlacements`: a hidden
   * marker that could still be grabbed by a stray click would be worse than
   * no layers at all, and drag-to-move (punch #47) makes that a real risk.
   */
  const visiblePlacements = useMemo(
    () => sheetPlacements.filter(placementVisible),
    [sheetPlacements, placementVisible]
  );
  /** Plan legend rows (stock symbols): one per icon+colour on this sheet.
   *  Curtains draw their own drape glyph, not a badge, so they're left out.
   *  Deduped by part id (or, for a seeded-but-unassigned placement with no
   *  part, by category) before handing entries to legendRows — a plan
   *  repeats the same fixture dozens of times, and legendRows only needs to
   *  see each distinct entry once (final fix wave). */
  const planLegendRows = useMemo(() => {
    const distinct = new Map<string, SymbolEntry & { desc?: string | null }>();
    for (const pl of visiblePlacements) {
      if (pl.curtain) continue;
      const part = partById.get(pl.partId);
      const key = part ? `id:${part.id}` : `cat:${pl.category ?? ""}`;
      if (!distinct.has(key)) distinct.set(key, part ?? { category: pl.category, deviceType: null });
    }
    return legendRows([...distinct.values()], symbolCtx);
  }, [visiblePlacements, partById, symbolCtx]);
  const pageSpaces = useMemo(
    () => (project.spaces || []).filter((s) => s.sheetId === sheet?.id && s.page === page),
    [project.spaces, sheet?.id, page]
  );

  const pageRoutes = useMemo(() => {
    const base = (routes || []).filter((r) => r.sheetId === sheet?.id && r.page === page);
    if (!placementOffsets.size) return base;
    // Mirror of movePlacement()'s endpoint translation, so a wire follows its
    // device while the pointer is still down instead of visibly detaching and
    // snapping back a beat later. The store is the authority; this is the
    // same arithmetic on the same delta.
    return base.map((r) => {
      const head = r.fromPlacementId ? placementOffsets.get(r.fromPlacementId) : undefined;
      const tail = r.toPlacementId ? placementOffsets.get(r.toPlacementId) : undefined;
      if (!head && !tail) return r;
      const last = r.points.length - 1;
      return {
        ...r,
        points: r.points.map((q, i) => {
          const d = head && i === 0 ? head : tail && i === last ? tail : null;
          return d ? { x: clamp01(q.x + d.dx), y: clamp01(q.y + d.dy) } : q;
        }),
      };
    });
  }, [routes, sheet?.id, page, placementOffsets]);
  /** A wire run belongs to its part's scope, and hides with it (#48). Routes
   *  carry no user category - only a placed item can be labelled. */
  const visibleRoutes = useMemo(
    () =>
      pageRoutes.filter((r) => {
        const part = partById.get(r.partId);
        const s = scopeOfPart(part);
        return !hiddenSet.has(scopeLayerKey(s)) && !hiddenSet.has(typeLayerKey(s, typeKeyOfPart(part)));
      }),
    [pageRoutes, hiddenSet, partById]
  );
  const wireParts = useMemo(() => parts.filter((p) => isPerLengthUnit(p.unit)), [parts]);

  const lines = useMemo(() => bomLines(placements, parts), [placements, parts]);
  const totals = useMemo(() => bomTotals(placements, parts), [placements, parts]);
  const riserLinks = useMemo(() => riserLinksOf(project.riser, activeOptionId), [project.riser, activeOptionId]);
  const wires = useMemo(
    () => routeLines(routes || [], parts, project.calibrations, riserLinks),
    [routes, parts, project.calibrations, riserLinks]
  );

  /* ------------------------------ curtains (#49) ------------------------------ */

  const fabricBySku = useMemo(() => new Map(fabrics.map((f) => [f.sku, f])), [fabrics]);
  const fabricNames = useMemo(
    () => new Map(fabrics.map((f) => [f.sku, f.name])),
    [fabrics]
  );
  /** Sell price per dropped curtain, from customer-safe sell numbers. The
   *  server recomputes this authoritatively at quote time from the cost basis
   *  it alone holds; the two match to the cent (see lib/curtain-geom). */
  const curtainPrices = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of placements) {
      if (!pl.curtain) continue;
      const fabric = fabricBySku.get(pl.curtain.fabricSku);
      m.set(
        pl.id,
        curtainPriceEach(curtainSpecOf(pl.curtain), fabric?.pricePerSqft || 0)
      );
    }
    return m;
  }, [placements, fabricBySku]);
  const curtains = useMemo(
    () => curtainLines(placements, curtainPrices, fabricNames),
    [placements, curtainPrices, fabricNames]
  );
  const curtainValue = curtains.reduce((a, l) => a + l.ext, 0);

  // #232: one labor line per BOM heading, computed on the server exactly as
  // the quote prices it (buildGridQuote); a typed $ override is saved on the
  // option. Printed last under its heading and counted in that heading's total.
  const laborValue = laborLines.reduce((a, l) => a + l.amount, 0);

  /** Create / update the option's draft quote. D322: the server refuses
   *  an Auto design with needs-a-part lines until the person confirms. */
  const runQuote = async (acceptIncomplete: boolean) => {
    setErr(null);
    setTierFallbackLines([]);
    setBusy(true);
    const r = await createDraftQuoteAction(project.id, activeOptionId, { acceptIncomplete });
    setBusy(false);
    if (!r.ok) {
      if (r.needsPart && !acceptIncomplete) setIncompleteQuote(r.error);
      else setErr(r.error);
    } else {
      setIncompleteQuote(null);
      setTierFallbackLines(r.fallbackLines);
      noteAction(activeOption.quoteId ? "Updated the draft quote" : "Created a draft quote");
      router.refresh();
    }
  };

  // #212: per-design custom items — edited from the BOM, priced like allowances.
  const customItems = useMemo(() => customItemsOf(activeOption.customItems), [activeOption.customItems]);
  const customValue = customLines.reduce((a, l) => a + l.ext, 0);
  // #230: BOM accessories — option-scoped, priced from the SAME `parts` rows
  // as a placed device of that partId (the quote re-prices both at tier).
  const accessories = useMemo(() => accessoriesOf(activeOption.accessories), [activeOption.accessories]);
  const accessoryLines = useMemo(() => accessoryBomLines(accessories, parts), [accessories, parts]);
  const accessoryValue = accessoryLines.reduce((a, l) => a + l.ext, 0);
  const bomEmpty =
    lines.length === 0 && wires.lines.length === 0 && curtains.length === 0 && customLines.length === 0 && accessoryLines.length === 0;
  const grandValue = totals.value + wires.value + laborValue + curtainValue + customValue + accessoryValue;
  /** #230: the BOM under its seven headings. */
  const bomGroupList = useMemo(
    () =>
      bomGroups(
        groupedBomLines({
          devices: lines,
          wires: wires.lines,
          curtains,
          custom: customLines,
          customItems,
          accessories: accessoryLines,
          parts,
          placements,
          labor: laborLines,
        })
      ),
    [lines, wires.lines, curtains, customLines, customItems, accessoryLines, parts, placements, laborLines]
  );
  /** The heading whose accessory picker is open — per option, so switching options closes it. */
  const [addingTo, setAddingTo] = useState<{ optionId: string; group: BomGroupKey } | null>(null);
  const pickerOpenFor = addingTo && addingTo.optionId === activeOptionId ? addingTo.group : null;
  const spaceRollups = useMemo(
    () => bomBySpace(placements, parts, project.spaces || [], curtainPrices),
    [placements, parts, project.spaces, curtainPrices]
  );
  /** Whole-project placed $/count by scope (#211, D305) — feeds
   *  the Scope panel's "placed" column. Reuses bomBySpace with an EMPTY
   *  spaces array: every placement falls into the single "Unassigned"
   *  bucket bomBySpace already produces for placements outside any space,
   *  which is exactly the whole-project total with no spaces filtering it
   *  out. Cheap: same inputs spaceRollups already recomputes on, one more
   *  pass. */
  const projectScopeRollup = useMemo(
    () => bomBySpace(placements, parts, [], curtainPrices)[0] ?? null,
    [placements, parts, curtainPrices]
  );

  const armedPart = armedPartId ? partById.get(armedPartId) : null;
  /** Selection follows visibility (#48): hiding a layer must not leave a
   *  selected-but-invisible device wired to the arrow-key nudge and the
   *  Remove button. Derived rather than cleared from an effect, so it can't
   *  race a refresh. */
  const selectedPlacement =
    placements.find((pl) => pl.id === selected && placementVisible(pl)) || null;
  /** The catalog entry behind the selected device (curtains and seed
   *  placeholders have none) — what the Symbol select edits (#131). */
  const selectedPart =
    selectedPlacement && !selectedPlacement.curtain ? partById.get(selectedPlacement.partId) ?? null : null;
  /** Where a placement is being SHOWN right now (optimistic ⟶ server). */
  const shownAt = useCallback(
    (pl: GridPlacement): Point => {
      const d = placementOffsets.get(pl.id);
      return d ? { x: clamp01(pl.x + d.dx), y: clamp01(pl.y + d.dy) } : { x: pl.x, y: pl.y };
    },
    [placementOffsets]
  );

  /** Write a reposition (punch #47), shared by the drag and the arrow-key
   *  nudge. The optimistic entry goes in FIRST and is rolled back only if the
   *  server refuses, so the marker never flickers back to where it was. */
  const commitMove = useCallback(
    (placementId: string, at: Point) => {
      const server = placements.find((q) => q.id === placementId);
      if (!server) return;
      setMovedLocal((prev) => ({
        ...prev,
        [placementId]: { at, base: { x: server.x, y: server.y } },
      }));
      setErr(null);
      setBusy(true);
      movePlacementAction(project.id, { placementId, x: at.x, y: at.y }).then((r) => {
        setBusy(false);
        if (!r.ok) {
          // Refused: drop the optimistic position so the marker returns to
          // where the design actually has it, next to the error.
          setErr(r.error);
          setMovedLocal((prev) => {
            if (!(placementId in prev)) return prev;
            const next = { ...prev };
            delete next[placementId];
            return next;
          });
          return;
        }
        noteAction(`Moved ${placementLabel(server)}`);
        router.refresh();
      });
    },
    [project.id, placements, router, noteAction, placementLabel]
  );

  // Arrow-key nudge for the selected device (punch #47). Bound to the window
  // because the plan is a div with no focus of its own; every text field in
  // this editor (calibration/space entry, palette search, labor amounts) would
  // otherwise lose its arrow keys, hence the editable-target bail-out. Inert
  // while any drawing mode owns the canvas.
  useEffect(() => {
    if (!selectedPlacement) return;
    if (pending || curtainAt || calDraft || drag || spaceDrawing || wireDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog (e.g. the IconPicker) that already handled this key — or
      // any element opted out with data-no-nudge — owns the arrow keys;
      // don't also move the selected plan device underneath it.
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (t?.closest('[role="dialog"], [data-no-nudge]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? NUDGE_FAST : NUDGE;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      if (!dx && !dy) return;
      e.preventDefault(); // don't scroll the plan out from under the device
      const from = shownAt(selectedPlacement);
      const at = { x: clamp01(from.x + dx), y: clamp01(from.y + dy / (aspect || 1)) };
      // Paint every keystroke; write once the key-repeat settles.
      setMovedLocal((prev) => ({
        ...prev,
        [selectedPlacement.id]: { at, base: { x: selectedPlacement.x, y: selectedPlacement.y } },
      }));
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => {
        nudgeTimer.current = null;
        commitMove(selectedPlacement.id, at);
      }, NUDGE_COMMIT_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedPlacement,
    shownAt,
    commitMove,
    aspect,
    pending,
    curtainAt,
    calDraft,
    drag,
    spaceDrawing,
    wireDrawing,
  ]);

  // A pending nudge must not outlive the editor.
  useEffect(() => () => {
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
  }, []);

  /** Null when the wrapper has no measurable size (sheet still loading, or
   *  the window is hidden): fabricating (0,0) instead would drop devices and
   *  space corners at the top-left, so callers must bail on null. */
  function toNorm(e: { clientX: number; clientY: number }): Point | null {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  /** Where the pointer is over the plan, in plan coords (null off-plan) —
   *  for paste, which reads it on demand. A ref, not state: pointermove
   *  fires constantly and nothing renders the point, so updating it must
   *  never re-render the editor. */
  const cursorAtRef = useRef<Point | null>(null);
  const clearCursorAt = useCallback(() => {
    cursorAtRef.current = null;
  }, []);

  /** Zoom so the whole sheet fits the plan box. `size` is the PDF canvas's
   *  rendered pixels but an image's natural pixels (the <img> draws at
   *  900 px × zoom), so the rendered size is derived per kind. */
  const fit = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const rendered = isPdf ? size : { w: Math.round(900 * zoom), h: Math.round(900 * zoom) * aspect };
    // clientWidth/Height include the box's own padding (18px a side today) —
    // subtract what is actually there, so Fit never leaves a scrollbar.
    const cs = window.getComputedStyle(box);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    setZoom(fitZoom({ w: box.clientWidth - padX, h: box.clientHeight - padY }, rendered, zoom));
  }, [isPdf, size, zoom, aspect]);

  // Auto-fit once per sheet (#299): the first time a sheet's size is known
  // after it becomes active — so a design opens fitted, not at 125 %. `size`
  // still holds the previous sheet's (or the default) value when the sheet
  // changes, so "known" means "changed since this sheet became active".
  const fittedSheets = useRef(new Set<string>());
  const sizeAtSheet = useRef<{ id: string; size: { w: number; h: number } } | null>(null);
  const sheetKey = sheet?.id;
  useEffect(() => {
    if (!sheetKey || fittedSheets.current.has(sheetKey)) return;
    if (sizeAtSheet.current?.id !== sheetKey) {
      sizeAtSheet.current = { id: sheetKey, size };
      return;
    }
    if (sizeAtSheet.current.size === size) return;
    fittedSheets.current.add(sheetKey);
    fit();
  }, [sheetKey, size, fit]);

  /**
   * Post the sheet to /api/grid-sheets/upload (#146, D173) rather than through
   * a server action. The action took the file as a base64 data-URL, which
   * next.config.ts's 1200kb `serverActions.bodySizeLimit` cut down to a ~900 kB
   * real ceiling while the code advertised 8 MB — and an over-limit body was
   * rejected by Next before the action ran, so the user saw an unhandled
   * rejection instead of a sentence telling them what to do. Route handlers
   * carry no such cap, and raw multipart bytes skip base64's 4/3 inflation
   * entirely.
   *
   * The response carries only the new sheet id: the stored blob path stays
   * server-side, so nothing here can name a file for the sheet proxy to read.
   */
  async function upload(file: File) {
    setErr(null);
    if (file.size > GRID_SHEET_MAX_BYTES) {
      // Refuse before the upload so an oversize file costs no uplink time. The
      // route re-checks: this is the courtesy, not the enforcement.
      setErr(
        `That file is larger than ${GRID_SHEET_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`
      );
      return;
    }
    const body = new FormData();
    body.append("projectId", project.id);
    body.append("name", file.name);
    body.append("file", file);
    setBusy(true);
    type UploadReply = { ok?: boolean; sheetId?: string; error?: string };
    let r: UploadReply | null = null;
    try {
      const res = await fetch("/api/grid-sheets/upload", { method: "POST", body });
      r = (await res.json()) as UploadReply;
    } catch {
      // A dropped connection or a non-JSON reply (a proxy's own 413 page) must
      // still say something useful rather than leaving the spinner up.
      r = null;
    }
    setBusy(false);
    if (!r?.ok || !r.sheetId) {
      setErr(r?.error || "That sheet could not be uploaded. Check your connection and try again.");
      return;
    }
    setActiveSheetId(r.sheetId);
    setPage(1);
    noteAction(`Uploaded ${file.name}`);
    router.refresh();
  }

  /** Drop one unit of a part at a plan point — the armed-part click and a
   *  palette drag-and-drop (#299) both land here. Places once; arms nothing. */
  function placeAt(partId: string, at: Point) {
    if (busy || pending || curtainAt || !sheet) return;
    setErr(null);
    setBusy(true);
    placeDeviceAction(project.id, {
      sheetId: sheet.id,
      page,
      x: at.x,
      y: at.y,
      partId,
      optionId: activeOptionId,
    }).then((r) => {
      setBusy(false);
      if (!r.ok) setErr(r.error);
      else {
        noteAction(`Placed ${partLabel(partId)}`);
        router.refresh();
      }
    });
  }

  function onDown(e: React.PointerEvent) {
    // The hand tool owns the gesture: PlanCanvas pans the scroll box (#299).
    if (tool === "pan" || spaceHeld) return;
    // The curtain dialog owns the canvas exactly like `pending` does (#49).
    if (busy || pending || curtainAt || !sheet) return;
    const p = toNorm(e);
    if (!p) return;

    if (calibrating) {
      setCalDraft([p, p]);
      return;
    }

    if (spaceDrawing) {
      // Clicking back on the first corner (with ≥3 laid down) closes the loop.
      const first = spaceDraft[0];
      const closes =
        first &&
        spaceDraft.length >= 3 &&
        Math.abs(first.x - p.x) < 0.015 &&
        Math.abs(first.y - p.y) < 0.015 / (aspect || 1);
      if (closes) {
        setSpaceDrawing(false);
        setEntry("");
        setPending({ kind: "space", points: spaceDraft });
        return;
      }
      setSpaceDraft((prev) => [...prev, p]);
      return;
    }

    if (wireDrawing) {
      // Clicking the last waypoint again (with ≥2 laid down) finishes the run.
      const last = wireDraft[wireDraft.length - 1];
      const finishes =
        last &&
        wireDraft.length >= 2 &&
        Math.abs(last.x - p.x) < 0.015 &&
        Math.abs(last.y - p.y) < 0.015 / (aspect || 1);
      if (finishes && wirePartId) {
        const points = wireDraft;
        setWireDrawing(false);
        setWireDraft([]);

        // Device-wire detection (Task 4, punch #39): a route counts as a
        // device wire only when BOTH its first and last waypoint snap onto
        // a placed device on this same sheet/page — free routes (either
        // end off a device) behave exactly as before.
        // Visible devices only: a wire must not snap onto a marker the
        // designer can't see (#48).
        const fromPlacement = snappedPlacement(points[0], visiblePlacements, aspect);
        const toPlacement = snappedPlacement(
          points[points.length - 1],
          visiblePlacements,
          aspect
        );
        let fromPlacementId: string | undefined;
        let toPlacementId: string | undefined;
        if (fromPlacement && toPlacement) {
          fromPlacementId = fromPlacement.id;
          toPlacementId = toPlacement.id;
          const fromPart = partById.get(fromPlacement.partId);
          const toPart = partById.get(toPlacement.partId);
          const bothHavePorts = Boolean(fromPart?.ports?.length && toPart?.ports?.length);
          if (bothHavePorts) {
            // Both devices declare ports — this pair is validated here for
            // immediate feedback, and the server (the authority) re-checks
            // the same thing against the live catalog before persisting. A
            // device missing ports never reaches this branch, so the
            // un-migrated catalog is never blocked (Task 4 binding behavior).
            const result = validateDeviceWire(fromPart!, toPart!, wireTypes);
            if (!result.ok) {
              setErr(`Wire refused — ${result.reason}: ${fromPlacement.partId} → ${toPlacement.partId} share no compatible port.`);
              return;
            }
          }
        }

        setErr(null);
        setBusy(true);
        addRouteAction(project.id, {
          sheetId: sheet.id,
          page,
          partId: wirePartId,
          points,
          aspect,
          optionId: activeOptionId,
          fromPlacementId,
          toPlacementId,
        }).then((r) => {
          setBusy(false);
          if (!r.ok) setErr(r.error);
          else {
            noteAction(`Drew a ${partLabel(wirePartId)} run`);
            router.refresh();
          }
        });
        return;
      }
      setWireDraft((prev) => [...prev, p]);
      return;
    }

    // Select an existing marker when the click lands on one, and arm a drag
    // (punch #47). Nothing is written here: this gesture only becomes a move
    // once the pointer travels DRAG_PX, so a plain click still just selects.
    // Same on-screen radius on both axes: y is a fraction of height, so the
    // x-tolerance divides by the aspect to stay circular on tall pages.
    // Hidden layers are not hit-testable (#48) - visible markers only.
    const hit = [...visiblePlacements]
      .reverse()
      .find(
        (pl) =>
          Math.abs(pl.x - p.x) < DEVICE_HIT_RADIUS &&
          Math.abs(pl.y - p.y) < DEVICE_HIT_RADIUS / (aspect || 1)
      );
    if (hit) {
      setSelected(hit.id);
      setCategoryDraft(null);
      setSelectedSpaceId(null);
      setSelectedRouteId(null);
      setDrag({
        id: hit.id,
        off: { x: hit.x - p.x, y: hit.y - p.y },
        cx: e.clientX,
        cy: e.clientY,
        at: { x: hit.x, y: hit.y },
        moved: false,
        toggleOff: hit.id === selected,
      });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    setSelected(null);
    setCategoryDraft(null);

    // Curtain drop-in (#49): the type was armed in the sidebar, so the click
    // just decides WHERE - the dialog gathers the five fields at that spot.
    if (armedCurtainType) {
      setCurtainAt(p);
      return;
    }

    if (armedPart) {
      placeAt(armedPart.id, p);
      return;
    }

    // Nothing armed: a wire is a finer target than a room, so routes first…
    const nearRoute = [...visibleRoutes]
      .reverse()
      .find((r) => distToPolyline(p, r.points, aspect) < 0.012);
    if (nearRoute) {
      setSelectedRouteId(nearRoute.id === selectedRouteId ? null : nearRoute.id);
      setSelectedSpaceId(null);
      return;
    }
    setSelectedRouteId(null);
    // …then clicking inside a room selects it (smallest wins).
    const room = spaceOf({ sheetId: sheet.id, page, x: p.x, y: p.y }, pageSpaces);
    setSelectedSpaceId(room ? room.id : null);
  }

  function onMove(e: React.PointerEvent) {
    cursorAtRef.current = toNorm(e);
    if (drag) {
      // Until the hand has travelled DRAG_PX this is still a click: leave the
      // marker exactly where it is so a shaky click can never nudge a device.
      if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < DRAG_PX) return;
      const p = toNorm(e);
      if (!p) return;
      const at = { x: clamp01(p.x + drag.off.x), y: clamp01(p.y + drag.off.y) };
      setDrag((prev) => (prev ? { ...prev, at, moved: true } : prev));
      return;
    }
    if (!calDraft) return;
    const p = toNorm(e);
    if (!p) return;
    setCalDraft((prev) => (prev ? [prev[0], p] : prev));
  }

  function onUp() {
    if (drag) {
      const d = drag;
      setDrag(null);
      // Never travelled: this was a click, so keep the old toggle-select.
      if (!d.moved) {
        if (d.toggleOff) setSelected(null);
        return;
      }
      commitMove(d.id, d.at);
      return;
    }
    if (!calDraft) return;
    const [a, b] = [calDraft[0], calDraft[calDraft.length - 1]];
    setCalDraft(null);
    setCalibrating(false);
    if (Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005) return;
    setEntry("");
    setPending({ kind: "calibrate", a, b });
  }

  /** Persist a placement's user-defined category (punch #48). "" clears it. */
  async function saveCategory(placementId: string, label: string) {
    setBusy(true);
    const r = await setPlacementCategoryAction(project.id, placementId, label);
    setBusy(false);
    setCategoryDraft(null);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(label.trim() ? `Set category ${label.trim()}` : "Cleared a category");
      router.refresh();
    }
  }

  /** Persist a catalog ENTRY's icon/colour override (#131 → stock symbols).
   *  Only the keys present change; "" clears that key. */
  async function saveSymbolLook(symbolId: string, patch: { icon?: string; color?: string }) {
    setBusy(true);
    const r = await setSymbolLookAction(project.id, symbolId, patch);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(`Changed the ${partLabel(symbolId)} symbol`);
      router.refresh();
    }
  }

  /** Persist a dropped curtain (punch #49). The server re-validates every
   *  field and prices the line from the cost basis it alone holds. */
  async function dropCurtain(curtain: GridCurtain) {
    if (!sheet || !curtainAt) return;
    setErr(null);
    setBusy(true);
    const r = await placeCurtainAction(project.id, {
      sheetId: sheet.id,
      page,
      x: curtainAt.x,
      y: curtainAt.y,
      curtain,
      optionId: activeOptionId,
    });
    setBusy(false);
    setCurtainAt(null);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(`Placed curtain ${curtain.name}`);
      router.refresh();
    }
  }

  async function confirmSpace() {
    if (!pending || pending.kind !== "space" || !sheet) return;
    const name = entry.trim();
    if (!name) {
      setErr("Name the space — 'Stage', 'House', 'Booth'…");
      return;
    }
    setBusy(true);
    const r = await addSpaceAction(project.id, {
      sheetId: sheet.id,
      page,
      name,
      points: pending.points,
    });
    setBusy(false);
    setPending(null);
    setSpaceDraft([]);
    setEntry("");
    if (!r.ok) setErr(r.error);
    else {
      noteAction(`Added space ${name}`);
      router.refresh();
    }
  }

  async function confirmCalibration() {
    if (!pending || pending.kind !== "calibrate" || !sheet) return;
    const real = Number(entry);
    const scale = calibrationScale(pending.a, pending.b, aspect, real);
    if (!scale) {
      setErr("Enter the real length of that line as a positive number.");
      return;
    }
    setBusy(true);
    const r = await calibrateAction(project.id, {
      sheetId: sheet.id,
      page,
      scale,
      unit: calUnit,
      refLength: real,
    });
    setBusy(false);
    setPending(null);
    setEntry("");
    if (!r.ok) setErr(r.error);
    else {
      noteAction(`Calibrated page ${page}`);
      router.refresh();
    }
  }

  /* ------------------------------ tool model (#299) ------------------------------ */

  /** One tool at a time (#299): every entry point clears every other mode. */
  const clearModes = useCallback(() => {
    setArmedPartId(null);
    setArmedCurtainType(null);
    setCurtainAt(null);
    setWireDrawing(false);
    setWireDraft([]);
    setSpaceDrawing(false);
    setSpaceDraft([]);
    setCalibrating(false);
    setCalDraft(null);
    setPending(null);
    setPanning(false);
  }, []);

  const enterTool = useCallback(
    (t: GridTool, opts?: { partId?: string; curtainType?: string }) => {
      clearModes();
      // A wire run needs its wire type picked up front (the finish click has
      // no popover), so without one the person stays in select.
      if (t === "wire" && !wirePartId) {
        setErr("Pick a wire type in the Wires tab first.");
        return;
      }
      // An unmeasured wire is a lie in a BOM — the Wires panel already
      // disables its button on an uncalibrated page; W and the toolbar agree.
      if (t === "wire" && !cal) {
        setErr("Calibrate this page before drawing wire.");
        return;
      }
      if (t !== "select" && t !== "pan") {
        setSelected(null);
        setSelectedSpaceId(null);
        setSelectedRouteId(null);
      }
      if (t === "place" && opts?.partId) setArmedPartId(opts.partId);
      if (t === "curtain" && opts?.curtainType) setArmedCurtainType(opts.curtainType as GridCurtainType);
      if (t === "wire") setWireDrawing(true);
      if (t === "space") setSpaceDrawing(true);
      if (t === "calibrate") setCalibrating(true);
      if (t === "pan") setPanning(true);
    },
    [clearModes, wirePartId, cal]
  );

  /** Back to select with nothing selected — what un-arming a palette part or
   *  a curtain type did before the tool model (both also dropped the
   *  selection). */
  const disarm = useCallback(() => {
    enterTool("select");
    setSelected(null);
    setSelectedSpaceId(null);
    setSelectedRouteId(null);
  }, [enterTool]);

  /** Zoom −/+ step 0.25 within [ZOOM_MIN, ZOOM_MAX], rounded to 2 decimals so
   *  a Fit value like 1.05 steps cleanly. */
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100)), []);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100)), []);

  /** #226: arming from the palette clears every other armed tool (#299: and
   *  every other mode — calibration, a pending entry, an open curtain drop). */
  const armPart = useCallback(
    (partId: string | null) => {
      if (partId) enterTool("place", { partId });
      else disarm();
    },
    [enterTool, disarm]
  );
  /** The palette's "that layer is hidden" warning — scope or type layer. */
  const partLayerHidden = useCallback(
    (p: PartLite) => {
      const s = scopeOfPart(p);
      return hiddenSet.has(scopeLayerKey(s)) || hiddenSet.has(typeLayerKey(s, typeKeyOfPart(p)));
    },
    [hiddenSet]
  );

  /* --------------------------- workspace shell (#299) --------------------------- */

  /** Drop every per-sheet/per-page gesture — what the old sheet <select> and
   *  page ‹ › buttons each did inline before switching. */
  const resetSheetState = useCallback(() => {
    setSelected(null);
    setPending(null);
    setSpaceDrawing(false);
    setSpaceDraft([]);
    setSelectedSpaceId(null);
    setWireDrawing(false);
    setWireDraft([]);
    setSelectedRouteId(null);
    setCurtainAt(null);
    setCategoryDraft(null);
  }, []);

  /** Sheet tabs: switch the visible sheet (was the header's sheet <select>). */
  const switchSheet = useCallback(
    (id: string) => {
      setActiveSheetId(id);
      setPage(1);
      resetSheetState();
    },
    [resetSheetState]
  );

  /** PDF page ‹ › (was the header's page buttons). */
  const goToPage = useCallback(
    (n: number) => {
      const next = Math.min(Math.max(1, n), pages);
      if (next === page) return;
      setPage(next);
      resetSheetState();
    },
    [page, pages, resetSheetState]
  );

  /** Zoom from the toolbar's % field — clamped, rounded to whole percent. */
  const applyZoom = useCallback((z: number) => {
    if (!Number.isFinite(z) || z <= 0) return;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100)));
  }, []);

  /** Venue picker (was the header's venue <select>) — stamped onto the quote. */
  async function setVenue(siteId: string) {
    setBusy(true);
    const r = await setVenueAction(project.id, siteId);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(siteId ? `Set venue ${venues.find((v) => v.id === siteId)?.name ?? ""}`.trim() : "Cleared the venue");
      router.refresh();
    }
  }

  /** Delete design, second step of the two-step arm/confirm. */
  async function deleteDesign() {
    setBusy(true);
    const r = await deleteProjectAction(project.id);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setArmDelete(false);
      return;
    }
    router.push("/design/designs");
  }

  /** Remove one placement — the selected-device Remove button, the toolbar
   *  Delete and the Delete/Backspace key all land here. */
  const removePlacement = useCallback(
    async (placementId: string) => {
      const target = placements.find((pl) => pl.id === placementId);
      setBusy(true);
      const r = await removePlacementAction(project.id, placementId);
      setBusy(false);
      setSelected(null);
      if (!r.ok) setErr(r.error);
      else {
        noteAction(`Removed ${target ? placementLabel(target) : "a device"}`);
        router.refresh();
      }
    },
    [placements, project.id, router, noteAction, placementLabel]
  );

  // Tool shortcuts (#299): V/P/W/S/H pick a tool, Escape drops back to
  // select with nothing selected, Delete/Backspace removes the selected
  // device. Same guards as the arrow-key nudge: never while typing, never
  // under a dialog or a data-no-nudge element, never with a modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (t?.closest('[role="dialog"], [data-no-nudge]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        disarm();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedPlacement || busy || drag) return;
        e.preventDefault();
        removePlacement(selectedPlacement.id);
        return;
      }
      if (e.repeat) return;
      const next = TOOL_KEYS[e.key.toLowerCase()];
      if (!next) return;
      if (next === "place") {
        // P re-enters Place only while a part is armed (pick one in the Library).
        if (armedPartId) enterTool("place", { partId: armedPartId });
        return;
      }
      if (!sheet && next !== "select") return;
      enterTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disarm, enterTool, removePlacement, selectedPlacement, busy, drag, armedPartId, sheet]);

  return {
    router,
    project,
    sheets,
    parts,
    fabrics,
    specKeys,
    scopeTargets,
    auto,
    venues,
    customerOptions,
    canCreate,
    quoteNumbers,
    symbolCtx,
    activeOptionId,
    linesetDesigns,
    wireTypes,
    customLines,
    laborLines,
    deviceTypes,
    favorites,
    recent,
    pathname,
    selected,
    setSelected,
    tierFallbackLines,
    setTierFallbackLines,
    incompleteQuote,
    setIncompleteQuote,
    active,
    placements,
    routes,
    optionCounts,
    activeOption,
    switchOption,
    armDelete,
    setArmDelete,
    activeSheetId,
    setActiveSheetId,
    sheet,
    isPdf,
    page,
    setPage,
    pages,
    setPages,
    zoom,
    setZoom,
    size,
    setSize,
    busy,
    setBusy,
    err,
    setErr,
    linesetBusy,
    setLinesetBusy,
    packageBusy,
    setPackageBusy,
    packageUrl,
    setPackageUrl,
    packageGapCount,
    setPackageGapCount,
    packageUnreadable,
    setPackageUnreadable,
    linkLineset,
    buildClientPackage,
    armedPartId,
    setArmedPartId,
    hiddenLayers,
    setHiddenLayers,
    hiddenSet,
    toggleLayer,
    armedCurtainType,
    setArmedCurtainType,
    curtainAt,
    setCurtainAt,
    categoryDraft,
    setCategoryDraft,
    drag,
    setDrag,
    movedLocal,
    setMovedLocal,
    calibrating,
    setCalibrating,
    calDraft,
    setCalDraft,
    pending,
    setPending,
    entry,
    setEntry,
    calUnit,
    setCalUnit,
    spaceDrawing,
    setSpaceDrawing,
    spaceDraft,
    setSpaceDraft,
    selectedSpaceId,
    setSelectedSpaceId,
    wireDrawing,
    setWireDrawing,
    wireDraft,
    setWireDraft,
    wirePartId,
    setWirePartId,
    selectedRouteId,
    setSelectedRouteId,
    wrapRef,
    fileRef,
    onLoaded,
    onSize,
    aspect,
    cal,
    partById,
    lookById,
    lookOf,
    scopeOfPlacement,
    typeKeyOfPlacement,
    placementVisible,
    scopeCounts,
    typeRows,
    categoryCounts,
    placementOffsets,
    sheetPlacements,
    visiblePlacements,
    planLegendRows,
    pageSpaces,
    pageRoutes,
    visibleRoutes,
    wireParts,
    lines,
    totals,
    riserLinks,
    wires,
    fabricBySku,
    fabricNames,
    curtainPrices,
    curtains,
    curtainValue,
    laborValue,
    runQuote,
    customItems,
    customValue,
    accessories,
    accessoryLines,
    accessoryValue,
    bomEmpty,
    grandValue,
    bomGroupList,
    addingTo,
    setAddingTo,
    pickerOpenFor,
    spaceRollups,
    projectScopeRollup,
    armedPart,
    selectedPlacement,
    selectedPart,
    shownAt,
    commitMove,
    toNorm,
    placeAt,
    cursorAtRef,
    clearCursorAt,
    scrollRef,
    fit,
    upload,
    onDown,
    onMove,
    onUp,
    saveCategory,
    saveSymbolLook,
    dropCurtain,
    confirmSpace,
    confirmCalibration,
    armPart,
    partLayerHidden,
    tool,
    enterTool,
    panning,
    setPanning,
    spaceHeld,
    setSpaceHeld,
    disarm,
    zoomIn,
    zoomOut,
    lastAction,
    noteAction,
    view,
    setView,
    refillScope,
    setRefillScope,
    switchSheet,
    goToPage,
    applyZoom,
    setVenue,
    deleteDesign,
    removePlacement,
  };
}

export type GridEditor = ReturnType<typeof useGridEditorImpl>;
export const useGridEditor = useGridEditorImpl;
