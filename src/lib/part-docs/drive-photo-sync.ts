// SERVER ONLY — Drive (read-only) → Blob → part_documents (#283).
/**
 * One Peak Product Photos sync call (spec Part 2): resolve the account's
 * token, find (or re-find) the folder, list the tree, plan
 * (drive-photo-plan.ts), apply relinks, then download → shrink → store →
 * record each import/update under the wall-clock budget. State (folder,
 * per-file md5/document/parts, last run) is one settings blob, saved after
 * every file so a killed function loses nothing. Never writes to Drive.
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
export type DrivePhotoSyncState = { folder: DriveFolderRef | null; files: Record<string, DrivePhotoFileState>; lastRun: DrivePhotoLastRun | null };
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
  };
}

/** setBlob merges top-level keys, so all three are written every time. */
async function saveState(state: DrivePhotoSyncState): Promise<void> {
  await setBlob(DRIVE_PHOTO_SYNC_BLOB, { folder: state.folder, files: state.files, lastRun: state.lastRun });
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

/** Errors that end the whole call: auth (401), rate limit (429), Google
 *  down (5xx). A 403 on one download is per-file — Drive answers 403 for a
 *  download-restricted file and for per-user rate limits. (A 403 finding or
 *  listing the folder fails the call before the per-file loop.) */
function isFatal(e: unknown): boolean {
  return e instanceof DriveApiError && (e.status === 401 || e.status === 429 || e.status >= 500);
}

function titleOf(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
}

export async function syncDrivePhotos(budgetMs: number, deps: DrivePhotoSyncDeps = {}): Promise<DrivePhotoSyncResult> {
  const now = deps.now ?? Date.now;
  const deadline = Date.now() + Math.max(0, budgetMs);
  const f = deps.fetch;
  const put = deps.putFile ?? putBlob;
  if (!deps.putFile && !blobEnabled()) return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — photos can't be stored on this deployment." };

  const state = await getDrivePhotoSyncState();
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

  let relinked = 0;
  for (const r of plan.relinks) {
    if (r.add.length) await attachDocument(r.documentId, r.add, SYNC_BY, now());
    for (const sku of r.remove) await detachDocument(r.documentId, sku);
    state.files[r.fileId] = { md5: r.md5, documentId: r.documentId, skus: r.skus, at: now() };
    relinked++;
  }
  if (relinked) await saveState(state);

  const work = [...plan.updates.map((u) => ({ kind: "update" as const, ...u })), ...plan.imports.map((i) => ({ kind: "import" as const, ...i }))];
  let imported = 0, updated = 0, failed = 0, processed = 0, stopError = "";
  for (const item of work) {
    if (processed > 0 && deadline - Date.now() < PER_FILE_WORST_MS) break;
    processed++;
    const prev = state.files[item.id];
    /** A document created this iteration — remembered even if a later step
     *  fails, so the next change to the file updates it instead of orphaning it. */
    let createdId: string | null = null;
    const recordError = (error: string) => {
      const documentId = createdId ?? prev?.documentId ?? null;
      state.files[item.id] = { md5: item.md5, documentId, skus: createdId ? [] : prev?.skus ?? [], error, at: now() };
      failed++;
    };
    try {
      const bytes = await downloadDriveFile(token, item.id, MAX_PART_IMAGE_BYTES, f);
      const shrunk = await shrinkImage(bytes);
      if (!shrunk.ok) {
        recordError(shrunk.error);
        await saveState(state);
        continue;
      }
      const fileName = webpFileName(item.name);
      // An update whose document was removed in the app starts a fresh one.
      const existing = item.kind === "update" ? await getDocument(item.documentId) : null;
      const documentId = existing ? existing.id : newDocumentId();
      const stored = await put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
      const file = { blobKey: stored.pathname, fileName, contentType: shrunk.contentType, size: shrunk.bytes.byteLength };
      if (existing && item.kind === "update") {
        if (!(await replaceDocumentFile(existing.id, file, SYNC_BY, now()))) throw new Error("Could not update the document.");
        if (item.add.length) await attachDocument(existing.id, item.add, SYNC_BY, now());
        for (const sku of item.remove) await detachDocument(existing.id, sku);
        updated++;
      } else {
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
        createdId = created.id;
        await attachDocument(created.id, item.skus, SYNC_BY, now());
        imported++;
      }
      // Success always writes a fresh entry without `error`.
      state.files[item.id] = { md5: item.md5, documentId, skus: [...item.skus], at: now() };
      await saveState(state);
    } catch (e) {
      if (isFatal(e)) {
        stopError = (e as Error).message;
        processed--;
        break;
      }
      recordError(e instanceof Error ? e.message : "Couldn't import this photo.");
      await saveState(state);
    }
  }

  const remaining = work.length - processed;
  state.lastRun = { at: now(), imported, updated, relinked, failed, unmatched: plan.unmatched, complete: remaining === 0 && !stopError, ...(stopError ? { error: stopError } : {}) };
  await saveState(state);
  const changed = imported + updated + relinked > 0;
  if (changed) invalidatePortalIndex();
  if (stopError && processed === 0 && !changed) return { ok: false, error: stopError };
  return { ok: true, imported, updated, relinked, failed, unmatched: plan.unmatched.length, remaining, changed };
}
