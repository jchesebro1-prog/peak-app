# Engineering batch — atomic writes, spawn-on-win, and the carried minors

**Punch:** #74, #85, #86 (B1) · #138–#141, #149–#157 (B2) · **Date:** 2026-09-23
**Decisions to log on build:** D215–D220 (D205–D207 are reserved by #160/#161, D208–D214 by #162)

Brainstormed with Jeff 2026-09-23. #74/#85/#86 were investigated on 2026-08-01/06 and
deliberately left unbuilt pending his call; he chose the structural fix. The B2 items are
carried minors from the #122 and #145 reviews; the four that asked for a decision were
answered in the same session.

---

## Part B1 — atomic writes and spawn-on-win

### 1. What is wrong today

- **No Postgres transaction exists anywhere.** Every multi-write operation can half-apply
  (#74). The 2026-08-01 investigation stopped because every doc-store writer calls `getDb()`
  itself and nothing accepts a `tx` handle.
- **Won-quote spawning is inconsistent across eight call sites.**
  `setQuoteStatusAction` (`src/app/(app)/quotes/actions.ts:79-84`) runs all six
  `sync*FromQuotes` sweeps; the flame, repair, inspection and rental builders each run only
  their own; **the Inbox (`inbox/actions.ts:256`), Estimator (`estimator/actions.ts:319,561`),
  Settings (`settings/actions.ts:154`) and Rentals board (`rentals/board/actions.ts:34`) run
  none** — their project/job appears only when someone later opens `/projects`, `/schedule`,
  `/field-work` or the engagements hub, whose loaders run the sweeps on page load.
- **A mint failure inside those page-load sweeps fails the render** of a page the user merely
  opened (#86).
- **Five `Promise<void>` form actions have no return channel**, so a mint that exhausts its
  retries escapes as a raw exception (#85): `design/grid/actions.ts:19`,
  `field-work/actions.ts:38`, `projects/actions.ts:175`, `inspections/actions.ts:23`,
  `field-survey/actions.ts:18`, plus `addToQuotesAction` in `design/quick/actions.ts`
  (whose mint and `Design not found` throw are handled together).

### 2. Ambient transactions (D215)

Every database caller — the doc store, `src/lib/identity/*` (companies, contacts, sites,
convert), `settings.ts`, `users.ts`, `stores/customers.ts` — obtains its handle from one
function, `getDb()` in `src/db/index.ts`. The transaction is therefore taught to that one
function, not threaded through ~100 store signatures.

- `withTransaction<T>(fn: () => Promise<T>): Promise<T>` in `src/db/index.ts` opens
  `db.transaction(...)` and stores the `tx` in a module-level `AsyncLocalStorage`.
- `getDb()` returns the active `tx` when the store holds one, else the pooled handle, as today.
- **Nesting joins.** A `withTransaction` call inside an active one runs `fn` directly on the
  outer `tx` — no savepoint. One unit, one rollback.
- **A throw rolls back the whole unit** and re-throws unchanged, so existing callers' error
  handling (e.g. the `statusError=` redirect) is untouched.
- Works on both drivers: `drizzle-orm/postgres-js` (hosted) and `drizzle-orm/pglite` (dev)
  both implement `.transaction()`. PGlite is one connection, so concurrent requests queue
  behind an open transaction — acceptable in dev.
- **The one hazard:** code that awaited `getDb()` *before* entering `withTransaction` and
  reuses that handle inside it writes outside the unit. The plan includes a sweep for any
  handle held across an `await` boundary into a wrapped flow (module-level caches, a `db`
  captured in a closure).
- Do not wrap long I/O (Gmail, Drive, geocoding, PDF rendering) inside a transaction.

**Wrapped flows:** quote status change + its spawn (§3), `promoteDesignToQuote`
(quote insert → requote patch → design soft-delete), lead conversion
(`identity/convert.ts` + the doc writes around it), and each per-quote spawner.

### 3. Spawn at the moment of the win (D216)

- New `spawnFromQuote(quote: Quote, prevStatus: QuoteStatus): Promise<void>` in
  `src/lib/stores/quote-spawn.ts`. It routes by `quoteType` to the owning store's existing
  per-quote creator (`createFromQuote` / `ensureEngagementForQuote` / the bookings creator —
  the plan names each exactly), and owns the consulting `sent` / `lost` engagement rules now
  inlined in `quotes/actions.ts:55-68`.
- `setStatus()` (`src/lib/stores/quotes.ts`) runs its write and `spawnFromQuote` inside one
  `withTransaction`. Every caller — all eight — gets identical behaviour with no extra call.
- The ad-hoc sweep calls after `setStatus` are deleted from the callers.
- Spawners stay **idempotent** (keyed on `sourceQuoteId`, honouring the existing dismissed /
  tombstone lists), so a re-win or a sweep after a spawn creates nothing twice.

### 4. The page-load sweeps become a guarded safety net (#86)

The `sync*FromQuotes` sweeps stay — they backfill anything created before this change, and
anything written by a path outside `setStatus` (e.g. `/api/sync/push`). Each call site
(`projects/data.ts:25`, `schedule/page.tsx:142,167`, `field-work/page.tsx:119`,
`design/engagements/data.ts:64`) goes through one helper:

`safeSweep(label: string, fn: () => Promise<number>): Promise<SweepResult>` where
`SweepResult = { ok: true; created: number } | { ok: false; label: string; message: string }`.

It catches, logs with `console.error("[sweep]", label, err)`, and returns the failure. The
page renders normally and shows one inline notice — "Couldn't create 1 item from won quotes.
Retry" — where Retry is a form posting a server action that re-runs the sweep and
revalidates. No sweep failure ever fails a render.

### 5. Inline errors for the void form actions (#85, D217)

- One client component, `src/components/ActionForm.tsx`, wrapping React's `useActionState`.
  It renders its children plus, when the action returns `{ error: string }`, an inline
  `role="alert"` message beside the submit button in the existing `pk-*` error style.
- The six actions change from `Promise<void>` to `Promise<{ error?: string } | void>`:
  success paths still `redirect()` / `revalidatePath()` exactly as now; failure paths
  (mint exhaustion, `Design not found`) return `{ error }` instead of throwing.
- No `?err=` params and no per-destination-page rendering — the error appears where the user
  clicked.

---

## Part B2 — the carried minors

| # | Fix | Decision |
|---|---|---|
| 138 | Cron-only reconcile pass: for every linked thread, compare its cached Gmail label set with `desiredPeakLabels` and call `queueLabelSync` where they differ — one `getDoc` + one label-cache read per thread. Also wrap the interactive `queueLabelSync` in `waitUntil` where the runtime provides it, so the write that motivated this is less likely to be dropped. Not on the interactive path. Ref D142. | — |
| 139 | Add `"architect"`, `"general contractor"`, `"electrical contractor"`, `"engineer or AV consultant"` to `PARTNER_TYPES` (`identity/venue-defaults.ts:18-27`), keeping the legacy literals — #122's vendor pattern. | — |
| 140 | Fifth vendor status `no-claims`: a vendor with a logged price list but no claimed manufacturers. Own chip in `VENDOR_STATUS_META` and the `/vendors` status filter; `vendorTasks()` mints no task for it; the ledger stays visible. Update the #122 spec §2 table, D160 and the #122 harness assertions. | D218 |
| 141 | Keep the Vendor Overview remount that fixed concurrent overwrites, but carry the "Saved" chip state and unsaved field values across it. | — |
| 149 | Spec-harness fixture rows are torn down by the test that created them. | — |
| 150 | The engagement file proxy resolves the blob from record coordinates (engagement id + file id) and authorizes against that record; a client-supplied storage key is no longer trusted. | — |
| 151 | Task-template import validates per row in the preview, not at commit on the receipt. | — |
| 152 | `barRect`'s overrun test becomes day-granular, matching `overrunsEnd`. | — |
| 153 | A task's first drag preserves its visible length. | — |
| 154 | Day columns render identically on server and client (no timezone-dependent SSR divergence). | — |
| 155 | A discipline on a quote but no longer in Settings renders greyed as "*Name* (removed)" and is **kept** on save; unchecking it by hand removes it. | D219 |
| 156 | `normalizeLine` phase casing is idempotent across repeated export→import; proven by a five-cycle test. | — |
| 157 | `/schedule?view=timeline` uses one shared `{start, end, dayWidth}` window and one ruler across the Installs and Consulting sections, spanning the earliest start to the latest end of both. | D220 |

Each item's punch entry (PUNCHLIST.md) carries the file:line detail the plan builds from.

---

## Testing

- **Transactions:** nested `withTransaction` joins the outer unit; a throw inside rolls back
  every write in it (doc store and identity tables alike); `getDb()` outside any unit is
  unchanged.
- **Spawn:** winning a quote of each of the six spawning types creates exactly one downstream
  record; re-winning creates none; a dismissed/tombstoned record is not re-created.
- **Failure injection:** force the project creator to throw during a win → the quote's status
  change is rolled back too.
- **Sweeps:** a throwing sweep returns `{ ok: false }` and the page still renders (smoke).
- **B2:** each item gets the regression check its entry names (e.g. five-cycle casing test,
  day-granular overrun, `no-claims` status + no task).
- Gates per task: `npx tsc --noEmit`, `npm run test:specs`, `npm run test:smoke`, eslint on
  touched files against a baseline. Specs run on a scratch datadir only (D202).

## Delivery

Two plans, independent of each other: **B1** (§§2–5) and **B2** (the table). B1 touches
`setStatus` and the quote actions, which #160 also touches (Change type) — whichever lands
second rebases on the first.

## Out of scope

- Replacing the page-load sweeps entirely (they stay as the backfill).
- Savepoints / partial rollback.
- Transactions around external I/O.
