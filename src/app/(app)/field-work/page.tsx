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
import { loadServiceWork } from "@/lib/operations-work-server";
import { WORK_TYPE_META, startOfDay, type WorkItem } from "@/lib/operations-work";
import FieldWorkDetail, { type FieldIdentity } from "./controls";

export const metadata = { title: "Field work — Quartzite-6" };

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

/** Shared card wrapper for both project and service rows (D100 unified day-view). */
const CARD_LINK_STYLE: React.CSSProperties = {
  display: "block",
  background: "#fff",
  border: "1px solid #e7e9ee",
  borderRadius: 14,
  padding: "15px 16px",
  marginBottom: 11,
  textDecoration: "none",
  color: "inherit",
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
};

/** Work-type chip for service rows — same shape/size as chip(), sourced from WORK_TYPE_META. */
function svcChip(type: WorkItem["type"]): React.CSSProperties {
  const m = WORK_TYPE_META[type];
  return {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    color: m.color,
    background: m.soft,
    border: `1px solid ${m.color}33`,
    padding: "2px 9px",
    borderRadius: 20,
  };
}

/**
 * A project counts as "mine today" when the signed-in person is on a crew
 * booking whose inclusive span covers today (and the project isn't complete).
 * `meName: null` = team scope (D113.10): anyone's booking counts.
 */
function myProjectToday(p: ProjectRecord, meName: string | null, todayMs: number): boolean {
  if (p.kind !== "project" || p.stage === "complete") return false;
  return p.crew.some(
    (c) =>
      (meName === null || c.person === meName) &&
      startOfDay(c.start) <= todayMs &&
      startOfDay(c.end) >= todayMs,
  );
}

/** Crew names on site for a project today — shown in team scope. */
function crewToday(p: ProjectRecord, todayMs: number): string[] {
  return [
    ...new Set(
      p.crew
        .filter((c) => startOfDay(c.start) <= todayMs && startOfDay(c.end) >= todayMs)
        .map((c) => c.person)
        .filter(Boolean),
    ),
  ];
}

export default async function FieldWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp] = await Promise.all([requireUser(), searchParams]);
  await syncProjectsFromQuotes();
  const [all, users, serviceWork] = await Promise.all([
    getAllProjects(),
    activeUsers(),
    loadServiceWork(),
  ]);

  const selId = one(sp.id);
  const selObj: ProjectRecord | null = selId
    ? all.find((p) => p.id === selId) || null
    : null;

  /* ---------------- LIST VIEW ---------------- */
  if (!selObj) {
    const today = startOfDay(Date.now());
    /** Team scope (D113.10): the whole crew's day, default stays personal. */
    const teamScope = one(sp.scope) === "team";

    /** Due now: today or overdue-and-still-live (unset dates excluded upstream). */
    const myService = serviceWork.filter(
      (w) => (teamScope || w.assignee === me.name) && startOfDay(w.startMs) <= today,
    );

    const fieldJobs = all
      .filter((p) => myProjectToday(p, teamScope ? null : me.name, today))
      .sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0));
    const onSiteCount = fieldJobs.filter(
      (p) => p.stage === "install" || p.stage === "training"
    ).length;

    type DayRow = { day: number; node: React.ReactNode };

    const projectRows: DayRow[] = fieldJobs.map((p) => {
      const done = (p.tasks || []).filter((t) => t.done).length;
      const onSite = p.stage === "install" || p.stage === "training";
      return {
        day: p.installStart || p.targetDate || today,
        node: (
          <Link
            key={"project:" + p.id}
            href={"/field-work?id=" + encodeURIComponent(p.id)}
            className="fw-card-link"
            style={CARD_LINK_STYLE}
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
              {teamScope && crewToday(p, today).length > 0 && (
                <span style={{ color: "#5b616e" }}> · {crewToday(p, today).join(", ")}</span>
              )}
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
        ),
      };
    });

    const serviceRows: DayRow[] = myService.map((w) => ({
      day: w.startMs,
      node: (
        <Link
          key={"service:" + w.type + ":" + w.id}
          href={w.href}
          className="fw-card-link"
          style={CARD_LINK_STYLE}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
            <span style={svcChip(w.type)}>{WORK_TYPE_META[w.type].label}</span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "#aab0bb",
              }}
            >
              {w.id}
            </span>
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{w.title}</div>
          <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 3 }}>
            {w.subtitle || "—"}
            {teamScope && (
              <span style={{ color: "#5b616e" }}> · {w.assignee || "Unassigned"}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
            <span style={{ marginLeft: "auto", color: "#c4c9d2", fontSize: 20 }}>›</span>
          </div>
        </Link>
      ),
    }));

    const rows = [...projectRows, ...serviceRows].sort((a, b) => a.day - b.day);

    const standfirst =
      rows.length +
      " " +
      (rows.length === 1 ? "job" : "jobs") +
      " today" +
      (teamScope ? " across the team" : "") +
      (onSiteCount ? " · " + onSiteCount + " on site now" : "");

    const scopeTab = (label: string, href: string, on: boolean) => (
      <Link
        href={href}
        style={{
          fontSize: 12,
          fontWeight: 600,
          textDecoration: "none",
          padding: "4px 11px",
          borderRadius: 999,
          color: on ? "#fff" : "#5b616e",
          background: on ? "#16181d" : "#f1f2f5",
        }}
      >
        {label}
      </Link>
    );

    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 80px" }}>
        <style>{CSS}</style>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em", marginRight: "auto" }}>
              Field work
            </div>
            {scopeTab("Mine", "/field-work", !teamScope)}
            {scopeTab("Whole team", "/field-work?scope=team", teamScope)}
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 4 }}>{standfirst}</div>
        </div>

        {rows.map((r) => r.node)}

        {rows.length === 0 && (
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
            Nothing due today.
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
