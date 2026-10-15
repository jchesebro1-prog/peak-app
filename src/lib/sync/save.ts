"use client";

import { getEngine } from "./engine";
import { SaveTimeoutError, withSaveTimeout } from "./save-timeout";

/**
 * The one seam every offline-capable capture editor saves through. It keeps
 * the prototype's optimistic-local-first contract:
 *
 *  - Online + not paused: run the normal server action (which IS the cloud
 *    write and revalidates the server-rendered UI). On success, mirror the doc
 *    locally and clear any stale outbox entry. If the action fails to reach the
 *    server (dropped signal mid-save), fall through to the outbox.
 *  - Offline or "Work offline": skip the server round-trip entirely and queue
 *    the whole document in the durable outbox; the SyncEngine flushes it to
 *    /api/sync/push on reconnect / unpause.
 *
 * `doc` must be the WHOLE resulting record (not a patch) — /api/sync/push does
 * a whole-document upsert by client id, exactly as the prototype's CloudStore
 * did. The editor already holds the full draft, so it passes that.
 */

export type SaveResult = { queued: boolean };
export type ServerSaveResult = { ok: true } | { ok: false; error: string };

/** Next's redirect()/notFound() throw control-flow errors we must not swallow. */
function isControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

function isOfflineError(e: unknown): boolean {
  // fetch/network failures surface as TypeError in the browser.
  return e instanceof TypeError || !navigator.onLine;
}

export async function saveThroughOutbox(opts: {
  collection: string;
  id: string;
  doc: Record<string, unknown>;
  action: () => Promise<void | ServerSaveResult>;
  /** After a successful online save: true keeps this record's existing outbox entry (the save didn't carry all of
   *  it) for the sync push instead of clearing it. Omitted, the entry is cleared as before. */
  keepOutbox?: (entryDoc: Record<string, unknown>) => boolean;
  /** #344 C-final B: an online action that hasn't answered within this many ms is treated like a lost connection —
   *  the doc goes to the outbox (the late answer, if any, is ignored). Omitted = no limit. */
  timeoutMs?: number;
}): Promise<SaveResult> {
  const engine = getEngine();
  const rev = Number(opts.doc.rev) || 1;

  if (engine.connected()) {
    try {
      const result = await withSaveTimeout(opts.action(), opts.timeoutMs);
      if (result && !result.ok) throw new Error(result.error);
      await engine.recordSynced(opts.collection, opts.id, opts.doc, rev, opts.keepOutbox ? { keepEntry: opts.keepOutbox } : undefined);
      return { queued: false };
    } catch (e) {
      if (isControlFlowError(e)) throw e; // redirect/notFound — let it propagate
      // A real server error surfaces; a timeout (#344 C-final B) is a connection that died without saying so.
      if (!(e instanceof SaveTimeoutError) && !isOfflineError(e)) throw e;
      // Lost the connection during the save — fall through to the outbox.
      await engine.enqueue(opts.collection, opts.id, opts.doc, rev);
      return { queued: true };
    }
  }

  await engine.enqueue(opts.collection, opts.id, opts.doc, rev);
  return { queued: true };
}
