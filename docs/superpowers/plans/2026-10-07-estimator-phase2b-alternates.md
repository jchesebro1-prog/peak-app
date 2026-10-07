# Estimator — Phase 2b (In total / Alternate groups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A system group can be switched to **Alternate** — its systems are priced separately, kept out of the estimate total everywhere, and shown to the customer as alternates they can choose.

**Architecture:** One derived stamp, `SpecSection.alternate?: true`, set and cleared by `normalizeSystemOrder` (already run on every mutation, load, save and PDF load). Money code (`totals()`, the Rewards credit pin, the approval fingerprint) and every consumer that skips `option` lines read `sec.alternate`. Outputs (estimate PDF, cover, package page, scope picker) split In-total systems from Alternates through small pure helpers.

**Tech Stack:** Next.js 16, React 19, TypeScript; spec harness `scripts/test-review-and-spec.ts` (`ok(cond, msg)`, render helpers such as `qd293Props` in `scripts/qd293-cases.ts`).

**Spec:** `docs/superpowers/specs/2026-10-07-estimator-four-steps-design.md` §9 (and §8 for groups).

## Global Constraints

- Stamp: `alternate?: true` on a section ⇔ its `groupId` names a group with `alternate: true`; otherwise the key is absent (never `false`). Only `normalizeSystemOrder` writes it; `withoutGroupMeta` and `sanitizeSectionGroupMeta` remove it.
- `QuoteTotals.alt?: number` = Σ `systemSellTotal(sec)` over alternate sections; never part of `rev`, `cost`, `mat`, `lab`, `fr`, `adj`, `tax` or `grand`. A Rewards credit line inside an alternate section still counts toward `credit`.
- Rewards credit pins to the last section without `alternate` (fallback: the last section).
- Approval fingerprint (`linesKeyOf`) includes `sec.alternate`.
- Excluded like `option` lines: `review-limits` labor check, dashboard `equipmentSold`, manufacturer analytics, `specs/quote-bom`, estimator `parts-csv`, curtain cut sheets (skip as optional). Unchanged: key-product eligibility (`narrative.ts`), portal pricing/quotes.
- Copy (exact): toggle `In total` / `Alternate`; heading suffix `Alternate · not in total`; sidebar row `Alternates (not in total)`; PDF block title `Alternates` with sub-line `Priced separately — not included in the total`; band numbers `A1`, `A2`…; header count `· N alternate` / `· N alternates`; cover/package list title `Alternates`; scope-picker label `Alternate — <group name>: <system name>`.
- Cover R1 invariant holds: Σ In-total scope prices − credit = grand (tax 0).
- Scope picker: alternate choices unchecked by default.
- Existing quotes (no alternate groups) must load, save, total and print exactly as before.
- Gates per task: `npx tsc --noEmit` 0; scoped eslint clean (`npx eslint "src/app/(app)/estimator" src/lib/estimate-groups src/lib/estimate-output src/lib/rewards src/lib/quote-pdf src/components/estimate-output "src/app/share" src/lib/dashboard src/lib/specs src/lib/curtain-cut-sheets` + any other touched dir; never `npm run lint`); `npm run test:specs` FAIL 0 (report PASS); `npx next build` on tasks touching client components. Never `git stash`; never touch `.data/`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Punch/decision numbers assigned in Task 6.

---

### Task 1: Stamp + money core

**Files:** `src/lib/estimate-groups/groups.ts`, `src/app/(app)/estimator/types.ts`, `src/app/(app)/estimator/pricing.ts` (`QuoteTotals`, `totals()`), `src/lib/rewards/credit-line.ts` (`withRewardCredit`), `src/lib/approval-snapshot.ts` (`linesKeyOf`); harness block `#P2b core`.

**Interfaces:** Produces `SpecSection.alternate?: true`; `QuoteTotals.alt?: number`; `normalizeSystemOrder` stamps; `withRewardCredit` pins to last In-total section.

- [ ] **Step 1: Failing tests** (behaviour, at the END of the harness):
  - normalize stamps `alternate: true` on sections of an alternate group, removes a stale `alternate` from an ungrouped / in-total section, keeps same-reference when already correct, and re-stamps after a group's flag flips;
  - `withoutGroupMeta` / `sanitizeSectionGroupMeta` drop `alternate`;
  - `totals()`: a quote with one In-total system ($1,000 sell) and one alternate system ($500 sell, with freight and a sell override) → `grand` = in-total only, `alt` = 500 (= `systemSellTotal` of the alternate), `fr`/`mat`/`lab`/`rev`/`cost` exclude the alternate; a credit line placed on an alternate section still reduces `grand`; with no alternates every field equals the pre-change result (compare against a fixture computed before your change — hard-code the expected numbers);
  - `withRewardCredit` places the credit on the last non-alternate section; all-alternate → last section;
  - `linesKeyOf` differs when only a section's `alternate` differs.
- [ ] **Step 2:** RED. **Step 3:** implement (in `normalizeSystemOrder`, compute stamps after ordering; return the same reference only when order AND stamps are unchanged). **Step 4:** gates. **Step 5:** commit `feat(estimator): Phase 2b alternate stamp, totals.alt, credit pin and approval fingerprint`.

---

### Task 2: Consumers that skip option lines

**Files:** `src/lib/review-limits.ts` (~147), `src/lib/dashboard/metrics.ts` (~118–148, add `alternate?` to its `SpecLike`), `src/lib/manufacturer-analytics.ts` (~86), `src/lib/specs/quote-bom.ts` (~76), `src/app/(app)/estimator/parts-csv.ts` (~88), `src/lib/curtain-cut-sheets/estimator-curtains.ts` (~110, push to `skippedOptional`); harness block `#P2b consumers`.

- [ ] **Step 1: Failing tests:** one behaviour test per consumer with a fixture where the only difference is an alternate section — the alternate's lines are excluded exactly like `option` lines (use each module's existing exported function; follow the existing tests for that module in the harness for fixture shape).
- [ ] **Steps 2–5:** RED → implement (`if (it.option || sec.alternate)` style, or skip the section) → gates → commit `feat(estimator): Phase 2b alternates excluded wherever option lines are`.

---

### Task 3: Build UI — the switch, sidebar row, review table

**Files:** `use-estimator-state.ts` (new `setGroupAlternateAction(id, alternate)` — updates `groups` AND runs `reorderSections(normalizeSystemOrder(sections, next))` like `moveGroupByAction`, so stamps apply at once), `src/lib/estimate-groups/groups.ts` (pure `setGroupAlternate(groups, id, alternate)` — same reference when unchanged), `steps/build-step.tsx` (rail heading + card divider toggle; Cost breakdown row), `review-cost-summary.tsx`; harness block `#P2b build UI`.

- [ ] **Step 1: Failing tests:** `setGroupAlternate` behaviour; pins for the hook action, the toggle in both places (exact copy), the `Alternate · not in total` heading suffix, the sidebar row (shown only when `t.alt > 0`), and ReviewCostSummary rendering alternate systems below the Total under `Alternates (not in total)` while the In-total rows still sum to the Total (behaviour test with `renderToStaticMarkup` if the harness already renders components; else source pins + a pure helper `splitForReview(sections)` tested).
- [ ] **Steps 2–5:** RED → implement (toggle = two small segmented buttons `In total` | `Alternate`, accent on the active one, `aria-pressed`) → gates incl. build → commit `feat(estimator): Phase 2b In total / Alternate switch on groups`.

---

### Task 4: Estimate PDF + online view

**Files:** `quote-document.tsx`, `quote-document-view.ts` (helpers), harness block `#P2b document` (use `qd293Props` / existing render tests as the pattern).

- [ ] **Step 1: Failing tests:** pure `alternateGroupsForPrint(sections, groups)` → `Array<{ group: SystemGroup; subtotal: number; sections: S[] }>` (only alternate groups with ≥1 printed system, document order); `printedGroupHeadings` and the body `previewSections` exclude alternates (numbering 1..n over In-total systems only); render tests: the Alternates block (title, sub-line, group heading + subtotal, bands `A1`…), header count, totals unchanged vs a no-alternates render of the same In-total systems; appendix excludes alternates; a quote with no alternates renders byte-identical to before (compare against a render of the pre-change markup captured in the test via the same props with `groups: []`).
- [ ] **Steps 2–5:** RED → implement (Alternates block after the bands, before the Optional additions box; each alternate system renders like a body band — narrative or itemized per its `presentation`, reuse the band rendering code by extracting a small inner component rather than duplicating JSX) → gates incl. build → commit `feat(estimator): Phase 2b Alternates block on the estimate PDF and online view`.

---

### Task 5: Cover, package page, scope picker

**Files:** `src/lib/estimate-output/scopes.ts` (`outputScopes` excludes alternates; new `alternateScopes(p)` → `Array<{ groupId; name; price; systems: Array<{ id; name; price }> }>`), `src/lib/estimate-output/cover.ts` + `src/components/estimate-output/cover-document.tsx` (Alternates list), `src/lib/estimate-output/package-model.ts` + `src/components/estimate-output/package-view.tsx` (Alternates card), `src/lib/estimate-output/responses.ts` (`responseScopes` returns In-total scopes plus alternate systems flagged `alternate: true` with label `Alternate — <group>: <system>`), `src/app/share/quote/[id]/[token]/scope-selection.tsx` (alternates unchecked by default; total adds ticked ones), `responses-server.ts` (validation unchanged — verify); harness block `#P2b outputs`.

- [ ] **Step 1: Failing tests:** R1 holds with alternates present; `alternateScopes` shape/order/prices; cover and package model include alternates only when present (no-alternates output unchanged); `responseScopes` order (In-total first, then alternates) and flags; scope-selection default state excludes alternates (pure helper `defaultSelectedScopeIds(scopes)` tested); server accepts a submitted alternate id and rejects an unknown id.
- [ ] **Steps 2–5:** RED → implement → gates incl. build → commit `feat(estimator): Phase 2b alternates on the cover, package page and scope picker`.

---

### Task 6: Verification + docs

- [ ] `npm run test:smoke`; controller browser pass (scratch DB): flip a group to Alternate → header total drops by its sell, sidebar row appears, PDF shows the Alternates block, cover shows Alternates, share link scope picker offers it unchecked and adds it when ticked; flip back → everything returns.
- [ ] Docs (numbers from `origin/main`): DECISIONS entries (stamp design; money rules incl. credit pin and approval; consumers list; customer outputs incl. numbering `A1` and unchecked default), PUNCHLIST item (DONE) referencing #305/#306, AGENTS entry 42 updated. Final gates; commit `docs: Estimator Phase 2b — alternates`.
