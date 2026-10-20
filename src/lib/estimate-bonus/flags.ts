/**
 * Estimator bonuses — identity of the two automatic internal lines. Kept free
 * of runtime imports so `estimator/pricing.ts` can import it without a cycle
 * (rules.ts imports pricing.ts).
 */
export type BonusKind = "package" | "estimator";

export const BONUS_PACKAGE_PCT = 0.05;
export const BONUS_ESTIMATOR_PCT = 0.02;

/**
 * Jeff 2026-10-15 #19 — the two rates live in Estimating Rules → Estimator
 * bonuses (the pricing registry's general blob, stored as percent numbers,
 * 5 = 5 %), 0–20 %. A missing / junk value is the default. They apply to
 * drafts only: a sent / won / lost quote keeps the rate its bonus lines were
 * figured at (`bonusPct` on the line; absent = the default it was built with).
 */
export const BONUS_PACKAGE_RATE_ID = "bonus.packagePct";
export const BONUS_ESTIMATOR_RATE_ID = "bonus.estimatorPct";
export const BONUS_RATE_MAX_PCT = 20;
/** Fractions (0.05 = 5 %). */
export type BonusRates = { packagePct: number; estimatorPct: number };
export const DEFAULT_BONUS_RATES: BonusRates = { packagePct: BONUS_PACKAGE_PCT, estimatorPct: BONUS_ESTIMATOR_PCT };

/** A stored percent number → a fraction; missing / non-number / out of 0–20 → `def`. */
function pctFrom(raw: unknown, def: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > BONUS_RATE_MAX_PCT) return def;
  return Math.round(raw * 1000) / 100000;
}

/** The two rates from their stored Estimating Rules values (percent numbers). Pure. */
export function bonusRatesFrom(rawPackagePct: unknown, rawEstimatorPct: unknown): BonusRates {
  return { packagePct: pctFrom(rawPackagePct, BONUS_PACKAGE_PCT), estimatorPct: pctFrom(rawEstimatorPct, BONUS_ESTIMATOR_PCT) };
}

/** A line's recorded rate (fraction) — `bonusPct` when valid, else the default it was figured at. */
export function lineBonusPct(it: { bonus?: unknown; bonusPct?: unknown } | null | undefined): number {
  const def = it?.bonus === "estimator" ? BONUS_ESTIMATOR_PCT : BONUS_PACKAGE_PCT;
  const v = it?.bonusPct;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= BONUS_RATE_MAX_PCT / 100 ? v : def;
}

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
