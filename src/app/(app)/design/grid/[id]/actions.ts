"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { findCalibration, type Calibration, type MeasureUnit, type Point } from "@/lib/annotations";
import {
  addPlacement,
  addRevision,
  addRoute,
  addSheet,
  addSpace,
  clearSheetCalibration,
  getProject,
  removePlacement,
  removeRoute,
  removeSpace,
  renameSpace,
  restoreRevision,
  setQuote,
  setSheetCalibration,
} from "@/lib/stores/grid-projects";
import { get as getPart, list as listCatalog } from "@/lib/stores/catalog";
import { bomLines, bomTotals, isPerLengthUnit, routeLines } from "@/lib/design/grid-bom";
import { polygonArea } from "@/lib/design/grid-geometry";
import { create as createQuote, get as getQuote, update as updateQuote } from "@/lib/stores/quotes";

/** The Grid editor server actions (D108). */

type Result = { ok: true } | { ok: false; error: string };

function editorPath(projectId: string): string {
  return `/design/grid/${encodeURIComponent(projectId)}`;
}

/** ~8 MB of dataUrl — beyond this a JSONB doc stops being a sane home. */
const MAX_SHEET_BYTES = 8 * 1024 * 1024;

export async function addSheetAction(
  projectId: string,
  input: { name: string; mime: string; dataUrl: string }
): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.dataUrl.startsWith("data:")) return { ok: false, error: "Not a readable file." };
  if (input.dataUrl.length > MAX_SHEET_BYTES)
    return {
      ok: false,
      error: "That file is over 8 MB. Print the drawing to a smaller PDF (one sheet per file) and try again.",
    };
  const okMime = input.mime === "application/pdf" || input.mime.startsWith("image/");
  if (!okMime) return { ok: false, error: "PDF or image files only — print DWGs to PDF first." };
  const sheet = await addSheet(projectId, { ...input, by: user.name });
  if (!sheet) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true, sheetId: sheet.id };
}

export async function placeDeviceAction(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string }
): Promise<Result> {
  const user = await requireUser();
  const p = await addPlacement(projectId, { ...input, by: user.name });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function removePlacementAction(
  projectId: string,
  placementId: string
): Promise<Result> {
  await requireUser();
  const p = await removePlacement(projectId, placementId);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function calibrateAction(
  projectId: string,
  input: { sheetId: string; page: number; scale: number; unit: MeasureUnit; refLength: number }
): Promise<Result> {
  const user = await requireUser();
  const cal: Calibration = {
    docId: input.sheetId,
    page: input.page,
    scale: input.scale,
    unit: input.unit,
    refLength: input.refLength,
    by: user.name,
    at: Date.now(),
  };
  const p = await setSheetCalibration(projectId, cal);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function clearCalAction(
  projectId: string,
  sheetId: string,
  page: number
): Promise<Result> {
  await requireUser();
  const p = await clearSheetCalibration(projectId, sheetId, page);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/* ------------------------------ spaces (D109) ------------------------------ */

export async function addSpaceAction(
  projectId: string,
  input: { sheetId: string; page: number; name: string; points: Point[] }
): Promise<Result> {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false, error: "Name the space." };
  if ((input.points || []).length < 3)
    return { ok: false, error: "A space needs at least three corners." };
  // Degenerate polygons (all corners coincident/collinear) contain nothing
  // and would sit invisibly in the list forever — refuse them outright.
  if (polygonArea(input.points) < 1e-6)
    return { ok: false, error: "That outline has no area — draw the room's corners again." };
  const p = await addSpace(projectId, { ...input, by: user.name });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function renameSpaceAction(
  projectId: string,
  spaceId: string,
  name: string
): Promise<Result> {
  await requireUser();
  if (!name.trim()) return { ok: false, error: "Name the space." };
  const p = await renameSpace(projectId, spaceId, name);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function removeSpaceAction(
  projectId: string,
  spaceId: string
): Promise<Result> {
  await requireUser();
  const p = await removeSpace(projectId, spaceId);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/* ------------------------------ routes (D110) ------------------------------ */

export async function addRouteAction(
  projectId: string,
  input: { sheetId: string; page: number; partId: string; points: Point[]; aspect: number }
): Promise<Result> {
  const user = await requireUser();
  if ((input.points || []).length < 2)
    return { ok: false, error: "A wire run needs at least two points." };
  if (!(input.aspect > 0) || !Number.isFinite(input.aspect))
    return { ok: false, error: "The sheet hasn't finished loading — try again." };
  const part = await getPart(input.partId);
  if (!part) return { ok: false, error: "Pick a wire type from the catalog first." };
  if (!isPerLengthUnit(part.unit))
    return { ok: false, error: `${part.sku} is priced per ${part.unit}, not per length — wires need a per-foot part.` };
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!findCalibration(project.calibrations || [], input.sheetId, input.page))
    return { ok: false, error: "Calibrate this page before routing wire — lengths need a scale." };
  const p = await addRoute(projectId, { ...input, by: user.name });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function removeRouteAction(
  projectId: string,
  routeId: string
): Promise<Result> {
  await requireUser();
  const p = await removeRoute(projectId, routeId);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/* ----------------------------- revisions (D109) ----------------------------- */

export async function saveRevisionAction(
  projectId: string,
  note: string
): Promise<Result> {
  const user = await requireUser();
  const r = await addRevision(projectId, { by: user.name, reason: "manual", note: note.trim() });
  if (!r) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function restoreRevisionAction(
  projectId: string,
  rev: number
): Promise<Result> {
  const user = await requireUser();
  const r = await restoreRevision(projectId, rev, user.name);
  if (!r.ok)
    return { ok: false, error: r.reason === "no-such-rev" ? "That revision no longer exists." : "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/**
 * Turn the design's BOM into a draft quote — or refresh the one it already
 * minted, as long as that quote is still a draft. Once the quote moves past
 * draft (sent/won/lost) this action refuses rather than silently rewriting
 * numbers a customer may have seen — cutting a revision is the quote screen's
 * job, where that act carries its own audit trail.
 */
export async function createDraftQuoteAction(
  projectId: string
): Promise<{ ok: true; quoteId: string; updated: boolean } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const placements = project.placements || [];
  const routes = project.routes || [];
  if (!placements.length && !routes.length)
    return { ok: false, error: "Place a device or route a wire first." };

  const catalog = await listCatalog();
  const devLines = bomLines(placements, catalog);
  const devTotals = bomTotals(placements, catalog);
  const wires = routeLines(routes, catalog, project.calibrations || []);
  const lines = [...devLines, ...wires.lines];
  const value = devTotals.value + wires.value;
  const cost = devTotals.cost + wires.cost;
  const totals = { value, margin: value > 0 ? (value - cost) / value : 0 };
  const spec = {
    kind: "grid",
    gridProjectId: project.id,
    lines: lines.map((l) => ({
      sku: l.partId,
      desc: l.desc,
      qty: l.qty,
      unit: l.unit,
      price: l.list,
      ext: l.ext,
    })),
  };

  const existing = project.quoteId ? await getQuote(project.quoteId) : null;
  if (existing) {
    if (existing.status !== "draft")
      return {
        ok: false,
        error: `${existing.id} is already ${existing.status} — cut a revision from the quote screen instead.`,
      };
    await updateQuote(existing.id, {
      name: `${project.name} — The Grid design`,
      value: totals.value,
      margin: totals.margin,
      spec,
    });
    // The revision records exactly what was quoted (D109).
    await addRevision(projectId, { by: user.name, reason: "quote", note: `Quoted as ${existing.id}` });
    revalidatePath(editorPath(projectId));
    revalidatePath("/quotes");
    return { ok: true, quoteId: existing.id, updated: true };
  }

  const q = await createQuote({
    name: `${project.name} — The Grid design`,
    customer: project.customer,
    customerId: project.customerId,
    value: totals.value,
    margin: totals.margin,
    source: "grid",
    quoteType: "system",
    owner: user.name,
    spec,
  });
  await setQuote(project.id, q.id);
  await addRevision(projectId, { by: user.name, reason: "quote", note: `Quoted as ${q.id}` });
  revalidatePath(editorPath(projectId));
  revalidatePath("/quotes");
  revalidatePath("/design/grid");
  return { ok: true, quoteId: q.id, updated: false };
}
