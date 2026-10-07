# Estimator in four steps — Phase 2a (Build step) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Estimator's Build step, let staff group systems under named headings (with subtotals), drag or arrow systems into any order and group, and mark a finished system "built" so it collapses — with the groups printed as headings on the customer PDF.

**Architecture:** One pure module (`src/lib/estimate-groups/groups.ts`) owns every rule — sanitising groups, the display-order invariant, moves, group blocks and subtotals, and "editing un-marks built". The state hook (`use-estimator-state.ts`) holds `groups` beside `sections` and calls only those functions; the save action and page loader persist `spec.groups`; the Build step's rail and cards render from `groupBlocks()`; `QuoteDocument` prints group headings from the same blocks.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript; HTML5 drag-and-drop (house pattern: `src/components/board/board-view.tsx`); spec harness `scripts/test-review-and-spec.ts` (`ok(cond, msg)`), route smoke `scripts/smoke-routes.ts`.

**Spec:** `docs/superpowers/specs/2026-10-07-estimator-four-steps-design.md` §8 (Phase 2a) and §5.1.

## Global Constraints

- `spec.groups?: SystemGroup[]`, `SystemGroup = { id: string; name: string; alternate: boolean }`; ids `g-<base36>`; name trimmed, ≤ 80 chars, blank → `Untitled group`; at most 20 groups; `alternate` always written `false` in 2a, no UI for it.
- `SpecSection.groupId?: string`; `SpecSection.built?: true` (absent when not built — never `false`).
- Order invariant: stored `sections` = ungrouped first, then each group in `groups` order, relative order kept; unknown `groupId` dropped. Every mutation and the save normalise through `normalizeSystemOrder`.
- `built` is stripped from the PDF doc key; collapse is per person per quote in `localStorage` key `quartzite.estimator.collapsed.v1:<quoteId>` (JSON array of collapsed section ids), try/catch on every access, saved quotes only.
- Any change to a built section other than `built` itself clears `built`.
- Rewards credit stays on the last system after every reorder (same re-pin as `deleteSystem`).
- Copy for new UI: `+ Add group`, `Untitled group`, `Ungrouped`, `No group`, `+ New group`, `✓ Mark built & collapse`, `built`, readiness `✓ N systems priced · M of N built` / `✓ N of N built`.
- No change to totals, pricing, cover PDF, client package page, scope picker, cut sheets or parts CSV in 2a.
- Read `node_modules/next/dist/docs/` only if you touch routing/server-action APIs (AGENTS.md).
- Gates per task: `npx tsc --noEmit` (0), `npx eslint "src/app/(app)/estimator" src/components/quote-review src/lib/estimate-output src/lib/estimate-steps src/lib/estimate-groups src/lib/quote-pdf src/components/online-estimate` (clean — never `npm run lint`, it crashes on the harness file), `npm run test:specs` (report PASS/FAIL; FAIL = 0), `npx next build` on tasks touching client components. Never `git stash`; never touch `.data/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Punch/decision numbers are assigned in Task 6 from `origin/main`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/estimate-groups/groups.ts` | create | Pure rules: types, sanitise, order, moves, blocks, subtotals, built un-marking |
| `src/app/(app)/estimator/types.ts` | modify | `SpecSection.groupId`, `SpecSection.built`; `EstimatorProps.initial.groups` |
| `src/app/(app)/estimator/actions.ts` | modify | `SavePayload.groups`; save writes `spec.groups`; move-to-existing keeps target groups |
| `src/app/(app)/estimator/page.tsx` | modify | `initial.groups` from `q.spec.groups` |
| `src/app/(app)/estimator/copy-system.ts`, `src/lib/narrative/system-library.ts` | modify | strip `groupId` / `built` when a system leaves this estimate |
| `src/app/(app)/estimator/pdf-doc-key.ts` | modify | `groups` in the key; `built` stripped |
| `src/app/(app)/estimator/use-estimator-state.ts` | modify | `groups` state + ops; built + un-mark; collapse persistence |
| `src/lib/estimate-steps/readiness.ts` | modify | built progress in the Build badge |
| `src/app/(app)/estimator/steps/build-step.tsx` | modify | grouped rail with drag/arrows + group headings; group dividers in the card column |
| `src/app/(app)/estimator/section-card.tsx` | modify | Group select; Mark built & collapse; built tag |
| `src/app/(app)/estimator/quote-document.tsx` + its data loaders | modify | `groups` prop; group heading rows with subtotal |

---

### Task 1: Pure groups module

**Files:** Create `src/lib/estimate-groups/groups.ts`; Test: append `#P2a groups` block to `scripts/test-review-and-spec.ts`.

**Interfaces — Produces:**
```ts
export type SystemGroup = { id: string; name: string; alternate: boolean };
export const GROUP_NAME_MAX = 80; export const GROUPS_MAX = 20; export const UNTITLED_GROUP = "Untitled group";
export function newGroupId(): string;                                   // "g-" + base36 random/time
export function sanitizeGroups(raw: unknown): SystemGroup[];
export function normalizeSystemOrder<S extends { id: string; groupId?: string }>(sections: S[], groups: SystemGroup[]): S[];
export type GroupBlock<S> = { group: SystemGroup | null; sections: S[] };
export function groupBlocks<S extends { id: string; groupId?: string }>(sections: S[], groups: SystemGroup[], opts?: { includeEmpty?: boolean }): GroupBlock<S>[];
export function moveSystemTo<S extends { id: string; groupId?: string }>(sections: S[], groups: SystemGroup[], id: string, target: { groupId: string | null; beforeId: string | null }): S[];
export function moveSystemBy<S extends { id: string; groupId?: string }>(sections: S[], groups: SystemGroup[], id: string, delta: -1 | 1): S[];
export function addGroup(groups: SystemGroup[], name?: string, id?: string): SystemGroup[];
export function renameGroup(groups: SystemGroup[], id: string, name: string): SystemGroup[];
export function moveGroupBy(groups: SystemGroup[], id: string, delta: -1 | 1): SystemGroup[];
export function removeGroup<S extends { id: string; groupId?: string }>(sections: S[], groups: SystemGroup[], id: string): { sections: S[]; groups: SystemGroup[] };
export function withoutGroupMeta<S extends { groupId?: string; built?: boolean }>(sec: S): S;   // drops groupId + built (system leaving this estimate)
export function withoutBuilt<S extends { built?: boolean }>(sec: S): S;
export function unmarkEdited<S extends { id: string; built?: boolean }>(prev: S[], next: S[]): S[];
```

Behaviour (each line is a test):
- `sanitizeGroups`: non-array → `[]`; drops non-objects and entries without a string id matching `/^g-[a-z0-9]{1,24}$/`; dedupes by id (first wins); name trimmed, control chars removed, capped at 80, blank → `Untitled group`; `alternate` → `false` unless exactly `true` (kept as stored, see constraint — 2a writes false from the UI); caps the list at 20.
- `normalizeSystemOrder`: ungrouped first then groups in order, relative order kept; a section whose `groupId` is unknown loses the key (returns a new object without `groupId`; untouched sections keep identity); idempotent; returns the same array reference when nothing changes.
- `groupBlocks`: ungrouped block (group `null`) first only when non-empty; one block per group in order; empty groups included only with `{ includeEmpty: true }`; uses the normalised order.
- `moveSystemTo`: sets `groupId` (or removes it for `null`), inserts before `beforeId` when that id is in the target group, else at the end of the target group's block; result normalised; unknown `id` → input unchanged.
- `moveSystemBy`: moves one place in display order; moving up from the first system of a group puts it LAST in the previous block (previous group, or ungrouped); moving down from the last system of a group puts it FIRST in the next group; at the very top/bottom → unchanged (same reference).
- `addGroup` appends `{ id: id ?? newGroupId(), name: name?.trim() || "Untitled group", alternate: false }`, refuses past 20 (returns input). `renameGroup` applies the sanitise rules to the name. `moveGroupBy` swaps with its neighbour; edges unchanged. `removeGroup` drops the group and ungroups its systems (normalised).
- `unmarkEdited(prev, next)`: for each `next` section with `built`, if `prev` has the same id AND the section object changed AND `JSON.stringify(withoutBuilt(prev))` !== `JSON.stringify(withoutBuilt(next))` → return it without `built`; otherwise unchanged; returns the same array reference when nothing is cleared.

- [ ] **Step 1: Write the failing tests** — append to the end of the harness a block headed `/* #P2a — Estimator Phase 2a: system groups (pure). */` that imports every export above (aliased `p2a*`) and asserts each bullet above with concrete fixtures, e.g.:

```ts
import * as p2a from "@/lib/estimate-groups/groups";
{
  const g = (id: string, name = id, alternate = false) => ({ id, name, alternate });
  const s = (id: string, groupId?: string, extra: Record<string, unknown> = {}) => ({ id, ...(groupId ? { groupId } : {}), ...extra });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");
  const G = [g("g-a", "Stage"), g("g-b", "House")];
  ok(p2a.sanitizeGroups(null).length === 0 && p2a.sanitizeGroups([{ id: "x", name: "bad id" }, 7, null]).length === 0, "#P2a groups: sanitize drops non-arrays, junk and bad ids");
  const san = p2a.sanitizeGroups([{ id: "g-a", name: "  Stage  " }, { id: "g-a", name: "dup" }, { id: "g-b", name: "" , alternate: "yes" }]);
  ok(san.length === 2 && san[0].name === "Stage" && san[1].name === "Untitled group" && san[1].alternate === false, "#P2a groups: trims, dedupes by id, blank → Untitled group, alternate only when exactly true");
  ok(p2a.sanitizeGroups([{ id: "g-a", name: "x".repeat(200) }])[0].name.length === 80, "#P2a groups: name capped at 80");
  ok(p2a.sanitizeGroups(Array.from({ length: 30 }, (_, i) => ({ id: "g-" + i, name: "n" }))).length === 20, "#P2a groups: at most 20");
  const order = p2a.normalizeSystemOrder([s("1", "g-b"), s("2"), s("3", "g-a"), s("4", "g-zz"), s("5", "g-a")], G);
  ok(ids(order) === "2,4,3,5,1" && !("groupId" in order[1]), "#P2a groups: ungrouped first, then groups in order, relative order kept; unknown group dropped");
  const stable = [s("2"), s("3", "g-a"), s("1", "g-b")];
  ok(p2a.normalizeSystemOrder(stable, G) === stable, "#P2a groups: already-normal input returns the same array");
  // … one ok() per remaining bullet (groupBlocks incl. includeEmpty; moveSystemTo before/end/null/unknown;
  //    moveSystemBy across group edges and at the ends; add/rename/moveGroupBy/removeGroup; withoutGroupMeta;
  //    unmarkEdited: content change clears, built-only toggle keeps, untouched identity keeps, same ref when nothing cleared)
}
```
Write the remaining `ok()` lines in full — one per bullet; no placeholders in the committed test.

- [ ] **Step 2:** `npm run test:specs` → fails to load (module not found). Expected RED.
- [ ] **Step 3: Implement** `groups.ts` exactly to the bullets (pure, no imports beyond types; `newGroupId` = `"g-" + (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 24)`).
- [ ] **Step 4:** tests GREEN; FAIL = 0; tsc 0; eslint clean on `src/lib/estimate-groups`.
- [ ] **Step 5: Commit** `feat(estimator): Phase 2a system-group rules (pure)`.

---

### Task 2: Persistence — types, save, load, other writers, doc key

**Files:** `src/app/(app)/estimator/types.ts`, `actions.ts`, `page.tsx`, `copy-system.ts`, `src/lib/narrative/system-library.ts`, `pdf-doc-key.ts`; harness.

**Interfaces:** Consumes Task 1. Produces: `SpecSection.groupId?: string`, `SpecSection.built?: true`; `EstimatorProps["initial"].groups: SystemGroup[]`; `SavePayload.groups?: SystemGroup[]` (optional so older callers save as before); `PdfDocKeyInput.groups?: SystemGroup[]`.

- [ ] **Step 1: Failing pins** — append a `#P2a persistence` block: source pins that (a) `saveQuoteAction` writes `spec: { sections: …, mobs: …, groups: … }` with the groups passed through `sanitizeGroups` and the sections through `normalizeSystemOrder`; (b) page.tsx reads `spec.groups` through `sanitizeGroups` into `initial.groups`; (c) the move-to-existing writer keeps `existingSpec?.groups` and the moved section goes through `withoutGroupMeta`; move-to-new, copy-system and system-library use `withoutGroupMeta`; (d) `pdfDocKey` includes groups and maps sections through `withoutBuilt`. Plus one behaviour check: `pdfDocKey` of two inputs differing only by `built` are equal, and differing by `groups` differ.
- [ ] **Step 2:** RED.
- [ ] **Step 3: Implement.**
  - types.ts: add the two `SpecSection` fields (doc comments: Phase 2a; `built` is staff-only, never printed) and `groups: SystemGroup[]` on the initial props type.
  - actions.ts: `SavePayload.groups?`; in `saveQuoteAction`, `const groups = sanitizeGroups(payload.groups ?? existingGroups)` where `existingGroups` is the stored quote's `spec.groups` (an older caller without the field keeps them); write `spec: { sections: normalizeSystemOrder(savedSections, groups), mobs: payload.mobs, groups }`. Keep `QuoteExtras.spec` typed with `groups?: SystemGroup[]`. Move-to-existing (`spec: { sections: mergedSections, … }` ~line 812): keep `groups: existingSpec?.groups ?? []` and pass the moved section through `withoutGroupMeta` before merging. Move-to-new (~line 843): `withoutGroupMeta` on the placed section.
  - page.tsx: `groups: sanitizeGroups((spec as { groups?: unknown } | null)?.groups)` in `initial`, and normalise `initial.sections` with it.
  - copy-system.ts (cross-estimate copy builder, ~line 213) and system-library.ts (save + load, ~line 238): pass the section through `withoutGroupMeta`. Copy **within** this estimate is a hook concern (Task 3).
  - pdf-doc-key.ts: input gains `groups?`; key uses `sections.map(withoutBuilt)` and `groups ?? []`.
- [ ] **Step 4:** tsc 0; eslint clean; specs GREEN (FAIL 0); `npx next build` OK.
- [ ] **Step 5: Commit** `feat(estimator): Phase 2a persist spec.groups; systems leaving an estimate drop their group`.

---

### Task 3: State hook — groups, moves, built, collapse persistence, readiness

**Files:** `use-estimator-state.ts`, `src/lib/estimate-steps/readiness.ts`, harness.

**Interfaces:** Consumes Tasks 1–2. Produces on `EstimatorState`: `groups`, `blocks` (= `groupBlocks(sections, groups, { includeEmpty: true })`), `addGroupAction(name?)` (returns new id), `renameGroupAction(id, name)`, `moveGroupByAction(id, delta)`, `removeGroupAction(id)`, `moveSystemToAction(id, target)`, `moveSystemByAction(id, delta)`, `setSystemGroup(secId, groupId | null)`, `markBuilt(secId)` (sets `built: true` and collapses), `isBuilt(secId)`. `isExpanded`/`toggleExpand` keep their names; collapsed ids persist per quote.

- [ ] **Step 1: Failing pins** (`#P2a hook`): `const [groups, setGroups] = useState<SystemGroup[]>(initial.groups ?? [])`; every group/move action routes through the Task 1 functions and then re-pins the Rewards credit with `withRewardCredit(…, rewardCreditOf(…), nextId())` exactly like `deleteSystem`; the `setSections` wrapper applies `unmarkEdited(prev, next)` (written as `setSectionsState((prev) => …)` so the exact-count pin on `setSectionsState(` still holds — check the harness pin "setSectionsState( exactly 5 times" and keep it true); the save payload sends `groups`; `docInput` passes `groups`; collapse uses the localStorage key from the constraints inside try/catch; readiness behaviour checks for the two built labels.
- [ ] **Step 2:** RED.
- [ ] **Step 3: Implement.**
  - `setSections` wrapper: `setSectionsState((prev) => unmarkEdited(prev, typeof v === "function" ? v(prev) : v))` (keep the `setTierReprice(null)` line). Implement `markBuilt` through `setSections` too — `unmarkEdited` keeps `built` when the only change is `built` itself, by construction — so no new `setSectionsState(` call site is added.
  - Copy within this estimate (copy-here) and Load system: the inserted section inherits the active/source system's `groupId` and has no `built`.
  - `addSystem`: new system joins the active system's group (so "+ Add system" under a group stays in it); normalise.
  - Collapse persistence: on load (saved quote), read the key and seed `expanded` with `false` for listed ids; on `toggleExpand`/`markBuilt`, write the updated list. A new estimate persists once it gains an id.
  - readiness.ts `buildBadge`: when there are no gaps, `built = sections.filter((s) => s.built).length`; `built === 0` → unchanged label; `0 < built < n` → `✓ ${n} systems priced · ${built} of ${n} built`; `built === n` → `✓ ${n} of ${n} built`. Gaps unchanged. Update/add readiness tests accordingly (the existing exact-label tests stay valid — their fixtures have no `built`).
- [ ] **Step 4:** gates (tsc, eslint, specs FAIL 0, next build).
- [ ] **Step 5: Commit** `feat(estimator): Phase 2a groups, moves, built and remembered collapse in the state hook`.

---

### Task 4: Build step UI — grouped rail, drag/arrows, cards

**Files:** `steps/build-step.tsx`, `section-card.tsx`, `estimator-styles.ts` (if CSS needed), harness.

**Interfaces:** Consumes Task 3's hook API.

- [ ] **Step 1: Failing pins** (`#P2a build UI`): the rail renders from `blocks`; rows are `draggable` with `onDragStart` setting `dataTransfer.setData("text/plain", sec.id)`; drop targets call `moveSystemToAction` with `{ groupId, beforeId }`; each row has ↑ and ↓ buttons calling `moveSystemByAction(id, -1|1)` with `aria-label`s `Move <name> up/down`; group headings show name, subtotal (`fmt(Σ systemSellTotal)`), rename input, ↑/↓, and a delete control with an inline confirm (no `window.confirm`); `+ Add group` button; an `Ungrouped` drop zone appears only when groups exist; the card column renders a divider per group block with the group name and subtotal; SectionCard has a `Group` select (`No group`, each group, `+ New group`) and a `✓ Mark built & collapse` button; a built card's header shows `built`; a built rail row shows `✓`.
- [ ] **Step 2:** RED.
- [ ] **Step 3: Implement** following the house HTML5 pattern in `src/components/board/board-view.tsx` (draggable rows, `onDragOver` `preventDefault`, `onDrop` reads the id). Visual feedback: a 2px accent insertion line on the hovered drop row / an accent outline on a hovered group heading; clear it on `dragleave`/`drop`/`dragend`. Selecting a row still calls `selectSystem`. Keep the existing sidebar look (fonts, colours, `ACCENT_SOFT`/`ACCENT_INK`) and the totals/cost-breakdown/Rewards blocks below the list unchanged. `+ New group` in the card select creates `Untitled group`, moves the system into it, and focuses that group's rename input in the rail.
- [ ] **Step 4:** gates incl. `npx next build`.
- [ ] **Step 5: Commit** `feat(estimator): Phase 2a Build rail — groups, drag and arrows, Mark built & collapse`.

---

### Task 5: Group headings on the customer document

**Files:** `quote-document.tsx`, `src/lib/quote-pdf/quote-document-data.ts` and/or `src/lib/quote-pdf/document-loader.ts`, `src/app/print/quote/[id]/page.tsx`, `src/components/online-estimate/online-estimate.tsx` (whichever build `QuoteDocument`'s props from a quote/revision spec), harness.

**Interfaces:** `QuoteDocumentProps.groups?: SystemGroup[]`.

- [ ] **Step 1: Failing tests** (`#P2a document`): render-free checks — a pure helper exported from `quote-document-view.ts`, `printedGroupHeadings(sections, groups)` → `Array<{ beforeSectionId: string; name: string; subtotal: number }>` for every group with ≥ 1 printed system (printed = `systemPrintsInBody`), subtotal = Σ `systemSellTotal` of its printed systems, in document order; ungrouped never get a heading; no groups → `[]`. Plus source pins: QuoteDocument renders a heading row from that helper before the matching band; every loader that builds QuoteDocument props from `spec` passes `spec.groups` through `sanitizeGroups`.
- [ ] **Step 2:** RED.
- [ ] **Step 3: Implement** the helper and the heading row (inside the `previewSections.map`, before `<SectionBand>` when `ps.id` matches a heading): uppercase group name left, subtotal right, styled as a light divider above the band (not a band itself), print-safe (`breakInside: "avoid"` with the next band where the document already does that). Numbering stays continuous. Loaders: read `groups` from the same `spec` they read `sections` from (live quote and frozen revision alike).
- [ ] **Step 4:** gates incl. `npx next build`.
- [ ] **Step 5: Commit** `feat(estimator): Phase 2a group headings with subtotals on the customer PDF and online view`.

---

### Task 6: Verification + docs

- [ ] **Step 1:** `scripts/smoke-routes.ts` needs no new route (Build is `?id=` already) — run `npm run test:smoke` (no dev server running from this worktree first).
- [ ] **Step 2:** Browser check (controller does this on a scratch DB): create 2 groups, drag systems between them, ↑/↓ across a group edge, rename/delete a group, Mark built (collapses, ✓ in rail, badge shows built progress), edit a built system (un-marks), reload (collapse remembered, order + groups persisted), Save → Review PDF shows group headings with subtotals.
- [ ] **Step 3: Docs** (re-read `origin/main` numbers first): DECISIONS — one entry per: groups data + order invariant; built/collapse not customer content; Alternate deferred to 2b; rail-only drag; system leaving an estimate drops its group. PUNCHLIST — a new item for Phase 2a (DONE) referencing #305's roadmap. AGENTS.md — update phase 42's entry with Phase 2a ✅.
- [ ] **Step 4:** Final gates; commit `docs: Estimator Phase 2a (Build step)`.
