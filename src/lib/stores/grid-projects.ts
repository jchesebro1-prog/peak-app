import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import type { Calibration } from "@/lib/annotations";

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

export type GridProject = {
  id: string; // GRD-#### from base 5001
  name: string;
  customer: string;
  customerId: string | null;
  /** Sheet display order; the docs live in grid_sheets. */
  sheetIds: string[];
  placements: GridPlacement[];
  calibrations: Calibration[];
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

/** Soft-delete a project and its sheets (doc-store tombstones for sync). */
export async function removeProject(id: string): Promise<void> {
  const sheets = await listSheets(id);
  for (const s of sheets) await softDeleteDoc("grid_sheets", s.id);
  await softDeleteDoc("grid_projects", id);
}
