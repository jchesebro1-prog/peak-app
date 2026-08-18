# Venue Assessments: merging the site-visit sheets and the Condition & Needs brief into Field Surveys

Authored 2026-08-18 from three sources, all supplied by Jeff:

1. `Peak-Condition-Needs-Assessment-Brief.md` — a design brief drafted from a
   2026-08-18 interview, describing an advisory condition/needs layer.
2. Five Word site-visit sheets — Theatre (Rev. 3.0), Auditorium, Church
   (Rev. 2.1), Convention Center (Rev. 2.1), Gym (Rev. 5.1). These are the
   paper forms Peak reps carry today.
3. The existing Field Surveys module in this app.

All twelve scoping decisions locked via pop-in questions during the
2026-08-18 brainstorm.

## Problem

Peak has three overlapping descriptions of the same site visit and no single
place to do one.

The **paper sheets** are what reps actually fill out on site. They are
venue-class-specific — a gym sheet asks for court length and divider curtain
span; an auditorium sheet asks for grid height to loft blocks and pin rail
location. None of that structure exists in the app. Reps capture on paper,
then re-key a lossy subset into Field Surveys afterward.

The **Field Surveys module** has a richer intake model than the sheets in one
dimension (the IDEAS #45 tier gate, four discipline branch forms, structured
fixture/audio inventory that feeds the quote side) and a much poorer one in
another (one generic measurement set with a thin venue-type switch, no
lineset schedule, no fly-system block, no life-safety block, no sign-off).

The **Condition & Needs brief** describes something neither has: an advisory
layer for the customer who has no defined ask and wants Peak's opinion on
what to prioritize. Its governing principle is "reference, don't duplicate" —
it assumes the matching site-visit sheet is already on file and refuses to
re-capture measurements or restate formal inspection findings.

Jeff's instruction: mold all three into one cohesive venue assessment intake,
and rename Field Surveys to Venue Assessments.

### The tension, and how it resolves

The brief insists the assessment is a *separate document that references* the
site-visit sheet. Jeff wants *one* intake. Both hold under exactly one model:
a single record with two layers, where the assessment layer reads the
site-visit layer's data instead of asking for it again. Duplication becomes
structurally impossible rather than merely discouraged. Every other merge
model either duplicates fields or splits the record.

## Locked decisions

1. **One record, two layers.** A Venue Assessment always carries the
   site-visit layer. An `assessmentEnabled` toggle unlocks the advisory
   sections. The assessment layer never re-asks a measurement.
2. **Rename: labels + route, ids unchanged.** Nav, titles, and copy become
   "Venue Assessments"; the route moves to `/venue-assessments` with a
   redirect from `/field-survey`. Record ids stay `FS-####` — they are
   printed on real documents and referenced at ~20 call sites.
3. **Venue class + subtype.** New primary `venueClass` (theatre, auditorium,
   church, gym, convention, other) drives which field sets appear; new
   `venueSubtype` holds that class's own checkbox options straight off the
   sheet. The old seven `venueType` values migrate.
4. **Build scope: form + printable field sheet.** The customer-facing report
   (brief §5) is deferred, as the brief asks, until the form has been
   field-tested at least once.
5. **Sheets fold into the discipline branches.** One section per system.
   Each opens with the sheet's PRESENT checkbox row as its gate, which
   retires the Tier-3 yes/no + describe block. Sheet fields and branch fields
   merge de-duplicated; inventory rows survive.
6. **One unified lineset table** on the Theatre superset, with the
   Auditorium's columns as a subset. Auto-shown for theatre and auditorium,
   toggleable on any class.
7. **Doctrine defaults live in Estimating Rules**, keyed by venue class, and
   render with an "unconfirmed for this class" marker for theatre and church.
8. **Cert references auto-resolve with manual override.** Flame cert and
   inspection references resolve from the venue's Flame Tests and Inspections
   records; manual entry remains for third-party or pre-app documents.
9. **Findings: one line per flagged category, mergeable.** Each category
   rated Monitor or Replace seeds a line; the assessor may merge or split.
10. **Two rating scales, each where it belongs.** Category condition in the
    assessment layer uses Good / Monitor / Replace. Per-lineset condition
    keeps the printed G / F / P / X legend.
11. **Visit purpose adopts the sheet list**; the app's five `visitType`
    values migrate onto it.
12. **Close-out: three sign-off lines + revision stamp.** Peak rep, site
    contact, and an optional technical reviewer that prints only when filled.
    Each record stamps the form-template revision it was captured under.

### Defaults taken, flagged but not blocking

- **Findings stay advisory.** They do not auto-spawn quotes or repair jobs,
  because the brief is explicit that budget tiers are not a quote. The
  existing "Create quote →" path is untouched. Raised with Jeff on
  2026-08-18; he chose to proceed. Revisit if Now-bucket findings should
  spawn repair jobs the way inspection findings do.
- **`other` is the sixth class**, covering outdoor/amphitheater and arena
  with the generic field set, rather than giving those their own sheets.
  Also raised and passed on. Peak has no paper sheet for either today.

## Migration strategy

Old records migrate **on read**, inside `normalize()` in
`src/lib/stores/surveys.ts` — the pattern this module already uses for the
`stage` backfill ("applied on read instead of as a stored migration", per the
module docstring). No stored rewrite, no drizzle migration for the doc body,
and rollback is free. New fields default empty; a record only gains stored
values when someone saves it.

**venueType → venueClass + venueSubtype:**

| Old `venueType`          | `venueClass` | `venueSubtype`          |
|--------------------------|--------------|-------------------------|
| Proscenium theater       | theatre      | Single proscenium       |
| Black box                | theatre      | Black box / flexible    |
| Worship / sanctuary      | church       | Sanctuary — traditional |
| Gymnasium / gym stage    | gym          | Multi-purpose (has stage) |
| Arena                    | theatre      | Thrust / arena          |
| Multipurpose room        | convention   | Ballroom / multi-purpose |
| Outdoor / amphitheater   | other        | (empty)                 |

`venueType` is retained on the record as a read-only derived value so the ~20
existing call sites that display it keep working; it is no longer an input.

**visitType → visitPurpose:**

| Old `visitType`         | `visitPurpose`      |
|-------------------------|---------------------|
| Initial site survey     | New system design   |
| Budgetary walk-through  | Bid walk            |
| Design verification     | New system design   |
| Punch / follow-up       | Punch list          |
| Service call            | Repair / service    |

Measurement keys are **never renamed**. Where a sheet field means the same
thing as an existing key, the existing key wins — `proW`, `proH`,
`stageDepth`, `gridH`, `wingSL`, `wingSR`, `houseH`, `seating`, `boothLoc`,
`boothWD`, `floorType`. This preserves the module's stated shared-key rule
("a value entered in the quick set and in an expanded group is the same
field, no dupes") and keeps the 3D preview in `venue-3d.tsx` working.

## Data model

All additions land on `SurveyDraft` in `src/lib/stores/surveys.ts`. The
record stays a doc-store JSONB document; no schema migration is required.

### Venue classification

```ts
venueClass: VenueClass;   // "theatre" | "auditorium" | "church" | "gym" | "convention" | "other"
venueSubtype: string;     // that class's own checkbox options
visitPurpose: string;     // sheet list
templateRev: string;      // e.g. "1.0" — stamped at create
```

### Site-visit layer additions

**Access & site conditions** — the sheets ask more than the app does:
`loadingDoorSize`, `liftHeight`, `pathToFloor`, `workingHours`,
`blackoutDates`, `floorProtection`, `badgingRequired`, `firstImpressions`.
Existing `loadingDock`, `elevatorSize`, `floorType`, `accessDoorSize`,
`liftNeeded`, `liftSupplier` are kept as-is.

**Quote questions** — the sheets' block adds `budget`, `fiscalYearSpendBy`,
`whoDecides`, `targetInstallWindow`. Existing `quoteNeededBy` serves the
sheets' QUOTE DEADLINE; existing `installTimeframe` and `budgetary` stay.

**Life safety** (auditorium sheet p.5, offered on any class):
`lifeSafety: { deluge, smokeVent, adaNotes, egressNotes }`.

**Sign-off:**

```ts
signoff: {
  repName: string;   repSignedAt: string;
  contactName: string; contactSignedAt: string;
  reviewerName: string; reviewerRole: string; reviewerSignedAt: string;
}
```

The reviewer line prints only when filled.

### Systems — four gated sections

`DISCIPLINE_GROUPS` in `src/lib/stores/survey-intake.ts` grows from four
branch forms into four full system sections. Each gains:

- a `presentOptions: string[]` checkbox row, straight off the sheet, stored
  as `DisciplineData["present"]: string[]`. This **replaces** Tier-3
  `systemsState` as the "is this system here?" gate.
- the sheet's named fields, merged with the existing branch fields.
- `visibleFor?: VenueClass[]` on individual fields, so auditorium-only fields
  (dimmer rack capacity, DMX universes, FOH positions, follow-spot booth)
  do not appear on a gym.

Section-by-section:

- **Rigging & Fly** — existing grid/counterweight/hoist/deck-load fields,
  plus the auditorium fly block: `flyType`, `linesetCount`, `battenLength`,
  `arborCapacity`, `gridBlockCondition`, `hempLineCondition`, `motorControl`,
  `loadingGalleryNotes`, `fireCurtainPresent`, `fireCurtainRating`,
  `releaseMechanism`, `fireCurtainLastInspection`.
- **Curtains & Soft Goods** — PRESENT row (divider curtain, track straight,
  track curved, fixed pipe, wall bracket, cyc/backdrop, none — auditorium
  substitutes main/act, grand drape, traveler, teaser/tormentors, legs,
  borders, cyc/scrim), plus fabric/colour, weight oz, finished W×H,
  condition, track series, track operation, fixed pipe qty, pipe dia,
  mounting, height above floor, load capacity per position; auditorium adds
  curtain type, operation, legs qty pairs, borders qty, cyc/scrim fabric.
  Existing branch fields (masking needs, main condition, legs & borders,
  traveler condition, replace-vs-reuse) merge in.
- **Lighting** — console mfr/model, console location, fixture qty est.,
  install year, fixture types, positions, controls; auditorium adds dimmer/
  relay rack location + capacity, DMX universes/protocol, FOH positions,
  follow-spot booth. Existing fields (control protocol, electrical service,
  circuit accessibility) merge in. Inventory rows unchanged.
- **AV & Power** — PA/sound mfr, speaker locations/qty, mic/paging inputs,
  condition, electrical panel location, spare breaker capacity, company
  switch/generator tie-in, network/wifi coverage. Existing fields (control
  infrastructure, network/wifi, broadcast) merge in. Inventory unchanged.

`systemsState` and `SYSTEM_KEYS` are removed from the editor but retained in
the type and read-normalized into the new `present` arrays, so pre-existing
records do not lose their yes/no answers.

### Tier 1 survives; its key lists grow

The IDEAS #45 kill-question gate stays exactly as it is — venue name, contact
name, contact email, contact phone, stage width, stage depth — and still
soft-gates the system sections while leaving the record saveable as a draft.
`intakeStatus()` and `intakeReady` are unchanged.

What must change is `TIER1_WIDTH_KEYS` and `TIER1_DEPTH_KEYS`. They currently
accept only the old venue types' keys, so a gym or convention-center record
captured under the new class field sets would read as incomplete forever.
Extend them with the new classes' primary dimension keys:

- width: existing `proW`, `roomWidth`, `platformWidth`, `stageWidth`,
  `floorWidth`, plus `courtWidth` (gym) and `sanctuaryWidth` (church).
- depth: existing `stageDepth`, `roomDepth`, `platformDepth`, `floorDepth`,
  plus `courtLength` (gym) and `sanctuaryLength` (church).

Convention center uses `roomWidth`/`roomDepth`; theatre and auditorium use
`proW`/`stageDepth`; `other` uses `roomWidth`/`roomDepth`. Every class must
resolve to at least one width key and one depth key — this is a hard
invariant, and a class whose field set satisfies neither is a bug.

### Linesets

```ts
linesetsEnabled: boolean;   // auto-true for theatre + auditorium
linesets: LinesetRow[];
```

```ts
interface LinesetRow {
  id: string; pos: string; distFromPL: string; setName: string;
  type: LinesetType;        // D M R L B C S E T O
  battenLength: string; liftLines: string; goods: string;
  finishedWH: string; arborLoad: string;
  trimLow: string; trimHigh: string;
  cond: LinesetCond;        // G F P X
  notes: string;
}
```

`type` and `cond` render with the sheets' legends. The Auditorium sheet's
`travel` column maps onto `trimLow`/`trimHigh`; its `arbor/motor capacity`
maps onto `arborLoad`.

### Assessment layer

```ts
assessmentEnabled: boolean;
assessment: {
  date: string;
  assessors: string[];
  technicalReviewer: { name: string; role: string };
  statedConcern: string;                 // customer's own words
  usage: {
    eventTypes: Array<{ key: string; frequency: EventFrequency }>;
    staffTier: StaffTier;
    trainingGaps: string;
    growthGoals: string[];
    growthNotes: string;
  };
  conditions: Record<ConditionCategory, { rating: ConditionRating; notes: string }>;
  electricalNotes: string;               // contextual only — deliberately unrated
  inspectionRefs: Record<string, InspectionRef>;
  findings: Finding[];
}
```

**Ten condition categories** (`ConditionCategory`): `rigging`, `curtains`,
`motors`, `lighting.console`, `lighting.dimming`, `lighting.fixtures`,
`av.console`, `av.speakers`, `av.mics`, `av.video`.

**`ConditionRating`** = `"" | "good" | "monitor" | "replace"`.

**Electrical is notes-only, with no rating** — the brief is explicit that
this is outside Peak's lane. Do not add a rating to it.

**Event types** — assemblies, theatrical productions, concerts/recitals,
sports, community rentals, other. **`EventFrequency`** = weekly / monthly /
a few times a year / rare.

**`StaffTier`** — trained theatrical/AV staff / teacher or staff with some
training / students only / no dedicated operator.

**Growth goals** — expand drama/music program, more community rentals,
multi-use conversion, none planned, other.

**Budget & decision process is not re-asked.** The assessment layer renders
the site-visit layer's quote-questions block in place, per the brief's
instruction to reuse it as-is.

```ts
interface InspectionRef {
  onFile: "" | "yes" | "no";
  type: string; date: string;
  source: "auto" | "manual";
  recordId: string | null;   // FT-#### or the inspection id when auto-resolved
}
```

```ts
interface Finding {
  id: string;
  categories: ConditionCategory[];   // >1 when merged
  bucket: "now" | "soon" | "later";
  title: string; detail: string;
  budgetTier: "" | "u5k" | "5to25k" | "25to100k" | "over100k";
  photoIds: string[];                // references SurveyPhoto ids on the record
}
```

## Findings engine

A pure function in `src/lib/stores/assessment.ts`:

```ts
seedFindings(assessment): { seeded: Finding[]; unresolved: ConditionCategory[] }
```

Every category rated `monitor` or `replace` and not already covered by an
existing finding's `categories` array seeds one line, pre-filled with the
category label and its notes. Merging is `categories` gaining entries; splitting
is the inverse. A flagged category covered by no finding surfaces in
`unresolved`, rendered as a gap warning in the editor so nothing silently
drops. Categories rated `good` never appear, per the brief.

Findings do not spawn quotes, repair jobs, or tasks.

## Cert auto-resolve

`src/lib/venue-assessment-certs.ts` (server-only) resolves, for the record's
`customerId` + `locationId`:

- most recent completed flame test → `inspectionRefs["curtains"]`
- most recent completed inspection → `inspectionRefs["rigging"]`

Resolved refs render as a link to the actual record with its date, and carry
`source: "auto"`. Switching a ref to manual sets `source: "manual"` and
preserves whatever the rep typed; auto-resolution never overwrites a manual
entry. When nothing resolves, the field renders as empty manual entry rather
than asserting "none on file".

The brief's rule holds: the app **references** these documents and never
re-derives or restates their findings.

## Doctrine defaults

Estimating Rules (`/estimating-rules`) gains a "Venue class doctrine" group:
per class, a curtains default line and a lighting default line, plus a
`confirmed` boolean. Seeded from the sheets:

| Class      | Curtains                              | Lighting        | Confirmed |
|------------|---------------------------------------|-----------------|-----------|
| gym        | Encore 22 oz main + valance, Encore rest | —             | yes       |
| auditorium | Charisma main + valance, Encore rest  | Element console | yes       |
| theatre    | Charisma main + valance, Encore rest  | Element console | **no**    |
| church     | Charisma main + valance, Encore rest  | Element console | **no**    |
| convention | —                                     | —               | yes       |
| other      | —                                     | —               | yes       |

The Curtains and Lighting sections render the line as read-only guidance.
Unconfirmed classes render it with a "default unconfirmed for this venue
class" marker, preserving the caveat printed on the Theatre and Church
sheets.

## Printable field sheet

`src/lib/venue-assessment-sheet.ts` builds a `LetterDoc` for
`renderLetterPdf()` in `src/lib/pdf.ts`, reproducing the class's sheet
layout: the Peak letterhead block, per-page JOB/OPP # + DATE + PAGE n of m,
the class's sections in printed order, the lineset table where enabled, and
the sign-off block. The assessment layer, when enabled, appends its own pages
(usage profile, condition ratings, findings by bucket). The footer carries
`Venue Assessment Rev. <templateRev>`.

Reached from the editor header as "Print sheet", alongside the existing
actions. Server action, same pattern as the existing letter renderers.

## File structure

`field-survey/[id]/controls.tsx` is already 1,419 lines and this design
roughly doubles its section count, so it splits as part of the work — the
kind of targeted improvement warranted by building in it.

**New pure modules** (no DB imports, shared between server store and client
editor, following `survey-intake.ts`'s precedent):

- `src/lib/stores/venue-classes.ts` — the six classes, their subtypes, their
  per-class measurement field sets, per-class systems visibility, and the
  `venueType`/`visitType` migration maps.
- `src/lib/stores/assessment.ts` — condition categories, ratings, usage
  profile vocabularies, budget tiers, `Finding`, `seedFindings()`.
- `src/lib/stores/linesets.ts` — `LinesetRow`, type/condition legends,
  row helpers.

**New server modules:**

- `src/lib/venue-assessment-certs.ts` — cert auto-resolve.
- `src/lib/venue-assessment-sheet.ts` — printable sheet.

**Editor split** — `venue-assessments/[id]/` gains a `sections/` directory:
`custvenue.tsx`, `fields.tsx`, `conditions.tsx`, `photos.tsx`,
`systems.tsx`, `linesets.tsx`, `assessment-usage.tsx`,
`assessment-condition.tsx`, `assessment-findings.tsx`, `signoff.tsx`.
`controls.tsx` keeps draft state, save/stage logic, and layout.

**Modified:**

- `src/lib/stores/surveys.ts` — record shape, `normalize()` migration,
  per-class measurement dispatch.
- `src/lib/stores/survey-intake.ts` — discipline groups gain present-gates,
  sheet fields, `visibleFor`; Tier-3 retired.
- `field-survey/` → `venue-assessments/` (directory move).
- `next.config.ts` — redirect.
- `src/components/nav/nav-data.ts` — label + route map; `active` key stays
  `field`.
- ~20 link sites listed under Phase 2 below.

## Build sequence

| Phase | Work | Depends on |
|---|---|---|
| 1 | Pure model modules; record shape; `normalize()` migration | — |
| 2 | Rename, route move, redirect, call sites | — |
| 3 | Split `controls.tsx`; wire site-visit sections | 1, 2 |
| 4 | Assessment layer UI | 3 |
| 5 | Cert auto-resolve + doctrine in Estimating Rules | 1 |
| 6 | Printable field sheet | 1, 3 |

Phases 1 and 2 touch disjoint files and run in parallel. Phase 5 joins once 1
lands.

**Phase 2 call sites:** `home-field-surveys.tsx`, `(app)/page.tsx`,
`inbox/page.tsx` (link resolver), `leads/lead-drawer.tsx` (×2),
`import/types.ts`, `companies/[id]/page.tsx`, `api/search/route.ts`,
`nav/nav-data.ts` (×2), `lib/queue.ts` (×2), `lib/customer-feed-rows.ts`
(×2), `lib/nav-counts.ts` (×2), `lib/venue-history-server.ts`,
`settings/settings-client.tsx` (copy), `estimator/types.ts` (comment),
`leads/actions.ts` (comment).

## Verification

- `npm run build` clean at the end of every phase.
- Migration is exercised by reading existing seeded surveys: every record in
  `src/db/seed-data.ts` must render with a non-empty `venueClass` and a
  `visitPurpose`, and its measurements must survive untouched.
- The 3D preview (`venue-3d.tsx`) must still build from the same measurement
  keys after the class switch.
- `/field-survey` and `/field-survey?id=FS-1053` must both redirect with the
  query intact.
- Print a sheet for each of the six classes and confirm pagination and the
  sign-off block.

## Out of scope

- The customer-facing Condition & Needs report — exec summary + technical
  appendix (brief §5). Deferred until the form is field-tested.
- Findings spawning quotes, repair jobs, or tasks.
- Dedicated field sets for outdoor/amphitheater and arena.
- Any change to the Inspections or Flame Tests modules. This design reads
  their records and never writes them.
