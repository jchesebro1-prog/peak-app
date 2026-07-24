# Lineset builder — PRO dimensions + automatic weights (design)

Date: 2026-07-24
Status: approved (Jeff, 2026-07-24 — "I am good on the spec, and run with the
ceiling being 2.5lbs per square foot")
Area: `src/lib/design/goods.ts` (new), `src/lib/design/lineset.ts`,
`src/lib/design/steel.ts`, `src/app/(app)/design/lineset/lineset-builder.tsx`,
`src/db/seeds/catalog.ts`

## Problem

Every line the lineset builder generates arrives **"NOT SPECIFIED"**. The
generator places lines on the 8″ grid and names them, but carries no dimensions,
so Jeff hand-keys fabric, width, height, fullness, quantity and gear weight for
each one before any weight appears
([lineset-builder.tsx:146](../../../src/app/(app)/design/lineset/lineset-builder.tsx#L146)).

The information needed to fill those in is *almost* already in the app, and that
is the frustrating part:

- `computeSetWeight()` ([steel.ts:476](../../../src/lib/design/steel.ts#L476))
  does the full weight build-up — fabric oz/ft², fullness, cut allowance, bottom
  chain, top hardware, batten, track, brick combo, hoist utilisation. It just
  needs finished dimensions handed to it.
- The design estimator knows the venue's proscenium width and height, which drape
  types are in scope, and how many fixtures hang.

Nothing joins the two. This spec builds that join.

## Decisions (locked)

1. **Self-contained *behaviour*, shared *storage*.** The lineset builder computes
   from its own dimension inputs and does **not** read a saved design record in
   this release (Jeff, Q1). But it must persist those dimensions in a shape the
   estimator can consume and vice versa — Jeff, 2026-07-24: *"the lineset builder
   and the design estimator really need to be very similar so we should store and
   be ready so both can work off of each other as needed."* No import UI now; no
   migration needed later. See §3.1.
2. **Fixture weight is a per-type pound figure** — an editable default per
   fixture category times the quantity, not a per-model lookup. (Jeff, Q2.)
3. **The cyc gets a real rule**, defined here rather than left manual. *(Partially
   modified from Jeff's answer, which was to add a cyc drape option to the
   estimator first. The **rule** lands here as asked; the **estimator option** is
   deferred to the pricing rebuild, because a cyc in the estimator needs a rate
   and rates are being recreated. See §6.)*
4. **Pricing is out of scope.** *(Supersedes the earlier decision to rewire and
   re-tune Quick Design's curtain rates.)* Investigation found the two pricing
   models disagree ~2.3× on the main drape and both are labelled placeholder
   equations by their own comments. Jeff's call: **"Neither is right, we need to
   ultimately recreate the curtain pricing structure and should do that next."**
   Rebasing rates against an untrusted model would be thrown away. See
   *§8 Follow-on*.
5. **Drape doctrine as answered by Jeff**, §1 below.

## Why the estimator's equations could not simply be reused

The original plan was to lift the curtain equations out of the design estimator.
That does not work, and the reason shapes the whole design.

Quick Design's curtain block ([engine.ts:472](../../../src/app/(app)/design/quick/engine.ts#L472))
computes areas like `(2 * W + 2) * PH` for a draw and `6 * PH` for a leg. Tracing
these back to the source prototype (`app/Quick Design.dc.html:1975` in the design
handoff) shows the port was faithful and the formulas carry no explanatory
comment — unlike the rigging items beside them, which are all annotated. The word
*fullness* appears exactly once in that prototype, inside tier marketing prose,
and never in an equation.

**So the estimator has no fullness model at all.** Its areas are neither finished
sizes nor flat yardage; they are lump pricing surfaces tuned by feel. They cannot
be converted into the finished dimensions the weight math needs.

The correct convention does already exist in the app, in the quote-level curtain
configurator ([pricing.ts:124](../../../src/app/(app)/estimator/pricing.ts#L124)):

```js
const h = parseFloat(d.height) || 0;            // finished height (ft)
const w = parseFloat(d.width) || 0;             // finished width (ft)
const fullness = (parseFloat(d.fullness) || 0) / 100;
const faceArea = h * w;                         // finished face (sq ft)
const fabricArea = faceArea * (1 + fullness);   // sewn fabric incl. fullness
```

which is the same convention `computeSetWeight` uses
([steel.ts:483](../../../src/lib/design/steel.ts#L483)):

```js
const flatW = (L.w || 0) * (1 + full);
const cutH  = (L.h || 0) + def.cut;
```

`computeCurtain` further prices the bottom treatment per finished width and
distinguishes pipe from track — the same two variables `computeSetWeight` needs
for chain lb/ft and track lb/ft. The two engines already speak the same language.
The budgetary tool is the odd one out.

**Therefore: author the rules in the finished-dimension convention.** Do not mine
the estimator's areas.

## 1. The drape rule table

All dimensions **finished**, in feet. Fullness and cut allowance are applied once,
downstream, by the consuming engine.

| Lineset type | Fabric key | Finished W | Finished H | Full % | Qty | Track | Bottom |
|---|---|---|---|---|---|---|---|
| Draw | `draw` | PW/2 + 2 | PH + 1 | 50 | 2 | Standard traveler 1.75 lb/ft | Jack chain 0.14 lb/ft |
| Midstage Draw | `draw` | PW/2 + 2 | PH + 1 | 50 | 2 | Standard traveler 1.75 lb/ft | Jack chain 0.14 lb/ft |
| Rear | `fullstage` | PW/2 + 2 | PH + 1 | 50 | 2 | Standard traveler 1.75 lb/ft | Jack chain 0.14 lb/ft |
| Legs | `legs` | 6 | PH + 1 | 50 | 2 | — | Jack chain 0.14 lb/ft |
| Border | `border` | PW | 5 | 50 | 1 | — | Jack chain 0.14 lb/ft |
| CYC | muslin | PW | PH | **0** | 1 | — | Pocket, no chain |
| Electric | — | — | — | — | — | — | gear lb, §4 |
| Shell | — | — | — | — | — | — | gear lb, §4 |
| General Purpose | — | — | — | — | — | — | — |

Notes on the table:

- **Draw, Midstage and Rear share one recipe.** Jeff: *"Rear is a draw curtain
  typically. Same as the mid."* Each is a travelling pair, each panel finishing at
  half the opening plus 2 ft of centre overlap, so the pair finishes at PW + 4.
- **Rear keeps the `fullstage` fabric key** rather than `draw`. All three tiers
  currently point every key at the same SKU, so this is numerically identical
  today, but it preserves the ability to spec a cheaper rear blackout later
  without touching the main.
- **The cyc is PH exactly, not PH + 1.** The +1 ft header overlap applies to
  velour drapes only. The cyc is also the only line at 0% fullness — it hangs
  flat, and inheriting the schedule's 50% default would run it ~50% heavy.
- **The cyc needs no grid height.** Sizing it at PW × PH is what keeps grid
  height off the input form (§2).
- **Border width is PW**, per the estimator's `W * 5`, which reads cleanly as a
  finished 5 ft drop at full opening width.

### Signature

```ts
// src/lib/design/goods.ts
export type GoodsDims = { pwFt: number; phFt: number; swFt: number };
export type DrapeRule = {
  fabricSku: string;
  w: number;         // finished width, ft
  h: number;         // finished height, ft
  fullness: number;  // percent
  qty: number;
  track: string | null;   // TRACKS name, or null for pipe
  chain: string;          // CHAINS name
};
export function drapeRule(
  lineType: string,
  dims: GoodsDims,
  tier: TierKey
): DrapeRule | null;   // null for Electric / Shell / General Purpose
```

Returning `null` for the non-drape types keeps the caller branch-free: a null rule
means "no goods on this line", and gear weight is handled separately (§4).

## 2. New inputs on the lineset builder

`LinesetInputs` ([lineset.ts:26](../../../src/lib/design/lineset.ts#L26)) gains
two fields:

| Field | Label | Why |
|---|---|---|
| `proWidthFt` | PRO width | Curtain widths key off the **proscenium opening**. The existing `stageWidthFt` is wall-to-wall stage — a different number, and the one battens are sized from. |
| `proHeightFt` | PRO height | Jeff's original ask. Drives every drape height. |

**Two inputs, not one.** The original request was PRO height alone, but without
PRO width every drape width would have to fall back to stage width, which
oversizes legs, borders and the cyc.

No grid height input is required, because the cyc is sized off PH (§1).

Existing `stageWidthFt` / `stageDepthFt` keep driving line **placement**
unchanged. The two new fields only feed goods geometry.

## 3. Architecture

```
src/lib/design/goods.ts      ← the §1 table
        │
        ├──→ computeSetWeight()      weight on batten, bricks, hoist utilisation
        └──→ (future) curtain pricing rebuild — §8
```

One table, and it is deliberately shaped so the pricing rebuild consumes the same
finished dimensions rather than re-deriving them. That is the whole point of
putting it in `lib` rather than inside the lineset screen.

### 3.1 Shared storage — built now, wired later

Per decision 1, the two tools must end up able to feed each other. Nothing about
that is built in this release, but the **stored shape** is settled now so it never
needs migrating.

**The blocker is a naming collision, and it is a real trap.** Both tools have a
field called *width* and they mean different things:

| | Field | Means |
|---|---|---|
| Estimator | `AState.width` | **Proscenium** opening width (`DIMSCHEMA.proscenium` labels it "Proscenium width, opening edge to edge") |
| Lineset builder | `LinesetInputs.stageWidthFt` | **Stage** width, wall to wall |

Feeding one into the other today would silently size drapes off the wrong number.
Adding `proWidthFt` to `LinesetInputs` (§2) means the builder will hold *both*,
which is what makes a clean join possible.

**Change:** define one canonical dimension block in `src/lib/design/venue-dims.ts`
and have both tools store it:

```ts
export type VenueDims = {
  proWidthFt: number;    // proscenium opening, edge to edge
  proHeightFt: number;   // proscenium opening, floor to header
  stageWidthFt: number;  // wall to wall
  stageDepthFt: number;  // plaster line to back wall
  gridHeightFt?: number; // floor to grid steel — estimator only today
};
```

Both stores carry it: `designs` (estimator records) and `studio_designs` (lineset
saves). Names are unambiguous by construction — there is no bare `width`.

Once both persist `VenueDims`, each direction becomes a small, additive feature:

- **Lineset ← estimator**: pull PW/PH plus the drape selections, tier and fixture
  counts to seed a schedule from a design that was already quoted.
- **Estimator ← lineset**: pull the *real* line count. The estimator currently
  guesses quantities from 10-ft depth blocks (`dBlk`); an actual 8″-grid layout is
  ground truth and strictly better input.

That second direction is the more valuable one and is easy to miss, since the
obvious framing is estimator-feeds-lineset.

**Reconciling counts.** When the two are wired together, the **lineset builder's
line count always wins for weight** — it is the physical hang. The estimator
contributes the per-line recipe (fabric, finished dimensions, fullness), never the
count.

### Applying a rule to a line

In `lineset-builder.tsx`, the merged-row `useMemo` currently produces
`c = specified ? computeSetWeight(line, def) : null`. It becomes:

```ts
const rule = drapeRule(s.type, dims, tier);
const line: WeightLine = { name: load?.nameOverride || s.name, ...ruleToWeightLine(rule), ...load };
const c = computeSetWeight(line, def);
```

Ordering matters: the rule supplies defaults, `...load` spreads **after** so any
value Jeff typed wins. This is the same override discipline `computeSetWeight`
already applies to `full` and `batten` (`L.full == null ? def.full : L.full`).

### Override behaviour

- Every generated line arrives with a weight. The "NOT SPECIFIED" state
  disappears for drape and electric lines.
- A hand-edited field is an **override**: it persists, and it survives changes to
  PRO width/height.
- Overridden fields are visually distinct from rule-derived ones, so it is
  obvious at a glance what the tool computed versus what Jeff set.
- A per-line "reset to rule" control clears overrides on that line.
- `LineLoad` gains no new shape — an override is simply a present value, exactly
  as today. This keeps saved designs backward compatible: an existing saved
  design's stored loads all read as overrides, which is correct, because they were
  hand-entered.

## 4. Gear weight: fixtures and shell

Neither is available today. `fixture-crossref.json` has no weight column;
`FIXTURES` ([estimator-data.ts:19](../../../src/app/(app)/estimator/estimator-data.ts#L19))
has 14 real models with list and cost but no weight; catalog parts
([catalog.ts:20](../../../src/lib/stores/catalog.ts#L20)) have no weight field.

Per decision 2, electrics get a per-type pound figure. Proposed defaults, all
editable on the schedule-defaults panel alongside the existing `WeightDefaults`:

| Fixture type | lb each | Basis |
|---|---|---|
| Par | 12 | S4 PAR ≈ 10 lb, ColorSource PAR ≈ 9 lb, with clamp and cable |
| Front | 18 | Source Four ERS ≈ 13–16 lb, with clamp, cable and safety |
| Cyc | 14 | ColorSource CYC ≈ 12 lb, Altman Spectra ≈ 13 lb |
| Side light | 18 | Same basis as Front |
| Automated | 45 | Rogue R2 ≈ 48 lb, MAC Aura XB ≈ 17 lb — wide spread, see risk below |
| Distribution | 1.5 lb per ft of batten | **One combined allowance** covering cable, raceway and anything else on the pipe (Jeff: *"a single distribution line that handles cable raceway and other weight, and that weight is fine for now"*) |

**These numbers need Jeff's sign-off.** They are drawn from published fixture
weights, not from Peak practice. The `Automated` figure is the weakest: movers
range from ~17 lb to ~50 lb and 45 lb is deliberately conservative.

### Shell lines

**Only the ceiling flies — confirmed by Jeff.** Acoustic shell *towers* are
floor-supported and put no load on a batten. A Shell line carries ceiling units
only. Loading tower weight onto a Shell line would materially overstate it, and
that is the kind of error that propagates into a capacity check.

**Shell ceiling weight is area-based, not per-unit:**

```
shellCeilingLb = shellPsf × (PW × shellIntervalFt)
```

`shellIntervalFt` already exists in `LinesetInputs` (default 12 ft), so the area
each Shell line carries is the pro width times the shell spacing.

**`shellPsf` = 2.5 lb/ft², set directly by Jeff (2026-07-24).** This supersedes
the ≈2 lb/ft² he recalled from prior research; that source was never recovered
(§7.1) and is now moot. Editable alongside the fixture weights.

On a 36 ft pro at 12 ft spacing that is 432 ft², or **1,080 lb** on a single
Shell line. Worth stating plainly because it will often be the heaviest line on
the grid — heavier than the grand drape — and any capacity check that omits it
would be badly wrong.

## 5. The fabric join

This is the change that makes the whole feature possible, and it is small.

Fabric weight currently lives in `FABLIB` ([steel.ts:366](../../../src/lib/design/steel.ts#L366))
keyed by display name. Fabric *choice* lives in the catalog, keyed by SKU
([seeds/catalog.ts:12](../../../src/db/seeds/catalog.ts#L12)):

| SKU | desc | costPerSqft |
|---|---|---|
| `RB-EN-16` | 16 oz Encore Velour | 2.60 |
| `RB-MARVEL` | 21 oz Marvel Velour | 3.45 |
| `RB-MV-MN` | 25 oz Memorable Velour | 4.20 |

The two do not join. The oz value exists in the catalog only inside the `desc`
**string**, and the entries do not even agree: catalog Encore is 16 oz, `FABLIB`'s
Encore is 15 oz, and Marvel 21 oz is absent from `FABLIB` entirely.

**Change:** add numeric `oz`, `basis` and bolt `width` to `CatalogPart`, populated
on the Fabric rows. `computeSetWeight` then resolves fabric by SKU through the
catalog, so a tier's fabric choice drives weight and price from one record.

`FABLIB` stays for the standalone weights path and for fabrics with no catalog
SKU. Where both exist, the catalog wins.

**Also add a muslin SKU.** The catalog has three velours and no muslin, and the
cyc requires one. `ozPerFt2()` already handles the `sq-yd` basis that seamless
muslin uses.

## 6. What is explicitly NOT in this feature

- **No pricing changes of any kind.** Quick Design's curtain formulas, its rates,
  and `computeCurtain` are all untouched. Every existing and future estimate
  prices exactly as it does today.
- **No cyc drape option in the estimator.** Jeff asked for one earlier, but a cyc
  in the estimator needs a *rate*, and rates are being rebuilt (§8). The cyc
  **rule** lands here in `goods.ts` and serves the weight path immediately; the
  estimator's cyc option rides along with the pricing rebuild that will set its
  price. This avoids authoring a rate that gets discarded weeks later.
- **No import UI in either direction** (decision 1). The *storage* both directions
  need is built here (§3.1) — the wiring is not. Deliberate: the shared
  `VenueDims` shape is cheap now and expensive to retrofit, whereas the import
  flows are additive and can wait until it is clear which direction gets used.
- **No per-model fixture weights** (decision 2).

## 7. Open questions

**None block implementation.** All resolved 2026-07-24 by Jeff: fixture pounds
approved as listed including `Automated` at 45 lb; shell towers confirmed
floor-supported and excluded from batten load; distribution stays a single
combined 1.5 lb/ft allowance; **`shellPsf` set to 2.5**.

### 7.1 The shell psf source was never recovered (closed — superseded)

Recorded so nobody repeats the search. Jeff originally recalled **≈ 2 lb per ft²
of shell** from prior research he described as *"really good information."* That
source was never found. Searched, all negative:

- `memory/` tree — no shell weight in any note, session or knowledge record
- `Peak-Design-Doctrine-v1.0.docx` — **zero** occurrences of "shell"
- `peak-steel-calculator-sources-2026-07.md` — has drape-weight math and fabric
  citations, nothing on shells
- `tools/Peak-Steel-Calculator.html` — no shell data
- The app: `fixture-crossref.json`, `FIXTURES`, `catalog_parts` — price only
- All **308** local Claude Code transcripts — no hit for "acoustic shell",
  "acoustical shell" or "shell ceiling"

The claude-mem index, which is the one store that might cover desktop/Cowork
sessions, was returning `fetch failed` throughout and could not be queried.

**Likely homes, if it is ever wanted:** a Cowork or claude.ai chat rather than
Claude Code, or a Wenger / StageRight cut sheet.

**Superseded — Jeff set `shellPsf` to 2.5 directly**, so the recalled figure no
longer matters. Worth noting the direction of the change: 2 lb/ft² was light for
a rigid panel (¾″ MDF alone runs ~3.5 lb/ft²), and 2.5 sits closer to a real
assembly.

## 8. Follow-on: recreate the curtain pricing structure

Out of scope here, and the reason pricing was removed from this spec.

Findings that motivate it, recorded so the next effort starts from them:

- Quick Design and the quote configurator agree within ~4% on legs, borders and
  full-stage, and disagree by **2.3×** on the main drape ($11,988 vs $5,197 cost
  each at Better tier, Auditorium 36×18). The gap is almost entirely the
  `(2W+2)` draw formula.
- Both models are labelled placeholder equations in their own source comments.
  Neither is Peak doctrine.
- Had the rates been rebased onto finished-size areas, they would have calibrated
  cleanly across both seeded venues — draw $10.75, leg $4.50, border $4.65, rear
  $3.50 per ft², agreeing within ~4% between Auditorium and PAC. Recorded because
  it demonstrates the finished-dimension rules are a sound pricing basis, not
  because those rates should be adopted.

The rebuild should price from `goods.ts` finished dimensions, so budget and quote
derive from one geometry.

## Testing

- **Rule table**: a unit test per line type asserting finished W/H/fullness/qty
  against the §1 table at a known PW/PH, including the cyc's PH-exactly and
  0%-fullness special cases.
- **Override precedence**: a hand-set value survives a PRO-dimension change; a
  non-overridden value follows it.
- **Backward compatibility**: an existing saved design loads with its stored loads
  intact and its totals unchanged from before this feature.
- **Fabric join**: `computeSetWeight` resolves a catalog SKU to the same weight
  the equivalent `FABLIB` entry produces, where both exist.
- **`VenueDims` round-trip**: a lineset save and an estimator design both persist
  the block and read it back identically. Specifically assert that `proWidthFt`
  and `stageWidthFt` stay distinct through a save/load cycle — that collision
  (§3.1) is the failure this shape exists to prevent.
- **End-to-end**: a known venue seeded with PRO dimensions produces a schedule
  whose per-line and total weights are hand-checkable, with the grand drape
  reconciled by hand once against the §1 geometry.
