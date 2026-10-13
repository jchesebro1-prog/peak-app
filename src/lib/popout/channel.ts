/**
 * Pop-out windows — the cross-window channel (spec §5). Generalises the old
 * inbox-org broadcast: every window posts what it changed on
 * `BroadcastChannel("peak")`, tagged with its own window id so a window can
 * ignore its own posts (an id, not a time window). Also carries the
 * "Open in main window" request and its ack.
 *
 * Browser-only, no imports — safe in the client bundle. Every channel and
 * storage call is wrapped in try/catch: a browser without BroadcastChannel,
 * blocked storage, or a server render just does nothing.
 */

export const PEAK_CHANNEL = "peak";

export type ChangedEntity = "thread" | "quote" | "customer" | "task" | "inbox";
export type Changed = { type: "changed"; entity: ChangedEntity; id?: string; from: string };
export type OpenInMain = { type: "open-in-main"; url: string; from: string };
export type MainAck = { type: "main-ack"; url: string; from: string };
export type PeakMessage = Changed | OpenInMain | MainAck;

const ENTITIES: readonly string[] = ["thread", "quote", "customer", "task", "inbox"];

let cachedId: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** This window's id: stable for the page (module variable) and across its
 *  reloads (sessionStorage, keyed by window.name so a pop-out never inherits
 *  the opener's copied storage entry). */
export function windowId(): string {
  if (cachedId) return cachedId;
  let key = "peak-window-id";
  try {
    if (typeof window !== "undefined") key += ":" + (window.name || "");
  } catch {
    // keep the plain key
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      const saved = sessionStorage.getItem(key);
      if (saved) return (cachedId = saved);
    }
  } catch {
    // storage blocked
  }
  const id = randomId();
  cachedId = id;
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, id);
  } catch {
    // storage blocked — the module variable still holds
  }
  return id;
}

/** True for a message another window posted (never this window's own). */
export function isFromOthers(msg: { from?: unknown }, myId: string): boolean {
  return typeof msg.from === "string" && msg.from !== myId;
}

/** Normalise a received payload: the current messages as-is when well-formed,
 *  the legacy `{type:"inbox-changed", threadId}` mapped to changed/thread
 *  (empty id → changed/inbox), anything else null. */
export function parseMessage(data: unknown): PeakMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type === "inbox-changed") {
    const threadId = typeof d.threadId === "string" ? d.threadId : "";
    return threadId
      ? { type: "changed", entity: "thread", id: threadId, from: "legacy" }
      : { type: "changed", entity: "inbox", from: "legacy" };
  }
  if (typeof d.from !== "string") return null;
  if (d.type === "changed" && typeof d.entity === "string" && ENTITIES.includes(d.entity)) {
    return {
      type: "changed",
      entity: d.entity as ChangedEntity,
      ...(typeof d.id === "string" ? { id: d.id } : {}),
      from: d.from,
    };
  }
  if ((d.type === "open-in-main" || d.type === "main-ack") && typeof d.url === "string") {
    return { type: d.type, url: d.url, from: d.from };
  }
  return null;
}

function post(msg: PeakMessage): boolean {
  try {
    if (typeof BroadcastChannel === "undefined") return false;
    const ch = new BroadcastChannel(PEAK_CHANNEL);
    ch.postMessage(msg);
    ch.close();
    return true;
  } catch {
    // no channel (old browser, private mode quirks) — the page still revalidates
    return false;
  }
}

/** Tell other windows something changed (call after a successful save only). */
export function postChanged(entity: ChangedEntity, id?: string): void {
  post({ type: "changed", entity, ...(id ? { id } : {}), from: windowId() });
}

/** Ask the main window (any window without pk-pop) to navigate to `url`.
 *  Resolves true when a main window acks within `ackMs`, false otherwise —
 *  the caller then opens `url` in a normal tab. */
export function postOpenInMain(url: string, ackMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let off: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      off();
      resolve(v);
    };
    off = onMessage((m) => {
      if (m.type === "main-ack" && m.url === url) finish(true);
    });
    if (!post({ type: "open-in-main", url, from: windowId() })) return finish(false);
    timer = setTimeout(() => finish(false), ackMs);
  });
}

/** The main window's reply to an open-in-main request. */
export function postMainAck(url: string): void {
  post({ type: "main-ack", url, from: windowId() });
}

/** Listen for messages other windows post (this window's own are dropped).
 *  Returns the unsubscribe. */
export function onMessage(handler: (msg: PeakMessage) => void): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel === "undefined") return () => {};
    ch = new BroadcastChannel(PEAK_CHANNEL);
    const me = windowId();
    ch.onmessage = (e: MessageEvent) => {
      const m = parseMessage(e.data);
      if (!m) return;
      if (m.from !== "legacy" && !isFromOthers(m, me)) return;
      try {
        handler(m);
      } catch {
        // a bad handler must not break the channel
      }
    };
  } catch {
    return () => {};
  }
  return () => {
    try {
      ch?.close();
    } catch {
      // already closed
    }
  };
}
