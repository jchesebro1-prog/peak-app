# The Grid — object symbols, DaVinci drawings and a symbol-scale slider (#300) — design

**Status:** Shipped 2026-10-05 (D605–D612).

**Date:** 2026-10-05 · **Punch:** #300 · **Decisions:** D605–D612 · **Approved by:** Jeff (2026-10-05, in session)

## Ask

After #299 shipped, Jeff: "Can we also try to make the symbols that DaVinci has import as well and have the option for
generic symbols or object symbols? … as we build out the symbols then we have the ability to see what the objects look
like. Also can we have a scale objects slider because sometimes the symbols are too big other times they are too small."

| Question | Answer |
|---|---|
| Scale slider | **Saved per design** — the plan view and printed drawing sets match; everyone sees the same size |
| Object mode with no drawing yet | **Fall back to the generic icon** — nothing disappears while the library is built out |
| Where object drawings show | **Grid plan canvas, printed drawing sets, Product Library tiles, riser view** |
| Building out non-DaVinci drawings | **Both** — a per-part drawing wins, else the device type's drawing, else generic |
| Rights | Peak has **ETC's dealer permission** to use DaVinci's product drawings |

## Today

- Every marker is a generic `SymbolShape` (a coloured rounded rect + a Tabler glyph; `src/components/design/symbol-shape.tsx`),
  resolved by `symbolLook` (`src/lib/design/grid-icons.ts:391`). Pure SVG — the harness asserts it never emits `<image`.
- Marker size is `PartLite.symbolWidth/Height` (from `GridSymbol.width/height`, seeded once — 44×30, 48×34 or 54×38;
  assemblies 74×52) in **sheet pixels**: the canvas viewBox is the sheet's natural/rendered pixel size, so the same symbol
  looks tiny on a 24×36 PDF and huge on a small image. Nothing edits it. The `|| 44` / `|| 30` fallback is duplicated in
  `plan-canvas.tsx:528` and `set/page.tsx:198`; the hit radius (`DEVICE_HIT_RADIUS = 0.028` of page width) is independent of
  the drawn size.
- Drawing-set plan sheets draw `SymbolShape` at `pl.w*K × pl.h*K` (`set/plan-sheet-figure.tsx:243`, collision boxes :114).
  The riser draws a fixed 12×12 badge per device row (`src/components/drawing/riser-canvas.tsx:279`; rows `NODE_ROW=16`).
- Part documents (`part_documents` + `part_document_links`, kinds datasheet / specsheet / manual / image) upload direct to
  private Blob with magic-byte checks; images shrink to ≤1600 px WebP. **SVG is refused everywhere; there is no sanitizer.**
- The DaVinci export on this Mac (`data/davinci/source/2026-09-02T01-37-52-850Z`, gitignored): 2,366 types, each with
  `visuals.data.{imageId, riserImageId}`; 647 distinct plan icons (234 downloaded → ~400 types), riser drawings 270 distinct
  downloaded → ~407 types; files `images/{uuid}.svg|png`. 691 SVGs carry Illustrator `<style>` classes (`.st0`…) that collide
  when inlined; one contains `<script>`. The committed extract (`data/davinci-extract.json`) carries no image ids yet.

## Design

### 1. Per-design display settings (D605)

- `GridProject.symbolDisplay?: { scale: number; mode: "generic" | "object" }` — `scale` 0.25–4 (step 0.05, default 1),
  `mode` default `"generic"`. Cleaned by a pure `cleanSymbolDisplay` (unknown/invalid → defaults). Saved by
  `setSymbolDisplay` (store) / `setSymbolDisplayAction` (requireUser, revalidate editor + set + riser). Undo does not cover
  it (a display setting, not an edit; it does not clear the undo stack either).
- **Toolbar:** a "Size" slider (25–400 %, shows the %, double-click resets to 100 %) and a Generic / Object segmented toggle.
  The slider paints live and saves once on release (debounced).
- **Scale applies to:** canvas markers (w, h), assembly child markers, the label chip offset, the selection ring and the
  **hit radius** (`DEVICE_HIT_RADIUS × scale`, so small symbols stay clickable and big ones don't swallow neighbours), and
  drawing-set plan sheets (marker size and collision boxes). One shared pure helper `markerBox(part, scale)` replaces the
  duplicated `|| 44 / || 30` fallbacks. The riser is schematic and does not scale.

### 2. Object drawings (D606–D609)

- **Storage (D606):** a fifth part-document kind, **`symbol`**, in the existing `part_documents` / `part_document_links`
  collections and private Blob — one current symbol per part (attaching a new one replaces the link; history kept like
  images). Device types gain `symbolDocId?` in the device-types blob. A riser drawing is a second kind, **`riser`**, same rules.
- **Accepted files (D607):** PNG / JPEG / WebP (shrunk to ≤ 1024 px WebP, transparency kept) and **SVG**. Every SVG is
  sanitized on the way in by a pure `sanitizeSvg(text)` (`src/lib/part-docs/svg-sanitize.ts`): drops `<script>`,
  `<foreignObject>`, `<iframe>`/`<embed>`/`<object>`, every `on*` attribute, `href`/`xlink:href` values that aren't `#…` or
  `data:image/(png|jpeg|webp)`, `<?xml-stylesheet?>` and external `url(...)` in styles; refuses anything that isn't a single
  `<svg>` root, over 1 MB, or that still contains `javascript:` after cleaning. Magic-byte sniffing recognises SVG text.
- **Rendering (D608):** object drawings are **only ever drawn as images** — `<image href>` in SVG overlays, `<img>` in HTML —
  never inlined (no script, no style-class collisions). Served by the existing signed-in `/api/part-documents/[id]` route,
  which adds `Content-Security-Policy: sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'` and `nosniff`
  for SVG. A new `ObjectSymbol` component draws the image fitted (contain) inside the marker box with a faint outline when
  selected; `SymbolShape` is untouched (its harness check stays).
- **Resolution (D609):** pure `resolveObjectSymbol(part, ctx)` → part symbol doc → device-type symbol doc → `null` (draw
  the generic `SymbolShape`). Riser: riser doc → plan symbol doc → generic. The editor/set/riser pages load a
  `symbolUrls: Record<partId, {plan?: url, riser?: url}>` map server-side for the parts in view (one query), so clients
  never resolve documents themselves.
- **Where:** the plan canvas in Object mode; drawing-set plan sheets in the design's mode (the set prints from the browser via
  `PrintButton`, signed in, so the images load through the same route); Product Library tiles always show the drawing when one exists
  (generic otherwise); the riser view in Object mode grows device rows to fit the riser drawing.
- **Build-out UI:** the catalog part editor's Documents section gains **Symbol drawing** and **Riser drawing** slots
  (upload, replace, remove, preview on a checkerboard); Grid Settings → Device types gains a drawing slot per type.

### 3. DaVinci import (D610–D611)

- The extract (`scripts/davinci-extract.ts` → `data/davinci-extract.json`) gains `planImageId?` and `riserImageId?` per
  record (ids normalised without braces). Existing extract checks keep passing.
- `npm run symbols:davinci` (`scripts/symbols-davinci.ts`): dry-run by default; `--apply` (and `--yes` on a hosted DB, the
  `scripts/db-target.ts` rule) to write. For each catalog part matched to a DaVinci type exactly as #162/#207 do
  (`matchSku` + `peakMfrFor`), when the type's plan/riser image file exists on disk: sanitize (SVG) or shrink (PNG), upload
  to Blob, create a `symbol` / `riser` document `source: "davinci"`, `sourceRef: imageId`, and link it — **never replacing
  a drawing a person uploaded** (source ≠ davinci), idempotent by `sourceRef` (re-runs add only what's new). Prints counts:
  matched parts, drawings attached, skipped (not downloaded / already present / hand-uploaded).
- A fresh DaVinci export after browsing more of the library adds coverage; the same command picks it up (D611).

### 4. Rights (D612)

Peak has ETC's dealer permission to use DaVinci's product drawings (Jeff, 2026-10-05). Drawings stay private (signed-in
routes; customer portal unchanged in v1).

## Delivery — three slices

1. **Scale + mode** — `symbolDisplay` field/store/action, `markerBox`, toolbar slider + toggle, canvas (markers, children,
   ring, label, hit radius) and drawing-set scaling. Object mode is selectable but draws generic until slice 2.
2. **Object drawings** — `symbol` / `riser` kinds, SVG sanitizer + sniffing + serving CSP, `ObjectSymbol`, resolution +
   server `symbolUrls`, canvas / set / Library / riser rendering, part-editor slots, device-type slots.
3. **DaVinci import** — extract ids, `symbols:davinci` script (dry-run/apply), dev run; production run is Jeff-gated.

## Testing

- Pure units in `test:specs`: `cleanSymbolDisplay`, `markerBox`, scaled hit radius, `sanitizeSvg` (script, on*, foreignObject,
  external href, xml-stylesheet, javascript: urls, non-svg root, oversize — and a real DaVinci SVG with `<style>` survives
  intact minus the dangerous bits), SVG sniffing, `resolveObjectSymbol` order, extract image-id parsing, the import plan
  (pure: matched / skipped / never-replace-manual / idempotent).
- Store/async: symbol + riser documents attach/replace; device-type `symbolDocId` round-trip; `setSymbolDisplay`.
- Gates per slice: tsc, test:specs, eslint, `next build`; test:smoke at the end. Browser checks on the scratch datadir.

## Out of scope

True-to-scale drawings from real product dimensions; rotating symbols; symbols in the customer portal; per-sheet scale.
