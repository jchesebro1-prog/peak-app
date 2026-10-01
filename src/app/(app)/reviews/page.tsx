import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getAll as getQuotes, timeAgo, type QuoteReview } from "@/lib/stores/quotes";
import { getAllDesigns } from "@/lib/stores/designs";
import { allEngagements } from "@/lib/stores/engagements";
import { allUsers } from "@/lib/users";
import { can, deriveInitials, fallbackColor, firstName } from "@/lib/team";
import ReviewList, { type ReviewItem } from "./review-list";
import { designBudgetLabel } from "@/lib/design/scope-targets";
import { designOpenHref } from "@/lib/design/design-links";
import { quoteBuilderHref } from "@/lib/quote-links";
import { lapsedApprovalLine, reviewHistoryApprovedLine } from "@/lib/review-line";
import { approvalHolds, quoteOwnerName, reviewLimitChip } from "@/lib/review-limits";
import { sameName } from "@/lib/quote-approval-rules";
import { loadReviewLimitContext } from "@/lib/review-limits-server";
import type { ReviewKind } from "./actions";
import { displayQuoteNumber } from "@/lib/estimate-number";

export const metadata = { title: "Reviews — Quartzite-6" };

/** Prototype money(): $48.0k / $313k / $860. */
function shortMoney(n: number): string {
  return n >= 1000
    ? "$" + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k"
    : "$" + Math.round(n);
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const EMPTY_MAP: Record<string, [string, string]> = {
  queue: ["Your review queue is clear", "Nothing is waiting on your approval right now."],
  unclaimed: ["No unclaimed reviews", "Everything submitted has a reviewer assigned."],
  mine: ["Nothing submitted yet", "Items you send for review will show here with their status."],
};

const CSS = `
  .rv-rowscroll::-webkit-scrollbar { display: none; }
  .rv-rowscroll { -ms-overflow-style: none; scrollbar-width: none; }
  .rv-open:hover { border-color: #c4c9d2 !important; }
  .rv-approve:hover { filter: brightness(1.06); }
  .rv-ta:focus { border-color: #c4c9d2 !important; }
  @media (max-width: 860px) {
    .rv-pad { padding-left: 16px !important; padding-right: 16px !important; }
    .rv-item { flex-direction: column !important; align-items: stretch !important; }
    .rv-actions { justify-content: flex-start !important; }
  }
`;

type RawItem = {
  kind: ReviewKind;
  id: string;
  /** #223 — what the list shows (a quote's number; a design's id). */
  displayId: string;
  name: string;
  owner: string;
  value: number;
  /** Pre-formatted value (#211: a design's "Incomplete"); else shortMoney(value). */
  valueLabel?: string;
  review: QuoteReview;
  ts: number;
  openHref: string;
  /** #242 / #284 — set when a quote's approval no longer holds (approvalHolds,
   *  any method): the banner line the quote panel shows; the item reads as
   *  needing review. */
  staleLine?: string;
  /** #284: a quote's updatedAt — Approve / Request changes decide this version only. */
  asOf?: number;
};

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp, quotes, designs, users, engagements, limitCtx] = await Promise.all([
    requireUser(),
    searchParams,
    getQuotes(),
    getAllDesigns(),
    allUsers(),
    allEngagements(),
    loadReviewLimitContext(),
  ]);
  const me = user.name;
  const canApprove = can("approve", user.roles);

  const identity = new Map(users.map((u) => [u.name, { color: u.color, initials: u.initials }]));
  const colorOf = (n: string) => identity.get(n)?.color || fallbackColor(n || "");
  const initialsOf = (n: string) => identity.get(n)?.initials || deriveInitials(n || "");

  /* ---- unify quotes + designs into review items ---- */
  const NONE: QuoteReview = {
    state: "none",
    reviewer: null,
    submittedBy: null,
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    note: "",
  };
  // #242 / #284: an approval that no longer holds (the same approvalHolds rule
  // as the gate and the quote panel) reads as needing review — a stale auto
  // approval never "Auto-approved — within …", a stale in-app / attested /
  // self one never "Approved by …".
  const staleLineOf = (q: (typeof quotes)[number]): string | undefined => {
    if (q.review?.state !== "approved" || approvalHolds(q, limitCtx)) return undefined;
    return lapsedApprovalLine(q.review, false, reviewLimitChip(q, limitCtx, me)?.text || "needs review");
  };
  const all: RawItem[] = [
    ...quotes.map((q) => ({
      kind: "Quote" as const,
      id: q.id,
      displayId: displayQuoteNumber(q),
      name: q.name,
      // #284: one owner identity (owner, else preparedBy) — the same as the next-step ops.
      owner: quoteOwnerName(q),
      value: q.value || 0,
      review: q.review || NONE,
      ts: q.updatedAt || 0,
      openHref: quoteBuilderHref(q),
      staleLine: staleLineOf(q),
      asOf: q.updatedAt || 0,
    })),
    ...designs.map((d) => ({
      kind: "Design" as const,
      id: d.id,
      displayId: d.id,
      name: d.name,
      owner: d.owner,
      value: d.budget || 0,
      // #211 final review I1/I2: the shared incomplete label, and a Grid
      // design opens in The Grid rather than as a Quick record.
      valueLabel: designBudgetLabel(d, shortMoney),
      review: (d.review as QuoteReview) || NONE,
      ts: d.updatedAt || 0,
      openHref: designOpenHref(d),
    })),
    /* Consulting phase reviews (D90) — each phase carries its own
     * QuoteReview; the composite id "<engId>:<phaseId>" routes the
     * approver actions back to the right phase. */
    ...engagements.flatMap((e) =>
      e.phases
        .filter((ph) => ph.review.state !== "none")
        .map((ph) => ({
          kind: "Engagement" as const,
          id: e.id + ":" + ph.id,
          displayId: e.id + ":" + ph.id,
          name: e.name + " — " + ph.name,
          owner: e.people.find((p) => p.role === "Engagement Lead")?.person || "",
          value: 0,
          review: ph.review,
          ts: e.updatedAt || 0,
          openHref: "/design/engagements/" + encodeURIComponent(e.id) + "?tab=phases",
        }))
    ),
  ];

  const inReview = all.filter((x) => x.review.state === "in_review");
  // #284: any approver can decide an in-review quote, so an unassigned quote is in every
  // approver's queue (their own excepted — they can't approve their own). Designs and
  // engagement phases keep the claim model: only the ones assigned to you.
  const myQueue = inReview.filter((x) =>
    x.kind === "Quote" ? x.review.reviewer === me || (!x.review.reviewer && !sameName(x.owner, me)) : x.review.reviewer === me
  );
  const unclaimed = inReview.filter((x) => !x.review.reviewer);
  const mySubs = all.filter(
    (x) => x.review.submittedBy === me && x.review.state !== "none"
  );

  const tabsDef: Array<{ key: string; label: string; count: number }> = [];
  if (canApprove) {
    tabsDef.push({ key: "queue", label: "My queue", count: myQueue.length });
    tabsDef.push({ key: "unclaimed", label: "Unclaimed", count: unclaimed.length });
  }
  tabsDef.push({ key: "mine", label: "Submitted by me", count: mySubs.length });

  let tab = one(sp.tab) || (canApprove ? "queue" : "mine");
  if (!canApprove) tab = "mine";
  if (!tabsDef.some((t) => t.key === tab)) tab = tabsDef[0].key;

  const source = (tab === "queue" ? myQueue : tab === "unclaimed" ? unclaimed : mySubs)
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const items: ReviewItem[] = source.map((x) => {
    const r = x.review;
    let metaLine: string;
    if (tab === "mine") {
      if (x.staleLine) metaLine = x.staleLine + " · " + timeAgo(r.decidedAt);
      else if (r.state === "approved") metaLine = reviewHistoryApprovedLine(r) + " · " + timeAgo(r.decidedAt);
      else if (r.state === "changes")
        metaLine =
          "Changes requested by " + firstName(r.decidedBy || "") + " · " + timeAgo(r.decidedAt);
      else
        metaLine =
          (r.reviewer ? "With " + firstName(r.reviewer) : "In shared queue") +
          " · sent " +
          timeAgo(r.submittedAt);
    } else {
      metaLine =
        "Submitted by " +
        firstName(r.submittedBy || "") +
        " · " +
        timeAgo(r.submittedAt) +
        (r.reviewer ? "" : " · unclaimed");
    }
    const isMine = sameName(x.owner, me);
    return {
      kind: x.kind,
      id: x.id,
      displayId: x.displayId,
      name: x.name,
      owner: x.owner,
      ownerFirst: firstName(x.owner),
      ownerColor: colorOf(x.owner),
      ownerInitials: initialsOf(x.owner),
      state: x.staleLine ? "none" : r.state,
      metaLine,
      value: x.valueLabel ?? shortMoney(x.value),
      note: r.note && r.state === "changes" ? r.note : "",
      openHref: x.openHref,
      canDecide: canApprove && tab !== "mine" && r.state === "in_review" && !isMine,
      // #284: quotes have no Claim — any approver decides them; Designs and Engagements keep it.
      canClaim: canApprove && tab === "unclaimed" && !r.reviewer && !isMine && x.kind !== "Quote",
      asOf: x.asOf ?? 0,
    };
  });

  const inboxCount = myQueue.length;
  const standfirst = canApprove
    ? inboxCount > 0
      ? inboxCount + " item" + (inboxCount === 1 ? "" : "s") + " waiting on your approval"
      : "You’re all caught up on reviews."
    : "Track the status of work you’ve submitted for review.";
  const [emptyTitle, emptySub] = EMPTY_MAP[tab] || EMPTY_MAP.mine;

  return (
    <div
      className="rv-pad"
      style={{ maxWidth: 980, margin: "0 auto", padding: "26px 30px 64px" }}
    >
      <style>{CSS}</style>

      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Reviews</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, marginBottom: 20 }}>
        {standfirst}
      </div>

      {/* tabs */}
      <div
        className="rv-rowscroll"
        style={{
          display: "flex",
          gap: 4,
          background: "#eceef1",
          borderRadius: 10,
          padding: 3,
          marginBottom: 18,
          overflowX: "auto",
        }}
      >
        {tabsDef.map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={"/reviews?tab=" + t.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                padding: "8px 14px",
                borderRadius: 8,
                textDecoration: "none",
                ...(active
                  ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                  : { background: "transparent", color: "#787d87" }),
              }}
            >
              {t.label}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "#fff",
                  background:
                    t.count > 0 ? (active ? "var(--accent)" : "#aab0bb") : "transparent",
                  padding: t.count > 0 ? "1px 6px" : 0,
                  borderRadius: 20,
                  minWidth: t.count > 0 ? "auto" : 0,
                }}
              >
                {t.count}
              </span>
            </Link>
          );
        })}
      </div>

      <ReviewList items={items} emptyTitle={emptyTitle} emptySub={emptySub} />
    </div>
  );
}
