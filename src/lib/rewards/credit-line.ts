/**
 * Customer Rewards — the Estimator's "Rewards credit" line (#282 phase 2,
 * spec docs/superpowers/specs/2026-09-30-customer-rewards-design.md §5).
 *
 * Pure and client-safe (type-only imports plus the pure service-credit.ts,
 * which holds the phase 3 service-quote credit). The credit is ONE `SpecItem`
 * flagged `rewardCredit: true` on the quote's LAST system — qty 1, cost 0,
 * a negative `price`, desc "Rewards credit", no SKU. It is a quote-level
 * amount parked on a line so it rides the existing save/revision/PDF
 * plumbing; every system-level rule (items sell/cost, freight base, the #267
 * typed sell and $25 rounding, customer rows, margin readouts, parts list,
 * tier re-price, copy/move) skips it, and `totals()` subtracts it from the
 * grand total after tax. The quote's stored `value` is therefore net of
 * credit (what the customer pays).
 *
 * The ONLY line allowed a negative price is a credit line — the server
 * refuses a save that carries one anywhere else (`sanitizeRewardCredit`).
 */

import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { serviceRewardCredit } from "./service-credit";
import { roundDownDollars } from "./points";

export const REWARD_CREDIT_DESC = "Rewards credit";

const round2 = (n: number) => Math.round(n * 100) / 100;

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
 * system (every other credit line removed). `amount` ≤ 0, or no systems at
 * all, leaves no credit line. The existing line keeps its id when there was one.
 */
export function withRewardCredit<T extends SpecSection>(sections: T[], amount: number, newId: number): T[] {
  let keepId: number | null = null;
  for (const s of sections) for (const it of s?.items || []) if (isRewardCreditItem(it) && keepId == null) keepId = it.id;
  const stripped = withoutRewardCredit(sections);
  const a = round2(amount);
  if (!(a > 0) || !stripped.length) return stripped;
  const last = stripped.length - 1;
  return stripped.map((s, i) =>
    i === last ? { ...s, items: [...(s.items || []), rewardCreditLine(a, keepId ?? newId)] } : s
  );
}

/**
 * What can go on this quote: available credit, never more than its
 * pre-credit total — in WHOLE dollars, rounded down (#282 points follow-up:
 * the customer sees the credit as points, 1 point = $1, so an applied credit
 * is always a whole number of points). New balances are whole dollars, so
 * this is exact; a legacy cents balance (or a staff Adjust to the cent)
 * leaves its cents on the balance.
 */
export function maxApplicableCredit(available: number, preCreditTotal: number): number {
  const a = Number.isFinite(available) ? available : 0;
  const t = Number.isFinite(preCreditTotal) ? preCreditTotal : 0;
  return roundDownDollars(Math.min(a, t));
}

export type SanitizedCredit<T> =
  | {
      ok: true;
      sections: T[];
      credit: number;
      posted: number;
      clamped: boolean;
      /** Only the whole-dollar rounding cut it (a legacy cents credit). */
      rounded: boolean;
    }
  | { ok: false; error: string };

export const NEGATIVE_LINE_ERROR =
  "A line can't have a negative price or quantity — use Apply credit for a Rewards credit.";

/**
 * Server rule for a posted Estimator save (#282 §5): a negative price or
 * quantity is accepted ONLY on a `rewardCredit` line (anything else refuses
 * the save); every credit line collapses into one on the last system,
 * clamped to `maxCredit` (available credit, capped at the quote's
 * pre-credit total — the caller computes it) in whole dollars, rounded
 * down (#282 points follow-up). `maxCredit` ≤ 0 removes it.
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
  // #282 points follow-up: whole dollars, rounded down (never above what was
  // posted or what is available).
  const whole = roundDownDollars(posted);
  const cap = maxCredit === Number.POSITIVE_INFINITY ? whole : roundDownDollars(Number.isFinite(maxCredit) ? maxCredit : 0);
  const credit = Math.min(whole, cap);
  let maxId = 0;
  for (const s of sections) for (const it of s?.items || []) if (typeof it?.id === "number" && it.id > maxId) maxId = it.id;
  return {
    ok: true,
    sections: withRewardCredit(sections, credit, maxId + 1),
    credit,
    posted,
    clamped: credit < posted,
    rounded: credit < posted && credit === whole,
  };
}
