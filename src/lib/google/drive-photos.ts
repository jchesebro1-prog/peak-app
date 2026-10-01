// SERVER ONLY — Google Drive v3 REST, read-only (#283).
/**
 * The Peak Product Photos folder, read with drive.readonly. Only reads are
 * made: find the folder, walk its tree, download a file. Every call passes
 * supportsAllDrives (the folder may live in a Shared Drive); list calls also
 * pass includeItemsFromAllDrives + corpora=allDrives. `f` is the test seam.
 */
import { DRIVE_API_BASE, DRIVE_FOLDER_MIME, DriveApiError, driveQuote, type DriveFetch } from "./drive";

export const PHOTOS_FOLDER_NAME = "Peak Product Photos";
export const PHOTO_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
export const HEIC_MIME_TYPES: readonly string[] = ["image/heic", "image/heif"];
const LIST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** A runaway tree (or a shortcut loop Drive somehow allows) stops here. */
const MAX_FOLDERS = 500;

export type DriveFolderRef = { id: string; driveId: string | null; name: string; webViewLink: string };
export type DriveListedPhoto = { id: string; name: string; mimeType: string; md5: string; size: number; webViewLink: string };

const realFetch: DriveFetch = (url, init) => fetch(url, init);

export function photosDriveError(status: number, what: string, detail: string): DriveApiError {
  if (status === 401) return new DriveApiError(401, `Google rejected the photos account's token (401) while ${what} — reconnect it in Settings → Mailboxes with "Enable Drive photos".`);
  if (status === 403) return new DriveApiError(403, `The photos account can't read Drive (403) while ${what} — use "Enable Drive photos" on it in Settings → Mailboxes.` + (detail ? ` Google said: ${detail}` : ""));
  if (status === 404) return new DriveApiError(404, `Not found in Drive (404) while ${what}.`);
  if (status === 429) return new DriveApiError(429, `Drive is rate-limiting (429) while ${what} — the rest will sync next time.`);
  return new DriveApiError(status, `Drive API ${status} while ${what}${detail ? `: ${detail}` : ""}`);
}

async function detailOf(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j?.error?.message || "";
  } catch {
    return "";
  }
}

async function getJson<T>(f: DriveFetch, token: string, url: string, what: string): Promise<T> {
  const res = await f(url, { method: "GET", signal: AbortSignal.timeout(LIST_TIMEOUT_MS), headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (!res.ok) throw photosDriveError(res.status, what, await detailOf(res));
  return (await res.json()) as T;
}

function listUrl(params: Record<string, string>): string {
  const u = new URL(`${DRIVE_API_BASE}/files`);
  for (const [k, v] of Object.entries({ ...params, corpora: "allDrives", includeItemsFromAllDrives: "true", supportsAllDrives: "true" })) u.searchParams.set(k, v);
  return u.toString();
}

type RawFile = { id: string; name?: string; mimeType?: string; md5Checksum?: string; size?: string; webViewLink?: string; driveId?: string; trashed?: boolean };

export async function findPhotosFolder(token: string, f: DriveFetch = realFetch): Promise<{ ok: true; folder: DriveFolderRef } | { ok: false; error: string }> {
  const q = `name = ${driveQuote(PHOTOS_FOLDER_NAME)} and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`;
  const j = await getJson<{ files?: RawFile[] }>(f, token, listUrl({ q, fields: "files(id,name,driveId,webViewLink)", pageSize: "10" }), "looking for the Peak Product Photos folder");
  const hits = j.files || [];
  if (!hits.length) return { ok: false, error: `No folder named ${PHOTOS_FOLDER_NAME} was found in that account's Drive.` };
  if (hits.length > 1) {
    return { ok: false, error: `Found ${hits.length} folders named ${PHOTOS_FOLDER_NAME} — rename the extras: ${hits.map((h) => h.webViewLink || h.id).join(", ")}` };
  }
  const h = hits[0];
  return { ok: true, folder: { id: h.id, driveId: h.driveId ?? null, name: h.name || PHOTOS_FOLDER_NAME, webViewLink: h.webViewLink || "" } };
}

export async function getDriveFolder(token: string, id: string, f: DriveFetch = realFetch): Promise<DriveFolderRef | null> {
  const u = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("fields", "id,name,driveId,webViewLink,trashed,mimeType");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await f(u.toString(), { method: "GET", signal: AbortSignal.timeout(LIST_TIMEOUT_MS), headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw photosDriveError(res.status, "checking the photos folder", await detailOf(res));
  const h = (await res.json()) as RawFile;
  if (h.trashed || h.mimeType !== DRIVE_FOLDER_MIME) return null;
  return { id: h.id, driveId: h.driveId ?? null, name: h.name || PHOTOS_FOLDER_NAME, webViewLink: h.webViewLink || "" };
}

export async function listPhotoTree(token: string, rootId: string, f: DriveFetch = realFetch): Promise<DriveListedPhoto[]> {
  const out = new Map<string, DriveListedPhoto>();
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length && visited.size < MAX_FOLDERS) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    let pageToken = "";
    do {
      const params: Record<string, string> = {
        q: `${driveQuote(folderId)} in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,md5Checksum,size,webViewLink)",
        pageSize: "1000",
      };
      if (pageToken) params.pageToken = pageToken;
      const j = await getJson<{ files?: RawFile[]; nextPageToken?: string }>(f, token, listUrl(params), "listing the photos folder");
      for (const file of j.files || []) {
        if (file.mimeType === DRIVE_FOLDER_MIME) {
          if (!visited.has(file.id)) queue.push(file.id);
          continue;
        }
        if (!file.mimeType || !PHOTO_MIME_TYPES.includes(file.mimeType)) continue;
        out.set(file.id, {
          id: file.id,
          name: file.name || file.id,
          mimeType: file.mimeType,
          md5: file.md5Checksum || "",
          size: Number(file.size || 0),
          webViewLink: file.webViewLink || "",
        });
      }
      pageToken = j.nextPageToken || "";
    } while (pageToken);
  }
  return [...out.values()];
}

export async function downloadDriveFile(token: string, id: string, maxBytes: number, f: DriveFetch = realFetch): Promise<Uint8Array> {
  const u = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("alt", "media");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await f(u.toString(), { method: "GET", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw photosDriveError(res.status, "downloading a photo", await detailOf(res));
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("over the size cap");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("over the size cap");
  return bytes;
}
