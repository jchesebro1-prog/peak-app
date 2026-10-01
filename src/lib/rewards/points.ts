/**
 * Customer Rewards — points (#282 follow-up, Jeff 2026-10-01: "in the back
 * end it would be dollar total, but in the customer end it would just be
 * points. We would round the points up to the nearest point.").
 *
 * 1 point = $1 of Rewards credit. The ledger stays in dollars; every
 * customer-facing rewards number goes through `pointsFor` (rounded UP), and
 * the postings themselves are whole dollars (earn and starting credit round
 * up, an applied credit rounds down — ledger.ts / credit-line.ts) so the
 * points a customer sees and the dollars staff see never drift. Only a
 * legacy cents balance or a staff Adjust to the cent can carry a fraction,
 * and that shows as the next whole point.
 *
 * Pure and client-safe: no imports.
 */

/** Float noise guard: 110.00000000000001 is 110, not 111. */
const EPS = 1e-9;

/** Dollars → whole dollars, rounded UP (0 for ≤ 0 or junk). Earns and starting credit post this. */
export function roundUpDollars(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.max(0, Math.ceil(dollars - EPS));
}

/** Dollars → whole dollars, rounded DOWN (0 for ≤ 0 or junk). An applied credit never exceeds what's there. */
export function roundDownDollars(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.max(0, Math.floor(dollars + EPS));
}

/** A rewards dollar amount as points: 1 point = $1, rounded UP; 0 for ≤ 0. */
export function pointsFor(dollars: number): number {
  return roundUpDollars(dollars);
}

/** "1 point" / "1,234 points" (a point count, already whole). */
export function formatPoints(n: number): string {
  const p = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return `${p.toLocaleString("en-US")} ${p === 1 ? "point" : "points"}`;
}

/** "300 pts" / "1 pt" — the short form for document lines. */
export function formatPointsShort(n: number): string {
  const p = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return `${p.toLocaleString("en-US")} ${p === 1 ? "pt" : "pts"}`;
}

/** A rewards dollar amount straight to its short points label ("300 pts"). */
export function pointsLabel(dollars: number): string {
  return formatPointsShort(pointsFor(dollars));
}

/** The customer document's credit line: "Rewards points applied (300 pts)". */
export function rewardPointsAppliedLabel(creditDollars: number): string {
  return `Rewards points applied (${pointsLabel(creditDollars)})`;
}

/** The service letters' credit row: "Rewards points (300 pts)". */
export function rewardPointsRowLabel(creditDollars: number): string {
  return `Rewards points (${pointsLabel(creditDollars)})`;
}

/**
 * STAFF surfaces: dollars with the customer's points alongside —
 * "$300 · 300 pts", "$12.50 · 13 pts", "−$5 · 0 pts". Whole dollars print
 * without cents (every new posting is whole); a cents amount keeps them.
 */
export function dollarsAndPoints(dollars: number): string {
  const v = Number.isFinite(dollars) ? Math.round(dollars * 100) / 100 : 0;
  const abs = Math.abs(v);
  const whole = Math.abs(abs - Math.round(abs)) < 1e-9;
  const money =
    "$" +
    abs.toLocaleString("en-US", whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}${money} · ${pointsLabel(v)}`;
}

/** Prose: "300 rewards points" / "1 rewards point" (the repair letter, renewal PDFs). */
export function rewardPointsPhrase(creditDollars: number): string {
  const p = pointsFor(creditDollars);
  return `${p.toLocaleString("en-US")} rewards ${p === 1 ? "point" : "points"}`;
}
