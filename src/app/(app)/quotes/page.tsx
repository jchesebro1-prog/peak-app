import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  listQuoteRows,
  getMany as getQuotesMany,
  timeAgo,
  STAGES,
  STAGE_LABEL,
  type Quote,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { loadPipelines } from "@/lib/pipelines-server";
import { quoteStagePillLabel } from "@/lib/pipelines";
import { getEngagementForQuoteRef, ENGAGEMENT_STATUS_LABEL } from "@/lib/stores/engagements";
import { allUsers } from "@/lib/users";
import { can, deriveInitials, fallbackColor, firstName } from "@/lib/team";
import { money } from "@/lib/format";
import { StatusPill, QUOTE_STATUS_TONE } from "@/components/ui";
import { NewQuoteMenu, OwnerSelect, QuoteRevisions } from "./controls";
import { setQuoteStatus, createQuoteClientPackageAction } from "./actions";
import { DeleteQuoteButton } from "./delete-quote-button";
import { quoteBuilderHref } from "@/lib/quote-links";
import PopLink from "@/components/popout/pop-link";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import { approvalHolds, reviewLimitChip } from "@/lib/review-limits";
import { shownReviewState } from "@/lib/review-line";
import { loadReviewLimitContext } from "@/lib/review-limits-server";
import { ReviewLimitChip } from "@/components/review-limit-chip";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { opensChip } from "@/lib/quote-share/package-view";
import { listForRecords } from "@/lib/stores/parties";
import { companiesByNames, getCompanies } from "@/lib/identity/companies";
import { bidDueText } from "@/lib/parties/bids";
import { HUB_TYPE_KEYS, quotesHubView } from "@/lib/quotes-hub-view";
import { paginate, parsePageParam, resolvePage, withPage } from "@/lib/list-paging";
import { ListPager } from "@/components/list-pager";
import type { BidderState } from "@/lib/parties/rules";

export const metadata = { title: "Quotes — Quartzite-6" };
/** #222 fix wave 1: recalling a revision renders the quote's saved PDF in `after()`, inside this budget. */
export const maxDuration = 120;

/* ---- prototype token maps (Quotes.dc.html statusMeta / rMeta, Estimator rbMeta) ---- */

const REVIEW_CHIP: Record<string, { label: string; ink: string; soft: string; bd: string }> = {
  in_review: { label: "In review", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  approved: { label: "Approved", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  changes: { label: "Changes", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
};

// The Status track was 96px — a user-editable stage label (Settings →
// Pipelines) can run to "Presentation/Delivery" (~160px) and overlap the
// Value column since StatusPill had no width cap. Widened to 132px and
// StatusPill now caps + ellipsizes instead of overflowing.
const GRID = "30px minmax(0,1fr) 200px 120px 132px 92px";

/** Service quote-type badges (system quotes stay unbadged). */
const TYPE_BADGE: Record<
  string,
  { label: string; ink: string; soft: string; bd: string }
> = {
  flame_test: { label: "Flame test", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
  repair: { label: "Repair", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  inspection: { label: "Inspection", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  consulting: { label: "Consulting", ink: "#6b4fa1", soft: "#f0ebf9", bd: "#ddd2f0" },
  rental: { label: "Rental", ink: "#2f7a52", soft: "#e6f4ec", bd: "#cde7d8" },
};

/** Each service quote type edits in its own builder; system quotes in the Estimator. */
function editHrefFor(q: Quote): { href: string; label: string } {
  const href = quoteBuilderHref(q);
  const label =
    q.quoteType === "flame_test" ? "Open flame test quote →"
    : q.quoteType === "repair" ? "Open repair quote →"
    : q.quoteType === "inspection" ? "Open inspection quote →"
    : q.quoteType === "consulting" ? "Open consulting quote →"
    : q.quoteType === "rental" ? "Open rental quote →"
    : "Open in Estimator →";
  return { href, label };
}

/** Prototype shortMoney: $48.0k / $313k / $860. */
function shortMoney(n: number): string {
  return n >= 1000
    ? "$" + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k"
    : "$" + Math.round(n);
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const SEG_BASE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  borderRadius: 7,
  padding: "8px 14px",
  textDecoration: "none",
};

const CSS = `
  .qt-rowscroll::-webkit-scrollbar { display: none; }
  .qt-rowscroll { -ms-overflow-style: none; scrollbar-width: none; }
  select.qt-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 11px center; }
  .qt-newbtn:hover { filter: brightness(1.06); }
  .qt-menuitem:hover { background: #f6f7f9; }
  .qt-rowlink:hover { background: #fafbff; }
  @media (max-width: 860px) {
    .qt-pad { padding-left: 16px !important; padding-right: 16px !important; }
    .qt-head { flex-direction: column !important; align-items: stretch !important; }
    .qt-stats { grid-template-columns: repeat(2, 1fr) !important; }
    .qt-controls { flex-direction: column !important; align-items: stretch !important; }
    .qt-row { grid-template-columns: 26px minmax(0,1fr) auto !important; }
    .qt-cust, .qt-edited { display: none !important; }
  }
`;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Jeff 2026-10-15 #11 — every filter, count and stat runs over a slim SQL projection of ALL quotes
  // (`listQuoteRows`: no spec / revisions / history); only the 50 rows of the page are read in full.
  const [user, sp, quotes, users, pipes, limitCtx] = await Promise.all([
    requireUser(),
    searchParams,
    listQuoteRows(),
    allUsers(),
    loadPipelines(),
    loadReviewLimitContext(),
  ]);
  const me = user.name;

  /* ---- #348 bids: one batched party read + one batched company-name read for the whole hub (no per-row reads).
     A bidder is a gc/ec party row carrying bid state; a quote is a bid iff it has at least one. ---- */
  const partiesByQuote = await listForRecords("quote", quotes.map((q) => q.id));
  const biddersByQuote = new Map<string, Array<{ companyId: string; bid: BidderState }>>();
  for (const [qid, list] of partiesByQuote) {
    const b = list.filter((p) => p.bid && (p.role === "gc" || p.role === "ec"));
    if (b.length) biddersByQuote.set(qid, b.map((p) => ({ companyId: p.companyId, bid: p.bid! })));
  }
  const bidderCompanyIds = [...new Set([...biddersByQuote.values()].flatMap((l) => l.map((b) => b.companyId)))];
  const bidderCompanies = await getCompanies(bidderCompanyIds);
  const bidderNames = (qid: string): string[] =>
    (biddersByQuote.get(qid) ?? []).map((b) => bidderCompanies.get(b.companyId)?.name || "").filter(Boolean);

  /* ---- identity lookups (port of Team.person) ---- */
  const identity = new Map(users.map((u) => [u.name, { color: u.color, initials: u.initials }]));
  const colorOf = (n: string) => identity.get(n)?.color || fallbackColor(n || "");
  const initialsOf = (n: string) => identity.get(n)?.initials || deriveInitials(n || "");

  /* ---- URL state: ownership scope, status filter, selected row ---- */
  const whoRaw = one(sp.who);
  const scope =
    !whoRaw || whoRaw === "all"
      ? "all"
      : whoRaw === "mine" || whoRaw === me
        ? "mine"
        : whoRaw;
  const statusParam = one(sp.status);
  const filter =
    (STAGES as readonly string[]).includes(statusParam) ? (statusParam as QuoteStatus) : "all";
  const TYPE_KEYS = HUB_TYPE_KEYS;
  const typeParam = one(sp.type);
  const typeFilter = (TYPE_KEYS as readonly string[]).includes(typeParam) ? typeParam : "all";
  const bidFilter = one(sp.bid) === "open";
  const selectedId = one(sp.id);
  // #223 — search by estimate number (FLM-1002, 1002), old id, name, customer.
  const searchTerm = one(sp.q).trim();
  // Punch #60: setQuoteStatus (quotes/actions.ts) redirects back here with
  // this param when the store's approval gate refuses a status change (e.g.
  // an unapproved quote pushed straight to Won from these plain buttons) —
  // surfaced on the selected row instead of a raw thrown-exception 500.
  const statusError = one(sp.statusError) || null;
  const packageError = one(sp.packageError) || null;
  // #282 phase 3: a Recall that reduced or removed the revision's Rewards credit.
  const creditNotice = one(sp.creditNotice) || null;
  // #35 one-click both ways: the engagement referencing the selected quote
  // (as its source proposal OR as Peak's install bid). Selected row only.
  const selEng = selectedId ? await getEngagementForQuoteRef(selectedId) : null;

  const hrefFor = (over: {
    who?: string;
    status?: string;
    type?: string;
    id?: string | null;
    q?: string;
    bid?: string;
    /** Keep this page (row select / deselect); filter links leave it out and land on page 1. */
    page?: number;
  }) => {
    const qs = new URLSearchParams();
    const w = over.who ?? (scope === "all" ? "all" : scope);
    const st = over.status ?? filter;
    const ty = over.type ?? typeFilter;
    if (w && w !== "all") qs.set("who", w);
    if (st && st !== "all") qs.set("status", st);
    if (ty && ty !== "all") qs.set("type", ty);
    if ((over.bid ?? (bidFilter ? "open" : "")) === "open") qs.set("bid", "open");
    const term = over.q ?? searchTerm;
    if (term) qs.set("q", term);
    if (over.id) qs.set("id", over.id);
    return withPage("/quotes", qs, over.page ?? 1);
  };

  /* ---- ownership scope, #223 search, type chips (IDEAS #22), #348 Out to bid and the status pipeline —
     all over the FULL set (src/lib/quotes-hub-view.ts), before the page is cut ---- */
  const view = quotesHubView(
    quotes,
    { scope, me, status: filter, type: typeFilter, bid: bidFilter, q: searchTerm },
    (id) => biddersByQuote.get(id) ?? [],
    bidderNames
  );
  const scoped = view.scoped;
  const typeCounts = view.typeCounts;
  const outToBidCount = view.outToBidCount;

  const roster = users.filter((u) => u.status === "active");
  const ownerOptions = [
    { value: "all", label: "All teammates", href: hrefFor({ who: "all" }) },
  ].concat(
    roster.map((p) => ({
      value: p.name === me ? "mine" : p.name,
      label: p.name === me ? p.name + " (me)" : p.name,
      href: hrefFor({ who: p.name === me ? "mine" : p.name }),
    }))
  );
  const ownerSelectValue = scope === "all" ? "all" : scope === "mine" ? "mine" : scope;

  /* ---- status pipeline filter (over the scoped set) ---- */
  const counts = view.statusCounts;
  const filterDefs: Array<[string, string]> = [
    ["all", "All"],
    ["draft", STAGE_LABEL.draft],
    ["sent", STAGE_LABEL.sent],
    ["won", STAGE_LABEL.won],
    ["lost", STAGE_LABEL.lost],
  ];

  const filtered = view.filtered;
  /* ---- Jeff 2026-10-15 #11: 50 a page. A `?id=` link (bell, search, a record's quote link) opens on its row's page. ---- */
  const paged = paginate(filtered, resolvePage(parsePageParam(one(sp.page)), selectedId ? filtered.findIndex((x) => x.id === selectedId) : -1));
  const fullById = await getQuotesMany(paged.rows.map((r) => r.id));
  const pageQuotes = paged.rows.map((r) => fullById.get(r.id)).filter((x): x is Quote => !!x);
  /* ---- customer labels for the page only: the linked company's current name, else the company with that name ---- */
  const [custById, custByName] = await Promise.all([
    getCompanies([...new Set(pageQuotes.map((q) => q.customerId).filter((x): x is string => !!x))]),
    companiesByNames(pageQuotes.filter((q) => !q.customerId).map((q) => q.customer || "")),
  ]);
  const customerLabel = (q: Quote) => {
    const co = q.customerId ? custById.get(q.customerId) : custByName.get((q.customer || "").toLowerCase());
    return co?.name || q.customer || "—";
  };
  const pageParams = new URLSearchParams(hrefFor({}).split("?")[1] || "");
  // #284 — only one row is expanded, so the next-step view is computed for that row alone.
  const selectedQuote = selectedId ? pageQuotes.find((x) => x.id === selectedId) : undefined;
  const selectedNext = selectedQuote ? await quoteNextStepFor(selectedQuote, user) : null;

  /* ---- stat tiles (over the scoped set) ---- */
  const open = scoped.filter((q) => q.status === "draft" || q.status === "sent");
  const openValue = open.reduce((a, q) => a + (q.value || 0), 0);
  const won = scoped.filter((q) => q.status === "won");
  const lost = scoped.filter((q) => q.status === "lost");
  const decided = won.length + lost.length;
  const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : 0;
  const wonValue = won.reduce((a, q) => a + (q.value || 0), 0);
  const stats = [
    { label: "Open pipeline", value: shortMoney(openValue), sub: open.length + " active quotes" },
    { label: "Win rate", value: winRate + "%", sub: won.length + " won · " + lost.length + " lost" },
    { label: "Won value", value: shortMoney(wonValue), sub: "closed this view" },
    { label: "Total quotes", value: String(scoped.length), sub: "in this view" },
  ];

  const scopeLabel =
    scope === "mine" ? "your" : scope === "all" ? "the team’s" : firstName(scope) + "’s";
  const standfirst =
    scoped.length + " quotes · " + money(openValue) + " open in " + scopeLabel + " pipeline";
  const emptyMsg = searchTerm
    ? `No quotes match “${searchTerm}”.`
    : scope === "mine"
      ? "You have no quotes in this stage."
      : "No quotes in this stage.";

  return (
    <div className="pk-content qt-pad">
      <style>{CSS}</style>

      {/* heading */}
      <div
        className="qt-head"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 14,
          marginBottom: 18,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Quotes</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
        <NewQuoteMenu />
      </div>

      {/* stat tiles */}
      <div
        className="qt-stats"
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 12,
              padding: "16px 17px",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-.01em",
                marginTop: 10,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 7 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ownership + status controls */}
      <div
        className="qt-controls"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          rowGap: 11,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3 }}>
            <Link
              href={hrefFor({ who: "mine" })}
              style={{
                ...SEG_BASE,
                ...(scope === "mine"
                  ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                  : { color: "#787d87", background: "transparent" }),
              }}
            >
              My work
            </Link>
            <Link
              href={hrefFor({ who: "all" })}
              style={{
                ...SEG_BASE,
                ...(scope === "all"
                  ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                  : { color: "#787d87", background: "transparent" }),
              }}
            >
              Everyone
            </Link>
          </div>
          <OwnerSelect value={ownerSelectValue} options={ownerOptions} />
          <form method="get" action="/quotes" style={{ display: "flex" }}>
            {scope !== "all" && <input type="hidden" name="who" value={scope} />}
            {filter !== "all" && <input type="hidden" name="status" value={filter} />}
            {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
            {bidFilter && <input type="hidden" name="bid" value="open" />}
            <input
              type="search"
              name="q"
              defaultValue={searchTerm}
              placeholder="Search FLM-1002, Q-2041, name…"
              aria-label="Search quotes by number, old id, name or customer"
              className="pk-input"
              style={{ fontSize: 12.5, padding: "6px 10px", minWidth: 0, width: 220, maxWidth: "100%" }}
            />
          </form>
        </div>
        <div
          className="qt-rowscroll"
          style={{
            display: "flex",
            background: "#f1f2f5",
            borderRadius: 8,
            padding: 2,
            maxWidth: "100%",
            overflowX: "auto",
          }}
        >
          {filterDefs.map(([key, label]) => {
            const active = filter === key;
            return (
              <Link
                key={key}
                href={hrefFor({ status: key })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  padding: "7px 12px",
                  borderRadius: 7,
                  textDecoration: "none",
                  ...(active
                    ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                    : { background: "transparent", color: "#787d87" }),
                }}
              >
                {label}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: active ? "var(--accent)" : "#aab0bb",
                  }}
                >
                  {counts[key]}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* quote-type rail (IDEAS #22 — one hub with a type filter) */}
      <div
        className="qt-rowscroll"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        {(
          [
            ["all", "All types", null],
            ["system", "System", null],
            ["flame_test", "Flame test", TYPE_BADGE.flame_test],
            ["repair", "Repair", TYPE_BADGE.repair],
            ["inspection", "Inspection", TYPE_BADGE.inspection],
            ["consulting", "Consulting", TYPE_BADGE.consulting],
            ["rental", "Rental", TYPE_BADGE.rental],
          ] as Array<[string, string, { ink: string } | null]>
        ).map(([key, label, badge]) => {
          const active = typeFilter === key;
          return (
            <Link
              key={key}
              href={hrefFor({ type: key })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                padding: "6px 12px",
                borderRadius: 20,
                textDecoration: "none",
                border: active ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                background: active ? "var(--accent)" : "#fff",
                color: active ? "#fff" : "#5b616e",
              }}
            >
              {badge && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: active ? "#fff" : badge.ink,
                    opacity: active ? 0.85 : 1,
                  }}
                />
              )}
              {label}{" "}
              <span style={{ fontFamily: "var(--font-mono)", opacity: 0.65 }}>
                {typeCounts[key]}
              </span>
            </Link>
          );
        })}
        <Link
          href={hrefFor({ bid: bidFilter ? "" : "open" })}
          data-testid="quote-bid-filter"
          title={bidFilter ? "Showing estimates still out to bid — click to show all" : "Estimates with a bidder still pending"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            padding: "6px 12px",
            borderRadius: 20,
            textDecoration: "none",
            border: bidFilter ? "1px solid var(--accent)" : "1px solid #e4e7ec",
            background: bidFilter ? "var(--accent)" : "#fff",
            color: bidFilter ? "#fff" : "#5b616e",
          }}
        >
          Out to bid{" "}
          <span style={{ fontFamily: "var(--font-mono)", opacity: 0.65 }}>{outToBidCount}</span>
        </Link>
      </div>

      {/* quotes table */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
        }}
      >
        <div
          className="qt-row"
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            padding: "11px 18px",
            fontSize: 10,
            fontWeight: 600,
            color: "#aab0bb",
            textTransform: "uppercase",
            letterSpacing: ".05em",
            borderBottom: "1px solid #f0f1f4",
            background: "#fbfbfc",
          }}
        >
          <span />
          <span>Quote</span>
          <span className="qt-cust">Customer</span>
          <span style={{ textAlign: "right" }}>Value</span>
          <span style={{ textAlign: "center" }}>Status</span>
          <span className="qt-edited" style={{ textAlign: "right" }}>
            Edited
          </span>
        </div>

        {pageQuotes.map((q) => {
          const nextStep = q.id === selectedId ? selectedNext : null;
          const reviewLimit = reviewLimitChip(q, limitCtx, me);
          // #301 slice B: the client opened the package link (any sent revision).
          const opened = opensChip(q);
          // #242 / #284: an approval that no longer holds (stale auto limit or a
          // changed price/line set) is not an approval — never the green badge.
          const rState = shownReviewState(q.review?.state, approvalHolds(q, limitCtx));
          const rMeta = REVIEW_CHIP[rState];
          const selected = q.id === selectedId;
          const owner = q.owner || "Unassigned";
          // #287 task B: Prepared by joins the sub-line only when it isn't the lead estimator.
          const preparedBy = (q.preparedBy || "").trim();
          const preparedNote =
            preparedBy && preparedBy.toLowerCase() !== (q.owner || "").trim().toLowerCase()
              ? ` · prepared by ${firstName(preparedBy)}`
              : "";
          return (
            <div key={q.id}>
              <PopLink
                href={hrefFor({ id: selected ? null : q.id, page: paged.page })}
                popKind="estimate"
                popId={q.id}
                popUrl={quoteBuilderHref(q)}
                scroll={false}
                className="qt-row qt-rowlink"
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 12,
                  padding: "13px 18px",
                  alignItems: "center",
                  borderBottom: "1px solid #f5f6f8",
                  textDecoration: "none",
                  color: "#16181d",
                  background: selected ? "#fafbff" : undefined,
                }}
              >
                <span
                  title={owner}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: colorOf(q.owner),
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10.5,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {initialsOf(q.owner)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {q.name}
                    </span>
                    {TYPE_BADGE[q.quoteType || ""] && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: TYPE_BADGE[q.quoteType || ""].ink,
                          background: TYPE_BADGE[q.quoteType || ""].soft,
                          border: `1px solid ${TYPE_BADGE[q.quoteType || ""].bd}`,
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {TYPE_BADGE[q.quoteType || ""].label}
                      </span>
                    )}
                    {/* #110: a system quote with a user-named category wears it
                        as a neutral badge — the type filter still sees "system". */}
                    {!TYPE_BADGE[q.quoteType || ""] && !!q.category && (
                      <span
                        title="Quote category"
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: "#3a3f4a",
                          background: "#f1f2f5",
                          border: "1px solid #e4e7ec",
                          padding: "2px 6px",
                          borderRadius: 4,
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {q.category}
                      </span>
                    )}
                    {(q.source === "portal-catalog" || q.source === "portal-service") && (
                      <span
                        title={
                          q.source === "portal-service"
                            ? "Generated by the customer's own service quote intake"
                            : "Generated by the customer in the portal catalog"
                        }
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: "#3a3f4a",
                          background: "#f1f2f5",
                          border: "1px solid #e4e7ec",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        Portal
                      </span>
                    )}
                    {(() => {
                      const bidders = biddersByQuote.get(q.id);
                      if (!bidders) return null;
                      const awarded = !!q.bid?.awardedPartyId;
                      const closed = q.status === "won" || q.status === "lost";
                      const label = awarded
                        ? "Awarded"
                        : q.bid?.dueAt && !closed
                          ? `Bid · due ${bidDueText(q.bid.dueAt).split(",")[0]}`
                          : "Bid";
                      return (
                        <span
                          data-testid="quote-bid-chip"
                          title={`${bidders.length} ${bidders.length === 1 ? "bidder" : "bidders"}${
                            q.bid?.dueAt ? ` · due ${bidDueText(q.bid.dueAt)}` : ""
                          }`}
                          style={{
                            flexShrink: 0,
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: ".04em",
                            textTransform: "uppercase",
                            color: awarded ? "#1f7a52" : "#3a3f4a",
                            background: awarded ? "#eaf6ef" : "#f1f2f5",
                            border: awarded ? "1px solid #cce9da" : "1px solid #e4e7ec",
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        >
                          {label}
                        </span>
                      );
                    })()}
                    {q.portalAcceptance && q.status === "sent" && (
                      <span
                        title={
                          "Accepted in the customer portal by " +
                          q.portalAcceptance.by +
                          " — non-binding until you confirm by marking it Won."
                        }
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: "#1f7a52",
                          background: "#eaf6ef",
                          border: "1px solid #cce9da",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        ✓ Customer accepted
                      </span>
                    )}
                    {opened && (
                      <span
                        data-testid="quote-opened-chip"
                        title={opened.title}
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: "#3155a8",
                          background: "#e9eefb",
                          border: "1px solid #d4ddf3",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {opened.label}
                      </span>
                    )}
                    {reviewLimit && <ReviewLimitChip chip={reviewLimit} variant="pill" />}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      color: "#aab0bb",
                      marginTop: 3,
                    }}
                  >
                    {displayQuoteNumber(q)} · {owner}{preparedNote}
                  </div>
                </div>
                <div
                  className="qt-cust"
                  style={{
                    fontSize: 12.5,
                    color: "#5b616e",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {customerLabel(q)}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    fontWeight: 600,
                    textAlign: "right",
                  }}
                >
                  {shortMoney(q.value || 0)}
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, minWidth: 0, maxWidth: "100%" }}
                >
                  <StatusPill
                    tone={QUOTE_STATUS_TONE[q.status] || "gray"}
                    minWidth={64}
                    maxWidth="100%"
                    title={quoteStagePillLabel(pipes, q, STAGE_LABEL[q.status] || STAGE_LABEL.draft)}
                  >
                    {quoteStagePillLabel(pipes, q, STAGE_LABEL[q.status] || STAGE_LABEL.draft)}
                  </StatusPill>
                  {rMeta && (
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: rMeta.ink,
                        background: rMeta.soft,
                        border: `1px solid ${rMeta.bd}`,
                        padding: "1px 7px",
                        borderRadius: 20,
                        marginTop: 4,
                      }}
                    >
                      {rMeta.label}
                    </span>
                  )}
                </div>
                <div
                  className="qt-edited"
                  style={{ fontSize: 11.5, color: "#9aa0ab", textAlign: "right" }}
                >
                  {timeAgo(q.updatedAt)}
                </div>
              </PopLink>

              {selected && (
                <SelectedPanel
                  q={q}
                  engagement={
                    selEng
                      ? { id: selEng.id, stage: ENGAGEMENT_STATUS_LABEL[selEng.status] }
                      : null
                  }
                  backHref={hrefFor({ id: q.id, page: paged.page })}
                  statusError={statusError}
                  packageError={packageError}
                  creditNotice={creditNotice}
                  canCreate={can("create", user.roles)}
                  next={nextStep}
                />
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div
            style={{
              padding: "44px 18px",
              textAlign: "center",
              color: "#9aa0ab",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {emptyMsg}
            <br />
            <Link
              href="/estimator"
              style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
            >
              Start a new quote →
            </Link>
          </div>
        )}
      </div>
      <ListPager
        page={paged.page}
        pageCount={paged.pageCount}
        total={paged.total}
        from={paged.from}
        to={paged.to}
        prevHref={paged.page > 1 ? withPage("/quotes", pageParams, paged.page - 1) : null}
        nextHref={paged.page < paged.pageCount ? withPage("/quotes", pageParams, paged.page + 1) : null}
        noun="quotes"
      />
    </div>
  );
}

/**
 * Expanded actions for the ?id=-selected row — the Estimator's review &
 * approval banner + status control, surfaced on the list (the prototype
 * keeps these on the Estimator screen; the list rows there deep-link into
 * it).
 */
function SelectedPanel({
  q,
  engagement,
  backHref,
  statusError,
  packageError,
  creditNotice,
  canCreate,
  next,
}: {
  q: Quote;
  engagement: { id: string; stage: string } | null;
  /** Current list URL (filters + this row selected) — round-tripped through
   *  setQuoteStatus's hidden "back" field so a gate refusal redirects to
   *  exactly this view instead of a bare "/quotes". */
  backHref: string;
  /** Set when setQuoteStatus's approval gate just refused a change for THIS
   *  row (punch #60). */
  statusError: string | null;
  packageError: string | null;
  /** #282 phase 3: the Recall's Rewards credit notice (reduced / removed). */
  creditNotice: string | null;
  /** #205 — "Spec from this quote" opens a create form; only creators see it. */
  canCreate: boolean;
  /** #284 — the one next-step view (pill, primary action, ⋯ menu) for this quote and viewer. */
  next: QuoteNextStepView | null;
}) {
  const marginPct = Math.round((q.margin || 0) * 100);

  return (
    <div
      style={{
        padding: "12px 18px 16px",
        background: "#fbfbfc",
        borderBottom: "1px solid #f0f1f4",
      }}
    >
      {statusError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            marginBottom: 10,
            background: "#fcefe9",
            border: "1px solid #f0d6cd",
            borderRadius: 10,
            fontSize: 12.5,
            color: "#b4543a",
            fontWeight: 600,
          }}
        >
          <span>{statusError}</span>
          {/* #284 — a gate refusal ("needs an approval on record") offers the next step right here */}
          {next?.primary && statusError.includes("needs an approval on record") && (
            <QuoteNextStep quoteId={q.id} view={{ ...next, secondary: [], pill: { ...next.pill, label: "" } }} variant="panel" />
          )}
        </div>
      )}
      {creditNotice && (
        <div role="status" data-testid="reward-credit-notice" style={{ padding: "10px 14px", marginBottom: 10, background: "#fdf6e7", border: "1px solid #f0e0b8", borderRadius: 10, fontSize: 12.5, color: "#7a5a12", fontWeight: 600 }}>
          {creditNotice}
        </div>
      )}
      {packageError && (
        <div style={{ padding: "10px 14px", marginBottom: 10, background: "#fcefe9", border: "1px solid #f0d6cd", borderRadius: 10, fontSize: 12.5, color: "#b4543a", fontWeight: 600 }}>
          {packageError}
        </div>
      )}
      {/* #223 — the estimate number, and the internal id it replaced */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "#16181d", marginBottom: 8 }}>
        {displayQuoteNumber(q)}
        {displayQuoteNumber(q) !== q.id && (
          <span style={{ fontWeight: 400, fontSize: 10.5, color: "#aab0bb", marginLeft: 8 }}>was {q.id}</span>
        )}
      </div>
      {/* #284 — the same next-step control as the Estimator (pill, primary action, ⋯ menu) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "11px 16px", borderBottom: "1px solid #e4e7ec" }}>
        {next && <QuoteNextStep quoteId={q.id} view={next} variant="panel" />}
        {next?.strip && <span style={{ fontSize: 12.5, color: "#5b616e" }}>{next.strip}</span>}
      </div>

      {/* meta + status + open */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          rowGap: 10,
          flexWrap: "wrap",
          marginTop: 16,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
          {money(q.value || 0)} quoted{marginPct > 0 ? ` · ${marginPct}% margin` : ""}
        </span>
        <form action={createQuoteClientPackageAction}>
          <input type="hidden" name="id" value={q.id} />
          <button type="submit" className="pk-btn-outline">Build client package</button>
        </form>
        {/* punch item 24 — snapshot / recall this quote's pricing */}
        <QuoteRevisions
          id={q.id}
          number={displayQuoteNumber(q)}
          revisions={(q.revisions || []).map((r) => ({
            rev: r.rev,
            at: r.at,
            by: r.by,
            reason: r.reason,
            note: r.note,
            value: r.value,
          }))}
          canRestore={q.status !== "won" && q.status !== "lost"}
          lockedStatus={q.status === "lost" ? "lost" : "won"}
          back={backHref}
        />
        {engagement && (
          <Link
            href={`/design/engagements/${encodeURIComponent(engagement.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".03em",
              color: "#6b4fa1",
              background: "#f0ebf9",
              border: "1px solid #ddd2f0",
              padding: "3px 9px",
              borderRadius: 20,
              textDecoration: "none",
            }}
          >
            Engagement {engagement.id} · {engagement.stage}
          </Link>
        )}
        {canCreate && (!q.quoteType || q.quoteType === "system") && (
          <Link href={`/design/specs/new?quote=${encodeURIComponent(q.id)}`} className="pk-btn-outline">
            Spec from this quote →
          </Link>
        )}
        {(!q.quoteType || q.quoteType === "system") && (
          <Link href={`/estimator/cut-sheets?id=${encodeURIComponent(q.id)}`} className="pk-btn-outline">
            Cut sheets →
          </Link>
        )}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#aab0bb",
              textTransform: "uppercase",
              letterSpacing: ".05em",
            }}
          >
            Status
          </span>
          <form action={setQuoteStatus} style={{ display: "flex", gap: 10 }}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="back" value={backHref} />
            {STAGES.map((s) => {
              const cur = s === q.status;
              return cur ? (
                <span key={s} style={{ display: "inline-flex" }}>
                  <StatusPill tone={QUOTE_STATUS_TONE[s] || "gray"} minWidth={72}>
                    {STAGE_LABEL[s]}
                  </StatusPill>
                </span>
              ) : (
                <button key={s} type="submit" name="status" value={s} className="pk-btn-outline">
                  {STAGE_LABEL[s]}
                </button>
              );
            })}
          </form>
          <PopLink
            href={editHrefFor(q).href}
            popKind="estimate"
            popId={q.id}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              borderRadius: 8,
              padding: "9px 14px",
              textDecoration: "none",
            }}
          >
            {editHrefFor(q).label}
          </PopLink>
          <DeleteQuoteButton id={q.id} won={q.status === "won"} />
        </div>
      </div>
    </div>
  );
}
