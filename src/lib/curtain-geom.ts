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

/** Sell-side assembly coefficients, precomputed server-side (no margin here). */
export type SellCoeffs = {
  /** Sew, per sq ft of sewn fabric. */
  sewPerSqft: number;
  /** Bottom finish, per ft of finished width, keyed by finish. */
  bottomPerFt: Record<string, number>;
  /** Hang hardware, per ft of finished width, keyed by hang type. */
  hangPerFt: Record<string, number>;
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
 * and `coeffs` are passed at full precision (they are — see the estimate page).
 */
export function curtainPriceEach(
  d: CurtainSpec,
  pricePerSqft: number,
  coeffs: SellCoeffs
): number {
  const { fabricArea, width } = curtainAreas(d);
  if (fabricArea <= 0) return 0;
  const price =
    fabricArea * (pricePerSqft || 0) +
    fabricArea * coeffs.sewPerSqft +
    width * (coeffs.bottomPerFt[d.bottom] ?? 0) +
    width * (coeffs.hangPerFt[d.hang] ?? 0);
  return round2(price);
}
