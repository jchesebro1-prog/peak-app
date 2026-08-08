# Client package generator: BOM → datasheets + spec + rough drawings

**Wave 2 · mostly assembly.** Authored off-mini 2026-07-25. Depends on the
wave-1 catalog spec's attachments being POPULATED (the generator is only as
complete as the catalog behind it).

## Goal (Jeff, verbatim)
*"If we prepare a BOM we can easily generate a datasheet, spec, and rough
drawings for the client without too much effort or work."*

## What already exists (assemble, don't rebuild)
- **Grid → D94 bid-spec bridge** — built slice.
- **D94 spec engine** — quote/BOM → CSI 3-part → real .docx
  (`/api/spec/[id]/docx`); spec language hard-coded on parts (D89, no AI);
  match report = completeness guarantee. Numbering is literal text with
  hanging indent BY DESIGN (architects paste into project manuals) — keep.
- **Derived riser sketch** — built slice (editable riser + DXF export are
  QUEUED separately; do not block on them).
- **Catalog-anchored datasheets** — wave-1 catalog spec (D116 blob store).

## The missing piece
One action — from a Grid project, quote, or BOM — that walks the line items
and emits a bundle:
1. **Datasheet package:** merge the referenced parts' datasheet PDFs, with a
   cover index ordered by category/scope. Parts lacking datasheets are
   LISTED on the cover as gaps, never silently skipped (match-report ethos).
2. **Spec:** the existing D94 output for the same item set.
3. **Rough drawings:** current plan sheet render + derived riser as PDF
   pages ("rough" is the promise — not stamped drawings).
Output: a zip of the three documents on the project, stored via D116 blob,
downloadable/shareable.

## Build tasks
0. Recon: D94 entry points + match report shape; riser/plan render-to-PDF
   options (pdf.js render exists; server-side compose TBD); blob helpers.
1. Bundle walker: item set → {datasheets[], gaps[], specInput, drawings[]}.
2. PDF merge + cover/index page (category/scope-ordered, gap list).
3. One-click action on Grid project + quote; store + download.
4. Gap surfacing: per-part "missing datasheet/spec" chips linking to the
   catalog editor (drives attachment population where it matters first).

## Resolved (2026-08-07 planning pass)
- **Bundle format: zip of three documents** (datasheet PDF, spec .docx, rough
  drawings PDF) — confirmed, matches the spec default. Keeps the spec as an
  editable .docx (D94/architects-paste-into-manuals convention) rather than
  flattening it into the merged PDF.
- **CRM-thread attach: out of scope for v1.** Ship the one-click
  generate-and-download first; attaching to the CRM thread/customer record
  for send-out is a fast-follow, not bundled into this build.

## Acceptance
From a Grid project with a painted BOM: one click yields spec .docx +
datasheet package + plan/riser PDFs; any part missing a datasheet appears on
the cover index as a gap; the same action works from a quote.
