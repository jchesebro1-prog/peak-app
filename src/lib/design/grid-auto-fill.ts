import { compute, defaultAState, type SysKey } from "@/app/(app)/design/quick/engine";
import { getProject, replaceAutoPlacements, type GridProject } from "@/lib/stores/grid-projects";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { ensureGridSymbolsFor } from "@/lib/stores/grid-catalog";
import { buildEquipmentPriceTable } from "./equipment-map";
import { autoEstimateCards, autoQuoteNeedsPart, clampScopeInputs, priceOverrides } from "./auto-estimate";
import { generateAutoLayout } from "./grid-auto-layout";
import { autoEstimateFor, keptUnitsByRow, overrideRefs } from "./grid-auto-model";
import { defaultOptionId } from "./grid-options";

// Server-only (the `server-only` package isn't installed here): fail loudly if a client bundle ever pulls it in.
if (typeof window !== "undefined") throw new Error("grid-auto-fill is server-only");

export type FillResult =
  | { ok: true; added: number; removed: number; needsPart: number; /** units kept by hand that counted toward the rows (D-GEM-20) */ kept: number }
  | { ok: false; error: string };

/**
 * Auto fill (#GEM, spec §5): price the project's Auto choices from the
 * Equipment map + live catalog, lay them out by rule on the generated base
 * sheet (sheetIds[0]) using the geometry it was drawn from (intake.autoConfig),
 * and replace the untouched auto devices of `scopes` in `optionId` — hand-
 * touched ones stay. Mapped catalog parts get a Grid library entry first so
 * the editor resolves them. Called only from user actions (the intake's first
 * save, "Change equipment…"), never on page load. Needs-a-part lines are
 * reported, never placed.
 *
 * `optionId`'s Auto choices are read from the project's PER-OPTION
 * `autoEstimate` map (D-GEM-12, not in the original brief) — `autoEstimateFor`
 * resolves a legacy single-value doc as the first option's.
 */
export async function fillAutoScopes(projectId: string, optionId: string, scopes: SysKey[], by: string): Promise<FillResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  const inputs = project.scopeInputs;
  const a = project.intake?.autoConfig;
  const est = autoEstimateFor(project.autoEstimate, optionId, defaultOptionId(project));
  if (!inputs || !a || !est) return { ok: false, error: "This design has no Auto choices to fill from." };
  const sheetId = project.sheetIds[0];
  if (!sheetId) return { ok: false, error: "No plan sheet to fill yet." };
  const refs = overrideRefs(est);
  const { map, ctx, catalogParts } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  const cards = autoEstimateCards(inputs, est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx)).filter((c) =>
    scopes.includes(c.scope)
  );
  const deviceSkus = new Set(
    cards.flatMap((c) => c.lines.filter((l) => l.status === "part" && !l.drape && l.ref && l.qty > 0).map((l) => l.ref as string))
  );
  await ensureGridSymbolsFor([...catalogParts.values()].filter((p) => deviceSkus.has(p.sku)), by);
  // #GEM fix wave 1 (M2): the layout's geometry must clamp `inputs` the same
  // way autoEstimateCards() does, or a stored scopeInputs that predates a
  // tighter cap (or was never clamped on write) sizes the layout differently
  // than the cards it's laying out.
  const C = compute({ ...defaultAState(0), ...clampScopeInputs(inputs), tier: "better" });
  // D-GEM-20: devices of these scopes kept by hand (auto cleared, origin
  // recorded) count toward each row's new quantity. Read from the same
  // project snapshot the fill priced; the replace below never removes them.
  const kept = keptUnitsByRow(project.placements || [], scopes, optionId);
  const items = generateAutoLayout(a, cards, { electrics: C.electrics, sets: C.rigSets, kept });
  const res = await replaceAutoPlacements(projectId, { optionId, scopes, sheetId, page: 1, items, by });
  if (!res) return { ok: false, error: "That option was removed — refresh the page." };
  return {
    ok: true,
    ...res,
    needsPart: cards.reduce((n, c) => n + c.needsPart, 0),
    kept: Object.values(kept).reduce((n, u) => n + u, 0),
  };
}

/**
 * The needs-a-part lines an option's Auto choices leave off the plan — and
 * so off a Grid quote (#GEM final review, D-GEM-22). 0 for a Blank design or
 * an option with no Auto choices. Reads only the map's SKUs and the swaps'.
 */
export async function autoNeedsPart(project: GridProject, optionId: string): Promise<number> {
  const inputs = project.scopeInputs;
  const est = autoEstimateFor(project.autoEstimate, optionId, defaultOptionId(project));
  if (!inputs || !est) return 0;
  const refs = overrideRefs(est);
  const { map, ctx } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  return autoQuoteNeedsPart(autoEstimateCards(inputs, est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx)), est);
}
