# Estimator in four steps — Phase 1 (the frame) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the one-screen Estimator into four step tabs — Build · Build package · Customer review · Send & track — under one shared header, with every existing control moved (not redesigned) into its step.

**Architecture:** The 4,385-line `EstimatorClient` body (all state + handlers) moves verbatim into a `useEstimatorState(props)` hook; the component becomes a shell (header, tabs, banners) that renders one step component per `?step=`. Steps switch client-side with `window.history.pushState`, so unsaved edits survive. Two pure modules carry the new rules — `steps.ts` (URL + action→step) and `readiness.ts` (the tab badges) — both pinned in the spec harness.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript, the repo's spec harness (`scripts/test-review-and-spec.ts`, `ok(cond, msg)`), route smoke (`scripts/smoke-routes.ts`).

**Spec:** `docs/superpowers/specs/2026-10-07-estimator-four-steps-design.md` (§4 is this plan).

## Global Constraints

- Scope: the system Estimator (`src/app/(app)/estimator/`) only. Service builders (flame/repair/inspection) are untouched.
- **No pricing, output, data-model, migration or PDF change.** Phase 1 is "the same estimator, reorganised."
- URL: `/estimator?id=<quoteId>&step=build|package|review|send`; missing/unknown `step` → `build`; the Build step writes no `step` param (old URLs stay canonical).
- Every existing inbound param keeps working: `?id`, `?statusError`, `?surveyId`, `?inspectionId`, hand-off `?type&category&customer&venue&contact&name&replaces`.
- Phone (≤ 700 px, the existing `phone` state) always renders the Review step, view-only, with the approver-only `QuoteNextStep` exactly as today's phone preview.
- Next-step navigation (only on a successful result): submit/approve/attest/assign → `review`; send → `send`; sendBack/withdraw → `build`.
- Readiness never blocks anything.
- Copy: step labels exactly `Build`, `Build package`, `Customer review`, `Send & track`.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` § "Native History API" and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` before Task 6 (AGENTS.md: this Next differs from training data).
- Verification gates per task (memory `peak-verification-gate-protocol`): `npx tsc --noEmit`, `npm run test:specs` (report PASS/FAIL counts; PASS = base + new, FAIL = 0), `npm run lint` vs the baseline, and `npx next build` on tasks that touch client components (memory `peak-client-component-server-import-build-gate`). `npm run test:smoke` in Task 9.
- Never open `.data/pglite` from the worktree; dev-server checks use a scratch datadir (memory `peak-exercising-post-routes-safely`, `peak-worktree-dev-server-browser-verification-traps`).
- Never `git stash` (shared stash across worktrees); commit WIP instead.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/estimate-steps/steps.ts` | create | Step vocabulary, `parseStep`, `stepAfterAction`, `stepSearch` — pure |
| `src/lib/estimate-steps/readiness.ts` | create | `estimateReadiness()` → the four tab badges — pure |
| `src/components/quote-review/quote-next-step.tsx` | modify | `onSync(r, action)` — report which action produced the result |
| `scripts/test-review-and-spec.ts` | modify | `estimatorSource()` / `previewDocSource()` readers; new #305 block |
| `src/app/(app)/estimator/use-estimator-state.ts` | create | The old component body, verbatim, as a hook; `EstimatorState` type |
| `src/app/(app)/estimator/estimator-styles.ts` | create | Style constants + `CSS` moved out of the client file |
| `src/app/(app)/estimator/estimator-client.tsx` | rewrite | Shell: header, tabs, banners, active step, URL sync |
| `src/app/(app)/estimator/estimator-header.tsx` | create | Dark header (title, EST·Rev, customer chip, totals, pill, Save, next step, ⋯) + Quote details drawer |
| `src/app/(app)/estimator/header-more-menu.tsx` | create | The ⋯ menu (Change type, Parts list, Draft from survey, Cut sheets, Delete) |
| `src/app/(app)/estimator/step-tabs.tsx` | create | The four tabs with readiness lines |
| `src/app/(app)/estimator/estimator-banners.tsx` | create | Next-step note, action error/gate, save notice, perks, move notice, tier re-price — moved verbatim |
| `src/app/(app)/estimator/steps/build-step.tsx` | create | Systems sidebar (minus Tasks), cards, + Add system / From library, configurator modals |
| `src/app/(app)/estimator/steps/package-step.tsx` | create | System picker + `NarrativeColumn`, `PdfOptionsPanel`, `CoverPackagePanel`, `PackageStaffPanel section="package"` |
| `src/app/(app)/estimator/steps/review-step.tsx` | create | PDF viewer + Save/Download/Open, `QuoteNextStep` panel, `ReviewCostSummary` |
| `src/app/(app)/estimator/steps/send-step.tsx` | create | Status select, `QuoteNextStep` panel, stage bar, `ClientLinkPanel withPackage={false}`, responses, Tasks |
| `src/app/(app)/estimator/review-cost-summary.tsx` | create | Per-system cost / sell / margin table + totals |
| `src/app/(app)/estimator/preview-doc.tsx` | modify | Split into `PdfOptionsPanel` + `PdfPreviewPane` exports (no default `PreviewDoc`) |
| `src/app/(app)/estimator/client-link-panel.tsx` | modify | `withPackage?: boolean` (default `true`) |
| `src/app/(app)/estimator/package-staff-panel.tsx` | modify | `section?: "all" \| "package" \| "responses"` (default `"all"`) |
| `scripts/smoke-routes.ts` | modify | Four `&step=` routes |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | modify | D-entries, punch #305, phase status |

> **Numbering:** this plan uses punch **#305** and decisions **D643–D647**. Two sessions write these files — re-check `origin/main` (`grep -o "^## D[0-9]*" DECISIONS.md | tail -1`, `grep -o "^## [0-9]*\." PUNCHLIST.md | tail -1`) right before Task 9 and renumber if taken.

---

### Task 0: Worktree setup

**Files:** none (environment).

- [ ] **Step 1: Install dependencies in the worktree** (memory `worktree-missing-gitignored-files`: `npm ci`, never a symlink)

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/estimator-steps
npm ci
cp ../../../.env.local .env.local
cp ../../../next-env.d.ts next-env.d.ts 2>/dev/null || true
```

- [ ] **Step 2: Record the baselines**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs 2>&1 | tee /tmp/claude-specs-base.txt | grep -c "^PASS"; grep -c "^FAIL" /tmp/claude-specs-base.txt
npm run lint 2>&1 | tail -3
```

Write the three numbers (PASS, FAIL, lint problems) at the top of your task report. Every later task compares against them. (`df -h .` first — memory `peak-temp-pglite-dirs-fill-disk`.)

---

### Task 1: Step vocabulary + URL rules (pure)

**Files:**
- Create: `src/lib/estimate-steps/steps.ts`
- Test: `scripts/test-review-and-spec.ts` (append a `#305 steps` block at the end)

**Interfaces:**
- Produces:
  - `ESTIMATE_STEPS: readonly ["build","package","review","send"]`
  - `type EstimateStep = "build" | "package" | "review" | "send"`
  - `STEP_LABEL: Record<EstimateStep, string>`
  - `parseStep(raw: string | null | undefined): EstimateStep`
  - `stepAfterAction(action: NextStepAction): EstimateStep | null`
  - `stepSearch(search: string, step: EstimateStep, id?: string | null): string` — returns a `?…` string (or `""`)

- [ ] **Step 1: Write the failing test** — append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #305 — Estimator in four steps (Phase 1): step vocabulary + URL rules.
   ====================================================================== */
import {
  ESTIMATE_STEPS as e304Steps,
  STEP_LABEL as e304Label,
  parseStep as e304Parse,
  stepAfterAction as e304After,
  stepSearch as e304Search,
} from "@/lib/estimate-steps/steps";
{
  ok(e304Steps.join(",") === "build,package,review,send", "#305 steps: four steps in order");
  ok(e304Label.build === "Build" && e304Label.package === "Build package" && e304Label.review === "Customer review" && e304Label.send === "Send & track",
    "#305 steps: the tab labels are exactly the spec's");
  ok(e304Parse(null) === "build" && e304Parse(undefined) === "build" && e304Parse("") === "build" && e304Parse("bogus") === "build" && e304Parse("PACKAGE") === "build",
    "#305 steps: a missing, unknown or wrong-case step is Build");
  ok(e304Parse("package") === "package" && e304Parse("review") === "review" && e304Parse("send") === "send" && e304Parse("build") === "build",
    "#305 steps: each known step parses to itself");
  ok(e304After("submit") === "review" && e304After("approve") === "review" && e304After("attest") === "review" && e304After("assign") === "review",
    "#305 steps: submit / approve / attest / assign land on Customer review");
  ok(e304After("send") === "send", "#305 steps: send lands on Send & track (never Home)");
  ok(e304After("sendBack") === "build" && e304After("withdraw") === "build", "#305 steps: send back / withdraw return to Build");
  ok(e304Search("?id=Q-1", "package") === "?id=Q-1&step=package", "#305 steps: a step is added beside the id");
  ok(e304Search("?id=Q-1&step=send", "build") === "?id=Q-1", "#305 steps: Build drops the step param (old URLs stay canonical)");
  ok(e304Search("", "build") === "", "#305 steps: an empty search stays empty on Build");
  ok(e304Search("?customer=lf&venue=v2", "review", "Q-9") === "?customer=lf&venue=v2&id=Q-9&step=review",
    "#305 steps: other params are kept; a newly saved id is written");
  ok(e304Search("?id=Q-1&step=review", "review", "Q-1") === "?id=Q-1&step=review", "#305 steps: idempotent");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#305|Cannot find|error" | head`
Expected: the harness fails to load — `Cannot find module '@/lib/estimate-steps/steps'`.

- [ ] **Step 3: Implement** `src/lib/estimate-steps/steps.ts`:

```ts
import type { NextStepAction } from "@/lib/quote-next-step";

/**
 * #305 (spec 2026-10-07 §4) — the Estimator's four steps. Pure and
 * client-safe: the shell reads `?step=` through parseStep, writes it through
 * stepSearch, and moves after a next-step action through stepAfterAction.
 */

export const ESTIMATE_STEPS = ["build", "package", "review", "send"] as const;
export type EstimateStep = (typeof ESTIMATE_STEPS)[number];

export const STEP_LABEL: Record<EstimateStep, string> = {
  build: "Build",
  package: "Build package",
  review: "Customer review",
  send: "Send & track",
};

/** Missing, unknown or wrong-case → Build (old `/estimator?id=` links open there). */
export function parseStep(raw: string | null | undefined): EstimateStep {
  return (ESTIMATE_STEPS as readonly string[]).includes(raw ?? "") ? (raw as EstimateStep) : "build";
}

/** Where the shell goes after a SUCCESSFUL next-step action; null = stay. */
export function stepAfterAction(action: NextStepAction): EstimateStep | null {
  switch (action) {
    case "submit":
    case "approve":
    case "attest":
    case "assign":
      return "review";
    case "send":
      return "send";
    case "sendBack":
    case "withdraw":
      return "build";
    default:
      return null;
  }
}

/** The `?…` string for `step`, keeping every other param. Build writes no
 *  `step` param. `id` (a just-saved quote) is set when given. */
export function stepSearch(search: string, step: EstimateStep, id?: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (id) params.set("id", id);
  if (step === "build") params.delete("step");
  else params.set("step", step);
  const s = params.toString();
  return s ? "?" + s : "";
}
```

Note: `URLSearchParams.set` on an existing key keeps its position, and appends new keys at the end — which is what the tests expect.

- [ ] **Step 4: Run the tests**

Run: `npm run test:specs 2>&1 | grep "#305"` → every line `PASS`. Then the full counts: PASS = base + 12, FAIL = 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/estimate-steps/steps.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): #305 step vocabulary + URL rules (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Readiness badges (pure)

**Files:**
- Create: `src/lib/estimate-steps/readiness.ts`
- Test: `scripts/test-review-and-spec.ts` (append `#305 readiness` block)

**Interfaces:**
- Consumes: `EstimateStep` (Task 1); `SpecSection`, `SpecItem` (`src/app/(app)/estimator/types.ts`); `keyProductsNeedingText`, `scopesWithoutGoals` (`src/lib/estimate-output/package-gaps.ts`); `systemPrintsInBody` (`src/app/(app)/estimator/quote-document-view.ts`); `isRewardCreditItem` (`src/lib/rewards/credit-line.ts`); `NextStepTone` (`src/lib/quote-next-step.ts`).
- Produces:
  - `type StepBadge = { state: "ok" | "gaps" | "idle"; label: string; count?: number }`
  - `type ReadinessInput = { saved: boolean; sections: SpecSection[]; review: { label: string; tone: NextStepTone } | null; status: QuoteStatus; revNum: number }` (`QuoteStatus` is a type-only import from `@/lib/stores/quotes` — erased, so still client-safe)
  - `estimateReadiness(i: ReadinessInput): Record<EstimateStep, StepBadge>`

- [ ] **Step 1: Write the failing test** — append:

```ts
/* #305 — readiness badges on the four tabs. */
import { estimateReadiness as e304Ready } from "@/lib/estimate-steps/readiness";
{
  type Sec = import("@/app/(app)/estimator/types").SpecSection;
  const line = (o: Record<string, unknown> = {}) => ({ id: 1, sku: "A", desc: "Part", qty: 1, unit: "ea", cost: 50, price: 100, ...o });
  const sec = (o: Record<string, unknown> = {}): Sec => ({ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [line()], ...o }) as unknown as Sec;
  const base = { saved: true, review: null, status: "draft" as const, revNum: 1 };

  const empty = e304Ready({ ...base, sections: [] });
  ok(empty.build.state === "idle" && empty.build.label === "No systems yet", "#305 readiness: no systems → Build idle");

  const good = e304Ready({ ...base, sections: [sec(), sec({ id: "s2", name: "Rigging" })] });
  ok(good.build.state === "ok" && good.build.label === "✓ 2 systems priced", "#305 readiness: every system has priced lines → ✓ N systems priced");

  const gaps = e304Ready({ ...base, sections: [sec({ items: [] }), sec({ id: "s2", items: [line({ price: 0 }), line({ id: 2, price: 0 }), line({ id: 3 })] })] });
  ok(gaps.build.state === "gaps" && gaps.build.count === 3 && gaps.build.label === "1 empty system · 2 unpriced lines", "#305 readiness: empty systems + unpriced lines are counted and named");

  const credit = e304Ready({ ...base, sections: [sec({ items: [line({ rewardCredit: true, price: -50 })] })] });
  ok(credit.build.state === "gaps" && credit.build.label === "1 empty system", "#305 readiness: a Rewards credit line neither prices nor fills a system");

  ok(e304Ready({ ...base, saved: false, sections: [sec()] }).package.state === "idle" && e304Ready({ ...base, saved: false, sections: [sec()] }).package.label === "Save first",
    "#305 readiness: an unsaved quote's Package is idle");
  const narr = e304Ready({ ...base, sections: [sec({ presentation: "narrative", narrative: "" })] });
  ok(narr.package.state === "gaps" && (narr.package.count ?? 0) >= 1 && /gap/.test(narr.package.label), "#305 readiness: a printed narrative system with no intro is a Package gap");
  const narrOk = e304Ready({ ...base, sections: [sec({ presentation: "narrative", narrative: "A new LED system.", clientGoals: "Brighter stage." })] });
  ok(narrOk.package.state === "ok" && narrOk.package.label === "✓ Ready", "#305 readiness: no gaps → ✓ Ready");

  ok(e304Ready({ ...base, sections: [sec()] }).review.label === "Not submitted" && e304Ready({ ...base, sections: [sec()] }).review.state === "idle", "#305 readiness: no review view → Not submitted");
  ok(e304Ready({ ...base, sections: [sec()], review: { label: "Approved", tone: "approved" } }).review.state === "ok", "#305 readiness: approved → ok");
  ok(e304Ready({ ...base, sections: [sec()], review: { label: "Changes requested", tone: "changes" } }).review.state === "gaps", "#305 readiness: changes requested → gaps");
  ok(e304Ready({ ...base, sections: [sec()], review: { label: "In review · Jeff", tone: "review" } }).review.label === "In review · Jeff", "#305 readiness: the review label is the pill's own");

  ok(e304Ready({ ...base, sections: [sec()], status: "sent", revNum: 2 }).send.label === "Sent · Rev 2" && e304Ready({ ...base, sections: [sec()], status: "sent", revNum: 2 }).send.state === "ok", "#305 readiness: sent → Sent · Rev N");
  ok(e304Ready({ ...base, sections: [sec()], status: "won" }).send.label === "Won" && e304Ready({ ...base, sections: [sec()], status: "lost" }).send.label === "Lost", "#305 readiness: won / lost");
  ok(e304Ready({ ...base, sections: [sec()], review: { label: "Approved", tone: "approved" } }).send.label === "Ready to send", "#305 readiness: an approved draft is Ready to send");
  ok(e304Ready({ ...base, sections: [sec()] }).send.label === "—", "#305 readiness: an unapproved draft shows —");
}
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:specs 2>&1 | grep -E "Cannot find|#305 readiness" | head` → module not found.

- [ ] **Step 3: Implement** `src/lib/estimate-steps/readiness.ts`:

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { keyProductsNeedingText, scopesWithoutGoals } from "@/lib/estimate-output/package-gaps";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import type { NextStepTone } from "@/lib/quote-next-step";
import type { QuoteStatus } from "@/lib/stores/quotes";
import type { EstimateStep } from "./steps";

/**
 * #305 (spec §4.6) — the line under each step tab. Pure and client-safe;
 * computed from the LIVE editor state, so it moves as you type. Never blocks.
 * The Package count is the client-side half of package-gaps.ts; the
 * server-only gaps (datasheets, drawings) stay as chips inside the step.
 */

export type StepBadge = { state: "ok" | "gaps" | "idle"; label: string; count?: number };

export type ReadinessInput = {
  saved: boolean;
  sections: SpecSection[];
  /** The next-step view's pill, or null for an unsaved quote. */
  review: { label: string; tone: NextStepTone } | null;
  status: QuoteStatus;
  revNum: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function buildBadge(sections: SpecSection[]): StepBadge {
  if (sections.length === 0) return { state: "idle", label: "No systems yet" };
  let empty = 0;
  let unpriced = 0;
  for (const s of sections) {
    const lines = s.items.filter((it) => !isRewardCreditItem(it));
    if (lines.length === 0) empty++;
    unpriced += lines.filter((it) => !(Number(it.price) > 0)).length;
  }
  const count = empty + unpriced;
  if (count === 0) return { state: "ok", label: `✓ ${plural(sections.length, "system", "systems")} priced` };
  const parts = [empty ? plural(empty, "empty system", "empty systems") : "", unpriced ? plural(unpriced, "unpriced line", "unpriced lines") : ""].filter(Boolean);
  return { state: "gaps", count, label: parts.join(" · ") };
}

function packageBadge(saved: boolean, sections: SpecSection[]): StepBadge {
  if (!saved) return { state: "idle", label: "Save first" };
  const noIntro = sections.filter((s) => systemPrintsInBody(s) && s.presentation === "narrative" && !(s.narrative || "").trim()).length;
  const count = noIntro + keyProductsNeedingText(sections) + scopesWithoutGoals(sections);
  return count === 0 ? { state: "ok", label: "✓ Ready" } : { state: "gaps", count, label: plural(count, "gap", "gaps") };
}

function reviewBadge(review: ReadinessInput["review"]): StepBadge {
  if (!review) return { state: "idle", label: "Not submitted" };
  if (review.tone === "approved") return { state: "ok", label: review.label };
  if (review.tone === "changes") return { state: "gaps", label: review.label };
  return { state: "idle", label: review.label };
}

function sendBadge(i: ReadinessInput): StepBadge {
  if (i.status === "sent") return { state: "ok", label: `Sent · Rev ${i.revNum}` };
  if (i.status === "won") return { state: "ok", label: "Won" };
  if (i.status === "lost") return { state: "idle", label: "Lost" };
  return { state: "idle", label: i.review?.tone === "approved" ? "Ready to send" : "—" };
}

export function estimateReadiness(i: ReadinessInput): Record<EstimateStep, StepBadge> {
  return {
    build: buildBadge(i.sections),
    package: packageBadge(i.saved, i.sections),
    review: reviewBadge(i.review),
    send: sendBadge(i),
  };
}
```

> If the `narrOk` test fails because `scopesWithoutGoals` reads goals from a field other than `clientGoals`, open `src/lib/estimate-output/scopes.ts` (`outputScopes`) and set the test fixture's field to the one it reads — do not change `package-gaps.ts`.

- [ ] **Step 4: Run** — `npm run test:specs 2>&1 | grep "#305"` → all PASS; counts PASS = base + 12 + 15, FAIL = 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/estimate-steps/readiness.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): #305 readiness badges for the four steps (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `QuoteNextStep` reports which action ran

**Files:**
- Modify: `src/components/quote-review/quote-next-step.tsx` (Props `onSync`, `run`, and its 9 call sites at ~lines 230–249 and ~380)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Produces: `onSync?: (r: NextStepSync, action: NextStepAction) => void` — existing one-argument callers keep compiling.

- [ ] **Step 1: Write the failing pin** — append:

```ts
/* #305 — QuoteNextStep hands the action to onSync so the Estimator can move steps. */
{
  const ns304 = readFileSync(join(process.cwd(), "src/components/quote-review/quote-next-step.tsx"), "utf8");
  ok(/onSync\?: \(r: NextStepSync, action: NextStepAction\) => void;/.test(ns304), "#305 next step: onSync receives the action");
  ok(/const run = \(action: NextStepAction, fn:/.test(ns304) && /\(onSync \?\? \(\(\) => router\.refresh\(\)\)\)\(r, action\);/.test(ns304), "#305 next step: run threads its action into onSync");
  ok(!/\brun\(\(\)/.test(ns304) && !/\brun\(\(shown\)/.test(ns304), "#305 next step: every run(...) call names its action first");
}
```

- [ ] **Step 2: Run** — those three lines FAIL.

- [ ] **Step 3: Implement.** In `quote-next-step.tsx`:
  - Props: replace `onSync?: (r: NextStepSync) => void;` with `onSync?: (r: NextStepSync, action: NextStepAction) => void;` (keep its doc comment; append "`action` is the button that produced the result (#305).").
  - `run`: change the signature to `const run = (action: NextStepAction, fn: (shown: number) => Promise<NextStepSync>, opts: { skipBefore?: boolean; versioned?: boolean } = {}) => {` and the sync line to `(onSync ?? (() => router.refresh()))(r, action);`.
  - Call sites — prepend the action:
    - `run("sendBack", () => nsSendBackAction(quoteId, text, view.asOf), { skipBefore: true })`
    - `run("attest", () => nsAttestAction(quoteId, text))`
    - `run("submit", () => nsSubmitAction(quoteId, null))`
    - the three send calls: `run("send", …)`
    - the two approve calls: `run("approve", …)`
    - `run("withdraw", () => nsWithdrawAction(quoteId))`
    - the assign-to-reviewer call (~line 380): `run("assign", () => nsSubmitAction(quoteId, name))`
  - `NextStepAction` is already imported (line 26).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm run test:specs` → the 3 new PASS, FAIL = 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/quote-review/quote-next-step.tsx scripts/test-review-and-spec.ts
git commit -m "feat(quote-review): #305 QuoteNextStep passes the action to onSync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Harness reads the Estimator as one source

The harness pins strings in `estimator-client.tsx` (44 sites) and `preview-doc.tsx` (11 sites). Tasks 5–8 move that code into new files. Before moving anything, make those pins read the **concatenation** of the Estimator's files, so a verbatim move keeps them green.

**Files:**
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (harness-internal): `estimatorSource(): string`, `previewDocSource(): string`.

- [ ] **Step 1: Add the readers** right after the `const ok = …` line (~line 340):

```ts
/* #305 — the Estimator is split across a shell, a state hook, a header and
   one file per step; pins that used to read estimator-client.tsx /
   preview-doc.tsx read all of them, in a fixed order, so a verbatim move
   between them never breaks a pin. Missing files are skipped. */
const EST_DIR = "src/app/(app)/estimator";
const ESTIMATOR_FILES = [
  "estimator-client.tsx",
  "use-estimator-state.ts",
  "estimator-styles.ts",
  "estimator-header.tsx",
  "header-more-menu.tsx",
  "estimator-banners.tsx",
  "step-tabs.tsx",
  "steps/build-step.tsx",
  "steps/package-step.tsx",
  "steps/review-step.tsx",
  "steps/send-step.tsx",
];
const PREVIEW_FILES = ["preview-doc.tsx", "steps/package-step.tsx", "steps/review-step.tsx", "steps/send-step.tsx"];
const readJoined = (files: string[]) =>
  files
    .map((f) => join(process.cwd(), EST_DIR, f))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
const estimatorSource = () => readJoined(ESTIMATOR_FILES);
const previewDocSource = () => readJoined(PREVIEW_FILES);
```

- [ ] **Step 2: Swap the read sites.** Every expression that reads `src/app/(app)/estimator/estimator-client.tsx` (any reader: `readFileSync(join(process.cwd(), "…"), "utf8")`, `readFileSync("…", "utf8")`, `rd("…")`, `src("…")`, `s5("…")`, `l272Read("…", "utf8")`, `r282Read(…)`, `c296cRead(join(…), "utf8")`, `read267(…)`, `rd292c(…)`, `rd292d(…)`, `src285(…)`, `e223Src(…)`, `est302("estimator-client.tsx")`) becomes `estimatorSource()`. Same for `preview-doc.tsx` → `previewDocSource()`. A starting point (review every replacement by hand):

```bash
python3 - <<'EOF'
import re
p = "scripts/test-review-and-spec.ts"
s = open(p).read()
for path, fn in [("estimator-client.tsx", "estimatorSource()"), ("preview-doc.tsx", "previewDocSource()")]:
    full = re.escape('"src/app/(app)/estimator/' + path + '"')
    s, n1 = re.subn(r'\b\w+\((?:join\(process\.cwd\(\), )?' + full + r'\)?(?:, "utf8")?\)', fn, s)
    print(path, n1)
s = s.replace('est302("estimator-client.tsx")', "estimatorSource()")
open(p, "w").write(s)
EOF
grep -n '"src/app/(app)/estimator/estimator-client.tsx"\|"src/app/(app)/estimator/preview-doc.tsx"' scripts/test-review-and-spec.ts
```

The remaining `grep` hits are **file lists** (≈ lines 25791, 26814, 33761 — "no forbidden import" / "every client file" checks that map over paths). For each: add the new files to that list instead of replacing the path, e.g. append `...ESTIMATOR_FILES.slice(1).map((f) => \`${EST_DIR}/${f}\`)` so the check covers every Estimator file. Leave the comment mentions (lines 491, 843, 886, 17273) alone.

- [ ] **Step 3: Verify nothing changed** — `npm run test:specs`: PASS and FAIL counts equal Task 3's (the files don't exist yet, so `estimatorSource()` returns exactly `estimator-client.tsx`). `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-review-and-spec.ts
git commit -m "test(estimator): #305 harness pins read the Estimator as one source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Move the component body into `useEstimatorState`

A mechanical move. No line of logic changes.

**Files:**
- Create: `src/app/(app)/estimator/use-estimator-state.ts`
- Create: `src/app/(app)/estimator/estimator-styles.ts`
- Modify: `src/app/(app)/estimator/estimator-client.tsx`

**Interfaces:**
- Produces: `export function useEstimatorState(props: EstimatorProps)` and `export type EstimatorState = ReturnType<typeof useEstimatorState>` — an object holding every prop, state value, setter, ref, derived value and handler the JSX uses (e.g. `s.sections`, `s.setSections`, `s.doSave`, `s.saveNow`, `s.applySync`, `s.loadedId`, `s.next`, `s.phone`, `s.t`, `s.pdfDirty`, `s.activeId`, `s.setActiveId`, `s.selectSystem`, `s.narrSec`, `s.kpLib`, …).

- [ ] **Step 1: Split module-level code.** In `estimator-client.tsx`, everything above `export default function EstimatorClient` (lines ~130–421) is either (a) helpers the body calls (`freshSections`, `computeNid`, `freshCustom`, `freshCurtain`, `freshFixture`, `freshVendor`, `freshLabor`, `freshTrackDraft`, `vendorLinesTotal`, `countCutSheetTypes` import, `TAX_RATE_PCT`, `INSTALL_TIMEFRAMES`, `CurtainTrackPrefill`, …) or (b) styles the JSX uses (`CSS`, `STATUS_DOT`, `DARK_SELECT`, `CTX_LABEL`, `META_*`, `SIDE_TOGGLE`, `SIDE_OPEN_KEY`, `NARR_OPEN_KEY`, …). Move (a) into `use-estimator-state.ts` (unexported unless the JSX needs them), (b) into `estimator-styles.ts` as named exports. When unsure, move it to the hook file — tsc will say if the JSX needs it.

- [ ] **Step 2: Move the body.** Cut from the line after `}: EstimatorProps) {` (the `/* ---------------- state` comment) through the line before `  return (` (just after `vendorFormMargin`) into:

```ts
"use client";
// (the imports the moved code needs — move them from estimator-client.tsx)

export function useEstimatorState(props: EstimatorProps) {
  const {
    initial, pipelines, fabrics, curtainSewingPct, trackSeries, trackParts, laborRates, fixtureRates,
    fixtureAssemblies, vendors, blobUploads, customers, travel, next: initialNext, aiSource, people,
    quoteTasks, templateSets, assumptionLibrary, freightRule, portalStatusError, specKeys, canApplyCredit,
    viewerName, viewerCanApprove, canWriteNarrativeLibrary, narrativeIntros, notIncludedDefault,
  } = props;
  // ── moved verbatim ──
  …
  return {
    ...props,
    // every local the JSX reads — see Step 3
  };
}

export type EstimatorState = ReturnType<typeof useEstimatorState>;
```

`"use client"` keeps it out of server bundles (it uses hooks and client actions). Keep the moved comments and section dividers (`/* ---------------- vendor quote`, `const addCustomPart = async`, …) — harness pins slice between them.

- [ ] **Step 3: Rewire the component** temporarily as:

```tsx
export default function EstimatorClient(props: EstimatorProps) {
  const s = useEstimatorState(props);
  const { /* every name the JSX below uses */ } = s;
  return ( /* the existing JSX, unchanged */ );
}
```

Fill both lists from the compiler: run `npx tsc --noEmit` and, for each "Cannot find name 'X'" in `estimator-client.tsx`, add `X` to the hook's `return { … }` and to the destructure. Run `npm run lint` — any hook local reported unused was only read by the JSX: add it to the return too. Repeat until both are clean. (`next` in the hook is the state, the prop arrives as `initialNext` — the spread `...props` would put the prop's `next` in the object, so list `next` explicitly **after** the spread so the state wins.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm run lint` ≤ baseline; `npm run test:specs` PASS/FAIL equal to Task 4 (pins now find the moved text through `estimatorSource()`); `npx next build` succeeds. If a pin fails, it is a slice whose two anchors now sit in different files — move the anchors' code together, never edit the pin's intent.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/estimator/
git commit -m "refactor(estimator): #305 move the component body into useEstimatorState (no behaviour change)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shell — header, ⋯ menu, step tabs, banners, URL sync

**Files:**
- Create: `src/app/(app)/estimator/estimator-header.tsx`, `header-more-menu.tsx`, `step-tabs.tsx`, `estimator-banners.tsx`
- Modify: `src/app/(app)/estimator/estimator-client.tsx`, `use-estimator-state.ts` (remove `mode`)
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `EstimatorState` (Task 5), `parseStep`/`stepSearch`/`stepAfterAction`/`STEP_LABEL`/`ESTIMATE_STEPS` (Task 1), `estimateReadiness`/`StepBadge` (Task 2), `onSync(r, action)` (Task 3).
- Produces:
  - `EstimatorHeader({ s, onActed }: { s: EstimatorState; onActed: (action: NextStepAction) => void })`
  - `HeaderMoreMenu({ s }: { s: EstimatorState })`
  - `StepTabs({ step, badges, onStep }: { step: EstimateStep; badges: Record<EstimateStep, StepBadge>; onStep: (s: EstimateStep) => void })`
  - `EstimatorBanners({ s }: { s: EstimatorState })`
  - In the shell: `goStep(step: EstimateStep)`; steps rendered in Task 7 take `{ s: EstimatorState }`.

- [ ] **Step 1: Write the failing pins** — append:

```ts
/* #305 — the shell: four tabs, URL-synced, one header, the ⋯ menu. */
{
  const shell304 = readFileSync(join(process.cwd(), "src/app/(app)/estimator/estimator-client.tsx"), "utf8");
  const header304 = readFileSync(join(process.cwd(), "src/app/(app)/estimator/estimator-header.tsx"), "utf8");
  const more304 = readFileSync(join(process.cwd(), "src/app/(app)/estimator/header-more-menu.tsx"), "utf8");
  const tabs304 = readFileSync(join(process.cwd(), "src/app/(app)/estimator/step-tabs.tsx"), "utf8");
  ok(/useSearchParams\(\)/.test(shell304) && /parseStep\(/.test(shell304) && /window\.history\.pushState\(null, "", /.test(shell304), "#305 shell: the step comes from ?step= and moves with pushState (unsaved edits survive)");
  ok(/s\.phone \? "review"/.test(shell304), "#305 shell: a phone always shows Customer review");
  ok(/window\.history\.replaceState\(null, "", /.test(shell304) && /s\.loadedId/.test(shell304), "#305 shell: the first save writes ?id= into the URL");
  ok(/stepAfterAction\(action\)/.test(shell304), "#305 shell: a successful next-step action moves to its step");
  ok(!/setMode\(|mode === "build"|"Customer preview →"/.test(estimatorSource()), "#305 shell: the old build/preview mode and its button are gone");
  ok(/flexWrap: "wrap"/.test(header304), "#305 header: wraps instead of overflowing at 1024 px");
  ok(["ChangeTypeControl", "Parts list (CSV)", "Draft from survey/inspection", "Cut sheets", "DeleteQuoteButton"].every((x) => more304.includes(x)) && !/Parts list \(CSV\)|DeleteQuoteButton/.test(header304),
    "#305 header: Change type, Parts list, Draft from survey, Cut sheets and Delete live in the ⋯ menu");
  ok(/aria-current=\{active \? "page" : undefined\}/.test(tabs304) && /STEP_LABEL\[/.test(tabs304), "#305 tabs: labelled from STEP_LABEL, current tab marked");
}
```

- [ ] **Step 2: Run** — they FAIL (files missing).

- [ ] **Step 3: `step-tabs.tsx`**

```tsx
"use client";

import type { CSSProperties } from "react";
import { ESTIMATE_STEPS, STEP_LABEL, type EstimateStep } from "@/lib/estimate-steps/steps";
import type { StepBadge } from "@/lib/estimate-steps/readiness";

/** #305 — the four step tabs under the header; the line under each is its readiness. */
const BADGE_INK: Record<StepBadge["state"], string> = { ok: "#1f8a5b", gaps: "#b7791f", idle: "#8c919c" };

export function StepTabs({ step, badges, onStep }: { step: EstimateStep; badges: Record<EstimateStep, StepBadge>; onStep: (s: EstimateStep) => void }) {
  return (
    <nav aria-label="Estimate steps" className="est-steps" style={{ display: "flex", background: "#23262d", borderTop: "1px solid #2b2e35", flexShrink: 0 }}>
      {ESTIMATE_STEPS.map((k, i) => {
        const active = k === step;
        const b = badges[k];
        const style: CSSProperties = {
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          padding: "8px 16px",
          border: "none",
          borderRight: "1px solid #1d2026",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          background: active ? "#f7f8fa" : "transparent",
          color: active ? "#16181d" : "#9aa0ab",
        };
        return (
          <button key={k} type="button" aria-current={active ? "page" : undefined} onClick={() => onStep(k)} style={style}>
            <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {i + 1} · {STEP_LABEL[k]}
            </div>
            <div style={{ fontSize: 10.5, color: BADGE_INK[b.state], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</div>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: `header-more-menu.tsx`** — the rare actions, moved verbatim from today's toolbar (their `onClick` bodies and disabled logic unchanged):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ChangeTypeControl } from "@/components/quote-flow-controls";
import type { EstimatorState } from "./use-estimator-state";
// DeleteQuoteButton: import it from wherever estimator-client.tsx imports it today.

/** #305 — the header's ⋯ menu: actions used a few times per quote, not per minute. */
export function HeaderMoreMenu({ s }: { s: EstimatorState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = { display: "block", width: "100%", textAlign: "left" as const, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-ui)", background: "none", border: "none", color: "#e6e8ec", cursor: "pointer" };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} title="More actions" onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, lineHeight: 1, color: "#cfd3da", background: "#2b2e35", border: "none", borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
        ⋯
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, minWidth: 230, background: "#23262d", border: "1px solid #3a3e46", borderRadius: 8, boxShadow: "0 12px 28px rgba(0,0,0,.28)", padding: "4px 0" }}>
          {s.loadedId && (
            <div style={{ padding: "6px 12px" }}>
              <ChangeTypeControl quoteId={s.loadedId} status={s.status} tone="dark" />
            </div>
          )}
          {s.aiSource && (
            <button type="button" role="menuitem" style={item} onClick={() => { setOpen(false); s.openAiDraft(); }} title={"Assemble the scope of work from " + s.aiSource.label}>
              Draft from survey/inspection
            </button>
          )}
          <button type="button" role="menuitem" style={{ ...item, ...(s.partsBusy ? { opacity: 0.6, cursor: "not-allowed" } : {}) }} disabled={s.partsBusy} onClick={() => { setOpen(false); s.exportPartsList(); }}
            title="Model numbers, descriptions and cost for every part — assemblies broken into their parts. For purchasing.">
            Parts list (CSV)
          </button>
          {s.loadedId && (
            <button type="button" role="menuitem" style={item} onClick={() => { setOpen(false); void s.openCutSheets(); }}>
              Cut sheets
            </button>
          )}
          {s.loadedId && (
            <div style={{ padding: "6px 12px", borderTop: "1px solid #3a3e46", marginTop: 4 }}>
              <DeleteQuoteButton id={s.loadedId} won={s.status === "won"} redirectTo="/estimator" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

`s.openCutSheets` is today's inline Cut sheets `onClick` body (save-first, open in a new tab) — move it into the hook as `const openCutSheets = async () => { … }` and return it.

- [ ] **Step 5: `estimator-header.tsx`** — move today's topbar (from `{/* contextual project toolbar */}` through the end of the `{qdOpen && ( … )}` Quote details panel) into `EstimatorHeader`, with these changes only:
  - Root `style`: add `flexWrap: "wrap"` and `rowGap: 10`; the right cluster (`est-topright`) gets `flexWrap: "wrap"`, `gap: 14`, and loses `flexShrink: 0`.
  - Remove from the right cluster: the status `<select>` (→ Send step, Task 7), `DeleteQuoteButton`, Draft from survey, Parts list, Cut sheets (→ ⋯ menu), and `Customer preview →`.
  - Remove `ChangeTypeControl` from the left cluster (→ ⋯ menu).
  - Keep: inline title rename, `{quoteId} · Rev {revNum}`, the Quote details chip + its panel (unchanged — the "drawer" in the spec is this same panel), Blended margin, Quoted total, a status pill (the coloured dot + the status label text, read-only), Save, `QuoteNextStep variant="toolbar"`, then `<HeaderMoreMenu s={s} />`.
  - `QuoteNextStep`'s `onSync` becomes `(r, action) => { s.applySync(r); if (r.ok) { s.setActionError(null); s.setGateRefused(false); onActed(action); } }`.
  - Signature: `export function EstimatorHeader({ s, onActed }: { s: EstimatorState; onActed: (action: NextStepAction) => void })`; destructure what it reads from `s` at the top.

- [ ] **Step 6: `estimator-banners.tsx`** — move the blocks from `{/* #284 — the next step's note` through the end of the `{/* #254 tier re-price banner` block verbatim into `EstimatorBanners({ s })`. The Daylite stage bar (`{/* Daylite stage bar (Task 6)`) is **not** moved here — Task 7 puts it on the Send step; leave it in the shell for now. The gate-refusal `QuoteNextStep` inside the banners keeps its current `onSync` (a one-argument callback is still valid).

- [ ] **Step 7: Rewrite the shell** `estimator-client.tsx`:

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { NextStepAction } from "@/lib/quote-next-step";
import { parseStep, stepAfterAction, stepSearch, type EstimateStep } from "@/lib/estimate-steps/steps";
import { estimateReadiness } from "@/lib/estimate-steps/readiness";
import type { EstimatorProps } from "./types";
import { useEstimatorState } from "./use-estimator-state";
import { CSS } from "./estimator-styles";
import { EstimatorHeader } from "./estimator-header";
import { EstimatorBanners } from "./estimator-banners";
import { StepTabs } from "./step-tabs";

/**
 * #305 (spec 2026-10-07 §4) — the Estimator shell: one header, four step
 * tabs (`?step=`), the banners, and the active step. All quote state lives in
 * useEstimatorState, so switching steps never drops unsaved edits.
 */
export default function EstimatorClient(props: EstimatorProps) {
  const s = useEstimatorState(props);
  const params = useSearchParams();
  const step: EstimateStep = s.phone ? "review" : parseStep(params.get("step"));
  const goStep = (next: EstimateStep) => {
    if (next === step) return;
    window.history.pushState(null, "", window.location.pathname + stepSearch(window.location.search, next));
  };
  const onActed = (action: NextStepAction) => {
    const to = stepAfterAction(action);
    if (to) goStep(to);
  };
  // The first save gives a new estimate its id — put it in the URL so a reload or a copied step link reopens it.
  useEffect(() => {
    if (!s.loadedId || params.get("id") === s.loadedId) return;
    window.history.replaceState(null, "", window.location.pathname + stepSearch(window.location.search, step, s.loadedId));
  }, [s.loadedId, params, step]);
  const badges = useMemo(
    () =>
      estimateReadiness({
        saved: !!s.loadedId,
        sections: s.sections,
        review: s.next ? { label: s.next.pill.label, tone: s.next.pill.tone } : null,
        status: s.status,
        revNum: s.revNum,
      }),
    [s.loadedId, s.sections, s.next, s.status, s.revNum]
  );

  return (
    <div className="est-root" style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa", overflow: "hidden" }}>
      <style>{CSS}</style>
      {!s.phone && (
        <>
          <EstimatorHeader s={s} onActed={onActed} />
          <StepTabs step={step} badges={badges} onStep={goStep} />
          <EstimatorBanners s={s} />
        </>
      )}
      {/* Task 7 renders the four steps here; until then keep today's build body + preview,
          switched on `step === "build"` / `step === "review"` instead of `mode`. */}
    </div>
  );
}
```

In the hook, delete the `mode` state and `isBuild`/`isPreview`; anything that called `setMode("preview")` goes away with the button. Until Task 7 lands, render today's body when `step !== "review"` and today's preview (phone approver control + `PreviewDoc` without `onBack`/`canBuild` edits) when `step === "review"`, so this task ships a working screen.

- [ ] **Step 8: Verify** — `npx tsc --noEmit`; `npm run lint` ≤ baseline; `npm run test:specs` → new #305 shell pins PASS, FAIL = 0 (if an older pin asserted the toolbar's `Customer preview →` or `setMode`, update that pin's expectation to the tab and note it in the commit message); `npx next build`.

- [ ] **Step 9: Commit**

```bash
git add src/app/\(app\)/estimator/ scripts/test-review-and-spec.ts
git commit -m "feat(estimator): #305 shell — header with ⋯ menu, four step tabs, URL-synced steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The four steps

**Files:**
- Create: `src/app/(app)/estimator/steps/build-step.tsx`, `package-step.tsx`, `review-step.tsx`, `send-step.tsx`, `src/app/(app)/estimator/review-cost-summary.tsx`
- Modify: `preview-doc.tsx`, `client-link-panel.tsx`, `package-staff-panel.tsx`, `estimator-client.tsx`
- Test: `scripts/test-review-and-spec.ts` (append; update the two preview-doc pins named below)

**Interfaces:**
- Consumes: `EstimatorState`; `SpecSection`; `systemItemsCost`, `systemFreight`, `systemSellTotal`, `systemMargin`, `fmt` (`./pricing`).
- Produces: `BuildStep({ s, onOpenNarrative }: { s: EstimatorState; onOpenNarrative: () => void })`, `PackageStep({ s }: { s: EstimatorState })`, `ReviewStep` and `SendStep` — each `({ s, onActed }: { s: EstimatorState; onActed: (a: NextStepAction) => void })`; `ReviewCostSummary({ sections, totals }: { sections: SpecSection[]; totals: QuoteTotals })`; `PdfOptionsPanel(p: PdfOptionsProps)`; `PdfPreviewPane(p: PdfPreviewProps)`; `ClientLinkPanel({ quoteId, withPackage })`; `PackageStaffPanel({ quoteId, section })`.

- [ ] **Step 1: Failing pins** — append:

```ts
/* #305 — every existing control has a home step. */
{
  const st = (f: string) => readFileSync(join(process.cwd(), "src/app/(app)/estimator/steps", f), "utf8");
  const build = st("build-step.tsx"), pkg = st("package-step.tsx"), review = st("review-step.tsx"), send = st("send-step.tsx");
  ok(build.includes("<SectionCard") && build.includes("<CurtainModal") && build.includes("<RewardCreditPanel") && build.includes("+ From library…") && !build.includes("<TasksCard"),
    "#305 steps: Build holds the systems sidebar, cards, modals and Rewards credit — not Tasks");
  ok(pkg.includes("<NarrativeColumn") && pkg.includes("<PdfOptionsPanel") && pkg.includes("<CoverPackagePanel") && pkg.includes('section="package"'),
    "#305 steps: Build package holds the narrative, Show-on-PDF options, cover and drawings/gaps");
  ok(review.includes("<PdfPreviewPane") && review.includes("<ReviewCostSummary") && review.includes('variant="panel"'),
    "#305 steps: Customer review holds the PDF, the cost summary and the review actions");
  ok(send.includes("<ClientLinkPanel") && send.includes("withPackage={false}") && send.includes('section="responses"') && send.includes("<TasksCard") && send.includes("changeStatus(") && send.includes("stageBarPipeline"),
    "#305 steps: Send & track holds status, the client link + revisions, responses, tasks and the pipeline");
  const staff = readFileSync(join(process.cwd(), "src/app/(app)/estimator/package-staff-panel.tsx"), "utf8");
  ok(/section = "all"/.test(staff) && /section !== "responses"/.test(staff) && /section !== "package"/.test(staff), "#305 steps: PackageStaffPanel can show only its package half or only responses");
  const link = readFileSync(join(process.cwd(), "src/app/(app)/estimator/client-link-panel.tsx"), "utf8");
  ok(/withPackage = true/.test(link) && /\{withPackage && <PackageStaffPanel quoteId=\{quoteId\} \/>\}/.test(link), "#305 steps: ClientLinkPanel can leave the package panel out");
}
```

- [ ] **Step 2: Run** — FAIL (files missing).

- [ ] **Step 3: `package-staff-panel.tsx`** — signature `export function PackageStaffPanel({ quoteId, section = "all" }: { quoteId: string; section?: "all" | "package" | "responses" })`. Wrap the gap chips, Drawings block, `noStorage` note, Rebuild button and its hint in `{section !== "responses" && (<>…</>)}`; wrap the `Client responses` label + list in `{section !== "package" && (<>…</>)}`. `note`/`err` stay unwrapped. Update the header comment: "#305: `section` lets the Package step show the package half and Send & track the responses."

- [ ] **Step 4: `client-link-panel.tsx`** — `export function ClientLinkPanel({ quoteId, withPackage = true }: { quoteId: string; withPackage?: boolean })`; the last line becomes `{withPackage && <PackageStaffPanel quoteId={quoteId} />}`.

- [ ] **Step 5: `preview-doc.tsx`** — split the default export into two named exports in the same file, moving JSX verbatim:
  - `PdfOptionsPanel(p: PdfOptionsProps)` — the `Show on PDF` block (Itemized/By section, Line detail, Cover note, Options, Itemized appendix, Terms, Cut sheets + its note, Payment terms select) and the `Systems` presentation toggles. `PdfOptionsProps` = `PreviewProps` minus `phone`, `canBuild`, `onBack`, `pdf`, `onPdf`, `onSave`, `saveDisabled`, `dirty`, `coverSummary`, `setCoverSummary`, `notIncluded`, `setNotIncluded`, `notIncludedDefault`.
  - `PdfPreviewPane(p: PdfPreviewProps)` — the phone "View only on phone" strip, the Save & update PDF / Save to create PDF button, Download PDF / Open PDF ↗ (or the disabled Download), and `<QuotePdfViewer …>`. `PdfPreviewProps = { phone: boolean; canBuild: boolean; savedQuoteId: string | null; pdf: QuotePdfView | null; onPdf: (v: QuotePdfView) => void; dirty: boolean; onSave: () => void; saveDisabled: boolean }`.
  - Remove `← Back to estimate`, the `CoverPackagePanel` and `ClientLinkPanel` mounts (they move to the Package / Send steps) and the default export.
  - Update the two pins that asserted the old mounts in this file (the `#301`/`#293` checks for `import { ClientLinkPanel } from "./client-link-panel";` and `{p.savedQuoteId && <ClientLinkPanel quoteId={p.savedQuoteId} />}`, and `prev.includes("<CoverPackagePanel")`): they now read `previewDocSource()`, so change their expected strings to the Send step's `<ClientLinkPanel quoteId={s.loadedId} withPackage={false} />` and the Package step's `<CoverPackagePanel`. Keep each pin's message, appending "(#305: moved to its step)".

- [ ] **Step 6: `review-cost-summary.tsx`**

```tsx
"use client";

import type { SpecSection } from "./types";
import { fmt, systemFreight, systemItemsCost, systemMargin, systemSellTotal, type QuoteTotals } from "./pricing";

/** #305 — Customer review's internal numbers (never on a customer document): cost, sell and margin per system. */
export function ReviewCostSummary({ sections, totals }: { sections: SpecSection[]; totals: QuoteTotals }) {
  const cell = { padding: "4px 6px", fontSize: 12, borderBottom: "1px solid #ececf0" } as const;
  const num = { ...cell, textAlign: "right" as const, fontFamily: "var(--font-mono)" };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Internal only</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#8c919c" }}>
            <th style={{ ...cell, textAlign: "left", fontWeight: 500 }}>System</th>
            <th style={{ ...num, fontWeight: 500 }}>Cost</th>
            <th style={{ ...num, fontWeight: 500 }}>Sell</th>
            <th style={{ ...num, fontWeight: 500 }}>Margin</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec) => (
            <tr key={sec.id}>
              <td style={cell}>{sec.name || "Untitled"}</td>
              <td style={num}>{fmt(systemItemsCost(sec) + systemFreight(sec))}</td>
              <td style={num}>{fmt(systemSellTotal(sec))}</td>
              <td style={num}>{(systemMargin(sec) * 100).toFixed(1)}%</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600 }}>
            <td style={cell}>Total</td>
            <td style={num}>{fmt(totals.cost + totals.fr)}</td>
            <td style={num}>{fmt(totals.grand)}</td>
            <td style={num}>{(totals.margin * 100).toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 6 }}>
        Material {fmt(totals.mat)} · Labor {fmt(totals.lab)} · Freight {fmt(totals.fr)}
      </div>
    </div>
  );
}
```

`QuoteTotals` (`pricing.ts:285`): `cost` excludes freight, so the Total row adds `fr` — matching the per-system rows, which are items cost + freight.

- [ ] **Step 7: `steps/build-step.tsx`** — `export function BuildStep({ s }: { s: EstimatorState })`; move verbatim from the shell: `{/* body */}` → the left sidebar **without** the Tasks block, `{/* main cards */}` (incl. `PortalPanel`, `SectionCard`s, + Add system, + From library…, `SystemLibraryModal`), and `{/* configurator modals */}` through `AiScopeModal`. **Drop the narrative `<aside>`** (both open and collapsed forms) — it moves to Package. The `SectionCard` prop that focuses the narrative (`setNarrFocusReq`/`showNarr` via the snippet click) now also calls `onOpenNarrative`: add a prop `onOpenNarrative: () => void` to `BuildStep` that the shell wires to `() => goStep("package")`, and call it where the snippet handler runs today (after `setActiveId`).

- [ ] **Step 8: `steps/package-step.tsx`**

```tsx
"use client";

import NarrativeColumn from "../narrative-column";
import { PdfOptionsPanel } from "../preview-doc";
import { CoverPackagePanel } from "../cover-package-panel";
import { PackageStaffPanel } from "../package-staff-panel";
import { PAYMENT_TERMS } from "../types";
import type { EstimatorState } from "../use-estimator-state";

/** #305 — Build package: what the client receives. Narrative for the picked system (left), output options (right). */
export function PackageStep({ s }: { s: EstimatorState }) {
  const sec = s.narrSec;
  return (
    <div className="est-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <nav aria-label="Systems" className="est-scroll" style={{ width: 220, flexShrink: 0, overflowY: "auto", background: "#fff", borderRight: "1px solid #ececf0", padding: "16px 10px" }}>
        {s.sections.map((x) => (
          <button key={x.id} type="button" onClick={() => s.setActiveId(x.id)} aria-current={sec?.id === x.id ? "true" : undefined}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", marginBottom: 2, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: sec?.id === x.id ? 600 : 500, background: sec?.id === x.id ? "var(--accent-soft, #eef3fc)" : "transparent", color: "#16181d" }}>
            {x.name || "Untitled"}
          </button>
        ))}
      </nav>
      <section aria-label="System narrative" className="est-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 24px", background: "#fff" }}>
        {sec ? (
          <NarrativeColumn key={sec.id} sec={sec} narrRef={s.narrRef} onChange={(fn) => s.updateSection(sec.id, fn)} library={s.kpLib}
            canWriteLibrary={s.canWriteNarrativeLibrary} intros={s.intros} onIntros={s.setIntros} quoteId={s.loadedId} customerId={s.customerId} />
        ) : (
          <div style={{ fontSize: 12, color: "#8c919c" }}>Add a system on the Build step to write its narrative.</div>
        )}
      </section>
      <aside className="est-scroll" style={{ width: 300, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: "18px", background: "#fff", borderLeft: "1px solid #ececf0" }}>
        <PdfOptionsPanel /* every prop PreviewDoc took for these controls, wired as the old <PreviewDoc> call did (sections, setSectionPresentation, detail, setDetail, pdf* flags, cutSheetCount, paymentTerms, paymentTermsOptions={PAYMENT_TERMS}, setPaymentTerms, togglePdf, savedQuoteId) */ />
        <CoverPackagePanel savedQuoteId={s.loadedId} canEdit dirty={s.pdfDirty} coverSummary={s.coverSummary} onCoverSummary={s.onCoverSummary}
          notIncluded={s.notIncluded} onNotIncluded={s.onNotIncluded} notIncludedDefault={s.notIncludedDefault} />
        {s.loadedId ? <PackageStaffPanel quoteId={s.loadedId} section="package" /> : <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate to add drawings.</div>}
      </aside>
    </div>
  );
}
```

Move the old `<PreviewDoc>` call's `togglePdf` arrow into the hook as `const togglePdf = (flag: PdfToggle) => { … }` (verbatim) and return it, so both the step and the pin at harness line ~46622 still find it. Replace the comment inside `<PdfOptionsPanel … />` with the actual props.

- [ ] **Step 9: `steps/review-step.tsx`** — `ReviewStep({ s, onActed }: { s: EstimatorState; onActed: (a: NextStepAction) => void })`, a flex row:
  - **Main area:** `<PdfPreviewPane phone={s.phone} canBuild={!s.phone} savedQuoteId={s.loadedId} pdf={s.pdf} onPdf={s.setPdf} dirty={s.pdfDirty} onSave={s.doSave} saveDisabled={s.statusChanging || s.tierResolving} />`.
  - **Right `aside`** (desktop only — `{!s.phone && …}`; width 320, `overflowY: "auto"`, white, `borderLeft: "1px solid #ececf0"`, padding 18, gap 18):
    - `{s.loadedId && s.next && <QuoteNextStep quoteId={s.loadedId} view={s.next} variant="panel" savedOnly={s.pdfDirty} disabled={s.statusChanging || s.tierResolving} beforeAction={s.pdfDirty ? s.saveNow : undefined} onSync={(r, action) => { s.applySync(r); if (r.ok) { s.setActionError(null); s.setGateRefused(false); onActed(action); } }} onError={(m) => { s.setActionError(m); s.setGateRefused(false); }} />}`
    - `<ReviewCostSummary sections={s.sections} totals={s.t} />`
  - **Phone:** above the pane, the block moved verbatim from today's preview — `{s.phone && s.loadedId && s.next?.approverMode && (<div style={{ padding: "10px 14px", borderBottom: "1px solid #e4e7ec", background: "#fff" }}><QuoteNextStep quoteId={s.loadedId} view={s.next} variant="panel" approverOnly onSync={…same as today…} /></div>)}`.

- [ ] **Step 10: `steps/send-step.tsx`** — `SendStep({ s, onActed })`, one scrolling column (max-width 880, centred) of cards, moved verbatim:
  1. **Status** — the status dot + `<select value={s.status} onChange={(e) => s.changeStatus(e.target.value as QuoteStatus)}>` (restyled light: `border: "1px solid #dfe2e8"`), and `QuoteNextStep variant="panel"` wired exactly as in the Review step.
  2. **Pipeline** — the `{/* Daylite stage bar (Task 6)` block from the shell (uses `showStageBar`, `stageBarPipeline`, `stageBarCurIdx`, `stageBarLostLabel`, `changeStage`, …), unchanged.
  3. **Client link** — `{s.loadedId ? <ClientLinkPanel quoteId={s.loadedId} withPackage={false} /> : "Save the estimate first."}` then `{s.loadedId && <PackageStaffPanel quoteId={s.loadedId} section="responses" />}`.
  4. **Tasks** — the sidebar's Tasks block (`ApplyTemplateControl` + `TasksCard`, "Save the quote to add tasks." fallback), unchanged.

- [ ] **Step 11: Wire the shell** — replace the Task 6 placeholder with:

```tsx
{step === "build" && <BuildStep s={s} onOpenNarrative={() => goStep("package")} />}
{step === "package" && <PackageStep s={s} />}
{step === "review" && <ReviewStep s={s} onActed={onActed} />}
{step === "send" && <SendStep s={s} onActed={onActed} />}
```

and delete the old build body / preview JSX and the stage bar from the shell. `PreviewDoc`'s default import goes away.

- [ ] **Step 12: Verify** — `npx tsc --noEmit`; `npm run lint` ≤ baseline; `npm run test:specs` → PASS = previous + 6, FAIL = 0; `npx next build`.

- [ ] **Step 13: Commit**

```bash
git add src/app/\(app\)/estimator/ scripts/test-review-and-spec.ts
git commit -m "feat(estimator): #305 Build · Build package · Customer review · Send & track steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Diagnose "after Send the Estimator goes to Home" (PUNCHLIST #301 open item 12)

Use **superpowers:systematic-debugging**. The cause is not known yet; do not guess-fix.

**Files:** determined by the diagnosis; test in `scripts/test-review-and-spec.ts`.

- [ ] **Step 1: Reproduce** on a scratch datadir (memory `peak-exercising-post-routes-safely`; the worktree's `.claude/launch.json` entry per memory `peak-preview-start-reads-main-checkout-launch-json` — never the `peak-app` entry, which opens the real dev DB). Seed via `npm run db:seed` against the scratch `PGLITE_PATH`. Open `/estimator?id=Q-2041`, go to Send & track, press **Send to customer →**. Record the URL and network requests before/after (`read_network_requests`, `read_console_messages`).
- [ ] **Step 2: Reproduce on `origin/main`'s code** too (check out `origin/main` in a second scratch worktree, or `git stash`-free: `git worktree add ../tmp-main origin/main`) to learn whether Phase 1 already changed the behaviour.
- [ ] **Step 3: Find the cause.** Candidates to check, in order: a `redirect()` / `router.push` reached from `nsSendAction` → `sendQuoteToCustomer` → `setStatus`; `revalidatePath("/", "layout")` re-rendering a URL that has no `?id=` (an estimate created in the same tab before this phase never got `?id=` — Task 6's `replaceState` may already fix it); the `DeleteQuoteButton`'s `redirectTo`; a layout-level redirect on status change.
- [ ] **Step 4: Fix at the cause + pin it** (a harness `ok(…)` naming the mechanism). If Task 6 already fixed it, add the pin proving why (e.g. the `replaceState` pin) and say so in the report.
- [ ] **Step 5: Verify** — the repro now stays on `?step=send`; gates as before.
- [ ] **Step 6: Commit** — `fix(estimator): #305 Send stays on Send & track (cause: …)`.

---

### Task 9: Smoke routes, browser verification, docs

**Files:**
- Modify: `scripts/smoke-routes.ts`, `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: Smoke routes** — after `{ route: "/estimator?id=Q-2041" },` add:

```ts
  { route: "/estimator?id=Q-2041&step=package" },
  { route: "/estimator?id=Q-2041&step=review" },
  { route: "/estimator?id=Q-2041&step=send" },
  { route: "/estimator?id=Q-2041&step=bogus" },
```

Run `npm run test:smoke` (stop any dev server first — memory `peak-worktree-dev-server-browser-verification-traps`). Expected: all routes pass.

- [ ] **Step 2: Browser verification** on the scratch datadir, desktop 1280 px, then 1024 px, then 375 px:
  - every control from spec §4.3 is reachable on its step (tick each row);
  - edit a line on Build → switch to Package → Review → back to Build: the edit is still there, "Unsaved changes" shows in Review; Save; the PDF re-renders;
  - browser Back moves between steps;
  - a brand-new estimate: Save → URL gains `?id=`; reload keeps the step;
  - readiness lines change as you add an empty system / fill it;
  - Submit for approval → lands on Customer review; Send → stays on Send & track;
  - header at 1024 px wraps, nothing clipped; ⋯ menu opens/closes (click outside, Escape);
  - 375 px → Review only, "View only on phone", approver control present for an approver.
  Screenshot each step at 1280 px for the report.

- [ ] **Step 3: Docs** (recompute numbers from `origin/main` first):
  - `DECISIONS.md` — D643 four steps on one URL (`?step=`, pushState, Build canonical); D644 state hook moved verbatim, UI-state split deferred; D645 readiness rules + never blocking; D646 the ⋯ menu contents and the status select moving to Send & track; D647 next-step navigation map (and the Send→Home cause from Task 8).
  - `PUNCHLIST.md` — `## 304. Estimator in four steps — Phase 1 (the frame) — DONE <date> (D643–D647)`: reported by Jeff 2026-10-07 ("one window is trying to handle too much"), what shipped, the spec + plan paths, the six-phase roadmap with Phases 2–6 open, Jeff-gated: Phase 6 typical items per category. Mark #301's open item 12 resolved.
  - `AGENTS.md` — a new phase-status entry `42. 🚧 **Estimator in four steps** (#305, D643–D647)` summarising Phase 1 and listing Phases 2–6 as next.
- [ ] **Step 4: Final gates** — tsc, test:specs (report PASS/FAIL vs Task 0 baseline), lint vs baseline, `next build`, test:smoke.
- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-routes.ts DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs: #305 Estimator in four steps — Phase 1 (D643–D647)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then: superpowers:finishing-a-development-branch (Jeff merges/pushes; never instant-rollback past a migration — this phase has none).
