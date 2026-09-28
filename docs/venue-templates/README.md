# Venue templates (#249)

Background drawings for generated plans. Each venue kind has:

- `source/<kind>.dwg` — Jeff's Vectorworks drawing (the source of truth)
- `src/lib/design/venue-templates/<kind>.json` — the converted template (never hand-edit)
- `src/lib/design/venue-templates/<kind>.keys.ts` — hand-written key lines: which spans stretch and which input drives them, the labeled regions, required labels
- `<kind>.png` — a preview of the converted drawing, to confirm with Jeff

## Drawing rules (for Jeff)

- Document units **inches**, plan view, 2D. Export as DWG or DXF.
- Label every area you want tracked with plain text inside it (e.g. "Catwalk").
- Layers/classes don't matter; fills (wipeouts, hatches) and dimensions are ignored.

## Setup (once per machine)

    brew install libredwg
    python3 -m venv ~/.venvs/venue-templates
    ~/.venvs/venue-templates/bin/pip install ezdxf matplotlib

## Convert / check

    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --selftest

`--check` exits 1 if the committed JSON is not what the source converts to.

## Adding a venue kind

1. Save Jeff's DWG as `source/<kind>.dwg`; add its required labels to `REQUIRED` in the converter.
2. Convert; confirm `<kind>.png` with Jeff.
3. Write `<kind>.keys.ts` (see `proscenium.keys.ts`) — key lines measured from the JSON.
4. Point that kind's geometry / `buildPlan*` at the template and add a `#249`-style harness block (identity at the drawing's own size, walls keep 6", driven spans match the inputs).
