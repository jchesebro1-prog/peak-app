import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getAll,
  stageMeta,
  timeAgo,
  STAGES,
  intakeStatus,
  INTAKE_STATUS_META,
  type SurveyRecord,
  type SurveyStage,
} from "@/lib/stores/surveys";
import { VENUE_CLASSES } from "@/lib/stores/venue-classes";
import { IDENTITY, deriveInitials, fallbackColor } from "@/lib/team";
import { createSurvey, quoteFromSurvey } from "./actions";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { VISIT_STAGE_META } from "@/lib/lead-thread";
import VisitRequests, { type VisitRequestVM } from "./visit-requests";

export const metadata = { title: "Venue assessments — Quartzite-6" };

/* accent-derived tints (prototype color-mix over the office accent) */
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 13%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";

/* device-sync badge meta (Field Survey.dc.html syncMeta) */
const SYNC_META: Record<string, { ink: string; soft: string; bd: string; label: string }> = {
  requested: { ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", label: "On device" },
  pending: { ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", label: "On device" },
  syncing: { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", label: "Syncing…" },
  synced: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", label: "Synced" },
  error: { ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", label: "Retry" },
};
function syncMeta(st: string | null | undefined) {
  return SYNC_META[st || ""] || { ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", label: st || "" };
}

function initialsFor(name: string): string {
  return IDENTITY[name]?.initials || deriveInitials(name);
}
function colorFor(name: string): string {
  return IDENTITY[name]?.color || fallbackColor(name);
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function measureCount(m: Record<string, unknown> | undefined): number {
  if (!m) return 0;
  return Object.keys(m).filter((k) => m[k] !== false && String(m[k] ?? "").trim() !== "").length;
}

function summaryOf(s: SurveyRecord): string {
  return (
    (s.reason || "").trim() ||
    (s.notes || "").trim() ||
    (s.scopeOfWork || "").trim() ||
    ((s.conditions || []).length ? s.conditions.join(" · ") : "") ||
    "No details captured yet."
  );
}

function fmtDate(d: string): string {
  if (!d) return "";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

const CSS = `
  .fs-rail::-webkit-scrollbar { display: none; }
  .fs-rail { -ms-overflow-style: none; scrollbar-width: none; }
  .fs-newbtn:hover { filter: brightness(.94); }
  .fs-open:hover { background: #f4f5f7; }
  .fs-quote:hover { filter: brightness(.94); }
  @media (max-width: 700px) {
    .fs-pad { padding-left: 16px !important; padding-right: 16px !important; }
    .fs-head { flex-direction: column !important; align-items: stretch !important; }
    .fs-newbtn { width: 100%; justify-content: center; }
  }
`;

type Seg = "all" | SurveyStage;

export default async function FieldSurveyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp, all, visits] = await Promise.all([requireUser(), searchParams, getAll(), allVisits()]);

  // Cross-screen deep links (Home, Inbox, Customers) use /venue-assessments?id=<id>;
  // the capture editor lives at /venue-assessments/[id]. Redirect to keep both working.
  const idParam = one(sp.id);
  if (idParam) redirect(`/venue-assessments/${encodeURIComponent(idParam)}`);

  const stageParam = one(sp.stage);
  const stage: Seg = (STAGES as ReadonlyArray<{ key: string }>).some((s) => s.key === stageParam)
    ? (stageParam as Seg)
    : "all";
  const mine = one(sp.mine) === "1";

  const me = user.name;
  // #34 — the open-visit queue: unclaimed requests for EVERYONE, plus my
  // claimed-but-unscheduled visits (inline scheduler). Unclaimed first,
  // oldest request first within each group.
  const queueVisits = visits
    .filter(
      (v: SiteVisit) =>
        v.stage === "requested" || v.stage === "open" || (v.stage === "claimed" && v.assignedTo === me)
    )
    .sort(
      (a, b) =>
        (a.stage === "claimed" ? 1 : 0) - (b.stage === "claimed" ? 1 : 0) ||
        (a.createdAt || 0) - (b.createdAt || 0)
    );
  const visitRows: VisitRequestVM[] = queueVisits.map((v) => {
    const sm = VISIT_STAGE_META[v.stage];
    return {
      id: v.id,
      customer: v.customer || v.id,
      reason: v.reason,
      preferredTiming: v.preferredTiming,
      requestedLine: "Requested by " + (v.createdBy || "—") + " · " + timeAgo(v.createdAt),
      stageLabel: sm.label,
      stageInk: sm.ink,
      stageSoft: sm.soft,
      stageBd: sm.bd,
      surveyId: v.surveyId,
      leadId: v.leadId,
      mine: v.stage === "claimed",
    };
  });
  const stKey = (s: SurveyRecord): SurveyStage => (s.stage || "requested") as SurveyStage;
  const base = mine ? all.filter((s) => (s.assignedTo || "") === me) : all;
  const countFor = (k: Seg) => (k === "all" ? base.length : base.filter((s) => stKey(s) === k).length);

  const list = base.filter((s) => stage === "all" || stKey(s) === stage);

  const c = (k: SurveyStage) => all.filter((s) => stKey(s) === k).length;
  const standfirst =
    all.length +
    " surveys · " +
    c("requested") +
    " requested · " +
    c("scheduled") +
    " scheduled · " +
    c("onsite") +
    " on-site · " +
    c("completed") +
    " completed";

  // sync strip — online-first: server writes land synced, so pending is 0.
  const pending = all.filter((s) => s.syncState === "pending" || s.syncState === "syncing").length;
  const synced = pending === 0;
  const syncDot = synced ? "#3fae74" : "#d98a2b";
  const syncHeadline = synced ? "All synced" : pending + " change" + (pending === 1 ? "" : "s") + " to sync";
  const syncDetail = synced
    ? "Everything on this device is in the office."
    : "Saved on this device — will sync to the office.";

  const segDefs: Array<[Seg, string]> = [
    ["all", "All"],
    ["requested", "Requested"],
    ["scheduled", "Scheduled"],
    ["onsite", "On-site"],
    ["completed", "Completed"],
  ];
  const hrefFor = (key: Seg) => {
    const params = new URLSearchParams();
    if (key !== "all") params.set("stage", key);
    if (mine) params.set("mine", "1");
    const qs = params.toString();
    return "/venue-assessments" + (qs ? "?" + qs : "");
  };
  const mineHref = (() => {
    const params = new URLSearchParams();
    if (stage !== "all") params.set("stage", stage);
    if (!mine) params.set("mine", "1");
    const qs = params.toString();
    return "/venue-assessments" + (qs ? "?" + qs : "");
  })();

  const mineWord = mine ? " assigned to you" : "";
  let emptyTitle: string;
  let emptyBody: string;
  if (stage === "requested") {
    emptyTitle = "No open requests" + mineWord;
    emptyBody = "New site-survey requests created by the office show here, ready to be scheduled.";
  } else if (stage === "scheduled") {
    emptyTitle = "Nothing scheduled" + mineWord;
    emptyBody = "Requests that have been assigned a surveyor and a date appear here.";
  } else if (stage === "onsite") {
    emptyTitle = "Nothing on-site" + mineWord;
    emptyBody = "Surveys being captured in the field show here.";
  } else if (stage === "completed") {
    emptyTitle = "Nothing completed yet" + mineWord;
    emptyBody = "Finished surveys land here, ready to turn into a quote.";
  } else {
    emptyTitle = "No surveys yet" + mineWord;
    emptyBody =
      "Create a request to send a surveyor to site — the office fills the brief, then it's scheduled and captured on-site.";
  }

  return (
    <div className="pk-content fs-pad">
      <style>{CSS}</style>

      {/* header */}
      <div
        className="fs-head"
        style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", rowGap: 12, marginBottom: 16 }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Venue assessments</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>{standfirst}</div>
        </div>
        <form action={createSurvey} style={{ flexShrink: 0 }}>
          <button
            type="submit"
            className="fs-newbtn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              border: "none",
              padding: "13px 18px",
              borderRadius: 11,
              cursor: "pointer",
              minHeight: 48,
              fontFamily: "var(--font-ui)",
            }}
          >
            <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> New request
          </button>
        </form>
      </div>

      {/* sync strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          flexWrap: "wrap",
          rowGap: 11,
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          padding: "14px 16px",
          marginBottom: 16,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: "50%", flexShrink: 0, background: syncDot }} />
        <div style={{ minWidth: 160, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{syncHeadline}</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2, lineHeight: 1.45 }}>{syncDetail}</div>
        </div>
        <button
          disabled
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            padding: "10px 14px",
            borderRadius: 9,
            border: "none",
            minHeight: 42,
            color: "#fff",
            background: "#c4c9d2",
            cursor: "default",
          }}
        >
          Sync now
        </button>
      </div>

      {/* stage segmented + assigned-to-me */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap", rowGap: 10 }}>
        <div
          className="fs-rail"
          style={{ display: "flex", background: "#eceef1", borderRadius: 11, padding: 3, maxWidth: "100%", overflowX: "auto" }}
        >
          {segDefs.map(([key, label]) => {
            const on = stage === key;
            const n = countFor(key);
            return (
              <Link
                key={key}
                href={hrefFor(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "10px 14px",
                  borderRadius: 9,
                  minHeight: 42,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  color: on ? "#16181d" : "#787d87",
                  background: on ? "#fff" : "transparent",
                  boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none",
                }}
              >
                {label}
                {n > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      fontWeight: 600,
                      padding: "1px 7px",
                      borderRadius: 10,
                      color: on ? ACCENT_INK : "#aab0bb",
                      background: on ? ACCENT_SOFT : "#e3e5e9",
                    }}
                  >
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <Link
          href={mineHref}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 10,
            padding: "10px 14px",
            minHeight: 42,
            whiteSpace: "nowrap",
            textDecoration: "none",
            border: mine ? "1px solid var(--accent)" : "1px solid #e4e7ec",
            background: mine ? ACCENT_SOFT : "#fff",
            color: mine ? ACCENT_INK : "#5b616e",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: mine ? "var(--accent)" : "#c4c9d2" }} />
          Assigned to me
        </Link>
      </div>

      {/* #34 — open-visit queue, ABOVE the survey cards */}
      <VisitRequests rows={visitRows} />

      {/* empty state */}
      {list.length === 0 && (
        <div style={{ background: "#fff", border: "1.5px dashed #d6d9e0", borderRadius: 13, padding: "48px 20px", textAlign: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: ACCENT_SOFT,
              color: ACCENT_INK,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              lineHeight: 1,
              margin: "0 auto 14px",
            }}
          >
            +
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{emptyTitle}</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.5, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
            {emptyBody}
          </div>
          <form action={createSurvey} style={{ marginTop: 18 }}>
            <button
              type="submit"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                border: "none",
                padding: "12px 20px",
                borderRadius: 11,
                cursor: "pointer",
                minHeight: 48,
                fontFamily: "var(--font-ui)",
              }}
            >
              + New request
            </button>
          </form>
        </div>
      )}

      {/* cards */}
      {list.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
          {list.map((s) => {
            const sm = stageMeta(stKey(s));
            const sy = syncMeta(s.syncState);
            const ist = intakeStatus(s);
            const im = INTAKE_STATUS_META[ist];
            const assignee = (s.assignedTo || "").trim();
            const sched = fmtDate(s.scheduledDate);
            const cm = VENUE_CLASSES.find((c) => c.key === s.venueClass) || null;
            const venueBits = [s.venue, s.venueType].filter((b) => (b || "").trim());
            const venueLine = venueBits.join(" · ") || "—";
            const assignLine = assignee + (sched ? " · " + sched : "");
            const isCompleted = stKey(s) === "completed";
            const photos = s.photos || [];
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderTop: `3px solid ${sm.ink}`,
                  borderRadius: 12,
                  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                  overflow: "hidden",
                }}
              >
                <Link
                  href={`/venue-assessments/${encodeURIComponent(s.id)}`}
                  style={{ textAlign: "left", textDecoration: "none", color: "inherit", padding: "14px 15px 0" }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: sm.ink,
                          background: sm.soft,
                          border: `1px solid ${sm.bd}`,
                          padding: "3px 10px",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sm.label}
                      </span>
                      {cm && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: "#5b616e",
                            background: "#f4f5f7",
                            border: "1px solid #e6e8ec",
                            padding: "3px 10px",
                            borderRadius: 20,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cm.label}
                        </span>
                      )}
                      {ist !== "draft" && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: im.ink,
                            background: im.soft,
                            border: `1px solid ${im.bd}`,
                            padding: "3px 10px",
                            borderRadius: 20,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {im.label}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: sy.ink,
                        background: sy.soft,
                        border: `1px solid ${sy.bd}`,
                        padding: "3px 8px",
                        borderRadius: 6,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sy.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, marginTop: 11 }}>
                    {s.customer || "Untitled request"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 3 }}>{venueLine}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 4 }}>
                    {s.id} · {timeAgo(s.updatedAt)}
                  </div>

                  {assignee ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: colorFor(assignee),
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9.5,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {initialsFor(assignee)}
                      </span>
                      <span style={{ fontSize: 11.5, color: "#5b616e" }}>{assignLine}</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, fontSize: 11.5, color: "#9aa0ab" }}>
                      <span style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px dashed #d0d4db", flexShrink: 0 }} />
                      Unassigned
                    </div>
                  )}

                  <div
                    style={{
                      fontSize: 12,
                      color: "#5b616e",
                      marginTop: 10,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      minHeight: 34,
                    }}
                  >
                    {summaryOf(s)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 11, paddingBottom: 13, fontSize: 11.5, color: "#8c919c" }}>
                    <span>{measureCount(s.measurements)} measurements</span>
                    <span>
                      {photos.length} photo{photos.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </Link>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 15px", borderTop: "1px solid #f2f3f5" }}>
                  <Link
                    href={`/venue-assessments/${encodeURIComponent(s.id)}`}
                    className="fs-open"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#5b616e",
                      background: "#fff",
                      border: "1px solid #e4e7ec",
                      borderRadius: 8,
                      padding: 11,
                      minHeight: 42,
                      textDecoration: "none",
                      boxSizing: "border-box",
                    }}
                  >
                    Open
                  </Link>
                  {isCompleted && (
                    <form action={quoteFromSurvey} style={{ flex: 1 }}>
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        type="submit"
                        className="fs-quote"
                        style={{
                          width: "100%",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "#fff",
                          background: "var(--accent)",
                          border: "none",
                          borderRadius: 8,
                          padding: 11,
                          cursor: "pointer",
                          minHeight: 42,
                          fontFamily: "var(--font-ui)",
                        }}
                      >
                        Create quote →
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
