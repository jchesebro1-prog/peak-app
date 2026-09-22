/**
 * Engagement file seam (#145, D171). One union resolved at write time by
 * what is configured: Drive when the archive mailbox is connected, Blob
 * when BLOB_READ_WRITE_TOKEN is set, data-URL locally (Vercel Blob refuses
 * local dev uploads under OIDC — see PUNCHLIST #143).
 *
 * Pure: no imports, so the ownership check is spec-tested with no DB.
 */

export type FileMeta = { name: string; mime: string; size: number };
export type FileRef =
  | ({ kind: "drive"; fileId: string; webViewLink: string } & FileMeta)
  | ({ kind: "blob"; pathname: string } & FileMeta)
  | ({ kind: "data"; dataUrl: string } & FileMeta);

/** Every engagement-file Blob object lives under this prefix, scoped
 *  per-engagement as `${ENGAGEMENT_FILES_BLOB_PREFIX}${engagementId}/...` —
 *  the exact shape the upload route mints. `ownsEngagementFile` requires it
 *  structurally, so ONE literal owns it rather than the write path and the
 *  read path each hard-coding their own copy that could drift apart. */
export const ENGAGEMENT_FILES_BLOB_PREFIX = "engagement-files/";

export function fileRefName(ref: FileRef): string {
  return ref.name;
}

/** The storage key a proxy would stream by — the value the ownership check
 *  compares against. A data-URL ref has no key: its bytes are in the doc. */
export function fileRefKey(ref: FileRef): string {
  if (ref.kind === "drive") return ref.fileId;
  if (ref.kind === "blob") return ref.pathname;
  return "";
}

/**
 * THE ownership check (mirrors ownsVendorQuoteBlobPath). A client names a
 * file id under a named engagement; this proves that id is BOTH actually
 * stored there AND — where the key has a shape to check — bound to that
 * exact engagement, before the caller may touch storage.
 *
 * `ownsVendorQuoteBlobPath` is two checks, not one: "is it on the record's
 * own attachment field" (a DB read) plus "does the path's own shape belong
 * to this record" (a string check, because the DB read alone is only ever
 * as trustworthy as whatever wrote that field — and once a writer takes
 * client-supplied FileRef data, as this seam's note attachments will,
 * nothing stops a crafted save from naming ANY object in the private
 * store). This function is the second half for "blob" keys: a `"blob"` ref
 * must sit under `ENGAGEMENT_FILES_BLOB_PREFIX + engagementId + "/"` — the
 * exact prefix the upload route mints — and must never contain `..`. A
 * pathname borrowed from vendor-quotes/, grid-sheets/, recordings/, or
 * another engagement's own slice fails this regardless of what got written
 * to the engagement's notes.
 *
 * "drive" keys are opaque Google-assigned ids with no shape to bind — there
 * is no string-level check that can distinguish "a Drive file this
 * engagement's folder legitimately owns" from "any Drive file id an
 * attacker typed in." For that kind, this function can only clear the
 * necessary (is-it-stored) half; the CALLER — the download proxy — MUST
 * additionally re-verify a "drive" ref live against Drive's own metadata
 * (its actual current parent folder) before streaming it. That live check
 * cannot live in this module: it needs a network call, and this module is
 * deliberately pure with zero imports so the ownership check is spec-tested
 * with no DB and no network. See the proxy route for that second half.
 */
export function ownsEngagementFile(
  refs: readonly FileRef[],
  requestedKey: string,
  engagementId: string
): boolean {
  if (!requestedKey || !engagementId) return false;
  const ref = refs.find((r) => {
    const k = fileRefKey(r);
    return !!k && k === requestedKey;
  });
  if (!ref) return false;
  if (ref.kind === "blob") {
    if (ref.pathname.includes("..")) return false;
    const prefix = `${ENGAGEMENT_FILES_BLOB_PREFIX}${engagementId}/`;
    if (!ref.pathname.startsWith(prefix)) return false;
  }
  return true;
}

/** Drive folder path for an engagement. Separators in a customer name are
 *  replaced, never honoured — a name is data, not a path. */
export function engagementFolderPath(customer: string, engagementId: string): string {
  const safe = String(customer || "Unknown")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `Peak Projects/${safe}/${engagementId}`;
}

/**
 * The URL a client renders as this file's link/download target.
 *
 * A "data" ref has no storage key (fileRefKey returns "") — its bytes
 * already live in the document, so the dataUrl itself IS the href and no
 * network round trip is needed. "drive" and "blob" refs both route through
 * this app's own authenticated, ownership-checked proxy rather than a raw
 * Drive webViewLink: the file was created by the app's own Drive
 * connection (scope drive.file), so a teammate's browser has no standing
 * Google-side access to it, and the proxy is the only path that has
 * already proven the id belongs to this engagement before it streams
 * anything.
 */
export function fileRefHref(ref: FileRef, engagementId: string): string {
  if (ref.kind === "data") return ref.dataUrl;
  return `/api/engagement-files/${encodeURIComponent(engagementId)}/${encodeURIComponent(fileRefKey(ref))}`;
}

/**
 * Largest RAW byte size the upload route will hand back `{ mode: "data" }`
 * for. Whatever saves a "data" ref carries the base64-encoded dataUrl (4/3
 * inflation) inside its own payload — a note-save server action, per
 * AGENTS.md, is capped at ~1200kb. 700 KiB of raw bytes inflates to ~933kb
 * of base64, leaving headroom in that payload for the note's own text and
 * metadata. Exported so the client can refuse a too-big file before ever
 * asking this route what to do with it, not just after.
 */
export const DATA_URL_MAX_BYTES = 700 * 1024;
