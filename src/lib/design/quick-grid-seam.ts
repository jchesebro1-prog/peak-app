/**
 * "Estimating consumes a Grid BOM when one exists, else prices
 * parametrically" (#41, Jeff-confirmed). SERVER ONLY — it reads the doc
 * store and imports the curtain cost model, so it must never be pulled into
 * a client component (that is also why it does NOT live in
 * design/quick/engine.ts, which is pure math with no I/O and IS imported by
 * the Quick Design client).
 *
 * This is the seam: given the quote id the Quick estimator is pricing, look
 * for a linked Grid project; if one exists, its BOM is authoritative — even
 * an empty BOM. An empty, real system is not the same claim as "no system
 * exists yet, guess from dimensions", so an empty linked design prices at 0
 * rather than quietly falling through. The parametric fallback runs only
 * when no Grid project links to this quote at all.
 */

import { getProjectByQuoteId } from "@/lib/stores/grid-projects";
import { bomTotals, routeLines } from "@/lib/design/grid-bom";
import { priceGridCurtains } from "@/lib/design/grid-curtains";
import { list as listCatalogParts } from "@/lib/stores/catalog";

export type QuickPrice = {
  source: "grid" | "parametric";
  value: number;
  /** The Grid design the number came from — for the UI's indicator. Null on
   *  the parametric path. */
  gridProjectId: string | null;
  gridProjectName: string | null;
};

export async function priceFromGridOrParametric(
  quoteId: string,
  parametricFallback: () => number
): Promise<QuickPrice> {
  const project = await getProjectByQuoteId(quoteId);
  if (!project) {
    return {
      source: "parametric",
      value: parametricFallback(),
      gridProjectId: null,
      gridProjectName: null,
    };
  }

  const placements = project.placements || [];
  const parts = await listCatalogParts();

  // The same three priced categories the Grid's own quote mint assembles
  // (design/grid/[id]/actions.ts): devices, wire runs and curtains.
  //
  // Curtains are NOT optional here. bomTotals/bomLines deliberately SKIP
  // curtain placements — a curtain carries its fabric row's partId and
  // counting it there would bill the fabric twice — so devices + wire alone
  // would price a curtain-heavy design at nearly nothing while the Grid BOM
  // screen and the minted quote both show thousands.
  //
  // Labor and the customer's pricing tier are deliberately left out: labor
  // hours are proposed per-mint and never stored on the project, and the
  // Quick estimator is a budgetary sandbox that runs at its own engine
  // margins until a design is promoted (D88). This is the untiered list
  // value of the real design, not a promise about the final quote.
  const devices = bomTotals(placements, parts);
  const wire = routeLines(project.routes || [], parts, project.calibrations || []);
  const curtains = priceGridCurtains(placements, parts);
  const curtainValue = [...curtains.values()].reduce((a, c) => a + c.priceEach, 0);

  return {
    source: "grid",
    value: devices.value + wire.value + curtainValue,
    gridProjectId: project.id,
    gridProjectName: project.name,
  };
}
