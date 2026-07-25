import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { firstName } from "@/lib/team";
import { LEAD_STAGE_TONE, SegmentedToggle, StatusPill } from "@/components/ui";
import {
  dateLabel,
  followUps,
  followUpInfo,
  getAll,
  isOpen,
  metrics,
  sla,
  sourceMeta,
  SOURCES,
  SOURCE_META,
  STAGES,
  STAGE_META,
  timeAgo,
  unassigned,
  type LeadRecord,
} from "@/lib/stores/leads";
import { ACCENT_INK, avatarFor, buildDrawerVM, fuChip, srcChip, stageChip, type Ident } from "./lib";
import { shortMoneyDash, shortMoneyZero } from "./money";
import BoardView from "./board-view";
import WorklistRow from "./worklist-row";
import LeadDrawer from "./lead-drawer";
import { OwnerDot } from "./avatar";
import type { AvatarVM, BoardCardVM, ChipVM, WorklistRowVM } from "./types";

/**
 * Leads — three directions in one route, per the prototype:
 *   ?view=table    (default — Leads.dc.html: segment chips + dense table)
 *   ?view=board    (Leads Explorations 1a: kanban by stage, drag to move)
 *   ?view=worklist (Leads Explorations 1b: urgency-grouped follow-up feed)
 * ?lead=ID opens the Lead Detail drawer over whichever view; ?lead=new opens
 * the quick-add form.
 */

export const metadata = { title: "Leads — Quartzite-6" };

type ViewKey = "board" | "worklist" | "table";
type SegKey = "all" | "follow" | "unassigned" | "new" | "open" | "closed";

const VIEW_OPTIONS: Array<{ key: ViewKey; label: string }> = [
  { key: "board", label: "Board" },
  { key: "worklist", label: "Worklist" },
  { key: "table", label: "Table" },
];

const SEG_KEYS: SegKey[] = ["all", "follow", "unassigned", "new", "open", "closed"];

const COLS = "minmax(0,1.7fr) minmax(0,1.6fr) 82px 90px minmax(0,0.95fr) 74px 100px 66px";

function hrefFor(view: ViewKey, seg: SegKey, lead?: string): string {
  const p = new URLSearchParams();
  if (view !== "table") p.set("view", view);
  if (view === "table" && seg !== "all") p.set("seg", seg);
  if (lead) p.set("lead", lead);
  const s = p.toString();
  return "/leads" + (s ? `?${s}` : "");
}

const styleBlock = `
.lv-hoverrow:hover { background: #fafbff; }
.lv-bcard:hover { border-color: #c9ccd4; box-shadow: 0 3px 10px rgba(16,18,22,.09); }
.lv-hs::-webkit-scrollbar { height: 9px; }
.lv-hs::-webkit-scrollbar-thumb { background: #d3d6dd; border-radius: 8px; }
.lv-vs::-webkit-scrollbar { width: 9px; }
.lv-vs::-webkit-scrollbar-thumb { background: #d9dce2; border-radius: 8px; border: 2px solid #f7f8fa; }
.lv-col::-webkit-scrollbar { width: 7px; }
.lv-col::-webkit-scrollbar-thumb { background: #dcdfe5; border-radius: 8px; }
.lv-segs::-webkit-scrollbar { display: none; }
.lv-segs { -ms-overflow-style: none; scrollbar-width: none; }
@media (max-width: 860px) {
  .lv-pad { padding-left: 16px !important; padding-right: 16px !important; }
  .lv-head { flex-direction: column !important; align-items: stretch !important; }
  .lv-trow { grid-template-columns: minmax(0,1fr) 74px 100px !important; }
  .lv-scope, .lv-src, .lv-stage, .lv-own, .lv-upd { display: none !important; }
}
`;

const formLink: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  padding: "9px 13px",
  borderRadius: 9,
  textDecoration: "none",
};

const newBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 12.5,
  fontWeight: 600,
  color: "#fff",
  background: "var(--accent)",
  padding: "10px 15px",
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  boxShadow: "0 1px 3px var(--accent-soft)",
  textDecoration: "none",
};

function Heading({
  compact,
  standfirst,
  view,
  newHref,
}: {
  compact: boolean;
  standfirst: string;
  view: ViewKey;
  newHref: string;
}) {
  return (
    <div
      className="lv-head"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        rowGap: compact ? 12 : 14,
        marginBottom: compact ? 0 : 18,
        padding: compact ? "20px 24px 0" : undefined,
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: compact ? 22 : 23, fontWeight: 600, letterSpacing: "-.015em" }}>Leads</div>
        <div style={{ fontSize: compact ? 13 : 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        <SegmentedToggle options={VIEW_OPTIONS} active={view} hrefFor={(k) => hrefFor(k, "all")} />
        <a href="/lead-intake" target="_blank" style={formLink}>
          Public form ↗
        </a>
        <Link href={newHref} style={newBtn}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New lead
        </Link>
      </div>
    </div>
  );
}

type TableRowVM = {
  id: string;
  href: string;
  org: string;
  idContact: string;
  scope: string;
  src: ChipVM;
  stage: ChipVM;
  stageKey: string;
  owner: AvatarVM;
  ownerTitle: string;
  ownerName: string;
  value: string;
  fu: ChipVM;
  updated: string;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

  const viewParam = one(sp.view);
  const view: ViewKey =
    viewParam === "board" || viewParam === "worklist" ? viewParam : "table";
  const segParam = one(sp.seg) as SegKey;
  const seg: SegKey = SEG_KEYS.includes(segParam) ? segParam : "all";
  const leadParam = one(sp.lead);

  const [all, m, users, fuList, unassignedList] = await Promise.all([
    getAll(),
    metrics(),
    activeUsers(),
    followUps(),
    unassigned(),
  ]);
  const roster: Ident[] = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));

  const standfirst = `${m.open} open leads · ${shortMoneyDash(m.openValue)} in play · ${m.needFollowUp} need follow-up`;

  const urgOf = new Map(all.map((l) => [l.id, followUpInfo(l).urgency] as const));
  const byUrg = (a: LeadRecord, b: LeadRecord) =>
    (urgOf.get(b.id) || 0) - (urgOf.get(a.id) || 0) || (b.updatedAt || 0) - (a.updatedAt || 0);

  const closeHref = hrefFor(view, seg);
  const newHref = hrefFor(view, seg, "new");

  /* ---------- drawer ---------- */
  const leadRec =
    leadParam && leadParam !== "new" ? all.find((l) => l.id === leadParam) || null : null;
  const drawerMode: "new" | "detail" | null = leadParam
    ? leadParam === "new" || !leadRec
      ? "new"
      : "detail"
    : null;
  const sourceOptions = SOURCES.map((s) => ({ value: s as string, label: SOURCE_META[s].label }));

  /* ---------- 1a — board ---------- */
  const boardColumns = STAGES.map((k) => ({
    key: k as string,
    label: STAGE_META[k].label,
    dot: STAGE_META[k].dot,
  }));
  const boardCards: BoardCardVM[] = all.map((l) => {
    const fu = fuChip(l);
    return {
      id: l.id,
      stage: l.stage,
      org: l.org,
      interest: l.interest || "New enquiry",
      value: l.value || 0,
      valueLabel: shortMoneyZero(l.value),
      urg: urgOf.get(l.id) || 0,
      updatedAt: l.updatedAt || 0,
      strip: fu.tone === "bad" ? "#c85a3c" : fu.tone === "warn" ? "#c8a53c" : "transparent",
      showFu: fu.tone === "bad" || fu.tone === "warn" || fu.tone === "info",
      fu: { label: fu.full, ink: fu.ink, soft: fu.soft, bd: fu.bd },
      owner: avatarFor(roster, l.owner),
      ownerTitle: l.owner || "Unassigned",
      href: hrefFor("board", "all", l.id),
    };
  });
  const stats = [
    { label: "Open pipeline", value: shortMoneyZero(m.openValue), sub: `${m.open} open leads`, color: "#16181d" },
    {
      label: "Need follow-up",
      value: String(m.needFollowUp),
      sub: `${m.slaBreached} past first-response SLA`,
      color: m.needFollowUp > 0 ? "#b4543a" : "#16181d",
    },
    { label: "New this week", value: String(m.newThisWeek), sub: `${m.unassigned} unassigned`, color: "#16181d" },
    { label: "Conversion", value: `${m.conversion}%`, sub: `${m.won} won · ${m.lost} lost`, color: "#16181d" },
  ];

  /* ---------- 1b — worklist ---------- */
  const fuIds = new Set(fuList.map((l) => l.id));
  const overdue = fuList.filter((l) => (urgOf.get(l.id) || 0) >= 2);
  const cold = fuList.filter((l) => (urgOf.get(l.id) || 0) === 1);
  const openLeads = all.filter(isOpen);
  const awaiting = openLeads
    .filter((l) => l.stage === "new" && !fuIds.has(l.id))
    .sort((a, b) => sla(a).ms - sla(b).ms);
  const inProgress = openLeads
    .filter((l) => l.stage !== "new" && !fuIds.has(l.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const workRow = (l: LeadRecord): WorklistRowVM => {
    const fu = fuChip(l);
    let sub: string;
    if (l.nextActionAt && l.stage !== "new")
      sub = (l.nextActionNote || "Follow-up") + " · " + dateLabel(l.nextActionAt);
    else if (l.stage === "new" && !l.firstContactAt)
      sub = sourceMeta(l.source).verb + " · " + timeAgo(l.createdAt);
    else sub = (l.interest || "Open lead") + " · last touch " + timeAgo(l.lastActivityAt);
    return {
      id: l.id,
      org: l.org,
      sub,
      valueLabel: shortMoneyZero(l.value),
      owner: avatarFor(roster, l.owner),
      ownerTitle: l.owner || "Unassigned",
      src: srcChip(l),
      stage: stageChip(l),
      reason: { label: fu.full, ink: fu.ink, soft: fu.soft, bd: fu.bd },
      canClaim: !l.owner,
      href: hrefFor("worklist", "all", l.id),
    };
  };
  const workGroups = [
    { key: "overdue", label: "Overdue — reach out now", dot: "#c85a3c", ink: "#b4543a", items: overdue },
    { key: "cold", label: "Going cold", dot: "#c8a53c", ink: "#8a6d1f", items: cold },
    { key: "awaiting", label: "New — awaiting first response", dot: "#3d6fd0", ink: "#3155a8", items: awaiting },
    { key: "progress", label: "In progress", dot: "#7b5fb0", ink: "#5b4b8a", items: inProgress },
  ].filter((g) => g.items.length > 0);

  /* ---------- 1c — table ---------- */
  const segDefs: Array<{ key: SegKey; label: string; count: number }> = [
    { key: "all", label: "All", count: all.length },
    { key: "follow", label: "Needs follow-up", count: m.needFollowUp },
    { key: "unassigned", label: "Unassigned", count: m.unassigned },
    { key: "new", label: "New", count: m.counts.new },
    { key: "open", label: "Open", count: m.open },
    { key: "closed", label: "Won / Lost", count: m.won + m.lost },
  ];
  let filtered: LeadRecord[];
  if (seg === "follow") filtered = fuList.slice();
  else if (seg === "unassigned") filtered = unassignedList.slice();
  else if (seg === "new") filtered = all.filter((l) => l.stage === "new");
  else if (seg === "open") filtered = all.filter(isOpen);
  else if (seg === "closed") filtered = all.filter((l) => l.stage === "won" || l.stage === "lost");
  else filtered = all.slice();
  if (seg !== "follow") filtered = filtered.sort(byUrg);

  const rows: TableRowVM[] = filtered.map((l) => {
    const fu = fuChip(l);
    return {
      id: l.id,
      href: hrefFor("table", seg, l.id),
      org: l.org,
      idContact: l.id + (l.contact ? " · " + l.contact : ""),
      scope: l.interest || "—",
      src: srcChip(l),
      stage: stageChip(l),
      stageKey: l.stage,
      owner: avatarFor(roster, l.owner),
      ownerTitle: l.owner || "Unassigned",
      ownerName: l.owner ? firstName(l.owner) : "Unassigned",
      value: shortMoneyDash(l.value),
      fu: { label: fu.label, ink: fu.ink, soft: fu.soft, bd: fu.bd },
      updated: timeAgo(l.updatedAt),
    };
  });

  return (
    <>
      <style>{styleBlock}</style>

      {view === "table" && (
        <div className="pk-content lv-pad">
          <Heading compact={false} standfirst={standfirst} view={view} newHref={newHref} />

          {/* segment chips */}
          <div className="lv-segs" style={{ display: "flex", gap: 7, overflowX: "auto", marginBottom: 14 }}>
            {segDefs.map((s) => {
              const on = s.key === seg;
              return (
                <Link
                  key={s.key}
                  href={hrefFor("table", s.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    padding: "8px 13px",
                    borderRadius: 8,
                    textDecoration: "none",
                    border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
                    background: on ? "var(--accent-soft)" : "#fff",
                    color: on ? ACCENT_INK : "#787d87",
                  }}
                >
                  {s.label}
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 600,
                      color: on ? ACCENT_INK : "#aab0bb",
                    }}
                  >
                    {s.count}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* leads table */}
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
              className="lv-trow"
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                gap: 10,
                padding: "11px 18px",
                fontSize: 10,
                fontWeight: 600,
                color: "#aab0bb",
                textTransform: "uppercase",
                letterSpacing: ".05em",
                borderBottom: "1px solid #f0f1f4",
                background: "#fbfbfc",
              }}
            >
              <span>Lead</span>
              <span className="lv-scope">Scope of work</span>
              <span className="lv-src">Source</span>
              <span className="lv-stage">Stage</span>
              <span className="lv-own">Owner</span>
              <span style={{ textAlign: "right" }}>Value</span>
              <span>Follow-up</span>
              <span className="lv-upd" style={{ textAlign: "right" }}>
                Updated
              </span>
            </div>
            {rows.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className="lv-trow lv-hoverrow"
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  gap: 10,
                  padding: "12px 18px",
                  alignItems: "center",
                  borderBottom: "1px solid #f5f6f8",
                  cursor: "pointer",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.org}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "#aab0bb",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.idContact}
                  </div>
                </div>
                <div
                  className="lv-scope"
                  style={{
                    minWidth: 0,
                    fontSize: 12,
                    color: "#5b616e",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.scope}
                </div>
                <span
                  className="lv-src"
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    color: r.src.ink,
                    background: r.src.soft,
                    border: `1px solid ${r.src.bd}`,
                    padding: "1px 7px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                    justifySelf: "start",
                  }}
                >
                  {r.src.label}
                </span>
                <div className="lv-stage">
                  <StatusPill tone={LEAD_STAGE_TONE[r.stageKey] || "gray"} minWidth={78}>
                    {r.stage.label}
                  </StatusPill>
                </div>
                <div className="lv-own" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <OwnerDot owner={r.owner} title={r.ownerTitle} size={22} />
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "#5b616e",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.ownerName}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, textAlign: "right" }}>
                  {r.value}
                </span>
                <div>
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 10,
                      fontWeight: 600,
                      color: r.fu.ink,
                      background: r.fu.soft,
                      border: `1px solid ${r.fu.bd}`,
                      padding: "2px 8px",
                      borderRadius: 20,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.fu.label}
                  </span>
                </div>
                <span className="lv-upd" style={{ fontSize: 11, color: "#9aa0ab", textAlign: "right" }}>
                  {r.updated}
                </span>
              </Link>
            ))}
            {rows.length === 0 && (
              <div style={{ padding: "44px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                No leads in this segment.
              </div>
            )}
          </div>
        </div>
      )}

      {view === "board" && (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Heading compact standfirst={standfirst} view={view} newHref={newHref} />
          <div
            style={{
              padding: "16px 24px 4px",
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 12,
              flexShrink: 0,
            }}
          >
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderRadius: 11,
                  padding: "12px 14px",
                  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
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
                    fontSize: 21,
                    fontWeight: 600,
                    letterSpacing: "-.01em",
                    marginTop: 7,
                    color: s.color,
                  }}
                >
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 5 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <BoardView columns={boardColumns} cards={boardCards} />
        </div>
      )}

      {view === "worklist" && (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Heading compact standfirst={standfirst} view={view} newHref={newHref} />
          <div className="lv-vs" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 24px 26px" }}>
            {workGroups.map((g) => (
              <div key={g.key} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: g.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".01em", color: g.ink }}>
                    {g.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fff",
                      background: g.dot,
                      padding: "1px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {g.items.length}
                  </span>
                </div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #ececf0",
                    borderRadius: 12,
                    boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                    overflow: "hidden",
                  }}
                >
                  {g.items.map((l) => (
                    <WorklistRow key={l.id} row={workRow(l)} />
                  ))}
                </div>
              </div>
            ))}
            {workGroups.length === 0 && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderRadius: 12,
                  padding: "40px 18px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                }}
              >
                Every open lead has a fresh touch — nothing&apos;s going cold.
              </div>
            )}
          </div>
        </div>
      )}

      {drawerMode && (
        <LeadDrawer
          key={leadParam}
          mode={drawerMode}
          vm={drawerMode === "detail" && leadRec ? buildDrawerVM(leadRec) : null}
          closeHref={closeHref}
          meName={me.name}
          rosterNames={roster.map((r) => r.name)}
          sourceOptions={sourceOptions}
        />
      )}
    </>
  );
}
