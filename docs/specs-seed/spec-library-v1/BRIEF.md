# Claude Code Brief — Spec Library: load it, match it, edit it in the builder

**For:** Claude Code, in the Quartzite-6 repo (`~/Downloads/peak-app`) on the Mac mini
**From:** Jeff Chesebro, prepared with Claude (Cowork), 2026-09-28
**Files in this folder:**
- `Peak Spec Library v1.xlsx`: the content. 46 specs. Jeff reviews in this file. Sheets: How this works · Your list · Spec Library · Parking lot.
- `spec-library-v1.json`: the same 46 records, machine-readable. **Import from this.**
- `source-ordering-guides/*.png`: ETC ordering-guide pages the Paradigm, button-station and touchscreen part numbers came from.

---

## 1. The problem, in Jeff's words

> "In my dream world we write a spec for a product once and then it gets saved into the catalog for the next time we are using that product, and if we need to edit or add specs that is all done in the builder so the specs stay up to date and we are not trying to track down the most recent one."

The goal is **BOM in → complete bid spec out.** Each spec is written once, lives in one place, and gets edited from inside the builder.

Today the in-app spec library is **empty**. The D94 bid-spec generator (Module 24: `bid-spec.ts`, `spec-sections.ts`, `generated-specs.ts`, `bid-spec-docx.ts`, `design/engagements/spec/actions.ts`) works, but it cannot use Peak's real specs, for four reasons:

1. **One spec covers many part numbers.** Peak writes one spec per product family (Lonestar Prime = `LS-P, LS-P-CAM`; the Heritage button stations cover 22 models × 5 colors). D94 stores `specBody` on each catalog part, one per SKU. That forces copy-paste and drift, which is exactly what Jeff wants to avoid.
2. **Many specs have no catalog part.** Some items are vendor-quoted: they have part numbers and appear on the estimate/BOM but not in the catalog (Sensor IQ, PowerSafe, Paradigm). Others are custom/engineered with no part number at all (acoustic shell, pit filler, drapes, Prodigy hoists).
3. **Peak's spec text is a nested outline 3–4 levels deep** (two-space indents). The renderer only knows `1.01` → `A.`.
4. **There is no edit loop.** Nothing lets you link a BOM row to an existing spec, write a new spec from the match report, or choose between "change it for this job" and "change the master."

## 2. Guardrails (read first)

- **Production data question: STOP and ask Jeff before touching prod.** The 2026-09-20 review found prod at 3,959 catalog parts (all ETC), 2 companies and 4 quotes. The 2026-07-29 load recorded 14,722 parts and 1,723 companies. Do all of this work **locally first**. Import to prod only after Jeff OKs it and a fresh backup exists (the `backups/peak-backup-*.json` recipe).
- **No AI at generation time (D89).** Specs are stored, human-approved text. Same BOM → same document, every time.
- **Never use `window.prompt()` or `window.confirm()`.** They throw in this app. Use inline UI (D96).
- Client components may only `import type` from anything that reaches the doc-store.
- Snapshot `.data` to `.data-backup-<date>/` before any DB script. Stop dev servers before DB scripts (PGlite is single-process).
- Keep `npm run test:specs` green. Add tests for everything below.

## 3. Phase 0: recon, then report back before building

Read `bid-spec.ts`, `spec-sections.ts`, `generated-specs.ts`, `bid-spec-docx.ts`, `design/engagements/spec/actions.ts`, `parse-bom.ts`, the catalog-part type, the estimator `SpecItem` type, and the Grid → quote `spec.lines` seam. Then answer:

- a. Which field on an **estimator line** carries a vendor part number that isn't a catalog SKU? Does `bomFromQuoteAction` pass it through?
- b. What does a **custom / non-catalog estimator line** look like (acoustic shell, drapes, hoists)? Is there a category or type field we can tag?
- c. How many catalog parts in the local DB have a non-empty `specBody` today?
- d. Current `spec_sections` rows.

Post a short summary and the plan to Jeff before Phase 1.

## 4. Data model: a Spec Record that stands on its own

Add a collection **`spec_records`** (id = `specId`, e.g. `PS-260961-028`). The JSON file already has this shape:

```ts
type SpecKind = "product_catalog" | "product_vendor" | "system" | "companion";
type SpecStatus = "draft" | "ready" | "archived";

type SpecRecord = {
  specId: string;            // stable key, never reused
  kind: SpecKind;
  status: SpecStatus;        // only "ready" renders into a bid; "archived" never matches
  section: string;           // CSI number, e.g. "26 09 61"
  article: string;           // group heading, e.g. "ENTERTAINMENT LUMINAIRES MOVING"
  title: string;
  basisOfDesign: string | null;
  manufacturer: string | null;
  mfrNumbers: string[];      // many part numbers → one spec; "#" = one wildcard digit
  matchKey: string | null;   // system specs: "Stage Drapes – Main Curtain", "Rigging Hoist – Prodigy P1"
  includeWith: string[];     // companion specs: specIds that pull this one in
  specText: string;          // nested outline, 2 spaces per level, [brackets] = per-job values
  notes: string | null;      // internal, never rendered
  sourceArticleId: string | null;
  revision: number; updatedAt: number; updatedBy: string;
};
```

- Add **`spec_record_revisions`** (full copy of each prior version plus who/when/why). The library is always "the latest," and history is never lost.
- **Keep** `specBody` on catalog parts as legacy/back-compat. Don't delete it. If a part has `specBody` and no record matches it, treat it as a fallback match. Recommend migrating those into records later.
- `generated_specs` stays frozen-on-save (already correct). Also store the `specId@revision` used for each part, so you can tell what changed later.

### The four kinds and how each one matches

| Kind | Example | Matches a BOM row by |
|---|---|---|
| `product_catalog` | ColorSource CYC, Lonestar Prime | Part number (`mfrNumbers`) |
| `product_vendor` | Sensor IQ, PowerSafe, Paradigm | Part number from the estimate line. **No catalog part required.** |
| `system` | Acoustic shell, pit filler, drapes, hoists | `matchKey` tag on the estimate/Grid line |
| `companion` | Eos Family Software | Added automatically when any spec in `includeWith` is matched |

## 5. Matching rules (replace or extend `matchBom`)

For each BOM row, in this order:

1. **Exact part number.** Compare normalized strings (uppercase, trim, collapse spaces) against `mfrNumbers` of `ready` records.
2. **Wildcard part number.** `#` in a stored number matches exactly one digit, **1–5** (the Heritage color code). `UH10005-#1F` matches `UH10005-41F`. Only if step 1 found nothing.
3. **Match key.** If the row carries a `specKey` / `matchKey`, match it to a `system` record. **Add a `specKey` field** to estimator line items and Grid objects: a picker filled from the `system` records' match keys.
   - Grid curtains currently arrive as `sku: "CURTAIN"` and always land in no-match (13-the-grid.md §13.18). Map curtain types to the `Stage Drapes – …` keys.
4. **Legacy fallback.** Catalog part `specBody`, if present.
5. **Otherwise no-match.** Show the existing candidate list. Never auto-assign.

Then:
- **Companions:** for every matched record, add any `ready` companion whose `includeWith` contains it. Add each one once per document.
- **Ambiguity:** if one row matches 2+ ready records, put it in a new `ambiguous` bucket. The user picks; don't guess. The v1 data has no such conflicts; keep a test that fails if one appears.
- `archived` and `draft` records never render. Show a draft match as "has a draft spec, approve to use."

## 6. Sections

The v1 records use the Oshkosh North numbering: **11 61 13** (Acoustic Shell), **11 61 14** (Orchestra Pit Filler), **11 61 23** (Theatrical Rigging and Curtains), **26 09 61** (Theatrical Power, Production, Architectural Controls and Fixtures). `STARTER_SECTIONS` uses different numbers (11 61 33, 11 61 43, 26 55 61, …).

- Create these four as `spec_sections` (idempotent on `number`). Leave the existing starters alone.
- Group Part 2 by `section`, then by `article` heading, then by spec.
- Part 1/Part 3 boilerplate is empty today. Render it as blank, but show a **"section boilerplate not written yet"** warning in the match report. Don't invent text.
- *Later, not now:* a per-project section-number override.

## 7. Rendering (HTML and .docx)

- **Nested outline.** Each 2-space indent level in `specText` is one numbering level. Keep literal numbering, no Word list numbering, same as today. Scheme: `2.0x` article → `A.` → `1.` → `a.` → `(1)`. Match the hanging indents to the depth.
- **`[brackets]`** render as-is and are highlighted in the in-app preview. On a generated spec the user can type a per-project value for a bracket. It is stored on the generated spec only and **never written back to the library**.
- Keep the `ITEMS NOT SPECIFIED` section (waived rows).
- Add snapshot tests for PS-260961-028 (Lonestar Prime, deep outline), PS-260961-007 (button stations, brackets), and PS-116123-008 (hoist, long). HTML and docx must stay identical across runs.

## 8. Builder UX: every gap gets fixed where you find it

In the match report, each unresolved row offers:

- **Link to existing spec.** Search the library. Picking one adds this row's part number to that record's `mfrNumbers` (or sets the row's `specKey` for system specs). This saves a new revision, and next time it matches automatically.
- **Write new spec.** An editor prefilled from the row (part number, description, manufacturer). Saves a new `SpecRecord` (status `ready`, or `draft` if Jeff wants review). Next time it's there.
- **Waive** (existing, with reason).

On a matched row, **Edit** asks inline, no confirm():

- **"This project only"** is the default. The override is stored on the generated spec. The library doesn't change.
- **"Update the library"** saves a new revision of the record. Show "used on N generated specs" as information only; frozen specs don't change.

Add a **Spec Library screen** (Design → Spec Library, or Settings → Admin; ask Jeff):
- List, search and filter by kind/section/status/manufacturer.
- Edit a record and see its revision history.
- **Import .xlsx / Export .xlsx** in the exact column layout of `Peak Spec Library v1.xlsx` → `Spec Library` sheet, so Jeff can bulk-review in Excel and round-trip.

## 9. Import script

`scripts/import-spec-library.ts --file <json|xlsx> [--dry-run] [--commit]`

- Upsert keyed on `specId`. Running it twice = still 46 records and no new revisions if nothing changed.
- Dry run prints: created / updated / unchanged / archived counts, plus any duplicate-part-number or missing-section problems.
- Creates the four sections if missing.
- **Local first.** Prod only on Jeff's go-ahead, after a backup (see §2).

## 10. Acceptance tests (add to `test:specs`)

| BOM row | Expected |
|---|---|
| `LS-P-CAM` | PS-260961-028 (Lonestar Prime) |
| `LS-UB-MI` | PS-260961-022 (Lonestar) |
| `CSPARVZMV-1` | PS-260961-021 only. 017 is archived; 116113-004 has no part numbers. |
| `UH10005-41F` | PS-260961-007 (wildcard) |
| `UH10005-61F` | no-match (6 is not a Heritage color code; see wildcard note below) |
| `DIN14-P-ACP/SPS` | PS-260961-006 |
| `P-ACP-E Mk2` / `p-acp-e  mk2` | PS-260961-005 (normalization) |
| `IQ24` (vendor line, not in catalog) | PS-260961-001 |
| `ION XE 20 2K-US` | PS-260961-012 **plus companion** PS-260961-011 |
| `ION XE 20 2K-US` + `ELEMENT 2 1K` | 012 + 013 + 011 **once** |
| Estimate line tagged `Stage Drapes – Main Curtain` | PS-116123-002 |
| Grid curtain (main) | PS-116123-002 via curtain-type → key mapping |
| `XYZ-123` | no-match with candidates, never auto-assigned |
| Import run twice | 46 records, 0 changes second time |
| Edit "this project only" | library revision unchanged |
| Edit "update the library" | revision +1, old version in history, frozen generated specs unchanged |

(Wildcard note: `#` matches digits **1–5 only**, which is the Heritage color code. If a later product family needs a different set, add a per-record rule then.)

## 11. Out of scope for this pass

- AI drafting from datasheets (possible later as "Draft" status only, outside or behind a human approval).
- Datasheet attachments and the one-click client package (punch-list item, needs this first).
- Writing specs for the **Parking lot** sheet items.
- Part 1/Part 3 boilerplate content (Jeff and Claude will author it separately).

## 12. Build order

0. Recon + report (§3) →
1. `SpecRecord` + revisions + sections + import script (§4, §6, §9) →
2. Matching + companions + ambiguity (§5) and its tests →
3. Nested-outline renderer + brackets (§7) →
4. Builder actions: link / write new / project vs library edits (§8) →
5. Spec Library screen + xlsx import/export (§8) →
6. `specKey` picker on estimator lines + Grid curtain mapping (§5.3).

Work on a branch, keep the build and `test:specs` green at each step, and record decisions in `DECISIONS.md`. Don't push or deploy to prod without Jeff.

## 13. Open questions for Jeff (ask when you reach them)

1. Should new specs written in the builder save as `ready` immediately, or as `draft` until Jeff approves?
2. Where should the Spec Library screen live: under Design, or Settings → Admin?
3. When a vendor-quoted item (e.g. Sensor IQ) shows up on estimates a lot, should it also get a catalog part, or stay vendor-only?
