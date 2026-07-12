import Link from "next/link";
import type { CSSProperties } from "react";
import { firstName, deriveInitials, fallbackColor } from "@/lib/team";
import {
  stagesFor,
  stageIndex,
  progressPct,
  procurementProgress,
  riskFlags,
  criticalLineId,
  lineLate,
  orderByDate,
  daysUntil,
  fmtDate,
  fmtDateY,
  timeAgo,
  STAGING_BUFFER,
  type ProjectRecord,
  type ProjectStage,
  type ProjectKind,
  type LineStatus,
  type DeliveryStatus,
  type QuoteLike,
} from "@/lib/stores/projects";
import {
  setStageAction,
  cycleLineAction,
  cycleDeliveryAction,
  addCrewAction,
  removeCrewAction,
  signoffAction,
  startConversionAction,
} from "./actions";

/* ---------------- design tokens (accent via CSS vars, never hardcoded) ---------------- */

const ACCENT = "var(--accent)";
const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
const ACCENT_BD = "color-mix(in srgb, var(--accent) 30%, #fff)";
const DAY = 86400000;

export const PROJECTS_CSS = `
  .pm-grid { display: grid; grid-template-columns: 360px minmax(0,1fr); gap: 18px; align-items: start; }
  .pm-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 13px; }
  .pm-listcard:hover { border-color: #c4c9d2; }
  .pm-back { display: none; }
  .pm-rowscroll::-webkit-scrollbar { display: none; }
  .pm-rowscroll { -ms-overflow-style: none; scrollbar-width: none; }
  @media (max-width: 900px) {
    .pm-grid { grid-template-columns: 1fr !important; }
    .pm-stats { grid-template-columns: 1fr 1fr !important; }
    .pm-back { display: inline-block; }
  }
`;

/* ---------------- meta tables (ported verbatim from project.js view-model) ---------------- */

type Meta = { label: string; ink: string; soft: string; bd: string };

const STAGE_META: Record<string, Meta> = {
  procurement: { label: "Materials", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  delivery: { label: "Deliveries", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  scheduled: { label: "Crew scheduled", ink: "#5b4b8a", soft: "#efeaf6", bd: "#ddd3ec" },
  install: { label: "Installing", ink: "#9a5a1f", soft: "#fbeede", bd: "#f0dcc0" },
  training: { label: "Training", ink: "#1f6a8a", soft: "#e4f1f6", bd: "#c5e2ec" },
  signoff: { label: "Sign-off", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  complete: { label: "Complete", ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec" },
};

const LINE_META: Record<LineStatus, Meta> = {
  pending: { label: "Pending", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  ordered: { label: "Ordered", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  shipped: { label: "Shipped", ink: "#5b4b8a", soft: "#efeaf6", bd: "#ddd3ec" },
  received: { label: "Received", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};
const LINE_CYCLE: Record<LineStatus, LineStatus> = {
  pending: "ordered",
  ordered: "shipped",
  shipped: "received",
  received: "pending",
};

const DEL_META: Record<DeliveryStatus, Meta> = {
  scheduled: { label: "Scheduled", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  in_transit: { label: "In transit", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  received: { label: "Received", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};
const DEL_CYCLE: Record<DeliveryStatus, DeliveryStatus> = {
  scheduled: "in_transit",
  in_transit: "received",
  received: "scheduled",
};

function kindBadgeStyle(kind: ProjectKind): CSSProperties {
  const base: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: ".07em",
    padding: "2px 7px",
    borderRadius: 5,
  };
  return kind === "order"
    ? { ...base, color: "#3155a8", background: "#e9eefb", border: "1px solid #d4ddf3" }
    : { ...base, color: ACCENT_INK, background: ACCENT_SOFT, border: "1px solid " + ACCENT_BD };
}
const kindLabel = (k: ProjectKind) => (k === "order" ? "ORDER" : "PROJECT");

function stagePill(stage: string): { label: string; style: CSSProperties } {
  const m = STAGE_META[stage] || STAGE_META.procurement;
  return {
    label: m.label,
    style: {
      display: "inline-block",
      fontSize: 10,
      fontWeight: 600,
      color: m.ink,
      background: m.soft,
      border: "1px solid " + m.bd,
      padding: "2px 9px",
      borderRadius: 20,
    },
  };
}
const barColorFor = (stage: string) =>
  stage === "complete"
    ? "#9aa0ab"
    : stage === "install" || stage === "training" || stage === "signoff"
      ? ACCENT
      : "#c9b24f";

/* ---------------- money helpers (ported) ---------------- */

function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function shortMoney(n: number | null | undefined): string {
  const v = Math.round(n || 0);
  const a = Math.abs(v);
  if (a < 1000) return "$" + v;
  if (a < 1000000) return "$" + (v / 1000).toFixed(a >= 100000 ? 0 : 1) + "K";
  return "$" + (v / 1000000).toFixed(2) + "m";
}

/* ---------------- identity ---------------- */

export type Identity = { name: string; color: string; initials: string };

function makeIdentityLookup(identity: Identity[]) {
  const m = new Map(identity.map((u) => [u.name, u]));
  return {
    colorOf: (n: string) => m.get(n)?.color || fallbackColor(n || ""),
    initialsOf: (n: string) => m.get(n)?.initials || deriveInitials(n || ""),
  };
}

/* ---------------- href builders ---------------- */

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? "?" + s : "";
}

/* =====================================================================
   Main view — used by both /projects (no selection) and /projects/[id].
   ===================================================================== */

export function ProjectsView({
  projects,
  pending,
  sel,
  filter,
  tab,
  custById,
  identity,
  roster,
}: {
  projects: ProjectRecord[];
  pending: QuoteLike[];
  sel: ProjectRecord | null;
  filter: string;
  tab: string;
  custById: Map<string, string>;
  identity: Identity[];
  roster: string[];
}) {
  const custName = (p: { customerId: string | null; customer: string }) =>
    (p.customerId && custById.get(p.customerId)) || p.customer || "—";

  const active = projects.filter((p) => p.stage !== "complete");
  const activeValue = active.reduce((a, p) => a + (p.value || 0), 0);
  const atRisk = active.filter((p) => riskFlags(p).length);
  const installing = projects.filter((p) => p.stage === "install" || p.stage === "training");

  const stats = [
    { label: "Active", value: String(active.length), sub: shortMoney(activeValue) + " in delivery", color: "#16181d" },
    { label: "In install", value: String(installing.length), sub: "crews on site", color: "#16181d" },
    {
      label: "At risk",
      value: String(atRisk.length),
      sub: atRisk.length ? "late orders / no crew" : "all on track",
      color: atRisk.length ? "#b4543a" : "#16181d",
    },
    {
      label: "Awaiting start",
      value: String(pending.length),
      sub: "won, not converted",
      color: pending.length ? ACCENT_INK : "#16181d",
    },
  ];

  const counts: Record<string, number> = {
    active: active.length,
    risk: atRisk.length,
    orders: projects.filter((p) => p.kind === "order").length,
    complete: projects.filter((p) => p.stage === "complete").length,
    all: projects.length,
  };
  const filterDefs: Array<[string, string]> = [
    ["active", "Active"],
    ["risk", "At risk"],
    ["orders", "Orders"],
    ["complete", "Complete"],
    ["all", "All"],
  ];

  let listSrc = projects;
  if (filter === "active") listSrc = active;
  else if (filter === "risk") listSrc = atRisk;
  else if (filter === "orders") listSrc = projects.filter((p) => p.kind === "order");
  else if (filter === "complete") listSrc = projects.filter((p) => p.stage === "complete");

  const curPath = sel ? "/projects/" + encodeURIComponent(sel.id) : "/projects";
  const filterHref = (key: string) =>
    curPath + qs({ filter: key === "active" ? undefined : key, tab: sel && tab !== "overview" ? tab : undefined });
  const cardHref = (id: string) =>
    "/projects/" + encodeURIComponent(id) + qs({ filter: filter === "active" ? undefined : filter });

  const standfirst =
    active.length + " active · " + shortMoney(activeValue) + " in delivery · " + atRisk.length + " need attention";

  return (
    <div className="pk-content">
      <style>{PROJECTS_CSS}</style>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Projects</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0, flexWrap: "wrap" }}>
          <Link
            href="/schedule"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "#16181d",
              border: "1px solid #16181d",
              padding: "11px 15px",
              borderRadius: 9,
              textDecoration: "none",
            }}
          >
            Open scheduler →
          </Link>
          <Link
            href="/quotes"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#3a3f4a",
              background: "#fff",
              border: "1px solid #e4e7ec",
              padding: "11px 15px",
              borderRadius: 9,
              textDecoration: "none",
            }}
          >
            Won quotes →
          </Link>
        </div>
      </div>

      {/* stat tiles */}
      <div className="pm-stats" style={{ marginBottom: 18 }}>
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
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 23,
                fontWeight: 600,
                letterSpacing: "-.01em",
                marginTop: 9,
                color: s.color,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 6 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* won — ready to start */}
      {pending.length > 0 && (
        <div
          style={{
            background: "#fff",
            border: "1px solid " + ACCENT_BD,
            borderRadius: 12,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            overflow: "hidden",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "13px 16px",
              borderBottom: "1px solid #f0f1f4",
              background: ACCENT_SOFT,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: ACCENT_INK }}>Won — ready to start</span>
            <span style={{ fontSize: 12, color: "#7a7f8a" }}>
              A won quote becomes a project when it has install labor, or a sales order when it&#39;s materials only.
            </span>
          </div>
          {pending.map((q) => (
            <div
              key={q.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid #f5f6f8",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {q.name}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3 }}>
                  {q.id} · {custName({ customerId: q.customerId ?? null, customer: q.customer ?? "" })} · {money(q.value)}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#1f7a52",
                  background: "#eaf6ef",
                  border: "1px solid #cce9da",
                  padding: "3px 9px",
                  borderRadius: 20,
                  flexShrink: 0,
                }}
              >
                WON
              </span>
              <form action={startConversionAction} style={{ margin: 0, flexShrink: 0 }}>
                <input type="hidden" name="quoteId" value={q.id} />
                <button
                  type="submit"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#fff",
                    background: ACCENT,
                    border: "none",
                    padding: "9px 14px",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Start project
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {/* filters */}
      <div
        className="pm-rowscroll"
        style={{
          display: "flex",
          background: "#eceef1",
          borderRadius: 9,
          padding: 3,
          marginBottom: 14,
          width: "max-content",
          maxWidth: "100%",
          overflowX: "auto",
        }}
      >
        {filterDefs.map(([key, label]) => {
          const on = filter === key;
          return (
            <Link
              key={key}
              href={filterHref(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
                padding: "7px 13px",
                borderRadius: 7,
                textDecoration: "none",
                ...(on
                  ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                  : { background: "transparent", color: "#787d87" }),
              }}
            >
              {label}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: on ? ACCENT_INK : "#aab0bb",
                  background: on ? ACCENT_SOFT : "#e9ebef",
                  padding: "0 5px",
                  borderRadius: 9,
                }}
              >
                {counts[key]}
              </span>
            </Link>
          );
        })}
      </div>

      {/* master-detail */}
      <div className="pm-grid">
        {/* LEFT: list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {listSrc.map((p) => {
            const sp = stagePill(p.stage);
            const isSel = sel != null && p.id === sel.id;
            const risks = riskFlags(p);
            const due = daysUntil(p.targetDate);
            const pct = progressPct(p);
            const dueLabel =
              p.stage === "complete"
                ? "Closed " + fmtDate(p.updatedAt)
                : due < 0
                  ? Math.abs(due) + "d overdue"
                  : due === 0
                    ? "Due today"
                    : "Due in " + due + "d";
            return (
              <Link
                key={p.id}
                href={cardHref(p.id)}
                className="pm-listcard"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "left",
                  width: "100%",
                  background: "#fff",
                  border: "1px solid " + (isSel ? "var(--accent)" : "#ececf0"),
                  borderRadius: 12,
                  padding: "13px 15px",
                  textDecoration: "none",
                  color: "#16181d",
                  boxShadow: isSel ? "0 2px 10px var(--accent-soft)" : "0 1px 2px rgba(0,0,0,.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={kindBadgeStyle(p.kind)}>{kindLabel(p.kind)}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb" }}>{p.id}</span>
                  {risks.length > 0 && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: "#b4543a",
                        background: "#f7e9e5",
                        border: "1px solid #f0d6cd",
                        padding: "2px 7px",
                        borderRadius: 5,
                      }}
                    >
                      {risks.length + (risks.length === 1 ? " flag" : " flags")}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    marginTop: 9,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.name}
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
                  {custName(p)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                  <div style={{ flex: 1, height: 5, background: "#eef0f3", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: pct + "%", height: "100%", background: barColorFor(p.stage) }} />
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9aa0ab" }}>{pct}%</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginTop: 9,
                  }}
                >
                  <span style={sp.style}>{sp.label}</span>
                  <span style={{ fontSize: 11, color: "#9aa0ab" }}>{dueLabel}</span>
                </div>
              </Link>
            );
          })}
          {listSrc.length === 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #ececf0",
                borderRadius: 12,
                padding: "30px 18px",
                textAlign: "center",
                color: "#9aa0ab",
                fontSize: 13,
              }}
            >
              No projects in this view.
            </div>
          )}
        </div>

        {/* RIGHT: detail */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 14,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            overflow: "hidden",
            minHeight: 420,
          }}
        >
          {sel ? (
            <ProjectDetail
              p={sel}
              tab={tab}
              filter={filter}
              custName={custName(sel)}
              identity={identity}
              roster={roster}
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                height: 420,
                color: "#9aa0ab",
                textAlign: "center",
                padding: "0 24px",
              }}
            >
              <span
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: "#f1f2f5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                ◷
              </span>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#5b616e" }}>Select a project</div>
              <div style={{ fontSize: 12.5, maxWidth: 240, lineHeight: 1.5 }}>
                Pick a job on the left to track procurement, deliveries, crew and sign-off.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   Detail pane
   ===================================================================== */

function ProjectDetail({
  p,
  tab,
  filter,
  custName,
  identity,
  roster,
}: {
  p: ProjectRecord;
  tab: string;
  filter: string;
  custName: string;
  identity: Identity[];
  roster: string[];
}) {
  const { colorOf, initialsOf } = makeIdentityLookup(identity);
  const stages = stagesFor(p.kind);
  const curIdx = stageIndex(p.kind, p.stage);
  const isOrder = p.kind === "order";
  const isDone = p.stage === "complete";

  const due = daysUntil(p.targetDate);
  const dueBig = isDone ? "Done" : due < 0 ? Math.abs(due) + "d late" : due + "d";
  const dueColor = isDone ? "#5b616e" : due < 0 ? "#b4543a" : due <= 7 ? "#9a6a1f" : "#16181d";
  const dueSub = isDone ? "closed out" : isOrder ? "to delivery" : "to install";

  const detailBase = "/projects/" + encodeURIComponent(p.id);
  const tabHref = (key: string) =>
    detailBase + qs({ filter: filter === "active" ? undefined : filter, tab: key === "overview" ? undefined : key });
  const backHref = "/projects" + qs({ filter: filter === "active" ? undefined : filter });

  const lateCount = (p.procurement || []).filter((l) => lineLate(p, l)).length;
  const tabDefs: Array<[string, string, number]> = isOrder
    ? [
        ["overview", "Overview", 0],
        ["procurement", "Procurement", lateCount],
        ["deliveries", "Deliveries", 0],
        ["timeline", "Timeline", 0],
        ["signoff", "Sign-off", 0],
      ]
    : [
        ["overview", "Overview", 0],
        ["procurement", "Procurement", lateCount],
        ["deliveries", "Deliveries", 0],
        ["crew", "Crew & schedule", 0],
        ["timeline", "Timeline", 0],
        ["signoff", "Sign-off", 0],
      ];
  const curTab = tabDefs.some((t) => t[0] === tab) ? tab : "overview";

  const canAdvance = !isDone && curIdx < stages.length - 1;
  const advanceLabel = canAdvance
    ? curIdx + 1 === stages.length - 1
      ? "Mark complete"
      : "Advance to " + stages[curIdx + 1].short
    : "";
  const nodeWidth = Math.max(64, Math.floor(640 / stages.length));

  return (
    <>
      {/* detail header */}
      <div style={{ padding: "18px 20px 0" }}>
        <Link
          href={backHref}
          className="pm-back"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: ACCENT,
            textDecoration: "none",
            paddingBottom: 12,
          }}
        >
          ‹ All projects
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            rowGap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={kindBadgeStyle(p.kind)}>{kindLabel(p.kind)}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>{p.id}</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", marginTop: 8 }}>{p.name}</div>
            <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 3 }}>
              {custName} · PM {firstName(p.owner)} · {money(p.value)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: dueColor }}>{dueBig}</div>
            <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 2 }}>{dueSub}</div>
          </div>
        </div>

        {/* stage tracker */}
        <div
          className="pm-rowscroll"
          style={{ display: "flex", alignItems: "flex-start", gap: 0, marginTop: 18, overflowX: "auto", paddingBottom: 4 }}
        >
          {stages.map((s, i) => {
            const st = i < curIdx ? "done" : i === curIdx ? "current" : "todo";
            const fill = st === "done" ? "var(--accent)" : "#fff";
            const bd = st === "todo" ? "#d6d9e0" : "var(--accent)";
            const fg = st === "done" ? "#fff" : st === "current" ? "var(--accent)" : "#b9bec7";
            return (
              <div
                key={s.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  minWidth: nodeWidth,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 9,
                    left: "-50%",
                    width: "100%",
                    height: 2,
                    background: i <= curIdx ? "var(--accent)" : "#e4e7ec",
                    display: i === 0 ? "none" : undefined,
                  }}
                />
                <form action={setStageAction} style={{ margin: 0, zIndex: 1 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="stage" value={s.key} />
                  <button
                    type="submit"
                    title={"Set stage: " + s.label}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "2px solid " + bd,
                      background: fill,
                      color: fg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                      boxShadow: st === "current" ? "0 0 0 3px var(--accent-soft)" : undefined,
                    }}
                  >
                    {st === "done" ? "✓" : ""}
                  </button>
                </form>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: st === "current" ? 700 : 500,
                    color: st === "todo" ? "#b9bec7" : st === "current" ? ACCENT_INK : "#5b616e",
                    marginTop: 6,
                    textAlign: "center",
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.short}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          {canAdvance && (
            <form action={setStageAction} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="stage" value={stages[Math.min(curIdx + 1, stages.length - 1)].key} />
              <button
                type="submit"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: ACCENT,
                  border: "none",
                  padding: "9px 15px",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {advanceLabel}
              </button>
            </form>
          )}
          {isDone && (
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#1f7a52",
                background: "#eaf6ef",
                border: "1px solid #cce9da",
                padding: "8px 13px",
                borderRadius: 8,
              }}
            >
              ✓ Project complete
            </span>
          )}
          <Link
            href={"/field-work" + qs({ id: p.id })}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#3a3f4a",
              background: "#fff",
              border: "1px solid #e4e7ec",
              padding: "8px 13px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Field view →
          </Link>
        </div>
      </div>

      {/* tabs */}
      <div
        className="pm-rowscroll"
        style={{ display: "flex", gap: 2, margin: "16px 20px 0", borderBottom: "1px solid #f0f1f4", overflowX: "auto" }}
      >
        {tabDefs.map(([key, label, cnt]) => {
          const on = curTab === key;
          return (
            <Link
              key={key}
              href={tabHref(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
                padding: "9px 13px 11px",
                textDecoration: "none",
                borderBottom: "2px solid " + (on ? "var(--accent)" : "transparent"),
                color: on ? "#16181d" : "#9aa0ab",
              }}
            >
              {label}
              {cnt > 0 && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "#b4543a",
                    background: "#f7e9e5",
                    padding: "0 5px",
                    borderRadius: 9,
                  }}
                >
                  {cnt}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div style={{ padding: "18px 20px 22px" }}>
        {curTab === "overview" && (
          <OverviewTab p={p} isOrder={isOrder} colorOf={colorOf} initialsOf={initialsOf} />
        )}
        {curTab === "procurement" && <ProcurementTab p={p} />}
        {curTab === "deliveries" && <DeliveriesTab p={p} />}
        {curTab === "crew" && !isOrder && (
          <CrewTab p={p} colorOf={colorOf} initialsOf={initialsOf} roster={roster} />
        )}
        {curTab === "timeline" && <TimelineTab p={p} isOrder={isOrder} />}
        {curTab === "signoff" && <SignoffTab p={p} curIdx={curIdx} initialsOf={initialsOf} />}
      </div>
    </>
  );
}

/* ---------------- Overview ---------------- */

function OverviewTab({
  p,
  isOrder,
  colorOf,
  initialsOf,
}: {
  p: ProjectRecord;
  isOrder: boolean;
  colorOf: (n: string) => string;
  initialsOf: (n: string) => string;
}) {
  const risks = riskFlags(p);
  const cards: Array<{ label: string; value: string; sub: string }> = [];
  cards.push({ label: "Target", value: fmtDate(p.targetDate), sub: isOrder ? "delivery" : "install ready" });
  if (!isOrder)
    cards.push({
      label: "Install window",
      value: p.installStart ? fmtDate(p.installStart) + " – " + fmtDate(p.installEnd) : "TBD",
      sub: (p.crew || []).length + " crew",
    });
  cards.push({
    label: "Materials",
    value: Math.round(procurementProgress(p) * 100) + "%",
    sub: (p.procurement || []).filter((l) => l.status === "received").length + " of " + (p.procurement || []).length + " received",
  });
  cards.push({
    label: isOrder ? "Order value" : "Contract",
    value: shortMoney(p.value),
    sub: p.margin ? Math.round(p.margin * 100) + "% margin" : "",
  });

  const tasksDone = (p.tasks || []).filter((t) => t.done).length;
  const taskTotal = (p.tasks || []).length;
  const taskPct = taskTotal ? Math.round((tasksDone / taskTotal) * 100) : 0;
  const recentNotes = (p.notes || []).slice(0, 3);

  return (
    <>
      {risks.length > 0 && (
        <div
          style={{
            background: "#fbf3ee",
            border: "1px solid #f0ddd0",
            borderRadius: 11,
            padding: "12px 14px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9a6a1f",
              letterSpacing: ".04em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Needs attention
          </div>
          {risks.map((r, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "#7a4d2a", padding: "3px 0" }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c98a2b", flexShrink: 0 }} />
              {r.label}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 18 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{ background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 11, padding: "13px 14px" }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".04em",
                textTransform: "uppercase",
              }}
            >
              {c.label}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 6, color: "#16181d" }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 3 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Field progress</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
          {tasksDone} / {taskTotal} tasks
        </span>
      </div>
      <div style={{ height: 7, background: "#eef0f3", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ width: taskPct + "%", height: "100%", background: ACCENT }} />
      </div>

      {recentNotes.length > 0 && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 9 }}>Recent field notes</div>
          {recentNotes.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid #f3f4f7" }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: colorOf(n.by),
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9.5,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {initialsOf(n.by)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.4, color: "#3a3f4a" }}>{n.text}</div>
                <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
                  {firstName(n.by)} · {timeAgo(n.at)}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ---------------- Procurement ---------------- */

function ProcurementTab({ p }: { p: ProjectRecord }) {
  const critId = criticalLineId(p);
  const critLine = (p.procurement || []).find((l) => l.id === critId);
  const orderedCount = (p.procurement || []).filter((l) => l.status !== "pending").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: "#9aa0ab" }}>Critical path (longest lead)</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>
            {critLine ? critLine.desc + " · " + critLine.leadDays + "d · " + critLine.vendor : "—"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#9aa0ab" }}>On order</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, marginTop: 3 }}>
            {orderedCount} / {(p.procurement || []).length}
          </div>
        </div>
      </div>
      <div style={{ border: "1px solid #eef0f3", borderRadius: 11, overflow: "hidden" }}>
        {(p.procurement || []).map((l) => {
          const m = LINE_META[l.status] || LINE_META.pending;
          const late = lineLate(p, l);
          const ob = orderByDate(p, l);
          const obDays = daysUntil(ob);
          const inHand = l.status === "received" || l.status === "shipped";
          const orderByLabel = inHand
            ? "✓ in hand"
            : fmtDate(ob) + (late ? " · late" : obDays <= 7 ? " · " + obDays + "d" : "");
          const orderByColor = inHand ? "#1f7a52" : late ? "#b4543a" : obDays <= 7 ? "#9a6a1f" : "#5b616e";
          return (
            <div
              key={l.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderBottom: "1px solid #f3f4f7",
                background: late ? "#fdf6f3" : "#fff",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>
                  {l.desc}
                  {l.id === critId && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 8.5,
                        fontWeight: 700,
                        color: "#b4543a",
                        background: "#f7e9e5",
                        border: "1px solid #f0d6cd",
                        padding: "1px 5px",
                        borderRadius: 4,
                        marginLeft: 7,
                        letterSpacing: ".05em",
                      }}
                    >
                      CRITICAL
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3 }}>
                  {(l.sku || "—") + " · " + l.vendor + " · " + l.qty + " " + l.unit + " · " + l.leadDays + "d lead"}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 10.5, color: "#9aa0ab" }}>order by</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600, color: orderByColor }}>
                  {orderByLabel}
                </div>
              </div>
              <form action={cycleLineAction} style={{ margin: 0, flexShrink: 0 }}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="lineId" value={l.id} />
                <input type="hidden" name="status" value={LINE_CYCLE[l.status]} />
                <button
                  type="submit"
                  title="Click to advance status"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: m.ink,
                    background: m.soft,
                    border: "1px solid " + m.bd,
                    padding: "5px 11px",
                    borderRadius: 7,
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              </form>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 10 }}>
        Tap a status chip to advance: pending → ordered → shipped → received.
      </div>
    </>
  );
}

/* ---------------- Deliveries ---------------- */

function DeliveriesTab({ p }: { p: ProjectRecord }) {
  const rows = p.deliveries || [];
  if (rows.length === 0)
    return (
      <div style={{ padding: "28px 16px", textAlign: "center", color: "#9aa0ab", fontSize: 13, lineHeight: 1.6 }}>
        No deliveries scheduled yet.
        <br />
        <span style={{ fontSize: 12 }}>They appear here once materials are on order.</span>
      </div>
    );
  return (
    <div style={{ border: "1px solid #eef0f3", borderRadius: 11, overflow: "hidden" }}>
      {rows.map((d) => {
        const m = DEL_META[d.status] || DEL_META.scheduled;
        const etaD = daysUntil(d.eta);
        const etaLabel =
          d.status === "received"
            ? "received " + fmtDate(d.receivedAt)
            : "ETA " + fmtDate(d.eta) + (etaD >= 0 && etaD <= 10 ? " · " + etaD + "d" : "");
        return (
          <div
            key={d.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 14px",
              borderBottom: "1px solid #f3f4f7",
            }}
          >
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
                flexShrink: 0,
              }}
            >
              ⤓
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{d.label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3 }}>
                {d.vendor} · {etaLabel}
              </div>
            </div>
            <form action={cycleDeliveryAction} style={{ margin: 0, flexShrink: 0 }}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="deliveryId" value={d.id} />
              <input type="hidden" name="status" value={DEL_CYCLE[d.status]} />
              <button
                type="submit"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: m.ink,
                  background: m.soft,
                  border: "1px solid " + m.bd,
                  padding: "5px 11px",
                  borderRadius: 7,
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Crew ---------------- */

function CrewTab({
  p,
  colorOf,
  initialsOf,
  roster,
}: {
  p: ProjectRecord;
  colorOf: (n: string) => string;
  initialsOf: (n: string) => string;
  roster: string[];
}) {
  const crew = p.crew || [];
  const onCrew = new Set(crew.map((c) => c.person));
  const options = roster.filter((r) => !onCrew.has(r));
  const totalManDays = crew.reduce(
    (a, c) => a + Math.max(1, Math.round(((c.end || 0) - (c.start || 0)) / DAY)),
    0
  );

  return (
    <>
      <div
        style={{
          background: "#fafbfc",
          border: "1px solid #eef0f3",
          borderRadius: 11,
          padding: "13px 14px",
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "#9aa0ab" }}>Scheduled install window</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>
            {p.installStart ? fmtDate(p.installStart) + " – " + fmtDate(p.installEnd) : "Not scheduled"}
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e" }}>{totalManDays} crew-days</div>
      </div>

      {crew.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid #f3f4f7" }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: colorOf(c.person),
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {initialsOf(c.person)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.person}</div>
            <div style={{ fontSize: 11, color: "#9aa0ab" }}>
              {c.role} · {fmtDate(c.start)} – {fmtDate(c.end)}
            </div>
          </div>
          <form action={removeCrewAction} style={{ margin: 0, flexShrink: 0 }}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="crewId" value={c.id} />
            <button
              type="submit"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 11.5,
                fontWeight: 600,
                color: "#b4543a",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </form>
        </div>
      ))}
      {crew.length === 0 && (
        <div style={{ padding: "14px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No crew assigned yet.
        </div>
      )}

      <form
        action={addCrewAction}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid #f0f1f4",
        }}
      >
        <input type="hidden" name="id" value={p.id} />
        <select
          name="person"
          defaultValue=""
          required
          style={{
            WebkitAppearance: "none",
            appearance: "none",
            flex: 1,
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 500,
            color: "#3a3f4a",
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            padding: "9px 12px",
            cursor: "pointer",
          }}
        >
          <option value="">Add crew member…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#fff",
            background: ACCENT,
            border: "none",
            padding: "9px 15px",
            borderRadius: 8,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Assign
        </button>
      </form>
    </>
  );
}

/* ---------------- Timeline (Gantt) ---------------- */

function TimelineTab({ p, isOrder }: { p: ProjectRecord; isOrder: boolean }) {
  const critId = criticalLineId(p);
  const critLine = (p.procurement || []).find((l) => l.id === critId);
  const now = Date.now();

  type Bar = {
    label: string;
    sub: string;
    start: number;
    end: number;
    status: string;
    late: boolean;
    critical: boolean;
  };
  const bars: Bar[] = [];
  (p.procurement || []).forEach((l) => {
    const ob = orderByDate(p, l);
    const startTs = l.orderedAt || ob;
    const arriveTs = l.orderedAt
      ? l.orderedAt + (l.leadDays || 0) * DAY
      : (p.targetDate || now) - STAGING_BUFFER * DAY;
    bars.push({
      label: l.desc,
      sub: l.vendor + " · " + (l.leadDays || 0) + "d lead",
      start: Math.min(startTs, arriveTs),
      end: Math.max(startTs, arriveTs),
      status: l.status,
      late: lineLate(p, l),
      critical: l.id === critId,
    });
  });
  if (!isOrder && p.installStart) {
    bars.push({
      label: "Install & commissioning",
      sub: (p.crew || []).length + " crew on site",
      start: p.installStart,
      end: p.installEnd || p.installStart + 3 * DAY,
      status: "install",
      late: false,
      critical: false,
    });
  }

  if (bars.length === 0)
    return (
      <div style={{ padding: "28px 16px", textAlign: "center", color: "#9aa0ab", fontSize: 13, lineHeight: 1.6 }}>
        Timeline appears once procurement lines exist.
      </div>
    );

  let domMin = now;
  let domMax = now;
  bars.forEach((b) => {
    domMin = Math.min(domMin, b.start);
    domMax = Math.max(domMax, b.end);
  });
  [p.targetDate, p.installStart, p.installEnd].forEach((d) => {
    if (d) {
      domMin = Math.min(domMin, d);
      domMax = Math.max(domMax, d);
    }
  });
  if (domMax <= domMin) domMax = domMin + 30 * DAY;
  const pad = Math.max(2 * DAY, (domMax - domMin) * 0.04);
  domMin -= pad;
  domMax += pad;
  const span = domMax - domMin || 1;
  const pct = (ts: number) => Math.max(0, Math.min(100, ((ts - domMin) / span) * 100));

  const BAR_META: Record<string, { c: string; bg: string }> = {
    received: { c: "#1f8a5b", bg: "#e4f2ea" },
    shipped: { c: "#6b5aa5", bg: "#ece7f6" },
    in_transit: { c: "#6b5aa5", bg: "#ece7f6" },
    ordered: { c: "#3155a8", bg: "#e6edfb" },
    pending: { c: "#a07d24", bg: "#f8efd0" },
    install: { c: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 14%, #fff)" },
  };

  const ticks = Array.from({ length: 7 }, (_, i) => ({
    pos: (i / 6) * 100,
    label: fmtDate(domMin + (span * i) / 6),
  }));

  const targetLabel = (isOrder ? "Delivery target" : "Install-ready") + " · " + fmtDate(p.targetDate);

  return (
    <>
      {critLine && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            background: "#fbf3ee",
            border: "1px solid #f0ddd0",
            borderRadius: 11,
            padding: "11px 14px",
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#9a5a1f",
              background: "#fbeede",
              border: "1px solid #f0dcc0",
              padding: "2px 9px",
              borderRadius: 20,
              textTransform: "uppercase",
              letterSpacing: ".04em",
            }}
          >
            Critical path
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>
            {critLine.desc + " · " + critLine.leadDays + "d · " + critLine.vendor}
          </span>
          <span style={{ fontSize: 12, color: "#8c7a5a" }}>longest lead — drives the order-by schedule</span>
        </div>
      )}

      <div style={{ border: "1px solid #eef0f3", borderRadius: 12, overflow: "hidden" }}>
        {/* axis header */}
        <div style={{ display: "flex", alignItems: "stretch", background: "#fafbfc", borderBottom: "1px solid #eef0f3" }}>
          <div
            style={{
              width: 190,
              flexShrink: 0,
              padding: "9px 12px",
              fontSize: 10,
              fontWeight: 700,
              color: "#9aa0ab",
              textTransform: "uppercase",
              letterSpacing: ".05em",
            }}
          >
            Item
          </div>
          <div style={{ flex: 1, position: "relative", height: 32, minWidth: 0 }}>
            {ticks.map((tk, i) => (
              <div key={i}>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: tk.pos + "%", borderLeft: "1px solid #eef0f3" }} />
                <span
                  style={{
                    position: "absolute",
                    top: 9,
                    left: tk.pos + "%",
                    transform: "translateX(4px)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "#9aa0ab",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tk.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* rows */}
        {bars.map((b, ri) => {
          const meta = b.late ? { c: "#b4543a", bg: "#f7e5df" } : BAR_META[b.status] || BAR_META.pending;
          const left = pct(b.start);
          const width = Math.max(2, pct(b.end) - left);
          return (
            <div key={ri} style={{ display: "flex", alignItems: "stretch", borderTop: "1px solid #f3f4f7" }}>
              <div style={{ width: 190, flexShrink: 0, padding: "9px 12px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: meta.c }} />
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.25,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.label}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 2, paddingLeft: 14 }}>
                  {b.sub}
                  {b.critical && <span style={{ color: "#9a5a1f", fontWeight: 600 }}> · critical</span>}
                </div>
              </div>
              <div style={{ flex: 1, position: "relative", minHeight: 40, minWidth: 0 }}>
                {ticks.map((tk, i) => (
                  <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: tk.pos + "%", borderLeft: "1px solid #f5f6f8" }} />
                ))}
                {now >= domMin && now <= domMax && (
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(now) + "%", borderLeft: "2px solid #16181d", opacity: 0.5 }} />
                )}
                {p.targetDate && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: pct(p.targetDate) + "%",
                      borderLeft: "2px dashed var(--accent)",
                      opacity: 0.65,
                    }}
                  />
                )}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    left: left + "%",
                    width: width + "%",
                    height: 15,
                    background: meta.bg,
                    border: "1px solid " + meta.c,
                    borderLeft: "4px solid " + meta.c,
                    borderRadius: 5,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginTop: 12,
          fontSize: 11,
          color: "#5b616e",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, borderTop: "2px solid #16181d", opacity: 0.5 }} />
          Today
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, borderTop: "2px dashed var(--accent)" }} />
          {targetLabel}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "#e6edfb", border: "1px solid #3155a8" }} />
          Ordered
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "#e4f2ea", border: "1px solid #1f8a5b" }} />
          Received
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "#f7e5df", border: "1px solid #b4543a" }} />
          Late order
        </span>
      </div>
    </>
  );
}

/* ---------------- Sign-off ---------------- */

function SignoffTab({
  p,
  curIdx,
  initialsOf,
}: {
  p: ProjectRecord;
  curIdx: number;
  initialsOf: (n: string) => string;
}) {
  const so = p.signoff;
  if (so) {
    return (
      <div style={{ background: "#eaf6ef", border: "1px solid #cce9da", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#1f7a52",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
            }}
          >
            ✓
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1f6a48" }}>Customer accepted</span>
        </div>
        <div style={{ fontSize: 13, color: "#2f5742", lineHeight: 1.6 }}>
          Signed by <b>{so.name}</b>, {so.role}
          <br />
          {fmtDateY(so.signedAt)} · recorded by {firstName(so.signedBy)}
        </div>
        {so.note && (
          <div style={{ fontSize: 12.5, color: "#3a6650", marginTop: 10, fontStyle: "italic" }}>“{so.note}”</div>
        )}
      </div>
    );
  }

  const signoffIdx = stageIndex(p.kind, "signoff");
  const gateNote =
    curIdx >= signoffIdx || p.stage === "install" || p.stage === "training"
      ? "Ready for hand-off."
      : "Usually done after install & training.";

  return (
    <>
      <div style={{ fontSize: 12.5, color: "#8c919c", marginBottom: 14, lineHeight: 1.5 }}>
        Record customer acceptance at hand-off. {gateNote}
      </div>
      <form action={signoffAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="hidden" name="id" value={p.id} />
        <input
          name="name"
          required
          placeholder="Customer name (who signed)"
          style={inputStyle}
        />
        <input name="role" placeholder="Title / role" style={inputStyle} />
        <textarea
          name="note"
          placeholder="Notes / punch items (optional)"
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <button
          type="submit"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: ACCENT,
            border: "none",
            padding: "11px 16px",
            borderRadius: 9,
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          Record sign-off &amp; complete
        </button>
      </form>
    </>
  );
}

const inputStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "10px 12px",
  outline: "none",
};
