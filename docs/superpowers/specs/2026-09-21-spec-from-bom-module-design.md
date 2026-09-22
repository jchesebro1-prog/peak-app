# Specs module: BOM → CSI spec package — Design

**Date:** 2026-09-21
**Status:** Approved by Jeff (brainstorming session 2026-09-21, six design
sections approved in turn)
**Supersedes in part:** D94 (anchor and document model), D111 (Grid door)
**Specimen:** the eleven North HS Auditorium sections (project 3580, issued
2026-07-30) in `Dropbox/Claude/2026-08-07_North_HS_Theatrical_Specs/`

## Problem / goal

Jeff, verbatim: *"if a product is added to a BOM it generates a spec like the
ones listed and links it all together for easy generation. This logic would
also live in the design module and do the same thing."* Follow-up: *"a new
module that estimates and the grid can pull from if the rep wants to do that."*

Peak writes project-manual specifications in CSI three-part form for bid
jobs. Today that is a copy-and-paste exercise from prior specs and
manufacturer guide-spec text; the specimen carries the scars (a hoist block
pasted twice, "sixty (30) days", a rigging section whose quality-assurance
clause talks about lighting). D94 built a generator whose completeness rule
is right but whose document model is two levels deep, one file for every
section, and anchored on a consulting engagement. The goal is a Specs module
in which a product carries its own approved spec language, any BOM (the
estimator's, The Grid's, an engagement's, or an uploaded list) can be turned
into a package of per-section documents matching the specimen, and the
library grows as Peak bids.

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| Where product language comes from | **Authored text only.** A product with no written spec blocks finalize until someone writes or waives it (D94's rule kept). No skeleton fallback, no attribute-driven prose, no in-app AI. |
| Section families Peak generates | All four: rigging and curtains; theatrical lighting and controls; AV and communications; shell, pit filler and other stage gear. |
| First real content | **Seed from the North HS set, offline.** Converted outside the app into import files. No in-app PDF parser. |
| Architecture | **A new Specs module** the estimator and The Grid pull from when the rep asks. Built by moving the D94 engine under it: one matcher, one docx builder, one frozen record. |
| AI | **Outside the app only**, as a `spec-writer` Claude skill that emits the module's import files. D89 stays intact: the app is deterministic. AI at authoring time, never at generation time; only human-approved text ever prints. |

Locked constraints carried forward: D89 (no AI in the app), D94 (match report
as the completeness guarantee; language lives on the catalog part), D94a (real
.docx, literal numbering with hanging indents), D141 (idempotent migrations).

## What the specimen shows versus D94 today

| Aspect | D94 today | North HS specimen |
|--------|-----------|-------------------|
| Document unit | One document containing every section | One file per section, running header (date, project, project no., phase), footer "11 61 23 - 1" |
| Part 1 / Part 3 | One flat text block each, auto-numbered 1.01, 1.02… | Titled articles (1.1 Section Includes, 1.2 Submittals…) with a nested outline; some content derives from the BOM (systems included, acceptable manufacturers) |
| Part 2 organization | Flat: 2.01 part, 2.02 part… | Category articles (2.1 Stage Drapes, 2.3 Packaged Hoists) each opening with "A. General": acceptable manufacturers + basis-of-design clause, then products B, C, D… |
| Product entry | Blank-line paragraphs rendered A/B/C | Per-category skeleton five levels deep (fixture: Basis of Design, Standards Compliance, Source, Color, Control, Electrical); manufacturer guide-spec wording |
| Quantities | Printed on every product line | Deferred to drawings and schedules in rigging and lighting; printed as an equipment table in AV |
| AV sections | Same paragraph model | Part 2 is literally the BOM table (Qty, Mfr, Model, Description) under a narrative Part 1 |
| Curtains | Grid mints SKU `CURTAIN`; every curtain is a no-match row | One entry per curtain type: Material, Color, Fabrication, Hang Method, with fullness deciding the fabrication wording and type deciding the hang |
| Manufacturers | Not modeled | Per-article acceptable-manufacturers list; per-product basis-of-design manufacturer and model |

## 1. Module shape

**Nav.** A `Specs` child of the DESIGN group in `nav-data.ts`, beside
Consulting and The Grid, at `/design/specs`, with its own active key (the
`/design` prefix otherwise maps to the overview).

**Screens.**

| Route | Screen |
|-------|--------|
| `/design/specs` | Generated: every saved package from any source, newest first |
| `/design/specs/new?source=<kind>:<id>` | Generator: source → rows → match report → header → save |
| `/design/specs/[id]` | A saved package: its sections, print view per section, docx per section, zip |
| `/design/specs/library` | Sections, their articles, and the per-part coverage table |
| `/design/specs/library/[sectionId]` | Section editor (Part 1/Part 3 articles, style switches, article list) |
| `/design/specs/templates` and `/[key]` | Template (formula) editor per category |
| `/api/spec/[id]/docx?section=<number>` | Route handler: one section's .docx |
| `/api/spec/[id]/zip` | Route handler: the whole package |

**The D94 engine moves.** `lib/bid-spec.ts`, `lib/bid-spec-docx.ts`,
`stores/spec-sections.ts`, `stores/generated-specs.ts` and the actions under
`design/engagements/spec/` become the module's engine. The engagement spec
page becomes a redirect to `/design/specs/new?source=engagement:<id>`, the
same way `/consulting/spec` already redirects (D97). Deep links keep working.

**Four doors, all opt-in.** Nothing generates until a rep asks.

- **The Grid editor.** The existing "Bid spec from this design →" link stops
  requiring a live engagement and becomes "Spec from this design", linking to
  `source=grid:<projectId>`. The generator builds rows server-side from the
  project's live BOM (`bomLines` + `curtainLines`), so curtain configurations
  travel with the rows. Once the Grid options work (spec
  `2026-09-21-grid-options-and-intake-branch-design.md`) merges, the door
  passes the active option's slice and the package label carries the option
  name; until then it passes the whole project.
- **The estimator and quotes.** The estimator toolbar and the quote row menu
  gain "Spec from this quote" → `source=quote:<quoteId>`, offered only when
  the quote has equipment lines.
- **Engagements.** The engagement page keeps its door → `source=engagement:<id>`;
  the generator then offers the engagement's linked quotes as the BOM, or
  upload, exactly as today.
- **Upload or paste** → `source=upload`, parsed with the existing CSV path.

**Anchor.** A package records its source `{ kind: "grid" | "quote" |
"engagement" | "upload", id, label }` plus optional `customerId` and
`engagementId` so it appears on those records. An estimator quote can
generate a spec with no consulting engagement in the picture.

**Package header.** Entered at generation and prefilled from the most recent
package with the same source: project number, project name, phase (default
"Construction Documents"), issue date (default today), prepared by (default
the signed-in user), customer (from the source). It prints in every
section's running header and in the file names.

**Permissions.** Reads need `requireUser()`. Generating, saving, and every
library or part write need `requirePerm("create")`.

## 2. Library data model

All plain data in doc-store collections, editable in the module. Three new
collections (`spec_articles`, `spec_templates`, `spec_curtain_templates`) are
new tables via `docTable()` and need a migration with `IF NOT EXISTS` guards
and the `_seq_bump` trigger the doc-tables header describes. None is
syncable. `spec_sections`, `generated_specs` and `catalog_parts` gain fields
additively.

### Sections (`spec_sections`, extended)

```
SpecSection {
  id, number ("11 61 23"), title, sort,
  part1: SpecArticle[],          // titled articles, replaces flat part1 text
  part3: SpecArticle[],          // titled articles, replaces flat part3 text
  part2Style: "paragraphs" | "table",   // default "paragraphs"
  quantities: "drawings" | "inline",    // default "drawings"
  updatedAt, updatedBy
}
SpecArticle { id, title ("SUBMITTALS"), body (outline text) }
```

A saved section whose `part1`/`part3` are still strings reads as one
untitled article each; the section editor rewrites them on first save.

### Category articles (`spec_articles`, new)

```
SpecCategoryArticle {
  id, sectionId, sort,
  title ("Theatrical Stage Drapes"),
  manufacturers: string[],       // acceptable manufacturers, in order
  general: string,               // the "A. General" outline; may use {{manufacturers}}
  categoryKeys: string[],        // catalog categories and/or taxonomy groups that default here
  updatedAt, updatedBy
}
```

Articles number 2.1, 2.2… in `sort` order within their section. A catalog
part whose `category` (or its resolved taxonomy group) appears in an
article's `categoryKeys` defaults into that article when it has no explicit
`specArticleId`; that is a pre-placement only, the part is still "no spec"
until text exists.

### Product entries (fields on `catalog_parts`)

Extends D94's `PartSpecFields`:

```
specArticleId?: string      // replaces specSectionId; a part with only specSectionId
                            // resolves to that section's first article (lazy, no data migration)
specTitle?: string          // generic name printed as the entry heading, e.g.
                            // "COLOR MIXING LIGHT EMITTING DIODE PROFILE FIXTURE"
specBody?: string           // outline text (see convention below)
specSameAs?: string         // SKU whose specTitle/specBody/specArticleId this part reuses
specSort?: number           // order within the article
specState?: "authored" | "draft"   // draft = imported from the skill, not yet reviewed
specSource?: string         // provenance label: "authored", "seed:northhs-2026-07-30", "skill:<date>"
specUpdatedAt?, specUpdatedBy?
model?: string              // manufacturer model number; catalog SKUs are Peak's own ids,
                            // and the table-style Model column needs the real one
```

`model` is a general catalog field, not a spec field: it prints in the
table-style Model column (falling back to the SKU when absent), gets an
import column, and is what the seed matches against alongside `mfr`.

`specSameAs` resolves one hop only; a chain or a cycle is reported as
"no spec" for the pointing part. The pointing part's own Basis of Design line
still prints from the target's body, which names the family.

### Templates, the formulas (`spec_templates`, new)

```
SpecTemplate {
  id, key ("Fixtures", "Lighting Controls", "Hoists", "Speakers", …),
  title,
  headings: Array<{ label: string; guidance: string }>,  // ordered; guidance = what to pull from the cut sheet
  rules: string,        // phrasing rules ("shall", basis-of-design clause, listings first…)
  example: string,      // one worked entry in outline text
  updatedAt, updatedBy
}
```

"Insert template" in the part editor writes the headings as a numbered
scaffold into an empty body. `Export templates` writes every template to one
JSON file, which is the guide the skill reads. `db:seed` seeds starter
templates (headings and guidance, no example) so a fresh database has the
formulas; the North HS seed supplies refined templates with worked examples
and replaces the starters by key.

### Curtain templates (`spec_curtain_templates`, new)

One document per Grid curtain type (`Border`, `Draw`, `Full`, `Leg`):

```
SpecCurtainTemplate {
  id: GridCurtainType, articleId, sort,
  title ("Legs"),
  body: string,                 // outline text with slots
  fullnessClauses: Record<"0" | "50" | "75" | "100", string>,
  hang: string,                 // the Hang Method clause for this type
  defaultColor: string,         // e.g. "Black unless noted otherwise"
  updatedAt, updatedBy
}
```

Slots: `{{name}}`, `{{material}}` (fabric row `desc`), `{{color}}`
(placement color, else `defaultColor`), `{{fullness}}` (e.g. "50%"),
`{{fullnessClause}}` (the clause for the placement's fullness),
`{{hang}}`, `{{width}}`, `{{height}}` (feet). `GridCurtain` gains an optional
`color` string and the curtain modal an optional Color field. The
specimen's seven entries collapse into the four types plus fabric: a valance
is a Border in velour, scrim and cyclorama are Full drops in scrim or muslin.

### Outline convention

Bodies are plain text, one item per line, indented two spaces per level (a
tab counts as one level). The renderer assigns labels by depth:
`A.`, `1.`, `a.`, `1)`, `a)`. Depth beyond the fifth level clamps to the
fifth with a preview warning. Blank lines are ignored. A line that already
starts with a label such as `A. ` or `1. ` has it stripped so pasted Word
text does not double-number. Inside a product entry the product letter
consumes the first level, so a body's top level prints as `1.`, `2.`…;
inside a Part 1 or Part 3 article the body's top level prints as `A.`, `B.`…
Article numbers in all three parts use the specimen's `1.1` / `2.1` / `3.1`
form, not D94's `2.01`.

### Placeholders

Substituted deterministically at assembly; an unknown placeholder prints
literally and raises a preview warning.

| Placeholder | Value |
|-------------|-------|
| `{{articles}}` | Lettered list of the Part 2 article titles present in this document |
| `{{manufacturers}}` | Lettered list of the enclosing article's manufacturers |
| `{{project.number}}`, `{{project.name}}`, `{{project.phase}}`, `{{project.issueDate}}` | From the package header |
| `{{section.number}}`, `{{section.title}}` | The enclosing section |

### Generated packages (`generated_specs`, extended)

```
GeneratedSpec {
  id, createdAt, createdBy,
  source: { kind, id, label },            // new
  customerId?, engagementId?,             // engagementId kept from D94
  header: { number, name, phase, issueDate, preparedBy, customer },   // new
  rows: MatchedRow[],                     // the resolved match report, frozen
  documents: AssembledSectionDoc[],       // one per section, frozen
  waivedCount
}
AssembledSectionDoc {
  number, title, style: "paragraphs" | "table", quantities,
  part1: RenderedArticle[],               // { number "1.1", title, lines: OutlineLine[] }
  part2: RenderedCategoryArticle[],       // { number "2.1", title, general: OutlineLine[], entries: RenderedEntry[] }
  tableRows?: TableRow[],                 // table style only: { qty, mfr, model, desc }
  part3: RenderedArticle[],
  fileName: string,
  warnings: string[]                      // unknown placeholders, clamped depth
}
RenderedEntry { letter, title, sku, qty?, lines: OutlineLine[] }
OutlineLine { depth, label, text }
```

Records saved by D94 keep their `spec`/`bom` fields and still open and
download; the Generated screen reads both shapes.

## 3. Generation flow

1. **Source → rows.** Every door yields `BomRow { sku, desc, qty, unit,
   curtain?: GridCurtain & { fabricName } }`. The Grid door builds rows from
   `bomLines` + `curtainLines`. The quote door reads the estimator's nested
   `spec.sections[].items[]` and the Grid's flat `spec.lines[]` as
   `bomFromQuoteAction` does today, skipping optional-scope lines, with one
   change: the Grid's quote-mint action now writes the curtain configuration
   onto each `CURTAIN` line so a quote-sourced package can fill curtain
   templates. Upload rows parse as today.
2. **Match report.** Exact SKU, then description similarity offering up to
   four candidates for a human to confirm (D94, unchanged). New resolutions
   before bucketing: a `specSameAs` pointer follows one hop; a curtain row
   resolves to its type's curtain template, and a missing template is a
   "no spec" row. Buckets: `ready`, `no-spec` (includes `draft` state),
   `no-match`, plus `waived` with a reason. Remap-to-part and write-inline
   stay. Finalize is blocked while any row is unresolved.
3. **Assembly.** Ready rows group into articles (explicit `specArticleId`,
   else the category default), articles into sections, sections in library
   order; sections with no rows are dropped. Curtain rows group by type +
   fabric + color + fullness into one entry per group (sizes and quantities
   are per the curtain schedule, as the specimen says). Part 1 and Part 3
   articles print with placeholders filled. A paragraph-style section prints
   each article's General clause as `A.` then its entries lettered from `B.`
   in `specSort` order. A table-style section prints its articles' General
   clauses and then one table for the section, rows ordered by article then
   sort, columns Qty, Manufacturer, Model, Description, where Model is the
   part's `model` or, failing that, its SKU. Quantities print on product
   entries only when the section says `inline`.
4. **Output is a package.** One .docx per section built from the assembled
   structure: running header (issue date, project name, project number,
   phase), footer (section title, section number, page), literal numbering
   with hanging indents (D94a), Times New Roman as today. File names follow
   the specimen: `<number>_<name>_Spec <section number>_<section title>_<MM-DD-YYYY>.docx`,
   with filesystem-unsafe characters replaced. The zip is
   `<number>_<name>_Specs_<MM-DD-YYYY>.zip`, built with the `jszip` already
   in the tree. Each section also has an HTML print view, which is the
   print-to-PDF path.
5. **Frozen on save.** The record stores source, header, resolved rows and
   assembled documents. Regenerating writes a new record beside the old one.

## 4. Authoring and import

- **Spec panel on the part editor** (`catalog/controls.tsx`, beside the
  datasheet control): article picker defaulting from the category map,
  generic title, outline body, "same spec as" SKU, and a live preview
  rendered as the document will print. An empty body offers "insert
  template". Saving stamps `specState: "authored"`, `specSource: "authored"`,
  who and when.
- **Coverage table** in the Library, per article: every part that maps there
  with its state (authored, same-as, draft, missing), filterable by "on a BOM
  in the last 90 days" and "has a datasheet". "On a BOM" means the SKU
  appears in a quote line, a Grid placement, or a generated package's rows
  created in that window. Missing rows link to the part editor.
- **Section, article and template editors** are new screens; until now the
  library had only a seed button.
- **Import through the existing hub.** The `catalog` import type gains
  columns `model`, `spec_article`, `spec_title`, `spec_body`, `spec_same_as`,
  `spec_state`, `spec_source`. It writes through `mergeUpsert`, which
  preserves untouched fields, so a spec import never disturbs pricing or
  ports and a price re-import never disturbs spec text. A new `spec-library`
  import type loads sections, articles, templates and curtain templates from
  JSON; export writes the same files.
- **Approval is the rule.** Rows imported with `spec_state: draft` land as
  drafts. The match report treats a draft like a missing spec until someone
  opens the part and saves, which flips it to `authored`. Only authored text
  prints.

## 5. The spec-writer skill (outside the app)

Lives in the repo's `.claude/skills/spec-writer/` so it ships with the code.

- **Inputs:** the exported templates JSON; a folder of datasheet PDFs; a BOM
  CSV or a list of SKUs; optionally an exported catalog CSV for manufacturer
  and model facts.
- **Per part:** extract the cut sheet's text with a Node script over the
  `pdfjs-dist` already in `node_modules`, pick the template by category,
  draft the outline body following its headings, rules and example, and
  write one row of the catalog import CSV with `spec_state: draft` and
  `spec_source: skill:<date>`.
- **Never invents a fact.** A heading the datasheet does not answer gets a
  bracketed `[VERIFY: …]` line so review is targeted.
- **Also mines past specs:** given a section from a prior bid it proposes
  article General clauses, manufacturer lists and curtain templates as a
  draft `spec-library` JSON.
- It never touches the app or the database. The import hub loads, the draft
  state gates.

## 6. The North HS seed

Converted offline from the seven sections in the chosen families: 11 61 13,
11 61 14, 11 61 23, 26 09 61, 26 09 23, 27 30 00 and 27 41 00. The three
architect sections (stage floor, acoustical units, seating) are not seeded.

Deliverables under `docs/specs-seed/northhs-2026-07-30/`:

- `spec-library.json`: sections with Part 1 and Part 3 articles in their
  author's voice, category articles with manufacturer lists and General
  clauses, curtain templates from the drapes article, and the category
  templates derived from the product skeletons. AV and communications
  sections seed as `table` style with their narrative Part 1.
- `catalog-spec.csv`: one row per basis-of-design product, matched to
  catalog SKUs by manufacturer and model; products the catalog lacks are
  created with the verify-price `note` the spec builder's create-on-the-fly
  path already uses. Rows import as `authored` with
  `spec_source: seed:northhs-2026-07-30`, because the text came from a
  finished bid document a human already signed off on.
- `REVIEW-NOTES.md`: everything reconciled by hand (the duplicated P1/P2
  hoist block, the "sixty (30) days" counts, the lighting clause in the
  rigging section, the repeated Architectural Control Processor entry).

## 7. Error handling

- Finalize blocked while any row is no-match, no-spec, draft, or a curtain
  without a template, unless waived with a reason; waived rows print in
  "Items Not Specified" as today.
- Unknown placeholder: printed literally, warning in the preview.
- Outline deeper than five levels: clamped, warning in the preview.
- `specSameAs` chain or cycle: the pointing part reports "no spec" naming
  the target.
- Docx build failure in any section fails the whole package and names the
  section; no partial zip.
- Malformed upload rows surface in the parse preview as today.

## 8. Migration

One drizzle migration creating `spec_articles`, `spec_templates`,
`spec_curtain_templates` with `CREATE TABLE IF NOT EXISTS`, their indexes
guarded likewise, and the `_seq_bump` triggers created with a guard, per
D141 and the 2026-07 production failure on 0020. Field additions on
`catalog_parts`, `spec_sections` and `generated_specs` are JSONB and need
no migration. Existing generated records and sections stay readable.

## 9. Testing

In `scripts/test-review-and-spec.ts` (the `test:specs` harness):

- Outline parser and labeler: depth from indentation, label stripping,
  clamp at five levels, product-entry versus article label offset.
- Article grouping: explicit article, category default, empty sections
  dropped, article order and `specSort`.
- `specSameAs`: one-hop resolution, chain and cycle reported.
- Curtain resolution: type → template, slot filling including default color
  and fullness clause, grouping by type + fabric + color + fullness, missing
  template → no-spec.
- Placeholder substitution, including the unknown-placeholder path.
- Table-style rendering: one table per section, row order.
- Package file naming and character sanitizing.
- Quote-mint carries the curtain configuration onto `CURTAIN` lines.
- Docx smoke per section: opens, header and footer text present, literal
  numbering present.
- Legacy shapes: a string `part1` reads as one article; a D94 record opens.

`scripts/smoke-routes.ts` gains the module's GET pages. The generate and
save actions are exercised on a scratch datadir per the POST-route recipe,
never against `.data/pglite`. All of it behind the four gates (tsc,
test:specs, test:smoke, eslint against a stash baseline).

## 10. Phasing

Each phase gets its own implementation plan, lands behind the gates, and
ships on its own.

- **Phase A, library:** collections + migration, part fields, templates,
  curtain templates, `GridCurtain.color`, the section/article/template
  editors, the part Spec panel, the coverage table, import and export, nav.
- **Phase B, generator:** the module routes, the four doors and the
  engagement redirect, row builders, the new resolutions, assembly, package
  output (docx per section, zip, print view), the Generated and package
  screens, quote-mint curtain carry-through.
- **Phase C, skill and seed:** the `spec-writer` skill and the North HS
  seed files, loaded through the hub and checked against the specimen.

## 11. Out of scope

- AI inside the app (D89 stands).
- An in-app PDF or docx spec parser.
- Regenerate-with-diff, addenda, revision tracking.
- Datasheet packages and drawing bundles: punch item 40's client package
  stays separate and can consume this module's output later.
- Per-option packages before the Grid options work merges.
- A WYSIWYG outline editor; plain text with the convention is the editor.

## 12. Decisions to log in DECISIONS.md at implementation

- Anchor moves from engagement to source; the engagement becomes a door.
- The outline convention and the `2.1` article numbering, replacing D94's
  `2.01`.
- Product language stays on the catalog part; `specSameAs` is the only
  sharing mechanism.
- Seed rows import as authored; skill rows import as draft and are gated
  until reviewed.
- Quantities default to "per drawings and schedules"; AV-style sections use
  the equipment table.
