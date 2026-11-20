# Venue Assessments — functional specification (handoff)

Status: written 2026-11-19 from the code in this repository, for a rebuild as a standalone, offline,
single-file program. Venue Assessments are being moved out of the Quartzite app.

How to read this document

- It describes behaviour, not implementation. Where a rule is stated as "MUST", the current code
  enforces it and a rebuild should too.
- "Peak" means Peak Systems Group (theatrical rigging, drapery, lighting and AV contractor). "Staff"
  means signed-in team members. "Rep" means the staff member doing the visit. "Customer" is a
  company in the CRM; "venue" is one of its physical locations.
- "Venue Assessment" is the site-visit capture record with ids `FS-####`. It was called "Field
  Survey" and then "Site survey"; the code still says `survey` everywhere. The separate
  **Assessments engine** (`AS-####`, findings register) is a different feature and is summarised
  only in chapter 19.
- Every section ends with a **Source** line of repository-relative files.
- The machine-readable form definition is the sibling file `venue-assessment-form.json`: every
  section, field, storage path, label, option list and visibility rule. This document explains the
  rules; that file carries the complete field list. Where they disagree, the JSON was generated
  from the code more mechanically and should win on labels, paths and options.
- "Not verified" items are collected in chapter 20.

Contents

1. Purpose and users
2. Record model, id, stage lifecycle, assignment
3. List screen
4. Editor frame: header, layouts, rail, saving
5. Section order, groups and visibility
6. Brief: Customer & venue, Visit, Kill questions
7. Field capture: site access, life safety, measurements, 3D preview
8. Discipline intakes (rigging, curtain, lighting, AV)
9. Line set schedule
10. Condition & Needs layer (inside the Venue Assessment)
11. Wrap-up: notes, existing materials & quote, final questions, recap, final thoughts, assignment
12. Pick lists and internal tags
13. Photos, markup and sketch pads
14. Outputs: field sheet, findings text
15. Saving, offline outbox and conflict rules
16. Importing old records (read-time migrations)
17. Integration points
18. What a standalone rebuild can drop or must replace
19. The Assessments engine (`AS-####`) — summary
20. Not verified, and things the JSON cannot express

---

## 1. Purpose and users

A Venue Assessment is the record of one site visit to one venue. The office opens it as a request
(who, where, why), a rep is assigned and scheduled, the rep captures the venue on site (access,
measurements, what is installed per discipline, what the customer wants, photos and sketches), and
the finished record feeds a quote.

Users

| Who | What they do |
| --- | --- |
| Office staff | Create a request, fill the brief, assign and schedule |
| Rep on site (tablet / phone, often offline) | Capture everything else; read the recap back to the customer |
| Estimator | Reads the finished record; starts a quote from it |

Every signed-in staff member can open and edit every Venue Assessment; there is no per-record
permission. Customers never see this record or anything printed from it except what a rep chooses to
hand over; the internal tags (11.5) MUST never appear on any printed output.

The feature uses no AI. (An optional "Suggest estimate" button in the header belongs to a separate
pilot feature and is outside this spec, see 17.4.)

**Source:** `AGENTS.md` (phases 5, 6, 61), `src/lib/stores/surveys.ts`,
`src/app/(app)/venue-assessments/page.tsx`, `src/app/(app)/venue-assessments/[id]/page.tsx`.

---

## 2. Record model, id, stage lifecycle, assignment

### 2.1 Identity and bookkeeping

| Field | Meaning |
| --- | --- |
| `id` | `FS-` + a number. Server-allocated: one above the highest in use, counting from base 1053. Never reused |
| `owner` | Name of the creator |
| `requestedBy`, `requestedAt` | Who asked for the visit and when (epoch ms) |
| `createdAt`, `updatedAt` | Epoch ms |
| `rev` | Revision counter. Bumped by every save that carries field edits. A save that only changes photos or sketches MUST NOT bump it (15.4) |
| `syncState`, `syncedAt` | `synced` / `pending` / `syncing` / `error`. A server write is always stored `synced` |
| `templateRev` | Sheet template revision, `"1.0"` |
| `leadId`, `visitId` | The lead and the site-visit request that spawned the record, or null |
| `customerId`, `locationId` | Links to the CRM company and venue, or null. `customer` and `venue` hold the names as text and are what the record is known by |

All timestamps are epoch-millisecond numbers. Dates the user picks (`scheduledDate`,
`quoteNeededBy`, `projectCompletion`, `assessment.date`) are `YYYY-MM-DD` strings. A month field
(`lastFlameTest`) is `YYYY-MM`. People are stored by **name**, not id (`assignedTo`, `owner`,
`requestedBy`, assessors).

The full field-by-field model is in `venue-assessment-form.json` (`recordFields` plus every
section's `fields`). The shape in outline:

- Flat top-level strings and booleans for the brief, access, quote and notes fields.
- `measurements` — one flat map of key → free-text string (or boolean for the four check fields).
- `lifeSafety` — four strings.
- `scope` — array of discipline keys, absent when unanswered.
- `disciplines` — `{ rigging, curtain, lighting, av }`, each a map of field key → value. Values are
  strings, booleans, numbers (condition levels), string arrays (`present`, `scope`, `goals`,
  `positionList`) or maps of rows (`curtain.items`, `lighting.positionRows`).
- `inventory` — one array of typed quantity rows shared by lighting and AV.
- `linesets`, `linesetQty`, `linesetsEnabled` — the line set schedule.
- `assessmentEnabled`, `assessment` — the optional Condition & Needs layer.
- `photoRefs`, `sketches` — file references (chapter 13). `photos` — legacy inline photos.
- `internalTags` — tag ids.
- `signoff` — seven strings; no longer editable (11.7).
- Legacy keys that are kept and read but no longer written: `visitType`, `venueType`,
  `liftNeeded`, `loadingDoorSize`, `liftHeight`, `conditions`, `systemsState`.

A new record starts from a blank shape with every string `""`, every boolean `false`,
`venueClass: "theatre"`, `venueType: "Proscenium theater"`, `stage: "requested"`.

### 2.2 Stage lifecycle

Stages, in order: `requested` → `scheduled` → `onsite` → `completed`.

- The header shows the four stages as pills and one primary action for the next step:
  "Schedule →", "Start on-site →", "Mark complete →", and on a completed record "Create quote →".
- Any pill can be tapped to move the record to that stage directly, forwards or backwards. There
  are no preconditions on any stage move except the save validation (4.4).
- Every stage move saves the whole draft at the same time.
- Moving to `scheduled` stores `assignedTo` and `scheduledDate` with the stage in one write.
- A record with no stored stage reads as `completed` when its `syncState` is `synced`, otherwise
  `onsite`.
- Separately from the stage, the record shows a derived **intake status** chip (6.3.4). The two are
  independent.

### 2.3 Assignment and scheduling

- `assignedTo` is chosen from the active team roster; `scheduledDate` is a date.
- A record created with "New request" opens assigned to its creator and scheduled for today
  (America/Chicago), stage `requested`. Both stay editable.
- A record created from a lead's "Request site visit" is assigned to the visit's assignee (else the
  requester) and scheduled today (17.1).
- Scheduling here is a date only. Time-of-day booking, invites and calendars belong to the site
  visit record (17.1), not to the Venue Assessment.

### 2.4 Delete

Delete is a two-step control ("Delete" then "Confirm delete", which disarms after 5 seconds). It is
a soft delete: the record disappears from every list but the row is kept.

**Source:** `src/lib/stores/surveys.ts`, `src/app/(app)/venue-assessments/actions.ts`,
`src/app/(app)/venue-assessments/[id]/actions.ts`,
`src/app/(app)/venue-assessments/[id]/controls.tsx`, `src/lib/stores/site-visits.ts`.

---

## 3. List screen

Route `/venue-assessments`. `?id=<FS id>` redirects to the editor at `/venue-assessments/<id>`.

- Heading "Venue assessments" with a count line: "N surveys · a requested · b scheduled · c on-site ·
  d completed".
- A stage segment (All, Requested, Scheduled, On-site, Completed) with counts, an "assigned to me"
  toggle (matches `assignedTo` to the signed-in user's name), and internal-tag filter chips (only
  tags in use or already selected are offered). Filters combine.
- Records sort by `updatedAt`, newest first. Each card shows customer (or "Untitled request"),
  venue and venue type, the stage, and on a completed record a "Create quote →" button.
- "+ New request" creates a record (2.3) and opens it.
- A sync strip states "All synced" or "N changes to sync".
- Above the list sits the open site-visit request queue (17.1), which is a different record type.
- CSV: a blank template download and an upload. Columns: `survey_id, customer, venue, venue_type,
  address, reason, scope_of_work, notes, stage`, plus any column named `measure_<key>` which is
  written to `measurements[<key>]`. A row whose `survey_id` matches an existing record updates it;
  otherwise a new record is created. An unknown `stage` becomes `requested`. The page reports
  imported and failed counts.

**Source:** `src/app/(app)/venue-assessments/page.tsx`,
`src/app/(app)/venue-assessments/actions.ts`,
`src/app/api/venue-assessments/template.csv/route.ts`.

---

## 4. Editor frame

### 4.1 Header (sticky)

- Back link, title (the customer name, else "Site survey"), `FS-####` and time since last update.
- A save pill: "Unsaved changes", "Photo not saved yet", "Drawing not saved yet", or "Saved".
- "N uploading" while photos or drawings of this record are still on the device.
- The intake status chip (6.3.4).
- Buttons: Print sheet, Delete, Save changes.
- A second row: the four stage pills, the assignment line ("Assigned to X · date"), and the next
  stage action.
- A third row: the layout switch.

### 4.2 Layouts

- **Long scroll** (default): every visible section on one page, with a group heading above the
  first section of each group and a progress rail at the side (a select on a phone).
- **Stepped**: one step at a time with Back / Next; the last step's button is Save changes. Steps:
  Brief, Site & access, Measurements, Site intake, Assessment, Wrap-up. Steps with no visible
  section are skipped.

The layout choice is not stored. Jumping to a section in another step switches step first.

### 4.3 Sections, collapse and the rail

- Every section is a card that opens and shuts. Sections marked collapsed-by-default in the JSON
  start shut. The choice is remembered per viewer, per record, on the device.
- The rail lists every visible section with a progress ring (answered / answerable fields), a
  "needs answers" badge on Kill questions while incomplete, and a photo-count badge.
- Progress counts text, select, long-text, measurement and sub-object fields. Checkboxes and yes/no
  buttons are not counted (unticked is a valid answer). For a discipline: scope, goals, Present,
  each visible non-checkbox field, the curtain rows as one answer, lighting positions as one answer
  and their rows as another. The line set schedule counts 1 of 1 once any row holds data or the
  quantity is 0. Read-only sections have no ring.
- A locked discipline (5.3) is greyed, cannot open, and tapping it shows "Answer the kill questions
  to unlock the discipline intakes" and jumps to Kill questions.

### 4.4 Save validation

A save, a stage move and Create quote are refused, with an inline message, while `customer` or
`venue` is blank. Nothing else is required to save. The record "always saves as a draft".

**Source:** `src/app/(app)/venue-assessments/[id]/controls.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/progress.ts`,
`src/app/(app)/venue-assessments/[id]/sections/collapse.ts`, `src/lib/survey-flow.ts`.

---

## 5. Section order, groups and visibility

### 5.1 Order

Sections always appear in this order; a section that does not apply is skipped.

| # | Key | Title | Group | Step |
| --- | --- | --- | --- | --- |
| 1 | `cust` | Customer & venue | Office brief | Brief |
| 2 | `visit` | Visit | Office brief | Brief |
| 3 | `tier1` | Kill questions | Office brief | Brief |
| 4 | `site` | Site access & logistics | Field capture | Site & access |
| 5 | `lifeSafety` | Life safety | Field capture | Site & access |
| 6 | `mQuick` | Measurements | Field capture | Measurements |
| 7 | `mLayout` | Stage layout | Field capture | Measurements |
| 8 | `mSection` | Stage section | Field capture | Measurements |
| 9 | `mBeams` | Beams & rigging | Field capture | Measurements |
| 10 | `mFOH` | FOH positions | Field capture | Measurements |
| 11 | `mHouse` | House & room | Field capture | Measurements |
| 12 | `m3d` | 3D preview | Field capture | Measurements |
| 13 | `dRigging` | Rigging intake | Site intake | Site intake |
| 14 | `dCurtain` | Curtain intake | Site intake | Site intake |
| 15 | `dLighting` | Lighting intake | Site intake | Site intake |
| 16 | `dAv` | AV intake | Site intake | Site intake |
| 17 | `linesets` | Lineset schedule | Site intake | Site intake |
| 18 | `assessmentToggle` | Condition & Needs assessment | Condition & needs | Assessment |
| 19 | `assessmentUsage` | Usage & needs profile | Condition & needs | Assessment |
| 20 | `assessmentCondition` | Condition ratings | Condition & needs | Assessment |
| 21 | `assessmentFindings` | Findings & recommendations | Condition & needs | Assessment |
| 22 | `photos` | Earlier photos | Wrap-up | Wrap-up |
| 23 | `notes` | Scope & notes | Wrap-up | Wrap-up |
| 24 | `project` | Existing materials & quote | Wrap-up | Wrap-up |
| 25 | `finalQuestions` | Final questions | Wrap-up | Wrap-up |
| 26 | `recap` | Customer recap | Wrap-up | Wrap-up |
| 27 | `finalThoughts` | Final thoughts | Wrap-up | Wrap-up |
| 28 | `assign` | Assignment & schedule | Wrap-up | Wrap-up |

Group blurbs: Office brief "Who, why, and the kill questions"; Field capture "Filled on-site by the
surveyor"; Site intake "One branch per discipline in scope"; Condition & needs "Advisory condition
and planning profile"; Wrap-up "Last questions, the read-back, and internal notes".

### 5.2 Visibility rules

The **scope** is the Kill-questions answer `scope`: a subset of rigging, curtain, lighting, av.

- Scope is "unanswered" when the stored value is absent, not a list, or holds none of the four
  keys. An unanswered scope MUST filter nothing: every section shows.
- A discipline is "in scope" when scope is unanswered or includes it.

| Section | Shows when |
| --- | --- |
| `dRigging`, `mBeams` | rigging in scope |
| `linesets` | rigging in scope AND (the schedule already has rows, OR the rigging system is unanswered, OR it includes Counterweight, Dead-hung, Motorized or Hemp) |
| `dCurtain`, `finalQuestions` | curtain in scope |
| `dLighting`, `mFOH` | lighting in scope |
| `dAv` | av in scope |
| `assessmentUsage`, `assessmentCondition`, `assessmentFindings` | `assessmentEnabled` is true |
| `photos` (Earlier photos) | the record holds legacy inline photos |
| everything else | always |

A hidden section or field MUST keep its stored answers. Hiding never clears. Un-hiding shows them
again.

### 5.3 The kill-question lock

The four discipline sections are locked until the kill questions are complete (6.3.3). Locked is
different from hidden: the section is listed, greyed, shut, with the subtitle "Locked — answer the
kill questions above first". The lock is soft: the record can be saved in any state.

### 5.4 The quote rule

A visit is a "quote visit" only when Purpose of visit, trimmed, is exactly `New system design`.
Only then does Existing materials & quote show its eight quote and budget fields (11.2). Answers
entered earlier stay stored when the purpose changes.

**Source:** `src/lib/survey-flow.ts`, `src/app/(app)/venue-assessments/[id]/controls.tsx`,
`DECISIONS.md` D1019–D1023.

---

## 6. Brief

### 6.1 Customer & venue

- **Customer**: pick from the CRM directory, or "+ New customer (not in directory)" and type a
  name. Picking a directory customer sets the customer name, selects its primary venue (first venue
  if none is primary) and sets the venue name; if Site address is blank it fills "City, State" from
  that venue; if On-site contact or Contact email is blank it fills them from the customer's primary
  contact. It never overwrites a non-blank field.
- **Venue**: a pick list of the customer's venues, or "Other venue…" for free text. Free text
  clears the venue link.
- **Venue class**: Theatre, Auditorium, Church, Gym, Convention Center, Other, each with a blurb.
  The class drives the quick measurement set (7.3), which measurement keys the kill questions use
  for stage width and depth (6.3), class-only discipline fields (chapter 8) and the curtain Present
  list. Changing the class clears the subtype.
- **Type** (labelled "<Class> type"): that class's own subtype list. Class Other has none and the
  select is disabled.
- Site address, On-site contact, Contact phone, Contact email, Auditorium size (three seat bands),
  Built year. All free text except the size select. Seating capacity in Measurements and Auditorium
  size are deliberately not linked.

`venueType` is a legacy display string. On every save it is written as the record's existing legacy
value if it has one, else the class label.

### 6.2 Visit

Purpose of visit (New system design, Bid walk, Repair / service, Annual inspection, Punch list,
Other), Travel time, Distance, Reason / scope of visit.

**Travel auto-fill.** When the record is linked to a customer and venue, the venue's address is
verified, and a real drive estimate from the office exists (a manual override or a routed result;
never a straight-line guess), a blank Travel time and Distance are filled once on open, as "35 min"
or "1 h 10 min" (minutes rounded, at least 1) and "22 mi" (rounded, at least 1). A hint "From the
venue's verified address" shows under each field while its value still equals the suggestion. The
fill is not treated as an unsaved change. The next save stores `travelAutoFilled: true`, and a
record carrying that flag MUST never be auto-filled again, so a field the rep clears stays cleared.
A failed lookup fills nothing.

### 6.3 Kill questions

The gate before the discipline intakes.

#### 6.3.1 Checklist

A row of status chips, green when done:

| Item | Done when | Answered in |
| --- | --- | --- |
| Venue name | `venue` or `customer` is non-blank | Customer & venue (chip jumps there) |
| Contact name | `contact` non-blank | Customer & venue |
| Contact email | `contactEmail` non-blank | Customer & venue |
| Stage width | any of `measurements.proW`, `roomWidth`, `platformWidth`, `stageWidth`, `floorWidth`, `courtWidth`, `sanctuaryWidth` is non-blank | here |
| Stage depth | any of `measurements.stageDepth`, `roomDepth`, `platformDepth`, `floorDepth`, `courtLength`, `sanctuaryLength` is non-blank | here |
| Scope | scope holds at least one discipline | here |
| Rigging system | at least one system chosen. This item exists only when scope includes rigging | here |

Contact phone is not a kill question.

#### 6.3.2 Questions answered on the card

- **Scope — what does this visit cover?** Four chips: Rigging, Curtains, Lighting, AV. Stored as
  keys (`rigging`, `curtain`, `lighting`, `av`) in that fixed order regardless of tap order. An
  empty selection is stored as absent.
- **Rigging system**: Counterweight, Dead-hung, Motorized, Hemp, Fixed points, None. Multi-select.
  "None" is exclusive: choosing it replaces the selection; choosing anything else removes it. Shown
  while scope is unanswered or includes rigging. Stored at `disciplines.rigging.present`. This is
  the ONE place the rigging system is asked; the Rigging intake shows it read-only with a Change
  link back here.
- **Stage width** and **Stage depth**: two measurement inputs whose key and label depend on the
  venue class:

| Class | Width key | Depth key |
| --- | --- | --- |
| Theatre, Auditorium | `proW` | `stageDepth` |
| Church | `sanctuaryWidth` | `sanctuaryLength` |
| Gym | `courtWidth` | `courtLength` |
| Convention Center, Other | `roomWidth` | `roomDepth` |

  They write the same `measurements` keys the Measurements section edits: one value, two places.

#### 6.3.3 Complete

The kill questions are complete when every checklist item present is done. That unlocks the
discipline sections.

#### 6.3.4 Intake status

Derived, never stored:

| Status | Label | When |
| --- | --- | --- |
| draft | Intake: draft | kill questions incomplete |
| general-complete | Intake: general complete | complete, no discipline data yet |
| discipline-added | Intake: discipline added | any discipline holds data, or has an inventory row. Rigging's system answer alone does not count |
| ready-for-quote | Ready for quote | discipline-added AND `intakeReady` is true |

A "Mark ready for quote" button appears at discipline-added and sets `intakeReady`; at
ready-for-quote it becomes "✓ Ready — undo". An older record with no derivable scope reads
"Intake: draft" until Scope is answered; this was accepted.

**Source:** `src/app/(app)/venue-assessments/[id]/sections/custvenue.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/kill-questions.tsx`,
`src/lib/stores/survey-intake.ts`, `src/lib/stores/venue-classes.ts`, `src/lib/field-lists.ts`,
`src/lib/survey-travel-server.ts`, `src/app/(app)/venue-assessments/[id]/controls.tsx`.

---

## 7. Field capture

### 7.1 Site access & logistics

Loading dock, Elevator size, Floor type, Access door size, Loading door type, Loading door
location, Loading door W × H, Lift needed? (Yes / No), Path: truck → floor, Working hours allowed,
Blackout dates / events, Floor protection required, Badging / background check, First impressions /
notes.

Lift: "Lift needed?" stores the string `yes`, `no` or empty; tapping the selected button clears it.
Lift type, Working height and Who supplies lift show while Lift needed is Yes, OR while any of the
three already holds a value (so details entered before "No" was chosen stay visible and editable).

### 7.2 Life safety

Four free-text fields, stored under `lifeSafety`: deluge / sprinkler over stage, smoke vent / hatch,
ADA access notes, egress notes. Offered on every venue class. Starts collapsed.

### 7.3 Measurements

All measurement values are free text in one flat `measurements` map. The rep may type feet-inches
(`38'-6"`), decimal feet (`38.5`), or words. Nothing is validated or converted on entry. Four keys
hold booleans (the three drawing checks and Loading bridge present).

- **Measurements** (`mQuick`): the venue class's own quick set (8 to 21 fields; lists in the JSON).
  Every field is a plain text input here, including descriptive ones ("Structure at grid
  (steel/joist/deck)", "Clear span or columns?"). An unknown class uses the Other set.
- **Stage layout**, **Stage section**, **Beams & rigging**, **FOH positions**, **House & room**:
  five optional groups, collapsed by default, with fixed field lists.

**Shared keys.** A key means one dimension everywhere. `proW` in the quick set, in Stage layout and
in Kill questions is the same stored value; so are `gridH`, `houseH`, `stageDepth`, `apron`,
`wingSL`, `wingSR`, `centerAisleW`, `boothLoc`, `boothWD`. A rebuild MUST keep one value per key and
show it in every place the key appears.

**Measurement links.** Two Rigging intake fields are bound to measurements instead of having their
own storage: "Grid height" edits `measurements.gridH`, and (Auditorium only) "Loading gallery
notes" edits `measurements.loadingGallery`. Each shows the hint "Same value as Measurements".

**Beams & rigging.**

- "Structural drawing on file" is always offered.
- "Brick drawing on file" and "CW Elevation sheet on file" are offered only when the rigging system
  includes Counterweight.
- When Structural drawing on file is ticked, the beam measurements (1st beam distance, spacing,
  direction, type, draw side, loading bridge, midrail) are replaced by the note "The structural
  drawing covers the beam measurements." Their stored values are kept.

### 7.4 3D preview

A display-only parametric model built from the measurements: a stage-and-house model for a Theatre
or Auditorium whose subtype is not "Black box / flexible" or "Thrust / arena"; a single room for
everything else. Views: Orbit, Plan, Section, Elevation, with a Wireframe switch. It stores nothing
and a rebuild can omit it.

**Source:** `src/lib/survey-measure-fields.ts`, `src/lib/stores/venue-classes.ts`,
`src/lib/field-lists.ts`, `src/app/(app)/venue-assessments/[id]/controls.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/fields.tsx`,
`src/app/(app)/venue-assessments/[id]/venue-3d.tsx`, `DECISIONS.md` D1044–D1047, D1218.

---

## 8. Discipline intakes

One section per discipline: Rigging, Curtain, Lighting, AV. Each stores into
`disciplines.<key>`. Editing anything in a discipline adds its key to `disciplinesActive`.

### 8.1 Common layout, in order

1. **Scope of interest** — multi-select chips; each list ends with "Other". Ticking Other opens
   "Explain the scope" (`scopeOther`, 500 characters). Unticking Other keeps the text stored but
   hides it, and it is no longer read back or printed.
2. **Client goals** — a list, one goal per row, with add, move up, move down and remove. At most 20
   rows. The save trims each line, drops blank lines and keeps at most 1,000 characters in total
   (lines joined by a newline); the editor shows a live "characters left" count and stops typing at
   the limit so nothing is cut silently. Enter adds a row below. Stored as a list of strings.
3. **Present** — multi-select chips of what is installed. "None" is exclusive, the same way as the
   rigging system. For Rigging this is not editable here (6.3.2).
4. Everything below shows only while Present is NOT exactly "None":
   the discipline's fields, then curtain rows (Curtain), lighting positions (Lighting), inventories
   (Lighting, AV), then a Notes box.

When Present is exactly None, the discipline shows only scope, goals and Present, and prints
nothing else.

Some fields appear only for the Auditorium class (marked in the JSON by a `venueClass` rule).

### 8.2 Rigging

Scope options: New grid, System refurbish, Add hoists, Capacity upgrade, Inspection only, Other.
Fields: Existing grid (check), Grid construction & spacing, Grid height (bound, 7.3), Load-bearing
points, Rail condition / capacity / age, Chain hoists, Deck load capacity. Auditorium only: Fly
system type, Batten length, Arbor / motor capacity, Grid / block condition, Hemp line condition,
Motor control, Loading gallery notes (bound), Fire curtain present (check), Fire curtain rating,
Release mechanism, Fire curtain last inspection.

### 8.3 Curtain

- Present options, default: Divider curtain, Track — straight, Track — curved, Additional general
  purpose / scenery pipes, Wall bracket, Cyc / backdrop, None. Auditorium class: Main / act
  curtain, Grand drape, Traveler, Teaser / tormentors, Legs, Borders, Cyc / scrim, None.
- Scope options: Single curtain replacement, Single set replacement, Flame test, Full curtain
  replacement, Other.
- Fields: Proscenium height to grid; Traveler rod condition (Good, Fair, Needs replacement); Track
  operation (SL, SR); Additional general purpose / scenery pipes (qty), shown only while that
  Present chip is ticked; Pipe / track lengths; Height above floor; Load capacity per position;
  Curtain type (Auditorium only); Last flame test (a month).
- **Curtain rows**: one card for each ticked Present option except None and the pipes chip, titled
  with the option. Columns: QTY, Fabric type (free text with suggestions from the catalog's fabric
  parts), oz, Track series (N/A, None, Lightweight, Standard, Curved), W, H, Condition (slider,
  8.6). Stored at `disciplines.curtain.items[<option label>]`. Unticking an option hides its row
  but MUST keep the data.
- "Replace vs. reuse" for curtains lives in Final questions (11.3) but is stored in this
  discipline (`disciplines.curtain.replaceVsReuse`).

### 8.4 Lighting

- Present: Theatrical lighting, House lighting, Work lights, Portable fixtures, None.
- Scope options: New rig, Controls upgrade, Fixture replacement, Console upgrade, Full system
  audit, Other.
- Fields: Console manufacturer / model; Console location (Booth, Stage, Other) with "Other —
  where?" (200 characters) when Other; Install year; Architectural control — manufacturer / model;
  Control protocol; Panel power feeds & locations; Plug type. Auditorium only: Dimmer / relay rack
  location + capacity, DMX universes / protocol, Follow-spot booth.
- **Lighting positions**: chips Electric 1–5, FOH 1–3, Torms, Balcony, Other (`positionList`). Each
  ticked position gets a card with Circuits, Length, Trim / height, Notes, stored at
  `positionRows[<position>]`. Cards follow the list order above, then any other stored value.
  Unticking keeps the row data, hidden.
- **Fixtures inventory**: rows of Type, Position (Front, Down, Side, Back, Cyc, Movers), Quantity,
  a flag, Notes / model. Under it a derived line "Totals: Front 12 · Side 8": per position, the sum
  of quantities that are plain numbers. Rows with a quantity but no position, or a quantity that is
  not a plain number (such as "~20"), are not summed and are reported as "~N rows not counted".
- **Infrastructure inventory**: Type, Quantity, flag, Notes.

### 8.5 AV

- Present: Sound reinforcement, Paging, Projection / video, Recording / streaming, None.
- Scope options: New projector, New screen, Speaker upgrade, Unified control, Streaming capability,
  Acoustic treatment, Other.
- Fields: PA / sound manufacturer, Speaker locations / quantity, Microphone / paging inputs,
  Condition (slider), Electrical panel location, Spare breaker capacity, Company switch / generator
  tie-in, Network / wifi coverage, How lights / curtains / AV are controlled today, Network / wifi
  quality (stage area), Broadcast / recording needs.
- Inventories: Audio devices, Audio infrastructure.

**Inventories (Lighting and AV).** All rows live in one top-level `inventory` list; each row has an
id, its discipline, its category (`lighting.fixture`, `lighting.infrastructure`, `audio.device`,
`audio.infrastructure`), type, quantity (free text), flag, notes, and for fixtures a position. The
Type list per category is editable in Settings; the built-in defaults are in the JSON. A stored
type that is no longer in the list still shows.

### 8.6 The condition slider

Used for AV Condition, each curtain row and each line set.

- Five steps stored as a number 0–4: Bad, Poor, Fair, Good, New.
- Never rated: the key is absent. The slider shows a faded "Not rated" track with a "Rate" button;
  Rate, or releasing the thumb, sets 2 (Fair).
- "Clear" stores `null`. A rebuild MUST keep null distinct from absent: null means "the rep cleared
  it" and stops an importer from re-seeding the rating from an older answer (chapter 16).

**Source:** `src/lib/stores/survey-intake.ts`,
`src/app/(app)/venue-assessments/[id]/sections/systems.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/scope-chips.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/goals-list.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/curtain-rows.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/lighting-positions.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/condition-slider.tsx`,
`src/lib/estimate-output/goals.ts`, `src/lib/survey-format.ts`, `DECISIONS.md` D1038–D1051.

---

## 9. Line set schedule

Quantity first.

- **How many line sets?** A whole number, 0 to 200. Committing it makes the table hold sets
  numbered 1 to N.
  - Existing rows keep their identity, matched by set number.
  - Missing numbers get blank rows.
  - Rows numbered above N are removed: silently when empty; when they hold data the editor asks
    first ("Remove sets 12–14? They have information entered." Confirm / Cancel).
  - A row with no usable set number is kept, listed after the numbered ones.
  - Blank commits as 0. Once touched, the quantity is always stored as a number.
- **Rows.** Columns: Pos. (set number), Dist. from PL, Set name, Type, Batten length, Lift lines,
  Goods, Finished W × H, Arbor / motor load, Trim low, Trim high, Condition (slider), Notes. All
  free text except Type and Condition. Type codes: D Draw / main, M Midstage traveler, R Rear
  traveler, L Legs, B Border, C Cyc, S Scrim / bounce, E Electric, T Track only, O Open / spare.
- Rows show sorted by set number; a set number is a whole number of 1 or more.
- A row can be removed individually only when its number is above the quantity, it has no usable
  number, or no quantity is set. Removing a row that holds data asks to confirm.
- **Fill down**: choose a column, click into a row, and copy that row's value into the same column
  of every row below. If that would change non-empty cells the editor states how many and asks to
  confirm. Filling Condition from an unrated row writes null, not absent.
- **Mark range spare**: give a first and last set number; every set in the range with no type
  becomes O (Open / spare). Sets that already have a type are left alone and named in the result
  message.
- When the quantity says there should be sets that have no row yet (an imported count), a control
  adds the missing ones without removing or reordering anything.
- Any row edit, or a quantity above 0, sets `linesetsEnabled` true so that older readers show the
  schedule.
- **Fill in by hand**: a sketch pad drawn as the printed schedule sheet, 30 rows a page (13.4).
  Shown only when the rigging system includes Counterweight, Dead-hung, Motorized or Hemp.
- The legacy per-row condition code `cond` (G, F, P, X) stays stored and is no longer edited.

**Source:** `src/lib/stores/linesets.ts`,
`src/app/(app)/venue-assessments/[id]/sections/linesets.tsx`, `src/lib/survey-flow.ts`,
`src/lib/ink/backgrounds.ts`, `DECISIONS.md` D1050.

---

## 10. Condition & Needs layer (inside the Venue Assessment)

An optional advisory layer, turned on by one checkbox ("Add Condition & Needs assessment — Use when
the customer has no defined ask or needs a formal deliverable"). It is an older, simpler feature
than the Assessments engine of chapter 19 and shares nothing with it. Findings here are advisory:
nothing in this layer creates a quote, a job or a task.

- **Usage & needs profile**: assessment date; technical reviewer name and role; assessors (chips
  from the team roster); the customer's stated concern in their own words; how the room is used
  (event-type chips, each with a frequency once ticked); staff capability; training gaps; growth
  goals (chips) and notes. Then "Budget & decision process": Budget, Fiscal year / spend-by date,
  Who decides, Target install window, Quote deadline. These five are the same stored fields as in
  Existing materials & quote, shown here regardless of the visit purpose.
- **Condition ratings**: ten fixed categories in three groups, each rated Good, Monitor or Replace
  (tapping the active rating clears it) with a notes box. Under each group, "Formal inspection on
  file?" (and under the first group also "Flame certificate on file?"): Yes / No, type or provider,
  date. In the app these references resolve automatically from the venue's own flame-test and
  inspection records and show as a link, with "Enter manually instead". Last, an Electrical / power
  notes box that is deliberately not rated ("outside Peak's lane").
- **Findings & recommendations**: a list of findings, each with a title, detail, a priority bucket
  (Now, Soon, Later), a planning budget tier (<$5k, $5–25k, $25–100k, $100k+), one or more
  condition categories, and optional links to the record's legacy photos.
  - With no findings yet, one button seeds a finding for every category rated Monitor or Replace,
    titled with the category and carrying its notes.
  - Once any finding exists, flagged categories not covered by a finding are listed as gaps with an
    add button each; they are never added silently.
  - Merge: select exactly two. The first keeps its own fields and gains the other's categories,
    photo links and detail (appended on a new line); the other is removed.
  - Split: a finding with two or more categories can split one off into a new finding that copies
    the bucket, detail, budget tier and photo links.

**Source:** `src/lib/stores/assessment.ts`,
`src/app/(app)/venue-assessments/[id]/sections/assessment-usage.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/assessment-condition.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/assessment-findings.tsx`,
`src/lib/venue-assessment-certs.ts`.

---

## 11. Wrap-up

### 11.1 Scope & notes

Three free-text boxes: Scope of work, How the quote should look, Generic notes.

### 11.2 Existing materials & quote

- Always: three checkboxes — Existing BOM on file, Existing drawings on file, Existing photos on
  file.
- Only on a quote visit (5.4): Quote needed by (date), Is it budgetary? (Yes / No, stored as a
  boolean), Project completion (date), Install timeframe (ASAP, Under 1 month, 1–3 months, 3–6
  months, 6–12 months, TBD), Budget, Fiscal year / spend-by date, Who decides, Target install
  window.
- The subtitle tells the rep to ask these last, or, off a quote visit, that the quote questions
  show when the purpose is New system design.

### 11.3 Final questions

Shown when curtains are in scope. One question today: Replace vs. reuse (curtains) — Replace,
Reuse, Mixed, TBD.

### 11.4 Customer recap

A read-only read-back in large type, headed "What we heard — read this back to the customer."

- With a scope set: one block per discipline in scope, in the order rigging, curtain, lighting, AV.
- With scope unanswered: one block per discipline that has scopes of interest, goals or Other text.
- Each block: the discipline name; "Interested in: " followed by the ticked scopes (without the
  word Other) and, if Other is ticked and explained, "Other: <text>"; or "No scopes of interest
  captured."; then the client goals as a bulleted list.
- Empty: "Nothing to read back yet — pick a scope in Kill questions, then capture scopes of
  interest and client goals in each discipline."

### 11.5 Final thoughts (internal tags)

Chips of internal judgment tags ("Tight timeline", "Price-sensitive", …). The record stores tag
ids. MUST never be printed or shown to a customer. A tag that has been retired but is still on a
record shows struck through and can only be removed. Below the chips, a record that still carries
legacy site-condition chips shows them read-only as "Older site conditions". The list screen can
filter by tag.

### 11.6 Assignment & schedule

Assigned to (team roster) and Scheduled date. The subtitle reads "Requested by <name>" when known.

### 11.7 Sign-off

Sign-off was removed from the editor. The seven `signoff` fields are still stored, and the printed
sheet still adds a Close-out page when any of them holds a value.

### 11.8 Older notes

Any section can end with a folded, read-only "Older notes (N)" list: answers from before a field
was renamed or removed. They are derived on every read and never stored (chapter 16).

**Source:** `src/app/(app)/venue-assessments/[id]/controls.tsx`, `src/lib/survey-flow.ts`,
`src/app/(app)/venue-assessments/[id]/sections/recap.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/final-thoughts.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/older-notes.tsx`, `DECISIONS.md` D1025–D1030.

---

## 12. Pick lists and internal tags

### 12.1 Fixed lists

The lists below are fixed in code; changing one is a code change. All are reproduced in the JSON
(`lists`).

| List | Values |
| --- | --- |
| Lift types | Ladder >12ft, Scaffolding, Single Man Lift, Scissor >20ft, Scissor >40ft, Scissor >50ft |
| Loading door types | Roll-up / overhead, Double doors, Single door, Dock door, Other |
| Track series | N/A, None, Lightweight, Standard, Curved |
| Track operations | SL, SR |
| Plug types | Stage-pin, Edison, Twist-lock, Other, Mixed |
| Lighting positions | Electric 1–5, FOH 1–3, Torms, Balcony, Other |
| Fixture positions | Front, Down, Side, Back, Cyc, Movers |
| Console locations | Booth, Stage, Other |
| Condition steps | Bad, Poor, Fair, Good, New (stored 0–4) |

Rule for Lift types, Loading door types and Lighting positions: the Assessments engine derives its
own option codes from these labels (lowercased, non-alphanumerics to `_`). Add new labels; never
edit or remove one.

Lists that live elsewhere in code: venue classes and subtypes, visit purposes, rigging systems,
floor types, lift suppliers, beam types and directions, draw sides, booth locations, install
timeframes, line set types, and each discipline's Present, scope and select options.

Every select MUST still display a stored value that is not in its list (an older answer) and keep
it until the user changes it.

### 12.2 Settings-backed lists

- **Inventory type catalog**: four categories; a stored non-empty list for a category replaces the
  default list for that category.
- **Internal tags**: a list of `{ id, label, retired? }`. Rules:
  - When nothing is stored, a starter list of nine tags applies.
  - Ids are minted once from the label (`tg_` + a slug of at most 36 characters, with `_2`, `_3`
    on collision) and never change, even if the label is edited.
  - Labels are at most 60 characters; two active tags may not share a name (case-insensitive).
  - A tag removed in the editor is kept as retired, so a record that carries it still shows its
    label. At most 40 tags including retired ones.

**Source:** `src/lib/field-lists.ts`, `src/lib/survey-tags.ts`, `src/lib/stores/survey-intake.ts`,
`src/lib/stores/surveys.ts`, `src/lib/stores/venue-classes.ts`.

---

## 13. Photos, markup and sketch pads

### 13.1 Section photos

- Every section header (except Earlier photos, and not while a discipline is locked) has "Add
  photo": the camera, or several from the library.
- Photos are shrunk on the device before anything else: longest edge 1,600 px, JPEG. An original
  over 25 MB is refused. HEIC is refused with "HEIC isn't supported — set the camera to Most
  Compatible".
- Each photo belongs to the section it was added in and may carry a caption (500 characters).
- A record holds at most 200 photos.
- Each photo reference: `id` (`p_` + hex), `section`, `takenAt`, `by`, optional `caption`, a file
  slot, and an optional markup.
- A file slot is one of: uploaded (a storage path), inline (a small data URL, local development
  only), or `pending` (still on the device).

### 13.2 Markup

A photo can be drawn over with the ink pad. Markup MUST never change the original file. The photo
keeps its original and gains a markup made of two files: a flattened image and the strokes. The
viewer offers View original, Edit markup and Remove markup. Every time a markup is made or redone
it gets a brand-new id, so a late upload of a superseded markup can never land in the new one.

### 13.3 The ink model

A drawing is vector strokes plus text labels on a canvas of a known size:

- Stroke: a colour, a width, and a flat list of points `x, y, pressure`. Coordinates are rounded to
  0.5, pressure to two decimals in 0–1. Strokes are simplified as they are committed.
- Label: position, text (120 characters), colour, size.
- Three ink colours: near-black, red, blue.
- Limits: 5,000 strokes, 400,000 point numbers, 200 labels. A drawing whose strokes file would
  exceed 4 MB cannot be finished; the pad says to erase some strokes.
- Tools: Pen, Eraser (removes whole strokes it touches), Text label, Undo / Redo (200 steps),
  delete selected label, Clear all (with a confirm), Done, Cancel.
- **Pencil first.** Once a stylus touches any pad, the stylus draws and fingers only pan and
  pinch-zoom, so a resting palm never draws. This is remembered on the device. "Draw with finger"
  turns it off again. Without a stylus, mouse and finger draw.
- Done saves two files: the strokes (JSON) and a flattened JPEG of background plus ink. Nothing
  reads the handwriting; it is never converted to text.

### 13.4 Sketch pads

Fixed pads, each in its own section:

| Pad key | Section | Shown when |
| --- | --- | --- |
| `beams` | Beams & rigging | the section shows |
| `cwElevation` | Beams & rigging, beside its "on file" check | rigging system includes Counterweight |
| `brick` | Beams & rigging, beside its "on file" check | rigging system includes Counterweight |
| `stagePlan` | Stage layout | always |
| `stageSection` | Stage section | always |
| `houseSection` | FOH positions | the section shows (lighting in scope) |
| `housePlan` | House & room | always |
| `linesetSheet` (+ pages 2–7) | Lineset schedule | rigging system includes Counterweight, Dead-hung, Motorized or Hemp |

- **Backgrounds** are drawn from the record's measurements at 10 units per foot: stage plan, stage
  section, house plan and house section show the measured dimensions as labelled dimension lines;
  an unknown dimension uses a generic default and shows its name only. Beams, CW elevation and
  Brick are plain grids (CW Elevation is a placeholder awaiting a real sheet).
- **Line set sheet**: a ruled table with 13 columns (Set, Dist. from PL, Set name, Type, Batten,
  Lift lines, Goods, Finished W×H, Arbor load, Trim low, Trim high, Condition, Notes), 30 rows a
  page. Pages needed = quantity ÷ 30 rounded up, at least 1, at most 7; a page already drawn stays
  listed if the quantity later drops. A saved sheet MUST reopen at the row count it was drawn on
  and is never scaled, so handwriting stays on its rows. Every other pad rescales saved strokes to
  fit a background whose size changed with the measurements.
- A redraw makes a new sketch id; the previous files are abandoned, not deleted.
- Each sketch reference: `id` (`s_` + hex), an image slot, a strokes slot, `updatedAt`, `by`.

### 13.5 File ids and storage

| File | Id | Type |
| --- | --- | --- |
| Photo original | `p_<hex>` | JPEG |
| Markup, flattened | `m_<hex>` | JPEG |
| Strokes of a markup or sketch | `k_<same hex as its markup or sketch>` | JSON |
| Sketch, flattened | `s_<hex>` | JPEG |

In the app, files upload straight to private storage under `surveys/<FS id>/<file id>.<ext>` and
are served only to signed-in staff. Upload limits: 5 MB per JPEG, 4 MB per strokes file. A
standalone program should store the same four kinds of file locally (for example as blobs in
IndexedDB) under the same ids.

### 13.6 Order of operations (data safety)

The order MUST be: put the bytes in durable device storage first; then add the reference to the
record with a `pending` slot; then save the record. A file that could not be stored is never added
as a reference. A photo or sketch change saves on its own and never saves the rep's other unsaved
field edits with it.

### 13.7 Earlier photos

Records from before per-section photos hold up to eight inline photos (`photos`: id, name, data
URL). They show read-only as "Earlier photos" and remain the only photos an advisory finding
(chapter 10) can link.

**Source:** `src/lib/ink/model.ts`, `src/lib/ink/backgrounds.ts`, `src/lib/ink/view.ts`,
`src/components/ink/ink-pad.tsx`, `src/lib/field-files/files.ts`,
`src/lib/field-files/file-bytes.ts`,
`src/app/(app)/venue-assessments/[id]/sections/section-photos.tsx`,
`src/app/(app)/venue-assessments/[id]/sections/sketch-tile.tsx`,
`src/app/(app)/venue-assessments/file-actions.ts`, `src/lib/assessments/photo-resize.ts`,
`src/lib/assessments/photo-queue.ts`, `DECISIONS.md` D1208–D1217.

---

## 14. Outputs

### 14.1 Field sheet (PDF)

"Print sheet" builds a PDF of the record **including unsaved edits on screen** (it is not a save).
Title: "<Class> Venue Assessment". Pages:

1. Customer & venue (customer, venue, class, subtype, address, contact, phone, email); Visit brief
   (purpose, reason, assigned to, requested by); **What we heard** (the recap of 11.4).
2. Site & access: loading door type / location / W × H, lift needed and, unless No, lift type,
   working height, who supplies; path to floor, working hours, blackout dates, floor protection,
   badging, first impressions. Then Measurements: the venue class's quick set only (the five
   optional groups are not printed as text).
3. Systems (two pages, two disciplines each). Per discipline: Client goals, Present, scope of
   interest, the fields the editor shows for that class, curtain rows or lighting position rows,
   and Notes. With Present exactly None: goals, Present and scope only.
4. Lineset schedule, when the schedule is in use: one line per set.
5. Project notes: Life safety (only filled rows), Quote & notes (budget, spend-by, decision maker,
   install window, scope of work, quote look, notes), and Older notes.
6. When the Condition & Needs layer is on: Usage profile, Condition ratings, and a Findings page
   per bucket that has findings.
7. Close-out (sign-off), only when a sign-off field holds a value.

Rules

- The sheet is NOT filtered by scope: all four disciplines print.
- Internal tags never print.
- A bound field prints its measurement; a condition prints its word; a month prints as "Mar 2024";
  Console location Other prints "Other: <text>".
- Photos and sketches print on the page of their section (those with no page of their own go on
  Project notes). Only photos of sections the editor currently shows, and sketches of pads the
  editor currently shows, are printed. A marked-up photo prints its markup. Sketches print full
  width with the pad's title.
- Embedded images share a 20 MB budget in page order. A picture that is missing, not a JPEG, or
  past the budget prints as a text row instead; the sheet never fails because of a picture.

### 14.2 Findings text

A plain-text flattening used wherever the record feeds a quote draft:

```
Venue type: …
Reason for visit: …
Scope of work (field): …
Field notes: …
Site conditions: a, b            (legacy chips, if any)
Install timeframe: …
Access/logistics: loading dock: …; elevator: …; floor: …; access door: …; loading door: type, location, W×H; lift: Yes — Scissor >20ft, working height 32' (We supply)
Measurements:
  - <label>: <value>
What we heard:
  - Rigging: New grid, Other: …
    Goal: …
```

Rules: empty lines are dropped. "lift: No" never prints lift details. Measurements print by label,
each key once: the class quick set, then the five groups, applying the Beams rules of 7.3 (drawing
checks print "Yes" only when ticked; no beam measurements when a structural drawing is on file).
"What we heard" lists only disciplines with something captured.

### 14.3 Shared wording rules

All plain-text readers use one set of formatters and MUST show only what the editor shows, plus
Older notes:

- Curtain row: `qty 4 · Velour 25 oz · Standard track · 40' × 22' · Good`. A bare number for W, H
  or length reads as feet; Track series N/A prints nothing; None prints "No track".
- Lighting position row: `Electric 1 · 24 circuits · 40' · trim 22' · notes`.
- Scope: `New grid, Add hoists, Other: <text>`; Other's text counts only while Other is ticked.

**Source:** `src/lib/venue-assessment-sheet.ts`, `src/lib/survey-sheet-pdf-server.ts`,
`src/lib/survey-format.ts`, `src/lib/survey-findings.ts`, `src/lib/survey-migrate.ts`
(`printRecordFor`), `DECISIONS.md` D1030, D1031, D1041, D1217.

---

## 15. Saving, offline outbox and conflict rules

The app is a server application with an offline outbox. A standalone program with one local
database needs far less of this (chapter 18); the rules are recorded so the intent is clear.

### 15.1 Save paths

- **Save changes** sends the whole draft. Online, it goes to the server; the toast reads "Saved to
  the office". Offline, in "Work offline" mode, or when the server has not answered within 15
  seconds, the WHOLE resulting record is put in a durable on-device outbox and the toast reads
  "Saved on this device — will sync when you're back online".
- A stage move saves the same way with the new stage.
- Saves run one at a time, in order.
- Typing while a save is in flight keeps the draft marked unsaved.

### 15.2 Outbox

- One entry per record, holding the whole document and its revision.
- It flushes on reconnect or when "Work offline" is switched off, in size-limited batches.
- Server replies: `ok` (drop the entry), `conflict` (the server's revision is higher: the device
  takes the server copy and the office's edits win; the conflict count is surfaced), `retry` (keep
  and try later; after 10 retries the entry is parked), `error` (parked as refused, shown to the
  user with a retry).

### 15.3 Per-editor save order

Every save carries a stamp: a random id for that open editor and a rising sequence number. The
store remembers the highest sequence applied from each editor and ignores a save that arrives late
after a newer one from the same editor. This is what makes a timed-out save that lands later
harmless.

### 15.4 File merge rules

- A save that changes only photos or sketches sends only the file lists, never the other fields,
  and MUST NOT bump `rev`. So a queued whole-record save made earlier still applies cleanly after
  any number of photo saves.
- Once a file slot is finished (uploaded), nothing a client sends may replace it.
- A client may delete only photos and sketches it has seen. Each save lists the ids the editor has
  seen; a stored photo that is absent from the save and not in that list is kept. This stops one
  device from deleting photos another device added.
- An open editor merges in photos and sketches added elsewhere when it refreshes, without touching
  the rep's unsaved fields.
- Photo uploads retry with back-off and give up after 7 days, after which they are listed as failed
  with Retry and Discard.

### 15.5 Unconfirmed stage moves

While a stage move has not been confirmed by the server, every later save from that editor repeats
the stage, so a field save cannot undo it; the editor stops repeating it once the server shows that
stage or a later one set elsewhere.

**Source:** `src/lib/sync/save.ts`, `src/lib/sync/engine.ts`, `src/lib/sync/save-timeout.ts`,
`src/lib/sync/pull-collections.ts`, `src/lib/field-files/save-stamp.ts`,
`src/lib/field-files/files.ts`, `src/lib/stores/surveys.ts`, `src/app/api/sync/push/route.ts`,
`src/app/(app)/venue-assessments/[id]/controls.tsx`, `AGENTS.md` (phase 6), `DECISIONS.md`
D1212–D1213.

---

## 16. Importing old records (read-time migrations)

Stored records are never rewritten by a migration. Every read runs a chain of pure steps that fills
new keys from old ones and lists whatever cannot be mapped as an "Older note" in a named section.
An importer of exported records MUST apply the same steps, in this order, with these three rules:

- **Never delete a key.** Old keys stay on the record.
- **Fill only a never-answered key.** "Never answered" means the key is absent. An empty string or
  null means the user cleared it, and it MUST stay cleared; the old value then shows as an Older
  note instead.
- **Older notes are derived, never stored.** Recompute them on every read; strip `legacyNotes`
  before any save.

Steps

0. **Basics.** No `stage` → `completed` if `syncState` is `synced`, else `onsite`. No `venueClass`,
   `venueSubtype` or `visitPurpose` → map from the old `venueType` / `visitType`:

   | Old venue type | Class | Subtype |
   | --- | --- | --- |
   | Proscenium theater | theatre | Single proscenium |
   | Black box | theatre | Black box / flexible |
   | Worship / sanctuary | church | Sanctuary — traditional |
   | Gymnasium / gym stage | gym | Multi-purpose (has stage) |
   | Arena | theatre | Thrust / arena |
   | Multipurpose room | convention | Ballroom / multi-purpose |
   | Outdoor / amphitheater | other | (none) |
   | anything else | theatre | (none) |

   | Old visit type | Purpose |
   | --- | --- |
   | Initial site survey, Design verification | New system design |
   | Budgetary walk-through | Bid walk |
   | Punch / follow-up | Punch list |
   | Service call | Repair / service |

   Missing `linesets` → empty list. Missing `linesetsEnabled` → true for theatre and auditorium.
   Missing `lifeSafety`, `signoff`, `assessment` → blank shapes. Missing `assessmentEnabled` →
   false.

1. **Rigging system.** If `disciplines.rigging.present` has values: relabel "Counterweight system"
   → Counterweight, "Dead-hung battens" → Dead-hung, "Motorized rigging" → Motorized, and
   de-duplicate. Otherwise seed it from, in order: the old `measurements.rigType` (Dead-hung,
   Counterweight, Motorized, Hemp, "None existing" → None), the old
   `disciplines.rigging.counterweight` check (→ Counterweight), and old `conditions` chips
   ("Existing rigging — counterweight" → Counterweight, "… — hemp" → Hemp, "Motorized hoists
   present" → Motorized); if more than one is found, drop None. An old rig type the result does
   not carry becomes an Older note under Beams & rigging; an old counterweight check the answer
   does not carry becomes one under Rigging intake.

2. **Installed systems.** For each of `systemsState.lighting / rigging / curtain / av` marked
   `installed: "yes"`: if that discipline's `present` is not yet a list, set it to the first
   Present option for the venue class.

3. **Scope seed.** If `scope` is not a list, set it to the disciplines that already hold data (an
   inventory row, or any non-empty value; a Present of only None does not count). If none, leave it
   unanswered.

4. **Access.**
   - Old `loadingDoorSize` → `loadingDoorLocation` when never answered; otherwise an Older note
     when they differ.
   - Old `liftNeeded`: `liftRequired` becomes `no` for "None needed", else `yes`, when never
     answered. "Scaffold" → `liftType` "Scaffolding" when never answered. Any other old lift kind
     with a blank Lift type is an Older note.
   - Old `liftHeight` is always an Older note.
   - A `liftSupplier` with Lift needed never answered → `liftRequired` `yes`.

5. **Measurement links.** `disciplines.rigging.gridHeight` → `measurements.gridH`, and
   `…loadingGalleryNotes` → `measurements.loadingGallery`, when the measurement was never answered;
   a differing value is an Older note. `linesetQty`, when not a number: the count of rows with a
   whole set number ≥ 1; else the old `disciplines.rigging.linesetCount`, else `battenCount`, when
   a whole number 1–200. Old counts that disagree with the result are an Older note.

6. **Beams drawings.** Old `measurements.brickDrawing` true → `structuralDrawingOnFile` true (when
   never answered), plus an Older note asking which drawing it was until Brick drawing on file is
   answered. Old `measurements.hhSheet` true → `cwElevationOnFile` true (when never answered).

7. **Scope relabels.** Rigging "Grid refurbish" → System refurbish. Curtain "Full masking upgrade"
   → Full curtain replacement; "New main" → Single curtain replacement; "New legs / borders" →
   Single set replacement; "Traveler replacement" → Other, with "Traveler replacement" put at the
   front of the Other text. Lighting "Dimmer upgrade" → Controls upgrade. Curtain Present "Fixed
   pipe" → "Additional general purpose / scenery pipes". De-duplicate, keep order.

8. **Goals.** A goals string becomes a list, one goal per line.

9. **Curtain.**
   - These removed fields become Older notes: masking needed, pipe diameter, mounting, fabric /
     colour, fabric weight, finished width × height, condition, legs & borders, main curtain, track
     series.
   - `legsQtyPairs` → the Legs row's qty; `bordersQty` → the Borders row's qty; `cycScrimFabric` →
     the "Cyc / scrim" row's fabric — only when that Present option is ticked and the target cell
     is blank; otherwise an Older note.
   - `trackOperation`: "sl" / "sr" in any case → upper case. Any other text is copied once to
     `trackOperationOld` and shown as an Older note. The Auditorium `operation` field fills a
     never-answered Track operation when it is SL / SR; otherwise it is an Older note.
   - `lastFlameTest` not already `YYYY-MM`: accepted forms `3/2024`, `03/2024`, `3/17/2024`,
     `2024-03`, `2024-03-17`, `March 2024`, `Mar 2024`. Unreadable text is copied once to
     `lastFlameTestOld` and shown as an Older note.

10. **Lighting.** Removed fields → Older notes: fixture quantity, fixture types, control console,
    FOH positions, lighting positions, circuit accessibility. A free-text `consoleLocation`:
    contains "booth" → Booth; else contains "stage" → Stage; else Other with the text as "Other —
    where?". If the text said more than the one word, it is copied once to `consoleLocationOld` and
    shown as an Older note.

11. **AV condition.** Old `disciplines.av.condition` text that is exactly Bad, Poor, Fair, Good or
    New (any case) → `conditionLevel` 0–4 when never answered. Anything else is an Older note.

12. **Line sets.** A row with no `condition` key takes it from its old code: G 3, F 2, P 1, X 0.

The write-once `…Old` keys exist so an Older note survives the save that stores the new value. A
build older than the list-goals change reads list goals as empty and would delete them on save;
there is no rolling back past that point.

**Source:** `src/lib/survey-migrate.ts`, `src/lib/stores/surveys.ts` (`normalize`),
`src/lib/stores/venue-classes.ts`, `src/lib/field-lists.ts`, `DECISIONS.md` D1022, D1024, D1040,
D1043.

---

## 17. Integration points

### 17.1 Site visits and leads

- A lead's "Request site visit" creates two linked records: a site-visit request and a Venue
  Assessment in stage `requested`, pre-filled with the lead's organisation, contact, phone, email,
  the visit reason, `leadId` and `visitId`. One active visit per lead.
- The site visit is the appointment (claim, time, attendees, invites, calendar). The Venue
  Assessment is the capture record. Meetings and recordings attached to a visit show on its Venue
  Assessment.
- The lead drawer lists the lead's Venue Assessments.
- The Venue Assessments list page shows the open visit-request queue above the records.

### 17.2 Quotes

"Create quote →" marks the record completed, creates a draft system quote with source `survey`
named "<customer> — <venue>" carrying the customer and venue links, and opens it. The record's
client goals can be pulled into the quote's per-discipline "Client goals" ("From site visit"), and
the findings text (14.2) feeds the quote's scope draft.

### 17.3 Other readers

Home, the calendar's "today's jobs" list, global search, company and venue pages and the daily
triage list read Venue Assessments by stage, assignee and scheduled date. Recordings can be
attached to a record and can insert transcribed text into Scope & notes.

### 17.4 Estimate suggestion

For pilot users, "Suggest estimate" reads the SAVED record (it is disabled while there are unsaved
changes) and proposes a parts list. It is a separate, optional, model-backed feature.

### 17.5 Start assessment → Assessments engine

A visit-request row offers "Start assessment →" to staff who may create records. It opens the
Assessments engine's new-assessment form for that visit (chapter 19). It does not create or change
a Venue Assessment; the two records are independent and are linked only through the visit.

**Source:** `src/lib/stores/site-visits.ts`, `src/app/(app)/venue-assessments/visit-requests.tsx`,
`src/app/(app)/venue-assessments/visit-actions.ts`,
`src/app/(app)/venue-assessments/[id]/actions.ts`, `src/lib/estimate-output/goals.ts`,
`src/lib/survey-findings.ts`, `src/lib/sync/today-jobs.ts`,
`src/lib/assessments/integration.ts`, `AGENTS.md` (phases 40, 57, 59).

---

## 18. What a standalone rebuild can drop or must replace

| App behaviour | Standalone equivalent |
| --- | --- |
| Customer / venue directory pick lists | Free-text customer and venue, or a small local list. `customerId` / `locationId` stay null |
| Team roster for Assigned to / assessors | A local list of names |
| Travel auto-fill | Drop (needs address verification and routing) |
| Auto-resolved inspection references | Manual entry only, unless the same program holds flame-test and inspection records |
| Fabric suggestions | Drop, or a local list |
| Server outbox, revisions, save stamps, seen-id merge | One local database; keep only "bytes first, then reference, then save" (13.6) and "a photo save never saves other unsaved edits" |
| Private file storage | Local blobs under the same file ids |
| Field sheet through a server PDF renderer | A print stylesheet with the same pages and rules |
| Leads, visits, quotes, recordings, meetings, suggestion | Drop, or export the findings text for pasting into a quote |
| Settings-backed internal tags and inventory catalog | Editable local lists with the same id and retire rules |

Rules a rebuild MUST keep regardless: unanswered scope filters nothing; hidden never clears; one
value per measurement key; None is exclusive; cleared (null / empty) is not the same as never
answered; internal tags never print; markup never alters the original photo; the migration rules
of chapter 16 for any imported record.

**Source:** this document; `docs/handoff/programs/peak-service.html` (target shape).

---

## 19. The Assessments engine (`AS-####`) — summary

A separate, newer feature: a rule-driven condition assessment of a venue that raises numbered
findings into a register tracked to closure. It shares the photo queue and three pick lists with
Venue Assessments and nothing else. This chapter is a summary; the engine has its own design
document.

### 19.1 Records

| Record | Id | Holds |
| --- | --- | --- |
| Assessment | `AS-####`, server-allocated from 1001 | One visit: visit type, scopes, answers, photos, dismissed prompts, status |
| Finding | key `fd_` + 16 hex (never changes); printed id such as `MPSD-LIN-RIG-003` | One observation, tracked through a lifecycle |
| Venue profile | the venue's id | Carry-forward facts about the building, and an optional next-assessment date |

Assessment status: `draft` → `onsite` (set automatically by the first saved answer) → `completed`
(Mark complete). Reopen (completed → onsite) needs the `approve` permission. A completed assessment
refuses changes.

### 19.2 Definition: scopes, modules, questions

The questions are a versioned definition in code (currently version 1, stamped on each assessment
so an old assessment reads with the definition it was captured with). A meaning-changing edit bumps
the version; wording-only edits do not.

Scopes:

| Code | Title |
| --- | --- |
| S0 | Core (contacts, space profile, documents and history, named photo set) |
| S1 | Facility and house |
| S2 | Rigging |
| S3 | Soft goods |
| S4 | Fire and life safety |
| S5 | Lighting |
| S6 | Audio, video and comms |
| S7 | Access and logistics |
| S8 | Project |

One visit type ships: **Condition assessment**, with S0–S7 on (rigging at "Quick check" depth by
default; the form can switch it to "Full inspection") and S8 off.

Each scope holds modules; each module holds questions and optional photo requirements. A question
has a stable dotted key (for example `rigging.overhead`), a label, and a type: yes/no, pick one,
pick many, number, feet-inches, date, text, long text, contact, or table. A question may be
required, may be a carry-forward venue fact, may be asked on a first visit only, and may carry a
flag that offers a finding when a given value is answered.

Every answer has a state: answered (with a value), not applicable, or unable (with a reason). Each
answer records who and when.

Pick lists are in the definition; an admin can add values to most lists (the rigging depth list is
fixed). A value an admin later retires still validates on stored answers.

### 19.3 Gate rules

Rules are data. Each has an id, a condition, and effects: show modules or questions, skip them
(skip beats show), offer a finding prompt (category, rating, text, optionally requiring a photo),
or raise a notice that is not a finding.

Conditions read answers, venue-profile facts, which scopes are on and at what depth, and the visit
type. They support value-in-list, greater / less than, "older than N days" for dates, "older than N
years" for a year, and the states unable / not applicable / unanswered, combined with all / any /
not. Definitions never read the clock; "now" is passed in.

Rule families and examples:

| Prefix | Area | Example |
| --- | --- | --- |
| R1–R12 | Rigging | R3: overhead rigging is counterweight or mixed → show Counterweight and Wire rope. R9: rigging over 30 years old or age unknown → notice "Capacity cannot be assumed…". R10: last inspection unknown, unable, over 365 days old, or an alteration since → prompt a "Rigging inspection due" finding (RIG, needs attention) |
| F1–F5 | Fire and life safety | F1: fire curtain present → show Fire curtain |
| G1–G4 | Soft goods | G4: flame certificate no or unknown → prompt |
| L1–L9 | Lighting | L7: stage panel present → show it, with the notice "Observe only; never open or test" |
| A1–A9 | Audio / video | A2: sound system present but not fully working → show Sound problems |
| H1–H7 | House | H6: suspected mold or asbestos → prompt (hazardous materials, do not disturb) |
| X1–X5 | Cross-cutting | X2: lift needed → show Lift. X5: any flagged answer offers a finding |

One pure evaluator serves the editor (live), the server (Mark complete) and the report. Given the
definition, scopes, answers, profile, photos, dismissed prompts and already-resolved prompts, it
returns: visible modules and questions, missing required questions, missing required photos, open
prompts, notices, and per-scope progress. It iterates until visibility is stable, and it ignores
the answers of hidden questions without deleting them.

### 19.4 Mark complete

- Photos still uploading are a hard refusal.
- Other gaps — required questions unanswered, required photos missing, prompts neither turned into
  a finding nor dismissed — refuse completion unless the user overrides; the overridden gaps are
  recorded and printed in the report's follow-up section.
- On completion, every visible carry-forward question answered with a value is written to the venue
  profile with the date and the assessment it came from. Only a completed assessment writes the
  profile. The next assessment of that venue pre-fills those questions as "Still true".

### 19.5 Findings

**Categories:** RIG rigging including fire curtain (routed to a Peak rigging inspection); ELC
electrical and control (a qualified electrician; observation only, never marked inspected by
Peak); STR structural / building (engineer or owner; flag only, no rating of structure); HAZ
hazardous materials (environmental specialist; do-not-disturb flag printed); GEN theatrical
general (stays with Peak).

**Ratings:** Immediate attention, Needs attention, Good. The assessor's rating is never
overwritten; a specialist's later rating is stored beside it.

**Immediate attention** findings MUST have: at least one photo, whether the venue's hazard contact
was notified (and when, if so), a lockout state (locked, tagged, none), and a recommended action.

**Lifecycle:** open → triaged → inspected → quoted → scheduled → repaired → verified → closed.
Every move is recorded in a history with who, when and an optional note.

- Forward moves have preconditions: inspected needs a specialist rating; quoted needs at least one
  linked quote; repaired needs a repair date, who did it and the work done; verified needs who and
  when.
- A backward move needs a note saying why.
- A voided finding cannot change status.

**Other fields:** description, location, action tag (out of service, specialist needed, replace,
repair, monitor), qualification needed, priority, budget tier (under $10,000; $10,000–$100,000;
over $100,000), owner, next-due date, linked photos and questions, and the rule that raised it.

**Void, merge, split.** Voiding needs a reason. Merging keeps the first finding, appends the
others' descriptions, unions their photos and questions, and voids the others with "Merged into
<printed id>"; only findings of the same assessment merge, and the kept one must already have its
number. A prompt answered by a merged-away finding stays resolved only while the chain of merges
ends at a live finding. Splitting moves chosen photos and questions to a new finding. Both run as
one all-or-nothing operation.

### 19.6 Printed ids

Format `<company code>-<venue code>-<category>-<number>`, for example `MPSD-LIN-RIG-003`.

- Codes are 2–6 characters, A–Z and 0–9, unique per company and per venue. A company code is
  suggested from the name's initials; a venue code from the first three letters of its first
  meaningful word, with a numeric suffix on collision.
- The number is at least three digits and is one above the highest ever issued for that venue and
  category under that printed prefix. The server MUST allocate it, one at a time. A device working
  offline shows `MPSD-LIN-RIG-…` until the finding syncs.
- A voided or merged finding's number is never reused.
- A printed id keeps its text if the codes change later. Once a live finding prints a code,
  changing that code needs the `approve` permission.
- The category is fixed once the number is issued.

### 19.7 Register, quoting, reminders

- The findings register lists findings across venues with filters (company, venue, category,
  rating, status, priority, budget tier, open only, include voided), sorted Immediate → Needs → Good, then priority; it exports CSV and a
  findings-only PDF per venue or company.
- "Quote these findings" opens a repair quote pre-filled for the venue, or creates a draft system
  estimate; the quote carries the finding keys and each line names the printed id. Findings are
  linked to the quote on its first save; only findings of the quote's own customer and venue link.
- A finding's next-due date and a venue's next-assessment date each raise one reminder task 30
  days ahead, replaced if the date moves.

### 19.8 Report

A seven-section report, on screen and as a PDF: Facility and visit; Scope and exclusions; Summary;
Observations by scope (one sub-section per scope run, with its notices, answers and photos);
Findings register; Follow-up (overridden gaps, documents to request, findings due); Photo
appendix.

- Section 2 always carries the line: "Structure and building electrical are flagged for an
  engineer or electrician and are not rated (ANSI E1.47 excludes them)."
- Answers print as their labels; not applicable prints "N/A"; unable prints "Unable to inspect —
  <reason>".
- The register lists live findings only; a merged finding appears through the one it was merged
  into.
- Photos are embedded up to a 20 MB budget; beyond it they print as placeholders with a note.
- "Email report" stores the PDF and attaches it to a draft email; it is never sent automatically.

### 19.9 Offline

An assessment MUST be started online (the server allocates its id); after that the editor works
offline. Answers merge per question — the newest answer wins, ties keep the server's. Anything a
sync could not apply (an invalid answer, a change to a completed assessment) is kept and shown to
the user with "Re-enter" or "Use mine", never dropped silently.

**Source:** `src/lib/assessments/defs/index.ts`, `src/lib/assessments/defs/types.ts`,
`src/lib/assessments/defs/rules.ts`, `src/lib/assessments/defs/picklists.ts`,
`src/lib/assessments/defs/scopes/`, `src/lib/assessments/evaluate.ts`,
`src/lib/assessments/answers.ts`, `src/lib/assessments/findings-model.ts`,
`src/lib/assessments/codes.ts`, `src/lib/assessments/register.ts`,
`src/lib/assessments/report-model.ts`, `src/lib/assessments/quote-from-findings.ts`,
`src/lib/assessments/reminders.ts`, `src/lib/stores/assessments.ts`,
`src/lib/stores/findings.ts`, `src/lib/stores/venue-profiles.ts`,
`docs/superpowers/specs/2026-10-13-assessments-engine-design.md`, `AGENTS.md` (phase 59).

---

## 20. Not verified, and things the JSON cannot express

### 20.1 Not verified

These were taken from project notes, decision titles or code comments and not traced end to end.

1. The first id on an empty store. The base is 1053; whether the first record is `FS-1053` or
   `FS-1054` was not checked.
2. Photo JPEG quality and the exact shrink behaviour (only the 1,600 px edge, the 25 MB refusal and
   the HEIC message were read).
3. The 7-day upload give-up and the back-off schedule (stated in comments).
4. The 3D preview's drawing rules, beyond which archetype is chosen, and "wireframe by default"
   (from the decision title).
5. Exact dimension layouts of the generated pad backgrounds (only their structure was read).
6. The fabric suggestion source and the automatic inspection-reference lookup
   (`venue-assessment-certs.ts` was not opened).
7. Where Venue Assessments appear on Home, calendar, search, company pages and triage (from project
   notes).
8. Recordings: how inserted text is appended to Scope & notes.
9. The list page's card layout and KPI details beyond the filters and counts described.
10. The CSV template's example header names three `measure_*_ft` columns; the importer stores any
    `measure_<key>` column under `<key>`, so those land under keys (`length_ft`, …) that no editor
    field shows. This looks like a latent mismatch and was not investigated.
11. Chapter 19 is a summary: individual questions, most rules' exact conditions, the editor's
    screens, the sync-reject UI and the report's layout were not traced. The five "added flag
    prompts" awaiting the owner's confirmation (project notes) were not identified.
12. iPad + stylus behaviour of the ink pad on real hardware (project notes say the owner's device
    test was still pending when this was written).

### 20.2 Things the JSON expresses only approximately

1. **Customer and venue pickers.** Their behaviour (auto-fill of address and contact, "new
   customer" and "other venue" states) is described in `help` text, not as rules.
2. **Per-class fields.** The quick measurement set, the subtype list, the Kill-question width and
   depth inputs and the curtain Present list are emitted once per venue class with a `venueClass`
   rule, so the same storage path appears several times with different labels.
3. **"Present is exactly None".** Written as `eq: ["None"]`. The code compares case-insensitively
   and requires exactly one item.
4. **Scope unanswered.** Written as "not truthy". Precisely: unanswered also when the list holds
   only unrecognised keys.
5. **The kill-question lock** is in `enabledWhen` on the four discipline sections, not
   `visibleWhen`.
6. **Bound fields** (Grid height, Loading gallery notes) appear in the Rigging section with their
   `measurements.*` path.
7. **Inventories** share one `inventory` array; each field carries a `rowFilter`.
8. **Rows keyed by label** (curtain rows, lighting positions, condition ratings, inspection
   references) use `storage: "mapByKey"` with a `rowKeys` description; some keys contain dots.
9. **Client goals** are `rows` with `storage: "string[]"`; the 20-row and 1,000-character limits
   are in `help`.
10. **Line set tools** (quantity plan, Fill down, Mark range spare, removal rules) and the advisory
    findings tools (seed, merge, split) are in `help` text only.
11. **Computed fields** (checklist, intake status, recap, totals, 3D preview, the structural
    drawing note, older site conditions) have `path: null` or are read-only; their rules are in
    `help` and in this document.
12. **Section photos** are a `photos: true` flag per section, not a field; the storage shape is in
    `recordFields` and chapter 13.
13. **Line set sheet pages 2–7** are described on the one `sketches.linesetSheet` field.
14. **Options from live data** (customers, venues, roster, internal tags, inventory catalog) are
    `{ "source": … }` objects; built-in defaults are in `lists` where they exist.
15. **Measurement inputs** are typed `feetInches` but are free text; several are descriptive, not
    dimensions (listed in the JSON's `conventions`).
16. **Older notes** per section are not fields; see chapter 16.
