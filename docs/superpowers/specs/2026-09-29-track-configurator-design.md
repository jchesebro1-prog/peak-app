# Track configurator (#274) — design

**Date:** 2026-09-29 · **Punch:** #274 · **Approved by:** Jeff (2026-09-29, in session)

## Ask

2026-09-23 practice run: "Add a way to quote track rigging on Estimate." Jeff, 2026-09-29: "We need a track
configurator." Choices Jeff made in the design session:

| Question | Answer |
|---|---|
| Price source | **Catalog parts** — the configurator computes quantities; every price comes from the live catalog |
| Manufacturers, v1 | **ADC** (the model takes any manufacturer later) |
| Track types | **Bi-parting (cord)**, **One-way (cord)**, **Walk-along**, and **curved** runs |
| Relation to curtains | **Both** — a standalone "+ Configure track" and an "Add track" step inside the curtain configurator |
| On the estimate | **One track line, parts inside** — re-openable, exploded in the PM parts list |
| Mounting | **Batten clamp** and **ceiling / structure hanger** (no wall mount in v1) |

## Today

- Estimator add buttons (`estimator/section-card.tsx`): catalog / curtain / assembly / labor / custom / vendor. No track.
- Track exists only as a weight list for rigging loads — `TRACKS` in `src/lib/design/steel.ts` (lb/ft), used by the
  Lineset builder. Nothing prices track. **Unchanged by this work.**
- Patterns to follow: the curtain configurator (`estimator/curtain-modal.tsx`), the fixture line's BOM
  (`SpecItem.components`, `estimator/fixture-bom.ts`, exploded by `estimator/parts-csv.ts`), the Grid Equipment map's
  catalog-part mapping (`src/lib/design/equipment-map.ts` + `src/lib/stores/equipment-map.ts`, blob via
  `getBlob`/`setBlob`), and #269's click-a-line-to-reopen (lands before the Estimator half of this build).

## Design

### 1. Track series (the parts map) — `src/lib/track-series.ts` (pure) + `src/lib/stores/track-series.ts`

A settings blob `track_series`: a list of series records. Admin-edited at **Estimating Rules → Track series**
(`/estimating-rules/track-series`, linked from the Estimating Rules page; admin-only like the rest of that page).

```ts
type TrackRole =
  | "track"          // straight stick, priced per stick
  | "curved"         // curved section, per section (curved runs only)
  | "splice"         // splice clamp, per joint
  | "carrier"
  | "masterCarrier"
  | "endStop"
  | "livePulley"     // cord-operated only
  | "deadPulley"     // cord-operated only
  | "floorBlock"     // cord-operated only
  | "operatingLine"  // per foot (catalog unit = ft)
  | "battenClamp"    // batten mounting
  | "ceilingHanger"; // ceiling / structure mounting

type TrackSeries = {
  id: string;                 // stable slug, server-allocated
  name: string;               // e.g. "ADC 280"
  manufacturer: string;       // "ADC"
  stickLengthFt: number;      // straight stick length
  curvedSectionFt?: number;   // arc length of one curved section; absent = series has no curved track
  minRadiusFt?: number;       // smallest radius the series bends to
  carrierSpacingIn: number;   // default carrier spacing
  hangerSpacingFt: number;    // default clamp / hanger spacing
  overlapFt: number;          // bi-parting center overlap added to track length (0 = none)
  parts: Partial<Record<TrackRole, { sku: string }>>; // catalog part per role
  active: boolean;
};
```

- Parts are picked by catalog search (reuse the Equipment map editor's part picker). **No part numbers are seeded or
  invented** — the table starts empty; mapping ADC roles is Jeff-gated and needs the ADC price book in the catalog.
- A new series pre-fills carrier spacing 12", hanger spacing 5' and overlap 0; stick length and the curved fields
  start blank (the admin types them from the manufacturer's data). A series can't be marked active until stick length
  and the always-required roles (track, splice, carrier, master carrier, end stop, and one mounting role) are mapped.
- `sanitizeTrackSeries(raw)` clamps numbers (> 0, sane maxima), drops unknown roles, trims strings; the server action
  re-sanitizes on every save.
- A role's part is resolved from the live catalog at price time; a mapped SKU that no longer exists counts as unmapped.

### 2. Quantity engine — `src/lib/track-engine.ts` (pure, no prices)

Input (`TrackConfig`, also what the line stores to reopen):

```ts
type TrackConfig = {
  seriesId: string;
  operation: "biparting" | "oneway" | "walkalong";
  runFt: number;            // straight: run length; curved: arc length
  curved: boolean;
  radiusFt?: number;        // curved only
  mounting: "batten" | "ceiling";
  trimFt?: number;          // pulley-to-floor drop, cord-operated only (default 20)
  qty: number;              // identical tracks
  carrierSpacingIn?: number;  // overrides series default
  hangerSpacingFt?: number;   // overrides series default
  label?: string;           // optional name, e.g. "Main drape track"
};
```

Rules per track (then × `qty`):

- **Track length** `L = runFt + (operation === "biparting" ? series.overlapFt : 0)`.
- **Straight:** `sticks = ceil(L / stickLengthFt)`; `splices = sticks − 1`.
- **Curved:** `sections = ceil(L / curvedSectionFt)`; `splices = sections − 1`. Refused if the series has no
  `curvedSectionFt`, or `radiusFt < minRadiusFt`.
- **Carriers:** `ceil(runFt × 12 / carrierSpacing)`; **master carriers** 2 for bi-parting, 1 for one-way and walk-along,
  and each master replaces one ordinary carrier (`carriers − masters`, floor 0).
- **End stops:** 2.
- **Mounting:** `ceil(L / hangerSpacing) + 1` of `battenClamp` or `ceilingHanger`.
- **Cord-operated** (bi-parting, one-way): 1 live-end pulley, 1 dead-end pulley, 1 floor block, and operating line
  `ceil(2 × L + 2 × trimFt)` ft (the loop runs the length of the track twice and down to the floor block and back).
  *This refines the "≈ 2 × length + trim" said in the session: the loop goes down and back up, so the drop counts twice.*
- **Walk-along:** no pulleys, floor block or operating line.

Output: `{ rows: { role, qty }[], errors: string[] }` — pure, fully unit-tested, no catalog access.

### 3. Pricing + the estimate line — `estimator/track-bom.ts` (pure)

- Each row resolves its role → series part → live catalog part; cost = catalog cost × qty; sell per component priced
  **exactly the way a catalog part added from the picker is priced** (same tier/margin rule — reuse, don't copy).
- A required role that is unmapped (or whose SKU is gone) **blocks Add** and names the role:
  "ADC 280 has no part for Floor block — map it in Estimating Rules → Track series."
- The line: `desc` = "<label or 'Track'> — <series> <operation> track, <run>' run" (+ ", curved R<radius>'"), `qty` 1,
  `unit` "lot", cost/price = component sums, `components` = the priced rows (the existing fixture BOM field, so the PM
  parts list #262 explodes it with no new code path), a new `track?: TrackConfig` holding the inputs, and
  `manufacturer` from the series. Freight, margin, #267's system sell/rounding and Copy system (#266) treat it like any
  line; Copy re-prices components at today's catalog cost like other catalog-backed lines.
- The customer document shows the one line (desc + comment), never the components.

### 4. Estimator UI

- **"+ Configure track"** in each system's add buttons opens a track modal (`estimator/track-modal.tsx`, same shell as
  the curtain modal): series select (active series only; "No track series yet — set one up in Estimating Rules →
  Track series" when empty), operation, straight/curved (+ radius), run, mounting, trim (cord only), qty, label, and a
  collapsed "Spacing" row pre-filled from the series. Live header stats: track length, parts count, cost, price·ext;
  a parts table (role, part, qty, ext) and any blocking error.
- **Reopen:** clicking a track line (or its ✎) reopens the modal with its `TrackConfig`; **Update track** replaces the
  line in place at current catalog prices (same mechanism #269 introduces for labor). A track line whose series was
  deleted opens read-only with "This series no longer exists."
- **From a curtain:** the curtain modal gains an **Add track** toggle. On, it shows the track fields compactly,
  pre-filled: operation Bi-parting when the curtain qty is 2, else One-way; run = width × qty for bi-parting, else
  width; mounting Batten; label = curtain name + " track". Adding the curtain then pushes the curtain line followed by
  its track line. Every pre-fill is editable.

### 5. Out of scope (v1)

Install labor (stays in the Labor configurator); wall mounting; manufacturers other than ADC (the table already takes
them); the Grid and Lineset builders (their weight-only `TRACKS` list is untouched); portal catalog.

## Testing

Spec-harness tests (committed fixtures): engine rows for each operation × straight/curved × batten/ceiling, stick
rounding at exact multiples, overlap only on bi-parting, carrier/master arithmetic incl. tiny runs, curved refusals,
operating-line formula; sanitize rejects bad numbers/unknown roles; pricing with a mapped series, an unmapped required
role, a deleted SKU; the line round-trips (`track` + `components`) through save and Copy system; reopen → Update
replaces in place; curtain + track push order and pre-fill; PM parts list explodes the track's components. Gates: tsc,
test:specs, test:smoke, eslint vs baseline, next build; browser check on a scratch datadir.

## Build order

- **Phase A (now):** `track-series.ts`, `track-engine.ts`, the store, the Track series admin page + actions, tests.
  Touches no Estimator file.
- **Phase B (after #269/#270 merge):** `track-bom.ts`, `track-modal.tsx`, the `track` field on `SpecItem`, section-card
  button + reopen, curtain modal step, parts-csv/copy-system checks, tests.

## Jeff-gated after ship

Import the ADC price book, then create the ADC series in Estimating Rules → Track series and map each role; confirm
the default spacings (carrier 12", hanger 5') and trim 20'.
