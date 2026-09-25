# Grid — Equipment map (catalog-backed, no silent allowances) + one intake: Auto or Blank

**Date:** 2026-09-25 · **Status:** approved by Jeff (brainstorm, 2026-09-25) · **Replaces:** Spec 2 of the 2026-09-21
Grid roadmap (`docs/superpowers/specs/2026-09-21-grid-options-and-intake-branch-design.md` §table) ·
**Depends on:** the one assembly builder (`2026-09-25-fixture-builder-merge-design.md`, incl. its System type) —
build after it merges.

## 1. Goal

Jeff: "What we ultimately need is the ability to select from the auto equations or a blank space. Then you use the
venue type and input the measurements and scopes. If it is auto then you select your equipment you want for the scopes
that autofill; if it is blank you go straight to the canvas. Both end up on the canvas being able to move and edit the
symbols and delete things." And: "build this out officially so that there is no more allowance for anything … I want
as much as possible to reference the catalog for all of the items we use."

Today: Auto is a greyed "Next release" card in the Grid intake (D186); the equations in
`src/app/(app)/design/quick/engine.ts` price ~60 distinct items across 8 systems from **hard-coded dollars**
(`TIER_SKUS` desc→$ per tier, rigging/control `cost:` literals, `SEED_FABRIC_RATES`), and Manual's Scope panel reads
the same numbers (D139).

## 2. Decisions

1. **One intake**, two starts: **Auto (equations)** or **Blank**. Both ask venue type, measurements, scopes; Blank
   goes to the canvas; Auto adds an Equipment step, then fills the canvas. Everything lands as ordinary, fully editable
   Grid placements. "New design" routes here; the Quick Design canvas retires from "New design".
2. **Equipment step:** per scope, pick **Good / Better / Best** → pre-fills parts + equation quantities; any part
   swappable (catalog part or assembly), any qty editable; running $ per scope.
3. **Placement:** rule-based positions on the generated base sheet (§5).
4. **Re-fill per scope:** "Change equipment…" re-opens that scope's card and re-fills only that scope; devices moved or
   edited by hand are kept, untouched auto devices are replaced.
5. **Equipment map** (Grid Settings tab): every equation item × tier → a **catalog part or assembly**. Where none
   exists, a **confirmed allowance** ($ + who/when) is allowed and flagged; unconfirmed rows ("Needs a part") are left
   out of Auto and listed. **The hard-coded dollars leave the code.**
6. **Bundles** ("Digital mixer, DSP & amplifiers", "Video processor & switcher", "Distro system", …) map to **System
   assemblies** from the one builder.

## 3. Equipment map

**Rows** = the equation's item vocabulary, keyed `system:itemKey` (stable keys, not display text), grouped by scope:
Rigging (Electric hoist, Low/High-capacity hoist, Variable-speed hoist, Rigging point, Pipe /ft, Aircraft cable /ft,
Chain wrap, Termination kit, Headblock, Footblock, Arbor, T-bar track, Lock rail, Handline /ft, Loftblock), Curtains
(each fabric row; making labor stays a rate in Estimating Rules), Lighting (Par, Front, Cyc, Side light, Automated),
Controls (Console, Console touch screen, Battery backup, Processor, Button, Architectural touch screen, Input/Output
station, Distro system), Audio, Video, Acoustical, Pit — the exact list is extracted from `engine.ts` in the plan.

**Cell** (per tier): `{ kind: "part", sku } | { kind: "assembly", id } | { kind: "allowance", amount, confirmedBy,
confirmedAt, note? } | empty`. Row switch **"Same for all tiers"**. Row status: **Mapped** (all tiers part/assembly),
**Allowance** (any tier confirmed allowance), **Needs a part** (any tier empty).

**Storage:** one settings blob `grid_equipment_map` (like `travel_rates`), `{ rows: Record<rowKey, { tiers: {good,
better, best}, sameAll?: boolean, updatedBy, updatedAt }> }`. Editing: anyone with the rates permission used by
Estimating Rules; every change stamps who/when.

**Help filling it:** each row shows the old built-in figure as a hint ("was $7,000") and **suggested catalog matches**
(search by the row's description + scope's trades). Nothing is pre-mapped automatically.

**Pricing from the map:** part → live catalog cost/sell; assembly → `resolveFixture`/assembly included totals;
allowance → the confirmed amount is a **unit cost**; sell = cost ÷ (1 − the catalog margin), exactly as a catalog part
without its own sell price; the line is flagged "Allowance" in the builder, Scope panel and quote builder (internal
only — customer documents show the line normally). Curtain fabric rows resolve cost per unit area from the mapped catalog fabric.

## 4. Engine changes (`quick/engine.ts` + `scopeTargets`)

- The equations keep producing **item keys + quantities** (sizing math unchanged).
- A new pure resolver `resolveEquipment(items, map, catalog, assemblies, tier)` turns them into priced lines; an item
  whose tier cell is empty yields a **needs-a-part** line with no $ (never a fallback number).
- `TIER_SKUS`, the `cost:` literals and `SEED_FABRIC_RATES` are removed from the pricing path (kept only as the "was $X"
  hint table on the Equipment map, not used in any total).
- `scopeTargets()` (Scope panel, D139) uses the same resolver, so targets are catalog-based; needs-a-part items are
  listed under the target, not summed. Removes D139's baked-in cost data from the Grid client bundle.
- Quick Design's static plan, while it still exists, uses the same resolver.

## 5. Intake + Auto fill

**Intake steps** (`grid-intake.tsx`): 1 Start from (Auto / Blank) → 2 Venue (type, dimension sliders, scopes =
Lighting, Rigging, Curtains, Audio, Video, cover-page fields) → 3 (Auto) Equipment → canvas.

**Equipment step:** one card per chosen scope; tier buttons; lines = map rows the equations produced for this venue,
each with part/assembly (swap via catalog/assembly picker), qty (editable), unit sell, line total; needs-a-part lines
listed in amber with "Map it" (links to the Equipment map row); confirmed allowances flagged. Card total + grand total.

**Fill:** `generateAutoLayout(project, choices)` — pure — writes placements onto the generated base sheet by rules:
- Lighting: front-of-house fixtures in rows at FOH depth; electrics fixtures in rows on each electric's line (from the
  base sheet's line-set positions); cyc units along the cyc line; side lights at the proscenium sides.
- Audio: main speakers left/right of the proscenium; subs below/at stage lip; other audio items (mixer, DSP…) in the
  control-booth space if one exists, else a small cluster at the house rear.
- Video: screen centred upstage of the proscenium; projector centred at the house rear/booth.
- Curtains: on their line-set lines (existing curtain placement conventions).
- Rigging: hoists/points distributed across the grid width on each set line.
- Anything without a rule: grouped neatly along the plan's lower margin of its scope's region.
Each auto placement carries `auto: { scope, rowKey, tier }`; any move/edit clears `auto` (a hand-touched device).

**Re-fill per scope:** "Change equipment…" in the Scope panel re-opens the card; on apply, delete that scope's
placements that still carry `auto`, then generate afresh for that scope; hand-touched ones are left.

**Choices persisted** on the project (`project.autoEstimate = { tierByScope, overrides: {rowKey: {sku|assemblyId,
qty}} }`) so re-fill re-opens with the last choices. Options (D186) unchanged: Auto fills the current option.

`seedStartingLayoutAction` / `grid-seed.ts` (kept for this, D186) are replaced by the generator and removed.

## 6. Scope panel (both modes)

Target = in Auto, the chosen tiers/parts' $; in Blank, the equations' Good/Better/Best via the map (as today, now
catalog-based). Placed = $ on the plan (unchanged). Needs-a-part count per scope. Auto scopes get "Change equipment…".

## 7. Testing

Pure: map resolution (part / assembly / allowance / empty → needs-a-part, same-for-all, no fallback $); every
`engine.ts` item key has a map row (exhaustiveness check); Auto fill rules (counts equal equation quantities; positions
inside the base sheet and the right regions; auto tag set); re-fill keeps hand-touched, replaces untouched; move/edit
clears `auto`; Scope panel targets from the map. Store: map CRUD + who/when; project autoEstimate persistence. Gates:
tsc, eslint (baseline), test:specs, regressions, test:smoke, `next build`.

## 8. Out of scope

Levels (upper/lower) — later; three-option auto generation (one design; options still manual per D186); the
one-proposal-across-options document (roadmap Spec 3).
