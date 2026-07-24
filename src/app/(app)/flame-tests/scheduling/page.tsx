import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  getAll,
  jobCoords,
  iso,
  msOf,
  fmtShort,
  money,
  type FlameJob,
} from "@/lib/stores/flame-jobs";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import { FlameMap } from "../controls";
import { ScheduleButton } from "./controls";
import type { MapPin } from "@/components/map/LeafletMap";

export const metadata = { title: "Flame test scheduler — Quartzite" };

const DAY = 86400000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Port of the prototype's _schedMeta: date tile + relative label. */
function schedMeta(isoStr: string) {
  const ms = msOf(isoStr);
  if (ms == null)
    return { mon: "—", day: "", rel: "", overdue: false, dayColor: "#16181d" };
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((ms - today.getTime()) / DAY);
  let rel: string;
  let overdue = false;
  if (diff < 0) {
    rel = Math.abs(diff) + "d overdue";
    overdue = true;
  } else if (diff === 0) rel = "today";
  else if (diff === 1) rel = "tomorrow";
  else if (diff < 14) rel = "in " + diff + "d";
  else rel = fmtShort(ms);
  return {
    mon: MON[d.getMonth()],
    day: String(d.getDate()),
    rel,
    overdue,
    dayColor: overdue ? "#b4543a" : "#16181d",
  };
}

const CSS = `
  .fts-grid { display: grid; grid-template-columns: minmax(0,1fr) 400px; gap: 18px; align-items: start; }
  @media (max-width: 940px) { .fts-grid { grid-template-columns: 1fr !important; } }
`;

export default async function FlameSchedulingPage() {
  const [, jobs, roster] = await Promise.all([requireUser(), getAll(), activeUsers()]);

  const identity = new Map(roster.map((u) => [u.name, { color: u.color, initials: u.initials }]));
  const initialsOf = (n: string) => identity.get(n)?.initials || deriveInitials(n || "");
  const colorOf = (n: string) => identity.get(n)?.color || fallbackColor(n || "");
  const techOptions = roster.map((u) => u.name);
  const defaultTech = techOptions[0] || "";

  const approvedJobs = jobs.filter((j) => j.stage === "approved");
  const scheduledJobs = jobs
    .filter((j) => j.stage === "scheduled")
    .sort((a, b) => (msOf(a.scheduledDate) || 0) - (msOf(b.scheduledDate) || 0));

  /* ---- map pins: approved (amber) + scheduled (blue) ---- */
  const pins: MapPin[] = [];
  jobs
    .filter((j) => j.stage === "approved" || j.stage === "scheduled")
    .forEach((j: FlameJob) => {
      const c = jobCoords(j);
      if (!c) return;
      const when =
        j.stage === "scheduled"
          ? " — scheduled " + fmtShort(msOf(j.scheduledDate))
          : " — awaiting a date";
      pins.push({
        id: j.id,
        lat: c.lat,
        lng: c.lng,
        color: j.stage === "scheduled" ? "#3155a8" : "#c98a2b",
        label: j.customer || "Venue",
        sub: (j.venue || "") + when,
      });
    });

  const total = approvedJobs.length + scheduledJobs.length;
  const standfirst = total
    ? approvedJobs.length + " to schedule · " + scheduledJobs.length + " booked"
    : "No approved flame tests waiting — accepted quotes appear here.";

  const scheduleTrigger: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#fff",
    background: "var(--accent)",
    border: "none",
    borderRadius: 9,
    padding: "9px 14px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-ui)",
  };
  const editTrigger: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 34,
    padding: "0 11px",
    fontSize: 12,
    fontWeight: 600,
    color: "#5b616e",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      <Link
        href="/flame-tests"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        ← Flame tests
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
            Flame test scheduler
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
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

      <div className="fts-grid">
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* to schedule */}
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
                gap: 9,
                padding: "15px 20px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#c98a2b" }} />
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>To schedule</div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
                {approvedJobs.length}
              </span>
            </div>
            {approvedJobs.map((j) => (
              <div
                key={j.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "13px 20px",
                  borderBottom: "1px solid #f5f6f8",
                }}
              >
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
                    {j.customer || "Customer"}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "#9aa0ab",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {j.venue +
                      (j.curtainsTotal ? " · " + j.curtainsTotal + " curtains" : "") +
                      " · " +
                      money(j.value)}
                  </div>
                </div>
                <ScheduleButton
                  jobId={j.id}
                  mode="new"
                  customer={j.customer || "Customer"}
                  venue={j.venue || ""}
                  defaultDate={j.scheduledDate || iso(Date.now() + 7 * DAY)}
                  defaultTech={j.assignedTo || defaultTech}
                  techOptions={techOptions}
                  triggerLabel="Schedule"
                  triggerStyle={scheduleTrigger}
                />
              </div>
            ))}
            {approvedJobs.length === 0 && (
              <div
                style={{
                  padding: "26px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                Nothing waiting. Accepted flame-test quotes land here to be scheduled.
              </div>
            )}
          </div>

          {/* scheduled agenda */}
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
                gap: 9,
                padding: "15px 20px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3155a8" }} />
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Scheduled</div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
                {scheduledJobs.length}
              </span>
            </div>
            {scheduledJobs.map((j) => {
              const sm = schedMeta(j.scheduledDate);
              return (
                <div
                  key={j.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "64px minmax(0,1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "13px 20px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {sm.mon}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 20,
                        fontWeight: 600,
                        lineHeight: 1.05,
                        color: sm.dayColor,
                      }}
                    >
                      {sm.day}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                        {j.customer || "Customer"}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          padding: "1px 6px",
                          borderRadius: 4,
                          flexShrink: 0,
                          color: sm.overdue ? "#b4543a" : "#3155a8",
                          background: sm.overdue ? "#f7e9e5" : "#e9eefb",
                        }}
                      >
                        {sm.rel}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          background: j.assignedTo ? colorOf(j.assignedTo) : "#8c919c",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {j.assignedTo ? initialsOf(j.assignedTo) : "?"}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          color: "#9aa0ab",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {(j.assignedTo || "Unassigned") + " · " + j.venue}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <ScheduleButton
                      jobId={j.id}
                      mode="edit"
                      customer={j.customer || "Customer"}
                      venue={j.venue || ""}
                      defaultDate={j.scheduledDate || iso(Date.now() + 7 * DAY)}
                      defaultTech={j.assignedTo || defaultTech}
                      techOptions={techOptions}
                      triggerLabel="Edit"
                      triggerStyle={editTrigger}
                    />
                    <Link
                      href={"/flame-tests/results?job=" + encodeURIComponent(j.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#1f7a52",
                        borderRadius: 9,
                        padding: "9px 13px",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Log results
                    </Link>
                  </div>
                </div>
              );
            })}
            {scheduledJobs.length === 0 && (
              <div
                style={{
                  padding: "26px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                No visits on the calendar yet.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "15px 18px 13px", borderBottom: "1px solid #f0f1f4" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Approved &amp; scheduled</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "#8c919c",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "#c98a2b",
                      border: "2px solid #fff",
                      boxShadow: "0 0 0 1px #c98a2b",
                    }}
                  />
                  To schedule
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "#8c919c",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "#3155a8",
                      border: "2px solid #fff",
                      boxShadow: "0 0 0 1px #3155a8",
                    }}
                  />
                  Scheduled
                </span>
              </div>
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
                  No approved or scheduled tests to map.
                </div>
              )}
            </div>
            <div style={{ padding: "11px 18px", fontSize: 11, color: "#aab0bb", lineHeight: 1.5 }}>
              Every approved test that hasn’t been completed yet — plan the route before you book a
              day.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
