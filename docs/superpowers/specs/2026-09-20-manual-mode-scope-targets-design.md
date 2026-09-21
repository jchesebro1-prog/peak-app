# Manual mode scope targets: shared basic-info intake + goalpost tracking

## Context

The Designs/Grid merge (session/jolly-quail-pkii, commit fe2e409) unified `DesignRecord` with
`layoutMode: "quick" | "manual"`, a `gridProjectId`, and re-quote-in-place promotion. "Quick
canvas" is today's Auto/sandbox estimate engine (parametric compute, synthetic BOM, fully
live-editable). "Manual layout · The Grid" is today's catalog-device plan-sheet painter
(`grid-bom.ts`, `grid-projects.ts`) — real SKUs placed on a drawing, no parametric generation.

Today Manual mode starts from a blank project: no dimensions, no systems-in-scope, no reference
for whether what's been placed is anywhere near the right ballpark. This spec gives Manual mode
the same basic-info intake Auto already has, and turns its output into a **live, revisable
target** you place against — not an upstream input that gates what you can do.

## Direction

Both Auto and Manual start from the same basic-info step: venue type, size/dimensions, and
systems-in-scope — reusing Quick Design's existing inline config panel. Both run that input
through the same `compute()`/`tierSystems()` engine (`design/quick/engine.ts`) to get
Good/Better/Best dollar figures per system. Where they diverge is what happens next:

- **Auto** — unchanged. The engine's output *is* the design: synthetic BOM lines, live-editable,
  no catalog placement involved.
- **Manual** — the engine's output becomes a **reference target only**. Nothing is auto-placed.
  You place real catalog SKUs yourself; the editor shows target-vs-placed per system.

**Goalpost, not gate.** The target is a reference, never an enforcement mechanism. Auto keeps its
current free system-toggling — nothing about it changes. Manual lets you place anything, in any
scope, regardless of what's toggled on; placing outside the current scope just shows as
untracked/no-target rather than being blocked. Because targets are recomputed live from whatever
the basic-info inputs currently are (not frozen at creation), revising a dimension or toggling a
system later simply moves the goalpost — it never invalidates anything already placed.

## Data model

`GridProject` gains one field:

```ts
type GridProject = {
  // ...existing fields (name, customer, sheets, devices, spaces, revisions...)
  scopeInputs: QuickScopeInputs | null; // null until the basic-info step is completed
};
```

`scopeInputs` is the same shape as Quick Design's `AState` inputs (venue type, sq ft, dimensions,
systems-in-scope array). It is stored live and stays editable for the life of the project — there
is no separate frozen `targets` snapshot. Target dollars are always `compute(scopeInputs)`
evaluated on read, at whichever tier the Scope panel's toggle is currently set to.

`createManualDesignAction` changes signature to accept the basic-info payload instead of creating
a fully blank project, writing it straight into `scopeInputs` on creation. Skipping that step is
still allowed — `scopeInputs` stays `null`, and the Scope panel simply shows "no target set"
rather than blocking project creation or placement.

## Trackable systems

`scopeOfPart` (`src/lib/design/grid-scopes.ts`) already buckets every catalog part into one of
five trades — **Lighting, Rigging, Curtains, Audio, Video** — plus an Unscoped catch-all, derived
from each part's existing group/trade tags. This is the tracking mechanism reused as-is; no
catalog or taxonomy changes.

Quick Design supports more systems than that (e.g. Controls, Acoustical, Pit) which have no
placement scope to track against in Grid. The Manual-mode systems picker is restricted to the 5
trackable systems only, so every target set in Manual mode is actually fulfillable — Quick Design
keeps all of its existing systems unchanged.

## Shared basic-info component

The venue/size/dimensions/systems panel is extracted out of Quick Design into a shared component
(`src/components/design/scope-inputs-panel.tsx`) taking `value`/`onChange` plus a `systems`
allowlist prop:

- **Auto** passes all of Quick Design's existing systems; placement and behavior are unchanged
  (still the live inline config panel at the top of the canvas).
- **Manual** passes the 5 trackable systems only, and renders the panel as a new **"Scope"**
  section in the Grid editor sidebar (alongside Sheets/Devices/Spaces/Revisions/Riser). Since
  inputs stay revisable rather than being a one-time creation step, this is the same panel used at
  creation and on every later visit — not a separate wizard plus a read-only summary.

## Scope panel — tracking UI

Below the shared inputs, the Scope panel renders one row per trackable system currently in scope:

- A progress bar: **placed $ / target $**. Placed $ is the sum of `bomLines`/`bomTotals` grouped
  by `scopeOfPart` for that system; target $ is `compute(scopeInputs)` at the panel's selected
  tier.
- A **Good/Better/Best toggle** at the top of the panel (tier as a lens, not an input) that
  redraws every row's target line. It never touches placed $ and never gates placement — purely
  changes what each bar is measured against.
- Placements outside current scope (a system not toggled on, or catalog parts that land in
  Unscoped) roll up into an **"Untracked"** row with a running $ total and no target bar — visible
  for awareness, never hidden, never blocked.

## What does not change

- Auto/Quick Design's engine, live-editing, and promote-to-quote flow are untouched.
- Catalog taxonomy and `scopeOfPart` bucketing are untouched — reused as-is.
- Manual mode's quote/promote flow (`createDraftQuoteAction`) is untouched — it already prices
  off real placed BOM lines, which this spec doesn't touch.
- No hard validation blocking placement outside scope, blocking promotion when under/over target,
  or locking the basic-info inputs after creation.
