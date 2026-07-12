import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import {
  getAllProjects,
  syncProjectsFromQuotes,
  fmtDate,
  type ProjectRecord,
  type ProjectStage,
} from "@/lib/stores/projects";
import FieldWorkDetail, { type FieldIdentity } from "./controls";

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

export default async function FieldWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp] = await Promise.all([requireUser(), searchParams]);
  await syncProjectsFromQuotes();
  const [all, users] = await Promise.all([getAllProjects(), activeUsers()]);

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
  // The on-site captures are offline-capable, so the whole detail view is a
  // client component that owns the project record and saves every mutation
  // through the sync outbox. Identity (avatar initials + colour) is resolved
  // here since the DB-backed users store can't ship in the client bundle.
  const p = selObj;
  const tab = one(sp.tab);

  const identity: Record<string, FieldIdentity> = {};
  const addIdentity = (name: string) => {
    if (!name || identity[name]) return;
    const u = users.find((x) => x.name === name);
    identity[name] = {
      initials: u?.initials || deriveInitials(name),
      color: u?.color || fallbackColor(name),
    };
  };
  addIdentity(me.name);
  (p.notes || []).forEach((n) => addIdentity(n.by));
  (p.timeLogs || []).forEach((l) => addIdentity(l.person));

  return (
    <FieldWorkDetail project={p} meName={me.name} identity={identity} initialTab={tab} />
  );
}
