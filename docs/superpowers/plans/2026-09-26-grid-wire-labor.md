# Grid Wire Pull + System Labor (#231, #232) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **#231:** every wire system (Rigging, Lighting, Controls, Audio, Video) gets a "Wire pull" line whose footage is `(stage width + stage depth + house depth) × runs × tier multiplier`. It is priced through a new Equipment-map row per system, in Quick Design and in Grid Auto.
- **#232:** labor becomes one amount per system: `that system's priced material × labor % × tier multiplier`. It replaces Quick Design's flat install % and the Grid BOM's "Labor (suggested)" hours-per-device section. In the Grid it is one priced quote line per system (`Labor — Lighting`, …), and a typed $ overrides it.

**Architecture:**
- **One pure module**, `src/lib/design/wire-labor.ts`. It holds the rules type, defaults, sanitizer, footage formula, wire-pull quantity step, labor formula, Grid labor lines and override helpers. It has only type imports, so client components may import it.
- **Rules live in Estimating Rules.** `pricing.ts` gets two new groups, `wire` and `labor`, in the general store. `loadWireLaborRules()` reads them with one blob read on the server.
- **Wire pull is a quantity step.** `withWirePull()` runs between line-set scaling and map pricing, like `scaleSets`. The Equipment map prices the footage (D303/D304). Default runs = 0, so no line is emitted and nothing changes until Jeff sets runs.
- **Quick Design labor** is priced in `equipment-pricing.ts`, the only pricing step. `tierTotals` accepts per-system fractions.
- **Grid labor** is computed inside `buildGridQuote` from the option's own tier-priced lines. The editor page runs the same builder over its already-loaded reads, so the BOM and the draft quote show the same labor lines.

**Tech Stack:** Next.js 16 App Router, TypeScript, the `scripts/test-review-and-spec.ts` assertion harness (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-09-26-grid-packages-labor-wire-design.md`, sections **#231** and **#232** only.

**Depends on:** `docs/superpowers/plans/2026-09-26-grid-relabels-none-hardware.md` (#233 relabels, #229 "Not included", #228 hardware) must be merged first. This plan uses its `{ kind: "none" }` cell and `"none"` priced status by name, and it edits its #233 row-count assertion.

---

## Global Constraints

- **Where to work.** Only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Every shell starts with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`.
- **Things you must not run or touch.** No dev server. No `db:*` script. Never open `.data/pglite`. `npm run test:specs` and `npm run test:grid-options` each use their own `mktemp -d` datadir and are safe.
- **Stable keys (D301).** The five new rows are `rigging:wirePull`, `lighting:wirePull`, `controls:wirePull`, `audio:wirePull`, `video:wirePull`. No existing key changes.
- **No dollars in the vocabulary.** The #211 T1 guard rejects `$<digit>` and the word "cost" anywhere in `equipment-vocab.ts`, comments included.
- **Pricing (D303/D304/D310).**
  - The engine carries quantities only. `wirePull` footage has no price of its own. An unmapped Wire pull row is needs-a-part, which makes the estimate Incomplete and refuses the quote. A row set to "Not included" (#229) resolves at $0.
  - The new Good/Better/Best multipliers are **live**, but they scale footage and labor only. The D304 reference price multipliers (`system.tier*Cost/Price`) stay inert.
- **Imports.**
  - `wire-labor.ts` has **type-only** imports. A harness guard checks this.
  - `equipment-vocab.ts` still imports only types.
  - Client components (`"use client"`) never import a value from `@/lib/stores/*`, `@/db/*`, `@/lib/design/equipment-map`, `@/lib/design/auto-estimate` or `@/lib/design/equipment-pricing`. The Quick Design and Designs dashboard clients are the existing, allowed exceptions for `equipment-pricing`. Only `next build` catches a client→store import, so every task runs it.
- **Harness conventions.**
  - Assertions are labelled `#231 …` or `#232 …`.
  - New import aliases start `wl231`, `wp231` or `lb232`.
  - New synchronous `{ … }` blocks are appended at the **end** of `scripts/test-review-and-spec.ts`.
  - New async functions are declared at the end of the file. Each is chained with one `.then(() => …())` line inserted **immediately above** the comment line ``  // Before the report and before the `.catch`, so a thrown suite is torn``.
  - `ok`, `readFileSync`, `join` and `registerFixture` already exist. Reuse them.
  - Other plans also append at EOF. On a merge conflict, keep both blocks.
- **Gates at the end of every task.** Report real numbers.
  - `npx tsc --noEmit` → 0 errors.
  - `npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"` → no FAIL lines. The PASS count must equal the previous count plus the task's stated delta.
  - `npx eslint <changed files>` → 0 errors.
  - `npx next build` → exit 0. First run `lsof -i :3000` and make sure no dev server from this worktree is running.
- **Commits.**
  - Message: `feat(grid): … (#231)` or `(#232)`, or `(#231, #232)` for Task 1. Then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - `git add` only the files the task names. If a file you must commit already has another session's uncommitted changes, stop and report rather than committing them.
  - If git reports `index.lock`, wait a few seconds and retry.
- **Docs.** Do not edit DECISIONS.md, PUNCHLIST.md or AGENTS.md.

## Spec ambiguities resolved (read before starting)

1. **Venue dimensions.**
   - Quick Design and the Grid intake (`AState` / `QuickScopeInputs`) carry `width` (stage or proscenium width) and `depth` (stage depth).
   - Neither has a house depth. `houseHalfFt` is the plan drawing's half-width, not a depth.
   - So `stageWidth = width`, `stageDepth = depth` and `houseDepth` is always missing. It counts 0, and each Wire pull line says "House depth not entered — counted as 0 ft".
   - No new input is added, per the spec's "whatever dims … already carry". Any dimension ≤ 0 or non-finite also counts as missing.
2. **Runs default 0.** The step emits **no item** at all: no $0 line and no needs-a-part line. Every current estimate is byte-identical until Jeff sets runs for a system.
3. **Footage rounding.** Round up to a whole foot, as `routeLines` does ("cable is bought whole"). First round to 1/1000 ft so float noise (70 × 2 × 1.15 = 161.00000000000003) never buys an extra foot.
4. **Where wire pull lands.**
   - Quick Design: all five wire systems, when the system is on.
   - Grid Auto: Rigging, Lighting, Audio and Video. Their rows are `place: "lot"`, so Auto drops one lot marker carrying the feet of the mapped per-ft part. It prices and quotes like `rigging:pipe`.
   - `controls:wirePull` is `place: "none"`. Controls is not a Grid scope.
   - Hand-built Grid designs get no automatic wire pull. The designer routes wire there, as today.
5. **Labor systems.**
   - All eight Quick Design systems, plus `general` for Grid lines with no system (Unscoped parts, custom items with no system).
   - Every system defaults to 18% at ×1.0 / ×1.15 / ×1.3. At Good, Quick Design totals are exactly today's.
6. **Which tier labor and wire pull use.**
   - Quick Design: the design's tier (`a.tier`, default Better).
   - Auto card: the card's tier.
   - Grid quote: the option's Auto choice for that scope (`autoEstimate[optionId].tierByScope[scope]`), else the option's own `tier` (set by the Auto generator), else **none → ×1.0**.
   - `general` always takes the option's `tier`, else none → ×1.0.
   - So a hand-built Grid design always prices labor at ×1.0.
7. **System material in the Grid** is summed from the same tier-priced numbers `buildGridQuote` quotes:
   - **Device placements.** Bucketed by the placement's `auto` tag scope, then `autoOrigin` scope, then the part's Grid scope (symbol `scope`, or a virtual part's `gridScope`). Anything unmatched goes to General.
   - **Wire runs** (routes + RiserLinks). By the wire part's scope.
   - **Curtains.** Curtains.
   - **Custom items (#212).** By their `system`, else General.
   - #230's accessory lines are not built yet. #230's plan must add them to `addMaterial` in `buildGridQuote` (handoff note at the end).
8. **Grid labor line shape.**
   - `sku: "labor:<system>"`, `desc: "Labor — Lighting"`, qty 1, unit `lot`, priced line.
   - A line is emitted to the quote only when its amount > 0.
   - The typed $ override is stored option-scoped as `GridOption.laborOverrides[system]`. It is carried by option copies, revision snapshots and restores. $0 leaves the line off the quote but keeps it in the BOM so it can be reset.
   - Margin basis: labor cost = amount × (1 − the customer's tier margin), the same rule every Grid line prices by.
   - The bid spec (`gridSpecBomRows`) drops labor lines.
9. **Retired.**
   - `system.installPct`.
   - `grid.laborHoursPerDevice` and its Grid Settings card.
   - `src/lib/design/grid-labor.ts` (`suggestLabor`).
   - The client-supplied `laborLines` argument of `createDraftQuoteAction` and `buildGridQuote`.
   - Old stored blob values stay in the `pricing_rules` blob. They are never read again, and nothing is deleted.
10. **Quick Design install rounding.** One `Math.round` over the sum of `system material × fraction`. With a flat number it stays `Math.round(matRev × pct)`. Good-tier totals therefore reproduce today's to the dollar.
11. **Auto card `total` stays equipment only.** The Scope panel's targets compare to placed equipment. Labor is a separate `labor` field, shown as its own row and added to the cards' footer total.

## What changes in live estimates (for the report to Jeff)

- **Wire pull.** Nothing changes until a system's runs is set above 0.
  - After that, every design with that system on (Quick) or chosen (Auto) gains a Wire pull line.
  - While the system's Wire pull row is unmapped, those designs read **Incomplete** and refuse Add to Quotes / the Grid quote (D310/D322). Mapping the row, or setting it to Not included, resolves them.
- **Quick Design, per design, at default rates:**
  - **Good:** unchanged.
  - **Better:** labor goes from 18% to 20.7% of materials. That adds +2.7% of materials × (1 + contingency) to the total.
  - **Best:** labor goes to 23.4%, adding +5.4% of materials × (1 + contingency).
  - Harness example (defaultAState, all rows at a $14.29 allowance): Better 16,125 → 16,479 (+354); Best 16,125 → 16,833 (+708); with the 5 ft Scenery-track edit, Better 13,321 → 13,614.
  - A saved design's stored `budget` refreshes on its next save, promote or engagement letter. The Designs dashboard shows the stored figure until then.
- **Grid.** Every Grid quote, and every Grid design's live budget on the Designs dashboard, Home and the letter (`withLiveGridBudget`), now includes labor:
  - Hand-built: +18% of material.
  - Auto scopes at Better / Best: +20.7% / +23.4%.
  - Before, labor was only on a quote when the catalog had `role: "labor"` rows and the designer kept the suggested hours. The dashboard budget never included it.
- **Retired `system.installPct`.** If production's stored value is not 18, Good-tier Quick totals move to 18% until Jeff enters the per-system values. This is Jeff-gated: check Estimating Rules → Export CSV before deploy.

## File map

| File | Task | Change |
|---|---|---|
| `src/lib/design/wire-labor.ts` | 1, 2 | **Create.** Rules, formulas, `withWirePull` (T2), Grid labor lines, overrides |
| `src/lib/stores/pricing.ts` | 1, 3, 4 | `wire` + `labor` groups, `loadWireLaborRules` (T1); drop `system.installPct` (T3); drop `grid` group (T4) |
| `src/app/(app)/design/quick/engine.ts` | 2, 3 | `BomItem.note` (T2); `tierTotals` per-system labor (T3) |
| `src/lib/design/equipment-vocab.ts` | 2 | `derived` flag + five Wire pull rows |
| `src/lib/design/equipment-pricing.ts` | 2, 3 | rules through `tierSystems*`, `QuickRates.rules` (T2); per-system labor, `systemLabor` (T3) |
| `src/lib/design/auto-estimate.ts` | 2, 3 | wire step + `note` (T2); card `labor` (T3) |
| `src/lib/design/grid-auto-fill.ts` | 2 | load + pass rules (3 call sites) |
| `src/app/(app)/design/grid/[id]/actions.ts` | 2, 4 | preview loads rules (T2); quote action signature + `setLaborOverrideAction` (T4) |
| `src/app/(app)/design/grid/[id]/page.tsx` | 2, 4 | rules to cards/targets (T2); labor lines via `buildGridQuote` (T4) |
| `src/app/(app)/design/grid/[id]/equipment-card.tsx` | 2, 3 | note (T2); labor row + footer (T3) |
| `src/app/(app)/design/quick/page.tsx` | 2, 3 | load rules (T2); drop install % (T3) |
| `src/app/(app)/design/quick/quick-design-client.tsx` | 2, 3 | rules through pipeline, note (T2); labor per system (T3) |
| `src/lib/stores/design-pricing.ts` | 2, 3 | rules in `quickRates` (T2); drop install % (T3) |
| `src/app/(app)/design/designs/page.tsx`, `design-client.tsx` | 2 | pass rules to `tierSystems` |
| `src/lib/design/grid-options.ts` | 4 | `GridOption.laborOverrides` |
| `src/lib/stores/grid-projects.ts` | 4 | `setLaborOverride`, copy + snapshot |
| `src/lib/design/grid-quote.ts` | 4 | labor per system; inputs carry rules; signature |
| `src/lib/design/grid-virtual-parts.ts` | 4 | bid spec skips labor |
| `src/lib/stores/designs.ts` | 4 | `buildGridQuote` call signature |
| `src/app/(app)/design/grid/[id]/labor-lines.tsx` | 4 | **Create.** BOM labor section (client) |
| `src/app/(app)/design/grid/[id]/editor.tsx` | 4 | replace suggested labor with server lines |
| `src/app/(app)/design/grid/settings/page.tsx` | 4 | drop labor-hours card |
| `src/lib/design/grid-labor.ts`, `src/app/(app)/design/grid/settings/labor-hours-card.tsx` | 4 | **Delete** |
| `scripts/test-review-and-spec.ts` | 1–4 | tests |
| `scripts/test-grid-options.ts` | 4 | device-line counts ignore labor |

---

## Task 0: Preconditions and baseline

- [ ] **Step 1: Confirm #233 and #229 have landed**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
git log --oneline -30 | grep -E "\(#229\)|\(#233\)"
grep -n '"none"' src/lib/design/equipment-map.ts | head -5
grep -n '"lighting", "cablePackage"' src/lib/design/equipment-vocab.ts
```
Expected: at least one commit each for #229 and #233, `PricedStatus` including `"none"`, and the `cablePackage` row present. If any is missing, stop and report. This plan's tests use `{ kind: "none" }`.

- [ ] **Step 2: Record the baseline**

```bash
npx tsc --noEmit 2>&1 | tail -3
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
```
Write down the PASS count as **B**. There must be no FAIL lines. If there are, stop and report; they are not yours.

---

## Task 1: Rules, formulas and Estimating Rules fields (#231, #232)

**Files:**
- Create: `src/lib/design/wire-labor.ts`
- Modify: `src/lib/stores/pricing.ts` (imports lines 1–3; `GROUPS` closing `];` before `let BY_ID` ~line 523; add `loadWireLaborRules` after `frac()` ~line 625)
- Test: `scripts/test-review-and-spec.ts` (EOF block + async function + chain line)

**Interfaces (produced):**
- `WIRE_SYSTEMS`, `WireSystem`, `LABOR_SYSTEMS`, `LaborSystem`, `LABOR_SYSTEM_LABEL`
- `TierMults`, `WireRule`, `LaborRule`, `WireLaborRules`, `DEFAULT_TIER_MULTS`, `DEFAULT_RUNS`, `DEFAULT_LABOR_PCT`, `RUNS_MAX`, `LABOR_PCT_MAX`, `MULT_MAX`, `LABOR_OVERRIDE_MAX`
- `isWireSystem`, `isLaborSystem`, `wireRateId`, `laborRateId`, `wireLaborRulesFrom(get)`, `defaultWireLaborRules()`, `tierMult`
- `WIRE_PULL_ITEM`, `WIRE_PULL_LABEL`, `wirePullKey`, `WireDimKey`, `WireDims`, `wireDimsOf`, `wirePullFeet`, `wirePullNote`
- `laborFrac`, `laborAmount`, `laborFracsFor(rules, tier): Record<SysKey, number>`
- `LABOR_SKU_PREFIX`, `laborSku`, `isLaborSku`, `laborLineDesc`, `LaborOverrides`, `sanitizeLaborOverrides`, `applyLaborOverride`, `laborSystemOf`, `GridLaborLine`, `gridLaborLines`
- `loadWireLaborRules(): Promise<WireLaborRules>` in `pricing.ts`

- [ ] **Step 1: Write the failing tests**

Append at the very end of `scripts/test-review-and-spec.ts`:

```ts
/* --- #231/#232 T1: wire pull + system labor — rules and formulas (pure) --- */
import * as wl231 from "@/lib/design/wire-labor";
import { GROUPS as wl231Groups } from "@/lib/stores/pricing";
{
  const d = wl231.defaultWireLaborRules();
  ok(wl231.WIRE_SYSTEMS.every((s) => d.wire[s].runs === 0 && d.wire[s].mult.good === 1 && d.wire[s].mult.better === 1.15 && d.wire[s].mult.best === 1.3),
    "#231: every wire system defaults to 0 runs (off) and ×1.0 / ×1.15 / ×1.3");
  ok(wl231.LABOR_SYSTEMS.every((s) => d.labor[s].pct === 18 && d.labor[s].mult.good === 1 && d.labor[s].mult.better === 1.15 && d.labor[s].mult.best === 1.3),
    "#232: every labor system defaults to 18% and ×1.0 / ×1.15 / ×1.3");
  const stored: Record<string, unknown> = { "wire.lighting.runs": 2, "wire.lighting.best": 1.5, "labor.audio.pct": 25, "labor.video.pct": -4, "wire.audio.runs": 999, "labor.pit.good": null };
  const r = wl231.wireLaborRulesFrom((id) => stored[id]);
  ok(r.wire.lighting.runs === 2 && r.wire.lighting.mult.best === 1.5 && r.labor.audio.pct === 25 && r.labor.video.pct === 18 && r.wire.audio.runs === wl231.RUNS_MAX && r.labor.pit.mult.good === 1,
    "#231/#232: stored rates are read, junk falls back to the default, and values cap at the rule maximum");
  const dims = wl231.wireDimsOf({ width: 40, depth: 30 });
  const lightRule = { runs: 2, mult: d.wire.lighting.mult };
  const f = wl231.wirePullFeet(dims, lightRule, "better");
  ok(f.feet === 161 && f.missing.join() === "houseDepth", `#231: feet = (40 + 30 + 0) × 2 runs × 1.15 = 161, house depth missing (${f.feet})`);
  ok(wl231.wirePullNote(f.missing) === "House depth not entered — counted as 0 ft", "#231: a missing dimension is noted on the line");
  ok(wl231.wirePullFeet(dims, lightRule, null).feet === 140, "#231: no tier chosen → ×1.0");
  ok(wl231.wirePullFeet(dims, { runs: 2.5, mult: d.wire.lighting.mult }, "best").feet === 228, "#231: footage rounds UP to a whole foot (227.5 → 228)");
  ok(wl231.wirePullFeet(dims, { runs: 0, mult: d.wire.lighting.mult }, "best").feet === 0, "#231: 0 runs → no footage");
  const none = wl231.wirePullFeet({}, { runs: 3, mult: d.wire.lighting.mult }, "good");
  ok(none.feet === 0 && none.missing.length === 3, "#231: every dimension missing → 0 ft, all three noted");
  ok(wl231.laborAmount(10000, d.labor.lighting, "better") === 2070 && wl231.laborAmount(10000, d.labor.lighting, null) === 1800 && wl231.laborAmount(10000, d.labor.lighting, "best") === 2340,
    "#232: labor = material × 18% × 1.15 / ×1.0 (none) / ×1.3");
  ok(wl231.laborAmount(0, d.labor.lighting, "best") === 0, "#232: no material → no labor");
  const fr = wl231.laborFracsFor(d, "good");
  ok(Object.keys(fr).length === 8 && Object.values(fr).every((v) => v === 0.18), "#232: at Good every Quick Design system's fraction is today's flat 18%");
  const lines = wl231.gridLaborLines({ lighting: 10000, general: 500, audio: 0 }, (s) => (s === "lighting" ? "better" : null), d, {});
  ok(lines.map((l) => `${l.sku}=${l.amount}`).join() === "labor:lighting=2070,labor:general=90", `#232: one Grid labor line per system with material, in system order (${lines.map((l) => l.sku).join()})`);
  const ov = wl231.gridLaborLines({ lighting: 10000 }, () => "better", d, { lighting: 1500, audio: 0 });
  ok(ov[0].amount === 1500 && ov[0].computed === 2070 && ov[0].overridden && ov[1]?.system === "audio" && ov[1].amount === 0 && ov[1].overridden,
    "#232: a typed $ overrides; an override on a system with no material still shows, so it can be reset");
  ok(wl231.laborLineDesc("lighting") === "Labor — Lighting" && wl231.isLaborSku("labor:general") && !wl231.isLaborSku("LIG-LBR"), "#232: labor lines read 'Labor — <System>' under a labor: sku");
  ok(JSON.stringify(wl231.sanitizeLaborOverrides({ lighting: 1200.5, audio: -1, bogus: 5, video: "7", rigging: 2e7 })) === '{"lighting":1200.5}',
    "#232: overrides keep known systems with a $0–$10M number");
  ok(JSON.stringify(wl231.applyLaborOverride({ lighting: 5 }, "audio", 0)) === '{"lighting":5,"audio":0}' && JSON.stringify(wl231.applyLaborOverride({ lighting: 5 }, "lighting", null)) === "{}",
    "#232: set or clear one system's override");
  ok(wl231.laborSystemOf("rigging", "Lighting") === "rigging" && wl231.laborSystemOf(undefined, "Audio") === "audio" && wl231.laborSystemOf(null, "Unscoped") === "general" && wl231.laborSystemOf(null, "constructor") === "general",
    "#232: an Auto tag's scope wins, then the part's Grid scope, else General");
  const ids = new Set(wl231Groups.flatMap((g) => g.items.map((it) => it.id)));
  ok(wl231.WIRE_SYSTEMS.every((s) => ["runs", "good", "better", "best"].every((x) => ids.has(`wire.${s}.${x}`))) && wl231.LABOR_SYSTEMS.every((s) => ["pct", "good", "better", "best"].every((x) => ids.has(`labor.${s}.${x}`))),
    "#231/#232: Estimating Rules carries runs / labor % and Good/Better/Best × for every system");
  const wlSrc = readFileSync(join(process.cwd(), "src/lib/design/wire-labor.ts"), "utf8");
  ok([...wlSrc.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].length === 0, "#231/#232: wire-labor.ts has type-only imports — safe for client components");
}

/* #231/#232 T1 (b) — the rules loader against the scratch DB. Leaves the defaults behind. */
async function wireLabor231AsyncChecks(): Promise<void> {
  const P = await import("@/lib/stores/pricing");
  const fresh = await P.loadWireLaborRules();
  ok(JSON.stringify(fresh) === JSON.stringify(wl231.defaultWireLaborRules()), "#231/#232: a fresh database reads the default rules");
  await P.setValue("wire.lighting.runs", 3);
  await P.setValue("labor.audio.pct", 22.5);
  const set = await P.loadWireLaborRules();
  ok(set.wire.lighting.runs === 3 && set.labor.audio.pct === 22.5 && set.wire.audio.runs === 0, "#231/#232: Estimating Rules edits reach the loader");
  await P.setValue("wire.lighting.runs", 0);
  await P.setValue("labor.audio.pct", 18);
  ok(JSON.stringify(await P.loadWireLaborRules()) === JSON.stringify(wl231.defaultWireLaborRules()), "#231/#232: resetting restores the defaults (later suites see the defaults)");
}
```

Then insert this line immediately above the line ``  // Before the report and before the `.catch`, so a thrown suite is torn``:

```ts
  .then(() => wireLabor231AsyncChecks())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs > "$TMPDIR/specs.log" 2>&1; tail -5 "$TMPDIR/specs.log"`
Expected: the run aborts on the unresolved import `@/lib/design/wire-labor`.

- [ ] **Step 3: Create `src/lib/design/wire-labor.ts`**

```ts
/**
 * Wire pull (#231) and system labor (#232) — pure and client-safe: this
 * module has type-only imports (a #231 harness guard checks it).
 *
 * Wire pull, per wire system:
 *   feet = ⌈(stage width + stage depth + house depth) × runs × tier ×⌉
 * A missing dimension counts 0 and the line carries a note saying so. runs 0
 * (the default) emits no line at all. Footage is a QUANTITY: each system's
 * Equipment-map "Wire pull" row prices it (D303/D304), like any equation item.
 *
 * Labor, per system:
 *   labor = that system's priced material × labor % × tier ×
 * No tier chosen (a hand-built Grid design) → ×1.0. These multipliers are
 * LIVE and scale footage / labor only; the reference price multipliers
 * (system.tier*Cost / *Price, D304) stay inert.
 *
 * The rules are Estimating Rules (pricing.ts groups "wire" and "labor", the
 * general store); loadWireLaborRules() reads them on the server and
 * wireLaborRulesFrom() here is the one sanitizer.
 */
import type { SysKey, TierKey } from "@/app/(app)/design/quick/engine";

/* -------------------------------- the rules -------------------------------- */

export const WIRE_SYSTEMS = ["rigging", "lighting", "controls", "audio", "video"] as const;
export type WireSystem = (typeof WIRE_SYSTEMS)[number];

/** Every Quick Design system, plus "general" — Grid lines that belong to no system. */
export const LABOR_SYSTEMS = ["rigging", "curtains", "lighting", "controls", "acoustical", "pit", "audio", "video", "general"] as const;
export type LaborSystem = (typeof LABOR_SYSTEMS)[number];

export const LABOR_SYSTEM_LABEL: Record<LaborSystem, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  controls: "Controls",
  acoustical: "Acoustical",
  pit: "Pit",
  audio: "Audio",
  video: "Video",
  general: "General",
};

export type TierMults = Record<TierKey, number>;
export type WireRule = { runs: number; mult: TierMults };
/** `pct` is the percent number (18 = 18 %). */
export type LaborRule = { pct: number; mult: TierMults };
export type WireLaborRules = { wire: Record<WireSystem, WireRule>; labor: Record<LaborSystem, LaborRule> };

export const DEFAULT_TIER_MULTS: Readonly<TierMults> = Object.freeze({ good: 1, better: 1.15, best: 1.3 });
export const DEFAULT_RUNS = 0;
export const DEFAULT_LABOR_PCT = 18;
export const RUNS_MAX = 20;
export const LABOR_PCT_MAX = 60;
export const MULT_MAX = 3;
/** Typo guard on one typed labor amount, not a policy. */
export const LABOR_OVERRIDE_MAX = 10_000_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isWireSystem(k: unknown): k is WireSystem {
  return typeof k === "string" && (WIRE_SYSTEMS as readonly string[]).includes(k);
}

export function isLaborSystem(k: unknown): k is LaborSystem {
  return typeof k === "string" && (LABOR_SYSTEMS as readonly string[]).includes(k);
}

/** Estimating Rules id of one wire-pull knob: wire.<system>.runs | .good | .better | .best */
export function wireRateId(sys: WireSystem, field: "runs" | TierKey): string {
  return `wire.${sys}.${field}`;
}

/** Estimating Rules id of one labor knob: labor.<system>.pct | .good | .better | .best */
export function laborRateId(sys: LaborSystem, field: "pct" | TierKey): string {
  return `labor.${sys}.${field}`;
}

/**
 * The rules from stored rate values (`get(id)` → the raw stored value, or
 * undefined/null when unset). A missing, non-number, negative or non-finite
 * value is the default; a value above the rule's maximum is capped.
 */
export function wireLaborRulesFrom(get: (id: string) => unknown): WireLaborRules {
  const read = (id: string, def: number, max: number): number => {
    const raw = get(id);
    if (raw === null || raw === undefined) return def;
    const v = typeof raw === "number" ? raw : Number.NaN;
    return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : def;
  };
  const mults = (idOf: (t: TierKey) => string): TierMults => ({
    good: read(idOf("good"), DEFAULT_TIER_MULTS.good, MULT_MAX),
    better: read(idOf("better"), DEFAULT_TIER_MULTS.better, MULT_MAX),
    best: read(idOf("best"), DEFAULT_TIER_MULTS.best, MULT_MAX),
  });
  const wire = {} as Record<WireSystem, WireRule>;
  for (const s of WIRE_SYSTEMS) {
    wire[s] = { runs: read(wireRateId(s, "runs"), DEFAULT_RUNS, RUNS_MAX), mult: mults((t) => wireRateId(s, t)) };
  }
  const labor = {} as Record<LaborSystem, LaborRule>;
  for (const s of LABOR_SYSTEMS) {
    labor[s] = { pct: read(laborRateId(s, "pct"), DEFAULT_LABOR_PCT, LABOR_PCT_MAX), mult: mults((t) => laborRateId(s, t)) };
  }
  return { wire, labor };
}

export function defaultWireLaborRules(): WireLaborRules {
  return wireLaborRulesFrom(() => undefined);
}

/** The tier's multiplier; no tier (or a junk value) → 1. */
export function tierMult(m: TierMults | undefined, tier: TierKey | null | undefined): number {
  if (!m || !tier) return 1;
  const v = m[tier];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 1;
}

/* -------------------------------- wire pull -------------------------------- */

export const WIRE_PULL_ITEM = "wirePull";
export const WIRE_PULL_LABEL = "Wire pull";

export function wirePullKey(sys: WireSystem): string {
  return `${sys}:${WIRE_PULL_ITEM}`;
}

export type WireDimKey = "stageWidth" | "stageDepth" | "houseDepth";
export type WireDims = Partial<Record<WireDimKey, number | null>>;

const DIM_ORDER: readonly WireDimKey[] = ["stageWidth", "stageDepth", "houseDepth"];
const DIM_LABEL: Record<WireDimKey, string> = { stageWidth: "Stage width", stageDepth: "Stage depth", houseDepth: "House depth" };

/** Quick Design and the Grid intake carry a stage width and depth; neither has a house depth (it counts 0). */
export function wireDimsOf(s: { width?: number | null; depth?: number | null }): WireDims {
  return { stageWidth: s.width ?? null, stageDepth: s.depth ?? null, houseDepth: null };
}

/** One system's footage, rounded up to a whole foot, and the dimensions that counted as 0. */
export function wirePullFeet(
  dims: WireDims,
  rule: WireRule | undefined,
  tier: TierKey | null | undefined
): { feet: number; missing: WireDimKey[] } {
  const missing: WireDimKey[] = [];
  let base = 0;
  for (const k of DIM_ORDER) {
    const v = dims[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) base += v;
    else missing.push(k);
  }
  if (!rule || !Number.isFinite(rule.runs) || !(rule.runs > 0)) return { feet: 0, missing };
  // To the thousandth first, so float noise (161.00000000000003) never buys an extra foot.
  const raw = Math.round(base * rule.runs * tierMult(rule.mult, tier) * 1000) / 1000;
  return { feet: Math.ceil(raw), missing };
}

/** "House depth not entered — counted as 0 ft", or undefined when nothing is missing. */
export function wirePullNote(missing: readonly WireDimKey[]): string | undefined {
  if (!missing.length) return undefined;
  const names = missing.map((k) => DIM_LABEL[k]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} not entered — counted as 0 ft`;
}

/* ---------------------------------- labor ---------------------------------- */

/** labor % × the tier's multiplier, as a fraction of material. */
export function laborFrac(rule: LaborRule | undefined, tier: TierKey | null | undefined): number {
  if (!rule || !(rule.pct > 0)) return 0;
  return (rule.pct / 100) * tierMult(rule.mult, tier);
}

/** material × labor % × tier ×, to the cent. */
export function laborAmount(material: number, rule: LaborRule | undefined, tier: TierKey | null | undefined): number {
  return material > 0 ? round2(material * laborFrac(rule, tier)) : 0;
}

/** Quick Design's per-system labor fractions at one tier (tierTotals' labor argument). */
export function laborFracsFor(rules: WireLaborRules, tier: TierKey | null | undefined): Record<SysKey, number> {
  const out = {} as Record<SysKey, number>;
  for (const s of LABOR_SYSTEMS) if (s !== "general") out[s] = laborFrac(rules.labor[s], tier);
  return out;
}

/* ------------------------------ Grid labor lines ------------------------------ */

export const LABOR_SKU_PREFIX = "labor:";

export function laborSku(sys: LaborSystem): string {
  return LABOR_SKU_PREFIX + sys;
}

export function isLaborSku(sku: unknown): boolean {
  return typeof sku === "string" && sku.startsWith(LABOR_SKU_PREFIX);
}

export function laborLineDesc(sys: LaborSystem): string {
  return `Labor — ${LABOR_SYSTEM_LABEL[sys]}`;
}

/** Typed labor $ per system on one Grid option ($0 = left off the quote). */
export type LaborOverrides = Partial<Record<LaborSystem, number>>;

export function sanitizeLaborOverrides(raw: unknown): LaborOverrides {
  const out: LaborOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const s of LABOR_SYSTEMS) {
    const v = (raw as Record<string, unknown>)[s];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= LABOR_OVERRIDE_MAX) out[s] = round2(v);
  }
  return out;
}

/** Set (a number) or clear (null) one system's override. */
export function applyLaborOverride(cur: unknown, sys: LaborSystem, amount: number | null): LaborOverrides {
  const next = sanitizeLaborOverrides(cur);
  if (amount === null) delete next[sys];
  else next[sys] = round2(amount);
  return next;
}

const LAYER_TO_LABOR: Readonly<Record<string, LaborSystem>> = {
  Lighting: "lighting",
  Rigging: "rigging",
  Curtains: "curtains",
  Audio: "audio",
  Video: "video",
};

/** A Grid line's labor system: an Auto tag's scope first, then the part's Grid layer, else General. */
export function laborSystemOf(scope: string | null | undefined, layer: string | null | undefined): LaborSystem {
  if (scope && scope !== "general" && isLaborSystem(scope)) return scope;
  if (layer && Object.prototype.hasOwnProperty.call(LAYER_TO_LABOR, layer)) return LAYER_TO_LABOR[layer];
  return "general";
}

export type GridLaborLine = {
  system: LaborSystem;
  sku: string;
  desc: string;
  /** The system's priced material on this quote (sell). */
  material: number;
  pct: number;
  /** The tier multiplier applied — 1 when no tier is chosen. */
  mult: number;
  tier: TierKey | null;
  /** material × pct × mult, to the cent. */
  computed: number;
  /** What the quote carries: the typed override, else `computed`. */
  amount: number;
  overridden: boolean;
};

/** One line per system with material (or a typed override), in LABOR_SYSTEMS order. Sell numbers only. */
export function gridLaborLines(
  material: Partial<Record<LaborSystem, number>>,
  tierOf: (sys: LaborSystem) => TierKey | null,
  rules: WireLaborRules,
  overrides: LaborOverrides
): GridLaborLine[] {
  const out: GridLaborLine[] = [];
  for (const sys of LABOR_SYSTEMS) {
    const mat = round2(Math.max(0, material[sys] ?? 0));
    const ov = overrides[sys];
    if (!(mat > 0) && ov === undefined) continue;
    const rule = rules.labor[sys];
    const tier = tierOf(sys);
    const computed = laborAmount(mat, rule, tier);
    out.push({
      system: sys,
      sku: laborSku(sys),
      desc: laborLineDesc(sys),
      material: mat,
      pct: rule.pct,
      mult: tierMult(rule.mult, tier),
      tier,
      computed,
      amount: ov ?? computed,
      overridden: ov !== undefined,
    });
  }
  return out;
}
```

- [ ] **Step 4: Add the Estimating Rules groups and the loader in `src/lib/stores/pricing.ts`**

(a) After line 3 (`import { FLY_CREW_DEFAULTS, … } from "@/lib/travel-plan";`) add:

```ts
import {
  DEFAULT_LABOR_PCT,
  DEFAULT_RUNS,
  DEFAULT_TIER_MULTS,
  LABOR_PCT_MAX,
  LABOR_SYSTEMS,
  LABOR_SYSTEM_LABEL,
  MULT_MAX,
  RUNS_MAX,
  WIRE_SYSTEMS,
  laborRateId,
  wireLaborRulesFrom,
  wireRateId,
  type WireLaborRules,
} from "@/lib/design/wire-labor";
```

(b) Immediately above `export const GROUPS: PricingGroup[] = [` add:

```ts
/** #231/#232: one system's Good / Better / Best multiplier rates. */
function tierMultRates(idOf: (t: "good" | "better" | "best") => string, label: string): RateEntry[] {
  const name = { good: "Good", better: "Better", best: "Best" } as const;
  return (["good", "better", "best"] as const).map((t) =>
    rate(idOf(t), `${label} — ${name[t]} ×`, DEFAULT_TIER_MULTS[t], "×", { min: 0, max: MULT_MAX, step: 0.05 })
  );
}
```

(c) Replace the end of the `GROUPS` array. The old text:

```ts
    ],
  },
];

let BY_ID: Record<string, PricingEntry> = {};
```

becomes:

```ts
    ],
  },
  {
    key: "wire", label: "Wire pull", live: true,
    sub: "Per-system wire-pull footage by venue size × tier (#231)",
    note: "Live — Quick Design and Grid Auto estimates read these. 0 runs (the default) adds no Wire pull line. The footage is a quantity: each system's “Wire pull” row in Grid Settings → Equipment map prices it.",
    items: [
      ...WIRE_SYSTEMS.flatMap((sys) => [
        rate(wireRateId(sys, "runs"), `${LABOR_SYSTEM_LABEL[sys]} — runs`, DEFAULT_RUNS, "runs", { min: 0, max: RUNS_MAX, step: 1, help: "feet = (stage width + stage depth + house depth) × runs × tier ×. 0 = no wire pull for this system." }),
        ...tierMultRates((t) => wireRateId(sys, t), LABOR_SYSTEM_LABEL[sys]),
      ]),
      formula("wire.feet", "Wire pull footage", "feet = ⌈(stage width + stage depth + house depth) × runs × tier ×⌉ — a missing dimension counts 0 and the line says so"),
    ],
  },
  {
    key: "labor", label: "System labor", live: true,
    sub: "Per-system labor as a % of that system's material × tier (#232)",
    note: "Live — replaces the flat install % and the Grid's hours-per-device suggestion. Material = the system's priced equipment and wire pull. The tier is the design's (Quick Design) or the scope's Auto choice (the Grid); none chosen → ×1.0. General = Grid lines with no system.",
    items: [
      ...LABOR_SYSTEMS.flatMap((sys) => [
        rate(laborRateId(sys, "pct"), `${LABOR_SYSTEM_LABEL[sys]} — labor %`, DEFAULT_LABOR_PCT, "%", { min: 0, max: LABOR_PCT_MAX, step: 0.5, help: "labor = system material × this % × tier ×" }),
        ...tierMultRates((t) => laborRateId(sys, t), LABOR_SYSTEM_LABEL[sys]),
      ]),
      formula("labor.amount", "System labor", "labor = system material × labor % × tier ×  (Good / Better / Best; none chosen → ×1.0)"),
    ],
  },
];

let BY_ID: Record<string, PricingEntry> = {};
```

(d) After the `frac()` function add:

```ts
/** #231/#232: the wire-pull and system-labor rules, in ONE read of the general blob. */
export async function loadWireLaborRules(): Promise<WireLaborRules> {
  const g = await getBlob<Record<string, number | null>>(PRICING_RULES_BLOB, {});
  return wireLaborRulesFrom((id) => g[id]);
}
```

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit 2>&1 | tail -3
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npx eslint src/lib/design/wire-labor.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts
```
Expected: tsc 0 errors. PASS = **B + 23** (20 sync + 3 async), no FAIL. eslint 0 errors. There is no UI change, so `next build` is optional here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/wire-labor.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): wire pull + system labor rules in Estimating Rules (#231, #232)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Wire pull rows + pricing in Quick Design and Grid Auto (#231)

**Files:**
- Modify: `src/app/(app)/design/quick/engine.ts` (`BomItem` ~50–67)
- Modify: `src/lib/design/equipment-vocab.ts` (`EquipRowDef` 20–29; end of `EQUIPMENT_ROWS` ~101)
- Modify: `src/lib/design/wire-labor.ts` (import line; add `withWirePull`)
- Modify: `src/lib/design/equipment-pricing.ts` (imports; `tierSystemsBase` 89–98; `tierSystems` 101–110; `QuickRates` 136; `quickScreenPrice` 182; `quickDesignNeedsPart` 227–233)
- Modify: `src/lib/design/auto-estimate.ts` (imports; `AutoLine` 30–51; `autoEstimateCards` 80–135; `sellLine` 153–171)
- Modify: `src/lib/design/grid-auto-fill.ts` (imports; lines 42–45, 104–108, 118–130)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (import `getCatalogRates` line; `previewAutoEstimateAction` 167–170)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (import line 11; `Promise.all` 80–91; lines 117 and 129)
- Modify: `src/app/(app)/design/grid/[id]/equipment-card.tsx` (priced-line detail text ~205)
- Modify: `src/app/(app)/design/quick/page.tsx` (import line 9; `Promise.all` 39–48; `rates=` line 94)
- Modify: `src/app/(app)/design/quick/quick-design-client.tsx` (imports 35; prop type 121; `derived` block 193–231; `makeDesign` 261; BOM label 513)
- Modify: `src/lib/stores/design-pricing.ts` (import line 9; `quickRates` 55–62)
- Modify: `src/app/(app)/design/designs/page.tsx`, `src/app/(app)/design/designs/design-client.tsx`
- Test: `scripts/test-review-and-spec.ts` (#211 T1 ~17592–17617, #211 T3 ~17722 and ~17732, the #233 row-count check, new EOF block)

**Interfaces:**
- `EquipRowDef.derived?: "wirePull"`
- `BomItem.note?: string`
- `AutoLine.note?: string`
- `withWirePull(systems: SystemBlock[], dims: WireDims, tier: TierKey | null | undefined, rules: WireLaborRules): SystemBlock[]`
- `tierSystemsBase(C, s, tierKey, tierDefs, table, overrides = {}, rules = defaultWireLaborRules())`, and the same trailing `rules` on `tierSystems`
- `QuickRates.rules?: WireLaborRules`
- `quickDesignNeedsPart(d, table, fixturePrices, rules?)`
- `autoEstimateCards(rawInputs, est, table, overridePrices, rules = defaultWireLaborRules())`

- [ ] **Step 1: Update the vocabulary-count assertions (they will fail until Step 3)**

The vocabulary grows from 46 to 51 rows, and five of them come from the wire step, not `compute()`. First find every count assertion:

```bash
grep -n "=== 46\b\|=== 44\b" scripts/test-review-and-spec.ts
```

Apply these edits. Match on the quoted text; line numbers drift.

(a) #211 T1: `ok(keys.length === 46 && new Set(keys).size === 46, \`#211 T1: 46 unique equipment rows (got ${keys.length})\`);` becomes

```ts
  ok(keys.length === 51 && new Set(keys).size === 51, `#211 T1 + #231: 51 unique equipment rows — 46 equation rows + 5 Wire pull rows (got ${keys.length})`);
```

(b) #211 T1: `const never = keys.filter((k) => !emitted.has(k));` becomes

```ts
  const never = keys.filter((k) => !gemRowByKey1.get(k)!.derived && !emitted.has(k));
```

(c) #211 T1: `ok(keys.every((k) => gemHintText1(gemHints1[k]).startsWith("was ")), …` becomes

```ts
  ok(keys.filter((k) => !gemRowByKey1.get(k)!.derived).every((k) => gemHintText1(gemHints1[k]).startsWith("was ")), "#211 T1: every row carries its old built-in figure as a 'was' hint");
```

(d) #211 T3: `ok(empty.length === 46 && …` becomes `ok(empty.length === 51 && …`. Keep the rest of that line.

(e) #211 T3: `ok(s.mapped === 1 && s.allowance === 1 && s["needs-part"] === 44, …` becomes `… s["needs-part"] === 49, …`.

(f) #233 (from the sibling plan): in the assertion containing `r233Rows.length === 46`, replace that sub-expression with `r233Rows.filter((r) => !r.derived).length === 46`.

If the grep shows any other `=== 46` / `=== 44` that counts `EQUIPMENT_ROWS` or Equipment-map view rows, apply the same rule. Totals of all rows gain 5. "Needs a part" counts over an empty or partial map gain 5. Equation-only checks filter `!r.derived`.

- [ ] **Step 2: Write the new failing tests**

Append at the end of `scripts/test-review-and-spec.ts`:

```ts
/* --- #231 T2: Wire pull rows, the wire-pull step, and pricing through the Equipment map --- */
import { EQUIPMENT_ROWS as wp231Rows, EQUIPMENT_ROW_BY_KEY as wp231ByKey } from "@/lib/design/equipment-vocab";
import { compute as wp231Compute, defaultAState as wp231Default, tierDefsDefault as wp231TierDefs, withQtyOverride as wp231Ov, type AState as Wp231AState } from "@/app/(app)/design/quick/engine";
import { tierSystems as wp231TierSystems, quickScreenPrice as wp231Screen, quickDesignNeedsPart as wp231Needs } from "@/lib/design/equipment-pricing";
import { buildEquipmentPriceTable as wp231Table } from "@/lib/design/equipment-map";
import { autoEstimateCards as wp231Cards, autoQuoteNeedsPart as wp231AutoNeeds, sellOnlyCards as wp231Sell } from "@/lib/design/auto-estimate";
import { manualScopeInputs as wp231Inputs } from "@/lib/design/grid-intake";
{
  const WL = wl231;
  const wireRows = wp231Rows.filter((r) => r.derived === "wirePull");
  ok(wireRows.map((r) => r.key).join() === "rigging:wirePull,lighting:wirePull,controls:wirePull,audio:wirePull,video:wirePull" && wireRows.every((r) => r.label === WL.WIRE_PULL_LABEL && r.unit === "ft" && r.itemKey === WL.WIRE_PULL_ITEM),
    "#231: one Wire pull row per wire system, in feet");
  ok(wp231ByKey.get("controls:wirePull")!.place === "none" && wireRows.filter((r) => r.system !== "controls").every((r) => r.place === "lot"),
    "#231: Auto lands a Wire pull as one lot marker (Controls is never Auto-placed)");
  const stored: Record<string, unknown> = { "wire.lighting.runs": 2, "wire.rigging.runs": 1 };
  const rules = WL.wireLaborRulesFrom((id) => stored[id]);
  const base = wp231Default(0);
  const s: Wp231AState = {
    ...base, venue: "school", size: "medium", width: 40, depth: 30, grid: 24, wing: 12, ph: 20, rigType: "counterweight", tier: "better",
    sys: { ...base.sys, rigging: true, curtains: false, lighting: true, controls: false, audio: true, video: false, acoustical: false, pit: false },
  };
  const C = wp231Compute(s);
  const stepped = WL.withWirePull(C.systems, WL.wireDimsOf(s), "better", rules);
  const wire = (k: string) => stepped.find((x) => x.key === k)!.items.find((i) => i.key === `${k}:wirePull`);
  ok(wire("lighting")?.qty === 161 && wire("lighting")?.unit === "ft" && wire("lighting")?.note === "House depth not entered — counted as 0 ft",
    `#231: Lighting pulls (40 + 30 + 0) × 2 runs × 1.15 = 161 ft, noting the missing house depth (${wire("lighting")?.qty})`);
  ok(wire("rigging")?.qty === 81 && !wire("audio") && !wire("controls"), "#231: Rigging 70 × 1 × 1.15 → 81 ft; 0 runs (Audio) and an off system (Controls) get no line");
  ok(WL.withWirePull(C.systems, WL.wireDimsOf(s), "better", WL.defaultWireLaborRules()).every((x, i) => x === C.systems[i]), "#231: the default rules (0 runs everywhere) change nothing");
  ok(WL.withWirePull(stepped, WL.wireDimsOf(s), "good", rules).find((x) => x.key === "lighting")!.items.filter((i) => i.key === "lighting:wirePull").map((i) => i.qty).join() === "140",
    "#231: re-running the step replaces the line (Good: 140 ft)");
  const parts = new Map([["WP-DMX", { sku: "WP-DMX", desc: "DMX cable", unit: "ft", cost: 1, list: 1.5, category: "Wire & Cable" }]]);
  const ctx = { parts, fixtures: new Map(), margin: 0.3 };
  const mapped = wp231Table({ "lighting:wirePull": { tiers: { good: { kind: "part", sku: "WP-DMX" } }, sameAll: true, updatedBy: "t", updatedAt: 1 } }, ctx);
  const priced = wp231TierSystems(C, s, "better", wp231TierDefs(), mapped, {}, rules);
  const pl = priced.find((x) => x.key === "lighting")!.items.find((i) => i.key === "lighting:wirePull")!;
  ok(pl.status === "part" && pl.price === 1.5 && pl.qty === 161 && pl.ref === "WP-DMX", "#231: the Wire pull row prices from its mapped per-ft part");
  const rw = priced.find((x) => x.key === "rigging")!.items.find((i) => i.key === "rigging:wirePull")!;
  ok(rw.status === "needs-part" && rw.price === 0, "#231: an unmapped Wire pull row is needs-a-part — never a fallback number (D310)");
  const noneTable = wp231Table({ "rigging:wirePull": { tiers: { good: { kind: "none" } }, sameAll: true, updatedBy: "t", updatedAt: 1 } }, ctx);
  const rn = wp231TierSystems(C, s, "better", wp231TierDefs(), noneTable, {}, rules).find((x) => x.key === "rigging")!.items.find((i) => i.key === "rigging:wirePull")!;
  ok(rn.status !== "needs-part" && rn.price === 0 && rn.cost === 0, "#231 + #229: a Wire pull row set to Not included resolves at $0");
  const ovS = { ...s, qtyOverrides: wp231Ov(s.qtyOverrides, "better", "lighting", "Wire pull", "200") };
  ok(wp231TierSystems(wp231Compute(ovS), ovS, "better", wp231TierDefs(), mapped, {}, rules).find((x) => x.key === "lighting")!.items.find((i) => i.key === "lighting:wirePull")!.qty === 200,
    "#231: Quick Design's per-tier qty override edits the Wire pull footage");
  const allAllow = {
    margin: 0.3,
    byTier: Object.fromEntries((["good", "better", "best"] as const).map((t) => [t, Object.fromEntries(wp231Rows.filter((r) => !r.derived).map((r) => [r.key, { status: "allowance" as const, ref: r.key, desc: r.label, unit: r.unit, unitCost: 10, unitSell: 14.29 }]))])) as never,
  };
  const qr0 = { installPct: 18, freightPct: 5, contingencyPct: 10 };
  const qr1 = { ...qr0, rules };
  const r0 = wp231Screen(s, wp231TierDefs(), allAllow, {}, qr0);
  const r1 = wp231Screen(s, wp231TierDefs(), allAllow, {}, qr1);
  ok(r0.needsPart === 0 && r1.needsPart === 2, `#231: with runs set, the unmapped Wire pull rows make a Quick design Incomplete (${r1.needsPart})`);
  const rec = { tier: "better", config: { ...s } as unknown as Record<string, unknown> };
  ok(wp231Needs(rec, allAllow, {}, rules) === 2 && wp231Needs(rec, allAllow, {}) === 0, "#231: the server's needs-a-part count reads the same rules");
  const inputs = { ...wp231Inputs(s), sys: s.sys };
  const est = { tierByScope: { rigging: "best" as const, lighting: "better" as const, audio: "better" as const }, overrides: {} };
  const cards = wp231Cards(inputs, est, mapped, {}, rules);
  const lw = cards.find((c) => c.scope === "lighting")!.lines.find((l) => l.rowKey === "lighting:wirePull")!;
  const rwc = cards.find((c) => c.scope === "rigging")!.lines.find((l) => l.rowKey === "rigging:wirePull")!;
  ok(lw.qty === 161 && lw.status === "part" && lw.total === 241.5 && lw.note === "House depth not entered — counted as 0 ft" && lw.place === "lot",
    "#231: the Auto Lighting card carries the Wire pull at its tier, priced and noted");
  ok(rwc.qty === 91 && rwc.status === "needs-part" && wp231AutoNeeds(cards, est) >= 1, "#231: Rigging at Best pulls 70 × 1 × 1.3 = 91 ft; unmapped, it counts toward the D322 quote gate");
  ok(wp231Sell(cards).find((c) => c.scope === "lighting")!.lines.some((l) => l.rowKey === "lighting:wirePull" && !!l.note), "#231: the sell-only card keeps the note");
  ok(!wp231Cards(inputs, est, mapped, {}).some((c) => c.lines.some((l) => l.rowKey.endsWith(":wirePull"))), "#231: the default rules → no Wire pull on any card");
  const rd = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  ok(rd("src/app/(app)/design/grid/[id]/page.tsx").includes("loadWireLaborRules()") && rd("src/app/(app)/design/grid/[id]/actions.ts").includes("loadWireLaborRules()") &&
      (rd("src/lib/design/grid-auto-fill.ts").match(/loadWireLaborRules\(\)/g) || []).length === 3 && rd("src/lib/stores/design-pricing.ts").includes("loadWireLaborRules()") &&
      rd("src/app/(app)/design/quick/page.tsx").includes("loadWireLaborRules()") && rd("src/app/(app)/design/designs/page.tsx").includes("loadWireLaborRules()"),
    "#231: every server path that prices an estimate loads the wire rules");
}
```

Run: `npm run test:specs > "$TMPDIR/specs.log" 2>&1; tail -5 "$TMPDIR/specs.log"`
Expected: tsc-level failures under tsx (`withWirePull` / `derived` missing), or FAILs. Either way, not green.

- [ ] **Step 3: `BomItem.note` in `src/app/(app)/design/quick/engine.ts`**

Replace

```ts
  /** Curtain drapes only: the geometry the per-drape cost is computed from. */
  drape?: DrapeGeom;
};
```

with

```ts
  /** Curtain drapes only: the geometry the per-drape cost is computed from. */
  drape?: DrapeGeom;
  /** #231: the line's caveat (e.g. a venue dimension counted as 0), shown next to the item. */
  note?: string;
};
```

- [ ] **Step 4: Wire pull rows in `src/lib/design/equipment-vocab.ts`**

(a) In `EquipRowDef`, after `curtain?: CurtainRowType;` add:

```ts
  /** #231: emitted by the wire-pull step (wire-labor.ts withWirePull), not by compute(). */
  derived?: "wirePull";
```

(b) After the `row()` function add:

```ts
/** #231: a wire system's "Wire pull" row — footage from venue size × runs × tier (wire-labor.ts). */
function wireRow(system: SysKey, place: EquipPlace, search: string[]): EquipRowDef {
  return { key: `${system}:wirePull`, system, itemKey: "wirePull", label: "Wire pull", unit: "ft", place, search, derived: "wirePull" };
}
```

(c) Replace the last entry and the closing bracket of `EQUIPMENT_ROWS`:

```ts
  row("pit", "clearspan", "Clear-span pit filler deck", "sqft", "none", ["pit", "deck"]),
];
```

with

```ts
  row("pit", "clearspan", "Clear-span pit filler deck", "sqft", "none", ["pit", "deck"]),
  // Wire pull (#231) — one per wire system. The Equipment map groups rows by
  // system, so each lands at the end of its own system's group.
  wireRow("rigging", "lot", ["wire rope", "cable"]),
  wireRow("lighting", "lot", ["dmx", "cable", "wire"]),
  wireRow("controls", "none", ["network", "cable", "wire"]),
  wireRow("audio", "lot", ["speaker cable", "cable", "wire"]),
  wireRow("video", "lot", ["sdi", "hdmi", "cable"]),
];
```

- [ ] **Step 5: The wire-pull step in `src/lib/design/wire-labor.ts`**

(a) Change the import line to:

```ts
import type { BomItem, SysKey, SystemBlock, TierKey } from "@/app/(app)/design/quick/engine";
```

(b) After `wirePullNote` add:

```ts
/**
 * The wire-pull step (#231) — a QUANTITY step, like scaleSets. Each wire
 * system that is on gets one "Wire pull" item (feet, no dollars) when its
 * rule yields footage, replacing any it already had. Runs between line-set
 * scaling and map pricing. A system it doesn't touch comes back as the same
 * object.
 */
export function withWirePull(
  systems: SystemBlock[],
  dims: WireDims,
  tier: TierKey | null | undefined,
  rules: WireLaborRules
): SystemBlock[] {
  return systems.map((sys) => {
    if (!isWireSystem(sys.key)) return sys;
    const key = wirePullKey(sys.key);
    const kept = sys.items.filter((it) => it.key !== key);
    const { feet, missing } = sys.on ? wirePullFeet(dims, rules.wire[sys.key], tier) : { feet: 0, missing: [] as WireDimKey[] };
    if (!(feet > 0)) return kept.length === sys.items.length ? sys : { ...sys, items: kept };
    const note = wirePullNote(missing);
    const item: BomItem = { key, desc: WIRE_PULL_LABEL, unit: "ft", qty: feet, cost: 0, price: 0, ...(note ? { note } : {}) };
    return { ...sys, items: [...kept, item] };
  });
}
```

- [ ] **Step 6: Thread the rules through `src/lib/design/equipment-pricing.ts`**

(a) After the `needsPartCount` import add:

```ts
import { defaultWireLaborRules, wireDimsOf, withWirePull, type WireLaborRules } from "./wire-labor";
```

(b) Replace `tierSystemsBase` and `tierSystems` (with their doc comments):

```ts
/** The BOM's base rows for a tier: line-set scaling → wire pull (#231) → map pricing (no qty overrides). */
export function tierSystemsBase(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {},
  /** Wire-pull rules (#231) — the defaults (0 runs) add nothing. */
  rules: WireLaborRules = defaultWireLaborRules()
): SystemBlock[] {
  const sized = withWirePull(scaleSets(C.systems, C, tierKey, tierDefs), wireDimsOf(s), tierKey, rules);
  return applyEquipment(sized, tierKey, table, overrides);
}

/** The full per-tier pipeline: line-set scaling → wire pull → map pricing → the tier's qty overrides. */
export function tierSystems(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {},
  rules: WireLaborRules = defaultWireLaborRules()
): SystemBlock[] {
  return applyOverrides(tierSystemsBase(C, s, tierKey, tierDefs, table, overrides, rules), s, tierKey);
}
```

(c) Replace `export type QuickRates = { installPct: number; freightPct: number; contingencyPct: number };` with:

```ts
export type QuickRates = {
  installPct: number;
  freightPct: number;
  contingencyPct: number;
  /** Wire-pull + system-labor rules (#231/#232); absent = the defaults. */
  rules?: WireLaborRules;
};
```

(d) In `quickScreenPrice` replace

```ts
  const base = tierSystemsBase(compute(a), a, tier, tierDefs, table, fixtureOverridesFor(a.fixtureAssemblies, fixturePrices));
```

with

```ts
  const base = tierSystemsBase(compute(a), a, tier, tierDefs, table, fixtureOverridesFor(a.fixtureAssemblies, fixturePrices), rates.rules ?? defaultWireLaborRules());
```

(e) Replace `quickDesignNeedsPart`:

```ts
/** The needs-a-part half of quickDesignPrice (D319) — with the wire rules when the caller has them (#231). */
export function quickDesignNeedsPart(
  d: DesignRecordLike,
  table: EquipmentPriceTable,
  fixturePrices: Record<string, UnitPrice>,
  rules?: WireLaborRules
): number {
  return quickDesignPrice(d, table, fixturePrices, { installPct: 0, freightPct: 0, contingencyPct: 0, rules }).needsPart;
}
```

- [ ] **Step 7: Auto cards in `src/lib/design/auto-estimate.ts`**

(a) After `import { applyEquipment } from "./equipment-pricing";` add:

```ts
import { defaultWireLaborRules, wireDimsOf, withWirePull, type WireLaborRules } from "./wire-labor";
```

(b) In `AutoLine`, after `drape?: DrapeGeom;` add:

```ts
  /** #231: the line's caveat (a venue dimension counted as 0). */
  note?: string;
```

(c) `autoEstimateCards`:
- Add a trailing parameter `rules: WireLaborRules = defaultWireLaborRules()` after `overridePrices: Record<string, UnitPrice>`.
- Replace `const [priced] = applyEquipment([sys], tier, table, overridePrices);` with:

```ts
    const [sized] = withWirePull([sys], wireDimsOf(s), tier, rules);
    const [priced] = applyEquipment([sized], tier, table, overridePrices);
```

- In the `lines.push({ … })` literal, after `...(it.drape ? { drape: it.drape } : {}),` add `...(it.note ? { note: it.note } : {}),`.

(d) In `sellLine`, after `...(l.drape ? { drape: l.drape } : {}),` add `...(l.note ? { note: l.note } : {}),`.

- [ ] **Step 8: Every server caller loads and passes the rules**

(a) `src/lib/design/grid-auto-fill.ts`: after the `loadEquipPriceCtx` import add `import { loadWireLaborRules } from "@/lib/stores/pricing";`. Then:
- In `fillAutoScopes` replace

```ts
  const { map, ctx, catalogParts } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  const cards = autoEstimateCards(inputs, est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx)).filter((c) =>
```

  with

```ts
  const [{ map, ctx, catalogParts }, rules] = await Promise.all([
    loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds }),
    loadWireLaborRules(),
  ]);
  const cards = autoEstimateCards(inputs, est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx), rules).filter((c) =>
```

- In `autoNeedsPart` replace its last two lines with

```ts
  const [{ map, ctx }, rules] = await Promise.all([loaded ? Promise.resolve(loaded) : loadAutoNeedsCtx([{ project, optionId }]), loadWireLaborRules()]);
  return autoQuoteNeedsPart(autoEstimateCards(c.inputs, c.est, buildEquipmentPriceTable(map, ctx), priceOverrides(c.est.overrides, ctx), rules), c.est);
```

- In `autoNeedsPartMany` replace `const loaded = preloaded ?? (await loadAutoNeedsCtx(items.filter((_, i) => isAuto[i])));` with

```ts
  const [loaded, rules] = await Promise.all([
    preloaded ? Promise.resolve(preloaded) : loadAutoNeedsCtx(items.filter((_, i) => isAuto[i])),
    loadWireLaborRules(),
  ]);
```

  and in its `return` pass `rules` as the fifth argument to `autoEstimateCards(…)`.

(b) `src/app/(app)/design/grid/[id]/actions.ts`: change `import { getCatalogRates } from "@/lib/stores/pricing";` to `import { getCatalogRates, loadWireLaborRules } from "@/lib/stores/pricing";`. In `previewAutoEstimateAction` replace

```ts
  const { map, ctx } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  const cards = autoEstimateCards(clampScopeInputs(input.inputs), est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx));
```

with

```ts
  const [{ map, ctx }, rules] = await Promise.all([
    loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds }),
    loadWireLaborRules(),
  ]);
  const cards = autoEstimateCards(clampScopeInputs(input.inputs), est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx), rules);
```

(c) `src/app/(app)/design/grid/[id]/page.tsx`:
- Change `import { num } from "@/lib/stores/pricing";` to `import { loadWireLaborRules, num } from "@/lib/stores/pricing";`.
- In the first `Promise.all`, add `wireLabor` as the last destructured name and `loadWireLaborRules(),` as the last array entry after `listDesigns({ kind: "lineset" }),`.
- Replace `(s, t) => tierSystems(compute(s), s, t, tierDefsDefault(), equipTable)` with `(s, t) => tierSystems(compute(s), s, t, tierDefsDefault(), equipTable, {}, wireLabor)`.
- Replace `autoEstimateCards(project.scopeInputs, optionAutoEstimate, equipTable, priceOverrides(optionAutoEstimate.overrides, equipCtx))` with `autoEstimateCards(project.scopeInputs, optionAutoEstimate, equipTable, priceOverrides(optionAutoEstimate.overrides, equipCtx), wireLabor)`.

(d) `src/lib/stores/design-pricing.ts`: change `import { num } from "@/lib/stores/pricing";` to `import { loadWireLaborRules, num } from "@/lib/stores/pricing";` and replace `quickRates`:

```ts
/** The pricing-rule percentages and the wire/labor rules Quick Design totals with (its page reads the same keys). */
async function quickRates(): Promise<QuickRates> {
  const [installPct, freightPct, contingencyPct, rules] = await Promise.all([
    num("system.installPct", 18),
    num("system.freightPct", 5),
    num("system.contingencyPct", 10),
    loadWireLaborRules(),
  ]);
  return { installPct, freightPct, contingencyPct, rules };
}
```

(e) `src/app/(app)/design/quick/page.tsx`:
- Change `import { num } from "@/lib/stores/pricing";` to `import { loadWireLaborRules, num } from "@/lib/stores/pricing";`.
- Add `wireLabor` as the last destructured name of the `Promise.all` and `loadWireLaborRules(),` after `catalogList(),`.
- Change `rates={{ installPct, freightPct, contingencyPct }}` to `rates={{ installPct, freightPct, contingencyPct, rules: wireLabor }}`.

(f) `src/app/(app)/design/designs/page.tsx`:
- Add `import { loadWireLaborRules } from "@/lib/stores/pricing";`.
- Add `wireLabor` as the last destructured name and `loadWireLaborRules(),` after `taskTemplateSetsFor("design"),`.
- Pass `wireLabor={wireLabor}` to `<DesignClient` after `prices={prices}`.

(g) `src/app/(app)/design/designs/design-client.tsx`:
- Add `import type { WireLaborRules } from "@/lib/design/wire-labor";`.
- Destructure `wireLabor,` after `prices,`, and type it `wireLabor: WireLaborRules;` after `prices: EquipmentPriceTable;`.
- Replace `const systems = tierSystems(C, s, tierKey, defs, prices);` with `const systems = tierSystems(C, s, tierKey, defs, prices, {}, wireLabor);`.
- Change that `useMemo`'s deps `[sel, tierDefs, prices, accentHex]` to `[sel, tierDefs, prices, wireLabor, accentHex]`.

- [ ] **Step 9: Quick Design client (`src/app/(app)/design/quick/quick-design-client.tsx`)**

(a) Change `import { fixtureOverridesFor, quickSaveConfig, tierDefsFor, tierSystems, tierSystemsBase } from "@/lib/design/equipment-pricing";` to

```ts
import { fixtureOverridesFor, quickSaveConfig, tierDefsFor, tierSystems, tierSystemsBase, type QuickRates } from "@/lib/design/equipment-pricing";
import { defaultWireLaborRules } from "@/lib/design/wire-labor";
```

(b) Prop type: change `rates: { installPct: number; freightPct: number; contingencyPct: number };` to `rates: QuickRates;`.

(c) After `const contPct = (a.contingency ?? 0) / 100;` add:

```ts
  /** Wire-pull + system-labor rules (#231/#232), read on the server. */
  const wireLabor = useMemo(() => rates.rules ?? defaultWireLaborRules(), [rates.rules]);
```

(d) Pass the rules through every pipeline call:
- `() => tierSystemsBase(C, a, selKey, tierDefs, prices, fixtureOverrides),` becomes `() => tierSystemsBase(C, a, selKey, tierDefs, prices, fixtureOverrides, wireLabor),`, and its deps `[C, a, selKey, tierDefs, prices, fixtureOverrides]` become `[C, a, selKey, tierDefs, prices, fixtureOverrides, wireLabor]`.
- In `tierCards`, `tierSystems(C, a, td.key, tierDefs, prices, fixtureOverrides)` becomes `tierSystems(C, a, td.key, tierDefs, prices, fixtureOverrides, wireLabor)`. Add `wireLabor` to that `useMemo`'s deps.
- In `makeDesign`, `tierSystems(Cx, s, td.key, tierDefs, prices, fixtureOverrides)` becomes `tierSystems(Cx, s, td.key, tierDefs, prices, fixtureOverrides, wireLabor)`.

(e) BOM label: append the note to the end of the `const label = …;` expression in `bomGroups` (as of writing: `… + (it.status === "allowance" ? " · Allowance" : "");`):

```ts
        const label = (it.refDesc && it.status !== "allowance" ? `${it.desc} — ${it.refDesc}` : it.desc) + (it.status === "allowance" ? " · Allowance" : "") + (it.note ? ` · ${it.note}` : "");
```

If #229 changed that line, keep its change and only append `+ (it.note ? \` · ${it.note}\` : "")` before the `;`.

- [ ] **Step 10: Equipment card note (`src/app/(app)/design/grid/[id]/equipment-card.tsx`)**

In the priced-line detail text (as of writing `` `${l.refDesc ?? l.ref ?? ""}${l.swapped ? " · swapped for this design" : ""}` ``), append the note:

```tsx
                    `${l.refDesc ?? l.ref ?? ""}${l.swapped ? " · swapped for this design" : ""}${l.note ? ` · ${l.note}` : ""}`
```

If #229 turned that branch into a ternary with "Not included in this tier", append `${l.note ? \` · ${l.note}\` : ""}` inside the priced (part/assembly/allowance) template only.

- [ ] **Step 11: Run the gates**

```bash
npx tsc --noEmit 2>&1 | tail -3
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npx eslint "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-vocab.ts src/lib/design/wire-labor.ts src/lib/design/equipment-pricing.ts src/lib/design/auto-estimate.ts src/lib/design/grid-auto-fill.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/equipment-card.tsx" "src/app/(app)/design/quick/page.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" src/lib/stores/design-pricing.ts "src/app/(app)/design/designs/page.tsx" "src/app/(app)/design/designs/design-client.tsx" scripts/test-review-and-spec.ts
lsof -i :3000; npx next build 2>&1 | tail -5
```
Expected: tsc 0. PASS = Task 1's count + **17**, no FAIL. The Step 1 edits change existing assertions, not their count. eslint 0 errors. Build exit 0.

- [ ] **Step 12: Commit**

```bash
git add "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-vocab.ts src/lib/design/wire-labor.ts src/lib/design/equipment-pricing.ts src/lib/design/auto-estimate.ts src/lib/design/grid-auto-fill.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/equipment-card.tsx" "src/app/(app)/design/quick/page.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" src/lib/stores/design-pricing.ts "src/app/(app)/design/designs/page.tsx" "src/app/(app)/design/designs/design-client.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(grid): wire pull per system, priced through the Equipment map (#231)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Labor per system in Quick Design and on Auto cards (#232)

**Files:**
- Modify: `src/app/(app)/design/quick/engine.ts` (`tierTotals` 638–669)
- Modify: `src/lib/design/equipment-pricing.ts` (`QuickRates`; add `systemLabor`; `quickScreenPrice`; `quickDesignNeedsPart`)
- Modify: `src/lib/design/auto-estimate.ts` (`AutoCard` 52; `cards.push` 125–132; `sellOnlyCards` 174–176)
- Modify: `src/app/(app)/design/grid/[id]/equipment-card.tsx` (after the lines grid; `EquipmentCards` footer)
- Modify: `src/app/(app)/design/quick/page.tsx`, `src/app/(app)/design/quick/quick-design-client.tsx`, `src/lib/stores/design-pricing.ts`
- Modify: `src/lib/stores/pricing.ts` (`system` group: drop `system.installPct`, note, `system.rollup`; `frac` doc comment)
- Test: `scripts/test-review-and-spec.ts` (#211 wave 2 ~18567; #211 wave 3 ~18629; new EOF block)

**Interfaces:**
- `tierTotals(systems, td, laborPct: number | Partial<Record<SysKey, number>>, freightPct, contPct)`
- `QuickRates = { freightPct; contingencyPct; rules? }`, with `installPct` removed
- `SystemLaborRow = { key: SysKey; name: string; material: number; pct: number; mult: number; amount: number }`
- `systemLabor(systems, tierKey, rules?)`
- `AutoCard.labor: number`, `AutoCard.laborRule: { pct: number; mult: number }` (so also on `SellCard`)

- [ ] **Step 1: Update the two Quick-total assertions and write the new tests**

(a) #211 wave 2 (`const screen = gemW2Totals(gemW2TierSystems(gemW2Compute(s0), s0, "better", gemW2TierDefs(s0), table, {}), gemW2Tiers[1], 0.18, 0.05, 0.1).grand;`): replace `gemW2Tiers[1], 0.18, 0.05, 0.1` with `gemW2Tiers[1], wl231.laborFracsFor(wl231.defaultWireLaborRules(), "better"), 0.05, 0.1`.

(b) #211 wave 3: replace

```ts
  ok(screen.budget === 13321 && calc.budget === 16125, `#211 wave 3 I1: the reviewer's figures reproduce — 13321 on the screen, 16125 when the edit is dropped (${screen.budget} / ${calc.budget})`);
```

with

```ts
  ok(screen.budget === 13614 && calc.budget === 16479, `#211 wave 3 I1 + #232: the reviewer's figures at per-system Better labor (18% × 1.15) — 13614 on the screen, 16479 when the edit is dropped; were 13321 / 16125 at a flat 18% (${screen.budget} / ${calc.budget})`);
```

These figures were computed on the pre-change code with install = `Math.round(matRev × 0.207)`: matRev 9,845.81 / 11,917.86. If the harness prints a different pair, compare `matRev × 0.207` from the printed totals before touching the numbers.

(c) Append at the end of the file:

```ts
/* --- #232 T3: Quick Design labor per system; Auto cards carry labor --- */
import { tierTotals as lb232Totals, TIERS as lb232Tiers, defaultAState as lb232Default, compute as lb232Compute, tierDefsDefault as lb232TierDefs, type AState as Lb232AState } from "@/app/(app)/design/quick/engine";
import { tierSystems as lb232TierSystems, systemLabor as lb232SystemLabor, quickScreenPrice as lb232Screen } from "@/lib/design/equipment-pricing";
import { autoEstimateCards as lb232Cards, sellOnlyCards as lb232Sell } from "@/lib/design/auto-estimate";
import { manualScopeInputs as lb232Inputs } from "@/lib/design/grid-intake";
import { EQUIPMENT_ROWS as lb232Rows } from "@/lib/design/equipment-vocab";
{
  const d = wl231.defaultWireLaborRules();
  const table = {
    margin: 0.3,
    byTier: Object.fromEntries((["good", "better", "best"] as const).map((t) => [t, Object.fromEntries(lb232Rows.map((r) => [r.key, { status: "allowance" as const, ref: r.key, desc: r.label, unit: r.unit, unitCost: 10, unitSell: 14.29 }]))])) as never,
  };
  const a: Lb232AState = { ...lb232Default(10), tier: "better" };
  const sys = lb232TierSystems(lb232Compute(a), a, "better", lb232TierDefs(), table, {}, d);
  const flat = lb232Totals(sys, lb232Tiers[1], 0.18, 0.05, 0.1);
  const good = lb232Totals(sys, lb232Tiers[1], wl231.laborFracsFor(d, "good"), 0.05, 0.1);
  ok(good.install === flat.install && good.grand === flat.grand, `#232: at Good, per-system labor equals today's flat 18% install (${good.install} vs ${flat.install})`);
  const better = lb232Totals(sys, lb232Tiers[1], wl231.laborFracsFor(d, "better"), 0.05, 0.1);
  ok(better.install === Math.round(flat.matRev * 0.18 * 1.15) && better.matRev === flat.matRev, `#232: Better labor = materials × 18% × 1.15 (${better.install})`);
  const customStored: Record<string, unknown> = { "labor.pit.pct": 0, "labor.curtains.better": 2 };
  const custom = wl231.wireLaborRulesFrom((id) => customStored[id]);
  const rows = lb232SystemLabor(sys, "better", custom);
  const pit = rows.find((r) => r.key === "pit");
  const cur = rows.find((r) => r.key === "curtains")!;
  ok(!!pit && pit.amount === 0 && Math.abs(cur.amount - cur.material * 0.18 * 2) < 1e-9 && cur.mult === 2 && cur.pct === 18, "#232: each system uses its own labor % and tier multiplier");
  const perSys = lb232Totals(sys, lb232Tiers[1], wl231.laborFracsFor(custom, "better"), 0.05, 0.1);
  ok(perSys.install === Math.round(rows.reduce((n, r) => n + r.amount, 0)), "#232: the Labor row is the sum of the per-system breakdown");
  const q = lb232Screen(a, lb232TierDefs(), table, {}, { freightPct: 5, contingencyPct: 10, rules: d });
  ok(q.budget === Math.round(better.grand), `#232: quickScreenPrice totals with per-system labor at the design's tier (${q.budget})`);
  const s: Lb232AState = {
    ...lb232Default(0), venue: "school", size: "medium", width: 40, depth: 30, grid: 24, wing: 12, ph: 20, rigType: "counterweight",
    sys: { rigging: false, curtains: false, lighting: true, controls: false, audio: true, video: false, acoustical: false, pit: false },
  };
  const cards = lb232Cards({ ...lb232Inputs(s), sys: s.sys }, { tierByScope: { lighting: "best", audio: "good" }, overrides: {} }, table, {}, d);
  const lc = cards.find((c) => c.scope === "lighting")!;
  const ac = cards.find((c) => c.scope === "audio")!;
  ok(lc.total > 0 && Math.abs(lc.labor - lc.total * 0.18 * 1.3) < 0.006 && lc.laborRule.pct === 18 && lc.laborRule.mult === 1.3 && ac.laborRule.mult === 1,
    "#232: each Auto card carries its scope's labor at the card's tier");
  ok(Math.abs(lc.total - lc.lines.reduce((n, l) => n + l.total, 0)) < 0.005, "#232: a card's total stays equipment only (the Scope panel target is unchanged)");
  ok(lb232Sell(cards)[0].labor === cards[0].labor && lb232Sell(cards)[0].laborRule.pct === cards[0].laborRule.pct, "#232: the sell-only card keeps its labor");
  const rd = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const ids = new Set(wl231Groups.flatMap((g) => g.items.map((it) => it.id)));
  ok(!ids.has("system.installPct") && !rd("src/app/(app)/design/quick/page.tsx").includes("system.installPct") && !rd("src/lib/stores/design-pricing.ts").includes("system.installPct"),
    "#232: the flat install % is retired — Quick Design reads System labor");
  const qc = rd("src/app/(app)/design/quick/quick-design-client.tsx");
  ok(qc.includes("laborFracsFor(wireLabor, selKey)") && qc.includes("systemLabor(selSystems, selKey, wireLabor)") && qc.includes("Labor (per system)"), "#232: Quick Design's Estimate tab shows labor per system");
  const card = rd("src/app/(app)/design/grid/[id]/equipment-card.tsx");
  ok(card.includes("card.labor") && card.includes("card.laborRule.pct"), "#232: the Auto Equipment card shows its calculated labor");
}
```

Also check whether any harness block builds an `AutoCard` / `SellCard` object literal. It would now need `labor` and `laborRule`:

```bash
grep -n "allowances: [0-9]" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
```

For each full-card literal found, add `labor: 0, laborRule: { pct: 18, mult: 1 },`.

Run the specs and expect failures (`systemLabor` missing).

- [ ] **Step 2: `tierTotals` in `src/app/(app)/design/quick/engine.ts`**

Replace the whole function:

```ts
export function tierTotals(
  systems: SystemBlock[],
  td: TierMeta,
  /** Labor as a fraction of materials — one flat fraction, or per system
   *  (#232: laborFracsFor = labor % × the tier's multiplier). One rounding
   *  either way, so a uniform per-system 18 % equals the flat 18 %. */
  laborPct: number | Partial<Record<SysKey, number>>,
  freightPct: number,
  contPct: number
): TierTotals {
  let matRev = 0;
  let matCost = 0;
  let laborBase = 0;
  systems.forEach((x) => {
    if (x.on) {
      const pm = x.tierFixed ? 1 : td.priceMul;
      const cm = x.tierFixed ? 1 : td.costMul;
      matRev += x.rev * pm;
      matCost += x.cost * cm;
      if (typeof laborPct !== "number") laborBase += x.rev * pm * (laborPct[x.key] ?? 0);
    }
  });
  const install = Math.round(typeof laborPct === "number" ? matRev * laborPct : laborBase);
  const freight = Math.round(matRev * freightPct);
  const subtotal = matRev + install + freight;
  const contingency = Math.round(subtotal * (contPct || 0));
  return {
    matRev,
    matCost,
    install,
    freight,
    contingency,
    grand: subtotal + contingency,
    margin: matRev > 0 ? (matRev - matCost) / matRev : 0,
  };
}
```

- [ ] **Step 3: `src/lib/design/equipment-pricing.ts`**

(a) Change the wire-labor import to:

```ts
import { defaultWireLaborRules, laborFrac, laborFracsFor, tierMult, wireDimsOf, withWirePull, type WireLaborRules } from "./wire-labor";
```

(b) Replace `QuickRates`:

```ts
/** The pricing-rule percentages a Quick Design total uses (freight / contingency) and the wire + labor rules (#231/#232). */
export type QuickRates = {
  freightPct: number;
  contingencyPct: number;
  /** Wire-pull + system-labor rules; absent = the defaults. */
  rules?: WireLaborRules;
};

/** One system's labor on the Estimate tab (#232) — unrounded; the Labor row rounds the sum once. */
export type SystemLaborRow = { key: SysKey; name: string; material: number; pct: number; mult: number; amount: number };

/** The per-system labor breakdown for a priced tier: every on system with material. */
export function systemLabor(systems: SystemBlock[], tierKey: TierKey, rules: WireLaborRules = defaultWireLaborRules()): SystemLaborRow[] {
  return systems
    .filter((x) => x.on && x.rev > 0)
    .map((x) => {
      const rule = rules.labor[x.key];
      return { key: x.key, name: x.name, material: x.rev, pct: rule.pct, mult: tierMult(rule.mult, tierKey), amount: x.rev * laborFrac(rule, tierKey) };
    });
}
```

Add `type SysKey` to the existing `@/app/(app)/design/quick/engine` import list.

(c) In `quickScreenPrice` replace the two lines

```ts
  const base = tierSystemsBase(compute(a), a, tier, tierDefs, table, fixtureOverridesFor(a.fixtureAssemblies, fixturePrices), rates.rules ?? defaultWireLaborRules());
  const systems = applyOverrides(base, a, tier);
  const tot = tierTotals(systems, td, rates.installPct / 100, rates.freightPct / 100, (a.contingency ?? 0) / 100);
```

with

```ts
  const rules = rates.rules ?? defaultWireLaborRules();
  const base = tierSystemsBase(compute(a), a, tier, tierDefs, table, fixtureOverridesFor(a.fixtureAssemblies, fixturePrices), rules);
  const systems = applyOverrides(base, a, tier);
  const tot = tierTotals(systems, td, laborFracsFor(rules, tier), rates.freightPct / 100, (a.contingency ?? 0) / 100);
```

and update its doc comment: "tierTotals with per-system labor (#232), freight and contingency".

(d) In `quickDesignNeedsPart` change `{ installPct: 0, freightPct: 0, contingencyPct: 0, rules }` to `{ freightPct: 0, contingencyPct: 0, rules }`.

(e) In the `quickDesignPrice` doc comment, change "(tierTotals with the install / freight / contingency percentages)" to "(tierTotals with per-system labor and the freight / contingency percentages)".

- [ ] **Step 4: Auto cards carry labor (`src/lib/design/auto-estimate.ts`)**

(a) Change the wire-labor import to `import { defaultWireLaborRules, laborAmount, tierMult, wireDimsOf, withWirePull, type WireLaborRules } from "./wire-labor";`.

(b) Replace the `AutoCard` type:

```ts
export type AutoCard = {
  scope: SysKey;
  tier: TierKey;
  lines: AutoLine[];
  /** Equipment only — the Scope panel's target. */
  total: number;
  needsPart: number;
  allowances: number;
  /** #232: calculated labor for this scope — total × labor % × the card's tier multiplier (sell). Not in `total`. */
  labor: number;
  laborRule: { pct: number; mult: number };
};
```

(c) Replace the `cards.push({ … })` in `autoEstimateCards`:

```ts
    const total = round2(lines.reduce((sum, l) => sum + l.total, 0));
    const rule = rules.labor[scope];
    cards.push({
      scope,
      tier,
      lines,
      total,
      needsPart: lines.filter((l) => l.status === "needs-part").length,
      allowances: lines.filter((l) => l.status === "allowance").length,
      labor: laborAmount(total, rule, tier),
      laborRule: { pct: rule.pct, mult: tierMult(rule.mult, tier) },
    });
```

(d) Replace `sellOnlyCards`:

```ts
export function sellOnlyCards(cards: AutoCard[]): SellCard[] {
  return cards.map((c) => ({
    scope: c.scope,
    tier: c.tier,
    lines: c.lines.map(sellLine),
    total: c.total,
    needsPart: c.needsPart,
    allowances: c.allowances,
    labor: c.labor,
    laborRule: { ...c.laborRule },
  }));
}
```

- [ ] **Step 5: Equipment card shows labor (`src/app/(app)/design/grid/[id]/equipment-card.tsx`)**

(a) In `EquipmentCard`, directly above `{card.needsPart > 0 && (` add:

```tsx
      {card.labor > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "6px 8px", marginTop: 6, borderTop: "1px dashed #ececf0" }}>
          <span style={{ color: "#5b616e" }}>
            Labor · {card.laborRule.pct}% × {card.laborRule.mult}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{money(card.labor)}</span>
        </div>
      )}
```

(b) In `EquipmentCards`, after `const grand = cards.reduce((s, c) => s + c.total, 0);` add `const labor = cards.reduce((s, c) => s + c.labor, 0);`. Replace the footer total span's contents:

```tsx
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
          Total {money(grand + labor)}
          {labor > 0 ? ` (incl. ${money(labor)} labor)` : ""}
          {loading ? " · updating…" : ""}
        </span>
```

- [ ] **Step 6: Quick Design shows labor per system**

(a) `src/app/(app)/design/quick/page.tsx`: remove `installPct` from the `Promise.all` destructure and remove the `num("system.installPct", 18),` entry. Change `rates={{ installPct, freightPct, contingencyPct, rules: wireLabor }}` to `rates={{ freightPct, contingencyPct, rules: wireLabor }}`. In the doc comment, "the live pricing-rule defaults" stays.

(b) `src/lib/stores/design-pricing.ts`: replace `quickRates`:

```ts
/** The freight / contingency percentages and the wire + labor rules Quick Design totals with (its page reads the same keys). */
async function quickRates(): Promise<QuickRates> {
  const [freightPct, contingencyPct, rules] = await Promise.all([
    num("system.freightPct", 5),
    num("system.contingencyPct", 10),
    loadWireLaborRules(),
  ]);
  return { freightPct, contingencyPct, rules };
}
```

(c) `src/app/(app)/design/quick/quick-design-client.tsx`:
- Imports: add `systemLabor` to the `@/lib/design/equipment-pricing` import, and change the wire-labor import to `import { defaultWireLaborRules, laborFracsFor } from "@/lib/design/wire-labor";`.
- Delete `  const laborPct = rates.installPct / 100;`.
- Replace the `selTot` line with:

```ts
  const selTot = useMemo(
    () => tierTotals(selSystems, selTd, laborFracsFor(wireLabor, selKey), freightPct, contPct),
    [selSystems, selTd, wireLabor, selKey, freightPct, contPct]
  );
  /** #232: the Labor row's per-system breakdown at the selected tier. */
  const selLabor = useMemo(() => systemLabor(selSystems, selKey, wireLabor), [selSystems, selKey, wireLabor]);
```

- In `tierCards`, change `tot: tierTotals(sys, td, laborPct, freightPct, contPct),` to `tot: tierTotals(sys, td, laborFracsFor(wireLabor, td.key), freightPct, contPct),` and remove `laborPct` from its deps.
- In `makeDesign`, change `const tot = tierTotals(sysForTot, td, laborPct, freightPct, (s.contingency ?? 0) / 100);` to `const tot = tierTotals(sysForTot, td, laborFracsFor(wireLabor, td.key), freightPct, (s.contingency ?? 0) / 100);`.
- Replace the Estimate tab's install row

```tsx
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                      <span style={{ color: "#5b616e" }}>Installation &amp; commissioning</span>
                      {breakdownAmount(selTot.install)}
                    </div>
```

  with

```tsx
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: selNeedsPart === 0 && selLabor.length ? 4 : 8 }}>
                      <span style={{ color: "#5b616e" }}>Labor (per system)</span>
                      {breakdownAmount(selTot.install)}
                    </div>
                    {selNeedsPart === 0 && selLabor.length > 0 && (
                      <div style={{ display: "grid", gap: 2, margin: "0 0 8px 10px" }}>
                        {selLabor.map((l) => (
                          <div key={l.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8c919c" }}>
                            <span>
                              {SHORT[l.key]} · {l.pct}% × {l.mult}
                            </span>
                            <span style={{ fontFamily: MONO }}>{moneyRound(l.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
```

- In the BOM tab footnote, change `Installation, freight, and contingency are applied on the Estimate tab.` to `Labor, freight, and contingency are applied on the Estimate tab.`

- [ ] **Step 7: Retire `system.installPct` in `src/lib/stores/pricing.ts`**

(a) Delete the line `      rate("system.installPct", "Installation & commissioning", 18, "%", { … }),`.

(b) Change the `system` group's `note` to:

```ts
    note: "Freight / contingency below drive the Quick Design estimate live; labor is per system (see System labor). Tier multipliers, base margin and the fabric rate are the documented reference the estimators are built on.",
```

(c) Replace the `system.rollup` formula with:

```ts
      formula("system.rollup", "Budgetary total", "materials + Σ system labor + freight, then + contingency  →  materials + Σ(system material × labor % × tier ×) + (materials × freight%), × (1 + contingency%)"),
```

(d) Change `rate("system.contingencyPct", …)`'s help to `"Applied to materials + labor + freight. New designs start at this value."`.

(e) Change the `frac` doc comment to `/** num() as a fraction: frac('system.freightPct', 0.05) → 0.05 when default. */`.

(f) Change the file header's "Quick Design reads its install / freight / contingency defaults from here (see num())." to "Quick Design reads its freight / contingency defaults from here (see num()) and its wire / labor rules through loadWireLaborRules()."

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit 2>&1 | tail -3
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npx eslint "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-pricing.ts src/lib/design/auto-estimate.ts "src/app/(app)/design/grid/[id]/equipment-card.tsx" "src/app/(app)/design/quick/page.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" src/lib/stores/design-pricing.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts
lsof -i :3000; npx next build 2>&1 | tail -5
```
Expected: tsc 0 (the harness's `rates = { installPct: 18, … }` variables still type-check: extra properties on a non-literal argument are allowed). PASS = Task 2's count + **11**, no FAIL. eslint 0. Build exit 0.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/design/quick/engine.ts" src/lib/design/equipment-pricing.ts src/lib/design/auto-estimate.ts "src/app/(app)/design/grid/[id]/equipment-card.tsx" "src/app/(app)/design/quick/page.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" src/lib/stores/design-pricing.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): labor per system × tier in Quick Design and Auto cards (#232)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Grid labor lines replace the hours-per-device suggestion (#232)

**Files:**
- Modify: `src/lib/design/grid-options.ts` (`GridOption` 20–31)
- Modify: `src/lib/stores/grid-projects.ts` (imports; `addOption` 1096–1101; new `setLaborOverride` after `removeCustomItem` ~1252; `snapshotOf` 1281–1286)
- Modify: `src/lib/design/grid-quote.ts` (header comment; imports; `GridQuoteBuild`; `GridQuoteInputs`; `loadGridQuoteInputs`; `buildGridQuote` signature 73–78 and labor block 164–170; return)
- Modify: `src/lib/design/grid-virtual-parts.ts` (`gridSpecBomRows` 125–150)
- Modify: `src/lib/stores/designs.ts` (line 214)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (store import; `createDraftQuoteAction` 855–887; new `setLaborOverrideAction`)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (imports 11, 32; `Promise.all`; equip ctx line 114; labor block 176–188; JSX 225–226)
- Create: `src/app/(app)/design/grid/[id]/labor-lines.tsx`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (import 51; props 250–251, 272–275; labor block 633–648; `runQuote` 656–661; BOM JSX ~1915–1960)
- Modify: `src/lib/stores/pricing.ts` (drop the `grid` group)
- Modify: `src/app/(app)/design/grid/settings/page.tsx` (imports 10, 15; lines 90–94; header copy ~151; `<LaborHoursCard …/>` ~182; `RELATED`)
- Delete: `src/lib/design/grid-labor.ts`, `src/app/(app)/design/grid/settings/labor-hours-card.tsx`
- Test: `scripts/test-review-and-spec.ts` (remove the D114 block ~2659–2692; #212 value check ~19047; new EOF block + async function + chain line), `scripts/test-grid-options.ts` (~178–187)

**Interfaces:**
- `GridOption.laborOverrides?: LaborOverrides`
- `setLaborOverride(projectId, optionId, system: string, amount: number | null): Promise<{ ok: true } | { ok: false; error: string }>`
- `GridQuoteInputs.wireLabor: WireLaborRules`
- `GridQuoteBuild.labor: GridLaborLine[]`
- `buildGridQuote(project, optionId, inputs?)`: the `laborLines` parameter is removed
- `createDraftQuoteAction(projectId, optionId, opts?)`: the `laborLines` parameter is removed
- `setLaborOverrideAction(projectId, optionId, system, amount | null): Promise<Result>`
- `LaborLinesSection({ projectId, optionId, lines, onChanged })`

- [ ] **Step 1: Tests first**

(a) Delete the whole D114 block in `scripts/test-review-and-spec.ts`. It starts at `/* --- The Grid labor auto-suggest (D114) --- */` and ends after `  "no labor parts in the catalog → no suggestions (never invent rates)");`. Check the `import { suggestLabor } …` line, `laborCat`, `deviceCat`, `sug`, `ligSug`, `rigSug`, `sugOdd` and the 8 `ok(` calls are all gone. Confirm those names are used nowhere else:

```bash
grep -n "suggestLabor\|laborCat\|deviceCat\|sugOdd" scripts/test-review-and-spec.ts
```
Expected: no output.

(b) #212 value check: replace

```ts
  ok(built.ok && built.build.value === Math.round(2 * unit * 100) / 100,
    `#212 quote: a custom-only option quotes at unit cost ÷ (1 − tier margin) × qty (${built.ok ? built.build.value : "refused"})`);
```

with

```ts
  const customExt = Math.round(2 * unit * 100) / 100;
  const customLabor = Math.round(customExt * 0.18 * 100) / 100;
  ok(built.ok && Math.abs(built.build.value - (customExt + customLabor)) < 0.005,
    `#212 quote + #232: a custom-only option quotes at unit cost ÷ (1 − tier margin) × qty, plus its General labor (${built.ok ? built.build.value : "refused"})`);
```

(c) Append at the end of the file:

```ts
/* --- #232 T4: Grid labor lines replace the hours-per-device suggestion --- */
import { gridSpecBomRows as lb232SpecRows } from "@/lib/design/grid-virtual-parts";
{
  const rd = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const has = (f: string) => {
    try {
      rd(f);
      return true;
    } catch {
      return false;
    }
  };
  ok(!has("src/lib/design/grid-labor.ts") && !has("src/app/(app)/design/grid/settings/labor-hours-card.tsx"), "#232: the hours-per-device suggestion and its settings card are gone");
  ok(!wl231Groups.some((g) => g.items.some((it) => it.id === "grid.laborHoursPerDevice")), "#232: grid.laborHoursPerDevice is retired from Estimating Rules");
  const ed = rd("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(!ed.includes("suggestLabor") && !ed.includes("Labor (suggested)") && ed.includes("<LaborLinesSection") && ed.includes("laborLines: GridLaborLine[]"), "#232: the editor BOM shows server-computed labor lines");
  const ll = rd("src/app/(app)/design/grid/[id]/labor-lines.tsx");
  const llImports = [...ll.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  ok(ll.startsWith('"use client"') && llImports.every((m) => !m.startsWith("@/lib/stores/") && !m.startsWith("@/db") && !/\/(auto-estimate|equipment-pricing|equipment-map)$/.test(m)) && ll.includes("setLaborOverrideAction("),
    "#232: the labor section is a client component with no store or pricing import");
  const gq = rd("src/lib/design/grid-quote.ts");
  ok(gq.includes("gridLaborLines(") && gq.includes("laborSystemOf(") && !gq.includes("laborLines?:") && gq.includes("inputs?: GridQuoteInputs"), "#232: buildGridQuote computes labor itself from the option's tier-priced material");
  const pg = rd("src/app/(app)/design/grid/[id]/page.tsx");
  ok(pg.includes("buildGridQuote(project, activeOptionId, quoteInputs)") && pg.includes("laborLines={laborLines}") && !pg.includes("laborHoursPerDevice"), "#232: the editor page sends the same labor lines the quote will carry");
  const acts = rd("src/app/(app)/design/grid/[id]/actions.ts");
  const start = acts.indexOf("export async function setLaborOverrideAction");
  const body = acts.slice(start, acts.indexOf("\n}\n", start));
  ok(start > -1 && body.includes("await requireUser()") && body.includes("setLaborOverride(") && acts.includes("buildGridQuote(project, resolvedOptionId)"), "#232: the override action uses the placement-edit gate; the quote action no longer takes client labor");
  ok(lb232SpecRows([{ sku: "labor:lighting", desc: "Labor — Lighting", qty: 1 }, { sku: "ETC-S4", desc: "Source Four", qty: 3 }], () => null).map((r) => r.sku).join() === "ETC-S4", "#232: the bid spec leaves labor lines out");
}

/* #232 T4 (b) — labor lines through the store and buildGridQuote on the scratch DB. */
async function gridLabor232AsyncChecks(): Promise<void> {
  const GP = await import("@/lib/stores/grid-projects");
  const { buildGridQuote } = await import("@/lib/design/grid-quote");
  const { resolveTier } = await import("@/lib/pricing-tiers");
  const { sellFromCost } = await import("@/lib/design/equipment-map");
  const gp = await GP.createProject({ name: "LB232 test grid project", customer: "Test Customer LB232", customerId: null, by: "Test Harness" });
  registerFixture("grid_projects", gp.id);
  const base = (await GP.getProject(gp.id))!.options![0].id;
  await GP.saveCustomItem(gp.id, base, { desc: "Lighting rack", system: "Lighting", qty: 1, unitCost: 7000 });
  await GP.saveCustomItem(gp.id, base, { desc: "Misc hardware", qty: 2, unitCost: 100 });
  const tier = await resolveTier(null);
  const lightExt = Math.round(sellFromCost(7000, tier.margin) * 100) / 100;
  const genExt = Math.round(2 * sellFromCost(100, tier.margin) * 100) / 100;
  const b1 = await buildGridQuote((await GP.getProject(gp.id))!, base);
  const lab = b1.ok ? b1.build.labor : [];
  const ll = lab.find((l) => l.system === "lighting");
  const gl = lab.find((l) => l.system === "general");
  ok(!!ll && ll.amount === Math.round(lightExt * 0.18 * 100) / 100 && ll.mult === 1 && ll.tier === null && !!gl && gl.amount === Math.round(genExt * 0.18 * 100) / 100,
    `#232 quote: a hand-built option gets one labor line per system at 18% × 1.0 (${ll?.amount} / ${gl?.amount})`);
  const spec = b1.ok ? b1.build.spec.lines.filter((l) => l.sku.startsWith("labor:")) : [];
  ok(spec.map((l) => `${l.sku}|${l.desc}|${l.qty}|${l.unit}`).join() === "labor:lighting|Labor — Lighting|1|lot,labor:general|Labor — General|1|lot",
    "#232 quote: labor reaches the quote as priced lines, sku labor:<system>");
  ok(b1.ok && Math.abs(b1.build.value - (lightExt + genExt + (ll?.amount ?? 0) + (gl?.amount ?? 0))) < 0.01, "#232 quote: the quote value includes labor");
  ok(!(await GP.setLaborOverride(gp.id, base, "bogus", 5)).ok, "#232 store: an unknown system is refused");
  ok(!(await GP.setLaborOverride(gp.id, base, "lighting", -3)).ok, "#232 store: a negative amount is refused");
  const set = await GP.setLaborOverride(gp.id, base, "lighting", 1500);
  const b2 = await buildGridQuote((await GP.getProject(gp.id))!, base);
  const ll2 = b2.ok ? b2.build.labor.find((l) => l.system === "lighting") : undefined;
  ok(set.ok && !!ll2 && ll2.amount === 1500 && ll2.overridden && ll2.computed === ll?.amount, "#232 store: a typed $ overrides the computed labor");
  await GP.setLaborOverride(gp.id, base, "general", 0);
  const b3 = await buildGridQuote((await GP.getProject(gp.id))!, base);
  ok(b3.ok && !b3.build.spec.lines.some((l) => l.sku === "labor:general") && b3.build.labor.some((l) => l.system === "general" && l.amount === 0),
    "#232 store: $0 drops that labor line from the quote but keeps it in the BOM to reset");
  const alt = await GP.addOption(gp.id, { name: "Alt", copyFromOptionId: base, by: "Test Harness" });
  const altOpt = alt.ok ? (await GP.getProject(gp.id))!.options!.find((o) => o.id === alt.option.id) : undefined;
  ok(JSON.stringify(altOpt?.laborOverrides) === '{"lighting":1500,"general":0}', "#232 store: copying an option copies its labor overrides");
  const rev = await GP.addRevision(gp.id, { by: "Test Harness", note: "labor overrides" });
  await GP.setLaborOverride(gp.id, base, "lighting", null);
  ok(JSON.stringify((await GP.getProject(gp.id))!.options!.find((o) => o.id === base)?.laborOverrides) === '{"general":0}', "#232 store: clearing one override leaves the others");
  const restored = rev ? await GP.restoreRevision(gp.id, rev.rev, "Test Harness") : { ok: false as const };
  ok(restored.ok && (await GP.getProject(gp.id))!.options!.find((o) => o.id === base)?.laborOverrides?.lighting === 1500, "#232 store: restoring a revision brings the overrides back");
}
```

Chain it by inserting this line immediately above the ``  // Before the report and before the `.catch` …`` comment (below Task 1's line):

```ts
  .then(() => gridLabor232AsyncChecks())
```

(d) `scripts/test-grid-options.ts`:
- After `import { buildGridQuote } from "@/lib/design/grid-quote";` add `import { isLaborSku } from "@/lib/design/wire-labor";`.
- Replace the block inside `if (bBase.ok && bGood.ok) {` that asserts line counts:

```ts
    const baseDev = bBase.build.lines.filter((l) => !isLaborSku(l.partId));
    const goodDev = bGood.build.lines.filter((l) => !isLaborSku(l.partId));
    assert.equal(baseDev.length, 1, "base option prices one grouped device line (2× symA)");
    assert.equal(baseDev[0].qty, 2, "base option line qty is 2");
    assert.equal(goodDev.length, 1, "good option prices its own single line");
    assert.equal(goodDev[0].partId, symB.id, "good option line is symB, not symA");
    assert.ok(bBase.build.labor.length > 0 && bBase.build.labor.every((l) => l.amount > 0), "#232: a priced option carries its calculated labor");
```

  Keep the `spec.gridOptionId` and `quoteName` assertions that follow.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs > "$TMPDIR/specs.log" 2>&1; tail -5 "$TMPDIR/specs.log"`
Expected: failures (`setLaborOverride` / `build.labor` missing; the files still exist).

- [ ] **Step 3: Option-scoped overrides (`src/lib/design/grid-options.ts`, `src/lib/stores/grid-projects.ts`)**

(a) `grid-options.ts`:
- Add `import type { LaborOverrides } from "./wire-labor";` beside the other type imports.
- In `GridOption`, after `customItems?: GridCustomItem[];` add:

```ts
  /** #232: typed labor $ per system — overrides that system's calculated
   *  labor line; $0 leaves it off the quote. Absent on older options; always
   *  read through sanitizeLaborOverrides(). */
  laborOverrides?: LaborOverrides;
```

(b) `grid-projects.ts`:
- Add `import { applyLaborOverride, isLaborSystem, LABOR_OVERRIDE_MAX, sanitizeLaborOverrides } from "@/lib/design/wire-labor";` beside the grid-custom-items import.
- In `addOption`, inside `if (input.copyFromOptionId) { … }` right after `if (items.length) option.customItems = items;`, add:

```ts
      // Labor overrides (#232) are option-scoped design state too.
      const labor = sanitizeLaborOverrides(src?.laborOverrides);
      if (Object.keys(labor).length) option.laborOverrides = labor;
```

- After `removeCustomItem` add:

```ts
/* ------------------------- labor overrides (#232) ------------------------- */

/**
 * Set (a number, $0–$10M; $0 leaves the line off the quote) or clear (null)
 * one system's typed labor $ on an option. Does not cut a revision (same as a
 * custom item); quote / manual revisions capture it.
 */
export async function setLaborOverride(
  projectId: string,
  optionId: string,
  system: string,
  amount: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isLaborSystem(system)) return { ok: false, error: "Unknown labor line." };
  if (amount !== null && !(typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= LABOR_OVERRIDE_MAX))
    return { ok: false, error: "Enter a labor amount from $0 to $10,000,000." };
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, optionId)) return { ok: false, error: "That option was removed — refresh the page." };
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    const doc = ensureOptions(p);
    doc.options = doc.options.map((o) => {
      if (o.id !== optionId) return o;
      const next = applyLaborOverride(o.laborOverrides, system, amount);
      const rest = { ...o };
      delete rest.laborOverrides;
      return Object.keys(next).length ? { ...rest, laborOverrides: next } : rest;
    });
    p.updatedAt = Date.now();
  });
  return updated ? { ok: true } : { ok: false, error: "Design not found." };
}
```

- In `snapshotOf`, replace

```ts
        ? p.options.map((o) => ({ ...o, ...(o.customItems ? { customItems: o.customItems.map((c) => ({ ...c })) } : {}) }))
```

  with

```ts
        ? p.options.map((o) => ({
            ...o,
            ...(o.customItems ? { customItems: o.customItems.map((c) => ({ ...c })) } : {}),
            // Labor overrides (#232) ride on the option — copied, not shared.
            ...(o.laborOverrides ? { laborOverrides: { ...o.laborOverrides } } : {}),
          }))
```

  The #212 guard's substring `customItems: o.customItems.map((c) => ({ ...c }))` must stay intact.

- [ ] **Step 4: `buildGridQuote` computes labor per system (`src/lib/design/grid-quote.ts`)**

(a) Header comment: change "#63/#76 fallbacks, #49 curtains and D114 labor still applies" to "#63/#76 fallbacks and #49 curtains still applies; labor is per system (#232)".

(b) Imports:
- Change `import { bomLines, bomTotals, curtainLines, routeLines, type BomLine } from "@/lib/design/grid-bom";` to add `placementQty`.
- Change `import { ensureOptions, hasOption, optionSlice } from "@/lib/design/grid-options";` to add `defaultOptionId`.
- Add:

```ts
import { autoEstimateFor } from "@/lib/design/grid-auto-model";
import { isGridLayer } from "@/lib/design/grid-scopes";
import { loadWireLaborRules } from "@/lib/stores/pricing";
import { gridLaborLines, laborSystemOf, sanitizeLaborOverrides, type GridLaborLine, type LaborSystem, type WireLaborRules } from "@/lib/design/wire-labor";
import type { TierKey } from "@/app/(app)/design/quick/engine";
```

(c) `GridQuoteBuild`: after `quoteName: string;` add `/** #232: this option's labor lines (sell) — the editor shows them; lines with amount > 0 are on the quote. */ labor: GridLaborLine[];`.

(d) `GridQuoteInputs`: after `location: boolean;` add `/** #231/#232 rules (loadWireLaborRules). */ wireLabor: WireLaborRules;`. In `loadGridQuoteInputs` replace `const [catalog, symbols] = await Promise.all([listCatalog(), listGridSymbols()]);` with `const [catalog, symbols, wireLabor] = await Promise.all([listCatalog(), listGridSymbols(), loadWireLaborRules()]);` and return `{ catalog, symbols, equip, tierFor, location: opts.location ?? true, wireLabor }`.

(e) Signature: replace

```ts
export async function buildGridQuote(
  project: GridProject,
  optionId: string,
  laborLines?: Array<{ partId: string; hours: number }>,
  /** Preloaded reads shared across a batch (loadGridQuoteInputs). */
  inputs?: GridQuoteInputs
): Promise<{ ok: true; build: GridQuoteBuild } | { ok: false; error: string }> {
```

with

```ts
export async function buildGridQuote(
  project: GridProject,
  optionId: string,
  /** Preloaded reads shared across a batch (loadGridQuoteInputs). */
  inputs?: GridQuoteInputs
): Promise<{ ok: true; build: GridQuoteBuild } | { ok: false; error: string }> {
```

(f) Delete the old labor block:

```ts
  const labor: Array<{ sku: string; desc: string; qty: number; unit: string; price: number; ext: number; cost: number }> = [];
  for (const l of laborLines || []) {
    const part = tierCatalog.find((p) => p.id === l.partId);
    const hours = Number(l.hours);
    if (!part || (part.role || "").toLowerCase() !== "labor") continue;
    if (!(hours > 0) || hours > 10000) continue;
    labor.push({ sku: part.sku, desc: part.desc, qty: hours, unit: part.unit || "hr", price: part.list, ext: hours * part.list, cost: hours * part.cost });
  }
```

(g) Immediately after `const customCost = customItemsCost(customItems);`, insert:

```ts
  // #232: labor is one line per system — that system's tier-priced material
  // on this quote (devices, wire runs, curtains, custom items) × labor % × the
  // tier's multiplier, or the typed $ the option carries. The tier is the
  // option's Auto choice for that scope, else the option's own tier, else none
  // (×1.0). Labor carries the customer's tier margin like every Grid line.
  const wireLabor = inputs ? inputs.wireLabor : await loadWireLaborRules();
  const layerById = new Map<string, string>();
  for (const s of symbols) if (isGridLayer(s.scope)) layerById.set(s.id, s.scope);
  for (const v of virtual) if (v.gridScope) layerById.set(v.id, v.gridScope);
  const sellById = new Map(tierCatalog.map((p) => [p.id, p.list] as const));
  const material: Partial<Record<LaborSystem, number>> = {};
  const addMaterial = (sys: LaborSystem, v: number) => {
    if (v > 0) material[sys] = (material[sys] ?? 0) + v;
  };
  for (const pl of placements) {
    if (pl.curtain) {
      addMaterial("curtains", curtainPrices.get(pl.id)?.priceEach ?? 0);
      continue;
    }
    addMaterial(laborSystemOf(pl.auto?.scope ?? pl.autoOrigin?.scope, layerById.get(pl.partId)), placementQty(pl) * (sellById.get(pl.partId) ?? 0));
  }
  for (const l of wires.lines) addMaterial(laborSystemOf(null, layerById.get(l.partId)), l.ext);
  customItems.forEach((it, i) => addMaterial(laborSystemOf(null, it.system), custom[i]?.ext ?? 0));
  const est = autoEstimateFor(project.autoEstimate, optionId, defaultOptionId(project));
  const laborTier = (sys: LaborSystem): TierKey | null => (sys !== "general" ? est?.tierByScope[sys] : undefined) ?? option.tier ?? null;
  const laborLines = gridLaborLines(material, laborTier, wireLabor, sanitizeLaborOverrides(option.laborOverrides));
  const laborCostFrac = tier.margin >= 0 && tier.margin < 0.95 ? 1 - tier.margin : 0.7;
  const labor = laborLines
    .filter((l) => l.amount > 0)
    .map((l) => ({ sku: l.sku, desc: l.desc, qty: 1, unit: "lot", price: l.amount, ext: l.amount, cost: Math.round(l.amount * laborCostFrac * 100) / 100 }));
```

The following `lines`, `value` and `cost` expressions already consume `labor` unchanged.

(h) Return: change the final `return { ok: true, build: { lines, value, margin, fallbackLines, spec, tier: { tier: tier.tier, margin: tier.margin }, locationId, quoteName } };` to include `labor: laborLines` after `quoteName`.

- [ ] **Step 5: Callers and the bid spec**

(a) `src/lib/stores/designs.ts`: `const built = await buildGridQuote(project, optionId, undefined, inputs);` becomes `const built = await buildGridQuote(project, optionId, inputs);`.

(b) `src/lib/design/grid-virtual-parts.ts`:
- Add `import { isLaborSku } from "./wire-labor";`.
- In `gridSpecBomRows`, after `if (l.allowance || sku.startsWith(ALLOWANCE_PART_PREFIX)) continue;` add:

```ts
    // #232: labor is a service line, not a product the spec can name.
    if (isLaborSku(sku)) continue;
```

(c) `src/app/(app)/design/grid/[id]/actions.ts`:
- Add `setLaborOverride,` to the `@/lib/stores/grid-projects` import list (alphabetical, after `setLinesetDesign,`).
- Replace the `createDraftQuoteAction` parameter list

```ts
export async function createDraftQuoteAction(
  projectId: string,
  optionId: string | null,
  laborLines?: Array<{ partId: string; hours: number }>,
  opts?: { acceptIncomplete?: boolean }
): Promise<
```

  with

```ts
export async function createDraftQuoteAction(
  projectId: string,
  optionId: string | null,
  opts?: { acceptIncomplete?: boolean }
): Promise<
```

  and `const built = await buildGridQuote(project, resolvedOptionId, laborLines);` with `const built = await buildGridQuote(project, resolvedOptionId);`.

- After `removeCustomItemAction` add:

```ts
/** #232: type (a number) or clear (null) one system's labor $ on an option. */
export async function setLaborOverrideAction(
  projectId: string,
  optionId: string,
  system: string,
  amount: number | null
): Promise<Result> {
  await requireUser();
  const r = await setLaborOverride(projectId, optionId, String(system ?? ""), amount === null ? null : Number(amount));
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  revalidatePath("/design/designs");
  return { ok: true };
}
```

- [ ] **Step 6: The editor page computes the labor lines (`src/app/(app)/design/grid/[id]/page.tsx`)**

(a) Imports:
- Change `import { loadWireLaborRules, num } from "@/lib/stores/pricing";` to `import { loadWireLaborRules } from "@/lib/stores/pricing";`.
- Delete `import type { LaborPartLite } from "@/lib/design/grid-labor";`.
- Add `import { buildGridQuote, type GridQuoteInputs } from "@/lib/design/grid-quote";`.

(b) In the first `Promise.all`:
- Remove `laborHoursPerDevice` from the destructure.
- Remove its array entry: the comment block starting `// Install-hours-per-device knob (D114)` and `num("grid.laborHoursPerDevice", 0.5),`.

(c) Replace `const { map: equipMap, ctx: equipCtx } = await loadEquipPriceCtx({ catalog });` with:

```ts
  const equipLoaded = await loadEquipPriceCtx({ catalog });
  const { map: equipMap, ctx: equipCtx } = equipLoaded;
```

(d) Replace the whole `const laborParts: LaborPartLite[] = catalog … }));` block with:

```ts
  // #232: the active option's labor lines, computed by the quote builder
  // itself over this request's reads — the BOM shows exactly what the draft
  // quote will carry. Sell numbers only. A design that can't price yet (empty,
  // a seed placeholder, a dead Auto part) shows no labor until it can.
  const quoteInputs: GridQuoteInputs = {
    catalog,
    symbols: gridSymbols,
    equip: equipLoaded,
    tierFor: () => Promise.resolve(tier),
    location: false,
    wireLabor,
  };
  const built = await buildGridQuote(project, activeOptionId, quoteInputs);
  const laborLines = built.ok ? built.build.labor : [];
```

(e) JSX: delete `laborParts={laborParts}` and `laborHoursPerDevice={laborHoursPerDevice}`, and add `laborLines={laborLines}` after `customLines={customLines}`.

- [ ] **Step 7: Create `src/app/(app)/design/grid/[id]/labor-lines.tsx`**

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import type { GridLaborLine } from "@/lib/design/wire-labor";
import { setLaborOverrideAction } from "./actions";

/**
 * The Grid BOM's labor lines (#232): one per system, computed on the server
 * as that system's material × labor % × the tier's multiplier — the same
 * lines the draft quote carries. A typed $ overrides a line for THIS option
 * ($0 leaves it off the quote); ↺ goes back to the calculation. Sell numbers
 * only.
 */

const INPUT: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "2px 5px",
  fontSize: 11.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: 76,
  textAlign: "right",
};

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function LaborLinesSection({
  projectId,
  optionId,
  lines,
  onChanged,
}: {
  projectId: string;
  optionId: string;
  lines: GridLaborLine[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!lines.length) return null;

  const clearDraft = (sys: string) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[sys];
      return next;
    });

  const commit = (line: GridLaborLine, raw: string | null) => {
    setErr(null);
    let amount: number | null = null;
    if (raw !== null) {
      const n = Number(raw.replace(/[$,\s]/g, ""));
      if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
        setErr("Enter a labor amount of $0 or more.");
        return;
      }
      amount = n;
    }
    startTransition(async () => {
      const r = await setLaborOverrideAction(projectId, optionId, line.system, amount);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      clearDraft(line.system);
      onChanged();
    });
  };

  return (
    <div style={{ borderTop: "1px dashed #e3e5ea", marginTop: 4, paddingTop: 5, display: "grid", gap: 4 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>Labor</div>
      {lines.map((l) => (
        <div key={l.system} style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}>
          <span
            style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            title={`${money(l.material)} material × ${l.pct}% × ${l.mult}${l.overridden ? ` — calculated ${money(l.computed)}` : ""}`}
          >
            {l.desc}
            <span style={{ color: "#9aa0ab", fontSize: 10.5 }}>
              {" "}
              · {l.pct}% × {l.mult}
            </span>
          </span>
          <input
            aria-label={`${l.desc} amount`}
            value={draft[l.system] ?? String(Math.round(l.amount * 100) / 100)}
            onChange={(e) => setDraft((d) => ({ ...d, [l.system]: e.target.value }))}
            onBlur={() => {
              if (draft[l.system] !== undefined) commit(l, draft[l.system]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            inputMode="decimal"
            disabled={pending}
            style={{ ...INPUT, borderColor: l.overridden ? "var(--accent)" : "#dfe2e8" }}
          />
          {l.overridden ? (
            <button
              type="button"
              onClick={() => commit(l, null)}
              disabled={pending}
              title={`Back to the calculated ${money(l.computed)}`}
              style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 0 }}
            >
              ↺
            </button>
          ) : (
            <span style={{ width: 13 }} />
          )}
        </div>
      ))}
      {err && <div style={{ fontSize: 10.5, color: "#a0442b" }}>{err}</div>}
    </div>
  );
}
```

- [ ] **Step 8: Editor (`src/app/(app)/design/grid/[id]/editor.tsx`)**

(a) Replace `import { suggestLabor, type LaborPartLite } from "@/lib/design/grid-labor";` with:

```ts
import type { GridLaborLine } from "@/lib/design/wire-labor";
import { LaborLinesSection } from "./labor-lines";
```

(b) Props:
- In the destructure, delete `laborParts,` and `laborHoursPerDevice,` and add `laborLines,` after `customLines,`.
- In the type, delete both `laborParts` / `laborHoursPerDevice` members with their doc comments, and add after `customLines: BomLine[];`:

```ts
  /** #232: the active option's labor lines, computed server-side by buildGridQuote (sell only). */
  laborLines: GridLaborLine[];
```

(c) Replace the block from `// Labor suggestions (D114): the rule proposes; overrides let the human` through `const laborValue = includedLabor.reduce((a, l) => a + l.ext, 0);` with:

```ts
  // #232: one labor line per system, computed on the server exactly as the
  // quote prices it; a typed $ override is saved on the option.
  const laborValue = laborLines.reduce((a, l) => a + l.amount, 0);
```

(d) In `runQuote`, replace

```ts
    const r = await createDraftQuoteAction(
      project.id,
      activeOptionId,
      includedLabor.map((l) => ({ partId: l.partId, hours: l.hours })),
      { acceptIncomplete }
    );
```

with

```ts
    const r = await createDraftQuoteAction(project.id, activeOptionId, { acceptIncomplete });
```

(e) In the BOM JSX, replace the entire `{laborRows.length > 0 && ( … )}` block (the one containing `Labor (suggested)`) with:

```tsx
                <LaborLinesSection
                  key={activeOptionId}
                  projectId={project.id}
                  optionId={activeOptionId}
                  lines={laborLines}
                  onChanged={() => router.refresh()}
                />
```

Then confirm nothing stale is left:

```bash
grep -n "laborRows\|includedLabor\|setLaborOverrides\|laborParts\|laborHoursPerDevice" "src/app/(app)/design/grid/[id]/editor.tsx"
```
Expected: no output.

- [ ] **Step 9: Retire hours-per-device**

(a) `src/lib/stores/pricing.ts`: delete the whole `grid` group object:

```ts
  {
    key: "grid", label: "The Grid", live: true,
    sub: "Install labor knob for the Grid's auto-priced BOM",
    note: "…",
    items: [
      rate("grid.laborHoursPerDevice", …),
    ],
  },
```

(b) `src/app/(app)/design/grid/settings/page.tsx`:
- Delete `import { GROUPS, value as pricingValue, type RateEntry } from "@/lib/stores/pricing";` and `import { LaborHoursCard } from "./labor-hours-card";`.
- Delete the four lines computing `laborRate`, `laborValue` and `laborDef`, and the `<LaborHoursCard value={laborValue} def={laborDef} />` line.
- Header copy: change `Symbol colours and icons, port rules, wire types, and install labor — the settings specific` to `Symbol colours and icons, port rules and wire types — the settings specific`.
- In the file's doc comment, change `the wire-type registry Grid wiring validation actually reads now,\n * and the install-hours-per-device knob.` to `and the wire-type registry Grid wiring validation actually reads now.`
- Add to `RELATED`:

```ts
    { label: "Estimating Rules — Wire pull & System labor", href: "/estimating-rules", desc: "Per-system wire-pull runs and labor %, with Good/Better/Best multipliers." },
```

(c) Delete the two retired files:

```bash
git rm src/lib/design/grid-labor.ts "src/app/(app)/design/grid/settings/labor-hours-card.tsx"
grep -rn "grid-labor\|labor-hours-card\|laborHoursPerDevice\|suggestLabor" src scripts
```
Expected: no output from the grep.

- [ ] **Step 10: Run the gates**

```bash
npx tsc --noEmit 2>&1 | tail -3
npm run test:specs > "$TMPDIR/specs.log" 2>&1; grep -c '^PASS ' "$TMPDIR/specs.log"; grep '^FAIL ' "$TMPDIR/specs.log"
npm run test:grid-options 2>&1 | tail -3
npx eslint src/lib/design/grid-options.ts src/lib/stores/grid-projects.ts src/lib/design/grid-quote.ts src/lib/design/grid-virtual-parts.ts src/lib/stores/designs.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/labor-lines.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" src/lib/stores/pricing.ts "src/app/(app)/design/grid/settings/page.tsx" scripts/test-review-and-spec.ts scripts/test-grid-options.ts
lsof -i :3000; npx next build 2>&1 | tail -5
```
Expected:
- tsc 0.
- PASS = Task 3's count + **10**: +8 sync, +10 async, −8 from the removed D114 block. The #212 check is changed, not added. No FAIL.
- test:grid-options passes.
- eslint 0.
- Build exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/lib/design/grid-options.ts src/lib/stores/grid-projects.ts src/lib/design/grid-quote.ts src/lib/design/grid-virtual-parts.ts src/lib/stores/designs.ts "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/labor-lines.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" src/lib/stores/pricing.ts "src/app/(app)/design/grid/settings/page.tsx" scripts/test-review-and-spec.ts scripts/test-grid-options.ts
git commit -m "feat(grid): one labor line per system on the Grid BOM and quote (#232)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git rm` in Step 9 already staged the two deletions.)

---

## Handoff notes

- **#230 (BOM grouped by category + "+ Add accessory")** must feed its accessory lines into this plan's per-system material:
  - In `buildGridQuote`, call `addMaterial(laborSystemOf(null, <accessory scope as a Grid layer>), <accessory ext>)` for each accessory line, next to the custom-items line.
  - Its BOM groups should render `LaborLinesSection`'s lines under their own group; `GridLaborLine.system` maps onto #230's Rigging/Curtains/Lighting/Audio/Video/General headings.
  - Controls labor exists in the rules. The Grid only produces a `controls` bucket if #230's device types give placements a Controls scope that `laborSystemOf` can read. Pass that scope as the first argument.
- **House depth** is not captured anywhere Quick Design or the Grid intake can read it. Adding a field (and passing it through `wireDimsOf`) is a follow-up for Jeff to decide. Until then every Wire pull line carries the "House depth not entered" note.
- **Jeff-gated after deploy:**
  - Set per-system runs in Estimating Rules → Wire pull.
  - Map each system's "Wire pull" row (or set it to Not included) in Grid Settings → Equipment map.
  - Review the per-system labor %.
  - Confirm production's old `system.installPct` was 18.
