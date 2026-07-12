import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  getAll,
  counts,
  stageMeta,
  severityMeta,
  timeAgo,
  fmtLong,
  STAGES,
  type InspectionRecord,
  type InspectionStageKey,
} from "@/lib/stores/inspections";
import { firstName } from "@/lib/team";
import { createInspection } from "./actions";

export const metadata = { title: "Rigging Inspections — Peak Backend" };

/* accent-derived tints (prototype color-mix over the office accent) */
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 13%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";

/* device-sync badge meta (Inspections.dc.html syncMeta) */
const SYNC_META: Record<string, { ink: string; soft: string; bd: string; label: string }> = {
  pending: { ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", label: "On device" },
  syncing: { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", label: "Syncing…" },
  synced: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", label: "Synced" },
  error: { ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", label: "Retry" },
};
function syncMeta(st: string | null | undefined) {
  return SYNC_META[st || ""] || { ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", label: st || "" };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .in-rail::-webkit-scrollbar { display: none; }
  .in-rail { -ms-overflow-style: none; scrollbar-width: none; }
  .in-newbtn:hover { filter: brightness(1.06); }
  .in-card-edit:hover { border-color: #c4c9d2; }
  .in-card-report:hover { filter: brightness(.98); }
  @media (max-width: 720px) {
    .in-pad { padding-left: 15px !important; padding-right: 15px !important; }
    .in-head { flex-direction: column !important; align-items: stretch !important; }
    .in-newbtn { width: 100%; justify-content: center; }
    .in-stats { grid-template-columns: repeat(2, 1fr) !important; }
  }
`;

const EMPTY_BY_FILTER: Record<string, [string, string]> = {
  all: ["No inspections yet", "Create your first rigging inspection, or open a sample report to see the finished deliverable."],
  requested: ["No requested inspections", "Requests waiting to be scheduled will appear here."],
  scheduled: ["Nothing scheduled", "Assigned, dated inspections show up here."],
  onsite: ["No inspections on site", "Inspections being captured in the field appear here."],
  completed: ["No completed inspections", "Finished inspections ready to issue as a report land here."],
};

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, all] = await Promise.all([requireUser(), searchParams, getAll()]);

  const filterParam = one(sp.filter);
  const filter: string = (STAGES as ReadonlyArray<{ key: string }>).some((s) => s.key === filterParam)
    ? filterParam
    : "all";

  const stageOf = (x: InspectionRecord) => x.stage || "requested";
  const stageCount = (k: InspectionStageKey) => all.filter((x) => stageOf(x) === k).length;
  const openInspections = all.filter((x) => stageOf(x) !== "completed");
  const totalUrgent = all.reduce((a, x) => a + counts(x).urgent.open, 0);
  const completed = all.filter((x) => x.stage === "completed");

  const stats = [
    { label: "Active", value: String(openInspections.length), sub: "in progress", ink: "#16181d" },
    { label: "Urgent open", value: String(totalUrgent), sub: "across all sites", ink: "#b4543a" },
    { label: "Completed", value: String(completed.length), sub: "ready to issue", ink: "#1f7a52" },
    { label: "Requested", value: String(stageCount("requested")), sub: "awaiting schedule", ink: "#8a6d1f" },
  ];

  const filterDefs: Array<[string, string]> = [
    ["all", "All"],
    ["requested", "Requested"],
    ["scheduled", "Scheduled"],
    ["onsite", "On-site"],
    ["completed", "Completed"],
  ];
  const hrefFor = (key: string) => "/inspections" + (key === "all" ? "" : `?filter=${key}`);
  const countFor = (key: string) => (key === "all" ? all.length : stageCount(key as InspectionStageKey));

  const filtered = all.filter((x) => filter === "all" || stageOf(x) === filter);
  const emp = EMPTY_BY_FILTER[filter] || EMPTY_BY_FILTER.all;
  const standfirst =
    openInspections.length + " active · " + totalUrgent + " urgent open · " + completed.length + " completed";

  return (
    <div className="pk-content in-pad">
      <style>{CSS}</style>

      {/* header */}
      <div
        className="in-head"
        style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 18 }}
      >
        <div>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Rigging inspections</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>{standfirst}</div>
        </div>
        <form action={createInspection} style={{ flexShrink: 0 }}>
          <button
            type="submit"
            className="in-newbtn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              padding: "12px 17px",
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 1px 3px var(--accent-soft)",
              fontFamily: "var(--font-ui)",
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New inspection
          </button>
        </form>
      </div>

      {/* stat tiles */}
      <div
        className="in-stats"
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 13, marginBottom: 20 }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 12,
              padding: "15px 16px",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
              {s.label}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 23, fontWeight: 600, letterSpacing: "-.01em", marginTop: 9, color: s.ink }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 6 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* filter pills */}
      <div
        className="in-rail"
        style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 2 }}
      >
        {filterDefs.map(([key, label]) => {
          const active = filter === key;
          return (
            <Link
              key={key}
              href={hrefFor(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                fontWeight: 600,
                padding: "9px 14px",
                borderRadius: 9,
                border: active ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                whiteSpace: "nowrap",
                minHeight: 40,
                flexShrink: 0,
                textDecoration: "none",
                background: active ? "var(--accent)" : "#fff",
                color: active ? "#fff" : "#5b616e",
              }}
            >
              {label}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 9,
                  background: active ? "rgba(255,255,255,.22)" : "#f1f2f5",
                  color: active ? "#fff" : "#9aa0ab",
                }}
              >
                {countFor(key)}
              </span>
            </Link>
          );
        })}
      </div>

      {/* inspection cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((x) => {
          const sm = stageMeta(stageOf(x));
          const cnt = counts(x);
          const stage = stageOf(x);
          const sy = syncMeta(x.syncState);
          const isCompleted = stage === "completed";
          const um = severityMeta("urgent");
          const nm = severityMeta("necessary");
          const bm = severityMeta("basic");
          const tallies = [
            { n: cnt.urgent.open, label: "Urg", m: um },
            { n: cnt.necessary.open, label: "Nec", m: nm },
            { n: cnt.basic.open, label: "Bas", m: bm },
          ];
          let sub: string;
          let metaLine: string;
          if (stage === "requested") {
            sub = "requested " + timeAgo(x.requestedAt);
            metaLine = "Requested by " + firstName(x.requestedBy) + (x.contact ? " · contact " + x.contact : "");
          } else if (stage === "scheduled") {
            sub = x.venueType || "inspection";
            metaLine =
              (x.assignedTo ? firstName(x.assignedTo) + " assigned" : "Unassigned") +
              (x.scheduledDate ? " · " + fmtLong(x.scheduledDate) : "");
          } else if (stage === "onsite") {
            sub = "capture in progress";
            metaLine = (x.inspector ? firstName(x.inspector) + " on site" : "On site") + " · " + cnt.total + " logs so far";
          } else {
            sub = cnt.total + " findings";
            metaLine = "Surveyed " + fmtLong(x.surveyDate) + (x.reportDate ? " · reported " + fmtLong(x.reportDate) : "");
          }
          const editLabel = isCompleted ? "Open inspection" : stage === "requested" ? "Open brief" : "Open capture";
          const canReport = isCompleted || cnt.total > 0;

          return (
            <div
              key={x.id}
              style={{
                background: "#fff",
                border: "1px solid #e7e9ee",
                borderRadius: 14,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "16px 18px", flexWrap: "wrap", rowGap: 12 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 600,
                        color: sm.ink,
                        background: sm.soft,
                        border: `1px solid ${sm.bd}`,
                        padding: "3px 10px",
                        borderRadius: 20,
                      }}
                    >
                      {sm.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: ".04em",
                        color: sy.ink,
                        background: sy.soft,
                        border: `1px solid ${sy.bd}`,
                        padding: "2px 7px",
                        borderRadius: 5,
                      }}
                    >
                      {sy.label}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>{x.id}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>{x.venue || "—"}</div>
                  <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 3 }}>
                    {(x.customer || "—") + " · " + sub}
                  </div>
                  {metaLine && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 9 }}>{metaLine}</div>}
                </div>

                {cnt.total > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {tallies.map((t) => (
                      <div
                        key={t.label}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          minWidth: 44,
                          padding: "8px 6px",
                          borderRadius: 8,
                          border: `1px solid ${t.m.bd}`,
                          background: t.m.soft,
                          color: t.m.ink,
                        }}
                      >
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600 }}>{t.n}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", marginTop: 2 }}>
                          {t.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 18px",
                  borderTop: "1px solid #f3f4f7",
                  background: "#fbfbfc",
                  flexWrap: "wrap",
                  rowGap: 8,
                }}
              >
                <Link
                  href={`/inspections/${encodeURIComponent(x.id)}`}
                  className="in-card-edit"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#5b616e",
                    textDecoration: "none",
                    padding: "9px 14px",
                    borderRadius: 8,
                    border: "1px solid #e4e7ec",
                    background: "#fff",
                  }}
                >
                  {editLabel}
                </Link>
                {canReport && (
                  <Link
                    href={`/inspections/${encodeURIComponent(x.id)}/report`}
                    className="in-card-report"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: ACCENT_INK,
                      background: ACCENT_SOFT,
                      border: `1px solid ${ACCENT_BORDER_LT}`,
                      padding: "9px 14px",
                      borderRadius: 8,
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>⎙</span> View report
                  </Link>
                )}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#aab0bb" }}>Updated {timeAgo(x.updatedAt)}</span>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ background: "#fff", border: "1px solid #e7e9ee", borderRadius: 14, padding: "44px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>{emp[0]}</div>
            <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.6 }}>{emp[1]}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <form action={createInspection}>
                <button
                  type="submit"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--accent)",
                    padding: "11px 17px",
                    borderRadius: 9,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  + New inspection
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
