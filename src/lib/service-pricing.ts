/**
 * Service-quote price finish (#217) — the last step of pricing a flame-test,
 * repair or inspection quote: floors, the $25 rounding, a typed total, the
 * back-solved margin, and the printed-line split.
 * Spec: docs/superpowers/specs/2026-09-26-venues-and-service-rounding-design.md §#217.
 *
 * This module has NO imports and touches no DB or server code: the three
 * quote builders' "use client" previews call the same finish functions as the
 * server engines (flametest-engine, repair-engine, inspection-engine), so the
 * preview and the saved price can never disagree (D285).
 *
 * The rules:
 *   - auto total = the engine's total exactly as before (floors applied), then
 *     rounded to the nearest $25 (half rounds up);
 *   - a typed total (priceOverride, whole dollars, $1–$10,000,000) replaces it
 *     exactly — never re-rounded, never margin-clamped;
 *   - margin amount = total − cost; the effective margin = 1 − cost ÷ total.
 */

export const PRICE_STEP = 25;
export const PRICE_OVERRIDE_MAX = 10_000_000;
/** A typed total under this margin (or under cost) warns — it never blocks. */
export const LOW_MARGIN_WARN = 0.1;
export const MARGIN_SLIDER_MIN = 10;
export const MARGIN_SLIDER_MAX = 50;

/** Nearest multiple of `step` (default $25); half rounds up; NaN → 0. */
export function roundToStep(x: number, step: number = PRICE_STEP): number {
  if (!Number.isFinite(x)) return 0;
  if (!(step > 0)) return x;
  // + 1e-9 keeps float noise (862.4999999999999) rounding up like the true half.
  return Math.floor(x / step + 0.5 + 1e-9) * step;
}

/**
 * Nearest multiple of `step` at or ABOVE `x`; NaN → 0. Used when a floor
 * (flame baseFee, inspection minFee, repair minCallout) set the price:
 * nearest-rounding a floored total can round it back DOWN below the floor
 * (a $360 call-out would round to $350), so a floored total always rounds up.
 * The −1e-9 keeps an exact multiple (float noise aside) from bumping up.
 * #267: also the Estimator's auto system price (always up to the next $25).
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

/** A typed flame venue testing cost: whole dollars, ≥ 0 ($0 = free); blank = computed. */
export function normalizeTestingOverride(raw: unknown): number | undefined {
  const n = wholeDollars(raw);
  return n != null && n >= 0 && n <= PRICE_OVERRIDE_MAX ? n : undefined;
}

/** cost ÷ (1 − margin) when 0 < margin < 1, else cost. */
export function sellAtMargin(cost: number, margin: number): number {
  return margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
}

export type FinishedPrice = {
  /** The total before rounding (floors already applied). */
  totalRaw: number;
  /** totalRaw rounded to the nearest $25. */
  autoTotal: number;
  /** What the quote prices: the typed total when set, else autoTotal. */
  total: number;
  priceOverride: number | null;
  overridden: boolean;
  marginAmount: number;
  /** 1 − cost ÷ total (0 when total is 0). */
  effectiveMargin: number;
};

/**
 * Round the auto total, apply a typed total, back-solve the margin.
 * `priceOverride` is normalized here (whole dollars, $1–$10,000,000, else
 * ignored) rather than trusted pre-normalized, so a builder or a save path
 * that hands this a raw typed value can never diverge from one that
 * pre-normalizes it. `floored` — a flame/inspection/repair floor is what
 * set `totalRaw` — rounds UP to the next $25 instead of to the nearest, so
 * the floor is never rounded back below itself.
 */
export function finishPrice(
  totalRaw: number,
  cost: number,
  priceOverride?: unknown,
  floored: boolean = false
): FinishedPrice {
  const autoTotal = floored ? ceilToStep(totalRaw) : roundToStep(totalRaw);
  const o = normalizePriceOverride(priceOverride) ?? null;
  const total = o ?? autoTotal;
  return {
    totalRaw,
    autoTotal,
    total,
    priceOverride: o,
    overridden: o != null,
    marginAmount: total - cost,
    effectiveMargin: total > 0 ? 1 - cost / total : 0,
  };
}

export type FlameFinish = FinishedPrice & {
  rawCost: number;
  baseFee: number;
  baseApplied: boolean;
  cost: number;
  /** The rate (slider) margin the auto total was priced at. */
  margin: number;
};

/** Flame tests: cost = max(baseFee, rawCost); total = cost ÷ (1 − margin), rounded. */
export function finishFlame(i: {
  rawCost: number;
  baseFee: number;
  margin: number;
  priceOverride?: number | null;
}): FlameFinish {
  const baseApplied = i.rawCost < i.baseFee;
  const cost = baseApplied ? i.baseFee : i.rawCost;
  return {
    rawCost: i.rawCost,
    baseFee: i.baseFee,
    baseApplied,
    cost,
    margin: i.margin,
    ...finishPrice(sellAtMargin(cost, i.margin), cost, i.priceOverride, baseApplied),
  };
}

export type InspectionFinish = FinishedPrice & {
  cost: number;
  sellRaw: number;
  minFee: number;
  minApplied: boolean;
  margin: number;
};

/** Inspections: total = max(minFee, cost ÷ (1 − margin)), rounded. */
export function finishInspection(i: {
  cost: number;
  minFee: number;
  margin: number;
  priceOverride?: number | null;
}): InspectionFinish {
  const sellRaw = sellAtMargin(i.cost, i.margin);
  const minApplied = sellRaw < i.minFee;
  return {
    cost: i.cost,
    sellRaw,
    minFee: i.minFee,
    minApplied,
    margin: i.margin,
    ...finishPrice(minApplied ? i.minFee : sellRaw, i.cost, i.priceOverride, minApplied),
  };
}

export type RepairFinish = FinishedPrice & {
  serviceCost: number;
  serviceSellRaw: number;
  minCallout: number;
  calloutApplied: boolean;
  /** The floored service sell before rounding (what serviceSell was before #217). */
  serviceSellAuto: number;
  partsCost: number;
  partsSell: number;
  /** total − partsSell: the service line absorbs the rounding / typed difference. */
  serviceSell: number;
  cost: number;
  margin: number;
  partsMargin: number;
  /** 1 − serviceCost ÷ serviceSell — the margin the builder's slider shows. */
  serviceMargin: number;
};

/**
 * Repairs: serviceSell = max(minCallout, serviceCost ÷ (1 − margin)); parts sell
 * at their own margin; total = serviceSell + partsSell, rounded (or typed).
 */
export function finishRepair(i: {
  serviceCost: number;
  minCallout: number;
  margin: number;
  partsCost: number;
  partsMargin: number;
  priceOverride?: number | null;
}): RepairFinish {
  const serviceSellRaw = sellAtMargin(i.serviceCost, i.margin);
  const calloutApplied = serviceSellRaw < i.minCallout;
  const serviceSellAuto = calloutApplied ? i.minCallout : serviceSellRaw;
  const partsSell = sellAtMargin(i.partsCost, i.partsMargin);
  const cost = i.serviceCost + i.partsCost;
  const fin = finishPrice(serviceSellAuto + partsSell, cost, i.priceOverride, calloutApplied);
  const serviceSell = fin.total - partsSell;
  // #217 fix wave 2: the service-only ratio (1 − serviceCost ÷ serviceSell)
  // blows up — or goes negative — whenever the FINAL serviceSell (total minus
  // parts, after rounding/typing) is zero or negative: a typed total that
  // lands below what the parts alone are selling for, or an auto price whose
  // rounded/floored service sell nets to $0 or less (a parts-only job with no
  // call-out floor). Gate on serviceSell, not the pre-rounding serviceSellAuto
  // — that guard missed the case where serviceSellAuto is positive but
  // rounding/typing still drives the final serviceSell to $0 or below. In
  // both cases report the whole-job effectiveMargin (already 1 − cost ÷
  // total) instead, so the slider/save-margin never shows a wild, negative,
  // or falsely-zero number near this cliff.
  const serviceMargin =
    fin.overridden || serviceSell <= 0 ? fin.effectiveMargin : 1 - i.serviceCost / serviceSell;
  return {
    ...fin,
    serviceCost: i.serviceCost,
    serviceSellRaw,
    minCallout: i.minCallout,
    calloutApplied,
    serviceSellAuto,
    partsCost: i.partsCost,
    partsSell,
    serviceSell,
    cost,
    margin: i.margin,
    partsMargin: i.partsMargin,
    serviceMargin,
  };
}

/** A flame venue's testing cost: the typed figure when set, else the computed one. */
export function venueTesting(
  computedCost: number,
  raw: unknown
): { laborCost: number; computedCost: number; testingOverride: number | null } {
  const o = normalizeTestingOverride(raw);
  return { laborCost: o ?? computedCost, computedCost, testingOverride: o ?? null };
}

export function fmtDollars(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

/** A margin fraction as points with one decimal: 0.28125 → "28.1". */
export function fmtPts(margin: number): string {
  const v = Math.round((Number.isFinite(margin) ? margin : 0) * 1000) / 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** The builder's 10–50 slider position for a (back-solved) margin. */
export function sliderPts(margin: number): number {
  const pts = Math.round(margin * 100);
  if (!Number.isFinite(pts)) return MARGIN_SLIDER_MIN;
  return Math.max(MARGIN_SLIDER_MIN, Math.min(MARGIN_SLIDER_MAX, pts));
}

export type PriceWarning = {
  kind: "below-cost" | "low-margin" | "below parts price";
  text: string;
} | null;

/**
 * Warning (never a block) for a typed total below cost or under a 10%
 * margin. `partsSell` (repairs only) checks first: a typed total under what
 * the parts alone are selling for is a sharper signal than the whole-job
 * below-cost check — it can fire even when the total still clears the raw
 * job cost, since parts sell at a margin above their raw cost.
 */
export function typedPriceWarning(
  total: number,
  cost: number,
  margin: number,
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
  if (margin < LOW_MARGIN_WARN)
    return {
      kind: "low-margin",
      text: `Low margin — ${fmtPts(margin)} pts at this total, under ${Math.round(LOW_MARGIN_WARN * 100)} pts.`,
    };
  return null;
}

/**
 * The letters' one dollar component line (D283 fly-mode travel) reconciled to
 * the final total: travel's proportional share, flight × total ÷ cost, clamped
 * to [0, total]; the service part (`rest`) absorbs rounding and a typed total,
 * so the printed parts always sum to the total. With no stored cost (legacy
 * quotes) it falls back to D283's flight ÷ (1 − margin).
 */
export function travelLineShare(i: {
  flightTotal: number;
  total: number;
  cost?: number | null;
  margin?: number | null;
}): { travel: number; rest: number } {
  const total = Math.max(0, Math.round(i.total || 0));
  const flight = Math.max(0, i.flightTotal || 0);
  const m = i.margin ?? 0;
  const share =
    i.cost != null && i.cost > 0
      ? Math.round((flight * total) / i.cost)
      : Math.round(m > 0 && m < 1 ? flight / (1 - m) : flight);
  const travel = Math.max(0, Math.min(total, share));
  return { travel, rest: total - travel };
}

/**
 * Shared computation behind seedPriceOverride() / seedPriceOverrideIsLegacy():
 * the saved priceOverride wins outright (a real hand-set price, `legacy`
 * false); otherwise — D286 parity, a sent price must not silently change —
 * a quote past draft whose value is off the $25 grid (saved before #217)
 * seeds that value typed in, flagged `legacy` true since it's a reopen
 * artifact, not something anyone actually typed.
 */
function seedOverrideInfo(
  status: string,
  value: unknown,
  saved: unknown,
  storedSeeded?: unknown
): { value: number | null; legacy: boolean } {
  const typed = normalizePriceOverride(saved);
  // #217 fix wave: a real saved priceOverride only reads as "legacy" (a D286
  // reopen-seed nobody actually typed) when the doc itself already says so.
  // Without storedSeeded, a SECOND reopen of an already-seeded quote (the
  // saved priceOverride is now present) would read as a real hand-set price
  // even though the first reopen correctly flagged it legacy — see
  // deriveSeededMarker below, which the save actions use instead of
  // trusting a client-posted flag for the same reason.
  if (typed != null) return { value: typed, legacy: storedSeeded === true };
  if (status === "draft") return { value: null, legacy: false };
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (v <= 0 || v % PRICE_STEP === 0) return { value: null, legacy: false };
  const legacyValue = normalizePriceOverride(v) ?? null;
  return { value: legacyValue, legacy: legacyValue != null };
}

/**
 * The builder's typed-total seed when a saved quote is reopened: its saved
 * priceOverride; else — D286 parity, a sent price must not silently change —
 * a quote past draft whose value is off the $25 grid (saved before #217)
 * reopens with that value typed in. Drafts and on-grid values reopen on auto.
 */
export function seedPriceOverride(status: string, value: unknown, saved: unknown): number | null {
  return seedOverrideInfo(status, value, saved).value;
}

/**
 * True when seedPriceOverride()'s result is the D286 legacy-parity fallback
 * (an old off-grid sent price) rather than a real saved priceOverride.
 * deriveSeededMarker reads it on the server, from the stored quote, and the
 * save action stores the result as `priceOverrideSeeded` alongside
 * `priceOverride`, so next year's renewal draft (priorHandSetPrice in
 * renewal-outreach.ts) never calls a rounding artifact "hand-set".
 */
export function seedPriceOverrideIsLegacy(
  status: string,
  value: unknown,
  saved: unknown,
  storedSeeded?: unknown
): boolean {
  return seedOverrideInfo(status, value, saved, storedSeeded).legacy;
}

/**
 * #217 fix wave — the D286 `priceOverrideSeeded` marker, derived on the
 * SERVER from the quote as stored before this save rather than trusted from
 * a client-posted flag. The old flow trusted `formData.get("priceOverrideSeeded")`,
 * which (a) let a client hide a real hand-set price by posting the flag, and
 * (b) went stale on the SECOND save of an already-seeded quote: the builder
 * reopens with `priceOverride` already present (the value just saved), so
 * `seedPriceOverrideIsLegacy` — reading only whether a saved priceOverride
 * exists — read it as a real hand-set price, the builder posted
 * `priceOverrideSeeded=""`, and the marker was dropped from the save.
 *
 * True iff a priceOverride is being saved AND it is exactly the total the
 * builder reopened with (seedPriceOverride of the stored quote) AND that
 * reopen-seed was the D286 legacy fallback (seedPriceOverrideIsLegacy — an
 * old off-grid sent price, or a saved priceOverride already carrying this
 * marker). Re-derived from the same two functions the builder's reopen
 * uses, so: a sent on-grid quote (no seed) where the user types the same
 * number is a real hand-set price (false); a legacy fractional value (stored
 * 821.4, reopened and saved as 821) stays flagged (true). Any other typed
 * total — a genuinely new hand-set price — is never flagged.
 */
export function deriveSeededMarker(i: {
  /** The (already-normalized) priceOverride about to be saved; null/undefined = none. */
  postedOverride: number | null | undefined;
  /** The quote as stored before this save; null for a brand-new quote. */
  stored: {
    value: number;
    status: string;
    priceOverride?: number | null;
    priceOverrideSeeded?: boolean;
  } | null;
}): boolean {
  const s = i.stored;
  if (i.postedOverride == null || !s) return false;
  return (
    i.postedOverride === seedPriceOverride(s.status, s.value, s.priceOverride) &&
    seedPriceOverrideIsLegacy(s.status, s.value, s.priceOverride, s.priceOverrideSeeded)
  );
}
