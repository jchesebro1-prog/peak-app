import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  getAll,
  renewals,
  renewalMeta,
  stageMeta,
  jobCoords,
  dueAtOf,
  msOf,
  fmtShort,
  fmtLong,
  money,
  timeAgo,
  dueLabel,
  RENEWAL_LEAD_DAYS,
  type FlameJob,
  type FlameJobStage,
} from "@/lib/stores/flame-jobs";
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { all as allCustomers } from "@/lib/stores/customers";
import { FlameMap } from "./controls";
import {
  markFlameRenewalOutreach,
  startFlameRenewalOutreach,
} from "./actions";
import type { MapPin } from "@/components/map/LeafletMap";

export const metadata = { title: "Flame tests — Quartzite" };

const DAY = 86400000;
const YEAR = 365 * DAY;

/* ---- local stage meta including the "quoted" pre-job row (dashboard only) ---- */

type RowStage = "quoted" | FlameJobStage;

const QUOTED_META = {
  label: "Quoted",
  ink: "#5b616e",
  soft: "#f1f2f5",
  bd: "#e4e7ec",
  dot: "#8c919c",
};

function localStage(k: RowStage) {
  return k === "quoted" ? QUOTED_META : stageMeta(k);
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* renewal window presets shared by the renewals card + map chips */
const WINDOW_DEFS: Array<[number, string]> = [
  [-30, "−30d"],
  [30, "+30d"],
  [60, "+60d"],
  [90, "+90d"],
];

const STATUS_KEYS = ["approved", "scheduled", "completed"] as const;

const CSS = `
  .ftd-grid { display: grid; grid-template-columns: minmax(0,1fr) 400px; gap: 18px; align-items: start; }
  .ftd-kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 13px; }
  .ftd-rowlink:hover { background: #fafbfc; }
  .ftd-renewrow:hover .ftd-renewhit { background: #faf9fb; }
  @media (max-width: 940px) {
    .ftd-grid { grid-template-columns: 1fr !important; }
    .ftd-kpis { grid-template-columns: 1fr 1fr !important; }
  }
`;

export default async function FlameTestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, jobs, quotes, customers] = await Promise.all([
    requireUser(),
    searchParams,
    getAll(),
    allQuotes(),
    allCustomers(),
  ]);

  const custById = new Map(customers.map((c) => [c.id, c.name || ""]));
  const nameFor = (id: string | null) => (id ? custById.get(id) || "" : "");


  /* ---- URL state: status filter + renewal window + map status visibility ---- */
  const filterParam = one(sp.filter) as RowStage | "all" | "";
  const filter: RowStage | "all" =
    filterParam === "quoted" ||
    filterParam === "approved" ||
    filterParam === "scheduled" ||
    filterParam === "completed"
      ? filterParam
      : "all";

  const winParam = parseInt(one(sp.win), 10);
  const selWin = [-30, 30, 60, 90].includes(winParam) ? winParam : 60;

  // renewals sub-view (IDEAS #37): to-contact worklist vs. reached-out
  const rvView = one(sp.rv) === "awaiting" ? "awaiting" : "contact";

  // hidden map statuses (comma list); default all visible
  const hidden = new Set(one(sp.hide).split(",").filter(Boolean));
  const statusOn = (k: FlameJobStage) => !hidden.has(k);

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
    return "/flame-tests" + (s ? "?" + s : "");
  };

  /* ---- open flame-test quotes without a job yet (the "quoted" rows) ---- */
  const haveQ = new Set<string>();
  jobs.forEach((j) => {
    if (j.quoteId) haveQ.add(j.quoteId);
  });
  const openQuotes = quotes.filter(
    (q: Quote) =>
      q.quoteType === "flame_test" &&
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

  const allRows: Row[] = [];
  openQuotes.forEach((q) =>
    allRows.push({
      key: "q-" + q.id,
      stage: "quoted",
      id: q.id,
      customer: q.customer || nameFor(q.customerId) || "Customer",
      sub: q.name || "Flame test quote",
      value: q.value || 0,
      updatedAt: q.updatedAt || q.createdAt || 0,
      href: "/flame-tests/quote?id=" + encodeURIComponent(q.id),
      isCompleted: false,
    })
  );
  jobs.forEach((j) =>
    allRows.push({
      key: "j-" + j.id,
      stage: j.stage,
      id: j.id,
      customer: j.customer || "Customer",
      sub: j.venue + (j.curtainsTotal ? " · " + j.curtainsTotal + " curtains" : ""),
      value: j.value || 0,
      updatedAt: j.updatedAt || 0,
      href:
        j.stage === "approved"
          ? "/flame-tests/scheduling"
          : "/flame-tests/results?job=" + encodeURIComponent(j.id),
      isCompleted: j.stage === "completed",
    })
  );

  const cnt: Record<RowStage, number> = {
    quoted: 0,
    approved: 0,
    scheduled: 0,
    completed: 0,
  };
  allRows.forEach((r) => {
    cnt[r.stage] = (cnt[r.stage] || 0) + 1;
  });
  const active = cnt.approved + cnt.scheduled;
  const completed12 = jobs.filter(
    (j) => j.stage === "completed" && j.completedAt && Date.now() - j.completedAt <= YEAR
  ).length;

  /* day-of quick-start (IDEAS #34): scheduled visits due today or overdue */
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const dueTodayCount = jobs.filter(
    (j) =>
      j.stage === "scheduled" &&
      msOf(j.scheduledDate) != null &&
      (msOf(j.scheduledDate) || 0) <= endOfToday.getTime()
  ).length;

  /* ---- renewals ---- */
  const dueRows = await renewals({ dueOnly: true });
  const overdueCount = dueRows.filter((r) => r._renewal.state === "overdue").length;
  const dueSoonCount = dueRows.filter((r) => r._renewal.state === "due_soon").length;
  const dueTotal = dueRows.length;

  const allRenewals = await renewals({});
  const winCutoff = (w: number) => Date.now() + w * DAY;
  const inWin = (r: FlameJob, w: number) => {
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
      label: "Active tests",
      value: String(active),
      color: "#16181d",
      barStyle: bar("var(--accent)"),
      sub: cnt.scheduled + " scheduled · " + cnt.approved + " to schedule",
    },
    {
      label: "Awaiting schedule",
      value: String(cnt.approved),
      color: cnt.approved ? "#9a6a1f" : "#16181d",
      barStyle: bar("#c98a2b"),
      sub: "accepted, no date yet",
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
      label: "Completed",
      value: String(completed12),
      color: "#1f7a52",
      barStyle: bar("#1f7a52"),
      sub: "last 12 months",
    },
  ];

  /* ---- all-tests filter chips ---- */
  const filterDefs: Array<[RowStage | "all", string, number]> = [
    ["all", "All", allRows.length],
    ["quoted", "Quoted", cnt.quoted],
    ["approved", "Approved", cnt.approved],
    ["scheduled", "Scheduled", cnt.scheduled],
    ["completed", "Completed", cnt.completed],
  ];
  let rows = allRows.slice();
  if (filter !== "all") rows = rows.filter((r) => r.stage === filter);
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  /* ---- by-status bars ---- */
  const passedCount = jobs.filter(
    (j) => j.stage === "completed" && j.results && j.results.overall === "pass"
  ).length;
  const statusDefs = [
    { label: "Quoted", count: cnt.quoted, dot: localStage("quoted").dot },
    { label: "Approved", count: cnt.approved, dot: localStage("approved").dot },
    { label: "Scheduled", count: cnt.scheduled, dot: localStage("scheduled").dot },
    { label: "Completed", count: cnt.completed, dot: localStage("completed").dot },
    { label: "Passed", count: passedCount, dot: "#2e9e6b" },
    { label: "Overdue", count: overdueCount, dot: renewalMeta("overdue").dot },
  ];
  const maxC = Math.max(1, ...statusDefs.map((d) => d.count));

  /* ---- map pins (mappable jobs, respecting status visibility) ---- */
  const renewalByKey: Record<string, string> = {};
  windowRows.forEach((r) => {
    const c = jobCoords(r);
    if (c) renewalByKey[c.lat.toFixed(3) + "," + c.lng.toFixed(3)] = r._renewal.state;
  });
  const mapCounts: Record<FlameJobStage, number> = {
    approved: 0,
    scheduled: 0,
    completed: 0,
  };
  const pins: MapPin[] = [];
  jobs
    .filter((j) => STATUS_KEYS.includes(j.stage as (typeof STATUS_KEYS)[number]))
    .forEach((j) => {
      const c = jobCoords(j);
      if (!c) return;
      mapCounts[j.stage] = (mapCounts[j.stage] || 0) + 1;
      if (!statusOn(j.stage)) return;
      const m = stageMeta(j.stage);
      const rKey = c.lat.toFixed(3) + "," + c.lng.toFixed(3);
      const rState = renewalByKey[rKey];
      const rMeta = rState ? renewalMeta(rState) : null;
      let when = " — awaiting scheduling";
      if (j.stage === "completed") when = " — completed " + fmtShort(j.completedAt);
      pins.push({
        id: j.id,
        lat: c.lat,
        lng: c.lng,
        color: rMeta ? rMeta.dot : m.dot,
        ring: !!rMeta,
        label: j.customer || "Venue",
        sub: (j.venue || "") + when,
      });
    });
  const visibleCount = STATUS_KEYS.reduce(
    (a, k) => a + (statusOn(k) ? mapCounts[k] || 0 : 0),
    0
  );
  const anyMappable = STATUS_KEYS.reduce((a, k) => a + (mapCounts[k] || 0), 0) > 0;

  const totalTests = allRows.length;
  const standfirst =
    totalTests +
    " flame test" +
    (totalTests === 1 ? "" : "s") +
    " tracked · " +
    (dueTotal ? dueTotal + " due for annual renewal" : "all current on the annual cycle");

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
            Flame tests
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Link
            href="/field-work"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "#1f7a52",
              borderRadius: 10,
              padding: "10px 15px",
              textDecoration: "none",
            }}
          >
            Log results{dueTodayCount ? " · " + dueTodayCount : ""}
          </Link>
          <Link
            href="/flame-tests/scheduling"
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
            href="/flame-tests/quote"
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
            + New flame test
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="ftd-kpis" style={{ marginBottom: 18 }}>
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
      <div className="ftd-grid">
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
              <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>Annual · NFPA 705</div>
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
              Due on or before {fmtLong(winCutoff(selWin))}
              {rvView === "contact"
                ? " · not yet contacted this cycle"
                : " · contacted, no new test booked yet"}
            </div>
            {shownRows.map((r) => {
              const rs = r._renewal;
              const m = renewalMeta(rs.state);
              const renewHref =
                "/flame-tests/quote" +
                (r.customerId ? "?customer=" + encodeURIComponent(r.customerId) : "");
              return (
                <div
                  key={r.id}
                  className="ftd-renewrow"
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
                    href={"/flame-tests/results?job=" + encodeURIComponent(r.id)}
                    title="View last year's results"
                    className="ftd-renewhit"
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
                      {(r.venue || "") + " · last tested " + fmtShort(r.completedAt)} ·{" "}
                      <span style={{ color: "#b3b8c1" }}>last year&#39;s results ›</span>
                    </div>
                  </Link>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {rvView === "contact" ? (
                      <>
                        {/* IDEAS #36 — one-click outreach with standard
                            language (rules-based per D75; wording editable in
                            /templates): quote re-priced at current rates,
                            PDF attached, composer opens */}
                        <form action={startFlameRenewalOutreach}>
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
                        <form action={markFlameRenewalOutreach}>
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
                        <form action={markFlameRenewalOutreach}>
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

          {/* all flame tests */}
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
              All flame tests
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
              <span>Test</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Value</span>
              <span style={{ textAlign: "right" }}>Updated</span>
            </div>
            {rows.map((r) => {
              const m = localStage(r.stage);
              return (
                <div
                  key={r.key}
                  className="ftd-rowlink"
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
                    aria-label="Open test"
                    style={{ position: "absolute", inset: 0, zIndex: 1 }}
                  />
                  <div style={{ minWidth: 0, position: "relative" }}>
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
                    }}
                  >
                    {money(r.value)}
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
                        href={"/flame-tests/report?job=" + encodeURIComponent(r.id)}
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
                No flame tests in this view.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* test locations map */}
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
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Test locations</div>
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
              <FlameMap pins={pins} height={340} />
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
                  }}
                >
                  {anyMappable
                    ? "No statuses selected — tap one below to show pins."
                    : "No active or completed tests to map yet."}
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
              {(["completed", "scheduled", "approved"] as FlameJobStage[]).map((key) => {
                const m = stageMeta(key);
                const isOn = statusOn(key);
                const nextHidden = new Set(hidden);
                if (isOn) nextHidden.add(key);
                else nextHidden.delete(key);
                return (
                  <Link
                    key={key}
                    href={hrefFor({ hide: Array.from(nextHidden).join(",") })}
                    title={(isOn ? "Hide " : "Show ") + m.label.toLowerCase() + " tests"}
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
                        background: m.dot,
                        opacity: isOn ? 1 : 0.3,
                      }}
                    />
                    {m.label}{" "}
                    <span style={{ fontFamily: "var(--font-mono)", opacity: 0.65 }}>
                      {mapCounts[key] || 0}
                    </span>
                  </Link>
                );
              })}
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
              Ringed venues are due for renewal in the selected window.
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
