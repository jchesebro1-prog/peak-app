/**
 * Freight by distance (#245, spec 2026-09-27-portal-catalog-design.md §2.2).
 * base % under the first step, + stepPct for every full stepMiles, capped.
 * Unknown distance charges the cap (err high) and says so. Pure.
 */
export type FreightRule = { basePct: number; stepMiles: number; stepPct: number; capPct: number };

export const DEFAULT_FREIGHT_RULE: FreightRule = { basePct: 2, stepMiles: 200, stepPct: 1, capPct: 10 };

export const FREIGHT_RATE_IDS = {
  base: "freight.basePct",
  stepMiles: "freight.stepMiles",
  stepPct: "freight.stepPct",
  cap: "freight.capPct",
} as const;

export const PORTAL_RATE_IDS = {
  validityDays: "portal.validityDays",
  browseMinQuotes: "portal.browseMinQuotes",
  browseWindowMonths: "portal.browseWindowMonths",
  staleCostMonths: "portal.staleCostMonths",
} as const;

export function freightPctForMiles(
  miles: number | null | undefined,
  rule: FreightRule
): { pct: number; atCapUnknown: boolean } {
  if (miles == null || !Number.isFinite(miles) || miles < 0) return { pct: rule.capPct, atCapUnknown: true };
  const steps = rule.stepMiles > 0 ? Math.floor(miles / rule.stepMiles) : 0;
  const pct = Math.min(rule.capPct, rule.basePct + steps * rule.stepPct);
  return { pct: Math.round(pct * 100) / 100, atCapUnknown: false };
}
