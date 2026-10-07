import {
  getDoc,
  getDocRows,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { calibrationScale, clamp01, findCalibration, type Calibration, type Point } from "@/lib/annotations";
import type { GridCurtain } from "@/lib/design/grid-bom";
import {
  copyOptionMembers,
  DEFAULT_OPTION_ID,
  defaultOptionId,
  ensureOptions,
  hasOption,
  syncQuoteMirror,
  type GridOption,
} from "@/lib/design/grid-options";
export type { GridOption } from "@/lib/design/grid-options";
import {
  cleanRiserRemoved,
  copyRiserDoc,
  normalizeRiserDoc,
  pruneRisers,
  restoreRiserItems,
  riserRemovedBetween,
  type RiserDoc,
  type RiserRemoved,
} from "@/lib/design/grid-riser-doc";
import { cleanDrawingSet, type DrawingSetSettings } from "@/lib/design/grid-drawing-set";
import { cleanSymbolDisplay, type SymbolDisplay } from "@/lib/design/grid-symbol-display";
export type { RiserDoc } from "@/lib/design/grid-riser-doc";
export type { DrawingSetSettings } from "@/lib/design/grid-drawing-set";
import {
  applyCustomItemSave,
  copyCustomItems,
  customItemsOf,
  withoutCustomItem,
  type GridCustomItem,
} from "@/lib/design/grid-custom-items";
import {
  accessoriesOf,
  applyAccessorySave,
  copyAccessories,
  withoutAccessory,
  type GridAccessory,
} from "@/lib/design/grid-accessories";
import { applyLaborOverride, LABOR_OVERRIDE_MAX, sanitizeLaborOverrides } from "@/lib/design/wire-labor";
import { isBomGroupKey } from "@/lib/design/grid-bom-groups";
import { getGridSymbol } from "@/lib/stores/grid-catalog";
import { get as getCatalogPart } from "@/lib/stores/catalog";
import { liveRenameRefs } from "@/lib/stores/catalog-renames";
import { rewriteGridProjectLive } from "@/lib/catalog-rename/rewrite";
import { isFabricPart } from "@/lib/fabric-part";
import { compute, VENUES, type AState, type QuickScopeInputs, type SysKey, type TierKey, type VenueKind } from "@/app/(app)/design/quick/engine";
import { arenaGeom, blackboxGeom, buildPlan, churchGeom, planTemplate, prosGeom, renderPlanSvgMarkup } from "@/app/(app)/design/quick/plan-svg";
import { templateEntry } from "@/lib/design/venue-templates";
import { familyDims } from "@/lib/design/venue-templates/house-dims";
import { stretchById } from "@/lib/design/venue-templates/templates";
import {
  autoEstimatesOf,
  cleanLotQty,
  sanitizeAutoEstimate,
  sanitizeAutoTag,
  withoutAuto,
  type AutoEstimate,
  type AutoEstimates,
  type AutoOrigin,
  type AutoTag,
} from "@/lib/design/grid-auto-model";
export type { AutoEstimate, AutoEstimates, AutoOrigin, AutoTag } from "@/lib/design/grid-auto-model";

/**
 * The Grid (D108) — system-design projects: plan sheets, painted catalog
 * devices, per-page scale calibration, and the draft-quote link. First slice
 * of the DaVinci-style designer (DEC-PSD-2: plan layout + live BOM → quote).
 *
 * Two collections, deliberately:
 * - `grid_projects` — the light, frequently patched document (every device
 *   placement is a patch). Never holds file bytes.
 * - `grid_sheets` — one doc per uploaded plan background (dataUrl). Written
 *   once, read on open. Keeping these out of the project doc is the D95
 *   lesson: a 1.2 MB background inline would make every placement rewrite
 *   megabytes of JSONB.
 *
 * Neither collection is sync-pushable (doc-tables.ts): placements feed
 * quotes, so writes go through permission-checked server actions only.
 *
 * Geometry follows lib/annotations: normalized 0..1 points; Calibration is
 * reused with `docId` = sheet id, so findCalibration/measureLength work
 * unchanged.
 */

export type GridPlacement = {
  id: string; // 'gp-' + random
  sheetId: string;
  /** 1-based PDF page; images are always page 1. */
  page: number;
  /** Normalized 0..1 against the page box. */
  x: number;
  y: number;
  /** Catalog SKU (catalog_parts doc id). On a curtain placement this is the
   *  FABRIC row's id - the curtain's only catalog link. */
  partId: string;
  /**
   * User-defined category (punch #48 / #41) - an open-ended free-text label,
   * assigned now and consumed later. Orthogonal to the computed scope and to
   * Spaces: a placement may carry none, and nothing validates the vocabulary.
   * Absent on every pre-#48 placement, read as "no category".
   */
  category?: string;
  /**
   * Curtain spec (punch #49) - present only on a curtain drop-in. A curtain
   * is a priced line, not a catalog unit: it is sized and specced here and
   * priced from fullness + fabric through the shared curtain model, landing
   * on the BOM as its own line.
   */
  curtain?: GridCurtain;
  /** Option membership (Spec 1, options model). Absent on pre-spec
   *  placements — read as the project's first option (ensureOptions). */
  optionId?: string;
  /**
   * Set only on a placement created by the "generate starting layout"
   * seeding action (#38 Task 2, D14x) — a stable key identifying which
   * computed system-function instance this is (e.g. "lighting:par:2"), so
   * a re-run can tell what it already seeded apart from anything hand-
   * placed or hand-moved, and add only the delta instead of re-seeding
   * blindly or silently replacing. Absent on every hand-placed placement
   * and every pre-Task-2 doc, read as "not a seeded placement". Never
   * cleared by a move/category edit — a seeded device dragged elsewhere is
   * still the same seeded instance.
   */
  seededFrom?: string;
  /**
   * Lot quantity (#211, D306): one marker standing for `qty` units of its
   * part — Auto lands count/length hardware (pipe, cable, arbors …) this way.
   * Absent = 1. The BOM, schedule, riser and space rollups multiply by
   * placementQty(); labor suggestions count the marker once.
   */
  qty?: number;
  /**
   * Auto-fill tag (#211, spec §5): set on a placement the Auto intake or a
   * per-scope "Change equipment…" re-fill painted. Any move or category edit
   * deletes it, so a hand-touched device is kept by every later re-fill.
   */
  auto?: AutoTag;
  /**
   * D320: set when a hand edit cleared `auto` — the scope + row the
   * device was painted for. Not an auto tag (re-fills keep the device), but
   * a re-fill of that scope counts its units toward the row's quantity.
   */
  autoOrigin?: AutoOrigin;
  by: string;
  at: number;
};

/**
 * A room polygon on one page of one sheet (Phase 2, D109). Which devices
 * belong to it is COMPUTED (grid-geometry.spaceOf, smallest-wins), never
 * stored — redrawing a space reassigns instantly and deletion can't strand
 * stale ids on placements.
 */
export type GridSpace = {
  id: string; // 'sp-' + random
  sheetId: string;
  page: number;
  name: string;
  color: string;
  /** Normalized 0..1 polygon vertices, ≥3. */
  points: Point[];
  by: string;
  at: number;
};

/**
 * Append-only snapshot of the design's mutable state (Phase 2, D109) —
 * the QuoteRevision idiom. Sheets are referenced, not copied: sheet docs
 * are immutable once uploaded, and restore deliberately does NOT touch
 * sheetIds so recalling an old layout can never orphan a since-added sheet.
 */
export type GridRevision = {
  rev: number; // 1-based
  at: number;
  by: string;
  /** manual save · auto-cut when a quote is minted/updated · restore bookkeeping. */
  reason: "manual" | "quote" | "restore";
  note: string;
  name: string;
  sheetIds: string[];
  placements: GridPlacement[];
  calibrations: Calibration[];
  spaces: GridSpace[];
  /** Absent on pre-D110 snapshots — read as []. */
  routes?: GridRoute[];
  /** Option list at snapshot time (Spec 1). Absent on older snapshots —
   *  restore normalizes to a single default option. */
  options?: GridOption[];
  /** Riser documents at snapshot time (#209). Absent on older snapshots —
   *  restore then drops back to the auto layout. */
  riser?: Record<string, RiserDoc>;
  /** Auto intake choices per option at snapshot time (#211, D312).
   *  Absent on older snapshots — restore then clears them. */
  autoEstimate?: AutoEstimates;
};

/**
 * A wire run (Phase 3, D110): a polyline on one page carrying a per-length
 * catalog part. `aspect` (page height/width) is stamped at draw time so the
 * real length — polylineLength(points, aspect) × calibration.scale — is
 * recomputable anywhere without reopening the sheet. Recalibrating the page
 * reprices every wire on it instantly; nothing is denormalized.
 */
export type GridRoute = {
  id: string; // 'wr-' + random
  sheetId: string;
  page: number;
  /** Per-length catalog part (unit ft / lin ft / …). */
  partId: string;
  /** Normalized 0..1 waypoints, ≥2. */
  points: Point[];
  aspect: number;
  by: string;
  at: number;
  /** Device-wire endpoints (Task 4, punch #39) — set when both waypoints
   *  snapped onto a placed device at draw time. Absent on a free route. */
  fromPlacementId?: string;
  toPlacementId?: string;
  /** Validated shared connectionType (catalog-connect.validateDeviceWire),
   *  stamped only when both endpoint devices carry `ports`. */
  connectionType?: string;
  /** Option membership (Spec 1) — see GridPlacement.optionId. */
  optionId?: string;
};

export type GridProject = {
  id: string; // GRD-#### from base 5001
  name: string;
  customer: string;
  customerId: string | null;
  /** Venue link (D113 item 6) — identity sites.id + display name. */
  siteId?: string | null;
  siteName?: string;
  /** The customer contact this design is for (#244) — a NAME, as on a quote
   *  (contacts have no id). Absent on pre-#244 docs, read as "". */
  contactName?: string;
  /** Cover-page intake captured before the drawing workspace opens. */
  intake?: {
    complete: boolean;
    measurementBased: boolean;
    /** Chosen at intake (Spec 1). Absent on pre-spec docs. Only "manual" is
     *  reachable until Spec 2. */
    mode?: "auto" | "manual";
    venueName: string;
    locationName: string;
    address: string;
    notes: string;
    /** Shared Quick Design inputs; the Grid editor is their manual-layout workspace. */
    autoConfig?: AState;
    /** #249/#255: the venue template id that drew the generated base sheet ("proscenium@1", "church-traditional@1", …); absent = a pre-template schematic. */
    baseSheetTemplate?: string;
    /** #255: where the sheet's movable rooms were drawn (wall + 0..1); the sheet never moves them afterwards. */
    baseSheetMovables?: Record<string, { wall: string; t: number }>;
  };
  /** Sheet display order; the docs live in grid_sheets. */
  sheetIds: string[];
  placements: GridPlacement[];
  calibrations: Calibration[];
  /** Room polygons (Phase 2) — absent on pre-D109 docs, read as []. */
  spaces?: GridSpace[];
  /** Wire runs (Phase 3) — absent on pre-D110 docs, read as []. */
  routes?: GridRoute[];
  /** Append-only snapshots (Phase 2) — absent on pre-D109 docs. */
  revisions?: GridRevision[];
  /** Design options (Spec 1) — variants sharing this project's sheets.
   *  Absent on pre-spec docs; every read passes through ensureOptions, so
   *  callers may treat this as always ≥1 entry. `quoteId` below mirrors
   *  options[0].quoteId. */
  options?: GridOption[];
  /** Draft quote minted from this design, when one exists. */
  quoteId: string | null;
  /** Optional saved Lineset Builder design used by the derived schedule. */
  linesetDesignId?: string | null;
  /** Live-revisable basic-info snapshot (D-manual-scope-targets) — venue,
   *  size, dimensions, systems-in-scope. `null` until the Scope panel's
   *  inputs are filled in at least once; never a one-time creation step, it
   *  stays editable for the project's life and target $ is always computed
   *  fresh from whatever this currently holds. Absent on pre-D-manual-scope
   *  docs, read as null. */
  scopeInputs?: QuickScopeInputs | null;
  /** Auto intake choices PER OPTION (#211, D312): option id → tier per
   *  scope + per-row swaps/qty. Absent on Blank designs. A doc written before
   *  D312 holds one bare AutoEstimate — always read through
   *  autoEstimatesOf()/autoEstimateFor(), which treat it as the first option's. */
  autoEstimate?: AutoEstimates | AutoEstimate;
  /** Saved riser document per option id (#209) — node layout, level lines,
   *  conduit annotations, riser notes and RiserLinks. Absent = auto layout. */
  riser?: Record<string, RiserDoc>;
  /** Drawing-set settings (#209) — size, drawn/checked by, excluded sheets,
   *  general notes, revision labels. Absent = defaults. */
  drawingSet?: DrawingSetSettings;
  /** Symbol scale + generic/object mode for this design (#300); absent = default. */
  symbolDisplay?: SymbolDisplay;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type GridSheet = {
  id: string; // 'gs-' + random
  projectId: string;
  name: string;
  mime: string;
  /** Base64 payload — empty when the file lives in Blob storage (D116). */
  dataUrl: string;
  /** Blob URL — provenance only; the store is private, reads go through
   *  the authenticated /api/grid-sheets/<id> proxy (D116). */
  url?: string;
  /** Blob pathname the proxy streams by (set together with url). */
  blobPath?: string;
  addedBy: string;
  at: number;
};

function rid(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** All live projects, newest activity first. */
export async function listProjects(): Promise<GridProject[]> {
  const list = await listDocs<GridProject>("grid_projects");
  return list.map((p) => ensureOptions(p)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(id: string): Promise<GridProject | null> {
  const p = await getDoc<GridProject>("grid_projects", id);
  return p ? ensureOptions(p) : null;
}

/** Live projects by id in ONE read (fix wave 3, I3) — a design list's
 *  linked projects, not one getDoc per design. Missing/deleted ids are absent. */
export async function getProjects(ids: readonly string[]): Promise<Map<string, GridProject>> {
  const rows = await getDocRows<GridProject>("grid_projects", ids);
  return new Map(rows.filter((r) => !r.deleted).map((r) => [r.id, ensureOptions(r.doc)] as const));
}

export async function createProject(input: {
  name: string;
  customer: string;
  customerId: string | null;
  by: string;
}): Promise<GridProject> {
  const t = Date.now();
  const project = await insertWithPrefixedId<GridProject>("grid_projects", "GRD", 5001, (id) => ({
    id,
    name: input.name.trim() || "Untitled system design",
    customer: input.customer.trim(),
    customerId: input.customerId,
    intake: { complete: false, measurementBased: true, venueName: "", locationName: "", address: "", notes: "" },
    sheetIds: [],
    placements: [],
    calibrations: [],
    spaces: [],
    routes: [],
    quoteId: null,
    scopeInputs: null,
    createdBy: input.by,
    createdAt: t,
    updatedAt: t,
  }));
  // Sheets/Spaces are deliberately NOT pre-seeded here (Task 1, #38). Every
  // new project opens straight into GridIntake (intake.complete starts
  // false) before anything is ever painted, so generating a starting sheet
  // here — before VenueDims exist — is exactly what made the old default
  // dims-blind. The first intake save generates the dims-derived plan
  // instead, via generateBaseSheet() (saveGridIntakeAction). Manual is the
  // only reachable mode until Spec 2's Auto-estimate lands, so the old
  // "I have my own plan, skip measurements" blank-sheet path (seedBlankSheet)
  // is gone (Spec 1, Task 6).
  return project;
}

/**
 * Starter Spaces for a generated base sheet (Task 1, #38 — D145; #249, #255).
 * A template-drawn sheet gets one Space per labeled area of its drawing, in
 * the keys' Space order, named by the area's display label and outlined from
 * the stretched drawing (the proscenium Pit only when on). Kinds without a
 * drawing keep the fixed-fraction Spaces (follow-up D145).
 */
export function starterSpaces(
  a: AState,
  kind: VenueKind,
  sheetId: string,
  tpl?: string | null
): Array<{ sheetId: string; page: number; name: string; points: Point[] }> {
  // Resolved exactly as buildPlan draws it (planTemplate: a known id as named, else the default of
  // `a`'s plan kind — the same kind the caller passes as `kind`).
  const id = planTemplate(a, tpl);
  const family = templateEntry(id)?.family;
  if (family) {
    const G = family === "church" ? churchGeom(a, id) : family === "blackbox" ? blackboxGeom(a, id) : family === "arena" ? arenaGeom(a, id) : prosGeom(a, id);
    const at = (p: Point): Point => ({ x: clamp01(p.x / G.W), y: clamp01(p.y / G.H) });
    return G.spaces.filter((rid) => G.regions[rid]).map((rid) => ({ sheetId, page: 1, name: G.regionLabels[rid] ?? rid, points: G.regions[rid].map(at) }));
  }
  return [
    { sheetId, page: 1, name: "Audience view", points: [{ x: 0.08, y: 0.58 }, { x: 0.92, y: 0.58 }, { x: 0.92, y: 0.9 }, { x: 0.08, y: 0.9 }] },
    { sheetId, page: 1, name: "Stage", points: [{ x: 0.2, y: 0.12 }, { x: 0.8, y: 0.12 }, { x: 0.8, y: 0.4 }, { x: 0.2, y: 0.4 }] },
    { sheetId, page: 1, name: "FOH / control", points: [{ x: 0.38, y: 0.44 }, { x: 0.62, y: 0.44 }, { x: 0.62, y: 0.53 }, { x: 0.38, y: 0.53 }] },
  ];
}

/**
 * Render a Grid base sheet directly from `VenueDims`/`AState` (Task 1, #38)
 * — the estimator's own plan-view geometry (`buildPlan`), correctly scaled,
 * with zero calibration step. Called once, from saveGridIntakeAction, the
 * first time intake completes with "Generate from measurements as I work"
 * checked.
 */
export async function generateBaseSheet(
  projectId: string,
  a: AState,
  accent: string,
  by: string,
  tpl?: string | null
): Promise<GridSheet | null> {
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const kind = venue.kind || "proscenium";
  // #255: the template the caller resolved (the design's effective Background). Resolved exactly as
  // buildPlan draws it (planTemplate: a known id as named, else the kind default), so the stamp,
  // calibration and Spaces always describe the drawing on the sheet.
  const id = planTemplate(a, tpl);
  const family = templateEntry(id)?.family;
  const { lineSets, electrics } = compute(a);
  const plan = buildPlan(a, lineSets, electrics, accent, id);
  const markup = renderPlanSvgMarkup(plan, accent);
  const sheet = await addSheet(projectId, {
    name: "Generated base plan",
    mime: "image/svg+xml",
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
    by,
  });
  if (!sheet) return null;

  // Auto-calibrate from the plan's own known geometry so nothing downstream
  // ever prompts for a calibration step on this sheet (Task 1 acceptance).
  // A proscenium template calibrates from its inner stage walls, exactly
  // pro width + 2 × wing apart (#249); a church template from the nave's
  // inside walls, exactly the nave width apart (#255). Every schematic
  // buildPlan* function's FIRST rect is the outer room/house floor — its
  // real-world width is the venue's full width in feet — a reference that
  // holds for the schematic kinds without their private margin constants.
  let scale: number | null = null;
  let refWidthFt = a.width;
  if (family === "proscenium") {
    // #249: the template's inner stage walls are exactly pro width + 2 × wing apart.
    const G = prosGeom(a, id);
    refWidthFt = G.dims.proWidthFt + 2 * G.dims.wingFt;
    scale = calibrationScale({ x: G.xWingL / plan.W, y: G.yBack / plan.H }, { x: G.xWingR / plan.W, y: G.yBack / plan.H }, plan.H / plan.W, refWidthFt);
  } else if (family === "church") {
    // #255: the nave's inside walls are exactly the nave width apart.
    const G = churchGeom(a, id);
    refWidthFt = G.dims.houseWidthFt;
    scale = calibrationScale({ x: G.naveL.x / plan.W, y: G.naveL.y / plan.H }, { x: G.naveR.x / plan.W, y: G.naveR.y / plan.H }, plan.H / plan.W, refWidthFt);
  } else if (family === "blackbox") {
    // #255: the room's inside walls are exactly its width apart.
    const G = blackboxGeom(a, id);
    refWidthFt = a.width;
    scale = calibrationScale({ x: G.room.x / plan.W, y: G.room.y / plan.H }, { x: (G.room.x + G.room.w) / plan.W, y: G.room.y / plan.H }, plan.H / plan.W, refWidthFt);
  } else if (family === "arena") {
    // #255: the floor's straight sides are exactly the floor width apart.
    const G = arenaGeom(a, id);
    refWidthFt = G.floorWidthFt;
    scale = calibrationScale({ x: G.floor.x / plan.W, y: (G.floor.y + G.floor.h / 2) / plan.H }, { x: (G.floor.x + G.floor.w) / plan.W, y: (G.floor.y + G.floor.h / 2) / plan.H }, plan.H / plan.W, refWidthFt);
  } else {
    const room = plan.rects[0];
    scale = room
      ? calibrationScale({ x: room.x / plan.W, y: room.y / plan.H }, { x: (room.x + room.w) / plan.W, y: room.y / plan.H }, plan.H / plan.W, refWidthFt)
      : null;
  }
  if (scale) {
    await setSheetCalibration(projectId, {
      docId: sheet.id,
      page: 1,
      scale,
      unit: "ft",
      refLength: refWidthFt,
      by,
      at: Date.now(),
    });
  }

  for (const sp of starterSpaces(a, kind, sheet.id, id)) {
    await addSpace(projectId, { ...sp, by });
  }
  if (id && family) {
    // #255: stamp the template and where its movable rooms sit on this sheet (a later intake edit never moves them).
    const placed = stretchById(id, familyDims(a, id)).movables;
    const movables = Object.fromEntries(Object.entries(placed).map(([k, m]) => [k, { wall: m.wall, t: m.t }]));
    await patchDoc<GridProject>("grid_projects", projectId, (p) => {
      if (!p.intake) return;
      p.intake.baseSheetTemplate = id;
      if (Object.keys(movables).length) p.intake.baseSheetMovables = movables;
    });
  }
  return sheet;
}

export async function saveGridIntake(
  projectId: string,
  input: NonNullable<GridProject["intake"]>
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.intake = { ...input, baseSheetTemplate: input.baseSheetTemplate ?? p.intake?.baseSheetTemplate, baseSheetMovables: input.baseSheetMovables ?? p.intake?.baseSheetMovables };
    p.updatedAt = Date.now();
  });
}

export async function setLinesetDesign(projectId: string, designId: string | null): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.linesetDesignId = designId;
    p.updatedAt = Date.now();
  });
}

/** Upload one plan background and append it to the project's sheet order.
 *  Exactly one of dataUrl/url should carry the file (the action decides —
 *  Blob when the token exists, in-database otherwise). */
export async function addSheet(
  projectId: string,
  input: {
    name: string;
    mime: string;
    dataUrl?: string;
    url?: string;
    blobPath?: string;
    by: string;
  }
): Promise<GridSheet | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const sheet: GridSheet = {
    id: rid("gs-"),
    projectId,
    name: input.name || "Plan sheet",
    mime: input.mime,
    dataUrl: input.dataUrl || "",
    ...(input.url ? { url: input.url } : {}),
    ...(input.blobPath ? { blobPath: input.blobPath } : {}),
    addedBy: input.by,
    at: Date.now(),
  };
  await upsertDoc<GridSheet>("grid_sheets", sheet);
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.sheetIds = [...(p.sheetIds || []), sheet.id];
    p.updatedAt = Date.now();
  });
  return sheet;
}

/** The project's sheets in display order. */
export async function listSheets(projectId: string): Promise<GridSheet[]> {
  const project = await getProject(projectId);
  if (!project) return [];
  const all = await listDocs<GridSheet>("grid_sheets");
  const mine = new Map(all.filter((s) => s.projectId === projectId).map((s) => [s.id, s]));
  return (project.sheetIds || [])
    .map((id) => mine.get(id))
    .filter((s): s is GridSheet => Boolean(s));
}

/**
 * Remove one sheet from the project's display order. Refuses when any LIVE
 * placement/space/route still references it — those would otherwise paint
 * against a background that's no longer reachable. Deliberately does NOT
 * softDeleteDoc the `grid_sheets` record: it stays a normal, readable doc
 * (dropped only from `sheetIds`), so an older GridRevision that still lists
 * this sheet in its own `sheetIds` can still resolve it by id through
 * getDoc/the /api/grid-sheets/<id> proxy the moment restoreRevision puts the
 * id back on the live list (see restoreRevision below — it re-adds a
 * removed sheet the revision being restored actually references). Hard-
 * deleting the doc or its blob would break that resolution outright.
 */
export async function removeSheet(
  projectId: string,
  sheetId: string
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "no-such-sheet" | "in-use" }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (!(project.sheetIds || []).includes(sheetId)) return { ok: false, reason: "no-such-sheet" };
  const inUse =
    (project.placements || []).some((pl) => pl.sheetId === sheetId) ||
    (project.spaces || []).some((sp) => sp.sheetId === sheetId) ||
    (project.routes || []).some((r) => r.sheetId === sheetId);
  if (inUse) return { ok: false, reason: "in-use" };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.sheetIds = (p.sheetIds || []).filter((id) => id !== sheetId);
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, reason: "not-found" };
}

export async function addPlacement(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; optionId: string; by: string }
): Promise<GridProject | null> {
  let refused = false;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) { refused = true; return; }
    p.placements = [
      ...(p.placements || []),
      {
        id: rid("gp-"),
        sheetId: input.sheetId,
        page: input.page,
        x: input.x,
        y: input.y,
        partId: input.partId,
        optionId: input.optionId,
        by: input.by,
        at: Date.now(),
      },
    ];
    p.updatedAt = Date.now();
  });
  return refused ? null : updated;
}

/**
 * Bulk device drop — the "generate starting layout" seeding action (#38
 * Task 2) writes dozens of placements in one call; `addPlacement()` above is
 * one `patchDoc` per item and would mean dozens of sequential JSONB rewrites
 * for a single user action. Every item lands on the same sheet/page (the
 * generated base sheet's page 1), so those are hoisted to call args instead
 * of repeated per-item.
 */
export async function addPlacements(
  projectId: string,
  input: {
    sheetId: string;
    page: number;
    optionId: string;
    items: Array<{ x: number; y: number; partId: string; category?: string; seededFrom?: string; qty?: number; auto?: AutoTag; curtain?: GridCurtain }>;
    by: string;
  }
): Promise<GridProject | null> {
  if (!input.items.length) return getProject(projectId);
  const at = Date.now();
  let refused = false;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) { refused = true; return; }
    const added: GridPlacement[] = input.items.map((item) => ({
      id: rid("gp-"),
      sheetId: input.sheetId,
      page: input.page,
      x: clamp01(item.x),
      y: clamp01(item.y),
      partId: item.partId,
      optionId: input.optionId,
      ...(item.category ? { category: item.category } : {}),
      ...(item.seededFrom ? { seededFrom: item.seededFrom } : {}),
      ...lotAndTag(item.qty, item.auto),
      ...(item.curtain ? { curtain: item.curtain } : {}),
      by: input.by,
      at,
    }));
    p.placements = [...(p.placements || []), ...added];
    p.updatedAt = at;
  });
  return refused ? null : updated;
}

export type AutoPlacementInput = { x: number; y: number; partId: string; qty?: number; curtain?: GridCurtain; auto: AutoTag };

/** Store-side clean of a written lot qty and auto tag (#211 M3): qty clamped
 *  to [2, AUTO_QTY_MAX] or dropped (absent = 1); the tag rebuilt from known
 *  scopes/rows/tiers or dropped. Never trusts a caller's raw value. */
function lotAndTag(qty: unknown, auto: unknown): { qty?: number; auto?: AutoTag } {
  const q = cleanLotQty(qty);
  const tag = auto === undefined ? null : sanitizeAutoTag(auto);
  return { ...(q !== undefined ? { qty: q } : {}), ...(tag ? { auto: tag } : {}) };
}

/**
 * Auto fill / per-scope re-fill (#211, spec §5), atomically in ONE patch:
 * every placement of `optionId` still carrying an `auto` tag in one of
 * `scopes` is removed (its riser links go with it, as removePlacement does),
 * then `items` (only those whose auto.scope is in `scopes`) are added.
 * Hand-touched devices (auto cleared) and other options are never touched.
 * null = the project or the option is gone.
 */
export async function replaceAutoPlacements(
  projectId: string,
  input: { optionId: string; scopes: SysKey[]; sheetId: string; page: number; items: AutoPlacementInput[]; by: string }
): Promise<{ removed: number; added: number } | null> {
  const at = Date.now();
  const scopes = new Set(input.scopes);
  let refused = false;
  let removed = 0;
  let added = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refused = true;
      return;
    }
    const gone = new Set<string>();
    const kept = (p.placements || []).filter((pl) => {
      const drop = pl.optionId === input.optionId && !!pl.auto && scopes.has(pl.auto.scope);
      if (drop) gone.add(pl.id);
      return !drop;
    });
    // An item whose tag doesn't sanitize is dropped: an untagged device
    // would survive every later re-fill as if a person had placed it.
    const fresh: GridPlacement[] = input.items.flatMap((it) => {
      const tag = sanitizeAutoTag(it.auto);
      if (!tag || !scopes.has(tag.scope)) return [];
      const q = cleanLotQty(it.qty);
      return [
        {
          id: rid("gp-"),
          sheetId: input.sheetId,
          page: input.page,
          x: clamp01(it.x),
          y: clamp01(it.y),
          partId: it.partId,
          optionId: input.optionId,
          ...(q !== undefined ? { qty: q } : {}),
          ...(it.curtain ? { curtain: it.curtain } : {}),
          auto: tag,
          by: input.by,
          at,
        },
      ];
    });
    p.placements = [...kept, ...fresh];
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    removed = gone.size;
    added = fresh.length;
    p.updatedAt = at;
  });
  return refused || !updated ? null : { removed, added };
}

/**
 * Persist (or clear, with null) ONE option's Auto intake choices (#211,
 * D312). The input is sanitized here, whatever the caller sent. A legacy
 * single stored value is migrated to the per-option map (as the first
 * option's) in the same patch. null = the project or the option is gone.
 */
export async function setAutoEstimate(projectId: string, optionId: string, est: AutoEstimate | null): Promise<GridProject | null> {
  const clean = est ? sanitizeAutoEstimate(est) : null;
  let refused = false;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, optionId)) {
      refused = true;
      return;
    }
    const all = autoEstimatesOf(p.autoEstimate, defaultOptionId(p));
    if (clean) all[optionId] = clean;
    else delete all[optionId];
    if (Object.keys(all).length) p.autoEstimate = all;
    else delete p.autoEstimate;
    p.updatedAt = Date.now();
  });
  return refused ? null : updated;
}

/**
 * Drop a curtain onto a plan (punch #49). It rides on the SAME placement list
 * as a device so every existing behavior - drag to move, arrow nudge, space
 * assignment, revisions, delete - applies to it with no second code path;
 * only the pricing and the BOM line differ, and those key off `curtain`.
 *
 * `partId` carries the fabric row so the marker, the revision snapshot and
 * the space rollup all keep a real catalog link, and bomLines/bomTotals skip
 * curtain placements so that fabric is never double-billed.
 */
export async function addCurtainPlacement(
  projectId: string,
  input: {
    sheetId: string;
    page: number;
    x: number;
    y: number;
    curtain: GridCurtain;
    category?: string;
    optionId: string;
    by: string;
  }
): Promise<GridProject | null> {
  let refused = false;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) { refused = true; return; }
    p.placements = [
      ...(p.placements || []),
      {
        id: rid("gp-"),
        sheetId: input.sheetId,
        page: input.page,
        x: input.x,
        y: input.y,
        partId: input.curtain.fabricSku,
        curtain: input.curtain,
        optionId: input.optionId,
        ...(input.category ? { category: input.category } : {}),
        by: input.by,
        at: Date.now(),
      },
    ];
    p.updatedAt = Date.now();
  });
  return refused ? null : updated;
}

/**
 * Set (or clear, with "") one placement's user-defined category (punch #48).
 * The empty label DELETES the key rather than storing "" - an absent category
 * and a blank one must not be two different things in the layer list.
 */
export async function setPlacementCategory(
  projectId: string,
  placementId: string,
  category: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = (p.placements || []).map((pl) => (pl.id === placementId ? withCategory(pl, category) : pl));
    p.updatedAt = Date.now();
  });
}

/** The one category rule (punch #48): trim, cap at 40 characters, and an
 *  empty label DELETES the key. A category edit is a hand edit, so it
 *  clears the #211 auto tag. Shared by the single and batch setters. */
function withCategory(pl: GridPlacement, category: string): GridPlacement {
  const label = category.trim().slice(0, 40);
  const next = withoutAuto({ ...pl });
  if (label) next.category = label;
  else delete next.category;
  return next;
}

/**
 * Move one placed device (punch #47). Coordinates only: a device stays on the
 * sheet/page it was painted on, because a wire run lives on exactly one page
 * and carrying a device across pages would strand the wires attached to it.
 *
 * Attached wires follow, atomically, in the same patch. `GridRoute.points` is
 * an INDEPENDENT polyline: `fromPlacementId`/`toPlacementId` record what a
 * run was drawn onto but nothing keeps the geometry in sync, so moving a
 * device without this would silently leave its wires hanging at the old spot
 * (and, since footage is measured off `points`, quoting the old length). The
 * endpoint is TRANSLATED by the same delta rather than snapped to the new
 * center, which preserves the small hand-drawn offset the wire was drawn with.
 *
 * Deliberately does NOT cut a revision: revisions are manual/quote/restore
 * (addRevision below), and a drag is a gesture, not a design decision.
 * A move clears the #211 auto tag, so a re-fill keeps the device.
 */
export async function movePlacement(
  projectId: string,
  placementId: string,
  to: { x: number; y: number }
): Promise<GridProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const current = (project.placements || []).find((pl) => pl.id === placementId);
  if (!current) return null;

  const x = clamp01(to.x);
  const y = clamp01(to.y);
  const dx = x - current.x;
  const dy = y - current.y;

  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = (p.placements || []).map((pl) =>
      pl.id === placementId ? withoutAuto({ ...pl, x, y }) : pl
    );
    // Guarded so a pre-D110 doc with no `routes` key doesn't grow an empty one.
    if (p.routes?.length)
      p.routes = translateRouteEnds(p.routes, new Map([[placementId, { sheetId: current.sheetId, page: current.page, dx, dy }]]));
    p.updatedAt = Date.now();
  });
}

type MoveDelta = { sheetId: string; page: number; dx: number; dy: number };

/** Attached wires follow a moved device (movePlacement's rule): each
 *  endpoint drawn onto a moved placement translates by THAT placement's
 *  delta — a run between two moved devices shifts each end by its own.
 *  Same sheet/page only: an endpoint id can't refer across pages, but a
 *  restored revision could carry a stale pairing, and shifting a polyline
 *  on another page would be worse than leaving it be. */
function translateRouteEnds(routes: GridRoute[], deltas: ReadonlyMap<string, MoveDelta>): GridRoute[] {
  const onPage = (r: GridRoute, id: string | undefined): MoveDelta | null => {
    const d = id ? deltas.get(id) : undefined;
    return d && r.sheetId === d.sheetId && r.page === d.page ? d : null;
  };
  return routes.map((r) => {
    const head = onPage(r, r.fromPlacementId);
    const tail = onPage(r, r.toPlacementId);
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
}

export async function removePlacement(
  projectId: string,
  placementId: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = (p.placements || []).filter((pl) => pl.id !== placementId);
    // A riser link or conduit that ended on this device goes with it (#209).
    if (p.riser) p.riser = pruneRisers(p.riser, { placementIds: new Set([placementId]) });
    p.updatedAt = Date.now();
  });
}

/* ------------------------- batch edits (#299 Task 14) ------------------------- */

/** What a batch removal took out — enough for undo to put it all back. */
export type RemovedBundle = { placements: GridPlacement[]; riser: RiserRemoved };
export type BatchResult<T> = { ok: true; project: GridProject; value: T } | { ok: false; error: string };

export const MAX_BATCH = 2000;
const BATCH_NOTHING = "Nothing selected.";
const BATCH_TOO_MANY = "Select 2,000 items or fewer.";
const batchStale = (n: number) => `${n} item(s) are no longer on this design — reload and try again.`;

/**
 * One all-or-nothing batch edit: ONE patchDoc, and either every listed
 * placement changes or none does. The id check runs twice — on a read
 * before patchDoc, so an ordinary refusal never writes at all, and again
 * inside the mutate against the doc patchDoc itself just read. The second
 * check narrows the race with a concurrent edit; it does not close it:
 * patchDoc reads then writes with no revision check, so a write landing
 * between its read and its write is still overwritten (last writer wins,
 * as for every Grid patch). A refusal inside leaves the doc untouched
 * (patchDoc still rewrites it as read, but `updatedAt` doesn't move — the
 * addPlacement `refused` pattern). `apply` runs only once every check
 * passed, and computes its return value from the pre-mutation doc.
 */
async function batchEdit<T>(
  projectId: string,
  rawIds: readonly string[],
  apply: (p: GridProject, ids: ReadonlySet<string>) => T,
  check?: (placements: GridPlacement[], ids: ReadonlySet<string>) => string | null
): Promise<BatchResult<T>> {
  if (rawIds.length > MAX_BATCH) return { ok: false, error: BATCH_TOO_MANY };
  const ids = new Set(rawIds);
  if (!ids.size) return { ok: false, error: BATCH_NOTHING };
  const refusalFor = (placements: GridPlacement[]): string | null => {
    const have = new Set(placements.map((pl) => pl.id));
    let missing = 0;
    for (const id of ids) if (!have.has(id)) missing++;
    return missing ? batchStale(missing) : check ? check(placements, ids) : null;
  };
  const before = await getProject(projectId);
  if (!before) return { ok: false, error: "Design not found." };
  const early = refusalFor(before.placements || []);
  if (early) return { ok: false, error: early };

  // `as`: assigned inside the patchDoc callback, which TS's narrowing can't see.
  let refusal = null as string | null;
  let value: T | undefined;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    refusal = refusalFor(p.placements || []);
    if (refusal) return;
    value = apply(p, ids);
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, error: "Design not found." };
  if (refusal) return { ok: false, error: refusal };
  return { ok: true, project: updated, value: value as T };
}

/** Last entry wins when an id repeats. */
function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((it) => [it.id, it]));
}

/**
 * Move many placed devices at once (#299). Each lands clamped to the page;
 * attached wire ends follow each device by its own delta (movePlacement's
 * rule); every moved device loses its #211 auto tag. Returns the PREVIOUS
 * positions, in stored order, for undo.
 */
export async function movePlacements(
  projectId: string,
  moves: { id: string; x: number; y: number }[]
): Promise<BatchResult<{ id: string; x: number; y: number }[]>> {
  const target = byId(moves);
  return batchEdit(projectId, moves.map((m) => m.id), (p) => {
    const previous: { id: string; x: number; y: number }[] = [];
    const deltas = new Map<string, MoveDelta>();
    p.placements = (p.placements || []).map((pl) => {
      const t = target.get(pl.id);
      if (!t) return pl;
      const x = clamp01(t.x);
      const y = clamp01(t.y);
      previous.push({ id: pl.id, x: pl.x, y: pl.y });
      deltas.set(pl.id, { sheetId: pl.sheetId, page: pl.page, dx: x - pl.x, dy: y - pl.y });
      return withoutAuto({ ...pl, x, y });
    });
    if (p.routes?.length) p.routes = translateRouteEnds(p.routes, deltas);
    return previous;
  });
}

/**
 * Remove many placed devices at once (#299). Riser links and conduits
 * ending on any of them go too (removePlacement's rule). Returns the removed
 * records as stored, in stored order, plus the riser items the prune took.
 */
export async function removePlacements(projectId: string, ids: string[]): Promise<BatchResult<RemovedBundle>> {
  return batchEdit(projectId, ids, (p, gone) => {
    const placements = (p.placements || []).filter((pl) => gone.has(pl.id));
    p.placements = (p.placements || []).filter((pl) => !gone.has(pl.id));
    let riser: RiserRemoved = {};
    if (p.riser) {
      const before = p.riser;
      p.riser = pruneRisers(p.riser, { placementIds: gone });
      riser = riserRemovedBetween(before, p.riser);
    }
    return { placements, riser };
  });
}

/** Label many placements at once (#299) — setPlacementCategory's rule per
 *  item. Returns the previous categories ("" when none). */
export async function setPlacementsCategory(
  projectId: string,
  items: { id: string; category: string }[]
): Promise<BatchResult<{ id: string; category: string }[]>> {
  const next = byId(items);
  return batchEdit(projectId, items.map((it) => it.id), (p) => {
    const previous: { id: string; category: string }[] = [];
    p.placements = (p.placements || []).map((pl) => {
      const it = next.get(pl.id);
      if (!it) return pl;
      previous.push({ id: pl.id, category: pl.category || "" });
      return withCategory(pl, it.category);
    });
    return previous;
  });
}

const CURTAIN_PART_REFUSAL = "Curtains can't change part — edit the curtain instead.";

/**
 * Swap the part on many placements at once (#299). A curtain placement's
 * part is its fabric, so curtains are refused (the whole batch). A real
 * swap clears the #211 auto tag and drops a lot `qty` — a quantity counted
 * for one part means nothing for another; re-picking the same part changes
 * nothing. An item may carry `qty` (undo of a swap): it is cleaned like any
 * written lot qty and set instead of dropped. Returns the previous partIds,
 * with `qty` when the placement had one. The caller checks the new parts
 * exist (the store never reads the catalog).
 */
export async function setPlacementsPart(
  projectId: string,
  items: { id: string; partId: string; qty?: number }[]
): Promise<BatchResult<{ id: string; partId: string; qty?: number }[]>> {
  const next = byId(items);
  return batchEdit(
    projectId,
    items.map((it) => it.id),
    (p) => {
      const previous: { id: string; partId: string; qty?: number }[] = [];
      p.placements = (p.placements || []).map((pl) => {
        const it = next.get(pl.id);
        if (!it) return pl;
        previous.push({ id: pl.id, partId: pl.partId, ...(pl.qty !== undefined ? { qty: pl.qty } : {}) });
        if (it.partId === pl.partId) return pl;
        const swapped: GridPlacement = withoutAuto({ ...pl, partId: it.partId });
        // An item carrying qty (undo of a swap) restores its lot through the
        // same clean as every other written qty; otherwise the lot is dropped.
        const { qty } = lotAndTag(it.qty, undefined);
        if (qty !== undefined) swapped.qty = qty;
        else delete swapped.qty;
        return swapped;
      });
      return previous;
    },
    (placements, ids) => (placements.some((pl) => ids.has(pl.id) && pl.curtain) ? CURTAIN_PART_REFUSAL : null)
  );
}

/* --------------------------- paste + undo (#299 Task 19) --------------------------- */

/** OPTION_GONE's copy in the editor actions — the option a paste targets was removed. */
const PASTE_OPTION_GONE = "That option was removed — refresh the page.";
const PASTE_SHEET_GONE = "That sheet is no longer on this design — reload and try again.";
const PASTE_NOTHING = "Nothing to paste.";
const PASTE_TOO_MANY = "Paste 2,000 items or fewer.";
const RESTORE_STALE = "Couldn't undo — the design changed.";
const RESTORE_NOTHING = "Nothing to undo.";
const RESTORE_TOO_MANY = "Couldn't undo — too many items.";

export type PasteItem = { srcId: string; x: number; y: number; partId: string; category?: string; curtain?: GridCurtain; qty?: number };

/**
 * Paste copied devices onto one page of one option (#299), in ONE patch.
 * Each item becomes a NEW placement (fresh id, clamped to the page, category
 * trimmed and capped, lot qty cleaned) and never carries an auto tag,
 * autoOrigin or seededFrom — a paste is a hand edit.
 *
 * `routeIds` name stored wires to copy with them. A wire is copied only
 * when both its ends were pasted, its FROM device is still on the design
 * (a cut device is gone, so the wire's offset can't be worked out) and the
 * target page is calibrated (wire footage needs a scale); every other
 * requested wire counts in `skippedWires`. A copy keeps the part,
 * connection type and aspect, joins the target option/sheet/page, re-points
 * its ends at the new devices, and moves every point by the FROM device's
 * delta. The caller checks the parts (the store never reads the catalog).
 */
export async function pastePlacements(
  projectId: string,
  input: { sheetId: string; page: number; optionId: string; by: string; items: PasteItem[]; routeIds: string[] }
): Promise<BatchResult<{ placements: GridPlacement[]; routes: GridRoute[]; skippedWires: number }>> {
  if (!input.items.length) return { ok: false, error: PASTE_NOTHING };
  if (input.items.length > MAX_BATCH || input.routeIds.length > MAX_BATCH) return { ok: false, error: PASTE_TOO_MANY };
  const before = await getProject(projectId);
  if (!before) return { ok: false, error: "Design not found." };
  if (!hasOption(before, input.optionId)) return { ok: false, error: PASTE_OPTION_GONE };
  if (!(before.sheetIds || []).includes(input.sheetId)) return { ok: false, error: PASTE_SHEET_GONE };

  let refused = false;
  let sheetGone = false;
  let value: { placements: GridPlacement[]; routes: GridRoute[]; skippedWires: number } | undefined;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refused = true;
      return;
    }
    if (!(p.sheetIds || []).includes(input.sheetId)) {
      sheetGone = true;
      return;
    }
    const at = Date.now();
    const newId = new Map<string, string>();
    const pasted: GridPlacement[] = input.items.map((it) => {
      const id = rid("gp-");
      if (it.srcId) newId.set(it.srcId, id);
      const label = (it.category || "").trim().slice(0, 40);
      return {
        id,
        sheetId: input.sheetId,
        page: input.page,
        x: clamp01(it.x),
        y: clamp01(it.y),
        partId: it.partId,
        optionId: input.optionId,
        ...(label ? { category: label } : {}),
        ...lotAndTag(it.qty, undefined),
        ...(it.curtain ? { curtain: it.curtain } : {}),
        by: input.by,
        at,
      };
    });
    const target = byId(pasted);
    const source = byId(p.placements || []);
    const stored = byId(p.routes || []);
    const calibrated = !!findCalibration(p.calibrations || [], input.sheetId, input.page);
    const routes: GridRoute[] = [];
    let skippedWires = 0;
    for (const routeId of new Set(input.routeIds)) {
      const r = stored.get(routeId);
      const fromId = r?.fromPlacementId ? newId.get(r.fromPlacementId) : undefined;
      const toId = r?.toPlacementId ? newId.get(r.toPlacementId) : undefined;
      const src = r?.fromPlacementId ? source.get(r.fromPlacementId) : undefined;
      const dst = fromId ? target.get(fromId) : undefined;
      // Same-page rule (translateRouteEnds'): a wire on another sheet/page
      // than its FROM device isn't drawn between these devices.
      const samePage = !!r && !!src && r.sheetId === src.sheetId && r.page === src.page;
      if (!r || !fromId || !toId || !src || !dst || !calibrated || !samePage) {
        skippedWires++;
        continue;
      }
      const dx = dst.x - src.x;
      const dy = dst.y - src.y;
      routes.push({
        id: rid("wr-"),
        sheetId: input.sheetId,
        page: input.page,
        partId: r.partId,
        points: r.points.map((q) => ({ x: clamp01(q.x + dx), y: clamp01(q.y + dy) })),
        aspect: r.aspect,
        optionId: input.optionId,
        by: input.by,
        at,
        fromPlacementId: fromId,
        toPlacementId: toId,
        ...(r.connectionType ? { connectionType: r.connectionType } : {}),
      });
    }
    p.placements = [...(p.placements || []), ...pasted];
    if (routes.length) p.routes = [...(p.routes || []), ...routes];
    p.updatedAt = at;
    value = { placements: pasted, routes, skippedWires };
  });
  if (!updated) return { ok: false, error: "Design not found." };
  if (sheetGone) return { ok: false, error: PASTE_SHEET_GONE };
  if (refused || !value) return { ok: false, error: PASTE_OPTION_GONE };
  return { ok: true, project: updated, value };
}

/**
 * Undo of a batch removal (#299): put the removed placements back with
 * their ORIGINAL ids, then the riser links and conduits that went with
 * them. All-or-nothing, batchEdit's two-check pattern: refused when any id
 * is already on the design (undo already ran, or the design changed) or a
 * record's option or sheet is gone — a refusal never bumps `updatedAt`.
 *
 * The bundle comes back from the CLIENT, so the riser half is rebuilt
 * through cleanRiserRemoved (live option keys only, `lk-`/`cd-` ids, valid
 * ends), each item must end on a placement of ITS option, and every touched
 * document is re-normalized. The placement records are appended as given:
 * restoreItemsAction rebuilds and re-validates each one before calling here.
 */
export async function restoreItems(projectId: string, bundle: RemovedBundle): Promise<BatchResult<{ ids: string[] }>> {
  const placements = Array.isArray(bundle?.placements) ? bundle.placements : [];
  if (!placements.length) return { ok: false, error: RESTORE_NOTHING };
  if (placements.length > MAX_BATCH) return { ok: false, error: RESTORE_TOO_MANY };
  const ids = placements.map((pl) => pl.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: RESTORE_STALE };
  const refusalFor = (p: GridProject): string | null => {
    const have = new Set((p.placements || []).map((pl) => pl.id));
    if (ids.some((id) => have.has(id))) return RESTORE_STALE;
    if (placements.some((pl) => pl.optionId !== undefined && !hasOption(p, pl.optionId))) return RESTORE_STALE;
    // A record whose sheet was deleted since would come back invisible but priced.
    const sheets = new Set(p.sheetIds || []);
    if (placements.some((pl) => !sheets.has(pl.sheetId))) return RESTORE_STALE;
    return null;
  };
  const before = await getProject(projectId);
  if (!before) return { ok: false, error: "Design not found." };
  const early = refusalFor(before);
  if (early) return { ok: false, error: early };

  let refusal = null as string | null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    refusal = refusalFor(p);
    if (refusal) return;
    p.placements = [...(p.placements || []), ...placements];
    const first = defaultOptionId(p);
    const optionOf = new Map(p.placements.map((pl) => [pl.id, pl.optionId || first]));
    const removed = cleanRiserRemoved(bundle?.riser, new Set(ensureOptions(p).options.map((o) => o.id)));
    // An item may only end on a device of its own option's riser.
    const ownEnd = (k: string) => (e: { kind: string; placementId?: string }) =>
      e.kind !== "placement" || optionOf.get(e.placementId as string) === k;
    for (const k of Object.keys(removed)) {
      const ok = ownEnd(k);
      const links = removed[k].links.filter((l) => ok(l.from) && ok(l.to));
      const conduits = removed[k].conduits.filter((c) => ok(c.from) && ok(c.to));
      if (links.length || conduits.length) removed[k] = { links, conduits };
      else delete removed[k];
    }
    const keys = Object.keys(removed);
    if (keys.length) {
      const restored = restoreRiserItems(p.riser, removed, {
        placementIds: new Set(optionOf.keys()),
        spaceIds: new Set((p.spaces || []).map((sp) => sp.id)),
      });
      if (restored) {
        for (const k of keys) restored[k] = normalizeRiserDoc(restored[k]);
        p.riser = restored;
      }
    }
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, error: "Design not found." };
  if (refusal) return { ok: false, error: refusal };
  return { ok: true, project: updated, value: { ids } };
}

/** Set (or replace) the scale for one page of one sheet. */
export async function setSheetCalibration(
  projectId: string,
  cal: Calibration
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.calibrations = [
      ...(p.calibrations || []).filter((c) => !(c.docId === cal.docId && c.page === cal.page)),
      cal,
    ];
    p.updatedAt = Date.now();
  });
}

export async function clearSheetCalibration(
  projectId: string,
  sheetId: string,
  page: number
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.calibrations = (p.calibrations || []).filter(
      (c) => !(c.docId === sheetId && c.page === page)
    );
    p.updatedAt = Date.now();
  });
}

/** Store the draft quote minted from ONE option (Spec 1). `project.quoteId`
 *  is re-mirrored from the first option every time. */
export async function setOptionQuote(
  projectId: string,
  optionId: string,
  quoteId: string
): Promise<GridProject | null> {
  const project = await getProject(projectId);
  if (!project || !hasOption(project, optionId)) return null;
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, quoteId } : o));
    syncQuoteMirror(doc);
    p.updatedAt = Date.now();
  });
}

export async function setVenue(
  projectId: string,
  siteId: string | null,
  siteName: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.siteId = siteId;
    p.siteName = siteName;
    p.updatedAt = Date.now();
  });
}

/**
 * Link (or re-link) the design's customer (#244): display name, id, contact
 * and venue in one patch. The intake passes the venue it resolved; the
 * editor's customer control passes none, so a changed customer never keeps
 * the previous customer's venue or contact.
 */
export async function setProjectCustomer(
  projectId: string,
  input: { customer: string; customerId: string | null; contactName: string; siteId: string | null; siteName: string }
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.customer = input.customer.trim();
    p.customerId = input.customerId;
    p.contactName = input.contactName.trim();
    p.siteId = input.siteId;
    p.siteName = input.siteName;
    p.updatedAt = Date.now();
  });
}

export async function renameProject(projectId: string, name: string): Promise<GridProject | null> {
  const clean = name.trim();
  if (!clean) return getProject(projectId);
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.name = clean;
    p.updatedAt = Date.now();
  });
}

export async function setScopeInputs(
  projectId: string,
  scopeInputs: QuickScopeInputs | null
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.scopeInputs = scopeInputs;
    p.updatedAt = Date.now();
  });
}

/** Merge drawing-set settings (#209). `resetGeneralNotes` drops the set's own
 *  notes so the cover falls back to Grid Settings' standard notes. */
export async function setDrawingSet(
  projectId: string,
  patch: DrawingSetSettings,
  opts: { resetGeneralNotes?: boolean } = {}
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const next = cleanDrawingSet({ ...(p.drawingSet || {}), ...cleanDrawingSet(patch) });
    if (opts.resetGeneralNotes) delete next.generalNotes;
    p.drawingSet = next;
    p.updatedAt = Date.now();
  });
}

/** Store the design's symbol display (#300) — cleaned, never trusted. */
export async function setSymbolDisplay(projectId: string, raw: unknown): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.symbolDisplay = cleanSymbolDisplay(raw);
    p.updatedAt = Date.now();
  });
}

/** Soft-delete a project and its sheets (doc-store tombstones for sync). */
export async function removeProject(id: string): Promise<void> {
  const sheets = await listSheets(id);
  for (const s of sheets) await softDeleteDoc("grid_sheets", s.id);
  await softDeleteDoc("grid_projects", id);
}

/* ------------------------------ spaces ------------------------------ */

/** Space fills — deliberately NOT the marker palette so a space never
 *  camouflages the devices inside it. */
export const SPACE_COLORS = ["#8a6d3b", "#3b7a8a", "#7a3b8a", "#5f8a3b", "#8a3b55", "#3b508a"];

export async function addSpace(
  projectId: string,
  input: { sheetId: string; page: number; name: string; points: Point[]; by: string }
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const spaces = p.spaces || [];
    p.spaces = [
      ...spaces,
      {
        id: rid("sp-"),
        sheetId: input.sheetId,
        page: input.page,
        name: input.name.trim() || "Unnamed space",
        color: SPACE_COLORS[spaces.length % SPACE_COLORS.length],
        points: input.points,
        by: input.by,
        at: Date.now(),
      },
    ];
    p.updatedAt = Date.now();
  });
}

export async function renameSpace(
  projectId: string,
  spaceId: string,
  name: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.spaces = (p.spaces || []).map((s) =>
      s.id === spaceId ? { ...s, name: name.trim() || s.name } : s
    );
    p.updatedAt = Date.now();
  });
}

export async function removeSpace(
  projectId: string,
  spaceId: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.spaces = (p.spaces || []).filter((s) => s.id !== spaceId);
    // Its riser box, and any link/conduit ending on it, go too (#209).
    if (p.riser) p.riser = pruneRisers(p.riser, { spaceIds: new Set([spaceId]) });
    p.updatedAt = Date.now();
  });
}

/* ------------------------------ routes ------------------------------ */

export async function addRoute(
  projectId: string,
  input: {
    sheetId: string;
    page: number;
    partId: string;
    points: Point[];
    aspect: number;
    optionId: string;
    by: string;
    fromPlacementId?: string;
    toPlacementId?: string;
    connectionType?: string;
  }
): Promise<GridProject | null> {
  let refused = false;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) { refused = true; return; }
    p.routes = [
      ...(p.routes || []),
      {
        id: rid("wr-"),
        sheetId: input.sheetId,
        page: input.page,
        partId: input.partId,
        points: input.points,
        aspect: input.aspect,
        optionId: input.optionId,
        by: input.by,
        at: Date.now(),
        ...(input.fromPlacementId ? { fromPlacementId: input.fromPlacementId } : {}),
        ...(input.toPlacementId ? { toPlacementId: input.toPlacementId } : {}),
        ...(input.connectionType ? { connectionType: input.connectionType } : {}),
      },
    ];
    p.updatedAt = Date.now();
  });
  return refused ? null : updated;
}

export async function removeRoute(
  projectId: string,
  routeId: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.routes = (p.routes || []).filter((r) => r.id !== routeId);
    p.updatedAt = Date.now();
  });
}

/* ------------------------------ options (Spec 1) ------------------------------ */

export async function addOption(
  projectId: string,
  input: { name: string; copyFromOptionId?: string; tier?: TierKey; by: string }
): Promise<{ ok: true; option: GridOption } | { ok: false; reason: "not-found" | "empty-name" | "no-such-option" }> {
  const name = input.name.trim().slice(0, 40);
  if (!name) return { ok: false, reason: "empty-name" };
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (input.copyFromOptionId && !hasOption(project, input.copyFromOptionId)) return { ok: false, reason: "no-such-option" };
  const at = Date.now();
  const option: GridOption = { id: rid("opt-"), name, quoteId: null, createdAt: at, ...(input.tier ? { tier: input.tier } : {}) };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    // Custom items (#212) are option-scoped design state: a copied option
    // carries its own copies, under fresh ids.
    if (input.copyFromOptionId) {
      const src = doc.options.find((o) => o.id === input.copyFromOptionId);
      const items = copyCustomItems(customItemsOf(src?.customItems), () => rid("ci-"));
      if (items.length) option.customItems = items;
      // BOM accessories (#230) ride on the option the same way.
      const accessories = copyAccessories(accessoriesOf(src?.accessories), () => rid("ba-"));
      if (accessories.length) option.accessories = accessories;
      // Labor overrides (#232) are option-scoped design state too.
      const labor = sanitizeLaborOverrides(src?.laborOverrides);
      if (Object.keys(labor).length) option.laborOverrides = labor;
    }
    doc.options = [...doc.options, option];
    if (input.copyFromOptionId) {
      const copied = copyOptionMembers({
        placements: doc.placements || [],
        routes: doc.routes || [],
        fromOptionId: input.copyFromOptionId,
        toOptionId: option.id,
        makeId: (prefix) => rid(prefix),
        by: input.by,
        at,
      });
      doc.placements = [...(doc.placements || []), ...copied.placements];
      doc.routes = [...(doc.routes || []), ...copied.routes];
      // The copied option gets its own riser document, device ends re-pointed
      // at the copied placements (#209).
      const srcRiser = doc.riser?.[input.copyFromOptionId];
      if (srcRiser) {
        doc.riser = { ...doc.riser, [option.id]: copyRiserDoc(srcRiser, copied.idMap, (prefix) => rid(prefix), input.by, at) };
      }
      // The copied placements keep their auto tags, so the copy carries the
      // source option's Auto choices with them (#211, D312).
      const ests = autoEstimatesOf(doc.autoEstimate, doc.options[0].id);
      const src = ests[input.copyFromOptionId];
      if (src) doc.autoEstimate = { ...ests, [option.id]: JSON.parse(JSON.stringify(src)) as AutoEstimate };
    }
    p.updatedAt = at;
  });
  return updated ? { ok: true, option } : { ok: false, reason: "not-found" };
}

export async function renameOption(
  projectId: string,
  optionId: string,
  name: string
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "empty-name" | "no-such-option" }> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, reason: "empty-name" };
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (!hasOption(project, optionId)) return { ok: false, reason: "no-such-option" };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, name: clean } : o));
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, reason: "not-found" };
}

/**
 * Remove an option and every placement/route tagged with it, in one patch,
 * after cutting a revision (non-destructive by construction, D109 idiom).
 * The option's draft quote, if any, is left in the Quotes hub. Refuses the
 * last option: a project always has ≥1.
 */
export async function removeOption(
  projectId: string,
  optionId: string,
  by: string
): Promise<
  | { ok: true; removedPlacements: number; removedRoutes: number }
  | { ok: false; reason: "not-found" | "no-such-option" | "last-option" }
> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  const opts = ensureOptions(project).options;
  const target = opts.find((o) => o.id === optionId);
  if (!target) return { ok: false, reason: "no-such-option" };
  if (opts.length <= 1) return { ok: false, reason: "last-option" };
  let removedPlacements = 0;
  let removedRoutes = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    pushRevision(doc, by, "manual", `Auto-saved before removing option ${target.name}`);
    const keepP = (doc.placements || []).filter((pl) => pl.optionId !== optionId);
    const keepR = (doc.routes || []).filter((r) => r.optionId !== optionId);
    removedPlacements = (doc.placements || []).length - keepP.length;
    removedRoutes = (doc.routes || []).length - keepR.length;
    doc.placements = keepP;
    doc.routes = keepR;
    doc.options = doc.options.filter((o) => o.id !== optionId);
    if (doc.riser && optionId in doc.riser) {
      const riser = { ...doc.riser };
      delete riser[optionId];
      doc.riser = riser;
    }
    // A legacy single estimate belongs to the pre-removal first option (#211, D312).
    if (doc.autoEstimate) {
      const ests = autoEstimatesOf(doc.autoEstimate, opts[0].id);
      delete ests[optionId];
      if (Object.keys(ests).length) doc.autoEstimate = ests;
      else delete doc.autoEstimate;
    }
    syncQuoteMirror(doc);
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true, removedPlacements, removedRoutes } : { ok: false, reason: "not-found" };
}

/* --------------------------- custom items (#212) --------------------------- */

/**
 * Add (no `id`) or edit (existing `id`) one custom item on an option. The raw
 * input is re-sanitized here whatever the client sent. Does not cut a
 * revision (same as a placement edit); quote/manual revisions capture it.
 */
export async function saveCustomItem(
  projectId: string,
  optionId: string,
  raw: unknown
): Promise<{ ok: true; item: GridCustomItem } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  let out: { ok: true; item: GridCustomItem } | { ok: false; error: string } = { ok: false, error: "Design not found." };
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    const opt = doc.options.find((o) => o.id === optionId);
    if (!opt) {
      out = { ok: false, error: "That option was removed — refresh the page." };
      return;
    }
    const r = applyCustomItemSave(customItemsOf(opt.customItems), raw, () => rid("ci-"));
    if (!r.ok) {
      out = { ok: false, error: r.error };
      return;
    }
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, customItems: r.items } : o));
    p.updatedAt = Date.now();
    out = { ok: true, item: r.item };
  });
  return out;
}

/** Remove one custom item. Idempotent: an id already gone is not an error. */
export async function removeCustomItem(
  projectId: string,
  optionId: string,
  itemId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) =>
      o.id === optionId ? { ...o, customItems: withoutCustomItem(customItemsOf(o.customItems), itemId) } : o
    );
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, error: "Design not found." };
}

/* ------------------------- labor overrides (#232) ------------------------- */

/**
 * Set (a number, $0–$10M; $0 leaves the line off the quote) or clear (null)
 * one system's typed labor $ on an option. The system must be a Grid BOM
 * heading (Rigging … General) — the only labor lines a Grid option has.
 * Does not cut a revision (same as a custom item); quote / manual revisions
 * capture it.
 */
export async function setLaborOverride(
  projectId: string,
  optionId: string,
  system: string,
  amount: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isBomGroupKey(system)) return { ok: false, error: "Unknown labor line." };
  if (amount !== null && !(typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= LABOR_OVERRIDE_MAX))
    return { ok: false, error: "Enter a labor amount from $0 to $10,000,000." };
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) => {
      if (o.id !== optionId) return o;
      const next = applyLaborOverride(o.laborOverrides, system, amount);
      const rest = { ...o };
      delete rest.laborOverrides;
      return Object.keys(next).length ? { ...rest, laborOverrides: next } : rest;
    });
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, error: "Design not found." };
}

/* ---------------------------- BOM accessories (#230) ---------------------------- */

/**
 * Add (no `id`: partId + qty + scope) or edit the qty of (`id`) one BOM
 * accessory on an option. An add must name a Grid-library part that is not
 * Fabric or Labor (the palette's placeable rule) — the id a placement of it
 * would carry, so it prices exactly like one. The raw input is re-sanitized
 * here whatever the client sent. Re-adding a part under the same heading
 * bumps that line. Does not cut a revision (same as a placement edit).
 */
export async function saveAccessory(
  projectId: string,
  optionId: string,
  raw: unknown
): Promise<{ ok: true; item: GridAccessory; clamped?: true } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!(typeof r.id === "string" && r.id)) {
    const symbol = await getGridSymbol(String(r.partId ?? "").trim());
    // #264: a fabric is never an accessory — the symbol carries no unit, so a
    // Soft Goods sq-ft fabric is recognised through its pricing part's unit.
    const pricing = symbol?.pricingPartId ? await getCatalogPart(symbol.pricingPartId) : null;
    if (!symbol || isFabricPart({ category: symbol.category, unit: pricing?.unit }) || symbol.category === "Labor")
      return { ok: false, error: "That part isn't in the Grid library — pick it from the search." };
  }
  let out: { ok: true; item: GridAccessory; clamped?: true } | { ok: false; error: string } = { ok: false, error: "Design not found." };
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    const opt = doc.options.find((o) => o.id === optionId);
    if (!opt) {
      out = { ok: false, error: "That option was removed — refresh the page." };
      return;
    }
    const s = applyAccessorySave(accessoriesOf(opt.accessories), raw, () => rid("ba-"));
    if (!s.ok) {
      out = { ok: false, error: s.error };
      return;
    }
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, accessories: s.items } : o));
    p.updatedAt = Date.now();
    out = { ok: true, item: s.item, ...(s.clamped ? { clamped: true as const } : {}) };
  });
  return out;
}

/** Remove one accessory. Idempotent: an id already gone is not an error. */
export async function removeAccessory(
  projectId: string,
  optionId: string,
  accessoryId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) =>
      o.id === optionId ? { ...o, accessories: withoutAccessory(accessoriesOf(o.accessories), accessoryId) } : o
    );
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, error: "Design not found." };
}

/* ----------------------------- revisions ----------------------------- */

/** Snapshot of the doc's mutable state as it stands. Pure. */
function snapshotOf(
  p: GridProject,
  rev: number,
  by: string,
  reason: GridRevision["reason"],
  note: string
): GridRevision {
  return {
    rev,
    at: Date.now(),
    by,
    reason,
    note,
    name: p.name,
    sheetIds: [...(p.sheetIds || [])],
    placements: [...(p.placements || [])],
    calibrations: [...(p.calibrations || [])],
    spaces: [...(p.spaces || [])],
    routes: [...(p.routes || [])],
    // Deep copy: the riser document is nested and patched in place later.
    riser: p.riser ? (JSON.parse(JSON.stringify(p.riser)) as Record<string, RiserDoc>) : {},
    // Auto choices are design state like the riser (#211, D312) —
    // normalized (a legacy single value lands as the first option's) and deep-copied.
    autoEstimate: JSON.parse(JSON.stringify(autoEstimatesOf(p.autoEstimate, p.options?.[0]?.id ?? DEFAULT_OPTION_ID))) as AutoEstimates,
    options: ensureOptions({
      // Custom items (#212) and BOM accessories (#230) ride on the option — copied, not shared.
      options: p.options
        ? p.options.map((o) => ({
            ...o,
            ...(o.customItems ? { customItems: o.customItems.map((c) => ({ ...c })) } : {}),
            ...(o.accessories ? { accessories: o.accessories.map((a) => ({ ...a })) } : {}),
            // Labor overrides (#232) ride on the option — copied, not shared.
            ...(o.laborOverrides ? { laborOverrides: { ...o.laborOverrides } } : {}),
          }))
        : undefined,
      quoteId: p.quoteId,
      createdAt: p.createdAt,
    }).options,
  };
}

/** Append a snapshot inside an existing patch callback. */
function pushRevision(
  p: GridProject,
  by: string,
  reason: GridRevision["reason"],
  note: string
): GridRevision {
  const revs = Array.isArray(p.revisions) ? p.revisions : [];
  const r = snapshotOf(p, revs.length + 1, by, reason, note);
  p.revisions = [...revs, r];
  return r;
}

/** Snapshot the design as it stands. Returns the new revision. */
export async function addRevision(
  projectId: string,
  opts: { by: string; reason?: GridRevision["reason"]; note?: string }
): Promise<GridRevision | null> {
  let out: GridRevision | null = null;
  const res = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    out = pushRevision(p, opts.by, opts.reason || "manual", opts.note || "");
    p.updatedAt = Date.now();
  });
  return res ? out : null;
}

/**
 * Recall an earlier revision onto the live design. Non-destructive by
 * construction (the quotes idiom): the current state is snapshotted FIRST,
 * so walking back never discards the direction walked away from. sheetIds
 * are NOT applied wholesale from the snapshot — a sheet added since, or
 * removed for reasons unrelated to this revision, is left exactly as it
 * is. The one exception: a sheet that WAS removed (removeSheet only drops
 * it from sheetIds — the doc itself is never deleted) and that the
 * restored placements/spaces/routes actually reference is added BACK onto
 * sheetIds, or those items would land on the live design pointing at a
 * sheet the editor no longer shows.
 */
export async function restoreRevision(
  projectId: string,
  rev: number,
  by: string
): Promise<{ ok: false; reason: "not-found" | "no-such-rev" } | { ok: true }> {
  const p = await getProject(projectId);
  if (!p) return { ok: false, reason: "not-found" };
  const target = (p.revisions || []).find((r) => r.rev === rev);
  if (!target) return { ok: false, reason: "no-such-rev" };
  // #304: the snapshot keeps the part ids it was cut with; see below.
  const { m: renamed } = await liveRenameRefs();
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (doc) => {
    pushRevision(doc, by, "restore", `Auto-saved before recalling v${rev}`);
    doc.name = target.name;
    doc.placements = [...target.placements];
    doc.calibrations = [...target.calibrations];
    doc.spaces = [...target.spaces];
    doc.routes = [...(target.routes || [])];
    // The riser document is design state like placements (#209): restored
    // wholesale. A pre-#209 snapshot has none → back to the auto layout.
    if (target.riser) doc.riser = JSON.parse(JSON.stringify(target.riser)) as Record<string, RiserDoc>;
    else delete doc.riser;
    // sheetIds themselves are still never restored wholesale from the
    // snapshot (a sheet added since, or removed for reasons unrelated to
    // this revision, should stay exactly as it is) — but a sheet that WAS
    // removed since this snapshot and that the restored placements/spaces/
    // routes actually reference must come back into the live list, or
    // those items land back on the design pointing at a sheet the editor
    // no longer shows. The sheet's own doc was never deleted by removeSheet
    // (only dropped from sheetIds), so it still resolves the moment its id
    // is back on the list.
    const referencedSheetIds = new Set<string>();
    for (const pl of target.placements) referencedSheetIds.add(pl.sheetId);
    for (const sp of target.spaces) referencedSheetIds.add(sp.sheetId);
    for (const r of target.routes || []) referencedSheetIds.add(r.sheetId);
    const liveSheetIds = new Set(doc.sheetIds || []);
    for (const sid of referencedSheetIds) liveSheetIds.add(sid);
    doc.sheetIds = Array.from(liveSheetIds);
    // Quote links are bookkeeping, not design state: a restore brings back
    // the option LIST and membership, but every option that still exists
    // keeps its CURRENT quote link, and the project mirror is re-derived.
    const currentQuotes = new Map(ensureOptions(doc).options.map((o) => [o.id, o.quoteId]));
    doc.options = target.options
      ? target.options.map((o) => ({ ...o, quoteId: currentQuotes.has(o.id) ? currentQuotes.get(o.id)! : o.quoteId }))
      : undefined;
    ensureOptions(doc);
    // Auto choices come back with the placements they describe (#211,
    // D312), kept only for options that exist after the restore. A
    // pre-D312 snapshot has none → cleared (the snapshot just pushed above
    // still holds the current ones).
    const restoredEsts = autoEstimatesOf(target.autoEstimate, doc.options![0].id);
    const liveOptionIds = new Set(doc.options!.map((o) => o.id));
    for (const k of Object.keys(restoredEsts)) if (!liveOptionIds.has(k)) delete restoredEsts[k];
    if (Object.keys(restoredEsts).length) doc.autoEstimate = restoredEsts;
    else delete doc.autoEstimate;
    // #304: the restored design is LIVE — a part renamed since the snapshot
    // moves to its live SKU (placements, routes, riser links, option
    // accessories, Auto overrides). Copy-on-write: the snapshot in
    // `revisions` is never touched.
    const live = renamed.size ? rewriteGridProjectLive(doc as unknown as Record<string, unknown>, renamed) : null;
    if (live) Object.assign(doc, live);
    syncQuoteMirror(doc);
    pushRevision(doc, by, "restore", `Recalled v${rev}`);
    doc.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, reason: "not-found" };
}

/**
 * #301 slice C (D-k, R9) — the Grid design a quote was minted from: the
 * option whose `quoteId` is this quote, else a legacy doc whose own
 * `quoteId` is (its first option). A scan — there is no stored back-link.
 * Newest activity first, so a re-minted quote finds the latest design.
 */
export async function gridProjectForQuote(quoteId: string): Promise<{ project: GridProject; optionId: string } | null> {
  if (!quoteId) return null;
  for (const p of await listProjects()) {
    const doc = ensureOptions(p);
    const opt = doc.options.find((o) => o.quoteId === quoteId);
    if (opt) return { project: doc, optionId: opt.id };
    if (doc.quoteId === quoteId) return { project: doc, optionId: doc.options[0].id };
  }
  return null;
}
