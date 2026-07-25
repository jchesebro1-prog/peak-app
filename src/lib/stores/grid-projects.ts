import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import type { Calibration, Point } from "@/lib/annotations";

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
  /** Catalog SKU (catalog_parts doc id). */
  partId: string;
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
};

export type GridProject = {
  id: string; // GRD-#### from base 5001
  name: string;
  customer: string;
  customerId: string | null;
  /** Venue link (D113 item 6) — identity sites.id + display name. */
  siteId?: string | null;
  siteName?: string;
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
  /** Draft quote minted from this design, when one exists. */
  quoteId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type GridSheet = {
  id: string; // 'gs-' + random
  projectId: string;
  name: string;
  mime: string;
  dataUrl: string;
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
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(id: string): Promise<GridProject | null> {
  return getDoc<GridProject>("grid_projects", id);
}

export async function createProject(input: {
  name: string;
  customer: string;
  customerId: string | null;
  by: string;
}): Promise<GridProject> {
  const id = await nextPrefixedId("grid_projects", "GRD", 5001);
  const t = Date.now();
  const p: GridProject = {
    id,
    name: input.name.trim() || "Untitled system design",
    customer: input.customer.trim(),
    customerId: input.customerId,
    sheetIds: [],
    placements: [],
    calibrations: [],
    spaces: [],
    routes: [],
    quoteId: null,
    createdBy: input.by,
    createdAt: t,
    updatedAt: t,
  };
  await upsertDoc<GridProject>("grid_projects", p);
  return p;
}

/** Upload one plan background and append it to the project's sheet order. */
export async function addSheet(
  projectId: string,
  input: { name: string; mime: string; dataUrl: string; by: string }
): Promise<GridSheet | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const sheet: GridSheet = {
    id: rid("gs-"),
    projectId,
    name: input.name || "Plan sheet",
    mime: input.mime,
    dataUrl: input.dataUrl,
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

export async function addPlacement(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; by: string }
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = [
      ...(p.placements || []),
      {
        id: rid("gp-"),
        sheetId: input.sheetId,
        page: input.page,
        x: input.x,
        y: input.y,
        partId: input.partId,
        by: input.by,
        at: Date.now(),
      },
    ];
    p.updatedAt = Date.now();
  });
}

export async function removePlacement(
  projectId: string,
  placementId: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.placements = (p.placements || []).filter((pl) => pl.id !== placementId);
    p.updatedAt = Date.now();
  });
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

export async function setQuote(
  projectId: string,
  quoteId: string
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.quoteId = quoteId;
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
    p.updatedAt = Date.now();
  });
}

/* ------------------------------ routes ------------------------------ */

export async function addRoute(
  projectId: string,
  input: { sheetId: string; page: number; partId: string; points: Point[]; aspect: number; by: string }
): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.routes = [
      ...(p.routes || []),
      {
        id: rid("wr-"),
        sheetId: input.sheetId,
        page: input.page,
        partId: input.partId,
        points: input.points,
        aspect: input.aspect,
        by: input.by,
        at: Date.now(),
      },
    ];
    p.updatedAt = Date.now();
  });
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
 * are NOT applied — sheets are never orphaned by a restore.
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
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (doc) => {
    pushRevision(doc, by, "restore", `Auto-saved before recalling v${rev}`);
    doc.name = target.name;
    doc.placements = [...target.placements];
    doc.calibrations = [...target.calibrations];
    doc.spaces = [...target.spaces];
    doc.routes = [...(target.routes || [])];
    pushRevision(doc, by, "restore", `Recalled v${rev}`);
    doc.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, reason: "not-found" };
}
