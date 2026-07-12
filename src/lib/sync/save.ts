"use client";

import { getEngine } from "./engine";

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
  action: () => Promise<void>;
}): Promise<SaveResult> {
  const engine = getEngine();
  const rev = Number(opts.doc.rev) || 1;

  if (engine.connected()) {
    try {
      await opts.action();
      await engine.recordSynced(opts.collection, opts.id, opts.doc, rev);
      return { queued: false };
    } catch (e) {
      if (isControlFlowError(e)) throw e; // redirect/notFound — let it propagate
      if (!isOfflineError(e)) throw e; // real server error — surface it
      // Lost the connection during the save — fall through to the outbox.
      await engine.enqueue(opts.collection, opts.id, opts.doc, rev);
      return { queued: true };
    }
  }

  await engine.enqueue(opts.collection, opts.id, opts.doc, rev);
  return { queued: true };
}
