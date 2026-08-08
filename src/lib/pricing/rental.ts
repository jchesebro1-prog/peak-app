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
  const byDay = days * rates.dayRate;
  const byWeek = Math.ceil(days / 7) * rates.weekRate;
  const byMonth = Math.ceil(days / 30) * rates.monthRate;
  return Math.min(byDay, byWeek, byMonth);
}
