# Grid device designators (#320) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every placed Grid device gets a stable, editable designator (`MIC-1`, `RCV-2`, a lot `LX-1–24`) that labels it on the plan and appears in the Property Editor, the Browser tree, a new Spreadsheet **Devices** tab, the schedules and the drawing set.

**Architecture:** One pure, client-safe rules module (`src/lib/design/designators.ts`) owns parsing, formatting, occupancy, next-free, reading order, assignment, renumbering, duplicates and the schedule list; device types gain a `code`. Numbers are handed out **inside** each store writer's `patchDoc` callback against the doc that patch read, using a code resolver built by a server helper (`designators-server.ts`) **before** the patch. The editor page fills in any missing designators once (`ensureDesignators`); the schedule and drawing set fill missing ones in memory only. Two new batched actions (`setDesignatorsAction`, `renumberDesignatorsAction`) ride the existing all-or-nothing `batchEdit` / undo stack.

**Tech Stack:** Next.js 16 App Router (server actions), TypeScript, React 19 client components, Drizzle doc-store (`grid_projects` JSONB — no migration), spec harness `scripts/test-review-and-spec.ts` on a scratch PGlite.

**Spec:** `docs/superpowers/specs/2026-10-09-grid-designators-design.md` (approved).

## Spec deviations (found while reading the code — each is logged in DECISIONS in Task 7)

1. **`occupied()` returns blocks (`{ from, to }` intervals), not number sets.** A lot may hold up to `PLACEMENT_QTY_MAX` = 100,000 units; a set per lot would allocate that many numbers. `nextFree(blocks, qty)` walks sorted blocks.
2. **`renumber()` takes no `codeOf`.** It re-issues each targeted designator in **its own parsed code** (a hand-typed `FOH-3` stays `FOH-…`), so it needs no catalog read; `renumberDesignatorsAction` therefore never loads parts.
3. **`designatorContext(partIds, preload?)` returns only `{ codeOf }`.** The reading-order context (`sheetIds`, `spaces`) is read from the doc **inside** each patch (`readingCtxOf(p)`), which is the more correct source. The editor page passes its already-built `parts` + device types as `preload` so it loads nothing twice. The light path reads Grid-library docs **by id** (`getDocRows("grid_catalog", ids)`), never `listGridSymbols()` (37k rows in production).
4. **`ensureDesignators(project, preload?)` takes the loaded project**, not an id: the page already holds it, so the no-op case costs no read and no write. It does not bump `updatedAt` (numbering is bookkeeping, not an edit).
5. **The /schedule page, the E-60x sheets and the plan sheets fill missing designators in memory** (`fillDesignators`) with the same rule `ensureDesignators` uses — a print or GET route (including the signed print route and preview deploys, which share the production DB) never writes. Only the editor page persists them.
6. **The code resolver's category step tries the placement's own `category` first, then the part's raw category.** A seeded placeholder (`grid-seed:…`) carries its system-function label on the placement (the drawing set and legend already read it there); a real unmapped part's category is the second chance.
7. **Replace part's re-code rule also applies to the riser's "Replace part" (`replaceNodeDevicePart`)** — same semantics, same helper (`keepsDesignatorOnSwap`). Replace part's `previous` now carries the old `designator`, and an item carrying `designator` (undo) restores it exactly instead of re-coding.
8. **Renumber does not clear the #211 `auto` tag** (it's bookkeeping across many devices; clearing it would make every Auto re-fill keep them). A hand designator edit does clear it (spec). Renumber's undo/redo goes through `setDesignatorsAction(..., { keepAuto: true })`.
9. **Device-type codes must be unique among active types** (effective codes compared): Catalog → Device types refuses a save where two active types would number into the same code, naming both. Archived types don't count.
10. **"Concurrent adds don't collide" is tested as "no duplicate among the survivors".** `patchDoc` reads then writes with no row lock (last writer wins — the existing contract every Grid patch documents), so a truly simultaneous pair can still lose a placement; what this feature guarantees is that numbers are computed from the doc each patch read, never from a pre-read.
11. **Reading order's space step uses `spaceOf`** (smallest containing polygon, `pointInPolygon`) — the rule the schedule, Browser tree and Spaces rollups already use.
12. **Inline cells commit on Enter/Tab only; Esc or clicking elsewhere discards.** A blur-commit would double-save as focus moves to the next cell before `router.refresh()` lands.
13. **The Devices tab's "Renumber → this type" targets the type filter's effective code** (designators carrying that code), the only code a person can see there.
14. **`cleanDesignator` also collapses a typed range** (`LX-1–24` → `LX-1`) — the table and plan show ranges, so people will type them back.

## Global Constraints

- Format: device-type code + `-` + number, per code **within one design option** (`MIC-1`, `MIC-2`); each option numbers on its own.
- A lot of qty N reserves N consecutive numbers; stored value is its **first** designator (`LX-1`), displayed `LX-1–24` (en dash, U+2013); the next device continues at `LX-25`.
- Stable: a device keeps its designator for life; deleting leaves a gap; a new device takes the **lowest free** number for its code (`nextFree`). Renumber… (all / one code / selection) closes gaps in reading order.
- Hand-typed duplicates are **allowed** and flagged amber (`DESIGNATOR_DUPLICATE_COLOR = "#b7791f"`).
- Custom designators (anything not `^(.+?)-(\d{1,6})$`, e.g. `FOH-AMP`) are shown as typed, never renumbered, never counted for next-free.
- Stored designator: trimmed, spaces collapsed, control chars stripped, ≤ **24** chars; `""` → absent.
- **Curtains never get one** (they keep their names); the field is stripped/refused on curtain placements.
- `DeviceType.code`: 1–6 of `[A-Z0-9]`, uppercased on save. Absent → `DEFAULT_TYPE_CODES[key]` (spec table, 25 keys) → else derived from the label (first letters of up to three words, or the first three letters of a one-word label).
- A placement whose part has no device type (unmapped, assembly, allowance, unresolved seed) uses its **system letter** — `DRAWING_SYSTEMS` prefix for its scope: L / A / V / R (Rigging + Curtains) / G (Unscoped).
- No migration (placements live in `grid_projects` JSONB). Revisions and option copies carry the field unchanged.
- Quotes, BOM and customer documents are unchanged. The riser does not show designators yet (next slice).
- Permission: every new Grid action gates with `requireUser()` — the same gate as every sibling placement edit in `src/app/(app)/design/grid/[id]/actions.ts`.
- UI: accent only via `var(--accent)`; amber only via `DESIGNATOR_DUPLICATE_COLOR`. Never import `designators-server.ts` or any `@/lib/stores/*` value from a `"use client"` file.
- Tests: `npm run test:specs` (`scripts/test-review-and-spec.ts`, own temp `PGLITE_PATH`); assertions prefixed **`#320`**; new check functions go at the **end** of the harness file and are chained after `.then(() => sheetAdjust318StaleSheetChecks())`, in task order. Fixtures are built in-test — never read gitignored files.
- Shell: `export PATH=$HOME/.local/node/bin:$PATH` first; work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/designators`. Never `git add -A` (untracked junk sits at the repo root) — add exact paths. Never `git stash`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- PGlite is single-process: before any `test:specs` run, `ps aux | grep -E "tsx|next dev" | grep -v grep` must show nothing holding this worktree's `.data/pglite`.
- `npx eslint` on the whole repo crashes on the harness — always pass `--ignore-pattern scripts/test-review-and-spec.ts`; per task, lint only the touched source files.
- **Merge hazard:** another session is building #319 (pages as sheets) on `feat/319-pages-as-sheets`. Both append to the harness chain, `DECISIONS.md`, `PUNCHLIST.md` and `AGENTS.md`. Resolve those conflicts keep-both; recompute D / punch numbers from `origin/main` right before Task 7.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/design/device-types.ts` | Modify | `DeviceType.code`, `DEFAULT_TYPE_CODES`, `TYPE_CODE_RE`, `cleanTypeCode`, `derivedTypeCode`, `effectiveTypeCode`; `cleanType` keeps `code`; `cleanDeviceTypesInput` validates/keeps it and refuses duplicate effective codes. |
| `src/lib/design/designators.ts` | Create | Pure rules: clean/parse/format, occupied, nextFree, readingOrder, assignMissing, renumber, duplicates, designatorList, code resolution (`codeOfPlacement`, `systemLetterOf`, `designatorCodeOf`), doc helpers (`readingCtxOf`, `stampDesignators`, `stampNewDesignators`, `needsDesignators`, `fillDesignators`), `keepsDesignatorOnSwap`; Task 5 adds `planDesignatorMarks`. |
| `src/lib/design/designators-server.ts` | Create | Server-only `designatorContext(partIds, preload?)` → `{ codeOf }`. |
| `src/lib/stores/grid-projects.ts` | Modify | `GridPlacement.designator`; numbering in `addPlacement`, `addPlacements`, `replaceAutoPlacements`, `pastePlacements`, `setPlacementsPart` (re-code rule), `restoreItems`; new `setPlacementsDesignator`, `renumberDesignators`, `ensureDesignators`. |
| `src/lib/stores/grid-riser.ts` | Modify | Numbering in `addDevicesToNode`, `setNodeDeviceQty`; re-code rule in `replaceNodeDevicePart`. |
| `src/app/(app)/design/grid/[id]/actions.ts` | Modify | `setDesignatorsAction`, `renumberDesignatorsAction`; `cleanRestoredPlacement` whitelists `designator`; `replacePlacementsPartAction` passes `designator` (undo). |
| `src/lib/design/grid-undo.ts` | Modify | `GridCommand` gains `designator`; `part` items may carry `designator`. |
| `src/app/(app)/design/grid/[id]/use-grid-editor.ts` | Modify | `designatorDupes`, `saveDesignators`, `renumberDesignators`, `focusPlacements`, undo `designator` case. |
| `src/app/(app)/design/grid/[id]/page.tsx` | Modify | `ensureDesignators` on load; schedule + payload read the numbered project. |
| `src/app/(app)/design/grid/[id]/plan-canvas.tsx` | Modify | Label = designator (no ×N), `<title>` tooltip, amber duplicates. |
| `src/app/(app)/design/grid/[id]/workspace/property-editor.tsx` | Modify | `DesignatorRow`; Several → Designators + Renumber selection. |
| `src/lib/design/grid-browser-tree.ts` + `workspace/browser-tree.tsx` | Modify | Optional `leafLabel` → `MIC-1 · SM57`. |
| `src/lib/design/grid-device-rows.ts` | Create | Pure Devices-tab model: `DEVICE_COLUMNS`, `deviceRows`, filter, sort, `cellText`, `nextCell`. |
| `src/app/(app)/design/grid/[id]/workspace/devices-table.tsx` | Create | The Devices tab (inline edit, filters, sort, row ↔ plan selection, Renumber menu). |
| `src/app/(app)/design/grid/[id]/workspace/spreadsheet-view.tsx` | Modify | Devices / Schedule tabs. |
| `src/lib/design/grid-schedule.ts` | Modify | `ScheduleRow.designators`, `ScheduleItem` row `designators`. |
| `src/lib/design/grid-schedule-server.ts`, `src/lib/design/drawing-set-data.ts` | Modify | `fillDesignators` before building. |
| `src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx` | Modify | Designators column. |
| `src/components/drawing/drawing-set-sheets.tsx`, `src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx` | Modify | E-60x Designators column; plan sheets print designators, key = designators · qty · description. |
| `src/app/(app)/catalog/device-types/device-types-client.tsx` | Modify | Code column (placeholder = effective default). |
| `scripts/test-review-and-spec.ts` | Modify | `#320` checks + chain; one `#211` pin updated. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | Modify | Decisions, `## 320`, phase-status follow-up. |

---

### Task 1: Pure rules — device-type codes and `src/lib/design/designators.ts`

**Files:**
- Modify: `src/lib/design/device-types.ts`
- Create: `src/lib/design/designators.ts`
- Test: `scripts/test-review-and-spec.ts` (new `designators320PureChecks` at the end + one chain line)

**Interfaces:**
- Consumes: `typeKeyOfPart`, `typeOfCategory`, `UNMAPPED_TYPE`, `ASSEMBLY_TYPE`, `ALLOWANCE_TYPE`, `DeviceType`, `TypeMap` (device-types); `spaceOf`, `SpaceLite` (grid-geometry); `placementQty` (grid-bom); `DRAWING_SYSTEMS`, `drawingSystemOf`, `scopeOfPart`, `GridLayer` (grid-scopes).
- Produces (device-types): `DeviceType.code?: string`; `DEFAULT_TYPE_CODES: Record<string, string>`; `TYPE_CODE_RE`; `cleanTypeCode(raw: unknown): string | null`; `derivedTypeCode(label: string): string`; `effectiveTypeCode(t: { key: string; label: string; code?: string | null }): string`.
- Produces (designators.ts):
  - consts `DESIGNATOR_MAX = 24`, `DESIGNATOR_DUPLICATE_COLOR = "#b7791f"`, `READING_BAND = 0.02`
  - types `DesignatorPlacement = { id; sheetId; page; x; y; partId; designator?: string; qty?: number; curtain?: unknown; category?: string }`, `CodeOf<P = DesignatorPlacement> = (pl: P) => string`, `ReadingCtx = { sheetIds: readonly string[]; spaces: ReadonlyArray<SpaceLite> }`, `Block = { from: number; to: number }`, `RenumberTarget = { all: true } | { code: string } | { ids: readonly string[] }`, `CodePart`, `TypeCodeCtx = { types: readonly DeviceType[]; map: TypeMap }`, `DesignatorDoc<P>`
  - `cleanDesignator(raw: unknown): string | null`, `parseDesignator(s): { code: string; n: number } | null`, `formatDesignator(stored, qty?): string`, `occupied(placements): Map<string, Block[]>` (keys upper-cased), `nextFree(blocks, qty = 1): number`, `readingOrder<P>(placements, ctx): P[]`, `assignMissing<P>(placements, codeOf, ctx, only?: ReadonlySet<string>): Map<string, string>`, `renumber<P>(placements, ctx, target): Map<string, string>`, `duplicates(placements): Set<string>`, `designatorList(items): string`, `systemLetterOf(scope): string`, `codeOfPlacement(pl, part, ctx): string`, `designatorCodeOf(partById, ctx): CodeOf<{ partId: string; category?: string }>`, `readingCtxOf(doc): ReadingCtx`, `stampDesignators(doc, optionId, codeOf, only?): number`, `stampNewDesignators(doc, ids, codeOf): number`, `needsDesignators(placements): boolean`, `fillDesignators<P>(placements, codeOf, ctx): P[]`, `keepsDesignatorOnSwap(designator, oldCode, newCode): boolean`.

- [ ] **Step 0: Record the baselines (before any change)**

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/sm/Downloads/peak-app/.claude/worktrees/designators
ps aux | grep -E "tsx|next dev" | grep -v grep   # must print nothing for this worktree
npx tsc --noEmit -p . 2>&1 | tail -3              # expect no output (0 errors)
npm run test:specs > "$TMPDIR/specs-baseline-320.txt" 2>&1; tail -1 "$TMPDIR/specs-baseline-320.txt"; grep -c '^PASS' "$TMPDIR/specs-baseline-320.txt"   # expect "ALL PASSED" and the PASS count
npx eslint --ignore-pattern scripts/test-review-and-spec.ts 2>&1 | tail -3   # note "N problems (0 errors, M warnings)"
```

Write the three numbers (PASS count, eslint errors/warnings) into the task report; Task 7 compares against them.

- [ ] **Step 1: Write the failing test**

Append at the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #320: Grid device designators — pure rules ---------------- */
async function designators320PureChecks(): Promise<void> {
  const D = await import("@/lib/design/designators");
  const T = await import("@/lib/design/device-types");
  const J = (v: unknown) => JSON.stringify(v);
  const pl = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, sheetId: "s1", page: 1, x, y, partId: "P", ...extra });

  // clean / parse / format
  ok(D.cleanDesignator("  MIC \u0007 -1 ") === "MIC -1" && D.cleanDesignator("x".repeat(30)) === "x".repeat(24) && D.cleanDesignator("   ") === null && D.cleanDesignator(5) === null,
    "#320 cleanDesignator: trims, collapses spaces, strips control chars, caps at 24; blank/non-text → null");
  ok(D.cleanDesignator("LX-1–24") === "LX-1" && D.cleanDesignator("LX-1 – 24") === "LX-1", "#320 cleanDesignator: a typed range keeps its first number");
  ok(J(D.parseDesignator("MIC-12")) === J({ code: "MIC", n: 12 }) && D.parseDesignator("mic-3")?.code === "mic" && J(D.parseDesignator("A-1-2")) === J({ code: "A-1", n: 2 }),
    "#320 parseDesignator: <code>-<number>, code kept as written");
  ok(D.parseDesignator("FOH-AMP") === null && D.parseDesignator("MIC-0") === null && D.parseDesignator("MIC-1234567") === null && D.parseDesignator(undefined) === null,
    "#320 parseDesignator: anything else is custom (null)");
  ok(D.formatDesignator("LX-1", 24) === "LX-1–24" && D.formatDesignator("LX-1", 1) === "LX-1" && D.formatDesignator("FOH-AMP", 5) === "FOH-AMP" && D.formatDesignator(undefined, 3) === "",
    "#320 formatDesignator: a lot reads as its range; custom text and singles as stored; none → \"\"");

  // occupied / nextFree
  const occ = D.occupied([pl("a", 0, 0, { designator: "MIC-1" }), pl("b", 0, 0, { designator: "LX-1", qty: 24 }), pl("c", 0, 0, { designator: "mic-3" }),
    pl("d", 0, 0, { designator: "MIC-2", curtain: { name: "Main" } }), pl("e", 0, 0, { designator: "FOH" })]);
  ok(J(occ.get("MIC")) === J([{ from: 1, to: 1 }, { from: 3, to: 3 }]) && J(occ.get("LX")) === J([{ from: 1, to: 24 }]) && !occ.has("FOH") && occ.size === 2,
    "#320 occupied: per code (case-insensitive), a lot holds its block; curtains and custom text hold nothing");
  ok(D.nextFree([{ from: 1, to: 1 }, { from: 3, to: 3 }]) === 2 && D.nextFree([{ from: 1, to: 1 }, { from: 3, to: 3 }], 2) === 4 && D.nextFree([], 3) === 1 &&
     D.nextFree([{ from: 2, to: 5 }]) === 1 && D.nextFree([{ from: 1, to: 24 }]) === 25 && D.nextFree([{ from: 1, to: 5 }, { from: 2, to: 3 }]) === 6,
    "#320 nextFree: the lowest n with n…n+qty−1 all free");

  // reading order: sheet, page, space (project order, none last), row band, x
  const box = (id: string, x0: number, x1: number) => ({ id, sheetId: "s1", page: 1, points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 0.8 }, { x: x0, y: 0.8 }] });
  const ctx = { sheetIds: ["s1", "s2"], spaces: [box("stage", 0.5, 1), box("house", 0, 0.5)] };
  const scattered = [
    { ...pl("a", 0.1, 0.1), sheetId: "s2" }, pl("b", 0.9, 0.51), pl("c", 0.2, 0.5), pl("d", 0.6, 0.515), { ...pl("e", 0.5, 0.5), page: 2 }, pl("f", 0.7, 0.1), pl("g", 0.1, 0.9),
  ];
  ok(D.readingOrder(scattered, ctx).map((p) => p.id).join(",") === "f,d,b,c,g,e,a",
    "#320 readingOrder: sheet order, page, space in project order (no space last), then rows top-down, then left-right");

  // assignMissing
  const am = [pl("a", 0.1, 0.05, { partId: "MIC", designator: "MIC-1" }), pl("b", 0.1, 0.1, { partId: "MIC", qty: 3 }), pl("c", 0.1, 0.2, { partId: "MIC" }),
    pl("d", 0.1, 0.3, { partId: "MIC", curtain: { name: "Main" } }), pl("e", 0.1, 0.4, { partId: "LX", designator: "LX-5" })];
  const got = D.assignMissing(am, (p) => p.partId, { sheetIds: ["s1"], spaces: [] });
  ok(J([...got.entries()]) === J([["b", "MIC-2"], ["c", "MIC-5"]]), "#320 assignMissing: reading order, a lot takes a whole block, never a curtain or a numbered device");
  ok(J([...D.assignMissing(am, (p) => p.partId, { sheetIds: ["s1"], spaces: [] }, new Set(["c"])).entries()]) === J([["c", "MIC-2"]]),
    "#320 assignMissing: `only` numbers just the given devices");

  // renumber
  const rn = [pl("x1", 0.1, 0.1, { designator: "MIC-3" }), pl("x2", 0.1, 0.2, { designator: "MIC-7", qty: 2 }), pl("x3", 0.1, 0.3, { designator: "MIC-1" }),
    pl("x4", 0.1, 0.4, { designator: "FOH" }), pl("x5", 0.1, 0.5, { designator: "LX-2" })];
  const rctx = { sheetIds: ["s1"], spaces: [] };
  ok(J([...D.renumber(rn, rctx, { all: true }).entries()]) === J([["x1", "MIC-1"], ["x2", "MIC-2"], ["x3", "MIC-4"], ["x5", "LX-1"]]),
    "#320 renumber all: each code from 1 in reading order, lots keep their block; custom untouched; only changes returned");
  ok(J([...D.renumber(rn, rctx, { code: "lx" }).entries()]) === J([["x5", "LX-1"]]), "#320 renumber one code (case-insensitive)");
  ok(J([...D.renumber(rn, rctx, { ids: ["x2"] }).entries()]) === J([["x2", "MIC-4"]]),
    "#320 renumber a selection: it takes the lowest numbers not held by the rest of its code");

  // duplicates
  const dup = D.duplicates([pl("a", 0, 0, { designator: "MIC-1", qty: 3 }), pl("b", 0, 0, { designator: "MIC-2" }), pl("c", 0, 0, { designator: "MIC-4" }),
    pl("d", 0, 0, { designator: "foh" }), pl("e", 0, 0, { designator: "FOH " }), pl("f", 0, 0, { designator: "Rack" }), pl("g", 0, 0, { designator: "MIC-4", curtain: { name: "x" } })]);
  ok([...dup].sort().join(",") === "a,b,d,e", "#320 duplicates: overlapping blocks of one code, or equal custom text (case-insensitive); curtains ignored");

  // designatorList
  ok(D.designatorList([{ designator: "MIC-1" }, { designator: "MIC-2" }, { designator: "MIC-3" }, { designator: "MIC-4" }, { designator: "MIC-7" }, { designator: "FOH" },
    { designator: "LX-1", qty: 24 }, { designator: "AMP-2" }, {}]) === "AMP-2, LX-1–24, MIC-1–4, MIC-7, FOH",
    "#320 designatorList: per code, consecutive runs as ranges, custom ones after");

  // device-type codes
  ok(T.SEED_DEVICE_TYPES.every((t) => !!T.DEFAULT_TYPE_CODES[t.key]) && new Set(Object.values(T.DEFAULT_TYPE_CODES)).size === 25 &&
     T.DEFAULT_TYPE_CODES.microphones === "MIC" && T.DEFAULT_TYPE_CODES.fixtures === "LX" && T.DEFAULT_TYPE_CODES["racks-cases"] === "RACK",
    "#320 DEFAULT_TYPE_CODES: one distinct code per seeded type (spec table)");
  ok(T.effectiveTypeCode({ key: "fog-haze", label: "Fog & Haze" }) === "FH" && T.effectiveTypeCode({ key: "x", label: "Hazers" }) === "HAZ" &&
     T.effectiveTypeCode({ key: "x", label: "Video Wall Processing Units" }) === "VWP" && T.effectiveTypeCode({ key: "speakers", label: "Loudspeakers", code: "ls" }) === "LS" &&
     T.effectiveTypeCode({ key: "speakers", label: "Loudspeakers" }) === "SPK",
    "#320 effectiveTypeCode: own code, else the shipped default, else derived from the label");
  const fromBlob = T.deviceTypesFrom([{ key: "speakers", label: "Speakers", scope: "Audio", order: 1, code: "ls" }, { key: "amplifiers", label: "Amplifiers", scope: "Audio", order: 2, code: "TOOLONG7" }]);
  ok(fromBlob.find((t) => t.key === "speakers")?.code === "LS" && !("code" in fromBlob.find((t) => t.key === "amplifiers")!), "#320 cleanType keeps a valid code (uppercased), drops a bad one");
  const seeds = T.deviceTypesFrom(undefined);
  const asInput = (patch: Record<string, Record<string, unknown>> = {}) => seeds.map((t) => ({ key: t.key, label: t.label, scope: t.scope, ...(patch[t.key] || {}) }));
  const withCode = T.cleanDeviceTypesInput(asInput({ speakers: { code: " spk2 " } }), seeds);
  ok(withCode.ok && withCode.types.find((t) => t.key === "speakers")?.code === "SPK2" && !("code" in withCode.types.find((t) => t.key === "amplifiers")!),
    "#320 types: a code saves uppercased; no code stores none");
  const badCode = T.cleanDeviceTypesInput(asInput({ speakers: { code: "SP K!" } }), seeds);
  ok(!badCode.ok && /1–6 letters or digits/.test(badCode.error), "#320 types: a code that isn't 1–6 letters/digits is refused");
  const clash = T.cleanDeviceTypesInput(asInput({ speakers: { code: "MIC" } }), seeds);
  const archivedClash = T.cleanDeviceTypesInput(asInput({ speakers: { code: "MIC" }, microphones: { archived: true } }), seeds);
  ok(!clash.ok && clash.error.includes("MIC") && archivedClash.ok, "#320 types: two active types can't share a code; an archived type doesn't count");
  const current = seeds.map((t) => (t.key === "speakers" ? { ...t, code: "LS" } : t));
  const kept = T.cleanDeviceTypesInput(asInput(), current);
  const cleared = T.cleanDeviceTypesInput(asInput({ speakers: { code: "" } }), current);
  ok(kept.ok && kept.types.find((t) => t.key === "speakers")?.code === "LS" && cleared.ok && !("code" in cleared.types.find((t) => t.key === "speakers")!),
    "#320 types: a save that sends no code keeps the stored one; an empty code clears it");

  // code resolution
  const tctx = { types: T.SEED_DEVICE_TYPES, map: { "wireless mics": { typeKey: "microphones", by: "admin" as const, at: 1 } } };
  ok(D.codeOfPlacement({}, { id: "P1", deviceType: "speakers" }, tctx) === "SPK" &&
     D.codeOfPlacement({}, { id: "P1", deviceType: "speakers" }, { ...tctx, types: T.SEED_DEVICE_TYPES.map((t) => (t.key === "speakers" ? { ...t, code: "LS" } : t)) }) === "LS",
    "#320 codeOfPlacement: the part's device type code (its own code wins)");
  ok(D.codeOfPlacement({}, { id: "P2", deviceType: null, category: "Wireless Mics" }, tctx) === "MIC" && D.codeOfPlacement({ category: "Wireless Mics" }, undefined, tctx) === "MIC",
    "#320 codeOfPlacement: an unmapped part falls back to the placement's then the part's category");
  ok(D.codeOfPlacement({}, { id: "asm:fx1", kind: "device", gridScope: "Audio" }, tctx) === "A" && D.codeOfPlacement({}, { id: "allow:x", allowance: true, gridScope: "Rigging" }, tctx) === "R" &&
     D.codeOfPlacement({}, { id: "c", gridScope: "Curtains" }, tctx) === "R" && D.codeOfPlacement({}, undefined, tctx) === "G" &&
     D.codeOfPlacement({}, { id: "P1", deviceType: "speakers" }, { ...tctx, types: T.SEED_DEVICE_TYPES.map((t) => (t.key === "speakers" ? { ...t, archived: true } : t)) }) === "G",
    "#320 codeOfPlacement: assemblies, allowances, archived types and unknowns use the system letter (L/A/V/R/G)");
  ok(D.designatorCodeOf(new Map([["P1", { id: "P1", deviceType: "microphones" }]]), tctx)({ partId: "P1" }) === "MIC", "#320 designatorCodeOf: the part-by-id resolver");

  // doc helpers
  const doc = { sheetIds: ["s1"], spaces: [] as never[], placements: [
    { ...pl("a", 0.1, 0.1, { partId: "MIC", designator: "MIC-1" }), optionId: "o1" }, { ...pl("b", 0.1, 0.2, { partId: "MIC" }), optionId: "o1" },
    { ...pl("c", 0.1, 0.3, { partId: "MIC" }), optionId: "o2" }, { ...pl("d", 0.1, 0.4, { partId: "F", curtain: { name: "x" } }), optionId: "o1" },
  ] as Array<ReturnType<typeof pl> & { optionId: string; designator?: string }> };
  const codeByPart = (p: { partId: string }) => p.partId;
  ok(D.needsDesignators(doc.placements) && D.stampDesignators(doc, "o1", codeByPart) === 1 && doc.placements[1].designator === "MIC-2" && !doc.placements[2].designator && !doc.placements[3].designator,
    "#320 stampDesignators: numbers one option's missing devices, nothing else");
  ok(D.stampNewDesignators(doc, new Set(["c"]), codeByPart) === 1 && doc.placements[2].designator === "MIC-1" && !D.needsDesignators(doc.placements),
    "#320 stampNewDesignators: each option numbers on its own");
  ok(D.needsDesignators([pl("z", 0, 0, { designator: "X", curtain: { name: "c" } })]), "#320 needsDesignators: a curtain carrying one needs stripping");
  const raw = [pl("a", 0.1, 0.1, { partId: "MIC", designator: "MIC-1" }), pl("b", 0.1, 0.2, { partId: "MIC" })];
  const filled = D.fillDesignators(raw, codeByPart, { sheetIds: ["s1"], spaces: [] });
  ok(filled[1].designator === "MIC-2" && !("designator" in raw[1]), "#320 fillDesignators: fills a copy, never the input");
  ok(!D.keepsDesignatorOnSwap("L-1", "L", "A") && D.keepsDesignatorOnSwap("FOH-1", "L", "A") && D.keepsDesignatorOnSwap("Rack", "L", "A") &&
     !D.keepsDesignatorOnSwap(undefined, "L", "A") && D.keepsDesignatorOnSwap("L-1", "L", "L"),
    "#320 keepsDesignatorOnSwap: only a number issued in the old type's code is re-issued, and only when the code changes");
}
```

Then add the chain line directly after `.then(() => sheetAdjust318StaleSheetChecks())`:

```ts
  .then(() => designators320PureChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: an error naming `Cannot find module '@/lib/design/designators'`.

- [ ] **Step 3: Add the type codes to `src/lib/design/device-types.ts`**

In `export type DeviceType = {`, after the `symbolDocId?: string;` member, add:

```ts
  /** #320: the designator prefix for this type's devices (MIC → MIC-1).
   *  1–6 of A–Z/0–9, stored uppercased; absent = effectiveTypeCode's default. */
  code?: string;
```

Directly after the closing `};` of `export const DEFAULT_TYPE_ICONS`, add:

```ts
/** #320: the shipped designator code per seeded type (spec table). A type's
 *  own `code` wins; a type not listed here derives one from its label. */
export const DEFAULT_TYPE_CODES: Record<string, string> = {
  fixtures: "LX",
  "dimming-power": "DIM",
  "control-networking": "LCN",
  "lighting-accessories": "LA",
  "hoists-motors": "HST",
  "truss-pipe": "TR",
  "rigging-hardware": "RH",
  "rigging-control": "RC",
  drapery: "DR",
  "tracks-hardware": "TRK",
  speakers: "SPK",
  microphones: "MIC",
  "mixing-processing": "MIX",
  amplifiers: "AMP",
  "assistive-listening": "ALS",
  intercom: "COM",
  "displays-projectors": "DSP",
  "screens-lifts": "SCR",
  cameras: "CAM",
  "switching-distribution": "SW",
  "cable-connectors": "CBL",
  "racks-cases": "RACK",
  "power-distribution": "PD",
  networking: "NET",
  "parts-consumables": "PRT",
};

export const TYPE_CODE_RE = /^[A-Z0-9]{1,6}$/;

/** A stored/typed code, trimmed and uppercased; null unless 1–6 of A–Z/0–9. */
export function cleanTypeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return TYPE_CODE_RE.test(c) ? c : null;
}

/** First letters of up to three words, or the first three letters of a
 *  one-word label ("Fog & Haze" → FH, "Hazers" → HAZ). */
export function derivedTypeCode(label: string): string {
  const words = label.toUpperCase().replace(/&/g, " ").split(/[^A-Z0-9]+/).filter(Boolean);
  const code = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join("") : (words[0] || "").slice(0, 3);
  return code || "DEV";
}

/** The code a type's designators use: its own, else the shipped default, else derived. */
export function effectiveTypeCode(t: { key: string; label: string; code?: string | null }): string {
  return cleanTypeCode(t.code) ?? (Object.hasOwn(DEFAULT_TYPE_CODES, t.key) ? DEFAULT_TYPE_CODES[t.key] : derivedTypeCode(t.label));
}
```

In `function cleanType(raw: unknown)`, replace

```ts
  if (isDocumentId(r.symbolDocId)) t.symbolDocId = r.symbolDocId;
  return t;
}
```

with

```ts
  if (isDocumentId(r.symbolDocId)) t.symbolDocId = r.symbolDocId;
  const code = cleanTypeCode(r.code);
  if (code) t.code = code;
  return t;
}
```

In `cleanDeviceTypesInput`, replace

```ts
    keys.add(key);
    if (!archived) labels.add(lower);
    const t: DeviceType = { key, label, scope, order: (i + 1) * 10 };
    if (archived) t.archived = true;
    if (existing?.icon) t.icon = existing.icon;
    if (existing?.symbolDocId) t.symbolDocId = existing.symbolDocId;
    out.push(t);
  }
  for (const t of current) if (!keys.has(t.key)) out.push({ ...t, archived: true, order: (out.length + 1) * 10 });
  return { ok: true, types: out };
}
```

with

```ts
    // #320: an absent `code` keeps the stored one (an older client); "" clears it.
    let code: string | undefined = r.code === undefined ? existing?.code : undefined;
    if (typeof r.code === "string" && r.code.trim()) {
      const c = cleanTypeCode(r.code);
      if (!c) return { ok: false, error: `The code for "${label}" must be 1–6 letters or digits.` };
      code = c;
    }
    keys.add(key);
    if (!archived) labels.add(lower);
    const t: DeviceType = { key, label, scope, order: (i + 1) * 10 };
    if (archived) t.archived = true;
    if (existing?.icon) t.icon = existing.icon;
    if (existing?.symbolDocId) t.symbolDocId = existing.symbolDocId;
    if (code) t.code = code;
    out.push(t);
  }
  // #320: two active types numbering into one code would read as one series.
  const codeOwner = new Map<string, string>();
  for (const t of out) {
    if (t.archived) continue;
    const c = effectiveTypeCode(t);
    const other = codeOwner.get(c);
    if (other) return { ok: false, error: `"${other}" and "${t.label}" both use the code ${c} — give one of them its own code.` };
    codeOwner.set(c, t.label);
  }
  for (const t of current) if (!keys.has(t.key)) out.push({ ...t, archived: true, order: (out.length + 1) * 10 });
  return { ok: true, types: out };
}
```

- [ ] **Step 4: Write `src/lib/design/designators.ts`**

```ts
/* ------------------------------------------------------------------ *
 * The Grid — device designators (#320, spec 2026-10-09).
 *
 * A designator is a device's type code + number (`MIC-1`), numbered per
 * code within ONE design option. A lot marker of qty N holds N consecutive
 * numbers; only its FIRST is stored (`LX-1`) and the range is derived at
 * display time (`LX-1–24`). Anything that doesn't read `<code>-<number>` is
 * a custom designator: shown as typed, never renumbered, never counted for
 * next-free. Curtains never take one — they keep their names.
 *
 * Pure and client-safe (the grid-bom rule): no doc-store, no DB. The store
 * writers, the editor, the schedules, the drawing set and the harness all
 * read these rules. The server-side code resolver lives in
 * designators-server.ts.
 * ------------------------------------------------------------------ */
import { spaceOf, type SpaceLite } from "./grid-geometry";
import { placementQty } from "./grid-bom";
import { DRAWING_SYSTEMS, drawingSystemOf, scopeOfPart, type GridLayer } from "./grid-scopes";
import {
  ALLOWANCE_TYPE,
  ASSEMBLY_TYPE,
  UNMAPPED_TYPE,
  effectiveTypeCode,
  typeKeyOfPart,
  typeOfCategory,
  type DeviceType,
  type TypeMap,
} from "./device-types";

export const DESIGNATOR_MAX = 24;
/** The amber a duplicate designator is drawn in (plan label, Property Editor, Devices tab). */
export const DESIGNATOR_DUPLICATE_COLOR = "#b7791f";
/** Devices whose normalized y differ by less than one band read as one row. */
export const READING_BAND = 0.02;

/** The placement slice these rules read — GridPlacement satisfies it. */
export type DesignatorPlacement = {
  id: string;
  sheetId: string;
  page: number;
  x: number;
  y: number;
  partId: string;
  designator?: string;
  qty?: number;
  curtain?: unknown;
  category?: string;
};
export type CodeOf<P = DesignatorPlacement> = (pl: P) => string;
export type ReadingCtx = { sheetIds: readonly string[]; spaces: ReadonlyArray<SpaceLite> };
/** Numbers `from`…`to` (inclusive) held under one code. */
export type Block = { from: number; to: number };
export type RenumberTarget = { all: true } | { code: string } | { ids: readonly string[] };

const DESIGNATOR_RE = /^(.+?)-(\d{1,6})$/;
const RANGE_RE = /^(.+?-\d{1,6})\s*–\s*\d{1,6}$/;
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Trim, strip control chars, collapse spaces, a typed range → its first
 *  number, cap at 24; blank (or not text) → null. */
export function cleanDesignator(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const range = RANGE_RE.exec(s);
  if (range) s = range[1];
  s = s.slice(0, DESIGNATOR_MAX).trim();
  return s || null;
}

/** `<code>-<number>` (code kept as written, number ≥ 1); else null = custom. */
export function parseDesignator(s: string | null | undefined): { code: string; n: number } | null {
  const m = DESIGNATOR_RE.exec((s ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 ? { code: m[1], n } : null;
}

/** What a label shows: a lot's range (`LX-1–24`), else the stored text; "" when none. */
export function formatDesignator(stored: string | null | undefined, qty?: number | null): string {
  const text = cleanDesignator(stored);
  if (!text) return "";
  const q = placementQty({ qty });
  const d = q > 1 ? parseDesignator(text) : null;
  return d ? `${d.code}-${d.n}–${d.n + q - 1}` : text;
}

/** Per code (upper-cased key), the blocks held — a lot holds its whole block.
 *  Curtains and custom designators hold nothing. */
export function occupied(placements: readonly DesignatorPlacement[]): Map<string, Block[]> {
  const out = new Map<string, Block[]>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const d = parseDesignator(cleanDesignator(pl.designator));
    if (!d) continue;
    const key = d.code.toUpperCase();
    const list = out.get(key) ?? [];
    list.push({ from: d.n, to: d.n + placementQty(pl) - 1 });
    out.set(key, list);
  }
  return out;
}

/** The lowest n ≥ 1 such that n … n+qty−1 are all free. */
export function nextFree(blocks: readonly Block[], qty = 1): number {
  const need = Math.max(1, Math.floor(qty) || 1);
  let n = 1;
  for (const b of [...blocks].sort((a, c) => a.from - c.from)) {
    if (b.to < n) continue;
    if (n + need - 1 < b.from) return n;
    n = b.to + 1;
  }
  return n;
}

/** Sheet order, page, space (project order by the containing space —
 *  spaceOf, smallest wins — devices in no space last), rows of READING_BAND
 *  top to bottom, then left to right; id breaks ties. */
export function readingOrder<P extends DesignatorPlacement>(placements: readonly P[], ctx: ReadingCtx): P[] {
  const sheetIdx = new Map(ctx.sheetIds.map((id, i) => [id, i]));
  const spaces = [...ctx.spaces];
  const spaceIdx = new Map(spaces.map((s, i) => [s.id, i]));
  const LAST = Number.MAX_SAFE_INTEGER;
  const keyed = placements.map((pl) => {
    const home = spaceOf(pl, spaces);
    return { pl, k: [sheetIdx.get(pl.sheetId) ?? LAST, pl.page, home ? spaceIdx.get(home.id) ?? LAST : LAST, Math.floor(pl.y / READING_BAND), pl.x] };
  });
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
    return a.pl.id < b.pl.id ? -1 : a.pl.id > b.pl.id ? 1 : 0;
  });
  return keyed.map((e) => e.pl);
}

/** Every non-curtain placement WITHOUT a designator (limited to `only` when
 *  given) gets the next free number for its code, in reading order. Never
 *  touches one that has a designator. Returns id → designator. */
export function assignMissing<P extends DesignatorPlacement>(
  placements: readonly P[],
  codeOf: CodeOf<P>,
  ctx: ReadingCtx,
  only?: ReadonlySet<string>
): Map<string, string> {
  const occ = occupied(placements);
  const out = new Map<string, string>();
  const need = placements.filter((pl) => !pl.curtain && !cleanDesignator(pl.designator) && (!only || only.has(pl.id)));
  for (const pl of readingOrder(need, ctx)) {
    const code = codeOf(pl);
    const key = code.toUpperCase();
    const qty = placementQty(pl);
    const blocks = occ.get(key) ?? [];
    const n = nextFree(blocks, qty);
    blocks.push({ from: n, to: n + qty - 1 });
    occ.set(key, blocks);
    out.set(pl.id, `${code}-${n}`);
  }
  return out;
}

/** Re-issue the targeted placements' parseable designators, per code, from
 *  the lowest numbers not held by UNtargeted placements of that code (for
 *  `all` / `code` that is from 1), in reading order, each in its own code.
 *  Custom designators are left alone. Returns the changes only. */
export function renumber<P extends DesignatorPlacement>(placements: readonly P[], ctx: ReadingCtx, target: RenumberTarget): Map<string, string> {
  const parsed = new Map<string, { code: string; n: number }>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const d = parseDesignator(cleanDesignator(pl.designator));
    if (d) parsed.set(pl.id, d);
  }
  const ids = "ids" in target ? new Set(target.ids) : null;
  const want = "code" in target ? target.code.trim().toUpperCase() : null;
  const groups = new Map<string, { hit: P[]; held: Block[] }>();
  for (const pl of placements) {
    const d = parsed.get(pl.id);
    if (!d) continue;
    const key = d.code.toUpperCase();
    const g = groups.get(key) ?? { hit: [], held: [] };
    const targeted = ids ? ids.has(pl.id) : want !== null ? key === want : true;
    if (targeted) g.hit.push(pl);
    else g.held.push({ from: d.n, to: d.n + placementQty(pl) - 1 });
    groups.set(key, g);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    const blocks = [...g.held];
    for (const pl of readingOrder(g.hit, ctx)) {
      const d = parsed.get(pl.id)!;
      const qty = placementQty(pl);
      const n = nextFree(blocks, qty);
      blocks.push({ from: n, to: n + qty - 1 });
      const next = `${d.code}-${n}`;
      if (next !== pl.designator) out.set(pl.id, next);
    }
  }
  return out;
}

/** Ids whose number block overlaps another's in the same code, or whose
 *  custom text equals another's (case-insensitive). Curtains ignored. */
export function duplicates(placements: readonly DesignatorPlacement[]): Set<string> {
  const out = new Set<string>();
  const byCode = new Map<string, Array<{ id: string } & Block>>();
  const custom = new Map<string, string[]>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const text = cleanDesignator(pl.designator);
    if (!text) continue;
    const d = parseDesignator(text);
    if (d) {
      const key = d.code.toUpperCase();
      const list = byCode.get(key) ?? [];
      list.push({ id: pl.id, from: d.n, to: d.n + placementQty(pl) - 1 });
      byCode.set(key, list);
    } else {
      const key = text.toLowerCase();
      custom.set(key, [...(custom.get(key) ?? []), pl.id]);
    }
  }
  for (const list of byCode.values()) {
    list.sort((a, b) => a.from - b.from || a.to - b.to);
    let reach = -Infinity;
    let holder = "";
    for (const b of list) {
      if (b.from <= reach) {
        out.add(b.id);
        out.add(holder);
      }
      if (b.to > reach) {
        reach = b.to;
        holder = b.id;
      }
    }
  }
  for (const ids of custom.values()) if (ids.length > 1) for (const id of ids) out.add(id);
  return out;
}

/** A schedule cell: per code (sorted), consecutive numbers as ranges
 *  (`MIC-1–4, MIC-7`), then custom ones in text order. */
export function designatorList(items: ReadonlyArray<{ designator?: string | null; qty?: number | null }>): string {
  const codes = new Map<string, { code: string; blocks: Block[] }>();
  const custom = new Map<string, string>();
  for (const it of items) {
    const text = cleanDesignator(it.designator);
    if (!text) continue;
    const d = parseDesignator(text);
    if (!d) {
      const k = text.toLowerCase();
      if (!custom.has(k)) custom.set(k, text);
      continue;
    }
    const key = d.code.toUpperCase();
    const g = codes.get(key) ?? { code: d.code, blocks: [] };
    g.blocks.push({ from: d.n, to: d.n + placementQty(it) - 1 });
    codes.set(key, g);
  }
  const parts: string[] = [];
  for (const key of [...codes.keys()].sort(byText)) {
    const g = codes.get(key)!;
    const merged: Block[] = [];
    for (const b of [...g.blocks].sort((a, c) => a.from - c.from)) {
      const last = merged[merged.length - 1];
      if (last && b.from <= last.to + 1) last.to = Math.max(last.to, b.to);
      else merged.push({ ...b });
    }
    for (const b of merged) parts.push(b.from === b.to ? `${g.code}-${b.from}` : `${g.code}-${b.from}–${b.to}`);
  }
  parts.push(...[...custom.values()].sort(byText));
  return parts.join(", ");
}

/* ------------------------------ codes ------------------------------ */

/** The part slice the code resolver reads — PartLite satisfies it. */
export type CodePart = {
  id?: string;
  category?: string;
  deviceType?: string | null;
  kind?: string;
  allowance?: boolean;
  gridScope?: string | null;
  group?: string | null;
  trade?: string | null;
};
export type TypeCodeCtx = { types: readonly DeviceType[]; map: TypeMap };

/** The drawing set's system letter for a scope: L / A / V / R / G. */
export function systemLetterOf(scope: GridLayer): string {
  const key = drawingSystemOf(scope);
  return DRAWING_SYSTEMS.find((s) => s.key === key)?.prefix ?? "G";
}

/** part → its device type's code; an unmapped part → the placement's, then
 *  the part's, raw category through the type map; else the system letter
 *  (assemblies, allowances, archived types, unknown parts). */
export function codeOfPlacement(pl: { category?: string }, part: CodePart | null | undefined, ctx: TypeCodeCtx): string {
  const codeOfType = (key: string | null) => {
    const t = key ? ctx.types.find((x) => x.key === key && !x.archived) : undefined;
    return t ? effectiveTypeCode(t) : null;
  };
  const key = typeKeyOfPart(part);
  if (key === UNMAPPED_TYPE) {
    for (const cat of [pl.category, part?.category]) {
      const c = cat ? codeOfType(typeOfCategory(cat, ctx.map, ctx.types)) : null;
      if (c) return c;
    }
  } else if (key !== ASSEMBLY_TYPE && key !== ALLOWANCE_TYPE) {
    const c = codeOfType(key);
    if (c) return c;
  }
  return systemLetterOf(scopeOfPart(part));
}

/** codeOfPlacement over a part-by-id map. */
export function designatorCodeOf(partById: ReadonlyMap<string, CodePart>, ctx: TypeCodeCtx): CodeOf<{ partId: string; category?: string }> {
  return (pl) => codeOfPlacement(pl, partById.get(pl.partId), ctx);
}

/** Replace part: whether a device keeps its designator when its part
 *  changes. A number issued in the OLD type's code is re-issued in the new
 *  one when the code changes; a custom or hand-renamed designator is kept. */
export function keepsDesignatorOnSwap(designator: string | null | undefined, oldCode: string, newCode: string): boolean {
  const text = cleanDesignator(designator);
  if (!text) return false;
  const d = parseDesignator(text);
  if (!d) return true;
  return d.code.toUpperCase() !== oldCode.toUpperCase() || newCode.toUpperCase() === oldCode.toUpperCase();
}

/* ------------------------------ docs ------------------------------ */

export type DesignatorDoc<P> = { placements?: P[]; sheetIds?: readonly string[]; spaces?: ReadonlyArray<SpaceLite> };

export function readingCtxOf(doc: { sheetIds?: readonly string[]; spaces?: ReadonlyArray<SpaceLite> }): ReadingCtx {
  return { sheetIds: doc.sheetIds || [], spaces: doc.spaces || [] };
}

/** Number `optionId`'s missing designators (only `only`, when given) IN
 *  PLACE on a doc a patch is holding. Returns how many it set. */
export function stampDesignators<P extends DesignatorPlacement & { optionId?: string }>(
  doc: DesignatorDoc<P>,
  optionId: string | undefined,
  codeOf: CodeOf<P>,
  only?: ReadonlySet<string>
): number {
  const own = (doc.placements || []).filter((pl) => pl.optionId === optionId);
  const got = assignMissing(own, codeOf, readingCtxOf(doc), only);
  if (!got.size) return 0;
  doc.placements = (doc.placements || []).map((pl) => {
    const d = got.get(pl.id);
    return d ? { ...pl, designator: d } : pl;
  });
  return got.size;
}

/** stampDesignators for just-written ids, each option numbered on its own. */
export function stampNewDesignators<P extends DesignatorPlacement & { optionId?: string }>(
  doc: DesignatorDoc<P>,
  ids: ReadonlySet<string>,
  codeOf: CodeOf<P>
): number {
  if (!ids.size) return 0;
  const options = new Set((doc.placements || []).filter((pl) => ids.has(pl.id)).map((pl) => pl.optionId));
  let n = 0;
  for (const o of options) n += stampDesignators(doc, o, codeOf, ids);
  return n;
}

/** A device without a designator, or a curtain carrying one. */
export function needsDesignators(placements: readonly DesignatorPlacement[]): boolean {
  return placements.some((pl) => (pl.curtain ? pl.designator !== undefined : !cleanDesignator(pl.designator)));
}

/** A copy with every missing designator filled (assignMissing's numbers) —
 *  for read-only paths (schedule, drawing set) that must never write. */
export function fillDesignators<P extends DesignatorPlacement>(placements: readonly P[], codeOf: CodeOf<P>, ctx: ReadingCtx): P[] {
  const got = assignMissing(placements, codeOf, ctx);
  return placements.map((pl) => {
    const d = got.get(pl.id);
    return d ? { ...pl, designator: d } : pl;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#320|FAIL|ALL PASSED|FAILED" | tail -40`
Expected: every `#320` line `PASS`, ending `ALL PASSED`.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5           # expect no output
npx eslint src/lib/design/designators.ts src/lib/design/device-types.ts   # expect no errors
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/designators.ts src/lib/design/device-types.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #320 designator rules + device-type codes (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Store — the field, the code resolver, numbering in every create path

**Files:**
- Create: `src/lib/design/designators-server.ts`
- Modify: `src/lib/stores/grid-projects.ts`, `src/lib/stores/grid-riser.ts`
- Test: `scripts/test-review-and-spec.ts` (new `designators320StoreChecks` + chain line)

**Interfaces:**
- Consumes (Task 1): `cleanDesignator`, `keepsDesignatorOnSwap`, `needsDesignators`, `readingCtxOf`, `renumber`, `stampDesignators`, `stampNewDesignators`, `designatorCodeOf`, `CodePart`, `RenumberTarget`.
- Produces:
  - `GridPlacement.designator?: string`
  - `designatorContext(partIds: Iterable<string>, preload?: DesignatorPreload): Promise<{ codeOf: (pl: { partId: string; category?: string }) => string }>`; `type DesignatorPreload = { parts: ReadonlyArray<CodePart & { id: string }>; deviceTypes: DeviceTypeContext }`
  - `setPlacementsPart(projectId, items: { id; partId; qty?; designator? }[]): Promise<BatchResult<{ id; partId; qty?; designator? }[]>>` (previous now carries `designator`)
  - `setPlacementsDesignator(projectId, items: { id: string; designator: string }[], opts?: { keepAuto?: boolean }): Promise<BatchResult<{ id: string; designator: string }[]>>`
  - `renumberDesignators(projectId, optionId, target: RenumberTarget): Promise<BatchResult<{ previous: { id: string; designator: string }[]; next: { id: string; designator: string }[] }>>`
  - `ensureDesignators(project: GridProject, preload?: DesignatorPreload): Promise<GridProject>`

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #320: Grid device designators — store ---------------- */
async function designators320StoreChecks(): Promise<void> {
  type G320Project = import("@/lib/stores/grid-projects").GridProject;
  const G = await import("@/lib/stores/grid-projects");
  const GR = await import("@/lib/stores/grid-riser");
  const D = await import("@/lib/design/designators");
  const DS = await import("@/db/doc-store");
  const { DEFAULT_OPTION_ID } = await import("@/lib/design/grid-options");
  const { UNASSIGNED_KEY } = await import("@/lib/design/grid-riser-doc");
  const { EQUIPMENT_ROWS } = await import("@/lib/design/equipment-vocab");
  const VP = await import("@/lib/design/grid-virtual-parts");
  const { registerFixture } = await import("./test-fixtures");
  const by = "Test Harness";
  const opt = DEFAULT_OPTION_ID;
  // Allowances resolve with no catalog and carry their row's scope: L… and A….
  const LIGHT = VP.allowancePartId(EQUIPMENT_ROWS.find((r) => r.system === "lighting")!.key, "better");
  const AUDIO = VP.allowancePartId(EQUIPMENT_ROWS.find((r) => r.system === "audio")!.key, "better");
  const NOPART = "TEST-320-NOPART";

  const gp = await G.createProject({ name: "#320 designators project", customer: "Spec fixture", customerId: null, by });
  registerFixture("grid_projects", gp.id);
  const sh = (await G.addSheet(gp.id, { name: "#320 sheet", mime: "image/svg+xml", dataUrl: "data:image/svg+xml,<svg/>", by }))!;
  registerFixture("grid_sheets", sh.id);
  const sheetId = sh.id;
  const proj = async () => (await G.getProject(gp.id))!;
  const des = async (id: string) => (await proj()).placements.find((pl) => pl.id === id)?.designator;
  const place = async (partId: string, x: number, y: number) => (await G.addPlacement(gp.id, { sheetId, page: 1, x, y, partId, optionId: opt, by }))!.placements.at(-1)!;

  const a1 = await place(LIGHT, 0.1, 0.1);
  const a2 = await place(LIGHT, 0.1, 0.2);
  const g1 = await place(NOPART, 0.1, 0.3);
  ok(a1.designator === "L-1" && a2.designator === "L-2" && g1.designator === "G-1", "#320 addPlacement numbers per code: L-1, L-2; an unknown part uses the general letter G-1");
  const many = (await G.addPlacements(gp.id, { sheetId, page: 1, optionId: opt, by, items: [{ x: 0.2, y: 0.4, partId: LIGHT, qty: 24 }, { x: 0.2, y: 0.5, partId: AUDIO }] }))!;
  const lot = many.placements.at(-2)!;
  const aud = many.placements.at(-1)!;
  ok(lot.designator === "L-3" && aud.designator === "A-1", "#320 addPlacements: a lot of 24 takes L-3 (its block is L-3–26); another code starts at 1");
  const a3 = await place(LIGHT, 0.1, 0.6);
  ok(a3.designator === "L-27", "#320 the next device continues after the lot's block");
  const cur = (await G.addCurtainPlacement(gp.id, { sheetId, page: 1, x: 0.3, y: 0.3, curtain: { type: "Draw", name: "Main", widthFt: 20, heightFt: 10, fullnessPct: 50, fabricSku: "TEST-320-FAB" }, optionId: opt, by }))!.placements.at(-1)!;
  ok(cur.designator === undefined, "#320 a curtain never gets a designator");

  await G.removePlacements(gp.id, [a2.id]);
  const a4 = await place(LIGHT, 0.1, 0.7);
  ok(a4.designator === "L-2", "#320 a delete leaves a gap; the next device takes the lowest free number");
  const pasted = await G.pastePlacements(gp.id, { sheetId, page: 1, optionId: opt, by, items: [{ srcId: a1.id, x: 0.3, y: 0.8, partId: LIGHT }], routeIds: [] });
  const pz = pasted.ok ? pasted.value.placements[0] : null;
  ok(!!pz && pz.designator === "L-28" && (await des(pz.id)) === "L-28", "#320 paste gets a fresh number (the copy never carries one) — in the stored doc and the returned record");
  const rm = await G.removePlacements(gp.id, [a3.id]);
  const back = rm.ok ? await G.restoreItems(gp.id, rm.value) : null;
  ok(!!back?.ok && (await des(a3.id)) === "L-27", "#320 undo of a delete restores the device with its designator");

  // Replace part: re-code only a number issued in the old type's code.
  const sw = await G.setPlacementsPart(gp.id, [{ id: a1.id, partId: AUDIO }]);
  ok(sw.ok && (await des(a1.id)) === "A-2" && sw.value[0].designator === "L-1", "#320 Replace part re-issues L-1 in the new code (A-2); previous carries L-1");
  const hand = await G.setPlacementsDesignator(gp.id, [{ id: a4.id, designator: "  FOH-1 " }]);
  const swHand = await G.setPlacementsPart(gp.id, [{ id: a4.id, partId: AUDIO }]);
  ok(hand.ok && hand.value[0].designator === "L-2" && swHand.ok && (await des(a4.id)) === "FOH-1", "#320 a hand-renamed designator is kept through Replace part");
  const undoSw = sw.ok ? await G.setPlacementsPart(gp.id, sw.value) : null;
  ok(!!undoSw?.ok && (await des(a1.id)) === "L-1" && (await proj()).placements.find((pl) => pl.id === a1.id)!.partId === LIGHT, "#320 undo of Replace part puts the old designator back exactly");

  // Hand edits
  const re = await G.setPlacementsDesignator(gp.id, [{ id: g1.id, designator: "" }]);
  ok(re.ok && (await des(g1.id)) === "G-1", "#320 an empty designator re-issues the next free number");
  const curRefused = await G.setPlacementsDesignator(gp.id, [{ id: cur.id, designator: "X-1" }]);
  ok(!curRefused.ok && (await des(cur.id)) === undefined, "#320 a curtain's designator can't be set");
  const dupSet = await G.setPlacementsDesignator(gp.id, [{ id: a3.id, designator: "L-5" }]);
  const own = (await proj()).placements.filter((pl) => pl.optionId === opt);
  ok(dupSet.ok && D.duplicates(own).has(a3.id) && D.duplicates(own).has(lot.id), "#320 a hand-typed duplicate is allowed and flagged (L-5 sits inside the lot's L-3–26)");

  // Renumber all: L closes up in reading order; G, A and custom stay.
  const rn = await G.renumberDesignators(gp.id, opt, { all: true });
  ok(rn.ok && (await des(a1.id)) === "L-1" && (await des(lot.id)) === "L-2" && (await des(a3.id)) === "L-26" && (await des(pz!.id)) === "L-27" &&
     (await des(g1.id)) === "G-1" && (await des(aud.id)) === "A-1" && (await des(a4.id)) === "FOH-1" && rn.value.next.length === 3 && rn.value.previous.length === 3,
    "#320 renumber all: L-1, lot L-2–25, L-26, L-27; G, A and custom unchanged; previous/next hold only the changes");
  const rnGone = await G.renumberDesignators(gp.id, "opt-gone", { all: true });
  ok(!rnGone.ok, "#320 renumber refuses an option that no longer exists");

  // Riser "+ Device"
  const rd = await GR.addDevicesToNode(gp.id, { optionId: opt, nodeKey: UNASSIGNED_KEY, partId: AUDIO, qty: 2, by });
  const riserNew = (await proj()).placements.slice(-2).map((pl) => pl.designator).sort().join(",");
  ok(rd.ok && riserNew === "A-2,A-3", "#320 the riser's + Device numbers what it adds");

  // Option copy keeps designators (per-option numbering).
  const alt = await G.addOption(gp.id, { name: "Alt", copyFromOptionId: opt, by });
  const p2 = await proj();
  const ds = (o: string) => p2.placements.filter((pl) => pl.optionId === o).map((pl) => pl.designator ?? "").sort().join(",");
  ok(alt.ok && ds(alt.option.id) === ds(opt), "#320 a copied option keeps the same designators");

  // ensureDesignators: numbers a pre-#320 design once; then a no-op with no write.
  await DS.patchDoc<G320Project>("grid_projects", gp.id, (p) => {
    for (const pl of p.placements) delete pl.designator;
  });
  const stripped = await proj();
  const ensured = await G.ensureDesignators(stripped);
  const optSlice = (p: G320Project, o: string) => p.placements.filter((pl) => pl.optionId === o);
  ok(ensured !== stripped && ensured.placements.every((pl) => (pl.curtain ? pl.designator === undefined : !!pl.designator)) &&
     D.duplicates(optSlice(ensured, opt)).size === 0 && alt.ok && D.duplicates(optSlice(ensured, alt.option.id)).size === 0 && ensured.updatedAt === stripped.updatedAt,
    "#320 ensureDesignators numbers every device of every option, no duplicates, without bumping updatedAt");
  const reread = await proj();
  ok((await G.ensureDesignators(reread)) === reread, "#320 ensureDesignators is a no-op (same object, no write) when nothing is missing");

  // Two adds at once never hand out the same number among what landed.
  await Promise.all([place(LIGHT, 0.9, 0.1), place(LIGHT, 0.9, 0.2)]);
  ok(D.duplicates(optSlice(await proj(), opt)).size === 0, "#320 concurrent adds: numbers come from the doc each patch read — no duplicate among the survivors");
}
```

Chain it after the Task 1 line:

```ts
  .then(() => designators320StoreChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: a TypeScript/runtime failure — `G.setPlacementsDesignator is not a function` (or the first `#320 addPlacement…` line `FAIL`).

- [ ] **Step 3: Write `src/lib/design/designators-server.ts`**

```ts
// SERVER ONLY — reads device types, the type map, settings, Grid-library docs and catalog rows.
import { getDocRows } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { getMany as getCatalogParts } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import { getDeviceTypes, getTypeMap } from "@/lib/stores/device-types";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { gridPartsFrom } from "./grid-parts";
import { parseVirtualPartId } from "./grid-virtual-parts";
import { isSeedPlaceholder } from "./grid-seed";
import { designatorCodeOf, type CodePart } from "./designators";
import type { DeviceTypeContext } from "./device-types";

// Server-only (the `server-only` package isn't installed here): fail loudly
// if a client bundle ever pulls this store-backed helper in.
if (typeof window !== "undefined") throw new Error("designators-server is server-only");

/** What the editor page already built — passed so nothing loads twice. */
export type DesignatorPreload = { parts: ReadonlyArray<CodePart & { id: string }>; deviceTypes: DeviceTypeContext };

/**
 * #320: the code resolver a store writer needs BEFORE its patchDoc, so the
 * pure numbering (assignMissing) can run inside the patch against the doc it
 * read. Loads only the given part ids: their Grid-library docs (by id, never
 * the whole library), the catalog rows behind them, and virtual Auto parts —
 * then resolves each through gridPartsFrom, the one PartLite builder, so a
 * code here is the code the editor would compute.
 */
export async function designatorContext(
  partIds: Iterable<string>,
  preload?: DesignatorPreload
): Promise<{ codeOf: (pl: { partId: string; category?: string }) => string }> {
  if (preload) return { codeOf: designatorCodeOf(new Map(preload.parts.map((p) => [p.id, p])), preload.deviceTypes) };
  const ids = [...new Set(partIds)].filter(Boolean);
  if (!ids.length) return { codeOf: designatorCodeOf(new Map(), { types: [], map: {} }) };
  const virtualIds = ids.filter((id) => parseVirtualPartId(id));
  const realIds = ids.filter((id) => !parseVirtualPartId(id) && !isSeedPlaceholder(id));
  const [types, map, settings, symbolRows, virtual] = await Promise.all([
    getDeviceTypes(),
    getTypeMap(),
    getSettings(),
    getDocRows<GridSymbol>("grid_catalog", realIds),
    virtualIds.length ? loadVirtualParts(virtualIds) : Promise.resolve([]),
  ]);
  const symbols = symbolRows.filter((r) => !r.deleted).map((r) => r.doc);
  const pricingIds = [...new Set([...realIds, ...symbols.flatMap((s) => (s.pricingPartId ? [s.pricingPartId] : []))])];
  const catalog = pricingIds.length ? await getCatalogParts(pricingIds) : [];
  const deviceTypes = { types, map };
  const parts = [
    ...gridPartsFrom(symbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
    ...virtual,
  ];
  return { codeOf: designatorCodeOf(new Map(parts.map((p) => [p.id, p])), deviceTypes) };
}
```

- [ ] **Step 4: Add the field and imports to `src/lib/stores/grid-projects.ts`**

After the line `import { blockedPages, remapSheetRefs, type SheetAdjust } from "@/lib/design/sheet-adjust";` add:

```ts
import {
  cleanDesignator,
  keepsDesignatorOnSwap,
  needsDesignators,
  readingCtxOf,
  renumber,
  stampDesignators,
  stampNewDesignators,
  type RenumberTarget,
} from "@/lib/design/designators";
import { designatorContext, type DesignatorPreload } from "@/lib/design/designators-server";
```

In `export type GridPlacement = {`, directly after the `category?: string;` member (and its doc comment), add:

```ts
  /**
   * #320: the device's designator — its type code + number (`MIC-1`) or
   * custom text. Stored trimmed, ≤ 24 chars; a lot stores its FIRST number
   * (`LX-1`, shown `LX-1–24`). Assigned inside every create path's patch
   * (lib/design/designators); absent = not yet assigned (a pre-#320 device —
   * ensureDesignators numbers it). Never on a curtain.
   */
  designator?: string;
```

- [ ] **Step 5: Number in `addPlacement`, `addPlacements`, `replaceAutoPlacements`**

Replace the whole of `export async function addPlacement(` with:

```ts
export async function addPlacement(
  projectId: string,
  input: { sheetId: string; page: number; x: number; y: number; partId: string; optionId: string; by: string }
): Promise<GridProject | null> {
  // #320: resolved before the patch; the number is handed out inside it.
  const { codeOf } = await designatorContext([input.partId]);
  let refused = false;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId) || !sheetOnProject(p, input.sheetId)) { refused = true; return; }
    const id = rid("gp-");
    p.placements = [
      ...(p.placements || []),
      {
        id,
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
    stampNewDesignators(p, new Set([id]), codeOf);
    p.updatedAt = Date.now();
  });
  return refused ? null : updated;
}
```

In `addPlacements`, replace

```ts
  if (!input.items.length) return getProject(projectId);
  const at = Date.now();
  let refused = false;
```

with

```ts
  if (!input.items.length) return getProject(projectId);
  const { codeOf } = await designatorContext(input.items.filter((it) => !it.curtain).map((it) => it.partId));
  const at = Date.now();
  let refused = false;
```

and replace

```ts
    p.placements = [...(p.placements || []), ...added];
    p.updatedAt = at;
  });
  return refused ? null : updated;
}
```

with

```ts
    p.placements = [...(p.placements || []), ...added];
    stampNewDesignators(p, new Set(added.map((pl) => pl.id)), codeOf);
    p.updatedAt = at;
  });
  return refused ? null : updated;
}
```

In `replaceAutoPlacements`, replace

```ts
  const at = Date.now();
  const scopes = new Set(input.scopes);
  let refused = false;
  let removed = 0;
```

with

```ts
  const { codeOf } = await designatorContext(input.items.filter((it) => !it.curtain).map((it) => it.partId));
  const at = Date.now();
  const scopes = new Set(input.scopes);
  let refused = false;
  let removed = 0;
```

and replace

```ts
    p.placements = [...kept, ...fresh];
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
```

with

```ts
    p.placements = [...kept, ...fresh];
    // #320: the removed Auto devices' numbers are free again, so a re-fill renumbers its scope.
    stampNewDesignators(p, new Set(fresh.map((pl) => pl.id)), codeOf);
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
```

- [ ] **Step 6: Replace part keeps or re-codes; paste and restore number**

Replace the whole of `export async function setPlacementsPart(` (through its closing `}`) with:

```ts
export async function setPlacementsPart(
  projectId: string,
  items: { id: string; partId: string; qty?: number; designator?: string }[]
): Promise<BatchResult<{ id: string; partId: string; qty?: number; designator?: string }[]>> {
  const next = byId(items);
  // #320: codes for the old AND the new parts — a number issued in the old
  // type's code is re-issued in the new one (keepsDesignatorOnSwap).
  const before = await getProject(projectId);
  const oldParts = (before?.placements || []).filter((pl) => next.has(pl.id)).map((pl) => pl.partId);
  const { codeOf } = await designatorContext([...oldParts, ...items.map((it) => it.partId)]);
  return batchEdit(
    projectId,
    items.map((it) => it.id),
    (p) => {
      ensureOptions(p);
      const previous: { id: string; partId: string; qty?: number; designator?: string }[] = [];
      const reissue = new Set<string>();
      p.placements = (p.placements || []).map((pl) => {
        const it = next.get(pl.id);
        if (!it) return pl;
        previous.push({
          id: pl.id,
          partId: pl.partId,
          ...(pl.qty !== undefined ? { qty: pl.qty } : {}),
          ...(pl.designator !== undefined ? { designator: pl.designator } : {}),
        });
        if (it.partId === pl.partId) return pl;
        const swapped: GridPlacement = withoutAuto({ ...pl, partId: it.partId });
        // An item carrying qty (undo of a swap) restores its lot through the
        // same clean as every other written qty; otherwise the lot is dropped.
        const { qty } = lotAndTag(it.qty, undefined);
        if (qty !== undefined) swapped.qty = qty;
        else delete swapped.qty;
        // #320: an undo carries the old designator back exactly; otherwise
        // keepsDesignatorOnSwap decides.
        const carried = it.designator !== undefined ? cleanDesignator(it.designator) : null;
        if (carried) swapped.designator = carried;
        else if (!keepsDesignatorOnSwap(pl.designator, codeOf(pl), codeOf(swapped))) {
          delete swapped.designator;
          reissue.add(pl.id);
        }
        return swapped;
      });
      stampNewDesignators(p, reissue, codeOf);
      return previous;
    },
    (placements, ids) => (placements.some((pl) => ids.has(pl.id) && pl.curtain) ? CURTAIN_PART_REFUSAL : null)
  );
}
```

In `pastePlacements`, replace

```ts
  if (!sheetOnProject(before, input.sheetId)) return { ok: false, error: PASTE_SHEET_GONE };

  let refused = false;
```

with

```ts
  if (!sheetOnProject(before, input.sheetId)) return { ok: false, error: PASTE_SHEET_GONE };
  // #320: a paste never carries a designator — every copy gets a fresh number.
  const { codeOf } = await designatorContext(input.items.filter((it) => !it.curtain).map((it) => it.partId));

  let refused = false;
```

and replace

```ts
    p.placements = [...(p.placements || []), ...pasted];
    if (routes.length) p.routes = [...(p.routes || []), ...routes];
    p.updatedAt = at;
    value = { placements: pasted, routes, skippedWires };
```

with

```ts
    p.placements = [...(p.placements || []), ...pasted];
    stampNewDesignators(p, new Set(pasted.map((pl) => pl.id)), codeOf);
    const stamped = byId(p.placements);
    if (routes.length) p.routes = [...(p.routes || []), ...routes];
    p.updatedAt = at;
    value = { placements: pasted.map((pl) => stamped.get(pl.id) ?? pl), routes, skippedWires };
```

In `restoreItems`, replace

```ts
  const early = refusalFor(before);
  if (early) return { ok: false, error: early };

  let refusal = null as string | null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    refusal = refusalFor(p);
    if (refusal) return;
    p.placements = [...(p.placements || []), ...placements];
```

with

```ts
  const early = refusalFor(before);
  if (early) return { ok: false, error: early };
  // #320: a restored device keeps its designator; one restored without
  // (a bundle from before #320) is numbered like a new device.
  const unnumbered = placements.filter((pl) => !pl.curtain && !cleanDesignator(pl.designator));
  const codeOf = unnumbered.length ? (await designatorContext(unnumbered.map((pl) => pl.partId))).codeOf : null;

  let refusal = null as string | null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    refusal = refusalFor(p);
    if (refusal) return;
    p.placements = [...(p.placements || []), ...placements];
    if (codeOf) stampNewDesignators(p, new Set(unnumbered.map((pl) => pl.id)), codeOf);
```

- [ ] **Step 7: Add the designator writers and `ensureDesignators`**

Insert immediately before the line `/** Set (or replace) the scale for one page of one sheet. null = the project` in `grid-projects.ts`:

```ts
/* ------------------------------ designators (#320) ------------------------------ */

const CURTAIN_DESIGNATOR_REFUSAL = "Curtains keep their names — they don't take a designator.";

/**
 * Set many devices' designators in one all-or-nothing write (batchEdit). Each
 * value goes through cleanDesignator; an empty one re-issues the next free
 * number for the device's code. A hand edit clears the #211 auto tag (a
 * re-fill then keeps the device) unless `keepAuto` — Renumber's undo/redo.
 * Curtains are refused (the whole batch). Returns the previous values ("" when none).
 */
export async function setPlacementsDesignator(
  projectId: string,
  items: { id: string; designator: string }[],
  opts: { keepAuto?: boolean } = {}
): Promise<BatchResult<{ id: string; designator: string }[]>> {
  const next = byId(items);
  const needCodes = items.some((it) => !cleanDesignator(it.designator));
  let codeOf: ((pl: { partId: string; category?: string }) => string) | null = null;
  if (needCodes) {
    const before = await getProject(projectId);
    codeOf = (await designatorContext((before?.placements || []).filter((pl) => next.has(pl.id)).map((pl) => pl.partId))).codeOf;
  }
  return batchEdit(
    projectId,
    items.map((it) => it.id),
    (p) => {
      ensureOptions(p);
      const previous: { id: string; designator: string }[] = [];
      const reissue = new Set<string>();
      p.placements = (p.placements || []).map((pl) => {
        const it = next.get(pl.id);
        if (!it) return pl;
        previous.push({ id: pl.id, designator: pl.designator || "" });
        const text = cleanDesignator(it.designator);
        if (text && text === pl.designator) return pl;
        const edited: GridPlacement = opts.keepAuto ? { ...pl } : withoutAuto({ ...pl });
        if (text) edited.designator = text;
        else {
          delete edited.designator;
          reissue.add(pl.id);
        }
        return edited;
      });
      if (codeOf) stampNewDesignators(p, reissue, codeOf);
      return previous;
    },
    (placements, ids) => (placements.some((pl) => ids.has(pl.id) && pl.curtain) ? CURTAIN_DESIGNATOR_REFUSAL : null)
  );
}

/**
 * Renumber… (#320): close the gaps of one option — every code, one code, or
 * the given devices — in reading order, in ONE patch (designators.renumber).
 * Leaves the auto tag alone (bookkeeping, not a hand edit). Returns the
 * changed devices' previous and new values, for one undo step.
 */
export async function renumberDesignators(
  projectId: string,
  optionId: string,
  target: RenumberTarget
): Promise<BatchResult<{ previous: { id: string; designator: string }[]; next: { id: string; designator: string }[] }>> {
  let gone = false as boolean;
  const previous: { id: string; designator: string }[] = [];
  const next: { id: string; designator: string }[] = [];
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, optionId)) {
      gone = true;
      return;
    }
    const own = (p.placements || []).filter((pl) => pl.optionId === optionId);
    const changes = renumber(own, readingCtxOf(p), target);
    if (!changes.size) return;
    p.placements = (p.placements || []).map((pl) => {
      const d = changes.get(pl.id);
      if (d === undefined) return pl;
      previous.push({ id: pl.id, designator: pl.designator || "" });
      next.push({ id: pl.id, designator: d });
      return { ...pl, designator: d };
    });
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, error: "Design not found." };
  if (gone) return { ok: false, error: PASTE_OPTION_GONE };
  return { ok: true, project: updated, value: { previous, next } };
}

/**
 * Existing designs (#320): number every device that has no designator yet,
 * every option on its own, and strip any a curtain carries — in ONE patch.
 * A no-op (no read, no write) when nothing is missing, so the editor page
 * calls it on every load. Doesn't bump `updatedAt`: numbering is
 * bookkeeping, not an edit. Returns the numbered project (or the one given).
 */
export async function ensureDesignators(project: GridProject, preload?: DesignatorPreload): Promise<GridProject> {
  if (!needsDesignators(project.placements || [])) return project;
  const { codeOf } = await designatorContext((project.placements || []).map((pl) => pl.partId), preload);
  let wrote = false as boolean;
  const updated = await patchDoc<GridProject>("grid_projects", project.id, (p) => {
    if (!needsDesignators(p.placements || [])) return;
    const doc = ensureOptions(p);
    doc.placements = (doc.placements || []).map((pl) => {
      if (!pl.curtain || pl.designator === undefined) return pl;
      const stripped = { ...pl };
      delete stripped.designator;
      return stripped;
    });
    for (const o of doc.options) stampDesignators(doc, o.id, codeOf);
    wrote = true;
  });
  return updated && wrote ? ensureOptions(updated) : project;
}

```

- [ ] **Step 8: Number on the riser (`src/lib/stores/grid-riser.ts`)**

After the line `import { AUTO_QTY_MAX, sanitizeAutoOrigin, withoutAuto } from "@/lib/design/grid-auto-model";` add:

```ts
import { keepsDesignatorOnSwap, stampNewDesignators } from "@/lib/design/designators";
import { designatorContext } from "@/lib/design/designators-server";
```

In `addDevicesToNode`, replace

```ts
  if (!(qty >= 1 && qty <= MAX_NODE_QTY)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | null = null;
```

with

```ts
  if (!(qty >= 1 && qty <= MAX_NODE_QTY)) return { ok: false, reason: "bad-qty" };
  const { codeOf } = await designatorContext([input.partId]);
  let refusal: Missing | DropRefusal | null = null;
```

and replace

```ts
    const at = Date.now();
    p.placements = [...(p.placements || []), ...newPlacements(drop, input.partId, input.optionId, input.by, at)];
    p.updatedAt = at;
```

with

```ts
    const at = Date.now();
    const fresh = newPlacements(drop, input.partId, input.optionId, input.by, at);
    p.placements = [...(p.placements || []), ...fresh];
    stampNewDesignators(p, new Set(fresh.map((pl) => pl.id)), codeOf);
    p.updatedAt = at;
```

In `setNodeDeviceQty`, replace

```ts
  if (!(Number.isFinite(qty) && qty >= 1 && qty <= AUTO_QTY_MAX)) return { ok: false, reason: "bad-qty" };
  let refusal: Missing | DropRefusal | "bad-qty" | "no-devices" | null = null;
```

with

```ts
  if (!(Number.isFinite(qty) && qty >= 1 && qty <= AUTO_QTY_MAX)) return { ok: false, reason: "bad-qty" };
  const { codeOf } = await designatorContext([input.partId]);
  let refusal: Missing | DropRefusal | "bad-qty" | "no-devices" | null = null;
```

and replace

```ts
      ...fresh,
    ];
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    added = fresh.length;
```

with

```ts
      ...fresh,
    ];
    // #320: a lot whose qty changed keeps its first number (a grown block that
    // now overlaps another device is flagged, never silently renumbered).
    if (fresh.length) stampNewDesignators(p, new Set(fresh.map((pl) => pl.id)), codeOf);
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    added = fresh.length;
```

In `replaceNodeDevicePart`, replace

```ts
  let refusal: Missing | "no-devices" | null = null;
  let changed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
```

(the first occurrence, inside `replaceNodeDevicePart`) with

```ts
  const { codeOf } = await designatorContext([input.fromPartId, input.toPartId]);
  let refusal: Missing | "no-devices" | null = null;
  let changed = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
```

and replace

```ts
    p.placements = (p.placements || []).map((pl) => (ids.has(pl.id) ? { ...withoutAuto(pl), partId: input.toPartId } : pl));
    changed = ids.size;
```

with

```ts
    // #320: Replace part's designator rule (keepsDesignatorOnSwap), as on the plan.
    const reissue = new Set<string>();
    p.placements = (p.placements || []).map((pl) => {
      if (!ids.has(pl.id)) return pl;
      const swapped: GridPlacement = { ...withoutAuto(pl), partId: input.toPartId };
      if (!keepsDesignatorOnSwap(pl.designator, codeOf(pl), codeOf(swapped))) {
        delete swapped.designator;
        reissue.add(pl.id);
      }
      return swapped;
    });
    stampNewDesignators(p, reissue, codeOf);
    changed = ids.size;
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#320|#299|#318|FAIL|ALL PASSED|FAILED" | tail -60`
Expected: every `#320` line `PASS`; the existing `#299` / `#318` store checks still `PASS`; `ALL PASSED`. If an older assertion compares a whole placement record and now sees a `designator`, add the field to that expectation only (none is known — the `#299 batch` lot round-trip passes `sw.value` straight back, which now also carries the designator).

- [ ] **Step 10: Typecheck and lint**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5
npx eslint src/lib/design/designators-server.ts src/lib/stores/grid-projects.ts src/lib/stores/grid-riser.ts
```

- [ ] **Step 11: Commit**

```bash
git add src/lib/design/designators-server.ts src/lib/stores/grid-projects.ts src/lib/stores/grid-riser.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #320 designators assigned in every create path; ensureDesignators

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Actions + editor — plan label, Property Editor, Browser tree, undo, page load

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/actions.ts`, `src/lib/design/grid-undo.ts`, `src/app/(app)/design/grid/[id]/use-grid-editor.ts`, `src/app/(app)/design/grid/[id]/page.tsx`, `src/app/(app)/design/grid/[id]/plan-canvas.tsx`, `src/app/(app)/design/grid/[id]/workspace/property-editor.tsx`, `src/lib/design/grid-browser-tree.ts`, `src/app/(app)/design/grid/[id]/workspace/browser-tree.tsx`
- Test: `scripts/test-review-and-spec.ts` (new `designators320EditorChecks` + chain line)

**Interfaces:**
- Consumes (Tasks 1–2): `setPlacementsDesignator`, `renumberDesignators`, `ensureDesignators`, `cleanDesignator`, `formatDesignator`, `duplicates`, `designatorList`, `DESIGNATOR_DUPLICATE_COLOR`, `DESIGNATOR_MAX`, `RenumberTarget`.
- Produces:
  - `setDesignatorsAction(projectId: string, items: { id: string; designator: string }[], opts?: { keepAuto?: boolean }): Promise<{ ok: true; previous: { id: string; designator: string }[] } | { ok: false; error: string }>`
  - `renumberDesignatorsAction(projectId: string, optionId: string, target: RenumberTarget): Promise<{ ok: true; previous: { id: string; designator: string }[]; next: { id: string; designator: string }[] } | { ok: false; error: string }>`
  - `GridCommand` `{ kind: "designator"; items: { id: string; designator: string }[]; keepAuto?: boolean }`; `part` items may carry `designator?: string`
  - Hook (`GridEditor`): `designatorDupes: Set<string>`, `saveDesignators(items): Promise<boolean>`, `renumberDesignators(target: RenumberTarget, what: string): Promise<boolean>`, `focusPlacements(ids: string[], focusId?: string): void`
  - `BrowserTreeInput.leafLabel?: (pl: GridPlacement) => string | null`

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #320: Grid device designators — editor wiring ---------------- */
async function designators320EditorChecks(): Promise<void> {
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const D = await import("@/lib/design/designators");
  const TR = await import("@/lib/design/grid-browser-tree");
  const U = await import("@/lib/design/grid-undo");

  const tree = TR.browserTree({
    designName: "D",
    sheets: [{ id: "s1", name: "Base" }],
    placements: [
      { id: "a", sheetId: "s1", page: 1, x: 0.1, y: 0.1, partId: "P", designator: "MIC-1", by: "t", at: 1 },
      { id: "b", sheetId: "s1", page: 1, x: 0.2, y: 0.1, partId: "P", designator: "MIC-2", qty: 3, by: "t", at: 1 },
    ] as never,
    spaces: [],
    routes: [],
    nameOf: () => "Shure SM57 dynamic mic",
    membersOf: () => [],
    wireName: () => "",
    leafLabel: (pl) => `${D.formatDesignator(pl.designator, pl.qty)} · SM57`,
  });
  const group = tree.children![0].children![0].children![0];
  ok(group.label === "Shure SM57 dynamic mic ×4" && group.children!.map((n) => n.label).join("|") === "MIC-1 · SM57|MIC-2–4 · SM57",
    "#320 Browser tree: device leaves read designator · model (a lot by its range); groups keep the description");
  const entry = { label: "set designator (1 device)", forward: { kind: "designator" as const, items: [{ id: "a", designator: "MIC-9" }] }, inverse: { kind: "designator" as const, items: [{ id: "a", designator: "MIC-1" }], keepAuto: true } };
  ok(U.pushUndo(U.emptyUndo(), entry).past[0].inverse.kind === "designator", "#320 undo: a designator edit is one undo step");

  const acts = rd("src/app/(app)/design/grid/[id]/actions.ts");
  const body = (name: string) => { const i = acts.indexOf(`export async function ${name}(`); if (i < 0) return ""; const j = acts.indexOf("export async function", i + 10); return acts.slice(i, j < 0 ? undefined : j); };
  ok(["setDesignatorsAction", "renumberDesignatorsAction"].every((n) => body(n).includes("await requireUser();")) &&
     body("setDesignatorsAction").includes("setPlacementsDesignator(") && body("renumberDesignatorsAction").includes("renumberDesignators("),
    "#320 actions: both designator actions are authed like every placement edit and write through the store");
  const clean = acts.slice(acts.indexOf("async function cleanRestoredPlacement("), acts.indexOf("export async function restoreItemsAction("));
  ok(clean.includes("const designator = curtain ? null : cleanDesignator(raw.designator);") && clean.includes("...(designator ? { designator } : {}),"),
    "#320 undo restore keeps a device's designator (whitelisted, cleaned; never on a curtain)");
  ok(body("replacePlacementsPartAction").includes("...(it.designator !== undefined ? { designator: it.designator } : {})"), "#320 Replace part's undo carries the designator back");
  const page = rd("src/app/(app)/design/grid/[id]/page.tsx");
  ok(page.includes("await ensureDesignators(project, { parts, deviceTypes })") && page.includes("placements: designed.placements || [],") && page.includes("scheduleForOption(designed, activeOptionId,"),
    "#320 page: the editor numbers any device missing a designator before it renders");
  const canvas = rd("src/app/(app)/design/grid/[id]/plan-canvas.tsx");
  ok(canvas.includes("const tag = pl.curtain ? \"\" : formatDesignator(pl.designator, q);") && canvas.includes("<title>{hover}</title>") && canvas.includes("designatorDupes.has(pl.id)"),
    "#320 plan: a device is labelled by its designator (a lot by its range, no ×N), with a hover title; duplicates drawn amber");
  const prop = rd("src/app/(app)/design/grid/[id]/workspace/property-editor.tsx");
  ok(prop.includes('<PropRow label="Designator"') && prop.includes("<DesignatorRow key={selectedPlacement.id}") && prop.includes("Renumber selection"),
    "#320 Property Editor: an editable Designator row; several selected → Renumber selection");
  const btree = rd("src/app/(app)/design/grid/[id]/workspace/browser-tree.tsx");
  ok(btree.includes("leafLabel: (pl: GridPlacement) =>"), "#320 the Browser tab passes the designator leaf label");
  const hook = rd("src/app/(app)/design/grid/[id]/use-grid-editor.ts");
  ok(hook.includes('case "designator": {') && hook.includes("setDesignatorsAction(project.id, c.items, { keepAuto: c.keepAuto === true })") &&
     hook.includes("const designatorDupes = useMemo(() => duplicates(placements), [placements]);") && hook.includes("keepAuto: true"),
    "#320 hook: duplicates per option, edits and Renumber are undoable steps (Renumber keeps the auto tag)");
}
```

Chain it after the Task 2 line:

```ts
  .then(() => designators320EditorChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#320 (Browser|actions|page|plan|Property|hook|undo)" | head`
Expected: `FAIL` lines (or a tsc error that `leafLabel` doesn't exist on `BrowserTreeInput`).

- [ ] **Step 3: Undo command shape (`src/lib/design/grid-undo.ts`)**

Replace

```ts
  | { kind: "category"; items: { id: string; category: string }[] }
  | { kind: "part"; items: { id: string; partId: string; qty?: number }[] };
```

with

```ts
  | { kind: "category"; items: { id: string; category: string }[] }
  | { kind: "part"; items: { id: string; partId: string; qty?: number; designator?: string }[] }
  /** #320: set designators; `keepAuto` for Renumber's undo/redo (not a hand edit). */
  | { kind: "designator"; items: { id: string; designator: string }[]; keepAuto?: boolean };
```

- [ ] **Step 4: The actions (`src/app/(app)/design/grid/[id]/actions.ts`)**

In the `from "@/lib/stores/grid-projects"` import list, after `setPlacementsPart,` add:

```ts
  setPlacementsDesignator,
  renumberDesignators,
```

After the line `import { isPerLengthUnit, type GridCurtain } from "@/lib/design/grid-bom";` add:

```ts
import { cleanDesignator, type RenumberTarget } from "@/lib/design/designators";
```

In `replacePlacementsPartAction`, replace

```ts
  items: { id: string; partId: string; qty?: number }[]
): Promise<{ ok: true; previous: { id: string; partId: string; qty?: number }[] } | { ok: false; error: string }> {
  await requireUser();
  if (
    !isStr(projectId) || !Array.isArray(items) ||
    !items.every((it) => isObj(it) && isStr(it.id) && isStr(it.partId) && it.partId !== "" && (it.qty === undefined || isFiniteNum(it.qty)))
  )
```

with

```ts
  items: { id: string; partId: string; qty?: number; designator?: string }[]
): Promise<{ ok: true; previous: { id: string; partId: string; qty?: number; designator?: string }[] } | { ok: false; error: string }> {
  await requireUser();
  if (
    !isStr(projectId) || !Array.isArray(items) ||
    !items.every(
      (it) =>
        isObj(it) && isStr(it.id) && isStr(it.partId) && it.partId !== "" && (it.qty === undefined || isFiniteNum(it.qty)) &&
        (it.designator === undefined || isStr(it.designator))
    )
  )
```

and replace

```ts
    items.map((it) => ({ id: it.id, partId: it.partId, ...(it.qty !== undefined ? { qty: it.qty } : {}) }))
```

with

```ts
    items.map((it) => ({
      id: it.id,
      partId: it.partId,
      ...(it.qty !== undefined ? { qty: it.qty } : {}),
      // #320: undo of a swap carries the old designator back.
      ...(it.designator !== undefined ? { designator: it.designator } : {}),
    }))
```

In `cleanRestoredPlacement`, replace

```ts
  const autoOrigin = raw.autoOrigin === undefined ? null : sanitizeAutoOrigin(raw.autoOrigin);
```

with

```ts
  const autoOrigin = raw.autoOrigin === undefined ? null : sanitizeAutoOrigin(raw.autoOrigin);
  // #320: undo restore keeps the designator; a curtain never carries one.
  const designator = curtain ? null : cleanDesignator(raw.designator);
```

and replace

```ts
    ...(category ? { category } : {}),
    ...(curtain ? { curtain } : {}),
```

(inside `cleanRestoredPlacement`'s return) with

```ts
    ...(category ? { category } : {}),
    ...(designator ? { designator } : {}),
    ...(curtain ? { curtain } : {}),
```

Insert immediately before `export async function calibrateAction(`:

```ts
/* ------------------------------ designators (#320) ------------------------------ */

/** Raw length a client may send for one designator (the store caps at 24). */
const DESIGNATOR_INPUT_MAX = 200;

/** Set (or, with "", re-issue) many devices' designators in one write.
 *  `previous` holds the old values for undo; curtains are refused (store).
 *  `keepAuto` is only for undo/redo of a Renumber — a hand edit clears the tag. */
export async function setDesignatorsAction(
  projectId: string,
  items: { id: string; designator: string }[],
  opts?: { keepAuto?: boolean }
): Promise<{ ok: true; previous: { id: string; designator: string }[] } | { ok: false; error: string }> {
  await requireUser();
  if (
    !isStr(projectId) || !Array.isArray(items) ||
    !items.every((it) => isObj(it) && isStr(it.id) && isStr(it.designator) && it.designator.length <= DESIGNATOR_INPUT_MAX)
  )
    return { ok: false, error: BATCH_INVALID };
  const r = await setPlacementsDesignator(
    projectId,
    items.map((it) => ({ id: it.id, designator: it.designator })),
    { keepAuto: opts?.keepAuto === true }
  );
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  return { ok: true, previous: r.value };
}

function cleanRenumberTarget(raw: unknown): RenumberTarget | null {
  if (!isObj(raw)) return null;
  if (raw.all === true) return { all: true };
  if (isStr(raw.code) && raw.code.trim() && raw.code.length <= 24) return { code: raw.code.trim() };
  if (Array.isArray(raw.ids) && raw.ids.length > 0 && raw.ids.length <= MAX_BATCH && raw.ids.every(isStr)) return { ids: raw.ids };
  return null;
}

/** Renumber… — close the gaps of one option (all / one code / the given
 *  devices) in reading order, in one write. `previous` / `next` are the
 *  changed devices only, so the editor records one undo step. */
export async function renumberDesignatorsAction(
  projectId: string,
  optionId: string,
  target: RenumberTarget
): Promise<
  { ok: true; previous: { id: string; designator: string }[]; next: { id: string; designator: string }[] } | { ok: false; error: string }
> {
  await requireUser();
  const t = cleanRenumberTarget(target);
  if (!isStr(projectId) || !isStr(optionId) || !t) return { ok: false, error: BATCH_INVALID };
  const r = await renumberDesignators(projectId, optionId, t);
  if (!r.ok) return r;
  if (r.value.next.length) revalidatePath(editorPath(projectId));
  return { ok: true, previous: r.value.previous, next: r.value.next };
}

```

- [ ] **Step 5: The editor hook (`src/app/(app)/design/grid/[id]/use-grid-editor.ts`)**

In the `from "./actions"` import list, after `replacePlacementsPartAction,` add:

```ts
  renumberDesignatorsAction,
  setDesignatorsAction,
```

After the line `import { customItemsOf } from "@/lib/design/grid-custom-items";` add:

```ts
import { duplicates, type RenumberTarget } from "@/lib/design/designators";
```

Replace

```ts
  const active = useMemo(() => optionSlice(project, activeOptionId), [project, activeOptionId]);
  const placements = active.placements;
  const routes = active.routes;
```

with

```ts
  const active = useMemo(() => optionSlice(project, activeOptionId), [project, activeOptionId]);
  const placements = active.placements;
  const routes = active.routes;
  /** #320: devices whose designator another device of this option also holds — drawn amber. */
  const designatorDupes = useMemo(() => duplicates(placements), [placements]);
```

Insert immediately before `  /* ------------------------- clipboard (#299) ------------------------- */`:

```ts
  /* ------------------------- designators (#320) ------------------------- */

  /** Set (or, with "", re-issue) designators — one write, one undo step.
   *  Resolves true when it saved. */
  const saveDesignators = useCallback(
    async (items: { id: string; designator: string }[]): Promise<boolean> => {
      if (!items.length) return false;
      if (!(await flushNudge())) return false;
      setErr(null);
      setBusy(true);
      try {
        const r = await setDesignatorsAction(project.id, items);
        if (!r.ok) {
          setErr(r.error);
          return false;
        }
        const one = items.length === 1 ? items[0].designator.trim() : "";
        noteAction(items.length > 1 ? `Set ${items.length} designators` : one ? `Designator ${one}` : "Re-issued a designator");
        record({ label: stepLabel("set designator", items.length), forward: { kind: "designator", items }, inverse: { kind: "designator", items: r.previous } });
        router.refresh();
        return true;
      } catch {
        setErr(SAVE_FAILED);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [project.id, router, noteAction, flushNudge, record]
  );

  /** Renumber… on the active option: `what` names the target in the status bar. */
  const renumberDesignators = useCallback(
    async (target: RenumberTarget, what: string): Promise<boolean> => {
      if (!(await flushNudge())) return false;
      setErr(null);
      setBusy(true);
      try {
        const r = await renumberDesignatorsAction(project.id, activeOptionId, target);
        if (!r.ok) {
          setErr(r.error);
          return false;
        }
        if (!r.next.length) {
          noteAction(`Renumber ${what}: already in order`);
          return true;
        }
        noteAction(`Renumbered ${what} — ${r.next.length} changed`);
        record({
          label: stepLabel("renumber", r.next.length),
          forward: { kind: "designator", items: r.next, keepAuto: true },
          inverse: { kind: "designator", items: r.previous, keepAuto: true },
        });
        router.refresh();
        return true;
      } catch {
        setErr(SAVE_FAILED);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [project.id, activeOptionId, router, noteAction, flushNudge, record]
  );

  /** Select devices from a list (the Devices tab) and show the focused one's
   *  sheet and page on the plan. */
  const focusPlacements = useCallback(
    (ids: string[], focusId?: string) => {
      const target = placements.find((pl) => pl.id === (focusId ?? ids[0]));
      if (target && (target.sheetId !== activeSheetId || target.page !== page)) {
        setActiveSheetId(target.sheetId);
        setPage(target.page);
        resetSheetState();
      }
      setSelectedIds(ids);
      setSelectedSpaceId(null);
      setSelectedRouteId(null);
      setCategoryDraft(null);
    },
    [placements, activeSheetId, page, resetSheetState]
  );

```

In `runCommand`, replace

```ts
        case "part": {
          const r = await replacePlacementsPartAction(project.id, c.items);
          if (!r.ok) return r;
          router.refresh();
          return { ok: true };
        }
      }
    },
    [placements, project.id, router]
  );
```

with

```ts
        case "part": {
          const r = await replacePlacementsPartAction(project.id, c.items);
          if (!r.ok) return r;
          router.refresh();
          return { ok: true };
        }
        case "designator": {
          const r = await setDesignatorsAction(project.id, c.items, { keepAuto: c.keepAuto === true });
          if (!r.ok) return r;
          router.refresh();
          return { ok: true };
        }
      }
    },
    [placements, project.id, router]
  );
```

In the hook's `return {`, replace

```ts
    replacePartForSelected,
    clipboard,
```

with

```ts
    replacePartForSelected,
    designatorDupes,
    saveDesignators,
    renumberDesignators,
    focusPlacements,
    clipboard,
```

- [ ] **Step 6: Number on page load (`src/app/(app)/design/grid/[id]/page.tsx`)**

Replace `import { getProject, listSheets } from "@/lib/stores/grid-projects";` with:

```ts
import { ensureDesignators, getProject, listSheets } from "@/lib/stores/grid-projects";
```

Replace

```ts
  const symbolUrls = await symbolUrlsFor(parts, deviceTypes.types, { docs: docRows, links: docLinks }).catch((e: unknown) => {
    console.error("[grid] object symbol lookup failed:", e);
    return {};
  });
```

with

```ts
  const symbolUrls = await symbolUrlsFor(parts, deviceTypes.types, { docs: docRows, links: docLinks }).catch((e: unknown) => {
    console.error("[grid] object symbol lookup failed:", e);
    return {};
  });
  // #320: number every device that has no designator yet (a design drawn
  // before #320) — one write, none at all when nothing is missing, codes from
  // the parts this request already built. Never fatal.
  const designed = await ensureDesignators(project, { parts, deviceTypes }).catch((e: unknown) => {
    console.error("[grid] designators failed:", e);
    return project;
  });
```

Replace `  const schedule = await scheduleForOption(project, activeOptionId, { catalog, gridSymbols, settings, deviceTypes, equip: equipLoaded }).catch(` with:

```ts
  const schedule = await scheduleForOption(designed, activeOptionId, { catalog, gridSymbols, settings, deviceTypes, equip: equipLoaded }).catch(
```

(keep the rest of that statement — the `(e: unknown) => {` line onward — unchanged; only `project` → `designed` on that line.)

Replace `        placements: project.placements || [],` with:

```ts
        placements: designed.placements || [],
```

- [ ] **Step 7: The plan label (`src/app/(app)/design/grid/[id]/plan-canvas.tsx`)**

After `import { markerBox } from "@/lib/design/grid-symbol-display";` add:

```ts
import { DESIGNATOR_DUPLICATE_COLOR, formatDesignator } from "@/lib/design/designators";
```

In the `const { … } = ed;` destructure at the top of `PlanCanvas`, after `symbolUrls,` add `designatorDupes,`.

Replace

```ts
              const q = placementQty(pl);
              const label =
                (pl.curtain
                  ? pl.curtain.name
                  : part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category : undefined) || pl.partId) +
                (q > 1 ? ` ×${q}` : "");
              return (
                <g key={pl.id}>
```

with

```ts
              const q = placementQty(pl);
              const name = part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category : undefined) || pl.partId;
              // #320: a device reads by its designator — a lot by its range, so
              // no ×N; a device not yet numbered falls back to its description.
              // Curtains keep their name.
              const tag = pl.curtain ? "" : formatDesignator(pl.designator, q);
              const label = pl.curtain ? pl.curtain.name : tag || name + (q > 1 ? ` ×${q}` : "");
              const ink = !pl.curtain && designatorDupes.has(pl.id) ? DESIGNATOR_DUPLICATE_COLOR : c;
              const model = part?.virtual ? "" : part?.modelNumber || part?.sku || "";
              const hover = pl.curtain ? pl.curtain.name : [tag, model !== name ? model : "", name].filter(Boolean).join(" · ");
              return (
                <g key={pl.id}>
                  <title>{hover}</title>
```

Replace

```ts
                  <rect x={x + 12 * s} y={y - 8} width={Math.max(30, label.length * 6.4) + 8} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                  <text x={x + 12 * s + 4} y={y + 4} fill={c} fontSize={10.5} fontWeight={700} style={{ fontFamily: "inherit" }}>
```

with

```ts
                  <rect x={x + 12 * s} y={y - 8} width={Math.max(22, label.length * 6.4) + 8} height={16} rx={4} fill="#fff" stroke={ink} strokeWidth={1} opacity={0.95} />
                  <text x={x + 12 * s + 4} y={y + 4} fill={ink} fontSize={10.5} fontWeight={700} style={{ fontFamily: "inherit" }}>
```

- [ ] **Step 8: Property Editor (`workspace/property-editor.tsx`)**

After `import { UNMAPPED_TYPE } from "@/lib/design/device-types";` add:

```ts
import { cleanDesignator, DESIGNATOR_DUPLICATE_COLOR, DESIGNATOR_MAX, designatorList, formatDesignator } from "@/lib/design/designators";
```

In `DeviceProps`, replace

```tsx
      <PropSection title={selectedPlacement.curtain ? "Selected curtain" : "Selected device"} />
```

with

```tsx
      <PropSection title={selectedPlacement.curtain ? "Selected curtain" : "Selected device"} />
      {!selectedPlacement.curtain && <DesignatorRow key={selectedPlacement.id} ed={ed} pl={selectedPlacement} />}
```

Insert immediately before `/* ------------------------------ several at once ------------------------------ */`:

```tsx
/** #320: the device's designator — click to edit; Enter saves, Esc cancels;
 *  an empty value re-issues the next free number. Keyed by the device, so
 *  the draft resets when the selection changes. */
function DesignatorRow({ ed, pl }: { ed: GridEditor; pl: GridPlacement }) {
  const { busy, designatorDupes, saveDesignators } = ed;
  const [draft, setDraft] = useState<string | null>(null);
  const qty = placementQty(pl);
  const shown = formatDesignator(pl.designator, qty);
  const dupe = designatorDupes.has(pl.id);
  const save = async () => {
    if (draft === null) return;
    if ((cleanDesignator(draft) ?? "") === (pl.designator ?? "")) {
      setDraft(null);
      return;
    }
    if (await saveDesignators([{ id: pl.id, designator: draft }])) setDraft(null);
  };
  return (
    <PropRow label="Designator" title={qty > 1 ? `A lot of ${qty} holds ${shown}` : "Click to rename — leave it empty to take the next free number"}>
      {draft === null ? (
        <button
          type="button"
          style={{
            ...BTN,
            width: "100%",
            padding: "3px 7px",
            fontSize: 11,
            fontWeight: 700,
            textAlign: "left",
            fontFamily: "var(--font-mono)",
            ...(dupe ? { color: DESIGNATOR_DUPLICATE_COLOR, borderColor: DESIGNATOR_DUPLICATE_COLOR } : {}),
          }}
          onClick={() => setDraft(pl.designator ?? "")}
        >
          {shown || "+ Add a designator"}
        </button>
      ) : (
        <span style={{ display: "flex", gap: 5 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={DESIGNATOR_MAX}
            placeholder="Blank = next free number"
            aria-label="Designator"
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
              if (e.key === "Enter" && !busy) void save();
            }}
            style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", minWidth: 0, fontFamily: "var(--font-mono)" }}
            autoFocus
          />
          <button type="button" style={{ ...BTN, padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </span>
      )}
      {dupe && draft === null && <div style={{ fontSize: 10.5, color: DESIGNATOR_DUPLICATE_COLOR, marginTop: 3 }}>Another device uses this designator.</div>}
    </PropRow>
  );
}

```

In `SeveralProps`, in the `const { … } = ed;` destructure, after `replacePartForSelected,` add `renumberDesignators,`. Then replace

```tsx
      {/* A curtain's part is its fabric — the server refuses the swap, so
```

with

```tsx
      {curtainCount < n && (
        <PropRow label="Designators" title="Renumber the selected devices in reading order — they take the lowest free numbers of their codes">
          <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {designatorList(pls.filter((pl) => !pl.curtain)) || "—"}
            </span>
            <button
              type="button"
              style={{ ...BTN, padding: "3px 8px", fontSize: 11, flex: "0 0 auto", whiteSpace: "nowrap" }}
              disabled={busy}
              onClick={() => void renumberDesignators({ ids: pls.filter((pl) => !pl.curtain).map((pl) => pl.id) }, "the selection")}
            >
              Renumber selection
            </button>
          </span>
        </PropRow>
      )}

      {/* A curtain's part is its fabric — the server refuses the swap, so
```

- [ ] **Step 9: Browser tree leaves**

In `src/lib/design/grid-browser-tree.ts`, in `export type BrowserTreeInput = {`, after the `wireName: (r: GridRoute) => string;` member add:

```ts
  /** #320: a device leaf's own label (`MIC-1 · SM57`); null/absent → the
   *  name (×qty for a lot), as before. Groups keep the name. */
  leafLabel?: (pl: GridPlacement) => string | null;
```

Replace

```ts
function deviceNode(pl: GridPlacement, name: string, members: string[]): TreeNode {
  const qty = placementQty(pl);
  const node: TreeNode = {
    key: `pl:${pl.id}`,
    kind: "device",
    label: qty > 1 ? `${name} ×${qty}` : name,
```

with

```ts
function deviceNode(pl: GridPlacement, name: string, members: string[], leaf?: string | null): TreeNode {
  const qty = placementQty(pl);
  const node: TreeNode = {
    key: `pl:${pl.id}`,
    kind: "device",
    label: leaf || (qty > 1 ? `${name} ×${qty}` : name),
```

and in `groupNodes` replace

```ts
      if (list.length === 1) return deviceNode(list[0], name, i.membersOf(list[0]));
```

with

```ts
      if (list.length === 1) return deviceNode(list[0], name, i.membersOf(list[0]), i.leafLabel?.(list[0]));
```

and

```ts
        children: list.map((pl) => deviceNode(pl, name, i.membersOf(pl))),
```

with

```ts
        children: list.map((pl) => deviceNode(pl, name, i.membersOf(pl), i.leafLabel?.(pl))),
```

In `src/app/(app)/design/grid/[id]/workspace/browser-tree.tsx`, add to the imports:

```ts
import { placementQty } from "@/lib/design/grid-bom";
import { formatDesignator } from "@/lib/design/designators";
```

and replace

```ts
        wireName: (r: GridRoute) => partById.get(r.partId)?.desc || r.partId,
      }),
```

with

```ts
        wireName: (r: GridRoute) => partById.get(r.partId)?.desc || r.partId,
        // #320: leaves read "MIC-1 · SM57" (a lot by its range).
        leafLabel: (pl: GridPlacement) => {
          if (pl.curtain) return null;
          const d = formatDesignator(pl.designator, placementQty(pl));
          if (!d) return null;
          const part = partById.get(pl.partId);
          return `${d} · ${part?.virtual ? part.desc : part?.modelNumber || part?.sku || pl.partId}`;
        },
      }),
```

(If `placementQty` is already imported in `browser-tree.tsx`, skip that import line.)

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#320|#299|FAIL|ALL PASSED|FAILED" | tail -60`
Expected: every `#320` line `PASS` (the `#299 tree` checks still pass — `leafLabel` is optional); `ALL PASSED`.

- [ ] **Step 11: Typecheck, lint, build-gate the client imports**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5
npx eslint "src/app/(app)/design/grid/[id]/actions.ts" src/lib/design/grid-undo.ts "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/plan-canvas.tsx" "src/app/(app)/design/grid/[id]/workspace/property-editor.tsx" src/lib/design/grid-browser-tree.ts "src/app/(app)/design/grid/[id]/workspace/browser-tree.tsx"
npm run build 2>&1 | tail -15   # a client file must not pull designators-server or a store; expect the build to complete
```

- [ ] **Step 12: Commit**

```bash
git add src/lib/design/grid-undo.ts src/lib/design/grid-browser-tree.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/plan-canvas.tsx" "src/app/(app)/design/grid/[id]/workspace/property-editor.tsx" "src/app/(app)/design/grid/[id]/workspace/browser-tree.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #320 designators on the plan, Property Editor and Browser; edit + renumber actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Spreadsheet — Devices + Schedule tabs

**Files:**
- Create: `src/lib/design/grid-device-rows.ts`, `src/app/(app)/design/grid/[id]/workspace/devices-table.tsx`
- Modify: `src/app/(app)/design/grid/[id]/workspace/spreadsheet-view.tsx`
- Test: `scripts/test-review-and-spec.ts` (new `designators320DeviceRowsChecks` + chain line)

**Interfaces:**
- Consumes: Task 1 (`cleanDesignator`, `formatDesignator`, `readingOrder`, `DESIGNATOR_*`, `RenumberTarget`), Task 3 hook (`designatorDupes`, `saveDesignators`, `renumberDesignators`, `focusPlacements`, existing `saveCategory`, `typeKeyOfPlacement`, `categoryCounts`, `selectedIds`, `busy`), `effectiveTypeCode`, `typeLabel`, `Menu` (`workspace/menu.tsx`).
- Produces (`grid-device-rows.ts`): `DeviceRow`, `DeviceColumnKey`, `DeviceColumn`, `DEVICE_COLUMNS`, `NO_SPACE`, `DeviceFilter`, `DeviceSort`, `EditCol = "designator" | "category"`, `deviceRows(input: DeviceRowInput): DeviceRow[]`, `filterDeviceRows(rows, f)`, `sortDeviceRows(rows, sort)`, `cellText(r, key): string`, `nextCell(rows, id, col, move: "down" | "up" | "right" | "left"): { id: string; col: EditCol } | null`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #320: Spreadsheet Devices tab ---------------- */
async function designators320DeviceRowsChecks(): Promise<void> {
  const R = await import("@/lib/design/grid-device-rows");
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const sp = { id: "sp1", sheetId: "s1", page: 1, name: "Stage", color: "#000", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }], by: "t", at: 1 };
  const pls = [
    { id: "a", sheetId: "s1", page: 1, x: 0.7, y: 0.1, partId: "SPK1", designator: "SPK-2", by: "t", at: 1 },
    { id: "b", sheetId: "s1", page: 1, x: 0.2, y: 0.5, partId: "MIC1", designator: "MIC-10", category: "FOH", by: "t", at: 1 },
    { id: "c", sheetId: "s2", page: 2, x: 0.1, y: 0.1, partId: "PIPE", designator: "TR-1", qty: 24, by: "t", at: 1 },
    { id: "d", sheetId: "s1", page: 1, x: 0.3, y: 0.6, partId: "MIC1", designator: "MIC-2", by: "t", at: 1 },
    { id: "e", sheetId: "s1", page: 1, x: 0.4, y: 0.4, partId: "FAB", curtain: { name: "Main" }, by: "t", at: 1 },
  ];
  const typeOf: Record<string, string> = { SPK1: "speakers", MIC1: "microphones", PIPE: "truss-pipe" };
  const rows = R.deviceRows({
    placements: pls as never,
    sheets: [{ id: "s1", name: "Floor" }, { id: "s2", name: "Ceiling" }],
    spaces: [sp] as never,
    typeKeyOf: (pl) => typeOf[pl.partId],
    typeLabelOf: (k) => k,
    modelOf: (pl) => pl.partId,
    descOf: () => "d",
    duplicates: new Set(["d"]),
  });
  ok(rows.map((r) => r.id).join(",") === "b,d,a,c", "#320 Devices: one row per device (curtains left out), in reading order");
  ok(rows[3].display === "TR-1–24" && rows[3].sheet === "Ceiling · p2" && rows[3].qty === 24 && rows[0].space === "Stage" && rows[2].space === "—" && rows[0].category === "FOH" && rows[1].duplicate,
    "#320 Devices: lot range, sheet · page, space, category, duplicate flag");
  ok(R.filterDeviceRows(rows, { type: "microphones" }).map((r) => r.id).join(",") === "b,d" && R.filterDeviceRows(rows, { space: R.NO_SPACE }).map((r) => r.id).join(",") === "a,c" &&
     R.filterDeviceRows(rows, { sheet: "s2" }).map((r) => r.id).join(",") === "c",
    "#320 Devices: filter by type, space (incl. No space) and sheet");
  ok(R.sortDeviceRows(rows, { key: "designator", dir: 1 }).map((r) => r.id).join(",") === "d,b,a,c" && R.sortDeviceRows(rows, { key: "designator", dir: -1 }).map((r) => r.id).join(",") === "c,a,b,d" &&
     R.sortDeviceRows(rows, { key: "qty", dir: -1 })[0].id === "c" && R.sortDeviceRows(R.sortDeviceRows(rows, { key: "qty", dir: -1 }), null).map((r) => r.id).join(",") === "b,d,a,c",
    "#320 Devices: header sort (designators in number order), and back to reading order");
  const J = (v: unknown) => JSON.stringify(v);
  ok(J(R.nextCell(rows, "b", "designator", "right")) === J({ id: "b", col: "category" }) && J(R.nextCell(rows, "b", "category", "right")) === J({ id: "d", col: "designator" }) &&
     R.nextCell(rows, "c", "designator", "down") === null && J(R.nextCell(rows, "d", "designator", "left")) === J({ id: "b", col: "category" }) && J(R.nextCell(rows, "d", "designator", "up")) === J({ id: "b", col: "designator" }),
    "#320 Devices: Enter moves down, Tab moves right (wrapping to the next row), Shift goes back");
  ok(R.DEVICE_COLUMNS.map((c) => c.key).join(",") === "designator,type,model,desc,space,sheet,qty,category" && R.DEVICE_COLUMNS.filter((c) => c.editable).map((c) => c.key).join(",") === "designator,category",
    "#320 Devices: the column list (Designator and Category editable)");

  const view = rd("src/app/(app)/design/grid/[id]/workspace/spreadsheet-view.tsx");
  const table = rd("src/app/(app)/design/grid/[id]/workspace/devices-table.tsx");
  ok(view.includes('useState<Tab>("devices")') && view.includes('role="tablist"') && view.includes("<DevicesTable ed={ed} />") && view.includes("<ScheduleTable schedule={schedule}"),
    "#320 Spreadsheet: Devices (default) and Schedule tabs");
  ok(table.startsWith('"use client"') && table.includes("data-no-nudge") && table.includes("nextCell(shown, cur.id, cur.col, move)") && table.includes("focusPlacements(ids, r.id)") &&
     table.includes("renumberDesignators(target, what)") && table.includes("Selected rows") && !/from\s+"@\/lib\/stores\//.test(table) && !table.includes("designators-server"),
    "#320 Devices tab: inline edit moves cell to cell, a row click selects on the plan, Renumber menu; no store import");
}
```

Chain it after the Task 3 line:

```ts
  .then(() => designators320DeviceRowsChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/design/grid-device-rows'`.

- [ ] **Step 3: Write `src/lib/design/grid-device-rows.ts`**

```ts
/**
 * The Grid's Spreadsheet → Devices tab model (#320): one row per non-curtain
 * placement of the option, in reading order, plus the column list, filters,
 * sort and cell-to-cell movement. Pure and client-safe (the grid-bom rule);
 * the table component only renders this. A later slice adds a device field
 * by adding a column to DEVICE_COLUMNS and a case to cellText/sortValue.
 */
import type { GridPlacement, GridSpace } from "@/lib/stores/grid-projects";
import { placementQty } from "./grid-bom";
import { spaceOf } from "./grid-geometry";
import { normalizeCategory } from "./grid-scopes";
import { cleanDesignator, formatDesignator, readingOrder } from "./designators";

export type DeviceRow = {
  id: string;
  /** Reading-order position — the default sort. */
  order: number;
  /** Stored designator ("" when none) — what an edit starts from. */
  designator: string;
  /** What the cell shows (a lot's range). */
  display: string;
  typeKey: string;
  typeLabel: string;
  model: string;
  desc: string;
  spaceId: string | null;
  space: string;
  sheetId: string;
  /** Sheet name, with "· p<n>" past page 1. */
  sheet: string;
  page: number;
  qty: number;
  category: string;
  duplicate: boolean;
};

export type DeviceColumnKey = "designator" | "type" | "model" | "desc" | "space" | "sheet" | "qty" | "category";
export type DeviceColumn = { key: DeviceColumnKey; label: string; width: number; editable?: boolean; mono?: boolean };
export type EditCol = "designator" | "category";

/** Width 0 = takes the rest of the row. */
export const DEVICE_COLUMNS: readonly DeviceColumn[] = [
  { key: "designator", label: "Designator", width: 120, editable: true, mono: true },
  { key: "type", label: "Type", width: 140 },
  { key: "model", label: "Model", width: 130, mono: true },
  { key: "desc", label: "Description", width: 0 },
  { key: "space", label: "Space", width: 120 },
  { key: "sheet", label: "Sheet", width: 120 },
  { key: "qty", label: "Qty", width: 52 },
  { key: "category", label: "Category", width: 130, editable: true },
];

export const NO_SPACE = "__none";
export type DeviceFilter = { type?: string; space?: string; sheet?: string };
export type DeviceSort = { key: DeviceColumnKey; dir: 1 | -1 } | null;

export type DeviceRowInput = {
  placements: readonly GridPlacement[];
  /** In sheet order. */
  sheets: ReadonlyArray<{ id: string; name: string }>;
  spaces: readonly GridSpace[];
  typeKeyOf: (pl: GridPlacement) => string;
  typeLabelOf: (key: string) => string;
  modelOf: (pl: GridPlacement) => string;
  descOf: (pl: GridPlacement) => string;
  duplicates: ReadonlySet<string>;
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function deviceRows(i: DeviceRowInput): DeviceRow[] {
  const sheetName = new Map(i.sheets.map((s) => [s.id, s.name]));
  const spaces = [...i.spaces];
  const devices = i.placements.filter((pl) => !pl.curtain);
  return readingOrder(devices, { sheetIds: i.sheets.map((s) => s.id), spaces }).map((pl, order) => {
    const home = spaceOf(pl, spaces);
    const typeKey = i.typeKeyOf(pl);
    const qty = placementQty(pl);
    const designator = cleanDesignator(pl.designator) ?? "";
    const name = sheetName.get(pl.sheetId) ?? "—";
    return {
      id: pl.id,
      order,
      designator,
      display: formatDesignator(designator, qty),
      typeKey,
      typeLabel: i.typeLabelOf(typeKey),
      model: i.modelOf(pl),
      desc: i.descOf(pl),
      spaceId: home?.id ?? null,
      space: home?.name ?? "—",
      sheetId: pl.sheetId,
      sheet: pl.page > 1 ? `${name} · p${pl.page}` : name,
      page: pl.page,
      qty,
      category: normalizeCategory(pl.category) ?? "",
      duplicate: i.duplicates.has(pl.id),
    };
  });
}

export function filterDeviceRows(rows: readonly DeviceRow[], f: DeviceFilter): DeviceRow[] {
  return rows.filter(
    (r) =>
      (!f.type || r.typeKey === f.type) &&
      (!f.space || (f.space === NO_SPACE ? r.spaceId === null : r.spaceId === f.space)) &&
      (!f.sheet || r.sheetId === f.sheet)
  );
}

export function sortValue(r: DeviceRow, key: DeviceColumnKey): string | number {
  switch (key) {
    case "designator":
      return r.designator;
    case "type":
      return r.typeLabel;
    case "model":
      return r.model;
    case "desc":
      return r.desc;
    case "space":
      return r.space;
    case "sheet":
      return r.sheet;
    case "qty":
      return r.qty;
    case "category":
      return r.category;
  }
}

/** null = reading order. Ties keep reading order. */
export function sortDeviceRows(rows: readonly DeviceRow[], sort: DeviceSort): DeviceRow[] {
  const out = [...rows];
  if (!sort) return out.sort((a, b) => a.order - b.order);
  return out.sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    const c = typeof x === "number" && typeof y === "number" ? x - y : byText(String(x), String(y));
    return c * sort.dir || a.order - b.order;
  });
}

export function cellText(r: DeviceRow, key: DeviceColumnKey): string {
  if (key === "designator") return r.display;
  if (key === "qty") return String(r.qty);
  return String(sortValue(r, key));
}

/** Where an edit goes next: down / up stay in the column; right goes
 *  Designator → Category → the next row's Designator; left the reverse. */
export function nextCell(rows: readonly DeviceRow[], id: string, col: EditCol, move: "down" | "up" | "right" | "left"): { id: string; col: EditCol } | null {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  if (move === "down") return i + 1 < rows.length ? { id: rows[i + 1].id, col } : null;
  if (move === "up") return i > 0 ? { id: rows[i - 1].id, col } : null;
  if (move === "right") return col === "designator" ? { id, col: "category" } : i + 1 < rows.length ? { id: rows[i + 1].id, col: "designator" } : null;
  return col === "category" ? { id, col: "designator" } : i > 0 ? { id: rows[i - 1].id, col: "category" } : null;
}
```

- [ ] **Step 4: Write `src/app/(app)/design/grid/[id]/workspace/devices-table.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { normalizeCategory } from "@/lib/design/grid-scopes";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { effectiveTypeCode, typeLabel } from "@/lib/design/device-types";
import { cleanDesignator, DESIGNATOR_DUPLICATE_COLOR, DESIGNATOR_MAX, type RenumberTarget } from "@/lib/design/designators";
import {
  DEVICE_COLUMNS,
  NO_SPACE,
  cellText,
  deviceRows,
  filterDeviceRows,
  nextCell,
  sortDeviceRows,
  type DeviceColumnKey,
  type DeviceFilter,
  type DeviceRow,
  type DeviceSort,
  type EditCol,
} from "@/lib/design/grid-device-rows";
import Menu from "./menu";
import type { GridEditor } from "../use-grid-editor";

/**
 * Spreadsheet → Devices (#320): one row per device on the active option
 * (curtains keep their names and stay off it), in reading order.
 * Designator and Category edit in place: click the cell, then Enter / Tab
 * save and move down / right (Shift goes back); Esc — or clicking away —
 * discards. Filters by type, space and sheet; a header click sorts (again
 * reverses, a third time returns to reading order). A row click selects the
 * device and shows its sheet on the plan (Shift / ⌘ adds to the selection).
 * The columns come from DEVICE_COLUMNS, so a later slice adds a field there.
 */

const CTRL: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};
const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#8c919c",
  borderBottom: "1.5px solid #1a1a1a",
  padding: "4px 8px 5px 0",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "4px 8px 4px 0",
  borderBottom: "1px solid #eceef2",
  fontSize: 12.5,
  verticalAlign: "middle",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const CELL_BTN: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  margin: 0,
  width: "100%",
  textAlign: "left",
  font: "inherit",
  color: "inherit",
  cursor: "text",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

type Editing = { id: string; col: EditCol; draft: string };

export default function DevicesTable({ ed }: { ed: GridEditor }) {
  const {
    placements,
    sheets,
    project,
    partById,
    deviceTypes,
    typeKeyOfPlacement,
    designatorDupes,
    selectedIds,
    busy,
    categoryCounts,
    saveDesignators,
    saveCategory,
    renumberDesignators,
    focusPlacements,
  } = ed;
  const rows = useMemo(
    () =>
      deviceRows({
        placements,
        sheets,
        spaces: project.spaces,
        typeKeyOf: typeKeyOfPlacement,
        typeLabelOf: (key) => typeLabel(key, deviceTypes),
        modelOf: (pl) => {
          const part = partById.get(pl.partId);
          return part?.virtual ? "" : part?.modelNumber || part?.sku || "";
        },
        descOf: (pl) =>
          isSeedPlaceholder(pl.partId) ? pl.category || "Unassigned device" : partById.get(pl.partId)?.desc || "No longer in the catalog",
        duplicates: designatorDupes,
      }),
    [placements, sheets, project.spaces, typeKeyOfPlacement, deviceTypes, partById, designatorDupes]
  );
  const [filter, setFilter] = useState<DeviceFilter>({});
  const [sort, setSort] = useState<DeviceSort>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const shown = useMemo(() => sortDeviceRows(filterDeviceRows(rows, filter), sort), [rows, filter, sort]);
  const selected = new Set(selectedIds);
  const pickedIds = shown.filter((r) => selected.has(r.id)).map((r) => r.id);

  const typeChoices = [...new Map(rows.map((r) => [r.typeKey, r.typeLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const spaceChoices = [...new Map(rows.flatMap((r) => (r.spaceId ? [[r.spaceId, r.space] as const] : []))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const anyLoose = rows.some((r) => r.spaceId === null);
  const sheetChoices = sheets.filter((s) => rows.some((r) => r.sheetId === s.id));
  const filterType = filter.type ? deviceTypes.find((t) => t.key === filter.type) : undefined;
  const filterCode = filterType ? effectiveTypeCode(filterType) : null;

  const open = (r: DeviceRow, col: EditCol) => setEditing({ id: r.id, col, draft: col === "designator" ? r.designator : r.category });
  const commit = async (move: "down" | "up" | "right" | "left") => {
    const cur = editing;
    if (!cur) return;
    const row = rows.find((r) => r.id === cur.id);
    if (row) {
      if (cur.col === "designator") {
        // A refused save keeps the cell open with what was typed; the status line says why.
        if ((cleanDesignator(cur.draft) ?? "") !== row.designator && !(await saveDesignators([{ id: row.id, designator: cur.draft }]))) return;
      } else if ((normalizeCategory(cur.draft) ?? "") !== row.category) {
        await saveCategory(row.id, cur.draft);
      }
    }
    const next = nextCell(shown, cur.id, cur.col, move);
    const nextRow = next ? shown.find((r) => r.id === next.id) : undefined;
    if (next && nextRow) open(nextRow, next.col);
    else setEditing(null);
  };
  const pick = (r: DeviceRow, additive: boolean) => {
    const ids = additive ? (selected.has(r.id) ? selectedIds.filter((x) => x !== r.id) : [...selectedIds, r.id]) : [r.id];
    focusPlacements(ids, r.id);
  };
  const renumber = (target: RenumberTarget, what: string) => void renumberDesignators(target, what);
  const sortBy = (key: DeviceColumnKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div data-no-nudge>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <select aria-label="Filter by type" value={filter.type ?? ""} onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value || undefined }))} style={CTRL}>
          <option value="">All types</option>
          {typeChoices.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by space" value={filter.space ?? ""} onChange={(e) => setFilter((f) => ({ ...f, space: e.target.value || undefined }))} style={CTRL}>
          <option value="">All spaces</option>
          {spaceChoices.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          {anyLoose && <option value={NO_SPACE}>No space</option>}
        </select>
        <select aria-label="Filter by sheet" value={filter.sheet ?? ""} onChange={(e) => setFilter((f) => ({ ...f, sheet: e.target.value || undefined }))} style={CTRL}>
          <option value="">All sheets</option>
          {sheetChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "#8c919c" }}>
          {shown.length === rows.length ? `${rows.length} device${rows.length === 1 ? "" : "s"}` : `${shown.length} of ${rows.length} devices`}
          {" · click a Designator or Category to edit; Enter / Tab save"}
        </span>
        <span style={{ flex: 1 }} />
        <Menu
          label="Renumber…"
          align="right"
          disabled={busy || rows.length === 0}
          title="Close the gaps — devices take numbers from 1 in reading order"
          items={[
            { label: "All devices", onSelect: () => renumber({ all: true }, "all devices") },
            {
              label: filterType && filterCode ? `${filterType.label} (${filterCode})` : "This type — pick a type filter first",
              disabled: !filterCode,
              onSelect: () => {
                if (filterType && filterCode) renumber({ code: filterCode }, filterType.label);
              },
            },
            { label: `Selected rows (${pickedIds.length})`, disabled: pickedIds.length === 0, onSelect: () => renumber({ ids: pickedIds }, "the selected rows") },
          ]}
        />
      </div>
      <datalist id="grid-devices-category-suggestions">
        {categoryCounts.map((c) => (
          <option key={c.key} value={c.key} />
        ))}
      </datalist>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8c919c", padding: "18px 0" }}>No devices on this option yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {DEVICE_COLUMNS.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {DEVICE_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  style={TH}
                  onClick={() => sortBy(c.key)}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={(e) => pick(r, e.shiftKey || e.metaKey || e.ctrlKey)}
                style={{ background: selected.has(r.id) ? "#eef2fb" : undefined, cursor: "pointer" }}
              >
                {DEVICE_COLUMNS.map((c) => {
                  const col: EditCol | null = c.key === "designator" || c.key === "category" ? c.key : null;
                  const cell = col && editing && editing.id === r.id && editing.col === col ? editing : null;
                  const dupe = c.key === "designator" && r.duplicate;
                  return (
                    <td
                      key={c.key}
                      title={dupe ? "Another device uses this designator" : cellText(r, c.key)}
                      style={{
                        ...TD,
                        ...(c.mono ? { fontFamily: "var(--font-mono)", fontSize: 11.5 } : {}),
                        ...(dupe ? { color: DESIGNATOR_DUPLICATE_COLOR, fontWeight: 700, background: "#fdf4e3" } : {}),
                      }}
                    >
                      {cell && col ? (
                        <input
                          autoFocus
                          value={cell.draft}
                          maxLength={col === "designator" ? DESIGNATOR_MAX : 40}
                          list={col === "category" ? "grid-devices-category-suggestions" : undefined}
                          aria-label={col === "designator" ? `Designator for ${r.desc}` : `Category for ${r.desc}`}
                          placeholder={col === "designator" ? "Blank = next free" : ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditing({ ...cell, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              if (!busy) void commit(e.shiftKey ? "up" : "down");
                            } else if (e.key === "Tab") {
                              e.preventDefault();
                              if (!busy) void commit(e.shiftKey ? "left" : "right");
                            }
                          }}
                          style={{ ...CTRL, width: "100%", padding: "2px 6px", fontFamily: col === "designator" ? "var(--font-mono)" : "inherit" }}
                        />
                      ) : col ? (
                        <button
                          type="button"
                          style={CELL_BTN}
                          onClick={(e) => {
                            e.stopPropagation();
                            open(r, col);
                          }}
                        >
                          {cellText(r, c.key) || <span style={{ color: "#b6bac3" }}>—</span>}
                        </button>
                      ) : (
                        cellText(r, c.key)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `src/app/(app)/design/grid/[id]/workspace/spreadsheet-view.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import ScheduleTable from "../schedule/schedule-table";
import DevicesTable from "./devices-table";
import type { GridEditor } from "../use-grid-editor";

/**
 * Spreadsheet view (#299) — the center pane's second tab. #320: two tabs —
 * Devices (default): one editable row per device; Schedule: the active
 * option's equipment schedule, the same tables the printable /schedule page
 * shows (one ScheduleTable, one server-built `schedule` from
 * scheduleForOption), now with a Designators column. Every edit's
 * router.refresh() rebuilds both.
 */
type Tab = "devices" | "schedule";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "devices", label: "Devices" },
  { key: "schedule", label: "Schedule" },
];

export default function SpreadsheetView({ ed }: { ed: GridEditor }) {
  const { project, activeOptionId, activeOption, schedule } = ed;
  const [tab, setTab] = useState<Tab>("devices");
  const href = `/design/grid/${encodeURIComponent(project.id)}/schedule?option=${encodeURIComponent(activeOptionId)}`;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#6d7076", padding: 18 }}>
      <div
        style={{
          maxWidth: tab === "devices" ? 1240 : 960,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 8,
          padding: "16px 22px 22px",
          color: "#1a1a1a",
          boxShadow: "0 1px 3px rgba(0,0,0,.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div role="tablist" aria-label="Spreadsheet" style={{ display: "inline-flex", gap: 2, background: "#f0f1f4", borderRadius: 8, padding: 2 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                style={{
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  background: tab === t.key ? "#fff" : "transparent",
                  color: tab === t.key ? "#16181d" : "#5b616e",
                  boxShadow: tab === t.key ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {project.options.length > 1 && <span style={{ fontSize: 12.5, color: "#8c919c" }}>{activeOption.name}</span>}
          <span style={{ flex: 1 }} />
          {tab === "schedule" && (
            <Link href={href} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
              Open printable schedule →
            </Link>
          )}
        </div>
        {tab === "devices" ? (
          <DevicesTable ed={ed} />
        ) : schedule ? (
          <ScheduleTable schedule={schedule} accent="var(--accent)" />
        ) : (
          <div style={{ fontSize: 13, color: "#8c919c", padding: "18px 0" }}>
            The schedule couldn&apos;t be built — open the printable schedule to see the error.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#320|#299 spreadsheet|FAIL|ALL PASSED|FAILED" | tail -40`
Expected: every `#320` line `PASS`; `ALL PASSED`.

- [ ] **Step 7: Typecheck, lint, build**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5
npx eslint src/lib/design/grid-device-rows.ts "src/app/(app)/design/grid/[id]/workspace/devices-table.tsx" "src/app/(app)/design/grid/[id]/workspace/spreadsheet-view.tsx"
npm run build 2>&1 | tail -15
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/grid-device-rows.ts "src/app/(app)/design/grid/[id]/workspace/devices-table.tsx" "src/app/(app)/design/grid/[id]/workspace/spreadsheet-view.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #320 Spreadsheet Devices tab — inline designators, filters, sort, renumber

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Schedules + drawing set

**Files:**
- Modify: `src/lib/design/designators.ts` (add `planDesignatorMarks`), `src/lib/design/grid-schedule.ts`, `src/lib/design/grid-schedule-server.ts`, `src/lib/design/drawing-set-data.ts`, `src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx`, `src/components/drawing/drawing-set-sheets.tsx`, `src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx`
- Test: `scripts/test-review-and-spec.ts` (new `designators320ScheduleChecks` + chain line; the `#211 fix1 I3` pin at ~line 19236 updated)

**Interfaces:**
- Consumes: Task 1 (`designatorList`, `formatDesignator`, `fillDesignators`, `designatorCodeOf`, `readingCtxOf`), `assignTypeMarks` (drawing-labels).
- Produces: `ScheduleRow.designators?: string`; `ScheduleItem` row `designators?: string`; `buildSchedule` input placements accept `designator?: string`; `planDesignatorMarks(items: ReadonlyArray<PlanMarkItem>, prefix: string): { tags: Map<string, string>; rows: Array<{ tag: string; qty: number; desc: string }> }` with `PlanMarkItem = { id: string; key: string; desc: string; qty: number; designator?: string; curtain: boolean }`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #320: designators on schedules and the drawing set ---------------- */
async function designators320ScheduleChecks(): Promise<void> {
  const S = await import("@/lib/design/grid-schedule");
  const D = await import("@/lib/design/designators");
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pl = (id: string, partId: string, x: number, extra: Record<string, unknown> = {}) => ({ id, sheetId: "s", page: 1, x, y: 0.5, partId, ...extra });
  const sch = S.buildSchedule({
    placements: [pl("a", "MIC", 0.1, { designator: "MIC-1" }), pl("b", "MIC", 0.2, { designator: "MIC-2" }), pl("c", "MIC", 0.3, { designator: "MIC-4" }),
      pl("d", "PIPE", 0.4, { designator: "TR-1", qty: 24 }), pl("e", "MIC", 0.5)],
    spaces: [],
    descOf: () => "x",
    wires: [],
  });
  const rows = sch.sections[0].rows;
  ok(rows.find((r) => r.partId === "MIC")!.designators === "MIC-1–2, MIC-4" && rows.find((r) => r.partId === "PIPE")!.designators === "TR-1–24" && rows.find((r) => r.partId === "MIC")!.qty === 4,
    "#320 schedule: each part row lists its designators (ranges merged); a device without one still counts");
  ok(S.scheduleGroups(sch)[0].rows.some((r) => r.kind === "row" && r.designators === "MIC-1–2, MIC-4"), "#320 schedule: the E-60x items carry the Designators cell");
  ok(JSON.stringify(S.buildSchedule({ placements: [pl("z", "P", 0.1)], spaces: [], descOf: () => "x", wires: [] }).sections[0].rows[0]) === JSON.stringify({ partId: "P", desc: "x", qty: 1 }),
    "#320 schedule: a row with no designators carries no key (older readers unchanged)");

  const marks = D.planDesignatorMarks(
    [
      { id: "a", key: "P1", desc: "Spot", qty: 1, designator: "LX-1", curtain: false },
      { id: "b", key: "P1", desc: "Spot", qty: 1, designator: "LX-2", curtain: false },
      { id: "c", key: "curtain:Main", desc: "Main", qty: 1, curtain: true },
      { id: "d", key: "P2", desc: "Pipe", qty: 24, designator: "TR-1", curtain: false },
    ],
    "R"
  );
  ok(marks.tags.get("a") === "LX-1" && marks.tags.get("b") === "LX-2" && marks.tags.get("c") === "R1" && marks.tags.get("d") === "TR-1–24",
    "#320 plan sheet: each symbol prints its designator (a lot by its range); a curtain keeps its type mark");
  ok(JSON.stringify(marks.rows) === JSON.stringify([{ tag: "LX-1–2", qty: 2, desc: "Spot" }, { tag: "R1", qty: 1, desc: "Main" }, { tag: "TR-1–24", qty: 24, desc: "Pipe" }]),
    "#320 plan sheet: the device key is one row per part — designators · qty · description");

  const sheets = rd("src/components/drawing/drawing-set-sheets.tsx");
  ok(sheets.includes("planDesignatorMarks(") && !sheets.includes("assignTypeMarks(") && sheets.includes("colSpan={4}") && sheets.includes("it.designators"),
    "#320 drawing set: plan sheets print designators; E-60x gains a Designators column");
  ok(rd("src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx").includes("<th>Designators</th>"), "#320 drawing set: the device key's first column is Designators");
  const table = rd("src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx");
  ok(table.includes(">Designators</th>") && table.includes("r.designators"), "#320 /schedule + Spreadsheet Schedule tab: Designators column");
  ok(rd("src/lib/design/grid-schedule-server.ts").includes("fillDesignators(slice.placements, designatorCodeOf(partById, deviceTypes), readingCtxOf(project))") &&
     rd("src/lib/design/drawing-set-data.ts").includes("fillDesignators(rawSlice.placements, designatorCodeOf(partById, deviceTypes), readingCtxOf(project))"),
    "#320 schedule + set fill missing designators in memory (never a write on a print path)");
  const gs = rd("src/lib/design/grid-schedule.ts");
  ok(!/from\s+"@\/lib\/stores\//.test(gs.replace(/import type[^;]*;/g, "")) && !rd("src/lib/design/designators.ts").includes("@/lib/stores/") && !rd("src/lib/design/designators.ts").includes("@/db"),
    "#320 client boundary: designators.ts and grid-schedule.ts import no store or DB");
}
```

Chain it after the Task 4 line:

```ts
  .then(() => designators320ScheduleChecks())
```

Update the `#211 fix1 I3` pin (~line 19236). Change

```ts
  ok(set7.includes("qty: f.qty") && set7.includes("`${desc} ×${qty}`") && set7.includes("`${tag} ×${qty}`"), "#211 fix1 I3: the plan sheet carries lot qty into the key and labels the symbol ×N");
```

to

```ts
  ok(set7.includes("qty: f.qty") && set7.includes("`${desc} ×${qty}`") && set7.includes("planDesignatorMarks("), "#211 fix1 I3: the plan sheet carries lot qty into the key; #320: the symbol prints its designator range instead of ×N");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#320 (schedule|plan sheet|drawing|client)|#211 fix1 I3" | head`
Expected: `FAIL` lines (or `D.planDesignatorMarks is not a function`).

- [ ] **Step 3: Add `planDesignatorMarks` to `src/lib/design/designators.ts`**

Add to the imports at the top:

```ts
import { assignTypeMarks } from "./drawing-labels";
```

Append at the end of the file:

```ts
/* ------------------------------ drawing set ------------------------------ */

export type PlanMarkItem = { id: string; key: string; desc: string; qty: number; designator?: string; curtain: boolean };

/**
 * A plan sheet's marks (#320): each device prints its designator (a lot by
 * its range) where the type mark sat; a curtain keeps its per-sheet type
 * mark (assignTypeMarks, the system-letter prefix). The device key is one
 * row per part (per named curtain), first-seen order: designators
 * (designatorList) · units · description. Tags are keyed by placement id.
 */
export function planDesignatorMarks(items: ReadonlyArray<PlanMarkItem>, prefix: string): { tags: Map<string, string>; rows: Array<{ tag: string; qty: number; desc: string }> } {
  const curtainMarks = assignTypeMarks(items.filter((it) => it.curtain).map((it) => ({ key: it.key, desc: it.desc, qty: it.qty })), prefix);
  const tags = new Map<string, string>();
  const order: string[] = [];
  const groups = new Map<string, { curtain: boolean; desc: string; qty: number; list: Array<{ designator?: string; qty: number }> }>();
  for (const it of items) {
    tags.set(it.id, it.curtain ? curtainMarks.tags.get(it.key) || "" : formatDesignator(it.designator, it.qty));
    let g = groups.get(it.key);
    if (!g) {
      g = { curtain: it.curtain, desc: it.desc, qty: 0, list: [] };
      groups.set(it.key, g);
      order.push(it.key);
    }
    g.qty += it.qty;
    g.list.push({ designator: it.designator, qty: it.qty });
  }
  const rows = order.map((key) => {
    const g = groups.get(key)!;
    return { tag: g.curtain ? curtainMarks.tags.get(key) || "" : designatorList(g.list), qty: g.qty, desc: g.desc };
  });
  return { tags, rows };
}
```

- [ ] **Step 4: Designators in `src/lib/design/grid-schedule.ts`**

After `import { partModel } from "@/lib/catalog-rename/sku";` add:

```ts
import { designatorList } from "./designators";
```

Replace

```ts
export type ScheduleRow = { partId: string; code?: string; model?: string; desc: string; qty: number };
```

with

```ts
/** `designators` (#320): the row's devices' designators (designatorList); absent when none. */
export type ScheduleRow = { partId: string; code?: string; model?: string; desc: string; qty: number; designators?: string };
```

In `buildSchedule`'s input type, replace

```ts
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; curtain?: GridCurtain | null; qty?: number }>;
```

with

```ts
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; curtain?: GridCurtain | null; qty?: number; designator?: string }>;
```

Replace

```ts
  const bySpace = new Map<string | null, ScheduleRow[]>();
  for (const pl of input.placements) {
    const home = spaceOf(pl, input.spaces);
    const key = home ? home.id : null;
    const rows = bySpace.get(key) || [];
    if (pl.curtain) {
      rows.push({ partId: pl.id, code: "CURTAIN", desc: curtainDesc(pl.curtain, input.descOf(pl.curtain.fabricSku)), qty: 1 });
    } else {
      const row = rows.find((r) => r.partId === pl.partId && !r.code);
      if (row) row.qty += placementQty(pl);
      else {
        const m = modelFor(pl.partId);
        rows.push({ partId: pl.partId, ...(m ? { model: m } : {}), desc: input.descOf(pl.partId) || "(no longer in the catalog)", qty: placementQty(pl) });
      }
    }
    bySpace.set(key, rows);
  }
```

with

```ts
  const bySpace = new Map<string | null, ScheduleRow[]>();
  const held = new Map<ScheduleRow, Array<{ designator?: string; qty?: number }>>();
  for (const pl of input.placements) {
    const home = spaceOf(pl, input.spaces);
    const key = home ? home.id : null;
    const rows = bySpace.get(key) || [];
    if (pl.curtain) {
      rows.push({ partId: pl.id, code: "CURTAIN", desc: curtainDesc(pl.curtain, input.descOf(pl.curtain.fabricSku)), qty: 1 });
    } else {
      const row = rows.find((r) => r.partId === pl.partId && !r.code);
      if (row) {
        row.qty += placementQty(pl);
        held.get(row)!.push(pl);
      } else {
        const m = modelFor(pl.partId);
        const fresh: ScheduleRow = { partId: pl.partId, ...(m ? { model: m } : {}), desc: input.descOf(pl.partId) || "(no longer in the catalog)", qty: placementQty(pl) };
        rows.push(fresh);
        held.set(fresh, [pl]);
      }
    }
    bySpace.set(key, rows);
  }
  // #320: each part row lists its devices' designators.
  for (const [row, list] of held) {
    const d = designatorList(list);
    if (d) row.designators = d;
  }
```

Replace

```ts
  | { kind: "row"; qty: number; code: string; desc: string }
```

with

```ts
  | { kind: "row"; qty: number; code: string; desc: string; designators?: string }
```

and in `scheduleGroups` replace

```ts
    rows: s.rows.map((r) => ({ kind: "row" as const, qty: r.qty, code: r.code || r.model || r.partId, desc: r.desc })),
```

with

```ts
    rows: s.rows.map((r) => ({ kind: "row" as const, qty: r.qty, code: r.code || r.model || r.partId, desc: r.desc, ...(r.designators ? { designators: r.designators } : {}) })),
```

- [ ] **Step 5: Fill in memory — `grid-schedule-server.ts` and `drawing-set-data.ts`**

In `src/lib/design/grid-schedule-server.ts`, after the `import { buildSchedule, … } from "@/lib/design/grid-schedule";` line add:

```ts
import { designatorCodeOf, fillDesignators, readingCtxOf } from "@/lib/design/designators";
```

and replace

```ts
  const partById = new Map(parts.map((p) => [p.id, p]));
  const spaces = project.spaces || [];
  const view = riserViewForOption({ project, optionId, parts, symCtx: symbolContext(settings, deviceTypes.types) });
  return buildSchedule({
    placements: slice.placements,
```

with

```ts
  const partById = new Map(parts.map((p) => [p.id, p]));
  const spaces = project.spaces || [];
  // #320: a device not yet numbered (a design the editor hasn't opened since)
  // lists the number the editor will give it — computed here, never written.
  const placements = fillDesignators(slice.placements, designatorCodeOf(partById, deviceTypes), readingCtxOf(project));
  const view = riserViewForOption({ project, optionId, parts, symCtx: symbolContext(settings, deviceTypes.types) });
  return buildSchedule({
    placements,
```

In `src/lib/design/drawing-set-data.ts`, after `import { partDocumentUrl, type ObjectSymbolUrls } from "@/lib/design/object-symbols";` add:

```ts
import { designatorCodeOf, fillDesignators, readingCtxOf } from "@/lib/design/designators";
```

Replace

```ts
  const slice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
```

with

```ts
  const rawSlice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
```

and replace

```ts
  const partById = new Map(parts.map((p) => [p.id, p]));
  const set = project.drawingSet || {};
```

with

```ts
  const partById = new Map(parts.map((p) => [p.id, p]));
  // #320: plan marks, keys and E-60x read designators; one not yet assigned
  // prints the number the editor will give it (filled here, never written —
  // this also serves the signed print route).
  const slice = { ...rawSlice, placements: fillDesignators(rawSlice.placements, designatorCodeOf(partById, deviceTypes), readingCtxOf(project)) };
  const set = project.drawingSet || {};
```

- [ ] **Step 6: The tables**

In `src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx`, update the doc comment's first table description from `(Qty · Part · Description)` to `(Qty · Designators · Model · Description)`, then replace

```tsx
                <th style={{ ...th, width: 54 }}>Qty</th>
                <th style={{ ...th, width: 150 }}>Model</th>
```

with

```tsx
                <th style={{ ...th, width: 54 }}>Qty</th>
                <th style={{ ...th, width: 140 }}>Designators</th>
                <th style={{ ...th, width: 150 }}>Model</th>
```

and

```tsx
                  <td style={td}>{r.qty}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.code || r.model || r.partId}</td>
```

with

```tsx
                  <td style={td}>{r.qty}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.designators || ""}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.code || r.model || r.partId}</td>
```

In `src/components/drawing/drawing-set-sheets.tsx`, replace `import { assignTypeMarks } from "@/lib/design/drawing-labels";` with:

```ts
import { planDesignatorMarks } from "@/lib/design/designators";
```

Replace the whole of `function scheduleRow(it: ScheduleItem, key: number) {` (through its closing `}`) with:

```tsx
function scheduleRow(it: ScheduleItem, key: number) {
  if (it.kind === "section")
    return (
      <tr key={key}>
        <td colSpan={4} className="pk-dw-sec">{`${it.name}${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "wires")
    return (
      <tr key={key}>
        <td colSpan={4} className="pk-dw-sec">{`Wire runs${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "row")
    return (
      <tr key={key}>
        <td>{it.qty}</td>
        <td className="pk-dw-mono pk-dw-ellip">{it.designators || ""}</td>
        <td className="pk-dw-mono pk-dw-ellip">{it.code}</td>
        <td className="pk-dw-ellip">{it.desc}</td>
      </tr>
    );
  return (
    <tr key={key}>
      <td className="pk-dw-ellip">{it.length}</td>
      <td />
      <td className="pk-dw-mono pk-dw-ellip">{it.model || it.partId}</td>
      <td className="pk-dw-ellip">{it.run}</td>
    </tr>
  );
}
```

In `figPlacement`, replace

```ts
  const figPlacement = (pl: GridPlacement): { fig: FigurePlacement; desc: string; qty: number } => {
```

with

```ts
  const figPlacement = (pl: GridPlacement): { fig: FigurePlacement; desc: string; qty: number; designator?: string } => {
```

and

```ts
    return { fig, desc, qty };
  };
```

with

```ts
    return { fig, desc, qty, designator: pl.curtain ? undefined : pl.designator };
  };
```

In the plan-sheet branch of `body`, replace

```tsx
      const figs = c.placements.map(figPlacement);
      const marks = assignTypeMarks(
        figs.map((f) => ({ key: f.fig.key, desc: f.desc, qty: f.qty })),
        DRAWING_SYSTEMS.find((s) => s.key === d.system)?.prefix || ""
      );
```

with

```tsx
      const figs = c.placements.map(figPlacement);
      // #320: each device prints its designator where the type mark sat (a lot
      // by its range); a curtain keeps its type mark. Key = designators · qty · desc.
      const marks = planDesignatorMarks(
        figs.map((f) => ({ id: f.fig.id, key: f.fig.key, desc: f.desc, qty: f.qty, designator: f.designator, curtain: f.fig.curtain })),
        DRAWING_SYSTEMS.find((s) => s.key === d.system)?.prefix || ""
      );
```

and replace

```tsx
          placements={figs.map(({ fig, qty }) => {
            // The printed mark carries the lot count too (L3 ×240) — the
            // collision pass sizes the mark from this text.
            const tag = marks.tags.get(fig.key) || "";
            return { ...fig, tag: tag && qty > 1 ? `${tag} ×${qty}` : tag };
          })}
          keyRows={marks.rows.map((r) => ({ tag: r.tag, qty: r.qty, desc: r.desc }))}
```

with

```tsx
          // The collision pass sizes each mark from this text.
          placements={figs.map(({ fig }) => ({ ...fig, tag: marks.tags.get(fig.id) || "" }))}
          keyRows={marks.rows}
```

Replace the E-60x table's colgroup

```tsx
                <colgroup>
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "27%" }} />
                  <col />
                </colgroup>
```

with

```tsx
                <colgroup>
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "22%" }} />
                  <col />
                </colgroup>
```

In `src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx`, update `FigurePlacement.tag`'s comment to `/** Printed beside the symbol — the device's designator (#320), or a curtain's type mark. */`, then replace

```tsx
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "16%" }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Tag</th>
            <th>Qty</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {keyRows.slice(0, KEY_MAX_ROWS).map((r) => (
            <tr key={r.tag}>
              <td className="pk-dw-mono">{r.tag}</td>
```

with

```tsx
        <colgroup>
          <col style={{ width: "38%" }} />
          <col style={{ width: "12%" }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Designators</th>
            <th>Qty</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {keyRows.slice(0, KEY_MAX_ROWS).map((r, i) => (
            <tr key={i}>
              <td className="pk-dw-mono pk-dw-ellip">{r.tag}</td>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#320|#209|#211 fix1|#304 grid|FAIL|ALL PASSED|FAILED" | tail -60`
Expected: every `#320`, `#209`, `#211 fix1` and `#304 grid schedule` line `PASS`; `ALL PASSED`.

- [ ] **Step 8: Typecheck, lint, build**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5
npx eslint src/lib/design/designators.ts src/lib/design/grid-schedule.ts src/lib/design/grid-schedule-server.ts src/lib/design/drawing-set-data.ts "src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx" src/components/drawing/drawing-set-sheets.tsx "src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx"
npm run build 2>&1 | tail -15
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/design/designators.ts src/lib/design/grid-schedule.ts src/lib/design/grid-schedule-server.ts src/lib/design/drawing-set-data.ts "src/app/(app)/design/grid/[id]/schedule/schedule-table.tsx" src/components/drawing/drawing-set-sheets.tsx "src/app/(app)/design/grid/[id]/set/plan-sheet-figure.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #320 designators on schedules, E-60x and plan sheets (replace type marks)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Catalog → Device types — the Code column

**Files:**
- Modify: `src/app/(app)/catalog/device-types/device-types-client.tsx`
- Test: `scripts/test-review-and-spec.ts` (new `designators320TypeCodePins` + chain line)

**Interfaces:**
- Consumes: `effectiveTypeCode` (Task 1, pure — the client may import it); `saveDeviceTypesAction` already sends the whole draft list to `cleanDeviceTypesInput`, which validates `code` (Task 1).
- Produces: the admin UI only.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #320: Catalog → Device types code column ---------------- */
async function designators320TypeCodePins(): Promise<void> {
  const client = readFileSync(join(process.cwd(), "src/app/(app)/catalog/device-types/device-types-client.tsx"), "utf8");
  ok(client.includes("code: t.code ?? \"\"") && client.includes("placeholder={effectiveTypeCode({ key: d.key ?? \"\", label: d.label })}") &&
     client.includes("aria-label={`Code for ${d.label}`}") && client.includes(".toUpperCase().replace(/[^A-Z0-9]/g, \"\").slice(0, 6)"),
    "#320 Device types: an editable Code per type, uppercased as typed, showing the effective default as its placeholder");
  ok(client.includes("{ label, scope: newScope, code: \"\" }") && client.includes("designator prefix"), "#320 Device types: new types start on the default code; the card says what the code is for");
}
```

Chain it after the Task 5 line:

```ts
  .then(() => designators320TypeCodePins())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep "#320 Device types"`
Expected: two `FAIL` lines.

- [ ] **Step 3: Edit `src/app/(app)/catalog/device-types/device-types-client.tsx`**

Replace `import type { DeviceType, TypeReviewRow } from "@/lib/design/device-types";` with:

```ts
import { effectiveTypeCode, type DeviceType, type TypeReviewRow } from "@/lib/design/device-types";
```

Replace

```ts
type Draft = { key?: string; label: string; scope: GridLayer; archived?: boolean };
```

with

```ts
/** `code` (#320): "" = use the default (effectiveTypeCode). */
type Draft = { key?: string; label: string; scope: GridLayer; code: string; archived?: boolean };
```

Replace

```ts
const TYPE_GRID = "56px minmax(0, 1fr) 150px 90px 80px";
```

with

```ts
const TYPE_GRID = "56px minmax(0, 1fr) 76px 150px 90px 80px";
```

Replace

```ts
  const initial = useMemo<Draft[]>(() => types.map((t) => ({ key: t.key, label: t.label, scope: t.scope, archived: !!t.archived })), [types]);
```

with

```ts
  const initial = useMemo<Draft[]>(() => types.map((t) => ({ key: t.key, label: t.label, scope: t.scope, code: t.code ?? "", archived: !!t.archived })), [types]);
```

Replace

```ts
    setDrafts((d) => [...d, { label, scope: newScope }]);
```

with

```ts
    setDrafts((d) => [...d, { label, scope: newScope, code: "" }]);
```

Replace

```tsx
              Rename, reorder, add or archive. An archived type maps nothing; its categories show as unmapped.
```

with

```tsx
              Rename, reorder, add or archive. An archived type maps nothing; its categories show as unmapped. Code is the
              designator prefix on Grid plans (MIC → MIC-1); leave it blank to use the default shown.
```

In the type rows, replace

```tsx
              <input value={d.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label="Type name" maxLength={40} style={INPUT} />
              <select value={d.scope} onChange={(e) => edit(i, { scope: e.target.value as GridLayer })} aria-label={`Scope for ${d.label}`} style={INPUT}>
```

with

```tsx
              <input value={d.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label="Type name" maxLength={40} style={INPUT} />
              <input
                value={d.code}
                onChange={(e) => edit(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })}
                placeholder={effectiveTypeCode({ key: d.key ?? "", label: d.label })}
                aria-label={`Code for ${d.label}`}
                title="Designator prefix (1–6 letters or digits) — blank uses the default shown"
                maxLength={6}
                style={{ ...INPUT, fontFamily: "var(--font-mono)" }}
              />
              <select value={d.scope} onChange={(e) => edit(i, { scope: e.target.value as GridLayer })} aria-label={`Scope for ${d.label}`} style={INPUT}>
```

In the "new type" row, replace

```tsx
              placeholder="New type, e.g. Fog & Haze"
              aria-label="New type name"
              maxLength={40}
              style={INPUT}
            />
            <select value={newScope}
```

with

```tsx
              placeholder="New type, e.g. Fog & Haze"
              aria-label="New type name"
              maxLength={40}
              style={INPUT}
            />
            <span />
            <select value={newScope}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#320|#226|FAIL|ALL PASSED|FAILED" | tail -40`
Expected: `#320 Device types` lines `PASS`; every `#226` line still `PASS`; `ALL PASSED`.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5
npx eslint "src/app/(app)/catalog/device-types/device-types-client.tsx"
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/catalog/device-types/device-types-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(catalog): #320 Device types — designator code per type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Docs and the full verification gates

**Files:**
- Modify: `DECISIONS.md` (append), `PUNCHLIST.md` (append), `AGENTS.md` (item 38)

**Interfaces:**
- Consumes: everything above. Produces: nothing new in code.

- [ ] **Step 1: Pick the decision and punch numbers — recompute right before writing**

Another session is concurrently adding #319 (D695+). Fetch and read `origin/main`, not this branch:

```bash
git fetch origin main
git show origin/main:DECISIONS.md | grep -n "^## D[0-9]" | tail -1     # this branch ends at D694; use the next four free numbers after origin/main's last
git show origin/main:PUNCHLIST.md | grep -n "^## [0-9]" | tail -3       # confirm 320 is still free
```

Call the four numbers **Da, Db, Dc, Dd** below (D695–D698 if `origin/main` still ends at D694). If `## 320` was taken, take the next free punch number and change every `#320` in the docs below (the code comments may keep `#320` only if the number held — otherwise update them in one follow-up commit).

- [ ] **Step 2: Append to `DECISIONS.md`** (replace Da–Dd with the real numbers)

```markdown

## Da. Grid device designators: the model (#320, 2026-10-09)

Jeff wanted short device labels on Grid plans that carry through to schedules and the riser. Every non-curtain
placement gets `GridPlacement.designator` — the device type's code + a number (`MIC-1`), numbered per code within one
design option (options number on their own; a copied option keeps the same designators). A lot of qty N reserves N
consecutive numbers and stores only its FIRST (`LX-1`, shown `LX-1–24`). A device keeps its designator for life;
delete leaves a gap and a new device takes the LOWEST free number for its code; Renumber… (all, one code, or a
selection) closes gaps in reading order — sheet order, page, space in project order (`spaceOf`, no space last), 0.02
row bands, left to right. Hand-typed duplicates are allowed and drawn amber. Anything not `<code>-<number>` is custom:
shown as typed, never renumbered, never counted. Curtains never take one. A part with no device type (unmapped,
assembly, allowance, unknown seed) uses its drawing-set system letter (L/A/V/R/G). Pure rules in
`src/lib/design/designators.ts`; occupancy is kept as number blocks (a lot can hold 100,000). No migration.

## Db. Designators are handed out inside every store write (#320, 2026-10-09)

`designatorContext(partIds, preload?)` (`designators-server.ts`) resolves codes BEFORE a patch (Grid-library docs by
id, catalog rows behind them, virtual Auto parts, through `gridPartsFrom`); the pure numbering runs INSIDE the patch on
the doc it read: addPlacement(s), Auto (re-)fill (its removed devices' numbers come free, so a re-fill renumbers its
scope), paste/duplicate (always fresh), the riser's + Device and qty edits, undo restore (keeps its designator;
`cleanRestoredPlacement` whitelists it). Replace part (plan and riser) re-issues a number only when it was issued in
the OLD type's code and the code changes; custom and hand-renamed designators are kept; its undo carries the old
designator back exactly. `patchDoc` is still last-writer-wins: two truly simultaneous adds can lose a placement
(pre-existing), but never share a number. `ensureDesignators` numbers pre-#320 designs once on the editor page's load
(no write when nothing is missing; `updatedAt` untouched). The /schedule page and the drawing set fill missing ones in
memory only — a print or GET path never writes. A hand designator edit clears the #211 auto tag; Renumber does not.

## Dc. Where designators show (#320, 2026-10-09)

Plan label = the designator (a lot by its range, no ×N; curtains keep their names), an SVG title
`designator · model · description`, amber when duplicated. Property Editor: an editable Designator row (blank =
next free number) and, for several, Renumber selection. Browser tree leaves read `MIC-1 · SM57`. Spreadsheet view:
a Devices tab (default) — one row per device in reading order, Designator and Category edited in place (Enter / Tab
save and move; Esc or clicking away discards — no blur-commit, which would double-save as focus moves), type / space /
sheet filters, header sort, row → plan selection, Renumber… (all, the filtered type's code, selected rows) — built from
a column list (`grid-device-rows.ts`) so later device fields are columns; and a Schedule tab with a Designators
column, as on /schedule and the E-60x sheets. Drawing-set plan sheets print each device's designator where its type
mark sat; the device key is one row per part — designators · qty · description; curtains keep their type marks.
Every edit and Renumber is one undo step. Quotes, BOM, customer documents and the riser are unchanged (riser next).

## Dd. Device-type designator codes (#320, 2026-10-09)

`DeviceType.code` (1–6 of A–Z/0–9, uppercased) is edited in Catalog → Device types; blank uses the effective default:
the shipped `DEFAULT_TYPE_CODES` for the 25 seeded types (LX, DIM, LCN, LA, HST, TR, RH, RC, DR, TRK, SPK, MIC, MIX,
AMP, ALS, COM, DSP, SCR, CAM, SW, CBL, RACK, PD, NET, PRT), else derived from the label (first letters of up to three
words, or the first three letters of one word). A save where two active types would share an effective code is
refused, naming both — two types numbering into one series would read as one. A changed code applies to new numbers;
existing designators keep theirs until Renumber.
```

- [ ] **Step 3: Append to `PUNCHLIST.md`** (real numbers)

```markdown

## 320. Grid device designators — DONE 2026-10-09 (Da–Dd)

Jeff: device labels on the plan were full catalog descriptions; he wanted short designators on the plan that show up
in the schedules and are edited in the spreadsheet view (slice 1 of per-device data; the riser is next).

- **Rules:** `src/lib/design/designators.ts` (clean/parse/format, occupancy, next free, reading order, assign,
  renumber, duplicates, schedule list, codes, plan marks); type codes in `src/lib/design/device-types.ts`.
- **Store:** `GridPlacement.designator`; numbered inside every create path (`grid-projects.ts`, `grid-riser.ts`) via
  `designatorContext` (`designators-server.ts`); `setPlacementsDesignator`, `renumberDesignators`,
  `ensureDesignators` (editor page load).
- **Editor:** plan labels, Property Editor row + Renumber selection, Browser leaves, Spreadsheet Devices + Schedule
  tabs (`workspace/devices-table.tsx`, `grid-device-rows.ts`), undo; actions `setDesignatorsAction`,
  `renumberDesignatorsAction`.
- **Output:** Designators column on /schedule, the Spreadsheet Schedule tab and E-60x; plan sheets print designators
  instead of type marks, key = designators · qty · description.
- **Catalog → Device types:** Code column.
- Spec harness: `#320` assertions (pure rules, store paths incl. paste/restore/replace/riser/option copy/ensure,
  Devices model, schedules/set, wiring pins); one `#211` pin updated.
- Jeff-gated: open a real Auto-filled design with lots and two options, check the labels, a duplicate, Renumber and
  a drawing set; set any codes he wants different in Catalog → Device types.
```

- [ ] **Step 4: Add the AGENTS.md follow-up**

In `AGENTS.md`, item 38 (`38. ✅ **The Grid workspace** (#299, …`), after the line `    Crop & rotate…. Punch item #318.` add (real numbers):

```markdown
    ✅ Follow-up (#320, Da–Dd): every placed device gets a stable, editable
    **designator** — type code + number (`MIC-1`, a lot `LX-1–24`), per option,
    gaps kept until Renumber…, duplicates amber — on the plan, the Property
    Editor, the Browser, a Spreadsheet **Devices** tab (inline edit), the
    schedules and the drawing set (replacing type marks). Rules in
    `src/lib/design/designators.ts`; codes per device type (Catalog → Device
    types). Riser display is the next slice. Punch item #320.
```

- [ ] **Step 5: Run the four gates and the build, and compare with Task 1's baselines**

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/sm/Downloads/peak-app/.claude/worktrees/designators
ps aux | grep -E "tsx|next dev" | grep -v grep          # nothing for this worktree
df -h /System/Volumes/Data | tail -1                     # room for temp datadirs (test:specs/build leave tmp.* dirs)
npx tsc --noEmit -p . 2>&1 | tail -3                     # expect: no output (0 errors)
npm run test:specs > "$TMPDIR/specs-320.txt" 2>&1; tail -1 "$TMPDIR/specs-320.txt"; grep -c '^PASS' "$TMPDIR/specs-320.txt"; grep -c '^PASS #320' "$TMPDIR/specs-320.txt"   # expect: ALL PASSED; PASS count = baseline + the #320 count
npm run test:smoke 2>&1 | tail -5                        # expect: ALL PASSED (own scratch datadir; no dev server running)
npx eslint --ignore-pattern scripts/test-review-and-spec.ts 2>&1 | tail -3   # expect: 0 errors; warnings ≤ baseline
npm run build 2>&1 | tail -15                            # expect: build completes
```

Report each with its real numbers next to the Task 1 baseline. Any new eslint error, failing spec, smoke failure or build error is a stop.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #320 Grid device designators (Da–Dd)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(Write the real D numbers in the commit subject.)

- [ ] **Step 7: Browser check (spec "Testing")**

On a scratch dev server (never the main checkout's `.data/pglite`; see the worktree dev-server memory notes), open a design with an Auto lot, two options and a hand-made duplicate: the plan shows `LX-1–24`-style labels with no ×N and an amber duplicate; hover shows `designator · model · description`; Spreadsheet → Devices edits a designator with Enter/Tab, filters, sorts, Renumber… all / type / selected each undo in one ⌘Z; the second option numbers on its own; the drawing set's plan sheet and E-60x show designators. Report what was checked.

---

## Self-review (done while writing)

- **Spec coverage:** Decisions 1–5 → Task 1 (format, codes, lots, stable/next free, renumber rules, duplicates, per option), Task 2 (stable through every write, gap, option copy), Tasks 3–4 (Renumber… all/code/selection, Devices + Schedule tabs), Task 5 (drawing set). Data → Task 1 (`code`, defaults, derivation, system letter), Task 2 (`designator` field, ≤ 24, curtains stripped, no migration, revisions/option copies untouched). Rules → Task 1 (every listed function; `codeOfPlacement`). Assignment → Task 2 (`designatorContext`, in-patch numbering in addPlacement, addPlacements, replaceAutoPlacements, pastePlacements, setPlacementsPart re-code rule, riser new placements, restoreItems + `cleanRestoredPlacement` in Task 3; `addCurtainPlacement` untouched; `ensureDesignators` from the page in Task 3; lot qty edits keep the first number). Editing → Tasks 2–3 (`setDesignatorsAction` batched with previous values and undo, empty re-issues, curtains refused, hand edit clears auto; `renumberDesignatorsAction` one patch, one undo step; `requireUser` like the siblings). Where designators show → Task 3 (plan label, title, amber, width; Property Editor row + Renumber selection; Browser leaves), Task 4 (Devices tab: columns, inline edit with Enter/Tab/Esc, filters, sort, row → plan selection, amber cell + tooltip, Renumber menu, column list; Schedule tab), Task 5 (/schedule, E-60x, plan sheets, key rows), Task 6 (Catalog → Device types). Testing → harness checks in every task; gates + browser check in Task 7. Out-of-scope items (riser, quotes, BOM, customer documents, lot splitting) are not touched.
- **Placeholders:** none in code. The only "pick a number" step (D / punch numbers) gives the exact commands and says what to change if they moved.
- **Type consistency:** `designatorContext` → `{ codeOf }`; `DesignatorPreload`; `stampNewDesignators(doc, ids, codeOf)`; `stampDesignators(doc, optionId, codeOf, only?)`; `setPlacementsDesignator(projectId, items, opts?)` ↔ `setDesignatorsAction(projectId, items, opts?)`; `renumberDesignators(projectId, optionId, target)` ↔ `renumberDesignatorsAction` returning `{ previous, next }`; hook `saveDesignators(items)`, `renumberDesignators(target, what)`, `focusPlacements(ids, focusId?)`, `designatorDupes`; `GridCommand` `designator` with `keepAuto?`; `planDesignatorMarks(items, prefix)` returning `{ tags (by placement id), rows }` matching `FigureKeyRow`; `ScheduleRow.designators?` / `ScheduleItem` row `designators?` — spelled the same everywhere they are used.
