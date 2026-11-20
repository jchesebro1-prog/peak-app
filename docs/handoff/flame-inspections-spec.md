# Flame Tests and Rigging Inspections — functional specification (handoff)

Status: written 2026-11-19 from the code in this repository, for a team that will rebuild these two
modules as a standalone, offline, single-file HTML program. The modules are being spun out of the
staff application ("Quartzite").

How to read this document

- It describes behaviour, not implementation. Where a rule is stated as "MUST", the current code
  enforces it and a rebuild should too.
- "Peak" means the business that owns the app (Peak Systems Group, a theatrical rigging and drapery
  contractor). "Staff" means signed-in team members. "Customer" means a company in the CRM.
  "Venue" means one of a customer's physical locations (a theatre, a gym stage, a room).
- Every section ends with a **Source** line listing the repository files it was derived from.
  Paths are relative to the repository root.
- All numbers stated as defaults were read from the code. Every one of them is editable by staff at
  run time (section 4.1), so production values may differ. Ask the owner for the live values.
- "Not verified" means the behaviour was taken from project notes or a code comment, or was only
  partly read. Section 12 collects all of these.
- Where project documentation and code disagree, the code is described and the disagreement is
  noted (section 11).

Contents

1. Purpose, users and vocabulary
2. Data model — flame tests
3. Data model — rigging inspections
4. Pricing: shared rules (rates, markup, rounding, typed total, lift)
5. Pricing: flame-test engine
6. Pricing: inspection engine
7. Travel (drive, flights, shared trip)
8. Screens
9. Renewals
10. Documents (letters, reports, certificate)
11. Integration points the standalone program loses, known defects, and disagreements
12. Not verified

---

## 1. Purpose, users and vocabulary

### 1.1 What the two modules do

Both modules run the same business loop for a recurring compliance service:

1. Staff build an auto-priced **quote** for a customer and one or more of its venues.
2. The quote is approved. Approval creates the work record(s).
3. A dispatcher gives each work record a date and a technician.
4. The technician visits, and records what was found.
5. The app produces customer documents (letter, summary, certificate or report).
6. Completing the work starts a renewal clock. When the next visit comes due, the venue appears on
   a renewal worklist, and staff can produce next year's quote and a renewal email in one click.

**Flame Tests** covers annual field flame testing of stage curtains and other soft goods under
NFPA 705. The customer-facing name of the service is "Field Flame Inspection"; the standard's own
name and the phrase "field flame test" are kept verbatim on compliance records.

**Rigging Inspections** covers inspection of stage rigging (counterweight line sets, fire curtain,
catwalks, track, dead-hung equipment). The deliverable is a multi-page report of ranked findings.

Neither module uses AI. Every price and every generated sentence comes from fixed rules.

### 1.2 Users

| Role | What they do here |
| --- | --- |
| Estimator / office | Builds and approves quotes, runs the renewal worklist, prints documents |
| Dispatcher | Uses the scheduler to assign a date and technician |
| Technician / inspector | Logs flame results on site; fills in the inspection capture editor on site, possibly offline |
| Administrator | Edits rates (Estimating Rules) and document wording (Templates) |

Every screen and action requires a signed-in staff member. Inside these modules there is no finer
permission check, with one exception: applying a rewards credit to a quote needs the `create`
permission (section 11.1).

### 1.3 Vocabulary

| Term | Meaning |
| --- | --- |
| Quote | A priced offer. A record in the shared quotes collection with `quoteType` `flame_test` or `inspection` and a service sub-document holding the pricing detail |
| Flame job ("job") | The work record for one approved flame-test quote. One job covers every venue on the quote |
| Inspection record ("record") | The work record for one inspection of one venue. One approved inspection quote creates one record per venue |
| Venue | A customer location. Has an id, a label, city, state, optional coordinates, and optional stored one-way travel miles and minutes from the office |
| Curtain | The unit of flame-test work. The quote and results count curtains per venue |
| Line set | The unit of inspection work used for pricing. The quote counts line sets per venue |
| Level 1 (L1) | Annual visual inspection of every accessible rigging component. Renewal cadence: 1 year |
| Level 2 (L2) | In-depth inspection with wear measurement and load-path review. Renewal cadence: 5 years. Priced as Level 1 time × a multiplier |
| Log / finding | One issue recorded in an inspection, with a severity and an open/closed status |
| Rubric | The fixed component checklist an inspector rates NA / Good / Fair / Poor |
| IFR | "Inherently flame retardant" — goods that are flame resistant by fibre, with no topical treatment |
| Office | A Peak location in settings. One office is flagged as the default quote origin; travel is measured from it |
| Markup | Percentage on cost. `sell = cost × (1 + markup)`. Stored as a fraction (0.43 = 43%) |

**Source:** `src/lib/stores/flame-jobs.ts`, `src/lib/stores/inspections.ts`,
`src/lib/flametest-engine.ts`, `src/lib/inspection-engine.ts`, `src/lib/markup/index.ts`,
`src/app/(app)/flame-tests/letter/letter-view.tsx`, `AGENTS.md` (phases 4, 15, 18, 20, 67).

---

## 2. Data model — flame tests

All timestamps are epoch milliseconds. Dates entered by a person are ISO strings `YYYY-MM-DD`, with
`""` meaning unset. Date strings are interpreted in the device's local time zone.

### 2.1 Flame-test quote

A flame-test quote is a record in the shared quotes collection. The fields these modules read or
write:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Internal quote id (format owned by the quotes collection) |
| estimate number | string | A display number from a shared counter starting at 1001, with a type prefix (`FLM` for flame tests). Shown on documents as "Document" / "Work Order" |
| `name` | string | Default `"<first venue label> — Flame Test <year>"`; with several venues `"<first venue> + N venue(s) — Flame Test <year>"` in the builder |
| `customer`, `customerId` | string, string\|null | Display name and link |
| `locationId` | string\|null | The first selected venue |
| `value` | number | The price the customer pays (whole dollars; net of any rewards credit) |
| `margin` | number | The effective markup of the saved price: `(total − cost) ÷ cost` |
| `pricingTier`, `tierMargin` | string, number | The customer tier in force at save and its service markup |
| `source` | string | `"flametest"`; a quote generated in the customer portal keeps `"portal-service"` |
| `quoteType` | string | `"flame_test"` |
| `status` | string | `draft` → `sent` → `won` or `lost` |
| `owner` | string | Staff name, set when the quote is created and never changed by a later save |
| `contact` | object\|null | `{ name, role, email }` — the person the letter is addressed to |
| `renewalOf` | string | Set on a renewal quote: the id of the flame job it renews |
| `createdAt`, `updatedAt` | number | |
| `flameTest` | object | The service sub-document, below |

`flameTest` sub-document:

| Field | Type | Meaning |
| --- | --- | --- |
| `rates` | object | Snapshot of the rates the quote was priced with (section 4.1), with `margin` set to this quote's markup |
| `office` | string | Name (or id) of the origin office |
| `origin` | object\|null | `{ name, street, city, state, zip }` of the origin office |
| `venues[]` | array | `{ id, label, curtains, testingCost, testingOverride? }`. `testingCost` is the whole-dollar testing cost used; `testingOverride` is present only when staff typed one |
| `curtainsTotal` | number | Sum of curtains |
| `trip` | object | `{ miles, minutes, mileageCost, timeCost, method, mode, flight? }` (section 7.5). Dollar fields are rounded to whole dollars when saved |
| `travel` | object | Optional per-quote travel override `{ mode?, crew?, nights?, airfarePerPerson? }` |
| `rawCost` | number | Travel + testing before the base-fee floor |
| `baseFee`, `baseApplied` | number, boolean | The floor and whether it set the cost |
| `lift` | object | Optional `{ count, rate, cost, line }` |
| `cost` | number | Whole-job cost |
| `marginAmount` | number | `total − cost` |
| `autoTotal` | number | The rounded rule-based total |
| `priceOverride` | number | Present only when staff typed a total |
| `priceOverrideSeeded` | boolean | Present only when the typed total is a carried-over legacy price nobody typed (section 4.5) |
| `total` | number | The price before any rewards credit |
| `rewardCredit` | number | Optional; see section 11.1 |
| `contact` | object\|null | Copy of the quote contact |

### 2.2 Flame job

Id format: `FT-` + a number allocated from base 3000, so the first new job is `FT-3001` or later
(seed data occupies 3001–3008).

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `FT-####` |
| `quoteId` | string\|null | The approved quote this job came from; null for a hand-made job |
| `customer` | string | Display name, copied at creation |
| `customerId` | string\|null | Canonical customer link |
| `locationId` | string\|null | The quote's venue, else the first venue |
| `venue` | string | Label of the first venue |
| `value` | number | The quote's value at creation |
| `curtainsTotal` | number | From the quote, else the sum over venues |
| `contact` | object\|null | `{ name?, role?, email?, phone? }` |
| `venues[]` | array | `{ id, label, city, state, lat, lng, curtains }`. City, state and coordinates are copied from the customer's location at creation |
| `stage` | string | `approved` \| `scheduled` \| `completed` |
| `assignedTo` | string | Technician name, `""` when unassigned |
| `approvedAt` | number | When the job was created |
| `scheduledDate` | string | ISO date or `""` |
| `completedAt` | number\|null | When the test was performed |
| `dueAt` | number\|null | `completedAt + 365 days`; null until completed |
| `results` | object\|null | Below |
| `renewalOutreach` | object\|null | `{ at, by }` — staff contacted the customer about this cycle's renewal |
| `owner` | string | From the quote's owner; falls back to the literal `"Jeff Chesebro"` |
| `createdAt`, `updatedAt` | number | |

`results`:

| Field | Type | Meaning |
| --- | --- | --- |
| `overall` | string | `pass` \| `partial` \| `fail` |
| `cert` | string | Certificate number, free text (placeholder `FT-2026-000`). Not generated and not checked for uniqueness |
| `performedBy` | string | Technician name |
| `method` | string | Always the literal `"Field flame test per NFPA 705"` |
| `venues[]` | array | `{ id, label, tested, passed, failed, retreated, treatment, notes }` |
| `notes` | string | Free text |

Per-venue result rules (enforced on save):

- `tested`, `passed`, `retreated` are non-negative integers typed by the technician.
- `failed` is always derived: `max(0, tested − passed − retreated)`. It is never typed.
- `treatment` is the literal `"Re-treated on site"` when `retreated > 0`, else `"Passed field test"`.
- `notes` per venue is always saved as `""`; only the job-level notes field is editable.
- There is no check that `passed + retreated ≤ tested`.

The `retreated` field is labelled **IFR** on every screen and document. Section 11.3 explains the
conflict between the field name and its label; a rebuild should settle it with the owner.

### 2.3 Flame job lifecycle

```
(quote: draft/sent)  ──approve──▶  approved  ──schedule──▶  scheduled  ──log results──▶  completed
                                      ▲                         │                           │
                                      └───────unschedule────────┘        ◀──reopen (no UI)──┘
```

| Transition | Who / what | Effect |
| --- | --- | --- |
| Quote → job | The quote reaching status `won` (section 2.4) | Creates the job at `approved` |
| `approved` → `scheduled` | Dispatcher, scheduler dialog. A date is required | Sets `scheduledDate`, `assignedTo`, stage |
| `scheduled` → `scheduled` | Dispatcher, "Edit" in the scheduler | Changes date and/or technician |
| `scheduled` → `approved` | Dispatcher, "Unschedule". Only allowed from `scheduled` | Clears `scheduledDate`. `assignedTo` is kept |
| any → `completed` | Technician, results form. Needs a date and at least one curtain tested. The form does not check the current stage, so an `approved` job that was never scheduled can be completed | Sets `completedAt` (the date typed, at local midnight), `dueAt = completedAt + 365 days`, `results`; sets `assignedTo` to the performer; clears `renewalOutreach` |
| `completed` → `completed` | Technician, "Update results" | Same as above; recomputes `dueAt` from the new date |
| `completed` → `scheduled` | A store function and server action exist ("reopen": clears `completedAt` and `dueAt`). No screen calls it | — |
| any → deleted | Staff, Delete on the results screen (two-step confirm) | Soft delete. If the job was `scheduled`, its calendar hold is removed first |

### 2.4 Creating a job from a quote

- A job is created when a flame-test quote reaches status `won`. That happens when staff press
  "Mark as approved" in the builder, when the quote is marked Won elsewhere (the shared Quotes
  list), or when staff approve a quote the customer accepted in the portal.
- Creation MUST be idempotent per quote: if a job (live or deleted) already exists for the quote,
  none is created. A deleted job counts, so deleting a job does not cause it to reappear.
- Creation re-reads the quote first. It proceeds only if the quote still exists, is a flame-test
  quote, and is still `won`.
- The flame dashboard and the scheduler each run a repair sweep on load: every `won` flame-test
  quote with no job gets one. A quote that fails is skipped and logged; the page still renders.
- A flame job does not create a linked project record (inspections do; section 3.5).

**Source:** `src/lib/stores/flame-jobs.ts`, `src/app/(app)/flame-tests/actions.ts`,
`src/app/(app)/flame-tests/quote/actions.ts`, `src/app/(app)/flame-tests/page.tsx`,
`src/app/(app)/flame-tests/scheduling/page.tsx`, `src/lib/stores/quotes.ts`.

---

## 3. Data model — rigging inspections

### 3.1 Inspection quote

Same shared quote fields as section 2.1, with `quoteType: "inspection"`, `source: "inspection"`
(or `"portal-service"`), estimate-number prefix `RIG`, and default name
`"<customer> — Level <n> inspection"`. A renewal quote is named
by the renewal flow instead (section 9.4).

`inspection` sub-document:

| Field | Type | Meaning |
| --- | --- | --- |
| `rates` | object | Snapshot of the rates used, with this quote's markup |
| `office` | string | Origin office name |
| `level` | number | 1 or 2. Anything else is treated as 1 |
| `scope` | string | Free-text scope notes typed in the builder |
| `venues[]` | array | `{ id, label, lineSets }` |
| `lineSetsTotal` | number | |
| `inspectHours` | number | Billed inspection hours (rounded to 0.1) |
| `baseHours`, `levelMult` | number | The base hours and level multiplier used |
| `trip`, `travel` | object | As for flame tests |
| `laborCost` | number | Whole dollars |
| `cost` | number | Labour + travel + lift |
| `minFee`, `minApplied` | number, boolean | The minimum fee and whether it set the price |
| `lift`, `marginAmount`, `autoTotal`, `priceOverride`, `priceOverrideSeeded`, `total`, `rewardCredit`, `contact` | | As for flame tests |

### 3.2 Inspection record

Id format: `RI-` + a number allocated from base 2041.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `RI-####`. Printed as "Report No." |
| `quoteId` | string\|null | The approved quote, or null for a direct request |
| `projectId` | string\|null | Optional. A lightweight project record created with the records of one quote (section 11.1) |
| `level` | number | 1 or 2. Drives the renewal cadence |
| `lineSets` | number | From the quote. Informational after creation |
| `value` | number | This venue's share of the quote value |
| `customer`, `customerId` | string, string\|null | |
| `locationId` | string\|null | The venue |
| `venue` | string | Venue label |
| `venueType` | string | One of the venue types in section 3.3. Default: the first |
| `address` | string | `"street, city, state, zip"` built at creation, or typed |
| `contact`, `contactPhone`, `contactEmail` | string | On-site contact |
| `surveyDate` | string | ISO date the inspection was performed. Anchors renewals |
| `reportDate` | string | ISO date the report was issued |
| `inspector` | string | Staff name |
| `condition` | string | `good` \| `fair` \| `poor` \| `failing`. Default `fair` |
| `scope` | string | What was inspected |
| `narrative` | string | Overall condition summary |
| `logs[]` | array | Findings (section 3.4) |
| `rubric[]` | array | Component checklist (section 3.3). Empty until loaded |
| `venueInfo` | map string→string | Venue facts and system summary, by field key |
| `measurements` | map string→string | Stage measurements, by field key. Free text |
| `priorInspectionId`, `priorSurveyDate` | string\|null, string | Link to an earlier inspection |
| `stage` | string | `requested` \| `scheduled` \| `onsite` \| `completed` |
| `assignedTo`, `scheduledDate` | string | Dispatcher assignment |
| `requestedBy`, `requestedAt` | string, number | |
| `renewalOutreach` | object\|null | `{ at, by }` |
| `owner` | string | Falls back to the literal `"Jeff Chesebro"` |
| `createdAt`, `updatedAt` | number | |
| `syncState`, `syncedAt`, `rev` | | Offline-sync bookkeeping carried on the document |

### 3.3 Fixed lists

Venue types: Proscenium theater · Black box · Worship / sanctuary · Gymnasium / gym stage · Arena ·
Multipurpose room · Outdoor / amphitheater.

Condition ratings: `good` "Good condition" · `fair` "Fair condition" · `poor` "Poor condition" ·
`failing` "Failing / unsafe".

Severities:

| Key | Label | Long label | Definition printed to the customer |
| --- | --- | --- | --- |
| `urgent` | Urgent | Urgent Repair | "A repair that requires immediate fixing — one that poses a danger until repaired." |
| `necessary` | Necessary | Necessary Repair | "A repair that should be dealt with in the next few months — one that, if left alone, may pose a threat." |
| `basic` | Basic | Basic Improvement | "A way to improve the venue's efficiency and safety." |

Levels:

| Key | Label | Long label | Years | Description |
| --- | --- | --- | --- | --- |
| 1 | Level 1 | Level 1 — annual | 1 | "Visual inspection of every accessible rigging component, performed every year." |
| 2 | Level 2 | Level 2 — every 5 years | 5 | "In-depth inspection with wear measurement and load-path review, performed every five years." |

Venue facts (`venueInfo` keys): `yearBuilt` "Built / equipment installed" · `currentUse`
"Current use" · `ownerConcerns` "Owner concerns" (multi-line).

System and equipment (`venueInfo` keys): `riggingType` Rigging type · `lineSets` Line sets ·
`liftLines` Lift lines · `manufacturer` Manufacturer · `electrics` Electrics · `fireCurtain` Fire
curtain · `curtainTrack` Curtain & track · `orchestraShell` Orchestra shell · `deadHung` Dead-hung
rigging · `pitLift` Orchestra pit / lift.

Measurements (`measurements` keys), in three groups:

- Stage dimensions: `proW` Proscenium width · `proH` Proscenium height · `depth` Stage depth · PL
  to back wall · `apron` Apron · PL to edge · `srW` Stage-right wing · `slW` Stage-left wing.
- Heights & section: `steel` Height to steel · `grid` Gridiron height · `houseH` Stage house height
  · `pit` Orchestra pit depth · `deck` Deck / traps.
- FOH positions & beams: `beam1` 1st beam · from plaster line · `beam2` 2nd beam · `beam3` 3rd beam
  · `beamSpacing` Beam spacing · `loadingBridge` Loading bridge.

Rubric. Fifteen sections in two groups. Each item is rated `na` | `good` | `fair` | `poor`, or left
unrated (null). Items are lettered A, B, C… within a section.

Group "Counterweight Rigging System & Components":

| # | Section | Items |
| --- | --- | --- |
| 1 | Loft Block | Mounting assembly (clips & bolts); Housing (side plates / base angles); Sheave (casting); Bearing / shaft; Alignment / fleet angle |
| 2 | Wire Rope / Terminations | Wire rope; Terminations; Adjustment devices; Alignment / fleet angle; Clamps |
| 3 | Head Block | Mounting assembly (clips & bolts); Housing (side plates / base angles); Sheaves (casting); Bearing / shaft; Alignment / fleet angle |
| 4 | Counterweight Arbor | Arbor top; Arbor bottom; Arbor rods; Back bone; Spreader plates; Locking collars; Guides / shoes |
| 5 | Counterweights | Counterweight |
| 6 | Rope Lock | Housing; Jaws; Handle; Attachment; Adjustment |
| 7 | Hand Line | Hand line |
| 8 | Tension Block | Housing; Sheave; Bearings / shaft; Guides / shoes; Attachment |
| 9 | Battens | Battens; Splices |
| 10 | Locking Rail | Fasteners; Stanchions; Rail |
| 11 | Arbor Guide System | Tees; Wall batten; Wall knee; Arbor stops; Fasteners; U-clips; Wire arbor guides |
| 12 | CWT Electrics | SO power cable; Connector strip; Cable management; Safety cables |
| 13 | CWT Other Components | Acoustic ceiling system; Loading bridge level; Access ladders |

Group "Curtain & Track Elements":

| # | Section | Items |
| --- | --- | --- |
| 1 | Curtain | Condition; Flame retardants (NFPA 701 test); Travelers; Borders; Legs; Scrims; Grand valance; Cyclorama; Blackout |
| 2 | Track | Tracks; Track hardware; Components; Curtain machine |

A rubric section as stored: `{ key, group, n, title, items[{ l, label, rating }], comments, lineSet,
photo }`. `key` is `"<group index>-<section index>"` (for example `"0-3"`). `lineSet` is free text
("12", "ALL"). `photo` is an image or null.

Issue library. Twenty-nine ready-made findings, each `{ cat, severity, problem, explanation,
solution, standards[] }`, in nine categories: Fall protection (5), Hardware (4), Wire rope (5),
Fire curtain (3), Operation (2), Structure (2), Loading (1), Rigging (4), General (3). The full
text is in `ISSUE_LIBRARY` in the source file and should be copied verbatim; it is too long to
reproduce here and includes the cited standards (OSHA 1910.28(b), OSHA 1910.21(b), ANSI E1.4-1,
ANSI E1.22, NFPA 701).

### 3.4 Log (finding)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | number | Display number 1..n, reassigned whenever logs are renumbered |
| `seq` | number | Creation timestamp; keeps order stable within a severity |
| `svid` | string | A random 5-digit display id, `30000`–`39998`. Not unique-checked |
| `severity` | string | `urgent` \| `necessary` \| `basic`. Default `necessary` |
| `status` | string | `open` \| `closed`. Default `open` |
| `problem` | string | Short title |
| `explanation` | string | What is wrong and why it matters |
| `solution` | string | Recommended fix (shown while the log is open) |
| `workPerformed` | string | What was done (shown instead of `solution` once the log is closed) |
| `location` | string | Where in the venue |
| `standards[]` | string[] | Cited standards; edited as a comma-separated list |
| `beforePhoto`, `afterPhoto` | image\|null | |
| `firstNoted` | string | ISO date the issue was first recorded (set on carried-forward logs) |
| `estHours`, `estCost` | number\|null | Stored, never edited or shown by any screen read |
| `carried` | boolean | Set on logs pulled forward from a prior report |
| `rubricRefs[]` | array | `{ key, idx, label, section, rating }` — the rubric items this finding was made from |

Rules

- Logs MUST be renumbered whenever one is added, removed, or has its severity changed: sort by
  severity (urgent, necessary, basic), then by `seq`; assign `id` 1..n in that order. Editing any
  other field does not renumber.
- Counts are derived, never stored: per severity `{ open, closed }`, plus overall open, closed and
  total. A log counts as open unless `status` is exactly `closed`.
- Photos are resized in the browser before storing: longest side at most 1200 px, JPEG quality
  0.72, embedded in the record as a data URL. If resizing fails the original is stored.

Findings from the rubric

- Severity mapping: a `poor` rating makes an **Urgent** finding; `fair` makes a **Necessary** one.
- "From Poor" / "From Fair": for every rubric section that has at least one item with that rating
  not already referenced by an existing log, create one finding for the section.
  - `problem` = section title, plus `" — <item label, lower case>"` when exactly one item.
  - `explanation` = `"Rated <Poor|Fair> during the component condition walkthrough. Affected:
    <item labels, lower case, comma-separated><" — " + section comments, if any>."`
  - `location` = `"Line set <lineSet>"` when the section has one, else the section title.
  - `solution` empty, `standards` empty, status open.
- "Create finding from selection": the inspector ticks any Fair or Poor items not already covered
  and makes one finding from all of them. Any Poor item makes it Urgent, otherwise Necessary.
  - `problem` = the section title (plus the item label when one item) if all items are in one
    section, else `"Multiple components require attention"`.
  - `explanation` = `"Rated <Poor|Fair> during the component condition walkthrough. Affected
    components: <per section: "Title (item, item) — comments">; … ."`
  - `location` = `"Line set <distinct line sets, comma-separated>"`, else the single section
    title, else empty.
- An item referenced by any log's `rubricRefs` is "covered": it cannot be selected again and is
  skipped by the bulk actions.

### 3.5 Inspection record lifecycle

```
quote won ─┐
           ├─▶ requested ─▶ scheduled ─▶ onsite ─▶ completed
direct ────┘       ▲            │
request            └─unschedule─┘
```

| Transition | Who / what | Effect |
| --- | --- | --- |
| Quote → record(s) | The quote reaching `won` | One `requested` record per quoted venue (rules below) |
| Direct request | Staff, "+ Direct request" on the dashboard | A blank `requested` record owned by the user; opens the capture editor |
| `requested` → `scheduled` | Dispatcher (scheduler dialog; a date is required), or "Schedule →" in the capture editor (no date required there) | Scheduler sets `assignedTo`, `scheduledDate`, stage. The editor only changes the stage |
| `scheduled` → `requested` | Dispatcher, "Unschedule" | Clears `scheduledDate` **and** `assignedTo`. The action does not check the current stage |
| `scheduled` → `onsite` | Inspector, "Start on-site →" in the editor | Stage only |
| `onsite` → `completed` | Inspector, "Mark complete →" in the editor | Stage; if `reportDate` is blank it is set to today |
| any → any | The editor's save sends `stage` with the rest of the draft, and the stage-advance action accepts any target. The screen only offers the next stage | — |
| any → deleted | Staff, "Delete this inspection" in the editor (two-step confirm) | Soft delete |

There is no reopen control. A completed record stays editable in the capture editor.

Unlike flame jobs, completing an inspection does not clear `renewalOutreach` and does not stamp a
due date. The due date is always computed from the survey date (section 9.1).

Creating records from a quote

- One record per venue in the quote's `inspection.venues`. If the quote lists no venues, one record
  is made for the quote's own `locationId`.
- `value` is split evenly: `share = round(quote value ÷ venue count)`; every venue gets `share`
  except the first, which gets `value − share × (count − 1)` so the parts sum to the whole.
- Copied: level, line-set count, customer, venue label and id, address (from the customer's
  location), contact name / phone / email, owner (also used as `requestedBy`).
- `scope` = the quote's scope notes; when blank,
  `"<Level long label> rigging inspection — N line sets."` (or `"… rigging inspection."` with no
  line sets).
- The same idempotency rules as flame jobs apply (section 2.4): a quote that already produced
  records, live or deleted, produces no more; the quote is re-read and must still be `won`.
- The dashboard and the scheduler each run the same repair sweep on load.
- One lightweight project record is created per quote and its id stored on every record
  (section 11.1).

Carry-forward (exists in the data layer; no screen calls it). Creates a new record at stage
`scheduled` from a prior one, copying customer, venue, contact, condition and scope, and copying
every **open** log as a new open log with `carried: true` and `firstNoted` = the earlier
`firstNoted`, else the prior survey date. Sets `priorInspectionId` and `priorSurveyDate`.

**Source:** `src/lib/stores/inspections.ts`, `src/app/(app)/inspections/actions.ts`,
`src/app/(app)/inspections/[id]/actions.ts`, `src/app/(app)/inspections/[id]/controls.tsx`,
`src/app/(app)/inspections/quote/actions.ts`, `DECISIONS.md` (D53, D54).

---

## 4. Pricing: shared rules

### 4.1 Rates and where they live

Rates are global settings, edited on the "Estimating Rules" screen, in four groups. A change takes
effect on the next quote priced or re-saved. Saved quotes keep their stored price until someone
re-saves them. Each saved quote stores a snapshot of the rates it used.

Flame-test pricing

| Key | Label | Default | Unit | Editor range / step |
| --- | --- | --- | --- | --- |
| `mileageRate` | Mileage rate | 1 | $/mile | 0–2 / 0.01 |
| `laborRate` | Labor rate (testing & travel) | 75 | $/hour | 0–200 / 1 |
| `curtainMinutes` | Minutes to test one curtain | 5 | minutes | 1–30 / 1 |
| `baseFee` | Base minimum (whole job) | 150 | $ | 0–1000 / 5 |
| `margin` | Flame-test markup | 0.43 (43%) | fraction | 0–150% / 1 |
| `travelRoundMin` | Round travel time up to | 15 | minutes | 1–60 / 1 |
| `flyCrew` | Crew when the trip flies | 1 | people | 1–10 / 1 |

Inspection pricing

| Key | Label | Default | Unit | Editor range / step |
| --- | --- | --- | --- | --- |
| `laborRate` | Labor rate (inspection & travel) | 75 | $/hour | 0–300 / 1 |
| `mileageRate` | Mileage rate | 1 | $/mile | 0–2 / 0.01 |
| `lineSetMinutes` | Minutes to inspect one line set | 15 | minutes | 1–120 / 1 |
| `baseHours` | Base on-site hours (per visit) | 2 | hours | 0–16 / 0.5 |
| `level2Mult` | Level 2 (5-year) × | 1.75 | multiplier | 1–4 / 0.05 |
| `minFee` | Minimum inspection fee | 650 | $ | 0–5000 / 25 |
| `margin` | Inspection markup | 0.43 (43%) | fraction | 0–150% / 1 |
| `travelRoundMin` | Round travel time up to | 15 | minutes | 1–60 / 1 |
| `flyCrew` | Crew when the trip flies | 1 | people | 1–10 / 1 |

The Estimating Rules screen itself calls the inspection numbers "Placeholder numbers — adjust as
pricing firms up."

Travel & mileage (shared by both services)

| Key | Label | Default | Unit | Editor range / step |
| --- | --- | --- | --- | --- |
| `roadFactor` | Straight-line → road factor | 1.25 | multiplier | 1–2 / 0.05 |
| `mph` | Assumed average speed | 50 | mph | 20–75 / 1 |
| `flyThreshold` | Fly when one trip's drive cost reaches | 1000 | $ | 0–20000 / 50 |
| `airfarePerPerson` | Airfare allowance (round trip, per person) | 450 | $ | 0–5000 / 10 |
| `hotelPerNight` | Hotel (per room per night) | 140 | $ | 0–1000 / 5 |
| `perDiemPerDay` | Per diem (per person per day) | 70 | $ | 0–500 / 5 |
| `carPerDay` | Rental car (per car per day, 1 car per 2 people) | 75 | $ | 0–500 / 5 |
| `flyTravelHoursEachWay` | Travel-day labor (hours each way, per person) | 4 | hours | 0–24 / 0.5 |
| `flyHoursPerDay` | On-site hours per person per day | 8 | hours | 1–24 / 0.5 |

Lift rental: default rate **$750** per rental when the catalog has no live `EQP-LIFT` row;
otherwise that row's cost, rounded to whole dollars.

Two rates are also editable inside each quote builder, under "Rates & assumptions": the mileage
rate and the labour rate. Saving the quote writes them back to the **global** rates. Every later
quote is affected. The markup is the exception: it is per quote (section 4.2).

### 4.2 Markup

- Every pricing percentage is markup on cost: `sell = cost × (1 + markup)`. The back-solved figure
  is `markup = (sell − cost) ÷ cost`, defined only when cost is positive (shown as 0 otherwise).
- The app previously used margin on price (`sell = cost ÷ (1 − margin)`). The stored field is still
  named `margin`; it now holds markup. Conversion, should a rebuild import old data, is
  `markup = margin ÷ (1 − margin)`. The old 30% margin (42.857% markup) was rounded to **43%**.
  A stored 0.428571 and a rounded 0.43 are treated as the same rate ("same whole percent").
- The markup of a quote is chosen in this order:
  1. the value on the builder's markup slider, when posted — clamped on the server to **5%–100%**;
  2. otherwise the customer's tier markup, when the contact or the company has its own tier;
  3. otherwise the service's own default markup from the rates above.
- The slider's own range is **10–100**, step 1. When a customer or contact is picked, an untouched
  slider follows the new tier; a slider the user has moved is kept, and the new tier's value is
  offered as a one-click prompt.
- A markup of 0 or less sells at cost.

### 4.3 Rounding to $25

- The rule-based ("auto") total is rounded to the nearest $25. Exactly half rounds up ($862.50 →
  $875).
- When a floor set the price (flame base fee, inspection minimum fee), the total MUST round **up**
  to the next $25, so rounding can never take the price below the floor. An exact multiple stays
  as it is.
- A typed total is never rounded.

### 4.4 Typed total and the back-solved markup

- The builder's Total is an input. A typed figure replaces the auto total exactly.
- Accepted: whole dollars from $1 to $10,000,000. Input is stripped of `$`, commas and spaces and
  must then be plain digits with an optional decimal part; it is rounded to whole dollars. Hex,
  exponent notation and negative numbers are rejected. A rejected or blank value means "no typed
  total".
- With a typed total, the markup shown is back-solved: `(total − cost) ÷ cost`. The slider moves to
  that value clamped to its 10–100 range; the number beside it shows the true figure to one
  decimal.
- Moving the slider, or pressing "Reset to auto", clears the typed total. Changing the customer
  clears it. Changing the contact does not.
- Warnings, never blocks: "Below cost" when the total is under cost; "Low markup" when cost is
  positive and the back-solved markup is under **11%**.
- The server clamp of section 4.2 does not apply to a typed total.

### 4.5 Reopening an older quote

- A saved quote reopens with its own saved markup, never re-seeded from the tier.
- A quote past draft whose saved value is not a multiple of $25 (saved before rounding existed)
  reopens with that value as a typed total, so re-saving does not silently change a price the
  customer has seen. The saved quote is flagged `priceOverrideSeeded`. The flag MUST be derived on
  the server from the stored quote, not accepted from the browser, and MUST survive later saves.
  Its only use: next year's renewal email must not call such a price "hand-set" (section 9.4).
- A quote past draft that has no saved travel choice reopens with travel forced to Drive
  (section 7.3).

### 4.6 Lift rental (optional)

- Inputs: number of rentals (whole number 1–50; blank or 0 = none) and a rate per rental (whole
  dollars 0–100,000; blank = the default rate).
- `liftCost = count × rate`. The lift is marked up at the quote's markup:
  `liftSell = liftCost × (1 + markup)`.
- The lift is added **on top of** the floor. It is never absorbed by the base fee or minimum fee
  (sections 5.1, 6.1).
- Printed as its own line, "Lift rental" or "Lift rental ×N". Amount: `liftSell` in whole dollars,
  capped at the total.
- Saved as `{ count, rate, cost, line }`.

### 4.7 Printed component lines always sum to the total

Customer documents print one all-in price. When a document also shows the flight-mode travel line
(section 7.6), its amount is travel's proportional share of the final price:
`round(flightTotal × total ÷ cost)`, clamped to 0…total. The remainder is the service part. For old
quotes with no stored cost the fallback is `round(flightTotal × (1 + markup))`.

**Source:** `src/lib/stores/pricing.ts`, `src/lib/service-pricing.ts`, `src/lib/markup/index.ts`,
`src/lib/markup/settings.ts`, `src/lib/pricing-tiers.ts`, `src/lib/service-quote-inputs.ts`,
`src/app/(app)/flame-tests/quote/actions.ts`, `src/app/(app)/flame-tests/quote/controls.tsx`,
`src/app/(app)/flame-tests/quote/page.tsx`, `DECISIONS.md` (D363–D366, D1286).

---

## 5. Pricing: flame-test engine

### 5.1 Formula

Inputs: the origin office, the selected venues in the order listed (each with a curtain count and an
optional typed testing cost), the rates, an optional travel override, an optional lift, an optional
typed total.

```
per venue:
  curtains       = max(0, round(curtain count))
  computedCost   = curtains × curtainMinutes × (laborRate ÷ 60)
  testingCost    = typed testing cost if given, else computedCost

testingSubtotal  = Σ testingCost
travel           = one shared trip for all venues (section 7)
rawCost          = travel + testingSubtotal
baseApplied      = rawCost < baseFee
cost             = (baseApplied ? baseFee : rawCost) + liftCost
totalRaw         = cost × (1 + markup)
autoTotal        = baseApplied ? round UP to $25 : round to nearest $25
total            = typed total if given, else autoTotal
marginAmount     = total − cost
effectiveMarkup  = (total − cost) ÷ cost
```

Points to preserve

- The base fee is a floor on the **cost of the whole job**, applied before markup. It is not a
  per-venue or per-curtain charge.
- Testing cost is not rounded per venue; only the final total is rounded.
- A typed per-venue testing cost is whole dollars, 0 to 10,000,000. $0 is valid and means free.
  Blank means computed. It is normalised when the field loses focus, not on each keystroke.
- On-site hours passed to the travel planner are `curtainsTotal × curtainMinutes ÷ 60`, from the
  curtain counts, ignoring any typed testing cost.

### 5.2 Worked example — two venues, drive

Rates at defaults. Customer has two venues in the same town. Neither has coordinates on file, so
the trip uses the stored one-way estimates: Main House 80 mi / 96 min, Studio Stage 82 mi / 98 min.
Main House has 14 curtains, Studio Stage 6.

| Step | Calculation | Result |
| --- | --- | --- |
| Farthest venue | Studio Stage, 82 mi / 98 min one way | |
| Round-trip miles | 82 × 2 | 164 mi |
| Round-trip minutes | 98 × 2 = 196, rounded up to 15 | 210 min |
| Mileage | 164 × $1 | $164.00 |
| Travel time | 210 ÷ 60 × $75 | $262.50 |
| Trip (shared once) | | $426.50 |
| Main House testing | 14 × 5 min × $1.25 | $87.50 |
| Studio Stage testing | 6 × 5 min × $1.25 | $37.50 |
| Raw cost | 426.50 + 125.00 | $551.50 |
| Base fee | 551.50 ≥ 150, not applied | |
| Cost | | $551.50 |
| × 1.43 | | $788.645 |
| Rounded to nearest $25 | | **$800** |
| Markup amount | 800 − 551.50 | $248.50 |
| Effective markup | 248.50 ÷ 551.50 | 45.1% |

The drive cost $426.50 is under the $1,000 threshold, so the trip drives.

If staff type a total of $750: total = $750, markup amount $198.50, effective markup 36.0%, slider
shown at 36. No warning.

### 5.3 Worked example — base fee

Four curtains, venue 5 mi / 6 min away.

| Step | Calculation | Result |
| --- | --- | --- |
| Mileage | 10 × $1 | $10.00 |
| Travel time | 12 min → 15 min; 0.25 h × $75 | $18.75 |
| Testing | 4 × 5 min × $1.25 | $25.00 |
| Raw cost | | $53.75 |
| Base fee applied | 53.75 < 150 | cost = $150.00 |
| × 1.43 | | $214.50 |
| Floor applied, so round **up** | | **$225** |

The builder shows: "Raised to the $150 base minimum — travel + testing came to $54."

**Source:** `src/lib/flametest-engine.ts`, `src/lib/service-pricing.ts`,
`src/app/(app)/flame-tests/quote/controls.tsx`.

---

## 6. Pricing: inspection engine

### 6.1 Formula

Inputs: origin office, selected venues (each with a line-set count), level, rates, optional travel
override, optional lift, optional typed total.

```
lineSetsTotal    = Σ max(0, round(line sets))
levelMult        = level 2 ? level2Mult : 1          (a missing or zero multiplier is treated as 1)
inspectHoursRaw  = baseHours + lineSetsTotal × lineSetMinutes ÷ 60
inspectHours     = round(inspectHoursRaw × levelMult, to 1 decimal)
laborCost        = inspectHours × laborRate
travel           = one shared trip for all venues (section 7)
serviceCost      = laborCost + travel
sellRaw          = serviceCost × (1 + markup)
minApplied       = sellRaw < minFee
totalRaw         = (minApplied ? minFee : sellRaw) + liftCost × (1 + markup)
autoTotal        = minApplied ? round UP to $25 : round to nearest $25
total            = typed total if given, else autoTotal
cost             = serviceCost + liftCost
effectiveMarkup  = (total − cost) ÷ cost
```

Differences from the flame engine that a rebuild MUST keep

- The minimum fee is a floor on the **sell price** (after markup), not on cost. The flame base fee
  is a floor on cost (before markup).
- Base hours are charged once per quote, however many venues it covers.
- The level multiplier applies to all inspection time, base hours included.
- Inspection hours are rounded to one decimal before pricing.
- There is no per-venue typed cost. The builder shows a per-venue labour figure
  (`lineSets × lineSetMinutes ÷ 60 × levelMult × laborRate`) and a separate "Base visit" row
  (`baseHours × levelMult × laborRate`); these are display only and, because of the 0.1-hour
  rounding, may differ from the priced labour by a few dollars.
- On-site hours passed to the travel planner are `inspectHours`.

### 6.2 Worked example — Level 1 and Level 2

One venue, 24 line sets, 80 mi / 96 min one way, default rates.

| Step | Level 1 | Level 2 |
| --- | --- | --- |
| Raw hours | 2 + 24 × 15 ÷ 60 = 8.0 | 8.0 |
| × level multiplier | 8.0 | 8.0 × 1.75 = 14.0 |
| Labour | 8.0 × $75 = $600.00 | 14.0 × $75 = $1,050.00 |
| Mileage | 160 × $1 = $160.00 | $160.00 |
| Travel time | 192 min → 195 min; 3.25 h × $75 = $243.75 | $243.75 |
| Service cost | $1,003.75 | $1,453.75 |
| × 1.43 | $1,435.36 | $2,078.86 |
| Minimum fee $650 | not applied | not applied |
| Rounded to nearest $25 | **$1,425** | **$2,075** |
| Effective markup | 42.0% | 42.7% |

### 6.3 Worked example — minimum fee

One venue, 4 line sets, Level 1, 5 mi / 6 min away.

| Step | Calculation | Result |
| --- | --- | --- |
| Hours | 2 + 4 × 15 ÷ 60 | 3.0 |
| Labour | 3.0 × $75 | $225.00 |
| Travel | $10.00 + $18.75 | $28.75 |
| Service cost | | $253.75 |
| × 1.43 | | $362.86 |
| Minimum fee applied | 362.86 < 650 | $650 |
| Round up to $25 | already a multiple | **$650** |

With one lift rental at $750: lift sells at 750 × 1.43 = $1,072.50; total = 650 + 1,072.50 =
$1,722.50, rounded up to **$1,725**; the lift line prints $1,073.

**Source:** `src/lib/inspection-engine.ts`, `src/lib/service-pricing.ts`,
`src/lib/repair-engine.ts` (shared trip math), `src/app/(app)/inspections/quote/controls.tsx`,
`src/app/(app)/inspections/quote/actions.ts`.

---

## 7. Travel

### 7.1 The shared trip

Travel is priced **once per quote**, for the whole route, and shared by every venue on it. It is
never charged per venue. The origin is the office flagged as the default quote origin, else the
first office in settings.

Two ways of measuring the route:

**Route method** — used when the office and every selected venue have coordinates.

- The route is office → venue 1 → venue 2 → … → venue n → office, in the order the venues are
  listed. The order is not optimised.
- Each leg: straight-line (great-circle) miles using an earth radius of 3,958.8 miles, multiplied by
  `roadFactor`, **rounded to whole miles**. Leg minutes = `round(legMiles ÷ mph × 60)`.
- Miles and minutes are summed over the legs.

**Estimate method** — used when the office or any venue lacks coordinates.

- Take the venue with the greatest stored one-way miles. Trip miles = that × 2. Trip minutes = that
  venue's stored one-way minutes × 2. Other venues add nothing.
- If no venue has stored miles, travel is 0.

Then, for either method:

```
billedMinutes = total minutes rounded UP to the next travelRoundMin (15)
mileageCost   = miles × mileageRate
timeCost      = billedMinutes ÷ 60 × laborRate
driveTotal    = mileageCost + timeCost
```

Rounding is applied once to the whole trip, not per leg.

The builder shows each venue's stored one-way miles ("~82 mi one-way") as a hint. When coordinates
are present the price uses the route method, so the hint and the priced miles can differ.

### 7.2 Fly instead of drive

Rule: when one trip's `driveTotal` is **at or above** `flyThreshold` (default $1,000), the trip is
priced as flights instead. A threshold of 0 means never fly automatically.

```
crew        = quote override, else the service's flyCrew (flame 1, inspection 1), minimum 1
workDays    = max(1, ceil(onSiteHours ÷ (crew × flyHoursPerDay)))
nights      = quote override, else workDays
tripDays    = nights + 1
airfare     = crew × (quote override airfare, else airfarePerPerson)
lodging     = crew × nights × hotelPerNight
perDiem     = crew × tripDays × perDiemPerDay
car         = ceil(crew ÷ 2) × tripDays × carPerDay
travelHours = crew × flyTravelHoursEachWay × 2
travelLabor = travelHours × laborRate
flightTotal = airfare + lodging + perDiem + car + travelLabor
```

- In fly mode the travel figure fed to the engine is `flightTotal`. Mileage and drive time are not
  charged.
- In drive mode the travel figure is `driveTotal`, unchanged.
- The work-days division is rounded to six decimals before the ceiling, so floating-point noise
  cannot add a day.
- Travel labour uses the service's ordinary labour rate.

### 7.3 Auto · Drive · Fly override

Each quote has a three-way choice, default **Auto**.

| Choice | Effect |
| --- | --- |
| Auto | Apply the threshold rule |
| Drive | Always drive, whatever the cost |
| Fly | Always fly, whatever the cost |

In fly mode three optional inputs appear, each blank by default with the default shown as the
placeholder: crew (whole number ≥ 1), nights (whole number ≥ 0), airfare per person (≥ 0).

- When Auto switches to flights the builder shows: "Drive would be $X — over the $Y threshold,
  priced as flights."
- The drive figures stay visible in the builder, muted, when the trip is priced as flights.
- The override is saved on the quote as `travel` only when something is set. Auto with no inputs
  saves nothing.
- A quote past draft with no saved travel choice and no saved trip mode predates this feature. It
  MUST reopen as Drive, not Auto, so it cannot silently re-price as flights.

### 7.4 Worked example — flights

Flame test, one venue, 20 curtains, 450 mi / 540 min one way, default rates.

| Step | Calculation | Result |
| --- | --- | --- |
| Drive mileage | 900 × $1 | $900.00 |
| Drive time | 1,080 min (already a multiple of 15) = 18 h × $75 | $1,350.00 |
| Drive total | | $2,250.00 — at or above $1,000, so fly |
| Crew | default | 1 |
| On-site hours | 20 × 5 ÷ 60 | 1.67 h |
| Work days | ceil(1.67 ÷ 8) | 1 |
| Nights / trip days | | 1 / 2 |
| Airfare | 1 × $450 | $450 |
| Lodging | 1 × 1 × $140 | $140 |
| Per diem | 1 × 2 × $70 | $140 |
| Car | ceil(1 ÷ 2) × 2 × $75 | $150 |
| Travel labour | 1 × 4 × 2 = 8 h × $75 | $600 |
| Flight total | | $1,480 |
| Testing | 20 × 5 min × $1.25 | $125 |
| Cost | | $1,605 |
| × 1.43, rounded | $2,295.15 | **$2,300** |
| Printed travel line | round(1,480 × 2,300 ÷ 1,605) | $2,121 |

Forced to Drive, the same job would be (2,250 + 125) × 1.43 = $3,396.25 → $3,400.

### 7.5 What is saved

The quote's `trip` block: `miles`, `minutes` (billed), `mileageCost`, `timeCost` (whole dollars),
`method` (`route` or `estimate`), `mode` (`drive` or `fly`), and in fly mode `flight`
`{ crew, workDays, nights, tripDays, airfare, lodging, perDiem, car, travelHours, travelLabor,
total }` with dollar fields rounded. The drive numbers are always saved, even in fly mode.

### 7.6 What the customer sees

- Drive mode: the proposal's scope table has a row "Round-trip site mobilization from <office
  city>", showing round-trip miles and hours. No dollar figure.
- Fly mode: that row is replaced by one line, **"Travel (air, lodging & per diem)"**, with a dollar
  amount (section 4.7) and the travel-day hours. The itemised airfare, lodging, per diem, car and
  labour are never shown to the customer.

**Source:** `src/lib/travel-plan.ts`, `src/lib/flametest-engine.ts`, `src/lib/repair-engine.ts`,
`src/lib/geo.ts`, `src/lib/service-quote-inputs.ts`, `src/components/travel-mode-panel.tsx`,
`src/app/(app)/flame-tests/quote/page.tsx`, `DECISIONS.md` (D281–D286).

---

## 8. Screens

Route paths are given so the rebuild team can find the source. Paths under `/inbox`, `/quotes`,
`/field-work` and `/estimator` belong to other modules.

### 8.1 Flame tests dashboard — `/flame-tests`

On load: runs the repair sweep (section 2.4).

Header: title; a subtitle "N flame tests tracked · M due for annual renewal" (or "all current on
the annual cycle"); three buttons — "Log results · N" (N = scheduled jobs dated today or earlier;
opens the day view, section 8.3), "Scheduler →", "+ New flame test" (opens the quote builder).

KPI strip, four tiles:

| Tile | Value | Sub-line |
| --- | --- | --- |
| Active tests | approved + scheduled | "N scheduled · M to schedule" |
| Awaiting schedule | approved | "accepted, no date yet" |
| Due for renewal | renewal rows that are overdue or due soon | "N overdue · M due soon", or "within 60 days" |
| Completed | jobs completed in the last 365 days | "last 12 months" |

Renewals panel: section 9.2.

All flame tests list. Rows are (a) every flame-test quote in `draft` or `sent` with no job, shown
with status **Quoted**, and (b) every job. Columns: customer and a sub-line (quote name, or venue ·
curtain count); status; value; last updated (relative). Filter chips with counts: All, Quoted,
Approved, Scheduled, Completed. Sorted by last update, newest first. Row click: a quoted row opens
the builder; an approved job opens the scheduler; a scheduled or completed job opens results entry.
Completed rows also have a "Report ›" link.

Map: one pin per job with coordinates (the first venue that has them), coloured by stage. Three
status toggles (Completed, Scheduled, Approved) with counts hide or show pins. Venues due for
renewal in the selected window are ringed. Pins are matched to renewal rows by coordinates rounded
to three decimals.

By-status bars: Quoted, Approved, Scheduled, Completed, Passed (completed with overall `pass`),
Overdue (renewals).

All filter, window, view and map state is held in the URL query string.

### 8.2 Flame test scheduler — `/flame-tests/scheduling`

On load: runs the repair sweep.

- "To schedule": every `approved` job — customer, venue · curtains · value, and a **Schedule**
  button.
- "Scheduled": every `scheduled` job, earliest date first. A date tile, customer, a relative label
  ("3d overdue", "today", "tomorrow", "in 5d", or a date from 14 days out), technician initials and
  name, venue. Buttons: **Edit**, **Log results**.
- Map: approved (amber) and scheduled (blue) pins.

Schedule dialog. Fields: visit date (required; default the existing date, else today + 7 days) and
technician (active staff, or "Unassigned"; default the existing technician, else the first staff
member). Actions: "Schedule visit" / "Save"; "Unschedule" (edit mode only); Cancel. Under the date
field an availability note checks the venue's own event calendar for a clash (section 11.1).

### 8.3 Day-of "Log results"

The dedicated day sheet no longer exists. `/flame-tests/today` redirects to the general Field Work
day view, which lists the day's flame tests, inspections, repairs and install work together, each
linking to its own entry screen. A standalone rebuild needs its own "today" list: scheduled jobs
dated today or earlier (earlier ones flagged overdue), each with a Log-results link.

### 8.4 Flame results entry — `/flame-tests/results?job=<id>`

Shows: stage, customer, venue · curtain count, scheduled date, assigned technician. For a completed
job: links to the Results letter, Summary letter and Report. A Delete button (two-step).

Form

| Field | Rule |
| --- | --- |
| Date performed | Required. Default: the completed date, else the scheduled date, else today |
| Performed by | Technician select. Default: previous performer, else the assigned technician |
| Certificate # | Free text |
| Per venue: Tested, Passed, IFR | Non-negative integers. With no results yet, Tested and Passed default to the venue's curtain count and IFR to 0 |
| Per venue: Failed | Read-only, `max(0, tested − passed − IFR)` |
| Overall result | Passed / Passed with re-treatment / Failed |
| Notes | Free text |

- Suggested overall: `fail` if any venue has failed > 0; else `partial` if any venue has IFR > 0;
  else `pass`. The select follows the suggestion until the user changes it; after that the user's
  choice is kept. On a saved job the select starts as "touched".
- Save is enabled only when the date is set and total tested > 0. The server repeats both checks
  and silently does nothing when they fail.
- Button label: "Complete & log results", or "Update results" for a completed job.
- A note states: "On save, this test is marked complete and its annual renewal is set for <date>."
- After saving online: the page reloads with "Results logged · renews <date>" and links to the
  dashboard and the report.
- Offline: the completed job document is queued on the device and the message "Saved on this
  device — will sync when you're back online" is shown.

### 8.5 Flame quote builder — `/flame-tests/quote`

Opens blank, or with `?id=<quote>` to edit, or `?customer=<id>` to start for a customer (optionally
with a venue pre-selected).

Left column

- **Customer** — searchable picker over the customer directory. Picking a customer: turns on its
  primary venue (or its only venue, or the first), selects its primary contact, re-seeds the
  markup, clears the typed total, and regenerates the quote name unless the user has typed one.
- **Quote name** — free text.
- **Contact** — one of the customer's contacts, "No contact — TBD", or "Other — enter name…".
  The contact is who the letter is addressed to.
- **Venues** — every venue of the customer, each with an include toggle, city/state and one-way
  miles, a **Curtains** count, and a **Testing** dollar cell (blank = computed; the placeholder
  shows the computed figure). Typing a count or a testing figure turns the venue on.
- A footnote states the rules: travel charged once and shared; minutes per curtain; the base
  minimum.

Right column (breakdown)

- Quote total, with "N venues · M curtains".
- Trip travel "shared once": mileage (miles × rate) and travel time (duration × rate).
- The Auto · Drive · Fly control and, in fly mode, crew / nights / airfare.
- Testing per venue, marked "set" where a testing cost was typed.
- Lift rental inputs.
- Cost subtotal, and the base-minimum note when the floor applied.
- Markup: percentage, dollar amount, slider.
- Total input with "Reset to auto" and the warnings of section 4.4.
- "Rates & assumptions" (collapsed): mileage rate and labour rate inputs, with a summary line.

Actions

| Action | Rule |
| --- | --- |
| Save quote / Update quote | Enabled with a customer and at least one venue selected. The server re-prices from its own data; the browser's figures are a preview only |
| Mark as approved | Shown until the quote is approved. Saves, then sets the quote to `won`, which creates the job |
| Delete | Shown for a saved quote |
| Proposal PDF / letter | Shown once saved; opens the proposal letter (section 10.1) |
| Change type | Shown for a saved quote; replaces a draft with a quote of another type |

Validation and rules

- The server MUST re-price every save from the customer's stored venue data and the stored rates.
  It trusts only: the venue selection and counts, typed testing costs, the markup, the two rate
  inputs, the travel override, the lift, and the typed total.
- A save with no customer or no venues does nothing.
- Editing the customer, a venue toggle or the contact on a quote that is already `won` asks for
  confirmation first.
- After approval the builder shows "Accepted — now an approved flame-test job, ready to schedule."
  with a link to the scheduler.
- If saving or approving fails, the builder reopens with an error message.

### 8.6 Inspections dashboard — `/inspections`

Same layout as the flame dashboard, with these differences.

Header buttons: "+ Direct request" (creates a blank requested record and opens it), "Scheduler →",
"+ New inspection quote". Subtitle: "N inspections tracked · M due for renewal (L1 annual · L2
five-year) · K urgent open".

| Tile | Value | Sub-line |
| --- | --- | --- |
| Active inspections | requested + scheduled + on-site | "N scheduled · M on-site · K to schedule" |
| Awaiting schedule | requested | "requested, no date yet" |
| Due for renewal | overdue + due soon | as flame |
| Urgent open | open Urgent logs across all records | "across all sites" |

List rows: open inspection quotes (status Quoted; sub-line quote name · level · line sets) and
every record (sub-line venue · level · "N open · M urgent" when it has logs, else line sets).
Filter chips: All, Quoted, Requested, Scheduled, On-site, Completed. A requested record opens the
scheduler; others open the capture editor.

Map pins use the venue's coordinates looked up from the customer directory. By-status bars: Quoted,
Requested, Scheduled, On-site, Completed, Overdue renewals.

### 8.7 Inspection scheduler — `/inspections/scheduling`

- "To schedule": every `requested` record — customer, level, venue · line sets · value · "from
  <quote number>". Buttons: **Brief** (opens the capture editor) and **Schedule**.
- Agenda: `scheduled` and `onsite` records by date. On-site rows show an "On-site" chip in place of
  the relative date and have no Edit button. Every row has "Open capture".
- Map: requested (amber), scheduled (blue), on-site (purple).
- Schedule dialog: as for flame tests, with an inspector in place of a technician.

### 8.8 Inspection quote builder — `/inspections/quote`

As the flame builder (section 8.5), with these differences.

- Opens with `?level=1|2` to preset the level (used by renewals).
- A **Level** selector: Level 1 — annual / Level 2 — every 5 years, each with its description.
- **Scope notes** — free text, saved as the quote's scope and copied to the records.
- Venues take a **Line sets** count. There is no per-venue cost cell.
- Breakdown: "Base visit · 2 hrs setup & write-up", then a labour row per venue, then cost
  subtotal, markup, total. A note appears when the minimum fee applied.
- After approval: "Accepted — now a requested inspection, ready to schedule."

### 8.9 Inspection capture editor — `/inspections/<id>`

One long form that holds a local draft. Nothing is saved until the user presses Save or a stage
button. A pill shows "Unsaved changes" or "Saved".

Header: back link; title "<customer> — <venue>"; record id and last-updated time; links to the
Report, Results letter and Summary letter (shown when the record has at least one log or is
completed); "Save changes"; a four-step stage indicator; one stage button (section 3.5).

Sections, in order:

1. **Customer & venue.** Customer (directory select, or "+ New customer (not in directory)" with a
   typed name); venue (the customer's venues, or "Other venue…" with a typed name); venue type;
   site address; on-site contact; contact phone. Picking a customer fills the venue, and fills the
   address and contact only when those fields are empty.
2. **Inspection details.** Survey date (defaults to the scheduled date); inspector (defaults to the
   assigned person); prior survey date; report date (shown only once completed); scope of
   inspection; condition narrative.
3. **Venue information & measurements.** Collapsible groups — Venue facts, System & equipment, and
   the three measurement groups — each showing "filled/total" and "Complete" or "N left". All
   fields are free text.
4. **Component condition rubric.** Empty until the user presses "Load standard rubric · 15
   sections". Each section expands to its lettered items, each with NA / Good / Fair / Poor
   buttons (pressing the active rating clears it), plus Comments, Line set #, and a photo. Tools:
   Poor and Fair filters (show only items with that rating), Expand all, Collapse all, Clear
   (removes the whole rubric). A summary reads "rated/total rated · N poor · M fair". Fair and Poor
   items not yet covered by a finding have a tick box; with any ticked, a bar offers "Create
   finding" and "Clear".
5. **Findings.** Buttons: "+ From Poor · N", "+ From Fair · N" (N = uncovered items), "From
   library", "Blank". Each finding is a collapsible card with: Problem; Level of problem
   (severity); Ticket status (open / closed); Location in venue; Standards cited; Explanation of
   problem; Recommended solution — or, once closed, Work performed; Before photo; After photo;
   Remove. Under the solution field up to four "Suggested recommendations" are offered; tapping one
   appends it. Suggestions are the library's solution texts ranked by how many words (longer than
   three letters) of the finding's problem and explanation appear in the library entry; with no
   match the first three are shown.
6. **Overall assessment.** The condition rating, which is the report's headline.
7. **Delete this inspection** (two-step confirm).

Issue library dialog: search box (matches problem, explanation, category), category filter, and an
Add button per entry. Adding copies the entry's severity, problem, explanation, solution and
standards into a new open finding.

Validation: saving or changing stage requires a customer name and a venue name; otherwise an error
is shown and nothing is saved. Nothing else is required.

Saving: online, "Saved to the office". Offline, the whole record is queued on the device:
"Saved on this device — will sync when you're back online". A queued save sends the whole
document, so the last write wins.

### 8.10 Inspection report — `/inspections/<id>/report`

A print view of letter-size sheets (section 10.5). Toolbar:

- Layout: **Report** (default) / **Field dossier** / **Compact**.
- Three section toggles, all on by default: **Standards** (the boilerplate pages), **Closed**
  (closed logs), **Rubric**.
- "Renovation quote" — creates a new system quote for the same customer and venue, named
  "<customer> — <venue> renovation", and opens it in the Estimator (another module).
- Print.

### 8.11 Report-options canvases

Two internal comparison pages. They show one sample record in each layout side by side so the owner
can choose a default. They are not part of the working flow and need not be rebuilt.

- `/flame-tests/report/options`: a two-venue sample in the three flame variants, labelled 1a
  Letter, 1b Summary, 1c Certificate.
- `/inspections/report/options`: a demo inspection in the three layouts, labelled 3a / 3b / 3c.
  The first is described as "Color-coded, one finding per page · default".

**Source:** `src/app/(app)/flame-tests/page.tsx`, `src/app/(app)/flame-tests/controls.tsx`,
`src/app/(app)/flame-tests/scheduling/page.tsx`, `src/app/(app)/flame-tests/scheduling/controls.tsx`,
`src/app/(app)/flame-tests/today/page.tsx`, `src/app/(app)/flame-tests/results/page.tsx`,
`src/app/(app)/flame-tests/results/controls.tsx`, `src/app/(app)/flame-tests/actions.ts`,
`src/app/(app)/flame-tests/quote/page.tsx`, `src/app/(app)/flame-tests/quote/controls.tsx`,
`src/app/(app)/flame-tests/quote/actions.ts`, `src/app/(app)/flame-tests/report/options/page.tsx`,
`src/app/(app)/inspections/page.tsx`, `src/app/(app)/inspections/scheduling/page.tsx`,
`src/app/(app)/inspections/quote/controls.tsx`, `src/app/(app)/inspections/quote/actions.ts`,
`src/app/(app)/inspections/[id]/page.tsx`, `src/app/(app)/inspections/[id]/controls.tsx`,
`src/app/(app)/inspections/[id]/actions.ts`, `src/app/(app)/inspections/[id]/report/page.tsx`,
`src/app/(app)/inspections/report/options/page.tsx`.

---

## 9. Renewals

### 9.1 Due dates

A "year" is exactly 365 days throughout. Leap days are ignored.

| Service | Anchor | Due date |
| --- | --- | --- |
| Flame test | `completedAt` (the date performed) | Anchor + 365 days. Stored as `dueAt` at completion; recomputed from the anchor when missing |
| Inspection Level 1 | `surveyDate`; if blank `reportDate`; if blank `updatedAt` | Anchor + 365 days |
| Inspection Level 2 | Same | Anchor + 5 × 365 = 1,825 days |

Only completed work has a due date.

Renewal state, from `days = due date − now`:

| State | Condition | Label |
| --- | --- | --- |
| `overdue` | due date has passed | "N days overdue" ("due today" at 0) |
| `due_soon` | due within 60 days | "due in N days" |
| `upcoming` | due within 120 days | "due in N days" |
| `ok` | later than that | "on schedule" |
| `none` | not completed | — |

The 60-day lead is a fixed constant, the same for both services. Day counts are rounded to the
nearest whole day.

### 9.2 Which records are on the renewal list

- Flame tests: the **latest completed job per customer + venue**. The key is the customer id (else
  name) and the job's `locationId` (else venue label). A multi-venue job is tracked under its first
  venue only.
- Inspections: the **latest completed record per customer + venue + level**. Level 1 and Level 2
  are tracked independently for the same venue; neither hides the other.
- An earlier record for the same key drops off the list as soon as a later one is completed.
- Sorted soonest due first.

### 9.3 Renewals panel (both dashboards)

- Window chips: **−30d**, **+30d**, **+60d** (default), **+90d**, each with a count. A window
  shows every renewal whose due date is on or before today + that many days. All overdue renewals
  are therefore included in the positive windows; −30d shows those overdue by more than 30 days.
- Two views: **To contact** (no outreach stamp; the default) and **Reached out — awaiting**.
- Each row: customer, state badge and label, venue, "last tested <date>" or "last inspected
  <date>", and for inspections the level. Clicking the row opens last year's results (flame) or
  last report (inspection).
- Row actions in To contact:
  - **✉** — one-click renewal outreach (section 9.4).
  - **✓ Reached out** — stamps `renewalOutreach = { at: now, by: user }` (for outreach made by
    phone). Only allowed on a completed record.
  - **Start renewal** — opens a new quote in the builder for that customer (inspections: at the
    record's level). Nothing is pre-filled beyond the customer and level.
- Row actions in Reached out — awaiting: "reached out <when> · <who>", **Undo** (clears the stamp),
  **Start renewal**.

Outreach state lifecycle: unset → stamped (by ✓, or by sending the renewal email) → unset again by
Undo. For flame tests, completing or re-completing the job clears it. A new cycle is a new record,
so it starts unset.

### 9.4 One-click renewal re-pricing (✉)

What it does, in order:

1. **Find or create this cycle's quote.** If a quote already exists with `renewalOf` equal to this
   job or record id, it is reused as is and not re-priced. Otherwise a new **draft** quote is
   created, owned by the user, with `renewalOf` set.
2. **Re-price last year's scope at today's rates.** The engine of section 5 or 6 runs with:
   - venues and counts from last year's quote (flame: every venue and its curtain count;
     inspection: **this record's venue only**, with the record's line-set count and level);
   - today's venue coordinates and stored travel figures;
   - today's rates and today's **default** service markup. The customer's tier is not applied;
   - last year's travel choice, minus its airfare (below);
   - last year's lift count at today's default lift rate (below).

   The result is rounded to $25 like any quote.
3. **Never carried:** last year's typed total; last year's typed per-venue testing costs; last
   year's typed airfare; any rewards credit.
4. **Travel choice carried:** mode (Drive or Fly), crew, and nights. Exception for inspections:
   when last year's quote covered more than one venue, `nights` is dropped (the renewal covers one
   venue, so last year's nights would overstate it); mode and crew still carry.
5. **Lift carried:** the count, re-priced at today's default rate. For an inspection whose prior
   quote covered several venues, the count becomes 1.
6. **Render the proposal** as a PDF and attach it to an email draft.
7. **Create or refresh the email draft** in the user's own mailbox, linked to the job or record and
   flagged as a renewal. If an unsent draft already exists for this record, only its attachment is
   refreshed; hand-edited subject and body are kept.
8. **Open the draft** in the email composer.

Sending the email — not clicking ✉ — stamps `renewalOutreach` on the record (if not already
stamped) and moves the renewal quote from `draft` to `sent`.

Names. Flame: `"<customer> — Field Flame Inspection renewal <year>"`. Inspection:
`"<customer> — Level <n> inspection renewal <year>"`.

"Last year's price" is the job's or record's `value` plus any rewards credit that was on the prior
quote.

The price paragraph of the email is built by rule:

| Case | Text |
| --- | --- |
| Same price | "I've attached this year's quote — $X, unchanged from last year." |
| Different, reasons known | "I've attached this year's quote — $X, compared with $Y last year. The increase reflects A, B, and C." ("decrease" when lower) |
| Different, no specific reason | "… The increase reflects our current rates." |
| Last year's price unknown | "I've attached this year's quote — $X." |
| No price | "I've attached this year's quote." |

- When last year's total was typed by hand (and not a seeded legacy price, section 4.5) this
  sentence is added: "Last year's price was hand-set at $Y; this year's is priced at our current
  rates." In that case the generic "reflects our current rates" sentence is omitted.
- Every paragraph ends: "If it looks good, just reply here and we'll get this year's
  <inspection> on the schedule."

Reasons are found by comparing the rate snapshot on last year's quote with today's. Each is a
phrase safe to show a customer:

| Changed | Phrase |
| --- | --- |
| Mileage rate (not when both years flew) | "the current federal mileage rate ($1.05/mi, was $1.00)" |
| Labour rate | "our current labor rate ($80/hr, was $75)" |
| Minutes per curtain | "updated per-curtain testing time (6 min per curtain, was 5)" |
| Base fee, only when the floor applied this year | "our minimum service fee ($175, was $150)" |
| Round-trip miles differ by 2 or more (not when both years flew) | "updated travel distance (170 mi round trip, was 164)" |
| Travel mode flipped | "travel now being priced as flights, lodging & per diem instead of a drive" / "travel now being priced as a drive instead of flights" |
| Curtain count | "the test now covering 22 curtains (was 20)" |
| Lift rate | "the current lift rental rate ($800 per rental, was $750)" |
| Inspection: prior quote covered several venues | "last year's visit combining N venues on one trip — this quote covers <venue> on its own" |
| Inspection: line-set count (single-venue priors only) | "the inspection now covering 26 line sets (was 24)" |
| Markup changed by a whole percent or more | Never named. Adds "our updated pricing" when other reasons exist; alone, falls back to "our current rates" |

If last year's quote has no rate snapshot, the generic wording is used.

**Source:** `src/lib/stores/flame-jobs.ts`, `src/lib/stores/inspections.ts`,
`src/lib/renewal-outreach.ts`, `src/lib/travel-plan.ts`, `src/lib/service-pricing.ts`,
`src/app/(app)/flame-tests/page.tsx`, `src/app/(app)/inspections/page.tsx`,
`src/app/(app)/flame-tests/actions.ts`, `src/app/(app)/inspections/actions.ts`,
`src/app/(app)/inbox/actions.ts`, `DECISIONS.md` (D54, D57, D65, D68, D69, D284, D366).

---

## 10. Documents

All standing prose is held in a template registry. Administrators can override any field; the text
below is the built-in default. `{{name}}` marks a merge field. Every document prints on a US Letter
page with Peak's letterhead image at the top, or the uploaded logo when one exists.

The three limitation notices are marked in the source as draft wording awaiting the owner's
sign-off and not reviewed by counsel. Confirm them before reuse.

### 10.1 Flame-test proposal ("Service Work Order")

Generated from a saved flame-test quote. One page.

1. Letterhead.
2. Header band: title **"Field Flame Inspection"**, subtitle "Service Work Order · NFPA 705
   Field-Flame Method", and "Engagement fee" with the total in USD. Six control fields: Document
   (estimate number) · Issued (quote creation date) · Valid through (creation + 30 days) · Method
   "NFPA 705" · Rev "—" · Sheet "1 of 1".
3. Parties: the customer contact (name · role) with each venue ("label — city, state"); "Issued by"
   the quote owner, their first role (default "Estimator") and email.
4. **Scope of work.** Opening paragraph:

   > {{company}} proposes to perform an annual field flame inspection at {{venue}}. Installed soft
   > goods will be field-tested in place using the NFPA 705 field-flame method, and each applicable
   > unit will be documented individually so the venue retains a clear, defensible fire-safety
   > record.

   Then a table with columns Item · Description · Qty / Basis · Hours:

   | Row | Description | Qty / Basis | Hours |
   | --- | --- | --- | --- |
   | One venue | "Arrive & field-test installed soft goods in place, NFPA 705 field-flame method" | "N curtains" | curtains × minutes ÷ 60 |
   | Several venues: one row each | "Field-test installed soft goods in place, NFPA 705 field-flame method", with the venue beneath | that venue's curtains | that venue's hours |
   | Drive | "Round-trip site mobilization from <office city>" | "N mi rt" | miles ÷ mph (round trip) |
   | Fly (replaces Drive) | "Travel (air, lodging & per diem)", "From <office city>" | dollar amount (section 4.7) | travel-day hours |
   | Lift, if any | "Lift rental" / "Lift rental ×N" | dollar amount | "—" |
   | Always last | "Document & disposition each curtain pass/fail; issue findings report" | "1 report" | "incl." |

   Footer of the table: "TOTAL ON-SITE + TRAVEL — N HRS". Hours are shown to one decimal. Drive
   hours here are computed from the stored miles and the current assumed speed, not from the
   billed minutes.
5. **Method** callout:

   > NFPA 705 provides a field screening method for textiles and films already in service when
   > reliable laboratory data are unavailable or added in-place verification is required.
6. **Engagement fee** box. One of three headline sentences:
   - with a drive: "Everything above — the drive, the on-site hours, and every one of your
     {{curtainsLabel}} inspected and documented — comes to {{price}}, all in."
   - no travel: "Every one of your {{curtainsLabel}} inspected and documented on-site comes to
     {{price}}, all in."
   - flights: "Everything above — travel (air, lodging & per diem), the on-site hours, and every
     one of your {{curtainsLabel}} inspected and documented — comes to {{price}}, all in."

   Followed by:

   > This amount covers mobilization, on-site NFPA 705 field testing, item-by-item disposition, and
   > issuance of the final document set. Applicable sales and use tax, lift rentals not listed
   > above, or other site-specific third-party costs may be stated separately when required.
7. **Authorization.**

   > Approving this quote authorizes us to schedule the inspection window and proceed with the
   > services described herein.

   A signature line "Authorized to proceed — Signature · print name" and a "Date" line.
8. Footer: "Work Order <number> · Valid through <date> · This work order constitutes a proposal
   valid for 30 days from issue."

A tax note exists in the template set: "Sales tax, if required, will be billed at the local sales
tax rates in force at the time of billing."

### 10.2 Inspection proposal

Same layout as 10.1, with:

- Title **"Rigging Inspection"**; subtitle "Service Work Order · Level 1 — annual" (or "Level 2 —
  every 5 years"); the fourth control field is "Level".
- Opening paragraph:

  > {{company}} proposes to perform a rigging inspection at {{venue}}. The inspection addresses the
  > accessible rigging system in place — anything that leaves the ground — and records observed
  > conditions against current federal and entertainment-industry guidance so the venue retains a
  > ranked, defensible safety record.
- First scope row: "Inspect every accessible rigging component in place, per OSHA / NFPA / ANSI E1"
  (plus " across N venues"), basis "N line sets", hours = the quote's inspection hours.
- Last scope row: "Document & prioritize findings (Urgent / Necessary / Basic); issue written
  report with photos" · "1 report" · "incl."
- Standards callout:

  > Inspection language is typically aligned to OSHA walking-working-surface requirements and
  > applicable ANSI E1 guidance for counterweight, statically suspended, fall-prevention, and
  > rigging-system inspection work.
- Cadence note, Level 1: "Rigging components should be inspected at least once a year so wear is
  caught early — we'll remind you when next year's inspection comes due." Level 2: "Level 2
  inspections are recommended every five years, alongside the annual Level 1 visual inspection."
- Price sentences as in 10.1 with "{{lineSetsLabel}}" in place of the curtain label.
- Cost note:

  > This amount covers mobilization, the agreed rigging inspection scope, prioritization of
  > findings, and issuance of the written results and summary record package. Applicable sales and
  > use tax, lift rentals not listed above, or other third-party site costs may be stated
  > separately when required.

### 10.3 Flame results — pass/fail language

Status chip on every flame results document: **"Action Required"** when any curtain failed or the
overall result is `fail`; otherwise **"Passed"**. "Passed with re-treatment" prints as "Passed".

"Good through" = the due date, written as a full date. Totals come from the per-venue results. If a
job has no per-venue results, tested = passed = the job's curtain count.

Results paragraph, built by rule (`tags` = passed + IFR):

- All passed, no IFR: "The test revealed that all N curtains passed the field flame test as flame
  retardant. T new flame tags were applied, and every certified curtain is labeled for this year's
  inspection — good through <date>."
- None failed, some IFR: "The test revealed that all N curtains are flame retardant — P passed the
  field flame test and R are inherently flame retardant (IFR), needing no treatment. T new flame
  tags were applied, …"
- Any failed: "Of the N curtains tested, P passed the field flame test and R are inherently flame
  retardant (IFR); the remaining F did not pass and require re-treatment with an approved flame
  retardant or replacement before they can be certified. The T compliant curtains were tagged and
  certified through <date>. We recommend scheduling follow-up treatment at your earliest
  convenience."

Singular forms are used for a count of one ("1 curtain", "was applied", "is").

Limitation notice printed on every flame results document:

> This document records the results of a field flame test performed per NFPA 705 — Recommended
> Practice for a Field Flame Test — and reflects only the technician's observations of the specific
> items tested on the stated date. It certifies flame-test results as described above; it is not a
> fire-code compliance determination for the venue as a whole and is not an engineering
> certification unless separately signed and sealed by a qualified professional engineer.

### 10.4 Flame results report — three variants

`/flame-tests/report?job=<id>&variant=letter|summary|certificate`. Default: **certificate**.
Available only for a completed job with results; otherwise the page says "Results not logged yet"
with a link to results entry.

Common data ("meta rows"): Prepared for · Attn (contact name, else "Sir or Madam") · Location (city,
state; with several venues "<city, state> · N venues") · Date performed · Technician · Certificate #
· Curtains tested ("20 · 17 passed, 3 IFR") · Good through.

Signer: the job owner, their first non-admin role (default "Estimator"), email, and the phone of
the signer's office.

**Letter.** Letterhead tagged "Field Flame Inspection Results · NFPA 705"; then:

> Per your request, {{company}} performed a field flame-retardant test at {{venue}} on
> {{testedLabel}} per NFPA 705 — Recommended Practice for a Field Flame Test. The findings are
> outlined below:

the NFPA quotation:

> NFPA 705 §1.1.1: This recommended practice provides guidance to enforcement officials for the
> field application of an open flame to textiles and films that have been in use in the field or
> for which reliable laboratory data are not available.

the results paragraph (10.3); when a certificate number exists, "This field test is recorded under
certificate <number>, performed <date> by <technician>."; the closing:

> Enclosed you will find an invoice for these services and a sample flame tag for your records.

then "If you have any questions, please contact me directly at:" and the signer block.

**Summary.** A fixed opening sentence ("Per your request, <company> performed a field
flame-retardant test at <venue> on <tested label> per NFPA 705 — Recommended Practice for a Field
Flame Test. The results are summarized below."), a panel "Field Flame Inspection Summary" with the
status chip and the meta rows, a per-venue table (Venue · Tested · Passed · IFR · Failed, with a
Total row) when there is more than one venue, the NFPA quotation, the results paragraph, "Field
notes: …" when notes exist, the closing, and the signer.

**Certificate.** Heading "NFPA 705 · Field Flame Test" / **"Certificate of Flame Resistance"**, the
status, and:

> This certifies that the soft goods listed above at {{venue}} were field-tested by {{company}} on
> {{testedLabel}} using the NFPA 705 field-flame method and, except where noted, were found to be
> flame-resistant. This certification is good through {{goodThrough}}.

then the meta rows in a bordered grid, the per-venue table (no total row) for several venues, the
NFPA quotation, field notes, and an explainer box "About this test — result terms & NFPA 705":

- **Passed** — "Topically treated goods that self-extinguished on the field flame test and were
  tagged for the year."
- **IFR — Inherently Flame Retardant** — "Flame-resistant by fiber, not by a topical coating. IFR
  goods don't lose resistance with age or cleaning and need no re-treatment — but are still
  inspected annually."
- **Failed** — "Did not self-extinguish; must be re-treated with an approved flame retardant or
  replaced before it can be certified."
- "NFPA 705 — field flame test, in brief", six bullets:
  - "Applies to textiles & films already in field use, or where reliable lab data (NFPA 701) isn't
    available."
  - "A sample is exposed to an open flame for about 12 seconds, then observed."
  - "It passes if it self-extinguishes promptly, chars rather than spreads flame, and drops no
    flaming residue."
  - "Material that keeps burning fails and must be re-treated with an approved retardant or
    replaced."
  - "IFR materials pass by fiber composition and need no chemical treatment."
  - "Field testing is a screening practice, repeated yearly to keep treated goods compliant."

Closing lines: "Enclosed: an invoice for these services and a sample flame tag for your records."
and "Certified flame-resistant for one year — good through <date>.", then the signer name, title
and company.

All three end with the limitation notice and a running footer "<company> · <office city>" /
"NFPA 705 · Field Flame Test".

In the letter and certificate texts, `{{testedLabel}}` is filled with the curtain count ("20
curtains"), so the sentence reads "…at <venue> on 20 curtains per NFPA 705…". See section 11.3.

### 10.5 Flame results letter and summary letter (single page)

Two further one-page documents, from a completed job. Both have the eyebrow "NFPA 705 · Field Flame
Test", the status chip, and the meta grid: Prepared For · Attn · Location · Date Performed ·
Technician · Certificate # · Units Tested · Good Through.

**Results letter** — title "Field Flame Inspection Results", subtitle "Single-Page Client
Confirmation of Findings".

> {{company}} performed a field flame-retardant inspection at {{venue}} on {{datePerformed}} in
> accordance with NFPA 705, Recommended Practice for a Field Flame Test. This letter serves as the
> single-page written confirmation of the observed disposition for the current inspection cycle.

> NFPA 705 §1.1.1 — This recommended practice provides guidance for the field application of an
> open flame to textiles and films already in use or lacking reliable laboratory data.

Results:

> Inspection outcome: {{passedCount}} Passed, {{ifrCount}} IFR, and {{failedCount}} Failed.
> Eligible passing treated goods were tagged for the current inspection cycle, and each certified
> unit is labeled good through {{goodThrough}}.

> Findings recorded under certificate number {{certNo}} reflect the conditions observed on the
> inspection date listed above. Where goods are topically treated rather than inherently flame
> resistant by fiber composition, continued compliance remains dependent on maintenance, exposure,
> and the condition of the textile at the time of each annual inspection.

> Failed goods should be removed, re-treated, or replaced before future certification is
> represented or relied upon.

> Retain this results letter with the summary letter and certificate record in the venue's
> life-safety file.

Footer: "Questions may be directed to <technician> · <company> · Office: <phone> · <contact email>".

**Summary letter** — title "Field Flame Inspection Summary", subtitle "Single-Page Administrative
Record".

> This summary letter consolidates the principal job data, observed result, and interpretation
> language most commonly needed for the venue file, owner file, or authority-having-jurisdiction
> record.

Summary Statement:

> {{company}} performed the field flame-retardant inspection at {{venue}}, located in
> {{location}}, on {{datePerformed}}, in accordance with NFPA 705, Recommended Practice for a Field
> Flame Test.

Outcome Summary:

> Disposition counts for this inspection: {{passedCount}} Passed, {{ifrCount}} IFR, and
> {{failedCount}} Failed. Passing treated goods may be tagged through {{goodThrough}}. IFR goods
> remain inherently flame resistant by fiber composition. Failed goods must be re-treated or
> replaced before they are represented as certified.

NFPA 705 in Brief:

> The field flame test is a screening practice used for textiles and films already in use.
> Material that fails should not be represented as certified until corrective action is taken, and
> annual retesting helps maintain a documentable record of compliance.

Terms: **Passed** "Topically treated goods that self-extinguished on the field flame test and were
tagged for the current cycle." · **IFR — Inherently Flame Retardant** "Goods flame resistant by
fiber composition rather than a topical coating; no topical re-treatment is required." · **Failed**
"Goods that did not self-extinguish and must be re-treated or replaced before certification is
represented."

Footer: "Prepared by <technician> · <company> · Office: <phone>".

### 10.6 Inspection report (multi-page)

Running head on every sheet: "Survey · <date>" · "<customer> · <venue>" · "Report · <date>" (or
"Draft" when no report date). Running foot: company name and office address.

Sheets, in order:

1. **Cover** — "Rigging Inspection Report", customer, venue, address, survey date, report date,
   inspector, and the condition rating as a coloured chip.
2. **Boilerplate** (the "Standards" toggle) — About <company>; Our standards (intro plus the list
   below); Our mission; The inspection; How to use this report; Disclaimer.
3. **Venue information** — venue facts, "System & equipment", "Stage measurements", with the note
   "Field dimensions are approximate; verify against architectural drawings before fabrication."
4. **About your venue** — the condition rating, the narrative, "Scope of this inspection".
5. **Component condition rubric** (the "Rubric" toggle) — every section with its line set,
   comments and item ratings.
6. **Rigging log summary** — a table of all logs with severity, status and counts. "No logged
   findings in this inspection." when empty.
7. **Rigging log detail** — each log with its problem, explanation, location, standards, "BEFORE /
   AFTER" photos, and "Recommended solution" (or "Work performed" for a closed log). Closed logs
   are omitted when the "Closed" toggle is off.
8. **Recommendations** — a Priority / Recommendation table of open findings, with the basis line
   below. When nothing is open: "No open findings require corrective action at this time. Continue
   the annual inspection cycle to keep the system compliant."
9. **Next step · renovation package** — counts of open Urgent and Necessary repairs, the paragraph
   below, and "Prepared by".

Layouts: **Report** and **Field dossier** print one finding per sheet; **Compact** prints several
per sheet. The exact visual differences between the three were not traced (section 12).

Default boilerplate text:

- About: "We are an independent theatrical rigging company specializing in renovation,
  restoration, new installation, and repair of counterweight rigging systems, pipe grids, automated
  rigging, and custom rigging solutions. Being independent — with no sales agreements tied to any
  manufacturer — lets us specify the equipment that is genuinely best for each purpose and leverage
  the best quality and pricing for our clients."
- Standards intro: "Our inspections follow a strict set of guidelines drawn from current federal
  regulations and theatrical industry standards, including:"
  - OSHA — "Occupational Safety and Health Administration — sets and enforces workplace safety
    standards, including fall protection for walking-working surfaces."
  - NFPA — "National Fire Protection Association — publishes the consensus fire-safety codes that
    govern fire curtains and life-safety systems."
  - ANSI — "American National Standards Institute — oversees the E1 series of voluntary
    entertainment-technology standards used throughout this report."
  - ESTA / PLASA — "The entertainment-technology trade bodies whose technical standards program
    (E1) defines safe rigging practice."
  - ETCP — "Entertainment Technician Certification Program — the North American certification for
    riggers who directly affect crew and audience safety."
- Mission: "To install high-quality rigging in a professional, timely manner; to create rigging
  solutions suited to each client's specific needs; and to further users' understanding of how
  their equipment works — encouraging education, creativity, and safe practices."
- The inspection: "The purpose of a rigging inspection is to check every piece of hardware involved
  in the rigging system — anything that leaves the ground. Just as a chain is only as strong as its
  weakest link, a rigging system is only as strong as its weakest point. Each component must be
  checked at least once a year so wear can be caught early. This is a visual inspection of
  accessible components; items that cannot be seen (the inside of gearboxes and motors, spaces
  above finished ceilings) are not included unless specifically noted."
- How to use this report: "This report sorts every finding into three categories — Urgent Repair,
  Necessary Repair, and Basic Improvement — and tracks each as an Open or Closed log. An Open log
  is present or still present from a past inspection; a Closed log was resolved during this
  inspection or is a past issue no longer present. Each finding is detailed in its own rigging
  log."
- Disclaimer: "This report is limited to the deficiencies present and visually accessible at the
  time of the inspection. Mechanical and electrical systems can fail without warning and new
  deficiencies can develop at any time. This survey makes no attempt to vouch for the integrity of
  the system design and does not include any structural analysis; concerns about the building
  structure should be directed to a qualified structural engineer."

The standards list is fixed; the six prose fields are editable.

Recommendations basis: "Recommendations are based on OSHA 1910 fall-protection standards, NFPA 80 &
101 life-safety codes, and the ANSI E1 entertainment-technology series (E1.4 counterweight rigging,
E1.22 fire-safety curtain)."

Renovation paragraph: "The most effective way to resolve these findings is a renovation package
that addresses the open Urgent and Necessary repairs together so the venue can operate safely.
Because of the potential structural concerns noted above and the number of findings across the
system, the logs above are not individually estimated — a consolidated renovation budget is
prepared separately and can be started from this report."

Inspection limitation notice (printed on the report's closing sheet and on both inspection letters):

> This report documents the inspector's visual observations of accessible rigging components on the
> stated survey date, evaluated against OSHA 1910 fall-protection standards, NFPA 80 & 101
> life-safety codes, and the ANSI E1 entertainment-technology series (E1.4 counterweight rigging,
> E1.22 fire-safety curtain). It certifies only what was observed and rated on that date — it does
> not certify the structural design or integrity of the building, is not a substitute for
> continuous inspection, and is not an engineering certification unless separately signed and
> sealed by a qualified professional engineer.

### 10.7 Inspection results letter and summary letter (single page)

Both: eyebrow "Rigging Inspection · OSHA / ANSI E1"; the status chip is the condition word ("Good",
"Fair", "Poor", "Failing").

**Results letter** — "Rigging Inspection Results", "Single-Page Client Confirmation of Findings".
Meta: Prepared For · Venue / Room · Location · Survey Date · Inspector · Report No. (record id) ·
Inspection Type ("Rigging · Level 1") · Overall Condition.

> {{company}} performed a rigging inspection at {{venue}} on {{surveyDate}}. This letter serves as
> the single-page confirmation of the observed condition, logged repair priorities, and report
> basis for the current inspection cycle.

Visual Scope:

> The inspection addresses accessible rigging-system components — anything that leaves the ground —
> and documents observed deficiencies only. Concealed conditions, internal mechanical failures, and
> structural analysis are outside scope unless specifically noted.

Results:

> Findings logged for this survey: {{urgentCount}} Urgent Repair, {{necessaryCount}} Necessary
> Repair, {{basicCount}} Basic Improvement, and {{closedCount}} Closed. Overall condition at the
> time of inspection: {{condition}}.

> Urgent items should be corrected before further reliance is placed on the affected condition.
> Necessary items should be scheduled in the near term, while Basic items improve safety, clarity,
> or operating reliability. Where permanent support steel or other building structure is
> implicated, review by a qualified structural engineer should be obtained.

> Retain this letter with the detailed inspection report, photographs, and corrective-action
> records in the venue safety file. Completed repairs may be documented by owner record and
> formally closed on a future inspection cycle or follow-up visit.

Terms: **Urgent Repair** "Requires immediate correction because a safety hazard or loss-of-control
condition is present." · **Necessary Repair** "Should be scheduled in the near term before wear,
exposure, or operating risk becomes more serious." · **Basic Improvement** "Improves safety,
clarity, code alignment, or long-term reliability even if use may continue for now."

**Summary letter** — "Rigging Inspection Summary", "Single-Page Administrative Record". Meta:
Prepared For · Venue / Room · Location · Survey Date · Report Date · Inspector · Overall Condition ·
Next Cycle (survey date + 1 or 5 calendar years).

> This summary letter consolidates the venue facts, inspection scope, overall condition, and repair
> counts most commonly needed for owner files, board packets, insurers, and
> authority-having-jurisdiction requests.

Summary Statement:

> {{company}} performed the rigging inspection at {{venue}}, located in {{location}}, on
> {{surveyDate}}, reviewing the accessible rigging system against current OSHA, ANSI E1, and other
> applicable life-safety guidance.

Scope of This Inspection:

> The principal assets reviewed — for example, counterweight line sets, statically suspended
> rigging, fire curtain, catwalks, support points, drapery track, and dead-hung equipment included
> in the site visit.

Outcome Summary:

> Overall condition: {{condition}}. Summarize the key risks and the recommended repair posture in
> two or three sentences.

(The second sentence is an instruction to the template editor that prints as written unless an
administrator replaces it. See section 11.3.)

> Open items reflect conditions present on the survey date, including carried-forward issues where
> applicable. Closed items are findings previously identified but resolved or no longer observed.

Disclaimer:

> This summary is limited to conditions visually accessible on the inspection date. New
> deficiencies can develop at any time, and concealed components, electrical internals, and
> structural engineering analysis are outside scope unless specifically noted.

### 10.8 Renewal emails

Flame — subject "Annual Field Flame Inspection renewal — {{customer}}"; body:

> Hi {{contactFirstName}},
>
> Our records show the annual Field Flame Inspection at {{customer}}{{venueSuffix}}
> {{lastPerformedClause}}, which makes it due for renewal. Per NFPA 705 this inspection is
> performed yearly to keep your curtains and soft goods compliant.
>
> {{priceParagraph}}
>
> Thanks,
> {{senderFirstName}}
> {{company}}

Inspection — subject "{{levelLabel}} rigging inspection renewal — {{customer}}"; body:

> Hi {{contactFirstName}},
>
> Our records show the {{cadenceShort}} rigging inspection at {{customer}}{{venueSuffix}} is due
> for renewal.
>
> {{priceParagraph}}
>
> Thanks,
> {{senderFirstName}}
> {{company}}

`contactFirstName` falls back to "there". `priceParagraph` is built as in section 9.4. The attached
PDF is a prose version of the proposal (10.1 / 10.2): the same opening paragraph and callout, a
"Venues included" list for several venues, one travel sentence, a lift sentence when relevant
("This price includes a lift rental ($X)."), and the price line. In drive mode the travel sentence
reads: "The distance from <company> (<office city>) to <venue> is approximately N miles. Travel
time is about H hours each way, and the on-site inspection should take approximately H hours — for
a total of roughly H hours for the visit." In fly mode: "Given the distance from <from> to <to>,
this visit is priced with air travel — Travel (air, lodging & per diem): $X."

**Source:** `src/lib/templates.ts`, `src/lib/compliance-notices.ts`,
`src/app/(app)/flame-tests/letter/letter-view.tsx`, `src/app/(app)/inspections/letter/letter-view.tsx`,
`src/app/(app)/flame-tests/report/page.tsx`, `src/app/(app)/flame-tests/report/report-doc.tsx`,
`src/app/(app)/flame-tests/results-letter/page.tsx`, `src/app/(app)/flame-tests/summary-letter/page.tsx`,
`src/app/(app)/inspections/[id]/report/report-doc.tsx`,
`src/app/(app)/inspections/results-letter/page.tsx`, `src/app/(app)/inspections/summary-letter/page.tsx`,
`src/app/(app)/_letters/util.tsx`, `src/components/letter/SinglePageLetter.tsx`,
`src/lib/stores/inspections.ts`, `src/lib/renewal-outreach.ts`, `DECISIONS.md` (D59, D72, D283).

---

## 11. Integration points, known defects, and disagreements

### 11.1 What the standalone program loses

Each item is something the two modules get from the rest of the app today. A standalone rebuild
must supply a replacement or drop the feature.

| Integration | What it provides today | What a rebuild must supply |
| --- | --- | --- |
| Customers, venues and contacts (CRM) | The customer picker; each venue's id, label, city, state, address, coordinates and stored one-way travel miles/minutes; contacts with name, role, email and a primary flag | Its own customer / venue / contact store, with coordinates or typed one-way miles and minutes per venue. Without coordinates the estimate method (7.1) is the only one available |
| Offices (settings) | The quote origin (name, address, coordinates, phone) and the letterhead address | An editable office record with a "default origin" flag |
| Geocoding and routed distance | Venue coordinates and the stored one-way travel figures. Project notes say these come from a routing service with a straight-line fallback | Manual entry, or a bundled calculation. An offline file cannot call a routing service |
| Staff roster | Technician / inspector pick-lists, initials and colours, the signer's title, email and office | A local list of people |
| Company settings and branding | Company name, accent colour, uploaded logo | Local settings. A bundled letterhead image is used when no logo is uploaded |
| Rates (Estimating Rules) | The tables in section 4.1, editable, shared with the Repairs module | Its own rates screen with the same keys, ranges and defaults |
| Customer pricing tiers | A per-company or per-contact tier that seeds the markup | Drop it (use the service default), or add a markup field per customer |
| Templates screen | Administrator overrides for every text in section 10 | Its own editable text store, or fixed text |
| Shared Quotes list and estimate numbers | One list of all quote types; the `draft → sent → won/lost` status; the shared number counter (1001 up, `FLM` / `RIG` prefixes); delete; "Change type" | Its own quote list, status control and numbering |
| Approval gate | Other quote types need an approval before they can be sent. Both service builders bypass it when approving | Nothing, unless the owner wants a review step |
| Won quote → job / record | Marking a quote Won anywhere creates the work record; the dashboards repair any that were missed | Do it directly in the Approve action. Keep the idempotency rule (2.4) |
| Linked project (inspections only) | One lightweight project per inspection quote, so the work shows in the Projects module | Drop |
| Repairs module | The inspection report's "Renovation quote" opens a system quote in the Estimator. Project notes describe repairs "flagged from inspections"; the inspection code read here has no such write (section 12) | Drop, or export open findings as a list |
| Customer portal | Customers generate firm flame and inspection quotes themselves, see venue compliance status, and accept quotes. Staff then approve; an accepted portal quote is approved at the accepted price without re-pricing | Drop. See `docs/handoff/client-portal-spec.md` |
| Rewards credit and perks | A customer's rewards credit can be subtracted from the total after pricing (`value` is net; documents show gross, credit and net); a perks line prints under the fee | Drop. If dropped, `value` always equals `total` |
| Email (Gmail) drafts | Renewal outreach creates a draft with the PDF attached and opens the composer; sending stamps the outreach state and marks the quote sent | Produce the PDF and the email text for the user to send themselves (for example a `mailto:` link plus a saved PDF), and give the user a manual "mark sent" step |
| PDF rendering | A saved PDF of the proposal is rendered on the server after every save; renewal PDFs use a separate prose renderer | Browser print-to-PDF from the print views |
| Calendar | Scheduling writes an all-day hold to the assigned person's Google calendar and removes it on unschedule or delete; the schedule dialog warns about venue-calendar clashes | Drop, or export an `.ics` file |
| Field Work day view | The combined "today" list (section 8.3) | Its own today list |
| Offline outbox and sync | Flame results and the inspection editor save through a device queue and sync whole documents to the server when back online | Not needed for a single-file program that stores locally, but the program then needs its own export / import or backup, because nothing leaves the device |
| Recordings | A strip on the results and capture screens for audio recordings, and "From recording" panels that insert transcribed text into an inspection | Drop |
| Morning triage, global search, activity feeds, maps | Renewals feed a daily to-do list; records are searchable; dashboards show a map from online map tiles | Drop, or bundle. Online map tiles are unavailable offline |
| Photos | Stored inside the inspection record as resized JPEG data URLs | Same approach works offline; watch local storage limits |
| Authentication | Every screen requires a signed-in staff member; the user's name is stamped as owner, requester and outreach author | A local "who am I" setting, if names are still wanted on documents |

### 11.2 Known defects and gaps in the current code

A rebuild should decide each of these deliberately rather than copy it.

1. **Flame report variant tabs do not switch.** The tabs on the flame results report build their
   link with the query key `chrome.variant` instead of `variant`. The page reads `variant`, so
   every tab loads the default certificate. The letter and summary variants are reachable only by
   typing the URL.
2. **The flame letter and certificate print the curtain count where a date belongs.** See 11.3.
3. **The inspection summary letter prints an instruction to the editor** ("Summarize the key risks
   and the recommended repair posture in two or three sentences.") unless an administrator has
   replaced the template text.
4. **Builder rate inputs change global rates.** Editing the mileage or labour rate inside one quote
   re-prices every later quote of that service.
5. **No stage checks on some actions.** Results can be logged for a job that was never scheduled;
   the inspection editor's save accepts any stage; unscheduling an inspection does not check that
   it was scheduled.
6. **No arithmetic check on flame results.** Passed + IFR may exceed Tested; Failed then shows 0.
7. **Multi-venue flame jobs renew under one venue.** The renewal key uses the job's first venue.
8. **Year length.** Due dates use 365-day years; the inspection summary letter's "Next Cycle" uses
   calendar years. The two can differ by a day or more, and by up to two days over five years.
9. **Unused data-layer features.** Flame "reopen" and inspection "carry forward" have no screen.
   `estHours` and `estCost` on a log are never used.
10. **Owner fallback.** Records with no owner fall back to a hard-coded person's name.
11. **Outreach stamp on inspections is not cleared** when a record is edited or re-completed.
12. **Whole-document saves.** Offline and online saves of an inspection replace the whole record;
    two people editing the same record overwrite each other.
13. **Route order is not optimised** for multi-venue trips; venues are visited in list order.

### 11.3 Where documentation and code disagree

| Topic | Project notes say | Code does |
| --- | --- | --- |
| Inspection labour rate | `DECISIONS.md` D52: placeholder default $95/hour | $75/hour |
| Pricing basis | D52, D283, D363, D364 describe margin on price | Markup on cost since D1286; those entries carry a "superseded" pointer |
| Markup clamp | D364: a 5–50% clamp | Server clamps the slider value to 5–100%; the slider itself is 10–100 |
| Low-markup warning | D364: below a 10% margin | Below an 11% markup (the same threshold converted) |
| Day-of sheet | `AGENTS.md` phase 4 and D56: a day sheet at `/flame-tests/today` | That route redirects to the general Field Work day view |
| Renewal draft mailbox | `AGENTS.md` phase 4 and D65: the draft lands in the shared Sales mailbox | The draft is created in the sender's own mailbox. The redirect URL still names the sales box |
| Renewal price | `AGENTS.md` phase 4 opening text and the ✉ tooltip: "at last year's price" | Re-priced at current rates (D69). The tooltip text on both dashboards is stale |
| "IFR" versus "re-treated" | The stored field is `retreated`; the per-venue `treatment` reads "Re-treated on site"; the overall option reads "Passed with re-treatment"; the sample data's note says curtains "were re-treated on site and passed on re-test" | Every label and every document calls the same number "IFR — inherently flame retardant, needing no treatment". The two meanings are opposites. Ask the owner which is intended, and whether both are needed as separate counts |
| `{{testedLabel}}` | The template's sample value is a date ("June 12, 2026") | The report passes the curtain count ("20 curtains"), so the letter and certificate read "…on 20 curtains…" and never state the test date in that sentence |
| Flame naming | Screens say "Flame test"; D72 renames the service "Field Flame Inspection" on documents | Mixed: screens, statuses and the quote name use "Flame Test"; documents and emails use "Field Flame Inspection" |
| Inspection store header | Says the lifecycle "mirrors SurveyStore" and that a `renovationQuoteId` back-link exists in the prototype | No back-link is stored; the renovation quote is not linked to the inspection |

**Source:** `src/app/(app)/flame-tests/report/page.tsx`, `src/app/(app)/flame-tests/report/report-doc.tsx`,
`src/app/(app)/flame-tests/results/controls.tsx`, `src/app/(app)/flame-tests/actions.ts`,
`src/app/(app)/inspections/[id]/actions.ts`, `src/app/(app)/inspections/summary-letter/page.tsx`,
`src/lib/renewal-outreach.ts`, `src/lib/service-calendar.ts`, `src/lib/sync/engine.ts`,
`src/lib/stores/pricing.ts`, `src/lib/templates.ts`, `src/lib/stores/flame-jobs.ts`,
`src/lib/stores/inspections.ts`, `DECISIONS.md` (D52, D56, D65, D69, D72, D100, D364, D1286),
`AGENTS.md` (phases 4, 6, 15, 18, 20, 67).

---

## 12. Not verified

The following were taken from project notes or comments, or were only partly read. Confirm them
with the owner or against the code before relying on them.

1. **Live rate values.** Every default in section 4.1 is a code default. The values saved in
   production were not read.
2. **The three inspection report layouts.** The sheet list in 10.6 was read from headings in the
   code. The visual differences between Report, Field dossier and Compact, the three cover
   designs, and the pagination rules were not traced.
3. **The proposal letters' exact layout** (fonts, spacing, the parties row labels). Only the text
   and structure were read.
4. **The renewal PDF** layout. Its text blocks were read; the renderer was not.
5. **How venue travel miles and minutes are produced and cached** (routing service, fallback,
   refresh). Only the fact that they are stored per venue and read by the builders was confirmed.
6. **Customer pricing tiers**: the tier names, their markups, and how a contact's own tier is
   resolved. Only the order of precedence in 4.2 was read.
7. **The slider re-seed rule in detail** (what counts as "untouched" after several customer
   changes).
8. **The rewards credit rules** (how much may be applied, when it is dropped). Only its position
   after the final total was confirmed.
9. **The portal's use of these engines.** Described in `docs/handoff/client-portal-spec.md`; not
    re-read here.
10. **"Repairs flagged from inspections."** `AGENTS.md` phase 4 describes this as a Repairs
    feature. No code in the inspection store, actions or screens writes a repair. Whether the
    Repairs module reads open inspection logs on its own was not checked.
11. **The calendar hold** (event shape, all-day or timed, what happens when the person has no
    connected calendar) and the venue availability check.
12. **The offline queue's conflict behaviour** and what happens to a queued save that the server
    rejects.
13. **The Field Work day view's rules** for which flame jobs and inspections it lists.
14. **"Change type", delete-quote, and the won-edit confirmation** dialogs: seen as controls, not
    traced.
15. **The saved-PDF button** and the server PDF render of the proposal.
16. **The seed data** for flame jobs (ids 3001–3008) and the demo inspection used by the options
    canvas.
17. **Automated test coverage** of these rules. Tests are referenced in comments (for the $25
    rounding, typed totals and renewal carry rules); which exist and pass was not checked.
