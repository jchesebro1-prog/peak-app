"use server";

/**
 * #348 slice 4 — the Inbox reader's vendor-file actions. For now only the
 * one-time lazy attachment listing for mail imported before attachments were
 * recorded. It calls Gmail on the OWNER's connection, so it needs `ownThread`
 * (#341: seeing a thread never grants a write).
 */
import { requireUser } from "@/lib/session";
import { patchDoc } from "@/db/doc-store";
import type { CommThread } from "@/lib/stores/comms";
import { gmailEnabled, shouldStampCcFetched } from "@/lib/gmail/config";
import { ownThread } from "@/lib/inbox-thread-guard";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";

/** At most this many messages are listed per call (each is one Gmail messages.get). */
const LIST_PER_CALL = 10;

export async function listThreadAttachmentsAction(threadId: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const me = await requireUser();
  const t = await ownThread(threadId, me);
  if (!t) return { ok: false, error: VENDOR_COPY.notAvailable };
  if (!gmailEnabled()) return { ok: true, changed: false };
  const pending = (t.messages || []).filter((m) => m.gmailId && !m.attsListed && !(m.attachments || []).length).slice(0, LIST_PER_CALL);
  if (!pending.length) return { ok: true, changed: false };
  // Lazy import — the bridge (and the Gmail client) only loads when the env gate is on.
  const { listMessageAttachments } = await import("@/lib/gmail/bridge");
  let changed = false;
  for (const m of pending) {
    try {
      const n = await listMessageAttachments(t.id, m.id);
      if (n) changed = true;
    } catch (err) {
      console.error("[inbox] attachment listing failed", t.id, m.id, err);
      if (shouldStampCcFetched(err)) {
        // Gmail no longer has this message (404) — it will never list, so stop
        // asking. A transient failure is left for the next open.
        await patchDoc<CommThread>("comms", t.id, (d) => {
          const x = (d.messages || []).find((y) => y.id === m.id);
          if (x) x.attsListed = true;
        });
      }
    }
  }
  return { ok: true, changed };
}
