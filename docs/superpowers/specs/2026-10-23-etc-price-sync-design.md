# ETC price sync — design

**Date:** 2026-10-23 · **Asked by:** Jeff · **Punch item:** #368 (confirm the number at merge;
#367 is the markup-pricing spec on `feat/markup-pricing`)

## 1. Goal

The Catalog import drawer's **Connect a manufacturer** method is a placeholder ("Live dealer-account
pricing is on the roadmap", `src/app/(app)/catalog/controls.tsx`). It becomes a real ETC connection:
an admin pastes a MyETC API key, the app pulls ETC's dealer price lists, shows a preview, imports them
into the shared catalog, and then keeps ETC prices current every day. Sent estimates keep their
prices; a revision picks up today's prices.

## 2. ETC's API (read from my.etcconnect.com/api-docs, read-only, Oct 23)

- **Auth.** A MyETC business-account administrator generates an API key; its secret goes in
  `Authorization: Bearer <api_secret>`. The docs page states this for both versions.
- **v1** (`https://my.etcconnect.com/api/v1`) — `GET /me/business-accounts` lists the key's business
  accounts (`{ data: [{ id, name, roleId, roleName }] }`); the rest is orders / deliveries /
  documents. **No pricing.** Errors are `{ error: { code, message } }`.
- **v0** (`https://my.etcconnect.com/api/v0`) — the Pricing routes, all bearer-authenticated:
  - `GET /pricing/business-account/{id}/price-list/{list}` →
    `{ parts: PriceListPart[], categoryTree, repPricingCategories }`
  - `GET /pricing/business-account/{id}/price-updates/{date}/{list}` → `PriceListPart[]` changed
    since `date`
  - `{list}` ∈ `finished-goods` · `spare-parts` · `flat-rate-repair` · `demo-prices`
  - `PriceListPart` = `{ partNumber, modelNumber, description, shortDescription, hsCode,
    grossWeight, isRepPrice, weightUnit, countryOfOrigin, categoryIds[], categoryPaths[],
    listPrice, netPrice, distributorNetPrice, currency }` — **prices are decimal strings**
    (`"1040.00"`).
  - Errors are `{ traceId, message, code, details }`; 401 bad token, 403 "Must have access to feature".
- **Unverified until Jeff's first live run** (the docs don't say): whether v0 Pricing accepts an
  API-key secret (the page says it does), the `{date}` format (we send `YYYY-MM-DD`), list sizes,
  and rate limits. Every unknown fails loudly with ETC's own message, never silently.

## 3. Decisions (Jeff, Oct 23)

| # | Question | Answer |
|---|---|---|
| 1 | Which ETC price is our Cost? | **`netPrice`** → `cost`; **`listPrice`** → `list`. `distributorNetPrice` is ignored. |
| 2 | Which lists? | **All four.** Demo prices are **internal only, never customer-facing.** |
| 3 | ETC parts we don't have | **Preview, then add all** on a manual pull. |
| 4 | Refresh | **Daily, automatically** — but a **sent** estimate keeps its prices unless a revision is sent. |
| 5 | Revising a sent estimate | **Re-price on Revise.** |
| 6 | Other paths that re-price a sent estimate | **Lock until Revise.** |
| 7 | Daily sync finds new ETC parts | **Add them automatically.** |
| 8 | Where staff see the demo price | **Catalog part editor** only. |

## 4. The connection (key storage)

- One settings-free doc blob, `dealer_connections` (`src/lib/dealer-api/connections.ts`), keyed by
  provider (`etc`). Shape per provider: `{ keyEnc, last4, savedAt, savedBy, accountId, accountName,
  baseline: { date, at } | null, lastRun: RunSummary | null, cursor }`. The secret is encrypted
  with `encryptWith` (AES-256-GCM on `AUTH_SECRET`, same as `assist_secrets`, D881) and lives in its
  own `blobs` row so it never rides along with the settings object pages hand to clients.
- Nothing returns the plaintext to a caller that can serialise it; the drawer gets `last4` only.
  `etcSecret()` is the one function that decrypts, used only by the ETC client.
- **Admin-only** to save, replace, remove, test, pull, import. Anyone signed in sees the status
  line (connected account, last sync, counts, last error).
- **Test connection** calls v1 `/me/business-accounts`. One account → picked automatically;
  several → the admin picks one (stored as `accountId` + `accountName`). Saving a new key clears the
  picked account if the new key can't see it.
- A Vercel preview never uses the stored key (previews share the production DB, memory
  `project-vercel-preview-writes-production-db`) — the drawer says "ETC sync is off on preview
  deploys" and the cron rider skips there. `ETC_SYNC_DISABLED=true` turns off the cron rider and the
  drawer's Pull (kill switch, no other env var).

## 5. The ETC client (`src/lib/dealer-api/etc/`)

- `client.ts` — server only. Fixed host `https://my.etcconnect.com` (no user-supplied URL, so no
  SSRF surface), bearer header, 30 s per-request timeout, `cache: "no-store"`. Returns
  `{ ok: true, data } | { ok: false, status, message }` with ETC's own `message` (v0 or v1 envelope).
- `parse.ts` — pure. zod-validates `PriceListPart`, converts decimal strings to numbers (cents-safe:
  `Math.round(parseFloat(s) * 100) / 100`), drops a row with no `partNumber`, a non-USD `currency`,
  or an unparseable price (counted as `skipped` with a reason). Output `EtcRow =
  { list: ListKey, partNumber, modelNumber, desc, categoryPath, listPrice, netPrice }`.

## 6. Mapping onto the catalog (`src/lib/dealer-api/etc/plan.ts`, pure)

- **Matching** goes through the catalog's existing `importResolverFor` (#304) with `mfr: "ETC"`,
  `sku: partNumber`, `manufacturerPartNumber: partNumber` — the same resolution the CSV importer
  uses, so renamed / model-keyed ETC parts match by P/N. Unmatched rows are **new**.
- **Existing part, priced list** (finished goods, spare parts, flat-rate repair): writes `list`
  and `cost` only when the value moved (a missing/zero ETC price leaves ours alone), plus
  `manufacturerPartNumber` / `manufacturerModelNumber` only when ours is blank. Description and
  category are never overwritten.
- **New part, priced list:** `sku = partNumber`, `mfr = "ETC"`, `desc = description`,
  `manufacturerPartNumber`, `manufacturerModelNumber`, `unit = "ea"`, `list`, `cost`, and
  `category` = the first segment of ETC's first `categoryPath` (`"Fixtures > ArcSystem Pro >
  Accessories"` → `Fixtures`); spare parts with no path → `ETC spare parts`; flat-rate repair →
  `ETC repair`. A part in two priced lists takes the first in the order finished goods → spare parts →
  flat-rate repair.
- **Demo prices** never touch `list` or `cost`. They set `demoPrice` (the ETC demo `netPrice`) and
  `demoPricedAt` on a part that exists or is created in the same run; a demo-only part number that
  matches nothing is reported, not created.
- Every write goes through `mergeUpsert` with `{ pricedAt: today, priceDate: today }` (Chicago date)
  on rows whose price was confirmed, so the price-book age pills and the portal stale-cost rule see
  ETC as current.

### 6.1 `demoPrice` stays internal

`CatalogPart.demoPrice?: number | null` and `demoPricedAt?: number | null` (header comment: internal,
never customer-facing). Customer surfaces already whitelist fields (portal views, Displays v1
`publicCatalogPart`, client package manifest, CSV export) and must stay that way — the harness
asserts `demoPrice` appears in none of them. Three staff screens serialise whole `CatalogPart`s
(`catalog/page.tsx` → `SpecPanel`, `design/lineset/page.tsx` → `fabrics`, the D94 spec generator's
`matchBomAction` / `remapRowAction`); each gets `demoPrice`/`demoPricedAt` stripped so the value
only reaches the part editor's read-only "ETC demo price (internal)" line. The CSV export and
Assist's catalog tool don't add it.

## 7. Manual pull → preview → import (the drawer)

1. **Pull prices** (admin) fetches all four full lists, parses them, and stores a compact snapshot in
   the `etc_price_pull` blob (`{ pulledAt, accountId, rows, skipped }`, ~150 bytes a row). It
   returns the preview: per list — new parts, price changes, unchanged, skipped (with reasons), and
   the first 20 price changes as `old → new`. One list failing fails the pull with ETC's message.
2. **Import** applies the snapshot in resumable batches under a 40 s budget per call (the #304 /
   #294 pattern): the client loops while `done < total`, showing progress; a reload resumes from the
   stored cursor. A snapshot older than 24 h or for another account must be pulled again.
3. When the import finishes, `baseline = { date: today, at }` is set — this is what turns the daily
   sync on — and `lastRun` records the counts.

## 8. Daily sync

- A rider on the existing `/api/drive/sync` cron (11:00 UTC, its own try/catch, ≤ 20 s budget,
  never fails the drive sync) — no new `vercel.json` entry.
- It runs only when a key, an account and a `baseline` exist, not on a preview, not when
  `ETC_SYNC_DISABLED=true`. It calls `price-updates/{baseline.date}/{list}` for all four lists and
  applies the rows with the same plan as §6, **new parts included** (decision 7), in the same batch
  engine. When every row is applied, `baseline.date` moves to today; if the budget runs out, the
  cursor is kept and the next run (or a manual Import) finishes it before moving the date. A failure
  stores `lastRun.error` (shown in the drawer) and leaves the baseline alone, so nothing is skipped.

## 9. Sent estimates keep their prices

Every quote already stores absolute line prices, and a send freezes a revision (research Oct 23), so
a catalog price change never rewrites a sent quote by itself. Three staff actions re-price lines on
an existing estimate today with no status guard; they are **locked on a sent / won / lost estimate**
with "Revise the estimate first" (server-side refusal + disabled control with the same text):

- Copy / Move system **into an existing** estimate (`placeSystemInEstimate`, the target picker greys
  out non-draft targets) — Move/Copy to a **new** estimate is unaffected.
- **Load system** from the system library.
- Re-opening a **track, curtain or labor** configurator on a line ("Update track" etc.).

The portal's customer **Refresh pricing** stays as is: it already cuts a new sent revision.

### 9.1 Re-price on Revise

When a sent / won / lost **Estimator system quote** moves back to Draft (every path that sets
`revised` in `setStatus`: the status menu, Quotes hub, stage move, bid addendum), its plain catalog
lines are re-priced to today's catalog **before** the draft is saved:

- **Re-priced:** a line whose SKU resolves (renames followed) to a live catalog part whose `cost`
  differs from the line's stored `cost`. New `cost` = catalog cost; new `price` = old `price` ×
  new cost ÷ old cost, rounded to cents — the line keeps its own cost-to-sell ratio, so this is
  correct under both today's margin convention and the markup convention landing in #367.
- **Not re-priced:** lines with stored cost 0, bonus lines, vendor-quote lines, custom/allowance
  lines, assembly / rack / track / curtain lines (their own configurators re-price them, now that the
  quote is a draft), and Labor-category lines. Alternate systems are treated like any other system.
- A system with a **typed system price** keeps it (the lines' cost moves, the typed sell stays) and
  is named in the summary.
- The draft then goes through the same derivations a save does (totals / `value`, bonus lines, project
  discounts, $25 rounding) — one shared function, not a copy.
- The result is stored on the quote as `repricedOnRevise = { at, by, lines: [{ sectionId, lineId,
  sku, oldCost, newCost, oldPrice, newPrice }] }` (≤ 500 entries) and shown as a dismissible banner on
  Build: "Revise re-priced 12 lines to today's catalog (+$1,240)". No undo (decision taken by
  default: each line can still be edited by hand). Revising a quote with no changed costs stores
  nothing.
- Grid quotes already re-price on re-promote while a draft; service quotes price from rate blobs.
  Both are out of scope.

## 10. Not in scope

Other manufacturers' APIs (the connection blob is keyed by provider so they can follow), ETC orders
/ deliveries (v1), category-tree import, images, weights / HS codes / country of origin, and moving
the portal's Refresh pricing.

## 11. Remaining is Jeff-gated

Create a MyETC API key (business-account admin), paste it in Catalog → Import → Connect a
manufacturer, Test connection, Pull prices, check the preview (especially the "new" count and a few
price changes against the MyETC Price List page), Import, and read the next morning's daily-sync line.
