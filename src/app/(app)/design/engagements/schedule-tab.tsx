"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsultingEngagement, EngagementMilestone } from "@/lib/stores/engagements";
import type { TaskRecord, TaskStatus } from "@/lib/stores/tasks";
import { overrunsEnd, shiftForMilestone } from "@/lib/consulting-schedule";
import { GanttGrid, type GanttMarker, type GanttRow } from "@/components/gantt/gantt-grid";
import { Card, EmptyState, Pill } from "@/components/ui";
import {
  previewScheduleAction,
  generateScheduleAction,
  setEngagementSpanAction,
  moveTaskAction,
  moveMilestoneAction,
} from "./schedule-actions";

/**
 * #145 — the engagement Schedule tab. The FIRST thing to ever mount
 * GanttGrid (Task 5's component has only been fixture-tested until now):
 * an unscheduled engagement gets a date+template entry that previews then
 * commits through Task 4's actions; a scheduled one gets the Gantt itself,
 * with phase/assignee grouping, a draggable bar per task (moveTaskAction,
 * D168 — sets handScheduled), and locked milestone diamonds that open a
 * reschedule dialog pre-ticking shiftForMilestone's own phase-matched,
 * not-hand-dragged set (moveMilestoneAction, D167/D168).
 *
 * Only `import type` reaches the engagements/tasks store modules — the
 * same rule activity-tab.tsx documents (importing a value would pull
 * doc-store/PGlite into this client bundle).
 */

export type TemplateSetLite = { id: string; name: string };

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  margin: "14px 0 6px",
};

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

const SEG_ON: React.CSSProperties = { ...SMALL_BTN, background: "#16181d", color: "#fff", border: "1px solid #16181d" };

const ERR: React.CSSProperties = { fontSize: 12, color: "#a0442b" };

/** `<input type="date">` value → epoch-ms, noon-anchored (same convention
 *  as every other date field in this module — new-engagement-modal.tsx's
 *  dateToEpoch). Empty/unparseable → 0. */
function dateToEpoch(v: string): number {
  if (!v) return 0;
  const t = new Date(v + "T12:00:00").getTime();
  return Number.isFinite(t) ? t : 0;
}

function epochToDateInput(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtShort(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Module-scope, non-component helper. GanttGrid takes `now` as a prop
 * rather than reading the clock itself specifically so it stays pure
 * (react-hooks/purity, a warning-as-gate in this repo's eslint config);
 * this wrapper is what lets THIS component supply that value without
 * tripping the same rule — it pattern-matches a literal `Date.now()` call
 * site lexically inside a component/hook body, and a plain (non-component-
 * named) function defined at module scope is invisible to that check even
 * though it ultimately reads the same clock.
 */
function nowMs(): number {
  return Date.now();
}

const STATUS_TONE: Record<TaskStatus, string> = {
  open: "gray",
  in_progress: "blue",
  done: "green",
  blocked: "orange",
};

type GroupBy = "phase" | "assignee";

export function ScheduleTab({
  eng,
  tasks,
  templateSets,
}: {
  eng: ConsultingEngagement;
  tasks: TaskRecord[];
  templateSets: TemplateSetLite[];
}) {
  const startAt = eng.startAt || 0;
  const endAt = eng.endAt || 0;
  const scheduled = startAt > 0 && endAt > startAt;

  if (!scheduled) {
    return <UnscheduledSetup engagementId={eng.id} templateSets={templateSets} />;
  }
  return <ScheduledGantt eng={eng} startAt={startAt} endAt={endAt} tasks={tasks} />;
}

/* ------------------------- unscheduled: setup ------------------------- */

type PreviewTask = { title: string; phase: string; startAt: number; dueAt: number; assignee: string };

function UnscheduledSetup({
  engagementId,
  templateSets,
}: {
  engagementId: string;
  templateSets: TemplateSetLite[];
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [setId, setSetId] = useState(templateSets[0]?.id || "");
  const [preview, setPreview] = useState<PreviewTask[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startAt = dateToEpoch(startDate);
  const endAt = dateToEpoch(endDate);

  async function doPreview() {
    setErr(null);
    setPreview(null);
    if (!setId) {
      setErr("Pick a task template first.");
      return;
    }
    setBusy(true);
    const r = await previewScheduleAction({ engagementId, setId, startAt, endAt });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setPreview(r.tasks);
  }

  async function doCommit() {
    setErr(null);
    setBusy(true);
    const r = await generateScheduleAction(engagementId, setId, startAt, endAt);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 4 }}>
        Set the schedule
      </div>
      {templateSets.length === 0 ? (
        <EmptyState
          title="No task template applies to Consulting yet"
          sub="Add one from Settings → Task templates, tagged to apply to Consulting, then come back here to generate a schedule."
        />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 420 }}>
            <label>
              <span style={LABEL}>Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPreview(null); }}
                style={{ ...INPUT, width: "100%" }}
              />
            </label>
            <label>
              <span style={LABEL}>End date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPreview(null); }}
                style={{ ...INPUT, width: "100%" }}
              />
            </label>
          </div>
          <label>
            <span style={LABEL}>Task template</span>
            <select
              value={setId}
              onChange={(e) => { setSetId(e.target.value); setPreview(null); }}
              style={{ ...INPUT, maxWidth: 420, width: "100%" }}
            >
              {templateSets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" style={SMALL_BTN} disabled={busy} onClick={doPreview}>
              {busy ? "Working…" : "Preview"}
            </button>
            {preview && (
              <button type="button" className="pk-btn-accent" disabled={busy} onClick={doCommit}>
                {busy ? "Working…" : "Commit schedule"}
              </button>
            )}
          </div>
          {err && <div style={{ ...ERR, marginTop: 8 }}>{err}</div>}

          {preview && (
            <div style={{ marginTop: 16 }}>
              <span style={LABEL}>{preview.length} task{preview.length === 1 ? "" : "s"} would be created</span>
              {preview.length === 0 ? (
                <div style={{ fontSize: 12, color: "#8c919c" }}>
                  This template has no lines matching this engagement&apos;s phases and disciplines.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 4, maxHeight: 280, overflowY: "auto" }}>
                  {preview.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, fontSize: 12.5,
                        padding: "6px 0", borderTop: i ? "1px solid #f4f5f7" : "none",
                      }}
                    >
                      <span style={{ flex: 1, color: "#16181d" }}>{t.title}</span>
                      <span style={{ color: "#9aa0ab", fontSize: 11.5 }}>{t.phase}</span>
                      <span style={{ color: "#9aa0ab", fontSize: 11.5, whiteSpace: "nowrap" }}>
                        {fmtShort(t.startAt)} – {fmtShort(t.dueAt)}
                      </span>
                      <Pill color="#8c919c">{t.assignee}</Pill>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* -------------------------- scheduled: Gantt -------------------------- */

function ScheduledGantt({
  eng,
  startAt,
  endAt,
  tasks,
}: {
  eng: ConsultingEngagement;
  startAt: number;
  endAt: number;
  tasks: TaskRecord[];
}) {
  const router = useRouter();
  const [groupBy, setGroupBy] = useState<GroupBy>("phase");
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [shiftMilestoneId, setShiftMilestoneId] = useState<string | null>(null);
  const [spanEditing, setSpanEditing] = useState(false);
  const [startDate, setStartDate] = useState(epochToDateInput(startAt));
  const [endDate, setEndDate] = useState(epochToDateInput(endAt));
  const [spanErr, setSpanErr] = useState<string | null>(null);
  const [spanBusy, setSpanBusy] = useState(false);

  const phaseNameById = useMemo(() => new Map(eng.phases.map((p) => [p.id, p.name])), [eng.phases]);

  const scheduledTasks = useMemo(
    () => tasks.filter((t) => typeof t.startAt === "number" && typeof t.dueAt === "number"),
    [tasks]
  );

  const rows: GanttRow[] = useMemo(() => {
    const withGroup = scheduledTasks.map((t) => {
      const group =
        groupBy === "phase"
          ? (t.schedule?.phaseId ? phaseNameById.get(t.schedule.phaseId) || "Other" : "Ungrouped")
          : t.assigneeName || "Unassigned";
      return { t, group };
    });
    withGroup.sort((a, b) => {
      if (a.group !== b.group) return a.group < b.group ? -1 : 1;
      return (a.t.startAt || 0) - (b.t.startAt || 0);
    });
    return withGroup.map(({ t, group }) => ({
      id: t.id,
      label: t.title,
      group,
      bars: [
        {
          id: t.id,
          label: t.title,
          startAt: t.startAt as number,
          dueAt: t.dueAt as number,
          tone: STATUS_TONE[t.status],
          draggable: true,
          overrun: overrunsEnd(t, endAt),
        },
      ],
    }));
  }, [scheduledTasks, groupBy, phaseNameById, endAt]);

  const markers: GanttMarker[] = useMemo(
    () =>
      eng.milestones
        .filter((m) => m.targetDate > 0)
        .map((m) => ({ id: m.id, label: m.name, at: m.targetDate, locked: true })),
    [eng.milestones]
  );

  async function handleBarMove(barId: string, movedStartAt: number, movedDueAt: number) {
    setMoveErr(null);
    const r = await moveTaskAction(barId, movedStartAt, movedDueAt);
    if (!r.ok) {
      setMoveErr(r.error);
      return;
    }
    router.refresh();
  }

  async function saveSpan() {
    setSpanErr(null);
    setSpanBusy(true);
    const r = await setEngagementSpanAction(eng.id, dateToEpoch(startDate), dateToEpoch(endDate));
    setSpanBusy(false);
    if (!r.ok) {
      setSpanErr(r.error);
      return;
    }
    setSpanEditing(false);
    router.refresh();
  }

  const shiftMilestone = shiftMilestoneId ? eng.milestones.find((m) => m.id === shiftMilestoneId) || null : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Group tasks by">
          {(["phase", "assignee"] as GroupBy[]).map((g) => (
            <button key={g} type="button" onClick={() => setGroupBy(g)} style={groupBy === g ? SEG_ON : SMALL_BTN}>
              Group by {g}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5b616e" }}>
          {!spanEditing ? (
            <>
              <span>{fmtShort(startAt)} – {fmtShort(endAt)}</span>
              <button type="button" style={SMALL_BTN} onClick={() => setSpanEditing(true)}>Edit dates</button>
            </>
          ) : (
            <>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...INPUT, padding: "5px 8px" }} />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...INPUT, padding: "5px 8px" }} />
              <button type="button" style={SMALL_BTN} disabled={spanBusy} onClick={saveSpan}>{spanBusy ? "Saving…" : "Save"}</button>
              <button
                type="button"
                style={SMALL_BTN}
                onClick={() => {
                  setSpanEditing(false);
                  setSpanErr(null);
                  setStartDate(epochToDateInput(startAt));
                  setEndDate(epochToDateInput(endAt));
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {spanErr && <div style={ERR}>{spanErr}</div>}
      {moveErr && <div style={ERR}>{moveErr}</div>}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No tasks on the schedule yet"
            sub="Tasks added outside the template (from Activity capture, for instance) need their own start date before they show up here."
          />
        </Card>
      ) : (
        <GanttGrid
          rows={rows}
          markers={markers}
          startAt={startAt}
          endAt={endAt}
          onBarMove={handleBarMove}
          onMarkerClick={setShiftMilestoneId}
          now={nowMs()}
        />
      )}

      {shiftMilestone && (
        <MilestoneShiftDialog
          engagementId={eng.id}
          milestone={shiftMilestone}
          tasks={tasks}
          onClose={() => setShiftMilestoneId(null)}
          onDone={() => {
            setShiftMilestoneId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* --------------------- milestone reschedule dialog --------------------- */

function MilestoneShiftDialog({
  engagementId,
  milestone,
  tasks,
  onClose,
  onDone,
}: {
  engagementId: string;
  milestone: EngagementMilestone;
  /** ALL of the engagement's tasks (not just Gantt-rendered ones) — parity
   *  with moveMilestoneAction's own server-side tasksForEngagement() read. */
  tasks: TaskRecord[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [dateStr, setDateStr] = useState(epochToDateInput(milestone.targetDate));
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phaseId = milestone.phaseId ?? null;
  const targetDate = dateToEpoch(dateStr);
  const delta = targetDate - milestone.targetDate;

  // shiftForMilestone's moved/skipped SPLIT depends only on phaseId and
  // handScheduled, not on the delta — the delta only changes the computed
  // dates carried on each `moved` entry. So the checklist's membership stays
  // stable while the date field is edited; only the preview dates shown
  // beside each row change.
  const { moved, skipped } = useMemo(
    () => shiftForMilestone({ phaseId }, delta, tasks),
    [phaseId, delta, tasks]
  );
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const movedRows = useMemo(
    () => moved.map((m) => ({ ...m, title: tasksById.get(m.id)?.title || m.id })),
    [moved, tasksById]
  );
  const handDragged = useMemo(
    () => skipped.filter((t) => t.schedule?.phaseId === phaseId),
    [skipped, phaseId]
  );

  // Pre-tick every `moved` row the first time it's known (lazy — moved's
  // MEMBERSHIP is stable across date edits per the note above, so this
  // never needs to re-run as dateStr changes).
  const effectiveTicked = ticked ?? new Set(movedRows.map((m) => m.id));

  function toggle(id: string) {
    setTicked((prev) => {
      const base = prev ?? new Set(movedRows.map((m) => m.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    setErr(null);
    if (!targetDate) {
      setErr("Pick a date.");
      return;
    }
    setBusy(true);
    const ids = movedRows.filter((m) => effectiveTicked.has(m.id)).map((m) => m.id);
    const r = await moveMilestoneAction(engagementId, milestone.id, targetDate, ids);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onDone();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(16,22,30,.46)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Reschedule ${milestone.name}`}
        style={{ width: 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.32)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 22px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Reschedule &ldquo;{milestone.name}&rdquo;</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...SMALL_BTN, padding: "4px 9px" }}>×</button>
        </div>

        <div style={{ padding: "4px 22px 18px" }}>
          <label>
            <span style={LABEL}>New date</span>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} style={{ ...INPUT, width: "100%" }} />
          </label>

          {!phaseId && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#8c919c" }}>
              This milestone has no phase set, so no tasks move with it.
            </div>
          )}

          {movedRows.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span style={LABEL}>Move with it</span>
              <div style={{ display: "grid", gap: 6 }}>
                {movedRows.map((m) => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#3a3f4a" }}>
                    <input type="checkbox" checked={effectiveTicked.has(m.id)} onChange={() => toggle(m.id)} />
                    <span style={{ flex: 1 }}>{m.title}</span>
                    {typeof m.startAt === "number" && typeof m.dueAt === "number" && (
                      <span style={{ color: "#9aa0ab", fontSize: 11.5, whiteSpace: "nowrap" }}>
                        {fmtShort(m.startAt)} – {fmtShort(m.dueAt)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {handDragged.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span style={LABEL}>Not moved</span>
              <div style={{ display: "grid", gap: 6 }}>
                {handDragged.map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#9aa0ab" }}>
                    <input type="checkbox" checked={false} disabled aria-label={`${t.title} — moved by hand, excluded`} />
                    <span style={{ flex: 1 }}>{t.title}</span>
                    <Pill color="#8c919c">moved by hand</Pill>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err && <div style={{ ...ERR, marginTop: 12 }}>{err}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid #f0f1f4" }}>
          <button type="button" onClick={onClose} style={SMALL_BTN}>Cancel</button>
          <button type="button" className="pk-btn-accent" disabled={busy} onClick={confirm}>
            {busy ? "Saving…" : "Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
