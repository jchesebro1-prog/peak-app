"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { findCalibration, type Calibration, type MeasureUnit, type Point } from "@/lib/annotations";
import type { QuickScopeInputs } from "@/app/(app)/design/quick/engine";
import {
  addCurtainPlacement,
  addPlacement,
  addPlacements,
  addRevision,
  addRoute,
  addSpace,
  clearSheetCalibration,
  generateBaseSheet,
  getProject,
  movePlacement,
  removePlacement,
  removeProject,
  removeRoute,
  removeSpace,
  renameSpace,
  restoreRevision,
  seedBlankSheet,
  setPlacementCategory,
  setQuote,
  setScopeInputs,
  setSheetCalibration,
  setVenue,
  saveGridIntake,
} from "@/lib/stores/grid-projects";
import { deriveSeedPlacements, isSeedPlaceholder } from "@/lib/design/grid-seed";
import { can } from "@/lib/team";
import { getAllDesigns, removeDesign } from "@/lib/stores/designs";
import { docLocId, getSite } from "@/lib/identity/sites";
import { resolveTier } from "@/lib/pricing-tiers";
import { isTierPriced } from "@/lib/tier-pricing";
import { get as getPart, list as listCatalog } from "@/lib/stores/catalog";
import { createGridAssembly, getGridSymbol, listGridSymbols, setGridSymbolShape } from "@/lib/stores/grid-catalog";
import { isGridShape } from "@/lib/design/grid-symbols";
import {
  bomLines,
  bomTotals,
  curtainLines,
  GRID_CURTAIN_TYPES,
  GRID_FULLNESS,
  isPerLengthUnit,
  routeLines,
  type BomLine,
  type GridCurtain,
} from "@/lib/design/grid-bom";
import { isFabricRow, priceGridCurtains } from "@/lib/design/grid-curtains";
import { polygonArea } from "@/lib/design/grid-geometry";
import { validateDeviceWire } from "@/lib/catalog-connect";
import { create as createQuote, get as getQuote, update as updateQuote } from "@/lib/stores/quotes";
import type { AState } from "@/app/(app)/design/quick/engine";

/** The Grid editor server actions (D108). */

type Result = { ok: true } | { ok: false; error: string };

function editorPath(projectId: string): string {
  return `/design/grid/${encodeURIComponent(projectId)}`;
}

async function partForGrid(id: string) {
  const priced = await getPart(id);
  if (priced) return priced;
  const symbol = await getGridSymbol(id);
  return symbol ? { ...symbol, sku: symbol.modelNumber || symbol.id, unit: "ea" } : null;
}

export async function createGridAssemblyAction(input: {
  name: string;
  manufacturer: string;
  modelNumber: string;
  scope: string;
  members: Array<{ symbolId: string; qty: number; x: number; y: number }>;
  /** #131 — optional symbol override for the new entry ("" = category default). */
  shape?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false, error: "Name the assembly." };
  if (!input.members.length) return { ok: false, error: "Choose at least one child symbol." };
  const assembly = await createGridAssembly({
    name: input.name,
    manufacturer: input.manufacturer,
    modelNumber: input.modelNumber,
    scope: input.scope,
    members: input.members,
    shape: isGridShape(input.shape) ? input.shape : null,
    by: user.name,
  });
  revalidatePath("/design/grid");
  return { ok: true, id: assembly.id };
}

export async function saveGridIntakeAction(input: {
  projectId: string;
  venueName: string;
  locationName: string;
  address: string;
  notes: string;
  measurementBased: boolean;
  autoConfig: AState;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.venueName.trim() && !input.locationName.trim()) return { ok: false, error: "Add a venue or location to continue." };
  const project = await getProject(input.projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  const saved = await saveGridIntake(input.projectId, {
    complete: true,
    measurementBased: !!input.measurementBased,
    venueName: input.venueName.trim(),
    locationName: input.locationName.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
    autoConfig: input.autoConfig,
  });
  if (!saved) return { ok: false, error: "That design could not be found." };
  // First-save gate (Task 1, #38): a base sheet is generated exactly once —
  // the first time intake completes — never on a later re-save of venue
  // details. `sheetIds` is empty until then because createProject() no
  // longer pre-seeds a sheet at all (see grid-projects.ts createProject).
  // Re-checked on `saved` (the just-written doc) rather than the earlier
  // `project` read, to narrow — the doc-store has no transactions (#74),
  // so a true double-submit race isn't fully closed here, only shortened
  // from "the whole saveGridIntake write" to "this one re-read" — an
  // accepted, user-recoverable residual risk (delete the extra sheet),
  // consistent with this codebase's existing #74/#80/#85/#86 judgment
  // calls on low-probability concurrency edge cases.
  const isFirstSave = (saved.sheetIds || []).length === 0;
  if (isFirstSave) {
    if (input.measurementBased) {
      // A generated base sheet is stored as a static artifact, same as an
      // uploaded plan — it must never bake in the live, user-configurable
      // accent (AGENTS.md: "never hardcode accent-colored UI"), or every
      // sheet generated before a branding change goes stale forever. Use a
      // fixed neutral drawing-line ink instead of settings.accent.
      await generateBaseSheet(input.projectId, input.autoConfig, "#3a3f4a", user.name);
    } else {
      // "I have my own plan, skip measurements" — no VenueDims to render
      // from yet; seed the same blank fallback createProject() used to
      // create unconditionally, and let the user upload a real plan next.
      await seedBlankSheet(input.projectId, project.name, user.name);
    }
  }
  revalidatePath(editorPath(input.projectId));
  return { ok: true };
}

/**
 * "Generate starting layout from dims" (#38 Task 2, D14x) — paints real,
 * editable placements from the same parametric counts the Quick Design
 * estimator already guesses with (`compute()`), instead of leaving them
 * as numbers-only BOM lines. Additive by construction: `deriveSeedPlacements`
 * is diffed against every placement already carrying a `seededFrom` key, so
 * a re-run (after the user edits dims and re-saves intake) only adds the
 * delta — it never touches or duplicates what a prior run already placed,
 * and never touches a hand-placed device (those carry no `seededFrom` at
 * all). Devices land as placeholders (see grid-seed.ts's `SEED_PART_PREFIX`)
 * because there is no reliable mapping from "compute() says 2 electrics" to
 * one specific catalog SKU — punch #52's rule against inventing part
 * numbers applies here exactly as it did there.
 */
export async function seedStartingLayoutAction(
  projectId: string
): Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  if (!project.intake?.measurementBased || !project.intake.autoConfig) {
    return { ok: false, error: "This design wasn't set up from measurements — nothing to generate from." };
  }
  const baseSheetId = project.sheetIds[0];
  if (!baseSheetId) return { ok: false, error: "No plan sheet to seed onto yet." };

  const desired = deriveSeedPlacements(project.intake.autoConfig);
  const already = new Set(
    (project.placements || []).flatMap((pl) => (pl.seededFrom ? [pl.seededFrom] : []))
  );
  const delta = desired.filter((d) => !already.has(d.seededFrom));
  if (!delta.length) return { ok: true, added: 0, skipped: desired.length };

  const updated = await addPlacements(projectId, {
    sheetId: baseSheetId,
    page: 1,
    items: delta,
    by: user.name,
  });
  if (!updated) return { ok: false, error: "That design could not be found." };
  revalidatePath(editorPath(projectId));
  return { ok: true, added: delta.length, skipped: desired.length - delta.length };
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

/** Reposition an already-placed device (punch #47). Wires attached to it
 *  follow: the store does that in the same patch. */
export async function movePlacementAction(
  projectId: string,
  input: { placementId: string; x: number; y: number }
): Promise<Result> {
  await requireUser();
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y))
    return { ok: false, error: "That drop point isn't on the sheet." };
  const p = await movePlacement(projectId, input.placementId, { x: input.x, y: input.y });
  if (!p) return { ok: false, error: "That device is no longer on this design." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/* ------------------------------ curtains (#49) ------------------------------ */

/** Sanity ceiling on a drape dimension, in feet - a typo like 400 for 40 would
 *  otherwise quote five figures of fabric without a murmur. */
const MAX_CURTAIN_FT = 300;

/**
 * Drop a specced curtain onto the plan (punch #49). The dialog gathers Name,
 * Width, Height, Fullness and Fabric - Jeff's list - and this is where every
 * one of them is checked; the client's live price is a preview, the fabric
 * rate and the money come from the catalog here and at quote time.
 */
export async function placeCurtainAction(
  projectId: string,
  input: {
    sheetId: string;
    page: number;
    x: number;
    y: number;
    curtain: {
      type: string;
      name: string;
      widthFt: number;
      heightFt: number;
      fullnessPct: number;
      fabricSku: string;
    };
    category?: string;
  }
): Promise<Result> {
  const user = await requireUser();
  const c = input.curtain;
  if (!(GRID_CURTAIN_TYPES as readonly string[]).includes(c.type))
    return { ok: false, error: "Pick a curtain type: Border, Draw, Full or Leg." };
  const name = (c.name || "").trim();
  if (!name) return { ok: false, error: "Name the curtain: 'Main Grand Drape', 'US Border'…" };
  const width = Number(c.widthFt);
  const height = Number(c.heightFt);
  if (!(width > 0) || !(height > 0))
    return { ok: false, error: "Width and height must both be positive numbers of feet." };
  if (width > MAX_CURTAIN_FT || height > MAX_CURTAIN_FT)
    return { ok: false, error: `That drape is over ${MAX_CURTAIN_FT} ft, check the dimensions.` };
  if (!GRID_FULLNESS.some((f) => f.pct === Number(c.fullnessPct)))
    return { ok: false, error: "Fullness must be Flat, 50%, 75% or 100%." };
  const fabric = await getPart(c.fabricSku);
  if (!fabric || !isFabricRow(fabric))
    return { ok: false, error: "Pick a fabric from the catalog's fabric rows." };

  const curtain: GridCurtain = {
    type: c.type as GridCurtain["type"],
    name: name.slice(0, 80),
    widthFt: width,
    heightFt: height,
    fullnessPct: Number(c.fullnessPct),
    fabricSku: fabric.id,
  };
  const p = await addCurtainPlacement(projectId, {
    sheetId: input.sheetId,
    page: input.page,
    x: input.x,
    y: input.y,
    curtain,
    category: (input.category || "").trim().slice(0, 40),
    by: user.name,
  });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/* --------------------- user-defined categories (#48/#41) --------------------- */

/**
 * Label one placement with a user-defined category, or clear it with "".
 * Deliberately unvalidated against any list: Jeff asked for user-defined
 * categories, which means the vocabulary is his, not ours.
 */
export async function setPlacementCategoryAction(
  projectId: string,
  placementId: string,
  category: string
): Promise<Result> {
  await requireUser();
  const p = await setPlacementCategory(projectId, placementId, category || "");
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/**
 * #131 (D154): set or clear the symbol override on ONE grid-catalog entry.
 * Per-entry, not per-placement — placements resolve their part live, so every
 * placed instance of the entry (on every design) redraws with the new shape.
 */
export async function setSymbolShapeAction(
  projectId: string,
  symbolId: string,
  shape: string
): Promise<Result> {
  await requireUser();
  if (shape !== "" && !isGridShape(shape)) return { ok: false, error: "Unknown symbol." };
  const s = await setGridSymbolShape(symbolId, shape === "" ? null : shape);
  if (!s) return { ok: false, error: "That part is not in the Grid library." };
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
  input: {
    sheetId: string;
    page: number;
    partId: string;
    points: Point[];
    aspect: number;
    /** Device-wire endpoints (Task 4) — the client's hit-test result.
     *  Re-verified below; never trusted blindly. */
    fromPlacementId?: string;
    toPlacementId?: string;
  }
): Promise<Result> {
  const user = await requireUser();
  if ((input.points || []).length < 2)
    return { ok: false, error: "A wire run needs at least two points." };
  if (!(input.aspect > 0) || !Number.isFinite(input.aspect))
    return { ok: false, error: "The sheet hasn't finished loading — try again." };
  const part = await partForGrid(input.partId);
  if (!part) return { ok: false, error: "Pick a wire type from the catalog first." };
  if (!isPerLengthUnit(part.unit))
    return { ok: false, error: `${part.sku} is priced per ${part.unit}, not per length — wires need a per-foot part.` };
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!findCalibration(project.calibrations || [], input.sheetId, input.page))
    return { ok: false, error: "Calibrate this page before routing wire — lengths need a scale." };

  // Device-wire re-validation (Task 4, punch #39): the client's hit-test and
  // canConnect check are UX only — this is the authority. Re-derive
  // connectionType from the LIVE catalog (never trust a client-supplied
  // value) so neither a stale palette nor a tampered request can plant a
  // connectionType the current parts don't actually support.
  let connectionType: string | undefined;
  if (input.fromPlacementId && input.toPlacementId) {
    const fromPlacement = (project.placements || []).find((p) => p.id === input.fromPlacementId);
    const toPlacement = (project.placements || []).find((p) => p.id === input.toPlacementId);
    if (fromPlacement && toPlacement) {
      const [fromPart, toPart] = await Promise.all([
        partForGrid(fromPlacement.partId),
        partForGrid(toPlacement.partId),
      ]);
      const bothHavePorts = Boolean(fromPart?.ports?.length && toPart?.ports?.length);
      if (bothHavePorts) {
        const result = validateDeviceWire(fromPart!, toPart!);
        if (!result.ok)
          return { ok: false, error: `Wire refused — ${result.reason}: ${fromPlacement.partId} → ${toPlacement.partId} share no compatible port.` };
        connectionType = result.connectionType;
      }
    }
  }

  const p = await addRoute(projectId, {
    ...input,
    connectionType,
    by: user.name,
  });
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

/* ------------------------------ venue (D113.6) ------------------------------ */

export async function setVenueAction(
  projectId: string,
  siteId: string
): Promise<Result> {
  await requireUser();
  if (!siteId) {
    const p = await setVenue(projectId, null, "");
    if (!p) return { ok: false, error: "Design not found." };
    revalidatePath(editorPath(projectId));
    return { ok: true };
  }
  const site = await getSite(siteId);
  if (!site) return { ok: false, error: "That venue no longer exists." };
  const p = await setVenue(projectId, site.id, site.name || "Unnamed venue");
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/** Live-revisable basic-info snapshot for the Scope panel
 *  (D-manual-scope-targets) — no validation: any well-typed payload is
 *  accepted, including partial toggles the caller has already merged. */
export async function setScopeInputsAction(
  projectId: string,
  scopeInputs: QuickScopeInputs,
): Promise<Result> {
  await requireUser();
  const p = await setScopeInputs(projectId, scopeInputs);
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
 * Delete this design from inside its editor — restored from the Grid index's
 * deleteProjectAction, which the D-grid-merge commit deleted along with the
 * index page and never replaced.
 *
 * The Designs dashboard's deleteDesignAction is the usual route in; this one
 * exists because a PRE-MERGE Grid project has no design record pointing at it
 * (the GRD-5001 seed is one), so the dashboard cannot reach it at all. It
 * cascades the other way for merged records — project first, then whatever
 * design row points at it — so either entry point leaves the pair consistent.
 */
export async function deleteProjectAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't delete designs." };
  const project = await getProject(id);
  if (!project) return { ok: false, error: "Design not found." };
  await removeProject(id);
  // Reverse lookup, not a stored back-pointer — same idiom the Designs
  // dashboard uses for engagements. Designs number in the hundreds.
  const linked = (await getAllDesigns()).filter((d) => d.gridProjectId === id);
  for (const d of linked) await removeDesign(d.id);
  revalidatePath("/design/designs");
  revalidatePath("/design");
  return { ok: true };
}

/**
 * Whether a part can be tier-priced at all — the same condition tierCatalog
 * (below) uses to decide between the cost ÷ (1 − margin) re-derivation and
 * the part's plain list price. Pulled out as its own predicate (punch #76)
 * so the fallback-tracking set and the pure unit tests share one definition
 * instead of two copies of the same condition drifting apart. `cost` is a
 * required field on CatalogPart, but the `typeof` guard stays — a bulk
 * import or a bad edit can still land a non-numeric value at runtime even
 * when the static type promises otherwise.
 */

/**
 * Turn the design's BOM into a draft quote — or refresh the one it already
 * minted, as long as that quote is still a draft. Once the quote moves past
 * draft (sent/won/lost) this action refuses rather than silently rewriting
 * numbers a customer may have seen — cutting a revision is the quote screen's
 * job, where that act carries its own audit trail.
 */
export async function createDraftQuoteAction(
  projectId: string,
  laborLines?: Array<{ partId: string; hours: number }>
): Promise<
  | { ok: true; quoteId: string; updated: boolean; fallbackLines: string[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const placements = project.placements || [];
  const routes = project.routes || [];
  if (!placements.length && !routes.length)
    return { ok: false, error: "Place a device or route a wire first." };
  // Hard-fail on unresolved seed placeholders (Task 2, #38) rather than
  // let them silently price at $0 — the same "unresolved input must not
  // silently zero a real number" call already made for fabric weight
  // (#64). A placeholder's BOM line even LOOKS like a resolved-then-removed
  // catalog part ("removed part — no longer in the catalog"), which is
  // actively misleading here, not just missing. Naming the placement's own
  // label (its `category`, the human name deriveSeedPlacements gave it,
  // e.g. "Par") lets the user find and fix each one from the canvas.
  const unresolvedSeeds = placements.filter((p) => isSeedPlaceholder(p.partId));
  if (unresolvedSeeds.length) {
    const names = Array.from(new Set(unresolvedSeeds.map((p) => p.category || p.partId))).sort();
    return {
      ok: false,
      error:
        `${unresolvedSeeds.length} seeded device${unresolvedSeeds.length === 1 ? "" : "s"} ` +
        `still need${unresolvedSeeds.length === 1 ? "s" : ""} a real catalog part before this can ` +
        `price: ${names.join(", ")}. Delete and re-drop each from the catalog, then try again.`,
    };
  }

  // Venue + tier stamp (D113.6): same resolution as estimator quotes (D87);
  // re-stamped on every mint/update while the quote is still a draft. The
  // tier margin is resolved BEFORE pricing because it applies to every line
  // category on this quote — curtains, devices, wire runs and labor alike
  // (#63) — exactly as the estimator and the portal do.
  const tier = await resolveTier(project.customerId);

  const catalog = await listCatalog();
  const symbols = await listGridSymbols();
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  // Rebuild a quote-facing catalog from the independent Grid symbols. A
  // symbol with no pricingPartId is still valid design data; it simply carries
  // a zero price until someone links a price-book row later.
  const gridCatalog = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    return p
      ? { ...p, id: s.id, sku: s.modelNumber || p.sku, desc: s.name }
      : { id: s.id, sku: s.modelNumber || s.id, desc: s.name, category: s.category, unit: "ea", list: 0, cost: 0, ports: s.ports };
  });
  // Tier-priced catalog (#63): the same cost ÷ (1 − margin) re-derivation the
  // portal uses for its equipment lines (portal/actions.ts) and
  // customerCatalog() uses for the picker — a part without a usable cost, or
  // a margin outside (0, 1), keeps its plain list price. Devices, wire runs
  // and labor all price off this list below, so the tier margin actually
  // reaches every line, not just curtains.
  const tierSource = [
    ...gridCatalog,
    ...catalog.filter((p) => (p.role || "").toLowerCase() === "labor"),
  ];
  const tierCatalog = tierSource.map((p) => ({
    ...p,
    list: isTierPriced(p.cost, tier.margin)
      ? Math.round((p.cost / (1 - tier.margin)) * 100) / 100
      : p.list,
  }));
  // Punch #76: the fallback above is silent — a part with no usable cost (a
  // bulk import that only carried list prices, say) keeps its plain list
  // price while everything around it gets tier-priced, and nothing on the
  // quote said so even though pricingTier/tierMargin implies every line got
  // the tier treatment. Track which parts fell back, by BOTH id and SKU:
  // device/wire lines key off the catalog id, but the labor lines built below
  // key off the part's SKU instead (see the `labor.push` below), so a single
  // id-only set would silently miss labor fallbacks. Curtains are never in
  // this set — priceGridCurtains prices them straight from cost + margin with
  // no separate "list" to fall back to.
  const fallbackKeys = new Set(
    gridCatalog.filter((p) => !isTierPriced(p.cost, tier.margin)).flatMap((p) => [p.id, p.sku])
  );
  const isFallbackLine = (l: Pick<BomLine, "partId" | "kind">) =>
    l.kind !== "curtain" && fallbackKeys.has(l.partId);
  const devLines = bomLines(placements, tierCatalog);
  const devTotals = bomTotals(placements, tierCatalog);
  const wires = routeLines(routes, tierCatalog, project.calibrations || []);

  // Curtains (punch #49) - priced HERE, server-side, from the authoritative
  // cost model. The editor's sidebar price is a customer-safe mirror of this
  // same math and matches to the cent; this is the number that gets quoted.
  const curtainPrices = priceGridCurtains(placements, catalog, tier.margin);
  const fabricNames = new Map(
    catalog.filter(isFabricRow).map((p) => [p.id, p.desc] as const)
  );
  const curtains = curtainLines(
    placements,
    new Map([...curtainPrices].map(([id, v]) => [id, v.priceEach])),
    fabricNames
  );
  const curtainValue = curtains.reduce((a, l) => a + l.ext, 0);
  const curtainCostTotal = [...curtainPrices.values()].reduce((a, v) => a + v.costEach, 0);

  // Labor rides in only as hours against real catalog labor rows — the
  // client proposes, the server prices (D114). Priced off the tier catalog
  // (#63) so labor carries the same margin as everything else on the quote.
  const labor: Array<{ sku: string; desc: string; qty: number; unit: string; price: number; ext: number; cost: number }> = [];
  for (const l of laborLines || []) {
    const part = tierCatalog.find((p) => p.id === l.partId);
    const hours = Number(l.hours);
    if (!part || (part.role || "").toLowerCase() !== "labor") continue;
    if (!(hours > 0) || hours > 10000) continue;
    labor.push({
      sku: part.sku,
      desc: part.desc,
      qty: hours,
      unit: part.unit || "hr",
      price: part.list,
      ext: hours * part.list,
      cost: hours * part.cost,
    });
  }

  const lines: BomLine[] = [
    ...devLines,
    ...wires.lines,
    ...curtains,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value =
    devTotals.value + wires.value + curtainValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost =
    devTotals.cost + wires.cost + curtainCostTotal + labor.reduce((a, l) => a + l.cost, 0);
  const totals = { value, margin: value > 0 ? (value - cost) / value : 0 };

  // Punch #76: which of the assembled lines actually landed on a
  // fallback-priced part — computed once here so the flag on the spec below
  // and the list handed back to the caller (for the editor's banner) can
  // never disagree.
  const fallbackLines = lines.filter(isFallbackLine).map((l) => l.desc);

  const site = project.siteId ? await getSite(project.siteId) : null;
  const locationId = site ? docLocId(site) : null;
  const spec = {
    kind: "grid",
    gridProjectId: project.id,
    lines: lines.map((l) => ({
      // A curtain line's partId is its PLACEMENT id, not a catalog id (#49):
      // it has no SKU because it isn't a stocked part, and putting "gp-4f2a…"
      // in front of a customer would be nonsense. The description carries the
      // name, type, dimensions, fullness and fabric.
      sku: l.kind === "curtain" ? "CURTAIN" : l.partId,
      desc: l.desc,
      qty: l.qty,
      unit: l.unit,
      price: l.list,
      ext: l.ext,
      // Punch #76: this line's part had no usable cost (or the tier margin
      // itself was out of range) and so kept its plain list price while its
      // tier stamp (pricingTier/tierMargin, below) implies every line got
      // the tier treatment. Never a price change — a fallback line keeps its
      // list price — only a marker so the mix is visible on the document
      // instead of silent. Omitted (not `false`) on every ordinary line so
      // existing quotes/specs with no such lines are untouched.
      ...(isFallbackLine(l) ? { tierFallback: true as const } : {}),
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
      locationId,
      pricingTier: tier.tier,
      tierMargin: tier.margin,
      spec,
    });
    // The revision records exactly what was quoted (D109).
    await addRevision(projectId, { by: user.name, reason: "quote", note: `Quoted as ${existing.id}` });
    revalidatePath(editorPath(projectId));
    revalidatePath("/quotes");
    revalidatePath("/design/designs");
    return { ok: true, quoteId: existing.id, updated: true, fallbackLines };
  }

  const q = await createQuote({
    name: `${project.name} — The Grid design`,
    customer: project.customer,
    customerId: project.customerId,
    locationId,
    value: totals.value,
    margin: totals.margin,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    source: "grid",
    quoteType: "system",
    owner: user.name,
    spec,
  });
  await setQuote(project.id, q.id);
  await addRevision(projectId, { by: user.name, reason: "quote", note: `Quoted as ${q.id}` });
  revalidatePath(editorPath(projectId));
  revalidatePath("/quotes");
  revalidatePath("/design/designs");
  return { ok: true, quoteId: q.id, updated: false, fallbackLines };
}
