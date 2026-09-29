/**
 * What counts as a fabric part (#264, D473) — pure, client-safe.
 *
 * Every curtain path (Grid Equipment map, curtain picker, estimator, lineset,
 * portal) and every "a fabric is not a placeable device" exclusion asks this
 * one question. A part is fabric when its category is "Fabric", or when it
 * sits in "Theatrical/Soft Goods" and is sold per sq ft — production's Rose
 * Brand price book files its fabrics (RB-FAB-…) there, and a re-import would
 * undo any hand recategorisation. Soft Goods sold by the each (hardware,
 * pipe pockets, finished drapes) stay ordinary parts.
 *
 * The category-level taxonomy exclusion (catalog/taxonomy-card.tsx) is left
 * on "Fabric" only — Soft Goods holds non-fabric parts too.
 */

export const SOFT_GOODS_CATEGORY = "Theatrical/Soft Goods";

const SQFT_UNITS = new Set(["sqft", "sf", "ft2", "ft²", "squarefeet", "squarefoot", "sqfeet"]);

/** True when a catalog unit reads as square feet ("sq ft", "SF", "sq. ft.", "ft²", …). */
export function isSqftUnit(unit: string | null | undefined): boolean {
  if (typeof unit !== "string") return false;
  return SQFT_UNITS.has(unit.toLowerCase().replace(/[\s._-]+/g, ""));
}

/** True when a part is a fabric: category Fabric, or Theatrical/Soft Goods sold per sq ft. */
export function isFabricPart(p: { category?: string | null; unit?: string | null }): boolean {
  const category = (p.category ?? "").trim();
  return category === "Fabric" || (category === SOFT_GOODS_CATEGORY && isSqftUnit(p.unit));
}
