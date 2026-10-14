# Assessments Engine — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Ship a data-driven assessment engine (visit type → scopes → gated questions → findings) with a
cross-visit findings register, the **Condition assessment** visit type, and PDF reports.

**Architecture:**
- **Questions** are versioned TypeScript definitions with stable keys, evaluated by one pure function that is
  shared by the client editor, the server checks and the report.
- **Data** lives in three new doc collections: `assessments` (per visit, offline-capable), `findings` (the
  register, offline-capable, printed IDs allocated by the server under an advisory lock) and `venue_profiles`
  (carry-forward facts). Short codes live on `companies` and `sites`.
- **Photos** go to private Blob storage through an IndexedDB queue.
- **Reports** are signed `/print/*` routes rendered by the existing headless-Chrome path.

**Tech stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing APIs),
TypeScript, Drizzle on Postgres/PGlite, Auth.js v5, `@vercel/blob`, the existing offline outbox
(`src/lib/sync/`).

**Spec:** `docs/superpowers/specs/2026-10-13-assessments-engine-design.md` — read it fully before any task.
**Source briefs:** `docs/assessments/briefs/*.txt` — the Site Visit brief is authoritative for question
wording, options, rule IDs and required photos.

## Global Constraints

- **Worktree only.** All work happens in `/Users/sm/Downloads/peak-app/.claude/worktrees/assessments-engine`.
  Never `cd` to the main checkout. Never `git stash` (the stash is shared): use WIP commits.
- **PATH.** Node lives at `~/.local/node/bin`. Prefix commands with `export PATH="$HOME/.local/node/bin:$PATH";`.
- **PGlite is single-process.** Never run a db script while `next dev` or another tsx script holds
  `.data/pglite`. `npm run test:specs` uses its own `mktemp -d` DB, which is safe. Check
  `ps aux | grep -E "tsx|next dev"` before any db script.
- **No AI anywhere (D89).** The app is fully deterministic.
- **Port the brief faithfully.** Question keys, rule IDs (R1–R12, F1–F5, G1–G4, L1–L9, A1–A9, H1–H7, X1–X5)
  and pick-list wording come from `docs/assessments/briefs/site-visit-app-brief.txt`.
- **Ratings:** `"immediate" | "needs" | "good"`, labelled "Immediate attention", "Needs attention", "Good".
  Answer states: `"answered" | "na" | "unable"`.
- **Finding categories:** `"RIG" | "ELC" | "STR" | "HAZ" | "GEN"`.
- **Printed finding ID:** `${companyCode}-${siteCode}-${category}-${seq padded to 3}`, e.g. `MPSD-LIN-RIG-003`.
- **Code suggestions.** Company code = initials of the name, uppercased, 2–6 chars. Venue code = the first 3
  letters of the first meaningful word of the venue's location name (skip `the`, `of`, `st`, `st.`,
  `saint`), uppercased. A collision appends `2`, `3`, ….
- **Ids:** assessment `AS-####` from 1001 (`insertWithPrefixedId("assessments","AS",1001,…)`). Finding doc id
  is `fd_` + 16 lowercase hex chars (`crypto.randomUUID().replace(/-/g,"").slice(0,16)`), created on the
  client or the server. Venue profile doc id is the `sites.id`.
- **Timestamps** are epoch-ms numbers.
- **Permissions:**
  - View: `requireUser()`.
  - Mutate assessments and findings: `requirePerm("create")`.
  - Reopen, change a locked code, void a finding: `"approve"`.
  - Pick-list admin: `"manage_users"`.
  - The offline push handler must enforce `can("create", roles)` for `assessments` and `findings`.
- **Caps:**
  - 200 photos per assessment.
  - 25 MB per original photo before the resize. The resize is to a 1600 px long edge, JPEG q0.8.
  - Long text: 5,000 chars per answer.
  - Tables: 200 rows per answer.
  - Short codes: 2–6 chars of `[A-Z0-9]`.
- **Advisory lock namespace:** `337` (the punch number). Recompute the punch and D numbers from `origin/main`
  in Task 12; if 337 is taken, still use 337 for the lock (it is only a namespace).
- **Copy:** plain sentences, the brief's wording. Never hardcode the accent colour (use `var(--accent)`).
  Fonts are the existing ones.
- **Gates for every task:**
  - `npx tsc --noEmit -p .` must be clean.
  - `npm run test:specs` must have the same FAIL count as the baseline (0).
  - `npx eslint <touched files>` adds no new errors.
  - Run `npm run test:smoke` in Tasks 10 and 12 only. Stop `next dev` first.
  - Run `npx next build` in Tasks 6, 7, 9 and 12, because client components that import stores only fail at
    build time.
- **Harness:** each task's pure checks go in `scripts/test-assessments.ts`, exported as
  `assessmentChecks(ok: Ok)` (pure) and `assessmentDbChecks(ok: Ok)` (DB). Import `type Ok` from
  `./test-inbox-org`. Append to the harness chain in `scripts/test-review-and-spec.ts` after the last
  `.then(() => popoutPureChecks(ok))`:
  `.then(() => assessmentChecks(ok)).then(() => assessmentDbChecks(ok))`.
  DB fixtures use `createFixture`/`fixtureId` from `scripts/test-fixtures.ts`. Committed fixtures live under
  `docs/assessments/`, never under `.superpowers/`.
- **Commits:** one or more per task, message prefix `feat(assessments):` / `fix(assessments):` /
  `docs(assessments):`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

```
src/lib/assessments/
  defs/types.ts            Question/Module/Scope/Rule/Cond/VisitType/Def types
  defs/picklists.ts        code pick lists (id → [{value,label}])
  defs/scopes/core.ts      S0
  defs/scopes/facility.ts  S1
  defs/scopes/rigging.ts   S2
  defs/scopes/soft-goods.ts S3
  defs/scopes/fire.ts      S4
  defs/scopes/lighting.ts  S5
  defs/scopes/av.ts        S6
  defs/scopes/access.ts    S7
  defs/scopes/project.ts   S8
  defs/rules.ts            every brief rule row as a Rule
  defs/index.ts            ASSESSMENT_DEF (version 1), getDef(version), VISIT_TYPES
  evaluate.ts              pure evaluator
  answers.ts               Answer type, validateAnswer, mergeAnswers
  codes.ts                 suggestCompanyCode, suggestSiteCode, withCollisionSuffix, isValidCode
  findings-model.ts        Finding type, printedId, status rules, immediate rules, legacy rating map
  csv.ts                   csvCell (formula-injection guard) + toCsv
  photos.ts                PhotoRef, photo path helpers (pure)
src/lib/stores/assessments.ts     AS-#### store
src/lib/stores/findings.ts        findings store + allocation
src/lib/stores/venue-profiles.ts  profile store
src/lib/stores/assessment-picklists.ts  settings blob "assessment_picklists"
src/lib/assessments/photo-queue.ts      client IndexedDB photo queue ("use client"-safe, no server imports)
src/lib/assessments/report-data.ts      server loader shared by the report page + print route
src/lib/assessments/report-pdf-server.ts renderAssessmentPdf / renderFindingsPdf
src/app/(app)/assessments/…             list, new, [id] editor, [id]/report, findings register, pick-lists
src/app/print/assessment/[id]/page.tsx
src/app/print/assessment-findings/[scope]/page.tsx
src/app/api/assessments/[id]/photos/upload/route.ts
src/app/api/assessments/[id]/photos/[photoId]/route.ts
src/app/api/assessments/[id]/report-pdf/route.ts
src/app/api/assessments/findings-pdf/route.ts
drizzle/0040_assessments.sql (+ meta snapshot, journal)
scripts/test-assessments.ts
docs/assessments/manitowoc-coverage.json
```

---

### Task 1: Definitions — types, pick lists, slice-1 content, coverage map

**Files:**
- Create: everything under `src/lib/assessments/defs/`, plus `docs/assessments/manitowoc-coverage.json`,
  `scripts/test-assessments.ts`
- Modify: `scripts/test-review-and-spec.ts` (import and chain)

**Interfaces — produces (exact):**

```ts
// defs/types.ts
export type AnswerType = "yesno" | "one" | "many" | "number" | "ftin" | "date" | "text" | "longtext" | "contact" | "table";
export type Rating = "immediate" | "needs" | "good";
export type Category = "RIG" | "ELC" | "STR" | "HAZ" | "GEN";
export type ScopeCode = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
export type Depth = "screen" | "full";
export interface ColumnDef { key: string; label: string; type: "text" | "number" | "ftin" | "one"; options?: string }
export interface FlagDef { values: string[]; category: Category; rating: Rating; text: string; requirePhoto?: boolean }
export interface QuestionDef {
  key: string; label: string; type: AnswerType; options?: string; columns?: ColumnDef[];
  help?: string; profile?: boolean; required?: boolean; firstVisitOnly?: boolean;
  /** X5 — answering one of these values offers a finding (generic flagged-answer prompt). */
  flag?: FlagDef;
  /** visible only when this condition holds (in addition to module visibility) */
  when?: Cond;
}
export interface PhotoReq { id: string; label: string }
export interface ModuleDef { id: string; title: string; when?: Cond; questions: QuestionDef[]; photos?: PhotoReq[] }
export interface ScopeDef { code: ScopeCode; key: string; title: string; depths?: Depth[]; modules: ModuleDef[] }
export type Cond =
  | { key: string; in: string[] }
  | { key: string; gt?: number; lt?: number }
  | { key: string; olderThanDays: number }
  | { key: string; state: "unable" | "na" | "unanswered" }
  | { all: Cond[] } | { any: Cond[] } | { not: Cond }
  | { scopeOn: ScopeCode }
  | { scopeDepth: ScopeCode; is: Depth }
  | { visitType: string[] }
  | { profile: string; lt?: number; gt?: number; in?: string[] };
export interface Rule {
  id: string; when: Cond;
  show?: string[];   // module ids or question keys
  skip?: string[];   // module ids or question keys (skip beats show)
  prompt?: { category: Category; rating: Rating; text: string; requirePhoto?: boolean };
  flag?: string;     // non-finding notice text (R9 "capacity cannot be assumed", L7 "observe only — never open or test")
}
export interface VisitTypeDef { key: string; title: string; scopes: { code: ScopeCode; on: boolean; depth?: Depth }[] }
export interface PickOption { value: string; label: string }
export interface AssessmentDef {
  version: number; visitTypes: VisitTypeDef[]; scopes: ScopeDef[]; rules: Rule[];
  pickLists: Record<string, PickOption[]>;
}
// defs/index.ts
export const ASSESSMENT_DEF: AssessmentDef;        // version 1
export function getDef(version: number): AssessmentDef; // unknown version → ASSESSMENT_DEF
export function allQuestions(def: AssessmentDef): Map<string, { q: QuestionDef; moduleId: string; scope: ScopeCode }>;
export function allModules(def: AssessmentDef): Map<string, { m: ModuleDef; scope: ScopeCode }>;
```

**Visibility semantics** (these define the content; Task 2 implements them):
- A scope is visible when it is on for the assessment.
- A module is visible when its scope is visible, AND (it has no `when`, or its `when` holds, or some rule with
  `show` naming it holds), AND no holding rule `skip`s it.
- A question is visible when its module is visible, AND its own `when` holds (or it has none), AND no
  holding rule skips it.
- Modules gated only by rules carry `when: { key: "__never" , in: [] }`, so they show only through a rule.

**Binding gate-key catalogue.** Rules reference these keys exactly. Fill in non-gate fields per module from the
brief's "Question modules" table and the Manitowoc checklist.

| Key | Type / options |
|---|---|
| **S0 `core`** (record fields `visitDate`, assessor, accompanying, building/space live on the Assessment; not answers) | |
| core.contact_primary | contact |
| core.contact_secondary | contact |
| core.contact_hazard | contact, required |
| core.owner_concerns | longtext |
| core.use | many: `use` = school, community, rentals, assemblies, other |
| core.space_type | one: `space_type` = proscenium, thrust, black_box, cafetorium, gym, other; profile, required |
| core.seats | number, profile |
| core.year_built | number, profile, firstVisitOnly |
| core.year_renovated | number, profile, `when` year_built answered |
| core.stage_width / core.stage_depth / core.pros_width / core.pros_height / core.height_grid / core.height_steel / core.height_headblock | ftin, profile, `when` not (space_type in [gym] and core.has_stage = no) |
| core.has_stage | yesno, `when` space_type in [gym, cafetorium, other] |
| core.docs_available | many: `docs` = drawings, manuals, lighting_plot, hookup_sheets, maintenance_logs, prior_inspections, none |
| core.docs_detail | table columns doc(one docs)/format(one: electronic, hard_copy)/status(one: received, to_follow) |
| core.last_inspection_date | date, `when` scopeOn S2 |
| core.last_inspection_firm | text, same `when` |
| core.last_inspection_level | one `insp_level` = level1, level2, unknown, same `when` |
| core.last_inspection_report | yesno, same `when` |
| core.last_electrical_service | text |
| core.audit_ref | text |
| core.not_accessible | longtext |
| core.install_year | number, profile |
| core.installer | text, profile |
| core.manufacturer | text, profile |
| **S1 `facility`** | |
| house.balcony | yesno |
| house.lift_present | yesno |
| house.lift_working | yesno (H3) |
| house.above_grade | yesno |
| house.accessible_route | yesno (H4) |
| house.water_damage | yesno (H5) |
| house.suspect_materials | many: mold, asbestos, none (H6) |
| house.trap_doors | yesno |
| house.orchestra_pit | yesno (H7) |
| **S2 `rigging`** (depths screen, full) | |
| rigging.overhead | one `overhead` = none, dead_hung, counterweight, motorized, mixed; profile, required |
| rigging.hanging_positions | yesno (R1) |
| rigging.rope_sets | yesno (R5) |
| rigging.access | many `rig_access` = grid, loading_bridge, catwalk, none (R8) |
| rigging.fall_hazard | yesno, inside the access module; flag yes → RIG immediate, requirePhoto, "Fall hazard at grid/bridge/catwalk" |
| rigging.install_year | number, profile (R9) |
| rigging.operators | many `operators` = staff, students, volunteers, professionals, contractors (R11) |
| rigging.pit_lift | yesno (R12) |
| rigging.red_flags | many `red_flags` = unrated_hardware, improvised, bent_battens, unmoused_shackles, frayed_cable, loose_collars, unlabeled_weights, none; flag all but none → RIG immediate, requirePhoto |
| rigging.alteration_since | yesno (R10) |
| **S3 `soft_goods`** | |
| soft_goods.present | yesno (G1/G2) |
| soft_goods.track | yesno (G3) |
| soft_goods.flame_cert | one `yes_no_unknown` = yes, no, unknown (G4) |
| soft_goods.flame_test_date | date |
| **S4 `fire`** | |
| fire_curtain.present | yesno (F1/F2) |
| fire_curtain.last_drop_test | date |
| fire_curtain.test_log | yesno |
| smoke_vents.present | yesno (F3) |
| smoke_vents.last_test | date |
| emergency_lighting.present | yesno (F4/F5) |
| **S5 `lighting`** | |
| stage_lighting.present | yesno (L1/L2) |
| dimmer_racks.present | yesno (L3) |
| dimmer_racks.parts_available | one yes_no_unknown |
| console.present | yesno (L4) |
| control.protocol | many `protocol` = dmx, network, analog, none (L5) |
| fixtures.overhead | yesno (L6) |
| fixtures.safety_cables | one `cables` = all, some_missing, unknown |
| stage_panel.present | yesno (L7) |
| power.fused_disconnects | yesno (L8) |
| power.hazards | many `power_hazards` = damaged_cable, improvised_adapters, bare_end_feeders, none (L9) |
| **S6 `av`** | |
| sound_system.present | yesno (A1) |
| sound_system.working | one `working` = yes, partial, no (A2/A3) |
| speakers.flown | yesno (A4) |
| speakers.safety_cables | yesno |
| hearing_assist.present | yesno (A5/A6) |
| video.projector_or_screen | yesno (A7) |
| av.owner_wants | many `owner_wants` = streaming, show_control, recording, none (A8) |
| intercom.present | yesno (A9) |
| **S7 `access`** | |
| access.lift_needed | yesno (X2) |
| access.load_in_* | text/ftin (X1) |
| access.anchors / access.ladders_lifts | text |
| **S8 `project`** | |
| project.deadline | date |
| project.budget | number |
| project.pricing | one `pricing` = budgetary, firm |
| project.type | one `project_type` = design_build, bid, consulting |
| project.decision_maker | text |
| project.other_firms | text |

**Rules.** `defs/rules.ts` holds one `Rule` per brief row, keeping its ID. Mapping notes for the ones that are
not mechanical:
- **R1** `when {key:"rigging.overhead",in:["none"]}` shows `rigging.hanging_positions` and skips every other
  rigging module.
- **R2** `in:["dead_hung"]` shows `rigging.dead_hung` and skips the counterweight, motorized and rope-set
  modules.
- **R3** `in:["counterweight","mixed"]` shows `rigging.counterweight`.
- **R4** `in:["motorized","mixed"]` shows `rigging.motorized`.
- **R6** `{scopeDepth:"S2",is:"screen"}` skips `rigging.lineset_schedule`, `rigging.hardware_inventory` and
  `rigging.dimensions`.
- **R7** `{scopeDepth:"S2",is:"full"}` shows those three.
- **R9** `{any:[{key:"rigging.install_year",lt:CURRENT_YEAR-30},{key:"rigging.install_year",state:"unanswered"}]}`
  shows `rigging.wire_rope` and carries the flag text. **Do not use `Date` inside defs.** Instead, the
  evaluator accepts `now` and resolves `{key, olderThanYears}`. Add `{ key: string; olderThanYears: number }`
  to `Cond` and use `olderThanYears: 30` against a number year.
- **R10** fires a prompt RIG/needs "Rigging inspection due (ANSI E1.47 …)" when:
  `{any:[{key:"core.last_inspection_date",state:"unanswered"},{key:"core.last_inspection_date",olderThanDays:365},{key:"rigging.alteration_since",in:["yes"]}]}`.
- **F1** shows the fire-curtain module. A separate rule **F1b** prompts RIG/needs when
  `{all:[present yes,{any:[{key:"fire_curtain.last_drop_test",olderThanDays:90},{key:"fire_curtain.test_log",in:["no"]}]}]}`.
- **F2** `{all:[present no,{key:"core.space_type",in:["proscenium"]}]}` prompts STR/needs "Confirm with the
  AHJ whether a fire safety curtain is required".
- **F3** shows the smoke-vent module. A rule **F3b** prompts STR/needs when `smoke_vents.last_test` is
  unanswered or `unable`.
- **G4** prompts GEN/needs when `soft_goods.flame_cert in [no, unknown]`.
- **L6** prompts ELC/immediate, requirePhoto, when `fixtures.safety_cables in [some_missing]`.
- **L7** carries the flag "Observe only; never open or test".
- **L8** `{any:[{profile:"core.year_built",lt:1970},{key:"core.year_built",lt:1970},{key:"power.fused_disconnects",in:["yes"]}]}`
  prompts ELC/needs "Electrician follow-up".
- **L9** prompts ELC/immediate, requirePhoto, when `power.hazards` holds any value other than `none`. Use
  `{not:{key:"power.hazards",in:["none"]}}` combined with an answered check, i.e.
  `{all:[{not:{key:"power.hazards",state:"unanswered"}},{not:{key:"power.hazards",in:["none"]}}]}`.
  Define `in` on a `many` answer as **any overlap**, so `{not:{in:["none"]}}` is true when `none` is not
  selected.
- **A2** prompts GEN/needs. **A4** prompts RIG/immediate when `speakers.safety_cables = no`. **A5** prompts
  STR/needs.
- **H3** prompts STR/needs (ADA). **H4** prompts STR/needs. **H6** prompts HAZ/needs with the text "Do not
  disturb — route to an environmental specialist".
- **X1/X3** `{any:[{scopeOn:"S8"},{visitType:["quote"]}]}`.
- **X4 and X5 are evaluator behaviours, not Rules.** X4 collects `unable` answers; X5 turns `QuestionDef.flag`
  into prompts.

**Required photos.** Use the brief's "Question modules → Required photos" column. Photo ids are
`<moduleId>:<slug>`, e.g. `rigging.counterweight:lock_rail`. The named photo set
(`core.photo_set:stage|house|foh|overhead`) is a module in S0 with no questions, only photos.

**Visit type `condition`:** S0, S1, S2 (depth screen), S3, S4, S5, S6 and S7 on; S8 off.

**`docs/assessments/manitowoc-coverage.json`:** an array of
`{ "line": "<exact checklist line text>", "keys": ["…"] }`. It covers every ☐ line under these headings of
`docs/assessments/briefs/manitowoc-field-checklist.txt`: "Every venue: capture the same basics", "Site visit
intake" (each table field), "Rigging triage: every venue" and "Power and control: every venue". A line that
maps to a record field (date, assessor, building) uses `"keys": ["@record.visitDate"]`, etc.

- [ ] **Step 1: Write the failing structural checks** in `scripts/test-assessments.ts`:

```ts
import type { Ok } from "./test-inbox-org";
import { ASSESSMENT_DEF, allQuestions, allModules } from "../src/lib/assessments/defs";
import coverage from "../docs/assessments/manitowoc-coverage.json";

export async function assessmentChecks(ok: Ok) {
  const def = ASSESSMENT_DEF;
  const qs = allQuestions(def); const ms = allModules(def);
  const keys = def.scopes.flatMap((s) => s.modules.flatMap((m) => m.questions.map((q) => q.key)));
  ok(keys.length === new Set(keys).size, "assess defs: question keys unique");
  ok([...ms.keys()].length === new Set(def.scopes.flatMap((s) => s.modules.map((m) => m.id))).size, "assess defs: module ids unique");
  const ids = def.rules.map((r) => r.id);
  for (const want of ["R1","R2","R3","R4","R5","R6","R7","R8","R9","R10","R11","R12","F1","F2","F3","F4","F5","G1","G2","G3","G4","L1","L2","L3","L4","L5","L6","L7","L8","L9","A1","A2","A3","A4","A5","A6","A7","A8","A9","H1","H2","H3","H4","H5","H6","H7","X1","X2","X3"])
    ok(ids.includes(want), `assess defs: rule ${want} defined`);
  const refs = (c: any): string[] => !c ? [] : c.all ? c.all.flatMap(refs) : c.any ? c.any.flatMap(refs) : c.not ? refs(c.not) : c.key && c.key !== "__never" ? [c.key] : c.profile ? [c.profile] : [];
  for (const r of def.rules) {
    for (const k of refs(r.when)) ok(qs.has(k), `assess defs: ${r.id} references known key ${k}`);
    for (const t of [...(r.show || []), ...(r.skip || [])]) ok(qs.has(t) || ms.has(t), `assess defs: ${r.id} targets known ${t}`);
  }
  for (const [k, { q }] of qs) if (q.options) ok(!!def.pickLists[q.options], `assess defs: ${k} pick list ${q.options} exists`);
  const cond = def.visitTypes.find((v) => v.key === "condition");
  ok(!!cond && cond.scopes.find((s) => s.code === "S8")?.on === false && cond.scopes.find((s) => s.code === "S2")?.depth === "screen", "assess defs: condition visit = S0–S7 on, S2 screen, S8 off");
  for (const row of coverage as { line: string; keys: string[] }[])
    for (const k of row.keys) ok(k.startsWith("@record.") || qs.has(k) || ms.has(k), `assess coverage: "${row.line.slice(0, 40)}" → ${k}`);
  ok((coverage as unknown[]).length >= 50, "assess coverage: every-venue checklist lines mapped (≥ 50)");
}
export async function assessmentDbChecks(_ok: Ok) {}
if (process.argv[1] && /test-assessments\.ts$/.test(process.argv[1])) {
  let fail = 0; const ok: Ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  assessmentChecks(ok).then(() => process.exit(fail ? 1 : 0));
}
```

- [ ] **Step 2: Run it and confirm it fails.**
  `export PATH="$HOME/.local/node/bin:$PATH"; npx tsx scripts/test-assessments.ts` → fails on the import (the
  module doesn't exist yet).
- [ ] **Step 3: Write `defs/*`** per the catalogue, rules and photos above. Check `tsconfig` has
  `resolveJsonModule` before relying on the JSON import; if it doesn't, read the file with `fs` instead.
- [ ] **Step 4: Run** `npx tsx scripts/test-assessments.ts`. Expect all PASS.
- [ ] **Step 5: Wire into the harness** by adding the import and chain entry (see Global Constraints). Run
  `npm run test:specs` and confirm the FAIL count is 0.
- [ ] **Step 6: Commit** `feat(assessments): question definitions v1 + Manitowoc coverage map`.

---

### Task 2: Evaluator

**Files:**
- Create: `src/lib/assessments/answers.ts` (Answer type only in this task), `src/lib/assessments/evaluate.ts`
- Test: `scripts/test-assessments.ts`

**Interfaces — produces:**

```ts
// answers.ts
export type AnswerState = "answered" | "na" | "unable";
export interface Answer { v?: unknown; state: AnswerState; reason?: string; at: number; by: string; photoIds?: string[] }
export type Answers = Record<string, Answer>;
// evaluate.ts
export interface ScopeSel { code: ScopeCode; on: boolean; depth?: Depth }
export interface EvalInput {
  def: AssessmentDef; visitType: string; scopes: ScopeSel[]; answers: Answers;
  profile: Record<string, unknown>;              // venue profile facts (key → value)
  photos: { moduleId?: string; reqId?: string }[]; // taken photos, matched to PhotoReq by reqId
  dismissed: string[];                           // prompt ids dismissed
  resolved: string[];                            // prompt ids that already produced a finding
  now: number;
}
export interface PendingPrompt { id: string; ruleId: string; category: Category; rating: Rating; text: string; requirePhoto: boolean; questionKeys: string[] }
export interface EvalResult {
  visibleModules: Set<string>; visible: Set<string>; required: Set<string>;
  missingRequired: string[]; missingPhotos: { moduleId: string; req: PhotoReq }[];
  prompts: PendingPrompt[]; flags: { ruleId: string; text: string }[];
  unable: { key: string; reason: string }[];   // X4 follow-up list
  progress: Record<string, { done: number; total: number }>; // by scope key
}
export function evaluate(input: EvalInput): EvalResult;
export function holds(c: Cond, ctx: { answers: Answers; profile: Record<string, unknown>; scopes: ScopeSel[]; visitType: string; now: number }): boolean;
```

**Semantics:**
- **`unanswered`:** a key with no answer, or with an answer whose `state` is `na` (n/a counts as
  unanswered for gates). `state: "unable"` matches only `{state:"unable"}`.
- **`in`:** on a `yesno`/`one` answer, `in` tests the value. On a `many` (array) answer, it tests any overlap.
  It is false when the answer is unanswered, na or unable.
- **`olderThanDays` / `olderThanYears`:** true when the date or year is older than the limit relative to
  `now`. False when unanswered (combine with `state:"unanswered"` explicitly, as the rules do).
- **`profile`:** reads `profile[key]` and is false if absent.
- **Visibility:** apply the rules in Task 1 (skip beats show). Iterate to a fixpoint, since a rule's `when`
  may reference a key that another rule hides. A hidden key's answer counts as unanswered for gates. Cap the
  fixpoint at 10 passes.
- **Prompt ids:** a rule prompt id is `rule:${rule.id}`. A flagged-question (X5) prompt id is
  `flag:${q.key}`. Prompts in `dismissed`/`resolved` are omitted. A prompt fires only when its rule's target
  scope is on. A rule's scope is the scope of the first key it references, and a rule with no key
  (scopeOn/visitType) always counts as in scope.
- **`required`:** visible questions with `required: true`. `missingRequired` lists those whose answer is
  absent (`na` and `unable` both count as resolved).
- **`missingPhotos`:** each `PhotoReq` of a visible module with no photo whose `reqId === req.id`.
- **`progress`:** per scope, the number of visible questions with any answer state out of the visible total.

- [ ] **Step 1: Write the failing checks.** Add this to `assessmentChecks` (fixture builder plus cases):

```ts
const base = { def: ASSESSMENT_DEF, visitType: "condition", profile: {}, photos: [], dismissed: [], resolved: [], now: Date.UTC(2026, 9, 14) };
const sc = ASSESSMENT_DEF.visitTypes.find((v) => v.key === "condition")!.scopes.map((s) => ({ ...s }));
const A = (v: unknown): Answer => ({ v, state: "answered", at: 1, by: "u1" });
const ev = (answers: Answers, extra: Partial<EvalInput> = {}) => evaluate({ ...base, scopes: sc, answers, ...extra });
// R1
let r = ev({ "rigging.overhead": A("none") });
ok(r.visible.has("rigging.hanging_positions") && !r.visibleModules.has("rigging.counterweight") && !r.visible.has("rigging.rope_sets"), "eval R1: none hides other rigging");
// R2
r = ev({ "rigging.overhead": A("dead_hung") });
ok(r.visibleModules.has("rigging.dead_hung") && !r.visibleModules.has("rigging.counterweight") && !r.visibleModules.has("rigging.motorized"), "eval R2: dead hung skips arbors/hoists");
// R3+R4 mixed
r = ev({ "rigging.overhead": A("mixed") });
ok(r.visibleModules.has("rigging.counterweight") && r.visibleModules.has("rigging.motorized"), "eval R3/R4: mixed shows both");
// R6 screen hides line set schedule
ok(!ev({ "rigging.overhead": A("counterweight") }).visibleModules.has("rigging.lineset_schedule"), "eval R6: screen depth hides line set schedule");
// R8 fall hazard → immediate prompt w/ photo
r = ev({ "rigging.overhead": A("counterweight"), "rigging.access": A(["catwalk"]), "rigging.fall_hazard": A("yes") });
ok(r.prompts.some((p) => p.id === "flag:rigging.fall_hazard" && p.rating === "immediate" && p.requirePhoto && p.category === "RIG"), "eval R8/X5: fall hazard prompts Immediate RIG + photo");
// R9 install year
ok(ev({ "rigging.overhead": A("counterweight"), "rigging.install_year": A(1980) }).flags.some((f) => f.ruleId === "R9"), "eval R9: > 30 years flags capacity");
ok(ev({ "rigging.overhead": A("counterweight") }).flags.some((f) => f.ruleId === "R9"), "eval R9: unknown install year flags");
ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.install_year": A(2015) }).flags.some((f) => f.ruleId === "R9"), "eval R9: recent install no flag");
// R10
ok(ev({ "rigging.overhead": A("counterweight") }).prompts.some((p) => p.ruleId === "R10" && p.rating === "needs"), "eval R10: unknown last inspection prompts");
ok(!ev({ "rigging.overhead": A("counterweight"), "core.last_inspection_date": A(Date.UTC(2026, 3, 1)) }).prompts.some((p) => p.ruleId === "R10"), "eval R10: recent inspection no prompt");
// F1b / F2
ok(ev({ "fire_curtain.present": A("yes"), "fire_curtain.last_drop_test": A(Date.UTC(2026, 0, 1)), "fire_curtain.test_log": A("yes") }).prompts.some((p) => p.ruleId === "F1b"), "eval F1: drop test > 90 days prompts");
ok(ev({ "fire_curtain.present": A("no"), "core.space_type": A("proscenium") }).prompts.some((p) => p.ruleId === "F2" && p.category === "STR"), "eval F2: no curtain on proscenium → AHJ prompt");
// G4
ok(ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("unknown") }).prompts.some((p) => p.ruleId === "G4"), "eval G4: flame cert unknown prompts");
// L6/L7/L9
ok(ev({ "stage_lighting.present": A("yes"), "fixtures.overhead": A("yes"), "fixtures.safety_cables": A("some_missing") }).prompts.some((p) => p.ruleId === "L6" && p.rating === "immediate" && p.category === "ELC"), "eval L6: missing safety cable Immediate");
ok(ev({ "stage_panel.present": A("yes") }).flags.some((f) => f.ruleId === "L7"), "eval L7: observe-only flag");
ok(!ev({ "power.hazards": A(["none"]) }).prompts.some((p) => p.ruleId === "L9") && ev({ "power.hazards": A(["bare_end_feeders"]) }).prompts.some((p) => p.ruleId === "L9"), "eval L9: hazards except none prompt");
// L8 via profile
ok(ev({}, { profile: { "core.year_built": 1931 } }).prompts.some((p) => p.ruleId === "L8"), "eval L8: pre-1970 building (profile) prompts electrician");
// A4 / H6
ok(ev({ "sound_system.present": A("yes"), "sound_system.working": A("yes"), "speakers.flown": A("yes"), "speakers.safety_cables": A("no") }).prompts.some((p) => p.ruleId === "A4" && p.rating === "immediate"), "eval A4: flown w/o safety cables Immediate");
ok(ev({ "house.suspect_materials": A(["asbestos"]) }).prompts.some((p) => p.ruleId === "H6" && p.category === "HAZ"), "eval H6: suspect materials → HAZ");
// X1 hidden on condition, shown when S8 on
ok(!ev({}).visibleModules.has("access.load_in"), "eval X1: load-in hidden on condition visit");
ok(evaluate({ ...base, scopes: sc.map((s) => s.code === "S8" ? { ...s, on: true } : s), answers: {} }).visibleModules.has("access.load_in"), "eval X1: S8 on shows load-in");
// X4 unable
r = ev({ "core.owner_concerns": { state: "unable", reason: "no contact on site", at: 1, by: "u1" } });
ok(r.unable.length === 1 && r.unable[0].reason === "no contact on site", "eval X4: unable answers → follow-up list");
// dismissed / resolved
ok(!ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") }, { dismissed: ["rule:G4"] }).prompts.some((p) => p.ruleId === "G4"), "eval: dismissed prompt doesn't return");
// required
ok(ev({}).missingRequired.includes("core.space_type"), "eval: required space type missing");
ok(!ev({ "core.space_type": { state: "na", at: 1, by: "u1" } }).missingRequired.includes("core.space_type"), "eval: n/a resolves required");
// hidden answers kept (evaluator never mutates)
const ans = { "rigging.overhead": A("none"), "rigging.rope_sets": A("yes") }; ev(ans);
ok("rigging.rope_sets" in ans, "eval: hidden answers are not deleted");
// scope off → its prompts don't fire
ok(!evaluate({ ...base, scopes: sc.map((s) => s.code === "S3" ? { ...s, on: false } : s), answers: { "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") } }).prompts.some((p) => p.ruleId === "G4"), "eval: scope off → no prompts from it");
```

- [ ] **Step 2: Run it and confirm it fails.** `npx tsx scripts/test-assessments.ts` → FAIL (no `evaluate`).
- [ ] **Step 3: Implement `evaluate.ts`** and the Answer types per the semantics above. Write it as pure TS with
  no Date construction except from `now`.
- [ ] **Step 4: Run it and confirm all PASS.** If a case fails because of a defs gap (a missing module id or
  rule), fix the defs, not the test.
- [ ] **Step 5: Commit** `feat(assessments): pure evaluator for gates, prompts, photos, progress`.

---

### Task 3: Pure model — answer validation and merge, codes, findings rules, CSV, photo paths

**Files:**
- Create: `src/lib/assessments/codes.ts`, `findings-model.ts`, `csv.ts`, `photos.ts`
- Extend: `answers.ts`
- Test: `scripts/test-assessments.ts`

**Interfaces — produces:**

```ts
// answers.ts
export const ANSWER_CAPS = { longtext: 5000, text: 500, tableRows: 200 };
export function validateAnswer(q: QuestionDef, a: unknown, def: AssessmentDef, extraOptions: Record<string, string[]>): { ok: true; answer: Answer } | { ok: false; error: string };
// type checks: yesno ∈ {"yes","no"}; one ∈ options(+extra); many ⊆ options(+extra), deduped;
// number finite; ftin = { ft: int ≥ 0, in: 0–11.99 }; date = epoch ms number; text/longtext strings ≤ caps;
// contact = { name, title?, phone?, email? } strings ≤ 200; table = rows (≤ 200) of column-keyed values.
// state "unable" requires reason (1–500 chars) and drops v; state "na" drops v.
export function mergeAnswers(server: Answers, incoming: Answers): Answers; // per key, newest `at` wins; ties keep server
// codes.ts
export const CODE_RE = /^[A-Z0-9]{2,6}$/;
export function suggestCompanyCode(name: string): string;        // initials, 2–6; fallback first letters of single word
export function suggestSiteCode(locationName: string): string;   // first 3 letters of first meaningful word
export function withCollisionSuffix(code: string, taken: Set<string>): string; // LIN → LIN2 → LIN3 (truncate base so result ≤ 6)
// findings-model.ts
export const STATUSES = ["open","triaged","inspected","quoted","scheduled","repaired","verified","closed"] as const;
export type FindingStatus = typeof STATUSES[number];
export interface Finding { /* exactly the spec §3 interface, plus: */ seq: number | null; companyCode: string | null; siteCode: string | null; rev?: number }
export function formatPrintedId(companyCode: string, siteCode: string, cat: Category, seq: number): string;
export function pendingPrintedLabel(companyCode: string | null, siteCode: string | null, cat: Category): string; // "MPSD-LIN-RIG-…"
export function immediateProblems(f: Finding): string[];  // [] when ok; else human messages
export function transitionProblems(f: Finding, to: FindingStatus, note?: string): string[]; // spec §3 Status preconditions; backward needs note
export function legacyRating(src: "RI" | "FS", value: string): { rating: Rating; actionTag?: "monitor" } | null;
export const CATEGORY_ROUTING: Record<Category, { label: string; routedTo: string; behavior: string }>;
// csv.ts
export function csvCell(v: unknown): string;   // /^[=+\-@\t\r]/ → prefix "'", then quote if [",\r\n]
export function toCsv(header: string[], rows: unknown[][]): string; // BOM + CRLF
// photos.ts
export interface PhotoRef { id: string; blobPath?: string; inline?: string; pending?: true; takenAt: number; questionKey?: string; moduleId?: string; reqId?: string; findingKey?: string; caption?: string; by: string }
export const PHOTO_PREFIX = "assessments/";
export function photoBlobPath(assessmentId: string, photoId: string): string;   // assessments/AS-1001/<photoId>.jpg
export function photoPathInScope(path: string, assessmentId: string): boolean;  // prefix, no "..", [A-Za-z0-9._-]+ remainder, Blob random suffix allowed
export const PHOTO_CAPS = { perAssessment: 200, originalBytes: 25 * 1024 * 1024, longEdge: 1600, quality: 0.8 };
```

**Rules:**
- **Immediate:** `immediateProblems` requires ≥ 1 photo, `immediate.hazardContactNotified` set (and
  `notifiedAt` when true), `immediate.lockout` set, and a non-empty `recommendedAction`.
- **Transitions:** inspected needs `specialist.rating`. Repaired needs `repair.date`, `repair.by` and
  `repair.work`. Verified needs `verified.by` and `verified.at`. Quoted needs `quoteRefs.length ≥ 1`. Any
  backward move (to a lower index) needs a non-empty note. A voided finding cannot transition.
- **Legacy rating map:** RI `Poor`/`urgent` → immediate. RI `Fair`/`necessary` → needs. RI `Good`/`basic` →
  good. FS `Replace` → needs. FS `Monitor` → good + `actionTag: "monitor"`. FS `Good` → good. Matching is
  case-insensitive. Anything else → null.

- [ ] **Step 1: Write the failing checks**, at minimum:

```ts
ok(suggestSiteCode("Lincoln High School") === "LIN" && suggestSiteCode("Wilson Middle School") === "WIL" && suggestSiteCode("Washington Middle School") === "WAS" && suggestSiteCode("St. Norbert College") === "NOR" && suggestSiteCode("The Grand Theatre") === "GRA", "codes: venue = first 3 letters of first meaningful word");
ok(suggestCompanyCode("Manitowoc Public School District") === "MPSD", "codes: company initials");
ok(withCollisionSuffix("LIN", new Set(["LIN"])) === "LIN2" && withCollisionSuffix("LIN", new Set(["LIN","LIN2"])) === "LIN3" && withCollisionSuffix("ABCDEF", new Set(["ABCDEF"])).length <= 6, "codes: collision suffix ≤ 6");
ok(CODE_RE.test("MPSD") && !CODE_RE.test("mp") && !CODE_RE.test("TOOLONG7"), "codes: validation");
ok(formatPrintedId("MPSD", "LIN", "RIG", 3) === "MPSD-LIN-RIG-003" && formatPrintedId("MPSD","LIN","RIG",1234) === "MPSD-LIN-RIG-1234", "findings: printed id format");
ok(pendingPrintedLabel("MPSD","LIN","RIG") === "MPSD-LIN-RIG-…", "findings: pending label");
// immediate
const f0 = { rating: "immediate", photoIds: [], recommendedAction: "", status: "open", quoteRefs: [], history: [] } as unknown as Finding;
ok(immediateProblems(f0).length >= 3, "findings: immediate requires photo/notify/lockout/action");
ok(immediateProblems({ ...f0, photoIds: ["p1"], recommendedAction: "Close the catwalk", immediate: { hazardContactNotified: true, notifiedAt: 5, lockout: "locked" } }).length === 0, "findings: immediate complete");
ok(transitionProblems({ ...f0, rating: "needs", status: "open" } as Finding, "inspected").length > 0, "findings: inspected needs specialist rating");
ok(transitionProblems({ ...f0, rating: "needs", status: "quoted", quoteRefs: ["Q-1"] } as Finding, "open").length > 0 && transitionProblems({ ...f0, rating: "needs", status: "quoted", quoteRefs: ["Q-1"] } as Finding, "open", "customer declined").length === 0, "findings: backward move needs note");
ok(legacyRating("RI","Poor")?.rating === "immediate" && legacyRating("RI","necessary")?.rating === "needs" && legacyRating("FS","Monitor")?.actionTag === "monitor" && legacyRating("FS","Replace")?.rating === "needs" && legacyRating("RI","weird") === null, "ratings: legacy map");
ok(csvCell("=SUM(A1)") === "'=SUM(A1)" && csvCell("-3") === "'-3" && csvCell('a,"b"') === '"a,""b"""', "csv: formula guard + quoting");
ok(toCsv(["a"], [["x"]]).startsWith("﻿") && toCsv(["a"], [["x"]]).includes("\r\n"), "csv: BOM + CRLF");
// answers
const q = allQuestions(ASSESSMENT_DEF);
ok(!validateAnswer(q.get("core.space_type")!.q, { v: "arena", state: "answered", at: 1, by: "u" }, ASSESSMENT_DEF, {}).ok, "answers: unknown option refused");
ok(validateAnswer(q.get("core.space_type")!.q, { v: "arena", state: "answered", at: 1, by: "u" }, ASSESSMENT_DEF, { space_type: ["arena"] }).ok, "answers: admin-added option allowed");
ok(!validateAnswer(q.get("core.seats")!.q, { state: "unable", at: 1, by: "u" }, ASSESSMENT_DEF, {}).ok, "answers: unable needs reason");
ok(!validateAnswer(q.get("core.owner_concerns")!.q, { v: "x".repeat(5001), state: "answered", at: 1, by: "u" }, ASSESSMENT_DEF, {}).ok, "answers: long text cap");
const m = mergeAnswers({ a: { v: 1, state: "answered", at: 10, by: "s" }, b: { v: 1, state: "answered", at: 10, by: "s" } }, { a: { v: 2, state: "answered", at: 20, by: "c" }, b: { v: 2, state: "answered", at: 5, by: "c" }, c: { v: 3, state: "answered", at: 1, by: "c" } });
ok(m.a.v === 2 && m.b.v === 1 && m.c.v === 3, "answers: per-key newest wins");
ok(photoPathInScope("assessments/AS-1001/p_abc-Xy12.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1002/p.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1001/../x.jpg", "AS-1001"), "photos: path scope");
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement** the four modules plus the `answers.ts` additions.
- [ ] **Step 4: Run it and confirm all PASS.** Then run `npm run test:specs` and confirm 0 FAIL.
- [ ] **Step 5: Commit** `feat(assessments): answer validation/merge, short codes, finding rules, csv guard`.

---

### Task 4: Database — migration 0040, collections, short codes

**Files:**
- Modify: `src/db/doc-tables.ts`, `src/db/schema.ts`, `src/db/seed-data.ts`, `src/lib/sync/engine.ts`
  (`FIELD_COLLECTIONS`), the identity modules `src/lib/identity/companies.ts` and
  `src/lib/identity/sites.ts`, and the pinned harness strings in `scripts/test-review-and-spec.ts` (search
  for the `CONFIG_COLLECTIONS.join()` pin near line 1136 and the `FIELD_COLLECTIONS` pin near line 7652) and
  `scripts/test-meetings-323.ts` (~line 1185)
- Create: `drizzle/0040_assessments.sql`, `drizzle/meta/0040_snapshot.json` (generated), plus a journal entry

**Interfaces — produces:**
- `export const assessments = docTable("assessments")`, `findings = docTable("findings")` and
  `venueProfiles = docTable("venue_profiles")`, registered in `DOC_TABLES` as `assessments`, `findings` and
  `venue_profiles`.
- `SYNCABLE_COLLECTIONS` and `FIELD_COLLECTIONS` gain `"assessments", "findings"`, appended at the end in the
  same order in both lists.
- `CONFIG_COLLECTIONS` gains `"venue_profiles"`. Update the pin string to
  `"subassemblies,spec_records,spec_record_revisions,assist_runs,venue_profiles"`.
- Schema: `companies.shortCode: text("short_code")` and `sites.shortCode: text("short_code")`, with no
  Drizzle index declared. The partial unique indexes are hand-written SQL only. Add a comment at both columns
  pointing to `0040`.
- `src/lib/identity/companies.ts`:
  - `export async function setCompanyShortCode(id: string, code: string | null): Promise<{ ok: true } | { ok: false; error: string }>`.
    It validates `CODE_RE` (`null` clears), runs `update companies set short_code=… where id=…`, and catches
    the unique violation (Postgres code `23505`), returning `"That code is already used by another company"`.
- `src/lib/identity/sites.ts`:
  - `export async function setSiteShortCode(id, code)`, the same, with the error message `"That code is
    already used by another venue of this company"`.
- **Strip `shortCode` from the `set` of `saveCompany` and `saveSite`**, so the regular saves never write or
  clear it. Use the `rest` destructure: `const { id, shortCode: _sc, ...rest } = row`. Only the dedicated
  setters write it. Also strip it from the insert values. The inserted `short_code` is null.

**Migration SQL** (`drizzle/0040_assessments.sql`):
1. Run `npm run db:generate` with no dev server running, which uses `.data/pglite`. Copy `.data` aside first:
   `cp -R .data .data-backup-20261013` (the worktree's `.data` may not exist — then `db:generate` creates
   one; that's fine).
2. Rename the generated file to `0040_assessments.sql`, and set its tag in `_journal.json`.
3. Harden the generated file so its full content reads exactly:

```sql
CREATE TABLE IF NOT EXISTS "assessments" ( "id" text PRIMARY KEY NOT NULL, "doc" jsonb NOT NULL, "rev" integer DEFAULT 1 NOT NULL, "seq" bigserial NOT NULL, "updated_at" bigint NOT NULL, "received_at" bigint NOT NULL, "review" jsonb, "deleted" boolean DEFAULT false NOT NULL );--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" ( …same columns… );--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venue_profiles" ( …same columns… );--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "short_code" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "short_code" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessments_seq_idx" ON "assessments" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessments_deleted_idx" ON "assessments" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_seq_idx" ON "findings" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_deleted_idx" ON "findings" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_profiles_seq_idx" ON "venue_profiles" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_profiles_deleted_idx" ON "venue_profiles" USING btree ("deleted");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_short_code_uniq" ON "companies" USING btree (lower("short_code")) WHERE "short_code" IS NOT NULL AND "deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sites_short_code_uniq" ON "sites" USING btree ("company_id", lower("short_code")) WHERE "short_code" IS NOT NULL AND "deleted" = false;--> statement-breakpoint
CREATE OR REPLACE TRIGGER assessments_seq_bump BEFORE UPDATE ON "assessments" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE OR REPLACE TRIGGER findings_seq_bump BEFORE UPDATE ON "findings" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE OR REPLACE TRIGGER venue_profiles_seq_bump BEFORE UPDATE ON "venue_profiles" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

(Expand the `…same columns…` placeholders to the full column list. Do not leave the ellipsis in the file.)

- [ ] **Step 1: Write the failing DB checks** in `assessmentDbChecks`:

```ts
import { setCompanyShortCode, saveCompany, getCompany } from "../src/lib/identity/companies"; // use the real exported names; check the file
// create two fixture companies via the identity layer's normal create path (look at scripts/test-fixtures.ts for an existing company fixture helper and reuse it)
ok((await setCompanyShortCode(c1, "TSTA")).ok, "codes db: set company code");
ok(!(await setCompanyShortCode(c2, "tsta")).ok, "codes db: company code unique case-insensitively");
// saveCompany with the row read back (no shortCode change) keeps the code
await saveCompany({ ...(await getCompany(c1))!, name: "Renamed" } as any);
ok((await getCompany(c1))!.shortCode === "TSTA", "codes db: regular save never clears short code");
```

- [ ] **Step 2: Run it and confirm it fails.** `npm run test:specs`.
- [ ] **Step 3: Implement** the schema, doc tables, migration, setters and pin updates.
- [ ] **Step 4: Run** `npm run test:specs` and confirm all PASS (including the updated pins). Run `npx tsc`.
- [ ] **Step 5: Commit** `feat(assessments): migration 0040 — assessments/findings/venue_profiles + short codes`.

---

### Task 5: Stores, allocation, push-handler special case

**Files:**
- Create: `src/lib/stores/assessments.ts`, `src/lib/stores/findings.ts`, `src/lib/stores/venue-profiles.ts`,
  `src/lib/stores/assessment-picklists.ts`
- Modify: `src/app/api/sync/push/route.ts`, `src/db/index.ts` (export `ASSESSMENT_LOCK_NAMESPACE = 337`
  beside the other namespaces)

**Interfaces — produces:**

```ts
// stores/assessments.ts
export interface Assessment { /* spec §2 interface */ id: string; defVersion: number; visitType: string; scopes: ScopeSel[];
  customerId: string; siteId: string; spaceLabel?: string; leadId?: string; visitId?: string; projectId?: string;
  status: "draft" | "onsite" | "completed"; visitDate: number; startedAt?: number; completedAt?: number; completedBy?: string;
  assessorId: string; accompanying?: string; answers: Answers; dismissedPrompts: { id: string; by: string; at: number }[];
  overriddenGaps?: string[]; photos: PhotoRef[]; photoSetOffered?: boolean; rev: number; createdAt: number; updatedAt: number; createdBy: string }
export function normalizeAssessment(d: unknown): Assessment;
export async function getAssessment(id: string): Promise<Assessment | null>;
export async function listAssessments(f?: { customerId?: string; siteId?: string; status?: string }): Promise<Assessment[]>; // newest visitDate first
export async function createAssessment(p: { visitType: string; customerId: string; siteId: string; spaceLabel?: string; leadId?: string; visitId?: string; projectId?: string; visitDate: number; assessorId: string; scopes?: ScopeSel[] }, by: string): Promise<Assessment>;
export async function saveAssessment(id: string, incoming: Partial<Assessment>, user: { id: string }): Promise<{ ok: true; doc: Assessment } | { ok: false; error: string }>;
//   - answers: validate every incoming answer (validateAnswer against getDef(doc.defVersion) + picklist extras); refuse the whole save on any error with the key named;
//     unknown keys (not in def) are kept as-is (newer client), never validated, never dropped
//   - answers merged with mergeAnswers; photos merged by id (incoming blobPath/inline wins over pending); dismissedPrompts union by id
//   - scopes/spaceLabel/accompanying/visitDate replace; status/completedAt/defVersion/customerId/siteId never from this path
//   - caps: photos ≤ 200
export async function completeAssessment(id: string, user: { id: string }, overrideGaps: boolean): Promise<{ ok: true } | { ok: false; gaps: string[]; uploading: number }>;
//   - runs evaluate(); uploading = photos with pending:true → hard refusal; other gaps refused unless overrideGaps (then stored in overriddenGaps)
//   - status completed; writes profile facts: every answered visible question with profile:true → venue profile
export async function reopenAssessment(id: string, user: { id: string }): Promise<void>; // approve checked by caller
// stores/findings.ts
export async function getFinding(key: string): Promise<Finding | null>;
export async function listFindings(f?: { customerId?: string; siteId?: string; assessmentId?: string; status?: FindingStatus[]; category?: Category[]; rating?: Rating[]; includeVoided?: boolean }): Promise<Finding[]>;
export async function saveFinding(incoming: Partial<Finding> & { key: string }, user: { id: string }): Promise<{ ok: true; doc: Finding } | { ok: false; error: string }>;
//   - create if absent (needs customerId, siteId, assessmentId, category, rating, description); allocate printed id (below)
//   - immediate → immediateProblems must be [] (refuse with joined messages)
//   - status changes ONLY via transitionFinding; fields printedId/seq/companyCode/siteCode/history/voided never from incoming
//   - optimistic: incoming.rev < stored.rev → { ok:false, error:"conflict" }
export async function transitionFinding(key: string, to: FindingStatus, user: { id: string }, extra?: { note?: string; patch?: Partial<Finding> }): Promise<{ ok: true; doc: Finding } | { ok: false; error: string }>;
export async function linkQuote(keys: string[], quoteId: string, user: { id: string }): Promise<void>; // add quoteRefs, move to quoted when status < quoted
export async function voidFinding(key: string, reason: string, user: { id: string }): Promise<void>;
export async function allocatePrintedId(f: Finding): Promise<Finding>;
//   - resolves company code (companies.short_code) and site code (sites.short_code); if null, assigns suggestion with withCollisionSuffix
//     against the codes already used (company: all live companies' codes; site: that company's sites' codes) via setCompanyShortCode/setSiteShortCode
//   - withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `${companyId}:${siteId}:${category}`, …): seq = 1 + max(seq) over findings (includeVoided, includeDeleted) with same customerId+siteId+category
//   - sets companyCode, siteCode, seq, printedId; no-op when printedId already set
// stores/venue-profiles.ts
export interface VenueProfile { siteId: string; customerId: string; facts: Record<string, { v: unknown; at: number; from: string }>; updatedAt: number }
export async function getVenueProfile(siteId: string): Promise<VenueProfile | null>;
export async function writeProfileFacts(siteId: string, customerId: string, facts: Record<string, unknown>, from: string): Promise<void>;
export function profileValues(p: VenueProfile | null): Record<string, unknown>; // key → v
// stores/assessment-picklists.ts
export const ASSESSMENT_PICKLISTS_BLOB = "assessment_picklists";
export async function getPicklistExtras(): Promise<Record<string, { value: string; label: string; retired?: boolean }[]>>;
export async function addPicklistValue(listId: string, label: string): Promise<{ ok: true } | { ok: false; error: string }>; // value = slug(label); refuse code collisions
export async function setPicklistRetired(listId: string, value: string, retired: boolean): Promise<void>;
export function extrasForValidation(x: Awaited<ReturnType<typeof getPicklistExtras>>): Record<string, string[]>; // includes retired (stored answers stay valid)
```

**Push handler** (`/api/sync/push/route.ts`). Before the generic replace, branch on the collection:
- **`assessments`:** require `can("create", user.roles)` or return an error for that record. Call
  `saveAssessment(rec.id, rec.doc, user)`, creating first via the normal path when absent (offline
  creation). Return `conflict` only on a validation refusal, carrying the server doc.
- **`findings`:** require `create`. Call `saveFinding(rec.doc, user)`. If a status differs from the stored
  one, call `transitionFinding` after the save. The client sends an intended status; refusals return
  `conflict` with the server doc.
- Keep `projects`' existing special case untouched.

- [ ] **Step 1: Write the failing DB checks** using fixture company and site rows (reuse Task 4's helpers):

```ts
const a = await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1");
ok(/^AS-\d{4,}$/.test(a.id) && a.defVersion === 1 && a.scopes.find((s) => s.code === "S2")?.depth === "screen", "store: create AS with condition scopes");
let s = await saveAssessment(a.id, { answers: { "core.space_type": { v: "proscenium", state: "answered", at: 10, by: "u1" } } }, { id: "u1" });
ok(s.ok, "store: valid answer saves");
s = await saveAssessment(a.id, { answers: { "core.space_type": { v: "spaceship", state: "answered", at: 11, by: "u1" } } }, { id: "u1" });
ok(!s.ok && /core\.space_type/.test((s as any).error), "store: invalid answer refused with key");
await saveAssessment(a.id, { answers: { "core.space_type": { v: "thrust", state: "answered", at: 5, by: "u2" } } }, { id: "u2" });
ok((await getAssessment(a.id))!.answers["core.space_type"].v === "proscenium", "store: older answer loses merge");
await saveAssessment(a.id, { answers: { "future.key": { v: 1, state: "answered", at: 12, by: "u1" } } as any }, { id: "u1" });
ok("future.key" in (await getAssessment(a.id))!.answers, "store: unknown keys kept");
// complete refused with gaps, override records them, profile written
const c1 = await completeAssessment(a.id, { id: "u1" }, false);
ok(!c1.ok && (c1 as any).gaps.length > 0, "store: complete lists gaps");
ok((await completeAssessment(a.id, { id: "u1" }, true)).ok, "store: complete with override");
ok((await getVenueProfile(SITE))?.facts["core.space_type"]?.v === "proscenium", "store: completion writes profile facts");
// pending photo blocks even with override
const a2 = await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1");
await saveAssessment(a2.id, { photos: [{ id: "p1", pending: true, takenAt: 1, by: "u1" }] }, { id: "u1" });
const c2 = await completeAssessment(a2.id, { id: "u1" }, true);
ok(!c2.ok && (c2 as any).uploading === 1, "store: uploading photos hard-block completion");
// findings: allocation + concurrency + void never reused
const mk = (k: string) => ({ key: k, customerId: CO, siteId: SITE, assessmentId: a.id, category: "RIG" as const, rating: "needs" as const, description: "x", questionKeys: [], photoIds: [], quoteRefs: [] });
const [f1, f2] = await Promise.all([saveFinding(mk("fd_test000000000001"), { id: "u1" }), saveFinding(mk("fd_test000000000002"), { id: "u1" })]);
const ids = [(f1 as any).doc.printedId, (f2 as any).doc.printedId].sort();
ok(ids[0].endsWith("-RIG-001") && ids[1].endsWith("-RIG-002"), "findings: concurrent allocation gives 001/002");
await voidFinding("fd_test000000000002", "dup", { id: "u1" });
const f3 = await saveFinding(mk("fd_test000000000003"), { id: "u1" });
ok((f3 as any).doc.printedId.endsWith("-RIG-003"), "findings: voided number never reused");
ok(!(await saveFinding({ ...mk("fd_test000000000004"), rating: "immediate" }, { id: "u1" })).ok, "findings: immediate without photo/notify refused");
ok((await transitionFinding("fd_test000000000001", "inspected", { id: "u1" })).ok === false, "findings: inspected without specialist refused");
await linkQuote(["fd_test000000000001"], "Q-TEST", { id: "u1" });
ok((await getFinding("fd_test000000000001"))!.status === "quoted", "findings: linking a quote → quoted");
```

  The fixture site needs a location name such that `suggestSiteCode` is deterministic, e.g. "Testville High
  School" → `TES`. The company should be "Test Public Schools" → `TPS`, or any initials.
- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement the stores and the push branch.** For `withAdvisoryLock`, check the signature in
  `src/db/index.ts:273`, and make sure the allocation read and the doc write happen **inside** the lock
  callback.
- [ ] **Step 4: Run** `npm run test:specs` and confirm 0 FAIL. Run `npx tsc`.
- [ ] **Step 5: Commit** `feat(assessments): stores, printed-id allocation under advisory lock, push branch`.

---

### Task 6: Photos — client queue, upload broker, serving

**Files:**
- Create: `src/lib/assessments/photo-queue.ts`, `src/lib/assessments/photo-resize.ts` (client, canvas),
  `src/app/api/assessments/[id]/photos/upload/route.ts`, `src/app/api/assessments/[id]/photos/[photoId]/route.ts`,
  `src/app/(app)/assessments/photo-actions.ts` (`"use server"`)

**Behaviour:**
- **`photo-resize.ts`:** `resizePhoto(file: File): Promise<{ blob: Blob; takenAt: number }>`. It refuses
  files over 25 MB and non-images (HEIC is refused with "HEIC isn't supported — set the camera to Most
  Compatible"). It draws onto a canvas with a 1600 px long edge and outputs `image/jpeg` at q0.8. `takenAt` is
  `file.lastModified || Date.now()`. There is no EXIF parser dependency.
- **`photo-queue.ts`** follows the pattern of `src/lib/recorder/upload-queue.ts`: IndexedDB database
  `peak-assessment-photos`, store `photos`, key `${assessmentId}/${photoId}`, value
  `{ assessmentId, photoId, blob, tries, nextAt }`.
  - `enqueuePhoto(assessmentId, photoId, blob)`.
  - `drainPhotos(onDone: (assessmentId, photoId, ref: { blobPath?: string; inline?: string }) => Promise<void>)`
    uploads each queued photo, with exponential backoff capped at 5 min.
  - `pendingPhotoCount(): Promise<number>`.
  - **Upload path:** if `blobEnabled` (passed in from the server as a prop), call
    `upload(photoBlobPath(id, photoId), blob, { access: "private", handleUploadUrl: "/api/assessments/<id>/photos/upload", clientPayload: JSON.stringify({ photoId }), contentType: "image/jpeg" })`,
    then the server action `finalizeAssessmentPhoto(assessmentId, photoId, blobPath)`.
  - **Otherwise (local dev without Blob):** read the blob as a data URL and call
    `finalizeAssessmentPhoto(assessmentId, photoId, null, dataUrl)`. That stores `inline` (≤ 400 KB, refused
    above) for dev only, so local dev works without touching the production Blob store.
- **Upload route:** a `handleUpload` token route modelled on `src/app/api/documents/upload/route.ts`.
  - Gate on `auth()` with an active user, plus `can("create")`.
  - The assessment must exist.
  - Enforce `photoPathInScope(pathname, id)`, `allowedContentTypes: ["image/jpeg"]`,
    `maximumSizeInBytes: 5 * 1024 * 1024` (post-resize), `addRandomSuffix: true`.
  - Return 503 when `!blobEnabled()`.
- **`finalizeAssessmentPhoto(assessmentId, photoId, blobPath | null, inline?)`:**
  - Requires `create`.
  - For Blob: re-check the scope and read the head with `getBlobHead(path, 16)`. It must sniff as JPEG via
    `sniffImageType`; otherwise `deleteBlob` and refuse.
  - For inline: require the `data:image/jpeg;base64,` prefix and ≤ 400 KB.
  - Patch the PhotoRef with id `photoId` (`pending` removed, `blobPath`/`inline` set) through
    `saveAssessment`.
- **Serve route `GET /api/assessments/[id]/photos/[photoId]`:**
  - `requireUser`, find the PhotoRef.
  - `blobPath` → stream via `getBlobStream`. `inline` → decode the data URL.
  - Headers: `content-type: image/jpeg`, `x-content-type-options: nosniff`,
    `cache-control: private, max-age=3600`.
  - Unknown id → 404.
  - The print route also needs photos, so accept a `?t=<print token>` (kind `"assessment"`, id = assessment
    id) as an alternative to the session. **Note:** `/api/*` goes through middleware auth. Check the
    `src/middleware.ts` matcher and, if needed, add `api/assessments/[^/]+/photos/` the way
    `api/recordings/upload` was exempted, then enforce the session-or-token check in the route itself.
    Chrome renders the print route without a session cookie.

- [ ] **Step 1: Write the failing checks.** These are pure and DB checks only, since the browser APIs can't
  run in tsx:
  - `photoPathInScope` was already covered in Task 3.
  - Add a DB check that `finalizeAssessmentPhoto` (call its inner store helper
    `applyFinalizedPhoto(assessmentId, photoId, { inline })`, which you export from `stores/assessments.ts`)
    turns `pending` into `inline` and refuses a non-JPEG data URL.
- [ ] **Step 2: Run it and confirm it fails.** Implement until it passes. Then run `npx next build` (this
  catches any client component pulling a server store).
- [ ] **Step 3: Commit** `feat(assessments): photo resize + IndexedDB queue + private Blob broker + serving`.

---

### Task 7: Editor UI — list, new, editor shell, question controls, saving

**Files:**
- Create: `src/app/(app)/assessments/page.tsx` (list), `new/page.tsx` + `new/controls.tsx`, `[id]/page.tsx`,
  `[id]/editor.tsx` (`"use client"`), `[id]/question.tsx` (one control per AnswerType), `[id]/actions.ts`
  (`"use server"`), `assessments/types.ts` (serializable VMs)

**Requirements:**
- **List** (`/assessments`): the `vendors/page.tsx` pattern. It shows id, customer, venue (+ space), visit
  type, status chip, visit date, assessor, and open findings count, with filters `?status=` and `?customer=`.
  `+ New` links to `/assessments/new`. `requireUser()`.
- **New** (`/assessments/new`): customer picker → venue select (`sitesForCompany`) → space label (text) →
  visit type (only `condition` in slice 1) → scope checkboxes pre-filled from the visit type, with an S2 depth
  select limited to `screen` in slice 1 → visit date → assessor (defaults to me).
  - Query-param prefill: `?company=`, `?site=`, `?visit=` (loads the site visit → its customerId/locationId →
    site), `?lead=`, `?project=`.
  - Submit runs `createAssessmentAction` (`requirePerm("create")`) and redirects to `/assessments/<id>`.
- **Editor page** (`[id]/page.tsx`): loads the assessment, the def (`getDef(defVersion)`), picklist extras,
  the venue profile (`profileValues`), the findings for this assessment, customer and venue names, and
  `blobEnabled()`. It passes serializable props; the client never imports stores. `notFound()` when missing.
- **`editor.tsx`:**
  - **Layout:** scope rail plus module pane. On phone widths (< 760 px) the rail becomes a top sheet with a
    select. Each rail row shows the scope title, `progress.done/total` as a ring (SVG circle), and badges for
    prompts (count of `prompts` in that scope) and missing photos.
  - **Module pane:** lists the visible modules of the active scope. Each question renders `question.tsx`.
    Hidden questions that have answers render greyed out under a "Hidden by earlier answers" disclosure.
  - **State and saving:** local state is `answers` plus the doc. Every change sets `{ v, state: "answered",
    at: Date.now(), by: me }` and re-runs `evaluate` locally on each render (`useMemo`). Saves are debounced
    (600 ms) and go through
    `saveThroughOutbox({ collection: "assessments", id, doc: fullDoc, action: () => saveAssessmentAction(id, { answers: changedOnly, photos, dismissedPrompts, scopes }) })`.
    `fullDoc` has `rev + 1` and `updatedAt` set.
  - **Refusals:** a server error renders a red banner naming the key.
  - **⋯ menu per question:** N/A, Unable… (prompts for a reason, 1–500 chars), Clear.
  - **Profile questions:** when the profile has a value and there's no answer yet, show
    "On file: <value> (AS-xxxx)" and a **Still true** button. It sets the answer to the stored value.
    Changing it records the new value.
  - **Answer controls in `question.tsx`:**
    - `yesno`: two segmented buttons.
    - `one`: a segmented control when there are ≤ 5 options, otherwise a select.
    - `many`: chip toggles. Selecting `none` clears the others, and selecting another value clears `none`.
    - `number`: a numeric input.
    - `ftin`: two inputs.
    - `date`: a date input stored as UTC midnight ms.
    - `text`/`longtext`: an input/textarea with a counter near the cap.
    - `contact`: four inputs.
    - `table`: rows with add/remove, capped at 200.
    - Options come from `def.pickLists[q.options]` plus the non-retired extras.
  - **Nav sync chip** already reflects the outbox; nothing to add.
- **`[id]/actions.ts`:**
  - `saveAssessmentAction(id, patch)`: `requirePerm("create")` → `saveAssessment` → `revalidatePath(`/assessments/${id}`)`
    → returns `{ ok, error? }`. It must **throw** nothing on validation errors, and return `{ ok: false }`
    instead. **Note:** `saveThroughOutbox` treats a resolved promise as success. Check `ServerSaveResult` in
    `src/lib/sync/save.ts` and return that shape so a refusal is not recorded as synced.
  - `completeAssessmentAction(id, override)`.
  - `reopenAssessmentAction(id)` (`approve`).
- Add `"/assessments"` and `"/assessments/new"` to `scripts/smoke-routes.ts` `ROUTES`, and add
  `{ route: "/assessments/AS-NOPE", expectNotFound: true }` to `DYNAMIC_ROUTES`.

- [ ] **Step 1: Build the pages and editor** per the above.
- [ ] **Step 2: Run** `npx tsc`, `npm run test:specs` (0 FAIL) and `npx next build` (must succeed).
- [ ] **Step 3: Browser check** with `preview_start`.
  - The worktree has its own `.data`. **First** read the memory note on preview_start using the MAIN
    checkout's `.claude/launch.json`: add a config named `assessments-wt` whose command runs `next dev` from
    this worktree on port 3337 with `PGLITE_PATH` pointing at a scratch datadir.
  - Sign in through the dev picker.
  - Create an assessment for a seeded company/venue.
  - Answer `rigging.overhead = counterweight` and see the counterweight module appear.
  - Set `none` and see it hide, with the answers kept under "Hidden by earlier answers".
  - Mark a question Unable with a reason.
  - Reload and check everything persisted.
  - Do **not** upload photos to Blob (the dev server loads the real Blob token). Photo checks run only with
    `blobEnabled` false (see the memory note "Dev server loads the real Blob token"). If Blob is enabled in
    this env, skip photo upload in the browser and rely on the DB check.
- [ ] **Step 4: Commit** `feat(assessments): list, new, editor with gated questions + outbox saves`.

---

### Task 8: Editor — prompts, findings, photos UI, mark complete

**Files:**
- Modify: `[id]/editor.tsx`
- Create: `[id]/finding-sheet.tsx`, `[id]/photo-button.tsx`, `[id]/complete-dialog.tsx`, `[id]/codes-chip.tsx`
- Extend: `[id]/actions.ts`

**Requirements:**
- **Prompt chips:** an inline chip under the triggering question (rule prompts render under the first
  referenced question): "⚑ <text> · Create finding / Dismiss".
  - **Create** opens `finding-sheet` pre-filled: category, rating, description = text, `questionKeys`,
    `ruleId`, and photoIds = photos attached to those questions.
  - **Dismiss** appends `{ id: prompt.id, by, at }` to `dismissedPrompts`.
  - A prompt counts as **resolved** when a finding exists whose `ruleId` or `questionKeys` matches the prompt
    id. Rule prompts match on `ruleId === "R10"`; flag prompts on `questionKeys.includes(key)` with no
    `ruleId`. Pass `resolved` to `evaluate`.
- **`finding-sheet.tsx`** (create/edit):
  - Category select (labels from `CATEGORY_ROUTING`), rating segmented control, description, location/line
    set, action tag, recommended action, qualification, priority, budget tier, owner, and audit ref + estimate.
  - When rating = immediate: hazard contact notified (yes/no + time), lockout (locked/tagged/none), and a
    photo requirement. Show `immediateProblems` live, and disable Save until it returns `[]`.
  - Photo picker: choose from the assessment's photos, or take a new one.
  - **Save:** new findings get a client key `fd_<16 hex>`. Save through
    `saveThroughOutbox({ collection: "findings", id: key, doc, action: () => saveFindingAction(doc) })`.
  - Show the printed ID, or `pendingPrintedLabel(...)` while it's null.
  - **Routing line** under the category, e.g. "Routed to: Peak rigging inspection — Quote a rigging
    inspection →" linking `/inspections/quote?customer=<id>&location=<locationId>`. Check that page's
    accepted params and use them; if none fit, link `/inspections/quote`.
- **Findings panel:** on the editor, list this assessment's findings (printed ID, rating chip, description)
  with edit, merge and split before completion.
  - Merge = select ≥ 2 → keep the first and append the others' descriptions/photos/questionKeys. The others
    are **voided**, reason "Merged into <printedId>". This keeps IDs never reused.
  - Split = duplicate it as a new finding with the chosen photos and questions moved over.
- **`photo-button.tsx`:** a camera button per question, plus required-photo slots per module.
  - Flow: `<input type="file" accept="image/*" capture="environment">` → `resizePhoto` → create PhotoRef
    `{ id: "p_" + 12 hex, pending: true, takenAt, questionKey | reqId, moduleId, by }` → add to doc photos and
    save → `enqueuePhoto` → `drainPhotos(onDone → finalizeAssessmentPhoto + update local photo)`.
  - Thumbnails come from a local object URL while pending, then from `/api/assessments/<id>/photos/<pid>`.
  - Call `drainPhotos` on mount and on `online` events.
  - At 200 photos, refuse with a message.
  - **Named photo set:** the first time S0's required questions are complete and `photoSetOffered` is false,
    show a banner offering the four shots. Dismiss sets `photoSetOffered`.
- **`complete-dialog.tsx`:** Mark complete calls `completeAssessmentAction(id, false)`.
  - On gaps, list them (questions by label, photos by label, prompts by text), plus "N photos still
    uploading", which disables the override.
  - **Complete anyway** calls `(id, true)`.
- **`codes-chip.tsx`:** on the editor header, shows `MPSD · LIN` (or "No codes yet — will be suggested on
  first finding"). With `create` and before any finding uses the code, Edit calls
  `setCompanyShortCode`/`setSiteShortCode` through `setShortCodesAction`. After first use, editing requires
  `approve`.
- **Server actions:**
  - `saveFindingAction(doc)` and `transitionFindingAction(key, to, note?, patch?)`, both `create`.
  - `voidFindingAction` (`approve`).
  - `setShortCodesAction({ companyId?, companyCode?, siteId?, siteCode? })`: `create`, but `approve` when the
    code is in use. "In use" means `listFindings({customerId})` has any non-voided finding with that
    `companyCode`.
  - All return `{ ok, error? }` in `ServerSaveResult` shape.

- [ ] **Step 1: Write the DB checks** for merge semantics: merged findings are voided with the reason, and
  their numbers are not reused. Also `setShortCodesAction`'s in-use rule: test the pure helper
  `codeInUse(findings, companyCode)` that you add to `findings-model.ts`.
- [ ] **Step 2: Implement.** Run `npx tsc`, `test:specs` and `next build`.
- [ ] **Step 3: Browser check.**
  - On a counterweight venue, set `rigging.access=[catwalk]` and `rigging.fall_hazard=yes` → the chip appears.
  - Create a finding: Save stays disabled until the photo, notify and lockout are filled.
    - Without Blob: attach a photo with Blob disabled. If Blob is enabled, pick an existing photo instead, or
      skip with a note in the report.
  - The printed ID shows `<CO>-<SITE>-RIG-001`.
  - Dismiss the G4 chip and reload; it stays gone.
  - Mark complete lists the gaps; Complete anyway works.
- [ ] **Step 4: Commit** `feat(assessments): prompts → findings, photos, merge/split, codes, mark complete`.

---

### Task 9: Findings register, Quote these findings, CSV

**Files:**
- Create: `src/app/(app)/assessments/findings/page.tsx`, `findings/controls.tsx`, `findings/actions.ts`,
  `src/app/api/assessments/findings-csv/route.ts`
- Modify: `src/lib/stores/quotes.ts` (`buildQuote` passes `findingKeys`) and the `Quote` type (add
  `findingKeys?: string[]`)

**Requirements:**
- **Register page:** filters (customer, venue, category, rating, status, priority, budget tier, show
  voided) as query params. Immediate items are pinned on top, then sorted by rating, priority, printedId.
  - Columns in the brief's order: Finding ID, Building and space, Category, Description, Photos (count), Rating
    at visit, Audit reference, Inspector rating, Recommended action, Priority, Budget tier, Owner, Quote
    reference, Repair, Verified, Next due, Status.
  - Phone layout: stacked cards.
  - Row click opens the same `finding-sheet` (import it from `../[id]/finding-sheet`). Status changes go
    through a transition menu built from `transitionProblems`.
- **Bulk actions** (checkbox select): Triage (→ triaged), Quote these findings, Export CSV.
- **Quote these findings** (`createQuoteFromFindingsAction(keys, kind: "repair" | "estimator")`,
  `requirePerm("create")`):
  - All selected findings must share one customerId and siteId; otherwise refuse with "Pick findings from one
    venue".
  - Resolve `locationId` from the site (`docLocId` — see `src/app/(app)/venues/[id]/page.tsx:161` and
    `src/lib/identity/sites.ts:168`) and the customer name.
  - **Repair:**
    `create({ name: \`Repairs — ${venueName}\`, customer, customerId, locationId, owner: user.name, quoteType: "repair", source: "repair", findingKeys: keys, repair: { category: "rigging", priority: <highest from findings: immediate→urgent, needs→necessary, else basic>, title: \`Repairs from assessment findings\`, scope: findings.map(f => \`${f.printedId} — ${f.description}\`).join("\\n"), source: { kind: "direct", label: \`Assessment findings ${ids}\` }, items: findings.map(f => ({ label: \`${f.printedId} — ${f.description}\`, qty: 1, note: f.recommendedAction || "" })), parts: [], laborHours: 0, hoursEach: 0, crewSize: 2, total: 0 } })`.
    Check the repair payload fields against `src/app/(app)/repairs/quote/actions.ts:241-293` and use its
    exact field names and value enums. Read `create`'s second-arg/quoteType handling in `quotes.ts:835`.
    Then redirect to that repair quote's builder URL (find the edit URL the Quotes hub uses for repair quotes,
    #224 "every quote link opens its own builder").
  - **Estimator:**
    `create({ …, source: "estimator", findingKeys: keys, spec: { sections: [{ <SpecSection with one item per finding: desc "<printedId> — <description>", qty 1, unit "ea", cost 0, price 0, sku "" > }], mobs: [] } })`.
    Build the SpecSection with the same constructor helper the Estimator uses (search
    `estimator/actions.ts:913` for how sections are created). Redirect to `/estimator?id=<id>`.
  - Then `linkQuote(keys, quote.id, user)`.
  - The finding sheet also gets **Link existing quote…**: a quote-id input checked with `quotes.get`, then
    `linkQuote`.
- **CSV route** `GET /api/assessments/findings-csv?<same filters>`: `requireUser`, `toCsv` with the register
  columns, `content-disposition: attachment; filename="findings-<date>.csv"`.
- Add `/assessments/findings` to smoke ROUTES.

- [ ] **Step 1: Write the failing pure check:** a quote built through `buildQuote` with `findingKeys`
  preserves them, and without it carries no key. Add the conditional spread
  `...(Array.isArray(partial.findingKeys) && partial.findingKeys.length ? { findingKeys: partial.findingKeys } : {})`.
- [ ] **Step 2: Write the DB check:** `createQuoteFromFindingsAction`'s inner helper
  `quoteFromFindings(keys, kind, user)` (exported from `src/lib/assessments/quote-from-findings.ts`, the
  server-only module the action calls) creates a draft repair quote whose `repair.items[0].label` starts with
  the printed ID. The findings then show the quote id in `quoteRefs` with status `quoted`. Mixed venues are
  refused.
- [ ] **Step 3: Implement.** Run `npx tsc`, `test:specs` and `next build`.
- [ ] **Step 4: Commit** `feat(assessments): findings register, bulk triage, quote these findings, csv`.

---

### Task 10: Reports — print routes, PDFs, Email report

**Files:**
- Create: `src/lib/assessments/report-data.ts`, `src/components/assessments/assessment-report.tsx` (server
  component shared by the page and the print route), `src/components/assessments/findings-report.tsx`,
  `src/app/(app)/assessments/[id]/report/page.tsx`, `src/app/print/assessment/[id]/page.tsx`,
  `src/app/print/assessment-findings/[scope]/page.tsx`, `src/lib/assessments/report-pdf-server.ts`,
  `src/app/api/assessments/[id]/report-pdf/route.ts`, `src/app/api/assessments/findings-pdf/route.ts`
- Modify: `src/lib/quote-pdf/token.ts` (`PrintTokenKind` += `"assessment" | "assessment-findings"`)

**Requirements:**
- **`report-data.ts`:**
  - `loadAssessmentReport(id)` → `{ assessment, def, eval, customer, venue, profile, findings, photosById, letterhead }`.
    For the letterhead, use the same loader the estimate PDF/cover uses: the full Peak letterhead (#331, D853).
    Find it via `src/app/print/cover/[id]/page.tsx`.
  - `loadFindingsReport(scope: \`site:${string}\` | \`company:${string}\`)` → the open findings (status ≠
    closed, not voided) plus names.
- **`assessment-report.tsx`** renders the 7 sections exactly as the spec's §4 list, in that order.
  - Section 2's standing line reads verbatim: "Structure and building electrical are flagged for an engineer
    or electrician and are not rated (ANSI E1.47 excludes them)."
  - Answers print by question label in definition order. `na` prints "N/A"; `unable` prints "Unable to
    inspect — <reason>". Contacts print as "Name, Title · phone · email". Tables print as tables. Pick values
    print their labels.
  - **Image URLs:** `/api/assessments/<id>/photos/<pid>` on the page, and the same path with `?t=<token>` in
    print (pass `photoToken` as a prop).
  - Use `pk-keep` on cards so rows don't split.
- **Print routes:** follow `src/app/print/cover/[id]/page.tsx` exactly (`force-dynamic`, noindex, token check
  before any read). The scope param in `assessment-findings/[scope]` is URL-encoded `site:<id>` /
  `company:<id>`.
- **`report-pdf-server.ts`:** `renderAssessmentPdf(id, host, proto)` and `renderFindingsPdf(scope, host, proto)`,
  mirroring `src/lib/estimate-output/cover-pdf-server.ts`.
  - Sign a token for the print route and **a second token of the same kind** for the photo URLs. The print
    route signs its own photo token when rendering; simplest is for the print page to call `signPrintToken`
    itself for `photoToken`, since it already holds `AUTH_SECRET`.
  - Pass `waitFor: "[data-report-ready]"`. The report root sets `data-report-ready` once all `<img>` loaded:
    a tiny client island counts `img.complete`.
- **API routes:** mirror `src/app/api/quotes/[id]/cover-pdf/route.ts` (`requireUser`, `?download=1`, 503 when
  Chrome is unavailable). File names: `Assessment AS-1001 — <venue>.pdf` and
  `Findings — <venue or company> — <date>.pdf`.
- **Report page** `/assessments/[id]/report`: renders `assessment-report` with a toolbar (Download PDF,
  Email report).
- **Email report** (`emailAssessmentReportAction(id)`, `send`):
  - Render the PDF via `renderAssessmentPdf`. When the PDF is ≤ 10 MB, attach it as an inline `dataUrl`
    `CommAttachment` (the renewal-outreach pattern, `src/lib/renewal-outreach.ts:987`). Above that, refuse
    with "Report is too large to email — download it instead".
  - `saveDraft` with `link: { type: "company", id: customerId, label: venueName }`. Check `CommLink` types in
    `src/lib/stores/comms.ts` for the right `type` value.
  - Redirect to `/inbox?draft=<id>`.
- **Findings-only PDF button** on the register (when filtered to one venue or company) and on the venue
  Findings card.
- **Smoke:** add `/print/assessment/AS-NOPE` as `expectNotFound` (no token → 404).

- [ ] **Step 1: Write the failing pure check:** `PrintTokenKind` accepts the new kinds. Sign plus verify a
  token for `"assessment"`, and confirm a wrong kind fails.
- [ ] **Step 2: Implement.** Run `npx tsc`, `test:specs` and `next build`.
- [ ] **Step 3: Run `test:smoke`** (stop `next dev` first; check disk space with `df -h .` first, per the
  temp-pglite memory note).
- [ ] **Step 4: Browser check.**
  - The report page renders all 7 sections for the Task 8 assessment.
  - Download PDF opens a PDF. Check it with the print/PDF harness memory: `pypdf` page count > 1 and the text
    contains the printed ID.
  - Email report lands in the composer with the attachment chip.
- [ ] **Step 5: Commit** `feat(assessments): assessment + findings reports, signed print routes, PDFs, email`.

---

### Task 11: Integration — nav, ⌘K, venue/company cards, site visits, pick-list admin

**Files:**
- Modify: `src/components/nav/nav-data.ts`, `src/lib/nav-counts.ts`, `src/app/api/search/route.ts`,
  `src/app/(app)/venues/[id]/page.tsx`, `src/app/(app)/companies/[id]/page.tsx`, the lead drawer/page and
  project page listing (find where a lead's surveys are listed and add assessments there; if the project page
  has no such list, add a compact "Assessments" ShortList card)
- Create: `src/components/assessments/assessment-cards.tsx` (server components: `VenueProfileCard`,
  `AssessmentsCard`, `FindingsCard`), `src/app/(app)/assessments/pick-lists/page.tsx` + `controls.tsx` +
  `actions.ts`

**Requirements:**
- **Nav:** add `{ key: "assessments", label: "Assessments", href: "/assessments" }` to the Customers group
  directly after the Venue Assessments item.
  - `activeKeyFor`: `"/assessments": "assessments"`.
  - Nav badge `assessments`: count of open findings rated immediate (`listFindings({ rating:["immediate"], status: [all but closed] })`).
- **⌘K:** add `searchDocs("assessments", q, 100)` → group "Assessments" (letter "A", colour `#7a4f1f`,
  `href: /assessments/<id>`). Add `searchDocs("findings", q, 100)` → group "Findings" (letter "F", matched on
  printedId/description, `href: /assessments/findings?focus=<key>`). The register scrolls to and opens the
  focused row.
- **Venue page:** after `DocumentsCard`, add `VenueProfileCard siteId` (facts with "confirmed on AS-xxxx ·
  date", read-only, hidden when no profile), `AssessmentsCard siteId` (ShortList of AS rows plus "Start
  assessment →" `/assessments/new?site=<id>`), and `FindingsCard siteId` (open counts by rating chips → the
  filtered register, plus a Findings PDF link). Also show the venue code, with Edit gated per the Task 8 rule.
- **Company page:** in the right column after "Site surveys", add `AssessmentsCard customerId` and
  `FindingsCard customerId`. Show the company code.
- **Site visits:** on each visit row of the company page's "Site visits" card (span at ~:903–920), add
  "Start assessment" → `/assessments/new?visit=<visitId>`. Also add it in `venue-assessments/visit-requests.tsx`
  next to the survey link.
- **Lead/project:** an assessment created with `leadId`/`projectId` shows in that lead's and project's
  listing.
- **Pick-list admin** (`/assessments/pick-lists`, `requirePerm("manage_users")`): each code list with its
  values (read-only, labelled "built in") and its added values (add, retire/unretire).
  - Adds go through `addPicklistValue` (value = slug; refuse duplicates of code or added values).
  - Link it from `/assessments` with an admin-only "Pick lists" button.
- **Go-live wipe:** `assessments` and `findings` are already demo collections by default. `venue_profiles`
  is in CONFIG (Task 4). Short codes live on companies/sites, which are kept. Add a harness check that
  `DEMO_COLLECTIONS` includes assessments and findings, and that `CONFIG_COLLECTIONS` includes
  venue_profiles.
- **Smoke:** add `/assessments/pick-lists`.

- [ ] **Step 1: Implement.** Run `npx tsc`, `test:specs` and `next build`.
- [ ] **Step 2: Browser check.**
  - The nav item highlights on `/assessments*`.
  - ⌘K finds `AS-1001` and the printed finding ID.
  - The venue page shows the three cards after completing the Task 8 assessment.
  - Start assessment from a site visit pre-fills the customer and venue.
- [ ] **Step 3: Commit** `feat(assessments): nav, search, venue/company/visit integration, pick-list admin`.

---

### Task 12: Docs, numbering, full gates, final browser pass

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase status), `MASTER-HOWTO.md` (if it has a
  per-feature how-to section, add "Running a condition assessment")

- [ ] **Step 1: Recompute numbers.** `git fetch origin && git show origin/main:PUNCHLIST.md | grep -n "^## 3[3-9][0-9]\." | tail -3`,
  and the same for the last `D9xx` in `DECISIONS.md`. Use the next free punch number (expected 337) and
  D-range (expected D914+).
- [ ] **Step 2: Write the DECISIONS entries**, one per decision:
  - The 9 brainstorm decisions in the spec.
  - The venue-code rule (Jeff).
  - Assessments placed in the Customers nav group (there is no Field group).
  - The report emailed as an inline-attachment draft (there is no composer document picker).
  - Quote links carried as quote-level `findingKeys` plus the printed ID in the line text, instead of a
    line-level `findingKey` (`buildQuote` and Estimator line sanitizers drop unknown line keys).
  - Inline dev photos when Blob is off.
  - The push-handler special case with the `create` check.
  - The advisory-lock allocation.
  - `venue_profiles` kept by the go-live wipe.
- [ ] **Step 3: Write the PUNCHLIST entry**, "Assessments engine — slice 1 (Condition assessment + findings
  register) — BUILT 2026-10-13 on `worktree-assessments-engine`", covering what shipped, what's Jeff-gated
  (set codes for MPSD venues; run a real Manitowoc visit; a Blob photo upload check on a preview deploy, which
  writes to production Blob), and follow-ups (slices 2–5, open questions).
- [ ] **Step 4: Add the AGENTS.md phase entry** (next phase number after the last on main) in the same style
  as its neighbours.
- [ ] **Step 5: Run the four gates** and record the numbers:
  - `npx tsc --noEmit -p .`
  - `npm run test:specs` (PASS/FAIL counts)
  - `npm run test:smoke` (stop `next dev` and check `df -h .` first)
  - `npx eslint` on all touched files, against a baseline from `git diff --name-only origin/main...HEAD`.
    Lint `origin/main`'s versions of the modified files for the baseline using a temporary worktree or
    `git show`. Never stash.
  - Plus `npx next build`.
- [ ] **Step 6: Final browser pass.** Run a mock Lincoln HS condition assessment end to end, per spec §5
  Testing:
  - The catwalk gap → `MPSD-LIN-RIG-001` (set company code MPSD, venue LIN on a scratch fixture company).
  - The smoke vent → STR finding.
  - An offline edit: toggle "Work offline", answer two questions, toggle back, and confirm they synced.
  - Quote these findings → a repair quote with the printed IDs in its lines.
  - Report PDF → contains the register.
  - Screenshot proof.
- [ ] **Step 7: Commit** `docs(assessments): decisions, punch, phase status, how-to`.
