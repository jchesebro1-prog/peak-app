import { allRecordings, needsKrispCheck, type RecordingRecord } from "@/lib/stores/recordings";
import { checkRecording } from "./check";

/**
 * Server-side reconcile pass (Recordings spec §3.2) — the poller behind both
 * the Home-load stale check and the `/api/gmail/sync` cron step. Picks every
 * importing/processing recording not checked within RECONCILE_STALE_MS plus
 * every pending one whose audio is already in Blob (the relay never started:
 * no key at the time, a busy lock, a dev machine without the Blob webhook),
 * groups them by recorder, and checks at most RECONCILE_PER_USER_CAP per
 * recorder per pass, sequentially within a recorder — the 5 req/s limit is
 * per Krisp ACCOUNT, so recorders run independently of each other.
 *
 * Never throws: a recording that errors counts as failed and the pass moves
 * on, so a Krisp hiccup can never fail the Gmail sync this cron exists for.
 */

export type ReconcileResult = {
  checked: number;
  started: number;
  ready: number;
  failed: number;
  skipped: string | null;
};

export const RECONCILE_STALE_MS = 2 * 60_000;
export const RECONCILE_PER_USER_CAP = 5;
export const RECONCILE_MIN_INTERVAL_MS = 2 * 60_000;

/** Pure selection over the recordings list — exported for the spec tests. */
export function selectForReconcile(
  list: readonly RecordingRecord[],
  opts: { staleMs?: number; cap?: number } = {},
  at: number = Date.now()
): Map<string, RecordingRecord[]> {
  const staleMs = opts.staleMs ?? RECONCILE_STALE_MS;
  const cap = opts.cap ?? RECONCILE_PER_USER_CAP;
  const stale = list
    .filter((r) => needsKrispCheck(r, staleMs, at))
    .sort((a, b) => (a.krisp.lastCheckedAt ?? 0) - (b.krisp.lastCheckedAt ?? 0));
  const pending = list
    .filter((r) => r.krisp.status === "pending" && r.audio.state === "uploaded" && !!r.audio.blobPathname)
    .sort((a, b) => a.createdAt - b.createdAt);
  const byUser = new Map<string, RecordingRecord[]>();
  for (const r of [...stale, ...pending]) {
    const bucket = byUser.get(r.recordedByUserId) ?? [];
    if (bucket.length >= cap) continue;
    bucket.push(r);
    byUser.set(r.recordedByUserId, bucket);
  }
  return byUser;
}

export async function reconcileRecordings(): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, started: 0, ready: 0, failed: 0, skipped: null };
  try {
    const byUser = selectForReconcile(await allRecordings());
    if (!byUser.size) return { ...result, skipped: "no processing recordings" };

    await Promise.all(
      [...byUser.values()].map(async (recs) => {
        for (const rec of recs) {
          const before = rec.krisp.status;
          try {
            const r = await checkRecording(rec.id);
            result.checked += 1;
            if (before === "pending" && r.status !== "pending") result.started += 1;
            if (r.status === "ready" && before !== "ready") result.ready += 1;
            if (r.status === "failed") result.failed += 1;
            if (r.rateLimited) break; // this account is throttled — the rest wait for the next pass
          } catch (err) {
            result.checked += 1;
            result.failed += 1;
            console.error(`[krisp] reconcile ${rec.id} failed:`, err);
          }
        }
      })
    );
    return result;
  } catch (err) {
    console.error("[krisp] reconcile pass failed:", err);
    return { ...result, skipped: `error: ${(err as Error)?.message || String(err)}` };
  }
}

let lastRunAt = 0;

/**
 * Home-load hook (spec §3.2, the `checkMailIfStale` idiom): runs the pass at
 * most once per RECONCILE_MIN_INTERVAL_MS per server instance and returns
 * null when it was too soon. The stamp is taken BEFORE the pass so
 * concurrent Home renders don't all run it.
 */
export async function reconcileRecordingsIfStale(): Promise<ReconcileResult | null> {
  const now = Date.now();
  if (now - lastRunAt < RECONCILE_MIN_INTERVAL_MS) return null;
  lastRunAt = now;
  return reconcileRecordings();
}
