/**
 * Consulting schedule engine (#145, D166/D168).
 *
 * ZERO imports of any kind — the consulting-stages.ts rule. This module is
 * client-bundled (the Gantt drags against it), server-trusted (the actions
 * generate through it), and spec-tested with no DB.
 *
 * The model: an engagement carries a typed startAt/endAt. Selected phases
 * carry weights and divide that span into windows. A template line carries
 * a start percentage and a length percentage WITHIN ITS OWN PHASE WINDOW —
 * so a longer engagement gives every task proportionally more room, and
 * dropping a phase redistributes the remainder instead of stranding tasks
 * at stale absolute positions.
 */

export type PhaseWeight = { phaseId: string; name: string; weight: number };
export type PhaseWindow = { phaseId: string; name: string; startAt: number; endAt: number };

export type ScheduleLine = {
  key: string;
  title: string;
  section: string;
  phase: string;
  /** "" matches every discipline (D165). */
  discipline: string;
  startPct: number;
  lengthPct: number;
};

export type GeneratedTask = {
  key: string;
  title: string;
  section: string;
  phaseId: string;
  startPct: number;
  lengthPct: number;
  startAt: number;
  dueAt: number;
};

export type GeneratedMilestone = { id: string; targetDate: number };

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();

/** Non-finite, zero and negative weights all read as 1 — so the sum is
 *  never zero and "all weights 0" degrades to equal division. */
function safeWeight(w: unknown): number {
  const n = Number(w);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function clampPct(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/**
 * Divide [startAt, endAt] among the phases in proportion to their weights.
 * Each boundary is computed from the RUNNING TOTAL rather than by adding
 * widths, so rounding never accumulates: the last window's end is exactly
 * endAt. An end at or before the start yields zero-length windows.
 */
export function phaseWindows(
  startAt: number,
  endAt: number,
  phases: readonly PhaseWeight[]
): PhaseWindow[] {
  if (!phases.length) return [];
  const weights = phases.map((p) => safeWeight(p.weight));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, endAt - startAt);
  const out: PhaseWindow[] = [];
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    const s = startAt + Math.round((span * acc) / total);
    acc += weights[i];
    const e = startAt + Math.round((span * acc) / total);
    out.push({ phaseId: phases[i].phaseId, name: phases[i].name, startAt: s, endAt: e });
  }
  return out;
}

/**
 * The scope gate (D165): a line expands when the engagement has its phase
 * AND (the line names no discipline OR the engagement bought that one).
 */
export function selectLines<T extends { phase: string; discipline: string }>(
  lines: readonly T[],
  phases: readonly string[],
  disciplines: readonly string[]
): T[] {
  const ps = new Set(phases.map(norm));
  const ds = new Set(disciplines.map(norm));
  return lines.filter((l) => {
    if (!ps.has(norm(l.phase))) return false;
    const d = norm(l.discipline);
    return !d || ds.has(d);
  });
}

/** Place one line inside its window. The due date is clamped to the window
 *  end, so startPct + lengthPct > 100 shortens the bar rather than spilling
 *  it into the next phase. */
export function placeTask(
  window: PhaseWindow,
  startPct: number,
  lengthPct: number
): { startAt: number; dueAt: number } {
  const len = Math.max(0, window.endAt - window.startAt);
  const startAt = window.startAt + Math.round((len * clampPct(startPct)) / 100);
  const dueAt = Math.min(window.endAt, startAt + Math.round((len * clampPct(lengthPct)) / 100));
  return { startAt, dueAt };
}

/**
 * Floor to the start of the LOCAL calendar day containing `ms` — the same
 * definition gantt-lib.ts's `snapToDay` uses, duplicated there rather than
 * imported (this file is zero-import by design; see the file header) but
 * exported HERE for every other caller that needs the same day-granular
 * comparison this module's own `overrunsEnd` uses below: a stored
 * `EngagementMilestone.targetDate` is an arbitrary instant (a
 * phase-matched milestone is dated to its `phaseWindows` window's
 * `endAt`, never noon-anchored), so comparing it against a freshly
 * `dateToEpoch`'d (local-noon) input by raw instant produces a false
 * non-zero delta whenever the two happen to fall on the SAME local day —
 * exactly the "confirm without changing anything" case the Schedule
 * tab's reschedule dialog and `moveMilestoneAction` both have to get
 * right (#145 review fix, round 3).
 */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Work past the committed end date is flagged, never blocked.
 *
 * Compared by LOCAL CALENDAR DAY, not raw instant (#145 review fix,
 * live-verification round). Every date this module's callers write is
 * anchored at LOCAL NOON (every `<input type="date">` in this app goes
 * through `new Date(v+"T12:00:00")`), so comparing raw timestamps flagged
 * a task due later the SAME local day as `endAt` purely because its clock
 * time fell after noon — a false positive a live drag-and-drop test
 * surfaced. A day-granular comparison is also just the right semantics:
 * "the committed end date" names a calendar day, not an instant — a task
 * due at 11pm on that day has not overrun it; one due 12:01am the next
 * day has.
 */
export function overrunsEnd(task: { dueAt: number | null }, endAt: number): boolean {
  if (typeof task.dueAt !== "number") return false;
  return startOfLocalDay(task.dueAt) > startOfLocalDay(endAt);
}

export type ShiftCandidate = {
  id: string;
  schedule: { phaseId: string } | null;
  handScheduled: boolean;
  startAt: number | null;
  dueAt: number | null;
};

export type ShiftedTask = { id: string; startAt: number | null; dueAt: number | null };

/**
 * Which tasks a milestone move should offer to bring along (D168): the
 * milestone's own phase, minus anything hand-dragged. A milestone with no
 * phase moves nothing — the dialog degrades to an empty checklist rather
 * than guessing. `moved` carries the NEW dates; the caller persists them.
 */
export function shiftForMilestone<T extends ShiftCandidate>(
  milestone: { phaseId: string | null },
  deltaMs: number,
  tasks: readonly T[]
): { moved: ShiftedTask[]; skipped: T[] } {
  if (!milestone.phaseId) return { moved: [], skipped: tasks.slice() };
  const moved: ShiftedTask[] = [];
  const skipped: T[] = [];
  for (const t of tasks) {
    if (t.schedule?.phaseId === milestone.phaseId && !t.handScheduled) {
      moved.push({
        id: t.id,
        startAt: typeof t.startAt === "number" ? t.startAt + deltaMs : null,
        dueAt: typeof t.dueAt === "number" ? t.dueAt + deltaMs : null,
      });
    } else {
      skipped.push(t);
    }
  }
  return { moved, skipped };
}

export type GenerateInput = {
  startAt: number;
  endAt: number;
  phases: readonly PhaseWeight[];
  disciplines: readonly string[];
  lines: readonly ScheduleLine[];
  milestones: readonly { id: string; phaseId: string | null; targetDate: number }[];
};

/**
 * The whole creation-time computation. A phase-matched milestone is dated
 * to its window's END — a deliverable is due when its phase finishes; an
 * unmatched one keeps whatever date it already had (0 = unscheduled, which
 * keeps it out of the Reports billing forecast).
 */
export function generateSchedule(input: GenerateInput): {
  tasks: GeneratedTask[];
  milestones: GeneratedMilestone[];
} {
  const windows = phaseWindows(input.startAt, input.endAt, input.phases);
  const byId = new Map(windows.map((w) => [w.phaseId, w]));
  const byName = new Map(windows.map((w) => [norm(w.name), w]));

  const chosen = selectLines(
    input.lines,
    input.phases.map((p) => p.name),
    input.disciplines
  );

  const tasks: GeneratedTask[] = [];
  for (const line of chosen) {
    const w = byName.get(norm(line.phase));
    if (!w) continue;
    const { startAt, dueAt } = placeTask(w, line.startPct, line.lengthPct);
    tasks.push({
      key: line.key,
      title: line.title,
      section: line.section,
      phaseId: w.phaseId,
      startPct: clampPct(line.startPct),
      lengthPct: clampPct(line.lengthPct),
      startAt,
      dueAt,
    });
  }

  const milestones: GeneratedMilestone[] = input.milestones.map((m) => {
    const w = m.phaseId ? byId.get(m.phaseId) : null;
    return { id: m.id, targetDate: w ? w.endAt : m.targetDate };
  });

  return { tasks, milestones };
}

/** #145 — the creation-step gate. Returns null when the span is usable, or
 *  a message naming the field at fault. Generation is never attempted on a
 *  degenerate span (spec §6). */
export function validateSpan(startAt: number, endAt: number): string | null {
  if (!Number.isFinite(startAt) || startAt <= 0) return "Pick a start date for this engagement.";
  if (!Number.isFinite(endAt) || endAt <= 0) return "Pick an end date for this engagement.";
  if (endAt <= startAt) return "The end date must be after the start date.";
  return null;
}

/**
 * Name → id, keyed by the same normalization `norm()` uses everywhere else
 * in this file (trimmed, case-insensitive). #145 D166/D168 — shared by
 * `withEngagementPhaseIds` and by a caller defaulting a milestone's phase
 * (`defaultMilestonePhaseId`), so both use exactly one matching rule.
 *
 * A DUPLICATE name collapses to one id (last one wins): phase names are
 * assumed unique per engagement (nothing else in the app dedupes a rename),
 * so this is a known, accepted limitation rather than a defended case — two
 * same-named phases would silently alias one phase's tasks/milestones onto
 * the other's window.
 */
export function phaseIdsByName(phases: readonly { id: string; name: string }[]): Map<string, string> {
  return new Map(phases.map((p) => [norm(p.name), p.id]));
}

/**
 * #145 D166 — re-key a settings-derived weight list (whose ids are
 * NAME-derived slugs — see `phaseWeightsFor` in settings.ts) onto an
 * engagement's own phase ids (`uid("ph-")`, assigned once at
 * phase-creation and referenced everywhere downstream: a milestone's
 * `phaseId`, a generated task's `schedule.phaseId`, `shiftForMilestone`).
 * Without this, a task placed by `generateSchedule` and a milestone dated
 * by `defaultMilestonePhaseId` would carry INCOMPARABLE phase ids even
 * though they mean the same phase.
 *
 * Matched by phase NAME (via `phaseIdsByName`) rather than by array
 * position: at today's call sites `phaseWeightsFor` is always given
 * `eng.phases`' own name list, so the two arrays already agree on both
 * order and length and position would work too — but name matching
 * survives that agreement breaking later (a caller that builds the weight
 * list some other way) without silently mislabeling a phase.
 *
 * - A weight whose name has no match in `enginePhases` keeps its own slug
 *   id rather than being dropped — the output is never shorter than
 *   `weights`.
 * - An engine phase absent from `weights` simply has no entry in the
 *   output; this function only re-keys what it's handed, it doesn't invent
 *   phases the weight list never had an opinion on.
 * - See `phaseIdsByName`'s doc comment for the duplicate-name caveat.
 */
export function withEngagementPhaseIds(
  weights: readonly PhaseWeight[],
  enginePhases: readonly { id: string; name: string }[]
): PhaseWeight[] {
  const byName = phaseIdsByName(enginePhases);
  return weights.map((w) => ({ ...w, phaseId: byName.get(norm(w.name)) ?? w.phaseId }));
}

/**
 * #145 D168 — a milestone's phase defaults by exact NAME match against the
 * engagement's own phases (via the caller-built `phasesByName`, from
 * `phaseIdsByName`) — case-insensitive, trimmed, the same rule
 * `withEngagementPhaseIds` uses. An already-set `phaseId` is left alone;
 * no match at all defaults to null rather than guessing, which keeps the
 * milestone out of the Reports billing forecast until someone sets it by
 * hand from the dropdown.
 */
export function defaultMilestonePhaseId(
  milestone: { name: string; phaseId?: string | null },
  phasesByName: ReadonlyMap<string, string>
): string | null {
  return milestone.phaseId ?? phasesByName.get(norm(milestone.name)) ?? null;
}
