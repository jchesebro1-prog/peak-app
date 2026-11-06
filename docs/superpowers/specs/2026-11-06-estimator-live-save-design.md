# Estimator live save + Undo — design

Jeff, 2026-11-06: "Can we make it so estimator lines live save when editing? And then there is an undo button if you need to?"

Punch and D numbers are assigned at merge (`#373` is in use on an open branch).

## Decisions

| Question | Answer |
| --- | --- |
| Which estimates live-save | Draft only. Sent, Won and Lost keep the Save button. |
| When a new estimate first saves | On the first line added. |
| What Undo covers | Lines, systems and groups, for this page session. Cleared on reload. |
| When the estimate changed elsewhere | Live save stops and asks: Reload or Keep mine. |

Two rules added during design, approved with it:

- **Portal quotes keep manual Save.** On a `portal-catalog` quote, a save that prices the last open line clears `portalReview` (`saveQuoteAction`). That must stay a deliberate act, not a side effect of typing.
- **Live saves don't render the PDF.** Each render is a headless Chrome run. A live save marks the PDF out of date, and it renders when it's needed (see "PDF").

## Goals and non-goals

An edit on a Draft estimate reaches the database without pressing anything, and a mistake is one click to reverse.

Not in scope:

- Undo for header fields (customer, venue, contact, note, name). They already autosave and aren't part of Undo.
- Undo after a reload, or shared between windows.
- Merging two people's edits. A conflict stops and asks.
- Live save on any other builder (flame, repair, inspection, Grid, Quick Design).
- A new status or history record for each live save.

## What the user sees

**Draft (non-portal):** the header's Save button becomes a status chip.

| Chip | Meaning | Click |
| --- | --- | --- |
| `Saved ✓` | Everything on screen is stored | Nothing |
| `Saving…` | An edit is waiting or a save is running | Save now |
| `Not saved — Retry` | The last save failed | Retry now |
| `Not saved` + reason | The server refused it (labor on a box sale, package document over its cap) | Shows the reason; nothing to retry until it's fixed |

**Sent, Won, Lost, portal quotes:** the Save button works as today, except that it also runs the change check below.

**Undo and Redo** sit beside the chip on every step and status. Each is disabled when there's nothing to do, and its tooltip names the step ("Undo: line deleted"). ⌘Z and ⇧⌘Z work when focus isn't in an input, textarea, select or contenteditable, and no dialog is open. Text fields keep the browser's own undo. The package document keeps TipTap's own undo.

## Live save

### What starts one

Only a user edit. The hook gets one `markUserEdit(label)` seam, called by:

- `setSections` (already the single user-edit path; the automatic writers use `setSectionsState` directly)
- wrappers around the setters for groups, vendor quotes, PDF options, payment terms, box sale, project discounts and the package document
- Undo and Redo
- the tier re-price and the #254 banner's Undo, which write `setSectionsState` directly

Opening an estimate must never write it. The automatic section writers (bonus lines, project discounts re-applied, auto freight, the load-time $25 stamp) don't call the seam, so they can't start a save. A later live save carries whatever they derived, as a Save does today.

### When it runs

The conditions, as a pure function:

- Status is `draft`, source isn't `portal-catalog`, and the quote is an Estimator system quote.
- For a new estimate: at least one system has a line.
- No tier lookup is in flight (`tierResolvingRef`). The save waits for it.
- No status change is in flight (`statusChanging`).
- Live save isn't paused by a conflict or refusal.

Timing:

- 1.5 s after the last edit.
- At once when the user changes step or tab, and before a status change, stage change, approval action or Send. These paths already await `saveNow()`.
- Closing or reloading the page with work unsaved shows the browser's `beforeunload` warning.
- Navigating elsewhere in the app with work unsaved saves it on the way out, without a warning. `beforeunload` doesn't fire for in-app navigation.
- `unsavedHold` for pop-outs follows the live save status on a live-save estimate.

### One queue

All writes from this window run through one promise chain, one at a time: live saves, manual Saves and the header autosave (`persistMeta`). A save that's waiting collapses to the newest state. This keeps a header autosave and a live save from racing, and keeps tier resolution reading the right customer.

### What a live save writes

`saveQuoteAction` gains `live?: boolean`, `renderPdf?: boolean` and `baseKey?: string`. `renderPdf` defaults to true without `live` and false with it.

With `live` on an existing quote, the patch is limited to the fields only Save carries. Every save on a live-save estimate uses this limited patch, including one that also renders the PDF:

- `spec` (sections, mobs, groups, document, project discounts), `value`, `margin`
- `vendorQuotes`, `pdfOptions`, `paymentTerms`, `boxSale`
- the tier stamp, resolved from the **stored** customer and contact

Header fields (`name`, `customer`, `customerId`, `locationId`, `contactName`, `quoteNote`, `assumptions`, `installTimeframe`, `category`, `coverSummary`, `notIncluded`) stay with the existing header autosave, so a stale window can't overwrite them.

`status` isn't acted on: the live path skips `resolveSaveStatusChange` altogether.

A `live` create writes everything, as a first Save does, including `replaces`, `leadId` and `suggestionId`.

Every other server step of a Save still runs: sanitizing, `deriveEstimatorSections`, Rewards credit settling, value reconciling, vendor quote storage and pruning, parties, rename following, and the box-sale and document refusals.

The server refuses `live` (nothing written, typed result) when the stored quote isn't a draft or is a portal quote. The client then syncs its status and falls back to the Save button with a notice.

### After it returns

The response must never overwrite an edit made while it was running:

- Progress is tracked by an edit counter: a save records the counter's value when it started, so newer edits still read as unsaved.
- `vendorQuotes` from the response merge by id (storage fields only), rather than replacing the list.
- A live save returns no `pdf` render state and no `router.refresh()`.

`refresh()` (`revalidatePath("/", "layout")`) is skipped for live saves, because it re-runs the Estimator page, which loads the whole catalog. When the user leaves the Estimator after any live save, one fire-and-forget action runs that refresh, so a Back navigation doesn't show a cached page.

`postChanged("quote", id)` still posts on every live save; `LiveSync` already throttles it.

### First save of a new estimate

The first line starts a `live` create. The existing effect in `estimator-client.tsx` already puts the new id in the URL, so a reload reopens the estimate.

### Failures

- **Network error, existing quote:** the chip shows `Not saved — Retry`. It retries with backoff (5, 15, 30, 60 s) and on the `online` event. Edits stay on screen.
- **Network error, create:** no automatic retry, because a lost response could mint a second quote. The chip shows `Not saved — Retry`, and pressing it retries.
- **Refused by the server:** the chip shows the reason and live save pauses until the next edit.

## The change check

### The key

A pure `liveKey(quote)` returns a hash of a stable, sorted-keys stringify of the fields live save writes, minus the derived ones: `spec`, `vendorQuotes`, `pdfOptions`, `paymentTerms`, `boxSale`.

Using a content hash rather than `updatedAt` means status moves, people changes, approvals and header autosaves never raise a false conflict, and any writer that changes the spec is caught without auditing it.

The page's `initial` carries the key, and `saveQuoteAction` returns the new one, read back from the store. Audit of the Estimator's actions: the only others that can write these fields on the open quote are the status and stage moves (a Lost move clears the Rewards credit). The client re-reads the key after any server-confirmed status change. Move and Copy write the target quote only, not the open one. A missed writer causes a false banner, never lost data.

The key is computed on the server only (`node:crypto`). The client just holds the string.

### The check

When `baseKey` is posted, `saveQuoteAction` compares it with the stored quote's key inside `withQuoteRowLock`, in the same transaction as `update()`. Vendor attachment storage stays outside the lock.

- The check applies to live saves and manual Saves. A caller with no `baseKey` (a tab opened before this deploy) isn't checked, so the rollout is safe.
- On a mismatch nothing is written, and the result is `{ ok: false, conflict: { by, at } }`.

### The banner

Live save pauses, and a banner replaces the chip's message:

> This estimate changed somewhere else — saved by Isaac at 2:14 PM. **Reload** · **Keep mine**

- `by` and `at` come from a new optional `Quote.lastSavedBy: { name, at }`, stamped only by `saveQuoteAction`. Other writers leave it alone, so when it doesn't match the change the banner reads "This estimate changed somewhere else."
- **Reload** does a full reload without the unsaved warning. This window's unsaved edits are dropped; the banner says so.
- **Keep mine** saves once with no `baseKey` and resumes live save. It replaces what the other window saved.

## Undo

### The stack

Pure module `src/lib/estimate-live-save/undo.ts`, following `src/lib/design/grid-undo.ts`: `past`, `future`, cap 100. An entry is a snapshot `{ sections, groups, vendorQuotes }` plus a label. Sections are immutable, so snapshots share structure and stay cheap.

### Recording

`markUserEdit` flags the next state change as an edit. An effect on `[sections, groups, vendorQuotes]` then pushes the previous snapshot if flagged. Unflagged changes (automatic writers) only replace the "current" snapshot, so they never become a step of their own.

**Coalescing:** a change merges into the previous step when under 1 s has passed, the set of line ids and system ids is unchanged, and the same line or system is the only thing that changed. So +, +, + on one quantity is one step, as is typing a system name. Qty and price inputs commit on blur, so each is already one step.

**Labels** come from a small pure diff: line added, line deleted, line edited, lines moved, system added, system deleted, system edited, systems reordered, group changed, re-priced.

### Applying

Undo and Redo write the snapshot with `setSectionsState` and friends, clear the #254 banner, and call `markUserEdit` so a Draft live-saves. Bonus lines and project discounts re-derive through their existing effects. `nextId` never goes backwards, so a restored id can't collide. If the active system or a ticked line is gone after a restore, the selection falls back as it does after a delete.

On Sent, Won and Lost, Undo changes the screen only and the user presses Save.

### Keeping history honest

- **Auto freight:** applies `applyAutoFreight` to every stored snapshot, as the #254 banner's `before` does today, so Undo doesn't revert freight the user never touched.
- **Move system to another estimate, and any move of lines out:** clears history and says so. Undoing would leave the work on both estimates.
- **Status change, revision recall:** clears history. Otherwise Undo could restore prices that the #368 lock forbids on a sent estimate.
- **Keep mine:** history stays, because the screen didn't change.
- **Reload:** clears history, as chosen.
- **Tier re-price:** one step labelled "re-priced". The #254 banner's Undo stays, and also clears on the next edit as it does today.

A vendor quote deleted and then restored by Undo gets its attachment back. The save path prunes the record but never deletes its Blob file, and the snapshot still holds the record's `blobPath` (or its data URL with Blob off), which `storeVendorQuotes` accepts as this record's own. A test pins this.

## PDF

- A live save calls `markQuotePdfStale` rather than `scheduleQuotePdf`. `contentChangedAt` is stamped by the write as usual, so `pdfIsCurrent` is correct.
- `pdfDirty` keeps a narrower meaning on a live-save estimate: the PDF is behind the screen. A live save doesn't clear it; only a save that renders does (`saveNow`). So every existing caller that runs `pdfDirty ? saveNow : …` before Send, Approve, Submit, cut sheets or the Grid keeps working unchanged, and gets a save and a render.
- A new `contentUnsaved` means the edits aren't stored yet. The "Save first" hints on the BOM tab and the Cover panel read it, because those documents print the stored estimate, not the rendered PDF.
- Stepping to Customer review or Send & track with `pdfDirty` true runs `saveNow()`. With it false but the stored PDF missing or out of date, as after a reload, it runs the existing `retryQuotePdfAction`, which renders at once and also covers a quote with no PDF yet.
- `send-server.ts` already refuses a PDF that isn't current, so a stale file can't go out.
- Draft PDFs aren't customer-visible, so an out-of-date one exposes nothing.

## Approval

No rule changes. Editing an approved draft makes the approval stale when the gross sell or priced line set changes, as Save does, and each live save returns a fresh `next` for the next-step control. Undoing back to the approved numbers makes the fingerprint match again.

## Units

| Unit | Purpose | Depends on |
| --- | --- | --- |
| `src/lib/estimate-live-save/undo.ts` | Push, coalesce, take, redo, map over snapshots, label diff | Types only |
| `src/lib/estimate-live-save/scheduler.ts` | When to save: conditions, debounce, retry backoff, single flight, as a state machine with no timers of its own | Nothing |
| `src/lib/estimate-live-save/live-key.ts` | `liveKey`, stable stringify; server only | `node:crypto` |
| `src/lib/estimate-live-save/rules.ts` | `liveSaveEligible`, `liveSaveRefusal`, `limitToLivePatch`; client safe | Nothing |
| `updateCheckingLiveKey` in `src/lib/stores/quotes.ts` | The check and the write in one transaction | live-key |
| `src/app/(app)/estimator/use-live-save.ts` | The hook's timers, queue and chip state, around `saveNow`; keeps `use-estimator-state.ts` from growing | scheduler |
| `src/app/(app)/estimator/use-estimate-undo.ts` | Snapshot recording and apply | undo |
| `src/app/(app)/estimator/live-save-chip.tsx` | Chip, Undo, Redo, conflict banner | Hook state |
| `actions.ts` (`saveQuoteAction`) | `live`, `baseKey`, the limited patch, the check, `lastSavedBy`, skipped refresh and render | live-key |

No migration and no env var.

## Testing

- `scripts/test-estimate-live-save.ts`, chained into `test:specs`:
  - the undo stack, coalescing, labels and snapshot mapping
  - every scheduler condition and transition
  - key stability across key order, and that header, status and people changes don't move the key
- DB half against a scratch PGlite:
  - a live save writes the limited patch and leaves header fields alone
  - a stale `baseKey` writes nothing
  - no `baseKey` isn't checked
  - `live` is refused on sent and portal quotes
  - a live save leaves the PDF stale, and Send refuses until it renders
  - a vendor quote pruned by one live save comes back with its attachment on the next
- Source pins: `saveQuoteAction` uses the checked write, the limited patch and the skipped refresh, because a `"use server"` file can't run in the plain harness.
- Browser check on a scratch dev server, screenshots as proof:
  - opening a draft writes nothing (`updatedAt` unchanged)
  - edit, wait, reload: the edit is there
  - a new estimate on its first line gets an id and a URL
  - Undo, Redo and ⌘Z, including a deleted system
  - two windows raise the banner, and both buttons work
  - offline and back online
  - Sent still shows Save
  - stepping to Customer review renders the PDF
- The verification gate: tsc, `test:specs`, `test:smoke`, eslint, `next build`.

## Rollout and rollback

- Rollback is safe: `lastSavedBy` is optional JSON that older code ignores.
- Tell the team before deploy: drafts save themselves, and a new estimate appears in Quotes as soon as it has a line.
- Build from main after #367. Never preview-deploy a branch not rebased on it.
- Real-use check for Jeff on production: edit a real draft, Undo a deleted system, and open the same estimate in two windows.
