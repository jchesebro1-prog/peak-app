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

## Adding a venue kind

1. Save Jeff's DWG as `source/<kind>.dwg`; add its required labels to `REQUIRED` in the converter.
2. Convert; confirm `<kind>.png` with Jeff.
3. Write `<kind>.keys.ts` (see `proscenium.keys.ts`) — key lines measured from the JSON.
4. Point that kind's geometry / `buildPlan*` at the template and add a `#249`-style harness block (identity at the drawing's own size, walls keep 6", driven spans match the inputs).
