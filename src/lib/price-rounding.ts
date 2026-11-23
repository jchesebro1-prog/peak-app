/**
 * Price rounding and typed-price helpers (moved from the removed service-quote price finish, #217 — the flame-test,
 * repair and inspection engines are gone; the Estimator's system price and the review limits still use these).
 * Pure: imports nothing, touches no DB or server code.
 *
 *   - an auto price rounds to a $25 step (nearest, or always up);
 *   - a typed total (whole dollars, $1–$10,000,000) replaces it exactly — never re-rounded;
 *   - a typed total below cost or under an 11 % markup warns, never blocks.
 */

export const PRICE_STEP = 25;
export const PRICE_OVERRIDE_MAX = 10_000_000;
/** A typed total under this markup (or under cost) warns — it never blocks. #367: 10 % margin → 11 % markup. */
export const LOW_MARKUP_WARN = 0.11;

/** Nearest multiple of `step` (default $25); half rounds up; NaN → 0. */
export function roundToStep(x: number, step: number = PRICE_STEP): number {
  if (!Number.isFinite(x)) return 0;
  if (!(step > 0)) return x;
  // + 1e-9 keeps float noise (862.4999999999999) rounding up like the true half.
  return Math.floor(x / step + 0.5 + 1e-9) * step;
}

/**
 * Nearest multiple of `step` at or ABOVE `x`; NaN → 0. The −1e-9 keeps an
 * exact multiple (float noise aside) from bumping up. #267: the Estimator's
 * auto system price (always up to the next $25).
 */
export function ceilToStep(x: number, step: number = PRICE_STEP): number {
  if (!Number.isFinite(x)) return 0;
  if (!(step > 0)) return x;
  return Math.ceil(x / step - 1e-9) * step;
}

/**
 * A posted/typed dollar figure → whole dollars; undefined for blank or junk.
 * A string is stripped of `$`, commas and spaces, then must be plain digits
 * (optionally with a decimal point) — no hex, exponent or leading minus, so
 * "0x10", "1e3" and "-0.4" are rejected rather than silently parsed by
 * `Number()`. A raw JS number is trusted as-is (it carries no such notation).
 */
function wholeDollars(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return undefined;
    const n = Math.round(raw);
    return Object.is(n, -0) ? 0 : n;
  }
  if (typeof raw !== "string") return undefined;
  const s = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** A typed quote total: whole dollars, > 0 and ≤ $10,000,000; else no override. */
export function normalizePriceOverride(raw: unknown): number | undefined {
  const n = wholeDollars(raw);
  return n != null && n > 0 && n <= PRICE_OVERRIDE_MAX ? n : undefined;
}

export function fmtDollars(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

/** A markup fraction as a percent with one decimal: 0.428571 → "42.9". */
export function fmtPct(markup: number): string {
  const v = Math.round((Number.isFinite(markup) ? markup : 0) * 1000) / 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export type PriceWarning = {
  kind: "below-cost" | "low-markup" | "below parts price";
  text: string;
} | null;

/**
 * Warning (never a block) for a typed total below cost or under an 11%
 * markup (the markup check needs a positive cost — a $0-cost job never reads "Low markup — 0%"). `partsSell` (repairs only) checks first: a typed total under what
 * the parts alone are selling for is a sharper signal than the whole-job
 * below-cost check — it can fire even when the total still clears the raw
 * job cost, since parts sell at a markup above their raw cost.
 */
export function typedPriceWarning(
  total: number,
  cost: number,
  markup: number,
  partsSell?: number | null
): PriceWarning {
  if (partsSell != null && total < partsSell)
    return {
      kind: "below parts price",
      text: `Below parts price — ${fmtDollars(total)} doesn't cover the ${fmtDollars(partsSell)} parts alone.`,
    };
  if (total < cost)
    return {
      kind: "below-cost",
      text: `Below cost — ${fmtDollars(total)} is ${fmtDollars(cost - total)} under the ${fmtDollars(cost)} cost.`,
    };
  // #367: with no positive cost there is no markup to judge (it reads 0) — only the checks above apply.
  if (cost > 0 && markup < LOW_MARKUP_WARN)
    return {
      kind: "low-markup",
      text: `Low markup — ${fmtPct(markup)}% at this total, under ${Math.round(LOW_MARKUP_WARN * 100)}%.`,
    };
  return null;
}
