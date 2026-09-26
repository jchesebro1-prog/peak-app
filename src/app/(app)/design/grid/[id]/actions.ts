"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { findCalibration, type Calibration, type MeasureUnit, type Point } from "@/lib/annotations";
import type { QuickScopeInputs, SysKey, TierKey } from "@/app/(app)/design/quick/engine";
import {
  addCurtainPlacement,
  addOption,
  addPlacement,
  addRevision,
  addRoute,
  addSpace,
  clearSheetCalibration,
  generateBaseSheet,
  getProject,
  movePlacement,
  removeOption,
  removePlacement,
  removeProject,
  removeRoute,
  removeSheet,
  removeSpace,
  renameOption,
  renameProject,
  renameSpace,
  restoreRevision,
  setOptionQuote,
  setPlacementCategory,
  setScopeInputs,
  setLinesetDesign,
  setSheetCalibration,
  setVenue,
  saveGridIntake,
  setAutoEstimate,
} from "@/lib/stores/grid-projects";
import { defaultOptionId, hasOption, resolveOptionId } from "@/lib/design/grid-options";
import { designPatchFromIntake, intakeScopeInputs } from "@/lib/design/grid-intake";
import { buildGridQuote } from "@/lib/design/grid-quote";
import { can } from "@/lib/team";
import { getAllDesigns, removeDesign, updateDesign } from "@/lib/stores/designs";
import { getSite } from "@/lib/identity/sites";
// Tier resolution, catalog listing and the BOM/curtain pricing moved verbatim
// into lib/design/grid-quote.ts (D186) so a quote can be built per option on a
// scratch DB; the blob upload this action used to do moved to
// /api/grid-sheets/upload (#146, D173) because a server action caps at 1200kb.
import { get as getPart, getMany as getCatalogParts } from "@/lib/stores/catalog";
import { createGridAssembly, removeGridAssembly, setGridSymbolLook } from "@/lib/stores/grid-catalog";
import { fillAutoScopes } from "@/lib/design/grid-auto-fill";
import {
  AUTO_SCOPES,
  assemblySwapCandidates,
  autoEstimateCards,
  clampScopeInputs,
  curtainSwapHits,
  partSwapHits,
  priceOverrides,
  scopeLabelOf,
  sellOnlyCards,
  type AutoEquipHit,
  type SellCard,
} from "@/lib/design/auto-estimate";
import { autoEstimateFor, mergeScopeEstimate, overrideRefs, sanitizeAutoEstimate, type AutoEstimate, type AutoOverride } from "@/lib/design/grid-auto-model";
import { buildEquipmentPriceTable, isTierKey, sellFromCost } from "@/lib/design/equipment-map";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates } from "@/lib/stores/pricing";
import { fixtureSkus, resolveFixture } from "@/lib/fixture-assemblies";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import { partForGrid } from "@/lib/design/grid-part-lookup";
import { getDesign } from "@/lib/stores/studio-designs";
import { createClientPackage } from "@/lib/client-package-server";
import { isGridShape } from "@/lib/design/grid-symbols";
import { isGridIconId, isHexColor } from "@/lib/design/grid-icons";
import { isGridLayer } from "@/lib/design/grid-scopes";
import {
  GRID_CURTAIN_TYPES,
  GRID_FULLNESS,
  isPerLengthUnit,
  type GridCurtain,
} from "@/lib/design/grid-bom";
import { isFabricRow } from "@/lib/design/grid-curtains";
import { polygonArea } from "@/lib/design/grid-geometry";
import { validateDeviceWire, resolveWireTypes } from "@/lib/catalog-connect";
import { getSettings } from "@/lib/settings";
import { create as createQuote, get as getQuote, update as updateQuote } from "@/lib/stores/quotes";
import type { AState } from "@/app/(app)/design/quick/engine";

/** The Grid editor server actions (D108). */

type Result = { ok: true } | { ok: false; error: string };

function editorPath(projectId: string): string {
  return `/design/grid/${encodeURIComponent(projectId)}`;
}

const OPTION_GONE = "That option was removed — refresh the page.";

export async function createGridAssemblyAction(input: {
  name: string;
  manufacturer: string;
  modelNumber: string;
  scope: string;
  members: Array<{ symbolId: string; qty: number; x: number; y: number }>;
  /** Legacy #131 shape override, kept for back-compat callers ("" = category
   *  default). Superseded by `icon` (#206) — a caller that sends both gets
   *  `icon` (createGridAssembly clears `shape` when `icon` is set). */
  shape?: string;
  /** Per-entry stock-symbol icon override (#206, "" = category default). */
  icon?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false, error: "Name the assembly." };
  if (!input.members.length) return { ok: false, error: "Choose at least one child symbol." };
  if (input.icon && !isGridIconId(input.icon)) return { ok: false, error: "Unknown icon." };
  if (input.scope && !isGridLayer(input.scope)) return { ok: false, error: "Unknown scope." };
  let assembly: Awaited<ReturnType<typeof createGridAssembly>>;
  try {
    assembly = await createGridAssembly({
      name: input.name,
      manufacturer: input.manufacturer,
      modelNumber: input.modelNumber,
      scope: input.scope,
      members: input.members,
      shape: isGridShape(input.shape) ? input.shape : null,
      icon: isGridIconId(input.icon) ? input.icon : null,
      by: user.name,
    });
  } catch (error) {
    console.error("createGridAssemblyAction: assembly mint failed", error);
    return { ok: false, error: "Couldn’t save that assembly — please try again." };
  }
  revalidatePath("/design/grid");
  return { ok: true, id: assembly.id };
}

export async function removeGridAssemblyAction(id: string): Promise<Result> {
  await requireUser();
  const r = await removeGridAssembly(id);
  if (!r.ok) {
    return {
      ok: false,
      error: r.reason === "not-an-assembly" ? "Only assemblies you built can be deleted." : "That assembly could not be found.",
    };
  }
  revalidatePath("/design/grid");
  return { ok: true };
}

/**
 * The Equipment step's live cards (#GEM, spec §5): the equations for the
 * given scope inputs, priced at each scope's tier from the Equipment map (or
 * this design's swaps), SELL-ONLY — no unit cost crosses to the client. Reads
 * only the SKUs the map and the swaps reference.
 */
export async function previewAutoEstimateAction(input: {
  inputs: QuickScopeInputs;
  estimate: AutoEstimate;
}): Promise<{ ok: true; cards: SellCard[] } | { ok: false; error: string }> {
  await requireUser();
  if (!input?.inputs) return { ok: false, error: "Missing venue inputs." };
  const est = sanitizeAutoEstimate(input.estimate);
  const refs = overrideRefs(est);
  const { map, ctx } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  const cards = autoEstimateCards(clampScopeInputs(input.inputs), est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx));
  return { ok: true, cards: sellOnlyCards(cards) };
}

export type { AutoEquipHit } from "@/lib/design/auto-estimate";

/**
 * Swap picker search (#GEM; curtain-row scoping #GEM fix wave 1 I2/M1):
 * `rowKey` picks the branch. A curtain row (equipment-vocab's `curtain`
 * shape) swaps only to a Fabric part priced by area rate — never an
 * assembly, and never the generic cost>0||list>0 filter, which would hide
 * the normal case of a list-less, cost-less fabric. Every other row keeps
 * the part search as before, plus a System/Fixture assembly search now
 * scoped to the row's own SysKey (a System by its `scope`; a Fixture only on
 * a Lighting row) instead of matching on label text alone. SELL numbers only.
 */
export async function searchAutoEquipmentAction(query: string, rowKey: string): Promise<{ hits: AutoEquipHit[] }> {
  await requireUser();
  const q = String(query ?? "").trim();
  if (q.length < 2) return { hits: [] };
  const def = EQUIPMENT_ROW_BY_KEY.get(String(rowKey ?? ""));
  if (def?.curtain) {
    const { hits } = await searchCatalog(q, "Fabric", 15);
    if (!hits.length) return { hits: [] };
    const [parts, rates] = await Promise.all([getCatalogParts(hits.map((h) => h.sku)), getCatalogRates()]);
    const bySku = new Map(parts.map((p) => [p.sku, p]));
    return { hits: curtainSwapHits(hits.map((h) => ({ sku: h.sku, desc: h.desc, curtainAreaRate: bySku.get(h.sku)?.curtainAreaRate })), rates.defaultMargin) };
  }
  const [{ hits }, fixtures, rates] = await Promise.all([searchCatalog(q, "", 15), listFixtures(), getCatalogRates()]);
  const m = rates.defaultMargin;
  const partHits = partSwapHits(hits, m);
  const ql = q.toLowerCase();
  const scopeLabel = def ? scopeLabelOf(def.system) : "";
  const matched = assemblySwapCandidates(
    fixtures.filter((f) => `${f.label} ${f.description}`.toLowerCase().includes(ql)),
    scopeLabel
  ).slice(0, 10);
  const fxParts = matched.length ? await getCatalogParts([...new Set(matched.flatMap((f) => fixtureSkus(f)))]) : [];
  const asmHits: AutoEquipHit[] = matched.map((f) => {
    const r = resolveFixture(f, fxParts);
    return { kind: "assembly", ref: f.id, desc: `${f.label} (${f.kind})`, unit: "ea", unitSell: r.sell > 0 ? r.sell : sellFromCost(r.cost, m) };
  });
  return { hits: [...asmHits, ...partHits] };
}

export async function saveGridIntakeAction(input: {
  projectId: string;
  /** "auto" = Auto (equations); "manual" = Blank (stored as before, D-GEM-7). */
  mode: "manual" | "auto";
  venueName: string;
  locationName: string;
  address: string;
  notes: string;
  autoConfig: AState;
  estimate?: AutoEstimate;
}): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.venueName.trim() && !input.locationName.trim()) return { ok: false, error: "Add a venue or location to continue." };
  if (input.mode !== "manual" && input.mode !== "auto") return { ok: false, error: "Choose Auto or Blank." };
  const scopeInputs = intakeScopeInputs(input.autoConfig);
  const autoScopes = input.mode === "auto" ? AUTO_SCOPES.filter((k) => scopeInputs.sys[k]) : [];
  if (input.mode === "auto" && autoScopes.length === 0) return { ok: false, error: "Pick at least one scope for Auto to fill." };
  const est: AutoEstimate | null =
    input.mode === "auto"
      ? (() => {
          const clean = sanitizeAutoEstimate(input.estimate);
          return {
            tierByScope: Object.fromEntries(autoScopes.map((k) => [k, clean.tierByScope[k] ?? "better"])),
            overrides: Object.fromEntries(Object.entries(clean.overrides).filter(([k]) => autoScopes.some((s) => k.startsWith(`${s}:`)))),
          };
        })()
      : null;
  const project = await getProject(input.projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  const optionId = resolveOptionId(project, null);
  const saved = await saveGridIntake(input.projectId, {
    complete: true,
    measurementBased: true,
    mode: input.mode,
    venueName: input.venueName.trim(),
    locationName: input.locationName.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
    autoConfig: input.autoConfig,
  });
  if (!saved) return { ok: false, error: "That design could not be found." };
  // First-save gate (D145) — see the pre-#GEM comment: idempotent re-applies
  // first, generateBaseSheet (the sentinel) last. The Auto fill (#GEM) runs
  // after the sheet exists; if it fails the plan still opens, with a warning,
  // and "Change equipment…" re-fills. `est`, when present, is stored under
  // THIS option (D-GEM-12 — autoEstimate is per option, not project-wide).
  let warning: string | undefined;
  const isFirstSave = (saved.sheetIds || []).length === 0;
  if (isFirstSave) {
    await setScopeInputs(input.projectId, scopeInputs);
    // #GEM fix wave 1 (M6): setAutoEstimate refuses (null) when the option it
    // was resolved against is already gone — a specific warning instead of
    // silently proceeding to fill from an estimate that was never saved.
    let estimateSaved = true;
    if (est) {
      const savedEstimate = await setAutoEstimate(input.projectId, optionId, est);
      if (!savedEstimate) {
        estimateSaved = false;
        warning = "The plan is ready, but your equipment choices could not be saved — that option may have been removed. Use “Change equipment…” in the Scope panel to try again.";
      }
    }
    const patch = designPatchFromIntake({
      projectName: project.name,
      venueName: input.venueName,
      locationName: input.locationName,
      a: input.autoConfig,
    });
    const linked = (await getAllDesigns()).filter((d) => d.gridProjectId === input.projectId);
    for (const d of linked) await updateDesign(d.id, patch);
    if (patch.name) await renameProject(input.projectId, patch.name);
    await generateBaseSheet(input.projectId, input.autoConfig, "#3a3f4a", user.name);
    if (est && estimateSaved) {
      // #GEM fix wave 1 (I1): a thrown error here (not just a returned
      // {ok:false}) must not fail the whole save — the base sheet, scope
      // inputs and autoEstimate are already persisted, so the plan still
      // opens, with the same "Change equipment…" recovery as a returned
      // failure.
      let res: Awaited<ReturnType<typeof fillAutoScopes>>;
      try {
        const fresh = await getProject(input.projectId);
        res = fresh
          ? await fillAutoScopes(input.projectId, resolveOptionId(fresh, null), autoScopes, user.name)
          : { ok: false, error: "That design could not be found." };
      } catch (error) {
        console.error("saveGridIntakeAction: Auto fill threw", error);
        res = { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
      }
      if (!res.ok) warning = `The plan is ready, but Auto could not fill it: ${res.error} Use “Change equipment…” in the Scope panel to try again.`;
      else if (res.needsPart > 0)
        warning = `${res.needsPart} line${res.needsPart === 1 ? "" : "s"} still need${res.needsPart === 1 ? "s" : ""} a part in the Equipment map and ${res.needsPart === 1 ? "was" : "were"} left off the plan.`;
    }
  }
  revalidatePath(editorPath(input.projectId));
  revalidatePath("/design/designs");
  return { ok: true, ...(warning ? { warning } : {}) };
}

/** Link the Grid to a saved Lineset Builder design. The schedule remains a
 * live derivation of the saved inputs, so edits to that design are reflected
 * the next time the Grid schedule is opened. */
export async function linkLinesetDesignAction(
  projectId: string,
  designId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (designId) {
    const design = await getDesign(designId);
    if (!design || design.kind !== "lineset") return { ok: false, error: "Choose a saved Lineset Builder design." };
  }
  const updated = await setLinesetDesign(projectId, designId);
  if (!updated) return { ok: false, error: "That design could not be found." };
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/schedule`);
  return { ok: true };
}

/** Build and store the customer-facing Grid package (punch #40). */
export async function createClientPackageAction(
  projectId: string,
  optionId: string | null,
): Promise<{ ok: true; packageId: string; url: string; gapCount: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  try {
    const built = await createClientPackage(project, user.name, optionId);
    revalidatePath(editorPath(projectId));
    return {
      ok: true,
      packageId: built.record.id,
      url: `/api/client-packages/${encodeURIComponent(built.record.id)}`,
      gapCount: built.gaps.length,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The client package could not be built." };
  }
}

export async function placeDeviceAction(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; optionId: string }
): Promise<Result> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
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
      color?: string;
    };
    category?: string;
    optionId: string;
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
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };

  const curtain: GridCurtain = {
    type: c.type as GridCurtain["type"],
    name: name.slice(0, 80),
    widthFt: width,
    heightFt: height,
    fullnessPct: Number(c.fullnessPct),
    fabricSku: fabric.id,
    color: (c.color || "").trim().slice(0, 40) || undefined,
  };
  const p = await addCurtainPlacement(projectId, {
    sheetId: input.sheetId,
    page: input.page,
    x: input.x,
    y: input.y,
    curtain,
    category: (input.category || "").trim().slice(0, 40),
    optionId: input.optionId,
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
 * Stock symbols (spec 2026-09-25): set or clear ONE grid-catalog entry's
 * icon and/or colour. Per-entry, not per-placement — placements resolve
 * their part live, so every placed instance, on every design, redraws.
 * Only the keys present change; "" clears that key back to the resolved
 * default. Setting or clearing the icon also clears the legacy D154 `shape`
 * (setGridSymbolLook). requireUser, the same gate as the #131 shape action.
 */
export async function setSymbolLookAction(
  projectId: string,
  symbolId: string,
  look: { icon?: string; color?: string }
): Promise<Result> {
  await requireUser();
  const patch: { icon?: string | null; color?: string | null } = {};
  if (look.icon !== undefined) {
    if (look.icon !== "" && !isGridIconId(look.icon)) return { ok: false, error: "Unknown icon." };
    patch.icon = look.icon || null;
  }
  if (look.color !== undefined) {
    if (look.color !== "" && !isHexColor(look.color)) return { ok: false, error: "Colour must be #rrggbb." };
    patch.color = look.color ? look.color.toLowerCase() : null;
  }
  if (!("icon" in patch) && !("color" in patch)) return { ok: true };
  const s = await setGridSymbolLook(symbolId, patch);
  if (!s) return { ok: false, error: "That part is not in the Grid library." };
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/riser`);
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

/** Delete a plan sheet from the editor's sheet list (the sheet's own doc
 *  stays put — see removeSheet, grid-projects.ts — so an older revision can
 *  still resolve it). Refuses while a placement/space/route on the LIVE
 *  design still references it. */
export async function removeSheetAction(
  projectId: string,
  sheetId: string
): Promise<Result> {
  await requireUser();
  const r = await removeSheet(projectId, sheetId);
  if (!r.ok) {
    return {
      ok: false,
      error:
        r.reason === "in-use"
          ? "This sheet still has devices, spaces, or wires on it — remove those first."
          : "That sheet could not be found.",
    };
  }
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
    optionId: string;
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
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
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
        // Admin-edited wire-type registry (Design → Grid Settings) — this is
        // the authority (see the comment above), so it must read the SAME
        // registry the client's UX-only pre-check used, not the hardcoded
        // DEFAULT_WIRE_TYPES fallback (validateDeviceWire's default param).
        const settings = await getSettings();
        const result = validateDeviceWire(fromPart!, toPart!, resolveWireTypes(settings.wireTypes));
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

/* ------------------------------ options (Spec 1) ------------------------------ */

export async function addOptionAction(
  projectId: string,
  input: { name: string; copyFromOptionId?: string | null }
): Promise<{ ok: true; optionId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await addOption(projectId, {
    name: input.name,
    ...(input.copyFromOptionId ? { copyFromOptionId: input.copyFromOptionId } : {}),
    by: user.name,
  });
  if (!r.ok) {
    if (r.reason === "empty-name") return { ok: false, error: "Name the option — 'Good', 'Better', 'Alternate'…" };
    if (r.reason === "no-such-option") return { ok: false, error: OPTION_GONE };
    return { ok: false, error: "Design not found." };
  }
  revalidatePath(editorPath(projectId));
  return { ok: true, optionId: r.option.id };
}

export async function renameOptionAction(projectId: string, optionId: string, name: string): Promise<Result> {
  await requireUser();
  const r = await renameOption(projectId, optionId, name);
  if (!r.ok) {
    if (r.reason === "empty-name") return { ok: false, error: "An option needs a name." };
    if (r.reason === "no-such-option") return { ok: false, error: OPTION_GONE };
    return { ok: false, error: "Design not found." };
  }
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function removeOptionAction(
  projectId: string,
  optionId: string
): Promise<{ ok: true; removedPlacements: number; removedRoutes: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await removeOption(projectId, optionId, user.name);
  if (!r.ok) {
    if (r.reason === "last-option") return { ok: false, error: "A design keeps at least one option — add another before removing this one." };
    if (r.reason === "no-such-option") return { ok: false, error: OPTION_GONE };
    return { ok: false, error: "Design not found." };
  }
  revalidatePath(editorPath(projectId));
  return { ok: true, removedPlacements: r.removedPlacements, removedRoutes: r.removedRoutes };
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
  optionId: string | null,
  laborLines?: Array<{ partId: string; hours: number }>
): Promise<
  | { ok: true; quoteId: string; updated: boolean; fallbackLines: string[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const resolvedOptionId = resolveOptionId(project, optionId);
  if (optionId && resolvedOptionId !== optionId) return { ok: false, error: OPTION_GONE };
  const option = project.options!.find((o) => o.id === resolvedOptionId)!;

  const built = await buildGridQuote(project, resolvedOptionId, laborLines);
  if (!built.ok) return built;
  const { build } = built;

  const existing = option.quoteId ? await getQuote(option.quoteId) : null;
  if (existing) {
    if (existing.status !== "draft")
      return { ok: false, error: `${existing.id} is already ${existing.status} — cut a revision from the quote screen instead.` };
    await updateQuote(existing.id, {
      name: build.quoteName,
      value: build.value,
      margin: build.margin,
      locationId: build.locationId,
      pricingTier: build.tier.tier,
      tierMargin: build.tier.margin,
      spec: build.spec,
    });
    await addRevision(projectId, { by: user.name, reason: "quote", note: `${option.name} quoted as ${existing.id}` });
    revalidatePath(editorPath(projectId));
    revalidatePath("/quotes");
    revalidatePath("/design/designs");
    return { ok: true, quoteId: existing.id, updated: true, fallbackLines: build.fallbackLines };
  }

  let q;
  try {
    q = await createQuote({
      name: build.quoteName,
      customer: project.customer,
      customerId: project.customerId,
      locationId: build.locationId,
      value: build.value,
      margin: build.margin,
      pricingTier: build.tier.tier,
      tierMargin: build.tier.margin,
      source: "grid",
      quoteType: "system",
      owner: user.name,
      spec: build.spec,
    });
  } catch (error) {
    console.error("createDraftQuoteAction: quote mint failed", error);
    return { ok: false, error: "Couldn’t create the draft quote — please try again." };
  }
  await setOptionQuote(project.id, resolvedOptionId, q.id);
  await addRevision(projectId, { by: user.name, reason: "quote", note: `${option.name} quoted as ${q.id}` });
  revalidatePath(editorPath(projectId));
  revalidatePath("/quotes");
  revalidatePath("/design/designs");
  return { ok: true, quoteId: q.id, updated: false, fallbackLines: build.fallbackLines };
}

/**
 * "Change equipment…" (#GEM, spec §5): re-choose ONE Auto scope's tier,
 * swaps and quantities, save them on the project, and re-fill only that
 * scope in this option. Untouched Auto devices are replaced; devices moved or
 * edited by hand stay. The UI confirms first (ConfirmButton).
 *
 * Adapted from the brief for D-GEM-12 (not in the original brief):
 * autoEstimate is stored PER OPTION, so the current choices are read with
 * autoEstimateFor(project.autoEstimate, optionId, defaultOptionId) and saved
 * back with setAutoEstimate(projectId, optionId, …) rather than a single
 * project-wide value.
 */
export async function refillScopeAction(input: {
  projectId: string;
  optionId: string;
  scope: SysKey;
  tier: TierKey;
  overrides: Record<string, AutoOverride>;
}): Promise<{ ok: true; added: number; removed: number; needsPart: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(input.projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
  const est = autoEstimateFor(project.autoEstimate, input.optionId, defaultOptionId(project));
  if (!est || !est.tierByScope[input.scope]) return { ok: false, error: "Only Auto scopes can be re-filled." };
  if (!isTierKey(input.tier)) return { ok: false, error: "Pick Good, Better or Best." };
  await setAutoEstimate(input.projectId, input.optionId, mergeScopeEstimate(est, input.scope, input.tier, input.overrides || {}));
  const res = await fillAutoScopes(input.projectId, input.optionId, [input.scope], user.name);
  if (!res.ok) return res;
  revalidatePath(editorPath(input.projectId));
  return res;
}
