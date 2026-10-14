# Assessments engine — slice 1: Condition assessment + findings register

**Date:** 2026-10-13 · **Owner:** Jeff · **Status:** design approved, awaiting spec review
**Branch:** `worktree-assessments-engine` (from `origin/main` e604de05)
**Punch / decisions:** next free numbers at the time of writing are punch #337 and D914+. **Recompute both from
`origin/main` right before writing PUNCHLIST/DECISIONS** — parallel sessions collide within the hour.

## Sources

Jeff's three briefs (Oct 13, 2026), copied as text so the harness and later slices can cite them:

- `docs/assessments/briefs/site-visit-app-brief.txt` — **the product spec for the questionnaire**: visit
  types, scopes S0–S8, core questions, gate rules R1–R12 / F1–F5 / G1–G4 / L1–L9 / A1–A9 / H1–H7 / X1–X5,
  question modules + required photos, ratings, routing, statuses, re-inspection, logs, data model.
- `docs/assessments/briefs/rigging-intake-alignment-brief.txt` — field crosswalk against the eight sample
  rigging reports, the rating crosswalk, the finding-ID tracking chain, and the findings-register columns.
- `docs/assessments/briefs/manitowoc-field-checklist.txt` — the live case (MPSD: Lincoln HS, Wilson MS,
  Washington MS) and the per-venue checklist the questions must cover.

Where this spec says "as in the brief", the brief text is authoritative for wording and options.

## Decisions taken in brainstorming (Jeff, 2026-10-13)

1. **One engine absorbs both existing capture screens.** Venue Assessments (`FS-####`, `surveys`) becomes the
   Quote + Conditions tiers on it (slice 2); the rigging inspection's capture moves onto it (slice 3) while
   `RI-####` keeps its job / quote / renewal / report shell. One findings register everywhere.
2. **Definitions are code-first, with editable pick lists.** Scopes, questions and gate rules are versioned
   code definitions with stable keys. Admins can add pick-list values in Settings from day one. An in-app
   form builder comes later, built on the same definitions.
3. **One rating scale on every finding:** Immediate attention · Needs attention · Good, plus the answer
   states N/A and Unable to inspect. Priority (H/M/L) and budget tier are separate columns. Legacy records map
   on read when their slice lands:
   - **To Immediate:** RI Poor/urgent.
   - **To Needs attention:** RI Fair/necessary, FS Replace.
   - **To Good:** RI Good/basic, plus FS Monitor (which also gets the **Monitor** action tag).
4. **Finding ID = `CUSTOMER-VENUE-CAT-###`**, e.g. `MPSD-LIN-RIG-003`. Each company and venue gets a short
   code, suggested from its name, editable until a finding uses it, then locked. Every finding also has a
   stable internal key.
5. **Fourth tier = per-curtain flame test + service checks** (slice 4): per-curtain pass / fail / retreated
   with NFPA 701 tag and photo, rolling up into the FT job's existing tallies; fire-curtain drop test,
   emergency lighting and re-inspection as short single-scope visits.
6. **Customer output:** a report now, the portal later. Slice 1 delivers a printed/PDF report and register.
   The portal register, acknowledgment, hazard alerts and due-date reminders come in slice 5.
7. **First slice = Condition assessment** (the Manitowoc case). Venue Assessments is untouched until slice 2.
8. **Data shape A:** three collections — `assessments` (per visit), `findings` (the register, across
   visits), `venue_profiles` (carry-forward facts).
9. **No bulk import of the CESA 10 audit items in slice 1.** The audit reference and estimate are typed per
   finding.

Assumption carried from the briefs: Peak itself performs rigging inspections (it sells `RIG` quotes and runs
`RI` records), so findings in category RIG route to a **Peak rigging inspection**. Electrical, structural
and hazardous-materials findings route to outside specialists, and the app only flags and never rates them,
as the briefs require.

## Roadmap (each slice: its own spec → plan → build)

| Slice | Scope |
|---|---|
| **1 (this spec)** | Engine, findings register, the **Condition assessment** visit type (S0–S7, S2 at screen depth; S8 can be added), reports, migration `0040` |
| 2 | **Quote survey** visit type: S8 + the Black River Falls measurement set, line-set table, logistics, client goals → Estimator. `FS` moves onto the engine; the old editor retires |
| 3 | **Rigging inspection** visit type: S2 full intake depth replaces the `RI` rubric capture. `ISSUE_LIBRARY` becomes Settings data, the RI reports read the register, L1/L2 renewals stay |
| 4 | **Flame test + service checks + re-inspection**: per-curtain inventory → FT results; fire curtain / emergency lighting checks; re-inspection of open findings; status driven by repair jobs |
| 5 | **Portal + reminders**: customer register, acknowledgment, immediate-hazard alerts, next-due reminders (fire curtain 90 days, emergency lighting, flame cert, E1.47 rigging) |

---

## 1. The question engine

### Definitions (`src/lib/assessments/defs/`)

Pure TypeScript data, no React or DB imports:

```ts
type AnswerType =
  | "yesno" | "one" | "many" | "number" | "ftin" | "date" | "text" | "longtext"
  | "contact" | "table";

interface QuestionDef {
  key: string;              // stable, dotted: "rigging.overhead", "fire_curtain.present"
  label: string;            // brief wording
  type: AnswerType;
  options?: string;         // pick-list id (shared lists, see below)
  columns?: ColumnDef[];    // type "table" (line-set schedule, inventories)
  help?: string;
  profile?: boolean;        // a carry-forward venue fact (see §4)
  required?: boolean;       // when visible
  firstVisitOnly?: boolean; // core.year_built
}

interface ModuleDef {        // a brief "question module", e.g. Counterweight (R3)
  id: string;               // "rigging.counterweight"
  title: string;
  questions: QuestionDef[];
  photos?: PhotoReq[];      // required photos before the module counts complete
}

interface ScopeDef {          // S0…S8
  code: "S0" | "S1" | … | "S8";
  key: string;              // "core", "facility", "rigging", "soft_goods", "fire", "lighting", "av",
                            // "access", "project"
  title: string;
  gate?: string;            // question key that opens the scope's modules
  depths?: ("screen" | "full")[]; // S2 only in slice 1 ("screen")
  modules: ModuleDef[];
}

interface Rule {              // one row of the brief's if/then tables
  id: string;               // "R3", "F1", "L6", "X4"
  when: Cond;               // conditions on question keys
  show?: string[];          // module ids or question keys
  skip?: string[];
  prompt?: { category: Category; rating: Rating; text: string; requirePhoto?: boolean };
  flag?: string;            // non-finding notices: "capacity cannot be assumed" (R9)
}

type Cond =
  | { key: string; in: string[] }        // answer ∈ values (one/many/yesno)
  | { key: string; gt?: number; lt?: number }
  | { key: string; olderThanDays?: number } // dates: F1 last drop test > 90
  | { key: string; state: "unable" | "na" | "unknown" }
  | { all: Cond[] } | { any: Cond[] } | { not: Cond }
  | { scopeOn: string } | { visitType: string[] }
  | { profile: string; in?: string[]; lt?: number }; // e.g. L8 building year < 1970

interface VisitTypeDef {
  key: "condition";         // slice 1; quote / rigging / flame / reinspection later
  title: string;
  scopes: { code: string; depth?: "screen" | "full" }[]; // defaults, toggleable
}

interface AssessmentDef { version: number; visitTypes; scopes; rules; pickLists }
```

- **Slice 1 content:** visit type `condition` (S0, S1, S2 screen, S3, S4, S5, S6, S7 on; S8 off but can be
  switched on). It ships the brief's core questions (S0) in full, every scope module in the brief's "Question
  modules" table that the condition visit reaches, and the rule rows R1–R12, F1–F5, G1–G4, L1–L9, A1–A9,
  H1–H7, X1–X5.
  - **R7** (full intake depth) is defined now but unreachable until slice 3.
  - **X1/X3** show only when S8 or a quote visit type is on.
- **Coverage:** every checklist line in the Manitowoc checklist's "Every venue" and "Rigging triage" /
  "Power and control" sections must map to a question key. The plan lists the mapping, and the harness asserts
  that every one of those keys exists.
- **Pick lists** have a stable id and code values (`space_type: proscenium | thrust | black_box | cafetorium
  | gym | other`) and are shared across modules so reports sort consistently. An admin may **add** values in
  Settings → Assessments → Pick lists (settings blob `assessment_picklists`). Code values can't be removed or
  renamed. An added value can be retired, which hides it from new answers, but never deleted while any stored
  answer uses it.

### Evaluator (`src/lib/assessments/evaluate.ts`, pure)

```ts
evaluate(def, visitType, scopes, answers, profile): {
  visible: Set<string>;          // question keys
  required: Set<string>;
  missingRequired: string[];     // visible + required + no answer/na/unable
  missingPhotos: { moduleId; req }[];
  prompts: PendingPrompt[];      // rule.prompt fired and not yet resolved (finding created or dismissed)
  flags: { ruleId; text }[];
  progress: Record<scopeKey, { done; total }>;
}
```

- **One function** serves the editor, the completeness check, the report, and the server's Mark complete
  validation, so the rules cannot drift between them.
- **Hidden answers are kept.** An answer whose question becomes hidden is never deleted: the editor greys it
  out and the report omits it.
- **Dismissing a prompt** records `{ruleId, dismissedBy, at}` on the assessment, so the same prompt doesn't
  return.
- **Answer state:** every answer is `{ v?: unknown; state: "answered" | "na" | "unable"; reason?: string;
  at: number; by: string; photoIds?: string[] }`. An `unable` state requires a reason, and every unable answer
  is listed on the visit's follow-up list (X4).

### Versioning

`AssessmentDef.version` is stamped on each assessment as `defVersion`. A meaning-changing edit (renamed key,
removed option, changed type) means a new version, and old versions stay in `defs/versions/` so old
assessments render with their own definitions. Wording-only edits don't bump the version. Unknown keys arriving
from a newer client are stored and ignored, never dropped.

### Not in slice 1

An in-app form builder; AI of any kind (D89 stands).

---

## 2. Running a visit (capture)

### Routes

All under `src/app/(app)/assessments/`. The nav entry "Assessments" goes in the Field group; Venue Assessments
stays where it is.

| Route | Purpose |
|---|---|
| `/assessments` | List: filters by customer, venue, status, visit type |
| `/assessments/new` | Pick customer → building and space → visit type → scopes; prefilled from `?site=`, `?company=`, `?visit=`, `?lead=`, `?project=` |
| `/assessments/[id]` | The editor |
| `/assessments/[id]/report` | The report (print route, see §4) |
| `/assessments/findings` | The register |

### Record: `assessments` collection, id `AS-####` from 1001

```ts
interface Assessment {
  id: string;                 // AS-1001
  defVersion: number;
  visitType: "condition";
  scopes: { code: string; depth?: "screen" | "full"; on: boolean }[];
  customerId: string; siteId: string; spaceLabel?: string; // "Auditorium rm 132"
  leadId?: string; visitId?: string; projectId?: string;
  status: "draft" | "onsite" | "completed";   // reopen (approve) → "onsite"
  visitDate: number; startedAt?: number; completedAt?: number; completedBy?: string;
  assessorId: string; accompanying?: string;
  answers: Record<string, Answer>;            // keyed by question key
  dismissedPrompts: { ruleId: string; by: string; at: number }[];
  photos: PhotoRef[];                          // see below
  photoSetOffered?: boolean;
  createdAt; updatedAt; createdBy;
}
```

### Starting

`+ New` lives on `/assessments`, on the venue page, on the company page, and as **Start assessment** on a site
visit. The site visit's `surveyId` stays as it is; the new link is `Assessment.visitId`.

- **Scope choice:** choosing **Condition assessment** pre-selects the visit type's scopes. The assessor can
  toggle them before starting and add one mid-visit. Removing a scope that already has answers hides it and
  keeps the answers.
- **Venue profile pre-fill:** if a profile exists for the venue (§4), `profile: true` questions show the
  stored value with a **Changed?** toggle. Untouched, the toggle counts as answered with the stored value.

### Editor (phone/tablet first, `"use client"` only where needed)

- **Scope rail:** one row per on scope, each with a progress ring and badges for open prompts and missing
  photos. On a phone the rail is a top sheet.
- **Module pane:** one module at a time. Each question has its control, a ⋯ menu (N/A, Unable…), and a camera
  button.
- **Gates:** opening a gate reveals its dependent questions inline.
- **Prompts:** when a rule's prompt fires, an inline **Create finding?** chip appears, with Create and Dismiss.
- **Named photo set:** offered once per space, the first time S0 is complete. The shots are stage, house,
  FOH and overhead from the standard corners.
- **Offline:** works offline with the Nav sync chip, the same as the other capture editors.

### Photos

- **Capture:** from the device camera or the library. Each photo is resized on the device to a 1,600 px long
  edge (JPEG q0.8) and keeps its EXIF capture time when available, otherwise the time it was picked.
- **Upload:** direct to private Blob under `assessments/<AS-id>/<photoId>.jpg`, through an upload broker
  following the `documents` / `package-files` pattern. The server re-checks that the path is under the
  assessment's prefix, never trusting a client path.
- **Record:** `PhotoRef { id; blobPath?; pending?: true; takenAt; questionKey?; moduleId?; findingKey?;
  caption?; by }`.
- **Offline:** the image waits in a new IndexedDB photo queue (`src/lib/sync/photo-queue.ts`) with
  retry/backoff. The record carries a `pending` PhotoRef, shown from a local object URL. The upload then
  patches in `blobPath`, and the sync chip counts photos waiting.
- **Caps:** 200 photos per assessment; 25 MB per original before the resize.

### Saving and merging

- **Writes** go through the existing outbox (`saveThroughOutbox`). The server merges `answers` **per key,
  newest `at` wins**, so two people walking different scopes of one visit don't overwrite each other. Other
  fields use the store's `rev` check.
- **Server validation** checks every answer against `defVersion`: type, option membership, and the reason on
  `unable`. Values that fail are refused, never coerced.

### Mark complete

Mark complete runs `evaluate` on the server, then shows every gap: required questions, required photos,
unresolved prompts, and **photos still uploading**.

- **Overridable gaps:** questions, photos and prompts. The assessor can complete anyway, and each gap
  overridden this way is recorded on the record and printed in the report's follow-up list.
- **Hard block:** photos still uploading. The report can't go out without them.

On completion, the `profile` answers are written to the venue profile (§4).

---

## 3. Findings — the register

### Record: `findings` collection

- **Doc id:** a stable random `key` (`fd_<nanoid>`), used by every link (quotes, photos, answers, later
  repairs). The printed ID is a field.

```ts
interface Finding {
  key: string;               // fd_…  (doc id, never changes)
  printedId: string | null;  // "MPSD-LIN-RIG-003"; null while pending server allocation
  customerId: string; siteId: string; spaceLabel?: string;
  category: "RIG" | "ELC" | "STR" | "HAZ" | "GEN";
  description: string; location?: string;         // line set number, voltage/phase if known
  assessmentId: string;                            // raised at
  questionKeys: string[]; ruleId?: string;         // what raised it
  photoIds: string[];                              // PhotoRef ids on the assessment(s)
  rating: "immediate" | "needs" | "good";          // assessor's, never overwritten
  specialist?: { rating; standard?: string; by?: string; at?: number };  // beside, not over
  actionTag?: "out_of_service" | "specialist_needed" | "replace" | "repair" | "monitor";
  recommendedAction?: string;
  qualification?: "engineer" | "rigging_contractor" | "electrician" | "environmental" | "venue_staff";
  priority?: "high" | "medium" | "low";
  budgetTier?: "lt10k" | "lt100k" | "gt100k";
  owner?: { kind: "staff" | "contractor"; name: string };
  auditRef?: { item: string; estimate?: number };
  immediate?: { hazardContactNotified: boolean; notifiedAt?: number; lockout: "locked" | "tagged" | "none" };
  quoteRefs: string[];                             // quote ids
  repair?: { date: number; by: string; work: string; parts?: string };
  verified?: { by: string; at: number };
  nextDue?: number;
  status: "open" | "triaged" | "inspected" | "quoted" | "scheduled" | "repaired" | "verified" | "closed";
  history: { status; by; at; note? }[];
  voided?: { by; at; reason };
  createdAt; createdBy; updatedAt;
}
```

### Creating

- **From a prompt chip:** pre-filled from the rule (space, category, suggested rating, question, photos).
- **By hand:** **+ Finding** on any question or module, or on the assessment.
- **Linking and editing:** a finding can link several questions and photos. Findings can be merged or split
  until the assessment is completed.
- **Immediate attention** requires a photo, `hazardContactNotified` (with the time when yes), `lockout`, and
  `recommendedAction`. This is enforced on the server.

### Printed IDs

- **Codes:** new nullable columns `companies.short_code` and `sites.short_code` (migration `0040`).
  - The company code is unique among live companies. The venue code is unique within its company.
  - **Company code suggestion:** initials of the company name, uppercased, 2–6 characters
    (Manitowoc Public School District → `MPSD`).
  - **Venue code suggestion (Jeff, 2026-10-13):** the first three letters of the first meaningful word of the
    venue's location name, uppercased. Filler words are skipped: the, of, st, st., saint. Examples: Lincoln
    High School → `LIN`, Wilson Middle School → `WIL`, Washington Middle School → `WAS`, St. Norbert College
    → `NOR`. Initials are not used, because school names would collapse into `?MS` / `?HS`.
  - **Collisions:** a collision within the same scope gets a digit suffix (`LIN2`).
  - **Locking:** a code is editable until any non-voided finding uses it, then locked; changing it after that
    needs `approve`.
- **Allocation:** the **server** allocates `NNN` per `(company code, venue code, category)` under a
  row lock, as max+1, zero-padded to 3 digits.
  - A finding created offline carries `printedId: null` and shows `MPSD-LIN-RIG-…` until it syncs.
  - Allocation also happens on sync, so two offline findings can't both become `-003`.
  - Voided findings keep their number, and a number is never reused.
- **After a code changes:** issued printed IDs keep their text. New findings use the new code, continuing the
  sequence for that venue and category.
- **Missing codes:** if the company or venue has no code yet at the first finding, the server assigns the
  suggestion, and the editor shows it once with "Change code…".

### Categories and routing

| Code | Category | Routed to | App behavior |
|---|---|---|---|
| RIG | Rigging, incl. fire curtain | Peak rigging inspection | **Quote a rigging inspection** opens `/inspections/quote` pre-filled for the venue |
| ELC | Electrical and control | Qualified electrician | Observation only; never marked inspected by Peak |
| STR | Structural / building, incl. smoke vents, roof, egress structure | Engineer or building owner | Flag only; no rating of structure |
| HAZ | Hazardous materials | Environmental specialist | Do-not-disturb flag printed on the finding |
| GEN | Theatrical general | Assessor / venue staff | Stays with Peak |

### Status

Statuses run open → triaged → inspected → quoted → scheduled → repaired → verified → closed. Every change
appends to `history` with who and when.

- **Set by hand in slice 1:** triaged, inspected (needs `specialist.rating`), scheduled, repaired (needs
  `repair`), verified (needs `verified`), and closed (`nextDue` optional).
- **Quoted** is set automatically when a quote is linked.
- **Backward moves** are allowed for anyone with `create`, with a required note.
- Repair jobs and re-inspections drive statuses in slice 4.

### Quote these findings

1. In the register, select findings → **Quote these findings** → choose **Repair quote** (default) or
   **Estimator quote**.
2. The app creates a draft quote for that customer and venue, one line per finding. The line text starts
   with the printed ID, and the line carries `findingKey`.
3. The findings get the quote id in `quoteRefs` and move to `quoted`.
4. Linking an existing quote from the finding (a quote picker) does the same.
5. Customer documents print the finding ID on those lines.

### Register screens

- **`/assessments/findings`:** a table with filters for customer, venue, category, rating, status, priority
  and budget tier; Immediate items pinned first. Select rows for bulk Triage, Quote these findings, or Export
  CSV.
- **Findings cards** on the venue and company pages: open counts by rating, with a link to the filtered
  register.
- **CSV export:** columns in the brief's register order. Cells starting with `=`, `+`, `-` or `@` are
  prefixed with `'` (formula-injection guard).

---

## 4. Outputs, venue profile, integration

### Assessment report

- **Route:** `/assessments/[id]/report` renders in the browser.
- **PDF:** a signed print route, `/print/assessment/[id]`, renders it through the existing headless-Chrome
  path (`src/lib/quote-pdf/` render + token helpers, a new print token kind `assessment`). It uses the full
  Peak letterhead, like estimates.

Report sections, in the sample rigging reports' order:

1. **Cover + intake:** facility, address, date, assessor and accompanying, contacts and hazard contact,
   owner concerns (verbatim), use, space type, seats, last rigging inspection.
2. **Scope + exclusions:** the scopes run and their depth. A standing line: *Structure and building
   electrical are flagged for an engineer or electrician and are not rated (ANSI E1.47 excludes them).* Then
   the areas not accessible and why.
3. **Summary:** counts by rating × category, then the Immediate items in full.
4. **One section per scope:** visible answers in definition order. N/A and Unable print as such, with the
   reason; inline photos.
5. **Findings register table:** sorted Immediate → Needs → Good, then priority.
6. **Follow-up list:** unable answers, overridden gaps, and the documents to request (from
   `core.docs_available`).
7. **Photo appendix:** each photo captioned with its finding ID and question.

**Findings-only PDF.** `/assessments/findings/report?site=…|company=…` prints the open findings across
visits, through the same print path. It is meant for the rigger or the district facilities lead.

Both PDFs can be attached from the Inbox composer's existing document picker.

### Venue profile: `venue_profiles` collection, doc id = `siteId`

```ts
interface VenueProfile {
  siteId: string; customerId: string;
  facts: Record<string, { v: unknown; at: number; from: string /* AS-id */ }>; // profile:true keys
  updatedAt: number;
}
```

- **Contents:** stage dimensions, space type, seats, year built and renovated, rigging type and counts,
  install year, installer, manufacturers, fire curtain type, last inspection date and level, documents on
  file.
- **Writes:** only a completed assessment writes here, and only its `profile` answers.
- **Venue page:** a read-only Venue profile card shows each fact with "confirmed on AS-1004 · date".

### Integration in slice 1

- **Site visit:** a **Start assessment** action.
- **Venue and company pages:** Assessments and Findings cards.
- **Lead and project:** an assessment started from one carries its id. Lead and project pages list linked
  assessments.
- **⌘K:** searches `AS-####` and printed finding IDs.
- **Go-live wipe:** treats `assessments` and `findings` as demo data and keeps `venue_profiles` (like
  venues); short codes are kept.
- **Offline pull:** `/api/sync/pull` is limited to the field collections (#323). `assessments` joins that
  list. `findings` and `venue_profiles` are server-fetched, not pulled.

### Not in slice 1

- Bulk import of audit items.
- The portal, acknowledgment, alerts and reminders (slice 5).
- Migrating `FS` or `RI` records (slices 2 and 3; rating map in Decisions §3).

---

## 5. Permissions, failure handling, testing

### Permissions

These use the existing `Perm`s; there are no new roles.

| Action | Needs |
|---|---|
| View assessments, the register and reports | Any signed-in user (`requireUser`) |
| Start and edit assessments; create and edit findings; change status; Quote these findings | `create` |
| Reopen a completed assessment; change a locked short code; void a finding | `approve` |

Findings are voided, never deleted.

### Failure handling

- **Offline:** answers go through the outbox and photos through the IndexedDB queue (retry with backoff, and
  the queue survives a reload). Unsent photos block Mark complete with "N photos still uploading".
- **Conflicts:** answers merge per key. Findings use `rev`; on a conflict the client shows "Changed by
  <name> — reload".
- **Server re-checks:** answer type and options against `defVersion`; Immediate-finding requirements; status
  preconditions; printed-ID allocation under a lock; Blob paths under the assessment's prefix; caps (200
  photos, 25 MB per original, a 5,000-character long-text cap per answer, 200 rows per table answer).
- **Unknown keys** from newer clients are kept.

### Migration `0040` (renumber at merge if another lands first)

- Three `docTable`s: `assessments`, `findings`, `venue_profiles`, each with its `seq_bump` trigger (per the
  `0012` header comment).
- `companies.short_code`, plus a unique partial index on `lower(short_code) WHERE short_code IS NOT NULL AND
  deleted = false`.
- `sites.short_code`, plus a unique partial index on `(company_id, lower(short_code))` with the same
  conditions.
- Collection registration in `doc-tables.ts` and `seed-data.ts`.

### Testing

- **`test:specs` harness**, with fixtures committed under `docs/assessments/` (never `.superpowers/`):
  - The evaluator against the brief's rule tables. At minimum:
    - R1: overhead = none hides all other rigging questions.
    - R2: dead-hung skips arbors, rope locks, blocks and hoists.
    - R3 / R4 / mixed.
    - R8: a fall hazard prompts Immediate and requires a photo.
    - R9: an install year more than 30 years ago, or unknown, raises the flag.
    - R10: a last inspection that is unknown or over 12 months old prompts Needs attention.
    - F1: a drop test over 90 days old, or no log, prompts Needs attention.
    - F2.
    - G4.
    - L6: a missing safety cable prompts Immediate.
    - L7: observe only.
    - A4.
    - H6: HAZ routing.
    - X4: unable → follow-up list.
  - Hidden answers are kept; a dismissed prompt doesn't return.
  - Every Manitowoc "every venue" checklist line maps to an existing key.
  - Short-code suggestion and collisions; printed-ID allocation (sequence, offline null → allocated on
    sync, two concurrent allocations, voided numbers never reused).
  - The legacy rating map; status preconditions; per-key answer merge; CSV injection guard.
- **`test:smoke`:** the new GET routes.
- **Browser pass:** a mock Lincoln HS condition assessment end to end, including offline and an offline
  photo. Checks:
  - The catwalk gap → Immediate RIG finding gets `MPSD-LIN-RIG-001`.
  - The smoke vent → STR finding.
  - Quote these findings → a repair quote whose lines carry the IDs.
  - The report PDF prints the register.
- **Gates:** tsc, test:specs, test:smoke, and eslint against a baseline, each reported with real numbers.

---

## Open questions (do not block slice 1)

1. Brief open question: S2 screen vs full intake as one scope with a depth toggle (this spec) or two scopes.
   The toggle is assumed; revisit in slice 3.
2. Reminder lead times and recipients (slice 5).
3. Do outside specialists ever use the app directly, or only receive the findings PDF and send results back?
   Slice 1 assumes the latter; Peak staff enter the specialist rating.
