import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  getAll,
  warrantyFollowUps,
  flaggedFromInspections,
  warrantyStatus,
  warrantyLabel,
  stageMeta,
  priorityMeta,
  categoryMeta,
  warrantyMeta,
  priorityFromSeverity,
  money,
  fmtShort,
  timeAgo,
  jobCoords,
  WARRANTY_LEAD_DAYS,
  type RepairJobRecord,
  type RepairStageKey,
  type WarrantyFollowUpRow,
} from "@/lib/stores/repair-jobs";
import { RepairsMap } from "./controls";

export const metadata = { title: "Repairs — Peak Backend" };

const YEAR_MS = 365 * 86400000;

const STAGE_ORDER: RepairStageKey[] = ["approved", "scheduled", "completed"];

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/** ?hide=approved,completed → set of hidden map stages. */
function hiddenSet(v: string): Set<string> {
  return new Set(
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

const CHIP: CSSProperties = {
  display: "inline-block",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  padding: "2px 8px",
  borderRadius: 5,
};

const CSS = `
  .rp-rowlink:hover { background: #fafbfc; }
  .rp-flaglink:hover { background: #faf9fb; }
  @media (max-width: 940px) {
    .rp-grid { grid-template-columns: 1fr !important; }
    .rp-kpis { grid-template-columns: 1fr 1fr !important; }
  }
`;

export default async function RepairsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, jobs, warrantyDue, flaggedAll] = await Promise.all([
    requireUser(),
    searchParams,
    getAll(),
    warrantyFollowUps({ dueOnly: true }),
    flaggedFromInspections(),
  ]);

  const filterParam = one(sp.filter);
  const filter = (STAGE_ORDER as string[]).includes(filterParam)
    ? (filterParam as RepairStageKey)
    : "all";
  const flagParam = one(sp.flag);
  const flag =
    flagParam === "urgent" || flagParam === "standard" ? flagParam : "all";
  const hidden = hiddenSet(one(sp.hide));

  const hrefFor = (over: {
    filter?: string;
    flag?: string;
    hide?: string;
  }) => {
    const qs = new URLSearchParams();
    const f = over.filter ?? filter;
    const fl = over.flag ?? flag;
    const hd = over.hide ?? one(sp.hide);
    if (f && f !== "all") qs.set("filter", f);
    if (fl && fl !== "all") qs.set("flag", fl);
    if (hd) qs.set("hide", hd);
    const s = qs.toString();
    return "/repairs" + (s ? "?" + s : "");
  };

  /* ---- counts ---- */
  const cnt: Record<string, number> = { approved: 0, scheduled: 0, completed: 0 };
  jobs.forEach((j) => {
    cnt[j.stage] = (cnt[j.stage] || 0) + 1;
  });
  const active = cnt.approved + cnt.scheduled;
  const completed12 = jobs.filter(
    (j) => j.stage === "completed" && j.completedAt && Date.now() - j.completedAt <= YEAR_MS
  ).length;
  const openJobs = jobs.filter((j) => j.stage === "approved" || j.stage === "scheduled");
  const emergencyOpen = openJobs.filter((j) => j.priority === "emergency").length;
  const urgentOpen = openJobs.filter((j) => j.priority === "urgent").length;

  const warrExpired = warrantyDue.filter((r) => r._warranty.state === "expired").length;
  const warrEnding = warrantyDue.filter((r) => r._warranty.state === "expiring").length;
  const warrTotal = warrantyDue.length;

  /* ---- KPI tiles (Repairs.dc.html) ---- */
  const kpis = [
    {
      label: "Active repairs",
      value: String(active),
      color: "#16181d",
      bar: "var(--accent)",
      sub: cnt.scheduled + " scheduled · " + cnt.approved + " to schedule",
    },
    {
      label: "Awaiting schedule",
      value: String(cnt.approved),
      color: cnt.approved ? "#9a6a1f" : "#16181d",
      bar: "#c98a2b",
      sub: "approved, no date yet",
    },
    {
      label: "Priority open",
      value: String(emergencyOpen + urgentOpen),
      color: emergencyOpen ? "#8a2f22" : urgentOpen ? "#b4543a" : "#16181d",
      bar: emergencyOpen ? "#8a2f22" : "#b4543a",
      sub: emergencyOpen + " emergency · " + urgentOpen + " urgent",
    },
    {
      label: "Warranty follow-ups",
      value: String(warrTotal),
      color: warrExpired ? "#b4543a" : warrTotal ? "#9a6a1f" : "#16181d",
      bar: warrExpired ? "#b4543a" : "#c98a2b",
      sub: warrExpired
        ? warrExpired + " lapsed · " + warrEnding + " ending"
        : "within " + WARRANTY_LEAD_DAYS + " days",
    },
  ];

  const standfirst =
    jobs.length +
    " repair" +
    (jobs.length === 1 ? "" : "s") +
    " tracked · " +
    active +
    " active · " +
    (warrTotal
      ? warrTotal + " warranty follow-up" + (warrTotal === 1 ? "" : "s")
      : completed12 + " completed this year");

  /* ---- flagged from inspections (intake) ---- */
  const flagCountFor = (k: string) =>
    k === "all"
      ? flaggedAll.length
      : flaggedAll.filter((x) => priorityFromSeverity(x.log.severity) === k).length;
  const flaggedFilterDefs: Array<[string, string]> = [
    ["all", "All"],
    ["urgent", "Urgent"],
    ["standard", "Standard"],
  ];
  const flaggedShown =
    flag === "all"
      ? flaggedAll
      : flaggedAll.filter((x) => priorityFromSeverity(x.log.severity) === flag);
  const flaggedUrgent = flaggedAll.some((x) => x.log.severity === "urgent");

  /* ---- work list ---- */
  const filterDefs: Array<[string, string, number]> = [
    ["all", "All", jobs.length],
    ["approved", "Approved", cnt.approved],
    ["scheduled", "Scheduled", cnt.scheduled],
    ["completed", "Completed", cnt.completed],
  ];
  const rows = jobs
    .filter((r) => filter === "all" || r.stage === filter)
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const rowHref = (r: RepairJobRecord) =>
    r.stage === "approved"
      ? "/repairs/scheduling"
      : "/repairs/results?job=" + encodeURIComponent(r.id);

  /* ---- by-status summary ---- */
  const statusDefs = [
    { label: "Approved", count: cnt.approved, dot: stageMeta("approved").dot },
    { label: "Scheduled", count: cnt.scheduled, dot: stageMeta("scheduled").dot },
    { label: "Completed", count: cnt.completed, dot: stageMeta("completed").dot },
    { label: "Emergency (open)", count: emergencyOpen, dot: priorityMeta("emergency").dot },
    { label: "Warranty ending", count: warrTotal, dot: warrantyMeta("expiring").dot },
  ];
  const maxC = Math.max(1, ...statusDefs.map((d) => d.count));

  /* ---- map pins ---- */
  const pins = jobs
    .filter((j) => !hidden.has(j.stage))
    .map((j) => {
      const c = jobCoords(j);
      if (!c) return null;
      const sm = stageMeta(j.stage);
      const cat = categoryMeta(j.category);
      const ws = warrantyStatus(j);
      const ring = j.stage === "completed" && (ws.state === "expired" || ws.state === "expiring");
      let when = " — awaiting scheduling";
      if (j.stage === "completed") when = " — completed " + fmtShort(j.completedAt);
      else if (j.stage === "scheduled") when = " — scheduled";
      return {
        id: j.id,
        lat: c.lat,
        lng: c.lng,
        color: sm.dot,
        ring,
        label: j.customer || "Venue",
        sub: (j.venue ? j.venue + " · " : "") + cat.short + " (" + sm.label + ")" + when,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const mapCounts: Record<string, number> = { approved: 0, scheduled: 0, completed: 0 };
  jobs.forEach((j) => {
    if (jobCoords(j)) mapCounts[j.stage] = (mapCounts[j.stage] || 0) + 1;
  });
  const mappableTotal = mapCounts.approved + mapCounts.scheduled + mapCounts.completed;
  const legendDefs: Array<[RepairStageKey, string]> = [
    ["completed", "Completed"],
    ["scheduled", "Scheduled"],
    ["approved", "Approved"],
  ];

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
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Repairs</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Link
            href="/repairs/scheduling"
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
            href="/repairs/quote"
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
            + New repair
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div
        className="rp-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 13,
          marginBottom: 18,
        }}
      >
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
            <div
              style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: k.bar }}
            />
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
      <div
        className="rp-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 400px",
          gap: 18,
          alignItems: "start",
        }}
      >
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* flagged from inspections */}
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
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Flagged from inspections</div>
                {flaggedAll.length > 0 && (
                  <span
                    style={{
                      display: "inline-block",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                      background: flaggedUrgent ? "#b4543a" : "#c98a2b",
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {flaggedAll.length} open
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>Open findings · needs a quote</div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                padding: "12px 20px 8px",
              }}
            >
              {flaggedFilterDefs.map(([key, label]) => {
                const on = flag === key;
                return (
                  <Link
                    key={key}
                    href={hrefFor({ flag: key })}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      padding: "6px 12px",
                      borderRadius: 20,
                      textDecoration: "none",
                      border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                      background: on ? "var(--accent)" : "#fff",
                      color: on ? "#fff" : "#5b616e",
                    }}
                  >
                    {label} <span style={{ opacity: 0.6 }}>{flagCountFor(key)}</span>
                  </Link>
                );
              })}
            </div>
            {flaggedShown.slice(0, 8).map((x) => {
              const pr = priorityFromSeverity(x.log.severity);
              const m = priorityMeta(pr);
              const detail = [x.rec.customer, x.rec.venue, x.log.location].filter(Boolean).join(" · ");
              return (
                <div
                  key={x.rec.id + "#" + x.log.id}
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
                    href={"/inspections?id=" + encodeURIComponent(x.rec.id)}
                    title="Open the inspection"
                    className="rp-flaglink"
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
                        {x.log.problem || "Repair"}
                      </span>
                      <span style={{ ...CHIP, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, flexShrink: 0 }}>
                        {m.label}
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
                      {detail} · <span style={{ color: "#b3b8c1" }}>open inspection ›</span>
                    </div>
                  </Link>
                  <Link
                    href={
                      "/repairs/quote?inspection=" +
                      encodeURIComponent(x.rec.id) +
                      "&log=" +
                      encodeURIComponent(String(x.log.id)) +
                      (x.rec.customerId
                        ? "&customer=" + encodeURIComponent(x.rec.customerId)
                        : "")
                    }
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
                      flexShrink: 0,
                    }}
                  >
                    Quote repair
                  </Link>
                </div>
              );
            })}
            {flaggedShown.length === 0 && (
              <div
                style={{
                  padding: "26px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {flag === "all"
                  ? "No open inspection findings need a repair quote right now."
                  : "No " + flag + "-priority findings open."}
              </div>
            )}
          </div>

          {/* all repairs */}
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
                padding: "15px 20px 12px",
              }}
            >
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>All repairs</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 20px 13px" }}>
              {filterDefs.map(([key, label, count]) => {
                const on = filter === key;
                return (
                  <Link
                    key={key}
                    href={hrefFor({ filter: key })}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      padding: "6px 12px",
                      borderRadius: 20,
                      textDecoration: "none",
                      border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                      background: on ? "var(--accent)" : "#fff",
                      color: on ? "#fff" : "#5b616e",
                    }}
                  >
                    {label} <span style={{ opacity: 0.6 }}>{count}</span>
                  </Link>
                );
              })}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 120px 96px 78px",
                gap: 12,
                padding: "0 20px 8px",
                fontSize: 10,
                fontWeight: 600,
                color: "#aab0bb",
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              <span>Repair</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Value</span>
              <span style={{ textAlign: "right" }}>Updated</span>
            </div>
            {rows.map((r) => {
              const sm = stageMeta(r.stage);
              const pm = priorityMeta(r.priority);
              const cat = categoryMeta(r.category);
              const sub = [r.customer, r.venue, cat.short].filter(Boolean).join(" · ");
              return (
                <div
                  key={r.id}
                  className="rp-rowlink"
                  style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 120px 96px 78px",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 20px",
                    borderTop: "1px solid #f3f4f7",
                    color: "#16181d",
                    textDecoration: "none",
                  }}
                >
                  <Link
                    href={rowHref(r)}
                    aria-label="Open repair"
                    style={{ position: "absolute", inset: 0, zIndex: 1 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          flexShrink: 0,
                          background: pm.dot,
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
                        {r.title || cat.label}
                      </span>
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
                      {sub}
                    </div>
                  </div>
                  <span>
                    <span style={{ ...CHIP, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}` }}>
                      {sm.label}
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
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
                      {timeAgo(r.updatedAt)}
                    </div>
                    {r.stage === "completed" && (
                      <Link
                        href={"/repairs/report?job=" + encodeURIComponent(r.id)}
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
                No repairs in this view.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* map */}
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
                padding: "15px 18px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Repair locations</div>
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
                {pins.length} mapped
              </span>
            </div>
            <RepairsMap pins={pins} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                flexWrap: "wrap",
                padding: "11px 18px 9px",
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
                  marginRight: 1,
                }}
              >
                Status
              </span>
              {legendDefs.map(([key, label]) => {
                const isOn = !hidden.has(key);
                const nextHide = new Set(hidden);
                if (isOn) nextHide.add(key);
                else nextHide.delete(key);
                const m = stageMeta(key);
                return (
                  <Link
                    key={key}
                    href={hrefFor({ hide: Array.from(nextHide).join(",") })}
                    title={(isOn ? "Hide " : "Show ") + label.toLowerCase() + " repairs"}
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
                    {label}{" "}
                    <span style={{ fontFamily: "var(--font-mono)", opacity: 0.65 }}>
                      {mapCounts[key] || 0}
                    </span>
                  </Link>
                );
              })}
              {mappableTotal === 0 && (
                <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>No repairs to map yet.</span>
              )}
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
            {statusDefs.map((d) => (
              <div key={d.label} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
                    <span
                      style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: d.dot }}
                    />
                    {d.label}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
                    {d.count}
                  </span>
                </div>
                <div style={{ height: 7, background: "#f1f2f5", borderRadius: 6, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 6,
                      width: Math.round((d.count / maxC) * 100) + "%",
                      background: d.dot,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* warranty follow-ups */}
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
                padding: "15px 18px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Warranty follow-ups</div>
                {warrTotal > 0 && (
                  <span
                    style={{
                      display: "inline-block",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                      background: warrExpired ? "#b4543a" : "#c98a2b",
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {warrExpired ? warrExpired + " lapsed" : warrTotal + " ending"}
                  </span>
                )}
              </div>
            </div>
            {warrantyDue.slice(0, 6).map((r: WarrantyFollowUpRow) => {
              const ws = r._warranty;
              const m = warrantyMeta(ws.state);
              const email = r.contact?.email || "";
              const subject = encodeURIComponent("Warranty follow-up — " + (r.customer || ""));
              const body = encodeURIComponent(
                "Hi " +
                  (r.contact?.name || "there") +
                  ",\n\nOur records show the " +
                  (r.title || "repair") +
                  " we completed at " +
                  (r.customer || "your venue") +
                  " (" +
                  (r.venue || "") +
                  ") is " +
                  warrantyLabel(ws.days, ws.state) +
                  ". Would you like us to schedule a check-up or re-quote any further work?\n\nThanks,"
              );
              const mailto = email
                ? "mailto:" + email + "?subject=" + subject + "&body=" + body
                : "#";
              return (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "12px 18px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: m.dot }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          lineHeight: 1.25,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.customer || "Customer"}
                      </span>
                      <span style={{ ...CHIP, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, flexShrink: 0 }}>
                        {warrantyLabel(ws.days, ws.state)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#9aa0ab",
                        marginTop: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(r.venue || "") + " · completed " + fmtShort(r.completedAt)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                    <a
                      href={mailto}
                      title="Email the contact"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        border: "1px solid #e4e7ec",
                        background: "#fff",
                        color: "#5b616e",
                        textDecoration: "none",
                        fontSize: 14,
                      }}
                    >
                      ✉
                    </a>
                    <Link
                      href={
                        "/repairs/quote" +
                        (r.customerId
                          ? "?customer=" + encodeURIComponent(r.customerId)
                          : "")
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "color-mix(in srgb, var(--accent) 72%, #000)",
                        background: "var(--accent-soft)",
                        border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
                        borderRadius: 9,
                        padding: "8px 11px",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Re-quote
                    </Link>
                  </div>
                </div>
              );
            })}
            {warrantyDue.length === 0 && (
              <div
                style={{
                  padding: "24px 18px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                }}
              >
                No warranties ending soon. Completed repairs stay covered for their warranty window.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
