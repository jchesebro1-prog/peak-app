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
import { uploadGridSheet } from "./sheet-upload";
import { adjustQueueStep, uploadNote } from "@/lib/design/grid-sheet-split";
import { allPagesLocked, pageLocks, type SheetAdjust } from "@/lib/design/sheet-adjust";
import { optionSlice } from "@/lib/design/grid-options";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { riserLinksOf, type RiserDoc } from "@/lib/design/grid-riser-doc";
import type { QuickScopeInputs } from "@/app/(app)/design/quick/engine";
import type { ScopeTargets, ScopeTargetsByTier } from "@/lib/design/scope-targets";
import type { SellCard } from "@/lib/design/auto-estimate";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import type { GridOption, GridPlacement, GridRevision, GridRoute, GridSpace, RemovedBundle } from "@/lib/stores/grid-projects";
import type { EstimateTrayData } from "@/lib/design/estimate-tray";
import type { GridIntakeNotice } from "@/lib/design/grid-plan-intake";
import {
  addRouteAction,
  addSpaceAction,
  calibrateAction,
  clearCalAction,
  createDraftQuoteAction,
  deleteProjectAction,
  movePlacementsAction,
  pastePlacementsAction,
  placeCurtainAction,
  placeDeviceAction,
  removePlacementsAction,
  replacePlacementsPartAction,
  restoreItemsAction,
  setPlacementsCategoryAction,
  setSymbolDisplayAction,
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
import { paletteView } from "@/lib/design/grid-palette";
import type { ScheduleData } from "@/lib/design/grid-schedule";
import { idsInRect, marqueeSelection, normRect, toggleId, type Rect } from "@/lib/design/grid-selection";
import { alignPositions, changedMoves, distributePositions, type AlignMode } from "@/lib/design/grid-align";
import { copySelection, PASTE_OFFSET, pasteLayout, type Clipboard } from "@/lib/design/grid-clipboard";
// Type-only: the module itself imports the server-side catalog lookup.
import type { CurtainInput } from "@/lib/design/grid-curtain-input";
import { cleanSymbolDisplay, hitRadius, type SymbolDisplay, type SymbolMode } from "@/lib/design/grid-symbol-display";
import type { ObjectSymbolUrls } from "@/lib/design/object-symbols";
import {
  SNAP_FT_KEY,
  SNAP_ON_KEY,
  SNAP_SPACINGS_FT,
  snapDelta,
  snapGrid,
  snapProblem,
  snapPoint,
  type SnapGrid,
} from "@/lib/design/grid-snap";
import {
  emptyUndo,
  pushUndo,
  takeRedo,
  takeUndo,
  withRefreshedRestore,
  type GridCommand,
  type UndoEntry,
  type UndoState,
} from "@/lib/design/grid-undo";

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
 *  isn't pixel-perfect on the marker center. Both are at 100 % symbol size;
 *  the editor scales them with the design's Size (#300, `hitRadius`). */
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
/** The Size slider's save debounce (#300): it paints every step, writes once
 *  the hand settles — the last value wins. */
const SYMBOL_SAVE_MS = 400;

/** Snap on (#299): one arrow press moves a device one grid step; Shift = this many. */
const SNAP_NUDGE_FAST_STEPS = 5;

/** One axis of a snapped nudge: the grid line `k` steps from `v` in direction
 *  `dir` — from a point already on the grid that is exactly k steps; from an
 *  off-grid point the first step lands on the next line over. The tolerance
 *  keeps float noise (0.30000000000000004) from skipping a line. */
function nextGridLine(v: number, step: number, dir: -1 | 1, k: number): number {
  const n = v / step;
  return (dir > 0 ? Math.floor(n + 1e-6) + k : Math.ceil(n - 1e-6) - k) * step;
}

/** Fold one batch of moves into another, the later one winning per device. */
function mergeMoves(
  first: readonly { id: string; x: number; y: number }[] | null,
  then: readonly { id: string; x: number; y: number }[],
): { id: string; x: number; y: number }[] {
  if (!first?.length) return [...then];
  const m = new Map(first.map((mv) => [mv.id, mv]));
  for (const mv of then) m.set(mv.id, mv);
  return [...m.values()];
}

/** What a thrown action (dropped connection, server error — not a refusal)
 *  says next to the plan once its optimistic state is rolled back. */
const SAVE_FAILED = "That didn't save — check your connection and try again.";

/** What a refused undo/redo step says (#299) — another person (or tab) changed
 *  the design since the step was recorded; the stack is cleared with it. */
const UNDO_STALE = "Couldn't undo — the design changed.";
const REDO_STALE = "Couldn't redo — the design changed.";

/** Status-bar words for an align mode ("Aligned 3 devices left"). */
const ALIGN_WORDS: Record<AlignMode, string> = {
  left: "left",
  center: "to center",
  right: "right",
  top: "top",
  middle: "to middle",
  bottom: "bottom",
};

/** "4 devices", "2 curtains", or "5 items" when both are selected. */
function countNoun(pls: readonly GridPlacement[]): string {
  const curtains = pls.filter((pl) => pl.curtain).length;
  const noun = curtains === 0 ? "device" : curtains === pls.length ? "curtain" : "item";
  return `${pls.length} ${noun}${pls.length === 1 ? "" : "s"}`;
}

/** An in-flight marker drag (punch #47). `off` is the grab offset (pointer to
 *  marker center) so the marker doesn't jump under the cursor; `cx/cy` are the
 *  screen-pixel origin for the DRAG_PX test; `toggleOff` remembers that the
 *  marker was already selected, so a click that never became a drag still
 *  deselects exactly as it did before.
 *  #299 group drag: `ids` are every device that moves with it (the selection
 *  when the grab landed on a selected marker, else just `[id]`), `from` is
 *  where each was SHOWN at the grab — every one moves by the dragged
 *  marker's delta (`at - from[id]`). `collapse`: the grab landed on one
 *  member of a larger selection, so a click that never became a drag
 *  narrows the selection to that device. */
type MarkerDrag = {
  id: string;
  ids: string[];
  from: Record<string, Point>;
  off: Point;
  cx: number;
  cy: number;
  at: Point;
  moved: boolean;
  toggleOff: boolean;
  collapse: boolean;
};

/** Where a dragged group's members are right now: each one's grab-time
 *  position plus the dragged marker's delta, clamped to the page. With snap
 *  on (#299) the DRAGGED marker lands on the grid and every other member
 *  moves by that same snapped delta — the live preview and the commit both
 *  read this, so what you see on release is what is written. */
function dragTargets(d: MarkerDrag, snap: SnapGrid | null): { id: string; x: number; y: number }[] {
  const o = d.from[d.id];
  const { dx, dy } = o ? snapDelta(o, d.at, snap) : { dx: 0, dy: 0 };
  return d.ids
    .filter((id) => d.from[id])
    .map((id) => ({ id, x: clamp01(d.from[id].x + dx), y: clamp01(d.from[id].y + dy) }));
}

/** An optimistic position (punch #47): where the client put a device, plus
 *  the server position it replaces. Holding `base` is what makes the override
 *  self-expiring WITHOUT an effect, it applies only while the server copy
 *  still reads `base`, so the moment the refresh lands (or anything else, a
 *  revision restore included, moves that device) the entry goes inert on its
 *  own. Clearing it from an effect instead both races the refresh and trips
 *  the compiler's no-setState-in-effect rule. */
type MoveOverride = { at: Point; base: Point };

/** An override is spent once the server copy no longer sits at its `base`
 *  (the refresh landed, the device moved some other way) or is gone. */
function isSpentOverride(server: Point | undefined, o: MoveOverride): boolean {
  return !server || server.x !== o.base.x || server.y !== o.base.y;
}

/** An undo step's label (#299), read after "Undo " / "Undid ":
 *  "move (3 devices)", "delete (1 device)". */
function stepLabel(verb: string, n: number): string {
  return `${verb} (${n} device${n === 1 ? "" : "s"})`;
}

/** Placement (if any) on `placements` whose marker the point `p` snaps to,
 *  using the same box-tolerance shape as the existing hit-test. Scans
 *  in the same reversed order as the marker-select hit-test below (`onDown`)
 *  so overlapping devices prefer the topmost/most-recent placement. */
function snappedPlacement(
  p: Point,
  placements: GridPlacement[],
  aspect: number,
  radius: number = DEVICE_SNAP_RADIUS
): GridPlacement | null {
  return (
    [...placements]
      .reverse()
      .find(
        (pl) =>
          Math.abs(pl.x - p.x) < radius &&
          Math.abs(pl.y - p.y) < radius / (aspect || 1)
      ) || null
  );
}

export type SheetLite = {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  /** #318: how this sheet was derived from its original upload (Adjust sheet); null/absent = an upload. */
  adjust?: SheetAdjust | null;
  /** #318: the generated base sheet — never cropped or rotated. */
  base?: boolean;
};
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
  /** Symbol scale + mode (#300) — always cleaned by the page. */
  symbolDisplay: SymbolDisplay;
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
  /** #300 (D609): partId → object drawing URLs, built server-side by
   *  symbolUrlsFor; a part absent here draws the generic symbol. */
  symbolUrls: Record<string, ObjectSymbolUrls>;
  /** #226: this user's starred parts and last-placed parts (newest first). */
  favorites: string[];
  recent: string[];
  /** #299: the active option's equipment schedule for the Spreadsheet view,
   *  built server-side by scheduleForOption — the /schedule page's own helper.
   *  null when the build threw: the view says so instead of showing nothing. */
  schedule: ScheduleData | null;
  /** #314: the estimate this design draws (any option of it) — the quote
   *  button becomes "Open estimate →"; null for an ordinary design. */
  estimateLink?: { quoteId: string; quoteNumber: string; href: string } | null;
  /** #314: the From estimate tray for the ACTIVE option, when it is the
   *  estimate-owned one — lines read live from the quote's saved spec. */
  estimateTray?: EstimateTrayData | null;
  /** #314 review: notices the intake save left (plan view / Auto fill), until retried or dismissed. */
  intakeNotices?: GridIntakeNotice[];
  /** #314 review: the intake's plan view sheet — the editor opens on it, even when it lands after mount. */
  focusSheetId?: string | null;
  /** #318: file storage is on — sheets upload straight to Blob (≤ 25 MB); off = the 4 MB route. */
  blobUploads?: boolean;
  /** #318/#319: `?adjust=<id>,<id>,…` — the sheets the intake's plan view became, walked in Adjust sheet once the first is listed. */
  adjustSheetIds?: string[] | null;
  /** #319: the raw `?adjust=` string — what adoption keys on. The filtered list above shrinks
   *  as Done retires sheets (revalidate re-renders the same URL); this does not. */
  adjustKey?: string | null;
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
    recent,
    schedule,
    symbolUrls,
  } = props;
  const estimateLink = props.estimateLink ?? null;
  const estimateTray = props.estimateTray ?? null;
  const intakeNotices = props.intakeNotices ?? [];
  const blobUploads = props.blobUploads ?? false;
  const router = useRouter();
  const pathname = usePathname();
  /** #299 multi-select: every selected device, in the order picked. The
   *  single-device `selected` is derived — set only when exactly one is. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** The pre-multi-select setter, kept so single-device call sites read the same. */
  const setSelected = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  /** The marquee being dragged on empty plan (plan coords), null otherwise.
   *  `marqueeStart` is the pointerdown that may grow into one. */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const marqueeStart = useRef<{ p: Point; cx: number; cy: number; shift: boolean; rect: Rect | null } | null>(null);
  /** #226/#299: the starred-parts list lives here, not in the Product Library, so it
   *  survives the bottom pane unmounting its body when collapsed. */
  const [favorites, setFavorites] = useState<string[]>(props.favorites);
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
      setSelectedIds([]);
      setTierFallbackLines([]);
      router.replace(`${pathname}?option=${encodeURIComponent(id)}`, { scroll: false });
    },
    [pathname, router]
  );
  // Two-step arm/confirm; this app doesn't use window.confirm.
  const [armDelete, setArmDelete] = useState(false);
  // #314 review: open on the intake's plan view. It can land AFTER the editor
  // mounted (the intake's save re-renders into the editor, then the dropped
  // file uploads), so a new focus sheet is applied once it shows up in
  // `sheets` — adjusted during render, never in an effect.
  const focusSheetId = props.focusSheetId ?? null;
  const focusHere = !!focusSheetId && sheets.some((s) => s.id === focusSheetId);
  const [activeSheetId, setActiveSheetId] = useState((focusHere ? focusSheetId : sheets[0]?.id) || "");
  const [focusApplied, setFocusApplied] = useState<string | null>(focusHere ? focusSheetId : null);
  /** #318: Done in Adjust sheet swapped `from` for `to` on the server; until the
   *  refreshed `sheets` lists `to`, the old sheet stays on screen — under the
   *  still-open dialog, which blocks every edit — instead of falling back to
   *  the first sheet. */
  const [adjustSwap, setAdjustSwap] = useState<{ from: string; to: string } | null>(null);
  const sheet =
    sheets.find((s) => s.id === activeSheetId) ||
    (adjustSwap?.to === activeSheetId ? sheets.find((s) => s.id === adjustSwap.from) : undefined) ||
    sheets[0];
  const isPdf = sheet?.mime === "application/pdf" || sheet?.name.toLowerCase().endsWith(".pdf");

  const [page, setPage] = useState(1);
  if (focusHere && focusSheetId !== focusApplied) {
    setFocusApplied(focusSheetId);
    // #318: the focus sheet (intake.planSheetId) is the one Adjust sheet just
    // replaced — the server remapped it to the new id. finishAdjust already
    // opened that sheet on the page in view; adopting it must not jump to
    // page 1. Runs before the swap-clear below, so adjustSwap is still set.
    if (adjustSwap?.to !== focusSheetId) {
      setActiveSheetId(focusSheetId!);
      setPage(1);
    }
  }
  // #318: Adjust sheet (crop + rotate). Opened from the tab's ⋯ menu, right
  // after an upload (the + tab, the notice banner's re-upload), or by the
  // intake's swap into the editor through `?adjust=<id>,<id>,…` — adopted during
  // render once the first sheet is in `sheets`, like the focus sheet above.
  /** #319: `queue` = every sheet one upload made (≥ 2, in order) — Adjust sheet walks them one at a time. */
  const [adjusting, setAdjusting] = useState<{ sheetId: string; afterUpload: boolean; queue?: string[] } | null>(null);
  const requestedIds = props.adjustSheetIds?.length ? props.adjustSheetIds : null;
  /** The request's adoption key: the raw param (stable while Done retires its sheets), never the filtered list. */
  const requestedAdjust = requestedIds ? (props.adjustKey || requestedIds.join(",")) : null;
  const [adjustApplied, setAdjustApplied] = useState<string | null>(null);
  // Adopted once per param, and never while the dialog / a walk is open — a
  // re-render mid-walk must not re-key the open (or Saving…) dialog.
  if (requestedIds && requestedAdjust && requestedAdjust !== adjustApplied && !adjusting && sheets.some((s) => s.id === requestedIds[0])) {
    setAdjustApplied(requestedAdjust);
    setAdjusting({ sheetId: requestedIds[0], afterUpload: true, ...(requestedIds.length > 1 ? { queue: requestedIds } : {}) });
    setSelectedIds([]);
    setActiveSheetId(requestedIds[0]);
    setPage(1);
  }
  // The swap has landed (the new sheet is listed — or the old one is gone,
  // whatever the refresh brought): close the dialog on the new sheet — or,
  // #319, in a multi-sheet upload, open the next one.
  if (adjustSwap && (sheets.some((s) => s.id === adjustSwap.to) || !sheets.some((s) => s.id === adjustSwap.from))) {
    setAdjustSwap(null);
    const nextId = adjustQueueStep(adjusting?.queue, adjustSwap.from, sheets.map((s) => s.id)).next;
    if (adjusting?.queue && nextId) {
      // No resetSheetState() here (not callable during render, and not needed):
      // finishAdjust already reset the sheet state on Done, and the workspace has
      // been inert under the Saving… dialog ever since, so nothing new accrued.
      setAdjusting({ sheetId: nextId, afterUpload: true, queue: adjusting.queue });
      setActiveSheetId(nextId);
      setPage(1);
    } else setAdjusting(null);
  }
  const openAdjust = useCallback((sheetId: string, afterUpload = false, queue?: readonly string[]) => {
    // Defence in depth: nothing stays selected behind the dialog.
    setSelectedIds([]);
    setAdjusting({ sheetId, afterUpload, ...(queue && queue.length > 1 ? { queue: [...queue] } : {}) });
  }, []);
  /** The sheet open in Adjust sheet — null until a just-uploaded sheet arrives in `sheets`. */
  const adjustTarget = adjusting ? (sheets.find((s) => s.id === adjusting.sheetId) ?? null) : null;
  /** The dialog is on screen (Saving… included): the editor's key handlers stand down. */
  const adjustOpen = !!adjustTarget;
  const adjustAfterUpload = adjusting?.afterUpload ?? false;
  /** #319: this sheet's place in a multi-sheet upload's walk ("Sheet 2 of 5"); null = a single sheet. */
  const adjustQueue = adjusting?.queue ? adjustQueueStep(adjusting.queue, adjusting.sheetId, []).position : null;
  /** Page locks per listed sheet — one scan per project/sheets change, not per tab per render. */
  const locksBySheet = useMemo(() => new Map(sheets.map((s) => [s.id, pageLocks(project, s.id)] as const)), [project, sheets]);
  const adjustLocks = useMemo(() => (adjustTarget ? (locksBySheet.get(adjustTarget.id) ?? {}) : {}), [locksBySheet, adjustTarget]);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [size, setSize] = useState({ w: 900, h: 1200 });
  const [busy, setBusy] = useState(false);
  /** `busy`, readable from the nudge timer (it closes over a stale render). */
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [err, setErr] = useState<string | null>(null);
  /** The status bar's "Last action" (#299) — what the last successful edit
   *  did, in words. View state only; never persisted. */
  const [lastAction, setLastAction] = useState<string | null>(null);
  const noteAction = useCallback((text: string) => setLastAction(text), []);

  /** Symbol size + Generic/Object (#300) — a display setting saved on the
   *  design, so the plan and the printed set match. Painted here first,
   *  then written; never an undo step, and it never clears the stack. */
  const [symbolDisplay, setSymbolDisplayLocal] = useState<SymbolDisplay>(project.symbolDisplay);
  const [symbolSeen, setSymbolSeen] = useState<SymbolDisplay>(project.symbolDisplay);
  /** A write is scheduled or in flight — its value outranks the props. */
  const [symbolSaving, setSymbolSaving] = useState(false);
  // Adopt a new server value (another tab, a refresh) during render — unless
  // this tab still has its own write on the way.
  if (symbolSeen.scale !== project.symbolDisplay.scale || symbolSeen.mode !== project.symbolDisplay.mode) {
    setSymbolSeen(project.symbolDisplay);
    if (!symbolSaving) setSymbolDisplayLocal(project.symbolDisplay);
  }
  /** The last value the server holds — what a failed write reverts to. */
  const symbolSaved = useRef<SymbolDisplay>(project.symbolDisplay);
  useEffect(() => {
    symbolSaved.current = project.symbolDisplay;
  }, [project.symbolDisplay]);
  const symbolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The value still inside the debounce (null once sent). */
  const symbolUnsent = useRef<SymbolDisplay | null>(null);
  /** Write sequence: only the newest write's answer counts (last value wins). */
  const symbolSeq = useRef(0);
  const sendSymbolDisplay = useCallback(
    async (next: SymbolDisplay, seq: number) => {
      symbolUnsent.current = null;
      let r: Awaited<ReturnType<typeof setSymbolDisplayAction>> | null = null;
      try {
        r = await setSymbolDisplayAction(project.id, next);
      } catch {
        r = null;
      } finally {
        if (seq === symbolSeq.current) {
          setSymbolSaving(false);
          if (!r || !r.ok) {
            setSymbolDisplayLocal(symbolSaved.current);
            setErr(r && !r.ok ? r.error : SAVE_FAILED);
          }
        }
      }
    },
    [project.id]
  );
  function saveSymbolDisplay(next: SymbolDisplay, delay: number) {
    setSymbolDisplayLocal(next);
    setSymbolSaving(true);
    const seq = ++symbolSeq.current;
    if (symbolTimer.current) clearTimeout(symbolTimer.current);
    symbolTimer.current = null;
    if (delay <= 0) {
      void sendSymbolDisplay(next, seq);
      return;
    }
    symbolUnsent.current = next;
    symbolTimer.current = setTimeout(() => {
      symbolTimer.current = null;
      void sendSymbolDisplay(next, seq);
    }, delay);
  }
  /** The Size slider: paints live, writes debounced. */
  function setSymbolScale(v: number) {
    const scale = cleanSymbolDisplay({ scale: v }).scale;
    if (scale === symbolDisplay.scale) return;
    saveSymbolDisplay({ ...symbolDisplay, scale }, SYMBOL_SAVE_MS);
  }
  /** Generic / Object: writes at once (with the current size). */
  function setSymbolMode(mode: SymbolMode) {
    if (mode === symbolDisplay.mode) return;
    saveSymbolDisplay({ ...symbolDisplay, mode }, 0);
  }
  // Leaving inside the debounce still writes the last size (best effort).
  useEffect(
    () => () => {
      if (symbolTimer.current) clearTimeout(symbolTimer.current);
      symbolTimer.current = null;
      const unsent = symbolUnsent.current;
      symbolUnsent.current = null;
      if (unsent) void setSymbolDisplayAction(project.id, unsent).catch(() => {});
    },
    [project.id]
  );
  /** Device hit + wire-snap radii follow the drawn size (#300). */
  const deviceHitRadius = hitRadius(DEVICE_HIT_RADIUS, symbolDisplay.scale);
  const deviceSnapRadius = hitRadius(DEVICE_SNAP_RADIUS, symbolDisplay.scale);

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
  /** The nudge positions painted but not yet written (the 400 ms debounce). */
  const pendingNudge = useRef<{ id: string; x: number; y: number }[] | null>(null);
  /** Forget every optimistic position except a still-unwritten nudge's —
   *  after an edit the stack can't follow (revision restore, another
   *  panel's change) or a refused undo step, a spent override must not
   *  wake up when the server copy returns to its `base`. */
  const dropMoveOverrides = useCallback(() => {
    const keep = new Set((pendingNudge.current ?? []).map((m) => m.id));
    setMovedLocal((prev) => {
      const next: Record<string, MoveOverride> = {};
      for (const [id, o] of Object.entries(prev)) if (keep.has(id)) next[id] = o;
      return next;
    });
  }, []);

  /** Undo / redo (#299 slice 6) — a per-tab client stack. The ref is the
   *  truth handlers read (two quick presses can't both pop the same entry);
   *  the state mirrors it so the toolbar re-renders. Never persisted. */
  const undoRef = useRef<UndoState>(emptyUndo());
  const [undoState, setUndoState] = useState<UndoState>(emptyUndo);
  const commitUndo = useCallback((s: UndoState) => {
    undoRef.current = s;
    setUndoState(s);
  }, []);
  /** Record one undoable edit (a new edit clears redo). */
  const record = useCallback((e: UndoEntry) => commitUndo(pushUndo(undoRef.current, e)), [commitUndo]);
  /** Drop the whole stack — after an edit that isn't undoable (Change
   *  equipment, sheets, calibration, options, spaces, wires, revision
   *  restore): its effects can collide with the ids the stack recorded. */
  const clearUndo = useCallback(() => commitUndo(emptyUndo()), [commitUndo]);
  /** What a panel's not-undoable edit calls on success: clear the stack, refresh. */
  const onStructuralChange = useCallback(() => {
    clearUndo();
    dropMoveOverrides();
    router.refresh();
  }, [clearUndo, dropMoveOverrides, router]);
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

  /** Snap to grid (#299 slice 5) — per viewer, off by default, applied
   *  client-side to place, curtain drop, group drag and nudge. The stored
   *  values are applied after mount (hydration-safe, the inbox-layout
   *  pattern); every change is written back. */
  const [snapOn, setSnapOnState] = useState(false);
  const [snapFt, setSnapFtState] = useState(1);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const on = window.localStorage.getItem(SNAP_ON_KEY);
        const ft = Number(window.localStorage.getItem(SNAP_FT_KEY));
        setSnapOnState(on === "1");
        setSnapFtState((SNAP_SPACINGS_FT as readonly number[]).includes(ft) ? ft : 1);
      } catch {
        /* storage unavailable — keep the defaults */
      }
    });
  }, []);
  const setSnapOn = useCallback((on: boolean) => {
    setSnapOnState(on);
    try {
      window.localStorage.setItem(SNAP_ON_KEY, on ? "1" : "0");
    } catch {
      /* per-viewer convenience only */
    }
  }, []);
  const setSnapFt = useCallback((ft: number) => {
    if (!(SNAP_SPACINGS_FT as readonly number[]).includes(ft)) return;
    setSnapFtState(ft);
    try {
      window.localStorage.setItem(SNAP_FT_KEY, String(ft));
    } catch {
      /* per-viewer convenience only */
    }
  }, []);
  /** The active snap step, or null when snap is off — or on but the spacing
   *  is unusable at this page's scale (then it behaves as off and the status
   *  bar says so). Uncalibrated pages snap to 1% of the sheet. */
  const calScale = cal?.scale;
  const calUnitOfPage = cal?.unit;
  const snap = useMemo(
    () => (snapOn ? snapGrid(calScale != null && calUnitOfPage ? { scale: calScale, unit: calUnitOfPage } : null, snapFt, aspect) : null),
    [snapOn, calScale, calUnitOfPage, snapFt, aspect]
  );
  /** Why a calibrated page can't snap at the chosen spacing (null = it can). */
  const snapIssue = useMemo(
    () => (snapOn ? snapProblem(calScale != null && calUnitOfPage ? { scale: calScale, unit: calUnitOfPage } : null, snapFt) : null),
    [snapOn, calScale, calUnitOfPage, snapFt]
  );
  const snapStatus = !snapOn
    ? "Snap: off"
    : snap
      ? `Snap: ${snap.label}`
      : snapIssue === "coarse"
        ? "Snap: too coarse at this scale"
        : "Snap: too fine at this scale";

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
    const byId = new Map(placements.map((q) => [q.id, q] as const));
    const put = (id: string, at: Point) => {
      const base = byId.get(id);
      if (!base) return;
      const dx = at.x - base.x;
      const dy = at.y - base.y;
      if (dx !== 0 || dy !== 0) m.set(id, { dx, dy });
      else m.delete(id);
    };
    for (const [id, o] of Object.entries(movedLocal)) {
      // Spent: the refresh landed, or that device moved some other way.
      if (isSpentOverride(byId.get(id), o)) continue;
      put(id, o.at);
    }
    // The live gesture wins — every device in a group drag moves by the
    // dragged marker's delta (#299).
    if (drag && drag.moved) for (const t of dragTargets(drag, snap)) put(t.id, t);
    return m;
  }, [placements, movedLocal, drag, snap]);

  // Prune spent overrides (the refresh landed, the device moved some other
  // way, or it is gone) whenever the server copy changes — adjusted during
  // render when the prop changes (React's "storing information from previous
  // renders" pattern), so no effect cascades. The updater hands back `prev`
  // untouched when nothing is spent.
  const [prunedFor, setPrunedFor] = useState(placements);
  if (prunedFor !== placements) {
    setPrunedFor(placements);
    const byId = new Map(placements.map((q) => [q.id, q] as const));
    setMovedLocal((prev) => {
      let changed = false;
      const next: Record<string, MoveOverride> = {};
      for (const [id, o] of Object.entries(prev)) {
        if (isSpentOverride(byId.get(id), o)) changed = true;
        else next[id] = o;
      }
      return changed ? next : prev;
    });
  }

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
  /** System Status (#299): BOM lines whose part is `virtualDead` — the same
   *  condition that prints the "Needs a part" pill on a BOM row. */
  const needsPart = useMemo(() => lines.filter((l) => partById.get(l.partId)?.virtualDead).length, [lines, partById]);
  /** System Status (#299): unmapped parts the Library's All view hides. */
  const hiddenUnmapped = useMemo(
    () =>
      paletteView(
        parts,
        { tab: "all", search: "", scope: "", typeKey: "", mfr: "" },
        deviceTypes.filter((t) => !t.archived),
        favorites,
        recent
      ).hiddenUnmapped,
    [parts, deviceTypes, favorites, recent]
  );
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
  /** Every selected device that is visible (#299), in selection order —
   *  server copies (read positions via `shownAt`). */
  const selectedPlacements = useMemo(() => {
    const byId = new Map(placements.map((pl) => [pl.id, pl]));
    return selectedIds.flatMap((id) => {
      const pl = byId.get(id);
      return pl && placementVisible(pl) ? [pl] : [];
    });
  }, [placements, selectedIds, placementVisible]);
  /** Selection follows visibility (#48): hiding a layer must not leave a
   *  selected-but-invisible device wired to the arrow-key nudge and the
   *  Remove button. Derived rather than cleared from an effect, so it can't
   *  race a refresh. #299: the single selection is the VISIBLE one — two
   *  selected with one hidden reads as one device everywhere (Property
   *  Editor, status bar, Delete, nudge). */
  const selectedPlacement = selectedPlacements.length === 1 ? selectedPlacements[0] : null;
  const selected = selectedPlacement ? selectedPlacement.id : null;
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

  /** Write many repositions in one batched, all-or-nothing action (#299) —
   *  the drag (one device or a group) and the arrow-key nudge both land
   *  here. Optimistic entries go in first and are ALL rolled back if the
   *  server refuses. Resolves to the positions the server replaced (what
   *  undo needs), or null when nothing was written. */
  const writeMoves = useCallback(
    async (
      moves: { id: string; x: number; y: number }[],
      label?: string,
      /** The undo step's verb (#299): "move", "nudge", "align", "distribute". */
      verb = "move"
    ): Promise<{ ok: boolean; previous: { id: string; x: number; y: number }[] | null }> => {
      const servers = new Map(placements.map((q) => [q.id, q]));
      // Always write what was asked: the saved position is stale between a
      // write and its router.refresh(), so a quick correction back to the old
      // spot must not be dropped. Callers filter no-op moves themselves
      // (changedMoves against the shown positions). Unknown ids are skipped.
      const valid = moves.filter((m) => servers.has(m.id));
      if (!valid.length) return { ok: true, previous: null };
      setMovedLocal((prev) => {
        const next = { ...prev };
        for (const m of valid) {
          const server = servers.get(m.id)!;
          next[m.id] = { at: { x: m.x, y: m.y }, base: { x: server.x, y: server.y } };
        }
        return next;
      });
      // Refused or thrown: drop every optimistic position so the markers
      // return to where the design actually has them, next to the error.
      const rollBack = () =>
        setMovedLocal((prev) => {
          const next = { ...prev };
          for (const m of valid) delete next[m.id];
          return next;
        });
      setErr(null);
      setBusy(true);
      try {
        const r = await movePlacementsAction(project.id, valid);
        if (!r.ok) {
          setErr(r.error);
          rollBack();
          return { ok: false, previous: null };
        }
        noteAction(
          label ?? (valid.length === 1 ? `Moved ${placementLabel(servers.get(valid[0].id)!)}` : `Moved ${countNoun(valid.map((m) => servers.get(m.id)!))}`)
        );
        // Every successful write is one undo step — drag, align, distribute,
        // a timer-written or flushed nudge alike (#299 slice 6).
        if (r.previous.length)
          record({
            label: stepLabel(verb, valid.length),
            forward: { kind: "move", moves: valid.map(({ id, x, y }) => ({ id, x, y })) },
            inverse: { kind: "move", moves: r.previous },
          });
        router.refresh();
        return { ok: true, previous: r.previous };
      } catch {
        rollBack();
        setErr(SAVE_FAILED);
        return { ok: false, previous: null };
      } finally {
        setBusy(false);
      }
    },
    [project.id, placements, router, noteAction, placementLabel, record]
  );
  const sendMoves = useCallback(
    async (moves: { id: string; x: number; y: number }[], label?: string, verb?: string) =>
      (await writeMoves(moves, label, verb)).previous,
    [writeMoves]
  );
  /** The latest sendMoves, for the nudge timer: the timer outlives the render
   *  that armed it, and a stale closure would check its moves against a
   *  placement list from before a delete. */
  const sendMovesRef = useRef(sendMoves);
  useEffect(() => {
    sendMovesRef.current = sendMoves;
  }, [sendMoves]);
  /** How many devices the unwritten nudge moves (0 = none) — state, so the
   *  toolbar's Undo can offer a nudge still inside the debounce. */
  const [nudgePending, setNudgePending] = useState(0);
  /** Cancel the debounce and hand back the unwritten nudge (null if none). */
  const takeNudge = useCallback(() => {
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    const m = pendingNudge.current;
    pendingNudge.current = null;
    setNudgePending(0);
    return m;
  }, []);
  /** An undo/redo step is in flight (#299 slice 6): a second press is
   *  dropped, and so is an arrow-key nudge (its write would land mid-step). */
  const stepping = useRef(false);
  /** Write a pending nudge NOW, before an edit that isn't a move (delete,
   *  category, part), so the debounce can never fire after it. Devices in
   *  `dropIds` (about to be deleted) are left out of the write — moving them
   *  first would be pointless, and moving them after would fail.
   *  Resolves to false when the write failed (the error is already showing
   *  and the markers rolled back): the caller must stop, not carry on. */
  const flushNudge = useCallback(
    async (dropIds?: ReadonlySet<string>): Promise<boolean> => {
      const m = takeNudge();
      const kept = m && dropIds ? m.filter((mv) => !dropIds.has(mv.id)) : m;
      if (!kept?.length) return true;
      return (await writeMoves(kept, undefined, "nudge")).ok;
    },
    [takeNudge, writeMoves]
  );
  /** Every move that isn't the nudge timer itself (drag release, align,
   *  distribute) goes through here: a pending nudge is FOLDED into the same
   *  write (this batch wins per device), so a stale debounce can never land
   *  after it and undo the drag/align. One write, one refresh, no flicker. */
  const commitMoves = useCallback(
    (moves: { id: string; x: number; y: number }[], label?: string, verb?: string) =>
      sendMoves(mergeMoves(takeNudge(), moves), label, verb),
    [takeNudge, sendMoves]
  );

  // Arrow-key nudge for the selected device (punch #47). Bound to the window
  // because the plan is a div with no focus of its own; every text field in
  // this editor (calibration/space entry, palette search, labor amounts) would
  // otherwise lose its arrow keys, hence the editable-target bail-out. Inert
  // while any drawing mode owns the canvas.
  useEffect(() => {
    // #318: never under the Adjust sheet dialog, wherever focus fell.
    if (adjustOpen) return;
    if (!selectedPlacements.length) return;
    // #299: the plan is hidden in Spreadsheet view — nothing to nudge there.
    if (view !== "plan") return;
    if (pending || curtainAt || calDraft || drag || spaceDrawing || wireDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog (e.g. the IconPicker) that already handled this key — or
      // any element opted out with data-no-nudge — owns the arrow keys;
      // don't also move the selected plan device underneath it.
      if (e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (t?.closest('[role="dialog"], [data-no-nudge]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dirX = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const dirY = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (!dirX && !dirY) return;
      e.preventDefault(); // don't scroll the plan out from under the device
      // An undo/redo step is in flight: a nudge queued now could land in the
      // middle of the step and corrupt the stack. An ordinary write in flight
      // (even this nudge's own debounced one) is fine — the tap is painted and
      // queued, and the timer below waits for that write to finish.
      if (stepping.current) return;
      let dx: number;
      let dy: number;
      if (snap) {
        // Snap on (#299): the first selected device steps to the next grid
        // line in the arrow's direction (its other axis rounds onto the grid
        // too, so it lands on a dot); the rest move by the same delta.
        const k = e.shiftKey ? SNAP_NUDGE_FAST_STEPS : 1;
        const a = shownAt(selectedPlacements[0]);
        const to = snapPoint(a, snap);
        if (dirX) to.x = clamp01(nextGridLine(a.x, snap.stepX, dirX as -1 | 1, k));
        if (dirY) to.y = clamp01(nextGridLine(a.y, snap.stepY, dirY as -1 | 1, k));
        dx = to.x - a.x;
        dy = to.y - a.y;
      } else {
        const step = e.shiftKey ? NUDGE_FAST : NUDGE;
        dx = dirX * step;
        dy = (dirY * step) / (aspect || 1);
      }
      // #299: every selected device moves together.
      const moves = selectedPlacements.map((pl) => {
        const from = shownAt(pl);
        return { id: pl.id, x: clamp01(from.x + dx), y: clamp01(from.y + dy) };
      });
      // Pinned at the page edge (or already on the grid line): nothing moves,
      // so nothing is painted, queued or written.
      if (!changedMoves(selectedPlacements.map((pl) => ({ id: pl.id, ...shownAt(pl) })), moves).length) return;
      // Paint every keystroke; write once the key-repeat settles.
      setMovedLocal((prev) => {
        const next = { ...prev };
        for (const [i, pl] of selectedPlacements.entries()) {
          next[pl.id] = { at: { x: moves[i].x, y: moves[i].y }, base: { x: pl.x, y: pl.y } };
        }
        return next;
      });
      // The pending write accumulates: a selection change between two
      // presses must not drop the first device's unwritten nudge.
      pendingNudge.current = mergeMoves(pendingNudge.current, moves);
      setNudgePending(pendingNudge.current.length);
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      const commit = () => {
        // A write is still in flight: re-arm instead of firing, so the queued
        // nudge is written after it finishes, never dropped or interleaved.
        if (busyRef.current) {
          nudgeTimer.current = setTimeout(commit, NUDGE_COMMIT_MS);
          return;
        }
        const m = takeNudge();
        if (m?.length) void sendMovesRef.current(m, undefined, "nudge");
      };
      nudgeTimer.current = setTimeout(commit, NUDGE_COMMIT_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedPlacements,
    shownAt,
    takeNudge,
    snap,
    aspect,
    pending,
    curtainAt,
    calDraft,
    drag,
    spaceDrawing,
    wireDrawing,
    view,
    adjustOpen,
  ]);

  // A pending nudge must not outlive the editor.
  // …but leaving the page inside the 400 ms window still writes it (best effort).
  useEffect(
    () => () => {
      const pending = takeNudge();
      // Best effort by design: the write may call router.refresh() after unmount.
      if (pending?.length) void sendMovesRef.current(pending);
    },
    [takeNudge]
  );

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
   * Upload one plan sheet (#146, D173; #318, D692): straight to private Blob
   * up to 25 MB through the token broker when file storage is on, else the
   * 4 MB multipart route — uploadGridSheet picks, preflights and never
   * throws. The reply carries only the new sheet id; nothing here names a
   * stored path.
   */
  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    const r = await uploadGridSheet(project.id, file, { blobUploads });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setActiveSheetId(r.sheetId);
    setPage(1);
    noteAction(uploadNote(file.name, r));
    openAdjust(r.sheetId, true, r.sheetIds);
    clearUndo();
    router.refresh();
  }

  /** One undo step for devices that were just created (place, curtain drop,
   *  paste, duplicate): undo removes them by id; redo restores the records. */
  const recordPlace = useCallback(
    (label: string, created: GridPlacement[]) => {
      if (!created.length) return;
      record({
        label,
        forward: { kind: "restore", bundle: { placements: created, riser: {} } },
        inverse: { kind: "remove", ids: created.map((pl) => pl.id) },
      });
    },
    [record]
  );

  /** Drop one unit of a part at a plan point — the armed-part click and a
   *  palette drag-and-drop (#299) both land here. Places once; arms nothing. */
  function placeAt(partId: string, at: Point) {
    if (busy || pending || curtainAt || !sheet) return;
    setErr(null);
    setBusy(true);
    // Snap on (#299): the armed click and a palette drop both land on the grid.
    const p = snapPoint(at, snap);
    placeDeviceAction(project.id, {
      sheetId: sheet.id,
      page,
      x: p.x,
      y: p.y,
      partId,
      optionId: activeOptionId,
    }).then(
      (r) => {
        setBusy(false);
        if (!r.ok) setErr(r.error);
        else {
          noteAction(`Placed ${partLabel(partId)}`);
          recordPlace(`place ${partLabel(partId)}`, [r.placement]);
          router.refresh();
        }
      },
      () => {
        setBusy(false);
        setErr(SAVE_FAILED);
      }
    );
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
        const fromPlacement = snappedPlacement(points[0], visiblePlacements, aspect, deviceSnapRadius);
        const toPlacement = snappedPlacement(
          points[points.length - 1],
          visiblePlacements,
          aspect,
          deviceSnapRadius
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
            clearUndo();
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
          Math.abs(pl.x - p.x) < deviceHitRadius &&
          Math.abs(pl.y - p.y) < deviceHitRadius / (aspect || 1)
      );
    if (hit) {
      setCategoryDraft(null);
      setSelectedSpaceId(null);
      setSelectedRouteId(null);
      // #299: Shift-click adds/removes one device and never starts a drag.
      if (e.shiftKey) {
        setSelectedIds(toggleId(selectedIds, hit.id));
        return;
      }
      // A grab on a selected device keeps the whole selection, so the
      // group moves together; on an unselected one it selects just that.
      const inSelection = selectedIds.includes(hit.id);
      const ids = inSelection ? selectedIds : [hit.id];
      if (!inSelection) setSelectedIds([hit.id]);
      const from: Record<string, Point> = {};
      for (const pl of visiblePlacements) if (ids.includes(pl.id)) from[pl.id] = { x: pl.x, y: pl.y };
      setDrag({
        id: hit.id,
        ids: ids.filter((id) => from[id]),
        from,
        off: { x: hit.x - p.x, y: hit.y - p.y },
        cx: e.clientX,
        cy: e.clientY,
        at: { x: hit.x, y: hit.y },
        moved: false,
        toggleOff: hit.id === selected,
        collapse: inSelection && selectedIds.length > 1,
      });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }

    // Curtain drop-in (#49): the type was armed in the sidebar, so the click
    // just decides WHERE - the dialog gathers the five fields at that spot.
    if (armedCurtainType) {
      setSelectedIds([]);
      setCategoryDraft(null);
      setCurtainAt(snapPoint(p, snap));
      return;
    }

    if (armedPart) {
      setSelectedIds([]);
      setCategoryDraft(null);
      placeAt(armedPart.id, p);
      return;
    }

    // Nothing armed (#299): this press may grow into a marquee. Until the
    // pointer travels DRAG_PX it is still a click, and the release runs the
    // click below (`clickEmpty`) — the route or room under the point.
    marqueeStart.current = { p, cx: e.clientX, cy: e.clientY, shift: e.shiftKey, rect: null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  /** A click (no drag) on empty plan with nothing armed: drop the device
   *  selection, then pick the route or room under the point. */
  function clickEmpty(p: Point) {
    if (!sheet) return;
    setSelectedIds([]);
    setCategoryDraft(null);
    // A wire is a finer target than a room, so routes first…
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
    const ms = marqueeStart.current;
    if (ms) {
      if (!ms.rect && Math.hypot(e.clientX - ms.cx, e.clientY - ms.cy) < DRAG_PX) return;
      const p = toNorm(e);
      if (!p) return;
      ms.rect = normRect(ms.p, p);
      setMarquee(ms.rect);
      return;
    }
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

  function onUp(e?: React.PointerEvent) {
    const ms = marqueeStart.current;
    if (ms) {
      marqueeStart.current = null;
      setMarquee(null);
      if (!ms.rect) {
        clickEmpty(ms.p);
        return;
      }
      // Shown positions (visiblePlacements carries every live offset).
      const hits = idsInRect(visiblePlacements, ms.rect);
      setSelectedIds(marqueeSelection(selectedIds, hits, ms.shift || Boolean(e?.shiftKey)));
      setCategoryDraft(null);
      setSelectedSpaceId(null);
      setSelectedRouteId(null);
      return;
    }
    if (drag) {
      const d = drag;
      setDrag(null);
      // Never travelled: this was a click, so keep the old toggle-select —
      // or, on one member of a larger selection, narrow it to that device.
      if (!d.moved) {
        if (d.collapse) setSelectedIds([d.id]);
        else if (d.toggleOff) setSelectedIds([]);
        return;
      }
      // Released where it started (snapped back, or dragged out and back):
      // that was a click — writing nothing, not even an Auto-tag clear.
      const targets = changedMoves(
        d.ids.filter((id) => d.from[id]).map((id) => ({ id, ...d.from[id] })),
        dragTargets(d, snap)
      );
      if (!targets.length) {
        if (d.collapse) setSelectedIds([d.id]);
        else if (d.toggleOff) setSelectedIds([]);
        return;
      }
      void commitMoves(targets);
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

  /** A cancelled pointer (browser gesture, lost capture) abandons the drag
   *  or marquee rather than committing wherever it stopped. */
  function cancelGesture() {
    setDrag(null);
    marqueeStart.current = null;
    setMarquee(null);
  }

  /** Persist a placement's user-defined category (punch #48). "" clears it. */
  async function saveCategory(placementId: string, label: string) {
    // The batch setter with one item (same category rule as the single one)
    // hands back the previous label, so the edit is one undo step (#299).
    if (!(await flushNudge())) return;
    setBusy(true);
    const items = [{ id: placementId, category: label }];
    let r: Awaited<ReturnType<typeof setPlacementsCategoryAction>>;
    try {
      r = await setPlacementsCategoryAction(project.id, items);
    } catch {
      setBusy(false);
      setErr(SAVE_FAILED);
      return;
    }
    setBusy(false);
    setCategoryDraft(null);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(label.trim() ? `Set category ${label.trim()}` : "Cleared a category");
      if (r.previous.some((pv) => pv.category !== label.trim().slice(0, 40)))
        record({ label: stepLabel("set category", 1), forward: { kind: "category", items }, inverse: { kind: "category", items: r.previous } });
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
    let r: Awaited<ReturnType<typeof placeCurtainAction>>;
    try {
      r = await placeCurtainAction(project.id, {
        sheetId: sheet.id,
        page,
        x: curtainAt.x,
        y: curtainAt.y,
        curtain,
        optionId: activeOptionId,
      });
    } catch {
      // Keep the dialog open so the typed spec isn't lost.
      setBusy(false);
      setErr(SAVE_FAILED);
      return;
    }
    setBusy(false);
    setCurtainAt(null);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(`Placed curtain ${curtain.name}`);
      recordPlace(`place ${curtain.name}`, [r.placement]);
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
      clearUndo();
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
      clearUndo();
      router.refresh();
    }
  }

  /** Drop this page's scale (the Property Editor's Scale → Clear). */
  async function clearCalibration() {
    if (!sheet) return;
    setBusy(true);
    const r = await clearCalAction(project.id, sheet.id, page);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      noteAction(`Cleared page ${page}'s scale`);
      clearUndo();
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
      // Every tool acts on the plan — arming one from anywhere (Product
      // Library, the right pane, a Calibrate button) leaves Spreadsheet view.
      setView("plan");
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
        setSelectedIds([]);
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
    // enterTool("select") minus its switch to the plan: Escape in
    // Spreadsheet view clears without leaving the sheet.
    clearModes();
    setSelectedIds([]);
    setSelectedSpaceId(null);
    setSelectedRouteId(null);
  }, [clearModes]);

  /** Zoom −/+ step 0.25 within [ZOOM_MIN, ZOOM_MAX], rounded to 2 decimals so
   *  a Fit value like 1.05 steps cleanly. */
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100)), []);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100)), []);

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
    setSelectedIds([]);
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

  /** #318: drop `?adjust=` once the dialog it asked for closes, so a reload doesn't open it again. */
  const dropAdjustParam = useCallback(() => {
    if (requestedAdjust) router.replace(`${pathname}?option=${encodeURIComponent(activeOptionId)}`, { scroll: false });
  }, [requestedAdjust, router, pathname, activeOptionId]);

  /** #318: Cancel / Skip — the sheet stays as it is. Skip after an upload opens that sheet's plan.
   *  #319: in a multi-sheet upload, Skip (Escape, or Done with nothing changed) opens the next
   *  sheet still listed; Skip the rest (`rest`) ends the walk on this one. */
  const closeAdjustWith = useCallback(
    (rest: boolean) => {
      const nextId = rest ? null : adjustQueueStep(adjusting?.queue, adjusting?.sheetId ?? "", sheets.map((s) => s.id)).next;
      if (adjusting?.queue && nextId) {
        setAdjusting({ sheetId: nextId, afterUpload: true, queue: adjusting.queue });
        switchSheet(nextId);
        return;
      }
      if (adjusting?.afterUpload && adjusting.sheetId !== sheet?.id && sheets.some((s) => s.id === adjusting.sheetId)) switchSheet(adjusting.sheetId);
      setAdjusting(null);
      dropAdjustParam();
    },
    [adjusting, sheet?.id, sheets, switchSheet, dropAdjustParam]
  );
  const closeAdjust = useCallback(() => closeAdjustWith(false), [closeAdjustWith]);
  const skipRestAdjust = useCallback(() => closeAdjustWith(true), [closeAdjustWith]);

  /** #318: Done in Adjust sheet — the new sheet took the old one's place; open it.
   *  The active id moves now; the dialog stays up ("Saving…") until the
   *  refreshed sheet list carries the new sheet (adopted during render above),
   *  so nothing can act on the old, now-unlisted sheet in between. */
  const finishAdjust = useCallback(
    (newSheetId: string) => {
      const name = adjustTarget?.name || "the sheet";
      const from = adjusting?.sheetId ?? null;
      if (from) setAdjustSwap({ from, to: newSheetId });
      else setAdjusting(null);
      // The server remaps intake.planSheetId too, so the refreshed focus
      // sheet is the new id. focusApplied is left alone here (setting it
      // while the prop is still the old id would flip back to the old sheet,
      // page 1): the render-time adoption sees adjustSwap.to === the new
      // focus id and only records it — the page in view is kept.
      if (from !== sheet?.id) setPage(1);
      setActiveSheetId(newSheetId);
      resetSheetState();
      noteAction(`Cropped & rotated ${name}`);
      dropAdjustParam();
      // Device / space / wire ids are unchanged but now name the new sheet —
      // the undo stack's recorded bundles would restore onto the old one.
      onStructuralChange();
    },
    [adjustTarget, adjusting, sheet?.id, resetSheetState, noteAction, dropAdjustParam, onStructuralChange]
  );

  /** #318: the ⋯ menu's Crop & rotate… for one tab — never on the generated
   *  base sheet; disabled, with why, once every page is known to have content. */
  const adjustAvailability = useCallback(
    (s: SheetLite): { hidden: boolean; disabled: boolean; title: string } => {
      if (s.base) return { hidden: true, disabled: true, title: "" };
      const sheetIsPdf = s.mime === "application/pdf" || s.name.toLowerCase().endsWith(".pdf");
      // A PDF's page count is known only for the sheet on screen; any other PDF opens and shows its locked pages.
      const count = !sheetIsPdf ? 1 : s.id === sheet?.id ? pages : 0;
      return allPagesLocked(locksBySheet.get(s.id) ?? {}, count)
        ? { hidden: false, disabled: true, title: "Every page of this sheet has devices, spaces, wires or a scale on it — crop and rotate only work on an empty page." }
        : { hidden: false, disabled: false, title: "Crop the sheet to the plan and turn it upright — pages with anything on them stay as they are" };
    },
    [locksBySheet, sheet?.id, pages]
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

  /* ------------------------- bulk edits on the selection (#299) ------------------------- */

  /** Remove every visible selected device in one write — the Property
   *  Editor's Remove / Delete n, the toolbar Delete and the Delete/Backspace
   *  key all land here. Resolves to what undo needs to put back, or null. */
  const removeSelectedAs = useCallback(async (verb: "Delete" | "Cut"): Promise<RemovedBundle | null> => {
    const targets = selectedPlacements;
    if (!targets.length) return null;
    // A pending nudge writes first (minus the devices going away), so its
    // debounce can't fire after the delete and report them missing.
    if (!(await flushNudge(new Set(targets.map((pl) => pl.id))))) return null;
    setErr(null);
    setBusy(true);
    try {
      const r = await removePlacementsAction(project.id, targets.map((pl) => pl.id));
      if (!r.ok) {
        setErr(r.error);
        return null;
      }
      setSelectedIds([]);
      setCategoryDraft(null);
      noteAction(targets.length === 1 ? `Removed ${placementLabel(targets[0])}` : `Removed ${countNoun(targets)}`);
      const ids = targets.map((pl) => pl.id);
      record({ label: stepLabel(verb.toLowerCase(), ids.length), forward: { kind: "remove", ids }, inverse: { kind: "restore", bundle: r.removed } });
      router.refresh();
      return r.removed;
    } catch {
      setErr(SAVE_FAILED);
      return null;
    } finally {
      setBusy(false);
    }
  }, [selectedPlacements, project.id, router, noteAction, placementLabel, flushNudge, record]);
  const removeSelected = useCallback(() => removeSelectedAs("Delete"), [removeSelectedAs]);

  /** Where each visible selected device is shown right now. */
  const selectionPositions = useCallback(
    () => selectedPlacements.map((pl) => ({ id: pl.id, ...shownAt(pl) })),
    [selectedPlacements, shownAt]
  );

  /** Line the selection up (2+). Only devices that actually move are sent;
   *  resolves to the positions they replaced (undo), or null. */
  const alignSelected = useCallback(
    async (mode: AlignMode) => {
      if (selectedPlacements.length < 2) return null;
      const before = selectionPositions();
      const moves = changedMoves(before, alignPositions(before, mode));
      if (!moves.length) return null;
      return commitMoves(moves, `Aligned ${countNoun(selectedPlacements)} ${ALIGN_WORDS[mode]}`, "align");
    },
    [selectedPlacements, selectionPositions, commitMoves]
  );

  /** Space the selection evenly along one axis (3+); the end devices stay. */
  const distributeSelected = useCallback(
    async (axis: "x" | "y") => {
      if (selectedPlacements.length < 3) return null;
      const before = selectionPositions();
      const moves = changedMoves(before, distributePositions(before, axis));
      if (!moves.length) return null;
      return commitMoves(moves, `Distributed ${countNoun(selectedPlacements)} ${axis === "x" ? "horizontally" : "vertically"}`, "distribute");
    },
    [selectedPlacements, selectionPositions, commitMoves]
  );

  /** Label (or clear, with "") every visible selected device. Devices that
   *  already carry the label are left alone. Resolves to the previous
   *  categories (undo), or null when nothing was written. */
  const setCategoryForSelected = useCallback(
    async (category: string) => {
      const want = normalizeCategory(category) ?? "";
      const items = selectedPlacements
        .filter((pl) => (normalizeCategory(pl.category) ?? "") !== want)
        .map((pl) => ({ id: pl.id, category: want }));
      if (!items.length) return null;
      if (!(await flushNudge())) return null;
      setErr(null);
      setBusy(true);
      try {
        const r = await setPlacementsCategoryAction(project.id, items);
        if (!r.ok) {
          setErr(r.error);
          return null;
        }
        noteAction(want ? `Set category ${want} on ${countNoun(selectedPlacements)}` : `Cleared the category on ${countNoun(selectedPlacements)}`);
        record({ label: stepLabel("set category", items.length), forward: { kind: "category", items }, inverse: { kind: "category", items: r.previous } });
        router.refresh();
        return r.previous;
      } catch {
        setErr(SAVE_FAILED);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [selectedPlacements, project.id, router, noteAction, flushNudge, record]
  );

  /** Swap the part on every visible selected device. Curtains can't change
   *  part (the server refuses the whole batch), so a selection holding one
   *  sends nothing. Resolves to the previous partIds (undo), or null. */
  const replacePartForSelected = useCallback(
    async (partId: string) => {
      if (!partId || selectedPlacements.some((pl) => pl.curtain)) return null;
      const items = selectedPlacements.filter((pl) => pl.partId !== partId).map((pl) => ({ id: pl.id, partId }));
      if (!items.length) return null;
      if (!(await flushNudge())) return null;
      setErr(null);
      setBusy(true);
      try {
        const r = await replacePlacementsPartAction(project.id, items);
        if (!r.ok) {
          setErr(r.error);
          return null;
        }
        noteAction(`Replaced ${countNoun(selectedPlacements)} with ${partLabel(partId)}`);
        record({ label: stepLabel("replace part", items.length), forward: { kind: "part", items }, inverse: { kind: "part", items: r.previous } });
        router.refresh();
        return r.previous;
      } catch {
        setErr(SAVE_FAILED);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [selectedPlacements, project.id, router, noteAction, partLabel, flushNudge, record]
  );

  /* ------------------------- clipboard (#299) ------------------------- */

  /** The copied devices. The ref is what handlers read (duplicate copies
   *  and pastes in one go, before a re-render); the state mirrors it so the
   *  toolbar's Paste enables. Both live in the hook, which survives option
   *  and sheet switches, so a copy carries across them within the tab. */
  const clipRef = useRef<Clipboard | null>(null);
  const [clipboard, setClipboardState] = useState<Clipboard | null>(null);
  /** Where the last paste landed (its top-left), so pasting again steps
   *  down-right instead of stacking. Reset by every new copy. */
  const lastPasteRef = useRef<Point | null>(null);
  /** The pointer position that placed the last paste: a second ⌘V with the
   *  pointer still there steps by the offset instead of stacking. */
  const lastPasteCursorRef = useRef<Point | null>(null);

  /** Where the clipboard's devices came from (their bounding-box top-left)
   *  and whether the copy was a cut, so a first paste with no pointer can
   *  land back at the source: exactly in place after a cut, one step down-
   *  right after a copy. Set with the clip; ⌘D never touches it. */
  const clipOriginRef = useRef<{ origin: Point; fromCut: boolean } | null>(null);

  /** Snapshot the visible selection, at the positions it is shown at (a
   *  pending nudge included). Pure: writes no clipboard state. */
  const snapshotSelection = useCallback((): { clip: Clipboard; origin: Point } | null => {
    if (!selectedPlacements.length) return null;
    const ids = new Set(selectedPlacements.map((pl) => pl.id));
    const shown = placements.map((pl) => (ids.has(pl.id) ? { ...pl, ...shownAt(pl) } : pl));
    const clip = copySelection(project.id, shown, routes, [...ids]);
    if (!clip) return null;
    const pts = selectedPlacements.map(shownAt);
    return { clip, origin: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) } };
  }, [selectedPlacements, placements, routes, shownAt, project.id]);

  /** Make `snap` the clipboard (a new copy resets the paste stepping). */
  const commitCopy = useCallback((snap: { clip: Clipboard; origin: Point }, fromCut: boolean) => {
    clipRef.current = snap.clip;
    clipOriginRef.current = { origin: snap.origin, fromCut };
    setClipboardState(snap.clip);
    lastPasteRef.current = null;
    lastPasteCursorRef.current = null;
  }, []);

  /** ⌘C / toolbar Copy. */
  const copySelected = useCallback(() => {
    const snap = snapshotSelection();
    if (!snap) return;
    commitCopy(snap, false);
    noteAction(`Copied ${countNoun(selectedPlacements)}`);
  }, [snapshotSelection, commitCopy, noteAction, selectedPlacements]);

  /** ⌘X / toolbar Cut: copy, then remove (one write). The clipboard is only
   *  replaced once the removal went through. Resolves to what undo needs to
   *  put the devices back, or null. */
  const cutSelected = useCallback(async (): Promise<RemovedBundle | null> => {
    if (busy || !selectedPlacements.length) return null;
    const cut = selectedPlacements;
    const snap = snapshotSelection();
    if (!snap) return null;
    const removed = await removeSelectedAs("Cut");
    if (removed) {
      commitCopy(snap, true);
      noteAction(`Cut ${countNoun(cut)}`);
    }
    return removed;
  }, [busy, selectedPlacements, snapshotSelection, commitCopy, removeSelectedAs, noteAction]);

  /** Lay `clip` onto the active sheet/page/option and select the copies.
   *  Wires come along only onto the page they were copied from. */
  const pasteClip = useCallback(
    async (
      clip: Clipboard,
      at: Point | null,
      last: Point | null,
      verb: string,
      /** remember: set the last-paste anchor ⌘V steps from (false for ⌘D,
       *  which leaves the clipboard alone). exact: skip the snap (a cut put
       *  back where it was). */
      opts: { remember?: boolean; exact?: boolean } = {}
    ): Promise<{ placements: GridPlacement[]; routes: GridRoute[] } | null> => {
      const { remember = true, exact = false } = opts;
      if (!sheet || busy) return null;
      if (!(await flushNudge())) return null;
      // With snap on, a step smaller than one grid cell would round straight
      // back onto the last paste — step at least one cell instead.
      const step =
        snap && !at && last
          ? { x: last.x + Math.max(0, snap.stepX - PASTE_OFFSET), y: last.y + Math.max(0, snap.stepY - PASTE_OFFSET) }
          : last;
      const laid = pasteLayout(clip, at, step);
      let anchor = laid.anchor;
      if (snap && !exact) {
        const { dx, dy } = snapDelta(anchor, anchor, snap);
        const w = Math.max(0, ...clip.items.map((i) => i.dx));
        const h = Math.max(0, ...clip.items.map((i) => i.dy));
        anchor = { x: Math.min(Math.max(anchor.x + dx, 0), 1 - w), y: Math.min(Math.max(anchor.y + dy, 0), 1 - h) };
      }
      const samePage = clip.sourceProjectId === project.id && clip.sourceSheetId === sheet.id && clip.sourcePage === page;
      const routeIds = samePage ? clip.routeIds : [];
      const dropped = clip.routeIds.length - routeIds.length;
      const items = clip.items.map((it) => {
        const out: { srcId: string; x: number; y: number; partId: string; category?: string; curtain?: CurtainInput; qty?: number } = {
          srcId: it.srcId,
          x: anchor.x + it.dx,
          y: anchor.y + it.dy,
          partId: it.partId,
        };
        if (it.category !== undefined) out.category = it.category;
        if (it.qty !== undefined) out.qty = it.qty;
        // The full curtain record; the server re-checks every field.
        if (it.curtain) out.curtain = { ...it.curtain };
        return out;
      });
      setErr(null);
      setBusy(true);
      try {
        const r = await pastePlacementsAction(project.id, { sheetId: sheet.id, page, optionId: activeOptionId, items, routeIds });
        if (!r.ok) {
          setErr(r.error);
          return null;
        }
        if (remember) lastPasteRef.current = anchor;
        setSelectedIds(r.placements.map((pl) => pl.id));
        setCategoryDraft(null);
        setSelectedSpaceId(null);
        setSelectedRouteId(null);
        const skipped = r.skippedWires + dropped;
        noteAction(`${verb} ${countNoun(r.placements)}${skipped > 0 ? ` · ${skipped} wire${skipped === 1 ? "" : "s"} skipped` : ""}`);
        // Undo removes the pasted devices; wires the paste drew stay (v1).
        recordPlace(stepLabel(verb === "Duplicated" ? "duplicate" : "paste", r.placements.length), r.placements);
        router.refresh();
        return { placements: r.placements, routes: r.routes };
      } catch {
        setErr(SAVE_FAILED);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [sheet, busy, flushNudge, snap, project.id, page, activeOptionId, noteAction, router, recordPlace]
  );

  /** ⌘V / toolbar Paste: at the pointer when it is over the plan (and has
   *  moved since the last paste), else stepped from the last paste, else
   *  (first paste, same sheet and page as the source) back at the source —
   *  in place after a cut, one step down-right after a copy — else centred.
   *  Resolves to what was created (undo), or null. */
  const paste = useCallback(async () => {
    const clip = clipRef.current;
    if (!clip) return null;
    const cur = cursorAtRef.current;
    const prev = lastPasteCursorRef.current;
    const at = cur && !(prev && prev.x === cur.x && prev.y === cur.y) ? cur : null;
    const src = clipOriginRef.current;
    const atSource =
      !at && !lastPasteRef.current && src && sheet && clip.sourceProjectId === project.id && clip.sourceSheetId === sheet.id && clip.sourcePage === page;
    let r;
    if (atSource && src.fromCut) r = await pasteClip(clip, src.origin, null, "Pasted", { exact: true });
    else if (atSource) r = await pasteClip(clip, null, src.origin, "Pasted");
    else r = await pasteClip(clip, at, lastPasteRef.current, "Pasted");
    if (r && cur) lastPasteCursorRef.current = { ...cur };
    return r;
  }, [pasteClip, sheet, project.id, page]);

  /** ⌘D / toolbar Duplicate: paste the selection one step down-right of its
   *  own bounding-box origin. The clipboard, ⌘V's last-paste anchor and its
   *  pointer memory are left alone; the new copies become the selection, so
   *  repeating steps on from them. Resolves to what was created, or null. */
  const duplicate = useCallback(async () => {
    if (busy || !selectedPlacements.length) return null;
    const snap = snapshotSelection();
    if (!snap) return null;
    return pasteClip(snap.clip, null, snap.origin, "Duplicated", { remember: false });
  }, [busy, selectedPlacements, snapshotSelection, pasteClip]);

  /* ------------------------- undo / redo (#299 slice 6) ------------------------- */

  /** Run one recorded command through the batch actions (all-or-nothing).
   *  A refusal comes back as `{ ok: false }`; a throw propagates. A remove
   *  hands back the fresh bundle so the other side of the entry can be
   *  refreshed (withRefreshedRestore). */
  const runCommand = useCallback(
    async (c: GridCommand): Promise<{ ok: true; bundle?: RemovedBundle } | { ok: false; error: string }> => {
      switch (c.kind) {
        case "move": {
          // Optimistic, like any move — and it also overwrites a stale
          // override from the original move, which would otherwise wake up
          // the moment the server copy returns to that override's `base`.
          const servers = new Map(placements.map((q) => [q.id, q]));
          const known = c.moves.filter((m) => servers.has(m.id));
          setMovedLocal((prev) => {
            const next = { ...prev };
            for (const m of known) {
              const server = servers.get(m.id)!;
              next[m.id] = { at: { x: m.x, y: m.y }, base: { x: server.x, y: server.y } };
            }
            return next;
          });
          const rollBack = () =>
            setMovedLocal((prev) => {
              const next = { ...prev };
              for (const m of known) delete next[m.id];
              return next;
            });
          try {
            const r = await movePlacementsAction(project.id, c.moves);
            if (!r.ok) {
              rollBack();
              return r;
            }
          } catch (e) {
            rollBack();
            throw e;
          }
          router.refresh();
          return { ok: true };
        }
        case "remove": {
          const r = await removePlacementsAction(project.id, c.ids);
          if (!r.ok) return r;
          const gone = new Set(c.ids);
          setSelectedIds((prev) => prev.filter((id) => !gone.has(id)));
          router.refresh();
          return { ok: true, bundle: r.removed };
        }
        case "restore": {
          const r = await restoreItemsAction(project.id, c.bundle);
          if (!r.ok) return r;
          // What came back is selected, the way a paste selects its copies.
          setSelectedIds(c.bundle.placements.map((pl) => pl.id));
          setSelectedSpaceId(null);
          setSelectedRouteId(null);
          router.refresh();
          return { ok: true };
        }
        case "category": {
          const r = await setPlacementsCategoryAction(project.id, c.items);
          if (!r.ok) return r;
          router.refresh();
          return { ok: true };
        }
        case "part": {
          const r = await replacePlacementsPartAction(project.id, c.items);
          if (!r.ok) return r;
          router.refresh();
          return { ok: true };
        }
      }
    },
    [placements, project.id, router]
  );

  /** Undo (dir "undo") or redo (dir "redo") one step. A pending nudge is
   *  written first, so ⌘Z right after an arrow press undoes that nudge. A
   *  refusal means the design changed under the stack: say so and clear it.
   *  A throw (connection) keeps the stack — it may work on a retry. */
  const step = useCallback(
    async (dir: "undo" | "redo") => {
      if (busy || drag || stepping.current) return;
      stepping.current = true;
      try {
        if (!(await flushNudge())) return;
        const taken = dir === "undo" ? takeUndo(undoRef.current) : takeRedo(undoRef.current);
        if (!taken) return;
        const { entry, next } = taken;
        setErr(null);
        setCategoryDraft(null);
        setBusy(true);
        try {
          const r = await runCommand(dir === "undo" ? entry.inverse : entry.forward);
          if (!r.ok) {
            setErr(dir === "undo" ? UNDO_STALE : REDO_STALE);
            commitUndo(emptyUndo());
            dropMoveOverrides();
            // Show the design as it is now (the other edit that broke the step).
            router.refresh();
            return;
          }
          let after = next;
          if (r.bundle) {
            // A remove just ran: the entry's other side restores the records
            // as the server had them a moment ago.
            if (dir === "undo") {
              const [moved, ...rest] = next.future;
              after = { ...next, future: [withRefreshedRestore(moved, r.bundle, "forward"), ...rest] };
            } else {
              const last = next.past[next.past.length - 1];
              after = { ...next, past: [...next.past.slice(0, -1), withRefreshedRestore(last, r.bundle, "inverse")] };
            }
          }
          commitUndo(after);
          noteAction(`${dir === "undo" ? "Undid" : "Redid"} ${entry.label}`);
        } catch {
          setErr(SAVE_FAILED);
        } finally {
          setBusy(false);
        }
      } finally {
        stepping.current = false;
      }
    },
    [busy, drag, flushNudge, runCommand, commitUndo, dropMoveOverrides, noteAction, router]
  );
  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);
  // A nudge still inside its debounce counts: undo writes it (recording it)
  // and then undoes that step.
  const canUndo = undoState.past.length > 0 || nudgePending > 0;
  const canRedo = undoState.future.length > 0;
  /** The step each button would take, for its tooltip ("Undo move (3 devices)"). */
  const undoLabel =
    nudgePending > 0 ? stepLabel("nudge", nudgePending) : undoState.past.length ? undoState.past[undoState.past.length - 1].label : null;
  const redoLabel = undoState.future.length ? undoState.future[0].label : null;

  // Tool shortcuts (#299): V/P/W/S/H pick a tool, Escape drops back to
  // select with nothing selected, Delete/Backspace removes every selected
  // device. Same guards as the arrow-key nudge: never while typing, never
  // under a dialog or a data-no-nudge element, never with a modifier.
  useEffect(() => {
    // #318: never under the Adjust sheet dialog — a click on a control that then
    // disables drops focus to <body>, outside [role="dialog"].
    if (adjustOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (t?.closest('[role="dialog"], [data-no-nudge]')) return;
      // ⌘A / Ctrl+A (#299): select every visible device on this sheet/page.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
        if (view !== "plan") return;
        e.preventDefault();
        if (tool !== "select") return;
        setSelectedIds(visiblePlacements.map((pl) => pl.id));
        setCategoryDraft(null);
        setSelectedSpaceId(null);
        setSelectedRouteId(null);
        return;
      }
      // ⌘Z undo; ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo (#299 slice 6). Inside a
      // text field the browser's own text undo wins (the guards above).
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        const isUndo = k === "z" && !e.shiftKey;
        const isRedo = (k === "z" && e.shiftKey) || (k === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey);
        if (isUndo || isRedo) {
          if (view !== "plan") return;
          // A pending (unwritten) nudge is something to undo too.
          if (isUndo ? !undoRef.current.past.length && !pendingNudge.current?.length : !undoRef.current.future.length) return;
          e.preventDefault();
          if (busy || drag) return;
          void (isUndo ? undo() : redo());
          return;
        }
      }
      // ⌘C/⌘X/⌘V/⌘D (Ctrl on Windows) — copy, cut, paste, duplicate (#299).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "c" || k === "x" || k === "v" || k === "d") {
          if (view !== "plan") return;
          if (k === "c" || k === "x") {
            // Highlighted page text, or nothing selected: the browser's own copy.
            if (!selectedPlacements.length || window.getSelection()?.toString()) return;
            e.preventDefault();
            if (k === "c") copySelected();
            else if (!busy && !drag) void cutSelected();
            return;
          }
          if (k === "v" && !clipRef.current) return;
          // ⌘D would bookmark the page — always ours on the plan.
          e.preventDefault();
          if (e.repeat || busy || drag) return;
          if (k === "v") void paste();
          else if (selectedPlacements.length) void duplicate();
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        disarm();
        return;
      }
      // #299: Spreadsheet view hides the plan — the tool keys and Delete
      // would act on a plan nobody can see. Escape (above) still clears.
      if (view !== "plan") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedPlacements.length || busy || drag) return;
        e.preventDefault();
        void removeSelected();
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
  }, [disarm, enterTool, removeSelected, selectedPlacements, busy, drag, armedPartId, sheet, view, tool, visiblePlacements, copySelected, cutSelected, paste, duplicate, undo, redo, adjustOpen]);

  return {
    router,
    estimateLink,
    estimateTray,
    intakeNotices,
    blobUploads,
    project,
    symbolDisplay,
    setSymbolScale,
    setSymbolMode,
    symbolUrls,
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
    setFavorites,
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
    movedLocal,
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
    snapOn,
    setSnapOn,
    snapFt,
    setSnapFt,
    snap,
    snapStatus,
    snapIssue,
    selectedIds,
    setSelectedIds,
    selectedPlacements,
    marquee,
    cancelGesture,
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
    clearCalibration,
    needsPart,
    hiddenUnmapped,
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
    schedule,
    refillScope,
    setRefillScope,
    switchSheet,
    goToPage,
    applyZoom,
    setVenue,
    deleteDesign,
    removeSelected,
    alignSelected,
    distributeSelected,
    setCategoryForSelected,
    replacePartForSelected,
    clipboard,
    copySelected,
    cutSelected,
    paste,
    duplicate,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    undo,
    redo,
    record,
    onStructuralChange,
    adjustTarget,
    adjustOpen,
    adjustAfterUpload,
    adjustQueue,
    adjustLocks,
    openAdjust,
    closeAdjust,
    skipRestAdjust,
    finishAdjust,
    adjustAvailability,
  };
}

export type GridEditor = ReturnType<typeof useGridEditorImpl>;
export const useGridEditor = useGridEditorImpl;
