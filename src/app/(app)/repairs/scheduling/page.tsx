import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import {
  getAll,
  iso,
  msOf,
  money,
  fmtShort,
  priorityMeta,
  categoryMeta,
  jobCoords,
  stageMeta,
  type RepairJobRecord,
} from "@/lib/stores/repair-jobs";
import { RepairsMap } from "../controls";
import { scheduleRepair, unscheduleRepair } from "../actions";

export const metadata = { title: "Repair scheduler — Quartzite" };

const DAY = 86400000;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/** Day/month/relative badge for a scheduled ISO date (port of flame _schedMeta). */
function schedMeta(isoStr: string) {
  const ms = msOf(isoStr);
  if (ms == null) return { mon: "—", day: "", rel: "", overdue: false, dayColor: "#16181d" };
  const d = new Date(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getMonth()
  ];
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
  return { mon, day: String(d.getDate()), rel, overdue, dayColor: overdue ? "#b4543a" : "#16181d" };
}

const CSS = `
  .rp-sch-back:hover { color: #16181d !important; }
  @media (max-width: 940px) { .rp-sch-grid { grid-template-columns: 1fr !important; } }
`;

export default async function RepairSchedulingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, jobs, users] = await Promise.all([
    requireUser(),
    searchParams,
    getAll(),
    activeUsers(),
  ]);

  const scheduleId = one(sp.schedule);

  const approvedJobs = jobs.filter((j) => j.stage === "approved");
  const scheduledJobs = jobs
    .filter((j) => j.stage === "scheduled")
    .sort((a, b) => (msOf(a.scheduledDate) || 0) - (msOf(b.scheduledDate) || 0));

  const roster = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));
  const identityOf = (name: string) => {
    const u = users.find((x) => x.name === name);
    return {
      initials: u?.initials || deriveInitials(name || ""),
      color: u?.color || fallbackColor(name || ""),
    };
  };

  const total = approvedJobs.length + scheduledJobs.length;
  const standfirst = total
    ? approvedJobs.length + " to schedule · " + scheduledJobs.length + " booked"
    : "No approved repairs waiting — accepted repair quotes appear here.";

  /* ---- map pins: approved + scheduled ---- */
  const pins = jobs
    .filter((j) => j.stage === "approved" || j.stage === "scheduled")
    .map((j) => {
      const c = jobCoords(j);
      if (!c) return null;
      const when =
        j.stage === "scheduled"
          ? " — scheduled " + fmtShort(msOf(j.scheduledDate))
          : " — awaiting a date";
      return {
        id: j.id,
        lat: c.lat,
        lng: c.lng,
        color: j.stage === "scheduled" ? "#3155a8" : "#c98a2b",
        label: j.customer || "Venue",
        sub: (j.venue ? j.venue + " · " : "") + categoryMeta(j.category).short + when,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  /* ---- schedule popover data ---- */
  const popJob: RepairJobRecord | null = scheduleId
    ? jobs.find((j) => j.id === scheduleId) || null
    : null;
  const popMode = popJob && popJob.stage === "scheduled" ? "edit" : "new";
  const popDefaultDate =
    (popJob && popJob.scheduledDate) || iso(Date.now() + 7 * DAY);
  const popDefaultTech = (popJob && popJob.assignedTo) || (roster[0]?.name ?? "");
  const closeHref = "/repairs/scheduling";

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      <Link
        href="/repairs"
        className="rp-sch-back"
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
        ← Repairs
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
            Repair scheduler
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
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

      <div
        className="rp-sch-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 400px",
          gap: 18,
          alignItems: "start",
        }}
      >
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
            {approvedJobs.map((j) => {
              const pm = priorityMeta(j.priority);
              const detail = [j.venue, categoryMeta(j.category).short, money(j.value)]
                .filter(Boolean)
                .join(" · ");
              return (
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: pm.dot }}
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
                        {j.customer || "Customer"}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: pm.ink,
                          background: pm.soft,
                          border: `1px solid ${pm.bd}`,
                          padding: "2px 7px",
                          borderRadius: 5,
                          flexShrink: 0,
                        }}
                      >
                        {pm.label}
                      </span>
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
                      {j.title ? j.title + " · " + detail : detail}
                    </div>
                  </div>
                  <Link
                    href={"/repairs/scheduling?schedule=" + encodeURIComponent(j.id)}
                    scroll={false}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#fff",
                      background: "var(--accent)",
                      borderRadius: 9,
                      padding: "9px 14px",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Schedule
                  </Link>
                </div>
              );
            })}
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
                Nothing waiting. Accepted repair quotes land here to be scheduled.
              </div>
            )}
          </div>

          {/* scheduled */}
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
              const av = identityOf(j.assignedTo);
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
                          background: av.color,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {j.assignedTo ? av.initials : "?"}
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
                        {(j.assignedTo || "Unassigned") + " · " + (j.venue || "")}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <Link
                      href={"/repairs/scheduling?schedule=" + encodeURIComponent(j.id)}
                      scroll={false}
                      title="Change date or tech"
                      style={{
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
                        textDecoration: "none",
                      }}
                    >
                      Edit
                    </Link>
                    <Link
                      href={"/repairs/results?job=" + encodeURIComponent(j.id)}
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

        {/* RIGHT: map */}
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8c919c" }}>
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8c919c" }}>
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
            <RepairsMap pins={pins} />
            <div style={{ padding: "11px 18px", fontSize: 11, color: "#aab0bb", lineHeight: 1.5 }}>
              Every approved repair that hasn&apos;t been completed yet — plan the route before you
              book a day.
            </div>
          </div>
        </div>
      </div>

      {/* schedule popover (URL-state: ?schedule=<id>) */}
      {popJob && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,18,22,.4)",
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close"
            style={{ position: "absolute", inset: 0 }}
          />
          <div
            style={{
              position: "relative",
              width: 390,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 24px 60px rgba(0,0,0,.28)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid #f0f1f4" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {popMode === "edit" ? "Reschedule visit" : "Schedule repair"}
              </div>
              <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>
                {(popJob.customer || "") + " · " + (popJob.venue || "")}
              </div>
            </div>
            <form action={scheduleRepair}>
              <input type="hidden" name="id" value={popJob.id} />
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                <label style={{ display: "block" }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Visit date
                  </span>
                  <input
                    type="date"
                    name="scheduledDate"
                    defaultValue={popDefaultDate}
                    required
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13.5,
                      border: "1px solid #e4e7ec",
                      borderRadius: 10,
                      padding: "11px 12px",
                      outline: "none",
                      background: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Technician
                  </span>
                  <select
                    name="assignedTo"
                    defaultValue={popDefaultTech}
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-ui)",
                      fontSize: 13.5,
                      border: "1px solid #e4e7ec",
                      borderRadius: 10,
                      padding: "11px 12px",
                      outline: "none",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">Unassigned</option>
                    {roster.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 18px",
                  borderTop: "1px solid #f0f1f4",
                  background: "#fafbfc",
                }}
              >
                {popMode === "edit" && (
                  <button
                    type="submit"
                    formAction={unscheduleRepair}
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#b4543a",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "9px 4px",
                    }}
                  >
                    Unschedule
                  </button>
                )}
                <Link
                  href={closeHref}
                  scroll={false}
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 9,
                    padding: "10px 16px",
                    textDecoration: "none",
                  }}
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    cursor: "pointer",
                    background: "var(--accent)",
                  }}
                >
                  {popMode === "edit" ? "Save" : "Schedule visit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
