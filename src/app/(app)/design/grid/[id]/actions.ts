"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { clamp01, findCalibration, type Calibration, type MeasureUnit, type Point } from "@/lib/annotations";
import { clampConfigDims, venueOf, type QuickScopeInputs, type SysKey, type TierKey } from "@/app/(app)/design/quick/engine";
import { clampHouseFieldsFor } from "@/lib/design/venue-templates/house-dims";
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
  removeAccessory,
  removeCustomItem,
  removeOption,
  removePlacement,
  removePlacements,
  movePlacements,
  setPlacementsCategory,
  setPlacementsPart,
  pastePlacements,
  restoreItems,
  type GridPlacement,
  type GridRoute,
  type PasteItem,
  type RemovedBundle,
  MAX_BATCH,
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
  setSymbolDisplay,
  setLinesetDesign,
  setLaborOverride,
  setSheetCalibration,
  setVenue,
  setProjectCustomer,
  saveAccessory,
  saveCustomItem,
  saveGridIntake,
  setAutoEstimate,
  addIntakeNotices,
  removeIntakeNotice,
} from "@/lib/stores/grid-projects";
import { defaultOptionId, estimateLinkOf, estimateOwnedRefusal, hasOption, resolveOptionId } from "@/lib/design/grid-options";
import { attachPlanCandidate, planCandidatesFor } from "@/lib/design/grid-plan-intake-server";
import { estimateTrayParts } from "@/lib/design/estimate-tray-server";
import { cleanNoticeText, newNoticeId, publicPlanCandidates, type GridIntakeNotice, type PlanCandidate } from "@/lib/design/grid-plan-intake";
import { coverFromVenue, designPatchFromIntake, intakeScopeInputs, pickedVenueMissing, siteForLocId } from "@/lib/design/grid-intake";
import { resolveIntakeCustomer, validateIntakeCustomer } from "@/lib/intake-customer";
import type { IntakeCustomerChoice } from "@/app/(app)/quotes/new/types";
import { get as getCustomer } from "@/lib/stores/customers";
import { buildGridQuote } from "@/lib/design/grid-quote";
import type { GridCustomItemInput } from "@/lib/design/grid-custom-items";
import { accessoryClampNote, type GridAccessoryInput } from "@/lib/design/grid-accessories";
import { can } from "@/lib/team";
import { designsForGridProject, removeDesign, updateDesign } from "@/lib/stores/designs";
import { getSite, sitesForCompany } from "@/lib/identity/sites";
// Tier resolution, catalog listing and the BOM/curtain pricing moved verbatim
// into lib/design/grid-quote.ts (D186) so a quote can be built per option on a
// scratch DB; the blob upload this action used to do moved to
// /api/grid-sheets/upload (#146, D173) because a server action caps at 1200kb.
import { getMany as getCatalogParts } from "@/lib/stores/catalog";
import { createGridAssembly, ensureGridSymbolsFor, removeGridAssembly, setGridSymbolLook } from "@/lib/stores/grid-catalog";
import { pushGridRecent, toggleGridFavorite } from "@/lib/stores/device-types";
import { autoNeedsPart, fillAutoScopes } from "@/lib/design/grid-auto-fill";
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
import {
  autoEstimateFor,
  cleanLotQty,
  mergeScopeEstimate,
  overrideRefs,
  sanitizeAutoEstimate,
  sanitizeAutoOrigin,
  sanitizeAutoTag,
  type AutoEstimate,
  type AutoOverride,
} from "@/lib/design/grid-auto-model";
import { buildEquipmentPriceTable, isTierKey, sellFromCost } from "@/lib/design/equipment-map";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates, loadWireLaborRules } from "@/lib/stores/pricing";
import { fixtureSkus, resolveFixture } from "@/lib/fixture-assemblies";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import { partForGrid, placeablePartIds } from "@/lib/design/grid-part-lookup";
import { getDesign } from "@/lib/stores/studio-designs";
import { createClientPackage } from "@/lib/client-package-server";
import { headers } from "next/headers";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import type { CutSheetsAdded } from "@/lib/curtain-cut-sheets/package-sheets";
import { isGridShape } from "@/lib/design/grid-symbols";
import { isGridIconId, isHexColor } from "@/lib/design/grid-icons";
import { isGridLayer } from "@/lib/design/grid-scopes";
import { isPerLengthUnit, type GridCurtain } from "@/lib/design/grid-bom";
import { checkCurtainInput, type CurtainInput } from "@/lib/design/grid-curtain-input";
import { polygonArea } from "@/lib/design/grid-geometry";
import { validateDeviceWire, resolveWireTypes } from "@/lib/catalog-connect";
import { getSettings } from "@/lib/settings";
import { effectiveTemplateFor, sanitizeTemplateId } from "@/lib/design/venue-templates";
import { sanitizeMovables } from "@/lib/design/venue-templates/movable-options";
import { venueTypesFrom } from "@/lib/venue-types";
import { create as createQuote, get as getQuote, update as updateQuote } from "@/lib/stores/quotes";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { displayQuoteNumber } from "@/lib/estimate-number";
import type { AState } from "@/app/(app)/design/quick/engine";

/** The Grid editor server actions (D108). */

type Result = { ok: true } | { ok: false; error: string };
/** placeDeviceAction / placeCurtainAction (#299): the new record, for undo. */
type PlacedResult = { ok: true; placement: GridPlacement } | { ok: false; error: string };

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
 * The Equipment step's live cards (#211, spec §5): the equations for the
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
  const [{ map, ctx }, rules] = await Promise.all([
    loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds }),
    loadWireLaborRules(),
  ]);
  const cards = autoEstimateCards(clampScopeInputs(input.inputs), est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx), rules);
  return { ok: true, cards: sellOnlyCards(cards) };
}

export type { AutoEquipHit } from "@/lib/design/auto-estimate";

/**
 * Swap picker search (#211; curtain-row scoping #211 fix wave 1 I2/M1):
 * `rowKey` picks the branch. A curtain row (equipment-vocab's `curtain`
 * shape) swaps only to a fabric part (#264: isFabricPart) priced by area rate — never an
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
    // #264: unit + cost ride along so a sq-ft Soft Goods fabric prices at its cost.
    return {
      hits: curtainSwapHits(
        hits.map((h) => {
          const p = bySku.get(h.sku);
          return { sku: h.sku, desc: h.desc, curtainAreaRate: p?.curtainAreaRate, costPerSqft: p?.costPerSqft, unit: p?.unit, cost: p?.cost };
        }),
        rates.defaultMargin
      ),
    };
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

/**
 * The one-page Grid intake's save (#211; #244 adds the title and the
 * customer). Validation runs before any write — the customer is required
 * (the quote intake's own rule and messages, lib/intake-customer), and a
 * picked or new customer venue satisfies "Add a venue or location". The
 * customer / new venue / new contact are then created exactly as the quote
 * intake creates them, the project is linked (customer, contact, venue →
 * siteId), and the first-save gate below runs unchanged, now also copying
 * the title and customer onto the linked design record(s).
 */
/** #255: a client's movable rooms kept only as template `tpl` allows (sanitizeMovables); absent stays absent. */
function cleanMovables<T extends { movables?: AState["movables"] }>(x: T, tpl: string | null): T {
  return x.movables == null ? x : { ...x, movables: sanitizeMovables(x.movables, tpl) };
}

export async function saveGridIntakeAction(input: {
  projectId: string;
  /** "auto" = Auto (equations); "manual" = Blank (stored as before, D307). */
  mode: "manual" | "auto";
  /** #244 — the typed design title; "" keeps the "Venue — Location" auto-name. */
  title?: string;
  /** #244 — the customer / venue / contact picks (CustomerVenueContactPicker). */
  customer: IntakeCustomerChoice;
  venueName: string;
  locationName: string;
  address: string;
  notes: string;
  autoConfig: AState;
  estimate?: AutoEstimate;
  /** #314: an on-file plan to copy in as the FIRST sheet ("Use plan from …") — a candidate id, never a path. */
  planCandidateId?: string | null;
}): Promise<{ ok: true; warning?: string; planRetry?: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (input.mode !== "manual" && input.mode !== "auto") return { ok: false, error: "Choose Auto or Blank." };
  // #314: a design drawn from an estimate takes its parts from the estimate —
  // Auto (equations) would invent a second BOM, so it is refused here too.
  if (input.mode === "auto") {
    const p = await getProject(input.projectId);
    const link = p ? estimateLinkOf(p) : null;
    if (link) return { ok: false, error: `Auto isn't offered for a design drawn from an estimate — ${await estimateRefusal(link.quoteId)}` };
  }
  if (!input.customer) return { ok: false, error: "Pick a customer, or add a new one." };
  const customerCheck = validateIntakeCustomer(input.customer);
  if (!customerCheck.ok) return { ok: false, error: customerCheck.error };
  // #244 review — a picked venue must still be on the chosen customer (a
  // stale form or a forged id), checked before any write.
  const customerSites = customerCheck.creatingCustomer ? [] : await sitesForCompany(customerCheck.pickedCustomerId);
  if (pickedVenueMissing(input.customer, customerSites)) return { ok: false, error: "That venue is no longer on this customer — pick it again." };
  const venueChosen =
    (input.customer.locationMode === "pick" && !!(input.customer.locationId || "").trim()) || input.customer.locationMode === "new";
  if (!input.venueName.trim() && !input.locationName.trim() && !venueChosen) return { ok: false, error: "Add a venue or location to continue." };
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

  // #244 — the customer, and any new venue/contact, exactly as the quote
  // intake makes them; then the chosen venue's site (the project stores an
  // identity siteId, the customer doc a docLocId).
  const linked = await resolveIntakeCustomer(input.customer);
  if (!linked.ok) return { ok: false, error: linked.error };
  const site = linked.locationId ? siteForLocId(await sitesForCompany(linked.customerId), linked.locationId) : null;
  // #255: the design's venue type is its venue's (the site's venue_kind) — it picks the plan's Background;
  // a per-design Background override survives only when the plan kind can draw it.
  // #255: the design's effective Background, resolved once — it draws the sheet, and it decides which movable rooms
  // (and walls) a client may place (sanitizeMovables).
  const kind = venueOf(input.autoConfig).kind;
  const venueType = site?.venueKind ?? null;
  const templateId = sanitizeTemplateId(kind, input.autoConfig.templateId);
  const tpl = effectiveTemplateFor(kind, { venueType, templateId }, venueTypesFrom((await getSettings()).venueTypes));
  // #255 hardening: width/depth/grid/wing/ph clamped to LIM and the house fields to `tpl`'s own limits before
  // anything (scope inputs, the base sheet, the linked designs' config) is derived from this intake — a forged
  // `autoConfig` (this is a client payload, `AState`-typed but never trusted) can otherwise carry a 1e6/-1e6/
  // NaN/Infinity dimension straight into the plan geometry's loops.
  const autoConfig: AState = cleanMovables(clampHouseFieldsFor(clampConfigDims({ ...input.autoConfig, venueType, templateId }), tpl), tpl);
  // A cover page left blank takes the chosen venue's names and address.
  const fromVenue = site
    ? coverFromVenue({ label: site.name, locationName: site.locationName, address: site.address, city: site.city, state: site.state }, linked.customerName)
    : null;
  const coverBlank = !input.venueName.trim() && !input.locationName.trim();
  const venueName = coverBlank && fromVenue ? fromVenue.venueName : input.venueName;
  const locationName = coverBlank && fromVenue ? fromVenue.locationName : input.locationName;
  const address = !input.address.trim() && fromVenue ? fromVenue.address : input.address;
  const linkedProject = await setProjectCustomer(input.projectId, {
    customer: linked.customerName,
    customerId: linked.customerId,
    contactName: linked.contactName,
    siteId: site?.id ?? null,
    siteName: site ? site.name || "Unnamed venue" : "",
  });
  if (!linkedProject) return { ok: false, error: "That design could not be found." };

  const saved = await saveGridIntake(input.projectId, {
    complete: true,
    measurementBased: true,
    mode: input.mode,
    venueName: venueName.trim(),
    locationName: locationName.trim(),
    address: address.trim(),
    notes: input.notes.trim(),
    autoConfig,
  });
  if (!saved) return { ok: false, error: "That design could not be found." };
  // First-save gate (D145) — see the pre-#211 comment: idempotent re-applies
  // first, generateBaseSheet (the sentinel) last. The Auto fill (#211) runs
  // after the sheet exists; if it fails the plan still opens, with a warning,
  // and "Change equipment…" re-fills. `est`, when present, is stored under
  // THIS option (D312 — autoEstimate is per option, not project-wide).
  let warning: string | undefined;
  const isFirstSave = (saved.sheetIds || []).length === 0;
  if (isFirstSave) {
    await setScopeInputs(input.projectId, cleanMovables(scopeInputs, tpl));
    // #211 fix wave 1 (M6): setAutoEstimate refuses (null) when the option it
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
      venueName,
      locationName,
      a: autoConfig,
      title: input.title,
      customer: { customer: linked.customerName, customerId: linked.customerId, locationId: linked.locationId || null },
    });
    // A raw filtered read (fix wave 3, I3) — no live pricing of every design.
    const designs = await designsForGridProject(input.projectId);
    for (const d of designs) await updateDesign(d.id, patch);
    if (patch.name) await renameProject(input.projectId, patch.name);
    // #255: the sheet draws the design's effective template (its override ?? its venue type's Background ?? the kind default).
    await generateBaseSheet(input.projectId, autoConfig, "#3a3f4a", user.name, tpl);
    if (est && estimateSaved) {
      // #211 fix wave 1 (I1): a thrown error here (not just a returned
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
  // #314: the plan view on file, copied in LAST (after the base sheet, so the
  // first-save gate above is untouched) and put first. A failure never loses
  // the intake — the plan opens with a warning and a retry (the #211 rule).
  let planRetry: string | undefined;
  let planWarning: string | undefined;
  if (isFirstSave && typeof input.planCandidateId === "string" && input.planCandidateId) {
    let attached: Awaited<ReturnType<typeof attachPlanCandidate>>;
    try {
      attached = await attachPlanCandidate(input.projectId, input.planCandidateId, user.name);
    } catch (error) {
      console.error("saveGridIntakeAction: plan copy threw", error);
      attached = { ok: false, error: "Couldn't copy the plan — try again." };
    }
    if (!attached.ok) {
      planRetry = input.planCandidateId;
      planWarning = `The plan is ready, but the plan view wasn't added: ${attached.error}`;
    }
  }
  // #314 review: the warnings are PERSISTED before the revalidate below — that
  // re-render swaps the intake for the editor, so a warning held only in the
  // intake's state was never seen (#211's Auto warning included). The editor
  // shows them as a banner until Retry succeeds or they are dismissed.
  const notices: GridIntakeNotice[] = [];
  const at = Date.now();
  if (warning) notices.push({ id: newNoticeId(), message: warning, at });
  if (planWarning) notices.push({ id: newNoticeId(), message: planWarning, ...(planRetry ? { retry: { kind: "copy" as const, candidateId: planRetry } } : {}), at });
  if (notices.length) await addIntakeNotices(input.projectId, notices);
  revalidatePath(editorPath(input.projectId));
  revalidatePath("/design/designs");
  const allWarnings = [warning, planWarning].filter(Boolean).join(" ");
  return { ok: true, ...(allWarnings ? { warning: allWarnings } : {}), ...(planRetry ? { planRetry } : {}) };
}

/** #314: the refusal sentence for an estimate-linked design, naming the estimate. */
async function estimateRefusal(quoteId: string): Promise<string> {
  const q = await getQuote(quoteId).catch(() => null);
  return estimateOwnedRefusal(q ? displayQuoteNumber(q) : quoteId);
}

/** #314: the intake's plan view — the plans this job already has on file for
 *  the picked customer + venue (and the design's estimate). Labels only. */
export async function planCandidatesAction(
  projectId: string,
  pick: { customerId: string; locationId: string }
): Promise<{ ok: true; candidates: PlanCandidate[] } | { ok: false; error: string }> {
  await requireUser();
  const project = await getProject(String(projectId || ""));
  if (!project) return { ok: false, error: "That design could not be found." };
  const customerId = typeof pick?.customerId === "string" ? pick.customerId.trim() : "";
  const locationId = typeof pick?.locationId === "string" ? pick.locationId.trim() : "";
  try {
    const list = await planCandidatesFor({ customerId: customerId || null, siteLocId: locationId || null, quoteId: estimateLinkOf(project)?.quoteId ?? null });
    return { ok: true, candidates: publicPlanCandidates(list) };
  } catch (e) {
    console.error("planCandidatesAction failed", e);
    return { ok: true, candidates: [] };
  }
}

/** #314 review: the editor banner's Retry for an on-file plan copy. Idempotent
 *  per source (attachPlanCandidate): a retry after a copy that landed is a
 *  no-op. Success drops the notice. */
export async function retryGridNoticeAction(projectId: string, noticeId: string): Promise<Result> {
  const user = await requireUser();
  const project = await getProject(String(projectId || ""));
  if (!project) return { ok: false, error: "Design not found." };
  const notice = (project.intake?.notices || []).find((n) => n.id === noticeId);
  if (!notice || notice.retry?.kind !== "copy") return { ok: false, error: "There's nothing to retry." };
  const r = await attachPlanCandidate(project.id, notice.retry.candidateId, user.name);
  if (!r.ok) return { ok: false, error: r.error };
  await removeIntakeNotice(project.id, noticeId);
  revalidatePath(editorPath(project.id));
  return { ok: true };
}

/** #314 review: Dismiss on the editor banner (also the upload Retry's last step). */
export async function dismissGridNoticeAction(projectId: string, noticeId: string): Promise<Result> {
  await requireUser();
  const removed = await removeIntakeNotice(String(projectId || ""), String(noticeId || ""));
  if (!removed) return { ok: false, error: "That notice is already gone." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/** #314 review: the intake's dropped plan failed to upload AFTER the intake
 *  saved — leave a notice for the editor (Retry = pick the file again). */
export async function notePlanUploadFailedAction(projectId: string, error: string): Promise<Result> {
  await requireUser();
  const project = await getProject(String(projectId || ""));
  if (!project) return { ok: false, error: "Design not found." };
  const why = cleanNoticeText(error).slice(0, 300) || "the upload didn't finish.";
  await addIntakeNotices(project.id, [{ id: newNoticeId(), message: `The plan is ready, but the plan view wasn't uploaded: ${why}`, retry: { kind: "upload" }, at: Date.now() }]);
  revalidatePath(editorPath(project.id));
  return { ok: true };
}

/** #314: give every placeable part of the linked estimate a Grid library entry
 *  (the estimate may have grown since "Design in the Grid") — the tray's Sync parts. */
export async function syncEstimatePartsAction(projectId: string): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't add parts to the Grid library." };
  const project = await getProject(String(projectId || ""));
  if (!project) return { ok: false, error: "Design not found." };
  const link = estimateLinkOf(project);
  if (!link) return { ok: false, error: "This design isn't drawn from an estimate." };
  const q = await getQuote(link.quoteId);
  if (!q) return { ok: false, error: "That estimate no longer exists." };
  const added = await ensureGridSymbolsFor(await estimateTrayParts(q), user.name);
  revalidatePath(editorPath(project.id));
  return { ok: true, added };
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
): Promise<{ ok: true; packageId: string; url: string; gapCount: number; cutSheetsUnreadable: CutSheetsAdded["unreadable"] } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  const h = await headers();
  const printWhere = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  try {
    const built = await createClientPackage(project, user.name, optionId, { printWhere });
    revalidatePath(editorPath(projectId));
    return {
      ok: true,
      packageId: built.record.id,
      url: `/api/client-packages/${encodeURIComponent(built.record.id)}`,
      gapCount: built.gaps.length,
      cutSheetsUnreadable: built.cutSheets.unreadable, // #292 — staff-only; kept out of the zip's index
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The client package could not be built." };
  }
}

export async function placeDeviceAction(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; optionId: string }
): Promise<PlacedResult> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
  const p = await addPlacement(projectId, { ...input, by: user.name });
  // The new record is the last placement of the doc this patch wrote (#299).
  const placement = p?.placements.at(-1);
  if (!placement) return { ok: false, error: "Design not found." };
  // #226: Recent is the placer's own last-40 list — a convenience, so a
  // failed write never fails the placement that already landed.
  try {
    await pushGridRecent(user.id, input.partId);
  } catch {
    /* best-effort */
  }
  revalidatePath(editorPath(projectId));
  return { ok: true, placement };
}

/** #226: star / unstar a part in the palette — the signed-in user's own
 *  favorites (cap 300, refused past it). No revalidate: the palette keeps
 *  the returned list; a reload reads the same blob. */
export async function toggleGridFavoriteAction(
  partId: string
): Promise<{ ok: true; favorites: string[]; on: boolean } | { ok: false; error: string }> {
  const user = await requireUser();
  return toggleGridFavorite(user.id, String(partId || ""));
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

/**
 * Drop a specced curtain onto the plan (punch #49). The dialog gathers Name,
 * Width, Height, Fullness and Fabric - Jeff's list - and checkCurtainInput
 * (shared with paste and undo, #299) is where every one of them is checked;
 * the client's live price is a preview, the fabric rate and the money come
 * from the catalog there and at quote time.
 */
export async function placeCurtainAction(
  projectId: string,
  input: {
    sheetId: string;
    page: number;
    x: number;
    y: number;
    curtain: CurtainInput;
    category?: string;
    optionId: string;
  }
): Promise<PlacedResult> {
  const user = await requireUser();
  const checked = await checkCurtainInput(input.curtain);
  if (!checked.ok) return checked;
  const curtain = checked.curtain;
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };

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
  const placement = p?.placements.at(-1);
  if (!placement) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true, placement };
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

/* ------------------------- batch edits (#299 Task 14) ------------------------- */

const BATCH_INVALID = "That edit isn't valid — reload and try again.";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Move many devices in one write; wires follow each device. `previous`
 *  holds the old positions for undo. All-or-nothing (store). */
export async function movePlacementsAction(
  projectId: string,
  moves: { id: string; x: number; y: number }[]
): Promise<{ ok: true; previous: { id: string; x: number; y: number }[] } | { ok: false; error: string }> {
  await requireUser();
  if (!isStr(projectId) || !Array.isArray(moves) || !moves.every((m) => isObj(m) && isStr(m.id) && isFiniteNum(m.x) && isFiniteNum(m.y)))
    return { ok: false, error: BATCH_INVALID };
  const r = await movePlacements(projectId, moves.map((m) => ({ id: m.id, x: m.x, y: m.y })));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  return { ok: true, previous: r.value };
}

/** Remove many devices in one write; their riser links/conduits go too.
 *  `removed` carries everything undo needs to put back. */
export async function removePlacementsAction(
  projectId: string,
  ids: string[]
): Promise<{ ok: true; removed: RemovedBundle } | { ok: false; error: string }> {
  await requireUser();
  if (!isStr(projectId) || !Array.isArray(ids) || !ids.every(isStr)) return { ok: false, error: BATCH_INVALID };
  const r = await removePlacements(projectId, ids);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/riser`);
  return { ok: true, removed: r.value };
}

/** Label (or clear, with "") many devices' categories in one write. */
export async function setPlacementsCategoryAction(
  projectId: string,
  items: { id: string; category: string }[]
): Promise<{ ok: true; previous: { id: string; category: string }[] } | { ok: false; error: string }> {
  await requireUser();
  if (!isStr(projectId) || !Array.isArray(items) || !items.every((it) => isObj(it) && isStr(it.id) && isStr(it.category)))
    return { ok: false, error: BATCH_INVALID };
  const r = await setPlacementsCategory(projectId, items.map((it) => ({ id: it.id, category: it.category })));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  return { ok: true, previous: r.value };
}

/** #299: one batch edit resolves at most this many DISTINCT part ids — the
 *  per-id lookups run in parallel, so the payload can't fan them out. */
const MAX_DISTINCT_PARTS = 200;
const TOO_MANY_PARTS = "That's too many different parts in one edit — try a smaller selection.";

/** Swap the part on many devices in one write. Every new part must be
 *  placeable (placeablePartIds: the Grid library, or an Auto virtual / seed
 *  placeholder id — undo of a swap on an Auto device sends one back);
 *  curtains are refused by the store. */
export async function replacePlacementsPartAction(
  projectId: string,
  items: { id: string; partId: string; qty?: number }[]
): Promise<{ ok: true; previous: { id: string; partId: string; qty?: number }[] } | { ok: false; error: string }> {
  await requireUser();
  if (
    !isStr(projectId) || !Array.isArray(items) ||
    !items.every((it) => isObj(it) && isStr(it.id) && isStr(it.partId) && it.partId !== "" && (it.qty === undefined || isFiniteNum(it.qty)))
  )
    return { ok: false, error: BATCH_INVALID };
  if (items.length > MAX_BATCH) return { ok: false, error: "Select 2,000 items or fewer." };
  const partIds = new Set(items.map((it) => it.partId));
  if (partIds.size > MAX_DISTINCT_PARTS) return { ok: false, error: TOO_MANY_PARTS };
  const placeable = await placeablePartIds(partIds);
  if (placeable.size !== partIds.size) return { ok: false, error: "That part is not in the Grid library." };
  const r = await setPlacementsPart(
    projectId,
    items.map((it) => ({ id: it.id, partId: it.partId, ...(it.qty !== undefined ? { qty: it.qty } : {}) }))
  );
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/riser`);
  return { ok: true, previous: r.value };
}

/* --------------------------- paste + undo (#299 Task 19) --------------------------- */

const PART_ID_MAX = 120;
const PLACEMENT_ID = /^gp-[0-9a-f]{12}$/;
const UNDO_INVALID = "Couldn't undo — reload and try again.";
const isPage = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isPartId = (v: unknown): v is string => isStr(v) && v !== "" && v.length <= PART_ID_MAX;

/** Paste copied devices (and the wires between them) onto one page of one
 *  option. Every device part must be in the Grid library; every curtain goes
 *  through checkCurtainInput and takes its fabric as its part. Wires that
 *  can't come along are counted in `skippedWires` (store). */
export async function pastePlacementsAction(
  projectId: string,
  input: {
    sheetId: string;
    page: number;
    optionId: string;
    items: { srcId: string; x: number; y: number; partId: string; category?: string; curtain?: CurtainInput; qty?: number }[];
    routeIds: string[];
  }
): Promise<{ ok: true; placements: GridPlacement[]; routes: GridRoute[]; skippedWires: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (
    !isStr(projectId) || !isObj(input) || !isStr(input.sheetId) || input.sheetId === "" || input.sheetId.length > PART_ID_MAX || !isPage(input.page) ||
    !isStr(input.optionId) || !Array.isArray(input.items) || !Array.isArray(input.routeIds) || !input.routeIds.every(isStr) ||
    !input.items.every(
      (it) =>
        isObj(it) && isStr(it.srcId) && isFiniteNum(it.x) && isFiniteNum(it.y) && isPartId(it.partId) &&
        (it.category === undefined || isStr(it.category)) &&
        (it.qty === undefined || isFiniteNum(it.qty)) &&
        (it.curtain === undefined || isObj(it.curtain))
    )
  )
    return { ok: false, error: BATCH_INVALID };
  if (!input.items.length) return { ok: false, error: "Nothing to paste." };
  if (input.items.length > MAX_BATCH || input.routeIds.length > MAX_BATCH) return { ok: false, error: "Paste 2,000 items or fewer." };

  // Auto-filled (asm:/allow:) and seed devices paste like any other (#299).
  const deviceParts = new Set(input.items.filter((it) => !it.curtain).map((it) => it.partId));
  if (deviceParts.size > MAX_DISTINCT_PARTS) return { ok: false, error: TOO_MANY_PARTS };
  const placeable = await placeablePartIds(deviceParts);
  if (placeable.size !== deviceParts.size) return { ok: false, error: "That part is not in the Grid library." };
  const items: PasteItem[] = [];
  for (const it of input.items) {
    let curtain: GridCurtain | undefined;
    if (it.curtain) {
      const checked = await checkCurtainInput(it.curtain);
      if (!checked.ok) return checked;
      curtain = checked.curtain;
    }
    items.push({
      srcId: it.srcId,
      x: it.x,
      y: it.y,
      // A curtain's part is its fabric (addCurtainPlacement's rule).
      partId: curtain ? curtain.fabricSku : it.partId,
      ...(it.category !== undefined ? { category: it.category } : {}),
      ...(it.qty !== undefined ? { qty: it.qty } : {}),
      ...(curtain ? { curtain } : {}),
    });
  }
  const r = await pastePlacements(projectId, {
    sheetId: input.sheetId,
    page: input.page,
    optionId: input.optionId,
    by: user.name,
    items,
    routeIds: input.routeIds,
  });
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/riser`);
  return { ok: true, placements: r.value.placements, routes: r.value.routes, skippedWires: r.value.skippedWires };
}

/** Rebuild ONE placement record a client echoed back for undo — a fresh
 *  object of only GridPlacement's own fields, each re-checked, so a
 *  tampered bundle can't plant arbitrary data. null = refuse the restore. */
async function cleanRestoredPlacement(raw: unknown): Promise<GridPlacement | null> {
  if (!isObj(raw)) return null;
  if (!isStr(raw.id) || !PLACEMENT_ID.test(raw.id)) return null;
  if (!isFiniteNum(raw.x) || !isFiniteNum(raw.y) || !isPage(raw.page)) return null;
  if (!isStr(raw.sheetId) || raw.sheetId === "" || raw.sheetId.length > PART_ID_MAX || !isPartId(raw.partId)) return null;
  if (raw.optionId !== undefined && !isStr(raw.optionId)) return null;
  let curtain: GridCurtain | undefined;
  if (raw.curtain !== undefined) {
    if (!isObj(raw.curtain)) return null;
    const checked = await checkCurtainInput(raw.curtain as CurtainInput);
    if (!checked.ok) return null;
    curtain = checked.curtain;
  }
  const category = isStr(raw.category) ? raw.category.trim().slice(0, 40) : "";
  const seededFrom = isStr(raw.seededFrom) ? raw.seededFrom.slice(0, PART_ID_MAX) : "";
  const qty = cleanLotQty(raw.qty);
  const auto = raw.auto === undefined ? null : sanitizeAutoTag(raw.auto);
  const autoOrigin = raw.autoOrigin === undefined ? null : sanitizeAutoOrigin(raw.autoOrigin);
  return {
    id: raw.id,
    sheetId: raw.sheetId,
    page: raw.page,
    x: clamp01(raw.x),
    y: clamp01(raw.y),
    partId: curtain ? curtain.fabricSku : raw.partId,
    ...(category ? { category } : {}),
    ...(curtain ? { curtain } : {}),
    ...(isStr(raw.optionId) ? { optionId: raw.optionId } : {}),
    ...(seededFrom ? { seededFrom } : {}),
    ...(qty !== undefined ? { qty } : {}),
    ...(auto ? { auto } : {}),
    ...(autoOrigin ? { autoOrigin } : {}),
    by: isStr(raw.by) ? raw.by.slice(0, 80) : "",
    at: isFiniteNum(raw.at) ? raw.at : Date.now(),
  };
}

/** Undo of a batch removal ONLY: puts the removed devices back with their
 *  original ids, plus the riser links/conduits that went with them. The
 *  bundle round-trips through the client, so every record is rebuilt and
 *  re-validated here, and the riser half is cleaned by the store. Refused,
 *  whole, when any record fails or the design changed since. */
export async function restoreItemsAction(projectId: string, bundle: RemovedBundle): Promise<Result> {
  await requireUser();
  if (!isStr(projectId) || !isObj(bundle) || !Array.isArray(bundle.placements)) return { ok: false, error: UNDO_INVALID };
  if (!bundle.placements.length) return { ok: false, error: "Nothing to undo." };
  if (bundle.placements.length > MAX_BATCH) return { ok: false, error: "Couldn't undo — too many items." };
  const placements: GridPlacement[] = [];
  for (const raw of bundle.placements) {
    const pl = await cleanRestoredPlacement(raw);
    if (!pl) return { ok: false, error: UNDO_INVALID };
    placements.push(pl);
  }
  // Restored riser links skip addRiserLinkAction, so apply its part rule here:
  // a cable that left the Grid library (or isn't per-length) refuses the undo.
  const riser = isObj(bundle.riser) ? bundle.riser : {};
  const cableIds = new Set<string>();
  for (const entry of Object.values(riser)) {
    const links = isObj(entry) && Array.isArray(entry.links) ? entry.links : [];
    for (const l of links) if (isObj(l)) cableIds.add(isStr(l.partId) ? l.partId : "");
  }
  // Bounded like every batch: the riser half round-trips through the client,
  // so it can't make the lookup below fan out without limit.
  if (cableIds.size > MAX_DISTINCT_PARTS) return { ok: false, error: "Couldn't undo — too many different parts in one step." };
  const cables = await Promise.all([...cableIds].map((id) => (isPartId(id) ? partForGrid(id) : Promise.resolve(null))));
  if (cables.some((part) => !part || !isPerLengthUnit(part.unit)))
    return { ok: false, error: "Couldn't undo — a cable in it is no longer in the Grid library." };
  const r = await restoreItems(projectId, { placements, riser });
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/riser`);
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

/* ------------------------- title + customer (#244) ------------------------- */

/** Rename the design from the editor header — the project and its linked
 *  design record(s) together, so the Designs dashboard shows the same name. */
export async function renameGridDesignAction(projectId: string, name: string): Promise<Result> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't rename designs." };
  const clean = String(name ?? "").trim();
  if (!clean) return { ok: false, error: "A design needs a name." };
  const p = await renameProject(projectId, clean);
  if (!p) return { ok: false, error: "Design not found." };
  for (const d of await designsForGridProject(projectId)) await updateDesign(d.id, { name: clean });
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}

/** Link (or change, or clear with "") the design's customer from the editor.
 *  A different customer drops the venue and contact picked off the old one. */
export async function setGridCustomerAction(projectId: string, customerId: string): Promise<Result> {
  const user = await requireUser();
  // Re-linking the customer changes the pricing tier — same gate as delete.
  if (!can("create", user.roles)) return { ok: false, error: "You can't change a design's customer." };
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const id = String(customerId ?? "").trim();
  const customer = id ? await getCustomer(id) : null;
  if (id && !customer) return { ok: false, error: "That customer couldn't be found — refresh and try again." };
  if ((customer?.id ?? null) === (project.customerId || null)) return { ok: true };
  const p = await setProjectCustomer(projectId, {
    customer: customer?.name || "",
    customerId: customer?.id ?? null,
    contactName: "",
    siteId: null,
    siteName: "",
  });
  if (!p) return { ok: false, error: "Design not found." };
  for (const d of await designsForGridProject(projectId))
    await updateDesign(d.id, { customer: customer?.name || "", customerId: customer?.id ?? null, locationId: null });
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
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
  // #255: movable rooms are the one field checked — only the effective template's rooms, on walls they may use.
  const tpl = scopeInputs?.movables == null ? null : effectiveTemplateFor(venueOf(scopeInputs).kind, scopeInputs, venueTypesFrom((await getSettings()).venueTypes));
  // #255 hardening: "no validation: any well-typed payload is accepted" is exactly the hole — width/depth/
  // grid/wing/ph clamped to LIM before this is stored (cheap, no settings read, so every save keeps this
  // action's fast path), so a forged Scope-panel save can't carry a 1e6/-1e6/NaN/Infinity dimension into the
  // plan geometry's loops; the geometry's own read (house-dims.ts) clamps the same way regardless.
  const cleaned = scopeInputs && clampConfigDims(scopeInputs);
  const p = await setScopeInputs(projectId, cleaned && cleanMovables(cleaned, tpl));
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

/** Symbol scale + generic/object mode for the design (#300). The store cleans
 *  the payload; the drawing set and riser pages read it too. */
export async function setSymbolDisplayAction(projectId: string, raw: unknown): Promise<Result> {
  await requireUser();
  const p = await setSymbolDisplay(projectId, raw);
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  revalidatePath(`${editorPath(projectId)}/set`);
  revalidatePath(`${editorPath(projectId)}/riser`);
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
  const linked = await designsForGridProject(id);
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
  opts?: { acceptIncomplete?: boolean }
): Promise<
  | { ok: true; quoteId: string; updated: boolean; fallbackLines: string[] }
  | { ok: false; error: string; needsPart?: number }
> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  // #314: a design drawn from an estimate is drawings-only — the estimate owns
  // parts and prices, so no option of it may mint or update a quote. The one
  // choke point: the editor, the Designs dashboard and Home all land here.
  const estimateLink = estimateLinkOf(project);
  if (estimateLink) return { ok: false, error: await estimateRefusal(estimateLink.quoteId) };
  const resolvedOptionId = resolveOptionId(project, optionId);
  if (optionId && resolvedOptionId !== optionId) return { ok: false, error: OPTION_GONE };
  const option = project.options!.find((o) => o.id === resolvedOptionId)!;

  // #211 D322: an Auto design whose choices still have needs-a-part lines
  // is missing that equipment on the plan (Auto never places one), so its
  // quote would be short. Same rule as D310: refused unless the person
  // confirmed it in the editor (acceptIncomplete) — the dashboard and Home
  // never pass it.
  if (!opts?.acceptIncomplete) {
    const needsPart = await autoNeedsPart(project, resolvedOptionId);
    if (needsPart > 0) {
      return {
        ok: false,
        needsPart,
        error: `Incomplete — ${needsPart} Auto item${needsPart === 1 ? "" : "s"} still need${needsPart === 1 ? "s" : ""} a part, so ${needsPart === 1 ? "it isn’t" : "they aren’t"} on the plan or the quote. Map ${needsPart === 1 ? "it" : "them"} in the Equipment map and re-fill, or place ${needsPart === 1 ? "a device" : "devices"} by hand and quote from The Grid.`,
      };
    }
  }

  const built = await buildGridQuote(project, resolvedOptionId);
  if (!built.ok) return built;
  const { build } = built;

  const existing = option.quoteId ? await getQuote(option.quoteId) : null;
  if (existing) {
    if (existing.status !== "draft")
      return { ok: false, error: `${displayQuoteNumber(existing)} is already ${existing.status} — cut a revision from the quote screen instead.` };
    await updateQuote(existing.id, {
      name: build.quoteName,
      value: build.value,
      margin: build.margin,
      locationId: build.locationId,
      pricingTier: build.tier.tier,
      tierMargin: build.tier.margin,
      spec: build.spec,
    });
    // #222 fix wave 1: a re-promote rewrites what the quote document shows.
    await scheduleQuotePdf(existing.id);
    await addRevision(projectId, { by: user.name, reason: "quote", note: `${option.name} quoted as ${displayQuoteNumber(existing)}` });
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
      // #244 — the contact picked at intake (a name, as on every quote).
      contactName: project.contactName || "",
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
  await scheduleQuotePdf(q.id);
  await setOptionQuote(project.id, resolvedOptionId, q.id);
  await addRevision(projectId, { by: user.name, reason: "quote", note: `${option.name} quoted as ${displayQuoteNumber(q)}` });
  revalidatePath(editorPath(projectId));
  revalidatePath("/quotes");
  revalidatePath("/design/designs");
  return { ok: true, quoteId: q.id, updated: false, fallbackLines: build.fallbackLines };
}

/**
 * "Change equipment…" (#211, spec §5): re-choose ONE Auto scope's tier,
 * swaps and quantities, save them on the project, and re-fill only that
 * scope in this option. Untouched Auto devices are replaced; devices moved or
 * edited by hand stay. The UI confirms first (ConfirmButton).
 *
 * Adapted from the brief for D312 (not in the original brief):
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
}): Promise<{ ok: true; added: number; removed: number; needsPart: number; kept: number } | { ok: false; error: string }> {
  const user = await requireUser();
  // Only the five Auto scopes are ever filled (D307) — refuse anything
  // else before touching the project (final review minor).
  if (!AUTO_SCOPES.includes(input?.scope)) return { ok: false, error: "Only Auto scopes can be re-filled." };
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

/* ------------------------------ custom items (#212) ------------------------------ */

/**
 * Add or edit one per-design custom item on an option — "a product that just
 * doesn't have a catalog item" (#212). Same gate as the placement edits; the
 * store re-sanitizes whatever arrives. Revalidates the Designs dashboard too,
 * since its live budget reads this option's quote build.
 */
export async function saveCustomItemAction(
  projectId: string,
  optionId: string,
  input: GridCustomItemInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireUser();
  const r = await saveCustomItem(projectId, optionId, input);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true, id: r.item.id };
}

export async function removeCustomItemAction(
  projectId: string,
  optionId: string,
  itemId: string
): Promise<Result> {
  await requireUser();
  const r = await removeCustomItem(projectId, optionId, String(itemId ?? ""));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}

/**
 * #232: type (a number) or clear (null) one BOM heading's labor $ on an
 * option. Same gate as the placement edits; the store validates the system
 * and the amount. Revalidates the Designs dashboard too (its live budget
 * reads this option's quote build).
 */
export async function setLaborOverrideAction(
  projectId: string,
  optionId: string,
  system: string,
  amount: number | null
): Promise<Result> {
  await requireUser();
  const r = await setLaborOverride(projectId, optionId, String(system ?? ""), amount === null ? null : Number(amount));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}

/* ------------------------------ BOM accessories (#230) ------------------------------ */

/**
 * Add an accessory under a BOM heading, or change one's qty (#230). Same
 * gate as the placement edits; the store re-validates the part against the
 * Grid library and re-sanitizes everything. Revalidates the Designs
 * dashboard too, since its live budget reads this option's quote build.
 */
export async function saveAccessoryAction(
  projectId: string,
  optionId: string,
  input: GridAccessoryInput
): Promise<{ ok: true; id: string; note?: string } | { ok: false; error: string }> {
  await requireUser();
  const r = await saveAccessory(projectId, optionId, input);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  // #230 final wave B: an add that would pass the cap is clamped — say so.
  return { ok: true, id: r.item.id, ...(r.clamped ? { note: accessoryClampNote(r.item.qty) } : {}) };
}

export async function removeAccessoryAction(
  projectId: string,
  optionId: string,
  accessoryId: string
): Promise<Result> {
  await requireUser();
  const r = await removeAccessory(projectId, optionId, String(accessoryId ?? ""));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}
