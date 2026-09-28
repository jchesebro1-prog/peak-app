// #245 (spec §8.2) — the staff bell derives portal review/approval notices
// from records already on every request; there is no writer, no Leads-queue
// record and no to-do row for these two groups. Pure: `now` and `me` are
// parameters so the harness can test every boundary without a clock or a DB.
import type { Quote } from "@/lib/stores/quotes";
import type { BellItem } from "@/components/nav/nav-data";
import { quoteBuilderHref } from "@/lib/quote-links";

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
 *   price-on-request, #246 spec §3), so this group stays portal-catalog only.
 * - `generated` — a firm quote (`portalFirm`) sent within the last 72h, so
 *   the team notices new customer-generated business quickly without it
 *   lingering once stale. #246 Task 4: widened to portal-service (flame/
 *   inspection quotes generated from the customer's own service intake) —
 *   both portal sources land here.
 * Both are mine-or-unassigned only, matching every other bell group.
 */
export function portalBellGroups(
  quotes: Quote[],
  me: string,
  now: number
): { review: BellItem[]; generated: BellItem[] } {
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
      href: quoteBuilderHref(q),
      letter: "Q",
      color: "var(--accent)",
    })),
    generated: generated.map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · customer-generated${q.owner ? "" : " · unassigned"}`,
      href: quoteBuilderHref(q),
      letter: "Q",
      color: "#1f7a52",
    })),
  };
}
