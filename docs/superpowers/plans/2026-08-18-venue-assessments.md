# Venue Assessments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the five paper site-visit sheets and the Condition & Needs Assessment brief into the Field Surveys module, renamed Venue Assessments — one record with a site-visit layer plus a toggleable advisory assessment layer.

**Architecture:** Three new pure model modules (no DB imports, shared between the server store and the client editor, following `survey-intake.ts`'s precedent) carry venue classification, linesets, and the assessment layer. The record stays a doc-store JSONB document — no drizzle migration. Old records migrate **on read** inside `normalize()`, the pattern this module already uses for its `stage` backfill. The 1,419-line editor splits into a `sections/` directory as part of the work.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Drizzle on Postgres/PGlite, `tsx` test scripts.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-18-venue-assessments-design.md`. Read it before starting any task.
- **Never rename an existing measurement key.** Where a sheet field means the same thing as an existing key, the existing key wins: `proW`, `proH`, `stageDepth`, `gridH`, `wingSL`, `wingSR`, `houseH`, `seating`, `boothLoc`, `boothWD`, `apron`, `centerAisleW`, `platformWidth`, `platformDepth`, `roomWidth`, `roomDepth`, `pitDepth`. This preserves the module's shared-key rule and keeps `venue-3d.tsx` working.
- **Record ids stay `FS-####`.** Do not add a `VA-` prefix or a second id base.
- **The nav `active` key stays `field`.** AGENTS.md requires preserving the prototype's active keys. Only the route string in the map changes.
- **Migration is read-time only.** No stored rewrite, no drizzle migration for the doc body, no `npm run db:generate`.
- **Electrical gets notes only, never a condition rating.** The brief is explicit that this is outside Peak's lane.
- **Findings never spawn quotes, repair jobs, or tasks.** Budget tiers are not a quote.
- **Tests go in `scripts/test-review-and-spec.ts`**, the house harness — a flat script of `ok(condition, message)` assertions. Run with `npm run test:specs`.
- **Never leave a `tsx` script running.** PGlite is single-process and opening it writes. After any `npm run test:specs` or `npm run db:seed`, confirm with `ps aux | grep tsx` that nothing survives. This has destroyed the dev DB three times.
- **NEVER `git add -A`, `git add .`, or `git commit -a`.** The working tree carries ~28
  pre-existing modified files that belong to unrelated in-flight work (the estimator,
  flame-tests, pricing, seed data). Stage only the exact paths your task touched, and run
  `git status --short` before every commit to confirm the staged set.
- **Copy is the sheets' copy.** Field labels come from the printed sheets verbatim, including their capitalisation of venue-specific terms.

---

## File Structure

**New pure modules** (no DB imports — importable from both server stores and client components):

| File | Responsibility |
|---|---|
| `src/lib/stores/venue-classes.ts` | The six classes, their subtypes, per-class measurement field sets, per-class systems visibility, `venueType`/`visitType` migration maps |
| `src/lib/stores/linesets.ts` | `LinesetRow`, the D/M/R/L/B/C/S/E/T/O and G/F/P/X legends, row helpers |
| `src/lib/stores/assessment.ts` | Condition categories, ratings, usage vocabularies, budget tiers, `Finding`, `seedFindings()` |

**New server modules:**

| File | Responsibility |
|---|---|
| `src/lib/venue-assessment-certs.ts` | Resolve flame-test and inspection references for a venue |
| `src/lib/venue-assessment-sheet.ts` | Build a `LetterDoc` for the printable field sheet |

**Editor split** — `src/app/(app)/venue-assessments/[id]/sections/`:
`fields.tsx`, `custvenue.tsx`, `conditions.tsx`, `photos.tsx`, `systems.tsx`, `linesets.tsx`, `assessment-usage.tsx`, `assessment-condition.tsx`, `assessment-findings.tsx`, `signoff.tsx`. `controls.tsx` retains draft state, save/stage logic, and layout only.

**Modified:** `src/lib/stores/surveys.ts`, `src/lib/stores/survey-intake.ts`, `next.config.ts`, `src/components/nav/nav-data.ts`, and the call sites enumerated in Task 6.

---

## Task 1: Venue classes model

**Files:**
- Create: `src/lib/stores/venue-classes.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `MeasureField` from `src/lib/stores/surveys.ts` (type-only import — do not import values, that would create a cycle).
- Produces: `VenueClass`, `VENUE_CLASSES`, `SUBTYPES`, `VISIT_PURPOSES`, `classMeasureFields(cls)`, `venueClassFor(venueType)`, `venueSubtypeFor(venueType)`, `visitPurposeFor(visitType)`, `TIER1_WIDTH_BY_CLASS`, `TIER1_DEPTH_BY_CLASS`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`, immediately before the `asyncChecks()` call at the end of the file:

```ts
/* --- Venue Assessments: class model --- */
import {
  VENUE_CLASSES, SUBTYPES, VISIT_PURPOSES, classMeasureFields,
  venueClassFor, venueSubtypeFor, visitPurposeFor,
  TIER1_WIDTH_BY_CLASS, TIER1_DEPTH_BY_CLASS,
} from "@/lib/stores/venue-classes";

ok(VENUE_CLASSES.length === 6, `six venue classes (got ${VENUE_CLASSES.length})`);
ok(
  VENUE_CLASSES.map((c) => c.key).join(",") ===
    "theatre,auditorium,church,gym,convention,other",
  "venue classes in spec order"
);
ok(venueClassFor("Proscenium theater") === "theatre", "proscenium theater -> theatre");
ok(venueClassFor("Black box") === "theatre", "black box -> theatre");
ok(venueClassFor("Worship / sanctuary") === "church", "worship -> church");
ok(venueClassFor("Gymnasium / gym stage") === "gym", "gym stage -> gym");
ok(venueClassFor("Arena") === "theatre", "arena -> theatre");
ok(venueClassFor("Multipurpose room") === "convention", "multipurpose -> convention");
ok(venueClassFor("Outdoor / amphitheater") === "other", "outdoor -> other");
ok(venueClassFor("") === "theatre", "empty venue type falls back to theatre");
ok(venueClassFor("Nonsense") === "theatre", "unknown venue type falls back to theatre");
ok(venueSubtypeFor("Black box") === "Black box / flexible", "black box carries its subtype");
ok(venueSubtypeFor("Outdoor / amphitheater") === "", "outdoor has no subtype");
ok(
  VENUE_CLASSES.every((c) => SUBTYPES[c.key] !== undefined),
  "every class has a subtype list (other may be empty)"
);
ok(
  VENUE_CLASSES.filter((c) => c.key !== "other").every((c) => SUBTYPES[c.key].length > 0),
  "every class but 'other' has at least one subtype"
);
ok(
  Object.values(SUBTYPES).every((list) => list.every((s) => typeof s === "string" && s.length > 0)),
  "no empty subtype strings"
);
ok(visitPurposeFor("Budgetary walk-through") === "Bid walk", "budgetary -> bid walk");
ok(visitPurposeFor("Service call") === "Repair / service", "service call -> repair/service");
ok(visitPurposeFor("Design verification") === "New system design", "design verification -> new system design");
ok(visitPurposeFor("") === "", "empty visit type stays empty");
ok(VISIT_PURPOSES.length === 6, `six visit purposes (got ${VISIT_PURPOSES.length})`);
ok(VISIT_PURPOSES[0] === "New system design", "sheet order preserved");

// Every class resolves to at least one width key and one depth key, and every
// such key must actually exist in that class's field set. This is the hard
// invariant that keeps the Tier-1 gate satisfiable on every class.
ok(
  VENUE_CLASSES.every((c) => {
    const keys = classMeasureFields(c.key).map((f) => f.key);
    const w = TIER1_WIDTH_BY_CLASS[c.key];
    const d = TIER1_DEPTH_BY_CLASS[c.key];
    return !!w && !!d && keys.includes(w) && keys.includes(d);
  }),
  "every class has a width+depth key present in its own field set"
);
ok(classMeasureFields("gym").some((f) => f.key === "courtLength"), "gym asks court length");
ok(classMeasureFields("gym").some((f) => f.key === "dividerSpan"), "gym asks divider curtain span");
ok(classMeasureFields("gym").some((f) => f.key === "bleacherType"), "gym asks bleacher type");
ok(classMeasureFields("auditorium").some((f) => f.key === "pinRail"), "auditorium asks pin rail location");
ok(classMeasureFields("auditorium").some((f) => f.key === "loadingGallery"), "auditorium asks loading gallery");
ok(classMeasureFields("theatre").some((f) => f.key === "proW"), "theatre reuses the existing proW key");
ok(classMeasureFields("church").some((f) => f.key === "centerAisleW"), "church reuses the existing centerAisleW key");
ok(classMeasureFields("convention").some((f) => f.key === "rigPointCapacity"), "convention asks rigging point capacity");
ok(
  classMeasureFields("other").length > 0,
  "the 'other' class has a generic field set, not an empty one"
);
// No class may invent a key that duplicates an existing one under a new name.
const RESERVED = ["proW","proH","stageDepth","gridH","wingSL","wingSR","houseH","seating","boothLoc","boothWD","apron","centerAisleW","platformWidth","platformDepth","roomWidth","roomDepth","pitDepth"];
ok(
  VENUE_CLASSES.every((c) =>
    classMeasureFields(c.key).every((f) => !/^(prosceniumWidth|stageW|ceilingHeight|houseHeight)$/.test(f.key))
  ),
  "no class re-invents a reserved dimension under a new key name"
);
ok(RESERVED.length === 17, "reserved key list is the spec's list");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — the process exits non-zero with a module-resolution error, `Cannot find module '@/lib/stores/venue-classes'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/stores/venue-classes.ts`:

```ts
/**
 * Venue classification for Venue Assessments (D132, 2026-08-18).
 *
 * The five paper site-visit sheets — Theatre (Rev. 3.0), Auditorium, Church
 * (Rev. 2.1), Convention Center (Rev. 2.1), Gym (Rev. 5.1) — are each
 * organized around a venue class, and each carries its own "<VENUE> TYPE"
 * checkbox row. This module is the app's port of that structure: the class
 * drives which measurement set and which systems fields appear; the subtype
 * is that class's own checkbox options, verbatim off the sheet.
 *
 * Pure module — no DB imports, safe for both the server store and the client
 * editor (same contract as survey-intake.ts).
 *
 * Migration: the module previously keyed off a flat seven-value `venueType`.
 * Those values map forward here and are applied on read in surveys.ts
 * normalize(), never as a stored rewrite.
 */

import type { MeasureField } from "./surveys";

export type VenueClass =
  | "theatre" | "auditorium" | "church" | "gym" | "convention" | "other";

export const VENUE_CLASSES: Array<{ key: VenueClass; label: string; blurb: string }> = [
  { key: "theatre", label: "Theatre", blurb: "Dead-hung / fixed-pipe, no fly system" },
  { key: "auditorium", label: "Auditorium", blurb: "Fly system present or to be confirmed on site" },
  { key: "church", label: "Church", blurb: "Worship space" },
  { key: "gym", label: "Gym", blurb: "Small venue class" },
  { key: "convention", label: "Convention Center", blurb: "Open, flexible space — no fixed stage" },
  { key: "other", label: "Other", blurb: "Outdoor, arena, or anything without a sheet" },
];

/** Each class's own "<VENUE> TYPE" checkbox row, verbatim off the sheet. */
export const SUBTYPES: Record<VenueClass, string[]> = {
  theatre: [
    "Single proscenium", "Black box / flexible", "Thrust / arena",
    "Studio theatre", "Multi-purpose (has fly system)", "Other",
  ],
  auditorium: [
    "Single proscenium", "Thrust / arena", "Multi-purpose (cafetorium)",
    "Black box / flexible", "Other",
  ],
  church: [
    "Sanctuary — traditional", "Sanctuary — contemporary",
    "Multi-purpose / fellowship hall", "Chapel", "Divisible worship space", "Other",
  ],
  gym: [
    "Single court", "Divisible — 2 court", "Divisible — 3 court",
    "Practice / aux gym", "Wrestling room", "Multi-purpose (has stage)", "Other",
  ],
  convention: [
    "Meeting room", "Ballroom / multi-purpose", "Divisible space",
    "Courtroom / assembly room", "Exhibit / flex hall", "Other",
  ],
  other: [],
};

/** PURPOSE OF VISIT, from the sheets. Replaces the app's VISIT_TYPES. */
export const VISIT_PURPOSES: string[] = [
  "New system design", "Bid walk", "Repair / service",
  "Annual inspection", "Punch list", "Other",
];

/* ---- migration maps (spec §Migration strategy) ---- */

const CLASS_BY_VENUE_TYPE: Record<string, VenueClass> = {
  "Proscenium theater": "theatre",
  "Black box": "theatre",
  "Worship / sanctuary": "church",
  "Gymnasium / gym stage": "gym",
  Arena: "theatre",
  "Multipurpose room": "convention",
  "Outdoor / amphitheater": "other",
};

const SUBTYPE_BY_VENUE_TYPE: Record<string, string> = {
  "Proscenium theater": "Single proscenium",
  "Black box": "Black box / flexible",
  "Worship / sanctuary": "Sanctuary — traditional",
  "Gymnasium / gym stage": "Multi-purpose (has stage)",
  Arena: "Thrust / arena",
  "Multipurpose room": "Ballroom / multi-purpose",
  "Outdoor / amphitheater": "",
};

const PURPOSE_BY_VISIT_TYPE: Record<string, string> = {
  "Initial site survey": "New system design",
  "Budgetary walk-through": "Bid walk",
  "Design verification": "New system design",
  "Punch / follow-up": "Punch list",
  "Service call": "Repair / service",
};

/** Unknown and empty both fall back to theatre — the app's original default
 *  venue type was "Proscenium theater", the first VENUE_TYPES entry. */
export function venueClassFor(venueType: string | undefined): VenueClass {
  return CLASS_BY_VENUE_TYPE[venueType || ""] || "theatre";
}

export function venueSubtypeFor(venueType: string | undefined): string {
  const hit = SUBTYPE_BY_VENUE_TYPE[venueType || ""];
  return hit === undefined ? "" : hit;
}

export function visitPurposeFor(visitType: string | undefined): string {
  if (!visitType) return "";
  return PURPOSE_BY_VISIT_TYPE[visitType] || "";
}

/* ---- per-class measurement field sets ----
 * Labels are the sheets' labels. Keys reuse the existing module's keys
 * wherever the dimension is the same — see the plan's Global Constraints. */

const THEATRE_FIELDS: MeasureField[] = [
  { key: "proW", label: "Proscenium width" },
  { key: "proH", label: "Proscenium height" },
  { key: "stageDepth", label: "Stage depth (plaster line–back wall)" },
  { key: "wingSL", label: "Wing space — SL" },
  { key: "wingSR", label: "Wing space — SR" },
  { key: "gridH", label: "Grid / ceiling height over stage" },
  { key: "apron", label: "Apron / forestage depth" },
  { key: "structure", label: "Structure at grid (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "houseH", label: "House ceiling height" },
  { key: "obstructions", label: "Obstructions (house curtain, HVAC, catwalks)" },
];

const AUDITORIUM_FIELDS: MeasureField[] = [
  { key: "proW", label: "Proscenium width" },
  { key: "proH", label: "Proscenium height" },
  { key: "stageDepth", label: "Stage depth (plaster line–back wall)" },
  { key: "wingSL", label: "Wing space — SL" },
  { key: "wingSR", label: "Wing space — SR" },
  { key: "gridH", label: "Grid height over stage (to loft blocks)" },
  { key: "trimHigh", label: "High trim" },
  { key: "trimLow", label: "Low trim" },
  { key: "apron", label: "Apron / forestage depth" },
  { key: "loadingGallery", label: "Loading gallery — location / height" },
  { key: "structure", label: "Structure at grid (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "houseH", label: "House ceiling height" },
  { key: "pinRail", label: "Pin rail / locking rail location" },
  { key: "obstructions", label: "Obstructions (house curtain, HVAC, catwalks)" },
  { key: "seating", label: "Seating capacity" },
  { key: "seatingConfig", label: "Seating config / rake" },
  { key: "pitDesc", label: "Orchestra pit? — type / size / lift" },
  { key: "boothLoc", label: "Booth location", type: "select", options: BOOTH_LOCATIONS_REF },
  { key: "boothWD", label: "Booth size (W × D)" },
];

const CHURCH_FIELDS: MeasureField[] = [
  { key: "sanctuaryLength", label: "Sanctuary length (rear wall–platform)" },
  { key: "sanctuaryWidth", label: "Sanctuary width (wall–wall)" },
  { key: "ceilingCenter", label: "Ceiling ht. — center" },
  { key: "ceilingPlatform", label: "Ceiling ht. — over platform" },
  { key: "platformWidth", label: "Platform width" },
  { key: "platformDepth", label: "Platform depth" },
  { key: "centerAisleW", label: "Center aisle width" },
  { key: "structure", label: "Structure at ceiling (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "seating", label: "Seating capacity (approx.)" },
  { key: "obstructions", label: "Obstructions (sound booth, HVAC, beams)" },
];

const GYM_FIELDS: MeasureField[] = [
  { key: "courtLength", label: "Court length (baseline–baseline)" },
  { key: "courtWidth", label: "Court width (sideline–sideline)" },
  { key: "ceilingCenter", label: "Ceiling ht. — center" },
  { key: "ceilingSidewall", label: "Ceiling ht. — sidewall" },
  { key: "wallToWall", label: "Wall-to-wall (room)" },
  { key: "dividerSpan", label: "Divider curtain span" },
  { key: "structure", label: "Structure at ceiling (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "bleacherType", label: "Bleacher type (fixed/telescoping)" },
  { key: "obstructions", label: "Obstructions (hoops, banners, HVAC)" },
];

const CONVENTION_FIELDS: MeasureField[] = [
  { key: "roomDepth", label: "Room length" },
  { key: "roomWidth", label: "Room width" },
  { key: "ceilingCenter", label: "Ceiling ht. — center" },
  { key: "ceilingPerimeter", label: "Ceiling ht. — perimeter" },
  { key: "columnSpacing", label: "Column spacing / clear span" },
  { key: "divisibleWallSpan", label: "Divisible wall span (if applicable)" },
  { key: "structure", label: "Structure at ceiling (steel/joist/deck)" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "rigPointCapacity", label: "Rigging point capacity (lb), if any" },
  { key: "roomCapacity", label: "Room capacity (approx.)" },
  { key: "obstructions", label: "Obstructions (columns, sprinklers, HVAC)" },
];

const OTHER_FIELDS: MeasureField[] = [
  { key: "roomWidth", label: "Room / floor width" },
  { key: "roomDepth", label: "Room / floor depth" },
  { key: "ceilingCenter", label: "Ceiling / steel height" },
  { key: "structure", label: "Structure overhead (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "seating", label: "Capacity (approx.)" },
  { key: "obstructions", label: "Obstructions" },
];

const FIELDS_BY_CLASS: Record<VenueClass, MeasureField[]> = {
  theatre: THEATRE_FIELDS,
  auditorium: AUDITORIUM_FIELDS,
  church: CHURCH_FIELDS,
  gym: GYM_FIELDS,
  convention: CONVENTION_FIELDS,
  other: OTHER_FIELDS,
};

export function classMeasureFields(cls: VenueClass): MeasureField[] {
  return FIELDS_BY_CLASS[cls] || OTHER_FIELDS;
}

/** Tier-1 gate keys per class (spec §"Tier 1 survives; its key lists grow").
 *  Hard invariant: each value MUST appear in that class's own field set. */
export const TIER1_WIDTH_BY_CLASS: Record<VenueClass, string> = {
  theatre: "proW", auditorium: "proW", church: "sanctuaryWidth",
  gym: "courtWidth", convention: "roomWidth", other: "roomWidth",
};

export const TIER1_DEPTH_BY_CLASS: Record<VenueClass, string> = {
  theatre: "stageDepth", auditorium: "stageDepth", church: "sanctuaryLength",
  gym: "courtLength", convention: "roomDepth", other: "roomDepth",
};
```

`AUDITORIUM_FIELDS` references `BOOTH_LOCATIONS_REF`, which must be **declared above the field sets**, near the top of the file. It is a local copy rather than a value import from `surveys.ts`, because `surveys.ts` imports this module in Task 4 and a value import would close the cycle:

```ts
/** Local copy of surveys.ts BOOTH_LOCATIONS — value-imported from surveys.ts
 *  would cycle, since surveys.ts imports this module. Keep the two in sync. */
const BOOTH_LOCATIONS_REF: string[] = [
  "Rear of house — center", "Rear of house — left", "Rear of house — right",
  "Balcony", "Floor / portable", "None",
];
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on every new `venue classes` line, and `ALL PASSED` at the end. Then confirm no stray process: `ps aux | grep tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/venue-classes.ts scripts/test-review-and-spec.ts
git commit -m "feat(assessments): venue class model — 6 classes, subtypes, per-class field sets, migration maps"
```

---

## Task 2: Lineset model

**Files:**
- Create: `src/lib/stores/linesets.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LinesetRow`, `LinesetType`, `LinesetCond`, `LINESET_TYPES`, `LINESET_CONDS`, `blankLinesetRow(pos)`, `newLinesetId()`, `linesetTypeLabel(t)`, `linesetCondLabel(c)`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- Venue Assessments: linesets --- */
import {
  LINESET_TYPES, LINESET_CONDS, blankLinesetRow, newLinesetId,
  linesetTypeLabel, linesetCondLabel,
} from "@/lib/stores/linesets";

ok(LINESET_TYPES.map((t) => t.key).join("") === "DMRLBCSETO", "type legend is the sheet's D M R L B C S E T O");
ok(LINESET_CONDS.map((c) => c.key).join("") === "GFPX", "condition legend is the sheet's G F P X");
ok(linesetTypeLabel("D") === "Draw / main", "D is draw/main");
ok(linesetTypeLabel("O") === "Open / spare", "O is open/spare");
ok(linesetCondLabel("X") === "Missing / inoperable", "X is missing/inoperable");
ok(linesetTypeLabel("Z" as never) === "", "unknown type code renders empty, never throws");
ok(linesetCondLabel("Z" as never) === "", "unknown cond code renders empty, never throws");
const lsr = blankLinesetRow(3);
ok(lsr.pos === "3", "blank row carries its position as a string");
ok(lsr.type === "" && lsr.cond === "", "blank row starts unrated and untyped");
ok(
  ["id","pos","distFromPL","setName","type","battenLength","liftLines","goods","finishedWH","arborLoad","trimLow","trimHigh","cond","notes"]
    .every((k) => k in lsr),
  "blank row has all 14 Theatre-superset columns"
);
ok(Object.keys(lsr).length === 14, `blank row has exactly 14 keys (got ${Object.keys(lsr).length})`);
ok(newLinesetId() !== newLinesetId(), "lineset ids are unique");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `Cannot find module '@/lib/stores/linesets'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/stores/linesets.ts`:

```ts
/**
 * Lineset schedule for Venue Assessments (D132, 2026-08-18).
 *
 * One unified table on the Theatre sheet's superset (12 printed columns,
 * 14 fields here — the sheet's "TRIM LOW / HIGH" is one printed cell holding
 * two values, and each row carries an internal id). The Auditorium sheet's
 * 7-column table is a subset: its "travel" maps onto trimLow/trimHigh and its
 * "arbor / motor capacity" onto arborLoad.
 *
 * Type and condition keep the sheets' printed legends — reps already write
 * these codes on paper. Deliberately NOT the assessment layer's
 * Good/Monitor/Replace scale, and deliberately not the Inspections rubric.
 *
 * Pure module — no DB imports.
 */

export type LinesetType = "" | "D" | "M" | "R" | "L" | "B" | "C" | "S" | "E" | "T" | "O";
export type LinesetCond = "" | "G" | "F" | "P" | "X";

export const LINESET_TYPES: Array<{ key: Exclude<LinesetType, "">; label: string }> = [
  { key: "D", label: "Draw / main" },
  { key: "M", label: "Midstage traveler" },
  { key: "R", label: "Rear traveler" },
  { key: "L", label: "Legs" },
  { key: "B", label: "Border" },
  { key: "C", label: "Cyc" },
  { key: "S", label: "Scrim / bounce" },
  { key: "E", label: "Electric" },
  { key: "T", label: "Track only" },
  { key: "O", label: "Open / spare" },
];

export const LINESET_CONDS: Array<{ key: Exclude<LinesetCond, "">; label: string }> = [
  { key: "G", label: "Good" },
  { key: "F", label: "Fair / monitor" },
  { key: "P", label: "Poor — repair or replace" },
  { key: "X", label: "Missing / inoperable" },
];

export interface LinesetRow {
  id: string;
  pos: string;
  distFromPL: string;
  setName: string;
  type: LinesetType;
  battenLength: string;
  liftLines: string;
  goods: string;
  finishedWH: string;
  arborLoad: string;
  trimLow: string;
  trimHigh: string;
  cond: LinesetCond;
  notes: string;
}

export function linesetTypeLabel(t: LinesetType): string {
  return LINESET_TYPES.find((x) => x.key === t)?.label || "";
}

export function linesetCondLabel(c: LinesetCond): string {
  return LINESET_CONDS.find((x) => x.key === c)?.label || "";
}

let lsSeq = 0;
export function newLinesetId(): string {
  lsSeq += 1;
  return "ls" + Date.now().toString(36) + lsSeq.toString(36);
}

export function blankLinesetRow(pos: number): LinesetRow {
  return {
    id: newLinesetId(), pos: String(pos), distFromPL: "", setName: "",
    type: "", battenLength: "", liftLines: "", goods: "", finishedWH: "",
    arborLoad: "", trimLow: "", trimHigh: "", cond: "", notes: "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on every `lineset` line. Then `ps aux | grep tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/linesets.ts scripts/test-review-and-spec.ts
git commit -m "feat(assessments): lineset schedule model on the Theatre superset"
```

---

## Task 3: Assessment layer model and findings engine

**Files:**
- Create: `src/lib/stores/assessment.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ConditionCategory`, `ConditionRating`, `CONDITION_CATEGORIES`, `CONDITION_RATINGS`, `EVENT_TYPES`, `EVENT_FREQUENCIES`, `STAFF_TIERS`, `GROWTH_GOALS`, `BUDGET_TIERS`, `FINDING_BUCKETS`, `Finding`, `InspectionRef`, `AssessmentData`, `blankAssessment()`, `seedFindings(a)`, `newFindingId()`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- Venue Assessments: assessment layer --- */
import {
  CONDITION_CATEGORIES, CONDITION_RATINGS, BUDGET_TIERS, FINDING_BUCKETS,
  EVENT_TYPES, EVENT_FREQUENCIES, STAFF_TIERS, GROWTH_GOALS,
  blankAssessment, seedFindings, newFindingId,
} from "@/lib/stores/assessment";

ok(CONDITION_CATEGORIES.length === 10, `ten condition categories (got ${CONDITION_CATEGORIES.length})`);
ok(
  CONDITION_CATEGORIES.map((c) => c.key).join(",") ===
    "rigging,curtains,motors,lighting.console,lighting.dimming,lighting.fixtures,av.console,av.speakers,av.mics,av.video",
  "categories in brief order"
);
ok(
  !CONDITION_CATEGORIES.some((c) => c.key.startsWith("electrical")),
  "electrical is NOT a rated category — brief says outside Peak's lane"
);
ok(CONDITION_RATINGS.map((r) => r.key).join(",") === "good,monitor,replace", "Good/Monitor/Replace scale");
ok(BUDGET_TIERS.length === 4, "four budget tiers");
ok(BUDGET_TIERS[0].key === "u5k" && BUDGET_TIERS[3].key === "over100k", "budget tiers span <$5k to $100k+");
ok(FINDING_BUCKETS.map((b) => b.key).join(",") === "now,soon,later", "Now/Soon/Later buckets");
ok(EVENT_TYPES.length === 6, "six event types incl. other");
ok(EVENT_FREQUENCIES.length === 4, "four frequencies");
ok(STAFF_TIERS.length === 4, "four staff capability tiers");
ok(GROWTH_GOALS.length === 5, "five growth goals incl. other");

const a0 = blankAssessment();
ok(Object.keys(a0.conditions).length === 10, "blank assessment has all ten categories");
ok(
  CONDITION_CATEGORIES.every((c) => a0.conditions[c.key].rating === ""),
  "blank assessment starts every category unrated"
);
ok(a0.findings.length === 0, "blank assessment has no findings");
ok(a0.electricalNotes === "", "blank assessment has an electrical notes field");

// good is never flagged; monitor and replace each seed one line
const a1 = blankAssessment();
a1.conditions.rigging.rating = "good";
a1.conditions.curtains.rating = "monitor";
a1.conditions.curtains.notes = "Main shows daylight at the seams";
a1.conditions["av.mics"].rating = "replace";
const r1 = seedFindings(a1);
ok(r1.seeded.length === 2, `two flagged categories seed two findings (got ${r1.seeded.length})`);
ok(!r1.seeded.some((f) => f.categories.includes("rigging")), "a 'good' category never seeds a finding");
const curtainFinding = r1.seeded.find((f) => f.categories.includes("curtains"));
ok(!!curtainFinding, "curtains seeded a finding");
ok(curtainFinding!.title === "Curtains / Soft Goods", "seeded title is the category label");
ok(curtainFinding!.detail === "Main shows daylight at the seams", "seeded detail is the category notes");
ok(curtainFinding!.bucket === "", "seeded finding starts with no bucket — the assessor decides");
ok(curtainFinding!.budgetTier === "", "seeded finding starts with no budget tier");
ok(r1.unresolved.length === 0, "freshly seeded findings leave nothing unresolved");

// already-covered categories are not re-seeded, and merging is honoured
const a2 = blankAssessment();
a2.conditions["lighting.console"].rating = "replace";
a2.conditions["lighting.dimming"].rating = "replace";
a2.findings = [{
  id: "f1", categories: ["lighting.console", "lighting.dimming"], bucket: "now",
  title: "Lighting system replacement", detail: "", budgetTier: "25to100k", photoIds: [],
}];
const r2 = seedFindings(a2);
ok(r2.seeded.length === 0, "a merged finding suppresses re-seeding of both its categories");
ok(r2.unresolved.length === 0, "a merged finding leaves nothing unresolved");

// a flagged category with no covering finding is reported as a gap
const a3 = blankAssessment();
a3.conditions.motors.rating = "monitor";
a3.conditions.curtains.rating = "replace";
a3.findings = [{
  id: "f9", categories: ["curtains"], bucket: "soon",
  title: "Curtain replacement", detail: "", budgetTier: "5to25k", photoIds: [],
}];
ok(seedFindings(a3).unresolved.join(",") === "motors", "an uncovered flagged category is unresolved");
ok(seedFindings(a3).seeded.length === 0, "no silent re-seeding once the assessor is driving");

// seedFindings must not mutate its input
const a4 = blankAssessment();
a4.conditions.rigging.rating = "replace";
seedFindings(a4);
ok(a4.findings.length === 0, "seedFindings is pure — it never mutates the assessment");
ok(newFindingId() !== newFindingId(), "finding ids are unique");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `Cannot find module '@/lib/stores/assessment'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/stores/assessment.ts`.

**The `Finding` type.** Note that `bucket` and `budgetTier` are both
empty-able — a seeded finding has neither until the assessor triages it:

```ts
export type FindingBucket = "" | "now" | "soon" | "later";
export type BudgetTier = "" | "u5k" | "5to25k" | "25to100k" | "over100k";

export interface Finding {
  id: string;
  categories: ConditionCategory[];
  bucket: FindingBucket;
  title: string;
  detail: string;
  budgetTier: BudgetTier;
  photoIds: string[];
}
```

**The `seedFindings` rule.** One behaviour, two phases, driven by whether the
assessor has started triaging:

- **No findings recorded yet** — the assessor has not started. Seed one line
  per flagged (`monitor` or `replace`) category, pre-filled with the category
  label and its notes. `unresolved` is empty.
- **Findings already exist** — the assessor is driving. Never re-add a line
  they may have deliberately removed. Report uncovered flagged categories in
  `unresolved` instead, and seed nothing.

A category is *covered* when it appears in any finding's `categories` array,
which is what makes merging work: one finding listing both
`lighting.console` and `lighting.dimming` covers both.

`seedFindings` **never mutates its argument** — the editor calls it on every
render to compute the gap warning, so a mutating version would corrupt the
draft.

```ts
export function seedFindings(a: AssessmentData): {
  seeded: Finding[];
  unresolved: ConditionCategory[];
} {
  const covered = new Set<string>();
  a.findings.forEach((f) => f.categories.forEach((c) => covered.add(c)));
  const flagged = CONDITION_CATEGORIES.filter(
    (c) => a.conditions[c.key]?.rating === "monitor" || a.conditions[c.key]?.rating === "replace"
  );
  const missing = flagged.filter((c) => !covered.has(c.key));
  // With no findings recorded yet, the assessor has not started triaging —
  // seed a line per flagged category. Once findings exist, the assessor is
  // driving, so an uncovered category is a gap to surface, not a line to
  // silently re-add.
  if (a.findings.length === 0) {
    return {
      seeded: missing.map((c) => ({
        id: newFindingId(),
        categories: [c.key],
        bucket: "" as const,
        title: c.label,
        detail: a.conditions[c.key].notes,
        budgetTier: "" as const,
        photoIds: [],
      })),
      unresolved: [],
    };
  }
  return { seeded: [], unresolved: missing.map((c) => c.key) };
}
```

This satisfies all three test blocks: `r1` (no findings yet) seeds two and
reports none unresolved; `r2` (findings exist, both categories covered by one
merged finding) seeds none and reports none; `a3` (findings exist, covering
curtains but not motors) seeds none and reports `motors`.

The rest of the module is declarative constant lists plus `blankAssessment()`, which returns every category at `rating: ""`, `notes: ""`, an empty `findings` array, empty `usage` with `eventTypes: []`, and `electricalNotes: ""`. Mirror `survey-intake.ts`'s `newInventoryId()` for `newFindingId()`.

Vocabularies, verbatim from the brief:
- `EVENT_TYPES`: assemblies, theatrical productions, concerts/recitals, sports, community rentals, other.
- `EVENT_FREQUENCIES`: weekly, monthly, a few times a year, rare.
- `STAFF_TIERS`: trained theatrical/AV staff; teacher or staff with some training; students only; no dedicated operator.
- `GROWTH_GOALS`: expand drama/music program; more community rentals; multi-use conversion; none planned; other.
- `BUDGET_TIERS`: `u5k` "<$5k", `5to25k` "$5–25k", `25to100k` "$25–100k", `over100k` "$100k+".
- `CONDITION_CATEGORIES` labels: Rigging (hardware/mechanics); Curtains / Soft Goods; Motors; Lighting — console / control; Lighting — dimming; Lighting — fixtures / instruments; Sound — console / mixing; Sound — speakers / amplification; Sound — mics / inputs; Video / projection.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on every `assessment layer` line. Then `ps aux | grep tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/assessment.ts scripts/test-review-and-spec.ts
git commit -m "feat(assessments): condition categories, usage vocabularies, findings engine"
```

---

## Task 4: Record shape and read-time migration

**Files:**
- Modify: `src/lib/stores/surveys.ts`
- Modify: `src/lib/stores/survey-intake.ts` (Tier-1 key lists only)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: everything Tasks 1–3 produce.
- Produces: the extended `SurveyDraft`/`SurveyRecord` shape; `normalize()` performing the migration; `measureFieldsForClass(cls)` replacing `measureFields(venueType)` at call sites.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`, inside the existing `asyncChecks()` body so it can read seeded records:

```ts
  /* --- Venue Assessments: record migration --- */
  {
    const { getAll } = await import("@/lib/stores/surveys");
    const all = await getAll();
    ok(all.length > 0, "seeded surveys exist to migrate");
    ok(
      all.every((s) => !!(s as Record<string, unknown>).venueClass),
      "every existing record reads with a venueClass"
    );
    ok(
      all.every((s) => typeof (s as Record<string, unknown>).visitPurpose === "string"),
      "every existing record reads with a visitPurpose"
    );
    const fs1053 = all.find((s) => s.id === "FS-1053");
    ok(!!fs1053, "FS-1053 is present in the seed");
    ok(
      (fs1053 as Record<string, unknown>).venueClass === "theatre",
      "FS-1053 (Proscenium theater) migrates to theatre"
    );
    ok(
      (fs1053 as Record<string, unknown>).venueSubtype === "Single proscenium",
      "FS-1053 gains the matching subtype"
    );
    ok(fs1053!.venueType === "Proscenium theater", "venueType is retained for existing call sites");
    const fs1055 = all.find((s) => s.id === "FS-1055");
    ok(
      (fs1055 as Record<string, unknown>).venueClass === "church",
      "FS-1055 (Worship / sanctuary) migrates to church"
    );
    // measurements must survive the class switch untouched
    ok(
      all.every((s) => s.measurements && typeof s.measurements === "object"),
      "measurements survive migration"
    );
    const withMeas = all.find((s) => Object.keys(s.measurements || {}).length > 0);
    ok(!!withMeas, "at least one seeded record carries measurements");
    ok(
      Object.values(withMeas!.measurements).every((v) => typeof v === "string" || typeof v === "boolean"),
      "measurement values are untouched primitives"
    );
    // new sub-objects default, never undefined
    ok(Array.isArray((fs1053 as Record<string, unknown>).linesets), "linesets defaults to an array");
    ok(
      (fs1053 as Record<string, unknown>).assessmentEnabled === false,
      "the assessment layer is off by default"
    );
    ok(
      typeof (fs1053 as Record<string, unknown>).assessment === "object",
      "assessment defaults to an object, never undefined"
    );
    ok(
      typeof (fs1053 as Record<string, unknown>).signoff === "object",
      "signoff defaults to an object"
    );
    ok(
      (fs1053 as Record<string, unknown>).templateRev === "1.0",
      "records stamp the template revision"
    );
  }
```

And outside `asyncChecks()`, a pure check of the Tier-1 extension:

```ts
/* --- Venue Assessments: Tier-1 keys cover the new classes --- */
import { TIER1_WIDTH_KEYS, TIER1_DEPTH_KEYS, tier1Complete } from "@/lib/stores/survey-intake";

ok(TIER1_WIDTH_KEYS.includes("courtWidth"), "Tier-1 width accepts the gym's court width");
ok(TIER1_WIDTH_KEYS.includes("sanctuaryWidth"), "Tier-1 width accepts the church's sanctuary width");
ok(TIER1_DEPTH_KEYS.includes("courtLength"), "Tier-1 depth accepts the gym's court length");
ok(TIER1_DEPTH_KEYS.includes("sanctuaryLength"), "Tier-1 depth accepts the church's sanctuary length");
ok(
  tier1Complete({
    venue: "Lincoln HS Gym", contact: "Pat Lee",
    contactEmail: "p@x.org", contactPhone: "555-0100",
    measurements: { courtWidth: "50", courtLength: "84" },
  }),
  "a gym record completes Tier 1 on court dimensions alone"
);
ok(
  !tier1Complete({
    venue: "Lincoln HS Gym", contact: "Pat Lee",
    contactEmail: "p@x.org", contactPhone: "555-0100",
    measurements: { courtWidth: "50" },
  }),
  "a gym record missing court length does NOT complete Tier 1"
);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `TIER1_WIDTH_KEYS.includes("courtWidth")` is false, and the migration assertions fail because `venueClass` is undefined on every record.

- [ ] **Step 3: Write the implementation**

**3a.** In `src/lib/stores/survey-intake.ts`, extend the two key lists (do not remove existing entries — old records depend on them):

```ts
export const TIER1_WIDTH_KEYS = [
  "proW", "roomWidth", "platformWidth", "stageWidth", "floorWidth",
  "courtWidth", "sanctuaryWidth",
];
export const TIER1_DEPTH_KEYS = [
  "stageDepth", "roomDepth", "platformDepth", "floorDepth",
  "courtLength", "sanctuaryLength",
];
```

**3b.** In `src/lib/stores/surveys.ts`, add the new fields to `SurveyDraft` and to the `def` object inside `blank()`. Every new field needs a default in `blank()` — the function is documented as "the single source of the record shape", and `blank()` is what `create()` builds from.

```ts
  // ---- Venue Assessments (D132) — site-visit layer ----
  venueClass: VenueClass;
  venueSubtype: string;
  visitPurpose: string;
  templateRev: string;
  // access & site conditions, from the sheets
  loadingDoorSize: string;
  liftHeight: string;
  pathToFloor: string;
  workingHours: string;
  blackoutDates: string;
  floorProtection: string;
  badgingRequired: string;
  firstImpressions: string;
  // quote questions, from the sheets
  budget: string;
  fiscalYearSpendBy: string;
  whoDecides: string;
  targetInstallWindow: string;
  // life safety (auditorium sheet p.5, offered on any class)
  lifeSafety: { deluge: string; smokeVent: string; adaNotes: string; egressNotes: string };
  // lineset schedule
  linesetsEnabled: boolean;
  linesets: LinesetRow[];
  // close-out
  signoff: {
    repName: string; repSignedAt: string;
    contactName: string; contactSignedAt: string;
    reviewerName: string; reviewerRole: string; reviewerSignedAt: string;
  };
  // ---- assessment layer ----
  assessmentEnabled: boolean;
  assessment: AssessmentData;
```

Defaults in `blank()`: `venueClass: "theatre"`, `venueSubtype: ""`, `visitPurpose: ""`, `templateRev: TEMPLATE_REV`, every string field `""`, `lifeSafety` a fresh object of four empty strings, `linesetsEnabled: false`, `linesets: []`, `signoff` a fresh object of seven empty strings, `assessmentEnabled: false`, `assessment: blankAssessment()`.

Add near the top: `export const TEMPLATE_REV = "1.0";`

**Careful — `blank()` has a subtle guard.** Its copy loop is:

```ts
rec[k] = v !== undefined && v !== null ? v : def[k];
```

This means a caller passing `assessment: {}` gets that empty object, not the default. That is existing behaviour and is fine, but it means `blank()` alone does not guarantee well-formed sub-objects on records that came from elsewhere. The migration in 3c is what guarantees it on read.

**3c.** Extend `normalize()`. It currently backfills `stage`; it becomes the single migration point. It must be **idempotent** and must never overwrite a value that is already present:

```ts
function normalize(s: SurveyRecord): SurveyRecord {
  if (!s.stage) s.stage = s.syncState === "synced" ? "completed" : "onsite";
  // ---- Venue Assessments read-time migration (D132) ----
  if (!s.venueClass) s.venueClass = venueClassFor(s.venueType);
  if (!s.venueSubtype) s.venueSubtype = venueSubtypeFor(s.venueType);
  if (!s.visitPurpose) s.visitPurpose = visitPurposeFor(s.visitType);
  if (!s.templateRev) s.templateRev = TEMPLATE_REV;
  if (!Array.isArray(s.linesets)) s.linesets = [];
  if (typeof s.linesetsEnabled !== "boolean") {
    s.linesetsEnabled = s.venueClass === "theatre" || s.venueClass === "auditorium";
  }
  if (!s.lifeSafety) s.lifeSafety = { deluge: "", smokeVent: "", adaNotes: "", egressNotes: "" };
  if (!s.signoff) {
    s.signoff = {
      repName: "", repSignedAt: "", contactName: "", contactSignedAt: "",
      reviewerName: "", reviewerRole: "", reviewerSignedAt: "",
    };
  }
  if (typeof s.assessmentEnabled !== "boolean") s.assessmentEnabled = false;
  if (!s.assessment || !s.assessment.conditions) s.assessment = blankAssessment();
  // Tier-3 systemsState folds forward into the new per-system PRESENT gates:
  // a system marked installed:"yes" seeds that discipline's present array so
  // the answer is not lost. Runs once — guarded by the array already existing.
  SYSTEM_KEYS.forEach(({ key }) => {
    const st = s.systemsState?.[key];
    if (!st || st.installed !== "yes") return;
    const d = (s.disciplines ||= {});
    const branch = (d[key] ||= {});
    if (!Array.isArray(branch.present)) branch.present = ["__migrated__"];
  });
  return s;
}
```

The `"__migrated__"` marker is a placeholder — replace it in Task 9 with the class's actual first PRESENT option once those lists exist. For this task, assert only that the record reads without loss.

**3c-bis. The seed fixtures need retyping.** Making the new fields required on
`SurveyDraft` breaks `src/db/seeds/surveys.ts`, which builds full record literals.
Do NOT fix this by adding the new fields to the fixtures — that would make the
migration assertions tautological. Instead keep the fixtures as genuine
*pre*-migration documents and retype the array:

```ts
type SeedSurvey = Partial<SurveyDraft> &
  Pick<SurveyRecord, "id"|"owner"|"createdAt"|"updatedAt"|"syncState"|"syncedAt"|"rev">;
```

with a single documented `as SurveyRecord[]` cast at the return of `surveysSeed()`.

**3d.** Add `measureFieldsForClass(cls: VenueClass)` delegating to `classMeasureFields`, and keep the existing `measureFields(venueType)` as a thin wrapper so no call site breaks in this task:

```ts
export function measureFieldsForClass(cls: VenueClass): MeasureField[] {
  return classMeasureFields(cls);
}
/** @deprecated use measureFieldsForClass — kept until the editor moves in Task 8. */
export function measureFields(venueType: string | undefined): MeasureField[] {
  return classMeasureFields(venueClassFor(venueType));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on every migration and Tier-1 line, `ALL PASSED`. Then:

```bash
npm run build
```

Expected: clean build. Then `ps aux | grep tsx` to confirm nothing survives.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/surveys.ts src/lib/stores/survey-intake.ts src/db/seeds/surveys.ts scripts/test-review-and-spec.ts
git commit -m "feat(assessments): record shape + read-time migration for venue class, linesets, assessment layer"
```

---

## Task 5: Route move, redirect, and nav

**Files:**
- Move: `src/app/(app)/field-survey/` → `src/app/(app)/venue-assessments/`
- Modify: `next.config.ts`, `src/components/nav/nav-data.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–4. **This task is independent and may run in parallel with Tasks 1–4.**
- Produces: the `/venue-assessments` route; `/field-survey` redirects preserving query.

- [ ] **Step 1: Move the directory with git**

```bash
git mv "src/app/(app)/field-survey" "src/app/(app)/venue-assessments"
```

- [ ] **Step 2: Add the redirect**

In `next.config.ts`, add a `redirects()` entry to the exported config. Next preserves the query string on redirects automatically, so `?id=FS-1053` survives:

```ts
  async redirects() {
    return [
      { source: "/field-survey", destination: "/venue-assessments", permanent: true },
      { source: "/field-survey/:path*", destination: "/venue-assessments/:path*", permanent: true },
    ];
  },
```

If the file already exports a config object with other keys, add `redirects` alongside them — do not replace the object.

- [ ] **Step 3: Update nav**

In `src/components/nav/nav-data.ts`:
- line ~75: `{ key: "field", label: "Venue Assessments", href: "/venue-assessments" }`
- line ~126: `"/venue-assessments": "field"`

**The `active` key stays `"field"`.** Only the label and the href change.

- [ ] **Step 4: Update in-directory strings**

Inside the moved directory, update user-facing copy and metadata:
- `venue-assessments/page.tsx:20` — `export const metadata = { title: "Venue assessments — Quartzite-6" };`
- `venue-assessments/page.tsx:218` — heading text `Venue assessments`
- `venue-assessments/[id]/actions.ts:131` and `venue-assessments/actions.ts:35` — the `"Field survey"` fallback name becomes `"Venue assessment"`.

- [ ] **Step 5: Verify the build and the redirect**

```bash
npm run build
```

Expected: clean. Then start the dev server and confirm both redirects resolve with the query intact — `/field-survey` → `/venue-assessments`, and `/field-survey?id=FS-1053` → `/venue-assessments?id=FS-1053`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/venue-assessments" next.config.ts src/components/nav/nav-data.ts
# then: git add -u  # stages the DELETIONS from the git mv of field-survey/
git commit -m "refactor(assessments): move /field-survey to /venue-assessments with redirects"
```

---

## Task 6: Cross-app call sites

**Files (all Modify):**
`src/app/(app)/home-field-surveys.tsx` (lines 56, 157, plus the `Field surveys` card title at 37), `src/app/(app)/page.tsx:454`, `src/app/(app)/inbox/page.tsx:118`, `src/app/(app)/leads/lead-drawer.tsx:889,898,1222`, `src/app/(app)/import/types.ts:117,122,123`, `src/app/(app)/companies/[id]/page.tsx:562`, `src/app/api/search/route.ts:98`, `src/lib/queue.ts:112,122`, `src/lib/customer-feed-rows.ts:151,210`, `src/lib/nav-counts.ts:167,182`, `src/lib/venue-history-server.ts:169,171`, `src/app/(app)/settings/settings-client.tsx:699`, `src/app/(app)/estimator/types.ts:190` (comment), `src/app/(app)/leads/actions.ts:95` (comment).

**Interfaces:**
- Consumes: the route from Task 5.
- Produces: no dangling `/field-survey` reference outside `next.config.ts`.

- [ ] **Step 1: Find every reference**

```bash
grep -rn "field-survey" src/ --include=*.ts --include=*.tsx
```

- [ ] **Step 2: Rewrite hrefs**

Replace every `"/field-survey"` href with `"/venue-assessments"`, and every `` `/field-survey?id=${...}` `` with `` `/venue-assessments?id=${...}` ``. Also consider renaming `home-field-surveys.tsx` to `home-venue-assessments.tsx` and updating its import in `(app)/page.tsx:52`; do it in this task so the rename is atomic.

- [ ] **Step 3: Update user-facing copy**

"Field surveys" → "Venue assessments" in: the home card title, `import/types.ts` label and `viewLabel` ("View in Venue Assessments"), the settings copy at `settings-client.tsx:699`, `venue-history-server.ts:169` subtitle, and the lead-drawer copy at `lead-drawer.tsx:1222`. Leave code comments referring to the historical module name alone unless they read as user-facing.

**Two hazards found during execution, recorded for anyone re-running this:**

- **`scripts/` hard-codes the route too.** `scripts/smoke-routes.ts` asserts the old
  static and dynamic routes, and `scripts/test-review-and-spec.ts` has two
  `customer-feed-rows` href assertions comparing against literal `/field-survey`
  strings. The Step 4 grep below is scoped to `src/` and misses both, leaving
  `test:smoke` failing. Update them — they are assertions about the moved route,
  not workarounds.
- **Do not bulk-sed `field-survey` → `venue-assessments`.** It corrupts the import
  specifier `./home-field-surveys` into `./home-venue-assessmentss`.

- [ ] **Step 4: Verify nothing dangles**

```bash
grep -rn "field-survey" src/ --include=*.ts --include=*.tsx
```

Expected: no results. Then:

```bash
npm run build && npm run test:smoke
```

Expected: clean build; smoke routes pass. `npm run test:smoke` runs a `tsx` script — confirm with `ps aux | grep tsx` afterward.

- [ ] **Step 5: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "refactor(assessments): repoint every call site and label to Venue Assessments"
```

---

## Task 7: Split the editor

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/fields.tsx`, `custvenue.tsx`, `conditions.tsx`, `photos.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`

**Interfaces:**
- Consumes: the moved directory from Task 5.
- Produces: `<FieldsSection>`, `<CustVenueSection>`, `<ConditionsSection>`, `<PhotosSection>`, each taking an explicit props object. `controls.tsx` retains `sections` construction, draft state, save/stage logic, and layout.

**This is a pure refactor. No behaviour changes, no new fields.** It exists so Tasks 8–13 land in focused files rather than growing a 1,400-line component past the point where edits are reliable.

- [ ] **Step 1: Establish the baseline**

```bash
npm run build
```

Expected: clean. Record that the editor renders today so any regression is attributable to this task.

- [ ] **Step 2: Extract the field renderer**

Move `renderField` (controls.tsx ~838–915) into `sections/fields.tsx` as an exported component. It closes over `draft`, `patchDraft`, `mv`, `setMeasure`, `toggleMeasure`, and the shared style helpers (`toggleBtn`, `chipStyle`, `boxStyle`). Pass those as props rather than re-deriving them:

```tsx
export interface FieldRenderProps {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  mv: (k: string) => string | boolean;
  setMeasure: (key: string, val: string | boolean) => void;
  toggleMeasure: (key: string) => void;
}
export function FieldsSection(props: FieldRenderProps & { fields: FieldDef[] }) { /* ... */ }
```

Export the `FieldDef` and `Draft` types from a shared `sections/types.ts` so both files can import them without cycling back through `controls.tsx`.

- [ ] **Step 3: Extract the remaining three**

`renderCustVenue` (~917–1000) → `custvenue.tsx`. The conditions chip grid and the photo grid → `conditions.tsx` and `photos.tsx`. Same pattern: explicit props, no hidden closure.

- [ ] **Step 4: Verify no behaviour changed**

```bash
npm run build && npm run test:specs
```

Expected: clean build, `ALL PASSED`. Then load the editor for `FS-1053` and confirm every section renders as before — customer/venue picker, visit fields, measurements, conditions chips, photos.

- [ ] **Step 5: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "refactor(assessments): split the editor's section renderers out of controls.tsx"
```

---

## Task 8: Venue class, subtype, and the new sheet fields in the editor

**Files:**
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`, `sections/custvenue.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/page.tsx` (the `meta` object it passes down)
- Modify: `src/app/(app)/venue-assessments/page.tsx` (list badges)

**Interfaces:**
- Consumes: `VENUE_CLASSES`, `SUBTYPES`, `VISIT_PURPOSES`, `classMeasureFields` from Task 1; the record shape from Task 4.
- Produces: an editor whose measurement section is driven by `venueClass`.

- [ ] **Step 1: Replace the venue-type control**

In `custvenue.tsx`, replace the `venueType` select with two controls: a `venueClass` select over `VENUE_CLASSES` (showing each class's `blurb` as help text), and a `venueSubtype` select over `SUBTYPES[draft.venueClass]`. Changing the class resets `venueSubtype` to `""` — a subtype from another class is meaningless.

`venueType` becomes derived and is no longer an input. Keep writing it on save so existing call sites keep displaying something: set it from the class's label when the record has no legacy value.

- [ ] **Step 2: Drive measurements off the class**

In `controls.tsx`, the `mQuick` section's fields come from `classMeasureFields(draft.venueClass)` instead of `meta.measureFieldsByType[draft.venueType]`. Update the `meta` object built in `page.tsx` accordingly — it should pass the class list and subtypes rather than the old per-type measurement map.

- [ ] **Step 3: Swap visit type for visit purpose**

The `visit` section's `visitType` select becomes a `visitPurpose` select over `VISIT_PURPOSES`. Keep `visitType` on the record untouched — the migration reads it, and nothing should write it going forward.

- [ ] **Step 4: Wire the new site-visit fields onto their sections**

Task 4 added these to the record but nothing renders them yet. Add them to the existing sections in `controls.tsx`, using the sheets' labels verbatim:

Extend the **`site`** section ("Site access & logistics") with, after the existing six fields:

```ts
{ kind: "text", key: "loadingDoorSize", label: "Loading door location & W × H" },
{ kind: "text", key: "liftHeight", label: "Lift needed — type / height" },
{ kind: "text", key: "pathToFloor", label: "Path: truck → floor" },
{ kind: "text", key: "workingHours", label: "Working hours allowed" },
{ kind: "text", key: "blackoutDates", label: "Blackout dates / events" },
{ kind: "text", key: "floorProtection", label: "Floor protection required" },
{ kind: "text", key: "badgingRequired", label: "Badging / background check" },
{ kind: "textarea", key: "firstImpressions", label: "First impressions / notes" },
```

Extend the **`project`** section ("Existing materials & quote") with the sheets' QUOTE QUESTIONS block. The sheets' subtitle is worth keeping as help text — "A 'no' does not end the visit — it changes what you collect."

```ts
{ kind: "text", key: "budget", label: "Budget" },
{ kind: "text", key: "fiscalYearSpendBy", label: "Fiscal year / spend-by date" },
{ kind: "text", key: "whoDecides", label: "Who decides" },
{ kind: "text", key: "targetInstallWindow", label: "Target install window" },
```

`quoteNeededBy` already serves the sheets' QUOTE DEADLINE — do not add a second field for it.

Add a new **`lifeSafety`** section in the field group, `advanced: true` so it stays collapsed unless needed, reading and writing the `lifeSafety` sub-object rather than top-level keys:

```ts
{ key: "deluge", label: "Deluge / sprinkler over stage?" },
{ key: "smokeVent", label: "Smoke vent / hatch?" },
{ key: "adaNotes", label: "ADA access notes" },
{ key: "egressNotes", label: "Egress notes" },
```

Because these live under `draft.lifeSafety.*` rather than at the top level, they need their own small renderer or a `kind: "sub"` field variant — pick whichever fits the existing `renderField` switch with the least new machinery, and keep it in `sections/fields.tsx`.

- [ ] **Step 5: Show the class on the list**

In `venue-assessments/page.tsx`, add the class label as a badge on each card, next to the existing stage badge. Use the existing badge styling — do not introduce a new visual idiom.

- [ ] **Step 6: Verify**

```bash
npm run build
```

Then open `FS-1053` and confirm: the class reads Theatre, the subtype reads Single proscenium, the measurement section shows the theatre field set with `proW`/`proH` pre-filled from the record's existing measurements. Switch the class to Gym and confirm the field set changes and previously entered theatre values are **not** destroyed — they remain in `measurements` under their own keys.

- [ ] **Step 7: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): venue class + subtype drive the measurement set"
```

---

## Task 9: Systems sections with PRESENT gates

**Files:**
- Modify: `src/lib/stores/survey-intake.ts`
- Modify: `src/lib/stores/surveys.ts` (replace the `"__migrated__"` placeholder from Task 4)
- Create: `src/app/(app)/venue-assessments/[id]/sections/systems.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `VenueClass` from Task 1.
- Produces: `DISCIPLINE_GROUPS` entries carrying `presentOptions` and `presentOptionsByClass`, and fields carrying `visibleFor?: VenueClass[]`; `visibleFields(group, cls)`.

- [ ] **Step 1: Write the failing test**

```ts
/* --- Venue Assessments: systems gating --- */
import { DISCIPLINE_GROUPS, visibleFields, presentOptionsFor } from "@/lib/stores/survey-intake";

ok(DISCIPLINE_GROUPS.length === 4, "still four system sections");
ok(
  DISCIPLINE_GROUPS.every((g) => presentOptionsFor(g.key, "theatre").length > 0),
  "every system section has a PRESENT row on theatre"
);
ok(
  presentOptionsFor("curtain", "gym").includes("Divider curtain"),
  "gym curtains offer the sheet's divider curtain option"
);
ok(
  presentOptionsFor("curtain", "auditorium").includes("Main / act curtain"),
  "auditorium curtains offer the full soft-goods row"
);
ok(
  !presentOptionsFor("curtain", "gym").includes("Main / act curtain"),
  "gym does NOT offer auditorium-only soft goods"
);
ok(
  visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "lighting")!, "auditorium")
    .some((f) => f.key === "dmxUniverses"),
  "auditorium lighting asks DMX universes"
);
ok(
  !visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "lighting")!, "gym")
    .some((f) => f.key === "dmxUniverses"),
  "gym lighting does not ask DMX universes"
);
ok(
  visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "rigging")!, "auditorium")
    .some((f) => f.key === "fireCurtainPresent"),
  "auditorium rigging carries the fire curtain block"
);
ok(
  visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "lighting")!, "gym")
    .some((f) => f.key === "consoleMfr"),
  "every class asks console mfr/model"
);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `presentOptionsFor` is not exported.

- [ ] **Step 3: Implement**

Extend `DisciplineGroup` with `presentOptionsByClass: Partial<Record<VenueClass, string[]>>` and a `presentOptions: string[]` default. Add `visibleFor?: VenueClass[]` to the fields (extend `MeasureField` or use a local field type — prefer a local `SystemField extends MeasureField` so `MeasureField` stays the simple shared shape).

```ts
export function presentOptionsFor(key: DisciplineKey, cls: VenueClass): string[] {
  const g = DISCIPLINE_GROUPS.find((x) => x.key === key);
  if (!g) return [];
  return g.presentOptionsByClass[cls] || g.presentOptions;
}
export function visibleFields(g: DisciplineGroup, cls: VenueClass): SystemField[] {
  return g.fields.filter((f) => !f.visibleFor || f.visibleFor.includes(cls));
}
```

Field additions per section are enumerated in the spec's "Systems — four gated sections". Auditorium-only keys carry `visibleFor: ["auditorium"]`: `dimmerRack`, `dmxUniverses`, `fohPositions`, `followSpotBooth`, and the whole fly block (`flyType`, `linesetCount`, `battenLength`, `arborCapacity`, `gridBlockCondition`, `hempLineCondition`, `motorControl`, `loadingGalleryNotes`, `fireCurtainPresent`, `fireCurtainRating`, `releaseMechanism`, `fireCurtainLastInspection`).

Then replace the Task 4 `"__migrated__"` placeholder in `normalize()` with the real first option: `branch.present = [presentOptionsFor(key as DisciplineKey, s.venueClass)[0]].filter(Boolean)`.

Remove `systemsState` from the editor's section list; keep the field on the type.

- [ ] **Step 4: Build the section component**

`sections/systems.tsx` renders, per discipline: the PRESENT checkbox row, then `visibleFields(...)`, then the existing inventory table for disciplines that declare inventories. When the PRESENT row has only "None" checked, collapse the rest of the section — do not hide it entirely, since a rep may correct themselves.

- [ ] **Step 5: Verify**

```bash
npm run test:specs && npm run build
```

Expected: `ALL PASSED`, clean build. Open a gym record and an auditorium record and confirm the PRESENT rows and field sets differ as the tests assert.

- [ ] **Step 6: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): fold sheet system blocks into gated discipline sections"
```

---

## Task 10: Lineset table

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/linesets.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`

**Interfaces:**
- Consumes: `LinesetRow`, `LINESET_TYPES`, `LINESET_CONDS`, `blankLinesetRow` from Task 2.
- Produces: `<LinesetsSection>`.

- [ ] **Step 1: Build the section**

A repeating table over `draft.linesets`, one row per lineset, with the 12 printed columns. `type` and `cond` render as selects showing `code — label` (e.g. "D — Draw / main"), so the printed legend stays learnable. Add-row appends `blankLinesetRow(draft.linesets.length + 1)`. Remove-row deletes and does **not** renumber `pos` — lineset numbers are physical positions in the house, not array indices.

- [ ] **Step 2: Wire visibility**

The section appears when `draft.linesetsEnabled`. Add a toggle in the section header so any class can turn it on, matching the Theatre sheet's note: "or any room where lineset inventory needs to be recorded." The migration already defaults it true for theatre and auditorium.

- [ ] **Step 3: Handle width**

The table is wide. Wrap it in a horizontally scrolling container so the page body never scrolls sideways; on narrow viewports fall back to a stacked per-lineset card. Follow whatever responsive idiom `controls.tsx` already uses (`use-breakpoint.ts` is available).

- [ ] **Step 4: Verify**

```bash
npm run build
```

Open a theatre record, add three linesets, save, reload, and confirm all three persist with their codes intact. Confirm a gym record shows the toggle off by default.

- [ ] **Step 5: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): lineset schedule table"
```

---

## Task 11: Assessment layer — toggle and usage profile

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/assessment-usage.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`

**Interfaces:**
- Consumes: `EVENT_TYPES`, `EVENT_FREQUENCIES`, `STAFF_TIERS`, `GROWTH_GOALS` from Task 3.
- Produces: `<AssessmentUsageSection>`; a new editor step for the assessment group.

- [ ] **Step 1: Add the toggle**

A prominent toggle — "Add Condition & Needs assessment" — with one line of help text explaining when it applies: the customer has no defined ask, or needs a formal deliverable. When off, no assessment section renders and `assessmentEnabled` stays false. When on, the assessment sections join the wizard as their own step.

- [ ] **Step 2: Build the usage profile**

Intake fields first: assessment date, assessors (multi from the roster), optional technical reviewer name + role, and stated concern as a textarea labelled "in the customer's own words".

Then: event types as a checkbox list where checking one reveals its frequency select; staff capability tier as a single select plus a training-gap textarea; growth goals as a checkbox list plus open notes.

- [ ] **Step 3: Do not re-ask budget**

Render the site-visit layer's quote-questions block **in place** here, reading and writing the same `budget` / `fiscalYearSpendBy` / `whoDecides` / `targetInstallWindow` / `quoteNeededBy` fields. Do not add assessment-scoped copies. This is the brief's central rule and the reason for the one-record design.

- [ ] **Step 4: Verify**

```bash
npm run build
```

Enable the assessment on a record, fill the usage profile, save, reload, confirm persistence. Edit `budget` from the assessment section and confirm the site-visit section shows the same value.

- [ ] **Step 5: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): assessment toggle + usage & needs profile"
```

---

## Task 12: Condition ratings

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/assessment-condition.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`

**Interfaces:**
- Consumes: `CONDITION_CATEGORIES`, `CONDITION_RATINGS` from Task 3.
- Produces: `<AssessmentConditionSection>`.

- [ ] **Step 1: Build the rating grid**

Ten rows grouped under the brief's three headings — Rigging/Fly/Soft Goods, Stage & Theatrical Lighting, Sound/AV/Video. Each row: category label, a three-way Good / Monitor / Replace control, and a notes field for variance within the category. Use the accent token for the selected state; never hardcode a colour.

- [ ] **Step 2: Add electrical notes, unrated**

A single notes field under the grid, labelled to make the omission deliberate: "Electrical / power — contextual notes only. No condition rating; outside Peak's lane." **Do not add a rating control here.**

- [ ] **Step 3: Add the cert reference rows**

Under each of the three headings, a "Formal inspection on file?" row — Y/N, type, date. Task 14 replaces these with auto-resolved values; build them as plain manual inputs now, writing to `assessment.inspectionRefs` with `source: "manual"`.

- [ ] **Step 4: Verify**

```bash
npm run build
```

Rate a few categories, save, reload, confirm persistence. Confirm no rating control exists for electrical.

- [ ] **Step 5: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): category condition ratings + unrated electrical notes"
```

---

## Task 13: Findings and recommendations

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/assessment-findings.tsx`
- Create: `src/app/(app)/venue-assessments/[id]/sections/signoff.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`

**Interfaces:**
- Consumes: `seedFindings`, `FINDING_BUCKETS`, `BUDGET_TIERS`, `Finding` from Task 3.
- Produces: `<AssessmentFindingsSection>`, `<SignoffSection>`.

- [ ] **Step 1: Seed on entry**

When the findings section first renders with `assessment.findings.length === 0`, call `seedFindings` and offer the result as a "Seed from ratings" action — do not silently write. The assessor stays in control of what becomes a recommendation.

- [ ] **Step 2: Build the findings editor**

Each finding: title, detail, bucket (Now / Soon / Later), budget tier, and its category chips. Merging is selecting two findings and combining their `categories`; splitting is removing a category into a new finding. Group the list by bucket, Now first.

Photos: attach from the record's existing `photos` array by id — do not add a second uploader. The record already caps at 8.

- [ ] **Step 3: Surface unresolved gaps**

Render `seedFindings(...).unresolved` as a warning strip listing flagged categories no finding covers, with an action to add a line for each. This is what stops a Replace rating from silently vanishing.

- [ ] **Step 4: Build sign-off**

Three lines — Peak representative (name + date), site contact (name + date), technical reviewer (name + role + date). The reviewer line renders as optional and collapses when empty. Show `Venue Assessment Rev. {templateRev}` as footer text.

- [ ] **Step 5: Verify**

```bash
npm run build
```

Rate three categories, seed, merge two into one finding, confirm the third stays its own line and nothing shows unresolved. Then remove a category from every finding and confirm it appears in the warning strip.

- [ ] **Step 6: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): findings, buckets, budget tiers, sign-off"
```

---

## Task 14: Cert auto-resolve

**Files:**
- Create: `src/lib/venue-assessment-certs.ts`
- Modify: `src/app/(app)/venue-assessments/[id]/page.tsx`, `sections/assessment-condition.tsx`

**Interfaces:**
- Consumes: `InspectionRef` from Task 3; the flame-jobs and inspections stores.
- Produces: `resolveCerts(customerId, locationId): Promise<Record<string, InspectionRef>>`.

- [ ] **Step 1: Write the resolver**

Server-only module. For the record's `customerId` + `locationId`, find the most recent **completed** flame test and the most recent **completed** inspection. Return refs keyed `curtains` and `rigging`, each carrying `onFile: "yes"`, the record's type and date, `source: "auto"`, and `recordId`.

Read the flame-jobs and inspections stores' existing list functions — do not query the doc-store directly, and **do not write to either store**.

- [ ] **Step 2: Wire it into the page**

`page.tsx` calls `resolveCerts` server-side and passes the result into the editor as part of `meta`. The editor shows an auto-resolved ref as a read-only line with a link to the record, plus a "enter manually instead" affordance that switches `source` to `"manual"` and preserves whatever the rep types.

**Auto-resolution never overwrites a ref whose `source` is `"manual"`.** When nothing resolves, render empty manual inputs — never assert "none on file".

- [ ] **Step 3: Verify**

```bash
npm run build
```

Open an assessment for a customer that has a completed flame test and confirm the curtains ref resolves with a working link. Open one for a customer with none and confirm empty manual inputs, not a "no" answer.

- [ ] **Step 4: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): auto-resolve flame test + inspection references"
```

---

## Task 15: Doctrine defaults in Estimating Rules

**Files:**
- Modify: `src/app/(app)/estimating-rules/` (the rules editor), `src/lib/settings.ts` or the module the rules editor persists through
- Modify: `sections/systems.tsx`

**Interfaces:**
- Consumes: `VenueClass` from Task 1.
- Produces: a `venueDoctrine` settings group; the guidance line rendered on the Curtains and Lighting sections.

- [ ] **Step 1: Add the settings group**

Per class: `curtains: string`, `lighting: string`, `confirmed: boolean`. Seed from the spec's table — gym/auditorium/convention/other confirmed, theatre and church **unconfirmed**. Follow the existing Estimating Rules persistence pattern; do not invent a new settings mechanism.

- [ ] **Step 2: Render the guidance**

On the Curtains and Lighting sections, show the class's doctrine line as read-only help text. When `confirmed` is false, render it with a "default unconfirmed for this venue class" marker, preserving the caveat printed on the Theatre and Church sheets.

- [ ] **Step 3: Verify**

```bash
npm run build
```

Confirm a gym record shows "Encore 22 oz main + valance, Encore rest" without a marker, and a theatre record shows the Charisma line **with** the unconfirmed marker. Edit the gym line in Estimating Rules and confirm the assessment picks it up.

- [ ] **Step 4: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): venue-class doctrine defaults sourced from Estimating Rules"
```

---

## Task 16: Printable field sheet

**Files:**
- Create: `src/lib/venue-assessment-sheet.ts`
- Modify: `src/app/(app)/venue-assessments/[id]/actions.ts`, `controls.tsx` (header action)

**Interfaces:**
- Consumes: `renderLetterPdf`, `LetterDoc` from `src/lib/pdf.ts`; the record shape from Task 4.
- Produces: `buildAssessmentSheet(record): LetterDoc`.

- [ ] **Step 1: Build the doc**

Reproduce the class's sheet: the Peak letterhead block, per-page JOB/OPP # + DATE + PAGE n of m, the class's sections in printed order, the lineset table where `linesetsEnabled`, life safety where filled, and the sign-off block. Footer carries `Venue Assessment Rev. {templateRev}`.

When `assessmentEnabled`, append the assessment pages — usage profile, condition ratings, findings grouped by bucket. The reviewer sign-off line prints only when filled.

Study an existing renderer (the flame or repair proposal letter) for the `LetterBlock` idiom before writing this. Do not add a PDF dependency — `lib/pdf.ts` is zero-dep by design.

- [ ] **Step 2: Add the action**

A server action returning the PDF buffer, reached from the editor header as "Print sheet", following the existing letter-render actions' pattern.

- [ ] **Step 3: Verify**

```bash
npm run build
```

Render a sheet for **each of the six classes** and confirm pagination, that the sign-off block lands on the last page, and that a record with the assessment off produces no assessment pages.

- [ ] **Step 4: Commit**

```bash
git add <only the exact files this task created or modified>
git commit -m "feat(assessments): printable field sheet per venue class"
```

---

## Final verification

- [ ] `npm run build` clean.
- [ ] `npm run test:specs` — `ALL PASSED`.
- [ ] `npm run test:smoke` passes.
- [ ] `ps aux | grep tsx` — no stray processes holding the dev DB.
- [ ] `grep -rn "field-survey" src/ --include=*.ts --include=*.tsx` — no results.
- [ ] `/field-survey?id=FS-1053` redirects to `/venue-assessments?id=FS-1053`.
- [ ] Every seeded survey opens without error and shows a venue class.
- [ ] A record saved before this work still shows its original measurements.
- [ ] Log D132 in `DECISIONS.md` covering the twelve locked decisions and the two flagged defaults.
