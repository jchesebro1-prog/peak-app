import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  getAll,
  timeAgo,
  STAGES,
  STAGE_LABEL,
  approvedReviewLine,
  type Quote,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { all as allCustomers } from "@/lib/stores/customers";
import { getEngagementForQuoteRef, ENGAGEMENT_STATUS_LABEL } from "@/lib/stores/engagements";
import { allUsers, reviewers } from "@/lib/users";
import { deriveInitials, fallbackColor, firstName } from "@/lib/team";
import { money } from "@/lib/format";
import { StatusPill, QUOTE_STATUS_TONE } from "@/components/ui";
import { NewQuoteMenu, OwnerSelect, QuoteRevisions } from "./controls";
import { setQuoteStatus, submitQuoteForReview } from "./actions";

export const metadata = { title: "Quotes — Quartzite-6" };

/* ---- prototype token maps (Quotes.dc.html statusMeta / rMeta, Estimator rbMeta) ---- */

const REVIEW_CHIP: Record<string, { label: string; ink: string; soft: string; bd: string }> = {
  in_review: { label: "In review", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  approved: { label: "Approved", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  changes: { label: "Changes", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
};

const RB_META: Record<string, { bg: string; bd: string; ink: string; icon: string; title: string }> = {
  none: { bg: "#f4f5f7", bd: "#e4e7ec", ink: "#5b616e", icon: "○", title: "Not submitted for review" },
  in_review: { bg: "#eef3fc", bd: "#d4ddf3", ink: "#3155a8", icon: "◴", title: "In review" },
  approved: { bg: "#ecf6f0", bd: "#cce9da", ink: "#1f7a52", icon: "✓", title: "Approved" },
  changes: { bg: "#fcefe9", bd: "#f0d6cd", ink: "#b4543a", icon: "↩", title: "Changes requested" },
};

const GRID = "30px minmax(0,1fr) 200px 120px 96px 92px";

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
  if (q.quoteType === "flame_test")
    return { href: `/flame-tests/quote?id=${encodeURIComponent(q.id)}`, label: "Open flame test quote →" };
  if (q.quoteType === "repair")
    return { href: `/repairs/quote?id=${encodeURIComponent(q.id)}`, label: "Open repair quote →" };
  if (q.quoteType === "inspection")
    return { href: `/inspections/quote?id=${encodeURIComponent(q.id)}`, label: "Open inspection quote →" };
  if (q.quoteType === "consulting")
    return { href: `/design/engagements/quote?id=${encodeURIComponent(q.id)}`, label: "Open consulting quote →" };
  if (q.quoteType === "rental")
    return { href: `/rentals/quote?id=${encodeURIComponent(q.id)}`, label: "Open rental quote →" };
  return { href: `/estimator?id=${encodeURIComponent(q.id)}`, label: "Open in Estimator →" };
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
  const [user, sp, quotes, customers, users, reviewerRows] = await Promise.all([
    requireUser(),
    searchParams,
    getAll(),
    allCustomers(),
    allUsers(),
    reviewers(),
  ]);
  const me = user.name;

  /* ---- identity + customer lookups (port of Team.person / CustomerStore) ---- */
  const identity = new Map(users.map((u) => [u.name, { color: u.color, initials: u.initials }]));
  const colorOf = (n: string) => identity.get(n)?.color || fallbackColor(n || "");
  const initialsOf = (n: string) => identity.get(n)?.initials || deriveInitials(n || "");
  const custById = new Map(customers.map((c) => [c.id, c.name || ""]));
  const custIdByName = new Map(customers.map((c) => [(c.name || "").toLowerCase(), c.id]));
  const customerLabel = (q: Quote) => {
    const cid =
      q.customerId || custIdByName.get((q.customer || "").toLowerCase()) || null;
    return (cid ? custById.get(cid) || "" : "") || q.customer || "—";
  };

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
  const TYPE_KEYS = ["system", "flame_test", "repair", "inspection", "consulting", "rental"] as const;
  const typeParam = one(sp.type);
  const typeFilter = (TYPE_KEYS as readonly string[]).includes(typeParam) ? typeParam : "all";
  const selectedId = one(sp.id);
  // Punch #60: setQuoteStatus (quotes/actions.ts) redirects back here with
  // this param when the store's approval gate refuses a status change (e.g.
  // an unapproved quote pushed straight to Won from these plain buttons) —
  // surfaced on the selected row instead of a raw thrown-exception 500.
  const statusError = one(sp.statusError) || null;
  // #35 one-click both ways: the engagement referencing the selected quote
  // (as its source proposal OR as Peak's install bid). Selected row only.
  const selEng = selectedId ? await getEngagementForQuoteRef(selectedId) : null;

  const hrefFor = (over: {
    who?: string;
    status?: string;
    type?: string;
    id?: string | null;
  }) => {
    const qs = new URLSearchParams();
    const w = over.who ?? (scope === "all" ? "all" : scope);
    const st = over.status ?? filter;
    const ty = over.type ?? typeFilter;
    if (w && w !== "all") qs.set("who", w);
    if (st && st !== "all") qs.set("status", st);
    if (ty && ty !== "all") qs.set("type", ty);
    if (over.id) qs.set("id", over.id);
    const s = qs.toString();
    return "/quotes" + (s ? "?" + s : "");
  };

  /* ---- ownership scope ---- */
  let scoped = quotes;
  if (scope === "mine") scoped = quotes.filter((q) => q.owner === me);
  else if (scope !== "all") scoped = quotes.filter((q) => q.owner === scope);

  /* ---- quote-type filter (IDEAS #22 — one hub, filtered by type; a quote
     with no quoteType is a system quote) ---- */
  const typeOf = (q: Quote) => q.quoteType || "system";
  const typeCounts: Record<string, number> = { all: scoped.length };
  TYPE_KEYS.forEach((k) => {
    typeCounts[k] = scoped.filter((q) => typeOf(q) === k).length;
  });
  if (typeFilter !== "all") scoped = scoped.filter((q) => typeOf(q) === typeFilter);

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
  const counts: Record<string, number> = {
    all: scoped.length,
    draft: scoped.filter((q) => q.status === "draft").length,
    sent: scoped.filter((q) => q.status === "sent").length,
    won: scoped.filter((q) => q.status === "won").length,
    lost: scoped.filter((q) => q.status === "lost").length,
  };
  const filterDefs: Array<[string, string]> = [
    ["all", "All"],
    ["draft", STAGE_LABEL.draft],
    ["sent", STAGE_LABEL.sent],
    ["won", STAGE_LABEL.won],
    ["lost", STAGE_LABEL.lost],
  ];

  const filtered = scoped.filter((q) => filter === "all" || q.status === filter);

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
  const emptyMsg =
    scope === "mine" ? "You have no quotes in this stage." : "No quotes in this stage.";

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

        {filtered.map((q) => {
          const rState = q.review?.state || "none";
          const rMeta = REVIEW_CHIP[rState];
          const selected = q.id === selectedId;
          const owner = q.owner || "Unassigned";
          return (
            <div key={q.id}>
              <Link
                href={hrefFor({ id: selected ? null : q.id })}
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
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      color: "#aab0bb",
                      marginTop: 3,
                    }}
                  >
                    {q.id} · {owner}
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
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}
                >
                  <StatusPill tone={QUOTE_STATUS_TONE[q.status] || "gray"} minWidth={64}>
                    {STAGE_LABEL[q.status] || STAGE_LABEL.draft}
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
              </Link>

              {selected && (
                <SelectedPanel
                  q={q}
                  me={me}
                  engagement={
                    selEng
                      ? { id: selEng.id, stage: ENGAGEMENT_STATUS_LABEL[selEng.status] }
                      : null
                  }
                  reviewerNames={reviewerRows
                    .filter((u) => u.name !== me && u.name !== q.owner)
                    .map((u) => u.name)}
                  backHref={hrefFor({ id: q.id })}
                  statusError={statusError}
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
  me,
  engagement,
  reviewerNames,
  backHref,
  statusError,
}: {
  q: Quote;
  me: string;
  engagement: { id: string; stage: string } | null;
  reviewerNames: string[];
  /** Current list URL (filters + this row selected) — round-tripped through
   *  setQuoteStatus's hidden "back" field so a gate refusal redirects to
   *  exactly this view instead of a bare "/quotes". */
  backHref: string;
  /** Set when setQuoteStatus's approval gate just refused a change for THIS
   *  row (punch #60). */
  statusError: string | null;
}) {
  const rev = q.review || { state: "none" as const, reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "" };
  const rm = RB_META[rev.state] || RB_META.none;
  const isOwner = q.owner === me;
  const sentAlready = q.status === "sent" || q.status === "won" || q.status === "lost";
  const canSubmit = isOwner && (rev.state === "none" || rev.state === "changes") && !sentAlready;
  const canSend = isOwner && rev.state === "approved" && !sentAlready;

  let rbSub: string;
  if (rev.state === "none")
    rbSub = "Submit for a reviewer’s approval before sending to the customer.";
  else if (rev.state === "in_review")
    rbSub = rev.reviewer
      ? "With " + firstName(rev.reviewer) + " for approval"
      : "In the shared queue — awaiting a reviewer";
  else if (rev.state === "approved") rbSub = approvedReviewLine(rev);
  else
    rbSub = rev.note
      ? "“" + rev.note + "” — " + firstName(rev.decidedBy || "")
      : "Returned by " + firstName(rev.decidedBy || "");

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
          {statusError}
        </div>
      )}
      {/* review & approval banner (Estimator port) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          rowGap: 11,
          padding: "11px 14px",
          background: rm.bg,
          border: `1px solid ${rm.bd}`,
          borderRadius: 10,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "#fff",
            border: `1px solid ${rm.bd}`,
            color: rm.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {rm.icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: rm.ink }}>{rm.title}</div>
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 1 }}>{rbSub}</div>
        </div>
        {canSubmit && (
          <form
            action={submitQuoteForReview}
            style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}
          >
            <input type="hidden" name="id" value={q.id} />
            <select
              name="reviewer"
              defaultValue="queue"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#3a3f4a",
                background: "#fff",
                border: "1px solid #e4e7ec",
                borderRadius: 8,
                padding: "8px 11px",
                cursor: "pointer",
              }}
            >
              <option value="queue">Shared queue (any reviewer)</option>
              {reviewerNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#fff",
                background: "#3155a8",
                border: "none",
                borderRadius: 8,
                padding: "9px 15px",
                cursor: "pointer",
              }}
            >
              {rev.state === "changes" ? "Resubmit for review" : "Submit for review"}
            </button>
          </form>
        )}
        {canSend && (
          <form action={setQuoteStatus}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="back" value={backHref} />
            <button
              type="submit"
              name="status"
              value="sent"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#fff",
                background: "#1f7a52",
                border: "none",
                borderRadius: 8,
                padding: "9px 15px",
                cursor: "pointer",
              }}
            >
              Send to customer →
            </button>
          </form>
        )}
      </div>

      {/* meta + status + open */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          rowGap: 10,
          flexWrap: "wrap",
          marginTop: 12,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
          {money(q.value || 0)} quoted{marginPct > 0 ? ` · ${marginPct}% margin` : ""}
        </span>
        {/* punch item 24 — snapshot / recall this quote's pricing */}
        <QuoteRevisions
          id={q.id}
          revisions={(q.revisions || []).map((r) => ({
            rev: r.rev,
            at: r.at,
            by: r.by,
            reason: r.reason,
            note: r.note,
            value: r.value,
          }))}
          canRestore={q.status !== "won"}
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
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
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
          <form action={setQuoteStatus} style={{ display: "flex", gap: 6 }}>
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
          <Link
            href={editHrefFor(q).href}
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
          </Link>
        </div>
      </div>
    </div>
  );
}
