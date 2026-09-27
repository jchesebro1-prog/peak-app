# Portal Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal customers search/browse the catalog (images + datasheets in a sidebar), configure fixtures, request curtain pricing, and generate their own quotes — firm (numbered, PDF, 30-day, acceptable) or Peak-review — with freight set by a distance rule that also becomes the Estimator's default.

**Architecture:** Pure rule modules (freight, visibility, search/facets, price rules, quote mode, accept guard) under `src/lib/` carry all logic and are spec-tested; thin server modules (`portal-catalog-index.ts`, `portal-pricing.ts`, `stores/portal-carts.ts`) load data and apply them; `/portal/catalog` pages + server actions are the UI. Portal quotes are ordinary `quotes` rows in the Estimator's `{ sections }` shape (`source: "portal-catalog"`), totalled by the Estimator's own `totals()`. Images are a third part-document kind on the #207 model.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Drizzle doc-store (JSONB doc tables), PGlite in tests, Vercel Blob (private), puppeteer-core + @sparticuz/chromium (existing, #222), pdfjs-dist (existing).

**Spec:** `docs/superpowers/specs/2026-09-27-portal-catalog-design.md` — §8 "Build-time adjustments" **overrides** earlier sections where they differ.

## Global Constraints

- Worktree: `/Users/sm/Downloads/peak-app/.claude/worktrees/portal-catalog`, branch `feat/portal-catalog`. Run `npm ci` once if `node_modules` is absent (never symlink it — Turbopack panics). Copy `.env.local` and `next-env.d.ts` from the main checkout if absent. Node: `export PATH="$HOME/.local/node/bin:$PATH"`.
- **Never open `.data/pglite`.** Tests use `npm run test:specs` (scratch `PGLITE_PATH`). Never run two DB processes at once; never leave a `tsx` running.
- **Never `git stash`** (shared across worktrees). Commit instead.
- Punch number **#245**; decisions start at **D396** — re-check both against `origin/main` right before writing docs (Task 14).
- Customers never receive cost, margin or tier name — any portal-bound type is sell-only.
- Every portal action/route takes `customerId` from `portalSession()` (actions) or `resolvePortalViewer()` (pages/routes) only.
- Prices are server-canonical: a client-sent price is never read.
- Standing customer line, verbatim: **"All quotes are subject to Peak review and approval."**
- Tax copy, verbatim: **"Plus applicable sales tax."**
- Card warning, verbatim: **"Don't enter card numbers — we'll call you to take payment."**
- Expired-grant copy, verbatim (existing): **"Your access link has expired — open the link we sent you again."**
- Freight defaults: base **2**%, step **200** mi, +**1**% per step, cap **10**%; unknown distance → cap.
- Firm validity default **30** days; browsable threshold **3** quotes in **24** months; stale-cost months default **0** (= off).
- Image content types: **image/png, image/jpeg, image/webp** only; image cap **10 MB**; never SVG.
- Test harness: one file `scripts/test-review-and-spec.ts`, helper `ok(cond, msg)`. Pure checks = a `{ … }` block appended at file end with hoisted imports aliased `d245…`; DB checks = `async function portal245XxxAsyncChecks()` added as a `.then(() => portal245XxxAsyncChecks())` line directly above the comment `  // Before the report and before the \`.catch\`, so a thrown suite is torn`. Messages prefixed `#245`. Use `fixtureId(245, "slug")` + `registerFixture(coll, id)` for any DB row a test creates.
- Migrations: next is **0032**; hand-harden generated SQL to be idempotent (copy `drizzle/0029_documents.sql`: `IF NOT EXISTS`, `CREATE OR REPLACE TRIGGER … bump_doc_seq()`).
- Gates per task (report real numbers): `npx tsc --noEmit`, `npm run test:specs` (report PASS/FAIL counts), `npx eslint <touched files>`. Tasks touching pages/components also run `npx next build` (a client component importing a store only breaks the build).
- Commit after each task: `git commit -m "<type>(portal): … (#245)"` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/freight-rule.ts` (new, pure) | `FreightRule`, `freightPctForMiles`, defaults |
| `src/lib/freight-rule-load.ts` (new, server) | read the four rate rows → `FreightRule` |
| `src/lib/portal-visibility.ts` (new, pure) | quotable / browsable / browseReason |
| `src/lib/portal-price-rules.ts` (new, pure) | unit tier price, POR reasons, fixture line pricing |
| `src/lib/portal-quote-mode.ts` (new, pure) | firm vs review, accept eligibility, card-number guard |
| `src/lib/portal-search.ts` (new, pure) | search + two-way facets + paging over slim entries |
| `src/lib/portal-catalog-index.ts` (new, server) | cached slim index (parts + doc facts + quote counts + fixtures) |
| `src/lib/portal-pricing.ts` (new, server-only) | tier resolution, freight, cart → priced sections/totals |
| `src/lib/stores/portal-carts.ts` (new) | `portal_carts` doc store |
| `src/lib/portal-quotes.ts` (new, server) | generate firm/review, refresh, copy-to-cart, accept, decline |
| `src/lib/part-docs/types.ts`, `files.ts`, `verify-upload.ts`, `views.ts` (modify) | image kind, sniff, cap, image slot |
| `src/lib/stores/part-documents.ts` (modify) | link `sort`/`hidden` setters |
| `src/lib/part-docs/thumbnail.ts` (new, server) | datasheet page-1 → PNG image document |
| `src/app/print/part-thumb/[id]/page.tsx` (new) | signed pdf.js render page for the thumbnail job |
| `src/app/portal/catalog/…` (new) | page, sidebar, cart, doc route, actions |
| `src/app/(app)/catalog/…` (modify) | visibility selector, image slots/column, thumbnail batch button |
| `src/app/(app)/estimator/…` (modify) | freight rule default, POR banner, acceptance panel |
| `src/lib/nav-counts.ts`, `stores/notif-prefs.ts` (modify) | two derived bell groups |
| removed | `src/app/portal/estimate/*`, `src/lib/portal-catalog.ts`, `submitPortalEstimate` |

---

### Task 1: Freight rule + Estimating Rules rows

**Files:**
- Create: `src/lib/freight-rule.ts`, `src/lib/freight-rule-load.ts`
- Modify: `src/lib/stores/pricing.ts` (new group in `GROUPS`, ~line 374+)
- Test: `scripts/test-review-and-spec.ts` (append pure block)

**Interfaces:**
- Produces: `type FreightRule = { basePct: number; stepMiles: number; stepPct: number; capPct: number }`; `DEFAULT_FREIGHT_RULE: FreightRule`; `freightPctForMiles(miles: number | null | undefined, rule: FreightRule): { pct: number; atCapUnknown: boolean }`; `loadFreightRule(): Promise<FreightRule>`; rate ids `FREIGHT_RATE_IDS = { base: "freight.basePct", stepMiles: "freight.stepMiles", stepPct: "freight.stepPct", cap: "freight.capPct" }`; portal rate ids `PORTAL_RATE_IDS = { validityDays: "portal.validityDays", browseMinQuotes: "portal.browseMinQuotes", browseWindowMonths: "portal.browseWindowMonths", staleCostMonths: "portal.staleCostMonths" }` exported from `freight-rule.ts`; `loadPortalRules(): Promise<{ validityDays: number; browseMinQuotes: number; browseWindowMonths: number; staleCostMonths: number }>` from `freight-rule-load.ts`.

- [ ] **Step 1: Write the failing test** — append to the end of `scripts/test-review-and-spec.ts`:

```ts
import { DEFAULT_FREIGHT_RULE as d245Rule, freightPctForMiles as d245Freight } from "@/lib/freight-rule";
{
  const f = (m: number | null) => d245Freight(m, d245Rule);
  ok(f(0).pct === 2 && !f(0).atCapUnknown, "#245 freight: 0 mi → 2%");
  ok(f(199).pct === 2, "#245 freight: 199 mi → 2%");
  ok(f(200).pct === 3, "#245 freight: 200 mi → 3% (step starts at 200)");
  ok(f(399).pct === 3 && f(400).pct === 4, "#245 freight: 399 → 3%, 400 → 4%");
  ok(f(1599).pct === 9 && f(1600).pct === 10, "#245 freight: 1,599 → 9%, 1,600 → 10% cap");
  ok(f(5000).pct === 10, "#245 freight: far venue stays at the 10% cap");
  ok(f(null).pct === 10 && f(null).atCapUnknown, "#245 freight: unknown distance → cap, flagged");
  ok(d245Freight(-5, d245Rule).atCapUnknown && d245Freight(NaN, d245Rule).pct === 10, "#245 freight: negative/NaN miles → unknown → cap");
  const custom = { basePct: 1, stepMiles: 100, stepPct: 0.5, capPct: 3 };
  ok(d245Freight(250, custom).pct === 2 && d245Freight(10000, custom).pct === 3, "#245 freight: custom rule honoured incl. cap");
  ok(d245Freight(100, { ...custom, stepMiles: 0 }).pct === 1, "#245 freight: a zero step never divides by zero — base only");
}
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:specs 2>&1 | tail -5` → fails to compile (module not found).

- [ ] **Step 3: Implement `src/lib/freight-rule.ts`**

```ts
/**
 * Freight by distance (#245, spec 2026-09-27-portal-catalog-design.md §2.2).
 * base % under the first step, + stepPct for every full stepMiles, capped.
 * Unknown distance charges the cap (err high) and says so. Pure.
 */
export type FreightRule = { basePct: number; stepMiles: number; stepPct: number; capPct: number };

export const DEFAULT_FREIGHT_RULE: FreightRule = { basePct: 2, stepMiles: 200, stepPct: 1, capPct: 10 };

export const FREIGHT_RATE_IDS = {
  base: "freight.basePct",
  stepMiles: "freight.stepMiles",
  stepPct: "freight.stepPct",
  cap: "freight.capPct",
} as const;

export const PORTAL_RATE_IDS = {
  validityDays: "portal.validityDays",
  browseMinQuotes: "portal.browseMinQuotes",
  browseWindowMonths: "portal.browseWindowMonths",
  staleCostMonths: "portal.staleCostMonths",
} as const;

export function freightPctForMiles(
  miles: number | null | undefined,
  rule: FreightRule
): { pct: number; atCapUnknown: boolean } {
  if (miles == null || !Number.isFinite(miles) || miles < 0) return { pct: rule.capPct, atCapUnknown: true };
  const steps = rule.stepMiles > 0 ? Math.floor(miles / rule.stepMiles) : 0;
  const pct = Math.min(rule.capPct, rule.basePct + steps * rule.stepPct);
  return { pct: Math.round(pct * 100) / 100, atCapUnknown: false };
}
```

- [ ] **Step 4: Add the Estimating Rules group** in `src/lib/stores/pricing.ts` `GROUPS` (after the `curtains` group), importing `DEFAULT_FREIGHT_RULE`, `FREIGHT_RATE_IDS`, `PORTAL_RATE_IDS` from `@/lib/freight-rule`:

```ts
{
  key: "portal",
  label: "Portal & freight",
  live: true,
  sub: "Freight by distance and customer self-quote rules",
  note: "Freight: base % under the first step, + step % for every full step of drive miles from the quoting office, never above the cap. Unknown distance charges the cap. The Estimator pre-fills new sections with it; the portal always applies it.",
  items: [
    rate(FREIGHT_RATE_IDS.base, "Freight — base", DEFAULT_FREIGHT_RULE.basePct, "%", { min: 0, max: 20, step: 0.5, help: "freight % for venues under the first step" }),
    rate(FREIGHT_RATE_IDS.stepMiles, "Freight — step distance", DEFAULT_FREIGHT_RULE.stepMiles, "mi", { min: 1, max: 2000, step: 10, help: "each full step of drive miles adds the step %" }),
    rate(FREIGHT_RATE_IDS.stepPct, "Freight — per step", DEFAULT_FREIGHT_RULE.stepPct, "%", { min: 0, max: 10, step: 0.5 }),
    rate(FREIGHT_RATE_IDS.cap, "Freight — cap", DEFAULT_FREIGHT_RULE.capPct, "%", { min: 0, max: 30, step: 0.5, help: "also charged when the venue's distance is unknown" }),
    rate(PORTAL_RATE_IDS.validityDays, "Portal firm quote valid for", 30, "days", { min: 1, max: 365, step: 1 }),
    rate(PORTAL_RATE_IDS.browseMinQuotes, "Browsable when quoted at least", 3, "quotes", { min: 1, max: 100, step: 1 }),
    rate(PORTAL_RATE_IDS.browseWindowMonths, "…within the last", 24, "months", { min: 1, max: 120, step: 1 }),
    rate(PORTAL_RATE_IDS.staleCostMonths, "Price on request when cost older than", 0, "months (0 = off)", { min: 0, max: 120, step: 1 }),
  ],
},
```

Check `rate()`'s `unit` param is free text (it is `unit?: string`); if the Estimating Rules UI renders `%` specially for `unit === "%"`, the other units render as plain suffixes — verify by opening `src/app/(app)/estimating-rules/` rendering of `unit`.

- [ ] **Step 5: Implement `src/lib/freight-rule-load.ts`**

```ts
import "server-only";
import { num } from "@/lib/stores/pricing";
import { DEFAULT_FREIGHT_RULE, FREIGHT_RATE_IDS, PORTAL_RATE_IDS, type FreightRule } from "@/lib/freight-rule";

export async function loadFreightRule(): Promise<FreightRule> {
  const [basePct, stepMiles, stepPct, capPct] = await Promise.all([
    num(FREIGHT_RATE_IDS.base, DEFAULT_FREIGHT_RULE.basePct),
    num(FREIGHT_RATE_IDS.stepMiles, DEFAULT_FREIGHT_RULE.stepMiles),
    num(FREIGHT_RATE_IDS.stepPct, DEFAULT_FREIGHT_RULE.stepPct),
    num(FREIGHT_RATE_IDS.cap, DEFAULT_FREIGHT_RULE.capPct),
  ]);
  return { basePct, stepMiles, stepPct, capPct };
}

export async function loadPortalRules() {
  const [validityDays, browseMinQuotes, browseWindowMonths, staleCostMonths] = await Promise.all([
    num(PORTAL_RATE_IDS.validityDays, 30),
    num(PORTAL_RATE_IDS.browseMinQuotes, 3),
    num(PORTAL_RATE_IDS.browseWindowMonths, 24),
    num(PORTAL_RATE_IDS.staleCostMonths, 0),
  ]);
  return { validityDays, browseMinQuotes, browseWindowMonths, staleCostMonths };
}
```

If `server-only` is not a dependency (check `package.json`), omit that import line — match how other server-only libs in `src/lib/` mark themselves (e.g. `src/lib/curtain-pricing.ts`).

- [ ] **Step 6: Add a DB check** that the rows resolve to defaults: an async function `portal245RulesAsyncChecks` asserting `(await loadFreightRule())` deep-equals `DEFAULT_FREIGHT_RULE` and `(await loadPortalRules()).validityDays === 30`; register it in the chain.

- [ ] **Step 7: Run gates, then commit** — `feat(portal): freight-by-distance rule + Portal & freight Estimating Rules (#245)`.

---

### Task 2: Estimator adopts the freight rule for new sections

**Files:**
- Modify: `src/app/(app)/estimator/types.ts` (`SpecSection` +`freightAuto?: boolean`), `estimator-client.tsx` (`freshSections` ~109, `addSystem` ~1252, `setFreightPct` ~1181, venue-change effect near `locationId` state ~466 and `travelSeen` ~661), `section-card.tsx` (~429-452 flag), `estimator/page.tsx` (pass `freightRule`)
- Create: `src/app/(app)/estimator/freight-default.ts` (pure)
- Test: append pure block

**Interfaces:**
- Consumes: `freightPctForMiles`, `FreightRule` (Task 1); `TravelLite = { miles; minutes; officeName }` (`types.ts:321`); `travelForSelectionAction(customerId, locationId)` (`estimator/actions.ts:1215`).
- Produces: `sectionFreightDefault(input: { hasVenue: boolean; miles: number | null | undefined; rule: FreightRule }): { pct: number; unknown: boolean }` and `applyAutoFreight(sections: SpecSection[], d: { pct: number }): SpecSection[]` (only rewrites sections with `freightAuto === true`).

- [ ] **Step 1: Failing test**

```ts
import { sectionFreightDefault as d245SecFr, applyAutoFreight as d245ApplyFr } from "@/app/(app)/estimator/freight-default";
{
  const rule = { basePct: 2, stepMiles: 200, stepPct: 1, capPct: 10 };
  ok(d245SecFr({ hasVenue: false, miles: null, rule }).pct === 2 && !d245SecFr({ hasVenue: false, miles: null, rule }).unknown, "#245 estimator: no venue yet → base %, not flagged");
  ok(d245SecFr({ hasVenue: true, miles: 450, rule }).pct === 4, "#245 estimator: venue at 450 mi → 4%");
  const u = d245SecFr({ hasVenue: true, miles: null, rule });
  ok(u.pct === 10 && u.unknown, "#245 estimator: venue not located → cap + flag");
  const secs = [
    { id: "a", name: "A", kind: "materials", mfr: "", freightPct: 2, freightAuto: true, items: [] },
    { id: "b", name: "B", kind: "materials", mfr: "", freightPct: 7, freightAuto: false, items: [] },
    { id: "c", name: "C", kind: "materials", mfr: "", freightPct: 5, items: [] },
  ];
  const out = d245ApplyFr(secs as never, { pct: 4 });
  ok(out[0].freightPct === 4 && out[1].freightPct === 7 && out[2].freightPct === 5, "#245 estimator: venue change re-applies only to untouched (auto) sections; saved quotes without the flag never change");
}
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement `freight-default.ts`**

```ts
import { freightPctForMiles, type FreightRule } from "@/lib/freight-rule";
import type { SpecSection } from "./types";

/** New-section freight (#245): base until a venue is picked; then the distance rule. */
export function sectionFreightDefault(input: { hasVenue: boolean; miles: number | null | undefined; rule: FreightRule }): { pct: number; unknown: boolean } {
  if (!input.hasVenue) return { pct: input.rule.basePct, unknown: false };
  const r = freightPctForMiles(input.miles, input.rule);
  return { pct: r.pct, unknown: r.atCapUnknown };
}

/** Re-apply the rule to sections staff never touched (`freightAuto`). */
export function applyAutoFreight(sections: SpecSection[], d: { pct: number }): SpecSection[] {
  return sections.map((s) => (s.freightAuto ? { ...s, freightPct: d.pct } : s));
}
```

- [ ] **Step 4: Wire the client.**
  - `types.ts` `SpecSection`: add `/** #245: freight was set by the distance rule and staff haven't touched it. */ freightAuto?: boolean;`
  - `page.tsx`: `const freightRule = await loadFreightRule();` pass `freightRule` prop to the client (it is plain numbers — client-safe).
  - Client: compute `const fd = sectionFreightDefault({ hasVenue: !!locationId, miles: travelEstNow()?.miles ?? null, rule: freightRule })` — `travelEstNow()` (~671) already returns the cached `TravelLite` for the current selection; when the selection's travel is not yet fetched treat as "still loading" and don't apply (see effect below).
  - `freshSections()` and `addSystem()`: replace `freightPct: 2` with `freightPct: fd.pct, freightAuto: true`.
  - `setFreightPct` (~1181): also set `freightAuto: false` on the edited section.
  - Add an effect keyed on `[customerId, locationId, travel-loaded-for-selection]`: once the selection's travel entry exists in `travelSeen` (value may be `null` = unknown), `setSections((ss) => applyAutoFreight(ss, fd))`. Ensure the effect runs once per selection change, not per render.
  - `section-card.tsx`: accept `freightUnknown?: boolean`; when `sec.freightAuto && freightUnknown`, render under the slider `<span className="pk-hint">Freight at max — venue not located</span>` (use an existing hint/warn class used nearby in the file).
  - Saved quotes load with whatever `freightAuto` they stored; old quotes have none → never rewritten.
- [ ] **Step 5: Gates incl. `npx next build`; commit** — `feat(estimator): new sections default freight from the distance rule (#245)`.

---

### Task 3: Images as a part-document kind (data + validation)

**Files:**
- Modify: `src/lib/part-docs/types.ts`, `src/lib/part-docs/files.ts`, `src/lib/part-docs/verify-upload.ts`, `src/app/api/part-documents/upload/route.ts`, `src/lib/stores/part-documents.ts`, `src/lib/part-docs/coverage.ts` (exclude images), `src/lib/part-docs/filename-match.ts` (`guessKind`)
- Test: append pure block + `portal245ImageLinksAsyncChecks`

**Interfaces:**
- Produces:
  - `PartDocKind = "datasheet" | "specsheet" | "image"`; `PART_DOC_KINDS` stays `["datasheet","specsheet"]` **renamed semantics**: add `DOC_SLOT_KINDS = ["datasheet","specsheet"] as const` (coverage kinds) and `ALL_PART_DOC_KINDS = ["datasheet","specsheet","image"] as const`; keep `PART_DOC_KINDS` as an alias of `DOC_SLOT_KINDS` so existing call sites keep today's two slots; `PART_DOC_KIND_LABEL.image = "Image"`; `isPartDocKind` accepts `"image"`.
  - `PartDocumentSource` adds `"datasheet-render"`.
  - `PartDocumentLink` adds `sort?: number; hidden?: boolean`.
  - `MAX_PART_IMAGE_BYTES = 10 * 1024 * 1024`; `maxBytesFor(kind: PartDocKind): number`.
  - `sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null`.
  - `setDocumentLinkDisplay(documentId: string, partSku: string, patch: { sort?: number; hidden?: boolean }): Promise<boolean>` in `stores/part-documents.ts`.
  - `visibleImagesForParts(skus: readonly string[]): Promise<Map<string, PartDocument[]>>` — non-hidden image links, ordered by source rank (`upload`=0, `fetch`=1, `davinci`=2, `datasheet-render`=3, `legacy`=4) then `sort` (missing = +∞) then `uploadedAt`.

- [ ] **Step 1: Failing tests**

```ts
import { sniffImageType as d245Sniff } from "@/lib/part-docs/files";
import { isPartDocKind as d245IsKind, maxBytesFor as d245Max, PART_DOC_KINDS as d245Kinds } from "@/lib/part-docs/types";
{
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const svg = new TextEncoder().encode("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  const pdf = new TextEncoder().encode("%PDF-1.7");
  ok(d245Sniff(png) === "image/png" && d245Sniff(jpg) === "image/jpeg" && d245Sniff(webp) === "image/webp", "#245 images: PNG/JPEG/WebP magic bytes recognised");
  ok(d245Sniff(svg) === null && d245Sniff(pdf) === null, "#245 images: SVG and PDF are never images");
  ok(d245IsKind("image") && !d245IsKind("photo"), "#245 images: image is a part-document kind");
  ok(d245Max("image") === 10 * 1024 * 1024 && d245Max("datasheet") === 25 * 1024 * 1024, "#245 images: 10 MB image cap, datasheets keep 25 MB");
  ok(!(d245Kinds as readonly string[]).includes("image"), "#245 images: coverage slots stay datasheet + spec sheet");
}
```

DB check `portal245ImageLinksAsyncChecks`: create two image docs (`source: "upload"` and `"datasheet-render"`) + one datasheet via `createDocument`, `attachDocument` all to `fixtureId(245,"sku-img")`, set `setDocumentLinkDisplay(renderDoc, sku, { hidden: true })`, assert `visibleImagesForParts([sku])` returns only the upload image; unhide → returns `[upload, render]` in that order; assert a datasheet never appears in the image map. Register fixtures for `part_documents`/`part_document_links` (use the collection names in `DOC_TABLES`).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.**
  - `types.ts` as in Interfaces. `maxBytesFor = (k) => (k === "image" ? MAX_PART_IMAGE_BYTES : MAX_PART_DOC_BYTES)`.
  - `files.ts`: add to `CONTENT_TYPES` the three image types; `ALLOWED_TYPES.image = ["png","jpeg","webp"]` (match the key style already used — they are short type keys); `sniffImageType`:

```ts
export function sniffImageType(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
```

  `checkDocumentBytes(kind, bytes)`: for `kind === "image"` accept iff `sniffImageType(bytes) !== null`, else existing behavior.
  - `verify-upload.ts`: use `maxBytesFor(kind)` instead of the flat cap.
  - Upload broker route: allow the image content types in `allowedContentTypes`; keep `maximumSizeInBytes: MAX_PART_DOC_BYTES` (the verify step enforces the tighter image cap and deletes on refusal).
  - `coverage.ts`: `buildCoverageIndex` ignores documents/links whose `kind === "image"` (images never cover or satisfy a slot). Add a guard at index build.
  - `filename-match.ts` `guessKind`: `/\.(png|jpe?g|webp)$/i` → `"image"`.
  - `stores/part-documents.ts`: `setDocumentLinkDisplay` via `patchDoc` on the link id `documentLinkId(partSku, documentId)`; `visibleImagesForParts` via `documentLinksForParts(skus)` filtered to `kind === "image" && !hidden && !deleted`, then `getDocuments(ids)`, sorted as specified.
- [ ] **Step 4: Gates; commit** — `feat(part-docs): images are a third document kind — PNG/JPEG/WebP, 10 MB, gallery order + hide (#245)`.

---

### Task 4: Images in the staff UI (part editor, Datasheets page, Upload many, from URL)

**Files:**
- Modify: `src/lib/part-docs/views.ts` (`DocumentRow` + `image: ImageSlotView`, `partDocsView` images list), `src/app/(app)/catalog/documents/documents-client.tsx` (column + filter), `slot-cell.tsx` (image variant or new `image-cell.tsx`), `src/app/(app)/catalog/documents/actions.ts` (`setImageDisplayAction`, `addImageFromUrlAction`), `src/app/(app)/catalog/part-documents-section.tsx` (Images gallery), `src/app/(app)/catalog/documents/upload/bulk-drop.tsx` (accept images)
- Create: `src/app/(app)/catalog/documents/image-cell.tsx`
- Test: append pure block for view building

**Interfaces:**
- Consumes: Task 3 exports.
- Produces: `type ImageSlotView = { count: number; first: { id: string; title: string } | null }`; `DocumentRow.image: ImageSlotView`; `PartDocsView.images: Array<{ id: string; title: string; source: PartDocumentSource; hidden: boolean; sort: number | null }>`; server actions `setImageDisplayAction(input: { documentId: string; sku: string; sort?: number; hidden?: boolean }): Promise<DocActionResult<null>>` and `addImageFromUrlAction(input: { sku: string; url: string }): Promise<DocActionResult<{ documentId: string }>>`.

- [ ] **Step 1: Failing test** — build a `DocumentRow` for a SKU with one visible and one hidden image via the pure view builder and assert `row.image.count === 2` (staff see all) and `partDocsView(...).images` carries `hidden` flags in gallery order. (Construct inputs the same way existing `views.ts` tests do — grep `partDocsView(` in the harness for a template.)
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
  - Datasheets page: add a third column header **"Image"** (headers at `documents-client.tsx:196-197` are hard-coded — add one), cell = `ImageCell` (thumbnail of the first image via the team route `/api/part-documents/<id>`, count badge, a drop zone reusing the same direct-upload client `upload-client.ts` with `kind: "image"`). Add a filter chip **"Missing image"** next to the existing filters (it filters rows where `image.count === 0`).
  - Part editor Documents section: an **Images** block under the slots — thumbnails in gallery order, each with ↑/↓ (calls `setImageDisplayAction` with new `sort` values `0..n-1`), a **Hide from customers / Show** toggle (`hidden`), a source label (Upload · From URL · Datasheet thumbnail), plus the drop zone and an **Add image from URL** input.
  - `addImageFromUrlAction`: `requireUser()`; reuse `guardedFetchBytes` (see `src/lib/part-docs/fetch-links.ts` for the call shape), check `sniffImageType`, size ≤ `MAX_PART_IMAGE_BYTES`, upload to Blob at `partDocBlobPath(id, fileName)` the way `fetchSlot` stores a fetched file, `createDocument({ kind: "image", source: "fetch", sourceUrl: url, … })`, `attachDocument(id, [sku], by)`.
  - Upload many: accept `.png,.jpg,.jpeg,.webp` in the file input `accept`; `guessKind` already routes them to `image`.
  - Team route `/api/part-documents/[id]` already serves any kind; confirm it sets the right content type for images (it uses the stored `contentType`).
- [ ] **Step 4: Gates incl. `next build`; commit** — `feat(catalog): image slots — Datasheets column + missing filter, part-editor gallery, upload many, add from URL (#245)`.

---

### Task 5: Customer visibility (pure rule + part-editor selector)

**Files:**
- Create: `src/lib/portal-visibility.ts`
- Modify: `src/lib/stores/catalog.ts` (`CatalogPart.portalVisibility?: "auto" | "show" | "hide"`), `src/app/(app)/catalog/part-form.ts` (`optionalPartFields` reads `portalVisibility`), `src/app/(app)/catalog/page.tsx` (`PartFormModal` ~687: a select + reason line)
- Test: append pure block

**Interfaces:**
- Produces:

```ts
export type PortalVisibility = "auto" | "show" | "hide";
export type VisibilityFacts = { visibility: PortalVisibility; hasVisibleImage: boolean; hasDatasheet: boolean; quoteCount: number };
export type BrowseRule = { minQuotes: number };
export function normalizeVisibility(v: unknown): PortalVisibility;
export function quotable(f: Pick<VisibilityFacts, "visibility">): boolean;
export function browsable(f: VisibilityFacts, rule: BrowseRule): boolean;
export function browseReason(f: VisibilityFacts, rule: BrowseRule): string;
```

- [ ] **Step 1: Failing test**

```ts
import { browsable as d245Browsable, browseReason as d245Reason, quotable as d245Quotable, normalizeVisibility as d245NormVis } from "@/lib/portal-visibility";
{
  const rule = { minQuotes: 3 };
  const base = { visibility: "auto" as const, hasVisibleImage: false, hasDatasheet: false, quoteCount: 0 };
  ok(d245Quotable(base) && d245Quotable({ visibility: "show" }) && !d245Quotable({ visibility: "hide" }), "#245 visibility: everything but Hide is quotable");
  ok(!d245Browsable(base, rule), "#245 visibility: auto with no image/datasheet/quotes is search-only");
  ok(d245Browsable({ ...base, hasVisibleImage: true }, rule) && d245Browsable({ ...base, hasDatasheet: true }, rule), "#245 visibility: image or datasheet makes it browsable");
  ok(!d245Browsable({ ...base, quoteCount: 2 }, rule) && d245Browsable({ ...base, quoteCount: 3 }, rule), "#245 visibility: 3+ recent quotes makes it browsable");
  ok(d245Browsable({ ...base, visibility: "show" }, rule) && !d245Browsable({ ...base, visibility: "hide", hasVisibleImage: true }, rule), "#245 visibility: overrides win both ways");
  ok(d245Reason({ ...base, hasVisibleImage: true }, rule) === "Browsable: has image", "#245 visibility: reason names the first matching fact");
  ok(d245Reason({ ...base, quoteCount: 5 }, rule) === "Browsable: quoted 5 times recently", "#245 visibility: quote-count reason");
  ok(d245Reason({ ...base, visibility: "hide" }, rule) === "Hidden from customers", "#245 visibility: hide reason");
  ok(d245Reason(base, rule) === "Search only — no image, datasheet, or recent quotes", "#245 visibility: search-only reason");
  ok(d245NormVis("bogus") === "auto" && d245NormVis(undefined) === "auto" && d245NormVis("hide") === "hide", "#245 visibility: unknown values read as auto");
}
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement**

```ts
/** Customer visibility of a catalog part (#245, spec §1.3). Pure. */
export type PortalVisibility = "auto" | "show" | "hide";
export type VisibilityFacts = { visibility: PortalVisibility; hasVisibleImage: boolean; hasDatasheet: boolean; quoteCount: number };
export type BrowseRule = { minQuotes: number };

export function normalizeVisibility(v: unknown): PortalVisibility {
  return v === "show" || v === "hide" ? v : "auto";
}
export function quotable(f: Pick<VisibilityFacts, "visibility">): boolean {
  return f.visibility !== "hide";
}
export function browsable(f: VisibilityFacts, rule: BrowseRule): boolean {
  if (f.visibility === "show") return true;
  if (f.visibility === "hide") return false;
  return f.hasVisibleImage || f.hasDatasheet || f.quoteCount >= rule.minQuotes;
}
export function browseReason(f: VisibilityFacts, rule: BrowseRule): string {
  if (f.visibility === "hide") return "Hidden from customers";
  if (f.visibility === "show") return "Shown by override";
  if (f.hasVisibleImage) return "Browsable: has image";
  if (f.hasDatasheet) return "Browsable: has datasheet";
  if (f.quoteCount >= rule.minQuotes) return `Browsable: quoted ${f.quoteCount} times recently`;
  return "Search only — no image, datasheet, or recent quotes";
}
```

- [ ] **Step 4: Editor.** `part-form.ts` `OptionalPartFields` gains `portalVisibility?: "show" | "hide" | undefined` — `if (fd.has("portalVisibility")) { const v = normalizeVisibility(fd.get("portalVisibility")); out.portalVisibility = v === "auto" ? undefined : v; }` (auto is stored as absent; an explicit undefined clears through `mergeUpsert`). In `PartFormModal`, a labeled `<select name="portalVisibility">` (Auto · Show · Hide) under the Documents section, and beneath it the reason line. The page computes the reason server-side for the edited SKU using the Task 7 index helper `portalFactsForSku(sku)` — until Task 7 lands, compute with `hasVisibleImage`/`hasDatasheet` from the already-loaded `partDocs` view and `quoteCount: 0`, then switch to `portalFactsForSku` in Task 7 Step 5.
- [ ] **Step 5: Gates incl. `next build`; commit** — `feat(catalog): customer visibility Auto/Show/Hide with a browse reason (#245)`.

---

### Task 6: Pure price rules, quote mode, accept guard, search

**Files:**
- Create: `src/lib/portal-price-rules.ts`, `src/lib/portal-quote-mode.ts`, `src/lib/portal-search.ts`
- Test: append pure blocks

**Interfaces (produces):**

```ts
// portal-price-rules.ts
export type PriceInput = { cost: number | null | undefined; list: number | null | undefined; note?: string | null; pricedAt?: number | null };
export type PriceRuleOpts = { margin: number; staleCostMonths: number; now: number };
export type UnitPrice = { unitPrice: number | null; por: boolean; porReason?: "no-price" | "verify-price" | "stale-cost" };
export function unitPriceFor(p: PriceInput, o: PriceRuleOpts): UnitPrice;
export type FixtureComponentInput = PriceInput & { sku: string; qty: number; quotable: boolean; required: boolean };
export function fixtureUnitPrice(components: FixtureComponentInput[], o: PriceRuleOpts): { unitPrice: number | null; por: boolean; unavailable: boolean; cost: number };

// portal-quote-mode.ts
export type ModeLine = { por: boolean };
export function quoteMode(lines: readonly ModeLine[]): { mode: "firm" | "review"; porCount: number; reason: string | null };
export function firmValidUntil(generatedAt: number, validityDays: number): number;
export function canAcceptPortal(q: { status: string; portalAcceptance?: unknown; portalFirm?: { validUntil: number } | null }, now: number): { ok: boolean; reason?: "not-sent" | "accepted" | "expired" };
export function looksLikeCardNumber(text: string): boolean;
export const PURCHASE_METHODS: readonly ["po", "card", "check", "other"];
export const PURCHASE_METHOD_LABEL: Record<(typeof PURCHASE_METHODS)[number], string>;

// portal-search.ts
export type SearchEntry = { key: string; kind: "part" | "fixture"; title: string; sku: string; mfr: string; category: string; haystack: string; browsable: boolean; rank: number };
export type SearchQuery = { q: string; mfr: string[]; cat: string[]; page: number; pageSize: number };
export type Facet = { value: string; count: number; selected: boolean };
export type SearchResult = { entries: SearchEntry[]; total: number; page: number; pages: number; mfrFacets: Facet[]; catFacets: Facet[] };
export function buildHaystack(parts: readonly (string | null | undefined)[]): string;
export function searchCatalog(all: readonly SearchEntry[], query: SearchQuery): SearchResult;
```

- [ ] **Step 1: Failing tests**

```ts
import { unitPriceFor as d245Unit, fixtureUnitPrice as d245FixPrice } from "@/lib/portal-price-rules";
import { quoteMode as d245Mode, canAcceptPortal as d245CanAccept, firmValidUntil as d245Valid, looksLikeCardNumber as d245Card } from "@/lib/portal-quote-mode";
import { searchCatalog as d245Search, buildHaystack as d245Hay, type SearchEntry as D242Entry } from "@/lib/portal-search";
{
  const now = Date.UTC(2026, 8, 27);
  const o = { margin: 0.3, staleCostMonths: 0, now };
  ok(d245Unit({ cost: 70, list: 200 }, o).unitPrice === 100, "#245 price: cost ÷ (1 − margin)");
  ok(d245Unit({ cost: 0, list: 80 }, o).unitPrice === 80 && d245Unit({ cost: null, list: 80 }, o).unitPrice === 80, "#245 price: no cost → list");
  const np = d245Unit({ cost: 0, list: 0 }, o);
  ok(np.por && np.porReason === "no-price" && np.unitPrice === null, "#245 price: no cost and no list → price on request");
  ok(d245Unit({ cost: 10, list: 20, note: "verify price" }, o).porReason === "verify-price", "#245 price: a note means verify price → POR");
  const old = now - 400 * 86400000;
  ok(!d245Unit({ cost: 10, list: 20, pricedAt: old }, o).por, "#245 price: stale-cost rule off by default");
  ok(d245Unit({ cost: 10, list: 20, pricedAt: old }, { ...o, staleCostMonths: 12 }).porReason === "stale-cost", "#245 price: stale cost → POR when the setting is on");
  ok(!d245Unit({ cost: 10, list: 20, pricedAt: null }, { ...o, staleCostMonths: 12 }).por, "#245 price: unknown priced date is not stale");
  ok(d245Unit({ cost: 33.33, list: 0 }, o).unitPrice === 47.61, "#245 price: rounded to cents");

  const comp = (sku: string, cost: number, qty = 1, extra = {}) => ({ sku, cost, list: 0, qty, quotable: true, required: true, ...extra });
  const fx = d245FixPrice([comp("LE", 700), comp("LENS", 70, 2)], o);
  ok(fx.unitPrice === 1200 && !fx.por && fx.cost === 840, "#245 fixture: sum of component tier prices × qty; cost carried");
  ok(d245FixPrice([comp("LE", 700), comp("X", 0, 1, { list: 0 })], o).por, "#245 fixture: a POR component makes the fixture POR");
  ok(d245FixPrice([comp("LE", 700), comp("H", 5, 1, { quotable: false })], o).unavailable, "#245 fixture: a hidden required component makes it unavailable");
  ok(!d245FixPrice([comp("LE", 700), comp("H", 5, 1, { quotable: false, required: false })], o).unavailable, "#245 fixture: a hidden optional add-on doesn't block the fixture");

  ok(d245Mode([{ por: false }, { por: false }]).mode === "firm", "#245 mode: all priced → firm");
  const rv = d245Mode([{ por: false }, { por: true }, { por: true }]);
  ok(rv.mode === "review" && rv.porCount === 2 && rv.reason === "2 lines are price on request", "#245 mode: any POR → review with reason");
  ok(d245Mode([{ por: true }]).reason === "1 line is price on request", "#245 mode: singular reason");
  ok(d245Valid(now, 30) === now + 30 * 86400000, "#245 validity: 30 days");
  ok(d245CanAccept({ status: "sent", portalFirm: { validUntil: now + 1 } }, now).ok, "#245 accept: sent + in date → ok");
  ok(d245CanAccept({ status: "sent", portalFirm: { validUntil: now - 1 } }, now).reason === "expired", "#245 accept: expired firm quote refused");
  ok(d245CanAccept({ status: "sent" }, now).ok, "#245 accept: staff-sent (no portalFirm) never expires here");
  ok(d245CanAccept({ status: "draft" }, now).reason === "not-sent" && d245CanAccept({ status: "sent", portalAcceptance: { at: 1 } }, now).reason === "accepted", "#245 accept: draft / already accepted refused");
  ok(d245Card("PO 44812, card 4111 1111 1111 1111 please") && d245Card("4242424242424242"), "#245 card guard: Luhn-valid 13–19 digit runs caught, with spaces");
  ok(!d245Card("PO 1234567890123") && !d245Card("call 608-555-0199"), "#245 card guard: PO numbers / phones that fail Luhn pass");

  const e = (key: string, mfr: string, category: string, browsable = true, title = key): D242Entry => ({ key, kind: "part", title, sku: key, mfr, category, haystack: d245Hay([key, title, mfr, category]), browsable, rank: 0 });
  const all = [e("A1", "ETC", "Fixtures"), e("A2", "ETC", "Cable"), e("B1", "Rose Brand", "Track", false), e("B2", "Rose Brand", "Fixtures", true, "Source Four Clamp")];
  const r0 = d245Search(all, { q: "", mfr: [], cat: [], page: 1, pageSize: 48 });
  ok(r0.total === 3 && !r0.entries.some((x) => x.key === "B1"), "#245 search: empty query lists browsable only");
  ok(d245Search(all, { q: "b1", mfr: [], cat: [], page: 1, pageSize: 48 }).total === 1, "#245 search: a query finds search-only parts too");
  const r1 = d245Search(all, { q: "", mfr: ["ETC"], cat: [], page: 1, pageSize: 48 });
  ok(r1.total === 2 && r1.catFacets.find((f) => f.value === "Fixtures")?.count === 1 && !r1.catFacets.some((f) => f.value === "Track"), "#245 search: picking a manufacturer narrows category facets");
  ok(r1.mfrFacets.find((f) => f.value === "Rose Brand")?.count === 1 && r1.mfrFacets.find((f) => f.value === "ETC")?.selected === true, "#245 search: manufacturer facet counts ignore its own selection (either order works)");
  const r2 = d245Search(all, { q: "source clamp", mfr: [], cat: [], page: 1, pageSize: 48 });
  ok(r2.total === 1 && r2.entries[0].key === "B2", "#245 search: every token must match (AND)");
  const many = Array.from({ length: 100 }, (_, i) => e("P" + i, "ETC", "Cable"));
  const p3 = d245Search(many, { q: "", mfr: [], cat: [], page: 3, pageSize: 48 });
  ok(p3.pages === 3 && p3.entries.length === 4 && p3.page === 3, "#245 search: 48 per page, last page partial");
  ok(d245Search(many, { q: "", mfr: [], cat: [], page: 99, pageSize: 48 }).page === 3, "#245 search: page clamps to the last page");
}
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement `portal-price-rules.ts`**

```ts
/** Portal unit pricing rules (#245, spec §2.1). Pure; sell-only outputs. */
export type PriceInput = { cost: number | null | undefined; list: number | null | undefined; note?: string | null; pricedAt?: number | null };
export type PriceRuleOpts = { margin: number; staleCostMonths: number; now: number };
export type UnitPrice = { unitPrice: number | null; por: boolean; porReason?: "no-price" | "verify-price" | "stale-cost" };

const cents = (n: number) => Math.round(n * 100) / 100;
const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
const MONTH_MS = 30.4375 * 86400000;

export function unitPriceFor(p: PriceInput, o: PriceRuleOpts): UnitPrice {
  const cost = pos(p.cost);
  const list = pos(p.list);
  if (!cost && !list) return { unitPrice: null, por: true, porReason: "no-price" };
  if ((p.note || "").trim()) return { unitPrice: null, por: true, porReason: "verify-price" };
  if (o.staleCostMonths > 0 && typeof p.pricedAt === "number" && o.now - p.pricedAt > o.staleCostMonths * MONTH_MS)
    return { unitPrice: null, por: true, porReason: "stale-cost" };
  const m = o.margin > 0 && o.margin < 1 ? o.margin : 0;
  return { unitPrice: cost ? cents(cost / (1 - m)) : cents(list), por: false };
}

export type FixtureComponentInput = PriceInput & { sku: string; qty: number; quotable: boolean; required: boolean };

export function fixtureUnitPrice(components: FixtureComponentInput[], o: PriceRuleOpts): { unitPrice: number | null; por: boolean; unavailable: boolean; cost: number } {
  let total = 0, cost = 0, por = false, unavailable = false;
  for (const c of components) {
    if (c.qty <= 0) continue;
    if (!c.quotable) { if (c.required) unavailable = true; continue; }
    const u = unitPriceFor(c, o);
    if (u.por || u.unitPrice == null) { por = true; continue; }
    total += u.unitPrice * c.qty;
    cost += pos(c.cost) * c.qty;
  }
  return { unitPrice: por || unavailable ? null : cents(total), por, unavailable, cost: cents(cost) };
}
```

- [ ] **Step 4: Implement `portal-quote-mode.ts`**

```ts
/** Firm vs review, validity, accept eligibility, card guard (#245, spec §2.3/§4). Pure. */
export type ModeLine = { por: boolean };
export function quoteMode(lines: readonly ModeLine[]): { mode: "firm" | "review"; porCount: number; reason: string | null } {
  const porCount = lines.filter((l) => l.por).length;
  if (!porCount) return { mode: "firm", porCount, reason: null };
  return { mode: "review", porCount, reason: `${porCount} ${porCount === 1 ? "line is" : "lines are"} price on request` };
}
export function firmValidUntil(generatedAt: number, validityDays: number): number {
  return generatedAt + Math.max(1, Math.round(validityDays)) * 86400000;
}
export function canAcceptPortal(
  q: { status: string; portalAcceptance?: unknown; portalFirm?: { validUntil: number } | null },
  now: number
): { ok: boolean; reason?: "not-sent" | "accepted" | "expired" } {
  if (q.status !== "sent") return { ok: false, reason: "not-sent" };
  if (q.portalAcceptance) return { ok: false, reason: "accepted" };
  if (q.portalFirm && now > q.portalFirm.validUntil) return { ok: false, reason: "expired" };
  return { ok: true };
}
function luhn(d: string): boolean {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
/** A 13–19 digit run (spaces/dashes allowed between digits) that passes Luhn. */
export function looksLikeCardNumber(text: string): boolean {
  for (const m of text.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}
export const PURCHASE_METHODS = ["po", "card", "check", "other"] as const;
export const PURCHASE_METHOD_LABEL: Record<(typeof PURCHASE_METHODS)[number], string> = { po: "Purchase order", card: "Credit card", check: "Check", other: "Other" };
```

Verify in the test that `"PO 1234567890123"` fails Luhn (it does: compute once; if it passes, change the fixture to a 13-digit number that fails and note it).

- [ ] **Step 5: Implement `portal-search.ts`**

```ts
/** Portal catalog search + two-way facets + paging (#245, spec §3.1). Pure. */
export type SearchEntry = { key: string; kind: "part" | "fixture"; title: string; sku: string; mfr: string; category: string; haystack: string; browsable: boolean; rank: number };
export type SearchQuery = { q: string; mfr: string[]; cat: string[]; page: number; pageSize: number };
export type Facet = { value: string; count: number; selected: boolean };
export type SearchResult = { entries: SearchEntry[]; total: number; page: number; pages: number; mfrFacets: Facet[]; catFacets: Facet[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function buildHaystack(parts: readonly (string | null | undefined)[]): string {
  const joined = parts.filter(Boolean).join(" ");
  return " " + norm(joined) + " " + joined.toLowerCase().replace(/[^a-z0-9]/g, "") + " ";
}
function facets(rows: readonly SearchEntry[], field: "mfr" | "category", selected: readonly string[]): Facet[] {
  const counts = new Map<string, number>();
  for (const r of rows) { const v = r[field] || "—"; counts.set(v, (counts.get(v) || 0) + 1); }
  for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
  return [...counts].map(([value, count]) => ({ value, count, selected: selected.includes(value) }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.value.localeCompare(b.value));
}
export function searchCatalog(all: readonly SearchEntry[], query: SearchQuery): SearchResult {
  const tokens = norm(query.q).split(" ").filter(Boolean);
  const base = all.filter((e) => (tokens.length ? tokens.every((t) => e.haystack.includes(t)) : e.browsable));
  const inMfr = (e: SearchEntry) => !query.mfr.length || query.mfr.includes(e.mfr || "—");
  const inCat = (e: SearchEntry) => !query.cat.length || query.cat.includes(e.category || "—");
  const hits = base.filter((e) => inMfr(e) && inCat(e));
  const mfrFacets = facets(base.filter(inCat), "mfr", query.mfr);
  const catFacets = facets(base.filter(inMfr), "category", query.cat);
  const sorted = [...hits].sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title));
  const pageSize = Math.max(1, query.pageSize);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page) || 1), pages);
  return { entries: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pages, mfrFacets, catFacets };
}
```

- [ ] **Step 6: Gates; commit** — `feat(portal): pure price rules, quote mode, accept/card guards, catalog search (#245)`.

---

### Task 7: Server catalog index + portal pricing

**Files:**
- Create: `src/lib/portal-catalog-index.ts`, `src/lib/portal-pricing.ts`
- Modify: `src/app/(app)/catalog/page.tsx` (switch the Task 5 reason to `portalFactsForSku`)
- Test: `portal245IndexAsyncChecks`

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6; `list()` (catalog), `loadPartDocsState(parts)` (`part-docs/load.ts`) → `.index` (`CoverageIndex` with `childrenOf`, `parentsOf`), `slotCoverage`/`slotSatisfied`, `visibleImagesForParts`, `listFixtures()`, `resolveFixture`, quotes `getAll()`, `resolveTier(companyId, contactName)`, `travelForId(customerId, locId)`.
- Produces:

```ts
// portal-catalog-index.ts (server)
export type IndexedPart = { sku: string; desc: string; mfr: string; category: string; unit: string; mpn: string; model: string;
  cost: number; list: number; note: string; pricedAt: number | null; visibility: PortalVisibility;
  imageIds: string[]; datasheetIds: string[]; specText: string | null; accessories: string[]; quoteCount: number };
export type IndexedFixture = { id: string; label: string; description: string; lightEngineSku: string; lensSku: string | null;
  lines: Array<{ slot: string; sku: string; label: string; qty: number; required: boolean }> };
export type PortalIndex = { parts: Map<string, IndexedPart>; fixtures: Map<string, IndexedFixture>; entries: SearchEntry[]; builtAt: number };
export async function portalIndex(opts?: { fresh?: boolean }): Promise<PortalIndex>;   // cached 5 min per process
export function invalidatePortalIndex(): void;
export async function portalFactsForSku(sku: string): Promise<VisibilityFacts & { reason: string }>;
export function countRecentQuotesBySku(quotes: ReadonlyArray<{ source?: string; createdAt: number; spec?: unknown; deleted?: boolean }>, since: number): Map<string, number>; // pure, exported for tests

// portal-pricing.ts (server-only)
export type PortalPricingContext = { customerId: string; margin: number; tier: string; tierMargin: number; staleCostMonths: number; now: number };
export async function pricingContextFor(session: { customerId: string; name: string }): Promise<PortalPricingContext>;
export type SellLine = { lineId: string; kind: "part" | "fixture" | "curtain"; title: string; sku: string | null; qty: number;
  unit: string; unitPrice: number | null; extPrice: number | null; por: boolean; porReason?: string; unavailable: boolean; detail?: string };
export type PricedCart = { lines: SellLine[]; subtotal: number; freight: { amount: number; miles: number | null; pct: number; unknown: boolean };
  total: number; mode: "firm" | "review"; reason: string | null; sections: SpecSection[] }; // sections = staff-side spec (carries cost) — NEVER sent to the client
export async function priceCart(cart: PortalCart, ctx: PortalPricingContext): Promise<PricedCart>;
export function sellView(p: PricedCart): Omit<PricedCart, "sections">;
export async function freightFor(customerId: string, locationId: string | null): Promise<{ pct: number; miles: number | null; unknown: boolean }>;
export async function priceSku(sku: string, ctx: PortalPricingContext): Promise<{ unitPrice: number | null; por: boolean; porReason?: string } | null>; // null = not quotable
```

- [ ] **Step 1: Failing tests** — pure `countRecentQuotesBySku`:

```ts
import { countRecentQuotesBySku as d245Counts } from "@/lib/portal-catalog-index";
{
  const mk = (createdAt: number, skus: string[], source = "estimator") => ({ source, createdAt, spec: { sections: [{ items: skus.map((sku) => ({ sku })) }] } });
  const since = 1000;
  const m = d245Counts([mk(2000, ["A", "A", "B"]), mk(3000, ["A"]), mk(500, ["A"]), mk(4000, ["A"], "daylite"), { source: "x", createdAt: 5000, spec: null }], since);
  ok(m.get("A") === 2 && m.get("B") === 1, "#245 index: counts distinct quotes per SKU inside the window, excluding Daylite history and old quotes");
}
```

DB `portal245IndexAsyncChecks`: create catalog fixtures via `mergeUpsert` (`fixtureId(245,"p-img")` with an attached image, `fixtureId(245,"p-hide")` with `portalVisibility: "hide"`, `fixtureId(245,"p-plain")`), call `invalidatePortalIndex(); const ix = await portalIndex({ fresh: true })`, assert: `p-hide` absent from `ix.entries`; `p-img` entry `browsable === true`; `p-plain` present with `browsable === false`. Assert `priceSku(p-hide)` → `null`. Build a cart `{ id: "TEST245:cart", customerId: <a test company>, locationId: null, lines: [{ lineId: "1", kind: "part", sku: p-img, qty: 2 }, { lineId: "2", kind: "curtain", qty: 1, curtainInputs: {...} }] }`; `priceCart` → `mode === "review"`, curtain line `por`, part line `extPrice === 2 × unitPrice`, `freight.unknown === true` (no venue) and `freight.pct === 10`; `sellView()` result JSON contains no `"cost"` key (assert `!JSON.stringify(sellView(p)).includes("\"cost\"")`).

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement `portal-catalog-index.ts`.**
  - Module-level `let cache: { at: number; ix: PortalIndex } | null`; TTL 5 min; `invalidatePortalIndex()` sets `cache = null`. Call it from the catalog part save action, the part-documents actions (upload/attach/detach/display) — add one call in each of those server actions after the write.
  - Build: `const parts = await list()`; drop `portalVisibility === "hide"` and deleted; `const state = await loadPartDocsState(parts)`; datasheet presence = `slotSatisfied(slotCoverage(state.index, sku, "datasheet"))` (own or covered); datasheet ids for the sidebar = the ids of own + covering datasheet/specsheet docs (use `linkedDocuments`/`coveringParents` from `coverage.ts`); `imageIds` from `visibleImagesForParts(skus)`; accessories = `state.index.childrenOf.get(sku) ?? []` filtered to quotable; `quoteCount` from `countRecentQuotesBySku(await getAllQuotes(), now − browseWindowMonths × MONTH_MS)`; spec text = `specState === "authored" ? specBody : null`.
  - `countRecentQuotesBySku`: skip `deleted`, `source === "daylite"`, `createdAt < since`; walk `spec.sections[].items[].sku` (guard every level with `Array.isArray`), count each SKU once per quote.
  - Fixtures: `listFixtures()` → `kind === "fixture"` only; lines = light engine (required) + lens (required, if any) + each box's `FixtureLine` (`required: qty > 0`, `qty` as stored); a fixture whose light engine is not quotable is excluded.
  - Entries: parts → `{ key: sku, kind: "part", title: desc || sku, sku, mfr, category, haystack: buildHaystack([sku, desc, mfr, category, mpn, model]), browsable: browsable(facts, rule), rank: quoteCount }`; fixtures → `{ key: "fixture:" + id, kind: "fixture", title: label, sku: lightEngineSku, mfr: <light engine mfr>, category: "Fixture assemblies", haystack: buildHaystack([label, description, lightEngineSku]), browsable: true, rank: 1000 }`.
  - `portalFactsForSku`: from the index when present, else (hidden part) `{ visibility: "hide", … , reason: "Hidden from customers" }`.
- [ ] **Step 4: Implement `portal-pricing.ts`.** First line `import "server-only";` if the package exists (else match `curtain-pricing.ts`).
  - `pricingContextFor`: `resolveTier(session.customerId, session.name)` → `margin`; `loadPortalRules().staleCostMonths`.
  - `freightFor`: `if (!locationId) return { pct: rule.capPct, miles: null, unknown: true }`; `const t = await travelForId(customerId, locationId)`; `const miles = t && t.source !== "none" ? t.miles : null`; `freightPctForMiles(miles, rule)`.
  - `priceCart`: for each cart line, from `portalIndex()`:
    - `part`: missing from index (hidden/deleted) → `unavailable: true`, excluded from totals/sections, title "No longer available"; else `unitPriceFor` → SellLine + staff `SpecItem { id, sku, desc, qty, unit, cost, price: unitPrice ?? 0, manufacturer: mfr, manufacturerPartNumber: mpn, por?: true }`.
    - `fixture`: fixture from index (+ `fixtureOptions: Record<string, number>` of optional-line qty overrides keyed `slot:sku`) → components (required lines at stored qty, optional lines at the chosen qty, default 0) → `fixtureUnitPrice`; staff item `{ …, fixture: true, components: [...] , cost: fx.cost, price: fx.unitPrice ?? 0 }`; `detail` = "Included: … · Add-ons: …".
    - `curtain`: always `por: true, porReason: "curtain"`; staff item `{ sku: "CRT-REQ", desc: "<name> — <fabric name>, <W>'W × <H>'H, <fullness>% fullness (customer request — price on request)", qty, unit: "ea", cost: 0, price: 0, curtain: true, por: true }`.
    - Add `por?: boolean` to `SpecItem` in `src/app/(app)/estimator/types.ts` (comment: `/** #245: customer-requested line still waiting on a Peak price. */`).
    - Sections: `SEC-EQUIP` "Equipment & supplies", `SEC-FIXT` "Fixtures", `SEC-DRAPE` "Drapery & soft goods" — only non-empty ones; each `kind: "materials", mfr: "", freightPct: freight.pct, freightAuto: false, items`.
    - Totals: `const t = totals(sections, 0)` (Estimator's `totals`); `subtotal = t.mat` (verify `mat` is sell of materials by reading `totals()` — if `rev` is the sell subtotal use `rev`); `freight.amount = t.fr`; `total = t.grand`; `mode` via `quoteMode(lines.filter(l => !l.unavailable))`.
  - `sellView` strips `sections`.
  - `priceSku`: index lookup (null when absent) → `unitPriceFor`.
- [ ] **Step 5:** Catalog editor reason line → `await portalFactsForSku(sku)` (Task 5 Step 4 follow-through).
- [ ] **Step 6: Gates incl. `next build`; commit** — `feat(portal): cached catalog index + server-canonical portal pricing (#245)`.

---

### Task 8: `portal_carts` collection + store + migration 0032

**Files:**
- Modify: `src/db/doc-tables.ts` (`export const portalCarts = docTable("portal_carts")` + `DOC_TABLES.portal_carts`)
- Create: `drizzle/0032_portal_carts.sql` (+ journal/snapshot from `npm run db:generate`, then hand-harden), `src/lib/stores/portal-carts.ts`
- Test: `portal245CartAsyncChecks`

**Interfaces:**
- Produces:

```ts
export type CartLine = { lineId: string; kind: "part" | "fixture" | "curtain"; sku?: string; fixtureId?: string;
  fixtureOptions?: Record<string, number>; curtainInputs?: CurtainRequest; qty: number };
export type CurtainRequest = { name: string; fabricSku: string; fabricName: string; qty: string; width: string; height: string; fullness: "0" | "50" | "75" | "100" };
export type PortalCart = { id: string /* grant id */; customerId: string; locationId: string | null; lines: CartLine[]; updatedAt: number };
export async function getCart(grantId: string, customerId: string): Promise<PortalCart>;       // empty cart when absent or customer mismatch
export async function saveCart(cart: PortalCart): Promise<PortalCart>;
export async function addLine(grantId: string, customerId: string, line: Omit<CartLine, "lineId">): Promise<PortalCart>; // same part SKU → qty added to the existing line
export async function updateLine(grantId: string, customerId: string, lineId: string, patch: { qty?: number; fixtureOptions?: Record<string, number> }): Promise<PortalCart>; // qty ≤ 0 removes
export async function removeLine(grantId: string, customerId: string, lineId: string): Promise<PortalCart>;
export async function setVenue(grantId: string, customerId: string, locationId: string | null): Promise<PortalCart>;
export async function clearCart(grantId: string): Promise<void>;
export const MAX_CART_LINES = 200; export const MAX_LINE_QTY = 10000;
```

- [ ] **Step 1: Failing DB test** — `getCart("TEST245:g1", co)` → empty with `lines.length === 0`; `addLine` part ×2 then same SKU ×3 → one line qty 5; add a curtain line → 2 lines; `updateLine(qty 0)` removes; a cart saved for customer A read with customer B → empty (never another customer's cart); qty clamped to `MAX_LINE_QTY`; no quote row created (`(await getAllQuotes()).some(q => q.customerId === co && q.source === "portal-catalog")` false). Register `portal_carts` fixtures.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** — doc table; `npm run db:generate` (stop: this opens no DB); rename the generated SQL to `0032_portal_carts.sql`, rewrite to `CREATE TABLE IF NOT EXISTS "portal_carts" (…same columns as 0029…)`, two `CREATE INDEX IF NOT EXISTS`, and `CREATE OR REPLACE TRIGGER portal_carts_seq_bump BEFORE UPDATE ON "portal_carts" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();` — copy 0029's text and substitute the name. Store via `getDoc`/`upsertDoc`; `lineId` = `crypto.randomUUID().slice(0, 8)`; `updatedAt = Date.now()`.
- [ ] **Step 4: Gates; commit** — `feat(portal): portal_carts collection — one cart per grant, no quote row until Generate (#245)`.

---

### Task 9: Customer document route

**Files:**
- Create: `src/lib/portal-doc-access.ts` (pure), `src/app/portal/catalog/doc/[id]/route.ts`
- Test: pure block

**Interfaces:**
- Produces: `canServePortalDoc(input: { docId: string; linksBySku: Map<string, Array<{ documentId: string; kind: string; hidden?: boolean }>>; quotableSkus: Set<string>; coveringParentsOf: (sku: string) => string[] }): boolean`.

- [ ] **Step 1: Failing test** — doc linked (not hidden) to a quotable SKU → true; linked only to a hidden-link → false; linked only to a non-quotable SKU → false; a datasheet linked to a quotable fixture parent of a quotable accessory → true; an **image** on a parent never serves via the accessory → false.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** the pure fn, then the route: `resolvePortalViewer(searchParams.get("preview") || "")` → no session → 404; `portalIndex()` gives quotable SKUs and doc ids per SKU (add `docLinks: Map<string, …>` to the index if needed rather than re-querying); `getDocument(id)`; deny → `new Response("Not found", { status: 404 })`; allow → same body as `/api/part-documents/[id]` (`getBlobStream(blobKey)`; no blobKey → 302 to `sourceUrl`), headers `Content-Type: doc.contentType`, `Content-Disposition` inline, `Cache-Control: private, max-age=86400`, `ETag: "<id>"`, and `X-Content-Type-Options: nosniff`. Rate-limit per grant with `rateLimit("portal-doc:" + session.grantId, 300, 60_000)` → 429.
- [ ] **Step 4: Gates; commit** — `feat(portal): customer document route — only docs linked to parts they can see (#245)`.

---

### Task 10: `/portal/catalog` browse page

**Files:**
- Create: `src/app/portal/catalog/page.tsx`, `src/app/portal/catalog/catalog-client.tsx`, `src/app/portal/catalog/actions.ts` (`searchPortalCatalog`)
- Modify: `src/app/portal/shell.tsx` (nav: Home · Catalog · Quote (N)), `src/app/portal/page.tsx` (header CTA "Build your own estimate" → "Shop the catalog" `/portal/catalog`), `src/app/portal/estimate/page.tsx` → `redirect("/portal/catalog")` (delete `estimate-builder.tsx` in Task 12), `scripts/smoke-routes.ts`
- Test: smoke route + a DB check for the search action's customer scoping

**Interfaces:**
- Consumes: `portalIndex`, `searchCatalog`, `priceSku`/`pricingContextFor`, `resolvePortalViewer`.
- Produces: `searchPortalCatalog(q: SearchQuery): Promise<{ ok: true; result: { entries: TileVM[]; total; page; pages; mfrFacets; catFacets } } | { ok: false; error: string }>` where `TileVM = { key: string; kind: "part" | "fixture"; title: string; sku: string; mfr: string; category: string; imageId: string | null; hasDatasheet: boolean; unitPrice: number | null; por: boolean; unit: string }`.

- [ ] **Step 1: Failing check** — add `/portal/catalog` and `/portal/estimate` to `scripts/smoke-routes.ts` `ROUTES` (both must render 200 for a signed-out visitor: the signed-out portal card / a redirect to it). Add a DB check that `searchPortalCatalog` without a portal session returns `{ ok: false }` (server actions read `portalSession()`; in the harness there's no cookie → expect the expired-link error).
- [ ] **Step 2: Implement.**
  - `page.tsx` (server, `dynamic = "force-dynamic"`): `resolvePortalViewer(preview)`; no session → the same signed-out card as `/portal` (extract that card into `src/app/portal/signed-out.tsx` and reuse in both pages). Parse `?q=&mfr=&cat=&page=&part=` (mfr/cat may repeat). Run `searchCatalog` server-side for first paint; map entries to `TileVM` with `priceSku` per visible entry (48 max). "Parts you've quoted before" shelf when `q`, `mfr`, `cat` are all empty: SKUs from this company's app-era quotes (`portalListsQuote(q, cid)` → `spec.sections[].items[].sku`, newest quote first, distinct, quotable, max 12). Render `PortalShell` + `CatalogClient`.
  - `catalog-client.tsx` ("use client"): search box (debounced 250 ms, updates the URL with `router.replace`), left rail with Manufacturer and Category facet lists (each with a filter input, checkboxes, counts, selected first), chips for active facets, a tile grid (image `<img src="/portal/catalog/doc/<imageId>" loading="lazy">` → datasheet icon → neutral placeholder), price or **Price on request**, a quick **Add** (parts; disabled in preview) and **Configure** (fixtures) — both open the sidebar (`?part=`); numbered pager (Prev · 1 2 3 … · Next). Under 768 px the rail collapses behind a "Filters" button. Styles: existing `pk-*` classes and CSS variables only; accent via `var(--accent)`.
  - `searchPortalCatalog` ("use server"): `portalSession()` → none → `{ ok:false, error: "Your access link has expired — open the link we sent you again." }`; `rateLimit("portal-search:" + grantId, 120, 60_000)`; clamp `pageSize` to 48; returns TileVMs (sell only).
  - Shell nav: add a `nav?: Array<{ href: string; label: string; active?: boolean; badge?: number }>` prop to `PortalShell`, render as links under the top bar; `/portal` passes Home active, `/portal/catalog` passes Catalog active; the Quote item shows the cart line count (`getCart(...)`, skip in preview).
- [ ] **Step 3: Gates incl. `next build` and `npm run test:smoke` (stop any dev server first; `lsof -i :3000`); commit** — `feat(portal): /portal/catalog — search, manufacturer/category facets, tiles, paging, quoted-before shelf (#245)`.

---

### Task 11: Part sidebar, fixture configurator, curtain request, cart actions, Ask a question

**Files:**
- Create: `src/app/portal/catalog/part-sidebar.tsx`, `fixture-config.tsx`, `curtain-request.tsx`, `ask-question.tsx`
- Modify: `src/app/portal/catalog/actions.ts` (cart + detail + ask actions), `page.tsx` (load `?part=` detail server-side)
- Test: DB checks for the actions' scoping + ask-question lead

**Interfaces:**
- Produces (server actions, all `portalSession()`-scoped, all return `{ ok: true, … } | { ok: false; error: string }`):
  - `partDetail(key: string)` → `{ kind: "part"; sku; title; mfr; mpn; unit; unitPrice; por; images: string[]; docs: Array<{ id; kind: "datasheet" | "specsheet"; title }>; specText: string | null; goesWith: TileVM[] } | { kind: "fixture"; id; title; description; unitPrice; por; unavailable; fixed: Array<{ sku; label; qty }>; addOns: Array<{ key: string /* slot:sku */; sku; label; unitPrice: number | null; por: boolean }>; images; docs }`
  - `priceFixtureOptions(fixtureId: string, options: Record<string, number>)` → `{ unitPrice: number | null; por: boolean; unavailable: boolean }`
  - `addToCart(input: { kind: "part"; sku: string; qty: number } | { kind: "fixture"; fixtureId: string; options: Record<string, number>; qty: number } | { kind: "curtain"; curtain: CurtainRequest })` → `{ ok: true; count: number }`
  - `askAboutPart(input: { sku: string; message: string; phone?: string })`
- [ ] **Step 1: Failing DB checks** — `askAboutPart` creates a lead with `source: "existing"`, `owner: ""`, `customerId` from the session, message starting `"[Portal question — <SKU>]"` (drive with a stubbed session: extract the lead-building into a pure `buildPartQuestionLead(session, customerName, part, message, phone)` in `src/lib/portal-leads.ts` and test that; the action only wires it); `addToCart` with a hidden SKU → refused (`priceSku` null) — test via the pure guard `cartAddProblem(indexHas: boolean, qty: number): string | null` in `portal-leads.ts`' sibling `src/lib/portal-cart-rules.ts` (`"This part isn't available to quote."`, `"Enter a quantity from 1 to 10,000."`).
- [ ] **Step 2: Implement.**
  - Sidebar (right panel, full-screen sheet < 768 px, `?part=` in the URL, Esc/close clears it): gallery (main image + thumbs), title, mfr · part #, price/unit or **Price on request**, Documents list — each opens an inline `<iframe src="/portal/catalog/doc/<id>">` viewer with "Open in new tab"; spec text (pre-wrapped); **Goes with** (tiles with Add); qty stepper + **Add to quote** (disabled in preview with the preview hint); **Ask a question about this part** (`ask-question.tsx`: message + optional phone, submits `askAboutPart`, shows "Sent — we'll get back to you." on success). Rate-limit ask: `rateLimit("portal-ask:" + grantId, 5, 3_600_000)`.
  - Fixture configurator: fixed parts list (light engine, lens, included lines with qty), add-ons as toggles with a qty input (qty > 0 = on), live price via `priceFixtureOptions` (debounced), unavailable → "This fixture can't be quoted online right now — ask us about it." and Add disabled.
  - Curtain request (header button on `/portal/catalog` → modal): inputs name, fabric (select over `byCategory("Fabric")` filtered by `fabricAreaRateOf(p) > 0` — names only, no rates), qty, width (ft), height (ft), fullness (Flat/50%/75%/100%); reuse `curtainAreas` from `src/lib/curtain-geom.ts` only to show "≈ N sq ft of fabric" (no price). Copy: "We'll price this for you — curtain quotes are confirmed by Peak." Submit → `addToCart({ kind: "curtain", … })`.
  - All add actions: `invalidate` nothing; `revalidatePath("/portal/catalog")`; return the new line count for the header chip.
- [ ] **Step 3: Gates incl. `next build`; commit** — `feat(portal): part sidebar, fixture configurator, curtain pricing request, ask a question, add to quote (#245)`.

---

### Task 12: Cart page + Generate (firm/review) + retire the old estimate

**Files:**
- Create: `src/app/portal/catalog/quote/page.tsx`, `quote/cart-client.tsx`, `src/lib/portal-quotes.ts`
- Modify: `src/lib/stores/quotes.ts` (`SetStatusOpts.bypassApprovalGate` + `"portal-firm"`; `Quote` + `portalFirm?`, `portalReview?`, `portalDecline?`; `portalAcceptance` widened; `portalListsQuote` includes `portal-catalog`), `src/app/portal/actions.ts` (delete `submitPortalEstimate`), delete `src/app/portal/estimate/estimate-builder.tsx`, delete `src/lib/portal-catalog.ts` (+ any import), `src/app/portal/page.tsx` (chips: review → "In review — Peak will confirm pricing"; firm → "Valid until <date>")
- Test: DB checks for generate

**Interfaces:**
- Produces:

```ts
// quotes.ts additions
portalFirm?: { generatedAt: number; validUntil: number } | null;
portalReview?: { requestedAt: number; reasons: string[] } | null;
portalDecline?: { at: number; by: string; note: string } | null;
portalAcceptance?: { at: number; by: string; byEmail: string; purchaseMethod?: "po" | "card" | "check" | "other"; notes?: string; poDocumentId?: string | null } | null;

// portal-quotes.ts (server)
export async function generatePortalQuote(session: PortalSession, opts?: { now?: number; schedulePdf?: boolean }): Promise<{ ok: true; quoteId: string; mode: "firm" | "review" } | { ok: false; error: string }>;
export async function sendPortalFirm(quoteId: string, validityDays: number, now: number): Promise<void>; // shared by generate + refresh
```

- [ ] **Step 1: Failing DB checks** (`portal245GenerateAsyncChecks`, company fixture with an owner and a venue whose `travelMiles` = 450):
  - firm cart (one priced part) → `generatePortalQuote(sessionStub, { schedulePdf: false })` → quote `status === "sent"`, `source === "portal-catalog"`, `estNo` is a number, `portalFirm.validUntil === generatedAt + 30d`, `owner` = company owner, `spec.sections[0].freightPct === 4`, `value === totals(...).grand`, cart now empty.
  - review cart (part + curtain) → `status === "draft"`, `portalReview.reasons[0] === "1 line is price on request"`, `estNo` set, `portalListsQuote(q, co)` true.
  - cart with no venue → `{ ok: false, error: "Pick the venue this is for." }`; empty cart → `{ ok:false, error: "Your quote is empty." }`.
  - `portalListsQuote` true for a `portal-catalog` draft of this customer, false for another customer's.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
  - `quotes.ts`: add the fields; `resolveStatusGate`/the bypass check (~897-901) accepts `"portal-firm"`; comment: `// #245: a firm portal quote is priced by rule end to end (portal-pricing.ts); Peak's approval is the Approve step on acceptance.` `portalListsQuote`: `q.status !== "draft" || q.source === "portal-self-serve" || q.source === "portal-catalog"`.
  - `generatePortalQuote`: load cart (`getCart(session.grantId, session.customerId)`); guards (empty, no venue, all lines unavailable); `ctx = pricingContextFor(session)`; `p = priceCart(cart, ctx)`; `cust = getCustomer(customerId)`; `createQuote({ name: "Portal quote — " + <venue label>, customer: cust.name, customerId, locationId: cart.locationId, contactName: session.name, value: p.total, margin: ctx.margin, pricingTier: ctx.tier, tierMargin: ctx.tierMargin, source: "portal-catalog", spec: { sections: p.sections, mobs: [] } })`; `updateQuote(id, { owner: cust.owner || "", quoteNote: "All quotes are subject to Peak review and approval. Plus applicable sales tax.", portalReview: mode === "review" ? { requestedAt: now, reasons: [p.reason] } : null })`; `scheduleQuotePdf(id)` when `schedulePdf !== false`; firm → `sendPortalFirm(id, rules.validityDays, now)`; `clearCart(grantId)`.
  - `sendPortalFirm`: `updateQuote(id, { portalFirm: { generatedAt: now, validUntil: firmValidUntil(now, validityDays) } })` then `setStatus(id, "sent", "Customer portal", { bypassApprovalGate: "portal-firm" })`. Follow the estimator's save-then-send order exactly (read `src/app/(app)/estimator/actions.ts` save+send path) so the #222 sent-revision PDF copy behaves the same.
  - Quote documents: make the quote PDF/preview print the review line, "Plus applicable sales tax." and, when `portalFirm`, "Valid until <date>" — find where `quoteNote` renders in `src/lib/quote-pdf/quote-document-data.ts` and add `validUntil` there; freight renders via the existing "Freight & delivery" line; add miles to that label only for `source === "portal-catalog"` (store `freightMiles` on the section: add optional `freightMiles?: number | null` to `SpecSection` and set it in `priceCart`).
  - Cart page (`/portal/catalog/quote`): server loads `priceCart` → `sellView`; client shows venue select (customer venues; `setVenue` action), lines (qty steppers → `updateLine`, remove, fixture add-ons summary, curtain inputs summary, POR marker, "No longer available" rows), Subtotal · **Freight & delivery — 412 mi** (or "Freight & delivery — distance unknown") · Total (or "Total (excludes items pending price)"), badge **Firm quote** / **Needs Peak review** + reason, the standing line, **Generate quote** (disabled with reason when empty/no venue/preview) → `generatePortalQuoteAction` → redirect `/portal?generated=<firm|review>` with a banner: firm → "Your quote EST-#### is ready — open the PDF or accept it below."; review → "Thanks — Peak will confirm pricing on EST-#### and let you know."
  - Retire: delete `submitPortalEstimate`, `estimate-builder.tsx`, `src/lib/portal-catalog.ts`; `/portal/estimate/page.tsx` stays as the redirect (Task 10). Grep for leftovers: `grep -rn "portal-catalog\"\|customerCatalog\|CUSTOMER_CATEGORIES\|submitPortalEstimate\|estimate-builder" src scripts` → only intended hits.
- [ ] **Step 4: Gates incl. `next build`; commit** — `feat(portal): cart page + Generate — firm quotes send numbered with a 30-day validity, others go to Peak review; old estimate retired (#245)`.

---

### Task 13: Accept, expiry/refresh, copy to new quote, decline — customer + staff sides

**Files:**
- Create: `src/app/portal/accept-dialog.tsx`, `src/app/(app)/estimator/portal-panel.tsx`
- Modify: `src/app/portal/actions.ts` (`acceptPortalQuote` rewrite; `refreshPortalQuote`; `copyQuoteToCart`), `src/lib/portal-quotes.ts` (`acceptPortal`, `refreshPortalQuote`, `copyToCart`, `declinePortalAcceptance`), `src/app/portal/page.tsx` (row actions + decline note), `src/app/portal/documents-actions.ts` (a variant returning the new `DOC-` id), `src/app/(app)/estimator/page.tsx` + client (render `PortalPanel` for `source === "portal-catalog"`), `src/app/(app)/estimator/actions.ts` (`declinePortalAcceptanceAction`; saving clears `por` on items whose `price > 0`, and clears `portalReview` when no `por` items remain)
- Test: DB checks

**Interfaces:**
- Produces:
  - `acceptPortal(session, input: { quoteId: string; purchaseMethod: string; notes: string; poDocumentId: string | null }, now?: number): Promise<{ ok: true } | { ok: false; error: string }>`
  - `refreshPortalQuote(session, quoteId, now?): Promise<{ ok: true; mode: "firm" | "review" } | { ok: false; error: string }>`
  - `copyToCart(session, quoteId): Promise<{ ok: true; added: number } | { ok: false; error: string }>`
  - `declinePortalAcceptance(quoteId: string, by: string, note: string): Promise<{ ok: true } | { ok: false; error: string }>`
- [ ] **Step 1: Failing DB checks** (`portal245AcceptAsyncChecks`):
  - accept a firm in-date quote with `purchaseMethod: "po", notes: "PO 44812"` → `portalAcceptance.purchaseMethod === "po"`; status still `sent`; the bell item appears for the owner (`navData(owner)` has the "portal" group containing the quote).
  - accept with notes containing `4111 1111 1111 1111` → `{ ok:false, error: "Don't enter card numbers — we'll call you to take payment." }` and nothing written.
  - accept with an unknown `purchaseMethod` → refused `"Pick how you'll purchase."`.
  - expired (`now` = validUntil + 1) → `{ ok:false, error: "This quote's pricing has expired — refresh it to get current pricing." }`.
  - `refreshPortalQuote` after expiry → new `validUntil`, a new revision appended (`revisions.length` grew), value recomputed; with a line made POR (set its part's `note`) → returns `mode: "review"`, quote back to `draft` with `portalReview`, `portalFirm` cleared.
  - `copyToCart` → cart gains the quote's lines (parts by SKU, fixtures by id+options, curtains by inputs), existing cart lines kept.
  - `declinePortalAcceptance(id, "Staff", "Need a PO")` → `portalAcceptance === null`, `portalDecline.note === "Need a PO"`, status `sent`.
  - Another customer's session can't accept/refresh/copy (→ `"We couldn't find that quote."`).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.**
  - `acceptPortal`: load quote; `portalListsQuote(q, session.customerId)` else not-found error; `canAcceptPortal(q, now)` → map reasons to copy (expired as above; accepted → "This quote was already accepted."; not-sent → "This quote isn't ready to accept yet."); validate method ∈ `PURCHASE_METHODS`; notes ≤ 1000 chars; `looksLikeCardNumber(notes)` → card copy; `updateQuote(id, { portalAcceptance: { at: now, by: session.name, byEmail: session.email, purchaseMethod, notes, poDocumentId }, portalDecline: null })`.
  - Accept dialog (client): method radio (4 labels from `PURCHASE_METHOD_LABEL`), notes textarea with the card warning as helper text, optional PO file via `putDocumentFile(file, { customerId, handleUploadUrl: "/portal/documents/upload" })` then the id-returning finalize variant with `category` = the documents category whose label matches `/purchase order/i` if one exists, else the default category; submit → `acceptPortalQuote` action. Replaces the bare Accept button on `/portal` rows.
  - Portal row states: firm+expired → "Pricing expired" chip + **Refresh pricing** button; declined → a muted line "Peak: <note>"; every generated portal quote row gets **Copy to new quote** (→ `copyQuoteToCart` → redirect `/portal/catalog/quote`).
  - `refreshPortalQuote`: must be this customer's `portal-catalog` quote, `sent`, `portalFirm`, expired, not accepted; rebuild a transient cart from its spec items (same mapping as `copyToCart`) + its `locationId`; `priceCart`; firm → `updateQuote(id, { spec, value })`, `addQuoteRevision(id, { by: "Customer portal", reason: "manual", note: "Portal price refresh" })`, `scheduleQuotePdf(id)`, `sendPortalFirm(id, …)` (if `setStatus(sent→sent)` is a no-op in the store, instead cut the revision with `reason: "sent"` and call `copySentRevisionPdf(id)` — verify by reading `setStatus` and choose the path the #222 portal PDF route (`portalQuotePdfSource`) will actually serve; the DB test asserts the portal PDF source points at the newest revision); review → `setStatus(id, "draft", …)` if the store permits sent→draft, else leave `sent` but set `portalReview` and clear `portalFirm` — decide from the store's transition rules and log the choice in DECISIONS (Task 14).
  - Staff `PortalPanel` in the Estimator (top of the page for `source === "portal-catalog"`): review banner listing POR items ("Price on request: <desc> ×qty") with the reasons; acceptance block — purchase method label, notes, PO file link (`/api/documents/<id>` — use whatever the staff document download route is; grep `DocumentRecord` download route), accepted by/when; buttons **Approve (mark Won)** → the existing Quotes-hub status action (`src/app/(app)/quotes/actions.ts` status setter with `won`; surface `ApprovalGateRefused` messages as-is) and **Decline with note** (prompt-free: an inline textarea + button → `declinePortalAcceptanceAction`). Also show "Firm portal quote — valid until <date>" when `portalFirm`.
  - Estimator save: after items are saved, `por` cleared on items with `price > 0`; when none left, `portalReview: null`.
- [ ] **Step 4: Gates incl. `next build`; commit** — `feat(portal): accept with purchase method/notes/PO file, expiry + refresh, copy to new quote; staff approve/decline panel (#245)`.

---

### Task 14: Staff surfaces, datasheet thumbnails, docs

**Files:**
- Modify: `src/app/(app)/quotes/page.tsx` (Portal badge), `src/lib/nav-counts.ts` + `src/lib/stores/notif-prefs.ts` (two derived groups), `src/app/(app)/companies/[id]/page.tsx` (Portal activity line after the `PortalAccessCard` ~761), `src/lib/quote-pdf/token.ts` (`PrintTokenKind = PdfKind | "part-thumb"`)
- Create: `src/lib/part-docs/thumbnail.ts`, `src/app/print/part-thumb/[id]/page.tsx` (+ client renderer), `src/app/(app)/catalog/documents/thumbnail-button.tsx`, action `renderThumbnailsAction` in `catalog/documents/actions.ts`
- Docs: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase-status item 19), `MASTER-QUESTIONS.md` (close S19), `QUESTIONS.md` (Jeff-gated items)
- Test: pure checks for the bell derivations + thumbnail candidate selection

**Interfaces:**
- Produces: `portalBellGroups(quotes: Quote[], me: string, now: number): { review: BellItem[]; generated: BellItem[] }` (pure, in `src/lib/portal-bell.ts`); `thumbnailCandidates(input: { skus: string[]; imagesBySku: Map<string, unknown[]>; ownDatasheetBySku: Map<string, { id: string; blobKey: string | null }> }): Array<{ sku: string; datasheetId: string }>` (pure, in `src/lib/part-docs/thumbnail-plan.ts`); `renderDatasheetThumbnail(datasheetId: string, skus: string[], by: string): Promise<{ ok: true; documentId: string } | { ok: false; error: string }>`.
- [ ] **Step 1: Failing tests** — `portalBellGroups`: a `portal-catalog` draft with `portalReview` owned by me → in `review`; owned by someone else → not; unowned → in `review` for everyone; a firm `sent` portal quote created 10 h ago owned by me → in `generated`; 80 h ago → not. `thumbnailCandidates`: SKU with an image → skipped; SKU with own blob-backed datasheet and no image → candidate; datasheet with `blobKey: null` (link only) → skipped; two SKUs sharing one datasheet → one candidate per SKU but the renderer is called once per datasheet (group in the action).
- [ ] **Step 2: Implement.**
  - Quotes hub: after the type badge, when `q.source === "portal-catalog"` render a badge **Portal** (neutral colors via existing CSS variables); add "Portal" to the hub's source/type filter only if the filter list is data-driven (else skip).
  - Bell: `notif-prefs.ts` `CATEGORIES` gains `{ key: "portalReview", label: "Portal quotes to review", desc: "Customer quotes with items waiting on a Peak price." }` and `{ key: "portalNew", label: "New portal quotes", desc: "Firm quotes customers generated in the last 3 days." }`; `nav-counts.ts` pushes both via `portalBellGroups`, `href: quoteBuilderHref(q)`. Update the existing "portal" group's sub-line to "… — approve or decline in the quote".
  - Company record: "Portal activity: N portal quotes · M awaiting approval · K in review" (counts over the company's `portal-catalog` quotes), linking to `/quotes?customer=<id>` if that filter exists, else plain text.
  - Datasheet thumbnails: `/print/part-thumb/[id]?t=<token>` (under `print/`, already outside team auth) verifies `verifyPrintToken(AUTH_SECRET, t, "part-thumb", id, now)`; a client component loads `pdfjs-dist` (worker `/pdf.worker.min.mjs`, as `src/components/design/pdf-canvas.tsx` does), fetches the PDF bytes from a signed sibling route `/print/part-thumb/[id]/file?t=` (streams `getBlobStream(blobKey)` after the same token check), renders page 1 at 800 px width to a `<canvas id="thumb">`, then sets `document.body.dataset.ready = "1"`. `renderDatasheetThumbnail`: `chromeLaunch()` (unavailable → `{ ok:false, error: "Headless Chrome isn't available here." }`), `page.goto(printOriginFor(...) + path)`, `waitForSelector('body[data-ready="1"]', { timeout: 30_000 })`, `(await page.$("#thumb")).screenshot({ type: "png" })`, upload to Blob at `partDocBlobPath(newId, "<datasheet-title>-thumb.png")` (private), `createDocument({ kind: "image", source: "datasheet-render", sourceRef: datasheetId, contentType: "image/png", … })`, `attachDocument(newId, skus, by)`. `renderThumbnailsAction`: `requirePerm("manage_users")`, loads `portalIndex`/parts-docs state, `thumbnailCandidates`, groups by datasheet, renders under a 45 s budget (`createFetchBudget(45_000)`), returns `{ done, remaining }`; the button (admin-only, on `/catalog/documents`) loops until `remaining === 0`, like the fetch-links client loop. Calls `invalidatePortalIndex()` when done.
  - Docs: re-check next free punch/D numbers on `origin/main` (`git fetch && git show origin/main:DECISIONS.md | grep -oE "^#+ *D[0-9]+" | tail -1`). DECISIONS entries (one each): freight rule + Estimator default; freight on the Estimator's cost base, customers see amount + miles; firm/review split and the `portal-firm` gate bypass; review/approval notices as derived bell groups; fixture configurator = included + add-on toggles; `portal_carts` separate from quotes (estimate numbers); no DaVinci image import (icons/riser art); images PNG/JPEG/WebP only; visibility rule + quote-count window; refresh path choice from Task 13; `/portal/estimate` retired. PUNCHLIST #245 entry (what shipped + Jeff-gated follow-ups: run datasheet thumbnails on production, upload hero images for top parts, review Hide/Show on odd parts, set `QUOTE_PDF_ORIGIN` if not yet). Follow-ups logged: self-serve service quotes (next spec), priced curtain configurator, department tree, Quick Design freight, public sign-up, abandoned-cart cleanup, D60/D63 staleness. AGENTS.md phase-status item **19. ✅ Portal Catalog (#245, D396…)**. MASTER-QUESTIONS S19 → answered by #245.
- [ ] **Step 3: Full gates** — `npx tsc --noEmit`; `npm run test:specs` (PASS count = baseline + new, 0 FAIL); `npm run test:smoke` (dev server stopped first); `npx eslint` on every touched file vs. the baseline count; `npx next build`. Clean temp PGlite dirs afterwards (`df -h /private/var/folders` first).
- [ ] **Step 4: Commit** — `feat(portal): Portal badge, review/new-quote bell groups, company portal activity, datasheet thumbnails; docs (#245)`.

---

## Self-review notes

- Spec coverage: §1.1 → T3/T4/T14 (DaVinci dropped per §8.7); §1.2 → T9; §1.3 → T5/T7; §2.1 → T6/T7; §2.2 → T1/T2/T7; §2.3 → T6; §3.1 → T10; §3.2 → T11; §3.3 → T11; §3.4 → T12; §4.1 → T8; §4.2/4.3 → T12; §4.4/4.5/4.6 → T13; §5 → T1/T4/T5/T13/T14; §6 → tests throughout + T14 gates; §7 → T14 docs.
- Names used across tasks: `freightPctForMiles`, `loadFreightRule`, `loadPortalRules`, `portalIndex`, `invalidatePortalIndex`, `priceCart`, `sellView`, `pricingContextFor`, `priceSku`, `getCart`/`addLine`/`updateLine`/`removeLine`/`setVenue`/`clearCart`, `generatePortalQuote`, `sendPortalFirm`, `acceptPortal`, `refreshPortalQuote`, `copyToCart`, `declinePortalAcceptance`, `quoteMode`, `canAcceptPortal`, `firmValidUntil`, `looksLikeCardNumber`, `searchCatalog`, `buildHaystack`, `unitPriceFor`, `fixtureUnitPrice`, `visibleImagesForParts`, `setDocumentLinkDisplay`, `sniffImageType`, `maxBytesFor` — defined once, consumed by name.
