# Bid Spec Generator (Consulting) — Design

**Date:** 2026-07-19
**Status:** Approved by Jeff (brainstorming session 2026-07-19, memory-repo session)
**Home:** Consulting module (D90). Spec-content authoring lives in the Catalog module.

## Problem / goal

Peak writes public bid specifications for consulting jobs (school districts,
architect project manuals). Today that knowledge lives in Jeff's head. Goal:
anyone at Peak — no AI, no Jeff — can produce an architect-ready bid spec from
an equipment list. Jeff authors the spec language **once**, attached to catalog
parts and section templates; the app assembles specs mechanically thereafter.

The BOM-driven flow answers the dropdown-menu alternative Jeff weighed: a
category-browser picker is quick to click through but pushes a "did I select
everything?" verification burden onto the user. Starting from a BOM (or an
in-app quote) plus a match report makes completeness automatic; a category
browser survives only as a supplement for one-off additions.

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| BOM source | Both: in-app quote line items OR uploaded/pasted BOM file |
| Spec structure | CSI 3-part sections (Part 1 General / Part 2 Products / Part 3 Execution) |
| Output format | .docx download (primary) + letter-style print/PDF view |
| AI in-app | None (consistent with D89 full AI removal). Jeff may use Claude at authoring time, outside the app. |

## Data model

Three new doc-store collections (same pattern as the rest of the app):

1. **`spec_sections` — spec sections library.** One record per CSI section
   (e.g. Stage Lighting 11 61 43, Performance AV 27 41 16). Fields: section
   number, title, sort order, Part 1 (General) boilerplate, Part 3 (Execution)
   boilerplate. Written once per section, reused on every generated spec.
2. **Part spec paragraphs — extension of catalog items.** Each catalog item
   may carry: a Part 2 (Products) spec block (plain rich text), the
   `spec_sections` id it belongs to, and an optional sort hint within the
   section. Authored in a new "Spec" panel on the catalog item detail. A bulk
   coverage view lists catalog parts with/without spec text (the authoring
   checklist).
3. **`generated_specs` — per-engagement artifacts** (like consulting letters).
   Fields: engagement id (CE-####), source (`quote:<id>` or uploaded BOM
   snapshot), match results (including "no spec required" markings + reasons),
   included sections, frozen assembled output, created/updated stamps.
   Regenerable when the BOM changes; regeneration shows a diff vs the prior
   version.

## Generation flow (Consulting tab, per engagement)

1. **Pick source.** Choose an in-app quote (line items flow in directly) or
   upload/paste a BOM. BOM parsing reuses the catalog price-book import
   machinery (`catalog/parse.ts` CSV/TSV parsing + column aliasing: sku,
   desc, qty, category).
2. **Match report — the verification step.** Every BOM row is matched to a
   catalog part: exact SKU match first, then description similarity with
   manual confirmation. Three buckets on screen:
   - *Matched, spec attached* — ready.
   - *Matched, no spec written yet* — blocks finalize until written or waived.
   - *No catalog match* — blocks finalize until mapped to a part or marked
     **"no spec required"** with a reason.
   Nothing silently drops. A category browser lets the user add items the BOM
   missed (the supplement role of the dropdown idea).
3. **Assemble.** Items group into their sections in library sort order;
   Part 2 paragraphs render within each section in category/SKU order (sort
   hints override); numbering is automatic (PART 1/2/3, 2.01, 2.02, A/B/C
   sub-points). Section Part 1/Part 3 boilerplate wraps the products.
4. **Output.** Primary: `.docx` download generated in-app with a docx library
   (offline, no network, no AI). Secondary: letter-style print/PDF HTML view
   for quick review. Header block: project name, engagement id, date, Peak
   branding from settings.

## Authoring workflow

- All spec language is plain data, edited in-app: section boilerplate in a
  Spec Sections screen (Consulting or Settings-adjacent; final placement at
  implementation), Part 2 blocks in the catalog item "Spec" panel.
- Jeff drafts initial content (with Claude's help outside the app); anyone can
  maintain it after. The app never calls an AI (D89 constraint).
- The library grows organically: parts without spec text simply appear in the
  "no spec written yet" bucket until someone writes them. Seed with the parts
  on the first real bid rather than trying to pre-author the whole catalog.

## Error handling

- Malformed BOM rows surface in the parse preview (existing import pattern);
  invalid rows are visible, not silently skipped.
- Finalizing is blocked while unresolved *no-match* or *no-spec* rows remain;
  "no spec required (+ reason)" is the explicit escape hatch and is recorded
  in the generated spec's match results.
- Regeneration never destroys the prior output silently — it diffs and the
  user confirms.

## Testing

- Matching engine: exact SKU, description-similarity candidates, ambiguity
  (two candidate parts), unmatched rows.
- Assembly: section grouping, ordering (library order, sort hints), numbering.
- Docx generation smoke test (document opens, headings/numbering present).
- Flow test: quote-sourced and BOM-sourced generation both reach finalize with
  all buckets resolved.

## Out of scope (this phase)

- Auto-reading drawings or design-tool exports beyond CSV/paste.
- AI-drafted spec text inside the app.
- Addenda / formal revision tracking beyond regenerate-with-diff.
- Lifting the generator outside the Consulting module.
