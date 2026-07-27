"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ConsultingEngagement,
  EngagementDoc,
  EngagementMilestone,
  EngagementPhase,
} from "@/lib/stores/engagements";
import type { ConsultingData, VisitLite } from "./data";
import { isOpenEngagement } from "@/lib/consulting-review";
import {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_TONE,
  ENGAGEMENT_STATUS_LABEL,
} from "@/lib/consulting-stages";
import {
  addDecisionAction,
  addDocumentAction,
  addMeetingAction,
  addMilestoneAction,
  addPhaseAction,
  addSubmittalAction,
  completeMilestoneAction,
  linkInstallQuoteAction,
  linkVisitAction,
  removeDocumentAction,
  removeMilestoneAction,
  removePhaseAction,
  setEngagementStatusAction,
  setPeopleAction,
  setPhaseStatusAction,
  setSubmittalStatusAction,
  submitPhaseReviewAction,
  updateMilestoneAction,
  addChecklistItemAction,
  addReviewCommentAction,
  deleteMeetingAction,
  setChecklistItemAction,
  setCommentStateAction,
} from "./actions";
import { approvalIsStale } from "@/lib/consulting-review";
import { Card, EmptyState, KpiTile, Mono, PageHeader, Pill, StatusPill } from "@/components/ui";
import { money } from "@/lib/format";

/**
 * Consulting module view (D90) — list + detail-with-tabs, the Projects-module
 * pattern. Consulting stays OFF the main Gantt (spec §4): the only timelines
 * are the per-engagement strip on Overview and the roll-up on the list page.
 */

import { TABS, type TabKey } from "./tabs";

const TAB_LABEL: Record<TabKey, string> = {
  overview: "Overview",
  phases: "Phases & Reviews",
  milestones: "Milestones & Billing",
  meetings: "Meetings & Decisions",
  oversight: "Oversight",
  documents: "Documents",
};

const REVIEW_TONE: Record<string, string> = {
  none: "gray",
  in_review: "orange",
  approved: "green",
  changes: "red",
};
const REVIEW_LABEL: Record<string, string> = {
  none: "No review",
  in_review: "In review",
  approved: "Approved",
  changes: "Changes requested",
};

const PEOPLE_ROLES = [
  "Engagement Lead",
  "Contributor",
  "PM",
  "Project Coordinator",
  "Estimator",
  "Lead Sales",
];

const DAY = 86400000;

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const INPUT: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  background: "#fff",
  outline: "none",
};

const SMALL_BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 11px",
  background: "#fff",
  color: "#3a3f4a",
  cursor: "pointer",
};

function nextMilestone(e: ConsultingEngagement): EngagementMilestone | null {
  const upcoming = e.milestones
    .filter((m) => !m.completedAt && m.targetDate > 0)
    .sort((a, b) => a.targetDate - b.targetDate);
  return upcoming[0] || null;
}

function feeTotals(e: ConsultingEngagement, quoteValue: number) {
  const scheduled = e.milestones.reduce((a, m) => a + (m.amount || 0), 0);
  const total = scheduled || quoteValue;
  const done = e.milestones
    .filter((m) => m.completedAt)
    .reduce((a, m) => a + (m.amount || 0), 0);
  return { total, done };
}

function activePhase(e: ConsultingEngagement): EngagementPhase | null {
  return (
    e.phases.find((p) => p.status === "active") ||
    e.phases.find((p) => p.status === "pending") ||
    null
  );
}

/* ================================================================== */

export function ConsultingView({
  data,
  sel,
  tab,
}: {
  data: ConsultingData;
  sel: ConsultingEngagement | null;
  tab: TabKey;
}) {
  if (!sel) return <ConsultingList data={data} />;
  return <EngagementDetail data={data} eng={sel} tab={tab} />;
}

/* ============================ list ================================ */

function ConsultingList({ data }: { data: ConsultingData }) {
  const active = data.engagements.filter(isOpenEngagement);
  const feeBook = data.engagements.reduce(
    (a, e) => a + feeTotals(e, data.quotesById[e.quoteId]?.value || 0).total,
    0
  );
  const soon = data.engagements
    .flatMap((e) => e.milestones.filter((m) => !m.completedAt && m.targetDate > 0))
    .filter((m) => m.targetDate < Date.now() + 60 * DAY).length;

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <PageHeader
        title="Consulting"
        sub="Paid design & advisory engagements — quoted first; winning the quote opens the engagement."
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
        <KpiTile label="Active engagements" value={active.length} tone="accent" />
        <KpiTile label="Fee book" value={money(feeBook)} sub="all engagements" tone="blue" />
        <KpiTile label="Milestones (60d)" value={soon} tone={soon ? "amber" : undefined} />
      </div>

      {active.length > 1 && <RollupTimeline engagements={active} />}

      {data.engagements.length === 0 ? (
        <Card>
          <EmptyState
            title="No engagements yet"
            sub={
              <>
                Start with a <Link href="/design/engagements/quote" style={{ color: "var(--accent)" }}>consulting quote</Link> — customer
                acceptance is the paid commitment, and the won quote opens the engagement here.
              </>
            }
          />
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {data.engagements.map((e) => {
            const q = data.quotesById[e.quoteId];
            const fees = feeTotals(e, q?.value || 0);
            const ph = activePhase(e);
            const ms = nextMilestone(e);
            return (
              <Link key={e.id} href={`/design/engagements/${encodeURIComponent(e.id)}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Card style={{ height: "100%" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Mono>{e.id}</Mono>
                    <StatusPill tone={ENGAGEMENT_STAGE_TONE[e.status]}>{ENGAGEMENT_STATUS_LABEL[e.status]}</StatusPill>
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "#16181d" }}>{e.name}</div>
                  <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 2 }}>{e.customer}</div>
                  <div style={{ marginTop: 10, display: "grid", gap: 4, fontSize: 12, color: "#5b616e" }}>
                    <div>Phase: <b style={{ color: "#3a3f4a" }}>{ph ? ph.name : "—"}</b></div>
                    <div>
                      Next milestone: <b style={{ color: "#3a3f4a" }}>{ms ? `${ms.name} · ${fmtDate(ms.targetDate)}` : "—"}</b>
                    </div>
                    <div>
                      Fees: <b style={{ color: "#3a3f4a" }}>{money(fees.done)} of {money(fees.total)}</b> billed-milestone value complete
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Small all-engagements roll-up (Reports "Completion timeline" idiom). */
function RollupTimeline({ engagements }: { engagements: ConsultingEngagement[] }) {
  const dated = engagements
    .map((e) => {
      const ds = e.milestones.filter((m) => m.targetDate > 0).map((m) => m.targetDate);
      return ds.length ? { e, lo: Math.min(...ds), hi: Math.max(...ds) } : null;
    })
    .filter(Boolean) as Array<{ e: ConsultingEngagement; lo: number; hi: number }>;
  if (!dated.length) return null;
  const min = Math.min(...dated.map((d) => d.lo)) - 7 * DAY;
  const max = Math.max(...dated.map((d) => d.hi)) + 7 * DAY;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - min) / (max - min)) * 100));
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
        Engagement timeline
      </div>
      {dated.map(({ e, lo, hi }) => {
        const ms = nextMilestone(e);
        return (
          <div key={e.id} style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <Mono>{e.id}</Mono> {e.customer}
            </div>
            <div style={{ position: "relative", height: 18, background: "#f4f5f7", borderRadius: 6 }}>
              <div
                style={{
                  position: "absolute", top: 4, height: 10, borderRadius: 5,
                  left: `${pct(lo)}%`, width: `${Math.max(1.5, pct(hi) - pct(lo))}%`,
                  background: "color-mix(in srgb, var(--accent) 30%, #fff)",
                  border: "1px solid color-mix(in srgb, var(--accent) 45%, #fff)",
                }}
              />
              {ms && (
                <div
                  title={`${ms.name} · ${fmtDate(ms.targetDate)}`}
                  style={{
                    position: "absolute", top: 1, width: 8, height: 16, borderRadius: 3,
                    left: `calc(${pct(ms.targetDate)}% - 4px)`,
                    background: "var(--accent)",
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/* =========================== detail =============================== */

function EngagementDetail({
  data,
  eng,
  tab,
}: {
  data: ConsultingData;
  eng: ConsultingEngagement;
  tab: TabKey;
}) {
  const router = useRouter();
  const q = data.quotesById[eng.quoteId];
  const tabHref = (t: TabKey) => `/design/engagements/${encodeURIComponent(eng.id)}?tab=${t}`;
  const counts: Partial<Record<TabKey, number>> = {
    phases: eng.phases.length,
    milestones: eng.milestones.length,
    meetings: eng.meetings.length + eng.decisions.length,
    oversight: eng.submittals.length + data.visits.filter((v) => v.engagementId === eng.id).length,
    documents: eng.documents.length,
  };

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <Link href="/design/engagements" style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
        ← All engagements
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 2px" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: "#16181d", margin: 0 }}>{eng.name}</h1>
        <Mono>{eng.id}</Mono>
        <StatusPill tone={ENGAGEMENT_STAGE_TONE[eng.status]}>{ENGAGEMENT_STATUS_LABEL[eng.status]}</StatusPill>
        <select
          value={eng.status}
          onChange={async (ev) => {
            await setEngagementStatusAction(eng.id, ev.target.value as ConsultingEngagement["status"]);
            router.refresh();
          }}
          style={{ ...INPUT, padding: "5px 8px", fontSize: 12 }}
        >
          {ENGAGEMENT_STAGES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 12.5, color: "#5b616e", display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <span>{eng.customer}</span>
        {q && (
          <Link href={`/design/engagements/quote?id=${encodeURIComponent(q.id)}`} style={{ color: "var(--accent)" }}>
            Quote {q.id} · {money(q.value)} ({q.status})
          </Link>
        )}
        <Link href={`/design/engagements/letter?id=${encodeURIComponent(eng.quoteId)}&kind=proposal`} style={{ color: "var(--accent)" }}>
          Proposal / agreement
        </Link>
        <Link href={`/design/engagements/letter?id=${encodeURIComponent(eng.id)}&kind=spec`} style={{ color: "var(--accent)" }}>
          Spec package
        </Link>
        <Link href={`/design/engagements/spec?id=${encodeURIComponent(eng.id)}`} style={{ color: "var(--accent)" }}>
          Bid specification →
        </Link>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid #eef0f3", paddingBottom: 10, marginBottom: 16 }}>
        {TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            style={{
              textDecoration: "none", fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 8,
              color: tab === t ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
              background: tab === t ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "transparent",
              border: tab === t ? "1px solid color-mix(in srgb, var(--accent) 30%, #fff)" : "1px solid transparent",
            }}
          >
            {TAB_LABEL[t]}
            {counts[t] ? <span style={{ marginLeft: 6, color: "#9aa0ab", fontWeight: 500 }}>{counts[t]}</span> : null}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={data} eng={eng} />}
      {tab === "phases" && <PhasesTab data={data} eng={eng} />}
      {tab === "milestones" && <MilestonesTab eng={eng} quoteValue={q?.value || 0} />}
      {tab === "meetings" && <MeetingsTab eng={eng} />}
      {tab === "oversight" && <OversightTab data={data} eng={eng} />}
      {tab === "documents" && <DocumentsTab eng={eng} />}
    </div>
  );
}

/* ---------------------------- overview ---------------------------- */

function OverviewTab({ data, eng }: { data: ConsultingData; eng: ConsultingEngagement }) {
  const router = useRouter();
  const [installQuote, setInstallQuote] = useState(eng.installQuoteId || "");
  const visits = data.visits.filter((v) => v.engagementId === eng.id);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <EngagementTimeline eng={eng} visits={visits} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
            Links
          </div>
          <div style={{ display: "grid", gap: 7, fontSize: 12.5, color: "#3a3f4a" }}>
            <div>Company: <b>{eng.customer || "—"}</b></div>
            <div>Contact: <b>{eng.contactName || "—"}</b></div>
            <div>Site{eng.siteIds.length === 1 ? "" : "s"}: <b>{eng.siteIds.length ? eng.siteIds.join(", ") : "—"}</b></div>
            <div>
              Source quote:{" "}
              <Link href={`/design/engagements/quote?id=${encodeURIComponent(eng.quoteId)}`} style={{ color: "var(--accent)" }}>
                {eng.quoteId}
              </Link>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Install quote:</span>
              <input
                value={installQuote}
                onChange={(e) => setInstallQuote(e.target.value)}
                placeholder="Q-…"
                style={{ ...INPUT, width: 110, padding: "4px 8px", fontSize: 12 }}
              />
              <button
                style={SMALL_BTN}
                onClick={async () => {
                  await linkInstallQuoteAction(eng.id, installQuote.trim() || null);
                  router.refresh();
                }}
              >
                {eng.installQuoteId ? "Update" : "Link"}
              </button>
              {eng.installQuoteId && (
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>reference only — never a conversion</span>
              )}
            </div>
          </div>
        </Card>
        <PeopleCard eng={eng} roster={data.roster} />
      </div>
      {eng.designIds.length > 0 && (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
            Linked designs
          </div>
          {eng.designIds.map((did) => {
            const d = data.designsById[did];
            return (
              <Link
                key={did}
                href={`/design/designs?id=${encodeURIComponent(did)}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5, textDecoration: "none", color: "inherit" }}
              >
                <span style={{ fontWeight: 600, color: "var(--accent)" }}>{d ? d.name : did}</span>
                {d && <span style={{ color: "#9aa0ab", fontSize: 11.5 }}>{d.venue || "—"}</span>}
              </Link>
            );
          })}
        </Card>
      )}
      {eng.decisions.length > 0 && (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 8 }}>
            Latest decision
          </div>
          <div style={{ fontSize: 12.5, color: "#3a3f4a" }}>
            {eng.decisions[0].decision}
            <span style={{ color: "#9aa0ab" }}> — {eng.decisions[0].by}, {fmtDate(eng.decisions[0].at)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

/** People-with-roles editor — the shape item 16 E requires on projects too;
 *  built here first, lift to a shared component when projects grow roles. */
function PeopleCard({ eng, roster }: { eng: ConsultingEngagement; roster: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Array<{ person: string; role: string }>>(
    eng.people.length ? eng.people.map((p) => ({ person: p.person, role: p.role })) : []
  );
  const [dirty, setDirty] = useState(false);

  const mut = (next: Array<{ person: string; role: string }>) => {
    setRows(next);
    setDirty(true);
  };

  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
        People &amp; roles
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 30px", gap: 7, marginBottom: 7 }}>
          <select value={r.person} onChange={(e) => mut(rows.map((x, j) => (j === i ? { ...x, person: e.target.value } : x)))} style={INPUT}>
            <option value="">Person…</option>
            {roster.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select value={r.role} onChange={(e) => mut(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} style={INPUT}>
            {PEOPLE_ROLES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button style={{ ...SMALL_BTN, padding: "4px 7px" }} onClick={() => mut(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button style={SMALL_BTN} onClick={() => mut([...rows, { person: "", role: rows.length ? "Contributor" : "Engagement Lead" }])}>
          + Add person
        </button>
        {dirty && (
          <button
            className="pk-btn-accent"
            onClick={async () => {
              await setPeopleAction(eng.id, rows.filter((r) => r.person));
              setDirty(false);
              router.refresh();
            }}
          >
            Save
          </button>
        )}
      </div>
    </Card>
  );
}

/** Per-engagement horizontal timeline: milestones + linked site visits. */
function EngagementTimeline({ eng, visits }: { eng: ConsultingEngagement; visits: VisitLite[] }) {
  const points = [
    ...eng.milestones.filter((m) => m.targetDate > 0).map((m) => m.targetDate),
    ...visits.map((v) => v.startAt),
  ];
  if (!points.length) return null;
  const min = Math.min(...points) - 7 * DAY;
  const max = Math.max(...points) + 7 * DAY;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - min) / (max - min)) * 100));
  const now = Date.now();
  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 12 }}>
        Timeline
      </div>
      <div style={{ position: "relative", height: 56, background: "#f9fafb", borderRadius: 8, border: "1px solid #eef0f3" }}>
        {now >= min && now <= max && (
          <div style={{ position: "absolute", top: 0, bottom: 0, width: 1.5, background: "#c9ced8", left: `${pct(now)}%` }} title="Today" />
        )}
        {visits.map((v) => (
          <div
            key={v.id}
            title={`${v.reason} · ${fmtDate(v.startAt)} · ${v.assignedTo}`}
            style={{
              position: "absolute", bottom: 6, width: 6, height: 14, borderRadius: 2,
              left: `calc(${pct(v.startAt)}% - 3px)`, background: "#8fa3c8",
            }}
          />
        ))}
        {eng.milestones
          .filter((m) => m.targetDate > 0)
          .map((m) => {
            const late = !m.completedAt && m.targetDate < now;
            const color = m.completedAt ? "#2e9e6b" : late ? "#c4553a" : "var(--accent)";
            return (
              <div
                key={m.id}
                title={`${m.name} · ${fmtDate(m.targetDate)}${m.amount ? " · " + money(m.amount) : ""}${m.completedAt ? " · complete" : late ? " · overdue" : ""}`}
                style={{
                  position: "absolute", top: 8, width: 12, height: 12,
                  left: `calc(${pct(m.targetDate)}% - 6px)`,
                  background: color, transform: "rotate(45deg)", borderRadius: 3,
                }}
              />
            );
          })}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 10.5, color: "#9aa0ab", marginTop: 8 }}>
        <span>◆ milestone (green = complete, red = overdue)</span>
        <span>▎site visit</span>
      </div>
    </Card>
  );
}

/* ----------------------------- phases ----------------------------- */

function PhasesTab({ data, eng }: { data: ConsultingData; eng: ConsultingEngagement }) {
  const router = useRouter();
  const [newPhase, setNewPhase] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const menuLeft = data.phaseMenu.filter((m) => !eng.phases.some((p) => p.name === m));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {err && (
        <div style={{ background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#a0442b" }}>
          {err}
        </div>
      )}
      {eng.phases.length === 0 && <Card><EmptyState title="No phases yet" sub="Add phases from the menu below — progress gates on internal Peak review only." /></Card>}
      {eng.phases.map((ph) => {
        const stale = approvalIsStale(ph);
        const canComplete = ph.review.state === "approved" && !stale;
        return (
          <Card key={ph.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#16181d", flex: 1, minWidth: 160 }}>{ph.name}</div>
              <StatusPill tone={ph.status === "complete" ? "green" : ph.status === "active" ? "blue" : "gray"}>
                {ph.status === "complete" ? "Complete" : ph.status === "active" ? "Active" : "Pending"}
              </StatusPill>
              <Pill color={ph.review.state === "approved" ? "#2e9e6b" : ph.review.state === "in_review" ? "#c07f28" : ph.review.state === "changes" ? "#c4553a" : "#8c919c"}>
                {REVIEW_LABEL[ph.review.state]}
                {ph.review.reviewer ? ` · ${ph.review.reviewer}` : ""}
              </Pill>
            </div>
            {ph.review.state === "changes" && ph.review.note && (
              <div style={{ fontSize: 12, color: "#a0442b", marginTop: 6 }}>“{ph.review.note}”</div>
            )}
            {stale && (
              <div style={{ background: "#fdf4e7", border: "1px solid #f0dcbb", borderRadius: 9, padding: "8px 11px", fontSize: 12, color: "#8a5a1c", marginTop: 8 }}>
                <strong>Approval is stale.</strong> The documents changed after{" "}
                {ph.approvalPin?.by} approved this on {fmtDate(ph.approvalPin?.at)} — it needs re-review
                before the phase can complete.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {ph.status === "pending" && (
                <button style={SMALL_BTN} onClick={async () => { await setPhaseStatusAction(eng.id, ph.id, "active"); router.refresh(); }}>
                  Start phase
                </button>
              )}
              {(ph.review.state === "none" || ph.review.state === "changes") && ph.status !== "complete" && (
                <button style={SMALL_BTN} onClick={async () => { await submitPhaseReviewAction(eng.id, ph.id); router.refresh(); }}>
                  Submit for review
                </button>
              )}
              {ph.review.state === "in_review" && (
                <Link href="/reviews" style={{ ...SMALL_BTN, textDecoration: "none", display: "inline-block" }}>
                  In the Reviews queue →
                </Link>
              )}
              {ph.status !== "complete" && (
                <button
                  style={{ ...SMALL_BTN, opacity: canComplete ? 1 : 0.5, cursor: canComplete ? "pointer" : "default" }}
                  title={canComplete ? "" : "Needs an approved internal review first"}
                  onClick={async () => {
                    setErr(null);
                    const r = await setPhaseStatusAction(eng.id, ph.id, "complete");
                    if (!r.ok) setErr(r.error);
                    router.refresh();
                  }}
                >
                  Mark complete
                </button>
              )}
              {ph.status === "complete" && (
                <button style={SMALL_BTN} onClick={async () => { await setPhaseStatusAction(eng.id, ph.id, "active"); router.refresh(); }}>
                  Reopen
                </button>
              )}
              <button
                style={{ ...SMALL_BTN, color: "#a0442b" }}
                onClick={async () => { await removePhaseAction(eng.id, ph.id); router.refresh(); }}
              >
                Remove
              </button>
            </div>
            <PhaseDocs eng={eng} phase={ph} />
            <StandardsChecklist eng={eng} phase={ph} />
            <ReviewComments eng={eng} phase={ph} />
          </Card>
        );
      })}
      <Card>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {menuLeft.map((m) => (
            <button key={m} style={SMALL_BTN} onClick={async () => { await addPhaseAction(eng.id, m); router.refresh(); }}>
              + {m}
            </button>
          ))}
          <input value={newPhase} onChange={(e) => setNewPhase(e.target.value)} placeholder="Custom phase…" style={{ ...INPUT, width: 180 }} />
          <button
            style={SMALL_BTN}
            onClick={async () => {
              if (!newPhase.trim()) return;
              await addPhaseAction(eng.id, newPhase.trim());
              setNewPhase("");
              router.refresh();
            }}
          >
            Add
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------- standards checklist (D91) ------------------- */

function StandardsChecklist({ eng, phase }: { eng: ConsultingEngagement; phase: EngagementPhase }) {
  const router = useRouter();
  const [adding, setAdding] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Inline waive entry — window.prompt() throws in this app's browser
  // context ("prompt() is not supported"), so it silently did nothing.
  const [waivingId, setWaivingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const items = phase.checklist || [];
  const open = items.filter((i) => i.state === "open").length;
  const waived = items.filter((i) => i.state === "waived").length;

  async function set(itemId: string, state: "open" | "checked" | "waived", why = "") {
    setErr(null);
    const r = await setChecklistItemAction(eng.id, phase.id, itemId, state, why);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setWaivingId(null);
    setReason("");
    router.refresh();
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #edeff3", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#16181d" }}>Peak standards</div>
        {items.length > 0 && (
          <Pill color={open ? "#c07f28" : "#2e9e6b"}>
            {items.length - open}/{items.length} cleared{waived ? ` · ${waived} waived` : ""}
          </Pill>
        )}
      </div>
      {err && <div style={{ fontSize: 12, color: "#a0442b", marginBottom: 6 }}>{err}</div>}
      {items.length === 0 && (
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 6 }}>
          No checklist yet — it stamps from the template for “{phase.name}” when the phase is
          submitted for review. Add items below to build one now.
        </div>
      )}
      <div style={{ display: "grid", gap: 5 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={it.state === "checked"}
              onChange={() => set(it.id, it.state === "checked" ? "open" : "checked")}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1 }}>
              <span
                style={{
                  color: it.state === "open" ? "#16181d" : "#5b616e",
                  textDecoration: it.state === "waived" ? "line-through" : "none",
                }}
              >
                {it.text}
              </span>
              {it.state !== "open" && (
                <span style={{ color: "#8c919c", fontSize: 11.5 }}>
                  {" "}
                  — {it.state === "waived" ? "waived" : "checked"} by {it.by} {fmtDate(it.at)}
                  {it.reason ? ` · ${it.reason}` : ""}
                </span>
              )}
            </div>
            {it.state !== "waived" && waivingId !== it.id && (
              <button
                style={{ ...SMALL_BTN, padding: "2px 7px", fontSize: 11 }}
                onClick={() => { setWaivingId(it.id); setReason(""); }}
              >
                Waive
              </button>
            )}
          </div>
        ))}
        {waivingId && (
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && reason.trim()) set(waivingId, "waived", reason.trim()); }}
              placeholder="Why is this being waived?"
              style={{ ...INPUT, flex: 1, fontSize: 12 }}
              autoFocus
            />
            <button
              style={SMALL_BTN}
              disabled={!reason.trim()}
              onClick={() => set(waivingId, "waived", reason.trim())}
            >
              Waive
            </button>
            <button style={SMALL_BTN} onClick={() => setWaivingId(null)}>Cancel</button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add a standards item…"
          style={{ ...INPUT, flex: 1, fontSize: 12 }}
        />
        <button
          style={SMALL_BTN}
          onClick={async () => {
            if (!adding.trim()) return;
            await addChecklistItemAction(eng.id, phase.id, adding.trim());
            setAdding("");
            router.refresh();
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* -------------------- review comments (D92) -------------------- */

function ReviewComments({ eng, phase }: { eng: ConsultingEngagement; phase: EngagementPhase }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Inline waive entry — see the note on StandardsChecklist: prompt() is
  // unavailable in this app's browser context.
  const [waivingId, setWaivingId] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const comments = phase.comments || [];
  const open = comments.filter((c) => c.state === "open");

  async function setState(id: string, state: "open" | "resolved" | "waived", why = "") {
    setErr(null);
    const r = await setCommentStateAction(eng.id, phase.id, id, state, why);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setWaivingId(null);
    setWaiveReason("");
    router.refresh();
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #edeff3", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#16181d" }}>Review comments</div>
        {comments.length > 0 && (
          <Pill color={open.length ? "#c07f28" : "#2e9e6b"}>
            {open.length ? `${open.length} open` : "all resolved"}
          </Pill>
        )}
      </div>
      {err && <div style={{ fontSize: 12, color: "#a0442b", marginBottom: 6 }}>{err}</div>}
      <div style={{ display: "grid", gap: 7 }}>
        {comments.map((c) => (
          <div
            key={c.id}
            style={{
              background: c.state === "open" ? "#fbfbfc" : "#f6f7f9",
              border: "1px solid #edeff3",
              borderLeft: `3px solid ${c.state === "open" ? (c.required ? "#c4553a" : "#c07f28") : "#2e9e6b"}`,
              borderRadius: 7,
              padding: "7px 10px",
              fontSize: 12.5,
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ color: "#16181d" }}>{c.author}</strong>
              <span style={{ color: "#8c919c", fontSize: 11.5 }}>{fmtDate(c.at)}</span>
              {c.required && c.state === "open" && <Pill color="#c4553a">Required edit</Pill>}
              {c.state !== "open" && (
                <Pill color="#2e9e6b">
                  {c.state === "waived" ? "Waived" : "Resolved"} · {c.resolvedBy}
                </Pill>
              )}
            </div>
            <div style={{ marginTop: 3, color: "#3d424e", whiteSpace: "pre-wrap" }}>{c.body}</div>
            {c.waiveReason && (
              <div style={{ marginTop: 3, color: "#8c919c", fontSize: 11.5 }}>Waived: {c.waiveReason}</div>
            )}
            {c.state === "open" && waivingId !== c.id && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button style={{ ...SMALL_BTN, padding: "2px 7px", fontSize: 11 }} onClick={() => setState(c.id, "resolved")}>
                  Resolve
                </button>
                <button
                  style={{ ...SMALL_BTN, padding: "2px 7px", fontSize: 11 }}
                  onClick={() => { setWaivingId(c.id); setWaiveReason(""); }}
                >
                  Waive
                </button>
              </div>
            )}
            {waivingId === c.id && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  value={waiveReason}
                  onChange={(e) => setWaiveReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && waiveReason.trim()) setState(c.id, "waived", waiveReason.trim()); }}
                  placeholder="Why is this being waived?"
                  style={{ ...INPUT, flex: 1, fontSize: 12 }}
                  autoFocus
                />
                <button style={SMALL_BTN} disabled={!waiveReason.trim()} onClick={() => setState(c.id, "waived", waiveReason.trim())}>
                  Waive
                </button>
                <button style={SMALL_BTN} onClick={() => setWaivingId(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a review comment…"
          style={{ ...INPUT, flex: 1, fontSize: 12 }}
        />
        <button
          style={SMALL_BTN}
          onClick={async () => {
            if (!body.trim()) return;
            const r = await addReviewCommentAction(eng.id, phase.id, body.trim());
            if (!r.ok) setErr(r.error);
            setBody("");
            router.refresh();
          }}
        >
          Comment
        </button>
      </div>
    </div>
  );
}

function PhaseDocs({ eng, phase }: { eng: ConsultingEngagement; phase: EngagementPhase }) {
  const marks = (phase.annotations || []).length;
  return (
    <div style={{ marginTop: 10 }}>
      <DocList
        docs={phase.attachments}
        onRemove={(docId) => removeDocumentAction(eng.id, docId, phase.id)}
        uploadLabel="Attach deliverable"
        onUpload={(doc) => addDocumentAction(eng.id, doc, phase.id)}
        compact
      />
      {phase.attachments.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <Link
            href={`/design/engagements/markup?eng=${encodeURIComponent(eng.id)}&phase=${encodeURIComponent(phase.id)}`}
            style={{ ...SMALL_BTN, textDecoration: "none", display: "inline-block" }}
          >
            ✏️ Mark up drawings
          </Link>
          {marks > 0 && (
            <span style={{ fontSize: 11.5, color: "#8c919c" }}>
              {marks} mark{marks === 1 ? "" : "s"} on this phase
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- milestones --------------------------- */

function MilestonesTab({ eng, quoteValue }: { eng: ConsultingEngagement; quoteValue: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const fees = feeTotals(eng, quoteValue);
  const rows = [...eng.milestones].sort((a, b) => (a.targetDate || Infinity) - (b.targetDate || Infinity));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <KpiTile label="Fee schedule" value={money(fees.total)} sub="milestone amounts feed the Reports billing forecast" tone="blue" />
        <KpiTile label="Complete" value={money(fees.done)} tone="green" />
      </div>
      <Card>
        {rows.length === 0 && <EmptyState title="No milestones yet" sub="Milestone fees from the quote land here on win — or add them below." />}
        {rows.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
            <input
              type="checkbox"
              checked={!!m.completedAt}
              onChange={async (e) => { await completeMilestoneAction(eng.id, m.id, e.target.checked); router.refresh(); }}
              title="Complete"
            />
            <div style={{ flex: 1, minWidth: 160, fontSize: 13, color: m.completedAt ? "#9aa0ab" : "#16181d", textDecoration: m.completedAt ? "line-through" : "none" }}>
              {m.name}
            </div>
            <DateEditor
              value={m.targetDate}
              onSave={async (ts) => { await updateMilestoneAction(eng.id, m.id, { targetDate: ts }); router.refresh(); }}
            />
            <div style={{ width: 90, fontSize: 12.5, textAlign: "right", color: "#3a3f4a" }}>{m.amount ? money(m.amount) : "—"}</div>
            <button style={{ ...SMALL_BTN, padding: "4px 8px", color: "#a0442b" }} onClick={async () => { await removeMilestoneAction(eng.id, m.id); router.refresh(); }}>
              ×
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Milestone name" style={{ ...INPUT, flex: 1, minWidth: 160 }} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={INPUT} />
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="$ (optional)" inputMode="numeric" style={{ ...INPUT, width: 110 }} />
          <button
            style={SMALL_BTN}
            onClick={async () => {
              if (!name.trim()) return;
              await addMilestoneAction(eng.id, {
                name: name.trim(),
                targetDate: date ? new Date(date + "T12:00:00").getTime() : 0,
                amount: amount ? Number(amount) : null,
              });
              setName(""); setDate(""); setAmount("");
              router.refresh();
            }}
          >
            + Add milestone
          </button>
        </div>
      </Card>
    </div>
  );
}

function DateEditor({ value, onSave }: { value: number; onSave: (ts: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  if (!editing)
    return (
      <button style={{ ...SMALL_BTN, padding: "4px 8px" }} onClick={() => { setEditing(true); setV(value ? new Date(value).toISOString().slice(0, 10) : ""); }}>
        {value ? fmtDate(value) : "Set date"}
      </button>
    );
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <input type="date" value={v} onChange={(e) => setV(e.target.value)} style={{ ...INPUT, padding: "4px 8px", fontSize: 12 }} />
      <button
        style={{ ...SMALL_BTN, padding: "4px 8px" }}
        onClick={() => { setEditing(false); if (v) onSave(new Date(v + "T12:00:00").getTime()); }}
      >
        Save
      </button>
    </span>
  );
}

/* ---------------------- meetings & decisions ---------------------- */

function MeetingsTab({ eng }: { eng: ConsultingEngagement }) {
  const router = useRouter();
  const [decision, setDecision] = useState("");
  const [context, setContext] = useState("");
  const [mtAttendees, setMtAttendees] = useState("");
  const [mtMinutes, setMtMinutes] = useState("");
  const [mtTitle, setMtTitle] = useState("");
  const [mtRecording, setMtRecording] = useState("");
  const [mtPhase, setMtPhase] = useState("");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Decision log
        </div>
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <input value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="What was decided?" style={INPUT} />
          <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context (optional)" style={INPUT} />
          <button
            style={{ ...SMALL_BTN, justifySelf: "start" }}
            onClick={async () => {
              if (!decision.trim()) return;
              await addDecisionAction(eng.id, decision.trim(), context.trim());
              setDecision(""); setContext("");
              router.refresh();
            }}
          >
            + Log decision
          </button>
        </div>
        {eng.decisions.length === 0 && <EmptyState title="No decisions logged" />}
        {eng.decisions.map((d) => (
          <div key={d.id} style={{ padding: "8px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}>
            <div style={{ color: "#16181d" }}>{d.decision}</div>
            {d.context && <div style={{ color: "#5b616e", marginTop: 2 }}>{d.context}</div>}
            <div style={{ color: "#9aa0ab", fontSize: 11, marginTop: 3 }}>{d.by} · {fmtDate(d.at)}</div>
          </div>
        ))}
      </Card>
      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Review meetings
        </div>
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <input value={mtTitle} onChange={(e) => setMtTitle(e.target.value)} placeholder="Meeting title (e.g. DD design review)" style={INPUT} />
          <input value={mtAttendees} onChange={(e) => setMtAttendees(e.target.value)} placeholder="Attendees" style={INPUT} />
          <textarea value={mtMinutes} onChange={(e) => setMtMinutes(e.target.value)} rows={3} placeholder="Minutes… (paste from the note taker)" style={{ ...INPUT, resize: "vertical" }} />
          <input value={mtRecording} onChange={(e) => setMtRecording(e.target.value)} placeholder="Recording link (Zoom / Meet / Teams)" style={INPUT} />
          <select value={mtPhase} onChange={(e) => setMtPhase(e.target.value)} style={INPUT}>
            <option value="">Not tied to a phase review</option>
            {eng.phases.map((p) => (
              <option key={p.id} value={p.id}>Covers: {p.name}</option>
            ))}
          </select>
          <button
            style={{ ...SMALL_BTN, justifySelf: "start" }}
            onClick={async () => {
              if (!mtMinutes.trim() && !mtAttendees.trim() && !mtTitle.trim()) return;
              await addMeetingAction(eng.id, {
                at: Date.now(),
                attendees: mtAttendees.trim(),
                minutes: mtMinutes.trim(),
                decisionIds: [],
                title: mtTitle.trim(),
                recordingUrl: mtRecording.trim(),
                phaseId: mtPhase || null,
              });
              setMtAttendees(""); setMtMinutes(""); setMtTitle(""); setMtRecording(""); setMtPhase("");
              router.refresh();
            }}
          >
            + Record meeting
          </button>
        </div>
        {eng.meetings.length === 0 && <EmptyState title="No meetings recorded" sub="Minutes are recorded, not generated (spec)." />}
        {eng.meetings.map((m) => {
          const phase = m.phaseId ? eng.phases.find((p) => p.id === m.phaseId) : null;
          return (
            <div key={m.id} style={{ padding: "8px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}>
              {m.title && <div style={{ color: "#16181d", fontWeight: 600 }}>{m.title}</div>}
              <div style={{ color: "#9aa0ab", fontSize: 11 }}>{fmtDate(m.at)}{m.attendees ? ` · ${m.attendees}` : ""}</div>
              {m.minutes && <div style={{ color: "#3a3f4a", marginTop: 3, whiteSpace: "pre-wrap" }}>{m.minutes}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                {phase && <Pill color="#3155a8">{phase.name} review</Pill>}
                {m.recordingUrl && (
                  <a href={m.recordingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#3155a8" }}>
                    ▶ Watch recording
                  </a>
                )}
                <button
                  style={{ ...SMALL_BTN, padding: "2px 7px", fontSize: 11, color: "#a0442b" }}
                  onClick={async () => { await deleteMeetingAction(eng.id, m.id); router.refresh(); }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ---------------------------- oversight --------------------------- */

function OversightTab({ data, eng }: { data: ConsultingData; eng: ConsultingEngagement }) {
  const router = useRouter();
  const [kind, setKind] = useState<"submittal" | "rfi">("submittal");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const linked = data.visits.filter((v) => v.engagementId === eng.id);
  const candidates = data.visits.filter((v) => !v.engagementId && v.customerId === eng.companyId);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Submittals &amp; RFIs
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as "submittal" | "rfi")} style={INPUT}>
            <option value="submittal">Submittal</option>
            <option value="rfi">RFI</option>
          </select>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ref / number" style={{ ...INPUT, width: 130 }} />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" style={{ ...INPUT, flex: 1, minWidth: 140 }} />
          <button
            style={SMALL_BTN}
            onClick={async () => {
              if (!ref.trim() && !notes.trim()) return;
              await addSubmittalAction(eng.id, { kind, ref: ref.trim(), notes: notes.trim() });
              setRef(""); setNotes("");
              router.refresh();
            }}
          >
            + Add
          </button>
        </div>
        {eng.submittals.length === 0 && <EmptyState title="Nothing tracked yet" sub="Construction-oversight submittals and RFIs live here." />}
        {eng.submittals.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}>
            <Pill color={s.kind === "rfi" ? "#3155a8" : "#6b4fa1"}>{s.kind === "rfi" ? "RFI" : "Submittal"}</Pill>
            <b style={{ color: "#16181d" }}>{s.ref || "—"}</b>
            <span style={{ color: "#5b616e", flex: 1, minWidth: 120 }}>{s.notes}</span>
            <span style={{ color: "#9aa0ab", fontSize: 11 }}>rec’d {fmtDate(s.received)}</span>
            <select
              value={s.status}
              onChange={async (e) => { await setSubmittalStatusAction(eng.id, s.id, e.target.value as "open" | "answered" | "closed"); router.refresh(); }}
              style={{ ...INPUT, padding: "3px 6px", fontSize: 11.5 }}
            >
              <option value="open">Open</option>
              <option value="answered">Answered</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        ))}
      </Card>
      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Site visits
        </div>
        {linked.length === 0 && <EmptyState title="No linked visits" sub="Oversight visits scheduled from the Inbox can be linked here." />}
        {linked.map((v) => (
          <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}>
            <Mono>{v.id}</Mono>
            <span style={{ flex: 1, color: "#3a3f4a" }}>{v.reason} · {v.venue}</span>
            <span style={{ color: "#9aa0ab", fontSize: 11 }}>{fmtDate(v.startAt)} · {v.assignedTo}</span>
            <button style={{ ...SMALL_BTN, padding: "3px 8px" }} onClick={async () => { await linkVisitAction(v.id, null); router.refresh(); }}>
              Unlink
            </button>
          </div>
        ))}
        {candidates.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginBottom: 6 }}>Link a visit for {eng.customer}:</div>
            {candidates.slice(0, 8).map((v) => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
                <span style={{ flex: 1, color: "#5b616e" }}>{v.reason} · {fmtDate(v.startAt)}</span>
                <button style={{ ...SMALL_BTN, padding: "3px 8px" }} onClick={async () => { await linkVisitAction(v.id, eng.id); router.refresh(); }}>
                  Link
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------- documents --------------------------- */

function DocumentsTab({ eng }: { eng: ConsultingEngagement }) {
  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
        Engagement paperwork
      </div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 10 }}>
        Services agreement, insurance / liability certificates, and other signed paperwork (2 MB max per file).
      </div>
      <DocList
        docs={eng.documents}
        onRemove={(docId) => removeDocumentAction(eng.id, docId, null)}
        uploadLabel="Attach document"
        onUpload={(doc) => addDocumentAction(eng.id, doc, null)}
      />
    </Card>
  );
}

function DocList({
  docs,
  onRemove,
  onUpload,
  uploadLabel,
  compact = false,
}: {
  docs: EngagementDoc[];
  onRemove: (docId: string) => Promise<unknown>;
  onUpload: (doc: { name: string; mime: string; size: number; dataUrl: string }) => Promise<{ ok: boolean } | { ok: false; error: string }>;
  uploadLabel: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) {
        setErr("File is too large (2 MB max).");
        return;
      }
      setBusy(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const r = await onUpload({
            name: f.name,
            mime: f.type || "application/octet-stream",
            size: f.size,
            dataUrl: String(reader.result || ""),
          });
          if (r && "error" in r && r.error) setErr(r.error);
          else setErr(null);
          router.refresh();
        } finally {
          setBusy(false);
        }
      };
      reader.readAsDataURL(f);
    };
    input.click();
  };

  return (
    <div>
      {docs.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: compact ? "4px 0" : "7px 0", borderTop: compact ? "none" : "1px solid #f4f5f7", fontSize: 12.5 }}>
          <a href={d.dataUrl} download={d.name} style={{ color: "var(--accent)", textDecoration: "none", flex: 1 }}>
            {d.name}
          </a>
          <span style={{ color: "#9aa0ab", fontSize: 11 }}>
            {(d.size / 1024).toFixed(0)} KB · {d.addedBy} · {fmtDate(d.addedAt)}
          </span>
          <button style={{ ...SMALL_BTN, padding: "3px 8px", color: "#a0442b" }} onClick={async () => { await onRemove(d.id); router.refresh(); }}>
            ×
          </button>
        </div>
      ))}
      {err && <div style={{ fontSize: 12, color: "#a0442b", margin: "6px 0" }}>{err}</div>}
      <button style={{ ...SMALL_BTN, marginTop: 6, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={pick}>
        {busy ? "Attaching…" : `+ ${uploadLabel}`}
      </button>
    </div>
  );
}
