# Venue Assessment notes — Slice B (field-level changes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeff's field-level notes 1, 4, 5, 8, 10 (non-drawing), 15, 16, 17 (goals list), 18, 19, 21, 22 (quantity-first table) on the Venue Assessments (`FS-####`) editor — new pick lists, a Bad→New condition slider, per-curtain-type rows, lighting position rows, a quantity-first line set table, goals as a list, travel auto-fill — with every renamed/removed field migrated on read.

**Architecture:** Pure lists and parsers in a new `src/lib/field-lists.ts`; new read-time steps appended to the `migrateSurvey` chain in `src/lib/survey-migrate.ts` (never delete a key; unmappable values → `legacyNotes`); field definitions in `src/lib/stores/survey-intake.ts`; shared UI components (`ConditionSlider`, `GoalsListEditor`, `ScopeChips`) under `src/app/(app)/venue-assessments/[id]/sections/`; the editor (`controls.tsx`, `systems.tsx`, `linesets.tsx`) consumes them. The Assessments engine (#340) gets strictly additive questions and pick-list values.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle doc-store JSONB, `tsx` spec harness.

**Spec:** `docs/superpowers/specs/2026-10-14-venue-assessment-notes-design.md` — R1, R4, B1–B9. Slice A (#344, D1019–D1032) is on main; this branch `feat/344-va-notes` continues from it.

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/va-notes` on branch `feat/344-va-notes`. Never `cd` to the main checkout. Never bare `git stash`. Never touch `.superpowers/sdd/task-4-report.md` (a tracked file from another feature).
- `export PATH="$HOME/.local/node/bin:$PATH"` before node commands. Read AGENTS.md's Conventions + PGlite sections; Next 16 differs from training data.
- PGlite is single-process. `npm run test:specs` uses its own temp datadir (safe). Don't start a dev server inside tasks.
- Never click photo/sketch upload or Email report in local dev (real Blob token in `.env.local`).
- No migration file, no new env var.
- Read-time migration never deletes a stored key; anything unmappable becomes a `LegacyNote` (derived each read, never stored). Every new migration step must be idempotent and covered by a check in `scripts/test-va-notes.ts`.
- Client components must not import stores or server modules at runtime (type-only imports are fine). `npm run build` catches it.
- Copy: labels exactly as given here (Jeff's wording); sentence case.
- Commit trailer: `Co-Authored-By:` your session's model line.
- Punch item **#344**; label new harness checks `#344 B<n>: …`.
- Every task ends with `npx tsc --noEmit` clean, `npx tsx scripts/test-va-notes.ts` all PASS, eslint on touched files (one pre-existing `Date.now` purity warning in `controls.tsx` allowed), and a commit. Tasks that touch the editor also run `npm run test:specs` and `npm run build` once.

## Decisions taken while planning (log in DECISIONS at the end)

- **Seating ↔ auditorium size is NOT linked** (spec B3 listed it): `auditoriumSize` is a small/medium/large select, `measurements.seating` is a head count — different facts. Left as two fields.
- Condition levels are stored as numbers 0–4 (`0` Bad … `4` New); unset = key absent.
- Goals: `disciplines[k].goals` becomes `string[]`; `goalsFromSurvey` keeps returning text (lines joined with `\n`) so the Estimator, cover and package are untouched; a new `goalListsFromSurvey` returns the arrays for the recap and the sheet.
- `DisciplineData` widens to allow numbers and plain objects (curtain rows, position rows).

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/field-lists.ts` | new | Fixed pick lists (lift, door, track series/operation, plug, lighting positions, fixture positions, console location), condition steps + parsers, month-year parser, travel text formatters, `listSlug` |
| `src/lib/survey-migrate.ts` | modify | New steps: access, measurement links, beams drawings, scope relabels, goals list, curtain, lighting, AV condition, lineset quantity/condition |
| `src/lib/stores/survey-intake.ts` | modify | `DisciplineData` widening, `SystemField` types (`textarea`/`month`/`condition`, `bind`), curtain/lighting/AV/rigging field defs, scope lists with Other, `InventoryRow.position`, `disciplineHasData` objects |
| `src/lib/stores/surveys.ts` | modify | Record fields (`loadingDoorType/Location/WH`, `liftRequired/liftType/liftWorkingHeight`, `linesetQty`), `BEAM_FIELDS` drawing checks |
| `src/lib/stores/linesets.ts` | modify | `LinesetRow.condition?`, quantity plan helper |
| `src/lib/estimate-output/goals.ts` | modify | Sanitize goal arrays; `goalListsFromSurvey` |
| `src/lib/survey-flow.ts` | modify | `finalQuestions` section; recap reads goal lists |
| `src/lib/survey-travel-server.ts` | new | Server: verified venue → one-way minutes/miles suggestion |
| `src/lib/assessments/defs/picklists.ts`, `defs/scopes/access.ts`, `defs/scopes/lighting.ts` | modify | Additive engine questions/values |
| `src/app/(app)/venue-assessments/[id]/sections/condition-slider.tsx` | new | Bad→New slider |
| `src/app/(app)/venue-assessments/[id]/sections/goals-list.tsx` | new | One-goal-per-line editor |
| `src/app/(app)/venue-assessments/[id]/sections/scope-chips.tsx` | new | Scope of interest chips + Other explain box |
| `src/app/(app)/venue-assessments/[id]/sections/curtain-rows.tsx` | new | Per-curtain-type rows |
| `src/app/(app)/venue-assessments/[id]/sections/lighting-positions.tsx` | new | Position multi-select + rows |
| `src/app/(app)/venue-assessments/[id]/sections/systems.tsx` | modify | New section layout, field types, bind, inventory Position + totals |
| `src/app/(app)/venue-assessments/[id]/sections/linesets.tsx` | modify | Quantity-first table, slider, Fill down, Mark spare |
| `src/app/(app)/venue-assessments/[id]/controls.tsx`, `page.tsx`, `types.ts`, `actions.ts` | modify | Travel fill, access fields, beams toggles, Final questions section, patch fields |
| `src/app/globals.css` | modify | `--cond-0…4` tokens (light + dark) |
| `src/lib/venue-assessment-sheet.ts`, `src/lib/survey-findings.ts` | modify | Print/emit the new fields |
| `scripts/test-va-notes.ts` (+ pins in `scripts/test-review-and-spec.ts`) | modify | Checks |

---

### Task B1: `field-lists.ts` + engine additions

**Files:** Create `src/lib/field-lists.ts`; modify `src/lib/assessments/defs/picklists.ts`, `defs/scopes/access.ts`, `defs/scopes/lighting.ts`; modify `scripts/test-va-notes.ts`.

**Produces:**
- `LIFT_TYPES`, `LOADING_DOOR_TYPES`, `TRACK_SERIES`, `TRACK_OPERATIONS`, `PLUG_TYPES`, `LIGHTING_POSITIONS`, `FIXTURE_POSITIONS`, `CONSOLE_LOCATIONS`, `CONDITION_STEPS` (all `readonly string[]`)
- `type ConditionLevel = 0 | 1 | 2 | 3 | 4`; `isConditionLevel(v: unknown): v is ConditionLevel`; `conditionLabel(v: unknown): string`; `conditionFromText(raw: unknown): ConditionLevel | null`
- `parseMonthYear(raw: unknown): string | null` (→ `YYYY-MM`)
- `consoleLocationFrom(raw: unknown): { value: "" | "Booth" | "Stage" | "Other"; other: string; exact: boolean }`
- `travelTimeText(min: number): string`, `distanceText(miles: number): string`
- `listSlug(label: string): string`

- [ ] **Step 1: Failing checks** — append to `vaNotesChecks` (import from `../src/lib/field-lists` and `../src/lib/assessments/defs`):

```ts
  /* ---- B1: field lists ---- */
  ok(LIFT_TYPES.join("|") === "Ladder >12ft|Scaffolding|Single Man Lift|Scissor >20ft|Scissor >40ft|Scissor >50ft", "#344 B1: lift types (Jeff)");
  ok(LOADING_DOOR_TYPES.join("|") === "Roll-up / overhead|Double doors|Single door|Dock door|Other", "#344 B1: loading door types");
  ok(TRACK_SERIES.join("|") === "N/A|None|Lightweight|Standard|Curved" && TRACK_OPERATIONS.join("|") === "SL|SR", "#344 B1: track lists");
  ok(PLUG_TYPES.join("|") === "Stage-pin|Edison|Twist-lock|Other|Mixed", "#344 B1: plug types");
  ok(LIGHTING_POSITIONS.join("|") === "Electric 1|Electric 2|Electric 3|Electric 4|Electric 5|FOH 1|FOH 2|FOH 3|Torms|Balcony|Other", "#344 B1: lighting positions");
  ok(FIXTURE_POSITIONS.join("|") === "Front|Down|Side|Back|Cyc|Movers" && CONSOLE_LOCATIONS.join("|") === "Booth|Stage|Other", "#344 B1: fixture positions + console locations");
  ok(CONDITION_STEPS.join("|") === "Bad|Poor|Fair|Good|New" && conditionLabel(4) === "New" && conditionLabel(0) === "Bad" && conditionLabel(undefined) === "" && conditionLabel(7) === "", "#344 B1: condition steps");
  ok(conditionFromText("Good") === 3 && conditionFromText(" fair ") === 2 && conditionFromText("POOR") === 1 && conditionFromText("new") === 4 && conditionFromText("bad") === 0 && conditionFromText("Needs replacement") === null && conditionFromText("ok-ish") === null,
    "#344 B1: condition text maps only on exact words");
  ok(parseMonthYear("3/2024") === "2024-03" && parseMonthYear("03/2024") === "2024-03" && parseMonthYear("2024-03") === "2024-03" && parseMonthYear("2024-03-17") === "2024-03" &&
     parseMonthYear("March 2024") === "2024-03" && parseMonthYear("Mar 2024") === "2024-03" && parseMonthYear("3/17/2024") === "2024-03" && parseMonthYear("last spring") === null && parseMonthYear("13/2024") === null && parseMonthYear("") === null,
    "#344 B1: month-year parser");
  const cl = consoleLocationFrom("Booth, back of house");
  ok(cl.value === "Booth" && !cl.exact && consoleLocationFrom("stage").value === "Stage" && consoleLocationFrom("stage").exact && consoleLocationFrom("SL wing").value === "Other" && consoleLocationFrom("SL wing").other === "SL wing" && consoleLocationFrom("").value === "",
    "#344 B1: console location keywords");
  ok(travelTimeText(35) === "35 min" && travelTimeText(80) === "1 h 20 min" && travelTimeText(60) === "1 h" && distanceText(22.4) === "22 mi" && distanceText(0.4) === "1 mi", "#344 B1: travel text");
  ok(listSlug("Ladder >12ft") === "ladder_12ft" && listSlug("Roll-up / overhead") === "roll_up_overhead", "#344 B1: engine slugs");
  const pl = ASSESSMENT_DEF.pickLists;
  ok(pl.lift_type?.map((o) => o.label).join("|") === LIFT_TYPES.join("|") && pl.door_type?.length === 5 && pl.lighting_position?.length === 11 && pl.connector.some((o) => o.value === "mixed"),
    "#344 B1 (R4): engine pick lists share the survey lists; connector gains Mixed");
  const qk = allQuestions(ASSESSMENT_DEF).map((q) => q.key);
  ok(["access.lift_type", "access.lift_height", "access.load_in_door_type", "lighting.positions"].every((k) => qk.includes(k)) && ASSESSMENT_DEF.version === 1,
    "#344 B1 (R4): additive engine questions; definition version unchanged");
```

(`allQuestions` is exported from `src/lib/assessments/defs` — check its exact signature in `defs/index.ts` and adapt the call.)

- [ ] **Step 2: Run** `npx tsx scripts/test-va-notes.ts` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/field-lists.ts`**

```ts
/* Venue Assessments (#344, slice B) — fixed pick lists and small parsers shared by the survey editor, the field
   sheet, the read-time migration and the Assessments engine (R4: both forms use the same lists). Pure. Jeff chose
   fixed-in-code lists (Oct 14); changing one is a code change. */

export const LIFT_TYPES: readonly string[] = ["Ladder >12ft", "Scaffolding", "Single Man Lift", "Scissor >20ft", "Scissor >40ft", "Scissor >50ft"];
export const LOADING_DOOR_TYPES: readonly string[] = ["Roll-up / overhead", "Double doors", "Single door", "Dock door", "Other"];
export const TRACK_SERIES: readonly string[] = ["N/A", "None", "Lightweight", "Standard", "Curved"];
export const TRACK_OPERATIONS: readonly string[] = ["SL", "SR"];
export const PLUG_TYPES: readonly string[] = ["Stage-pin", "Edison", "Twist-lock", "Other", "Mixed"];
export const LIGHTING_POSITIONS: readonly string[] = [
  "Electric 1", "Electric 2", "Electric 3", "Electric 4", "Electric 5", "FOH 1", "FOH 2", "FOH 3", "Torms", "Balcony", "Other",
];
export const FIXTURE_POSITIONS: readonly string[] = ["Front", "Down", "Side", "Back", "Cyc", "Movers"];
export const CONSOLE_LOCATIONS: readonly string[] = ["Booth", "Stage", "Other"];

/** Bad → New, stored as 0–4. */
export const CONDITION_STEPS: readonly string[] = ["Bad", "Poor", "Fair", "Good", "New"];
export type ConditionLevel = 0 | 1 | 2 | 3 | 4;

export function isConditionLevel(v: unknown): v is ConditionLevel {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4;
}

export function conditionLabel(v: unknown): string {
  return isConditionLevel(v) ? CONDITION_STEPS[v] : "";
}

/** Old free-text or Good/Fair/Poor answers → a level, only on an exact word; anything else stays a note. */
export function conditionFromText(raw: unknown): ConditionLevel | null {
  const t = String(raw ?? "").trim().toLowerCase();
  const i = CONDITION_STEPS.findIndex((s) => s.toLowerCase() === t);
  return i >= 0 ? (i as ConditionLevel) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ym = (y: number, m: number): string | null =>
  y >= 1900 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}` : null;

/** "3/2024", "03/2024", "3/17/2024", "2024-03", "2024-03-17", "March 2024", "Mar 2024" → "2024-03"; else null. */
export function parseMonthYear(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(t);
  if (m) return ym(+m[1], +m[2]);
  m = /^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/.exec(t);
  if (m) return ym(+m[2], +m[1]);
  m = /^([a-z]+)\.?\s+(\d{4})$/i.exec(t);
  if (m) {
    const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return i >= 0 ? ym(+m[2], i + 1) : null;
  }
  return null;
}

/** Old free-text console location → Booth / Stage / Other (+ the text for Other). `exact` = nothing else was said. */
export function consoleLocationFrom(raw: unknown): { value: "" | "Booth" | "Stage" | "Other"; other: string; exact: boolean } {
  const t = String(raw ?? "").trim();
  if (!t) return { value: "", other: "", exact: true };
  const low = t.toLowerCase();
  if (low.includes("booth")) return { value: "Booth", other: "", exact: low === "booth" };
  if (low.includes("stage")) return { value: "Stage", other: "", exact: low === "stage" };
  return { value: "Other", other: t, exact: true };
}

export function travelTimeText(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function distanceText(miles: number): string {
  return `${Math.max(1, Math.round(miles))} mi`;
}

/** Engine pick-list code for a label: "Ladder >12ft" → "ladder_12ft". */
export function listSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
```

- [ ] **Step 4: Engine additions (additive only — the definition version must not change)**
  - `defs/picklists.ts`: import `{ LIFT_TYPES, LOADING_DOOR_TYPES, LIGHTING_POSITIONS, listSlug }` from `@/lib/field-lists` (or a relative path matching the file's style); add to `PICK_LISTS`: `lift_type: LIFT_TYPES.map((l) => o(listSlug(l), l))`, `door_type: LOADING_DOOR_TYPES.map(…)`, `lighting_position: LIGHTING_POSITIONS.map(…)`; append `o("mixed", "Mixed")` to `connector` (after `other`).
  - `defs/scopes/access.ts`: in `access.load_in` add `one("access.load_in_door_type", "Load-in door type", "door_type")` before `access.load_in_door`; in `access.lift` add `one("access.lift_type", "Lift type", "lift_type")` and `ftin("access.lift_height", "Working height")` before `access.lift_supplier`. Import `one`, `ftin`.
  - `defs/scopes/lighting.ts`: in `lighting.stage` add `many("lighting.positions", "Lighting positions", "lighting_position")` after `lighting.pipes`.
  - Run `npx tsx scripts/test-assessments.ts`. If a coverage/inventory check (e.g. `docs/assessments/manitowoc-coverage.json`, question counts) fails because of the new keys, update that fixture/expectation to include the additive keys — never remove existing ones — and say so in the report.

- [ ] **Step 5:** `npx tsx scripts/test-va-notes.ts` → PASS; `npx tsc --noEmit`; commit `feat(venue-assessments): #344 B1 shared field lists; engine gains lift type/height, door type, lighting positions, Mixed connector`.

---

### Task B2: Data model + field definitions + read-time migration

**Files:** modify `src/lib/stores/survey-intake.ts`, `src/lib/stores/surveys.ts`, `src/lib/stores/linesets.ts`, `src/lib/survey-migrate.ts`, `src/lib/survey-flow.ts`, `scripts/test-va-notes.ts`, and any harness pin that asserts an old option label (grep).

**Consumes:** B1 exports.

**Produces:**
- `DisciplineValue = string | boolean | number | string[] | Record<string, Record<string, unknown>>`; `DisciplineData = Record<string, DisciplineValue>`.
- `SystemField = { key; label; type?: "text" | "select" | "check" | "textarea" | "month" | "condition"; options?: readonly string[]; visibleFor?: VenueClass[]; bind?: string; placeholder?: string }` (drop the `MeasureField &` intersection if it fights the wider type).
- `InventoryRow.position?: string`.
- `CurtainItem = { qty?: string; fabric?: string; oz?: string; trackSeries?: string; w?: string; h?: string; condition?: ConditionLevel }` at `disciplines.curtain.items: Record<presentLabel, CurtainItem>`.
- `PositionRow = { circuits?: string; length?: string; trim?: string; notes?: string }` at `disciplines.lighting.positionRows: Record<position, PositionRow>`; positions chosen at `disciplines.lighting.positionList: string[]`.
- Survey record: `loadingDoorType`, `loadingDoorLocation`, `loadingDoorWH`, `liftRequired` (`"" | "yes" | "no"`), `liftType`, `liftWorkingHeight` (strings, in `blank()` as `""`), `linesetQty?: number`.
- `LinesetRow.condition?: ConditionLevel`.
- `PIPES_LABEL = "Additional general purpose / scenery pipes"` exported from survey-intake.
- `SCOPE_OTHER = "Other"`.

- [ ] **Step 1: Field definitions (survey-intake.ts)**
  - Widen the types above. `disciplineHasData`: an object value counts only when it has at least one key; a number counts.
  - **Every** `scopeOptions` list ends with `"Other"`:
    - rigging: `["New grid", "System refurbish", "Add hoists", "Capacity upgrade", "Inspection only", "Other"]`
    - curtain: `["Single curtain replacement", "Single set replacement", "Flame test", "Full curtain replacement", "Other"]`
    - lighting: `["New rig", "Controls upgrade", "Fixture replacement", "Console upgrade", "Full system audit", "Other"]`
    - av: existing six + `"Other"`.
  - Curtain `presentOptions`: replace `"Fixed pipe"` with `PIPES_LABEL`.
  - Curtain `fields` become (in order): `prosHeightToGrid` "Proscenium height to grid"; `travelerCondition` (select, unchanged); `trackOperation` "Track operation" (select `TRACK_OPERATIONS`); `fixedPipeQty` "Additional general purpose / scenery pipes (qty)"; `pipeTrackLengths` "Pipe / track lengths" (textarea); `heightAboveFloor` "Height above floor"; `loadCapacity` (unchanged); `curtainType` (auditorium, unchanged); `lastFlameTest` "Last flame test" (month). Removed defs (values stay stored; migrated to notes/rows): `maskingNeeds`, `mainCondition`, `legsBorders`, `fabricColor`, `fabricWeightOz`, `finishedWH`, `condition`, `trackSeries`, `pipeDiameter`, `mounting`, `operation`, `legsQtyPairs`, `bordersQty`, `cycScrimFabric`, `replaceVsReuse` (moves to Final questions — keep the def out of the curtain field list but export `REPLACE_VS_REUSE_OPTIONS = ["Replace", "Reuse", "Mixed", "TBD"]`).
  - Lighting `fields` become: `consoleMfr`; `consoleLocation` "Console location" (select `CONSOLE_LOCATIONS`); `installYear`; `controls` "Architectural control — manufacturer / model"; `controlProtocol` (unchanged); `dimmerRack`, `dmxUniverses`, `followSpotBooth` (auditorium, unchanged); `electricalService` "Panel power feeds & locations"; `plugType` "Plug type" (select `PLUG_TYPES`). Removed defs: `fixtureQty`, `fixtureTypes`, `positions`, `fohPositions`, `console`, `circuitAccess`. (`consoleLocationOther`, `positionList`, `positionRows` are rendered by dedicated UI, not defs.)
  - Rigging `fields`: `gridHeight` gains `bind: "gridH"`; `loadingGalleryNotes` gains `bind: "loadingGallery"`; remove `battenCount` and `linesetCount` (the line set quantity replaces them).
  - AV `fields`: replace `{ key: "condition", label: "Condition" }` with `{ key: "conditionLevel", label: "Condition", type: "condition" }`.
- [ ] **Step 2: Record fields (surveys.ts, linesets.ts)** — add the survey fields above to `SurveyDraft` and `blank()`; `linesetQty?: number` optional (not in blank). `BEAM_FIELDS`: replace the `hhSheet` and `brickDrawing` checks with `{ key: "structuralDrawingOnFile", label: "Structural drawing on file", type: "check" }`, `{ key: "brickDrawingOnFile", label: "Brick drawing on file", type: "check" }`, `{ key: "cwElevationOnFile", label: "CW Elevation sheet on file", type: "check" }` — placed FIRST in `BEAM_FIELDS` (the editor gates them in B5). `LinesetRow.condition?: ConditionLevel` (import type from field-lists).
- [ ] **Step 3: Migration steps** — append to `src/lib/survey-migrate.ts`, extend `MigratableSurvey` with the fields they touch, and call them from `migrateSurvey` after `stepSeedScope` in this order: `stepAccess`, `stepMeasureLinks`, `stepBeamsDrawings`, `stepScopeRelabels`, `stepGoalsList`, `stepCurtain`, `stepLighting`, `stepAvCondition`, `stepLinesets`. Rules (each idempotent; "note" = `addLegacyNote` with the given section id and label; a value is "empty" when absent or blank after trim):
  - **stepAccess** (section `site`): `loadingDoorSize` non-empty → `loadingDoorLocation` when empty, else note "Loading door location & W × H (before #344)". `liftNeeded`: `"None needed"` → `liftRequired = "no"` (when empty); any other non-empty → `liftRequired = "yes"` (when empty) and, if `liftType` empty: `"Scaffold"` → `"Scaffolding"`, otherwise note "Kind of lift needed (before #344)". `liftHeight` non-empty → note "Lift needed — type / height (before #344)".
  - **stepMeasureLinks** (section `dRigging`): for `[gridHeight→gridH, loadingGalleryNotes→loadingGallery]`: rigging value non-empty and `measurements[target]` empty → copy into `measurements[target]`; both non-empty and different (trimmed) → note "<label> (Rigging, before #344)". **Line set quantity:** if `linesetQty` is not a number: `linesets.length > 0` → `linesetQty = linesets.length`; else the first of `linesetCount`, `battenCount` that parses as a whole number 1–200 → that; any non-empty `linesetCount`/`battenCount` that isn't the chosen number → note "Lineset count / Batten count (before #344)".
  - **stepBeamsDrawings** (section `mBeams`, measurements): `brickDrawing === true` and `structuralDrawingOnFile` undefined → `structuralDrawingOnFile = true` + note "Brick / structural drawing on file (before #344)" text "Yes — check whether it was the structural or the brick drawing"; `hhSheet === true` and `cwElevationOnFile` undefined → `cwElevationOnFile = true`.
  - **stepScopeRelabels** (per discipline `scope: string[]`, mapped in place, de-duplicated, order kept): rigging `Grid refurbish → System refurbish`; curtain `Full masking upgrade → Full curtain replacement`, `New main → Single curtain replacement`, `New legs / borders → Single set replacement`, `Traveler replacement → Other` (and `scopeOther = "Traveler replacement"` when `scopeOther` empty); lighting `Dimmer upgrade → Controls upgrade`. Curtain `present`: `Fixed pipe → PIPES_LABEL`.
  - **stepGoalsList**: each discipline's `goals` that is a string → `splitGoalLines(goals)` (from survey-flow); arrays left as they are.
  - **stepCurtain** (section `dCurtain`; branch `disciplines.curtain`, skip if absent): notes for non-empty `maskingNeeds` "Masking needed", `pipeDiameter` "Pipe diameter", `mounting` "Mounting", `fabricColor` "Fabric / colour", `fabricWeightOz` "Fabric weight (oz)", `finishedWH` "Finished width × height", `condition` "Condition", `legsBorders` "Legs & borders", `mainCondition` "Main curtain", old string `trackSeries` "Track series" (each label suffixed " (before #344)"). Folds into `items` only when the target present label is ticked AND the item field is empty: `legsQtyPairs` → `items["Legs"].qty`, `bordersQty` → `items["Borders"].qty`, `cycScrimFabric` → `items["Cyc / scrim"].fabric`; otherwise note. `trackOperation`: exactly `SL`/`SR` (case-insensitive) → normalized upper-case; any other non-empty value → note "Track operation (before #344)" and the stored text is left untouched (the select shows "— Select —" for a value that isn't an option). Auditorium `operation`: SL/SR and `trackOperation` empty → copied into `trackOperation`; other non-empty → note "Operation (before #344)". `lastFlameTest`: non-empty and not already `YYYY-MM` → `parseMonthYear` result written to `lastFlameTest` when parseable, else note "Last flame test (before #344)" (keep the raw value under the note; the month input shows empty for an unparseable value).
    - To keep an unparseable raw string from being written back as the month input's value, write the parsed value to `lastFlameTest` only on success; on failure leave the stored text untouched (the month input renders `""` for non-`YYYY-MM` values).
  - **stepLighting** (section `dLighting`, branch `disciplines.lighting`): notes for non-empty `fixtureQty` "Fixture quantity", `fixtureTypes` "Fixture types", `console` "Control console", `fohPositions` "FOH positions", string `positions` "Lighting positions", `circuitAccess` "Circuit accessibility" (suffix " (before #344)"). `consoleLocation`: a value not in `CONSOLE_LOCATIONS` → `consoleLocationFrom`: write `consoleLocation = value` and, for Other, `consoleLocationOther` when empty; if `!exact` also note "Console location (before #344)" with the original text.
  - **stepAvCondition** (section `dAv`): `disciplines.av.condition` non-empty and `conditionLevel` not a level → `conditionFromText` → write `conditionLevel`; null → note "Condition (before #344)".
  - **stepLinesets**: each row with `cond` set and `condition` undefined → `condition = { G: 3, F: 2, P: 1, X: 0 }[cond]`.
- [ ] **Step 4: survey-flow.ts** — `SECTION_ORDER` gets `"finalQuestions"` between `"project"` and `"recap"` (step 5, group wrapup); `sectionVisible("finalQuestions")` needs `curtain` in scope (`inScope`). `recapFor` reads goal arrays: `splitGoalLines` already accepts arrays — keep using the sanitized source from B7 later; for now leave as is.
- [ ] **Step 5: Checks** — append to `vaNotesChecks` one check per rule above (feed a JSON-cloned fixture through `migrateSurvey`, assert the new value AND that the old key is still present AND the note text/section), plus: idempotency (migrate twice → identical JSON); `disciplineHasData` ignores `{}`; every `scopeOptions` ends with "Other"; curtain present has `PIPES_LABEL` and no "Fixed pipe"; rigging fields have `bind` on gridHeight/loadingGalleryNotes and no battenCount/linesetCount; AV has a `condition`-type field; `BEAM_FIELDS` starts with the three drawing checks and has no `hhSheet`/`brickDrawing`; `SECTION_ORDER` has finalQuestions between project and recap; `sectionVisible({scope:["rigging"]}, "finalQuestions") === false`.
- [ ] **Step 6:** Grep `scripts/` for old labels that harness pins assert (`"Grid refurbish"`, `"Fixed pipe"`, `"Dimmer upgrade"`, `"Counterweight system"`, `fixtureQty`, `circuitAccess`, `hhSheet`, `brickDrawing`, `battenCount`) and update only fixture/expectation text that this change legitimately alters. `npm run test:specs` once. Commit `feat(venue-assessments): #344 B2 field definitions + read-time migration for renamed/removed fields`.

---

### Task B3: Shared UI pieces — condition slider, goals list, scope chips

**Files:** create `sections/condition-slider.tsx`, `sections/goals-list.tsx`, `sections/scope-chips.tsx` (under `src/app/(app)/venue-assessments/[id]/`); modify `src/app/globals.css`; checks in `scripts/test-va-notes.ts`.

**Produces:**
- `ConditionSlider({ value, onChange, label, compact? }: { value: ConditionLevel | undefined; onChange: (v: ConditionLevel | undefined) => void; label: string; compact?: boolean })` — native `<input type="range" min=0 max=4 step=1>`; "Not rated" with a ghost track until touched (render a "Rate" button that sets 2 when unset, or allow tapping a step label); the current step label shown beside it (`CONDITION_STEPS[v]`); a small "Clear" link resets to undefined. Track and thumb colour from `var(--cond-<v>)`. `aria-valuetext` = the step label.
- `GoalsListEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void })` — one `<input>` per goal (≤ 300 chars, `maxLength`), "+ Add goal" (disabled at 20), × remove, ↑/↓ reorder; Enter in a line adds a new line after it and focuses it; empty lines stay while editing (the save sanitizer drops them).
- `ScopeChips({ label, options, value, other, onChange, onOther }: { label: string; options: readonly string[]; value: string[]; other: string; onChange: (v: string[]) => void; onOther: (t: string) => void })` — chips; when "Other" is selected, a textarea "Explain the scope" (≤ 500 chars) bound to `other`.
- `globals.css`: `--cond-0: #c0392b; --cond-1: #d9772b; --cond-2: #c9a227; --cond-3: #6aa84f; --cond-4: #2e8b57;` in `:root`, and dark-mode variants (slightly lighter: `#e06b5d #e8955a #d9b84a #8cc472 #4fb07c`) wherever the file defines dark tokens (follow its existing dark-mode pattern; if none exists, add `@media (prefers-color-scheme: dark)` only if the app already themes dark — check first; otherwise light only).

- [ ] Checks: pure-ish source pins (`condition-slider.tsx` uses `type="range"`, `var(--cond-`, `aria-valuetext`; goals-list caps at 20 lines / 300 chars; scope-chips shows the explain textarea only when `value.includes("Other")`) + `globals.css` defines `--cond-0` … `--cond-4`. Commit `feat(venue-assessments): #344 B3 condition slider, goals list and scope chips`.

---

### Task B4: Discipline sections (systems.tsx)

**Files:** modify `sections/systems.tsx`; create `sections/curtain-rows.tsx`, `sections/lighting-positions.tsx`; modify `controls.tsx` (props), `types.ts`; checks.

**Consumes:** B1–B3.

Section layout top-down for every discipline (spec B5; note 19.7):
1. **Scope of interest** — `ScopeChips` with `group.scopeLabel`, `group.scopeOptions`, `scope`, `scopeOther` (writes `disciplines[k].scope` / `scopeOther`).
2. **Client goals** — `GoalsListEditor` on `disciplines[k].goals` (array; tolerate a string by passing `splitGoalLines(v)`).
3. **Present** (Rigging: the read-only rig system from Kill questions, as slice A built).
4. Unless Present is None-only: the fields grid → curtain rows / lighting positions → inventories → Notes → Older notes (already rendered by controls).

Field rendering by `SystemField.type`: `select` (options), `check`, `textarea` (full-width `taStyle`), `month` (`<input type="month">`; a stored value that isn't `YYYY-MM` renders `""`), `condition` (`ConditionSlider`), default text. A field with `bind` reads/writes `measurements[bind]` (pass `mv`/`setMeasure` into `SystemsSection`) — label it with the field label plus a hint "Same value as Measurements".

**Curtain** (`curtain-rows.tsx`): after the Present chips, one row per ticked Present option except `None` and `PIPES_LABEL`: header = the option label; inputs QTY, Fabric type (text + `<datalist>` of fabric names passed in as `fabricOptions: string[]` — from `meta`; if no fabric list is readily available server-side, ship without the datalist and log it), oz, Track series (select `TRACK_SERIES`), W, H, Condition (`ConditionSlider compact`). Writes `disciplines.curtain.items[label]`. Rows for unticked options keep their stored data (not shown). When `PIPES_LABEL` is ticked, the `fixedPipeQty` field is shown (it's a normal field def; hide it when the chip isn't ticked).

**Lighting** (`lighting-positions.tsx`): "Lighting positions" chips over `LIGHTING_POSITIONS` (writes `positionList`); per ticked position a row: Circuits, Length, Trim / height, Notes (writes `positionRows[pos]`). `consoleLocation` select; when `Other`, a text input "Other — where?" bound to `consoleLocationOther`. Fixtures inventory (`lighting.fixture` category only): each row gains a Position select (`FIXTURE_POSITIONS`); under the inventory, derived totals "Front 12 · Side 8 …" summing numeric `quantity` per position (rows without a position or a numeric qty excluded; show "~" count of excluded rows if any).

**AV**: the `conditionLevel` field renders the slider (field type `condition`).

Checks (source pins + a pure helper): export a pure `fixtureTotals(rows: InventoryRow[]): Array<{ position: string; qty: number }>` from `lighting-positions.tsx`'s sibling pure module (put it in `src/lib/stores/survey-intake.ts` to keep it client-safe and testable) and test it; pins that systems.tsx renders `ScopeChips` before `GoalsListEditor` before the Present label, handles `type === "month"`/`"condition"`/`"textarea"`, honours `bind`; update the existing harness pin in `scripts/test-review-and-spec.ts` (`#301 goals: the box sits at the top…`, ~line 51629) to the new goals editor (it must still assert goals come before Present). `npm run test:specs`, `npm run build`. Commit `feat(venue-assessments): #344 B4 scope-first disciplines, goals list, curtain rows, lighting positions, fixture positions`.

---

### Task B5: Visit travel, access fields, Beams top, Final questions

**Files:** create `src/lib/survey-travel-server.ts`; modify `page.tsx`, `controls.tsx`, `types.ts`, `[id]/actions.ts` (SurveyPatch), checks.

- **Travel (note 1):** `surveyTravelSuggestion(rec: { customerId?: string | null; locationId?: string | null }): Promise<{ min: number; miles: number } | null>` — `customerId`/`locationId` required; load the customer (customers store `get`), find `locations` entry with `id === locationId`; `getSiteByDocLocId(locationId)` → site; `venueAddressState(site).status === "verified"` else null; `estimate(await officesFromSettings(), { ...loc, ...(coordsOf(loc) || {}) })` (the pattern in `src/app/(app)/companies/[id]/page.tsx` ~217); accept only `source === "manual" || source === "routed"` with finite minutes and miles; else null. Wrap in try/catch → null (a failed lookup never breaks the page). `page.tsx` passes `travelSuggestion` to the editor. The editor applies it in `toDraft` (initial state): `travelTime` empty → `travelTimeText(min)`, `distance` empty → `distanceText(miles)`; not marked dirty (any save stores it). Show a hint under each field "From the venue's verified address" while the value equals the suggestion.
- **Access (note 4, 5):** Site access fields become: loadingDock, elevatorSize, floorType, accessDoorSize (unchanged); **Loading door type** (select `LOADING_DOOR_TYPES`, key `loadingDoorType`), **Loading door location** (text `loadingDoorLocation`), **Loading door W × H** (text `loadingDoorWH`); **Lift needed?** (Yes/No toggle-style select on `liftRequired`); when yes: **Lift type** (select `LIFT_TYPES`, `liftType`), **Working height** (text `liftWorkingHeight`), **Who supplies lift** (`liftSupplier`); **Path: truck → floor** as `textarea` (`pathToFloor`); then workingHours … firstImpressions unchanged. Remove the old `liftNeeded` select, `loadingDoorSize`, `liftHeight` from the field list (keys stay stored; B2 migrated them). Add the new keys to `toDraft`/`Draft`/`buildPatch`/`SurveyPatch`.
- **Beams (note 10):** the mBeams section's fields: always show `structuralDrawingOnFile`; show `brickDrawingOnFile` and `cwElevationOnFile` only when `hasCounterweight(draft)`; when `structuralDrawingOnFile` is true, hide every other beam field (values kept) and show a one-line note "The structural drawing covers the beam measurements."
- **Final questions (note 16.11):** new wrap-up section `finalQuestions` "Final questions" subtitle "Last things to settle before you leave" with `replaceVsReuse` (select `REPLACE_VS_REUSE_OPTIONS`, label "Replace vs. reuse (curtains)") writing `disciplines.curtain.replaceVsReuse`. Visible per `sectionVisible` (curtain in scope).
- Checks: pins for the access field list (new keys present, old `liftNeeded`/`loadingDoorSize`/`liftHeight` gone from the section, `pathToFloor` is a textarea), the beams gating (`hasCounterweight(draft)` and `structuralDrawingOnFile` used in the mBeams builder), `finalQuestions` section push; a pure check of the travel acceptance rule — export `acceptTravel(est: { source: string; minutes: number | null; miles: number | null }): { min: number; miles: number } | null` from `src/lib/field-lists.ts` (pure) and use it in the server helper; test manual/routed accepted, auto/none rejected, null numbers rejected. `npm run test:specs`, `npm run build`. Commit `feat(venue-assessments): #344 B5 travel auto-fill, loading door + lift fields, beams drawing gate, Final questions`.

---

### Task B6: Line set schedule — quantity first

**Files:** modify `sections/linesets.tsx`, `src/lib/stores/linesets.ts`, `controls.tsx`; checks.

- Pure helper in `linesets.ts`: `linesetQuantityPlan(rows: LinesetRow[], n: number): { rows: LinesetRow[]; dropped: LinesetRow[] }` — rows sorted by numeric `pos`; ensure `pos` 1…n exist (add `blankLinesetRow(i)` for missing); rows with pos > n: empty ones (every field blank and no condition) are dropped silently, non-empty ones returned in `dropped` (the caller confirms before removing them; on cancel nothing changes). `rowIsEmpty(row)` exported.
- `fillDown(rows, fromId, key)` and `markSpare(rows, fromPos, toPos)` (sets `type: "O"` on rows in range whose `type` is empty; returns `{ rows, skipped: string[] }` listing set numbers that already had a type).
- UI: first control **How many line sets?** (number 0–200) writing `linesetQty` and applying the plan (confirm dialog listing dropped set numbers when `dropped.length`; use the page's own confirm idiom — an inline armed "Remove sets 12–14? Confirm / Cancel" bar, never `window.confirm`). Table columns as today with Condition = `ConditionSlider compact` (writes `condition`; keep `cond` untouched). Toolbar: **Fill down** (select a column, applies from the focused row), **Mark range spare** (from/to inputs). Remove the "Capture a lineset inventory" enable toggle from the UI (key stays stored). Remove the per-row "+ Add"/delete affordances in favour of the quantity (keep a row delete only for rows beyond the quantity, which can't exist after the plan runs).
- Checks: `linesetQuantityPlan` (grow, shrink-empty silently, shrink-with-data returns dropped, renumber stability), `fillDown`, `markSpare` (skips typed rows), `rowIsEmpty`. Commit `feat(venue-assessments): #344 B6 quantity-first line set schedule with condition slider, fill down, mark spare`.

---

### Task B7: Goals downstream, field sheet, findings

**Files:** modify `src/lib/estimate-output/goals.ts`, `src/lib/survey-flow.ts`, `src/lib/venue-assessment-sheet.ts`, `src/lib/survey-findings.ts`; checks; update #301 goal checks only where an array input is new behaviour.

- `goals.ts`: `sanitizeSurveyDisciplineGoals` — a `goals` array → each item `cleanPlainText(item, 300)`, empties dropped, at most 20; a string keeps today's behaviour. `goalsFromSurvey` — array → lines joined with `"\n"` (then the existing 1,000-char clean); string unchanged. New `goalListsFromSurvey(s): Partial<Record<ScopeDiscipline, string[]>>` — arrays cleaned as above; a string split with `splitGoalLines` (import from survey-flow — check for an import cycle; if survey-flow imports goals.ts, move `splitGoalLines` into goals.ts or a tiny shared module and re-export it from survey-flow).
- `survey-flow.ts` `recapFor`: goals from `goalListsFromSurvey(s)[g.key] ?? []`.
- Field sheet: Site access rows → Loading door type / location / W × H, Lift needed, Lift type, Working height, Who supplies lift, Path to floor, then the rest; discipline sections print goals as "; "-joined list, scope (+ "Other: …"), and per type:
  - curtain rows: one row per item `"<label>"` → `"qty 4 · Velour 25 oz · Standard track · 40' × 22' · Good"` (skip empty parts; condition via `conditionLabel`);
  - lighting: "Lighting positions" → each position row "Electric 1 · 24 circuits · 40' · trim 22' · notes"; console location (+ Other text); plug type;
  - AV: Condition via `conditionLabel`;
  - every `condition`-type field via `conditionLabel`; `month` fields printed as e.g. "Mar 2024".
  - Line sets: condition prints `conditionLabel(row.condition)` when set, else the old `linesetCondLabel(row.cond)`.
- Findings text: access line uses `loadingDoorType`/`loadingDoorLocation`/`loadingDoorWH` and `liftRequired`/`liftType`/`liftWorkingHeight`/`liftSupplier` (keep the old keys as fallback when the new ones are empty).
- Checks: sanitize array (cap 20 × 300, empties dropped), `goalsFromSurvey` joins arrays, `goalListsFromSurvey` splits strings, recap reads arrays; a built sheet for a fixture with curtain items / lighting positions / AV level / lineset condition contains the expected row strings; findings access line. `npm run test:specs`, `npm run build`. Commit `feat(venue-assessments): #344 B7 goals as lists downstream; field sheet + findings print the new fields`.

---

### Task B8: Gates, browser pass, docs, merge

- Four gates + build (as slice A: tsc, `npm run test:specs`, `npm run test:smoke` with ≥ 45 GB free — clean `$TMPDIR` (`-mmin +60` guard) and finished worktrees' `.next` first; eslint vs baseline; `npm run build`).
- Browser pass on a scratch datadir (main checkout's `.claude/launch.json` temporary entry; restore after): access fields + lift gating; beams toggles with/without Counterweight; curtain rows + slider colours; lighting positions + console Other + fixture totals; AV slider; goals list add/reorder; scope Other explain; line set quantity grow/shrink-with-confirm, fill down, mark spare; Final questions; travel fill on a verified venue (if the scratch DB has one — else note it); print sheet renders.
- Docs: recompute D/punch/phase from origin/main; DECISIONS entries for this slice (incl. the seating non-link, numeric condition levels, goals text kept for the Estimator, Final questions section, engine additive changes); PUNCHLIST #344 slice B ✅; AGENTS phase 61 updated.
- Merge origin/main if it moved, then fast-forward push to main; confirm the Vercel production deploy is Ready.
