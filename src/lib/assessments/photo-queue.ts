"use client";

import { upload } from "@vercel/blob/client";
import { finalizeAssessmentPhoto, removePendingPhotoAction } from "@/app/(app)/assessments/photo-actions";
import { finalizeSurveyFile } from "@/app/(app)/venue-assessments/file-actions";
import { INLINE_BLOB_MAX, photoBackoffMs, photoTooOld } from "./photos";
import { INLINE_CAPS, fileBlobPath, fileContentType, fileRouteKind, inlinePrefix, recordKind } from "@/lib/field-files/files";
import { shrinkForInline } from "./photo-resize";

/*
 * Assessment photo queue (#340) — the device half of photo upload, modelled on the Recordings upload queue
 * (`lib/recorder/upload-queue.ts`) and deliberately SEPARATE from the document outbox (`lib/sync`): the photo bytes
 * never ride /api/sync/push, they go straight to private Blob. The assessment's own save carries only the photo's
 * reference (`pending: true`, capture time, links); this queue turns that reference into a file.
 *
 * Persistence: one IndexedDB database `peak-assessment-photos` (v2) with two stores keyed `${assessmentId}/${photoId}`:
 * `photoBlobs` (the JPEG bytes only) and `photoMeta` (`{ assessmentId, photoId, createdAt, tries, nextAt }` +
 * `uploadedPath` once the bytes are on Blob, `lastError`, `failed`). Counts, listings and the drain read only the
 * meta store, so no pass ever loads every photo's bytes; a blob is read for the one item being uploaded.
 *
 * Each drain step: `upload()` (aborted after 60 s) → the broker route (`/api/assessments/<id>/photos/upload`) hands
 * back a token scoped to `assessments/<id>/<photoId>.jpg` → bytes go device→Blob → `finalizeAssessmentPhoto` (30 s
 * cap; re-reads the file, records the path) → `onDone` (the editor adopts the ref and the new rev) → THEN the device
 * copy is deleted. A retryable failure bumps `tries` and backs off exponentially (5 s, 10 s, 20 s … capped at 5 min)
 * and keeps the photo. A TERMINAL failure (the server says no retry can succeed, or the photo is over 7 days old)
 * marks it `failed`: the drain and the wake timer skip it, the bytes stay on the device, and the editor offers
 * `retryPhoto` / `discardPhoto`. Without Blob (local dev) the shrunken JPEG is finalized as a small inline data URL
 * instead, so dev never touches the production Blob store.
 *
 * `drainPhotos` is single-flight; it runs after every enqueue, on `online`, on the page becoming visible (both reset
 * the backoff of every non-failed photo so recovery is immediate), and when a backed-off photo comes due — once
 * `configurePhotoQueue` has been called by the editor.
 *
 * Files of a record (#344 C4): an item is any file of an assessment (`AS-…`, photos) or a survey (`FS-…`: photos,
 * markup images, strokes JSON, sketches). The record's kind is read from its id prefix (`recordKind`) and picks the
 * broker and the finalize: `assessment` → `/api/assessments/<id>/photos/upload` (`{photoId}`) +
 * `finalizeAssessmentPhoto` — exactly as before; `survey` → `/api/surveys/<id>/files/upload` (`{fileId}`) +
 * `finalizeSurveyFile`. The upload path is `fileBlobPath(recordId, fileId)` (an assessment photo's is unchanged:
 * `assessments/<AS>/<p_…>.jpg`). The database, its version, stores and keys are unchanged; the meta's `assessmentId` /
 * `photoId` fields hold the record id / file id (kept, so photos already queued on a device still drain), plus an
 * optional `contentType` (absent = `image/jpeg`; set only for a strokes `k_` file). Without Blob a `.jpg` file is
 * shrunk + inlined as before, a `.json` one inlined as a `data:application/json;base64,…` string ≤ INLINE_CAPS.json.
 *
 * ONE queue drains every record's files whichever editor configured it, so an `onDone` handler is called for files
 * of OTHER records and kinds too and must ignore any `recordId` it doesn't own (the server has already recorded the
 * file either way).
 *
 * Client-only: this module must not import a server module (stores / db / blob.ts). The server actions are reached
 * through their "use server" file only.
 */

const DB_NAME = "peak-assessment-photos";
const BLOBS = "photoBlobs";
const META = "photoMeta";
const UPLOAD_TIMEOUT_MS = 60_000;
const FINALIZE_TIMEOUT_MS = 30_000;

/** What the queue hands the editor once a photo is finished: where its file now lives. */
export type PhotoDoneRef = { blobPath?: string; inline?: string };
/** `rev` is the assessment's stored rev after the finalize, for the editor to adopt. */
export type PhotoDoneHandler = (assessmentId: string, photoId: string, ref: PhotoDoneRef, rev: number) => Promise<void>;
export type PhotoQueueOptions = { blobEnabled: boolean };

type PhotoMeta = {
  /** the record id (`AS-…` / `FS-…`) — field name kept for photos already queued on a device */
  assessmentId: string;
  /** the file id (`p_` / `m_` / `k_` / `s_`) */
  photoId: string;
  /** absent = image/jpeg (every assessment photo); `application/json` for a strokes file */
  contentType?: string;
  /** epoch-ms the photo was parked; an item older than 7 days is given up on. */
  createdAt: number;
  tries: number;
  /** epoch-ms before which the drain skips this photo (backoff). */
  nextAt: number;
  /** set once the bytes are on Blob and only the finalize is left — a retry never uploads twice. */
  uploadedPath?: string;
  lastError?: string;
  /** a terminal failure: skipped by the drain, bytes kept, the editor decides (retry / discard). */
  failed?: true;
};

/** A queued photo as the editor sees it (no bytes). */
export type QueuedPhotoInfo = { assessmentId: string; photoId: string; tries: number; nextAt: number; lastError?: string; failed?: true };
/** A photo the queue gave up on. */
export type FailedPhotoInfo = { assessmentId: string; photoId: string; lastError: string };

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
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains("photos")) db.deleteObjectStore("photos"); // v1 held whole records; nothing shipped on it
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null; // a failed open may be retried
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Park the bytes and their meta in one transaction. */
async function putNew(meta: PhotoMeta, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([BLOBS, META], "readwrite");
    const key = keyOf(meta.assessmentId, meta.photoId);
    t.objectStore(BLOBS).put(blob, key);
    t.objectStore(META).put(meta, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("The photo couldn't be saved on this device."));
  });
}

/** Read-modify-write one meta row in a single transaction; a row that is gone stays gone (a discarded photo is never resurrected). */
async function patchMeta(a: string, p: string, patch: (m: PhotoMeta) => PhotoMeta): Promise<PhotoMeta | null> {
  const db = await openDb();
  return new Promise<PhotoMeta | null>((resolve, reject) => {
    const t = db.transaction(META, "readwrite");
    const store = t.objectStore(META);
    let out: PhotoMeta | null = null;
    const get = store.get(keyOf(a, p));
    get.onsuccess = () => {
      const cur = get.result as PhotoMeta | undefined;
      if (!cur) return;
      out = patch(cur);
      store.put(out, keyOf(a, p));
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("The photo queue couldn't be updated."));
  });
}

async function deleteItem(a: string, p: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([BLOBS, META], "readwrite");
    t.objectStore(BLOBS).delete(keyOf(a, p));
    t.objectStore(META).delete(keyOf(a, p));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("The photo couldn't be removed from this device."));
  });
}

const getBlob = (a: string, p: string) => tx<Blob | undefined>(BLOBS, "readonly", (s) => s.get(keyOf(a, p)));

async function allMeta(): Promise<PhotoMeta[]> {
  try {
    const rows = await tx<PhotoMeta[]>(META, "readonly", (s) => s.getAll());
    return rows.filter((r) => r && r.assessmentId && r.photoId).sort((x, y) => x.createdAt - y.createdAt);
  } catch {
    return [];
  }
}

/** Counts come from the meta store's keys/count — never the bytes. */
async function countItems(assessmentId?: string): Promise<number> {
  try {
    if (!assessmentId) return await tx<number>(META, "readonly", (s) => s.count());
    const prefix = `${assessmentId}/`;
    return await tx<number>(META, "readonly", (s) => s.count(IDBKeyRange.bound(prefix, prefix + "￿")));
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                           */
/* ------------------------------------------------------------------ */

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
async function emit(): Promise<void> {
  if (!listeners.size) return;
  const n = await countItems();
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

/** Park a file of a record (a resized photo, a markup / sketch JPEG, a strokes JSON) on the device and start uploading
 *  it (when an editor has called `configurePhotoQueue`). `recordId` is an `AS-…` or `FS-…` id. */
export async function enqueuePhoto(recordId: string, fileId: string, blob: Blob): Promise<void> {
  const contentType = fileContentType(fileId);
  await putNew({ assessmentId: recordId, photoId: fileId, createdAt: Date.now(), tries: 0, nextAt: 0, ...(contentType !== "image/jpeg" ? { contentType } : {}) }, blob);
  await emit();
  installTriggers();
  void drainConfigured();
}

/** `enqueuePhoto` by its general name: any file of an assessment or survey. */
export const enqueueFile = enqueuePhoto;

/** How many photos are still on this device (all assessments, or one) — failed ones included: they still block Mark complete. */
export function pendingPhotoCount(assessmentId?: string): Promise<number> {
  return countItems(assessmentId);
}

/** The photos still on this device, without their bytes — the editor shows lastError / retry state from this. */
export async function queuedPhotos(assessmentId?: string): Promise<QueuedPhotoInfo[]> {
  return (await allMeta())
    .filter((i) => !assessmentId || i.assessmentId === assessmentId)
    .map((i) => ({
      assessmentId: i.assessmentId,
      photoId: i.photoId,
      tries: i.tries,
      nextAt: i.nextAt,
      ...(i.lastError ? { lastError: i.lastError } : {}),
      ...(i.failed ? { failed: true as const } : {}),
    }));
}

/** The photos the queue has given up on (terminal failure or older than 7 days). Their bytes are still here. */
export async function failedPhotos(): Promise<FailedPhotoInfo[]> {
  return (await allMeta()).filter((i) => i.failed).map((i) => ({ assessmentId: i.assessmentId, photoId: i.photoId, lastError: i.lastError ?? "Upload failed" }));
}

/** The device copy of a queued photo (for a thumbnail before it has uploaded), or null once it is gone. */
export async function queuedPhotoBlob(assessmentId: string, photoId: string): Promise<Blob | null> {
  try {
    return (await getBlob(assessmentId, photoId)) ?? null;
  } catch {
    return null;
  }
}

/** Try a failed photo again from scratch (clears the failure, the backoff and the age clock). */
export async function retryPhoto(assessmentId: string, photoId: string): Promise<void> {
  await patchMeta(assessmentId, photoId, (m) => {
    const next: PhotoMeta = { ...m, tries: 0, nextAt: 0, createdAt: Date.now() };
    delete next.failed;
    delete next.lastError;
    return next;
  });
  await emit();
  void drainConfigured();
}

/**
 * Give up on a photo: delete the device copy and ask the server to drop its still-pending ref (and its mentions in
 * answers) so Mark complete isn't blocked by a photo that will never upload. The device copy goes regardless; when
 * the server couldn't be reached `refRemoved` is false and the editor should try `removePendingPhotoAction` again
 * (or drop the ref locally and let its next save carry on). `rev` is the stored rev to adopt when the ref was removed.
 */
export async function discardPhoto(assessmentId: string, photoId: string): Promise<{ refRemoved: boolean; rev?: number; error?: string }> {
  let res: { refRemoved: boolean; rev?: number; error?: string };
  if (recordKind(assessmentId) !== "assessment") {
    // A survey file (#344 C4): the server keeps no pending-file escape hatch — the survey editor drops the ref from its
    // own draft and saves. Only the device copy goes here.
    try {
      await deleteItem(assessmentId, photoId);
    } finally {
      await emit();
    }
    return { refRemoved: false, error: "Remove it from the survey and save to finish." };
  }
  try {
    const r = await withTimeout(removePendingPhotoAction(assessmentId, photoId), FINALIZE_TIMEOUT_MS, "The server didn't answer in time.");
    res = r.ok ? { refRemoved: true, rev: r.rev } : { refRemoved: false, error: r.error };
  } catch (e) {
    res = { refRemoved: false, error: errorMessage(e) };
  }
  try {
    await deleteItem(assessmentId, photoId);
  } finally {
    await emit();
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* drain                                                                */
/* ------------------------------------------------------------------ */

function errorMessage(e: unknown): string {
  return ((e as Error)?.message ?? String(e)).slice(0, 300);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("The photo couldn't be read."));
    r.readAsDataURL(blob);
  });
}

/** A terminal outcome for one item: the queue marks it failed and moves on. */
class TerminalFailure extends Error {}

/** The record kind's broker URL + client payload and its finalize action (#344 C4). Assessments: unchanged. */
function routeFor(recordId: string, fileId: string) {
  const kind = fileRouteKind(recordId, fileId); // a bad file id on a valid record → null: terminal, never retried for a week
  if (kind === "assessment") {
    return {
      handleUploadUrl: `/api/assessments/${recordId}/photos/upload`,
      clientPayload: JSON.stringify({ photoId: fileId }),
      finalize: (path: string | null, inline?: string) => finalizeAssessmentPhoto(recordId, fileId, path, inline),
    };
  }
  if (kind === "survey") {
    return {
      handleUploadUrl: `/api/surveys/${recordId}/files/upload`,
      clientPayload: JSON.stringify({ fileId }),
      finalize: (path: string | null, inline?: string) => finalizeSurveyFile(recordId, fileId, path, inline),
    };
  }
  return null;
}

/** Local dev without Blob: the file as a small data URL. A JPEG is shrunk to fit (the engine's rule); a strokes JSON is
 *  inlined as-is and refused for good past INLINE_CAPS.json. Assessment photos take exactly the old path. */
async function inlineBody(recordId: string, fileId: string, blob: Blob): Promise<string> {
  if (recordKind(recordId) === "assessment") {
    const body = blob.size > INLINE_BLOB_MAX ? await shrinkForInline(blob, INLINE_BLOB_MAX) : blob;
    return blobToDataUrl(body);
  }
  const json = fileContentType(fileId) === "application/json";
  const body = !json && blob.size > INLINE_BLOB_MAX ? await shrinkForInline(blob, INLINE_BLOB_MAX) : blob;
  const raw = await blobToDataUrl(body);
  // The browser labels the data URL with the Blob's own type; the server trusts only the file id's.
  const url = inlinePrefix(fileId) + raw.slice(raw.indexOf(",") + 1);
  const cap = json ? INLINE_CAPS.json : INLINE_CAPS.jpeg;
  if (url.length > cap) throw new TerminalFailure(`This ${json ? "drawing" : "image"} is too big to keep without file storage (local dev).`);
  return url;
}

async function uploadOne(meta: PhotoMeta, cfg: { blobEnabled: boolean; onDone: PhotoDoneHandler }): Promise<void> {
  const { assessmentId, photoId } = meta; // the record id + file id
  const route = routeFor(assessmentId, photoId);
  if (!route) throw new TerminalFailure("This file doesn't belong to an assessment photo or a survey.");
  const blob = await getBlob(assessmentId, photoId); // the bytes of THIS item only
  if (!blob) {
    await deleteItem(assessmentId, photoId); // meta without bytes: nothing to upload
    return;
  }
  let result: Awaited<ReturnType<typeof finalizeAssessmentPhoto>>;
  if (cfg.blobEnabled) {
    let path = meta.uploadedPath;
    if (!path) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const res = await withTimeout(
          upload(fileBlobPath(assessmentId, photoId), blob, {
            access: "private",
            handleUploadUrl: route.handleUploadUrl,
            clientPayload: route.clientPayload,
            contentType: meta.contentType ?? "image/jpeg",
            abortSignal: ctrl.signal,
          }),
          UPLOAD_TIMEOUT_MS,
          "The upload took too long; it will be retried.",
        );
        path = res.pathname;
      } catch (e) {
        if (ctrl.signal.aborted) throw new Error("The upload took too long; it will be retried.");
        throw e;
      } finally {
        clearTimeout(timer);
      }
      // The bytes are safe on Blob: a failed finalize never re-uploads. (A photo discarded meanwhile stays discarded.)
      await patchMeta(assessmentId, photoId, (m) => ({ ...m, uploadedPath: path }));
    }
    result = await withTimeout(route.finalize(path), FINALIZE_TIMEOUT_MS, "The server didn't answer in time; it will be retried.");
  } else {
    result = await withTimeout(
      route.finalize(null, await inlineBody(assessmentId, photoId, blob)),
      FINALIZE_TIMEOUT_MS,
      "The server didn't answer in time; it will be retried.",
    );
  }
  if (!result.ok) {
    if (result.reupload && meta.uploadedPath) await patchMeta(assessmentId, photoId, (m) => ({ ...m, uploadedPath: undefined }));
    if (result.terminal) throw new TerminalFailure(result.error);
    throw new Error(result.error);
  }
  await cfg.onDone(assessmentId, photoId, result.ref, result.rev);
  // Only now — the server has the file and the editor knows — may the device copy go.
  await deleteItem(assessmentId, photoId);
}

let draining = false;
let rerun = false;
let wake: ReturnType<typeof setTimeout> | null = null;

/**
 * Upload every due, non-failed photo, one at a time. Idempotent + single-flight: concurrent callers (online event,
 * visibility change, a fresh enqueue) coalesce into one pass and a second pass runs if anything arrived mid-drain. A
 * photo that fails stays queued with a later `nextAt`; a terminal failure (or age over 7 days) marks it `failed`. A
 * timer re-runs the drain when the soonest backed-off one comes due.
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
    for (const item of await allMeta()) {
      if (item.failed || item.nextAt > Date.now()) continue;
      if (!navigator.onLine) break;
      try {
        await uploadOne(item, { blobEnabled: opts.blobEnabled, onDone });
      } catch (e) {
        const message = errorMessage(e);
        const terminal = e instanceof TerminalFailure || photoTooOld(item.createdAt, Date.now());
        await patchMeta(item.assessmentId, item.photoId, (m) => {
          const tries = m.tries + 1;
          return terminal
            ? { ...m, tries, failed: true as const, lastError: message, uploadedPath: undefined }
            : { ...m, tries, nextAt: Date.now() + photoBackoffMs(tries), lastError: message };
        }).catch(() => undefined);
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
  const waiting = (await allMeta()).filter((i) => !i.failed).map((i) => i.nextAt).filter((t) => t > Date.now());
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

/** Back online / tab visible again: every waiting (non-failed) photo is due now, not at the end of its backoff. */
async function recoverNow(): Promise<void> {
  try {
    for (const m of await allMeta()) {
      if (!m.failed && m.nextAt > 0) await patchMeta(m.assessmentId, m.photoId, (x) => ({ ...x, nextAt: 0 }));
    }
  } catch {
    /* the drain below still runs */
  }
  await drainConfigured();
}

let triggersInstalled = false;
function installTriggers(): void {
  if (triggersInstalled || typeof window === "undefined") return;
  triggersInstalled = true;
  window.addEventListener("online", () => void recoverNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void recoverNow();
  });
}

/**
 * The editor calls this once on mount: `blobEnabled` comes from the server (the editor page passes it as a prop) and
 * `onDone` adopts a finished photo's ref and the assessment's new rev into the editor's state. Starts a drain now and
 * arms the online / visible / backoff triggers. Returns a disposer for unmount (a later configure replaces this one).
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
