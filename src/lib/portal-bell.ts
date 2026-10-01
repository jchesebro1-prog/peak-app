// #245 (spec §8.2) — the staff bell derives portal review/approval notices
// from records already on every request; there is no writer, no Leads-queue
// record and no to-do row for these two groups. Pure: `now` and `me` are
// parameters so the harness can test every boundary without a clock or a DB.
import type { Quote } from "@/lib/stores/quotes";
import type { BellItem } from "@/components/nav/nav-data";
import { portalQueueHref } from "@/lib/portal-quote-queue";
import { isCustomerBuiltQuote } from "@/lib/portal-quote-names";

/** "New portal quotes" only surfaces a firm generation from the last 3 days. */
const GENERATED_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Unassigned (owner === "") is a company-wide bell item, per Nav's other
 *  groups; owned by someone else never shows on my bell. */
function mineOrUnassigned(owner: string, me: string): boolean {
  return owner === me || owner === "";
}

/**
 * Two derived groups (spec §8.2, supersedes §4.2/§4.3's bell/queue text):
 * - `review` — a portal-catalog quote still stamped `portalReview` (any
 *   price-on-request line), waiting on Peak to send it. Portal-service
 *   quotes never carry `portalReview` (service pricing is never
 *   price-on-request, #248 spec §3), so this group stays portal-catalog only.
 * - `generated` — a firm quote (`portalFirm`) sent within the last 72h, so
 *   the team notices new customer-generated business quickly without it
 *   lingering once stale. #248 Task 4: widened to portal-service (flame/
 *   inspection quotes generated from the customer's own service intake) —
 *   both portal sources land here.
 * Both are mine-or-unassigned only, matching every other bell group.
 * - `accepted` (#288) — "Portal acceptances to confirm": every sent quote a
 *   customer accepted in the portal, any owner (unchanged from nav-counts).
 * #288 (spec §1.7): every item links the staff Portal quotes queue,
 * `/quotes/portal?focus=<id>`, not the builder or the hub — except a
 * Peak-sent estimate the customer accepted: the queue lists customer-built
 * quotes only, so that one keeps its Quotes-hub link.
 */
export function portalBellGroups(
  quotes: Quote[],
  me: string,
  now: number
): { review: BellItem[]; generated: BellItem[]; accepted: BellItem[] } {
  const review = quotes.filter(
    (q) => q.source === "portal-catalog" && !!q.portalReview && mineOrUnassigned(q.owner, me)
  );
  const generated = quotes.filter(
    (q) =>
      (q.source === "portal-catalog" || q.source === "portal-service") &&
      !!q.portalFirm &&
      q.status === "sent" &&
      mineOrUnassigned(q.owner, me) &&
      now - q.portalFirm.generatedAt <= GENERATED_WINDOW_MS
  );

  return {
    review: review.map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · waiting on a Peak price${q.owner ? "" : " · unassigned"}`,
      href: portalQueueHref(q.id),
      letter: "Q",
      color: "var(--accent)",
    })),
    generated: generated.map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · customer-generated${q.owner ? "" : " · unassigned"}`,
      href: portalQueueHref(q.id),
      letter: "Q",
      color: "#1f7a52",
    })),
    accepted: quotes
      .filter((q) => q.portalAcceptance && q.status === "sent")
      .map((q) => ({
        id: q.id,
        title: q.name,
        sub: `${q.customer || ""} — approve or decline in the quote`,
        href: isCustomerBuiltQuote(q) ? portalQueueHref(q.id) : "/quotes?id=" + encodeURIComponent(q.id),
        letter: "✓",
        color: "#1f7a52",
      })),
  };
}
