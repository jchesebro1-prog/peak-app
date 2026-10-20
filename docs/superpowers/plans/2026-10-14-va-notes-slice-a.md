# Venue Assessment notes — Slice A (form structure & flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder and restructure the Venue Assessments (`FS-####`) editor per Jeff's Oct 14 notes 2, 3, 6, 7, 13, 14, 17 (guidance panel), 23 and the customer recap: Kill questions moved up with Scope + Rigging system, a Wrap-up group at the end, collapsible sections with a shared progress rail, internal tags, and Sign-off removed.

**Architecture:** Pure rules live in two new client-safe modules — `src/lib/survey-flow.ts` (order, steps, groups, scope filter, rig system, quote rule, recap) and `src/lib/survey-migrate.ts` (read-time migration chain + derived `legacyNotes`). `normalize()` in `src/lib/stores/surveys.ts` calls the chain. The editor (`controls.tsx`) consumes them; a `SectionRail` is extracted from the Assessments engine's scope rail and shared by both editors. Internal tags are a settings list edited in Settings → Field.

**Tech Stack:** Next.js 16 App Router (client components + server actions), TypeScript, Drizzle doc-store (JSONB), the `tsx` spec harness (`scripts/test-review-and-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-14-venue-assessment-notes-design.md` (sections R1–R4, A1–A9).

## Global Constraints

- Work only in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/va-notes` on branch `feat/342-va-notes`. Never `cd` to the main checkout. Never use bare `git stash`.
- Node is at `~/.local/node/bin` (prefix commands with `export PATH="$HOME/.local/node/bin:$PATH";` if `node` is missing).
- Read `AGENTS.md` first. Next.js 16 differs from training data — check `node_modules/next/dist/docs/` before using an unfamiliar Next API.
- PGlite is single-process: never run a db script while a dev server or another script holds `.data/pglite`. `npm run test:specs` uses its own temp datadir and is safe.
- Never click photo upload, sketch upload or Email report in local dev (`.env.local` holds the real production Blob token).
- No migration file and no new env var in this slice.
- Read-time migration never deletes a stored key. `legacyNotes` is derived on every read and never stored.
- Client components (`"use client"`) must not import a store (`@/lib/stores/surveys`, `@/lib/settings`, anything reaching `@/db`) — type-only imports are fine. `next build` catches this; tsc does not.
- Copy rules: sentence case, no em-dash-heavy marketing copy; labels exactly as given in this plan.
- Every task ends with: `npx tsc --noEmit` clean, the task's checks passing in `npx tsx scripts/test-va-notes.ts`, and a commit. The full four gates (tsc, `npm run test:specs`, `npm run test:smoke`, eslint on touched files vs a baseline) run in Task 10.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/survey-flow.ts` | new | Section order, wizard steps, groups, scope filter, rig-system helpers, quote rule, goal-line splitter, customer recap |
| `src/lib/survey-migrate.ts` | new | `migrateSurvey` chain: rig-system copy-up, systemsState fold (moved), scope seed; `LegacyNote` + `addLegacyNote` |
| `src/lib/survey-tags.ts` | new | Internal tag list: type, starter list, resolve, whole-list merge, labels |
| `src/components/section-rail/section-rail.tsx` | new | Shared rail (Ring, Badge, rows, phone select, CSS) |
| `src/app/(app)/venue-assessments/[id]/sections/kill-questions.tsx` | new | Kill questions card body (checklist, Scope, Rigging system, stage W/D) |
| `src/app/(app)/venue-assessments/[id]/sections/progress.ts` | new | Pure `sectionProgress` for the rail |
| `src/app/(app)/venue-assessments/[id]/sections/collapse.ts` | new | Per-viewer collapsed-state store (localStorage via useSyncExternalStore) |
| `src/app/(app)/venue-assessments/[id]/sections/recap.tsx` | new | Customer recap read-back |
| `src/app/(app)/venue-assessments/[id]/sections/final-thoughts.tsx` | new | Internal tags + older site conditions |
| `src/app/(app)/venue-assessments/[id]/sections/older-notes.tsx` | new | "Older notes" block per section |
| `src/app/(app)/settings/survey-tags-card.tsx` | new | Settings → Field card for internal tags |
| `scripts/test-va-notes.ts` | new | Harness checks for this slice (pure + db), wired into `test:specs` |
| `src/lib/stores/survey-intake.ts` | modify | `RIG_SYSTEMS`; rigging Present options; drop `counterweight` check; Tier 1 items |
| `src/lib/stores/surveys.ts` | modify | Types (`scope`, `internalTags`, `legacyNotes`); `BEAM_FIELDS` drops `rigType`; normalize → `migrateSurvey` |
| `src/app/(app)/venue-assessments/[id]/controls.tsx` | modify | Order/steps/groups, quote gating, kill questions, rail, collapse, recap, final thoughts, older notes; Sign-off, conditions, accordion removed |
| `src/app/(app)/venue-assessments/[id]/sections/types.ts` | modify | Draft/EditorMeta/SectionDef changes |
| `src/app/(app)/venue-assessments/[id]/sections/systems.tsx` | modify | Guidance panel removed; rigging Present read-only |
| `src/app/(app)/venue-assessments/[id]/page.tsx` | modify | Meta: drop conditions/doctrine, add internal tags |
| `src/app/(app)/venue-assessments/[id]/actions.ts` | modify | `SurveyPatch` gains `scope`, `internalTags` |
| `src/app/(app)/venue-assessments/actions.ts` | modify | `createSurvey` defaults assignee + today |
| `src/lib/stores/site-visits.ts` | modify | `requestVisitForLead` defaults assignee + today on the survey |
| `src/app/(app)/assessments/[id]/scope-rail.tsx`, `editor.tsx` | modify | Engine renders the shared `SectionRail` (identical output) |
| `src/lib/settings.ts`, `src/app/(app)/settings/{actions.ts,page.tsx,settings-client.tsx,groups/field.tsx,groups/types.ts}` | modify | Internal tags setting + card wiring |
| `src/lib/venue-assessment-sheet.ts` | modify | "What we heard" block, Older notes, quote rows only when present, Close-out only when signed |
| `src/lib/survey-findings.ts` | modify | Recap lines in the plain-text findings |
| `src/app/(app)/venue-assessments/page.tsx` | modify | Tag filter |
| `scripts/test-review-and-spec.ts` | modify | Wire the new checks; update Tier 1 fixtures |
| `src/app/(app)/venue-assessments/[id]/sections/signoff.tsx`, `conditions.tsx` | delete | Replaced |

---

### Task 0: Worktree setup (no commit)

- [ ] **Step 1: Install dependencies and the gitignored files**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/va-notes
export PATH="$HOME/.local/node/bin:$PATH"
npm ci
cp /Users/sm/Downloads/peak-app/next-env.d.ts . 2>/dev/null || true
cp /Users/sm/Downloads/peak-app/.env.local . 2>/dev/null || true
ls node_modules/.bin/tsc node_modules/.bin/eslint
```
Expected: both binaries listed. (Never symlink node_modules — Turbopack panics.)

- [ ] **Step 2: Baseline the gates**

```bash
npx tsc --noEmit 2>&1 | tail -3
npx eslint "src/app/(app)/venue-assessments" "src/app/(app)/assessments/[id]" src/lib/stores/surveys.ts src/lib/stores/survey-intake.ts "src/app/(app)/settings" 2>&1 | tail -3 > /tmp/claude-va-eslint-baseline.txt; cat /tmp/claude-va-eslint-baseline.txt
```
Expected: tsc clean. Record the eslint problem count — Task 10 compares against it.

---

### Task 1: `survey-flow.ts` — order, scope, rig system, quote rule, recap

**Files:**
- Modify: `src/lib/stores/survey-intake.ts` (add `RIG_SYSTEMS`)
- Create: `src/lib/survey-flow.ts`
- Create: `scripts/test-va-notes.ts`
- Modify: `scripts/test-review-and-spec.ts` (wire the checks)

**Interfaces:**
- Consumes: `DISCIPLINE_GROUPS`, `DisciplineData`, `DisciplineKey` from `src/lib/stores/survey-intake.ts`.
- Produces (later tasks rely on these exact names):
  - `RIG_SYSTEMS: readonly ["Counterweight","Dead-hung","Motorized","Hemp","Fixed points","None"]` (exported from `survey-intake.ts`, re-exported by `survey-flow.ts`)
  - `type FlowGroup = "brief" | "field" | "intake" | "assessment" | "wrapup"`
  - `SECTION_ORDER: readonly string[]`, `STEP_LABELS: readonly string[]`, `STEP_BY_ID: Record<string, number>`, `GROUP_BY_ID: Record<string, FlowGroup>`, `GROUP_META: Record<FlowGroup, { label: string; blurb: string }>`
  - `SCOPE_KEYS: readonly DisciplineKey[]`, `SCOPE_LABEL: Record<DisciplineKey, string>`
  - `type FlowSlice = { visitPurpose?: string; scope?: unknown; disciplines?: Record<string, DisciplineData>; linesets?: unknown[] }`
  - `QUOTE_PURPOSES`, `isQuoteVisit(s): boolean`, `scopeSet(s): DisciplineKey[] | null`, `inScope(s, k): boolean`, `rigSystems(s): string[]`, `hasCounterweight(s): boolean`, `hasLinesets(s): boolean`, `sectionVisible(s, id): boolean`
  - `splitGoalLines(v: unknown): string[]`
  - `type RecapEntry = { disc: DisciplineKey; label: string; scopes: string[]; other: string; goals: string[] }`, `recapFor(s): RecapEntry[]`, `recapScopeText(e: RecapEntry): string`

- [ ] **Step 1: Add `RIG_SYSTEMS` to survey-intake**

In `src/lib/stores/survey-intake.ts`, directly above `export type DisciplineKey = …` (line ~102), add:

```ts
/** #344 — the one rigging-system answer (Kill questions; stored at disciplines.rigging.present). "None" is
 *  exclusive. Old labels map on read in src/lib/survey-migrate.ts. */
export const RIG_SYSTEMS = ["Counterweight", "Dead-hung", "Motorized", "Hemp", "Fixed points", "None"] as const;
```

- [ ] **Step 2: Write the failing test file**

Create `scripts/test-va-notes.ts`:

```ts
/* Venue Assessment notes (#344) — harness checks. `vaNotesChecks` is pure; `vaNotesDbChecks` needs the test DB.
   Run alone with `npx tsx scripts/test-va-notes.ts` (pure checks only). */
import type { Ok } from "./test-inbox-org";
import {
  SECTION_ORDER, STEP_BY_ID, STEP_LABELS, GROUP_BY_ID, GROUP_META, RIG_SYSTEMS, isQuoteVisit, scopeSet, inScope,
  rigSystems, hasCounterweight, hasLinesets, sectionVisible, splitGoalLines, recapFor, recapScopeText,
} from "../src/lib/survey-flow";

export async function vaNotesChecks(ok: Ok): Promise<void> {
  /* ---- Task 1: survey-flow ---- */
  ok(SECTION_ORDER.indexOf("tier1") === 2 && SECTION_ORDER[0] === "cust" && SECTION_ORDER[1] === "visit",
    "#344 A1: Kill questions come third, right after Customer & venue and Visit");
  ok(SECTION_ORDER.at(-1) === "assign" && SECTION_ORDER.indexOf("project") > SECTION_ORDER.indexOf("notes") &&
     SECTION_ORDER.indexOf("recap") > SECTION_ORDER.indexOf("project") && SECTION_ORDER.indexOf("finalThoughts") > SECTION_ORDER.indexOf("recap"),
    "#344 A1: wrap-up runs Scope & notes → Existing materials & quote → Customer recap → Final thoughts → Assignment (last)");
  ok(SECTION_ORDER.indexOf("m3d") === SECTION_ORDER.indexOf("mHouse") + 1 && SECTION_ORDER.indexOf("m3d") < SECTION_ORDER.indexOf("dRigging"),
    "#344 A1: the 3D preview is the last of the site information");
  ok(!SECTION_ORDER.includes("signoff") && !SECTION_ORDER.includes("conditions"), "#344 A6/A5: no Sign-off, no Site conditions section");
  ok(STEP_LABELS.join("|") === "Brief|Site & access|Measurements|Site intake|Assessment|Wrap-up", "#344 A1: wizard step labels");
  ok(SECTION_ORDER.every((id) => STEP_BY_ID[id] != null && GROUP_BY_ID[id] != null), "#344 A1: every section has a step and a group");
  ok(STEP_BY_ID.tier1 === 0 && STEP_BY_ID.assign === 5 && STEP_BY_ID.linesets === 3 && STEP_BY_ID.assessmentToggle === 4, "#344 A1: steps by id");
  ok(GROUP_BY_ID.tier1 === "brief" && GROUP_BY_ID.assign === "wrapup" && GROUP_META.wrapup.label === "Wrap-up", "#344 A1: groups by id");
  ok(RIG_SYSTEMS.join("|") === "Counterweight|Dead-hung|Motorized|Hemp|Fixed points|None", "#344 R3: rigging system options");

  ok(isQuoteVisit({ visitPurpose: "New system design" }) && !isQuoteVisit({ visitPurpose: "Bid walk" }) && !isQuoteVisit({}),
    "#344 A3: only New system design counts as a quote visit (Jeff, Q2)");

  ok(scopeSet({}) === null && scopeSet({ scope: [] }) === null && scopeSet({ scope: ["junk"] }) === null, "#344 R2: no known scope = unset");
  ok(JSON.stringify(scopeSet({ scope: ["av", "rigging", "x"] })) === '["rigging","av"]', "#344 R2: scope keeps known keys in canonical order");
  ok(inScope({}, "av") && inScope({ scope: ["av"] }, "av") && !inScope({ scope: ["rigging"] }, "av"), "#344 R2: unset scope filters nothing");

  const cw = { disciplines: { rigging: { present: ["Counterweight", "Motorized"] } } };
  ok(rigSystems(cw).join() === "Counterweight,Motorized" && hasCounterweight(cw) && hasLinesets(cw), "#344 R3: rig helpers read disciplines.rigging.present");
  ok(!hasLinesets({ disciplines: { rigging: { present: ["Fixed points"] } } }) && !hasCounterweight({}), "#344 R3: fixed points has no line sets");

  ok(sectionVisible({}, "dAv") && sectionVisible({}, "linesets"), "#344 R2: everything shows while scope is unset");
  ok(!sectionVisible({ scope: ["curtain"] }, "mBeams") && !sectionVisible({ scope: ["curtain"] }, "dRigging") && !sectionVisible({ scope: ["curtain"] }, "linesets"),
    "#344 R2: Beams, Rigging and Line sets need Rigging in scope");
  ok(!sectionVisible({ scope: ["rigging"] }, "mFOH") && sectionVisible({ scope: ["lighting"] }, "mFOH"), "#344 R2: FOH positions needs Lighting");
  ok(sectionVisible({ scope: ["rigging"] }, "mLayout") && sectionVisible({ scope: ["rigging"] }, "cust"), "#344 R2: unscoped sections always show");
  ok(!sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["None"] } } }, "linesets") &&
     sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["None"] } }, linesets: [{}] }, "linesets") &&
     sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } }, "linesets"),
    "#344 A1: Line set schedule hides for None / Fixed points unless rows exist");

  ok(JSON.stringify(splitGoalLines("- Fix the main\n• Add a cyc\n\n2. Quieter fly system  \nplain")) === '["Fix the main","Add a cyc","Quieter fly system","plain"]',
    "#344 A7: goal text splits on lines and drops bullets");
  ok(JSON.stringify(splitGoalLines([" a ", "", "b"])) === '["a","b"]' && splitGoalLines(undefined).length === 0, "#344 A7: goal arrays are trimmed");

  const rc = recapFor({
    scope: ["rigging", "lighting"],
    disciplines: {
      rigging: { scope: ["New grid"], goals: "Safer fly rail" },
      lighting: { scope: [], scopeOther: "LED retrofit study" },
      curtain: { scope: ["Flame test"] },
    },
  });
  ok(rc.map((e) => e.disc).join() === "rigging,lighting", "#344 A7: the recap lists in-scope disciplines only (curtain is out of scope)");
  ok(rc[0].label === "Rigging" && rc[0].scopes.join() === "New grid" && rc[0].goals.join() === "Safer fly rail" && rc[1].other === "LED retrofit study",
    "#344 A7: each entry carries scopes, Other text and goal lines");
  ok(recapFor({ disciplines: { curtain: { scope: ["Flame test"] }, av: {} } }).map((e) => e.disc).join() === "curtain",
    "#344 A7: with scope unset the recap lists disciplines that have scopes or goals");
  ok(recapScopeText(rc[1]) === "Other: LED retrofit study" && recapScopeText(rc[0]) === "New grid", "#344 A7: recap scope text");
}

export async function vaNotesDbChecks(ok: Ok): Promise<void> {
  void ok;
}

if (process.argv[1] && /test-va-notes\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  (async () => {
    await vaNotesChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall va-notes checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx scripts/test-va-notes.ts`
Expected: FAIL — cannot find module `../src/lib/survey-flow`.

- [ ] **Step 4: Write `src/lib/survey-flow.ts`**

```ts
/* Venue Assessments flow (#344, slice A) — the editor's section order, wizard steps and groups, the scope filter
   (Kill questions → which sections show), the one rigging-system answer, the quote-visit rule and the customer
   recap. Pure and client-safe: the editor, the field sheet, the findings text and the tests read it. */
import { DISCIPLINE_GROUPS, RIG_SYSTEMS, type DisciplineData, type DisciplineKey } from "./stores/survey-intake";

export { RIG_SYSTEMS };

export type FlowGroup = "brief" | "field" | "intake" | "assessment" | "wrapup";

/** Every editor section id, in display order. Sections that don't exist for a survey are skipped. */
export const SECTION_ORDER: readonly string[] = [
  "cust", "visit", "tier1",
  "site", "lifeSafety",
  "mQuick", "mLayout", "mSection", "mBeams", "mFOH", "mHouse", "m3d",
  "dRigging", "dCurtain", "dLighting", "dAv", "linesets",
  "assessmentToggle", "assessmentUsage", "assessmentCondition", "assessmentFindings",
  "photos", "notes", "project", "recap", "finalThoughts", "assign",
];

export const STEP_LABELS: readonly string[] = ["Brief", "Site & access", "Measurements", "Site intake", "Assessment", "Wrap-up"];

const IDS_BY_STEP: string[][] = [
  ["cust", "visit", "tier1"],
  ["site", "lifeSafety"],
  ["mQuick", "mLayout", "mSection", "mBeams", "mFOH", "mHouse", "m3d"],
  ["dRigging", "dCurtain", "dLighting", "dAv", "linesets"],
  ["assessmentToggle", "assessmentUsage", "assessmentCondition", "assessmentFindings"],
  ["photos", "notes", "project", "recap", "finalThoughts", "assign"],
];
const GROUP_BY_STEP: FlowGroup[] = ["brief", "field", "field", "intake", "assessment", "wrapup"];

export const STEP_BY_ID: Record<string, number> = Object.fromEntries(IDS_BY_STEP.flatMap((ids, step) => ids.map((id) => [id, step])));
export const GROUP_BY_ID: Record<string, FlowGroup> = Object.fromEntries(IDS_BY_STEP.flatMap((ids, step) => ids.map((id) => [id, GROUP_BY_STEP[step]])));

export const GROUP_META: Record<FlowGroup, { label: string; blurb: string }> = {
  brief: { label: "Office brief", blurb: "Who, why, and the kill questions" },
  field: { label: "Field capture", blurb: "Filled on-site by the surveyor" },
  intake: { label: "Site intake", blurb: "One branch per discipline in scope" },
  assessment: { label: "Condition & needs", blurb: "Advisory condition and planning profile" },
  wrapup: { label: "Wrap-up", blurb: "Last questions, the read-back, and internal notes" },
};

export const SCOPE_KEYS: readonly DisciplineKey[] = ["rigging", "curtain", "lighting", "av"];
export const SCOPE_LABEL: Record<DisciplineKey, string> = { rigging: "Rigging", curtain: "Curtains", lighting: "Lighting", av: "AV" };

/** The slice of a survey these rules read. */
export type FlowSlice = {
  visitPurpose?: string;
  scope?: unknown;
  disciplines?: Record<string, DisciplineData>;
  linesets?: unknown[];
};

/** Purposes that show the quote / budget half of Existing materials & quote (Jeff, Oct 14: New system design only). */
export const QUOTE_PURPOSES: readonly string[] = ["New system design"];

export function isQuoteVisit(s: Pick<FlowSlice, "visitPurpose">): boolean {
  return QUOTE_PURPOSES.includes(String(s.visitPurpose ?? "").trim());
}

/** The survey's scope in canonical order, or null while it is unanswered (null filters nothing). */
export function scopeSet(s: FlowSlice): DisciplineKey[] | null {
  if (!Array.isArray(s.scope)) return null;
  const raw = s.scope as unknown[];
  const keys = SCOPE_KEYS.filter((k) => raw.includes(k));
  return keys.length ? keys : null;
}

export function inScope(s: FlowSlice, k: DisciplineKey): boolean {
  const set = scopeSet(s);
  return !set || set.includes(k);
}

export function rigSystems(s: FlowSlice): string[] {
  const p = s.disciplines?.rigging?.present;
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

const LINESET_SYSTEMS = new Set(["Counterweight", "Dead-hung", "Motorized", "Hemp"]);
export const hasCounterweight = (s: FlowSlice): boolean => rigSystems(s).includes("Counterweight");
export const hasLinesets = (s: FlowSlice): boolean => rigSystems(s).some((x) => LINESET_SYSTEMS.has(x));

/** Sections that belong to one discipline's scope. */
const SECTION_SCOPE: Record<string, DisciplineKey> = {
  dRigging: "rigging", mBeams: "rigging", linesets: "rigging",
  dCurtain: "curtain",
  dLighting: "lighting", mFOH: "lighting",
  dAv: "av",
};

/** Whether a section shows for this survey. Hidden sections keep their stored answers. */
export function sectionVisible(s: FlowSlice, id: string): boolean {
  const k = SECTION_SCOPE[id];
  if (k && !inScope(s, k)) return false;
  if (id === "linesets") {
    if (Array.isArray(s.linesets) && s.linesets.length > 0) return true;
    return rigSystems(s).length === 0 || hasLinesets(s);
  }
  return true;
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;

/** One goal per line: a stored string splits on newlines with leading bullets dropped; an array is trimmed. */
export function splitGoalLines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (typeof v !== "string") return [];
  return v.split(/\r?\n/).map((line) => line.replace(BULLET, "").trim()).filter(Boolean);
}

export type RecapEntry = { disc: DisciplineKey; label: string; scopes: string[]; other: string; goals: string[] };

/** The end-of-visit read-back: per discipline in scope (or, with scope unset, per discipline with scopes or goals),
 *  its scopes of interest, the "Other" explanation and its client goals. */
export function recapFor(s: FlowSlice): RecapEntry[] {
  const set = scopeSet(s);
  const out: RecapEntry[] = [];
  for (const g of DISCIPLINE_GROUPS) {
    const d: DisciplineData = s.disciplines?.[g.key] || {};
    const scopes = Array.isArray(d.scope) ? d.scope.map((x) => String(x)).filter(Boolean) : [];
    const other = typeof d.scopeOther === "string" ? d.scopeOther.trim() : "";
    const goals = splitGoalLines(d.goals);
    const listed = set ? set.includes(g.key) : scopes.length > 0 || goals.length > 0 || other !== "";
    if (listed) out.push({ disc: g.key, label: SCOPE_LABEL[g.key], scopes, other, goals });
  }
  return out;
}

/** "New grid, Add hoists, Other: …" — the scopes line for the sheet and the findings text. */
export function recapScopeText(e: RecapEntry): string {
  return [...e.scopes.filter((x) => x !== "Other"), e.other ? `Other: ${e.other}` : ""].filter(Boolean).join(", ");
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-va-notes.ts`
Expected: every line `PASS`, ending `all va-notes checks passed`.

- [ ] **Step 6: Wire the checks into `test:specs`**

In `scripts/test-review-and-spec.ts`, next to `import { assessmentChecks, assessmentDbChecks } from "./test-assessments";` (line ~11352) add:

```ts
import { vaNotesChecks, vaNotesDbChecks } from "./test-va-notes";
```

and change the chain line `.then(() => assessmentChecks(ok)).then(() => assessmentDbChecks(ok))` (line ~11716) to:

```ts
  .then(() => assessmentChecks(ok)).then(() => assessmentDbChecks(ok))
  .then(() => vaNotesChecks(ok)).then(() => vaNotesDbChecks(ok))
```

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/survey-flow.ts src/lib/stores/survey-intake.ts scripts/test-va-notes.ts scripts/test-review-and-spec.ts
git commit -m "feat(venue-assessments): #344 survey-flow — order, scope filter, rig system, quote rule, recap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Read-time migration, record types, rigging + Tier 1 rules

**Files:**
- Create: `src/lib/survey-migrate.ts`
- Modify: `src/lib/stores/survey-intake.ts` (rigging group; Tier 1)
- Modify: `src/lib/stores/surveys.ts` (types, `BEAM_FIELDS`, `normalize`)
- Modify: `scripts/test-va-notes.ts`, `scripts/test-review-and-spec.ts` (Tier 1 fixtures)

**Interfaces:**
- Consumes: `RIG_SYSTEMS`, `DISCIPLINE_GROUPS`, `SYSTEM_KEYS`, `presentOptionsFor`, `disciplineHasData`, types from survey-intake.
- Produces:
  - `type LegacyNote = { section: string; label: string; text: string }`
  - `type MigratableSurvey` (structural), `addLegacyNote(s, note): void`, `stepRigSystem(s)`, `stepSystemsStateFold(s)`, `stepSeedScope(s)`, `migrateSurvey<T extends MigratableSurvey>(s: T): T`
  - `SurveyDraft` gains optional `scope?: string[]`, `internalTags?: string[]`, `legacyNotes?: LegacyNote[]`
  - `Tier1Slice` gains `scope?: unknown; disciplines?: Record<string, DisciplineData>`; `Tier1Item.section: "cust" | "mQuick" | "tier1"`; item keys `venue, contact, contactEmail, stageWidth, stageDepth, scope, rigSystem` (rigSystem only when Rigging is in scope)

- [ ] **Step 1: Add the failing checks**

Append inside `vaNotesChecks` in `scripts/test-va-notes.ts` (and add the imports at the top):

```ts
import { migrateSurvey, addLegacyNote, type MigratableSurvey } from "../src/lib/survey-migrate";
import { tier1Items, tier1Complete, DISCIPLINE_GROUPS, presentOptionsFor } from "../src/lib/stores/survey-intake";
import { BEAM_FIELDS } from "../src/lib/stores/surveys";
```

> `BEAM_FIELDS` comes from `src/lib/stores/surveys.ts`, which imports the DB. The harness already imports stores, so this is fine in `test:specs`; when running the file alone, tsx resolves it without opening the DB (the store only touches the DB inside functions).

```ts
  /* ---- Task 2: migration + Tier 1 ---- */
  const m = (s: MigratableSurvey) => migrateSurvey(JSON.parse(JSON.stringify(s)) as MigratableSurvey);
  const a1 = m({ measurements: { rigType: "Hemp" } });
  ok(JSON.stringify(a1.disciplines?.rigging?.present) === '["Hemp"]' && (a1.legacyNotes || []).length === 0,
    "#344 R3: an unanswered rigging system copies up from Beams' Existing rig type");
  const a2 = m({ measurements: { rigType: "None existing" }, disciplines: { rigging: { counterweight: true } } });
  ok(JSON.stringify(a2.disciplines?.rigging?.present) === '["Counterweight"]', "#344 R3: None drops out when another source names a system");
  const a3 = m({ conditions: ["Existing rigging — hemp", "Motorized hoists present", "Low grid clearance"] });
  ok(JSON.stringify(a3.disciplines?.rigging?.present) === '["Hemp","Motorized"]', "#344 R3: the old condition chips copy up");
  const a4 = m({ measurements: { rigType: "Hemp" }, disciplines: { rigging: { present: ["Counterweight system", "Dead-hung battens"], counterweight: true } } });
  ok(JSON.stringify(a4.disciplines?.rigging?.present) === '["Counterweight","Dead-hung"]', "#344 R3: old Present labels relabel on read");
  ok((a4.legacyNotes || []).some((n) => n.section === "mBeams" && n.text === "Hemp") && !(a4.legacyNotes || []).some((n) => n.section === "dRigging"),
    "#344 R1: an answered system keeps a disagreeing rig type as an Older note");
  ok(a4.measurements?.rigType === "Hemp" && a4.disciplines?.rigging?.counterweight === true, "#344 R1: migration never deletes the old keys");
  const a5 = m({ systemsState: { rigging: { installed: "yes", desc: "" } } });
  ok(JSON.stringify(a5.disciplines?.rigging?.present) === JSON.stringify([presentOptionsFor("rigging", "theatre")[0]]) && a5.disciplines?.rigging?.present?.[0] === "Counterweight",
    "#344: the systemsState fold still seeds Present (now the new first option)");
  const a6 = m({ disciplines: { lighting: { goals: "Brighter wash" }, curtain: { present: ["None"] } } });
  ok(JSON.stringify(a6.scope) === '["lighting"]', "#344 R2: scope seeds from disciplines with data (None-only doesn't count)");
  ok(m({}).scope === undefined && JSON.stringify(m({ scope: [] }).scope) === "[]", "#344 R2: nothing to seed → scope stays unset; an answered scope is kept");
  const twice = m(m({ measurements: { rigType: "Bogus" }, disciplines: { rigging: { present: ["Hemp"] } } }) as MigratableSurvey);
  ok((twice.legacyNotes || []).filter((n) => n.text === "Bogus").length === 1, "#344 R1: migration is idempotent (notes de-duplicate)");
  const stored = m({ legacyNotes: [{ section: "x", label: "y", text: "stale" }] });
  ok((stored.legacyNotes || []).length === 0, "#344 R1: legacyNotes are re-derived on every read, never trusted from storage");
  const ln: MigratableSurvey = {};
  addLegacyNote(ln, { section: "s", label: "l", text: "   " });
  ok(!(ln.legacyNotes || []).length, "#344 R1: a blank note is dropped");

  ok(!BEAM_FIELDS.some((f) => f.key === "rigType"), "#344 R3: Beams & rigging no longer asks Existing rig type");
  const rigGroup = DISCIPLINE_GROUPS.find((g) => g.key === "rigging")!;
  ok(rigGroup.presentOptions.join("|") === "Counterweight|Dead-hung|Motorized|Hemp|Fixed points|None" && !rigGroup.fields.some((f) => f.key === "counterweight"),
    "#344 R3: Rigging Present uses the rig-system list; its Counterweight check is gone");

  const base = { venue: "Hall", contact: "Pat", contactEmail: "p@x.org", measurements: { proW: "40", stageDepth: "30" } };
  ok(tier1Items(base).map((i) => i.key).join() === "venue,contact,contactEmail,stageWidth,stageDepth,scope", "#344 A2: Tier 1 items (no phone; scope added)");
  ok(!tier1Complete(base) && tier1Complete({ ...base, scope: ["curtain"] }), "#344 A2: Tier 1 needs a scope; contact phone isn't required");
  ok(tier1Items({ ...base, scope: ["rigging"] }).some((i) => i.key === "rigSystem" && !i.done) && !tier1Complete({ ...base, scope: ["rigging"] }),
    "#344 A2: Rigging in scope adds an unanswered Rigging system item");
  ok(tier1Complete({ ...base, scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } }), "#344 A2: answering the rigging system completes Tier 1");
  ok(tier1Items(base).find((i) => i.key === "stageWidth")?.section === "tier1" && tier1Items(base).find((i) => i.key === "contact")?.section === "cust",
    "#344 A2: stage W/D are answered on the card; contact jumps to Customer & venue");
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx scripts/test-va-notes.ts`
Expected: FAIL — cannot find module `../src/lib/survey-migrate`.

- [ ] **Step 3: Create `src/lib/survey-migrate.ts`**

```ts
/* Venue Assessments read-time migration (#344). normalize() in src/lib/stores/surveys.ts runs migrateSurvey on
   every read. Each step is pure, idempotent and never deletes a key: an old value that doesn't map is kept and
   surfaced as a LegacyNote. legacyNotes is re-derived on every read and never stored (the editor strips it before
   a save), so a rollback still reads the old keys. Client-safe. */
import {
  DISCIPLINE_GROUPS,
  SYSTEM_KEYS,
  disciplineHasData,
  presentOptionsFor,
  type DisciplineData,
  type DisciplineKey,
  type InventoryRow,
  type SystemState,
} from "./stores/survey-intake";
import type { VenueClass } from "./stores/venue-classes";

/** An old answer the new form has no field for — shown under "Older notes" in its section. */
export type LegacyNote = { section: string; label: string; text: string };

export type MigratableSurvey = {
  venueClass?: VenueClass;
  measurements?: Record<string, string | boolean>;
  conditions?: string[];
  systemsState?: Record<string, SystemState>;
  disciplines?: Record<string, DisciplineData>;
  inventory?: InventoryRow[];
  scope?: string[];
  legacyNotes?: LegacyNote[];
};

export function addLegacyNote(s: MigratableSurvey, note: LegacyNote): void {
  const text = String(note.text ?? "").trim();
  if (!text) return;
  const list = (s.legacyNotes ||= []);
  if (list.some((n) => n.section === note.section && n.label === note.label && n.text === text)) return;
  list.push({ section: note.section, label: note.label, text });
}

const dedupe = (xs: string[]): string[] => xs.filter((x, i) => xs.indexOf(x) === i);

const RIG_RELABEL: Record<string, string> = {
  "Counterweight system": "Counterweight",
  "Dead-hung battens": "Dead-hung",
  "Motorized rigging": "Motorized",
};
const RIG_TYPE_TO_SYSTEM: Record<string, string> = {
  "Dead-hung": "Dead-hung",
  Counterweight: "Counterweight",
  Motorized: "Motorized",
  Hemp: "Hemp",
  "None existing": "None",
};
const CONDITION_TO_SYSTEM: Record<string, string> = {
  "Existing rigging — counterweight": "Counterweight",
  "Existing rigging — hemp": "Hemp",
  "Motorized hoists present": "Motorized",
};

/** R3: one rigging-system answer at disciplines.rigging.present. Relabels old options; when never answered,
 *  copies up from Beams' Existing rig type, the old Counterweight check and the old condition chips. */
export function stepRigSystem(s: MigratableSurvey): void {
  const rig = s.disciplines?.rigging;
  const rigTypeRaw = String(s.measurements?.rigType ?? "").trim();
  const fromType = RIG_TYPE_TO_SYSTEM[rigTypeRaw] ?? "";
  const cwCheck = rig?.counterweight === true;

  if (rig && Array.isArray(rig.present)) {
    const present = dedupe(rig.present.map((p) => RIG_RELABEL[String(p)] ?? String(p)));
    rig.present = present;
    if (rigTypeRaw && !(fromType && present.includes(fromType))) {
      addLegacyNote(s, { section: "mBeams", label: "Existing rig type (before #344)", text: rigTypeRaw });
    }
    if (cwCheck && !present.includes("Counterweight")) {
      addLegacyNote(s, { section: "dRigging", label: "Counterweight system (old check)", text: "Yes" });
    }
    return;
  }

  if (rigTypeRaw && !fromType) addLegacyNote(s, { section: "mBeams", label: "Existing rig type (before #344)", text: rigTypeRaw });
  let seed = dedupe(
    [fromType, cwCheck ? "Counterweight" : "", ...(s.conditions || []).map((c) => CONDITION_TO_SYSTEM[c] ?? "")].filter(Boolean)
  );
  if (seed.length > 1) seed = seed.filter((x) => x !== "None");
  if (!seed.length) return;
  const d = (s.disciplines ||= {});
  d.rigging = { ...(rig || {}), present: seed };
}

/** The Tier-3 systemsState fold (moved here from surveys.ts unchanged): a system marked installed:"yes" seeds that
 *  discipline's Present with its first option, once — guarded by Present already being an array. */
export function stepSystemsStateFold(s: MigratableSurvey): void {
  SYSTEM_KEYS.forEach(({ key }) => {
    const st = s.systemsState?.[key];
    if (!st || st.installed !== "yes") return;
    const d = (s.disciplines ||= {});
    const branch = (d[key] ||= {});
    if (!Array.isArray(branch.present)) {
      branch.present = [presentOptionsFor(key as DisciplineKey, s.venueClass || "theatre")[0]].filter(Boolean);
    }
  });
}

/** R2: an unanswered scope seeds from the disciplines that already hold data (a None-only Present doesn't count).
 *  Nothing to seed → scope stays unset, which filters nothing. */
export function stepSeedScope(s: MigratableSurvey): void {
  if (Array.isArray(s.scope)) return;
  const inv = s.inventory || [];
  const keys = DISCIPLINE_GROUPS.map((g) => g.key).filter((k) => {
    const d = s.disciplines?.[k];
    if (!d) return inv.some((r) => r.discipline === k);
    const present = Array.isArray(d.present) ? d.present : [];
    const noneOnly = present.length > 0 && present.every((p) => String(p).toLowerCase() === "none");
    const rest: DisciplineData = { ...d };
    if (noneOnly) delete rest.present;
    return disciplineHasData(rest, inv, k);
  });
  if (keys.length) s.scope = keys;
}

/** The whole chain, in order. Mutates and returns `s`. */
export function migrateSurvey<T extends MigratableSurvey>(s: T): T {
  s.legacyNotes = [];
  stepRigSystem(s);
  stepSystemsStateFold(s);
  stepSeedScope(s);
  return s;
}
```

> Why the rig step runs before the fold: an old survey with `measurements.rigType = "Hemp"` and `systemsState.rigging.installed = "yes"` must read as Hemp, not the fold's default first option.

- [ ] **Step 4: Update survey-intake (rigging group + Tier 1)**

In `src/lib/stores/survey-intake.ts`:

1. Rigging group: replace `presentOptions: ["Counterweight system", "Dead-hung battens", "Motorized rigging", "Fixed points", "None"],` with:

```ts
    presentOptions: [...RIG_SYSTEMS],
```

and delete the field line `{ key: "counterweight", label: "Counterweight system", type: "check" },`. Keep `counterweightNotes`.

2. Replace the Tier 1 block (`Tier1Slice`, `Tier1Item`, `tier1Items`) with:

```ts
/** The slice of a survey record tier-1 completeness looks at. */
export interface Tier1Slice {
  venue?: string;
  customer?: string;
  contact?: string;
  contactEmail?: string;
  contactPhone?: string;
  measurements?: Record<string, string | boolean>;
  /** #344 — the scope kill question (DisciplineKey[]); unset / empty = unanswered */
  scope?: unknown;
  disciplines?: Record<string, DisciplineData>;
}

export interface Tier1Item {
  key: string;
  label: string;
  done: boolean;
  /** where it is answered: jump to Customer & venue / Measurements, or inline on the Kill questions card */
  section: "cust" | "mQuick" | "tier1";
}

const SCOPE_DISCIPLINES = ["rigging", "curtain", "lighting", "av"];

export function tier1Items(s: Tier1Slice): Tier1Item[] {
  const m = s.measurements || {};
  const has = (keys: string[]) => keys.some((k) => String(m[k] ?? "").trim() !== "");
  const scope = Array.isArray(s.scope) ? (s.scope as unknown[]).filter((k): k is string => typeof k === "string" && SCOPE_DISCIPLINES.includes(k)) : [];
  const rigPresent = s.disciplines?.rigging?.present;
  const items: Tier1Item[] = [
    { key: "venue", label: "Venue name", done: !!(s.venue || "").trim() || !!(s.customer || "").trim(), section: "cust" },
    { key: "contact", label: "Contact name", done: !!(s.contact || "").trim(), section: "cust" },
    { key: "contactEmail", label: "Contact email", done: !!(s.contactEmail || "").trim(), section: "cust" },
    { key: "stageWidth", label: "Stage width", done: has(TIER1_WIDTH_KEYS), section: "tier1" },
    { key: "stageDepth", label: "Stage depth", done: has(TIER1_DEPTH_KEYS), section: "tier1" },
    { key: "scope", label: "Scope", done: scope.length > 0, section: "tier1" },
  ];
  if (scope.includes("rigging")) {
    items.push({ key: "rigSystem", label: "Rigging system", done: Array.isArray(rigPresent) && rigPresent.length > 0, section: "tier1" });
  }
  return items;
}
```

Also update the comment above `TIER1_WIDTH_KEYS` ("Venue name, contact name/email/phone…") to "Venue name, contact name/email, stage width/depth, scope, and the rigging system when Rigging is in scope (#344 — contact phone is no longer a kill question)."

- [ ] **Step 5: Update `src/lib/stores/surveys.ts`**

1. `BEAM_FIELDS`: delete the line `{ key: "rigType", label: "Existing rig type", type: "select", options: RIG_TYPES },`. Leave `RIG_TYPES` exported (other code may import it; the migration maps its values).
2. Add `import { migrateSurvey, type LegacyNote } from "@/lib/survey-migrate";` with the other imports (match the file's import style — if it uses relative imports for lib modules, use `"../survey-migrate"`).
3. In `SurveyDraft`, after `visitId: string | null;` add:

```ts
  // ---- #344 Venue Assessment notes ----
  /** the scope kill question — DisciplineKey[]; absent/empty = unanswered (filters nothing) */
  scope?: string[];
  /** Final thoughts — internal tag ids (settings.surveyInternalTags); never printed for the customer */
  internalTags?: string[];
  /** derived on every read by migrateSurvey — never stored */
  legacyNotes?: LegacyNote[];
```

4. In `normalize()`, delete the `SYSTEM_KEYS.forEach(...)` fold block (now `stepSystemsStateFold`) and replace it with `migrateSurvey(s);` immediately before `return s;`. Update the doc comment's last paragraph: "#344: the rig-system copy-up, the systemsState fold and the scope seed run in src/lib/survey-migrate.ts (migrateSurvey)." Remove imports that become unused (`SYSTEM_KEYS`, `presentOptionsFor`, `DisciplineKey` if no longer referenced — check with `grep -n` before removing).

- [ ] **Step 6: Update the existing Tier 1 checks**

In `scripts/test-review-and-spec.ts` (~line 7353–7372, "Venue Assessments: Tier-1 keys cover the new classes"), add `scope: ["curtain"],` to both `tier1Complete({...})` fixtures. Then search for other callers:

```bash
grep -n "tier1Complete\|tier1Items\|intakeStatus(" scripts/*.ts | grep -v test-va-notes
```

For each fixture that expects Tier 1 complete (or an intake status other than `"draft"`), add `scope: ["<a discipline it uses>"]` (and, if that discipline is `rigging`, `disciplines.rigging.present: ["Counterweight"]`). Don't change assertions.

- [ ] **Step 7: Run checks and typecheck**

```bash
npx tsx scripts/test-va-notes.ts && npx tsc --noEmit
```
Expected: all PASS; tsc clean. If tsc reports `rigType` / `counterweight` usages elsewhere, read each: UI references are handled in Task 6; anything else (e.g. `design/quick/engine.ts` has its own `rigType`) is unrelated — leave it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/survey-migrate.ts src/lib/stores/survey-intake.ts src/lib/stores/surveys.ts scripts/test-va-notes.ts scripts/test-review-and-spec.ts
git commit -m "feat(venue-assessments): #344 read-time migration — one rigging system, scope seed, Tier 1 scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Internal tags — setting, Settings → Field card

**Files:**
- Create: `src/lib/survey-tags.ts`
- Create: `src/app/(app)/settings/survey-tags-card.tsx`
- Modify: `src/lib/settings.ts`, `src/app/(app)/settings/actions.ts`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-client.tsx`, `src/app/(app)/settings/groups/field.tsx`, `src/app/(app)/settings/groups/types.ts`
- Modify: `scripts/test-va-notes.ts`

**Interfaces:**
- Produces:
  - `type SurveyTag = { id: string; label: string; retired?: boolean }`
  - `type SurveyTagInput = { id?: string; label: string; retired?: boolean }`
  - `STARTER_SURVEY_TAGS: readonly SurveyTag[]`, `MAX_SURVEY_TAGS = 40`
  - `resolveSurveyTags(stored: unknown): SurveyTag[]`
  - `mergeSurveyTags(stored: readonly SurveyTag[], input: unknown): { ok: true; tags: SurveyTag[] } | { ok: false; error: string }`
  - `activeSurveyTags(tags): SurveyTag[]`, `surveyTagLabel(tags, id): string`
  - Settings key `surveyInternalTags?: SurveyTag[]`
  - Server action `saveSurveyTagsAction(input: SurveyTagInput[]): Promise<{ ok: true } | { ok: false; error: string }>`
  - `SettingsData.surveyTags: SurveyTag[]`

- [ ] **Step 1: Failing checks**

Add to `scripts/test-va-notes.ts` imports:

```ts
import { STARTER_SURVEY_TAGS, resolveSurveyTags, mergeSurveyTags, activeSurveyTags, surveyTagLabel } from "../src/lib/survey-tags";
```

and append to `vaNotesChecks`:

```ts
  /* ---- Task 3: internal tags ---- */
  ok(STARTER_SURVEY_TAGS.map((t) => t.label).join("|") ===
    "Tight timeline|Price-sensitive|Strong champion|Competitor involved|Budget not confirmed|Decision-maker not met|Active venue (work around events)|Volunteer install crew available|Historic / preservation constraints",
    "#344 A5: the nine starter tags (Jeff, Q6)");
  ok(STARTER_SURVEY_TAGS.every((t) => /^tg_[a-z0-9_]+$/.test(t.id)) && new Set(STARTER_SURVEY_TAGS.map((t) => t.id)).size === 9, "#344 A5: starter ids are tg_ slugs, unique");
  ok(resolveSurveyTags(undefined).length === 9 && resolveSurveyTags([]).length === 9, "#344 A5: absent / empty reads as the starter list");
  ok(resolveSurveyTags([{ id: "tg_a", label: " A " }, { id: "bad id", label: "B" }, { id: "tg_a", label: "dup" }, { id: "tg_c", label: "" }]).map((t) => t.id + ":" + t.label).join() === "tg_a:A",
    "#344 A5: resolve drops bad ids, duplicates and blank labels");
  const st = resolveSurveyTags(undefined);
  const r1 = mergeSurveyTags(st, [{ id: "tg_tight_timeline", label: "Very tight timeline" }, { label: "Board approval needed" }]);
  ok(r1.ok && r1.tags[0].label === "Very tight timeline" && r1.tags[1].id === "tg_board_approval_needed" && !r1.tags[1].retired,
    "#344 A5: rename keeps the id; a new row mints a tg_ id");
  ok(r1.ok && r1.tags.filter((t) => t.retired).length === 8, "#344 A5: rows dropped from the editor are kept, retired (stored surveys keep their label)");
  ok(r1.ok && activeSurveyTags(r1.tags).length === 2 && surveyTagLabel(r1.tags, "tg_price_sensitive") === "Price-sensitive" && surveyTagLabel(r1.tags, "tg_gone") === "tg_gone",
    "#344 A5: active filter and labels (unknown id shows raw)");
  const r2 = mergeSurveyTags(st, [{ label: "X" }, { label: "x" }]);
  ok(!r2.ok && /Two tags/.test(r2.error), "#344 A5: duplicate active labels are refused");
  const r3 = mergeSurveyTags(st, [{ id: "tg_nope", label: "Y" }]);
  ok(!r3.ok && /Unknown tag/.test(r3.error), "#344 A5: an unknown id is refused");
  const r4 = mergeSurveyTags(st, [{ label: "" }]);
  ok(!r4.ok, "#344 A5: a blank label is refused");
```

Run `npx tsx scripts/test-va-notes.ts` → FAIL (module not found).

- [ ] **Step 2: Create `src/lib/survey-tags.ts`**

```ts
/* Venue Assessments — internal "Final thoughts" tags (#344, note 6). Judgments for internal use only ("Tight
   timeline", "Price-sensitive"…), never printed for the customer. Pure. Stored whole in the settings row as
   `surveyInternalTags` (Settings → Field); absent reads as the starter list. Ids are minted from the label once and
   never change; a row dropped in the editor is kept retired, so a survey that carries it still shows its label. */

export type SurveyTag = { id: string; label: string; retired?: boolean };
export type SurveyTagInput = { id?: string; label: string; retired?: boolean };

export const MAX_SURVEY_TAGS = 40;
const LABEL_MAX = 60;
const ID_RE = /^tg_[a-z0-9_]{1,40}$/;

function slug(label: string): string {
  return label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "tag";
}

export function mintTagId(label: string, taken: ReadonlySet<string>): string {
  const base = "tg_" + slug(label);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

const STARTER_LABELS = [
  "Tight timeline",
  "Price-sensitive",
  "Strong champion",
  "Competitor involved",
  "Budget not confirmed",
  "Decision-maker not met",
  "Active venue (work around events)",
  "Volunteer install crew available",
  "Historic / preservation constraints",
];

export const STARTER_SURVEY_TAGS: readonly SurveyTag[] = (() => {
  const taken = new Set<string>();
  return STARTER_LABELS.map((label) => {
    const id = mintTagId(label, taken);
    taken.add(id);
    return { id, label };
  });
})();

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The stored list, sanitized: bad / duplicate ids and blank labels dropped. Absent or empty → the starter list. */
export function resolveSurveyTags(stored: unknown): SurveyTag[] {
  if (!Array.isArray(stored) || !stored.length) return STARTER_SURVEY_TAGS.map((t) => ({ ...t }));
  const seen = new Set<string>();
  const out: SurveyTag[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const label = clean(r.label, LABEL_MAX);
    if (!ID_RE.test(id) || seen.has(id) || !label) continue;
    seen.add(id);
    out.push(r.retired === true ? { id, label, retired: true } : { id, label });
  }
  return out.length ? out : STARTER_SURVEY_TAGS.map((t) => ({ ...t }));
}

export function activeSurveyTags(tags: readonly SurveyTag[]): SurveyTag[] {
  return tags.filter((t) => !t.retired);
}

export function surveyTagLabel(tags: readonly SurveyTag[], id: string): string {
  return tags.find((t) => t.id === id)?.label ?? id;
}

/** The editor's whole-list save over the stored (resolved) list. */
export function mergeSurveyTags(
  stored: readonly SurveyTag[],
  input: unknown
): { ok: true; tags: SurveyTag[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  const known = new Set(stored.map((t) => t.id));
  const taken = new Set(known);
  const used = new Set<string>();
  const labels = new Set<string>();
  const out: SurveyTag[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = clean(r.label, LABEL_MAX + 1);
    if (!label) return { ok: false, error: "Every tag needs a name." };
    if (label.length > LABEL_MAX) return { ok: false, error: `"${label.slice(0, LABEL_MAX)}…" is longer than ${LABEL_MAX} characters.` };
    const retired = r.retired === true;
    if (!retired) {
      const lower = label.toLowerCase();
      if (labels.has(lower)) return { ok: false, error: `Two tags are named "${label}".` };
      labels.add(lower);
    }
    let id = typeof r.id === "string" ? r.id : "";
    if (id) {
      if (!known.has(id)) return { ok: false, error: `Unknown tag "${id}".` };
    } else {
      id = mintTagId(label, taken);
      taken.add(id);
    }
    if (used.has(id)) return { ok: false, error: `"${label}" is listed twice.` };
    used.add(id);
    out.push(retired ? { id, label, retired: true } : { id, label });
  }
  for (const t of stored) {
    if (!used.has(t.id)) out.push({ id: t.id, label: t.label, retired: true });
  }
  if (out.length > MAX_SURVEY_TAGS) return { ok: false, error: `At most ${MAX_SURVEY_TAGS} tags.` };
  return { ok: true, tags: out };
}
```

Run `npx tsx scripts/test-va-notes.ts` → all PASS.

- [ ] **Step 3: Settings key + action**

1. `src/lib/settings.ts`: next to `documentCategories?: …` in the settings type, add:

```ts
  /** #344 — Venue Assessments Final thoughts: internal tags. FULL REPLACEMENT on save; resolveSurveyTags in
   *  lib/survey-tags returns the starter list when absent. Edited in Settings → Field. */
  surveyInternalTags?: import("@/lib/survey-tags").SurveyTag[];
```

2. `src/app/(app)/settings/actions.ts`: import `{ mergeSurveyTags, resolveSurveyTags, type SurveyTagInput } from "@/lib/survey-tags"` and add after `saveDocumentCategoriesAction`:

```ts
/* ---- Venue Assessments internal tags (#344) ---- */

/** Whole-list save of Settings → Field → Final thoughts tags. Strict read: a failed read must never merge onto the
 *  starter list and silently drop custom tags. */
export async function saveSurveyTagsAction(
  input: SurveyTagInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const stored = resolveSurveyTags((await getSettingsStrict()).surveyInternalTags);
  const merged = mergeSurveyTags(stored, input);
  if (!merged.ok) return merged;
  await setSettings({ surveyInternalTags: merged.tags });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 4: The card**

Create `src/app/(app)/settings/survey-tags-card.tsx` by copying `document-categories-card.tsx` and changing exactly:
- component name `SurveyTagsCard({ tags }: { tags: SurveyTag[] })`; `Row = { id: string; label: string; retired: boolean }`; seed maps `tags.map((t) => ({ id: t.id, label: t.label, retired: !!t.retired }))`.
- imports: `import type { SurveyTag } from "@/lib/survey-tags";` and `import { saveSurveyTagsAction } from "./actions";` (drop `OTHER_CATEGORY`).
- save: `saveSurveyTagsAction(rows.map((x) => ({ id: x.id || undefined, label: x.label, retired: x.retired })))`.
- title `Final thoughts — internal tags`; description: `Quick judgments the surveyor tags at the end of a venue assessment — for the team only, never printed for the customer. Retire a tag to stop offering it; assessments that already carry it keep the label.`
- input `maxLength={60}`, placeholder `Tag name`, aria-label `Tag name`; mono column shows `r.id || "new"`; checkbox label `Retired` bound to `retired` (no disabled rule); add button `+ Add tag`; save button `Save tags`; move buttons' aria-labels say `tag`.
- keep the header comment short: `/* Settings → Field → Final thoughts tags (#344). The DocumentCategoriesCard idiom: whole-list save, ids minted server-side, a dropped row is kept retired. */`

- [ ] **Step 5: Wire it into Settings → Field**

1. `src/app/(app)/settings/groups/types.ts` `SettingsData`: add `surveyTags: import("@/lib/survey-tags").SurveyTag[];` next to `visitReasons`.
2. `src/app/(app)/settings/page.tsx`: import `resolveSurveyTags` from `@/lib/survey-tags`; next to `visitReasons={…}` add `surveyTags={resolveSurveyTags(settings.surveyInternalTags)}`.
3. `src/app/(app)/settings/settings-client.tsx` `case "field":` — add `surveyTags={data.surveyTags}`.
4. `src/app/(app)/settings/groups/field.tsx`: add prop `surveyTags: SurveyTag[]` (type import), and render `<SurveyTagsCard tags={surveyTags} />` after the Site-visits reason picklist card (last card in the group). Import `SurveyTagsCard` from `"../survey-tags-card"`.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit && npx tsx scripts/test-va-notes.ts | tail -1
git add src/lib/survey-tags.ts src/lib/settings.ts "src/app/(app)/settings" scripts/test-va-notes.ts
git commit -m "feat(settings): #344 Final thoughts internal tags — list, merge rules, Settings → Field card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Assignment defaults on create (note 3)

**Files:**
- Modify: `src/app/(app)/venue-assessments/actions.ts` (`createSurvey`)
- Modify: `src/lib/stores/site-visits.ts` (`requestVisitForLead`)
- Modify: `scripts/test-va-notes.ts` (db check + source pin)

**Interfaces:**
- Consumes: `chicagoDayKey(ms: number): string` from `src/lib/drive-plan/day.ts` (pure).
- Produces: new surveys carry `assignedTo` (creator name, or the visit's assignee) and `scheduledDate` (today, Chicago `YYYY-MM-DD`); stage stays `requested`.

- [ ] **Step 1: Failing checks**

In `scripts/test-va-notes.ts`, add at the top:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Append to `vaNotesChecks`:

```ts
  /* ---- Task 4: assignment defaults (source pin) ---- */
  const vaActs = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/actions.ts"), "utf8");
  ok(/create\(\{ owner: user\.name, requestedBy: user\.name, stage: "requested", assignedTo: user\.name, scheduledDate: chicagoDayKey\(Date\.now\(\)\) \}, user\.name\)/.test(vaActs),
    "#344 A4: New request defaults Assigned to = me and Scheduled date = today (Chicago); stage stays requested");
```

Replace the body of `vaNotesDbChecks` with:

```ts
export async function vaNotesDbChecks(ok: Ok): Promise<void> {
  const { fixtureId, registerFixture } = await import("./test-fixtures");
  const { requestVisitForLead } = await import("../src/lib/stores/site-visits");
  const S = await import("../src/lib/stores/surveys");
  const { chicagoDayKey } = await import("../src/lib/drive-plan/day");
  const lead = (n: string) => ({ id: fixtureId(342, n), org: "VA fixture", contact: "Pat", email: "p@x.org", phone: "", address: "", city: "", state: "", customerId: null });

  const r1 = await requestVisitForLead(lead("lead-a"), { reason: "walk", timing: "", assignee: "Sam Surveyor" }, "Office Person");
  if (r1.ok) { registerFixture("site_visits", r1.visitId); registerFixture("surveys", r1.surveyId); }
  const s1 = r1.ok ? await S.get(r1.surveyId) : null;
  ok(!!s1 && s1.assignedTo === "Sam Surveyor" && s1.scheduledDate === chicagoDayKey(Date.now()) && s1.stage === "requested",
    "#344 A4: a lead's visit request pre-fills the survey with the visit's assignee and today; stage stays requested");

  const r2 = await requestVisitForLead(lead("lead-b"), { reason: "walk", timing: "", assignee: "  " }, "Office Person");
  if (r2.ok) { registerFixture("site_visits", r2.visitId); registerFixture("surveys", r2.surveyId); }
  const s2 = r2.ok ? await S.get(r2.surveyId) : null;
  ok(!!s2 && s2.assignedTo === "Office Person", "#344 A4: with no assignee the survey defaults to whoever requested it");
}
```

> Check `scripts/test-fixtures.ts` for the exact `registerFixture(collection, id)` and `fixtureId(n, tag)` signatures before running; adjust the call shape if they differ.

Run: `npm run test:specs 2>&1 | grep "#344" | grep -v PASS` → the A4 lines FAIL.

- [ ] **Step 2: Implement**

1. `src/app/(app)/venue-assessments/actions.ts`: `import { chicagoDayKey } from "@/lib/drive-plan/day";` and change the create call to exactly:

```ts
    rec = await create({ owner: user.name, requestedBy: user.name, stage: "requested", assignedTo: user.name, scheduledDate: chicagoDayKey(Date.now()) }, user.name);
```

Update the doc comment: append "#344: it opens assigned to the creator and scheduled for today (Chicago); both stay editable and the stage stays requested."

2. `src/lib/stores/site-visits.ts`: add `import { chicagoDayKey } from "../drive-plan/day";` (match the file's import style) and in the `createSurvey({...}, me)` call inside `requestVisitForLead` add:

```ts
      // #344 — pre-filled, editable: the visit's assignee (else whoever asked) and today
      assignedTo: opts.assignee.trim() || me,
      scheduledDate: chicagoDayKey(Date.now()),
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "#344|FAIL" | grep -v PASS | head
```
Expected: no `#344` failures (pre-existing unrelated FAIL lines, if any, must match the baseline — note them).

```bash
git add "src/app/(app)/venue-assessments/actions.ts" src/lib/stores/site-visits.ts scripts/test-va-notes.ts
git commit -m "feat(venue-assessments): #344 new assessments default to the creator (or visit assignee) and today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shared `SectionRail` (engine adopts it, identical output)

**Files:**
- Create: `src/components/section-rail/section-rail.tsx`
- Modify: `src/app/(app)/assessments/[id]/scope-rail.tsx`, `src/app/(app)/assessments/[id]/editor.tsx`
- Modify: `scripts/test-va-notes.ts`

**Interfaces:**
- Produces:
  - `type RailBadge = { tone: "prompt" | "photo"; n: number; title: string; text: string }`
  - `type RailItem = { key: string; label: string; done: number; total: number; badges?: RailBadge[]; muted?: boolean }`
  - `railSheetLabel(item: RailItem, showEmpty?: boolean): string`
  - `SECTION_RAIL_CSS: string`
  - `SectionRail(props: { items: RailItem[]; active: string; onPick: (key: string) => void; ariaLabel: string; sheetLabel: string; footer?: ReactNode; top?: number; showEmpty?: boolean })`

- [ ] **Step 1: Failing checks**

Add import to `scripts/test-va-notes.ts`:

```ts
import { railSheetLabel, SECTION_RAIL_CSS } from "../src/components/section-rail/section-rail";
```

Append to `vaNotesChecks`:

```ts
  /* ---- Task 5: shared rail ---- */
  ok(railSheetLabel({ key: "S1", label: "Core", done: 3, total: 7, badges: [
      { tone: "prompt", n: 2, title: "", text: "2 to review" }, { tone: "photo", n: 1, title: "", text: "1 photo" }, { tone: "photo", n: 0, title: "", text: "0 photos" }] }, true) === "Core — 3/7 · 2 to review · 1 photo",
    "#344 A8: the phone select label matches the engine's old format (zero badges skipped)");
  ok(railSheetLabel({ key: "recap", label: "Customer recap", done: 0, total: 0 }) === "Customer recap" &&
     railSheetLabel({ key: "x", label: "X", done: 0, total: 0 }, true) === "X — 0/0", "#344 A8: no count for a section without fields unless showEmpty");
  ok(SECTION_RAIL_CSS.includes("@media (max-width: 759px)") && SECTION_RAIL_CSS.includes(".sr-rail-sheet"), "#344 A8: the rail carries its own phone breakpoint");
  const engRail = readFileSync(join(process.cwd(), "src/app/(app)/assessments/[id]/scope-rail.tsx"), "utf8");
  const engEditor = readFileSync(join(process.cwd(), "src/app/(app)/assessments/[id]/editor.tsx"), "utf8");
  ok(engRail.includes('from "@/components/section-rail/section-rail"') && !/function Ring\(/.test(engRail) && engRail.includes("showEmpty"),
    "#344 A8: the engine's scope rail renders the shared SectionRail");
  ok(!/\.as-rail[\s{-]/.test(engEditor) && engEditor.includes("${SECTION_RAIL_CSS}"), "#344 A8: the engine's CSS takes the rail rules from the shared component");
```

Run → FAIL (module not found).

- [ ] **Step 2: Create `src/components/section-rail/section-rail.tsx`**

```tsx
"use client";

/* The section rail shared by the Assessments engine editor (one row per scope) and the Venue Assessments editor
   (one row per section) — #344, extracted from assessments/[id]/scope-rail.tsx. A row is a progress ring, a label,
   done/total and badges. Below 760 px wide the rail hides and a sticky <select> takes its place. Include
   SECTION_RAIL_CSS once in the page's <style>. */
import type { ReactNode } from "react";

export type RailBadge = { tone: "prompt" | "photo"; n: number; title: string; text: string };
export type RailItem = { key: string; label: string; done: number; total: number; badges?: RailBadge[]; muted?: boolean };

export const SECTION_RAIL_CSS = `
  .sr-rail { padding: 6px; position: sticky; top: 12px; }
  .sr-rail-sheet { display: none; }
  .sr-rail-row { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; background: none; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; color: #3a3f4a; }
  .sr-rail-row:hover { background: #f6f7f9; }
  .sr-rail-row.on { background: #f1f2f5; font-weight: 600; }
  .sr-rail-row.muted { opacity: .55; }
  .sr-rail-title { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sr-mono-sm { font-family: var(--font-mono); font-size: 11px; color: #8c919c; font-weight: 400; }
  @media (max-width: 759px) {
    .sr-rail { display: none; }
    .sr-rail-sheet { display: block; position: sticky; top: 0; z-index: 15; background: var(--bg, #f7f8fa); padding: 6px 0 10px; }
  }
`;

export function Ring({ done, total }: { done: number; total: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="#e8eaef" strokeWidth="3" />
      <circle
        cx="12" cy="12" r={r} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function Badge({ n, title, tone }: { n: number; title: string; tone: "prompt" | "photo" }) {
  if (!n) return null;
  const s = tone === "prompt" ? { color: "#9a5b12", background: "#fdf3e3", border: "1px solid #f1dcb6" } : { color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec" };
  return (
    <span title={title} style={{ ...s, fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {tone === "prompt" ? "!" : (
        <svg width="10" height="9" viewBox="0 0 10 9" aria-hidden="true" style={{ verticalAlign: "-1px" }}>
          <path d="M1 2.5h2l1-1.5h2l1 1.5h2v5.5H1z" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="5" cy="5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      )} {n}
    </span>
  );
}

/** The phone select's option text: "Title — 3/7 · 2 to review · 1 photo". */
export function railSheetLabel(item: RailItem, showEmpty = false): string {
  const count = item.total > 0 || showEmpty ? ` — ${item.done}/${item.total}` : "";
  const badges = (item.badges || []).filter((b) => b.n > 0).map((b) => ` · ${b.text}`).join("");
  return `${item.label}${count}${badges}`;
}

export function SectionRail({
  items, active, onPick, ariaLabel, sheetLabel, footer, top, showEmpty = false,
}: {
  items: RailItem[];
  active: string;
  onPick: (key: string) => void;
  ariaLabel: string;
  sheetLabel: string;
  footer?: ReactNode;
  /** sticky offset (px) under a sticky page header */
  top?: number;
  /** show the ring and 0/0 for items without fields (the engine's scopes) */
  showEmpty?: boolean;
}) {
  const stick = top != null ? { top } : undefined;
  return (
    <>
      <div className="sr-rail-sheet" style={stick}>
        <select className="pk-input" aria-label={sheetLabel} value={active} onChange={(e) => onPick(e.target.value)}>
          {items.map((it) => <option key={it.key} value={it.key}>{railSheetLabel(it, showEmpty)}</option>)}
        </select>
      </div>
      <nav className="sr-rail pk-card" aria-label={ariaLabel} style={stick}>
        {items.map((it) => {
          const counted = it.total > 0 || showEmpty;
          return (
            <button key={it.key} type="button" className={`sr-rail-row${it.key === active ? " on" : ""}${it.muted ? " muted" : ""}`} aria-current={it.key === active} onClick={() => onPick(it.key)}>
              {counted ? <Ring done={it.done} total={it.total} /> : <span style={{ width: 24, flexShrink: 0 }} aria-hidden="true" />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="sr-rail-title">{it.label}</span>
                {counted && <span className="sr-mono-sm">{it.done}/{it.total}</span>}
              </span>
              {(it.badges || []).map((b, i) => <Badge key={i} n={b.n} tone={b.tone} title={b.title} />)}
            </button>
          );
        })}
        {footer}
      </nav>
    </>
  );
}
```

- [ ] **Step 3: Engine scope rail renders it**

Replace `src/app/(app)/assessments/[id]/scope-rail.tsx` with:

```tsx
"use client";

/* The assessment editor's scope rail (#340, Task 7): one row per scope that is on, with a progress ring and badges for
   open prompts and missing photos. The rail itself is the shared SectionRail (#344); this file adds the "Scopes…"
   panel that turns scopes on or off mid-visit (switching one off hides it and keeps its answers). */
import { useState } from "react";
import type { AssessmentDef, ScopeCode } from "@/lib/assessments/defs/types";
import type { ScopeSel } from "@/lib/assessments/evaluate";
import type { ScopeSummary } from "@/lib/assessments/editor-model";
import { SectionRail, type RailItem } from "@/components/section-rail/section-rail";

export default function ScopeRail({
  def, summaries, active, onPick, scopes, onToggle, disabled, offWithAnswers,
}: {
  def: AssessmentDef;
  summaries: ScopeSummary[];
  active: ScopeCode;
  onPick: (c: ScopeCode) => void;
  scopes: ScopeSel[];
  onToggle: (c: ScopeCode, on: boolean) => void;
  disabled: boolean;
  offWithAnswers: ScopeCode[];
}) {
  const [editing, setEditing] = useState(false);
  const items: RailItem[] = summaries.map((s) => ({
    key: s.code,
    label: s.title,
    done: s.done,
    total: s.total,
    badges: [
      { tone: "prompt", n: s.prompts, title: `${s.prompts} suggested finding${s.prompts === 1 ? "" : "s"} to review`, text: `${s.prompts} to review` },
      { tone: "photo", n: s.missingPhotos, title: `${s.missingPhotos} required photo${s.missingPhotos === 1 ? "" : "s"} missing`, text: `${s.missingPhotos} photo${s.missingPhotos === 1 ? "" : "s"}` },
    ],
  }));
  const footer = (
    <>
      {!disabled && (
        <div style={{ padding: "8px 10px 4px" }}>
          <button type="button" className="pk-btn-outline" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Scopes…"}</button>
        </div>
      )}
      {editing && (
        <div className="as-scope-edit">
          {def.scopes.map((s) => {
            const sel = scopes.find((x) => x.code === s.code);
            const on = s.code === "S0" || !!sel?.on;
            return (
              <label key={s.code} className="as-scope-opt">
                <input type="checkbox" checked={on} disabled={s.code === "S0"} onChange={(e) => onToggle(s.code, e.target.checked)} />
                <span>{s.title}{s.depths?.length ? <span className="as-mono-sm"> ({sel?.depth ?? s.depths[0]})</span> : null}</span>
                {!on && offWithAnswers.includes(s.code) && <span className="as-mono-sm" title="Answers are kept while the scope is off"> · answers kept</span>}
              </label>
            );
          })}
        </div>
      )}
    </>
  );
  return (
    <SectionRail
      items={items}
      active={active}
      onPick={(k) => onPick(k as ScopeCode)}
      ariaLabel="Scopes"
      sheetLabel="Scope"
      footer={footer}
      showEmpty
    />
  );
}
```

- [ ] **Step 4: Engine CSS**

In `src/app/(app)/assessments/[id]/editor.tsx`:
1. Add `import { SECTION_RAIL_CSS } from "@/components/section-rail/section-rail";`.
2. In the `CSS` template string, delete the six `.as-rail…` rules (`.as-rail {`, `.as-rail-sheet {`, `.as-rail-row {`, `.as-rail-row:hover`, `.as-rail-row.on`, `.as-rail-title`) and, inside `@media (max-width: 759px)`, the two lines `.as-rail { display: none; }` and `.as-rail-sheet { … }`. Keep `.as-scope-edit`, `.as-scope-opt`, `.as-mono-sm`.
3. Add a line `${SECTION_RAIL_CSS}` as the first line inside the `CSS` template string.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit && npx tsx scripts/test-va-notes.ts | tail -1
npm run test:specs 2>&1 | grep -E "FAIL" | head
```
Expected: no new FAIL lines (test-assessments may pin rail behaviour — if one fails, fix the component to match the pinned behaviour, not the test).

```bash
git add src/components/section-rail "src/app/(app)/assessments/[id]/scope-rail.tsx" "src/app/(app)/assessments/[id]/editor.tsx" scripts/test-va-notes.ts
git commit -m "refactor(assessments): #344 extract the scope rail into a shared SectionRail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Editor flow — order, Kill questions, quote gating, Sign-off and guidance removed

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/kill-questions.tsx`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`, `sections/types.ts`, `sections/systems.tsx`, `page.tsx`, `actions.ts`
- Delete: `src/app/(app)/venue-assessments/[id]/sections/signoff.tsx`
- Modify: `scripts/test-va-notes.ts`

**Interfaces:**
- Consumes: Task 1 (`SECTION_ORDER`, `STEP_LABELS`, `STEP_BY_ID`, `GROUP_BY_ID`, `GROUP_META`, `isQuoteVisit`, `sectionVisible`, `SCOPE_KEYS`, `SCOPE_LABEL`, `RIG_SYSTEMS`, `inScope`), Task 2 (`LegacyNote`, `tier1Items`), Task 3 (`SurveyTag`).
- Produces:
  - `Draft` gains `scope: string[]; internalTags: string[]; legacyNotes: LegacyNote[]`
  - `EditorMeta` loses `venueDoctrine`; gains `internalTags: SurveyTag[]` (`conditions` is removed in Task 8)
  - `SectionDef.group: FlowGroup`; kind `"signoff"` removed
  - `KillQuestions` component (props below)
  - `SystemsSection` loses `doctrine`; gains `presentFromKill?: boolean; onJumpKill?: () => void`
  - `SurveyPatch` includes `scope`, `internalTags`

- [ ] **Step 1: Failing source pins**

Append to `vaNotesChecks`:

```ts
  /* ---- Task 6: editor flow (source pins) ---- */
  const vaDir = "src/app/(app)/venue-assessments/[id]";
  const ctl = readFileSync(join(process.cwd(), `${vaDir}/controls.tsx`), "utf8");
  const sys = readFileSync(join(process.cwd(), `${vaDir}/sections/systems.tsx`), "utf8");
  const kq = readFileSync(join(process.cwd(), `${vaDir}/sections/kill-questions.tsx`), "utf8");
  const vaPage = readFileSync(join(process.cwd(), `${vaDir}/page.tsx`), "utf8");
  const vaActsId = readFileSync(join(process.cwd(), `${vaDir}/actions.ts`), "utf8");
  ok(ctl.includes('from "@/lib/survey-flow"') && !/const ORDER = \[/.test(ctl) && !/const STEP_BY_ID/.test(ctl), "#344 A1: the editor takes order, steps and groups from survey-flow");
  ok(!ctl.includes("SignoffSection") && !ctl.includes('kind: "signoff"'), "#344 A6: the Sign-off section is gone from the editor");
  ok(/isQuoteVisit\(draft\)/.test(ctl), "#344 A3: the quote half of Existing materials & quote is gated on isQuoteVisit");
  ok(/sectionVisible\(draft, s\.id\)/.test(ctl), "#344 R2: the section list is filtered by sectionVisible");
  ok(!sys.includes("Venue-class guidance") && !sys.includes("doctrine"), "#344 A9: the Venue-class guidance panel is removed from the intake");
  ok(sys.includes("presentFromKill") && sys.includes("from Kill questions"), "#344 R3: the Rigging intake shows the rig system read-only");
  ok(kq.includes("SCOPE_KEYS") && kq.includes("RIG_SYSTEMS") && kq.includes("TIER1_WIDTH_BY_CLASS"), "#344 A2: Kill questions carries Scope, Rigging system and stage W/D inputs");
  ok(!vaPage.includes("resolveVenueDoctrine") && vaPage.includes("resolveSurveyTags"), "#344: the editor page drops doctrine and passes internal tags");
  ok(/\| "scope"/.test(vaActsId) && /\| "internalTags"/.test(vaActsId), "#344: SurveyPatch carries scope and internalTags");
  ok(/legacyNotes: _legacy/.test(ctl), "#344 R1: the outbox doc strips legacyNotes (derived, never stored)");
```

Run → FAIL (kill-questions.tsx missing).

- [ ] **Step 2: `sections/types.ts`**

1. Imports: add `import type { LegacyNote } from "@/lib/survey-migrate";`, `import type { SurveyTag } from "@/lib/survey-tags";`, `import type { FlowGroup } from "@/lib/survey-flow";`. Remove the `VenueDoctrine` import.
2. `EditorMeta`: delete `venueDoctrine: VenueDoctrine;`; add `/** #344 — Final thoughts tags (settings, starter list when absent) */ internalTags: SurveyTag[];`.
3. `Draft`: after `signoff: {…};` add:

```ts
  /** #344 — scope kill question (DisciplineKey[]; empty = unanswered) */
  scope: string[];
  /** #344 — Final thoughts internal tag ids */
  internalTags: string[];
  /** #344 — derived by the read-time migration; shown under "Older notes"; never saved */
  legacyNotes: LegacyNote[];
```

4. `SectionDef`: `group: FlowGroup;` and remove `| { kind: "signoff" }`.

- [ ] **Step 3: Create `sections/kill-questions.tsx`**

```tsx
"use client";

/* Kill questions (#344, notes 13/14) — the gate before the discipline intakes. Venue, contact name and email are
   answered in Customer & venue (their chips jump there); Scope, the Rigging system and stage width/depth are answered
   right here. Stage width/depth write the same measurement keys the Measurements card edits, so it stays one value. */
import type { CSSProperties, ReactNode } from "react";
import { TIER1_DEPTH_BY_CLASS, TIER1_WIDTH_BY_CLASS, classMeasureFields } from "@/lib/stores/venue-classes";
import type { DisciplineKey, Tier1Item } from "@/lib/stores/survey-intake";
import { RIG_SYSTEMS, SCOPE_KEYS, SCOPE_LABEL } from "@/lib/survey-flow";
import { labelStyle, measStyle } from "./styles";
import type { Draft } from "./types";

export function KillQuestions({
  draft, items, onJump, onScope, onRigSystems, mv, setMeasure, chipStyle, footer,
}: {
  draft: Draft;
  items: Tier1Item[];
  onJump: (sectionId: string) => void;
  onScope: (next: string[]) => void;
  onRigSystems: (next: string[]) => void;
  mv: (k: string) => string | boolean;
  setMeasure: (key: string, val: string) => void;
  chipStyle: (active: boolean) => CSSProperties;
  footer: ReactNode;
}) {
  const scope = draft.scope.filter((k): k is DisciplineKey => (SCOPE_KEYS as readonly string[]).includes(k));
  const rigRaw = draft.disciplines.rigging?.present;
  const rig = Array.isArray(rigRaw) ? rigRaw : [];
  const widthKey = TIER1_WIDTH_BY_CLASS[draft.venueClass];
  const depthKey = TIER1_DEPTH_BY_CLASS[draft.venueClass];
  const quick = classMeasureFields(draft.venueClass);
  const labelOf = (key: string, fallback: string) => quick.find((f) => f.key === key)?.label || fallback;

  const toggleScope = (k: DisciplineKey) =>
    onScope(scope.includes(k) ? scope.filter((x) => x !== k) : SCOPE_KEYS.filter((x) => x === k || scope.includes(x)));
  const toggleRig = (opt: string) => {
    if (rig.includes(opt)) return onRigSystems(rig.filter((x) => x !== opt));
    onRigSystems(opt === "None" ? ["None"] : [...rig.filter((x) => x !== "None"), opt]);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => (item.section === "tier1" ? undefined : onJump(item.section))}
            title={item.done ? "Answered" : item.section === "tier1" ? "Answer it below" : "Missing — tap to jump to the field"}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
              padding: "9px 13px", borderRadius: 20, cursor: item.section === "tier1" ? "default" : "pointer", minHeight: 40,
              border: `1px solid ${item.done ? "#cce9da" : "#f0e2bd"}`,
              background: item.done ? "#eaf6ef" : "#fbf3dd",
              color: item.done ? "#1f7a52" : "#8a6d1f",
            }}
          >
            <span style={{ fontSize: 12 }}>{item.done ? "✓" : "○"}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Scope — what does this visit cover?</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SCOPE_KEYS.map((k) => (
            <button type="button" key={k} aria-pressed={scope.includes(k)} onClick={() => toggleScope(k)} style={chipStyle(scope.includes(k))}>
              {SCOPE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {(scope.length === 0 || scope.includes("rigging")) && (
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Rigging system</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {RIG_SYSTEMS.map((opt) => (
              <button type="button" key={opt} aria-pressed={rig.includes(opt)} onClick={() => toggleRig(opt)} style={chipStyle(rig.includes(opt))}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sv-grid" style={{ marginTop: 14 }}>
        {[
          { key: widthKey, fallback: "Stage width" },
          { key: depthKey, fallback: "Stage depth" },
        ].map(({ key, fallback }) => (
          <div key={key}>
            <label style={labelStyle}>{labelOf(key, fallback)}</label>
            <input
              value={String(mv(key) ?? "")}
              onChange={(e) => setMeasure(key, e.target.value)}
              placeholder="ft-in or decimal"
              inputMode="decimal"
              style={measStyle}
            />
          </div>
        ))}
      </div>

      {footer}
    </div>
  );
}
```

- [ ] **Step 4: `sections/systems.tsx`**

1. Remove the `VenueDoctrineEntry` import, the `doctrine` prop from `Props`, the `guidance` const, and the whole `{(group.key === "curtain" || group.key === "lighting") && (…Venue-class guidance…)}` block.
2. Add to `Props`:

```ts
  /** #344 R3 — Rigging's Present is the Kill-questions rigging system: shown read-only here */
  presentFromKill?: boolean;
  onJumpKill?: () => void;
```

3. Replace the `<label style={labelStyle}>Present</label>` + chips block with:

```tsx
      {props.presentFromKill ? (
        <div>
          <label style={labelStyle}>Rigging system</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13.5, color: "#3a3f4a" }}>
            <span>{present.length ? present.join(" · ") : "Not answered yet"}</span>
            <span style={{ fontSize: 12, color: "#9aa0ab" }}>from Kill questions</span>
            {props.onJumpKill && (
              <button type="button" onClick={props.onJumpKill} style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: "none", border: 0, padding: 0, textDecoration: "underline", cursor: "pointer" }}>
                Change
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <label style={labelStyle}>Present</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {options.map((option) => (
              <button type="button" key={option} onClick={() => togglePresent(option)} style={chipStyle(present.includes(option))}>
                {option}
              </button>
            ))}
          </div>
        </>
      )}
```

Keep the Client goals box first (an existing harness pin checks `>Client goals</label>` comes before `>Present</label>`).

- [ ] **Step 5: `page.tsx` and `actions.ts`**

1. `page.tsx`: remove `import { resolveVenueDoctrine } …` and the `venueDoctrine:` meta line; add `import { resolveSurveyTags } from "@/lib/survey-tags";` and meta line `internalTags: resolveSurveyTags(settings.surveyInternalTags),`.
2. `[id]/actions.ts` `SurveyPatch` Pick list: add `| "scope"` and `| "internalTags"` after `| "visitId"`.

- [ ] **Step 6: `controls.tsx`**

1. Imports: remove `SignoffSection`; add

```ts
import {
  SECTION_ORDER, STEP_LABELS, STEP_BY_ID, GROUP_BY_ID, GROUP_META, isQuoteVisit, sectionVisible,
} from "@/lib/survey-flow";
import { KillQuestions } from "./sections/kill-questions";
```

2. Delete the constants `STEP_LABELS`, `STEP_BY_ID`, `BRIEF_IDS`, `INTAKE_IDS`, `ORDER` (lines 59–69). Keep `DISC_SECTION_ID`.
3. `toDraft`: after `signoff: { ...r.signoff },` add

```ts
    scope: Array.isArray(r.scope) ? [...r.scope] : [],
    internalTags: Array.isArray(r.internalTags) ? [...r.internalTags] : [],
    legacyNotes: Array.isArray(r.legacyNotes) ? [...r.legacyNotes] : [],
```

4. In the `sections` useMemo:
   - `project` section: replace its `subtitle` and `fields` with

```ts
      subtitle: isQuoteVisit(draft)
        ? "What we have on file, and what the quote needs. Ask these last, once the customer is comfortable."
        : "What we have on file. The quote questions show when the purpose is New system design.",
      group: "wrapup", step: 5, kind: "fields",
      fields: [
        { kind: "checkTop", key: "hasBOM", label: "Existing BOM on file" },
        { kind: "checkTop", key: "hasDrawings", label: "Existing drawings on file" },
        { kind: "checkTop", key: "hasPhotos", label: "Existing photos on file" },
        // #344 A3: the quote / budget half only on a quote visit (answers stay stored either way)
        ...(isQuoteVisit(draft)
          ? ([
              { kind: "text", key: "quoteNeededBy", label: "Quote needed by", type: "date" },
              { kind: "toggle", key: "budgetary", label: "Is it budgetary?" },
              { kind: "text", key: "projectCompletion", label: "Project completion", type: "date" },
              { kind: "select", key: "installTimeframe", label: "Install timeframe", options: meta.installTimeframes },
              { kind: "text", key: "budget", label: "Budget" },
              { kind: "text", key: "fiscalYearSpendBy", label: "Fiscal year / spend-by date" },
              { kind: "text", key: "whoDecides", label: "Who decides" },
              { kind: "text", key: "targetInstallWindow", label: "Target install window" },
            ] as FieldDef[])
          : []),
      ],
```

   - `tier1` section: subtitle `"Scope, rigging system and the basics — the discipline intakes unlock once these are in"`.
   - Delete `secs.push({ id: "signoff", … })`.
   - Replace the trailing `secs.forEach((s) => { … })` + `secs.sort(…)` + `return secs;` with:

```ts
    secs.forEach((s) => {
      if (GROUP_BY_ID[s.id]) s.group = GROUP_BY_ID[s.id];
      if (STEP_BY_ID[s.id] != null) s.step = STEP_BY_ID[s.id];
    });
    return secs
      .filter((s) => sectionVisible(draft, s.id))
      .sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id));
```

   - Change every other `group: "brief" | "field" | "intake"` literal inside the builder as needed so it type-checks (the forEach overrides them; leaving the literals is fine because `FlowGroup` includes them).
   - Deps: `[draft.assessmentEnabled, draft.venueClass, draft.requestedBy, draft.visitPurpose, draft.scope, draft.disciplines, draft.linesets, meta, roster]`. If eslint's exhaustive-deps flags `draft`, use the whole `draft` object instead.

5. Group header: replace the two nested ternaries in the group header with `{GROUP_META[sec.group].label}` and `{GROUP_META[sec.group].blurb}`.
6. Stepper label: `STEP_LABELS[si]` now comes from survey-flow (no code change beyond the import).
7. Kill questions body: replace the whole `{sec.kind === "tier1" && ( <div> … </div> )}` block with:

```tsx
                      {sec.kind === "tier1" && (
                        <KillQuestions
                          draft={draft}
                          items={tier1}
                          onJump={jumpTo}
                          onScope={(next) => setField("scope", next)}
                          onRigSystems={(next) => setDisc("rigging", "present", next)}
                          mv={mv}
                          setMeasure={setMeasure}
                          chipStyle={chipStyle}
                          footer={
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                              {/* the intake status chip, the unlock sentence and Mark ready / ✓ Ready — undo:
                                  move the three existing elements from the old tier1 block here unchanged */}
                            </div>
                          }
                        />
                      )}
```

   Move the old block's status `<span>`, explanatory `<span>`, spacer `<div>` and the two `intakeSt` buttons into that footer `<div>` verbatim (replacing the comment).

8. Discipline section: in the `<SystemsSection …/>` call delete `doctrine={…}` and add

```tsx
                            presentFromKill={g.key === "rigging"}
                            onJumpKill={() => jumpTo("tier1")}
```

9. Delete the `{sec.kind === "signoff" && (…)}` block.
10. `buildPatch`: after `signoff: draft.signoff,` add `scope: draft.scope,` and `internalTags: draft.internalTags,`.
11. `buildFullDoc`: replace its body with

```ts
    // legacyNotes is derived on every read (src/lib/survey-migrate.ts) — never write it back
    const { legacyNotes: _legacy, ...rec } = record as unknown as Record<string, unknown>;
    void _legacy;
    return {
      ...rec,
      ...(buildPatch(over) as Record<string, unknown>),
      updatedAt: Date.now(),
      rev: (record.rev || 1) + 1,
      syncState: "synced",
    };
```

12. Keep `{meetingsSlot}` immediately followed by `{visibleSections.map(` (a harness pin in `scripts/test-meetings-323.ts` checks it).

- [ ] **Step 7: Delete the sign-off component**

```bash
git rm "src/app/(app)/venue-assessments/[id]/sections/signoff.tsx"
grep -rn "sections/signoff" src || echo "no references"
```

- [ ] **Step 8: Verify + commit**

```bash
npx tsc --noEmit && npx tsx scripts/test-va-notes.ts | tail -1
npx eslint "src/app/(app)/venue-assessments/[id]"
```
Expected: tsc clean; all PASS; no new eslint errors vs the baseline.

```bash
git add -A "src/app/(app)/venue-assessments/[id]" scripts/test-va-notes.ts
git commit -m "feat(venue-assessments): #344 new section order, Kill questions with scope + rigging system, quote half for design visits, Sign-off removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Collapsible sections, per-viewer memory, the rail (Accordion retired)

**Files:**
- Create: `src/app/(app)/venue-assessments/[id]/sections/progress.ts`
- Create: `src/app/(app)/venue-assessments/[id]/sections/collapse.ts`
- Modify: `src/app/(app)/venue-assessments/[id]/controls.tsx`
- Modify: `scripts/test-va-notes.ts`

**Interfaces:**
- Consumes: Task 5 `SectionRail`, `SECTION_RAIL_CSS`, `RailItem`; Task 2 `tier1Items`.
- Produces:
  - `sectionProgress(sec: SectionDef, d: Draft, ctx: { tier1Done: boolean }): { done: number; total: number; gate: boolean }`
  - `collapseStorageKey(surveyId: string): string`, `parseCollapsed(raw: string | null): Record<string, boolean>`, `isCollapsed(map, sec: { id: string; advanced?: boolean }): boolean`, `useCollapsed(surveyId): [Record<string, boolean>, (id: string, collapsed: boolean) => void]`

- [ ] **Step 1: Failing checks**

Add imports to `scripts/test-va-notes.ts`:

```ts
import { sectionProgress } from "../src/app/(app)/venue-assessments/[id]/sections/progress";
import { parseCollapsed, isCollapsed, collapseStorageKey } from "../src/app/(app)/venue-assessments/[id]/sections/collapse";
```

Append to `vaNotesChecks`:

```ts
  /* ---- Task 7: progress + collapse ---- */
  const d0 = {
    customer: "Acme", venue: "Hall", address: "", contact: "Pat", contactEmail: "", contactPhone: "", venueClass: "theatre",
    measurements: { proW: "40" } as Record<string, string | boolean>, disciplines: {} as Record<string, Record<string, unknown>>,
    lifeSafety: { deluge: "Yes", smokeVent: "", adaNotes: "", egressNotes: "" }, linesets: [] as unknown[], scope: [] as string[],
    travelTime: "35 min", distance: "", reason: "", visitPurpose: "Bid walk",
  } as never;
  const fieldsSec = { id: "visit", title: "", subtitle: "", group: "brief", step: 0, kind: "fields", fields: [
    { kind: "select", key: "visitPurpose", label: "", options: [] }, { kind: "text", key: "travelTime", label: "" },
    { kind: "text", key: "distance", label: "" }, { kind: "textarea", key: "reason", label: "" }, { kind: "toggle", key: "budgetary", label: "" },
  ] } as never;
  const p1 = sectionProgress(fieldsSec, d0, { tier1Done: true });
  ok(p1.done === 2 && p1.total === 4 && !p1.gate, "#344 A8: fields progress counts answered text/select/textarea and skips yes/no toggles");
  const measSec = { id: "mLayout", kind: "fields", fields: [{ kind: "measure", key: "proW", label: "" }, { kind: "measure", key: "proH", label: "" }] } as never;
  ok(sectionProgress(measSec, d0, { tier1Done: true }).done === 1, "#344 A8: measure fields read measurements");
  const subSec = { id: "lifeSafety", kind: "fields", fields: [{ kind: "sub", obj: "lifeSafety", key: "deluge", label: "" }, { kind: "sub", obj: "lifeSafety", key: "smokeVent", label: "" }] } as never;
  ok(sectionProgress(subSec, d0, { tier1Done: true }).done === 1, "#344 A8: sub fields read the sub-object");
  const t1 = sectionProgress({ id: "tier1", kind: "tier1" } as never, d0, { tier1Done: false });
  ok(t1.total === 6 && t1.gate, "#344 A8: Kill questions counts its items and flags the gate while incomplete");
  ok(sectionProgress({ id: "recap", kind: "recap" } as never, d0, { tier1Done: true }).total === 0, "#344 A8: read-only sections have no ring");

  ok(collapseStorageKey("FS-1100") === "va:collapsed:FS-1100", "#344 A8: collapsed state is remembered per survey");
  ok(JSON.stringify(parseCollapsed('{"a":true,"b":"x","c":false}')) === '{"a":true,"c":false}' && JSON.stringify(parseCollapsed("not json")) === "{}" && JSON.stringify(parseCollapsed("[1]")) === "{}",
    "#344 A8: stored state parses defensively");
  ok(isCollapsed({}, { id: "m", advanced: true }) && !isCollapsed({}, { id: "v" }) && !isCollapsed({ m: false }, { id: "m", advanced: true }),
    "#344 A8: default collapsed = advanced; a stored choice wins");

  const ctl7 = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/[id]/controls.tsx"), "utf8");
  ok(!ctl7.includes('"accordion"') && ctl7.includes("<SectionRail") && ctl7.includes("SECTION_RAIL_CSS"), "#344 A8: Accordion mode is gone; long scroll has the shared rail");
```

Run → FAIL.

- [ ] **Step 2: `sections/progress.ts`**

```ts
/* Section progress for the Venue Assessments rail (#344 A8) — pure. Counts the visible, answerable fields of a
   section: text / select / textarea / measure / sub. Yes/no toggles and checks are left out (unticked is a valid
   answer). Read-only sections (recap, 3D, photos, final thoughts…) have total 0 and no ring. */
import { DISCIPLINE_GROUPS, tier1Items, visibleFields } from "@/lib/stores/survey-intake";
import type { Draft, FieldDef, SectionDef } from "./types";

export type SectionProgress = { done: number; total: number; gate: boolean };

const filled = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v ?? "").trim() !== "";

const COUNTED = new Set<FieldDef["kind"]>(["text", "select", "measure", "textarea", "sub"]);

function fieldValue(f: FieldDef, d: Draft): unknown {
  const rec = d as unknown as Record<string, unknown>;
  switch (f.kind) {
    case "measure":
    case "checkMeasure":
      return d.measurements[f.key];
    case "select":
      return f.measure ? d.measurements[f.key] : rec[f.key];
    case "sub":
      return (rec[f.obj] as Record<string, unknown> | undefined)?.[f.key];
    default:
      return rec[f.key];
  }
}

export function sectionProgress(sec: SectionDef, d: Draft, ctx: { tier1Done: boolean }): SectionProgress {
  switch (sec.kind) {
    case "fields": {
      const fs = sec.fields.filter((f) => COUNTED.has(f.kind));
      return { done: fs.filter((f) => filled(fieldValue(f, d))).length, total: fs.length, gate: false };
    }
    case "custvenue": {
      const vals = [d.customer, d.venue, d.address, d.contact, d.contactEmail, d.contactPhone];
      return { done: vals.filter(filled).length, total: vals.length, gate: false };
    }
    case "tier1": {
      const items = tier1Items(d);
      return { done: items.filter((i) => i.done).length, total: items.length, gate: !ctx.tier1Done };
    }
    case "discipline": {
      const g = DISCIPLINE_GROUPS.find((x) => x.key === sec.disc);
      const data = d.disciplines[sec.disc] || {};
      const fields = g ? visibleFields(g, d.venueClass).filter((f) => f.type !== "check") : [];
      const vals = [data.goals, data.present, data.scope, ...fields.map((f) => data[f.key])];
      return { done: vals.filter(filled).length, total: vals.length, gate: false };
    }
    case "linesets":
      return { done: d.linesets.length ? 1 : 0, total: 1, gate: false };
    default:
      return { done: 0, total: 0, gate: false };
  }
}
```

> If `tier1Items(d)` doesn't type-check because `Draft.disciplines` is `Record<string, DisciplineData>` vs `Tier1Slice`, it should — both are the same type. If `Draft.measurements` mismatches, pass `{ ...d, measurements: d.measurements }`.

- [ ] **Step 3: `sections/collapse.ts`**

```ts
"use client";

/* Per-viewer, per-survey collapsed sections (#344 A8). localStorage read through useSyncExternalStore so SSR and
   hydration agree (the plan-legend idiom). The snapshot is the raw string, so it stays referentially stable. */
import { useCallback, useMemo, useSyncExternalStore } from "react";

const EVT = "va-collapsed";

export const collapseStorageKey = (surveyId: string): string => `va:collapsed:${surveyId}`;

export function parseCollapsed(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** A stored choice wins; otherwise "advanced" sections start collapsed (today's default). */
export function isCollapsed(map: Record<string, boolean>, sec: { id: string; advanced?: boolean }): boolean {
  return map[sec.id] ?? !!sec.advanced;
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}

export function useCollapsed(surveyId: string): [Record<string, boolean>, (id: string, collapsed: boolean) => void] {
  const key = collapseStorageKey(surveyId);
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => ""
  );
  const map = useMemo(() => parseCollapsed(raw), [raw]);
  const set = useCallback(
    (id: string, collapsed: boolean) => {
      const next = { ...parseCollapsed((() => { try { return window.localStorage.getItem(key); } catch { return null; } })()), [id]: collapsed };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode — the event still re-renders this view */
      }
      window.dispatchEvent(new Event(EVT));
    },
    [key]
  );
  return [map, set];
}
```

> Private-mode caveat: if `setItem` throws, the event fires but the snapshot reads the old value, so the toggle won't stick. Acceptable (same as plan-legend); the section still opens via the rail.

- [ ] **Step 4: `controls.tsx` — collapse, rail, Accordion removal**

1. Imports: `import { SectionRail, SECTION_RAIL_CSS, type RailItem } from "@/components/section-rail/section-rail";`, `import { sectionProgress } from "./sections/progress";`, `import { useCollapsed, isCollapsed } from "./sections/collapse";`.
2. `type LayoutMode = "long" | "wizard";`. Delete the "Sections" (accordion) button.
3. Delete `const [openSet, setOpenSet] = …`. Add:

```ts
  const [collapsedMap, setCollapsedFor] = useCollapsed(record.id);
  const [activeSec, setActiveSec] = useState("cust");
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headH, setHeadH] = useState(128);
  useEffect(() => {
    const el = headRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeadH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
```

   Put `ref={headRef}` on the sticky header `<div style={{ position: "sticky", top: 0, zIndex: 24, … }}>`.
4. Replace `isCollapsible` / `isOpen` / `toggleSection` with:

```ts
  const isOpen = (sec: SectionDef) => !isCollapsed(collapsedMap, sec);
  const toggleSection = (sec: SectionDef) => setCollapsedFor(sec.id, isOpen(sec));
```

5. `jumpTo(id)`: before scrolling, expand the section — find it in `sections` and if collapsed call `setCollapsedFor(id, false)`; set `setActiveSec(id)`; scroll offset `headH + 12` instead of `128`. Use `requestAnimationFrame` around the scroll so the expanded section has laid out:

```ts
  function jumpTo(id: string) {
    const sec = sections.find((s) => s.id === id);
    if (sec && !isOpen(sec)) setCollapsedFor(id, false);
    setActiveSec(id);
    if (layoutMode === "wizard" && sec && sec.step !== step) setStep(sec.step);
    requestAnimationFrame(() => {
      try {
        const el = document.getElementById("sec-" + id);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - headH - 12, behavior: "smooth" });
      } catch {}
    });
  }
```

6. In the section map: `const collapsible = !locked;` and `const open = locked ? false : isOpen(sec);`; `headerClick` calls `toggleSection(sec)` (locked branch unchanged). Remove the `filled` / `discFilled` "N filled / N captured" chips and `measFilled` (the rail replaces them) — or keep them; if kept, they must still compile. **Remove them** to avoid two progress signals.
7. Rail items, above the return:

```ts
  const railItems: RailItem[] = sections.map((sec) => {
    const p = sectionProgress(sec, draft, { tier1Done });
    return {
      key: sec.id,
      label: sec.title,
      done: p.done,
      total: p.total,
      badges: p.gate ? [{ tone: "prompt", n: 1, title: "Answer the kill questions to unlock the discipline intakes", text: "needs answers" }] : [],
      muted: sec.kind === "discipline" && !tier1Done,
    };
  });
```

8. `<style>`: append `${SECTION_RAIL_CSS}` and

```css
        .va-layout { display:grid; grid-template-columns: 230px minmax(0,1fr); gap: 18px; align-items: start; max-width: 1160px; margin: 0 auto; }
        @media (max-width:759px){ .va-layout{ grid-template-columns: minmax(0,1fr); } }
```

9. Header row 3: delete the long-mode horizontal pill rail block (`{layoutMode === "long" && ( <div className="sv-rail" …> {sections.map(…jumpTo…)} </div> )}`). Keep the wizard stepper.
10. Body: wrap the existing body container so long mode gets the rail:

```tsx
      <div className="sv-pad" style={{ padding: "20px 24px 90px" }}>
        <div className={layoutMode === "long" ? "va-layout" : undefined} style={layoutMode === "long" ? undefined : { maxWidth: 900, margin: "0 auto" }}>
          {layoutMode === "long" && (
            <SectionRail items={railItems} active={activeSec} onPick={jumpTo} ariaLabel="Sections" sheetLabel="Jump to section" top={headH + 12} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {meetingsSlot}
              {visibleSections.map((sec) => { /* unchanged body */ })}
            </div>
            {/* saveError + wizard Back/Next blocks, unchanged, moved inside this column */}
          </div>
        </div>
      </div>
```

    The `.sr-rail-sheet` phone select must stick under the page header: `top={headH + 12}` handles both.
11. The ` ▾` chevron now shows for every non-locked section (`collapsible` is true).

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit && npx tsx scripts/test-va-notes.ts | tail -1 && npx eslint "src/app/(app)/venue-assessments/[id]"
grep -n "meetingsSlot}" "src/app/(app)/venue-assessments/[id]/controls.tsx"
```
Expected: clean; the grep shows `{meetingsSlot}` on the line right before `{visibleSections.map(`.

```bash
git add "src/app/(app)/venue-assessments/[id]" scripts/test-va-notes.ts
git commit -m "feat(venue-assessments): #344 collapsible sections remembered per viewer + progress rail; Accordion mode retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Customer recap, Final thoughts, Older notes

**Files:**
- Create: `sections/recap.tsx`, `sections/final-thoughts.tsx`, `sections/older-notes.tsx` (all under `src/app/(app)/venue-assessments/[id]/`)
- Modify: `controls.tsx`, `sections/types.ts`, `page.tsx`
- Delete: `sections/conditions.tsx`
- Modify: `scripts/test-va-notes.ts`

**Interfaces:**
- Consumes: `recapFor`, `RecapEntry`, `recapScopeText` (Task 1); `SurveyTag`, `activeSurveyTags`, `surveyTagLabel` (Task 3); `LegacyNote` (Task 2).
- Produces: `SectionDef` kinds `"recap"` and `"finalThoughts"` (kind `"conditions"` removed); `EditorMeta.conditions` removed; components `RecapSection({ draft })`, `FinalThoughtsSection({ draft, tags, onTags, chipStyle })`, `OlderNotes({ notes })`.

- [ ] **Step 1: Failing pins**

Append to `vaNotesChecks`:

```ts
  /* ---- Task 8: recap, final thoughts, older notes ---- */
  const dir8 = "src/app/(app)/venue-assessments/[id]";
  const ctl8 = readFileSync(join(process.cwd(), `${dir8}/controls.tsx`), "utf8");
  const ft = readFileSync(join(process.cwd(), `${dir8}/sections/final-thoughts.tsx`), "utf8");
  const rcp = readFileSync(join(process.cwd(), `${dir8}/sections/recap.tsx`), "utf8");
  ok(ctl8.includes('id: "recap"') && ctl8.includes('id: "finalThoughts"') && !ctl8.includes('id: "conditions"'), "#344 A5/A7: Customer recap and Final thoughts replace Site conditions");
  ok(ft.includes("activeSurveyTags") && ft.includes("Older site conditions") && ft.includes("Internal only"), "#344 A5: Final thoughts shows active tags, retired-but-carried tags and the old chips read-only");
  ok(rcp.includes("recapFor(") && rcp.includes("What we heard"), "#344 A7: the recap reads recapFor");
  ok(/<OlderNotes notes=\{draft\.legacyNotes\.filter\(\(n\) => n\.section === sec\.id\)\}/.test(ctl8), "#344 R1: every section shows its Older notes");
```

- [ ] **Step 2: `sections/older-notes.tsx`**

```tsx
/* "Older notes" (#344 R1) — answers from before a field was renamed or removed, shown read-only at the foot of their
   section. Derived on read by src/lib/survey-migrate.ts; nothing here is editable or saved. */
import type { LegacyNote } from "@/lib/survey-migrate";

export function OlderNotes({ notes }: { notes: LegacyNote[] }) {
  if (!notes.length) return null;
  return (
    <details style={{ marginTop: 14, border: "1px solid #ececf0", borderRadius: 9, padding: "8px 12px", background: "#fbfbfc" }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#8c919c" }}>Older notes ({notes.length})</summary>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {notes.map((n, i) => (
          <div key={i} style={{ fontSize: 12.5, color: "#5b616e" }}>
            <span style={{ fontWeight: 600 }}>{n.label}:</span> {n.text}
          </div>
        ))}
      </div>
    </details>
  );
}
```

- [ ] **Step 3: `sections/recap.tsx`**

```tsx
/* Customer recap (#344 A7) — the end-of-visit read-back: per discipline in scope, what the customer said they're
   interested in and their goals, in larger type so the rep can read it aloud. Read-only. */
import { recapFor } from "@/lib/survey-flow";
import type { Draft } from "./types";

export function RecapSection({ draft }: { draft: Draft }) {
  const entries = recapFor(draft);
  if (!entries.length) {
    return <div style={{ fontSize: 14, color: "#9aa0ab" }}>Nothing to read back yet — pick a scope in Kill questions, then capture scopes of interest and client goals in each discipline.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ fontSize: 12, color: "#8c919c" }}>What we heard — read this back to the customer.</div>
      {entries.map((e) => (
        <div key={e.disc}>
          <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 6 }}>{e.label}</div>
          {e.scopes.length > 0 || e.other ? (
            <div style={{ fontSize: 16, lineHeight: 1.5, color: "#16181d" }}>
              Interested in: {[...e.scopes.filter((s) => s !== "Other"), e.other ? `Other — ${e.other}` : ""].filter(Boolean).join(", ")}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "#9aa0ab" }}>No scopes of interest captured.</div>
          )}
          {e.goals.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 16, lineHeight: 1.55 }}>
              {e.goals.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
```

> `Draft` satisfies `FlowSlice` structurally (`visitPurpose`, `scope`, `disciplines`, `linesets`).

- [ ] **Step 4: `sections/final-thoughts.tsx`**

```tsx
/* Final thoughts (#344 A5) — internal judgment tags at the end of the visit. Internal only: never printed on the
   field sheet or any customer document. Retired tags still show on a survey that carries them; the old Site
   conditions chips stay readable underneath. */
import type { CSSProperties } from "react";
import { activeSurveyTags, surveyTagLabel, type SurveyTag } from "@/lib/survey-tags";
import { labelStyle } from "./styles";
import type { Draft } from "./types";

export function FinalThoughtsSection({
  draft, tags, onTags, chipStyle,
}: {
  draft: Draft;
  tags: SurveyTag[];
  onTags: (next: string[]) => void;
  chipStyle: (active: boolean) => CSSProperties;
}) {
  const chosen = draft.internalTags;
  const offered = activeSurveyTags(tags);
  const carried = chosen.filter((id) => !offered.some((t) => t.id === id));
  const toggle = (id: string) => onTags(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <div>
      <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>Internal only — never shown to the customer.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {offered.map((t) => (
          <button type="button" key={t.id} aria-pressed={chosen.includes(t.id)} onClick={() => toggle(t.id)} style={chipStyle(chosen.includes(t.id))}>
            {t.label}
          </button>
        ))}
        {carried.map((id) => (
          <button type="button" key={id} aria-pressed onClick={() => toggle(id)} title="This tag is retired — tap to remove it" style={{ ...chipStyle(true), textDecoration: "line-through" }}>
            {surveyTagLabel(tags, id)}
          </button>
        ))}
      </div>
      {draft.conditions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Older site conditions</label>
          <div style={{ fontSize: 13, color: "#5b616e" }}>{draft.conditions.join(" · ")}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into the editor**

1. `sections/types.ts`: `SectionDef` kinds — remove `| { kind: "conditions" }`; add `| { kind: "recap" }` and `| { kind: "finalThoughts" }`. `EditorMeta`: remove `conditions: string[];`.
2. `page.tsx`: remove `CONDITIONS` from the import and `conditions: CONDITIONS,` from meta.
3. `controls.tsx`:
   - Remove `ConditionsSection` import and `toggleCondition`; import `RecapSection`, `FinalThoughtsSection`, `OlderNotes`.
   - In the sections builder: delete `secs.push({ id: "conditions", … })`; after the `notes` push add

```ts
    secs.push({ id: "recap", title: "Customer recap", subtitle: "Read back what we heard", group: "wrapup", step: 5, kind: "recap" });
    secs.push({ id: "finalThoughts", title: "Final thoughts", subtitle: "Internal tags — never shown to the customer", group: "wrapup", step: 5, kind: "finalThoughts" });
```

   - Replace the `{sec.kind === "conditions" && (…)}` render block with

```tsx
                      {sec.kind === "recap" && <RecapSection draft={draft} />}
                      {sec.kind === "finalThoughts" && (
                        <FinalThoughtsSection draft={draft} tags={meta.internalTags} onTags={(next) => setField("internalTags", next)} chipStyle={chipStyle} />
                      )}
```

   - At the end of each open section body (inside `{open && (<div style={{ padding: "4px 18px 20px" }}> … </div>)}`, after the last kind block), add

```tsx
                      <OlderNotes notes={draft.legacyNotes.filter((n) => n.section === sec.id)} />
```

4. Delete `sections/conditions.tsx` (`git rm`) and confirm no references: `grep -rn "sections/conditions" src`.

- [ ] **Step 6: Verify + commit**

```bash
npx tsc --noEmit && npx tsx scripts/test-va-notes.ts | tail -1 && npx eslint "src/app/(app)/venue-assessments/[id]"
git add -A "src/app/(app)/venue-assessments/[id]" scripts/test-va-notes.ts
git commit -m "feat(venue-assessments): #344 customer recap, Final thoughts tags, Older notes per section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Field sheet, findings text, list tag filter

**Files:**
- Modify: `src/lib/venue-assessment-sheet.ts`, `src/lib/survey-findings.ts`, `src/app/(app)/venue-assessments/page.tsx`
- Modify: `scripts/test-va-notes.ts`

**Interfaces:**
- Consumes: `recapFor`, `recapScopeText`, `isQuoteVisit` (Task 1); `LegacyNote` (Task 2); `resolveSurveyTags`, `activeSurveyTags`, `surveyTagLabel` (Task 3).
- Produces: sheet page 1 gains a "What we heard" section; the Project notes page gains "Older notes"; "Quote questions" heading renamed "Quote & notes" and quote rows only print when filled; Close-out page only when any `signoff` value is non-empty; `surveyFindings` appends a "What we heard:" block; list page filters by `?tag=<id>` (repeatable, any-of).

- [ ] **Step 1: Failing checks**

Add imports to `scripts/test-va-notes.ts`:

```ts
import { buildAssessmentSheet } from "../src/lib/venue-assessment-sheet";
import { surveyFindings } from "../src/lib/survey-findings";
import { blankAssessment } from "../src/lib/stores/assessment";
```

Append:

```ts
  /* ---- Task 9: sheet + findings + list ---- */
  const sheetBase = {
    id: "FS-9", venueClass: "theatre", venue: "Hall", customer: "Acme", measurements: {}, linesets: [], linesetsEnabled: false,
    lifeSafety: { deluge: "", smokeVent: "", adaNotes: "", egressNotes: "" }, assessmentEnabled: false, assessment: blankAssessment(), templateRev: "5.1",
    signoff: { repName: "", repSignedAt: "", contactName: "", contactSignedAt: "", reviewerName: "", reviewerRole: "", reviewerSignedAt: "" },
    scope: ["rigging"], disciplines: { rigging: { scope: ["New grid"], goals: "Safer rail\nQuieter" } },
    legacyNotes: [{ section: "mBeams", label: "Existing rig type (before #344)", text: "Hemp" }],
    internalTags: ["tg_price_sensitive"],
  } as never;
  const sh = buildAssessmentSheet(sheetBase);
  const pages = sh.fieldSheet!.pages;
  const heard = pages[0].sections.find((s) => s.heading === "What we heard");
  ok(!!heard && heard.rows.some((r) => r.label === "Rigging" && r.value === "New grid") && heard.rows.some((r) => r.label === "Rigging goals" && r.value === "Safer rail; Quieter"),
    "#344 A7: the field sheet prints the recap on page 1");
  ok(!pages.some((p) => p.sections.some((s) => s.heading === "Sign-off")), "#344 A6: no Close-out page when nobody signed (new surveys)");
  ok(pages.some((p) => p.sections.some((s) => s.heading === "Older notes" && s.rows.some((r) => r.value === "Hemp"))), "#344 R1: Older notes print");
  ok(!JSON.stringify(sh).includes("Price-sensitive") && !JSON.stringify(sh).includes("tg_price_sensitive"), "#344 A5: internal tags never print");
  const signed = buildAssessmentSheet({ ...(sheetBase as object), signoff: { repName: "Rep", repSignedAt: "2026-09-20", contactName: "", contactSignedAt: "", reviewerName: "", reviewerRole: "", reviewerSignedAt: "" } } as never);
  ok(signed.fieldSheet!.pages.at(-1)!.sections.at(-1)!.heading === "Sign-off", "#344 A6: an old signed survey still prints its Close-out page");

  const fx = surveyFindings({ reason: "walk", scope: ["rigging"], disciplines: { rigging: { scope: ["New grid"], goals: "Safer rail" } } } as never);
  ok(fx.includes("What we heard:\n  - Rigging: New grid\n    Goal: Safer rail"), "#344 A7: the plain-text findings carry the recap");
  ok(surveyFindings({ reason: "walk" }) === "Reason for visit: walk", "#344 A7: no recap block when there's nothing to read back");

  const listSrc = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/page.tsx"), "utf8");
  ok(/sp\.tag/.test(listSrc) && listSrc.includes("internalTags") && listSrc.includes("resolveSurveyTags"), "#344 A5: the list filters by internal tag");
```

- [ ] **Step 2: Sheet**

In `src/lib/venue-assessment-sheet.ts`:
1. Imports: `import { recapFor, recapScopeText } from "@/lib/survey-flow";`, `import type { LegacyNote } from "@/lib/survey-migrate";`.
2. `SheetRecord`: add `| "scope" | "legacyNotes"` to the Pick list (both optional on SurveyRecord).
3. After the "Visit brief" section in page 1, add:

```ts
      {
        heading: "What we heard",
        rows: compactRows(
          recapFor(record).flatMap((e) => [row(e.label, recapScopeText(e)), row(`${e.label} goals`, e.goals.join("; "))])
        ),
      }
```

4. The `Project notes` page: rename heading `"Quote questions"` to `"Quote & notes"` and wrap its rows in `compactRows(…)` so unasked quote rows (non-quote visits) don't print as blanks. Then add, as the last section of that page:

```ts
    ...(record.legacyNotes?.length
      ? [{ heading: "Older notes", rows: (record.legacyNotes as LegacyNote[]).map((n) => row(n.label, n.text)) }]
      : [])
```

   (`page()` drops empty sections already.)
5. Close-out: wrap the sign-off page push in

```ts
  const signed = Object.values(record.signoff || {}).some((v) => String(v ?? "").trim() !== "");
  if (signed) pages.push(page(`${title} — Close-out`, { heading: "Sign-off", rows: signoffRows }));
```

   The existing harness check "puts sign-off at the end of the final page" uses a signed fixture, so it still passes.

- [ ] **Step 3: Findings**

In `src/lib/survey-findings.ts`:
1. `import { recapFor } from "./survey-flow";`
2. `SurveyFindingsInput` Pick list: add `| "disciplines" | "scope"`.
3. Before `return parts.filter(Boolean).join("\n");` add:

```ts
  const heard = recapFor(s).filter((e) => e.scopes.length || e.other || e.goals.length);
  if (heard.length) {
    parts.push(
      "What we heard:\n" +
        heard
          .map((e) =>
            [
              `  - ${e.label}: ${[...e.scopes.filter((x) => x !== "Other"), e.other ? `Other: ${e.other}` : ""].filter(Boolean).join(", ") || "(no scopes)"}`,
              ...e.goals.map((g) => `    Goal: ${g}`),
            ].join("\n")
          )
          .join("\n")
    );
  }
```

   Then search for exact-output tests: `grep -n "surveyFindings(" scripts/*.ts`. Any fixture with `disciplines` whose expected string changes must be updated to include the new block — read each before editing.

- [ ] **Step 4: List tag filter**

In `src/app/(app)/venue-assessments/page.tsx`:
1. `import { getSettings } from "@/lib/settings";` and `import { resolveSurveyTags, activeSurveyTags } from "@/lib/survey-tags";`; add `getSettings()` to the page's `Promise.all` and `const tags = resolveSurveyTags(settings.surveyInternalTags);`.
2. `const tagFilter = (Array.isArray(sp.tag) ? sp.tag : sp.tag ? [sp.tag] : []).filter((t) => tags.some((x) => x.id === t));`
3. `const base = (mine ? … : all).filter((s) => !tagFilter.length || (s.internalTags || []).some((t) => tagFilter.includes(t)));`
4. `hrefFor` and `mineHref`: append each active tag `params.append("tag", t)` for `t of tagFilter`.
5. Under the stage segment row (after the `</div>` that closes the row holding the "Assigned to me" link), render the tag row:

```tsx
      {(() => {
        const used = new Set(all.flatMap((s) => s.internalTags || []));
        const shown = activeSurveyTags(tags).filter((t) => used.has(t.id) || tagFilter.includes(t.id));
        if (!shown.length) return null;
        const tagHref = (id: string) => {
          const next = tagFilter.includes(id) ? tagFilter.filter((x) => x !== id) : [...tagFilter, id];
          const params = new URLSearchParams();
          if (stage !== "all") params.set("stage", stage);
          if (mine) params.set("mine", "1");
          next.forEach((t) => params.append("tag", t));
          const qs = params.toString();
          return "/venue-assessments" + (qs ? "?" + qs : "");
        };
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "-4px 0 16px" }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#aab0bb", letterSpacing: ".05em", textTransform: "uppercase" }}>Tags</span>
            {shown.map((t) => {
              const on = tagFilter.includes(t.id);
              return (
                <Link
                  key={t.id}
                  href={tagHref(t.id)}
                  style={{
                    fontSize: 12.5, fontWeight: 600, borderRadius: 20, padding: "7px 12px", textDecoration: "none", whiteSpace: "nowrap",
                    border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                    background: on ? ACCENT_SOFT : "#fff",
                    color: on ? ACCENT_INK : "#5b616e",
                  }}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        );
      })()}
```

`ACCENT_SOFT` / `ACCENT_INK` / `Link` are already imported by the page (they style "Assigned to me"); if not, import them the same way that link does. Internal tags show on this internal list only — never on a customer document.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit && npx tsx scripts/test-va-notes.ts | tail -1
npm run test:specs 2>&1 | grep -E "FAIL" | head
git add src/lib/venue-assessment-sheet.ts src/lib/survey-findings.ts "src/app/(app)/venue-assessments/page.tsx" scripts/test-va-notes.ts scripts/test-review-and-spec.ts
git commit -m "feat(venue-assessments): #344 field sheet recap + older notes, close-out only when signed, findings recap, list tag filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Gates, browser pass, docs

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase entry), `MASTER-QUESTIONS.md` only if a new open question arises

- [ ] **Step 1: The four gates + build**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tail -5
ps aux | grep -E "next dev|tsx" | grep -v grep   # must be empty before smoke
npm run test:smoke 2>&1 | tail -5
npx eslint "src/app/(app)/venue-assessments" "src/app/(app)/assessments/[id]" src/lib/stores/surveys.ts src/lib/stores/survey-intake.ts "src/app/(app)/settings" src/lib/survey-flow.ts src/lib/survey-migrate.ts src/lib/survey-tags.ts src/components/section-rail 2>&1 | tail -3
npm run build 2>&1 | tail -15
df -h . | tail -1
```

Expected: tsc clean; test:specs PASS count = baseline + the new `#344` checks, 0 FAIL; smoke all pass; eslint problems ≤ the Task 0 baseline; build succeeds (catches a client component importing a store). If `df` shows low space, clean temp PGlite dirs (`ls -d /var/folders/*/*/T/tmp.* 2>/dev/null | head`) before re-running.

- [ ] **Step 2: Browser pass on a scratch datadir**

Follow memory `peak-exercising-post-routes-safely.md` / `peak-worktree-dev-server-browser-verification-traps.md`: boot `next dev` in this worktree on a scratch `PGLITE_PATH` (never `.data/pglite`), add a launch config in the MAIN checkout's `.claude/launch.json`, sign in with the dev picker, unregister the service worker on first compile. Then check, with screenshots:
1. New request → editor opens with Assigned to = you, Scheduled = today.
2. Kill questions third; Scope chips; Rigging system appears when Rigging is ticked; stage W/D typed on the card shows in Measurements.
3. Tick only Curtains → Beams, Rigging, FOH, Line sets disappear from the list and the rail.
4. Purpose = Bid walk → Existing materials & quote shows only the three "on file" checks; New system design → all quote questions.
5. Wrap-up order: Photos, Scope & notes, Existing materials & quote, Customer recap, Final thoughts, Assignment & schedule. No Sign-off.
6. Collapse a section, reload → still collapsed. Rail click expands and scrolls under the sticky header. Phone width (375) → rail becomes a select.
7. Settings → Field & Venues → Final thoughts tags: rename one, add one, save; editor offers the new tag.
8. Assessments engine editor (`/assessments/<id>` on the scratch DB): rail looks and behaves as before (ring, badges, Scopes…).

Do **not** click photo upload or Print sheet's email. Print sheet (PDF render) is fine.

Stop the dev server afterwards and confirm no stray `next dev` (memory: `preview_stop` can leave it running).

- [ ] **Step 3: Docs**

Recompute numbers from origin/main right before writing:

```bash
git fetch -q origin
git show origin/main:DECISIONS.md | grep -oE "D1[0-9]{3}" | sort -u | tail -1
git show origin/main:PUNCHLIST.md | grep -oE "^## [0-9]+" | tail -1
git show origin/main:AGENTS.md | grep -oE "^[0-9]+\. ✅" | tail -1
```

Then:
- `DECISIONS.md`: one entry per decision taken in this slice, next free D-numbers: quote purposes = New system design only (Jeff); kill questions moved up + scope + rig system, contact phone dropped; one rigging-system answer + read-time copy-up; scope unset filters nothing / seeded from data; Sign-off removed, Close-out prints only for old signed surveys; internal tags in the settings row (not a separate blob — deviation from spec A5 wording), never printed; assignment defaults (visit assignee, else creator; today Chicago; stage unchanged); Accordion retired; shared SectionRail; legacyNotes derived never stored; field-sheet Older notes print on the Project notes page (spec said "under the section").
- `PUNCHLIST.md`: `## 342` with slice A done, slices B and C pending, and the Jeff-gated items (review the internal tag list in Settings → Field; old in-progress surveys now ask for Scope before their discipline intakes unlock).
- `AGENTS.md`: new phase entry "61. 🚧 **Venue Assessment notes** (#344, D…)" summarising slice A in the house style, noting B and C pending.

Commit:

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(venue-assessments): #344 slice A — decisions, punch item, phase entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand back**

Report the gate numbers (tsc, specs PASS/FAIL counts vs baseline, smoke, eslint vs baseline, build) and the browser screenshots. Slice A merges to main only on Jeff's go-ahead (whole-branch review first).
