# Estimate Photo Wrap, Model Tags, Title Page and PDF Appendices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Key-product photos spread through each system's narrative with the system text wrapping round them and a model-number tag on each photo; the estimate PDF opens on a title page, puts pricing after the narratives, and ends with the BOM, cut sheets, merged drawings and a page of permanent datasheet links.

**Architecture:** Two pure helpers (`photo-spread.ts` anchors + figure/tag styles, `photo-models.ts` tag text) feed three renderers that already print key-product photos (QuoteDocument, the package page, the package-document view and its TipTap editor). The print layout of `QuoteDocument` (`layout` ≠ `"web"`) gets a title page and a new section order; web stays as it is apart from the photos. The PDF generator gains an appendix step: a datasheet-links section rendered by the print route, signed permanent links served by a new public route `/d/ds/…`, and pdf-lib merging of the Plans & risers drawings — never failing the PDF, with warnings stored on the PDF state.

**Tech Stack:** Next.js 16 App Router (server components, route handlers, server actions), React SSR, TypeScript, pdf-lib 1.17.1, sharp, headless Chrome via puppeteer-core, Drizzle/PGlite (tests), the `scripts/test-review-and-spec.ts` harness.

**Spec:** `docs/superpowers/specs/2026-10-16-estimate-photo-wrap-title-page-design.md` (authoritative; Jeff's answers are final).

## Open issues for the controller

Each one is a spec point the code contradicts or leaves open, with the resolution this plan takes. Flag any you want changed **before** Task 6.

1. **Datasheet-links "second `page.pdf()` pass on the same loaded page" (spec §5).** The render seam is `render(url, opts?) => Promise<Buffer>` (`src/lib/quote-pdf/generate.ts:52`) and the harness pins `RENDER_WORST_CASE_MS` to *exactly* the waits `renderOnce` performs (`scripts/test-review-and-spec.ts:27545`) and the 120 s budget sum (`:26948`, `:49476`). A second in-page pass adds an unbudgeted Chrome step to every render that has links. **Resolution:** the print route takes `?part=main|tail`; the generator renders the tail as a *second, opportunistic render call* only when there are drawings to put between (no drawings → one render, the links print at the end of it), gated and hard-stopped exactly like the #293 stamp re-render (`stampRerenderFits` / `stampRerenderDeadlineMs`, `generate.ts:96-107`). `render.ts` is untouched and every existing fake `render` in the harness keeps working. Cost: one extra Chrome launch on quotes that have drawings **and** datasheets.
2. **"The PDF doc key gains a digest of the shown package files … and the selection" (spec §4 Staleness).** `pdfDocKey` (`src/app/(app)/estimator/pdf-doc-key.ts:52`) is the *client's* "Unsaved changes" fingerprint; the Estimator never holds `packageFiles`, and both the drawings and the selection save immediately through their own actions. Adding them there would show a false "Unsaved changes — save to update the PDF." **Resolution:** a pure server-side `pdfAppendixKey(q)` (Task 9) that the five writers (drawing upload / remove / Generate from Grid, `setPackageSelection` via `updateQuoteMetaAction`) compare before/after and, when it moved, call `scheduleQuotePdf` and hand the PDF view back to the Estimator. `pdfDocKey` is unchanged.
3. **Datasheets with no stored file.** Some datasheets are URL-only (the DaVinci pre-fill links ETC datasheets by URL, no file — phase 14). There is no "hosted copy" to link to. **Resolution:** the links page lists only blob-backed datasheets, the same rule as the package page's datasheet route (`src/app/share/quote/[id]/[token]/doc/[docId]/route.ts:34`). Alternative if Jeff wants every one listed: link the manufacturer URL for those rows.
4. **Email attachment limit.** Send attaches the estimate PDF only up to `ESTIMATE_EMAIL_ATTACH_MAX` = 15 MB (`src/lib/estimate-email/compose.ts:12`, refused with "Too large to attach — send the link only." `send-server.ts:95`). The spec allows up to 80 MB of drawings. **Resolution:** keep the spec's caps; when the finished PDF is over 15 MB, add a PDF note ("This PDF is N MB — too large to attach to an email; send the link."). Jeff may prefer a lower drawings cap.
5. **Link permanence depends on the print origin.** The absolute URL is the print origin (`printOriginFor`, `src/lib/quote-pdf/origin.ts:42`). On Vercel without `QUOTE_PDF_ORIGIN` that is the host of the request that saved — possibly a preview URL (previews share the production DB). Rotating `AUTH_SECRET` also invalidates every link. **Resolution:** build on the print origin as the spec says; the PUNCHLIST "Remaining" names `QUOTE_PDF_ORIGIN` in production (already Jeff-gated since Batch 2) as a prerequisite for permanent links, and DECISIONS records the `AUTH_SECRET` coupling.
6. **Function memory.** pdf-lib holds the whole output in memory; 80 MB of drawings can push a Vercel function past 1 GB. **Resolution:** keep the spec caps; the plan checks the real size once on a preview after merge (Task 9 Remaining). An out-of-memory kill cannot be caught — the PDF state then goes stale and the existing "didn't finish" retry applies.
7. **Datasheet list staleness from the catalog side.** A datasheet uploaded or replaced in Catalog → Datasheets after the PDF was made doesn't re-render quotes. A replaced document's old link 404s (spec: live only while listed); a new one is missing until the next save. **Resolution:** accept, record in DECISIONS.
8. **`pdfNotes` name clash.** The spec says "`pdfNotes`-style warning", but `pdfNotes` is already a Show-on-PDF option (line descriptions, `quote-document.tsx:65`). **Resolution:** the new field is `QuotePdfState.notes`.
9. **Model tag fallback.** `lineModel` ends in `partModel`, which can print a SKU tail (e.g. a custom part's SKU) when a part has no Model # or MFR P/N. That is the spec's rule (#304); flagged only so nobody is surprised.


## Controller amendments (Jeff, Oct 16) — these OVERRIDE anything below

- **A1 — the estimate PDF stays under the email limit.** Jeff chose "Keep it under 15 MB": the finished estimate PDF (main + drawings + links page) must stay ≤ `ESTIMATE_PDF_TARGET_MAX_BYTES` = 14 MB (headroom under `ESTIMATE_EMAIL_ATTACH_MAX` = 15 MB, `src/lib/estimate-email/compose.ts:12`). Replace the 80 MB total cap: the drawings budget is `14 MB − (main bytes + tail bytes)`, drawings are taken in list order while they fit (`over-total` skip otherwise — copy: "left out to keep the PDF under 15 MB for email; it's on the client package page"), and after `save()` a final guard drops drawings from the END and re-merges (at most 3 tries; then main + links only) if the merged output is still over 14 MB. The per-file 25 MB cap stays. The "PDF over 15 MB" note in open issue 4 is then unreachable for drawings — keep it only as a defensive note. Open issue 6 (memory) is moot at this size. Update `DRAWINGS_TOTAL_MAX_BYTES` uses, the tests, the copy and the docs task accordingly.

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/photo-wrap` on branch `feat/narrative-photo-wrap`. Never edit the main checkout. Never `git stash` (shared stash) — make a WIP commit instead.
- Next.js 16: read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before Task 6. Route-handler `params` is a `Promise`. The app still uses `src/middleware.ts` (not `proxy.ts`); edit it in place.
- Never open the dev PGlite (`.data/`) twice; tests use `npm run test:specs` (temp DB). Before any dev server: `ps aux | grep -E "next dev|tsx" | grep -v grep` and stop strays. Verification renders use a scratch `PGLITE_PATH`, never `.data`.
- The dev server loads the real Blob token — never click upload in a scratch check.
- Fixtures live under `docs/`, never `.superpowers/`.
- A client component that (transitively) imports a server store breaks only `next build`: run `npx next build` in every task that touches a module reachable from a `"use client"` file (Tasks 2, 3, 4, 9).
- If `next-env.d.ts` is missing in the worktree: `cp /Users/sm/Downloads/peak-app/next-env.d.ts .` (read-only copy; it is gitignored).
- Photo size unchanged: **34 %** wide, **max-height 2.4in**, `object-fit: contain`, **14px** gutter; phone rules unfloat to full width (QuoteDocument web ≤ 480px, package page ≤ 600px, package doc ≤ 480px).
- Tag: background `rgba(22,24,29,.86)`, white text, `var(--font-mono)`, **9px print / 10px web**, padding `2px 6px`, `max-width: 100%`, one line with ellipsis; at the figure's **outer bottom corner** (bottom-right on a right float, bottom-left on a left float, bottom-right on a full-width image).
- Tag text is the **model number only**: `lineModel(line, part)`; a placeholder image gets a tag only from the line's own Model # / MFR P/N. Empty → no tag.
- Sides keep `alternatingPhotoSides` (right, left, right… across the document).
- Print order (`layout` ≠ `"web"` only): title page → narratives (+ Alternates, Optional additions) → pricing (totals, rewards/standing lines, terms, acceptance, footer, assumptions; **no investment band**) → BOM appendix on a new page → cut sheets → drawings → datasheet links. `layout="web"` keeps today's order and markup apart from photos/tags.
- The bidder PDF (`?bidder=`) gets the title page and order but **no drawings and no datasheet links**.
- Drawings: `shownPackageFiles(quote.packageFiles, quote.packageSelection)`, list order; PDFs at their own page size; PNG/JPEG one letter page each (orientation of the image, 0.5in margins); WebP → PNG via sharp; per file 25 MB, total **80 MB**, inside the 120 s budget; **never fails the estimate PDF**.
- Link: `GET /d/ds/[quoteId]/[docId]/[sig]`, `sig` = HMAC-SHA256 over `"est-datasheet:" + quoteId + ":" + docId` with a key derived from `AUTH_SECRET`, truncated base64url; no expiry, no session; serves inline (`application/pdf`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, private cache) only while the quote exists and its current datasheet list contains `docId`; every refusal is the same 404.
- Decisions use placeholder numbers **D-TBD-a … D-TBD-h**; the punch item is **#TBD**; final numbers are assigned at merge.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verification gate (report real numbers): `npx tsc --noEmit -p .`, `npm run test:specs`, `npm run test:smoke` (alone, after `rm -rf .next`), `npx eslint <changed files>`, `npx next build`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/estimate-output/photo-spread.ts` (new) | `spreadPhotoAnchors`, figure / img / tag style builders | 1 |
| `src/lib/estimate-output/photo-models.ts` (new) | `cleanTag`, `photoTagText`, `keyProductModelsFor` | 1 |
| `src/lib/catalog-rename/sku.ts` | `lineOwnModel` beside `lineModel` | 1 |
| `scripts/test-photo-wrap.ts` (new) | every check for this feature; wired into the harness | 1–9 |
| `src/app/(app)/estimator/narrative.ts` | `PrintableKeyProduct.ownModel`; library row `modelPart` | 2, 4 |
| `src/app/(app)/estimator/quote-document.tsx` | spread + figures + tags; title page + print order | 2, 5 |
| `src/app/(app)/estimator/quote-document-view.ts` | drop `keyProductPhotoStyle` | 2 |
| `src/lib/narrative/photos.ts` | `photoReadPlan`, `loadKeyProductModels` | 2 |
| `src/app/print/quote/[id]/page.tsx` | models; links section; `?part=` | 2, 7 |
| `src/lib/quote-pdf/document-loader.ts` | models for portal / share | 2 |
| `src/lib/estimate-output/package-model.ts`, `src/components/estimate-output/package-view.tsx` | package page spread + tags | 3 |
| `src/lib/estimate-output/package-loader.ts`, `package-live-loader.ts` | pass models | 3 |
| `src/lib/package-doc/resolve.ts`, `src/components/package-doc/package-doc-view.tsx` | unbox product blocks; figures + tags | 4 |
| `src/lib/narrative/library.ts`, `src/components/package-doc/editor/{editor-model.ts,product-block-view.tsx,product-image-view.tsx}` | editor tag + unboxing | 4 |
| `src/lib/estimate-output/datasheet-link.ts` (new) | sign / verify / path | 6 |
| `src/lib/estimate-output/datasheet-link-server.ts` (new) | `serveEstimateDatasheet` | 6 |
| `src/app/d/ds/[quoteId]/[docId]/[sig]/route.ts` (new) | public route | 6 |
| `src/lib/estimate-output/package-docs-server.ts` | `packageDocForSpec` | 6 |
| `src/middleware.ts`, `src/lib/document-files.ts`, `scripts/smoke-routes.ts` | allowlist, `inlineDisposition`, smoke | 6 |
| `src/lib/estimate-output/datasheet-links.ts` (new), `datasheet-links-server.ts` (new), `src/components/estimate-output/datasheet-links-page.tsx` (new) | links rows + page | 7 |
| `src/lib/quote-pdf/appendix-plan.ts` (new), `appendix-merge-server.ts` (new) | drawing plan, page fit, notes; pdf-lib merge | 8 |
| `src/lib/quote-pdf/generate.ts`, `state.ts`, `src/components/quote-pdf/pdf-banner.ts` | appendix step, `notes` | 8 |
| `src/lib/quote-pdf/appendix-key.ts` (new), `src/app/(app)/estimator/package-actions.ts`, `actions.ts`, `use-estimator-state.ts`, `package-staff-panel.tsx`, `steps/client-package-tab.tsx`, `src/lib/estimate-output/package-selection.ts` | re-render scheduling | 9 |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | docs | 9 |

---

### Task 1: Pure photo-spread and model-tag helpers

**Files:**
- Create: `src/lib/estimate-output/photo-spread.ts`
- Create: `src/lib/estimate-output/photo-models.ts`
- Modify: `src/lib/catalog-rename/sku.ts` (append after `lineModel`, line 85)
- Create: `scripts/test-photo-wrap.ts`
- Modify: `scripts/test-review-and-spec.ts:11356` (import) and `:11734` (chain)

**Interfaces:**
- Consumes: `lineModel`, `partModel`, `ModelLineLike`, `ModelPartLike` (`src/lib/catalog-rename/sku.ts:24-85`); `resolveKeyProducts`, `isLineToken` (`src/app/(app)/estimator/narrative.ts:133,159`); `findLine`, `findSection` (`src/lib/package-doc/chips.ts:46-49`); `docLineNodes` (`src/lib/package-doc/text.ts:108`).
- Produces:
  - `spreadPhotoAnchors(unitCount: number, photoCount: number): number[]`
  - `type PhotoAlign3 = "left" | "right" | "full"`
  - `PHOTO_TAG_BG = "rgba(22,24,29,.86)"`
  - `photoFigureStyle(align: PhotoAlign3, widthPct?: number): CSSProperties` (default 34)
  - `photoImgStyle(align: PhotoAlign3, maxHeight?: string): CSSProperties` (default `"2.4in"`)
  - `photoTagStyle(align: PhotoAlign3, fontPx?: number): CSSProperties` (no `fontSize` when `fontPx` is absent — CSS sets it)
  - `lineOwnModel(line?: ModelLineLike | null): string` (in `sku.ts`)
  - `PHOTO_TAG_MAX = 60`, `cleanTag(v: unknown): string`
  - `photoTagText(i: { ownPhoto: boolean; partModel?: string | null; ownModel?: string | null }): string`
  - `keyProductModelsFor(i: { sections: readonly SpecSection[]; document?: PackageDoc | null; skus: readonly string[]; parts: ReadonlyMap<string, ModelPartLike>; readSku?: (sku: string) => string }): Record<string, string>`
  - `photoWrapPureChecks(ok: Ok): Promise<void>`, `photoWrapDbChecks(ok: Ok): Promise<void>` (later tasks add helper functions and call them from these two)

- [ ] **Step 1: Write the failing test file**

Create `scripts/test-photo-wrap.ts`:

```ts
/* Estimate photo wrap, model tags, title page, drawings + datasheet links
   (docs/superpowers/specs/2026-10-16-estimate-photo-wrap-title-page-design.md) — harness checks.
   `photoWrapPureChecks` needs no database; `photoWrapDbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-photo-wrap.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { spreadPhotoAnchors, photoFigureStyle, photoImgStyle, photoTagStyle, PHOTO_TAG_BG } from "../src/lib/estimate-output/photo-spread";
import { cleanTag, photoTagText, keyProductModelsFor, PHOTO_TAG_MAX } from "../src/lib/estimate-output/photo-models";
import { lineOwnModel } from "../src/lib/catalog-rename/sku";
import type { SpecSection } from "../src/app/(app)/estimator/types";

export const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function spreadChecks(ok: Ok) {
  ok(JSON.stringify(spreadPhotoAnchors(3, 2)) === "[0,1]", "photo wrap: photo k anchors before unit k");
  ok(JSON.stringify(spreadPhotoAnchors(2, 4)) === "[0,1,1,1]", "photo wrap: photos past the last unit stack before the last unit");
  ok(JSON.stringify(spreadPhotoAnchors(0, 2)) === "[0,0]", "photo wrap: no units → every photo anchors at 0");
  ok(JSON.stringify(spreadPhotoAnchors(5, 0)) === "[]" && JSON.stringify(spreadPhotoAnchors(NaN, -1)) === "[]", "photo wrap: no photos (or junk counts) → no anchors");
  const r = photoFigureStyle("right"), l = photoFigureStyle("left"), f = photoFigureStyle("full", 60);
  ok(r.float === "right" && r.width === "34%" && r.margin === "0 0 8px 14px" && r.position === "relative" && r.breakInside === "avoid",
    "photo wrap: a right figure keeps #293's float, 34 % and the 14px gutter, and is the tag's positioning box");
  ok(l.float === "left" && l.margin === "0 14px 8px 0", "photo wrap: a left figure mirrors it");
  ok(f.float === undefined && f.display === "block" && f.width === "60%" && f.margin === "0 auto 10px", "photo wrap: a full figure is a centred block at its width");
  const img = photoImgStyle("right");
  ok(img.display === "block" && img.width === "100%" && img.maxHeight === "2.4in" && img.objectFit === "contain" && img.objectPosition === "right top" &&
     photoImgStyle("left").objectPosition === "left top" && photoImgStyle("full", "4in").maxHeight === "4in" && photoImgStyle("full").objectPosition === "center top",
    "photo wrap: the image fills its figure, height-capped, pushed to the outer side so the corner tag sits on it");
  const tr = photoTagStyle("right", 9), tl = photoTagStyle("left", 10), tf = photoTagStyle("full");
  ok(tr.position === "absolute" && tr.bottom === 0 && tr.right === 0 && tr.left === undefined && tr.background === PHOTO_TAG_BG && PHOTO_TAG_BG === "rgba(22,24,29,.86)" &&
     tr.color === "#fff" && tr.fontSize === 9 && tr.padding === "2px 6px" && tr.maxWidth === "100%" && tr.whiteSpace === "nowrap" && tr.textOverflow === "ellipsis" && tr.overflow === "hidden",
    "photo wrap: the tag is a dark mono label on the outer bottom corner, one line, ellipsis");
  ok(tl.left === 0 && tl.right === undefined && tl.fontSize === 10 && tf.right === 0 && tf.fontSize === undefined,
    "photo wrap: a left photo's tag sits bottom-left; a full image's bottom-right; no font size → CSS decides");
}

function modelChecks(ok: Ok) {
  ok(lineOwnModel({ manufacturerModelNumber: " ION-XE ", manufacturerPartNumber: "7410A" }) === "ION-XE" && lineOwnModel({ manufacturerPartNumber: "7410A" }) === "7410A" &&
     lineOwnModel({ sku: "ETC:ION" }) === "" && lineOwnModel(null) === "", "photo wrap: a line's own model is its Model #, else its MFR P/N, never its SKU");
  ok(cleanTag("  Jupiter\n 4 ") === "Jupiter 4" && cleanTag(null) === "" && cleanTag("x".repeat(80)).length === PHOTO_TAG_MAX, "photo wrap: tag text is one trimmed line, capped");
  ok(photoTagText({ ownPhoto: true, partModel: "Jupiter 4", ownModel: "80-0043" }) === "Jupiter 4", "photo wrap: an own photo prints the part-aware model");
  ok(photoTagText({ ownPhoto: true, partModel: null, ownModel: "80-0043" }) === "80-0043", "photo wrap: an own photo with no part read falls back to the line's own model");
  ok(photoTagText({ ownPhoto: false, partModel: "Jupiter 4", ownModel: "" }) === "", "photo wrap: a placeholder with no real model on the line gets no tag");
  ok(photoTagText({ ownPhoto: false, partModel: "Jupiter 4", ownModel: "SW-ALLOW-1" }) === "SW-ALLOW-1", "photo wrap: a placeholder tags only with the line's own model");

  const sections = [
    { id: "s1", name: "Audio", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "",
      items: [
        { id: 1, sku: "Symetrix:Jupiter 4", desc: "DSP", qty: 1, unit: "ea", cost: 1, price: 2 },
        { id: 2, sku: "ETC:CS-SPOT", desc: "Spot", qty: 1, unit: "ea", cost: 1, price: 2, manufacturerModelNumber: "CS Spot Jr" },
        { id: 3, sku: "NOPART", desc: "Gone", qty: 1, unit: "ea", cost: 1, price: 2 },
      ],
      keyProducts: [
        { lineKey: "1", sku: "Symetrix:Jupiter 4", text: "", photo: true },
        { lineKey: "2", sku: "ETC:CS-SPOT", text: "", photo: true },
        { lineKey: "3", sku: "NOPART", text: "", photo: true },
      ] },
    { id: "s2", name: "Rig", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 9, sku: "ASM-1", desc: "Assembly", qty: 1, unit: "ea", cost: 1, price: 2 }] },
  ] as unknown as SpecSection[];
  const doc = { type: "doc", version: 1, content: [{ type: "productImage", attrs: { sectionId: "s2", lineKey: "9", sku: "ASM-1", align: "auto", width: 34 } }] } as never;
  const parts = new Map([
    ["Symetrix:Jupiter 4", { sku: "Symetrix:Jupiter 4", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" }],
    ["ETC:CS-SPOT", { sku: "ETC:CS-SPOT", manufacturerModelNumber: "CS Spot" }],
    ["ETC:MEMBER", { sku: "ETC:MEMBER", manufacturerPartNumber: "7460A1001" }],
  ]);
  const m = keyProductModelsFor({ sections, document: doc, skus: ["Symetrix:Jupiter 4", "ETC:CS-SPOT", "NOPART", "ASM-1", "line:4", "__proto__"], parts, readSku: (s) => (s === "ASM-1" ? "ETC:MEMBER" : s) });
  ok(m["Symetrix:Jupiter 4"] === "Jupiter 4", "photo wrap: models → the catalog part's Model # (never the order #)");
  ok(m["ETC:CS-SPOT"] === "CS Spot Jr", "photo wrap: models → the line's own frozen Model # wins over the part's");
  ok(!Object.hasOwn(m, "NOPART") && !Object.hasOwn(m, "line:4") && !Object.hasOwn(m, "__proto__"), "photo wrap: models skip a sku with no live part, line tokens and __proto__");
  ok(m["ASM-1"] === "7460A1001", "photo wrap: an assembly line (package-doc anchor) reads its aliased member part");
}

export async function photoWrapPureChecks(ok: Ok) {
  spreadChecks(ok);
  modelChecks(ok);
}

export async function photoWrapDbChecks(_ok: Ok) {
  // Tasks 8 adds the generator checks here.
}

if (process.argv[1]?.endsWith("test-photo-wrap.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  photoWrapPureChecks(okf)
    .then(() => (db ? photoWrapDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-photo-wrap.ts`
Expected: FAIL — `Cannot find module '../src/lib/estimate-output/photo-spread'`.

- [ ] **Step 3: Add `lineOwnModel` to `src/lib/catalog-rename/sku.ts`** (append after `lineModel`)

```ts
/** A quote line's OWN printable model — its frozen Model #, else its MFR P/N, else "".
 *  Never the SKU: a placeholder photo's tag prints only a real model the line carries. */
export function lineOwnModel(line?: ModelLineLike | null): string {
  return line?.manufacturerModelNumber?.trim() || line?.manufacturerPartNumber?.trim() || "";
}
```

- [ ] **Step 4: Create `src/lib/estimate-output/photo-spread.ts`**

```ts
import type { CSSProperties } from "react";

/**
 * Estimate photo wrap (spec 2026-10-16 §1, §2) — where key-product photos sit
 * in a system's text and how a photo + its model tag are drawn. Pure;
 * client-safe (type-only React import). One rule for QuoteDocument (PDF,
 * portal, share v1), the package page and the package document.
 *
 * A system's text is a list of UNITS (each narrative block, then each key
 * product as one unit). Photo k anchors before unit k; photos past the last
 * unit all anchor before the last unit (they stack); with no units every
 * photo anchors at 0. The system body is the only float container.
 */

export type PhotoAlign3 = "left" | "right" | "full";

export const PHOTO_TAG_BG = "rgba(22,24,29,.86)";

export function spreadPhotoAnchors(unitCount: number, photoCount: number): number[] {
  const units = Number.isFinite(unitCount) && unitCount > 0 ? Math.floor(unitCount) : 0;
  const n = Number.isFinite(photoCount) && photoCount > 0 ? Math.floor(photoCount) : 0;
  const last = Math.max(0, units - 1);
  return Array.from({ length: n }, (_, k) => Math.min(k, last));
}

/** The figure carries the float (or the full-width block) and is the tag's positioning box. */
export function photoFigureStyle(align: PhotoAlign3, widthPct = 34): CSSProperties {
  const width = `${widthPct}%`;
  if (align === "full") return { display: "block", width, margin: "0 auto 10px", position: "relative", breakInside: "avoid" };
  return align === "left"
    ? { float: "left", width, margin: "0 14px 8px 0", position: "relative", breakInside: "avoid" }
    : { float: "right", width, margin: "0 0 8px 14px", position: "relative", breakInside: "avoid" };
}

/** The image fills the figure's width, height-capped; a height-capped image is pushed to the
 *  figure's outer side (only horizontal letterboxing can happen with height:auto) so the corner tag sits on it. */
export function photoImgStyle(align: PhotoAlign3, maxHeight = "2.4in"): CSSProperties {
  return { display: "block", width: "100%", maxHeight, objectFit: "contain", objectPosition: align === "left" ? "left top" : align === "right" ? "right top" : "center top" };
}

/** The model tag: outer bottom corner (bottom-left on a left float, else bottom-right). */
export function photoTagStyle(align: PhotoAlign3, fontPx?: number): CSSProperties {
  return {
    position: "absolute",
    bottom: 0,
    ...(align === "left" ? { left: 0 } : { right: 0 }),
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "2px 6px",
    background: PHOTO_TAG_BG,
    color: "#fff",
    fontFamily: "var(--font-mono)",
    ...(fontPx ? { fontSize: fontPx } : {}),
    lineHeight: 1.35,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}
```

- [ ] **Step 5: Create `src/lib/estimate-output/photo-models.ts`**

```ts
import { isLineToken, resolveKeyProducts } from "@/app/(app)/estimator/narrative";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { lineModel, partModel, type ModelPartLike } from "@/lib/catalog-rename/sku";
import { findLine, findSection } from "@/lib/package-doc/chips";
import { docLineNodes } from "@/lib/package-doc/text";
import type { PackageDoc } from "@/lib/package-doc/types";

/**
 * Estimate photo wrap (spec 2026-10-16 §2) — the model-number tag on a
 * key-product photo. Customer documents print the Model # only (#304):
 * `lineModel(line, part)`. A placeholder image (allowance / custom device)
 * is tagged only with the line's own Model # / MFR P/N. Pure; client-safe.
 */

export const PHOTO_TAG_MAX = 60;

export function cleanTag(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, PHOTO_TAG_MAX) : "";
}

/** `ownPhoto`: the part's own photo or its manufacturer's image (not a kind placeholder).
 *  `partModel`: the server's part-aware lineModel for that sku. `ownModel`: lineOwnModel(line). */
export function photoTagText(i: { ownPhoto: boolean; partModel?: string | null; ownModel?: string | null }): string {
  const own = cleanTag(i.ownModel);
  return i.ownPhoto ? cleanTag(i.partModel) || own : own;
}

/**
 * sku → tag text for the photo skus a document prints, built next to the
 * photo read: the first printing line for each sku (a system's key product,
 * else a package-document anchor) and its live catalog part, read under
 * `readSku` (an assembly line's aliased member — the part whose photo prints).
 * Skips line tokens, skus with no live part, empty models and `__proto__`.
 */
export function keyProductModelsFor(i: {
  sections: readonly SpecSection[];
  document?: PackageDoc | null;
  skus: readonly string[];
  parts: ReadonlyMap<string, ModelPartLike>;
  readSku?: (sku: string) => string;
}): Record<string, string> {
  const want = new Set((i.skus || []).filter((s) => typeof s === "string" && s && s !== "__proto__" && !isLineToken(s)));
  const lineOf = new Map<string, SpecItem>();
  for (const sec of Array.isArray(i.sections) ? i.sections : []) {
    if (!sec) continue;
    for (const r of resolveKeyProducts(sec)) if (r.status === "ok" && want.has(r.kp.sku) && !lineOf.has(r.kp.sku)) lineOf.set(r.kp.sku, r.item);
  }
  for (const n of docLineNodes(i.document)) {
    const a = n.attrs;
    const s = a?.sku;
    if (typeof s !== "string" || !want.has(s) || lineOf.has(s)) continue;
    const line = findLine(findSection(i.sections, a.sectionId), a.lineKey);
    if (line) lineOf.set(s, line);
  }
  const read = i.readSku ?? ((s: string) => s);
  const out: Record<string, string> = {};
  for (const sku of want) {
    const part = i.parts.get(read(sku));
    if (!part) continue;
    const line = lineOf.get(sku);
    const m = cleanTag(line ? lineModel(line, part) : partModel(part));
    if (m) out[sku] = m;
  }
  return out;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx scripts/test-photo-wrap.ts`
Expected: `17 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)` (the count is whatever the file holds; 0 FAIL is the bar).

- [ ] **Step 7: Wire into the harness**

In `scripts/test-review-and-spec.ts`, after the line `import { oct15PureChecks, oct15DbChecks, discardConfirmChecks } from "./test-oct15-estimating";` (≈11356) add:

```ts
import { photoWrapPureChecks, photoWrapDbChecks } from "./test-photo-wrap";
```

and in the chain, change `.then(() => oct15PureChecks(ok)).then(() => discardConfirmChecks(ok)).then(() => oct15DbChecks(ok))` (≈11734) to:

```ts
  .then(() => oct15PureChecks(ok)).then(() => discardConfirmChecks(ok)).then(() => oct15DbChecks(ok))
  .then(() => photoWrapPureChecks(ok)).then(() => photoWrapDbChecks(ok))
```

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit -p .` → no errors.

```bash
git add src/lib/estimate-output/photo-spread.ts src/lib/estimate-output/photo-models.ts src/lib/catalog-rename/sku.ts scripts/test-photo-wrap.ts scripts/test-review-and-spec.ts
git commit -m "feat(photo-wrap): pure photo anchors, figure/tag styles and model-tag text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: QuoteDocument — photos spread through the narrative, model tags, and the models read

**Files:**
- Modify: `src/app/(app)/estimator/narrative.ts:397-421` (`PrintableKeyProduct.ownModel`)
- Modify: `src/app/(app)/estimator/quote-document.tsx` (imports 1-13; props 29-104; `QUOTE_PRINT_CSS` 108-118; `QUOTE_WEB_CSS` 126-145; `QUOTE_WEB_EMBED_CSS` 147-160; `renderNarrativeBlocks` 193-213; `keyProductPhoto` + `SystemBody` 494-566; package-doc ctx 846-853)
- Modify: `src/app/(app)/estimator/quote-document-view.ts:122-127` (remove `keyProductPhotoStyle`)
- Modify: `src/lib/narrative/photos.ts:56-104` (extract `photoReadPlan`, add `loadKeyProductModels`)
- Modify: `src/app/print/quote/[id]/page.tsx:76-83`
- Modify: `src/lib/quote-pdf/document-loader.ts:73-90`
- Modify (pins): `scripts/test-review-and-spec.ts:49010, 49112, 49990`; `scripts/test-oct15-estimating.ts:40, 117-121`
- Regenerate: `docs/superpowers/fixtures/p5-quote-document-no-document.json` (+ note in `scripts/qdp5-baseline.ts`)
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes (Task 1): `spreadPhotoAnchors`, `photoFigureStyle`, `photoImgStyle`, `photoTagStyle`, `photoTagText`, `keyProductModelsFor`, `lineOwnModel`.
- Produces:
  - `PrintableKeyProduct.ownModel?: string` (present only when non-empty)
  - `QuoteDocumentProps.keyProductModels?: Record<string, string>` — sku → tag text, same keys as `keyProductPhotos`
  - `photoReadPlan(sections: SpecSection[], document?: PackageDoc | null): { kpSections: SpecSection[]; docSkus: string[]; skus: string[]; read: (sku: string) => string }` (`src/lib/narrative/photos.ts`)
  - `loadKeyProductModels(sections: SpecSection[], document?: PackageDoc | null): Promise<Record<string, string>>` — never throws (`src/lib/narrative/photos.ts`)
  - DOM: `<figure class="est-ph">` (float, tag box) → `<img>` + optional `<span class="est-ph-tag">`; product units keep `class="est-kp"`; a narrative system body that prints a photo gets `display:flow-root` (appended last to its inline style, so photo-less systems render byte-for-byte as before).

- [ ] **Step 1: Write the failing tests** — append to `scripts/test-photo-wrap.ts` and call `quoteDocPhotoChecks(ok)` from `photoWrapPureChecks`:

```ts
import { qd293Props, qd293Sections, quoteDocumentModule293, renderQuoteDocument293 } from "./qd293-cases";
import { printableKeyProducts } from "../src/app/(app)/estimator/narrative";

function wrapSections(): SpecSection[] {
  return qd293Sections().map((s) =>
    s.id === "s2"
      ? {
          ...s,
          narrative: "Para one.\n\nPara two.\n\nPara three.",
          items: s.items.map((it) => (it.id === 6 ? { ...it, manufacturerPartNumber: "PN-6" } : it)),
          keyProducts: [
            { lineKey: "5", sku: "SKU-5", text: "Five.", photo: true },
            { lineKey: "6", sku: "SKU-6", text: "Six.", photo: true },
          ],
        }
      : s
  );
}
const PHOTOS = { "SKU-5": { src: "data:image/png;base64,QUFB", alt: "Five" }, "SKU-6": { src: "data:image/png;base64,QkJC", alt: "Six" } };

function quoteDocPhotoChecks(ok: Ok) {
  const html = renderQuoteDocument293({ ...qd293Props({ sections: wrapSections() }), keyProductPhotos: PHOTOS, keyProductModels: { "SKU-5": "Jupiter 4" } });
  const f1 = html.indexOf('<figure class="est-ph"'), f2 = html.indexOf('<figure class="est-ph"', f1 + 1);
  const p1 = html.indexOf(">Para one.<"), p2 = html.indexOf(">Para two.<"), p3 = html.indexOf(">Para three.<");
  ok(f1 > 0 && f2 > 0 && f1 < p1 && p1 < f2 && f2 < p2 && p2 < p3 && html.indexOf('<figure class="est-ph"', f2 + 1) === -1,
    "photo wrap (doc): photo 1 sits at the first paragraph, photo 2 at the next — the system narrative wraps them");
  ok(/<figure class="est-ph" style="float:right;width:34%;margin:0 0 8px 14px;position:relative;break-inside:avoid">/.test(html.slice(f1)) &&
     /^<figure class="est-ph" style="float:left;width:34%;margin:0 14px 8px 0/.test(html.slice(f2)),
    "photo wrap (doc): sides still alternate right, left");
  ok(html.slice(f1, f2).includes('class="est-ph-tag"') && html.slice(f1, f2).includes(">Jupiter 4</span>") && html.slice(f1, f2).includes("font-size:9px") &&
     html.slice(f2, p2).includes(">PN-6</span>") && html.slice(f2, p2).includes("left:0"),
    "photo wrap (doc): each photo carries its model tag on the outer bottom corner (9px in print); no part read → the line's own model");
  ok((html.match(/class="est-kp" style="margin-top:12px"/g) || []).length === 2 && !/class="est-kp" style="display:flow-root/.test(html),
    "photo wrap (doc): a key product is a plain block (no longer its own float box)");
  const sysDiv = html.lastIndexOf("<div", f1);
  ok(html.slice(sysDiv, f1).includes("display:flow-root"), "photo wrap (doc): the system body is the float container");
  const plain = renderQuoteDocument293(qd293Props());
  ok(!plain.includes("display:flow-root") && !plain.includes("est-ph"), "photo wrap (doc): a system with no photo renders with no float container");
  const web = renderQuoteDocument293({ ...qd293Props({ sections: wrapSections() }), keyProductPhotos: PHOTOS, keyProductModels: { "SKU-5": "Jupiter 4" }, layout: "web" });
  ok(web.includes("font-size:10px") && web.includes(">Jupiter 4</span>"), "photo wrap (doc): the web tag is 10px");
  const noModels = renderQuoteDocument293({ ...qd293Props({ sections: wrapSections().map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, manufacturerPartNumber: undefined })) })) }), keyProductPhotos: PHOTOS });
  ok(noModels.includes('<figure class="est-ph"') && !noModels.includes("est-ph-tag"), "photo wrap (doc): no model anywhere → no tag");

  // Placeholders: an allowance block prints its placeholder; tagged only with the line's own model.
  const allow = (own?: string) => qd293Sections().map((s) =>
    s.id === "s2" ? { ...s, items: [...s.items, { id: 12, sku: "ALLOW-1", desc: "Rigging allowance", qty: 1, unit: "ls", cost: 1, price: 2, allowance: true, ...(own ? { manufacturerModelNumber: own } : {}) }],
      keyProducts: [{ lineKey: "12", sku: "ALLOW-1", text: "", photo: true }] } : s) as SpecSection[];
  const a0 = renderQuoteDocument293({ ...qd293Props({ sections: allow() }), keyProductPhotos: {}, keyProductModels: { "ALLOW-1": "SHOULD-NOT-PRINT" } });
  const a1 = renderQuoteDocument293({ ...qd293Props({ sections: allow("AL-500") }), keyProductPhotos: {} });
  ok(a0.includes("/placeholders/allowance.webp") && !a0.includes("est-ph-tag") && a1.includes(">AL-500</span>"),
    "photo wrap (doc): a placeholder is tagged only when its line has a real model number");
  ok(printableKeyProducts(allow("AL-500").find((s) => s.id === "s2")!)[0].ownModel === "AL-500" && !("ownModel" in printableKeyProducts(allow().find((s) => s.id === "s2")!)[0]),
    "photo wrap (doc): printable key products carry the line's own model only when it has one");

  const { QUOTE_PRINT_CSS } = quoteDocumentModule293();
  const webCss = (quoteDocumentModule293() as unknown as { QUOTE_WEB_CSS: string; QUOTE_WEB_EMBED_CSS: string });
  ok(QUOTE_PRINT_CSS.includes(".est-doc .est-kp { break-inside: avoid; page-break-inside: avoid; }") && QUOTE_PRINT_CSS.includes(".est-doc .est-ph { break-inside: avoid; page-break-inside: avoid; }"),
    "photo wrap (doc): print keeps a product heading with its lines and never splits a photo");
  for (const css of [webCss.QUOTE_WEB_CSS, webCss.QUOTE_WEB_EMBED_CSS])
    ok(/@media \(max-width: 480px\)[\s\S]*\.est-web \.est-ph \{ float: none !important; display: block; width: 100% !important; margin: 0 0 10px 0 !important; \}/.test(css) && !css.includes(".est-kp img"),
      "photo wrap (doc): a phone puts each photo full width (web + embedded CSS)");

  const pr = rd("src/app/print/quote/[id]/page.tsx"), loader = rd("src/lib/quote-pdf/document-loader.ts");
  ok(pr.includes("loadKeyProductModels(doc.sections, doc.document)") && loader.includes("loadKeyProductModels(doc.sections, doc.document)") && pr.includes("keyProductModels={keyProductModels}"),
    "photo wrap (doc): the print route and the portal/share loader read the models beside the photos");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-photo-wrap.ts`
Expected: FAIL lines starting `photo wrap (doc):` (no `est-ph` yet; `keyProductModels` is an unknown prop — tsx does not type-check, so it runs).

- [ ] **Step 3: `PrintableKeyProduct.ownModel`** — in `src/app/(app)/estimator/narrative.ts` add `import { lineOwnModel } from "@/lib/catalog-rename/sku";` and change the type + builder (397-421):

```ts
export type PrintableKeyProduct = {
  sku: string;
  heading: string;
  blocks: NarrativeBlock[];
  photo: boolean;
  /** An allowance / custom line: what prints when the block has no photo of
   *  its own (Manufacturer section Part 1). Absent on every other block. */
  placeholder?: "allowance" | "custom-device";
  /** Photo wrap (2026-10-16): the line's own Model # / MFR P/N — the only tag a placeholder photo may carry. Absent when blank. */
  ownModel?: string;
};
/** What prints for a narrative system: resolved "ok" blocks in order. */
export function printableKeyProducts(sec: SpecSection): PrintableKeyProduct[] {
  return resolveKeyProducts(sec).flatMap((r) => {
    if (r.status !== "ok") return [];
    const ownModel = lineOwnModel(r.item);
    return [
      {
        sku: r.kp.sku,
        heading: keyProductHeading(r.item),
        blocks: narrativeBlocks(typeof r.kp.text === "string" ? r.kp.text : ""),
        photo: r.kp.photo !== false,
        ...(r.item.allowance ? { placeholder: "allowance" as const } : r.item.custom ? { placeholder: "custom-device" as const } : {}),
        ...(ownModel ? { ownModel } : {}),
      },
    ];
  });
}
```

(`catalog-rename/sku.ts` imports nothing, so there is no import cycle.)

- [ ] **Step 4: QuoteDocument** — `src/app/(app)/estimator/quote-document.tsx`:

(a) Imports: replace `alternatingPhotoSides, documentAppendixSystemIds, keyProductPhotoStyle, printedGroupHeadings` with `alternatingPhotoSides, documentAppendixSystemIds, printedGroupHeadings`, and add:

```ts
import { photoFigureStyle, photoImgStyle, photoTagStyle, spreadPhotoAnchors } from "@/lib/estimate-output/photo-spread";
import { photoTagText } from "@/lib/estimate-output/photo-models";
```

(b) Props: after `keyProductPhotos?` add

```ts
  /** Photo wrap (2026-10-16 §2) — sku → the model-number tag a key-product
   *  photo carries (same keys as keyProductPhotos; built server-side beside
   *  the photos, loadKeyProductModels). Absent = no part-aware tags. */
  keyProductModels?: Record<string, string>;
```

(c) `QUOTE_PRINT_CSS`: after the `.est-kp` line add
`.est-doc .est-ph { break-inside: avoid; page-break-inside: avoid; }`

(d) `QUOTE_WEB_CSS` **and** `QUOTE_WEB_EMBED_CSS`: replace the 480px line
`  .est-web .est-kp img { float: none !important; display: block; width: 100% !important; max-height: 3in !important; margin: 0 0 10px 0 !important; }`
with
```
  .est-web .est-ph { float: none !important; display: block; width: 100% !important; margin: 0 0 10px 0 !important; }
  .est-web .est-ph img { max-height: 3in !important; }
```

(e) Replace `renderNarrativeBlocks` with a single-block renderer plus the list form (same markup):

```tsx
/** #281 blocks — blank line = paragraph, "- " = bullet, single breaks kept. */
function renderNarrativeBlock(b: NarrativeBlock, bi: number) {
  return b.kind === "ul" ? (
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
  );
}
function renderNarrativeBlocks(blocks: NarrativeBlock[]) {
  return blocks.map(renderNarrativeBlock);
}
```

(f) Replace `keyProductPhoto` and the narrative branch of `SystemBody` (494-536) with:

```tsx
/** The photo a key product prints (own photo, else its placeholder), or undefined — one rule for SystemBody and the
 *  document-order alternation (Jeff 2026-10-15 #20). `own` = the part's own photo / manufacturer image. */
function keyProductPhotoOf(kp: DocSystem["keyProducts"][number], p: QuoteDocumentProps): { src: string; alt: string; own: boolean } | undefined {
  const own = kp.photo ? p.keyProductPhotos?.[kp.sku] : undefined;
  if (own) return { ...own, own: true };
  return kp.photo && kp.placeholder ? { src: PLACEHOLDER_SRC[kp.placeholder], alt: "", own: false } : undefined;
}
function keyProductPhoto(kp: DocSystem["keyProducts"][number], p: QuoteDocumentProps) {
  return keyProductPhotoOf(kp, p);
}

/** Photo wrap — one printed photo: the figure floats, the img fills it, the model tag sits on the outer bottom corner. */
function PhotoFigure({ src, alt, side, model, web }: { src: string; alt: string; side: "left" | "right"; model: string; web: boolean }) {
  return (
    <figure className="est-ph" style={photoFigureStyle(side)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} style={photoImgStyle(side)} />
      {model ? (
        <span className="est-ph-tag" style={photoTagStyle(side, web ? 10 : 9)}>
          {model}
        </span>
      ) : null}
    </figure>
  );
}

function SystemBody({ ps, p, lineCols, freightRowLabel, alternate, photoSides }: { ps: DocSystem; p: QuoteDocumentProps; lineCols: string; freightRowLabel: string; alternate?: boolean; photoSides?: ReadonlyMap<string, "right" | "left"> }) {
  const isItemized = p.detail === "itemized";
  const showLines = p.pdfQty || p.pdfNotes || p.pdfPrices;
  if (ps.presentation === "narrative") {
    const blocks = narrativeBlocks(ps.narrative);
    // Photo wrap (2026-10-16 §1): the system's photo'd key products, in order, spread down its text.
    const shown = ps.keyProducts.flatMap((kp) => {
      const photo = keyProductPhotoOf(kp, p);
      return photo ? [{ kp, photo }] : [];
    });
    return (
      <div style={{ padding: "10px 13px 12px", fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.55, borderBottom: "1px solid #f0f1f4", ...(shown.length ? { display: "flow-root" as const } : {}) }}>
        {/* #281: blank line = paragraph, "- " = bullet, single breaks kept.
            #293: then each key product — heading + paragraph. Photo wrap: photo k
            floats before text unit k (spreadPhotoAnchors); the system body is the
            only float container. */}
        {(() => {
          // Phase 2b: an empty alternate never claims to be "included in the total".
          if (!blocks.length && !ps.keyProducts.length)
            return alternate ? "Scope and pricing for this alternate are shown above." : "System scope and pricing are included in the total above.";
          const units = [
            ...blocks.map((b, bi) => renderNarrativeBlock(b, bi)),
            ...ps.keyProducts.map((kp, ki) => (
              <div key={"kp-" + kp.sku} className="est-kp" style={{ marginTop: blocks.length || ki ? 12 : 0 }}>
                <div style={{ fontWeight: 600, color: "#16181d", marginBottom: kp.blocks.length ? 3 : 0 }}>{kp.heading}</div>
                {renderNarrativeBlocks(kp.blocks)}
              </div>
            )),
          ];
          const anchors = spreadPhotoAnchors(units.length, shown.length);
          const models = p.keyProductModels;
          return units.map((u, ui) => (
            <Fragment key={"u" + ui}>
              {shown.map((s, k) =>
                anchors[k] === ui ? (
                  <PhotoFigure
                    key={"ph-" + s.kp.sku}
                    src={s.photo.src}
                    alt={s.photo.alt}
                    side={photoSides?.get(ps.id + "|" + s.kp.sku) ?? "right"}
                    model={photoTagText({ ownPhoto: s.photo.own, partModel: models && Object.hasOwn(models, s.kp.sku) ? models[s.kp.sku] : null, ownModel: s.kp.ownModel })}
                    web={p.layout === "web"}
                  />
                ) : null
              )}
              {u}
            </Fragment>
          ));
        })()}
      </div>
    );
  }
  return isItemized && showLines ? (
```

Keep the rest of `SystemBody` (the itemized / sectioned branches) exactly as it is, closing the function with `: null;` then `}` instead of the old `)` expression. `photoSides` keys and `keyProductPhoto(...)` calls in `QuoteDocument` (the alternation, ≈603-607) stay unchanged.

(g) Package document ctx (≈846-853): add `models: p.keyProductModels,` after `photos: p.keyProductPhotos,` (Task 4 makes `PackageDocCtx` accept it; until then add the field to `PackageDocCtx` now as `models?: Record<string, string>;` in `src/lib/package-doc/resolve.ts:39-48` so this compiles).

- [ ] **Step 5: Drop `keyProductPhotoStyle`** from `src/app/(app)/estimator/quote-document-view.ts` (lines 122-127) — `photoFigureStyle` / `photoImgStyle` replace it. `grep -rn keyProductPhotoStyle src scripts` must list only the oct15 test (fixed in Step 8).

- [ ] **Step 6: Server read of the models** — `src/lib/narrative/photos.ts`:

Add imports `import { getManyBySku } from "@/lib/stores/catalog";` and `import { keyProductModelsFor } from "@/lib/estimate-output/photo-models";`. Extract the sku plan out of `keyProductPhotoDocs` and add the models loader:

```ts
/** The photo skus a document prints and how each is read (#332 assembly alias) — keyProductPhotoDocs' plan, shared
 *  with loadKeyProductModels so the tags come from exactly the parts whose photos print. */
export function photoReadPlan(sections: SpecSection[], document?: PackageDoc | null): { kpSections: SpecSection[]; docSkus: string[]; skus: string[]; read: (sku: string) => string } {
  const kpSections = keyProductPrintSections(sections, document);
  const docSkus = documentApplies(document) ? docPhotoSkus(document) : [];
  const skus = [...photoSkusOf(kpSections)];
  for (const s of docSkus) if (!skus.includes(s)) skus.push(s);
  const readSkuOf = photoAliases(sections, skus);
  return { kpSections, docSkus, skus, read: (sku: string) => readSkuOf.get(sku) ?? sku };
}

/** Photo wrap (2026-10-16 §2) — sku → model tag for the printed photo skus, one batched catalog read
 *  (run beside the photo read). Never throws: a failure prints the photos untagged. */
export async function loadKeyProductModels(sections: SpecSection[], document?: PackageDoc | null): Promise<Record<string, string>> {
  try {
    const { skus, read } = photoReadPlan(sections, document);
    if (!skus.length) return {};
    const parts = await getManyBySku([...new Set(skus.map(read))]);
    return keyProductModelsFor({ sections, document: documentApplies(document) ? document : null, skus, parts, readSku: read });
  } catch (e) {
    console.warn("[narrative] key-product models unavailable", e instanceof Error ? e.message : e);
    return {};
  }
}
```

and change the head of `keyProductPhotoDocs` to use it:

```ts
export async function keyProductPhotoDocs(sections: SpecSection[], document?: PackageDoc | null): Promise<Map<string, PartDocument>> {
  const { kpSections, docSkus, skus, read } = photoReadPlan(sections, document);
  const out = new Map<string, PartDocument>();
  if (!skus.length) return out;
  // #304: keyed by the sku the section names — a sent revision keeps a
  // renamed part's old SKU, and its photo is found under the new one.
  const { parts, images } = await partsAndImagesBySku([...new Set(skus.map(read))]);
```

(the rest of the function body is unchanged; it already uses `read`, `kpSections`, `docSkus`.)

- [ ] **Step 7: Plumb the models from every server caller of QuoteDocument**

`src/app/print/quote/[id]/page.tsx` — import `loadKeyProductModels` alongside `keyProductPhotoDataUris` from `@/lib/narrative/photos`, and replace lines 79-83:

```tsx
  const [keyProductPhotos, keyProductModels] = await Promise.all([keyProductPhotoDataUris(doc.sections, doc.document), loadKeyProductModels(doc.sections, doc.document)]);
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      <QuoteDocument {...doc} keyProductPhotos={keyProductPhotos} keyProductModels={keyProductModels} rewardsLine={rewardsVisibleFor(addressee) ? purchasePerksDocLine(perks) : ""} />
```

`src/lib/quote-pdf/document-loader.ts` — import `loadKeyProductModels` from `@/lib/narrative/photos` and replace the photo lines (87-89):

```ts
  const [keyProductPhotos, keyProductModels] = await Promise.all([
    opts.photos === "inline" ? keyProductPhotoDataUris(doc.sections, doc.document) : keyProductPhotoLinks(doc.sections, opts.photos.href, doc.document),
    loadKeyProductModels(doc.sections, doc.document),
  ]);
  return { ...doc, keyProductPhotos, keyProductModels, rewardsLine: rewardsVisibleFor(addressee) ? purchasePerksDocLine(perks) : "" };
```

(The portal estimate page and the share page reach QuoteDocument only through this loader; `/estimator-preview`'s BOM tab and the Estimator's BOM quote tab print no photos — unchanged.)

- [ ] **Step 8: Update the old-layout pins deliberately**

`scripts/test-review-and-spec.ts`:
- ≈49010: replace `/@media \(max-width: 480px\)[\s\S]*\.est-web \.est-kp img \{ float: none !important;/.test(css)` with `/@media \(max-width: 480px\)[\s\S]*\.est-web \.est-ph \{ float: none !important;/.test(css)` and the message's "photo above its paragraph" with "photo full width".
- ≈49112: add `"loadKeyProductModels("` to the array of calls both the loader and the print route must contain.
- ≈49990: replace `/<img[^>]+float:right;width:34%/g` with `/<figure class="est-ph" style="float:right;width:34%/g` and `/<img[^>]+float:left;width:34%/g` with `/<figure class="est-ph" style="float:left;width:34%/g` (counts 2 and 1 stay).

`scripts/test-oct15-estimating.ts`:
- line 40: import `photoFigureStyle` from `../src/lib/estimate-output/photo-spread` instead of `keyProductPhotoStyle`.
- 117-118: `ok(photoFigureStyle("right").float === "right" && photoFigureStyle("right").margin === "0 0 8px 14px" && photoFigureStyle("left").float === "left" && photoFigureStyle("left").margin === "0 14px 8px 0", "oct15 #20: the first photo keeps #293's right float; the next mirrors it");`
- 120: replace `qd.includes("style={keyProductPhotoStyle(photoSides?.get(ps.id + \"|\" + kp.sku) ?? \"right\")}")` with `qd.includes("side={photoSides?.get(ps.id + \"|\" + s.kp.sku) ?? \"right\"}")`.

- [ ] **Step 9: Run the feature tests**

Run: `npx tsx scripts/test-photo-wrap.ts` → `… PASS, 0 FAIL`.
Run: `npx tsx scripts/test-oct15-estimating.ts` → `… PASS, 0 FAIL (pure only …)`.

- [ ] **Step 10: Re-capture the P5 baseline (deliberate) and prove only key-product cases moved**

The P5 fixture pins every key-product case to the boxed `.est-kp` layout, which this task replaces.

```bash
S=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/3339db5d-2963-4231-9e21-dd18a1d82e58/scratchpad
git show HEAD:docs/superpowers/fixtures/p5-quote-document-no-document.json > "$S/p5-before-t2.json"
npx tsx scripts/qdp5-baseline.ts
node -e 'const a=require(process.argv[1]),b=require(process.cwd()+"/docs/superpowers/fixtures/p5-quote-document-no-document.json");console.log(Object.keys(b).filter(k=>a[k]!==b[k]).sort().join(","))' "$S/p5-before-t2.json"
```

Expected exactly: `alternatesPrint,alternatesWebAppendix,keyProductsPrint,keyProductsWeb,sectionedAppendix` (the five cases with key products; every `p293-*` / `p2b-*` case unchanged). Anything else → stop and investigate. Then update the header comment of `scripts/qdp5-baseline.ts` to end: `Re-captured 2026-10-16 for the photo wrap (key products are plain blocks; photos are figures).`

- [ ] **Step 11: Full gate for this task**

Run: `npx tsc --noEmit -p .` → 0 errors.
Run: `npm run test:specs` → 0 FAIL (report the PASS count).
Run: `npx eslint "src/app/(app)/estimator/quote-document.tsx" "src/app/(app)/estimator/narrative.ts" "src/app/(app)/estimator/quote-document-view.ts" src/lib/narrative/photos.ts "src/app/print/quote/[id]/page.tsx" src/lib/quote-pdf/document-loader.ts src/lib/estimate-output/photo-*.ts` → 0 errors.
Run: `npx next build` → succeeds (QuoteDocument reaches the client through `steps/package-bom-tab.tsx`; `photos.ts` must stay out of it — it is imported only by server files).

- [ ] **Step 12: Commit**

```bash
git add -A src/app/\(app\)/estimator/narrative.ts src/app/\(app\)/estimator/quote-document.tsx src/app/\(app\)/estimator/quote-document-view.ts src/lib/package-doc/resolve.ts src/lib/narrative/photos.ts "src/app/print/quote/[id]/page.tsx" src/lib/quote-pdf/document-loader.ts scripts/test-photo-wrap.ts scripts/test-review-and-spec.ts scripts/test-oct15-estimating.ts scripts/qdp5-baseline.ts docs/superpowers/fixtures/p5-quote-document-no-document.json
git commit -m "feat(photo-wrap): estimate photos spread through the system narrative with model tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Package page — the same spread and tags

**Files:**
- Modify: `src/lib/estimate-output/package-model.ts:44, 92-104, 125-138` (`PackageKeyProduct.model`, `PackageViewInput.models`)
- Modify: `src/components/estimate-output/package-view.tsx:29-93` (CSS), `95-118` (`Blocks`), `120-155` (`Scope`)
- Modify: `src/lib/estimate-output/package-loader.ts:26-30`, `src/lib/estimate-output/package-live-loader.ts:62-68`
- Modify (pin): `scripts/test-oct15-estimating.ts:123`
- Regenerate: `docs/superpowers/fixtures/p2b-outputs-no-alternates.json`
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes: `spreadPhotoAnchors`, `photoTagText` (Task 1); `loadKeyProductModels` (Task 2); `PrintableKeyProduct.ownModel` (Task 2).
- Produces: `PackageKeyProduct.model?: string`; `PackageViewInput.models?: Record<string, string>`; DOM `div.pkg-body` (`.pkg-body-ph` when it prints a photo) → units; `figure.pkg-ph` (`.pkg-ph-left`) → `img` + `span.pkg-ph-tag`; `.pkg-kp` keeps holding heading + paragraphs + the datasheet slot.

- [ ] **Step 1: Write the failing tests** — append `packagePagePhotoChecks(ok)` and call it from `photoWrapPureChecks`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { packageViewModel } from "../src/lib/estimate-output/package-model";
import PackageView, { PACKAGE_LEFT_PHOTO_CSS, PACKAGE_WEB_CSS } from "../src/components/estimate-output/package-view";

function packagePagePhotoChecks(ok: Ok) {
  const doc = qd293Props({ sections: wrapSections() });
  const model = packageViewModel({ doc, photos: PHOTOS, models: { "SKU-5": "Jupiter 4" }, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "" },
    state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never, headerLine: "EST-1 · Rev 1", currentHref: null, view: "narrative", base: "/b", letterheadSrc: "/lh.jpg" });
  const s2 = model.scopes.find((s) => s.id === "s2")!;
  ok(s2.keyProducts[0].model === "Jupiter 4" && s2.keyProducts[1].model === "PN-6" && s2.keyProducts[1].side === "left", "photo wrap (package): key products carry their tag text and side");
  const html = renderToStaticMarkup(createElement(PackageView, { model, slots: { keyProductExtra: { "SKU-5": createElement("a", { href: "/ds" }, "Datasheet") } } }));
  const body = html.slice(html.indexOf('data-scope="s2"'));
  const f1 = body.indexOf('<figure class="pkg-ph"'), f2 = body.indexOf('<figure class="pkg-ph pkg-ph-left"');
  ok(body.includes('<div class="pkg-body pkg-body-ph">') && f1 > 0 && f1 < body.indexOf(">Para one.<") && body.indexOf(">Para one.<") < f2 && f2 < body.indexOf(">Para two.<"),
    "photo wrap (package): photos spread down the scope's text, alternating");
  ok(body.includes('<span class="pkg-ph-tag">Jupiter 4</span>') && body.includes('<span class="pkg-ph-tag">PN-6</span>') && body.includes('href="/ds"'),
    "photo wrap (package): tags print; the datasheet link stays under its key product");
  ok(PACKAGE_WEB_CSS.includes(".pkg-kp { margin-top: 14px; }") && !PACKAGE_WEB_CSS.includes("overflow: hidden; margin-top: 14px") &&
     PACKAGE_WEB_CSS.includes(".pkg-body-ph { display: flow-root; }") && PACKAGE_WEB_CSS.includes(".pkg-ph { float: right; width: 34%; margin: 0 0 8px 14px; position: relative;") &&
     PACKAGE_WEB_CSS.includes("background: rgba(22,24,29,.86)") && /@media print \{[\s\S]*\.pkg-ph-tag \{ font-size: 9px; \}/.test(PACKAGE_WEB_CSS) &&
     /@media \(max-width: 600px\) \{[\s\S]*\.pkg-ph \{ float: none; width: 100%; margin: 0 0 10px; \}/.test(PACKAGE_WEB_CSS),
    "photo wrap (package): the scope body is the float container; 34 % photos, dark tag (9px in print), full width on a phone");
  ok(PACKAGE_LEFT_PHOTO_CSS.includes(".pkg-ph.pkg-ph-left { float: left; margin: 0 14px 8px 0; }") && PACKAGE_LEFT_PHOTO_CSS.includes(".pkg-ph.pkg-ph-left .pkg-ph-tag { right: auto; left: 0; }"),
    "photo wrap (package): a left photo's tag sits bottom-left");
  for (const f of ["src/lib/estimate-output/package-loader.ts", "src/lib/estimate-output/package-live-loader.ts"])
    ok(rd(f).includes("loadKeyProductModels(packagePhotoSections(doc.sections), doc.document)") && rd(f).includes("models,"), `photo wrap (package): ${f} reads the models for every scope's key products`);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-photo-wrap.ts` → FAIL lines `photo wrap (package): …`.

- [ ] **Step 3: Model** — `src/lib/estimate-output/package-model.ts`:

Add `import { photoTagText } from "./photo-models";`. Type:

```ts
/** `side` (Jeff 2026-10-15 #20): "left" on every other printed photo — the page alternates right, left, right.
 *  `model` (photo wrap 2026-10-16): the photo's model-number tag; absent when none. */
export type PackageKeyProduct = { sku: string; heading: string; blocks: NarrativeBlock[]; photo: { src: string; alt: string } | null; side?: "left"; model?: string };
```

`PackageViewInput`: after `photos` add `/** Photo wrap — sku → model tag (loadKeyProductModels over packagePhotoSections). */ models?: Record<string, string>;`

Key-product mapping inside `packageViewModel` (replace 126-131):

```ts
      const keyProducts: PackageKeyProduct[] = s.keyProducts.map((kp) => {
        const own = kp.photo && Object.hasOwn(i.photos, kp.sku) ? i.photos[kp.sku] : undefined;
        const photo = kp.photo ? (own ?? (kp.placeholder ? { src: PLACEHOLDER_SRC[kp.placeholder], alt: "" } : null)) : null;
        const model = photo ? photoTagText({ ownPhoto: !!own, partModel: i.models && Object.hasOwn(i.models, kp.sku) ? i.models[kp.sku] : null, ownModel: kp.ownModel }) : "";
        return { sku: kp.sku, heading: kp.heading, blocks: kp.blocks, photo, ...(model ? { model } : {}) };
      });
```

(Task 4 adds `models: i.models` to the `resolvePackageDoc` ctx at the bottom of this function.)

- [ ] **Step 4: View** — `src/components/estimate-output/package-view.tsx`:

Add `import { spreadPhotoAnchors } from "@/lib/estimate-output/photo-spread";`.

`PACKAGE_LEFT_PHOTO_CSS` becomes:

```ts
export const PACKAGE_LEFT_PHOTO_CSS = `
.pkg-ph.pkg-ph-left { float: left; margin: 0 14px 8px 0; }
.pkg-ph.pkg-ph-left img { object-position: left top; }
.pkg-ph.pkg-ph-left .pkg-ph-tag { right: auto; left: 0; }
@media (max-width: 600px) {
  .pkg-ph.pkg-ph-left { float: none; margin: 0 0 10px; }
}
`;
```

In `PACKAGE_WEB_CSS` replace the two `.pkg-kp` lines (68-69) with:

```
.pkg-kp { margin-top: 14px; }
.pkg-body-ph { display: flow-root; }
.pkg-ph { float: right; width: 34%; margin: 0 0 8px 14px; position: relative; break-inside: avoid; page-break-inside: avoid; }
.pkg-ph img { display: block; width: 100%; max-height: 2.4in; object-fit: contain; object-position: right top; }
.pkg-ph-tag { position: absolute; bottom: 0; right: 0; max-width: 100%; box-sizing: border-box; padding: 2px 6px; background: rgba(22,24,29,.86); color: #fff; font-family: var(--font-mono); font-size: 10px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

the phone line `  .pkg-kp img { float: none; display: block; width: 100%; max-height: 3in; margin: 0 0 10px; }` with:

```
  .pkg-ph { float: none; width: 100%; margin: 0 0 10px; }
  .pkg-ph img { max-height: 3in; object-position: center top; }
```

and inside `@media print { … }` add `  .pkg-ph-tag { font-size: 9px; }`.

Split `Blocks` into a one-block renderer (same markup) and the list:

```tsx
function Block({ b }: { b: NarrativeBlock }) {
  return b.kind === "p" ? (
    <p className="pkg-p">
      {b.lines.map((l, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {l}
        </Fragment>
      ))}
    </p>
  ) : (
    <ul className="pkg-ul">
      {b.items.map((it, j) => (
        <li key={j}>{it}</li>
      ))}
    </ul>
  );
}

function Blocks({ blocks }: { blocks: NarrativeBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </>
  );
}

/** Photo wrap (2026-10-16 §1): the scope's text as units — intro blocks, then key products — with photo k before unit k. */
function ScopeBody({ s, extra }: { s: PackageScopeView; extra: Record<string, ReactNode> }) {
  const units: ReactNode[] = [
    ...s.intro.map((b, i) => <Block key={"i" + i} b={b} />),
    ...(s.fallback ? [<p key="fb" className="pkg-p">{s.fallback}</p>] : []),
    ...s.keyProducts.map((kp) => (
      <div key={kp.sku} className="pkg-kp">
        <h3>{kp.heading}</h3>
        <Blocks blocks={kp.blocks} />
        {extra[kp.sku]}
      </div>
    )),
  ];
  const shown = s.keyProducts.filter((kp) => !!kp.photo);
  const anchors = spreadPhotoAnchors(units.length, shown.length);
  return (
    <div className={shown.length ? "pkg-body pkg-body-ph" : "pkg-body"}>
      {units.map((u, ui) => (
        <Fragment key={ui}>
          {shown.map((kp, k) =>
            anchors[k] === ui && kp.photo ? (
              <figure key={"ph-" + kp.sku} className={kp.side === "left" ? "pkg-ph pkg-ph-left" : "pkg-ph"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={kp.photo.src} alt={kp.photo.alt} />
                {kp.model ? <span className="pkg-ph-tag">{kp.model}</span> : null}
              </figure>
            ) : null
          )}
          {u}
        </Fragment>
      ))}
    </div>
  );
}
```

In `Scope`, replace the `{!bom && ( <> …intro… keyProducts… </> )}` block (139-155) with `{!bom && <ScopeBody s={s} extra={extra} />}`. The `PACKAGE_LEFT_PHOTO_CSS` mount line (192) is unchanged.

- [ ] **Step 5: Loaders** — both read the models beside the photos:

`src/lib/estimate-output/package-loader.ts` — import `loadKeyProductModels` from `@/lib/narrative/photos`; replace the `Promise.all` (26-30) with:

```ts
  const [photos, models, catalog, defaults] = await Promise.all([
    keyProductPhotoLinks(packagePhotoSections(doc.sections), href, doc.document),
    loadKeyProductModels(packagePhotoSections(doc.sections), doc.document),
    catalogFor(packageBomSkus(doc.sections)),
    getEstimateOutputDefaults(),
  ]);
  return packageViewModel({
    doc,
    photos,
    models,
```

(rest unchanged). Same in `src/lib/estimate-output/package-live-loader.ts` `loadLivePackagePreview` (`const [photos, models, catalog, defaults, extras] = …` with `loadKeyProductModels(packagePhotoSections(doc.sections), doc.document)` second, and `models,` after `photos,`).

- [ ] **Step 6: Update the oct15 pin** — `scripts/test-oct15-estimating.ts:123`: replace the three package-view conditions with `pv.includes(".pkg-ph.pkg-ph-left { float: left;") && pv.includes("<style>{PACKAGE_LEFT_PHOTO_CSS}</style>}") && pv.includes('className={kp.side === "left" ? "pkg-ph pkg-ph-left" : "pkg-ph"}')` (keep the `package-model.ts` `"n++ % 2 === 1"` condition).

- [ ] **Step 7: Run feature tests** — `npx tsx scripts/test-photo-wrap.ts` and `npx tsx scripts/test-oct15-estimating.ts` → 0 FAIL.

- [ ] **Step 8: Re-capture the P2b outputs baseline (deliberate)** — its `pkgHtml` inlines `PACKAGE_WEB_CSS` and the scope markup.

```bash
S=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/3339db5d-2963-4231-9e21-dd18a1d82e58/scratchpad
git show HEAD:docs/superpowers/fixtures/p2b-outputs-no-alternates.json > "$S/p2bo-before-t3.json"
npx tsx scripts/outputs-p2b-baseline.ts
node -e 'const a=require(process.argv[1]),b=require(process.cwd()+"/docs/superpowers/fixtures/p2b-outputs-no-alternates.json");const out=new Set();for(const k of Object.keys(b))for(const f of Object.keys(b[k]))if(a[k][f]!==b[k][f])out.add(f);console.log([...out].sort().join(","))' "$S/p2bo-before-t3.json"
```

Expected exactly: `pkgHtml` (cover, coverHtml, pkg JSON and scopes unchanged). Add `Re-captured 2026-10-16 for the photo wrap (scope body + figure CSS).` to the header comment of `scripts/outputs-p2b-baseline.ts`.

- [ ] **Step 9: Gate** — `npx tsc --noEmit -p .`; `npm run test:specs` (0 FAIL); `npx eslint src/components/estimate-output/package-view.tsx src/lib/estimate-output/package-model.ts src/lib/estimate-output/package-loader.ts src/lib/estimate-output/package-live-loader.ts`; `npx next build`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/estimate-output/package-model.ts src/components/estimate-output/package-view.tsx src/lib/estimate-output/package-loader.ts src/lib/estimate-output/package-live-loader.ts scripts/test-photo-wrap.ts scripts/test-oct15-estimating.ts scripts/outputs-p2b-baseline.ts docs/superpowers/fixtures/p2b-outputs-no-alternates.json
git commit -m "feat(photo-wrap): package page photos spread through each scope with model tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Package document — unboxed product blocks, figures and tags (print view + TipTap editor)

**Files:**
- Modify: `src/lib/package-doc/resolve.ts:39-48` (ctx `models`, added in Task 2), `55-58` (`RProduct`, `RImage`), `97-129` (`product`, `productImageOf`)
- Modify: `src/components/package-doc/package-doc-view.tsx:43-55` (CSS), `95-137` (photo, `Product`, `ProductImage`)
- Modify: `src/lib/estimate-output/package-model.ts:159-161` (ctx `models`)
- Modify: `src/app/(app)/estimator/narrative.ts:87-101` (`KeyProductLibraryRow.modelPart`)
- Modify: `src/lib/narrative/library.ts:57-72` (rows carry `modelPart`)
- Modify: `src/components/package-doc/editor/editor-model.ts` (add `editorPhotoTag`)
- Modify: `src/components/package-doc/editor/product-block-view.tsx:134-160, 226-229`
- Modify: `src/components/package-doc/editor/product-image-view.tsx:120-135`
- Modify (pins): `scripts/test-review-and-spec.ts` ≈57909, ≈59309-59321, ≈59337-59341, ≈59424
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes: `photoFigureStyle`, `photoImgStyle`, `photoTagStyle`, `photoTagText`, `lineOwnModel` (Task 1); `PackageDocCtx.models` (declared in Task 2); `QuoteDocument` already passes `models: p.keyProductModels` (Task 2); `PackageViewInput.models` (Task 3).
- Produces:
  - `RProduct.model?: string`, `RImage.model?: string` (only when non-empty and the node prints a photo — old documents resolve byte-identically when `ctx.models` is absent and lines carry no model)
  - `photoModelOf(a: LineAnchor, ctx: Pick<PackageDocCtx, "sections" | "photos" | "models">): string` (`resolve.ts`, exported)
  - `KeyProductLibraryRow.modelPart?: { sku: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string }`
  - `editorPhotoTag(a: LineAnchor | null | undefined, sections: readonly SpecSection[], row?: KeyProductLibraryRow | null): string`
  - DOM: `div.pd-product` is always `display:block`; photos are `figure.pd-ph` → `img` + `span.pd-ph-tag`; `.pd-doc` is the float container (`display: flow-root`).

- [ ] **Step 1: Write the failing tests** — append `packageDocPhotoChecks(ok)` and call it from `photoWrapPureChecks`:

```ts
import { resolvePackageDoc } from "../src/lib/package-doc/resolve";
import PackageDocView, { PACKAGE_DOC_CSS } from "../src/components/package-doc/package-doc-view";
import { editorPhotoTag } from "../src/components/package-doc/editor/editor-model";

function packageDocPhotoChecks(ok: Ok) {
  const sections = wrapSections();
  const PB = (lineKey: string, sku: string, text: string, photo = { show: true, align: "right", width: 40 }) =>
    ({ type: "productBlock", attrs: { sectionId: "s2", lineKey, sku, photo }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const IMG = (lineKey: string, sku: string, align = "left") => ({ type: "productImage", attrs: { sectionId: "s2", lineKey, sku, align, width: 34 } });
  const doc = { type: "doc", version: 1, content: [PB("5", "SKU-5", "Five words."), { type: "paragraph", content: [{ type: "text", text: "After five." }] }, IMG("6", "SKU-6")] } as never;
  const ctx = { sections, t: { grand: 1, tax: 0, credit: 0 } as never, quoteId: "Q-1", photos: PHOTOS, models: { "SKU-5": "Jupiter 4" } };
  const r = resolvePackageDoc(doc, ctx);
  const prod = r.blocks[0] as { t: string; model?: string }, img = r.blocks[2] as { t: string; model?: string };
  ok(prod.t === "product" && prod.model === "Jupiter 4" && img.t === "image" && img.model === "PN-6", "photo wrap (pkg doc): resolved product blocks and images carry their tag text");
  const bare = resolvePackageDoc(doc, { ...ctx, models: undefined, sections: qd293Sections() });
  ok(!("model" in (bare.blocks[0] as object)) && !("model" in (bare.blocks[2] as object)), "photo wrap (pkg doc): no models and no line model → no `model` key (old documents resolve as before)");
  const html = renderToStaticMarkup(createElement(PackageDocView, { doc, ctx }));
  ok(html.includes('<div class="pd-product" data-sku="SKU-5" style="display:block;margin:12px 0"><figure class="pd-ph" style="float:right;width:40%;margin:0 0 8px 14px;position:relative;break-inside:avoid">') &&
     html.indexOf("Five words.") < html.indexOf("After five.") && !html.includes("display:flow-root;margin:12px 0"),
    "photo wrap (pkg doc): a product block with its photo is a plain block, so the following paragraphs keep wrapping");
  ok(html.includes('<span class="pd-ph-tag"') && html.includes(">Jupiter 4</span>") && html.includes('<div class="pd-image" data-sku="SKU-6"><figure class="pd-ph" style="float:left;width:34%') && html.includes(">PN-6</span>"),
    "photo wrap (pkg doc): product photos and product images both carry the tag");
  ok(PACKAGE_DOC_CSS.includes(".pd-doc { display: flow-root; }") && PACKAGE_DOC_CSS.includes(".pd-doc .pd-product { break-inside: avoid; page-break-inside: avoid; }") &&
     PACKAGE_DOC_CSS.includes(".pd-doc .pd-ph { break-inside: avoid; page-break-inside: avoid; }") && PACKAGE_DOC_CSS.includes(".pd-doc .pd-ph-tag { font-size: 10px; }") &&
     PACKAGE_DOC_CSS.includes("@media print { .pd-doc .pd-ph-tag { font-size: 9px; } }") && PACKAGE_DOC_CSS.includes("@media print { .pd-doc .pd-pagebreak { border-top: 0 !important; margin: 0 !important; } }") &&
     /@media \(max-width: 480px\) \{\s*\.pd-doc \.pd-ph \{ float: none !important; display: block !important; width: 100% !important; margin: 0 0 10px 0 !important; \}\s*\.pd-doc \.pd-ph img \{ max-height: 3in !important; \}\s*\}/.test(PACKAGE_DOC_CSS),
    "photo wrap (pkg doc): the document is the float container; tags 10px on screen, 9px in print; phones full width");

  // Editor: the same tag rule, from the library row.
  const row = { inCatalog: true, desc: "Five", paragraph: null, paragraphUpdatedAt: null, paragraphUpdatedBy: null, photoDocId: "PD-abcdef", fallbackDocId: null, fallbackLabel: null,
    modelPart: { sku: "SKU-5", manufacturerModelNumber: "Jupiter 4" } };
  const a5 = { sectionId: "s2", lineKey: "5", sku: "SKU-5" };
  ok(editorPhotoTag(a5, sections, row) === "Jupiter 4" && editorPhotoTag(a5, sections, { ...row, photoDocId: null }) === "" && editorPhotoTag({ sectionId: "s2", lineKey: "6", sku: "SKU-6" }, sections, null) === "",
    "photo wrap (editor): an own photo tags from the part; no photo source → no tag");
  const ED = "src/components/package-doc/editor";
  const pbv = rd(`${ED}/product-block-view.tsx`), iv = rd(`${ED}/product-image-view.tsx`);
  ok(pbv.includes('display: "block",') && !pbv.includes('"flow-root"') && pbv.includes("editorPhotoTag(block.attrs, sections, row)") && pbv.includes("photoTagStyle(photo.align, 10)"),
    "photo wrap (editor): a product block is never a float box in the editor either, and its photo shows the tag");
  ok(iv.includes("editorPhotoTag(a, sections, row)") && iv.includes("photoTagStyle("), "photo wrap (editor): a product image shows the tag");
  ok(rd("src/lib/narrative/library.ts").includes("modelPart:"), "photo wrap (editor): library rows carry the part's model fields");
}
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/test-photo-wrap.ts` → FAIL lines `photo wrap (pkg doc)` / `(editor)`.

- [ ] **Step 3: Resolver** — `src/lib/package-doc/resolve.ts`:

Imports: `import { lineOwnModel } from "@/lib/catalog-rename/sku";` and `import { photoTagText } from "@/lib/estimate-output/photo-models";`. Ctx field (if Task 2 added it bare, give it its comment): `/** Photo wrap — sku → model tag (loadKeyProductModels); absent = only the lines' own models. */ models?: Record<string, string>;`

Types:

```ts
export type RProduct = { t: "product"; sku: string; heading: string | null; photo: RPhoto | null; paras: RParagraph[]; /** Photo wrap — the photo's model tag (only with a photo). */ model?: string };
/** #312 — a product's photo on its own (no words, no heading). */
export type RImage = { t: "image"; sku: string; photo: RPhoto; /** Photo wrap — the photo's model tag. */ model?: string };
```

Helper (after `linePhotoSource`):

```ts
/** Photo wrap (2026-10-16 §2) — the tag on a line-anchored photo: the part-aware model for the part's own photo
 *  (photos[sku], incl. a manufacturer image), the line's own Model # / MFR P/N for a kind placeholder. */
export function photoModelOf(a: LineAnchor, ctx: Pick<PackageDocCtx, "sections" | "photos" | "models">): string {
  const sku = typeof a?.sku === "string" ? a.sku : "";
  const own = !!sku && !!ctx.photos && Object.hasOwn(ctx.photos, sku);
  const partModel = sku && ctx.models && Object.hasOwn(ctx.models, sku) ? ctx.models[sku] : null;
  return photoTagText({ ownPhoto: own, partModel, ownModel: lineOwnModel(findLine(findSection(ctx.sections, a?.sectionId ?? ""), a?.lineKey ?? "")) });
}
```

`product()` return (keep key order, `model` last):

```ts
  const model = src ? photoModelOf(a, ctx) : "";
  return {
    t: "product",
    sku: a.sku,
    heading: line ? keyProductHeading(line) : null,
    photo: src ? { src: src.src, alt: src.alt, align: alignOf(a.photo.align), width: clampPhotoWidth(a.photo.width) } : null,
    paras: (Array.isArray(b.content) ? b.content : []).map((p) => para(p, ctx)),
    ...(model ? { model } : {}),
  };
```

`productImageOf` — widen `ctx` to `Pick<PackageDocCtx, "sections" | "photos" | "models">` and return:

```ts
  if (!src) return null;
  const model = photoModelOf(a, ctx);
  return { t: "image", sku: a.sku, photo: { src: src.src, alt: src.alt, align: a.align === "auto" ? autoSide : alignOf(a.align), width: clampPhotoWidth(a.width) }, ...(model ? { model } : {}) };
```

`src/lib/estimate-output/package-model.ts` (≈160): add `models: i.models` to the `resolvePackageDoc` ctx object.

- [ ] **Step 4: View** — `src/components/package-doc/package-doc-view.tsx`:

Add `import { photoFigureStyle, photoImgStyle, photoTagStyle } from "@/lib/estimate-output/photo-spread";`. Update the header comment's productBlock line to "productBlock → bold heading …, the photo as a figure floated left/right at `width` % (or full) with its model tag; the block itself is a plain block (photo wrap 2026-10-16), so later paragraphs wrap too".

`PACKAGE_DOC_CSS`:

```ts
export const PACKAGE_DOC_CSS = `
.pd-doc { display: flow-root; }
.pd-doc .pd-product { break-inside: avoid; page-break-inside: avoid; }
.pd-doc h2, .pd-doc h3, .pd-doc h4 { break-after: avoid; page-break-after: avoid; }
.pd-doc h2, .pd-doc h3, .pd-doc h4, .pd-doc .pd-pagebreak { clear: both; }
.pd-doc .pd-image { clear: both; }
.pd-doc .pd-image, .pd-doc .pd-image .pd-ph { break-after: avoid; page-break-after: avoid; }
.pd-doc .pd-ph { break-inside: avoid; page-break-inside: avoid; }
.pd-doc .pd-ph-tag { font-size: 10px; }
.pd-doc .pd-price tr { break-inside: avoid; page-break-inside: avoid; }
@media print { .pd-doc .pd-pagebreak { border-top: 0 !important; margin: 0 !important; } }
@media print { .pd-doc .pd-ph-tag { font-size: 9px; } }
@media (max-width: 480px) {
  .pd-doc .pd-ph { float: none !important; display: block !important; width: 100% !important; margin: 0 0 10px 0 !important; }
  .pd-doc .pd-ph img { max-height: 3in !important; }
}
`;
```

Replace `photoStyle`, `Product` and `ProductImage` with:

```tsx
/** Photo wrap — a document photo: the figure floats left/right at `width` % (or is a centred full-width block),
 *  the image fills it (2.4in cap; 4in when full), the model tag sits on the outer bottom corner. */
function DocFigure({ ph, model }: { ph: RPhoto; model?: string }) {
  return (
    <figure className="pd-ph" style={photoFigureStyle(ph.align, ph.width)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ph.src} alt={ph.alt} style={photoImgStyle(ph.align, ph.align === "full" ? "4in" : "2.4in")} />
      {model ? (
        <span className="pd-ph-tag" style={photoTagStyle(ph.align)}>
          {model}
        </span>
      ) : null}
    </figure>
  );
}

function Product({ b, extra }: { b: RProduct; extra?: ReactNode }) {
  return (
    // Photo wrap (2026-10-16): always a plain block — its photo floats into the
    // paragraphs that follow too, like a product image; headings / page breaks clear it.
    <div className="pd-product" data-sku={b.sku} style={{ display: "block", margin: "12px 0" }}>
      {b.photo ? <DocFigure ph={b.photo} model={b.model} /> : null}
      {b.heading ? <div style={{ fontWeight: 600, color: INK, marginBottom: 3 }}>{b.heading}</div> : null}
      {b.paras.map((p, i) => (
        <Paragraph key={i} p={p} style={i === b.paras.length - 1 ? { margin: 0 } : undefined} />
      ))}
      {extra}
    </div>
  );
}

/** #312 — a product's photo on its own; the wrapper is a plain block, so the following paragraphs wrap beside it. */
function ProductImage({ b }: { b: RImage }) {
  return (
    <div className="pd-image" data-sku={b.sku}>
      <DocFigure ph={b.photo} model={b.model} />
    </div>
  );
}
```

(`RPhoto`'s `align` is `"left" | "right" | "full"`, which is `PhotoAlign3`.)

- [ ] **Step 5: Library rows + editor** —

`src/app/(app)/estimator/narrative.ts`: import `type ModelPartLike` from `@/lib/catalog-rename/sku` (same import line as `lineOwnModel`), and add to `KeyProductLibraryRow` after `viaSku?`:

```ts
  /** Photo wrap (2026-10-16) — the read part's model fields (the member's on a #332 alias row), so the editor tags a
   *  photo exactly as print does (lineModel). Absent when the sku is not a live catalog part. */
  modelPart?: ModelPartLike;
```

`src/lib/narrative/library.ts` — in the `out[sku] = { … }` object, after the `viaSku` spread:

```ts
      ...(p
        ? { modelPart: { sku: p.sku, ...(p.manufacturerModelNumber ? { manufacturerModelNumber: p.manufacturerModelNumber } : {}), ...(p.manufacturerPartNumber ? { manufacturerPartNumber: p.manufacturerPartNumber } : {}) } }
        : {}),
```

`src/components/package-doc/editor/editor-model.ts` — imports `import { lineModel, lineOwnModel } from "@/lib/catalog-rename/sku";` and `import { photoTagText } from "@/lib/estimate-output/photo-models";`; add after `linePhotoPreview`:

```ts
/** Photo wrap — the tag the editor shows on a line-anchored photo: linePhotoPreview's order (own photo → kind
 *  placeholder → manufacturer image); an own photo or manufacturer image tags from the part (lineModel), a
 *  placeholder only from the line's own Model # / MFR P/N; no photo → "". */
export function editorPhotoTag(a: LineAnchor | null | undefined, sections: readonly SpecSection[], row?: KeyProductLibraryRow | null): string {
  if (!a || !linePhotoPreview(a, sections, row)) return "";
  const line = findLine(findSection(sections, a.sectionId), a.lineKey);
  const own = !!row?.photoDocId || (!linePlaceholder(a, sections) && !!row?.fallbackDocId);
  return photoTagText({ ownPhoto: own, partModel: own && line && row?.modelPart ? lineModel(line, row.modelPart) : null, ownModel: lineOwnModel(line) });
}
```

`product-block-view.tsx`: import `editorPhotoTag` (with the other `./editor-model` names) and `import { photoFigureStyle, photoImgStyle, photoTagStyle } from "@/lib/estimate-output/photo-spread";`. Delete the `imgStyle` constant (134-139); add `const tag = editorPhotoTag(block.attrs, sections, row);` after `preview`. In the `NodeViewWrapper` style replace `display: photo.show ? "flow-root" : "block",` with `display: "block",`. Replace the preview `<img …>` block (226-229) with:

```tsx
      {ownPhoto && preview && (
        <figure contentEditable={false} style={photoFigureStyle(photo.align, photo.width)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.src} alt="" draggable={false} style={photoImgStyle(photo.align, photo.align === "full" ? "4in" : "2.4in")} />
          {tag ? <span style={photoTagStyle(photo.align, 10)}>{tag}</span> : null}
        </figure>
      )}
```

Update the component's doc comment: "Only a block that shows a photo is a flow-root" → "A block is never a flow-root (photo wrap 2026-10-16): its photo wraps the paragraphs after it, as in print."

`product-image-view.tsx`: import `editorPhotoTag` and `photoTagStyle`; add `const tag = editorPhotoTag(a, sections, row);` after `preview`. Inside the `data-drag-handle` div, right after the `<img …/>` branch's closing (i.e. inside `{preview ? (…) : (…)}` keep as is) add:

```tsx
        {preview && tag ? <span style={photoTagStyle(shown.align === "left" ? "left" : shown.align === "full" ? "full" : "right", 10)}>{tag}</span> : null}
```

(the drag-handle div is already `position: "relative"`.)

- [ ] **Step 6: Update the #312 / #P5 pins deliberately** — `scripts/test-review-and-spec.ts`:
- ≈57909: `html.includes('<div class="pd-doc"><style>\n.pd-doc .pd-product { display: flow-root')` → `html.includes('<div class="pd-doc"><style>\n.pd-doc { display: flow-root; }')`.
- ≈59309-59310: the two `pd-image` exact strings become
  `'<div class="pd-image" data-sku="SKU-5"><figure class="pd-ph" style="float:left;width:40%;margin:0 14px 8px 0;position:relative;break-inside:avoid"><img src="data:image/png;base64,I5" alt="Five" style="display:block;width:100%;max-height:2.4in;object-fit:contain;object-position:left top"/></figure></div>'` and
  `'<div class="pd-image" data-sku="line:2"><figure class="pd-ph" style="display:block;width:60%;margin:0 auto 10px;position:relative;break-inside:avoid"><img src="/placeholders/allowance.webp" alt="" style="display:block;width:100%;max-height:4in;object-fit:contain;object-position:center top"/></figure></div>'`; append "(photo wrap: as a figure)" to the message.
- ≈59314: `p5rCss.includes(".pd-doc .pd-image, .pd-doc .pd-image img { break-inside: avoid; page-break-inside: avoid; }")` → `p5rCss.includes(".pd-doc .pd-ph { break-inside: avoid; page-break-inside: avoid; }")`; the phone regex → `/@media \(max-width: 480px\) \{\s*\.pd-doc \.pd-ph \{ float: none !important; display: block !important; width: 100% !important; margin: 0 0 10px 0 !important; \}\s*\.pd-doc \.pd-ph img \{ max-height: 3in !important; \}\s*\}/.test(p5rCss)`.
- ≈59319: `printed.includes('<div class="pd-image" data-sku="SKU-5"><img src="data:image/png;base64,I5P"')` → `printed.includes('<div class="pd-image" data-sku="SKU-5"><figure class="pd-ph"') && printed.includes('src="data:image/png;base64,I5P"')`.
- ≈59335 (`nowJson === OLD_JSON`): unchanged — must still pass (no `models` in `oldCtx`, no line models).
- ≈59337-59341: replace the `wantHtml` comparison with the intended change:

```ts
  // Photo wrap (2026-10-16): every product block is a plain block now and each photo is a figure — same words, same photos.
  const textOf = (h: string) => h.replace(/<[^>]+>/g, "");
  ok(textOf(nowHtml) === textOf(OLD_HTML) && !nowHtml.includes("display:flow-root;margin:12px 0") &&
     (nowHtml.match(/style="display:block;margin:12px 0"><figure class="pd-ph"/g) || []).length === 4,
    "#312 images (photo wrap): an old document prints the same words and photos; every product block is a plain block with its photo as a figure");
```

- ≈59424: `pbv.includes('display: photo.show ? "flow-root" : "block"')` → `pbv.includes('display: "block",')`.

- [ ] **Step 7: Run feature tests** — `npx tsx scripts/test-photo-wrap.ts` → 0 FAIL.

- [ ] **Step 8: Gate** — `npx tsc --noEmit -p .`; `npm run test:specs` → 0 FAIL (the P5 / P2b / 293 fixtures must still match: no fixture case has a package document with photos — if one moves, stop and investigate); `npx eslint` on the changed `src/` files; `npx next build` (the editor views are client components — `photo-models.ts` must stay client-safe).

- [ ] **Step 9: Commit**

```bash
git add src/lib/package-doc/resolve.ts src/components/package-doc/package-doc-view.tsx src/lib/estimate-output/package-model.ts "src/app/(app)/estimator/narrative.ts" src/lib/narrative/library.ts src/components/package-doc/editor/editor-model.ts src/components/package-doc/editor/product-block-view.tsx src/components/package-doc/editor/product-image-view.tsx scripts/test-photo-wrap.ts scripts/test-review-and-spec.ts
git commit -m "feat(photo-wrap): package document photos wrap the following text and carry model tags (print + editor)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: PDF title page and print order

**Files:**
- Modify: `src/app/(app)/estimator/quote-document.tsx:108-118` (`QUOTE_PRINT_CSS`), `681-1167` (the render)
- Modify (pins): `scripts/test-review-and-spec.ts` ≈55303-55305, ≈57918 (and any order pin the run names)
- Regenerate: `docs/superpowers/fixtures/293-quote-document-baseline.json`, `p2b-quote-document-no-alternates.json`, `p5-quote-document-no-document.json`
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: print DOM order — `div.est-titlepage` (letterhead, title block, meta grid, bid line, cover note) → body (`est-pkgdoc` or bands) → `est-alts` → `est-optbox` → totals wrapper (totals, rewards / standing lines, terms, acceptance, footer) → assumptions → `est-appendix`. No investment band in print. `layout="web"` output byte-identical to Task 4's.

- [ ] **Step 1: Write the failing tests** — append `titlePageChecks(ok)` and call it from `photoWrapPureChecks`:

```ts
function titlePageChecks(ok: Ok) {
  const props = qd293Props({ pdfOptions: { pdfItemizedAppendix: true } });
  const print = renderQuoteDocument293(props);
  const tp = print.indexOf('<div class="est-titlepage">');
  const at = (s: string) => print.indexOf(s);
  ok(tp > 0 && at(">QUOTE</div>") > tp && at(">Prepared for</div>") > tp && at("Cover note.") > tp && at("Cover note.") < at('class="est-secband"'),
    "title page: letterhead, title block, meta and the cover note open the PDF");
  ok(!print.includes("Total investment"), "title page: the PDF drops the investment band (the totals block shows the Total)");
  ok(at('class="est-secband"') < at('class="est-totals"') && at('class="est-totals"') < at("Questions? Reach out") && at("Questions? Reach out") < at("Assume access.") && at("Assume access.") < at('class="est-appendix"'),
    "title page: narratives → pricing (totals, terms, acceptance, footer, assumptions) → the BOM appendix last");
  const web = renderQuoteDocument293({ ...props, layout: "web" });
  ok(!web.includes("est-titlepage") && web.includes("Total investment") && web.indexOf('class="est-appendix"') < web.indexOf("Questions? Reach out"),
    "title page: the online estimate keeps today's order (investment band, appendix inside the totals)");
  const { QUOTE_PRINT_CSS } = quoteDocumentModule293();
  ok(QUOTE_PRINT_CSS.includes(".est-doc .est-titlepage { break-after: page; page-break-after: always; }") && QUOTE_PRINT_CSS.includes(".est-doc .est-appendix { break-before: page; page-break-before: always; }"),
    "title page: the title page ends its page; the BOM starts a new one");
}
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/test-photo-wrap.ts` → FAIL lines `title page: …`.

- [ ] **Step 3: Capture the web renders before editing** (they must not move):

```bash
S=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/3339db5d-2963-4231-9e21-dd18a1d82e58/scratchpad
for f in 293-quote-document-baseline p2b-quote-document-no-alternates p5-quote-document-no-document; do cp docs/superpowers/fixtures/$f.json "$S/$f.before-t5.json"; done
```

- [ ] **Step 4: Restructure the render** — `src/app/(app)/estimator/quote-document.tsx`.

`QUOTE_PRINT_CSS`: add `.est-doc .est-titlepage { break-after: page; page-break-after: always; }` before the `.est-appendix` line.

In `QuoteDocument`, hoist the existing JSX pieces into constants **without changing their markup** (cut/paste the exact elements):

```tsx
  // Spec 2026-10-16 §3 — the same pieces, two orders: the PDF (layout ≠ "web") opens on a title page and puts
  // pricing after the narratives; the online estimate keeps today's order.
  const letterheadEl = (/* the letterhead <div style={{ borderBottom: … }}> … </div> (lines 684-691) */);
  const titleEl = (/* the document title <div style={{ display: "flex", … marginBottom: 22 }}> … </div> (694-742) */);
  const metaEl = (/* the prepared for / project / prepared by grid (745-771) */);
  const bidEl = p.bidLine ? <div style={{ color: "#5b616e", fontSize: 11.5, margin: "-10px 0 16px" }}>{p.bidLine}</div> : null;
  const investEl = (/* the at-a-glance investment band (776-817) */);
  const coverEl = showCover ? (/* the cover-note <div> (820-831) */) : null;
  const appendixEl = appendixSections.length > 0 ? (/* the #293 appendix <div className="est-appendix"> … </div> (1101-1123) */) : null;
  const assumptionsEl = p.assumptions.trim() ? (/* the assumptions <div> (1161-1164) */) : null;
```

Then the returned tree:

```tsx
  return (
        <div className={web ? "est-doc est-web" : "est-doc"} style={/* unchanged */}>
          {web ? (
            <>
              {letterheadEl}
              {titleEl}
              {metaEl}
              {bidEl}
              {investEl}
              {coverEl}
            </>
          ) : (
            <div className="est-titlepage">
              {letterheadEl}
              {titleEl}
              {metaEl}
              {bidEl}
              {coverEl}
            </div>
          )}

          {/* sections — unchanged (docOn ? <div className="est-pkgdoc">… : previewSections.map(…)) */}
          {/* alternates — unchanged */}
          {/* optional additions — unchanged */}

          {/* totals */}
          <div style={{ borderTop: "2px solid #16181d", paddingTop: 14, marginTop: 22 }}>
            {/* .est-totals block, terms + acceptance — unchanged */}
            {web ? appendixEl : null}
            {/* footer — unchanged */}
          </div>
          {assumptionsEl}
          {web ? null : appendixEl}
        </div>
  );
```

`{bidEl}` replaces `{p.bidLine && <div …>}` with the identical element. React renders `null`/`false` and an unwrapped fragment as nothing, so `layout="web"` output is byte-identical; verify in Step 6.

- [ ] **Step 5: Run feature tests** — `npx tsx scripts/test-photo-wrap.ts` → 0 FAIL.

- [ ] **Step 6: Re-capture the three QuoteDocument baselines and prove web did not move**

```bash
npx tsx scripts/qd293-baseline.ts && npx tsx scripts/qdp2b-baseline.ts && npx tsx scripts/qdp5-baseline.ts
S=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/3339db5d-2963-4231-9e21-dd18a1d82e58/scratchpad
node -e '
const fs=require("fs"),S=process.argv[1];
for (const f of ["293-quote-document-baseline","p2b-quote-document-no-alternates","p5-quote-document-no-document"]) {
  const a=JSON.parse(fs.readFileSync(S+"/"+f+".before-t5.json","utf8")), b=JSON.parse(fs.readFileSync("docs/superpowers/fixtures/"+f+".json","utf8"));
  const moved=Object.keys(b).filter(k=>a[k]!==b[k]), web=Object.keys(b).filter(k=>/Web/.test(k));
  console.log(f, "moved:", moved.join(","), "| web moved:", web.filter(k=>a[k]!==b[k]).join(",")||"none");
}' "$S"
```

Expected: every non-web case moved; `web moved: none` for all three files (`groupedWeb`, `ungroupedWeb`, `p2b-groupedWeb`, `p2b-ungroupedWeb`, `keyProductsWeb`, `alternatesWebAppendix`). Append `Re-captured 2026-10-16 for the PDF title page / print order.` to the header comments of `scripts/qd293-baseline.ts`, `scripts/qdp2b-baseline.ts` and `scripts/qdp5-baseline.ts`.

- [ ] **Step 7: Update the investment-band / order pins** — run `npm run test:specs 2>&1 | grep FAIL`. Expected failures (fix each deliberately, nothing else):
- ≈55303-55305 (`#P2b document (…): the totals and the Total investment band …`): render the compared documents with `layout: "web"` for the band comparison (the band only exists online), keep the totals comparison on the print render.
- ≈57918 (`html.includes("Total investment") && html.includes("4 systems · 7 line items · 1 o…")`): render that `html` with `layout: "web"`, or split: assert the band on a web render and `!html.includes("Total investment")` on the print render.
Any other FAIL is a regression — stop and investigate.

- [ ] **Step 8: Gate** — `npx tsc --noEmit -p .`; `npm run test:specs` → 0 FAIL; `npx eslint "src/app/(app)/estimator/quote-document.tsx"`; `npx next build`.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/estimator/quote-document.tsx" scripts/test-photo-wrap.ts scripts/test-review-and-spec.ts scripts/qd293-baseline.ts scripts/qdp2b-baseline.ts scripts/qdp5-baseline.ts docs/superpowers/fixtures/293-quote-document-baseline.json docs/superpowers/fixtures/p2b-quote-document-no-alternates.json docs/superpowers/fixtures/p5-quote-document-no-document.json
git commit -m "feat(photo-wrap): the estimate PDF opens on a title page; pricing after the narratives; BOM last

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Permanent datasheet links — signer, public route, allowlist

**Files:**
- Create: `src/lib/estimate-output/datasheet-link.ts`
- Create: `src/lib/estimate-output/datasheet-link-server.ts`
- Create: `src/app/d/ds/[quoteId]/[docId]/[sig]/route.ts`
- Modify: `src/lib/estimate-output/package-docs-server.ts:108-118` (`packageDocForSpec`; `packageDocForRevision` delegates)
- Modify: `src/lib/document-files.ts:233-238` (add `inlineDisposition`)
- Modify: `src/middleware.ts:12-41` (comment + matcher)
- Modify: `scripts/smoke-routes.ts` (`DYNAMIC_ROUTES`, near the `/share/…/doc/PD-1` entry ≈417)
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes: `specPackageDocs`, `DatasheetSelection` (`package-docs-server.ts:61-84`); `isDocumentId` (`src/lib/part-docs/types.ts:245`); `getBlobStream` (`@/lib/blob`); `rateLimit`, `clientIp` (`@/lib/rate-limit`); `SHARE_DOC_PER_MIN` (`@/lib/quote-share/links`); `attachmentDisposition` (`document-files.ts:233`).
- Produces:
  - `DATASHEET_LINK_PREFIX = "/d/ds/"`, `DATASHEET_SIG_RE`, `DATASHEET_LINK_QUOTE_MAX = 128`
  - `datasheetLinkSig(secret: string, quoteId: string, docId: string): string` (22 chars base64url)
  - `verifyDatasheetLinkSig(secret: string, quoteId: string, docId: string, sig: string): boolean`
  - `datasheetLinkPath(secret: string, quoteId: string, docId: string): string` → `/d/ds/<enc quoteId>/<docId>/<sig>`
  - `packageDocForSpec(spec: unknown, sel: DatasheetSelection | null | undefined, docId: string, kinds?: ReadonlySet<string>): Promise<PartDocument | null>`
  - `serveEstimateDatasheet(req: Request, p: { quoteId: string; docId: string; sig: string }, deps?: Partial<DatasheetLinkDeps>): Promise<Response>`
  - `inlineDisposition(fileName: string): string`

- [ ] **Step 1: Read the route-handler guide** — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (dynamic segments, `params` Promise, decoding). Note whether `params` values arrive decoded; the handler below assumes decoded (as `src/app/share/quote/[id]/[token]/doc/[docId]/route.ts` does).

- [ ] **Step 2: Write the failing tests** — append `datasheetLinkChecks(ok)` (async) and `await` it from `photoWrapPureChecks`:

```ts
import { datasheetLinkPath, datasheetLinkSig, verifyDatasheetLinkSig, DATASHEET_SIG_RE } from "../src/lib/estimate-output/datasheet-link";
import { serveEstimateDatasheet } from "../src/lib/estimate-output/datasheet-link-server";
import { inlineDisposition } from "../src/lib/document-files";

async function datasheetLinkChecks(ok: Ok) {
  const S = "pw-secret", Q = "Q-2041", D = "PD-abcdef12";
  const sig = datasheetLinkSig(S, Q, D);
  ok(DATASHEET_SIG_RE.test(sig) && sig.length === 22 && datasheetLinkSig(S, Q, D) === sig, "ds link: a stable 22-char base64url signature");
  ok(verifyDatasheetLinkSig(S, Q, D, sig) && !verifyDatasheetLinkSig(S, "Q-2042", D, sig) && !verifyDatasheetLinkSig(S, Q, "PD-abcdef13", sig) && !verifyDatasheetLinkSig("other", Q, D, sig) &&
     !verifyDatasheetLinkSig("", Q, D, sig) && !verifyDatasheetLinkSig(S, Q, D, sig.slice(0, 21) + (sig[21] === "A" ? "B" : "A")) && !verifyDatasheetLinkSig(S, Q, D, sig + "x"),
    "ds link: bound to exactly this quote + datasheet + secret; tampered, short or long signatures fail");
  ok(datasheetLinkPath(S, Q, D) === `/d/ds/Q-2041/PD-abcdef12/${sig}` && datasheetLinkPath(S, "Q 1/2", D).startsWith("/d/ds/Q%201%2F2/"), "ds link: the path encodes the quote id");
  ok(inlineDisposition("Spot sheet.pdf").startsWith('inline; filename="Spot sheet.pdf"'), "ds link: inline disposition keeps the attachment name rules");

  const doc = { id: D, kind: "datasheet", title: "Spot", fileName: "spot.pdf", contentType: "application/pdf", size: 9, blobKey: "part-docs/spot.pdf" };
  const q = { id: Q, spec: {}, packageSelection: null };
  const base = { secret: S, allow: () => true, getQuote: async (id: string) => (id === Q ? (q as never) : null), docFor: async (_q: unknown, id: string) => (id === D ? (doc as never) : null),
    stream: async () => new Blob(["%PDF-1.4 spot"]).stream() };
  const req = new Request("http://app.test/d/ds/x");
  const good = await serveEstimateDatasheet(req, { quoteId: Q, docId: D, sig }, base);
  ok(good.status === 200 && good.headers.get("content-type") === "application/pdf" && (good.headers.get("content-disposition") || "").startsWith("inline;") &&
     good.headers.get("x-content-type-options") === "nosniff" && good.headers.get("cache-control") === "private, max-age=300" && (await good.text()) === "%PDF-1.4 spot",
    "ds link: a good link streams the stored datasheet inline, nosniff, private cache");
  const statusOf = async (p: { quoteId: string; docId: string; sig: string }, d: Partial<typeof base> = {}) => (await serveEstimateDatasheet(req, p, { ...base, ...d })).status;
  ok((await statusOf({ quoteId: Q, docId: D, sig: "A".repeat(22) })) === 404 && (await statusOf({ quoteId: Q, docId: "nope", sig })) === 404 &&
     (await statusOf({ quoteId: Q, docId: D, sig }, { getQuote: async () => null })) === 404 && (await statusOf({ quoteId: Q, docId: D, sig }, { docFor: async () => null })) === 404 &&
     (await statusOf({ quoteId: Q, docId: D, sig }, { getQuote: async () => { throw new Error("db down"); } })) === 404 && (await statusOf({ quoteId: Q, docId: D, sig }, { stream: async () => null })) === 404,
    "ds link: bad signature, bad id, deleted quote, a datasheet no longer listed, a DB error, a missing file → the same 404");
  ok((await statusOf({ quoteId: Q, docId: D, sig }, { stream: async () => { throw new Error("blob"); } })) === 502 && (await statusOf({ quoteId: Q, docId: D, sig }, { allow: () => false })) === 429,
    "ds link: a storage error is 502 (no vendor text); over the per-IP rate → 429");
  const img = await serveEstimateDatasheet(req, { quoteId: Q, docId: D, sig }, { ...base, docFor: async () => ({ ...doc, contentType: "image/png", fileName: "spot.png" }) as never });
  ok((img.headers.get("content-disposition") || "").startsWith("attachment;") && (img.headers.get("content-security-policy") || "").includes("sandbox"), "ds link: anything but a PDF downloads, sandboxed");

  const mw = rd("src/middleware.ts"), route = rd("src/app/d/ds/[quoteId]/[docId]/[sig]/route.ts"), pds = rd("src/lib/estimate-output/package-docs-server.ts");
  ok(mw.includes("|share/|d/ds/|"), "ds link: the route is outside the team login (middleware matcher)");
  ok(route.includes("serveEstimateDatasheet(req, await ctx.params)") && route.includes('export const dynamic = "force-dynamic"'), "ds link: the route only delegates");
  ok(pds.includes("export async function packageDocForSpec(") && pds.includes("return packageDocForSpec(rev.spec, rev.docFields?.packageSelection ?? null, docId);"),
    "ds link: one 'is this document on this package' rule for the share route and the permanent link");
}
```

- [ ] **Step 3: Run to verify it fails** — `npx tsx scripts/test-photo-wrap.ts` → `Cannot find module '../src/lib/estimate-output/datasheet-link'`.

- [ ] **Step 4: Signer** — create `src/lib/estimate-output/datasheet-link.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Spec 2026-10-16 §5 — the permanent per-datasheet link printed on the
 * estimate PDF's last page: `/d/ds/<quoteId>/<docId>/<sig>`, `sig` =
 * base64url(HMAC-SHA256(key, "est-datasheet:<quoteId>:<docId>")) cut to 22
 * chars (132 bits), `key` = HMAC-SHA256(AUTH_SECRET, a fixed label) — its own
 * key, domain-separated from the print and share tokens. No expiry, no
 * nonce: revoking the client link never touches it (Jeff). It dies when the
 * quote is deleted or stops listing the datasheet (the route checks), or
 * when AUTH_SECRET rotates. Pure apart from node:crypto; server-only.
 */

export const DATASHEET_LINK_PREFIX = "/d/ds/";
export const DATASHEET_SIG_RE = /^[A-Za-z0-9_-]{22}$/;
export const DATASHEET_LINK_QUOTE_MAX = 128;
const KEY_LABEL = "quartzite:est-datasheet-link:v1";

function keyOf(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

export function datasheetLinkSig(secret: string, quoteId: string, docId: string): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a datasheet link.");
  return createHmac("sha256", keyOf(secret)).update(`est-datasheet:${quoteId}:${docId}`).digest("base64url").slice(0, 22);
}

export function verifyDatasheetLinkSig(secret: string, quoteId: string, docId: string, sig: string): boolean {
  if (!secret || typeof quoteId !== "string" || !quoteId || typeof docId !== "string" || !docId || typeof sig !== "string" || !DATASHEET_SIG_RE.test(sig)) return false;
  const want = Buffer.from(datasheetLinkSig(secret, quoteId, docId));
  const have = Buffer.from(sig);
  return want.length === have.length && timingSafeEqual(want, have);
}

export function datasheetLinkPath(secret: string, quoteId: string, docId: string): string {
  return `${DATASHEET_LINK_PREFIX}${encodeURIComponent(quoteId)}/${encodeURIComponent(docId)}/${datasheetLinkSig(secret, quoteId, docId)}`;
}
```

- [ ] **Step 5: One "listed on this package" rule** — `src/lib/estimate-output/package-docs-server.ts`, replace `packageDocForRevision` (≈113-118) and keep `SERVED_KINDS` above it:

```ts
/** The blob-backed document `docId` IF this spec's package lists it with one of `kinds` (with the selection's
 *  left-out datasheets applied); else null. The share route asks for a sent revision; the permanent datasheet
 *  link (spec 2026-10-16 §5) asks for the live quote, datasheets only. */
export async function packageDocForSpec(spec: unknown, sel: DatasheetSelection | null | undefined, docId: string, kinds: ReadonlySet<string> = SERVED_KINDS): Promise<PartDocument | null> {
  if (!isDocumentId(docId)) return null;
  const d = await specPackageDocs(spec, sel ?? null);
  if (!d.documents.some((x) => x.documentId === docId && kinds.has(x.kind))) return null;
  const doc = d.index.docsById.get(docId);
  return doc && doc.blobKey && kinds.has(doc.kind) ? doc : null;
}

/** The blob-backed datasheet / spec sheet `docId` IF this revision's package lists it; else null. */
export function packageDocForRevision(rev: Pick<QuoteRevision, "spec" | "docFields">, docId: string): Promise<PartDocument | null> {
  return packageDocForSpec(rev.spec, rev.docFields?.packageSelection ?? null, docId);
}
```

`src/lib/document-files.ts` — after `attachmentDisposition`:

```ts
/** RFC 6266 inline (a PDF the browser shows), with attachmentDisposition's name rules. */
export function inlineDisposition(fileName: string): string {
  return attachmentDisposition(fileName).replace(/^attachment;/, "inline;");
}
```

- [ ] **Step 6: The serve function** — create `src/lib/estimate-output/datasheet-link-server.ts`:

```ts
import { getBlobStream } from "@/lib/blob";
import { attachmentDisposition, inlineDisposition } from "@/lib/document-files";
import { isDocumentId, type PartDocument } from "@/lib/part-docs/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { SHARE_DOC_PER_MIN } from "@/lib/quote-share/links";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { DATASHEET_LINK_QUOTE_MAX, verifyDatasheetLinkSig } from "./datasheet-link";
import { packageDocForSpec } from "./package-docs-server";

/**
 * Spec 2026-10-16 §5 — GET /d/ds/<quoteId>/<docId>/<sig>: no session (the
 * route is outside the team login, middleware.ts). Per-IP rate limit first,
 * then the signature, then the quote (a soft-deleted quote reads as missing)
 * and its CURRENT datasheet list (specPackageDocs with the live selection).
 * Every refusal is the same 404; a storage error is a 502 with no vendor
 * text. A PDF is served inline; anything else downloads, sandboxed.
 * Server-only; deps are seams for the spec harness.
 */

export type DatasheetLinkDeps = {
  secret: string;
  allow: (req: Request) => boolean;
  getQuote: (id: string) => Promise<Quote | null>;
  docFor: (q: Quote, docId: string) => Promise<PartDocument | null>;
  stream: (blobKey: string) => Promise<ReadableStream | null>;
};

const DATASHEET_ONLY: ReadonlySet<string> = new Set(["datasheet"]);
const notFound = () => new Response("Not found", { status: 404 });

export async function serveEstimateDatasheet(req: Request, p: { quoteId: string; docId: string; sig: string }, deps: Partial<DatasheetLinkDeps> = {}): Promise<Response> {
  const allow = deps.allow ?? ((r: Request) => rateLimit("est-ds:" + (clientIp(r) || "unknown"), SHARE_DOC_PER_MIN, 60_000).ok);
  if (!allow(req)) return new Response("Too many requests", { status: 429 });
  const quoteId = typeof p?.quoteId === "string" ? p.quoteId : "";
  const docId = typeof p?.docId === "string" ? p.docId : "";
  const sig = typeof p?.sig === "string" ? p.sig : "";
  if (!quoteId || quoteId.length > DATASHEET_LINK_QUOTE_MAX || !isDocumentId(docId)) return notFound();
  if (!verifyDatasheetLinkSig(deps.secret ?? process.env.AUTH_SECRET ?? "", quoteId, docId, sig)) return notFound();
  let doc: PartDocument | null = null;
  try {
    const q = await (deps.getQuote ?? getQuote)(quoteId);
    if (!q) return notFound();
    doc = await (deps.docFor ?? ((qq: Quote, id: string) => packageDocForSpec(qq.spec, qq.packageSelection ?? null, id, DATASHEET_ONLY)))(q, docId);
  } catch (e) {
    // A DB error is the same uniform 404 as a bad link — never a 500 that tells a prober the link is real.
    console.warn("[ds-link] lookup failed", e instanceof Error ? e.message : e);
    return notFound();
  }
  if (!doc || !doc.blobKey) return notFound();
  let stream: ReadableStream | null;
  try {
    stream = await (deps.stream ?? ((k: string) => getBlobStream(k)))(doc.blobKey);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  const pdf = doc.contentType === "application/pdf";
  return new Response(stream, {
    headers: {
      "content-type": pdf ? "application/pdf" : "application/octet-stream",
      "content-disposition": pdf ? inlineDisposition(doc.fileName) : attachmentDisposition(doc.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
      ...(pdf ? {} : { "content-security-policy": "sandbox; default-src 'none'" }),
    },
  });
}
```

Check `getBlobStream`'s return type and that `Quote` has `packageSelection` and `spec` (it does — `package-live-loader.ts` reads both); adjust the `stream` dep type to match `getBlobStream`.

- [ ] **Step 7: Route + allowlist + smoke**

Create `src/app/d/ds/[quoteId]/[docId]/[sig]/route.ts`:

```ts
import { serveEstimateDatasheet } from "@/lib/estimate-output/datasheet-link-server";

export const dynamic = "force-dynamic";

/** Spec 2026-10-16 §5 — a permanent datasheet link from the estimate PDF's last page. Public (middleware.ts
 *  exempts /d/ds/); the HMAC signature is the only key. */
export async function GET(req: Request, ctx: { params: Promise<{ quoteId: string; docId: string; sig: string }> }) {
  return serveEstimateDatasheet(req, await ctx.params);
}
```

`src/middleware.ts`: in the comment, after the /share sentence add ` /d/ds/<quote>/<doc>/<sig> is the estimate PDF's permanent datasheet link (spec 2026-10-16 §5): public, it checks its own HMAC and that the live quote still lists the datasheet.`; in the matcher change `|share/|pdf\\.worker` to `|share/|d/ds/|pdf\\.worker`.

`scripts/smoke-routes.ts` `DYNAMIC_ROUTES`, after the `/share/…/doc/PD-1` entry:

```ts
  // Photo wrap (2026-10-16 §5) — a permanent datasheet link with a well-formed bad signature: a clean 404 after the route compiles.
  { route: "/d/ds/Q-2041/PD-abcdef12/AAAAAAAAAAAAAAAAAAAAAA", expectNotFound: true },
```

- [ ] **Step 8: Run feature tests** — `npx tsx scripts/test-photo-wrap.ts` → 0 FAIL.

- [ ] **Step 9: Gate** — `npx tsc --noEmit -p .`; `npm run test:specs` → 0 FAIL (the share datasheet route's existing checks exercise `packageDocForRevision`); `npx eslint` on the new/changed files; then `rm -rf .next && npm run test:smoke` (alone) → 0 FAIL including the new 404 entry.

- [ ] **Step 10: Commit**

```bash
git add src/lib/estimate-output/datasheet-link.ts src/lib/estimate-output/datasheet-link-server.ts "src/app/d/ds/[quoteId]/[docId]/[sig]/route.ts" src/lib/estimate-output/package-docs-server.ts src/lib/document-files.ts src/middleware.ts scripts/smoke-routes.ts scripts/test-photo-wrap.ts
git commit -m "feat(photo-wrap): permanent signed datasheet links served while the estimate lists the datasheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Datasheet links page in the estimate PDF (print route, one render)

**Files:**
- Create: `src/lib/estimate-output/datasheet-links.ts` (pure rows)
- Create: `src/lib/estimate-output/datasheet-links-server.ts` (`loadDatasheetLinkRows`)
- Create: `src/components/estimate-output/datasheet-links-page.tsx`
- Modify: `src/app/print/quote/[id]/page.tsx` (whole function: `?part=`, origin, links)
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes: `specPackageDocs` (`package-docs-server.ts:61`), `datasheetLinkPath` (Task 6), `partModel` (`sku.ts:29`), `printOriginFor` (`origin.ts:42`).
- Produces:
  - `type DatasheetLinkRow = { key: string; manufacturer: string; model: string; description: string; href: string }`
  - `DATASHEET_LINK_ROWS_MAX = 500`
  - `datasheetLinkRows(i: { bom: ReadonlyArray<{ sku: string }>; parts: ReadonlyArray<{ sku: string; mfr?: string | null; desc?: string | null; manufacturerModelNumber?: string; manufacturerPartNumber?: string }>; documents: ReadonlyArray<{ documentId: string; kind: string; skus: readonly string[] }>; hosted: (docId: string) => boolean; href: (docId: string) => string }): DatasheetLinkRow[]`
  - `loadDatasheetLinkRows(q: Pick<Quote, "id" | "spec" | "packageSelection">, origin: string, secret?: string): Promise<DatasheetLinkRow[]>` — never throws
  - `DatasheetLinksPage({ rows, quoteNumber, projectName })` (server component) + `DATASHEET_LINKS_CSS`, `DATASHEET_LINKS_COPY`
  - Print route query `part`: absent = everything; `"main"` = document + cut sheets (no links); `"tail"` = links only; any other value, or any `part` with `bidder`, = 404. The bidder variant never prints links.

- [ ] **Step 1: Write the failing tests** — append `datasheetLinksPageChecks(ok)` and call it from `photoWrapPureChecks`:

```ts
import { datasheetLinkRows } from "../src/lib/estimate-output/datasheet-links";
import DatasheetLinksPage, { DATASHEET_LINKS_CSS } from "../src/components/estimate-output/datasheet-links-page";

function datasheetLinksPageChecks(ok: Ok) {
  const rows = datasheetLinkRows({
    bom: [{ sku: "ETC:CS-SPOT" }, { sku: "ETC:LENS" }, { sku: "Symetrix:Jupiter 4" }, { sku: "NODOC" }],
    parts: [
      { sku: "ETC:CS-SPOT", mfr: "ETC", desc: "ColorSource Spot", manufacturerModelNumber: "CS Spot" },
      { sku: "ETC:LENS", mfr: "ETC", desc: "Lens tube" },
      { sku: "Symetrix:Jupiter 4", mfr: "Symetrix", desc: "DSP", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" },
      { sku: "NODOC", mfr: "X", desc: "No sheet" },
    ],
    documents: [
      { documentId: "PD-spot0001", kind: "datasheet", skus: ["ETC:CS-SPOT", "ETC:LENS"] },
      { documentId: "PD-urlonly1", kind: "datasheet", skus: ["Symetrix:Jupiter 4"] },
      { documentId: "PD-spec0001", kind: "specsheet", skus: ["ETC:CS-SPOT"] },
    ],
    hosted: (id) => id !== "PD-urlonly1",
    href: (id) => "https://app.test/d/ds/Q-1/" + id + "/sig",
  });
  ok(JSON.stringify(rows.map((r) => [r.manufacturer, r.model, r.description, r.href.slice(-15)])) ===
     JSON.stringify([["ETC", "CS Spot", "ColorSource Spot", "PD-spot0001/sig"], ["ETC", "LENS", "Lens tube", "PD-spot0001/sig"]]),
    "ds page: one row per (part, hosted datasheet) in BOM order — a fixture sheet covering an accessory lists both; spec sheets and URL-only sheets don't print");
  const html = renderToStaticMarkup(createElement(DatasheetLinksPage, { rows, quoteNumber: "EST-1042", projectName: "North HS" }));
  ok(html.includes('class="est-dslinks"') && html.includes(">Manufacturer</th>") && html.includes(">Model</th>") && html.includes(">Description</th>") &&
     html.includes('href="https://app.test/d/ds/Q-1/PD-spot0001/sig"') && html.includes("Datasheet ↗") && html.includes("EST-1042"),
    "ds page: Manufacturer · Model · Description · Datasheet ↗ (absolute links)");
  ok(renderToStaticMarkup(createElement(DatasheetLinksPage, { rows: [], quoteNumber: "EST-1", projectName: "" })) === "", "ds page: no rows → no page");
  ok(DATASHEET_LINKS_CSS.includes(".est-dslinks { break-before: page; page-break-before: always;") && DATASHEET_LINKS_CSS.includes(".est-dslinks tr { break-inside: avoid; page-break-inside: avoid; }"),
    "ds page: starts its own page; a row never splits");
  const pr = rd("src/app/print/quote/[id]/page.tsx");
  ok(pr.includes('rawPart !== "main" && rawPart !== "tail"') && /if \(rawPart !== undefined && \(bidder \|\|/.test(pr), "ds page: ?part= is main | tail only, and never with a bidder");
  ok(pr.includes('!bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : []') && pr.includes("<DatasheetLinksPage") && pr.includes('part !== "tail" &&'),
    "ds page: the customer PDF ends with the links (main hides them; tail prints only them); the bidder PDF never has them");
}
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/test-photo-wrap.ts` → module not found.

- [ ] **Step 3: Pure rows** — create `src/lib/estimate-output/datasheet-links.ts`:

```ts
import { partModel } from "@/lib/catalog-rename/sku";

/**
 * Spec 2026-10-16 §5 — the estimate PDF's datasheet links page: the same
 * datasheets the client package includes (specPackageDocs: the package BOM,
 * scoped coverage, the project's left-out datasheets), datasheet kind only,
 * one row per (part, datasheet) in BOM order. Only a datasheet with a stored
 * file has a hosted copy to link to (`hosted`), the share route's own rule.
 * Pure; client-safe.
 */

export type DatasheetLinkRow = { key: string; manufacturer: string; model: string; description: string; href: string };

export const DATASHEET_LINK_ROWS_MAX = 500;

export function datasheetLinkRows(i: {
  bom: ReadonlyArray<{ sku: string }>;
  parts: ReadonlyArray<{ sku: string; mfr?: string | null; desc?: string | null; manufacturerModelNumber?: string; manufacturerPartNumber?: string }>;
  documents: ReadonlyArray<{ documentId: string; kind: string; skus: readonly string[] }>;
  hosted: (docId: string) => boolean;
  href: (docId: string) => string;
}): DatasheetLinkRow[] {
  const partOf = new Map(i.parts.map((p) => [p.sku, p] as const));
  const sheets = i.documents.filter((d) => d.kind === "datasheet" && i.hosted(d.documentId));
  const out: DatasheetLinkRow[] = [];
  const seen = new Set<string>();
  for (const r of i.bom) {
    const p = partOf.get(r.sku);
    if (!p) continue;
    for (const d of sheets) {
      if (!d.skus.includes(r.sku)) continue;
      const key = r.sku + "|" + d.documentId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, manufacturer: String(p.mfr ?? "").trim(), model: partModel({ sku: p.sku, manufacturerModelNumber: p.manufacturerModelNumber, manufacturerPartNumber: p.manufacturerPartNumber }), description: String(p.desc ?? "").trim(), href: i.href(d.documentId) });
      if (out.length >= DATASHEET_LINK_ROWS_MAX) return out;
    }
  }
  return out;
}
```

Create `src/lib/estimate-output/datasheet-links-server.ts`:

```ts
import type { Quote } from "@/lib/stores/quotes";
import { datasheetLinkPath } from "./datasheet-link";
import { datasheetLinkRows, type DatasheetLinkRow } from "./datasheet-links";
import { specPackageDocs } from "./package-docs-server";

/** The live quote's datasheet link rows, absolute on `origin` (the print origin). Never throws: no secret,
 *  no origin or a failed read → no rows (the PDF simply has no links page). Server-only. */
export async function loadDatasheetLinkRows(q: Pick<Quote, "id" | "spec" | "packageSelection">, origin: string, secret: string = process.env.AUTH_SECRET || ""): Promise<DatasheetLinkRow[]> {
  if (!secret || !origin) return [];
  try {
    const d = await specPackageDocs(q.spec, q.packageSelection ?? null);
    return datasheetLinkRows({
      bom: d.bom,
      parts: d.parts,
      documents: d.documents,
      hosted: (id) => !!d.index.docsById.get(id)?.blobKey,
      href: (id) => origin + datasheetLinkPath(secret, q.id, id),
    });
  } catch (e) {
    console.warn("[quote-pdf] datasheet links unavailable", q.id, e instanceof Error ? e.message : e);
    return [];
  }
}
```

- [ ] **Step 4: The page** — create `src/components/estimate-output/datasheet-links-page.tsx`:

```tsx
import type { DatasheetLinkRow } from "@/lib/estimate-output/datasheet-links";

/**
 * Spec 2026-10-16 §5 — the estimate PDF's last section: a table of the
 * package's datasheets with a permanent link to our hosted copy of each.
 * Server-safe (no hooks / handlers). Chrome turns each <a href> into a URI
 * link annotation, which pdf-lib's copyPages keeps (Task 8).
 */

export const DATASHEET_LINKS_COPY = {
  title: "Product datasheets",
  intro: "Each link opens the manufacturer datasheet we keep for this estimate.",
  open: "Datasheet ↗",
  head: ["Manufacturer", "Model", "Description", "Datasheet"],
} as const;

export const DATASHEET_LINKS_CSS = `
.est-dslinks { break-before: page; page-break-before: always; color: #16181d; max-width: 740px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.est-dslinks h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
.est-dslinks .est-dsl-sub { font-size: 11.5px; color: #5b616e; margin: 0 0 14px; }
.est-dslinks table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.est-dslinks th { text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9aa0ab; border-bottom: 1.5px solid #16181d; padding: 4px 6px; }
.est-dslinks td { border-bottom: 1px solid #f0f1f4; padding: 6px; vertical-align: top; }
.est-dslinks tr { break-inside: avoid; page-break-inside: avoid; }
.est-dslinks a { color: color-mix(in srgb, var(--accent) 72%, #000); font-weight: 600; text-decoration: none; white-space: nowrap; }
`;

export default function DatasheetLinksPage({ rows, quoteNumber, projectName }: { rows: DatasheetLinkRow[]; quoteNumber: string; projectName: string }) {
  if (!rows.length) return null;
  return (
    <section className="est-dslinks">
      <style>{DATASHEET_LINKS_CSS}</style>
      <h2>{DATASHEET_LINKS_COPY.title}</h2>
      <p className="est-dsl-sub">
        {quoteNumber}
        {projectName ? " · " + projectName : ""} — {DATASHEET_LINKS_COPY.intro}
      </p>
      <table>
        <thead>
          <tr>
            {DATASHEET_LINKS_COPY.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.manufacturer}</td>
              <td>{r.model}</td>
              <td>{r.description}</td>
              <td>
                <a href={r.href}>{DATASHEET_LINKS_COPY.open}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 5: Print route** — `src/app/print/quote/[id]/page.tsx`:

Imports: `import { headers } from "next/headers";`, `import { printOriginFor } from "@/lib/quote-pdf/origin";`, `import { loadDatasheetLinkRows } from "@/lib/estimate-output/datasheet-links-server";`, `import DatasheetLinksPage from "@/components/estimate-output/datasheet-links-page";`.

After the `rev` validation (before `tokenOk`):

```ts
  // Spec 2026-10-16 §5: `part` splits the customer PDF around the drawings the generator merges in — "main" is the
  // document + cut sheets, "tail" only the datasheet links. Never on a bidder's PDF (no drawings, no links there).
  const rawPart = sp.part;
  if (rawPart !== undefined && (bidder || typeof rawPart !== "string" || (rawPart !== "main" && rawPart !== "tail"))) notFound();
  const part = rawPart as "main" | "tail" | undefined;
```

After `const q = await getQuote(id); …` compute the print origin (the cover route's way):

```ts
  const h = await headers();
  const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  const origin = "origin" in where ? where.origin : "";
```

In the `Promise.all`, gate the cut sheets on `part !== "tail" &&` (prefix the existing condition) and add a sixth entry:

```ts
    // Spec 2026-10-16 §5 — the datasheet links: the customer PDF only (never a bidder's), never in the "main" part.
    !bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : [],
```

(destructure it as `links`). Skip the photo / model reads for the tail:

```ts
  const noPhotos: [Record<string, { src: string; alt: string }>, Record<string, string>] = [{}, {}];
  const [keyProductPhotos, keyProductModels] = part === "tail" ? noPhotos : await Promise.all([keyProductPhotoDataUris(doc.sections, doc.document), loadKeyProductModels(doc.sections, doc.document)]);
```

Render:

```tsx
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      {part !== "tail" && (
        <>
          <QuoteDocument {...doc} keyProductPhotos={keyProductPhotos} keyProductModels={keyProductModels} rewardsLine={rewardsVisibleFor(addressee) ? purchasePerksDocLine(perks) : ""} />
          {/* #292 — its own page after the estimate; the Client resets (width/padding) ride along. */}
          {cutSheets?.ok && cutSheets.models.client.length > 0 && (
            <div style={{ breakBefore: "page" }}>
              <style>{CLIENT_PRINT_CSS}</style>
              <CutSheetPages models={cutSheets.models.client} style="client" photos={cutSheets.photos} letterheadSrc={peakLetterhead.src} />
            </div>
          )}
        </>
      )}
      {/* Spec 2026-10-16 §5 — last: the datasheet links (the generator moves them after any merged drawings). */}
      <DatasheetLinksPage rows={links} quoteNumber={doc.quoteId} projectName={doc.projectName} />
    </main>
  );
```

The existing pin `pr.includes("keyProductPhotoDataUris(")` (harness ≈47766) and `"keyProductPhotoDataUris(doc.sections, doc.document)"` (≈57971) still hold; `keyProductPhotos={keyProductPhotos}` still appears.

- [ ] **Step 6: Run feature tests** — `npx tsx scripts/test-photo-wrap.ts` → 0 FAIL.

- [ ] **Step 7: Gate** — `npx tsc --noEmit -p .`; `npm run test:specs` → 0 FAIL; `npx eslint` on the new/changed files; `rm -rf .next && npm run test:smoke` → 0 FAIL (the print route still 404s without a token).

- [ ] **Step 8: Commit**

```bash
git add src/lib/estimate-output/datasheet-links.ts src/lib/estimate-output/datasheet-links-server.ts src/components/estimate-output/datasheet-links-page.tsx "src/app/print/quote/[id]/page.tsx" scripts/test-photo-wrap.ts
git commit -m "feat(photo-wrap): the estimate PDF ends with a page of permanent datasheet links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Drawings merged into the customer PDF (pdf-lib), links after them, warnings on the PDF state

**Files:**
- Create: `src/lib/quote-pdf/appendix-plan.ts` (pure: drawing plan, page fit, notes copy)
- Create: `src/lib/quote-pdf/appendix-merge-server.ts` (pdf-lib + sharp merge; never throws)
- Modify: `src/lib/quote-pdf/generate.ts` (seams 45-70; budget helpers after 107; render + appendix 166-208; settle 210)
- Modify: `src/lib/quote-pdf/state.ts:17-38` (`notes`), `102-110` (`QuotePdfView.notes`), `112` (`PdfOutcome`), `157-183` (`settlePdf`, `pdfView`)
- Modify: `src/components/quote-pdf/pdf-banner.ts:22-39`
- Test: `scripts/test-photo-wrap.ts` (pure + DB)

**Interfaces:**
- Consumes: `shownPackageFiles`, `cleanPackageFiles`, `MAX_PACKAGE_FILE_BYTES`, `PackageFile` (`src/lib/estimate-output/package-files.ts`); `loadDatasheetLinkRows` (Task 7); print route `?part=main|tail` (Task 7); `checkPageBox` (`src/lib/part-docs/datasheet-book-server.ts:140`); `readBlobCapped` (`src/lib/narrative/photos.ts:117`); `stampRerenderDeadlineMs`, `PDF_FUNCTION_BUDGET_MS`, `PDF_UPLOAD_ALLOWANCE_MS` (`generate.ts`); `ESTIMATE_EMAIL_ATTACH_MAX` (`src/lib/estimate-email/compose.ts:12`).
- Produces:
  - `appendix-plan.ts`: `DRAWINGS_TOTAL_MAX_BYTES = 80 * 1024 * 1024`; `type DrawingSkipReason = "too-big" | "over-total" | "unreadable" | "encrypted" | "late"`; `type DrawingSkip = { name: string; reason: DrawingSkipReason }`; `planDrawings(files: readonly PackageFile[], caps?: { perFile: number; total: number }): Array<{ file: PackageFile; skip: DrawingSkipReason | null }>`; `imagePagePlacement(imgW: number, imgH: number): { pageW: number; pageH: number; x: number; y: number; w: number; h: number } | null`; `drawingSkipNote(s: DrawingSkip): string`; `pdfNotesOf(lines: readonly string[]): string[]`; `sizeMb(bytes: number): string`; `APPENDIX_COPY`; `PDF_NOTES_MAX = 6`.
  - `appendix-merge-server.ts`: `type DrawingInput = { name: string; contentType: string; bytes: Uint8Array | null; skip?: DrawingSkipReason }`; `mergeEstimateAppendices(i: { main: Uint8Array; drawings: readonly DrawingInput[]; tail: Uint8Array | null; deadline?: number; now?: () => number }): Promise<{ bytes: Buffer; skipped: DrawingSkip[]; tailAdded: boolean; merged: boolean }>`.
  - `generate.ts`: `APPENDIX_MIN_MS = 15_000`; `appendixFits(elapsedMs: number): boolean`; `type AppendixSources = { drawings: PackageFile[]; hasLinks: boolean }`; `loadAppendixSources(q: Quote, origin: string): Promise<AppendixSources>`; `GenerateInput.appendix?`, `GenerateInput.readDrawing?`.
  - `state.ts`: `QuotePdfState.notes?: string[]`; `PdfOutcome` ok `notes?: string[] | null`; `QuotePdfView.notes?: string[]` (ready files only).

Behaviour: with **no** shown drawings the render is exactly today's single call (URL unchanged) and pdf-lib never runs — the links print at the end of that one render. With drawings, the first render (and a stamp re-render) uses `&part=main`; then, only while `appendixFits(elapsed)`, under one deadline (`stampRerenderDeadlineMs(elapsed)`): the `&part=tail` render (only when there are link rows), the drawing reads (list order, per file 25 MB, total 80 MB), and the merge. Out of time → main only + a note. A drawing that can't be used is skipped with a note; the PDF never fails because of drawings.

- [ ] **Step 1: Write the failing pure tests** — append `appendixPureChecks(ok)` (async) and await it from `photoWrapPureChecks`:

```ts
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";
import { planDrawings, imagePagePlacement, pdfNotesOf, drawingSkipNote, APPENDIX_COPY, PDF_NOTES_MAX, DRAWINGS_TOTAL_MAX_BYTES } from "../src/lib/quote-pdf/appendix-plan";
import { mergeEstimateAppendices } from "../src/lib/quote-pdf/appendix-merge-server";
import { appendixFits } from "../src/lib/quote-pdf/generate";
import { pdfView, settlePdf } from "../src/lib/quote-pdf/state";
import { pdfBanner } from "../src/components/quote-pdf/pdf-banner";

export async function mkPdf(sizes: Array<[number, number]>, uri?: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (const [w, h] of sizes) {
    const pg = d.addPage([w, h]);
    if (uri) {
      const link = d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 700, 200, 720], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(uri) } }));
      pg.node.set(PDFName.of("Annots"), d.context.obj([link]));
    }
  }
  return Buffer.from(await d.save());
}
export function uriOf(page: import("pdf-lib").PDFPage): string | null {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const a0 = annots?.lookupMaybe(0, PDFDict);
  const act = a0?.lookupMaybe(PDFName.of("A"), PDFDict);
  const u = act?.lookupMaybe(PDFName.of("URI"), PDFString);
  return u ? u.decodeText() : null;
}
const pf = (id: string, name: string, size: number, contentType = "application/pdf") =>
  ({ id, kind: "plan", name, blobPath: `estimate-files/Q-1/UP-0123456789abcdef/${name}`, contentType, size, source: "upload", addedAt: 1, addedBy: "Pat" }) as never;

async function appendixPureChecks(ok: Ok) {
  const MB = 1024 * 1024;
  const plan = planDrawings([pf("PF-000000000001", "a.pdf", 30 * MB), pf("PF-000000000002", "b.pdf", 25 * MB), pf("PF-000000000003", "c.pdf", 25 * MB), pf("PF-000000000004", "d.pdf", 25 * MB), pf("PF-000000000005", "e.pdf", 5 * MB)]);
  ok(JSON.stringify(plan.map((e) => [e.file.name, e.skip])) === JSON.stringify([["a.pdf", "too-big"], ["b.pdf", null], ["c.pdf", null], ["d.pdf", null], ["e.pdf", "over-total"]]) && DRAWINGS_TOTAL_MAX_BYTES === 80 * MB,
    "drawings: list order, 25 MB per file, 80 MB in all — anything over is skipped, never the PDF");
  const land = imagePagePlacement(2000, 1000)!, port = imagePagePlacement(100, 300)!;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  ok(land.pageW === 792 && land.pageH === 612 && near(land.w, 720) && near(land.h, 360) && near(land.x, 36) && near(land.y, 126), "drawings: a wide image gets a landscape letter page, fitted inside 0.5in margins, centred");
  ok(port.pageW === 612 && port.pageH === 792 && Math.abs(port.h - 720) < 1e-9 && Math.abs(port.x - (612 - 240) / 2) < 1e-9 && imagePagePlacement(0, 10) === null && imagePagePlacement(NaN, 1) === null,
    "drawings: a tall image gets a portrait page; a sizeless image is refused");
  const many = pdfNotesOf(Array.from({ length: 9 }, (_, i) => "note " + i).concat(["note 0", " "]));
  ok(many.length === PDF_NOTES_MAX && many[PDF_NOTES_MAX - 1] === APPENDIX_COPY.more(4) && drawingSkipNote({ name: "Plan A.pdf", reason: "encrypted" }).includes("Plan A.pdf"),
    "drawings: PDF notes are de-duplicated and capped with '…and N more'");
  ok(appendixFits(85_000) && !appendixFits(85_001) && !appendixFits(-1) && !appendixFits(NaN), "drawings: the appendix starts only while 15 s + the upload allowance fit in the 120 s budget");

  // pdf-lib merge: main, a 2-page 11×17 PDF, a PNG, a WebP, junk; then the links page with its URI annotation.
  const main = await mkPdf([[612, 792], [612, 792]]);
  const tabloid = await mkPdf([[792, 1224], [792, 1224]]);
  const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#ccc" } }).png().toBuffer();
  const webp = await sharp({ create: { width: 100, height: 300, channels: 3, background: "#999" } }).webp().toBuffer();
  const URI = "https://app.test/d/ds/Q-1/PD-spot0001/AAAAAAAAAAAAAAAAAAAAAA";
  const tail = await mkPdf([[612, 792]], URI);
  const m = await mergeEstimateAppendices({ main, tail, drawings: [
    { name: "set.pdf", contentType: "application/pdf", bytes: tabloid },
    { name: "plan.png", contentType: "image/png", bytes: png },
    { name: "riser.webp", contentType: "image/webp", bytes: webp },
    { name: "junk.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) },
    { name: "huge.pdf", contentType: "application/pdf", bytes: null, skip: "too-big" },
  ] });
  const out = await PDFDocument.load(m.bytes);
  const sizes = out.getPages().map((p) => { const s = p.getSize(); return `${Math.round(s.width)}x${Math.round(s.height)}`; });
  ok(m.merged && m.tailAdded && JSON.stringify(sizes) === JSON.stringify(["612x792", "612x792", "792x1224", "792x1224", "792x612", "612x792", "612x792"]),
    "drawings: estimate pages, then each drawing at its own size (11×17 stays 11×17; images on a letter page of their orientation), then the links page");
  ok(uriOf(out.getPage(6)) === URI, "drawings: the links page's URI annotation survives the merge");
  ok(JSON.stringify(m.skipped) === JSON.stringify([{ name: "junk.pdf", reason: "unreadable" }, { name: "huge.pdf", reason: "too-big" }]), "drawings: an unreadable or over-cap drawing is skipped and reported");
  const late = await mergeEstimateAppendices({ main, tail: null, drawings: [{ name: "set.pdf", contentType: "application/pdf", bytes: tabloid }], deadline: 10, now: () => 11 });
  ok((await PDFDocument.load(late.bytes)).getPageCount() === 2 && late.skipped[0]?.reason === "late", "drawings: past the deadline a drawing is skipped as late");
  const broken = await mergeEstimateAppendices({ main: new Uint8Array([9, 9]), tail, drawings: [{ name: "set.pdf", contentType: "application/pdf", bytes: tabloid }] });
  ok(!broken.merged && Buffer.compare(broken.bytes, Buffer.from([9, 9])) === 0 && broken.skipped[0]?.reason === "unreadable", "drawings: an unreadable estimate keeps Chrome's bytes untouched (never fails)");

  // The PDF state carries the notes; the banner shows them on a ready file.
  const ready = settlePdf({ status: "pending", at: 1, savedAt: 5 }, 5, { ok: true, blobPath: "p.pdf", notes: ["Drawing “x” was left out."] }, 9)!;
  const plain = settlePdf({ status: "pending", at: 1, savedAt: 5 }, 5, { ok: true, blobPath: "p.pdf" }, 9)!;
  ok(JSON.stringify(ready.notes) === JSON.stringify(["Drawing “x” was left out."]) && !("notes" in plain), "drawings: a ready PDF records its notes (none → no key)");
  const view = pdfView(ready, 10)!;
  ok(JSON.stringify(view.notes) === JSON.stringify(ready.notes) && pdfBanner({ quoteId: "Q-1", pdf: view, dirty: false, timedOut: false, retrying: false }).some((n) => n.tone === "warn" && n.text === "Drawing “x” was left out."),
    "drawings: Customer review → Document shows each note as a warning");
}
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/test-photo-wrap.ts` → module not found `appendix-plan`.

- [ ] **Step 3: Pure plan** — create `src/lib/quote-pdf/appendix-plan.ts`:

```ts
import { MAX_PACKAGE_FILE_BYTES, type PackageFile } from "@/lib/estimate-output/package-files";

/**
 * Spec 2026-10-16 §4 — the drawings merged into the customer PDF, the pure
 * half: which Plans & risers files are taken (list order, 25 MB each, 80 MB
 * in all), where an image sits on its page, and the notes a skipped drawing
 * leaves on the PDF state. Never decides to fail the PDF. Client-safe.
 */

export const DRAWINGS_TOTAL_MAX_BYTES = 80 * 1024 * 1024;
export const PDF_NOTES_MAX = 6;
const NOTE_MAX = 200;

export type DrawingSkipReason = "too-big" | "over-total" | "unreadable" | "encrypted" | "late";
export type DrawingSkip = { name: string; reason: DrawingSkipReason };

export function planDrawings(
  files: readonly PackageFile[],
  caps: { perFile: number; total: number } = { perFile: MAX_PACKAGE_FILE_BYTES, total: DRAWINGS_TOTAL_MAX_BYTES }
): Array<{ file: PackageFile; skip: DrawingSkipReason | null }> {
  let total = 0;
  return files.map((file) => {
    if (!(file.size > 0) || file.size > caps.perFile) return { file, skip: "too-big" as const };
    if (total + file.size > caps.total) return { file, skip: "over-total" as const };
    total += file.size;
    return { file, skip: null };
  });
}

export const LETTER_PT = { w: 612, h: 792 } as const;
export const DRAWING_MARGIN_PT = 36;

/** One image per page: a letter page in the image's orientation (landscape when wider than tall), the image
 *  fitted inside 0.5in margins and centred. Null for an image with no usable size. */
export function imagePagePlacement(imgW: number, imgH: number): { pageW: number; pageH: number; x: number; y: number; w: number; h: number } | null {
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) return null;
  const landscape = imgW > imgH;
  const pageW = landscape ? LETTER_PT.h : LETTER_PT.w;
  const pageH = landscape ? LETTER_PT.w : LETTER_PT.h;
  const k = Math.min((pageW - 2 * DRAWING_MARGIN_PT) / imgW, (pageH - 2 * DRAWING_MARGIN_PT) / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

const REASON: Record<DrawingSkipReason, string> = {
  "too-big": "it is over 25 MB",
  "over-total": "the drawings passed 80 MB",
  unreadable: "it couldn’t be read",
  encrypted: "it is a password-protected PDF",
  late: "the PDF ran out of time",
};

export const APPENDIX_COPY = {
  late: "The drawings and datasheet links were left out — the PDF ran out of time. Save again to retry.",
  linksMissing: "The datasheet links page couldn’t be added — save again to retry.",
  tooLargeToEmail: (mb: string) => `This PDF is ${mb} MB — too large to attach to an email; send the link instead.`,
  more: (n: number) => `…and ${n} more.`,
} as const;

export function drawingSkipNote(s: DrawingSkip): string {
  return `Drawing “${s.name}” was left out of the PDF: ${REASON[s.reason]}.`;
}

/** Trimmed, de-duplicated, each ≤ 200 chars, at most PDF_NOTES_MAX (the last says how many more). */
export function pdfNotesOf(lines: readonly string[]): string[] {
  const clean = [...new Set(lines.map((l) => String(l ?? "").trim().slice(0, NOTE_MAX)).filter(Boolean))];
  return clean.length <= PDF_NOTES_MAX ? clean : [...clean.slice(0, PDF_NOTES_MAX - 1), APPENDIX_COPY.more(clean.length - (PDF_NOTES_MAX - 1))];
}

export function sizeMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
```

- [ ] **Step 4: The merge** — create `src/lib/quote-pdf/appendix-merge-server.ts`:

```ts
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { checkPageBox } from "@/lib/part-docs/datasheet-book-server";
import { imagePagePlacement, type DrawingSkip, type DrawingSkipReason } from "./appendix-plan";

/**
 * Spec 2026-10-16 §4–5 — Chrome's estimate pages, then each drawing in list
 * order (a PDF's pages at their own size; a PNG / JPEG — WebP converted to
 * PNG — on one letter page of its orientation), then the datasheet links
 * page (`tail`), saved once. Never throws: an estimate pdf-lib can't read is
 * returned untouched (`merged: false`); a drawing that can't be used is
 * skipped and reported; `deadline` (epoch ms on `now`) skips the rest as late.
 * The datasheet book's load / copy / page-box checks (#329). Server-only.
 */

export type DrawingInput = { name: string; contentType: string; bytes: Uint8Array | null; skip?: DrawingSkipReason };

const tick = () => new Promise<void>((r) => setImmediate(r));

export async function mergeEstimateAppendices(i: {
  main: Uint8Array;
  drawings: readonly DrawingInput[];
  tail: Uint8Array | null;
  deadline?: number;
  now?: () => number;
}): Promise<{ bytes: Buffer; skipped: DrawingSkip[]; tailAdded: boolean; merged: boolean }> {
  const now = i.now ?? Date.now;
  const untouched = () => ({ bytes: Buffer.from(i.main), skipped: i.drawings.map((d) => ({ name: d.name, reason: d.skip ?? ("unreadable" as const) })), tailAdded: false, merged: false });
  let out: PDFDocument;
  try {
    out = await PDFDocument.load(i.main, { updateMetadata: false });
  } catch (e) {
    console.warn("[quote-pdf] estimate PDF not mergeable — drawings left out", e instanceof Error ? e.message : e);
    return untouched();
  }
  const skipped: DrawingSkip[] = [];
  for (const d of i.drawings) {
    if (d.skip) {
      skipped.push({ name: d.name, reason: d.skip });
      continue;
    }
    if (i.deadline !== undefined && now() >= i.deadline) {
      skipped.push({ name: d.name, reason: "late" });
      continue;
    }
    if (!d.bytes || !d.bytes.byteLength) {
      skipped.push({ name: d.name, reason: "unreadable" });
      continue;
    }
    try {
      if (d.contentType === "application/pdf") {
        const src = await PDFDocument.load(d.bytes, { ignoreEncryption: true, updateMetadata: false });
        if (src.isEncrypted) {
          skipped.push({ name: d.name, reason: "encrypted" });
          continue;
        }
        const pages = await out.copyPages(src, src.getPageIndices());
        if (!pages.length) throw new Error("PDF has no pages");
        pages.forEach((p, n) => checkPageBox(p, n + 1));
        for (const p of pages) out.addPage(p);
      } else {
        const img =
          d.contentType === "image/jpeg"
            ? await out.embedJpg(d.bytes)
            : await out.embedPng(d.contentType === "image/webp" ? await sharp(d.bytes).png().toBuffer() : d.bytes);
        const at = imagePagePlacement(img.width, img.height);
        if (!at) throw new Error("image has no size");
        out.addPage([at.pageW, at.pageH]).drawImage(img, { x: at.x, y: at.y, width: at.w, height: at.h });
      }
    } catch (e) {
      console.warn(`[quote-pdf] drawing "${d.name}" not merged: ${e instanceof Error ? e.message : String(e)}`);
      skipped.push({ name: d.name, reason: "unreadable" });
    }
    await tick(); // let other I/O through between drawings
  }
  let tailAdded = false;
  if (i.tail) {
    try {
      const src = await PDFDocument.load(i.tail, { updateMetadata: false });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
      tailAdded = pages.length > 0;
    } catch (e) {
      console.warn("[quote-pdf] datasheet links page not merged", e instanceof Error ? e.message : e);
    }
  }
  try {
    return { bytes: Buffer.from(await out.save()), skipped, tailAdded, merged: true };
  } catch (e) {
    console.warn("[quote-pdf] merged PDF not saved — drawings left out", e instanceof Error ? e.message : e);
    return untouched();
  }
}
```

- [ ] **Step 5: State + banner** — `src/lib/quote-pdf/state.ts`:
  - `QuotePdfState`, after `printed?`: `/** Spec 2026-10-16 §4 — what this READY file left out (a skipped drawing, a missing links page, too large to email). Absent = nothing. */ notes?: string[];`
  - `QuotePdfView`: `/** The ready file's notes (Customer review → Document shows them as warnings). */ notes?: string[];`
  - `PdfOutcome`: `{ ok: true; blobPath: string; printed?: DocumentRevStamp | null; notes?: string[] | null }`.
  - `settlePdf` ready branch: `return { status: "ready", at: now, savedAt, blobPath: outcome.blobPath, ...(outcome.printed ? { printed: outcome.printed } : {}), ...(outcome.notes && outcome.notes.length ? { notes: outcome.notes.slice(0, 6) } : {}) };`
  - `pdfView` normal branch: add `...(pdf.status === "ready" && Array.isArray(pdf.notes) && pdf.notes.length ? { notes: pdf.notes } : {}),` as the last field (absent otherwise, so every existing view object is unchanged).

  `src/components/quote-pdf/pdf-banner.ts` — before `return notes;`:

```ts
  // Spec 2026-10-16 §4: what the ready file left out (a drawing, the links page), and an over-email-size PDF.
  if (!s.dirty && s.pdf?.status === "ready") for (const text of s.pdf.notes ?? []) notes.push({ tone: "warn", text });
```

- [ ] **Step 6: The generator** — `src/lib/quote-pdf/generate.ts`:

Imports:

```ts
import type { Quote } from "@/lib/stores/quotes";
import { cleanPackageFiles, MAX_PACKAGE_FILE_BYTES, shownPackageFiles, type PackageFile } from "@/lib/estimate-output/package-files";
import { loadDatasheetLinkRows } from "@/lib/estimate-output/datasheet-links-server";
import { readBlobCapped } from "@/lib/narrative/photos";
import { ESTIMATE_EMAIL_ATTACH_MAX } from "@/lib/estimate-email/compose";
import { APPENDIX_COPY, drawingSkipNote, pdfNotesOf, planDrawings, sizeMb } from "./appendix-plan";
import { mergeEstimateAppendices, type DrawingInput } from "./appendix-merge-server";
```

`GenerateInput` — after `deadlineSignal?`:

```ts
  /** Spec 2026-10-16 §4–5 seam — the shown drawings and whether a datasheet links page prints (default loadAppendixSources). */
  appendix?: (q: Quote, origin: string) => Promise<AppendixSources>;
  /** Spec-harness seam — one drawing's bytes (default: its private Blob, capped at 25 MB). */
  readDrawing?: (file: PackageFile, signal: AbortSignal) => Promise<Uint8Array | null>;
```

After `stampRerenderDeadlineMs`:

```ts
/**
 * Spec 2026-10-16 §4–5 — the least time worth starting the drawings appendix (the links render, the drawing
 * reads and the merge). Like the stamp re-render it is opportunistic: it starts only while elapsed + this +
 * the upload allowance fit the 120 s budget (elapsed ≤ 85 s) and is hard-stopped at stampRerenderDeadlineMs.
 */
export const APPENDIX_MIN_MS = 15_000;

export function appendixFits(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs + APPENDIX_MIN_MS + PDF_UPLOAD_ALLOWANCE_MS <= PDF_FUNCTION_BUDGET_MS;
}

export type AppendixSources = { drawings: PackageFile[]; hasLinks: boolean };

/** The drawings the client is shown (Client package → Drawings off = none) and — only when there are drawings to
 *  put before them — whether the links page has rows. With no drawings the links print in the one render. */
export async function loadAppendixSources(q: Quote, origin: string): Promise<AppendixSources> {
  const drawings = shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection);
  if (!drawings.length) return { drawings, hasLinks: false };
  return { drawings, hasLinks: (await loadDatasheetLinkRows(q, origin)).length > 0 };
}

const readDrawingFromBlob = (file: PackageFile, signal: AbortSignal) => readBlobCapped(file.blobPath, MAX_PACKAGE_FILE_BYTES, signal);
```

In `generateQuotePdf`, replace from `const render = …` through the end of the stamp re-render block (≈166-201) with:

```ts
    const render = input.render ?? renderPrintRouteToPdf;
    // Spec 2026-10-16 §4–5: the customer PDF's drawings (+ links after them). Never fails the PDF.
    let appendix: AppendixSources = { drawings: [], hasLinks: false };
    if (kind === "quote") {
      try {
        appendix = await (input.appendix ?? loadAppendixSources)(q, input.origin);
      } catch (e) {
        console.warn("[quote-pdf] drawings unavailable — printing without them", quoteId, reason(e));
      }
    }
    const split = appendix.drawings.length > 0;
    const printUrl = (part?: "main" | "tail") =>
      `${input.origin}${printPathFor(kind, quoteId)}?t=${encodeURIComponent(signPrintToken(secret, kind, quoteId, Date.now()))}${part ? "&part=" + part : ""}`;
    const mainPart = split ? ("main" as const) : undefined;
    let bytes: Buffer;
    try {
      bytes = await render(printUrl(mainPart));
    } catch (e) {
      return await settleFailed(reason(e));
    }
    let printed: DocumentRevStamp | null = null;
    if (kind === "quote") {
      const first = await printedStamp(quoteId, q);
      printed = first.stamp;
      // (the #293 slice 3 fix round 2 comment block stays as it is)
      const elapsed = clock() - startedAt;
      if (!printed && first.after && isPendingFor(first.after.pdf, savedAt) && stampRerenderFits(elapsed)) {
        const signal = (input.deadlineSignal ?? ((ms: number) => AbortSignal.timeout(ms)))(stampRerenderDeadlineMs(elapsed));
        try {
          const again = await render(printUrl(mainPart), { signal });
          const second = await printedStamp(quoteId, first.after);
          bytes = again;
          printed = second.stamp;
        } catch (e) {
          console.warn("[quote-pdf] stamp re-render failed — keeping the first file, unstamped", quoteId, reason(e));
        }
      }
    }
    const notes: string[] = [];
    if (split) {
      const elapsed = clock() - startedAt;
      if (!appendixFits(elapsed)) notes.push(APPENDIX_COPY.late);
      else {
        const ms = stampRerenderDeadlineMs(elapsed);
        const signal = (input.deadlineSignal ?? ((m: number) => AbortSignal.timeout(m)))(ms);
        const deadline = clock() + ms;
        let tail: Buffer | null = null;
        if (appendix.hasLinks) {
          try {
            tail = await render(printUrl("tail"), { signal });
          } catch (e) {
            console.warn("[quote-pdf] datasheet links render failed", quoteId, reason(e));
          }
        }
        const read = input.readDrawing ?? readDrawingFromBlob;
        const drawings: DrawingInput[] = [];
        for (const { file, skip } of planDrawings(appendix.drawings)) {
          if (skip) drawings.push({ name: file.name, contentType: file.contentType, bytes: null, skip });
          else if (signal.aborted) drawings.push({ name: file.name, contentType: file.contentType, bytes: null, skip: "late" });
          else {
            try {
              drawings.push({ name: file.name, contentType: file.contentType, bytes: await read(file, signal) });
            } catch {
              drawings.push({ name: file.name, contentType: file.contentType, bytes: null, skip: signal.aborted ? "late" : "unreadable" });
            }
          }
        }
        const merged = await mergeEstimateAppendices({ main: bytes, drawings, tail, deadline, now: clock });
        bytes = merged.bytes;
        notes.push(...merged.skipped.map(drawingSkipNote));
        if (appendix.hasLinks && !merged.tailAdded) notes.push(APPENDIX_COPY.linksMissing);
      }
    }
    if (kind === "quote" && bytes.length > ESTIMATE_EMAIL_ATTACH_MAX) notes.push(APPENDIX_COPY.tooLargeToEmail(sizeMb(bytes.length)));
```

and the settle line becomes `res = await updatePdf(quoteId, (cur) => settleIfPending(cur, savedAt, { ok: true, blobPath: path, printed, notes: pdfNotesOf(notes) }));`.

Note: `q` is a `Quote`; the existing `let q = await getQuote(quoteId)` narrows to non-null before this point.

- [ ] **Step 7: The generator, end to end (DB)** — add `appendixDbChecks(ok)` and await it from `photoWrapDbChecks`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateQuotePdf } from "../src/lib/quote-pdf/generate";
import { pdfStorage } from "../src/lib/quote-pdf/storage";
import { buildQuote, get as getQuote, updateQuotePdf } from "../src/lib/stores/quotes";
import { quotePathSegment } from "../src/lib/estimate-output/package-files";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";

const FIX = "photo-wrap";

async function appendixDbChecks(ok: Ok) {
  const keys = ["BLOB_READ_WRITE_TOKEN", "VERCEL", "QUOTE_PDF_DIR"] as const;
  const prev = keys.map((k) => [k, process.env[k]] as const);
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
  const root = mkdtempSync(join(tmpdir(), "quote-pdfs-pw-"));
  process.env.QUOTE_PDF_DIR = root;
  try {
    const qid = fixtureId(FIX, "drawings");
    const seg = quotePathSegment(qid);
    const file = (id: string, name: string, contentType: string, size: number) =>
      ({ id, kind: "plan", name, blobPath: `estimate-files/${seg}/UP-0123456789abcdef/${name}`, contentType, size, source: "upload", addedAt: 1, addedBy: "Pat" });
    const sec = { id: "sysP", name: "PW", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "PW-1", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
    const quote = { ...buildQuote(qid, { name: "PW drawings", customer: "PW", value: 20, spec: { sections: [sec], mobs: [] } } as never, "system", null, Date.now()),
      packageFiles: [file("PF-0000000000a1", "set.pdf", "application/pdf", 2000), file("PF-0000000000a2", "plan.png", "image/png", 2000)] };
    await createFixture("quotes", quote as never);
    const tabloid = await mkPdf([[792, 1224]]);
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ddd" } }).png().toBuffer();
    const urls: string[] = [];
    const render = async (url: string) => { urls.push(url); return url.includes("&part=tail") ? mkPdf([[612, 792]], "https://print.test/d/ds/x/PD-spot0001/AAAAAAAAAAAAAAAAAAAAAA") : mkPdf([[612, 792], [612, 792]]); };
    const readDrawing = async (f: { name: string }) => (f.name === "set.pdf" ? tabloid : png);
    const run = async (extra: Record<string, unknown>) => {
      const s = Date.now();
      await updateQuotePdf(qid, () => ({ status: "pending", at: s, savedAt: s }));
      urls.length = 0;
      await generateQuotePdf({ quoteId: qid, savedAt: s, origin: "http://print.test", secret: "pw-secret", render, readDrawing, ...extra } as never);
      const q = await getQuote(qid);
      const store = pdfStorage();
      const bytes = q?.pdf?.blobPath && !("unavailable" in store) ? await store.read(q.pdf.blobPath) : null;
      return { q, doc: bytes ? await PDFDocument.load(bytes) : null };
    };

    // The quote's own Plans & risers (no datasheets in the test catalog → no links render).
    const a = await run({});
    ok(urls.length === 1 && urls[0].includes("&part=main") && a.q?.pdf?.status === "ready" && a.doc?.getPageCount() === 4 &&
       JSON.stringify(a.doc!.getPages().map((p) => Math.round(p.getSize().height))) === "[792,792,1224,612]",
      "generate: a quote with drawings prints the estimate (part=main), then its 11×17 set and its PNG on a landscape page");

    // With a links page: rendered as the tail, after the drawings; a broken drawing becomes a note.
    const b = await run({ appendix: async () => ({ drawings: [...quote.packageFiles, file("PF-0000000000a3", "bad.pdf", "application/pdf", 10)], hasLinks: true }),
      readDrawing: async (f: { name: string }) => (f.name === "set.pdf" ? tabloid : f.name === "plan.png" ? png : new Uint8Array([1])) });
    ok(urls.length === 2 && urls[1].includes("&part=tail") && b.doc?.getPageCount() === 5 && uriOf(b.doc!.getPage(4)) !== null &&
       (b.q?.pdf?.notes || []).some((n) => n.includes("bad.pdf")),
      "generate: the datasheet links come last (after the drawings) and a drawing that couldn't be read is a note on the PDF");

    // Out of time: estimate only + a note; never a failure.
    let t = 0;
    const c = await run({ now: () => (t += 50_000) });
    ok(c.q?.pdf?.status === "ready" && c.doc?.getPageCount() === 2 && (c.q?.pdf?.notes || []).includes(APPENDIX_COPY.late), "generate: no time left → the estimate alone, with a note");

    // No drawings → exactly today's single render (no part, no pdf-lib).
    const d = await run({ appendix: async () => ({ drawings: [], hasLinks: false }) });
    ok(urls.length === 1 && !urls[0].includes("part=") && d.doc?.getPageCount() === 2 && !d.q?.pdf?.notes, "generate: no drawings → one render, as before");
  } finally {
    await dropFixtures(FIX);
    for (const [k, v] of prev) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
  }
}
```

Adjust `buildQuote`'s call to the signature `test-oct15-estimating.ts:394` uses if it differs; the fake clock in case `c` makes elapsed exceed 85 s before the appendix (every `clock()` call adds 50 s).

- [ ] **Step 8: Run** — `npx tsx scripts/test-photo-wrap.ts` (pure) → 0 FAIL; then the DB half: `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-photo-wrap.ts; rm -rf "$TEST_DB"` → 0 FAIL.

- [ ] **Step 9: Gate** — `npx tsc --noEmit -p .`; `npm run test:specs` → 0 FAIL (every existing `generateQuotePdf` check: no drawings → unchanged URL and bytes; the #222 / #293 budget pins unchanged); `npx eslint` on the new/changed files. `pdf-banner.ts` is client-reachable: `npx next build` must pass (it imports only `state.ts`).

- [ ] **Step 10: Commit**

```bash
git add src/lib/quote-pdf/appendix-plan.ts src/lib/quote-pdf/appendix-merge-server.ts src/lib/quote-pdf/generate.ts src/lib/quote-pdf/state.ts src/components/quote-pdf/pdf-banner.ts scripts/test-photo-wrap.ts
git commit -m "feat(photo-wrap): merge Plans & risers drawings into the customer PDF before the datasheet links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Re-render on drawing / datasheet changes, docs, and the final verification gate

**Files:**
- Create: `src/lib/quote-pdf/appendix-key.ts`
- Modify: `src/app/(app)/estimator/package-actions.ts:22-44, 101-114` (add / remove / Generate from Grid)
- Modify: `src/app/(app)/estimator/actions.ts:1243-1265` (`updateQuoteMetaAction` selection path)
- Modify: `src/app/(app)/estimator/use-estimator-state.ts:826-828` (`enqueueSelectionWrite` takes `r.pdf`)
- Modify: `src/app/(app)/estimator/package-staff-panel.tsx:38-53, 106-165` (`onPdf`)
- Modify: `src/app/(app)/estimator/steps/client-package-tab.tsx:293`, `steps/package-narrative-tab.tsx:342`, `steps/send-step.tsx:287` (pass `onPdf`)
- Modify (comments): `src/lib/estimate-output/package-selection.ts:1-11`, `src/lib/stores/quotes.ts:2510-2516`
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`
- Test: `scripts/test-photo-wrap.ts`

**Interfaces:**
- Consumes: `shownPackageFiles`, `cleanPackageFiles`, `normalizePackageSelection`; `scheduleQuotePdf` (`src/lib/quote-pdf/schedule.ts:32`); `QuotePdfView`.
- Produces: `pdfAppendixKey(q: { packageFiles?: unknown; packageSelection?: unknown } | null | undefined): string`; package actions return `{ ok: true; pdf?: QuotePdfView } | { ok: false; error: string }`; `updateQuoteMetaAction` returns `pdf` on a selection-only write that moved the key; `PackageStaffPanel` prop `onPdf?: (v: QuotePdfView) => void`.

- [ ] **Step 1: Write the failing tests** — append `rerenderChecks(ok)` and call it from `photoWrapPureChecks`:

```ts
import { pdfAppendixKey } from "../src/lib/quote-pdf/appendix-key";

function rerenderChecks(ok: Ok) {
  const files = [pf("PF-000000000001", "a.pdf", 10), { ...pf("PF-000000000002", "b.pdf", 10), source: "grid", blobPath: "estimate-files/Q-1/grid/drawing-set.pdf" }];
  const k0 = pdfAppendixKey({ packageFiles: files, packageSelection: null });
  ok(k0 === pdfAppendixKey({ packageFiles: files, packageSelection: { estimatePdf: false, coverPdf: false } }), "rerender: the email attachment defaults never re-render the PDF");
  ok(k0 !== pdfAppendixKey({ packageFiles: files, packageSelection: { drawings: false } }) && k0 !== pdfAppendixKey({ packageFiles: files, packageSelection: { excludedDatasheets: ["ETC:SPOT"] } }) &&
     k0 !== pdfAppendixKey({ packageFiles: files.slice(1), packageSelection: null }), "rerender: drawings on/off, a left-out datasheet and an added/removed drawing each change what the PDF prints");
  ok(pdfAppendixKey(null) === "" && pdfAppendixKey({}) === pdfAppendixKey({ packageFiles: [], packageSelection: undefined }), "rerender: no quote / nothing → a stable key");
  const pa = rd("src/app/(app)/estimator/package-actions.ts"), act = rd("src/app/(app)/estimator/actions.ts"), hook = rd("src/app/(app)/estimator/use-estimator-state.ts"), panel = rd("src/app/(app)/estimator/package-staff-panel.tsx");
  ok((pa.match(/rerenderIfAppendixMoved\(/g) || []).length === 4 && pa.includes("scheduleQuotePdf(") && pa.includes("pdfAppendixKey("), "rerender: drawing upload, remove and Generate from Grid re-render the PDF when the shown drawings moved");
  ok(act.includes("pdfAppendixKey(") && act.includes("selectionPdf"), "rerender: a Client package selection write re-renders the PDF when its drawings / datasheets changed");
  ok(/const r = await updateQuoteMetaAction\(id, \{ packageSelection: latest \}\);[\s\S]{0,200}if \(r\.pdf\) setPdf\(r\.pdf\);/.test(hook) && panel.includes("onPdf?.(r.pdf)"),
    "rerender: the Estimator's PDF view follows (Updating PDF…)");
  ok(!rd("src/app/(app)/estimator/pdf-doc-key.ts").includes("packageFiles"), "rerender: the client's Unsaved-changes key is untouched (these writes save themselves)");
}
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/test-photo-wrap.ts` → module not found `appendix-key`.

- [ ] **Step 3: The key** — create `src/lib/quote-pdf/appendix-key.ts`:

```ts
import { cleanPackageFiles, shownPackageFiles } from "@/lib/estimate-output/package-files";
import { normalizePackageSelection } from "@/lib/estimate-output/package-selection";

/**
 * Spec 2026-10-16 §4 — what of the package (which is NOT content: no updatedAt bump, no approval change) the
 * customer PDF prints: the drawings shown (id + file) and the datasheet choices. The writers compare it before
 * and after and re-render the PDF when it moved. Pure; client-safe.
 */
export function pdfAppendixKey(q: { packageFiles?: unknown; packageSelection?: unknown } | null | undefined): string {
  if (!q) return "";
  const sel = normalizePackageSelection(q.packageSelection);
  return JSON.stringify([shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection).map((f) => [f.id, f.blobPath]), sel.drawings, sel.excludedDatasheets]);
}
```

- [ ] **Step 4: The writers**

`src/app/(app)/estimator/package-actions.ts` — imports `import { pdfAppendixKey } from "@/lib/quote-pdf/appendix-key";`, `import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";`, `import type { QuotePdfView } from "@/lib/quote-pdf/state";`. Helper:

```ts
/** Spec 2026-10-16 §4 — the drawings print in the customer PDF: re-render it when the shown list moved. */
async function rerenderIfAppendixMoved(quoteId: string, beforeKey: string): Promise<QuotePdfView | undefined> {
  const q = await getQuote(quoteId);
  if (!q || pdfAppendixKey(q) === beforeKey) return undefined;
  return (await scheduleQuotePdf(q.id)) ?? undefined;
}
```

In each of `addPackageFileAction`, `removePackageFileAction`, `generateGridDrawingsAction`: change the return type to `Promise<{ ok: true; pdf?: QuotePdfView } | { ok: false; error: string }>`, read `const before = pdfAppendixKey(await getQuote(String(quoteId || "")));` before the write, and on success:

```ts
    if (!r.ok) return { ok: false, error: r.error };
    const pdf = await rerenderIfAppendixMoved(String(quoteId || ""), before);
    return { ok: true, ...(pdf ? { pdf } : {}) };
```

(Four `rerenderIfAppendixMoved(` occurrences: the definition + three calls.)

`src/app/(app)/estimator/actions.ts` `updateQuoteMetaAction` — import `pdfAppendixKey`; replace the selection block and the selection-only return:

```ts
  let selectionError: string | undefined;
  let selectionPdf: QuotePdfView | undefined;
  if (meta.packageSelection !== undefined) {
    const before = pdfAppendixKey(await get(id));
    const r = await setPackageSelection(id, meta.packageSelection, selectionFollowingRenames);
    if (!r.ok) selectionError = r.error;
    else {
      // Spec 2026-10-16 §4: the drawings switch and left-out datasheets print in the customer PDF (drawings,
      // datasheet links) — still not content (no updatedAt bump), but the PDF re-renders when they moved.
      const now = await get(id);
      if (now && pdfAppendixKey(now) !== before) selectionPdf = (await scheduleQuotePdf(id)) ?? undefined;
    }
  }
  if (!Object.keys(patch).length) {
    // Selection-only (or empty): no update(), so no updatedAt bump.
    if (!selectionError) refresh();
    return selectionError ? { ok: false, error: selectionError } : { ok: true, ...(selectionPdf ? { pdf: selectionPdf } : {}) };
  }
```

and the header path's PDF line: `const pdf = q && q.contentChangedAt === q.updatedAt ? await scheduleQuotePdf(q.id) : selectionPdf;`. Update the #333 comment above it ("never re-renders the PDF" → "re-renders the PDF only when the drawings or left-out datasheets changed (spec 2026-10-16)").

`use-estimator-state.ts` `enqueueSelectionWrite` — after `selectionAckedKey.current = key;` add `if (r.pdf) setPdf(r.pdf);` (it runs long after render, so the later `setPdf` declaration is in scope; if eslint's hook rules object to the forward reference, move the `pdf` / `setPdf` `useState` above the selection block).

`package-staff-panel.tsx` — props: `/** Spec 2026-10-16 §4: a drawing change re-rendered the customer PDF — hand the Estimator its view (Updating PDF…). */ onPdf?: (v: QuotePdfView) => void;`; after each successful `addPackageFileAction` / `removePackageFileAction` / `generateGridDrawingsAction` result add `if (r.ok && r.pdf) onPdf?.(r.pdf);`. Pass `onPdf={s.setPdf}` at the mounts in `steps/client-package-tab.tsx:293`, `steps/package-narrative-tab.tsx:342` and `steps/send-step.tsx:287` (each has the hook state `s`; destructure `setPdf` where the component destructures). `client-link-panel.tsx:214` has no hook state — leave it (its PDF view refreshes on the next poll/focus).

Comments: `src/lib/estimate-output/package-selection.ts` header — replace "nothing here prints on the estimate PDF, so a change never stales the PDF or an approval" with "a change never stales an approval; since 2026-10-16 the drawings switch and left-out datasheets print in the customer PDF (merged drawings, datasheet links), so their writers re-render it (pdfAppendixKey)". Same sense in the `setPackageSelection` doc comment in `src/lib/stores/quotes.ts`.

- [ ] **Step 5: Run feature tests** — `npx tsx scripts/test-photo-wrap.ts` → 0 FAIL.

- [ ] **Step 6: Docs**

`DECISIONS.md` — append (placeholder numbers; renumber at merge):

```markdown
## D-TBD-a. Key-product photos spread down the system's text (photo wrap, 2026-10-16)

A system's printed text is a list of units — each narrative paragraph or bullet list, then each key product. Photo k floats before unit k; extra photos stack before the last unit. Sides still alternate right, left, right across the document. The system body is the only float container, so a photo never spills into the next system. The same rule runs in the PDF, the online estimate and the package page. In the Build package document a product block is now a plain block, so its photo also wraps the paragraphs after it.

## D-TBD-b. Each photo carries its model number in the outer bottom corner

The tag prints the Model # only (#304 `lineModel`): the line's own Model #, else the part's, else the line's MFR P/N, else `partModel`. An assembly line uses the member part whose photo prints. A placeholder image is tagged only with the line's own Model # or MFR P/N. The tags come from one extra batched catalog read beside the photo read (`loadKeyProductModels`). The editor shows the same tag from the library row.

## D-TBD-c. The estimate PDF opens on a title page; pricing follows the narratives

Print layout only. Page 1 holds the letterhead, the title block, Prepared for / Project / Prepared by, the bid line and the cover note. Then the systems (or the package document), Alternates and Optional additions. Then the totals, terms, acceptance, footer and assumptions. The investment band is no longer printed in the PDF; the totals block shows the Total. The BOM appendix starts a new page last. The online estimate keeps its order. The bidder PDF gets the same order.

## D-TBD-d. Drawings are merged into the customer PDF; problems become notes, never a failure

The Plans & risers the client is shown are appended in list order. A PDF's pages keep their own size; a PNG or JPEG gets one letter page in its orientation (WebP converted first). Caps: 25 MB a file, 80 MB in all, inside the 120 s budget. A skipped drawing, a missing links page, or a PDF over the 15 MB email limit is recorded as a note on the PDF state (`notes`, not `pdfNotes`) and shown in Customer review. The bidder PDF never has drawings.

## D-TBD-e. Datasheet links render as a separate part of the print route

The links page is rendered by the print route but, when there are drawings to go before it, as its own Chrome render (`?part=tail`) after the estimate (`?part=main`). The appendix starts only while it fits the 120 s budget, like the #293 stamp re-render. With no drawings the PDF is one render as before. This replaces the spec's "second page.pdf() pass on the same page" so the renderer, its budget pins and its test seam stay as they are.

## D-TBD-f. Permanent datasheet links

`/d/ds/<quote>/<doc>/<sig>` serves our stored datasheet inline with no session and no expiry. The signature is HMAC-SHA256 under a key derived from AUTH_SECRET. It works only while the quote exists and its current package still lists that datasheet. Revoking the client link doesn't affect it; rotating AUTH_SECRET breaks every link. Only datasheets with a stored file are listed (URL-only ones have no hosted copy). The URL uses the print origin, so production needs QUOTE_PDF_ORIGIN for links that outlive a deployment.

## D-TBD-g. Drawing and datasheet-choice changes re-render the PDF without becoming content

Drawing upload, remove and Generate from Grid, plus the Client package Drawings switch and left-out datasheets, re-render the customer PDF when `pdfAppendixKey` changes. They still don't bump updatedAt or stale an approval. The client's "Unsaved changes" key is unchanged, because these writes save themselves.

## D-TBD-h. Catalog-side datasheet changes don't re-render quotes

A datasheet added or replaced in Catalog → Datasheets shows up on a quote's links page at its next re-render. A replaced document's old link answers 404.
```

`PUNCHLIST.md` — append:

```markdown
## TBD. Estimate photo wrap, model tags, PDF title page, drawings + datasheet links — DONE 2026-10-16 on `feat/narrative-photo-wrap` (D-TBD-a…h)

Spec `docs/superpowers/specs/2026-10-16-estimate-photo-wrap-title-page-design.md`; plan `docs/superpowers/plans/2026-10-16-estimate-photo-wrap-title-page.md`. Key-product photos spread through each system's narrative with a model-number tag (PDF, online estimate, package page, Build package document + editor). The PDF opens on a title page, has no investment band, and puts pricing after the narratives and the BOM last. The customer PDF then appends the client's drawings (merged with pdf-lib) and a page of permanent datasheet links (`/d/ds/…`). Drawing and datasheet-choice changes re-render it. No migration. Verification: <tsc / test:specs N PASS / test:smoke N PASS / eslint / next build / Q-2041 render — fill in>.

**Rollback:** safe. Only new optional JSON (`pdf.notes`). Old PDFs stay as stored; the datasheet links printed in new PDFs stop working after a rollback (the route is gone).

**Remaining (Jeff-gated):**
- Set `QUOTE_PDF_ORIGIN` in production before relying on the datasheet links (they use the print origin).
- On production after merge: open one estimate with drawings + datasheets and check the page order, an 11×17 drawing at full size, and that a datasheet link opens without signing in.
- Check a large drawing set (~80 MB) renders within the function's memory; lower the cap if not.
- Decide whether an estimate PDF over 15 MB should still be emailed as a link only (today: a note says so).
```

`AGENTS.md` — after phase 59, add:

```markdown
60. ✅ **Estimate photo wrap + PDF appendices** (#TBD, D-TBD-a…h) — key-product photos spread
    down each system's text (`src/lib/estimate-output/photo-spread.ts`: photo k before unit k,
    sides alternating, the system body the only float box) with a model-number tag on the outer
    bottom corner (`photo-models.ts`, `loadKeyProductModels`), in the PDF, online estimate,
    package page and the Build package document (product blocks are plain blocks now) + editor.
    The PDF (print layout only) opens on a title page (cover note there, no investment band),
    pricing follows the narratives, the BOM appendix is last; then the client's drawings merged
    with pdf-lib (`src/lib/quote-pdf/appendix-*.ts`; 25 MB / 80 MB caps, own page size, notes on
    `pdf.notes`, never a failure) and a page of permanent datasheet links
    (`/d/ds/<quote>/<doc>/<sig>`, `datasheet-link*.ts`, public in middleware). The print route's
    `?part=main|tail` splits around the drawings; `pdfAppendixKey` re-renders on drawing /
    selection changes. Bidder PDFs get the order but no drawings or links. No migration.
    Remaining is Jeff-gated: `QUOTE_PDF_ORIGIN` in production, a real estimate with drawings on
    production, and a big-drawing memory check. Punch item #TBD.
```

- [ ] **Step 7: Final verification gate** (report real numbers)

```bash
ps aux | grep -E "next dev|tsx" | grep -v grep   # must print nothing
npx tsc --noEmit -p .
npm run test:specs
npx eslint $(git diff --name-only main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 'scripts/test-photo-wrap.ts')
rm -rf .next && npm run test:smoke
npx next build
```

Expected: tsc 0 errors; test:specs 0 FAIL; eslint 0 errors; smoke 0 FAIL; build OK.

- [ ] **Step 8: A real render of the narrative page (no DB)** — a scratch script renders the Task 2 case to HTML and prints it with Chrome:

```bash
S=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/3339db5d-2963-4231-9e21-dd18a1d82e58/scratchpad
cat > "$S/render-wrap.ts" <<'EOF'
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { qd293Props, qd293Sections, quoteDocumentModule293, renderQuoteDocument293 } from "/Users/sm/Downloads/peak-app/.claude/worktrees/photo-wrap/scripts/qd293-cases";
(async () => {
  const uri = async (w: number, h: number, c: string) => "data:image/png;base64," + (await sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer()).toString("base64");
  const long = "Lorem ipsum dolor sit amet, the system narrative keeps going so it wraps around the photos. ".repeat(6);
  const sections = qd293Sections().map((s) => s.id === "s2" ? { ...s, narrative: [long, long, long].join("\n\n"),
    keyProducts: [{ lineKey: "5", sku: "SKU-5", text: "Five.", photo: true }, { lineKey: "6", sku: "SKU-6", text: "Six.", photo: true }] } : s);
  const html = renderQuoteDocument293({ ...qd293Props({ sections: sections as never }), keyProductPhotos: { "SKU-5": { src: await uri(600, 400, "#8aa"), alt: "Five" }, "SKU-6": { src: await uri(300, 600, "#a8a"), alt: "Six" } }, keyProductModels: { "SKU-5": "Jupiter 4", "SKU-6": "CS Spot Jr" } });
  writeFileSync(process.argv[2], `<!doctype html><meta charset="utf-8"><style>:root{--accent:#2b6cb0;--accent-soft:#eef4fb;--font-mono:ui-monospace,monospace}body{font-family:system-ui}</style><style>${quoteDocumentModule293().QUOTE_PRINT_CSS}</style>${html}`);
})();
EOF
npx tsx "$S/render-wrap.ts" "$S/wrap.html"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CH" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$S/wrap.pdf" "file://$S/wrap.html"
"$CH" --headless --disable-gpu --hide-scrollbars --window-size=900,1400 --screenshot="$S/wrap.png" "file://$S/wrap.html"
uv run --with pypdf python3 -c "
import pypdf,sys; r=pypdf.PdfReader(sys.argv[1]); t=[p.extract_text() for p in r.pages]
print('pages',len(r.pages)); print('page1 has QUOTE + cover, no Total:', 'QUOTE' in t[0], 'Cover note.' in t[0], 'Materials' not in t[0])
print('tags:', any('Jupiter 4' in x for x in t), any('CS Spot Jr' in x for x in t))" "$S/wrap.pdf"
```

Expected: page 1 shows QUOTE and the cover note but no Materials/Total; both tags present. Read `$S/wrap.png` with the Read tool: photo 1 right of paragraph 1 with "Jupiter 4" bottom-right, photo 2 left of paragraph 2 with "CS Spot Jr" bottom-left, text wrapping both. Send the PNG and PDF to the user with SendUserFile.

- [ ] **Step 9: A real print-route render of Q-2041 + the public link (scratch DB, never `.data`)**

```bash
S=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/3339db5d-2963-4231-9e21-dd18a1d82e58/scratchpad
DB=$(mktemp -d); PGLITE_PATH="$DB" npx next dev -p 3123 > "$S/dev.log" 2>&1 &
# wait until http://localhost:3123/login answers 200 (poll with curl -s -o /dev/null -w '%{http_code}')
T=$(set -a; . ./.env.local; set +a; npx tsx -e 'import { signPrintToken } from "./src/lib/quote-pdf/token"; console.log(signPrintToken(process.env.AUTH_SECRET!, "quote", "Q-2041", Date.now()))')
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$S/q2041.pdf" "http://localhost:3123/print/quote/Q-2041?t=$T"
uv run --with pypdf python3 -c "
import pypdf,sys; r=pypdf.PdfReader(sys.argv[1]); t=[p.extract_text() for p in r.pages]
print('pages',len(r.pages),[ (round(p.mediabox.width),round(p.mediabox.height)) for p in r.pages])
print('p1 title page:', 'QUOTE' in t[0] and 'Prepared for' in t[0] and 'Total investment' not in t[0] and 'Materials' not in t[0])
i=[k for k,x in enumerate(t) if 'Materials' in x]; print('totals page', i)" "$S/q2041.pdf"
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3123/d/ds/Q-2041/PD-abcdef12/AAAAAAAAAAAAAAAAAAAAAA"   # 404 (not a 307 to /login): public, refused
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3123/print/quote/Q-2041?t=$T&part=bogus"                 # 404
kill %1; sleep 1; ps aux | grep -E "next dev" | grep -v grep; rm -rf "$DB"
```

Expected: page 1 is the title page (no totals), totals on a later page, the `/d/ds/…` probe answers 404 without signing in, a bad `part` is 404. Stop the server and confirm no `next dev` is left running. (Drawings and live datasheet links are proven by the Task 8 merge + generate checks; the scratch DB has neither, and the dev server holds the real Blob token — don't upload.)

- [ ] **Step 10: Fill in the PUNCHLIST verification line with the real numbers, then commit**

```bash
git add src/lib/quote-pdf/appendix-key.ts "src/app/(app)/estimator/package-actions.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/package-staff-panel.tsx" "src/app/(app)/estimator/steps/client-package-tab.tsx" "src/app/(app)/estimator/steps/package-narrative-tab.tsx" "src/app/(app)/estimator/steps/send-step.tsx" src/lib/estimate-output/package-selection.ts src/lib/stores/quotes.ts scripts/test-photo-wrap.ts DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "feat(photo-wrap): drawing and datasheet-choice changes re-render the PDF; decisions, punch, phase line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage.** §1 spread → Tasks 1–4 (QuoteDocument, package page, package doc + editor; phone rules kept; `.est-kp` keep-together moved to the unit, figure `break-inside: avoid`). §2 tag → Tasks 1–4 (`lineModel`, placeholders, assembly member alias via `photoReadPlan.read`, library rows). §3 order → Task 5 (web unchanged, bidder same route), cut sheets untouched (print route). §4 drawings → Task 8 (+ staleness Task 9, via `pdfAppendixKey`; see Open issue 2). §5 links → Tasks 6–7 (+ split render Task 8; Open issue 1). Not-in-scope items untouched (online order, Cover PDF, Datasheets.pdf book, zip, manuals). Tests section: pure (spread, models, sign/verify, page fit, appendix key), render harness (new cases + three re-captured baselines + p2b-outputs), pdf-lib (sizes, order, annotation), route (404s / inline), smoke, gate + Q-2041 render with pypdf + a narrative screenshot.
- **Placeholders.** Only D-TBD-* / #TBD (required by the controller) and the PUNCHLIST verification numbers filled at Step 10.
- **Type consistency.** `keyProductModels` (prop) / `loadKeyProductModels` (loader) / `models` (package-model input and package-doc ctx) / `model` (`PackageKeyProduct`, `RProduct`, `RImage`) / `ownModel` (`PrintableKeyProduct`) / `modelPart` (library row) are used with the same names in every task. `planDrawings` returns `{ file, skip }` entries and `DrawingInput.skip` carries the same reason union.
