// SERVER ONLY — Drive (read-only) → Blob → part_documents (#283).
/**
 * One Peak Product Photos sync call (spec Part 2): resolve the account's
 * token, find (or re-find) the folder, list the tree, plan
 * (drive-photo-plan.ts), apply relinks, then download → shrink → store →
 * record each import/update under the wall-clock budget. State (folder,
 * per-file md5/document/parts, last run, run lease) is one settings blob,
 * saved after every file so a killed function loses nothing. A transient
 * failure ends the call and the file is retried next run; only a problem
 * with the file itself is recorded on it. Never writes to Drive.
 *
 * Several photos may match one part — each is its own image document, all
 * linked to it (a part's gallery).
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { blobEnabled, putBlob } from "@/lib/blob";
import { hasDriveReadScope } from "@/lib/gmail/config";
import { accessTokenFor, getConnectionInfo } from "@/lib/gmail/connections";
import { DriveApiError, type DriveFetch } from "@/lib/google/drive";
import { downloadDriveFile, findPhotosFolder, getDriveFolder, listPhotoTree, type DriveFolderRef, type DriveListedPhoto } from "@/lib/google/drive-photos";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { getSettings, setSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { attachDocument, createDocument, detachDocument, getDocument, replaceDocumentFile } from "@/lib/stores/part-documents";
import { planDrivePhotoSync, type DrivePhotoFileState, type PhotoMatch, type UnmatchedPhoto } from "./drive-photo-plan";
import { matchFileRows } from "./filename-match";
import { shrinkImage, webpFileName } from "./shrink";
import { MAX_PART_IMAGE_BYTES, newDocumentId, partDocBlobPath } from "./types";

export const DRIVE_PHOTO_SYNC_BLOB = "drive_photo_sync";
const SYNC_BY = "Drive photos sync";
/** A download + shrink + store rarely takes more than a few seconds; don't
 *  START another one with less than this left (the first always runs). */
const PER_FILE_WORST_MS = 12_000;

export type DrivePhotoLastRun = { at: number; imported: number; updated: number; relinked: number; failed: number; unmatched: UnmatchedPhoto[]; complete: boolean; error?: string };
/** `runningUntil` is the run lease: a call refuses while another's is in the
 *  future, and clears its own when it ends (an expired one is ignored). */
export type DrivePhotoSyncState = { folder: DriveFolderRef | null; files: Record<string, DrivePhotoFileState>; lastRun: DrivePhotoLastRun | null; runningUntil?: number | null };
export type DrivePhotoSyncDeps = {
  token?: string;
  fetch?: DriveFetch;
  putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
  now?: () => number;
};
export type DrivePhotoSyncResult =
  | { ok: true; imported: number; updated: number; relinked: number; failed: number; unmatched: number; remaining: number; changed: boolean }
  | { ok: false; error: string };

export async function getDrivePhotoSyncState(): Promise<DrivePhotoSyncState> {
  const raw = await getBlob<Record<string, unknown>>(DRIVE_PHOTO_SYNC_BLOB, {});
  return {
    folder: (raw.folder as DriveFolderRef | null) ?? null,
    files: (raw.files as Record<string, DrivePhotoFileState>) ?? {},
    lastRun: (raw.lastRun as DrivePhotoLastRun | null) ?? null,
    runningUntil: typeof raw.runningUntil === "number" ? raw.runningUntil : null,
  };
}

/** setBlob merges top-level keys, so every key is written every time. */
async function saveState(state: DrivePhotoSyncState): Promise<void> {
  await setBlob(DRIVE_PHOTO_SYNC_BLOB, { folder: state.folder, files: state.files, lastRun: state.lastRun, runningUntil: state.runningUntil ?? null });
}

/** Settings → Mailboxes picker save (the action wraps this with requirePerm).
 *  The key must be a connected mailbox; the scope may be granted after.
 *  Changing the account forgets the remembered folder (another Drive). */
export async function saveCatalogPhotosMailbox(mailboxKey: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = (mailboxKey || "").trim() || null;
  if (clean && !(await getConnectionInfo(clean))) return { ok: false, error: "That mailbox isn't connected." };
  const current = await getSettings();
  await setSettings({ catalogPhotosMailbox: clean });
  if (clean !== (current.catalogPhotosMailbox ?? null)) await setBlob(DRIVE_PHOTO_SYNC_BLOB, { folder: null });
  return { ok: true };
}

async function resolveToken(): Promise<{ token: string } | { error: string }> {
  const key = (await getSettings()).catalogPhotosMailbox ?? null;
  if (!key) return { error: "No Drive photos account is set — pick one in Settings → Mailboxes." };
  const info = await getConnectionInfo(key);
  if (!info) return { error: "The Drive photos account isn't connected any more — reconnect it in Settings → Mailboxes." };
  if (!hasDriveReadScope(info.scope)) return { error: `${info.address} needs Drive photo access — use "Enable Drive photos" on it in Settings → Mailboxes.` };
  let token: string | null = null;
  try {
    token = await accessTokenFor(key);
  } catch {
    token = null;
  }
  return token ? { token } : { error: `Couldn't get a Google token for ${info.address} — reconnect it in Settings → Mailboxes.` };
}

/** Google's 403 rate limits (rateLimitExceeded / userRateLimitExceeded —
 *  photosDriveError appends Google's text to the message). */
function isRateLimited(message: string): boolean {
  return /rate ?limit/i.test(message);
}

/**
 * A download failure that is the FILE's own problem → the message recorded
 * on it. The planner then skips that file until it changes in Drive, so this
 * is reserved for what a retry can't fix: a download-restricted file (403),
 * a file gone from Drive (404), one over the size cap. Everything else — a
 * network error or timeout, 401, 429, 5xx, a rate-limit 403 — is null:
 * transient, the call stops and the next run retries the file.
 */
function fileProblem(e: unknown): string | null {
  if (e instanceof DriveApiError) {
    if (e.status === 404) return "The file disappeared from Drive before it could be downloaded (404).";
    if (e.status === 403 && !isRateLimited(e.message)) {
      const said = /Google said: (.+)$/.exec(e.message)?.[1];
      return "Drive won't let this account download this file (403)." + (said ? ` Google said: ${said}` : "");
    }
    return null;
  }
  if (e instanceof Error && e.message === "over the size cap") return e.message;
  return null;
}

type Step = "download" | "store" | "record";
const STEP_TEXT: Record<Step, string> = { download: "downloading", store: "storing", record: "saving" };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The run's stop message for a transient failure — Google's or the error's own text kept. */
function transientMessage(e: unknown, step: Step, name: string): string {
  if (e instanceof DriveApiError) {
    if (e.status === 403) {
      const said = /Google said: (.+)$/.exec(e.message)?.[1];
      return "Drive is rate-limiting (403) — the rest will sync next time." + (said ? ` Google said: ${said}` : "");
    }
    return e.message;
  }
  const errName = (e as { name?: unknown } | null)?.name;
  if (step === "download" && (errName === "TimeoutError" || errName === "AbortError")) {
    return `Drive took too long sending "${name}" (${errorText(e)}) — the rest will sync next time.`;
  }
  return `Stopped while ${STEP_TEXT[step]} "${name}": ${errorText(e)} — the rest will sync next time.`;
}

function titleOf(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
}

export async function syncDrivePhotos(budgetMs: number, deps: DrivePhotoSyncDeps = {}): Promise<DrivePhotoSyncResult> {
  const now = deps.now ?? Date.now;
  const put = deps.putFile ?? putBlob;
  if (!deps.putFile && !blobEnabled()) return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — photos can't be stored on this deployment." };

  const state = await getDrivePhotoSyncState();
  // The run lease: Sync now and the cron must not work the same files at once.
  if ((state.runningUntil ?? 0) > now()) return { ok: false, error: "A photo sync is already running — try again in a minute." };
  state.runningUntil = now() + Math.max(0, budgetMs) + 20_000;
  await saveState(state);
  try {
    return await runSync(state, budgetMs, deps, now, put);
  } finally {
    state.runningUntil = null;
    try {
      await saveState(state);
    } catch {
      // Couldn't clear it: the lease runs out on its own.
    }
  }
}

async function runSync(
  state: DrivePhotoSyncState,
  budgetMs: number,
  deps: DrivePhotoSyncDeps,
  now: () => number,
  put: NonNullable<DrivePhotoSyncDeps["putFile"]>
): Promise<DrivePhotoSyncResult> {
  const deadline = Date.now() + Math.max(0, budgetMs);
  const f = deps.fetch;
  const fail = async (error: string): Promise<DrivePhotoSyncResult> => {
    state.lastRun = { at: now(), imported: 0, updated: 0, relinked: 0, failed: 0, unmatched: state.lastRun?.unmatched ?? [], complete: false, error };
    await saveState(state);
    return { ok: false, error };
  };

  let token = deps.token;
  if (!token) {
    const t = await resolveToken();
    if ("error" in t) return fail(t.error);
    token = t.token;
  }

  let listing: DriveListedPhoto[];
  try {
    if (state.folder) state.folder = await getDriveFolder(token, state.folder.id, f);
    if (!state.folder) {
      const found = await findPhotosFolder(token, f);
      if (!found.ok) return fail(found.error);
      state.folder = found.folder;
    }
    listing = await listPhotoTree(token, state.folder.id, f);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't read the Drive folder.");
  }

  // Labor-category parts are never match targets.
  const parts = (await listCatalog()).filter((p) => p.category !== "Labor");
  const names = [...new Set(listing.map((p) => p.name))];
  const matchByName = new Map<string, PhotoMatch>(matchFileRows(names, parts).map((r) => [r.fileName, { confidence: r.confidence, skus: r.skus }]));
  const plan = planDrivePhotoSync(listing, state.files, (name) => matchByName.get(name) ?? { confidence: "none", skus: [] }, MAX_PART_IMAGE_BYTES);

  let relinked = 0, relinksDone = 0, stopError = "";
  for (const r of plan.relinks) {
    try {
      if (!(await getDocument(r.documentId))) {
        // Removed in the app: forget the file, so the next run imports it afresh.
        delete state.files[r.fileId];
      } else {
        if (r.add.length) await attachDocument(r.documentId, r.add, SYNC_BY, now());
        for (const sku of r.remove) await detachDocument(r.documentId, sku);
        state.files[r.fileId] = { md5: r.md5, documentId: r.documentId, skus: r.skus, at: now() };
        relinked++;
      }
      relinksDone++;
    } catch (e) {
      stopError = `Stopped while relinking renamed photos: ${errorText(e)} — the rest will sync next time.`;
      break;
    }
  }
  if (relinksDone) {
    try {
      await saveState(state);
    } catch (e) {
      stopError ||= `Stopped while saving relinked photos: ${errorText(e)} — the rest will sync next time.`;
    }
  }

  const work = [...plan.updates.map((u) => ({ kind: "update" as const, ...u })), ...plan.imports.map((i) => ({ kind: "import" as const, ...i }))];
  let imported = 0, updated = 0, failed = 0, processed = 0;
  for (const item of stopError ? [] : work) {
    if (processed > 0 && deadline - Date.now() < PER_FILE_WORST_MS) break;
    processed++;
    const prev = state.files[item.id];
    let step: Step = "download";
    /** True once a pending entry naming the new document is on disk — from
     *  then on that entry (not `prev`) is what a retry must start from. */
    let pendingSaved = false;
    /** The file's own problem: recorded, and skipped until it changes in Drive. */
    const recordError = async (error: string) => {
      state.files[item.id] = { md5: item.md5, documentId: prev?.documentId ?? null, skus: prev?.skus ?? [], error, at: now() };
      step = "record";
      await saveState(state);
      failed++;
    };
    try {
      let bytes: Uint8Array;
      try {
        bytes = await downloadDriveFile(token, item.id, MAX_PART_IMAGE_BYTES, f);
      } catch (e) {
        const problem = fileProblem(e);
        if (problem === null) throw e;
        await recordError(problem);
        continue;
      }
      const shrunk = await shrinkImage(bytes);
      if (!shrunk.ok) {
        await recordError(shrunk.error);
        continue;
      }
      const fileName = webpFileName(item.name);
      step = "record";
      // An update whose document was removed in the app starts a fresh one.
      const existing = item.kind === "update" ? await getDocument(item.documentId) : null;
      const documentId = existing ? existing.id : newDocumentId();
      step = "store";
      const stored = await put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
      step = "record";
      const file = { blobKey: stored.pathname, fileName, contentType: shrunk.contentType, size: shrunk.bytes.byteLength };
      let outcome: "imported" | "updated";
      if (existing && item.kind === "update") {
        if (!(await replaceDocumentFile(existing.id, file, SYNC_BY, now()))) throw new Error("Could not update the document.");
        if (item.add.length) await attachDocument(existing.id, item.add, SYNC_BY, now());
        for (const sku of item.remove) await detachDocument(existing.id, sku);
        outcome = "updated";
      } else {
        // Remember the new document's id BEFORE creating it. md5 "" reads as
        // changed, so if this function is killed from here on, the next run
        // takes the update path and getDocument decides: the document exists
        // → its file is replaced and its parts linked; it was never created →
        // a fresh one. Either way, never a second copy.
        state.files[item.id] = { md5: "", documentId, skus: [], at: now() };
        await saveState(state);
        pendingSaved = true;
        const created = await createDocument({
          id: documentId,
          kind: "image",
          title: titleOf(item.name),
          ...file,
          sourceUrl: item.webViewLink || null,
          source: "drive",
          sourceRef: item.id,
          by: SYNC_BY,
          at: now(),
        });
        if (!created) throw new Error("Could not record the document.");
        await attachDocument(created.id, item.skus, SYNC_BY, now());
        outcome = "imported";
      }
      // Success always writes a fresh entry without `error`.
      state.files[item.id] = { md5: item.md5, documentId, skus: [...item.skus], at: now() };
      await saveState(state);
      if (outcome === "imported") imported++;
      else updated++;
    } catch (e) {
      // Transient (network, timeout, 401/429/5xx, a rate-limit 403, Blob or
      // database trouble): nothing is recorded against the file, so the next
      // Sync now / cron retries it. A pending entry already saved stays.
      if (!pendingSaved) {
        if (prev) state.files[item.id] = prev;
        else delete state.files[item.id];
      }
      stopError = transientMessage(e, step, item.name);
      processed--;
      break;
    }
  }

  const remaining = work.length - processed + (plan.relinks.length - relinksDone);
  state.lastRun = { at: now(), imported, updated, relinked, failed, unmatched: plan.unmatched, complete: remaining === 0 && !stopError, ...(stopError ? { error: stopError } : {}) };
  await saveState(state);
  const changed = imported + updated + relinked > 0;
  if (changed) invalidatePortalIndex();
  if (stopError && processed === 0 && !changed) return { ok: false, error: stopError };
  return { ok: true, imported, updated, relinked, failed, unmatched: plan.unmatched.length, remaining, changed };
}
