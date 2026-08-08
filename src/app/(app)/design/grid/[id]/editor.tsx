"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Calibration,
  calibrationScale,
  clamp01,
  findCalibration,
  formatMeasure,
  MEASURE_UNITS,
  type MeasureUnit,
  type Point,
} from "@/lib/annotations";
import {
  bomBySpace,
  bomLines,
  bomTotals,
  curtainDesc,
  curtainLines,
  curtainSpecOf,
  GRID_CURTAIN_TYPES,
  isPerLengthUnit,
  routeLengthFt,
  routeLines,
  type GridCurtain,
  type GridCurtainType,
  type PartLite,
} from "@/lib/design/grid-bom";
import {
  categoryLayerKey,
  GRID_LAYERS,
  isLayerVisible,
  normalizeCategory,
  SCOPE_COLORS,
  scopeLayerKey,
  scopeOfPart,
  type GridLayer,
} from "@/lib/design/grid-scopes";
import { curtainPriceEach, type FabricSell, type SellCoeffs } from "@/lib/curtain-geom";
import { distToPolyline, polygonCentroid, spaceOf } from "@/lib/design/grid-geometry";
import { validateDeviceWire } from "@/lib/catalog-connect";
import { suggestLabor, type LaborPartLite } from "@/lib/design/grid-labor";
import { PlanSvg } from "@/app/(app)/design/quick/plan-svg";
import { buildGridBaseSheetPlan } from "@/lib/design/grid-base-sheet";
import type { PackageGap } from "@/lib/design/client-package";
import { DEFAULT_VENUE_DIMS, type VenueDims } from "@/lib/design/venue-dims";
import type { GridPlacement, GridRevision, GridRoute, GridSpace } from "@/lib/stores/grid-projects";
import {
  addRouteAction,
  addSheetAction,
  addSpaceAction,
  calibrateAction,
  carryOverAction,
  clearCalAction,
  createDraftQuoteAction,
  generateClientPackageAction,
  movePlacementAction,
  placeCurtainAction,
  placeDeviceAction,
  removePlacementAction,
  seedStarterLayoutAction,
  setPlacementCategoryAction,
  setVenueAction,
} from "./actions";
import CurtainDrop from "./curtain-drop";
import LayersPanel from "./layers-panel";
import SpacesPanel from "./spaces-panel";
import RevisionsPanel from "./revisions-panel";
import WiresPanel from "./wires-panel";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * The Grid editor (D108) — device painting on plan sheets, in the markup
 * screen's idiom (D95/D96): document right, tools left, all geometry
 * normalized 0..1, inline entry instead of window.prompt (unavailable here).
 *
 * Painting = the count tool grown up: arm a catalog part in the palette,
 * click the plan to drop instances; the BOM groups and prices them live.
 */

/** Human labels for PackageGap.reason (#40 Task 5), used on the gap chips. */
const GAP_REASON_LABEL: Record<PackageGap["reason"], string> = {
  "no-datasheet": "no datasheet",
  "no-spec": "no spec",
  "no-match": "no catalog match",
};

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

const PANEL: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #edeff3",
  borderRadius: 10,
  padding: 12,
};

const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  marginBottom: 7,
};

/** Stable marker color per category — device dots read as families on a plan. */
const MARK_COLORS = ["#3155a8", "#2e9e6b", "#d5342a", "#6b4fa1", "#e08b1f", "#0e7f8c", "#b0367c"];
function markerColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) | 0;
  return MARK_COLORS[Math.abs(h) % MARK_COLORS.length];
}
/** Device marker hit-test radius (normalized 0..1 x-units; the existing
 *  selection test below divides by aspect for y, keeping the on-screen
 *  target circular on tall pages) — same value the click-to-select test
 *  under `onDown` uses. Route-endpoint snapping (Task 4) uses a wider,
 *  ~1.5x radius: a waypoint should count as "on the device" even when it
 *  isn't pixel-perfect on the marker center. */
const DEVICE_HIT_RADIUS = 0.012;
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

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export type SheetLite = {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  /** "generated" = drawn from venueDims via buildGridBaseSheetPlan, no
   *  upload/calibration (#38). Absent means "uploaded". */
  kind?: "uploaded" | "generated";
  /** Present only when kind === "generated". */
  venueDims?: VenueDims;
};
export type ProjectLite = {
  id: string;
  name: string;
  customer: string;
  siteId: string | null;
  siteName: string;
  quoteId: string | null;
  placements: GridPlacement[];
  calibrations: Calibration[];
  spaces: GridSpace[];
  routes: GridRoute[];
  revisions: GridRevision[];
};

type Pending =
  | { kind: "calibrate"; a: Point; b: Point }
  | { kind: "space"; points: Point[] }
  | null;

export default function GridEditor({
  project,
  sheets,
  parts,
  fabrics,
  curtainCoeffs,
  laborParts,
  laborHoursPerDevice,
  specHref,
  engagementId,
  venues,
}: {
  project: ProjectLite;
  sheets: SheetLite[];
  parts: PartLite[];
  /** Catalog fabric rows with SELL price/sq ft (punch #49) - never cost. */
  fabrics: FabricSell[];
  /** Sell-side making coefficients for the live curtain price (punch #49). */
  curtainCoeffs: SellCoeffs;
  /** Catalog labor rows (role "labor") for the auto-suggest (D114). */
  laborParts: LaborPartLite[];
  /** Install-hours-per-device knob from the pricing rules. */
  laborHoursPerDevice: number;
  /** D94 bid-spec generator for this customer's engagement, when one exists. */
  specHref: string | null;
  /** The same resolved engagement id specHref links to (D111 bridge) — null
   *  when the customer has no open engagement. The client package generator
   *  (#40) needs a real engagementId for its spec half, so the "Generate
   *  client package" button gates on this exactly like specHref does. */
  engagementId: string | null;
  /** The customer's venues, for the picker (D113.6). */
  venues: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [activeSheetId, setActiveSheetId] = useState(sheets[0]?.id || "");
  const sheet = sheets.find((s) => s.id === activeSheetId) || sheets[0];
  const isPdf = sheet?.mime === "application/pdf" || sheet?.name.toLowerCase().endsWith(".pdf");

  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [size, setSize] = useState({ w: 900, h: 1200 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Punch #76 — lines the last successful draft/update quoted at plain list
   *  price because the part had no usable cost (or the resolved tier margin
   *  itself was out of range), even though this quote's pricingTier/tierMargin
   *  stamp implies every line got the tier treatment. Non-blocking, mirrors
   *  the Lineset Builder's fabric-unresolved banner (#64): names the lines,
   *  impossible to miss, never refuses the quote. Cleared on every new
   *  mint/update so a fixed catalog makes the warning go away on its own. */
  const [tierFallbackLines, setTierFallbackLines] = useState<string[]>([]);

  /** Client package generator (#40) — separate busy/error state from the
   *  quote button above (`busy`/`err`) since the two actions are unrelated
   *  and a stuck zip build must not disable the "Create draft quote" button
   *  or vice versa. */
  const [cpBusy, setCpBusy] = useState(false);
  const [cpErr, setCpErr] = useState<string | null>(null);
  // Gap-surfacing chips (#40 Task 5): the SKUs the generated package
  // couldn't fully cover (no datasheet / no spec language / no catalog
  // match), one chip each, linking back to the catalog so attaching the
  // missing piece is a click away — "drives attachment population where it
  // matters first." null before the first successful generate (nothing to
  // show yet); [] after a generate with zero gaps (shown, not just absent,
  // so a clean run reads as confirmed-clean rather than untried).
  const [cpGaps, setCpGaps] = useState<PackageGap[] | null>(null);

  /** Real-plan-upload carry-over prompt (#38) — set right after a new sheet
   *  uploads over a generated base sheet that already has placements on it;
   *  cleared once the user picks "Carry over" or "Keep separate". */
  const [uploadCarryPrompt, setUploadCarryPrompt] = useState<{
    fromSheetId: string;
    toSheetId: string;
  } | null>(null);

  /** "Generate starting layout" (#38) — armed only on a non-empty project;
   *  an empty one has nothing to silently overwrite (the action is additive
   *  regardless), so the confirm step is skipped entirely there. */
  const [seedArm, setSeedArm] = useState(false);

  const [search, setSearch] = useState("");
  // Palette SCOPE filter (punch #48, replacing Task #39's group filter):
  // "" = All (today's exact behavior, every device part); one of Jeff's five
  // scopes; or Unscoped for parts the catalog taxonomy can't place (never
  // hidden, just bucketed). This is the "what can I arm" control ONLY -
  // layer visibility below is a separate axis and the two never touch.
  const [scopeFilter, setScopeFilter] = useState("");
  const [armedPartId, setArmedPartId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

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

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onLoaded = useCallback((n: number) => setPages(n), []);
  const onSize = useCallback((w: number, h: number) => setSize({ w, h }), []);

  /** Generated sheets (#38) have no PDF/image to report an onLoaded/onSize
   *  callback, so `size` would otherwise sit at the 900×1200 portrait
   *  default while a proscenium plan is landscape (~0.56 H/W) — every
   *  aspect-ratio-dependent overlay computation (hit-test radius, drag
   *  nudge, wire-snap, calibration scale, and the overlay <svg>'s own
   *  viewBox) would then be fed the wrong numbers, visibly displacing
   *  markers away from screen-center toward it. Recompute the plan once
   *  here (not twice — the render branch below reuses this same value)
   *  and push its real W/H through the identical `onSize` path the
   *  PDF/image branches already use. */
  const generatedPlan = useMemo(
    () => (sheet?.kind === "generated" && sheet.venueDims ? buildGridBaseSheetPlan(sheet.venueDims) : null),
    [sheet?.kind, sheet?.venueDims]
  );
  useEffect(() => {
    if (generatedPlan) onSize(generatedPlan.W, generatedPlan.H);
  }, [generatedPlan, onSize]);

  /** Guarded: an image that reports no size yet must not poison the math
   *  with NaN — calibration would silently fail with a misleading error. */
  const aspect = size.w > 0 && size.h > 0 ? size.h / size.w : 1;
  const cal = sheet ? findCalibration(project.calibrations, sheet.id, page) : null;

  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  /** "Generate starting layout" (#38) — the two real catalog SKUs the
   *  seeding action paints (first Rigging row, first Curtains row). `parts`
   *  already carries every catalog row's raw `category` (server-resolved,
   *  same slice the palette itself reads), so no extra server round trip is
   *  needed just to find one of each. Undefined until the catalog actually
   *  has a row in that category — the starter-set import (#39) may not have
   *  landed yet, or a scratch/dev DB may simply start empty. */
  const seedPipePart = useMemo(() => parts.find((p) => p.category === "Rigging") || null, [parts]);
  const seedCurtainPart = useMemo(() => parts.find((p) => p.category === "Curtains") || null, [parts]);
  const seedDisabled = !seedPipePart || !seedCurtainPart;
  /** The dims suggestSeedPlacements would use — the generated base sheet's,
   *  when the first sheet is one (venueDims is only ever set on a generated
   *  sheet); DEFAULT_VENUE_DIMS otherwise so the action always has a shape
   *  to call with even before that function reads dims at all. */
  const seedDims: VenueDims = sheets[0]?.venueDims ?? DEFAULT_VENUE_DIMS;

  const runSeed = useCallback(async () => {
    if (!seedPipePart || !seedCurtainPart) return;
    setBusy(true);
    const r = await seedStarterLayoutAction(project.id, seedDims, {
      PIPE: seedPipePart.id,
      CURTAIN: seedCurtainPart.id,
    });
    setBusy(false);
    setSeedArm(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    router.refresh();
  }, [project.id, seedDims, seedPipePart, seedCurtainPart, router]);

  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parts
      .filter((p) => {
        if (!scopeFilter) return true; // All - identical to pre-Task-6 behavior.
        // Fabric/Labor rows aren't placeable devices. "All" already showed
        // them before this task (verified: no prior exclusion existed), so
        // that legacy behavior stays untouched above; every specific bucket
        // (a named scope, or Unscoped) excludes them. Fabric reaches the plan
        // through the curtain drop-in (#49), never as an armed device.
        if (p.category === "Fabric" || p.category === "Labor") return false;
        return scopeOfPart(p) === scopeFilter;
      })
      .filter((p) => (q ? (p.sku + " " + p.desc).toLowerCase().includes(q) : true));
  }, [parts, search, scopeFilter]);

  /* ------------------------- scopes + layers (#48) ------------------------- */

  /** The scope one placement belongs to. A curtain IS the Curtains scope by
   *  construction (#49); everything else resolves through the catalog
   *  taxonomy, so remapping a category in the Catalog re-buckets it here. */
  const scopeOfPlacement = useCallback(
    (pl: GridPlacement): GridLayer =>
      pl.curtain ? "Curtains" : scopeOfPart(partById.get(pl.partId)),
    [partById]
  );

  const placementVisible = useCallback(
    (pl: GridPlacement) =>
      isLayerVisible(scopeOfPlacement(pl), normalizeCategory(pl.category), hiddenSet),
    [scopeOfPlacement, hiddenSet]
  );

  /** Whole-project counts for the layer list - a scope you can't see on this
   *  page is still a scope in this design. */
  const scopeCounts = useMemo(() => {
    const m = new Map<GridLayer, number>();
    for (const pl of project.placements) {
      const s = scopeOfPlacement(pl);
      m.set(s, (m.get(s) || 0) + 1);
    }
    for (const r of project.routes || []) {
      const s = scopeOfPart(partById.get(r.partId));
      m.set(s, (m.get(s) || 0) + 1);
    }
    return m;
  }, [project.placements, project.routes, scopeOfPlacement, partById]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of project.placements) {
      const c = normalizeCategory(pl.category);
      if (c) m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [project.placements]);

  /** Per-placement displacement from what the server currently says (punch
   *  #47): the live drag plus any committed-but-unrefreshed move. One map
   *  drives BOTH the markers and the attached wire endpoints, so the picture
   *  on screen mid-gesture is exactly what the store will write. */
  const placementOffsets = useMemo(() => {
    const m = new Map<string, { dx: number; dy: number }>();
    const put = (id: string, at: Point) => {
      const base = project.placements.find((q) => q.id === id);
      if (!base) return;
      const dx = at.x - base.x;
      const dy = at.y - base.y;
      if (dx !== 0 || dy !== 0) m.set(id, { dx, dy });
      else m.delete(id);
    };
    for (const [id, o] of Object.entries(movedLocal)) {
      const server = project.placements.find((q) => q.id === id);
      // Spent: the refresh landed, or that device moved some other way.
      if (!server || server.x !== o.base.x || server.y !== o.base.y) continue;
      put(id, o.at);
    }
    if (drag && drag.moved) put(drag.id, drag.at); // the live gesture wins
    return m;
  }, [project.placements, movedLocal, drag]);

  const sheetPlacements = useMemo(() => {
    const base = project.placements.filter((pl) => pl.sheetId === sheet?.id && pl.page === page);
    if (!placementOffsets.size) return base;
    return base.map((pl) => {
      const d = placementOffsets.get(pl.id);
      return d ? { ...pl, x: clamp01(pl.x + d.dx), y: clamp01(pl.y + d.dy) } : pl;
    });
  }, [project.placements, sheet?.id, page, placementOffsets]);
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
  const pageSpaces = useMemo(
    () => (project.spaces || []).filter((s) => s.sheetId === sheet?.id && s.page === page),
    [project.spaces, sheet?.id, page]
  );

  const pageRoutes = useMemo(() => {
    const base = (project.routes || []).filter((r) => r.sheetId === sheet?.id && r.page === page);
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
  }, [project.routes, sheet?.id, page, placementOffsets]);
  /** A wire run belongs to its part's scope, and hides with it (#48). Routes
   *  carry no user category - only a placed item can be labelled. */
  const visibleRoutes = useMemo(
    () =>
      pageRoutes.filter(
        (r) => !hiddenSet.has(scopeLayerKey(scopeOfPart(partById.get(r.partId))))
      ),
    [pageRoutes, hiddenSet, partById]
  );
  const wireParts = useMemo(() => parts.filter((p) => isPerLengthUnit(p.unit)), [parts]);

  const lines = useMemo(() => bomLines(project.placements, parts), [project.placements, parts]);
  const totals = useMemo(() => bomTotals(project.placements, parts), [project.placements, parts]);
  const wires = useMemo(
    () => routeLines(project.routes || [], parts, project.calibrations),
    [project.routes, parts, project.calibrations]
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
    for (const pl of project.placements) {
      if (!pl.curtain) continue;
      const fabric = fabricBySku.get(pl.curtain.fabricSku);
      m.set(
        pl.id,
        curtainPriceEach(curtainSpecOf(pl.curtain), fabric?.pricePerSqft || 0, curtainCoeffs)
      );
    }
    return m;
  }, [project.placements, fabricBySku, curtainCoeffs]);
  const curtains = useMemo(
    () => curtainLines(project.placements, curtainPrices, fabricNames),
    [project.placements, curtainPrices, fabricNames]
  );
  const curtainValue = curtains.reduce((a, l) => a + l.ext, 0);

  // Labor suggestions (D114): the rule proposes; overrides let the human
  // adjust hours or exclude a line before the quote mints.
  const laborSuggestions = useMemo(
    () => suggestLabor(project.placements, parts, laborParts, laborHoursPerDevice),
    [project.placements, parts, laborParts, laborHoursPerDevice]
  );
  const [laborOverrides, setLaborOverrides] = useState<
    Record<string, { hours?: number; included: boolean }>
  >({});
  const laborRows = laborSuggestions.map((s) => {
    const o = laborOverrides[s.partId];
    const hours = o?.hours !== undefined && o.hours >= 0 ? o.hours : s.hours;
    return { ...s, hours, included: o ? o.included : true, ext: hours * s.rate };
  });
  const includedLabor = laborRows.filter((l) => l.included && l.hours > 0);
  const laborValue = includedLabor.reduce((a, l) => a + l.ext, 0);

  const grandValue = totals.value + wires.value + laborValue + curtainValue;
  const spaceRollups = useMemo(
    () => bomBySpace(project.placements, parts, project.spaces || [], curtainPrices),
    [project.placements, parts, project.spaces, curtainPrices]
  );

  const armedPart = armedPartId ? partById.get(armedPartId) : null;
  /** Selection follows visibility (#48): hiding a layer must not leave a
   *  selected-but-invisible device wired to the arrow-key nudge and the
   *  Remove button. Derived rather than cleared from an effect, so it can't
   *  race a refresh. */
  const selectedPlacement =
    project.placements.find((pl) => pl.id === selected && placementVisible(pl)) || null;
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
      const server = project.placements.find((q) => q.id === placementId);
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
        router.refresh();
      });
    },
    [project.id, project.placements, router]
  );

  // Arrow-key nudge for the selected device (punch #47). Bound to the window
  // because the plan is a div with no focus of its own; every text field in
  // this editor (calibration/space entry, palette search, labor hours) would
  // otherwise lose its arrow keys, hence the editable-target bail-out. Inert
  // while any drawing mode owns the canvas.
  useEffect(() => {
    if (!selectedPlacement) return;
    if (pending || curtainAt || calDraft || drag || spaceDrawing || wireDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
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
  function toNorm(e: React.PointerEvent): Point | null {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  async function upload(file: File) {
    setErr(null);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Could not read that file."));
      fr.readAsDataURL(file);
    });
    setBusy(true);
    const r = await addSheetAction(project.id, {
      name: file.name,
      mime: file.type || "application/octet-stream",
      dataUrl,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    // A real plan just landed over a generated base sheet that already has
    // placements on it (#38) — ask before silently orphaning those markers
    // on a sheet the user is about to stop looking at.
    const generatedSheet = sheets.find((s) => s.kind === "generated");
    const hasGeneratedPlacements = generatedSheet
      ? project.placements.some((p) => p.sheetId === generatedSheet.id)
      : false;
    if (generatedSheet && hasGeneratedPlacements) {
      setUploadCarryPrompt({ fromSheetId: generatedSheet.id, toSheetId: r.sheetId });
    } else {
      setActiveSheetId(r.sheetId);
      setPage(1);
    }
    router.refresh();
  }

  function onDown(e: React.PointerEvent) {
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
            const result = validateDeviceWire(fromPart!, toPart!);
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
          fromPlacementId,
          toPlacementId,
        }).then((r) => {
          setBusy(false);
          if (!r.ok) setErr(r.error);
          else router.refresh();
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
      setErr(null);
      setBusy(true);
      placeDeviceAction(project.id, {
        sheetId: sheet.id,
        page,
        x: p.x,
        y: p.y,
        partId: armedPart.id,
      }).then((r) => {
        setBusy(false);
        if (!r.ok) setErr(r.error);
        else router.refresh();
      });
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
    else router.refresh();
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
    });
    setBusy(false);
    setCurtainAt(null);
    if (!r.ok) setErr(r.error);
    else router.refresh();
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
    else router.refresh();
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
    else router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/design/grid" style={{ ...BTN, textDecoration: "none" }}>
          ← The Grid
        </Link>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16181d" }}>
          {project.name}
          {project.customer ? (
            <span style={{ color: "#8c919c", fontWeight: 500 }}> · {project.customer}</span>
          ) : null}
        </div>
        {venues.length > 0 && (
          <select
            value={project.siteId || ""}
            onChange={async (e) => {
              setBusy(true);
              const r = await setVenueAction(project.id, e.target.value);
              setBusy(false);
              if (!r.ok) setErr(r.error);
              else router.refresh();
            }}
            title="Venue — stamped onto the quote"
            style={{ ...BTN, fontWeight: 500, maxWidth: 190 }}
          >
            <option value="">No venue</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {sheets.length > 0 && (
          <select
            value={sheet?.id || ""}
            onChange={(e) => {
              setActiveSheetId(e.target.value);
              setPage(1);
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
            }}
            style={{ ...BTN, fontWeight: 500 }}
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button style={BTN} disabled={busy} onClick={() => fileRef.current?.click()}>
          + Plan sheet
        </button>
        {seedDisabled ? (
          <button
            style={{ ...BTN, opacity: 0.5, cursor: "not-allowed" }}
            disabled
            title="No catalog parts found in the Rigging or Curtains categories yet"
          >
            Generate starting layout
          </button>
        ) : !seedArm ? (
          <button
            style={BTN}
            disabled={busy}
            onClick={() => {
              if (project.placements.length === 0) runSeed();
              else setSeedArm(true);
            }}
          >
            Generate starting layout
          </button>
        ) : (
          <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "#8c919c" }}>Adds 3 more devices:</span>
            <button
              style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }}
              disabled={busy}
              onClick={runSeed}
            >
              {busy ? "Adding…" : "Confirm"}
            </button>
            <button style={BTN} disabled={busy} onClick={() => setSeedArm(false)}>
              Cancel
            </button>
          </span>
        )}
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/riser`} style={{ ...BTN, textDecoration: "none" }}>
          Riser →
        </Link>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/schedule`} style={{ ...BTN, textDecoration: "none" }}>
          Schedule →
        </Link>
        {/* Derived artifacts (#41): both read only from what is painted here. */}
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/lineset`} style={{ ...BTN, textDecoration: "none" }}>
          Lineset →
        </Link>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/control-riser`} style={{ ...BTN, textDecoration: "none" }}>
          Control Riser →
        </Link>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
        <span style={{ flex: 1 }} />
        <button style={BTN} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
        <span style={{ fontSize: 12, color: "#5b616e", minWidth: 42, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button style={BTN} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
        {isPdf && pages > 1 && (
          <>
            <button style={BTN} disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setSelected(null); setSelectedSpaceId(null); setSpaceDrawing(false); setSpaceDraft([]); setWireDrawing(false); setWireDraft([]); setSelectedRouteId(null); setCurtainAt(null); }}>‹</button>
            <span style={{ fontSize: 12, color: "#5b616e" }}>{page} / {pages}</span>
            <button style={BTN} disabled={page >= pages} onClick={() => { setPage((p) => p + 1); setSelected(null); setSelectedSpaceId(null); setSpaceDrawing(false); setSpaceDraft([]); setWireDrawing(false); setWireDraft([]); setSelectedRouteId(null); setCurtainAt(null); }}>›</button>
          </>
        )}
      </div>

      {err && (
        <div style={{ background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, color: "#a0442b" }}>
          {err}
        </div>
      )}

      {uploadCarryPrompt && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: "#fff8e6", border: "1px solid #f0dca0", borderRadius: 8 }}>
          <span style={{ fontSize: 12.5 }}>Carry the markers from the generated sheet onto this upload?</span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await carryOverAction(project.id, uploadCarryPrompt.fromSheetId, uploadCarryPrompt.toSheetId);
              setBusy(false);
              if (!r.ok) {
                setErr(r.error);
                return;
              }
              setActiveSheetId(uploadCarryPrompt.toSheetId);
              setPage(1);
              setUploadCarryPrompt(null);
              router.refresh();
            }}
            style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid #16181d", background: "#16181d", color: "#fff", cursor: "pointer" }}
          >
            Carry over
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setActiveSheetId(uploadCarryPrompt.toSheetId);
              setPage(1);
              setUploadCarryPrompt(null);
            }}
            style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "1px solid #dfe2e8", background: "#fff", cursor: "pointer" }}
          >
            Keep separate
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "252px 1fr", gap: 12, alignItems: "start" }}>
        {/* sidebar */}
        <div style={{ display: "grid", gap: 12, position: "sticky", top: 12 }}>
          {/* device palette */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Devices</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the catalog"
              style={INPUT}
            />
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              title="Scope filter: what you can arm. Hiding a layer is separate."
              style={{ ...INPUT, marginTop: 6 }}
            >
              <option value="">All scopes</option>
              {GRID_LAYERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {armedPart && hiddenSet.has(scopeLayerKey(scopeOfPart(armedPart))) && (
              <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b", lineHeight: 1.4 }}>
                The {scopeOfPart(armedPart)} layer is hidden, so what you place
                won&apos;t show until you turn it back on.
              </div>
            )}
            {armedPart ? (
              <div style={{ marginTop: 8, fontSize: 11.5, color: "#2e7d55", fontWeight: 600 }}>
                Painting: {armedPart.sku} — click the plan to place.{" "}
                <button
                  style={{ ...BTN, padding: "2px 7px", fontSize: 10.5, marginLeft: 2 }}
                  onClick={() => setArmedPartId(null)}
                >
                  Done
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 11, color: "#8c919c" }}>
                Pick a part, then click the plan for each unit.
              </div>
            )}
            <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto", display: "grid", gap: 3 }}>
              {filteredParts.slice(0, 60).map((p) => {
                const on = p.id === armedPartId;
                return (
                  <div key={p.id}>
                    <button
                      onClick={() => {
                        setArmedPartId(on ? null : p.id);
                        setArmedCurtainType(null);
                        setSelected(null);
                        setSpaceDrawing(false);
                        setSpaceDraft([]);
                        setSelectedSpaceId(null);
                        setWireDrawing(false);
                        setWireDraft([]);
                        setSelectedRouteId(null);
                      }}
                      title={p.desc}
                      style={{
                        ...BTN,
                        width: "100%",
                        textAlign: "left",
                        padding: "5px 8px",
                        fontWeight: 500,
                        display: "grid",
                        gap: 1,
                        background: on ? "#16181d" : "#fff",
                        color: on ? "#fff" : "#3d424e",
                        borderColor: on ? "#16181d" : "#dfe2e8",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 9, height: 9, borderRadius: "50%",
                            background: markerColor(p.category), flex: "0 0 auto",
                          }}
                        />
                        <strong style={{ fontSize: 11.5 }}>{p.sku}</strong>
                        <span style={{ marginLeft: "auto", fontSize: 11 }}>{moneyFmt(p.list)}</span>
                      </span>
                      <span style={{ fontSize: 10.5, color: on ? "#c9cdd6" : "#8c919c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.desc}
                      </span>
                    </button>
                    {/* Datasheet link (Task 5, punch #39) — a sibling of the
                        arm/paint button, not nested inside it: a real <a>
                        inside a <button> is invalid, and this still needs to
                        open in its own tab without arming the part. */}
                    {p.hasDatasheet && (
                      <a
                        href={`/api/part-datasheet/${encodeURIComponent(p.sku)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "block", marginTop: 2, padding: "0 8px", fontSize: 10, color: "var(--accent)", textDecoration: "none" }}
                      >
                        Datasheet
                      </a>
                    )}
                  </div>
                );
              })}
              {filteredParts.length > 60 && (
                <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "3px 2px" }}>
                  {filteredParts.length - 60} more — narrow the search.
                </div>
              )}
              {filteredParts.length === 0 && (
                <div style={{ fontSize: 11.5, color: "#9aa0ab", padding: "3px 2px" }}>
                  Nothing matches.
                </div>
              )}
            </div>
          </div>

          {/* scale */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Scale</div>
            {!sheet ? (
              <div style={{ fontSize: 11.5, color: "#8c919c" }}>Upload a plan sheet first.</div>
            ) : cal ? (
              <>
                <div style={{ fontSize: 12, color: "#2e7d55", fontWeight: 600 }}>Calibrated</div>
                <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
                  Reference {formatMeasure(cal.refLength, cal.unit)} · {cal.by}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    style={{ ...BTN, padding: "4px 8px", fontSize: 11 }}
                    onClick={() => { setCalibrating(true); setArmedPartId(null); setArmedCurtainType(null); setSelected(null); setSpaceDrawing(false); setSpaceDraft([]); setWireDrawing(false); setWireDraft([]); }}
                  >
                    Recalibrate
                  </button>
                  <button
                    style={{ ...BTN, padding: "4px 8px", fontSize: 11, color: "#a0442b" }}
                    onClick={async () => {
                      await clearCalAction(project.id, sheet.id, page);
                      router.refresh();
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 8 }}>
                  Not set for page {page}. Draw over a known dimension, then type its real length —
                  wire lengths and layouts stay correct at any zoom.
                </div>
                <button
                  style={{ ...BTN, width: "100%", background: calibrating ? "#16181d" : "#fff", color: calibrating ? "#fff" : "#3d424e", borderColor: calibrating ? "#16181d" : "#dfe2e8" }}
                  onClick={() => { setCalibrating(true); setArmedPartId(null); setArmedCurtainType(null); setSelected(null); setSpaceDrawing(false); setSpaceDraft([]); setWireDrawing(false); setWireDraft([]); }}
                >
                  {calibrating ? "Draw the reference…" : "Calibrate this page"}
                </button>
              </>
            )}
          </div>

          {/* curtains (punch #49) - a drop-in, not a catalog pick */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Curtains</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {GRID_CURTAIN_TYPES.map((t) => {
                const on = t === armedCurtainType;
                return (
                  <button
                    key={t}
                    style={{
                      ...BTN,
                      padding: "5px 6px",
                      background: on ? "#16181d" : "#fff",
                      color: on ? "#fff" : "#3d424e",
                      borderColor: on ? "#16181d" : "#dfe2e8",
                    }}
                    disabled={busy}
                    onClick={() => {
                      setArmedCurtainType(on ? null : t);
                      setArmedPartId(null);
                      setCalibrating(false);
                      setSelected(null);
                      setSelectedSpaceId(null);
                      setSpaceDrawing(false);
                      setSpaceDraft([]);
                      setWireDrawing(false);
                      setWireDraft([]);
                      setSelectedRouteId(null);
                      setPending(null);
                      setCurtainAt(null);
                    }}
                  >
                    {t}s
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 7, fontSize: 11, color: armedCurtainType ? "#2e7d55" : "#8c919c", fontWeight: armedCurtainType ? 600 : 400, lineHeight: 1.45 }}>
              {armedCurtainType
                ? `Dropping a ${armedCurtainType.toLowerCase()}: click the plan, then give it a name and size.`
                : "Pick a type, click the plan, then specify name, size, fullness and fabric. Priced like the estimator."}
            </div>
            {fabrics.length === 0 && (
              <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b" }}>
                No fabric rows in the catalog yet, and a curtain needs one to price.
              </div>
            )}
          </div>

          {/* layers (punch #48) - visibility of what's already placed */}
          <LayersPanel
            scopeCounts={scopeCounts}
            categoryCounts={categoryCounts}
            hidden={hiddenSet}
            scopeColor={(s) => SCOPE_COLORS[s]}
            onToggle={toggleLayer}
            onShowAll={() => setHiddenLayers([])}
          />

          {/* spaces (D109) */}
          <SpacesPanel
            projectId={project.id}
            pageSpaces={pageSpaces}
            rollups={spaceRollups}
            drawing={spaceDrawing}
            selectedSpaceId={selectedSpaceId}
            busy={busy}
            onStartDraw={() => {
              setSpaceDrawing(true);
              setSpaceDraft([]);
              setArmedPartId(null);
              setArmedCurtainType(null);
              setCalibrating(false);
              setSelected(null);
              setSelectedSpaceId(null);
              setWireDrawing(false);
              setWireDraft([]);
              setSelectedRouteId(null);
              setPending(null);
            }}
            onCancelDraw={() => {
              setSpaceDrawing(false);
              setSpaceDraft([]);
            }}
            onSelect={(id) => {
              setSelectedSpaceId(id);
              setSelected(null);
            }}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />

          {/* wires (D110) */}
          <WiresPanel
            projectId={project.id}
            wireParts={wireParts}
            /* The list matches the canvas: a run in a hidden scope is out of
               sight and out of this list too (#48). */
            pageRoutes={visibleRoutes}
            calibrations={project.calibrations}
            calibrated={Boolean(cal)}
            wiring={wireDrawing}
            wirePartId={wirePartId}
            selectedRouteId={selectedRouteId}
            unmeasured={wires.unmeasured}
            busy={busy}
            onPickPart={(id) => setWirePartId(id)}
            onStartDraw={() => {
              setWireDrawing(true);
              setWireDraft([]);
              setArmedPartId(null);
              setArmedCurtainType(null);
              setCalibrating(false);
              setSpaceDrawing(false);
              setSpaceDraft([]);
              setSelected(null);
              setSelectedSpaceId(null);
              setSelectedRouteId(null);
              setPending(null);
            }}
            onCancelDraw={() => {
              setWireDrawing(false);
              setWireDraft([]);
            }}
            onSelect={(id) => {
              setSelectedRouteId(id);
              setSelected(null);
              setSelectedSpaceId(null);
            }}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />

          {/* selected placement */}
          {selectedPlacement && (
            <div style={{ ...PANEL, background: "#fdf4e7", border: "1px solid #f0dcbb" }}>
              <div style={PANEL_LABEL}>
                {selectedPlacement.curtain ? "Selected curtain" : "Selected device"}
              </div>
              <div style={{ fontSize: 12, color: "#16181d", fontWeight: 600 }}>
                {selectedPlacement.curtain
                  ? selectedPlacement.curtain.name
                  : selectedPlacement.partId}
              </div>
              <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 2 }}>
                {selectedPlacement.curtain
                  ? curtainDesc(
                      selectedPlacement.curtain,
                      fabricNames.get(selectedPlacement.curtain.fabricSku)
                    )
                  : partById.get(selectedPlacement.partId)?.desc || "No longer in the catalog"}
              </div>
              {selectedPlacement.curtain && (
                <div style={{ fontSize: 11.5, color: "#16181d", fontWeight: 600, marginTop: 3 }}>
                  {moneyFmt(curtainPrices.get(selectedPlacement.id) || 0)}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>
                {scopeOfPlacement(selectedPlacement)} · by {selectedPlacement.by}
              </div>

              {/* User-defined category (punch #48/#41) - open-ended by
                  design: assign now, consume later. Orthogonal to the scope
                  above and to whatever space the marker happens to sit in. */}
              {categoryDraft === null ? (
                <button
                  style={{ ...BTN, marginTop: 7, width: "100%", padding: "4px 8px", fontSize: 11, fontWeight: 500 }}
                  onClick={() => setCategoryDraft(normalizeCategory(selectedPlacement.category) || "")}
                >
                  {normalizeCategory(selectedPlacement.category)
                    ? `Category: ${normalizeCategory(selectedPlacement.category)}`
                    : "+ Add a category"}
                </button>
              ) : (
                <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                  <input
                    value={categoryDraft}
                    onChange={(e) => setCategoryDraft(e.target.value)}
                    list="grid-category-suggestions"
                    placeholder="Followspots, House left…"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setCategoryDraft(null);
                      if (e.key === "Enter") saveCategory(selectedPlacement.id, categoryDraft);
                    }}
                    style={{ ...INPUT, fontSize: 11.5, padding: "4px 7px" }}
                    autoFocus
                  />
                  <datalist id="grid-category-suggestions">
                    {categoryCounts.map((c) => (
                      <option key={c.key} value={c.key} />
                    ))}
                  </datalist>
                  <button
                    style={{ ...BTN, padding: "4px 9px", fontSize: 11 }}
                    disabled={busy}
                    onClick={() => saveCategory(selectedPlacement.id, categoryDraft)}
                  >
                    Save
                  </button>
                </div>
              )}
              {/* Position readout + nudge hint (punch #47). Percent of the
                  page box is the honest unit here, it's what's stored, and
                  it stays meaningful on an uncalibrated sheet. */}
              {(() => {
                const at = shownAt(selectedPlacement);
                return (
                  <div style={{ fontSize: 11, color: "#5b616e", marginTop: 6, fontFamily: "var(--font-mono)" }}>
                    x {(at.x * 100).toFixed(1)}% · y {(at.y * 100).toFixed(1)}%
                  </div>
                );
              })()}
              <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
                Drag the marker to move it · arrow keys nudge (hold Shift for
                bigger steps) · attached wires follow.
              </div>
              <button
                style={{ ...BTN, marginTop: 8, width: "100%", color: "#a0442b" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await removePlacementAction(project.id, selectedPlacement.id);
                  setBusy(false);
                  setSelected(null);
                  if (!r.ok) setErr(r.error);
                  else router.refresh();
                }}
              >
                {selectedPlacement.curtain ? "Remove curtain" : "Remove device"}
              </button>
            </div>
          )}

          {/* BOM */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Bill of materials</div>
            {lines.length === 0 && wires.lines.length === 0 && curtains.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "#8c919c" }}>
                Paint devices onto the plan to build the BOM.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {lines.map((l) => (
                  <div key={l.partId} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
                    <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty}×</strong>
                    <span
                      style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={`${l.partId} — ${l.desc}`}
                    >
                      {l.partId}
                    </span>
                    {partById.get(l.partId)?.hasDatasheet && (
                      <a
                        href={`/api/part-datasheet/${encodeURIComponent(l.partId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent)", fontSize: 10.5, whiteSpace: "nowrap", textDecoration: "none" }}
                      >
                        datasheet
                      </a>
                    )}
                    <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
                  </div>
                ))}
                {wires.lines.map((l) => (
                  <div key={`w-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
                    <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty} {l.unit}</strong>
                    <span
                      style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={`${l.partId} — ${l.desc}`}
                    >
                      {l.partId}
                    </span>
                    {partById.get(l.partId)?.hasDatasheet && (
                      <a
                        href={`/api/part-datasheet/${encodeURIComponent(l.partId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent)", fontSize: 10.5, whiteSpace: "nowrap", textDecoration: "none" }}
                      >
                        datasheet
                      </a>
                    )}
                    {l.connectionType && (
                      <span style={{ color: "#9aa0ab", fontSize: 10.5, whiteSpace: "nowrap" }}>
                        {l.connectionType}
                      </span>
                    )}
                    <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
                  </div>
                ))}
                {wires.unmeasured > 0 && (
                  <div style={{ fontSize: 10.5, color: "#a0442b" }}>
                    {wires.unmeasured} unmeasured wire run{wires.unmeasured === 1 ? "" : "s"} excluded.
                  </div>
                )}
                {/* Curtains (punch #49): one line each, never grouped - two
                    drapes of one fabric are different goods once their
                    dimensions differ. */}
                {curtains.map((l) => (
                  <div key={`c-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
                    <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>1×</strong>
                    <span
                      style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={l.desc}
                    >
                      {l.curtainName}
                    </span>
                    <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
                  </div>
                ))}
                {laborRows.length > 0 && (
                  <div style={{ borderTop: "1px dashed #e3e5ea", marginTop: 4, paddingTop: 5, display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>
                      Labor (suggested)
                    </div>
                    {laborRows.map((l) => (
                      <div key={l.partId} style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={l.included}
                          onChange={(e) =>
                            setLaborOverrides((prev) => ({
                              ...prev,
                              [l.partId]: { ...prev[l.partId], included: e.target.checked },
                            }))
                          }
                          style={{ margin: 0 }}
                        />
                        <span
                          style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                          title={`${l.desc} @ ${moneyFmt(l.rate)}/hr`}
                        >
                          {l.partId}
                        </span>
                        <input
                          value={String(l.hours)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setLaborOverrides((prev) => ({
                              ...prev,
                              [l.partId]: {
                                included: prev[l.partId]?.included ?? true,
                                hours: Number.isFinite(v) && v >= 0 ? v : 0,
                              },
                            }));
                          }}
                          inputMode="decimal"
                          style={{ ...INPUT, width: 44, padding: "2px 5px", fontSize: 11.5, textAlign: "right" }}
                        />
                        <span style={{ fontSize: 10.5, color: "#8c919c" }}>hr</span>
                        <span style={{ color: "#16181d", fontWeight: 600, opacity: l.included ? 1 : 0.4 }}>
                          {moneyFmt(l.ext)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ borderTop: "1px solid #edeff3", marginTop: 3, paddingTop: 5, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: "#8c919c" }}>Total</span>
                  <strong>{moneyFmt(grandValue)}</strong>
                </div>
              </div>
            )}
            <button
              style={{
                ...BTN,
                marginTop: 10,
                width: "100%",
                background: "#16181d",
                color: "#fff",
                borderColor: "#16181d",
              }}
              disabled={busy || (lines.length === 0 && wires.lines.length === 0 && curtains.length === 0)}
              onClick={async () => {
                setErr(null);
                setTierFallbackLines([]);
                setBusy(true);
                const r = await createDraftQuoteAction(
                  project.id,
                  includedLabor.map((l) => ({ partId: l.partId, hours: l.hours }))
                );
                setBusy(false);
                if (!r.ok) {
                  setErr(r.error);
                } else {
                  setTierFallbackLines(r.fallbackLines);
                  router.refresh();
                }
              }}
            >
              {project.quoteId ? `Update draft quote ${project.quoteId}` : "Create draft quote"}
            </button>
            {/* Punch #76 — non-blocking: the quote was still created/updated
                above, this only says part of it priced at plain list instead
                of the tier rate because the part had no usable cost. Same
                spirit as the Lineset Builder's fabric-unresolved banner
                (#64): specific, names the lines, doesn't refuse the quote. */}
            {tierFallbackLines.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  background: "#fdf3e3",
                  border: "1px solid #f0d9a8",
                  borderRadius: 9,
                  padding: "8px 11px",
                  fontSize: 11.5,
                  color: "#8a5a12",
                  lineHeight: 1.5,
                }}
              >
                <strong>{tierFallbackLines.length} line{tierFallbackLines.length === 1 ? "" : "s"} priced at list, not tier</strong> — no
                usable cost for {tierFallbackLines.length === 1 ? "this part" : "these parts"}, so{" "}
                {tierFallbackLines.length === 1 ? "it" : "they"} missed the {project.customer ? `${project.customer}'s ` : ""}
                tier discount everything else on this quote got:
                <br />
                {tierFallbackLines.slice(0, 4).join("; ")}
                {tierFallbackLines.length > 4 ? ` +${tierFallbackLines.length - 4} more` : ""}
              </div>
            )}
            {project.quoteId && (
              <Link
                href="/quotes"
                style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--accent)", textAlign: "center" }}
              >
                View in Quotes →
              </Link>
            )}
            {project.quoteId && specHref && (
              <Link
                href={specHref}
                style={{ display: "block", marginTop: 3, fontSize: 11.5, color: "var(--accent)", textAlign: "center" }}
              >
                Bid spec from this design →
              </Link>
            )}
            {/* Client package (#40) — datasheets + spec + rough drawings,
                one zip. Gated on the same resolved engagement as the "Bid
                spec" link above (D111 bridge): the spec half needs a real
                engagementId, same requirement the D94 flow already has.
                Independent of quoteId — the BOM comes straight off the
                design's placements, not off a minted quote. */}
            <div
              style={{ marginTop: 6 }}
              title={engagementId ? undefined : "Link this design to a customer engagement first — a client package needs one for the specification half."}
            >
              {/* Scope disclosure (#40 Task 5, carried over from Task 4's
                  review): the zip's BOM is `bomLines(placements, parts)` —
                  device placements only. Curtains are skipped inside
                  bomLines itself ("if (pl.curtain) continue") and wire
                  routes are a separate project.routes array this action
                  never reads at all (unlike createDraftQuoteAction, which
                  pulls in curtainLines + routeLines too). Said here, before
                  the click, so nobody downloads the zip believing it's the
                  full scope the quote flow would produce. */}
              <div style={{ fontSize: 10.5, color: "var(--muted, #8a8f98)", lineHeight: 1.4, marginBottom: 5 }}>
                Covers device placements only — curtains and wire-route footage aren&rsquo;t included in this package&rsquo;s BOM.
              </div>
              <button
                style={{ ...BTN, width: "100%" }}
                disabled={cpBusy || !engagementId}
                onClick={async () => {
                  if (!engagementId) return;
                  setCpErr(null);
                  setCpBusy(true);
                  try {
                    const r = await generateClientPackageAction(project.id, engagementId);
                    if (!r.ok) {
                      setCpErr(r.error);
                      return;
                    }
                    setCpGaps(r.gaps);
                    // Hidden-anchor click rather than a full navigation
                    // (window.location.href): the download route can 404
                    // (blob missing, path rejected, …), and a full nav on
                    // that path would blow away this editor's in-memory
                    // state (unsaved drag offsets, panel toggles, …) for
                    // nothing more than a failed download. Same pattern as
                    // templates-editor.tsx's downloadJson/estimating-rules'
                    // download() helper.
                    const a = document.createElement("a");
                    a.href = `/api/client-package/download?path=${encodeURIComponent(r.blobPath)}`;
                    a.download = "client-package.zip";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  } catch (e) {
                    setCpErr(e instanceof Error ? e.message : "Couldn't generate the client package — try again.");
                  } finally {
                    setCpBusy(false);
                  }
                }}
              >
                {cpBusy ? "Generating client package…" : "Generate client package"}
              </button>
            </div>
            {cpErr && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#b3261e" }}>{cpErr}</div>
            )}
            {/* Gap chips (#40 Task 5): every SKU the walker (walkBundle,
                client-package.ts) couldn't fully cover — no datasheet, no
                spec language, or no catalog match at all — one chip each,
                linking to the catalog's own search so attaching the missing
                piece is a click away. A SKU can appear here AND still be
                included in the package (e.g. "no-spec": it has a datasheet,
                just no spec section) — this list is "needs attention", not
                "missing entirely". Rendered once cpGaps is non-null (i.e.
                after a successful generate), including the empty case, so a
                clean run reads as confirmed-clean rather than untried. */}
            {cpGaps && (
              <div style={{ marginTop: 8 }}>
                {cpGaps.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#2e7d32" }}>
                    Every BOM line matched a catalog part with a datasheet and spec — no gaps.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 11, color: "var(--muted, #8a8f98)", marginBottom: 4 }}>
                      {cpGaps.length} line{cpGaps.length === 1 ? "" : "s"} need attention in the catalog — click to fix:
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {cpGaps.map((g, i) => (
                        <Link
                          key={`${g.sku}-${g.reason}-${i}`}
                          href={`/catalog?q=${encodeURIComponent(g.sku)}`}
                          title={g.desc}
                          style={{
                            display: "inline-block",
                            fontSize: 10.5,
                            color: "#8a5a12",
                            background: "#fdf3e3",
                            border: "1px solid #f0d9a8",
                            borderRadius: 999,
                            padding: "2px 9px",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {g.sku} — {GAP_REASON_LABEL[g.reason]}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* revisions (D109) */}
          <RevisionsPanel
            projectId={project.id}
            revisions={project.revisions}
            busy={busy}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />
        </div>

        {/* document
            alignItems: "flex-start" (not the flex default "stretch") — a
            child with no explicit height would otherwise get force-stretched
            to fill this panel's minHeight (420, less padding = 384px). Tall
            portrait PDFs/images never noticed (their natural height already
            exceeds 384, so stretch was a no-op), but a short/landscape sheet
            — like the generated proscenium plan below, or any landscape
            upload — got its box distorted to a taller-than-content aspect,
            which then fed the wrong aspect into the overlay <svg>'s
            preserveAspectRatio letterboxing (see the size-effect comment
            above `generatedPlan`). flex-start makes the wrap div's real box
            match its content's natural aspect instead. */}
        <div style={{ overflow: "auto", background: "#6d7076", padding: 18, borderRadius: 10, display: "flex", justifyContent: "center", alignItems: "flex-start", minHeight: 420 }}>
          {!sheet ? (
            <div style={{ alignSelf: "center", color: "#e6e8ec", fontSize: 13.5, textAlign: "center", lineHeight: 1.6 }}>
              No plan sheets yet.
              <br />
              <button style={{ ...BTN, marginTop: 10 }} disabled={busy} onClick={() => fileRef.current?.click()}>
                Upload a PDF or image
              </button>
            </div>
          ) : (
            <div
              ref={wrapRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              // A cancelled pointer (browser gesture, lost capture) abandons
              // the drag rather than committing wherever it stopped.
              onPointerCancel={() => setDrag(null)}
              style={{
                position: "relative",
                lineHeight: 0,
                cursor: drag?.moved
                  ? "grabbing"
                  : pending || curtainAt
                    ? "default"
                    : calibrating || armedPart || armedCurtainType || spaceDrawing || wireDrawing
                      ? "crosshair"
                      : "default",
                touchAction: "none",
                background: "#fff",
                boxShadow: "0 2px 14px rgba(0,0,0,.28)",
              }}
            >
              {generatedPlan ? (
                // <PlanSvg>'s own style is width:100%/height:auto — inside
                // this wrap div (an auto-width flex item, not a fixed-size
                // box), that percentage can't resolve against a real
                // containing-block width, so the browser falls back to the
                // SVG default replaced-element size (300px), NOT the plan's
                // real 640px logical width. Giving it an explicit pixel
                // width here (the same zoom-scaled-px pattern the <img>
                // branch below uses) makes the wrap div's real rendered box
                // land at the plan's actual W:H aspect, matching the
                // `size` state the effect above just set — so the overlay
                // <svg>'s viewBox lines up with the real box with no
                // preserveAspectRatio letterboxing/offset.
                <div style={{ width: Math.round(generatedPlan.W * zoom) }}>
                  <PlanSvg plan={generatedPlan} accent="#16181d" />
                </div>
              ) : isPdf ? (
                <PdfCanvas dataUrl={sheet.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sheet.dataUrl}
                  alt={sheet.name}
                  // Intrinsic dimensions, not clientWidth: onLoad can fire
                  // before layout (and never fires for cached images), which
                  // left size at 0×0 and broke the calibration math. The
                  // callback ref covers already-complete images; aspect only
                  // needs the ratio, so natural units are exactly right.
                  // The functional update MUST return the same object when
                  // nothing changed — an inline ref runs on every commit, and
                  // unconditionally setting fresh state here is a render loop.
                  ref={(el) => {
                    if (el && el.complete && el.naturalWidth) {
                      const w = el.naturalWidth;
                      const h = el.naturalHeight;
                      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
                    }
                  }}
                  onLoad={(e) =>
                    setSize({
                      w: e.currentTarget.naturalWidth || e.currentTarget.clientWidth,
                      h: e.currentTarget.naturalHeight || e.currentTarget.clientHeight,
                    })
                  }
                  style={{ width: `${Math.round(900 * zoom)}px`, height: "auto", display: "block" }}
                />
              )}

              <svg
                width={size.w}
                height={size.h}
                viewBox={`0 0 ${size.w} ${size.h}`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
              >
                {/* spaces render UNDER the device markers */}
                {pageSpaces.map((s) => {
                  const pts = s.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ");
                  const c = polygonCentroid(s.points);
                  const on = s.id === selectedSpaceId;
                  return (
                    <g key={s.id}>
                      <polygon
                        points={pts}
                        fill={s.color}
                        opacity={on ? 0.22 : 0.13}
                        stroke={s.color}
                        strokeWidth={on ? 2.5 : 1.5}
                        strokeOpacity={0.55}
                        strokeDasharray={on ? "6 4" : undefined}
                      />
                      <g>
                        <rect
                          x={c.x * size.w - s.name.length * 3.6 - 6}
                          y={c.y * size.h - 9}
                          width={s.name.length * 7.2 + 12}
                          height={18}
                          rx={5}
                          fill="#fff"
                          stroke={s.color}
                          strokeWidth={1}
                          opacity={0.92}
                        />
                        <text
                          x={c.x * size.w}
                          y={c.y * size.h + 4}
                          fill={s.color}
                          fontSize={11}
                          fontWeight={700}
                          textAnchor="middle"
                          style={{ fontFamily: "inherit" }}
                        >
                          {s.name}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {/* space being drawn: open polyline + corner dots */}
                {spaceDraft.length > 0 && (
                  <g>
                    <polyline
                      points={spaceDraft.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                      fill="none"
                      stroke="#8a6d3b"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                    {spaceDraft.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x * size.w}
                        cy={p.y * size.h}
                        r={i === 0 ? 7 : 4}
                        fill={i === 0 ? "#fff" : "#8a6d3b"}
                        stroke="#8a6d3b"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                )}
                {pending?.kind === "space" && (
                  <polygon
                    points={pending.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                    fill="#8a6d3b"
                    opacity={0.15}
                    stroke="#8a6d3b"
                    strokeWidth={2}
                  />
                )}
                {/* wire routes (D110) - dashed polylines with a length chip.
                    Hidden scopes take their wires with them (#48). */}
                {visibleRoutes.map((r) => {
                  const part = partById.get(r.partId);
                  const c = markerColor(part?.category || "Wire");
                  const on = r.id === selectedRouteId;
                  const pts = r.points.map((q) => `${q.x * size.w},${q.y * size.h}`).join(" ");
                  const midIdx = Math.floor((r.points.length - 1) / 2);
                  const mA = r.points[midIdx];
                  const mB = r.points[Math.min(midIdx + 1, r.points.length - 1)];
                  const mx = ((mA.x + mB.x) / 2) * size.w;
                  const my = ((mA.y + mB.y) / 2) * size.h;
                  const ft = routeLengthFt(r, project.calibrations);
                  const calHere = project.calibrations.find(
                    (cc) => cc.docId === r.sheetId && cc.page === r.page
                  );
                  const label = ft !== null && calHere ? formatMeasure(ft, calHere.unit) : "unmeasured";
                  return (
                    <g key={r.id}>
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={c}
                        strokeWidth={on ? 4 : 2.5}
                        strokeDasharray="8 5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {r.points.map((q, i) => (
                        <circle key={i} cx={q.x * size.w} cy={q.y * size.h} r={3} fill={c} />
                      ))}
                      <g>
                        <rect x={mx - 30} y={my - 20} width={60} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                        <text x={mx} y={my - 8} fill={c} fontSize={10.5} fontWeight={700} textAnchor="middle" style={{ fontFamily: "inherit" }}>
                          {label}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {wireDraft.length > 0 && (
                  <g>
                    <polyline
                      points={wireDraft.map((q) => `${q.x * size.w},${q.y * size.h}`).join(" ")}
                      fill="none"
                      stroke="#3155a8"
                      strokeWidth={2.5}
                      strokeDasharray="8 5"
                    />
                    {wireDraft.map((q, i) => (
                      <circle
                        key={i}
                        cx={q.x * size.w}
                        cy={q.y * size.h}
                        r={i === wireDraft.length - 1 ? 6 : 3}
                        fill={i === wireDraft.length - 1 ? "#fff" : "#3155a8"}
                        stroke="#3155a8"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                )}
                {visiblePlacements.map((pl) => {
                  const part = partById.get(pl.partId);
                  // A curtain reads as its scope's color and a drape glyph, so
                  // a plan full of devices doesn't swallow it (#48/#49).
                  const c = pl.curtain
                    ? SCOPE_COLORS.Curtains
                    : markerColor(part?.category || "");
                  const x = pl.x * size.w;
                  const y = pl.y * size.h;
                  const on = pl.id === selected;
                  const label = pl.curtain ? pl.curtain.name : pl.partId;
                  return (
                    <g key={pl.id}>
                      {pl.curtain ? (
                        <>
                          <rect x={x - 11} y={y - 8} width={22} height={16} rx={2} fill={c} opacity={0.92} />
                          <rect x={x - 11} y={y - 8} width={22} height={16} rx={2} fill="none" stroke="#fff" strokeWidth={1.5} />
                          <path
                            d={`M ${x - 7} ${y - 6} L ${x - 7} ${y + 6} M ${x} ${y - 6} L ${x} ${y + 6} M ${x + 7} ${y - 6} L ${x + 7} ${y + 6}`}
                            stroke="#fff"
                            strokeWidth={1}
                            opacity={0.75}
                          />
                        </>
                      ) : (
                        <>
                          <circle cx={x} cy={y} r={10} fill={c} opacity={0.92} />
                          <circle cx={x} cy={y} r={10} fill="none" stroke="#fff" strokeWidth={1.5} />
                        </>
                      )}
                      <rect x={x + 12} y={y - 8} width={Math.max(30, label.length * 6.4) + 8} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                      <text x={x + 16} y={y + 4} fill={c} fontSize={10.5} fontWeight={700} style={{ fontFamily: "inherit" }}>
                        {label}
                      </text>
                      {on && (
                        <circle cx={x} cy={y} r={15} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
                      )}
                    </g>
                  );
                })}
                {calDraft && (
                  <line
                    x1={calDraft[0].x * size.w}
                    y1={calDraft[0].y * size.h}
                    x2={calDraft[calDraft.length - 1].x * size.w}
                    y2={calDraft[calDraft.length - 1].y * size.h}
                    stroke="#d5342a"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                )}
              </svg>

              {/* curtain drop-in (punch #49) - anchored where it was dropped,
                  same on-canvas idiom as the calibration/space entry */}
              {curtainAt && armedCurtainType && (
                <div
                  style={{
                    position: "absolute",
                    left: `${curtainAt.x * 100}%`,
                    top: `${curtainAt.y * 100}%`,
                    transform: "translate(6px, 6px)",
                    zIndex: 6,
                  }}
                >
                  <CurtainDrop
                    type={armedCurtainType}
                    fabrics={fabrics}
                    coeffs={curtainCoeffs}
                    busy={busy}
                    onConfirm={dropCurtain}
                    onCancel={() => setCurtainAt(null)}
                  />
                </div>
              )}

              {/* inline entry — window.prompt is unavailable here */}
              {pending && (() => {
                const anchor =
                  pending.kind === "calibrate" ? pending.b : pending.points[pending.points.length - 1];
                const cancel = () => {
                  setPending(null);
                  setEntry("");
                  setSpaceDraft([]);
                };
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: `${anchor.x * 100}%`,
                      top: `${anchor.y * 100}%`,
                      transform: "translate(6px, 6px)",
                      background: "#fff",
                      border: "1px solid #c4c9d2",
                      borderRadius: 9,
                      padding: 10,
                      boxShadow: "0 6px 20px rgba(0,0,0,.22)",
                      width: 232,
                      lineHeight: 1.4,
                      zIndex: 5,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div style={{ ...PANEL_LABEL, marginBottom: 6 }}>
                      {pending.kind === "calibrate" ? "Reference length" : "Name this space"}
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      <input
                        value={entry}
                        onChange={(e) => setEntry(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (pending.kind === "calibrate") confirmCalibration();
                            else confirmSpace();
                          }
                          if (e.key === "Escape") cancel();
                        }}
                        placeholder={pending.kind === "calibrate" ? "e.g. 40" : "Stage, House, Booth…"}
                        inputMode={pending.kind === "calibrate" ? "decimal" : "text"}
                        style={INPUT}
                        autoFocus
                      />
                      {pending.kind === "calibrate" && (
                        <select value={calUnit} onChange={(e) => setCalUnit(e.target.value as MeasureUnit)} style={{ ...INPUT, width: 66 }}>
                          {MEASURE_UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button
                        style={{ ...BTN, flex: 1 }}
                        disabled={busy}
                        onClick={pending.kind === "calibrate" ? confirmCalibration : confirmSpace}
                      >
                        {pending.kind === "calibrate" ? "Set scale" : "Create space"}
                      </button>
                      <button style={BTN} onClick={cancel}>Cancel</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "#8c919c" }}>
        Arm a device and click the plan to place each unit · click a marker to select it,
        drag it to move it (arrow keys nudge) · click inside a space to select the room ·
        the BOM prices every sheet in this design, not just the visible page.
      </div>
    </div>
  );
}
