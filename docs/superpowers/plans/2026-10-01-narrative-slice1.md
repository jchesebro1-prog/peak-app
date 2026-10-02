# Narrative-first client preview — Slice 1 Implementation Plan (#293)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 1 of #293. That covers key products on a system, write-once product paragraphs on catalog parts, a
library of system intros, Draft narrative, printing a photo beside each paragraph, and the Itemized appendix toggle.

**Architecture:**
- **Data.** Every new field is additive JSONB: `SpecSection.keyProducts`, `CatalogPart.narrativeText*`, the
  `narrative_intros` settings blob and `pdfOptions.pdfItemizedAppendix`. There is no migration.
- **Logic.** All rules live in pure modules the harness imports: `estimator/narrative.ts`, `lib/narrative/intros.ts` and
  `estimator/quote-document-view.ts`. Thin server layers sit on top: catalog store, intros store, `lib/narrative/library.ts`,
  `lib/narrative/photos.ts` and `estimator/narrative-actions.ts`.
- **UI.** The work is split into small client components: `narrative-column.tsx`, `use-key-product-library.ts`,
  `narrative-intros-modal.tsx` and `catalog/narrative-paragraph-panel.tsx`.
- **Printing.** `QuoteDocument` stays the one document. Its itemized markup is extracted into an internal `ItemizedLines`
  that the body and the appendix share. The print route inlines photos as data URIs.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19 server + client components, Drizzle/PGlite doc-store, tsx
harness (`scripts/test-review-and-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`. This plan covers Slice 1 only: §1.1–1.4,
§2.1–2.3, §3, §8.1, the Slice 1 parts of §9, and §10.

## Global Constraints

**Workspace and environment**
- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/narrative`, on branch `feat/293-narrative-client-preview`.
  Run `export PATH=$HOME/.local/node/bin:$PATH` before any `npx`/`npm`.
- **Never `git stash`.** The stash is shared across worktrees and other sessions. To set work aside, commit it instead.
- **Never open `/Users/sm/Downloads/peak-app/.data/pglite`** (the main checkout's dev DB). `npm run test:specs` uses its
  own `mktemp -d` datadir. Before you run it, check that no stray `tsx` is holding a DB: `ps aux | grep tsx`.
- **Disk.** Check `df -h /System/Volumes/Data` before test:specs or build. If it's above ~90 %, clean old temp datadirs
  with the guarded command `find $TMPDIR -maxdepth 1 \( -name 'tmp.*' -o -name 'peak-build-db-*' -o -name 'peak-smoke-*' \) -type d -mmin +60 -exec rm -rf {} +`.
  Always keep the `-mmin` guard.

**Code rules**
- **Client components** (`"use client"`) must never value-import from `@/lib/stores/*`, `@/db/*` or another
  server-only module. Doing so breaks only `next build`. Type-only imports are fine, and so is importing a `"use server"`
  actions file.
- **No AI and no external service** anywhere (D89). Text is only ever typed or copied.
- **Limits** (spec §1.1): `MAX_KEY_PRODUCTS = 20` per system, `MAX_PARAGRAPH = 4000`, `MAX_INTRO = 8000`, intro title
  ≤ 120 chars, ≤ 200 intros, `keyProductLibraryAction` ≤ 200 skus.
- **Eligible line:** a non-empty `sku`, and none of `labor`, `laborOverhead`, `laborTravel`, `rewardCredit`, `option`.
- **Photos:** only `image/png`, `image/jpeg` and `image/webp`. Each photo ≤ 3 MB, ≤ 15 MB per document, at most 6
  concurrent reads. A photo failure never fails the render.
- **`pdfItemizedAppendix` defaults to `false`.** An absent key reads `false`.
- **Confirms are inline two-step strips, never `window.confirm()`.** It returns false with no dialog in the Capacitor
  shells (see the comment above `wonMetaGuard` in `estimator-client.tsx`).

**Copy (verbatim)**
- Star title: "Key product — featured in the narrative".
- Chips: "Needs a paragraph" / "From library" / "Edited" / "Not in catalog".
- Unresolved strips: "Line removed — this block won't print", "Line changed to <sku> — this block won't print",
  "Optional/labor line — won't print".
- Save confirms: "Replace the library paragraph for <sku>?" and "The library paragraph changed since you loaded it —
  replace it anyway?".
- Disabled-button title: "Needs the Create permission".
- Draft: "Switched to Narrative", "N products still need a paragraph".
- No photo: "No photo — prints full width".
- Appendix heading: "Appendix — Itemized bill of materials".
- Toggle: "Itemized appendix", titled "Print every narrative system's full line list after the signature".

**Existing harness pins — do not break them**

The harness pins exact source strings in files this plan edits. Keep these substrings exactly:
- `actions.ts`:
  - `payload.sections.map(sanitizeSystemSell)`
  - `{ ...sanitizeSystemSell(section), id: "sys" + Date.now() }`
  - `copySectionForTarget(sanitizeSystemSell(section),`
  - `newName: section.name + " (copy)"`
- `quote-document.tsx`:
  - the exact line `import { customerLines, fmt, inclusionsLine, lineExtSellOf, systemFreight, systemItemsRev, type QuoteTotals } from "./pricing";`
  - `const sub = systemSellTotal(sec);`
  - `rows.reduce((a, cl) => a + cl.ext, 0)`
  - `ext: p.isPortalCatalog && it.por ? "Price on request" : fmt(cl.ext)`
  - `const anyPorPrinted = !!p.isPortalCatalog && p.sections.some`
  - `const inclusions = inclusionsLine(p.t);`
  - no `"use client"`, no hooks, no `onClick=`, no `.components`
- `preview-doc.tsx`: `p.togglePdf("pdfPrices")`, `p.setDetail("sectioned")`, `Save & update PDF`, `<QuotePdfViewer`,
  `?download=1`.
- The print route: `verifyPrintToken(` before `getQuote(`.

**If an old check fails, change your new code, never the old check.** If an old check pins something this spec
deliberately changes, stop and report it.

**Harness**
- Each task appends its checks at the end of `scripts/test-review-and-spec.ts` under a
  `/* ===… #293 slice 1 — <part> …=== */` banner.
- Imports use `n293…`/`N293…` aliases. They can sit right above their block, the way the #290 block does.
- Async DB checks are `async function …293AsyncChecks()` declarations. Each one is chained with
  `.then(() => …293AsyncChecks())` right after the line `.then(() => packages289AsyncChecks())`, before
  `.finally(() => teardownFixtures())`.
- Fixtures use `fixtureId(293, "<slug>")` (the plain `fixtureId`/`registerFixture` names are in scope) and
  `registerFixture(coll, id)`.

**Gates per task**
- `npx tsc --noEmit`: baseline 0 errors.
- `npm run test:specs`: baseline **10,378 PASS / 0 FAIL**. It must stay 0 FAIL, with PASS = previous + new.
- `npx eslint <changed non-harness files>`. Never lint `scripts/test-review-and-spec.ts`, because whole-file eslint
  crashes on it (a pre-existing problem). Expect 0 errors.
- The final task adds `npm run test:smoke` and `next build`.

**Dates.** Timestamps are epoch-ms numbers.

**Deliberately not in Slice 1:**
- `QuoteDocument`'s `layout?: "sheet" | "web"` prop (spec §3.5). It's only used by Slice 3 (YAGNI).
- `bomViewProps`, `docFields`, `shareLink` and the online pages (Slices 2 and 3).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/app/(app)/estimator/types.ts` | modify | `KeyProduct` type, `SpecSection.keyProducts`, two `EstimatorProps` fields |
| `src/app/(app)/estimator/narrative.ts` | modify | All pure key-product rules: limits, eligibility, resolve, sanitize, remap, star/edit helpers, chip, Draft narrative, printable blocks, photo skus, shared row/response types |
| `src/lib/quote-pdf/pdf-options.ts` | modify | `pdfItemizedAppendix` toggle key (default false) |
| `src/lib/narrative/intros.ts` | create | Pure intro rules: `SystemIntro`, `sanitizeIntro`, `sanitizeIntroList`, `applyIntroOp`, `newIntroId` |
| `src/lib/stores/narrative-intros.ts` | create | `narrative_intros` blob store: `listIntros`, `upsertIntro`, `deleteIntro` |
| `src/lib/stores/catalog.ts` | modify | `narrativeText*` fields, `saveProductParagraph` |
| `src/lib/narrative/library.ts` | create | Server: `keyProductLibrary(skus)` rows (paragraph + primary photo id) |
| `src/lib/narrative/photos.ts` | create | Server: `keyProductPhotoDocs`, `inlinePhotos`, `readBlobCapped`, `keyProductPhotoDataUris` |
| `src/app/(app)/estimator/narrative-actions.ts` | create | `"use server"`: library read, paragraph save, intro upsert/delete |
| `src/app/(app)/estimator/actions.ts` | modify | Sanitize `keyProducts` on save / move / copy |
| `src/app/(app)/estimator/quote-document-view.ts` | create | Pure `appendixSystemIds` |
| `src/app/(app)/estimator/quote-document.tsx` | modify | Key-product blocks + photos, `ItemizedLines`/`SectionBand` extraction, appendix, print CSS |
| `src/app/print/quote/[id]/page.tsx` | modify | Pass `keyProductPhotos` (data URIs) |
| `src/app/(app)/estimator/preview-doc.tsx` | modify | "Itemized appendix" toggle |
| `scripts/qd293-cases.ts` | create | Fixed QuoteDocument props + a `.jpg`-safe renderer for the harness |
| `scripts/qd293-baseline.ts` | create | One-off writer of the byte-for-byte baseline |
| `docs/superpowers/fixtures/293-quote-document-baseline.json` | create | Committed pre-change render (harness fixture) |
| `src/app/(app)/estimator/use-key-product-library.ts` | create | Client hook: per-sku library cache |
| `src/app/(app)/estimator/narrative-column.tsx` | create | Client: the narrative column body (presentation, intro, key-product cards, intro row, Draft) |
| `src/app/(app)/estimator/narrative-intros-modal.tsx` | create | Client: Manage intros modal |
| `src/app/(app)/estimator/section-card.tsx` | modify | ★ toggle per eligible line |
| `src/app/(app)/estimator/estimator-client.tsx` | modify | Wiring: pdf appendix state, star handler, column, Copy-here remap, intros state |
| `src/app/(app)/estimator/page.tsx` | modify | `canWriteNarrativeLibrary`, `narrativeIntros` |
| `src/app/(app)/catalog/narrative-paragraph-panel.tsx` | create | Client: Narrative paragraph editor in the part editor |
| `src/app/(app)/catalog/page.tsx` | modify | Mount the panel under the Spec panel |
| `scripts/test-review-and-spec.ts` | modify | `#293 slice 1` blocks |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` | modify | Final docs task |

## Task overview

| # | Task | Depends on |
|---|---|---|
| 1 | Pure core: key-product rules, intro rules, appendix option | none |
| 2 | Server layer: paragraph store, intros store, library + photos, actions, save sanitization | 1 |
| 3 | Printing: QuoteDocument blocks + photos + appendix, print route, Show-on-PDF toggle | 1, 2 |
| 4 | Estimator key-products UI: ★, narrative column cards, library hook, Copy-here remap | 1, 2 |
| 5 | Intros + Draft narrative UI; catalog Narrative paragraph panel | 1, 2, 4 |
| 6 | Final gates (smoke + build), browser check, docs (PUNCHLIST / DECISIONS / AGENTS) | 1–5 |

---

### Task 1: Pure core — key-product rules, intro rules, appendix option

**Files:**
- Modify: `src/app/(app)/estimator/types.ts` (the `SpecSection` type, ~lines 204–239, and a new `KeyProduct` type above it)
- Modify: `src/app/(app)/estimator/narrative.ts` (append below `narrativeBlocks`)
- Modify: `src/lib/quote-pdf/pdf-options.ts`
- Create: `src/lib/narrative/intros.ts`
- Test: `scripts/test-review-and-spec.ts` (append block `#293 slice 1 — pure rules`)

**Interfaces:**
- Consumes: nothing new.
- Produces. Later tasks import these exact names.
  - `types.ts`:
    - `export type KeyProduct = { lineKey: string; sku: string; text: string; photo: boolean }`;
    - `SpecSection.keyProducts?: KeyProduct[]`.
  - `narrative.ts`:
    - constants: `MAX_KEY_PRODUCTS`, `MAX_PARAGRAPH`, `MAX_INTRO`, `MAX_LIBRARY_SKUS`;
    - types: `LibraryInfo`, `KeyProductLibraryRow`, `ParagraphSaveResponse`, `KeyProductResolution`,
      `KeyProductStar`, `KeyProductChip`, `PrintableKeyProduct`;
    - `KEY_PRODUCT_CHIP_LABEL`;
    - functions: `isKeyProductEligible(it)`, `resolveKeyProducts(sec)`, `sanitizeKeyProducts(raw)`,
      `withKeyProducts(sec, kps)`, `withSanitizedKeyProducts(sec)`, `remapKeyProducts(kps, idMap)`,
      `keyProductStar(sec, it)`, `markKeyProduct(sec, itemId, libraryText)`, `toggleKeyProduct(sec, itemId, libraryText)`,
      `moveKeyProduct(sec, index, dir)`, `removeKeyProduct(sec, index)`, `patchKeyProduct(sec, index, patch)`,
      `reanchorKeyProduct(sec, index)`, `unmarkedEligibleLines(sec)`, `keyProductChip(kp, row)`,
      `draftNarrative(sec, intro, library, mode)`, `draftOverwrites(sec, intro, library)`, `keyProductHeading(it)`,
      `printableKeyProducts(sec)`, `photoSkusOf(sections)`.
  - `pdf-options.ts`: `QuotePdfOptions.pdfItemizedAppendix: boolean`; the key is in `PDF_TOGGLE_KEYS`; the default is
    `false`.
  - `lib/narrative/intros.ts`:
    - `SystemIntro`, `IntroInput`, `IntroOp`, `MAX_INTROS = 200`, `MAX_INTRO_TITLE = 120`, `INTRO_ID_RE`;
    - `newIntroId(rand)`, `sanitizeIntro(input, list)`, `sanitizeIntroList(raw)`, `applyIntroOp(list, op, now, by, mint)`.

- [ ] **Step 1: Write the failing harness block.** Append this to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #293 slice 1 — pure rules: key products (eligibility, resolve,
   sanitize, remap, star/edit helpers, chip, Draft narrative, printable
   blocks), the Itemized appendix option, and the system-intro library.
   ====================================================================== */
import {
  MAX_KEY_PRODUCTS as n293MaxKp, MAX_PARAGRAPH as n293MaxPara, MAX_INTRO as n293MaxIntro, MAX_LIBRARY_SKUS as n293MaxLib,
  isKeyProductEligible as n293Eligible, resolveKeyProducts as n293Resolve, sanitizeKeyProducts as n293Sanitize,
  withKeyProducts as n293WithKps, withSanitizedKeyProducts as n293WithSanitized, remapKeyProducts as n293Remap,
  keyProductStar as n293Star, toggleKeyProduct as n293Toggle, markKeyProduct as n293Mark, moveKeyProduct as n293Move,
  removeKeyProduct as n293Remove, patchKeyProduct as n293Patch, reanchorKeyProduct as n293Reanchor,
  unmarkedEligibleLines as n293Unmarked, keyProductChip as n293Chip, KEY_PRODUCT_CHIP_LABEL as n293ChipLabel,
  draftNarrative as n293Draft, draftOverwrites as n293Overwrites, printableKeyProducts as n293Printable,
  photoSkusOf as n293PhotoSkus, type LibraryInfo as N293Lib,
} from "@/app/(app)/estimator/narrative";
import { DEFAULT_PDF_OPTIONS as n293DefPdf, PDF_TOGGLE_KEYS as n293ToggleKeys, normalizePdfOptions as n293NormPdf } from "@/lib/quote-pdf/pdf-options";
import { copySectionForTarget as n293Copy } from "@/app/(app)/estimator/copy-system";
import { repriceForTier as n293Reprice } from "@/app/(app)/estimator/tier-reprice";
import { withRewardCredit as n293WithCredit } from "@/lib/rewards/credit-line";
import { sanitizeSystemSell as n293SanSell } from "@/app/(app)/estimator/pricing";
import {
  applyIntroOp as n293Apply, newIntroId as n293NewId, sanitizeIntro as n293SanIntro, sanitizeIntroList as n293SanList,
  MAX_INTROS as n293MaxIntros, MAX_INTRO_TITLE as n293MaxTitle, INTRO_ID_RE as n293IntroRe, type SystemIntro as N293Intro,
} from "@/lib/narrative/intros";
import type { KeyProduct as N293Kp, SpecItem as N293Item, SpecSection as N293Sec } from "@/app/(app)/estimator/types";
{
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const it = (id: number, extra: Partial<N293Item> = {}): N293Item => ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 1, unit: "ea", cost: 10, price: 20, ...extra } as N293Item);
  const sec = (items: N293Item[], extra: Partial<N293Sec> = {}): N293Sec => ({ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items, ...extra });
  const kp = (lineKey: string, sku: string, text = "", photo = true): N293Kp => ({ lineKey, sku, text, photo });
  const lib = (o: Record<string, N293Lib>) => new Map(Object.entries(o));

  // Limits.
  ok(n293MaxKp === 20 && n293MaxPara === 4000 && n293MaxIntro === 8000 && n293MaxLib === 200, "#293 limits: 20 key products, 4,000-char paragraph, 8,000-char intro, 200 skus per library read");

  // Eligibility.
  ok(n293Eligible(it(1)) && n293Eligible(it(2, { custom: true })) && n293Eligible(it(3, { allowance: true })) && n293Eligible(it(4, { vendorQuoteId: "VQ-1" })) && n293Eligible(it(5, { curtain: true })),
    "#293 eligible: plain catalog, custom, allowance-with-sku, vendor and curtain lines can be key products");
  ok(!n293Eligible(it(1, { labor: true })) && !n293Eligible(it(1, { laborOverhead: "shop" })) && !n293Eligible(it(1, { laborTravel: "mileage" })) &&
     !n293Eligible(it(1, { rewardCredit: true })) && !n293Eligible(it(1, { option: true })) && !n293Eligible(it(1, { sku: "   " })),
    "#293 eligible: labor, overhead, travel, Rewards credit, option and blank-sku lines are not");

  // Resolve.
  const rs = n293Resolve(sec([it(1), it(2), it(3, { option: true })], { keyProducts: [kp("1", "SKU-1"), kp("9", "X"), kp("2", "OTHER"), kp("3", "SKU-3")] }));
  ok(rs.map((r) => r.status).join(",") === "ok,missing,changed,ineligible", "#293 resolve: ok / missing (line removed) / changed (same id, other sku) / ineligible (became an option)");
  ok(n293Resolve(sec([it(1)])).length === 0, "#293 resolve: a section without keyProducts resolves to nothing");

  // Sanitize.
  const messy: unknown[] = [
    null, "x", 7, ["arr"], { lineKey: "", sku: "A" }, { lineKey: "4", sku: "  " },
    { lineKey: " 1 ", sku: " SKU-1 ", text: "  hi\r\nthere  ", photo: "yes", junk: 1 },
    { lineKey: "1", sku: "SKU-9", text: "dup line" },
    { lineKey: "2", sku: "SKU-1", text: "dup sku" },
    { lineKey: 7, sku: "SKU-7", text: "x".repeat(n293MaxPara + 50), photo: false },
    { lineKey: "99", sku: "GONE", text: "kept although unresolved" },
  ];
  const clean = n293Sanitize(messy);
  ok(eq(clean, [
    { lineKey: "1", sku: "SKU-1", text: "hi\nthere", photo: true },
    { lineKey: "7", sku: "SKU-7", text: "x".repeat(n293MaxPara), photo: false },
    { lineKey: "99", sku: "GONE", text: "kept although unresolved", photo: true },
  ]), "#293 sanitize: drops non-objects / missing lineKey or sku, trims, defaults photo to true, strips unknown keys, caps text, dedupes by lineKey then sku, keeps unresolved blocks");
  ok(clean.every((k) => eq(Object.keys(k), ["lineKey", "sku", "text", "photo"])), "#293 sanitize: exactly four keys per block");
  ok(n293Sanitize(Array.from({ length: 30 }, (_, i) => ({ lineKey: String(i), sku: "S" + i }))).length === n293MaxKp && eq(n293Sanitize("nope"), []),
    "#293 sanitize: caps the count at MAX_KEY_PRODUCTS; a non-array is []");

  // withKeyProducts / withSanitizedKeyProducts.
  const bare = sec([it(1)]);
  ok(n293WithSanitized(bare) === bare, "#293 save: a section without keyProducts passes through untouched (same object — back-compat exact)");
  ok(!("keyProducts" in n293WithKps(sec([it(1)], { keyProducts: [kp("1", "SKU-1")] }), [])) && !("keyProducts" in n293WithKps(bare, undefined)),
    "#293 withKeyProducts: an empty list removes the key");
  ok(eq(n293WithSanitized(sec([it(1)], { keyProducts: messy as N293Kp[] })).keyProducts, clean) && !("keyProducts" in n293WithSanitized(sec([it(1)], { keyProducts: [null] as unknown as N293Kp[] }))),
    "#293 save: messy blocks are cleaned; all-invalid blocks drop the key");

  // Remap.
  ok(eq(n293Remap([kp("1", "A"), kp("2", "B"), kp("3", "C")], new Map([[1, 101], [2, 102]]))?.map((k) => k.lineKey), ["101", "102"]) && n293Remap(undefined, new Map()) === undefined,
    "#293 remap: ids follow the map, unmapped blocks drop, undefined passes through");

  // Star / toggle / mark.
  const s2 = sec([it(1), it(2), it(3, { sku: "SKU-2" }), it(4, { option: true })]);
  ok(n293Star(s2, s2.items[0]) === "off" && n293Star(s2, s2.items[3]) === "none", "#293 star: an eligible unmarked line is off; an option line has no star");
  const on1 = n293Toggle(s2, 1, "Library para");
  ok(eq(on1.keyProducts, [{ lineKey: "1", sku: "SKU-1", text: "Library para", photo: true }]) && n293Star(on1, on1.items[0]) === "on", "#293 star: toggling on appends a block with the library text, photo on");
  ok(!("keyProducts" in n293Toggle(on1, 1, "")), "#293 star: toggling off removes the block (and the key when it was the last)");
  const on2 = n293Toggle(s2, 2, "");
  ok(n293Star(on2, on2.items[2]) === "dupSku" && n293Mark(on2, 3, "") === on2, "#293 star: a second line with the same sku is disabled and cannot be marked");
  const full = sec(Array.from({ length: 21 }, (_, i) => it(i + 1)));
  let f = full;
  for (let i = 1; i <= 20; i++) f = n293Mark(f, i, "");
  ok(f.keyProducts!.length === 20 && n293Star(f, f.items[20]) === "full" && n293Mark(f, 21, "") === f, "#293 star: at MAX_KEY_PRODUCTS the star is disabled");

  // Move / remove / patch / reanchor / picker.
  const three = n293Mark(n293Mark(n293Mark(sec([it(1), it(2), it(3)]), 1, ""), 2, ""), 3, "");
  ok(eq(n293Move(three, 0, 1).keyProducts!.map((k) => k.lineKey), ["2", "1", "3"]) && n293Move(three, 0, -1) === three, "#293 move: ↓ swaps; out of range is a no-op");
  ok(eq(n293Remove(three, 1).keyProducts!.map((k) => k.lineKey), ["1", "3"]), "#293 remove: removes by index");
  const patched = n293Patch(three, 0, { text: "y".repeat(n293MaxPara + 9), photo: false });
  ok(patched.keyProducts![0].text.length === n293MaxPara && patched.keyProducts![0].photo === false, "#293 patch: text capped, photo toggled");
  const swapped = { ...three, items: three.items.map((x) => (x.id === 2 ? { ...x, sku: "NEW-2" } : x)) };
  ok(n293Reanchor(swapped, 1).keyProducts![1].sku === "NEW-2" && n293Reanchor(three, 1) === three, "#293 re-anchor: a changed block adopts the line's new sku; an ok block is untouched");
  ok(eq(n293Unmarked(n293Mark(s2, 1, "")).map((x) => x.id), [2]), "#293 picker: lists eligible unmarked lines, one per sku");

  // Chip.
  const row = (paragraph: string | null, inCatalog = true): N293Lib => ({ inCatalog, desc: "Cat", paragraph });
  ok(n293Chip(kp("1", "A", "x"), undefined) === null && n293Chip(kp("1", "A", "x"), row(null, false)) === "custom" && n293Chip(kp("1", "A", "x"), row(null)) === "needs" &&
     n293Chip(kp("1", "A", " Same "), row("Same")) === "library" && n293Chip(kp("1", "A", "Other"), row("Same")) === "edited",
    "#293 chip: not loaded / Not in catalog / Needs a paragraph / From library / Edited");
  ok(n293ChipLabel.needs === "Needs a paragraph" && n293ChipLabel.library === "From library" && n293ChipLabel.edited === "Edited" && n293ChipLabel.custom === "Not in catalog", "#293 chip: labels are the spec's copy");

  // Draft narrative.
  const d0 = sec([it(1), it(2), it(3), it(4, { sku: "CUSTOM-4", desc: "Hand-made truss" })], {
    narrative: "",
    keyProducts: [kp("1", "SKU-1"), kp("2", "SKU-2", "Written by hand"), kp("3", "SKU-3"), kp("4", "CUSTOM-4"), kp("9", "GONE", "keep me")],
  });
  const L = lib({
    "SKU-1": row("Library one."), "SKU-2": row("Library two."),
    "SKU-3": { inCatalog: true, desc: "Cat desc 3", paragraph: null },
    "CUSTOM-4": { inCatalog: false, desc: "", paragraph: null },
  });
  const blanks = n293Draft(d0, "Intro text", L, "blanks");
  const texts = (s: N293Sec) => s.keyProducts!.map((k) => k.text);
  ok(blanks.section.narrative === "Intro text" && eq(texts(blanks.section), ["Library one.", "Written by hand", "Cat desc 3", "Hand-made truss", "keep me"]),
    "#293 draft (blanks): intro fills an empty narrative; library paragraph, else catalog description, else the line's description; written text and unresolved blocks are left alone");
  ok(eq(blanks.needsParagraph, ["SKU-3", "CUSTOM-4"]) && blanks.section.presentation === "narrative" && blanks.changed, "#293 draft: reports skus with no library paragraph and switches to Narrative");
  const replace = n293Draft({ ...d0, narrative: "Old intro" }, "Intro text", L, "replace");
  ok(replace.section.narrative === "Intro text" && texts(replace.section)[1] === "Library two.", "#293 draft (replace): overwrites the intro and written block text");
  ok(n293Draft({ ...d0, narrative: "Old intro" }, null, L, "replace").section.narrative === "Old intro", "#293 draft: no chosen intro leaves the narrative alone");
  ok(n293Draft({ ...d0, narrative: "Kept" }, "Intro text", L, "blanks").section.narrative === "Kept", "#293 draft (blanks): a written intro is kept");
  const again = n293Draft(replace.section, "Intro text", L, "replace");
  ok(!again.changed && again.section === replace.section, "#293 draft: changed is false (same object) when nothing differs");
  ok(n293Overwrites(d0, "Intro text", L) && !n293Overwrites(sec([it(1)], { keyProducts: [kp("1", "SKU-1")] }), "Intro", L) && n293Overwrites(sec([it(1)], { narrative: "Mine" }), "Intro", L),
    "#293 draft: asks before overwriting written text, not before filling blanks");

  // Printable blocks.
  const pr = n293Printable(sec([it(1, { allowance: true, desc: "Rigging hardware" }), it(2), it(3, { option: true })], {
    keyProducts: [kp("2", "SKU-2", "Two.\n\n- a\n- b", false), kp("1", "SKU-1"), kp("3", "SKU-3", "opt"), kp("9", "GONE", "gone")],
  }));
  ok(eq(pr.map((p) => p.sku), ["SKU-2", "SKU-1"]) && pr[1].heading === "Budget allowance — Rigging hardware" && pr[0].heading === "Line 2",
    "#293 printable: order kept, unresolved excluded, heading = desc with the allowance prefix");
  ok(eq(pr[0].blocks, [{ kind: "p", lines: ["Two."] }, { kind: "ul", items: ["a", "b"] }]) && pr[0].photo === false && eq(pr[1].blocks, []),
    "#293 printable: text split by narrativeBlocks; empty text prints the heading only");
  ok(eq(n293PhotoSkus([
    sec([it(1), it(2)], { presentation: "narrative", keyProducts: [kp("1", "SKU-1"), kp("2", "SKU-2", "", false)] }),
    sec([it(1)], { id: "s2", presentation: "narrative", keyProducts: [kp("1", "SKU-1")] }),
    sec([it(5)], { id: "s3", keyProducts: [kp("5", "SKU-5")] }),
  ]), ["SKU-1"]), "#293 photos: only narrative systems' printable blocks with photo on, deduped");

  // Blocks travel as-is on every path that keeps ids.
  const carried = sec([it(1)], { keyProducts: [kp("1", "SKU-1", "t")] });
  ok(eq(n293SanSell(carried).keyProducts, carried.keyProducts), "#293 carry: sanitizeSystemSell keeps keyProducts");
  ok(eq(n293Copy(carried, { newSectionId: "s9", catalog: new Map(), fixtures: new Map(), sourceTierMargin: null, targetTierMargin: null }).section.keyProducts, carried.keyProducts),
    "#293 carry: Copy to another estimate (copySectionForTarget) keeps keyProducts and ids");
  ok(eq(n293WithCredit([carried], 50, 99)[0].keyProducts, carried.keyProducts), "#293 carry: withRewardCredit keeps keyProducts");
  ok(eq(n293Reprice([carried], 0.25, 0.2).sections[0].keyProducts, carried.keyProducts), "#293 carry: tier re-price keeps keyProducts");

  // Itemized appendix option.
  ok(n293DefPdf.pdfItemizedAppendix === false && (n293ToggleKeys as readonly string[]).includes("pdfItemizedAppendix"), "#293 pdf options: Itemized appendix defaults off and is a toggle key");
  ok(n293NormPdf(undefined).pdfItemizedAppendix === false && n293NormPdf({ pdfItemizedAppendix: true }).pdfItemizedAppendix === true && n293NormPdf({ pdfItemizedAppendix: "yes" }).pdfItemizedAppendix === false,
    "#293 pdf options: absent → false, true kept, a non-boolean → false");

  // Intros (pure).
  ok(n293NewId(() => 0) === "NI-00000000" && n293NewId(() => 0.9999) === "NI-zzzzzzzz" && n293IntroRe.test(n293NewId(Math.random)), "#293 intros: NI- + 8 base36 chars");
  const I = (id: string, title: string, text = "Body"): N293Intro => ({ id, title, text, updatedAt: 1, updatedBy: "t" });
  const list = [I("NI-aaaaaaaa", "Rigging"), I("NI-bbbbbbbb", "Audio")];
  const bad = (r: ReturnType<typeof n293SanIntro>, re: RegExp) => !r.ok && re.test(r.error);
  ok(bad(n293SanIntro({ title: "  ", text: "x" }, list), /title/i) && bad(n293SanIntro({ title: "t".repeat(n293MaxTitle + 1), text: "x" }, list), /120/) &&
     bad(n293SanIntro({ title: "T", text: "   " }, list), /text/i) && bad(n293SanIntro({ title: "T", text: "x".repeat(n293MaxIntro + 1) }, list), /8,000/),
    "#293 intros: empty title, long title, empty text and long text are refused");
  ok(bad(n293SanIntro({ title: "rigging", text: "x" }, list), /already exists/) && n293SanIntro({ id: "NI-aaaaaaaa", title: "RIGGING", text: "x" }, list).ok,
    "#293 intros: a duplicate title (case-insensitive) is refused, except the intro itself");
  const s = n293SanIntro({ title: " Lighting ", text: " a\r\nb " }, list);
  ok(s.ok && s.value.title === "Lighting" && s.value.text === "a\nb" && s.value.id === null, "#293 intros: trims and normalizes line breaks");
  ok(bad(n293SanIntro({ id: "bogus", title: "X", text: "y" }, list), /no longer exists/), "#293 intros: a malformed id is refused");
  let n = 0;
  const mint = () => ["NI-aaaaaaaa", "NI-cccccccc"][n++] ?? "NI-dddddddd";
  const add = n293Apply(list, { kind: "upsert", intro: { title: "Lighting", text: "Wash" } }, 50, "Pat", mint);
  ok(add.ok && add.id === "NI-cccccccc" && eq(add.list.map((i) => i.title), ["Audio", "Lighting", "Rigging"]) && add.list.find((i) => i.id === "NI-cccccccc")!.updatedBy === "Pat",
    "#293 intros: upsert-new mints a fresh id (skipping a collision), stamps by/at, sorts by title");
  const edit = n293Apply(list, { kind: "upsert", intro: { id: "NI-aaaaaaaa", title: "Rigging", text: "New body" } }, 60, "Lee", mint);
  ok(edit.ok && edit.id === "NI-aaaaaaaa" && edit.list.find((i) => i.id === "NI-aaaaaaaa")!.text === "New body" && edit.list.length === 2, "#293 intros: upsert-existing keeps the id");
  const gone = n293Apply(list, { kind: "upsert", intro: { id: "NI-zzzzzzzz", title: "Q", text: "q" } }, 60, "Lee", mint);
  ok(!gone.ok && /no longer exists/.test(gone.error), "#293 intros: upserting a deleted intro is refused");
  const del = n293Apply(list, { kind: "delete", id: "NI-bbbbbbbb" }, 70, "Lee", mint);
  const delUnknown = n293Apply(list, { kind: "delete", id: "NI-zzzzzzzz" }, 70, "Lee", mint);
  ok(del.ok && eq(del.list.map((i) => i.id), ["NI-aaaaaaaa"]) && delUnknown.ok && delUnknown.list.length === 2, "#293 intros: delete removes; deleting an unknown id is a no-op");
  const many = Array.from({ length: n293MaxIntros }, (_, i) => I("NI-" + String(i).padStart(8, "0"), "T" + i));
  const capped = n293Apply(many, { kind: "upsert", intro: { title: "One more", text: "x" } }, 1, "t", () => "NI-zzzzzzzz");
  ok(!capped.ok && /200/.test(capped.error) && n293Apply(many, { kind: "upsert", intro: { id: many[0].id, title: "T0", text: "edit" } }, 1, "t", mint).ok,
    "#293 intros: the 200 cap refuses a new intro but still allows edits");
  ok(eq(n293SanList([null, { id: "NI-aaaaaaaa", title: "A", text: "a", updatedAt: 1, updatedBy: "x" }, { id: "bad", title: "B", text: "b" }]).map((i) => i.id), ["NI-aaaaaaaa"]),
    "#293 intros: the stored list is shape-cleaned on read");
}
```

- [ ] **Step 2: Run the harness and watch it fail**

Run: `cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | head -20`
Expected: errors like `Module '"@/app/(app)/estimator/narrative"' has no exported member 'MAX_KEY_PRODUCTS'` and
`Cannot find module '@/lib/narrative/intros'`.

- [ ] **Step 3: Add the `KeyProduct` type.** In `src/app/(app)/estimator/types.ts`, insert this immediately above
`/** One system card. */` (just before `export type SpecSection`):

```ts
/** #293: a product the customer narrative features — its paragraph prints
 *  (Narrative presentation only) with the part's photo floated beside it.
 *  Anchored to one line of THIS section: item ids are unique per section
 *  only (computeNid / placeSystemInEstimate keeps ids on Copy-to-existing). */
export type KeyProduct = {
  /** String(SpecItem.id) of a line in THIS section. */
  lineKey: string;
  /** The line's sku when marked — resolution requires it to still match. */
  sku: string;
  /** The paragraph as it prints: plain text, narrativeBlocks() rules (D488). */
  text: string;
  /** Print the part's primary photo beside the paragraph. */
  photo: boolean;
};
```

Inside `export type SpecSection = { … }`, add this as the last field, after `laborGroups?`:

```ts
  /** #293: ordered; at most one block per lineKey and per sku. Absent on
   *  every pre-#293 section (which therefore prints exactly as before). */
  keyProducts?: KeyProduct[];
```

- [ ] **Step 4: Add the appendix option.** In `src/lib/quote-pdf/pdf-options.ts`:

```ts
export type QuotePdfOptions = {
  detail: "itemized" | "sectioned";
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
  /** #293: print every system the body didn't itemize again, in full, after
   *  the signature block. Off by default; absent on older quotes → off. */
  pdfItemizedAppendix: boolean;
};

export const PDF_TOGGLE_KEYS = ["pdfQty", "pdfNotes", "pdfPrices", "pdfCover", "pdfTerms", "pdfOptions", "pdfItemizedAppendix"] as const;

export const DEFAULT_PDF_OPTIONS: QuotePdfOptions = {
  detail: "itemized",
  pdfQty: true,
  pdfNotes: true,
  pdfPrices: true,
  pdfCover: true,
  pdfTerms: true,
  pdfOptions: true,
  pdfItemizedAppendix: false,
};
```

Leave `normalizePdfOptions` unchanged. It already copies only real booleans for every toggle key.

- [ ] **Step 5: Extend `narrative.ts`.** Change the file's first line to import types (add it above the existing doc
comment):

```ts
import type { KeyProduct, SpecItem, SpecSection } from "./types";
```

Then append the following at the end of `src/app/(app)/estimator/narrative.ts`:

```ts
/* =====================================================================
 * #293 — key products. A system's narrative features chosen lines: each
 * prints a reusable paragraph (copied onto the quote) with the part's
 * photo beside it, in Narrative presentation only. Pure — the harness,
 * the client column, the server save and QuoteDocument all share it.
 * ===================================================================== */

export const MAX_KEY_PRODUCTS = 20;
export const MAX_PARAGRAPH = 4000;
export const MAX_INTRO = 8000;
/** keyProductLibraryAction reads at most this many skus per call. */
export const MAX_LIBRARY_SKUS = 200;

/** What Draft narrative and the chip need about one sku's library entry. */
export type LibraryInfo = { inCatalog: boolean; desc: string; paragraph: string | null };
/** keyProductLibraryAction's row (one per requested sku). */
export type KeyProductLibraryRow = LibraryInfo & {
  paragraphUpdatedAt: number | null;
  paragraphUpdatedBy: string | null;
  /** The part's primary visible image (visibleImagesForParts()[sku][0]). */
  photoDocId: string | null;
};
/** saveProductParagraphAction's answer — declared here because a "use server"
 *  file may export only async functions. */
export type ParagraphSaveResponse =
  | { ok: true; row: KeyProductLibraryRow }
  | { ok: false; error: string; stale?: { paragraph: string | null; updatedAt: number | null } };

const skuOf = (it: Pick<SpecItem, "sku"> | null | undefined): string => (it && typeof it.sku === "string" ? it.sku.trim() : "");

/** A line that can be featured: a real sku, and not labor / overhead /
 *  travel / the Rewards credit / an option (options print under Optional
 *  additions — featuring one would describe an item not in the total). */
export function isKeyProductEligible(it: SpecItem): boolean {
  if (!it || !skuOf(it)) return false;
  return !it.labor && !it.laborOverhead && !it.laborTravel && !it.rewardCredit && !it.option;
}

export type KeyProductResolution =
  | { kp: KeyProduct; status: "ok"; item: SpecItem }
  | { kp: KeyProduct; status: "missing" }
  | { kp: KeyProduct; status: "changed"; item: SpecItem }
  | { kp: KeyProduct; status: "ineligible"; item: SpecItem };

/** Each block against the section's lines: the id must exist, its sku must
 *  still match, and the line must still be eligible. */
export function resolveKeyProducts(sec: SpecSection): KeyProductResolution[] {
  const items = Array.isArray(sec?.items) ? sec.items : [];
  return (sec?.keyProducts || []).map((kp): KeyProductResolution => {
    const item = items.find((it) => String(it.id) === kp.lineKey);
    if (!item) return { kp, status: "missing" };
    if (skuOf(item) !== kp.sku) return { kp, status: "changed", item };
    if (!isKeyProductEligible(item)) return { kp, status: "ineligible", item };
    return { kp, status: "ok", item };
  });
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const cleanText = (v: unknown, max: number): string => (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").trim().slice(0, max);

/** Shape-clean for save: drop malformed rows and unknown keys, trim, cap
 *  counts and lengths, dedupe by lineKey then sku (first wins). Does NOT
 *  drop unresolved blocks — the editor shows them flagged until removed. */
export function sanitizeKeyProducts(raw: unknown): KeyProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyProduct[] = [];
  const keys = new Set<string>();
  const skus = new Set<string>();
  for (const r of raw) {
    if (out.length >= MAX_KEY_PRODUCTS) break;
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const lineKey = strOf(o.lineKey).trim().slice(0, 32);
    const sku = strOf(o.sku).trim();
    if (!lineKey || !sku || keys.has(lineKey) || skus.has(sku)) continue;
    keys.add(lineKey);
    skus.add(sku);
    out.push({ lineKey, sku, text: cleanText(o.text, MAX_PARAGRAPH), photo: typeof o.photo === "boolean" ? o.photo : true });
  }
  return out;
}

/** The section with these blocks — an empty / absent list removes the key so
 *  a section without blocks stays byte-identical to a pre-#293 one. */
export function withKeyProducts<T extends SpecSection>(sec: T, kps: KeyProduct[] | undefined): T {
  const out = { ...sec };
  if (kps && kps.length) out.keyProducts = kps;
  else delete out.keyProducts;
  return out;
}

/** Server-side save rule: a section that never had the key passes through
 *  untouched (same object); one that has it is sanitized. */
export function withSanitizedKeyProducts<T extends SpecSection>(sec: T): T {
  if (!sec || typeof sec !== "object" || !("keyProducts" in sec)) return sec;
  return withKeyProducts(sec, sanitizeKeyProducts(sec.keyProducts));
}

/** Re-anchor after a re-id (same-estimate Copy, Load system). Blocks whose
 *  old id isn't in the map are dropped. */
export function remapKeyProducts(kps: KeyProduct[] | undefined, idMap: ReadonlyMap<number, number>): KeyProduct[] | undefined {
  if (!kps) return undefined;
  const out: KeyProduct[] = [];
  for (const kp of kps) {
    const n = Number(kp.lineKey);
    const next = Number.isFinite(n) ? idMap.get(n) : undefined;
    if (next != null) out.push({ ...kp, lineKey: String(next) });
  }
  return out;
}

/** The ★ on a line: on (a block anchors here), off (can be marked), full
 *  (MAX_KEY_PRODUCTS reached), dupSku (another line with this sku is
 *  already featured), none (ineligible — no star). */
export type KeyProductStar = "on" | "off" | "full" | "dupSku" | "none";
export function keyProductStar(sec: SpecSection, it: SpecItem): KeyProductStar {
  if (!isKeyProductEligible(it)) return "none";
  const kps = sec.keyProducts || [];
  if (kps.some((k) => k.lineKey === String(it.id))) return "on";
  if (kps.some((k) => k.sku === skuOf(it))) return "dupSku";
  if (kps.length >= MAX_KEY_PRODUCTS) return "full";
  return "off";
}

/** Mark one line (the ★ or "+ Key product"); a no-op unless its star is off. */
export function markKeyProduct(sec: SpecSection, itemId: number, libraryText: string): SpecSection {
  const it = sec.items.find((i) => i.id === itemId);
  if (!it || keyProductStar(sec, it) !== "off") return sec;
  const block: KeyProduct = { lineKey: String(it.id), sku: skuOf(it), text: (libraryText || "").slice(0, MAX_PARAGRAPH), photo: true };
  return withKeyProducts(sec, [...(sec.keyProducts || []), block]);
}

/** The ★ click: off → mark (with the library text if loaded), on → remove. */
export function toggleKeyProduct(sec: SpecSection, itemId: number, libraryText: string): SpecSection {
  const it = sec.items.find((i) => i.id === itemId);
  if (!it) return sec;
  if (keyProductStar(sec, it) === "on") return withKeyProducts(sec, (sec.keyProducts || []).filter((k) => k.lineKey !== String(itemId)));
  return markKeyProduct(sec, itemId, libraryText);
}

export function moveKeyProduct(sec: SpecSection, index: number, dir: -1 | 1): SpecSection {
  const kps = [...(sec.keyProducts || [])];
  const j = index + dir;
  if (index < 0 || index >= kps.length || j < 0 || j >= kps.length) return sec;
  [kps[index], kps[j]] = [kps[j], kps[index]];
  return withKeyProducts(sec, kps);
}

export function removeKeyProduct(sec: SpecSection, index: number): SpecSection {
  const kps = sec.keyProducts || [];
  if (index < 0 || index >= kps.length) return sec;
  return withKeyProducts(sec, kps.filter((_, i) => i !== index));
}

export function patchKeyProduct(sec: SpecSection, index: number, patch: Partial<Pick<KeyProduct, "text" | "photo">>): SpecSection {
  const kps = sec.keyProducts || [];
  if (index < 0 || index >= kps.length) return sec;
  const cur = kps[index];
  const next: KeyProduct = {
    ...cur,
    ...("text" in patch ? { text: String(patch.text ?? "").slice(0, MAX_PARAGRAPH) } : {}),
    ...(typeof patch.photo === "boolean" ? { photo: patch.photo } : {}),
  };
  return withKeyProducts(sec, kps.map((k, i) => (i === index ? next : k)));
}

/** "Re-anchor" on a `changed` block: adopt the line's current sku, keep the
 *  text. Refused when another block already features that sku. */
export function reanchorKeyProduct(sec: SpecSection, index: number): SpecSection {
  const r = resolveKeyProducts(sec)[index];
  if (!r || r.status !== "changed") return sec;
  const sku = skuOf(r.item);
  const kps = sec.keyProducts || [];
  if (!sku || kps.some((k, i) => i !== index && k.sku === sku)) return sec;
  return withKeyProducts(sec, kps.map((k, i) => (i === index ? { ...k, sku } : k)));
}

/** "+ Key product" picker: eligible lines whose star is off, one per sku. */
export function unmarkedEligibleLines(sec: SpecSection): SpecItem[] {
  const seen = new Set<string>();
  return sec.items.filter((it) => {
    if (keyProductStar(sec, it) !== "off") return false;
    const s = skuOf(it);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

export type KeyProductChip = "needs" | "library" | "edited" | "custom";
export const KEY_PRODUCT_CHIP_LABEL: Record<KeyProductChip, string> = {
  needs: "Needs a paragraph",
  library: "From library",
  edited: "Edited",
  custom: "Not in catalog",
};
/** The library-status chip; null while the sku's row isn't loaded. */
export function keyProductChip(kp: KeyProduct, row: LibraryInfo | undefined): KeyProductChip | null {
  if (!row) return null;
  if (!row.inCatalog) return "custom";
  if (row.paragraph == null) return "needs";
  return kp.text.trim() === row.paragraph.trim() ? "library" : "edited";
}

/** The text Draft narrative copies onto a block: the library paragraph,
 *  else the catalog description, else the line's own description. */
function draftTextFor(item: SpecItem, lib: LibraryInfo | undefined): string {
  return (lib?.paragraph ?? (lib?.desc || item.desc || "")).slice(0, MAX_PARAGRAPH);
}
const normIntro = (intro: string | null): string | null => (intro == null ? null : intro.replace(/\r\n?/g, "\n").trim().slice(0, MAX_INTRO));

/** Draft narrative: the chosen intro + each resolved block's library
 *  paragraph (else the catalog description as starting text). "replace"
 *  overwrites; "blanks" fills only an empty narrative / empty block text.
 *  Always switches the system to Narrative. Unresolved blocks are never
 *  touched. Returns which skus still need a paragraph (no library text). */
export function draftNarrative(
  sec: SpecSection,
  intro: string | null,
  library: ReadonlyMap<string, LibraryInfo>,
  mode: "replace" | "blanks"
): { section: SpecSection; needsParagraph: string[]; changed: boolean } {
  const introText = normIntro(intro);
  const curNarr = sec.narrative || "";
  const narrative = introText == null ? curNarr : mode === "replace" || !curNarr.trim() ? introText : curNarr;
  const needs: string[] = [];
  const res = resolveKeyProducts(sec);
  const before = sec.keyProducts || [];
  const kps = before.map((kp, i) => {
    const r = res[i];
    if (r.status !== "ok") return kp;
    const lib = library.get(kp.sku);
    if (lib?.paragraph == null && !needs.includes(kp.sku)) needs.push(kp.sku);
    if (mode === "blanks" && kp.text.trim()) return kp;
    const text = draftTextFor(r.item, lib);
    return text === kp.text ? kp : { ...kp, text };
  });
  const changed =
    (sec.presentation || "itemized") !== "narrative" ||
    (introText != null && narrative !== curNarr) ||
    kps.some((k, i) => k !== before[i]);
  if (!changed) return { section: sec, needsParagraph: needs, changed: false };
  const base: SpecSection = { ...sec, presentation: "narrative", ...(introText != null ? { narrative } : {}) };
  return { section: sec.keyProducts ? withKeyProducts(base, kps) : base, needsParagraph: needs, changed: true };
}

/** Would "replace" overwrite something already written? (Draft asks first.) */
export function draftOverwrites(sec: SpecSection, intro: string | null, library: ReadonlyMap<string, LibraryInfo>): boolean {
  const introText = normIntro(intro);
  const cur = (sec.narrative || "").trim();
  if (introText != null && cur && cur !== introText) return true;
  return resolveKeyProducts(sec).some(
    (r) => r.status === "ok" && r.kp.text.trim() !== "" && r.kp.text.trim() !== draftTextFor(r.item, library.get(r.kp.sku)).trim()
  );
}

/** The customer-facing heading: the line's description, with the same
 *  allowance prefix QuoteDocument's itemized rows print. */
export function keyProductHeading(it: SpecItem): string {
  return it.allowance ? "Budget allowance — " + it.desc : it.desc;
}

export type PrintableKeyProduct = { sku: string; heading: string; blocks: NarrativeBlock[]; photo: boolean };
/** What prints for a narrative system: resolved "ok" blocks in order. */
export function printableKeyProducts(sec: SpecSection): PrintableKeyProduct[] {
  return resolveKeyProducts(sec).flatMap((r) =>
    r.status === "ok" ? [{ sku: r.kp.sku, heading: keyProductHeading(r.item), blocks: narrativeBlocks(r.kp.text), photo: r.kp.photo }] : []
  );
}

/** Skus whose photo the document prints: narrative systems' printable
 *  blocks with photo on, deduped, in document order. */
export function photoSkusOf(sections: SpecSection[]): string[] {
  const out: string[] = [];
  for (const sec of sections || []) {
    if ((sec?.presentation || "itemized") !== "narrative") continue;
    for (const p of printableKeyProducts(sec)) if (p.photo && !out.includes(p.sku)) out.push(p.sku);
  }
  return out;
}
```

- [ ] **Step 6: Create `src/lib/narrative/intros.ts`**

```ts
import { MAX_INTRO } from "@/app/(app)/estimator/narrative";

/**
 * #293 — the system-intro library's pure rules. The store
 * (src/lib/stores/narrative-intros.ts) holds one settings blob,
 * `narrative_intros` = { intros: SystemIntro[] }, and writes ONE operation at
 * a time through applyIntroOp (never a full-list replace), so two editors
 * don't clobber each other's unrelated intros. Client-safe.
 */

export type SystemIntro = {
  /** "NI-" + 8 base36 chars, minted by the store, stable. */
  id: string;
  /** ≤ MAX_INTRO_TITLE chars, trimmed, unique case-insensitively. */
  title: string;
  /** ≤ MAX_INTRO chars, plain text (D488 rules). */
  text: string;
  updatedAt: number;
  updatedBy: string;
};

export type IntroInput = { id?: string | null; title: string; text: string };
export type IntroOp = { kind: "upsert"; intro: unknown } | { kind: "delete"; id: string };

export const MAX_INTROS = 200;
export const MAX_INTRO_TITLE = 120;
export const INTRO_ID_RE = /^NI-[0-9a-z]{8}$/;

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** `rand` returns [0, 1) — the store passes a crypto source. */
export function newIntroId(rand: () => number): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += B36[Math.min(35, Math.floor(rand() * 36))];
  return "NI-" + s;
}

const byTitle = (a: SystemIntro, b: SystemIntro) => a.title.localeCompare(b.title, "en", { sensitivity: "base" });

export function sanitizeIntro(
  input: unknown,
  list: readonly SystemIntro[]
): { ok: true; value: { id: string | null; title: string; text: string } } | { ok: false; error: string } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawId = o.id == null || o.id === "" ? null : o.id;
  if (rawId !== null && (typeof rawId !== "string" || !INTRO_ID_RE.test(rawId))) return { ok: false, error: "That intro no longer exists." };
  const title = (typeof o.title === "string" ? o.title : "").trim();
  if (!title) return { ok: false, error: "Give the intro a title." };
  if (title.length > MAX_INTRO_TITLE) return { ok: false, error: `Keep the title to ${MAX_INTRO_TITLE} characters.` };
  const text = (typeof o.text === "string" ? o.text : "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "The intro has no text to save." };
  if (text.length > MAX_INTRO) return { ok: false, error: `Keep the intro under ${MAX_INTRO.toLocaleString("en-US")} characters.` };
  const lower = title.toLowerCase();
  if (list.some((i) => i.id !== rawId && i.title.toLowerCase() === lower)) return { ok: false, error: `An intro named "${title}" already exists.` };
  return { ok: true, value: { id: rawId as string | null, title, text } };
}

/** The stored blob, shape-cleaned on read (malformed rows dropped). */
export function sanitizeIntroList(raw: unknown): SystemIntro[] {
  if (!Array.isArray(raw)) return [];
  const out: SystemIntro[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !INTRO_ID_RE.test(o.id) || typeof o.title !== "string" || typeof o.text !== "string") continue;
    if (out.some((i) => i.id === o.id)) continue;
    out.push({
      id: o.id,
      title: o.title,
      text: o.text,
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
      updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : "",
    });
  }
  return out.sort(byTitle);
}

/** One write. `mint` is called until it returns an unused id (≤ 5 tries). */
export function applyIntroOp(
  list: readonly SystemIntro[],
  op: IntroOp,
  now: number,
  by: string,
  mint: () => string
): { ok: true; list: SystemIntro[]; id: string | null } | { ok: false; error: string } {
  if (op.kind === "delete") {
    return { ok: true, list: list.filter((i) => i.id !== op.id).sort(byTitle), id: null };
  }
  const s = sanitizeIntro(op.intro, list);
  if (!s.ok) return s;
  const { id, title, text } = s.value;
  if (id) {
    if (!list.some((i) => i.id === id)) return { ok: false, error: "That intro no longer exists." };
    const next = list.map((i) => (i.id === id ? { ...i, title, text, updatedAt: now, updatedBy: by } : i));
    return { ok: true, list: next.sort(byTitle), id };
  }
  if (list.length >= MAX_INTROS) return { ok: false, error: `The intro library is full (${MAX_INTROS}). Delete one first.` };
  let fresh = "";
  for (let t = 0; t < 5 && (!fresh || list.some((i) => i.id === fresh)); t++) fresh = mint();
  if (!INTRO_ID_RE.test(fresh) || list.some((i) => i.id === fresh)) return { ok: false, error: "Could not create the intro. Try again." };
  return { ok: true, list: [...list, { id: fresh, title, text, updatedAt: now, updatedBy: by }].sort(byTitle), id: fresh };
}
```

- [ ] **Step 7: Run the gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG" | head -20; grep '#293' "$LOG" | grep -c '^PASS'
npx eslint "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/narrative.ts" src/lib/quote-pdf/pdf-options.ts src/lib/narrative/intros.ts
```

Expected:
- tsc: 0 errors.
- test:specs: exit 0, 0 FAIL, PASS = 10,378 + the new `#293` checks (about 50).
- eslint: 0 errors.

If an existing check fails, read it. The likely suspect is the #222 test `normalizePdfOptions(undefined)` equals
`DEFAULT_PDF_OPTIONS`, and it should still pass.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/narrative.ts" src/lib/quote-pdf/pdf-options.ts src/lib/narrative/intros.ts scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 key-product + intro rules, Itemized appendix option (pure)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 2: Server layer — paragraph store, intros store, library + photos, actions, save sanitization

**Files:**
- Modify: `src/lib/stores/catalog.ts`. Add fields to `CatalogPart` after `portalVisibility?`, and add
  `saveProductParagraph` after `mergeUpsert`.
- Create: `src/lib/stores/narrative-intros.ts`
- Create: `src/lib/narrative/library.ts`
- Create: `src/lib/narrative/photos.ts`
- Create: `src/app/(app)/estimator/narrative-actions.ts`
- Modify: `src/app/(app)/estimator/actions.ts`, in three places: `saveQuoteAction` (~line 383),
  `moveSystemToEstimateAction` (~line 735) and `copySystemToEstimateAction` (~line 908).
- Test: `scripts/test-review-and-spec.ts`. Append block `#293 slice 1 — server layer` plus two async functions, and add
  them to the chain.

**Interfaces:**
- Consumes (Task 1): `MAX_PARAGRAPH`, `MAX_LIBRARY_SKUS`, `KeyProductLibraryRow`, `ParagraphSaveResponse`,
  `photoSkusOf`, `withSanitizedKeyProducts` from `estimator/narrative`; `SystemIntro`, `applyIntroOp`, `newIntroId`,
  `sanitizeIntroList` from `lib/narrative/intros`.
- Produces:
  - `catalog.ts`:
    - `CatalogPart.narrativeText?`, `narrativeUpdatedAt?`, `narrativeUpdatedBy?`;
    - `type ProductParagraphResult`;
    - `saveProductParagraph(sku: string, text: string, by: string, opts?: { expectUpdatedAt?: number | null; now?: number }): Promise<ProductParagraphResult>`.
  - `stores/narrative-intros.ts`: `listIntros(): Promise<SystemIntro[]>`, `upsertIntro(input: unknown, by: string)`,
    `deleteIntro(id: string, by: string)`. Both writes return `{ ok: true; list; id } | { ok: false; error }`.
  - `lib/narrative/library.ts`: `keyProductLibrary(skus: readonly string[]): Promise<Record<string, KeyProductLibraryRow>>`.
  - `lib/narrative/photos.ts`:
    - `PHOTO_TYPES`, `PHOTO_MAX_BYTES`, `PHOTO_TOTAL_MAX_BYTES`, `PHOTO_READ_CONCURRENCY`;
    - `type PhotoReader = (blobKey: string, maxBytes: number) => Promise<Uint8Array | null>`;
    - `keyProductPhotoDocs(sections): Promise<Map<string, PartDocument>>`;
    - `inlinePhotos(docs, read, caps?)`;
    - `readBlobCapped(blobKey, maxBytes)`;
    - `keyProductPhotoDataUris(sections): Promise<Record<string, { src: string; alt: string }>>`.
  - `estimator/narrative-actions.ts` (`"use server"`):
    - `keyProductLibraryAction(skus: string[]): Promise<Record<string, KeyProductLibraryRow>>`;
    - `saveProductParagraphAction(sku: string, text: string, expectUpdatedAt?: number | null): Promise<ParagraphSaveResponse>`;
    - `upsertSystemIntroAction(input: { id?: string | null; title: string; text: string }): Promise<IntroWriteResponse>`;
    - `deleteSystemIntroAction(id: string): Promise<IntroWriteResponse>`.
    - `IntroWriteResponse = { ok: true; intros: SystemIntro[]; id: string | null } | { ok: false; error: string }` is
      exported as a type.

- [ ] **Step 1: Write the failing harness block.** Append to `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #293 slice 1 — server layer: the product paragraph write (mergeUpsert
   only), the intros blob, the library rows, key-product photos (primary
   image, live parts only, inlining caps), and save-path sanitization.
   ====================================================================== */
import { saveProductParagraph as n293SaveParagraph, mergeUpsert as n293MergeUpsert, get as n293GetPart, remove as n293RemovePart } from "@/lib/stores/catalog";
import { listIntros as n293ListIntros, upsertIntro as n293UpsertIntro, deleteIntro as n293DeleteIntro } from "@/lib/stores/narrative-intros";
import { keyProductLibrary as n293Library } from "@/lib/narrative/library";
import { inlinePhotos as n293Inline, keyProductPhotoDocs as n293PhotoDocs } from "@/lib/narrative/photos";
import {
  attachDocument as n293Attach, createDocument as n293CreateDoc, documentLinkId as n293LinkId,
  setDocumentLinkDisplay as n293SetDisplay, setImageOrder as n293SetOrder,
} from "@/lib/stores/part-documents";
import { create as n293QCreate, get as n293QGet, addQuoteRevision as n293QAddRev } from "@/lib/stores/quotes";
import type { PartDocument as N293Doc } from "@/lib/part-docs/types";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const acts = rd("src/app/(app)/estimator/actions.ts");
  ok(acts.includes("payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts)"), "#293 save: saveQuoteAction sanitizes every posted section's keyProducts beside sanitizeSystemSell");
  ok(acts.includes('withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + Date.now() })])'), "#293 move: a moved system's keyProducts are sanitized");
  const copyFn = acts.slice(acts.indexOf("export async function copySystemToEstimateAction("));
  ok(/section = withSanitizedKeyProducts\(section\);/.test(copyFn.slice(0, 1200)), "#293 copy: a copied system's keyProducts are sanitized before copySectionForTarget");
  const na = rd("src/app/(app)/estimator/narrative-actions.ts");
  ok(/^"use server";/.test(na) && ["keyProductLibraryAction", "saveProductParagraphAction", "upsertSystemIntroAction", "deleteSystemIntroAction"].every((f) => na.includes(`export async function ${f}(`)),
    "#293 actions: the four narrative actions live in one \"use server\" file");
  ok((na.match(/can\("create", user\.roles\)/g) || []).length === 3 && !/requirePerm\(/.test(na), "#293 actions: all three library writes refuse without Create (with a message, not a redirect)");
  ok(rd("src/lib/stores/catalog.ts").includes("narrativeText: body") && /mergeUpsert\(key, \{ narrativeText: body, narrativeUpdatedAt:/.test(rd("src/lib/stores/catalog.ts")),
    "#293 paragraph: the write goes through mergeUpsert only");
}

async function narrative293AsyncChecks(): Promise<void> {
  const { getBlob, setBlob } = await import("@/db/doc-store");
  const savedIntros = await getBlob<Record<string, unknown>>("narrative_intros", {});
  const P1 = fixtureId(293, "kp-part");
  const PDEL = fixtureId(293, "kp-part-gone");
  const QID = fixtureId(293, "kp-quote");
  try {
    // ---- product paragraph: mergeUpsert only, price and spec untouched ----
    await n293MergeUpsert(P1, { desc: "Test293 Fresnel", category: "Test293 Cat", unit: "ea", list: 200, cost: 120, specTitle: "FRESNEL", specBody: "1. Spec body" });
    registerFixture("catalog_parts", P1);
    const before = await n293GetPart(P1);
    const r1 = await n293SaveParagraph(P1, "  A bright, even wash.\r\n\r\n- Quiet  ", "Tester", { now: 5_000 });
    const after = await n293GetPart(P1);
    ok(r1.ok && after?.narrativeText === "A bright, even wash.\n\n- Quiet" && after.narrativeUpdatedAt === 5_000 && after.narrativeUpdatedBy === "Tester",
      "#293 paragraph: saveProductParagraph writes narrativeText / At / By (trimmed, line breaks normalized)");
    ok(!!before && !!after && after.cost === before.cost && after.list === before.list && after.pricedAt === before.pricedAt && after.specBody === "1. Spec body" && after.specTitle === "FRESNEL",
      "#293 paragraph: cost, list, pricedAt and the spec fields are unchanged");
    await n293MergeUpsert(P1, { cost: 130, list: 210 }); // a price-book style patch
    ok((await n293GetPart(P1))?.narrativeText === "A bright, even wash.\n\n- Quiet", "#293 paragraph: a later price patch through mergeUpsert leaves the paragraph intact");
    const stale = await n293SaveParagraph(P1, "Newer", "Other", { expectUpdatedAt: 1 });
    ok(!stale.ok && stale.stale?.updatedAt === 5_000 && stale.stale?.paragraph === "A bright, even wash.\n\n- Quiet", "#293 paragraph: a stale expectUpdatedAt is refused with the current text and stamp");
    const fresh = await n293SaveParagraph(P1, "Newer", "Other", { expectUpdatedAt: 5_000, now: 6_000 });
    ok(fresh.ok && (await n293GetPart(P1))?.narrativeText === "Newer", "#293 paragraph: a matching expectUpdatedAt writes");
    ok(!(await n293SaveParagraph(P1, "   ", "T")).ok && !(await n293SaveParagraph(P1, "x".repeat(4001), "T")).ok, "#293 paragraph: empty and over-length text are refused");
    ok(!(await n293SaveParagraph(fixtureId(293, "no-such-sku"), "Text", "T")).ok, "#293 paragraph: a sku not in the catalog (custom) is refused");
    await n293MergeUpsert(PDEL, { desc: "Test293 Gone", category: "Test293 Cat", unit: "ea", list: 1, cost: 1 });
    registerFixture("catalog_parts", PDEL);
    await n293RemovePart(PDEL);
    ok(!(await n293SaveParagraph(PDEL, "Text", "T")).ok, "#293 paragraph: a soft-deleted part is refused");

    // ---- intros blob ----
    await setBlob("narrative_intros", { intros: [] });
    const a = await n293UpsertIntro({ title: "Test293 Rigging", text: "Our rigging systems…" }, "Tester");
    ok(a.ok && /^NI-[0-9a-z]{8}$/.test(a.id || "") && (await n293ListIntros()).some((i) => i.id === a.id && i.updatedBy === "Tester"), "#293 intros: upsertIntro mints an id and round-trips through the blob");
    const dup = await n293UpsertIntro({ title: "test293 rigging", text: "x" }, "Tester");
    ok(!dup.ok, "#293 intros: a duplicate title is refused by the store");
    if (a.ok && a.id) {
      const e = await n293UpsertIntro({ id: a.id, title: "Test293 Rigging", text: "Edited" }, "Lee");
      ok(e.ok && (await n293ListIntros()).find((i) => i.id === a.id)?.text === "Edited", "#293 intros: an edit keeps the id");
      const d = await n293DeleteIntro(a.id, "Lee");
      ok(d.ok && !(await n293ListIntros()).some((i) => i.id === a.id), "#293 intros: deleteIntro removes it");
    }

    // ---- the quote save path stores sanitized blocks; a revision snapshots them ----
    const { withSanitizedKeyProducts } = await import("@/app/(app)/estimator/narrative");
    const posted = { id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative" as const,
      items: [{ id: 1, sku: P1, desc: "Fresnel", qty: 2, unit: "ea", cost: 120, price: 200 }],
      keyProducts: [{ lineKey: 1, sku: ` ${P1} `, text: "  Para  ", photo: "x", junk: true }, { lineKey: "1", sku: "DUP" }] } as unknown as N293Sec;
    const stored = [posted].map(withSanitizedKeyProducts);
    await n293QCreate({ id: QID, name: "#293 kp", customer: "Spec fixture", owner: "spec", quoteType: "system", spec: { sections: stored, mobs: [] } });
    registerFixture("quotes", QID);
    const back = ((await n293QGet(QID))?.spec as { sections?: N293Sec[] } | null)?.sections?.[0];
    ok(JSON.stringify(back?.keyProducts) === JSON.stringify([{ lineKey: "1", sku: P1, text: "Para", photo: true }]), "#293 save: messy posted keyProducts are stored sanitized");
    const rev = await n293QAddRev(QID, { by: "Test", note: "#293" });
    const revSec = (rev?.spec as { sections?: N293Sec[] } | null)?.sections?.[0];
    ok(JSON.stringify(revSec?.keyProducts) === JSON.stringify(back?.keyProducts), "#293 save: addQuoteRevision snapshots keyProducts with the spec");
  } finally {
    await setBlob("narrative_intros", { intros: Array.isArray(savedIntros.intros) ? savedIntros.intros : [] });
  }
}

async function narrativePhotos293AsyncChecks(): Promise<void> {
  const P1 = fixtureId(293, "ph-part");
  const P2 = fixtureId(293, "ph-hidden");
  const P3 = fixtureId(293, "ph-gone");
  const CUSTOM = fixtureId(293, "ph-custom");
  for (const [sku, desc] of [[P1, "Test293 Photo part"], [P2, "Test293 Hidden-only"], [P3, "Test293 Deleted"]]) {
    await n293MergeUpsert(sku, { desc, category: "Test293 Cat", unit: "ea", list: 10, cost: 5 });
    registerFixture("catalog_parts", sku);
  }
  await n293SaveParagraph(P1, "Library text for the photo part.", "Tester");
  const mk = async (fileName: string, contentType: string) => {
    const d = await n293CreateDoc({ kind: "image", fileName, contentType, size: 1000, blobKey: `part-docs/PD-fixture-293/${fileName}`, sourceUrl: null, source: "upload", by: "Test" });
    if (!d) throw new Error("#293 photos: fixture document failed to create");
    registerFixture("part_documents", d.id);
    return d;
  };
  const first = await mk("first.jpg", "image/jpeg");
  const second = await mk("second.webp", "image/webp");
  const hidden = await mk("hidden.png", "image/png");
  const gone = await mk("gone.png", "image/png");
  for (const [doc, sku] of [[first, P1], [second, P1], [hidden, P2], [gone, P3]] as const) {
    await n293Attach(doc.id, [sku], "Test");
    registerFixture("part_document_links", n293LinkId(sku, doc.id));
  }
  ok(await n293SetOrder(P1, [second.id, first.id]), "#293 photos fixture: Make primary moves the second image first");
  ok(await n293SetDisplay(hidden.id, P2, { hidden: true }), "#293 photos fixture: P2's only image is hidden");
  await n293RemovePart(P3);

  const item = (id: number, sku: string) => ({ id, sku, desc: sku, qty: 1, unit: "ea", cost: 5, price: 10 });
  const kp = (id: number, sku: string, photo = true) => ({ lineKey: String(id), sku, text: "t", photo });
  const sections = [
    { id: "a", name: "A", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", items: [item(1, P1), item(2, P2), item(3, P3)], keyProducts: [kp(1, P1), kp(2, P2), kp(3, P3)] },
    { id: "b", name: "B", kind: "materials", mfr: "", freightPct: 0, items: [item(1, P2)], keyProducts: [kp(1, P2)] },
  ] as unknown as N293Sec[];
  const docs = await n293PhotoDocs(sections);
  ok([...docs.keys()].join(",") === P1 && docs.get(P1)?.id === second.id,
    "#293 photos: the primary visible image (visibleImagesForParts [0]); none for a hidden-only part or a soft-deleted part");
  ok((await n293PhotoDocs([{ ...sections[0], keyProducts: [kp(1, P1, false)] }] as unknown as N293Sec[])).size === 0, "#293 photos: photo off → no photo doc");

  const libRows = await n293Library([P1, P2, CUSTOM, P1, "  "]);
  ok(Object.keys(libRows).sort().join(",") === [CUSTOM, P1, P2].sort().join(","), "#293 library: one row per distinct, non-blank sku");
  ok(libRows[P1].inCatalog && libRows[P1].paragraph === "Library text for the photo part." && libRows[P1].photoDocId === second.id && libRows[P1].desc === "Test293 Photo part",
    "#293 library: a catalog part's row carries its paragraph, description and primary photo");
  ok(libRows[P2].inCatalog && libRows[P2].paragraph === null && libRows[P2].photoDocId === null, "#293 library: no paragraph → null; hidden-only images → no photo");
  ok(!libRows[CUSTOM].inCatalog && libRows[CUSTOM].paragraph === null, "#293 library: a custom sku reads Not in catalog");

  // inlinePhotos — fake reader, every cap.
  const d = (id: string, contentType: string, size: number, blobKey: string | null = id): N293Doc =>
    ({ id, kind: "image", title: "T-" + id, fileName: id, contentType, size, blobKey, sourceUrl: null, source: "upload", uploadedAt: 1, uploadedBy: "t", history: [] });
  const bytes: Record<string, Uint8Array | "throw" | null> = { a: new Uint8Array(10), f: new Uint8Array(5), g: new Uint8Array(20), d: null, e: "throw" };
  const reads: string[] = [];
  const read = async (key: string) => { reads.push(key); const b = bytes[key]; if (b === "throw") throw new Error("blob down"); return b ?? null; };
  const map = new Map<string, N293Doc>([
    ["A", d("a", "image/png", 10)], ["B", d("b", "image/svg+xml", 10)], ["C", d("c", "image/jpeg", 99)], ["D", d("d", "image/webp", 1)],
    ["E", d("e", "image/png", 1)], ["F", d("f", "image/png", 5)], ["G", d("g", "image/png", 1)], ["H", d("h", "image/png", 1, null)],
  ]);
  const warn = console.warn;
  console.warn = () => {};
  let out: Record<string, { src: string; alt: string }> = {};
  try {
    out = await n293Inline(map, read, { perImage: 16, total: 12, concurrency: 2 });
  } finally {
    console.warn = warn;
  }
  ok(Object.keys(out).join(",") === "A" && out.A.src === "data:image/png;base64," + Buffer.from(new Uint8Array(10)).toString("base64") && out.A.alt === "T-a",
    "#293 inline: a PNG within caps becomes a data URI; SVG, oversize, missing, unreadable, over-total and blob-less photos are skipped");
  ok(!reads.includes("b") && !reads.includes("c") && !reads.includes("h"), "#293 inline: disallowed types, a stored size over the cap and a missing blobKey are never read");
}
```

Then add the two functions to the chain. Right after the line `  .then(() => packages289AsyncChecks())`, add:

```ts
  .then(() => narrative293AsyncChecks())
  .then(() => narrativePhotos293AsyncChecks())
```

`N293Sec` is the type alias imported in Task 1's block. Type-only imports are hoisted, so it's in scope.

- [ ] **Step 2: Run tsc and watch it fail**

Run: `npx tsc --noEmit 2>&1 | head`
Expected: `Module '"@/lib/stores/catalog"' has no exported member 'saveProductParagraph'`, plus missing modules
`@/lib/stores/narrative-intros`, `@/lib/narrative/library` and `@/lib/narrative/photos`.

- [ ] **Step 3: Add the catalog fields and the store write.** In `src/lib/stores/catalog.ts`, add this import below the
existing imports:

```ts
import { MAX_PARAGRAPH } from "@/app/(app)/estimator/narrative";
```

Inside `export type CatalogPart = { … }`, add after `portalVisibility?: PortalVisibility;`:

```ts
  /** #293: the part's write-once customer paragraph (plain text, D488 rules)
   *  — sales prose for the Estimator's narrative, distinct from specBody (CSI
   *  Part 2 spec language). Written ONLY through mergeUpsert by
   *  saveProductParagraph — no importer, enricher or price-book patch carries
   *  these keys, so imports never clear it. A quote keeps its own copy. */
  narrativeText?: string;
  narrativeUpdatedAt?: number;
  narrativeUpdatedBy?: string;
```

Below `mergeUpsert`, add:

```ts
export type ProductParagraphResult =
  | { ok: true; part: CatalogPart }
  | { ok: false; error: string; stale?: { paragraph: string | null; updatedAt: number | null } };

/**
 * #293 — save a part's library paragraph ("Save to library" in the Estimator,
 * and the part editor's Narrative paragraph). mergeUpsert, never upsert: only
 * the three narrative keys are written, so price, pricedAt, spec text, ports,
 * documents… ride along untouched. `expectUpdatedAt` (when given) must equal
 * the stored narrativeUpdatedAt (null = "there was none") — otherwise the
 * caller re-asks "changed since you loaded it". A soft-deleted or unknown sku
 * is refused (custom lines can't have a library paragraph).
 */
export async function saveProductParagraph(
  sku: string,
  text: string,
  by: string,
  opts: { expectUpdatedAt?: number | null; now?: number } = {}
): Promise<ProductParagraphResult> {
  const key = String(sku || "").trim();
  const body = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "Write the paragraph first." };
  if (body.length > MAX_PARAGRAPH) return { ok: false, error: `Keep the paragraph under ${MAX_PARAGRAPH.toLocaleString("en-US")} characters.` };
  const part = key ? await get(key) : null;
  if (!part) return { ok: false, error: "Only catalog parts have a library paragraph." };
  if (opts.expectUpdatedAt !== undefined && (part.narrativeUpdatedAt ?? null) !== opts.expectUpdatedAt) {
    return {
      ok: false,
      error: "The library paragraph changed since you loaded it.",
      stale: { paragraph: part.narrativeText ?? null, updatedAt: part.narrativeUpdatedAt ?? null },
    };
  }
  const saved = await mergeUpsert(key, { narrativeText: body, narrativeUpdatedAt: opts.now ?? Date.now(), narrativeUpdatedBy: by });
  return { ok: true, part: saved };
}
```

Keep the call on one line: `mergeUpsert(key, { narrativeText: body, narrativeUpdatedAt: …`. The harness regex pins it.

- [ ] **Step 4: Create `src/lib/stores/narrative-intros.ts`**

```ts
import { randomInt } from "node:crypto";
import { getBlob, setBlob } from "@/db/doc-store";
import { applyIntroOp, newIntroId, sanitizeIntroList, type IntroOp, type SystemIntro } from "@/lib/narrative/intros";

/**
 * #293 system-intro library store. One settings blob, no table, no migration
 * (portal_departments / gridDeviceTypes idiom):
 *   narrative_intros   { intros: SystemIntro[] }
 * Writes are ONE operation each (read → applyIntroOp → write), never a
 * full-list replacement from the client. Survives the go-live demo wipe and
 * Clear catalog price list (it's a settings blob).
 */

const INTROS_BLOB = "narrative_intros";

export async function listIntros(): Promise<SystemIntro[]> {
  const row = await getBlob<Record<string, unknown>>(INTROS_BLOB, {});
  return sanitizeIntroList(row.intros);
}

async function write(op: IntroOp, by: string) {
  const list = await listIntros();
  const res = applyIntroOp(list, op, Date.now(), by, () => newIntroId(() => randomInt(0, 36) / 36));
  if (!res.ok) return res;
  await setBlob(INTROS_BLOB, { intros: res.list });
  return res;
}

export function upsertIntro(input: unknown, by: string) {
  return write({ kind: "upsert", intro: input }, by);
}

export function deleteIntro(id: string, by: string) {
  return write({ kind: "delete", id: String(id || "") }, by);
}
```

- [ ] **Step 5: Create `src/lib/narrative/library.ts`**

```ts
import { getMany } from "@/lib/stores/catalog";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import { MAX_LIBRARY_SKUS, type KeyProductLibraryRow } from "@/app/(app)/estimator/narrative";

/**
 * #293 — what the Estimator's narrative column needs per sku: whether it's a
 * live catalog part, its description (Draft's fallback text), its saved
 * paragraph + stamp, and its primary visible image. Batched primary-key reads
 * — never the whole catalog. Every distinct requested sku gets a row, so the
 * client caches misses too.
 */
export async function keyProductLibrary(skus: readonly string[]): Promise<Record<string, KeyProductLibraryRow>> {
  const wanted = [...new Set((skus || []).filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LIBRARY_SKUS);
  if (!wanted.length) return {};
  const [parts, images] = await Promise.all([getMany(wanted), visibleImagesForParts(wanted)]);
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  const out: Record<string, KeyProductLibraryRow> = {};
  for (const sku of wanted) {
    const p = bySku.get(sku);
    const text = p?.narrativeText && p.narrativeText.trim() ? p.narrativeText : null;
    out[sku] = {
      inCatalog: !!p,
      desc: p?.desc || "",
      paragraph: text,
      paragraphUpdatedAt: text ? p?.narrativeUpdatedAt ?? null : null,
      paragraphUpdatedBy: text ? p?.narrativeUpdatedBy ?? null : null,
      photoDocId: p ? images.get(sku)?.[0]?.id ?? null : null,
    };
  }
  return out;
}
```

`paragraphUpdatedAt` is non-null only when there is text. A stale check therefore compares `null` to `null` for a part
that was never saved. That's correct, because `saveProductParagraph` compares against
`part.narrativeUpdatedAt ?? null`, and an empty paragraph can't be saved.

- [ ] **Step 6: Create `src/lib/narrative/photos.ts`**

```ts
import { getMany } from "@/lib/stores/catalog";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import { getBlobStream } from "@/lib/blob";
import { photoSkusOf } from "@/app/(app)/estimator/narrative";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { PartDocument } from "@/lib/part-docs/types";

/**
 * #293 — key-product photos for the customer document. The photo is the
 * part's primary visible image (visibleImagesForParts()[sku][0] — the same
 * image the portal tile shows; a datasheet-render thumbnail only when the
 * part has no real image). Only live catalog parts (a soft-deleted part
 * prints its paragraph with no photo).
 *
 * The print route has no session, so the PDF embeds photos as data URIs —
 * no second authenticated fetch, no token in an <img> URL. PNG/JPEG/WebP
 * only (never SVG — the portal doc route's allowlist), ≤ 3 MB each, ≤ 15 MB
 * per document, ≤ 6 concurrent reads. Any failure = no photo + a warning;
 * a photo never fails the render.
 */

export const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_TOTAL_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTO_READ_CONCURRENCY = 6;

export type PhotoReader = (blobKey: string, maxBytes: number) => Promise<Uint8Array | null>;

/** sku → primary visible image doc, for the photo-on blocks of narrative systems. */
export async function keyProductPhotoDocs(sections: SpecSection[]): Promise<Map<string, PartDocument>> {
  const skus = photoSkusOf(sections);
  const out = new Map<string, PartDocument>();
  if (!skus.length) return out;
  const [parts, images] = await Promise.all([getMany(skus), visibleImagesForParts(skus)]);
  const live = new Set(parts.map((p) => p.sku));
  for (const sku of skus) {
    const doc = live.has(sku) ? images.get(sku)?.[0] : undefined;
    if (doc) out.set(sku, doc);
  }
  return out;
}

/** Read a private blob, giving up (null) past `maxBytes`. */
export async function readBlobCapped(blobKey: string, maxBytes: number): Promise<Uint8Array | null> {
  const stream = await getBlobStream(blobKey);
  if (!stream) return null;
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Inline photo docs as data URIs within the caps (pure apart from `read`). */
export async function inlinePhotos(
  docs: ReadonlyMap<string, PartDocument>,
  read: PhotoReader,
  caps: { perImage: number; total: number; concurrency: number } = { perImage: PHOTO_MAX_BYTES, total: PHOTO_TOTAL_MAX_BYTES, concurrency: PHOTO_READ_CONCURRENCY }
): Promise<Record<string, { src: string; alt: string }>> {
  const entries = [...docs].filter(([, d]) => PHOTO_TYPES.has(d.contentType) && !!d.blobKey && !(d.size > caps.perImage));
  const bytes: Array<Uint8Array | null> = entries.map(() => null);
  for (let i = 0; i < entries.length; i += caps.concurrency) {
    await Promise.all(
      entries.slice(i, i + caps.concurrency).map(async ([sku, d], j) => {
        try {
          const b = await read(d.blobKey as string, caps.perImage);
          if (b && b.byteLength <= caps.perImage) bytes[i + j] = b;
          else console.warn("[narrative] key-product photo skipped (missing or over 3 MB)", sku, d.id);
        } catch (e) {
          console.warn("[narrative] key-product photo unreadable", sku, d.id, e instanceof Error ? e.message : e);
        }
      })
    );
  }
  const out: Record<string, { src: string; alt: string }> = {};
  let total = 0;
  entries.forEach(([sku, d], i) => {
    const b = bytes[i];
    if (!b) return;
    if (total + b.byteLength > caps.total) {
      console.warn("[narrative] key-product photo skipped (document photo budget reached)", sku, d.id);
      return;
    }
    total += b.byteLength;
    out[sku] = { src: `data:${d.contentType};base64,${Buffer.from(b).toString("base64")}`, alt: d.title || sku };
  });
  return out;
}

/** The print route's call: sku → { src: data URI, alt }. Never throws. */
export async function keyProductPhotoDataUris(sections: SpecSection[]): Promise<Record<string, { src: string; alt: string }>> {
  try {
    return await inlinePhotos(await keyProductPhotoDocs(sections), readBlobCapped);
  } catch (e) {
    console.warn("[narrative] key-product photos unavailable", e instanceof Error ? e.message : e);
    return {};
  }
}
```

- [ ] **Step 7: Create `src/app/(app)/estimator/narrative-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { saveProductParagraph } from "@/lib/stores/catalog";
import { deleteIntro, upsertIntro } from "@/lib/stores/narrative-intros";
import { keyProductLibrary } from "@/lib/narrative/library";
import { MAX_LIBRARY_SKUS, type KeyProductLibraryRow, type ParagraphSaveResponse } from "./narrative";
import type { SystemIntro } from "@/lib/narrative/intros";

/**
 * #293 — the narrative column's server actions. Reads need a session; every
 * library write needs Create (the Spec panel's audience, #205) and answers
 * with a message rather than requirePerm's redirect, so the column can say
 * "Needs the Create permission". Editing a quote never writes the library:
 * these are the only paths in.
 */

export type IntroWriteResponse = { ok: true; intros: SystemIntro[]; id: string | null } | { ok: false; error: string };

const NEEDS_CREATE = "Needs the Create permission.";

/** Per-sku library rows for the active system (≤ 200 skus). */
export async function keyProductLibraryAction(skus: string[]): Promise<Record<string, KeyProductLibraryRow>> {
  await requireUser();
  return keyProductLibrary(Array.isArray(skus) ? skus.slice(0, MAX_LIBRARY_SKUS) : []);
}

/** "Save to library" / the part editor's Narrative paragraph. */
export async function saveProductParagraphAction(sku: string, text: string, expectUpdatedAt?: number | null): Promise<ParagraphSaveResponse> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };
  const res = await saveProductParagraph(String(sku || ""), String(text ?? ""), user.name, {
    expectUpdatedAt: expectUpdatedAt === undefined ? undefined : typeof expectUpdatedAt === "number" ? expectUpdatedAt : null,
  });
  if (!res.ok) return res;
  revalidatePath("/catalog");
  const rows = await keyProductLibrary([res.part.sku]);
  return { ok: true, row: rows[res.part.sku] };
}

export async function upsertSystemIntroAction(input: { id?: string | null; title: string; text: string }): Promise<IntroWriteResponse> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };
  const res = await upsertIntro(input, user.name);
  return res.ok ? { ok: true, intros: res.list, id: res.id } : { ok: false, error: res.error };
}

export async function deleteSystemIntroAction(id: string): Promise<IntroWriteResponse> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };
  const res = await deleteIntro(String(id || ""), user.name);
  return res.ok ? { ok: true, intros: res.list, id: null } : { ok: false, error: res.error };
}
```

- [ ] **Step 8: Sanitize `keyProducts` on every server entry in `actions.ts`.** In
`src/app/(app)/estimator/actions.ts`, add `withSanitizedKeyProducts` to the imports:

```ts
import { withSanitizedKeyProducts } from "./narrative";
```

In `saveQuoteAction`, replace

```ts
  const sellSanitized = Array.isArray(payload.sections) ? payload.sections.map(sanitizeSystemSell) : payload.sections;
```

with

```ts
  // #293: key-product blocks are shape-cleaned server-side whatever the client posts.
  const sellSanitized = Array.isArray(payload.sections) ? payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts) : payload.sections;
```

In `moveSystemToEstimateAction`, replace

```ts
  const [moved] = withoutRewardCredit([{ ...sanitizeSystemSell(section), id: "sys" + Date.now() }]);
```

with

```ts
  // #293: blocks travel as-is (ids are kept) — sanitized like a save.
  const [moved] = withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + Date.now() })]);
```

In `copySystemToEstimateAction`, add this as the first statement after `const user = await requireUser();`:

```ts
  // #293: blocks ride copySectionForTarget's section spread — sanitized first.
  section = withSanitizedKeyProducts(section);
```

- [ ] **Step 9: Run the gates**

```bash
npx tsc --noEmit
LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG" | head -20
npx eslint src/lib/stores/catalog.ts src/lib/stores/narrative-intros.ts src/lib/narrative/library.ts src/lib/narrative/photos.ts "src/app/(app)/estimator/narrative-actions.ts" "src/app/(app)/estimator/actions.ts"
```

Expected: tsc 0; test:specs 0 FAIL, with PASS = Task 1's count + this task's (about 30); eslint 0 errors. If the #267
checks fail, an existing `actions.ts` substring was altered. Restore it exactly (see Global Constraints).

- [ ] **Step 10: Commit**

```bash
git add src/lib/stores/catalog.ts src/lib/stores/narrative-intros.ts src/lib/narrative/library.ts src/lib/narrative/photos.ts "src/app/(app)/estimator/narrative-actions.ts" "src/app/(app)/estimator/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 product paragraphs, intros store, key-product library + photos, save sanitization\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: Printing — QuoteDocument blocks + photos + appendix, print route, Show-on-PDF toggle

**Files:**
- Create: `scripts/qd293-cases.ts`, `scripts/qd293-baseline.ts`
- Create: `docs/superpowers/fixtures/293-quote-document-baseline.json`. It's generated **before** any edit to
  `quote-document.tsx`.
- Create: `src/app/(app)/estimator/quote-document-view.ts`
- Modify: `src/app/(app)/estimator/quote-document.tsx` (props ~22–74, `QUOTE_PRINT_CSS` ~78–86, `previewSections`
  ~119–208, the sections loop ~390–562, between terms/acceptance and the footer ~797–799)
- Modify: `src/app/print/quote/[id]/page.tsx`
- Modify: `src/app/(app)/estimator/preview-doc.tsx` (`PdfToggle` :58, `PreviewProps`, the buttons ~162–170)
- Modify: `src/app/(app)/estimator/estimator-client.tsx` (the pdf state ~610–621 and the `<PreviewDoc …>` props
  ~4118–4147)
- Test: `scripts/test-review-and-spec.ts`. Append block `#293 slice 1 — printing`.

**Interfaces:**
- Consumes:
  - Task 1: `printableKeyProducts`, `PrintableKeyProduct`, and `pdfItemizedAppendix` in `QuotePdfOptions`.
  - Task 2: `keyProductPhotoDataUris(sections)`.
- Produces:
  - `QuoteDocumentProps.pdfItemizedAppendix: boolean` and
    `QuoteDocumentProps.keyProductPhotos?: Record<string, { src: string; alt: string }>`.
  - `quote-document-view.ts`: `appendixSystemIds(sections: SpecSection[], detail: "itemized" | "sectioned"): string[]`.
  - `PdfToggle` includes `"pdfItemizedAppendix"`, and `PreviewProps.pdfItemizedAppendix: boolean`.
  - `scripts/qd293-cases.ts`: `qd293Sections()`, `qd293Props(opts)`, `qd293Cases()`, `quoteDocumentModule293()` and
    `renderQuoteDocument293(props)`. These render `QuoteDocument` in Node by stubbing the `.jpg` import through
    `require.extensions` and loading the module with `require`. A static import of a `.jpg` can't load in the harness.

- [ ] **Step 1: Confirm `quote-document.tsx` is untouched**, then create the render helper.

Run: `git diff --stat origin/main -- "src/app/(app)/estimator/quote-document.tsx"`. Expected: no output. If there is
output, stop and report it.

Create `scripts/qd293-cases.ts`:

```ts
/**
 * #293 — fixed QuoteDocument props + a Node renderer, shared by the
 * byte-for-byte baseline writer (scripts/qd293-baseline.ts) and the harness.
 * QuoteDocument imports a .jpg letterhead that Node can't load, so the module
 * is required lazily after a CJS `.jpg` stub is registered (tsx runs this
 * repo's scripts as CommonJS; `@/` aliases resolve through tsconfig).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type QuoteDocumentType from "@/app/(app)/estimator/quote-document";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

type DocModule = { default: typeof QuoteDocumentType; QUOTE_PRINT_CSS: string };
let mod: DocModule | null = null;

export function quoteDocumentModule293(): DocModule {
  if (mod) return mod;
  const ext = (require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions;
  if (!ext[".jpg"]) ext[".jpg"] = (m) => { m.exports = { __esModule: true, default: { src: "/_test/peak-letterhead.jpg", width: 1, height: 1 } }; };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require("@/app/(app)/estimator/quote-document") as DocModule;
  return mod;
}

export function renderQuoteDocument293(props: QuoteDocumentProps): string {
  const { default: QuoteDocument } = quoteDocumentModule293();
  return renderToStaticMarkup(createElement(QuoteDocument, props));
}

const AT = Date.UTC(2026, 9, 1, 15); // mid-day UTC: the same calendar date in every US zone
const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 2, unit: "ea", cost: 10, price: 25, ...extra } as SpecItem);

/** Four systems: itemized (comment, allowance, option, vendor line), narrative
 *  with intro, labor, and a narrative system with an empty intro. */
export function qd293Sections(): SpecSection[] {
  return [
    { id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 5, items: [line(1, { comment: "Customer note" }), line(2, { allowance: true }), line(3, { option: true }), line(4, { vendorQuoteId: "VQ-1" })] },
    { id: "s2", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "Intro para.\n\n- One\n- Two", items: [line(5), line(6)] },
    { id: "s3", name: "Install", kind: "labor", mfr: "", freightPct: 0, items: [line(7, { labor: true, sku: "LAB-INSTALL", unit: "hr" })] },
    { id: "s4", name: "Empty narrative", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "", items: [line(8)] },
  ];
}

export function qd293Props(opts: { sections?: SpecSection[]; pdfOptions?: Record<string, unknown> } = {}): QuoteDocumentProps {
  const quote = {
    id: "Q-293", name: "Narrative test", customer: "Walk-in", customerId: null, owner: "Pat Estimator", preparedBy: "",
    updatedAt: AT, createdAt: AT, revisions: [], quoteNote: "Cover note.", assumptions: "Assume access.", paymentTerms: "Net 30",
    spec: { sections: opts.sections ?? qd293Sections() },
    vendorQuotes: [{ id: "VQ-1", vendor: "Acme", quoteNumber: "Q9", description: "Motors", display: "itemized", lines: [{ id: 1, description: "Motor", qty: 2, unit: "ea", amount: 100 }], terms: "", notes: "", total: 100, includesFreight: false }],
    pdfOptions: { ...(opts.pdfOptions || {}) },
  };
  return quoteDocumentDataFor(quote as never, null, { companyName: "Peak Systems Group", logoDark: null });
}

/** The byte-for-byte cases: a quote with no key products and the appendix off. */
export function qd293Cases(): Record<string, QuoteDocumentProps> {
  return {
    itemized: qd293Props(),
    sectioned: qd293Props({ pdfOptions: { detail: "sectioned" } }),
    lean: qd293Props({ pdfOptions: { pdfQty: false, pdfPrices: false, pdfCover: false, pdfTerms: false } }),
  };
}
```

Create `scripts/qd293-baseline.ts`:

```ts
/** #293 — writes the pre-change QuoteDocument render the harness compares
 *  against. Run ONCE, before quote-document.tsx is edited:
 *    npx tsx scripts/qd293-baseline.ts
 *  Pure render; opens no database. */
import { mkdirSync, writeFileSync } from "node:fs";
import { qd293Cases, renderQuoteDocument293 } from "./qd293-cases";

const out = Object.fromEntries(Object.entries(qd293Cases()).map(([k, p]) => [k, renderQuoteDocument293(p)]));
mkdirSync("docs/superpowers/fixtures", { recursive: true });
writeFileSync("docs/superpowers/fixtures/293-quote-document-baseline.json", JSON.stringify(out, null, 1) + "\n");
console.log("wrote", Object.keys(out).length, "cases");
```

- [ ] **Step 2: Generate the baseline (it must come from the unmodified document)**

Run: `npx tsx scripts/qd293-baseline.ts`
Expected: `wrote 3 cases`. The JSON exists and each value starts with `<link rel="preload" as="image"`. Check it with
`head -c 300 docs/superpowers/fixtures/293-quote-document-baseline.json`.

Commit it now, so the baseline is provably pre-change:

```bash
git add scripts/qd293-cases.ts scripts/qd293-baseline.ts docs/superpowers/fixtures/293-quote-document-baseline.json
git commit -m "$(printf 'test(estimator): #293 QuoteDocument byte-for-byte baseline (pre-change render)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

- [ ] **Step 3: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 1 — printing: a quote without key products renders
   byte-for-byte as before; key products print with a photo floated right
   (narrative systems only); the Itemized appendix after the signature.
   ====================================================================== */
import { qd293Cases as p293Cases, qd293Props as p293Props, qd293Sections as p293Sections, quoteDocumentModule293 as p293Mod, renderQuoteDocument293 as p293Render } from "./qd293-cases";
import { appendixSystemIds as p293AppendixIds } from "@/app/(app)/estimator/quote-document-view";
{
  const base = JSON.parse(readFileSync(join(process.cwd(), "docs/superpowers/fixtures/293-quote-document-baseline.json"), "utf8")) as Record<string, string>;
  const cases = p293Cases();
  ok(Object.keys(cases).length === 3 && Object.keys(cases).every((k) => typeof base[k] === "string"), "#293 print: every baseline case is in the committed fixture");
  for (const [k, props] of Object.entries(cases)) ok(p293Render(props) === base[k], `#293 print: a quote without key products renders byte-for-byte as before (${k})`);

  // Key products in a narrative system.
  const secs = p293Sections();
  secs[1].keyProducts = [
    { lineKey: "5", sku: "SKU-5", text: "Para five.\n\n- Bright\n- Even", photo: true },
    { lineKey: "6", sku: "SKU-6", text: "", photo: true },
    { lineKey: "99", sku: "GONE", text: "Never prints", photo: true },
  ];
  secs[0].keyProducts = [{ lineKey: "1", sku: "SKU-1", text: "Itemized never prints me", photo: true }];
  secs[3].keyProducts = [{ lineKey: "8", sku: "SKU-8", text: "Eight.", photo: false }];
  const html = p293Render({ ...p293Props({ sections: secs }), keyProductPhotos: { "SKU-5": { src: "data:image/png;base64,QUFB", alt: "Five" }, "SKU-1": { src: "data:image/png;base64,WFhY", alt: "One" }, "SKU-8": { src: "data:image/png;base64,ODg4", alt: "Eight" } } });
  ok((html.match(/class="est-kp"/g) || []).length === 3, "#293 print: one est-kp block per resolved key product of a narrative system (a removed line's block is skipped)");
  ok(!html.includes("Itemized never prints me") && !html.includes("Never prints"), "#293 print: an itemized system's blocks and unresolved blocks never print");
  ok(html.includes('src="data:image/png;base64,QUFB"') && /float:right;width:34%/.test(html) && (html.match(/<img[^>]+src="data:image/g) || []).length === 1,
    "#293 print: the photo floats right beside its paragraph; a block with no photo src or photo off prints full width");
  ok(html.includes("Para five.") && html.includes("<li>Bright</li>") && html.includes(">Line 6</div>") && html.includes("Intro para."), "#293 print: intro first, then each heading + paragraph blocks; empty text prints the heading only");
  ok(!html.includes("System scope and pricing are included in the total above.") && base.itemized.includes("System scope and pricing are included in the total above."),
    "#293 print: a narrative system with key products drops the fallback sentence");

  // Itemized appendix.
  const band = (h: string, name: string) => (h.match(new RegExp(`>${name}</span>`, "g")) || []).length;
  const on = p293Render(p293Props({ pdfOptions: { pdfItemizedAppendix: true } }));
  ok(on.includes('class="est-appendix"') && on.includes("Appendix — Itemized bill of materials"), "#293 appendix: the toggle prints the appendix heading");
  ok(on.indexOf("Appendix — Itemized") > on.indexOf("Signature — accepted for") && on.indexOf("Appendix — Itemized") < on.indexOf("Questions? Reach out to"),
    "#293 appendix: after the signature block, before the footer");
  ok(band(on, "Lighting") === 2 && band(on, "Empty narrative") === 2 && band(on, "Rigging") === 1 && band(on, "Install") === 1 && on.includes("Line 5") && on.includes("Line 8"),
    "#293 appendix (itemized detail): only the narrative systems repeat, with their lines");
  ok(JSON.stringify(p293Props({ pdfOptions: { pdfItemizedAppendix: true } }).t) === JSON.stringify(p293Props().t) && on.split("Total investment").length === base.itemized.split("Total investment").length,
    "#293 appendix: totals are unchanged (the appendix restates, never adds)");
  const secOn = p293Render(p293Props({ pdfOptions: { detail: "sectioned", pdfItemizedAppendix: true } }));
  ok(band(secOn, "Rigging") === 2 && band(secOn, "Install") === 2 && secOn.includes("Installation, commissioning &amp; project management"),
    "#293 appendix (by section): every system is listed; a labor system prints the body's single row");
  const noDesc = p293Render(p293Props({ pdfOptions: { pdfNotes: false, pdfItemizedAppendix: true } }));
  ok(noDesc.includes(">Line 5</span>"), "#293 appendix: descriptions always print in the appendix, even with Descriptions off");
  const onlyItemized = p293Sections().filter((s) => s.presentation !== "narrative");
  ok(!p293Render(p293Props({ sections: onlyItemized, pdfOptions: { pdfItemizedAppendix: true } })).includes("est-appendix"), "#293 appendix: nothing the body left out → no appendix");
  ok(!base.itemized.includes("est-appendix"), "#293 appendix: off by default");

  // Pure helper + print CSS.
  const ids = (sections: ReturnType<typeof p293Sections>, d: "itemized" | "sectioned") => p293AppendixIds(sections, d).join(",");
  const withEmpty = [...p293Sections(), { id: "s5", name: "No revenue", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative" as const, items: [] }];
  ok(ids(withEmpty, "itemized") === "s2,s4" && ids(withEmpty, "sectioned") === "s1,s2,s3,s4", "#293 appendixSystemIds: narrative systems under itemized; every system under by-section; revenue-less systems skipped");
  const css = p293Mod().QUOTE_PRINT_CSS;
  ok(css.includes(".est-doc .est-kp { break-inside: avoid; page-break-inside: avoid; }") && css.includes(".est-doc .est-appendix { break-before: page; page-break-before: always; }"),
    "#293 print CSS: a key-product block keeps together; the appendix starts a new page");

  // Wiring (source).
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const qd = rd("src/app/(app)/estimator/quote-document.tsx");
  ok(qd.includes("printableKeyProducts(sec)") && qd.includes("<ItemizedLines") && qd.includes("function ItemizedLines(") && !/internalNote/.test(qd),
    "#293 QuoteDocument: blocks come from printableKeyProducts; body and appendix share ItemizedLines; never names internalNote");
  const pr = rd("src/app/print/quote/[id]/page.tsx");
  ok(pr.includes("keyProductPhotoDataUris(") && pr.includes("keyProductPhotos={keyProductPhotos}"), "#293 print route: passes the inlined key-product photos");
  const pd = rd("src/app/(app)/estimator/preview-doc.tsx");
  ok(pd.includes('p.togglePdf("pdfItemizedAppendix")') && pd.includes('"Itemized appendix"') && pd.includes("Print every narrative system's full line list after the signature"),
    "#293 preview: Show on PDF offers the Itemized appendix toggle");
  ok(/detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix/.test(rd("src/app/(app)/estimator/estimator-client.tsx")),
    "#293 estimator: the appendix choice is saved with pdfOptions");
}
```

- [ ] **Step 4: Run tsc and watch it fail**

Run: `npx tsc --noEmit 2>&1 | head`
Expected: `Cannot find module '@/app/(app)/estimator/quote-document-view'`. An excess-property error on
`keyProductPhotos` is also possible.

- [ ] **Step 5: Create `src/app/(app)/estimator/quote-document-view.ts`**

```ts
import { systemFreight, systemItemsRev, systemSellTotal } from "./pricing";
import type { SpecSection } from "./types";

/**
 * #293 — QuoteDocument's pure view helpers, kept out of quote-document.tsx
 * (which imports a .jpg the Node harness can't load). The printed-systems
 * predicate is QuoteDocument's own `previewSections` filter, verbatim.
 */

/** Systems whose lines the body didn't itemize — every narrative system, or
 *  every system when the document prints by section — among those the body
 *  prints at all (some revenue). The Itemized appendix lists exactly these. */
export function appendixSystemIds(sections: SpecSection[], detail: "itemized" | "sectioned"): string[] {
  return (sections || [])
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0 || systemSellTotal(sec) > 0)
    .filter((sec) => detail === "sectioned" || (sec.presentation || "itemized") === "narrative")
    .map((sec) => sec.id);
}
```

- [ ] **Step 6: Edit `quote-document.tsx`.** Make every change below exactly. **Do not edit the two existing
`./pricing` import lines.**

(a) Imports. Replace `import { narrativeBlocks } from "./narrative";` with:

```ts
import { narrativeBlocks, printableKeyProducts, type NarrativeBlock } from "./narrative";
import { appendixSystemIds } from "./quote-document-view";
```

(b) Props. Add these at the end of `QuoteDocumentProps`, after `rewardsLine?: string;`:

```ts
  /** #293 — Show on PDF → Itemized appendix: every system the body didn't
   *  itemize prints again, in full, after the signature (totals unchanged). */
  pdfItemizedAppendix: boolean;
  /** #293 — sku → the photo a key product prints beside its paragraph. The
   *  print route inlines data URIs (it has no session); absent = no photos. */
  keyProductPhotos?: Record<string, { src: string; alt: string }>;
```

(c) Print CSS. Append two lines inside the `QUOTE_PRINT_CSS` template literal, after the
`.est-doc .est-line, …` line:

```
.est-doc .est-kp { break-inside: avoid; page-break-inside: avoid; }
.est-doc .est-appendix { break-before: page; page-break-before: always; }
```

(d) Module-level helpers. Add these just above `export default function QuoteDocument`. The markup is the current
markup **verbatim**, with only the variable names changed.

```tsx
type DocLine = {
  key: string;
  desc: string;
  comment: string;
  showComment: boolean;
  sub: { key: string; qty: number; unit: string; text: string }[];
  qty: string | number;
  unit: string;
  ext: string;
};

/** #281 blocks — blank line = paragraph, "- " = bullet, single breaks kept. */
function renderNarrativeBlocks(blocks: NarrativeBlock[]) {
  return blocks.map((b, bi) =>
    b.kind === "ul" ? (
      <ul key={bi} style={{ margin: bi ? "6px 0 0" : 0, paddingLeft: 18, listStyleType: "disc" }}>
        {b.items.map((it, ii) => (
          <li key={ii}>{it}</li>
        ))}
      </ul>
    ) : (
      <p key={bi} style={{ margin: bi ? "6px 0 0" : 0 }}>
        {b.lines.map((ln, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {ln}
          </Fragment>
        ))}
      </p>
    )
  );
}

/** The dark system band (number · name · subtotal) — body and appendix. */
function SectionBand({ num, name, subtotalLabel }: { num: number; name: string; subtotalLabel: string }) {
  return (
    <div
      className="est-secband"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        background: "#16181d",
        color: "#fff",
        padding: "8px 13px 8px 10px",
        borderRadius: 4,
        borderLeft: "4px solid var(--accent)",
        marginBottom: 2,
        marginTop: 14,
      }}
    >
      <span style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            opacity: 0.65,
            flexShrink: 0,
          }}
        >
          {String(num).padStart(2, "0")}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, flexShrink: 0 }}>
        {subtotalLabel}
      </span>
    </div>
  );
}

/** One system's itemized lines + freight row — the body's itemized view and
 *  the #293 appendix share it so they can't drift. `showDesc` is the
 *  Descriptions toggle in the body and always true in the appendix. */
function ItemizedLines(props: {
  lines: DocLine[];
  hasFreight: boolean;
  freightLabel: string;
  freightRowLabel: string;
  showDesc: boolean;
  pdfQty: boolean;
  pdfPrices: boolean;
  lineCols: string;
}) {
  const { lines, hasFreight, freightLabel, freightRowLabel, showDesc, pdfQty, pdfPrices, lineCols } = props;
  return (
    <div style={{ marginBottom: 6 }}>
      {lines.map((ln) => (
        <div
          key={ln.key}
          className="est-line"
          style={{
            display: "grid",
            gridTemplateColumns: lineCols,
            gap: 8,
            padding: "8px 13px 6px",
            fontSize: 12.5,
            borderBottom: "1px solid #f0f1f4",
            alignItems: "center",
          }}
        >
          {showDesc && <span>
            {ln.desc}
            {ln.showComment && (
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#8c919c",
                  marginTop: 2,
                  lineHeight: 1.35,
                }}
              >
                {ln.comment}
              </span>
            )}
            {ln.sub.map((sl) => (
              <span
                key={sl.key}
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#8c919c",
                  marginTop: 2,
                  paddingLeft: 12,
                  lineHeight: 1.35,
                }}
              >
                {pdfQty && (
                  <span style={{ fontFamily: "var(--font-mono)", marginRight: 6 }}>
                    {sl.qty} {sl.unit}
                  </span>
                )}
                {sl.text}
              </span>
            ))}
          </span>}
          {pdfQty && (
            <span
              style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}
            >
              {ln.qty} {ln.unit}
            </span>
          )}
          {pdfPrices && (
            <span
              style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
            >
              {ln.ext}
            </span>
          )}
        </div>
      ))}
      {hasFreight && (showDesc || pdfPrices) && (
        <div
          className="est-line"
          style={{
            display: "grid",
            gridTemplateColumns: lineCols,
            gap: 8,
            padding: "8px 13px 6px",
            fontSize: 12.5,
            borderBottom: "1px solid #f0f1f4",
            alignItems: "center",
            color: "#5b616e",
          }}
        >
          {showDesc && <span>{freightRowLabel}</span>}
          {pdfQty && <span></span>}
          {pdfPrices && (
            <span
              style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
            >
              {freightLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

This is the current body markup (quote-document.tsx ~453–545), moved as-is. Only the identifiers are renamed:
- `p.pdfNotes` → `showDesc`, `p.pdfQty` → `pdfQty`, `p.pdfPrices` → `pdfPrices`;
- `ps.lines` → `lines`, `ps.hasFreight` → `hasFreight`, `ps.freightLabel` → `freightLabel`.

Before you delete the old inline copy in step (f), diff it against this one. Every `style={{…}}` object and every
element must stay character-for-character the same. The byte-for-byte check proves it.

(e) `previewSections`. Inside the `.map((sec, i) => { … return { … } })`, add one field to the returned object after
`presentation: sec.presentation || "itemized",`:

```ts
        // #293: resolved key-product blocks (printed in Narrative only).
        keyProducts: printableKeyProducts(sec),
```

Below `const inclusions = inclusionsLine(p.t);`, add:

```ts
  // #293: the Itemized appendix — the systems the body left un-itemized.
  const appendixIds = p.pdfItemizedAppendix ? new Set(appendixSystemIds(p.sections, p.detail)) : null;
  const appendixSections = appendixIds ? previewSections.filter((ps) => appendixIds.has(ps.id)) : [];
  const appendixCols = ["1fr", p.pdfQty ? "70px" : "", p.pdfPrices ? "104px" : ""].filter(Boolean).join(" ");
```

(f) The sections loop. Replace the whole inline `<div className="est-secband" …> … </div>` band with:

```tsx
              <SectionBand num={ps.num} name={ps.name} subtotalLabel={ps.subtotalLabel} />
```

Replace the narrative branch's inner IIFE, everything inside the `<div style={{ padding: "10px 13px 12px", … }}>`, with:

```tsx
                  {/* #281: blank line = paragraph, "- " = bullet, single breaks kept.
                      #293: then each key product — heading, paragraph, photo floated right. */}
                  {(() => {
                    const blocks = narrativeBlocks(ps.narrative);
                    if (!blocks.length && !ps.keyProducts.length) return "System scope and pricing are included in the total above.";
                    return (
                      <>
                        {renderNarrativeBlocks(blocks)}
                        {ps.keyProducts.map((kp, ki) => {
                          const photo = kp.photo ? p.keyProductPhotos?.[kp.sku] : undefined;
                          return (
                            <div key={"kp-" + kp.sku} className="est-kp" style={{ display: "flow-root", marginTop: blocks.length || ki ? 12 : 0 }}>
                              {photo ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={photo.src}
                                    alt={photo.alt}
                                    style={{ float: "right", width: "34%", maxHeight: "2.4in", objectFit: "contain", margin: "0 0 8px 14px" }}
                                  />
                                </>
                              ) : null}
                              <div style={{ fontWeight: 600, color: "#16181d", marginBottom: kp.blocks.length ? 3 : 0 }}>{kp.heading}</div>
                              {renderNarrativeBlocks(kp.blocks)}
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
```

Replace the itemized branch `isItemized && showLines ? ( <div style={{ marginBottom: 6 }}> … </div> )` with:

```tsx
              ) : isItemized && showLines ? (
                <ItemizedLines
                  lines={ps.lines}
                  hasFreight={ps.hasFreight}
                  freightLabel={ps.freightLabel}
                  freightRowLabel={freightRowLabel}
                  showDesc={p.pdfNotes}
                  pdfQty={p.pdfQty}
                  pdfPrices={p.pdfPrices}
                  lineCols={lineCols}
                />
```

(g) The appendix. Insert it between the closing `)}` of `{p.pdfTerms && ( <> … </> )}` and `{/* footer */}`:

```tsx
            {/* #293: Itemized appendix — restates, never adds to the totals. */}
            {appendixSections.length > 0 && (
              <div className="est-appendix" style={{ marginTop: 22 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#16181d", marginBottom: 2 }}>
                  Appendix — Itemized bill of materials
                </div>
                {appendixSections.map((ps) => (
                  <div key={"apx-" + ps.num + ps.name}>
                    <SectionBand num={ps.num} name={ps.name} subtotalLabel={ps.subtotalLabel} />
                    <ItemizedLines
                      lines={ps.lines}
                      hasFreight={ps.hasFreight}
                      freightLabel={ps.freightLabel}
                      freightRowLabel={freightRowLabel}
                      showDesc
                      pdfQty={p.pdfQty}
                      pdfPrices={p.pdfPrices}
                      lineCols={appendixCols}
                    />
                  </div>
                ))}
              </div>
            )}
```

- [ ] **Step 7: Wire the print route.** In `src/app/print/quote/[id]/page.tsx`, add the import:

```ts
import { keyProductPhotoDataUris } from "@/lib/narrative/photos";
```

Then replace the `return ( <main> … </main> );` with:

```tsx
  const doc = quoteDocumentDataFor(q, cust, settings);
  // #293: key-product photos inlined as data URIs (this route has no session).
  // Never throws — a photo that can't be read just isn't printed.
  const keyProductPhotos = await keyProductPhotoDataUris(doc.sections);
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      <QuoteDocument {...doc} keyProductPhotos={keyProductPhotos} rewardsLine={purchasePerksDocLine(perks)} />
    </main>
  );
```

- [ ] **Step 8: Add the preview toggle.** In `src/app/(app)/estimator/preview-doc.tsx`:

```ts
export type PdfToggle = "pdfQty" | "pdfNotes" | "pdfPrices" | "pdfCover" | "pdfTerms" | "pdfOptions" | "pdfItemizedAppendix";
```

In `PreviewProps`, add `pdfItemizedAppendix: boolean;` after `pdfOptions: boolean;`. Between the Options button and the
Terms button, insert:

```tsx
            <button
              type="button"
              onClick={() => p.togglePdf("pdfItemizedAppendix")}
              style={p.pdfItemizedAppendix ? segOn : segOff}
              title="Print every narrative system's full line list after the signature"
            >
              {(p.pdfItemizedAppendix ? "✓ " : "") + "Itemized appendix"}
            </button>
```

In `src/app/(app)/estimator/estimator-client.tsx`, below `const [pdfPrices, setPdfPrices] = …`, add:

```ts
  const [pdfItemizedAppendix, setPdfItemizedAppendix] = useState(initial.pdfOptions.pdfItemizedAppendix);
```

Change the `pdfOpts` memo to:

```ts
  const pdfOpts = useMemo<QuotePdfOptions>(
    () => ({ detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix }),
    [detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix]
  );
```

In `<PreviewDoc …>`, add `pdfItemizedAppendix={pdfItemizedAppendix}` after `pdfOptions={pdfOptions}`. In `togglePdf`,
insert `else if (flag === "pdfItemizedAppendix") setPdfItemizedAppendix((v) => !v);` before the final
`else setPdfTerms((v) => !v);`.

- [ ] **Step 9: Run the gates**

```bash
npx tsc --noEmit
LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG" | head -20
npx eslint "src/app/(app)/estimator/quote-document.tsx" "src/app/(app)/estimator/quote-document-view.ts" "src/app/print/quote/[id]/page.tsx" "src/app/(app)/estimator/preview-doc.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/qd293-cases.ts scripts/qd293-baseline.ts
```

Expected: tsc 0; test:specs 0 FAIL, with PASS = Task 2's count + about 22; eslint 0 errors.

If a byte-for-byte case fails, the extraction changed the markup. Diff it like this:

```bash
npx tsx -e 'const c=require("./scripts/qd293-cases");const b=require("./docs/superpowers/fixtures/293-quote-document-baseline.json");const a=c.renderQuoteDocument293(c.qd293Cases().itemized);let i=0;while(a[i]===b.itemized[i])i++;console.log(i,"\n",b.itemized.slice(i-80,i+80),"\n---\n",a.slice(i-80,i+80))'
```

Fix the markup. **Never regenerate the baseline after editing `quote-document.tsx`.**

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/estimator/quote-document.tsx" "src/app/(app)/estimator/quote-document-view.ts" "src/app/print/quote/[id]/page.tsx" "src/app/(app)/estimator/preview-doc.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 print key products with photos + Itemized appendix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: Estimator key-products UI — ★, narrative column cards, library hook, Copy-here remap

**Files:**
- Create: `src/app/(app)/estimator/use-key-product-library.ts`
- Create: `src/app/(app)/estimator/narrative-column.tsx`
- Modify: `src/app/(app)/estimator/section-card.tsx` (props ~140–183; the row map ~880–1322)
- Modify: `src/app/(app)/estimator/estimator-client.tsx`:
  - the CSS block ~182–184;
  - the props destructure ~400–426;
  - `cols` ~825–827;
  - Copy here ~1660–1665;
  - after `narrSec` ~2462;
  - `<SectionCard>` ~3719–3800;
  - the narrative `<aside>` contents ~3874–3924.
- Modify: `src/app/(app)/estimator/types.ts` (`EstimatorProps`)
- Modify: `src/app/(app)/estimator/page.tsx` (the `<EstimatorClient>` props)
- Test: `scripts/test-review-and-spec.ts`. Append block `#293 slice 1 — key-products UI`.

**Interfaces:**
- Consumes:
  - Task 1: `keyProductStar`, `toggleKeyProduct`, `markKeyProduct`, `moveKeyProduct`, `removeKeyProduct`,
    `patchKeyProduct`, `reanchorKeyProduct`, `unmarkedEligibleLines`, `resolveKeyProducts`, `keyProductChip`,
    `KEY_PRODUCT_CHIP_LABEL`, `MAX_KEY_PRODUCTS`, `MAX_PARAGRAPH`, `MAX_LIBRARY_SKUS`, `isKeyProductEligible`,
    `remapKeyProducts`, `withKeyProducts`, `KeyProductLibraryRow`.
  - Task 2: `keyProductLibraryAction`, `saveProductParagraphAction`.
- Produces:
  - `use-key-product-library.ts`:
    - `export type KeyProductLibrary = { rows: Record<string, KeyProductLibraryRow>; ensure(skus: string[]): Promise<Record<string, KeyProductLibraryRow>>; setRow(sku: string, row: KeyProductLibraryRow): void }`;
    - `export function useKeyProductLibrary(activeSkus: string[]): KeyProductLibrary`.
  - `narrative-column.tsx`: `export type NarrativeColumnProps = { sec; narrRef; onChange(fn); library; canWriteLibrary }`
    and `export default function NarrativeColumn`. Task 5 extends these props with `intros` and `onIntros`.
  - `SectionCardProps.onToggleKeyProduct: (itemId: number) => void`.
  - `EstimatorProps.canWriteNarrativeLibrary: boolean`.

- [ ] **Step 1: Write the failing harness block (source checks).** Append:

```ts
/* ======================================================================
   #293 slice 1 — key-products UI wiring (client components; proven by
   source like the other client checks — React isn't mounted here).
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const clientImportsServer = (s: string) => /^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/narrative\/(library|photos))/m.test(s);
  const col = rd("src/app/(app)/estimator/narrative-column.tsx");
  const hook = rd("src/app/(app)/estimator/use-key-product-library.ts");
  const card = rd("src/app/(app)/estimator/section-card.tsx");
  const cli = rd("src/app/(app)/estimator/estimator-client.tsx");
  ok(/^"use client";/.test(col) && /^"use client";/.test(hook) && !clientImportsServer(col) && !clientImportsServer(hook) && !clientImportsServer(card),
    "#293 UI: the column and the library hook are client modules that import no store or server-only module");
  ok(hook.includes("keyProductLibraryAction(") && hook.includes("MAX_LIBRARY_SKUS"), "#293 UI: the hook reads library rows through keyProductLibraryAction, ≤ 200 skus");
  ok(card.includes("onToggleKeyProduct: (itemId: number) => void;") && card.includes("keyProductStar(sec, it)") && card.includes("Key product — featured in the narrative"),
    "#293 UI: each eligible line row has the ★ toggle with the spec's title");
  ok(col.includes("Line removed — this block won't print") && col.includes("— this block won't print") && col.includes("Optional/labor line — won't print") && col.includes("Re-anchor"),
    "#293 UI: unresolved blocks show their strips (removed / changed + Re-anchor / ineligible)");
  ok(col.includes("Save to library") && col.includes("Use library text") && col.includes("Replace the library paragraph for") && col.includes("changed since you loaded it") && !col.includes("window.confirm"),
    "#293 UI: Save to library confirms inline before replacing and on a stale version (never window.confirm)");
  ok(col.includes("No photo — prints full width") && col.includes("/api/part-documents/") && col.includes("+ Key product"), "#293 UI: photo thumbnail + switch, the no-photo note, and the + Key product picker");
  ok(cli.includes("remapKeyProducts(res.section.keyProducts, idMap)") && cli.includes("<NarrativeColumn") && cli.includes("onToggleKeyProduct={(itemId) => toggleKeyProductLine(sec.id, itemId)}"),
    "#293 UI: Copy here remaps blocks to the new item ids; the column and ★ are wired");
  ok(rd("src/app/(app)/estimator/page.tsx").includes('canWriteNarrativeLibrary={can("create", user.roles)}'), "#293 UI: Save to library is offered per the Create permission");
}
```

- [ ] **Step 2: Run tsc and watch it fail**

Run: `npx tsc --noEmit 2>&1 | head -5 ; LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; grep '^FAIL ' "$LOG" | head`
Expected: tsc passes (the new block only reads files). test:specs fails with `ENOENT … narrative-column.tsx`, which
throws inside the block and stops the run. That counts as the failing state.

- [ ] **Step 3: Create `src/app/(app)/estimator/use-key-product-library.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_LIBRARY_SKUS, type KeyProductLibraryRow } from "./narrative";
import { keyProductLibraryAction } from "./narrative-actions";

/** #293 — the narrative column's per-sku library cache (paragraph, stamp,
 *  description, primary photo). Prefetches the ACTIVE system's eligible skus
 *  whenever that set changes, so a ★ click can copy the saved paragraph; the
 *  full catalog never ships to the client. */
export type KeyProductLibrary = {
  rows: Record<string, KeyProductLibraryRow>;
  /** Fetch any of `skus` not cached yet; resolves to the whole cache. */
  ensure: (skus: string[]) => Promise<Record<string, KeyProductLibraryRow>>;
  /** Replace one row (after Save to library). */
  setRow: (sku: string, row: KeyProductLibraryRow) => void;
};

export function useKeyProductLibrary(activeSkus: string[]): KeyProductLibrary {
  const [rows, setRows] = useState<Record<string, KeyProductLibraryRow>>({});
  const rowsRef = useRef(rows);

  const ensure = useCallback(async (skus: string[]) => {
    const missing = [...new Set(skus.map((s) => (s || "").trim()).filter(Boolean))]
      .filter((s) => !(s in rowsRef.current))
      .slice(0, MAX_LIBRARY_SKUS);
    if (!missing.length) return rowsRef.current;
    try {
      const got = await keyProductLibraryAction(missing);
      const next = { ...rowsRef.current, ...got };
      rowsRef.current = next;
      setRows(next);
      return next;
    } catch {
      return rowsRef.current; // offline / transient — the chips just stay blank
    }
  }, []);

  const setRow = useCallback((sku: string, row: KeyProductLibraryRow) => {
    const next = { ...rowsRef.current, [sku]: row };
    rowsRef.current = next;
    setRows(next);
  }, []);

  const key = [...new Set(activeSkus.map((s) => (s || "").trim()).filter(Boolean))].sort().join("\n");
  useEffect(() => {
    if (key) void ensure(key.split("\n"));
  }, [key, ensure]);

  return { rows, ensure, setRow };
}
```

- [ ] **Step 4: Create `src/app/(app)/estimator/narrative-column.tsx`.** The presentation select, the hint and the
textarea move here **verbatim** from `estimator-client.tsx` (~3874–3924). Then add the key-product cards and the picker.

```tsx
"use client";

import { useState, useTransition, type CSSProperties, type RefObject } from "react";
import type { SpecItem, SpecSection } from "./types";
import {
  KEY_PRODUCT_CHIP_LABEL,
  MAX_PARAGRAPH,
  keyProductChip,
  markKeyProduct,
  moveKeyProduct,
  patchKeyProduct,
  reanchorKeyProduct,
  removeKeyProduct,
  resolveKeyProducts,
  unmarkedEligibleLines,
  type KeyProductChip,
  type KeyProductResolution,
} from "./narrative";
import { saveProductParagraphAction } from "./narrative-actions";
import type { KeyProductLibrary } from "./use-key-product-library";

/**
 * #293 — the narrative column's body (the #281 aside keeps its header and
 * Hide button): presentation, the system Intro, and the key-product cards.
 * Every edit goes through `onChange(fn)` → the Estimator's setSections, so
 * the #254 re-price banner rule holds. Library writes happen ONLY on an
 * explicit Save to library, confirmed inline (window.confirm is a silent
 * "no" in the Capacitor shells).
 */

export type NarrativeColumnProps = {
  sec: SpecSection;
  narrRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (fn: (s: SpecSection) => SpecSection) => void;
  library: KeyProductLibrary;
  canWriteLibrary: boolean;
};

const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase" };
const HINT: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.4 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" };
const CHIP_TONE: Record<KeyProductChip, CSSProperties> = {
  needs: { background: "#fbf3dd", color: "#8a6d1f" },
  library: { background: "#e7f4ee", color: "#1f7a52" },
  edited: { background: "#eef0f3", color: "#3a3f4a" },
  custom: { background: "#f1f2f5", color: "#8c919c" },
};
const STRIP: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11.5, fontWeight: 600, color: "#b4543a", background: "#fbecea", borderRadius: 6, padding: "6px 8px" };
const ASK: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11.5, color: "#3a3f4a", background: "#fbf3dd", borderRadius: 6, padding: "6px 8px" };

export default function NarrativeColumn(p: NarrativeColumnProps) {
  const { sec } = p;
  const res = resolveKeyProducts(sec);
  const hasKps = res.length > 0;
  const pickable = unmarkedEligibleLines(sec);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
      <select
        value={sec.presentation || "itemized"}
        onChange={(e) => {
          const v = e.target.value as "itemized" | "narrative";
          p.onChange((s) => ({ ...s, presentation: v }));
        }}
        aria-label="Customer presentation"
        style={{ alignSelf: "flex-start", border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}
      >
        <option value="itemized">Customer: itemized</option>
        <option value="narrative">Customer: narrative</option>
      </select>
      {(sec.presentation || "itemized") === "itemized" && <div style={HINT}>Prints on the quote only in Narrative mode.</div>}
      <div style={LABEL}>Intro</div>
      <textarea
        ref={p.narrRef}
        className="est-field"
        aria-label={"Narrative for " + (sec.name || "this system")}
        value={sec.narrative || ""}
        onChange={(e) => {
          const v = e.target.value;
          p.onChange((s) => ({ ...s, narrative: v }));
        }}
        placeholder="Explain this system for the customer — what it is, what it does, what's included…"
        style={{
          flex: hasKps ? "none" : 1,
          minHeight: hasKps ? 140 : 240,
          width: "100%",
          resize: hasKps ? "vertical" : "none",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          lineHeight: 1.55,
          color: "#16181d",
          background: "#fff",
          border: "1px solid #e4e7ec",
          borderRadius: 8,
          padding: "10px 12px",
        }}
      />
      <div style={HINT}>Blank line = new paragraph · start a line with “- ” for a bullet</div>
      {hasKps && <div style={{ ...LABEL, marginTop: 4 }}>Key products</div>}
      {res.map((r, i) => (
        <KeyProductCard key={r.kp.lineKey + "|" + r.kp.sku} r={r} index={i} count={res.length} {...p} />
      ))}
      {pickable.length > 0 && (
        <select
          aria-label="Add a key product"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            const it = sec.items.find((x) => x.id === id);
            if (!it) return;
            const text = p.library.rows[it.sku.trim()]?.paragraph || "";
            p.onChange((s) => markKeyProduct(s, id, text));
          }}
          style={{ alignSelf: "flex-start", border: "1px dashed #d6d9e0", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}
        >
          <option value="">+ Key product…</option>
          {pickable.map((it) => (
            <option key={it.id} value={it.id}>
              {it.desc} · {it.sku}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function KeyProductCard(props: NarrativeColumnProps & { r: KeyProductResolution; index: number; count: number }) {
  const { r, index, count, onChange, library, canWriteLibrary } = props;
  const kp = r.kp;
  const item: SpecItem | undefined = r.status === "missing" ? undefined : r.item;
  const row = library.rows[kp.sku];
  const chip = keyProductChip(kp, row);
  const [ask, setAsk] = useState<null | "replace" | "stale">(null);
  const [stale, setStale] = useState<{ paragraph: string | null; updatedAt: number | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const doSave = (expect: number | null) =>
    start(async () => {
      setMsg("");
      const out = await saveProductParagraphAction(kp.sku, kp.text, expect);
      if (out.ok) {
        library.setRow(kp.sku, out.row);
        setAsk(null);
        setMsg("Saved to the library.");
      } else if (out.stale) {
        setStale(out.stale);
        setAsk("stale");
      } else {
        setAsk(null);
        setMsg(out.error);
      }
    });
  const onSave = () => {
    if (row?.paragraph != null && row.paragraph.trim() !== kp.text.trim()) setAsk("replace");
    else doSave(row?.paragraphUpdatedAt ?? null);
  };
  const saveTitle = !canWriteLibrary
    ? "Needs the Create permission"
    : row && !row.inCatalog
    ? "Only catalog parts have a library paragraph"
    : !kp.text.trim()
    ? "Write the paragraph first"
    : "Save this paragraph to the part — future quotes start from it";
  const canSave = canWriteLibrary && !!row?.inCatalog && !!kp.text.trim() && r.status === "ok";

  return (
    <div style={{ border: "1px solid #ececf0", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 7, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>{item?.desc || kp.sku}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8c919c" }}>{kp.sku}</div>
        </div>
        {chip && (
          <span style={{ ...CHIP_TONE[chip], fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{KEY_PRODUCT_CHIP_LABEL[chip]}</span>
        )}
      </div>

      {/* Copy as JS strings (not JSX text) so the apostrophe needs no &apos; — the harness matches it verbatim. */}
      {r.status === "missing" && (
        <div style={STRIP}>
          <span>{"Line removed — this block won't print"}</span>
          <button type="button" style={BTN} onClick={() => onChange((s) => removeKeyProduct(s, index))}>Remove</button>
        </div>
      )}
      {r.status === "changed" && (
        <div style={STRIP}>
          <span>{`Line changed to ${r.item.sku} — this block won't print`}</span>
          <button type="button" style={BTN} onClick={() => onChange((s) => reanchorKeyProduct(s, index))}>Re-anchor</button>
        </div>
      )}
      {r.status === "ineligible" && <div style={STRIP}><span>{"Optional/labor line — won't print"}</span></div>}

      {row?.photoDocId ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#5b616e" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={"/api/part-documents/" + encodeURIComponent(row.photoDocId)}
            alt=""
            style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 6, border: "1px solid #eef0f3", background: "#fff", opacity: kp.photo ? 1 : 0.4 }}
          />
          <input type="checkbox" checked={kp.photo} onChange={(e) => { const v = e.target.checked; onChange((s) => patchKeyProduct(s, index, { photo: v })); }} />
          Photo
        </label>
      ) : row ? (
        <div style={HINT}>No photo — prints full width</div>
      ) : null}

      <textarea
        className="est-field"
        aria-label={"Paragraph for " + (item?.desc || kp.sku)}
        value={kp.text}
        maxLength={MAX_PARAGRAPH}
        placeholder={row?.desc || item?.desc || ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange((s) => patchKeyProduct(s, index, { text: v }));
        }}
        style={{ minHeight: 90, width: "100%", resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" }}
      />

      {ask === "replace" && (
        <div style={ASK}>
          <span>Replace the library paragraph for {kp.sku}?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => doSave(row?.paragraphUpdatedAt ?? null)}>Replace</button>
          <button type="button" style={BTN} onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}
      {ask === "stale" && (
        <div style={ASK}>
          <span>The library paragraph changed since you loaded it — replace it anyway?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => doSave(stale?.updatedAt ?? null)}>Replace anyway</button>
          <button type="button" style={BTN} onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        <button type="button" style={BTN} disabled={index === 0} onClick={() => onChange((s) => moveKeyProduct(s, index, -1))} aria-label="Move up">↑</button>
        <button type="button" style={BTN} disabled={index === count - 1} onClick={() => onChange((s) => moveKeyProduct(s, index, 1))} aria-label="Move down">↓</button>
        <button type="button" style={{ ...BTN, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave || pending} title={saveTitle} onClick={onSave}>
          {pending ? "Saving…" : "Save to library"}
        </button>
        {chip === "edited" && row?.paragraph != null && (
          <button type="button" style={BTN} onClick={() => { const t = row.paragraph as string; onChange((s) => patchKeyProduct(s, index, { text: t })); }}>Use library text</button>
        )}
        <button type="button" style={{ ...BTN, color: "#b4543a" }} onClick={() => onChange((s) => removeKeyProduct(s, index))}>Remove</button>
      </div>
      {msg && <div style={{ ...HINT, color: msg.startsWith("Saved") ? "#1f7a52" : "#b4543a" }}>{msg}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Add the ★ to `section-card.tsx`.** Add an import below the existing imports:

```ts
import { MAX_KEY_PRODUCTS, keyProductStar } from "./narrative";
```

In `SectionCardProps`, add after `onRemoveItem: (id: number) => void;`:

```ts
  /** #293: ★ — mark / unmark this line as a key product (narrative block). */
  onToggleKeyProduct: (itemId: number) => void;
```

In the row map, add this next to `const ext = lineExtSellOf(it);`:

```ts
              const kpStar = keyProductStar(sec, it);
```

Change the row's `className="est-row"` to `className={"est-row" + (kpStar === "on" ? " est-row-kp" : "")}`. Inside
`<div className="est-actions" …>`, insert this immediately before the ↑ button:

```tsx
                    {kpStar !== "none" && (
                      <button
                        type="button"
                        className="est-action-btn"
                        onClick={() => p.onToggleKeyProduct(it.id)}
                        disabled={kpStar === "full" || kpStar === "dupSku"}
                        aria-pressed={kpStar === "on"}
                        title={
                          kpStar === "on"
                            ? "Key product — featured in the narrative"
                            : kpStar === "full"
                            ? `Up to ${MAX_KEY_PRODUCTS} key products per system`
                            : kpStar === "dupSku"
                            ? "This part is already a key product on another line"
                            : "Mark as a key product — feature it in the narrative"
                        }
                        style={{ ...ACTION_BTN, color: kpStar === "on" ? "var(--accent)" : ACTION_BTN.color, cursor: kpStar === "full" || kpStar === "dupSku" ? "not-allowed" : "pointer" }}
                      >
                        {kpStar === "on" ? "★" : "☆"}
                      </button>
                    )}
```

If `sec` isn't already a local in that scope, use `p.sec`. Line ~910 already uses `sec`, so it is in scope.

- [ ] **Step 6: Wire `estimator-client.tsx`.**

(a) Imports:

```ts
import NarrativeColumn from "./narrative-column";
import { useKeyProductLibrary } from "./use-key-product-library";
import { isKeyProductEligible, remapKeyProducts, toggleKeyProduct, withKeyProducts } from "./narrative";
```

(b) Destructure `canWriteNarrativeLibrary` in the `EstimatorClient({ … }: EstimatorProps)` parameter list, after
`viewerCanApprove,`.

(c) CSS. In the style block, add a line after `.est-row:hover .est-actions, …`:

```
.est-row-kp .est-actions { opacity: 1; }
```

(d) Widen the actions cell for the ★. Change `cols`:

```ts
  const cols = isInternal
    ? "minmax(150px,1.3fr) 104px 92px 136px 116px 104px"
    : "minmax(150px,1.3fr) 104px 136px 116px 84px";
```

Update the comment above it: "#293: +20px for the ★ key-product toggle."

(e) Right after `const narrSec = sections.find(...) || sections[0] || null;`, add:

```ts
  /** #293: the active system's eligible skus — the library cache prefetches them. */
  const narrSkus = useMemo(() => (narrSec ? narrSec.items.filter(isKeyProductEligible).map((it) => it.sku.trim()) : []), [narrSec]);
  const kpLib = useKeyProductLibrary(narrSkus);
  const updateSection = (secId: string, fn: (s: SpecSection) => SpecSection) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? fn(s) : s)));
  /** #293 ★: marking copies the saved paragraph when the library row is loaded. */
  const toggleKeyProductLine = (secId: string, itemId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((i) => i.id === itemId);
    const text = (it && kpLib.rows[it.sku.trim()]?.paragraph) || "";
    updateSection(secId, (s) => toggleKeyProduct(s, itemId, text));
  };
```

Check that no `return` sits between the component's other hooks and this point. A hook after a conditional return
would break the rules of hooks. If one does, move these lines above it.

(f) `<SectionCard …>`. Add after `onRemoveItem={removeItem}`:

```tsx
                  onToggleKeyProduct={(itemId) => toggleKeyProductLine(sec.id, itemId)}
```

(g) Copy here. In `copySystem`'s `if (res.kind === "same") {` branch, replace the `const copy: SpecSection = { … };`
statement with:

```ts
        // #293: item ids are re-minted, so key-product blocks follow them.
        const idMap = new Map<number, number>();
        const copyItems = res.section.items.map((it) => {
          const nid = nextId();
          idMap.set(it.id, nid);
          return { ...it, id: nid };
        });
        const copy: SpecSection = withKeyProducts(
          { ...res.section, id: newId, name: sec.name + " (copy)", items: copyItems },
          remapKeyProducts(res.section.keyProducts, idMap)
        );
```

(h) The column. Inside the open `<aside className="est-narr" …>`, replace the whole
`{narrSec ? ( <> …select…hint…textarea…hint… </> ) : ( …"Add a system to write its narrative."… )}` expression's
**first branch** with:

```tsx
                {narrSec ? (
                  <NarrativeColumn
                    sec={narrSec}
                    narrRef={narrRef}
                    onChange={(fn) => updateSection(narrSec.id, fn)}
                    library={kpLib}
                    canWriteLibrary={canWriteNarrativeLibrary}
                  />
                ) : (
```

Keep the existing `else` branch as it is. If `setSystemNarrative` is no longer referenced anywhere, delete it, because
eslint would flag it as unused. `setSystemPresentation` is still used by `PreviewDoc` and `SectionCard`.

- [ ] **Step 7: Add the prop type and the page prop.** In `src/app/(app)/estimator/types.ts` `EstimatorProps`, add after
`viewerCanApprove: boolean;`:

```ts
  /** #293 — may this user save product paragraphs / system intros (`create`)? */
  canWriteNarrativeLibrary: boolean;
```

In `src/app/(app)/estimator/page.tsx`, inside `<EstimatorClient …>`, add after `viewerCanApprove={…}`:

```tsx
      // #293: Save to library / intros — the Spec panel's audience (#205).
      canWriteNarrativeLibrary={can("create", user.roles)}
```

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit
LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG" | head -20
npx eslint "src/app/(app)/estimator/use-key-product-library.ts" "src/app/(app)/estimator/narrative-column.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx"
```

Expected: tsc 0; test:specs 0 FAIL, with PASS = Task 3's count + 8; eslint 0 errors.

Also strongly recommended, because this task adds client components (it only catches a client→server import):

```bash
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```

Expected: the build succeeds. A `Can't resolve 'fs'` error means a client file value-imports a store.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/estimator/use-key-product-library.ts" "src/app/(app)/estimator/narrative-column.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 key products — star, narrative column cards, Save to library, Copy remap\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 5: Intros + Draft narrative UI; catalog Narrative paragraph panel

**Files:**
- Create: `src/app/(app)/estimator/narrative-intros-modal.tsx`
- Modify: `src/app/(app)/estimator/narrative-column.tsx` (props + an intro row above the presentation select)
- Modify: `src/app/(app)/estimator/estimator-client.tsx` (the `narrativeIntros` prop → state → column)
- Modify: `src/app/(app)/estimator/types.ts` (`EstimatorProps.narrativeIntros`)
- Modify: `src/app/(app)/estimator/page.tsx` (load `listIntros()`)
- Create: `src/app/(app)/catalog/narrative-paragraph-panel.tsx`
- Modify: `src/app/(app)/catalog/page.tsx` (mount below the Spec panel block, ~line 1057)
- Test: `scripts/test-review-and-spec.ts`. Append block `#293 slice 1 — intros, Draft narrative, part editor`.

**Interfaces:**
- Consumes:
  - Task 1: `draftNarrative`, `draftOverwrites`, `resolveKeyProducts`, `MAX_INTRO`, `MAX_PARAGRAPH`, and
    `SystemIntro`/`MAX_INTRO_TITLE` from `lib/narrative/intros`.
  - Task 2: `upsertSystemIntroAction`, `deleteSystemIntroAction`, `saveProductParagraphAction`, the
    `IntroWriteResponse` type and `listIntros()`.
  - Task 4: `NarrativeColumnProps`, `KeyProductLibrary.ensure`.
- Produces:
  - `NarrativeColumnProps` gains `intros: SystemIntro[]` and `onIntros: (list: SystemIntro[]) => void`.
  - `EstimatorProps.narrativeIntros: SystemIntro[]`.
  - `narrative-intros-modal.tsx` default export
    `NarrativeIntrosModal({ intros, canWrite, onIntros, onClose })`.
  - `catalog/narrative-paragraph-panel.tsx` default export
    `NarrativeParagraphPanel({ part: { sku; narrativeText?; narrativeUpdatedAt?; narrativeUpdatedBy? } })`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 1 — intros, Draft narrative and the part editor's Narrative
   paragraph (client wiring, by source).
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const clientImportsServer = (s: string) => /^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/narrative\/(library|photos))/m.test(s);
  const col = rd("src/app/(app)/estimator/narrative-column.tsx");
  const modal = rd("src/app/(app)/estimator/narrative-intros-modal.tsx");
  const panel = rd("src/app/(app)/catalog/narrative-paragraph-panel.tsx");
  ok([modal, panel].every((s) => /^"use client";/.test(s) && !clientImportsServer(s)), "#293 UI: the intros modal and the part-editor panel are client modules importing no store");
  ok(col.includes("Draft narrative") && col.includes("draftOverwrites(") && col.includes("draftNarrative(") && col.includes("Replace what") && col.includes("Fill blanks only") && col.includes("Switched to Narrative") && col.includes("still need"),
    "#293 Draft: asks Replace / Fill blanks / Cancel before overwriting, switches to Narrative, reports skus still needing a paragraph");
  ok(col.includes("Save as intro") && col.includes("Manage intros") && col.includes("Needs the Create permission") && col.includes("— none —") && col.includes("upsertSystemIntroAction("),
    "#293 intros: the intro select, Save as intro and Manage intros (disabled without Create)");
  ok(modal.includes("upsertSystemIntroAction(") && modal.includes("deleteSystemIntroAction(") && !modal.includes("window.confirm"), "#293 intros: the modal edits and deletes (inline confirm)");
  ok(rd("src/app/(app)/estimator/page.tsx").includes("listIntros()") && rd("src/app/(app)/estimator/page.tsx").includes("narrativeIntros={narrativeIntros}"), "#293 intros: the Estimator page loads the intro library");
  ok(panel.includes("Narrative paragraph") && panel.includes("saveProductParagraphAction(") && panel.includes("changed since you loaded it") && !/\bname=/.test(panel),
    "#293 part editor: the Narrative paragraph panel saves through the same action, stale-checked, and leaks no field into the part form");
  const cat = rd("src/app/(app)/catalog/page.tsx");
  ok(/canCreate && editing && part && \([\s\S]{0,400}<NarrativeParagraphPanel\s+key=\{part\.sku\}/.test(cat), "#293 part editor: the panel mounts for Create users editing a part");
}
```

- [ ] **Step 2: Run the harness and watch it fail**

Run: `LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; grep -E '^FAIL|ENOENT' "$LOG" | head`
Expected: `ENOENT … narrative-intros-modal.tsx`.

- [ ] **Step 3: Create `src/app/(app)/estimator/narrative-intros-modal.tsx`**

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { MAX_INTRO } from "./narrative";
import { MAX_INTRO_TITLE, type SystemIntro } from "@/lib/narrative/intros";
import { deleteSystemIntroAction, upsertSystemIntroAction } from "./narrative-actions";

/** #293 — Manage intros: edit or delete library intros. Inline two-step
 *  delete (never window.confirm). Writes need Create. */
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" };
const FIELD: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px" };

export default function NarrativeIntrosModal({
  intros,
  canWrite,
  onIntros,
  onClose,
}: {
  intros: SystemIntro[];
  canWrite: boolean;
  onIntros: (list: SystemIntro[]) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const save = () =>
    editing &&
    start(async () => {
      setErr("");
      const r = await upsertSystemIntroAction(editing);
      if (!r.ok) return setErr(r.error);
      onIntros(r.intros);
      setEditing(null);
    });
  const del = (id: string) =>
    start(async () => {
      setErr("");
      const r = await deleteSystemIntroAction(id);
      if (!r.ok) return setErr(r.error);
      onIntros(r.intros);
      setConfirmDel(null);
    });

  return (
    <div role="dialog" aria-modal="true" aria-label="Manage intros" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(22,24,29,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "min(560px, 100%)", maxHeight: "85vh", overflowY: "auto", background: "#fff", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>System intros</div>
          <button type="button" style={BTN} onClick={onClose}>Done</button>
        </div>
        {!intros.length && <div style={{ fontSize: 12.5, color: "#8c919c" }}>No intros yet — write a system&apos;s intro, then ⋯ → Save as intro…</div>}
        {intros.map((i) =>
          editing?.id === i.id ? (
            <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid #ececf0", borderRadius: 8, padding: 10 }}>
              <input aria-label="Intro title" style={FIELD} maxLength={MAX_INTRO_TITLE} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              <textarea aria-label="Intro text" style={{ ...FIELD, minHeight: 140, resize: "vertical" }} maxLength={MAX_INTRO} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={BTN} disabled={pending} onClick={save}>Save</button>
                <button type="button" style={BTN} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid #f0f1f4", padding: "8px 0" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</div>
                <div style={{ fontSize: 11.5, color: "#8c919c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.text.split("\n")[0]}</div>
              </div>
              {confirmDel === i.id ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  Delete “{i.title}”?
                  <button type="button" style={{ ...BTN, color: "#b4543a" }} disabled={pending} onClick={() => del(i.id)}>Delete</button>
                  <button type="button" style={BTN} onClick={() => setConfirmDel(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={BTN} disabled={!canWrite} title={canWrite ? "" : "Needs the Create permission"} onClick={() => setEditing({ id: i.id, title: i.title, text: i.text })}>Edit</button>
                  <button type="button" style={{ ...BTN, color: "#b4543a" }} disabled={!canWrite} title={canWrite ? "" : "Needs the Create permission"} onClick={() => setConfirmDel(i.id)}>Delete</button>
                </div>
              )}
            </div>
          )
        )}
        {err && <div style={{ fontSize: 12, color: "#b4543a" }}>{err}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the intro row and Draft narrative to `narrative-column.tsx`.** Add these imports:

```ts
import { draftNarrative, draftOverwrites } from "./narrative";
import type { SystemIntro } from "@/lib/narrative/intros";
import { upsertSystemIntroAction } from "./narrative-actions";
import NarrativeIntrosModal from "./narrative-intros-modal";
```

Merge the first two into the existing `./narrative` and `./narrative-actions` import lists. Then extend the props:

```ts
export type NarrativeColumnProps = {
  sec: SpecSection;
  narrRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (fn: (s: SpecSection) => SpecSection) => void;
  library: KeyProductLibrary;
  canWriteLibrary: boolean;
  /** #293: the system-intro library (loaded server-side, updated by the actions). */
  intros: SystemIntro[];
  onIntros: (list: SystemIntro[]) => void;
};
```

In `NarrativeColumn`, add state and handlers before the `return`:

```tsx
  const [introId, setIntroId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveAsTitle, setSaveAsTitle] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftAsk, setDraftAsk] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, startBusy] = useTransition();
  const chosen = p.intros.find((i) => i.id === introId) || null;
  const NEEDS_CREATE = "Needs the Create permission";

  /** Draft narrative: copies saved text only — never generates (D89). */
  const draft = (mode: "replace" | "blanks" | null) =>
    startBusy(async () => {
      setNotice("");
      const okSkus = resolveKeyProducts(p.sec).filter((r) => r.status === "ok").map((r) => r.kp.sku);
      const rows = await p.library.ensure(okSkus);
      const lib = new Map(Object.entries(rows));
      const introText = chosen ? chosen.text : null;
      if (mode == null && draftOverwrites(p.sec, introText, lib)) {
        setDraftAsk(true);
        return;
      }
      setDraftAsk(false);
      const m = mode ?? "replace";
      const r = draftNarrative(p.sec, introText, lib, m);
      if (r.changed) p.onChange((s) => draftNarrative(s, introText, lib, m).section);
      const parts: string[] = [];
      if ((p.sec.presentation || "itemized") !== "narrative") parts.push("Switched to Narrative");
      const n = r.needsParagraph.length;
      if (n) parts.push(`${n} ${n === 1 ? "product still needs" : "products still need"} a paragraph`);
      if (!r.changed) parts.push("Nothing to change");
      setNotice(parts.join(" · "));
    });

  const saveAsIntro = () =>
    startBusy(async () => {
      const title = (saveAsTitle || "").trim();
      const r = await upsertSystemIntroAction({ title, text: p.sec.narrative || "" });
      if (!r.ok) return setNotice(r.error);
      p.onIntros(r.intros);
      if (r.id) setIntroId(r.id);
      setSaveAsTitle(null);
      setNotice("Saved as intro");
    });
```

As the first child of the column's scroll `<div>`, before the presentation `<select>`, render the intro row, its inline
confirms and the modal:

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <select
          aria-label="System intro"
          value={introId}
          onChange={(e) => setIntroId(e.target.value)}
          style={{ flex: "1 1 140px", minWidth: 0, border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}
        >
          <option value="">— none —</option>
          {p.intros.map((i) => (
            <option key={i.id} value={i.id}>{i.title}</option>
          ))}
        </select>
        <button type="button" style={BTN} disabled={busy} onClick={() => draft(null)} title="Copy the chosen intro and each key product's saved paragraph onto this system">
          Draft narrative
        </button>
        <div style={{ position: "relative" }}>
          <button type="button" style={BTN} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} title="Intro library">⋯</button>
          {menuOpen && (
            <div role="menu" style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, background: "#fff", border: "1px solid #ececf0", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.1)", padding: 4, display: "flex", flexDirection: "column", minWidth: 160 }}>
              <button
                type="button"
                role="menuitem"
                style={{ ...BTN, background: "transparent", textAlign: "left", opacity: p.canWriteLibrary && (p.sec.narrative || "").trim() ? 1 : 0.5 }}
                disabled={!p.canWriteLibrary || !(p.sec.narrative || "").trim()}
                title={!p.canWriteLibrary ? NEEDS_CREATE : !(p.sec.narrative || "").trim() ? "Write an intro first" : ""}
                onClick={() => { setMenuOpen(false); setSaveAsTitle(""); }}
              >
                Save as intro…
              </button>
              <button
                type="button"
                role="menuitem"
                style={{ ...BTN, background: "transparent", textAlign: "left", opacity: p.canWriteLibrary ? 1 : 0.5 }}
                disabled={!p.canWriteLibrary}
                title={p.canWriteLibrary ? "" : NEEDS_CREATE}
                onClick={() => { setMenuOpen(false); setManageOpen(true); }}
              >
                Manage intros…
              </button>
            </div>
          )}
        </div>
      </div>
      {saveAsTitle !== null && (
        <div style={ASK}>
          <input aria-label="Intro title" autoFocus value={saveAsTitle} maxLength={120} placeholder="Intro title" onChange={(e) => setSaveAsTitle(e.target.value)}
            style={{ flex: 1, minWidth: 120, border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 12 }} />
          <button type="button" style={BTN} disabled={busy || !saveAsTitle.trim()} onClick={saveAsIntro}>Save</button>
          <button type="button" style={BTN} onClick={() => setSaveAsTitle(null)}>Cancel</button>
        </div>
      )}
      {draftAsk && (
        <div style={ASK}>
          <span>This system already has written text.</span>
          <button type="button" style={BTN} disabled={busy} onClick={() => draft("replace")}>Replace what&apos;s written</button>
          <button type="button" style={BTN} disabled={busy} onClick={() => draft("blanks")}>Fill blanks only</button>
          <button type="button" style={BTN} onClick={() => setDraftAsk(false)}>Cancel</button>
        </div>
      )}
      {notice && <div style={{ ...HINT, color: "#3a3f4a" }}>{notice}</div>}
      {manageOpen && (
        <NarrativeIntrosModal intros={p.intros} canWrite={p.canWriteLibrary} onIntros={p.onIntros} onClose={() => setManageOpen(false)} />
      )}
```

- [ ] **Step 5: Plumb intros through the estimator.** In `src/app/(app)/estimator/types.ts`, add the import
`import type { SystemIntro } from "@/lib/narrative/intros";`. In `EstimatorProps`, add after
`canWriteNarrativeLibrary: boolean;`:

```ts
  /** #293 — the system-intro library (Settings blob `narrative_intros`). */
  narrativeIntros: SystemIntro[];
```

In `src/app/(app)/estimator/page.tsx`:
- add the import `import { listIntros } from "@/lib/stores/narrative-intros";`;
- append `listIntros()` to the big `Promise.all([...])` array, and `narrativeIntros` to its destructured tuple (as the
  last element of each);
- pass `narrativeIntros={narrativeIntros}` to `<EstimatorClient>`.

In `estimator-client.tsx`:
- destructure `narrativeIntros`;
- add `const [intros, setIntros] = useState(narrativeIntros);` next to the other `useState`s (near `narrOpen`);
- pass `intros={intros}` and `onIntros={setIntros}` to `<NarrativeColumn …>`.

- [ ] **Step 6: Create `src/app/(app)/catalog/narrative-paragraph-panel.tsx`**

```tsx
"use client";

import { useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/format";
import { MAX_PARAGRAPH } from "@/app/(app)/estimator/narrative";
import { saveProductParagraphAction } from "@/app/(app)/estimator/narrative-actions";

/**
 * #293 — the part's Narrative paragraph: the write-once sales prose the
 * Estimator copies onto a quote when this part is a key product. Distinct
 * from the Spec panel's specBody (CSI Part 2 text). Lives inside the part
 * editor's <form action={upsertPart}> like SpecPanel: type="button" only,
 * no `name` on any field (nothing leaks into upsertPart), state seeded once
 * per mount (PUNCHLIST #141 rule). Saved through saveProductParagraphAction
 * (Create; mergeUpsert only), stale-checked against narrativeUpdatedAt.
 */
const LBL: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 5 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#fff", background: "#2b2e35", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer" };

export default function NarrativeParagraphPanel({
  part,
}: {
  part: { sku: string; narrativeText?: string; narrativeUpdatedAt?: number; narrativeUpdatedBy?: string };
}) {
  const router = useRouter();
  const [text, setText] = useState(part.narrativeText || "");
  const [stale, setStale] = useState<{ updatedAt: number | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const save = (expect: number | null) =>
    start(async () => {
      setMsg("");
      const r = await saveProductParagraphAction(part.sku, text, expect);
      if (r.ok) {
        setStale(null);
        setMsg("Saved");
        router.refresh();
      } else if (r.stale) {
        setStale({ updatedAt: r.stale.updatedAt });
      } else setMsg(r.error);
    });
  const stopEnter = (e: KeyboardEvent) => e.stopPropagation();

  return (
    <div>
      <label style={LBL}>Narrative paragraph</label>
      <textarea
        aria-label="Narrative paragraph"
        value={text}
        maxLength={MAX_PARAGRAPH}
        onKeyDown={stopEnter}
        onChange={(e) => setText(e.target.value)}
        placeholder="How this part reads in a customer narrative — written once, reused on every quote that features it."
        style={{ width: "100%", minHeight: 110, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" style={{ ...BTN, opacity: text.trim() ? 1 : 0.5 }} disabled={pending || !text.trim()} onClick={() => save(part.narrativeUpdatedAt ?? null)}>
          {pending ? "Saving…" : "Save paragraph"}
        </button>
        {part.narrativeUpdatedAt ? (
          <span style={{ fontSize: 11, color: "#8c919c" }}>
            Last saved {timeAgo(part.narrativeUpdatedAt)}
            {part.narrativeUpdatedBy ? " by " + part.narrativeUpdatedBy : ""}
          </span>
        ) : null}
        {msg && <span style={{ fontSize: 11.5, color: msg === "Saved" ? "#1f7a52" : "#b4543a" }}>{msg}</span>}
      </div>
      {stale && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11.5, background: "#fbf3dd", borderRadius: 6, padding: "6px 8px" }}>
          <span>The library paragraph changed since you loaded it — replace it anyway?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => save(stale.updatedAt)}>Replace anyway</button>
          <button type="button" style={{ ...BTN, background: "#f1f2f5", color: "#3a3f4a" }} onClick={() => setStale(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

`timeAgo(ms: number | null | undefined)` (`src/lib/format.ts:53`) takes epoch ms. SpecPanel calls it the same way in
render.

- [ ] **Step 7: Mount the panel in `src/app/(app)/catalog/page.tsx`.** Add the import:

```ts
import NarrativeParagraphPanel from "./narrative-paragraph-panel";
```

Directly after the Spec panel block (`{canCreate && editing && part && ( <div …> … <SpecPanel …/> </div> )}`), add:

```tsx
            {/* #293 — the part's Narrative paragraph (Estimator key products).
                Same audience as the Spec panel; the write is enforced by
                saveProductParagraphAction (Create). */}
            {canCreate && editing && part && (
              <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
                <NarrativeParagraphPanel
                  key={part.sku}
                  part={{ sku: part.sku, narrativeText: part.narrativeText, narrativeUpdatedAt: part.narrativeUpdatedAt, narrativeUpdatedBy: part.narrativeUpdatedBy }}
                />
              </div>
            )}
```

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit
LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG" | head -20
npx eslint "src/app/(app)/estimator/narrative-intros-modal.tsx" "src/app/(app)/estimator/narrative-column.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/catalog/narrative-paragraph-panel.tsx" "src/app/(app)/catalog/page.tsx"
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```

Expected:
- tsc 0;
- test:specs 0 FAIL, with PASS = Task 4's count + 7;
- eslint 0 errors;
- the build succeeds (recommended, because client files changed).

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/estimator/narrative-intros-modal.tsx" "src/app/(app)/estimator/narrative-column.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/catalog/narrative-paragraph-panel.tsx" "src/app/(app)/catalog/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 system intros, Draft narrative, part-editor Narrative paragraph\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 6: Final gates, browser check, docs

**Files:**
- Modify: `PUNCHLIST.md` (append an entry), `DECISIONS.md` (append entries), `AGENTS.md` (the phase list, after item 31)
- No code changes, unless a gate finds a defect. A defect fix gets its own commit plus a harness check.

**Interfaces:** consumes everything above; produces the docs.

- [ ] **Step 1: Run the full gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
df -h /System/Volumes/Data | tail -1
ps aux | grep -v grep | grep tsx    # nothing of this worktree may hold a datadir
npx tsc --noEmit
LOG=$(mktemp -t specs293); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG"; tail -1 "$LOG"
npx eslint $(git diff --name-only origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 'scripts/qd293-*.ts')
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3000|3001)\b' || true   # the port smoke uses must be free
npm run test:smoke 2>&1 | tail -8
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```

Expected:
- tsc 0;
- test:specs `ALL PASSED`, 0 FAIL, PASS = 10,378 + every #293 check;
- eslint 0 errors;
- smoke ALL PASSED (it includes `/estimator`, `/estimator?id=Q-2041` and `/catalog?edit=RB-MV-MN`, which load the new
  client bundles);
- build OK.

Record the real numbers. If smoke shows a run of "fetch failed", check the disk first (see Global Constraints).

- [ ] **Step 2: Browser check (spec §9.3, Slice 1). The controller runs this if the environment allows.**

Use a scratch datadir, never `.data/pglite`. Read these memories first:
- `peak-worktree-dev-server-browser-verification-traps.md`: same `AUTH_SECRET`; use `localhost`, not `127.0.0.1`;
  unregister the service worker; `lsof` the port first;
- `peak-preview-start-reads-main-checkout-launch-json.md`;
- `peak-exercising-post-routes-safely.md`.

On a seeded quote:
1. Star a line, edit its text, toggle its photo, and reorder blocks.
2. Use Save to library, then open a fresh quote, star the same part and see the library text.
3. Run Draft narrative in both modes.
4. Save, then open the PDF. The photo should sit right of its paragraph, and the appendix should print on a new page
   when toggled.
5. In the catalog part editor, see and edit the Narrative paragraph.

Stop the dev server before any further `test:specs`. If it can't run here, say so in the report and in the PUNCHLIST
entry ("not exercised in a browser").

- [ ] **Step 3: Recompute the punch and decision numbers right before writing.** A parallel branch (cut sheets) claims
#292 and some D-numbers, so take the maximum across every ref:

```bash
git fetch origin --quiet
maxp=0; maxd=0
for ref in origin/main $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin); do
  p=$(git show "$ref:PUNCHLIST.md" 2>/dev/null | grep -oE '^## [0-9]+\.' | grep -oE '[0-9]+' | sort -n | tail -1)
  d=$(git show "$ref:DECISIONS.md" 2>/dev/null | grep -oE '^## D[0-9]+\.' | grep -oE '[0-9]+' | sort -n | tail -1)
  [ -n "$p" ] && [ "$p" -gt "$maxp" ] && maxp=$p; [ -n "$d" ] && [ "$d" -gt "$maxd" ] && maxd=$d
done
echo "highest punch #$maxp, highest D$maxd"
```

- **Punch number:** use **#293** unless `maxp ≥ 293` and some ref already uses `## 293.` for a different item. In that
  case use `maxp+1`, and replace `#293` in this slice's new docs and harness messages.
- **D-numbers:** the next free one is `D$((maxd+1))`.
- Re-run the loop immediately before committing. If the numbers moved, renumber.

- [ ] **Step 4: Write `DECISIONS.md` entries.** Append in the file's format (`## D<n>. <title> (#293, 2026-10-01)` plus
a paragraph). Use one entry per decision, in this order (with `N` = the first free number):
  1. **D(N) No generation in the quote path.** Every customer-facing word is typed once and copied (spec decision 1,
     D89).
  2. **D(N+1) Key products are structured blocks on the section.** They're anchored to `String(item.id)` plus the sku,
     unique per section. A block resolves only when both match. A block with no line is flagged, never auto-deleted.
     Same-estimate Copy remaps ids. Copy to existing, Move, recall, tier re-price and the Rewards credit carry blocks
     as-is. The server sanitizes `keyProducts` on save, and on Move and Copy too: a plan-level extension of spec §3.4,
     so the stored shape is server-clean on every entry. (Spec decisions 2, 3, 6, 13 partial.)
  3. **D(N+2) The product paragraph is a `CatalogPart` field written only through `mergeUpsert`.** Covers
     `narrativeText` / `At` / `By`, the stale-version check and the custom-sku refusal. Paragraphs go with the parts on
     Clear catalog price list and the go-live wipe, so run `npm run db:export` first. (Spec decision 4.)
  4. **D(N+3) System intros are one `narrative_intros` settings blob with single-op writes.** It survives both resets.
     Writes need Create and answer with a message, not `requirePerm`'s redirect. (Spec decisions 5 and 6; open question
     6 is still open.)
  5. **D(N+4) Printing.** Key products print only in Narrative. The photo is `visibleImagesForParts()[0]` of a live
     part, inlined as a data URI in the PDF (PNG/JPEG/WebP, 3 MB / 15 MB / 6 concurrent), floated right at 34 %.
     `ItemizedLines`/`SectionBand` are extracted, and output is byte-identical without blocks (a committed baseline
     fixture). The pure view helpers live in `quote-document-view.ts`, because `quote-document.tsx` imports a `.jpg`
     the harness can't load. `layout="web"` is deferred to Slice 3. (Spec decisions 7, 8, 9.)
  6. **D(N+5) The Itemized appendix (`pdfItemizedAppendix`, default off).** It covers narrative systems, or every system
     when printing by section. Descriptions are always on. It goes after the signature and before the footer, on a new
     page, and totals are unchanged. (Spec decision 10.)
  7. **D(N+6) UI choices.**
     - Confirms are inline two-step strips, never `window.confirm` (the Capacitor shells).
     - The ★ lives in the actions cell, which is widened by 20 px.
     - The library cache prefetches the active system's eligible skus, so a ★ click copies the saved paragraph.
     - The Draft confirm offers Replace / Fill blanks / Cancel.

- [ ] **Step 5: Write the `PUNCHLIST.md` entry.** Append in the #290 entry's format:

```
## 293. Estimates — narrative-first client preview (key products, saved paragraphs, intros, appendix) — Slice 1 DONE 2026-10-01 (D<N>–D<N+6>)

**Slice 1 done.**
- **Key products.** Any eligible line can be starred into a key product (★ on the row, or + Key product in the
  narrative column). Each block prints, in Narrative presentation only, its saved paragraph with the part's primary
  photo floated right.
- **Library.** Paragraphs are written once on the catalog part (Save to library, or the part editor's Narrative
  paragraph) and copied onto quotes. System intros are a reusable library (Save as intro, Manage intros).
- **Draft narrative** fills the intro and block texts (Replace / Fill blanks) and switches the system to Narrative.
- **Itemized appendix.** A new Show-on-PDF toggle reprints every narrative (or by-section) system's full line list on
  a new page after the signature.
- **Back-compat.** A quote without blocks prints byte-for-byte as before. There are no migrations.
- **Spec:** `docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`. **Plan:**
  `docs/superpowers/plans/2026-10-01-narrative-slice1.md`.

Gates: tsc 0; test:specs <PASS> PASS / 0 FAIL (<k> for #293); test:smoke <n>/<n> ALL PASSED; `next build` OK.
Browser: <what was exercised, or "not exercised in a browser">.

**Slice 2 (next).** System library, Load system, Merge narrative (spec §4, §8.2).
**Slice 3.** Portal estimate page, signed share link, Narrative / BOM toggle (spec §5, §8.3).

**For Jeff.**
- Open questions in spec §12: photo side, datasheet thumbnails as photos, default presentation, who manages intros.
- Paragraphs live on catalog parts, so take `npm run db:export` before Clear catalog price list or the go-live wipe.
- Preview deploys share the production DB, so a paragraph or intro saved on a preview is a production write.
```

Fill in the real numbers from Step 1. The rollback note is that pre-#293 code ignores `keyProducts` and drops the
appendix key on its next save, which is harmless. There's no rollback hazard.

- [ ] **Step 6: Update `AGENTS.md`.** After item 31 in "Phase status", add:

```
32. ✅ **Narrative-first client preview — Slice 1** (#293, D<N>–D<N+6>) —
    key products on a system (★ per line; `SpecSection.keyProducts`
    anchored to line id + sku, sanitized server-side, remapped on Copy
    here), write-once product paragraphs on the catalog part
    (`narrativeText`, mergeUpsert only; Save to library + the part
    editor's Narrative paragraph), a `narrative_intros` blob of reusable
    system intros, Draft narrative (copy only — D89), the customer PDF
    printing each block with the part's primary photo floated right
    (data URIs; byte-identical without blocks), and Show on PDF →
    Itemized appendix. Slices 2 (system library) and 3 (client link)
    follow. Spec `docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`.
```

- [ ] **Step 7: Commit the docs**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md
git commit -m "$(printf 'docs: #293 slice 1 — PUNCHLIST, DECISIONS, AGENTS phase list\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

Don't push or merge. Hand back to the controller for the final review, the merge to main and the deploy (spec "Slices
at a glance").

---

## Self-review notes (spec coverage)

| Spec section | Covered by |
|---|---|
| §1.1 types and limits | Task 1 |
| §1.2 paragraph field | Task 2 |
| §1.3 intros blob | Tasks 1 and 2 |
| §1.4 appendix toggle | Tasks 1 and 3 |
| §2.1 pure narrative functions | Task 1 (all listed functions, plus the editor helpers and `photoSkusOf`) |
| §2.2 pure intros | Task 1 |
| §2.3 `appendixSystemIds` | Task 3 (`quote-document-view.ts`); `bomViewProps` is Slice 3 |
| §3.1 the ★ | Task 4 |
| §3.2 the column | Task 4 (cards, chips, photo, text, actions, strips, picker); Task 5 (intro row) |
| §3.3 Draft narrative | Task 5 |
| §3.4 library writes, part editor, save sanitize, re-id paths | Tasks 2, 4 and 5 |
| §3.5 printing | Task 3 |
| §3.6 photos | Task 2 (helpers); Task 3 (wiring) |
| §8.1 done criteria | Tasks 1–6 |
| §9.1 Slice 1 harness | Tasks 1–5 |
| §9.2 smoke | Task 6; no new routes in Slice 1 |
| §9.3 browser | Task 6 |
| §10 rollout | Task 6 docs |

**Deliberate deviations, logged in the D(N+1), D(N+4) and D(N+6) entries:**
- `keyProducts` is also sanitized on Move and Copy.
- The pure view helper is a separate module.
- `requireUser` + `can` replaces `requirePerm`, so a refusal returns a message.
- Confirms are inline.
- `layout` is deferred to Slice 3.
