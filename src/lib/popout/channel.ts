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

/** The sessionStorage key holding this window's `{id, name}`. */
export const WINDOW_ID_KEY = "peak-window-id";

/** The slice of Storage `windowIdFor` needs (sessionStorage in the browser). */
export type IdStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** The window id for a window called `name`, given its sessionStorage.
 *  Stored as `{id, name}` under one key; when the stored name differs from
 *  the current one a fresh id is minted (a pop-out whose sessionStorage was
 *  copied from its opener, session restore into a renamed window, a
 *  cross-site navigation that cleared `window.name`). A duplicated unnamed
 *  tab copies `{id, name: ""}` and keeps the same id — accepted: the two tabs
 *  then ignore each other's posts, and the focus refresh keeps them current. */
export function windowIdFor(name: string, storage: IdStorage | null | undefined): string {
  if (storage) {
    try {
      const raw = storage.getItem(WINDOW_ID_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { id?: unknown; name?: unknown } | null;
        if (saved && typeof saved.id === "string" && saved.id && saved.name === name) return saved.id;
      }
    } catch {
      // blocked storage or a junk entry — mint a fresh id
    }
  }
  const id = randomId();
  if (storage) {
    try {
      storage.setItem(WINDOW_ID_KEY, JSON.stringify({ id, name }));
    } catch {
      // storage blocked — the caller's module variable still holds
    }
  }
  return id;
}

/** This window's id: stable for the page (module variable) and across its
 *  reloads (sessionStorage, see `windowIdFor`). */
export function windowId(): string {
  if (cachedId) return cachedId;
  let name = "";
  try {
    if (typeof window !== "undefined") name = window.name || "";
  } catch {
    // keep ""
  }
  let storage: IdStorage | null = null;
  try {
    if (typeof sessionStorage !== "undefined") storage = sessionStorage;
  } catch {
    // storage blocked
  }
  return (cachedId = windowIdFor(name, storage));
}

/** Tests only: forget the cached id so the next `windowId()` re-reads. */
export function __resetWindowIdForTests(): void {
  cachedId = null;
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

/** Ask the main window to navigate to `url`. Only the most recently focused
 *  main window (not a pop-out) answers — see `shouldAnswerOpenInMain` in
 *  live.ts. Resolves true when it acks within `ackMs`, false otherwise — the
 *  caller then opens `url` in a normal tab. */
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
