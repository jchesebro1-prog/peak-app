/**
 * Google Drive v3 helpers for the Recordings audio archive (Krisp recordings
 * spec §5 — docs/superpowers/specs/2026-09-21-krisp-recordings-design.md).
 *
 * Server-only, plain `fetch()` against the documented REST endpoints (the
 * same no-new-dependency stance as lib/gmail and lib/google/tasks.ts). The
 * caller hands in an access token from `accessTokenFor(mailboxKey)` — the
 * archive account's grant must carry DRIVE_SCOPE (`drive.file`), which only
 * sees files this app created; every folder search below is therefore
 * scoped to the app's own tree by construction.
 *
 * The transport is injectable so the spec tests exercise the search / create
 * / initiate + PUT paths and the 401/403 mapping with a fake `fetch`.
 */

export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/** Metadata calls (search / create / initiate) — same budget as tasks.ts.
 *  Exported so other Drive-touching routes (the engagement-files download
 *  proxy's live parent-folder check, #145) carry the same budget instead of
 *  inventing their own. */
export const META_TIMEOUT_MS = 10_000;
/**
 * The byte PUT/GET. A single PUT of the whole file is fine for our sizes
 * (the client-upload token caps audio at 1 GB, spec §7) but it has to
 * finish inside the 60 s function budget the nightly cron runs under —
 * hence the ≤ 5-per-run cap in lib/krisp/archive.ts. Chunked resumable PUTs
 * across runs are a follow-up if a real venue walkthrough ever times out
 * here. Also reused for the engagement-files proxy's `alt=media` download
 * (#145) — same byte-transfer scale, same budget.
 */
export const UPLOAD_TIMEOUT_MS = 55_000;

export type DriveFetch = (url: string, init: RequestInit) => Promise<Response>;

const realFetch: DriveFetch = (url, init) => fetch(url, init);

export class DriveApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Status → a message an admin can act on (spec §5.2 step 5: stored on the record). */
export function driveErrorFor(status: number, what: string, detail: string): DriveApiError {
  if (status === 401) {
    return new DriveApiError(
      401,
      `Google rejected the archive account's token (401) while ${what} — reconnect the archive mailbox in Settings → Mailboxes.`
    );
  }
  if (status === 403) {
    return new DriveApiError(
      403,
      `The archive account lacks Drive access (403) while ${what} — open Settings → Recordings and use "Enable Drive archive" on that mailbox.` +
        (detail ? ` Google said: ${detail}` : "")
    );
  }
  if (status === 404) {
    return new DriveApiError(404, `Drive folder not found (404) while ${what} — the cached archive folder was moved or deleted; it will be recreated on the next run.`);
  }
  return new DriveApiError(status, `Drive API ${status} while ${what}${detail ? `: ${detail}` : ""}`);
}

async function driveJson<T>(
  f: DriveFetch,
  token: string,
  url: string,
  init: RequestInit,
  what: string
): Promise<T> {
  const res = await f(url, {
    ...init,
    signal: AbortSignal.timeout(META_TIMEOUT_MS),
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw driveErrorFor(res.status, what, await bodyText(res));
  return (await res.json()) as T;
}

/** Escape a value for a Drive `q` string literal (backslash + single quote). */
export function driveQuote(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

/** The `q` used to find an app-created folder by name under a parent (`null` = My Drive root). */
export function folderQuery(name: string, parentId: string | null): string {
  return [
    `name = ${driveQuote(name)}`,
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `${driveQuote(parentId ?? "root")} in parents`,
    "trashed = false",
  ].join(" and ");
}

/** Per-run memo so a pass touching five recordings of one customer searches once. */
export type FolderCache = Map<string, string>;

function cacheKey(name: string, parentId: string | null): string {
  return (parentId ?? "root") + "/" + name;
}

/**
 * Find-or-create a folder named `name` under `parentId` (`null` = My Drive
 * root) and return its id. The search is exact-name + folder mime + parent +
 * not trashed; the first hit wins (Drive allows duplicate names — the app
 * never creates a second one because it always searches first).
 */
export async function ensureFolder(
  token: string,
  name: string,
  parentId: string | null,
  opts: { fetch?: DriveFetch; cache?: FolderCache } = {}
): Promise<string> {
  const f = opts.fetch ?? realFetch;
  const key = cacheKey(name, parentId);
  const hit = opts.cache?.get(key);
  if (hit) return hit;

  const params = new URLSearchParams({
    q: folderQuery(name, parentId),
    fields: "files(id,name)",
    pageSize: "1",
    spaces: "drive",
  });
  const found = await driveJson<{ files?: { id: string; name: string }[] }>(
    f,
    token,
    `${DRIVE_API_BASE}/files?${params.toString()}`,
    { method: "GET" },
    `looking up the "${name}" folder`
  );
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await driveJson<{ id: string }>(
      f,
      token,
      `${DRIVE_API_BASE}/files?fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          name,
          mimeType: DRIVE_FOLDER_MIME,
          ...(parentId ? { parents: [parentId] } : {}),
        }),
      },
      `creating the "${name}" folder`
    );
    id = created.id;
    if (!id) throw new DriveApiError(502, `Drive returned no id when creating the "${name}" folder.`);
  }
  opts.cache?.set(key, id);
  return id;
}

/**
 * Walk a "A/B/C" path (as `engagementFolderPath` builds one, #145) into
 * nested Drive folders via `ensureFolder`, creating whichever segments
 * don't exist yet and returning the LEAF folder's id. Idempotent —
 * `ensureFolder` searches before creating, so calling this again for the
 * same path resolves the same folder id without creating a duplicate.
 *
 * That idempotency is also what makes this safe to call a SECOND time at
 * READ time (the engagement-files download proxy re-resolves the same
 * path to get an authoritative folder id to check a file's live `parents`
 * against, rather than trusting anything stored) as well as at upload
 * time.
 */
export async function ensureFolderPath(
  token: string,
  path: string,
  opts: { fetch?: DriveFetch; cache?: FolderCache } = {}
): Promise<string> {
  let parentId: string | null = null;
  for (const segment of path.split("/").filter(Boolean)) {
    parentId = await ensureFolder(token, segment, parentId, opts);
  }
  if (!parentId) throw new DriveApiError(500, `Empty Drive folder path: "${path}"`);
  return parentId;
}

export type DriveUploadInput = {
  name: string;
  mimeType: string;
  parentId: string;
  /** Exact byte length — Drive requires it up front for a resumable session. */
  size: number;
  body: ReadableStream<Uint8Array> | Buffer | Uint8Array;
};

export type DriveUploadResult = { id: string; webViewLink: string };

/** Metadata needed to OPEN a resumable session — everything `initiateResumableSession`
 *  needs before any byte has moved. */
export type ResumableSessionInput = {
  name: string;
  mime: string;
  parentId: string;
  /** Exact byte length — Drive requires it up front for a resumable session. */
  size: number;
};

/**
 * #145 — initiate only, split out of `uploadFileResumable` below so a
 * caller (the engagement-files upload route) can hand the returned session
 * URL straight to the BROWSER, which then PUTs the bytes itself: the file
 * never rides this app's request body, so a multi-megabyte drawing set
 * never has to fit under a server action's ~1200kb cap or a Vercel
 * function's ~4.5MB one.
 *
 * `uploadFileResumable` calls this and then performs the PUT itself, so its
 * behaviour (headers sent, error mapping) is unchanged — see its own tests.
 */
export async function initiateResumableSession(
  token: string,
  input: ResumableSessionInput,
  fetchImpl: DriveFetch = realFetch
): Promise<string> {
  const what = `starting an upload of "${input.name}"`;
  const initiate = await fetchImpl(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,webViewLink`, {
    method: "POST",
    signal: AbortSignal.timeout(META_TIMEOUT_MS),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mime,
      "X-Upload-Content-Length": String(input.size),
    },
    body: JSON.stringify({ name: input.name, mimeType: input.mime, parents: [input.parentId] }),
  });
  if (!initiate.ok) throw driveErrorFor(initiate.status, what, await bodyText(initiate));
  const sessionUrl = initiate.headers.get("location") || initiate.headers.get("Location");
  if (!sessionUrl) throw new DriveApiError(502, `Drive opened no upload session (missing Location) while ${what}.`);
  return sessionUrl;
}

/**
 * Resumable upload (`uploadType=resumable`): one POST with the metadata to
 * open a session, then a single PUT of every byte to the session URL. Drive
 * answers the final PUT with the file resource (`fields=id,webViewLink`).
 * A stream body needs `duplex: "half"` under Node's fetch.
 */
export async function uploadFileResumable(
  token: string,
  input: DriveUploadInput,
  opts: { fetch?: DriveFetch } = {}
): Promise<DriveUploadResult> {
  const f = opts.fetch ?? realFetch;
  const what = `uploading "${input.name}"`;

  const sessionUrl = await initiateResumableSession(
    token,
    { name: input.name, mime: input.mimeType, parentId: input.parentId, size: input.size },
    f
  );

  const isStream = typeof ReadableStream !== "undefined" && input.body instanceof ReadableStream;
  const putInit: RequestInit & { duplex?: "half" } = {
    method: "PUT",
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    headers: {
      "Content-Type": input.mimeType,
      "Content-Length": String(input.size),
    },
    body: input.body as BodyInit,
    ...(isStream ? { duplex: "half" as const } : {}),
  };
  const put = await f(sessionUrl, putInit);
  if (!put.ok) throw driveErrorFor(put.status, `sending bytes ${what}`, await bodyText(put));
  let file: { id?: string; webViewLink?: string } = {};
  try {
    file = (await put.json()) as { id?: string; webViewLink?: string };
  } catch {
    file = {};
  }
  if (!file.id) throw new DriveApiError(502, `Drive returned no file id after ${what}.`);
  return { id: file.id, webViewLink: file.webViewLink || driveFileLink(file.id) };
}

/** Canonical "open in Drive" link for a file id (what webViewLink resolves to). */
export function driveFileLink(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}
