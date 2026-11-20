/**
 * Stored credit lines on quotes.
 *
 * The Customer Rewards program was removed (stage 1 of the app shrink). Quotes
 * saved while it existed may still carry a credit: on an Estimator quote, ONE
 * `SpecItem` flagged `rewardCredit: true` (qty 1, cost 0, a negative `price`)
 * on the last In-total system; on a flame-test / inspection / repair quote, a
 * whole-dollar `rewardCredit` on the service subdoc. The quote's stored
 * `value` is net of that credit. This module only READS and carries those
 * stored amounts so old quotes keep adding up — nothing applies a new credit,
 * and a save can never raise one (`sanitizeRewardCredit`).
 *
 * Pure and client-safe (type-only imports).
 */

import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

export const REWARD_CREDIT_DESC = "Credit";

/** The customer document's line for a stored credit. */
export const CREDIT_APPLIED_LABEL = "Credit applied";

const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** True for the Rewards credit line. Structural (works on any stored shape). */
export function isRewardCreditItem(it: unknown): boolean {
  return !!it && typeof it === "object" && (it as { rewardCredit?: unknown }).rewardCredit === true;
}

/** The credit one credit line carries (a positive number; 0 when malformed). */
export function creditLineAmount(it: Pick<SpecItem, "qty" | "price">): number {
  const q = typeof it.qty === "number" && Number.isFinite(it.qty) ? it.qty : 0;
  const p = typeof it.price === "number" && Number.isFinite(it.price) ? it.price : 0;
  return round2(Math.max(0, -(q * p)));
}

/** The total Rewards credit on a quote's sections (any stored shape). */
export function rewardCreditOf(sections: unknown): number {
  if (!Array.isArray(sections)) return 0;
  let sum = 0;
  for (const sec of sections) {
    const items = sec && typeof sec === "object" ? (sec as { items?: unknown }).items : null;
    if (!Array.isArray(items)) continue;
    for (const it of items) if (isRewardCreditItem(it)) sum += creditLineAmount(it as SpecItem);
  }
  return round2(sum);
}

/**
 * THE "credit applied" accessor for a stored quote — every ledger, hold and
 * spend path reads this one function: the Estimator's credit line(s) on
 * `spec.sections` (phase 2) plus a flame-test / inspection / repair quote's
 * `<subdoc>.rewardCredit` (phase 3, service-credit.ts). 0 for any other shape.
 */
export function quoteRewardCredit(
  q: { spec?: unknown; quoteType?: unknown; flameTest?: unknown; inspection?: unknown; repair?: unknown } | null | undefined
): number {
  if (!q) return 0;
  const spec = q.spec;
  const onSpec = spec && typeof spec === "object" ? rewardCreditOf((spec as { sections?: unknown }).sections) : 0;
  return round2(onSpec + serviceRewardCredit(q));
}

/** A stored quote's price before any Rewards credit: `value` (net) + the credit applied. */
export function grossQuoteValue(
  q: { value?: unknown; spec?: unknown; quoteType?: unknown; flameTest?: unknown; inspection?: unknown; repair?: unknown } | null | undefined
): number {
  const v = typeof q?.value === "number" && Number.isFinite(q.value) ? q.value : 0;
  return round2(v + quoteRewardCredit(q));
}

/** The sections with every credit line removed. */
export function withoutRewardCredit<T extends SpecSection>(sections: T[]): T[] {
  return sections.map((s) =>
    s && Array.isArray(s.items) && s.items.some(isRewardCreditItem)
      ? { ...s, items: s.items.filter((it) => !isRewardCreditItem(it)) }
      : s
  );
}

/** A fresh credit line for `amount` (> 0). */
export function rewardCreditLine(amount: number, id: number): SpecItem {
  return {
    id,
    sku: "",
    desc: REWARD_CREDIT_DESC,
    qty: 1,
    unit: "ea",
    cost: 0,
    price: -round2(Math.max(0, amount)),
    rewardCredit: true,
  };
}

/**
 * The sections carrying exactly one credit line of `amount` on the LAST
 * In-total system — the last one without the Phase 2b `alternate` stamp
 * (fallback: the last system, when every system is an alternate). Every other
 * credit line is removed. `amount` ≤ 0, or no systems at all, leaves no credit
 * line. The existing line keeps its id when there was one.
 */
export function withRewardCredit<T extends SpecSection>(sections: T[], amount: number, newId: number): T[] {
  let keepId: number | null = null;
  for (const s of sections) for (const it of s?.items || []) if (isRewardCreditItem(it) && keepId == null) keepId = it.id;
  const stripped = withoutRewardCredit(sections);
  const a = round2(amount);
  if (!(a > 0) || !stripped.length) return stripped;
  let last = stripped.length - 1;
  for (let i = stripped.length - 1; i >= 0; i--) {
    if (stripped[i]?.alternate !== true) {
      last = i;
      break;
    }
  }
  return stripped.map((s, i) =>
    i === last ? { ...s, items: [...(s.items || []), rewardCreditLine(a, keepId ?? newId)] } : s
  );
}

export type SanitizedCredit<T> = { ok: true; sections: T[]; credit: number } | { ok: false; error: string };

export const NEGATIVE_LINE_ERROR = "A line can't have a negative price or quantity.";

/**
 * Server rule for a posted Estimator save: a negative price or quantity is
 * accepted ONLY on a stored credit line (anything else refuses the save);
 * every credit line collapses into one on the last system, never more than
 * `maxCredit` — what the stored quote already carried. `maxCredit` ≤ 0
 * removes it.
 */
export function sanitizeRewardCredit<T extends SpecSection>(sections: T[], maxCredit: number): SanitizedCredit<T> {
  for (const s of sections) {
    for (const it of s?.items || []) {
      if (!it || isRewardCreditItem(it)) continue;
      const p = it.price;
      const q = it.qty;
      if ((typeof p === "number" && p < 0) || (typeof q === "number" && q < 0)) {
        return { ok: false, error: NEGATIVE_LINE_ERROR };
      }
    }
  }
  const posted = rewardCreditOf(sections);
  const cap = Number.isFinite(maxCredit) ? Math.max(0, maxCredit) : posted;
  const credit = round2(Math.min(posted, cap));
  let maxId = 0;
  for (const s of sections) for (const it of s?.items || []) if (typeof it?.id === "number" && it.id > maxId) maxId = it.id;
  return { ok: true, sections: withRewardCredit(sections, credit, maxId + 1), credit };
}
