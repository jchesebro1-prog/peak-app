# Venue Assessment notes (Jeff, 2026-10-14) — design

Source: `docs/notes-2026-10-14.md` (23 notes). Punch item **#342** (tentative — recompute from
origin/main before writing docs; last used #341, D1016, phase 60, migration 0040).

Scope: the Venue Assessments (field survey, `FS-####`) editor —
`src/app/(app)/venue-assessments/[id]/controls.tsx` + `sections/*`, `src/lib/stores/surveys.ts`,
`src/lib/stores/survey-intake.ts`, `src/lib/stores/venue-classes.ts`, `src/lib/venue-assessment-sheet.ts` —
plus shared pieces pulled out of the #340 Assessments engine so both editors converge before slice 2
moves Venue Assessments onto the engine.

Delivery: one spec, three slices built in order on one branch (`feat/342-va-notes`), each merged + pushed
after its own review on Jeff's go-ahead. Slice C waits for a real iPad + Apple Pencil test before merge.

## Decisions taken with Jeff (2026-10-14)

| # | Question | Answer |
|---|---|---|
| Q1 | Note 3's card | **Assignment & schedule** (Sign-off is removed by note 23) |
| Q2 | Which Purpose of visit counts as a quote (note 2) | **New system design** only |
| Q3 | Lift types (note 4) | Ladder >12ft, Scaffolding, Single Man Lift, Scissor >20ft, Scissor >40ft, Scissor >50ft |
| Q4 | Loading door types (note 4) | Roll-up / overhead, Double doors, Single door, Dock door, Other; W × H its own field |
| Q5 | Lift / door lists editable? | **Fixed in code** |
| Q6 | Internal tags (note 6) | Judgment tags, **editable in Settings** (starter list below) |
| Q7 | Fabric weight oz (note 16) | **Per-row column** on the curtain rows |
| Q8 | Fixture inventory position column (note 19) | **Yes** — Front / Down / Side / Back / Cyc / Movers, derived totals |
| Q9 | Per lighting-position row (note 19) | Circuit count, Length, Trim / height, Notes |
| Q10 | Line set numbering (note 22) | **1…N**, distance-from-plaster-line stays a column |
| Q11 | CW Elevation + blank line set sheet (notes 10, 22) | Not yet — **generated placeholders**, one-file swap later |
| Q12 | Rigging system single source (notes 10, 14) | **Kill questions, under Rigging scope** |
| Q13 | Delivery | One spec, merge each slice when done |
| Q14 | Photo/sketch storage | Generalise the engine's private-Blob photo pipeline with a record kind |
| Q15 | Rail | Shared `SectionRail` extracted from the engine's scope rail |

## Cross-cutting rules

### R1. Read-time migration, never drop data
- `normalize()` in `surveys.ts` delegates to a new pure module `src/lib/survey-migrate.ts`: an ordered list of
  small steps `(s: SurveyRecord) => SurveyRecord`, each idempotent and tested alone. Steps never delete a
  key; a migrated record still carries the old key (ignored by the UI) so a rollback still reads it.
- Saves write the new shape. Old keys are not re-written by the UI, so they stay as they were.
- A value that can't map cleanly is appended to `legacyNotes: LegacyNote[]` on the survey,
  `LegacyNote = { section: string; label: string; text: string }`, de-duplicated by `section + label + text`
  (idempotent). It is derived at read time by the migration and never stored or edited; the UI shows a collapsed
  **Older notes** block at the foot of that section, and the field sheet prints it under the section.
- Removed fields: listed below per note; each becomes an Older note when non-empty.

### R2. Scope filter (note 13)
- New `survey.scope?: DisciplineKey[]` (`rigging | curtain | lighting | av`), asked in Kill questions.
- `scope` **unset** (old surveys, and new ones until answered) → nothing is filtered (today's behaviour).
  Normalize seeds it from `disciplinesActive` only when that list is non-empty **and** at least one discipline
  has a non-"None" Present answer; otherwise it stays unset.
- `scope` set → a discipline branch shows only when its key is in scope; Beams & rigging and the Line set
  schedule need `rigging`; FOH positions needs `lighting`. Hidden sections keep their stored answers and
  drop out of progress counts and the rail.
- One pure helper `sectionVisible(survey, sectionId)` is used by the editor, the rail, progress, the field
  sheet and the customer recap.

### R3. One rigging-system answer (notes 10, 14)
- Stored at `disciplines.rigging.present: string[]` (existing key). Options become:
  **Counterweight, Dead-hung, Motorized, Hemp, Fixed points, None** (multi; "None" exclusive).
  Old option labels map on read: "Counterweight system" → Counterweight, "Dead-hung battens" → Dead-hung,
  "Motorized rigging" → Motorized.
- Asked once, in Kill questions, shown when Rigging is in scope (or scope unset).
- Copy-up on read when `present` is empty: from `measurements.rigType` (Dead-hung / Counterweight /
  Motorized / Hemp / None existing → None), then from `disciplines.rigging.counterweight === true`
  (→ Counterweight), then from the condition chips "Existing rigging — counterweight / hemp" and
  "Motorized hoists present". If `present` is already set and `rigType` disagrees, `rigType` goes to Older
  notes (Beams & rigging).
- Removed from the UI: Beams "Existing rig type" (`rigType`), the Rigging intake "Counterweight system" check
  and the separate Rigging "Present" chips (the Rigging intake shows the answer read-only:
  "Counterweight · Motorized — from Kill questions" with a jump link).
- Helpers: `rigSystems(survey)`, `hasCounterweight(survey)` (Counterweight in the list),
  `hasLinesets(survey)` (any of Counterweight, Dead-hung, Motorized, Hemp).

### R4. Converging with the engine
- Shared now: `SectionRail` (slice A), the condition slider component (slice B, survey-only use),
  the pick lists in a shared module `src/lib/field-lists.ts` (lift types, door types, plug types, lighting
  positions, track series), the photo/sketch pipeline + `PhotoRef` (slice C), the ink pad (slice C).
- Engine changes now are strictly additive (slice B), so `ASSESSMENT_DEF.version` does **not** bump (its
  rule: renamed key, removed option or changed type bumps; added questions/options don't): S7 gains
  `access.lift_type` (one, lift list) + `access.lift_height` (ftin) in the existing `access.lift` module and
  `access.load_in_door_type` (one, door list) in `access.load_in`; S5 gains `lighting.positions` (many,
  positions list); the engine's existing `connector` pick list gains a `mixed` option. New pick lists come
  from `src/lib/field-lists.ts`.
- Logged for the slice-2 port (not built here): `access.load_in_route` as long text (a type change
  would bump the def version), S3 inventory columns (track series, W, H, oz, condition
  slider), goals list, scope "Other + explain", internal tags step, sketch answer type, photo markup UI in
  the engine editor, the condition slider vs the engine's good/fair/poor rules.

## Slice A — form structure & flow

Notes 2, 3, 6, 7, 13, 14 (placement), 23, the customer recap (16.13 / 17), the 3D card placement (12),
the Line set schedule placement (22), and removal of the Venue-class guidance panel (17).

### A1. Section order and wizard steps
`ORDER` / `STEP_BY_ID` / group headers in `controls.tsx` become:

| Step | Group | Sections |
|---|---|---|
| 0 Brief | Office brief | Customer & venue · Visit (purpose & travel) · **Kill questions** |
| 1 Site & access | Field capture | Site access & logistics · Life safety |
| 2 Measurements | Field capture | Measurements (class quick set) · Stage layout · Stage section · Beams & rigging · FOH positions · House & room · **3D preview** (last of the site information) |
| 3 Site intake | Site intake | Rigging · Curtain · Lighting · AV · **Line set schedule** |
| 4 Assessment | Condition & needs | Assessment toggle · Usage · Condition · Findings (unchanged, optional) |
| 5 Wrap-up | Wrap-up | Scope & notes · **Existing materials & quote** · **Final questions** (slice B: Replace vs reuse) · **Customer recap** · **Final thoughts** · **Assignment & schedule** |

- Photos section stays at the start of Wrap-up until slice C replaces it with per-section photos.
- Sign-off is gone (A6).

### A2. Kill questions (notes 13, 14)
- Items: Venue name, Contact name, Contact email, Stage width, Stage depth, **Scope** (at least one), and
  **Rigging system** (when Rigging is in scope). Contact phone is no longer a kill question (stays an
  ordinary contact field).
- The card is no longer just a checklist: it carries inputs for **Scope** (chips over the four disciplines),
  **Rigging system** (R3 chips) and **Stage width / depth** (bound to the class's first `TIER1_WIDTH_KEYS` /
  `TIER1_DEPTH_KEYS` key, the same `measurements` key the Measurements card edits — one stored value).
  Venue/contact items still jump to Customer & venue.
- `tier1Items` / `tier1Complete` change accordingly; `Tier1Item.section` gains `"tier1"` for inline items.
  `canConvertLead` reads only `stage === "completed"` → unaffected. Update `scripts/test-review-and-spec.ts`
  tier-1 fixtures.
- Discipline sections stay locked until Kill questions are complete (today's rule).

### A3. Existing materials & quote (note 2)
- Top half (BOM / drawings / photos on file) always shows.
- Bottom half (quote needed by, budgetary, completion, install timeframe, budget, fiscal year, who decides,
  target install window) shows only when `visitPurpose === "New system design"`. `isQuoteVisit(survey)` is a
  pure helper. Hidden answers stay stored and still print if present.
- The Assessment Usage section's mirror of the quote fields (`onQuoteField`) is unchanged.

### A4. Assignment & schedule (note 3)
- On create, `assignedTo` = the creating user's display name (the roster value the select uses) and
  `scheduledDate` = today (Chicago `YYYY-MM-DD`). Applies to `createSurvey` (New request) and
  `requestVisitForLead` (uses the visit's assignee when set, else the creator). CSV import unchanged.
- Stage stays `requested`; nothing calls `assign()` at create. Both fields stay editable.

### A5. Final thoughts — internal tags (note 6)
- Settings blob `survey_internal_tags`: `{ id: string; label: string; retired?: boolean }[]`, ids
  `tg_<slug>` stable across renames. Admin editor in **Settings → Field** (add, rename, retire, reorder).
  Starter list: Tight timeline, Price-sensitive, Strong champion, Competitor involved, Budget not confirmed,
  Decision-maker not met, Active venue (work around events), Volunteer install crew available,
  Historic / preservation constraints. Seeded lazily (blob absent → starter list).
- Survey stores `internalTags: string[]` (ids). Retired tags still show (struck) on surveys that carry them;
  unknown ids show as the raw id.
- Old `conditions: string[]` stays stored and shows read-only under "Older site conditions" in Final thoughts.
  No auto-mapping (the old chips were facts, the new tags are judgments).
- Never printed on the field sheet or any customer document; not in the customer recap.
- Venue Assessments list (`venue-assessments/page.tsx`) gains a Tag filter (multi, any-of).

### A6. Remove Sign-off (note 23)
- Section removed from the list, rail and wizard. `signoff` stays stored; `blank()` still defaults it.
- Field sheet prints the Close-out page only when the survey carries any non-empty `signoff` value.
- Build check: confirm nothing gates `completed` (or anything else) on sign-off; drop any such requirement.

### A7. Customer recap (notes 16.13, 17)
- Read-only Wrap-up section, larger type, for reading back to the customer: for each discipline in scope
  (or with answers when scope is unset): its **scopes of interest** (with the "Other" text from slice B) and
  its **client goals** (list from slice B; slice A renders today's string split on lines).
- Also printed on the field sheet (a "What we heard" block after the brief) and appended to the plain-text
  findings in `src/lib/survey-findings.ts` (Estimator "Draft scope", Assist `surveyText`).

### A8. Collapsible sections + SectionRail (note 7)
- Every section collapses from its header in long-scroll and wizard modes. Collapsed state persists per
  viewer per survey in `localStorage` (`va:collapsed:<surveyId>`, try/catch, ignored on failure). Default:
  all expanded except `advanced` sections (today's default).
- The **Accordion** layout mode is retired; a stored `"accordion"` preference opens as long-scroll.
- `SectionRail` (`src/components/section-rail/`): extracted from `assessments/[id]/scope-rail.tsx` —
  `Ring`, `Badge` and the row list — taking `items: { key; label; done; total; badges?: {tone, count}[] }[]`,
  `active`, `onPick`, and an optional `footer` slot. The engine's scope rail renders `SectionRail` + its
  existing Scopes… panel in the slot, with identical output. CSS moves with the component.
- Venue Assessments long-scroll: sticky rail on desktop (left column), a sticky `<select>` sheet under
  760 px (same as the engine). Picking scrolls to `#sec-<id>` and expands it. Rail items follow
  `sectionVisible`. The old horizontal pill rail is replaced.
- `sectionProgress(survey, sectionId, ctx) → {done, total, gate?}` is pure (`src/lib/survey-progress.ts`):
  counts visible, answerable fields (text non-empty, select chosen, chips ≥ 1, list ≥ 1 entry); yes/no
  checks are excluded from the total (unticked is a valid answer); read-only/recap sections have
  `total = 0` (no ring). `gate: true`
  (amber "!") when Kill questions are incomplete.

### A9. Venue-class guidance (note 17)
- The panel in `sections/systems.tsx` is removed from the intake. `venue-doctrine.ts`, its settings and
  page.tsx resolution stay (it "may come back later"); page.tsx stops passing it to the editor.

## Slice B — field-level changes

Notes 1, 4, 5, 8, 10 (non-drawing), 15, 16, 17 (goals list), 18, 19, 21, 22 (quantity-first table).

### B1. Travel auto-fill (note 1)
- `page.tsx` resolves the survey's venue (`locationId` → `getSiteByDocLocId`); when its address state is
  **verified** it calls `estimate(officesFromSettings(), target)` and keeps the result only when `source` is a
  manual override or a cached road route (never haversine). Passes `travelSuggestion: {min, miles}`.
- The editor fills `travelTime` ("35 min") / `distance` ("22 mi") **only when empty**, on load, as an unsaved
  draft change (saved with the next save). Typed values are never overwritten. A small "from venue" hint
  shows while the value equals the suggestion.

### B2. Access (notes 4, 5)
- New keys: `loadingDoorType` (select, door list + legacy value kept if not in list), `loadingDoorLocation`
  (text), `loadingDoorWH` (text). Migrate: old `loadingDoorSize` text → `loadingDoorLocation` when that is
  empty, else Older note.
- Lift: `liftRequired: "yes" | "no" | ""`, `liftType` (select, lift list), `liftWorkingHeight` (text),
  `liftSupplier` (unchanged). Type, height and supplier show only when required = yes. Migrate:
  `liftNeeded === "None needed"` → no; any other non-empty `liftNeeded` → yes, with `"Scaffold"` →
  `liftType` Scaffolding and **every other old type kept as an Older note** (the lists don't match; no
  guessing Ladder only → Ladder >12ft); old `liftHeight` text → Older note.
- `pathToFloor` → textarea (same key). Field sheet wraps it (check `pdf.ts` text wrapping on long values).
- Lists live in `src/lib/field-lists.ts`, fixed in code.

### B3. Measurement links (note 8)
- Already one value (shared keys; no change): proW, proH, stageDepth, wingSL/SR, apron, gridH, houseH,
  boothLoc, boothWD, centerAisleW.
- Link (render bound to one key; migrate the other on read; disagreement → Older note):
  - Rigging "Grid height" (`disciplines.rigging.gridHeight`) → `measurements.gridH`.
  - Rigging "Loading gallery notes" (`loadingGalleryNotes`) → `measurements.loadingGallery`.
  - Rigging "Batten count" / "Lineset count" (`battenCount`, `linesetCount`) → `linesetQty` (B9).
  - Auditorium quick "Seating" (`measurements.seating`) ↔ `auditoriumSize`: one key, `auditoriumSize`.
- Left as distinct facts: pitDesc vs pitDepth, floorCondition vs floorType, structure vs beamType,
  trimHigh/Low vs per-row trims, battenLength vs per-row battenLength, curtain prosHeightToGrid.
- `SystemField` gains `bind?: string` (a measurement key) so a discipline field can read/write `measurements`.

### B4. Beams & rigging (note 10)
- Top of the section: **Structural drawing on file** (`structuralDrawingOnFile`) and, when
  `hasCounterweight`, **Brick drawing on file** (`brickDrawingOnFile`) and **CW Elevation sheet on file**
  (`cwElevationOnFile`).
- `structuralDrawingOnFile` → the beam measurement fields hide (values kept).
- Migrate: `brickDrawing: true` → `structuralDrawingOnFile: true` + Older note "Was 'Brick / structural
  drawing on file' (combined) — check which"; `hhSheet: true` → `cwElevationOnFile: true`.
- `rigType` removed from the fields (R3).

### B5. Every discipline (notes 17, 19, 21)
- Section layout top-down: **Scope of interest** (chips + **Other** → "Explain the scope" textarea,
  `scopeOther`), Client goals list, Present chips (Rigging: read-only from Kill questions), fields,
  inventories, notes, Older notes.
- **Client goals list**: `disciplines[key].goals: string[]` (+ Add goal, ×, ↑↓). Normalize: a string splits on
  newlines and leading bullets (`-`, `•`, `*`, `1.`), trimmed, empties dropped. Sanitizer
  (`withSanitizedSurveyGoals`): ≤ 20 lines, ≤ 300 chars each. `goalsFromSurvey` returns
  `Record<DisciplineKey, string[]>`; consumers that need text join with `\n`. Estimator `clientGoals` stays
  text (one goal per line) — `fillClientGoals`, cover and package unchanged. Update the source pins in
  `scripts/test-review-and-spec.ts` (goals textarea position).
- `scopeOptions` value relabels map on read (stored values are labels):
  - Rigging: Grid refurbish → **System refurbish** (note 15).
  - Curtain: Full masking upgrade → **Full curtain replacement**; New main → **Single curtain replacement**;
    New legs / borders → **Single set replacement**; Traveler replacement → **Other** (+ `scopeOther`
    "Traveler replacement" when empty).
  - Lighting: Dimmer upgrade → **Controls upgrade**.
  - Every list ends with **Other**.

### B6. Curtain (note 16)
- Removed (→ Older notes when non-empty): `maskingNeeds`, `pipeDiameter`, `mounting`.
- **Per-type rows** after Present: `disciplines.curtain.items: Record<presentOption, CurtainItem>`,
  `CurtainItem = { qty?: string; fabric?: string; oz?: string; trackSeries?: TrackSeries; w?: string;
  h?: string; condition?: 0|1|2|3|4 }`. One row per ticked Present option except None and the pipes chip.
  Fabric is free text with a `<datalist>` from the fabric index. Track series: N/A, None, Lightweight,
  Standard, Curved.
- Fold on read where obvious, else Older note: `mainCondition` → the main row (auditorium "Main / act
  curtain") as a note; `legsQtyPairs` → Legs qty; `bordersQty` → Borders qty; `cycScrimFabric` → Cyc / scrim
  fabric; `fabricColor`, `fabricWeightOz`, `finishedWH`, `condition`, `legsBorders`, `trackSeries` (old text)
  → Older notes (they were branch-wide, rows are per type).
- Branch fields: **Track operation** (select SL / SR; old free-text `trackOperation`/`operation` → Older note
  unless exactly SL/SR), **Additional general purpose / scenery pipes** (`fixedPipeQty` relabel; the Present
  chip "Fixed pipe" relabels too, stored value mapped), **Pipe / track lengths** (`pipeTrackLengths`, text),
  **Height above floor** (absorbs "Average trim height" — no such field exists in code today, so this is the
  existing `heightAboveFloor`), `prosHeightToGrid`, `travelerCondition`, `loadCapacity`, `curtainType`.
- **Last flame test**: `<input type="month">`, stored `YYYY-MM`. Read migration parses `M/YYYY`, `MM/YYYY`,
  `YYYY-MM(-DD)`, `Month YYYY`; otherwise the text becomes an Older note and the field stays empty.
- **Replace vs reuse** renders in Wrap-up → Final questions (same key `disciplines.curtain.replaceVsReuse`).

### B7. Condition slider
- `src/components/condition-slider.tsx`: 5 steps Bad / Poor / Fair / Good / New, value 0–4 or unset
  ("Not rated" until touched; a clear button). Native `<input type="range">` for keyboard/touch, with the
  track and thumb colour from tokens `--cond-0 … --cond-4` (red → amber → green, light + dark variants in
  `globals.css`). Labels from `CONDITION_STEPS` in `field-lists.ts` for reports.
- Used by: curtain rows, line set rows (B9), AV `condition` (B8).

### B8. Lighting and AV (notes 18, 19, 21)
- Lighting removed (→ Older notes): `fixtureQty`, `fixtureTypes`, `console`, `fohPositions` (auditorium).
- **Console location** (`consoleLocation`): select Booth / Stage / Other + `consoleLocationOther` when Other.
  Migrate text containing "booth" → Booth, "stage" → Stage, other non-empty → Other with the text in
  `consoleLocationOther`; the original text is also an Older note when it carried more than the keyword.
- **Lighting positions** (`positions`): multi-select Electric 1–5, FOH 1–3, Torms, Balcony, Other →
  `disciplines.lighting.positionRows: Record<position, {circuits?, length?, trim?, notes?}>`, one row per
  ticked position. Old free-text `positions` → Older note.
- Relabels: `controls` → "Architectural control — manufacturer / model"; `electricalService` → "Panel power
  feeds & locations".
- `circuitAccess` → **Plug type** (`plugType`, select Stage-pin / Edison / Twist-lock / Other / Mixed); old
  Good/Fair/Poor → Older note.
- Fixtures inventory: rows gain `position?: "Front"|"Down"|"Side"|"Back"|"Cyc"|"Movers"`; the inventory
  block shows derived totals per position (sum of qty).
- AV: global rules only — scope first + Other, goals list, scope filter, collapsible + rail, recap; its
  `condition` text becomes the slider (Good / Fair / Poor text maps to 3 / 2 / 1, "new" → 4, "bad" → 0,
  anything else → Older note).

### B9. Line set schedule (note 22)
- First question **How many line sets?** (`linesetQty`, integer 0–200). Setting N ensures rows `pos` 1…N
  (adds blank rows; existing rows keep their data). Lowering N removes trailing **empty** rows silently and
  asks (confirm dialog listing the set numbers) before removing rows with data.
- Normalize: `linesetQty` defaults to `linesets.length` when unset; rigging `linesetCount`/`battenCount`
  copy in when `linesets` is empty and `linesetQty` unset (B3).
- Table: existing `LinesetRow` columns; `cond` edits through the condition slider, stored on a new
  `condition?: 0–4` with `cond` G/F/P/X mapped on read (G→3, F→2, P→1, X→0). Desktop: tab order across cells.
  iPad/phone: tap a row to edit in a sheet. Bulk: **Fill down** (selected column, from the focused row) and
  **Mark range spare** (from–to sets type `O` "Open / spare" on rows whose type is empty; rows with a type
  are left alone and listed).
- Shown when `sectionVisible` and `hasLinesets(survey)`; replaces the `linesetsEnabled` toggle (kept stored;
  an old survey with rows and `linesetsEnabled: true` but no rigging system still shows the section).

## Slice C — drawing & photo capture

Notes 9, 10 (pads), 11, 12, 20, 22 (Pencil sheet).

### C1. Ink model (`src/lib/ink/`, pure)
- `InkDoc = { v: 1; w: number; h: number; strokes: Stroke[]; labels: InkLabel[] }` in background units.
  `Stroke = { id; tool: "pen" | "marker"; color: string; width: number; pts: number[] }` — flat
  `[x, y, p, …]`, x/y rounded to 0.5 units, p to 2 decimals; Ramer–Douglas–Peucker simplification on
  pointerup (tolerance 0.4 units). `InkLabel = { id; x; y; text; color; size }`.
- Ops: add stroke, erase (stroke-level hit test within radius), add/move/delete label, clear; undo/redo as
  an op stack (cap 200). `serialize`/`parse` with caps (≤ 5,000 strokes, ≤ 400,000 numbers, ≤ 200 labels).
- `renderInk(ctx, doc, scale)` draws variable-width strokes (pressure → width 0.5×–1.5×).

### C2. Ink pad (`src/components/ink/ink-pad.tsx`)
- Full-screen dialog: background layer (SVG string or image URL/Blob) + canvas ink layer + toolbar (pen,
  colours black / red / blue, eraser, text label, undo, redo, clear (confirm), Done, Cancel).
- Pointer handling: `touch-action: none` on the canvas; a `pen` pointer sets `penSeen` for the session.
  While `penSeen`: pen draws; touch pans/zooms (two-finger pinch, one-finger pan); touch never draws (palm
  rejection). Without a pen: mouse/touch draws, two-finger pinch zooms. Coalesced events
  (`getCoalescedEvents`) for smooth Pencil lines. Device-pixel-ratio capped at 2.
- Done → returns `{ doc: InkDoc, jpeg: Blob }` (background + ink flattened, white base, long edge 1600,
  JPEG 0.85).

### C3. Pad backgrounds (`src/lib/ink/backgrounds/`, pure SVG generators)
- `stagePlan(m)`, `beamsPlan(m)` (stage-only plan: pro opening, depth, wings, plaster line, centre line),
  `stageSection(m)` (deck, pro, grid line, house ceiling), `housePlan(m)`, `houseSection(m)` (floor, ceiling,
  FOH/catwalk line), `cwElevation()` (placeholder: titled elevation grid), `brickGrid()` (blank grid),
  `linesetSheet(n)` (ruled sheet with the `LinesetRow` columns, `max(n, 30)` rows, paginated by 30 per pad
  page — one pad per page if n > 30).
- Measurements give rough scale when present (proW, stageDepth, wingSL/SR, apron, gridH, proH, houseH,
  house width/depth keys); otherwise generic proportions. Labelled with dimensions when known.
- Real sheets (CW Elevation, line set schedule) drop in later by replacing the generator with an image asset
  — one file each.

### C4. Shared photo/sketch pipeline (`src/lib/field-photos/`)
- Moves the engine's `photos.ts`, `photo-queue.ts`, `photo-resize.ts`, `photo-bytes.ts` behind a record
  kind: `FieldRecordKind = "assessment" | "survey"`, with a registry `{ idRe, pathPrefix, cap, finalize,
  remove, get }` per kind. Engine call sites keep their behaviour (same Blob paths `assessments/<AS>/…`, same
  IndexedDB rows migrated in place: v3 adds `kind`, existing rows default to `assessment`).
- `PhotoRef` gains optional `section?: string`, `markupPath?: string`, `strokesPath?: string`,
  `kind?: "photo" | "sketch"`, `sketchKey?: string`. Blob objects: `<prefix>/<id>/<photoId>.jpg` (original),
  `<photoId>.m.jpg` (markup / flattened sketch), `<photoId>.ink.json` (strokes).
- Broker: one handler factory used by `/api/assessments/[id]/photos/upload` (unchanged contract) and a new
  `/api/surveys/[id]/photos/upload`; allows `image/jpeg` for `.jpg` paths and `application/json` (≤ 2 MB)
  for `.ink.json`. Path must equal the server-built path for that kind/id/photoId/variant.
- Bytes route `/api/surveys/[id]/photos/[photoId]?v=orig|markup|ink` (session-gated, survey read access).
- Survey store: `photoRefs: PhotoRef[]` (cap 200) and `sketches: Record<SketchKey, PhotoRef>`; finalize /
  remove actions with the same row-locked patch pattern as the engine (`applyFinalizedPhoto`). The queue's
  `onDone` folds the ref into the open editor.
- Old `photos: SurveyPhoto[]` (inline data URLs) stay readable: shown read-only as **Earlier photos** in
  Wrap-up and printed; new captures never go inline. No backfill.

### C5. Sketch pads in the editor (notes 9, 10, 11, 22)

| SketchKey | Section | Background | Gate |
|---|---|---|---|
| `beams` | Beams & rigging | beamsPlan | — |
| `cwElevation` | Beams & rigging | cwElevation | hasCounterweight |
| `brick` | Beams & rigging | brickGrid | hasCounterweight |
| `stagePlan` | Stage layout | stagePlan | — |
| `stageSection` | Stage section | stageSection | — |
| `houseSection` | FOH positions | houseSection | — |
| `housePlan` | House & room | housePlan | — |
| `linesetSheet` (+`linesetSheet2`…) | Line set schedule ("Fill in by hand") | linesetSheet | hasLinesets |

- Each shows a thumbnail tile (or "Draw" tile when empty) in its section; tap → ink pad. Re-editing loads
  strokes from the device queue (pending) or the `ink` bytes route. Saving replaces the sketch ref
  (new photoId; the old blobs are removed after the new finalize succeeds).
- `cwElevationOnFile` / `brickDrawingOnFile` stay as "paper copy on file" checks beside the pads.
- No handwriting recognition (D89): the handwritten line set sheet is the record unless the table is typed.

### C6. Per-section photos with caption + markup (note 20)
- Every section header gets **Add photo** (camera `capture="environment"` or library, multiple). Each photo
  carries `section` = the section id; thumbnails show in the section; the rail badge counts them.
- After capture: a sheet with **Caption** ("What are we looking at?") and **Markup** (ink pad over the photo,
  photo as background). Markup stores `markupPath` + `strokesPath`; the original `blobPath` is untouched.
- Viewer: marked-up version by default; **View original**, **Edit markup**, **Remove markup** (deletes the
  markup + ink blobs, keeps the original), edit caption, delete photo.
- Queue states (pending / failed with Retry / Discard) reuse the engine's `PhotoThumbs` / `FailedPhotos`.

### C7. Field sheet
- `buildAssessmentSheet` gains, per section: photos (markup version if any, else original) with captions,
  2 per row, and sketch JPEGs full width; Earlier photos (inline) under Wrap-up. Images fetched server-side
  from Blob, JPEG pass-through (`pdf.addJpeg`). Budget: skip and list by caption once the embedded total
  passes 20 MB.

### C8. 3D presets (note 12)
- `venue-3d.tsx`: materials `wireframe: true` by default (Solid toggle). View buttons:
  **Plan** (OrthographicCamera, top-down, fit to bounds), **Section** (OrthographicCamera from stage right,
  a clipping plane at the centre line, `renderer.localClippingEnabled`), **Elevation** (PerspectiveCamera at
  centre house, eye height 5 ft, looking at the plaster line), **Orbit** (today's free orbit). Orbit
  controls disabled on the ortho presets except zoom/pan.

## Testing & verification
- Pure tests in the spec harness (`scripts/test-*.ts`, joined into `test:specs`): every migration step
  (idempotent, never drops), `sectionVisible`, `sectionProgress`, tier-1 items, `isQuoteVisit`, rig-system
  copy-up, goals split/sanitize, curtain fold, flame-test parse, console-location map, lineset quantity
  add/remove plan, ink model ops/caps/simplify/serialize, background generators (snapshot of key
  coordinates), photo path/kind registry, broker path checks.
- The four gates on every slice (tsc, test:specs, test:smoke, eslint vs a baseline) plus `next build`
  (client components must not import stores).
- Browser pass per slice on a scratch PGlite datadir (never `.data/pglite` while another process holds it).
  **Never click photo/sketch upload or Email report in local dev** (`.env.local` holds the real Blob token).
- Slice C: Jeff tests on a real iPad + Apple Pencil (pressure, palm rejection, offline capture + later sync)
  before merge; the simulator can't do pressure.

## Out of scope / follow-ups
- AV-specific field review (note 21, later with Jeff).
- Engine slice-2 port items listed in R4.
- Arrows/circles in the ink toolbar; handwriting recognition.
- Venue-template-engine backgrounds (generators are simple SVG here).
- Real CW Elevation Sheet and line set schedule sheet (Jeff to send; one-file swap each).
