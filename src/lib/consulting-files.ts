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
 * A single path segment as `safeName`'s own output charset allows it
 * (`src/lib/blob.ts` — `[a-zA-Z0-9._-]`) — a superset of what `safeName`
 * plus `putBlob`'s random suffix can ever mint. `.` is in that charset
 * (an ordinary filename has one), so this alone is NOT enough: a segment
 * of ALL dots (`.`, `..`, `...`) matches it too, which is exactly `..`
 * traversal wearing a shape this regex would otherwise accept. See
 * `ALL_DOTS_SEGMENT_RE` below for the second half of that check.
 */
const BLOB_KEY_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
/** A path segment that is nothing but dots — `.`/`..`/`...`/etc. Every one
 *  of these is a traversal segment on every filesystem and URL resolver
 *  that treats "/" as a separator; none of them is a shape `safeName` or
 *  `putBlob`'s random suffix ever produces (both always include at least
 *  one non-dot character). */
const ALL_DOTS_SEGMENT_RE = /^\.+$/;

/**
 * Does this "blob" pathname structurally belong to this exact engagement?
 * The second half of the ownership check for "blob" keys (see
 * `ownsEngagementFile`'s doc comment) — also used standalone by
 * `consulting-files-server.ts`'s `validateFileRefsForEngagement` to check
 * a ref BEFORE it is ever stored, not just when reading one back.
 *
 * This is a POSITIVE allowlist on the remainder's shape, segment by
 * segment — not a `..` denylist on the raw string: `@vercel/blob`'s
 * `constructBlobUrl` interpolates the pathname RAW and UNENCODED into the
 * blob URL, so a percent-encoded traversal segment (`%2e%2e%2f...`)
 * carries no literal `..` substring and would sail through a denylist
 * while still reaching that URL construction — `%` isn't in the allowed
 * charset, so the positive check refuses it directly. This also closes
 * `?` and `#`, which would otherwise turn part of a key into a query
 * string or fragment against that same raw-interpolated URL. Whether the
 * storage host itself would resolve an encoded `..` isn't something this
 * module can determine without the live service — which is exactly why
 * the check doesn't depend on that answer.
 */
export function isOwnedBlobPathname(pathname: string, engagementId: string): boolean {
  if (!pathname || !engagementId) return false;
  const prefix = `${ENGAGEMENT_FILES_BLOB_PREFIX}${engagementId}/`;
  if (!pathname.startsWith(prefix)) return false;
  const remainder = pathname.slice(prefix.length);
  if (!remainder) return false;
  return remainder
    .split("/")
    .every((segment) => BLOB_KEY_SEGMENT_RE.test(segment) && !ALL_DOTS_SEGMENT_RE.test(segment));
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
 * store). This function is the second half for "blob" keys: see
 * `isOwnedBlobPathname` above. A pathname borrowed from vendor-quotes/,
 * grid-sheets/, recordings/, or another engagement's own slice fails this
 * regardless of what got written to the engagement's notes.
 *
 * "drive" keys are opaque Google-assigned ids with no shape to bind — there
 * is no string-level check that can distinguish "a Drive file this
 * engagement's folder legitimately owns" from "any Drive file id an
 * attacker typed in." For that kind, this function can only clear the
 * necessary (is-it-stored) half; the CALLER — the download proxy, and
 * `validateFileRefsForEngagement` — MUST additionally re-verify a "drive"
 * ref live against Drive's own metadata (its actual current parent folder,
 * via `driveFileHasParent` in `drive.ts`) before streaming or accepting it.
 * That live check cannot live in this module: it needs a network call, and
 * this module is deliberately pure with zero imports so the ownership
 * check is spec-tested with no DB and no network.
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
  if (ref.kind === "blob") return isOwnedBlobPathname(ref.pathname, engagementId);
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
export function fileRefHref(ref: FileRef, engagementId: string, noteId?: string, attachmentIndex?: number): string {
  if (ref.kind === "data") return ref.dataUrl;
  if (!noteId || !Number.isInteger(attachmentIndex) || attachmentIndex! < 0) return "#";
  return `/api/engagement-files/${encodeURIComponent(engagementId)}/${encodeURIComponent(noteId)}/${attachmentIndex}`;
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

/**
 * A syntactically legal MIME token per RFC 6838 (type "/" subtype, each a
 * restricted-name), or `application/octet-stream` when the input isn't
 * one. Used everywhere a client-supplied mime gets echoed into a response
 * header: CR/LF is a header-injection vector, and non-ASCII/control bytes
 * throw inside the `Response` constructor either way — a clean refusal
 * would otherwise become a 500. Positive validation, not a denylist of
 * whichever bad bytes someone thought to test for — same reasoning as
 * `isOwnedBlobPathname` above.
 */
const MIME_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

export function safeMime(mime: string | null | undefined): string {
  return mime && MIME_TOKEN_RE.test(mime) ? mime : "application/octet-stream";
}

/** A syntactically well-formed `data:` URL — scheme, an optional mime type
 *  ("/" subtype), optional `;param=value` segments, an optional `;base64`,
 *  then the required comma before the payload. */
const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)?(;[a-zA-Z0-9-]+=[a-zA-Z0-9-]+)*(;base64)?,/i;

/**
 * Mime types a "data" ref may never declare — anything a browser would
 * execute or render as markup rather than treat as an opaque payload. A
 * "data" ref's bytes are never proxied (there is no server-side gate on
 * the way OUT — `fileRefKey` returns "" for it, so `ownsEngagementFile`
 * can never select one to stream): a UI that ever hands `ref.dataUrl` to
 * an `<a href>`, `<iframe src>`, or a same-origin navigation would let the
 * browser interpret exactly this content. This is therefore the ONLY gate,
 * and it has to run at validation time, before the ref is ever stored.
 */
const DANGEROUS_DATA_MIME_RE = /^(text\/x?html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/i;

/**
 * Is this "data" ref safe to store (and, later, safe for a UI to render)?
 * Used by `validateFileRefsForEngagement` (consulting-files-server.ts) —
 * the only place a client-supplied `dataUrl` gets inspected at all.
 */
export function isValidDataRef(ref: Extract<FileRef, { kind: "data" }>): boolean {
  const m = DATA_URL_RE.exec(ref.dataUrl);
  if (!m) return false;
  const declaredMime = (m[1] || "text/plain").toLowerCase();
  if (DANGEROUS_DATA_MIME_RE.test(declaredMime)) return false;
  if (DANGEROUS_DATA_MIME_RE.test((ref.mime || "").toLowerCase())) return false;
  // Generous ceiling: base64 inflates by 4/3 and the "data:...;base64,"
  // header adds a little more on top — this only needs to catch a payload
  // wildly beyond DATA_URL_MAX_BYTES, not compute the encoding exactly, so
  // a claimed `ref.size` can never be used to smuggle a bigger one through.
  if (ref.dataUrl.length > DATA_URL_MAX_BYTES * 2) return false;
  return true;
}
