# AI Layer Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the four remaining model-backed features (thread summary, customer summary, import extraction, assistant Q&A) and the whole `src/lib/ai/` layer, per the approved design `docs/superpowers/specs/2026-07-19-ai-removal-design.md` — Peak becomes fully deterministic, zero model calls, no `ANTHROPIC_API_KEY` anywhere.

**Architecture:** Leaf-first removal. First rescue the one shared type (`DraftedLine`) out of `@/lib/ai/features` so the D86 rules-based estimator keeps compiling, then strip each consumer surface (inbox, import, assistant+nav), then delete `src/lib/ai/` last, then close the docs. No DB/schema work — the AI layer never persisted anything.

**Tech Stack:** Next.js 16 App Router / TypeScript strict / no test runner (repo convention: `npx tsc --noEmit` + `npm run build` as typecheck + browser-driven verification).

## Global Constraints

- **Decision number: D89** (D88 = pricing tiers is the current latest in DECISIONS.md).
- Commits are **LOCAL ONLY** — no push (no PAT on this machine; Jeff pushes via GitHub Desktop). Commit style: `AI removal: <area> (D89)`.
- Do NOT run `npm run db:reset-local` — Jeff's dev `.data/` holds his live testing records.
- **Deliberately untouched** (spec): renewal outreach D75 (`lib/renewal-outreach.ts` + `/templates` wording), the D86 deterministic `draftQuoteScopeAction` path, all `/templates` content, the DB.
- The D86 rules-based scope flow must behave **identically** after the type rescue. Renaming `ai-scope-modal.tsx` is NOT in scope.
- Line numbers below were verified against the tree on 2026-07-19 (working tree clean at `62d3a4b`). If drift is found, match on the quoted code, not the number.

---

### Task 1: Estimator type rescue (no behavior change)

**Files:**
- Modify: `src/app/(app)/estimator/ai-scope-modal.tsx:3`
- Modify: `src/app/(app)/estimator/estimator-client.tsx:19`
- Modify: `src/app/(app)/estimator/actions.ts:20`

**Interfaces:**
- Produces: `export type DraftedLine = { description: string; qty: number; unit: string }` exported from `ai-scope-modal.tsx`, consumed by `estimator-client.tsx` and `estimator/actions.ts`. After this task nothing in `src/app/(app)/estimator/` imports from `@/lib/ai/*`.

- [ ] **Step 1: Define `DraftedLine` in its primary consumer**

In `src/app/(app)/estimator/ai-scope-modal.tsx`, replace line 3:

```ts
import type { DraftedLine } from "@/lib/ai/features";
```

with (keep the `./est-ui` import line below it unchanged):

```ts
/** A drafted quote line (description / qty / unit — never a price, D6 guardrail).
 *  Lived in lib/ai/features until D89 removed the AI layer; the rules-based
 *  scope flow (S12/D86) is the only producer now. */
export type DraftedLine = { description: string; qty: number; unit: string };
```

This is byte-identical to the old definition (`lib/ai/features.ts:152`).

- [ ] **Step 2: Repoint the two other importers**

`src/app/(app)/estimator/estimator-client.tsx:19` — replace:

```ts
import type { DraftedLine } from "@/lib/ai/features";
```

with:

```ts
import type { DraftedLine } from "./ai-scope-modal";
```

`src/app/(app)/estimator/actions.ts:20` — same replacement. (`actions.ts` is `"use server"` importing from a `"use client"` file, but `import type` is fully erased at compile time — no runtime module edge is created. If `next build` ever complains anyway, fall back to a tiny `src/app/(app)/estimator/types-drafted.ts` holding the type, per the spec.)

- [ ] **Step 3: Typecheck**

Run: `cd /Users/sm/Downloads/peak-app && npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/estimator"
git commit -m "AI removal: DraftedLine moved into the estimator; lib/ai import severed (D89)"
```

---

### Task 2: Inbox — delete thread/customer summaries

**Files:**
- Modify: `src/app/(app)/inbox/actions.ts` (delete lines 320–447 = the `/* ---- AI summaries (D2) ... ---- */` section through end of file, plus orphaned imports)
- Modify: `src/app/(app)/inbox/thread-reader.tsx`
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:65,80,575,615`
- Modify: `src/app/(app)/inbox/page.tsx:52,629`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `summarizeThreadAction` / `summarizeCustomerAction` no longer exist; `ThreadReader` and `InboxShell` no longer accept an `aiEnabled` prop.

- [ ] **Step 1: Delete the two server actions**

In `src/app/(app)/inbox/actions.ts`, delete everything from line 320 (`/* ---- AI summaries (D2) — read-only; never sends, writes, or revalidates ---- */`) to the end of the file (line 447). That removes the `SummaryResult` type, `summarizeThreadAction`, and `summarizeCustomerAction`.

- [ ] **Step 2: Remove the imports that are now orphaned**

Still in `actions.ts`, in the import block (lines 1–55):

- Delete outright: `import { aiEnabled } from "@/lib/ai/config";` and `import { summarizeThread, summarizeCustomer } from "@/lib/ai/features";` (lines 54–55).
- Delete `import { getAll as getAllRepairJobs } from "@/lib/stores/repair-jobs";` (whole line — sole use was the customer summary).
- From the `@/lib/stores/comms` import: remove `byCustomer`, `statusMeta`, `timeAgo`, `timeFull` (keep `get as getThread` — it has another caller in this file).
- From `@/lib/stores/customers`: remove `get as getCustomer`, keep `nameFor` (3 remaining uses).
- From `@/lib/stores/quotes`: remove `getAll as getAllQuotes` and `STAGE_LABEL`; keep `byRenewalOf`, `setStatus as setQuoteStatus`.
- From `@/lib/stores/flame-jobs`: remove `getAll as getAllFlameJobs`, `renewalStatus`, `RENEWAL_META`; keep `get as getFlameJob`, `setRenewalOutreach as setFlameRenewalOutreach`.

Verify nothing else broke: `npx tsc --noEmit` should only complain (if at all) about the thread-reader usages fixed next.

- [ ] **Step 3: Strip the reader UI**

In `src/app/(app)/inbox/thread-reader.tsx`:

1. Imports (lines 14–15): remove `summarizeCustomerAction,` and `summarizeThreadAction,` from the `./actions` import.
2. Props (lines 39, 47–48): remove `aiEnabled,` from the destructuring and the two prop-type lines:
   ```ts
   /** D2 — when true, render the read-only AI Summary affordance */
   aiEnabled?: boolean;
   ```
3. State (lines 74–77): delete all four summary hooks:
   ```ts
   const [summarizing, startSummary] = useTransition();
   const [summary, setSummary] = useState<string | null>(null);
   const [summaryErr, setSummaryErr] = useState<string | null>(null);
   const [summaryKind, setSummaryKind] = useState<"thread" | "customer" | null>(null);
   ```
   Then check whether `useTransition` is still used elsewhere in the file; if not, drop it from the React import.
4. Handlers (~lines 167–189): delete `runThreadSummary` and `runCustomerSummary` entirely.
5. The summary panel (lines 565–705): delete the whole block starting at
   ```tsx
   {/* AI summary (D2) — read-only convenience for the person about to reply */}
   {aiEnabled && (
   ```
   through its closing `)}` — the next surviving line is `{/* conversation */}`.
6. KEEP `ACCENT_SOFT` / `ACCENT_INK` (lines 21–22) — still used at lines ~449–451 and ~754.

- [ ] **Step 4: Unthread the prop**

- `src/app/(app)/inbox/inbox-shell.tsx`: remove `aiEnabled,` (line 65), `aiEnabled: boolean;` (line 80), and the two `aiEnabled={aiEnabled}` passes to `<ThreadReader>` (lines 575 and 615).
- `src/app/(app)/inbox/page.tsx`: remove `import { aiEnabled } from "@/lib/ai/config";` (line 52) and `aiEnabled={aiEnabled()}` (line 629).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/inbox"
git commit -m "AI removal: inbox thread/customer summaries deleted (D89)"
```

---

### Task 3: Import — delete paste extraction

**Files:**
- Modify: `src/app/(app)/import/actions.ts` (delete `extractRowsAction`, lines ~42–79, + imports at 9–10)
- Modify: `src/app/(app)/import/controls.tsx`
- Modify: `src/app/(app)/import/page.tsx:7,523,663`

**Interfaces:**
- Produces: `extractRowsAction` no longer exists; `PastePreview` no longer accepts `aiEnabled`. The CSV path (`importRecords`) is untouched.

- [ ] **Step 1: Delete the server action**

In `src/app/(app)/import/actions.ts`:
- Delete `extractRowsAction` and its doc comment — everything from `/** * AI extraction (Phase 8, D3): ...` (line ~42) to the end of the function (line ~79 / end of file).
- Delete imports at lines 9–10: `import { aiEnabled } from "@/lib/ai/config";` and `import { extractRows } from "@/lib/ai/features";`.
- `getTypeMeta` keeps its other caller (`importRecords`); `parseCsv`/`autoMap`/`prepareRows`/`commitImport` are all still used. Nothing else changes.

- [ ] **Step 2: Strip the paste-extract UI**

In `src/app/(app)/import/controls.tsx`:

1. Line 5: `import { importRecords, extractRowsAction } from "./actions";` → `import { importRecords } from "./actions";`
2. Props: remove `aiEnabled = false,` (line 18) and `aiEnabled?: boolean;` (line 24).
3. State (lines 28–29): delete `const [aiBusy, setAiBusy] = useState(false);` and `const [aiError, setAiError] = useState("");`.
4. Delete `runExtract` and its doc comment (lines ~31–59, starting `/** * Extract-with-AI (D3): send the messy pasted text...`).
5. Delete the button block (lines 124–177): from `{/* Extract with AI (D3) — only when the gate is on and there's text to work on */}` / `{aiEnabled && trimmed && (` through its closing `)}`.
6. Delete the `{aiError && (...)}` error block immediately after it (lines ~178–192; the next surviving line is `{/* stats */}`).
7. Delete the now-dead `rowsToCsv` helper (line ~418) and its doc comment — its only caller was `runExtract`.

- [ ] **Step 3: Unthread the prop**

In `src/app/(app)/import/page.tsx`: remove `import { aiEnabled } from "@/lib/ai/config";` (line 7), `const aiOn = aiEnabled();` (line 523), and `aiEnabled={aiOn}` on the `<PastePreview>` (line 663).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/import"
git commit -m "AI removal: import paste-extraction deleted, CSV flow untouched (D89)"
```

---

### Task 4: Assistant module + nav entry

**Files:**
- Delete: `src/app/(app)/assistant/` (all four files: `page.tsx`, `assistant-client.tsx`, `actions.ts`, `snapshot.ts`)
- Modify: `src/components/nav/nav-data.ts:75-90,98`
- Modify: `src/components/nav/Nav.tsx:7-13,53,64,68`
- Modify: `src/app/(app)/layout.tsx:7,48`

**Interfaces:**
- Produces: `navEntries()` and `ASSISTANT_NAV` no longer exist — `Nav.tsx` consumes the exported `NAV` const directly; `Nav` no longer accepts `aiEnabled`.

- [ ] **Step 1: Delete the assistant route**

```bash
git rm -r "src/app/(app)/assistant"
```

- [ ] **Step 2: Clean nav-data.ts**

In `src/components/nav/nav-data.ts`:

1. Delete lines 75–90 — the doc comment, `ASSISTANT_NAV`, and the whole `navEntries()` function (its only job was inserting the Assistant entry when enabled).
2. Delete the route mapping at line 98: `"/assistant": "assistant",`.

- [ ] **Step 3: Clean Nav.tsx**

In `src/components/nav/Nav.tsx`:

1. Import block (lines 7–13): replace `navEntries,` with `NAV,`:
   ```ts
   import {
     NAV,
     activeKeyFor,
     parentGroupOf,
     type NavCounts,
     type BellGroup,
   } from "./nav-data";
   ```
2. Remove `aiEnabled = false,` (line 53) and `aiEnabled?: boolean;` (line 64) from the props.
3. Delete line 68: `const NAV = navEntries(aiEnabled);` — the imported `NAV` takes over; every later reference in the component reads it unchanged.

- [ ] **Step 4: Clean layout.tsx**

In `src/app/(app)/layout.tsx`: remove `import { aiEnabled } from "@/lib/ai/config";` (line 7) and `aiEnabled={aiEnabled()}` from the `<Nav ...>` props (line 48).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)" src/components/nav
git commit -m "AI removal: assistant module + nav entry deleted (D89)"
```

---

### Task 5: Delete `src/lib/ai/` and verify the removal

**Files:**
- Delete: `src/lib/ai/` (all three files: `client.ts`, `config.ts`, `features.ts`)

- [ ] **Step 1: Delete the layer**

```bash
git rm -r src/lib/ai
```

- [ ] **Step 2: Zero-hit greps (spec §Verification)**

```bash
grep -rn "lib/ai" src/; grep -rn "aiEnabled" src/; grep -rn "ANTHROPIC" src/
grep -rn "summarizeThread\|summarizeCustomer\|extractRows\|askAction" src/
```

Expected: every grep returns nothing (exit 1). If any hit survives, fix it before proceeding.

- [ ] **Step 3: Full build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean. (The build runs `scripts/migrate.mjs` first — normal, it's the repo's standard build.)

- [ ] **Step 4: Browser pass**

Start the dev server (launch config `peak-app`, port 3000; do NOT reset the local DB) and check:
- Nav: no Assistant entry, no gap after Inbox; `/assistant` returns 404.
- Inbox → open a thread: reader renders with **no** Summary buttons; reply composer, archive, assign all intact.
- Import → paste step: textarea + preview + confirm flow intact; no "Extract with AI" affordance.
- Estimator → open the scope modal from a linked survey/inspection: D86 rules-based draft appears exactly as before.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "AI removal: lib/ai deleted — app is fully deterministic (D89)"
```

---

### Task 6: Docs close-out + D89

**Files:**
- Modify: `MASTER-HOWTO.md:181-221` (§6) and the §7 cross-reference at lines 239–241
- Modify: `PUNCHLIST.md:222` (item 4 header) and its `**Status:** OPEN (long-term)` line (~252)
- Modify: `DECISIONS.md` (append D89)
- Modify: `MASTER-QUESTIONS.md:153-167` (§D)
- Modify: `AGENTS.md:135-137` (phase 8 line)

- [ ] **Step 1: MASTER-HOWTO.md**

Replace the whole of `## 6. AI features ✅ *(Phase 8 — built; flip on when you're ready)*` (lines 181–221, everything up to but not including `## 7. Real data migration & go-live`) with:

```markdown
## 6. AI features — removed (2026-07-19, D89)

The model-backed features (summaries, import extraction, assistant Q&A) were
removed per `docs/superpowers/specs/2026-07-19-ai-removal-design.md` — the app
is fully deterministic and needs no `ANTHROPIC_API_KEY`. Recover via git history.
```

Also in §7 step 2 (lines ~239–241), delete the sentence `If AI is on (§6), the paste box also turns *messy* text — an emailed price list, a copied table — into clean rows for you.` (keep the rest of the step).

- [ ] **Step 2: PUNCHLIST.md item 4**

Change the header (line 222) from `## 4. Claude API integration — OPEN (long-term / deferred)` to `## 4. Claude API integration — RESOLVED by removal (D89)`, and replace the `**Status:** OPEN (long-term)` line with:

```markdown
**Status:** RESOLVED by removal 2026-07-19 (**D89**) — the four remaining AI features and
the whole `src/lib/ai/` layer were deleted per
`docs/superpowers/specs/2026-07-19-ai-removal-design.md`. Supersedes the "revisit when
rules hit their ceiling" posture above; a future return would be a fresh build, not a
re-enable. Recover via git history.
```

- [ ] **Step 3: DECISIONS.md**

Append after D88 (keep the file's existing entry style):

```markdown
- **D89. Full AI layer removal** (spec
  `docs/superpowers/specs/2026-07-19-ai-removal-design.md`, closes punch item 4). The four
  inert model-backed features — thread summary, customer summary, import extraction,
  assistant Q&A — plus `src/lib/ai/` and the Assistant nav entry are deleted; `DraftedLine`
  now lives in `estimator/ai-scope-modal.tsx`. Zero model calls remain; no
  `ANTHROPIC_API_KEY` needed anywhere. Untouched: renewal outreach (D75), rules-based scope
  drafting (D86), `/templates`, the DB (the layer never persisted anything). Rollback =
  revert the D89 commit series. Verified: zero-hit greps (`lib/ai`, `aiEnabled`,
  `ANTHROPIC`, feature fns), tsc + build clean, browser pass (inbox/import/estimator/nav,
  `/assistant` 404s).
```

- [ ] **Step 4: MASTER-QUESTIONS.md §D + AGENTS.md**

- `MASTER-QUESTIONS.md` line 153: retitle `## D. AI features (Phase 8 — built, awaits Anthropic API key)` to `## D. AI features (removed 2026-07-19, D89 — historical)` and add one line under it: `Removed per docs/superpowers/specs/2026-07-19-ai-removal-design.md; the questions below are historical.` Leave D7's text in place (historical).
- `AGENTS.md` phase list (lines 135–137): annotate the phase-8 line, e.g. append ` **(removed 2026-07-19, D89 — the app is fully deterministic; renewal drafts and scope assembly are rules-based, D75/D86.)**` and strike/adjust the `ANTHROPIC_API_KEY` sentence to match.

- [ ] **Step 5: Commit**

```bash
git add MASTER-HOWTO.md PUNCHLIST.md DECISIONS.md MASTER-QUESTIONS.md AGENTS.md
git commit -m "AI removal: docs closed out — punch item 4 resolved (D89)"
```
