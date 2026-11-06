# Task 4 report
Implemented saveQuoteAction live mode per brief: SavePayload.live/renderPdf/baseKey, SaveResult.conflict/notLive/liveKey; server refusal via liveSaveRefusal(prior); stored-customer tier for live; limitToLivePatch write through updateCheckingLiveKey (conflict and missing-quote handled: a null quote leaves ok=false, never success); lastSavedBy stamp on update and create; markQuotePdfStale vs scheduleQuotePdf; status change skipped when live; refresh skipped when live; liveKey read back from store. New currentLiveKeyAction, revalidateAfterLiveSaveAction. EstimatorInitial (InitialQuote) gained liveKey; page.tsx sets null / liveKey(q).
TDD: RED `npx tsx scripts/test-estimate-live-save.ts` -> 69 PASS, 7 FAIL (action pins). GREEN -> 76 PASS, 0 FAIL; with scratch PGLITE_PATH -> 84 PASS, 0 FAIL.
tsc --noEmit clean; eslint clean on touched files.
Files: actions.ts, page.tsx, types.ts, scripts/test-estimate-live-save.ts.
Concerns: 6 tsx processes shown by ps are not mine (other sessions); mine all exited.

## Fix pass
1. Rewards credit reads `live && prior ? prior.customerId || null : payload.customerId || null`. Pin: "rewards credit reads the stored customer on a live save".
2. `updateCheckingLiveKey(id, baseKey, patch, { live })`: live always takes the transaction + row lock and runs `liveSaveRefusal(cur)` on the locked read; returns `{ quote: null, conflict: null, refused }`. Action maps it to `{ ...refusedSave(prior, reason), notLive: true }`. Non-live without baseKey keeps the direct path and never checks status. DB checks: live write on a Sent quote writes nothing with and without a baseKey; non-live write on a Sent quote still writes.
3. Live save on a missing quote returns `refusedSave(null, LIVE_MISSING)` before anything else (no vendor storage, no notLive); a null quote from the checked write on a live save maps to the same refusal. Pins for both.
4. `CheckedUpdate.liveKey` is computed in the transaction after `update()`; the action uses `written.liveKey`, re-reading only when setStatus ran after the write or the write skipped the transaction. DB checks: returned key equals stored quote's key (with a key and Keep mine).
5. Live create: `if (!live && payload.status !== "draft")`. Pin.
6. Pins added: stored-customer tier, `live && loadedId` limited patch.
7. Vendor attachment round trip: NOT added as a runtime check. `storeVendorQuotes` is a non-exported function inside a "use server" file (which can only export async actions, and importing it pulls auth/Blob modules), so the plain harness can't call it. The existing `del(` source pin stays; the path with its own `blobPath` does no upload by reading (it returns the record unchanged before any upload branch).

Command: `PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-estimate-live-save.ts` -> 97 PASS, 0 FAIL.
