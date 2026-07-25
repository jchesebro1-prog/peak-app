/**
 * Curtain geometry + client-safe pricing (IDEAS #48).
 *
 * This module is imported by the CUSTOMER's browser bundle, so it contains NO
 * pricing secrets — no margin, no cost basis, no cost coefficients. It knows
 * only how to turn dimensions into area, and how to combine already-computed
 * SELL numbers (a price/sq ft per fabric + sell coefficients) into a line
 * price. Every one of those sell numbers is produced server-side from the
 * authoritative math in ./curtain-pricing (which stays on the server).
 *
 * Because a customer never receives the margin or the cost basis, they can't
 * work backwards from these sell numbers to Peak's cost.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The customer-editable shape of one curtain (all fields are raw strings). */
export type CurtainSpec = {
  name: string;
  hang: string;
  fabric: string; // fabric sku
  qty: string;
  width: string;
  height: string;
  fullness: string; // "0" | "50" | "75" | "100"
  bottom: string;
};

/** A fabric option as the customer sees it — a SELL price/sq ft, never cost. */
export type FabricSell = { sku: string; name: string; pricePerSqft: number };

/** Sell-side making coefficients, precomputed server-side (no margin here). */
export type SellCoeffs = {
  /** Making sell, per ft of SEWN width — pleated velour. */
  makingPerFt: number;
  /** Making sell, per ft of sewn width — flat goods (fullness 0). */
  cycMakingPerFt: number;
};

/** Finished face + sewn fabric area (sq ft) and finished width (ft). */
export function curtainAreas(d: CurtainSpec): {
  faceArea: number;
  fabricArea: number;
  width: number;
} {
  const h = parseFloat(d.height) || 0;
  const w = parseFloat(d.width) || 0;
  const fullness = (parseFloat(d.fullness) || 0) / 100;
  const faceArea = h * w;
  const fabricArea = faceArea * (1 + fullness);
  return { faceArea, fabricArea, width: w };
}

/** Positive integer quantity (min 1). */
export function curtainQty(d: CurtainSpec): number {
  return Math.max(1, parseInt(d.qty, 10) || 0);
}

/**
 * Customer-facing price for ONE curtain, from sell numbers only. Equals the
 * server's authoritative curtainCost().priceEach exactly when `pricePerSqft`
 * and `coeffs` are passed at full precision (they are — see the estimate
 * page). Computes its own sewn geometry — the shared two-term model
 * (sewnWidth = width × (1 + fullness/100), sewnArea = sewnWidth × height) —
 * so it needs no bottom/hang coefficients.
 *
 * sewnArea × pricePerSqft + sewnWidth × makingSell
 *   = (sewnArea × fabricRate + sewnWidth × makingRate) / (1 − m)
 *   = rawCost / (1 − m)
 * — identical to the server's priceEach, rounded once. That is the
 * cent-match.
 */
export function curtainPriceEach(
  d: CurtainSpec,
  pricePerSqft: number,
  coeffs: SellCoeffs
): number {
  const h = parseFloat(d.height) || 0;
  const w = parseFloat(d.width) || 0;
  const fullness = parseFloat(d.fullness) || 0;
  const sewnWidth = w * (1 + fullness / 100);
  const sewnArea = sewnWidth * h;
  if (sewnArea <= 0) return 0;
  const makingSell = fullness > 0 ? coeffs.makingPerFt : coeffs.cycMakingPerFt;
  return round2(sewnArea * (pricePerSqft || 0) + sewnWidth * makingSell);
}
