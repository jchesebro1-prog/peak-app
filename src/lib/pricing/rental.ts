/**
 * Rentals module — the rental-line pricing formula. Pure, no store access.
 *
 * Rentman's own docs don't specify a mixed-period billing rule (flagged as an
 * open question in the design spec); the default here bills whichever of
 * day/week/month math is cheapest for the customer — simple, deterministic,
 * no waiting on a rate-card decision.
 */
export function priceRental(
  days: number,
  rates: { dayRate: number; weekRate: number; monthRate: number }
): number {
  if (days <= 0) return 0;
  // Only positive rates are candidates — a blank/zero rate (e.g. entered
  // blank via the Rentals hub form, which coerces empty input to 0) must
  // never win the min() and silently price the whole rental free. Fall
  // back to 0 only if the item has no usable rate data at all.
  const candidates: number[] = [];
  if (rates.dayRate > 0) candidates.push(days * rates.dayRate);
  if (rates.weekRate > 0) candidates.push(Math.ceil(days / 7) * rates.weekRate);
  if (rates.monthRate > 0) candidates.push(Math.ceil(days / 30) * rates.monthRate);
  if (candidates.length === 0) return 0;
  return Math.min(...candidates);
}
