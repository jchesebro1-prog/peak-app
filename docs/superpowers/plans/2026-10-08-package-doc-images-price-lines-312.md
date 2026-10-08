# #312 — Package document: separate images, system price lines, removable tables; Estimator: edit custom parts, specs move to review

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Jeff's 2026-10-08 feedback on the Phase 5 package document editor and the Build step.

1. A price table (and a page break) can be removed once added.
2. A **system price line** — a live "<System name> · $X" row — can be dropped at the bottom of any
   system's narrative; new documents put it there instead of under the heading.
3. The product photo becomes its **own image piece**: just the image, Left / Right / Full + size,
   text wraps beside it, and it drags anywhere in the document. The product paragraph is words only.
4. Clicking a custom part line on Build reopens the Custom part form, filled in, to edit it in place.
5. The per-line **Spec** select leaves Build (line rows and the Custom part form) and lives in Customer review.

Jeff picked (AskUserQuestion, 2026-10-08): "System price line" (not group subtotals, not a bare chip) and
"Separate image piece" (not an image inside the paragraph).

## Global Constraints

- Older saved documents keep printing exactly as before (no migration): a `productBlock` whose `photo.show` is
  true still prints its own photo; a document's existing `systemPrice` chips keep working.
- One schema source of truth: every new node name/attr goes through `src/lib/package-doc/schema.ts`, the
  sanitizer (`sanitize.ts`), the resolver (`resolve.ts`), the client renderer (`package-doc-view.tsx`) and the
  editor schema (`schema-nodes.ts`); the harness's editor-vs-schema name check must stay green.
- New block nodes (exact names): `systemTotal` (atom, attrs `{ sectionId }`), `productImage` (atom, attrs
  `{ sectionId, lineKey, sku, align, width }`, align ∈ left|right|full, width 25–100 via `clampPhotoWidth`,
  default `{ align: "right", width: 34 }`).
- Copy (exact): button `Remove` on the price table, page break, system price line and image; editor tag
  `System price · live`; left-pane BOM system action `+ Price line`; image controls `Left` `Right` `Full`
  `Size`; old product block button `Separate photo`; review panel heading `Specs`; custom form edit button
  `Save changes` (add stays `Add custom part`), and `Cancel`.
- `systemTotal` prints as one row: system name left, its `systemSellTotal` right (mono), bold, a thin rule
  above; an alternate system's row adds ` — priced separately`; a missing system prints nothing and shows the
  editor's amber `removed` state and a Gaps row (like removed chips). It counts as mentioning its system.
- `productImage` prints the same photo source as the product block (`ctx.photos[sku]` → the line's kind
  placeholder via `docBlockPlaceholder`-equivalent → nothing); floated left/right (`width`% of the column,
  max-height 2.4in) or full (block, centred, max-height 4in); phones ≤ 480px always full width; headings
  `clear: both` so an image never spills into the next system. Line gone from BOM → editor amber
  `No longer in BOM`, still prints (same rule as product blocks). Every sku walker includes it:
  `docPhotoSkus`, `docProductSkus` if it feeds photo prefetch, `docManufacturerFallbackSkus`,
  `keyProductPrintSections`, the #304 rename rewrite (`catalog-rename/rewrite.ts`), and gaps.
- Insert paths that used to make a photo'd product block now make `productImage` + `productBlock`
  (photo `{ show: false }`) — seed, BOM line drag/+, + Key product. Old blocks with `photo.show` keep their
  photo controls plus `Separate photo` (inserts a `productImage` before the block, sets the block's
  `show: false`, one transaction).
- Seed / system insert: heading → intro → key products → `systemTotal` (no price-chip paragraph under the
  heading). Dragging/+ a system from the BOM inserts heading, an empty paragraph (cursor lands there),
  `systemTotal`.
- Custom part edit: a line with `custom: true` (not labor / track / curtain / fixture / vendor) is editable
  by clicking its description (title `… — click to edit this custom part`) and a ✎ action button, like
  labor/track/curtain. The form opens pre-filled from the line; `Save changes` replaces that line's fields
  in place (same id, same position, same `lineOrder`), re-runs the same validation as add, and never
  re-saves it to the catalog unless the user ticks the existing "add to catalog" option. Cancel restores.
- Specs: remove `SpecKeySelect` from the Build line rows and from the Custom part form. Customer review's
  internal sidebar gains a `Specs` card listing every custom and curtain line (system · description) with the
  same `SpecKeySelect` (value `it.specKey`, auto `autoSpecKeyFor(it)`, `setItemSpecKey`); hidden when there
  are none; staff-only like the rest of the sidebar. The phone review layout gets the same list if the
  sidebar renders there; otherwise desktop only.
- Gates per task: `npx tsc --noEmit` 0; scoped eslint clean (never `npm run lint`); `npm run test:specs`
  0 FAIL with new `#312` blocks appended at the END of `scripts/test-review-and-spec.ts`; `npx next build`
  when client code changes. Never `git stash`; never touch `.data/`. Commit trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Removable atoms + system price line

**Files:** `src/lib/package-doc/{types,schema,sanitize,resolve,seed,insert,gaps,text}.ts`,
`src/components/package-doc/package-doc-view.tsx`, `src/components/package-doc/editor/{schema-nodes,extensions,
price-table-view,page-break-view,left-pane}.tsx|ts`, new `editor/system-total-view.tsx`.

- [ ] Price table + page break node views: a `Remove` button (shown on hover / when selected, like the product
  block's) calling `deleteNodeAt(editor, getPos())`.
- [ ] `systemTotal` node end to end per Global Constraints (types, schema lists, sanitizer — drop when
  `sectionId` is empty/oversize, resolver row `{ t: "systotal", name, price, alternate }` or null, renderer,
  editor atom view tagged `System price · live` with Remove, draggable).
- [ ] Seed + `systemNodes` per Global Constraints; left-pane BOM system row gains `+ Price line` (insert at
  cursor; also draggable with a new payload kind `systemTotal` through `parseDocNodePayload` /
  `docNodesFor`).
- [ ] Gaps: removed `systemTotal` → its own row (reuse the removed-chip row with kind `systemPrice`, or a new
  kind — your call, the row must say the system was removed); a `systemTotal` marks its system mentioned.
- [ ] Harness `#312 price lines`: sanitizer accepts/drops, resolver values (in-total and alternate), seed puts
  the line last in each system, gaps, editor schema names match.
- [ ] Commit `feat(package-doc): #312 removable price table, system price lines`.

### Task 2: Separate product image

**Files:** same modules + `editor/product-image-view.tsx`, `editor/product-block-view.tsx`,
`editor/editor-commands.ts`, `editor/toolbar.tsx`, `src/lib/catalog-rename/rewrite.ts`, `print.ts`.

- [ ] `productImage` node end to end per Global Constraints. Editor view: the image only (no label), floated
  like print so following paragraphs wrap in the editor too; when selected a small control strip
  (`Left` `Right` `Full`, `Size` slider, `Remove`); amber outline + `No longer in BOM` when its line left;
  `No photo for this part` placeholder box while no photo resolves (editor only); draggable.
- [ ] Insert paths make image + words; old photo'd blocks get `Separate photo`; the toolbar's photo controls
  act on a selected `productImage` (and on an old block that still shows its photo).
- [ ] Every sku walker + the #304 rename rewrite include `productImage`.
- [ ] Renderer: `.pd-doc h2,h3,h4 { clear: both }`, phone rule for `.pd-image img`.
- [ ] Harness `#312 images`: sanitizer, resolver (own photo, placeholder, hidden none), seed shape, rename
  rewrite, sku walkers, an old document with `photo.show: true` resolves byte-identically to before.
- [ ] Commit `feat(package-doc): #312 product photo as its own image`.

### Task 3: Edit custom parts; Specs move to review

**Files:** `src/app/(app)/estimator/section-card.tsx`, `use-estimator-state.ts`, `steps/build-step.tsx`,
`steps/review-sidebar.tsx` (and `review-step.tsx` if props thread through).

- [ ] Custom part click-to-edit per Global Constraints (hook `editCustomPart(secId, lineId)` opens the form
  pre-filled; `addCustomPart` becomes add-or-save by an `editingLineId` in the draft state).
- [ ] Remove the Spec select from Build rows and the custom form; add the review `Specs` card.
- [ ] Harness `#312 estimator` (source pins + any pure helper behaviour). Keep `next` LAST in the hook's
  return and the `setSectionsState(` count pin at 5.
- [ ] Commit `feat(estimator): #312 edit custom parts in place; Specs move to Customer review`.

### Task 4: Verify + docs

Browser pass on a scratch DB (custom part edit, Specs card, document: remove table, price line, image
left/right/full + drag + wrap, PDF preview). Smoke. DECISIONS D679+, PUNCHLIST #312, AGENTS entry 42
(numbers re-read from origin/main right before writing). Commit `docs: #312 package document images and
price lines, custom part edit, specs in review`.
