/**
 * Customer Rewards — the credit on a flame-test, inspection or repair quote
 * (#282 phase 3, spec docs/superpowers/specs/2026-09-30-customer-rewards-design.md
 * §5 "Service quotes").
 *
 * The credit is ONE number on the quote's engine subdoc —
 * `flameTest.rewardCredit` / `inspection.rewardCredit` / `repair.rewardCredit`
 * — in whole dollars (service quotes price in whole dollars, #217). It
 * applies AFTER the engine's final total: after the $25 rounding, a typed
 * total (priceOverride) and the #275 lift rental. The subdoc's `total` stays
 * the engine total (pre-credit); the quote's `value` is net of credit
 * (`max(0, total − credit)`), the same rule the Estimator's credit line
 * follows (phase 2). Revisions snapshot the subdoc, so they carry it too.
 *
 * `quoteRewardCredit()` (credit-line.ts) is the one "credit applied" accessor
 * — it reads the Estimator's credit line AND this field, so the ledger's
 * redeem/unredeem, the available-credit holds and lifetime spend all see a
 * service credit without a second code path.
 *
 * Pure and client-safe: no imports.
 */

/** The quote types that can carry a service credit → their engine subdoc key. */
export const SERVICE_CREDIT_SUBDOC = {
  flame_test: "flameTest",
  inspection: "inspection",
  repair: "repair",
} as const;

export type ServiceCreditQuoteType = keyof typeof SERVICE_CREDIT_SUBDOC;
export type ServiceCreditSubdocKey = (typeof SERVICE_CREDIT_SUBDOC)[ServiceCreditQuoteType];

/** The subdoc key for a quote type, or null when the type carries no service credit. */
export function serviceCreditSubdocKey(quoteType: unknown): ServiceCreditSubdocKey | null {
  return typeof quoteType === "string" && Object.prototype.hasOwnProperty.call(SERVICE_CREDIT_SUBDOC, quoteType)
    ? SERVICE_CREDIT_SUBDOC[quoteType as ServiceCreditQuoteType]
    : null;
}

/** The most a service credit can be (the #217 typed-total ceiling). */
export const SERVICE_CREDIT_MAX = 10_000_000;

/**
 * A posted / stored credit → whole dollars, ≥ 0. Fractions round DOWN (a
 * credit never exceeds what was asked for or what is available). Accepts a
 * number or a "$1,250" string; junk, negatives and a leading minus → 0.
 */
export function normalizeServiceCredit(raw: unknown): number {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const s = raw.replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return 0;
    n = Number(s);
  } else return 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(SERVICE_CREDIT_MAX, Math.floor(n + 1e-9));
}

/** The credit stored on a quote's service subdoc (0 for any other quote type or shape). */
export function serviceRewardCredit(
  q: { quoteType?: unknown; flameTest?: unknown; inspection?: unknown; repair?: unknown } | null | undefined
): number {
  const key = serviceCreditSubdocKey(q?.quoteType);
  if (!key) return 0;
  const sub = (q as Record<string, unknown>)[key];
  if (!sub || typeof sub !== "object") return 0;
  return normalizeServiceCredit((sub as { rewardCredit?: unknown }).rewardCredit);
}

/** What the customer pays: the engine total less the credit, never below $0. */
export function netServiceTotal(total: number, credit: number): number {
  const t = Number.isFinite(total) ? total : 0;
  const c = Number.isFinite(credit) && credit > 0 ? credit : 0;
  return Math.max(0, Math.round(t - c));
}

/**
 * A saved service quote's price, split for the letters: `gross` (the engine
 * total — what every component line reconciles to), `credit`, and `net` (what
 * the customer pays). `quote.value` is already net; a legacy quote with no
 * value falls back to the subdoc's total.
 */
export function serviceLetterPrice(
  quote: { value?: number | null; quoteType?: unknown; flameTest?: unknown; inspection?: unknown; repair?: unknown },
  sub: { total?: number | null } | null | undefined
): { gross: number; credit: number; net: number } {
  const credit = serviceRewardCredit(quote);
  const net =
    quote.value != null && Number.isFinite(quote.value) ? quote.value : netServiceTotal(sub?.total || 0, credit);
  return { gross: net + credit, credit, net };
}

export type ServiceCreditSettle = {
  /** What the save stores (whole dollars, 0 = none). */
  credit: number;
  /** Set when the posted amount was reduced or dropped. */
  notice?: string;
};

/**
 * The server's rule for the credit a service-quote save stores (#282 §5):
 *
 * - a won or lost quote keeps the credit it had (its redeem is on the ledger;
 *   the builder can't move it — phase 2's rule), whatever was posted;
 * - a portal service quote (#248) never carries one;
 * - no customer, or a customer different from the stored quote's, drops it;
 * - otherwise it is clamped to the company's available credit (whole dollars,
 *   rounded down) and to the quote's engine total (net never below $0);
 * - without `create` it can't grow past what the stored quote already had.
 *
 * `available` is the caller's `companyCredit(customerId, quoteId).available`
 * (balance − credit on the company's OTHER open quotes).
 */
export function settleServiceCredit(i: {
  posted: unknown;
  /** The engine total — after $25 rounding, a typed total and a lift. */
  total: number;
  available: number;
  customerId: string | null;
  /** The source the save stores (`portal-service` never carries credit). */
  source: string;
  mayApply: boolean;
  prior: { status: string; customerId: string | null; credit: number } | null;
}): ServiceCreditSettle {
  return settleCredit({ ...i, unit: "dollars" });
}

/** Cents, rounded DOWN (never above what was asked for or is available). */
function toCents(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(SERVICE_CREDIT_MAX, Math.floor(n * 100 + 1e-6) / 100);
}

/**
 * The one credit rule behind settleServiceCredit (whole dollars) and the
 * revision-recall re-clamp (#282 phase 3 — service quotes in whole dollars,
 * Estimator quotes to the cent, the unit phase 2's credit line uses). Same
 * steps as settleServiceCredit's doc above.
 */
export function settleCredit(i: {
  posted: unknown;
  total: number;
  available: number;
  customerId: string | null;
  source: string;
  mayApply: boolean;
  prior: { status: string; customerId: string | null; credit: number } | null;
  unit: "dollars" | "cents";
}): ServiceCreditSettle {
  const norm = i.unit === "dollars" ? normalizeServiceCredit : toCents;
  const prior = i.prior;
  if (prior && (prior.status === "won" || prior.status === "lost")) return { credit: norm(prior.credit) };
  const posted = norm(i.posted);
  if (!(posted > 0)) return { credit: 0 };
  if (i.source === "portal-service") return { credit: 0, notice: "Rewards credit removed — a portal quote can't carry a credit." };
  if (!i.customerId) return { credit: 0, notice: "Rewards credit removed — pick a customer first." };
  if (prior && (prior.customerId || null) !== i.customerId) {
    return { credit: 0, notice: "Rewards credit removed — it belonged to the quote's previous customer." };
  }
  const avail = norm(i.available);
  const total = norm(i.total);
  const held = !i.mayApply ? (prior ? norm(prior.credit) : 0) : Number.POSITIVE_INFINITY;
  const credit = Math.min(posted, avail, total, held);
  if (credit === posted) return { credit };
  const dollars =
    i.unit === "dollars"
      ? `$${credit.toLocaleString("en-US")}`
      : `$${credit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const why =
    credit === held && held < Math.min(avail, total)
      ? "applying Rewards credit needs create permission"
      : credit === total && total < avail
        ? "a credit can't take the quote below $0"
        : "that's what this customer has available for this quote";
  return {
    credit,
    notice: credit > 0 ? `Rewards credit reduced to ${dollars} — ${why}.` : `Rewards credit removed — ${why}.`,
  };
}
