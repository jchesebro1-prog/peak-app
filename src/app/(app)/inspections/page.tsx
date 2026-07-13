import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  getAll,
  counts,
  renewals,
  renewalMeta,
  stageMeta,
  levelMeta,
  dueAtOf,
  fmtShort,
  dueLabel,
  timeAgo,
  RENEWAL_LEAD_DAYS,
  type InspectionRecord,
  type InspectionStageKey,
} from "@/lib/stores/inspections";
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { all as allCustomers } from "@/lib/stores/customers";
import { coordsOf } from "@/lib/geo";
import { InspectionMap } from "./controls";
import {
  createInspection,
  markInspectionRenewalOutreach,
  startInspectionRenewalOutreach,
} from "./actions";
import type { MapPin } from "@/components/map/LeafletMap";

export const metadata = { title: "Rigging Inspections — Peak Backend" };

/**
 * Rigging Inspections DASHBOARD — the flame-tests-style upgrade of the old
 * inbox (IDEAS #44): KPI strip, renewals-due panel tracking BOTH cadences
 * (Level 1 annual · Level 2 every 5 years), the all-inspections work list
 * with `quoted` pre-record rows from open inspection quotes, a Leaflet
 * location map, and the by-status summary.
 */

const DAY = 86400000;

/* ---- local stage meta including the "quoted" pre-record row ---- */

type RowStage = "quoted" | InspectionStageKey;

const STAGE_DOT: Record<RowStage, string> = {
  quoted: "#8c919c",
  requested: "#c98a2b",
  scheduled: "#3155a8",
  onsite: "#7b3f8a",
  completed: "#1f7a52",
};

const QUOTED_META = { label: "Quoted", ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec" };

function localStage(k: RowStage) {
  return k === "quoted" ? QUOTED_META : stageMeta(k);
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** ms → 'July 12, 2026' (the store's fmt* helpers take ISO strings). */
function fmtLongMs(ts: number): string {
  const d = new Date(ts);
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

/* renewal window presets shared by the renewals card + map chips */
const WINDOW_DEFS: Array<[number, string]> = [
  [-30, "−30d"],
  [30, "+30d"],
  [60, "+60d"],
  [90, "+90d"],
];

const STATUS_KEYS: InspectionStageKey[] = ["requested", "scheduled", "onsite", "completed"];

const CSS = `
  .ind-grid { display: grid; grid-template-columns: minmax(0,1fr) 400px; gap: 18px; align-items: start; }
  .ind-kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 13px; }
  .ind-rowlink:hover { background: #fafbfc; }
  .ind-renewrow:hover .ind-renewhit { background: #faf9fb; }
  @media (max-width: 940px) {
    .ind-grid { grid-template-columns: 1fr !important; }
    .ind-kpis { grid-template-columns: 1fr 1fr !important; }
  }
`;

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, records, quotes, customers] = await Promise.all([
    requireUser(),
    searchParams,
    getAll(),
    allQuotes(),
    allCustomers(),
  ]);

  /* ---- URL state: status filter + renewal window + map status visibility ---- */
  const filterParam = one(sp.filter) as RowStage | "all" | "";
  const filter: RowStage | "all" =
    filterParam === "quoted" || STATUS_KEYS.includes(filterParam as InspectionStageKey)
      ? (filterParam as RowStage)
      : "all";

  const winParam = parseInt(one(sp.win), 10);
  const selWin = [-30, 30, 60, 90].includes(winParam) ? winParam : 60;

  // renewals sub-view (IDEAS #37): to-contact worklist vs. reached-out
  const rvView = one(sp.rv) === "awaiting" ? "awaiting" : "contact";

  const hidden = new Set(one(sp.hide).split(",").filter(Boolean));
  const statusOn = (k: InspectionStageKey) => !hidden.has(k);

  const hrefFor = (over: {
    filter?: string;
    win?: number;
    hide?: string;
    rv?: string;
  }) => {
    const qs = new URLSearchParams();
    const f = over.filter ?? filter;
    const w = over.win ?? selWin;
    const h = over.hide ?? Array.from(hidden).join(",");
    const rv = over.rv ?? rvView;
    if (f && f !== "all") qs.set("filter", f);
    if (w !== 60) qs.set("win", String(w));
    if (h) qs.set("hide", h);
    if (rv !== "contact") qs.set("rv", rv);
    const s = qs.toString();
    return "/inspections" + (s ? "?" + s : "");
  };

  /* ---- coords per record (resolved from the customer directory) ---- */
  const locCoords = new Map<string, { lat: number; lng: number }>();
  customers.forEach((c) => {
    (c.locations || []).forEach((l) => {
      const co = coordsOf(l);
      if (co && l.id) locCoords.set(c.id + "|" + l.id, { lat: co.lat, lng: co.lng });
    });
  });
  const recCoords = (r: InspectionRecord) =>
    r.customerId && r.locationId
      ? locCoords.get(r.customerId + "|" + r.locationId) || null
      : null;

  /* ---- open inspection quotes without a spawned record yet ---- */
  const haveQ = new Set<string>();
  records.forEach((r) => {
    if (r.quoteId) haveQ.add(r.quoteId);
  });
  const openQuotes = quotes.filter(
    (q: Quote) =>
      q.quoteType === "inspection" &&
      (q.status === "draft" || q.status === "sent") &&
      !haveQ.has(q.id)
  );

  type Row = {
    key: string;
    stage: RowStage;
    id: string | null;
    customer: string;
    sub: string;
    value: number;
    updatedAt: number;
    href: string;
    isCompleted: boolean;
  };

  const custById = new Map(customers.map((c) => [c.id, c.name || ""]));
  const nameFor = (id: string | null) => (id ? custById.get(id) || "" : "");

  const allRows: Row[] = [];
  openQuotes.forEach((q) => {
    const insp = (q.inspection || {}) as { level?: number; lineSetsTotal?: number };
    const lm = levelMeta(insp.level);
    allRows.push({
      key: "q-" + q.id,
      stage: "quoted",
      id: q.id,
      customer: q.customer || nameFor(q.customerId) || "Customer",
      sub:
        (q.name || "Inspection quote") +
        " · " +
        lm.label +
        (insp.lineSetsTotal ? " · " + insp.lineSetsTotal + " line sets" : ""),
      value: q.value || 0,
      updatedAt: q.updatedAt || q.createdAt || 0,
      href: "/inspections/quote?id=" + encodeURIComponent(q.id),
      isCompleted: false,
    });
  });
  records.forEach((r) => {
    const cnt = counts(r);
    const lm = levelMeta(r.level);
    const bits = [r.venue || "—", lm.label];
    if (cnt.total > 0)
      bits.push(
        cnt.open + " open" + (cnt.urgent.open ? " · " + cnt.urgent.open + " urgent" : "")
      );
    else if (r.lineSets) bits.push(r.lineSets + " line sets");
    allRows.push({
      key: "r-" + r.id,
      stage: r.stage || "requested",
      id: r.id,
      customer: r.customer || "Customer",
      sub: bits.join(" · "),
      value: r.value || 0,
      updatedAt: r.updatedAt || 0,
      href:
        r.stage === "requested"
          ? "/inspections/scheduling"
          : "/inspections/" + encodeURIComponent(r.id),
      isCompleted: r.stage === "completed",
    });
  });

  const cnt: Record<RowStage, number> = {
    quoted: 0,
    requested: 0,
    scheduled: 0,
    onsite: 0,
    completed: 0,
  };
  allRows.forEach((r) => {
    cnt[r.stage] = (cnt[r.stage] || 0) + 1;
  });
  const active = cnt.requested + cnt.scheduled + cnt.onsite;
  const totalUrgent = records.reduce((a, x) => a + counts(x).urgent.open, 0);

  /* ---- renewals (both cadences) ---- */
  const dueRows = await renewals({ dueOnly: true });
  const overdueCount = dueRows.filter((r) => r._renewal.state === "overdue").length;
  const dueSoonCount = dueRows.filter((r) => r._renewal.state === "due_soon").length;
  const dueTotal = dueRows.length;

  const allRenewals = await renewals({});
  const winCutoff = (w: number) => Date.now() + w * DAY;
  const inWin = (r: InspectionRecord, w: number) => {
    const d = dueAtOf(r);
    return d != null && d <= winCutoff(w);
  };
  const windowRows = allRenewals
    .filter((r) => inWin(r, selWin))
    .sort((a, b) => (dueAtOf(a) || 0) - (dueAtOf(b) || 0));
  const winOverdue = windowRows.filter((r) => r._renewal.state === "overdue").length;

  /* outreach worklist split (IDEAS #37, per F7): the panel defaults to venues
     NOT yet contacted this cycle; "Reached out — awaiting" holds the rest. */
  const toContact = windowRows.filter((r) => !r.renewalOutreach);
  const awaiting = windowRows.filter((r) => !!r.renewalOutreach);
  const shownRows = rvView === "awaiting" ? awaiting : toContact;

  /* ---- KPI strip ---- */
  const bar = (c: string): CSSProperties => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: 3,
    height: "100%",
    background: c,
  });
  const kpis = [
    {
      label: "Active inspections",
      value: String(active),
      color: "#16181d",
      barStyle: bar("var(--accent)"),
      sub:
        cnt.scheduled + " scheduled · " + cnt.onsite + " on-site · " + cnt.requested + " to schedule",
    },
    {
      label: "Awaiting schedule",
      value: String(cnt.requested),
      color: cnt.requested ? "#9a6a1f" : "#16181d",
      barStyle: bar("#c98a2b"),
      sub: "requested, no date yet",
    },
    {
      label: "Due for renewal",
      value: String(dueTotal),
      color: overdueCount ? "#b4543a" : dueTotal ? "#9a6a1f" : "#16181d",
      barStyle: bar(overdueCount ? "#b4543a" : "#c98a2b"),
      sub: overdueCount
        ? overdueCount + " overdue · " + dueSoonCount + " due soon"
        : "within " + RENEWAL_LEAD_DAYS + " days",
    },
    {
      label: "Urgent open",
      value: String(totalUrgent),
      color: totalUrgent ? "#b4543a" : "#1f7a52",
      barStyle: bar(totalUrgent ? "#b4543a" : "#1f7a52"),
      sub: "across all sites",
    },
  ];

  /* ---- all-inspections filter chips ---- */
  const filterDefs: Array<[RowStage | "all", string, number]> = [
    ["all", "All", allRows.length],
    ["quoted", "Quoted", cnt.quoted],
    ["requested", "Requested", cnt.requested],
    ["scheduled", "Scheduled", cnt.scheduled],
    ["onsite", "On-site", cnt.onsite],
    ["completed", "Completed", cnt.completed],
  ];
  let rows = allRows.slice();
  if (filter !== "all") rows = rows.filter((r) => r.stage === filter);
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  /* ---- by-status bars ---- */
  const statusDefs = [
    { label: "Quoted", count: cnt.quoted, dot: STAGE_DOT.quoted },
    { label: "Requested", count: cnt.requested, dot: STAGE_DOT.requested },
    { label: "Scheduled", count: cnt.scheduled, dot: STAGE_DOT.scheduled },
    { label: "On-site", count: cnt.onsite, dot: STAGE_DOT.onsite },
    { label: "Completed", count: cnt.completed, dot: STAGE_DOT.completed },
    { label: "Overdue renewals", count: overdueCount, dot: renewalMeta("overdue").dot },
  ];
  const maxC = Math.max(1, ...statusDefs.map((d) => d.count));

  /* ---- map pins (respecting status visibility; renewal-due venues ringed) ---- */
  const renewalByKey: Record<string, string> = {};
  windowRows.forEach((r) => {
    const c = recCoords(r);
    if (c) renewalByKey[c.lat.toFixed(3) + "," + c.lng.toFixed(3)] = r._renewal.state;
  });
  const mapCounts: Record<InspectionStageKey, number> = {
    requested: 0,
    scheduled: 0,
    onsite: 0,
    completed: 0,
  };
  const pins: MapPin[] = [];
  records.forEach((r) => {
    const stage = (r.stage || "requested") as InspectionStageKey;
    const c = recCoords(r);
    if (!c) return;
    mapCounts[stage] = (mapCounts[stage] || 0) + 1;
    if (!statusOn(stage)) return;
    const m = stageMeta(stage);
    const rKey = c.lat.toFixed(3) + "," + c.lng.toFixed(3);
    const rState = renewalByKey[rKey];
    const rMeta = rState ? renewalMeta(rState) : null;
    let when = " — awaiting scheduling";
    if (stage === "completed") when = " — inspected " + fmtShort(r.surveyDate);
    else if (stage === "scheduled") when = " — scheduled " + fmtShort(r.scheduledDate);
    else if (stage === "onsite") when = " — on site now";
    pins.push({
      id: r.id,
      lat: c.lat,
      lng: c.lng,
      color: rMeta ? rMeta.dot : STAGE_DOT[stage] || m.ink,
      ring: !!rMeta,
      label: r.customer || "Venue",
      sub: (r.venue || "") + " · " + levelMeta(r.level).label + when,
    });
  });
  const visibleCount = STATUS_KEYS.reduce(
    (a, k) => a + (statusOn(k) ? mapCounts[k] || 0 : 0),
    0
  );
  const anyMappable = STATUS_KEYS.reduce((a, k) => a + (mapCounts[k] || 0), 0) > 0;

  const totalRows = allRows.length;
  const standfirst =
    totalRows +
    " inspection" +
    (totalRows === 1 ? "" : "s") +
    " tracked · " +
    (dueTotal
      ? dueTotal + " due for renewal (L1 annual · L2 five-year)"
      : "all current on both cadences") +
    " · " +
    totalUrgent +
    " urgent open";

  const chipStyle = (on: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    padding: "6px 12px",
    borderRadius: 20,
    textDecoration: "none",
    border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
    background: on ? "var(--accent)" : "#fff",
    color: on ? "#fff" : "#5b616e",
  });

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 22,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
            Rigging inspections
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <form action={createInspection}>
            <button
              type="submit"
              title="Create a requested inspection directly (no quote)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                fontWeight: 600,
                color: "#16181d",
                background: "#fff",
                border: "1px solid #e4e7ec",
                borderRadius: 10,
                padding: "10px 15px",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
              }}
            >
              + Direct request
            </button>
          </form>
          <Link
            href="/inspections/scheduling"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#16181d",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 10,
              padding: "10px 15px",
              textDecoration: "none",
            }}
          >
            Scheduler →
          </Link>
          <Link
            href="/inspections/quote"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              borderRadius: 10,
              padding: "10px 16px",
              textDecoration: "none",
            }}
          >
            + New inspection quote
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="ind-kpis" style={{ marginBottom: 18 }}>
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 12,
              padding: "15px 17px",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={k.barStyle} />
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {k.label}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 26,
                fontWeight: 600,
                marginTop: 8,
                color: k.color,
              }}
            >
              {k.value}
            </div>
            <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 5 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* main grid */}
      <div className="ind-grid">
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* renewals due */}
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
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "15px 20px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Renewals due</div>
                {windowRows.length > 0 && (
                  <span
                    style={{
                      display: "inline-block",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                      background: winOverdue ? "#b4543a" : "#c98a2b",
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {winOverdue ? winOverdue + " overdue" : windowRows.length + " due"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>L1 annual · L2 every 5 yrs</div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                padding: "12px 20px 4px",
              }}
            >
              {WINDOW_DEFS.map(([w, label]) => (
                <Link key={w} href={hrefFor({ win: w })} style={chipStyle(selWin === w)}>
                  {label}{" "}
                  <span style={{ opacity: 0.6 }}>
                    {allRenewals.filter((r) => inWin(r, w)).length}
                  </span>
                </Link>
              ))}
              <span style={{ width: 1, height: 18, background: "#e8eaee", margin: "0 3px" }} />
              <Link href={hrefFor({ rv: "contact" })} style={chipStyle(rvView === "contact")}>
                To contact <span style={{ opacity: 0.6 }}>{toContact.length}</span>
              </Link>
              <Link href={hrefFor({ rv: "awaiting" })} style={chipStyle(rvView === "awaiting")}>
                Reached out — awaiting <span style={{ opacity: 0.6 }}>{awaiting.length}</span>
              </Link>
            </div>
            <div style={{ padding: "0 20px 12px", fontSize: 11, color: "#aab0bb" }}>
              Due on or before {fmtLongMs(winCutoff(selWin))}
              {rvView === "contact"
                ? " · not yet contacted this cycle"
                : " · contacted, no new inspection booked yet"}
            </div>
            {shownRows.map((r) => {
              const rs = r._renewal;
              const m = renewalMeta(rs.state);
              const lm = levelMeta(r.level);
              const renewHref =
                "/inspections/quote?level=" +
                lm.key +
                (r.customerId ? "&customer=" + encodeURIComponent(r.customerId) : "");
              return (
                <div
                  key={r.id}
                  className="ind-renewrow"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "13px 20px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <Link
                    href={"/inspections/" + encodeURIComponent(r.id) + "/report"}
                    title="View the last report"
                    className="ind-renewhit"
                    style={{
                      minWidth: 0,
                      display: "block",
                      textDecoration: "none",
                      color: "inherit",
                      margin: "-6px -8px",
                      padding: "6px 8px",
                      borderRadius: 9,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: m.dot,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          lineHeight: 1.25,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.customer || "Customer"}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: lm.ink,
                          background: lm.soft,
                          border: "1px solid " + lm.bd,
                          padding: "2px 7px",
                          borderRadius: 5,
                          flexShrink: 0,
                        }}
                      >
                        {lm.label}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: m.ink,
                          background: m.soft,
                          border: "1px solid " + m.bd,
                          padding: "2px 7px",
                          borderRadius: 5,
                          flexShrink: 0,
                        }}
                      >
                        {dueLabel(rs.days, rs.state)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#9aa0ab",
                        marginTop: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(r.venue || "") +
                        " · last inspected " +
                        fmtShort(r.surveyDate || r.reportDate)}{" "}
                      · <span style={{ color: "#b3b8c1" }}>last report ›</span>
                    </div>
                  </Link>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {rvView === "contact" ? (
                      <>
                        {/* IDEAS #36 — one-click outreach: quote at last
                            year's price, PDF attached, composer opens */}
                        <form action={startInspectionRenewalOutreach}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            title="Email the renewal — opens the Inbox with this year's quote attached at last year's price"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 34,
                              height: 34,
                              borderRadius: 9,
                              border: "1px solid #e4e7ec",
                              background: "#fff",
                              color: "#5b616e",
                              cursor: "pointer",
                              fontSize: 15,
                              fontFamily: "var(--font-ui)",
                            }}
                          >
                            ✉
                          </button>
                        </form>
                        <form action={markInspectionRenewalOutreach}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            title="Mark as reached out — moves this venue to the awaiting view"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              fontSize: 12.5,
                              fontWeight: 600,
                              color: "#1f7a52",
                              background: "#eaf6ef",
                              border: "1px solid #cce9da",
                              borderRadius: 9,
                              padding: "9px 12px",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              fontFamily: "var(--font-ui)",
                            }}
                          >
                            ✓ Reached out
                          </button>
                        </form>
                        <Link
                          href={renewHref}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "#fff",
                            background: "var(--accent)",
                            borderRadius: 9,
                            padding: "9px 13px",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Start renewal
                        </Link>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 11.5, color: "#9aa0ab", whiteSpace: "nowrap" }}>
                          {r.renewalOutreach
                            ? "reached out " +
                              timeAgo(r.renewalOutreach.at) +
                              " · " +
                              r.renewalOutreach.by
                            : ""}
                        </span>
                        <form action={markInspectionRenewalOutreach}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="undo" value="1" />
                          <button
                            type="submit"
                            title="Undo — back to the to-contact list"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#5b616e",
                              background: "#fff",
                              border: "1px solid #e4e7ec",
                              borderRadius: 9,
                              padding: "8px 11px",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              fontFamily: "var(--font-ui)",
                            }}
                          >
                            Undo
                          </button>
                        </form>
                        <Link
                          href={renewHref}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "#fff",
                            background: "var(--accent)",
                            borderRadius: 9,
                            padding: "9px 13px",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Start renewal
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {shownRows.length === 0 && (
              <div
                style={{
                  padding: "30px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {rvView === "awaiting"
                  ? "No venues awaiting a reply — nothing marked reached-out in this window."
                  : windowRows.length > 0
                    ? "Every renewal in this window has been reached out to — see the awaiting view."
                    : selWin < 0
                      ? "No renewals overdue by that much."
                      : "No renewals due within this window."}
              </div>
            )}
          </div>

          {/* all inspections */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "15px 20px 12px", fontSize: 14.5, fontWeight: 600 }}>
              All inspections
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                padding: "0 20px 13px",
              }}
            >
              {filterDefs.map(([key, label, count]) => (
                <Link key={key} href={hrefFor({ filter: key })} style={chipStyle(filter === key)}>
                  {label} <span style={{ opacity: 0.6 }}>{count}</span>
                </Link>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 110px 96px 78px",
                gap: 12,
                padding: "0 20px 8px",
                fontSize: 10,
                fontWeight: 600,
                color: "#aab0bb",
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              <span>Inspection</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Value</span>
              <span style={{ textAlign: "right" }}>Updated</span>
            </div>
            {rows.map((r) => {
              const m = localStage(r.stage);
              return (
                <div
                  key={r.key}
                  className="ind-rowlink"
                  style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 110px 96px 78px",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 20px",
                    borderTop: "1px solid #f3f4f7",
                    color: "#16181d",
                  }}
                >
                  <Link
                    href={r.href}
                    aria-label="Open inspection"
                    style={{ position: "absolute", inset: 0, zIndex: 1 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.customer}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#9aa0ab",
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.sub}
                    </div>
                  </div>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                        color: m.ink,
                        background: m.soft,
                        border: "1px solid " + m.bd,
                        padding: "2px 8px",
                        borderRadius: 5,
                      }}
                    >
                      {m.label}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 600,
                      textAlign: "right",
                      color: r.value ? "#16181d" : "#c4c9d2",
                    }}
                  >
                    {r.value ? money(r.value) : "—"}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11.5,
                        color: "#9aa0ab",
                      }}
                    >
                      {timeAgo(r.updatedAt)}
                    </div>
                    {r.isCompleted && r.id && (
                      <Link
                        href={"/inspections/" + encodeURIComponent(r.id) + "/report"}
                        style={{
                          position: "relative",
                          zIndex: 2,
                          display: "inline-block",
                          marginTop: 3,
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        Report ›
                      </Link>
                    )}
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div
                style={{
                  padding: "30px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                  borderTop: "1px solid #f3f4f7",
                }}
              >
                No inspections in this view.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* inspection locations map */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "15px 18px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Inspection locations</div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11.5,
                  color: "#8c919c",
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "#8c919c",
                    border: "2px solid #fff",
                    boxShadow: "0 0 0 1px #cbd0d8",
                  }}
                />
                {visibleCount} mapped
              </span>
            </div>
            <div style={{ position: "relative" }}>
              <InspectionMap pins={pins} height={340} />
              {pins.length === 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 5,
                    textAlign: "center",
                    color: "#5b616e",
                    fontSize: 12,
                    padding: "6px 12px",
                    background: "rgba(255,255,255,.92)",
                    border: "1px solid #e7eaee",
                    borderRadius: 8,
                    boxShadow: "0 1px 4px rgba(0,0,0,.1)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {anyMappable
                    ? "No statuses selected — tap one below to show pins."
                    : "No mappable inspections yet."}
                </div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                flexWrap: "wrap",
                padding: "11px 18px 7px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                Status
              </span>
              {(["completed", "onsite", "scheduled", "requested"] as InspectionStageKey[]).map(
                (key) => {
                  const m = stageMeta(key);
                  const isOn = statusOn(key);
                  const nextHidden = new Set(hidden);
                  if (isOn) nextHidden.add(key);
                  else nextHidden.delete(key);
                  return (
                    <Link
                      key={key}
                      href={hrefFor({ hide: Array.from(nextHidden).join(",") })}
                      title={(isOn ? "Hide " : "Show ") + m.label.toLowerCase() + " inspections"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "5px 11px",
                        borderRadius: 20,
                        textDecoration: "none",
                        border: isOn ? "1px solid #e4e7ec" : "1px solid #eeeff2",
                        background: isOn ? "#fff" : "#f6f7f9",
                        color: isOn ? "#3a3f4a" : "#b3b8c1",
                      }}
                    >
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: STAGE_DOT[key],
                          opacity: isOn ? 1 : 0.3,
                        }}
                      />
                      {m.label}{" "}
                      <span style={{ fontFamily: "var(--font-mono)", opacity: 0.65 }}>
                        {mapCounts[key] || 0}
                      </span>
                    </Link>
                  );
                }
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                flexWrap: "wrap",
                padding: "0 18px 8px",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                Renewals due
              </span>
              {WINDOW_DEFS.map(([w, label]) => (
                <Link key={w} href={hrefFor({ win: w })} style={chipStyle(selWin === w)}>
                  {label}{" "}
                  <span style={{ opacity: 0.6 }}>
                    {allRenewals.filter((r) => inWin(r, w)).length}
                  </span>
                </Link>
              ))}
            </div>
            <div
              style={{
                padding: "0 18px 12px",
                fontSize: 11,
                color: "#aab0bb",
                lineHeight: 1.5,
              }}
            >
              Ringed venues are due for renewal in the selected window — either cadence.
            </div>
          </div>

          {/* by status */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              padding: "16px 18px",
            }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 13 }}>By status</div>
            {statusDefs.map((s) => (
              <div key={s.label} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 3,
                        flexShrink: 0,
                        background: s.dot,
                      }}
                    />
                    {s.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    {s.count}
                  </span>
                </div>
                <div
                  style={{
                    height: 7,
                    background: "#f1f2f5",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 6,
                      width: Math.round((s.count / maxC) * 100) + "%",
                      background: s.dot,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
