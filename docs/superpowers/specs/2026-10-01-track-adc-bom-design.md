# Track configurator — ADC's real bill of materials (#291) — design

**Date:** 2026-10-01 · **Punch:** #291 · **Builds on:** #274 (`docs/superpowers/specs/2026-09-29-track-configurator-design.md`)
**Approved by:** Jeff (2026-10-01, in session)

## Ask

Jeff: "help me map the track parts and auto fill that — use the web and ADC." The ADC price book is now in the production
catalog (1,190 ADC parts, category Track), but mapping it into #274's one-part-per-role series under-prices ADC's real
bill of materials. Jeff chose **upgrade first, then fill**, **black finish only**, **1-1/2" schedule 40 battens**, and all
six current series: 280 Silent Steel, 170 BeSteel, 140 Rig-I-Flex, 500 Patriarc, 220 Trak-Eze, 132 Flex-I-Trac.

## What ADC says (sources: ADC Catalog 52, adctracks.com part pages, series submittal/installation binders)

- Track ships **by the foot** in even footages up to a maximum unspliced piece (280: 24'; 170: 26'; 140/500/132: 20');
  a longer track is split into equal pieces, one splice per joint (ADC's example: 35' ships as two 18' pieces).
- A **batten hanging point is two parts**: the hanging clamp (2808, 1708, 4208, …) *plus* a pipe clamp sized to the pipe
  (2815, 1715 for 1-1/2" sch 40). Pipe clamps are never in ADC's CWANA package.
- A two-leg **bi-parting** suspended track uses **2 lap clamps** (2807, 1707, 1407, 5007) at the center overlap ("use 2
  each for 2 foot overlapped track systems"). Lap clamps are suspended-only; ceiling tracks just overlap.
- **Splices differ by mounting** for 280 (2824 suspended / 2824-A ceiling) and 170 (1724 / 2624).
- 140's **dead-end pulley differs** by operation (1404 bi-part / 1404-A one-way).
- Operating line, manual: **2 × width + 2 × height + 10'**.

## Design

### 1. Stick lengths — `src/lib/track-series.ts`

`TrackSeries` gains `sticks: { lengthFt: number; sku: string }[]` — every straight stick length the series is mapped for.
It is the source of truth for straight track:

- `sanitizeTrackSeries` cleans the list (length > 0, ≤ `TRACK_LIMITS.stickLengthFt`, SKU non-blank, one entry per length,
  at most 12, sorted ascending), then **derives** `stickLengthFt` = the longest length and `parts.track` = that stick's
  SKU, so the activation check, `roleSku` and every existing reader keep working unchanged.
- **Back-compat:** a stored series with no `sticks` but a `stickLengthFt` + `parts.track` reads as a one-entry list. A
  series with a single stick behaves exactly as #274 did.
- The admin screen edits the list (length + part per row, add/remove) instead of the single Stick length field; the
  `track` role leaves the role list (the sticks list maps it).

### 2. New optional roles

| Role | Label | Used when (and only when mapped) |
|---|---|---|
| `ceilingSplice` | Ceiling splice clamp | Ceiling mounting — replaces `splice` |
| `pipeClamp` | Pipe clamp (per batten point) | Batten mounting — one per hanging point, alongside `battenClamp` |
| `lapClamp` | Lap clamp (bi-parting center) | Bi-parting + batten + series overlap > 0 — 2 per track |
| `deadPulleyOneWay` | Dead-end pulley, one-way | One-way operation — replaces `deadPulley` |

None is required for Active; `requiredRolesFor` and `activationProblems` are unchanged. "Mapped" means the series names a
SKU; a mapped SKU since deleted from the catalog blocks the line by name, as every role does today.

### 3. Engine — `src/lib/track-engine.ts`

Per track, then × qty (unchanged rules not repeated):

- **Straight:** `n = ceil(L / longest)`; every piece is the **shortest mapped stick ≥ L / n**; one `track` row carries
  that stick's SKU and length (`TrackRow` gains optional `sku` and `lengthFt`). Splices `n − 1`.
  42' of 280 (12–24' sticks) → 2 × 22'. 35' → 2 × 18'. One 20' stick only → 3 × 20' (as today).
- **Splice role:** `ceilingSplice` when mounting is ceiling and it is mapped, else `splice`. Curved runs too.
- **Pipe clamps:** batten + mapped → qty = mounting count.
- **Lap clamps:** bi-parting + batten + `overlapFt > 0` + mapped → 2.
- **Dead-end pulley:** one-way + `deadPulleyOneWay` mapped → it, else `deadPulley`.
- **Operating line:** `ceil(2L + 2 × trim + 10)` (was `2L + 2 × trim`).

Still pure: "mapped" is read from `series.parts`, never the catalog.

### 4. Pricing + Estimator — `estimator/track-bom.ts`, `track-modal.tsx`

- `trackBom` resolves a row's part from `row.sku` when the engine set one, else `roleSku(series, role)`. The track row's
  label reads "Track (22' stick)". Everything else — pricing, components, blocking errors, reopen/Update — is unchanged.
- A saved line re-prices at today's rules on Update, like any other change to a series.

### 5. Admin screen — Estimating Rules → Track series

- **Stick lengths** card: rows of length (ft) + mapped part (shared `PartPicker`), "+ Add length", remove ×. The series
  summary reads "Sticks 12'–24' (7 lengths)".
- The four new roles join the role list with "Optional — ceiling mounting / batten mounting / bi-parting batten /
  one-way" notes.

### 6. Tests (`scripts/test-review-and-spec.ts`, the #274 block)

Engine: 35' → 2 × 18'; 42' → 2 × 22'; one-stick series unchanged; ceiling splice swap mapped/unmapped; pipe clamps per
point (batten only); lap clamps (bi-parting batten only, none on ceiling, none at overlap 0, none unmapped); one-way dead
end swap; operating line +10'. Sanitize: sticks cleaned/sorted/deduped, derived `stickLengthFt` + `parts.track`, legacy
shape read as one stick, new roles kept. BOM: track row priced from its own SKU; "Track (22' stick)" label.

### 7. Then the fill (production, after deploy)

Six series, black finish, saved through the screen's own save action (same sanitize + live-catalog Active check):
ADC 280 Black, ADC 170 Black, ADC 140 Black, ADC 500 Black, ADC 220 Black, ADC 132 Black — every SKU taken from the live
production catalog, each checked by configuring a sample track in the Estimator against a hand calculation.

## Out of scope (flagged to Jeff)

Walk-along bi-parts needing 4 end stops; center pipe supports (CPS) at the overlap; curve spindles/idlers on curved 140
cord runs; 220's floor pulley (1145 not in the catalog — cord-operated 220 stays blocked until mapped); 500 and 220
pipe-clamp part numbers (ADC doesn't publish them); separate hanger spacing for ceiling vs batten.
