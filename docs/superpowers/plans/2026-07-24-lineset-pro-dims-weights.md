# Lineset PRO Dimensions + Automatic Weights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PRO width and PRO height to the lineset builder so every generated line arrives with a computed weight instead of "NOT SPECIFIED".

**Architecture:** A new `src/lib/design/goods.ts` holds one drape rule table keyed by line type, returning **finished** dimensions. `computeSetWeight()` (which already does the full weight build-up) consumes it. A canonical `VenueDims` block is persisted by both the lineset builder and the estimator so the two tools can feed each other later without a migration. Fabric weight is joined to the parts catalog by SKU.

**Tech Stack:** Next.js 15 App Router, TypeScript, React 19 client components, Drizzle + PGlite doc-store, `tsx` script assertions.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-24-lineset-pro-dims-weights-design.md` (approved 2026-07-24). Where this plan and the spec disagree, the spec wins.
- **All drape dimensions are FINISHED.** Fullness and cut allowance are applied exactly once, downstream, by `computeSetWeight()`. Never pre-fatten a dimension.
- **Never use a bare `width`.** The estimator's `AState.width` is *proscenium* width; `LinesetInputs.stageWidthFt` is *wall-to-wall stage*. Every new field is explicitly `proWidthFt` or `stageWidthFt`.
- **No pricing changes.** `quick/engine.ts` curtain formulas, its rates, and `computeCurtain` are untouched. Curtain pricing is being recreated as separate work.
- **Tests:** there is no test framework. Assertions are appended to `scripts/test-review-and-spec.ts` using the existing `ok(condition, message)` helper, and run with `npm run test:specs`. **Always insert new assertions ABOVE the final two lines** (`console.log(fail ? ...)` and `process.exit(...)`).
- **Never run `npm run build` with a dev server running** — PGlite is single-process.
- Peak counterweight bricks are 25 lb and 10 lb. Do not change `BRICK_LG` / `BRICK_SM`.

### Locked values (from the spec, verbatim)

| | Value |
|---|---|
| Drape trim allowance | PH + 1 ft (velour only) |
| Cyc | PW × PH exactly, **0% fullness** |
| Draw / Midstage / Rear | pair, each panel PW/2 + 2, PH + 1, 50% |
| Legs | 6 ft × PH + 1, 50%, qty 2 |
| Border | PW × 5 ft, 50%, qty 1 |
| Track (Draw/Midstage/Rear) | `Standard traveler track (~1.75 lb/ft)` |
| Bottom (all velour) | `Jack chain ~0.14 lb/ft` |
| Fixture lb | Par 12 · Front 18 · Cyc 14 · Side 18 · Automated 45 |
| Distribution | 1.5 lb per ft of batten, one combined allowance |
| Shell ceiling | **2.5 lb/ft²**, area = PW × shell interval |

### Derived decisions (NOT in the spec — flag to Jeff at first review)

1. **Front-of-house fixtures are excluded from every batten.** `engine.ts:479` comments *"Front/Cyc are width-only (FOH / cyc row)"*. FOH fixtures hang on a front-of-house position, not a lineset. `front` defaults to a count of **0** on every line. Same reasoning as shell towers.
2. **Per-electric fixture counts** are derived by mirroring the estimator's count math (`wUnit = round(PW / 8)`, times the per-electric multiplier). Counts are reusable in a way the *curtain* equations were not, because they carry no fullness assumption.
3. **`proWidthFt` / `proHeightFt` defaults are 40 / 20**, proportionate to the existing 50 ft × 30 ft stage default.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/design/venue-dims.ts` **(new)** | The canonical `VenueDims` block + adapters from each tool's native shape. Nothing else. |
| `src/lib/design/goods.ts` **(new)** | The drape rule table and gear-weight math. Pure functions, no I/O, no React. |
| `src/lib/stores/catalog.ts` | `CatalogPart` gains fabric weight fields. |
| `src/db/seeds/catalog.ts` | Populate weight on the 3 velours; add the muslin SKU. |
| `src/lib/design/steel.ts` | Add `fabricFromPart()` so a catalog row resolves to the existing `Fabric` shape. Everything else untouched. |
| `src/lib/design/lineset.ts` | `LinesetInputs` gains `proWidthFt` / `proHeightFt`. Placement math untouched. |
| `src/app/(app)/design/lineset/page.tsx` | v3 save format + legacy v2 adaptation. |
| `src/app/(app)/design/lineset/lineset-builder.tsx` | The two new inputs, tier selector, rule application, override affordances. |
| `scripts/test-review-and-spec.ts` | Assertions for every task. |

---

### Task 1: Canonical venue dimensions

**Files:**
- Create: `src/lib/design/venue-dims.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type VenueDims`, `DEFAULT_VENUE_DIMS`, `venueDimsFromEstimator(s)`, `venueDimsFromLineset(inp)`.

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-review-and-spec.ts`, **above** the final `console.log(fail ? ...)` line:

```ts
/* --- venue dimensions (lineset PRO dims, task 1) --- */
import { venueDimsFromEstimator, venueDimsFromLineset } from "@/lib/design/venue-dims";

const vdEst = venueDimsFromEstimator({ width: 36, ph: 18, depth: 26, grid: 24, wing: 12 });
ok(vdEst.proWidthFt === 36, "estimator `width` maps to PRO width, not stage width");
ok(vdEst.proHeightFt === 18, "estimator `ph` maps to PRO height");
ok(vdEst.stageWidthFt === 60, `stage width = pro + 2 wings (got ${vdEst.stageWidthFt})`);
ok(vdEst.proWidthFt !== vdEst.stageWidthFt, "pro and stage width stay distinct — the collision guard");

const vdLine = venueDimsFromLineset({ proWidthFt: 40, proHeightFt: 20, stageWidthFt: 50, stageDepthFt: 30 });
ok(vdLine.proWidthFt === 40 && vdLine.stageWidthFt === 50, "lineset inputs keep pro and stage width separate");
```

Move the `import` line to the top of the file with the other imports — the codebase puts all imports at the top.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `Cannot find module '@/lib/design/venue-dims'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/design/venue-dims.ts`:

```ts
/**
 * The canonical venue dimension block, shared by the lineset builder and the
 * design estimator so either can consume the other's saved records without a
 * migration (spec §3.1).
 *
 * There is deliberately NO bare `width` field. The estimator's `AState.width`
 * is the PROSCENIUM opening; the lineset builder's `stageWidthFt` is
 * WALL-TO-WALL stage. They are different numbers and mixing them silently
 * sizes every drape wrong.
 */
export type VenueDims = {
  /** Proscenium opening, edge to edge (ft). Drives drape widths. */
  proWidthFt: number;
  /** Proscenium opening, floor to header (ft). Drives drape heights. */
  proHeightFt: number;
  /** Wall to wall (ft). Drives batten length and line placement. */
  stageWidthFt: number;
  /** Plaster line to back wall (ft). */
  stageDepthFt: number;
  /** Floor to grid steel (ft). Estimator-only today; the cyc is sized off PH. */
  gridHeightFt?: number;
};

export const DEFAULT_VENUE_DIMS: VenueDims = {
  proWidthFt: 40,
  proHeightFt: 20,
  stageWidthFt: 50,
  stageDepthFt: 30,
};

/** Adapt an estimator AState. `width` is the proscenium opening; stage width is
 *  derived as the opening plus a wing on each side. */
export function venueDimsFromEstimator(s: {
  width: number;
  ph: number;
  depth: number;
  grid: number;
  wing: number;
}): VenueDims {
  return {
    proWidthFt: s.width,
    proHeightFt: s.ph,
    stageWidthFt: s.width + 2 * s.wing,
    stageDepthFt: s.depth,
    gridHeightFt: s.grid,
  };
}

/** Adapt a lineset input record. These fields are already unambiguous. */
export function venueDimsFromLineset(inp: {
  proWidthFt: number;
  proHeightFt: number;
  stageWidthFt: number;
  stageDepthFt: number;
}): VenueDims {
  return {
    proWidthFt: inp.proWidthFt,
    proHeightFt: inp.proHeightFt,
    stageWidthFt: inp.stageWidthFt,
    stageDepthFt: inp.stageDepthFt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on all 5 new lines, and `ALL PASSED` overall.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/venue-dims.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): canonical VenueDims shared by lineset builder and estimator"
```

---

### Task 2: Join fabric weight to the parts catalog

**Files:**
- Modify: `src/lib/stores/catalog.ts:20-41` (the `CatalogPart` type)
- Modify: `src/db/seeds/catalog.ts:12-14` (the three Fabric rows)
- Modify: `src/lib/design/steel.ts` (append `fabricFromPart`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `Fabric`, `ozPerFt2` from `steel.ts`.
- Produces: `fabricFromPart(part): Fabric | null`; catalog SKU `RB-MUS-SL`; `CatalogPart.oz`, `.ozBasis`, `.boltWidthIn`.

Background: fabric weight lives in `FABLIB` (`steel.ts:366`) keyed by display name; fabric *choice* lives in the catalog keyed by SKU. The oz value exists in the catalog only inside the `desc` **string**. This task makes it numeric.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

```ts
/* --- fabric catalog weight join (task 2) --- */
const velourPart = { id: "RB-MV-MN", sku: "RB-MV-MN", desc: "25 oz Memorable Velour", category: "Fabric", unit: "sq ft", list: 6.4, cost: 4.2, oz: 25, ozBasis: "lin-yd" as const, boltWidthIn: 54 };
const muslinPart = { id: "RB-MUS-SL", sku: "RB-MUS-SL", desc: "Muslin, seamless", category: "Fabric", unit: "sq ft", list: 1.2, cost: 0.8, oz: 6, ozBasis: "sq-yd" as const, boltWidthIn: 120 };

const fV = fabricFromPart(velourPart);
ok(fV !== null && Math.abs(ozPerFt2(fV) - 25 / 13.5) < 1e-9, "54in lin-yd velour resolves to oz/13.5 per sqft");
const fM = fabricFromPart(muslinPart);
ok(fM !== null && Math.abs(ozPerFt2(fM) - 6 / 9) < 1e-9, "sq-yd muslin resolves to oz/9 per sqft");
ok(fabricFromPart({ ...velourPart, oz: undefined }) === null, "a part with no oz cannot produce a weight");
```

Add `fabricFromPart` and `ozPerFt2` to the existing `@/lib/design/steel` import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `fabricFromPart` is not exported from `@/lib/design/steel`.

- [ ] **Step 3: Extend `CatalogPart`**

In `src/lib/stores/catalog.ts`, add these three fields inside the `CatalogPart` type, immediately after `costPerSqft`:

```ts
  /** Fabric rows only — weight basis, so one fabric choice drives both price
   *  and rigging weight. The oz also appears in `desc` for humans; this is the
   *  machine-readable copy. */
  oz?: number;
  /** How `oz` is measured. Velour bolts are sold by linear yard at a given
   *  bolt width; muslin and scrim by square yard. */
  ozBasis?: "lin-yd" | "sq-yd";
  /** Bolt width in inches — only meaningful when ozBasis is "lin-yd". */
  boltWidthIn?: number;
```

- [ ] **Step 4: Populate the seeds**

In `src/db/seeds/catalog.ts`, replace the three Fabric rows (lines 12-14) with these four:

```ts
    { id: "RB-MV-MN", sku: "RB-MV-MN", desc: "25 oz Memorable Velour", category: "Fabric", unit: "sq ft", list: 6.40, cost: 4.20, mfr: "Rose Brand", costPerSqft: 4.20, oz: 25, ozBasis: "lin-yd", boltWidthIn: 54 },
    { id: "RB-MARVEL", sku: "RB-MARVEL", desc: "21 oz Marvel Velour", category: "Fabric", unit: "sq ft", list: 5.30, cost: 3.45, mfr: "Rose Brand", costPerSqft: 3.45, oz: 21, ozBasis: "lin-yd", boltWidthIn: 54 },
    { id: "RB-EN-16", sku: "RB-EN-16", desc: "16 oz Encore Velour", category: "Fabric", unit: "sq ft", list: 3.95, cost: 2.60, mfr: "Rose Brand", costPerSqft: 2.60, oz: 16, ozBasis: "lin-yd", boltWidthIn: 54 },
    { id: "RB-MUS-SL", sku: "RB-MUS-SL", desc: "Muslin, seamless", category: "Fabric", unit: "sq ft", list: 1.20, cost: 0.80, mfr: "Rose Brand", costPerSqft: 0.80, oz: 6, ozBasis: "sq-yd", boltWidthIn: 120 },
```

The muslin row is new — the catalog had three velours and no muslin, and the cyc requires one.

- [ ] **Step 5: Add the resolver**

Append to `src/lib/design/steel.ts`, directly after `ozPerFt2`:

```ts
/** Resolve a catalog Fabric row into the `Fabric` shape the weight math uses.
 *  Returns null when the row carries no numeric weight, so a missing oz fails
 *  loudly at the call site instead of silently weighing zero. */
export function fabricFromPart(p: {
  desc: string;
  oz?: number;
  ozBasis?: "lin-yd" | "sq-yd";
  boltWidthIn?: number;
}): Fabric | null {
  if (typeof p.oz !== "number" || p.oz <= 0) return null;
  return {
    name: p.desc,
    oz: p.oz,
    basis: p.ozBasis || "lin-yd",
    width: p.boltWidthIn || 54,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on all 3 new lines.

- [ ] **Step 7: Reseed and confirm the muslin row lands**

```bash
npm run db:reset-local
```

Expected: completes without error. This wipes `.data` and reseeds — safe, it is the local dev DB.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/catalog.ts src/db/seeds/catalog.ts src/lib/design/steel.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): numeric fabric weight + seamless muslin SKU"
```

---

### Task 3: The drape rule table

**Files:**
- Create: `src/lib/design/goods.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `VenueDims` from task 1.
- Produces: `type GoodsTier`, `type DrapeRule`, `drapeRule(lineType, dims, tier)`, `TRACK_TRAVELER`, `CHAIN_JACK`.

The nine line types emitted by `generateLineset()` are exactly: `'Electric'`, `'Shell'`, `'Legs'`, `'Border'`, `'Draw'`, `'Rear'`, `'CYC'`, `'Midstage Draw'`, `'General Purpose'`.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

```ts
/* --- drape rule table (task 3) --- */
const DIMS36 = { proWidthFt: 36, proHeightFt: 18, stageWidthFt: 50, stageDepthFt: 30 };

const rDraw = drapeRule("Draw", DIMS36, "better")!;
ok(rDraw.w === 20, `draw panel = PW/2+2 (got ${rDraw.w})`);
ok(rDraw.h === 19, `draw height = PH+1 (got ${rDraw.h})`);
ok(rDraw.qty === 2 && rDraw.fullness === 50, "draw is a pair at 50% fullness");
ok(rDraw.track === TRACK_TRAVELER, "draw travels on standard traveler track");

const rRear = drapeRule("Rear", DIMS36, "better")!;
ok(rRear.w === rDraw.w && rRear.h === rDraw.h && rRear.qty === rDraw.qty, "rear is a draw curtain — same geometry as the main");
ok(rRear.fabricSku !== undefined, "rear still carries its own fabric key for later differentiation");

const rMid = drapeRule("Midstage Draw", DIMS36, "better")!;
ok(rMid.w === rDraw.w && rMid.h === rDraw.h, "midstage matches the main's geometry");

const rLegs = drapeRule("Legs", DIMS36, "better")!;
ok(rLegs.w === 6 && rLegs.h === 19 && rLegs.qty === 2, "legs are 6ft x PH+1, one pair");
ok(rLegs.track === null, "legs tie to pipe, no track");

const rBorder = drapeRule("Border", DIMS36, "better")!;
ok(rBorder.w === 36 && rBorder.h === 5 && rBorder.qty === 1, "border is PW wide x 5ft drop");

const rCyc = drapeRule("CYC", DIMS36, "better")!;
ok(rCyc.w === 36 && rCyc.h === 18, "cyc is PW x PH EXACTLY — no +1 trim allowance");
ok(rCyc.fullness === 0, "cyc hangs FLAT — 0% fullness, else it runs ~50% heavy");
ok(rCyc.track === null && rCyc.chain === "None", "cyc has no track and no bottom chain (pocket)");

ok(drapeRule("Electric", DIMS36, "better") === null, "electrics carry no goods");
ok(drapeRule("Shell", DIMS36, "better") === null, "shell lines carry no goods");
ok(drapeRule("General Purpose", DIMS36, "better") === null, "general purpose lines are empty");

ok(drapeRule("Draw", DIMS36, "good")!.fabricSku === "RB-EN-16", "good tier uses 16oz Encore");
ok(drapeRule("Draw", DIMS36, "best")!.fabricSku === "RB-MV-MN", "best tier uses 25oz Memorable");
ok(drapeRule("CYC", DIMS36, "good")!.fabricSku === "RB-MUS-SL", "cyc is muslin at every tier");
```

Add the import for `drapeRule`, `TRACK_TRAVELER` from `@/lib/design/goods` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `Cannot find module '@/lib/design/goods'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/design/goods.ts`:

```ts
import type { VenueDims } from "./venue-dims";

/**
 * Peak's soft-goods geometry, as one table (spec §1).
 *
 * EVERY dimension here is FINISHED. Fullness and cut allowance are applied
 * exactly once, downstream, by computeSetWeight(). Do not pre-fatten anything.
 *
 * These rules were authored from Jeff's doctrine, NOT lifted from the design
 * estimator. The estimator's curtain areas have no fullness model at all —
 * they are lump pricing surfaces and cannot be converted to finished sizes.
 */

export type GoodsTier = "good" | "better" | "best";

export type DrapeRule = {
  /** Catalog SKU — resolves to both price and weight. */
  fabricSku: string;
  /** Finished width, ft (per panel when qty > 1). */
  w: number;
  /** Finished height, ft. */
  h: number;
  /** Percent. 50 for velour, 0 for the cyc. */
  fullness: number;
  /** Panels on the line. 2 = a travelling pair. */
  qty: number;
  /** TRACKS name, or null when the goods tie directly to pipe. */
  track: string | null;
  /** CHAINS name. "None" for a pocket bottom. */
  chain: string;
};

/** Exact names from steel.ts TRACKS / CHAINS — these are lookup keys, not labels. */
export const TRACK_TRAVELER = "Standard traveler track (~1.75 lb/ft)";
export const CHAIN_JACK = "Jack chain ~0.14 lb/ft";
export const CHAIN_NONE = "None";

/** Per-tier fabric SKU by drape role. Mirrors tierDefsDefault().fabrics in
 *  quick/engine.ts, plus a cyc role the estimator does not have. All three
 *  velour roles point at the same SKU per tier today; the separate keys exist
 *  so a cheaper rear blackout can be specced later without touching the main. */
const TIER_FABRIC: Record<GoodsTier, Record<string, string>> = {
  good: { draw: "RB-EN-16", legs: "RB-EN-16", border: "RB-EN-16", fullstage: "RB-EN-16", cyc: "RB-MUS-SL" },
  better: { draw: "RB-MARVEL", legs: "RB-MARVEL", border: "RB-MARVEL", fullstage: "RB-MARVEL", cyc: "RB-MUS-SL" },
  best: { draw: "RB-MV-MN", legs: "RB-MV-MN", border: "RB-MV-MN", fullstage: "RB-MV-MN", cyc: "RB-MUS-SL" },
};

/**
 * The finished-dimension recipe for one generated line.
 * Returns null for line types that carry no soft goods — Electric, Shell and
 * General Purpose. Their weight comes from gear, not fabric.
 */
export function drapeRule(
  lineType: string,
  d: VenueDims,
  tier: GoodsTier
): DrapeRule | null {
  const PW = d.proWidthFt;
  const PH = d.proHeightFt;
  const fab = TIER_FABRIC[tier] || TIER_FABRIC.better;

  // A travelling pair: each panel covers half the opening plus 2 ft of centre
  // overlap, so the pair finishes at PW + 4.
  const pair = (sku: string): DrapeRule => ({
    fabricSku: sku,
    w: PW / 2 + 2,
    h: PH + 1,
    fullness: 50,
    qty: 2,
    track: TRACK_TRAVELER,
    chain: CHAIN_JACK,
  });

  switch (lineType) {
    case "Draw":
    case "Midstage Draw":
      return pair(fab.draw);
    // Jeff: "Rear is a draw curtain typically. Same as the mid."
    case "Rear":
      return pair(fab.fullstage);
    case "Legs":
      return { fabricSku: fab.legs, w: 6, h: PH + 1, fullness: 50, qty: 2, track: null, chain: CHAIN_JACK };
    case "Border":
      return { fabricSku: fab.border, w: PW, h: 5, fullness: 50, qty: 1, track: null, chain: CHAIN_JACK };
    // The cyc is the ONLY line at PH exactly (no header overlap) and the ONLY
    // one at 0% fullness — it hangs flat. Inheriting the schedule's 50%
    // default would run it roughly 50% heavy.
    case "CYC":
      return { fabricSku: fab.cyc, w: PW, h: PH, fullness: 0, qty: 1, track: null, chain: CHAIN_NONE };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on all 18 new lines.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/goods.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): finished-dimension drape rule table"
```

---

### Task 4: Gear weight — fixtures, distribution, shell

**Files:**
- Modify: `src/lib/design/goods.ts` (append)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `VenueDims`, `GoodsTier` from tasks 1 and 3.
- Produces: `type GearDefaults`, `DEFAULT_GEAR`, `type FixtureCounts`, `electricCounts(dims, size, kind)`, `electricGearLb(counts, battenLenFt, gear?)`, `shellGearLb(dims, shellIntervalFt, gear?)`.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

```ts
/* --- gear weights: fixtures, distribution, shell (task 4) --- */
ok(DEFAULT_GEAR.shellPsf === 2.5, "shell ceiling is 2.5 lb per sqft (Jeff, 2026-07-24)");
ok(shellGearLb(DIMS36, 12) === 1080, `36ft pro x 12ft shell spacing x 2.5psf = 1080 lb (got ${shellGearLb(DIMS36, 12)})`);

const cReg = electricCounts(DIMS36, "medium", "regular");
ok(cReg.front === 0, "FOH fixtures NEVER load a lineset batten — front count is always 0");
ok(cReg.cyc === 0, "cyc fixtures belong to the cyc electric, not a regular one");
ok(cReg.par === 5, `par count = round(PW/8) x 1.0 at medium (got ${cReg.par})`);

const cCyc = electricCounts(DIMS36, "medium", "cyc");
ok(cCyc.cyc > 0 && cCyc.par === 0, "the cyc electric carries cyc fixtures only");

const lb = electricGearLb({ par: 5, side: 3 }, 44);
ok(lb === 5 * 12 + 3 * 18 + 1.5 * 44, `gear = fixtures + 1.5 lb/ft distribution (got ${lb})`);
ok(electricGearLb({ front: 10 }, 0) === 0, "an explicit front count still contributes nothing — FOH is off-batten");
ok(electricGearLb({}, 44) === 66, "a bare electric still carries its distribution allowance");
```

Add `DEFAULT_GEAR`, `shellGearLb`, `electricCounts`, `electricGearLb` to the `@/lib/design/goods` import.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `DEFAULT_GEAR` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/design/goods.ts`:

```ts
/* ------------------------------ gear weights ------------------------------ */

export type GoodsSize = "small" | "medium" | "large";

export type FixtureCounts = {
  par: number;
  /** Front-of-house. ALWAYS contributes 0 lb to a batten — see electricGearLb. */
  front: number;
  cyc: number;
  side: number;
  automated: number;
};

export type GearDefaults = {
  /** Pounds per fixture, including clamp, cable and safety. */
  fixtureLb: FixtureCounts;
  /** One combined allowance covering cable, raceway and anything else on the
   *  pipe. Jeff wants a single distribution figure, not separate entries. */
  distributionLbPerFt: number;
  /** Acoustic shell CEILING weight per square foot. Towers are floor-supported
   *  and load no batten. */
  shellPsf: number;
};

export const DEFAULT_GEAR: GearDefaults = {
  fixtureLb: { par: 12, front: 18, cyc: 14, side: 18, automated: 45 },
  distributionLbPerFt: 1.5,
  shellPsf: 2.5,
};

/** Per-electric multipliers, mirroring quick/engine.ts compute(). */
const FIX_MUL: Record<GoodsSize, { par: number; side: number; automated: number; cyc: number }> = {
  small: { par: 0.7, side: 0, automated: 0, cyc: 1 },
  medium: { par: 1, side: 0.5, automated: 0.5, cyc: 1.25 },
  large: { par: 1.2, side: 0.75, automated: 0.9, cyc: 1.5 },
};

/**
 * Default fixture counts for ONE electric line.
 *
 * Derived by mirroring the estimator's count math (wUnit = round(PW / 8) times
 * a per-electric multiplier). Counts are safe to reuse in a way the estimator's
 * CURTAIN equations were not, because a count carries no fullness assumption.
 *
 * `front` is always 0: the estimator's own comment reads "Front/Cyc are
 * width-only (FOH / cyc row)". Front-of-house fixtures hang on an FOH position,
 * not on a lineset batten.
 */
export function electricCounts(
  d: VenueDims,
  size: GoodsSize = "medium",
  kind: "regular" | "cyc" = "regular"
): FixtureCounts {
  const wUnit = Math.max(1, Math.round(d.proWidthFt / 8));
  const m = FIX_MUL[size] || FIX_MUL.medium;
  if (kind === "cyc") {
    return { par: 0, front: 0, cyc: Math.round(wUnit * m.cyc), side: 0, automated: 0 };
  }
  return {
    par: Math.round(wUnit * m.par),
    front: 0,
    cyc: 0,
    side: Math.round(wUnit * m.side),
    automated: Math.round(wUnit * m.automated),
  };
}

/** Gear pounds on one electric: fixtures plus the distribution allowance.
 *  `front` is skipped unconditionally — FOH positions are not lineset battens. */
export function electricGearLb(
  counts: Partial<FixtureCounts>,
  battenLenFt: number,
  gear: GearDefaults = DEFAULT_GEAR
): number {
  const f = gear.fixtureLb;
  const fixtures =
    (counts.par || 0) * f.par +
    (counts.cyc || 0) * f.cyc +
    (counts.side || 0) * f.side +
    (counts.automated || 0) * f.automated;
  return fixtures + gear.distributionLbPerFt * Math.max(0, battenLenFt);
}

/** Gear pounds on one Shell line — the flown CEILING only.
 *  Acoustic shell TOWERS are floor-supported and load no batten (Jeff). */
export function shellGearLb(
  d: VenueDims,
  shellIntervalFt: number,
  gear: GearDefaults = DEFAULT_GEAR
): number {
  return gear.shellPsf * (d.proWidthFt * Math.max(0, shellIntervalFt));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on all 8 new lines.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/goods.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): fixture, distribution and shell ceiling gear weights"
```

---

### Task 5: PRO dimensions on the lineset inputs + v3 save format

**Files:**
- Modify: `src/lib/design/lineset.ts:26-65` (`LinesetInputs`, `DEFAULT_LINESET_INPUTS`)
- Modify: `src/app/(app)/design/lineset/lineset-builder.tsx:44-60` (`CombinedLinesetData`, `CombinedInitial`)
- Modify: `src/app/(app)/design/lineset/page.tsx` (`resolveInitial`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `GoodsTier`, `GearDefaults` from tasks 3 and 4.
- Produces: `LinesetInputs.proWidthFt`, `.proHeightFt`; `CombinedLinesetData` at `v: 3` with `tier` and `gear`.

Placement math must not change. `generateLineset()` uses stage width/depth only; the new fields feed goods geometry exclusively.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

```ts
/* --- PRO dims on lineset inputs (task 5) --- */
ok(DEFAULT_LINESET_INPUTS.proWidthFt === 40 && DEFAULT_LINESET_INPUTS.proHeightFt === 20, "lineset defaults carry PRO dims");
ok(DEFAULT_LINESET_INPUTS.stageWidthFt === 50, "stage width default is unchanged at 50ft");
ok(DEFAULT_LINESET_INPUTS.proWidthFt !== DEFAULT_LINESET_INPUTS.stageWidthFt, "PRO width and stage width are distinct values");

const baseOut = generateLineset(DEFAULT_LINESET_INPUTS);
const wideProOut = generateLineset({ ...DEFAULT_LINESET_INPUTS, proWidthFt: 44, proHeightFt: 26 });
ok(baseOut.schedule.length === wideProOut.schedule.length, "changing PRO dims does NOT change line placement");
ok(baseOut.summary.activeSlotCount === wideProOut.summary.activeSlotCount, "PRO dims do not affect the 8in grid");
```

Add `generateLineset` and `DEFAULT_LINESET_INPUTS` to the imports if not already present.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `proWidthFt` is not a property of `DEFAULT_LINESET_INPUTS`.

- [ ] **Step 3: Add the fields**

In `src/lib/design/lineset.ts`, add to the `LinesetInputs` type immediately after `stageDepthIn`:

```ts
  /** Proscenium opening width (ft). Drives drape WIDTHS. Distinct from
   *  stageWidthFt, which is wall-to-wall and drives placement. */
  proWidthFt: number;
  /** Proscenium opening height (ft), floor to header. Drives drape HEIGHTS. */
  proHeightFt: number;
```

And to `DEFAULT_LINESET_INPUTS`, after `stageDepthIn: 0,`:

```ts
  proWidthFt: 40,
  proHeightFt: 20,
```

- [ ] **Step 4: Bump the save format to v3**

In `lineset-builder.tsx`, replace the `CombinedLinesetData` and `CombinedInitial` types:

```ts
/** v3 combined save format. Adds the PRO dimensions (carried inside `inputs`),
 *  the goods tier and the gear defaults. Legacy shapes (v2, bare LinesetInputs
 *  from the old Builder, {defaults,lines} from the old Weights tool) are
 *  adapted on load by the route page — see resolveInitial() in page.tsx. */
export type CombinedLinesetData = {
  v: 3;
  inputs: LinesetInputs;
  defaults: WeightDefaults;
  loads: Record<string, LineLoad>;
  extras: (WeightLine & { xid: string })[];
  tier: GoodsTier;
  gear: GearDefaults;
};

export type CombinedInitial = {
  inputs?: LinesetInputs;
  defaults?: WeightDefaults;
  loads?: Record<string, LineLoad>;
  extras?: (WeightLine & { xid: string })[];
  tier?: GoodsTier;
  gear?: GearDefaults;
  /** set when the opened design was a legacy Weights record — saving creates
   *  a new combined design instead of overwriting the old one */
  legacyWeights?: boolean;
};
```

Add to the imports in `lineset-builder.tsx`:

```ts
import { DEFAULT_GEAR, type GoodsTier, type GearDefaults } from "@/lib/design/goods";
```

- [ ] **Step 5: Adapt legacy saves**

In `src/app/(app)/design/lineset/page.tsx`, `resolveInitial()` is at line 24 and its combined-format guard at **line 29** currently reads:

```ts
  if (design.kind === "lineset" && d && (d as { v?: number }).v === 2) {
```

**This must accept both versions, or every v3 record you save will fail to reopen and silently fall through to the legacy branch.** Widen it:

```ts
  const ver = (d as { v?: number }).v;
  if (design.kind === "lineset" && d && (ver === 2 || ver === 3)) {
```

Then ensure the `inputs` object of every returned `CombinedInitial` is passed through this backfill, so a v2 record without PRO dims still opens:

```ts
/** v2 records predate the PRO dimensions. Backfill them from the defaults so an
 *  old saved design opens with working goods geometry rather than zero-size
 *  drapes. The stage dimensions in the record are preserved as-is. */
function backfillProDims(inp: Partial<LinesetInputs> | undefined): LinesetInputs {
  return {
    ...DEFAULT_LINESET_INPUTS,
    ...(inp || {}),
    proWidthFt: inp?.proWidthFt ?? DEFAULT_LINESET_INPUTS.proWidthFt,
    proHeightFt: inp?.proHeightFt ?? DEFAULT_LINESET_INPUTS.proHeightFt,
  };
}
```

Apply it to the `inputs` field of every returned `CombinedInitial`, and default `tier` to `"better"` and `gear` to `DEFAULT_GEAR`.

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run test:specs
```

Expected: PASS on all 5 new lines, and **all 138+ pre-existing assertions still pass** — placement must be untouched.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. Every construction site of `LinesetInputs` must supply the two new required fields.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/lineset.ts "src/app/(app)/design/lineset/lineset-builder.tsx" "src/app/(app)/design/lineset/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(lineset): PRO width/height inputs and v3 save format"
```

---

### Task 6: Apply the rules — every line arrives with a weight

**Files:**
- Modify: `src/app/(app)/design/lineset/lineset-builder.tsx:139-173` (the `rows` and `totals` memos)
- Test: `scripts/test-review-and-spec.ts` + drive the app

**Interfaces:**
- Consumes: `drapeRule`, `electricCounts`, `electricGearLb`, `shellGearLb` from tasks 3 and 4; `fabricFromPart` from task 2.
- Produces: `ruleToWeightLine(rule, fabrics)` — a pure helper exported from `goods.ts` so it can be asserted without React.

The current merged-row memo marks a line "specified" only when a hand-entered `LineLoad` exists. After this task, **a rule also counts as specified**, and hand-entered values become overrides layered on top.

- [ ] **Step 1: Write the failing test**

Insert above the final `console.log` line:

```ts
/* --- rule -> WeightLine, override precedence (task 6) --- */
const wlDraw = ruleToWeightLine(drapeRule("Draw", DIMS36, "better")!, [
  { sku: "RB-MARVEL", desc: "21 oz Marvel Velour", oz: 21, ozBasis: "lin-yd" as const, boltWidthIn: 54 },
]);
ok(wlDraw.w === 20 && wlDraw.h === 19, "rule dimensions carry into the WeightLine unchanged");
ok(wlDraw.full === 50, "fullness rides on the line, not the schedule default");
ok(wlDraw.fab === "21 oz Marvel Velour", "the SKU resolves to a fabric the weight math recognises");

const merged = { ...wlDraw, h: 24 };
ok(merged.h === 24 && merged.w === 20, "a hand-entered height overrides the rule; untouched fields keep it");

const wlCyc = ruleToWeightLine(drapeRule("CYC", DIMS36, "better")!, [
  { sku: "RB-MUS-SL", desc: "Muslin, seamless", oz: 6, ozBasis: "sq-yd" as const, boltWidthIn: 120 },
]);
ok(wlCyc.full === 0, "the cyc reaches computeSetWeight at 0% fullness, not the 50% default");
```

Add `ruleToWeightLine` to the `@/lib/design/goods` import.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:specs
```

Expected: FAIL — `ruleToWeightLine` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/lib/design/goods.ts`:

```ts
/** Shape of a catalog fabric row, narrowed to what goods geometry needs. */
export type GoodsFabric = {
  sku: string;
  desc: string;
  oz?: number;
  ozBasis?: "lin-yd" | "sq-yd";
  boltWidthIn?: number;
};

/**
 * Convert a DrapeRule into the field subset computeSetWeight() consumes.
 *
 * `full` is set explicitly on every line rather than left to inherit the
 * schedule default — the cyc MUST arrive at 0 and inheriting 50 would run it
 * roughly 50% heavy.
 */
export function ruleToWeightLine(
  rule: DrapeRule,
  fabrics: GoodsFabric[]
): { fab?: string; w: number; h: number; full: number; qty: number; track?: string; chain: string } {
  const part = fabrics.find((f) => f.sku === rule.fabricSku);
  return {
    fab: part ? part.desc : undefined,
    w: rule.w,
    h: rule.h,
    full: rule.fullness,
    qty: rule.qty,
    track: rule.track || undefined,
    chain: rule.chain,
  };
}
```

Note: `fab` is the fabric **display name**, because `computeSetWeight` looks fabric up by name via `fabByName()`. Task 2's `fabricFromPart` is what teaches that lookup the catalog weights; wiring `computeSetWeight` to prefer the catalog over `FABLIB` is out of scope for this task and is covered by the fabric-join assertions already written.

- [ ] **Step 4: Wire the memo**

In `lineset-builder.tsx`, replace the `rows` memo (currently lines 139-150) with:

```tsx
  const dims = useMemo(
    () => ({
      proWidthFt: inp.proWidthFt,
      proHeightFt: inp.proHeightFt,
      stageWidthFt: inp.stageWidthFt,
      stageDepthFt: inp.stageDepthFt,
    }),
    [inp.proWidthFt, inp.proHeightFt, inp.stageWidthFt, inp.stageDepthFt]
  );

  /* merged rows: generated line + its rule + any hand-entered override.
     Ordering matters — the rule supplies defaults, `...load` spreads AFTER so
     anything Jeff typed wins. */
  const rows = useMemo(
    () =>
      out.schedule.map((s, i) => {
        const key = keys[i];
        const load = loads[key];
        const rule = drapeRule(s.type, dims, tier);
        const battenLen = load?.batten ?? def.battenlen;

        let base: Partial<WeightLine> = {};
        if (rule) {
          base = ruleToWeightLine(rule, fabrics);
        } else if (s.type === "Electric") {
          const kind = s.name === "CYC Electric" ? "cyc" : "regular";
          base = { gear: electricGearLb(electricCounts(dims, "medium", kind), battenLen, gear) };
        } else if (s.type === "Shell") {
          base = { gear: shellGearLb(dims, inp.shellIntervalFt, gear) };
        }

        const ruled = !!rule || s.type === "Electric" || s.type === "Shell";
        const line: WeightLine = { name: load?.nameOverride || s.name, ...base, ...load };
        const specified = ruled || !!load;
        const c = specified ? computeSetWeight(line, def) : null;
        return { s, key, load, rule, ruled, specified, line, c };
      }),
    [out.schedule, keys, loads, def, dims, tier, gear, fabrics, inp.shellIntervalFt]
  );
```

`fabrics` is the catalog Fabric rows. Add it to the component props alongside `customers`, and pass it from `page.tsx` using the existing `byCategory("Fabric")` call already made in `design/designs/page.tsx`:

```tsx
  fabrics = [],
}: {
  // ...existing props
  fabrics?: GoodsFabric[];
```

Add `tier` and `gear` component state next to the existing `inp` / `def` state:

```tsx
  const [tier, setTier] = useState<GoodsTier>(initial?.tier || "better");
  const [gear, setGear] = useState<GearDefaults>(initial?.gear || DEFAULT_GEAR);
```

- [ ] **Step 5: Add the two PRO inputs to the form**

In the dimensions grid (currently lines 304-307), add after the Depth (in) field:

```tsx
            <div><span style={label}>PRO width (ft)</span><NumF v={inp.proWidthFt} set={(n) => set("proWidthFt", n)} /></div>
            <div><span style={label}>PRO height (ft)</span><NumF v={inp.proHeightFt} set={(n) => set("proHeightFt", n)} /></div>
```

- [ ] **Step 6: Verify in the app**

Start the preview (never `npm run build` while it runs):

```bash
npm run dev
```

Navigate to `/design/lineset`. Expected, with the 50 × 30 stage and 40 × 20 PRO defaults:
- Every Draw, Midstage Draw, Rear, Legs, Border and CYC line shows a weight, not "NOT SPECIFIED".
- Every Electric line shows a gear weight.
- Shell lines show roughly `2.5 × 40 × 12 = 1,200 lb`.
- Changing PRO height re-weights every drape and leaves the slot layout untouched.

- [ ] **Step 7: Run the full suite**

```bash
npm run test:specs
```

Expected: PASS, including all pre-existing assertions.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/design/lineset/lineset-builder.tsx" "src/app/(app)/design/lineset/page.tsx" src/lib/design/goods.ts scripts/test-review-and-spec.ts
git commit -m "feat(lineset): auto-fill every line from the drape rules and gear weights"
```

---

### Task 7: Override affordances and CSV

**Files:**
- Modify: `src/app/(app)/design/lineset/lineset-builder.tsx` (cell rendering, `exportCsv` at line 185)
- Test: drive the app

**Interfaces:**
- Consumes: `rows[].rule`, `rows[].ruled`, `rows[].load` from task 6.
- Produces: no new exports.

The file header already documents three visually distinct field classes — *generated / hand-entered / calculated*. Rule-derived values are a fourth state and must not read as hand-entered.

- [ ] **Step 1: Distinguish rule-derived from overridden**

In the per-line editor, a field whose value came from the rule renders in the muted "generated" style; a field present in `loads[key]` renders in the "hand-entered" style. The predicate for one field:

```tsx
const isOverride = (key: string, field: keyof WeightLine) =>
  loads[key] !== undefined && loads[key]![field as keyof LineLoad] !== undefined;
```

- [ ] **Step 2: Add reset-to-rule**

Add a control in each expanded line editor that clears only that line's overrides, reusing the existing `clearLoad`. There is no shared `btn` style constant in this file — the inline style below is self-contained and matches the existing `label` constant's palette (`#5b616e`):

```tsx
{loads[key] && rows.find((r) => r.key === key)?.rule && (
  <button
    type="button"
    onClick={() => clearLoad(key)}
    style={{
      marginTop: 8, fontSize: 11.5, fontWeight: 600, color: "#5b616e",
      background: "#fff", border: "1px solid #d5d8de", borderRadius: 5,
      padding: "4px 9px", cursor: "pointer",
    }}
  >
    ↺ Reset to rule
  </button>
)}
```

- [ ] **Step 3: Fix the CSV export**

In `exportCsv` (line 185), the `check` expression emits `"NOT SPECIFIED"` from `!r.c`. Since ruled lines always compute, replace the per-row source values so the CSV reports the effective line rather than only hand-entered fields:

```tsx
      return [
        i + 1, r.s.slot, r.s.dsPositionLabel, r.s.type, r.line.name,
        r.line.fab || "", r.line.w ?? "", r.line.h ?? "", r.line.full ?? def.full, r.line.qty ?? 1, r.line.gear ?? "",
        r.c ? MODE_LABEL[mode] : "", r.c && mode === "motor" ? r.line.hoist || def.hoist : "",
        r.c ? Math.round(r.c.onBatten) : "", check,
      ];
```

Add a column recording provenance so a reader can tell computed from typed. Extend the header:

```tsx
    const header = ["#", "Slot", "Downstage", "Type", "Name", "Fabric", "W(ft)", "H(ft)", "Full%", "Qty", "Gear(lb)", "Mode", "Hoist", "Weight on batten(lb)", "Check", "Source"];
```

and append to each row: `r.load ? "overridden" : r.ruled ? "rule" : "manual"`.

- [ ] **Step 4: Verify in the app**

With `npm run dev` running, at `/design/lineset`:
- Rule-derived values render muted; typing one turns it hand-entered.
- "Reset to rule" restores the computed value and the muted styling.
- Export CSV — every line has a weight, and the Source column reads `rule` or `overridden`.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm run test:specs && npx tsc --noEmit
```

Expected: `ALL PASSED`, no type errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/design/lineset/lineset-builder.tsx"
git commit -m "feat(lineset): override affordances, reset-to-rule, CSV provenance column"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 drape rule table | 3 |
| §2 PRO width + height inputs | 5, 6 |
| §3 architecture / goods.ts | 3, 4, 6 |
| §3.1 VenueDims shared storage | 1, 5 |
| §3 override behaviour | 6, 7 |
| §4 fixture + distribution + shell weights | 4 |
| §5 fabric catalog join + muslin SKU | 2 |
| §6 no pricing changes | enforced by Global Constraints |
| Testing: rule table, override precedence, backward compat, fabric join, VenueDims round-trip | 3, 6, 5, 2, 1 |

**Known gap, deliberate:** the spec's end-to-end test ("a grand drape reconciled by hand once against the §1 geometry") is a human verification step, not automatable — it belongs in Jeff's review after task 6, and step 6 of that task is where it happens.

**Type consistency check:** `VenueDims` field names are identical across tasks 1, 3, 4 and 6. `DrapeRule.fullness` (percent) maps to `WeightLine.full` (percent) in `ruleToWeightLine` — same unit, different name, deliberate because it matches each consumer's existing vocabulary. `GoodsFabric.sku` matches `DrapeRule.fabricSku` by value.

**One risk worth naming:** task 6 changes what "specified" means. Any saved v2 design whose totals were computed from a partial set of hand-entered lines will now report a **higher** total, because previously-unspecified lines start contributing. That is the intended behaviour, but it means a reopened old design will not match its remembered number — worth telling Jeff before he reads a saved estimate and thinks something broke.
