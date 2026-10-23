/**
 * Markup pricing (spec docs/superpowers/specs/2026-10-23-markup-pricing-design.md):
 * every pricing percentage in Quartzite is markup on cost —
 *   sell = cost × (1 + markup)      markup = (sell − cost) ÷ cost
 * replacing the margin-on-price convention (D87, D413, D635). NO imports: the
 * doc store, "use client" builders, engines and the harness all share it.
 */

/** The stamp on a quote / project doc whose stored percentages are markup. */
export const PRICING_BASIS = "markup" as const;
export type PricingBasis = typeof PRICING_BASIS;

/** 1,900 % — the old 0.95 margin clamp (labor, sellFromCost guards), in markup. */
export const MARKUP_MAX = 19;

/** Peak's flat default: the old 30 % margin (42.857 %) rounded to a whole percent. */
export const DEFAULT_MARKUP = 0.43;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Exact: m ÷ (1 − m). A margin ≥ 0.95 clamps to MARKUP_MAX; junk → 0. */
export function marginToMarkup(m: number): number {
  if (!fin(m)) return 0;
  if (m >= 0.95) return MARKUP_MAX;
  return m / (1 - m);
}

/** Exact: k ÷ (1 + k), with k floored at −0.99 so the result is always finite; junk → 0. */
export function markupToMargin(k: number): number {
  if (!fin(k)) return 0;
  const c = Math.max(k, -0.99);
  return c / (1 + c);
}

/** cost × (1 + markup). A non-finite markup sells at cost. Unrounded — callers round as before. */
export function sellAt(cost: number, markup: number): number {
  return fin(markup) ? cost * (1 + markup) : cost;
}

/** (sell − cost) ÷ cost; null when there is no positive cost or either number is junk. */
export function markupOf(cost: number, sell: number): number | null {
  if (!fin(cost) || !fin(sell) || !(cost > 0)) return null;
  return (sell - cost) / cost;
}

/** sell ÷ (1 + markup) — the cost behind a sell; sell itself when 1 + markup ≤ 0 or junk. */
export function costFromSell(sell: number, markup: number): number {
  return fin(markup) && 1 + markup > 0 ? sell / (1 + markup) : sell;
}

/** To a whole percent: 0.428571 → 0.43. */
export function roundMarkupPct(k: number): number {
  return fin(k) ? Math.round(k * 100) / 100 : 0;
}

/** Same whole percent (0.428571 and 0.43 are both 43 %). */
export function sameWholeMarkup(a: number, b: number): boolean {
  return fin(a) && fin(b) && Math.round(a * 100) === Math.round(b * 100);
}

/**
 * The exact legacy markup a rounded markup came from, else null. Every
 * pre-switch tier/default was a whole-percent MARGIN, so a converted setting
 * rounded to whole-% markup has one twin: 0.43 ← 0.428571 (30 %), 0.37 ←
 * 0.369863 (27 %). Lines priced before the switch sit at the twin; seed
 * checks accept either. Exact conversions (Gold 25 %) have no twin.
 */
export function legacyTwinOf(k: number): number | null {
  if (!fin(k) || !(k > 0)) return null;
  const wholeMargin = Math.round(markupToMargin(k) * 100) / 100;
  const twin = marginToMarkup(wholeMargin);
  return twin !== k && Math.abs(twin - k) < 0.005 ? twin : null;
}

/** "42.9%" / "43%" — one decimal at most. */
export function fmtMarkupPct(k: number): string {
  const v = Math.round((fin(k) ? k : 0) * 1000) / 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}

/** A labor draft's stored percent string: 0.428571… → "42.8571", 0.43 → "43". */
export function markupPctString(k: number): string {
  return String(Math.round((fin(k) ? k : 0) * 1e6) / 1e4);
}
