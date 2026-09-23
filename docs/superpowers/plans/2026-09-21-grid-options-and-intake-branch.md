# Grid Options Model + Intake Branch (Spec 1 of 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a Grid project first-class **options** (Good/Better/Best-style variants with their own placements, routes, BOM and quote), reshape the Manual intake to venue+dims → mode → cover page, and remove the broken "Generate starting layout" button.

**Architecture:** Placements and routes gain an `optionId` tag; everything else on the project (sheets, calibration, spaces, intake, scope inputs, revisions) stays shared. A pure `grid-options.ts` module normalizes legacy docs on read (missing list → one "Design" option; untagged members → first option) and slices members per option, so the BOM/riser/schedule libraries stay untouched and receive a slice. Quote pricing is extracted from the server action into `grid-quote.ts` so it can be tested per option on a scratch database without a session.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle doc-store on PGlite (dev) / Neon (prod), tsx test scripts, the existing `scripts/test-review-and-spec.ts` `ok()` harness.

**Spec:** `docs/superpowers/specs/2026-09-21-grid-options-and-intake-branch-design.md`

## Global Constraints

- **Branch/base:** work in worktree `.claude/worktrees/grid-options-spec1` on `worktree-grid-options-spec1`, which is `origin/main` + the three cherry-picked #38 Grid commits (`4648936`, `2833df9`, `43b6695`). Do not rebase.
- **Never write to `/Users/sm/Downloads/peak-app/.data/pglite`.** Every DB-touching test runs on a scratch `PGLITE_PATH=$(mktemp -d)` (idiom of `npm run test:review:regressions`). One PGlite process at a time; check `ps aux | grep tsx` before and after.
- **Binaries:** run `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint <files>` and `npx tsx …` from the worktree root (`node_modules` is a symlink; `npx tsc` alone silently fakes).
- **Gates before "done" (real numbers):** tsc exit 0 · `npm run test:specs` (baseline on this branch: **1013 PASS / 5 FAIL**, the 5 are seed-data reads in `equipment-items`/`surveys`/`FS-1053` and pre-exist) · `npm run test:smoke` · eslint on changed files, compared against the same files on a clean `git stash`-free baseline (use `git show HEAD:<file> > /tmp/x.tsx` style comparison, never bare `git stash`).
- **Copy rules:** placeholder option name is exactly `Design`; ids are `opt-` + 12 hex chars; the default id for normalized legacy docs is exactly `opt-base`.
- **Port faithfully / D-numbering:** DECISIONS.md entry number = next free number ≥ **D150** (the unmerged punch branch already reaches D149).
- Commit after every task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. Plain single-command git invocations only (`git add A B`, then `git commit -F -` via heredoc in a separate call) — the worktree harness refuses chained git.

---

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/design/grid-options.ts` (new) | Pure: `GridOption` type, `ensureOptions`, `optionSlice`, `defaultOptionId`, `resolveOptionId`, `hasOption`, `copyOptionMembers` | 1 |
| `src/lib/stores/grid-projects.ts` | `optionId` on placement/route, `options` on project + revision; read-side normalize; option CRUD; member writes stamp `optionId`; `setOptionQuote` replaces `setQuote` | 1, 2 |
| `scripts/test-review-and-spec.ts` | Pure unit checks for grid-options | 1 |
| `scripts/test-grid-options.ts` (new) + `package.json` | Scratch-DB scenario: create → options → copy → quote per option → restore | 2, 4, 6 |
| `src/app/(app)/design/grid/[id]/actions.ts` | Option actions; member actions take `optionId`; quote action per option; intake save side effects | 2, 4, 6 |
| `src/lib/design/grid-quote.ts` (new) | Server lib: `buildGridQuote(project, optionId, laborLines)` — the pricing body lifted out of the action | 4 |
| `src/app/(app)/design/designs/actions.ts` | `promoteDesignAction` passes the default option | 4 |
| `src/app/(app)/design/grid/[id]/riser/page.tsx`, `schedule/page.tsx` | `?option=` + slice | 3 |
| `src/app/(app)/design/grid/[id]/page.tsx` | passes `options` + resolved `activeOptionId` | 5 |
| `src/app/(app)/design/grid/[id]/option-switcher.tsx` (new) | Segmented switcher + add/rename/delete menu | 5 |
| `src/app/(app)/design/grid/[id]/editor.tsx` | slice by active option, stamp writes, mount switcher, remove seed UI | 5 |
| `src/app/(app)/design/grid/[id]/scope-panel.tsx` | `defaultTier` prop; `TRACKABLE_SYS_KEYS` import | 5, 6 |
| `src/lib/design/grid-scopes.ts` | exports `TRACKABLE_SYS_KEYS` | 6 |
| `src/lib/design/grid-intake.ts` (new) | Pure: `manualScopeInputs(a)`, `designPatchFromIntake(...)` | 6 |
| `src/app/(app)/design/grid/[id]/grid-intake.tsx` | two-step intake | 6 |
| `scripts/smoke-routes.ts`, `DECISIONS.md` | smoke coverage + decision entry | 7 |

---

### Task 1: Pure options module + types + read-side normalization

**Files:**
- Create: `src/lib/design/grid-options.ts`
- Modify: `src/lib/stores/grid-projects.ts` (types at lines 34–66, 87–108, 110–128, 130–172; `listProjects`/`getProject` at 196–203; `snapshotOf` at ~630; `restoreRevision` at ~684)
- Test: `scripts/test-review-and-spec.ts` (insert a new section immediately above the line `async function asyncChecks(): Promise<void> {`)

**Interfaces:**
- Produces (used by every later task):
  ```ts
  // src/lib/design/grid-options.ts
  export type GridOption = { id: string; name: string; tier?: TierKey; quoteId: string | null; createdAt: number };
  export const DEFAULT_OPTION_ID = "opt-base";
  export const DEFAULT_OPTION_NAME = "Design";
  export type OptionsDoc = { options?: GridOption[]; placements?: Array<{ optionId?: string }>; routes?: Array<{ optionId?: string }>; quoteId?: string | null; createdAt?: number };
  export function ensureOptions<T extends OptionsDoc>(doc: T): T & { options: GridOption[] };
  export function defaultOptionId(doc: OptionsDoc): string;
  export function hasOption(doc: OptionsDoc, optionId: string): boolean;
  export function resolveOptionId(doc: OptionsDoc, requested: string | null | undefined): string;
  export function optionSlice<P extends { optionId?: string }, R extends { optionId?: string }>(doc: { placements?: P[]; routes?: R[] } & OptionsDoc, optionId: string): { placements: P[]; routes: R[] };
  export function syncQuoteMirror<T extends OptionsDoc>(doc: T): T;
  export function copyOptionMembers<P extends { id: string; optionId?: string }, R extends { id: string; optionId?: string; fromPlacementId?: string; toPlacementId?: string }>(input: { placements: P[]; routes: R[]; fromOptionId: string; toOptionId: string; makeId: (prefix: "gp-" | "wr-") => string; by: string; at: number }): { placements: P[]; routes: R[] };
  ```
- `GridPlacement.optionId?: string`, `GridRoute.optionId?: string`, `GridProject.options?: GridOption[]`, `GridRevision.options?: GridOption[]`.

- [ ] **Step 1: Write the failing pure tests**

Insert immediately above `async function asyncChecks(): Promise<void> {` in `scripts/test-review-and-spec.ts`:

```ts
/* --- Grid options (Spec 1, 2026-09-21): normalization + slicing + copy --- */
{
  const legacy = {
    quoteId: "Q-9001",
    createdAt: 1000,
    placements: [
      { id: "gp-a", sheetId: "gs-1", page: 1, x: 0.1, y: 0.1, partId: "p1", by: "t", at: 1 },
      { id: "gp-b", sheetId: "gs-1", page: 1, x: 0.2, y: 0.2, partId: "p2", by: "t", at: 1 },
    ],
    routes: [
      { id: "wr-a", sheetId: "gs-1", page: 1, partId: "w1", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], aspect: 1, by: "t", at: 1, fromPlacementId: "gp-a", toPlacementId: "gp-b" },
    ],
  };
  const norm = ensureOptions(structuredClone(legacy));
  ok(norm.options.length === 1 && norm.options[0].id === DEFAULT_OPTION_ID && norm.options[0].name === DEFAULT_OPTION_NAME, "grid-options: a legacy doc normalizes to one 'Design' option with id opt-base");
  ok(norm.options[0].quoteId === "Q-9001", "grid-options: the default option inherits the project quoteId");
  ok(norm.placements!.every((p) => p.optionId === DEFAULT_OPTION_ID) && norm.routes!.every((r) => r.optionId === DEFAULT_OPTION_ID), "grid-options: untagged placements and routes read as members of the first option");

  const two = ensureOptions({
    createdAt: 1000,
    quoteId: null,
    options: [
      { id: "opt-x", name: "Good", quoteId: null, createdAt: 1 },
      { id: "opt-y", name: "Better", quoteId: "Q-2", createdAt: 2 },
    ],
    placements: [
      { id: "gp-1", optionId: "opt-x" },
      { id: "gp-2", optionId: "opt-y" },
      { id: "gp-3" },
    ],
    routes: [{ id: "wr-1", optionId: "opt-y" }],
  });
  ok(two.options.length === 2 && two.options[0].id === "opt-x", "grid-options: an existing options list is preserved in order");
  ok(two.placements![2].optionId === "opt-x", "grid-options: an untagged member on a multi-option doc falls to the FIRST option");
  ok(defaultOptionId(two) === "opt-x", "grid-options: defaultOptionId is the first option");
  ok(resolveOptionId(two, "opt-y") === "opt-y" && resolveOptionId(two, "opt-nope") === "opt-x" && resolveOptionId(two, null) === "opt-x", "grid-options: resolveOptionId honours a known id and falls back to the first otherwise");
  ok(hasOption(two, "opt-y") && !hasOption(two, "opt-z"), "grid-options: hasOption");
  const sliceY = optionSlice(two, "opt-y");
  ok(sliceY.placements.length === 1 && sliceY.placements[0].id === "gp-2" && sliceY.routes.length === 1, "grid-options: optionSlice returns only that option's placements and routes");
  ok(optionSlice(two, "opt-x").placements.map((p) => p.id).join(",") === "gp-1,gp-3", "grid-options: optionSlice of the first option includes formerly-untagged members");

  const mirrored = syncQuoteMirror({ ...two, quoteId: "stale" });
  ok(mirrored.quoteId === null, "grid-options: syncQuoteMirror copies options[0].quoteId onto the project (null here)");
  const mirrored2 = syncQuoteMirror({ ...two, options: [two.options[1], two.options[0]] });
  ok(mirrored2.quoteId === "Q-2", "grid-options: syncQuoteMirror follows whichever option is first");

  let n = 0;
  const copied = copyOptionMembers({
    placements: norm.placements!,
    routes: norm.routes!,
    fromOptionId: DEFAULT_OPTION_ID,
    toOptionId: "opt-new",
    makeId: (prefix) => `${prefix}c${++n}`,
    by: "copier",
    at: 5000,
  });
  ok(copied.placements.length === 2 && copied.placements.every((p) => p.optionId === "opt-new" && p.by === "copier" && p.at === 5000), "grid-options: copyOptionMembers copies every placement into the target option with new provenance");
  ok(copied.placements.map((p) => p.id).join(",") === "gp-c1,gp-c2", "grid-options: copied placements get NEW ids");
  ok(copied.routes.length === 1 && copied.routes[0].id === "wr-c3" && copied.routes[0].fromPlacementId === "gp-c1" && copied.routes[0].toPlacementId === "gp-c2", "grid-options: copied routes get new ids and remapped device-wire endpoints");
  ok(norm.placements![0].id === "gp-a" && norm.placements![0].optionId === DEFAULT_OPTION_ID, "grid-options: copyOptionMembers never mutates the source members");
}
```

Add to the import block at the top of the same file (anywhere among the existing `@/lib/design/...` imports):

```ts
import {
  DEFAULT_OPTION_ID,
  DEFAULT_OPTION_NAME,
  copyOptionMembers,
  defaultOptionId,
  ensureOptions,
  hasOption,
  optionSlice,
  resolveOptionId,
  syncQuoteMirror,
} from "@/lib/design/grid-options";
```

- [ ] **Step 2: Run to verify it fails**

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | head -5
```
Expected: `error TS2307: Cannot find module '@/lib/design/grid-options'`.

- [ ] **Step 3: Create the pure module**

`src/lib/design/grid-options.ts`:

```ts
/**
 * The Grid — options (Spec 1, 2026-09-21). An option is a first-class
 * variant of one design: its own placements + wire routes, BOM and quote,
 * on the project's SHARED sheets/calibration/spaces. Good/Better/Best are
 * three options; a hand-made design is one option.
 *
 * Storage is a TAG, not nesting: `placements[]`/`routes[]` stay flat on the
 * project and each member carries `optionId`. Pre-spec docs have neither
 * an `options` list nor tags — `ensureOptions` normalizes them in memory
 * (one "Design" option, untagged members belong to it). The stored doc is
 * only rewritten when a later option-aware patch runs `ensureOptions` on it.
 *
 * Pure and dependency-free (the grid-bom.ts rule): imported by the store,
 * the server actions, the riser/schedule pages AND the client editor.
 */

import type { TierKey } from "@/app/(app)/design/quick/engine";

export type GridOption = {
  id: string; // 'opt-' + 12 hex, or DEFAULT_OPTION_ID for a normalized legacy doc
  name: string;
  /** Set by the Auto generator (Spec 2). Absent on hand-made options. */
  tier?: TierKey;
  /** Draft quote minted from THIS option, when one exists. */
  quoteId: string | null;
  createdAt: number;
};

export const DEFAULT_OPTION_ID = "opt-base";
export const DEFAULT_OPTION_NAME = "Design";

type Member = { optionId?: string };

export type OptionsDoc = {
  options?: GridOption[];
  placements?: Member[];
  routes?: Member[];
  quoteId?: string | null;
  createdAt?: number;
};

/**
 * Normalize IN PLACE and return the same object: guarantees ≥1 option and
 * a tag on every member. Idempotent. Safe on a freshly-read doc (nothing
 * else holds it) and inside a patch callback (where the mutation is the
 * point).
 */
export function ensureOptions<T extends OptionsDoc>(doc: T): T & { options: GridOption[] } {
  let options = Array.isArray(doc.options) ? doc.options : [];
  if (options.length === 0) {
    options = [
      {
        id: DEFAULT_OPTION_ID,
        name: DEFAULT_OPTION_NAME,
        quoteId: doc.quoteId ?? null,
        createdAt: doc.createdAt ?? Date.now(),
      },
    ];
  }
  doc.options = options;
  const first = options[0].id;
  const known = new Set(options.map((o) => o.id));
  for (const pl of doc.placements || []) {
    if (!pl.optionId || !known.has(pl.optionId)) pl.optionId = first;
  }
  for (const r of doc.routes || []) {
    if (!r.optionId || !known.has(r.optionId)) r.optionId = first;
  }
  return doc as T & { options: GridOption[] };
}

export function defaultOptionId(doc: OptionsDoc): string {
  return ensureOptions(doc).options[0].id;
}

export function hasOption(doc: OptionsDoc, optionId: string): boolean {
  return ensureOptions(doc).options.some((o) => o.id === optionId);
}

/** A requested id (e.g. from `?option=`) if it exists, else the first option. */
export function resolveOptionId(doc: OptionsDoc, requested: string | null | undefined): string {
  if (requested && hasOption(doc, requested)) return requested;
  return defaultOptionId(doc);
}

/** The members of one option. The result arrays are new; the members are not copied. */
export function optionSlice<P extends Member, R extends Member>(
  doc: { placements?: P[]; routes?: R[] } & OptionsDoc,
  optionId: string
): { placements: P[]; routes: R[] } {
  ensureOptions(doc);
  return {
    placements: (doc.placements || []).filter((p) => p.optionId === optionId),
    routes: (doc.routes || []).filter((r) => r.optionId === optionId),
  };
}

/** `project.quoteId` stays a mirror of the FIRST option's quote so every
 *  pre-spec reader (Designs dashboard, Quotes hub back-links) keeps working. */
export function syncQuoteMirror<T extends OptionsDoc>(doc: T): T {
  const opts = ensureOptions(doc).options;
  doc.quoteId = opts[0]?.quoteId ?? null;
  return doc;
}

/**
 * Deep-copy one option's members into another option with NEW ids, remapping
 * device-wire endpoints (`fromPlacementId`/`toPlacementId`) onto the copied
 * placements. Never mutates the inputs.
 */
export function copyOptionMembers<
  P extends { id: string } & Member,
  R extends { id: string; fromPlacementId?: string; toPlacementId?: string } & Member,
>(input: {
  placements: P[];
  routes: R[];
  fromOptionId: string;
  toOptionId: string;
  makeId: (prefix: "gp-" | "wr-") => string;
  by: string;
  at: number;
}): { placements: P[]; routes: R[] } {
  const idMap = new Map<string, string>();
  const placements = input.placements
    .filter((p) => p.optionId === input.fromOptionId)
    .map((p) => {
      const id = input.makeId("gp-");
      idMap.set(p.id, id);
      return { ...p, id, optionId: input.toOptionId, by: input.by, at: input.at } as P;
    });
  const routes = input.routes
    .filter((r) => r.optionId === input.fromOptionId)
    .map((r) => {
      const next = { ...r, id: input.makeId("wr-"), optionId: input.toOptionId, by: input.by, at: input.at } as R;
      if (r.fromPlacementId) {
        const m = idMap.get(r.fromPlacementId);
        if (m) next.fromPlacementId = m; else delete next.fromPlacementId;
      }
      if (r.toPlacementId) {
        const m = idMap.get(r.toPlacementId);
        if (m) next.toPlacementId = m; else delete next.toPlacementId;
      }
      return next;
    });
  return { placements, routes };
}
```

- [ ] **Step 4: Add the types and read-side normalization to the store**

In `src/lib/stores/grid-projects.ts`:

Add to the imports:
```ts
import { ensureOptions, type GridOption } from "@/lib/design/grid-options";
export type { GridOption } from "@/lib/design/grid-options";
```

In `GridPlacement` (after `curtain?: GridCurtain;`):
```ts
  /** Option membership (Spec 1, options model). Absent on pre-spec
   *  placements — read as the project's first option (ensureOptions). */
  optionId?: string;
```

In `GridRoute` (after `connectionType?: string;`):
```ts
  /** Option membership (Spec 1) — see GridPlacement.optionId. */
  optionId?: string;
```

In `GridRevision` (after `routes?: GridRoute[];`):
```ts
  /** Option list at snapshot time (Spec 1). Absent on older snapshots —
   *  restore normalizes to a single default option. */
  options?: GridOption[];
```

In `GridProject` (after `revisions?: GridRevision[];`):
```ts
  /** Design options (Spec 1) — variants sharing this project's sheets.
   *  Absent on pre-spec docs; every read passes through ensureOptions, so
   *  callers may treat this as always ≥1 entry. `quoteId` below mirrors
   *  options[0].quoteId. */
  options?: GridOption[];
```

Replace `listProjects`/`getProject`:
```ts
/** All live projects, newest activity first. */
export async function listProjects(): Promise<GridProject[]> {
  const list = await listDocs<GridProject>("grid_projects");
  return list.map((p) => ensureOptions(p)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(id: string): Promise<GridProject | null> {
  const p = await getDoc<GridProject>("grid_projects", id);
  return p ? ensureOptions(p) : null;
}
```

In `snapshotOf`, add after `routes: [...(p.routes || [])],`:
```ts
    options: ensureOptions(p).options.map((o) => ({ ...o })),
```

In `restoreRevision`'s patch callback, add after `doc.routes = [...(target.routes || [])];`:
```ts
    doc.options = target.options ? target.options.map((o) => ({ ...o })) : undefined;
    ensureOptions(doc);
```

- [ ] **Step 5: Run the tests + tsc**

```bash
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
npm run test:specs 2>&1 | grep -E "grid-options|^FAIL" 
```
Expected: tsc `0`; 16 lines starting `PASS grid-options:`; the only `FAIL` lines are the 5 pre-existing seed-data ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/grid-options.ts src/lib/stores/grid-projects.ts scripts/test-review-and-spec.ts
```
```bash
git commit -F - <<'EOF'
feat(grid): options model — pure module, types, read-side normalization (Spec 1, Task 1)

Placements/routes carry optionId; a project/revision carries an options
list. Legacy docs normalize on read to one "Design" option (opt-base) that
inherits the project quoteId. No stored data is rewritten.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Store option CRUD, member writes stamp `optionId`, option server actions, scratch-DB scenario script

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (`addPlacement` ~308, `addPlacements` ~500, `addCurtainPlacement` ~540, `addRoute` ~582, `setQuote` ~489)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`placeDeviceAction` 237, `placeCurtainAction` 275, `addRouteAction` 441, `seedStartingLayoutAction` 158; new option actions)
- Create: `scripts/test-grid-options.ts`
- Modify: `package.json` scripts

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  ```ts
  // store
  export async function addOption(projectId, input: { name: string; copyFromOptionId?: string; tier?: TierKey; by: string }): Promise<{ ok: true; option: GridOption } | { ok: false; reason: "not-found" | "empty-name" | "no-such-option" }>;
  export async function renameOption(projectId, optionId, name: string): Promise<{ ok: true } | { ok: false; reason: "not-found" | "empty-name" | "no-such-option" }>;
  export async function removeOption(projectId, optionId, by: string): Promise<{ ok: true; removedPlacements: number; removedRoutes: number } | { ok: false; reason: "not-found" | "no-such-option" | "last-option" }>;
  export async function setOptionQuote(projectId, optionId, quoteId: string): Promise<GridProject | null>;
  // member writes gain `optionId: string` in their input objects:
  addPlacement(projectId, { sheetId, page, x, y, partId, optionId, by })
  addPlacements(projectId, { sheetId, page, optionId, items, by })
  addCurtainPlacement(projectId, { sheetId, page, x, y, curtain, category?, optionId, by })
  addRoute(projectId, { sheetId, page, partId, points, aspect, optionId, by, fromPlacementId?, toPlacementId?, connectionType? })
  // actions
  placeDeviceAction(projectId, { sheetId, page, x, y, partId, optionId })
  placeCurtainAction(projectId, { sheetId, page, x, y, curtain, category?, optionId })
  addRouteAction(projectId, { sheetId, page, partId, points, aspect, optionId, fromPlacementId?, toPlacementId? })
  addOptionAction(projectId, { name, copyFromOptionId?: string | null }): Promise<{ ok: true; optionId: string } | { ok: false; error: string }>
  renameOptionAction(projectId, optionId, name): Promise<Result>
  removeOptionAction(projectId, optionId): Promise<{ ok: true; removedPlacements: number; removedRoutes: number } | { ok: false; error: string }>
  ```
- `setQuote` is **deleted** (its only caller is rewritten in Task 4; until then Task 2 keeps a temporary alias — see Step 3).

- [ ] **Step 1: Write the failing scenario script**

`scripts/test-grid-options.ts`:

```ts
/**
 * Grid options — store-level scenario on a SCRATCH PGlite (Spec 1).
 * Run only via `npm run test:grid-options` (which sets PGLITE_PATH to a
 * mktemp dir). Never point this at .data/pglite.
 */
import assert from "node:assert/strict";
import {
  addOption,
  addPlacement,
  addRevision,
  addRoute,
  addSheet,
  createProject,
  getProject,
  removeOption,
  renameOption,
  restoreRevision,
  setOptionQuote,
  setSheetCalibration,
} from "@/lib/stores/grid-projects";
import { DEFAULT_OPTION_ID, optionSlice } from "@/lib/design/grid-options";

async function main() {
  if (!process.env.PGLITE_PATH) throw new Error("Refusing to run without PGLITE_PATH (scratch db).");

  const p0 = await createProject({ name: "Options scenario", customer: "Test Co", customerId: null, by: "tester" });
  const project = (await getProject(p0.id))!;
  assert.equal(project.options?.length, 1, "a new project reads with exactly one option");
  assert.equal(project.options![0].id, DEFAULT_OPTION_ID, "the first option is opt-base");
  const base = project.options![0].id;

  const sheet = (await addSheet(project.id, { name: "Sheet", mime: "image/svg+xml", dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E", by: "tester" }))!;
  await setSheetCalibration(project.id, { docId: sheet.id, page: 1, scale: 10, unit: "ft", refLength: 10, by: "tester", at: Date.now() });

  // members stamped with the option they were painted into
  await addPlacement(project.id, { sheetId: sheet.id, page: 1, x: 0.2, y: 0.2, partId: "PART-A", optionId: base, by: "tester" });
  await addPlacement(project.id, { sheetId: sheet.id, page: 1, x: 0.4, y: 0.2, partId: "PART-B", optionId: base, by: "tester" });
  const afterPlace = (await getProject(project.id))!;
  const [pa, pb] = afterPlace.placements;
  assert.equal(pa.optionId, base, "addPlacement stamps optionId");
  await addRoute(project.id, { sheetId: sheet.id, page: 1, partId: "WIRE-1", points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }], aspect: 1, optionId: base, by: "tester", fromPlacementId: pa.id, toPlacementId: pb.id });

  // unknown option is refused
  const bad = await addPlacement(project.id, { sheetId: sheet.id, page: 1, x: 0.5, y: 0.5, partId: "PART-C", optionId: "opt-nope", by: "tester" });
  assert.equal(bad, null, "addPlacement refuses an unknown optionId");

  // add by copy
  const copyRes = await addOption(project.id, { name: "Better", copyFromOptionId: base, by: "tester" });
  assert.ok(copyRes.ok, "addOption by copy succeeds");
  const better = copyRes.ok ? copyRes.option.id : "";
  const p2 = (await getProject(project.id))!;
  const sBase = optionSlice(p2, base);
  const sBetter = optionSlice(p2, better);
  assert.equal(sBase.placements.length, 2, "source option keeps its 2 placements");
  assert.equal(sBetter.placements.length, 2, "copied option has 2 placements");
  assert.equal(sBetter.routes.length, 1, "copied option has the route");
  assert.notEqual(sBetter.placements[0].id, sBase.placements[0].id, "copied placements have new ids");
  const copiedRoute = sBetter.routes[0];
  assert.ok(sBetter.placements.some((x) => x.id === copiedRoute.fromPlacementId), "copied route endpoints point at copied placements");

  // add empty
  const emptyRes = await addOption(project.id, { name: "Best", by: "tester" });
  assert.ok(emptyRes.ok, "addOption (empty) succeeds");
  const best = emptyRes.ok ? emptyRes.option.id : "";
  assert.equal(optionSlice((await getProject(project.id))!, best).placements.length, 0, "an empty option has no members");

  // rename
  const ren = await renameOption(project.id, best, "  Premium ");
  assert.ok(ren.ok, "renameOption succeeds");
  assert.equal((await getProject(project.id))!.options!.find((o) => o.id === best)!.name, "Premium", "rename trims and persists");
  const renEmpty = await renameOption(project.id, best, "   ");
  assert.ok(!renEmpty.ok && renEmpty.reason === "empty-name", "rename refuses an empty name");

  // quote mirror
  await setOptionQuote(project.id, better, "Q-BETTER");
  let p3 = (await getProject(project.id))!;
  assert.equal(p3.options!.find((o) => o.id === better)!.quoteId, "Q-BETTER", "setOptionQuote stores on the option");
  assert.equal(p3.quoteId, null, "project.quoteId mirrors the FIRST option only (still null)");
  await setOptionQuote(project.id, base, "Q-BASE");
  p3 = (await getProject(project.id))!;
  assert.equal(p3.quoteId, "Q-BASE", "project.quoteId mirrors options[0].quoteId");

  // revisions carry options; restore brings them back
  const rev = (await addRevision(project.id, { by: "tester", reason: "manual", note: "three options" }))!;
  assert.equal(rev.options?.length, 3, "a revision snapshots the options list");
  const rm = await removeOption(project.id, best, "tester");
  assert.ok(rm.ok, "removeOption (non-last) succeeds");
  assert.equal((await getProject(project.id))!.options!.length, 2, "option removed");
  const restored = await restoreRevision(project.id, rev.rev, "tester");
  assert.ok(restored.ok, "restore succeeds");
  assert.equal((await getProject(project.id))!.options!.length, 3, "restore brings the removed option back");

  // remove option deletes its members and refuses the last one
  const rm2 = await removeOption(project.id, better, "tester");
  assert.ok(rm2.ok && rm2.removedPlacements === 2 && rm2.removedRoutes === 1, "removeOption reports and deletes that option's members");
  const p4 = (await getProject(project.id))!;
  assert.equal(p4.placements.length, 2, "other options' placements survive");
  assert.equal(p4.placements.every((x) => x.optionId === base), true, "only the base option's placements remain");
  await removeOption(project.id, best, "tester");
  const last = await removeOption(project.id, base, "tester");
  assert.ok(!last.ok && last.reason === "last-option", "the last option cannot be removed");

  // deleting the FIRST option re-mirrors quoteId to the new first
  const extra = await addOption(project.id, { name: "Second", by: "tester" });
  const secondId = extra.ok ? extra.option.id : "";
  await setOptionQuote(project.id, secondId, "Q-SECOND");
  const rmFirst = await removeOption(project.id, base, "tester");
  assert.ok(rmFirst.ok, "removing the first option is allowed when another exists");
  assert.equal((await getProject(project.id))!.quoteId, "Q-SECOND", "quoteId mirror follows the new first option");

  console.log("PASS grid-options store scenario");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL grid-options store scenario");
    console.error(e);
    process.exit(1);
  });
```

Add to `package.json` `"scripts"` right after the `"test:review:regressions"` line:

```json
    "test:grid-options": "TEST_DB=$(mktemp -d) && PGLITE_PATH=\"$TEST_DB\" tsx scripts/test-grid-options.ts",
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:grid-options 2>&1 | tail -5
```
Expected: tsx compile/import error naming `addOption` (not exported).

- [ ] **Step 3: Implement the store changes**

In `src/lib/stores/grid-projects.ts`, extend the grid-options import:
```ts
import {
  copyOptionMembers,
  ensureOptions,
  hasOption,
  syncQuoteMirror,
  type GridOption,
} from "@/lib/design/grid-options";
import type { AState, QuickScopeInputs, TierKey } from "@/app/(app)/design/quick/engine";
```
(remove the older `import type { AState, QuickScopeInputs }` line so the type import isn't duplicated).

Replace `addPlacement`:
```ts
export async function addPlacement(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; optionId: string; by: string }
): Promise<GridProject | null> {
  const project = await getProject(projectId);
  if (!project || !hasOption(project, input.optionId)) return null;
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    ensureOptions(p);
    p.placements = [
      ...(p.placements || []),
      {
        id: rid("gp-"),
        sheetId: input.sheetId,
        page: input.page,
        x: input.x,
        y: input.y,
        partId: input.partId,
        optionId: input.optionId,
        by: input.by,
        at: Date.now(),
      },
    ];
    p.updatedAt = Date.now();
  });
}
```

In `addPlacements`: add `optionId: string;` to the input type (after `page: number;`), add the same pre-read guard as the first two lines of the function body (`const project = await getProject(projectId); if (!project || !hasOption(project, input.optionId)) return null;` — keep the existing `if (!input.items.length) return getProject(projectId);` line above it), call `ensureOptions(p);` as the first line of the patch callback, and add `optionId: input.optionId,` to the mapped placement right after `partId: item.partId,`.

In `addCurtainPlacement`: add `optionId: string;` to the input type (after `category?: string;`), the same pre-read guard at the top, `ensureOptions(p);` first in the callback, and `optionId: input.optionId,` right after `curtain: input.curtain,`.

In `addRoute`: add `optionId: string;` to the input type (after `aspect: number;`), the same pre-read guard at the top, `ensureOptions(p);` first in the callback, and `optionId: input.optionId,` right after `aspect: input.aspect,`.

Replace `setQuote` with:
```ts
/** Store the draft quote minted from ONE option (Spec 1). `project.quoteId`
 *  is re-mirrored from the first option every time. */
export async function setOptionQuote(
  projectId: string,
  optionId: string,
  quoteId: string
): Promise<GridProject | null> {
  const project = await getProject(projectId);
  if (!project || !hasOption(project, optionId)) return null;
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, quoteId } : o));
    syncQuoteMirror(doc);
    p.updatedAt = Date.now();
  });
}

/** TEMPORARY alias until Task 4 rewrites createDraftQuoteAction — stores on the first option. */
export async function setQuote(projectId: string, quoteId: string): Promise<GridProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  return setOptionQuote(projectId, ensureOptions(project).options[0].id, quoteId);
}
```

Add a new section after the routes section (before `/* ----------------------------- revisions ----------------------------- */`):
```ts
/* ------------------------------ options (Spec 1) ------------------------------ */

export async function addOption(
  projectId: string,
  input: { name: string; copyFromOptionId?: string; tier?: TierKey; by: string }
): Promise<{ ok: true; option: GridOption } | { ok: false; reason: "not-found" | "empty-name" | "no-such-option" }> {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "empty-name" };
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (input.copyFromOptionId && !hasOption(project, input.copyFromOptionId)) return { ok: false, reason: "no-such-option" };
  const at = Date.now();
  const option: GridOption = { id: rid("opt-"), name, quoteId: null, createdAt: at, ...(input.tier ? { tier: input.tier } : {}) };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = [...doc.options, option];
    if (input.copyFromOptionId) {
      const copied = copyOptionMembers({
        placements: doc.placements || [],
        routes: doc.routes || [],
        fromOptionId: input.copyFromOptionId,
        toOptionId: option.id,
        makeId: (prefix) => rid(prefix),
        by: input.by,
        at,
      });
      doc.placements = [...(doc.placements || []), ...copied.placements];
      doc.routes = [...(doc.routes || []), ...copied.routes];
    }
    p.updatedAt = at;
  });
  return updated ? { ok: true, option } : { ok: false, reason: "not-found" };
}

export async function renameOption(
  projectId: string,
  optionId: string,
  name: string
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "empty-name" | "no-such-option" }> {
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "empty-name" };
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (!hasOption(project, optionId)) return { ok: false, reason: "no-such-option" };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, name: clean } : o));
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, reason: "not-found" };
}

/**
 * Remove an option and every placement/route tagged with it, in one patch,
 * after cutting a revision (non-destructive by construction, D109 idiom).
 * The option's draft quote, if any, is left in the Quotes hub. Refuses the
 * last option: a project always has ≥1.
 */
export async function removeOption(
  projectId: string,
  optionId: string,
  by: string
): Promise<
  | { ok: true; removedPlacements: number; removedRoutes: number }
  | { ok: false; reason: "not-found" | "no-such-option" | "last-option" }
> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  const opts = ensureOptions(project).options;
  const target = opts.find((o) => o.id === optionId);
  if (!target) return { ok: false, reason: "no-such-option" };
  if (opts.length <= 1) return { ok: false, reason: "last-option" };
  let removedPlacements = 0;
  let removedRoutes = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    pushRevision(doc, by, "manual", `Auto-saved before removing option ${target.name}`);
    const keepP = (doc.placements || []).filter((pl) => pl.optionId !== optionId);
    const keepR = (doc.routes || []).filter((r) => r.optionId !== optionId);
    removedPlacements = (doc.placements || []).length - keepP.length;
    removedRoutes = (doc.routes || []).length - keepR.length;
    doc.placements = keepP;
    doc.routes = keepR;
    doc.options = doc.options.filter((o) => o.id !== optionId);
    syncQuoteMirror(doc);
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true, removedPlacements, removedRoutes } : { ok: false, reason: "not-found" };
}
```

`pushRevision` is declared further down the file as a function declaration, so it hoists — no reorder needed.

- [ ] **Step 4: Update the member actions and add option actions**

In `src/app/(app)/design/grid/[id]/actions.ts`:

Extend the store import list with `addOption, removeOption, renameOption, setOptionQuote` (keep `setQuote` for now) and add:
```ts
import { hasOption, resolveOptionId } from "@/lib/design/grid-options";
```

Add a helper next to `editorPath`:
```ts
const OPTION_GONE = "That option was removed — refresh the page.";
```

`placeDeviceAction`:
```ts
export async function placeDeviceAction(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; optionId: string }
): Promise<Result> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
  const p = await addPlacement(projectId, { ...input, by: user.name });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}
```

`placeCurtainAction`: add `optionId: string;` to the input type after `category?: string;`; after the fabric check and before building `curtain`, add:
```ts
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
```
and pass `optionId: input.optionId,` into `addCurtainPlacement` (after `category: …,`).

`addRouteAction`: add `optionId: string;` to the input type after `aspect: number;`; right after the existing `if (!project) return { ok: false, error: "Design not found." };` add `if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };`. The spread `...input` already carries `optionId` into `addRoute`.

`seedStartingLayoutAction` (kept for Spec 2, no UI calls it after Task 5): in its `addPlacements` call add `optionId: resolveOptionId(project, null),` after `page: 1,`.

Append the option actions after `restoreRevisionAction`:
```ts
/* ------------------------------ options (Spec 1) ------------------------------ */

export async function addOptionAction(
  projectId: string,
  input: { name: string; copyFromOptionId?: string | null }
): Promise<{ ok: true; optionId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await addOption(projectId, {
    name: input.name,
    ...(input.copyFromOptionId ? { copyFromOptionId: input.copyFromOptionId } : {}),
    by: user.name,
  });
  if (!r.ok) {
    if (r.reason === "empty-name") return { ok: false, error: "Name the option — 'Good', 'Better', 'Alternate'…" };
    if (r.reason === "no-such-option") return { ok: false, error: OPTION_GONE };
    return { ok: false, error: "Design not found." };
  }
  revalidatePath(editorPath(projectId));
  return { ok: true, optionId: r.option.id };
}

export async function renameOptionAction(projectId: string, optionId: string, name: string): Promise<Result> {
  await requireUser();
  const r = await renameOption(projectId, optionId, name);
  if (!r.ok) {
    if (r.reason === "empty-name") return { ok: false, error: "An option needs a name." };
    if (r.reason === "no-such-option") return { ok: false, error: OPTION_GONE };
    return { ok: false, error: "Design not found." };
  }
  revalidatePath(editorPath(projectId));
  return { ok: true };
}

export async function removeOptionAction(
  projectId: string,
  optionId: string
): Promise<{ ok: true; removedPlacements: number; removedRoutes: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await removeOption(projectId, optionId, user.name);
  if (!r.ok) {
    if (r.reason === "last-option") return { ok: false, error: "A design keeps at least one option — add another before removing this one." };
    if (r.reason === "no-such-option") return { ok: false, error: OPTION_GONE };
    return { ok: false, error: "Design not found." };
  }
  revalidatePath(editorPath(projectId));
  return { ok: true, removedPlacements: r.removedPlacements, removedRoutes: r.removedRoutes };
}
```

The editor still calls the old action shapes (no `optionId`) — tsc will flag `placeDeviceAction`/`placeCurtainAction`/`addRouteAction` call sites in `editor.tsx`. **Do the minimal bridge now** so the branch stays green: in `editor.tsx` add `optionId: project.options[0].id,` to those three calls (lines ~858, ~941, ~796) and add `options: GridOption[];` to `ProjectLite` plus `options: project.options || [],` in `page.tsx`'s `project={{ … }}` literal (import `type GridOption` from `@/lib/stores/grid-projects` in editor.tsx). Task 5 replaces `project.options[0].id` with the active option.

- [ ] **Step 5: Run the scenario, tsc, and specs**

```bash
ps aux | grep -c "[t]sx"
npm run test:grid-options 2>&1 | tail -3
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
ps aux | grep -c "[t]sx"
```
Expected: `0` strays before and after; `PASS grid-options store scenario`; tsc `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/grid-projects.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" scripts/test-grid-options.ts package.json
```
```bash
git commit -F - <<'EOF'
feat(grid): option CRUD in the store, member writes stamp optionId, option actions (Spec 1, Task 2)

addOption (empty or copy with id remap), renameOption, removeOption (never
the last; cuts a revision; deletes that option's members), setOptionQuote
with the project.quoteId mirror. Scratch-DB scenario in
scripts/test-grid-options.ts (npm run test:grid-options).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Riser and schedule pages read one option (`?option=`)

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/riser/page.tsx`
- Modify: `src/app/(app)/design/grid/[id]/schedule/page.tsx`

**Interfaces:**
- Consumes: `resolveOptionId`, `optionSlice` (Task 1).
- Produces: both routes accept `?option=<id>`; heading shows `· <option name>` when the project has >1 option; the back-link keeps `?option=`.

- [ ] **Step 1: Riser page**

In `riser/page.tsx`:

Add import:
```ts
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
```

Change the component signature and the graph inputs:
```ts
export default async function RiserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
```
After the `if (!project)` block:
```ts
  const optionId = resolveOptionId(project, requestedOption);
  const option = project.options!.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;
```
Replace the first two `riserGraph(...)` arguments `project.placements || [], project.routes || [],` with `slice.placements, slice.routes,`.

Back-link: `href={`/design/grid/${encodeURIComponent(project.id)}${optionQuery}`}`.

Heading span: after `{project.name}` insert
```tsx
          {project.options!.length > 1 ? ` · ${option.name}` : ""}
```

- [ ] **Step 2: Schedule page**

Same four edits in `schedule/page.tsx`: import, `searchParams` in the signature + `requestedOption`, the `optionId/option/slice/optionQuery` block after the not-found guard, then replace `const placements = project.placements || [];` with `const placements = slice.placements;` and `const routes = project.routes || [];` with `const routes = slice.routes;`. Back-link gets `${optionQuery}`. In the header `<div style={{ fontSize: "17pt", … }}>{project.name}</div>` append `{project.options!.length > 1 ? ` · ${option.name}` : ""}` inside the div after `{project.name}`.

- [ ] **Step 3: Verify**

```bash
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
```
Expected `0`. (Route rendering is covered by the smoke additions in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/riser/page.tsx" "src/app/(app)/design/grid/[id]/schedule/page.tsx"
```
```bash
git commit -F - <<'EOF'
feat(grid): riser + schedule render one option (?option=) (Spec 1, Task 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Per-option quote minting (`grid-quote.ts` extraction)

**Files:**
- Create: `src/lib/design/grid-quote.ts`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`createDraftQuoteAction` at ~lines 620–815 after Task 2's insertions)
- Modify: `src/app/(app)/design/designs/actions.ts` (`promoteDesignAction`, line ~66)
- Modify: `src/lib/stores/grid-projects.ts` (delete the temporary `setQuote` alias)
- Modify: `scripts/test-grid-options.ts` (append pricing checks)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/design/grid-quote.ts
  export type GridQuoteBuild = {
    lines: BomLine[]; value: number; margin: number; fallbackLines: string[];
    spec: { kind: "grid"; gridProjectId: string; gridOptionId: string; lines: Array<{ sku: string; desc: string; qty: number; unit: string; price: number; ext: number; tierFallback?: true }> };
    tier: { tier: string; margin: number }; locationId: string | null; quoteName: string;
  };
  export async function buildGridQuote(project: GridProject, optionId: string, laborLines?: Array<{ partId: string; hours: number }>): Promise<{ ok: true; build: GridQuoteBuild } | { ok: false; error: string }>;
  ```
  ```ts
  // action
  createDraftQuoteAction(projectId: string, optionId: string | null, laborLines?): Promise<{ ok: true; quoteId: string; updated: boolean; fallbackLines: string[] } | { ok: false; error: string }>
  ```
  `optionId: null` → the project's first option (used by `promoteDesignAction`).

- [ ] **Step 1: Append failing pricing checks to the scenario**

In `scripts/test-grid-options.ts`, add imports:
```ts
import { buildGridQuote } from "@/lib/design/grid-quote";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
```
and, inside `main()` right before `console.log("PASS grid-options store scenario");`, add:
```ts
  // ---- per-option pricing (Task 4) ----
  const catalog = await listCatalog();
  const pricingById = new Map(catalog.map((c) => [c.id, c]));
  const symbols = await listGridSymbols();
  const priced = symbols.filter((s) => s.pricingPartId && (pricingById.get(s.pricingPartId)?.list || 0) > 0);
  assert.ok(priced.length >= 2, "the seed catalog exposes at least two priced Grid symbols");
  const [symA, symB] = priced;

  const q0 = await createProject({ name: "Priced options", customer: "Test Co", customerId: null, by: "tester" });
  const qSheet = (await addSheet(q0.id, { name: "Sheet", mime: "image/svg+xml", dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E", by: "tester" }))!;
  const qBase = (await getProject(q0.id))!.options![0].id;
  const qGood = await addOption(q0.id, { name: "Good", by: "tester" });
  const goodId = qGood.ok ? qGood.option.id : "";
  await addPlacement(q0.id, { sheetId: qSheet.id, page: 1, x: 0.2, y: 0.2, partId: symA.id, optionId: qBase, by: "tester" });
  await addPlacement(q0.id, { sheetId: qSheet.id, page: 1, x: 0.3, y: 0.2, partId: symA.id, optionId: qBase, by: "tester" });
  await addPlacement(q0.id, { sheetId: qSheet.id, page: 1, x: 0.2, y: 0.4, partId: symB.id, optionId: goodId, by: "tester" });

  const qp = (await getProject(q0.id))!;
  const bBase = await buildGridQuote(qp, qBase);
  const bGood = await buildGridQuote(qp, goodId);
  assert.ok(bBase.ok && bGood.ok, "buildGridQuote prices both options");
  if (bBase.ok && bGood.ok) {
    assert.equal(bBase.build.lines.length, 1, "base option prices one grouped device line (2× symA)");
    assert.equal(bBase.build.lines[0].qty, 2, "base option line qty is 2");
    assert.equal(bGood.build.lines.length, 1, "good option prices its own single line");
    assert.equal(bGood.build.lines[0].partId, symB.id, "good option line is symB, not symA");
    assert.equal(bBase.build.spec.gridOptionId, qBase, "spec carries the option id");
    assert.ok(bBase.build.quoteName.endsWith(" · Design — The Grid design"), `quote name carries the option name when >1 option (got ${bBase.build.quoteName})`);
  }
  const empty = await buildGridQuote(qp, (await addOption(q0.id, { name: "Empty", by: "tester" })).ok ? (await getProject(q0.id))!.options!.at(-1)!.id : "");
  assert.ok(!empty.ok && /Place a device/.test(empty.error), "an option with no members refuses to price");
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:grid-options 2>&1 | tail -3
```
Expected: import error for `@/lib/design/grid-quote`.

- [ ] **Step 3: Create `grid-quote.ts`**

`src/lib/design/grid-quote.ts` — the body of today's `createDraftQuoteAction` from `const placements = …` through `const spec = { … }` moved verbatim, parameterized by option. Server lib (imports stores), no session:

```ts
/**
 * Grid → quote pricing (Spec 1, Task 4). Lifted verbatim out of
 * createDraftQuoteAction so the same math prices ONE OPTION of a project
 * and can be exercised on a scratch database without a session. Every
 * comment about tier pricing, #63/#76 fallbacks, #49 curtains and D114
 * labor still applies — the logic is unchanged, only the input slice is.
 */

import { getSite, docLocId } from "@/lib/identity/sites";
import { resolveTier } from "@/lib/pricing-tiers";
import { isTierPriced } from "@/lib/tier-pricing";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import type { GridProject } from "@/lib/stores/grid-projects";
import { bomLines, bomTotals, curtainLines, routeLines, type BomLine } from "@/lib/design/grid-bom";
import { isFabricRow, priceGridCurtains } from "@/lib/design/grid-curtains";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";

export type GridQuoteSpecLine = {
  sku: string; desc: string; qty: number; unit: string; price: number; ext: number; tierFallback?: true;
};

export type GridQuoteBuild = {
  lines: BomLine[];
  value: number;
  margin: number;
  fallbackLines: string[];
  spec: { kind: "grid"; gridProjectId: string; gridOptionId: string; lines: GridQuoteSpecLine[] };
  tier: { tier: string; margin: number };
  locationId: string | null;
  quoteName: string;
};

export async function buildGridQuote(
  project: GridProject,
  optionId: string,
  laborLines?: Array<{ partId: string; hours: number }>
): Promise<{ ok: true; build: GridQuoteBuild } | { ok: false; error: string }> {
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const option = ensureOptions(project).options.find((o) => o.id === optionId)!;
  const { placements, routes } = optionSlice(project, optionId);
  if (!placements.length && !routes.length)
    return { ok: false, error: "Place a device or route a wire first." };

  // Unresolved seed placeholders (D147) must not silently price at $0 (#64 idiom).
  const unresolvedSeeds = placements.filter((p) => isSeedPlaceholder(p.partId));
  if (unresolvedSeeds.length) {
    const names = Array.from(new Set(unresolvedSeeds.map((p) => p.category || p.partId))).sort();
    return {
      ok: false,
      error:
        `${unresolvedSeeds.length} seeded device${unresolvedSeeds.length === 1 ? "" : "s"} ` +
        `still need${unresolvedSeeds.length === 1 ? "s" : ""} a real catalog part before this can ` +
        `price: ${names.join(", ")}. Delete and re-drop each from the catalog, then try again.`,
    };
  }

  const tier = await resolveTier(project.customerId);
  const catalog = await listCatalog();
  const symbols = await listGridSymbols();
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const gridCatalog = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    return p
      ? { ...p, id: s.id, sku: s.modelNumber || p.sku, desc: s.name }
      : { id: s.id, sku: s.modelNumber || s.id, desc: s.name, category: s.category, unit: "ea", list: 0, cost: 0, ports: s.ports };
  });
  const tierSource = [...gridCatalog, ...catalog.filter((p) => (p.role || "").toLowerCase() === "labor")];
  const tierCatalog = tierSource.map((p) => ({
    ...p,
    list: isTierPriced(p.cost, tier.margin) ? Math.round((p.cost / (1 - tier.margin)) * 100) / 100 : p.list,
  }));
  const fallbackKeys = new Set(
    gridCatalog.filter((p) => !isTierPriced(p.cost, tier.margin)).flatMap((p) => [p.id, p.sku])
  );
  const isFallbackLine = (l: Pick<BomLine, "partId" | "kind">) => l.kind !== "curtain" && fallbackKeys.has(l.partId);

  const devLines = bomLines(placements, tierCatalog);
  const devTotals = bomTotals(placements, tierCatalog);
  const wires = routeLines(routes, tierCatalog, project.calibrations || []);

  const curtainPrices = priceGridCurtains(placements, catalog, tier.margin);
  const fabricNames = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p.desc] as const));
  const curtains = curtainLines(placements, new Map([...curtainPrices].map(([id, v]) => [id, v.priceEach])), fabricNames);
  const curtainValue = curtains.reduce((a, l) => a + l.ext, 0);
  const curtainCostTotal = [...curtainPrices.values()].reduce((a, v) => a + v.costEach, 0);

  const labor: Array<{ sku: string; desc: string; qty: number; unit: string; price: number; ext: number; cost: number }> = [];
  for (const l of laborLines || []) {
    const part = tierCatalog.find((p) => p.id === l.partId);
    const hours = Number(l.hours);
    if (!part || (part.role || "").toLowerCase() !== "labor") continue;
    if (!(hours > 0) || hours > 10000) continue;
    labor.push({ sku: part.sku, desc: part.desc, qty: hours, unit: part.unit || "hr", price: part.list, ext: hours * part.list, cost: hours * part.cost });
  }

  const lines: BomLine[] = [
    ...devLines,
    ...wires.lines,
    ...curtains,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + wires.value + curtainValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + wires.cost + curtainCostTotal + labor.reduce((a, l) => a + l.cost, 0);
  const margin = value > 0 ? (value - cost) / value : 0;
  const fallbackLines = lines.filter(isFallbackLine).map((l) => l.desc);

  const site = project.siteId ? await getSite(project.siteId) : null;
  const locationId = site ? docLocId(site) : null;
  const spec = {
    kind: "grid" as const,
    gridProjectId: project.id,
    gridOptionId: optionId,
    lines: lines.map((l) => ({
      sku: l.kind === "curtain" ? "CURTAIN" : l.partId,
      desc: l.desc,
      qty: l.qty,
      unit: l.unit,
      price: l.list,
      ext: l.ext,
      ...(isFallbackLine(l) ? { tierFallback: true as const } : {}),
    })),
  };
  const manyOptions = ensureOptions(project).options.length > 1;
  const quoteName = `${project.name}${manyOptions ? ` · ${option.name}` : ""} — The Grid design`;

  return { ok: true, build: { lines, value, margin, fallbackLines, spec, tier: { tier: tier.tier, margin: tier.margin }, locationId, quoteName } };
}
```

Check `BomLine` has a `kind` field and `partId` (it does — the action already used `l.kind === "curtain"` and `l.partId`). If `docLocId`/`getSite` are exported from `@/lib/identity/sites` under those exact names (they are — the action imports them today).

- [ ] **Step 4: Rewrite `createDraftQuoteAction`**

Replace the whole function in `actions.ts` with:
```ts
export async function createDraftQuoteAction(
  projectId: string,
  optionId: string | null,
  laborLines?: Array<{ partId: string; hours: number }>
): Promise<
  | { ok: true; quoteId: string; updated: boolean; fallbackLines: string[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const resolvedOptionId = resolveOptionId(project, optionId);
  if (optionId && resolvedOptionId !== optionId) return { ok: false, error: OPTION_GONE };
  const option = project.options!.find((o) => o.id === resolvedOptionId)!;

  const built = await buildGridQuote(project, resolvedOptionId, laborLines);
  if (!built.ok) return built;
  const { build } = built;

  const existing = option.quoteId ? await getQuote(option.quoteId) : null;
  if (existing) {
    if (existing.status !== "draft")
      return { ok: false, error: `${existing.id} is already ${existing.status} — cut a revision from the quote screen instead.` };
    await updateQuote(existing.id, {
      name: build.quoteName,
      value: build.value,
      margin: build.margin,
      locationId: build.locationId,
      pricingTier: build.tier.tier,
      tierMargin: build.tier.margin,
      spec: build.spec,
    });
    await addRevision(projectId, { by: user.name, reason: "quote", note: `${option.name} quoted as ${existing.id}` });
    revalidatePath(editorPath(projectId));
    revalidatePath("/quotes");
    revalidatePath("/design/designs");
    return { ok: true, quoteId: existing.id, updated: true, fallbackLines: build.fallbackLines };
  }

  const q = await createQuote({
    name: build.quoteName,
    customer: project.customer,
    customerId: project.customerId,
    locationId: build.locationId,
    value: build.value,
    margin: build.margin,
    pricingTier: build.tier.tier,
    tierMargin: build.tier.margin,
    source: "grid",
    quoteType: "system",
    owner: user.name,
    spec: build.spec,
  });
  await setOptionQuote(project.id, resolvedOptionId, q.id);
  await addRevision(projectId, { by: user.name, reason: "quote", note: `${option.name} quoted as ${q.id}` });
  revalidatePath(editorPath(projectId));
  revalidatePath("/quotes");
  revalidatePath("/design/designs");
  return { ok: true, quoteId: q.id, updated: false, fallbackLines: build.fallbackLines };
}
```
Add `import { buildGridQuote } from "@/lib/design/grid-quote";`. Remove now-unused imports from `actions.ts`: `setQuote`, `isTierPriced`, `resolveTier`, `docLocId`/`getSite` **only if** nothing else in the file uses them (grep each; `getSite` is also used by `setVenueAction` — keep it), and the `bomLines/bomTotals/curtainLines/routeLines` names if unused elsewhere in the file (`isPerLengthUnit` stays — `addRouteAction` uses it). Run eslint on the file to confirm no unused imports remain.

Delete the temporary `setQuote` alias from `grid-projects.ts`.

In `src/app/(app)/design/designs/actions.ts` `promoteDesignAction`: `createDraftQuoteAction(d.gridProjectId)` → `createDraftQuoteAction(d.gridProjectId, null)`.

In `editor.tsx` the existing call becomes `createDraftQuoteAction(project.id, project.options[0].id, includedLabor.map(…))` (Task 5 swaps in the active option).

- [ ] **Step 5: Run scenario, tsc, eslint on touched files**

```bash
npm run test:grid-options 2>&1 | tail -3
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
./node_modules/.bin/eslint "src/app/(app)/design/grid/[id]/actions.ts" src/lib/design/grid-quote.ts 2>&1 | tail -5
```
Expected: `PASS grid-options store scenario`; tsc `0`; eslint reports no `no-unused-vars` for those two files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/grid-quote.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/designs/actions.ts" src/lib/stores/grid-projects.ts scripts/test-grid-options.ts
```
```bash
git commit -F - <<'EOF'
feat(grid): draft quotes mint per option; pricing extracted to lib/design/grid-quote (Spec 1, Task 4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Editor — active option, sliced reads, switcher, stamped writes, seed UI removed

**Files:**
- Create: `src/app/(app)/design/grid/[id]/option-switcher.tsx`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (signature + `project={{…}}` literal)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`
- Modify: `src/app/(app)/design/grid/[id]/scope-panel.tsx` (`defaultTier` prop)

**Interfaces:**
- Consumes: Task 2 actions, `resolveOptionId`/`optionSlice`.
- Produces: `GridEditor` prop `activeOptionId: string`; `ProjectLite.options: GridOption[]`; `OptionSwitcher` component.

- [ ] **Step 1: page.tsx passes the resolved active option**

In `page.tsx`, change the signature to accept `searchParams`:
```ts
export default async function GridEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
```
Add `import { resolveOptionId } from "@/lib/design/grid-options";`. After the intake gate, add `const activeOptionId = resolveOptionId(project, requestedOption);`. In the `<GridEditor …>` element add `activeOptionId={activeOptionId}` and, inside `project={{ … }}`, ensure `options: project.options || [],` is present (Task 2 added it) and **remove** `autoConfig: project.intake?.autoConfig,` and `measurementBased: !!project.intake?.measurementBased,`.

- [ ] **Step 2: Create the switcher component**

`src/app/(app)/design/grid/[id]/option-switcher.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { GridOption } from "@/lib/stores/grid-projects";
import { addOptionAction, removeOptionAction, renameOptionAction } from "./actions";

/**
 * Option switcher (Spec 1) — segmented control over a project's options
 * (Good / Better / Best, or whatever the designer named them) with add /
 * rename / delete. The ACTIVE option lives in the URL (?option=) so the
 * editor, riser, schedule and quote minting all agree; switching is a soft
 * navigation the parent performs via `onSwitch`.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff", borderRadius: 7, padding: "5px 10px",
  fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};
const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8", borderRadius: 7,
  padding: "5px 8px", fontSize: 12, fontFamily: "inherit", background: "#fff", color: "#16181d", width: 150,
};

export default function OptionSwitcher({
  projectId,
  options,
  activeId,
  counts,
  busy,
  onSwitch,
  onChanged,
  onError,
}: {
  projectId: string;
  options: GridOption[];
  activeId: string;
  /** placed device count per option id (for the segment badge). */
  counts: Map<string, number>;
  busy: boolean;
  onSwitch: (optionId: string) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "add" | "rename" | "delete">("idle");
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(true);
  const [pending, setPending] = useState(false);
  const active = options.find((o) => o.id === activeId) || options[0];
  const activeCount = counts.get(active.id) || 0;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, after?: (r: Record<string, unknown>) => void) => {
    setPending(true);
    const r = await fn();
    setPending(false);
    if (!r.ok) { onError(r.error || "Something went wrong."); return; }
    setMode("idle");
    setName("");
    after?.(r);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} title="Design options — each has its own devices, wire runs, BOM and quote; sheets and spaces are shared">
      <div style={{ display: "inline-flex", border: "1px solid #dfe2e8", borderRadius: 7, overflow: "hidden" }}>
        {options.map((o) => {
          const on = o.id === active.id;
          return (
            <button
              key={o.id}
              onClick={() => onSwitch(o.id)}
              disabled={busy || pending}
              style={{
                border: "none", borderRight: "1px solid #eceef2", padding: "5px 10px",
                background: on ? "#16181d" : "#fff", color: on ? "#fff" : "#3d424e",
                fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {o.name}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, opacity: 0.7 }}>{counts.get(o.id) || 0}</span>
            </button>
          );
        })}
      </div>

      {mode === "idle" && (
        <>
          <button style={BTN} disabled={busy || pending} onClick={() => { setMode("add"); setName(""); setCopy(activeCount > 0); }}>+ Option</button>
          <button style={BTN} disabled={busy || pending} onClick={() => { setMode("rename"); setName(active.name); }}>Rename</button>
          <button
            style={{ ...BTN, color: options.length <= 1 ? "#b6bac2" : "#a0442b" }}
            disabled={busy || pending || options.length <= 1}
            title={options.length <= 1 ? "A design keeps at least one option" : `Remove ${active.name} and everything placed in it`}
            onClick={() => setMode("delete")}
          >
            Delete
          </button>
        </>
      )}

      {mode === "add" && (
        <>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Option name (e.g. Better)" style={INPUT}
            onKeyDown={(e) => { if (e.key === "Escape") setMode("idle"); }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#3d424e" }}>
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Copy {active.name}
          </label>
          <button style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending || !name.trim()}
            onClick={() => run(() => addOptionAction(projectId, { name, copyFromOptionId: copy ? active.id : null }), (r) => { onChanged(); onSwitch(String(r.optionId)); })}>
            {pending ? "Adding…" : "Add"}
          </button>
          <button style={BTN} disabled={pending} onClick={() => setMode("idle")}>Cancel</button>
        </>
      )}

      {mode === "rename" && (
        <>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={INPUT}
            onKeyDown={(e) => { if (e.key === "Escape") setMode("idle"); }} />
          <button style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending || !name.trim()}
            onClick={() => run(() => renameOptionAction(projectId, active.id, name), () => onChanged())}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button style={BTN} disabled={pending} onClick={() => setMode("idle")}>Cancel</button>
        </>
      )}

      {mode === "delete" && (
        <>
          <span style={{ fontSize: 11.5, color: "#5b616e" }}>
            Removes {activeCount} device{activeCount === 1 ? "" : "s"} and their wire runs from <strong>{active.name}</strong>. Sheets, spaces and other options are untouched.
          </span>
          <button style={{ ...BTN, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }} disabled={pending}
            onClick={() => run(() => removeOptionAction(projectId, active.id), () => { onChanged(); onSwitch(options.find((o) => o.id !== active.id)!.id); })}>
            {pending ? "Removing…" : `Delete ${active.name}`}
          </button>
          <button style={BTN} disabled={pending} onClick={() => setMode("idle")}>Cancel</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Editor plumbing**

In `editor.tsx`:

1. Imports: add `import { usePathname } from "next/navigation";` (extend the existing `useRouter` import line: `import { usePathname, useRouter } from "next/navigation";`), `import { optionSlice } from "@/lib/design/grid-options";`, `import OptionSwitcher from "./option-switcher";`. Change the grid-seed import to `import { isSeedPlaceholder } from "@/lib/design/grid-seed";`. Remove `seedStartingLayoutAction,` from the `./actions` import.

2. `ProjectLite`: remove `autoConfig?: AState;` and `measurementBased: boolean;` (and their comment lines); keep `options: GridOption[];`. Remove the now-unused `import type { AState } …` line if `AState` has no other use in the file (grep).

3. Props: add `activeOptionId: string;` to the component's props type with the doc comment `/** Resolved by page.tsx from ?option= — always a real option id. */`, and destructure it.

4. State: delete `const [armSeed, setArmSeed] = useState(false);` and the adjacent `const [seeding, setSeeding] = useState(false);`. Delete the `pendingSeed` `useMemo` block (the comment starting `/** "Generate starting layout" pending count` through its closing `}, [...]);`).

5. Active slice — add right after `const router = useRouter();`:
```ts
  const pathname = usePathname();
  /** Members of the ACTIVE option only (Spec 1). Every read below goes
   *  through this slice; the whole-project arrays are used only for the
   *  switcher's per-option counts. */
  const active = useMemo(() => optionSlice(project, activeOptionId), [project, activeOptionId]);
  const placements = active.placements;
  const routes = active.routes;
  const optionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of project.placements) m.set(pl.optionId || project.options[0].id, (m.get(pl.optionId || project.options[0].id) || 0) + 1);
    return m;
  }, [project.placements, project.options]);
  const activeOption = project.options.find((o) => o.id === activeOptionId) || project.options[0];
  const switchOption = useCallback(
    (id: string) => {
      setSelected(null);
      router.replace(`${pathname}?option=${encodeURIComponent(id)}`, { scroll: false });
    },
    [pathname, router]
  );
```
`setSelected` is declared later in the file — move the `const [selected, setSelected] = useState<string | null>(null);` line up above this block.

6. Replace every read of `project.placements` and `project.routes` **below this block** with `placements` / `routes` (the memo deps too). Use `grep -n "project\.placements\|project\.routes" editor.tsx` — after the edit the only remaining hits are inside the `optionCounts` memo. Concretely this touches: `scopeCounts`, `categoryCounts`, `placementOffsets`, `sheetPlacements`, `pageRoutes`, `lines`, `totals`, `wires`, `curtainPrices`, `curtains`, `laborSuggestions`, `spaceRollups`, `projectScopeRollup`, `selectedPlacement`, `commitMove`, the wire-drawing hit-test that looks up `fromPlacement`/`toPlacement`, and the device-marker/route render loops.

7. Stamp writes: in the `placeDeviceAction`, `placeCurtainAction`, and `addRouteAction` calls replace `optionId: project.options[0].id,` (Task 2's bridge) with `optionId: activeOptionId,`. Same in the `createDraftQuoteAction(project.id, project.options[0].id, …)` call → `activeOptionId`.

8. Quote button + links use the active option: `{activeOption.quoteId ? `Update draft quote ${activeOption.quoteId}` : "Create draft quote"}`; the two `project.quoteId &&` guards below it become `activeOption.quoteId &&`. Riser/Schedule links: append `?option=${encodeURIComponent(activeOptionId)}` to both hrefs.

9. Mount the switcher in the header right after the sheets `<select>…</select>` block's closing `)}` and before the `+ Additional sheet` button:
```tsx
        <OptionSwitcher
          projectId={project.id}
          options={project.options}
          activeId={activeOptionId}
          counts={optionCounts}
          busy={busy}
          onSwitch={switchOption}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
```

10. Remove the seed UI: delete the `{project.autoConfig ? <span …>Auto brief saved</span> : null}` line and the whole block from `{project.measurementBased && project.autoConfig && sheets.length > 0 && (` through the `{armSeed && ( … )}` span's closing `)}`.

11. Scope panel: `<ScopePanel key={activeOptionId} defaultTier={activeOption.tier} … />` (key remounts per option so the tier lens resets to that option's tier).

12. In `scope-panel.tsx` add the prop:
```ts
  /** Active option's tier (Spec 1) — the lens' initial value, never a gate. */
  defaultTier?: TierKey;
```
and `const [tierKey, setTierKey] = useState<TierKey>(defaultTier ?? "better");`.

- [ ] **Step 4: Verify**

```bash
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
grep -n "project\.placements\|project\.routes\|armSeed\|pendingSeed\|seedStartingLayoutAction\|measurementBased\|autoConfig" "src/app/(app)/design/grid/[id]/editor.tsx"
./node_modules/.bin/eslint "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/option-switcher.tsx" "src/app/(app)/design/grid/[id]/page.tsx" 2>&1 | tail -8
```
Expected: tsc `0`; the grep shows only the two `optionCounts` lines; eslint adds no new errors versus `git show HEAD:"src/app/(app)/design/grid/[id]/editor.tsx"` linted the same way.

Then boot the app on a scratch datadir and click through (per `peak-exercising-post-routes-safely`): open `/design/grid/GRD-5001`, confirm the switcher shows `Design 0`, add an option "Better" (copy unchecked), confirm the URL gains `?option=opt-…`, place a device, switch back to Design and confirm the device is not shown, open Riser → confirm `?option=` in the URL, delete "Better" → confirm the confirm text and that Design is selected afterwards. Stop the server; `ps aux | grep tsx` must show 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/option-switcher.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/scope-panel.tsx"
```
```bash
git commit -F - <<'EOF'
feat(grid): option switcher in the editor; every read/write scoped to the active option; seed button removed (Spec 1, Task 5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 6: Intake — two steps, Manual only, scope inputs + design record on first save

**Files:**
- Create: `src/lib/design/grid-intake.ts`
- Modify: `src/lib/design/grid-scopes.ts` (export `TRACKABLE_SYS_KEYS`)
- Modify: `src/app/(app)/design/grid/[id]/scope-panel.tsx` (import it; delete the local const)
- Modify: `src/lib/stores/grid-projects.ts` (`intake.mode`; delete `seedBlankSheet`)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`saveGridIntakeAction`)
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx` (rewrite)
- Test: `scripts/test-review-and-spec.ts` (pure), `scripts/test-grid-options.ts` (scope/design side effects via the store helper)

**Interfaces:**
- Produces:
  ```ts
  // grid-scopes.ts
  export const TRACKABLE_SYS_KEYS: SysKey[] = ["rigging", "curtains", "lighting", "audio", "video"];
  // grid-intake.ts
  export function manualScopeInputs(a: AState): QuickScopeInputs;   // venue/size/dims from a; sys = venue preset ∩ TRACKABLE_SYS_KEYS
  export function designPatchFromIntake(input: { projectName: string; venueName: string; locationName: string; a: AState }): { name?: string; venue: string; size: string; width: number; depth: number; grid: number };
  ```
  `GridProject.intake.mode?: "auto" | "manual"`; `saveGridIntakeAction` input drops `measurementBased` and gains `mode: "manual"`.

- [ ] **Step 1: Failing pure tests**

Append to the grid-options block in `scripts/test-review-and-spec.ts` (still above `asyncChecks`):
```ts
/* --- Grid intake helpers (Spec 1, Task 6) --- */
{
  const a = { ...defaultAState(0), venue: "pac", size: "large" as const, width: 48, depth: 34, grid: 58, wing: 18, ph: 28 };
  const si = manualScopeInputs(a);
  ok(si.venue === "pac" && si.width === 48 && si.depth === 34 && si.grid === 58 && si.wing === 18 && si.ph === 28, "grid-intake: manualScopeInputs carries venue/size/dims through");
  ok(si.sys.lighting && si.sys.rigging && si.sys.curtains && si.sys.audio && si.sys.video, "grid-intake: PAC preset turns on all five trackable systems");
  ok(!si.sys.controls && !si.sys.acoustical && !si.sys.pit, "grid-intake: non-trackable systems are off even when the preset has them");
  ok(!("tier" in si) && !("placements" in si) && !("qtyOverrides" in si), "grid-intake: AState-only fields are stripped");
  const church = manualScopeInputs({ ...a, venue: "church" });
  ok(!church.sys.rigging && church.sys.video, "grid-intake: preset differences flow through (church: no rigging, video on)");
  const patch = designPatchFromIntake({ projectName: "Untitled system design", venueName: "Main Hall", locationName: "Northshore HS", a });
  ok(patch.name === "Main Hall — Northshore HS" && patch.venue === "pac" && patch.size === "large" && patch.width === 48 && patch.depth === 34 && patch.grid === 58, "grid-intake: designPatchFromIntake names an untitled design from venue + location and copies dims");
  ok(designPatchFromIntake({ projectName: "Already named", venueName: "X", locationName: "", a }).name === undefined, "grid-intake: a named design keeps its name");
  ok(designPatchFromIntake({ projectName: "Untitled system design", venueName: "", locationName: "Only campus", a }).name === "Only campus", "grid-intake: falls back to whichever cover field is filled");
  ok(TRACKABLE_SYS_KEYS.join(",") === "rigging,curtains,lighting,audio,video", "grid-scopes: TRACKABLE_SYS_KEYS is exported in the Scope panel's order");
}
```
Imports to add:
```ts
import { defaultAState } from "@/app/(app)/design/quick/engine";
import { designPatchFromIntake, manualScopeInputs } from "@/lib/design/grid-intake";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
```
(If `defaultAState` is already imported in that file, don't duplicate it.)

- [ ] **Step 2: Run to verify it fails**

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | head -3
```
Expected: `Cannot find module '@/lib/design/grid-intake'`.

- [ ] **Step 3: Implement the pure helpers and the shared constant**

`grid-scopes.ts` — add near `GRID_SCOPES`:
```ts
import type { SysKey } from "@/app/(app)/design/quick/engine";

/** The Quick Design systems the Grid can actually track against placed
 *  catalog parts (Jeff's five scopes). Controls/Acoustical/Pit have no
 *  scope of their own. Order = Scope panel display order. */
export const TRACKABLE_SYS_KEYS: SysKey[] = ["rigging", "curtains", "lighting", "audio", "video"];
```
In `scope-panel.tsx` delete the local `const TRACKABLE_SYS_KEYS …` line and add `TRACKABLE_SYS_KEYS` to the existing `@/lib/design/grid-scopes` import.

`src/lib/design/grid-intake.ts`:
```ts
/**
 * Manual-intake helpers (Spec 1, Task 6). Pure.
 */
import { SYS_ORDER, venueOf, type AState, type QuickScopeInputs, type SysKey } from "@/app/(app)/design/quick/engine";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";

/** Scope inputs seeded from the intake: venue/size/dims as entered, systems
 *  = the venue preset's defaults restricted to the five trackable keys. */
export function manualScopeInputs(a: AState): QuickScopeInputs {
  const preset = venueOf(a);
  const sys = Object.fromEntries(
    SYS_ORDER.map((k) => [k, TRACKABLE_SYS_KEYS.includes(k) && !!preset.sys[k]])
  ) as Record<SysKey, boolean>;
  return {
    venue: a.venue,
    size: a.size,
    width: a.width,
    depth: a.depth,
    grid: a.grid,
    wing: a.wing,
    ph: a.ph,
    sys,
    rigType: a.rigType,
    drape: { ...(a.drape || {}) },
    fixtures: { ...(a.fixtures || {}) },
    fixtureAssemblies: { ...(a.fixtureAssemblies || {}) },
    ctrl: { ...(a.ctrl || {}) },
    shell: { ...(a.shell || {}) },
    pitType: a.pitType,
  };
}

const UNTITLED = "Untitled system design";

/** What the linked DesignRecord learns from a first intake save so the
 *  Designs dashboard card stops showing `? × ? × ?` for manual designs. */
export function designPatchFromIntake(input: {
  projectName: string;
  venueName: string;
  locationName: string;
  a: AState;
}): { name?: string; venue: string; size: string; width: number; depth: number; grid: number } {
  const v = input.venueName.trim();
  const l = input.locationName.trim();
  const derived = v && l ? `${v} — ${l}` : v || l;
  const untitled = !input.projectName.trim() || input.projectName.trim() === UNTITLED;
  return {
    ...(untitled && derived ? { name: derived } : {}),
    venue: input.a.venue,
    size: input.a.size,
    width: input.a.width,
    depth: input.a.depth,
    grid: input.a.grid,
  };
}
```
Confirm `SYS_ORDER` includes all 8 `SysKey`s (engine.ts line ~268) — it does.

- [ ] **Step 4: Store + action**

`grid-projects.ts`: in `GridProject.intake` add `mode?: "auto" | "manual";` after `measurementBased: boolean;` with comment `/** Chosen at intake (Spec 1). Absent on pre-spec docs. Only "manual" is reachable until Spec 2. */`. Delete the whole `seedBlankSheet` function and its doc comment.

`actions.ts` — replace `saveGridIntakeAction`:
```ts
export async function saveGridIntakeAction(input: {
  projectId: string;
  mode: "manual";
  venueName: string;
  locationName: string;
  address: string;
  notes: string;
  autoConfig: AState;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.venueName.trim() && !input.locationName.trim()) return { ok: false, error: "Add a venue or location to continue." };
  if (input.mode !== "manual") return { ok: false, error: "Auto-estimate lands in the next release — choose Manual placement for now." };
  const project = await getProject(input.projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  const saved = await saveGridIntake(input.projectId, {
    complete: true,
    measurementBased: true,
    mode: input.mode,
    venueName: input.venueName.trim(),
    locationName: input.locationName.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
    autoConfig: input.autoConfig,
  });
  if (!saved) return { ok: false, error: "That design could not be found." };
  // First-save gate (D145): the base sheet is generated exactly once. The
  // same gate now also seeds the Scope panel's inputs and the linked design
  // record's dims (Spec 1) — a later re-save of venue details changes none
  // of them, so a designer's later Scope edits are never overwritten.
  const isFirstSave = (saved.sheetIds || []).length === 0;
  if (isFirstSave) {
    await generateBaseSheet(input.projectId, input.autoConfig, "#3a3f4a", user.name);
    await setScopeInputs(input.projectId, manualScopeInputs(input.autoConfig));
    const patch = designPatchFromIntake({
      projectName: project.name,
      venueName: input.venueName,
      locationName: input.locationName,
      a: input.autoConfig,
    });
    const linked = (await getAllDesigns()).filter((d) => d.gridProjectId === input.projectId);
    for (const d of linked) await updateDesign(d.id, patch);
    if (patch.name) await renameProject(input.projectId, patch.name);
  }
  revalidatePath(editorPath(input.projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}
```
Add imports: `import { designPatchFromIntake, manualScopeInputs } from "@/lib/design/grid-intake";`, extend the designs-store import to `import { getAllDesigns, removeDesign, updateDesign } from "@/lib/stores/designs";`, drop `seedBlankSheet` from the grid-projects import, and add `renameProject` to it. Add to `grid-projects.ts` (next to `setVenue`):
```ts
export async function renameProject(projectId: string, name: string): Promise<GridProject | null> {
  const clean = name.trim();
  if (!clean) return getProject(projectId);
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.name = clean;
    p.updatedAt = Date.now();
  });
}
```

- [ ] **Step 5: Rewrite the intake component**

Replace `grid-intake.tsx` entirely:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DIMSCHEMA,
  LIM,
  SIZES,
  VENUES,
  defaultAState,
  sizedDims,
  type AState,
  type DimField,
} from "@/app/(app)/design/quick/engine";
import { saveGridIntakeAction } from "./actions";

/**
 * Grid intake (Spec 1) — two steps before the editor opens:
 *   1. Venue type, size, dimensions (the same presets/sliders Quick Design
 *      uses; they drive the generated base sheet and the Scope targets).
 *   2. How to design it — Manual placement (enabled) or Auto-estimate
 *      (shown, disabled until Spec 2) — plus the cover-page fields.
 * Systems and tier are NOT asked here any more: systems live in the Scope
 * panel, and the base sheet is always generated from the dimensions.
 */

type Mode = "manual" | "auto";

function initialState(value?: AState): AState {
  return value ? { ...value, sys: { ...value.sys } } : defaultAState(0);
}

const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
const section = { borderTop: "1px solid #ececf0", paddingTop: 18, marginTop: 20 };
const label = { display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase" as const, marginBottom: 7, letterSpacing: ".06em" };
const card = (on: boolean, disabled = false): React.CSSProperties => ({
  textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
  background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : disabled ? "#f7f8fa" : "#fff",
  border: `1.5px solid ${on ? "var(--accent)" : "#e8eaee"}`, opacity: disabled ? 0.6 : 1,
});
const primary = (busy: boolean): React.CSSProperties => ({ border: "none", borderRadius: 9, padding: "12px 16px", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" });
const ghost: React.CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 9, padding: "12px 16px", background: "#fff", color: "#3a3f4a", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };

export default function GridIntake({
  projectId,
  projectName,
  initialAutoConfig,
}: {
  projectId: string;
  projectName: string;
  initialAutoConfig?: AState;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode>("manual");
  const [venueName, setVenueName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [a, setA] = useState<AState>(() => initialState(initialAutoConfig));
  const [error, setError] = useState("");
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const update = (patch: Partial<AState>) => setA((current) => ({ ...current, ...patch }));
  const setVenue = (key: string) => {
    const next = VENUES.find((v) => v.key === key) || VENUES[0];
    update({ venue: next.key, sys: { ...next.sys }, ...sizedDims(next, a.size) });
  };
  const setDimension = (field: DimField, raw: string) => {
    const [min, max] = LIM[field];
    const value = Math.max(min, Math.min(max, Number(raw) || min));
    update({ [field]: value } as Partial<AState>);
  };
  const save = () => startTransition(async () => {
    setError("");
    const saved = await saveGridIntakeAction({ projectId, mode: "manual", venueName, locationName, address, notes, autoConfig: a });
    if (!saved.ok) setError(saved.error);
    else router.refresh();
  });

  return <div style={{ minHeight: "100%", background: "#f7f8fa", padding: "42px 22px" }}>
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)" }}>Design · New system design · Step {step} of 2</div>
      <h1 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-.025em" }}>{projectName}</h1>
      <p style={{ margin: 0, color: "#737985", fontSize: 14, lineHeight: 1.55, maxWidth: 700 }}>
        {step === 1
          ? "Venue type and measurements draw the plan sheet to scale and set the Good / Better / Best targets in the Scope panel. You can revise them later."
          : "Choose how to design this venue, then add the cover-page details."}
      </p>
      <div style={{ marginTop: 26, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, padding: 22, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
        {step === 1 && <>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22 }}>
            <div>
              <div style={label}>Venue type</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {VENUES.map((item) => <button key={item.key} type="button" onClick={() => setVenue(item.key)} style={card(item.key === a.venue)}><span style={{ display: "block", fontSize: 13, fontWeight: 650 }}>{item.label}</span><span style={{ display: "block", color: "#9aa0ab", fontSize: 11, marginTop: 2 }}>{item.sub}</span></button>)}
              </div>
              <div style={section}><div style={label}>Size of venue</div><div style={{ display: "flex", gap: 8 }}>{SIZES.map(([key, text]) => <button key={key} type="button" onClick={() => update({ size: key, ...sizedDims(venue, key) })} style={{ ...card(key === a.size), flex: 1, textAlign: "center", fontWeight: 600 }}>{text}</button>)}</div></div>
            </div>
            <div>
              <div style={label}>Stage dimensions</div>
              <div style={{ display: "grid", gap: 13 }}>{(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => <label key={d.field}><span style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}><span>{d.label}</span><span style={{ fontFamily: "var(--font-mono)", color: "#737985" }}>{a[d.field]} ft</span></span><span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{d.note}</span><input type="range" min={LIM[d.field][0]} max={LIM[d.field][1]} step={2} value={a[d.field]} onChange={(e) => setDimension(d.field, e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} /></label>)}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
            <button type="button" onClick={() => setStep(2)} style={primary(false)}>Next: how to design it →</button>
          </div>
        </>}

        {step === 2 && <>
          <div style={label}>How do you want to design it?</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" onClick={() => setMode("manual")} style={card(mode === "manual")}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Manual placement</span>
              <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>Start on a scaled plan and place catalog devices yourself. Scope targets track what you place.</span>
            </button>
            <button type="button" disabled aria-disabled title="Auto-estimate lands in the next release" style={card(false, true)}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700 }}>Auto-estimate <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "#8c919c", border: "1px solid #dfe2e8", borderRadius: 999, padding: "2px 7px" }}>NEXT RELEASE</span></span>
              <span style={{ display: "block", color: "#9aa0ab", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>Good / Better / Best generated from your measurements, refined line by line, then placed for you.</span>
            </button>
          </div>

          <div style={section}><div style={{ ...label, marginBottom: 12 }}>Venue cover page</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label><span style={label}>Location / campus</span><input value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="High School" style={input} /></label>
              <label><span style={label}>Venue / space</span><input value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="Main space" style={input} /></label>
            </div>
            <label style={{ display: "block", marginTop: 14 }}><span style={label}>Address</span><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, state" style={input} /></label>
            <label style={{ display: "block", marginTop: 14 }}><span style={label}>Design notes</span><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Audience, stage, access, existing system notes…" style={{ ...input, minHeight: 78, resize: "vertical" }} /></label>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: "#737985" }}>{venue.label} · {a.width}&apos; × {a.depth}&apos; × {a.grid}&apos; · {a.size}</div>
          {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button type="button" onClick={() => setStep(1)} disabled={busy} style={ghost}>← Back</button>
            <button type="button" onClick={save} disabled={busy || mode !== "manual"} style={{ ...primary(busy), flex: 1 }}>{busy ? "Setting up your plan…" : "Continue to The Grid →"}</button>
          </div>
        </>}
      </div>
    </div>
  </div>;
}
```

- [ ] **Step 6: Extend the scratch scenario for the first-save side effects**

The intake save is a session-bound action, so test the two store-level pieces it composes: in `scripts/test-grid-options.ts` add imports `import { manualScopeInputs } from "@/lib/design/grid-intake";`, `import { setScopeInputs, renameProject } from "@/lib/stores/grid-projects";` (merge into the existing import), `import { defaultAState } from "@/app/(app)/design/quick/engine";` and, before the final `console.log`, add:
```ts
  // ---- intake side effects (Task 6): scope inputs + rename via the store ----
  const a = { ...defaultAState(0), venue: "school", width: 36, depth: 26, grid: 24, wing: 12, ph: 18 };
  await setScopeInputs(q0.id, manualScopeInputs(a));
  await renameProject(q0.id, "Main Hall — Northshore HS");
  const withScope = (await getProject(q0.id))!;
  assert.equal(withScope.scopeInputs?.venue, "school", "scopeInputs seeded from the intake dims");
  assert.equal(withScope.scopeInputs?.sys.controls, false, "non-trackable systems are off in seeded scopeInputs");
  assert.equal(withScope.name, "Main Hall — Northshore HS", "renameProject persists");
```

- [ ] **Step 7: Verify**

```bash
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
npm run test:specs 2>&1 | grep -E "grid-intake|grid-scopes|^FAIL"
npm run test:grid-options 2>&1 | tail -2
grep -rn "seedBlankSheet\|measurementBased:" src | grep -v "grid-projects.ts" 
```
Expected: tsc `0`; 9 `PASS grid-intake/grid-scopes` lines; only the 5 pre-existing FAILs; scenario PASS; the last grep returns only `actions.ts`'s `measurementBased: true,` line.

Boot on a scratch datadir, go to `/design/designs`, New design → Manual layout: confirm step 1 (venue/size/dims only), Next, step 2 shows Manual enabled + Auto greyed, fill "Main Hall" / "Northshore HS", Continue → editor opens on a venue-shaped base sheet, Scope panel shows five toggles with lighting/rigging/curtains/audio on for Auditorium and dollar targets present, header reads `Main Hall — Northshore HS`. Back on `/design/designs` the card shows `36' × 26' × 24'`. Stop the server, check for stray tsx.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/grid-intake.ts src/lib/design/grid-scopes.ts src/lib/stores/grid-projects.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/scope-panel.tsx" scripts/test-review-and-spec.ts scripts/test-grid-options.ts
```
```bash
git commit -F - <<'EOF'
feat(grid): two-step intake — venue+dims, then Manual (Auto greyed); first save seeds Scope inputs + design card dims (Spec 1, Task 6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 7: Smoke coverage, decision log, full gates

**Files:**
- Modify: `scripts/smoke-routes.ts` (route list near lines 142, 162–163)
- Modify: `DECISIONS.md` (append)

- [ ] **Step 1: Smoke routes**

Next to the existing `/design/grid/GRD-5001/riser` and `/schedule` entries add:
```ts
  { route: "/design/grid/GRD-5001?option=opt-base", reject: "no longer exists" },
  { route: "/design/grid/GRD-5001?option=opt-does-not-exist", reject: "no longer exists" },
  { route: "/design/grid/GRD-5001/riser?option=opt-base", reject: "no longer exists" },
  { route: "/design/grid/GRD-5001/schedule?option=opt-does-not-exist", reject: "no longer exists" },
```
(The unknown-id variants prove `resolveOptionId`'s fallback renders instead of erroring.)

- [ ] **Step 2: DECISIONS.md entry**

Find the next free number: `grep -n "^## D1[0-9][0-9]\." DECISIONS.md | tail -1` — use the greater of (that + 1) and **D150**. Append:

```markdown
## D<N>. Grid options are a tag on placements/routes, not nested documents; Manual intake asks venue + dims only (2026-09-21)

Spec `docs/superpowers/specs/2026-09-21-grid-options-and-intake-branch-design.md` (Spec 1 of 3
from Jeff's 2026-09-21 Grid brainstorm — Auto branch and proposal document follow).

- **Options as first-class variants.** A Grid project holds `options[]` (Good/Better/Best or
  user-named); placements and wire routes carry `optionId`; sheets, calibration, spaces,
  intake, scope inputs and revisions are shared. Chosen over revisions (history, not variants)
  and sibling projects (no way to send three as one document). Tagging beats nesting: every
  existing store function, BOM/riser/schedule library and revision snapshot keeps its shape;
  consumers filter by `optionSlice()`.
- **Read-side migration only.** Legacy docs normalize to one option `opt-base` named
  "Design" that inherits `project.quoteId`; untagged members belong to it. `project.quoteId`
  stays as a mirror of the first option's quote so pre-spec readers are untouched.
- **One draft quote per option**, named `<project> · <option> — The Grid design` when the
  project has more than one option. Pricing moved verbatim into
  `src/lib/design/grid-quote.ts` (`buildGridQuote`) so it can be tested per option on a
  scratch DB (`npm run test:grid-options`).
- **"Generate starting layout" removed from the editor** (D147's UI). It painted placeholder
  devices and ignored the chosen tier — the thing Jeff hit on 2026-09-21. `grid-seed.ts`
  and its action stay for Spec 2's real generator; the quote guard against unresolved
  placeholders stays because the punch branch's preview deploy may have written some.
- **Manual intake = venue type + dimensions, then mode + cover page.** Systems/tier/brief
  and the "Generate from measurements" checkbox are gone; the base sheet is always generated
  from dims; the first save also seeds `scopeInputs` (venue preset ∩ the five trackable
  systems) and patches the linked DesignRecord's name/venue/size/dims. Auto-estimate is
  shown greyed ("Next release") so the flow's shape is visible before Spec 2 enables it.
- **Entry points unchanged for now** — "New design" keeps Quick canvas / Manual layout until
  the Auto branch exists (Spec 2), otherwise there'd be no way to auto-estimate a new design.
- Known, deliberately untouched: `DesignRecord.budget` is still never written for manual
  designs (pre-existing, #38 plan recon item 7).
```

- [ ] **Step 3: Full gates (report the numbers)**

```bash
ps aux | grep -c "[t]sx"
./node_modules/.bin/tsc --noEmit; echo "tsc $?"
npm run test:specs 2>&1 | grep -c "^PASS"; npm run test:specs 2>&1 | grep "^FAIL"
npm run test:grid-options 2>&1 | tail -1
npm run test:smoke 2>&1 | tail -6
ps aux | grep -c "[t]sx"
```
Expected: tsc `0`; PASS count = 1013 + 25 new = **1038**, FAIL = the same 5 seed-data lines as baseline; grid-options PASS; smoke: every route 200 including the four new ones; 0 stray tsx.

Eslint baseline comparison on every changed file (no bare `git stash`):
```bash
for f in $(git diff --name-only 43b6695 -- 'src/**/*.ts' 'src/**/*.tsx' 'scripts/*.ts'); do echo "== $f"; ./node_modules/.bin/eslint "$f" 2>&1 | grep -E "^\s+[0-9]+:[0-9]+" | wc -l; git show "43b6695:$f" > /tmp/lint-base.${f##*.} 2>/dev/null && ./node_modules/.bin/eslint --no-ignore /tmp/lint-base.${f##*.} 2>&1 | grep -E "^\s+[0-9]+:[0-9]+" | wc -l; done
```
Report per-file "after / before" counts; any file where after > before needs fixing (new files must be 0).

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-routes.ts DECISIONS.md
```
```bash
git commit -F - <<'EOF'
docs+test(grid): smoke routes for ?option=, decision entry for the options model (Spec 1, Task 7)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Spec coverage check (done while writing)

| Spec section | Task |
| --- | --- |
| §1 data model, normalization, invariants, revisions | 1 (+ removeOption guard in 2) |
| §2 store API, member writes, slicing helper, riser/schedule `?option=`, quotes per option, name suffix, placeholder guard, budget out of scope | 2, 3, 4 |
| §3 switcher, URL param, add/rename/delete with confirm copy, all reads sliced, writes stamped, Scope tier default, seed UI removed | 5 |
| §4 two-step intake, Auto greyed, `intake.mode`, scopeInputs + DesignRecord on first save, `seedBlankSheet` deleted, `TRACKABLE_SYS_KEYS` moved, entry points unchanged | 6 |
| Error handling (unknown option → fallback; deleted option → "refresh" message; last-option; empty member quote) | 2, 4, 5 |
| Testing (pure unit, scratch scenario, smoke, gates) | 1, 2, 4, 6, 7 |
