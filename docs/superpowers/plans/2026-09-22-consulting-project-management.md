# Consulting Project Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give consulting engagements (`CE-####`) scope-driven task templates whose deadlines scale proportionally between a typed start and end date, team assignment, a draggable Gantt per engagement and across all projects, and an Activity tab that captures notes, files and tasks from a discussion in one action.

**Architecture:** All date arithmetic lives in one pure, import-free module (`src/lib/consulting-schedule.ts`) that accepts primitives, never records — this is what lets install `Projects` be wired in later without a rewrite. Everything else is store-field additions with normalize-on-read defaults, two new tabs on the existing engagement view, a shared Gantt component used by both the engagement tab and `/schedule`, and a `task_templates` entry in the existing import registry.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4 + `pk-*` classes, Drizzle doc-store over Postgres/PGlite, server actions, `tsx` script test harness.

**Spec:** `docs/superpowers/specs/2026-09-22-consulting-project-management-design.md`

## Global Constraints

- **Punch item #145. Decisions D164–D172.** Next free numbers verified 2026-09-22 (highest existing: item #144, D163).
- **Never open the dev DB twice.** Check `ps aux | grep tsx` and kill strays before `npm run dev`. Never leave a `tsx` script running. Copy `.data` to `.data-backup-<date>/` before any recovery. (AGENTS.md — this has destroyed the dev DB three times.)
- **Node is at `~/.local/node/bin`** (already in `~/.zprofile` PATH).
- **Gates, every task:** `npx tsc --noEmit` 0 errors · `npm run lint` at the stashed baseline (currently **120 warnings / 0 errors** — new files must be silent) · `npm run test:specs` all PASS · `npm run test:smoke` ALL PASSED.
- **Timestamps are epoch-ms numbers.** Never `Date` objects in stored records.
- **No new runtime dependencies.** Drive/Gmail use plain `fetch`; keep that stance.
- **Never hardcode accent-colored UI** — accent flows from `--accent` on `<html>`.
- **Normalize-on-read for every new field.** Absent must be safe; nothing is bulk-rewritten (the `EngagementPhase.checklist` / `comments` idiom).
- **Spec tests** are plain `ok(condition, message)` assertions appended to `scripts/test-review-and-spec.ts`, with imports added at the top. Synchronous assertions may be appended at end of file — they run before the async promise chain resolves.
- **Permission gate** for admin authoring is `manage_users` via `requirePerm` / `can` (D149 precedent — there is no "manage templates" perm).

---

### Task 1: The pure scheduling engine

The whole feature's date math, with zero imports so it is client-bundleable and testable without a DB. Build it first and alone: every later task consumes it.

**Files:**
- Create: `src/lib/consulting-schedule.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `PhaseWeight`, `PhaseWindow`, `ScheduleLine`, `GeneratedTask`, `GeneratedMilestone`, `phaseWindows()`, `selectLines()`, `placeTask()`, `overrunsEnd()`, `shiftForMilestone()`, `generateSchedule()`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ====== #145 (D164–D172): consulting schedule engine ====== */
const DAY145 = 86400000;
const OCT6 = Date.UTC(2026, 9, 6);
const MAR30 = Date.UTC(2027, 2, 30);
const W145: PhaseWeight[] = [
  { phaseId: "ph-a", name: "Assessment", weight: 2 },
  { phaseId: "ph-b", name: "Schematic Design", weight: 4 },
  { phaseId: "ph-c", name: "Design Development", weight: 6 },
  { phaseId: "ph-d", name: "Final Documents", weight: 5 },
  { phaseId: "ph-e", name: "Bid Support", weight: 3 },
];
const win145 = phaseWindows(OCT6, MAR30, W145);
ok(win145.length === 5, "#145 phaseWindows returns one window per phase");
ok(win145[0].startAt === OCT6, "#145 the first window starts exactly at the project start");
ok(win145[4].endAt === MAR30, "#145 the last window ends exactly on the project end — proportional division never drifts");
ok(win145[1].startAt === win145[0].endAt, "#145 windows abut with no gap");
ok(
  Math.round((win145[2].endAt - win145[2].startAt) / DAY145) === 53,
  "#145 Design Development takes 6/20 of a 175-day span (52.5d, rounded)"
);
// Dropping a phase redistributes the remainder in proportion — the whole
// point of units over absolute days (D166).
const dropped145 = phaseWindows(OCT6, MAR30, W145.filter((p) => p.phaseId !== "ph-e"));
ok(dropped145[3].endAt === MAR30 && dropped145.length === 4, "#145 dropping a phase stretches the rest to still fill the span");
ok(dropped145[2].endAt - dropped145[2].startAt > win145[2].endAt - win145[2].startAt, "#145 every surviving window grows when a phase is dropped");

// Degenerate inputs (spec §4.2) — all handled, never thrown.
ok(phaseWindows(OCT6, OCT6 - DAY145, W145).every((w) => w.startAt === OCT6 && w.endAt === OCT6), "#145 an end before the start collapses every window onto the start");
ok(phaseWindows(OCT6, MAR30, []).length === 0, "#145 no phases means no windows");
const zeroW145 = phaseWindows(OCT6, MAR30, W145.map((p) => ({ ...p, weight: 0 })));
ok(
  zeroW145[0].endAt - zeroW145[0].startAt === zeroW145[3].endAt - zeroW145[3].startAt,
  "#145 all-zero weights divide the span equally rather than dividing by zero"
);
const negW145 = phaseWindows(OCT6, MAR30, [{ phaseId: "p1", name: "A", weight: -4 }, { phaseId: "p2", name: "B", weight: 1 }]);
ok(negW145[0].endAt - negW145[0].startAt === negW145[1].endAt - negW145[1].startAt, "#145 a negative weight is treated as 1, not as a subtraction");

// Scope gate (D165): phase must match; a BLANK discipline matches everything.
const lines145: ScheduleLine[] = [
  { key: "l1", title: "Verify grid", section: "Assessment", phase: "Assessment", discipline: "rigging", startPct: 0, lengthPct: 20 },
  { key: "l2", title: "Site photos", section: "Assessment", phase: "Assessment", discipline: "", startPct: 10, lengthPct: 15 },
  { key: "l3", title: "Fixture count", section: "Assessment", phase: "Assessment", discipline: "lighting", startPct: 0, lengthPct: 20 },
  { key: "l4", title: "Bid walk", section: "Bid", phase: "Bid Support", discipline: "", startPct: 0, lengthPct: 50 },
];
const sel145 = selectLines(lines145, ["Assessment", "Bid Support"], ["rigging", "curtain"]);
ok(sel145.map((l) => l.key).join(",") === "l1,l2,l4", "#145 selectLines keeps matching disciplines and every blank-discipline line, drops the rest");
ok(selectLines(lines145, ["Assessment"], []).map((l) => l.key).join(",") === "l2", "#145 an engagement with no disciplines still gets its blank-discipline lines");
ok(selectLines(lines145, [" assessment "], ["RIGGING"]).length === 2, "#145 selectLines matches case-insensitively and ignores surrounding space");

// Placement within a window, and the overrun clamp (spec §4.2).
const fd145 = win145[3];
const placed145 = placeTask(fd145, 60, 20);
ok(placed145.startAt > fd145.startAt && placed145.dueAt <= fd145.endAt, "#145 placeTask lands inside its own phase window");
ok(Math.round((placed145.startAt - fd145.startAt) / DAY145) === 26, "#145 startPct 60 of a 43.75-day window is 26 days in");
const spill145 = placeTask(fd145, 90, 50);
ok(spill145.dueAt === fd145.endAt, "#145 startPct + lengthPct over 100 clamps to the window end instead of spilling into the next phase");
ok(placeTask(fd145, -10, 999).startAt === fd145.startAt, "#145 out-of-range percentages clamp rather than throwing");
ok(placeTask({ phaseId: "x", name: "X", startAt: OCT6, endAt: OCT6 }, 50, 50).startAt === OCT6, "#145 a zero-length window places every task on its start");

ok(overrunsEnd({ dueAt: MAR30 + DAY145 }, MAR30), "#145 overrunsEnd flags work past the committed end date");
ok(!overrunsEnd({ dueAt: null }, MAR30), "#145 an undated task never counts as an overrun");

// Milestone shift (D168): the milestone's phase, minus hand-dragged tasks.
const tasks145 = [
  { id: "T-1", schedule: { phaseId: "ph-d" }, handScheduled: false, startAt: OCT6, dueAt: OCT6 + DAY145 },
  { id: "T-2", schedule: { phaseId: "ph-d" }, handScheduled: true, startAt: OCT6, dueAt: OCT6 + DAY145 },
  { id: "T-3", schedule: { phaseId: "ph-e" }, handScheduled: false, startAt: OCT6, dueAt: OCT6 + DAY145 },
  { id: "T-4", schedule: null, handScheduled: false, startAt: null, dueAt: null },
];
const shift145 = shiftForMilestone({ phaseId: "ph-d" }, 14 * DAY145, tasks145);
ok(shift145.moved.length === 1 && shift145.moved[0].id === "T-1", "#145 shiftForMilestone moves only its own phase's untouched tasks");
ok(shift145.moved[0].startAt === OCT6 + 14 * DAY145, "#145 a moved task shifts by exactly the milestone's delta");
ok(shift145.skipped.map((t) => t.id).join(",") === "T-2,T-3,T-4", "#145 a hand-dragged task is never moved by the app");
ok(shiftForMilestone({ phaseId: null }, DAY145, tasks145).moved.length === 0, "#145 a milestone with no phase pre-ticks nothing and degrades to the manual checklist");

// Whole-schedule generation.
const gen145 = generateSchedule({
  startAt: OCT6, endAt: MAR30, phases: W145, disciplines: ["rigging"], lines: lines145,
  milestones: [{ id: "ms-1", phaseId: "ph-d", targetDate: 0 }, { id: "ms-2", phaseId: null, targetDate: 0 }],
});
ok(gen145.tasks.length === 3, "#145 generateSchedule expands exactly the in-scope lines");
ok(gen145.tasks.every((t) => t.startAt >= OCT6 && t.dueAt <= MAR30), "#145 every generated task lands inside the project span");
ok(gen145.milestones.find((m) => m.id === "ms-1")?.targetDate === win145[3].endAt, "#145 a phase-matched milestone is dated to its phase window's end");
ok(gen145.milestones.find((m) => m.id === "ms-2")?.targetDate === 0, "#145 a milestone with no phase stays unscheduled and out of the billing forecast");
```

Add to the imports at the top of the same file:

```ts
import {
  generateSchedule, overrunsEnd, phaseWindows, placeTask, selectLines, shiftForMilestone,
  type PhaseWeight, type ScheduleLine,
} from "@/lib/consulting-schedule";
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:specs
```

Expected: fails to start — `Cannot find module '@/lib/consulting-schedule'`.

- [ ] **Step 3: Write the engine**

Create `src/lib/consulting-schedule.ts`:

```ts
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

/** Work past the committed end date is flagged, never blocked. */
export function overrunsEnd(task: { dueAt: number | null }, endAt: number): boolean {
  return typeof task.dueAt === "number" && task.dueAt > endAt;
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:specs
```

Expected: every `#145` line prints `PASS`, final line `ALL PASSED`.

- [ ] **Step 5: Run the type and lint gates**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

Expected: `tsc` silent; lint at 120 warnings / 0 errors with nothing from the new file.

- [ ] **Step 6: Commit**

```bash
git add src/lib/consulting-schedule.ts scripts/test-review-and-spec.ts
git commit -m "feat(consulting): pure scheduling engine — proportional phase windows (#145, D166)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Record fields — engagement, task, note, settings

Every stored-shape change in one task so the normalize-on-read contract is reviewed as a whole. No UI yet.

**Files:**
- Modify: `src/lib/stores/engagements.ts` (`ConsultingEngagement`, `EngagementMilestone`, `normalizeEngagement`)
- Modify: `src/lib/stores/tasks.ts` (`TaskRecord`, `normalizeTask`, add `tasksForEngagement`)
- Modify: `src/lib/stores/notes.ts` (`NoteParentKind`, `NoteRecord`, `normalizeNote`, `addNoteRecord`)
- Modify: `src/lib/settings.ts` (`AppSettingsData` + two merge helpers)
- Modify: `src/lib/task-template-kinds.ts` (add `"consulting"`)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1 (deliberately — the engine takes primitives).
- Produces: `ConsultingEngagement.startAt/endAt/disciplines`, `EngagementMilestone.phaseId`, `TaskRecord.engagementId/startAt/schedule/handScheduled`, `tasksForEngagement(id)`, `NoteRecord.attachments/taskIds`, `mergedConsultingDisciplines(stored)`, `phaseWeightsFor(stored, phaseNames)`, `TemplateRecordKind` including `"consulting"`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* ====== #145: record shapes normalize absent fields ====== */
const bareEng145 = normalizeEngagementRecord({ id: "CE-1043", name: "North HS", status: "design" } as never);
ok(bareEng145.startAt === 0 && bareEng145.endAt === 0, "#145 an engagement written before this feature reads as unscheduled, not NaN");
ok(Array.isArray(bareEng145.disciplines) && bareEng145.disciplines.length === 0, "#145 absent disciplines read as an empty list");
ok(bareEng145.milestones.every((m) => m.phaseId === null), "#145 absent milestone phaseId reads as null");

const bareTask145 = normalizeTask({ id: "T-6001", title: "x" } as never);
ok(bareTask145.engagementId === null && bareTask145.startAt === null, "#145 a pre-existing task reads with null engagement and no bar start");
ok(bareTask145.schedule === null && bareTask145.handScheduled === false, "#145 a pre-existing task is not hand-scheduled and carries no template provenance");

const bareNote145 = normalizeNote({ id: "N-7001", parentKind: "customer", parentId: "c1" } as never);
ok(Array.isArray(bareNote145.attachments) && bareNote145.attachments.length === 0, "#145 a pre-existing note reads with no attachments");
ok(Array.isArray(bareNote145.taskIds) && bareNote145.taskIds.length === 0, "#145 a pre-existing note reads with no spawned tasks");

ok(TEMPLATE_RECORD_KINDS.includes("consulting"), "#145 consulting is a template target kind (D172)");
ok(TEMPLATE_RECORD_LABEL.consulting === "Consulting", "#145 the consulting kind has a label for the apply picker");

/* phase weights + disciplines merge like every other settings list */
ok(mergedConsultingDisciplines([]).join(",") === "rigging,curtain,lighting,av", "#145 disciplines default to the four intake groups");
ok(mergedConsultingDisciplines(["rigging", " AV "]).join(",") === "rigging,AV", "#145 a stored discipline list overrides wholesale and is trimmed");
const pw145 = phaseWeightsFor({ "Design Development": 6 }, ["Assessment", "Design Development"]);
ok(pw145[0].weight === 1 && pw145[1].weight === 6, "#145 phaseWeightsFor defaults an unweighted phase to 1 and honours a stored weight");
ok(pw145[0].name === "Assessment" && typeof pw145[0].phaseId === "string" && pw145[0].phaseId.length > 0, "#145 phaseWeightsFor carries a stable id per phase name");
```

Add to the imports at the top:

```ts
import { normalizeEngagementRecord } from "@/lib/stores/engagements";
import { normalizeTask, tasksForEngagement } from "@/lib/stores/tasks";
import { mergedConsultingDisciplines, phaseWeightsFor } from "@/lib/settings";
import { TEMPLATE_RECORD_KINDS, TEMPLATE_RECORD_LABEL } from "@/lib/task-template-kinds";
```

`normalizeNote` is already exported from `@/lib/stores/notes` — add it to that module's existing import line if one exists, otherwise add `import { normalizeNote } from "@/lib/stores/notes";`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:specs
```

Expected: fails on the missing exports `normalizeEngagementRecord`, `mergedConsultingDisciplines`, `phaseWeightsFor`.

- [ ] **Step 3: Add the engagement fields**

In `src/lib/stores/engagements.ts`, extend the types:

```ts
export type EngagementMilestone = {
  id: string;
  name: string;
  targetDate: number;
  completedAt?: number | null;
  amount?: number | null;
  /** #145 D168 — the phase this deliverable belongs to. Defaulted by exact
   *  name match at generation; null otherwise, set from a dropdown on the
   *  milestone row. A null phase pre-ticks nothing on a shift. */
  phaseId?: string | null;
};
```

Add to `ConsultingEngagement`:

```ts
  /** #145 D166 — the schedule span, typed at creation. 0 = unscheduled;
   *  a pre-#145 engagement reads as unscheduled and nothing recomputes. */
  startAt?: number;
  endAt?: number;
  /** #145 D165 — disciplines bought, from the quote, editable here. */
  disciplines?: string[];
```

Export a normalizer (the module normalizes inline today; extract it so the harness can call it with no DB):

```ts
/** Normalize-on-read for a stored engagement doc (#145 — extracted so the
 *  spec harness can exercise the absent-field defaults without a DB). */
export function normalizeEngagementRecord(
  raw: Partial<ConsultingEngagement> & { id: string }
): ConsultingEngagement {
  const e = raw as ConsultingEngagement;
  e.status = normalizeEngagementStatus(String(raw.status || ""));
  e.startAt = Number(raw.startAt) > 0 ? Number(raw.startAt) : 0;
  e.endAt = Number(raw.endAt) > 0 ? Number(raw.endAt) : 0;
  e.disciplines = Array.isArray(raw.disciplines)
    ? raw.disciplines.map((d) => String(d).trim()).filter(Boolean)
    : [];
  e.phases = Array.isArray(raw.phases) ? raw.phases : [];
  e.milestones = (Array.isArray(raw.milestones) ? raw.milestones : []).map((m) => ({
    ...m,
    phaseId: typeof m.phaseId === "string" && m.phaseId ? m.phaseId : null,
  }));
  e.decisions = Array.isArray(raw.decisions) ? raw.decisions : [];
  e.meetings = Array.isArray(raw.meetings) ? raw.meetings : [];
  e.submittals = Array.isArray(raw.submittals) ? raw.submittals : [];
  e.documents = Array.isArray(raw.documents) ? raw.documents : [];
  return e;
}
```

Route every existing read path in this module through `normalizeEngagementRecord`, replacing the inline normalization it does today.

- [ ] **Step 4: Add the task fields**

In `src/lib/stores/tasks.ts`, extend `TaskRecord`:

```ts
  /** #145 — the fourth nullable parent pointer (D85 convention). */
  engagementId: string | null;
  /** #145 — Gantt bar start; dueAt is the bar end. */
  startAt: number | null;
  /** #145 — template provenance: which phase window placed this task, and
   *  at what percentages. Null for a manually added task. */
  schedule: { phaseId: string; startPct: number; lengthPct: number } | null;
  /** #145 D168 — set when a human drags the bar. Excluded from every
   *  milestone-shift pre-tick thereafter. */
  handScheduled: boolean;
```

In `normalizeTask`, add absent-safe defaults:

```ts
  t.engagementId = t.engagementId ?? null;
  t.startAt = typeof t.startAt === "number" ? t.startAt : null;
  t.schedule =
    t.schedule && typeof t.schedule === "object" && typeof t.schedule.phaseId === "string"
      ? {
          phaseId: t.schedule.phaseId,
          startPct: Number(t.schedule.startPct) || 0,
          lengthPct: Number(t.schedule.lengthPct) || 0,
        }
      : null;
  t.handScheduled = !!t.handScheduled;
```

Add the read, mirroring `tasksForDesign`:

```ts
/** #145 — the consulting side of the collection. */
export async function tasksForEngagement(engagementId: string): Promise<TaskRecord[]> {
  return (await allTasks()).filter((t) => t.engagementId === engagementId);
}
```

- [ ] **Step 5: Add the note fields and the consulting template kind**

In `src/lib/stores/notes.ts`:

```ts
export type NoteParentKind = "customer" | "lead" | "project" | "quote" | "engagement";
```

Add to `NoteRecord`:

```ts
  /** #145 D170 — files captured with this note. */
  attachments: FileRef[];
  /** #145 D170 — tasks this note spawned, so a task's origin stays answerable. */
  taskIds: string[];
  /** #145 — true for an app-written note (a milestone move), so the feed can
   *  style it differently and the composer never claims authorship. */
  system: boolean;
```

Import `FileRef` from `@/lib/consulting-files` (created in Task 9; until then declare it locally in `notes.ts` and move it in Task 9 — the union is small and Task 9's step 3 replaces the local declaration with the import).

In `normalizeNote`:

```ts
  n.attachments = Array.isArray(n.attachments) ? n.attachments : [];
  n.taskIds = Array.isArray(n.taskIds) ? n.taskIds : [];
  n.system = !!n.system;
```

Extend `addNoteRecord`'s input to accept `attachments`, `taskIds` and `system`, defaulting each to empty/false.

In `src/lib/task-template-kinds.ts`:

```ts
export type TemplateRecordKind = "project" | "quote" | "design" | "consulting";
export const TEMPLATE_RECORD_KINDS: TemplateRecordKind[] = ["project", "quote", "design", "consulting"];
export const TEMPLATE_RECORD_LABEL: Record<TemplateRecordKind, string> = {
  project: "Projects",
  quote: "Quotes",
  design: "Designs",
  consulting: "Consulting",
};
```

- [ ] **Step 6: Add the settings helpers**

In `src/lib/settings.ts`, add to `AppSettingsData`:

```ts
  /** #145 D165/D166 — phase weight by phase NAME; absent reads as 1. */
  consultingPhaseWeights?: Record<string, number>;
  /** #145 D165 — the discipline vocabulary; whole-list override. */
  consultingDisciplines?: string[];
```

And the two helpers, following the `mergedConsultingPhases` idiom:

```ts
/** #145 — the intake four (survey-intake.ts DISCIPLINE_GROUPS) as defaults. */
export const DEFAULT_CONSULTING_DISCIPLINES = ["rigging", "curtain", "lighting", "av"];

export function mergedConsultingDisciplines(stored?: string[] | null): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CONSULTING_DISCIPLINES;
}

/**
 * #145 — pair each phase NAME with its stored weight (absent/invalid → 1)
 * and a stable id. The id is the phase name slugged, so it survives a
 * settings edit that reorders the list and matches across regenerations.
 */
export function phaseWeightsFor(
  stored: Record<string, number> | null | undefined,
  phaseNames: readonly string[]
): Array<{ phaseId: string; name: string; weight: number }> {
  return phaseNames.map((name) => {
    const w = Number(stored?.[name]);
    return {
      phaseId: "ph-" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name,
      weight: Number.isFinite(w) && w > 0 ? w : 1,
    };
  });
}
```

> **Note for the implementer:** an engagement's own `EngagementPhase.id` (`uid("ph-")`) is what `TaskRecord.schedule.phaseId` stores — `phaseWeightsFor`'s slug id is used only when computing windows from settings before an engagement's phases exist. Task 4 maps between them by phase NAME at generation time.

- [ ] **Step 7: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

Expected: all `#145` assertions PASS; `tsc` silent; lint at baseline.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/engagements.ts src/lib/stores/tasks.ts src/lib/stores/notes.ts src/lib/settings.ts src/lib/task-template-kinds.ts scripts/test-review-and-spec.ts
git commit -m "feat(consulting): schedule, engagement and note record fields (#145, D164/D165/D168/D170)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Template lines carry scope and units

Teach the template store the new line shape and make `applyTaskTemplate` place tasks on a schedule when the target is a consulting engagement.

**Files:**
- Modify: `src/lib/stores/task-templates.ts` (`TaskTemplateLine`, `normalizeLine`, `tasksForTarget`, `applyTaskTemplate`)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `generateSchedule`, `PhaseWeight`, `ScheduleLine` (Task 1); `tasksForEngagement`, `TaskRecord.schedule`, `TemplateRecordKind` (Task 2).
- Produces: `TaskTemplateLine` with `phase`/`discipline`/`startPct`/`lengthPct`; `applyTaskTemplate(setId, target, appliedBy, schedule?)` where `schedule` is `{ startAt, endAt, phases: PhaseWeight[], disciplines: string[] } | undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* ====== #145: template lines carry scope + units ====== */
const bareLine145 = normalizeTemplateLine({ title: "Do the thing" });
ok(bareLine145.phase === "" && bareLine145.discipline === "", "#145 a pre-#145 template line reads with no phase and no discipline");
ok(bareLine145.startPct === 0 && bareLine145.lengthPct === 100, "#145 an unmeasured line defaults to spanning its whole phase window");
const clampedLine145 = normalizeTemplateLine({ title: "x", startPct: -5, lengthPct: 500 });
ok(clampedLine145.startPct === 0 && clampedLine145.lengthPct === 100, "#145 out-of-range template percentages are clamped at normalize, not at render");
ok(normalizeTemplateLine({ title: "x", discipline: " Rigging " }).discipline === "rigging", "#145 a discipline is stored lowercased and trimmed so selectLines matches it");
```

Add the import:

```ts
import { normalizeLine as normalizeTemplateLine } from "@/lib/stores/task-templates";
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

Expected: `normalizeLine` is not exported — compile failure.

- [ ] **Step 3: Extend the line shape**

In `src/lib/stores/task-templates.ts`:

```ts
export type TaskTemplateLine = {
  key: string;
  title: string;
  section: string;
  target: TemplateAssignTarget;
  /** #145 D165 — phase name; must match the phase menu to expand. */
  phase: string;
  /** #145 D165 — "" matches every discipline. Stored lowercased. */
  discipline: string;
  /** #145 D166 — position and length WITHIN the phase window, 0–100. */
  startPct: number;
  lengthPct: number;
};
```

Export the normalizer and add the defaults:

```ts
const pct = (v: unknown, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
};

/** Exported for the spec harness — pure. */
export function normalizeLine(raw: unknown): TaskTemplateLine {
  const l = (raw && typeof raw === "object" ? raw : {}) as Partial<TaskTemplateLine>;
  return {
    key: l.key || Math.random().toString(36).slice(2, 10),
    title: l.title || "Untitled task",
    section: l.section || "",
    target: normalizeTarget(l.target),
    phase: String(l.phase || "").trim(),
    discipline: String(l.discipline || "").trim().toLowerCase(),
    startPct: pct(l.startPct, 0),
    lengthPct: pct(l.lengthPct, 100),
  };
}
```

- [ ] **Step 4: Schedule the fan-out**

In `applyTaskTemplate`, add the consulting target and the optional schedule:

```ts
export type ApplyTemplateSchedule = {
  startAt: number;
  endAt: number;
  phases: PhaseWeight[];
  disciplines: string[];
};

async function tasksForTarget(target: ApplyTemplateTarget): Promise<TaskRecord[]> {
  if (target.kind === "project") return tasksForProject(target.id);
  if (target.kind === "quote") return tasksForQuote(target.id);
  if (target.kind === "consulting") return tasksForEngagement(target.id);
  return tasksForDesign(target.id);
}
```

Extend the existence check with `target.kind === "consulting" ? await getEngagement(target.id) : …`, and after the instance fan-out, place each instance:

```ts
// #145: when the caller hands us a span, every instance gets dated by the
// engine. The scope gate runs FIRST, so a line whose phase the engagement
// doesn't have, or whose discipline it didn't buy, never becomes a task.
let placement = new Map<string, { phaseId: string; startPct: number; lengthPct: number; startAt: number; dueAt: number }>();
if (schedule) {
  const scheduleLines: ScheduleLine[] = set.lines.map((l) => ({
    key: l.key, title: l.title, section: l.section,
    phase: l.phase, discipline: l.discipline,
    startPct: l.startPct, lengthPct: l.lengthPct,
  }));
  const gen = generateSchedule({
    startAt: schedule.startAt, endAt: schedule.endAt,
    phases: schedule.phases, disciplines: schedule.disciplines,
    lines: scheduleLines, milestones: [],
  });
  placement = new Map(gen.tasks.map((t) => [t.key, t]));
  // Only in-scope lines survive generation — drop every instance whose
  // line was gated out.
  instances = instances.filter((i) => placement.has(i.key.split("::")[0]));
}
```

Pass the placement through to `createAutoTask`:

```ts
    const place = placement.get(item.coverageKey.slice(stage.length + 1).split("::")[0]);
    const t = await createAutoTask({
      title: item.title,
      section: item.section,
      coverageKey: item.coverageKey,
      projectId: target.kind === "project" ? target.id : null,
      quoteId: target.kind === "quote" ? target.id : null,
      designId: target.kind === "design" ? target.id : null,
      engagementId: target.kind === "consulting" ? target.id : null,
      startAt: place?.startAt ?? null,
      dueAt: place?.dueAt ?? null,
      schedule: place
        ? { phaseId: place.phaseId, startPct: place.startPct, lengthPct: place.lengthPct }
        : null,
      handScheduled: false,
      assigneeUserId: inst?.assigneeUserId ?? null,
      assigneeName: inst?.assigneeName ?? "",
      createdBy: appliedBy.name,
    });
```

Change `const instances` to `let instances` so the scope filter can reassign it.

- [ ] **Step 5: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

Expected: all PASS; `tsc` silent; lint at baseline.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/task-templates.ts scripts/test-review-and-spec.ts
git commit -m "feat(consulting): template lines carry phase, discipline and unit offsets (#145, D165/D166)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Generation server action and the creation step

The server side of "type start and end, pick a template, preview, commit." Preview is pure — nothing is written until commit.

**Files:**
- Create: `src/app/(app)/design/engagements/schedule-actions.ts`
- Modify: `src/app/(app)/design/engagements/new-engagement-modal.tsx` (the scheduling fields)
- Modify: `src/app/(app)/design/engagements/actions.ts` (accept the new fields on create)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `generateSchedule`, `phaseWindows` (Task 1); `phaseWeightsFor`, `mergedConsultingDisciplines` (Task 2); `applyTaskTemplate` with a schedule (Task 3).
- Produces: `previewScheduleAction(input): Promise<PreviewResult>`, `generateScheduleAction(engagementId, setId): Promise<{ok}|{ok:false,error}>`, `setEngagementSpanAction(engagementId, startAt, endAt)`, and the exported pure validator `validateSpan(startAt, endAt)`.

- [ ] **Step 1: Write the failing tests**

```ts
/* ====== #145: span validation is pure and blocks at creation ====== */
ok(validateSpan(OCT6, MAR30) === null, "#145 a normal span validates");
ok(validateSpan(0, MAR30) !== null, "#145 a missing start is rejected with a message");
ok(validateSpan(MAR30, OCT6) !== null, "#145 an end before the start is rejected rather than generating a degenerate schedule");
ok(validateSpan(OCT6, OCT6) !== null, "#145 a zero-length span is rejected — every task would land on one day");
ok((validateSpan(MAR30, OCT6) || "").toLowerCase().includes("end"), "#145 the rejection message names the field at fault");
```

Add: `import { validateSpan } from "@/app/(app)/design/engagements/schedule-actions";`

> `schedule-actions.ts` is a `"use server"` module; a pure exported helper in it cannot be imported by the harness. **Put `validateSpan` in `src/lib/consulting-schedule.ts` instead** and import it from there in both the action and the test. Update the import line accordingly.

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

Expected: `validateSpan` is not exported from `@/lib/consulting-schedule`.

- [ ] **Step 3: Add the validator to the engine**

Append to `src/lib/consulting-schedule.ts`:

```ts
/** #145 — the creation-step gate. Returns null when the span is usable, or
 *  a message naming the field at fault. Generation is never attempted on a
 *  degenerate span (spec §6). */
export function validateSpan(startAt: number, endAt: number): string | null {
  if (!Number.isFinite(startAt) || startAt <= 0) return "Pick a start date for this engagement.";
  if (!Number.isFinite(endAt) || endAt <= 0) return "Pick an end date for this engagement.";
  if (endAt <= startAt) return "The end date must be after the start date.";
  return null;
}
```

- [ ] **Step 4: Write the actions**

Create `src/app/(app)/design/engagements/schedule-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getEngagement, patchEngagement } from "@/lib/stores/engagements";
import { getTaskTemplateSet, applyTaskTemplate } from "@/lib/stores/task-templates";
import { tasksForEngagement } from "@/lib/stores/tasks";
import { getSettings } from "@/lib/settings";
import { mergedConsultingPhases } from "@/lib/stores/engagements";
import { mergedConsultingDisciplines, phaseWeightsFor } from "@/lib/settings";
import { generateSchedule, validateSpan, type ScheduleLine } from "@/lib/consulting-schedule";

/**
 * #145 (D166) — the creation step's preview. PURE with respect to storage:
 * it reads settings and the template set, computes what generation WOULD
 * produce, and writes nothing. The user commits separately.
 */
export async function previewScheduleAction(input: {
  engagementId: string;
  setId: string;
  startAt: number;
  endAt: number;
}): Promise<
  | { ok: true; tasks: Array<{ title: string; phase: string; startAt: number; dueAt: number; assignee: string }> }
  | { ok: false; error: string }
> {
  await requireUser();
  const bad = validateSpan(input.startAt, input.endAt);
  if (bad) return { ok: false, error: bad };

  const eng = await getEngagement(input.engagementId);
  if (!eng) return { ok: false, error: "That engagement could not be found." };
  const set = await getTaskTemplateSet(input.setId);
  if (!set) return { ok: false, error: "That template could not be found." };

  const settings = await getSettings();
  const phases = phaseWeightsFor(
    settings.consultingPhaseWeights,
    eng.phases.map((p) => p.name)
  ).map((w, i) => ({ ...w, phaseId: eng.phases[i].id })); // engagement phase ids win

  const lines: ScheduleLine[] = set.lines.map((l) => ({
    key: l.key, title: l.title, section: l.section,
    phase: l.phase, discipline: l.discipline,
    startPct: l.startPct, lengthPct: l.lengthPct,
  }));

  const gen = generateSchedule({
    startAt: input.startAt,
    endAt: input.endAt,
    phases,
    disciplines: eng.disciplines || [],
    lines,
    milestones: [],
  });

  const nameOf = new Map(phases.map((p) => [p.phaseId, p.name]));
  return {
    ok: true,
    tasks: gen.tasks.map((t) => ({
      title: t.title,
      phase: nameOf.get(t.phaseId) || "",
      startAt: t.startAt,
      dueAt: t.dueAt,
      assignee: set.lines.find((l) => l.key === t.key)?.target.kind || "team",
    })),
  };
}

/**
 * #145 — commit. Stamps the span, dates the phase-matched milestones, and
 * applies the template through the store's own coverage-key dedup, so a
 * second run is additive rather than duplicative.
 */
export async function generateScheduleAction(
  engagementId: string,
  setId: string,
  startAt: number,
  endAt: number
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const me = await requireUser();
  const bad = validateSpan(startAt, endAt);
  if (bad) return { ok: false, error: bad };

  const eng = await getEngagement(engagementId);
  if (!eng) return { ok: false, error: "That engagement could not be found." };

  const settings = await getSettings();
  const phases = phaseWeightsFor(
    settings.consultingPhaseWeights,
    eng.phases.map((p) => p.name)
  ).map((w, i) => ({ ...w, phaseId: eng.phases[i].id }));

  // Date the phase-matched milestones (D168 defaulting rule) and stamp the span.
  const byName = new Map(eng.phases.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const gen = generateSchedule({
    startAt, endAt, phases, disciplines: eng.disciplines || [], lines: [],
    milestones: eng.milestones.map((m) => ({
      id: m.id,
      phaseId: m.phaseId ?? byName.get(m.name.trim().toLowerCase()) ?? null,
      targetDate: m.targetDate,
    })),
  });
  const dated = new Map(gen.milestones.map((m) => [m.id, m.targetDate]));

  await patchEngagement(engagementId, (e) => {
    e.startAt = startAt;
    e.endAt = endAt;
    e.milestones = e.milestones.map((m) => ({
      ...m,
      phaseId: m.phaseId ?? byName.get(m.name.trim().toLowerCase()) ?? null,
      targetDate: dated.get(m.id) ?? m.targetDate,
    }));
    return e;
  });

  const res = await applyTaskTemplate(
    setId,
    { kind: "consulting", id: engagementId },
    { name: me.name },
    { startAt, endAt, phases, disciplines: eng.disciplines || [] }
  );

  revalidatePath(`/design/engagements/${engagementId}`);
  revalidatePath("/schedule");
  return { ok: true, created: res.created.length };
}

/** #145 — editing the span later. Existing tasks are NOT re-flowed:
 *  milestones are locked (D167) and tasks moved by hand are decisions the
 *  app does not overwrite (D168). Regeneration is an explicit re-apply. */
export async function setEngagementSpanAction(
  engagementId: string,
  startAt: number,
  endAt: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const bad = validateSpan(startAt, endAt);
  if (bad) return { ok: false, error: bad };
  await patchEngagement(engagementId, (e) => {
    e.startAt = startAt;
    e.endAt = endAt;
    return e;
  });
  revalidatePath(`/design/engagements/${engagementId}`);
  return { ok: true };
}
```

- [ ] **Step 5: Add the creation fields**

In `new-engagement-modal.tsx`, add two `<input type="date">` fields (start, end) and a discipline checkbox row seeded from `mergedConsultingDisciplines`, using the existing `pk-*` field classes in that file. Convert dates to epoch-ms with the module's existing date helper. Post them through `actions.ts`'s create path into `startAt`, `endAt` and `disciplines`. Show `validateSpan`'s message inline and keep the submit disabled while it is non-null.

- [ ] **Step 6: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

- [ ] **Step 7: Verify in the running app**

```bash
ps aux | grep -c "[t]sx"
```

Expected: `0`. Then start the dev server with `preview_start` (never `npm run dev` through Bash), create an engagement with a start and end date, and confirm the preview lists tasks with dates inside the span and that committing creates them.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/design/engagements/schedule-actions.ts" "src/app/(app)/design/engagements/new-engagement-modal.tsx" "src/app/(app)/design/engagements/actions.ts" src/lib/consulting-schedule.ts scripts/test-review-and-spec.ts
git commit -m "feat(consulting): schedule generation with preview-then-commit (#145, D166)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The shared Gantt component

One draggable grid used by both the engagement Schedule tab (Task 6) and `/schedule` (Task 12). Built standalone against fixture data so it is reviewable before either consumer exists.

**Files:**
- Create: `src/components/gantt/gantt-grid.tsx` (client component)
- Create: `src/components/gantt/gantt-lib.ts` (pure geometry)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: nothing (pure geometry + props).
- Produces: `GanttRow`, `GanttBar`, `GanttMarker`, `<GanttGrid rows onBarMove ... />`, and from `gantt-lib`: `dayColumns(startAt, endAt)`, `barRect(bar, startAt, endAt)`, `dateFromX(x, width, startAt, endAt)`, `snapToDay(ms)`.

- [ ] **Step 1: Write the failing tests for the geometry**

```ts
/* ====== #145: Gantt geometry ====== */
ok(dayColumns(OCT6, OCT6 + 6 * DAY145).length === 7, "#145 dayColumns is inclusive of both ends");
const rect145 = barRect({ startAt: OCT6 + 2 * DAY145, dueAt: OCT6 + 4 * DAY145 }, OCT6, OCT6 + 10 * DAY145);
ok(Math.round(rect145.leftPct) === 20 && Math.round(rect145.widthPct) === 20, "#145 barRect converts a span to percentages of the visible range");
ok(barRect({ startAt: OCT6 - DAY145, dueAt: OCT6 + DAY145 }, OCT6, OCT6 + 10 * DAY145).leftPct === 0, "#145 a bar starting before the window is clipped to the left edge, not drawn off-screen");
ok(barRect({ startAt: OCT6, dueAt: OCT6 }, OCT6, OCT6 + 10 * DAY145).widthPct > 0, "#145 a zero-length bar still renders a visible sliver rather than vanishing");
ok(snapToDay(OCT6 + 3 * DAY145 + 3600000) === OCT6 + 3 * DAY145, "#145 a drop snaps back to the start of its day");
ok(dateFromX(50, 100, OCT6, OCT6 + 10 * DAY145) === OCT6 + 5 * DAY145, "#145 dateFromX maps a pixel offset to a date within the range");
```

Add: `import { barRect, dateFromX, dayColumns, snapToDay } from "@/components/gantt/gantt-lib";`

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

Expected: module not found.

- [ ] **Step 3: Write the geometry**

Create `src/components/gantt/gantt-lib.ts`:

```ts
/** Pure Gantt geometry (#145) — no React, no DOM, so the spec harness can
 *  pin the pixel↔date mapping that dragging depends on. */

const DAY = 86400000;

export function snapToDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export function dayColumns(startAt: number, endAt: number): number[] {
  const out: number[] = [];
  const s = snapToDay(startAt);
  const e = snapToDay(endAt);
  for (let d = s; d <= e; d += DAY) out.push(d);
  return out;
}

/** Percentages of the visible range, clipped to it. A zero-length bar keeps
 *  a minimum width so a same-day task is still clickable. */
export function barRect(
  bar: { startAt: number; dueAt: number },
  startAt: number,
  endAt: number
): { leftPct: number; widthPct: number } {
  const span = Math.max(1, endAt - startAt);
  const s = Math.max(startAt, Math.min(endAt, bar.startAt));
  const e = Math.max(s, Math.min(endAt, bar.dueAt));
  const leftPct = ((s - startAt) / span) * 100;
  const widthPct = Math.max(0.6, ((e - s) / span) * 100);
  return { leftPct, widthPct };
}

export function dateFromX(x: number, width: number, startAt: number, endAt: number): number {
  if (width <= 0) return startAt;
  const ratio = Math.min(1, Math.max(0, x / width));
  return snapToDay(startAt + ratio * (endAt - startAt));
}
```

- [ ] **Step 4: Write the component**

Create `src/components/gantt/gantt-grid.tsx` — a `"use client"` component. Shape:

```tsx
export type GanttBar = {
  id: string;
  label: string;
  startAt: number;
  dueAt: number;
  tone: string;          // MONDAY_TONE key — reuse the house StatusPill palette
  draggable: boolean;
  overrun: boolean;      // renders red (spec §5.2)
};
export type GanttMarker = { id: string; label: string; at: number; locked: boolean };
export type GanttRow = { id: string; label: string; group: string; bars: GanttBar[] };

export function GanttGrid(props: {
  rows: GanttRow[];
  markers: GanttMarker[];
  startAt: number;
  endAt: number;
  onBarMove: (barId: string, startAt: number, dueAt: number) => void;
  onMarkerClick?: (markerId: string) => void;
}): JSX.Element;
```

Implementation notes the implementer must follow:
- Header renders month marks from `dayColumns`, weekends shaded, today line — match `schedule/page.tsx:296-302`'s existing day-cell/week-mark conventions so the two grids look identical.
- Bars are absolutely positioned from `barRect`. Drag uses pointer events (`onPointerDown`/`Move`/`Up`) on the bar; on release call `dateFromX` for the new start, preserve the bar's duration, and fire `onBarMove`. Never mutate props.
- `draggable: false` bars render with `cursor: default` and no pointer handlers — install project rows in Task 12 rely on this.
- Markers render as diamonds on their own header strip; `locked: true` markers are not draggable (D167) and fire `onMarkerClick` instead.
- `overrun: true` bars take a red fill. Do not hardcode the accent colour anywhere.

- [ ] **Step 5: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

- [ ] **Step 6: Commit**

```bash
git add src/components/gantt/
git commit -m "feat(gantt): shared draggable grid + pure geometry (#145)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The engagement Schedule tab

**Files:**
- Create: `src/app/(app)/design/engagements/schedule-tab.tsx` (client)
- Modify: `src/app/(app)/design/engagements/tabs.ts` (add `"schedule"`)
- Modify: `src/app/(app)/design/engagements/view.tsx` (mount the tab)
- Modify: `src/app/(app)/design/engagements/schedule-actions.ts` (add `moveTaskAction`, `moveMilestoneAction`)
- Test: `scripts/test-review-and-spec.ts` (append); `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: `GanttGrid` (Task 5); `shiftForMilestone`, `overrunsEnd` (Task 1); `tasksForEngagement` (Task 2); the actions from Task 4.
- Produces: `moveTaskAction(taskId, startAt, dueAt)` — sets `handScheduled: true`; `moveMilestoneAction(engagementId, milestoneId, targetDate, alsoMoveTaskIds)`.

- [ ] **Step 1: Write the failing test**

```ts
/* ====== #145: the schedule tab is a real tab key ====== */
ok((TABS as readonly string[]).includes("schedule"), "#145 schedule is a valid engagement tab (?tab= validation depends on it)");
ok((TABS as readonly string[]).includes("activity"), "#145 activity is a valid engagement tab");
```

Add: `import { TABS } from "@/app/(app)/design/engagements/tabs";`

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

Expected: both FAIL.

- [ ] **Step 3: Add the tab keys**

In `tabs.ts`:

```ts
export const TABS = [
  "overview",
  "schedule",
  "activity",
  "phases",
  "milestones",
  "meetings",
  "oversight",
  "documents",
] as const;
```

- [ ] **Step 4: Write the move actions**

Append to `schedule-actions.ts`:

```ts
/** #145 D168 — a human drag. Sets handScheduled so nothing the app does
 *  later moves this bar again. */
export async function moveTaskAction(
  taskId: string,
  startAt: number,
  dueAt: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!Number.isFinite(startAt) || !Number.isFinite(dueAt) || dueAt < startAt) {
    return { ok: false, error: "That drop produced an invalid date range." };
  }
  const t = await patchTask(taskId, (task) => {
    task.startAt = startAt;
    task.dueAt = dueAt;
    task.handScheduled = true;
    return task;
  });
  if (!t) return { ok: false, error: "That task no longer exists." };
  if (t.engagementId) revalidatePath(`/design/engagements/${t.engagementId}`);
  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * #145 D167/D168 — a deliberate milestone edit from the main screen. The
 * caller has already been shown shiftForMilestone's pre-ticked set and
 * passes back exactly the task ids the user confirmed. A system-authored
 * note records the move for the Activity feed (D170).
 */
export async function moveMilestoneAction(
  engagementId: string,
  milestoneId: string,
  targetDate: number,
  alsoMoveTaskIds: string[]
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const me = await requireUser();
  const eng = await getEngagement(engagementId);
  if (!eng) return { ok: false, error: "That engagement could not be found." };
  const ms = eng.milestones.find((m) => m.id === milestoneId);
  if (!ms) return { ok: false, error: "That milestone could not be found." };

  const delta = targetDate - (ms.targetDate || targetDate);
  await patchEngagement(engagementId, (e) => {
    e.milestones = e.milestones.map((m) => (m.id === milestoneId ? { ...m, targetDate } : m));
    return e;
  });

  let moved = 0;
  if (delta !== 0 && alsoMoveTaskIds.length) {
    const tasks = await tasksForEngagement(engagementId);
    const { moved: shifts } = shiftForMilestone({ phaseId: ms.phaseId ?? null }, delta, tasks);
    const allowed = new Set(alsoMoveTaskIds);
    for (const s of shifts) {
      if (!allowed.has(s.id)) continue;
      await patchTask(s.id, (t) => {
        t.startAt = s.startAt;
        t.dueAt = s.dueAt;
        return t; // NOT handScheduled — this was a milestone move, not a drag
      });
      moved++;
    }
  }

  await addNoteRecord(
    {
      parentKind: "engagement",
      parentId: engagementId,
      customerId: eng.companyId,
      text: `Milestone moved — ${ms.name}: ${fmtDate(ms.targetDate)} → ${fmtDate(targetDate)}${moved ? ` · ${moved} task${moved === 1 ? "" : "s"} moved with it` : ""}`,
      attachments: [],
      taskIds: [],
      system: true,
    },
    me.name
  );

  revalidatePath(`/design/engagements/${engagementId}`);
  revalidatePath("/schedule");
  return { ok: true, moved };
}
```

Import `patchTask` from `@/lib/stores/tasks`, `addNoteRecord` from `@/lib/stores/notes`, `shiftForMilestone` from `@/lib/consulting-schedule`, and use the repo's existing date formatter from `@/lib/format` for `fmtDate`.

- [ ] **Step 5: Write the tab**

Create `schedule-tab.tsx`. It renders:
- An unscheduled empty state when `startAt`/`endAt` are 0: the two date inputs plus a template picker, calling `previewScheduleAction` then `generateScheduleAction`.
- Otherwise `<GanttGrid>` with phase-window bands as non-draggable grouping rows, milestone diamonds (`locked: true`), and one draggable bar per task. `overrun` comes from `overrunsEnd(task, eng.endAt)`.
- `onBarMove` calls `moveTaskAction` then `router.refresh()`.
- `onMarkerClick` opens the shift dialog: a date input plus the checklist from `shiftForMilestone`, pre-ticked, with hand-dragged tasks listed but unticked and labelled "moved by hand". Confirm calls `moveMilestoneAction` with the ticked ids.
- A group-by toggle: phase (default) or assignee.

Mount it in `view.tsx` under the existing tab switch.

- [ ] **Step 6: Add the smoke route**

In `scripts/smoke-routes.ts`, add `/design/engagements/<seed-id>?tab=schedule` alongside the existing engagement tab entries.

- [ ] **Step 7: Run the tests, gates, and the app**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run test:smoke
```

Then in the running app: open a scheduled engagement's Schedule tab, drag a task bar, reload, confirm the new date persisted; move a milestone, confirm the dialog pre-ticks its phase's tasks and excludes the dragged one, and that the Activity note appears after Task 7.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/design/engagements/" src/components/gantt/ scripts/
git commit -m "feat(consulting): engagement Schedule tab with draggable tasks and locked milestones (#145, D167/D168)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Activity tab and the unified composer

**Files:**
- Create: `src/app/(app)/design/engagements/activity-tab.tsx` (client)
- Create: `src/app/(app)/design/engagements/activity-actions.ts`
- Create: `src/lib/engagement-activity.ts` (pure feed merge)
- Modify: `src/app/(app)/design/engagements/view.tsx` (mount)
- Modify: `src/lib/stores/notes.ts` (add `notesForEngagement`)
- Test: `scripts/test-review-and-spec.ts` (append); `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: `NoteRecord` fields (Task 2); `FileRef` (Task 2's local declaration, replaced in Task 9).
- Produces: `mergeActivity(input): ActivityEntry[]` (pure); `captureAction(input): Promise<{ok:true,noteId,taskIds}|{ok:false,error}>`.

- [ ] **Step 1: Write the failing tests**

```ts
/* ====== #145 D170: the Activity feed merges existing records ====== */
const feed145 = mergeActivity({
  notes: [
    { id: "N-1", at: 300, text: "Call with Dana", by: "Jeff", attachments: [], taskIds: ["T-9"], system: false },
    { id: "N-2", at: 500, text: "Milestone moved", by: "Jeff", attachments: [], taskIds: [], system: true },
  ],
  meetings: [{ id: "mt-1", at: 400, title: "Design review", attendees: "Dana, Jeff", minutes: "..." }],
  decisions: [{ id: "dc-1", at: 200, by: "Jeff", decision: "Fire curtain in scope", context: "" }],
  phaseAttachments: [{ id: "ed-1", addedAt: 100, name: "as-built.dwg", addedBy: "Chris", phaseName: "DD" }],
});
ok(feed145.length === 5, "#145 the feed merges notes, meetings, decisions and phase attachments with nothing new stored");
ok(feed145[0].at === 500 && feed145[4].at === 100, "#145 the feed is newest first");
ok(feed145[0].kind === "note" && feed145[0].system === true, "#145 a milestone-move note is marked system so the feed can style it apart");
ok(feed145.find((e) => e.id === "N-1")?.taskIds.join(",") === "T-9", "#145 a note carries the tasks it spawned so a task's origin stays answerable");
ok(feed145.filter((e) => e.kind === "meeting").length === 1, "#145 meetings appear without being copied into notes");
ok(mergeActivity({ notes: [], meetings: [], decisions: [], phaseAttachments: [] }).length === 0, "#145 an empty engagement produces an empty feed, not a crash");
```

Add: `import { mergeActivity } from "@/lib/engagement-activity";`

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

Expected: module not found.

- [ ] **Step 3: Write the pure merge**

Create `src/lib/engagement-activity.ts`:

```ts
/**
 * Activity feed merge (#145, D170) — PURE. The feed stores nothing of its
 * own: it reads the notes written by the composer plus the meetings,
 * decisions and phase attachments the engagement already carries, and
 * orders them newest first.
 */

export type ActivityKind = "note" | "meeting" | "decision" | "file";

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  at: number;
  by: string;
  title: string;
  body: string;
  taskIds: string[];
  attachments: Array<{ name: string }>;
  system: boolean;
};

export type MergeInput = {
  notes: Array<{ id: string; at: number; text: string; by: string; attachments: Array<{ name: string }>; taskIds: string[]; system: boolean }>;
  meetings: Array<{ id: string; at: number; title?: string; attendees: string; minutes: string }>;
  decisions: Array<{ id: string; at: number; by: string; decision: string; context: string }>;
  phaseAttachments: Array<{ id: string; addedAt: number; name: string; addedBy: string; phaseName: string }>;
};

export function mergeActivity(input: MergeInput): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  for (const n of input.notes) {
    out.push({
      id: n.id, kind: "note", at: n.at, by: n.by,
      title: "", body: n.text,
      taskIds: n.taskIds || [], attachments: n.attachments || [], system: !!n.system,
    });
  }
  for (const m of input.meetings) {
    out.push({
      id: m.id, kind: "meeting", at: m.at, by: "",
      title: m.title || "Meeting", body: m.minutes,
      taskIds: [], attachments: [], system: false,
    });
  }
  for (const d of input.decisions) {
    out.push({
      id: d.id, kind: "decision", at: d.at, by: d.by,
      title: d.decision, body: d.context,
      taskIds: [], attachments: [], system: false,
    });
  }
  for (const f of input.phaseAttachments) {
    out.push({
      id: f.id, kind: "file", at: f.addedAt, by: f.addedBy,
      title: f.name, body: f.phaseName,
      taskIds: [], attachments: [{ name: f.name }], system: false,
    });
  }

  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}
```

- [ ] **Step 4: Write the capture action**

Create `activity-actions.ts`. `captureAction` takes `{ engagementId, text, attachments: FileRef[], tasks: Array<{title, assigneeUserId, dueAt}> }`, and in one action:

1. `requireUser()`.
2. Reject empty input: no text, no files, no tasks → `{ ok: false, error: "Nothing to capture." }`.
3. Create each task via `createTask` with `engagementId` set, `schedule: null`, `handScheduled: true` (a hand-entered task is by definition hand-scheduled and must never be swept by a milestone move).
4. Create the note via `addNoteRecord` with `attachments` and the new `taskIds`.
5. **If any task write throws, delete the tasks already created before rethrowing** — the spec's rollback requirement (§6). Wrap steps 3–4 in a try/catch that calls `softDeleteDoc("tasks", id)` for each created id.
6. `revalidatePath` the engagement and `/schedule`.

Add `notesForEngagement(engagementId)` to `notes.ts`, mirroring `notesForCustomer` but filtering `parentKind === "engagement" && parentId === engagementId`.

- [ ] **Step 5: Write the tab**

Create `activity-tab.tsx`: the composer (textarea, file drop zone, "＋ task" rows with title/assignee/due), and the feed rendered from `mergeActivity`. Spawned tasks and attachments render inline under their note. System notes get a muted treatment and no author byline.

Mount in `view.tsx`; add `?tab=activity` to `smoke-routes.ts`.

- [ ] **Step 6: Run the tests, gates, and the app**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run test:smoke
```

In the app: capture a note with a file and two tasks; confirm one feed entry with both tasks linked, and that the tasks appear on the Schedule tab.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engagement-activity.ts "src/app/(app)/design/engagements/" src/lib/stores/notes.ts scripts/
git commit -m "feat(consulting): Activity tab — one composer for notes, files and tasks (#145, D170)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Krisp and meeting pre-fill

**Files:**
- Modify: `src/lib/engagement-activity.ts` (add `prefillFromMeeting`)
- Modify: `src/app/(app)/design/engagements/activity-tab.tsx` (accept `?prefill=`)
- Modify: `src/app/(app)/recordings/[id]/detail-client.tsx` (add "Capture to engagement")
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `mergeActivity` (Task 7); the existing `@/lib/krisp/derive` helpers (`prefillInsertText`, `routePrefill`) already imported by the harness.
- Produces: `prefillFromMeeting(meeting): { text: string; attendees: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
/* ====== #145 D170: Krisp / meeting pre-fill ====== */
const pre145 = prefillFromMeeting({ id: "mt-1", at: OCT6, title: "Design review — SD", attendees: "Dana Kim, Jeff C.", minutes: "District wants the fire curtain in scope." });
ok(pre145.text.includes("Design review — SD"), "#145 the pre-filled body leads with the meeting title");
ok(pre145.text.includes("fire curtain"), "#145 the pre-filled body carries the minutes verbatim");
ok(pre145.attendees.join("|") === "Dana Kim|Jeff C.", "#145 attendees are split for attachment to the note");
ok(prefillFromMeeting({ id: "m", at: 0, title: "", attendees: "", minutes: "" }).text === "", "#145 an empty meeting pre-fills nothing rather than a header with no content");
ok(!prefillFromMeeting({ id: "m", at: OCT6, title: "x", attendees: "", minutes: "y" }).text.includes("undefined"), "#145 a meeting with no attendees never renders the string 'undefined'");
```

Add `prefillFromMeeting` to the `@/lib/engagement-activity` import.

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

- [ ] **Step 3: Implement**

Append to `src/lib/engagement-activity.ts`:

```ts
/**
 * #145 D170 — what the composer opens with when launched from a meeting or
 * a Krisp recording. Body only: NOTHING is auto-extracted into tasks. A
 * human ticks the lines that become work.
 */
export function prefillFromMeeting(meeting: {
  id: string;
  at: number;
  title?: string;
  attendees: string;
  minutes: string;
}): { text: string; attendees: string[] } {
  const title = String(meeting.title || "").trim();
  const minutes = String(meeting.minutes || "").trim();
  const attendees = String(meeting.attendees || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!title && !minutes) return { text: "", attendees };
  const head = title || "Meeting";
  return { text: minutes ? `${head}\n\n${minutes}` : head, attendees };
}
```

- [ ] **Step 4: Wire the entry points**

- `activity-tab.tsx`: read `?prefill=<meetingId>`, find the meeting on the engagement, seed the composer from `prefillFromMeeting`. Clear the param after seeding so a refresh doesn't re-seed over edits.
- Meetings tab: each meeting row gets a "Capture to Activity" link to `?tab=activity&prefill=<id>`.
- `recordings/[id]/detail-client.tsx`: a "Capture to engagement" action on a recording linked to an engagement, routing to the same URL with the recording's summary as the meeting source.

- [ ] **Step 5: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/engagement-activity.ts "src/app/(app)/design/engagements/" "src/app/(app)/recordings/" scripts/test-review-and-spec.ts
git commit -m "feat(consulting): Krisp and meeting pre-fill for the Activity composer (#145, D170)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The FileRef seam and Drive upload

**Files:**
- Create: `src/lib/consulting-files.ts` (the `FileRef` union + resolver)
- Create: `src/app/api/engagement-files/upload/route.ts` (initiate a resumable session)
- Create: `src/app/api/engagement-files/[engagementId]/[fileId]/route.ts` (download proxy)
- Modify: `src/lib/google/drive.ts` (export `initiateResumableSession`, split out of `uploadFileResumable`)
- Modify: `src/lib/stores/notes.ts` (import `FileRef` from the new module, delete the local declaration)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `ensureFolder`, `driveErrorFor`, `DRIVE_UPLOAD_BASE` (existing `drive.ts`); `blobEnabled`, `putBlob` (existing `blob.ts`).
- Produces: `FileRef`, `fileRefName(ref)`, `fileRefHref(ref, engagementId)`, `engagementFolderPath(customer, engagementId)`, `initiateResumableSession(token, name, mime, parentId, fetchImpl?)`.

> **Security requirement, non-negotiable.** The yesterday's-review lesson from vendor quotes applies verbatim: a client-supplied storage path is an arbitrary-read primitive. The download proxy MUST verify that the requested `fileId`/`pathname` actually appears on a `FileRef` stored under the named engagement before streaming a single byte, exactly as `ownsVendorQuoteBlobPath` does in `src/lib/vendor-quote-file.ts`. Mirror that function's shape and test it the same way.

- [ ] **Step 1: Write the failing tests**

```ts
/* ====== #145 D171: the file seam and its ownership check ====== */
ok(engagementFolderPath("Cedar Grove Schools", "CE-1044") === "Peak Projects/Cedar Grove Schools/CE-1044", "#145 the Drive folder path is customer then engagement id");
ok(engagementFolderPath("A/B \\ C", "CE-1") === "Peak Projects/A-B - C/CE-1", "#145 path separators in a customer name are sanitized, never used as folders");
ok(fileRefName({ kind: "drive", fileId: "f1", webViewLink: "x", name: "set.pdf", mime: "application/pdf", size: 10 }) === "set.pdf", "#145 fileRefName reads across every union member");

const ownedRefs145 = [
  { kind: "drive" as const, fileId: "good", webViewLink: "x", name: "a.pdf", mime: "application/pdf", size: 1 },
  { kind: "blob" as const, pathname: "eng/CE-1/b.pdf", name: "b.pdf", mime: "application/pdf", size: 1 },
];
ok(ownsEngagementFile(ownedRefs145, "good"), "#145 a Drive id stored on the engagement is streamable");
ok(ownsEngagementFile(ownedRefs145, "eng/CE-1/b.pdf"), "#145 a Blob pathname stored on the engagement is streamable");
ok(!ownsEngagementFile(ownedRefs145, "someone-elses-file"), "#145 an id NOT stored on this engagement is refused — the vendor-quote arbitrary-read lesson");
ok(!ownsEngagementFile([], "good"), "#145 an engagement with no files streams nothing");
ok(!ownsEngagementFile(ownedRefs145, ""), "#145 an empty id is refused rather than matching a falsy field");
```

Add: `import { engagementFolderPath, fileRefName, ownsEngagementFile } from "@/lib/consulting-files";`

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

- [ ] **Step 3: Write the seam**

Create `src/lib/consulting-files.ts`:

```ts
/**
 * Engagement file seam (#145, D171). One union resolved at write time by
 * what is configured: Drive when the archive mailbox is connected, Blob
 * when BLOB_READ_WRITE_TOKEN is set, data-URL locally (Vercel Blob refuses
 * local dev uploads under OIDC — see PUNCHLIST #143).
 *
 * Pure: no imports, so the ownership check is spec-tested with no DB.
 */

export type FileMeta = { name: string; mime: string; size: number };
export type FileRef =
  | ({ kind: "drive"; fileId: string; webViewLink: string } & FileMeta)
  | ({ kind: "blob"; pathname: string } & FileMeta)
  | ({ kind: "data"; dataUrl: string } & FileMeta);

export function fileRefName(ref: FileRef): string {
  return ref.name;
}

/** The storage key a proxy would stream by — the value the ownership check
 *  compares against. A data-URL ref has no key: its bytes are in the doc. */
export function fileRefKey(ref: FileRef): string {
  if (ref.kind === "drive") return ref.fileId;
  if (ref.kind === "blob") return ref.pathname;
  return "";
}

/**
 * THE ownership check (mirrors ownsVendorQuoteBlobPath). A client names a
 * file id; this proves that id is actually stored on the engagement being
 * requested. Without it the authenticated proxy is an arbitrary-read
 * primitive over the whole private store.
 */
export function ownsEngagementFile(refs: readonly FileRef[], requestedKey: string): boolean {
  if (!requestedKey) return false;
  return refs.some((r) => {
    const k = fileRefKey(r);
    return !!k && k === requestedKey;
  });
}

/** Drive folder path for an engagement. Separators in a customer name are
 *  replaced, never honoured — a name is data, not a path. */
export function engagementFolderPath(customer: string, engagementId: string): string {
  const safe = String(customer || "Unknown")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `Peak Projects/${safe}/${engagementId}`;
}
```

In `notes.ts`, replace the local `FileRef` declaration with `import type { FileRef } from "@/lib/consulting-files";`.

- [ ] **Step 4: Split the resumable initiate out of `drive.ts`**

`uploadFileResumable` currently initiates and PUTs in one function. Extract the initiate half:

```ts
/** #145 — initiate only. Returns the session URL the BROWSER will PUT to,
 *  so a drawing set never passes through the 4.5MB function body. */
export async function initiateResumableSession(
  token: string,
  input: { name: string; mime: string; parentId: string },
  fetchImpl: DriveFetch = realFetch
): Promise<string> { /* the existing initiate block, returning res.headers.get("location") */ }
```

Keep `uploadFileResumable` working by having it call the new function — the recordings archive must not change behaviour.

- [ ] **Step 5: Write the routes**

- `POST /api/engagement-files/upload` — `requireUser()`, resolve the engagement, `ensureFolder(engagementFolderPath(...))`, `initiateResumableSession(...)`, return `{ sessionUrl, fileId }`. When Drive is not connected, fall back: accept the bytes and `putBlob` when `blobEnabled()`, else return `{ mode: "data" }` and let the client inline a data-URL. Apply the same size limit and content-type allowlist shape as `src/lib/vendor-quote-file.ts` — reuse that module's rules rather than restating them.
- `GET /api/engagement-files/[engagementId]/[fileId]` — `requireUser()`, load the engagement's notes and documents, collect every `FileRef`, **call `ownsEngagementFile` before touching storage**, then stream.

- [ ] **Step 6: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/consulting-files.ts src/lib/google/drive.ts src/lib/stores/notes.ts src/app/api/engagement-files/ scripts/test-review-and-spec.ts
git commit -m "feat(consulting): FileRef seam with Drive upload and an ownership-checked proxy (#145, D171)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Template CSV import and export

**Files:**
- Modify: `src/app/(app)/import/types.ts` (the `task_templates` type)
- Modify: `src/app/(app)/import/registry.ts` (the writer)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `TaskTemplateLine`, `normalizeLine`, `allTaskTemplateSets`, `createTaskTemplateSet`, `updateTaskTemplateSet` (Task 3).
- Produces: an `IMPORT_TYPES` entry keyed `task_templates`; a `WRITERS.task_templates` entry; `parseAssignTarget(value, users)`.

- [ ] **Step 1: Write the failing tests**

```ts
/* ====== #145 D169: task-template CSV ====== */
const ttType145 = IMPORT_TYPES.find((t) => t.key === "task_templates");
ok(!!ttType145, "#145 task_templates is a registered import type");
ok(ttType145!.fields.map((f) => f.header).join(",") === "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %", "#145 the template CSV columns match the spec exactly");
ok(ttType145!.fields.filter((f) => f.required).map((f) => f.key).join(",") === "set,task", "#145 only the set name and the task title are required");
ok(ttType145!.fields.every((f) => f.hidden || typeof f.example === "string"), "#145 every visible column carries an example so the downloadable template is fillable");

ok(parseAssignTarget("team", []).kind === "team", "#145 'team' parses to the everyone target");
ok(parseAssignTarget("role:Estimator", []).kind === "role", "#145 'role:X' parses to a role target");
const users145 = [{ id: "u1", name: "Jeff Chesebro" }];
const person145 = parseAssignTarget("person:Jeff Chesebro", users145);
ok(person145.kind === "person" && person145.userId === "u1", "#145 'person:Name' resolves to a user id");
ok(parseAssignTarget("person:Nobody At All", users145).kind === "team", "#145 an unresolvable person falls back to team rather than minting a task nobody owns");
ok(parseAssignTarget("", users145).kind === "team", "#145 a blank Assign To defaults to team");
```

Add: `import { IMPORT_TYPES } from "@/app/(app)/import/types";` and `import { parseAssignTarget } from "@/app/(app)/import/registry";`

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

- [ ] **Step 3: Add the type**

Append to `IMPORT_TYPES` in `types.ts`:

```ts
  {
    key: "task_templates",
    label: "Task templates",
    mono: "TT",
    color: "#3f6f8a",
    blurb: "Reusable task-template lines — many rows make one set. Blank Discipline applies to every discipline; Start % and Length % position the task inside its phase's window.",
    dedupeLabel: "template set name",
    viewHref: "/task-templates",
    viewLabel: "View in Task templates",
    fields: [
      { key: "set", header: "Template Set", label: "Template set", required: true, aliases: ["template set", "set", "template", "template name"], example: "Consulting — Full Design" },
      { key: "appliesTo", header: "Applies To", label: "Applies to", aliases: ["applies to", "appliesto", "record", "record kind", "kind"], example: "consulting" },
      { key: "phase", header: "Phase", label: "Phase", aliases: ["phase", "stage"], example: "Assessment" },
      { key: "discipline", header: "Discipline", label: "Discipline", aliases: ["discipline", "trade", "scope"], example: "rigging" },
      { key: "task", header: "Task", label: "Task", required: true, aliases: ["task", "title", "task title", "item"], example: "Field-verify grid heights and attachment points" },
      { key: "section", header: "Section", label: "Section", aliases: ["section", "group"], example: "Assessment" },
      { key: "assignTo", header: "Assign To", label: "Assign to", aliases: ["assign to", "assignto", "assignee", "owner"], example: "role:Estimator" },
      { key: "startPct", header: "Start %", label: "Start %", aliases: ["start %", "start", "start pct", "start percent", "offset"], example: "0" },
      { key: "lengthPct", header: "Length %", label: "Length %", aliases: ["length %", "length", "length pct", "duration", "duration %"], example: "20" },
    ],
  },
```

- [ ] **Step 4: Add the writer**

In `registry.ts`, export the target parser and add the writer. **Import is replace-by-set** (spec §5.5): `find` matches by normalized set name; `update` replaces that set's `lines` wholesale with the rows for that set in this file; `create` mints a new set.

```ts
/** #145 D169 — "team" | "role:<Role>" | "person:<Name>". An unresolvable
 *  person falls back to team: a task assigned to nobody is worse than a
 *  task assigned to everybody, because nobody notices it. */
export function parseAssignTarget(
  raw: string,
  users: ReadonlyArray<{ id: string; name: string }>
): TemplateAssignTarget {
  const v = String(raw || "").trim();
  if (!v || v.toLowerCase() === "team") return { kind: "team" };
  const [head, ...rest] = v.split(":");
  const tail = rest.join(":").trim();
  if (head.trim().toLowerCase() === "role" && tail) return { kind: "role", role: tail as Role };
  if (head.trim().toLowerCase() === "person" && tail) {
    const u = users.find((u) => u.name.trim().toLowerCase() === tail.toLowerCase());
    return u ? { kind: "person", userId: u.id } : { kind: "team" };
  }
  return { kind: "team" };
}
```

Rows are validated against the live phase list (`mergedConsultingPhases`) and discipline list (`mergedConsultingDisciplines`); an unknown value is reported per-row in the preview and the import may still be committed without those rows — the behaviour every other import type already has.

`exportObjects` emits one row per line across every set, so the export round-trips through the import.

- [ ] **Step 5: Run the tests and gates**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

- [ ] **Step 6: Verify the round trip in the app**

Download the `task_templates` template from `/import`, add two rows, upload it, confirm the preview maps every column, commit, and confirm the set appears at `/task-templates` with both lines. Then export and confirm the file matches.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/import/" scripts/test-review-and-spec.ts
git commit -m "feat(consulting): task-template CSV import and export (#145, D169)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Admin authoring — template lines, phase weights, disciplines

**Files:**
- Modify: `src/app/(app)/task-templates/template-sets-client.tsx` (line editor columns)
- Modify: `src/app/(app)/task-templates/actions.ts` (pass the new fields)
- Modify: `src/app/(app)/settings/settings-client.tsx` + `actions.ts` (phase weights, disciplines)
- Modify: `src/app/(app)/design/engagements/quote/controls.tsx` (discipline checkboxes)
- Modify: `src/app/(app)/design/engagements/quote/actions.ts` (persist disciplines)

**Interfaces:**
- Consumes: `TaskTemplateLine` (Task 3); `mergedConsultingDisciplines`, `phaseWeightsFor` (Task 2).
- Produces: no new exports — UI only.

- [ ] **Step 1: Extend the template line editor**

Add four inputs per line: Phase (`<select>` from `mergedConsultingPhases`), Discipline (`<select>` from `mergedConsultingDisciplines` with a blank "All disciplines" option), Start % and Length % (number inputs, 0–100). Keep the existing title/section/target controls. `template-sets-client.tsx` must continue importing kinds from `@/lib/task-template-kinds`, **never** from the store — importing the store into a client component is what broke the production build at `763febd`.

- [ ] **Step 2: Add the settings editors**

Beside the existing consulting phase list, add a number input per phase writing `consultingPhaseWeights[name]`. Add a discipline list editor writing `consultingDisciplines`, following the existing list-editor pattern in that file. Both gated on `manage_users`.

- [ ] **Step 3: Add disciplines to the consulting quote builder**

A checkbox row from `mergedConsultingDisciplines`, posted as `disciplines` alongside the existing `phases` and `scopes`. The engagement spawn copies it onto `ConsultingEngagement.disciplines`.

- [ ] **Step 4: Run the gates**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run test:specs && npm run test:smoke
```

- [ ] **Step 5: Verify in the app**

Author a set with phase, discipline and percentages; set phase weights in Settings; build a consulting quote with two disciplines ticked; confirm the engagement carries them and generation respects both gates.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/task-templates/" "src/app/(app)/settings/" "src/app/(app)/design/engagements/quote/"
git commit -m "feat(consulting): admin authoring for template units, phase weights and disciplines (#145, D165/D166)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `/schedule` gains consulting and a By person view

**Files:**
- Modify: `src/app/(app)/schedule/page.tsx` (consulting rows, the third view, wiring `GanttGrid`)
- Create: `src/app/(app)/schedule/people-lib.ts` (pure row grouping)
- Test: `scripts/test-review-and-spec.ts` (append); `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: `GanttGrid`, `GanttRow` (Task 5); `moveTaskAction` (Task 6); `tasksForEngagement` (Task 2).
- Produces: `groupByPerson(tasks, users): GanttRow[]`.

- [ ] **Step 1: Write the failing tests**

```ts
/* ====== #145: the By person view ====== */
const ppl145 = [{ id: "u1", name: "Jeff C." }, { id: "u2", name: "Chris C." }];
const tk145 = [
  { id: "T-1", title: "SD set", assigneeUserId: "u1", assigneeName: "Jeff C.", startAt: OCT6, dueAt: OCT6 + 5 * DAY145, engagementId: "CE-1", handScheduled: false },
  { id: "T-2", title: "QC", assigneeUserId: "u1", assigneeName: "Jeff C.", startAt: OCT6 + 2 * DAY145, dueAt: OCT6 + 6 * DAY145, engagementId: "CE-1", handScheduled: false },
  { id: "T-3", title: "Rigging", assigneeUserId: null, assigneeName: "", startAt: OCT6, dueAt: OCT6 + DAY145, engagementId: "CE-1", handScheduled: false },
];
const rows145 = groupByPerson(tk145, ppl145);
ok(rows145.length === 3, "#145 groupByPerson emits a lane per active person plus an Unassigned lane");
ok(rows145[0].bars.length === 2, "#145 a person's lane carries every task assigned to them across projects");
ok(rows145.find((r) => r.label === "Unassigned")?.bars.length === 1, "#145 unassigned work is visible rather than silently dropped");
ok(rows145.find((r) => r.label === "Chris C.")?.bars.length === 0, "#145 a person with no work still gets a lane — an empty lane is the answer to 'who is free'");
ok(rows145[0].bars.every((b) => b.draggable), "#145 consulting bars are draggable on the portfolio view");
```

Add: `import { groupByPerson } from "@/app/(app)/schedule/people-lib";`

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:specs
```

- [ ] **Step 3: Write the grouping**

Create `src/app/(app)/schedule/people-lib.ts` — pure, no imports beyond the `GanttRow`/`GanttBar` types. One row per active user in name order, then an `Unassigned` row. A task with no `startAt` or `dueAt` is skipped (it has no bar). Bars carry `draggable: true` and `tone` by engagement so one project reads as one colour.

- [ ] **Step 4: Wire the page**

Add `view=people` to the existing `view` parse beside `crew` and `timeline`, and a third segmented-control link. In `timeline`, render consulting engagement rows in a "Consulting" group above the existing "Installs" group; engagement bars are `draggable: false` (the engagement span is edited on its own screen). In `people`, render `groupByPerson` with `onBarMove` → `moveTaskAction`.

Install project bars stay `draggable: false` throughout (D172 — install tasks are not in this model).

- [ ] **Step 5: Run the tests, gates and smoke**

```bash
npm run test:specs && npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run test:smoke
```

Add `/schedule?view=people` to `smoke-routes.ts`.

- [ ] **Step 6: Verify in the app**

Open `/schedule?view=people`, confirm consulting tasks lane by assignee, drag one, reload, confirm it persisted and that the engagement's own Schedule tab shows the same new date.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/schedule/" scripts/
git commit -m "feat(schedule): consulting rows and a By person portfolio view (#145, D172)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Decisions, punchlist, and the full-branch gate

**Files:**
- Modify: `DECISIONS.md` (D164–D172)
- Modify: `PUNCHLIST.md` (#145)
- Modify: `AGENTS.md` (phase status line)

- [ ] **Step 1: Write the decisions**

Append D164–D172 to `DECISIONS.md`, one entry each, copying the rationale from spec §3 — including the rejected alternative and why it lost. These are the entries a future reader uses to avoid re-litigating: D166 must record that whole-project percentages break on scope change, and D168 must record that rippling moves the wrong half.

- [ ] **Step 2: Write the punchlist entry**

Append #145 to `PUNCHLIST.md` following the house format: **What existed** (templates had no date model; consulting work could not be assigned at all), **Shipped** (the file list from Tasks 1–12), **Found and fixed during review** (fill in from what actually happens), **Verified in the running app** (the concrete checks from each task's verification step), and **Gates** with real numbers.

Carry forward the three open items from spec §9: phase weights have no real values, no default template content, Drive folder naming unconfirmed.

- [ ] **Step 3: Update the phase status**

Add a line to `AGENTS.md` under the phase list recording consulting project management as shipped, with the item and decision range.

- [ ] **Step 4: Run every gate against a clean baseline**

```bash
git stash && npm run lint 2>&1 | tail -3 && npx tsc --noEmit; git stash pop
```

Record the baseline numbers, then:

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run test:specs 2>&1 | tail -3 && npm run test:smoke 2>&1 | tail -3
```

Expected: `tsc` 0 errors · lint at or below the stashed baseline with no errors · `test:specs` ALL PASSED · `test:smoke` ALL PASSED. **Report the real numbers** — a gate reported without its number has not been run.

- [ ] **Step 5: Confirm no stray processes**

```bash
ps aux | grep "[t]sx" | wc -l
```

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(consulting): log D164–D172 and punch #145

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Walked every section:

| Spec section | Task |
|---|---|
| §4.1 engine · §4.2 math + degenerate cases | 1 |
| §4.3 record changes · milestone `phaseId` defaulting · `targetDate` rule | 2, 4 |
| §4.4 storage seam | 2 (local `FileRef`), 9 (real module) |
| §5.1 creation flow | 4 |
| §5.2 Schedule tab · drag · overrun flag · milestone dialog | 5, 6 |
| §5.3 Activity tab · composer · feed · Krisp pre-fill | 7, 8 |
| §5.4 all-projects schedule · By person | 12 |
| §5.5 admin authoring · CSV | 10, 11 |
| §5.6 Drive | 9 |
| §6 error handling | 4 (span), 7 (rollback), 9 (ownership), 10 (per-row) |
| §7 testing | every task |
| D165 disciplines on the quote builder | 11 |

No gaps found.

**Type consistency.** `TaskRecord.schedule` is `{ phaseId, startPct, lengthPct }` in Tasks 2, 3, 6 and the engine's `ShiftCandidate`. `FileRef` is declared locally in Task 2 and replaced by the real import in Task 9 — called out explicitly in both. `phaseWeightsFor` returns a slug `phaseId` that Task 4 overwrites with the engagement's own `EngagementPhase.id`; the note in Task 2 Step 6 says so, and Task 4's action does it in both `previewScheduleAction` and `generateScheduleAction`.

**One correction made inline:** Task 4's first draft put `validateSpan` in a `"use server"` module, which the harness cannot import. It now lives in `consulting-schedule.ts`, and the step says why.
