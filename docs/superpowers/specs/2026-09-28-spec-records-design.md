# Spec Library records — load once, match any BOM row, edit in the builder

**Date:** 2026-09-28 · **Owner:** Jeff · **Source brief:** `~/Library/CloudStorage/Dropbox/Claude/Spec-Library-Handoff-2026-09-28/BRIEF.md`
(+ `spec-library-v1.json`, `Peak Spec Library v1.xlsx`). Builds on the Specs module (#205, D254–D261, D326–D332, D358).

> "We write a spec for a product once, it gets saved for the next time we use that product, and if we need to
> edit or add specs that is all done in the builder so the specs stay up to date." — Jeff

Goal: **BOM in → complete bid spec out.** Each spec is written once, lives in one place (`spec_records`), and is
edited from the builder or the Spec Library screen.

## 0. Where this lands (brief vs. main)

The brief was written against the D94 generator. Main moved on: the live builder is `/design/specs`
(`spec_documents`, one CSI section per Word file, Parts 1/3 from the library, D329–D332). This work extends **that**
builder. D94 (`bid-spec.ts`, `generated_specs`) is untouched except that its `BomRow` type gains optional fields.

Decisions taken with Jeff in brainstorming (2026-09-28):

| # | Question | Answer |
|---|---|---|
| 1 | Do saved specs pick up library edits? | **Live.** A saved spec always reads the latest record; each download records `specId@revision` used, and the builder flags "library changed since your last download". |
| 2 | Numbering | **Keep D330** real Word multi-level numbering (`2.1 → A. → 1. → a. → 1) → a)`), plus a sixth body level `(1)`. |
| 3 | New spec written in the builder | **`ready` immediately** (a human writing it is the review step, D259/D328). |
| 4 | Spec Library screen | **Main view of Design → Specs → Library** (`/design/specs/library`), anyone with `create` (D260). |
| 5 | Vendor-quoted items | **Vendor-only**; never auto-create catalog parts. Matching works either way. |

## 1. Data

### 1.1 `spec_records` (doc table, migration 0033)

Field names are the brief's, verbatim (`src/lib/specs/records.ts`, pure):

```ts
type SpecKind = "product_catalog" | "product_vendor" | "system" | "companion";
type SpecStatus = "draft" | "ready" | "archived";
type SpecRecord = {
  specId: string;            // doc id; stable, never reused (e.g. PS-260961-028)
  kind: SpecKind; status: SpecStatus;
  section: string;           // CSI number "26 09 61"
  article: string;           // heading text as in the workbook (round-trip only; the printed 2.x heading is the live article's title)
  title: string;
  basisOfDesign: string | null; manufacturer: string | null;
  mfrNumbers: string[];      // many part numbers → one spec; "#" = one digit 1–5
  matchKey: string | null;   // system specs
  includeWith: string[];     // companion specs: specIds that pull this one in
  specText: string;          // outline, 2 spaces per level, [brackets] = per-job values
  notes: string | null;      // internal, never rendered
  sourceArticleId: string | null; // the Part 2 category article this record prints under
  revision: number; updatedAt: number; updatedBy: string;
};
```

- **`sourceArticleId` is the placement.** A record prints as a lettered product entry under that article (e.g.
  `ar-nhs-260961-07` ENTERTAINMENT LUMINAIRES MOVING). A `ready` record must name a live article whose section's
  number matches `section` (via `csiKey`).
- `normalizeSpecRecord` trims, de-dups `mfrNumbers` / `includeWith` case-insensitively, coerces unknown kind →
  refusal (not a silent default), unknown status → `draft`.
- `validateSpecRecord(rec, ctx)` → problems: missing title/specText; `product_*` with no `mfrNumbers`;
  `system` with no `matchKey`; `companion` with empty `includeWith` or naming an unknown specId; missing/unknown
  section; missing/unknown/mismatched article.

### 1.2 `spec_record_revisions` (doc table, same migration)

Doc id `${specId}@${revision}`; holds `{ specId, revision, record: SpecRecord, savedAt, savedBy, why }` — a full
copy of each **prior** version. One write path, `saveSpecRecord(next, by, why)`:

- compares content fields only (everything except `revision/updatedAt/updatedBy`); identical → no-op
  (`"unchanged"`) — this is what makes a second import change nothing;
- otherwise copies the current doc into `spec_record_revisions`, writes `revision + 1`, stamps `updatedAt/By`;
- new record → `revision: 1`, no revision row.
- `restoreSpecRecordRevision(specId, rev, by)` = `saveSpecRecord(copy of that version, by, "Restored revision N")`
  (non-destructive; history never shrinks).

### 1.3 Sections

The v1 records use 11 61 13, 11 61 14, 11 61 23, 26 09 61. The North HS seed (D326, D358) already created them
(`ss-nhs-*`), locally and on production. The importer creates any of those four that is missing, idempotent on
number (titles: Acoustic Shell Enclosure / Orchestra Pit Filler / Theatrical Rigging and Curtains / Theatrical
Lighting Controls and Fixtures). `STARTER_SECTIONS` are left alone. A missing **article** is a blocking problem —
never invented.

### 1.4 Legacy text

`CatalogPart.specBody` stays (back-compat, D257). It is matching step 4 — used only when no record matches.
Production's D358 build seed has probably written text for ~20 of the same `PS-…` specs onto ETC parts
(`specSource: "product-specs:PS-…"`); records match first, so no migration is needed. The D358 build step is not
changed and does **not** import records.

## 2. Import

One pure planner `planSpecRecordImport(input, ctx)` (`src/lib/specs/record-import.ts`) used by both:

- `scripts/import-spec-library.ts --file <json|xlsx> [--dry-run] [--commit]` (default dry run; PGlite
  single-process rules apply — stop dev first, snapshot `.data`), and
- the Spec Library screen's **Import .xlsx** (preview → confirm; the server re-plans from the file, never trusts a
  client plan — D328's pattern).

Readers: the JSON (`{ records: [...] }`) and the `Spec Library` sheet of the workbook, exact headers:
`Spec ID · Spec Kind · Spec Type (match key) · Section · Article · Spec Title · Basis of Design · Manufacturer ·
MFR # · Status · Your action · Spec Text · Notes · Article ID (source) · Include with (companion)`.
Kind labels: `Product – catalog` ↔ `product_catalog`, `Product – vendor quote` ↔ `product_vendor`,
`System (custom, no part #)` ↔ `system`, `Companion` ↔ `companion` (a label is matched on its leading word so
minor wording drift still maps; an unknown label is a row problem). Status `Ready/Draft/Archived`. MFR # and
Include with split on newline/comma/semicolon. `Your action` is ignored on import and exported blank.

Plan output: `created / updated / unchanged / archived` counts + problems (validation, **duplicate part number
across two ready records**, missing section/article, duplicate Spec ID within the file). Any blocking problem →
commit refused. Upsert keyed on `specId`, every write through `saveSpecRecord` with why `"Import <file>"`.
Records absent from the file are left alone (never deleted or archived by omission).

**Export .xlsx** writes a workbook with one `Spec Library` sheet in exactly that column layout (Spec Text with
real newlines, wrap on), so Jeff can review in Excel and round-trip; export → import of an unchanged file = 0
changes.

**Local first.** Production import happens only on Jeff's go-ahead after a fresh backup (`npm run db:export`) —
through the screen's Import .xlsx, not the build.

## 3. Matching

### 3.1 Rows carry what the quote knew

`BomRow` (bid-spec.ts) and `SpecDocProduct` gain optional `mfrNumber`, `manufacturer`, `specKey`, `desc`
(D94 ignores them). `bomFromQuote`:

- estimator items: `mfrNumber = manufacturerPartNumber`, `manufacturer`, `specKey`; curtain lines without a
  `specKey` get one derived from their description (§6); **allowance/custom lines with no SKU are kept** (they used
  to vanish in `bomProducts`), labor/option still skipped;
- a vendor-quote roll-up item (`vendorQuoteId`) is replaced by that vendor quote's material lines from
  `quote.vendorQuotes` (`manufacturerPartNumber` → `mfrNumber`, description, qty) — that is where Sensor IQ /
  PowerSafe / Paradigm part numbers actually live;
- Grid `spec.lines` carry `specKey` for curtains (§6).

**Row identity** (`specRowKey`, used for merging and for row actions): a real SKU → `SKU:<upper>`; a placeholder
SKU (`""`, `CUSTOM`, `AI`, `CURTAIN`, `CRT-…`) → `MPN:<normalized mfrNumber>`, else
`KEY:<specKey>|<desc>`, else `DESC:<desc>`; a record added straight from the library → `SPEC:<specId>`.
`bomProducts` merges rows by this key (qty summed) instead of by SKU.

### 3.2 Order (`src/lib/specs/record-match.ts`, pure)

Only `ready` records participate; `archived` never; a draft-only hit is reported, not printed.

0. **Pinned** — a row's `specId` (set by Link-to-existing on a row with no part number and no key, or by
   Add-from-library).
1. **Exact part number** — normalized (uppercase, trim, collapse whitespace) candidates: row `mfrNumber`, SKU, SKU
   after its `Mfr:` prefix, and the catalog part's `manufacturerPartNumber` / `manufacturerModelNumber` when one
   exists — against every record's `mfrNumbers`.
2. **Wildcard** — only if 1 found nothing; `#` in a stored number matches exactly one digit `1–5`.
3. **Match key** — row `specKey` vs. `system` records' `matchKey` (case-insensitive; `–`, `—`, `-` equal;
   whitespace collapsed).
4. **Legacy** — the catalog part's own printable `specBody` (today's `textPart`, one-hop same-as).
5. **No match** — candidates by D94's word-overlap score (row desc + part numbers vs. record title/basis of
   design/manufacturer/part numbers), top 4; never auto-assigned.

Outcomes: `matched { specId, via }` | `legacy` | `ambiguous { specIds }` (2+ records at the winning step — user
picks, nothing prints) | `draft { specId }` ("has a draft spec — approve to use") | `waived { reason }` |
`no-match { candidates }`.

### 3.3 After matching

- **One entry per record** — rows landing on the same record print once; quantity (when printed) is the sum.
- **Companions** — every `ready` companion whose `includeWith` names a matched record is added once per document,
  after the entries of its article.
- **Other sections** — a record whose section ≠ the spec's section lands in the existing "belongs to another
  section" list, now with **Start a <section> spec from this quote** (links `/design/specs/new?section=…&quote=…`).
- A guard test fails if the v1 fixture ever has two ready records sharing a part number.

## 4. Rendering

- A matched record = one lettered product entry under its article: heading `title` (+ `(Quantity: N)` when
  Print quantities is on), body `specText` in the `entry` context. `basisOfDesign` is **not** auto-printed (the
  text already opens with its Basis of Design line). Legacy matches print exactly as today.
- **Sixth level:** `OUTLINE_LABELS` gains `(1)`; `spec-docx.ts` gains level 7 `(%8)` with the hanging indent stepped
  like the others. The hoists (PS-116123-008/009) no longer clamp.
- **Brackets = job values.** In record text, any `[…]` that is not `[FILL IN: …]` is a per-job value whose default
  is the bracket content. Keyed `${specId}#${n}` in the spec's existing `fillIns` / `fillInLabels` maps (labels =
  normalized default, D332 staleness rules). Answered → the value prints in place of the bracket; unanswered →
  prints as written, brackets included. Never written back to the library. Checklist "Job values" group lists them
  with defaults, counted separately from `[FILL IN]` blanks, never blocking. Preview highlights brackets (amber
  unanswered, subtle answered). A `[FILL IN: …]` inside record text stays a blank (counts in `fillInsLeft`).
- **ITEMS NOT SPECIFIED** — explicitly **waived** rows print as a final Part 2 article `2.n ITEMS NOT SPECIFIED`,
  one lettered line each: `<desc> — <reason>`. Other left-out rows never print.
- Project-only overrides (§5.2) replace the record's title/text for that spec before brackets are scanned.
- Determinism: same library + same spec → identical preview and identical `document.xml`.

## 5. Builder

### 5.1 The match report (Products card)

Each row shows its outcome. Unresolved rows (no-match / ambiguous / draft / legacy-less) offer:

- **Link to existing spec** — a search over records (title, specId, part numbers, manufacturer, key). Picking one:
  a row with a part number → adds that number to the record's `mfrNumbers` (`saveSpecRecord`, why
  `"Linked from SP-####"`), so it matches everywhere next time; a system record with a row that has no part number
  → sets the row's `specKey` to the record's `matchKey`; otherwise pins `specId` on the row. Ambiguous rows pick
  among their candidates the same way (pin).
- **Write new spec** — editor prefilled from the row (part number, description → title, manufacturer, the spec's
  section, an article picker of that section's articles). Kind inferred: catalog part exists → `product_catalog`;
  part number without one → `product_vendor`; neither → `system` (match key required, defaulting to the row's
  `specKey` or description; set on the row). Saves a new `ready` record with the next free id
  `PS-<section digits>-<NNN>`. Replaces the builder's old "Write spec" (which wrote `specBody` onto the catalog part);
  the catalog Spec panel keeps its legacy editor.
- **Waive** — reason required; stored on the row; prints under ITEMS NOT SPECIFIED; **Un-waive** restores.

A draft match adds **Approve** (sets the record `ready` via `saveSpecRecord`) next to Link/Write.

### 5.2 Editing a matched row

**Edit** opens inline (never `window.confirm`/`prompt`, D96): title + text, and a two-way choice, default
**This project only**:

- **This project only** → `doc.overrides[specId] = { title, specText, baseRevision }`. The library is unchanged.
  If the record later moves past `baseRevision`, the row shows "library updated since you changed this for the
  project" with **Use library text** (drops the override).
- **Update the library** → `saveSpecRecord` (revision + 1, why required, prior version in history). Shows "used on
  N saved specs" (spec documents whose last download used this record) — information only.

### 5.3 Add from library, download stamp

- **Add from Spec Library** (beside the catalog picker) adds a `SPEC:<id>` row — for scratch specs and system
  scope the BOM doesn't carry.
- Each Word download stamps `doc.usedRecords = { [specId]: revision }` + `downloadedAt`. A record whose current
  revision differs from the stamp shows **"library changed since your last download"**.

All builder writes: `requirePerm("create")`, input caps like the existing actions, `revalidatePath` +
`router.refresh()`.

## 6. `specKey` at the source

- `SpecItem.specKey?: string` (estimator). A **Spec** select (system records' match keys, loaded server-side and
  passed as strings) on custom and curtain lines in the estimator's line editing, and in the custom-part form.
- `curtainSpecKey(type, name)` (pure, `src/lib/specs/record-keys.ts`): name keywords first (valance → Valance;
  main/grand → Main Curtain; border → Borders; leg → Legs; traveler/draw/mid/rear → Mid and Rear Draws;
  scrim → Scrim; cyc → Cyclorama), else type (`Border → Borders`, `Leg → Legs`, `Draw → Mid and Rear Draws`,
  `Full → Main Curtain`). Result `Stage Drapes – <X>`.
- Grid: `GridCurtain.specKey?` optional override; `spec.lines` curtain entries carry
  `specKey: curtain.specKey || curtainSpecKey(type, name)`; estimator curtain lines (no structured type) derive from
  their description when no `specKey` is set.

## 7. Spec Library screen (`/design/specs/library`)

- **Records** view is the default: table (Spec ID, title, kind, section, status, manufacturer, part numbers,
  revision, updated), search box and filters kind / section / status / manufacturer (URL params, server-rendered).
  The existing sections/articles/templates content moves to a **Sections & articles** view one click away
  (`?view=sections`), unchanged.
- `/design/specs/library/records/[specId]` — edit every field (kind-aware), status (archive = status), why-note on
  save, **revision history** (each prior version readable, **Restore this version**). `/records/new` creates.
- **Import .xlsx / Export .xlsx** per §2.
- Reads `requireUser()`; writes `requirePerm("create")`.

## 8. Tests (`npm run test:specs`)

Brief §10 table, pure, against `docs/specs-seed/spec-library-v1/spec-library-v1.json` (a checked-in copy):

| Row | Expect |
|---|---|
| `LS-P-CAM` | PS-260961-028 |
| `LS-UB-MI` | PS-260961-022 |
| `CSPARVZMV-1` | PS-260961-021 only (017 archived; 116113-004 has no part numbers) |
| `UH10005-41F` | PS-260961-007 (wildcard) |
| `UH10005-61F` | no-match |
| `DIN14-P-ACP/SPS` | PS-260961-006 |
| `P-ACP-E Mk2` / `p-acp-e  mk2` | PS-260961-005 |
| vendor line `IQ24` (no catalog part) | PS-260961-001 |
| `ION XE 20 2K-US` | 012 + companion 011 |
| `ION XE 20 2K-US` + `ELEMENT 2 1K` | 012 + 013 + 011 once |
| estimate line key `Stage Drapes – Main Curtain` | PS-116123-002 |
| Grid curtain (main) | PS-116123-002 via `curtainSpecKey` |
| `XYZ-123` | no-match with candidates, not assigned |
| import twice | 46 records, second run 0 changes |
| edit "this project only" | record revision unchanged |
| edit "update the library" | revision +1, prior version in history, other specs' overrides untouched |

Plus: no-duplicate-part-number guard; normalize/validate; xlsx read ↔ write round-trip; `specRowKey`; vendor-quote
expansion; brackets answered/unanswered/stale; sixth level in preview and docx; snapshots (assembled lines +
`document.xml`, golden + second-run identical) for PS-260961-028, PS-260961-007, PS-116123-008.

## 9. Out of scope

AI drafting (D89 — no AI at generation time); datasheet attachments / client package; Parking-lot specs; Part 1/3
boilerplate content; per-project section-number overrides; writing `specKey` back onto a quote line from the
builder (set it at the source, §6); a production import (Jeff-gated).
