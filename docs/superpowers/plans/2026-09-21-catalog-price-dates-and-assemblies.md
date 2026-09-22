# Catalog Price Dates, Import Guards + Live Assemblies Implementation Plan (PUNCHLIST #129, #130, #132, #133, #134)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every catalog price an effective date, surface manufacturers whose price lists are over 18 months old (or undated) on Home and as an editable Catalog banner, harden both catalog importers (required manufacturer, wrong-manufacturer double check, 1 MB cap with a clear error), make Subassemblies re-price live like Assemblies, and fold Assemblies + Subassemblies into one tab.

**Architecture:** A pure price-date model in `src/lib/catalog-books.ts` (`pricedAt` per part, a manufacturer-level `settings.priceListEffective` date, `effectivePriceDate`, `priceBooks` with outdated/unknown flags) is stamped centrally by the catalog store's `upsert` (only when list/cost change). A pure guard module `src/lib/catalog-import-guard.ts` (`checkManufacturer`, `checkSize`) is shared by the Catalog page importer (body split into `catalog/import.ts` so it is regression-testable) and the Import hub's `catalog` type (server action + preview). Subassemblies gain `resolveSubassembly()` next to `resolveFixtureAssemblies()`; `/design/assemblies?tab=` hosts both builders and `/design/subassemblies` redirects. Spec: `docs/superpowers/specs/2026-09-21-catalog-price-dates-and-assemblies-design.md`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, doc-store JSON documents, server actions, tsx test harnesses

## Global Constraints

- No schema change: parts (`catalog_parts`) and settings (`app_settings.data`) are JSON documents; new fields are optional keys.
- `requireUser()` / `requirePerm()` from `src/lib/session.ts` on every server action; the Import hub stays `manage_users`-gated as it is today.
- Timestamps are epoch-ms numbers (`pricedAt`, `priceListEffective[*]`, `snapshot.pricedAt`). Date inputs are `YYYY-MM-DD` strings converted at the edge with `parseEffectiveDate` / `isoDateOf`.
- No hardcoded accent colour — reuse `var(--accent)` / the existing inline style constants of each screen. No emoji in UI copy.
- Every new pure helper lives in a DB-free module (`src/lib/catalog-books.ts`, `src/lib/catalog-import-guard.ts`, `src/lib/fixture-assemblies.ts`); DB behaviour is tested in `scripts/test-review-regressions.ts`.
- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first. Verification commands available to implementers: `npx tsc --noEmit -p .`, `npx tsx scripts/test-review-and-spec.ts | grep -E '<pattern>|ALL PASSED'`, `npm run test:review:regressions`, `npx eslint <files>`.
- **Implementers must NOT run `npm run test:smoke`, `next dev` or `next build` themselves** — the controller runs those (PGlite is single-process; `ps aux | grep -E 'tsx|next dev'` must be empty before any DB script).
- `git add` only the files each task names. Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Spec harness helper: `ok(cond, msg)` in `scripts/test-review-and-spec.ts` (line 129); pure blocks go at top level next to the `#14` block (line 2930). Regression harness: `assert` from `node:assert/strict` inside `main()` in `scripts/test-review-regressions.ts` (append before the final `console.log("review regression checks passed")`, line 738).

---

## File Structure

- `src/lib/catalog-books.ts` — pure price-date model: `OUTDATED_AFTER_MS`, `isOutdated`, `mfrKey`, `effectivePriceDate`, `nextPricedAt`, `parseEffectiveDate`, `isoDateOf`, `priceBooks` (rewritten, returns `effectiveAt`/`outdated`/`unknown`).
- `src/lib/catalog-import-guard.ts` — **new**, pure: `MAX_CATALOG_IMPORT_BYTES`, `checkSize`, `formatBytes`, `checkManufacturer`, `groupRowsByManufacturer`, `checkManufacturerGroups`.
- `src/lib/stores/catalog.ts` — `CatalogPart.pricedAt`, `UpsertOpts`, `upsert`/`mergeUpsert` stamp `pricedAt` only when list/cost change.
- `src/lib/settings.ts` — `AppSettingsData.priceListEffective`, `setPriceListEffective(key, at)`.
- `src/app/(app)/catalog/import.ts` — **new**, server-only: `runCatalogImport()` (size → parse → guard → upserts → book date), the action's body.
- `src/app/(app)/catalog/actions.ts` — `importCatalog` becomes a thin FormData/redirect wrapper; new `setPriceListEffectiveAction`.
- `src/app/(app)/catalog/controls.tsx` — import panel: required manufacturer, effective-date field, client-side 1 MB check on the file and the paste box.
- `src/app/(app)/catalog/price-date-banner.tsx` — **new** client component: outdated/unknown manufacturers with inline date inputs + facet links.
- `src/app/(app)/catalog/page.tsx` — mounts the banner, passes `today` to the panel, shows the per-line price date in the edit modal.
- `src/app/(app)/home-catalog.tsx` — Outdated (red) / Unknown (grey) / age pill states.
- `src/app/(app)/page.tsx` — passes settings into `priceBooks`.
- `src/app/(app)/import/types.ts` — `catalog.mfr` becomes `required`.
- `src/app/(app)/import/registry.ts` — `CommitContext` (`effectiveAt`) threaded through `commitImport` into the catalog writer.
- `src/app/(app)/import/actions.ts` — `importRecords` runs the size check, the per-manufacturer guard, normalizes spellings, records the book date; new `checkCatalogImportAction` for the preview.
- `src/app/(app)/import/controls.tsx` — catalog-only: effective-date input, 1 MB checks (xlsx + paste), debounced guard preview that blocks commit.
- `src/app/(app)/import/page.tsx` — passes `today` to `PastePreview`.
- `src/app/api/import/xlsx/route.ts` — 1 MB cap when `type=catalog`; 10 MB for everything else.
- `next.config.ts` — `experimental.serverActions.bodySizeLimit: "1200kb"` so a ~1 MB upload reaches the app's own error.
- `src/lib/fixture-assemblies.ts` — `FIXTURE_OPTION_CATEGORIES`, `pricesAsOf`, `resolveSubassembly`.
- `src/lib/stores/subassemblies.ts` — `FixtureSubassembly.snapshot`.
- `src/app/(app)/design/subassemblies/actions.ts` — `saveFixtureAction` resolves through `resolveSubassembly`, writes `snapshot`, revalidates `/design/assemblies`.
- `src/app/(app)/design/subassemblies/subassemblies-client.tsx` — live prices + "prices as of" + "was $ when built".
- `src/app/(app)/design/subassemblies/page.tsx` — redirect to `/design/assemblies?tab=subassemblies`.
- `src/app/(app)/design/assemblies/page.tsx` — one page, `?tab=assemblies|subassemblies`, loads catalog + subassemblies + settings.
- `src/app/(app)/design/assemblies/tabs.tsx` — **new** two-link switch.
- `src/app/(app)/design/assemblies/assembly-builder.tsx` — drops its own page chrome; "prices as of" note per assembly.
- `src/lib/design-routes.ts` — `/design/subassemblies` → `/design/assemblies?tab=subassemblies`.
- `src/components/nav/nav-data.ts` — Subassemblies entry removed; `activeKeyFor` maps both paths to `assemblies`.
- `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`, `scripts/smoke-routes.ts` — tests.
- `DECISIONS.md` (D156, D157), `PUNCHLIST.md` (#129, #130, #132, #133, #134 → DONE).

---

### Task 1: Pure price-date model in `catalog-books.ts`

**Files:**
- Modify: `src/lib/catalog-books.ts` (whole file — currently 47 lines)
- Test: `scripts/test-review-and-spec.ts` (replace the `#14` block at lines 2930–2978 with the block below)

**Interfaces:**
- Consumes: nothing (DB-free, import-free).
- Produces (all exported from `src/lib/catalog-books.ts`):
  - `OUTDATED_AFTER_MS: number` (548 days), `isOutdated(at: number, now?: number): boolean`
  - `mfrKey(name: string | null | undefined): string` — lowercase, strip non-alphanumerics (the importer's `norm()` in `src/app/(app)/import/parse.ts:127-131`)
  - `type PriceDateSettings = { priceListEffective?: Record<string, number> | null }`
  - `effectivePriceDate(part: { mfr?: string; pricedAt?: number }, settings?: PriceDateSettings): number | null`
  - `nextPricedAt(existing, next, at): number | undefined` — the store's stamping rule
  - `parseEffectiveDate(input: string | null | undefined, now: number): number`, `isoDateOf(ms: number): string`
  - `type PriceBookRow = { mono; name; key; count; effectiveAt: number | null; outdated: boolean; unknown: boolean }`
  - `priceBooks(parts, settings?, opts?: { now?: number; limit?: number }): PriceBookRow[]` (default `limit` 6 for the Home card; `Infinity` for the banner)

Semantics decided here (logged as D156 in Task 9): `effectivePriceDate` is the **later** of the part's own `pricedAt` and the manufacturer's `priceListEffective` date — a list confirmed on day D confirms every line on it, and a line re-priced after D keeps its own date. A book is dated only when **every** part has an effective date (a single hand-edited SKU must not make a 2,000-row book read as fresh — #14 decision A carried forward); `effectiveAt` is then the oldest date; `unknown` = not fully dated; `outdated` = dated and ≥ 548 days old.

- [ ] **Step 1: Replace the `#14` spec block (lines 2930–2978) with the failing tests**

```ts
/* --- #14 / #133: catalog price books + price-date model --- pure, asserted at top level. */
import {
  OUTDATED_AFTER_MS,
  effectivePriceDate,
  isOutdated,
  isoDateOf,
  mfrKey,
  nextPricedAt,
  parseEffectiveDate,
  priceBooks,
} from "@/lib/catalog-books";

{
  const now = Date.now();
  const DAY = 86400000;
  const MONTH = 30.4375 * DAY;

  ok(
    mfrKey("Meyer Sound") === "meyersound" && mfrKey("meyer-sound") === "meyersound" && mfrKey(" MEYER  SOUND ") === "meyersound",
    "#133 mfrKey: case, spaces and punctuation collapse"
  );
  ok(mfrKey("") === "" && mfrKey(undefined) === "" && mfrKey("---") === "", "#133 mfrKey: blank/punctuation-only → empty key");

  ok(OUTDATED_AFTER_MS === 548 * DAY, "#133 OUTDATED_AFTER_MS is 548 days (18 months)");
  ok(!isOutdated(now - 17 * MONTH, now), "#133 isOutdated: 17 months → current");
  ok(!isOutdated(now - 547 * DAY, now), "#133 isOutdated: one day short of the boundary → current");
  ok(isOutdated(now - 548 * DAY, now), "#133 isOutdated: exactly 548 days (18 months) → outdated");
  ok(isOutdated(now - 19 * MONTH, now), "#133 isOutdated: 19 months → outdated");

  const S = { priceListEffective: { meyersound: now - 100 * DAY } };
  ok(
    effectivePriceDate({ mfr: "Meyer Sound", pricedAt: now - 10 * DAY }, S) === now - 10 * DAY,
    "#133 effectivePriceDate: a newer per-line date wins over the book date"
  );
  ok(
    effectivePriceDate({ mfr: "Meyer Sound", pricedAt: now - 400 * DAY }, S) === now - 100 * DAY,
    "#133 effectivePriceDate: a newer book date (list confirmed later) wins over an older per-line date (D156)"
  );
  ok(
    effectivePriceDate({ mfr: "meyer-sound" }, S) === now - 100 * DAY,
    "#133 effectivePriceDate: no per-line date → the book date, matched through mfrKey"
  );
  ok(effectivePriceDate({ mfr: "ETC" }, S) === null, "#133 effectivePriceDate: no date anywhere → null");
  ok(effectivePriceDate({ pricedAt: now - 5 * DAY }, S) === now - 5 * DAY, "#133 effectivePriceDate: unbranded parts still use their own date");

  const D1 = now - 200 * DAY;
  const D2 = now - 20 * DAY;
  ok(nextPricedAt(null, { list: 10, cost: 5 }, D1) === D1, "#133 nextPricedAt: a new part is stamped with the write's date");
  ok(
    nextPricedAt({ list: 10, cost: 5, pricedAt: D1 }, { list: 10, cost: 5, pricedAt: D1 }, D2) === D1,
    "#133 nextPricedAt: unchanged list+cost keep the old date"
  );
  ok(nextPricedAt({ list: 10, cost: 5, pricedAt: D1 }, { list: 12, cost: 5, pricedAt: D1 }, D2) === D2, "#133 nextPricedAt: a list change stamps the new date");
  ok(nextPricedAt({ list: 10, cost: 5, pricedAt: D1 }, { list: 10, cost: 6, pricedAt: D1 }, D2) === D2, "#133 nextPricedAt: a cost change stamps the new date");
  ok(
    nextPricedAt({ list: 10, cost: 5 }, { list: 10, cost: 5 }, D2) === undefined,
    "#133 nextPricedAt: legacy part, unchanged price → still undated (no fake date)"
  );

  ok(isoDateOf(new Date(2026, 0, 15).getTime()) === "2026-01-15", "#133 isoDateOf renders a local YYYY-MM-DD");
  ok(parseEffectiveDate("2026-01-15", now) === new Date(2026, 0, 15).getTime(), "#133 parseEffectiveDate: a date input parses to local midnight");
  ok(parseEffectiveDate("", now) === now && parseEffectiveDate("nope", now) === now, "#133 parseEffectiveDate: blank/invalid → the fallback");

  const fresh = priceBooks([{ mfr: "Acme", pricedAt: now - 3 * DAY }, { mfr: "Acme", pricedAt: now - 5 * DAY }], {}, { now });
  ok(
    fresh[0]?.effectiveAt === now - 5 * DAY && !fresh[0].outdated && !fresh[0].unknown,
    "#14/#133 priceBooks: effectiveAt is the OLDEST date in a fully-dated book, not the newest"
  );
  const partial = priceBooks([{ mfr: "Beta", pricedAt: now }, { mfr: "Beta" }], {}, { now });
  ok(
    partial[0]?.count === 2 && partial[0].effectiveAt === null && partial[0].unknown,
    "#14/#133 priceBooks: one dated row out of two does NOT date the book (unknown is older than anything — decision A)"
  );
  const covered = priceBooks([{ mfr: "Beta", pricedAt: now }, { mfr: "Beta" }], { priceListEffective: { beta: now - 30 * DAY } }, { now });
  ok(
    covered[0]?.effectiveAt === now - 30 * DAY && !covered[0].unknown,
    "#133 priceBooks: the book date covers the undated row, and oldest still wins"
  );
  const stale = priceBooks([{ mfr: "Gamma", pricedAt: now - 600 * DAY }], {}, { now });
  ok(stale[0]?.outdated && !stale[0].unknown, "#133 priceBooks: a 600-day-old book is outdated");
  const never = priceBooks([{ mfr: "Delta" }, { mfr: "Delta" }], {}, { now });
  ok(never[0]?.unknown && never[0].effectiveAt === null && !never[0].outdated, "#14/#133 priceBooks: no date anywhere → unknown, never outdated");
  const merged = priceBooks(
    [{ mfr: "Meyer Sound", pricedAt: now }, { mfr: "meyer-sound", pricedAt: now }, { mfr: "Meyer Sound" }],
    { priceListEffective: { meyersound: now - DAY } },
    { now }
  );
  ok(
    merged.length === 1 && merged[0].name === "Meyer Sound" && merged[0].key === "meyersound" && merged[0].count === 3,
    "#133 priceBooks: spellings merge by mfrKey and the most common spelling names the book"
  );
  const unbranded = priceBooks([{ pricedAt: now }, { mfr: "  " }], {}, { now });
  ok(
    unbranded.some((b) => b.name === "Unbranded" && b.key === "" && b.count === 2),
    "#14 priceBooks: blank/whitespace-only mfr groups under 'Unbranded' with an empty key"
  );
  const eight = Array.from({ length: 8 }, (_, i) => ({ mfr: `Mfr${i}`, pricedAt: now })).flatMap((p, i) =>
    Array.from({ length: 8 - i }, () => p)
  );
  ok(priceBooks(eight, {}, { now }).length === 6, "#14 priceBooks: caps at the top 6 books by count by default");
  ok(priceBooks(eight, {}, { now, limit: Infinity }).length === 8, "#133 priceBooks: limit: Infinity returns every book (the Catalog banner)");
  ok(priceBooks(eight, {}, { now })[0]?.name === "Mfr0", "#14 priceBooks: sorted by count descending");
}
```

- [ ] **Step 2: Run it, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → a TypeScript/ESM import error naming `OUTDATED_AFTER_MS` (or `mfrKey`) as not exported from `@/lib/catalog-books`.

- [ ] **Step 3: Implement — replace `src/lib/catalog-books.ts` entirely**

```ts
/**
 * Catalog price dates (PUNCHLIST #133, D156) + the price-book glance
 * (PUNCHLIST #14). Pure and import-free so the Home card, the Catalog
 * banner, the store's stamping rule and the spec harness all share one
 * definition of "when is this price from" without touching the database.
 *
 * Two dates feed every answer:
 * - `part.pricedAt` — epoch ms of the price list this line's price came
 *   from; the store stamps it ONLY when `list` or `cost` actually changes
 *   (see nextPricedAt), so it means "when this price last moved".
 * - `settings.priceListEffective[mfrKey(mfr)]` — the manufacturer's
 *   "price list effective" date, set by the Catalog banner (the one-time
 *   backfill) and by every import that writes rows. A list confirmed on
 *   day D confirms every line on it, so a line's effective date is the
 *   LATER of its own date and the book date.
 */

const DAY = 86400000;

/** 18 months. A book whose oldest effective date is this old is "outdated". */
export const OUTDATED_AFTER_MS = 548 * DAY;

export function isOutdated(at: number, now: number = Date.now()): boolean {
  return now - at >= OUTDATED_AFTER_MS;
}

/** Manufacturer key: lowercase, non-alphanumerics stripped — the same
 *  normalization the importer's `norm()` applies to headers, so
 *  "Meyer Sound" / "meyer-sound" / "MEYER SOUND" are one book. */
export function mfrKey(name: string | null | undefined): string {
  return String(name == null ? "" : name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type PriceListEffective = Record<string, number>;
export type PriceDateSettings = { priceListEffective?: PriceListEffective | null };

function validMs(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** The date a part's price is effective as of, or null when nothing dates it. */
export function effectivePriceDate(
  part: { mfr?: string; pricedAt?: number },
  settings: PriceDateSettings = {}
): number | null {
  const own = validMs(part.pricedAt);
  const key = mfrKey(part.mfr);
  const book = key ? validMs(settings.priceListEffective?.[key]) : null;
  if (own == null) return book;
  if (book == null) return own;
  return Math.max(own, book);
}

/**
 * The store's stamping rule (lib/stores/catalog upsert/mergeUpsert):
 * - a brand-new part is stamped with `at` (unless the incoming doc already
 *   carries a date, e.g. a backfill script);
 * - an existing part whose `list` or `cost` changed is stamped with `at`;
 * - otherwise the date stays what it was (the incoming full-replace doc
 *   normally carries the existing value; a legacy part stays undated —
 *   never invent a date for a price nobody confirmed).
 */
export function nextPricedAt(
  existing: { list?: number; cost?: number; pricedAt?: number } | null | undefined,
  next: { list?: number; cost?: number; pricedAt?: number },
  at: number
): number | undefined {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (!existing) return next.pricedAt ?? at;
  const changed = n(existing.list) !== n(next.list) || n(existing.cost) !== n(next.cost);
  if (changed) return at;
  return next.pricedAt ?? existing.pricedAt;
}

/** `<input type="date">` value → epoch ms at local midnight; blank/invalid → `now`. */
export function parseEffectiveDate(input: string | null | undefined, now: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((input || "").trim());
  if (!m) return now;
  const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return Number.isFinite(t) ? t : now;
}

/** Epoch ms → local `YYYY-MM-DD` (the value shape `<input type="date">` wants). */
export function isoDateOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type PriceBookRow = {
  /** Two-letter monogram for the Home card tile. */
  mono: string;
  /** Display spelling — the most common stored spelling of the manufacturer. */
  name: string;
  /** mfrKey(name); "" for the Unbranded bucket (no manufacturer to date). */
  key: string;
  count: number;
  /** Oldest effective date among the book's parts; null unless EVERY part has one. */
  effectiveAt: number | null;
  outdated: boolean;
  unknown: boolean;
};

function monoOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Price books grouped by manufacturer key. "Oldest wins" (#14 decision A):
 * the book's date is its oldest part's effective date, and a part with no
 * date at all is older than anything — so a book is `unknown` until every
 * part is dated (its own pricedAt or the manufacturer's book date), which
 * is exactly what the Catalog banner's date input provides in one click.
 */
export function priceBooks(
  parts: Array<{ mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {},
  opts: { now?: number; limit?: number } = {}
): PriceBookRow[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  type Acc = { names: Map<string, number>; count: number; dated: number; oldest: number | null };
  const by = new Map<string, Acc>();
  for (const pt of parts) {
    const name = (pt.mfr || "").trim();
    const key = mfrKey(name);
    const acc = by.get(key) || { names: new Map<string, number>(), count: 0, dated: 0, oldest: null };
    acc.count += 1;
    if (name) acc.names.set(name, (acc.names.get(name) || 0) + 1);
    const at = effectivePriceDate(pt, settings);
    if (at != null) {
      acc.dated += 1;
      acc.oldest = acc.oldest == null ? at : Math.min(acc.oldest, at);
    }
    by.set(key, acc);
  }
  return [...by.entries()]
    .map(([key, acc]) => {
      const name = key
        ? [...acc.names.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
        : "Unbranded";
      const effectiveAt = acc.dated === acc.count ? acc.oldest : null;
      return {
        mono: monoOf(name),
        name,
        key,
        count: acc.count,
        effectiveAt,
        outdated: effectiveAt != null && isOutdated(effectiveAt, now),
        unknown: effectiveAt == null,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#133|#14|ALL PASSED'` → every `#133`/`#14` line PASS and `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty. (`src/app/(app)/page.tsx:179` still calls `priceBooks(catalogParts)` with one argument and `home-catalog.tsx` still types its prop as `{ mono; name; count; ageDays? }` — `PriceBookRow` is structurally assignable to that, so tsc stays clean; the Home pill simply renders nothing until Task 6 rewires the card.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-books.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): pure price-date model — pricedAt, mfrKey, effectivePriceDate, 18-month outdated rule, priceBooks flags (#133 §1-2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Store stamping rule + `settings.priceListEffective` + `setPriceListEffectiveAction`

**Files:**
- Modify: `src/lib/stores/catalog.ts:1-2` (imports), `:70-76` (add the `pricedAt` field after `updatedAt`), `:93-132` (replace `upsert` + `mergeUpsert`)
- Modify: `src/lib/settings.ts:88-89` (add the field after `fixtureAssemblies`), append `setPriceListEffective` after `setSettings` (line 169)
- Modify: `src/app/(app)/catalog/actions.ts:1-12` (imports), append `setPriceListEffectiveAction` at the end of the file
- Test: `scripts/test-review-regressions.ts` (append inside `main()` before line 738)

**Interfaces:**
- Consumes: `nextPricedAt`, `mfrKey` from `src/lib/catalog-books.ts` (Task 1); `getDoc`/`upsertDoc` already imported in the store; `getSettings`/`setSettings` in `src/lib/settings.ts`; `requireUser` from `src/lib/session.ts`.
- Produces:
  - `CatalogPart.pricedAt?: number`
  - `export type UpsertOpts = { pricedAt?: number }`; `upsert(part, opts?: UpsertOpts)`, `mergeUpsert(sku, patch, opts?: UpsertOpts)` (both existing signatures gain the optional third/second argument — every current caller compiles unchanged)
  - `AppSettingsData.priceListEffective?: Record<string, number>`
  - `setPriceListEffective(key: string, at: number | null): Promise<Record<string, number>>` in `src/lib/settings.ts`
  - `setPriceListEffectiveAction(mfr: string, at: number | null): Promise<{ ok: true } | { ok: false; error: string }>` in `src/app/(app)/catalog/actions.ts`

- [ ] **Step 1: Write the failing regression test** — append inside `main()` in `scripts/test-review-regressions.ts`, just above `console.log("review regression checks passed");`:

```ts
  // #133 — pricedAt moves only when list/cost change; the book date round-trips
  {
    const { get: getPart, mergeUpsert } = await import("@/lib/stores/catalog");
    const { getSettings, setPriceListEffective } = await import("@/lib/settings");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    await mergeUpsert("T133-STAMP", { desc: "Stamp test", category: "Test", unit: "ea", list: 100, cost: 60, mfr: "T133 Stamp" }, { pricedAt: D1 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D1, "#133 a new part is stamped with the write's effective date");
    await mergeUpsert("T133-STAMP", { desc: "Stamp test (renamed)", list: 100, cost: 60 }, { pricedAt: D2 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D1, "#133 an unchanged price keeps its date — a description edit doesn't move it");
    await mergeUpsert("T133-STAMP", { list: 110 }, { pricedAt: D2 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D2, "#133 a list change stamps the effective date that was passed");
    const before = Date.now();
    await mergeUpsert("T133-STAMP", { cost: 70 });
    const stamped = (await getPart("T133-STAMP"))?.pricedAt ?? 0;
    assert.ok(stamped >= before, "#133 a price change through any other path stamps now");
    assert.equal((await getPart("T133-STAMP"))?.desc, "Stamp test (renamed)", "#133 mergeUpsert still preserves fields the patch doesn't carry");

    await setPriceListEffective("t133stamp", D1);
    assert.equal((await getSettings()).priceListEffective?.t133stamp, D1, "#133 setPriceListEffective round-trips through settings");
    await setPriceListEffective("t133stamp", null);
    assert.equal((await getSettings()).priceListEffective?.t133stamp, undefined, "#133 setPriceListEffective(null) clears the key");
  }
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:review:regressions 2>&1 | tail -5` → a TypeScript error on the third `mergeUpsert` argument / `setPriceListEffective` not exported.

- [ ] **Step 3: Implement**

`src/lib/stores/catalog.ts` — imports (lines 1–2 become):

```ts
import { clearCollection, getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import { nextPricedAt } from "@/lib/catalog-books";
import type { Port } from "@/lib/catalog-connect";
```

Add after the `updatedAt?: number;` field (line 75, inside `CatalogPart`):

```ts
  /** Epoch ms of the price list this line's price came from — its effective
   *  date (PUNCHLIST #133, D156). Stamped by `upsert`/`mergeUpsert` ONLY when
   *  `list` or `cost` actually changes (importers pass the price list's
   *  effective date; any other write stamps "now"), so it means "when this
   *  price last moved" — unlike `updatedAt`, which moves on every write.
   *  Absent on parts that predate the field; the manufacturer-level
   *  `settings.priceListEffective` date covers those (lib/catalog-books
   *  effectivePriceDate). */
  pricedAt?: number;
```

Replace lines 93–132 (`upsert` + `mergeUpsert`, including their doc comments) with:

```ts
/** Options for a part write. `pricedAt` is the effective date to stamp WHEN
 *  the write changes `list` or `cost` (the importers pass the price list's
 *  effective date); it is ignored when the price is unchanged. Default: now. */
export type UpsertOpts = { pricedAt?: number };

async function writePart(
  existing: CatalogPart | null,
  part: Omit<CatalogPart, "id"> & { id?: string },
  opts: UpsertOpts
): Promise<CatalogPart> {
  const now = Date.now();
  const pricedAt = nextPricedAt(existing, part, opts.pricedAt ?? now);
  const doc: CatalogPart = { ...part, id: part.id || part.sku, updatedAt: now };
  if (pricedAt != null) doc.pricedAt = pricedAt;
  else delete doc.pricedAt;
  return upsertDoc<CatalogPart>("catalog_parts", doc);
}

/** Insert or fully replace a part; the SKU is the document id. Stamps
 *  `updatedAt` on every write (PUNCHLIST #14, decision A) and `pricedAt`
 *  only when the price changed (PUNCHLIST #133) — centralized here rather
 *  than left to each caller so every write path (the catalog edit form, the
 *  .xlsx/CSV importers, the spec-builder's create-on-the-fly path, the
 *  datasheet actions) gets both for free. Reads the existing doc first to
 *  compare prices; `mergeUpsert` shares that read. */
export async function upsert(
  part: Omit<CatalogPart, "id"> & { id?: string },
  opts: UpsertOpts = {}
): Promise<CatalogPart> {
  const existing = await get(part.id || part.sku);
  return writePart(existing, part, opts);
}

/**
 * Load the existing part (if any) and shallow-merge `patch` over it before
 * writing — a bare `upsert` is a FULL REPLACE and would otherwise silently
 * drop any field the caller doesn't happen to carry (ports,
 * datasheetBlobKey/Name, trade, discipline/role, costPerSqft, pricedAt, …).
 *
 * Use this instead of a bare `upsert(...)` whenever the caller only knows
 * about a subset of a part's fields — the catalog edit form and bulk/paste
 * import both authoritatively own a handful of fields (desc, category, unit,
 * list, cost, mfr, note, …) and should overwrite exactly those, while
 * everything else on an existing part rides along untouched. A key present
 * in `patch` always wins, including an explicit `undefined` (how a caller
 * clears a field it owns, e.g. a blanked `mfr`/`note`); a key simply absent
 * from `patch` (as with a JSON-parsed import row that never had it) leaves
 * the existing value in place.
 */
export async function mergeUpsert(
  sku: string,
  patch: Partial<Omit<CatalogPart, "id" | "sku">>,
  opts: UpsertOpts = {}
): Promise<CatalogPart> {
  const existing = await get(sku);
  // Cast: TS can't see that callers only omit fields `existing` already
  // supplies (or, for a brand-new part, that `patch` carries every required
  // field itself) — the runtime contract is enforced by callers, same as
  // the pre-existing `{ ...part, ... } as SpecCatalogPart` pattern in
  // design/engagements/spec/actions.ts.
  return writePart(existing, { ...(existing ?? {}), ...patch, sku } as Omit<CatalogPart, "id"> & { id?: string }, opts);
}
```

`src/lib/settings.ts` — after the `fixtureAssemblies` field (line 89) add:

```ts
  /** Per-manufacturer "price list effective" date (PUNCHLIST #133, D156),
   *  keyed by mfrKey() from lib/catalog-books (lowercase alphanumerics) →
   *  epoch ms. Written by the Catalog banner's date input (the one-time
   *  backfill for parts that predate `pricedAt`) and by both importers when
   *  an import writes rows. A part's effective date is the LATER of its own
   *  `pricedAt` and this — see effectivePriceDate. Absent = no book dates. */
  priceListEffective?: Record<string, number>;
```

Append after `setSettings` (end of file):

```ts
/** #133 — set (or with `at: null`, clear) one manufacturer's price-list
 *  effective date. `key` must already be an mfrKey(); an empty key is a
 *  no-op. Returns the full map after the write. */
export async function setPriceListEffective(
  key: string,
  at: number | null
): Promise<Record<string, number>> {
  const current = await getSettings();
  const next: Record<string, number> = { ...(current.priceListEffective || {}) };
  if (!key) return next;
  if (at == null) delete next[key];
  else next[key] = at;
  await setSettings({ priceListEffective: next });
  return next;
}
```

`src/app/(app)/catalog/actions.ts` — imports (lines 1–12 become):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePerm } from "@/lib/session";
import { clearCatalogPriceList, get as getPart, upsert, mergeUpsert } from "@/lib/stores/catalog";
import { mfrKey, parseEffectiveDate } from "@/lib/catalog-books";
import { checkSize } from "@/lib/catalog-import-guard";
import { setPriceListEffective, setSettings } from "@/lib/settings";
import { GROUPS, TRADES, type CategoryMap } from "@/lib/catalog-taxonomy";
import { blobEnabled, dataUrlToBytes, putBlob, safeName } from "@/lib/blob";
import { runCatalogImport } from "./import";

type Result = { ok: true } | { ok: false; error: string };
```

That is the file's FINAL import block (after Task 4). **In this task, change only two things in the existing lines 1–12:** add `import { mfrKey } from "@/lib/catalog-books";` and turn `import { setSettings } from "@/lib/settings";` into `import { setPriceListEffective, setSettings } from "@/lib/settings";`. Keep `import { parseCatalog } from "./parse";` for now (the current `importCatalog` still uses it); `@/lib/catalog-import-guard` and `./import` do not exist until Tasks 3–4, which finish the block.

Append at the end of `src/app/(app)/catalog/actions.ts`:

```ts
/**
 * #133 — the Catalog banner's inline date input: record (or clear) the date
 * a manufacturer's price list is effective. `mfr` is the display name; it is
 * keyed through mfrKey so every spelling of the manufacturer shares one date.
 */
export async function setPriceListEffectiveAction(mfr: string, at: number | null): Promise<Result> {
  await requireUser();
  const key = mfrKey(mfr);
  if (!key) return { ok: false, error: "Pick a manufacturer." };
  if (at != null && (!Number.isFinite(at) || at <= 0)) return { ok: false, error: "Enter a valid date." };
  await setPriceListEffective(key, at);
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 4: Run tests, expect pass** — `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed` (plus the quote-email script's own line); `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/catalog.ts src/lib/settings.ts "src/app/(app)/catalog/actions.ts" scripts/test-review-regressions.ts
git commit -m "feat(catalog): stamp pricedAt only on a price change; manufacturer price-list effective date in settings + action (#133 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure import guard — `checkManufacturer`, `checkSize`

**Files:**
- Create: `src/lib/catalog-import-guard.ts`
- Test: `scripts/test-review-and-spec.ts` (new top-level block right after the Task 1 block)

**Interfaces:**
- Consumes: `mfrKey` from `src/lib/catalog-books.ts`.
- Produces:
```ts
export const MAX_CATALOG_IMPORT_BYTES = 1_048_576;
export type SizeCheck = { ok: true } | { ok: false; error: string };
export function formatBytes(n: number): string;
export function checkSize(bytes: number): SizeCheck;
export type ManufacturerCheck =
  | { ok: true; normalizedMfr: string; isNew: boolean; overlap: number }
  | { ok: false; reason: "missing"; detail: string }
  | { ok: false; reason: "no-overlap"; detail: string }
  | { ok: false; reason: "foreign-skus"; detail: string; examples: Array<{ sku: string; mfr: string }>; total: number };
export function checkManufacturer(input: { mfr: string; fileSkus: string[]; catalog: Array<{ sku: string; mfr?: string }> }): ManufacturerCheck;
export type ManufacturerGroup = { mfr: string; skus: string[] };
export function groupRowsByManufacturer(rows: Array<{ mfr: string; sku: string }>): ManufacturerGroup[];
export type GroupCheck = { mfr: string; count: number; result: ManufacturerCheck };
export function checkManufacturerGroups(groups: ManufacturerGroup[], catalog: Array<{ sku: string; mfr?: string }>): GroupCheck[];
```
Guard order (logged as D157): `missing` → `foreign-skus` (the more specific finding) → `no-overlap` → ok with the existing spelling. SKU comparison is case/punctuation-insensitive (the same `norm` the hub's dedupe uses). Unbranded parts are never "foreign" — importing them under a manufacturer is how they get branded.

- [ ] **Step 1: Write the failing tests** — add after the Task 1 block:

```ts
/* --- #132 / #134: catalog import guards --- pure */
import {
  MAX_CATALOG_IMPORT_BYTES,
  checkManufacturer,
  checkManufacturerGroups,
  checkSize,
  groupRowsByManufacturer,
} from "@/lib/catalog-import-guard";

{
  const cat = [
    { sku: "ETC-1", mfr: "ETC" },
    { sku: "ETC-2", mfr: "ETC" },
    { sku: "MEY-1", mfr: "Meyer Sound" },
    { sku: "MEY-2", mfr: "Meyer Sound" },
    { sku: "MEY-3", mfr: "meyer-sound" },
    { sku: "NOB-1" },
  ];
  const missing = checkManufacturer({ mfr: "  ", fileSkus: ["X-1"], catalog: cat });
  ok(!missing.ok && missing.reason === "missing", "#132 guard: blank manufacturer → missing");

  const normalized = checkManufacturer({ mfr: "MEYER-SOUND", fileSkus: ["MEY-1", "MEY-9"], catalog: cat });
  ok(
    normalized.ok && normalized.normalizedMfr === "Meyer Sound",
    "#132 guard: a re-spelled existing manufacturer normalizes to the most common stored spelling"
  );
  ok(normalized.ok && normalized.overlap === 1 && !normalized.isNew, "#132 guard: overlap counts the file SKUs already filed under that manufacturer");

  const noOverlap = checkManufacturer({ mfr: "ETC", fileSkus: ["NEW-1", "NEW-2"], catalog: cat });
  ok(
    !noOverlap.ok && noOverlap.reason === "no-overlap" && noOverlap.detail.includes("None of the 2 SKUs in this file belong to ETC"),
    "#132 guard: existing manufacturer + zero overlap → no-overlap with the spec's message"
  );

  const foreign = checkManufacturer({ mfr: "Meyer Sound", fileSkus: ["MEY-1", "etc-1", "ETC-2"], catalog: cat });
  ok(
    !foreign.ok && foreign.reason === "foreign-skus" && foreign.total === 2 && foreign.detail.includes("etc-1 is filed under ETC"),
    "#132 guard: SKUs filed under another manufacturer are named (case-insensitive SKU match), and win over no-overlap"
  );

  const twelveForeign = Array.from({ length: 12 }, (_, i) => ({ sku: `F-${i}`, mfr: "Chauvet" }));
  const twelve = checkManufacturer({ mfr: "Meyer Sound", fileSkus: twelveForeign.map((p) => p.sku), catalog: twelveForeign.concat(cat) });
  ok(
    !twelve.ok && twelve.reason === "foreign-skus" && twelve.examples.length === 10 && twelve.detail.includes("(+2 more)"),
    "#132 guard: foreign examples cap at 10 with a '+N more' tail"
  );

  const fresh = checkManufacturer({ mfr: "Chauvet", fileSkus: ["CH-1"], catalog: cat });
  ok(fresh.ok && fresh.isNew && fresh.normalizedMfr === "Chauvet", "#132 guard: a new manufacturer with no parts is accepted as typed");
  ok(checkManufacturer({ mfr: "Chauvet", fileSkus: ["NOB-1"], catalog: cat }).ok, "#132 guard: unbranded parts are never 'foreign' — importing them under a manufacturer brands them (D157)");
  ok(checkManufacturer({ mfr: "ETC", fileSkus: [], catalog: cat }).ok, "#132 guard: an empty SKU list is not a wrong manufacturer (the importer's own no-rows check owns that)");

  const groups = groupRowsByManufacturer([
    { mfr: "ETC", sku: "ETC-1" },
    { mfr: "etc", sku: "ETC-9" },
    { mfr: "Meyer Sound", sku: "MEY-1" },
    { mfr: "", sku: "X" },
  ]);
  ok(groups.length === 3 && groups[0].mfr === "ETC" && groups[0].skus.length === 2, "#132 groups: rows group by mfrKey, first spelling kept");
  const checks = checkManufacturerGroups(groups, cat);
  ok(
    checks.length === 3 && checks[0].result.ok && checks[1].result.ok && !checks[2].result.ok && checks[2].result.reason === "missing" && checks[0].count === 2,
    "#132 groups: each manufacturer group checks independently"
  );

  ok(checkSize(MAX_CATALOG_IMPORT_BYTES).ok, "#134 checkSize: exactly 1,048,576 bytes is allowed");
  const over = checkSize(MAX_CATALOG_IMPORT_BYTES + 1);
  ok(!over.ok && over.error.includes("1 MB"), "#134 checkSize: one byte over is refused with a message naming the 1 MB limit");
  const big = checkSize(Math.round(2.3 * 1_048_576));
  ok(!big.ok && big.error.includes("2.3 MB"), "#134 checkSize: the message renders the actual size");
}
```

- [ ] **Step 2: Run it, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → cannot find module `@/lib/catalog-import-guard`.

- [ ] **Step 3: Implement — create `src/lib/catalog-import-guard.ts`**

```ts
/**
 * Catalog import guards (PUNCHLIST #132, #134; D157). Pure and DB-free —
 * callers pass the catalog in — so the Catalog page importer, the Import
 * hub's `catalog` type (server commit AND client preview via a server
 * action) and the spec harness share one definition of "wrong manufacturer"
 * and "too big".
 */
import { mfrKey } from "./catalog-books";

/** 1 MB, exactly. Applies to the CSV/TSV file, the pasted text, and .xlsx uploads for the catalog type. */
export const MAX_CATALOG_IMPORT_BYTES = 1_048_576;

export type SizeCheck = { ok: true } | { ok: false; error: string };

export function formatBytes(n: number): string {
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return Math.round(n) + " B";
}

export function checkSize(bytes: number): SizeCheck {
  if (!Number.isFinite(bytes) || bytes < 0) return { ok: false, error: "Couldn't read the file size — try the upload again." };
  if (bytes <= MAX_CATALOG_IMPORT_BYTES) return { ok: true };
  return {
    ok: false,
    error: `That file is ${formatBytes(bytes)} — the catalog import limit is 1 MB. Split the price list into smaller files, or remove columns you don't need.`,
  };
}

export type ManufacturerCheck =
  | { ok: true; normalizedMfr: string; isNew: boolean; overlap: number }
  | { ok: false; reason: "missing"; detail: string }
  | { ok: false; reason: "no-overlap"; detail: string }
  | { ok: false; reason: "foreign-skus"; detail: string; examples: Array<{ sku: string; mfr: string }>; total: number };

type CatalogRef = { sku: string; mfr?: string };

/** SKUs compare case/punctuation-insensitively — the same `norm` the Import
 *  hub's dedupe (`ci()` in import/registry) already uses for SKUs. */
function skuKey(sku: string): string {
  return mfrKey(sku);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The wrong-manufacturer double check (#132):
 * - blank → `missing`;
 * - the name normalizes (mfrKey) to an existing manufacturer → that spelling
 *   is used (`normalizedMfr`), so "meyer-sound" files under "Meyer Sound";
 * - any file SKU filed under a DIFFERENT manufacturer → `foreign-skus`
 *   (checked first: it names exactly which rows are wrong);
 * - the manufacturer already has parts and the file overlaps none of them →
 *   `no-overlap` (the whole file is probably the wrong manufacturer);
 * - a new manufacturer, or any overlap → ok.
 * Unbranded parts (no mfr) are never foreign: importing them under a
 * manufacturer is how they get one.
 */
export function checkManufacturer(input: {
  mfr: string;
  fileSkus: string[];
  catalog: CatalogRef[];
}): ManufacturerCheck {
  const typed = (input.mfr || "").trim();
  const key = mfrKey(typed);
  if (!key) {
    return { ok: false, reason: "missing", detail: "Choose a manufacturer for this price list — every imported part is filed under one." };
  }

  const spellings = new Map<string, number>();
  const mine = new Set<string>();
  const foreignBySku = new Map<string, string>();
  for (const p of input.catalog) {
    const pm = (p.mfr || "").trim();
    const pk = mfrKey(pm);
    if (!pk) continue;
    if (pk === key) {
      spellings.set(pm, (spellings.get(pm) || 0) + 1);
      mine.add(skuKey(p.sku));
    } else {
      foreignBySku.set(skuKey(p.sku), pm);
    }
  }
  const normalizedMfr = spellings.size
    ? [...spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
    : typed;

  const fileSkus = Array.from(new Set(input.fileSkus.map((s) => (s || "").trim()).filter(Boolean)));
  const n = fileSkus.length;

  const foreign = fileSkus
    .filter((s) => foreignBySku.has(skuKey(s)) && !mine.has(skuKey(s)))
    .map((s) => ({ sku: s, mfr: foreignBySku.get(skuKey(s)) as string }));
  if (foreign.length) {
    const examples = foreign.slice(0, 10);
    const more = foreign.length - examples.length;
    return {
      ok: false,
      reason: "foreign-skus",
      total: foreign.length,
      examples,
      detail:
        `${foreign.length} of the ${plural(n, "SKU")} in this file ${foreign.length === 1 ? "is" : "are"} filed under a different manufacturer: ` +
        examples.map((e) => `${e.sku} is filed under ${e.mfr}`).join("; ") +
        (more > 0 ? ` (+${more} more)` : "") +
        ". Pick the right manufacturer, or remove those rows.",
    };
  }

  const overlap = fileSkus.filter((s) => mine.has(skuKey(s))).length;
  if (mine.size > 0 && n > 0 && overlap === 0) {
    return {
      ok: false,
      reason: "no-overlap",
      detail: `None of the ${plural(n, "SKU")} in this file belong to ${normalizedMfr} (${plural(mine.size, "part")} on file); pick the right manufacturer.`,
    };
  }
  return { ok: true, normalizedMfr, isNew: mine.size === 0, overlap };
}

export type ManufacturerGroup = { mfr: string; skus: string[] };

/** Rows → one group per mfrKey, keeping the first spelling seen. Blank
 *  manufacturers form their own group (which then fails as `missing`). */
export function groupRowsByManufacturer(rows: Array<{ mfr: string; sku: string }>): ManufacturerGroup[] {
  const by = new Map<string, ManufacturerGroup>();
  for (const r of rows) {
    const mfr = (r.mfr || "").trim();
    const key = mfrKey(mfr);
    const g = by.get(key) || { mfr, skus: [] };
    const sku = (r.sku || "").trim();
    if (sku) g.skus.push(sku);
    by.set(key, g);
  }
  return [...by.values()];
}

export type GroupCheck = { mfr: string; count: number; result: ManufacturerCheck };

export function checkManufacturerGroups(groups: ManufacturerGroup[], catalog: CatalogRef[]): GroupCheck[] {
  return groups.map((g) => ({
    mfr: g.mfr,
    count: g.skus.length,
    result: checkManufacturer({ mfr: g.mfr, fileSkus: g.skus, catalog }),
  }));
}
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#132|#134|ALL PASSED'` → all PASS + `ALL PASSED`; `npx eslint src/lib/catalog-import-guard.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-import-guard.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): pure import guard — required manufacturer, wrong-manufacturer double check, 1 MB size check (#132, #134 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Catalog page importer — guard, effective date, 1 MB cap (server + client)

**Files:**
- Create: `src/app/(app)/catalog/import.ts` (server-only helper beside `actions.ts`, the same split as `design/engagements/data.ts`)
- Modify: `src/app/(app)/catalog/actions.ts:1-14` (imports — final shape from Task 2), `:55-108` (replace `importCatalog`)
- Modify: `src/app/(app)/catalog/controls.tsx:1-7` (imports), `:128-146` (panel props/state/derived), `:273-292` (new-manufacturer input + effective date), `:314-315` and `:456` (hidden inputs), `:368-377` (file input), after `:393` (file error), after `:524` (paste size error)
- Modify: `src/app/(app)/catalog/page.tsx:412` (pass `today`)
- Modify: `next.config.ts:3-5`
- Test: `scripts/test-review-regressions.ts` (append inside `main()`)

**Interfaces:**
- Consumes: `checkManufacturer`, `checkSize` (Task 3); `mfrKey`, `parseEffectiveDate`, `isoDateOf` (Task 1); `mergeUpsert(sku, patch, { pricedAt })`, `setPriceListEffective` (Task 2); `parseCatalog` from `src/app/(app)/catalog/parse.ts`; `list` from `src/lib/stores/catalog.ts`.
- Produces: `runCatalogImport(input: CatalogImportInput): Promise<CatalogImportResult>` in `src/app/(app)/catalog/import.ts` where
```ts
export type CatalogImportInput = { mfr: string; text: string; bytes: number; effectiveAt: number; defaultCategory: string };
export type CatalogImportResult = { ok: true; imported: number; mfr: string } | { ok: false; error: string };
```
  `CatalogImportPanel` gains a required `today: string` prop (local `YYYY-MM-DD` from the server, so SSR and client agree). The forms post `effectiveDate` (`YYYY-MM-DD`) alongside `mfr`.

- [ ] **Step 1: Write the failing regression test** — append inside `main()` (after the Task 2 block):

```ts
  // #132/#133/#134 — the Catalog page importer's body (importCatalog itself needs a session + redirects)
  {
    const { runCatalogImport } = await import("@/app/(app)/catalog/import");
    const { get: getPart } = await import("@/lib/stores/catalog");
    const { getSettings } = await import("@/lib/settings");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    const csv = "SKU,Description,Category,Unit,List,Cost\nT133-A,Test part A,Test,ea,100,60\nT133-B,Test part B,Test,ea,200,120\n";
    const first = await runCatalogImport({ mfr: "T133 Acme", text: csv, bytes: Buffer.byteLength(csv), effectiveAt: D1, defaultCategory: "" });
    assert.ok(first.ok && first.imported === 2 && first.mfr === "T133 Acme", "#133 first import writes both rows under the typed manufacturer");
    assert.equal((await getPart("T133-A"))?.pricedAt, D1, "#133 a new part carries the import's effective date");
    assert.equal((await getSettings()).priceListEffective?.t133acme, D1, "#133 the import records the manufacturer's price-list effective date (D156)");

    const csv2 = "SKU,Description,Category,Unit,List,Cost\nT133-A,Test part A (renamed),Test,ea,100,60\nT133-B,Test part B,Test,ea,210,120\n";
    const second = await runCatalogImport({ mfr: "t133-acme", text: csv2, bytes: Buffer.byteLength(csv2), effectiveAt: D2, defaultCategory: "" });
    assert.ok(second.ok && second.mfr === "T133 Acme", "#132 a re-spelled manufacturer normalizes to the existing spelling");
    assert.equal((await getPart("T133-A"))?.pricedAt, D1, "#133 an unchanged price keeps its date across a re-import");
    assert.equal((await getPart("T133-B"))?.pricedAt, D2, "#133 a changed list price stamps the new effective date");
    assert.equal((await getPart("T133-A"))?.mfr, "T133 Acme", "#132 rows are filed under the normalized spelling");

    const wrong = await runCatalogImport({ mfr: "T133 Acme", text: "SKU,Description\nT133-Z,Zed\n", bytes: 30, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!wrong.ok && /None of the 1 SKU in this file belong to T133 Acme/.test(wrong.error), "#132 zero overlap with an existing manufacturer is rejected with the SKU count");
    const foreign = await runCatalogImport({ mfr: "T133 Other", text: "SKU,Description\nT133-A,Stolen\n", bytes: 30, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!foreign.ok && /T133-A is filed under T133 Acme/.test(foreign.error), "#132 a SKU filed under another manufacturer is named in the error");
    assert.equal((await getPart("T133-A"))?.mfr, "T133 Acme", "#132 a rejected import writes nothing");
    const blank = await runCatalogImport({ mfr: "", text: csv, bytes: 100, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!blank.ok && /Choose a manufacturer/.test(blank.error), "#132 a blank manufacturer is rejected server-side");
    const big = await runCatalogImport({ mfr: "T133 Acme", text: csv, bytes: 1_048_577, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!big.ok && /1 MB/.test(big.error), "#134 an over-size upload is refused before parsing");
  }
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:review:regressions 2>&1 | tail -5` → cannot find module `@/app/(app)/catalog/import`.

- [ ] **Step 3: Implement**

Create `src/app/(app)/catalog/import.ts`:

```ts
/**
 * The Catalog page importer's body (PUNCHLIST #132, #133, #134), split from
 * the server action so the regression harness can drive it without a
 * session: `importCatalog` in ./actions.ts only parses FormData and turns a
 * result into the #111 redirect. Server-only (reads/writes the catalog
 * store); never import it into a client component.
 */
import { mfrKey } from "@/lib/catalog-books";
import { checkManufacturer, checkSize } from "@/lib/catalog-import-guard";
import { setPriceListEffective } from "@/lib/settings";
import { list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
import { parseCatalog } from "./parse";

export type CatalogImportInput = {
  /** Manufacturer as picked/typed; the guard normalizes it to an existing spelling. */
  mfr: string;
  /** The CSV/TSV text — the uploaded file's contents or the paste box. */
  text: string;
  /** Upload size in bytes (`file.size`, or `Buffer.byteLength` of the paste). */
  bytes: number;
  /** Epoch ms — the price list's effective date; stamped as `pricedAt` on rows whose price changes. */
  effectiveAt: number;
  /** Category for rows that leave theirs blank (the upload path passes "Prebuilt system"). */
  defaultCategory: string;
};

export type CatalogImportResult = { ok: true; imported: number; mfr: string } | { ok: false; error: string };

export async function runCatalogImport(input: CatalogImportInput): Promise<CatalogImportResult> {
  const size = checkSize(input.bytes);
  if (!size.ok) return { ok: false, error: size.error };
  if (!input.text.trim()) return { ok: false, error: "No rows found in that file." };

  const parsed = parseCatalog(input.text, input.defaultCategory);
  if (!parsed.ok) return { ok: false, error: parsed.error || "No rows found in that file." };
  const valid = parsed.rows.filter((r) => r.valid);
  if (valid.length === 0) return { ok: false, error: "No valid rows — check the header names." };

  // #132 — the guard runs before any upsert, so a rejected file writes nothing.
  const guard = checkManufacturer({ mfr: input.mfr, fileSkus: valid.map((r) => r.sku), catalog: await listCatalog() });
  if (!guard.ok) return { ok: false, error: guard.detail };
  const mfr = guard.normalizedMfr;

  // Re-importing an already-catalogued SKU must not wipe fields this parse
  // doesn't know about (ports, trade, datasheet, …) — mergeUpsert overlays
  // just the parsed fields. pricedAt lands only on rows whose price moved.
  for (const r of valid) {
    await mergeUpsert(
      r.sku,
      { desc: r.desc, category: r.category || "Uncategorized", unit: r.unit, list: r.list, cost: r.cost, mfr },
      { pricedAt: input.effectiveAt }
    );
  }
  // D156: the file's effective date is the manufacturer's price-list date —
  // it confirms the unchanged rows too, not just the ones whose price moved.
  await setPriceListEffective(mfrKey(mfr), input.effectiveAt);
  return { ok: true, imported: valid.length, mfr };
}
```

`src/app/(app)/catalog/actions.ts` — make the import block exactly the final shape shown in Task 2 Step 3 (it now resolves: `checkSize` from `@/lib/catalog-import-guard`, `parseEffectiveDate` from `@/lib/catalog-books`, `runCatalogImport` from `./import`; drop `import { parseCatalog } from "./parse";`). Then replace lines 55–108 (`importCatalog` and its doc comment) with:

```ts
/**
 * Bulk import a price book (upload or paste) → `runCatalogImport` (./import):
 * size cap (#134), parse, the wrong-manufacturer guard (#132), upserts that
 * stamp `pricedAt` with the form's effective date on rows whose price moved
 * (#133), and the manufacturer's book date. Redirects back filtered to that
 * manufacturer with a count so the freshly-added rows are visible.
 */
export async function importCatalog(formData: FormData): Promise<void> {
  await requireUser();
  const mfr = String(formData.get("mfr") || "").trim();
  const defaultCategory = String(formData.get("category") || "").trim();
  const effectiveAt = parseEffectiveDate(String(formData.get("effectiveDate") || ""), Date.now());
  let text = String(formData.get("text") || "");
  let bytes = Buffer.byteLength(text, "utf8");
  const file = formData.get("file");

  // Every failure path redirects with a human message (punch #111) — a silent
  // return left the upload form looking frozen. redirect() throws, so these
  // stay outside any try/catch.
  const fail = (message: string): never => {
    const qs = new URLSearchParams();
    if (mfr) qs.set("mfr", mfr);
    qs.set("importError", message);
    redirect("/catalog?" + qs.toString());
  };

  if (file instanceof File && file.size > 0) {
    // #134 — refuse before reading a big file into memory.
    const size = checkSize(file.size);
    if (!size.ok) return fail(size.error);
    bytes = file.size;
    text = await file.text();
  }

  const res = await runCatalogImport({
    mfr,
    text,
    bytes,
    effectiveAt,
    defaultCategory: defaultCategory || (String(formData.get("prebuilt") || "") === "1" ? "Prebuilt system" : ""),
  });
  if (!res.ok) return fail(res.error);

  revalidatePath("/", "layout");
  const qs = new URLSearchParams();
  qs.set("mfr", res.mfr);
  qs.set("imported", String(res.imported));
  redirect("/catalog?" + qs.toString());
}
```

`next.config.ts` — after `serverExternalPackages: [...]` (line 5) add:

```ts
  // #134 (D157): the catalog importers cap uploads at 1 MB themselves
  // (lib/catalog-import-guard) and surface the refusal through the Catalog
  // page's importError banner. Server actions default to a 1 MB request
  // body, which multipart overhead pushes a ~1 MB file past, so Next would
  // reject it with an opaque error before our check runs — leave room so the
  // app's own clear error always wins.
  experimental: { serverActions: { bodySizeLimit: "1200kb" } },
```

`src/app/(app)/catalog/controls.tsx`:

(a) Imports (lines 1–7 become):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { checkSize } from "@/lib/catalog-import-guard";
import { parseCatalog } from "./parse";
import { importCatalog, removePartDatasheetAction, uploadPartDatasheetAction } from "./actions";

const fieldLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 7,
};
const dateInput: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 12px",
  outline: "none",
  background: "#fff",
};
```

(b) Panel signature + state + derived (lines 128–146 become):

```tsx
export function CatalogImportPanel({
  manufacturers,
  accent,
  today,
}: {
  manufacturers: string[];
  accent: string;
  /** Local YYYY-MM-DD from the server — the effective-date default; passed
   *  in so the server render and the client agree (no hydration drift). */
  today: string;
}) {
  const [method, setMethod] = useState<"upload" | "api" | "paste">("upload");
  const [mfrSel, setMfrSel] = useState(manufacturers[0] || "");
  const [adding, setAdding] = useState(manufacturers.length === 0);
  const [newMfr, setNewMfr] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mfr = (adding ? newMfr : mfrSel).trim();
  const parsed = text.trim() ? parseCatalog(text) : null;
  // #134 — the paste box is capped like a file; bytes, not characters.
  const pasteSize = checkSize(new TextEncoder().encode(text).length);
  const canImport = method === "paste" && !!parsed?.ok && parsed.stats.valid > 0 && pasteSize.ok;
  const canUpload = !!mfr && !!fileName && !fileError && !pending;
```

(c) The new-manufacturer input (lines 273–290) becomes `required`, and the effective-date field follows it, still inside the `method !== "api"` fragment (before its closing `</>` at line 291):

```tsx
              {adding && (
                <input
                  value={newMfr}
                  onChange={(e) => setNewMfr(e.target.value)}
                  placeholder="New manufacturer name"
                  required
                  style={{
                    width: "100%",
                    marginTop: 8,
                    fontSize: 13,
                    fontFamily: "var(--font-ui)",
                    color: "#16181d",
                    border: "1px solid #cfd4dd",
                    borderRadius: 8,
                    padding: "9px 12px",
                    outline: "none",
                  }}
                />
              )}
              {/* #133 — the price list's effective date, stamped on every row
                  whose price changes and recorded as the manufacturer's
                  price-list date. */}
              <div style={{ ...fieldLabel, marginTop: 12 }}>Price list effective</div>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value || today)}
                style={dateInput}
              />
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 4 }}>
                Defaults to today. Stamped on every part whose price changes.
              </div>
```

(d) Hidden inputs — in the upload form (after line 315 `<input type="hidden" name="prebuilt" value="1" />`) and in the paste form (after line 456 `<input type="hidden" name="mfr" value={mfr} />`) add:

```tsx
              <input type="hidden" name="effectiveDate" value={effectiveDate} />
```

(e) File input (lines 368–376) — check the size before anything is uploaded:

```tsx
                  <input
                    name="file"
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values"
                    required
                    disabled={pending}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) {
                        setFileName("");
                        setFileError(null);
                        return;
                      }
                      // #134 — refuse over-size files here, before any upload.
                      const size = checkSize(f.size);
                      if (!size.ok) {
                        setFileError(size.error);
                        setFileName("");
                        e.target.value = "";
                        return;
                      }
                      setFileError(null);
                      setFileName(f.name);
                    }}
                  />
```

(f) After the picker row's closing `</div>` (line 393) add the inline error:

```tsx
              {fileError && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{fileError}</div>
              )}
```

(g) In the paste form, after the stats row (after line 524, the `)}` that closes `{parsed && (…)}`) add:

```tsx
              {!pasteSize.ok && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{pasteSize.error}</div>
              )}
```

`src/app/(app)/catalog/page.tsx` line 412 becomes:

```tsx
            <CatalogImportPanel manufacturers={manufacturers.filter((m) => m !== UNSPEC)} accent="var(--accent)" today={isoDateOf(Date.now())} />
```

and add `import { isoDateOf } from "@/lib/catalog-books";` to the page's imports (Task 6 extends this same import line).

- [ ] **Step 4: Run tests, expect pass** — `npm run test:review:regressions 2>&1 | tail -3` → passes; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/catalog/import.ts" "src/app/(app)/catalog/actions.ts" "src/app/(app)/catalog/controls.tsx" next.config.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/catalog/import.ts" "src/app/(app)/catalog/actions.ts" "src/app/(app)/catalog/controls.tsx" "src/app/(app)/catalog/page.tsx" next.config.ts scripts/test-review-regressions.ts
git commit -m "feat(catalog): page importer — required manufacturer + wrong-manufacturer guard, effective date, 1 MB cap client+server (#132, #133, #134 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Import hub `catalog` type — required mfr, guard in preview + commit, effective date, 1 MB

**Files:**
- Modify: `src/app/(app)/import/types.ts:203` (`mfr` required)
- Modify: `src/app/(app)/import/registry.ts:57-64` (`Writer` + `CommitContext`), `:487-502` (catalog writer), `:603-639` (`commitImport`)
- Modify: `src/app/(app)/import/actions.ts` (whole file, 49 lines)
- Modify: `src/app/(app)/import/controls.tsx:1-5` (imports), `:15-46` (props/state/derived), `:54-86` (`onFile`), after `:219` (size + guard errors), before `:221` (effective date)
- Modify: `src/app/(app)/import/page.tsx:697-702` (pass `today`) + its imports
- Modify: `src/app/api/import/xlsx/route.ts` (whole file)
- Test: `scripts/test-review-and-spec.ts` (one `ok` in the `#81` catalog block after line 3259); `scripts/test-review-regressions.ts` (append inside `main()`)

**Interfaces:**
- Consumes: `checkSize`, `groupRowsByManufacturer`, `checkManufacturerGroups`, `GroupCheck`, `ManufacturerGroup` (Task 3); `mfrKey`, `parseEffectiveDate`, `isoDateOf` (Task 1); `mergeUpsert(..., { pricedAt })`, `setPriceListEffective` (Task 2); `list` from `src/lib/stores/catalog.ts`; existing `parseCsv`/`autoMap`/`prepareRows`/`PreparedRow` from `import/parse.ts`.
- Produces:
  - `export type CommitContext = { effectiveAt: number }` and `commitImport(key, rows, mode, ctx?: CommitContext)` in `import/registry.ts` (writers' `create(values, cache, ctx)` / `update(existing, values, ctx)`)
  - `checkCatalogImportAction(groups: ManufacturerGroup[]): Promise<GroupCheck[]>` in `import/actions.ts` (`"use server"`, `manage_users`)
  - `PastePreview` gains a required `today: string` prop; the form posts `effectiveDate` for the catalog type; the xlsx upload posts `type`.

- [ ] **Step 1: Write the failing tests**

In `scripts/test-review-and-spec.ts`, inside the `#81` catalog block after `ok(Number(vprep.rows[0].values.list) === 1899.5, …)` (line 3259) add:

```ts
    const noMfr = parseImportCsv(["Part Number,Description,MSRP", "S4LED-S2,Source Four LED Series 2,1899.50"].join("\n"));
    const noMfrPrep = prepareRows(noMfr.rows, autoMap(noMfr.headers, catType.fields), catType.fields);
    ok(
      !noMfrPrep.rows[0].valid && noMfrPrep.rows[0].errors.includes("Missing Manufacturer"),
      "#132 a hub catalog row without a manufacturer fails validation with the per-row error"
    );
```

In `scripts/test-review-regressions.ts`, append inside `main()` (after the Task 4 block):

```ts
  // #132/#133 — the Import hub's catalog writer stamps the commit's effective date
  {
    const { commitImport } = await import("@/app/(app)/import/registry");
    const { parseCsv, autoMap, prepareRows } = await import("@/app/(app)/import/parse");
    const { getTypeMeta } = await import("@/app/(app)/import/types");
    const { get: getPart } = await import("@/lib/stores/catalog");
    const t = getTypeMeta("catalog");
    assert.ok(t, "#132 catalog import type exists");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    const prepOf = (csv: string) => {
      const p = parseCsv(csv);
      return prepareRows(p.rows, autoMap(p.headers, t!.fields), t!.fields);
    };
    const created = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,50,30,T133 Hub\n").rows, "update", { effectiveAt: D1 });
    assert.equal(created.created, 1, "#133 hub create path wrote the row");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D1, "#133 the hub stamps the commit's effective date on a new part");
    const same = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part renamed,50,30,T133 Hub\n").rows, "update", { effectiveAt: D2 });
    assert.equal(same.updated, 1, "#133 hub update path ran");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D1, "#133 an unchanged price through the hub keeps its date");
    await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,T133 Hub\n").rows, "update", { effectiveAt: D2 });
    assert.equal((await getPart("T133-H1"))?.pricedAt, D2, "#133 a changed price through the hub stamps the new date");
    const invalid = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost\nT133-H2,No manufacturer,50,30\n").rows, "update", { effectiveAt: D2 });
    assert.equal(invalid.errored, 1, "#132 a hub row without a manufacturer is never written");
    assert.equal(await getPart("T133-H2"), null, "#132 …and does not exist afterwards");
  }
```

- [ ] **Step 2: Run them, expect failure** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#132|FAILED'` → the new `#132` line FAILs (the row is currently valid); `npm run test:review:regressions 2>&1 | tail -5` → TypeScript error on `commitImport`'s fourth argument.

- [ ] **Step 3: Implement**

`src/app/(app)/import/types.ts` line 203 becomes:

```ts
      { key: "mfr", header: "Manufacturer", label: "Manufacturer", required: true, aliases: ["mfr", "manufacturer", "brand", "mfg", "vendor", "make"], example: "ETC" },
```

`src/app/(app)/import/registry.ts` — replace the `Writer` type (lines 52–64, keeping its doc comment) with:

```ts
/** #133 — per-commit context handed to every writer; only the catalog
 *  writer reads it (the price list's effective date for `pricedAt`). */
export type CommitContext = { effectiveAt: number };

/**
 * One writer per type. `find` dedupes against `cache` (a mutable array loaded
 * once per commit so rows created earlier in the same file are seen); `create`
 * appends a lightweight marker back into that cache.
 */
type Writer = {
  count: () => Promise<number>;
  load: () => Promise<Record<string, unknown>[]>;
  find: (values: Values, cache: Record<string, unknown>[]) => Record<string, unknown> | null;
  create: (values: Values, cache: Record<string, unknown>[], ctx: CommitContext) => Promise<void>;
  update?: (existing: Record<string, unknown>, values: Values, ctx: CommitContext) => Promise<void>;
  exportObjects: () => Promise<Values[]>;
};
```

Replace the catalog writer's `create`/`update` (lines 491–502) with:

```ts
    create: async (v, cache, ctx) => {
      const sku = str(v.sku);
      // mergeUpsert is the same entry point scripts/import-catalog.ts uses —
      // it preserves fields a price sheet doesn't carry (ports, trade, spec
      // text, datasheet attachments) when a SKU is re-imported. pricedAt
      // (#133) lands only when the price actually changes.
      await Catalog.mergeUpsert(sku, catalogPatch(v, null, sku), { pricedAt: ctx.effectiveAt });
      cache.push({ id: sku, sku });
    },
    update: async (ex, v, ctx) => {
      const sku = str(ex.sku);
      await Catalog.mergeUpsert(sku, catalogPatch(v, ex, sku), { pricedAt: ctx.effectiveAt });
    },
```

Replace `commitImport` (lines 603–639) with:

```ts
/**
 * Write prepared rows into the type's store per `mode`. Invalid rows are
 * counted as errored (never written). Mirrors importkit.commit. `ctx`
 * carries the price list's effective date for the catalog writer (#133);
 * every other writer ignores it.
 */
export async function commitImport(
  key: string,
  rows: PreparedRow[],
  mode: ImportMode,
  ctx: CommitContext = { effectiveAt: Date.now() }
): Promise<ImportResult> {
  const w = WRITERS[key];
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errored: 0, total: rows.length };
  if (!w) return res;
  const cache = await w.load();
  for (const r of rows) {
    if (!r.valid) {
      res.errored++;
      continue;
    }
    try {
      const existing = w.find(r.values, cache);
      if (existing && mode === "skip") {
        res.skipped++;
        continue;
      }
      if (existing && mode === "update" && w.update) {
        await w.update(existing, r.values, ctx);
        res.updated++;
        continue;
      }
      await w.create(r.values, cache, ctx);
      res.created++;
    } catch {
      res.errored++;
    }
  }
  return res;
}
```

Replace `src/app/(app)/import/actions.ts` entirely:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";
import { setPriceListEffective } from "@/lib/settings";
import { mfrKey, parseEffectiveDate } from "@/lib/catalog-books";
import {
  checkManufacturerGroups,
  checkSize,
  groupRowsByManufacturer,
  type GroupCheck,
  type ManufacturerGroup,
} from "@/lib/catalog-import-guard";
import { parseCsv, autoMap, prepareRows, type PreparedRow } from "./parse";
import { getTypeMeta } from "./types";
import { commitImport, type ImportMode } from "./registry";

/** #132 — a failing group's message, prefixed with the manufacturer it checked. */
function guardMessage(c: GroupCheck): string {
  return c.result.ok ? "" : (c.mfr ? `${c.mfr}: ` : "") + c.result.detail;
}

/** #132 — per-manufacturer groups of a prepared catalog table (valid rows only —
 *  rows without a manufacturer are already invalid and never written). */
function catalogGroups(rows: PreparedRow[]): ManufacturerGroup[] {
  return groupRowsByManufacturer(
    rows.filter((r) => r.valid).map((r) => ({ mfr: String(r.values.mfr ?? ""), sku: String(r.values.sku ?? "") }))
  );
}

/**
 * Import a pasted CSV/TSV block into a type's store. FormData-shaped so the
 * paste form works without client JS; the server RE-PARSES the raw text (the
 * client preview is advisory only) and writes via the ported stores, then
 * redirects back into the flow's "done" step with the result counts encoded
 * in the URL. Importing is admin-only (prototype gated on canManageUsers).
 * Anything invalid redirects back with an `err=` param (same query-param
 * idiom as the success path's `r=`) so the page can render the failure
 * instead of silently doing nothing.
 *
 * The `catalog` type additionally: refuses text over 1 MB (#134), runs the
 * wrong-manufacturer guard per manufacturer in the file and normalizes each
 * group to its existing spelling (#132), stamps the form's effective date on
 * rows whose price changes and records it as each manufacturer's price-list
 * date once rows were written (#133, D156).
 */
export async function importRecords(formData: FormData): Promise<void> {
  await requirePerm("manage_users");
  const key = String(formData.get("type") || "");
  const text = String(formData.get("text") || "");
  const modeRaw = String(formData.get("mode") || "skip");
  const mode: ImportMode = modeRaw === "update" || modeRaw === "create" ? modeRaw : "skip";

  const type = getTypeMeta(key);
  const backTo = type ? `/import?tab=import&type=${encodeURIComponent(key)}` : `/import?tab=import`;

  if (!type) {
    redirect(`${backTo}&err=${encodeURIComponent("Unknown import type.")}`);
  }
  if (!text.trim()) {
    redirect(`${backTo}&err=${encodeURIComponent("Paste rows before importing.")}`);
  }
  if (key === "catalog") {
    const size = checkSize(Buffer.byteLength(text, "utf8"));
    if (!size.ok) redirect(`${backTo}&err=${encodeURIComponent(size.error)}`);
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    redirect(`${backTo}&err=${encodeURIComponent(parsed.error || "Couldn’t read that as a CSV.")}`);
  }

  const mapping = autoMap(parsed.headers, type.fields);
  const prepared = prepareRows(parsed.rows, mapping, type.fields);
  let rows = prepared.rows;
  let checks: GroupCheck[] = [];
  const effectiveAt = parseEffectiveDate(String(formData.get("effectiveDate") || ""), Date.now());

  if (key === "catalog") {
    checks = checkManufacturerGroups(catalogGroups(rows), await listCatalog());
    const bad = checks.find((c) => !c.result.ok);
    if (bad) redirect(`${backTo}&err=${encodeURIComponent(guardMessage(bad))}`);
    const spelling = new Map(checks.map((c) => [mfrKey(c.mfr), c.result.ok ? c.result.normalizedMfr : c.mfr]));
    rows = rows.map((r) => {
      if (!r.valid) return r;
      const mfr = String(r.values.mfr ?? "");
      return { ...r, values: { ...r.values, mfr: spelling.get(mfrKey(mfr)) ?? mfr } };
    });
  }

  const res = await commitImport(key, rows, mode, { effectiveAt });

  // "skip" never compares prices, so it confirms nothing; update/create do
  // once at least one row was written.
  if (key === "catalog" && res.created + res.updated > 0) {
    for (const c of checks) {
      if (c.result.ok) await setPriceListEffective(mfrKey(c.result.normalizedMfr), effectiveAt);
    }
  }

  revalidatePath("/", "layout");
  const r = [res.created, res.updated, res.skipped, res.errored, res.total].join(".");
  redirect(`/import?tab=import&type=${encodeURIComponent(key)}&r=${r}`);
}

/**
 * #132 — the preview's guard: the client sends one {mfr, skus} group per
 * manufacturer in the pasted table and shows the failures before commit
 * (the catalog is ~10k rows, too big to ship to the browser for a local
 * check). importRecords re-runs the same guard authoritatively.
 */
export async function checkCatalogImportAction(groups: ManufacturerGroup[]): Promise<GroupCheck[]> {
  await requirePerm("manage_users");
  const clean: ManufacturerGroup[] = (Array.isArray(groups) ? groups : []).slice(0, 100).map((g) => ({
    mfr: String(g?.mfr ?? "").slice(0, 200),
    skus: (Array.isArray(g?.skus) ? g.skus : []).slice(0, 20000).map((s) => String(s ?? "").slice(0, 200)),
  }));
  if (!clean.length) return [];
  return checkManufacturerGroups(clean, await listCatalog());
}
```

`src/app/(app)/import/controls.tsx`:

(a) Imports (lines 1–5 become):

```tsx
"use client";

import { useEffect, useState } from "react";
import { checkSize, groupRowsByManufacturer, type GroupCheck } from "@/lib/catalog-import-guard";
import { autoMap, parseCsv, prepareRows, type FieldDef } from "./parse";
import { checkCatalogImportAction, importRecords } from "./actions";

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 8,
};
const errorBox: React.CSSProperties = {
  marginTop: 12,
  background: "#f9ece8",
  border: "1px solid #f0d6cd",
  borderRadius: 9,
  padding: "10px 12px",
  fontSize: 12,
  color: "#a0442b",
  lineHeight: 1.45,
};
```

(b) Props, state and derived values (lines 15–46 become):

```tsx
export function PastePreview({
  typeKey,
  fields,
  dedupeLabel,
  accent,
  today,
}: {
  typeKey: string;
  fields: FieldDef[];
  dedupeLabel: string;
  accent: string;
  /** Local YYYY-MM-DD from the server — the catalog type's effective-date default. */
  today: string;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [guard, setGuard] = useState<GroupCheck[] | null>(null);

  const isCatalog = typeKey === "catalog";
  const trimmed = text.trim();
  const parsed = trimmed ? parseCsv(text) : null;
  const mapping = parsed && parsed.ok ? autoMap(parsed.headers, fields) : null;
  const prep = parsed && parsed.ok && mapping ? prepareRows(parsed.rows, mapping, fields) : null;

  const mappedFields = mapping
    ? fields.filter((f) => mapping[f.key] != null && mapping[f.key] >= 0)
    : [];
  const reqMissing = mapping
    ? fields.filter((f) => f.required && !(mapping[f.key] >= 0)).map((f) => f.label)
    : [];
  const previewFields = (mappedFields.length ? mappedFields : fields.slice(0, 3)).slice(0, 4);
  const previewRows = (prep?.rows || []).slice(0, 5);

  // #134 — the catalog type is capped at 1 MB of pasted/converted text.
  const size = isCatalog ? checkSize(new TextEncoder().encode(text).length) : ({ ok: true } as const);
  // #132 — wrong-manufacturer findings from the server-side preview check.
  const guardFailures = (guard || []).filter((g) => !g.result.ok);

  const canImport = !!prep && prep.stats.valid > 0 && reqMissing.length === 0 && size.ok && guardFailures.length === 0;

  /* #132 — debounce the pasted table into {mfr, skus} groups and ask the
     server whether each manufacturer checks out; the same guard runs again
     on commit, this is the early warning. */
  useEffect(() => {
    if (!isCatalog || !trimmed) {
      setGuard(null);
      return;
    }
    const timer = setTimeout(() => {
      const p = parseCsv(text);
      if (!p.ok) return;
      const pr = prepareRows(p.rows, autoMap(p.headers, fields), fields);
      const groups = groupRowsByManufacturer(
        pr.rows.filter((r) => r.valid).map((r) => ({ mfr: String(r.values.mfr ?? ""), sku: String(r.values.sku ?? "") }))
      );
      if (!groups.length) {
        setGuard(null);
        return;
      }
      checkCatalogImportAction(groups)
        .then(setGuard)
        .catch(() => setGuard(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [text, trimmed, isCatalog, fields]);
```

(c) `onFile` (lines 59–86) becomes:

```tsx
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file) return;
    if (isCatalog) {
      // #134 — refuse over-size workbooks here, before any upload.
      const fileSize = checkSize(file.size);
      if (!fileSize.ok) {
        setUploadErr(fileSize.error);
        setUploadNote("");
        return;
      }
    }
    setUploading(true);
    setUploadErr("");
    setUploadNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", typeKey);
      const res = await fetch("/api/import/xlsx", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; csv: string; rows: number; sheetName: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setUploadErr(data.error);
        return;
      }
      setText(data.csv);
      setUploadNote(
        `Read ${data.rows} row${data.rows === 1 ? "" : "s"} from “${data.sheetName}” in ${file.name}. Check the preview below before importing.`
      );
    } catch {
      setUploadErr("That upload didn’t go through. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }
```

(d) After the `reqMissing` box (its closing `)}` at line 219) add the size and guard boxes:

```tsx
      {!size.ok && <div style={errorBox}>{size.error}</div>}
      {guardFailures.length > 0 && (
        <div style={errorBox}>
          {guardFailures.map((g) => (
            <div key={g.mfr || "(blank)"}>
              <b>{g.mfr || "No manufacturer"}</b> — {g.result.ok ? "" : g.result.detail}
            </div>
          ))}
        </div>
      )}
```

(e) Before the `{/* dedupe mode */}` comment (line 221) add the catalog-only effective date:

```tsx
      {/* #133 — the price list's effective date (catalog only) */}
      {isCatalog && (
        <div style={{ marginTop: 16 }}>
          <div style={sectionLabel}>Price list effective</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
              type="date"
              name="effectiveDate"
              defaultValue={today}
              style={{
                border: "1px solid #e4e7ec",
                borderRadius: 9,
                padding: "8px 11px",
                fontSize: 12.5,
                fontFamily: "var(--font-ui)",
                color: "#16181d",
                background: "#fff",
              }}
            />
            <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
              Defaults to today. Stamped on every part whose price changes.
            </span>
          </div>
        </div>
      )}
```

`src/app/(app)/import/page.tsx` — add `import { isoDateOf } from "@/lib/catalog-books";` to the imports and make the mount (lines 697–702):

```tsx
                <PastePreview
                  typeKey={type.key}
                  fields={type.fields}
                  dedupeLabel={type.dedupeLabel}
                  accent="var(--accent)"
                  today={isoDateOf(Date.now())}
                />
```

Replace `src/app/api/import/xlsx/route.ts` entirely:

```ts
import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/session";
import { xlsxToCsv } from "@/lib/import/xlsx-to-csv";
import { checkSize } from "@/lib/catalog-import-guard";

/**
 * .xlsx upload → CSV text (punch #81). Converts only; writes nothing. The
 * client drops the returned CSV into the import hub's existing textarea, so
 * preview, mapping and the authoritative re-parse in importRecords all run
 * unchanged.
 *
 * Gated on the same manage_users permission as importRecords — it must not
 * be an open file-parsing endpoint even though it persists nothing.
 *
 * Size: the `catalog` type is capped at 1 MB (punch #134, same check as the
 * Catalog page importer); every other type keeps the 10 MB cap. The client
 * posts `type` alongside the file.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  await requirePerm("manage_users");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  const type = String(form.get("type") || "");
  if (type === "catalog") {
    const size = checkSize(file.size);
    if (!size.ok) return NextResponse.json({ ok: false, error: size.error }, { status: 413 });
  } else if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That file is larger than 10 MB. Split it, or export the sheet as CSV." },
      { status: 413 }
    );
  }

  const res = await xlsxToCsv(await file.arrayBuffer());
  if (!res.ok) return NextResponse.json(res, { status: 422 });

  return NextResponse.json(res);
}
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#132|#81|ALL PASSED'` → all PASS (the three `#81` `catalogPatch` fixtures without a Manufacturer column still pass: they only read `.values`); `npm run test:review:regressions 2>&1 | tail -3` → passes; `npx tsc --noEmit -p . | tail -3`; `npx eslint "src/app/(app)/import" src/app/api/import/xlsx/route.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/import/types.ts" "src/app/(app)/import/registry.ts" "src/app/(app)/import/actions.ts" "src/app/(app)/import/controls.tsx" "src/app/(app)/import/page.tsx" src/app/api/import/xlsx/route.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(import): catalog type — manufacturer required per row, guard in preview + commit, effective date, 1 MB on paste + xlsx (#132, #133, #134 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Catalog banner + Home card states + per-line date in the edit modal

**Files:**
- Create: `src/app/(app)/catalog/price-date-banner.tsx`
- Modify: `src/app/(app)/home-catalog.tsx` (whole file, 124 lines)
- Modify: `src/app/(app)/page.tsx:179`
- Modify: `src/app/(app)/catalog/page.tsx:1-11` (imports), after `:82` (books), after `:218` (mount), `:424-431` (modal mount), `:526-538` (modal props), after `:667` (price date line)
- Test: covered by Task 1's `priceBooks` specs; `/catalog` and `/` are already in `scripts/smoke-routes.ts` (the controller runs smoke).

**Interfaces:**
- Consumes: `priceBooks`, `PriceBookRow`, `effectivePriceDate`, `isoDateOf`, `parseEffectiveDate` (Task 1); `setPriceListEffectiveAction` (Task 2); `dateYear` from `src/lib/format.ts`.
- Produces: `PriceDateBanner({ books: BannerBook[] })` where `BannerBook = PriceBookRow & { href: string }` (the manufacturer facet link built by the page's `hrefFor`); `HomeCatalog({ books: PriceBookRow[]; partCount })`.

- [ ] **Step 1: Replace `src/app/(app)/home-catalog.tsx` entirely**

```tsx
import Link from "next/link";
import type { PriceBookRow } from "@/lib/catalog-books";
import { dateYear } from "@/lib/format";
import { CardHeadTitle } from "./home-shared";

/**
 * Catalog glance card — parts count + price-book breakdown (PUNCHLIST #14,
 * #133). Port of Home.dc.html's catalog widget; books come from
 * priceBooks() in lib/catalog-books (pure), fed by the real catalog store
 * and the manufacturer-level price-list dates in settings (page.tsx does
 * that one data-prep step). Three pill states: an age ("3d ago") when the
 * book is fully dated and current, Outdated (oldest effective date is 18+
 * months old) and Unknown (some part has no effective date at all).
 */

const DAY = 86400000;

/** "3d ago" / "1d ago" / "today" */
function ageLabel(ageDays: number): string {
  if (ageDays <= 0) return "today";
  if (ageDays === 1) return "1d ago";
  return `${ageDays}d ago`;
}

const PILL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  borderRadius: 999,
  padding: "3px 8px",
  fontFamily: "var(--font-mono)",
  flexShrink: 0,
};

function BookPill({ book, now }: { book: PriceBookRow; now: number }) {
  if (book.unknown) {
    return (
      <span
        style={{ ...PILL, color: "#8c919c", background: "#f1f2f5", border: "1px dashed #d5d9e0" }}
        title="No effective price-list date — set one on the Catalog screen"
      >
        Unknown
      </span>
    );
  }
  if (book.outdated) {
    return (
      <span
        style={{ ...PILL, color: "#b4543a", background: "#f7e9e5" }}
        title={`Oldest effective price date: ${dateYear(book.effectiveAt)} — over 18 months old`}
      >
        Outdated
      </span>
    );
  }
  const days = Math.floor((now - (book.effectiveAt ?? now)) / DAY);
  return (
    <span
      style={{ ...PILL, color: "#9aa0ab", background: "#f1f2f5" }}
      title={`Oldest effective price date in this price book: ${dateYear(book.effectiveAt)}`}
    >
      {ageLabel(days)}
    </span>
  );
}

export default function HomeCatalog({
  books,
  partCount,
}: {
  books: PriceBookRow[];
  partCount: number;
}) {
  const now = Date.now();
  return (
    <div className="pk-card" style={{ padding: "16px 17px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 13,
        }}
      >
        <CardHeadTitle>Catalog</CardHeadTitle>
        <Link
          href="/catalog"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          Manage →
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 23, fontWeight: 600 }}>
          {partCount}
        </span>
        <span style={{ fontSize: 12.5, color: "#8c919c" }}>
          parts · {books.length} price book{books.length === 1 ? "" : "s"}
        </span>
      </div>
      {books.map((b) => (
        <div
          key={b.key || "unbranded"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 0",
            borderTop: "1px solid #f3f4f7",
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "#f1f2f5",
              color: "#3a3f4a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}
          >
            {b.mono}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.name}</div>
            <div style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>
              {b.count} parts
            </div>
          </div>
          <BookPill book={b} now={now} />
        </div>
      ))}
      {books.length === 0 && (
        <div style={{ padding: "14px 0 4px", fontSize: 12, color: "#9aa0ab" }}>
          No parts yet — import a price book from the Catalog screen.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `src/app/(app)/page.tsx` line 179** becomes:

```ts
  const books = priceBooks(catalogParts, appSettings);
```

- [ ] **Step 3: Create `src/app/(app)/catalog/price-date-banner.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { isoDateOf, parseEffectiveDate, type PriceBookRow } from "@/lib/catalog-books";
import { dateYear } from "@/lib/format";
import { setPriceListEffectiveAction } from "./actions";

export type BannerBook = PriceBookRow & {
  /** The manufacturer facet link, built by the page with its hrefFor(). */
  href: string;
};

/**
 * #133 — "price lists to check": manufacturers whose oldest effective price
 * date is 18+ months old, or that have no date at all. Each row's date input
 * writes settings.priceListEffective[key] — the manufacturer-level date that
 * dates every part of that book which has no newer price date of its own —
 * and the page re-renders without the row once the book is current. The
 * name applies the manufacturer facet filter.
 */
export function PriceDateBanner({ books }: { books: BannerBook[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!books.length) return null;
  const outdated = books.filter((b) => b.outdated).length;
  const unknown = books.length - outdated;

  const setDate = (book: BannerBook, iso: string) => {
    if (!iso) return;
    start(async () => {
      setError(null);
      const r = await setPriceListEffectiveAction(book.name, parseEffectiveDate(iso, Date.now()));
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div style={{ background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#7a5f18" }}>
        Price lists to check — {outdated} outdated (over 18 months)
        {unknown ? `, ${unknown} without a date` : ""}. Set the date each list is effective, or import the current list.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {books.map((b) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
            <Link href={b.href} scroll={false} style={{ fontWeight: 600, color: "#5b4a12", textDecoration: "none" }}>
              {b.name}
            </Link>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8a6d1f" }}>{b.count} parts</span>
            <span style={pill(b.outdated)}>{b.outdated ? `Outdated · effective ${dateYear(b.effectiveAt)}` : "No date"}</span>
            <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#7a5f18" }}>
              Price list effective
              <input
                type="date"
                defaultValue={b.effectiveAt ? isoDateOf(b.effectiveAt) : ""}
                disabled={pending}
                onChange={(e) => setDate(b, e.target.value)}
                style={{
                  border: "1px solid #e4d9b8",
                  borderRadius: 7,
                  padding: "5px 8px",
                  fontSize: 12,
                  fontFamily: "var(--font-ui)",
                  color: "#16181d",
                  background: "#fff",
                }}
              />
            </label>
          </div>
        ))}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 11.5, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}

function pill(outdated: boolean): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 999,
    padding: "2px 8px",
    fontFamily: "var(--font-mono)",
    ...(outdated
      ? { color: "#b4543a", background: "#f7e9e5", border: "1px solid #f0d6cd" }
      : { color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec" }),
  };
}
```

- [ ] **Step 4: `src/app/(app)/catalog/page.tsx`**

Imports (lines 1–11) become:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getSettings } from "@/lib/settings";
import { list, get, type CatalogPart } from "@/lib/stores/catalog";
import { dateYear, money } from "@/lib/format";
import { effectivePriceDate, isoDateOf, priceBooks } from "@/lib/catalog-books";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { CatalogControls, CatalogImportPanel, PartDatasheetControl } from "./controls";
import CatalogDangerZone from "./catalog-danger-zone";
import { TaxonomyCard } from "./taxonomy-card";
import { PriceDateBanner } from "./price-date-banner";
import { upsertPart } from "./actions";
```

After `hrefFor` (after line 82) add:

```tsx
  /* ---- #133 price-list dates: outdated / undated manufacturers ---- */
  const books = priceBooks(parts, settings, { limit: Infinity });
  const flaggedBooks = books
    .filter((b) => b.key && (b.outdated || b.unknown)) // Unbranded has no key: nothing to date
    .map((b) => ({ ...b, href: hrefFor({ mfr: b.name }) }));
```

After the `importError` banner (after line 218, before `<div className={"ct-body" …}>`) add:

```tsx
      {flaggedBooks.length > 0 && <PriceDateBanner books={flaggedBooks} />}
```

Modal mount (lines 424–431) becomes:

```tsx
      {showForm && (
        <PartFormModal
          part={editingPart}
          priceDate={editingPart ? effectivePriceDate(editingPart, settings) : null}
          categories={categories}
          manufacturers={manufacturers.filter((m) => m !== UNSPEC)}
          isAdmin={isAdmin}
        />
      )}
```

`PartFormModal` props (lines 526–538) become:

```tsx
function PartFormModal({
  part,
  priceDate,
  categories,
  manufacturers,
  isAdmin,
}: {
  part: CatalogPart | null;
  /** #133 — the part's effective price date (own pricedAt or the manufacturer's book date), null when undated. */
  priceDate: number | null;
  categories: string[];
  manufacturers: string[];
  /** Datasheet attach/replace/remove (punch #39, Task 5) is admin-gated —
   *  same convention as the Categories & trades card. */
  isAdmin: boolean;
}) {
```

After the list/cost grid's closing `</div>` (line 667) add:

```tsx
            {editing && (
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: -7, marginBottom: 13 }}>
                {priceDate
                  ? `Price effective ${dateYear(priceDate)} — moves when the list price or cost changes.`
                  : "No price date yet — a price change here, an import, or the manufacturer's price-list date on the Catalog banner sets one."}
              </div>
            )}
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx tsx scripts/test-review-and-spec.ts | grep -E 'ALL PASSED|FAILED'` → `ALL PASSED`; `npx eslint "src/app/(app)/home-catalog.tsx" "src/app/(app)/page.tsx" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/price-date-banner.tsx"` → clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/home-catalog.tsx" "src/app/(app)/page.tsx" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/price-date-banner.tsx"
git commit -m "feat(catalog): 18-month outdated banner with inline effective dates on /catalog; Outdated/Unknown states on the Home card; per-line price date in the edit modal (#133 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Subassemblies resolve live + "prices as of" on both builders' data

**Files:**
- Modify: `src/lib/fixture-assemblies.ts:1` (imports), append after line 96
- Modify: `src/lib/stores/subassemblies.ts:3-22` (type)
- Modify: `src/app/(app)/design/subassemblies/actions.ts` (whole file, 59 lines)
- Modify: `src/app/(app)/design/subassemblies/subassemblies-client.tsx:1-8` (imports), `:36-48` (props + draft), `:89-93` (combined cost footer), `:98-102` (saved list)
- Modify: `src/app/(app)/design/subassemblies/page.tsx:15` (pass `priceListEffective` — this page is replaced by a redirect in Task 8; the one-line change keeps this task compiling on its own)
- Test: `scripts/test-review-and-spec.ts` (new top-level block after the Task 3 block)

**Interfaces:**
- Consumes: `effectivePriceDate`, `PriceDateSettings` (Task 1); `list as listCatalog` from `src/lib/stores/catalog.ts`; `getSettings`; existing `create`/`save`/`remove` in `src/lib/stores/subassemblies.ts`.
- Produces (in `src/lib/fixture-assemblies.ts`):
```ts
export const FIXTURE_OPTION_CATEGORIES: readonly FixtureOptionCategory[];
export function pricesAsOf(skus: string[], catalog: Array<{ sku: string; mfr?: string; pricedAt?: number }>, settings?: PriceDateSettings): number | null;
export type SubassemblyInput = { lightEngineSku: string; lensSku: string; options?: Partial<Record<FixtureOptionCategory, Array<{ sku: string; qty: number }>>> };
export type ResolvedSubassemblyPart = { sku: string; name: string; cost: number; found: boolean };
export type ResolvedSubassemblyOption = ResolvedSubassemblyPart & { qty: number };
export type ResolvedSubassembly = { lightEngine: ResolvedSubassemblyPart; lens: ResolvedSubassemblyPart; options: Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>; optionsCost: number; cost: number; price: number; missing: string[]; pricesAsOf: number | null };
export function resolveSubassembly(sub: SubassemblyInput, catalog: Array<Pick<CatalogPart, "sku" | "desc" | "cost"> & { mfr?: string; pricedAt?: number }>, settings?: PriceDateSettings): ResolvedSubassembly;
```
  and `FixtureSubassembly.snapshot?: { cost: number; price: number; pricedAt: number | null }`; `SubassembliesClient` gains a required `priceListEffective: Record<string, number>` prop.

- [ ] **Step 1: Write the failing spec tests** — add after the Task 3 block:

```ts
/* --- #129: subassemblies resolve live --- pure */
import { pricesAsOf, resolveSubassembly } from "@/lib/fixture-assemblies";

{
  const now = Date.now();
  const DAY = 86400000;
  const T0 = now - 300 * DAY;
  const T1 = now - 30 * DAY;
  const T2 = now - 3 * DAY;
  const subCatalog = [
    { sku: "ENG-1", desc: "Light engine", cost: 1000, mfr: "ETC", pricedAt: T1 },
    { sku: "LENS-1", desc: "Lens tube", cost: 200, mfr: "ETC", pricedAt: T2 },
    { sku: "CLAMP-1", desc: "C-clamp", cost: 25, mfr: "Acme" },
    { sku: "DMX-1", desc: "DMX 10ft", cost: 12, mfr: "Acme" },
  ];
  const settings = { priceListEffective: { acme: T0 } };
  const r = resolveSubassembly(
    { lightEngineSku: "ENG-1", lensSku: "LENS-1", options: { mounting: [{ sku: "CLAMP-1", qty: 2 }], data: [{ sku: "DMX-1", qty: 1 }] } },
    subCatalog,
    settings
  );
  ok(r.cost === 1000 + 200 + 2 * 25 + 12, "#129 resolveSubassembly: cost = engine + lens + Σ option cost × qty (the legacy save-time formula)");
  ok(r.price === r.cost, "#129 resolveSubassembly: price equals cost, as saveFixtureAction stored it");
  ok(r.optionsCost === 62 && r.options.mounting[0].qty === 2 && r.options.mounting[0].cost === 25, "#129 resolveSubassembly: options carry qty and the live unit cost");
  ok(r.lightEngine.name === "Light engine" && r.lens.found && r.options.power.length === 0 && r.options.accessories.length === 0, "#129 resolveSubassembly: names come from the catalog; absent categories resolve to []");
  ok(r.pricesAsOf === T2 && r.missing.length === 0, "#129 resolveSubassembly: prices as of = the NEWEST effective date among its parts");
  const gone = resolveSubassembly({ lightEngineSku: "ENG-1", lensSku: "NOPE", options: { accessories: [{ sku: "GONE", qty: 1 }] } }, subCatalog, settings);
  ok(!gone.lens.found && gone.lens.cost === 0 && gone.missing.join(",") === "NOPE,GONE", "#129 resolveSubassembly: missing parts price at 0 and are listed");
  ok(pricesAsOf(["CLAMP-1", "DMX-1"], subCatalog, settings) === T0, "#129 pricesAsOf: undated parts fall back to the manufacturer's book date");
  ok(pricesAsOf(["CLAMP-1"], subCatalog) === null, "#129 pricesAsOf: no date anywhere → null");
  ok(pricesAsOf([], subCatalog, settings) === null, "#129 pricesAsOf: no parts → null");
}
```

- [ ] **Step 2: Run it, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `pricesAsOf`/`resolveSubassembly` not exported.

- [ ] **Step 3: Implement**

`src/lib/fixture-assemblies.ts` line 1 becomes:

```ts
import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureOptionCategory } from "@/lib/stores/subassemblies";
import { effectivePriceDate, type PriceDateSettings } from "./catalog-books";
```

(Both `@/lib/stores/*` imports are type-only and erased at build time — this module stays client-safe, as it already is for the estimator client.)

Append after `assemblyDescription` (line 96):

```ts
/* ---- #129 — subassemblies resolve live, like assemblies ------------------ */

export const FIXTURE_OPTION_CATEGORIES: readonly FixtureOptionCategory[] = ["data", "power", "mounting", "accessories"];

/** "Prices as of": the NEWEST effective price date among the given SKUs
 *  (own pricedAt or the manufacturer's book date), null when none is dated. */
export function pricesAsOf(
  skus: string[],
  catalog: Array<{ sku: string; mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): number | null {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  let newest: number | null = null;
  for (const sku of skus) {
    const part = bySku.get(sku);
    if (!part) continue;
    const at = effectivePriceDate(part, settings);
    if (at != null && (newest == null || at > newest)) newest = at;
  }
  return newest;
}

export type SubassemblyInput = {
  lightEngineSku: string;
  lensSku: string;
  /** Categories may be absent on older records and on the builder's draft. */
  options?: Partial<Record<FixtureOptionCategory, Array<{ sku: string; qty: number }>>>;
};

export type ResolvedSubassemblyPart = { sku: string; name: string; cost: number; found: boolean };
export type ResolvedSubassemblyOption = ResolvedSubassemblyPart & { qty: number };

export type ResolvedSubassembly = {
  lightEngine: ResolvedSubassemblyPart;
  lens: ResolvedSubassemblyPart;
  options: Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>;
  optionsCost: number;
  cost: number;
  /** Equals cost — the legacy save-time formula priced fixtures at cost. */
  price: number;
  /** SKUs no longer in the catalog (priced at 0 above). */
  missing: string[];
  pricesAsOf: number | null;
};

/**
 * Price a fixture subassembly from the CURRENT catalog — exactly the formula
 * saveFixtureAction used to freeze at save time (engine cost + lens cost +
 * Σ option cost × qty), so a price-list import re-prices every fixture at
 * once. The saved record keeps its build-time numbers as `snapshot`.
 */
export function resolveSubassembly(
  sub: SubassemblyInput,
  catalog: Array<Pick<CatalogPart, "sku" | "desc" | "cost"> & { mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): ResolvedSubassembly {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const missing: string[] = [];
  const partOf = (sku: string): ResolvedSubassemblyPart => {
    const p = bySku.get(sku);
    if (!p) {
      if (sku) missing.push(sku);
      return { sku, name: sku || "—", cost: 0, found: false };
    }
    return { sku: p.sku, name: p.desc, cost: Number(p.cost) || 0, found: true };
  };
  const lightEngine = partOf(sub.lightEngineSku);
  const lens = partOf(sub.lensSku);
  const options = { data: [], power: [], mounting: [], accessories: [] } as Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>;
  let optionsCost = 0;
  const skus = [sub.lightEngineSku, sub.lensSku];
  for (const category of FIXTURE_OPTION_CATEGORIES) {
    for (const o of sub.options?.[category] || []) {
      const qty = Math.max(1, Math.round(Number(o.qty) || 1));
      const part = partOf(o.sku);
      options[category].push({ ...part, qty });
      optionsCost += part.cost * qty;
      skus.push(o.sku);
    }
  }
  const cost = lightEngine.cost + lens.cost + optionsCost;
  return { lightEngine, lens, options, optionsCost, cost, price: cost, missing, pricesAsOf: pricesAsOf(skus, catalog, settings) };
}
```

`src/lib/stores/subassemblies.ts` — replace the `FixtureSubassembly` type (lines 3–22):

```ts
export type FixtureSubassembly = {
  id: string;
  kind: "fixture";
  label: string;
  description: string;
  lightEngineSku: string;
  lightEngineName: string;
  /** Build-time snapshot (#129). Live values come from resolveSubassembly. */
  lightEngineCost: number;
  lensSku: string;
  lensName: string;
  /** Build-time snapshot (#129). */
  lensCost: number;
  lamp?: string;
  position?: string;
  circuit?: string;
  options: Record<FixtureOptionCategory, FixtureCompatibleOption[]>;
  /** Build-time snapshot (#129) — kept so older readers and exports still
   *  see a number; the screen shows the live resolveSubassembly() value. */
  cost: number;
  price: number;
  /** #129 — "was $X when built": the numbers frozen at the last save and the
   *  newest effective price date among its parts at that moment. */
  snapshot?: { cost: number; price: number; pricedAt: number | null };
  createdAt: number;
  updatedAt: number;
};
```

Replace `src/app/(app)/design/subassemblies/actions.ts` entirely:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { FIXTURE_OPTION_CATEGORIES, resolveSubassembly } from "@/lib/fixture-assemblies";
import { create, remove, save, type FixtureOptionCategory, type FixtureSubassembly } from "@/lib/stores/subassemblies";

type Input = { id?: string | null; label: string; description: string; lightEngineSku: string; lensSku: string; lamp: string; position: string; circuit: string; options: Record<FixtureOptionCategory, { sku: string; qty: number }[]> };

/**
 * Save a fixture subassembly. Prices come from resolveSubassembly over the
 * live catalog (#129) — the same numbers the screen shows — and are kept on
 * the record only as the build-time `snapshot` (plus the legacy cost fields
 * older readers expect); every later read re-resolves.
 */
export async function saveFixtureAction(input: Input): Promise<{ ok: true; item: FixtureSubassembly } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const label = input.label.trim();
  const description = input.description.trim();
  if (!label) return { ok: false, error: "Add a label for the fixture." };
  if (!input.lightEngineSku || !input.lensSku) return { ok: false, error: "Select a light engine and a lens from the catalog." };

  const options = { data: [], power: [], mounting: [], accessories: [] } as Record<FixtureOptionCategory, { sku: string; qty: number }[]>;
  for (const category of FIXTURE_OPTION_CATEGORIES) {
    for (const selected of input.options?.[category] || []) {
      const sku = String(selected.sku || "").trim();
      if (sku) options[category].push({ sku, qty: Math.max(1, Math.round(Number(selected.qty) || 1)) });
    }
  }

  const [catalog, settings] = await Promise.all([listCatalog(), getSettings()]);
  const live = resolveSubassembly({ lightEngineSku: input.lightEngineSku, lensSku: input.lensSku, options }, catalog, settings);
  if (!live.lightEngine.found || !live.lens.found) return { ok: false, error: "One of the selected catalog parts is no longer available." };
  if (live.missing.length) return { ok: false, error: `A selected catalog item is no longer available (${live.missing.join(", ")}).` };

  const now = Date.now();
  const item: FixtureSubassembly = {
    id: input.id || `SA-${now.toString(36).toUpperCase()}`,
    kind: "fixture",
    label,
    description,
    lightEngineSku: live.lightEngine.sku,
    lightEngineName: live.lightEngine.name,
    lightEngineCost: live.lightEngine.cost,
    lensSku: live.lens.sku,
    lensName: live.lens.name,
    lensCost: live.lens.cost,
    lamp: input.lamp.trim(),
    position: input.position.trim(),
    circuit: input.circuit.trim(),
    options: {
      data: live.options.data.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
      power: live.options.power.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
      mounting: live.options.mounting.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
      accessories: live.options.accessories.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
    },
    cost: live.cost,
    price: live.price,
    snapshot: { cost: live.cost, price: live.price, pricedAt: live.pricesAsOf },
    createdAt: now,
    updatedAt: now,
  };
  const saved = input.id ? await save(item) : await create(item);
  revalidatePath("/design/assemblies");
  revalidatePath("/design/subassemblies");
  return { ok: true, item: saved };
}

export async function deleteSubassemblyAction(id: string): Promise<void> {
  await requirePerm("manage_users");
  await remove(id);
  revalidatePath("/design/assemblies");
  revalidatePath("/design/subassemblies");
}
```

`src/app/(app)/design/subassemblies/subassemblies-client.tsx`:

(a) Imports (lines 1–8) become:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureOptionCategory, FixtureSubassembly } from "@/lib/stores/subassemblies";
import { resolveSubassembly } from "@/lib/fixture-assemblies";
import { dateYear } from "@/lib/format";
import { deleteSubassemblyAction, saveFixtureAction } from "./actions";

const pricesNote = (at: number | null) => (at == null ? "prices as of: unknown" : `prices as of ${dateYear(at)}`);
```

(b) Component signature (line 36) becomes, and the two lines follow the `busy` state (after line 47):

```tsx
export default function SubassembliesClient({ parts, initial, priceListEffective }: { parts: CatalogPart[]; initial: FixtureSubassembly[]; priceListEffective: Record<string, number> }) {
```

```tsx
  const settings = { priceListEffective };
  /** #129 — live pricing for the form's current picks, the same resolver the saved list uses. */
  const draft = resolveSubassembly({ lightEngineSku, lensSku, options }, parts, settings);
```

(c) The combined-cost footer (lines 89–93, the `<div style={{ fontSize: 12.5, color: "#5b616e" }}>Combined cost: …</div>` block) becomes:

```tsx
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>
            Combined cost: <strong>{money(draft.cost)}</strong>
            <span style={{ marginLeft: 8, color: "#9aa0ab", fontSize: 11.5 }}>{pricesNote(draft.pricesAsOf)}</span>
          </div>
```

(d) The saved list (the `initial.map((item) => …)` expression on line 102) becomes:

```tsx
{initial.map((item) => {
  const live = resolveSubassembly(item, parts, settings);
  const was = item.snapshot?.price ?? item.price;
  return (
    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, alignItems: "center", padding: "12px 0", borderTop: "1px solid #eef0f3" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{item.label}</div>
        <div style={{ color: "#737985", fontSize: 12, marginTop: 4 }}>{item.description || "No description"}</div>
        <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 5 }}>{item.lightEngineName} + {item.lensName}</div>
        {live.missing.length > 0 && (
          <div style={{ color: "#a0442b", fontSize: 11.5, marginTop: 4 }}>
            {live.missing.length} part{live.missing.length === 1 ? "" : "s"} no longer in the catalog: {live.missing.join(", ")}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{money(live.price)}</div>
        <div style={{ color: "#9aa0ab", fontSize: 10.5 }}>live combined cost · {pricesNote(live.pricesAsOf)}</div>
        {Math.abs(was - live.price) >= 0.005 && (
          <div style={{ color: "#8a6d1f", fontSize: 10.5 }}>was {money(was)} when built ({dateYear(item.updatedAt)})</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => edit(item)} style={{ border: "1px solid #dfe2e8", borderRadius: 7, padding: "6px 9px", background: "#fff", color: "#3d424e", cursor: "pointer", fontSize: 11.5 }}>Edit</button>
        <button type="button" onClick={() => remove(item)} style={{ border: "1px solid #f0d6cd", borderRadius: 7, padding: "6px 9px", background: "#fff", color: "#a0442b", cursor: "pointer", fontSize: 11.5 }}>Delete</button>
      </div>
    </div>
  );
})}
```

`src/app/(app)/design/subassemblies/page.tsx` — line 12 loads settings too and line 15 passes the map (Task 8 replaces this page with a redirect; this keeps Task 7 compiling on its own):

```tsx
  const [parts, saved, settings] = await Promise.all([listCatalog(), listSubassemblies(), getSettings()]);
```
```tsx
      <SubassembliesClient parts={parts} initial={saved as FixtureSubassembly[]} priceListEffective={settings.priceListEffective || {}} />
```
with `import { getSettings } from "@/lib/settings";` added to its imports.

- [ ] **Step 4: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#129|ALL PASSED'` → all PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/fixture-assemblies.ts src/lib/stores/subassemblies.ts "src/app/(app)/design/subassemblies"` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fixture-assemblies.ts src/lib/stores/subassemblies.ts "src/app/(app)/design/subassemblies/actions.ts" "src/app/(app)/design/subassemblies/subassemblies-client.tsx" "src/app/(app)/design/subassemblies/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(design): subassemblies price from the live catalog with a build-time snapshot and a prices-as-of note (#129 §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: One Assembly Builder tab — `?tab=`, redirect, nav

**Files:**
- Create: `src/app/(app)/design/assemblies/tabs.tsx`
- Modify: `src/app/(app)/design/assemblies/page.tsx` (whole file, 11 lines)
- Modify: `src/app/(app)/design/assemblies/assembly-builder.tsx:1-4` (imports), `:31` (props), `:62-78` (page chrome → toolbar; note per assembly)
- Modify: `src/app/(app)/design/subassemblies/page.tsx` (whole file → redirect)
- Modify: `src/lib/design-routes.ts:44` (add the branch before `/design-studio`)
- Modify: `src/components/nav/nav-data.ts:96` (remove), `:108` (replace)
- Modify: `scripts/smoke-routes.ts:90` (add two routes after `/design/assemblies`)
- Test: `scripts/test-review-and-spec.ts:459-488` (nav block) + a `designRedirect` check after line 457

**Interfaces:**
- Consumes: `pricesAsOf`, `sanitizeFixtureAssemblies` (Task 7 / existing); `SubassembliesClient` with `priceListEffective` (Task 7); `designRedirect` from `src/lib/design-routes.ts`.
- Produces: `AssembliesTabs({ active: "assemblies" | "subassemblies" })` (server component, two `<Link>`s); `AssemblyBuilder({ initial, priceDates: Record<string, number | null> })`; `designRedirect("/design/subassemblies", {}) === "/design/assemblies?tab=subassemblies"`; `activeKeyFor("/design/assemblies") === activeKeyFor("/design/subassemblies") === "assemblies"`.

- [ ] **Step 1: Write the failing spec tests**

After line 457 (`designRedirect` checks) add:

```ts
ok(designRedirect("/design/subassemblies", {}) === "/design/assemblies?tab=subassemblies",
  "#130 /design/subassemblies redirects to the Subassemblies tab of the Assembly Builder");
```

In the nav block, replace `DESIGN_CHILDREN` (lines 481–484) and add two `activeKeyFor` checks after line 467:

```ts
ok(activeKeyFor("/design/assemblies") === "assemblies",
  "#130 /design/assemblies lights the Assembly Builder child");
ok(activeKeyFor("/design/subassemblies") === "assemblies",
  "#130 the old Subassemblies path lights the Assembly Builder child too");
```

```ts
/* "subassemblies" left the group when it became a tab of the Assembly
 * Builder (#130) — /design/subassemblies redirects there. */
const DESIGN_CHILDREN = [
  "designoverview", "engagements", "designs",
  "steel", "lineset", "assemblies", "motors", "fixtures",
];
```

- [ ] **Step 2: Run, expect failure** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#130|Design.s children|FAILED'` → three FAILs (redirect null, activeKeyFor `designoverview`/`subassemblies`, children mismatch).

- [ ] **Step 3: Implement**

`src/lib/design-routes.ts` — insert before `if (pathname === "/design-studio") return "/design";` (line 44):

```ts
  // Subassemblies became a tab of the Assembly Builder (#130).
  if (pathname === "/design/subassemblies") return "/design/assemblies?tab=subassemblies";
```

`src/components/nav/nav-data.ts` — delete line 96 (`{ key: "subassemblies", … }`) and replace line 108 with:

```ts
  // #130: both builders live on /design/assemblies (Subassemblies is a tab;
  // the old path redirects), so both light the Assembly Builder child.
  if (pathname.startsWith("/design/assemblies") || pathname.startsWith("/design/subassemblies")) return "assemblies";
```

Create `src/app/(app)/design/assemblies/tabs.tsx`:

```tsx
import Link from "next/link";

export type AssembliesTab = "assemblies" | "subassemblies";

/** #130 — the Assemblies | Subassemblies switch. A URL param (not client
 *  state) so deep links and the nav's active key keep working. */
export default function AssembliesTabs({ active }: { active: AssembliesTab }) {
  const tabs: Array<{ id: AssembliesTab; label: string; href: string }> = [
    { id: "assemblies", label: "Assemblies", href: "/design/assemblies" },
    { id: "subassemblies", label: "Subassemblies", href: "/design/assemblies?tab=subassemblies" },
  ];
  return (
    <div role="tablist" style={{ display: "inline-flex", background: "#f1f2f5", borderRadius: 9, padding: 3, marginBottom: 18 }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={on}
            scroll={false}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: 7,
              textDecoration: "none",
              background: on ? "#fff" : "transparent",
              color: on ? "#16181d" : "#8c919c",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
```

Replace `src/app/(app)/design/assemblies/page.tsx` entirely:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { list as listSubassemblies, type FixtureSubassembly } from "@/lib/stores/subassemblies";
import { pricesAsOf, sanitizeFixtureAssemblies } from "@/lib/fixture-assemblies";
import AssemblyBuilder from "./assembly-builder";
import AssembliesTabs from "./tabs";
import SubassembliesClient from "../subassemblies/subassemblies-client";

export const metadata = { title: "Assembly Builder — Quartzite-6" };
export const dynamic = "force-dynamic";

/** #130 — Assemblies and Subassemblies on one screen, switched by ?tab=. Only
 *  the active builder renders (the subassembly picker takes the whole
 *  catalog as props). Both price from the live catalog (#129). */
export default async function AssemblyBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabRaw === "subassemblies" ? "subassemblies" : "assemblies";
  const [settings, parts, saved] = await Promise.all([getSettings(), listCatalog(), listSubassemblies()]);
  const priceDates = Object.fromEntries(
    sanitizeFixtureAssemblies(settings.fixtureAssemblies).map((a) => [a.id, pricesAsOf(a.components.map((c) => c.sku), parts, settings)])
  );

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Design</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Assembly Builder</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 700 }}>
        Assemblies and fixture subassemblies both price from the live catalog — a price-list import re-prices them at once.
      </p>
      <AssembliesTabs active={tab} />
      {tab === "assemblies" ? (
        <AssemblyBuilder initial={settings.fixtureAssemblies || []} priceDates={priceDates} />
      ) : (
        <SubassembliesClient parts={parts} initial={saved as FixtureSubassembly[]} priceListEffective={settings.priceListEffective || {}} />
      )}
    </div>
  );
}
```

`src/app/(app)/design/assemblies/assembly-builder.tsx`:

(a) Imports (lines 1–4) become:

```tsx
"use client";

import { useState, useTransition } from "react";
import { dateYear } from "@/lib/format";
```

(`Link` is no longer used here — the page owns the back link.)

(b) Line 31 becomes:

```tsx
export default function AssemblyBuilder({ initial, priceDates }: { initial: FixtureAssembly[]; priceDates: Record<string, number | null> }) {
```

(c) Lines 62–78 (from `return (` through the assembly name row's closing `</div>`) become:

```tsx
  const pricesNote = (id: string) => {
    if (!(id in priceDates)) return "Prices resolve from the catalog once saved";
    const at = priceDates[id];
    return at == null ? "Prices as of: unknown — set price-list dates on the Catalog screen" : `Prices as of ${dateYear(at)}`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, margin: "0 0 16px", flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#707681", fontSize: 13, maxWidth: 640 }}>Build orderable fixtures from catalog parts. A default quantity of 0 keeps an item available without adding it automatically.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pk-btn" onClick={() => setAssemblies((all) => all.concat({ id: `fa-${Date.now().toString(36)}`, name: "New fixture assembly", components: [] }))}>+ New assembly</button>
          <button className="pk-btn pk-btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : saved ? "Saved" : "Save assemblies"}</button>
        </div>
      </div>
      {!assemblies.length && <div className="pk-card" style={{ padding: 28, color: "#777d88" }}>No sample assemblies are installed. Create the first assembly from your catalog.</div>}
      {assemblies.map((assembly) => (
        <section key={assembly.id} className="pk-card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input aria-label="Assembly name" value={assembly.name} onChange={(event) => patch(assembly.id, { name: event.target.value })} style={{ ...input, fontWeight: 650, fontSize: 15 }} />
            <button className="pk-btn" onClick={() => setAssemblies((all) => all.filter((item) => item.id !== assembly.id))}>Delete</button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#8c919c" }}>{pricesNote(assembly.id)}</div>
```

(the rest of the section — component rows, role sections, closing tags — is unchanged).

Replace `src/app/(app)/design/subassemblies/page.tsx` entirely:

```tsx
import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Subassemblies became a tab of the Assembly Builder (#130). Kept for
 *  bookmarks, the old nav key and deep links. */
export default function LegacySubassembliesPage() {
  redirect(designRedirect("/design/subassemblies", {})!);
}
```

`scripts/smoke-routes.ts` — after `"/design/assemblies",` (line 90) add:

```ts
  "/design/assemblies?tab=subassemblies",
  "/design/subassemblies", // #130 — redirect to the tab above; must stay 3xx
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#130|Design.s children|designoverview|ALL PASSED'` → all PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/design/assemblies" "src/app/(app)/design/subassemblies/page.tsx" src/components/nav/nav-data.ts src/lib/design-routes.ts` → clean. (The controller runs `npm run test:smoke` — expect `/design/assemblies`, `/design/assemblies?tab=subassemblies` 200 and `/design/subassemblies` 3xx.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/design/assemblies/tabs.tsx" "src/app/(app)/design/assemblies/page.tsx" "src/app/(app)/design/assemblies/assembly-builder.tsx" "src/app/(app)/design/subassemblies/page.tsx" src/lib/design-routes.ts src/components/nav/nav-data.ts scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): Assemblies + Subassemblies on one tab (?tab=), /design/subassemblies redirects, nav entry folded (#130 §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs — D156, D157, punch items closed

**Files:**
- Modify: `DECISIONS.md` (append D156 and D157 after D153, currently the last entry at line 3521)
- Modify: `PUNCHLIST.md:6075` (#129), `:6089` (#130), `:6114` (#132), `:6130` (#133), `:6147` (#134)

**Before committing, verify the numbers are still free on `main`:** `git fetch origin && git show origin/main:DECISIONS.md | grep -E '^## D15[4-9]'` — if D156 or D157 is already taken, use the next free numbers and update every `D156`/`D157` reference this plan introduced (`grep -rn 'D156\|D157' src scripts next.config.ts`).

- [ ] **Step 1: Append to `DECISIONS.md`**

```markdown
## D156. Catalog price dates: per-line `pricedAt`, a manufacturer-level "price list effective" date, and the 18-month outdated rule (#133, #129, 2026-09-21)

Jeff asked for per-line price dates, an editable 18-month "outdated" banner by manufacturer, and an
effective date on price lists (2026-09-21). Spec: `docs/superpowers/specs/2026-09-21-catalog-price-dates-and-assemblies-design.md`.

- **`CatalogPart.pricedAt` means "when this price last moved."** The store stamps it centrally in
  `upsert`/`mergeUpsert` (`lib/stores/catalog.ts`) ONLY when `list` or `cost` actually changes —
  importers pass the file's effective date, every other write stamps now. `updatedAt` keeps its
  last-write meaning. Parts that predate the field stay undated; nothing invents a date.
- **`settings.priceListEffective[mfrKey]` is the manufacturer's book date.** Set by the Catalog
  banner's inline date input (the one-time backfill) AND by both importers whenever an import writes
  rows (the file's effective date IS the list's effective date, and it confirms the unchanged rows
  too). The Import hub's "skip duplicates" mode compares nothing, so it confirms nothing.
- **A line's effective date is the LATER of its own `pricedAt` and the book date** (`effectivePriceDate`
  in `lib/catalog-books.ts`). The spec's wording calls the book date a "fallback"; the later-of rule
  is what makes the banner's edit actually clear an outdated book whose lines carry old `pricedAt`
  (a list confirmed on day D confirms every line on it, and a line re-priced after D keeps its own
  date). Yearly re-imports where most prices don't move therefore read as current.
- **A book is dated only when every part is; oldest wins.** `priceBooks()` returns `effectiveAt` =
  the oldest effective date when all parts have one, else `null` + `unknown: true` — #14 decision
  A carried forward: a single hand-edited SKU must not make a 2,000-row book read as fresh; an
  undated part is older than anything. `outdated` = dated and ≥ 548 days (18 months). The book date
  is the one-click way to date the remainder.
- **Surfaces:** Home card pill states (age / Outdated red / Unknown grey); a Catalog banner listing
  outdated + undated manufacturers, each with a date input and a facet link (Unbranded is excluded —
  there is no manufacturer to date); the part edit modal shows the line's effective date.
  Manufacturers group by `mfrKey` (lowercase alphanumerics — the importer's `norm`), so spellings
  merge; the display name is the most common stored spelling, and the banner link filters that
  spelling.
- **Subassemblies resolve live (#129)** through `resolveSubassembly()` (`lib/fixture-assemblies.ts`),
  the legacy save-time formula (engine + lens + Σ option cost × qty) over the current catalog. The
  record keeps `snapshot: { cost, price, pricedAt }` (and the legacy cost fields) for "was $X when
  built". Both builders show "prices as of" = the NEWEST effective date among their parts.
- No schema change; parts and settings are JSON documents. `bodySizeLimit` etc. — see D157.

## D157. Catalog import guards: manufacturer required, wrong-manufacturer double check, 1 MB cap (#132, #134, 2026-09-21)

- **Manufacturer is required on both importers.** Catalog page: the picker/new-name field won't
  submit empty and the server re-checks. Import hub: the `catalog` type's `mfr` field is
  `required`, so a row without one fails per-row validation (existing rendering) and is never written.
- **Guard order** (`checkManufacturer` in `lib/catalog-import-guard.ts`, pure): blank → `missing`;
  the name normalizes (`mfrKey`) to an existing manufacturer → that spelling is used; any file SKU
  filed under a different manufacturer → `foreign-skus` (checked first — it names exactly which rows
  are wrong, up to 10 examples + "+N more"); the manufacturer already has parts and the file overlaps
  none → `no-overlap` ("None of the N SKUs in this file belong to ‹mfr›"); a new manufacturer or any
  overlap → ok. SKUs compare case/punctuation-insensitively (the hub's dedupe `norm`). Unbranded
  parts are never foreign — importing them under a manufacturer is how they get one.
- **The Import hub runs the guard twice:** per manufacturer group in the preview through
  `checkCatalogImportAction` (the ~10k-row catalog is too big to ship to the browser for a local
  check), blocking the Import button on any failure, and authoritatively in `importRecords` before
  `commitImport`; groups are normalized to the existing spelling on commit. The Catalog page runs it
  in `runCatalogImport` before any upsert, so a rejected file writes nothing.
- **1 MB = 1,048,576 bytes**, checked (a) client-side on `file.size` before any upload and on the
  paste box's UTF-8 byte length, (b) in the Catalog page action (file or paste), (c) in `importRecords`
  for the catalog type, and (d) in `/api/import/xlsx` when the client posts `type=catalog` (10 MB stays
  for every other type). Failures surface through the existing `importError=` / `err=` banners.
- **`experimental.serverActions.bodySizeLimit = "1200kb"`** in `next.config.ts`: server actions
  default to a 1 MB request body, which multipart overhead pushes a ~1 MB file past, so Next would
  reject it with an opaque error before the app's check runs. The headroom makes the app's clear
  error win; anything larger still fails closed at Next's limit.
```

- [ ] **Step 2: Update `PUNCHLIST.md`** — change each heading and add a **Shipped:** paragraph directly under the heading (keep the existing Reported / What exists / Ask paragraphs):

```markdown
## 129. Assembly Builder: assemblies re-price when price lists update — DONE 2026-09-21 (D156)

**Shipped:** Subassemblies resolve live through `resolveSubassembly()` (`lib/fixture-assemblies.ts`),
the same engine + lens + options formula `saveFixtureAction` used to freeze; the record keeps a
build-time `snapshot` for "was $X when built". Both builders show "prices as of" (newest effective
price date among their parts). Assemblies were already live; no pricing change there.
```

```markdown
## 130. Assembly Builder + Subassemblies on one tab — DONE 2026-09-21 (D156)

**Shipped:** `/design/assemblies?tab=assemblies|subassemblies` renders either builder under a
two-link switch (URL param, so deep links and the nav key work); `/design/subassemblies` redirects
to the tab (`designRedirect`); the Subassemblies nav entry is gone and `activeKeyFor` maps both
paths to `assemblies`. Smoke covers both tab URLs and the redirect.
```

```markdown
## 132. Catalog import: mandatory manufacturer + wrong-manufacturer double check — DONE 2026-09-21 (D157)

**Shipped:** manufacturer required on both importers; a pure guard (`lib/catalog-import-guard.ts`
`checkManufacturer`) normalizes near-duplicate names to the existing spelling, rejects a file whose
SKUs are filed under another manufacturer (named, up to 10) or that overlaps none of an existing
manufacturer's parts, and accepts new manufacturers. Runs before any upsert on the Catalog page and
in the Import hub's preview (server action) + commit.
```

```markdown
## 133. Catalog: per-line price date, 18-month outdated banner by manufacturer, editable effective date — DONE 2026-09-21 (D156)

**Shipped:** `CatalogPart.pricedAt` stamped only on a price change; an effective-date field (default
today) on both importers; `settings.priceListEffective[mfrKey]` as the manufacturer's book date,
editable inline on the new `/catalog` banner (outdated ≥ 548 days + undated books, facet links); the
Home card shows Outdated / Unknown / age; the edit modal shows the line's effective date.
```

```markdown
## 134. Catalog import: 1 MB cap with a clear error — DONE 2026-09-21 (D157)

**Shipped:** `MAX_CATALOG_IMPORT_BYTES` (1,048,576) checked client-side on the file and the paste
box before upload, in the Catalog page action, in `importRecords` for the catalog type and in
`/api/import/xlsx` for `type=catalog` (10 MB kept for other types); failures go through the existing
`importError=` / `err=` banners. `serverActions.bodySizeLimit` raised to 1200 kB so the app's error
wins over Next's opaque body-limit rejection.
```

- [ ] **Step 3: Full gate, one at a time** — `npx tsc --noEmit -p .`, `npx eslint src scripts next.config.ts` (0 errors), `npx tsx scripts/test-review-and-spec.ts | tail -2` → `ALL PASSED`, `npm run test:review:regressions | tail -2`. Report the real numbers. (The controller runs `test:smoke` and the browser pass from the spec §5: banner shows an outdated manufacturer and editing its date clears it; wrong-manufacturer import rejected with the SKU list; a 2 MB CSV refused before upload; a light-engine price change updates the subassembly's shown price; the tab switch works.)

- [ ] **Step 4: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md
git commit -m "docs: D156 catalog price-date model + 18-month rule, D157 import guards; close #129 #130 #132 #133 #134

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**1. Spec coverage — section → task**

| Spec section | Task |
|---|---|
| §1 `pricedAt` set only on list/cost change, from the importer's effective date, default import day; other paths stamp now | Task 2 (`nextPricedAt` in the store), Task 4 + 5 (importers pass `effectiveAt`) |
| §1 `settings.priceListEffective` per-manufacturer, the backfill/edit affordance and fallback | Task 2 (field + `setPriceListEffective` + action), Task 6 (banner edit) |
| §1 `effectivePriceDate`, `OUTDATED_AFTER_MS` = 548 days, `isOutdated`, `mfrKey` = the importer's `norm` | Task 1 |
| §1 no schema change | all — JSON fields only |
| §2 `priceBooks()` → `count`, `effectiveAt` (oldest), `outdated`, `unknown` | Task 1 |
| §2 Home pill: same age pill + Outdated red + Unknown grey | Task 6 |
| §2 Catalog banner listing outdated + unknown with inline date inputs writing `setPriceListEffectiveAction(mfr, at)`; clicking a manufacturer applies the facet | Task 6 |
| §3 `catalog-import-guard.ts`: `checkManufacturer` (missing / normalized / no-overlap / foreign-skus ≤10 examples / new), `MAX_CATALOG_IMPORT_BYTES`, `checkSize` | Task 3 |
| §3 Catalog page: required manufacturer, server re-check, guard before any upsert, failures through `fail()` → `importError=`, effective date input default today applied as `pricedAt` | Task 4 |
| §3 Import hub: per-row `mfr` required with the existing per-row error, guard per manufacturer group in preview + blocks commit, "Effective date" option default today, 1 MB on paste and on xlsx for catalog only (10 MB others) | Task 5 |
| §3 client-side `file.size` check before upload | Task 4 (catalog page), Task 5 (hub xlsx) |
| §4 `resolveSubassembly(sub, catalog)` = legacy formula; `snapshot: { cost, price, pricedAt }`; consumers switch to resolved values; "prices as of" = newest effective date | Task 7 |
| §4 Assemblies: no pricing change, "prices as of" note on the builder | Task 8 (`priceDates` per assembly) |
| §4 one tab `?tab=`, `/design/subassemblies` redirect, nav entry dropped, `activeKeyFor` maps the old path | Task 8 |
| §5 `test:specs` list (precedence, 17/18/19 months, `mfrKey`, guard cases, `checkSize` boundary, `priceBooks` flags, `resolveSubassembly` = legacy formula) | Tasks 1, 3, 7 |
| §5 `test:review:regressions` (unchanged price leaves `pricedAt`; changed stamps; book date round-trip; over-size + wrong manufacturer rejected with the right error) | Tasks 2, 4, 5 (through `runCatalogImport`, the action's body — actions need a session) |
| §5 `test:smoke` routes | Task 8 (`/catalog`, `/design/assemblies` already listed) |
| §5 browser pass | Task 9 Step 3 (controller) |

Two deliberate readings of the spec are logged in D156 rather than silently taken: `effectivePriceDate` uses the later-of rule instead of `??` (the banner's edit must be able to clear an outdated book), and a book with a partially-dated part set reads `unknown` (the #14 decision-A honesty rule); importers also record the book date. Everything the spec lists is implemented; nothing is dropped.

**2. Placeholder scan** — no "TBD", "TODO", "add validation", "similar to Task N"; every step that changes code shows the code; every `Modify:` line carries the real line numbers read from the current files. The only forward reference is Task 2's import block for `catalog/actions.ts`, which explicitly says which two imports to add in Task 2 and that the rest lands in Task 4 (both tasks show the identical final block).

**3. Type/name consistency**

- `mfrKey`, `effectivePriceDate`, `nextPricedAt`, `parseEffectiveDate`, `isoDateOf`, `priceBooks`, `PriceBookRow`, `PriceDateSettings` — defined in Task 1, consumed with those exact names in Tasks 2, 4, 5, 6, 7.
- `UpsertOpts` / `mergeUpsert(sku, patch, opts)` / `upsert(part, opts)` — Task 2; used with `{ pricedAt }` in Tasks 4 and 5.
- `setPriceListEffective(key, at)` (settings) vs `setPriceListEffectiveAction(mfr, at)` (action) — Task 2; the action is what the banner (Task 6) calls; importers (Tasks 4, 5) call the settings helper with `mfrKey(...)`.
- `checkSize`, `checkManufacturer`, `groupRowsByManufacturer`, `checkManufacturerGroups`, `GroupCheck`, `ManufacturerGroup`, `MAX_CATALOG_IMPORT_BYTES` — Task 3; consumed in Tasks 4, 5 with those names. `GroupCheck = { mfr, count, result }` everywhere (the controls read `g.mfr`, `g.result`).
- `runCatalogImport` / `CatalogImportInput` / `CatalogImportResult` — Task 4; the regression test passes exactly `{ mfr, text, bytes, effectiveAt, defaultCategory }`.
- `CommitContext` / `commitImport(key, rows, mode, ctx)` — Task 5; the regression test passes `{ effectiveAt }`.
- `resolveSubassembly`, `pricesAsOf`, `FIXTURE_OPTION_CATEGORIES`, `ResolvedSubassembly.{cost, price, optionsCost, missing, pricesAsOf, lightEngine, lens, options}` — Task 7; consumed by the action, the client and Task 8's page with those names.
- `SubassembliesClient({ parts, initial, priceListEffective })`, `AssemblyBuilder({ initial, priceDates })`, `AssembliesTabs({ active })`, `CatalogImportPanel({ manufacturers, accent, today })`, `PastePreview({ …, today })`, `PriceDateBanner({ books })` — props match every mount site shown.
- Punch/decision numbers: D156 (price-date model, #129/#133), D157 (guards, #132/#134) — used consistently in code comments, tests and docs; Task 9 says to re-verify they are free on `main`.
