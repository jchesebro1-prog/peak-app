# Product spec import — plan (#205, 2026-09-26)

Jeff fills `docs/specs-seed/northhs-2026-07-30/product-specs-template.xlsx` (written by
`scripts/specs-seed-northhs.py`): one row per product a spec describes, with an **MFR #** column he fills with the
manufacturer part number(s) that spec applies to. This page loads that file back: it matches each MFR # to catalog
parts, previews the result, and on confirm writes the spec fields onto matched parts. **It never creates a part.**
Only parts a spec describes get spec text — the other ~37,000 are untouched.

## The input file

- `.xlsx` (the template) or `.csv`. Limit 900 KB (same as the library import).
- `.xlsx`: read **every** worksheet whose header row (row 1) has both a **Spec ID** and an **MFR #** column; skip the
  rest (the Instructions sheet). The template has two such sheets: `Product specs` and `AV equipment list`.
- `.csv`: one sheet, same header rules.
- Headers are matched case/space/punctuation-insensitively (`"MFR #"` = `"mfr#"` = `"MFR"`… — normalize to lowercase
  alphanumerics; accept `mfr`, `mfrnumber`, `mfrno`, `manufacturerpartnumber` for MFR #).
- Columns read (all optional except Spec ID and MFR #): `Spec ID`, `MFR #`, `Manufacturer`, `Spec Title`,
  `Spec Text`, `Description`, `Article ID`.
  - title = Spec Title, else Description. text = Spec Text, else Description. (The AV sheet has no Spec Text/Title:
    its Description is both — the 27 41 00 section prints Part 2 as an equipment table.)
  - Spec Text keeps its leading spaces (it is outline text: two spaces per level). Trim only trailing whitespace per
    line and blank lines at the ends.
- MFR # cell → tokens: split on commas, semicolons and newlines; trim; drop empties; de-duplicate case-insensitively,
  keeping order.

## Row outcomes (preview and import compute the same plan)

Per row:
- **blank** — MFR # empty → skipped silently (counted).
- **error** — Spec ID missing; Spec ID repeated in the file (the later row); no text and no title; Article ID blank
  or not a live `spec_articles` id ("Import the spec library first — article X is not in this library.").
- otherwise each token resolves to one of:
  - **matched** — exactly one part. `loose: true` when found only by the loose key (below).
  - **ambiguous** — more than one part after manufacturer narrowing; show up to 5 candidate SKUs.
  - **not found**.
  - **claimed** — the part was already matched by an earlier row in the file (first row wins; the later token is
    reported and skipped).
- A row is **ready** when at least one token matched. Its first matched part is the **holder** (gets the text); every
  other matched part is a **same-as** pointing at the holder.

### Matching (pure, `src/lib/specs/product-spec-import.ts`)

Index every catalog part under these keys:
- the SKU;
- the SKU's part after the first `:` (SKUs look like `ETC:7460A1011`);
- `manufacturerPartNumber`;
- `manufacturerModelNumber`.

Exact key = trimmed, uppercased, internal whitespace collapsed. Loose key = uppercase alphanumerics only. Look up a
token by exact key first; only if that finds nothing, by loose key (then flag `loose`). If more than one part comes
back and the row has a Manufacturer, keep only parts whose `mfr` or SKU prefix (before `:`) matches the manufacturer
loosely (either loose string contains the other). One left → matched; several → ambiguous; none left after
narrowing → ambiguous with the un-narrowed candidates. If exactly one part matched but the row's Manufacturer is
given and clearly different from the part's mfr/SKU prefix (neither loose string contains the other), still match but
attach a `mfrWarning` shown in the preview.

### What gets written (per part)

Source tag: `specSource = "product-specs:<Spec ID>"`; `PRODUCT_SPEC_SOURCE_PREFIX = "product-specs:"`.

- holder: `specArticleId`, `specSectionId` (the article's section — the D258 mirror D94's assemble groups by),
  `specTitle`, `specBody`, `specSameAs: undefined` (explicit — clears a stale pointer; see mergeUpsert's
  present-key rule), `specState: "authored"`, `specSource`, `specUpdatedAt`, `specUpdatedBy`.
- same-as: `specArticleId`, `specSectionId`, `specTitle`, `specSameAs: <holder SKU>`, `specState: "authored"`,
  `specSource`, `specUpdatedAt`, `specUpdatedBy`. **Omit** `specBody` (same rule as `writePartSpecFieldsAction`).
- Authored, not draft: filling the template is the review step (like saving in the Spec panel), and the text is
  from a signed-off bid document.

Per-part decision:
- **skip-existing** — the part already has printable spec text (`hasPrintableSpec`) or a `specSameAs`, its
  `specSource` does NOT start with `product-specs:`, and "Replace existing spec text" is off (default off). Reported,
  not written. A draft body (not printable) is replaced freely.
- **unchanged** — every field this import would write already equals the stored value → not written (counted).
- **write** — otherwise.

If a holder is skip-existing, the row's same-as parts still point at it only if the holder's stored text is
printable and it is not itself a same-as pointer; otherwise promote the next writable matched part to holder. Keep
this simple and tested; the rule is "a same-as never points at a part without its own text".

## Server side

- `src/lib/specs/product-spec-io.ts` (server-only; exceljs): `readSpecSheets(buf, filename)` → `{ name, rows:
  string[][] }[]` for xlsx (all sheets, cell text via the same logic as `src/lib/import/xlsx-to-csv.ts` — extract
  its `cellText` into an exported helper rather than duplicating it) or csv (reuse `parseCsv` from
  `src/app/(app)/import/parse.ts`). And `applyProductSpecPlan(plan, by)` → writes through `Catalog.mergeUpsert`
  (never `upsert`), sequentially, returns `{ written, errors }`.
- Actions in `src/app/(app)/design/specs/actions.ts`, both `requirePerm("create")`:
  - `previewProductSpecsAction(fd: FormData)` — `fd.get("file")`, `fd.get("replaceExisting") === "1"`; parses, loads
    `Catalog.list()` + `allArticles()` once, returns the plan (JSON-safe; trim candidate lists) and counts. No writes.
  - `importProductSpecsAction(fd)` — re-parses and re-plans **server-side** from the file (never trusts a client
    plan), applies, `revalidatePath("/catalog")` + `"/design/specs/library"`, returns counts.
  - Size check (900 KB) and extension check (.xlsx/.csv) in both; friendly errors, `console.error` on throw.

## Page

- `src/app/(app)/design/specs/library/product-specs/page.tsx` — server component, `requireUser()`; title
  "Import product specs"; back link to the Spec library; renders the client component.
- `…/product-specs/product-specs-client.tsx` (`"use client"`; imports **only** the two actions and pure types — no
  stores, no exceljs; see memory "client import of a store breaks only next build"):
  1. File picker (.xlsx,.csv) + checkbox "Replace spec text a part already has" (off) + **Preview**.
  2. Preview: summary chips — ready rows, parts to write, same-as links, unchanged, already have text (skipped),
     not found, ambiguous, claimed twice, blank rows, errors. Then a table grouped by status (problems first):
     Spec ID · Title · MFR # · result (matched SKU + desc; "loose match" / manufacturer warning badges; candidates
     for ambiguous; the reason for errors).
  3. **Import N parts** button (disabled when 0) → runs the import action with the same File + checkbox, shows the
     result ("Wrote spec text to N parts (M linked as same-as).") and `router.refresh()`.
  Match the library page's look (`pk-card`, `pk-btn`, `pk-btn-outline`, `pk-page-title`, TH/CELL styles, mono for
  SKUs). Never hardcode accent colors.
- Library page (`src/app/(app)/design/specs/library/page.tsx`): add an "Import product specs" `Link`
  (`pk-btn-outline`) in the header button row, before Import / Export.

## Tests and gates

- Append ONE block at the end of `scripts/test-review-and-spec.ts` (`// #205 product spec import` + `{ … }`) using
  its `ok(cond, msg)` helper, messages prefixed `#205 product specs:`. Pure tests over hand-built parts/articles:
  token splitting; header detection incl. two sheets and a skipped Instructions sheet; Description fallback;
  exact match by SKU / SKU tail / MPN / model; loose match flagged; manufacturer narrowing of an ambiguous token;
  mfrWarning; not found; claimed by an earlier row; holder + same-as roles and patches (holder has explicit
  `specSameAs: undefined`, same-as omits `specBody`); skip-existing vs replaceExisting; own-source
  (`product-specs:`) text is overwritten without the checkbox; draft body replaced; unchanged detection; holder
  promotion when the first match is skip-existing; missing article; duplicate Spec ID; blank MFR skipped. Plus
  source-text checks: both actions call `requirePerm("create")`; the import action re-plans from the file; the
  client component imports no store and no exceljs.
- Add `/design/specs/library/product-specs` to `scripts/smoke-routes.ts` next to the other Specs routes.
- Gates (report real numbers): `npx tsc --noEmit`, `npm run test:specs`, `npx eslint` on changed files (no new
  problems vs baseline), `npx next build`. Do NOT run `npm run dev` or open `.data/pglite`; `test:specs` uses its own
  temp datadir. Do not run `test:smoke` (the lead runs it).

## Out of scope

Creating parts; editing article/section records; the Displays API; Phase B generator changes; docs
(DECISIONS/PUNCHLIST/AGENTS — the lead writes them).
