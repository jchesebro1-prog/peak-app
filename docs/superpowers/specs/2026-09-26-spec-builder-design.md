# Spec builder — design (#205 Phase B, 2026-09-26)

**Status:** approved by Jeff 2026-09-26 (brainstorm in session). Supersedes the Phase B section of
`2026-09-21-spec-from-bom-module-design.md` where the two differ.

## Why

The spec library (Parts 1/3, Part 2 category headers, product spec text on catalog parts) has no tool that
assembles a spec from it. The only generator is D94's, reachable only inside a consulting engagement, BOM-only,
flattening Parts 1/3 and ignoring category headers. Jeff wants: pick a section, Parts 1 and 3 come in
automatically, add products from a list of catalog parts that already have specs, download an editable Word file.

## Decisions (from the brainstorm)

| # | Question | Choice |
|---|----------|--------|
| 1 | What one Word file holds | **One CSI section per file**, like the North HS originals |
| 2 | Where a spec starts | **Standalone "New spec"** under Design → Specs, plus **Spec from this quote** and **Spec from this Grid design** |
| 3 | Product picker | Parts with an approved spec **in this section**, grouped by category header, plus a **Show all catalog parts** switch; writing spec text for a part there saves it **to the part** |
| 4 | Incomplete specs | **Warn, never block** (except a deleted section). Products without a spec are left out of the Word file and listed in the builder's checklist |
| 5 | Job-specific Part 1/3 edits | **A fill-in form**: one labelled field per `[FILL IN: …]`; answers saved with the spec; all other rewording happens in Word |
| 6 | Word numbering | **Real Word multi-level list numbering** (renumbers when edited in Word) |
| — | Quantities | Only from a BOM source, behind a **Print quantities** switch, **off by default**. From scratch there are no quantities |
| — | Build approach | A new builder in the Specs module that **replaces** the D94 generator's entry points |

## 1. Screens and flow

- **`/design/specs`** — the saved-spec list (replaces the Phase A redirect to the library): SP number, section,
  project, customer, source, last edited, **Download Word**; **+ New spec**; links to Library and Templates.
- **`/design/specs/new`** — pick a section (library sections), optional customer (the existing searchable
  customer picker), optional project name/number. Creates the spec and opens the builder. Accepts source params:
  `?quote=<id>` (Spec from this quote), `?grid=<projectId>&quote=<id>` (Spec from this Grid design),
  `?engagement=<id>` (the old engagement door: uses its install quote, else its quote, else no source).
- **`/design/specs/[id]`** — the builder, top to bottom:
  1. **Header**: project name, project number, phase (default "Construction Documents"), issue date (default
     today), prepared by (default the signed-in user).
  2. **Fill-ins**: one field per `[FILL IN: …]` blank in the section's Part 1/3, labelled with its article.
  3. **Products**, grouped under the section's category headers. **+ Add product** opens the picker (search;
     approved-spec parts in this section; **Show all catalog parts** switch). Picking a part with no spec opens a
     box to write its spec title + text, saved to the part as authored (the Spec panel's rule). Reorder within a
     header; remove. A BOM source shows each product's quantity and the **Print quantities** switch.
  4. **Checklist**: fill-ins left, products left out (and why). Never blocks.
  5. **Preview** (read-only, numbered as it prints) and **Download Word**.
  Everything saves as it changes (server actions); reopen any time.
- **Entry points**: quotes hub detail panel "Spec from this quote →" (system quotes only);
  Grid editor "Spec from this design →" (when the active option has a quote; no engagement required);
  consulting engagement "Bid spec" link → `/design/specs/new?engagement=<id>`. Old saved D94 specs stay
  viewable at `/design/engagements/spec/[id]`.
- A BOM source asks for the section first; only BOM parts that resolve to this section's category headers are
  added; the rest are listed as "belongs to another section" in the checklist.

## 2. Data — `spec_documents`

New doc-store collection (doc table + idempotent migration + `_seq_bump` trigger, per D141 / 0025's pattern),
ids `SP-####` from base 1000 via `insertWithPrefixedId`. Not syncable.

```
SpecDocument {
  id: "SP-1001",
  sectionId: string,
  header: { projectName, projectNumber, phase, issueDate /* YYYY-MM-DD */, preparedBy },
  customerId?: string, customer?: string,          // display name snapshot
  source: { kind: "scratch" | "quote" | "grid", id?: string, label?: string, quoteId?: string },
  products: Array<{ sku: string, qty?: number, articleId?: string /* per-spec header override */ }>,
  printQuantities: boolean,                         // default false; only meaningful when source ≠ scratch
  fillIns: Record<string, string>,                  // key = `${articleId}#${n}` (n-th blank in that article body)
  createdAt, createdBy, updatedAt, updatedBy
}
```

- **Parts 1 and 3 are read live** from the library at preview and download time; the downloaded Word file is the
  snapshot. No per-spec copy.
- **Fill-in keys** are positional (`article id` + blank index). A saved answer whose key no longer exists shows as
  "no longer used" in the builder; it is never applied elsewhere.
- **Placement**: a product goes under its part's resolved article (`articleIdForPart`) when that article belongs to
  this section; otherwise the product entry's `articleId` override (chosen when adding) — stored on the spec only,
  never on the part. A product with neither is "needs a header" (left out, listed).
- One SKU at most once per spec.

## 3. Assembly (pure — `src/lib/specs/assemble-section.ts`)

`assembleSection({ section, articles, parts, doc })` → one structured outline that both the preview and the Word
writer render:

- **PART 1 – GENERAL / PART 3 – EXECUTION**: each article → `n.m TITLE` + its body through `renderBody`
  (`src/lib/specs/outline.ts`) after: fill-ins replaced by answers (unanswered `[FILL IN: …]` prints as written);
  placeholders substituted — `{{articles}}` = titles of Part 2 articles that received at least one product,
  `{{project.*}}` from the header, `{{section.*}}` from the section.
- **PART 2 – PRODUCTS** (`paragraphs` style): articles with ≥1 product, library `sort` order, numbered 2.1, 2.2…;
  each opens with its `general` body (`{{manufacturers}}` expanded) — by the D326 convention that body is the
  article's "A. General" clause(s) — then its products as the next letters, in spec order: heading =
  `specTitle` (else the part description), body = `specBody` rendered in "entry" context. A `specSameAs` part uses
  its target's title/body (one hop, `resolveSameAs`). With **Print quantities** on, the heading gets
  "(Quantity: N)".
- **PART 2 (`table` style, e.g. 27 41 00)**: used articles' General clauses, then one equipment table —
  Mfr · Model · Description (+ Qty when Print quantities is on). Model = the part's manufacturer model number,
  else MPN, else the SKU after `Mfr:`; Description = `specTitle`, else the part description.
- **Left out** (never printed, listed in the checklist): no printable spec (`hasPrintableSpec` / same-as rules);
  needs a header; part no longer in the catalog; BOM part belonging to another section.
- `END OF SECTION <number>`.
- Checklist = `{ fillInsLeft, fillIns: [{key,label,answered}], staleAnswers: [key], leftOut: [{sku, reason}] }`.

## 4. The Word file (`src/lib/specs/spec-docx.ts`, server-only, `docx` package)

- Letter, Times New Roman, like the originals.
- Title `SECTION 11 61 23 – THEATRICAL RIGGING AND CURTAINS`.
- Running header: issue date (long form, e.g. "July 30, 2026") · project name · "Project No. <n>" · phase.
  Footer: section title (caps) · `<number> - <PAGE field>`.
- **One Word multi-level numbering definition** driving every outline line: PART (level 0, "PART %1 –"),
  article (level 1, "%1.%2"), then A. / 1. / a. / 1) / a) (levels 2–6), hanging indents, restarting per Part;
  PART and article paragraphs use heading styles so the navigation pane works. No typed-in numbers.
- AV table: a real Word table with a header row.
- File name: `<projectNumber>_<projectName>_Spec <number>_<title>_<MM-DD-YYYY>.docx`; blank header parts are
  dropped, characters illegal in file names removed.
- Served by `GET /api/spec-documents/[id]/docx` (requireUser); 404 for an unknown spec; 409 with a message when
  the section is gone.

## 5. Permissions, errors

- View + download: `requireUser()`. Create/edit specs and write part spec text: `requirePerm("create")`.
- Section deleted → builder shows "This section is no longer in the library", download disabled. Part deleted →
  checklist "part no longer in catalog". Stale fill-in answer → "no longer used". None of these block saving.

## 6. Testing

- Spec harness (pure): fill-in slot extraction + keys, answer substitution, `{{articles}}` from used articles,
  `{{manufacturers}}`, header placeholders, placement (own article, override, needs-a-header, other section),
  same-as, left-out reasons, table style + model fallbacks, quantity switch, numbering order, file name.
- Word checks: the generated document.xml / numbering.xml carry a real multi-level list (numPr on outline
  paragraphs, no typed labels), header/footer text, PAGE field, a table for 27 41 00.
- Real-Word check: build North HS 11 61 23 and 27 41 00 against the seed library, open in Word, insert a
  paragraph to confirm renumbering, send both files to Jeff.
- Gates: tsc, test:specs, eslint vs baseline, next build, test:smoke (new routes added).

## Not in this build

Zip of several sections; Grid curtains (printed via curtain templates later — left out and listed for now); the
`spec-writer` skill; Displays API changes; editing Parts 1/3 text per spec (Word does that).
