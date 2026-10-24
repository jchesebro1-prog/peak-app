# ETC Price Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Catalog import drawer's "Connect a manufacturer" placeholder into a real ETC connection — encrypted API key, pull → preview → import of ETC's four dealer price lists, a daily delta sync, an internal-only demo price — while sent estimates keep their prices and a Revise re-prices to today's catalog.

**Architecture:** Pure cores (`src/lib/dealer-api/etc/parse.ts`, `plan.ts`, `src/lib/estimate-reprice/rules.ts`) hold every rule; thin server modules (`connections.ts`, `etc/client.ts`, `etc/apply.ts`) do I/O; the drawer is a client component calling admin server actions; the daily sync is a rider on `/api/drive/sync`.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routes/actions), TypeScript, zod, Drizzle doc-store blobs (`getBlob`/`setBlob` in `src/db/doc-store.ts`), the tsx spec harness `scripts/test-review-and-spec.ts` (`ok(cond, label)`, run by `npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-10-23-etc-price-sync-design.md` — read it first; it is authoritative. Punch item **#368** (comments carry `#368`).

## Global Constraints

- Never open `/Users/sm/Downloads/peak-app/.data/pglite` from this worktree; leave no `tsx` or `next dev` process running; check `ps aux | grep -E "tsx|next dev"` before and after.
- No real HTTP to ETC in tests or dev: the client takes an injectable `fetch`. Never call my.etcconnect.com.
- No migration (doc blobs + JSONB fields only).
- The plaintext API secret is decrypted only inside `etcSecret()` and used only by the ETC client; no action, page prop, log line or error message contains it.
- `demoPrice` / `demoPricedAt` never reach a customer surface (portal, share pages, Displays APIs, PDFs, client package, CSV export, Assist).
- Re-price math keeps each line's cost-to-sell ratio (`price × newCost / oldCost`); it must not call `catalogAddPrice` or any margin/markup formula (the markup-pricing branch #367 rewrites those).
- Match surrounding code style: inline-style objects in client components, `pk-btn-accent` buttons, header comments with the punch tag.
- After each task: `npx tsc --noEmit -p .` clean, `npm run test:specs` ALL PASSED, `npx eslint <touched files>` clean. Commit per task.

## File Structure

- Create `src/lib/dealer-api/connections.ts` — the `dealer_connections` blob (encrypted key, account, baseline, cursor, lastRun); `etcSecret()`, `etcStatus()` (safe view), save/clear/pick-account/record-run.
- Create `src/lib/dealer-api/etc/client.ts` — server-only fetch wrapper (fixed host, bearer, 30 s timeout, envelope → message); `listAccounts`, `fetchPriceList(list)`, `fetchPriceUpdates(list, date)`.
- Create `src/lib/dealer-api/etc/parse.ts` — pure zod parse of `PriceListPart` → `EtcRow`, skipped reasons.
- Create `src/lib/dealer-api/etc/plan.ts` — pure: rows + resolvable catalog → per-row `create | update | unchanged | demo | demo-unmatched` with patches; preview counts.
- Create `src/lib/dealer-api/etc/apply.ts` — server: snapshot blob `etc_price_pull`, `pullAll()`, `applyBatch(budgetMs)`, `runDailySync(budgetMs)`.
- Modify `src/lib/stores/catalog.ts` — `demoPrice?`, `demoPricedAt?` on `CatalogPart` (internal comment).
- Strip demo fields in `src/app/(app)/catalog/page.tsx` (SpecPanel prop), `src/app/(app)/design/lineset/page.tsx` (fabrics), `src/app/(app)/design/engagements/spec/actions.ts` (matched parts).
- Create `src/app/(app)/catalog/etc-actions.ts` — admin server actions: save/clear key, test/pick account, pull, import batch, status.
- Create `src/app/(app)/catalog/etc-connect-panel.tsx` — the drawer's "Connect a manufacturer" body.
- Modify `src/app/(app)/catalog/controls.tsx` — render the panel instead of the stub; pass `isAdmin` + status.
- Modify the part editor (in `src/app/(app)/catalog/page.tsx`) — read-only "ETC demo price (internal)" line.
- Modify `src/app/api/drive/sync/route.ts` — ETC rider (own try/catch, ≤ 20 s).
- Modify `src/app/(app)/estimator/actions.ts` (+ `copy-system`/`library-actions.ts`), `use-estimator-state.ts` + configurator entry points — the sent lock.
- Create `src/lib/estimate-reprice/rules.ts` (pure) and wire it into `setStatus`'s revise path in `src/lib/stores/quotes.ts`; banner on Build.
- Tests: `#368` blocks appended to `scripts/test-review-and-spec.ts`.

## Tasks

### Task 1 — Connection blob + ETC client + parser
- [ ] `connections.ts`: blob `dealer_connections` `{ etc?: EtcConnection }`; `saveEtcKey(secret, by)` (trim, refuse empty / > 512 chars / whitespace inside, store `encryptWith(secret, AUTH_SECRET)` + `last4`, clear `accountId` only when later test shows it is gone), `clearEtcKey()`, `etcSecret()`, `etcStatus()` → `{ connected, last4, savedAt, savedBy, accountId, accountName, baseline, lastRun, preview: isPreviewDeploy, disabled: ETC_SYNC_DISABLED }`. Reuse `encryptWith`/`decryptWith` from `src/lib/gmail/crypto` and the preview detection the Assist key uses (`src/lib/assist/config.ts` `storedKeyBlocked` or equivalent).
- [ ] `client.ts`: `etcFetch(path, { version, fetchImpl, secret })`; `listAccounts()` (v1 `/me/business-accounts`), `fetchPriceList(accountId, list)`, `fetchPriceUpdates(accountId, list, date)` (v0). Map 401 → "ETC rejected the API key", 403 → "This key's account can't see ETC pricing (ETC: <message>)", other → "ETC returned <status>: <message>"; timeout → "ETC didn't answer in 30 s". `import "server-only"`.
- [ ] `parse.ts`: `parsePriceList(json)` accepts `{ parts: [] }` or a bare array; returns `{ rows: EtcRow[], skipped: { partNumber, reason }[] }`.
- [ ] Harness: parse of ETC's documented example (`7151A1005`, `SR3-48X`, `"1040.00"`/`"728.00"` → 1040/728), non-USD skipped, missing partNumber skipped, `"abc"` price skipped; client with a fake fetch: bearer header sent, 401/403/500/timeout messages, secret never in any returned message; key save/read round trip with a test secret, `etcStatus()` contains no secret.
- [ ] Commit `feat(catalog): #368 ETC connection key, client and price-list parser`.

### Task 2 — Mapping plan + apply engine + demo price field
- [ ] `CatalogPart.demoPrice` / `demoPricedAt` (internal header comment).
- [ ] `plan.ts` per spec §6 (matching via an injected resolver built by `importResolverFor`; priced-list precedence; category rule; never overwrite desc/category; fill blank P/N + model; demo rows → `demoPrice`; demo-unmatched reported). `previewOf(plan)` → per-list counts + first 20 changes.
- [ ] `apply.ts`: `pullAll(accountId)` → fetch 4 lists, parse, store `etc_price_pull` snapshot, return preview; `applyBatch({ budgetMs })` → resumable cursor over the snapshot via `mergeUpsert` with `{ pricedAt, priceDate }` (Chicago today), refuses a snapshot > 24 h old or for another account; on completion sets `baseline` + `lastRun`. `runDailySync({ budgetMs })` → `price-updates/{baseline.date}` × 4 lists, same plan, creates new parts, advances baseline only when fully applied, stores `lastRun.error` on failure.
- [ ] Strip `demoPrice`/`demoPricedAt` at the three whole-part spots (spec §6.1).
- [ ] Harness (DB): plan on a fixture catalog — existing ETC part matched by P/N gets list/cost only, desc untouched; new part created with category `Fixtures`; demo row sets `demoPrice` only; unchanged row writes nothing; batch resume across two `applyBatch` calls with a tiny budget; daily sync with a fake fetch advances baseline; failure keeps baseline. Static: `demoPrice` absent from `src/lib/portal-*`, `displays-api.ts`, `client-package.ts`, `import/registry.ts` export, `ask-tools-server.ts`.
- [ ] Commit `feat(catalog): #368 ETC price plan, pull snapshot and resumable import`.

### Task 3 — Drawer UI + part editor line
- [ ] `etc-actions.ts` (each `requirePerm` admin per `src/lib/session.ts` conventions; status readable by any signed-in user): `saveEtcKeyAction`, `clearEtcKeyAction`, `testEtcAction` (→ accounts; auto-pick one), `pickEtcAccountAction`, `pullEtcAction` (→ preview), `importEtcBatchAction` (→ `{ done, total, finished }`), `etcStatusAction`. Read `node_modules/next/dist/docs/` on server actions first.
- [ ] `etc-connect-panel.tsx`: status line; admin key field (password input, "Saved ••••1234", Replace, Remove); Test connection + account select; Pull prices → preview table (list, new, changed, unchanged, skipped; first 20 changes old → new); Import with progress loop; last daily sync line; preview-deploy / disabled notices. Non-admins: status only.
- [ ] `controls.tsx`: replace the stub; method desc "Live ETC dealer pricing with an API key."
- [ ] Part editor: read-only "ETC demo price (internal)" with date when set.
- [ ] Harness: static render of the panel for admin vs non-admin (no key input for non-admin), copy strings; actions refuse non-admin.
- [ ] Commit `feat(catalog): #368 Connect ETC in the import drawer`.

### Task 4 — Daily cron rider
- [ ] `/api/drive/sync`: after existing riders, `runDailySync({ budgetMs: min(20_000, remaining) })` in its own try/catch; result in the response body; skipped on preview / disabled / no baseline.
- [ ] Harness: rider skipped without baseline; route source contains its own try/catch.
- [ ] Commit `feat(catalog): #368 daily ETC price sync rider`.

### Task 5 — Sent estimates locked
- [ ] Server: `placeSystemInEstimate` (copy/move into existing), Load system action, refuse when the target estimate's status is not `draft` with "Revise the estimate first". Target picker greys out non-draft targets with the same title.
- [ ] Client: track / curtain / labor configurator re-open disabled on a non-draft Estimator with the same text (find the entry points in `use-estimator-state.ts` / `section-card.tsx` / `track-modal.tsx`).
- [ ] Harness: refusal on sent/won/lost targets, success on draft; copy to a NEW estimate unaffected.
- [ ] Commit `feat(estimator): #368 lock re-pricing actions on sent estimates`.

### Task 6 — Re-price on Revise
- [ ] `src/lib/estimate-reprice/rules.ts` (pure): `repriceSections(sections, catalogBySku, resolve)` → `{ sections, changes }` per spec §9.1 exclusions; ratio math rounded to cents; ≤ 500 change entries.
- [ ] Wire into `setStatus` when `revised` for `source: "estimator"` system quotes: load catalog costs for the quote's SKUs (renames followed), apply, then run the SAME derivation the save path uses (bonus lines, project discounts, value) — extract a shared helper from `saveQuoteAction` if needed rather than copying. Store `repricedOnRevise`; no entry when nothing changed.
- [ ] Build banner (dismissible, per-viewer `localStorage`) "Revise re-priced N lines to today's catalog (±$X)" with an expandable list.
- [ ] Harness: ratio math, exclusions (bonus, vendor, custom, assembly, labor, cost 0), typed system price kept, renamed SKU followed, a sent quote's revisions untouched, value re-derived, nothing stored when no change.
- [ ] Commit `feat(estimator): #368 re-price catalog lines on Revise`.

### Task 7 — Docs
- [ ] DECISIONS (next free D-numbers at merge time), PUNCHLIST #368, AGENTS.md phase entry, `.env.example` `ETC_SYNC_DISABLED`, MASTER-HOWTO turn-on steps.
