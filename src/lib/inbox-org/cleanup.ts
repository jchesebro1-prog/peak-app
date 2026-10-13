/**
 * Inbox organization §6 — "Organize my inbox", the 90-day cleanup (Assist
 * pilot users, feature `file`). Walks the person's own inbox threads last
 * active within 90 days that aren't filed, runs the rule pipeline on each as
 * BACKLOG (`organizeThread(id, { backlog: true })`: court rules only — no AI
 * court reading, so no promise-tasks), then gives what is left of the batch's
 * budget to the AI pass, filing only (`runAiPass({ filingOnly })`).
 *
 * It only suggests: nothing is linked, filed or archived — except that a
 * pilot owner's noise moves to the Noise tab, as the pipeline always does.
 *
 * Resumable batches (the photo-sheet / Drive-sync pattern): the client loops
 * `runCleanupBatch` while `done` is false; each batch spends at most
 * `budgetMs` (40 s) and writes its cursor to the blob `inbox_cleanup:<userId>`
 * = { startedAt, cursor, checked, total, done, ids, … }. The id list is fixed
 * when a run starts (newest activity first), so new mail never shifts the
 * cursor. Re-runnable: pressing it after a finished run (or a day after an
 * abandoned one) starts a new run; threads already filed — or already
 * suggested during this run — are skipped.
 */
import { getBlob, listBlobIds, setBlob } from "@/db/doc-store";
import { get as getThread, getAll as allThreads, visibleTo, type CommThread } from "@/lib/stores/comms";
import { appendFilingLogs, type FilingLogEntry } from "@/lib/stores/inbox-org";
import { AI_CALL_MARGIN_MS, callWorstCaseMs, runAiPass, type AiPassDeps } from "./ai-pass";
import { inInbox } from "./apply";
import { emailMessages, isOrgPilot, loadOrgContext, organizeThread, type OrgContext } from "./pipeline";

export const CLEANUP_BLOB_PREFIX = "inbox_cleanup:";
export const CLEANUP_BUDGET_MS = 40_000;
export const CLEANUP_WINDOW_MS = 90 * 86_400_000;
/** Most threads one run walks (the id list lives in the state blob). */
export const CLEANUP_MAX_THREADS = 5_000;
/** Kept for the AI pass at the end of each batch. */
export const CLEANUP_AI_SHARE_MS = 15_000;
/** An unfinished run older than this starts over instead of resuming. */
export const CLEANUP_STALE_MS = 86_400_000;
/** How long a batch holds the run (a second tab / double click is refused). */
export const CLEANUP_LEASE_EXTRA_MS = 120_000;

export type CleanupSummary = { suggested: number; noise: number; skipped: number; waitingAi: number };

export type CleanupState = {
  startedAt: number;
  /** index into `ids` of the next thread to check */
  cursor: number;
  checked: number;
  total: number;
  done: boolean;
  ids: string[];
  doneAt?: number | null;
  /** epoch-ms: a batch is running until then */
  runningUntil?: number | null;
  summary?: CleanupSummary | null;
  /** the rule suggestions this run made, by source — counted here instead of
   *  the 2,000-entry filing log, so a mass cleanup never evicts the log's
   *  approve / correct / override entries */
  ruleSuggestions?: Record<string, number>;
};

/** What the Organize header shows (no ids). */
export type CleanupVM = {
  startedAt: number;
  checked: number;
  total: number;
  done: boolean;
  doneAt: number | null;
  summary: CleanupSummary | null;
};

export type CleanupBatchResult =
  | { ok: true; checked: number; total: number; done: boolean; summary: CleanupSummary | null; aiCalls: number }
  | { ok: false; error: string };

export type CleanupDeps = {
  ctx?: OrgContext;
  /** provider injection for the AI pass (checks) */
  run?: AiPassDeps["run"];
  /** wall clock for the budget (checks) */
  clock?: () => number;
  /** the time stamped on records / the 90-day window (checks) */
  now?: number;
  /** most threads this batch checks (checks; default unlimited) */
  batchSize?: number;
};

const blobId = (userId: string) => CLEANUP_BLOB_PREFIX + userId;

/* ---- pure ------------------------------------------------------------------- */

/** When the thread was last active: its newest email message, else updatedAt. */
export function lastActivityAt(t: CommThread): number {
  const msgs = emailMessages(t);
  return (msgs.length ? msgs[msgs.length - 1].at : 0) || t.updatedAt || 0;
}

/** Still one of `me`'s cleanup threads: their own personal, live, in-the-inbox
 *  email thread, active in the window, not filed / dismissed. */
export function isCleanupCandidate(t: CommThread, me: { name: string }, now: number): boolean {
  const f = t.filing;
  return (
    visibleTo(t, me.name) &&
    !t.deleted &&
    t.status !== "draft" &&
    inInbox(t) &&
    emailMessages(t).length > 0 &&
    lastActivityAt(t) >= now - CLEANUP_WINDOW_MS &&
    !(f && (f.state === "filed" || f.state === "dismissed"))
  );
}

/** The run's thread ids, newest activity first (id as tie-break), capped. */
export function cleanupCandidates(threads: CommThread[], me: { name: string }, now: number): string[] {
  return threads
    .filter((t) => isCleanupCandidate(t, me, now))
    .sort((a, b) => lastActivityAt(b) - lastActivityAt(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CLEANUP_MAX_THREADS)
    .map((t) => t.id);
}

/** Where a checked thread ended up, for the final summary. */
export function cleanupOutcome(t: CommThread | null | undefined): keyof CleanupSummary {
  if (!t) return "skipped";
  if (t.noise?.flagged && !t.noise.rescued) return "noise";
  const f = t.filing;
  if (f && f.state === "suggested" && !f.noise && (f.customerId || f.work)) return "suggested";
  if (f && f.state === "suggested" && f.pendingAi) return "waitingAi";
  return "skipped";
}

export function summarize(threads: Array<CommThread | null | undefined>): CleanupSummary {
  const s: CleanupSummary = { suggested: 0, noise: 0, skipped: 0, waitingAi: 0 };
  for (const t of threads) s[cleanupOutcome(t)]++;
  return s;
}

export function cleanupVMOf(st: CleanupState | null): CleanupVM | null {
  if (!st || !st.startedAt) return null;
  return {
    startedAt: st.startedAt,
    checked: st.checked || 0,
    total: st.total || 0,
    done: !!st.done,
    doneAt: st.doneAt ?? null,
    summary: st.summary ?? null,
  };
}

/* ---- state ------------------------------------------------------------------- */

export async function getCleanupState(userId: string): Promise<CleanupState | null> {
  const b = await getBlob<Partial<CleanupState>>(blobId(userId), {});
  if (!b || typeof b.startedAt !== "number") return null;
  return {
    startedAt: b.startedAt,
    cursor: Number(b.cursor) || 0,
    checked: Number(b.checked) || 0,
    total: Number(b.total) || 0,
    done: b.done === true,
    ids: Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [],
    doneAt: typeof b.doneAt === "number" ? b.doneAt : null,
    runningUntil: typeof b.runningUntil === "number" ? b.runningUntil : null,
    summary: b.summary && typeof b.summary === "object" ? (b.summary as CleanupSummary) : null,
    ruleSuggestions: b.ruleSuggestions && typeof b.ruleSuggestions === "object" ? (b.ruleSuggestions as Record<string, number>) : {},
  };
}

/**
 * The rule suggestions the 90-day cleanup made in runs that STARTED in the
 * window, summed over every user's state blob, by source. The cleanup counts
 * them here instead of the capped filing log, so the Assist report reads them
 * back from the blobs. Never throws (an unreadable blob counts as none).
 */
export async function cleanupRuleSuggestions(inWindow: (startedAt: number) => boolean): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let ids: string[] = [];
  try {
    ids = await listBlobIds(CLEANUP_BLOB_PREFIX);
  } catch {
    return out;
  }
  for (const id of ids) {
    const st = await getCleanupState(id.slice(CLEANUP_BLOB_PREFIX.length)).catch(() => null);
    if (!st || !inWindow(st.startedAt)) continue;
    for (const [src, n] of Object.entries(st.ruleSuggestions ?? {})) if (Number.isFinite(n) && n > 0) out[src] = (out[src] ?? 0) + n;
  }
  return out;
}

/* ---- one batch ----------------------------------------------------------------- */

/**
 * One budgeted batch for `me` (pilot only). Starts a run when there is none,
 * the last one finished, or it went stale; otherwise resumes at the cursor.
 * Never makes tasks, never links or files. Returns the progress.
 */
export async function runCleanupBatch(
  me: { id: string; name: string },
  budgetMs: number = CLEANUP_BUDGET_MS,
  deps: CleanupDeps = {}
): Promise<CleanupBatchResult> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const now = deps.now ?? Date.now();
  const ctx = deps.ctx ?? (await loadOrgContext());
  if (!isOrgPilot(me.id, "file", ctx)) return { ok: false, error: "Organize my inbox is part of the Assist pilot." };

  // The lease is a plain read-then-write, not atomic: two batches landing
  // in the same instant could both pass. Harmless — organizeThread is
  // idempotent (same record kept), the AI pass holds its own per-thread
  // compare-and-set leases, and the worst case is one run's cursor / counts
  // written twice (a redo of a few threads). It only stops the common case:
  // a double click or a second tab starting a parallel run.
  let st = await getCleanupState(me.id);
  if (st && !st.done && st.runningUntil && st.runningUntil > Date.now()) {
    return { ok: false, error: "Organize my inbox is already running — try again in a minute." };
  }
  const lease = Date.now() + budgetMs + CLEANUP_LEASE_EXTRA_MS;
  if (!st || st.done || now - st.startedAt > CLEANUP_STALE_MS || st.cursor > st.ids.length) {
    const ids = cleanupCandidates(await allThreads(), me, now);
    st = { startedAt: now, cursor: 0, checked: 0, total: ids.length, done: false, ids, doneAt: null, summary: null, runningUntil: lease, ruleSuggestions: {} };
    await setBlob(blobId(me.id), st as unknown as Record<string, unknown>);
  } else {
    await setBlob(blobId(me.id), { runningUntil: lease });
  }

  // the lease is released however the batch ends (an exception included), so
  // the next press resumes at the last saved cursor (organizing is idempotent)
  try {
    const ruleWindow = budgetMs - Math.min(CLEANUP_AI_SHARE_MS, budgetMs / 2);
    const max = deps.batchSize ?? Infinity;
    const log: FilingLogEntry[] = [];
    let i = st.cursor;
    let checked = 0;
    try {
      while (i < st.ids.length && checked < max) {
        if (checked > 0 && clock() - started >= ruleWindow) break;
        const id = st.ids[i];
        const t = await getThread(id);
        const suggestedThisRun = t?.filing?.state === "suggested" && (t.filing.at || 0) >= st.startedAt;
        if (t && isCleanupCandidate(t, me, now) && !suggestedThisRun) {
          try {
            await organizeThread(id, { ctx, backlog: true, log, now });
          } catch (err) {
            console.error("[inbox-org] cleanup: organizing", id, "failed", err);
          }
        }
        i++;
        checked++;
      }
    } finally {
      // the pipeline's own "suggested" entries are counted in the state, not
      // logged (see ruleSuggestions); anything else it collected is logged
      const keep = log.filter((e) => !!e.action || e.outcome !== "suggested");
      try {
        await appendFilingLogs(keep);
      } catch (err) {
        console.error("[inbox-org] cleanup: filing log append failed", err);
      }
    }
    const ruleSuggestions = { ...(st.ruleSuggestions ?? {}) };
    for (const e of log) if (!e.action && e.outcome === "suggested") ruleSuggestions[e.source] = (ruleSuggestions[e.source] ?? 0) + 1;
    const done = i >= st.ids.length;

    // what is left of the budget goes to the AI filing step (filing only — no
    // court reading, no promise-tasks); the rest resumes on the next sync pass
    let aiCalls = 0;
    const left = budgetMs - (clock() - started);
    if (left > 0) {
      const ai = await runAiPass(
        {
          ownerIds: [me.id],
          filingOnly: true,
          budgetMs: left,
          // the Inbox page allows 300 s; a call that starts inside the budget
          // may run its worst case past it
          deadlineMs: started + budgetMs + callWorstCaseMs("file", true) + AI_CALL_MARGIN_MS,
        },
        { ctx, run: deps.run, clock, now: deps.now }
      );
      aiCalls = ai.calls;
    }

    let summary: CleanupSummary | null = null;
    if (done) {
      const want = new Set(st.ids);
      summary = summarize((await allThreads()).filter((t) => want.has(t.id)));
      summary.skipped += st.ids.length - (summary.suggested + summary.noise + summary.skipped + summary.waitingAi);
    }
    const total = Math.max(st.total, st.ids.length);
    const next = {
      cursor: i,
      checked: st.checked + checked,
      total,
      done,
      runningUntil: null,
      ruleSuggestions,
      ...(done ? { doneAt: Date.now(), summary } : {}),
    };
    await setBlob(blobId(me.id), next);
    return { ok: true, checked: next.checked, total, done, summary, aiCalls };
  } catch (err) {
    await setBlob(blobId(me.id), { runningUntil: null }).catch(() => undefined);
    throw err;
  }
}
