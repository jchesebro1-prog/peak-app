import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

/** Firm vs review, validity, accept eligibility, card guard (#245, spec §2.3/§4). Pure. */
export type ModeLine = { por: boolean };
export function quoteMode(lines: readonly ModeLine[]): { mode: "firm" | "review"; porCount: number; reason: string | null } {
  const porCount = lines.filter((l) => l.por).length;
  if (!porCount) return { mode: "firm", porCount, reason: null };
  return { mode: "review", porCount, reason: `${porCount} ${porCount === 1 ? "line is" : "lines are"} price on request` };
}
export function firmValidUntil(generatedAt: number, validityDays: number): number {
  return generatedAt + Math.max(1, Math.round(validityDays)) * 86400000;
}
export function canAcceptPortal(
  q: { status: string; portalAcceptance?: unknown; portalFirm?: { validUntil: number } | null; portalReview?: unknown },
  now: number
): { ok: boolean; reason?: "not-sent" | "accepted" | "expired" } {
  if (q.status !== "sent") return { ok: false, reason: "not-sent" };
  if (q.portalAcceptance) return { ok: false, reason: "accepted" };
  // #245 Task 13 (spec §4.5): a refresh that flips into review must never
  // stay acceptable — checked here (not only via the status change a
  // sent→draft refresh makes) as the belt-and-suspenders rule for any path
  // that keeps status "sent" while portalReview is set.
  if (q.portalReview) return { ok: false, reason: "not-sent" };
  if (q.portalFirm && now > q.portalFirm.validUntil) return { ok: false, reason: "expired" };
  return { ok: true };
}
function luhn(d: string): boolean {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
/** A 13–19 digit run (spaces/dashes allowed between digits) that passes Luhn. */
export function looksLikeCardNumber(text: string): boolean {
  // Digit groups separated by a single space or dash form one run; a card is
  // any contiguous span of WHOLE groups totalling 13–19 digits that passes Luhn.
  // Checking whole groups (not every sliding window) catches "PO 12345 4111 1111 1111 1111"
  // without flagging long tracking numbers by accident.
  for (const run of text.matchAll(/\d+(?:[ -]\d+)*/g)) {
    const groups = run[0].split(/[ -]/);
    for (let i = 0; i < groups.length; i++) {
      let digits = "";
      for (let j = i; j < groups.length; j++) {
        digits += groups[j];
        if (digits.length > 19) break;
        if (digits.length >= 13 && luhn(digits)) return true;
      }
    }
  }
  return false;
}
/**
 * #248 Task 4 (spec §5, the D416 pattern generalized) — a builder save must
 * never reclassify a portal-generated quote away from its portal source:
 * once a quote is `portal-catalog` or `portal-service`, every later save (the
 * Estimator, the flame-test builder, the inspection builder) keeps that
 * source, so the Portal panel, the customer's portal listing and this
 * quote's acceptance/refresh rules never silently drop. Any other prior
 * source (or no prior quote at all — a fresh create) takes the builder's own
 * fallback stamp. Pure.
 */
export function sourceForSave(prior: string | null | undefined, builderSource: string): string {
  return prior === "portal-catalog" || prior === "portal-service" ? prior : builderSource;
}

/**
 * #248 final review (controller decision 1) — a portal-service quote the
 * customer has already accepted must approve at the ACCEPTED price, never a
 * re-price. The flame/inspection builders' ordinary Approve re-runs
 * `persist()` (today's rates, today's tier) before marking Won; for an
 * accepted portal-service quote that would silently change the number the
 * customer agreed to (e.g. a mileage-rate edit between accept and approve).
 * True only for a `portal-service` quote that is still `sent` (not already
 * won/lost — an already-won replay goes through setStatus's own no-op
 * repair path, never this one) with a recorded acceptance; every other
 * quote — staff-built, a portal-service quote nobody has sent yet, one a
 * customer hasn't accepted — approves through the ordinary
 * persist()-then-won path, unchanged. Pure.
 */
export function approveKeepsAcceptedPrice(q: {
  source?: string | null;
  status: string;
  portalAcceptance?: unknown;
}): boolean {
  return q.source === "portal-service" && q.status === "sent" && !!q.portalAcceptance;
}

export const PURCHASE_METHODS = ["po", "card", "check", "other"] as const;
export const PURCHASE_METHOD_LABEL: Record<(typeof PURCHASE_METHODS)[number], string> = { po: "Purchase order", card: "Credit card", check: "Check", other: "Other" };

/**
 * Estimator save (#245 Task 13, controller decision 6): `por` is cleared on
 * any item staff have now priced (`price > 0`) — a POR line staff left at 0
 * stays flagged. Returns whether any `por` item remains, so the caller can
 * clear the quote's `portalReview` stamp exactly when there is nothing left
 * to review. Pure; sections/items not carrying `por` at all pass through
 * unchanged (object-identical), so a non-portal quote's save is untouched.
 */
export function clearPricedPor(sections: readonly SpecSection[]): { sections: SpecSection[]; anyPor: boolean } {
  let anyPor = false;
  const next = sections.map((s) => {
    let changed = false;
    const items = s.items.map((it) => {
      if (!it.por) return it;
      if (it.price > 0) {
        changed = true;
        const { por, ...rest } = it;
        void por;
        return rest as SpecItem;
      }
      anyPor = true;
      return it;
    });
    return changed ? { ...s, items } : s;
  });
  return { sections: next, anyPor };
}
