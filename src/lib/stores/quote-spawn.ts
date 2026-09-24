import type { Quote, QuoteStatus } from "./quotes";

export type SpawnFromQuoteOpts = {
  /**
   * Spawn even though `prevStatus === quote.status` (#170).
   *
   * `setStatus` does not write when a quote is ALREADY at the requested
   * status — but re-approving an already-won quote is a real flow: the four
   * service builder screens (flame-tests / repairs / inspections / rentals)
   * persist the quote, call `setStatus(id, "won")` and then act, and cfc00ad
   * deleted the `createFromQuote` / `syncFromQuotes` calls those screens used
   * to make for themselves. Without this the no-op-transition guard below
   * would short-circuit the repair and the record would silently never exist.
   *
   * Only `setStatus`'s unchanged-status branch passes it. Everything it
   * unlocks is idempotent on the quote id, so a spurious replay costs one
   * read.
   */
  replayUnchanged?: boolean;
};

/**
 * Spawn the downstream record at the status transition that creates it.
 * Every called store uses the ambient DB transaction supplied by setStatus,
 * so this must never do a full-collection sweep (#171) or await external I/O.
 *
 * Routes on `quote.quoteType`. An unrecognised type falls to the project
 * branch, exactly as `syncProjectsFromQuotes`' own exclusion list reads an
 * untyped or unfamiliar row — and nothing here throws, so adding a quote type
 * can never break winning one.
 *
 * `quote` must be the already-patched record: the consulting branch derives
 * its action straight from `quote.status`.
 */
export async function spawnFromQuote(
  quote: Quote,
  prevStatus: QuoteStatus,
  opts: SpawnFromQuoteOpts = {}
): Promise<void> {
  // Consulting is the one type whose lifecycle starts before the win —
  // sending opens the engagement, winning advances it, losing closes it — so
  // it is routed on every status, not just "won".
  if (quote.quoteType === "consulting") {
    await spawnConsulting(quote);
    return;
  }
  if (quote.status !== "won") return;
  // An optimisation, explicitly NOT the idempotence guarantee — every creator
  // below dedupes on the quote id itself. `replayUnchanged` opts out of it.
  if (prevStatus === "won" && !opts.replayUnchanged) return;
  switch (quote.quoteType) {
    case "flame_test":
      await (await import("./flame-jobs")).createFromQuote(quote.id);
      break;
    case "repair":
      await (await import("./repair-jobs")).createFromQuote(quote.id);
      break;
    case "inspection":
      await (await import("./inspections")).createFromQuote(quote.id);
      break;
    case "rental":
      await (await import("./equipment-bookings")).createFromQuote(quote.id);
      break;
    default:
      await spawnProject(quote.id);
      break;
  }
}

/**
 * The install/system branch — a won quote becomes a Projects record, unless
 * the user already deleted the one it made (#169).
 *
 * Deleting a quote-born project records that quote on the dismissed list
 * (`removeProject` → `dismissedQuoteIds`, projects.ts), and the page-load
 * sweep `syncProjectsFromQuotes` has always honoured it — but the per-quote
 * creator `createProjectFromQuote` never has. That was harmless while the
 * creator was only reachable from the Projects "convert a pending quote"
 * flow, which never operates on a dismissed quote; routing every win through
 * it silently resurrected a project the user had deleted. The check lives
 * here rather than inside `createProjectFromQuote` so the explicit convert
 * action still means what it says.
 *
 * That is a claim about the dismissed BLOB only: it is a projects-only
 * mechanism, no other spawner has one, and minting a second dismissed list
 * here would be a new lifecycle rule rather than a bug fix. It is NOT a
 * ruling on deletion generally. The four service creators dedupe through
 * their own `byQuote`, which reads `listDocs` and therefore cannot see a
 * soft-deleted record — delete a flame job and re-approve the already-won
 * quote and the job comes back, a surface #170's replay widened. The
 * tombstone-aware fix for that is punch #173; nothing is decided here.
 */
async function spawnProject(quoteId: string): Promise<void> {
  const { createProjectFromQuote, dismissedQuoteIds } = await import("./projects");
  if ((await dismissedQuoteIds()).includes(quoteId)) return;
  // Idempotent on getProjectByQuote(quoteId).
  await createProjectFromQuote(quoteId);
}

/**
 * The consulting branch — THIS quote's engagement only (#171).
 *
 * `lost` used to call `syncEngagementsFromQuotes()` purely to borrow its
 * close behaviour. Inside setStatus's transaction that meant marking one
 * quote lost re-derived and patched EVERY consulting engagement in the book:
 * a malformed unrelated row could throw and block the status change the user
 * actually asked for, a rollback of that change would discard the sweep's
 * legitimate repairs to the others, and on PGlite two full-collection scans
 * plus N patches held the process's only connection throughout.
 *
 * The rules themselves are unchanged — they come from the same pure
 * `engagementSyncAction(quoteStatus, currentStage)` the sweep uses, and
 * close/reopen go through `applyEngagementStageAction`, the shared per-row
 * writer that owns the "Proposal lost" decision copy. The sweep stays what it
 * always was: a page-load reconciliation, never called from a transaction.
 */
async function spawnConsulting(quote: Quote): Promise<void> {
  const { engagementSyncAction, normalizeEngagementStatus } = await import(
    "@/lib/consulting-stages"
  );
  const { applyEngagementStageAction, ensureEngagementForQuote, getEngagementByQuote } =
    await import("./engagements");
  const existing = await getEngagementByQuote(quote.id);
  const stage = existing ? normalizeEngagementStatus(String(existing.status)) : null;
  const action = engagementSyncAction(String(quote.status || ""), stage);
  if (!action) return;
  if (action.kind === "create") {
    // The one case that cannot use the shared writer: there is no row yet, so
    // it needs the quote itself (`fromQuote`) plus the id mint. `create` is
    // only ever returned when `existing` is null, so the lookup inside
    // `ensureEngagementForQuote` is the second scan of this path — kept
    // because the builder it wraps is not exported on its own.
    await ensureEngagementForQuote(quote.id, action.stage);
    return;
  }
  // advance / close / reopen — `existing` is already in hand, so all three go
  // STRAIGHT to the shared per-row writer: no second full-collection scan
  // inside the transaction, and every write this branch makes goes through the
  // one writer, as the module claims. `engagementSyncAction` only returns
  // these three when `stage` was non-null, i.e. `existing` is set — the guard
  // is for the type checker, never a silent skip of work that was due.
  if (!existing) return;
  await applyEngagementStageAction(action, existing.id, quote.id);
}
