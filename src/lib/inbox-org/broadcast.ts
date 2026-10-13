/**
 * Inbox organization — pop-out readiness (spec §9). Every filing, court,
 * noise or archive change made in the browser posts
 * `{ type: "inbox-changed", threadId }` on `BroadcastChannel("peak")`; the
 * Inbox shell and Home listen and `router.refresh()` (debounced). The
 * pop-out windows of the next spec receive the same message.
 *
 * Browser-only, no imports — safe in the client bundle. Every call is
 * wrapped in try/catch: a browser without BroadcastChannel (or a server
 * render) just does nothing.
 */

export const PEAK_CHANNEL = "peak";

export type InboxChangedMessage = { type: "inbox-changed"; threadId: string };

/** When this window last posted — its own listener skips the echo (the
 *  action that posted already revalidated this window). */
let lastSelfPostAt = 0;
const SELF_ECHO_MS = 1500;

export function postInboxChanged(threadId: string): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    lastSelfPostAt = Date.now();
    const ch = new BroadcastChannel(PEAK_CHANNEL);
    ch.postMessage({ type: "inbox-changed", threadId });
    ch.close();
  } catch {
    // no channel (old browser, private mode quirks) — the page still revalidates
  }
}

export function isInboxChanged(data: unknown): data is InboxChangedMessage {
  return !!data && typeof data === "object" && (data as { type?: unknown }).type === "inbox-changed";
}

/** Listen for inbox changes from other windows/tabs; `onChange` runs at most
 *  once per `debounceMs` burst. Returns the unsubscribe. */
export function subscribeInboxChanged(onChange: () => void, debounceMs = 1000): () => void {
  let ch: BroadcastChannel | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    if (typeof BroadcastChannel === "undefined") return () => {};
    ch = new BroadcastChannel(PEAK_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      if (!isInboxChanged(e.data)) return;
      if (Date.now() - lastSelfPostAt < SELF_ECHO_MS) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, debounceMs);
    };
  } catch {
    return () => {};
  }
  return () => {
    if (timer) clearTimeout(timer);
    try {
      ch?.close();
    } catch {
      // already closed
    }
  };
}
