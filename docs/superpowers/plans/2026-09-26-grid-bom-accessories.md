# Grid BOM by category + "+ Add accessory" (#230) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Grid editor's Bill of materials is grouped under seven category headings (Rigging, Curtains, Lighting, Audio, Video, Controls, General). Each heading has "+ Add accessory": a search over that category's device types, with a "Search all categories" fallback. It adds a non-placed BOM line `{ id, partId, qty, scope }`, stored on the option like `customItems`. The line is priced exactly like a placed part of the same partId, its qty can be edited, it can be removed, option copies and revisions carry it, and it is included in the draft quote.

**Architecture:** Two new pure, client-safe modules follow the `grid-bom.ts` rule. `src/lib/design/grid-bom-groups.ts` holds the seven groups, the rule that files any BOM line under a group, and `bomGroups()`. `src/lib/design/grid-accessories.ts` holds the accessory model (sanitize, list edits, copy, BOM lines, cost, search candidates). Accessories live on `GridOption.accessories` and follow #212's `customItems` path exactly: store add/edit/remove, fresh ids on option copy, deep copy in revision snapshots, and the restore that already restores `options`. `buildGridQuote` prices them from the same `tierCatalog` that prices placements. The editor prices them from the same `parts` rows that price placed devices. A new client component `accessories.tsx` renders the rows and the picker.

**Tech Stack:** Next.js 16 App Router (server component page, `"use server"` actions, client editor), TypeScript, doc-store JSONB (`grid_projects`), and the `scripts/test-review-and-spec.ts` spec harness (`npm run test:specs`).

Spec: `docs/superpowers/specs/2026-09-26-grid-packages-labor-wire-design.md`, section "#230". Ignore #228, #229, #231, #232 and #233, but keep the #232 seam described below.

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b` (branch `feat/punch-lane-b`). Prefix every shell command with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b &&`.
- This is Next.js 16 (AGENTS.md). This plan uses no new Next API. It uses only `"use server"` actions with `revalidatePath(...)` and `useRouter().refresh()`, exactly as the neighbouring `saveCustomItemAction` / `custom-items.tsx` do.
- Deterministic only. No AI anywhere (D89).
- Client components (`"use client"`) never import a VALUE from `@/lib/stores/*` or `@/db*`. The two new `src/lib/design/*` modules are pure and may value-import only sibling pure modules (`./grid-bom-groups`, `./grid-custom-items`, `./grid-scopes`). Only `next build` catches a violation, so Task 2 runs it.
- Every new server action calls `await requireUser()` first. That is the placement-edit gate every Grid editor action uses.
- Money follows the existing BOM math. Device lines are `ext = qty × list` with no rounding (`bomLines`), and accessory lines must match that exactly.
- Never run the dev server or any db script (`db:*`, seeds, imports, `fixtures:convert`). Never open `.data/pglite`. `npm run test:specs` is allowed because it always uses a fresh `mktemp -d` PGlite datadir. Before running it, check that `ps aux | grep -E "tsx|next dev" | grep -v grep` prints nothing.
- Never use bare `git stash` (the stash is shared across worktrees). Commit instead. If `git commit` fails on `index.lock`, wait 5 s and retry, up to 5 times. Never delete the lock file.
- Spec-harness assertions are tagged `#230` and appended at the END of `scripts/test-review-and-spec.ts`. Each is a hoisted `import` block plus a `{ … }` block, the same shape as the file's final `#226 T4 fix` block. Import aliases carry a `g230` / `a230` / `ci230` prefix so they can't collide. The async (DB) check is `async function gridAccessoriesAsyncChecks230()`, declared at the end of the file. Add it to the promise chain with one `.then(() => gridAccessoriesAsyncChecks230())` line placed immediately ABOVE the comment line `// Before the report and before the \`.catch\`, so a thrown suite is torn`. Other branches append to that chain too, so anchor on the comment, not on a neighbour.
- Gates in each task's final step:
  - `npx tsc --noEmit`: 0 errors.
  - `npm run test:specs`: 0 FAIL. Report the PASS count, which must equal the baseline plus the new assertions.
  - `npx eslint <changed files>`: 0 errors.
  - Task 2 also runs `npx next build`, which must succeed. `next build` is safe because `src/db/index.ts` gives build workers a throwaway datadir.
- Commit messages: `feat(grid): … (#230)`, then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the task's files and never run `git add -A`.
- Do not write DECISIONS.md or PUNCHLIST.md entries.
- Locate every edit by the quoted landmark text, never by line number. Line numbers cited in this plan are from `632da1c2` and are for orientation only.

## Decisions this plan takes where the spec is open

1. **Group keys are the Quick Design system keys.** The seven keys are `rigging | curtains | lighting | audio | video | controls | general`. Six of them are `SysKey`s, so #231's wire pull and #232's labor, which the spec computes per system, land in the group of the same key without a mapping table. Labels are Jeff's words.
2. **Which group a placed device or wire lands in (`groupOfPart`).** The rules apply in this order:
   1. If Auto painted the part for exactly one BOM system (its `auto.scope`, or its D320 `autoOrigin.scope`), it goes in that group.
   2. Otherwise, a control device type goes in **Controls**. The control types are the #226 seed keys `control-networking`, `dimming-power` and `rigging-control`.
   3. Otherwise, it goes in the group of the part's Grid scope (`scopeOfPart`, device type first per #226), and `Unscoped` goes in **General**.

   The Grid's layer taxonomy has no Controls scope (`grid-scopes.ts:36`), so these rules are the only way a line reaches Controls. Nothing about the Grid's layers, palette or drawing sets changes.
3. **The accessory search reads the Grid library, not the raw pricing catalog.** It uses the editor's `parts`, which are the same PartLite rows the palette places, filtered by the palette's `placeable` rule (not virtual, not Fabric or Labor). "Priced exactly like a placed part of the same partId" only holds if the accessory's partId is a Grid-library id. The server re-checks that id with `getGridSymbol`.
4. **"That category's device types" means mapped parts whose own group (rule 2, without Auto provenance) equals the heading.** Unmapped parts, Grid-library assemblies and parts of other categories appear only when "Search all categories" is ticked and something is typed.
5. **An accessory stays under the heading it was added under.** The stored `scope` wins, even when a "search all" part belongs elsewhere.
6. **Adding the same part under the same heading again bumps that line's qty.** It does not create a duplicate row. The same part under a different heading is its own line.
7. **An accessory is a real product line and never an allowance.** It prices from the same tier row as a placement, and it is flagged `tierFallback` exactly when a placement of it would be. It reaches the quote spec and the bid spec as `sku = partId`, as a separate line from placed units of the same sku, because it is a separate BOM line.
8. **A part that later leaves the Grid library shows as a $0, flagged line.** The line reads "removed part", exactly as `bomLines` treats a removed placement. It is never dropped and never refuses the quote.
9. **Custom items now print under their group.** `GridCustomItem.system` widens from `GridLayer` to `GridLayer | "Controls"`. The one "+ Custom item" button stays at the foot of the BOM, and its form gains a "Category" select (default General). The item then renders under that heading and keeps its category on edit.
10. **The editor shows accessory prices the same way it shows placed devices**, from `parts[].list`, which is the editor's existing device-price basis. The quote shows tier price, as it already does for placements.
11. **Labor is untouched.** The existing "Labor (suggested)" hours-per-device block stays below the groups. #232 replaces it, as described in the seam below.
12. **Out of scope:** the riser, `/schedule`, the drawing set's equipment schedules and the space rollups still list placements only. Accessories reach the client package and the bid spec only through the quote's `spec.lines`.

## #232 seam (do not build labor)

`GroupedBomLine` carries `source: BomSource` and `group: BomGroupKey`, and `bomGroups()` partitions whatever lines it receives. #232 therefore needs to make only these changes to add one labor line per system group:

- Add `"labor"` to `BomSource`.
- Append its computed lines to the `groupedBomLines(...)` result (or pass them alongside), with `group` set to the system key.
- Add a `labor` case to the editor's `renderBomLine`.
- Delete the "Labor (suggested)" block.

The group value (`BomGroup.value`) already sums any line in the group.

## File map

| File | Task | Change |
|---|---|---|
| `src/lib/design/grid-bom-groups.ts` | 1 | **Create.** Groups, `groupOfPart`, `autoSystemsByPart`, custom-item system ↔ group, `groupedBomLines`, `bomGroups` |
| `src/lib/design/grid-accessories.ts` | 1 | **Create.** `GridAccessory`, sanitize/read/save/remove/copy, `accessoryBomLines`, `accessoriesCost`, `accessoryCandidates` |
| `src/lib/design/grid-custom-items.ts` | 1 | `CustomItemSystem` (`GridLayer \| "Controls"`) |
| `src/lib/design/grid-options.ts` | 1 | `GridOption.accessories?` |
| `src/lib/stores/grid-projects.ts` | 1 | `saveAccessory`, `removeAccessory`, copy on `addOption`, deep copy in `snapshotOf` |
| `src/lib/design/grid-quote.ts` | 1 | Price accessories from `tierCatalog`, allow an accessory-only option |
| `src/app/(app)/design/grid/[id]/actions.ts` | 1 | `saveAccessoryAction`, `removeAccessoryAction` |
| `scripts/test-review-and-spec.ts` | 1, 2 | `#230` assertions |
| `src/app/(app)/design/grid/[id]/accessories.tsx` | 2 | **Create.** `AccessoryRow`, `AccessoryPicker` (client) |
| `src/app/(app)/design/grid/[id]/custom-items.tsx` | 2 | Category select, `showAdd` prop |
| `src/app/(app)/design/grid/[id]/editor.tsx` | 2 | Grouped BOM, accessories in totals, per-heading "+ Add accessory" |

`page.tsx` needs no change. The editor already receives `project.options`, which are full `GridOption` objects and so carry `accessories`, and it already receives `parts`.

---

### Task 1: Accessory + grouping model, store, quote pricing, actions

**Files:**
- Create: `src/lib/design/grid-bom-groups.ts`
- Create: `src/lib/design/grid-accessories.ts`
- Modify: `src/lib/design/grid-custom-items.ts`
- Modify: `src/lib/design/grid-options.ts`
- Modify: `src/lib/stores/grid-projects.ts`
- Modify: `src/lib/design/grid-quote.ts`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces (produced):**
```ts
// grid-bom-groups.ts
export const BOM_GROUPS: readonly [{ key: "rigging"; label: "Rigging" }, …7];
export type BomGroupKey = "rigging" | "curtains" | "lighting" | "audio" | "video" | "controls" | "general";
export function isBomGroupKey(v: unknown): v is BomGroupKey;
export function bomGroupLabel(key: BomGroupKey): string;
export const CONTROLS_TYPE_KEYS: readonly string[];
export function groupOfLayer(layer: GridLayer): BomGroupKey;
export type GroupablePart = ScopedPartLite & { deviceType?: string | null };
export function groupOfPart(part: GroupablePart | null | undefined, autoSystems?: ReadonlySet<string>): BomGroupKey;
export type AutoPlacementLite = { partId: string; curtain?: unknown; auto?: { scope: string } | null; autoOrigin?: { scope: string } | null };
export function autoSystemsByPart(placements: ReadonlyArray<AutoPlacementLite>): Map<string, Set<string>>;
export const CUSTOM_SYSTEM_OF_GROUP: Record<BomGroupKey, CustomItemSystem | null>;
export function groupOfCustomSystem(system: string | null | undefined): BomGroupKey;
export type BomSource = "device" | "accessory" | "wire" | "curtain" | "custom";
export type GroupedBomLine = BomLine & { group: BomGroupKey; source: BomSource; accessoryId?: string };
export type BomGroup = { key: BomGroupKey; label: string; lines: GroupedBomLine[]; value: number };
export function groupedBomLines(input: {...}): GroupedBomLine[];
export function bomGroups(lines: readonly GroupedBomLine[]): BomGroup[];

// grid-accessories.ts
export type GridAccessory = { id: string; partId: string; qty: number; scope: BomGroupKey }; // id "ba-" + 12 hex
export type GridAccessoryInput = { id?: string | null; partId?: string; qty: number; scope?: string };
export type AccessoryBomLine = BomLine & { accessoryId: string; group: BomGroupKey };
export function sanitizeAccessory(raw: unknown, id: string): { ok: true; item: GridAccessory } | { ok: false; error: string };
export function accessoriesOf(raw: unknown): GridAccessory[];
export function applyAccessorySave(items, raw, makeId): AccessorySave;
export function withoutAccessory(items, id): GridAccessory[];
export function copyAccessories(items, makeId): GridAccessory[];
export function accessoryBomLines(items, parts: ReadonlyArray<Pick<PartLite, "id"|"desc"|"unit"|"list">>): AccessoryBomLine[];
export function accessoriesCost(items, parts: ReadonlyArray<Pick<PartLite, "id"|"cost">>): number;
export function accessoryCandidates(parts: readonly PartLite[], group: BomGroupKey, search: string, all: boolean): PartLite[];

// grid-custom-items.ts
export type CustomItemSystem = GridLayer | "Controls";
export function isCustomItemSystem(v: unknown): v is CustomItemSystem;

// stores/grid-projects.ts
export async function saveAccessory(projectId: string, optionId: string, raw: unknown): Promise<{ ok: true; item: GridAccessory } | { ok: false; error: string }>;
export async function removeAccessory(projectId: string, optionId: string, accessoryId: string): Promise<{ ok: true } | { ok: false; error: string }>;

// grid/[id]/actions.ts
export async function saveAccessoryAction(projectId: string, optionId: string, input: GridAccessoryInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
export async function removeAccessoryAction(projectId: string, optionId: string, accessoryId: string): Promise<Result>;
```

- [ ] **Step 0: Baseline the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && ps aux | grep -E "tsx|next dev" | grep -v grep; npx tsc --noEmit 2>&1 | tail -3; npm run test:specs 2>&1 > /tmp/claude-230-base.txt; grep -c '^PASS' /tmp/claude-230-base.txt; grep -c '^FAIL' /tmp/claude-230-base.txt
```
Expected: `ps` prints nothing, tsc prints nothing, and there are 0 FAIL. Write down the PASS count as `BASE`.

- [ ] **Step 1: Write the failing pure-model assertions**

Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #230 Grid BOM by category + accessories — Task 1: the pure model
   (grouping rule, accessory sanitize/list edits/pricing/search) and
   source pins for the store, quote and actions.
   ====================================================================== */
import {
  BOM_GROUPS as g230Groups, CUSTOM_SYSTEM_OF_GROUP as g230SysOf, autoSystemsByPart as g230Auto, bomGroups as g230BomGroups,
  groupOfCustomSystem as g230CustomGroup, groupOfPart as g230GroupOf, groupedBomLines as g230Grouped, isBomGroupKey as g230IsKey,
} from "@/lib/design/grid-bom-groups";
import {
  ACCESSORIES_MAX as a230Max, accessoriesCost as a230Cost, accessoriesOf as a230Of, accessoryBomLines as a230Lines,
  accessoryCandidates as a230Cands, applyAccessorySave as a230Save, copyAccessories as a230Copy, sanitizeAccessory as a230Sanitize,
  withoutAccessory as a230Without, type GridAccessory as A230,
} from "@/lib/design/grid-accessories";
import { sanitizeCustomItem as ci230Sanitize } from "@/lib/design/grid-custom-items";
import type { PartLite as P230 } from "@/lib/design/grid-bom";

{
  // --- groups + the grouping rule
  ok(g230Groups.map((g) => g.label).join("|") === "Rigging|Curtains|Lighting|Audio|Video|Controls|General", "#230 groups: seven headings in Jeff's order");
  ok(g230IsKey("controls") && g230IsKey("general") && !g230IsKey("Controls") && !g230IsKey("acoustical"), "#230 groups: keys are the lower-case system keys");
  ok(g230GroupOf({ gridScope: "Audio", deviceType: "speakers" }) === "audio" && g230GroupOf({ gridScope: "Unscoped", deviceType: "cable-connectors" }) === "general" && g230GroupOf(undefined) === "general",
    "#230 groups: a part files by its (device-type) scope; Unscoped → General");
  ok(g230GroupOf({ gridScope: "Lighting", deviceType: "control-networking" }) === "controls" && g230GroupOf({ gridScope: "Lighting", deviceType: "dimming-power" }) === "controls" && g230GroupOf({ gridScope: "Rigging", deviceType: "rigging-control" }) === "controls",
    "#230 groups: control, dimming and rigging-control device types file under Controls");
  ok(g230GroupOf({ gridScope: "Unscoped" }, new Set(["controls"])) === "controls" && g230GroupOf({ gridScope: "Audio" }, new Set(["video"])) === "video",
    "#230 groups: an Auto-painted part files under the system it was painted for");
  ok(g230GroupOf({ gridScope: "Audio" }, new Set(["audio", "video"])) === "audio" && g230GroupOf({ gridScope: "Audio" }, new Set(["acoustical"])) === "audio",
    "#230 groups: ambiguous or non-BOM Auto systems fall back to the part's own scope");
  const auto230 = g230Auto([
    { partId: "A", auto: { scope: "controls" } }, { partId: "A" },
    { partId: "B", autoOrigin: { scope: "lighting" } },
    { partId: "F", curtain: {}, auto: { scope: "curtains" } },
  ]);
  ok([...(auto230.get("A") || [])].join() === "controls" && [...(auto230.get("B") || [])].join() === "lighting" && !auto230.has("F"),
    "#230 groups: Auto systems per part come from auto tags and D320 origins; curtains are skipped");
  ok(g230CustomGroup("Controls") === "controls" && g230CustomGroup("Rigging") === "rigging" && g230CustomGroup("Unscoped") === "general" && g230CustomGroup(undefined) === "general" && g230CustomGroup("Plumbing") === "general",
    "#230 groups: a custom item's system maps to its group");
  ok(Object.entries(g230SysOf).every(([k, s]) => g230CustomGroup(s ?? undefined) === k), "#230 groups: every group's custom-item system round-trips");
  const ctl230 = ci230Sanitize({ desc: "Console desk", system: "Controls", qty: 1, unitCost: 10 }, "ci-0123456789ab");
  ok(ctl230.ok && ctl230.item.system === "Controls", "#230 custom: a custom item can be filed under Controls");

  // --- accessories: sanitize + list edits
  const ID = "ba-0123456789ab";
  const s230 = a230Sanitize({ partId: " ETC-S4 ", qty: 3, scope: "lighting" }, ID);
  ok(s230.ok && s230.item.id === ID && s230.item.partId === "ETC-S4" && s230.item.qty === 3 && s230.item.scope === "lighting",
    "#230 accessory: sanitize trims the part id and keeps qty + group");
  ok(!a230Sanitize({ partId: "", qty: 1, scope: "lighting" }, ID).ok && !a230Sanitize({ partId: "asm:fa-1", qty: 1, scope: "lighting" }, ID).ok &&
    !a230Sanitize({ partId: "allow:lighting:par:good", qty: 1, scope: "lighting" }, ID).ok && !a230Sanitize({ partId: "custom:ci-0123456789ab", qty: 1, scope: "lighting" }, ID).ok &&
    !a230Sanitize({ partId: "grid-seed:x", qty: 1, scope: "lighting" }, ID).ok && !a230Sanitize({ partId: "x".repeat(201), qty: 1, scope: "lighting" }, ID).ok,
    "#230 accessory: blank, virtual, custom, seed and over-long ids are never accessories");
  ok(!a230Sanitize({ partId: "X", qty: 0, scope: "audio" }, ID).ok && !a230Sanitize({ partId: "X", qty: 1.5, scope: "audio" }, ID).ok && !a230Sanitize({ partId: "X", qty: 100001, scope: "audio" }, ID).ok,
    "#230 accessory: qty is a whole number from 1 to 100,000");
  ok(!a230Sanitize({ partId: "X", qty: 1, scope: "Lighting" }, ID).ok && !a230Sanitize({ partId: "X", qty: 1 }, ID).ok, "#230 accessory: the group key is required and exact");
  const read230 = a230Of([
    { id: ID, partId: "X", qty: 1, scope: "audio" }, { id: ID, partId: "Y", qty: 1, scope: "audio" },
    { id: "bad", partId: "X", qty: 1, scope: "audio" }, { id: "ba-bbbbbbbbbbbb", partId: "", qty: 1, scope: "audio" }, 5,
  ]);
  ok(read230.length === 1 && read230[0].partId === "X" && a230Of(undefined).length === 0 && a230Of("junk").length === 0,
    "#230 accessory: a stored list drops bad ids, invalid rows and duplicates");
  let n230 = 0;
  const mk230 = () => `ba-${String(++n230).padStart(12, "0")}`;
  const add1 = a230Save([], { partId: "X", qty: 2, scope: "audio" }, mk230);
  ok(add1.ok && add1.items.length === 1 && add1.item.id === "ba-000000000001" && add1.item.qty === 2, "#230 accessory: saving without an id adds a line");
  const add2 = add1.ok ? a230Save(add1.items, { partId: "X", qty: 3, scope: "audio" }, mk230) : add1;
  ok(add2.ok && add2.items.length === 1 && add2.item.qty === 5 && add2.item.id === "ba-000000000001", "#230 accessory: adding the same part to the same group bumps its qty");
  const add3 = add2.ok ? a230Save(add2.items, { partId: "X", qty: 1, scope: "video" }, mk230) : add2;
  ok(add3.ok && add3.items.length === 2 && add3.item.scope === "video", "#230 accessory: the same part under another group is its own line");
  const ed230 = add3.ok ? a230Save(add3.items, { id: "ba-000000000001", qty: 9, partId: "IGNORED", scope: "rigging" }, mk230) : add3;
  ok(ed230.ok && ed230.item.qty === 9 && ed230.item.partId === "X" && ed230.item.scope === "audio" && ed230.items.length === 2, "#230 accessory: an edit changes the qty only");
  const gone230 = a230Save([], { id: "ba-000000000001", qty: 2 }, mk230);
  ok(!gone230.ok && gone230.reason === "no-such-accessory", "#230 accessory: editing an accessory removed elsewhere is refused");
  const badQty230 = add1.ok ? a230Save(add1.items, { id: "ba-000000000001", qty: 0 }, mk230) : add1;
  ok(!badQty230.ok && badQty230.reason === "invalid", "#230 accessory: an edit to an invalid qty is refused");
  const bad230 = a230Save([], { partId: "X", qty: 0, scope: "audio" }, mk230);
  ok(!bad230.ok && bad230.reason === "invalid" && bad230.error.length > 0, "#230 accessory: an invalid add is refused with a message");
  const full230: A230[] = Array.from({ length: a230Max }, (_, i) => ({ id: `ba-${String(i).padStart(12, "0")}`, partId: `P${i}`, qty: 1, scope: "general" }));
  const over230 = a230Save(full230, { partId: "NEW", qty: 1, scope: "general" }, mk230);
  ok(!over230.ok && over230.reason === "too-many", `#230 accessory: an option holds at most ${a230Max} accessories`);
  const two230: A230[] = [
    { id: "ba-aaaaaaaaaaaa", partId: "X", qty: 2, scope: "audio" },
    { id: "ba-bbbbbbbbbbbb", partId: "GONE", qty: 1, scope: "general" },
  ];
  ok(a230Without(two230, "ba-aaaaaaaaaaaa").map((a) => a.id).join() === "ba-bbbbbbbbbbbb", "#230 accessory: remove drops exactly that line");
  const copies230 = a230Copy(two230, mk230);
  ok(copies230.length === 2 && copies230.every((c, i) => c.id !== two230[i].id && /^ba-[0-9a-f]{12}$/.test(c.id) && c.partId === two230[i].partId && c.qty === two230[i].qty && c.scope === two230[i].scope),
    "#230 accessory: a copied option gets the same lines under fresh ids");

  // --- pricing: the same part row a placement reads
  const parts230: P230[] = [
    { id: "X", sku: "X-SKU", desc: "Speaker bracket", category: "Speakers", unit: "ea", list: 120, cost: 70, gridScope: "Audio", deviceType: "speakers" },
    { id: "CN", sku: "CN-SKU", desc: "Lighting console", category: "Consoles", unit: "ea", list: 900, cost: 600, gridScope: "Lighting", deviceType: "control-networking" },
    { id: "FX", sku: "FX-SKU", desc: "LED fixture", category: "Fixtures", unit: "ea", list: 400, cost: 250, gridScope: "Lighting", deviceType: "fixtures" },
    { id: "UN", sku: "UN-SKU", desc: "Unmapped audio widget", category: "Widgets", unit: "ea", list: 10, cost: 5, gridScope: "Audio", deviceType: null },
    { id: "VIRT", sku: "VIRT", desc: "Virt assembly", category: "Assembly", unit: "ea", list: 10, cost: 5, gridScope: "Audio", deviceType: "speakers", virtual: true },
    { id: "FAB", sku: "FAB", desc: "Velour fabric", category: "Fabric", unit: "sqft", list: 3, cost: 2, gridScope: "Curtains", deviceType: "drapery" },
    { id: "W", sku: "W", desc: "DMX cable", category: "Cable", unit: "ft", list: 1, cost: 0.5, gridScope: "Unscoped", deviceType: "cable-connectors" },
  ];
  const lines230 = a230Lines(two230, parts230);
  ok(lines230[0].partId === "X" && lines230[0].desc === "Speaker bracket" && lines230[0].unit === "ea" && lines230[0].qty === 2 && lines230[0].list === 120 && lines230[0].ext === 240 && lines230[0].accessoryId === "ba-aaaaaaaaaaaa" && lines230[0].group === "audio",
    "#230 accessory: priced from the same part row a placement reads (ext = qty × list)");
  ok(lines230[1].list === 0 && lines230[1].ext === 0 && lines230[1].desc.includes("removed part"), "#230 accessory: a part gone from the library prices $0, flagged, never dropped");
  ok(a230Cost(two230, parts230) === 140, "#230 accessory: the cost basis is qty × part cost");

  // --- search candidates
  const ids230 = (rows: P230[]) => rows.map((p) => p.id).join();
  ok(ids230(a230Cands(parts230, "audio", "", false)) === "X", "#230 search: a group lists its own device types' parts — not unmapped, virtual or other groups'");
  ok(ids230(a230Cands(parts230, "controls", "", false)) === "CN" && ids230(a230Cands(parts230, "lighting", "", false)) === "FX",
    "#230 search: Controls lists the control types; Lighting no longer does");
  ok(ids230(a230Cands(parts230, "audio", "bracket", false)) === "X" && a230Cands(parts230, "audio", "console", false).length === 0, "#230 search: the query narrows within the group");
  ok(a230Cands(parts230, "audio", "", true).length === 0 && ids230(a230Cands(parts230, "audio", "console", true)) === "CN" && ids230(a230Cands(parts230, "audio", "unmapped", true)) === "UN",
    "#230 search: Search all reaches every placeable part, mapped or not, once there is a query");
  ok(a230Cands(parts230, "curtains", "", false).length === 0 && a230Cands(parts230, "general", "virt", true).length === 0 && a230Cands(parts230, "general", "velour", true).length === 0,
    "#230 search: Fabric/Labor rows and virtual parts are never offered");

  // --- grouping every BOM source
  const groups230 = g230BomGroups(g230Grouped({
    devices: [
      { partId: "X", desc: "Speaker bracket", unit: "ea", qty: 1, list: 120, ext: 120 },
      { partId: "CN", desc: "Lighting console", unit: "ea", qty: 1, list: 900, ext: 900 },
    ],
    wires: [{ partId: "W", desc: "DMX cable", unit: "ft", qty: 50, list: 1, ext: 50 }],
    curtains: [{ partId: "gp-1", desc: "Main", unit: "ea", qty: 1, list: 800, ext: 800, kind: "curtain" }],
    custom: [{ partId: "custom:ci-0123456789ab", desc: "Stage lift", unit: "ea", qty: 1, list: 500, ext: 500, allowance: true, custom: true }],
    customItems: [{ id: "ci-0123456789ab", desc: "Stage lift", qty: 1, unitCost: 350, system: "Rigging" }],
    accessories: lines230,
    parts: parts230,
    placements: [{ partId: "X" }, { partId: "CN" }],
  }));
  const by230 = (k: string) => groups230.find((g) => g.key === k)!;
  const tag230 = (k: string) => by230(k).lines.map((l) => `${l.source}:${l.partId}`).join();
  ok(groups230.length === 7 && tag230("audio") === "device:X,accessory:X", "#230 grouping: a group lists its devices, then its accessories");
  ok(tag230("controls") === "device:CN" && tag230("general") === "accessory:GONE,wire:W" && tag230("curtains") === "curtain:gp-1" && tag230("rigging") === "custom:custom:ci-0123456789ab",
    "#230 grouping: devices, wires, curtains and custom items each land in their group");
  ok(by230("audio").value === 360 && by230("video").lines.length === 0 && by230("video").value === 0, "#230 grouping: each group totals its lines; an empty group still appears");
  ok(groups230.reduce((a, g) => a + g.value, 0) === 2610, "#230 grouping: the groups partition the BOM — nothing lost or double-counted");

  // --- source pins: purity, quote, store, options, actions
  const src230 = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  for (const f of ["src/lib/design/grid-bom-groups.ts", "src/lib/design/grid-accessories.ts"]) {
    const vi = [...src230(f).matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((mm) => mm[1]);
    ok(vi.every((s) => s.startsWith("./")), `#230: ${f} value-imports only sibling pure modules (${vi.join(", ")})`);
  }
  const gq230 = src230("src/lib/design/grid-quote.ts");
  ok(gq230.includes("accessoryBomLines(accessories, tierCatalog)") && gq230.includes("accessoriesCost(accessories, tierCatalog)") && gq230.includes("!accessories.length"),
    "#230 quote: accessories price from the tier catalog placements use, and an accessory-only option can quote");
  const st230 = src230("src/lib/stores/grid-projects.ts");
  ok(st230.includes("copyAccessories(accessoriesOf(src?.accessories)") && st230.includes("accessories: o.accessories.map((a) => ({ ...a }))") && st230.includes("await getGridSymbol("),
    "#230 store: option copy and revision snapshots carry accessories; an add is checked against the Grid library");
  ok(src230("src/lib/design/grid-options.ts").includes("accessories?: GridAccessory[]"), "#230: accessories live on the Grid option");
  const acts230 = src230("src/app/(app)/design/grid/[id]/actions.ts");
  const body230 = (name: string) => acts230.slice(acts230.indexOf(`export async function ${name}`), acts230.indexOf("\n}\n", acts230.indexOf(`export async function ${name}`)));
  ok(body230("saveAccessoryAction").includes("await requireUser()") && body230("saveAccessoryAction").includes("saveAccessory(") &&
    body230("removeAccessoryAction").includes("await requireUser()") && body230("removeAccessoryAction").includes("removeAccessory("),
    "#230: both accessory actions use the placement-edit gate and the server-side store");
}
```

- [ ] **Step 2: Write the failing store + quote assertions (scratch DB)**

Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* #230 — accessories through the store, option copy, revisions and buildGridQuote on the scratch DB. */
async function gridAccessoriesAsyncChecks230(): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  const GC = await import("../src/lib/stores/grid-catalog");
  const { buildGridQuote } = await import("../src/lib/design/grid-quote");
  const { resolveTier } = await import("../src/lib/pricing-tiers");
  const { isTierPriced } = await import("../src/lib/tier-pricing");

  const PART = fixtureId(230, "bracket");
  await upsertPart({ id: PART, sku: PART, desc: "TEST230 speaker bracket", category: "Speakers", unit: "ea", list: 150, cost: 90 });
  registerFixture("catalog_parts", PART);
  const part = await getPart(PART);
  await GC.ensureGridSymbolsFor(part ? [part] : [], "Test Harness");
  registerFixture("grid_catalog", PART);
  ok(!!(await GC.getGridSymbol(PART)), "#230 store setup: the fixture part is in the Grid library");

  const gp = await GP.createProject({ name: "TEST230 grid project", customer: "Test Customer 230", customerId: null, by: "Test Harness" });
  registerFixture("grid_projects", gp.id);
  const base = (await GP.getProject(gp.id))!.options![0].id;
  const accOf = async (optionId: string) => (await GP.getProject(gp.id))!.options!.find((o) => o.id === optionId)?.accessories || [];

  const unknown = await GP.saveAccessory(gp.id, base, { partId: "TEST230:nope", qty: 1, scope: "audio" });
  ok(!unknown.ok && /Grid library/.test(unknown.error), "#230 store: a part that isn't in the Grid library is refused");
  ok(!(await GP.saveAccessory(gp.id, "opt-nope", { partId: PART, qty: 1, scope: "audio" })).ok, "#230 store: an unknown option is refused");
  const badScope = await GP.saveAccessory(gp.id, base, { partId: PART, qty: 1, scope: "Audio" });
  ok(!badScope.ok && /category/.test(badScope.error), "#230 store: an invalid group is refused with the sanitizer's message");

  const a = await GP.saveAccessory(gp.id, base, { partId: PART, qty: 2, scope: "audio" });
  const id = a.ok ? a.item.id : "";
  ok(a.ok && /^ba-[0-9a-f]{12}$/.test(id), "#230 store: a new accessory gets a ba- id");

  const tier = await resolveTier(null);
  const unit = isTierPriced(90, tier.margin) ? Math.round((90 / (1 - tier.margin)) * 100) / 100 : 150;
  const only = await buildGridQuote((await GP.getProject(gp.id))!, base);
  const onlyLine = only.ok ? only.build.spec.lines.find((l) => l.sku === PART) : undefined;
  ok(only.ok && Math.abs(only.build.value - 2 * unit) < 0.005,
    `#230 quote: an accessory-only option quotes at the part's tier price × qty (${only.ok ? only.build.value : only.error})`);
  ok(!!onlyLine && onlyLine.qty === 2 && onlyLine.price === unit && !onlyLine.allowance && onlyLine.desc === "TEST230 speaker bracket",
    "#230 quote: the accessory is a real catalog line on the spec, never an allowance");

  await GP.addPlacement(gp.id, { sheetId: "TEST230:sheet", page: 1, x: 0.5, y: 0.5, partId: PART, optionId: base, by: "Test Harness" });
  const both = await buildGridQuote((await GP.getProject(gp.id))!, base);
  const same = both.ok ? both.build.spec.lines.filter((l) => l.sku === PART) : [];
  ok(same.length === 2 && same[0].price === unit && same[1].price === unit && same.map((l) => l.qty).sort().join() === "1,2",
    "#230 quote: an accessory prices exactly like a placed part of the same partId (two lines, one price)");
  ok(both.ok && Math.abs(both.build.value - 3 * unit) < 0.005 && Math.abs(both.build.margin - (3 * unit - 3 * 90) / (3 * unit)) < 1e-6,
    "#230 quote: the accessory counts in the value and its cost in the margin");

  const e = await GP.saveAccessory(gp.id, base, { id, qty: 4 });
  const afterEdit = await accOf(base);
  ok(e.ok && afterEdit.length === 1 && afterEdit[0].id === id && afterEdit[0].qty === 4, "#230 store: editing changes the qty in place");
  const bump = await GP.saveAccessory(gp.id, base, { partId: PART, qty: 1, scope: "audio" });
  ok(bump.ok && bump.item.id === id && (await accOf(base))[0].qty === 5, "#230 store: re-adding the part under the same heading bumps the line");
  await GP.saveAccessory(gp.id, base, { id, qty: 4 });

  const alt = await GP.addOption(gp.id, { name: "Alt", copyFromOptionId: base, by: "Test Harness" });
  const altAcc = alt.ok ? await accOf(alt.option.id) : [];
  ok(altAcc.length === 1 && altAcc[0].id !== id && altAcc[0].partId === PART && altAcc[0].qty === 4 && altAcc[0].scope === "audio",
    "#230 store: copying an option copies its accessories under fresh ids");

  const rev = await GP.addRevision(gp.id, { by: "Test Harness", note: "with an accessory" });
  ok((rev?.options?.find((o) => o.id === base)?.accessories || []).length === 1, "#230 store: a revision snapshot holds the option's accessories");

  const r = await GP.removeAccessory(gp.id, base, id);
  ok(r.ok && (await accOf(base)).length === 0, "#230 store: remove drops the accessory");
  ok((await GP.removeAccessory(gp.id, base, id)).ok, "#230 store: removing an accessory already gone is not an error");

  const restored = rev ? await GP.restoreRevision(gp.id, rev.rev, "Test Harness") : { ok: false as const };
  const back = await accOf(base);
  ok(restored.ok && back.length === 1 && back[0].id === id && back[0].qty === 4, "#230 store: restoring a revision brings its accessories back");
}
```

Then add this line immediately ABOVE the comment line `// Before the report and before the \`.catch\`, so a thrown suite is torn`:

```ts
  .then(() => gridAccessoriesAsyncChecks230())
```

- [ ] **Step 3: Run the harness to see it fail**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && npm run test:specs 2>&1 | tail -5
```
Expected: the run aborts with a module resolution error for `@/lib/design/grid-bom-groups` (red).

- [ ] **Step 4: Widen the custom-item system (`src/lib/design/grid-custom-items.ts`)**

Replace:
```ts
export type GridCustomItem = {
  id: string; // "ci-" + 12 hex
  /** Customer-facing text — required, trimmed, ≤ 200. */
  desc: string;
  mfr?: string;
  model?: string;
  /** Optional Grid layer (Lighting, Rigging, …), for grouping later. */
  system?: GridLayer;
```
with:
```ts
/** The BOM category a custom item prints under (#230): a Grid layer, or
 *  "Controls" (the BOM's Controls heading has no Grid layer). Absent =
 *  General. */
export type CustomItemSystem = GridLayer | "Controls";

export function isCustomItemSystem(v: unknown): v is CustomItemSystem {
  return isGridLayer(v) || v === "Controls";
}

export type GridCustomItem = {
  id: string; // "ci-" + 12 hex
  /** Customer-facing text — required, trimmed, ≤ 200. */
  desc: string;
  mfr?: string;
  model?: string;
  /** The BOM category it prints under (#230); absent = General. */
  system?: CustomItemSystem;
```

Replace:
```ts
      ...(isGridLayer(r.system) ? { system: r.system } : {}),
```
with:
```ts
      ...(isCustomItemSystem(r.system) ? { system: r.system } : {}),
```

(The value imports stay `./equipment-map` and `./grid-scopes`, so the #212 purity pin still holds.)

- [ ] **Step 5: Create `src/lib/design/grid-bom-groups.ts`**

```ts
/**
 * The Grid BOM, grouped by category (#230) — pure and client-safe (the
 * grid-bom.ts rule): the editor's BOM sidebar renders what this returns and
 * the spec harness pins it.
 *
 * Seven headings in Jeff's order — Rigging, Curtains, Lighting, Audio,
 * Video, Controls, General. The keys are the Quick Design system keys
 * (SysKey) plus "general", so per-system figures (#231 wire pull, #232
 * labor) land in the group of the same key with no mapping table.
 *
 * Where a line lands:
 *  - a placed device or a wire run → groupOfPart: the system Auto painted
 *    it for (auto tag / D320 origin) when that is exactly one BOM system;
 *    else a control device type (CONTROLS_TYPE_KEYS) → Controls; else the
 *    part's Grid scope (device type first, #226), Unscoped → General;
 *  - a curtain drop-in → Curtains;
 *  - a custom item (#212) → its `system` (absent → General);
 *  - an accessory → the heading it was added under (its stored `scope`).
 *
 * #232 seam: a per-system labor line is one more GroupedBomLine with
 * `source: "labor"` and `group` = its system key. bomGroups() partitions
 * whatever it is given, so labor needs a BomSource member and a render
 * case in the editor — nothing else here changes.
 */
import type { BomLine } from "./grid-bom";
import { customItemPartId, type CustomItemSystem, type GridCustomItem } from "./grid-custom-items";
import { isGridLayer, scopeOfPart, type GridLayer, type ScopedPartLite } from "./grid-scopes";

export const BOM_GROUPS = [
  { key: "rigging", label: "Rigging" },
  { key: "curtains", label: "Curtains" },
  { key: "lighting", label: "Lighting" },
  { key: "audio", label: "Audio" },
  { key: "video", label: "Video" },
  { key: "controls", label: "Controls" },
  { key: "general", label: "General" },
] as const;

export type BomGroupKey = (typeof BOM_GROUPS)[number]["key"];

export const BOM_GROUP_KEYS: readonly BomGroupKey[] = BOM_GROUPS.map((g) => g.key);

export function isBomGroupKey(v: unknown): v is BomGroupKey {
  return typeof v === "string" && (BOM_GROUP_KEYS as readonly string[]).includes(v);
}

export function bomGroupLabel(key: BomGroupKey): string {
  return BOM_GROUPS.find((g) => g.key === key)?.label ?? "General";
}

/**
 * #226 seed device types that print under Controls rather than their layer:
 * consoles/networking, dimming/power control and rigging control — the
 * Quick Design "controls" system's equipment. The Grid's layers keep their
 * own scope (a console still sits on the Lighting layer); only the BOM
 * heading differs.
 */
export const CONTROLS_TYPE_KEYS: readonly string[] = ["control-networking", "dimming-power", "rigging-control"];

const LAYER_GROUP: Record<GridLayer, BomGroupKey> = {
  Lighting: "lighting",
  Rigging: "rigging",
  Curtains: "curtains",
  Audio: "audio",
  Video: "video",
  Unscoped: "general",
};

export function groupOfLayer(layer: GridLayer): BomGroupKey {
  return LAYER_GROUP[layer] ?? "general";
}

/** The grouping slice of a part — PartLite satisfies it structurally. */
export type GroupablePart = ScopedPartLite & { deviceType?: string | null };

export function groupOfPart(part: GroupablePart | null | undefined, autoSystems?: ReadonlySet<string>): BomGroupKey {
  if (autoSystems && autoSystems.size) {
    const hits = [...autoSystems].filter((s): s is BomGroupKey => isBomGroupKey(s) && s !== "general");
    if (hits.length === 1) return hits[0];
  }
  if (part?.deviceType && CONTROLS_TYPE_KEYS.includes(part.deviceType)) return "controls";
  return groupOfLayer(scopeOfPart(part));
}

/** The placement slice groupOfPart's Auto provenance needs (GridPlacement fits). */
export type AutoPlacementLite = {
  partId: string;
  curtain?: unknown;
  auto?: { scope: string } | null;
  autoOrigin?: { scope: string } | null;
};

/** partId → the Auto systems its placements were painted for (auto tag, else D320 origin). */
export function autoSystemsByPart(placements: ReadonlyArray<AutoPlacementLite>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const s = pl.auto?.scope ?? pl.autoOrigin?.scope;
    if (!s) continue;
    const set = out.get(pl.partId) ?? new Set<string>();
    set.add(s);
    out.set(pl.partId, set);
  }
  return out;
}

/** The custom-item `system` each heading stores (General stores none). */
export const CUSTOM_SYSTEM_OF_GROUP: Record<BomGroupKey, CustomItemSystem | null> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  audio: "Audio",
  video: "Video",
  controls: "Controls",
  general: null,
};

export function groupOfCustomSystem(system: string | null | undefined): BomGroupKey {
  if (system === "Controls") return "controls";
  return isGridLayer(system) ? LAYER_GROUP[system] : "general";
}

export type BomSource = "device" | "accessory" | "wire" | "curtain" | "custom";

export type GroupedBomLine = BomLine & {
  group: BomGroupKey;
  source: BomSource;
  /** Accessory lines only: the stored accessory id (edit / remove). */
  accessoryId?: string;
};

export type BomGroup = { key: BomGroupKey; label: string; lines: GroupedBomLine[]; value: number };

/** Tag every BOM line with its group and source. Within a group the order is
 *  devices, accessories, wires, curtains, custom items. */
export function groupedBomLines(input: {
  devices: readonly BomLine[];
  wires: readonly BomLine[];
  curtains: readonly BomLine[];
  custom: readonly BomLine[];
  customItems: readonly GridCustomItem[];
  accessories: ReadonlyArray<BomLine & { accessoryId: string; group: BomGroupKey }>;
  parts: ReadonlyArray<GroupablePart & { id: string }>;
  placements: ReadonlyArray<AutoPlacementLite>;
}): GroupedBomLine[] {
  const byId = new Map(input.parts.map((p) => [p.id, p]));
  const auto = autoSystemsByPart(input.placements);
  const customGroup = new Map(input.customItems.map((it) => [customItemPartId(it.id), groupOfCustomSystem(it.system)]));
  return [
    ...input.devices.map((l): GroupedBomLine => ({ ...l, source: "device", group: groupOfPart(byId.get(l.partId), auto.get(l.partId)) })),
    ...input.accessories.map((l): GroupedBomLine => ({ ...l, source: "accessory" })),
    ...input.wires.map((l): GroupedBomLine => ({ ...l, source: "wire", group: groupOfPart(byId.get(l.partId)) })),
    ...input.curtains.map((l): GroupedBomLine => ({ ...l, source: "curtain", group: "curtains" })),
    ...input.custom.map((l): GroupedBomLine => ({ ...l, source: "custom", group: customGroup.get(l.partId) ?? "general" })),
  ];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** All seven groups in order — empty ones included, so every heading can
 *  take an accessory — each with its lines and its sell total. */
export function bomGroups(lines: readonly GroupedBomLine[]): BomGroup[] {
  return BOM_GROUPS.map(({ key, label }) => {
    const mine = lines.filter((l) => l.group === key);
    return { key, label, lines: mine, value: round2(mine.reduce((a, l) => a + l.ext, 0)) };
  });
}
```

- [ ] **Step 6: Create `src/lib/design/grid-accessories.ts`**

```ts
/**
 * BOM accessories (#230) — pure and client-safe (the grid-bom.ts rule):
 * imported by the store, the quote builder, the editor and its accessory
 * picker.
 *
 * An accessory is a Grid-library part added under one BOM heading without
 * being placed on the plan ("+ Add accessory"). It is stored on ONE Grid
 * option (`GridOption.accessories`, like #212's customItems), so revision
 * snapshots, restores and option removal carry it with no second code path;
 * option copy re-ids it (copyAccessories).
 *
 * Pricing is a placed part's, exactly: an accessory line reads the SAME part
 * row a placement of that partId reads — the editor's `parts` and the quote's
 * tier catalog (cost ÷ (1 − tier margin), the #63/#76 list fallback
 * included). It is a real product line on the quote and the bid spec, never
 * an allowance. A part that has left the library prices $0 and says so
 * (the bomLines rule) — never dropped.
 */
import type { BomLine, PartLite } from "./grid-bom";
import { groupOfPart, isBomGroupKey, type BomGroupKey } from "./grid-bom-groups";

export const ACCESSORY_QTY_MAX = 100_000;
/** Typo/abuse guard per option, not a policy. */
export const ACCESSORIES_MAX = 200;
export const ACCESSORY_PART_ID_MAX = 200;
/** Rows the picker shows at once (the palette's cap). */
export const ACCESSORY_SEARCH_CAP = 60;

export type GridAccessory = {
  id: string; // "ba-" + 12 hex
  /** A Grid-library part id — the id a placement of it would carry. */
  partId: string;
  /** Whole number, 1…100,000, in the part's unit. */
  qty: number;
  /** The BOM heading it was added under. */
  scope: BomGroupKey;
};

/** What the editor posts: `id` = edit that line's qty; no `id` = add partId × qty under scope. */
export type GridAccessoryInput = { id?: string | null; partId?: string; qty: number; scope?: string };

export type AccessoryBomLine = BomLine & { accessoryId: string; group: BomGroupKey };

const ID_RE = /^ba-[0-9a-f]{12}$/;
/** Ids that are never a Grid-library part: Auto's virtual parts, custom items, seed placeholders. */
const NOT_A_PART = /^(asm:|allow:|custom:|grid-seed:)/;
const QTY_ERROR = "Quantity must be a whole number from 1 to 100,000.";

export function isAccessoryId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

export function isAccessoryPartId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= ACCESSORY_PART_ID_MAX && v === v.trim() && !NOT_A_PART.test(v);
}

function cleanQty(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= ACCESSORY_QTY_MAX ? n : null;
}

export function sanitizeAccessory(
  raw: unknown,
  id: string
): { ok: true; item: GridAccessory } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const partId = String(r.partId ?? "").trim();
  if (!isAccessoryPartId(partId)) return { ok: false, error: "Pick a catalog part for the accessory." };
  const qty = cleanQty(r.qty);
  if (qty === null) return { ok: false, error: QTY_ERROR };
  const scope = r.scope;
  if (!isBomGroupKey(scope)) return { ok: false, error: "Pick the BOM category the accessory belongs to." };
  return { ok: true, item: { id, partId, qty, scope } };
}

/** A stored list → clean lines: valid ids and fields only, no duplicate ids, capped. */
export function accessoriesOf(raw: unknown): GridAccessory[] {
  if (!Array.isArray(raw)) return [];
  const out: GridAccessory[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (out.length >= ACCESSORIES_MAX) break;
    if (!x || typeof x !== "object") continue;
    const id = (x as { id?: unknown }).id;
    if (!isAccessoryId(id) || seen.has(id)) continue;
    const s = sanitizeAccessory(x, id);
    if (!s.ok) continue;
    seen.add(id);
    out.push(s.item);
  }
  return out;
}

export type AccessorySave =
  | { ok: true; items: GridAccessory[]; item: GridAccessory }
  | { ok: false; reason: "no-such-accessory" | "invalid" | "too-many"; error: string };

/**
 * Edit (existing `id`: qty only — part and heading are fixed) or add (no id).
 * Adding a part already under that heading bumps that line's qty (capped)
 * instead of a second row. Never mutates `items`.
 */
export function applyAccessorySave(items: readonly GridAccessory[], raw: unknown, makeId: () => string): AccessorySave {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const editId = typeof r.id === "string" && r.id ? r.id : null;
  if (editId !== null) {
    const cur = items.find((a) => a.id === editId);
    if (!cur) return { ok: false, reason: "no-such-accessory", error: "That accessory was removed — refresh the page." };
    const qty = cleanQty(r.qty);
    if (qty === null) return { ok: false, reason: "invalid", error: QTY_ERROR };
    const item = { ...cur, qty };
    return { ok: true, items: items.map((a) => (a.id === editId ? item : a)), item };
  }
  const s = sanitizeAccessory(r, "");
  if (!s.ok) return { ok: false, reason: "invalid", error: s.error };
  const same = items.find((a) => a.partId === s.item.partId && a.scope === s.item.scope);
  if (same) {
    const item = { ...same, qty: Math.min(ACCESSORY_QTY_MAX, same.qty + s.item.qty) };
    return { ok: true, items: items.map((a) => (a.id === same.id ? item : a)), item };
  }
  if (items.length >= ACCESSORIES_MAX)
    return { ok: false, reason: "too-many", error: `An option holds at most ${ACCESSORIES_MAX} accessories.` };
  const item = { ...s.item, id: makeId() };
  return { ok: true, items: [...items, item], item };
}

export function withoutAccessory(items: readonly GridAccessory[], id: string): GridAccessory[] {
  return items.filter((a) => a.id !== id);
}

/** A copied option's accessories: same content, fresh ids. */
export function copyAccessories(items: readonly GridAccessory[], makeId: () => string): GridAccessory[] {
  return items.map((a) => ({ ...a, id: makeId() }));
}

/** BOM lines in the order the person added them, priced from `parts` —
 *  pass the rows a placement would price from (editor: `parts`; quote:
 *  `tierCatalog`). ext = qty × list, unrounded, like bomLines. */
export function accessoryBomLines(
  items: readonly GridAccessory[],
  parts: ReadonlyArray<Pick<PartLite, "id" | "desc" | "unit" | "list">>
): AccessoryBomLine[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return items.map((a) => {
    const part = byId.get(a.partId);
    const list = part ? part.list : 0;
    return {
      partId: a.partId,
      desc: part ? part.desc : `${a.partId} (removed part — no longer in the catalog)`,
      unit: part ? part.unit : "ea",
      qty: a.qty,
      list,
      ext: a.qty * list,
      accessoryId: a.id,
      group: a.scope,
    };
  });
}

/** The cost basis the quote's margin is computed from (bomTotals' rule). */
export function accessoriesCost(
  items: readonly GridAccessory[],
  parts: ReadonlyArray<Pick<PartLite, "id" | "cost">>
): number {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return items.reduce((a, it) => a + it.qty * (byId.get(it.partId)?.cost || 0), 0);
}

/** The palette's placeable rule (grid-palette.ts). */
const placeable = (p: PartLite) => !p.virtual && p.category !== "Fabric" && p.category !== "Labor";
const byName = (a: PartLite, b: PartLite) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku);

/**
 * The "+ Add accessory" picker's rows. Default: mapped parts (a device type)
 * whose own heading is `group`, narrowed by `search`. `all` ("Search all
 * categories"): every placeable part matching `search` — nothing until
 * something is typed. Name order, capped.
 */
export function accessoryCandidates(parts: readonly PartLite[], group: BomGroupKey, search: string, all: boolean): PartLite[] {
  const q = search.trim().toLowerCase();
  if (all && !q) return [];
  const hit = (p: PartLite) => !q || `${p.desc} ${p.modelNumber || p.sku} ${p.manufacturer || ""}`.toLowerCase().includes(q);
  const inGroup = (p: PartLite) => !!p.deviceType && groupOfPart(p) === group;
  return parts
    .filter((p) => placeable(p) && (all || inGroup(p)) && hit(p))
    .sort(byName)
    .slice(0, ACCESSORY_SEARCH_CAP);
}
```

- [ ] **Step 7: Put accessories on the option (`src/lib/design/grid-options.ts`)**

Replace:
```ts
import type { GridCustomItem } from "./grid-custom-items";
```
with:
```ts
import type { GridCustomItem } from "./grid-custom-items";
import type { GridAccessory } from "./grid-accessories";
```

Replace:
```ts
  customItems?: GridCustomItem[];
};
```
with:
```ts
  customItems?: GridCustomItem[];
  /** BOM accessories (#230) — catalog parts added under a BOM heading,
   *  never placed. Absent on older options; always read through accessoriesOf(). */
  accessories?: GridAccessory[];
};
```

- [ ] **Step 8: Store (`src/lib/stores/grid-projects.ts`)**

8a. Imports. Replace:
```ts
import {
  applyCustomItemSave,
  copyCustomItems,
  customItemsOf,
  withoutCustomItem,
  type GridCustomItem,
} from "@/lib/design/grid-custom-items";
```
with:
```ts
import {
  applyCustomItemSave,
  copyCustomItems,
  customItemsOf,
  withoutCustomItem,
  type GridCustomItem,
} from "@/lib/design/grid-custom-items";
import {
  accessoriesOf,
  applyAccessorySave,
  copyAccessories,
  withoutAccessory,
  type GridAccessory,
} from "@/lib/design/grid-accessories";
import { getGridSymbol } from "@/lib/stores/grid-catalog";
```

8b. Option copy in `addOption`. Replace:
```ts
      const items = copyCustomItems(customItemsOf(src?.customItems), () => rid("ci-"));
      if (items.length) option.customItems = items;
```
with:
```ts
      const items = copyCustomItems(customItemsOf(src?.customItems), () => rid("ci-"));
      if (items.length) option.customItems = items;
      // BOM accessories (#230) ride on the option the same way.
      const accessories = copyAccessories(accessoriesOf(src?.accessories), () => rid("ba-"));
      if (accessories.length) option.accessories = accessories;
```

8c. Add the two store functions immediately ABOVE the line `/* ----------------------------- revisions ----------------------------- */`:
```ts
/* ---------------------------- BOM accessories (#230) ---------------------------- */

/**
 * Add (no `id`: partId + qty + scope) or edit the qty of (`id`) one BOM
 * accessory on an option. An add must name a Grid-library part that is not
 * Fabric or Labor (the palette's placeable rule) — the id a placement of it
 * would carry, so it prices exactly like one. The raw input is re-sanitized
 * here whatever the client sent. Re-adding a part under the same heading
 * bumps that line. Does not cut a revision (same as a placement edit).
 */
export async function saveAccessory(
  projectId: string,
  optionId: string,
  raw: unknown
): Promise<{ ok: true; item: GridAccessory } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!(typeof r.id === "string" && r.id)) {
    const symbol = await getGridSymbol(String(r.partId ?? "").trim());
    if (!symbol || symbol.category === "Fabric" || symbol.category === "Labor")
      return { ok: false, error: "That part isn't in the Grid library — pick it from the search." };
  }
  let out: { ok: true; item: GridAccessory } | { ok: false; error: string } = { ok: false, error: "Design not found." };
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    const opt = doc.options.find((o) => o.id === optionId);
    if (!opt) {
      out = { ok: false, error: "That option was removed — refresh the page." };
      return;
    }
    const s = applyAccessorySave(accessoriesOf(opt.accessories), raw, () => rid("ba-"));
    if (!s.ok) {
      out = { ok: false, error: s.error };
      return;
    }
    doc.options = doc.options.map((o) => (o.id === optionId ? { ...o, accessories: s.items } : o));
    p.updatedAt = Date.now();
    out = { ok: true, item: s.item };
  });
  return out;
}

/** Remove one accessory. Idempotent: an id already gone is not an error. */
export async function removeAccessory(
  projectId: string,
  optionId: string,
  accessoryId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) =>
      o.id === optionId ? { ...o, accessories: withoutAccessory(accessoriesOf(o.accessories), accessoryId) } : o
    );
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, error: "Design not found." };
}

```

8d. Revision snapshot (`snapshotOf`). Replace:
```ts
      // Custom items (#212) ride on the option — copied, not shared.
      options: p.options
        ? p.options.map((o) => ({ ...o, ...(o.customItems ? { customItems: o.customItems.map((c) => ({ ...c })) } : {}) }))
        : undefined,
```
with:
```ts
      // Custom items (#212) and BOM accessories (#230) ride on the option — copied, not shared.
      options: p.options
        ? p.options.map((o) => ({
            ...o,
            ...(o.customItems ? { customItems: o.customItems.map((c) => ({ ...c })) } : {}),
            ...(o.accessories ? { accessories: o.accessories.map((a) => ({ ...a })) } : {}),
          }))
        : undefined,
```
(`restoreRevision` already restores `target.options` wholesale, so no change is needed there.)

- [ ] **Step 9: Quote pricing (`src/lib/design/grid-quote.ts`)**

9a. Replace:
```ts
import { customItemBomLines, customItemsCost, customItemsOf } from "@/lib/design/grid-custom-items";
```
with:
```ts
import { customItemBomLines, customItemsCost, customItemsOf } from "@/lib/design/grid-custom-items";
import { accessoriesCost, accessoriesOf, accessoryBomLines } from "@/lib/design/grid-accessories";
```

9b. Replace:
```ts
  const customItems = customItemsOf(option.customItems);
  if (!placements.length && !routes.length && !riserLinks.length && !customItems.length)
    return { ok: false, error: "Place a device or route a wire first." };
```
with:
```ts
  const customItems = customItemsOf(option.customItems);
  // BOM accessories (#230) — an option may be nothing but these, too.
  const accessories = accessoriesOf(option.accessories);
  if (!placements.length && !routes.length && !riserLinks.length && !customItems.length && !accessories.length)
    return { ok: false, error: "Place a device or route a wire first." };
```

9c. Replace:
```ts
  const lines: BomLine[] = [
    ...devLines,
    ...wires.lines,
    ...curtains,
    ...custom,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + wires.value + curtainValue + customValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + wires.cost + curtainCostTotal + customCost + labor.reduce((a, l) => a + l.cost, 0);
```
with:
```ts
  // BOM accessories (#230) price from the SAME tier catalog rows as a placed
  // part of that partId — tier sell, #76 list fallback and all.
  const acc = accessoryBomLines(accessories, tierCatalog);
  const accValue = acc.reduce((a, l) => a + l.ext, 0);
  const accCost = accessoriesCost(accessories, tierCatalog);

  const lines: BomLine[] = [
    ...devLines,
    ...acc,
    ...wires.lines,
    ...curtains,
    ...custom,
    ...labor.map((l) => ({ partId: l.sku, desc: l.desc, unit: l.unit, qty: l.qty, list: l.price, ext: l.ext })),
  ];
  const value = devTotals.value + accValue + wires.value + curtainValue + customValue + labor.reduce((a, l) => a + l.ext, 0);
  const cost = devTotals.cost + accCost + wires.cost + curtainCostTotal + customCost + labor.reduce((a, l) => a + l.cost, 0);
```
(`fallbackLines` and `spec.lines` already derive from `lines` by `partId`, so an accessory is flagged `tierFallback` exactly when a placement of it is.)

- [ ] **Step 10: Actions (`src/app/(app)/design/grid/[id]/actions.ts`)**

10a. In the `@/lib/stores/grid-projects` import list, replace:
```ts
  removeCustomItem,
```
with:
```ts
  removeAccessory,
  removeCustomItem,
```
and replace:
```ts
  saveCustomItem,
```
with:
```ts
  saveAccessory,
  saveCustomItem,
```

10b. Replace:
```ts
import type { GridCustomItemInput } from "@/lib/design/grid-custom-items";
```
with:
```ts
import type { GridCustomItemInput } from "@/lib/design/grid-custom-items";
import type { GridAccessoryInput } from "@/lib/design/grid-accessories";
```

10c. Append to the END of the file:
```ts

/* ------------------------------ BOM accessories (#230) ------------------------------ */

/**
 * Add an accessory under a BOM heading, or change one's qty (#230). Same
 * gate as the placement edits; the store re-validates the part against the
 * Grid library and re-sanitizes everything. Revalidates the Designs
 * dashboard too, since its live budget reads this option's quote build.
 */
export async function saveAccessoryAction(
  projectId: string,
  optionId: string,
  input: GridAccessoryInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireUser();
  const r = await saveAccessory(projectId, optionId, input);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true, id: r.item.id };
}

export async function removeAccessoryAction(
  projectId: string,
  optionId: string,
  accessoryId: string
): Promise<Result> {
  await requireUser();
  const r = await removeAccessory(projectId, optionId, String(accessoryId ?? ""));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}
```

- [ ] **Step 11: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && npx tsc --noEmit 2>&1 | tail -5; ps aux | grep -E "tsx|next dev" | grep -v grep; npm run test:specs 2>&1 > /tmp/claude-230-t1.txt; grep -c '^PASS' /tmp/claude-230-t1.txt; grep '^FAIL' /tmp/claude-230-t1.txt; npx eslint src/lib/design/grid-bom-groups.ts src/lib/design/grid-accessories.ts src/lib/design/grid-custom-items.ts src/lib/design/grid-options.ts src/lib/stores/grid-projects.ts src/lib/design/grid-quote.ts "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
```
Expected:
- tsc prints nothing.
- There is no `FAIL` line.
- PASS = `BASE` + 59. That is 43 checks from Step 1 (the purity pin runs twice) and 16 from Step 2. Count the `#230` PASS lines with `grep -c '^PASS #230' /tmp/claude-230-t1.txt` and report that number too.
- eslint reports 0 errors.

- [ ] **Step 12: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && git add src/lib/design/grid-bom-groups.ts src/lib/design/grid-accessories.ts src/lib/design/grid-custom-items.ts src/lib/design/grid-options.ts src/lib/stores/grid-projects.ts src/lib/design/grid-quote.ts "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts && git commit -m "$(printf 'feat(grid): BOM groups + option-scoped accessories priced like placed parts (#230)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 2: Grouped BOM UI with per-heading "+ Add accessory"

**Files:**
- Create: `src/app/(app)/design/grid/[id]/accessories.tsx`
- Modify: `src/app/(app)/design/grid/[id]/custom-items.tsx`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces (consumed):** `saveAccessoryAction` and `removeAccessoryAction` from Task 1, plus `accessoriesOf`, `accessoryBomLines`, `accessoryCandidates` and `ACCESSORY_QTY_MAX` from `grid-accessories`, and `bomGroups`, `groupedBomLines`, `groupOfCustomSystem`, `bomGroupLabel`, `BOM_GROUPS`, `CUSTOM_SYSTEM_OF_GROUP` and the `BomGroupKey` / `GroupedBomLine` types from `grid-bom-groups`.

**Interfaces (produced):**
```tsx
// accessories.tsx ("use client")
export function AccessoryRow(props: { projectId: string; optionId: string; accessoryId: string; line: BomLine; onChanged: () => void; onError: (message: string) => void }): JSX.Element;
export function AccessoryPicker(props: { projectId: string; optionId: string; group: BomGroupKey; parts: PartLite[]; onDone: (added: boolean) => void }): JSX.Element;
// custom-items.tsx — new optional prop
showAdd?: boolean; // default true
```

- [ ] **Step 1: Write the failing UI source pins**

Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #230 Grid BOM by category — Task 2: the grouped BOM UI (source pins).
   ====================================================================== */
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const acc = read("src/app/(app)/design/grid/[id]/accessories.tsx");
  const accFrom = [...acc.matchAll(/from\s+"([^"]+)"/g)].map((mm) => mm[1]);
  ok(acc.startsWith('"use client"') && accFrom.every((s) => !s.startsWith("@/lib/stores/") && !s.startsWith("@/db")),
    "#230 UI: the accessory picker is a client component with no store import");
  ok(acc.includes("accessoryCandidates(parts, group, search, all)") && acc.includes("Search all categories") &&
    acc.includes("saveAccessoryAction(projectId, optionId, { partId: p.id, qty: n, scope: group })") &&
    acc.includes("saveAccessoryAction(projectId, optionId, { id: accessoryId, qty: n })") && acc.includes("removeAccessoryAction(projectId, optionId, accessoryId)"),
    "#230 UI: the picker searches the heading's types (Search all fallback); rows edit qty and remove through the actions");
  const ed = read("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("bomGroups(") && ed.includes("groupedBomLines(") && ed.includes("+ Add accessory") && ed.includes("<AccessoryPicker") && ed.includes("<AccessoryRow"),
    "#230 UI: the editor BOM renders one heading per category, each with + Add accessory");
  ok(ed.includes("accessoryBomLines(accessories, parts)") && ed.includes("accessoryValue") && ed.includes("accessoryLines.length === 0"),
    "#230 UI: accessories price from the same parts rows, count in the total, and an accessory-only option can quote");
  ok(ed.includes("groupOfCustomSystem(it.system) === g.key") && ed.includes("showAdd={false}"), "#230 UI: custom items print under their heading");
  ok(ed.includes("Labor (suggested)"), "#230 UI: the D114 labor suggestion is untouched (#232 replaces it)");
  const ci = read("src/app/(app)/design/grid/[id]/custom-items.tsx");
  ok(ci.includes("CUSTOM_SYSTEM_OF_GROUP") && ci.includes("showAdd") && ci.includes("system: draft.system"),
    "#230 UI: the custom-item form picks its BOM category and keeps it on edit");
}
```

- [ ] **Step 2: Run the harness to see it fail**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && npm run test:specs 2>&1 | grep -E '^FAIL|ENOENT' | head
```
Expected: the run throws `ENOENT … accessories.tsx` (red).

- [ ] **Step 3: Create `src/app/(app)/design/grid/[id]/accessories.tsx`**

```tsx
"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import type { BomLine, PartLite } from "@/lib/design/grid-bom";
import { ACCESSORY_QTY_MAX, accessoryCandidates } from "@/lib/design/grid-accessories";
import { bomGroupLabel, type BomGroupKey } from "@/lib/design/grid-bom-groups";
import { removeAccessoryAction, saveAccessoryAction } from "./actions";

/**
 * BOM accessories (#230): the accessory rows under a BOM heading and the
 * "+ Add accessory" picker. Client-only; the rows to search arrive as the
 * editor's `parts` (the same PartLite rows the palette places, so an
 * accessory prices like a placement) and every write goes through a server
 * action that re-validates it.
 */

const BTN: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "4px 9px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const LINK_BTN: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 10.5,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const CHIP: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  color: "#3155a8",
  background: "#e8eefb",
  borderRadius: 999,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

const ELLIPSIS: CSSProperties = {
  color: "#3d424e",
  flex: 1,
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const ROW_BTN: CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "baseline",
  width: "100%",
  textAlign: "left",
  background: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "4px 6px",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};

const QTY_ERROR = "Quantity must be a whole number from 1 to 100,000.";
const GENERIC_ERROR = "Something went wrong — try again.";

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function cleanQty(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= ACCESSORY_QTY_MAX ? n : null;
}

/** One accessory line: qty (commits on blur / Enter), part, chip, remove, ext.
 *  The editor keys it by id + qty, so a refreshed qty re-seeds the input. */
export function AccessoryRow({
  projectId,
  optionId,
  accessoryId,
  line,
  onChanged,
  onError,
}: {
  projectId: string;
  optionId: string;
  accessoryId: string;
  line: BomLine;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [qty, setQty] = useState(String(line.qty));
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    const n = cleanQty(qty);
    if (n === line.qty) return;
    if (n === null) {
      setQty(String(line.qty));
      onError(QTY_ERROR);
      return;
    }
    setSaving(true);
    try {
      const r = await saveAccessoryAction(projectId, optionId, { id: accessoryId, qty: n });
      if (!r.ok) {
        setQty(String(line.qty));
        onError(r.error);
      } else onChanged();
    } catch {
      setQty(String(line.qty));
      onError(GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}>
      <input
        value={qty}
        disabled={saving}
        onChange={(e) => setQty(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setQty(String(line.qty));
        }}
        inputMode="numeric"
        aria-label={`Quantity of ${line.desc}`}
        style={{ ...INPUT, width: 44, flex: "none", padding: "2px 5px", fontSize: 11.5, textAlign: "right" }}
      />
      <span style={{ fontSize: 10.5, color: "#8c919c" }}>{line.unit === "ea" ? "×" : line.unit}</span>
      <span style={ELLIPSIS} title={`${line.partId} — ${line.desc}`}>
        {line.partId}
      </span>
      <span style={CHIP}>Accessory</span>
      <ConfirmButton
        label="remove"
        confirmLabel="Remove?"
        pendingLabel="Removing…"
        className=""
        style={LINK_BTN}
        onConfirm={async () => {
          try {
            const r = await removeAccessoryAction(projectId, optionId, accessoryId);
            if (!r.ok) onError(r.error);
            else onChanged();
          } catch {
            onError(GENERIC_ERROR);
          }
        }}
      />
      <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(line.ext)}</span>
    </div>
  );
}

/** The "+ Add accessory" picker for one BOM heading. */
export function AccessoryPicker({
  projectId,
  optionId,
  group,
  parts,
  onDone,
}: {
  projectId: string;
  optionId: string;
  group: BomGroupKey;
  parts: PartLite[];
  onDone: (added: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const [qty, setQty] = useState("1");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => accessoryCandidates(parts, group, search, all), [parts, group, search, all]);
  const label = bomGroupLabel(group);

  const add = async (p: PartLite) => {
    const n = cleanQty(qty);
    if (n === null) {
      setError(QTY_ERROR);
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      const r = await saveAccessoryAction(projectId, optionId, { partId: p.id, qty: n, scope: group });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone(true);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-no-nudge style={{ border: "1px solid #eef0f3", borderRadius: 8, padding: 8, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={all ? "Search every category" : `Search ${label} parts`}
          aria-label="Search accessories"
          style={INPUT}
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="numeric"
          aria-label="Quantity to add"
          style={{ ...INPUT, width: 52, flex: "none", textAlign: "right" }}
        />
      </div>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "#5b616e" }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ margin: 0 }} />
        Search all categories
      </label>
      <div style={{ display: "grid", gap: 2, maxHeight: 220, overflowY: "auto" }}>
        {rows.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busyId !== null}
            onClick={() => add(p)}
            title={`${p.sku} — ${p.desc}`}
            style={ROW_BTN}
          >
            <span style={ELLIPSIS}>{p.desc}</span>
            <span style={{ fontSize: 10.5, color: "#8c919c", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
              {p.modelNumber || p.sku}
            </span>
            <span style={{ color: "#16181d", fontWeight: 600, whiteSpace: "nowrap" }}>
              {busyId === p.id ? "Adding…" : moneyFmt(p.list)}
            </span>
          </button>
        ))}
        {rows.length === 0 && (
          <div style={{ fontSize: 11, color: "#8c919c", lineHeight: 1.4 }}>
            {all
              ? search.trim()
                ? "No part matches."
                : "Type to search every category."
              : `No ${label} parts match — tick Search all categories.`}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button type="button" style={BTN} onClick={() => onDone(false)}>
          Cancel
        </button>
        <span style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
          Priced like a placed part; never drawn on the plan.
        </span>
      </div>
      {error && <div style={{ fontSize: 11, color: "#a0442b" }}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Custom items pick their BOM category (`custom-items.tsx`)**

4a. Replace:
```ts
import { removeCustomItemAction, saveCustomItemAction } from "./actions";
```
with:
```ts
import { BOM_GROUPS, CUSTOM_SYSTEM_OF_GROUP, groupOfCustomSystem } from "@/lib/design/grid-bom-groups";
import { removeCustomItemAction, saveCustomItemAction } from "./actions";
```

4b. Replace:
```ts
type Draft = { id: string | null; desc: string; mfr: string; model: string; qty: string; unitCost: string };
const EMPTY: Draft = { id: null, desc: "", mfr: "", model: "", qty: "1", unitCost: "" };
```
with:
```ts
/** `system` is the stored custom-item system of the chosen BOM heading ("" = General, #230). */
type Draft = { id: string | null; desc: string; mfr: string; model: string; system: string; qty: string; unitCost: string };
const EMPTY: Draft = { id: null, desc: "", mfr: "", model: "", system: "", qty: "1", unitCost: "" };
```

4c. Replace:
```ts
  lines,
  onChanged,
}: {
  projectId: string;
  optionId: string;
  /** This option's items (for the edit form). */
  items: GridCustomItem[];
  /** The same items priced server-side (sell only), keyed by partId custom:<id>. */
  lines: BomLine[];
  onChanged: () => void;
}) {
```
with:
```ts
  lines,
  onChanged,
  showAdd = true,
}: {
  projectId: string;
  optionId: string;
  /** The items to list here (#230: one BOM heading's), for the edit form. */
  items: GridCustomItem[];
  /** The same items priced server-side (sell only), keyed by partId custom:<id>. */
  lines: BomLine[];
  onChanged: () => void;
  /** #230: false under a BOM heading — the one "+ Custom item" sits at the BOM's foot. */
  showAdd?: boolean;
}) {
```

4d. Replace:
```ts
    setDraft({ id: it.id, desc: it.desc, mfr: it.mfr ?? "", model: it.model ?? "", qty: String(it.qty), unitCost: String(it.unitCost) });
```
with:
```ts
    setDraft({
      id: it.id,
      desc: it.desc,
      mfr: it.mfr ?? "",
      model: it.model ?? "",
      system: CUSTOM_SYSTEM_OF_GROUP[groupOfCustomSystem(it.system)] ?? "",
      qty: String(it.qty),
      unitCost: String(it.unitCost),
    });
```

4e. Replace:
```ts
        model: draft.model,
        qty: Number(draft.qty),
```
with:
```ts
        model: draft.model,
        system: draft.system,
        qty: Number(draft.qty),
```

4f. Replace:
```tsx
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft.qty} onChange={field("qty")} inputMode="numeric" placeholder="Qty" style={{ ...INPUT, width: 64, flex: "none" }} />
```
with:
```tsx
          <select
            value={draft.system}
            onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => (d ? { ...d, system: v } : d));
            }}
            aria-label="BOM category"
            style={INPUT}
          >
            {BOM_GROUPS.map((g) => (
              <option key={g.key} value={CUSTOM_SYSTEM_OF_GROUP[g.key] ?? ""}>
                {g.label}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft.qty} onChange={field("qty")} inputMode="numeric" placeholder="Qty" style={{ ...INPUT, width: 64, flex: "none" }} />
```

4g. Replace:
```tsx
      ) : (
        <button
          type="button"
          style={{ ...BTN, justifySelf: "start", fontSize: 11.5, padding: "3px 9px" }}
```
with:
```tsx
      ) : !showAdd ? null : (
        <button
          type="button"
          style={{ ...BTN, justifySelf: "start", fontSize: 11.5, padding: "3px 9px" }}
```

- [ ] **Step 5: Editor — imports and the heading link style (`editor.tsx`)**

5a. Replace:
```ts
import { customItemsOf } from "@/lib/design/grid-custom-items";
```
with:
```ts
import { customItemsOf } from "@/lib/design/grid-custom-items";
import { accessoriesOf, accessoryBomLines } from "@/lib/design/grid-accessories";
import { bomGroups, groupedBomLines, groupOfCustomSystem, type BomGroupKey, type GroupedBomLine } from "@/lib/design/grid-bom-groups";
import { AccessoryPicker, AccessoryRow } from "./accessories";
```

5b. Insert immediately ABOVE the line `function moneyFmt(n: number): string {`:
```ts
/** #230: the "+ Add accessory" link on a BOM heading. */
const ADD_LINK: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 10.5,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

```

- [ ] **Step 6: Editor — accessories, groups and the row renderer**

Replace:
```tsx
  // #212: per-design custom items — edited from the BOM, priced like allowances.
  const customItems = useMemo(() => customItemsOf(activeOption.customItems), [activeOption.customItems]);
  const customValue = customLines.reduce((a, l) => a + l.ext, 0);
  const bomEmpty = lines.length === 0 && wires.lines.length === 0 && curtains.length === 0 && customLines.length === 0;
  const customSection = (
    <CustomItemsSection
      key={activeOptionId}
      projectId={project.id}
      optionId={activeOptionId}
      items={customItems}
      lines={customLines}
      onChanged={() => router.refresh()}
    />
  );
  const grandValue = totals.value + wires.value + laborValue + curtainValue + customValue;
```
with:
```tsx
  // #212: per-design custom items — edited from the BOM, priced like allowances.
  const customItems = useMemo(() => customItemsOf(activeOption.customItems), [activeOption.customItems]);
  const customValue = customLines.reduce((a, l) => a + l.ext, 0);
  // #230: BOM accessories — option-scoped, priced from the SAME `parts` rows
  // as a placed device of that partId (the quote re-prices both at tier).
  const accessories = useMemo(() => accessoriesOf(activeOption.accessories), [activeOption.accessories]);
  const accessoryLines = useMemo(() => accessoryBomLines(accessories, parts), [accessories, parts]);
  const accessoryValue = accessoryLines.reduce((a, l) => a + l.ext, 0);
  const bomEmpty =
    lines.length === 0 && wires.lines.length === 0 && curtains.length === 0 && customLines.length === 0 && accessoryLines.length === 0;
  // The one "+ Custom item" (at the BOM's foot); saved items print under their heading.
  const customSection = (
    <CustomItemsSection
      key={`${activeOptionId}:add`}
      projectId={project.id}
      optionId={activeOptionId}
      items={[]}
      lines={customLines}
      onChanged={() => router.refresh()}
    />
  );
  const grandValue = totals.value + wires.value + laborValue + curtainValue + customValue + accessoryValue;
  /** #230: the BOM under its seven headings. */
  const bomGroupList = useMemo(
    () =>
      bomGroups(
        groupedBomLines({
          devices: lines,
          wires: wires.lines,
          curtains,
          custom: customLines,
          customItems,
          accessories: accessoryLines,
          parts,
          placements,
        })
      ),
    [lines, wires.lines, curtains, customLines, customItems, accessoryLines, parts, placements]
  );
  /** The heading whose accessory picker is open — per option, so switching options closes it. */
  const [addingTo, setAddingTo] = useState<{ optionId: string; group: BomGroupKey } | null>(null);
  const pickerOpenFor = addingTo && addingTo.optionId === activeOptionId ? addingTo.group : null;
  /** One BOM row under a heading. Device / wire / curtain rows are the
   *  pre-#230 rows unchanged; custom items render through their heading's
   *  CustomItemsSection. */
  const renderBomLine = (l: GroupedBomLine) => {
    if (l.source === "custom") return null;
    if (l.source === "accessory") {
      return l.accessoryId ? (
        <AccessoryRow
          key={`a-${l.accessoryId}-${l.qty}`}
          projectId={project.id}
          optionId={activeOptionId}
          accessoryId={l.accessoryId}
          line={l}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
      ) : null;
    }
    if (l.source === "curtain") {
      // Curtains (punch #49): one line each, never grouped - two drapes of
      // one fabric are different goods once their dimensions differ.
      return (
        <div key={`c-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
          <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>1×</strong>
          <span
            style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            title={l.desc}
          >
            {l.curtainName}
          </span>
          <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
        </div>
      );
    }
    if (l.source === "wire") {
      return (
        <div key={`w-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
          <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty} {l.unit}</strong>
          <span
            style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            title={`${l.partId} — ${l.desc}`}
          >
            {l.partId}
          </span>
          {partById.get(l.partId)?.hasDatasheet && (
            <a
              href={`/api/part-datasheet/${encodeURIComponent(l.partId)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", fontSize: 10.5, whiteSpace: "nowrap", textDecoration: "none" }}
            >
              datasheet
            </a>
          )}
          {l.connectionType && (
            <span style={{ color: "#9aa0ab", fontSize: 10.5, whiteSpace: "nowrap" }}>
              {l.connectionType}
            </span>
          )}
          <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
        </div>
      );
    }
    return (
      <div key={`d-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
        <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty}×</strong>
        <span
          style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          title={`${l.partId} — ${l.desc}`}
        >
          {partById.get(l.partId)?.virtual ? l.desc : l.partId}
        </span>
        {partById.get(l.partId)?.virtualDead ? (
          // #211 D313: nothing real behind it — the quote refuses it by name.
          <span
            title={`${l.desc} — ${VIRTUAL_DEAD_HINT}`}
            style={{ fontSize: 9.5, fontWeight: 700, color: "#a0442b", background: "#fbe9e4", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}
          >
            Needs a part
          </span>
        ) : (
          partById.get(l.partId)?.allowance && (
            <span style={{ fontSize: 9.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>
              Allowance
            </span>
          )
        )}
        {partById.get(l.partId)?.hasDatasheet && (
          <a
            href={`/api/part-datasheet/${encodeURIComponent(l.partId)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", fontSize: 10.5, whiteSpace: "nowrap", textDecoration: "none" }}
          >
            datasheet
          </a>
        )}
        <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
      </div>
    );
  };
```

- [ ] **Step 7: Editor — the grouped BOM markup**

Inside the `{/* BOM */}` panel, replace everything from the line `{bomEmpty ? (` through its matching `)}`, which is the line immediately before the `<button` whose label reads `Create draft quote`. That covers the old empty hint, the flat device/wire/curtain rows, `{customSection}`, the labor block and the Total row. Replace it with:

```tsx
            {bomEmpty && (
              <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 4 }}>
                Paint devices onto the plan to build the BOM.
              </div>
            )}
            <div style={{ display: "grid", gap: 4 }}>
              {/* #230: one heading per category, in Jeff's order. Every
                  heading shows, even empty, so an accessory can be added
                  to a category nothing is placed in yet. */}
              {bomGroupList.map((g) => {
                const groupCustom = customItems.filter((it) => groupOfCustomSystem(it.system) === g.key);
                return (
                  <div key={g.key} style={{ display: "grid", gap: 4, borderTop: "1px dashed #e3e5ea", paddingTop: 5 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>
                        {g.label}
                      </span>
                      {pickerOpenFor !== g.key && (
                        <button type="button" style={ADD_LINK} onClick={() => setAddingTo({ optionId: activeOptionId, group: g.key })}>
                          + Add accessory
                        </button>
                      )}
                      {g.value > 0 && <span style={{ fontSize: 11, color: "#5b616e", fontWeight: 600 }}>{moneyFmt(g.value)}</span>}
                    </div>
                    {pickerOpenFor === g.key && (
                      <AccessoryPicker
                        projectId={project.id}
                        optionId={activeOptionId}
                        group={g.key}
                        parts={parts}
                        onDone={(added) => {
                          setAddingTo(null);
                          if (added) router.refresh();
                        }}
                      />
                    )}
                    {g.lines.map((l) => renderBomLine(l))}
                    {groupCustom.length > 0 && (
                      <CustomItemsSection
                        key={`${activeOptionId}:${g.key}`}
                        projectId={project.id}
                        optionId={activeOptionId}
                        items={groupCustom}
                        lines={customLines}
                        showAdd={false}
                        onChanged={() => router.refresh()}
                      />
                    )}
                  </div>
                );
              })}
              {customSection}
              {wires.unmeasured > 0 && (
                <div style={{ fontSize: 10.5, color: "#a0442b" }}>
                  {wires.unmeasured} unmeasured wire run{wires.unmeasured === 1 ? "" : "s"} excluded.
                </div>
              )}
              {laborRows.length > 0 && (
                <div style={{ borderTop: "1px dashed #e3e5ea", marginTop: 4, paddingTop: 5, display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>
                    Labor (suggested)
                  </div>
                  {laborRows.map((l) => (
                    <div key={l.partId} style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={l.included}
                        onChange={(e) =>
                          setLaborOverrides((prev) => ({
                            ...prev,
                            [`${activeOptionId}:${l.partId}`]: { ...prev[`${activeOptionId}:${l.partId}`], included: e.target.checked },
                          }))
                        }
                        style={{ margin: 0 }}
                      />
                      <span
                        style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        title={`${l.desc} @ ${moneyFmt(l.rate)}/hr`}
                      >
                        {l.partId}
                      </span>
                      <input
                        value={String(l.hours)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setLaborOverrides((prev) => ({
                            ...prev,
                            [`${activeOptionId}:${l.partId}`]: {
                              included: prev[`${activeOptionId}:${l.partId}`]?.included ?? true,
                              hours: Number.isFinite(v) && v >= 0 ? v : 0,
                            },
                          }));
                        }}
                        inputMode="decimal"
                        style={{ ...INPUT, width: 44, padding: "2px 5px", fontSize: 11.5, textAlign: "right" }}
                      />
                      <span style={{ fontSize: 10.5, color: "#8c919c" }}>hr</span>
                      <span style={{ color: "#16181d", fontWeight: 600, opacity: l.included ? 1 : 0.4 }}>
                        {moneyFmt(l.ext)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!bomEmpty && (
                <div style={{ borderTop: "1px solid #edeff3", marginTop: 3, paddingTop: 5, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: "#8c919c" }}>Total</span>
                  <strong>{moneyFmt(grandValue)}</strong>
                </div>
              )}
            </div>
```

The `disabled={busy || bomEmpty}` quote button below is unchanged. An accessory-only option now enables it, because `bomEmpty` counts accessories.

- [ ] **Step 8: Run the gates, including `next build`**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && npx tsc --noEmit 2>&1 | tail -5; ps aux | grep -E "tsx|next dev" | grep -v grep; npm run test:specs 2>&1 > /tmp/claude-230-t2.txt; grep -c '^PASS' /tmp/claude-230-t2.txt; grep '^FAIL' /tmp/claude-230-t2.txt; npx eslint "src/app/(app)/design/grid/[id]/accessories.tsx" "src/app/(app)/design/grid/[id]/custom-items.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" scripts/test-review-and-spec.ts; npx next build 2>&1 | tail -15
```
Expected:
- tsc prints nothing.
- There is no `FAIL` line.
- PASS = Task 1's count + 7.
- eslint reports 0 errors.
- `next build` finishes with the route table and no "Module not found" or "server-only" errors. That confirms no client file pulls a store.

- [ ] **Step 9: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-lane-b && git add "src/app/(app)/design/grid/[id]/accessories.tsx" "src/app/(app)/design/grid/[id]/custom-items.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" scripts/test-review-and-spec.ts && git commit -m "$(printf 'feat(grid): BOM grouped by category with + Add accessory per heading (#230)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

## Spec coverage

| Spec #230 requirement | Where |
|---|---|
| BOM grouped under Rigging/Curtains/Lighting/Audio/Video/Controls/General | T1 `BOM_GROUPS`, `bomGroups`; T2 Step 7 |
| Device scope via #226 device types, else existing scope rules | T1 `groupOfPart` (`scopeOfPart` reads the type's `gridScope` first) |
| Wires/curtains/custom items land in their group | T1 `groupedBomLines`; T2 custom-item category select |
| Labor lands in its group | Seam for #232 (above); existing labor block untouched |
| "+ Add accessory" per heading, search limited to the category's device types, "search all" fallback | T1 `accessoryCandidates`; T2 `AccessoryPicker` |
| Non-placed line `{ id, partId, qty, scope }`, option-scoped like `customItems` | T1 `GridAccessory`, `GridOption.accessories`, store |
| Priced exactly like a placed part of the same partId (tier price) | T1 quote Step 9 (same `tierCatalog`); editor Step 6 (same `parts`); async parity check |
| Editable qty, removable | T1 `applyAccessorySave`/`removeAccessory`; T2 `AccessoryRow` |
| Carried by option copies and revisions | T1 Step 8b/8d; async checks (copy, snapshot, restore) |
| Included in the draft quote | T1 Step 9; async quote checks |
