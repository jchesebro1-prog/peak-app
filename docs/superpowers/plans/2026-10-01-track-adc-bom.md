# Track configurator — ADC's real BOM (#291) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a track series price ADC's real bill of materials — several stick lengths, pipe clamps per batten point, lap clamps on bi-parting batten tracks, a ceiling splice, a one-way dead-end pulley and a tie-off allowance on the operating line.

**Architecture:** Pure model changes in `src/lib/track-series.ts` (types, roles, sanitize, two helpers) and `src/lib/track-engine.ts` (quantity rules); `estimator/track-bom.ts` prices a row from the SKU the engine picked; the admin screen edits a stick-length list. Every new role is optional — only priced when mapped — so a #274 series prices exactly as before.

**Tech Stack:** Next.js 16 App Router, TypeScript, the single spec harness `scripts/test-review-and-spec.ts` (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-10-01-track-adc-bom-design.md`

## Global Constraints

- Work only in this worktree: `/Users/sm/Downloads/peak-app/.claude/worktrees/track-adc` (branch `feat/291-track-adc-bom`). Never `git stash`. Commit instead.
- `src/lib/track-series.ts` and `src/lib/track-engine.ts` stay pure: track-engine imports only `@/lib/track-series`; track-series imports nothing (a #274 test enforces it).
- **No SKUs are seeded or invented** in code. Test fixtures use `P-<role>` / `S-<len>` placeholders only.
- Every new role is optional: never added to `ALWAYS_REQUIRED_ROLES`, `MOUNTING_ROLES`, `CORD_ROLES` or `requiredRolesFor`. `activationProblems` is unchanged.
- **Design change from the spec, §3 operating line:** the +10' tie-off is a per-series field `lineAllowanceFt` (default 0; the ADC series will carry 10), not a hard-coded constant — so non-ADC series and every #274 expectation are untouched. The spec is updated in Task 3.
- Node is at `~/.local/node/bin` (prefix commands with `export PATH=$HOME/.local/node/bin:$PATH`).
- Gates (Task 3): `npx tsc --noEmit` 0 errors; `npm run test:specs` 0 FAIL; `npm run test:smoke` 0 fail; `npx eslint` on changed files — no new errors/warnings vs the base commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Model + engine + BOM (pure) with tests

**Files:**
- Modify: `src/lib/track-series.ts`
- Modify: `src/lib/track-engine.ts`
- Modify: `src/app/(app)/estimator/track-bom.ts`
- Modify: `scripts/test-review-and-spec.ts` (two #274 fixture tweaks + a new `#291` block appended at EOF)

**Interfaces:**
- Produces (track-series.ts):
  - `TrackRole` gains `"ceilingSplice" | "pipeClamp" | "lapClamp" | "deadPulleyOneWay"`
  - `export type TrackStick = { lengthFt: number; sku: string }`
  - `TrackSeries` gains `sticks?: TrackStick[]` and `lineAllowanceFt?: number`
  - `export const OPTIONAL_ROLES: readonly TrackRole[]`
  - `export function seriesSticks(series: Pick<TrackSeries, "sticks" | "stickLengthFt" | "parts">): TrackStick[]`
  - `export function seriesSkus(series: Pick<TrackSeries, "sticks" | "parts">): string[]`
  - `TRACK_LIMITS.sticks = 12`, `TRACK_LIMITS.lineAllowanceFt = 50`
- Produces (track-engine.ts): `TrackRow = { role: TrackRole; qty: number; sku?: string; lengthFt?: number }`
- Produces (track-bom.ts): a `track` row's `label` reads `Track (22' stick)`; part resolved from `row.sku` first.

- [ ] **Step 1: Keep the #274 fixtures meaning what they meant**

In `scripts/test-review-and-spec.ts`, the #274 fixture maps *every* role. Mapping the new optional roles would change #274's worked examples, so exclude them. Replace line ~37503:

```ts
const T274_ALL_PARTS: Partial<Record<T274Role, { sku: string }>> = Object.fromEntries(t274Roles.map((r) => [r, { sku: `P-${r}` }]));
```

with:

```ts
// #291 added optional roles (ceiling splice, pipe clamp, lap clamp, one-way dead end); #274's fixture keeps its original twelve.
const T274_V1_ROLES = t274Roles.filter((r) => !["ceilingSplice", "pipeClamp", "lapClamp", "deadPulleyOneWay"].includes(r));
const T274_ALL_PARTS: Partial<Record<T274Role, { sku: string }>> = Object.fromEntries(T274_V1_ROLES.map((r) => [r, { sku: `P-${r}` }]));
```

And extend `T274B_COST` (line ~37855) so it still covers every `TrackRole`:

```ts
const T274B_COST: Record<T274Role, number> = {
  track: 50, curved: 70, splice: 5, carrier: 2, masterCarrier: 12, endStop: 4, battenClamp: 6, ceilingHanger: 8,
  livePulley: 30, deadPulley: 30, floorBlock: 40, operatingLine: 0.5,
  ceilingSplice: 9, pipeClamp: 3, lapClamp: 7, deadPulleyOneWay: 25,
};
```

- [ ] **Step 2: Append the failing #291 block at the end of `scripts/test-review-and-spec.ts`**

```ts
/* ============================================================================
   #291 — the track configurator prices ADC's real bill of materials: several
   stick lengths (shortest stick that covers an equal split), optional pipe
   clamp / lap clamp / ceiling splice / one-way dead-end roles, and a per-series
   operating-line tie-off allowance. Pure; placeholder SKUs only.
   ============================================================================ */
import {
  OPTIONAL_ROLES as t291Optional,
  TRACK_ROLES as t291Roles,
  TRACK_ROLE_LABELS as t291Labels,
  activationProblems as t291Problems,
  requiredRolesFor as t291Required,
  sanitizeTrackSeries as t291Sanitize,
  seriesSkus as t291Skus,
  seriesSticks as t291Sticks,
  type TrackRole as T291Role,
  type TrackSeries as T291Series,
} from "@/lib/track-series";
import { trackQuantities as t291Qty, type TrackConfig as T291Config } from "@/lib/track-engine";
import { trackBom as t291Bom } from "@/app/(app)/estimator/track-bom";
import type { TrackPart as T291Part } from "@/app/(app)/estimator/types";

const T291_STICKS = [12, 14, 16, 18, 20, 22, 24].map((l) => ({ lengthFt: l, sku: `S-${l}` }));
const T291_BASE_PARTS: Partial<Record<T291Role, { sku: string }>> = Object.fromEntries(
  ["splice", "carrier", "masterCarrier", "endStop", "battenClamp", "ceilingHanger", "livePulley", "deadPulley", "floorBlock", "operatingLine"].map((r) => [r, { sku: `P-${r}` }])
);
function t291Series(over: Partial<T291Series> = {}): T291Series {
  return t291Sanitize({
    id: "adc-280-black", name: "ADC 280 Black", manufacturer: "ADC", sticks: T291_STICKS, carrierSpacingIn: 12, hangerSpacingFt: 7, overlapFt: 2,
    parts: { ...T291_BASE_PARTS }, active: true, ...over,
  })!;
}
const t291All = (extra: Partial<Record<T291Role, { sku: string }>>) => t291Series({ parts: { ...T291_BASE_PARTS, ...extra } });
function t291Cfg(over: Partial<T291Config> = {}): T291Config {
  return { seriesId: "adc-280-black", operation: "oneway", runFt: 40, curved: false, mounting: "batten", qty: 1, ...over };
}
function t291Map(cfg: T291Config, s: T291Series): Partial<Record<T291Role, number>> & { errors: string[]; stick?: string } {
  const r = t291Qty(cfg, s);
  const out: Partial<Record<T291Role, number>> & { errors: string[]; stick?: string } = { errors: r.errors };
  for (const row of r.rows) {
    out[row.role] = row.qty;
    if (row.role === "track") out.stick = `${row.lengthFt}:${row.sku}`;
  }
  return out;
}

// ---- roles + sanitize ----
{
  ok(["ceilingSplice", "pipeClamp", "lapClamp", "deadPulleyOneWay"].every((r) => t291Roles.includes(r as T291Role) && t291Optional.includes(r as T291Role) && !!t291Labels[r as T291Role]),
    "#291 roles: ceiling splice, pipe clamp, lap clamp and one-way dead end are roles, labelled and optional");
  ok(t291Optional.every((r) => !t291Required({ operation: "biparting", curved: false, mounting: "batten" }).includes(r) && !t291Required({ operation: "oneway", curved: false, mounting: "ceiling" }).includes(r)),
    "#291 roles: no optional role is ever required");
  const s = t291Sanitize({
    name: "x", sticks: [{ lengthFt: 20, sku: " S-20 " }, { lengthFt: "12", sku: "S-12" }, { lengthFt: 20, sku: "DUP" }, { lengthFt: 0, sku: "Z" }, { lengthFt: 99, sku: "BIG" }, { lengthFt: 16 }, "junk"],
    parts: { track: { sku: "IGNORED" }, pipeClamp: { sku: "PC" } },
  })!;
  ok(JSON.stringify(s.sticks) === JSON.stringify([{ lengthFt: 12, sku: "S-12" }, { lengthFt: 20, sku: "S-20" }, { lengthFt: 40, sku: "BIG" }]),
    `#291 sanitize: sticks trimmed, numeric strings read, ≤0 / skuless / non-object dropped, over-max clamped to 40, first of a duplicate length kept, sorted ascending (got ${JSON.stringify(s.sticks)})`);
  ok(s.stickLengthFt === 40 && s.parts.track?.sku === "BIG" && s.parts.pipeClamp?.sku === "PC",
    "#291 sanitize: stickLengthFt and parts.track are derived from the longest stick; new roles are kept");
  const many = t291Sanitize({ name: "x", sticks: Array.from({ length: 20 }, (_, i) => ({ lengthFt: i + 1, sku: `S${i + 1}` })) })!;
  ok(many.sticks!.length === 12 && many.sticks![11].lengthFt === 12, "#291 sanitize: at most 12 stick lengths");
  const legacy = t291Sanitize({ name: "x", stickLengthFt: 10, parts: { track: { sku: "T" } } })!;
  ok(legacy.sticks === undefined && legacy.stickLengthFt === 10 && JSON.stringify(t291Sticks(legacy)) === JSON.stringify([{ lengthFt: 10, sku: "T" }]),
    "#291 sanitize: a #274 series (no sticks) keeps its shape and reads as one stick");
  ok(t291Sticks(t291Sanitize({ name: "x" })!).length === 0, "#291 seriesSticks: no stick length and no sticks → none");
  ok(t291Sanitize({ name: "x", lineAllowanceFt: "10" })!.lineAllowanceFt === 10 && !("lineAllowanceFt" in t291Sanitize({ name: "x", lineAllowanceFt: -2 })!) && t291Sanitize({ name: "x", lineAllowanceFt: 500 })!.lineAllowanceFt === 50,
    "#291 sanitize: lineAllowanceFt reads numbers, drops ≤0, clamps to 50");
  ok(JSON.stringify(t291Skus(t291All({ pipeClamp: { sku: "PC" } })).sort()) === JSON.stringify([...T291_STICKS.map((x) => x.sku), ...Object.values(T291_BASE_PARTS).map((p) => p!.sku), "PC"].sort()),
    "#291 seriesSkus: every mapped part plus every stick, once each");
  ok(t291Problems(t291Series()).length === 0, "#291 activation: a sticks-only series (no hand-set stickLengthFt) can be active");
}

// ---- stick choice ----
{
  ok(t291Map(t291Cfg({ runFt: 42 }), t291Series()).stick === "22:S-22" && t291Map(t291Cfg({ runFt: 42 }), t291Series()).track === 2 && t291Map(t291Cfg({ runFt: 42 }), t291Series()).splice === 1,
    "#291 sticks: 42' on 12–24' sticks → 2 × 22' (not 3 × 20'), 1 splice");
  ok(t291Map(t291Cfg({ runFt: 35 }), t291Series()).stick === "18:S-18" && t291Map(t291Cfg({ runFt: 35 }), t291Series()).track === 2,
    "#291 sticks: ADC's own example — 35' ships as 2 × 18'");
  ok(t291Map(t291Cfg({ runFt: 10 }), t291Series()).stick === "12:S-12" && t291Map(t291Cfg({ runFt: 10 }), t291Series()).track === 1,
    "#291 sticks: a 10' track is one 12' stick (the shortest that covers it)");
  ok(t291Map(t291Cfg({ runFt: 24 }), t291Series()).stick === "24:S-24" && t291Map(t291Cfg({ runFt: 24 }), t291Series()).splice === undefined,
    "#291 sticks: exactly the longest stick is one piece, no splice");
  const bp = t291Map(t291Cfg({ operation: "biparting", runFt: 40 }), t291Series());
  ok(bp.stick === "22:S-22" && bp.track === 2, "#291 sticks: bi-parting adds the 2' overlap first — 42' → 2 × 22'");
  const gappy = t291Series({ sticks: [{ lengthFt: 16, sku: "S-16" }, { lengthFt: 20, sku: "S-20" }] });
  ok(t291Map(t291Cfg({ runFt: 42 }), gappy).stick === "16:S-16" && t291Map(t291Cfg({ runFt: 42 }), gappy).track === 3,
    "#291 sticks: 500's 16'/20' — 42' → 3 pieces of 14' → three 16' sticks");
  const one = t291Series({ sticks: [{ lengthFt: 20, sku: "S-20" }] });
  ok(t291Map(t291Cfg({ runFt: 42 }), one).stick === "20:S-20" && t291Map(t291Cfg({ runFt: 42 }), one).track === 3,
    "#291 sticks: a single 20' stick still buys 3 × 20' for 42' (#274 behaviour)");
  const three = t291Qty(t291Cfg({ runFt: 42, qty: 3 }), t291Series()).rows.find((r) => r.role === "track")!;
  ok(three.qty === 6 && three.sku === "S-22" && three.lengthFt === 22, "#291 sticks: × qty keeps the chosen stick's SKU and length on the row");
  ok(t291Qty(t291Cfg(), t291Sanitize({ name: "x", parts: { ...T291_BASE_PARTS } })!).errors.some((e) => /stick length/.test(e)),
    "#291 sticks: a straight run with no sticks and no stick length is refused as before");
}

// ---- optional roles ----
{
  const plain = t291Map(t291Cfg({ operation: "biparting", runFt: 40 }), t291Series());
  ok(!plain.pipeClamp && !plain.lapClamp && !plain.ceilingSplice && !plain.deadPulleyOneWay, "#291 optional: unmapped optional roles emit nothing");
  const full = t291All({ pipeClamp: { sku: "PC" }, lapClamp: { sku: "LC" }, ceilingSplice: { sku: "CS" }, deadPulleyOneWay: { sku: "DO" } });
  const bpBatten = t291Map(t291Cfg({ operation: "biparting", runFt: 40 }), full);
  ok(bpBatten.pipeClamp === bpBatten.battenClamp && bpBatten.battenClamp === 7 && bpBatten.lapClamp === 2 && bpBatten.splice === 1 && !bpBatten.ceilingSplice && bpBatten.deadPulley === 1 && !bpBatten.deadPulleyOneWay,
    "#291 optional: bi-parting batten — one pipe clamp per hanging point (ceil(42/7)+1 = 7), 2 lap clamps, suspended splice, bi-part dead end");
  const bpCeil = t291Map(t291Cfg({ operation: "biparting", runFt: 40, mounting: "ceiling" }), full);
  ok(!bpCeil.pipeClamp && !bpCeil.lapClamp && bpCeil.ceilingSplice === 1 && !bpCeil.splice && bpCeil.ceilingHanger === 7,
    "#291 optional: ceiling — no pipe or lap clamps, the ceiling splice replaces the splice");
  ok(t291Map(t291Cfg({ operation: "biparting", runFt: 40, mounting: "ceiling" }), t291Series()).splice === 1, "#291 optional: ceiling without a ceiling splice mapped falls back to the splice");
  ok(!t291Map(t291Cfg({ operation: "biparting", runFt: 40 }), t291Sanitize({ ...full, overlapFt: 0 })!).lapClamp, "#291 optional: no lap clamps when the series has no overlap (single-channel bi-part)");
  const ow = t291Map(t291Cfg({ operation: "oneway" }), full);
  ok(ow.deadPulleyOneWay === 1 && !ow.deadPulley && !ow.lapClamp && ow.pipeClamp === ow.battenClamp, "#291 optional: one-way uses the one-way dead end, no lap clamps, still pipe clamps");
  const wa = t291Map(t291Cfg({ operation: "walkalong" }), full);
  ok(!wa.deadPulley && !wa.deadPulleyOneWay && !wa.lapClamp && wa.pipeClamp === wa.battenClamp, "#291 optional: walk-along has no dead end and no lap clamps");
  const curvedCeil = t291Map(t291Cfg({ operation: "walkalong", curved: true, radiusFt: 10, runFt: 20, mounting: "ceiling" }), t291Sanitize({ ...full, curvedSectionFt: 5, parts: { ...full.parts, curved: { sku: "CV" } } })!);
  ok(curvedCeil.curved === 4 && curvedCeil.ceilingSplice === 3 && !curvedCeil.splice, "#291 optional: curved ceiling runs use the ceiling splice too");
  const two = t291Qty(t291Cfg({ operation: "biparting", runFt: 40, qty: 2 }), full).rows;
  ok(two.find((r) => r.role === "lapClamp")!.qty === 4 && two.find((r) => r.role === "pipeClamp")!.qty === 14, "#291 optional: × qty multiplies lap and pipe clamps");
}

// ---- operating line allowance ----
{
  ok(t291Map(t291Cfg({ runFt: 40, trimFt: 20 }), t291Series()).operatingLine === 120, "#291 line: no allowance → ceil(2×40 + 2×20) = 120 (#274 rule)");
  ok(t291Map(t291Cfg({ runFt: 40, trimFt: 20 }), t291Series({ lineAllowanceFt: 10 })).operatingLine === 130, "#291 line: ADC's +10' tie-off → 130");
  ok(!t291Map(t291Cfg({ operation: "walkalong" }), t291Series({ lineAllowanceFt: 10 })).operatingLine, "#291 line: walk-along still has no line");
}

// ---- BOM ----
{
  const parts: Record<string, T291Part> = {};
  for (const sku of [...T291_STICKS.map((x) => x.sku), ...Object.values(T291_BASE_PARTS).map((p) => p!.sku), "PC", "LC"])
    parts[sku] = { sku, desc: `Test ${sku}`, cost: sku.startsWith("S-") ? Number(sku.slice(2)) * 10 : 1, list: 0, unit: "ea", mfr: "ADC" };
  const s = t291All({ pipeClamp: { sku: "PC" }, lapClamp: { sku: "LC" } });
  const bom = t291Bom(t291Cfg({ operation: "biparting", runFt: 40 }), s, parts, 0.25);
  const trk = bom.rows.find((r) => r.role === "track")!;
  ok(bom.errors.length === 0 && trk.sku === "S-22" && trk.cost === 220 && trk.qty === 2 && trk.label === "Track (22' stick)",
    "#291 BOM: the track row is priced from the stick the engine chose (2 × S-22 at $220) and labelled with its length");
  ok(bom.rows.some((r) => r.role === "pipeClamp" && r.sku === "PC") && bom.rows.some((r) => r.role === "lapClamp" && r.qty === 2), "#291 BOM: pipe and lap clamps are priced rows");
  const missing = t291Bom(t291Cfg({ runFt: 42 }), s, Object.fromEntries(Object.entries(parts).filter(([k]) => k !== "S-22")), 0.25);
  ok(missing.errors.some((e) => /no part for Track — map it/.test(e)), "#291 BOM: a chosen stick deleted from the catalog blocks the line, naming Track");
}
```

- [ ] **Step 3: Run the harness to confirm the #291 block fails (missing exports)**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | tail -20`
Expected: a TypeScript/tsx import error or FAIL lines for `#291` (e.g. `OPTIONAL_ROLES` is not exported).

- [ ] **Step 4: Implement `src/lib/track-series.ts`**

1. Extend the role union (after `ceilingHanger`):

```ts
  | "ceilingHanger" // ceiling / structure mounting
  | "ceilingSplice" // #291 optional: replaces `splice` on ceiling mounting
  | "pipeClamp" // #291 optional: one per batten hanging point, alongside battenClamp
  | "lapClamp" // #291 optional: 2 per bi-parting batten track (two lapped legs)
  | "deadPulleyOneWay"; // #291 optional: replaces `deadPulley` on one-way
```

2. Add the stick type and new optional fields on `TrackSeries` (after `parts`):

```ts
/** #291 — one straight stick length the series is mapped for. */
export type TrackStick = { lengthFt: number; sku: string };
```

```ts
  /**
   * #291 — every straight stick length mapped, ascending. When present it is
   * the source of truth: sanitize derives stickLengthFt (the longest) and
   * parts.track (its SKU). Absent = a #274 series (one stick: stickLengthFt + parts.track).
   */
  sticks?: TrackStick[];
  /** #291 — extra operating line per track for tie-off, ft (ADC: 10). Absent = 0. */
  lineAllowanceFt?: number;
```

3. Replace `TRACK_ROLES` (order = the admin screen's order) and add the labels/names/optional list:

```ts
export const TRACK_ROLES: readonly TrackRole[] = [
  "track",
  "curved",
  "splice",
  "ceilingSplice",
  "carrier",
  "masterCarrier",
  "endStop",
  "lapClamp",
  "battenClamp",
  "pipeClamp",
  "ceilingHanger",
  "livePulley",
  "deadPulley",
  "deadPulleyOneWay",
  "floorBlock",
  "operatingLine",
];
```

Add to `TRACK_ROLE_LABELS`:

```ts
  ceilingSplice: "Ceiling splice clamp",
  pipeClamp: "Pipe clamp (per batten point)",
  lapClamp: "Lap clamp (bi-parting center)",
  deadPulleyOneWay: "Dead-end pulley, one-way",
```

Add to `TRACK_ROLE_NAMES`:

```ts
  ceilingSplice: "Ceiling splice clamp",
  pipeClamp: "Pipe clamp",
  lapClamp: "Lap clamp",
  deadPulleyOneWay: "One-way dead-end pulley",
```

After `CORD_ROLES`:

```ts
/** #291 — roles priced only when mapped; never required for Active. */
export const OPTIONAL_ROLES: readonly TrackRole[] = ["ceilingSplice", "pipeClamp", "lapClamp", "deadPulleyOneWay"];
```

4. Extend `TRACK_LIMITS` with `sticks: 12,` and `lineAllowanceFt: 50,`.

5. Add the helpers (after `roleSku`):

```ts
/**
 * #291 — the series' straight sticks, ascending. A #274 series (no `sticks`)
 * reads as one stick: stickLengthFt + parts.track (its SKU may be "" when the
 * track role is unmapped — pricing then blocks by name).
 */
export function seriesSticks(series: Pick<TrackSeries, "sticks" | "stickLengthFt" | "parts">): TrackStick[] {
  if (series.sticks && series.sticks.length) return [...series.sticks].sort((a, b) => a.lengthFt - b.lengthFt);
  if (series.stickLengthFt > 0) return [{ lengthFt: series.stickLengthFt, sku: roleSku(series, "track") }];
  return [];
}

/** #291 — every SKU a series references (role parts + sticks), once each — what a page must read from the catalog. */
export function seriesSkus(series: Pick<TrackSeries, "sticks" | "parts">): string[] {
  const out = new Set<string>();
  for (const p of Object.values(series.parts)) if (p?.sku) out.add(p.sku);
  for (const s of series.sticks ?? []) if (s.sku) out.add(s.sku);
  return [...out];
}

function cleanSticks(v: unknown): TrackStick[] {
  if (!Array.isArray(v)) return [];
  const byLength = new Map<number, TrackStick>();
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const lengthFt = positive(r.lengthFt, TRACK_LIMITS.stickLengthFt, 0);
    const sku = cleanText(r.sku, TRACK_LIMITS.sku);
    if (!(lengthFt > 0) || !sku || byLength.has(lengthFt)) continue;
    byLength.set(lengthFt, { lengthFt, sku });
  }
  return [...byLength.values()].sort((a, b) => a.lengthFt - b.lengthFt).slice(0, TRACK_LIMITS.sticks);
}
```

(`cleanSticks` must be placed after `positive` and `cleanText` are defined.)

6. In `sanitizeTrackSeries`, before building `series`:

```ts
  const sticks = cleanSticks(r.sticks);
  const allowance = optionalPositive(r.lineAllowanceFt, TRACK_LIMITS.lineAllowanceFt);
```

Change the `stickLengthFt` line to:

```ts
    stickLengthFt: sticks.length ? sticks[sticks.length - 1].lengthFt : positive(r.stickLengthFt, TRACK_LIMITS.stickLengthFt, 0),
```

Add after `parts,` in the object literal:

```ts
    ...(sticks.length ? { sticks } : {}),
    ...(allowance !== undefined ? { lineAllowanceFt: allowance } : {}),
```

and immediately after the literal (before the `series.active = …` line):

```ts
  if (sticks.length) series.parts.track = { sku: sticks[sticks.length - 1].sku };
```

- [ ] **Step 5: Implement `src/lib/track-engine.ts`**

1. Import `seriesSticks` and `type TrackStick` from `@/lib/track-series` (keep the existing imports).
2. `export type TrackRow = { role: TrackRole; qty: number; sku?: string; lengthFt?: number };` with doc: `/** sku/lengthFt: the straight stick the engine chose (#291) — set on the "track" row only. */`
3. Update the header comment's rules: `straight  n = ceil(L / longest stick); each piece the shortest stick ≥ L / n; splices = n − 1` and add lines for the four optional roles and `operating line ceil(2L + 2·trim + series.lineAllowanceFt)`.
4. In `trackQuantities`, replace the straight-run stick-length check:

```ts
  } else if (!(series.stickLengthFt > 0)) {
```

with:

```ts
  } else if (!seriesSticks(series).length) {
```

5. Replace everything from `const L = trackLengthFt(config, series);` to the end of the function with:

```ts
  const L = trackLengthFt(config, series);
  const mapped = (role: TrackRole) => !!series.parts[role]?.sku;
  let piece: TrackRow;
  if (config.curved) {
    piece = { role: "curved", qty: ceilSafe(L / series.curvedSectionFt!) };
  } else {
    const sticks = seriesSticks(series);
    const n = ceilSafe(L / sticks[sticks.length - 1].lengthFt);
    const stick: TrackStick = sticks.find((s) => s.lengthFt >= L / n - 1e-9) ?? sticks[sticks.length - 1];
    piece = { role: "track", qty: n, sku: stick.sku, lengthFt: stick.lengthFt };
  }
  const splices = Math.max(0, piece.qty - 1);
  const carrierSpacing = spacing(config.carrierSpacingIn, series.carrierSpacingIn);
  const hangerSpacing = spacing(config.hangerSpacingFt, series.hangerSpacingFt);
  const allCarriers = ceilSafe((run * 12) / carrierSpacing);
  const masters = config.operation === "biparting" ? 2 : 1;
  const carriers = Math.max(0, allCarriers - masters);
  const mounts = ceilSafe(L / hangerSpacing) + 1;
  const batten = config.mounting === "batten";

  const per: TrackRow[] = [
    piece,
    { role: !batten && mapped("ceilingSplice") ? "ceilingSplice" : "splice", qty: splices },
    { role: "carrier", qty: carriers },
    { role: "masterCarrier", qty: masters },
    { role: "endStop", qty: 2 },
  ];
  if (config.operation === "biparting" && batten && series.overlapFt > 0 && mapped("lapClamp")) per.push({ role: "lapClamp", qty: 2 });
  per.push({ role: mountingRole(config.mounting), qty: mounts });
  if (batten && mapped("pipeClamp")) per.push({ role: "pipeClamp", qty: mounts });
  if (cord) {
    per.push(
      { role: "livePulley", qty: 1 },
      { role: config.operation === "oneway" && mapped("deadPulleyOneWay") ? "deadPulleyOneWay" : "deadPulley", qty: 1 },
      { role: "floorBlock", qty: 1 },
      { role: "operatingLine", qty: ceilSafe(2 * L + 2 * trim + (series.lineAllowanceFt || 0)) }
    );
  }
  return { rows: per.filter((r) => r.qty > 0).map((r) => ({ ...r, qty: r.qty * qty })), errors: [] };
}
```

- [ ] **Step 6: Implement `src/app/(app)/estimator/track-bom.ts`**

In `trackBom`'s `q.rows.map`, replace:

```ts
    const label = TRACK_ROLE_NAMES[r.role];
    const sku = roleSku(series, r.role);
```

with:

```ts
    const name = TRACK_ROLE_NAMES[r.role];
    // #291: the engine names the stick it chose; every other role reads the series map.
    const label = r.role === "track" && r.lengthFt ? `${name} (${fmtFt(r.lengthFt)} stick)` : name;
    const sku = r.sku || roleSku(series, r.role);
```

and in the missing-part branch change the error to name the role, not the stick:

```ts
      errors.push(`${series.name} has no part for ${name} — map it in ${TRACK_SERIES_HOME}.`);
```

(The returned row keeps `label` — the parts table shows "Track (22' stick)". `fmtFt` is already defined in this file.)

- [ ] **Step 7: Run tsc + the harness**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | tail -5 && npm run test:specs 2>&1 | grep -E "^FAIL|PASS.*#291" | head -60; npm run test:specs 2>&1 | grep -c "^FAIL"`
Expected: tsc prints nothing; every `#291` line PASS; FAIL count `0`. If a #274 assertion fails, it means a #274 behaviour changed — fix the code, not the #274 assertion (only the two Step 1 fixture edits are allowed in #274's block).

- [ ] **Step 8: Commit**

```bash
git add src/lib/track-series.ts src/lib/track-engine.ts "src/app/(app)/estimator/track-bom.ts" scripts/test-review-and-spec.ts
git commit -m "feat(track): several stick lengths + optional pipe/lap clamp, ceiling splice, one-way dead end, line allowance (#291)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Admin screen + every page that reads a series' SKUs

**Files:**
- Modify: `src/app/(app)/estimating-rules/track-series/track-series-client.tsx`
- Modify: `src/app/(app)/estimating-rules/track-series/page.tsx:41`
- Modify: `src/app/(app)/estimator/page.tsx:325`
- Modify: `src/lib/stores/track-series.ts` (the `liveSkusOf(Object.values(clean.parts)…)` call)
- Modify: `scripts/test-review-and-spec.ts` (one #274 client assertion + #291 source checks appended to the #291 block)

**Interfaces:**
- Consumes: `seriesSkus`, `seriesSticks`, `OPTIONAL_ROLES`, `TrackStick`, `TRACK_LIMITS` from Task 1.

- [ ] **Step 1: Write the failing source checks** — append inside a new `{ … }` at the end of the #291 block:

```ts
// ---- #291 wiring: every reader of a series' SKUs includes the sticks; the admin screen edits them ----
{
  const rd291 = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  ok(rd291("src/app/(app)/estimating-rules/track-series/page.tsx").includes("series.flatMap((s) => seriesSkus(s))"), "#291 page: Track series reads every mapped SKU including sticks (seriesSkus)");
  ok(rd291("src/app/(app)/estimator/page.tsx").includes("trackSeries.flatMap((s) => seriesSkus(s))"), "#291 Estimator: the track modal's catalog parts include every stick");
  ok(rd291("src/lib/stores/track-series.ts").includes("liveSkusOf(seriesSkus(clean))"), "#291 store: the Active check reads sticks' SKUs too");
  const cli291 = rd291("src/app/(app)/estimating-rules/track-series/track-series-client.tsx");
  ok(cli291.includes("Stick lengths") && cli291.includes("+ Add length") && cli291.includes("sticks: draft.sticks") && cli291.includes("TRACK_ROLES.filter((r) => r !== \"track\")"),
    "#291 client: a Stick lengths list replaces the single stick field; the track role leaves the role list");
  ok(cli291.includes("OPTIONAL_ROLES.includes(role)") && cli291.includes("Line tie-off allowance"), "#291 client: optional roles are marked, and the line allowance is editable");
}
```

and change the #274 client assertion (line ~37749) from `cli.includes('stickLengthFt: "",')` to `cli.includes("sticks: [],")` (the new-series draft still starts with no stick).

- [ ] **Step 2: Run to confirm failure**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -E "^FAIL" | head`
Expected: the five `#291` wiring checks and the edited #274 client check FAIL.

- [ ] **Step 3: Pages + store**

`src/app/(app)/estimating-rules/track-series/page.tsx` line 41 →

```ts
  const skus = [...new Set(series.flatMap((s) => seriesSkus(s)))];
```

(import `seriesSkus` from `@/lib/track-series`). `src/app/(app)/estimator/page.tsx` line 325 →

```ts
  const trackSkus = new Set(trackSeries.flatMap((s) => seriesSkus(s)));
```

(add `seriesSkus` to that file's `@/lib/track-series` import, or add the import). `src/lib/stores/track-series.ts`: change `liveSkusOf(Object.values(clean.parts).map((p) => p!.sku))` to `liveSkusOf(seriesSkus(clean))` and import `seriesSkus`.

- [ ] **Step 4: The admin client**

In `track-series-client.tsx`:

1. Imports: add `OPTIONAL_ROLES`, `TRACK_LIMITS`, `seriesSticks` from `@/lib/track-series`.
2. `roleNeed`: add before the final `return ""`:

```ts
  if (role === "ceilingSplice") return "Optional — ceiling mounting";
  if (role === "pipeClamp") return "Optional — batten mounting";
  if (role === "lapClamp") return "Optional — bi-parting on a batten";
  if (role === "deadPulleyOneWay") return "Optional — one-way";
```

(the editor shows it; the check `OPTIONAL_ROLES.includes(role)` is used to dim the "Not mapped" text — see 6.)

3. `Draft`: remove `stickLengthFt: string;`, add `sticks: { lengthFt: string; sku: string }[];` and `lineAllowanceFt: string;`.
4. `draftOf`: new series → `sticks: [],` and `lineAllowanceFt: "",` (remove `stickLengthFt: "",`). Existing series →

```ts
    sticks: seriesSticks(s).map((x) => ({ lengthFt: String(x.lengthFt), sku: x.sku })),
    lineAllowanceFt: str(s.lineAllowanceFt),
```

and drop `parts.track` from the copied role parts (`for (const r of TRACK_ROLES) if (r !== "track" && s.parts[r]?.sku) …`).
5. In `SeriesEditor`: the activation check and save use the sticks:

```ts
  const goodSticks = draft.sticks.map((x) => ({ lengthFt: Number(x.lengthFt) || 0, sku: x.sku })).filter((x) => x.lengthFt > 0 && x.sku).sort((a, b) => a.lengthFt - b.lengthFt);
  const longest = goodSticks[goodSticks.length - 1];
  const partMap: Partial<Record<TrackRole, { sku: string }>> = {};
  for (const [r, sku] of Object.entries(draft.parts)) if (sku) partMap[r as TrackRole] = { sku };
  if (longest) partMap.track = { sku: longest.sku };
  const liveSkus = new Set(Object.keys(known));
  const problems = activationProblems({ stickLengthFt: longest?.lengthFt ?? 0, parts: partMap }, liveSkus);
```

The save payload drops `stickLengthFt` and sends `sticks: draft.sticks,` and `lineAllowanceFt: draft.lineAllowanceFt,` (the server re-sanitizes strings). Remove `"stickLengthFt"` from the `field()` key union and its `{field("Stick length", …)}` call; add `{field("Line tie-off allowance", "lineAllowanceFt", "ft", "ADC: 10")}` (add `"lineAllowanceFt"` to the key union).
6. Render a **Stick lengths** block between the numeric fields grid and the `Parts` heading:

```tsx
      <div style={{ ...LABEL, marginTop: 16 }}>Stick lengths</div>
      <div style={{ display: "grid", gap: 6 }}>
        {draft.sticks.map((st, i) => (
          <div key={i} style={{ border: "1px solid #eef0f3", borderRadius: 9, padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input type="number" min={0} step="any" value={st.lengthFt} placeholder="ft" aria-label="Stick length (ft)"
                onChange={(e) => setStick(i, { lengthFt: e.target.value })} style={{ ...INPUT, width: 80 }} />
              <span style={{ fontSize: 12, color: "#8c919c" }}>ft</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><PartLine sku={st.sku} info={known[st.sku]} /></span>
              <button type="button" style={BTN} onClick={() => setPicking(picking === `stick:${i}` ? null : `stick:${i}`)}>
                {picking === `stick:${i}` ? "Done" : st.sku ? "Change" : "Map part"}
              </button>
              <button type="button" style={BTN} aria-label="Remove this length" onClick={() => setDraft((d) => ({ ...d, sticks: d.sticks.filter((_, j) => j !== i) }))}>×</button>
            </div>
            {picking === `stick:${i}` && (
              <div style={{ marginTop: 8 }}>
                <PartPicker sku={st.sku} showSku={false} onPick={(picked, hit) => {
                  setKnown((k) => ({ ...k, [picked]: { desc: hit.desc, cost: hit.cost, unit: hit.unit, mfr: "" } }));
                  setStick(i, { sku: picked });
                  setPicking(null);
                }} />
              </div>
            )}
          </div>
        ))}
        {draft.sticks.length < TRACK_LIMITS.sticks && (
          <div>
            <button type="button" style={BTN} onClick={() => setDraft((d) => ({ ...d, sticks: [...d.sticks, { lengthFt: "", sku: "" }] }))}>+ Add length</button>
            <span style={{ fontSize: 11, color: "#9aa0ab", marginLeft: 8 }}>Each track buys equal pieces: the shortest stick that covers its share of the length.</span>
          </div>
        )}
      </div>
```

with `picking` widened to `useState<TrackRole | `stick:${number}` | null>(null)` and

```ts
  const setStick = (i: number, patch: Partial<{ lengthFt: string; sku: string }>) =>
    setDraft((d) => ({ ...d, sticks: d.sticks.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
```

7. The role list maps `TRACK_ROLES.filter((r) => r !== "track")`; for an optional role with no part, show `<span style={{ color: "#9aa0ab" }}>Not used</span>` instead of `<PartLine …/>`'s red "Not mapped" (use `OPTIONAL_ROLES.includes(role) && !sku`).
8. Series summary (list view): replace `` `Stick ${…}` `` with

```ts
              (() => {
                const st = seriesSticks(s);
                if (!st.length) return "Stick —";
                return st.length === 1 ? `Stick ${st[0].lengthFt}'` : `Sticks ${st[0].lengthFt}'–${st[st.length - 1].lengthFt}' (${st.length} lengths)`;
              })(),
```

and add `s.lineAllowanceFt ? `line +${s.lineAllowanceFt}' tie-off` : "",` to the same list. In the read-only role grid, list sticks first:

```tsx
              {seriesSticks(s).map((st) => (
                <div key={`stick-${st.lengthFt}`} style={{ display: "contents" }}>
                  <div style={{ color: "#737985" }}>Track {st.lengthFt}&apos; stick</div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><PartLine sku={st.sku} info={parts[st.sku]} /></div>
                </div>
              ))}
```

and filter `track` out of the role rows that follow (`TRACK_ROLES.filter((r) => r !== "track" && s.parts[r])`).
9. Empty-state copy: "Add a series (e.g. ADC 280), enter its stick lengths and map each piece to a catalog part. Nothing is mapped for you."

- [ ] **Step 5: tsc + harness**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | tail -5; npm run test:specs 2>&1 | grep -c "^FAIL"`
Expected: no tsc output; `0`.

- [ ] **Step 6: Browser check on a scratch datadir** (never `.data/pglite`; see memory `peak-exercising-post-routes-safely`): boot `next dev` in this worktree with `PGLITE_PATH=$(mktemp -d)` on a free port, sign in via the dev picker as an admin, open `/estimating-rules/track-series`, add a series with 3 stick lengths mapped to any three seeded catalog parts, map the required roles + a pipe clamp, save Active, reload — the summary reads `Sticks …'–…' (3 lengths)` and the parts list shows each stick. Then in the Estimator, `+ Configure track` on that series: a batten bi-parting run shows a "Track (N' stick)" row and a Pipe clamp row. Stop the dev server afterwards (`lsof -ti :PORT | xargs kill`).

- [ ] **Step 7: Commit**

```bash
git add -A "src/app/(app)/estimating-rules/track-series" "src/app/(app)/estimator/page.tsx" src/lib/stores/track-series.ts scripts/test-review-and-spec.ts
git commit -m "feat(track): stick-lengths editor, optional roles and line allowance on Track series (#291)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Docs + gates

**Files:** `PUNCHLIST.md`, `DECISIONS.md`, `docs/superpowers/specs/2026-10-01-track-adc-bom-design.md`

- [ ] **Step 1:** Recompute free numbers right before writing: `git fetch -q origin && git show origin/main:PUNCHLIST.md | grep -o '^## [0-9]*' | tail -1` and the same for `DECISIONS.md` (`^## D[0-9]*`), and check sibling worktree branches (`git branch -a`) — #288–#290 are reserved by the portal-quotes branch. Use the next free punch number (#291 if still free) and the next free D-numbers above any reserved range.
- [ ] **Step 2:** Spec §3: replace "Operating line: `ceil(2L + 2 × trim + 10)`" with the per-series `lineAllowanceFt` (default 0, ADC 10) and note why (keeps non-ADC series and #274 behaviour). Add the stick-choice formula exactly as built.
- [ ] **Step 3:** PUNCHLIST entry `## 291. Track configurator — prices ADC's real bill of materials — DONE 2026-10-01 (D…)` with Reported (Jeff 2026-10-01), what shipped, gates with real numbers, the out-of-scope list from the spec, and "Remaining: the production fill of six ADC black series (done in session after deploy, or Jeff-gated)".
- [ ] **Step 4:** DECISIONS entries: (a) several stick lengths, equal split, shortest covering stick; (b) the four optional roles priced only when mapped; (c) line allowance per series, not a constant.
- [ ] **Step 5:** Gates, reported with real numbers vs a baseline on the base commit `7d811f4c`: `npx tsc --noEmit`; `npm run test:specs` (PASS/FAIL counts); `npm run test:smoke` (stop any dev server first; `df -h /` first — temp PGlite dirs fill the disk); `npx eslint` on the changed files.
- [ ] **Step 6: Commit** `docs: #291 track configurator prices ADC's real BOM` (+ Co-Authored-By).
