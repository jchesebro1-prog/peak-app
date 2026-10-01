import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { getAll, type Quote } from "@/lib/stores/quotes";
import { all as allCustomers } from "@/lib/stores/customers";
import { money } from "@/lib/format";
import { StatusPill } from "@/components/ui";
import { quoteBuilderHref } from "@/lib/quote-links";
import { portalQuoteDate } from "@/lib/portal-quote-names";
import {
  PORTAL_QUEUE_STATUSES,
  PORTAL_QUEUE_STATUS_LABEL,
  PORTAL_QUEUE_TYPES,
  PORTAL_QUEUE_TYPE_LABEL,
  parsePortalQueueFilter,
  parsePortalQueueType,
  portalQueueHref,
  portalQueueView,
  type PortalQueueFilter,
  type PortalQueueStatus,
  type PortalQueueTypeFilter,
} from "@/lib/portal-quote-queue";
import { FocusRow, QueueRowActions } from "./queue-actions";

export const metadata = { title: "Portal quotes — Quartzite-6" };

/**
 * Portal quotes (#288, spec §1.7) — the staff work queue of every quote a
 * customer built in the portal (catalog, service, legacy self-serve): Needs
 * action by default, filters as links, Approve / Decline on accepted rows and
 * Open into each quote's own builder. The bell's three portal groups land
 * here with `?focus=<id>`.
 */

const STATUS_TONE: Record<PortalQueueStatus, string> = {
  review: "orange",
  accepted: "green",
  sent: "blue",
  expired: "red",
  won: "darkblue",
  lost: "gray",
  draft: "purple",
};

const GRID = "92px minmax(160px,1.6fr) minmax(120px,1fr) 92px 140px 96px 96px 96px minmax(150px,auto)";

const CSS = `
  .pq-table { overflow-x: auto; }
  .pq-row { min-width: 1080px; }
  .pq-row:hover { background: #fafbff; }
  @media (max-width: 860px) {
    .pq-pad { padding-left: 16px !important; padding-right: 16px !important; }
  }
`;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  padding: "7px 12px",
  borderRadius: 7,
  textDecoration: "none",
};

export default async function PortalQuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, quotes, customers] = await Promise.all([requireUser(), searchParams, getAll(), allCustomers()]);

  // The hub's company label: the linked company's current name, else the
  // denormalized `customer` text.
  const custById = new Map(customers.map((c) => [c.id, c.name || ""]));
  const custIdByName = new Map(customers.map((c) => [(c.name || "").toLowerCase(), c.id]));
  const companyOf = (q: Quote) => {
    const cid = q.customerId || custIdByName.get((q.customer || "").toLowerCase()) || null;
    return (cid ? custById.get(cid) || "" : "") || q.customer || "";
  };

  const focus = one(sp.focus).trim() || null;
  const term = one(sp.q).trim();
  const statusError = one(sp.statusError) || null;
  const view = portalQueueView(quotes, {
    now: Date.now(),
    status: parsePortalQueueFilter(one(sp.status)),
    type: parsePortalQueueType(one(sp.type)),
    q: term,
    focus,
    companyOf,
  });

  const hrefFor = (over: { status?: PortalQueueFilter; type?: PortalQueueTypeFilter; q?: string }) => {
    const qs = new URLSearchParams();
    const st = over.status ?? view.status;
    const ty = over.type ?? view.type;
    const t = over.q ?? term;
    if (st !== "action") qs.set("status", st);
    if (ty !== "all") qs.set("type", ty);
    if (t) qs.set("q", t);
    const s = qs.toString();
    return "/quotes/portal" + (s ? "?" + s : "");
  };

  const statusChips: Array<[PortalQueueFilter, string]> = [
    ["action", "Needs action"],
    ["all", "All"],
    ...PORTAL_QUEUE_STATUSES.map((s) => [s, PORTAL_QUEUE_STATUS_LABEL[s]] as [PortalQueueFilter, string]),
  ];
  const typeChips: Array<[PortalQueueTypeFilter, string]> = [
    ["all", "All types"],
    ...PORTAL_QUEUE_TYPES.map((t) => [t, PORTAL_QUEUE_TYPE_LABEL[t]] as [PortalQueueTypeFilter, string]),
  ];

  const emptyMsg = term
    ? `No portal quotes match “${term}”.`
    : view.status === "action"
      ? "Nothing needs action — no portal quotes waiting on review or confirmation."
      : "No portal quotes here.";

  return (
    <div className="pk-content pq-pad">
      <style>{CSS}</style>
      {focus && <FocusRow id={focus} />}

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Portal quotes</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            Quotes customers built in the portal · {view.counts.action} need action
          </div>
        </div>
        <Link href="/quotes" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
          All quotes →
        </Link>
      </div>

      {statusError && (
        <div role="alert" style={{ padding: "10px 14px", marginBottom: 14, background: "#fcefe9", border: "1px solid #f0d6cd", borderRadius: 10, fontSize: 12.5, color: "#b4543a", fontWeight: 600 }}>
          {statusError}
        </div>
      )}

      {/* status chips */}
      <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 8, padding: 2, maxWidth: "100%", overflowX: "auto", marginBottom: 12, width: "fit-content" }}>
        {statusChips.map(([key, label]) => {
          const active = view.status === key;
          return (
            <Link
              key={key}
              href={hrefFor({ status: key })}
              style={{
                ...CHIP,
                ...(active
                  ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                  : { background: "transparent", color: "#787d87" }),
              }}
            >
              {label}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: active ? "var(--accent)" : "#aab0bb" }}>
                {view.counts[key]}
              </span>
            </Link>
          );
        })}
      </div>

      {/* type chips + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {typeChips.map(([key, label]) => {
          const active = view.type === key;
          return (
            <Link
              key={key}
              href={hrefFor({ type: key })}
              style={{
                ...CHIP,
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 20,
                border: active ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                background: active ? "var(--accent)" : "#fff",
                color: active ? "#fff" : "#5b616e",
              }}
            >
              {label}
            </Link>
          );
        })}
        <form method="get" action="/quotes/portal" style={{ display: "flex", marginLeft: "auto", maxWidth: "100%" }}>
          {view.status !== "action" && <input type="hidden" name="status" value={view.status} />}
          {view.type !== "all" && <input type="hidden" name="type" value={view.type} />}
          <input
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Search name, company, EST-1042…"
            aria-label="Search portal quotes by name, company or estimate number"
            className="pk-input"
            style={{ fontSize: 12.5, padding: "6px 10px", minWidth: 0, width: 240, maxWidth: "100%" }}
          />
        </form>
      </div>

      <div className="pq-table" style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 13, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
        <div
          className="pq-row"
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
          <span>Est #</span>
          <span>Name</span>
          <span>Company</span>
          <span>Type</span>
          <span>Status</span>
          <span style={{ textAlign: "right" }}>Total</span>
          <span>Created</span>
          <span>Valid until</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </div>

        {view.rows.map(({ q, status, statusLabel, typeLabel, company, estNo, approve, decline }) => {
          const focused = q.id === focus;
          return (
            <div
              key={q.id}
              id={"row-" + q.id}
              className="pq-row"
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 12,
                padding: "12px 18px",
                alignItems: "center",
                borderBottom: "1px solid #f5f6f8",
                background: focused ? "#fff8e6" : undefined,
                boxShadow: focused ? "inset 3px 0 0 var(--accent)" : undefined,
                scrollMarginTop: 80,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a" }}>{estNo}</span>
              <Link
                href={quoteBuilderHref(q)}
                style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d", textDecoration: "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={q.name}
              >
                {q.name || "Untitled quote"}
              </Link>
              <span style={{ fontSize: 12.5, color: "#5b616e", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={company}>
                {company || "—"}
              </span>
              <span style={{ fontSize: 12, color: "#5b616e" }}>{typeLabel}</span>
              <span>
                <StatusPill tone={STATUS_TONE[status]} minWidth={0} maxWidth="100%" title={statusLabel}>
                  {statusLabel}
                </StatusPill>
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>{money(q.value || 0)}</span>
              <span style={{ fontSize: 12, color: "#787d87" }}>{q.createdAt ? portalQuoteDate(q.createdAt) : "—"}</span>
              <span style={{ fontSize: 12, color: status === "expired" ? "#a33a2b" : "#787d87" }}>
                {q.portalFirm ? portalQuoteDate(q.portalFirm.validUntil) : "—"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {(approve || decline) && (
                  <QueueRowActions quoteId={q.id} approve={approve} decline={decline} back={portalQueueHref(q.id)} />
                )}
                <Link href={quoteBuilderHref(q)} className="pk-btn-outline" style={{ fontSize: 12, padding: "6px 11px", textDecoration: "none" }}>
                  Open
                </Link>
              </div>
            </div>
          );
        })}

        {view.rows.length === 0 && (
          <div style={{ padding: "44px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13, lineHeight: 1.6 }}>{emptyMsg}</div>
        )}
      </div>
    </div>
  );
}
