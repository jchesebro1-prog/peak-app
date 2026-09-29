# Punch #255 — Church Traditional venue template, and backgrounds chosen per venue type

Date: 2026-09-28 · Branch `feat/church-template` (from origin/main 847616e0). Builds on #249 (D431–D436, venue
templates: `scripts/venue-template-convert.py`, `src/lib/design/venue-templates/`, `docs/venue-templates/`).

Jeff (2026-09-28), sending `Dropbox/Template Background Church Traditional-dwg/Template Background Church
Traditional.dwg`: "I am going to probably switch out categories a bit as we build these since the layouts are
changing. Can you analyze and let me know your recommendations on how we handle this for the scaling?" After the
recommendations: "You label them, back rooms are cry room and storage and then the left is the choir room and the
right is the electrical room."

## The drawing (measured from the DXF; drawing inches, y up)
Units inches (`$INSUNITS = 1`), one layer, 83 LINE + 4 ARC (Vectorworks duplicates → 44 unique lines, 2 arcs), 18
WIPEOUT, **no text**. Outside 81' × 102'. Walls 6" throughout. Centreline x ≈ 4.2 (the apse centre).
| Feature | Drawing value (approx.) |
|---|---|
| Outer side walls | x −481.9/−476 and 484/490 → nave inside width 960" (80') |
| Chancel (platform, back part) | inside x ≈ −300 → 312 (~51'), y ≈ 80 → 312 (back wall inner face) |
| Platform front step | x ≈ −355 → 360 (~60'), y ≈ −4 → 80 (~7'); its front edge (y ≈ −4) is a single line (a platform edge, not a wall) |
| Apse | double arc, centre (4.2, 224.1), r 172.2 / 178.2, 31°→149° (segmental: ~25' chord, ~7' deep beyond the back wall) |
| Side rooms (L-shaped) | x −476 → −306 and 318 → 484, y ≈ 45/51 → 312, notched around the front step |
| Nave | inside 80' wide, platform front (y ≈ −4) → back-room wall (y ≈ −663) ≈ 55' |
| Back rooms | x −476 → −110 and 120 → 484, y ≈ −669 → −812 (~12' deep); entry opening x −110 → 120 (~19') |

Measure exact values from the converted JSON; the table is orientation.

## Labels (placed by Claude on Jeff's instruction — the drawing carries none)
Jeff's names: back-left **Cry Room**, back-right **Storage**, side-left **Choir Room**, side-right **Electrical Room**.
Plus the shared vocabulary: **Platform** (chancel + front step — the performance area; the church equivalent of
"Stage"), **Apse**, **Nave** (the congregation — the church equivalent of "House"), **Entry** (the opening between
the back rooms). D431's rule was "the text labels he drew mark the areas"; this drawing has none, so the converter
gains a per-kind **label overlay** (`docs/venue-templates/source/<kind>.labels.json`: text + anchor in drawing inches),
merged into the template exactly like drawn labels and recorded as `added: true` in the JSON. A later DWG that carries
its own labels needs no overlay; a drawn label wins over an overlay label of the same text.

## Templates are chosen per venue type, versioned (Jeff: categories will change)
- Template ids carry a version: `proscenium@1` (existing), `church-traditional@1` (new). A registry
  (`venue-templates/index.ts`) lists each template with its `worksLike` kind, label and default dimensions.
- Settings → Venue types (#216) gains a **Background** column: for each type, a dropdown of the templates for its
  "works like" kind (plus "Built-in schematic" where a kind has no template yet). Defaults: proscenium kinds →
  `proscenium@1`; church → `church-traditional@1`. Renaming, splitting ("Church — Traditional" / "— Contemporary")
  or re-pointing a category is a Settings change, not code. Stored on the venue-type record; sanitized server-side;
  admin-only like the rest of that card.
- A Grid base sheet stamps the template id + version it was drawn from (as `proscenium@1` does today, D433);
  existing Grid designs never change when a type is re-pointed or a template is redrawn (a redraw ships as `@2`).
  Quick Design and saved Designs render live from state, so they follow the venue type's current background (D433's
  "everywhere" rule).

## Stretching Church Traditional (key lines, the #249 engine)
Inputs (Quick Design dimension panel + Grid intake, church kinds only):
| Input | Field | Drives | Default (drawing) | Limits |
|---|---|---|---|---|
| Platform width | `width` (existing church field) | chancel inside width; the front step keeps its fixed overhang each side | drawing value (~51') | ≥ 16'; ≤ nave width − 2 × 8' |
| Platform depth | `depth` (existing) | chancel back part (front step keeps ~7') | drawing value (~26' incl. step) | ≥ 10' |
| Nave width | `houseWidthFt` (reuse #249 field, now shown for church) | inside wall-to-wall; the side rooms absorb nave − platform | 80' | ≥ platform width + 16'; ≤ 200' |
| Nave depth | `houseDepthFt` (reuse) | platform front → back-room wall | ~55' | ≥ 20'; ≤ 200' |
Fixed: 6" walls; back-room depth (~12'); front-step depth and its side overhang; the entry opening width (~19') —
the back rooms absorb nave-width change instead. **The apse scales uniformly** (radius and chord × platform-width
ratio, centre on the centreline, back-wall chord meeting the chancel back wall) so it stays a true arc — never a
non-uniform (elliptical) stretch. Nave narrower than platform + 16' → a warning under the fields (like D432's), not a
block. Existing church designs' `width`/`depth` (defaults 34 × 22) keep their meaning as platform width/depth;
`houseWidthFt`/`houseDepthFt` unset → the drawing's defaults.

## Integration (mirror #249)
- `churchGeom(s)` becomes template-backed (same consumers: `plan-svg.tsx` `buildPlanChurch`, Quick Design client,
  `grid-auto-layout.ts`, `grid-projects.ts`, the harness) — keep the fields consumers read, remove ones that only
  served dropped features. `buildPlanChurch` draws the stretched template (grey plan lines, labels in the plan text
  style) under its existing overlays (platform systems, symbols, legend, dimension chains incl. nave width/depth).
  **Pews/seating** keep being drawn by code inside the Nave region, sized to it, with a centre aisle aligned to the
  Entry. Doors: the drawing's openings are the entrances — the church door add/remove/drag (D434 kept it for church)
  is removed for template-backed church plans, like proscenium.
- Labeled regions become Grid Spaces and drive Auto fill placement (D435 pattern): Platform = the stage-equivalent
  anchor, Nave = house-equivalent (FOH mix/speakers per existing church rules), Apse/Choir Room/Electrical Room/
  Cry Room/Storage/Entry as Spaces.
- Converter: `REQUIRED["church-traditional"] = [Platform, Apse, Nave, Entry, Choir Room, Electrical Room, Cry Room,
  Storage]`; the DWG committed at `docs/venue-templates/source/church-traditional.dwg`; `--check` / `--selftest` as
  proscenium; a preview PNG `docs/venue-templates/church-traditional.png` and stretched renders
  `docs/venue-templates/renders/church-*.png` (default, small chapel, wide nave, deep nave) for Jeff.
- README: document the label overlay and the Background column.

## Testing
Converter: overlay merge, drawn-label precedence, required labels, `--check` byte-identical. Stretch: identity at the
drawing's own dims; walls stay 6"; driven spans hit the inputs; apse stays circular (sampled points equidistant from
the mapped centre within tolerance) and meets the back wall; side rooms never go negative (warning path); back rooms
absorb width, entry fixed. Settings: Background column sanitize/save/read, defaults, admin-only; venue type → template
resolution; Grid base-sheet stamp. Plan: church builder draws the template + pews in the Nave. Four gates + next build +
test:smoke; visual renders checked.
