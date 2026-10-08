# Estimator — Phase 6 (System categories) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "+ Add system" offers admin-editable system categories whose typical catalog parts drop in as a pre-ticked checklist; admins maintain categories and their typical items under Estimating Rules.

**Architecture:** Pure rules in `src/lib/system-categories.ts`; a settings-blob store (`system_categories`, seeded with the seven defaults); admin page under Estimating Rules; the Estimator page loads categories + resolved parts; a modal on the Build step builds the new system through the hook (pricing via `catalogAddPrice`).

**Spec:** `docs/superpowers/specs/2026-10-07-estimator-four-steps-design.md` §13.

## Global Constraints
- Blob key `system_categories`; shape and caps per spec §13; defaults exactly `Controls, Fixtures, Rigging, Video, Infrastructure, Wireless, Communications` (empty items) seeded when the blob is missing; ids `cat-<base36>`.
- Admin permission `manage_users` (`requirePerm` in actions; page shows "Admin access required" otherwise — mirror `estimating-rules/track-series`).
- New lines are built exactly like `addPart` (`use-estimator-state.ts` ~1749): `{ id: nextId(), sku, desc, qty, unit, cost, price: catalogAddPrice(cost, list, tierMargin) }`; new system shape like `addSystem` (~1645) with `name` = category name, `discipline` via `withDiscipline` when set; joins the active system's group; `normalizeSystemOrder`; selected + scrolled.
- Copy (exact): modal title `Add a system`; tile `Blank system`; button `Add system`; flag `Not in the catalog`; admin page title `System categories`; Estimating Rules card `System categories`.
- Gates per task: `npx tsc --noEmit` 0; scoped eslint clean (never `npm run lint`); `npm run test:specs` FAIL 0; `npx next build` when client code changes. Never `git stash`; never touch `.data/`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Pure rules + store + actions
`src/lib/system-categories.ts` (types, `DEFAULT_SYSTEM_CATEGORIES`, `sanitizeSystemCategories`, `newCategoryId`, pure ops add/rename/remove/move/setDiscipline/addItem/removeItem/setItemQty/setItemNote/moveItem); `src/lib/stores/system-categories.ts` (`getSystemCategories()` seeds defaults when missing, `saveSystemCategories(next)`); actions in `src/app/(app)/estimating-rules/system-categories/actions.ts` (`requirePerm("manage_users")`, whole-list save after sanitize, returns the saved list; a part search action reusing `searchEquipmentPartsAction`'s pattern; a `resolveCategoryPartsAction(skus)` via `getManyBySku`). Harness `#P6 rules` (+ async DB check for seed-on-missing and save). Commit `feat(estimator): Phase 6 system categories — rules and store`.

### Task 2: Admin page
`src/app/(app)/estimating-rules/system-categories/page.tsx` + client: category list (reorder ↑/↓, rename inline, discipline select, delete with inline confirm, add), selected category's items (PartPicker add, qty input, note, remove, reorder; live desc/unit/cost; `Not in the catalog` flag), Save (whole list) with dirty state; link card on `estimating-rules/page.tsx`. Harness `#P6 admin`. Commit `feat(estimator): Phase 6 System categories admin page`.

### Task 3: Estimator "Add a system" modal
`E/page.tsx` loads categories + `getManyBySku` of all their skus → `initial.systemCategories: Array<{ id; name; discipline?; items: Array<{ sku; qty; note?; part: { desc; unit; cost; list } | null }> }>`; new `E/add-system-modal.tsx`; hook `addSystemFromCategory(categoryId, picks: Array<{ sku; qty }>)`; both "+ Add system" (card column) and rail "+ Add" open the modal (Blank system = today's `addSystem`). Harness `#P6 estimator` (pure builder `systemFromCategory(category, picks, ctx)` behaviour-tested: name, discipline, lines priced via catalogAddPrice, missing parts skipped, group inheritance). Commit `feat(estimator): Phase 6 Add a system from a category`.

### Task 4: Verification + docs
Controller browser pass (scratch DB): admin adds items to Rigging; Estimator → Add a system → Rigging → checklist → Add system; Blank system still works. Smoke; DECISIONS/PUNCHLIST/AGENTS (numbers from origin/main); final gates; commit `docs: Estimator Phase 6 — system categories`.
