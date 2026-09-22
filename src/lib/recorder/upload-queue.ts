"use client";

import { upload } from "@vercel/blob/client";
import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";
import { markUploadErrorAction, markUploadedAction } from "@/app/(app)/recordings/capture-actions";
import { recordingBlobPathname, uploadBackoffMs } from "./helpers";
import type { RecordedFile } from "./port";

/**
 * Device upload queue (Recordings spec §2.3). Deliberately SEPARATE from the
 * doc-sync outbox (`lib/sync`) — payloads are tens of MB and go straight to
 * Vercel Blob, never through /api/sync/push.
 *
 * Persistence:
 *  - the item list lives in Capacitor Preferences (native) or localStorage
 *    (web) under QUEUE_KEY — small JSON, survives restarts;
 *  - a web capture's Blob is parked in its own IndexedDB store keyed by
 *    `file.blobKey`; a native capture is referenced by its path inside
 *    Directory.Data (native-recorder.ts already moved it out of cache).
 *
 * Each drain step: POST /api/recordings/upload (via `upload()` from
 * @vercel/blob/client — the route hands back a scoped client token) → the
 * bytes go device→Blob directly (multipart) → `markUploadedAction` (the
 * belt-and-braces twin of the route's `onUploadCompleted`, which Vercel
 * cannot deliver to a dev machine) → THEN the device copy is deleted (§7:
 * "device file delete strictly after doc uploaded"). Failures bump
 * `attempts`, stamp `lastError`, back off exponentially and keep the file.
 *
 * `drainUploadQueue()` is idempotent and single-flight; it runs after every
 * enqueue, on `online`, and when the page becomes visible again.
 */

export const QUEUE_KEY = "peak-recording-uploads-v1";
const BLOB_DB = "peak-recording-blobs";
const BLOB_STORE = "blobs";

export type QueuedFile = { kind: "native"; path: string } | { kind: "web"; blobKey: string };

export type UploadQueueItem = {
  recordingId: string;
  file: QueuedFile;
  mime: string;
  sizeBytes: number;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  /** epoch-ms before which the drain skips this item (backoff). */
  nextAttemptAt: number;
};

export type UploadQueueSnapshot = {
  items: UploadQueueItem[];
  draining: boolean;
  /** recordingId currently on the wire, with 0–100 progress when known. */
  active: { recordingId: string; percentage: number } | null;
};

/* ------------------------------------------------------------------ */
/* persistence                                                          */
/* ------------------------------------------------------------------ */

async function readList(): Promise<UploadQueueItem[]> {
  try {
    let raw: string | null = null;
    if (isNativePlatform()) {
      const { Preferences } = await import("@capacitor/preferences");
      raw = (await Preferences.get({ key: QUEUE_KEY })).value;
    } else if (typeof localStorage !== "undefined") {
      raw = localStorage.getItem(QUEUE_KEY);
    }
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as UploadQueueItem[]).filter((i) => i && i.recordingId) : [];
  } catch {
    return [];
  }
}

async function writeList(items: UploadQueueItem[]): Promise<void> {
  const raw = JSON.stringify(items);
  try {
    if (isNativePlatform()) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: QUEUE_KEY, value: raw });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(QUEUE_KEY, raw);
    }
  } catch (e) {
    console.warn("[upload-queue] persist failed", e);
  }
}

/* web blob parking — its own tiny IndexedDB (the sync outbox's DB has a fixed schema) */

let blobDb: Promise<IDBDatabase> | null = null;
function openBlobDb(): Promise<IDBDatabase> {
  if (blobDb) return blobDb;
  blobDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(BLOB_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BLOB_STORE)) req.result.createObjectStore(BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return blobDb;
}
function blobTx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openBlobDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(BLOB_STORE, mode).objectStore(BLOB_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}
async function putBlob(key: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable — cannot park the recording.");
  await blobTx("readwrite", (s) => s.put(blob, key));
}
async function getBlob(key: string): Promise<Blob | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return blobTx<Blob | undefined>("readonly", (s) => s.get(key));
}
async function deleteBlob(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await blobTx("readwrite", (s) => s.delete(key));
}

/* ------------------------------------------------------------------ */
/* subscriptions                                                        */
/* ------------------------------------------------------------------ */

type Listener = (s: UploadQueueSnapshot) => void;
const listeners = new Set<Listener>();
let draining = false;
let active: UploadQueueSnapshot["active"] = null;
let cached: UploadQueueItem[] = [];

async function emit(): Promise<void> {
  cached = await readList();
  const snap: UploadQueueSnapshot = { items: cached, draining, active };
  for (const l of listeners) {
    try {
      l(snap);
    } catch {
      /* a listener must not break the queue */
    }
  }
}

/** Subscribe to queue state (for a status chip / the record page). Returns unsubscribe. */
export function subscribeUploadQueue(cb: Listener): () => void {
  listeners.add(cb);
  installTriggers();
  void emit();
  return () => {
    listeners.delete(cb);
  };
}

/** Read-only peek without subscribing. */
export async function uploadQueueSnapshot(): Promise<UploadQueueSnapshot> {
  return { items: await readList(), draining, active };
}

let triggersInstalled = false;
function installTriggers(): void {
  if (triggersInstalled || typeof window === "undefined") return;
  triggersInstalled = true;
  window.addEventListener("online", () => void drainUploadQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drainUploadQueue();
  });
}

/* ------------------------------------------------------------------ */
/* enqueue                                                              */
/* ------------------------------------------------------------------ */

export async function enqueueUpload(input: {
  recordingId: string;
  file: RecordedFile;
  mime: string;
  sizeBytes: number;
}): Promise<UploadQueueItem> {
  installTriggers();
  let file: QueuedFile;
  let sizeBytes = input.sizeBytes;
  if (input.file.kind === "web") {
    const blobKey = `blob-${input.recordingId}`;
    await putBlob(blobKey, input.file.blob);
    file = { kind: "web", blobKey };
    sizeBytes = sizeBytes || input.file.blob.size;
  } else {
    file = { kind: "native", path: input.file.path };
  }
  const item: UploadQueueItem = {
    recordingId: input.recordingId,
    file,
    mime: input.mime,
    sizeBytes,
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    nextAttemptAt: 0,
  };
  const list = (await readList()).filter((i) => i.recordingId !== input.recordingId);
  list.push(item);
  await writeList(list);
  await emit();
  void drainUploadQueue();
  return item;
}

/** Drop an item and its device copy (used after a successful upload; exported for a manual "discard"). */
export async function removeUpload(recordingId: string): Promise<void> {
  const list = await readList();
  const item = list.find((i) => i.recordingId === recordingId);
  if (item) await deleteDeviceFile(item.file);
  await writeList(list.filter((i) => i.recordingId !== recordingId));
  await emit();
}

/* ------------------------------------------------------------------ */
/* drain                                                                */
/* ------------------------------------------------------------------ */

/**
 * Materialise the queued file as a Blob for `upload()`.
 *
 * Native: prefer `fetch(Capacitor.convertFileSrc(uri))`, which streams the
 * file through the WebView's local scheme without a base64 round-trip. If
 * that fails, fall back to `Filesystem.readFile` → base64 → bytes. MEMORY
 * TRADE-OFF: the fallback holds the base64 string (~1.33× file size) plus the
 * decoded bytes at once — roughly 120 MB of JS heap for a 50 MB take. Fine
 * for a phone with the app foregrounded; it is why the recorder caps bitrate
 * at 96 kbps (~43 MB/hour) and why the queue uploads one item at a time.
 */
async function loadBody(file: QueuedFile, mime: string): Promise<Blob> {
  if (file.kind === "web") {
    const blob = await getBlob(file.blobKey);
    if (!blob) throw new Error("Recording is no longer on this device.");
    return blob;
  }
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { uri } = await Filesystem.getUri({ path: file.path, directory: Directory.Data });
  try {
    const res = await fetch(Capacitor.convertFileSrc(uri));
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) return blob.type ? blob : new Blob([blob], { type: mime });
    }
  } catch {
    /* fall through to the base64 path */
  }
  const { data } = await Filesystem.readFile({ path: file.path, directory: Directory.Data });
  if (data instanceof Blob) return data;
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function deleteDeviceFile(file: QueuedFile): Promise<void> {
  try {
    if (file.kind === "web") {
      await deleteBlob(file.blobKey);
    } else {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.deleteFile({ path: file.path, directory: Directory.Data });
    }
  } catch (e) {
    console.warn("[upload-queue] could not delete device copy", e);
  }
}

function errorMessage(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  return msg.slice(0, 300);
}

async function uploadOne(item: UploadQueueItem): Promise<void> {
  const body = await loadBody(item.file, item.mime);
  const sizeBytes = item.sizeBytes || body.size;
  active = { recordingId: item.recordingId, percentage: 0 };
  await emit();
  const result = await upload(recordingBlobPathname(item.recordingId, item.mime), body, {
    access: "private",
    handleUploadUrl: "/api/recordings/upload",
    clientPayload: JSON.stringify({ recordingId: item.recordingId }),
    contentType: item.mime.split(";")[0],
    multipart: true,
    onUploadProgress: ({ percentage }) => {
      active = { recordingId: item.recordingId, percentage: Math.round(percentage) };
      for (const l of listeners) l({ items: cached, draining, active });
    },
  });
  // Belt and braces with the route's onUploadCompleted (which Vercel cannot
  // reach on localhost). Both are idempotent (markUploaded).
  const marked = await markUploadedAction(item.recordingId, result.pathname, sizeBytes);
  if (!marked.ok) throw new Error(marked.error);
  // Only now (doc reads `uploaded`) may the device copy go — spec §7.
  await deleteDeviceFile(item.file);
}

/**
 * Push every due item. Idempotent + single-flight: concurrent callers (online
 * event, visibility change, a fresh enqueue) coalesce into one pass, and a
 * second pass is scheduled if anything arrived mid-drain.
 */
let rerun = false;
export async function drainUploadQueue(): Promise<void> {
  if (typeof window === "undefined") return;
  if (draining) {
    rerun = true;
    return;
  }
  if (!navigator.onLine) return;
  draining = true;
  await emit();
  try {
    let list = await readList();
    for (const item of list) {
      if (item.nextAttemptAt > Date.now()) continue;
      if (!navigator.onLine) break;
      try {
        await uploadOne(item);
        list = (await readList()).filter((i) => i.recordingId !== item.recordingId);
        await writeList(list);
      } catch (e) {
        const message = errorMessage(e);
        list = await readList();
        const cur = list.find((i) => i.recordingId === item.recordingId);
        if (cur) {
          cur.attempts += 1;
          cur.lastError = message;
          cur.nextAttemptAt = Date.now() + uploadBackoffMs(cur.attempts);
          await writeList(list);
        }
        // Best effort: let the record show why it is still "On device".
        void markUploadErrorAction(item.recordingId, message).catch(() => undefined);
      } finally {
        active = null;
        await emit();
      }
    }
  } finally {
    draining = false;
    active = null;
    await emit();
    if (rerun) {
      rerun = false;
      void drainUploadQueue();
    }
  }
}

/** Is this recording still waiting on the device? (for the record page's chip) */
export async function pendingUploadFor(recordingId: string): Promise<UploadQueueItem | null> {
  return (await readList()).find((i) => i.recordingId === recordingId) ?? null;
}
