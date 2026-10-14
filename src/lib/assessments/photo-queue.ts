"use client";

import { upload } from "@vercel/blob/client";
import { finalizeAssessmentPhoto } from "@/app/(app)/assessments/photo-actions";
import { photoBackoffMs, photoBlobPath } from "./photos";
import { shrinkForInline } from "./photo-resize";

/*
 * Assessment photo queue (#337) — the device half of photo upload, modelled on the Recordings upload queue
 * (`lib/recorder/upload-queue.ts`) and deliberately SEPARATE from the document outbox (`lib/sync`): the photo bytes
 * never ride /api/sync/push, they go straight to private Blob. The assessment's own save carries only the photo's
 * reference (`pending: true`, capture time, links); this queue turns that reference into a file.
 *
 * Persistence: one IndexedDB database `peak-assessment-photos`, store `photos`, key `${assessmentId}/${photoId}`,
 * value `{ assessmentId, photoId, blob, tries, nextAt }` (+ `uploadedPath` once the bytes are on Blob, and
 * `lastError` for the editor to show).
 *
 * Each drain step: `upload()` → the broker route (`/api/assessments/<id>/photos/upload`) hands back a token scoped to
 * `assessments/<id>/<photoId>.jpg` → bytes go device→Blob → `finalizeAssessmentPhoto` (re-reads the file, records the
 * path) → `onDone` (the editor adopts the ref) → THEN the device copy is deleted. A failure at any step bumps `tries`,
 * backs off exponentially (5 s, 10 s, 20 s … capped at 5 min) and keeps the photo. Without Blob (local dev) the
 * shrunken JPEG is finalized as a small inline data URL instead, so dev never touches the production Blob store.
 *
 * `drainPhotos` is single-flight; it runs after every enqueue, on `online`, on the page becoming visible, and when a
 * backed-off photo comes due — once `configurePhotoQueue` has been called by the editor.
 *
 * Client-only: this module must not import a server module (stores / db / blob.ts). The server action is reached
 * through its "use server" file only.
 */

const DB_NAME = "peak-assessment-photos";
const STORE = "photos";

/** What the queue hands the editor once a photo is finished: where its file now lives. */
export type PhotoDoneRef = { blobPath?: string; inline?: string };
export type PhotoDoneHandler = (assessmentId: string, photoId: string, ref: PhotoDoneRef) => Promise<void>;
export type PhotoQueueOptions = { blobEnabled: boolean };

type QueuedPhoto = {
  assessmentId: string;
  photoId: string;
  blob: Blob;
  tries: number;
  /** epoch-ms before which the drain skips this photo (backoff). */
  nextAt: number;
  /** set once the bytes are on Blob and only the finalize is left — a retry never uploads twice. */
  uploadedPath?: string;
  lastError?: string;
};

/** A queued photo as the editor sees it (no bytes). */
export type QueuedPhotoInfo = { assessmentId: string; photoId: string; tries: number; nextAt: number; lastError?: string };

/* ------------------------------------------------------------------ */
/* IndexedDB                                                            */
/* ------------------------------------------------------------------ */

const keyOf = (assessmentId: string, photoId: string) => `${assessmentId}/${photoId}`;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser can't hold photos until they upload."));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null; // a failed open may be retried
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const putItem = (item: QueuedPhoto) => tx("readwrite", (s) => s.put(item, keyOf(item.assessmentId, item.photoId))).then(() => undefined);
const getItem = (a: string, p: string) => tx<QueuedPhoto | undefined>("readonly", (s) => s.get(keyOf(a, p)));
const deleteItem = (a: string, p: string) => tx("readwrite", (s) => s.delete(keyOf(a, p))).then(() => undefined);

async function allItems(): Promise<QueuedPhoto[]> {
  try {
    const rows = await tx<QueuedPhoto[]>("readonly", (s) => s.getAll());
    return rows.filter((r) => r && r.assessmentId && r.photoId && r.blob);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                           */
/* ------------------------------------------------------------------ */

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
async function emit(): Promise<void> {
  if (!listeners.size) return;
  const n = (await allItems()).length;
  for (const l of listeners) {
    try {
      l(n);
    } catch {
      /* a listener must not break the queue */
    }
  }
}

/** Subscribe to the number of photos still on this device (for a "N photos uploading" chip). Returns unsubscribe. */
export function subscribePhotoQueue(cb: Listener): () => void {
  listeners.add(cb);
  void emit();
  return () => {
    listeners.delete(cb);
  };
}

/** Park a resized photo on the device and start uploading it (when the editor has called `configurePhotoQueue`). */
export async function enqueuePhoto(assessmentId: string, photoId: string, blob: Blob): Promise<void> {
  await putItem({ assessmentId, photoId, blob, tries: 0, nextAt: 0 });
  await emit();
  installTriggers();
  void drainConfigured();
}

/** How many photos are still on this device (all assessments, or one). */
export async function pendingPhotoCount(assessmentId?: string): Promise<number> {
  const items = await allItems();
  return assessmentId ? items.filter((i) => i.assessmentId === assessmentId).length : items.length;
}

/** The photos still on this device, without their bytes — the editor shows lastError / retry state from this. */
export async function queuedPhotos(assessmentId?: string): Promise<QueuedPhotoInfo[]> {
  return (await allItems())
    .filter((i) => !assessmentId || i.assessmentId === assessmentId)
    .map((i) => ({ assessmentId: i.assessmentId, photoId: i.photoId, tries: i.tries, nextAt: i.nextAt, ...(i.lastError ? { lastError: i.lastError } : {}) }));
}

/** The device copy of a queued photo (for a thumbnail before it has uploaded), or null once it is gone. */
export async function queuedPhotoBlob(assessmentId: string, photoId: string): Promise<Blob | null> {
  try {
    return (await getItem(assessmentId, photoId))?.blob ?? null;
  } catch {
    return null;
  }
}

/** Throw away a queued photo (the user deleted it, or gave up on a failing one). */
export async function discardPhoto(assessmentId: string, photoId: string): Promise<void> {
  try {
    await deleteItem(assessmentId, photoId);
  } finally {
    await emit();
  }
}

/* ------------------------------------------------------------------ */
/* drain                                                                */
/* ------------------------------------------------------------------ */

function errorMessage(e: unknown): string {
  return ((e as Error)?.message ?? String(e)).slice(0, 300);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("The photo couldn't be read."));
    r.readAsDataURL(blob);
  });
}

/** Local dev without Blob: one inline JPEG data URL, shrunk further when it would be over the 400 KB inline cap. */
const INLINE_BLOB_MAX = 290 * 1024; // base64 grows bytes by 4/3, so this lands under 400 KB

async function uploadOne(item: QueuedPhoto, cfg: { blobEnabled: boolean; onDone: PhotoDoneHandler }): Promise<void> {
  const { assessmentId, photoId } = item;
  let result: Awaited<ReturnType<typeof finalizeAssessmentPhoto>>;
  if (cfg.blobEnabled) {
    let path = item.uploadedPath;
    if (!path) {
      const res = await upload(photoBlobPath(assessmentId, photoId), item.blob, {
        access: "private",
        handleUploadUrl: `/api/assessments/${assessmentId}/photos/upload`,
        clientPayload: JSON.stringify({ photoId }),
        contentType: "image/jpeg",
      });
      path = res.pathname;
      // The bytes are safe on Blob: a failed finalize never re-uploads. (A photo discarded meanwhile stays discarded.)
      if (await getItem(assessmentId, photoId)) await putItem({ ...item, uploadedPath: path });
    }
    result = await finalizeAssessmentPhoto(assessmentId, photoId, path);
  } else {
    const body = item.blob.size > INLINE_BLOB_MAX ? await shrinkForInline(item.blob, INLINE_BLOB_MAX) : item.blob;
    result = await finalizeAssessmentPhoto(assessmentId, photoId, null, await blobToDataUrl(body));
  }
  if (!result.ok) {
    if (result.reupload && item.uploadedPath) await putItem({ ...item, uploadedPath: undefined });
    throw new Error(result.error);
  }
  await cfg.onDone(assessmentId, photoId, result.ref);
  // Only now — the server has the file and the editor knows — may the device copy go.
  await deleteItem(assessmentId, photoId);
}

let draining = false;
let rerun = false;
let wake: ReturnType<typeof setTimeout> | null = null;

/**
 * Upload every due photo, one at a time. Idempotent + single-flight: concurrent callers (online event, visibility
 * change, a fresh enqueue) coalesce into one pass and a second pass runs if anything arrived mid-drain. A photo that
 * fails stays queued with a later `nextAt`; a timer re-runs the drain when the soonest one comes due.
 */
export async function drainPhotos(onDone: PhotoDoneHandler, opts: PhotoQueueOptions): Promise<void> {
  if (typeof window === "undefined") return;
  if (draining) {
    rerun = true;
    return;
  }
  if (!navigator.onLine) return;
  draining = true;
  try {
    for (const item of await allItems()) {
      if (item.nextAt > Date.now()) continue;
      if (!navigator.onLine) break;
      try {
        await uploadOne(item, { blobEnabled: opts.blobEnabled, onDone });
      } catch (e) {
        const cur = await getItem(item.assessmentId, item.photoId).catch(() => undefined);
        if (cur) {
          const tries = cur.tries + 1;
          await putItem({ ...cur, tries, nextAt: Date.now() + photoBackoffMs(tries), lastError: errorMessage(e) }).catch(() => undefined);
        }
      } finally {
        await emit();
      }
    }
  } finally {
    draining = false;
    if (rerun) {
      rerun = false;
      void drainPhotos(onDone, opts);
    } else {
      void scheduleWake(onDone, opts);
    }
  }
}

async function scheduleWake(onDone: PhotoDoneHandler, opts: PhotoQueueOptions): Promise<void> {
  if (wake) {
    clearTimeout(wake);
    wake = null;
  }
  if (config?.onDone !== onDone) return; // only a configured queue wakes itself
  const waiting = (await allItems()).map((i) => i.nextAt).filter((t) => t > Date.now());
  if (!waiting.length) return;
  wake = setTimeout(() => {
    wake = null;
    void drainPhotos(onDone, opts);
  }, Math.max(1000, Math.min(...waiting) - Date.now()));
}

/* ------------------------------------------------------------------ */
/* auto-run                                                             */
/* ------------------------------------------------------------------ */

let config: { blobEnabled: boolean; onDone: PhotoDoneHandler } | null = null;

function drainConfigured(): Promise<void> {
  return config ? drainPhotos(config.onDone, { blobEnabled: config.blobEnabled }) : Promise.resolve();
}

let triggersInstalled = false;
function installTriggers(): void {
  if (triggersInstalled || typeof window === "undefined") return;
  triggersInstalled = true;
  window.addEventListener("online", () => void drainConfigured());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drainConfigured();
  });
}

/**
 * The editor calls this once on mount: `blobEnabled` comes from the server (the editor page passes it as a prop) and
 * `onDone` adopts a finished photo's ref into the editor's state. Starts a drain now and arms the online / visible /
 * backoff triggers. Returns a disposer for unmount (a later configure replaces this one).
 */
export function configurePhotoQueue(cfg: { blobEnabled: boolean; onDone: PhotoDoneHandler }): () => void {
  const mine = { blobEnabled: cfg.blobEnabled, onDone: cfg.onDone };
  config = mine;
  installTriggers();
  void drainConfigured();
  return () => {
    if (config === mine) {
      config = null;
      if (wake) {
        clearTimeout(wake);
        wake = null;
      }
    }
  };
}
