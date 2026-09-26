# Grid Equipment Map + One Intake (Auto or Blank) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the hard-coded dollars out of the Quick Design / Grid equations. They are replaced by a catalog-backed **Equipment map**, which maps every equation item × tier to a catalog part, an assembly, or a confirmed allowance. The Grid intake becomes one flow, **Auto (equations)** or **Blank**. In Auto you pick Good / Better / Best equipment per scope, and the generated base sheet is filled with ordinary, fully editable placements.

**Architecture:**
- **Vocabulary.** `compute()` (`quick/engine.ts`) keeps its sizing math. Each item it emits now carries a stable key `system:itemKey` from a new vocabulary module, and no dollars.
- **Resolver.** A pure resolver (`src/lib/design/equipment-map.ts`) turns the map (one settings blob, `grid_equipment_map`, one top-level key per row) plus the live catalog and the fixture/system assemblies into unit prices. An empty or unconfirmed cell resolves to **needs a part** and never to a number.
- **Pricing.** Pricing moves out of `engine.ts` into `src/lib/design/equipment-pricing.ts`, so the Grid's client bundle carries no cost constants.
- **Scope targets.** They are computed on the server and only sell numbers reach the client (this removes D139's crossing).
- **Auto.** Auto builds priced cards (`auto-estimate.ts`), and rule-based placement (`grid-auto-layout.ts`) paints them onto the generated base sheet. Assemblies and allowances ride on ordinary placements as virtual part ids (`asm:`/`allow:`), which the server resolves into `PartLite` rows, so every existing BOM, riser, schedule, set and quote path keeps working.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle doc-store over Postgres/PGlite (`getBlob`/`setBlob`, `patchDoc`), tsx harnesses (`scripts/test-review-and-spec.ts` pure, `scripts/test-review-regressions.ts` DB-backed).

**Spec:** `docs/superpowers/specs/2026-09-25-grid-equipment-map-and-auto-intake-design.md` (approved by Jeff, 2026-09-25). **Depends on:** #210, the one assembly builder (`FixtureRecord`, `resolveFixture`, `listFixtures`), which is already on this branch's base `21e391de`.

## Global Constraints

**Spec decisions (quoted)**

- "One intake, two starts: Auto (equations) or Blank. Both ask venue type, measurements, scopes; Blank goes to the canvas; Auto adds an Equipment step, then fills the canvas. Everything lands as ordinary, fully editable Grid placements. 'New design' routes here; the Quick Design canvas retires from 'New design'."
- "Equipment step: per scope, pick Good / Better / Best → pre-fills parts + equation quantities; any part swappable (catalog part or assembly), any qty editable; running $ per scope."
- "Re-fill per scope: 'Change equipment…' re-opens that scope's card and re-fills only that scope; devices moved or edited by hand are kept, untouched auto devices are replaced."
- Map cell: "`{ kind: "part", sku } | { kind: "assembly", id } | { kind: "allowance", amount, confirmedBy, confirmedAt, note? } | empty`". Row switch "Same for all tiers". Row status: "Mapped (all tiers part/assembly), Allowance (any tier confirmed allowance), Needs a part (any tier empty)".
- "Bundles ('Digital mixer, DSP & amplifiers', 'Video processor & switcher', 'Distro system', …) map to System assemblies from the one builder."
- "Pricing from the map: part → live catalog cost/sell; assembly → `resolveFixture`/assembly included totals; allowance → the confirmed amount is a unit cost; sell = cost ÷ (1 − the catalog margin) … flagged 'Allowance' in the builder, Scope panel and quote builder (internal only — customer documents show the line normally). Curtain fabric rows resolve cost per unit area from the mapped catalog fabric."
- "The equations keep producing item keys + quantities (sizing math unchanged)." An item whose tier cell is empty "yields a needs-a-part line with no $ (never a fallback number)."
- "`TIER_SKUS`, the `cost:` literals and `SEED_FABRIC_RATES` are removed from the pricing path (kept only as the 'was $X' hint table on the Equipment map, not used in any total)."
- "`scopeTargets()` … uses the same resolver … Removes D139's baked-in cost data from the Grid client bundle."
- "Each auto placement carries `auto: { scope, rowKey, tier }`; any move/edit clears `auto`."
- "Options (D186) unchanged: Auto fills the current option." "`seedStartingLayoutAction` / `grid-seed.ts` … are replaced by the generator and removed."
- Out of scope: "Levels (upper/lower) — later; three-option auto generation …; the one-proposal-across-options document (roadmap Spec 3)."

**Bundle and boundaries**

- `'use client'` files never import a VALUE from `@/lib/stores/*` or `@/db/*` (a value import breaks `next build` even when tsc and specs pass). Type-only imports are fine.
- No cost data in the Grid client bundle beyond what the page already sends. The page already sends `PartLite.cost` for Grid-library parts and `LaborPartLite.cost`; nothing else may cross. This feature REMOVES D139's crossing: no `engineFabrics`, no `TIER_SKUS`, no curtain-pricing constants reachable from `grid/[id]/*` client files.

**Production scale and data safety**

- Production has ~37,400 catalog parts. Load the catalog at most once per request. No N+1: use one `getMany` for a targeted SKU set. Never send a whole-catalog payload to the client. Part search is server-side.
- Preview deploys share the production DB, so nothing auto-writes production data on page load. `ensureGridSymbolsFor`, `setBlob` and placement writes happen only inside user-invoked server actions. The existing #210 `listFixtures()` first-read conversion is already skipped on previews and is not new.
- The equipment map starts EMPTY: nothing is auto-mapped. The old figures appear only as "was $X" hints plus suggested matches.
- Auto never uses an unconfirmed or empty row, and never a fallback dollar.
- Existing Grid projects, Manual/Blank designs and quotes stay unchanged: no migration and no rewrite of stored placements or quotes. Reading legacy docs must keep working (`qty`, `auto` and `autoEstimate` are optional).

**UI rules**

- Accent-coloured UI uses `var(--accent)`, never a hardcoded accent.
- Destructive UI goes through `ConfirmButton` (`@/components/confirm-button`).
- Equipment map editing uses the Estimating Rules permission: `requirePerm("manage_users")`. Every change stamps who/when (epoch-ms).

**Numbering and working rules**

- Placeholders are `#GEM` (punch item) and `D-GEM-1` … `D-GEM-9` (decisions). The lead renumbers them at merge.
- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/grid-equipment-map`. Never `cd` to `/Users/sm/Downloads/peak-app`.
- Never open a real `.data/pglite`, never `git stash`, and never start a dev server by hand (`test:smoke` boots its own on a scratch datadir).
- Commit after every task and end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Resolved spec ambiguities (binding for every task)

**The Equipment map**

1. **Row count.** The spec says "~60". The real equations emit exactly **46** distinct items: 16 rigging, 5 curtains, 5 lighting, 9 controls, 3 audio, 3 video, 3 acoustical and 2 pit. The vocabulary is those 46, and an exhaustiveness test pins it both ways.
2. **Blob shape.** The spec's `{ rows: Record<…> }` is flattened: each row is its own top-level key of blob `grid_equipment_map`. `setBlob` merges atomically per top-level key (`jsonb ||`), so two admins editing different rows can't overwrite each other. Clearing a row writes `null`, which the reader drops.
3. **"Same for all tiers".** The Good cell is canonical. Saving writes it into all three tiers, and the resolver reads Good whenever `sameAll` is set.
4. **Confirmed allowance.** An allowance cell can be saved only with "I confirm this allowance" ticked. `confirmedBy`/`confirmedAt` are restamped only when the amount or note changes. The resolver treats any allowance without `amount > 0`, `confirmedBy` and `confirmedAt` as needs-a-part.
5. **Permission.** The spec's "rates permission used by Estimating Rules" is `manage_users`, the gate on both Estimating Rules and Grid Settings.
6. **Resolved row status.** On the map page, a row whose cell points at a deleted part or an unpriced assembly shows **Needs a part**. Status is computed from the resolved prices, not only from whether a cell exists.

**Pricing**

7. **Part sell.** Sell is catalog `list` when it is > 0, else `cost ÷ (1 − catalog_rates.defaultMargin)`; the spec calls this "a catalog part without its own sell price". A part with neither → needs a part. **Assembly:** `resolveFixture` included cost/sell, with sell falling back to cost ÷ (1 − m) when its parts carry no list.
8. **Fabric rows.** The area rate is the mapped Fabric-category part's `curtainAreaRate ?? costPerSqft`, with no `SEED_FABRIC_RATES` fallback; neither present → needs a part. Making labor stays `makingRateFor()` (a rate). `SEED_FABRIC_RATES` itself stays for the Estimator, the portal and Grid curtain drop-ins (`fabricAreaRate`). Those are other features, and each reads the catalog rate first.
9. **What "leaves the code" covers.** These leave every pricing path: `TIER_SKUS`; every rigging/controls/audio/video/shell/pit `cost:` literal; the video screen `width × 260`; the scenery-track $3/ft; and the engine's `SEED_FABRIC_RATES` use. They survive only in a server-only hint table. Tier multipliers (`TIERS.costMul/priceMul`) become inert, because every system is resolved per tier (`tierFixed`).
10. **Scenery track.** This is the only unit change. It now emits **feet** (count × pipe length) instead of "ea at pipe-length × $3", so a per-foot catalog track prices it.
11. **Bundle split.** Pricing (`applyEquipment`, `tierSystems`, drape costing) moves to `src/lib/design/equipment-pricing.ts`. `engine.ts` keeps sizing only and imports nothing cost-bearing. The Grid's client files import engine VALUES (`VENUES`, `SUBCFG`, …), so this keeps cost constants out of that bundle.

**Scope targets**

12. **Server-side targets.** Scope targets are computed in `grid/[id]/page.tsx` from `tierDefsDefault()`, and only sell numbers are sent. The per-browser "line sets" dial (`tierDefs.sets`, localStorage) no longer moves Grid targets.
13. **Empty-map targets.** While the map is empty, Blank designs' Scope targets show "no target" plus a needs-a-part count. That is expected; it changes only the target lens, not any stored data.

**Auto and the canvas**

14. **Auto scopes.** Auto covers the five Grid scopes: Lighting, Rigging, Curtains, Audio and Video (the intake's scope list). The Controls, Acoustical and Pit rows exist in the map because Quick Design still prices them, but Auto never fills them.
15. **Assemblies and allowances on the canvas.** They are ordinary placements with a virtual part id: `asm:<fixtureId>` or `allow:<rowKey>:<tier>`. The server resolves each id live into a `PartLite` carrying desc, unit, list, cost, scope, `virtual` and `allowance`, so the BOM, riser, schedule, set and quote work unchanged. An allowance whose map cell is no longer a confirmed allowance prices at $0 and says so, rather than showing a stale dollar.
16. **Lot rows.** Hardware sold by count or length (footblocks, arbors, cable, pipe, handline, termination kits, …) lands as ONE placement carrying `qty`, and so does any row with qty > 120. The BOM, schedule, riser and space rollups multiply by `placementQty()`. Labor suggestions still count one per placement.
17. **Curtain rows.** They land as ordinary curtain drop-ins (a `GridCurtain` on the mapped fabric). A pair (Draw or Legs) lands as one drape with the pair's combined width. This is price-identical: the two-term model is linear in width at a fixed height.
18. **Tier changes and overrides.** Changing a card's tier resets that scope's swaps and qty edits, because the tier pre-fills them. Otherwise overrides are keyed per row.
19. **Equations vs. geometry.** Equations run on the project's live `scopeInputs`. Placement geometry uses `intake.autoConfig`, the input the base sheet was drawn from. Fills go onto `sheetIds[0]`, the generated base sheet.
20. **When the fill runs.** The first fill runs inside the first-save gate, after `generateBaseSheet`. If it fails, the plan still opens with a warning, and "Change equipment…" re-fills; there is no retry loop. `autoEstimate` is per project. Re-filling from any option updates it and paints only that option.

**Settings, entry points and flags**

21. **The Equipment map "tab".** It is the sub-route `/design/grid/settings/equipment-map`, with a General | Equipment map tab strip on both pages. The General page is one long card stack that does a whole-catalog port-rules pass. Suggested matches load on demand per row (one catalog pass per click), not for 46 rows on page load.
22. **"New design".** Only controls labelled **New design** open the Grid intake: the Designs dashboard ×3 and Home › My designs ×2. "New estimate" and "Start a rough estimate" (Home greeting/pipeline) still open Quick Design, which stays for existing designs.
23. **Intake storage.** Blank keeps `intake.mode = "manual"` (existing docs unchanged). Auto stores `"auto"`. Auto never sets a placement's user `category`, so Jeff's category vocabulary stays his.
24. **Internal allowance flag.** It shows as an "Allowance" tag on the Equipment step, the Scope panel and the Grid BOM sidebar, and as `allowance: true` on the saved quote `spec.lines` entry. Customer documents print the line normally. Targets and the Equipment step sell at the catalog default margin. The Grid quote still tier-prices every placement by `cost ÷ (1 − tier margin)`, as it does for every catalog device.

## Worktree setup (once, before Task 1)

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/grid-equipment-map
export PATH=$HOME/.local/node/bin:$PATH
ls node_modules >/dev/null 2>&1 || npm ci --no-audit --no-fund      # never symlink node_modules
[ -f next-env.d.ts ] || printf '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n' > next-env.d.ts
[ -f .env.local ] || printf 'AUTH_SECRET=%s\nAUTH_DEV_LOGIN=true\nAUTH_TRUST_HOST=true\n' "$(openssl rand -base64 32)" > .env.local
```

`next-env.d.ts` and `.env.local` are gitignored and must never be committed. Baseline measured on `21e391de`: `npx tsc --noEmit` is clean; `npx eslint` → `✖ 110 problems (0 errors, 110 warnings)`; `npm run test:specs` → `ALL PASSED` with **3950** `PASS` lines.

| Gate | Command | Pass |
|---|---|---|
| types | `npx tsc --noEmit` | no output, exit 0 |
| lint | `npx eslint` | 0 errors, ≤ 110 warnings |
| pure specs | `npm run test:specs` | last line `ALL PASSED`; `grep -c '^PASS'` = previous count + this task's new `ok(` calls |
| DB regressions | `env -u DATABASE_URL npm run test:review:regressions` | `review regression checks passed` |
| routes | `npm run test:smoke` | every route OK |
| build | `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build` then `rm -rf .next` | build succeeds |

Every task runs **types + lint + pure specs**. Tasks that touch the DB also run **DB regressions**. Tasks that add or change a `'use client'` file also run **build**, because a client→store import passes tsc and specs and fails only in `next build`.

**Test-file rules:**
- `scripts/test-review-and-spec.ts` is one ESM file. Imports are hoisted, and a duplicate local binding kills the whole suite. Every new block therefore imports with a `gem…` alias that no other block uses, and each block sits in its own `{ … }` scope, appended at EOF.
- `ok(cond, msg)` and `readFileSync`/`join` are already in scope (lines 242–243, 324).
- `scripts/test-review-regressions.ts` blocks go **before** the final `/* --- #210 final review M5 … LAST … */` block, which wipes every doc collection.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/design/equipment-vocab.ts` | create | Pure, dollar-free. `EQUIPMENT_ROWS` (46 rows keyed `system:itemKey`, label = the equation's item name, unit, placement kind, search words, curtain type), `EQUIPMENT_ROW_BY_KEY`, `EQUIP_SYSTEM_LABEL`. |
| `src/lib/design/equipment-legacy-hints.ts` | create | **Server-only.** The removed dollars as "was $X" hints (`LEGACY_HINTS`, `legacyHintText`, `legacyHintSkus`). Never used in a total. |
| `src/lib/design/equipment-map.ts` | create | Pure. Cell/row/map types, sanitize, `cellFor`, `rowStatus`, `mergeEquipRow`, `sellFromCost`, `priceCell` → `UnitPrice`, `buildEquipmentPriceTable`, `mapSkus`. |
| `src/lib/stores/equipment-map.ts` | create | Server store: `getEquipmentMap`, `saveEquipmentRow`, `clearEquipmentRow`, `loadEquipPriceCtx`, `loadEquipmentPriceTable`, `loadVirtualParts`. |
| `src/lib/design/equipment-map-view.ts` | create | Pure. The Equipment map page's row/cell view models, `assemblyOptions`, `suggestParts`. |
| `src/app/(app)/design/grid/settings/settings-tabs.tsx` | create | Server component: General / Equipment map tab strip. |
| `src/app/(app)/design/grid/settings/equipment-map/page.tsx` | create | Admin page: loads map + assemblies + targeted parts, renders the client. |
| `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx` | create | Client editor (rows by system, status filter, per-tier cell editor, part search/suggest, assembly picker, confirmed allowance, clear). |
| `src/app/(app)/design/grid/settings/{page.tsx,actions.ts}` | modify | Tab strip; four Equipment map actions. |
| `src/lib/design/scope-targets.ts` | create | Pure. `ScopeTarget(s)`, `targetsFromSystems`, `scopeTargetsByTier`. |
| `src/lib/design/equipment-pricing.ts` | create | Pure (cost-bearing — never imported by a Grid client file). `drapeUnitCost`, `applyEquipment`, `tierSystems`, `tierSystemsBase`. |
| `src/app/(app)/design/quick/engine.ts` | modify | Items carry `key`; quantities only (no dollars); pricing helpers removed; `scopeTargets` removed. |
| `src/app/(app)/design/quick/{page.tsx,quick-design-client.tsx}`, `src/app/(app)/design/designs/{page.tsx,design-client.tsx}` | modify | Price through the map table; New design button. |
| `src/lib/design/grid-seed.ts` | modify | Trimmed to the placeholder helpers (`SEED_PART_PREFIX`, `seedPlaceholderPartId`, `isSeedPlaceholder`) — the D147/D186 quote guard still reads them. |
| `src/lib/design/grid-auto-model.ts` | create | Pure. `AutoTag`, `AutoOverride`, `AutoEstimate`, `sanitizeAutoEstimate`, `mergeScopeEstimate`, `overrideRefs`. |
| `src/lib/design/grid-virtual-parts.ts` | create | Pure. `asm:`/`allow:` ids, `parseVirtualPartId`, `virtualPartsFor`. |
| `src/lib/design/{grid-bom.ts,grid-schedule.ts,grid-riser.ts,grid-scopes.ts}` | modify | `placementQty`, `PartLite.virtual/allowance`, qty-aware totals, `GRID_SCOPE_OF_SYS`. |
| `src/lib/stores/grid-projects.ts` | modify | `GridPlacement.qty/auto`, `GridProject.autoEstimate`, `replaceAutoPlacements`, `setAutoEstimate`, move/category clear `auto`. |
| `src/lib/stores/grid-catalog.ts` | modify | `ensureGridSymbolsFor`. |
| `src/lib/design/grid-quote.ts` | modify | Virtual parts priced; `allowance: true` spec lines. |
| `src/lib/design/auto-estimate.ts` | create | Pure. `AutoLine`/`AutoCard`, `clampScopeInputs`, `priceOverrides`, `autoEstimateCards`, `sellOnlyCards`, `autoTargets`. |
| `src/lib/design/grid-auto-layout.ts` | create | Pure. `venueFrame`, `partIdForLine`, `generateAutoLayout` (placement rules). |
| `src/lib/design/grid-auto-fill.ts` | create | Server-only. `fillAutoScopes` (map → cards → layout → `replaceAutoPlacements`). |
| `src/lib/design/grid-intake.ts` | modify | `intakeScopeInputs`. |
| `src/app/(app)/design/grid/[id]/{grid-intake.tsx,scope-picker.tsx,equipment-card.tsx,refill-dialog.tsx}` | create/rewrite | The one intake; the shared Equipment card/picker/preview hook; the re-fill dialog. |
| `src/app/(app)/design/grid/[id]/{actions.ts,page.tsx,editor.tsx,scope-panel.tsx}` | modify | Actions (preview, search, intake save, re-fill); server targets; virtual parts; Auto scope rows. |
| `src/app/(app)/design/grid/[id]/{riser,set,schedule}/page.tsx` | modify | Append virtual parts. |
| `src/components/design/new-design-button.tsx` | create | Client: create a Grid design and open its intake. |
| `src/app/(app)/home-my-designs.tsx` | modify | New design → button. |
| `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`, `scripts/smoke-routes.ts` | modify | Tests; one smoke route. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | modify | Docs (Task 10). |

---

### Task 1: The equation item vocabulary + the old figures as hints

**Files:**
- Create: `src/lib/design/equipment-vocab.ts`
- Create: `src/lib/design/equipment-legacy-hints.ts`
- Modify: `src/app/(app)/design/quick/engine.ts`: `BomItem`, which gains `key` (lines 47–56), and `compute()`'s item literals (lines 515–679). Pricing is unchanged in this task.
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes: `SysKey`, `TierKey`, `compute`, `defaultAState`, `AState` from `@/app/(app)/design/quick/engine`.
- Produces:
  - `type EquipPlace = "each" | "lot" | "curtain" | "none"`
  - `type CurtainRowType = { drape: "Draw" | "Legs" | "Border" | "Rear"; grid: "Draw" | "Leg" | "Border" | "Full" }`
  - `type EquipRowDef = { key: string; system: SysKey; itemKey: string; label: string; unit: string; place: EquipPlace; search: string[]; curtain?: CurtainRowType }`
  - `EQUIPMENT_ROWS: readonly EquipRowDef[]` (46)
  - `EQUIPMENT_ROW_BY_KEY: ReadonlyMap<string, EquipRowDef>`
  - `EQUIP_SYSTEM_LABEL: Record<SysKey, string>`
  - `BomItem.key: string`; every `compute()` item carries it.
  - Server-only:
    - `type LegacyHint = { perTier?: Record<TierKey, number>; per?: string; note?: string; skus?: Partial<Record<TierKey, string>> }`
    - `LEGACY_HINTS: Record<string, LegacyHint>`
    - `legacyHintText(h: LegacyHint | undefined): string`
    - `legacyHintSkus(h: LegacyHint | undefined): string[]`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T1: the equation item vocabulary — every compute() item has a map row, and back --- */
import { EQUIPMENT_ROWS as gemRows1, EQUIPMENT_ROW_BY_KEY as gemRowByKey1 } from "@/lib/design/equipment-vocab";
import { compute as gemCompute1, defaultAState as gemDefault1, type AState as GemAState1 } from "@/app/(app)/design/quick/engine";
import { LEGACY_HINTS as gemHints1, legacyHintSkus as gemHintSkus1, legacyHintText as gemHintText1 } from "@/lib/design/equipment-legacy-hints";
{
  const keys = gemRows1.map((r) => r.key);
  ok(keys.length === 46 && new Set(keys).size === 46, `#GEM T1: 46 unique equipment rows (got ${keys.length})`);
  ok(gemRows1.every((r) => r.key === `${r.system}:${r.itemKey}` && /^[a-z]+:[a-zA-Z]+$/.test(r.key)), "#GEM T1: every key is system:itemKey");
  ok(gemRows1.every((r) => gemRowByKey1.get(r.key) === r), "#GEM T1: the by-key index covers every row");
  const emitted = new Map<string, string>();
  const base = gemDefault1(0);
  for (const size of ["small", "medium", "large"] as const)
    for (const rigType of ["counterweight", "deadhung", "motorized"])
      for (const pitType of ["legged", "clearspan"]) {
        const s: GemAState1 = {
          ...base, venue: "pac", size, width: 60, depth: 40, grid: 50, wing: 16, ph: 26, rigType, pitType,
          sys: { rigging: true, curtains: true, lighting: true, controls: true, audio: true, video: true, acoustical: true, pit: true },
          drape: { draw: true, legs: true, border: true, scenerytrack: true, fullstage: true },
          fixtures: { par: true, front: true, cyc: true, side: true, automated: true },
          ctrl: { console: true, architectural: true, data: true },
          shell: { towers: true, ceiling: true, transport: true },
        };
        for (const sys of gemCompute1(s).systems) for (const it of sys.items) emitted.set(it.key, it.desc);
      }
  const unknown = [...emitted.keys()].filter((k) => !gemRowByKey1.has(k));
  ok(unknown.length === 0, `#GEM T1: every item compute() emits has an Equipment map row (unknown: ${unknown.join(", ") || "none"})`);
  const never = keys.filter((k) => !emitted.has(k));
  ok(never.length === 0, `#GEM T1: every Equipment map row is emitted by some configuration (never: ${never.join(", ") || "none"})`);
  ok([...emitted].every(([k, desc]) => gemRowByKey1.get(k)?.label === desc), "#GEM T1: each row's label is the equation's own item name");
  ok(gemRows1.filter((r) => r.place === "curtain").map((r) => r.itemKey).join(",") === "draw,legs,border,fullstage", "#GEM T1: the four fabric drapes are the curtain rows");
  ok(gemRows1.filter((r) => ["controls", "acoustical", "pit"].includes(r.system)).every((r) => r.place === "none"), "#GEM T1: Controls / Acoustical / Pit rows are never Auto-placed");
  ok(keys.every((k) => gemHintText1(gemHints1[k]).startsWith("was ")), "#GEM T1: every row carries its old built-in figure as a 'was' hint");
  ok(gemHintText1(gemHints1["rigging:electricHoist"]) === "was $48,000 / $60,000 / $78,000", `#GEM T1: rigging hints carry the old tier multipliers (got ${gemHintText1(gemHints1["rigging:electricHoist"])})`);
  ok(gemHintText1(gemHints1["lighting:par"]) === "was $500 / $750 / $1,150", "#GEM T1: lighting hints are the old TIER_SKUS figures");
  ok(gemHintText1(gemHints1["curtains:scenerytrack"]) === "was $3 per ft", "#GEM T1: one figure prints once, with its unit");
  ok(gemHintSkus1(gemHints1["curtains:legs"]).join(",") === "RB-EN-16,RB-EN-22,RB-CHAR-25", "#GEM T1: fabric hints name the old per-tier fabric SKUs");
  const hintSrc = readFileSync(join(process.cwd(), "src/lib/design/equipment-legacy-hints.ts"), "utf8");
  ok(hintSrc.includes('typeof window !== "undefined"'), "#GEM T1: the hint table refuses to load in a browser bundle");
  const vocabSrc = readFileSync(join(process.cwd(), "src/lib/design/equipment-vocab.ts"), "utf8");
  ok(!/\$\s?\d/.test(vocabSrc) && !/\bcost\b/i.test(vocabSrc), "#GEM T1: the vocabulary is dollar-free");
}
```

This block has **14** `ok(` calls.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: tsx cannot resolve `@/lib/design/equipment-vocab` (module not found).

- [ ] **Step 3: Create the vocabulary**

Create `src/lib/design/equipment-vocab.ts`:

```ts
/**
 * The equation item vocabulary (#GEM, D-GEM-1). Every item compute()
 * (quick/engine.ts) can emit, keyed `system:itemKey` — stable keys, never
 * display text. The Equipment map, the Auto intake and saved overrides all key
 * on these, so a relabel never orphans a mapping. `label` is the equation's
 * own item name (asserted equal by the #GEM T1 spec block). Pure and
 * dollar-free: client components may import it.
 *
 * `place` is how Auto lands a row on the plan: "each" = one marker per unit,
 * "lot" = one marker carrying the quantity (count/length hardware), "curtain"
 * = a curtain drop-in on the mapped fabric, "none" = never Auto-placed
 * (Controls / Acoustical / Pit are not Grid scopes; Quick Design still prices
 * them). `search` feeds the Equipment map's suggested catalog matches.
 */
import type { SysKey } from "@/app/(app)/design/quick/engine";

export type EquipPlace = "each" | "lot" | "curtain" | "none";
export type CurtainRowType = { drape: "Draw" | "Legs" | "Border" | "Rear"; grid: "Draw" | "Leg" | "Border" | "Full" };

export type EquipRowDef = {
  key: string;
  system: SysKey;
  itemKey: string;
  label: string;
  unit: string;
  place: EquipPlace;
  search: string[];
  curtain?: CurtainRowType;
};

function row(
  system: SysKey,
  itemKey: string,
  label: string,
  unit: string,
  place: EquipPlace,
  search: string[],
  curtain?: CurtainRowType
): EquipRowDef {
  return { key: `${system}:${itemKey}`, system, itemKey, label, unit, place, search, ...(curtain ? { curtain } : {}) };
}

export const EQUIPMENT_ROWS: readonly EquipRowDef[] = [
  // Rigging — motorized
  row("rigging", "electricHoist", "Electric hoist", "ea", "each", ["hoist", "motor"]),
  row("rigging", "lowCapHoist", "Low-capacity hoist", "ea", "each", ["hoist", "motor"]),
  row("rigging", "highCapHoist", "High-capacity hoist", "ea", "each", ["hoist", "motor"]),
  row("rigging", "varSpeedHoist", "Variable-speed hoist", "ea", "each", ["variable", "hoist", "motor"]),
  // Rigging — dead hung
  row("rigging", "riggingPoint", "Rigging point", "ea", "each", ["rigging point", "beam clamp", "shackle"]),
  // Rigging — counterweight
  row("rigging", "headblock", "Headblock", "ea", "each", ["head block", "headblock"]),
  row("rigging", "footblock", "Footblock", "ea", "lot", ["foot block", "footblock", "tension"]),
  row("rigging", "arbor", "Arbor", "ea", "lot", ["arbor"]),
  row("rigging", "tbarTrack", "T-bar track", "ea", "lot", ["t-bar", "track"]),
  row("rigging", "lockRail", "Lock rail", "ea", "lot", ["rope lock", "lock rail"]),
  row("rigging", "handline", "Handline", "ft", "lot", ["handline", "hand line", "rope"]),
  row("rigging", "loftblock", "Loftblock", "ea", "lot", ["loft block", "loftblock"]),
  // Rigging — shared by dead hung + counterweight
  row("rigging", "pipe", "Pipe", "ft", "lot", ["pipe", "batten"]),
  row("rigging", "aircraftCable", "Aircraft cable", "ft", "lot", ["aircraft cable", "wire rope"]),
  row("rigging", "chainWrap", "Chain wrap, 3 ft", "ea", "lot", ["chain"]),
  row("rigging", "terminationKit", "Termination kit", "ea", "lot", ["termination", "swage", "thimble"]),
  // Curtains — the four drapes resolve per area from a mapped Fabric part
  row("curtains", "draw", "Draw", "ea", "curtain", ["velour", "drape"], { drape: "Draw", grid: "Draw" }),
  row("curtains", "legs", "Leg", "ea", "curtain", ["velour", "leg"], { drape: "Legs", grid: "Leg" }),
  row("curtains", "border", "Border", "ea", "curtain", ["velour", "border"], { drape: "Border", grid: "Border" }),
  row("curtains", "fullstage", "Full stage", "ea", "curtain", ["velour", "traveler"], { drape: "Rear", grid: "Full" }),
  row("curtains", "scenerytrack", "Scenery track", "ft", "lot", ["track", "traveler"]),
  // Lighting
  row("lighting", "par", "Par", "ea", "each", ["par", "wash"]),
  row("lighting", "front", "Front", "ea", "each", ["ellipsoidal", "profile", "leko"]),
  row("lighting", "cyc", "Cyc", "ea", "each", ["cyc"]),
  row("lighting", "side", "Side light", "ea", "each", ["wash", "side"]),
  row("lighting", "automated", "Automated", "ea", "each", ["moving", "automated"]),
  // Controls (Quick Design only)
  row("controls", "console", "Console", "ea", "none", ["console"]),
  row("controls", "consoleTouch", "Console touch screen", "ea", "none", ["touch", "monitor"]),
  row("controls", "batteryBackup", "Battery backup", "ea", "none", ["ups", "battery"]),
  row("controls", "processor", "Processor", "ea", "none", ["processor", "architectural"]),
  row("controls", "button", "Button", "ea", "none", ["button", "station"]),
  row("controls", "archTouch", "Architectural touch screen", "ea", "none", ["touch"]),
  row("controls", "inputStation", "Input station", "ea", "none", ["input", "node"]),
  row("controls", "outputStation", "Output station", "ea", "none", ["output", "node"]),
  row("controls", "distro", "Distro system", "ea", "none", ["distro", "switch", "gateway"]),
  // Audio
  row("audio", "lineArray", "Line-array loudspeaker", "ea", "each", ["line array", "loudspeaker", "speaker"]),
  row("audio", "subwoofer", "Subwoofer", "ea", "each", ["subwoofer"]),
  row("audio", "mixerDsp", "Digital mixer, DSP & amplifiers", "lot", "each", ["mixer", "dsp", "amplifier"]),
  // Video
  row("video", "projector", "Laser projector, 4K", "ea", "each", ["projector"]),
  row("video", "screen", "Projection screen / LED wall", "lot", "each", ["screen", "led wall"]),
  row("video", "processor", "Video processor & switcher", "lot", "each", ["switcher", "scaler", "video processor"]),
  // Acoustical shell (Quick Design only)
  row("acoustical", "tower", "Tower", "ea", "none", ["shell", "tower"]),
  row("acoustical", "ceiling", "Ceiling", "ea", "none", ["shell", "ceiling"]),
  row("acoustical", "transport", "Transport", "ea", "none", ["cart", "transport"]),
  // Pit filler (Quick Design only)
  row("pit", "legged", "Legged pit filler deck", "sqft", "none", ["pit", "deck"]),
  row("pit", "clearspan", "Clear-span pit filler deck", "sqft", "none", ["pit", "deck"]),
];

export const EQUIPMENT_ROW_BY_KEY: ReadonlyMap<string, EquipRowDef> = new Map(EQUIPMENT_ROWS.map((r) => [r.key, r]));

export const EQUIP_SYSTEM_LABEL: Record<SysKey, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  controls: "Controls",
  audio: "Audio",
  video: "Video",
  acoustical: "Acoustical",
  pit: "Pit",
};
```

The file has no `$<digit>` and no word "cost", which is what the dollar-free assertion checks.

- [ ] **Step 4: Create the server-only hint table**

Create `src/lib/design/equipment-legacy-hints.ts`:

```ts
/**
 * The dollars that used to live in quick/engine.ts (#GEM, D-GEM-4) — TIER_SKUS,
 * the rigging/controls/audio/video/shell/pit `cost:` literals, the video screen
 * `width × 260`, the scenery-track $3/ft and the curtain seed fabric rates —
 * kept ONLY as "was $X" hints on the Equipment map so Jeff can see what the
 * old equations assumed while he maps each row to a real catalog part.
 * Never read by any total. Server-only: the Equipment map page renders these
 * to strings; no client component imports this module.
 *
 * Rigging had no TIER_SKUS row: its tier figure was the base cost × the old
 * tier cost multiplier (0.8 / 1.0 / 1.3). Curtains priced per sq ft of the
 * old per-tier fabric SKU (goods.ts FABRIC_BY_TYPE_TIER) plus making labor.
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";

if (typeof window !== "undefined") throw new Error("equipment-legacy-hints is server-only");

export type LegacyHint = {
  perTier?: Record<TierKey, number>;
  per?: string;
  note?: string;
  skus?: Partial<Record<TierKey, string>>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const T = (good: number, better: number, best: number): Record<TierKey, number> => ({ good, better, best });
/** Rigging: the old base cost × the old tier cost multipliers. */
const mul = (base: number): Record<TierKey, number> => T(round2(base * 0.8), base, round2(base * 1.3));

const VELOUR = { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" };
const VELOUR_NOTE = "RB-EN-22 / RB-CHAR-25 / RB-MV-MN at $2.84 / $3.64 / $4.37 per sq ft, plus making";

export const LEGACY_HINTS: Record<string, LegacyHint> = {
  "rigging:electricHoist": { perTier: mul(60000) },
  "rigging:lowCapHoist": { perTier: mul(15000) },
  "rigging:highCapHoist": { perTier: mul(40000) },
  "rigging:varSpeedHoist": { perTier: mul(60000) },
  "rigging:riggingPoint": { perTier: mul(20) },
  "rigging:headblock": { perTier: mul(550) },
  "rigging:footblock": { perTier: mul(350) },
  "rigging:arbor": { perTier: mul(700) },
  "rigging:tbarTrack": { perTier: mul(100) },
  "rigging:lockRail": { perTier: mul(30) },
  "rigging:handline": { perTier: mul(3), per: "ft" },
  "rigging:loftblock": { perTier: mul(250) },
  "rigging:pipe": { perTier: mul(8), per: "ft" },
  "rigging:aircraftCable": { perTier: mul(0.02), per: "ft" },
  "rigging:chainWrap": { perTier: mul(1) },
  "rigging:terminationKit": { perTier: mul(1) },
  "curtains:draw": { note: VELOUR_NOTE, skus: VELOUR },
  "curtains:legs": {
    note: "RB-EN-16 / RB-EN-22 / RB-CHAR-25 at $2.10 / $2.84 / $3.64 per sq ft, plus making",
    skus: { good: "RB-EN-16", better: "RB-EN-22", best: "RB-CHAR-25" },
  },
  "curtains:border": { note: VELOUR_NOTE, skus: VELOUR },
  "curtains:fullstage": { note: VELOUR_NOTE, skus: VELOUR },
  "curtains:scenerytrack": { perTier: T(3, 3, 3), per: "ft" },
  "lighting:par": { perTier: T(500, 750, 1150) },
  "lighting:front": { perTier: T(1600, 2250, 3400) },
  "lighting:cyc": { perTier: T(1200, 1750, 2600) },
  "lighting:side": { perTier: T(1250, 1800, 2700) },
  "lighting:automated": { perTier: T(2100, 3000, 4600) },
  "controls:console": { perTier: T(4800, 7000, 10500) },
  "controls:consoleTouch": { perTier: T(1400, 2000, 3000) },
  "controls:batteryBackup": { perTier: T(20, 30, 45) },
  "controls:processor": { perTier: T(7000, 10000, 15000) },
  "controls:button": { perTier: T(180, 250, 380) },
  "controls:archTouch": { perTier: T(1400, 2000, 3000) },
  "controls:inputStation": { perTier: T(70, 100, 150) },
  "controls:outputStation": { perTier: T(90, 125, 190) },
  "controls:distro": { perTier: T(2100, 3000, 4500) },
  "audio:lineArray": { perTier: T(1000, 1450, 2200) },
  "audio:subwoofer": { perTier: T(1300, 1850, 2800) },
  "audio:mixerDsp": { perTier: T(9900, 14200, 21500) },
  "video:projector": { perTier: T(13000, 18500, 28000) },
  "video:screen": { note: "$208 / $260 / $338 per ft of room width" },
  "video:processor": { perTier: T(6800, 9800, 14800) },
  "acoustical:tower": { perTier: T(7000, 10000, 15000) },
  "acoustical:ceiling": { perTier: T(14000, 20000, 30000) },
  "acoustical:transport": { perTier: T(700, 1000, 1500) },
  "pit:legged": { perTier: T(100, 125, 165), per: "sq ft" },
  "pit:clearspan": { perTier: T(120, 150, 200), per: "sq ft" },
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "was $500 / $750 / $1,150" · "was $3 per ft" · "was RB-EN-22 / … plus making". "" for no hint. */
export function legacyHintText(h: LegacyHint | undefined): string {
  if (!h) return "";
  if (h.note) return `was ${h.note}`;
  const t = h.perTier;
  if (!t) return "";
  const figures = t.good === t.better && t.better === t.best ? money(t.better) : `${money(t.good)} / ${money(t.better)} / ${money(t.best)}`;
  return `was ${figures}${h.per ? ` per ${h.per}` : ""}`;
}

/** The old per-tier fabric SKUs (Good, Better, Best order, de-duplicated) — offered as suggestions. */
export function legacyHintSkus(h: LegacyHint | undefined): string[] {
  if (!h?.skus) return [];
  return [...new Set([h.skus.good, h.skus.better, h.skus.best].filter((s): s is string => !!s))];
}
```

- [ ] **Step 5: Give every `compute()` item its key**

In `src/app/(app)/design/quick/engine.ts`:

(a) Add `key` to `BomItem` (line 47):

```ts
export type BomItem = {
  /** Equipment map row key, `system:itemKey` (#GEM, equipment-vocab.ts). */
  key: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  area?: number;
  fabricKey?: string | null;
  sku?: boolean;
};
```

(b) Replace everything from the `// Rigging — single type` comment (line 515) through the end of the `const systems: SystemBlock[] = defs.map(...)` statement (line 679) with the block below. It is the same code with a `key` on every item, and costs stay unchanged in this task:

```ts
  // Rigging — single type
  type EqItem = { key: string; desc: string; unit: string; qty: number; cost: number; area?: number; fabricKey?: string | null };
  const rigType = s.rigType || "counterweight";
  let rigItems: EqItem[];
  if (rigType === "motorized") {
    const m = pick({ el: 2, lo: 2, hi: 2, vs: 0 }, { el: 3, lo: 3, hi: 3, vs: 1 }, { el: 4, lo: 4, hi: 2, vs: 2 });
    rigItems = [
      { key: "rigging:electricHoist", desc: "Electric hoist", unit: "ea", qty: m.el * Math.max(2, fl(D / 30)), cost: 60000 },
      { key: "rigging:lowCapHoist", desc: "Low-capacity hoist", unit: "ea", qty: m.lo * dBlk, cost: 15000 },
      { key: "rigging:highCapHoist", desc: "High-capacity hoist", unit: "ea", qty: m.hi * dBlk, cost: 40000 },
    ];
    if (m.vs) rigItems.push({ key: "rigging:varSpeedHoist", desc: "Variable-speed hoist", unit: "ea", qty: m.vs * dBlk, cost: 60000 });
  } else if (rigType === "deadhung") {
    const sets = pick(5, 6, 7) * dBlk;
    const points = sets * fl(W / 10);
    rigItems = [
      { key: "rigging:riggingPoint", desc: "Rigging point", unit: "ea", qty: points, cost: 20 },
      { key: "rigging:pipe", desc: "Pipe", unit: "ft", qty: sets * pipeLenFt, cost: 8 },
      { key: "rigging:aircraftCable", desc: "Aircraft cable", unit: "ft", qty: points * G, cost: 0.02 },
      { key: "rigging:chainWrap", desc: "Chain wrap, 3 ft", unit: "ea", qty: points, cost: 1 },
      { key: "rigging:terminationKit", desc: "Termination kit", unit: "ea", qty: points * 2, cost: 1 },
    ];
  } else {
    // Counterweight — driven by the number of line sets.
    const sets = pick(5, 6, 7) * dBlk;
    const loftPerSet = Math.max(1, fl(W / 10)); // 1 loftblock per 10 ft of pro width, per set
    const loft = sets * loftPerSet;
    rigItems = [
      { key: "rigging:headblock", desc: "Headblock", unit: "ea", qty: sets, cost: 550 },
      { key: "rigging:footblock", desc: "Footblock", unit: "ea", qty: sets, cost: 350 },
      { key: "rigging:arbor", desc: "Arbor", unit: "ea", qty: sets, cost: 700 },
      { key: "rigging:tbarTrack", desc: "T-bar track", unit: "ea", qty: sets, cost: 100 },
      { key: "rigging:lockRail", desc: "Lock rail", unit: "ea", qty: sets, cost: 30 },
      { key: "rigging:handline", desc: "Handline", unit: "ft", qty: sets * 2 * G, cost: 3 },
      { key: "rigging:pipe", desc: "Pipe", unit: "ft", qty: sets * pipeLenFt, cost: 8 },
      { key: "rigging:loftblock", desc: "Loftblock", unit: "ea", qty: loft, cost: 250 },
      { key: "rigging:aircraftCable", desc: "Aircraft cable", unit: "ft", qty: loft * (2 * G + W), cost: 0.02 },
      { key: "rigging:terminationKit", desc: "Termination kit", unit: "ea", qty: loft * 2, cost: 1 },
      { key: "rigging:chainWrap", desc: "Chain wrap, 3 ft", unit: "ea", qty: loft, cost: 1 },
    ];
  }

  // Curtains — multi. The four fabric drapes (Draw/Legs/Border/Rear) price
  // through the shared two-term make-it model, from the same goods.ts drape
  // geometry the quote side and the lineset weights use; qty per 10-ft depth
  // block. Scenery track is hardware, not soft goods, and keeps its lump
  // per-ft price via addCurtain.
  const drape = s.drape || {};
  const curtainItems: EqItem[] = [];
  const addCurtain = (on: boolean | undefined, key: string, desc: string, count: number, area: number, rate: number, fabricKey: string | null) => {
    if (on && count > 0) curtainItems.push({ key, desc, unit: "ea", qty: count, cost: Math.round(area * rate), area, fabricKey });
  };
  // `proscenium` gates the wing addition inside venueDimsFromEstimator (#66):
  // wing space is only OUTSIDE `width` for a real proscenium opening, same
  // venue-kind test `pipeLenFt` above already uses for the batten overhang.
  const gdims = venueDimsFromEstimator({ ...s, proscenium: venueOf(s).kind === "proscenium" });
  const priceDrape = (on: boolean | undefined, desc: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const r = curtainMakeCost(fabricKey, gdims, s.tier);
    if (!r) return;
    curtainItems.push({ key: `curtains:${fabricKey}`, desc, unit: "ea", qty: count, cost: r.cost, area: r.area, fabricKey });
  };
  priceDrape(drape.draw, "Draw", dBlk * 1, "draw");
  priceDrape(drape.legs, "Leg", dBlk * 2, "legs");
  priceDrape(drape.border, "Border", dBlk * 1, "border");
  priceDrape(drape.fullstage, "Full stage", dBlk * 1, "fullstage");
  // Track hardware, not soft goods. Jeff 2026-07-27: it follows the pipe rule,
  // so it spans the same length as the batten it parallels (PRO width + 4 ft in
  // a proscenium house, room width elsewhere) rather than raw stage width.
  addCurtain(drape.scenerytrack, "curtains:scenerytrack", "Scenery track", dBlk * 1, pipeLenFt * 1, 3, null);

  // Fixtures — multi. E = unified electric count; wUnit ≈ 1 per 8 ft of width.
  const fx = s.fixtures || {};
  const E = Math.max(1, electrics);
  const wUnit = Math.max(1, Math.round(W / 8));
  const lightItems: EqItem[] = [];
  const addFix = (key: string, on: boolean | undefined, desc: string, qty: number, cost: number) => {
    const selected = assemblyOptions[s.fixtureAssemblies?.[key] || ""];
    if (on && qty > 0) lightItems.push({ key: `lighting:${key}`, desc: selected?.name || desc, unit: "ea", qty, cost: selected?.cost || cost });
  };
  addFix("par", fx.par, "Par", Math.round(E * wUnit * pick(0.7, 1, 1.2)), 750);
  addFix("front", fx.front, "Front", Math.round(wUnit * pick(2, 2.5, 3)), 2250);
  addFix("cyc", fx.cyc, "Cyc", Math.round(wUnit * pick(1, 1.25, 1.5)), 1750);
  addFix("side", fx.side, "Side light", Math.round(E * wUnit * pick(0, 0.5, 0.75)), 1800);
  const automatedQty = Math.round(E * wUnit * pick(0, 0.5, 0.9));
  addFix("automated", fx.automated, "Automated", automatedQty, 3000);
  // dimmer racks derive from the real conventional-fixture total (movers are non-dim, DMX)
  const convFixTotal = lightItems.reduce((a, it) => a + it.qty, 0) - (fx.automated ? automatedQty : 0);
  dimmerRacks = s.sys.lighting ? Math.max(1, Math.ceil(convFixTotal / 48)) : 0;

  // Controls — multi (Console / Architectural / Data groups)
  const ctrl = s.ctrl || {};
  const ctrlItems: EqItem[] = [];
  if (ctrl.console) {
    ctrlItems.push({ key: "controls:console", desc: "Console", unit: "ea", qty: 1, cost: 7000 });
    ctrlItems.push({ key: "controls:consoleTouch", desc: "Console touch screen", unit: "ea", qty: pick(1, 2, 2), cost: 2000 });
    if (size === "large") ctrlItems.push({ key: "controls:batteryBackup", desc: "Battery backup", unit: "ea", qty: 1, cost: 30 });
  }
  if (ctrl.architectural) {
    ctrlItems.push({ key: "controls:processor", desc: "Processor", unit: "ea", qty: 1, cost: 10000 });
    ctrlItems.push({ key: "controls:button", desc: "Button", unit: "ea", qty: pick(fl(W / 20), fl(W / 10), fl(W / 5)), cost: 250 });
    if (size === "large") ctrlItems.push({ key: "controls:archTouch", desc: "Architectural touch screen", unit: "ea", qty: 1, cost: 2000 });
  }
  if (ctrl.data) {
    ctrlItems.push({ key: "controls:inputStation", desc: "Input station", unit: "ea", qty: pick(1, 2, 4), cost: 100 });
    ctrlItems.push({ key: "controls:outputStation", desc: "Output station", unit: "ea", qty: pick(2 * fl(D / 7), 2 * fl(D / 4), 2 * fl(D / 3)), cost: 125 });
    ctrlItems.push({ key: "controls:distro", desc: "Distro system", unit: "ea", qty: 1, cost: 3000 });
  }

  // Acoustical shell — multi (size-independent)
  const shell = s.shell || {};
  const shellItems: EqItem[] = [];
  if (shell.towers) shellItems.push({ key: "acoustical:tower", desc: "Tower", unit: "ea", qty: fl(W / 10) + 2 * fl(D / 10), cost: 10000 });
  if (shell.ceiling) shellItems.push({ key: "acoustical:ceiling", desc: "Ceiling", unit: "ea", qty: fl(D / 10), cost: 20000 });
  if (shell.transport) shellItems.push({ key: "acoustical:transport", desc: "Transport", unit: "ea", qty: fl(D / 10), cost: 1000 });

  // Pit filler — single. Per-sqft over Pro Width × 10 ft.
  const pitType = s.pitType || "legged";
  const pitArea = W * 10;
  const pitItems: EqItem[] =
    pitType === "clearspan"
      ? [{ key: "pit:clearspan", desc: "Clear-span pit filler deck", unit: "sqft", qty: pitArea, cost: 150 }]
      : [{ key: "pit:legged", desc: "Legged pit filler deck", unit: "sqft", qty: pitArea, cost: 125 }];

  const defs: Array<{ key: SysKey; name: string; on: boolean; m: number; dot: string; items: EqItem[] }> = [
    { key: "rigging", name: "Rigging", on: s.sys.rigging, m: 0.3, dot: "#7b3f8a", items: rigItems },
    { key: "curtains", name: "Curtains", on: s.sys.curtains, m: 0.3, dot: "#b4543a", items: curtainItems },
    { key: "lighting", name: "Fixtures", on: s.sys.lighting, m: 0.3, dot: "#c98a2b", items: lightItems },
    { key: "controls", name: "Controls", on: s.sys.controls, m: 0.3, dot: "#1f7a52", items: ctrlItems },
    { key: "acoustical", name: "Acoustical Shell", on: s.sys.acoustical, m: 0.3, dot: "#6f6f78", items: shellItems },
    { key: "pit", name: "Pit Filler", on: s.sys.pit, m: 0.3, dot: "#9a4a6a", items: pitItems },
    {
      key: "audio", name: "Audio", on: s.sys.audio, m: 0.3, dot: "#3155a8",
      items: [
        { key: "audio:lineArray", desc: "Line-array loudspeaker", unit: "ea", qty: arrayBoxes, cost: 1450 },
        { key: "audio:subwoofer", desc: "Subwoofer", unit: "ea", qty: subs, cost: 1850 },
        { key: "audio:mixerDsp", desc: "Digital mixer, DSP & amplifiers", unit: "lot", qty: 1, cost: 14200 },
      ],
    },
    {
      key: "video", name: "Video", on: s.sys.video, m: 0.31, dot: "#2a7d8a",
      items: [
        { key: "video:projector", desc: "Laser projector, 4K", unit: "ea", qty: projectors, cost: 18500 },
        { key: "video:screen", desc: "Projection screen / LED wall", unit: "lot", qty: 1, cost: Math.round(s.width * 260) },
        { key: "video:processor", desc: "Video processor & switcher", unit: "lot", qty: 1, cost: 9800 },
      ],
    },
  ];
  const systems: SystemBlock[] = defs.map((d) => {
    let rev = 0;
    let cost = 0;
    const items: BomItem[] = d.items.map((it) => {
      const price = it.cost / (1 - d.m);
      rev += it.qty * price;
      cost += it.qty * it.cost;
      return { key: it.key, desc: it.desc, qty: it.qty, unit: it.unit || "ea", cost: it.cost, price, area: it.area, fabricKey: it.fabricKey };
    });
    return { ...d, items, rev, cost };
  });
```

Leave the `return { lineSets, … }` line that follows as it is. `applyFabrics`, `applySkus`, `applyOverrides` and `scaleSets` spread `...it`, so the key survives the tier pipeline unchanged.

- [ ] **Step 6: Run the specs**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'`
Expected: `ALL PASSED`, **3964** PASS lines (3950 + 14).

- [ ] **Step 7: Types + lint**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: tsc silent; eslint `✖ 110 problems (0 errors, 110 warnings)`. If tsc reports a `BomItem` built without `key` anywhere, that site constructs an item by hand. Spread the source item (`{ ...it, … }`) instead of dropping `key`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/equipment-vocab.ts src/lib/design/equipment-legacy-hints.ts "src/app/(app)/design/quick/engine.ts" scripts/test-review-and-spec.ts
git commit -m "feat(grid): equation item vocabulary + old figures as hints (#GEM T1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Equipment map model, resolver and store

**Files:**
- Create: `src/lib/design/equipment-map.ts`
- Create: `src/lib/stores/equipment-map.ts`
- Test: `scripts/test-review-and-spec.ts` (append at EOF)
- Test: `scripts/test-review-regressions.ts` (a new block inserted before the `/* --- #210 final review M5` block)

**Interfaces:**
- Consumes (Task 1): `EQUIPMENT_ROWS`, `EQUIPMENT_ROW_BY_KEY`, `EquipRowDef`. From #210: `resolveFixture`, `fixtureSkus`, `FixtureRecord`, `FixtureCatalogPart` (`@/lib/fixture-assemblies`), and `listFixtures` (`@/lib/stores/fixtures`). From the catalog: `getMany`, `CatalogPart` (`@/lib/stores/catalog`). From pricing: `getCatalogRates` (`@/lib/stores/pricing`). From the doc store: `getBlob`/`setBlob` (`@/db/doc-store`).
- Produces (pure, `@/lib/design/equipment-map`):
  - Constants: `EQUIPMENT_MAP_BLOB = "grid_equipment_map"`, `EQUIP_TIERS`, `ALLOWANCE_MAX`.
  - `type EquipCell = { kind: "part"; sku: string } | { kind: "assembly"; id: string } | { kind: "allowance"; amount: number; confirmedBy: string; confirmedAt: number; note?: string }`
  - `type EquipRow = { tiers: Partial<Record<TierKey, EquipCell>>; sameAll?: boolean; updatedBy: string; updatedAt: number }`
  - `type EquipmentMap = Record<string, EquipRow>`
  - `type EquipRowStatus = "mapped" | "allowance" | "needs-part"`
  - `type EquipCellInput = { kind: "part"; sku: string } | { kind: "assembly"; id: string } | { kind: "allowance"; amount: number; note?: string; confirmed: boolean } | null`
  - `type EquipRowInput = { tiers: Partial<Record<TierKey, EquipCellInput>>; sameAll?: boolean }`
  - `isTierKey(v): v is TierKey`
  - `sanitizeEquipCell(raw): EquipCell | null`
  - `sanitizeEquipmentMap(raw): EquipmentMap`
  - `cellFor(row, tier): EquipCell | null`
  - `rowStatus(row): EquipRowStatus`
  - `mergeEquipRow(prev, input, by, now): { ok: true; row: EquipRow } | { ok: false; error: string }`
  - `type PricingPart = FixtureCatalogPart & { category?: string; curtainAreaRate?: number; costPerSqft?: number }`
  - `type EquipPriceCtx = { parts: ReadonlyMap<string, PricingPart>; fixtures: ReadonlyMap<string, FixtureRecord>; margin: number }`
  - `type PricedStatus = "part" | "assembly" | "allowance"`
  - `type PricedUnit = { status: PricedStatus; ref: string; desc: string; unit: string; unitCost: number; unitSell: number; areaRate?: number }`
  - `type UnitPrice = PricedUnit | { status: "needs-part"; reason: string }`
  - `type EquipmentPriceTable = { margin: number; byTier: Record<TierKey, Record<string, UnitPrice>> }`
  - `sellFromCost(cost, margin): number`
  - `priceCell(cell, def, ctx): UnitPrice`
  - `buildEquipmentPriceTable(map, ctx): EquipmentPriceTable`
  - `mapSkus(map, fixtures): string[]`
- Produces (server, `@/lib/stores/equipment-map`):
  - `getEquipmentMap(): Promise<EquipmentMap>`
  - `saveEquipmentRow(rowKey, input, by, now?): Promise<{ ok: true; row: EquipRow } | { ok: false; error: string }>`
  - `clearEquipmentRow(rowKey): Promise<boolean>`
  - `loadEquipPriceCtx(opts?: { catalog?: ReadonlyArray<CatalogPart>; extraSkus?: readonly string[]; extraFixtureIds?: readonly string[] }): Promise<{ map; ctx; catalogParts: ReadonlyMap<string, CatalogPart> }>`
  - `loadEquipmentPriceTable(opts?): Promise<EquipmentPriceTable>`

- [ ] **Step 1: Write the failing pure test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T2: Equipment map resolution — part / assembly / allowance / empty, never a fallback $ --- */
import {
  ALLOWANCE_MAX as gemAllowMax2, buildEquipmentPriceTable as gemTable2, cellFor as gemCellFor2, mapSkus as gemMapSkus2,
  mergeEquipRow as gemMerge2, priceCell as gemPriceCell2, rowStatus as gemRowStatus2, sanitizeEquipmentMap as gemSanitize2,
  sellFromCost as gemSell2, type EquipmentMap as GemMap2,
} from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY as gemRowByKey2 } from "@/lib/design/equipment-vocab";
{
  const def = (k: string) => gemRowByKey2.get(k)!;
  const parts = new Map([
    ["GEM-PAR", { sku: "GEM-PAR", desc: "LED par", unit: "ea", cost: 600, list: 900, category: "Lighting Fixtures" }],
    ["GEM-HB", { sku: "GEM-HB", desc: "Headblock 8in", unit: "ea", cost: 500, list: 0, category: "Rigging Hardware" }],
    ["GEM-NIL", { sku: "GEM-NIL", desc: "Unpriced", unit: "ea", cost: 0, list: 0, category: "Misc" }],
    ["GEM-VEL", { sku: "GEM-VEL", desc: "Velour 25oz", unit: "sq ft", cost: 0, list: 0, category: "Fabric", curtainAreaRate: 3.5 }],
    ["GEM-MUS", { sku: "GEM-MUS", desc: "Muslin", unit: "sq ft", cost: 0, list: 0, category: "Fabric", costPerSqft: 0.9 }],
    ["GEM-BARE", { sku: "GEM-BARE", desc: "Rateless fabric", unit: "sq ft", cost: 0, list: 0, category: "Fabric" }],
    ["GEM-MIX", { sku: "GEM-MIX", desc: "Mixer", unit: "ea", cost: 5000, list: 7000, category: "Audio" }],
    ["GEM-DSP", { sku: "GEM-DSP", desc: "DSP", unit: "ea", cost: 1500, list: 2100, category: "Audio" }],
  ]);
  const rack = {
    id: "SA-GEM2", kind: "system" as const, label: "Mixer + DSP rack", description: "", scope: "Audio" as const,
    lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] },
    parts: [{ sku: "GEM-MIX", qty: 1 }, { sku: "GEM-DSP", qty: 2 }],
    createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const ctx = { parts, fixtures: new Map([[rack.id, rack]]), margin: 0.3 };
  const p = (cell: Parameters<typeof gemPriceCell2>[0], key = "lighting:par") => gemPriceCell2(cell, def(key), ctx);
  const par = p({ kind: "part", sku: "GEM-PAR" });
  ok(par.status === "part" && par.unitCost === 600 && par.unitSell === 900, "#GEM T2: a part prices at live catalog cost / list");
  const hb = p({ kind: "part", sku: "GEM-HB" }, "rigging:headblock");
  ok(hb.status === "part" && hb.unitSell === gemSell2(500, 0.3) && hb.unitSell === 714.29, "#GEM T2: a part with no list sells at cost ÷ (1 − catalog margin)");
  const gone = p({ kind: "part", sku: "GEM-GONE" });
  ok(gone.status === "needs-part" && /no longer in the catalog/.test(gone.reason), "#GEM T2: a deleted part is needs-a-part, not $0");
  ok(p({ kind: "part", sku: "GEM-NIL" }).status === "needs-part", "#GEM T2: an unpriced part is needs-a-part");
  const asm = p({ kind: "assembly", id: "SA-GEM2" }, "audio:mixerDsp");
  ok(asm.status === "assembly" && asm.unitCost === 8000 && asm.unitSell === 11200 && asm.desc === "Mixer + DSP rack", "#GEM T2: a System assembly prices at its included totals (resolveFixture)");
  ok(p({ kind: "assembly", id: "SA-DELETED" }, "audio:mixerDsp").status === "needs-part", "#GEM T2: a deleted assembly is needs-a-part");
  const allow = p({ kind: "allowance", amount: 1200, confirmedBy: "Chris", confirmedAt: 5 }, "audio:subwoofer");
  ok(allow.status === "allowance" && allow.unitCost === 1200 && allow.unitSell === gemSell2(1200, 0.3), "#GEM T2: a confirmed allowance is a unit cost, sold through the catalog margin");
  ok(p({ kind: "allowance", amount: 1200, confirmedBy: "", confirmedAt: 5 }, "audio:subwoofer").status === "needs-part", "#GEM T2: an unconfirmed allowance never prices");
  const empty = p(null);
  ok(empty.status === "needs-part" && empty.reason === "Not mapped yet", "#GEM T2: an empty cell is needs-a-part with no $");
  const vel = p({ kind: "part", sku: "GEM-VEL" }, "curtains:draw");
  ok(vel.status === "part" && vel.areaRate === 3.5 && vel.unitCost === 0, "#GEM T2: a fabric row resolves the mapped fabric's area rate");
  const mus = p({ kind: "part", sku: "GEM-MUS" }, "curtains:draw");
  ok(mus.status === "part" && mus.areaRate === 0.9, "#GEM T2: …falling back to the fabric's own cost per sq ft");
  ok(p({ kind: "part", sku: "GEM-BARE" }, "curtains:draw").status === "needs-part" && p({ kind: "part", sku: "GEM-PAR" }, "curtains:draw").status === "needs-part", "#GEM T2: a rateless or non-fabric part on a fabric row is needs-a-part (no seed-rate fallback)");
  ok(p({ kind: "assembly", id: "SA-GEM2" }, "curtains:draw").status === "needs-part", "#GEM T2: a fabric row never maps to an assembly");
  const same = { tiers: { good: { kind: "part" as const, sku: "GEM-PAR" } }, sameAll: true, updatedBy: "t", updatedAt: 1 };
  ok(gemCellFor2(same, "best")?.kind === "part" && gemCellFor2({ ...same, sameAll: false }, "best") === null, "#GEM T2: same-for-all reads the Good cell for every tier");
  ok(gemRowStatus2(undefined) === "needs-part" && gemRowStatus2(same) === "mapped", "#GEM T2: row status — nothing mapped vs every tier mapped");
  ok(gemRowStatus2({ tiers: { good: { kind: "part", sku: "X" }, better: { kind: "allowance", amount: 5, confirmedBy: "J", confirmedAt: 1 }, best: { kind: "part", sku: "X" } }, updatedBy: "t", updatedAt: 1 }) === "allowance", "#GEM T2: any confirmed-allowance tier → Allowance");
  ok(gemRowStatus2({ tiers: { good: { kind: "part", sku: "X" } }, updatedBy: "t", updatedAt: 1 }) === "needs-part", "#GEM T2: any empty tier → Needs a part");
  const clean = gemSanitize2({ "lighting:par": same, "bogus:row": same, "audio:subwoofer": null, "rigging:arbor": { tiers: { good: { kind: "allowance", amount: -3, confirmedBy: "J", confirmedAt: 1 }, better: { kind: "part", sku: "  " } } } });
  ok(Object.keys(clean).join(",") === "lighting:par,rigging:arbor" && Object.keys(clean["rigging:arbor"].tiers).length === 0, "#GEM T2: sanitize drops unknown rows, cleared rows and invalid cells");
  ok(!gemMerge2(undefined, { tiers: { good: { kind: "allowance", amount: 99, confirmed: false } } }, "Jeff", 10).ok, "#GEM T2: saving an unconfirmed allowance is refused");
  const m2 = gemMerge2(undefined, { sameAll: true, tiers: { good: { kind: "allowance", amount: 1200, note: "until the book lands", confirmed: true } } }, "Chris", 20);
  ok(m2.ok && m2.row.tiers.best?.kind === "allowance" && m2.row.tiers.better?.kind === "allowance" && m2.row.updatedBy === "Chris", "#GEM T2: same-for-all writes the Good cell into every tier, stamped");
  const prev2 = m2.ok ? m2.row : undefined;
  const m3 = gemMerge2(prev2, { sameAll: true, tiers: { good: { kind: "allowance", amount: 1200, note: "until the book lands", confirmed: true } } }, "Jeff", 30);
  const c3 = m3.ok ? m3.row.tiers.good : null;
  ok(m3.ok && c3?.kind === "allowance" && c3.confirmedBy === "Chris" && c3.confirmedAt === 20 && m3.row.updatedBy === "Jeff", "#GEM T2: re-saving an unchanged allowance keeps who confirmed it");
  const m4 = gemMerge2(prev2, { sameAll: true, tiers: { good: { kind: "allowance", amount: 1300, confirmed: true } } }, "Jeff", 40);
  const c4 = m4.ok ? m4.row.tiers.good : null;
  ok(c4?.kind === "allowance" && c4.confirmedBy === "Jeff" && c4.confirmedAt === 40, "#GEM T2: changing the amount re-confirms it");
  ok(!gemMerge2(undefined, { tiers: { good: { kind: "allowance", amount: gemAllowMax2 + 1, confirmed: true } } }, "J", 1).ok, "#GEM T2: an absurd allowance is refused");
  const map: GemMap2 = { "lighting:par": same, "audio:mixerDsp": { tiers: { better: { kind: "assembly", id: "SA-GEM2" } }, updatedBy: "t", updatedAt: 1 } };
  const table = gemTable2(map, ctx);
  const allKeys = [...gemRowByKey2.keys()];
  ok((["good", "better", "best"] as const).every((t) => allKeys.every((k) => !!table.byTier[t][k])) && table.margin === 0.3, "#GEM T2: the table has a price (or needs-a-part) for every row × tier");
  ok(table.byTier.good["audio:mixerDsp"].status === "needs-part" && table.byTier.better["audio:mixerDsp"].status === "assembly", "#GEM T2: tiers resolve independently");
  ok(allKeys.filter((k) => !map[k]).every((k) => table.byTier.better[k].status === "needs-part"), "#GEM T2: every unmapped row is needs-a-part — nothing is pre-mapped");
  ok(gemMapSkus2(map, ctx.fixtures).sort().join(",") === "GEM-DSP,GEM-MIX,GEM-PAR", "#GEM T2: mapSkus names every part the map needs, assembly parts included");
}
```

This block has **27** `ok(` calls.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: cannot resolve `@/lib/design/equipment-map`.

- [ ] **Step 3: Create the pure model and resolver**

Create `src/lib/design/equipment-map.ts`:

```ts
/**
 * The Grid Equipment map (#GEM, spec §3, D-GEM-2/D-GEM-3) — pure.
 *
 * Every equation item × tier maps to a catalog part, a fixture / System
 * assembly (the one builder, #210) or a CONFIRMED allowance. Anything else is
 * "needs a part" and never prices: there is no fallback dollar anywhere in
 * this module. Stored as one settings blob with one TOP-LEVEL key per row, so
 * setBlob's atomic per-key jsonb merge keeps two admins' edits to different
 * rows independent (the spec's `{ rows: … }` nesting would let them clobber
 * each other). A cleared row is written as null and dropped on read.
 *
 * Pricing (spec §3):
 *  - part      → live catalog cost; sell = list, or cost ÷ (1 − catalog
 *                margin) when the part has no list of its own;
 *  - assembly  → resolveFixture's included cost / sell;
 *  - allowance → the confirmed amount is a unit cost, sold like a list-less
 *                part;
 *  - fabric rows (curtains) → the mapped Fabric part's area rate
 *                (curtainAreaRate, else costPerSqft) — the per-drape cost is
 *                computed from the venue geometry in equipment-pricing.ts.
 *                No SEED_FABRIC_RATES fallback.
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROWS, EQUIPMENT_ROW_BY_KEY, type EquipRowDef } from "./equipment-vocab";
import { fixtureSkus, resolveFixture, type FixtureCatalogPart, type FixtureRecord } from "@/lib/fixture-assemblies";

export const EQUIPMENT_MAP_BLOB = "grid_equipment_map";
export const EQUIP_TIERS: readonly TierKey[] = ["good", "better", "best"];
/** Typo guard on one allowance's unit cost, not a policy. */
export const ALLOWANCE_MAX = 10_000_000;

export type EquipCell =
  | { kind: "part"; sku: string }
  | { kind: "assembly"; id: string }
  | { kind: "allowance"; amount: number; confirmedBy: string; confirmedAt: number; note?: string };

export type EquipRow = {
  tiers: Partial<Record<TierKey, EquipCell>>;
  /** "Same for all tiers": the Good cell is canonical (saved into all three). */
  sameAll?: boolean;
  updatedBy: string;
  updatedAt: number;
};

export type EquipmentMap = Record<string, EquipRow>;
export type EquipRowStatus = "mapped" | "allowance" | "needs-part";

/** What the editor posts for one tier. An allowance must arrive `confirmed`. */
export type EquipCellInput =
  | { kind: "part"; sku: string }
  | { kind: "assembly"; id: string }
  | { kind: "allowance"; amount: number; note?: string; confirmed: boolean }
  | null;
export type EquipRowInput = { tiers: Partial<Record<TierKey, EquipCellInput>>; sameAll?: boolean };

export function isTierKey(v: unknown): v is TierKey {
  return v === "good" || v === "better" || v === "best";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function sanitizeEquipCell(raw: unknown): EquipCell | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "part") {
    const sku = String(r.sku ?? "").trim().slice(0, 120);
    return sku ? { kind: "part", sku } : null;
  }
  if (r.kind === "assembly") {
    const id = String(r.id ?? "").trim().slice(0, 120);
    return id ? { kind: "assembly", id } : null;
  }
  if (r.kind === "allowance") {
    const amount = round2(Number(r.amount));
    const confirmedBy = String(r.confirmedBy ?? "").trim().slice(0, 80);
    const confirmedAt = Number(r.confirmedAt);
    if (!(amount > 0) || amount > ALLOWANCE_MAX || !confirmedBy || !(confirmedAt > 0)) return null;
    const note = String(r.note ?? "").trim().slice(0, 200);
    return { kind: "allowance", amount, confirmedBy, confirmedAt, ...(note ? { note } : {}) };
  }
  return null;
}

/** The stored blob → a clean map: known rows only, valid cells only, cleared (null) rows dropped. */
export function sanitizeEquipmentMap(raw: unknown): EquipmentMap {
  const out: EquipmentMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!EQUIPMENT_ROW_BY_KEY.has(key) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const tiersRaw = (v.tiers && typeof v.tiers === "object" ? v.tiers : {}) as Record<string, unknown>;
    const tiers: Partial<Record<TierKey, EquipCell>> = {};
    for (const t of EQUIP_TIERS) {
      const c = sanitizeEquipCell(tiersRaw[t]);
      if (c) tiers[t] = c;
    }
    out[key] = {
      tiers,
      ...(v.sameAll ? { sameAll: true } : {}),
      updatedBy: String(v.updatedBy ?? ""),
      updatedAt: Number(v.updatedAt) || 0,
    };
  }
  return out;
}

export function cellFor(row: EquipRow | undefined, tier: TierKey): EquipCell | null {
  if (!row) return null;
  return (row.sameAll ? row.tiers.good : row.tiers[tier]) ?? null;
}

/** Spec §3: Mapped (every tier part/assembly) · Allowance (any tier an allowance) · Needs a part (any tier empty). */
export function rowStatus(row: EquipRow | undefined): EquipRowStatus {
  const cells = EQUIP_TIERS.map((t) => cellFor(row, t));
  if (cells.some((c) => !c)) return "needs-part";
  return cells.some((c) => c!.kind === "allowance") ? "allowance" : "mapped";
}

/**
 * One row save → the stored row. An allowance needs `confirmed`; its
 * confirmedBy / confirmedAt are re-stamped only when the amount or note
 * changes, so re-saving a row never silently re-attributes someone else's
 * confirmation. "Same for all tiers" keeps the Good cell and copies it to
 * Better and Best.
 */
export function mergeEquipRow(
  prev: EquipRow | undefined,
  input: EquipRowInput,
  by: string,
  now: number
): { ok: true; row: EquipRow } | { ok: false; error: string } {
  const sameAll = !!input?.sameAll;
  const tiers: Partial<Record<TierKey, EquipCell>> = {};
  for (const t of sameAll ? (["good"] as TierKey[]) : EQUIP_TIERS) {
    const c = input?.tiers?.[t];
    if (!c) continue;
    if (c.kind === "allowance") {
      if (!c.confirmed) return { ok: false, error: "Tick “I confirm this allowance” — an unconfirmed allowance is never used." };
      const amount = round2(Number(c.amount));
      if (!(amount > 0) || amount > ALLOWANCE_MAX) return { ok: false, error: "An allowance needs a unit cost above $0." };
      const note = String(c.note ?? "").trim().slice(0, 200);
      const old = cellFor(prev, t);
      const unchanged = old?.kind === "allowance" && old.amount === amount && (old.note ?? "") === note;
      tiers[t] = {
        kind: "allowance",
        amount,
        confirmedBy: unchanged ? old.confirmedBy : by,
        confirmedAt: unchanged ? old.confirmedAt : now,
        ...(note ? { note } : {}),
      };
      continue;
    }
    const cell = sanitizeEquipCell(c);
    if (!cell) return { ok: false, error: "Pick a catalog part or an assembly for every filled tier." };
    tiers[t] = cell;
  }
  if (sameAll && tiers.good) {
    tiers.better = tiers.good;
    tiers.best = tiers.good;
  }
  return { ok: true, row: { tiers, ...(sameAll ? { sameAll: true } : {}), updatedBy: by, updatedAt: now } };
}

/* -------------------------------- pricing -------------------------------- */

export type PricingPart = FixtureCatalogPart & { category?: string; curtainAreaRate?: number; costPerSqft?: number };
export type EquipPriceCtx = {
  /** Catalog parts by SKU — the rows the map (and any override) references. */
  parts: ReadonlyMap<string, PricingPart>;
  /** Fixtures and systems by id (listFixtures). */
  fixtures: ReadonlyMap<string, FixtureRecord>;
  /** catalog_rates.defaultMargin — the list-less part / allowance sell rule. */
  margin: number;
};
export type PricedStatus = "part" | "assembly" | "allowance";
export type PricedUnit = {
  status: PricedStatus;
  /** SKU (part), fixture id (assembly) or row key (allowance). */
  ref: string;
  desc: string;
  unit: string;
  unitCost: number;
  unitSell: number;
  /** Fabric rows only: $/sq ft of sewn fabric; the per-drape cost comes from the venue geometry. */
  areaRate?: number;
};
export type UnitPrice = PricedUnit | { status: "needs-part"; reason: string };
export type EquipmentPriceTable = { margin: number; byTier: Record<TierKey, Record<string, UnitPrice>> };

/** cost ÷ (1 − margin), cents-rounded. The margin is a rate (catalog_rates), never a dollar. */
export function sellFromCost(cost: number, margin: number): number {
  const m = margin >= 0 && margin < 0.95 ? margin : 0.3;
  return round2(cost / (1 - m));
}

const needs = (reason: string): UnitPrice => ({ status: "needs-part", reason });

export function priceCell(cell: EquipCell | null, def: EquipRowDef, ctx: EquipPriceCtx): UnitPrice {
  if (!cell) return needs("Not mapped yet");
  if (cell.kind === "allowance") {
    if (!(cell.amount > 0) || !cell.confirmedBy || !(cell.confirmedAt > 0)) return needs("Allowance not confirmed");
    return { status: "allowance", ref: def.key, desc: `${def.label} (allowance)`, unit: def.unit, unitCost: cell.amount, unitSell: sellFromCost(cell.amount, ctx.margin) };
  }
  if (cell.kind === "part") {
    const p = ctx.parts.get(cell.sku);
    if (!p) return needs(`${cell.sku} is no longer in the catalog`);
    if (def.curtain) {
      const rate = p.category === "Fabric" ? Number(p.curtainAreaRate ?? p.costPerSqft ?? 0) : 0;
      if (!(rate > 0)) return needs(`${p.sku} is not a fabric with an area rate`);
      return { status: "part", ref: p.sku, desc: p.desc, unit: def.unit, unitCost: 0, unitSell: 0, areaRate: rate };
    }
    const cost = Number(p.cost) || 0;
    const list = Number(p.list) || 0;
    if (!(cost > 0) && !(list > 0)) return needs(`${p.sku} has no price in the catalog`);
    return { status: "part", ref: p.sku, desc: p.desc, unit: p.unit || def.unit, unitCost: cost, unitSell: list > 0 ? list : sellFromCost(cost, ctx.margin) };
  }
  if (def.curtain) return needs("A curtain row maps to a Fabric part");
  const f = ctx.fixtures.get(cell.id);
  if (!f) return needs(`Assembly ${cell.id} was deleted`);
  const r = resolveFixture(f, ctx.parts);
  if (!(r.cost > 0) && !(r.sell > 0)) return needs(`${f.label} has no priced parts`);
  return { status: "assembly", ref: f.id, desc: f.label, unit: "ea", unitCost: r.cost, unitSell: r.sell > 0 ? r.sell : sellFromCost(r.cost, ctx.margin) };
}

export function buildEquipmentPriceTable(map: EquipmentMap, ctx: EquipPriceCtx): EquipmentPriceTable {
  const byTier = { good: {}, better: {}, best: {} } as Record<TierKey, Record<string, UnitPrice>>;
  for (const def of EQUIPMENT_ROWS) {
    for (const t of EQUIP_TIERS) byTier[t][def.key] = priceCell(cellFor(map[def.key], t), def, ctx);
  }
  return { margin: ctx.margin, byTier };
}

/** Every catalog SKU the map prices — mapped parts plus the parts of mapped assemblies (one getMany). */
export function mapSkus(map: EquipmentMap, fixtures: ReadonlyMap<string, FixtureRecord>): string[] {
  const out = new Set<string>();
  for (const row of Object.values(map)) {
    for (const t of EQUIP_TIERS) {
      const c = row.tiers[t];
      if (c?.kind === "part") out.add(c.sku);
      if (c?.kind === "assembly") {
        const f = fixtures.get(c.id);
        if (f) for (const sku of fixtureSkus(f)) out.add(sku);
      }
    }
  }
  return [...out];
}
```

- [ ] **Step 4: Create the store**

Create `src/lib/stores/equipment-map.ts`:

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { getMany, type CatalogPart } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates } from "@/lib/stores/pricing";
import { fixtureSkus } from "@/lib/fixture-assemblies";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import {
  EQUIPMENT_MAP_BLOB,
  buildEquipmentPriceTable,
  mapSkus,
  mergeEquipRow,
  sanitizeEquipmentMap,
  type EquipmentMap,
  type EquipmentPriceTable,
  type EquipPriceCtx,
  type EquipRow,
  type EquipRowInput,
} from "@/lib/design/equipment-map";

/**
 * The Equipment map store (#GEM, D-GEM-2): one settings blob, one top-level
 * key per row. Starts EMPTY — nothing here ever writes a row on its own; only
 * saveEquipmentRow / clearEquipmentRow, called from the admin actions, do.
 * Survives the go-live reset (clearDemoData never touches blobs), like every
 * other rate blob.
 */

export async function getEquipmentMap(): Promise<EquipmentMap> {
  return sanitizeEquipmentMap(await getBlob<Record<string, unknown>>(EQUIPMENT_MAP_BLOB, {}));
}

export async function saveEquipmentRow(
  rowKey: string,
  input: EquipRowInput,
  by: string,
  now = Date.now()
): Promise<{ ok: true; row: EquipRow } | { ok: false; error: string }> {
  if (!EQUIPMENT_ROW_BY_KEY.has(rowKey)) return { ok: false, error: "Unknown equipment row." };
  const prev = (await getEquipmentMap())[rowKey];
  const merged = mergeEquipRow(prev, input, by, now);
  if (!merged.ok) return merged;
  await setBlob(EQUIPMENT_MAP_BLOB, { [rowKey]: merged.row });
  return merged;
}

export async function clearEquipmentRow(rowKey: string): Promise<boolean> {
  if (!EQUIPMENT_ROW_BY_KEY.has(rowKey)) return false;
  await setBlob(EQUIPMENT_MAP_BLOB, { [rowKey]: null });
  return true;
}

/**
 * Everything the resolver needs, loaded once. Pass `catalog` when the caller
 * already holds the whole book for this request (the Grid editor page, Quick
 * Design); otherwise exactly the SKUs the map, `extraSkus` and the parts of
 * `extraFixtureIds` reference are read in ONE getMany — never the whole
 * ~37,400-part catalog, never one query per part.
 */
export async function loadEquipPriceCtx(
  opts: { catalog?: ReadonlyArray<CatalogPart>; extraSkus?: readonly string[]; extraFixtureIds?: readonly string[] } = {}
): Promise<{ map: EquipmentMap; ctx: EquipPriceCtx; catalogParts: ReadonlyMap<string, CatalogPart> }> {
  const [map, fixtureList, rates] = await Promise.all([getEquipmentMap(), listFixtures(), getCatalogRates()]);
  const fixtures = new Map(fixtureList.map((f) => [f.id, f]));
  let catalogParts: Map<string, CatalogPart>;
  if (opts.catalog) {
    catalogParts = new Map(opts.catalog.map((p) => [p.sku, p]));
  } else {
    const skus = new Set<string>([...mapSkus(map, fixtures), ...(opts.extraSkus || [])]);
    for (const id of opts.extraFixtureIds || []) {
      const f = fixtures.get(id);
      if (f) for (const sku of fixtureSkus(f)) skus.add(sku);
    }
    catalogParts = new Map((skus.size ? await getMany([...skus]) : []).map((p) => [p.sku, p]));
  }
  return { map, ctx: { parts: catalogParts, fixtures, margin: rates.defaultMargin }, catalogParts };
}

export async function loadEquipmentPriceTable(opts?: Parameters<typeof loadEquipPriceCtx>[0]): Promise<EquipmentPriceTable> {
  const { map, ctx } = await loadEquipPriceCtx(opts);
  return buildEquipmentPriceTable(map, ctx);
}
```

- [ ] **Step 5: Run the pure specs**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'`
Expected: `ALL PASSED`, **3991** PASS lines (3964 + 27).

- [ ] **Step 6: Write the DB regression block**

In `scripts/test-review-regressions.ts`, insert this block immediately before the line `  /* --- #210 final review M5: the go-live reset keeps fixtures and systems`:

```ts
  /* --- #GEM T2: the Equipment map store — starts empty, per-row atomic writes, who/when --- */
  {
    const EM = await import("@/lib/stores/equipment-map");
    const Cat = await import("@/lib/stores/catalog");
    assert.deepEqual(Object.keys(await EM.getEquipmentMap()), [], "#GEM T2: the map starts empty — nothing is pre-mapped");
    assert.equal((await EM.saveEquipmentRow("bogus:row", { tiers: {} }, "Jeff")).ok, false, "#GEM T2: an unknown row is refused");
    const r1 = await EM.saveEquipmentRow("lighting:par", { tiers: { good: { kind: "part", sku: "GEM2-PAR" }, better: { kind: "part", sku: "GEM2-PAR" }, best: { kind: "part", sku: "GEM2-PAR" } } }, "Jeff", 1000);
    const r2 = await EM.saveEquipmentRow("audio:subwoofer", { sameAll: true, tiers: { good: { kind: "allowance", amount: 1200, confirmed: true } } }, "Chris", 2000);
    assert.ok(r1.ok && r2.ok, "#GEM T2: two rows save");
    await Promise.all([
      EM.saveEquipmentRow("video:projector", { sameAll: true, tiers: { good: { kind: "part", sku: "GEM2-PROJ" } } }, "Jeff", 3000),
      EM.saveEquipmentRow("video:screen", { sameAll: true, tiers: { good: { kind: "part", sku: "GEM2-SCR" } } }, "Chris", 3000),
    ]);
    let m = await EM.getEquipmentMap();
    assert.deepEqual(Object.keys(m).sort(), ["audio:subwoofer", "lighting:par", "video:projector", "video:screen"], "#GEM T2: concurrent edits to different rows both survive (atomic per-key merge)");
    assert.ok(m["lighting:par"].updatedBy === "Jeff" && m["lighting:par"].updatedAt === 1000, "#GEM T2: every save stamps who/when");
    const sub = m["audio:subwoofer"].tiers.best;
    assert.ok(sub?.kind === "allowance" && sub.confirmedBy === "Chris" && sub.confirmedAt === 2000 && sub.amount === 1200, "#GEM T2: a confirmed allowance stores who confirmed it and when");
    assert.equal((await EM.saveEquipmentRow("audio:subwoofer", { tiers: { good: { kind: "allowance", amount: 5, confirmed: false } } }, "Jeff", 4000)).ok, false, "#GEM T2: an unconfirmed allowance is refused");
    assert.equal((await EM.getEquipmentMap())["audio:subwoofer"].updatedAt, 2000, "#GEM T2: …and nothing was written");
    await EM.clearEquipmentRow("video:projector");
    m = await EM.getEquipmentMap();
    assert.ok(!("video:projector" in m) && "video:screen" in m, "#GEM T2: clearing one row leaves the others");
    await Cat.upsert({ sku: "GEM2-PAR", desc: "GEM2 par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    const table = await EM.loadEquipmentPriceTable();
    const par = table.byTier.best["lighting:par"];
    assert.ok(par.status === "part" && par.unitSell === 900 && par.unitCost === 600, "#GEM T2: the table prices a mapped part from the live catalog (targeted read)");
    assert.equal(table.byTier.best["video:screen"].status, "needs-part", "#GEM T2: a mapped SKU missing from the catalog is needs-a-part");
    const allow = table.byTier.good["audio:subwoofer"];
    assert.ok(allow.status === "allowance" && allow.unitCost === 1200, "#GEM T2: the allowance prices as its confirmed unit cost");
    for (const k of ["lighting:par", "audio:subwoofer", "video:screen"]) await EM.clearEquipmentRow(k);
    assert.deepEqual(Object.keys(await EM.getEquipmentMap()), [], "#GEM T2: cleanup — later blocks start from an empty map");
  }

```

- [ ] **Step 7: Run the DB regressions**

Run: `env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -3`
Expected: `review regression checks passed`.

- [ ] **Step 8: Types + lint**

Run: `npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: tsc silent; `✖ 110 problems (0 errors, 110 warnings)`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/design/equipment-map.ts src/lib/stores/equipment-map.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(grid): Equipment map model, resolver and store (#GEM T2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Equipment map tab in Grid Settings

**Files:**
- Create: `src/lib/design/equipment-map-view.ts`
- Create: `src/app/(app)/design/grid/settings/settings-tabs.tsx`
- Create: `src/app/(app)/design/grid/settings/equipment-map/page.tsx`
- Create: `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx`
- Modify: `src/app/(app)/design/grid/settings/page.tsx` (render the tab strip)
- Modify: `src/app/(app)/design/grid/settings/actions.ts` (four actions)
- Modify: `scripts/smoke-routes.ts` (one route)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes (Tasks 1–2): `EQUIPMENT_ROWS`, `EQUIPMENT_ROW_BY_KEY`, `EQUIP_SYSTEM_LABEL`, `EquipRowDef`; `EQUIP_TIERS`, `cellFor`, `priceCell`, `sellFromCost`, `mapSkus`, `EquipCellInput`, `EquipRowInput`, `EquipmentMap`, `EquipPriceCtx`, `EquipRowStatus`; `LEGACY_HINTS`, `legacyHintText`, `legacyHintSkus`; `getEquipmentMap`, `saveEquipmentRow`, `clearEquipmentRow`. Also `searchCatalog` from `@/app/(app)/estimator/actions` (`requireUser`, capped result, returns cost/list).
- Produces (pure):
  - `type EquipCellVM`, `type EquipRowVM`, `type AssemblyOption = { id; label; kind: "fixture" | "system"; scope: string; unitCost; unitSell }`
  - `equipmentMapView(map, ctx, hints: Record<string, { text: string; skus: string[] }>): EquipRowVM[]`
  - `assemblyOptions(fixtures, ctx): AssemblyOption[]`
  - `suggestParts(parts, def, hintSkus, limit?): P[]`
  - `mapSummary(rows): Record<EquipRowStatus, number>`
- Produces (actions, all `requirePerm("manage_users")`):
  - `saveEquipmentRowAction(rowKey, input): Promise<{ ok: true } | { ok: false; error: string }>`
  - `clearEquipmentRowAction(rowKey)`
  - `searchEquipmentPartsAction(query): Promise<{ hits: EquipPartHit[]; total: number }>`
  - `suggestEquipmentPartsAction(rowKey): Promise<{ hits: EquipPartHit[] }>`
  - `type EquipPartHit = { sku; desc; category; unit; cost; list }`
- Produces (UI): `GridSettingsTabs({ active: "general" | "equipment" })`; the route `/design/grid/settings/equipment-map`, where each row's DOM id is `row-<system>-<itemKey>`. Task 8's "Map it" links there.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T3: the Equipment map page — view models, suggestions, admin gate, no client store imports --- */
import { assemblyOptions as gemAsmOpts3, equipmentMapView as gemView3, mapSummary as gemSummary3, suggestParts as gemSuggest3 } from "@/lib/design/equipment-map-view";
import { EQUIPMENT_ROW_BY_KEY as gemRowByKey3 } from "@/lib/design/equipment-vocab";
/** Module paths a source file imports VALUES from (`import type …` excluded). Shared by the later #GEM guards. */
const gemValueImports = (src: string): string[] =>
  [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
{
  const parts = new Map([
    ["GEM-PAR", { sku: "GEM-PAR", desc: "LED par", unit: "ea", cost: 600, list: 900, category: "Lighting Fixtures" }],
    ["GEM-MIX", { sku: "GEM-MIX", desc: "Mixer", unit: "ea", cost: 5000, list: 7000, category: "Audio" }],
  ]);
  const rack = {
    id: "SA-GEM3", kind: "system" as const, label: "GEM3 rack", description: "", scope: "Audio" as const,
    lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] },
    parts: [{ sku: "GEM-MIX", qty: 1 }], createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const ctx = { parts, fixtures: new Map([[rack.id, rack]]), margin: 0.3 };
  const hints = { "lighting:par": { text: "was $500 / $750 / $1,150", skus: [] as string[] } };
  const empty = gemView3({}, ctx, hints);
  ok(empty.length === 46 && empty.every((r) => r.status === "needs-part" && r.cells.every((c) => c.kind === "empty" && c.input === null)), "#GEM T3: an empty map shows every row as Needs a part");
  ok(empty.find((r) => r.key === "lighting:par")!.hint === "was $500 / $750 / $1,150" && empty[0].systemLabel === "Rigging", "#GEM T3: rows carry their 'was' hint and their group label");
  const view = gemView3({
    "lighting:par": { tiers: { good: { kind: "part", sku: "GEM-PAR" }, better: { kind: "part", sku: "GEM-GONE" }, best: { kind: "part", sku: "GEM-PAR" } }, updatedBy: "Jeff", updatedAt: 9 },
    "audio:mixerDsp": { tiers: { good: { kind: "assembly", id: "SA-GEM3" } }, sameAll: true, updatedBy: "Jeff", updatedAt: 9 },
    "audio:subwoofer": { tiers: { good: { kind: "allowance", amount: 1200, confirmedBy: "Chris", confirmedAt: 7, note: "no book yet" } }, sameAll: true, updatedBy: "Chris", updatedAt: 7 },
  }, ctx, hints);
  const par = view.find((r) => r.key === "lighting:par")!;
  ok(par.status === "needs-part" && par.cells[1].problem !== null && par.cells[0].unitSell === 900, "#GEM T3: a cell pointing at a deleted part makes the row Needs a part");
  const mix = view.find((r) => r.key === "audio:mixerDsp")!;
  ok(mix.status === "mapped" && mix.sameAll && mix.cells.every((c) => c.kind === "assembly" && c.title === "GEM3 rack" && c.unitSell === 7000), "#GEM T3: a same-for-all assembly row reads Mapped in every tier");
  const sub = view.find((r) => r.key === "audio:subwoofer")!;
  const subIn = sub.cells[2].input;
  ok(sub.status === "allowance" && sub.cells[2].confirmedBy === "Chris" && subIn?.kind === "allowance" && subIn.confirmed, "#GEM T3: an allowance row shows who confirmed it and re-posts as confirmed");
  const s = gemSummary3(view);
  ok(s.mapped === 1 && s.allowance === 1 && s["needs-part"] === 44, "#GEM T3: the summary counts rows by status");
  const catalog = [
    { sku: "RB-EN-16", desc: "Encore velour 16oz", category: "Fabric" },
    { sku: "RB-CHAR-25", desc: "Charisma velour 25oz", category: "Fabric" },
    { sku: "PAR-1", desc: "LED par wash", category: "Lighting Fixtures" },
    { sku: "PAR-2", desc: "Par can", category: "Lighting Fixtures" },
    { sku: "FAB-PAR", desc: "par fabric", category: "Fabric" },
  ];
  const legs = gemSuggest3(catalog, gemRowByKey3.get("curtains:legs")!, ["RB-CHAR-25"], 8);
  ok(legs[0].sku === "RB-CHAR-25" && legs.length === 2 && legs.every((p) => p.category === "Fabric"), "#GEM T3: fabric rows suggest fabrics only, the old fabric SKU first");
  const pars = gemSuggest3(catalog, gemRowByKey3.get("lighting:par")!, [], 1);
  ok(pars.length === 1 && pars[0].sku === "PAR-1", "#GEM T3: part suggestions skip fabric, rank by matched words, respect the limit");
  const opts = gemAsmOpts3([rack], ctx);
  ok(opts.length === 1 && opts[0].kind === "system" && opts[0].scope === "Audio" && opts[0].unitSell === 7000 && opts[0].unitCost === 5000, "#GEM T3: the assembly picker lists systems with their live totals");
  const clientSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx"), "utf8");
  ok(clientSrc.startsWith('"use client"') && !gemValueImports(clientSrc).some((m) => /^@\/lib\/stores\/|^@\/db\/|equipment-legacy-hints/.test(m)), "#GEM T3: the map client imports no store, DB or hint-table value");
  const pageSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/settings/equipment-map/page.tsx"), "utf8");
  ok(pageSrc.includes('can("manage_users"') && pageSrc.includes("getMany(") && !pageSrc.includes("listCatalog"), "#GEM T3: admin-gated, and the page reads only the SKUs it shows");
  const actionsSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/settings/actions.ts"), "utf8");
  ok((actionsSrc.match(/requirePerm\("manage_users"\)/g) || []).length === 9 && (actionsSrc.match(/^export async function/gm) || []).length === 9, "#GEM T3: every settings action, the four new ones included, is admin-gated");
}
```

This block has **12** `ok(` calls. Before this task, `settings/actions.ts` has 5 exported actions and 5 `requirePerm("manage_users")` calls.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: cannot resolve `@/lib/design/equipment-map-view`.

- [ ] **Step 3: Create the view models**

Create `src/lib/design/equipment-map-view.ts`:

```ts
/**
 * Equipment map page view models (#GEM, spec §3) — pure. Built on the server
 * from the map + resolved prices so the client resolves nothing. Row status is
 * computed from RESOLVED prices: a cell pointing at a deleted part or an
 * unpriced assembly reads "Needs a part" (Auto would skip it) even though a
 * cell is stored.
 */
import type { SysKey, TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROWS, EQUIP_SYSTEM_LABEL, type EquipRowDef } from "./equipment-vocab";
import {
  EQUIP_TIERS,
  cellFor,
  priceCell,
  sellFromCost,
  type EquipCellInput,
  type EquipmentMap,
  type EquipPriceCtx,
  type EquipRowStatus,
} from "./equipment-map";
import { resolveFixture, type FixtureRecord } from "@/lib/fixture-assemblies";

export type EquipCellVM = {
  tier: TierKey;
  kind: "part" | "assembly" | "allowance" | "empty";
  title: string;
  detail: string;
  /** Unit cost (admin page only) — a fabric row's $/sq ft area rate. */
  unitCost: number | null;
  unitSell: number | null;
  perSqft: boolean;
  /** Why a stored cell does not price (deleted part, unpriced assembly …). */
  problem: string | null;
  confirmedBy?: string;
  confirmedAt?: number;
  /** What the editor re-posts for this tier. */
  input: EquipCellInput;
};

export type EquipRowVM = {
  key: string;
  system: SysKey;
  systemLabel: string;
  label: string;
  unit: string;
  curtain: boolean;
  status: EquipRowStatus;
  sameAll: boolean;
  hint: string;
  hintSkus: string[];
  updatedBy: string;
  updatedAt: number;
  cells: EquipCellVM[];
};

export type AssemblyOption = { id: string; label: string; kind: "fixture" | "system"; scope: string; unitCost: number; unitSell: number };

function cellVM(def: EquipRowDef, tier: TierKey, map: EquipmentMap, ctx: EquipPriceCtx): EquipCellVM {
  const cell = cellFor(map[def.key], tier);
  const perSqft = !!def.curtain;
  if (!cell) return { tier, kind: "empty", title: "Needs a part", detail: "", unitCost: null, unitSell: null, perSqft, problem: null, input: null };
  const price = priceCell(cell, def, ctx);
  const priced = price.status === "needs-part" ? null : price;
  const problem = price.status === "needs-part" ? price.reason : null;
  if (cell.kind === "part") {
    return {
      tier, kind: "part", title: cell.sku, detail: priced?.desc ?? "",
      unitCost: perSqft ? priced?.areaRate ?? null : priced?.unitCost ?? null,
      unitSell: perSqft ? null : priced?.unitSell ?? null,
      perSqft, problem, input: { kind: "part", sku: cell.sku },
    };
  }
  if (cell.kind === "assembly") {
    const f = ctx.fixtures.get(cell.id);
    return {
      tier, kind: "assembly", title: f?.label ?? cell.id,
      detail: f ? (f.kind === "system" ? `System · ${f.scope ?? "Other"}` : "Fixture") : "",
      unitCost: priced?.unitCost ?? null, unitSell: priced?.unitSell ?? null,
      perSqft, problem, input: { kind: "assembly", id: cell.id },
    };
  }
  return {
    tier, kind: "allowance", title: "Allowance", detail: cell.note ?? "",
    unitCost: cell.amount, unitSell: priced?.unitSell ?? null, perSqft, problem,
    confirmedBy: cell.confirmedBy, confirmedAt: cell.confirmedAt,
    input: { kind: "allowance", amount: cell.amount, note: cell.note ?? "", confirmed: true },
  };
}

export function equipmentMapView(
  map: EquipmentMap,
  ctx: EquipPriceCtx,
  hints: Record<string, { text: string; skus: string[] }>
): EquipRowVM[] {
  return EQUIPMENT_ROWS.map((def) => {
    const cells = EQUIP_TIERS.map((t) => cellVM(def, t, map, ctx));
    const status: EquipRowStatus = cells.some((c) => c.kind === "empty" || c.problem)
      ? "needs-part"
      : cells.some((c) => c.kind === "allowance")
        ? "allowance"
        : "mapped";
    const row = map[def.key];
    const h = hints[def.key];
    return {
      key: def.key, system: def.system, systemLabel: EQUIP_SYSTEM_LABEL[def.system], label: def.label, unit: def.unit,
      curtain: !!def.curtain, status, sameAll: !!row?.sameAll, hint: h?.text ?? "", hintSkus: h?.skus ?? [],
      updatedBy: row?.updatedBy ?? "", updatedAt: row?.updatedAt ?? 0, cells,
    };
  });
}

export function mapSummary(rows: EquipRowVM[]): Record<EquipRowStatus, number> {
  const out: Record<EquipRowStatus, number> = { mapped: 0, allowance: 0, "needs-part": 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** Every fixture and system with its live included totals — the assembly picker. */
export function assemblyOptions(fixtures: Iterable<FixtureRecord>, ctx: EquipPriceCtx): AssemblyOption[] {
  const out: AssemblyOption[] = [];
  for (const f of fixtures) {
    const r = resolveFixture(f, ctx.parts);
    out.push({
      id: f.id, label: f.label, kind: f.kind,
      scope: f.kind === "system" ? f.scope ?? "Other" : "Lighting",
      unitCost: r.cost, unitSell: r.sell > 0 ? r.sell : sellFromCost(r.cost, ctx.margin),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * Suggested catalog matches for one row (spec §3, "help filling it"): the old
 * per-tier fabric SKUs first, then parts whose description / category contain
 * the row's search words. Fabric rows see Fabric parts only; other rows never
 * see Fabric or Labor. One pass over the given parts.
 */
export function suggestParts<P extends { sku: string; desc: string; category?: string }>(
  parts: Iterable<P>,
  def: EquipRowDef,
  hintSkus: readonly string[],
  limit = 8
): P[] {
  const words = def.search.map((w) => w.toLowerCase());
  const hinted = new Set(hintSkus);
  const scored: Array<{ p: P; score: number }> = [];
  for (const p of parts) {
    const cat = p.category || "";
    if (def.curtain ? cat !== "Fabric" : cat === "Fabric" || cat === "Labor") continue;
    const text = `${p.desc} ${cat}`.toLowerCase();
    let score = hinted.has(p.sku) ? 10 : 0;
    for (const w of words) if (text.includes(w)) score += 1;
    if (score > 0) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.p.desc.localeCompare(b.p.desc))
    .slice(0, Math.max(1, limit))
    .map((s) => s.p);
}
```

- [ ] **Step 4: Create the tab strip and put it on the General page**

Create `src/app/(app)/design/grid/settings/settings-tabs.tsx`:

```tsx
import Link from "next/link";

/** Grid Settings sections (#GEM): General (the card stack) | Equipment map. */
export function GridSettingsTabs({ active }: { active: "general" | "equipment" }) {
  const tab = (key: "general" | "equipment", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: "none",
        color: active === key ? "#16181d" : "#737985",
        background: active === key ? "#fff" : "transparent",
        boxShadow: active === key ? "0 1px 2px rgba(0,0,0,.08)" : "none",
      }}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Grid settings sections" style={{ display: "inline-flex", gap: 4, background: "#f1f2f5", borderRadius: 10, padding: 4, marginBottom: 18 }}>
      {tab("general", "/design/grid/settings", "General")}
      {tab("equipment", "/design/grid/settings/equipment-map", "Equipment map")}
    </nav>
  );
}
```

In `src/app/(app)/design/grid/settings/page.tsx`, add `import { GridSettingsTabs } from "./settings-tabs";`. Then insert `<GridSettingsTabs active="general" />` as the first child after the header `<div>` block, just before `<SymbolColorsCard …`. The admin-required branch stays unchanged.

- [ ] **Step 5: Add the four admin actions**

In `src/app/(app)/design/grid/settings/actions.ts`, add these imports under the existing ones:

```ts
import { list as listCatalog } from "@/lib/stores/catalog";
import { clearEquipmentRow, saveEquipmentRow } from "@/lib/stores/equipment-map";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import { LEGACY_HINTS, legacyHintSkus } from "@/lib/design/equipment-legacy-hints";
import { suggestParts } from "@/lib/design/equipment-map-view";
import type { EquipRowInput } from "@/lib/design/equipment-map";
import { searchCatalog } from "@/app/(app)/estimator/actions";
```

and append at EOF:

```ts
/* ----------------------------- Equipment map (#GEM) ----------------------------- */

export type EquipPartHit = { sku: string; desc: string; category: string; unit: string; cost: number; list: number };

function revalidateEquipment() {
  revalidatePath("/design/grid/settings/equipment-map");
  // Scope targets, Quick Design and the Designs dashboard all price through the map.
  revalidatePath("/", "layout");
}

/** Save one row (all three tiers). An allowance must arrive confirmed; who/when is stamped server-side. */
export async function saveEquipmentRowAction(
  rowKey: string,
  input: EquipRowInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveEquipmentRow(String(rowKey ?? ""), input, user.name);
  if (!r.ok) return r;
  revalidateEquipment();
  return { ok: true };
}

export async function clearEquipmentRowAction(rowKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await clearEquipmentRow(String(rowKey ?? "")))) return { ok: false, error: "Unknown equipment row." };
  revalidateEquipment();
  return { ok: true };
}

/** Server-side part search (never the whole ~37k catalog on the client). Admin page, so cost is shown. */
export async function searchEquipmentPartsAction(query: string): Promise<{ hits: EquipPartHit[]; total: number }> {
  await requirePerm("manage_users");
  const { hits, total } = await searchCatalog(String(query ?? ""), "", 20);
  return {
    hits: hits.map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })),
    total,
  };
}

/** Suggested matches for one row, on demand (one catalog pass per click, never 46 on page load). */
export async function suggestEquipmentPartsAction(rowKey: string): Promise<{ hits: EquipPartHit[] }> {
  await requirePerm("manage_users");
  const def = EQUIPMENT_ROW_BY_KEY.get(String(rowKey ?? ""));
  if (!def) return { hits: [] };
  const parts = await listCatalog();
  return {
    hits: suggestParts(parts, def, legacyHintSkus(LEGACY_HINTS[def.key]), 8).map((p) => ({
      sku: p.sku, desc: p.desc, category: p.category || "", unit: p.unit || "ea", cost: p.cost || 0, list: p.list || 0,
    })),
  };
}
```

- [ ] **Step 6: Create the page**

Create `src/app/(app)/design/grid/settings/equipment-map/page.tsx`:

```tsx
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates } from "@/lib/stores/pricing";
import { getEquipmentMap } from "@/lib/stores/equipment-map";
import { mapSkus } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROWS } from "@/lib/design/equipment-vocab";
import { LEGACY_HINTS, legacyHintSkus, legacyHintText } from "@/lib/design/equipment-legacy-hints";
import { assemblyOptions, equipmentMapView, mapSummary } from "@/lib/design/equipment-map-view";
import { fixtureSkus } from "@/lib/fixture-assemblies";
import { GridSettingsTabs } from "../settings-tabs";
import EquipmentMapClient from "./equipment-map-client";

export const metadata = { title: "Equipment map — Grid settings — Quartzite-6" };
export const dynamic = "force-dynamic";
/** listFixtures() can run #210's one-time conversion on its first read (15 s budget). */
export const maxDuration = 60;

/**
 * Grid Settings → Equipment map (#GEM, spec §3). Every equation item × tier
 * → catalog part / assembly / confirmed allowance. Admin-only (manage_users —
 * the Estimating Rules gate). Read-only on load: nothing here writes. Reads
 * the map, every fixture/system, and ONLY the catalog SKUs they reference
 * (one getMany) — never the whole book.
 */
export default async function EquipmentMapPage() {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 20 }}>Equipment map</div>
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            The Equipment map decides what Auto designs are priced with, so it is limited to admins (same as Estimating Rules).
          </div>
        </div>
      </div>
    );
  }

  const [map, fixtureList, rates] = await Promise.all([getEquipmentMap(), listFixtures(), getCatalogRates()]);
  const fixtures = new Map(fixtureList.map((f) => [f.id, f]));
  const skus = new Set(mapSkus(map, fixtures));
  for (const f of fixtureList) for (const sku of fixtureSkus(f)) skus.add(sku);
  const parts = new Map((skus.size ? await getMany([...skus]) : []).map((p) => [p.sku, p]));
  const ctx = { parts, fixtures, margin: rates.defaultMargin };
  const hints = Object.fromEntries(
    EQUIPMENT_ROWS.map((r) => [r.key, { text: legacyHintText(LEGACY_HINTS[r.key]), skus: legacyHintSkus(LEGACY_HINTS[r.key]) }])
  );
  const rows = equipmentMapView(map, ctx, hints);

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Grid settings</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 14px" }}>
        What Auto designs are priced with — every equation item, per tier, from the catalog.
      </div>
      <GridSettingsTabs active="equipment" />
      <EquipmentMapClient rows={rows} assemblies={assemblyOptions(fixtureList, ctx)} summary={mapSummary(rows)} />
    </div>
  );
}
```

- [ ] **Step 7: Create the client editor**

Create `src/app/(app)/design/grid/settings/equipment-map/equipment-map-client.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { EquipCellInput, EquipRowInput, EquipRowStatus } from "@/lib/design/equipment-map";
import type { AssemblyOption, EquipCellVM, EquipRowVM } from "@/lib/design/equipment-map-view";
import {
  clearEquipmentRowAction,
  saveEquipmentRowAction,
  searchEquipmentPartsAction,
  suggestEquipmentPartsAction,
  type EquipPartHit,
} from "../actions";

const TIERS: Array<{ key: TierKey; label: string }> = [
  { key: "good", label: "Good" },
  { key: "better", label: "Better" },
  { key: "best", label: "Best" },
];
const STATUS: Record<EquipRowStatus, { label: string; ink: string; bg: string }> = {
  mapped: { label: "Mapped", ink: "#1f7a52", bg: "#eaf6ef" },
  allowance: { label: "Allowance", ink: "#8a6d1f", bg: "#fbf3dd" },
  "needs-part": { label: "Needs a part", ink: "#a0442b", bg: "#fbeae5" },
};
const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const day = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

type Filter = "all" | EquipRowStatus;

export default function EquipmentMapClient({
  rows,
  assemblies,
  summary,
}: {
  rows: EquipRowVM[];
  assemblies: AssemblyOption[];
  summary: Record<EquipRowStatus, number>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const groups: Array<[string, EquipRowVM[]]> = [];
  for (const r of shown) {
    const g = groups.find(([label]) => label === r.systemLabel);
    if (g) g[1].push(r);
    else groups.push([r.systemLabel, [r]]);
  }
  const chip = (key: Filter, label: string, n: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      style={{ ...BTN, background: filter === key ? "#16181d" : "#fff", color: filter === key ? "#fff" : "#3d424e" }}
    >
      {label} · {n}
    </button>
  );

  return (
    <div>
      <section className="pk-card" style={{ padding: "15px 17px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.55 }}>
          Map every equation item to a catalog part or an assembly for each tier. Auto uses only <b>Mapped</b> and
          confirmed <b>Allowance</b> rows; <b>Needs a part</b> rows are left off Auto plans and listed on the Equipment step.
          Nothing is mapped for you — each row shows the figure the old equations assumed, for reference only.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {chip("all", "All", rows.length)}
          {chip("needs-part", "Needs a part", summary["needs-part"])}
          {chip("allowance", "Allowance", summary.allowance)}
          {chip("mapped", "Mapped", summary.mapped)}
        </div>
      </section>

      {groups.map(([label, list]) => (
        <section key={label} className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8 }}>{label}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {list.map((r) => (
              <div key={r.key} id={`row-${r.key.replace(":", "-")}`} style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{r.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#9aa0ab" }}>{r.key} · per {r.unit}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: STATUS[r.status].ink, background: STATUS[r.status].bg, borderRadius: 999, padding: "2px 8px" }}>
                    {STATUS[r.status].label}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} style={BTN}>
                    {open === r.key ? "Close" : "Edit"}
                  </button>
                </div>
                {r.hint && <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 4 }}>{r.hint} (reference only, not used in any total)</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                  {r.cells.map((c) => <CellSummary key={c.tier} cell={c} />)}
                </div>
                {r.updatedBy && <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 6 }}>Last edited by {r.updatedBy} · {day(r.updatedAt)}</div>}
                {open === r.key && <RowEditor row={r} assemblies={assemblies} onClose={() => setOpen(null)} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CellSummary({ cell }: { cell: EquipCellVM }) {
  const tier = TIERS.find((t) => t.key === cell.tier)!.label;
  return (
    <div style={{ background: cell.kind === "empty" || cell.problem ? "#fdf6f3" : "#f7f8fa", borderRadius: 8, padding: "7px 9px", minWidth: 0 }}>
      <div style={LABEL}>{tier}</div>
      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell.title}</div>
      {cell.detail && <div style={{ fontSize: 11, color: "#737985", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell.detail}</div>}
      {cell.kind !== "empty" && !cell.problem && (
        <div style={{ fontSize: 11, color: "#5b616e", marginTop: 2 }}>
          {cell.perSqft ? `${money(cell.unitCost)} / sq ft + making` : `cost ${money(cell.unitCost)} · sell ${money(cell.unitSell)}`}
        </div>
      )}
      {cell.confirmedBy && <div style={{ fontSize: 10.5, color: "#8a6d1f", marginTop: 2 }}>Confirmed by {cell.confirmedBy} · {day(cell.confirmedAt)}</div>}
      {cell.problem && <div style={{ fontSize: 11, color: "#a0442b", marginTop: 2 }}>{cell.problem}</div>}
    </div>
  );
}

function RowEditor({ row, assemblies, onClose }: { row: EquipRowVM; assemblies: AssemblyOption[]; onClose: () => void }) {
  const router = useRouter();
  const [sameAll, setSameAll] = useState(row.sameAll);
  const [cells, setCells] = useState<Record<TierKey, EquipCellInput>>(() => ({
    good: row.cells[0].input,
    better: row.cells[1].input,
    best: row.cells[2].input,
  }));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const tiers = sameAll ? TIERS.slice(0, 1) : TIERS;
  const save = () =>
    start(async () => {
      setError("");
      const input: EquipRowInput = { sameAll, tiers: sameAll ? { good: cells.good } : cells };
      const r = await saveEquipmentRowAction(row.key, input);
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600 }}>
        <input type="checkbox" checked={sameAll} onChange={(e) => setSameAll(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Same for all tiers
      </label>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiers.length}, minmax(0, 1fr))`, gap: 10, marginTop: 10 }}>
        {tiers.map((t) => (
          <div key={t.key}>
            <div style={LABEL}>{sameAll ? "All tiers" : t.label}</div>
            <CellEditor
              rowKey={row.key}
              curtain={row.curtain}
              value={cells[t.key]}
              assemblies={assemblies}
              onChange={(v) => setCells((c) => ({ ...c, [t.key]: v }))}
            />
          </div>
        ))}
      </div>
      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending} style={{ ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}>
          {pending ? "Saving…" : "Save row"}
        </button>
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
        <span style={{ flex: 1 }} />
        <ConfirmButton
          label="Clear row"
          confirmLabel="Clear all tiers?"
          pendingLabel="Clearing…"
          style={BTN}
          onConfirm={async () => {
            const r = await clearEquipmentRowAction(row.key);
            if (!r.ok) setError(r.error);
            else {
              onClose();
              router.refresh();
            }
          }}
        />
      </div>
    </div>
  );
}

function CellEditor({
  rowKey,
  curtain,
  value,
  assemblies,
  onChange,
}: {
  rowKey: string;
  curtain: boolean;
  value: EquipCellInput;
  assemblies: AssemblyOption[];
  onChange: (v: EquipCellInput) => void;
}) {
  const kind = value?.kind ?? "empty";
  const pick = (k: string) =>
    onChange(
      k === "part" ? { kind: "part", sku: "" }
        : k === "assembly" ? { kind: "assembly", id: "" }
          : k === "allowance" ? { kind: "allowance", amount: 0, note: "", confirmed: false }
            : null
    );
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <select value={kind} onChange={(e) => pick(e.target.value)} style={INPUT}>
        <option value="empty">Needs a part</option>
        <option value="part">{curtain ? "Catalog fabric" : "Catalog part"}</option>
        {!curtain && <option value="assembly">Assembly (fixture or system)</option>}
        <option value="allowance">Allowance</option>
      </select>
      {value?.kind === "part" && <PartPicker rowKey={rowKey} sku={value.sku} onPick={(sku) => onChange({ kind: "part", sku })} />}
      {value?.kind === "assembly" && (
        <select value={value.id} onChange={(e) => onChange({ kind: "assembly", id: e.target.value })} style={INPUT}>
          <option value="">Pick an assembly…</option>
          {assemblies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.kind === "system" ? `System (${a.scope})` : "Fixture"} · sell {money(a.unitSell)}
            </option>
          ))}
        </select>
      )}
      {value?.kind === "allowance" && (
        <>
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.amount || ""}
            placeholder={curtain ? "Unit cost per drape, $" : "Unit cost, $"}
            onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
            style={INPUT}
          />
          <input value={value.note ?? ""} placeholder="Why (e.g. waiting on the vendor's price book)" onChange={(e) => onChange({ ...value, note: e.target.value })} style={INPUT} />
          <label style={{ display: "flex", gap: 6, fontSize: 11.5, color: "#5b616e", alignItems: "flex-start" }}>
            <input type="checkbox" checked={value.confirmed} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })} style={{ accentColor: "var(--accent)" }} />
            I confirm this allowance. It prices Auto designs, flagged internally, until a real part is mapped.
          </label>
        </>
      )}
    </div>
  );
}

function PartPicker({ rowKey, sku, onPick }: { rowKey: string; sku: string; onPick: (sku: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EquipPartHit[]>([]);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await searchEquipmentPartsAction(v);
          setHits(r.hits);
          setNote(r.hits.length ? `${r.total} match${r.total === 1 ? "" : "es"}${r.total > r.hits.length ? " — refine to narrow" : ""}` : "No matches");
        }),
      250
    );
  };
  const suggest = () =>
    start(async () => {
      const r = await suggestEquipmentPartsAction(rowKey);
      setHits(r.hits);
      setNote(r.hits.length ? "Suggested matches" : "No suggestions — search instead");
    });
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {sku && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{sku}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={q} onChange={(e) => search(e.target.value)} placeholder="Search SKU, description, maker…" style={{ ...INPUT, flex: 1 }} />
        <button type="button" onClick={suggest} style={BTN}>Suggest</button>
      </div>
      {pending ? <div style={{ fontSize: 11, color: "#8c919c" }}>Searching…</div> : note && <div style={{ fontSize: 11, color: "#8c919c" }}>{note}</div>}
      {hits.map((h) => (
        <button
          key={h.sku}
          type="button"
          onClick={() => {
            onPick(h.sku);
            setHits([]);
            setNote("");
          }}
          style={{ ...BTN, textAlign: "left", fontWeight: 500, background: h.sku === sku ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#fff" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{h.sku}</span> — {h.desc}
          <span style={{ color: "#8c919c" }}> · {h.category} · cost {money(h.cost)} · list {money(h.list)}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Register the route with the smoke test**

In `scripts/smoke-routes.ts`, add this line directly under the `"/design/grid/settings", …` entry (line 97):

```ts
  "/design/grid/settings/equipment-map", // #GEM Equipment map tab (admin; read-only on load)
```

- [ ] **Step 9: Run the specs + types + lint**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `ALL PASSED`, **4003** PASS lines (3991 + 12); tsc silent; eslint 0 errors, ≤ 110 warnings.

- [ ] **Step 10: Build + smoke**

Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next && npm run test:smoke 2>&1 | tail -5`
Expected: the build succeeds. Every smoke route is OK, including `/design/grid/settings/equipment-map`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/design/equipment-map-view.ts "src/app/(app)/design/grid/settings" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): Equipment map tab in Grid Settings (#GEM T3)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scope targets move to the server; the old seeder goes

**Files:**
- Create: `src/lib/design/scope-targets.ts`
- Modify: `src/app/(app)/design/quick/engine.ts`: `BomItem` gains `status`; `scopeTargets` is removed (lines 845–874).
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (targets computed here; `engineFabrics` stays server-side)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (prop `engineFabrics` → `scopeTargets`)
- Modify: `src/app/(app)/design/grid/[id]/scope-panel.tsx` (reads sell-only targets; needs-a-part / allowance counts)
- Modify: `src/lib/design/grid-seed.ts`: trimmed to the placeholder helpers.
- Modify: `src/app/(app)/design/grid/[id]/actions.ts`: `seedStartingLayoutAction` and its imports are removed.
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes: `compute`, `tierSystems` (the pre-Task-5 signature `(C, s, tier, tierDefs, fabrics)`), `tierDefsDefault`, `defaultAState`, `SystemBlock`, `AState`, `QuickScopeInputs`, `SysKey`, `TierKey`.
- Produces:
  - `BomItem.status?: "part" | "assembly" | "allowance" | "needs-part"`
  - `type ScopeTarget = { sell: number; needsPart: number; allowances: number }`
  - `type ScopeTargets = Partial<Record<SysKey, ScopeTarget>>`
  - `type ScopeTargetsByTier = Record<TierKey, ScopeTargets>`
  - `type PriceSystems = (s: AState, tier: TierKey) => SystemBlock[]`
  - `targetsFromSystems(systems): ScopeTargets`
  - `scopeTargetsByTier(inputs, price): ScopeTargetsByTier`
  - `ScopePanel` prop `targets: ScopeTargetsByTier | null`, replacing `engineFabrics`.
  - `GridEditor` prop `scopeTargets: ScopeTargetsByTier | null`, replacing `engineFabrics`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T4: Scope targets are computed on the server; the old seeder is gone --- */
import { scopeTargetsByTier as gemTargetsByTier4, targetsFromSystems as gemTargetsFrom4 } from "@/lib/design/scope-targets";
import { defaultAState as gemDefault4, type SystemBlock as GemSystemBlock4 } from "@/app/(app)/design/quick/engine";
{
  type St = "part" | "assembly" | "allowance" | "needs-part";
  const sys = (key: string, on: boolean, rev: number, items: Array<{ key: string; qty: number; status?: St }>): GemSystemBlock4 => ({
    key: key as GemSystemBlock4["key"], name: key, on, m: 0.3, dot: "", rev, cost: 0,
    items: items.map((i) => ({ key: i.key, desc: i.key, qty: i.qty, unit: "ea", cost: 0, price: 0, ...(i.status ? { status: i.status } : {}) })),
  });
  const inputs = { ...gemDefault4(0), venue: "pac" };
  const seen: string[] = [];
  const byTier = gemTargetsByTier4(inputs, (s, tier) => {
    seen.push(`${tier}:${s.tier}`);
    return [
      sys("lighting", true, tier === "best" ? 300 : 100, [
        { key: "lighting:par", qty: 4, status: "needs-part" },
        { key: "lighting:front", qty: 2, status: "allowance" },
        { key: "lighting:cyc", qty: 0, status: "needs-part" },
      ]),
      sys("controls", false, 999, []),
    ];
  });
  ok(seen.join(",") === "good:good,better:better,best:best", "#GEM T4: the pricer runs once per tier, with that tier set on the state");
  ok(byTier.best.lighting?.sell === 300 && byTier.good.lighting?.sell === 100, "#GEM T4: one target per tier, from the priced system's revenue");
  ok(byTier.better.lighting?.needsPart === 1 && byTier.better.lighting?.allowances === 1, "#GEM T4: needs-a-part and allowance lines are counted, qty-0 lines are not");
  ok(!("controls" in byTier.better) && Object.keys(gemTargetsFrom4([])).length === 0, "#GEM T4: an off system gets no target");
  const spSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/scope-panel.tsx"), "utf8");
  ok(!spSrc.includes("scopeTargets(") && !spSrc.includes("FabricOption") && !spSrc.includes("subscribeTierDefs"), "#GEM T4: the Scope panel computes no targets in the browser");
  const edSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/editor.tsx"), "utf8");
  const pgSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/page.tsx"), "utf8");
  ok(!edSrc.includes("engineFabrics") && !pgSrc.includes("engineFabrics={") && pgSrc.includes("scopeTargets={scopeTargets}"), "#GEM T4: no cost-bearing fabric rows cross to the Grid client (D139's crossing is gone)");
  const seedSrc = readFileSync(join(process.cwd(), "src/lib/design/grid-seed.ts"), "utf8");
  const actSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/actions.ts"), "utf8");
  ok(!seedSrc.includes("quick/engine") && !seedSrc.includes("deriveSeedPlacements") && seedSrc.includes("export function isSeedPlaceholder"), "#GEM T4: grid-seed keeps only the placeholder helpers");
  ok(!actSrc.includes("seedStartingLayoutAction") && !actSrc.includes("deriveSeedPlacements"), "#GEM T4: the old seeding action is removed");
}
```

This block has **8** `ok(` calls.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: cannot resolve `@/lib/design/scope-targets`.

- [ ] **Step 3: Add `status` to `BomItem`; drop the engine's `scopeTargets`**

In `src/app/(app)/design/quick/engine.ts`, add this field to `BomItem`, after `price: number;`:

```ts
  /** Set by the Equipment map pricing step (#GEM): how this line priced. */
  status?: "part" | "assembly" | "allowance" | "needs-part";
```

Delete the whole `scopeTargets` function with its doc comment (lines 845–874, from `/**\n * Good/Better/Best dollar target per in-scope system` through its closing `}`).

- [ ] **Step 4: Create the pure target module**

Create `src/lib/design/scope-targets.ts`:

```ts
/**
 * Grid Scope panel targets (#GEM, D-GEM-5) — pure, computed on the SERVER.
 * grid/[id]/page.tsx runs the estimate pipeline once per tier and sends only
 * these sell numbers to the editor: the client never holds a price table, a
 * unit cost or a pricing constant. That is what removes D139's crossing of
 * the sell-only boundary. A needs-a-part line is COUNTED, never summed.
 */
import {
  defaultAState,
  type AState,
  type QuickScopeInputs,
  type SysKey,
  type SystemBlock,
  type TierKey,
} from "@/app/(app)/design/quick/engine";

export type ScopeTarget = { sell: number; needsPart: number; allowances: number };
export type ScopeTargets = Partial<Record<SysKey, ScopeTarget>>;
export type ScopeTargetsByTier = Record<TierKey, ScopeTargets>;
/** Price the estimate for one tier: (merged state with `tier` set, tier) → priced systems. */
export type PriceSystems = (s: AState, tier: TierKey) => SystemBlock[];

export function targetsFromSystems(systems: SystemBlock[]): ScopeTargets {
  const out: ScopeTargets = {};
  for (const sys of systems) {
    if (!sys.on) continue;
    let needsPart = 0;
    let allowances = 0;
    for (const it of sys.items) {
      if (it.qty <= 0) continue;
      if (it.status === "needs-part") needsPart += 1;
      else if (it.status === "allowance") allowances += 1;
    }
    out[sys.key] = { sell: sys.rev, needsPart, allowances };
  }
  return out;
}

/** Good / Better / Best targets for a project's live scope inputs (merged onto defaultAState so every compute() field exists). */
export function scopeTargetsByTier(inputs: QuickScopeInputs, price: PriceSystems): ScopeTargetsByTier {
  const one = (tier: TierKey) => targetsFromSystems(price({ ...defaultAState(0), ...inputs, tier }, tier));
  return { good: one("good"), better: one("better"), best: one("best") };
}
```

- [ ] **Step 5: Compute the targets in the page**

In `src/app/(app)/design/grid/[id]/page.tsx`:

(a) Imports: keep `import type { FabricOption } …` and add:

```ts
import { compute, tierDefsDefault, tierSystems } from "@/app/(app)/design/quick/engine";
import { scopeTargetsByTier } from "@/lib/design/scope-targets";
```

(b) Replace the `engineFabrics` block (lines 133–137, with its comment) with:

```ts
  // Scope targets (#GEM, D-GEM-5) — computed HERE; only sell numbers reach the
  // editor. The cost-bearing fabric rows below never leave the server.
  const engineFabrics: FabricOption[] = catalog
    .filter((p) => p.category === "Fabric")
    .map((p) => ({ sku: p.sku, desc: p.desc, costPerSqft: p.costPerSqft ?? null }));
  const scopeTargets = project.scopeInputs
    ? scopeTargetsByTier(project.scopeInputs, (s, t) => tierSystems(compute(s), s, t, tierDefsDefault(), engineFabrics))
    : null;
```

(c) In the `<GridEditor …>` props replace `engineFabrics={engineFabrics}` with `scopeTargets={scopeTargets}`.

- [ ] **Step 6: Thread the targets through the editor**

In `src/app/(app)/design/grid/[id]/editor.tsx`:

- Line 52: `import type { QuickScopeInputs } from "@/app/(app)/design/quick/engine";`, which drops `FabricOption`.
- Add `import type { ScopeTargetsByTier } from "@/lib/design/scope-targets";`.
- In the destructured props (line 238) replace `engineFabrics,` with `scopeTargets,`.
- In the props type, replace the `engineFabrics` doc comment and field (lines 255–258) with:

```ts
  /** Scope panel Good/Better/Best targets per scope (#GEM, D-GEM-5) — SELL
   *  numbers computed server-side (grid/[id]/page.tsx); no cost crosses. */
  scopeTargets: ScopeTargetsByTier | null;
```

- In the `<ScopePanel …>` element replace `engineFabrics={engineFabrics}` with `targets={scopeTargets}`.

- [ ] **Step 7: Make the Scope panel read sell-only targets**

In `src/app/(app)/design/grid/[id]/scope-panel.tsx`:

(a) Replace the imports block (lines 3–25) with:

```tsx
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  SHORT,
  SYS_ORDER,
  TIERS,
  type QuickScopeInputs,
  type SysKey,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import { getAccentHex, getAccentHexServer, subscribeAccent } from "@/app/(app)/design/quick/tierdefs-store";
import ScopeInputsPanel from "@/components/design/scope-inputs-panel";
import type { RollupSlice } from "@/lib/design/grid-bom";
import type { ScopeTargetsByTier } from "@/lib/design/scope-targets";
import { scopeColor, TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
import { setScopeInputsAction } from "./actions";
```

(b) In the header doc comment, replace the sentence that begins "then runs the SAME estimating engine (scopeTargets) against it" with: "and lines the SERVER-computed Good/Better/Best sell targets (#GEM, D-GEM-5 — priced from the Equipment map) up against what's actually been placed on the sheet".

(c) Replace `ProgressRow` with:

```tsx
function ProgressRow({
  label,
  color,
  placed,
  target,
  needsPart = 0,
  allowances = 0,
}: {
  label: string;
  color: string;
  placed: number;
  target: number;
  needsPart?: number;
  allowances?: number;
}) {
  const pct = target > 0 ? Math.min(1, placed / target) : placed > 0 ? 1 : 0;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "#3d424e" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 auto" }} />
          {label}
        </span>
        <span style={{ color: "#8c919c" }}>
          {moneyFmt(placed)} {target > 0 ? `/ ${moneyFmt(target)}` : "· no target"}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "#edeff3", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct * 100}%`, background: color, transition: "width .2s" }} />
      </div>
      {(needsPart > 0 || allowances > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10.5 }}>
          {needsPart > 0 && (
            <a href="/design/grid/settings/equipment-map" style={{ color: "#a0442b", textDecoration: "none" }}>
              {needsPart} item{needsPart === 1 ? "" : "s"} need{needsPart === 1 ? "s" : ""} a part — not in the target
            </a>
          )}
          {allowances > 0 && (
            <span style={{ color: "#8a6d1f" }}>
              {allowances} allowance{allowances === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

(d) Props: in the destructure replace `engineFabrics,` with `targets,`. In the type, replace `engineFabrics: FabricOption[];` with:

```ts
  /** Sell-only Good/Better/Best targets per scope, computed server-side (#GEM). */
  targets: ScopeTargetsByTier | null;
```

(e) Delete the line `const tierDefs = useSyncExternalStore(subscribeTierDefs, getTierDefs, getTierDefsServer);`.

(f) Replace the `const targets = useMemo(…)` block (lines 215–218) with:

```tsx
  const tierTargets = targets?.[tierKey] ?? {};
```

(g) In the tracked-rows map, replace the `<ProgressRow … target={targets[k] || 0} />` element with:

```tsx
                <ProgressRow
                  key={k}
                  label={SHORT[k]}
                  color={scopeColor(scopeKey)}
                  placed={placed}
                  target={tierTargets[k]?.sell || 0}
                  needsPart={tierTargets[k]?.needsPart || 0}
                  allowances={tierTargets[k]?.allowances || 0}
                />
```

- [ ] **Step 8: Trim `grid-seed.ts`; remove the seeding action**

Replace the whole content of `src/lib/design/grid-seed.ts` with:

```ts
/**
 * Seed placeholders (#38 Task 2, D149) — what is LEFT of the old "generate
 * starting layout" seeder. The seeder itself (deriveSeedPlacements +
 * seedStartingLayoutAction) is gone: the Auto intake's catalog-backed fill
 * (#GEM, grid-auto-fill.ts) replaced it, as D186 planned. These helpers stay
 * because a preview deploy may have written placeholder placements (D186), and
 * the quote guard, the editor and the drawing set still recognise them.
 */

/** Non-catalog placeholder prefix — never resolves against the catalog. */
export const SEED_PART_PREFIX = "grid-seed:";

export function seedPlaceholderPartId(key: string): string {
  return `${SEED_PART_PREFIX}${key}`;
}

/** True for any placement carrying a seed placeholder id. */
export function isSeedPlaceholder(partId: string): boolean {
  return partId.startsWith(SEED_PART_PREFIX);
}
```

In `src/app/(app)/design/grid/[id]/actions.ts`:
- delete line 40, `import { deriveSeedPlacements } from "@/lib/design/grid-seed";`;
- delete `addPlacements,` from the `@/lib/stores/grid-projects` import list, since it would otherwise be an unused import and add a lint warning;
- delete the whole `seedStartingLayoutAction` function with its doc comment, from `/**\n * "Generate starting layout from dims"` through the function's closing `}`.

- [ ] **Step 9: Run the specs + types + lint**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `ALL PASSED`, **4011** PASS lines (4003 + 8); tsc silent; eslint 0 errors, ≤ 110 warnings. If `useMemo` is now unused in `scope-panel.tsx`, it has already been dropped from the import in step 7(a).

- [ ] **Step 10: Build**

Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next`
Expected: the build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/lib/design/scope-targets.ts src/lib/design/grid-seed.ts "src/app/(app)/design/quick/engine.ts" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/scope-panel.tsx" "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(grid): Scope targets computed server-side, sell-only; retire the seeder (#GEM T4)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The estimate prices only through the Equipment map

**Files:**
- Create: `src/lib/design/equipment-pricing.ts`
- Modify: `src/app/(app)/design/quick/engine.ts`: `compute()` emits quantities only. Removed: `TIER_SKUS`, `curtainMakeCost`, `fabricRate`, `applyFabrics`, `applySkus`, `tierSystems`, `tierSystemsBase`, `FabricOption`, the curtain-pricing import. `BomItem` gains `drape`/`ref`/`refDesc`.
- Modify: `src/app/(app)/design/quick/page.tsx`, `src/app/(app)/design/quick/quick-design-client.tsx`
- Modify: `src/app/(app)/design/designs/page.tsx`, `src/app/(app)/design/designs/design-client.tsx`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (targets from the map table)
- Test: `scripts/test-review-and-spec.ts` (rewrite the three pre-#GEM engine blocks at lines 2795–2842; append a block at EOF)

**Interfaces:**
- Consumes (Task 2): `EquipmentPriceTable`, `UnitPrice`, `sellFromCost`, `buildEquipmentPriceTable`, `loadEquipPriceCtx`, `loadEquipmentPriceTable`. From the engine: `applyOverrides`, `scaleSets`, `tierDefsDefault`. From curtain-pricing: `curtainCost`, `makingRateFor`. Task 4: `scopeTargetsByTier`.
- Produces:
  - `type DrapeGeom = { w: number; h: number; fullness: number; qty: number }` (engine)
  - `BomItem = { key; desc; qty; unit; cost; price; status?; ref?; refDesc?; drape?: DrapeGeom }`
  - `compute(s: AState): ComputeResult`; the second parameter is gone.
  - `drapeUnitCost(drape, areaRate): number`
  - `applyEquipment(systems, tierKey, table, overrides?): SystemBlock[]`
  - `tierSystemsBase(C, s, tierKey, tierDefs, table, overrides?)`
  - `tierSystems(C, s, tierKey, tierDefs, table, overrides?)`
  - `QuickDesignClient` props: `prices: EquipmentPriceTable` replaces `fabrics`; `fixtureAssemblies` items gain `sell`.
  - `DesignClient` props: `prices: EquipmentPriceTable` replaces `fabrics`.

- [ ] **Step 1: Write the failing test and retire the old engine blocks**

(a) In `scripts/test-review-and-spec.ts`, line 2796 reads `import { compute as computeQuick, defaultAState, tierSystems, curtainMakeCost, tierDefsDefault } from "@/app/(app)/design/quick/engine";`. Replace it with:

```ts
import { defaultAState } from "@/app/(app)/design/quick/engine";
```

(b) Delete the three `{ … }` blocks that follow the imports at lines 2797–2800: the Draw-cost block, the "Assembly Builder" fixture block, and the "tier-pipeline Draw cost" block, together with that block's `/* --- the tier pipeline (what the screen renders) … */` comment. In the base file they span lines 2801–2842, ending just before `/* --- budget and quote agree on the same drape (task 7) --- */`. Put this comment in their place:

```ts
/* The three pre-#GEM blocks that stood here (compute()'s own curtain cost, a
 * Quick Design fixture pick, the tier pipeline's curtain cost) moved into the
 * "#GEM T5" block at EOF: compute() no longer carries dollars (D-GEM-4). */
```

Keep the imports on lines 2797–2800 (`designPatchFromIntake`, `TRACKABLE_SYS_KEYS`, `drapeRuleQ`, `curtainCostQ`/`RATES_Q`/`makingForQ`); the task 7 block below still uses them. Deleting the three blocks removes **3** `ok(` calls.

(c) Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T5: the estimate prices only through the Equipment map — no built-in dollars --- */
import { compute as gemCompute5, defaultAState as gemDefault5, tierDefsDefault as gemTierDefs5, type AState as GemAState5 } from "@/app/(app)/design/quick/engine";
import { applyEquipment as gemApply5, drapeUnitCost as gemDrape5, tierSystems as gemTierSystems5 } from "@/lib/design/equipment-pricing";
import { buildEquipmentPriceTable as gemTable5 } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY as gemRowByKey5 } from "@/lib/design/equipment-vocab";
import { curtainCost as gemCurtainCost5, makingRateFor as gemMaking5 } from "@/lib/design/curtain-pricing";
import { drapeRule as gemDrapeRule5 } from "@/lib/design/goods";
import { readdirSync as gemReaddir5 } from "node:fs";
{
  const base = gemDefault5(0);
  const s: GemAState5 = {
    ...base, venue: "school", size: "medium", width: 40, depth: 30, grid: 24, wing: 12, ph: 20, rigType: "counterweight", tier: "better",
    sys: { ...base.sys, rigging: true, curtains: true, lighting: true, audio: true, video: false, controls: false, acoustical: false, pit: false },
    drape: { draw: true, legs: false, border: false, scenerytrack: true, fullstage: false },
    fixtures: { par: true, front: false, cyc: false, side: false, automated: false },
  };
  const C = gemCompute5(s);
  const all = C.systems.flatMap((x) => x.items);
  ok(all.length > 0 && all.every((it) => it.cost === 0 && it.price === 0) && C.systems.every((x) => x.rev === 0 && x.cost === 0), "#GEM T5: compute() carries quantities only — no built-in dollars");
  ok(all.every((it) => gemRowByKey5.get(it.key)?.unit === it.unit), "#GEM T5: every item's unit is its Equipment map row's unit");
  const track = all.find((it) => it.key === "curtains:scenerytrack")!;
  ok(track.unit === "ft" && track.qty === 3 * 44, `#GEM T5: the scenery track emits feet — depth blocks × pipe length (got ${track.qty})`);
  const draw = all.find((it) => it.key === "curtains:draw")!;
  const rule = gemDrapeRule5("Draw", { proWidthFt: 40, proHeightFt: 20, stageWidthFt: 64, stageDepthFt: 30 }, "better")!;
  ok(!!draw.drape && draw.drape.w === rule.w && draw.drape.h === rule.h && draw.drape.fullness === rule.fullness && draw.drape.qty === rule.qty, "#GEM T5: a drape item carries the goods.ts geometry the quote side uses");
  const parts = new Map<string, { sku: string; desc: string; unit: string; cost: number; list: number; category: string; curtainAreaRate?: number }>([
    ["GEM5-PAR", { sku: "GEM5-PAR", desc: "LED par", unit: "ea", cost: 600, list: 900, category: "Lighting Fixtures" }],
    ["GEM5-HB", { sku: "GEM5-HB", desc: "Headblock", unit: "ea", cost: 500, list: 0, category: "Rigging Hardware" }],
    ["GEM5-VEL", { sku: "GEM5-VEL", desc: "Velour", unit: "sq ft", cost: 0, list: 0, category: "Fabric", curtainAreaRate: 3.5 }],
  ]);
  const table = gemTable5({
    "lighting:par": { tiers: { good: { kind: "part", sku: "GEM5-PAR" } }, sameAll: true, updatedBy: "t", updatedAt: 1 },
    "rigging:headblock": { tiers: { better: { kind: "part", sku: "GEM5-HB" } }, updatedBy: "t", updatedAt: 1 },
    "curtains:draw": { tiers: { good: { kind: "part", sku: "GEM5-VEL" } }, sameAll: true, updatedBy: "t", updatedAt: 1 },
    "audio:subwoofer": { tiers: { good: { kind: "allowance", amount: 1200, confirmedBy: "Chris", confirmedAt: 5 } }, sameAll: true, updatedBy: "t", updatedAt: 1 },
  }, { parts, fixtures: new Map(), margin: 0.3 });
  const better = gemTierSystems5(C, s, "better", gemTierDefs5(), table);
  const item = (sys: string, key: string, list = better) => list.find((x) => x.key === sys)!.items.find((i) => i.key === key)!;
  const par = item("lighting", "lighting:par");
  ok(par.cost === 600 && par.price === 900 && par.status === "part" && par.refDesc === "LED par", "#GEM T5: a mapped part prices from the live catalog");
  const hb = item("rigging", "rigging:headblock");
  ok(hb.cost === 500 && hb.price === 714.29, "#GEM T5: a list-less part sells at cost ÷ (1 − catalog margin)");
  const arbor = item("rigging", "rigging:arbor");
  ok(arbor.status === "needs-part" && arbor.cost === 0 && arbor.price === 0, "#GEM T5: an unmapped item is needs-a-part — never a fallback dollar");
  const d = item("curtains", "curtains:draw");
  const expected = Math.round(gemCurtainCost5({ finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty }, { fabricRate: 3.5, makingRate: gemMaking5(rule.fullness) }).costTotal);
  ok(d.cost === expected && d.cost === gemDrape5(draw.drape!, 3.5) && d.price === Math.round((expected / 0.7) * 100) / 100, `#GEM T5: a drape costs the shared two-term model at the mapped fabric's area rate (got ${d.cost}, expected ${expected})`);
  const sub = item("audio", "audio:subwoofer");
  ok(sub.status === "allowance" && sub.cost === 1200, "#GEM T5: a confirmed allowance prices as its unit cost");
  const rig = better.find((x) => x.key === "rigging")!;
  ok(rig.tierFixed === true && rig.cost === rig.items.reduce((a, i) => a + i.qty * i.cost, 0), "#GEM T5: system totals sum only priced lines");
  const good = gemTierSystems5(C, s, "good", gemTierDefs5(), table);
  ok(item("rigging", "rigging:headblock", good).status === "needs-part" && item("lighting", "lighting:par", good).price === 900, "#GEM T5: each tier resolves its own cells (same-for-all rows price every tier)");
  const ov = gemTierSystems5(C, s, "better", gemTierDefs5(), table, { "lighting:par": { status: "assembly", ref: "fa-par", desc: "House PAR assembly", unit: "ea", unitCost: 432, unitSell: 610 } });
  const opar = item("lighting", "lighting:par", ov);
  ok(opar.cost === 432 && opar.price === 610 && opar.refDesc === "House PAR assembly" && opar.desc === "Par", "#GEM T5: a per-design pick overrides the map for that row, keeping the equation's name");
  const once = gemApply5(C.systems, "better", table);
  ok(once.every((x) => x.tierFixed) && once.find((x) => x.key === "lighting")!.rev === par.qty * 900, "#GEM T5: applyEquipment prices every system per tier (tier multipliers are inert)");
  const engSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/quick/engine.ts"), "utf8");
  ok(!/TIER_SKUS|SEED_FABRIC_RATES/.test(engSrc) && !gemValueImports(engSrc).some((m) => /curtain-pricing|equipment-pricing/.test(m)) && !/\bcost:\s*(0\.\d|[1-9]|Math)/.test(engSrc), "#GEM T5: engine.ts holds no dollars and imports nothing cost-bearing");
  const walk = (dir: string): string[] =>
    gemReaddir5(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const gridClient = [...walk(join(process.cwd(), "src/app/(app)/design/grid")), ...walk(join(process.cwd(), "src/components/design"))]
    .map((f) => ({ f, src: readFileSync(f, "utf8") }))
    .filter(({ src }) => src.startsWith('"use client"'));
  const leaks = gridClient.filter(({ src }) => gemValueImports(src).some((m) => /curtain-pricing|equipment-pricing|equipment-legacy-hints|^@\/lib\/stores\/|^@\/db\//.test(m)));
  ok(gridClient.length > 5 && leaks.length === 0, `#GEM T5: no Grid client file imports a cost-bearing module (leaks: ${leaks.map((l) => l.f.split("/src/")[1]).join(", ") || "none"})`);
}
```

This block has **15** `ok(` calls, so the net change is +12. `gemValueImports` comes from the Task 3 block; it is module-scope and hoisted.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: cannot resolve `@/lib/design/equipment-pricing`.

- [ ] **Step 3: Create the pricing module**

Create `src/lib/design/equipment-pricing.ts`:

```ts
/**
 * Equipment pricing (#GEM, D-GEM-4) — the estimate pipeline's ONLY pricing
 * step. compute() (quick/engine.ts) emits quantities; this prices every item
 * from the Equipment map's price table, or from a per-design override (a
 * Quick Design fixture pick, an Auto intake swap). A needs-a-part item stays
 * at $0 with status "needs-part" — never a fallback number.
 *
 * Cost-bearing (unit costs, curtain making rates): server code and the Quick
 * Design / Designs dashboard clients (already cost views) may import it. NO
 * Grid client file does — the #GEM T5 spec guard walks them.
 */
import { curtainCost, makingRateFor } from "./curtain-pricing";
import {
  applyOverrides,
  scaleSets,
  type AState,
  type BomItem,
  type ComputeResult,
  type DrapeGeom,
  type SystemBlock,
  type TierDefs,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import { sellFromCost, type EquipmentPriceTable, type UnitPrice } from "./equipment-map";

/** One drape's make-it cost at a fabric's area rate — the shared two-term model (curtain-pricing.ts). */
export function drapeUnitCost(drape: DrapeGeom, areaRate: number): number {
  return Math.round(
    curtainCost(
      { finishedWidthFt: drape.w, finishedHeightFt: drape.h, fullnessPct: drape.fullness, qty: drape.qty },
      { fabricRate: areaRate, makingRate: makingRateFor(drape.fullness) }
    ).costTotal
  );
}

type Priced = { cost: number; price: number; status: NonNullable<BomItem["status"]>; ref?: string; refDesc?: string };

function priceItem(it: BomItem, p: UnitPrice | undefined, margin: number): Priced {
  if (!p || p.status === "needs-part") return { cost: 0, price: 0, status: "needs-part" };
  // A drape costs per drape from the mapped fabric's area rate; a confirmed
  // allowance on a curtain row is already a per-drape unit cost.
  if (it.drape && p.status !== "allowance") {
    if (!(p.areaRate && p.areaRate > 0)) return { cost: 0, price: 0, status: "needs-part" };
    const cost = drapeUnitCost(it.drape, p.areaRate);
    return { cost, price: sellFromCost(cost, margin), status: p.status, ref: p.ref, refDesc: p.desc };
  }
  return { cost: p.unitCost, price: p.unitSell, status: p.status, ref: p.ref, refDesc: p.desc };
}

/** Price every item of every system at one tier. Every system comes back tierFixed (no global tier multiplier). */
export function applyEquipment(
  systems: SystemBlock[],
  tierKey: TierKey,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {}
): SystemBlock[] {
  const prices = table.byTier[tierKey] || {};
  return systems.map((sys) => {
    let rev = 0;
    let cost = 0;
    const items = sys.items.map((it) => {
      const r = priceItem(it, overrides[it.key] ?? prices[it.key], table.margin);
      rev += it.qty * r.price;
      cost += it.qty * r.cost;
      const next: BomItem = { ...it, cost: r.cost, price: r.price, status: r.status };
      if (r.ref) {
        next.ref = r.ref;
        next.refDesc = r.refDesc;
      } else {
        delete next.ref;
        delete next.refDesc;
      }
      return next;
    });
    return { ...sys, items, rev, cost, tierFixed: true };
  });
}

/** The BOM's base rows for a tier: line-set scaling → map pricing (no qty overrides). */
export function tierSystemsBase(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {}
): SystemBlock[] {
  return applyEquipment(scaleSets(C.systems, C, tierKey, tierDefs), tierKey, table, overrides);
}

/** The full per-tier pipeline: line-set scaling → map pricing → the tier's qty overrides. */
export function tierSystems(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  table: EquipmentPriceTable,
  overrides: Record<string, UnitPrice> = {}
): SystemBlock[] {
  return applyOverrides(tierSystemsBase(C, s, tierKey, tierDefs, table, overrides), s, tierKey);
}
```

- [ ] **Step 4: Make `compute()` quantities-only and remove the dollars**

In `src/app/(app)/design/quick/engine.ts`:

(a) Delete line 13 (`import { curtainCost, SEED_FABRIC_RATES, makingRateFor } from "@/lib/design/curtain-pricing";`). Keep `drapeRule` and the venue-dims import.

(b) Replace the header doc comment (lines 1–10) with:

```ts
/**
 * Quick Design estimating engine — port of the logic class embedded in
 * app/Quick Design.dc.html (the budgetary auto-estimate path). Venue presets,
 * dimension schemas, sizing equations and roll-up formulas are carried over;
 * the prototype's DOLLARS are not (#GEM, D-GEM-4): compute() emits item keys +
 * quantities only, and src/lib/design/equipment-pricing.ts prices them from
 * the catalog-backed Equipment map. This module holds no cost data, so the
 * Grid's client components can import its presets and sizing safely.
 *
 * Pure data + math — no React, no I/O.
 */
```

(c) Replace `BomItem` with:

```ts
/** A drape's finished geometry (goods.ts drapeRule) — per panel width, panels on the line. */
export type DrapeGeom = { w: number; h: number; fullness: number; qty: number };

export type BomItem = {
  /** Equipment map row key, `system:itemKey` (#GEM, equipment-vocab.ts). */
  key: string;
  /** The equation's own item name (= the row label). */
  desc: string;
  qty: number;
  unit: string;
  /** Unit cost / unit sell — 0 until equipment-pricing.ts prices the item. */
  cost: number;
  price: number;
  /** Set by the Equipment map pricing step (#GEM): how this line priced. */
  status?: "part" | "assembly" | "allowance" | "needs-part";
  /** What priced it: SKU, fixture id or row key — and its description. */
  ref?: string;
  refDesc?: string;
  /** Curtain drapes only: the geometry the per-drape cost is computed from. */
  drape?: DrapeGeom;
};
```

(d) Locate each of these by name; the line numbers are from the base file, and Tasks 1 and 4 shifted them. Delete `TIER_SKUS` with its doc comment (base lines 298–328), `curtainMakeCost` with its doc comment (lines 456–473), `export type FabricOption …` (line 98), `fabricRate` (lines 738–741), `applyFabrics` with its doc comment (lines 743–780), `applySkus` with its doc comment (lines 782–814), `tierSystems` (lines 834–843) and `tierSystemsBase` (lines 876–885). Keep `CURTAIN_KEY_TO_TYPE`, `tierTotals`, `scaleSets`, `applyOverrides`, `TIERS` and everything below the riser section.

(e) Replace the whole `compute()` function, from its doc comment `/** Pure function of the designer state …` through its closing `}`, with:

```ts
/**
 * Pure function of the designer state — the refined BOM equations (#GEM:
 * QUANTITIES ONLY). Every item carries its Equipment map key (equipment-
 * vocab.ts) and no dollars; equipment-pricing.ts prices them. Sizing math is
 * unchanged, except the scenery track, which now emits FEET (count × pipe
 * length) so a per-foot catalog track can price it (D-GEM-1).
 */
export function compute(s: AState): ComputeResult {
  const C = clamp;
  const lineSets = C(Math.round(s.depth * 1.5), 12, 72);
  // Electrics are spaced by stage depth (~one per 12 ft), clamped 2–5.
  const electrics = s.sys.lighting ? C(Math.round(s.depth / 12), 2, 5) : 0;
  const drapeArea = Math.round(s.width * s.grid);
  let dimmerRacks = 0; // derived after the fixtures BOM is built
  const arrayBoxes = C(Math.round(s.width / 3), 6, 24);
  const subs = C(Math.round(s.width / 12), 2, 8);
  const projectors = C(Math.round(s.width / 24), 1, 4);

  // ---- Refined BOM equations (feet; floor blocks) ----
  const fl = Math.floor;
  const W = s.width;
  const D = s.depth;
  const G = s.grid;
  const size = s.size || "medium";
  const pick = <T,>(sm: T, md: T, lg: T): T => (size === "small" ? sm : size === "large" ? lg : md);
  const dBlk = fl(D / 10); // 10-ft depth blocks

  /**
   * Pipe (batten) length per line set, ft. Jeff, punch #50: "It is Pro Width,
   * plus 2ft on each side, so 4ft total." The rule lives in battenLenFt()
   * (venue-dims.ts) so the lineset builder and this BOM cannot disagree.
   * Gated on the venue kind ON PURPOSE: `s.width` is the proscenium opening
   * only for kind "proscenium"; the other kinds keep `sets * W`.
   */
  const pipeLenFt = venueOf(s).kind === "proscenium" ? battenLenFt(W) : W;

  type Eq = { key: string; desc: string; unit: string; qty: number; drape?: DrapeGeom };
  const eq = (key: string, desc: string, unit: string, qty: number): Eq => ({ key, desc, unit, qty });

  // Rigging — single type
  const rigType = s.rigType || "counterweight";
  let rigItems: Eq[];
  if (rigType === "motorized") {
    const m = pick({ el: 2, lo: 2, hi: 2, vs: 0 }, { el: 3, lo: 3, hi: 3, vs: 1 }, { el: 4, lo: 4, hi: 2, vs: 2 });
    rigItems = [
      eq("rigging:electricHoist", "Electric hoist", "ea", m.el * Math.max(2, fl(D / 30))),
      eq("rigging:lowCapHoist", "Low-capacity hoist", "ea", m.lo * dBlk),
      eq("rigging:highCapHoist", "High-capacity hoist", "ea", m.hi * dBlk),
    ];
    if (m.vs) rigItems.push(eq("rigging:varSpeedHoist", "Variable-speed hoist", "ea", m.vs * dBlk));
  } else if (rigType === "deadhung") {
    const sets = pick(5, 6, 7) * dBlk;
    const points = sets * fl(W / 10);
    rigItems = [
      eq("rigging:riggingPoint", "Rigging point", "ea", points),
      eq("rigging:pipe", "Pipe", "ft", sets * pipeLenFt),
      eq("rigging:aircraftCable", "Aircraft cable", "ft", points * G),
      eq("rigging:chainWrap", "Chain wrap, 3 ft", "ea", points),
      eq("rigging:terminationKit", "Termination kit", "ea", points * 2),
    ];
  } else {
    // Counterweight — driven by the number of line sets.
    const sets = pick(5, 6, 7) * dBlk;
    const loftPerSet = Math.max(1, fl(W / 10)); // 1 loftblock per 10 ft of pro width, per set
    const loft = sets * loftPerSet;
    rigItems = [
      eq("rigging:headblock", "Headblock", "ea", sets),
      eq("rigging:footblock", "Footblock", "ea", sets),
      eq("rigging:arbor", "Arbor", "ea", sets),
      eq("rigging:tbarTrack", "T-bar track", "ea", sets),
      eq("rigging:lockRail", "Lock rail", "ea", sets),
      eq("rigging:handline", "Handline", "ft", sets * 2 * G),
      eq("rigging:pipe", "Pipe", "ft", sets * pipeLenFt),
      eq("rigging:loftblock", "Loftblock", "ea", loft),
      eq("rigging:aircraftCable", "Aircraft cable", "ft", loft * (2 * G + W)),
      eq("rigging:terminationKit", "Termination kit", "ea", loft * 2),
      eq("rigging:chainWrap", "Chain wrap, 3 ft", "ea", loft),
    ];
  }

  // Curtains — the four fabric drapes carry the goods.ts drape geometry
  // (finished width/height, fullness, panels) so equipment-pricing.ts costs
  // each one from the mapped fabric's area rate + making; qty per depth block.
  const drape = s.drape || {};
  const curtainItems: Eq[] = [];
  // `proscenium` gates the wing addition inside venueDimsFromEstimator (#66).
  const gdims = venueDimsFromEstimator({ ...s, proscenium: venueOf(s).kind === "proscenium" });
  const addDrape = (on: boolean | undefined, key: string, desc: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const type = CURTAIN_KEY_TO_TYPE[fabricKey];
    const rule = type ? drapeRule(type, gdims, "better") : null; // geometry is tier-independent
    if (!rule) return;
    curtainItems.push({ key, desc, unit: "ea", qty: count, drape: { w: rule.w, h: rule.h, fullness: rule.fullness, qty: rule.qty } });
  };
  addDrape(drape.draw, "curtains:draw", "Draw", dBlk * 1, "draw");
  addDrape(drape.legs, "curtains:legs", "Leg", dBlk * 2, "legs");
  addDrape(drape.border, "curtains:border", "Border", dBlk * 1, "border");
  addDrape(drape.fullstage, "curtains:fullstage", "Full stage", dBlk * 1, "fullstage");
  // Track hardware, not soft goods. Jeff 2026-07-27: it follows the pipe rule
  // (PRO width + 4 ft in a proscenium house, room width elsewhere). One run per
  // depth block, measured in FEET so a per-foot catalog track prices it.
  if (drape.scenerytrack && dBlk > 0) curtainItems.push(eq("curtains:scenerytrack", "Scenery track", "ft", dBlk * pipeLenFt));

  // Fixtures — multi. E = unified electric count; wUnit ≈ 1 per 8 ft of width.
  const fx = s.fixtures || {};
  const E = Math.max(1, electrics);
  const wUnit = Math.max(1, Math.round(W / 8));
  const lightItems: Eq[] = [];
  const addFix = (key: string, on: boolean | undefined, desc: string, qty: number) => {
    if (on && qty > 0) lightItems.push(eq(`lighting:${key}`, desc, "ea", qty));
  };
  addFix("par", fx.par, "Par", Math.round(E * wUnit * pick(0.7, 1, 1.2)));
  addFix("front", fx.front, "Front", Math.round(wUnit * pick(2, 2.5, 3)));
  addFix("cyc", fx.cyc, "Cyc", Math.round(wUnit * pick(1, 1.25, 1.5)));
  addFix("side", fx.side, "Side light", Math.round(E * wUnit * pick(0, 0.5, 0.75)));
  const automatedQty = Math.round(E * wUnit * pick(0, 0.5, 0.9));
  addFix("automated", fx.automated, "Automated", automatedQty);
  // dimmer racks derive from the real conventional-fixture total (movers are non-dim, DMX)
  const convFixTotal = lightItems.reduce((a, it) => a + it.qty, 0) - (fx.automated ? automatedQty : 0);
  dimmerRacks = s.sys.lighting ? Math.max(1, Math.ceil(convFixTotal / 48)) : 0;

  // Controls — multi (Console / Architectural / Data groups)
  const ctrl = s.ctrl || {};
  const ctrlItems: Eq[] = [];
  if (ctrl.console) {
    ctrlItems.push(eq("controls:console", "Console", "ea", 1));
    ctrlItems.push(eq("controls:consoleTouch", "Console touch screen", "ea", pick(1, 2, 2)));
    if (size === "large") ctrlItems.push(eq("controls:batteryBackup", "Battery backup", "ea", 1));
  }
  if (ctrl.architectural) {
    ctrlItems.push(eq("controls:processor", "Processor", "ea", 1));
    ctrlItems.push(eq("controls:button", "Button", "ea", pick(fl(W / 20), fl(W / 10), fl(W / 5))));
    if (size === "large") ctrlItems.push(eq("controls:archTouch", "Architectural touch screen", "ea", 1));
  }
  if (ctrl.data) {
    ctrlItems.push(eq("controls:inputStation", "Input station", "ea", pick(1, 2, 4)));
    ctrlItems.push(eq("controls:outputStation", "Output station", "ea", pick(2 * fl(D / 7), 2 * fl(D / 4), 2 * fl(D / 3))));
    ctrlItems.push(eq("controls:distro", "Distro system", "ea", 1));
  }

  // Acoustical shell — multi (size-independent)
  const shell = s.shell || {};
  const shellItems: Eq[] = [];
  if (shell.towers) shellItems.push(eq("acoustical:tower", "Tower", "ea", fl(W / 10) + 2 * fl(D / 10)));
  if (shell.ceiling) shellItems.push(eq("acoustical:ceiling", "Ceiling", "ea", fl(D / 10)));
  if (shell.transport) shellItems.push(eq("acoustical:transport", "Transport", "ea", fl(D / 10)));

  // Pit filler — single. Per-sqft over Pro Width × 10 ft.
  const pitType = s.pitType || "legged";
  const pitArea = W * 10;
  const pitItems: Eq[] =
    pitType === "clearspan"
      ? [eq("pit:clearspan", "Clear-span pit filler deck", "sqft", pitArea)]
      : [eq("pit:legged", "Legged pit filler deck", "sqft", pitArea)];

  const defs: Array<{ key: SysKey; name: string; on: boolean; m: number; dot: string; items: Eq[] }> = [
    { key: "rigging", name: "Rigging", on: s.sys.rigging, m: 0.3, dot: "#7b3f8a", items: rigItems },
    { key: "curtains", name: "Curtains", on: s.sys.curtains, m: 0.3, dot: "#b4543a", items: curtainItems },
    { key: "lighting", name: "Fixtures", on: s.sys.lighting, m: 0.3, dot: "#c98a2b", items: lightItems },
    { key: "controls", name: "Controls", on: s.sys.controls, m: 0.3, dot: "#1f7a52", items: ctrlItems },
    { key: "acoustical", name: "Acoustical Shell", on: s.sys.acoustical, m: 0.3, dot: "#6f6f78", items: shellItems },
    { key: "pit", name: "Pit Filler", on: s.sys.pit, m: 0.3, dot: "#9a4a6a", items: pitItems },
    {
      key: "audio", name: "Audio", on: s.sys.audio, m: 0.3, dot: "#3155a8",
      items: [
        eq("audio:lineArray", "Line-array loudspeaker", "ea", arrayBoxes),
        eq("audio:subwoofer", "Subwoofer", "ea", subs),
        eq("audio:mixerDsp", "Digital mixer, DSP & amplifiers", "lot", 1),
      ],
    },
    {
      key: "video", name: "Video", on: s.sys.video, m: 0.31, dot: "#2a7d8a",
      items: [
        eq("video:projector", "Laser projector, 4K", "ea", projectors),
        eq("video:screen", "Projection screen / LED wall", "lot", 1),
        eq("video:processor", "Video processor & switcher", "lot", 1),
      ],
    },
  ];
  const systems: SystemBlock[] = defs.map((d) => ({
    ...d,
    items: d.items.map((it): BomItem => ({ ...it, cost: 0, price: 0 })),
    rev: 0,
    cost: 0,
  }));
  return { lineSets, electrics, drapeArea, dimmerRacks, rigType, systems, rigSets: rigSetsFor(s) };
}
```

(f) Update `CURTAIN_KEY_TO_TYPE`'s doc comment to: `/** Quick Design's curtain toggle keys (\`drape.draw\` etc.) → the goods.ts drape TYPE whose geometry drapeRule() returns. */`.

- [ ] **Step 5: Quick Design prices through the map**

In `src/app/(app)/design/quick/page.tsx`:
- remove `byCategory` from the catalog import (`import { list as catalogList } from "@/lib/stores/catalog";`) and remove `fabricParts` / `byCategory("Fabric")` from the `Promise.all`;
- add `import { loadEquipmentPriceTable } from "@/lib/stores/equipment-map";`;
- after the `Promise.all`, add `const prices = await loadEquipmentPriceTable({ catalog: catalogRows });`, which reuses the catalog the page already loaded (no second load);
- replace the `fixtureAssemblies` mapping with:

```ts
  const fixtureAssemblies = fixtureAssembliesFrom(fixtureRecords, catalogRows).map((assembly) => {
    const totals = assemblyUnitTotals(assembly);
    return { id: assembly.id, name: assembly.name, cost: totals.cost, sell: totals.sell };
  });
```

- in the JSX, replace the `fabrics={fabricParts.map(…)}` prop with `prices={prices}`.

In `src/app/(app)/design/quick/quick-design-client.tsx`:
- from the `"./engine"` import, remove `tierSystems`, `tierSystemsBase` and `type FabricOption`;
- add:

```ts
import { tierSystems, tierSystemsBase } from "@/lib/design/equipment-pricing";
import type { EquipmentPriceTable, UnitPrice } from "@/lib/design/equipment-map";
```

- props: in the destructure replace `fabrics,` with `prices,`. In the type, replace `fabrics: FabricOption[];` with `prices: EquipmentPriceTable;` and change `fixtureAssemblies: Array<{ id: string; name: string; cost: number }>;` to `fixtureAssemblies: Array<{ id: string; name: string; cost: number; sell: number }>;`;
- replace the `assemblyOptions` memo and the `const C = useMemo(() => compute(a, assemblyOptions), …)` line (lines 183–187) with:

```tsx
  /** A per-design fixture pick (Assembly Builder) overrides that fixture row's
   *  Equipment map price (#GEM) — the item keeps the equation's name. */
  const fixtureOverrides = useMemo(() => {
    const out: Record<string, UnitPrice> = {};
    for (const [fixtureKey, id] of Object.entries(a.fixtureAssemblies || {})) {
      const hit = fixtureAssemblies.find((f) => f.id === id);
      if (hit) out[`lighting:${fixtureKey}`] = { status: "assembly", ref: hit.id, desc: hit.name, unit: "ea", unitCost: hit.cost, unitSell: hit.sell };
    }
    return out;
  }, [a.fixtureAssemblies, fixtureAssemblies]);
  const C = useMemo(() => compute(a), [a]);
```

- `selBase`: `useMemo(() => tierSystemsBase(C, a, selKey, tierDefs, prices, fixtureOverrides), [C, a, selKey, tierDefs, prices, fixtureOverrides])`;
- `tierCards`: `tierTotals(tierSystems(C, a, td.key, tierDefs, prices, fixtureOverrides), td, laborPct, freightPct, contPct)` with deps `[C, a, tierDefs, prices, fixtureOverrides, laborPct, freightPct, contPct]`;
- `makeDesign`: `const Cx = compute(s);` and `const sysForTot = tierSystems(Cx, s, td.key, tierDefs, prices, fixtureOverrides);`;
- in `bomGroups`, replace the `upLabel` line and the returned row with:

```tsx
        const upLabel = it.status === "needs-part" ? "Needs a part" : up > 0 && up < 10 ? "$" + up.toFixed(2) : moneyRound(up);
        const label = (it.refDesc ? `${it.desc} — ${it.refDesc}` : it.desc) + (it.status === "allowance" ? " · Allowance" : "");
        return { desc: it.desc, label, unit: it.unit, qty, edited: hasOv, upLabel, ext };
```

- in the BOM table render (line 777), replace `<span style={{ lineHeight: 1.3 }}>{it.desc}</span>` with `<span style={{ lineHeight: 1.3 }}>{it.label}</span>`. The qty inputs keep keying overrides by `it.desc`.

- [ ] **Step 6: The Designs dashboard prices through the map**

In `src/app/(app)/design/designs/page.tsx`:
- remove `import { byCategory } from "@/lib/stores/catalog";` and `byCategory("Fabric")` / `fabricParts` from the `Promise.all`;
- add `import { loadEquipmentPriceTable } from "@/lib/stores/equipment-map";` and `loadEquipmentPriceTable()` as a `Promise.all` entry named `prices`. This is a targeted `getMany`, not the whole catalog;
- add `export const maxDuration = 60;` under `export const dynamic`, because `listFixtures()` can run #210's first-read conversion;
- in the JSX, replace the `fabrics={fabricParts.map(…)}` prop with `prices={prices}`.

In `src/app/(app)/design/designs/design-client.tsx`:
- from the `"../quick/engine"` import, remove `tierSystems` and `type FabricOption`;
- add `import { tierSystems } from "@/lib/design/equipment-pricing";` and `import type { EquipmentPriceTable } from "@/lib/design/equipment-map";`;
- props: in the destructure replace `fabrics,` with `prices,`; in the type replace `fabrics: FabricOption[];` with `prices: EquipmentPriceTable;`;
- in the `detail` memo: `const systems = tierSystems(C, s, tierKey, tierDefs, prices);` with deps `[sel, tierDefs, prices, accentHex]`.

- [ ] **Step 7: Grid targets price through the map**

In `src/app/(app)/design/grid/[id]/page.tsx`:
- remove `import type { FabricOption } from "@/app/(app)/design/quick/engine";`;
- change the engine import to `import { compute, tierDefsDefault } from "@/app/(app)/design/quick/engine";` and add:

```ts
import { tierSystems } from "@/lib/design/equipment-pricing";
import { buildEquipmentPriceTable } from "@/lib/design/equipment-map";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
```

- add `export const maxDuration = 60;` under `export const dynamic`, because `listFixtures()` can run #210's first-read conversion;
- replace the `engineFabrics` + `scopeTargets` block from Task 4 with:

```ts
  // The Equipment map price context (#GEM) — built from the catalog this
  // request already loaded (no second load). Server-only; the editor gets sell
  // numbers only (scope targets now; virtual parts in Task 6).
  const { map: equipMap, ctx: equipCtx } = await loadEquipPriceCtx({ catalog });
  const equipTable = buildEquipmentPriceTable(equipMap, equipCtx);
  const scopeTargets = project.scopeInputs
    ? scopeTargetsByTier(project.scopeInputs, (s, t) => tierSystems(compute(s), s, t, tierDefsDefault(), equipTable))
    : null;
```

Task 6 uses `equipMap` and `equipCtx`, so they must stay named exactly that.

- [ ] **Step 8: Run the specs + types + lint**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `ALL PASSED`, **4023** PASS lines (4011 − 3 + 15); tsc silent; eslint 0 errors, ≤ 110 warnings. Run the Task 1 exhaustiveness block again as part of this; it must still pass with the rewritten `compute()`.

- [ ] **Step 9: Build + smoke**

Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next && npm run test:smoke 2>&1 | tail -5`
Expected: the build succeeds and every smoke route is OK (`/design/quick`, `/design/designs` and a Grid editor route render with an empty map).

- [ ] **Step 10: Commit**

```bash
git add src/lib/design/equipment-pricing.ts "src/app/(app)/design/quick" "src/app/(app)/design/designs" "src/app/(app)/design/grid/[id]/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(design): estimates price only through the Equipment map; engine carries no dollars (#GEM T5)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Placements that Auto can own — lots, the auto tag, virtual parts

**Files:**
- Create: `src/lib/design/grid-auto-model.ts`
- Create: `src/lib/design/grid-virtual-parts.ts`
- Modify: `src/lib/design/grid-scopes.ts` (`GRID_SCOPE_OF_SYS`)
- Modify: `src/lib/design/grid-bom.ts` (`placementQty`, `PartLite.virtual/allowance`, qty-aware `bomLines`/`bomTotals`/`bomBySpace`)
- Modify: `src/lib/design/grid-schedule.ts`, `src/lib/design/grid-riser.ts` (qty-aware counts)
- Modify: `src/lib/stores/grid-projects.ts`: `GridPlacement.qty/auto`, `GridProject.autoEstimate`, `addPlacements` items, `replaceAutoPlacements`, `setAutoEstimate`; move and category edits clear `auto`.
- Modify: `src/lib/stores/grid-catalog.ts` (`ensureGridSymbolsFor`)
- Modify: `src/lib/stores/equipment-map.ts` (`loadVirtualParts`)
- Modify: `src/lib/design/grid-quote.ts` (virtual parts priced; `allowance: true` spec lines)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`, `riser/page.tsx`, `set/page.tsx`, `schedule/page.tsx` (append virtual parts)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (palette skips virtual parts; `×N` lot labels; virtual desc + Allowance tag on BOM lines)
- Test: `scripts/test-review-and-spec.ts` (append at EOF); `scripts/test-review-regressions.ts` (new block before the `#210 final review M5` block)

**Interfaces:**
- Consumes (Tasks 1–5): `EQUIPMENT_ROW_BY_KEY`, `cellFor`, `isTierKey`, `sellFromCost`, `EquipmentMap`, `EquipPriceCtx`, `loadEquipPriceCtx`, `resolveFixture`, `TRACKABLE_SYS_KEYS`, `UNSCOPED`, `GridLayer`, `pruneRisers`, `hasOption`. The page must already hold `equipMap`/`equipCtx` (Task 5).
- Produces (`@/lib/design/grid-auto-model`):
  - `type AutoTag = { scope: SysKey; rowKey: string; tier: TierKey }`
  - `type AutoOverride = { sku?: string; assemblyId?: string; qty?: number }`
  - `type AutoEstimate = { tierByScope: Partial<Record<SysKey, TierKey>>; overrides: Record<string, AutoOverride> }`
  - `sanitizeAutoOverride(raw): AutoOverride | null`
  - `sanitizeAutoEstimate(raw): AutoEstimate`
  - `mergeScopeEstimate(est, scope, tier, overrides): AutoEstimate`
  - `overrideRefs(est): { skus: string[]; assemblyIds: string[] }`
- Produces (`@/lib/design/grid-virtual-parts`):
  - `ASSEMBLY_PART_PREFIX = "asm:"`, `ALLOWANCE_PART_PREFIX = "allow:"`
  - `assemblyPartId(id)`, `allowancePartId(rowKey, tier)`
  - `type VirtualRef`
  - `parseVirtualPartId(partId): VirtualRef | null`
  - `virtualPartsFor(partIds, map, ctx): PartLite[]`
- Produces (`@/lib/design/grid-bom`): `placementQty(pl: { qty?: number | null }): number`; `PartLite.virtual?: true`, `PartLite.allowance?: true`.
- Produces (`@/lib/design/grid-scopes`): `GRID_SCOPE_OF_SYS: Partial<Record<SysKey, GridScope>>`.
- Produces (`@/lib/stores/grid-projects`):
  - `GridPlacement.qty?: number`, `GridPlacement.auto?: AutoTag`, `GridProject.autoEstimate?: AutoEstimate`
  - `type AutoPlacementInput = { x: number; y: number; partId: string; qty?: number; curtain?: GridCurtain; auto: AutoTag }`
  - `replaceAutoPlacements(projectId, { optionId, scopes: SysKey[], sheetId, page, items: AutoPlacementInput[], by }): Promise<{ removed: number; added: number } | null>`
  - `setAutoEstimate(projectId, est | null)`
- Produces:
  - `ensureGridSymbolsFor(parts: CatalogPart[], by): Promise<number>` (`@/lib/stores/grid-catalog`)
  - `loadVirtualParts(partIds, catalog?): Promise<PartLite[]>` (`@/lib/stores/equipment-map`)
  - `GridQuoteSpecLine.allowance?: true`

- [ ] **Step 1: Write the failing pure test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T6: lot quantities, virtual parts (assemblies + allowances), the Auto estimate model --- */
import { bomBySpace as gemBySpace6, bomLines as gemBomLines6, bomTotals as gemBomTotals6, placementQty as gemQty6, type PartLite as GemPartLite6 } from "@/lib/design/grid-bom";
import { allowancePartId as gemAllowId6, assemblyPartId as gemAsmId6, parseVirtualPartId as gemParseV6, virtualPartsFor as gemVirtual6 } from "@/lib/design/grid-virtual-parts";
import { mergeScopeEstimate as gemMergeEst6, overrideRefs as gemRefs6, sanitizeAutoEstimate as gemSanEst6 } from "@/lib/design/grid-auto-model";
import { buildSchedule as gemSchedule6 } from "@/lib/design/grid-schedule";
import { riserGraph as gemRiser6 } from "@/lib/design/grid-riser";
{
  ok(gemQty6({}) === 1 && gemQty6({ qty: 240 }) === 240 && gemQty6({ qty: 0 }) === 1 && gemQty6({ qty: Number.NaN }) === 1, "#GEM T6: a placement counts 1 unless it is a lot");
  const parts: GemPartLite6[] = [
    { id: "PIPE", sku: "PIPE", desc: "Pipe", category: "Rigging", unit: "ft", list: 12, cost: 8 },
    { id: "PAR", sku: "PAR", desc: "Par", category: "Lighting", unit: "ea", list: 900, cost: 600 },
  ];
  const pls = [
    { id: "a", sheetId: "s", page: 1, x: 0.1, y: 0.1, partId: "PIPE", qty: 240 },
    { id: "b", sheetId: "s", page: 1, x: 0.2, y: 0.1, partId: "PAR" },
    { id: "c", sheetId: "s", page: 1, x: 0.3, y: 0.1, partId: "PAR" },
  ];
  const lines = gemBomLines6(pls, parts);
  const pipe = lines.find((l) => l.partId === "PIPE")!;
  ok(pipe.qty === 240 && pipe.ext === 2880 && lines.find((l) => l.partId === "PAR")!.qty === 2, "#GEM T6: a lot marker bills its quantity on the BOM");
  const tot = gemBomTotals6(pls, parts);
  ok(tot.value === 4680 && tot.cost === 3120, "#GEM T6: totals multiply by the lot quantity");
  const roll = gemBySpace6(pls, parts, [])[0];
  ok(roll.count === 3 && roll.value === 4680, "#GEM T6: space rollups value a lot at its quantity (count stays markers)");
  const sched = gemSchedule6({ placements: pls, spaces: [], descOf: (id) => parts.find((p) => p.id === id)?.desc, wires: [] });
  ok(sched.sections[0].rows.find((r) => r.partId === "PIPE")!.qty === 240, "#GEM T6: the schedule counts a lot at its quantity");
  const graph = gemRiser6(pls, [], [], parts, []);
  ok(graph.nodes[0].groups.find((g) => g.partId === "PIPE")!.qty === 240, "#GEM T6: the riser counts a lot at its quantity");
  ok(gemAsmId6("SA-1") === "asm:SA-1" && gemAllowId6("audio:subwoofer", "best") === "allow:audio:subwoofer:best", "#GEM T6: virtual part ids");
  const pv = gemParseV6("allow:audio:subwoofer:best");
  ok(pv?.kind === "allowance" && pv.rowKey === "audio:subwoofer" && pv.tier === "best" && gemParseV6("asm:SA-1")?.kind === "assembly" && gemParseV6("allow:bogus:row:best") === null && gemParseV6("GEM-PAR") === null, "#GEM T6: parse round-trips and rejects unknown rows and plain SKUs");
  const rack = {
    id: "SA-GEM6", kind: "system" as const, label: "GEM6 rack", description: "", scope: "Audio" as const,
    lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] },
    parts: [{ sku: "GEM6-MIX", qty: 1 }], createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const fx = {
    id: "fa-gem6", kind: "fixture" as const, label: "House PAR", description: "",
    lightEngineSku: "GEM6-PAR", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] },
    createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const ctx = {
    parts: new Map([
      ["GEM6-MIX", { sku: "GEM6-MIX", desc: "Mixer", unit: "ea", cost: 5000, list: 7000 }],
      ["GEM6-PAR", { sku: "GEM6-PAR", desc: "Par", unit: "ea", cost: 600, list: 900 }],
    ]),
    fixtures: new Map<string, typeof rack | typeof fx>([[rack.id, rack], [fx.id, fx]]),
    margin: 0.3,
  };
  const map = { "audio:subwoofer": { tiers: { good: { kind: "allowance" as const, amount: 1200, confirmedBy: "Chris", confirmedAt: 5 } }, sameAll: true, updatedBy: "t", updatedAt: 1 } };
  const v = gemVirtual6(["asm:SA-GEM6", "asm:fa-gem6", "allow:audio:subwoofer:better", "allow:video:screen:good", "PLAIN", "asm:SA-GEM6"], map, ctx);
  ok(v.length === 4 && v.every((p) => p.virtual === true), "#GEM T6: one virtual part per distinct virtual id; plain SKUs are not virtual");
  const vr = v.find((p) => p.id === "asm:SA-GEM6")!;
  ok(vr.list === 7000 && vr.cost === 5000 && vr.gridScope === "Audio" && vr.desc === "GEM6 rack", "#GEM T6: a System assembly resolves live, in its system's scope");
  ok(v.find((p) => p.id === "asm:fa-gem6")!.gridScope === "Lighting", "#GEM T6: a fixture assembly is Lighting");
  const va = v.find((p) => p.id === "allow:audio:subwoofer:better")!;
  ok(va.allowance === true && va.cost === 1200 && va.list === 1714.29 && va.gridScope === "Audio", "#GEM T6: a confirmed allowance prices live, flagged Allowance");
  const dead = v.find((p) => p.id === "allow:video:screen:good")!;
  ok(dead.list === 0 && dead.cost === 0 && /no longer confirmed/.test(dead.desc), "#GEM T6: an allowance that is no longer confirmed prices $0 and says so");
  const est = gemSanEst6({
    tierByScope: { lighting: "best", controls: "good", audio: "nope" },
    overrides: { "lighting:par": { sku: " GEM-PAR ", qty: 12.4 }, "controls:console": { sku: "X" }, "bogus:row": { sku: "Y" }, "audio:subwoofer": { assemblyId: "SA-1", sku: "" }, "video:screen": {} },
  });
  ok(JSON.stringify(est.tierByScope) === '{"lighting":"best"}' && est.overrides["lighting:par"].sku === "GEM-PAR" && est.overrides["lighting:par"].qty === 12 && est.overrides["audio:subwoofer"].assemblyId === "SA-1" && !("controls:console" in est.overrides) && !("bogus:row" in est.overrides) && !("video:screen" in est.overrides), "#GEM T6: sanitizeAutoEstimate keeps Grid scopes, known rows and real overrides only");
  const merged = gemMergeEst6(est, "lighting", "good", { "lighting:front": { qty: 3 }, "audio:lineArray": { qty: 9 } });
  ok(merged.tierByScope.lighting === "good" && !("lighting:par" in merged.overrides) && merged.overrides["lighting:front"].qty === 3 && !("audio:lineArray" in merged.overrides) && merged.overrides["audio:subwoofer"].assemblyId === "SA-1", "#GEM T6: re-choosing one scope replaces only that scope's overrides");
  const refs = gemRefs6(est);
  ok(refs.skus.join(",") === "GEM-PAR" && refs.assemblyIds.join(",") === "SA-1", "#GEM T6: overrideRefs names the SKUs and assemblies to load");
  const ed6 = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/editor.tsx"), "utf8");
  const quote6 = readFileSync(join(process.cwd(), "src/lib/design/grid-quote.ts"), "utf8");
  const pages6 = ["riser", "set", "schedule"].map((d) => readFileSync(join(process.cwd(), `src/app/(app)/design/grid/[id]/${d}/page.tsx`), "utf8"));
  ok(ed6.includes("!p.virtual") && quote6.includes("loadVirtualParts(") && pages6.every((s) => s.includes("loadVirtualParts(")), "#GEM T6: the palette hides virtual parts; the quote, riser, set and schedule resolve them");
}
```

This block has **17** `ok(` calls.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: `placementQty` is not exported, and `@/lib/design/grid-virtual-parts` cannot be resolved.

- [ ] **Step 3: The Auto estimate model**

Create `src/lib/design/grid-auto-model.ts`:

```ts
/**
 * The Grid Auto intake's persisted choices (#GEM, spec §5) — pure.
 * `tierByScope` = the Good/Better/Best pick per Grid scope; `overrides` = per
 * equation row (`system:itemKey`) swaps (a catalog SKU or an assembly id) and
 * qty edits. Stored on the project as `autoEstimate` so "Change equipment…"
 * re-opens with the last choices. Only the five Grid scopes are Auto scopes.
 */
import type { SysKey, TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { TRACKABLE_SYS_KEYS } from "./grid-scopes";

export type AutoTag = { scope: SysKey; rowKey: string; tier: TierKey };
export type AutoOverride = { sku?: string; assemblyId?: string; qty?: number };
export type AutoEstimate = { tierByScope: Partial<Record<SysKey, TierKey>>; overrides: Record<string, AutoOverride> };

export const AUTO_QTY_MAX = 100_000;

const isTier = (v: unknown): v is TierKey => v === "good" || v === "better" || v === "best";

/** One row's override — a SKU wins over an assembly id; qty is a whole number ≥ 0. Empty → null. */
export function sanitizeAutoOverride(raw: unknown): AutoOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sku = typeof r.sku === "string" ? r.sku.trim().slice(0, 120) : "";
  const assemblyId = typeof r.assemblyId === "string" ? r.assemblyId.trim().slice(0, 120) : "";
  const q = Number(r.qty);
  const out: AutoOverride = {};
  if (sku) out.sku = sku;
  else if (assemblyId) out.assemblyId = assemblyId;
  if (r.qty !== undefined && r.qty !== null && Number.isFinite(q) && q >= 0) out.qty = Math.min(AUTO_QTY_MAX, Math.round(q));
  return Object.keys(out).length ? out : null;
}

export function sanitizeAutoEstimate(raw: unknown): AutoEstimate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tb = (r.tierByScope && typeof r.tierByScope === "object" ? r.tierByScope : {}) as Record<string, unknown>;
  const tierByScope: Partial<Record<SysKey, TierKey>> = {};
  for (const k of TRACKABLE_SYS_KEYS) {
    const t = tb[k];
    if (isTier(t)) tierByScope[k] = t;
  }
  const ov = (r.overrides && typeof r.overrides === "object" ? r.overrides : {}) as Record<string, unknown>;
  const overrides: Record<string, AutoOverride> = {};
  for (const [key, value] of Object.entries(ov)) {
    const def = EQUIPMENT_ROW_BY_KEY.get(key);
    if (!def || !TRACKABLE_SYS_KEYS.includes(def.system)) continue;
    const o = sanitizeAutoOverride(value);
    if (o) overrides[key] = o;
  }
  return { tierByScope, overrides };
}

/** "Change equipment…" for ONE scope: its tier and its rows' overrides are replaced; every other scope is kept. */
export function mergeScopeEstimate(
  est: AutoEstimate,
  scope: SysKey,
  tier: TierKey,
  overrides: Record<string, AutoOverride>
): AutoEstimate {
  const mine = sanitizeAutoEstimate({ tierByScope: {}, overrides }).overrides;
  const next: Record<string, AutoOverride> = {};
  for (const [k, v] of Object.entries(est.overrides)) if (!k.startsWith(`${scope}:`)) next[k] = v;
  for (const [k, v] of Object.entries(mine)) if (k.startsWith(`${scope}:`)) next[k] = v;
  return { tierByScope: { ...est.tierByScope, [scope]: tier }, overrides: next };
}

/** The SKUs and assembly ids the overrides reference — what the resolver must load. */
export function overrideRefs(est: AutoEstimate): { skus: string[]; assemblyIds: string[] } {
  const skus = new Set<string>();
  const assemblyIds = new Set<string>();
  for (const o of Object.values(est.overrides)) {
    if (o.sku) skus.add(o.sku);
    if (o.assemblyId) assemblyIds.add(o.assemblyId);
  }
  return { skus: [...skus], assemblyIds: [...assemblyIds] };
}
```

- [ ] **Step 4: `GRID_SCOPE_OF_SYS`**

In `src/lib/design/grid-scopes.ts`, directly after `export const GRID_LAYERS …` (line 49), add:

```ts
/** The five trackable systems → their Grid scope (#GEM; the Scope panel's SYS_TO_GRID_SCOPE). */
export const GRID_SCOPE_OF_SYS: Partial<Record<SysKey, GridScope>> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  audio: "Audio",
  video: "Video",
};
```

- [ ] **Step 5: Virtual parts**

Create `src/lib/design/grid-virtual-parts.ts`:

```ts
/**
 * Virtual parts (#GEM, D-GEM-6) — pure. Auto places assemblies and confirmed
 * allowances as ORDINARY placements whose partId is a virtual id:
 *   asm:<fixtureId>          a fixture or System assembly (#210)
 *   allow:<rowKey>:<tier>    a confirmed Equipment map allowance
 * The server resolves each id LIVE into a PartLite (desc, unit, list = sell,
 * cost, scope) appended to the page's parts, so the BOM, space rollups, riser,
 * schedule, drawing set and quote price and label them with no second code
 * path. `virtual` keeps them out of the device palette; `allowance` flags the
 * line internally. An allowance whose map cell is no longer a confirmed
 * allowance prices $0 and says so — never a stale dollar.
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { PartLite } from "./grid-bom";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { cellFor, isTierKey, sellFromCost, type EquipmentMap, type EquipPriceCtx } from "./equipment-map";
import { GRID_SCOPE_OF_SYS, UNSCOPED, type GridLayer } from "./grid-scopes";
import { resolveFixture } from "@/lib/fixture-assemblies";

export const ASSEMBLY_PART_PREFIX = "asm:";
export const ALLOWANCE_PART_PREFIX = "allow:";

export function assemblyPartId(fixtureId: string): string {
  return `${ASSEMBLY_PART_PREFIX}${fixtureId}`;
}

export function allowancePartId(rowKey: string, tier: TierKey): string {
  return `${ALLOWANCE_PART_PREFIX}${rowKey}:${tier}`;
}

export type VirtualRef = { kind: "assembly"; id: string } | { kind: "allowance"; rowKey: string; tier: TierKey };

export function parseVirtualPartId(partId: string): VirtualRef | null {
  if (partId.startsWith(ASSEMBLY_PART_PREFIX)) {
    const id = partId.slice(ASSEMBLY_PART_PREFIX.length);
    return id ? { kind: "assembly", id } : null;
  }
  if (partId.startsWith(ALLOWANCE_PART_PREFIX)) {
    const rest = partId.slice(ALLOWANCE_PART_PREFIX.length);
    const i = rest.lastIndexOf(":");
    if (i <= 0) return null;
    const rowKey = rest.slice(0, i);
    const tier = rest.slice(i + 1);
    return EQUIPMENT_ROW_BY_KEY.has(rowKey) && isTierKey(tier) ? { kind: "allowance", rowKey, tier } : null;
  }
  return null;
}

/** A System assembly's scope → the Grid layer it draws on (Controls / Acoustical / Pit / Other → Unscoped). */
const SYSTEM_SCOPE_LAYER: Record<string, GridLayer> = {
  Lighting: "Lighting",
  Rigging: "Rigging",
  Curtains: "Curtains",
  Audio: "Audio",
  Video: "Video",
};

export function virtualPartsFor(partIds: Iterable<string>, map: EquipmentMap, ctx: EquipPriceCtx): PartLite[] {
  const out: PartLite[] = [];
  const seen = new Set<string>();
  for (const id of partIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ref = parseVirtualPartId(id);
    if (!ref) continue;
    if (ref.kind === "assembly") {
      const f = ctx.fixtures.get(ref.id);
      const r = f ? resolveFixture(f, ctx.parts) : null;
      const cost = r?.cost ?? 0;
      out.push({
        id,
        sku: ref.id,
        desc: f ? f.label : `${ref.id} (assembly deleted — replace this device)`,
        category: "Assembly",
        unit: "ea",
        list: r ? (r.sell > 0 ? r.sell : cost > 0 ? sellFromCost(cost, ctx.margin) : 0) : 0,
        cost,
        gridScope: f?.kind === "system" ? SYSTEM_SCOPE_LAYER[f.scope || ""] ?? UNSCOPED : "Lighting",
        kind: "device",
        virtual: true,
      });
      continue;
    }
    const def = EQUIPMENT_ROW_BY_KEY.get(ref.rowKey)!;
    const cell = cellFor(map[ref.rowKey], ref.tier);
    const amount = cell?.kind === "allowance" && cell.amount > 0 ? cell.amount : 0;
    out.push({
      id,
      sku: "ALLOWANCE",
      desc: amount > 0 ? `${def.label} (allowance)` : `${def.label} (allowance no longer confirmed — re-fill or replace)`,
      category: "Allowance",
      unit: def.unit,
      list: amount > 0 ? sellFromCost(amount, ctx.margin) : 0,
      cost: amount,
      gridScope: GRID_SCOPE_OF_SYS[def.system] ?? UNSCOPED,
      kind: "device",
      virtual: true,
      allowance: true,
    });
  }
  return out;
}
```

- [ ] **Step 6: Qty-aware BOM, schedule and riser**

In `src/lib/design/grid-bom.ts`:

(a) Add to `PartLite`, after `pricingPartId?: string | null;`:

```ts
  /** #GEM virtual part (asm:/allow: ids, grid-virtual-parts.ts) — resolved
   *  server-side from an assembly or an Equipment map allowance; never offered
   *  in the device palette. */
  virtual?: true;
  /** #GEM: an Equipment map allowance line — flagged internally ("Allowance"). */
  allowance?: true;
```

(b) Add after the `isCurtainPlacement` function:

```ts
/** A placement's unit count (#GEM): an Auto "lot" marker carries `qty` (count
 *  or length hardware); every other placement is one unit. */
export function placementQty(pl: { qty?: number | null }): number {
  const n = Math.round(Number(pl.qty));
  return Number.isFinite(n) && n > 1 ? n : 1;
}
```

(c) `bomLines`: change the placements parameter type to `Array<{ partId: string; curtain?: GridCurtain | null; qty?: number }>`, and the count line to `qty.set(pl.partId, (qty.get(pl.partId) || 0) + placementQty(pl));`.

(d) `bomTotals`: same parameter type change, and inside the loop replace `value += part.list; cost += part.cost;` with:

```ts
    const q = placementQty(pl);
    value += part.list * q;
    cost += part.cost * q;
```

(e) `RollupPlacementLite`: add `qty?: number;`. In `bomBySpace`, replace the `const value = …` expression with:

```ts
    const value = pl.curtain
      ? (pl.id ? curtainPrices?.get(pl.id) : 0) || 0
      : (byId.get(pl.partId)?.list || 0) * placementQty(pl);
```

In `src/lib/design/grid-schedule.ts`: change the import to `import { curtainDesc, placementQty, type GridCurtain } from "./grid-bom";`, add `qty?: number` to `buildSchedule`'s placement element type, and replace the device branch with:

```ts
      const row = rows.find((r) => r.partId === pl.partId && !r.code);
      if (row) row.qty += placementQty(pl);
      else rows.push({ partId: pl.partId, desc: input.descOf(pl.partId) || "(no longer in the catalog)", qty: placementQty(pl) });
```

In `src/lib/design/grid-riser.ts`: change the import to `import { placementQty, routeLengthFt, type PartLite, type RouteLite } from "./grid-bom";`, add `qty?: number;` to `riserGraph`'s placement element type, and in the device loop replace `if (g) g.qty += 1;` with `if (g) g.qty += placementQty(pl);` and `qty: 1,` with `qty: placementQty(pl),`.

- [ ] **Step 7: The project store**

In `src/lib/stores/grid-projects.ts`:

(a) Imports: change the engine import to include `type SysKey`, and add:

```ts
import type { AutoEstimate, AutoTag } from "@/lib/design/grid-auto-model";
export type { AutoEstimate, AutoTag } from "@/lib/design/grid-auto-model";
```

(b) In `GridPlacement`, after `seededFrom?: string;`, add:

```ts
  /**
   * Lot quantity (#GEM, D-GEM-6): one marker standing for `qty` units of its
   * part — Auto lands count/length hardware (pipe, cable, arbors …) this way.
   * Absent = 1. The BOM, schedule, riser and space rollups multiply by
   * placementQty(); labor suggestions count the marker once.
   */
  qty?: number;
  /**
   * Auto-fill tag (#GEM, spec §5): set on a placement the Auto intake or a
   * per-scope "Change equipment…" re-fill painted. Any move or category edit
   * deletes it, so a hand-touched device is kept by every later re-fill.
   */
  auto?: AutoTag;
```

(c) In `GridProject`, after `scopeInputs?: QuickScopeInputs | null;`, add:

```ts
  /** Auto intake choices (#GEM): tier per scope + per-row swaps/qty. Absent on Blank designs. */
  autoEstimate?: AutoEstimate;
```

(d) In `addPlacements`, widen the item type to `Array<{ x: number; y: number; partId: string; category?: string; seededFrom?: string; qty?: number; auto?: AutoTag; curtain?: GridCurtain }>` and add to the built placement, after the `seededFrom` spread:

```ts
      ...(item.qty && item.qty > 1 ? { qty: Math.round(item.qty) } : {}),
      ...(item.curtain ? { curtain: item.curtain } : {}),
      ...(item.auto ? { auto: item.auto } : {}),
```

(e) Add after `addPlacements`:

```ts
export type AutoPlacementInput = { x: number; y: number; partId: string; qty?: number; curtain?: GridCurtain; auto: AutoTag };

/**
 * Auto fill / per-scope re-fill (#GEM, spec §5), atomically in ONE patch:
 * every placement of `optionId` still carrying an `auto` tag in one of
 * `scopes` is removed (its riser links go with it, as removePlacement does),
 * then `items` (only those whose auto.scope is in `scopes`) are added.
 * Hand-touched devices (auto cleared) and other options are never touched.
 * null = the project or the option is gone.
 */
export async function replaceAutoPlacements(
  projectId: string,
  input: { optionId: string; scopes: SysKey[]; sheetId: string; page: number; items: AutoPlacementInput[]; by: string }
): Promise<{ removed: number; added: number } | null> {
  const at = Date.now();
  const scopes = new Set(input.scopes);
  let refused = false;
  let removed = 0;
  let added = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, input.optionId)) {
      refused = true;
      return;
    }
    const gone = new Set<string>();
    const kept = (p.placements || []).filter((pl) => {
      const drop = pl.optionId === input.optionId && !!pl.auto && scopes.has(pl.auto.scope);
      if (drop) gone.add(pl.id);
      return !drop;
    });
    const fresh: GridPlacement[] = input.items
      .filter((it) => scopes.has(it.auto.scope))
      .map((it) => ({
        id: rid("gp-"),
        sheetId: input.sheetId,
        page: input.page,
        x: clamp01(it.x),
        y: clamp01(it.y),
        partId: it.partId,
        optionId: input.optionId,
        ...(it.qty && it.qty > 1 ? { qty: Math.round(it.qty) } : {}),
        ...(it.curtain ? { curtain: it.curtain } : {}),
        auto: it.auto,
        by: input.by,
        at,
      }));
    p.placements = [...kept, ...fresh];
    if (gone.size && p.riser) p.riser = pruneRisers(p.riser, { placementIds: gone });
    removed = gone.size;
    added = fresh.length;
    p.updatedAt = at;
  });
  return refused || !updated ? null : { removed, added };
}

/** Persist (or clear, with null) the Auto intake's choices (#GEM). */
export async function setAutoEstimate(projectId: string, est: AutoEstimate | null): Promise<GridProject | null> {
  return patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (est) p.autoEstimate = est;
    else delete p.autoEstimate;
    p.updatedAt = Date.now();
  });
}

/** A hand-touched placement stops being "auto" (#GEM): later re-fills keep it. */
function withoutAuto(pl: GridPlacement): GridPlacement {
  if (!pl.auto) return pl;
  const next = { ...pl };
  delete next.auto;
  return next;
}
```

(f) In `setPlacementCategory`, change `const next = { ...pl };` to `const next = withoutAuto({ ...pl });`.

(g) In `movePlacement`, change `pl.id === placementId ? { ...pl, x, y } : pl` to `pl.id === placementId ? withoutAuto({ ...pl, x, y }) : pl`, and add this sentence to its doc comment: "A move clears the #GEM auto tag, so a re-fill keeps the device."

- [ ] **Step 8: Grid library entries for mapped parts, and the virtual-part loader**

In `src/lib/stores/grid-catalog.ts`, add `insertDocIfAbsent` to the doc-store import and append:

```ts
/**
 * Make sure each pricing part has a Grid library entry (#GEM Auto fill) — the
 * same `fromPricing` shape the first-use seed writes, inserted ONLY where
 * missing (insert-if-absent: never overwrites an entry someone restyled).
 * Called from the Auto fill (a user action), never on page load.
 */
export async function ensureGridSymbolsFor(parts: CatalogPart[], by: string): Promise<number> {
  if (!parts.length) return 0;
  const have = new Set((await listGridSymbols(by)).map((s) => s.id));
  let added = 0;
  for (const p of parts) {
    if (have.has(p.id) || p.category === "Fabric" || p.category === "Labor") continue;
    if (await insertDocIfAbsent<GridSymbol>("grid_catalog", fromPricing(p, by))) added += 1;
  }
  return added;
}
```

In `src/lib/stores/equipment-map.ts`, add imports `import { parseVirtualPartId, virtualPartsFor } from "@/lib/design/grid-virtual-parts";` and `import type { PartLite } from "@/lib/design/grid-bom";`, then append:

```ts
/**
 * The virtual parts (asm:/allow:) a set of placements references, resolved
 * live (#GEM). No virtual id → nothing is loaded at all, so a design without
 * Auto devices pays nothing. Pass `catalog` when the request already holds it.
 */
export async function loadVirtualParts(partIds: Iterable<string>, catalog?: ReadonlyArray<CatalogPart>): Promise<PartLite[]> {
  const ids = [...new Set(partIds)].filter((id) => parseVirtualPartId(id) !== null);
  if (!ids.length) return [];
  const assemblyIds = ids.flatMap((id) => {
    const r = parseVirtualPartId(id);
    return r?.kind === "assembly" ? [r.id] : [];
  });
  const { map, ctx } = await loadEquipPriceCtx(catalog ? { catalog } : { extraFixtureIds: assemblyIds });
  return virtualPartsFor(ids, map, ctx);
}
```

- [ ] **Step 9: Resolve virtual parts wherever placements are read**

`src/app/(app)/design/grid/[id]/page.tsx`: move Task 5's `loadEquipPriceCtx` / `equipTable` / `scopeTargets` block up so it sits just before `const { index: docIndex } = await loadPartDocsState(catalog);`. Then add `import { virtualPartsFor } from "@/lib/design/grid-virtual-parts";` and change the `parts` line to:

```ts
  // #GEM: assemblies and allowances placed by Auto resolve live into PartLite rows.
  const parts: PartLite[] = [
    ...gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile }),
    ...virtualPartsFor((project.placements || []).map((pl) => pl.partId), equipMap, equipCtx),
  ];
```

In `riser/page.tsx` (line 59), `set/page.tsx` (line 117) and `schedule/page.tsx` (line 52), add `import { loadVirtualParts } from "@/lib/stores/equipment-map";` and change `const parts = gridPartsFrom(…);` to:

```ts
  const parts = [...gridPartsFrom(/* the existing arguments, unchanged */), ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), catalog))];
```

keeping each file's existing `gridPartsFrom(...)` arguments exactly as they are.

`src/lib/design/grid-quote.ts`:
- add `import { loadVirtualParts } from "@/lib/stores/equipment-map";`;
- add `allowance?: true` to `GridQuoteSpecLine`;
- after `const symbols = await listGridSymbols();` insert:

```ts
  // #GEM: Auto's assemblies and allowances (asm:/allow:) price live, with their real cost.
  const virtual = await loadVirtualParts(placements.map((p) => p.partId), catalog);
  const allowanceIds = new Set(virtual.filter((v) => v.allowance).map((v) => v.id));
  const virtualRows = virtual.map((v) => ({
    id: v.id, sku: v.sku, desc: v.desc, category: v.category, unit: v.unit, list: v.list, cost: v.cost, role: undefined as string | undefined,
  }));
```

- rename the existing `const gridCatalog = symbols.map(…)` to `const symbolRows = symbols.map(…)` (body unchanged) and add `const gridCatalog = [...symbolRows, ...virtualRows];` right after it;
- in `spec.lines`' map, add `...(allowanceIds.has(l.partId) ? { allowance: true as const } : {}),` after the `tierFallback` spread.

`src/app/(app)/design/grid/[id]/editor.tsx`:
- add `placementQty` to the `@/lib/design/grid-bom` import list;
- in `filteredParts`, insert `.filter((p) => !p.virtual)` as the first filter after `return parts`;
- in the plan marker map (around line 2204), replace the `const label = …` statement with:

```tsx
                  const q = placementQty(pl);
                  const label =
                    (pl.curtain
                      ? pl.curtain.name
                      : part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category : undefined) || pl.partId) +
                    (q > 1 ? ` ×${q}` : "");
```

- in the BOM `lines.map` row (line 1776), replace `{l.partId}` inside the ellipsis `<span>` with `{partById.get(l.partId)?.virtual ? l.desc : l.partId}`, and add right after that `</span>`:

```tsx
                    {partById.get(l.partId)?.allowance && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>
                        Allowance
                      </span>
                    )}
```

- in the "Selected device" title (around line 1630), replace the final `: selectedPlacement.partId}` with `: partById.get(selectedPlacement.partId)?.virtual ? partById.get(selectedPlacement.partId)!.desc : selectedPlacement.partId}`.

- [ ] **Step 10: Run the pure specs**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'`
Expected: `ALL PASSED`, **4040** PASS lines (4023 + 17).

- [ ] **Step 11: Write the DB regression block**

In `scripts/test-review-regressions.ts`, insert before the `/* --- #210 final review M5` block:

```ts
  /* --- #GEM T6: auto placements — per-scope replace, hand-touched kept, lots + virtual parts on the quote --- */
  {
    const GP = await import("@/lib/stores/grid-projects");
    const EM = await import("@/lib/stores/equipment-map");
    const Cat = await import("@/lib/stores/catalog");
    const { resolveOptionId } = await import("@/lib/design/grid-options");
    const { buildGridQuote } = await import("@/lib/design/grid-quote");
    const by = "tester";
    const p0 = await GP.createProject({ name: "GEM T6", customer: "", customerId: null, by });
    await GP.addSheet(p0.id, { name: "Generated base plan", mime: "image/svg+xml", dataUrl: "data:image/svg+xml,%3Csvg%2F%3E", by });
    let p = (await GP.getProject(p0.id))!;
    const opt = resolveOptionId(p, null);
    const sheetId = p.sheetIds[0];
    const tag = (rowKey: string) => ({ scope: "lighting" as const, rowKey, tier: "better" as const });
    const pipeTag = { scope: "rigging" as const, rowKey: "rigging:pipe", tier: "better" as const };
    const first = await GP.replaceAutoPlacements(p0.id, { optionId: opt, scopes: ["lighting"], sheetId, page: 1, by, items: [
      { x: 0.1, y: 0.1, partId: "GEM6-PAR", auto: tag("lighting:par") },
      { x: 0.2, y: 0.1, partId: "GEM6-PAR", auto: tag("lighting:par") },
      { x: 0.3, y: 0.1, partId: "GEM6-PAR", auto: tag("lighting:par") },
      { x: 0.9, y: 0.9, partId: "GEM6-PIPE", qty: 240, auto: pipeTag },
    ] });
    assert.deepEqual(first, { removed: 0, added: 3 }, "#GEM T6: a fill adds only the items of the scopes it was asked to fill");
    await GP.replaceAutoPlacements(p0.id, { optionId: opt, scopes: ["rigging"], sheetId, page: 1, by, items: [{ x: 0.9, y: 0.9, partId: "GEM6-PIPE", qty: 240, auto: pipeTag }] });
    await GP.addPlacement(p0.id, { sheetId, page: 1, x: 0.5, y: 0.5, partId: "GEM6-PAR", optionId: opt, by });
    p = (await GP.getProject(p0.id))!;
    const autoPars = p.placements.filter((pl) => pl.auto?.scope === "lighting");
    await GP.movePlacement(p0.id, autoPars[0].id, { x: 0.15, y: 0.2 });
    await GP.setPlacementCategory(p0.id, autoPars[1].id, "FOH");
    p = (await GP.getProject(p0.id))!;
    assert.ok(!p.placements.find((pl) => pl.id === autoPars[0].id)!.auto && !p.placements.find((pl) => pl.id === autoPars[1].id)!.auto, "#GEM T6: a move or a category edit clears the auto tag");
    const second = await GP.replaceAutoPlacements(p0.id, { optionId: opt, scopes: ["lighting"], sheetId, page: 1, by, items: [
      { x: 0.1, y: 0.3, partId: "GEM6-PAR", auto: tag("lighting:par") },
      { x: 0.2, y: 0.3, partId: "GEM6-PAR", auto: tag("lighting:par") },
    ] });
    assert.deepEqual(second, { removed: 1, added: 2 }, "#GEM T6: a re-fill replaces only the untouched auto devices of that scope");
    p = (await GP.getProject(p0.id))!;
    assert.equal(p.placements.filter((pl) => pl.partId === "GEM6-PAR").length, 5, "#GEM T6: two hand-touched + one hand-placed + two new");
    const lot = p.placements.find((pl) => pl.partId === "GEM6-PIPE")!;
    assert.ok(lot.qty === 240 && lot.auto?.scope === "rigging", "#GEM T6: another scope's lot is untouched, its qty kept");
    const other = await GP.addOption(p0.id, { name: "Alt", by });
    assert.ok(other.ok, "#GEM T6: a second option");
    if (other.ok) {
      assert.deepEqual(
        await GP.replaceAutoPlacements(p0.id, { optionId: other.option.id, scopes: ["lighting"], sheetId, page: 1, by, items: [] }),
        { removed: 0, added: 0 },
        "#GEM T6: a re-fill in one option never touches another option's devices"
      );
    }
    assert.equal(await GP.replaceAutoPlacements(p0.id, { optionId: "opt-gone", scopes: ["lighting"], sheetId, page: 1, by, items: [] }), null, "#GEM T6: an unknown option is refused");
    await GP.setAutoEstimate(p0.id, { tierByScope: { lighting: "best" }, overrides: { "lighting:par": { qty: 7 } } });
    assert.deepEqual((await GP.getProject(p0.id))!.autoEstimate, { tierByScope: { lighting: "best" }, overrides: { "lighting:par": { qty: 7 } } }, "#GEM T6: the Auto choices persist on the project");
    await Cat.upsert({ sku: "GEM6-PAR", desc: "GEM6 par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    await EM.saveEquipmentRow("audio:subwoofer", { sameAll: true, tiers: { good: { kind: "allowance", amount: 1200, confirmed: true } } }, by);
    const subTag = { scope: "audio" as const, rowKey: "audio:subwoofer", tier: "better" as const };
    await GP.replaceAutoPlacements(p0.id, { optionId: opt, scopes: ["audio"], sheetId, page: 1, by, items: [
      { x: 0.4, y: 0.6, partId: "allow:audio:subwoofer:better", auto: subTag },
      { x: 0.6, y: 0.6, partId: "allow:audio:subwoofer:better", auto: subTag },
    ] });
    p = (await GP.getProject(p0.id))!;
    const q = await buildGridQuote(p, opt);
    assert.ok(q.ok, "#GEM T6: the design quotes");
    if (q.ok) {
      const allowLine = q.build.spec.lines.find((l) => l.sku === "allow:audio:subwoofer:better");
      assert.ok(allowLine && allowLine.allowance === true && allowLine.qty === 2 && allowLine.price > 0, "#GEM T6: the allowance reaches the quote at its live price, flagged");
      assert.ok(!q.build.spec.lines.some((l) => l.sku !== "allow:audio:subwoofer:better" && l.allowance), "#GEM T6: …and only the allowance is flagged");
    }
    await EM.clearEquipmentRow("audio:subwoofer");
  }

```

- [ ] **Step 12: Run the DB regressions + types + lint**

Run: `env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -3; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `review regression checks passed`; tsc silent; eslint 0 errors, ≤ 110 warnings. If tsc flags a missing property on the `gridCatalog` union in `grid-quote.ts`, add that property to `virtualRows` as `undefined as <its type> | undefined`, the way `role` is handled.

- [ ] **Step 13: Build**

Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next`
Expected: the build succeeds.

- [ ] **Step 14: Commit**

```bash
git add src/lib/design/grid-auto-model.ts src/lib/design/grid-virtual-parts.ts src/lib/design/grid-scopes.ts src/lib/design/grid-bom.ts src/lib/design/grid-schedule.ts src/lib/design/grid-riser.ts src/lib/design/grid-quote.ts src/lib/stores/grid-projects.ts src/lib/stores/grid-catalog.ts src/lib/stores/equipment-map.ts "src/app/(app)/design/grid/[id]" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(grid): lot placements, auto tag, virtual assembly/allowance parts (#GEM T6)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Auto estimate cards and the fill rules (pure)

**Files:**
- Create: `src/lib/design/auto-estimate.ts`
- Create: `src/lib/design/grid-auto-layout.ts`
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes (Tasks 1–6): `compute`, `defaultAState`, `LIM`, `SYS_ORDER`, `DrapeGeom`, `venueOf`; `prosGeom`, `churchGeom` (`quick/plan-svg`); `EQUIPMENT_ROW_BY_KEY`, `EquipPlace`; `priceCell`, `EquipmentPriceTable`, `EquipPriceCtx`, `UnitPrice`, `PricedStatus`; `applyEquipment`; `TRACKABLE_SYS_KEYS`; `AutoEstimate`, `AutoOverride`, `AutoTag`; `ScopeTargets`; `assemblyPartId`, `allowancePartId`; `GridCurtain`; `clamp01`, `Point` (`@/lib/annotations`).
- Produces (`@/lib/design/auto-estimate`, server-side; clients import TYPES only):
  - `AUTO_SCOPES`
  - `type AutoLine = { rowKey; scope: SysKey; label; unit; place: EquipPlace; eqQty; qty; status: PricedStatus | "needs-part"; reason?; ref?; refDesc?; unitCost; unitSell; total; swapped: boolean; drape?: DrapeGeom }`
  - `type AutoCard = { scope; tier; lines: AutoLine[]; total; needsPart; allowances }`
  - `type SellLine = Omit<AutoLine, "unitCost">`
  - `type SellCard = Omit<AutoCard, "lines"> & { lines: SellLine[] }`
  - `clampScopeInputs(inputs)`
  - `priceOverrides(overrides, ctx): Record<string, UnitPrice>`
  - `autoEstimateCards(inputs, est, table, overridePrices): AutoCard[]`
  - `sellOnlyCards(cards): SellCard[]`
  - `autoTargets(cards): ScopeTargets`
- Produces (`@/lib/design/grid-auto-layout`, pure):
  - `type Rect`, `type VenueFrame = { stage; audience; booth }`
  - `EACH_CAP = 120`
  - `venueFrame(a)`
  - `partIdForLine(line, tier): string | null`
  - `type AutoPlacementSpec = { x; y; partId; qty?; curtain?: GridCurtain; auto: AutoTag }`
  - `generateAutoLayout(a, cards, { electrics, sets }): AutoPlacementSpec[]`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T7: Auto cards (priced from the map, sell-only to the client) + the fill rules --- */
import { autoEstimateCards as gemCards7, autoTargets as gemAutoTargets7, clampScopeInputs as gemClamp7, priceOverrides as gemPriceOv7, sellOnlyCards as gemSellOnly7 } from "@/lib/design/auto-estimate";
import { EACH_CAP as gemEachCap7, generateAutoLayout as gemLayout7, partIdForLine as gemPartIdFor7, venueFrame as gemFrame7 } from "@/lib/design/grid-auto-layout";
import { buildEquipmentPriceTable as gemTable7, type EquipCell as GemCell7 } from "@/lib/design/equipment-map";
import { compute as gemCompute7, defaultAState as gemDefault7, type AState as GemAState7 } from "@/app/(app)/design/quick/engine";
import { prosGeom as gemProsGeom7 } from "@/app/(app)/design/quick/plan-svg";
import { manualScopeInputs as gemManualInputs7 } from "@/lib/design/grid-intake";
{
  const parts = new Map<string, { sku: string; desc: string; unit: string; cost: number; list: number; category: string; curtainAreaRate?: number }>([
    ["GEM7-PAR", { sku: "GEM7-PAR", desc: "LED par", unit: "ea", cost: 600, list: 900, category: "Lighting Fixtures" }],
    ["GEM7-FRONT", { sku: "GEM7-FRONT", desc: "Profile spot", unit: "ea", cost: 1500, list: 2100, category: "Lighting Fixtures" }],
    ["GEM7-HB", { sku: "GEM7-HB", desc: "Headblock", unit: "ea", cost: 500, list: 700, category: "Rigging Hardware" }],
    ["GEM7-PIPE", { sku: "GEM7-PIPE", desc: "Batten pipe", unit: "ft", cost: 8, list: 12, category: "Rigging Hardware" }],
    ["GEM7-VEL", { sku: "GEM7-VEL", desc: "Velour", unit: "sq ft", cost: 0, list: 0, category: "Fabric", curtainAreaRate: 3.5 }],
    ["GEM7-SPK", { sku: "GEM7-SPK", desc: "Line array box", unit: "ea", cost: 1000, list: 1450, category: "Audio" }],
    ["GEM7-MIX", { sku: "GEM7-MIX", desc: "Mixer", unit: "ea", cost: 5000, list: 7000, category: "Audio" }],
  ]);
  const rack = {
    id: "SA-GEM7", kind: "system" as const, label: "GEM7 rack", description: "", scope: "Audio" as const,
    lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] },
    parts: [{ sku: "GEM7-MIX", qty: 1 }], createdAt: 1, createdBy: "t", updatedAt: 1, updatedBy: "t",
  };
  const ctx = { parts, fixtures: new Map([[rack.id, rack]]), margin: 0.3 };
  const every = (c: GemCell7) => ({ tiers: { good: c }, sameAll: true, updatedBy: "t", updatedAt: 1 });
  const table = gemTable7({
    "lighting:par": every({ kind: "part", sku: "GEM7-PAR" }),
    "lighting:front": every({ kind: "part", sku: "GEM7-FRONT" }),
    "rigging:headblock": every({ kind: "part", sku: "GEM7-HB" }),
    "rigging:pipe": every({ kind: "part", sku: "GEM7-PIPE" }),
    "curtains:draw": every({ kind: "part", sku: "GEM7-VEL" }),
    "audio:lineArray": every({ kind: "part", sku: "GEM7-SPK" }),
    "audio:subwoofer": every({ kind: "allowance", amount: 1200, confirmedBy: "Chris", confirmedAt: 5 }),
    "audio:mixerDsp": every({ kind: "assembly", id: "SA-GEM7" }),
  }, ctx);
  const a: GemAState7 = {
    ...gemDefault7(0), venue: "school", size: "medium", width: 40, depth: 30, grid: 24, wing: 12, ph: 20, rigType: "counterweight",
    sys: { rigging: true, curtains: true, lighting: true, controls: false, audio: true, video: false, acoustical: false, pit: false },
    drape: { draw: true, legs: false, border: false, scenerytrack: false, fullstage: false },
    fixtures: { par: true, front: true, cyc: false, side: false, automated: false },
  };
  const inputs = { ...gemManualInputs7(a), sys: a.sys };
  const est = {
    tierByScope: { rigging: "better" as const, curtains: "better" as const, lighting: "better" as const, audio: "better" as const },
    overrides: { "lighting:front": { qty: 3 } },
  };
  const cards = gemCards7(inputs, est, table, gemPriceOv7(est.overrides, ctx));
  ok(cards.map((c) => c.scope).join(",") === "rigging,curtains,lighting,audio", "#GEM T7: one card per chosen Grid scope, in scope order");
  const card = (k: string) => cards.find((c) => c.scope === k)!;
  const line = (k: string, key: string) => card(k).lines.find((l) => l.rowKey === key)!;
  const par = line("lighting", "lighting:par");
  ok(par.status === "part" && par.unitSell === 900 && par.qty === 15 && par.total === 15 * 900 && par.ref === "GEM7-PAR", "#GEM T7: a mapped line pre-fills its part at the equation quantity");
  const front = line("lighting", "lighting:front");
  ok(front.qty === 3 && front.eqQty === 13 && front.total === 3 * 2100, "#GEM T7: an edited qty overrides the equation quantity");
  const rig = card("rigging");
  const arbor = line("rigging", "rigging:arbor");
  ok(arbor.status === "needs-part" && arbor.total === 0 && arbor.unitSell === 0 && arbor.reason === "Not mapped yet" && rig.needsPart >= 1, "#GEM T7: unmapped lines are listed with a reason, never priced");
  ok(rig.total === rig.lines.reduce((s, l) => s + l.total, 0), "#GEM T7: a card total sums only priced lines");
  const sub = line("audio", "audio:subwoofer");
  ok(sub.status === "allowance" && sub.unitSell === 1714.29 && card("audio").allowances === 1, "#GEM T7: a confirmed allowance line is flagged and priced");
  const mix = line("audio", "audio:mixerDsp");
  ok(mix.status === "assembly" && mix.unitSell === 7000, "#GEM T7: a System assembly line prices at its included totals");
  const draw = line("curtains", "curtains:draw");
  ok(draw.status === "part" && !!draw.drape && draw.unitCost > 0 && draw.ref === "GEM7-VEL", "#GEM T7: a drape line costs from the mapped fabric");
  const swapOv = { "lighting:par": { assemblyId: "SA-GEM7" } };
  const spar = gemCards7(inputs, { ...est, overrides: swapOv }, table, gemPriceOv7(swapOv, ctx)).find((c) => c.scope === "lighting")!.lines.find((l) => l.rowKey === "lighting:par")!;
  ok(spar.status === "assembly" && spar.swapped && spar.refDesc === "GEM7 rack", "#GEM T7: any line can be swapped to an assembly for this design");
  const sell = gemSellOnly7(cards);
  ok(!JSON.stringify(sell).includes("unitCost") && sell[0].lines.length === cards[0].lines.length, "#GEM T7: the client payload carries no unit cost");
  const tg = gemAutoTargets7(cards);
  ok(tg.lighting!.sell === card("lighting").total && tg.rigging!.needsPart === rig.needsPart && tg.audio!.allowances === 1, "#GEM T7: Auto targets are the chosen cards' totals");
  const clamped = gemClamp7({ ...inputs, width: 9999, depth: Number.NaN });
  ok(clamped.width === 80 && clamped.depth === 14, "#GEM T7: client-sent dimensions are clamped");
  const Cq = gemCompute7({ ...a, tier: "better" });
  const specs = gemLayout7(a, cards, { electrics: Cq.electrics, sets: Cq.rigSets });
  const placedQty = (key: string) => specs.filter((s) => s.auto.rowKey === key).reduce((n, s) => n + (s.qty ?? 1), 0);
  const placeable = cards.flatMap((c) => c.lines.filter((l) => gemPartIdFor7(l, c.tier) !== null));
  ok(placeable.length > 0 && placeable.every((l) => placedQty(l.rowKey) === l.qty), "#GEM T7: every placeable line lands at exactly its quantity");
  ok(specs.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1), "#GEM T7: every position lies on the sheet");
  const fr = gemFrame7(a);
  const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
    p.x >= r.x - 1e-9 && p.x <= r.x + r.w + 1e-9 && p.y >= r.y - 1e-9 && p.y <= r.y + r.h + 1e-9;
  ok(specs.filter((s) => s.auto.rowKey === "lighting:par").every((s) => inside(s, fr.stage)), "#GEM T7: pars hang on the electrics, inside the stage");
  ok(specs.filter((s) => s.auto.rowKey === "lighting:front").every((s) => inside(s, fr.audience)), "#GEM T7: front lights go front-of-house");
  ok(specs.filter((s) => s.auto.rowKey === "audio:mixerDsp").every((s) => inside(s, fr.booth)), "#GEM T7: the mixer rack goes to the control booth");
  ok(!specs.some((s) => s.auto.rowKey === "rigging:arbor"), "#GEM T7: a needs-a-part line is never placed");
  const drapes = specs.filter((s) => s.auto.rowKey === "curtains:draw");
  ok(drapes.length === draw.qty && drapes.every((s) => s.partId === "GEM7-VEL" && s.curtain?.type === "Draw" && s.curtain.fabricSku === "GEM7-VEL" && s.curtain.widthFt === draw.drape!.w * draw.drape!.qty && s.curtain.fullnessPct === 50), "#GEM T7: draws land as curtain drop-ins on the mapped fabric, a pair as one drape");
  ok(specs.filter((s) => s.auto.rowKey === "audio:subwoofer").every((s) => s.partId === "allow:audio:subwoofer:better") && specs.some((s) => s.partId === "asm:SA-GEM7"), "#GEM T7: allowances and assemblies land as virtual parts");
  const pipeSpecs = specs.filter((s) => s.auto.rowKey === "rigging:pipe");
  ok(pipeSpecs.length === 1 && pipeSpecs[0].qty === line("rigging", "rigging:pipe").qty && gemEachCap7 === 120, "#GEM T7: a lot row lands once, carrying its quantity");
  ok(specs.every((s) => s.auto.tier === "better" && ["rigging", "curtains", "lighting", "audio"].includes(s.auto.scope)), "#GEM T7: every placement carries its auto tag");
  const G = gemProsGeom7(a);
  ok(Math.abs(fr.stage.x - G.stage.x / G.W) < 1e-12 && Math.abs(fr.audience.y - G.yHouseFront / G.H) < 1e-12 && Math.abs(fr.booth.y - G.yBackWall / G.H) < 1e-12, "#GEM T7: the frame is the base sheet's own geometry");
}
```

This block has **23** `ok(` calls. The numbers come from a 40′ × 30′ medium Auditorium: 3 electrics × 5 width units → **15** pars; front `round(5 × 2.5)` = **13**; 18 counterweight sets.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: cannot resolve `@/lib/design/auto-estimate`.

- [ ] **Step 3: Create the Auto cards module**

Create `src/lib/design/auto-estimate.ts`:

```ts
/**
 * Auto intake cards (#GEM, spec §5) — the equations' items for each chosen
 * Grid scope, priced at that scope's tier from the Equipment map (or a
 * per-row swap), with editable quantities. Server-side: it prices through
 * equipment-pricing.ts (cost-bearing). Clients receive sellOnlyCards() and
 * import only its TYPES.
 */
import {
  LIM,
  SYS_ORDER,
  compute,
  defaultAState,
  type AState,
  type DimField,
  type DrapeGeom,
  type QuickScopeInputs,
  type SysKey,
  type TierKey,
} from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROW_BY_KEY, type EquipPlace } from "./equipment-vocab";
import { priceCell, type EquipmentPriceTable, type EquipPriceCtx, type PricedStatus, type UnitPrice } from "./equipment-map";
import { applyEquipment } from "./equipment-pricing";
import { TRACKABLE_SYS_KEYS } from "./grid-scopes";
import type { AutoEstimate, AutoOverride } from "./grid-auto-model";
import type { ScopeTargets } from "./scope-targets";

/** Auto fills only the five Grid scopes (D-GEM-7). */
export const AUTO_SCOPES: readonly SysKey[] = TRACKABLE_SYS_KEYS;

export type AutoLine = {
  rowKey: string;
  scope: SysKey;
  /** The equation's item name. */
  label: string;
  unit: string;
  place: EquipPlace;
  /** What the equations call for; `qty` is that or the designer's edit. */
  eqQty: number;
  qty: number;
  status: PricedStatus | "needs-part";
  /** needs-part only: why (not mapped, deleted part, …). */
  reason?: string;
  ref?: string;
  refDesc?: string;
  unitCost: number;
  unitSell: number;
  /** qty × unitSell (0 for needs-part). */
  total: number;
  swapped: boolean;
  drape?: DrapeGeom;
};
export type AutoCard = { scope: SysKey; tier: TierKey; lines: AutoLine[]; total: number; needsPart: number; allowances: number };
export type SellLine = Omit<AutoLine, "unitCost">;
export type SellCard = Omit<AutoCard, "lines"> & { lines: SellLine[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Client-sent scope inputs, made safe for the equations: finite, non-negative, capped dims; boolean systems. */
export function clampScopeInputs(inputs: QuickScopeInputs): QuickScopeInputs {
  const dim = (f: DimField) => {
    const v = Number(inputs[f]);
    return Number.isFinite(v) ? Math.max(0, Math.min(LIM[f][1], v)) : LIM[f][0];
  };
  const sys = Object.fromEntries(SYS_ORDER.map((k) => [k, !!inputs.sys?.[k]])) as Record<SysKey, boolean>;
  return { ...inputs, width: dim("width"), depth: dim("depth"), grid: dim("grid"), wing: dim("wing"), ph: dim("ph"), sys };
}

/** Price each row's swap (a catalog SKU or an assembly) through the same resolver as the map. */
export function priceOverrides(overrides: Record<string, AutoOverride>, ctx: EquipPriceCtx): Record<string, UnitPrice> {
  const out: Record<string, UnitPrice> = {};
  for (const [rowKey, o] of Object.entries(overrides)) {
    const def = EQUIPMENT_ROW_BY_KEY.get(rowKey);
    if (!def) continue;
    if (o.sku) out[rowKey] = priceCell({ kind: "part", sku: o.sku }, def, ctx);
    else if (o.assemblyId) out[rowKey] = priceCell({ kind: "assembly", id: o.assemblyId }, def, ctx);
  }
  return out;
}

export function autoEstimateCards(
  rawInputs: QuickScopeInputs,
  est: AutoEstimate,
  table: EquipmentPriceTable,
  overridePrices: Record<string, UnitPrice>
): AutoCard[] {
  const inputs = clampScopeInputs(rawInputs);
  const s: AState = { ...defaultAState(0), ...inputs, tier: "better" };
  const C = compute(s);
  const cards: AutoCard[] = [];
  for (const scope of AUTO_SCOPES) {
    if (!inputs.sys[scope]) continue;
    const sys = C.systems.find((x) => x.key === scope);
    if (!sys) continue;
    const tier = est.tierByScope[scope] ?? "better";
    const [priced] = applyEquipment([sys], tier, table, overridePrices);
    const lines: AutoLine[] = [];
    for (const it of priced.items) {
      if (it.qty <= 0) continue;
      const def = EQUIPMENT_ROW_BY_KEY.get(it.key);
      if (!def) continue;
      const o = est.overrides[it.key];
      const qty = o?.qty ?? it.qty;
      const status = it.status ?? "needs-part";
      const needs = status === "needs-part";
      const src = overridePrices[it.key] ?? table.byTier[tier][it.key];
      lines.push({
        rowKey: it.key,
        scope,
        label: it.desc,
        unit: it.unit,
        place: def.place,
        eqQty: it.qty,
        qty,
        status,
        ...(needs ? { reason: src && src.status === "needs-part" ? src.reason : "Not mapped yet" } : {}),
        ...(it.ref ? { ref: it.ref } : {}),
        ...(it.refDesc ? { refDesc: it.refDesc } : {}),
        unitCost: needs ? 0 : it.cost,
        unitSell: needs ? 0 : it.price,
        total: needs ? 0 : round2(qty * it.price),
        swapped: !!(o?.sku || o?.assemblyId),
        ...(it.drape ? { drape: it.drape } : {}),
      });
    }
    cards.push({
      scope,
      tier,
      lines,
      total: round2(lines.reduce((sum, l) => sum + l.total, 0)),
      needsPart: lines.filter((l) => l.status === "needs-part").length,
      allowances: lines.filter((l) => l.status === "allowance").length,
    });
  }
  return cards;
}

function sellLine(l: AutoLine): SellLine {
  return {
    rowKey: l.rowKey,
    scope: l.scope,
    label: l.label,
    unit: l.unit,
    place: l.place,
    eqQty: l.eqQty,
    qty: l.qty,
    status: l.status,
    ...(l.reason ? { reason: l.reason } : {}),
    ...(l.ref ? { ref: l.ref } : {}),
    ...(l.refDesc ? { refDesc: l.refDesc } : {}),
    unitSell: l.unitSell,
    total: l.total,
    swapped: l.swapped,
    ...(l.drape ? { drape: l.drape } : {}),
  };
}

/** What a client may see: every line without its unit cost. */
export function sellOnlyCards(cards: AutoCard[]): SellCard[] {
  return cards.map((c) => ({ scope: c.scope, tier: c.tier, lines: c.lines.map(sellLine), total: c.total, needsPart: c.needsPart, allowances: c.allowances }));
}

/** The Scope panel's target for Auto scopes = the chosen cards. */
export function autoTargets(cards: Array<AutoCard | SellCard>): ScopeTargets {
  const out: ScopeTargets = {};
  for (const c of cards) out[c.scope] = { sell: c.total, needsPart: c.needsPart, allowances: c.allowances };
  return out;
}
```

The `rig.total === rig.lines.reduce(…)` assertion compares a `round2`-rounded total. Every line total is already cents-rounded, so the per-line sum equals it exactly for these fixtures. If it ever drifts, compare with `Math.abs(a − b) < 0.005` instead.

- [ ] **Step 4: Create the fill rules**

Create `src/lib/design/grid-auto-layout.ts`:

```ts
/**
 * The Grid — Auto fill placement rules (#GEM, spec §5). Pure. Turns priced
 * Auto cards into placement specs on the GENERATED base sheet, using the same
 * venue geometry the sheet was drawn from (prosGeom / churchGeom, and for the
 * other kinds the fixed-fraction frame starterSpaces() in grid-projects.ts
 * already uses for Stage / Audience view / FOH·control).
 *
 * Rules (normalized 0..1, y grows downstage toward the house):
 *  - Lighting: pars / movers in rows on each electric (grid-seed's old row
 *    fractions); front lights in two rows front-of-house; cyc units along the
 *    cyc line; side lights alternating at the proscenium sides.
 *  - Audio: line-array boxes hung left / right of the proscenium; subs along
 *    the stage lip; mixer / DSP rack in the control booth.
 *  - Video: screen centred upstage; projector and processor in the booth.
 *  - Curtains: on their line-set positions (the old schematic fractions);
 *    legs at the stage-left edge; a pair lands as ONE drape of combined width.
 *  - Rigging: hoists / points / headblocks across the grid width on each set
 *    line; count or length hardware lands as ONE lot marker at the lock rail.
 *  - Anything else: spread along the lower margin of its scope's region.
 * Needs-a-part lines are never placed. Rows marked "lot", or any row with
 * qty > EACH_CAP, land as a single marker carrying `qty`.
 */
import { clamp01, type Point } from "@/lib/annotations";
import { venueOf, type AState, type SysKey, type TierKey } from "@/app/(app)/design/quick/engine";
import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";
import type { GridCurtain } from "./grid-bom";
import type { AutoTag } from "./grid-auto-model";
import type { AutoCard, AutoLine } from "./auto-estimate";
import { EQUIPMENT_ROW_BY_KEY } from "./equipment-vocab";
import { allowancePartId, assemblyPartId } from "./grid-virtual-parts";

export type Rect = { x: number; y: number; w: number; h: number };
export type VenueFrame = { stage: Rect; audience: Rect; booth: Rect };
export const EACH_CAP = 120;

export function venueFrame(a: AState): VenueFrame {
  const kind = venueOf(a).kind || "proscenium";
  if (kind === "proscenium") {
    const G = prosGeom(a);
    const r = (x: number, y: number, w: number, h: number): Rect => ({ x: x / G.W, y: y / G.H, w: w / G.W, h: h / G.H });
    return {
      stage: r(G.stage.x, G.stage.y, G.stage.w, G.stage.h),
      audience: r(G.xAudL, G.yHouseFront, G.xAudR - G.xAudL, G.yBackWall - G.yHouseFront),
      booth: r(G.cx - G.boothW / 2, G.yBackWall, G.boothW, G.yBoothBottom - G.yBackWall),
    };
  }
  if (kind === "church") {
    const G = churchGeom(a);
    const r = (x: number, y: number, w: number, h: number): Rect => ({ x: x / G.W, y: y / G.H, w: w / G.W, h: h / G.H });
    return {
      stage: r(G.stage.x, G.stage.y, G.stage.w, G.stage.h),
      audience: r(G.x0, G.pBot, G.x1 - G.x0, G.seatBot - G.pBot),
      booth: r(G.cx - G.boothW / 2, G.y1, G.boothW, G.boothH),
    };
  }
  // flat / blackbox / gym / arena — starterSpaces()'s fixed-fraction frame.
  return {
    stage: { x: 0.2, y: 0.12, w: 0.6, h: 0.28 },
    audience: { x: 0.08, y: 0.58, w: 0.84, h: 0.32 },
    booth: { x: 0.38, y: 0.44, w: 0.24, h: 0.09 },
  };
}

/** The placement partId for a line: a catalog SKU, `asm:<id>`, `allow:<row>:<tier>` — null when it must not be placed. */
export function partIdForLine(line: Pick<AutoLine, "status" | "ref" | "rowKey" | "qty">, tier: TierKey): string | null {
  if (line.qty <= 0) return null;
  if (line.status === "part" && line.ref) return line.ref;
  if (line.status === "assembly" && line.ref) return assemblyPartId(line.ref);
  if (line.status === "allowance") return allowancePartId(line.rowKey, tier);
  return null;
}

export type AutoPlacementSpec = { x: number; y: number; partId: string; qty?: number; curtain?: GridCurtain; auto: AutoTag };

const round1 = (n: number) => Math.round(n * 10) / 10;

function spread(n: number, x0: number, x1: number, y: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: clamp01(x0 + ((i + 0.5) / n) * (x1 - x0)), y: clamp01(y) }));
}

/** n points round-robin across rows (one y per row), evenly across [x0, x1] within a row. */
function onRows(n: number, x0: number, x1: number, ys: number[]): Point[] {
  const rows = Math.max(1, ys.length);
  const perRow = Math.ceil(n / rows);
  return Array.from({ length: n }, (_, i) => {
    const row = i % rows;
    const col = Math.floor(i / rows);
    return { x: clamp01(x0 + ((col + 0.5) / perRow) * (x1 - x0)), y: clamp01(ys[row]) };
  });
}

/** Each electric's line, at the old seeder's row fractions ((E − j) / (E + 1) of the stage depth). */
function electricYs(S: Rect, electrics: number): number[] {
  const e = Math.max(1, electrics);
  return Array.from({ length: e }, (_, j) => S.y + ((e - j) / (e + 1)) * S.h);
}

/** k set lines evenly through the stage depth. */
function setLineYs(S: Rect, k: number): number[] {
  const n = Math.max(1, k);
  return Array.from({ length: n }, (_, i) => S.y + ((i + 0.5) / n) * S.h);
}

/** The old schematic's curtain fractions of stage depth (0 = upstage wall, 1 = plaster line). */
const CURTAIN_FRACS: Record<string, number[]> = {
  draw: [0.95, 0.5, 0.26],
  fullstage: [0.5, 0.3],
  border: [0.74, 0.48, 0.22],
  legs: [0.74, 0.48, 0.22],
};

function curtainPoints(itemKey: string, n: number, S: Rect): Point[] {
  const fracs = CURTAIN_FRACS[itemKey] ?? [0.5];
  return Array.from({ length: n }, (_, i) => {
    const frac = Math.max(0.02, fracs[i % fracs.length] - 0.04 * Math.floor(i / fracs.length));
    const x = itemKey === "legs" ? S.x - 0.03 * S.w : S.x + S.w / 2;
    return { x: clamp01(x), y: clamp01(S.y + frac * S.h) };
  });
}

function sidePoints(n: number, S: Rect): Point[] {
  const per = Math.max(1, Math.ceil(n / 2));
  return Array.from({ length: n }, (_, i) => {
    const k = Math.floor(i / 2);
    return { x: clamp01(i % 2 === 0 ? S.x - 0.02 : S.x + S.w + 0.02), y: clamp01(S.y + ((k + 0.5) / per) * S.h) };
  });
}

/** Line-array boxes: alternating left / right hangs just downstage of the proscenium, stacked. */
function clusterPoints(n: number, S: Rect): Point[] {
  const y0 = S.y + S.h + 0.02;
  return Array.from({ length: n }, (_, i) => ({
    x: clamp01(i % 2 === 0 ? S.x - 0.03 : S.x + S.w + 0.03),
    y: clamp01(y0 + 0.012 * Math.floor(i / 2)),
  }));
}

/** Where the k-th lot marker of a scope sits: rigging at the lock rail (stage right), others on their region's lower margin. */
function lotPoint(scope: SysKey, k: number, f: VenueFrame): Point {
  const S = f.stage;
  if (scope === "rigging") return { x: clamp01(S.x + S.w + 0.02), y: clamp01(S.y + (0.1 + 0.08 * k) * S.h) };
  const R = scope === "audio" ? f.audience : S;
  return { x: clamp01(R.x + 0.06 + 0.07 * k), y: clamp01(R.y + R.h - 0.03) };
}

function eachPoints(line: AutoLine, n: number, f: VenueFrame, opts: { electrics: number; sets: number }): Point[] {
  const { stage: S, audience: A, booth: B } = f;
  switch (line.rowKey) {
    case "lighting:par":
    case "lighting:automated":
      return onRows(n, S.x, S.x + S.w, electricYs(S, opts.electrics));
    case "lighting:front":
      return onRows(n, A.x, A.x + A.w, [A.y + 0.45 * A.h, A.y + 0.6 * A.h]);
    case "lighting:cyc":
      return spread(n, S.x, S.x + S.w, S.y + 0.05 * S.h);
    case "lighting:side":
      return sidePoints(n, S);
    case "audio:lineArray":
      return clusterPoints(n, S);
    case "audio:subwoofer":
      return spread(n, S.x, S.x + S.w, S.y + S.h - 0.01);
    case "audio:mixerDsp":
    case "video:processor":
    case "video:projector":
      return spread(n, B.x, B.x + B.w, B.y + B.h / 2);
    case "video:screen":
      return spread(n, S.x + 0.3 * S.w, S.x + 0.7 * S.w, S.y + 0.1 * S.h);
    case "rigging:electricHoist":
    case "rigging:lowCapHoist":
    case "rigging:highCapHoist":
    case "rigging:varSpeedHoist":
    case "rigging:riggingPoint":
    case "rigging:headblock":
      return onRows(n, S.x, S.x + S.w, setLineYs(S, Math.min(n, Math.max(1, opts.sets))));
    default: {
      const R = line.scope === "audio" ? A : S;
      return spread(n, R.x, R.x + R.w, R.y + R.h - 0.03);
    }
  }
}

/**
 * Placement specs for the given cards (spec §5). `a` is the geometry the base
 * sheet was drawn from (intake.autoConfig); `opts` are that design's electric
 * and set counts (compute()). Every spec carries `auto: { scope, rowKey, tier }`.
 */
export function generateAutoLayout(a: AState, cards: AutoCard[], opts: { electrics: number; sets: number }): AutoPlacementSpec[] {
  const f = venueFrame(a);
  const out: AutoPlacementSpec[] = [];
  const lots = new Map<SysKey, number>();
  for (const card of cards) {
    for (const line of card.lines) {
      const partId = partIdForLine(line, card.tier);
      if (!partId) continue;
      const def = EQUIPMENT_ROW_BY_KEY.get(line.rowKey);
      if (!def) continue;
      const auto: AutoTag = { scope: card.scope, rowKey: line.rowKey, tier: card.tier };
      if (def.curtain && line.drape && line.status === "part" && line.ref) {
        const drape = line.drape;
        const fabricSku = line.ref;
        const gridType = def.curtain.grid;
        curtainPoints(def.itemKey, line.qty, f.stage).forEach((pt, i) =>
          out.push({
            ...pt,
            partId: fabricSku,
            auto,
            curtain: {
              type: gridType,
              name: `${line.label} ${i + 1}`,
              widthFt: round1(drape.w * drape.qty),
              heightFt: round1(drape.h),
              fullnessPct: drape.fullness,
              fabricSku,
            },
          })
        );
        continue;
      }
      if (def.place === "lot" || line.qty > EACH_CAP) {
        const k = lots.get(card.scope) ?? 0;
        lots.set(card.scope, k + 1);
        out.push({ ...lotPoint(card.scope, k, f), partId, qty: line.qty, auto });
        continue;
      }
      for (const pt of eachPoints(line, line.qty, f, opts)) out.push({ ...pt, partId, auto });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the specs + types + lint**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `ALL PASSED`, **4063** PASS lines (4040 + 23); tsc silent; eslint 0 errors, ≤ 110 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/auto-estimate.ts src/lib/design/grid-auto-layout.ts scripts/test-review-and-spec.ts
git commit -m "feat(grid): Auto estimate cards + rule-based fill on the base sheet (#GEM T7)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: One intake (Auto or Blank), the Auto fill, and "New design" routes to it

**Files:**
- Create: `src/lib/design/grid-auto-fill.ts`
- Modify: `src/lib/design/grid-intake.ts` (`intakeScopeInputs`)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts`: `previewAutoEstimateAction` and `searchAutoEquipmentAction`; `saveGridIntakeAction` now handles Auto.
- Create: `src/app/(app)/design/grid/[id]/scope-picker.tsx`
- Create: `src/app/(app)/design/grid/[id]/equipment-card.tsx` (`useAutoPreview`, `EquipmentCard`, `EquipmentCards`, `EquipmentPicker`, `mapHref`)
- Rewrite: `src/app/(app)/design/grid/[id]/grid-intake.tsx`
- Create: `src/components/design/new-design-button.tsx`
- Modify: `src/app/(app)/design/designs/design-client.tsx` (the `NewDesignSplit` → `NewDesignButton` swap)
- Modify: `src/app/(app)/home-my-designs.tsx` (both "New design" links → `NewDesignButton`)
- Test: `scripts/test-review-and-spec.ts` (append at EOF); `scripts/test-review-regressions.ts` (a new block before `#210 final review M5`)

**Interfaces:**
- Consumes (Tasks 2–7): `loadEquipPriceCtx`, `buildEquipmentPriceTable`, `sellFromCost`, `autoEstimateCards`, `clampScopeInputs`, `priceOverrides`, `sellOnlyCards`, `AUTO_SCOPES`, `SellCard`, `SellLine`, `generateAutoLayout`, `sanitizeAutoEstimate`, `mergeScopeEstimate`, `overrideRefs`, `AutoEstimate`, `AutoOverride`, `replaceAutoPlacements`, `setAutoEstimate`, `ensureGridSymbolsFor`, `listFixtures`, `getMany`, `getCatalogRates`, `resolveFixture`, `fixtureSkus`, `searchCatalog`, `createManualDesignAction` (`@/app/(app)/design/designs/actions`), `SUBCFG`, `TRACKABLE_SYS_KEYS`.
- Produces:
  - `fillAutoScopes(projectId, optionId, scopes: SysKey[], by): Promise<{ ok: true; added; removed; needsPart } | { ok: false; error }>` (server-only)
  - `intakeScopeInputs(a: AState): QuickScopeInputs`
  - `previewAutoEstimateAction({ inputs, estimate }): Promise<{ ok: true; cards: SellCard[] } | { ok: false; error }>`
  - `type AutoEquipHit = { kind: "part" | "assembly"; ref: string; desc: string; unit: string; unitSell: number }`
  - `searchAutoEquipmentAction(query): Promise<{ hits: AutoEquipHit[] }>`
  - `saveGridIntakeAction({ projectId, mode: "manual" | "auto", venueName, locationName, address, notes, autoConfig, estimate? }): Promise<{ ok: true; warning?: string } | { ok: false; error: string }>`
  - `useAutoPreview(initial?)` → `{ cards, error, loading, run(inputs, estimate, delay?) }`
  - `EquipmentCard({ card, estimate, onChange })`
  - `EquipmentCards({ cards, estimate, onChange, loading, error })`
  - `mapHref(rowKey)`
  - `NewDesignButton({ style, className, children, title? })`

- [ ] **Step 1: Write the failing pure test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T8: one intake — Auto or Blank; sell-only previews; New design → the Grid intake --- */
import { intakeScopeInputs as gemIntakeInputs8 } from "@/lib/design/grid-intake";
import { defaultAState as gemDefault8 } from "@/app/(app)/design/quick/engine";
{
  const a8 = { ...gemDefault8(0), venue: "pac", sys: { rigging: false, curtains: true, lighting: true, controls: true, audio: false, video: true, acoustical: true, pit: true } };
  const si = gemIntakeInputs8(a8);
  ok(si.sys.curtains && si.sys.lighting && si.sys.video && !si.sys.rigging && !si.sys.audio && !si.sys.controls && !si.sys.pit && si.venue === "pac", "#GEM T8: the intake's scopes are the designer's picks, limited to the five Grid scopes");
  const dir = "src/app/(app)/design/grid/[id]";
  const intakeSrc = readFileSync(join(process.cwd(), `${dir}/grid-intake.tsx`), "utf8");
  ok(!/next release/i.test(intakeSrc) && intakeSrc.includes("Auto (equations)") && intakeSrc.includes("Blank") && intakeSrc.includes("EquipmentCards"), "#GEM T8: the intake offers Auto (equations) or Blank, and Auto has an Equipment step");
  const clientFiles = ["grid-intake.tsx", "equipment-card.tsx", "scope-picker.tsx"].map((f) => readFileSync(join(process.cwd(), `${dir}/${f}`), "utf8"));
  ok(clientFiles.every((s) => s.startsWith('"use client"') && !gemValueImports(s).some((m) => /\/auto-estimate$|\/equipment-pricing$|\/lib\/design\/equipment-map$|^@\/lib\/stores\/|^@\/db\//.test(m))), "#GEM T8: the intake's client files import no pricing, store or DB value (types only)");
  const act8 = readFileSync(join(process.cwd(), `${dir}/actions.ts`), "utf8");
  const searchBody = act8.slice(act8.indexOf("export async function searchAutoEquipmentAction"), act8.indexOf("export async function saveGridIntakeAction"));
  ok(act8.includes("sellOnlyCards(") && searchBody.includes("unitSell") && !/\bcost:\s*h\.cost/.test(searchBody), "#GEM T8: previews and part search return sell numbers only");
  const dc = readFileSync(join(process.cwd(), "src/app/(app)/design/designs/design-client.tsx"), "utf8");
  const hm = readFileSync(join(process.cwd(), "src/app/(app)/home-my-designs.tsx"), "utf8");
  ok(!dc.includes("NewDesignSplit") && !dc.includes('href="/design/quick"') && dc.includes("<NewDesignButton") && hm.includes("<NewDesignButton") && !hm.includes('href="/design/quick"'), "#GEM T8: every New design control opens the Grid intake; the Quick Design canvas is retired from New design");
}
```

This block has **5** `ok(` calls. Place this block and its `searchBody` slice after the `searchAutoEquipmentAction` and `saveGridIntakeAction` definitions exist, in that order, in `actions.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: `intakeScopeInputs` is not exported.

- [ ] **Step 3: `intakeScopeInputs`**

In `src/lib/design/grid-intake.ts`, append:

```ts
/**
 * The one intake's scope inputs (#GEM): venue/size/dims as entered, systems =
 * the designer's own scope picks (a.sys) limited to the five Grid scopes. The
 * intake starts a.sys from the venue preset, so an untouched intake equals
 * manualScopeInputs(a).
 */
export function intakeScopeInputs(a: AState): QuickScopeInputs {
  const sys = Object.fromEntries(
    SYS_ORDER.map((k) => [k, TRACKABLE_SYS_KEYS.includes(k) && !!a.sys?.[k]])
  ) as Record<SysKey, boolean>;
  return { ...manualScopeInputs(a), sys };
}
```

- [ ] **Step 4: The server-only fill**

Create `src/lib/design/grid-auto-fill.ts`:

```ts
import { compute, defaultAState, type SysKey } from "@/app/(app)/design/quick/engine";
import { getProject, replaceAutoPlacements } from "@/lib/stores/grid-projects";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { ensureGridSymbolsFor } from "@/lib/stores/grid-catalog";
import { buildEquipmentPriceTable } from "./equipment-map";
import { autoEstimateCards, priceOverrides } from "./auto-estimate";
import { generateAutoLayout } from "./grid-auto-layout";
import { overrideRefs } from "./grid-auto-model";

// Server-only (the `server-only` package isn't installed here): fail loudly if a client bundle ever pulls it in.
if (typeof window !== "undefined") throw new Error("grid-auto-fill is server-only");

export type FillResult = { ok: true; added: number; removed: number; needsPart: number } | { ok: false; error: string };

/**
 * Auto fill (#GEM, spec §5): price the project's Auto choices from the
 * Equipment map + live catalog, lay them out by rule on the generated base
 * sheet (sheetIds[0]) using the geometry it was drawn from (intake.autoConfig),
 * and replace the untouched auto devices of `scopes` in `optionId` — hand-
 * touched ones stay. Mapped catalog parts get a Grid library entry first so
 * the editor resolves them. Called only from user actions (the intake's first
 * save, "Change equipment…"), never on page load. Needs-a-part lines are
 * reported, never placed.
 */
export async function fillAutoScopes(projectId: string, optionId: string, scopes: SysKey[], by: string): Promise<FillResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "That design could not be found." };
  const inputs = project.scopeInputs;
  const a = project.intake?.autoConfig;
  const est = project.autoEstimate;
  if (!inputs || !a || !est) return { ok: false, error: "This design has no Auto choices to fill from." };
  const sheetId = project.sheetIds[0];
  if (!sheetId) return { ok: false, error: "No plan sheet to fill yet." };
  const refs = overrideRefs(est);
  const { map, ctx, catalogParts } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  const cards = autoEstimateCards(inputs, est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx)).filter((c) =>
    scopes.includes(c.scope)
  );
  const deviceSkus = new Set(
    cards.flatMap((c) => c.lines.filter((l) => l.status === "part" && !l.drape && l.ref && l.qty > 0).map((l) => l.ref as string))
  );
  await ensureGridSymbolsFor([...catalogParts.values()].filter((p) => deviceSkus.has(p.sku)), by);
  const C = compute({ ...defaultAState(0), ...inputs, tier: "better" });
  const items = generateAutoLayout(a, cards, { electrics: C.electrics, sets: C.rigSets });
  const res = await replaceAutoPlacements(projectId, { optionId, scopes, sheetId, page: 1, items, by });
  if (!res) return { ok: false, error: "That option was removed — refresh the page." };
  return { ok: true, ...res, needsPart: cards.reduce((n, c) => n + c.needsPart, 0) };
}
```

- [ ] **Step 5: The actions**

In `src/app/(app)/design/grid/[id]/actions.ts`:

(a) Imports: add `setAutoEstimate` to the `@/lib/stores/grid-projects` import list. Change the grid-intake import to `import { designPatchFromIntake, intakeScopeInputs } from "@/lib/design/grid-intake";`: `manualScopeInputs` is no longer used here, and leaving it would add a lint warning. Change `import { get as getPart } from "@/lib/stores/catalog";` to `import { get as getPart, getMany as getCatalogParts } from "@/lib/stores/catalog";` and add:

```ts
import { fillAutoScopes } from "@/lib/design/grid-auto-fill";
import { AUTO_SCOPES, autoEstimateCards, clampScopeInputs, priceOverrides, sellOnlyCards, type SellCard } from "@/lib/design/auto-estimate";
import { overrideRefs, sanitizeAutoEstimate, type AutoEstimate } from "@/lib/design/grid-auto-model";
import { buildEquipmentPriceTable, sellFromCost } from "@/lib/design/equipment-map";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates } from "@/lib/stores/pricing";
import { fixtureSkus, resolveFixture } from "@/lib/fixture-assemblies";
import { searchCatalog } from "@/app/(app)/estimator/actions";
```

(b) Directly **before** `saveGridIntakeAction`, add:

```ts
/**
 * The Equipment step's live cards (#GEM, spec §5): the equations for the
 * given scope inputs, priced at each scope's tier from the Equipment map (or
 * this design's swaps), SELL-ONLY — no unit cost crosses to the client. Reads
 * only the SKUs the map and the swaps reference.
 */
export async function previewAutoEstimateAction(input: {
  inputs: QuickScopeInputs;
  estimate: AutoEstimate;
}): Promise<{ ok: true; cards: SellCard[] } | { ok: false; error: string }> {
  await requireUser();
  if (!input?.inputs) return { ok: false, error: "Missing venue inputs." };
  const est = sanitizeAutoEstimate(input.estimate);
  const refs = overrideRefs(est);
  const { map, ctx } = await loadEquipPriceCtx({ extraSkus: refs.skus, extraFixtureIds: refs.assemblyIds });
  const cards = autoEstimateCards(clampScopeInputs(input.inputs), est, buildEquipmentPriceTable(map, ctx), priceOverrides(est.overrides, ctx));
  return { ok: true, cards: sellOnlyCards(cards) };
}

export type AutoEquipHit = { kind: "part" | "assembly"; ref: string; desc: string; unit: string; unitSell: number };

/**
 * Swap picker search (#GEM): catalog parts (server-side search, capped) and
 * fixtures/systems whose label matches — SELL numbers only.
 */
export async function searchAutoEquipmentAction(query: string): Promise<{ hits: AutoEquipHit[] }> {
  await requireUser();
  const q = String(query ?? "").trim();
  if (q.length < 2) return { hits: [] };
  const [{ hits }, fixtures, rates] = await Promise.all([searchCatalog(q, "", 15), listFixtures(), getCatalogRates()]);
  const m = rates.defaultMargin;
  const partHits: AutoEquipHit[] = hits
    .filter((h) => h.cost > 0 || h.list > 0)
    .map((h) => ({ kind: "part", ref: h.sku, desc: h.desc, unit: h.unit, unitSell: h.list > 0 ? h.list : sellFromCost(h.cost, m) }));
  const ql = q.toLowerCase();
  const matched = fixtures.filter((f) => `${f.label} ${f.description}`.toLowerCase().includes(ql)).slice(0, 10);
  const fxParts = matched.length ? await getCatalogParts([...new Set(matched.flatMap((f) => fixtureSkus(f)))]) : [];
  const asmHits: AutoEquipHit[] = matched.map((f) => {
    const r = resolveFixture(f, fxParts);
    return { kind: "assembly", ref: f.id, desc: `${f.label} (${f.kind})`, unit: "ea", unitSell: r.sell > 0 ? r.sell : sellFromCost(r.cost, m) };
  });
  return { hits: [...asmHits, ...partHits] };
}
```

(c) Replace `saveGridIntakeAction` (the whole function) with:

```ts
export async function saveGridIntakeAction(input: {
  projectId: string;
  /** "auto" = Auto (equations); "manual" = Blank (stored as before, D-GEM-7). */
  mode: "manual" | "auto";
  venueName: string;
  locationName: string;
  address: string;
  notes: string;
  autoConfig: AState;
  estimate?: AutoEstimate;
}): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.venueName.trim() && !input.locationName.trim()) return { ok: false, error: "Add a venue or location to continue." };
  if (input.mode !== "manual" && input.mode !== "auto") return { ok: false, error: "Choose Auto or Blank." };
  const scopeInputs = intakeScopeInputs(input.autoConfig);
  const autoScopes = input.mode === "auto" ? AUTO_SCOPES.filter((k) => scopeInputs.sys[k]) : [];
  if (input.mode === "auto" && autoScopes.length === 0) return { ok: false, error: "Pick at least one scope for Auto to fill." };
  const est: AutoEstimate | null =
    input.mode === "auto"
      ? (() => {
          const clean = sanitizeAutoEstimate(input.estimate);
          return {
            tierByScope: Object.fromEntries(autoScopes.map((k) => [k, clean.tierByScope[k] ?? "better"])),
            overrides: Object.fromEntries(Object.entries(clean.overrides).filter(([k]) => autoScopes.some((s) => k.startsWith(`${s}:`)))),
          };
        })()
      : null;
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
  // First-save gate (D145) — see the pre-#GEM comment: idempotent re-applies
  // first, generateBaseSheet (the sentinel) last. The Auto fill (#GEM) runs
  // after the sheet exists; if it fails the plan still opens, with a warning,
  // and "Change equipment…" re-fills.
  let warning: string | undefined;
  const isFirstSave = (saved.sheetIds || []).length === 0;
  if (isFirstSave) {
    await setScopeInputs(input.projectId, scopeInputs);
    if (est) await setAutoEstimate(input.projectId, est);
    const patch = designPatchFromIntake({
      projectName: project.name,
      venueName: input.venueName,
      locationName: input.locationName,
      a: input.autoConfig,
    });
    const linked = (await getAllDesigns()).filter((d) => d.gridProjectId === input.projectId);
    for (const d of linked) await updateDesign(d.id, patch);
    if (patch.name) await renameProject(input.projectId, patch.name);
    await generateBaseSheet(input.projectId, input.autoConfig, "#3a3f4a", user.name);
    if (est) {
      const fresh = await getProject(input.projectId);
      const res = fresh
        ? await fillAutoScopes(input.projectId, resolveOptionId(fresh, null), autoScopes, user.name)
        : ({ ok: false, error: "That design could not be found." } as const);
      if (!res.ok) warning = `The plan is ready, but Auto could not fill it: ${res.error} Use “Change equipment…” in the Scope panel to try again.`;
      else if (res.needsPart > 0)
        warning = `${res.needsPart} line${res.needsPart === 1 ? "" : "s"} still need${res.needsPart === 1 ? "s" : ""} a part in the Equipment map and ${res.needsPart === 1 ? "was" : "were"} left off the plan.`;
    }
  }
  revalidatePath(editorPath(input.projectId));
  revalidatePath("/design/designs");
  return { ok: true, ...(warning ? { warning } : {}) };
}
```

- [ ] **Step 6: The shared Equipment card (client)**

Create `src/app/(app)/design/grid/[id]/equipment-card.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import type { QuickScopeInputs, TierKey } from "@/app/(app)/design/quick/engine";
import type { SellCard, SellLine } from "@/lib/design/auto-estimate";
import { mergeScopeEstimate, type AutoEstimate, type AutoOverride } from "@/lib/design/grid-auto-model";
import { previewAutoEstimateAction, searchAutoEquipmentAction, type AutoEquipHit } from "./actions";

/**
 * The Auto Equipment step (#GEM, spec §5) — shared by the intake and the
 * Scope panel's "Change equipment…". Cards arrive SELL-ONLY from
 * previewAutoEstimateAction; every change re-prices on the server (debounced).
 * No effects: previews run from event handlers.
 */

const TIERS: Array<{ key: TierKey; label: string }> = [
  { key: "good", label: "Good" },
  { key: "better", label: "Better" },
  { key: "best", label: "Best" },
];
const SCOPE_LABEL: Record<string, string> = { rigging: "Rigging", curtains: "Curtains", lighting: "Lighting", audio: "Audio", video: "Video" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const INPUT: CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 7, padding: "5px 7px", fontSize: 12.5, fontFamily: "var(--font-mono)", background: "#fff", boxSizing: "border-box" };
const TAG: CSSProperties = { marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 6px" };
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const unitMoney = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The Equipment map row an unmapped line should be mapped on (Grid Settings → Equipment map). */
export const mapHref = (rowKey: string) => `/design/grid/settings/equipment-map#row-${rowKey.replace(":", "-")}`;

/** Server preview of the cards (sell-only), debounced. */
export function useAutoPreview(initial: SellCard[] | null = null) {
  const [cards, setCards] = useState<SellCard[] | null>(initial);
  const [error, setError] = useState("");
  const [loading, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = (inputs: QuickScopeInputs, estimate: AutoEstimate, delay = 0) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await previewAutoEstimateAction({ inputs, estimate });
          if (r.ok) {
            setCards(r.cards);
            setError("");
          } else setError(r.error);
        }),
      delay
    );
  };
  return { cards, error, loading, run };
}

export function EquipmentPicker({ onPick, onClose }: { onPick: (hit: AutoEquipHit) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AutoEquipHit[]>([]);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await searchAutoEquipmentAction(v);
          setHits(r.hits);
        }),
      250
    );
  };
  return (
    <div style={{ gridColumn: "1 / -1", border: "1px solid #eef0f3", borderRadius: 9, padding: 8, background: "#fafbfc", display: "grid", gap: 5 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input autoFocus value={q} onChange={(e) => change(e.target.value)} placeholder="Search catalog parts and assemblies…" style={{ ...INPUT, flex: 1, fontFamily: "inherit" }} />
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
      </div>
      {pending && <div style={{ fontSize: 11, color: "#8c919c" }}>Searching…</div>}
      {!pending && q.trim().length >= 2 && hits.length === 0 && <div style={{ fontSize: 11, color: "#8c919c" }}>No matches.</div>}
      {hits.map((h) => (
        <button key={`${h.kind}:${h.ref}`} type="button" onClick={() => onPick(h)} style={{ ...BTN, textAlign: "left", fontWeight: 500 }}>
          <span style={{ fontFamily: "var(--font-mono)" }}>{h.kind === "assembly" ? "Assembly" : h.ref}</span> — {h.desc}
          <span style={{ color: "#8c919c" }}> · {unitMoney(h.unitSell)}/{h.unit}</span>
        </button>
      ))}
    </div>
  );
}

export function EquipmentCard({
  card,
  estimate,
  onChange,
}: {
  card: SellCard;
  estimate: AutoEstimate;
  onChange: (next: AutoEstimate, delay?: number) => void;
}) {
  const [swapping, setSwapping] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const writeRow = (rowKey: string, o: AutoOverride, delay = 0) => {
    const overrides = { ...estimate.overrides };
    if (o.sku || o.assemblyId || o.qty !== undefined) overrides[rowKey] = o;
    else delete overrides[rowKey];
    onChange({ ...estimate, overrides }, delay);
  };
  const setTier = (tier: TierKey) => {
    setDraft({});
    // A tier pre-fills the whole card, so it resets this scope's swaps and qty edits (D-GEM-7).
    onChange(mergeScopeEstimate(estimate, card.scope, tier, {}));
  };
  const swap = (line: SellLine, hit: AutoEquipHit) => {
    const cur = estimate.overrides[line.rowKey];
    writeRow(line.rowKey, { ...(hit.kind === "part" ? { sku: hit.ref } : { assemblyId: hit.ref }), ...(cur?.qty !== undefined ? { qty: cur.qty } : {}) });
    setSwapping(null);
  };
  const setQty = (line: SellLine, raw: string) => {
    setDraft((d) => ({ ...d, [line.rowKey]: raw }));
    const n = Math.max(0, Math.round(Number(raw) || 0));
    const cur = estimate.overrides[line.rowKey] || {};
    const next: AutoOverride = {};
    if (cur.sku) next.sku = cur.sku;
    if (cur.assemblyId) next.assemblyId = cur.assemblyId;
    if (n !== line.eqQty) next.qty = n;
    writeRow(line.rowKey, next, 350);
  };
  const reset = (line: SellLine) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[line.rowKey];
      return next;
    });
    writeRow(line.rowKey, {});
  };

  return (
    <section style={{ border: "1px solid #ececf0", borderRadius: 12, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{SCOPE_LABEL[card.scope] ?? card.scope}</div>
        <div style={{ display: "flex", gap: 4 }}>
          {TIERS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTier(t.key)}
              style={{
                ...BTN,
                background: card.tier === t.key ? "var(--accent)" : "#fff",
                borderColor: card.tier === t.key ? "var(--accent)" : "#dfe2e8",
                color: card.tier === t.key ? "#fff" : "#3d424e",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700 }}>{money(card.total)}</span>
      </div>
      <div style={{ display: "grid", gap: 3, marginTop: 10 }}>
        {card.lines.map((l) => {
          const needs = l.status === "needs-part";
          const edited = l.swapped || l.qty !== l.eqQty;
          return (
            <div key={l.rowKey} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 118px 92px 92px auto", gap: 8, alignItems: "center", fontSize: 12.5, padding: "6px 8px", borderRadius: 8, background: needs ? "#fdf4e7" : "transparent" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {l.label}
                  {l.status === "allowance" && <span style={TAG}>Allowance</span>}
                </div>
                <div style={{ fontSize: 11, color: needs ? "#a0442b" : "#8c919c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {needs ? (
                    <>
                      Needs a part — {l.reason ?? "not mapped yet"} ·{" "}
                      <a href={mapHref(l.rowKey)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                        Map it
                      </a>
                    </>
                  ) : (
                    `${l.refDesc ?? l.ref ?? ""}${l.swapped ? " · swapped for this design" : ""}`
                  )}
                </div>
              </div>
              <span style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                <input
                  type="number"
                  min={0}
                  value={draft[l.rowKey] ?? String(l.qty)}
                  onChange={(e) => setQty(l, e.target.value)}
                  aria-label={`${l.label} quantity`}
                  style={{ ...INPUT, width: 70, textAlign: "right", borderColor: l.qty !== l.eqQty ? "var(--accent)" : "#e4e7ec" }}
                />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb" }}>{l.unit}</span>
              </span>
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}>{needs ? "—" : unitMoney(l.unitSell)}</span>
              <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>{needs ? "—" : money(l.total)}</span>
              <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setSwapping(swapping === l.rowKey ? null : l.rowKey)} style={BTN}>Swap…</button>
                {edited && <button type="button" onClick={() => reset(l)} title="Back to the equation and the map" style={BTN}>↺</button>}
              </span>
              {swapping === l.rowKey && <EquipmentPicker onPick={(hit) => swap(l, hit)} onClose={() => setSwapping(null)} />}
            </div>
          );
        })}
      </div>
      {card.needsPart > 0 && (
        <div style={{ fontSize: 11.5, color: "#a0442b", marginTop: 8 }}>
          {card.needsPart} line{card.needsPart === 1 ? "" : "s"} need{card.needsPart === 1 ? "s" : ""} a part: left off the plan and out of this total.
        </div>
      )}
    </section>
  );
}

export function EquipmentCards({
  cards,
  estimate,
  onChange,
  loading,
  error,
}: {
  cards: SellCard[] | null;
  estimate: AutoEstimate;
  onChange: (next: AutoEstimate, delay?: number) => void;
  loading: boolean;
  error: string;
}) {
  if (!cards) return <div style={{ fontSize: 13, color: error ? "#a0442b" : "#8c919c" }}>{error || "Pricing your equipment from the catalog…"}</div>;
  const grand = cards.reduce((s, c) => s + c.total, 0);
  const needs = cards.reduce((s, c) => s + c.needsPart, 0);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {cards.map((c) => (
        <EquipmentCard key={c.scope} card={c} estimate={estimate} onChange={onChange} />
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 2px" }}>
        <span style={{ color: needs ? "#a0442b" : "#1f7a52" }}>
          {needs ? `${needs} line${needs === 1 ? "" : "s"} still need a part (left off the plan)` : "Every line is priced from the catalog"}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
          Total {money(grand)}
          {loading ? " · updating…" : ""}
        </span>
      </div>
      {error && <div style={{ color: "#a0442b", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 7: The scope picker (client)**

Create `src/app/(app)/design/grid/[id]/scope-picker.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { SUBCFG, type AState } from "@/app/(app)/design/quick/engine";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";

/** The intake's scope list (#GEM, spec §5): the five Grid scopes, each with its sub-configuration. */
const LABEL: Record<string, string> = { rigging: "Rigging", curtains: "Curtains", lighting: "Lighting", audio: "Audio", video: "Video" };
const chip = (sel: boolean): CSSProperties => ({
  border: `1px solid ${sel ? "var(--accent)" : "#e4e7ec"}`,
  background: sel ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
  borderRadius: 7,
  padding: "5px 9px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
});

export default function ScopePicker({ value, onChange }: { value: AState; onChange: (patch: Partial<AState>) => void }) {
  const bag = value as unknown as Record<string, unknown>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {TRACKABLE_SYS_KEYS.map((k) => {
        const on = !!value.sys[k];
        const cfg = SUBCFG[k];
        return (
          <div key={k} style={{ border: "1px solid #e8eaee", borderRadius: 10, padding: "10px 12px", background: on ? "color-mix(in srgb, var(--accent) 5%, #fff)" : "#fff" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 650, cursor: "pointer" }}>
              <input type="checkbox" checked={on} onChange={(e) => onChange({ sys: { ...value.sys, [k]: e.target.checked } })} style={{ accentColor: "var(--accent)" }} />
              {LABEL[k] ?? k}
            </label>
            {on && cfg && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {cfg.options.map(([optKey, optLabel]) => {
                  const current = bag[cfg.stateKey];
                  const sel = cfg.mode === "single" ? current === optKey : !!(current as Record<string, boolean> | undefined)?.[optKey];
                  const pick = () =>
                    cfg.mode === "single"
                      ? onChange({ [cfg.stateKey]: optKey } as Partial<AState>)
                      : onChange({ [cfg.stateKey]: { ...((current as Record<string, boolean>) || {}), [optKey]: !sel } } as Partial<AState>);
                  return (
                    <button key={optKey} type="button" onClick={pick} style={chip(sel)}>
                      {optLabel}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8: The intake (client)**

Replace the whole content of `src/app/(app)/design/grid/[id]/grid-intake.tsx` with:

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
  venueOf,
  type AState,
  type DimField,
} from "@/app/(app)/design/quick/engine";
import { intakeScopeInputs } from "@/lib/design/grid-intake";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import { saveGridIntakeAction } from "./actions";
import ScopePicker from "./scope-picker";
import { EquipmentCards, useAutoPreview } from "./equipment-card";

/**
 * The one Grid intake (#GEM, spec §5 — replaces Spec 1's Manual-only intake):
 *   1. Start from — Auto (equations) or Blank.
 *   2. Venue — type, size, dimensions, scopes (the five Grid scopes with their
 *      sub-configuration), cover-page fields.
 *   3. (Auto only) Equipment — per scope Good / Better / Best, swaps, qty.
 * Blank opens the canvas on the generated base sheet; Auto also fills it.
 * Everything lands as ordinary, fully editable placements.
 */

type Start = "auto" | "blank";

function initialState(value?: AState): AState {
  if (value) return { ...value, sys: { ...value.sys } };
  const base = defaultAState(0);
  return { ...base, sys: { ...venueOf(base).sys } };
}

const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
const section = { borderTop: "1px solid #ececf0", paddingTop: 18, marginTop: 20 };
const label = { display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase" as const, marginBottom: 7, letterSpacing: ".06em" };
const card = (on: boolean): React.CSSProperties => ({
  textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: "pointer",
  background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
  border: `1.5px solid ${on ? "var(--accent)" : "#e8eaee"}`,
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [start, setStart] = useState<Start>("auto");
  const [venueName, setVenueName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [a, setA] = useState<AState>(() => initialState(initialAutoConfig));
  const [estimate, setEstimate] = useState<AutoEstimate>({ tierByScope: {}, overrides: {} });
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const preview = useAutoPreview();
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const scopeInputs = intakeScopeInputs(a);
  const chosen = TRACKABLE_SYS_KEYS.filter((k) => scopeInputs.sys[k]);
  const steps = start === "auto" ? 3 : 2;

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
  const changeEstimate = (next: AutoEstimate, delay = 0) => {
    setEstimate(next);
    preview.run(scopeInputs, next, delay);
  };
  const save = () =>
    startTransition(async () => {
      setError("");
      const saved = await saveGridIntakeAction({
        projectId,
        mode: start === "auto" ? "auto" : "manual",
        venueName,
        locationName,
        address,
        notes,
        autoConfig: a,
        ...(start === "auto" ? { estimate } : {}),
      });
      if (!saved.ok) setError(saved.error);
      else if (saved.warning) setWarning(saved.warning);
      else router.refresh();
    });
  const nextFromVenue = () => {
    setError("");
    if (!venueName.trim() && !locationName.trim()) return setError("Add a venue or location to continue.");
    if (start === "blank") return save();
    if (!chosen.length) return setError("Pick at least one scope for Auto to fill.");
    const est: AutoEstimate = {
      tierByScope: Object.fromEntries(chosen.map((k) => [k, estimate.tierByScope[k] ?? "better"])),
      overrides: estimate.overrides,
    };
    setEstimate(est);
    preview.run(scopeInputs, est);
    setStep(3);
  };

  const subtitle =
    step === 1
      ? "Start from the equations (Auto) or a blank plan. Either way you end up on the canvas, free to move, edit and delete anything."
      : step === 2
        ? "Venue type and measurements draw the plan sheet to scale; the scopes set what Auto fills and what the Scope panel tracks."
        : "Pick Good / Better / Best per scope. Swap any part for a catalog part or an assembly, and adjust quantities.";

  return (
    <div style={{ minHeight: "100%", background: "#f7f8fa", padding: "42px 22px" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)" }}>
          Design · New system design · Step {step} of {steps}
        </div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-.025em" }}>{projectName}</h1>
        <p style={{ margin: 0, color: "#737985", fontSize: 14, lineHeight: 1.55, maxWidth: 720 }}>{subtitle}</p>
        <div style={{ marginTop: 26, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, padding: 22, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
          {step === 1 && (
            <>
              <div style={label}>Start from</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button type="button" onClick={() => setStart("auto")} style={card(start === "auto")}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Auto (equations)</span>
                  <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    Good / Better / Best equipment per scope from the Equipment map, sized by your measurements and placed on the plan for you.
                  </span>
                </button>
                <button type="button" onClick={() => setStart("blank")} style={card(start === "blank")}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Blank</span>
                  <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    Start on the scaled plan and place catalog devices yourself. The Scope panel tracks placed $ against targets.
                  </span>
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
                <button type="button" onClick={() => setStep(2)} style={primary(false)}>Next: the venue →</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22 }}>
                <div>
                  <div style={label}>Venue type</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {VENUES.map((item) => (
                      <button key={item.key} type="button" onClick={() => setVenue(item.key)} style={card(item.key === a.venue)}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 650 }}>{item.label}</span>
                        <span style={{ display: "block", color: "#9aa0ab", fontSize: 11, marginTop: 2 }}>{item.sub}</span>
                      </button>
                    ))}
                  </div>
                  <div style={section}>
                    <div style={label}>Size of venue</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {SIZES.map(([key, text]) => (
                        <button key={key} type="button" onClick={() => update({ size: key, ...sizedDims(venue, key) })} style={{ ...card(key === a.size), flex: 1, textAlign: "center", fontWeight: 600 }}>
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={section}>
                    <div style={label}>Scopes</div>
                    <ScopePicker value={a} onChange={update} />
                  </div>
                </div>
                <div>
                  <div style={label}>Stage dimensions</div>
                  <div style={{ display: "grid", gap: 13 }}>
                    {(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => (
                      <label key={d.field}>
                        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}>
                          <span>{d.label}</span>
                          <span style={{ fontFamily: "var(--font-mono)", color: "#737985" }}>{a[d.field]} ft</span>
                        </span>
                        <span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{d.note}</span>
                        <input type="range" min={LIM[d.field][0]} max={LIM[d.field][1]} step={2} value={a[d.field]} onChange={(e) => setDimension(d.field, e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
                      </label>
                    ))}
                  </div>
                  <div style={section}>
                    <div style={{ ...label, marginBottom: 12 }}>Venue cover page</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <label><span style={label}>Location / campus</span><input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="High School" style={input} /></label>
                      <label><span style={label}>Venue / space</span><input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Main space" style={input} /></label>
                    </div>
                    <label style={{ display: "block", marginTop: 14 }}><span style={label}>Address</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state" style={input} /></label>
                    <label style={{ display: "block", marginTop: 14 }}><span style={label}>Design notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Audience, stage, access, existing system notes…" style={{ ...input, minHeight: 78, resize: "vertical" }} /></label>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "#737985" }}>
                {venue.label} · {a.width}&apos; × {a.depth}&apos; × {a.grid}&apos; · {a.size} · {chosen.length} scope{chosen.length === 1 ? "" : "s"}
              </div>
              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                <button type="button" onClick={() => setStep(1)} disabled={busy} style={ghost}>← Back</button>
                <button type="button" onClick={nextFromVenue} disabled={busy} style={{ ...primary(busy), flex: 1 }}>
                  {start === "auto" ? "Next: equipment →" : busy ? "Setting up your plan…" : "Continue to The Grid →"}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <EquipmentCards cards={preview.cards} estimate={estimate} onChange={changeEstimate} loading={preview.loading} error={preview.error} />
              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              {warning ? (
                <div style={{ marginTop: 16, border: "1px solid #f0dcbb", background: "#fdf4e7", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: "#7a5a1c" }}>
                  {warning}
                  <div style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => router.refresh()} style={primary(false)}>Open the plan →</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                  <button type="button" onClick={() => setStep(2)} disabled={busy} style={ghost}>← Back</button>
                  <button type="button" onClick={save} disabled={busy || !preview.cards} style={{ ...primary(busy), flex: 1 }}>
                    {busy ? "Building your plan…" : "Build the plan →"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: "New design" opens the Grid intake**

Create `src/components/design/new-design-button.tsx`:

```tsx
"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createManualDesignAction } from "@/app/(app)/design/designs/actions";

/**
 * "New design" (#GEM, spec §2.1): creates a Grid design and opens its one
 * intake (Auto or Blank). The Quick Design canvas is no longer a New design
 * entry point; existing Quick designs still open in /design/quick. Writes only
 * on click — never on render or prefetch.
 */
export function NewDesignButton({
  style,
  className,
  children,
  title,
}: {
  style: CSSProperties;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const create = () =>
    start(async () => {
      setError("");
      const res = await createManualDesignAction();
      if (res.ok) router.push(`/design/grid/${encodeURIComponent(res.gridProjectId)}`);
      else setError(res.error);
    });
  return (
    <button
      type="button"
      className={className}
      onClick={create}
      disabled={pending}
      title={error || title || "Start a new system design in The Grid"}
      style={{ border: "none", font: "inherit", textAlign: "inherit", ...style, cursor: pending ? "wait" : "pointer" }}
    >
      {pending ? "Starting…" : children}
    </button>
  );
}
```

In `src/app/(app)/design/designs/design-client.tsx`:
- delete the whole `NewDesignSplit` function with its doc comment (lines 91–167);
- remove `createManualDesignAction` from the `./actions` import;
- add `import { NewDesignButton } from "@/components/design/new-design-button";`;
- replace each of the three `<NewDesignSplit …>…</NewDesignSplit>` elements (lines 382, 652, 706) with `<NewDesignButton …>…</NewDesignButton>`, keeping the same `className`, `style` and children;
- in the third (the dashed "New design" tile), change the sub-line text `Quick canvas or manual layout in The Grid` to `Auto from the equations or a blank plan, in The Grid`;
- if tsc or eslint then reports an unused import (for example `ReactNode`), remove it.

In `src/app/(app)/home-my-designs.tsx`:
- add `import { NewDesignButton } from "@/components/design/new-design-button";`;
- replace both `<Link href="/design/quick" …>…</Link>` "New design" elements (lines 95 and 269) with `<NewDesignButton className=… style=…>…</NewDesignButton>`, dropping the `href` and keeping `className`, `style` and children;
- `Link` stays imported; the file still uses it for the design cards.

The Home greeting's "New estimate" and the pipeline's "Start a rough estimate" / "+ New rough estimate" links keep pointing at Quick Design (D-GEM-8). So does field-work's read-only view link.

- [ ] **Step 10: Run the pure specs**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'`
Expected: `ALL PASSED`, **4068** PASS lines (4063 + 5). The Task 5 guard walks every Grid client file, so it now also covers `equipment-card.tsx`, `scope-picker.tsx` and `grid-intake.tsx`.

- [ ] **Step 11: Write the DB regression block**

In `scripts/test-review-regressions.ts`, insert before the `/* --- #210 final review M5` block:

```ts
  /* --- #GEM T8: the Auto fill paints the generated base sheet from the Equipment map --- */
  {
    const GP = await import("@/lib/stores/grid-projects");
    const EM = await import("@/lib/stores/equipment-map");
    const Cat = await import("@/lib/stores/catalog");
    const Fx = await import("@/lib/stores/fixtures");
    const GC = await import("@/lib/stores/grid-catalog");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const { fillAutoScopes } = await import("@/lib/design/grid-auto-fill");
    const { intakeScopeInputs } = await import("@/lib/design/grid-intake");
    const { defaultAState, compute } = await import("@/app/(app)/design/quick/engine");
    const { resolveOptionId } = await import("@/lib/design/grid-options");
    const { buildGridQuote } = await import("@/lib/design/grid-quote");
    const by = "tester";
    await Cat.upsert({ sku: "GEM8-PAR", desc: "GEM8 LED par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    await Cat.upsert({ sku: "GEM8-VEL", desc: "GEM8 velour", category: "Fabric", unit: "sq ft", list: 0, cost: 0, curtainAreaRate: 3.5 });
    await Cat.upsert({ sku: "GEM8-MIX", desc: "GEM8 mixer", category: "Audio", unit: "ea", list: 7000, cost: 5000 });
    const sysIn = sanitizeFixtureInput({ kind: "system", label: "GEM8 mixer rack", description: "", scope: "Audio", parts: [{ sku: "GEM8-MIX", qty: 1 }] });
    if (!sysIn.ok) throw new Error(sysIn.error);
    const rack = await Fx.createFixture(sysIn.value, by, { cost: 5000, price: 7000, pricedAt: null });
    await EM.saveEquipmentRow("lighting:par", { sameAll: true, tiers: { good: { kind: "part", sku: "GEM8-PAR" } } }, by);
    await EM.saveEquipmentRow("curtains:draw", { sameAll: true, tiers: { good: { kind: "part", sku: "GEM8-VEL" } } }, by);
    await EM.saveEquipmentRow("audio:mixerDsp", { sameAll: true, tiers: { good: { kind: "assembly", id: rack.id } } }, by);
    await EM.saveEquipmentRow("audio:subwoofer", { sameAll: true, tiers: { good: { kind: "allowance", amount: 1200, confirmed: true } } }, by);
    const a = {
      ...defaultAState(0), venue: "school", size: "medium" as const, width: 40, depth: 30, grid: 24, wing: 12, ph: 20,
      sys: { rigging: false, curtains: true, lighting: true, controls: false, audio: true, video: false, acoustical: false, pit: false },
      drape: { draw: true, legs: false, border: false, scenerytrack: false, fullstage: false },
      fixtures: { par: true, front: false, cyc: false, side: false, automated: false },
    };
    const p0 = await GP.createProject({ name: "GEM8 auto", customer: "", customerId: null, by });
    await GP.saveGridIntake(p0.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main", locationName: "HS", address: "", notes: "", autoConfig: a });
    await GP.setScopeInputs(p0.id, intakeScopeInputs(a));
    await GP.setAutoEstimate(p0.id, { tierByScope: { lighting: "better", curtains: "better", audio: "better" }, overrides: {} });
    await GP.generateBaseSheet(p0.id, a, "#3a3f4a", by);
    let p = (await GP.getProject(p0.id))!;
    const opt = resolveOptionId(p, null);
    const res = await fillAutoScopes(p0.id, opt, ["lighting", "curtains", "audio"], by);
    assert.ok(res.ok, `#GEM T8: the fill runs (${res.ok ? "" : res.error})`);
    p = (await GP.getProject(p0.id))!;
    const eq = compute({ ...a, tier: "better" });
    const qtyOf = (key: string) => eq.systems.flatMap((s) => s.items).find((i) => i.key === key)!.qty;
    const autoPl = p.placements.filter((pl) => pl.auto);
    const placed = (key: string) => autoPl.filter((pl) => pl.auto!.rowKey === key).reduce((n, pl) => n + (pl.qty ?? 1), 0);
    assert.equal(placed("lighting:par"), qtyOf("lighting:par"), "#GEM T8: every par the equations call for is on the plan");
    assert.equal(placed("curtains:draw"), qtyOf("curtains:draw"), "#GEM T8: every draw the equations call for is on the plan");
    assert.ok(autoPl.filter((pl) => pl.auto!.rowKey === "curtains:draw").every((pl) => pl.curtain?.fabricSku === "GEM8-VEL" && pl.curtain.type === "Draw"), "#GEM T8: draws are curtain drop-ins on the mapped fabric");
    assert.equal(placed("audio:lineArray"), 0, "#GEM T8: an unmapped row is never placed — no fallback dollar, no placeholder");
    assert.ok(autoPl.some((pl) => pl.partId === `asm:${rack.id}`) && autoPl.some((pl) => pl.partId === "allow:audio:subwoofer:better"), "#GEM T8: the System assembly and the allowance land as virtual parts");
    assert.ok(autoPl.every((pl) => pl.sheetId === p.sheetIds[0] && pl.optionId === opt), "#GEM T8: everything lands on the generated base sheet, in the current option");
    assert.ok(res.ok && res.needsPart >= 1, "#GEM T8: the fill reports the needs-a-part lines");
    assert.ok(await GC.getGridSymbol("GEM8-PAR"), "#GEM T8: a mapped part gets its Grid library entry at fill time");
    const q = await buildGridQuote(p, opt);
    assert.ok(q.ok, "#GEM T8: the Auto design quotes");
    if (q.ok) {
      assert.ok(q.build.spec.lines.some((l) => l.allowance === true && l.qty === qtyOf("audio:subwoofer")), "#GEM T8: the allowance reaches the quote, flagged");
      assert.ok(q.build.value > 0, "#GEM T8: the quote carries value");
    }
    for (const k of ["lighting:par", "curtains:draw", "audio:mixerDsp", "audio:subwoofer"]) await EM.clearEquipmentRow(k);
  }

```

- [ ] **Step 12: DB regressions + types + lint**

Run: `env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -3; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `review regression checks passed`; tsc silent; eslint 0 errors, ≤ 110 warnings.

- [ ] **Step 13: Build + smoke**

Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next && npm run test:smoke 2>&1 | tail -5`
Expected: the build succeeds and every route is OK (`/design/designs` and `/` render with the new buttons).

- [ ] **Step 14: Commit**

```bash
git add src/lib/design/grid-auto-fill.ts src/lib/design/grid-intake.ts "src/app/(app)/design/grid/[id]" src/components/design/new-design-button.tsx "src/app/(app)/design/designs/design-client.tsx" "src/app/(app)/home-my-designs.tsx" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(grid): one intake — Auto (equations) or Blank — with the Equipment step and Auto fill; New design routes here (#GEM T8)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Scope panel for Auto designs — the chosen target and "Change equipment…"

**Files:**
- Create: `src/app/(app)/design/grid/[id]/refill-dialog.tsx`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`refillScopeAction`)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (sell-only Auto cards + targets)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (prop `auto`, passed to the Scope panel with the option id)
- Modify: `src/app/(app)/design/grid/[id]/scope-panel.tsx` (Auto rows: chosen tier target, needs-a-part count, "Change equipment…")
- Test: `scripts/test-review-and-spec.ts` (append at EOF); `scripts/test-review-regressions.ts` (a new block before `#210 final review M5`)

**Interfaces:**
- Consumes (Tasks 4–8): `autoEstimateCards`, `priceOverrides`, `sellOnlyCards`, `autoTargets`, `SellCard`, `ScopeTargets`, `AutoEstimate`, `AutoOverride`, `mergeScopeEstimate`, `isTierKey`, `setAutoEstimate`, `fillAutoScopes`, `EquipmentCard`, `useAutoPreview`, `ConfirmButton`; `equipTable` / `equipCtx` in the page.
- Produces:
  - `refillScopeAction({ projectId, optionId, scope: SysKey, tier: TierKey, overrides: Record<string, AutoOverride> }): Promise<{ ok: true; added; removed; needsPart } | { ok: false; error }>`
  - `GridEditor` prop `auto: { estimate: AutoEstimate; cards: SellCard[]; targets: ScopeTargets } | null`
  - `ScopePanel` props `optionId: string`, `auto: { … } | null`
  - `RefillDialog` (default export)

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- #GEM T9: "Change equipment…" on Auto scopes --- */
{
  const dir = "src/app/(app)/design/grid/[id]";
  const sp9 = readFileSync(join(process.cwd(), `${dir}/scope-panel.tsx`), "utf8");
  const rd9 = readFileSync(join(process.cwd(), `${dir}/refill-dialog.tsx`), "utf8");
  const act9 = readFileSync(join(process.cwd(), `${dir}/actions.ts`), "utf8");
  const pg9 = readFileSync(join(process.cwd(), `${dir}/page.tsx`), "utf8");
  ok(sp9.includes("Change equipment…") && sp9.includes("auto?.targets") && sp9.includes("<RefillDialog"), "#GEM T9: Auto scopes show their chosen target and a Change equipment… button");
  ok(rd9.startsWith('"use client"') && rd9.includes("<ConfirmButton") && rd9.includes("refillScopeAction(") && !gemValueImports(rd9).some((m) => /\/auto-estimate$|\/equipment-pricing$|^@\/lib\/stores\/|^@\/db\//.test(m)), "#GEM T9: the re-fill is confirmed (ConfirmButton) and the dialog imports no pricing/store value");
  const refillBody = act9.slice(act9.indexOf("export async function refillScopeAction"));
  ok(refillBody.includes("mergeScopeEstimate(") && refillBody.includes("fillAutoScopes(") && refillBody.includes("hasOption(") && pg9.includes("sellOnlyCards(autoCards)"), "#GEM T9: a re-fill merges one scope's choices and re-fills that scope in the current option; the page sends sell-only cards");
}
```

This block has **3** `ok(` calls. In `scripts/test-review-regressions.ts`, insert before the `/* --- #210 final review M5` block:

```ts
  /* --- #GEM T9: a per-scope re-fill keeps hand-touched devices and honours the new choices --- */
  {
    const GP = await import("@/lib/stores/grid-projects");
    const EM = await import("@/lib/stores/equipment-map");
    const Cat = await import("@/lib/stores/catalog");
    const { fillAutoScopes } = await import("@/lib/design/grid-auto-fill");
    const { intakeScopeInputs } = await import("@/lib/design/grid-intake");
    const { mergeScopeEstimate } = await import("@/lib/design/grid-auto-model");
    const { defaultAState } = await import("@/app/(app)/design/quick/engine");
    const { resolveOptionId } = await import("@/lib/design/grid-options");
    const by = "tester";
    await Cat.upsert({ sku: "GEM9-PAR", desc: "GEM9 LED par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    await EM.saveEquipmentRow("lighting:par", { sameAll: true, tiers: { good: { kind: "part", sku: "GEM9-PAR" } } }, by);
    const a = {
      ...defaultAState(0), venue: "school", size: "medium" as const, width: 40, depth: 30, grid: 24, wing: 12, ph: 20,
      sys: { rigging: false, curtains: false, lighting: true, controls: false, audio: false, video: false, acoustical: false, pit: false },
      fixtures: { par: true, front: false, cyc: false, side: false, automated: false },
    };
    const p0 = await GP.createProject({ name: "GEM9 refill", customer: "", customerId: null, by });
    await GP.saveGridIntake(p0.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main", locationName: "", address: "", notes: "", autoConfig: a });
    await GP.setScopeInputs(p0.id, intakeScopeInputs(a));
    await GP.setAutoEstimate(p0.id, { tierByScope: { lighting: "better" }, overrides: {} });
    await GP.generateBaseSheet(p0.id, a, "#3a3f4a", by);
    let p = (await GP.getProject(p0.id))!;
    const opt = resolveOptionId(p, null);
    assert.ok((await fillAutoScopes(p0.id, opt, ["lighting"], by)).ok, "#GEM T9: first fill");
    p = (await GP.getProject(p0.id))!;
    const pars = p.placements.filter((pl) => pl.auto?.rowKey === "lighting:par");
    assert.ok(pars.length > 2, "#GEM T9: pars were placed");
    await GP.movePlacement(p0.id, pars[0].id, { x: 0.5, y: 0.5 });
    await GP.setAutoEstimate(p0.id, mergeScopeEstimate(p.autoEstimate!, "lighting", "best", { "lighting:par": { qty: 4 } }));
    const res = await fillAutoScopes(p0.id, opt, ["lighting"], by);
    assert.ok(res.ok && res.removed === pars.length - 1 && res.added === 4, `#GEM T9: the re-fill replaced only the untouched pars (${JSON.stringify(res)})`);
    p = (await GP.getProject(p0.id))!;
    const moved = p.placements.find((pl) => pl.id === pars[0].id);
    assert.ok(moved && !moved.auto && moved.x === 0.5, "#GEM T9: the hand-moved par stays where it was put");
    const fresh = p.placements.filter((pl) => pl.auto?.rowKey === "lighting:par");
    assert.ok(fresh.length === 4 && fresh.every((pl) => pl.auto!.tier === "best"), "#GEM T9: the new pars follow the new tier and the edited quantity");
    assert.deepEqual(p.autoEstimate, { tierByScope: { lighting: "best" }, overrides: { "lighting:par": { qty: 4 } } }, "#GEM T9: the choices are saved, so Change equipment… re-opens with them");
    await EM.clearEquipmentRow("lighting:par");
  }

```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: FAIL: `refill-dialog.tsx` does not exist (ENOENT from `readFileSync`).

- [ ] **Step 3: The re-fill action**

In `src/app/(app)/design/grid/[id]/actions.ts`:
- change the engine type import on line 6 to `import type { QuickScopeInputs, SysKey, TierKey } from "@/app/(app)/design/quick/engine";`;
- add `isTierKey` to the `@/lib/design/equipment-map` import;
- add `mergeScopeEstimate` and `type AutoOverride` to the `@/lib/design/grid-auto-model` import;

then append at EOF:

```ts
/**
 * "Change equipment…" (#GEM, spec §5): re-choose ONE Auto scope's tier,
 * swaps and quantities, save them on the project, and re-fill only that
 * scope in this option. Untouched Auto devices are replaced; devices moved or
 * edited by hand stay. The UI confirms first (ConfirmButton).
 */
export async function refillScopeAction(input: {
  projectId: string;
  optionId: string;
  scope: SysKey;
  tier: TierKey;
  overrides: Record<string, AutoOverride>;
}): Promise<{ ok: true; added: number; removed: number; needsPart: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(input.projectId);
  if (!project) return { ok: false, error: "Design not found." };
  if (!hasOption(project, input.optionId)) return { ok: false, error: OPTION_GONE };
  const est = project.autoEstimate;
  if (!est || !est.tierByScope[input.scope]) return { ok: false, error: "Only Auto scopes can be re-filled." };
  if (!isTierKey(input.tier)) return { ok: false, error: "Pick Good, Better or Best." };
  await setAutoEstimate(input.projectId, mergeScopeEstimate(est, input.scope, input.tier, input.overrides || {}));
  const res = await fillAutoScopes(input.projectId, input.optionId, [input.scope], user.name);
  if (!res.ok) return res;
  revalidatePath(editorPath(input.projectId));
  return res;
}
```

- [ ] **Step 4: Sell-only Auto cards from the page**

In `src/app/(app)/design/grid/[id]/page.tsx`, add `import { autoEstimateCards, autoTargets, priceOverrides, sellOnlyCards } from "@/lib/design/auto-estimate";`. After the `scopeTargets` const, add:

```ts
  // Auto designs (#GEM): the chosen cards, priced server-side; the editor gets sell-only lines + targets.
  const autoCards =
    project.autoEstimate && project.scopeInputs
      ? autoEstimateCards(project.scopeInputs, project.autoEstimate, equipTable, priceOverrides(project.autoEstimate.overrides, equipCtx))
      : null;
  const auto =
    autoCards && project.autoEstimate
      ? { estimate: project.autoEstimate, cards: sellOnlyCards(autoCards), targets: autoTargets(autoCards) }
      : null;
```

and pass `auto={auto}` to `<GridEditor …>`.

- [ ] **Step 5: Thread it through the editor**

In `src/app/(app)/design/grid/[id]/editor.tsx`:
- add `import type { SellCard } from "@/lib/design/auto-estimate";`, `import type { AutoEstimate } from "@/lib/design/grid-auto-model";`, and extend the scope-targets type import to `import type { ScopeTargets, ScopeTargetsByTier } from "@/lib/design/scope-targets";`;
- add `auto,` to the destructured props and to the props type:

```ts
  /** Auto designs (#GEM): the chosen cards (sell-only) + their targets; null for Blank. */
  auto: { estimate: AutoEstimate; cards: SellCard[]; targets: ScopeTargets } | null;
```

- on `<ScopePanel …>`, add `optionId={activeOptionId}` and `auto={auto}`.

- [ ] **Step 6: Create the re-fill dialog**

Create `src/app/(app)/design/grid/[id]/refill-dialog.tsx`:

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import type { QuickScopeInputs, SysKey } from "@/app/(app)/design/quick/engine";
import type { SellCard } from "@/lib/design/auto-estimate";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import { ConfirmButton } from "@/components/confirm-button";
import { EquipmentCard, useAutoPreview } from "./equipment-card";
import { refillScopeAction } from "./actions";

/**
 * "Change equipment…" (#GEM, spec §5) — re-opens one Auto scope's card with
 * the last choices, re-prices on the server as it changes, and re-fills only
 * that scope on Apply (confirmed). Sell-only throughout.
 */
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };

export default function RefillDialog({
  projectId,
  optionId,
  scope,
  inputs,
  estimate: initial,
  initialCards,
  onClose,
  onDone,
  onError,
}: {
  projectId: string;
  optionId: string;
  scope: SysKey;
  inputs: QuickScopeInputs;
  estimate: AutoEstimate;
  initialCards: SellCard[];
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [estimate, setEstimate] = useState<AutoEstimate>(() => ({
    tierByScope: { [scope]: initial.tierByScope[scope] ?? "better" },
    overrides: Object.fromEntries(Object.entries(initial.overrides).filter(([k]) => k.startsWith(`${scope}:`))),
  }));
  const preview = useAutoPreview(initialCards.filter((c) => c.scope === scope));
  const card = preview.cards?.find((c) => c.scope === scope) ?? null;
  const change = (next: AutoEstimate, delay = 0) => {
    setEstimate(next);
    preview.run(inputs, next, delay);
  };
  const apply = async () => {
    const r = await refillScopeAction({ projectId, optionId, scope, tier: estimate.tierByScope[scope] ?? "better", overrides: estimate.overrides });
    if (!r.ok) onError(r.error);
    else onDone();
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change equipment"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(22,24,29,.38)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(880px, 100%)", maxHeight: "86vh", overflow: "auto", background: "#f7f8fa", borderRadius: 14, padding: 18, boxShadow: "0 18px 50px rgba(0,0,0,.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Change equipment</div>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={BTN}>Close</button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>
          Re-fills only this scope in the current option. Devices you moved or edited by hand stay where they are; the untouched Auto devices are replaced.
        </p>
        {card ? (
          <EquipmentCard card={card} estimate={estimate} onChange={change} />
        ) : (
          <div style={{ fontSize: 13, color: preview.error ? "#a0442b" : "#8c919c" }}>{preview.error || "Pricing…"}</div>
        )}
        {preview.loading && <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6 }}>Updating…</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={BTN}>Cancel</button>
          <ConfirmButton
            label="Apply & re-fill"
            confirmLabel="Replace this scope's untouched Auto devices?"
            pendingLabel="Re-filling…"
            disabled={!card || preview.loading}
            style={PRIMARY}
            onConfirm={apply}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Auto rows in the Scope panel**

In `src/app/(app)/design/grid/[id]/scope-panel.tsx`:
- add the imports `import type { SellCard } from "@/lib/design/auto-estimate";` and `import type { AutoEstimate } from "@/lib/design/grid-auto-model";`, extend the targets type import to `import type { ScopeTargets, ScopeTargetsByTier } from "@/lib/design/scope-targets";`, and add `import RefillDialog from "./refill-dialog";`;
- props: add `optionId,` and `auto,` to the destructure, and to the type:

```ts
  /** The active option (a re-fill paints only this option). */
  optionId: string;
  /** Auto designs (#GEM): chosen tiers + sell-only cards and targets; null for Blank. */
  auto: { estimate: AutoEstimate; cards: SellCard[]; targets: ScopeTargets } | null;
```

- add state under `tierKey`: `const [refill, setRefill] = useState<SysKey | null>(null);`
- replace the tracked-rows map (the `trackedKeys.map((k) => { … <ProgressRow … /> … })` block) with:

```tsx
            {trackedKeys.map((k) => {
              const scopeKey = SYS_TO_GRID_SCOPE[k]!;
              const placed = placedByKey.get(scopeKey)?.value || 0;
              const autoTier = auto?.estimate.tierByScope[k];
              const t = autoTier ? auto?.targets[k] : tierTargets[k];
              return (
                <div key={k} style={{ display: "grid", gap: 4 }}>
                  <ProgressRow
                    label={autoTier ? `${SHORT[k]} · Auto ${TIERS.find((x) => x.key === autoTier)?.label ?? ""}` : SHORT[k]}
                    color={scopeColor(scopeKey)}
                    placed={placed}
                    target={t?.sell || 0}
                    needsPart={t?.needsPart || 0}
                    allowances={t?.allowances || 0}
                  />
                  {autoTier && scopeInputs && (
                    <button type="button" onClick={() => setRefill(k)} style={{ ...BTN, justifySelf: "start", padding: "3px 9px", fontSize: 11 }}>
                      Change equipment…
                    </button>
                  )}
                </div>
              );
            })}
```

- just before the panel's final `</div>`, add:

```tsx
      {refill && auto && scopeInputs && (
        <RefillDialog
          projectId={projectId}
          optionId={optionId}
          scope={refill}
          inputs={scopeInputs}
          estimate={auto.estimate}
          initialCards={auto.cards}
          onClose={() => setRefill(null)}
          onDone={() => {
            setRefill(null);
            onChanged();
          }}
          onError={onError}
        />
      )}
```

The tier lens buttons stay: they drive the targets of Blank scopes. An Auto scope always shows its own chosen tier.

- [ ] **Step 8: Run everything for this task**

Run: `npm run test:specs 2>&1 | tail -3; npm run test:specs 2>&1 | grep -c '^PASS'; env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -3; npx tsc --noEmit && npx eslint 2>&1 | tail -2`
Expected: `ALL PASSED`, **4071** PASS lines (4068 + 3); `review regression checks passed`; tsc silent; eslint 0 errors, ≤ 110 warnings.

- [ ] **Step 9: Build + smoke**

Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5 && rm -rf .next && npm run test:smoke 2>&1 | tail -5`
Expected: the build succeeds and every route is OK.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/design/grid/[id]" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(grid): Auto scopes in the Scope panel — chosen targets, Change equipment… re-fill (#GEM T9)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs and the full gates

**Files:**
- Modify: `DECISIONS.md` (append D-GEM-1 … D-GEM-9 at EOF)
- Modify: `PUNCHLIST.md` (append the `## GEM.` entry at EOF)
- Modify: `AGENTS.md` (phase 17 after phase 16)

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Decisions**

Append to `DECISIONS.md`:

```markdown
## D-GEM-1. The equation vocabulary is 46 stable `system:itemKey` rows; the scenery track is measured in feet (#GEM, 2026-09-25)

`src/lib/design/equipment-vocab.ts` lists every item `compute()` can emit — 16 rigging, 5 curtains, 5 lighting,
9 controls, 3 audio, 3 video, 3 acoustical, 2 pit — keyed `system:itemKey`, labelled with the equation's own item
name. The spec's "~60" was an estimate; the #GEM T1 spec block pins the set both ways (every emitted key has a row,
every row is emitted by some configuration). The only quantity change: the scenery track now emits feet (depth blocks ×
pipe-rule length) instead of "ea at pipe length × $3", so a per-foot catalog track can price it.

## D-GEM-2. The Equipment map is one settings blob with one top-level key per row (#GEM, 2026-09-25)

Blob `grid_equipment_map`, `{ [rowKey]: { tiers: {good, better, best}, sameAll?, updatedBy, updatedAt } }` — flattened
from the spec's `{ rows: … }` so `setBlob`'s atomic per-key jsonb merge keeps two admins' edits to different rows
independent. "Same for all tiers" saves the Good cell into all three and reads Good. An allowance can only be saved
with "I confirm this allowance" ticked; `confirmedBy/At` are re-stamped only when its amount or note changes. Editing is
`manage_users` (the Estimating Rules gate). The map starts empty; the go-live reset keeps it (blobs are configuration).

## D-GEM-3. Pricing from the map, and nothing else (#GEM, 2026-09-25)

Part: live cost; sell = list, or cost ÷ (1 − `catalog_rates.defaultMargin`) when the part has no list. Assembly:
`resolveFixture` included cost / sell. Allowance: the confirmed amount is a unit cost, sold like a list-less part.
Fabric rows: the mapped Fabric part's `curtainAreaRate ?? costPerSqft` with the shared two-term model and
`makingRateFor()` — no `SEED_FABRIC_RATES` fallback. Anything else — empty, unconfirmed, a deleted or unpriced part, an
assembly on a fabric row — is "needs a part": listed, counted, never summed, never placed. `SEED_FABRIC_RATES` stays
for the Estimator, the portal and Grid curtain drop-ins, which read the catalog rate first (other features).

## D-GEM-4. The estimate engine carries no dollars (#GEM, 2026-09-25)

`compute()` emits keys + quantities; `src/lib/design/equipment-pricing.ts` (`applyEquipment`, `tierSystems`) is the
only pricing step and is never imported by a Grid client file (walked by a spec guard). `TIER_SKUS`, every `cost:`
literal, the screen's `width × 260`, the scenery $3/ft and the engine's seed fabric rates are gone from every total;
they survive as "was $X" hints in the server-only `equipment-legacy-hints.ts`. Every system is priced per tier, so the
old tier cost/price multipliers are inert. Quick Design and the Designs dashboard price through the same table
(server-built); a Quick Design fixture pick is a per-row override. Known: a saved Quick Design qty override that was
keyed by an assembly's name (pre-#GEM the item took the assembly's name) no longer matches; the equation name is the key now.

## D-GEM-5. Scope targets are computed on the server, sell-only (supersedes D139's accepted crossing) (#GEM, 2026-09-25)

`grid/[id]/page.tsx` prices Good / Better / Best per scope from the map (`scope-targets.ts`) and sends only sell
numbers plus needs-a-part / allowance counts; `engineFabrics` and the in-browser `scopeTargets()` are gone, so the
Grid bundle carries no cost data beyond the `PartLite.cost` it already carried. Targets use `tierDefsDefault()`: the
per-browser line-sets dial no longer moves Grid targets. While the map is empty a Blank design's targets read
"no target" with a needs-a-part count — expected until the rows are mapped.

## D-GEM-6. Auto placements: lots, the auto tag, virtual assembly / allowance parts (#GEM, 2026-09-25)

Count / length hardware (and any row over 120 units) lands as ONE placement carrying `qty`; BOM, schedule, riser and
space rollups multiply by `placementQty()`, labor suggestions count the marker once. Auto placements carry
`auto: { scope, rowKey, tier }`; a move or category edit deletes it, so re-fills keep hand-touched devices.
Assemblies and allowances are ordinary placements with virtual ids `asm:<fixtureId>` / `allow:<rowKey>:<tier>`,
resolved live server-side into `PartLite` rows (so every existing BOM / riser / set / schedule / quote path works);
an allowance no longer confirmed prices $0 and says so. The quote's spec line carries `allowance: true`; customer
documents print the line normally. A curtain pair lands as one drape of the pair's combined width (price-identical).
Mapped catalog parts get a Grid library entry at fill time (`ensureGridSymbolsFor`, insert-if-absent).

## D-GEM-7. One intake: Auto (equations) or Blank (#GEM, 2026-09-25)

Start from → Venue (type, size, dims, the five Grid scopes with their sub-configuration, cover page) → Equipment
(Auto only). Blank stores `intake.mode = "manual"` (existing docs unchanged). Auto scopes are the five Grid scopes;
the Controls / Acoustical / Pit rows are priced for Quick Design but never Auto-filled. A tier pick resets that
scope's swaps and qty edits. Equations run on the live `scopeInputs`; geometry comes from `intake.autoConfig` (what
the base sheet was drawn from); fills land on `sheetIds[0]` in the current option. The first fill runs inside the
first-save gate after `generateBaseSheet`; a failure opens the plan with a warning and "Change equipment…"
re-fills. `autoEstimate` is per project; a re-fill updates it and paints only the active option.

## D-GEM-8. "New design" opens the Grid intake; the seeder is gone (#GEM, 2026-09-25)

Every control labelled New design (Designs dashboard ×3, Home › My designs ×2) creates a Grid design and opens the
intake. "New estimate" / "Start a rough estimate" still open Quick Design, which remains for existing designs.
`seedStartingLayoutAction` and `deriveSeedPlacements` are removed (D186 kept them for this); the placeholder helpers
stay for the quote guard.

## D-GEM-9. The Equipment map is a Grid Settings sub-route; suggestions load on demand (#GEM, 2026-09-25)

`/design/grid/settings/equipment-map`, with a General | Equipment map tab strip on both pages — the General page does a
whole-catalog port-rules pass the map must not pay for. The page reads the map, every fixture / system and only the
SKUs they reference (one `getMany`); part search and "Suggest" (old fabric SKUs first, then search-word matches)
are server actions, one catalog pass per click.
```

- [ ] **Step 2: Punch list**

Append to `PUNCHLIST.md`:

```markdown
## GEM. The Grid — Equipment map (catalog-backed, no silent allowances) + one intake: Auto or Blank — DONE 2026-09-25 (D-GEM-1…D-GEM-9)

**Spec:** `docs/superpowers/specs/2026-09-25-grid-equipment-map-and-auto-intake-design.md` · **Plan:**
`docs/superpowers/plans/2026-09-25-grid-equipment-map-and-auto-intake.md` · **Follows:** #210, D139, D147, D149, D186.

**Shipped.** Grid Settings → **Equipment map** maps every equation item (46 rows) × Good / Better / Best to a catalog
part, a fixture / System assembly, or a confirmed allowance (who / when), with the old built-in figure as a "was $X"
hint and on-demand suggested matches; rows read Mapped / Allowance / Needs a part. The hard-coded dollars left the
estimate: Quick Design, the Designs dashboard and the Grid's Scope targets all price through the map (server-side,
sell-only to the Grid). **New design** opens one intake: **Auto (equations)** or **Blank** → venue, measurements and
scopes → (Auto) an Equipment step per scope (tier, swap any line for a catalog part or assembly, edit any quantity,
running totals, needs-a-part lines with "Map it") → the canvas, filled by rule on the generated base sheet with
ordinary editable placements. "Change equipment…" in the Scope panel re-fills one scope, keeping hand-touched devices.
Allowances reach the quote flagged internally.

**Remaining (Jeff-gated):** map the rows — Lighting, Audio and Rigging first (Auto leaves every unmapped line off the
plan and says so); pick per-foot parts for pipe / cable / handline / scenery track; decide whether the video screen,
pit and shell rows get parts or confirmed allowances. Then run one Auto design end-to-end on a preview and check the
placements and the quote.
```

- [ ] **Step 3: AGENTS phase line**

In `AGENTS.md`, insert after the phase 16 paragraph (it ends "…Decisions D294–D300; punch item #210."):

```markdown
17. ✅ **Grid Equipment map + one intake** (#GEM, D-GEM-1…D-GEM-9) — every
    equation item (`src/lib/design/equipment-vocab.ts`, 46 `system:itemKey`
    rows) × tier maps to a catalog part, a fixture/System assembly or a
    confirmed allowance in Grid Settings → Equipment map (blob
    `grid_equipment_map`, `src/lib/design/equipment-map.ts`); the estimate
    engine carries no dollars — `src/lib/design/equipment-pricing.ts` is the
    only pricing step, and Grid Scope targets are computed server-side,
    sell-only. New design opens one intake — Auto (equations) or Blank — and
    Auto fills the base sheet by rule (`grid-auto-layout.ts`,
    `grid-auto-fill.ts`) with ordinary placements (lots carry `qty`;
    assemblies/allowances are virtual `asm:`/`allow:` parts; `auto` tag
    cleared by any hand edit; "Change equipment…" re-fills one scope).
    Remaining is Jeff-gated: mapping the rows. Punch item #GEM.
```

- [ ] **Step 4: The full gates**

Run each and record the real numbers:

```bash
npx tsc --noEmit; echo "tsc exit $?"
npx eslint 2>&1 | tail -2
npm run test:specs 2>&1 | tail -2; npm run test:specs 2>&1 | grep -c '^PASS'
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
npm run test:smoke 2>&1 | tail -3
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -5; rm -rf .next
git status --short   # next-env.d.ts and .env.local must NOT appear (gitignored)
```

Expected: `tsc exit 0`; `✖ 110 problems (0 errors, 110 warnings)` or fewer warnings; `ALL PASSED` with **4071** PASS lines (baseline 3950 + 124 new − 3 retired = 4071); `review regression checks passed`; every smoke route OK; build succeeds; `git status` shows only the doc files. If a PASS count differs, reconcile it against each task's stated `ok(` count before continuing. Never paper over a difference.

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs: Grid Equipment map + one intake (#GEM), D-GEM-1…D-GEM-9, AGENTS phase 17" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
