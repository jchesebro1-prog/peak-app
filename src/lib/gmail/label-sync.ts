/**
 * #96 §3 — Peak → Gmail. Mirrors a thread's link/status/assign/work-link as
 * Peak/* labels on its Gmail thread. Never blocks the Peak write: every
 * failure is logged and the next sync pass reconciles.
 */
import { getDoc, patchDoc } from "@/db/doc-store";
import type { CommThread } from "@/lib/stores/comms";
import { GMAIL_MODIFY_SCOPE, gmailEnabled } from "./config";
import { createLabel, listLabels, modifyThread } from "./api";
import { getConnectionInfo, listCachedLabels, replaceLabels } from "./connections";
import { currentPeakLabelNames, desiredPeakLabels, diffLabels, PEAK_PREFIX } from "./peak-labels";

/** Gmail rejects a label name longer than this — skip (and log) rather than
 *  fail the whole sync over one oversized name (e.g. a very long customer
 *  name or work-record id). */
const MAX_LABEL_NAME_LENGTH = 225;

/** Resolve a Peak/* label name to its Gmail label id against a PRELOADED
 *  cache (the caller loads it once and passes it in — avoids one query per
 *  name). Creates the label lazily on the mailbox the first time it's
 *  needed. If Gmail 409s the create ("Label name exists or conflicts" — lost
 *  a race with another sync pass or Gmail's own dedupe), refreshes the
 *  persisted cache and looks the name up there before giving up.
 *
 *  Callers resolving several names MUST do so sequentially (a for...of, not
 *  Promise.all) — parallel creates against the same cache race each other
 *  and Gmail's own 409. */
export async function ensureLabelId(
  key: string,
  name: string,
  cache: { name: string; labelId: string }[]
): Promise<string> {
  const cached = cache.find((l) => l.name === name);
  if (cached) return cached.labelId;
  try {
    const created = await createLabel(key, name);
    return created.id;
  } catch (err) {
    const fresh = await listLabels(key);
    await replaceLabels(key, fresh);
    const match = fresh.find((l) => l.name === name);
    if (match) return match.id;
    throw err;
  }
}

export async function syncPeakLabels(threadId: string): Promise<void> {
  if (!gmailEnabled()) return;
  try {
    const t = await getDoc<CommThread>("comms", threadId);
    if (!t || !t.gmailThreadId || !t.gmailAccountKey) return;
    const key = t.gmailAccountKey;
    const conn = await getConnectionInfo(key);
    if (!conn || !(conn.scope || "").includes(GMAIL_MODIFY_SCOPE)) return;

    const cache = await listCachedLabels(key);
    const idToName = new Map(cache.map((l) => [l.labelId, l.name]));
    const currentNames = currentPeakLabelNames(t.messages || [], idToName);
    const { add: rawAdd, remove } = diffLabels(desiredPeakLabels(t), currentNames);
    const add = rawAdd.filter((n) => {
      if (n.length <= MAX_LABEL_NAME_LENGTH) return true;
      console.error("[gmail] label name exceeds Gmail's limit, skipping:", n);
      return false;
    });
    if (!add.length && !remove.length) return;

    // Resolve/create every new label SEQUENTIALLY against the one preloaded
    // cache — a parallel Promise.all races ensureLabelId against itself.
    const addIds: string[] = [];
    for (const name of add) addIds.push(await ensureLabelId(key, name, cache));

    // One refresh after the loop so the persisted cache reflects every label
    // just created (a 409 inside ensureLabelId may already have refreshed
    // once, but this is the single source of truth for the removal lookup).
    let freshByName: { name: string; labelId: string }[] = cache;
    if (add.length) {
      const fresh = await listLabels(key);
      await replaceLabels(key, fresh);
      freshByName = fresh.map((l) => ({ name: l.name, labelId: l.id }));
    }
    const nameToId = new Map(freshByName.map((l) => [l.name, l.labelId]));
    const removeIds = remove.map((n) => nameToId.get(n)).filter((x): x is string => !!x);

    // Nothing actually resolved to a real id on either side — don't touch
    // Gmail or stamp the thread over a no-op.
    if (!addIds.length && !removeIds.length) return;

    await modifyThread(key, t.gmailThreadId, { addLabelIds: addIds, removeLabelIds: removeIds });
    await patchDoc<CommThread>("comms", t.id, (d) => {
      const keep = (ids: string[] | undefined) =>
        Array.from(new Set([...(ids || []).filter((id) => !removeIds.includes(id)), ...addIds]));
      // Only real Gmail messages carry gmailLabelIds — a Peak-authored
      // message (no gmailId) must never gain a synthetic label list, or the
      // next sync's "current" union would treat it as a real label source.
      d.messages = (d.messages || []).map((m) =>
        m.gmailId ? { ...m, gmailLabelIds: keep(m.gmailLabelIds) } : m
      );
      d.peakLabelsAppliedAt = Date.now();
    });
  } catch (err) {
    console.error("[gmail] peak label sync failed for", threadId, err);
  }
}

/* ---- bounded fan-out ------------------------------------------------------- */

const pendingSyncs = new Set<string>();
let syncChain: Promise<void> = Promise.resolve();

/** Every hook site should call this, not `syncPeakLabels` directly. Coalesces
 *  repeated calls for the same thread while a sync for it is already
 *  queued/in-flight (a no-op Set check), and chains every sync onto one
 *  serial promise so concurrent hooks across different threads never race
 *  each other's label-cache read/refresh. `syncPeakLabels` stays exported
 *  directly for tests. */
export function queueLabelSync(threadId: string): void {
  if (pendingSyncs.has(threadId)) return;
  pendingSyncs.add(threadId);
  syncChain = syncChain.then(() =>
    syncPeakLabels(threadId).finally(() => pendingSyncs.delete(threadId))
  );
}

/** Test hook — number of thread syncs currently queued or in flight. */
export function pendingLabelSyncCount(): number {
  return pendingSyncs.size;
}

export { PEAK_PREFIX };
