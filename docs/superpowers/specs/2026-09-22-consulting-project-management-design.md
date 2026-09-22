# Consulting project management — design

**Date:** 2026-09-22
**Item:** #145
**Decisions:** D164–D172 (next free after D163)
**Slice:** 1 of 3. Slices 2 (Drive-backed attachments, full) and 3 (vendor quotes Blob → Drive) are separate specs.

---

## 1. What this is

Consulting engagements (`CE-####`) carry a lifecycle, phases, milestones, meetings and
documents, but no way to plan or assign work. This adds three things Jeff asked for:

1. **Task templates whose deadlines derive from project scope and dates** — admin-authored,
   CSV-importable, expanded onto an engagement at creation.
2. **Assignment** — template lines target a person, a role, or everyone; tasks fan out
   accordingly and appear on a per-person schedule across all work.
3. **Capture** — tasks, files and notes added to an engagement from what gets discussed,
   in one action, with the resulting records linked to each other.

Plus the Gantt that makes the schedule usable: one per engagement, one across all projects.

## 2. What already exists

Verified in the tree before designing. This feature is mostly wiring, not greenfield.

| Piece | Location | State |
|---|---|---|
| Consulting engagement | `src/lib/stores/engagements.ts`, UI `src/app/(app)/design/engagements/` | 6-stage ladder, phases (review/checklist/comments/attachments/markup), milestones, decisions, meetings, submittals, documents, people-with-roles |
| Task template sets `TT-###` | `src/lib/stores/task-templates.ts`, `/task-templates` | Lines = title + section + target (person/role/team); fan-out + coverage-key dedup; admin-gated on `manage_users` |
| Tasks `T-####` | `src/lib/stores/tasks.ts` | `dueAt`, assignee, 4-state status, notes; nullable `projectId`/`quoteId`/`designId` |
| Notes `N-####` | `src/lib/stores/notes.ts` | Attachable record; `parentKind` = customer/lead/project/quote |
| Import registry | `src/app/(app)/import/types.ts`, `registry.ts:973` | Per-type fields with `header`/`aliases`/`example`; template CSV download; alias auto-map; preview→confirm; dedupe |
| Schedule grid | `src/app/(app)/schedule/page.tsx:268` | Day cells, week marks, weekend shading, today line, week paging. Read-only; install projects only |
| Google Drive | `src/lib/google/drive.ts` | `ensureFolder` (cached), `uploadFileResumable`, `driveFileLink`, 401/403/404 → admin-actionable messages; `drive.file` scope; injectable transport |
| Blob seam | `src/lib/blob.ts` | Private store, env-gated, data-URL fallback |
| Disciplines | `src/lib/stores/survey-intake.ts:124` | `rigging`, `curtain`, `lighting`, `av` |
| Krisp recordings | `src/lib/krisp/`, engagement `meetings[]` | Recordings + minutes + attendees + Drive archive |

**Gaps this spec closes:** templates have no date model; `TemplateRecordKind` excludes
consulting and `TaskRecord` has no engagement pointer, so consulting work cannot be
assigned at all; engagements have no start or end date; `NoteParentKind` excludes
engagements.

## 3. Decisions

Each was put to Jeff with alternatives; the chosen option and the reason it won.

- **D164 — Consulting PM attaches to the existing `CE-####` engagement.** Not a new
  record, not the install `Project`. The engagement already carries client, sites,
  people-with-roles, phases, fees and the document trail; a parallel record would
  duplicate all of it and force a "which one is the project" decision on every screen.
- **D165 — Scope is phases × disciplines.** A template line is tagged with a phase and
  optionally a discipline. An engagement expands only the lines whose phase it has and
  whose discipline it bought. **A blank discipline matches every discipline**, so
  phase-only templates work on day one. Phases already flow from the consulting quote
  (`quote/actions.ts:69`); disciplines are added to the quote builder and reuse the
  intake four, made admin-editable in Settings. Free-text `ConsultingScope` lines were
  rejected as template keys — they cannot key anything.
- **D166 — Dates are proportional units, not days.** The engagement carries a typed
  `startAt` and `endAt`. Selected phases carry weights and divide that span into
  windows; a task line carries a start percentage and a length percentage **within its
  own phase window**. A longer engagement gives every task proportionally more room;
  dropping a phase redistributes the remainder in proportion rather than stranding
  tasks at stale absolute positions. Whole-project percentages and task-weight chaining
  were both rejected — the first breaks on scope change, the second forces every task
  serial and forbids rigging and curtain running the same week.
- **D167 — Milestones are locked; tasks are flexible.** Milestone dates are computed at
  creation and then fixed, edited only from the engagement's main screen. Tasks are
  freely draggable on the Gantt with no confirmation. This replaces any pin/re-flow
  arbitration: the two layers never fight because only one of them moves casually.
- **D168 — A milestone gains a `phaseId`; moving it offers to move that phase's tasks.**
  Milestones (billing, seeded from scope lines) and phases (structure, carrying the
  tasks) are different lists, so the link is explicit. The shift dialog pre-ticks the
  milestone's phase's tasks as a checklist that can be adjusted. **Hand-dragged tasks
  are excluded from the pre-tick** — a task moved for a reason the app cannot see is
  never moved by the app. Rippling everything after the milestone was rejected: the work
  that actually slipped sits *before* the deliverable, and what ripples is the bid
  schedule, usually the one date Peak does not control.
- **D169 — Templates import by CSV through the existing import registry.** A
  `task_templates` import type, not a new importer: example-row download, alias
  auto-mapping, preview→confirm and dedupe are inherited.
- **D170 — One Activity tab with a composer that emits note + files + tasks together.**
  The three records stay linked, so a task's origin is answerable six months later. The
  feed merges notes, meetings, decisions, phase attachments and milestone moves. A
  milestone move writes a **system-authored note** rather than introducing a history
  table. Krisp/meeting pre-fill is in v1.
- **D171 — Attachments write through a `FileRef` union; Drive is upload-only.** Drive
  when connected, Blob when not, data-URL locally. No Drive *picker* — that needs a
  scope beyond `drive.file` and a consent-screen change. No vendor-quote migration here.
- **D172 — Consulting first, on a parent-agnostic engine.** Install `Projects` keep
  their existing stage-keyed `TASK_TEMPLATE` (`tasks.ts:67`, Jeff-reviewed Aug 2026).
  Phases and stages are different axes; reconciling them while building the scheduler
  is the expensive path. The engine takes primitives, so wiring Projects in later is a
  connection job.

## 4. Architecture

### 4.1 The scheduling engine is pure

New module `src/lib/consulting-schedule.ts`, following the `consulting-stages.ts`
precedent: **zero imports**, no DB, client-bundleable, spec-testable.

```ts
phaseWindows(startAt, endAt, phases, weights)  → { phaseId, name, startAt, endAt }[]
selectLines(lines, phases, disciplines)        → TaskTemplateLine[]
placeTask(window, startPct, lengthPct)         → { startAt, dueAt }
generateSchedule(engagement, set, weights)     → { tasks, milestones }
shiftForMilestone(milestone, deltaMs, tasks)   → { moved, skipped }
overrunsEnd(task, endAt)                       → boolean
```

Every date computation lives here and nowhere else. It accepts primitives rather than
engagements, which is what makes D172's later wiring a connection job.

### 4.2 The math

```
window(phase)  = [ start + span × (Σweights before) / Σweights,
                   start + span × (Σweights through) / Σweights ]

task.startAt   = window.start + windowLen × startPct  / 100
task.dueAt     = task.startAt + windowLen × lengthPct / 100
```

**Worked example.** North HS Auditorium, Oct 6 → Mar 30 (175 days). Phases and weights:
Assessment 2, Schematic Design 4, Design Development 6, Final Documents 5, Bid Support 3
(Σ = 20).

| Phase | Window | Days |
|---|---|---|
| Assessment | Oct 6 – Oct 23 | 17.5 |
| Schematic Design | Oct 23 – Nov 27 | 35 |
| Design Development | Nov 27 – Jan 13 | 52.5 |
| Final Documents | Jan 13 – Mar 2 | 43.75 |
| Bid Support | Mar 2 – Mar 30 | 26.25 |

A Final Documents line at `startPct 60, lengthPct 20` → starts Jan 13 + 26.25d = **Feb 8**,
runs 8.75d, due **Feb 17**.

Drop Bid Support (Σ = 17): every remaining window grows in proportion; Final Documents
becomes Jan 24 – Mar 30, and the same line lands Mar 1 – Mar 11. Nothing is stranded.

**Degenerate inputs**, all handled in the engine and pinned by tests: `endAt <= startAt`
→ zero-length windows, every task lands on `startAt`, UI shows a blocking validation
message at creation; a phase with weight 0 or absent → weight 1; `Σweights = 0` →
equal division; `startPct + lengthPct > 100` → the bar is clamped to the window end
rather than spilling into the next phase.

### 4.3 Record changes

```ts
// ConsultingEngagement
startAt: number;            // epoch-ms, typed at creation
endAt: number;              // epoch-ms, typed at creation
disciplines: string[];      // from the quote, editable on the engagement

// EngagementMilestone
phaseId: string | null;     // D168 — see the defaulting rule below

// TaskRecord
engagementId: string | null;                                   // 4th nullable parent (D85)
startAt: number | null;                                        // bar start; dueAt = bar end
schedule: { phaseId: string; startPct: number; lengthPct: number } | null;
handScheduled: boolean;                                        // set on drag

// TaskTemplateLine
phase: string;              // matches the phase menu
discipline: string;         // "" = every discipline
startPct: number;           // 0–100 within the phase window
lengthPct: number;

// NoteRecord
attachments: FileRef[];
taskIds: string[];
```

`TemplateRecordKind` gains `"consulting"`; `NoteParentKind` gains `"engagement"`.
All new fields are normalize-on-read with absent-safe defaults, matching the lazy-migration
idiom already used for `EngagementPhase.checklist` and `comments` — nothing is bulk-rewritten.

**`EngagementMilestone.phaseId` defaults by exact name match, else null.** Milestones seed
from free-text `ConsultingScope` titles, so no inference is attempted: a milestone whose
name exactly matches a phase name (case-insensitive, trimmed) takes that phase; everything
else is `null` and is set from a dropdown on the milestone row. A milestone with a null
`phaseId` still moves; its shift dialog simply pre-ticks nothing, degrading to the manual
checklist rather than guessing which tasks belong to it.

**`EngagementMilestone.targetDate` is computed at creation for phase-matched milestones**
instead of always seeding to `0` (`consulting-stages.ts` `milestoneSeeds` /
`manualMilestoneSeeds`). The rule: a milestone with a `phaseId` takes **its phase window's
end date** — a deliverable is due when its phase finishes. A milestone with a null
`phaseId` keeps `targetDate: 0` and stays unscheduled until dated by hand.

Consequence, accepted: phase-matched consulting milestones begin appearing in the
**Reports billing forecast**, which filters `targetDate > 0`. Milestones named after
scope lines that don't match a phase behave exactly as they do today. Pre-existing
engagements are unaffected — they have no `startAt`, so nothing recomputes until someone
schedules them.

**Settings** gains `consultingPhaseWeights: Record<string, number>` (a number beside each
phase in the existing editor) and `consultingDisciplines: string[]` (seeded from the intake
four), both following the `mergedConsultingPhases` whole-list-override idiom.

### 4.4 The storage seam

```ts
type FileMeta = { name: string; mime: string; size: number };
type FileRef =
  | ({ kind: "drive"; fileId: string; webViewLink: string } & FileMeta)
  | ({ kind: "blob";  pathname: string }                    & FileMeta)
  | ({ kind: "data";  dataUrl: string }                     & FileMeta);
```

One union, resolved at write time by what is configured. Slice 2 and slice 3 are backend
work behind it with no UI change.

## 5. Surfaces

### 5.1 Creation

The engagement creation flow — both the quote sweep's spawn and the manual `#135` path —
gains a scheduling step: type `startAt` and `endAt`, confirm phases and disciplines
(pre-filled from the quote), pick a template set, **preview the generated schedule**,
commit. Nothing is written until commit. An engagement may be created unscheduled and
scheduled later; the Schedule tab offers generation whenever `startAt`/`endAt` are unset.

Re-applying a template uses the existing `expandTemplate` coverage-key dedup, so it is
additive — a newly hired Estimator picked up by a role target gets their task, everyone
else's rows are untouched.

### 5.2 Schedule tab (per engagement)

Phase windows as bands; milestone diamonds, locked; task bars, draggable. Dragging writes
`startAt`/`dueAt` and sets `handScheduled`. Bars extending past `endAt` render red —
**flagged, not blocked**: a schedule slipping past a committed date is information.
Grouping by phase, with a by-assignee toggle.

### 5.3 Activity tab

One composer: body text, dropped files, and checkable lines that become assigned, dated
tasks. Submitting writes a `NoteRecord` carrying `attachments` and `taskIds`, plus the
tasks themselves, in one server action.

The feed merges, newest first: notes (with their spawned tasks and files inline), meetings,
decisions, phase attachments, and milestone-move notes. Nothing new is stored for the
records that already exist.

**Krisp pre-fill (v1).** Opening the composer from a meeting or a recording pre-fills the
body with the minutes and attaches attendees. Task lines are ticked by a human — nothing
is auto-extracted.

### 5.4 All-projects schedule

`/schedule` gains consulting and becomes editable for the first time. The project timeline
grows consulting rows grouped beside installs; a new **By person** view lanes every assignee
against their tasks across both kinds of work — the view that answers whether anyone is
double-booked, and the one that makes template fan-out meaningful.

Install project bars stay read-only in v1 (install tasks are not in this model — D172).
The existing day-grid, week paging and today line are reused; the drag layer is new and
lands once for both views.

### 5.5 Admin — template authoring and import

`/task-templates` gains phase, discipline, `startPct` and `lengthPct` per line, and a CSV
import/export pair through the import registry.

```
Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %
Consulting — Full Design,consulting,Assessment,rigging,Field-verify grid heights and attachment points,Assessment,role:Estimator,0,20
Consulting — Full Design,consulting,Assessment,,Site photos and existing-conditions notes,Assessment,team,10,15
Consulting — Full Design,consulting,Schematic Design,rigging,Draft lineset schedule,Design,person:Jeff Chesebro,0,40
Consulting — Full Design,consulting,Final Documents,,Internal QC pass,Design,role:Reviewer,60,20
```

Many rows make one set, keyed by `Template Set`. Blank `Discipline` = every discipline.
`Assign To` accepts `person:<name>`, `role:<Role>`, or `team`. Import is **replace-by-set**,
not append: re-importing a set replaces its lines, so a corrected spreadsheet is the source
of truth. Rows are validated against the live phase and discipline lists; unknown values
are reported per-row in the preview and the import can still be committed without them.

Phase weights are edited in Settings beside the phase list, not in this CSV.

### 5.6 Drive

`ensureFolder` builds `Peak Projects / <customer> / <CE-id>`, caching ids in settings as the
recordings archive already does. Interactive upload: the server initiates a resumable
session and returns the session URL; **the browser PUTs the bytes directly**, bypassing the
1200kb server-action and ~4.5MB function-body ceilings. The record is written only after
Drive returns a file id.

Falls back to Blob, then data-URL. `drive.file` scope is unchanged — the app sees only what
it created.

## 6. Error handling

- **Drive 401/403/404** already map to admin-actionable messages (`driveErrorFor`). An
  upload failure leaves the note unsaved with the text preserved and the file unattached —
  the composer never silently drops typed content.
- **Partial composer submit** — tasks and the note are written in one action; a task write
  failure rolls the action back rather than leaving orphan tasks.
- **Template import** — per-row errors in the preview, same as every other import type.
- **Schedule generation** — invalid `startAt`/`endAt` blocks at the creation step with a
  message, never generates a degenerate schedule silently.

## 7. Testing

The engine is pure, so `test:specs` covers it with no DB: phase-window division including
the degenerate cases in §4.2, scope selection (blank-discipline matching, missing phase),
placement and the `startPct + lengthPct > 100` clamp, `shiftForMilestone` set membership
including `handScheduled` exclusion, and `overrunsEnd`. Store-level tests cover normalize-
on-read defaults for every new field. Route coverage for the new tabs and the editable
`/schedule` goes in `test:smoke`.

Gates as usual: `tsc` 0 errors, `eslint` at the stashed baseline, `test:specs`, `test:smoke`.

## 8. Out of scope

- **Task dependencies.** Every date derives from its phase window. Confirmed sufficient.
- **Install projects.** D172 — later, through the engine's seam.
- **Drive picker.** Needs a scope beyond `drive.file` and a consent-screen change. Slice 2.
- **Vendor quotes Blob → Drive.** Slice 3 — a migration of live production data behind an
  authenticated proxy with a `blobPath` ownership check, deliberately kept off the critical
  path of a scheduling feature.
- **Automatic task extraction from recordings.** Krisp pre-fills the body; a human ticks
  the task lines.

## 9. Open for Jeff

1. **Phase weights have no real values yet.** The spec's 2/4/6/5/3 are illustrative. Seeded
   defaults will be a guess until Jeff supplies typical phase durations — the same
   situation as the `TASK_TEMPLATE` content before the Aug 2026 walkthrough.
2. **Default template set content.** Nothing is invented here; the CSV import exists so
   Jeff can author the first real sets rather than inherit guesses.
3. **Drive folder naming.** `Peak Projects / <customer> / <CE-id>` is a proposal; the
   recordings archive uses `Peak Recordings / <customer>`.
4. **Disciplines on historical engagements** are absent and will read as empty, meaning
   every discipline-tagged line matches. Acceptable for old records; worth confirming.
