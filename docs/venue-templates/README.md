# Venue templates (#249, #255)

Background drawings for generated plans. Each venue kind has:

- `source/<kind>.dwg` — Jeff's Vectorworks drawing (the source of truth)
- `src/lib/design/venue-templates/<kind>.json` — the converted template (never hand-edit)
- `src/lib/design/venue-templates/<kind>.keys.ts` — hand-written key lines: which spans stretch and which input drives them, the labeled regions, required labels
- `<kind>.png` — a preview of the converted drawing, to confirm with Jeff

## Drawing rules (for Jeff)

- Document units **inches**, plan view, 2D. Export as DWG or DXF.
- Label every area you want tracked with plain text inside it (e.g. "Catwalk").
- Layers/classes don't matter; fills (wipeouts, hatches) and dimensions are ignored.

## Label overlay (#255)

Jeff's church and later drawings carry no text. The areas are named in
`source/<kind>.labels.json` — `{"labels": [{"text", "x", "y", "h"}]}`, drawing
inches, top-left anchor — and the converter merges them into the JSON with
`"added": true` (drawn in blue in the preview). A later DWG that carries its
own labels needs no overlay; a drawn label wins over every overlay label of
the same text. A text required n times (e.g. four "Storage" rooms) must
appear n times. Drawings far from their origin list an `ORIGIN` shift in the
converter; the JSON then records `"origin"`.

## Backgrounds per venue type (#255)

Settings → Venue types has a **Background** column (admin-only): for each type,
the drawings made for its "works like" kind — the registry,
`src/lib/design/venue-templates/index.ts`. Defaults: Auditorium / PAC
`proscenium@1`, Gym Stage `gym-stage@1`, Church `church-traditional@1`
(Contemporary selectable), Black Box and Conference `blackbox@1`, Arena
`arena@1`. A design's plan draws its own pick (`templateId`, Quick Design /
Grid intake, "Venue type default" = none) ?? its venue type's Background ??
the kind default. Quick Design's Gym Stage venue draws only gym drawings.
Ids are versioned: a redrawn DWG ships as `<kind>@2`; Grid sheets keep the id
(`intake.baseSheetTemplate`) and the movable-room positions
(`intake.baseSheetMovables`) they were stamped with.

## What a keys file can say

Span maps (`x`: spans / blend / profile, with `face` spans for splayed
walls; `ySpans` or a mirrored `yMap`), true arcs (`trueArcs`: radius × a
driven width, or keep-sweep corners), diagonal walls that stay 6" (`walls`),
movable rooms and code-sized elements (`movableWalls`, `movables`,
`movableGap`), drawn key lines (`drawn`), duplicate labels (`regionLabels`),
and the roles plans and Auto fill read (`roles`: stage, house, booth,
catwalk). Bad keys throw a named `venue template <kind>: …` error.

## Setup (once per machine)

    brew install libredwg
    python3 -m venv ~/.venvs/venue-templates
    ~/.venvs/venue-templates/bin/pip install ezdxf matplotlib

## Convert / check

    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --selftest
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py church-traditional docs/venue-templates/source/church-traditional.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py church-contemporary docs/venue-templates/source/church-contemporary.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py gym-stage docs/venue-templates/source/gym-stage.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py blackbox docs/venue-templates/source/blackbox.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py arena docs/venue-templates/source/arena.dwg --check

`--check` exits 1 if the committed JSON is not what the source converts to.

Closed splines (#255, the Arena): a closed SPLINE that is an axis-aligned
rounded rectangle — a straight run on every side (at least 12" and 10% of
that side), every other point in a corner box — is kept as a `roundRects`
entry (its bbox and the smallest corner runs `rx`/`ry`); any other spline is
flattened into segments. The JSON records the drawing; the template's key
lines draw the curves (the Arena's are true quarter circles, radius 13' and
13' + the bowl). `--selftest` checks a drawing's round rects against
`ROUND_RECTS` in the converter and that a circle or ellipse spline flattens.

## Adding a venue drawing

1. Save Jeff's DWG as `source/<kind>.dwg`; if it has no text, write
   `source/<kind>.labels.json`; add the kind's labels to `REQUIRED` (and an
   `ORIGIN` shift if it sits far from its origin).
2. Convert; confirm `<kind>.png` with Jeff.
3. Write `<kind>.keys.ts` from the converted JSON (never guess a number).
4. Register it: `templates.ts` (drawing + keys), `index.ts` (id `<kind>@1`,
   family, works-like kinds, defaults), a house spec in `house-dims.ts` if it
   has house / nave / floor fields.
5. If it is a new family, add its geometry + builder in `plan-svg.tsx` and its
   branches in `starterSpaces`, `generateBaseSheet` and `venueFrame`.
6. Add a `#255`-style harness block (identity at the drawing's size, walls
   keep 6", driven spans match the inputs) and renders for Jeff in
   `renders/`.
