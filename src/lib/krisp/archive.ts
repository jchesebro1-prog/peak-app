import { getSettings, setSettings, type AppSettingsData } from "@/lib/settings";
import { hasDriveScope } from "@/lib/gmail/config";
import { accessTokenFor, getConnectionInfo } from "@/lib/gmail/connections";
import { deleteBlob as blobDelete, getBlobStream } from "@/lib/blob";
import {
  archivableRecordings,
  markArchiveError,
  markArchived,
  type RecordingRecord,
} from "@/lib/stores/recordings";
import { ensureFolder, uploadFileResumable, type DriveFetch, type FolderCache } from "@/lib/google/drive";

/**
 * Nightly Drive archive (Krisp recordings spec §5.2 — an extra step of the
 * existing cron). Blob is STAGING, not retention: once a recording's Krisp
 * side has settled (ready OR failed) for ARCHIVE_MIN_AGE_MS, its audio moves
 * to `Peak Recordings/<Customer>/` in the archive account's Drive, the doc
 * gets `driveFileId` + `driveLink`, and the Blob is deleted — strictly after
 * Drive returned an id (spec §7 idempotency). A failure anywhere leaves the
 * Blob untouched and stores `archiveError` on the record for the next run.
 *
 * Every collaborator is injectable (ArchiveDeps) so the spec tests run the
 * whole pass — including the markArchived-before-deleteBlob ordering — with
 * an in-memory recording and a fake Drive; production uses the real stores.
 * `archiveRecordings` never throws: the cron route logs its result.
 */

export type ArchiveResult = { archived: number; failed: number; skipped: string | null };

export const ARCHIVE_ROOT_FOLDER = "Peak Recordings";
export const ARCHIVE_UNFILED_FOLDER = "Unfiled";
/** Krisp settled this long ago → eligible (room for same-day retries, spec §5.2). */
export const ARCHIVE_MIN_AGE_MS = 6 * 60 * 60 * 1000;
/** Per run — one PUT per recording inside the 60 s function budget. */
export const ARCHIVE_MAX_PER_RUN = 5;

export const ARCHIVE_SKIP_NOT_CONFIGURED = "Archive not configured";
export const ARCHIVE_SKIP_NOT_CONNECTED = "Archive account not connected";
export const ARCHIVE_SKIP_NO_SCOPE = "Archive account missing Drive scope";

type ArchiveSettings = Pick<
  AppSettingsData,
  "recordingsArchiveMailbox" | "recordingsArchiveFolderId" | "recordingsArchiveFolders"
>;

export type ArchiveDeps = {
  settings: () => Promise<ArchiveSettings>;
  saveSettings: (patch: Record<string, unknown>) => Promise<void>;
  /** The archive account's access token + granted scope; null when not connected. */
  tokenFor: (mailboxKey: string) => Promise<{ token: string; scope: string } | null>;
  candidates: (olderThanMs: number) => Promise<RecordingRecord[]>;
  blobStream: (pathname: string) => Promise<ReadableStream | null>;
  deleteBlob: (pathname: string) => Promise<void>;
  markArchived: (id: string, drive: { driveFileId: string; driveLink: string }) => Promise<unknown>;
  markArchiveError: (id: string, message: string) => Promise<unknown>;
  fetch: DriveFetch;
  now: () => number;
  log: (message: string) => void;
};

const defaultDeps: ArchiveDeps = {
  settings: () => getSettings(),
  saveSettings: (patch) => setSettings(patch),
  tokenFor: async (mailboxKey) => {
    const info = await getConnectionInfo(mailboxKey);
    if (!info) return null;
    const token = await accessTokenFor(mailboxKey);
    return token ? { token, scope: info.scope } : null;
  },
  candidates: (olderThanMs) => archivableRecordings(olderThanMs),
  blobStream: (pathname) => getBlobStream(pathname),
  deleteBlob: (pathname) => blobDelete(pathname),
  markArchived: (id, drive) => markArchived(id, drive),
  markArchiveError: (id, message) => markArchiveError(id, message),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log: (message) => console.warn("[recordings/archive] " + message),
};

/* ---------- file naming (pure, exported for the spec tests) ---------- */

const EXT_BY_MIME: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

/** File extension for an audio mime (`audio/mp4` → `m4a`; unknown `audio/<x>` → `x`). */
export function extForMime(mime: string): string {
  const clean = (mime || "").split(";")[0].trim().toLowerCase();
  if (EXT_BY_MIME[clean]) return EXT_BY_MIME[clean];
  const m = /^audio\/([a-z0-9.-]+)$/.exec(clean);
  return m ? m[1].replace(/^x-/, "") : "bin";
}

/**
 * The safeName rule (lib/blob.ts) with spaces kept: Drive names are display
 * names, so `2026-09-21 SV-5012 Hortonville HS.m4a` should read that way.
 */
export function archiveSafeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9 ._-]+/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[\s_]+|[\s_]+$/g, "")
      .slice(0, 120) || "recording"
  );
}

/** `YYYY-MM-DD` of an epoch-ms instant in the given zone (default Central — the offices' default). */
export function archiveDateStamp(at: number, timeZone = "America/Chicago"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** `<YYYY-MM-DD> <parentId> <venue>.<ext>` (spec §5.2 step 3). */
export function archiveFileName(
  rec: Pick<RecordingRecord, "startedAt" | "parentId" | "venue" | "mime">,
  timeZone?: string
): string {
  const stem = archiveSafeName(
    [archiveDateStamp(rec.startedAt, timeZone), rec.parentId, rec.venue].filter(Boolean).join(" ")
  );
  return `${stem}.${extForMime(rec.mime)}`;
}

/** Settings key for a recording's customer subfolder cache (spec §1.3). */
export function archiveFolderKey(rec: Pick<RecordingRecord, "customerId">): string {
  return rec.customerId || "unfiled";
}

/* ---------- one recording ---------- */

export type ArchiveContext = {
  token: string;
  rootId: string;
  /** settings.recordingsArchiveFolders, mutated in place when a subfolder is created. */
  folders: Record<string, string>;
  driveCache: FolderCache;
  deps: ArchiveDeps;
};

export type ArchiveOneOutcome = "archived" | "failed";

/**
 * Archive a single recording. Order is the whole point: Drive upload →
 * (id in hand) markArchived → deleteBlob. A Blob-delete failure after the
 * doc is archived is logged onto the record but does NOT undo the archive —
 * the audio is safe in Drive, and a dangling Blob is cheap to clean by hand.
 */
export async function archiveOne(rec: RecordingRecord, ctx: ArchiveContext): Promise<ArchiveOneOutcome> {
  const { deps } = ctx;
  const pathname = rec.audio.blobPathname;
  try {
    if (!pathname) throw new Error("Recording has no Blob pathname to archive.");
    const key = archiveFolderKey(rec);
    let folderId = ctx.folders[key] || null;
    if (!folderId) {
      folderId = await ensureFolder(ctx.token, rec.customer.trim() || ARCHIVE_UNFILED_FOLDER, ctx.rootId, {
        fetch: deps.fetch,
        cache: ctx.driveCache,
      });
      ctx.folders[key] = folderId;
    }
    const body = await deps.blobStream(pathname);
    if (!body) throw new Error(`Blob "${pathname}" was not found — nothing to archive.`);
    const file = await uploadFileResumable(
      ctx.token,
      { name: archiveFileName(rec), mimeType: rec.mime, parentId: folderId, size: rec.sizeBytes, body },
      { fetch: deps.fetch }
    );
    await deps.markArchived(rec.id, { driveFileId: file.id, driveLink: file.webViewLink });
    try {
      await deps.deleteBlob(pathname);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log(`${rec.id}: archived to Drive (${file.id}) but the Blob delete failed: ${msg}`);
      await deps.markArchiveError(rec.id, `Archived to Drive, but deleting the staged Blob failed: ${msg}`);
    }
    return "archived";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.log(`${rec.id}: ${msg}`);
    // A 404 means a cached folder id no longer resolves — drop the cache so
    // the next run recreates the tree instead of failing forever.
    if ((e as { status?: number })?.status === 404) {
      delete ctx.folders[archiveFolderKey(rec)];
      ctx.rootId = "";
    }
    await deps.markArchiveError(rec.id, msg).catch(() => undefined);
    return "failed";
  }
}

/* ---------- the pass ---------- */

async function stampSkipped(recs: RecordingRecord[], reason: string, deps: ArchiveDeps): Promise<void> {
  for (const rec of recs) {
    if (rec.audio.archiveError === reason) continue;
    await deps.markArchiveError(rec.id, reason).catch(() => undefined);
  }
}

export async function archiveRecordings(overrides: Partial<ArchiveDeps> = {}): Promise<ArchiveResult> {
  const deps: ArchiveDeps = { ...defaultDeps, ...overrides };
  const result: ArchiveResult = { archived: 0, failed: 0, skipped: null };
  let settingsPatch: Record<string, unknown> = {};
  try {
    const settings = await deps.settings();
    const candidates = (await deps.candidates(ARCHIVE_MIN_AGE_MS)).slice(0, ARCHIVE_MAX_PER_RUN);

    const mailbox = settings.recordingsArchiveMailbox;
    let grant: { token: string; scope: string } | null = null;
    if (!mailbox) result.skipped = ARCHIVE_SKIP_NOT_CONFIGURED;
    else {
      grant = await deps.tokenFor(mailbox);
      if (!grant) result.skipped = ARCHIVE_SKIP_NOT_CONNECTED;
      else if (!hasDriveScope(grant.scope)) result.skipped = ARCHIVE_SKIP_NO_SCOPE;
    }

    if (result.skipped || !grant) {
      // Spec §5.2 step 1: the gate's message is visible on each waiting record.
      await stampSkipped(candidates, result.skipped ?? ARCHIVE_SKIP_NOT_CONFIGURED, deps);
    } else if (candidates.length) {
      const driveCache: FolderCache = new Map();
      const folders: Record<string, string> = { ...(settings.recordingsArchiveFolders || {}) };
      const foldersBefore = JSON.stringify(folders);
      let rootId = settings.recordingsArchiveFolderId || "";
      const rootBefore = rootId;

      for (const rec of candidates) {
        if (!rootId) {
          try {
            rootId = await ensureFolder(grant.token, ARCHIVE_ROOT_FOLDER, null, {
              fetch: deps.fetch,
              cache: driveCache,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            deps.log(`root folder: ${msg}`);
            await deps.markArchiveError(rec.id, msg).catch(() => undefined);
            result.failed++;
            continue;
          }
        }
        const ctx: ArchiveContext = { token: grant.token, rootId, folders, driveCache, deps };
        const outcome = await archiveOne(rec, ctx);
        rootId = ctx.rootId; // cleared by archiveOne on a 404
        if (outcome === "archived") result.archived++;
        else result.failed++;
      }

      if (rootId !== rootBefore) settingsPatch.recordingsArchiveFolderId = rootId || null;
      if (JSON.stringify(folders) !== foldersBefore) settingsPatch.recordingsArchiveFolders = folders;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.log(`pass aborted: ${msg}`);
    result.skipped = result.skipped ?? `Archive pass failed: ${msg}`;
  }

  try {
    settingsPatch = {
      ...settingsPatch,
      recordingsArchiveLastRun: { at: deps.now(), ...result },
    };
    await deps.saveSettings(settingsPatch);
  } catch (e) {
    deps.log(`could not save archive settings: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
