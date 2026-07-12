import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor, firstName } from "@/lib/team";
import {
  getAllProjects,
  syncProjectsFromQuotes,
  fmtDate,
  timeAgo,
  type ProjectRecord,
  type ProjectStage,
} from "@/lib/stores/projects";
import {
  toggleFieldTask,
  addFieldTask,
  postFieldNote,
  logFieldTime,
} from "./actions";

export const metadata = { title: "Field work — Peak Backend" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/** Stage chip palette — port of Field Work.dc.html stageMeta. */
const STAGE_META: Record<
  ProjectStage,
  { label: string; soft: string; ink: string; bd: string }
> = {
  procurement: { label: "Prep", soft: "#fbf3dd", ink: "#8a6d1f", bd: "#f0e2bd" },
  delivery: { label: "Awaiting delivery", soft: "#e9eefb", ink: "#3155a8", bd: "#d4ddf3" },
  scheduled: { label: "Scheduled", soft: "#efeaf6", ink: "#5b4b8a", bd: "#ddd3ec" },
  install: { label: "Installing", soft: "#fbeede", ink: "#9a5a1f", bd: "#f0dcc0" },
  training: { label: "Training", soft: "#e4f1f6", ink: "#1f6a8a", bd: "#c5e2ec" },
  signoff: { label: "Sign-off", soft: "#eaf6ef", ink: "#1f7a52", bd: "#cce9da" },
  complete: { label: "Complete", soft: "#f1f2f5", ink: "#5b616e", bd: "#e4e7ec" },
};

const LINE_STATUS_COLOR: Record<string, string> = {
  received: "#1f7a52",
  shipped: "#5b4b8a",
  ordered: "#3155a8",
  pending: "#9a6a1f",
};
const LINE_STATUS_LABEL: Record<string, string> = {
  received: "On site",
  shipped: "Shipped",
  ordered: "On order",
  pending: "Not ordered",
};

const TABS: Array<[string, string]> = [
  ["tasks", "Tasks"],
  ["notes", "Notes"],
  ["time", "Time"],
  ["bom", "BOM"],
];

const CSS = `
  .fw-tab:hover { color: #16181d; }
  .fw-card-link:hover { background: #fafbff; }
`;

function chip(stage: ProjectStage): React.CSSProperties {
  const m = STAGE_META[stage] || STAGE_META.procurement;
  return {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    color: m.ink,
    background: m.soft,
    border: `1px solid ${m.bd}`,
    padding: "2px 9px",
    borderRadius: 20,
  };
}

function chipDark(stage: ProjectStage): React.CSSProperties {
  const m = STAGE_META[stage] || STAGE_META.procurement;
  return {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    color: "#fff",
    background: m.ink,
    padding: "3px 10px",
    borderRadius: 20,
  };
}

const uppLabel: React.CSSProperties = {
  fontSize: 10,
  color: "#8b909a",
  textTransform: "uppercase",
  letterSpacing: ".05em",
};

export default async function FieldWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp] = await Promise.all([requireUser(), searchParams]);
  await syncProjectsFromQuotes();
  const [all, users] = await Promise.all([getAllProjects(), activeUsers()]);

  const identityOf = (name: string) => {
    const u = users.find((x) => x.name === name);
    return {
      initials: u?.initials || deriveInitials(name || ""),
      color: u?.color || fallbackColor(name || ""),
    };
  };

  const selId = one(sp.id);
  const selObj: ProjectRecord | null = selId
    ? all.find((p) => p.id === selId) || null
    : null;

  /* ---------------- LIST VIEW ---------------- */
  if (!selObj) {
    const fieldJobs = all
      .filter((p) => p.kind === "project" && p.stage !== "complete")
      .sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0));
    const onSiteCount = fieldJobs.filter(
      (p) => p.stage === "install" || p.stage === "training"
    ).length;
    const standfirst =
      fieldJobs.length +
      " active " +
      (fieldJobs.length === 1 ? "job" : "jobs") +
      (onSiteCount ? " · " + onSiteCount + " on site now" : "");

    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 80px" }}>
        <style>{CSS}</style>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>
            Field work
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 4 }}>{standfirst}</div>
        </div>

        {fieldJobs.map((p) => {
          const done = (p.tasks || []).filter((t) => t.done).length;
          const onSite = p.stage === "install" || p.stage === "training";
          return (
            <Link
              key={p.id}
              href={"/field-work?id=" + encodeURIComponent(p.id)}
              className="fw-card-link"
              style={{
                display: "block",
                background: "#fff",
                border: "1px solid #e7e9ee",
                borderRadius: 14,
                padding: "15px 16px",
                marginBottom: 11,
                textDecoration: "none",
                color: "inherit",
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
                <span style={chip(p.stage)}>{STAGE_META[p.stage]?.label || p.stage}</span>
                {onSite && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      color: "#9a5a1f",
                      background: "#fbeede",
                      border: "1px solid #f0dcc0",
                      padding: "2px 7px",
                      borderRadius: 5,
                    }}
                  >
                    ON SITE
                  </span>
                )}
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "#aab0bb",
                  }}
                >
                  {p.id}
                </span>
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</div>
              <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 3 }}>
                {p.customer || "—"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: "#f1f2f5",
                      color: "#5b616e",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                    }}
                  >
                    ✓
                  </span>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
                      {done + "/" + (p.tasks || []).length}
                    </div>
                    <div style={{ fontSize: 10, color: "#aab0bb" }}>tasks</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: "#f1f2f5",
                      color: "#5b616e",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                    }}
                  >
                    ◷
                  </span>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
                      {p.installStart ? fmtDate(p.installStart) : "TBD"}
                    </div>
                    <div style={{ fontSize: 10, color: "#aab0bb" }}>install</div>
                  </div>
                </div>
                <span style={{ marginLeft: "auto", color: "#c4c9d2", fontSize: 20 }}>›</span>
              </div>
            </Link>
          );
        })}

        {fieldJobs.length === 0 && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 14,
              padding: "34px 18px",
              textAlign: "center",
              color: "#9aa0ab",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            No field jobs scheduled.
            <br />
            <Link
              href="/projects"
              style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
            >
              Open Projects →
            </Link>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- JOB DETAIL VIEW ---------------- */
  const p = selObj;
  const tab = TABS.some((t) => t[0] === one(sp.tab)) ? one(sp.tab) : "tasks";
  const base = "/field-work?id=" + encodeURIComponent(p.id);

  const myLogs = (p.timeLogs || []).filter((l) => l.person === me.name);
  const myHours = myLogs.reduce((a, l) => a + (l.hours || 0), 0);
  const crewHours = (p.timeLogs || []).reduce((a, l) => a + (l.hours || 0), 0);

  // tasks grouped by section (insertion order preserved)
  const groupsMap: Record<string, typeof p.tasks> = {};
  const order: string[] = [];
  (p.tasks || []).forEach((t) => {
    if (!groupsMap[t.section]) {
      groupsMap[t.section] = [];
      order.push(t.section);
    }
    groupsMap[t.section].push(t);
  });

  const segStyle = (on: boolean): React.CSSProperties => ({
    flex: 1,
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "9px 6px",
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    textAlign: "center",
    textDecoration: "none",
    ...(on
      ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.1)" }
      : { background: "transparent", color: "#787d87" }),
  });

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 80px" }}>
      <style>{CSS}</style>

      <Link
        href="/field-work"
        className="fw-tab"
        style={{
          display: "inline-block",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--accent)",
          textDecoration: "none",
          padding: "2px 0 12px",
        }}
      >
        ‹ All field jobs
      </Link>

      {/* job header */}
      <div
        style={{
          background: "#16181d",
          color: "#fff",
          borderRadius: 16,
          padding: "17px 18px",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <span style={chipDark(p.stage)}>{STAGE_META[p.stage]?.label || p.stage}</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#8b909a",
            }}
          >
            {p.id}
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.25 }}>{p.name}</div>
        <div style={{ fontSize: 12.5, color: "#aab0bb", marginTop: 4 }}>{p.customer || "—"}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
          <div>
            <div style={uppLabel}>Install window</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
              {p.installStart ? fmtDate(p.installStart) + " – " + fmtDate(p.installEnd) : "TBD"}
            </div>
          </div>
          <div>
            <div style={uppLabel}>My hours</div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13.5,
                fontWeight: 600,
                marginTop: 3,
              }}
            >
              {myHours}h
            </div>
          </div>
          <Link
            href={"/projects?id=" + encodeURIComponent(p.id)}
            style={{
              marginLeft: "auto",
              alignSelf: "center",
              fontSize: 12,
              fontWeight: 600,
              color: "#cfd3da",
              textDecoration: "none",
              border: "1px solid #3a3e46",
              borderRadius: 8,
              padding: "7px 11px",
            }}
          >
            PM view
          </Link>
        </div>
      </div>

      {/* segmented tabs */}
      <div
        style={{
          display: "flex",
          background: "#e4e6ea",
          borderRadius: 11,
          padding: 3,
          marginBottom: 14,
        }}
      >
        {TABS.map(([k, label]) => (
          <Link key={k} href={base + "&tab=" + k} style={segStyle(tab === k)}>
            {label}
          </Link>
        ))}
      </div>

      {/* TASKS */}
      {tab === "tasks" && (
        <>
          {order.map((sec) => (
            <div key={sec}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9aa0ab",
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  margin: "6px 2px 8px",
                }}
              >
                {sec}
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e7e9ee",
                  borderRadius: 13,
                  overflow: "hidden",
                  marginBottom: 14,
                }}
              >
                {groupsMap[sec].map((t) => (
                  <form key={t.id} action={toggleFieldTask}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="taskId" value={t.id} />
                    <button
                      type="submit"
                      className="fw-card-link"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        width: "100%",
                        textAlign: "left",
                        padding: "14px 15px",
                        border: "none",
                        borderBottom: "1px solid #f3f4f7",
                        background: "transparent",
                        cursor: "pointer",
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 7,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 700,
                          flexShrink: 0,
                          marginTop: 1,
                          border: `2px solid ${t.done ? "var(--accent)" : "#cdd2da"}`,
                          background: t.done ? "var(--accent)" : "#fff",
                          color: "#fff",
                        }}
                      >
                        {t.done ? "✓" : ""}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 14,
                            fontWeight: 500,
                            lineHeight: 1.35,
                            ...(t.done
                              ? { textDecoration: "line-through", color: "#aab0bb" }
                              : { color: "#16181d" }),
                          }}
                        >
                          {t.title}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 11.5,
                            color: "#9aa0ab",
                            marginTop: 3,
                          }}
                        >
                          {(t.assignee ? firstName(t.assignee) : "Unassigned") +
                            (t.done && t.doneAt ? " · done " + timeAgo(t.doneAt) : "")}
                        </span>
                      </span>
                    </button>
                  </form>
                ))}
              </div>
            </div>
          ))}

          <form action={addFieldTask} style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <input type="hidden" name="id" value={p.id} />
            <input
              name="title"
              placeholder="Add a task…"
              style={{
                flex: 1,
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                border: "1px solid #e4e7ec",
                borderRadius: 10,
                padding: "12px 13px",
                outline: "none",
                background: "#fff",
              }}
            />
            <button
              type="submit"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                border: "none",
                padding: "0 18px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              Add
            </button>
          </form>
        </>
      )}

      {/* NOTES */}
      {tab === "notes" && (
        <>
          <form
            action={postFieldNote}
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "13px 14px",
              marginBottom: 14,
            }}
          >
            <input type="hidden" name="id" value={p.id} />
            <textarea
              name="text"
              placeholder="Log a field note — conditions, blockers, changes…"
              rows={3}
              style={{
                width: "100%",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                border: "none",
                outline: "none",
                resize: "vertical",
                color: "#16181d",
                background: "transparent",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid #f3f4f7",
              }}
            >
              <button
                type="submit"
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  border: "none",
                  padding: "9px 16px",
                  borderRadius: 9,
                  cursor: "pointer",
                }}
              >
                Post note
              </button>
            </div>
          </form>

          {(p.notes || []).map((n) => {
            const idn = identityOf(n.by);
            return (
              <div
                key={n.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e7e9ee",
                  borderRadius: 13,
                  padding: "13px 14px",
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: idn.color,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {idn.initials}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{firstName(n.by)}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#aab0bb" }}>
                    {timeAgo(n.at)}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "#2f333b" }}>{n.text}</div>
                {n.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={n.photo}
                    alt=""
                    style={{
                      marginTop: 10,
                      maxHeight: 200,
                      maxWidth: "100%",
                      borderRadius: 10,
                      display: "block",
                    }}
                  />
                )}
              </div>
            );
          })}
          {(p.notes || []).length === 0 && (
            <div
              style={{ textAlign: "center", color: "#9aa0ab", fontSize: 12.5, padding: 14 }}
            >
              No notes yet — log the first one above.
            </div>
          )}
        </>
      )}

      {/* TIME */}
      {tab === "time" && (
        <>
          <form
            action={logFieldTime}
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: 14,
              marginBottom: 14,
            }}
          >
            <input type="hidden" name="id" value={p.id} />
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 11 }}>
              Log hours — today
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                name="hours"
                inputMode="decimal"
                placeholder="Hrs"
                style={{
                  width: 74,
                  fontFamily: "var(--font-mono)",
                  fontSize: 15,
                  textAlign: "center",
                  border: "1px solid #e4e7ec",
                  borderRadius: 10,
                  padding: "12px 8px",
                  outline: "none",
                }}
              />
              <input
                name="note"
                placeholder="What you worked on"
                style={{
                  flex: 1,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13.5,
                  border: "1px solid #e4e7ec",
                  borderRadius: 10,
                  padding: "12px 13px",
                  outline: "none",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: "100%",
                marginTop: 11,
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                border: "none",
                padding: 12,
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              Log time
            </button>
          </form>

          <div style={{ display: "flex", gap: 11, marginBottom: 14 }}>
            <div
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #e7e9ee",
                borderRadius: 13,
                padding: "13px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600 }}>
                {myHours}h
              </div>
              <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 3 }}>my hours</div>
            </div>
            <div
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #e7e9ee",
                borderRadius: 13,
                padding: "13px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600 }}>
                {crewHours}h
              </div>
              <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 3 }}>crew total</div>
            </div>
          </div>

          {(p.timeLogs || [])
            .slice()
            .sort((a, b) => (b.date || 0) - (a.date || 0))
            .map((l) => {
              const idn = identityOf(l.person);
              return (
                <div
                  key={l.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    background: "#fff",
                    border: "1px solid #e7e9ee",
                    borderRadius: 11,
                    padding: "11px 13px",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: idn.color,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {idn.initials}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{firstName(l.person)}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#9aa0ab",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {l.note || "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600 }}
                    >
                      {l.hours}h
                    </div>
                    <div style={{ fontSize: 10, color: "#aab0bb" }}>{timeAgo(l.date)}</div>
                  </div>
                </div>
              );
            })}
          {(p.timeLogs || []).length === 0 && (
            <div style={{ textAlign: "center", color: "#9aa0ab", fontSize: 12.5, padding: 10 }}>
              No hours logged yet.
            </div>
          )}
        </>
      )}

      {/* BOM / PLAN */}
      {tab === "bom" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "#eef3f0",
              border: "1px solid #d6e6dd",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 13,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".06em",
                color: "#1f7a52",
                background: "#fff",
                border: "1px solid #cce9da",
                padding: "3px 7px",
                borderRadius: 5,
                fontFamily: "var(--font-mono)",
              }}
            >
              READ-ONLY
            </span>
            <span style={{ fontSize: 12, color: "#3a6650" }}>
              Bill of materials &amp; plan — view only on site.
            </span>
          </div>
          <Link
            href="/quick-design"
            className="fw-card-link"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "14px 15px",
              marginBottom: 13,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "#f1f2f5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                flexShrink: 0,
              }}
            >
              ◳
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Stage plan &amp; layout</div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Open the groundplan drawing
              </div>
            </div>
            <span style={{ color: "#c4c9d2", fontSize: 18 }}>›</span>
          </Link>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
                padding: "12px 15px 9px",
              }}
            >
              Bill of materials
            </div>
            {(p.procurement || []).map((l) => {
              const color = LINE_STATUS_COLOR[l.status] || "#9aa0ab";
              return (
                <div
                  key={l.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "11px 15px",
                    borderTop: "1px solid #f3f4f7",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: color,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{l.desc}</div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "#aab0bb",
                        marginTop: 2,
                      }}
                    >
                      {(l.sku || "—") + " · " + l.qty + " " + l.unit}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color, flexShrink: 0 }}>
                    {LINE_STATUS_LABEL[l.status] || l.status}
                  </span>
                </div>
              );
            })}
            {(p.procurement || []).length === 0 && (
              <div
                style={{
                  padding: "16px 15px",
                  fontSize: 12.5,
                  color: "#9aa0ab",
                  textAlign: "center",
                }}
              >
                No materials on this job.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
