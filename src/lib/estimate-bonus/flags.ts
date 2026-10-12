/**
 * Estimator bonuses — identity of the two automatic internal lines. Kept free
 * of runtime imports so `estimator/pricing.ts` can import it without a cycle
 * (rules.ts imports pricing.ts).
 */
export type BonusKind = "package" | "estimator";

export const BONUS_PACKAGE_PCT = 0.05;
export const BONUS_ESTIMATOR_PCT = 0.02;

type Flagged = { bonus?: unknown } | null | undefined;

export function isPackageBonusItem(it: Flagged): boolean {
  return !!it && it.bonus === "package";
}

export function isEstimatorBonusItem(it: Flagged): boolean {
  return !!it && it.bonus === "estimator";
}

export function isBonusItem(it: Flagged): boolean {
  return isPackageBonusItem(it) || isEstimatorBonusItem(it);
}

/** The pre-2026-10-12 "Performance bonus — 5% of labor cost" line (D136/D251). */
export function isLegacyLaborBonusItem(it: { laborOverhead?: unknown; labor?: unknown; sku?: unknown } | null | undefined): boolean {
  if (!it) return false;
  if (it.laborOverhead === "bonus") return true;
  return !!it.labor && typeof it.sku === "string" && /^LAB-BONUS-/.test(it.sku);
}
