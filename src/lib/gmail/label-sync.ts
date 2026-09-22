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
import { desiredPeakLabels, diffLabels, PEAK_PREFIX } from "./peak-labels";

/** Gmail rejects a label name longer than this — skip (and log) rather than
 *  fail the whole sync over one oversized name (e.g. a very long customer
 *  name or work-record id). */
const MAX_LABEL_NAME_LENGTH = 225;

/** Resolve a Peak/* label name to its Gmail label id, creating it lazily on
 *  the mailbox (and refreshing the label cache) the first time it's needed.
 *  The `gmail_labels` cache (listCachedLabels/replaceLabels) IS the map from
 *  label name to Gmail id — no separate column is kept on gmail_connections. */
export async function ensureLabelId(key: string, name: string): Promise<string> {
  const cached = (await listCachedLabels(key)).find((l) => l.name === name);
  if (cached) return cached.labelId;
  const created = await createLabel(key, name);
  await replaceLabels(key, await listLabels(key));
  return created.id;
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
    const newest = [...(t.messages || [])].sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    const currentNames = (newest?.gmailLabelIds || []).map((id) => idToName.get(id) || id);
    const { add: rawAdd, remove } = diffLabels(desiredPeakLabels(t), currentNames);
    const add = rawAdd.filter((n) => {
      if (n.length <= MAX_LABEL_NAME_LENGTH) return true;
      console.error("[gmail] label name exceeds Gmail's limit, skipping:", n);
      return false;
    });
    if (!add.length && !remove.length) return;
    const addIds = await Promise.all(add.map((n) => ensureLabelId(key, n)));
    const nameToId = new Map((await listCachedLabels(key)).map((l) => [l.name, l.labelId]));
    const removeIds = remove.map((n) => nameToId.get(n)).filter((x): x is string => !!x);
    await modifyThread(key, t.gmailThreadId, { addLabelIds: addIds, removeLabelIds: removeIds });
    await patchDoc<CommThread>("comms", t.id, (d) => {
      const keep = (ids: string[] | undefined) =>
        Array.from(new Set([...(ids || []).filter((id) => !removeIds.includes(id)), ...addIds]));
      d.messages = (d.messages || []).map((m) => ({ ...m, gmailLabelIds: keep(m.gmailLabelIds) }));
      d.peakLabelsAppliedAt = Date.now();
    });
  } catch (err) {
    console.error("[gmail] peak label sync failed for", threadId, err);
  }
}

export { PEAK_PREFIX };
