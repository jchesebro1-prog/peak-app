import { get, put } from "@vercel/blob";

/**
 * Vercel Blob seam (D116, MASTER-HOWTO §9) — file bytes out of the
 * database. Env-gated exactly like Gmail: no BLOB_READ_WRITE_TOKEN, no
 * behavior change (callers fall back to in-database data-URLs), so dev
 * machines without the token keep working untouched.
 *
 * The store is PRIVATE (deliberately — customer venue drawings must not
 * live behind world-readable URLs): uploads carry access "private", and
 * browsers read files only through the app's authenticated proxy route,
 * which streams via `getBlobStream` server-side.
 *
 * Server-only: the token must never reach a client bundle.
 */

export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Upload one file. Returns the blob's URL (provenance only — not fetchable
 * without auth) and the stored pathname (what the proxy streams by).
 * addRandomSuffix guards against overwriting on name collisions.
 */
export async function putBlob(
  pathname: string,
  bytes: Buffer,
  contentType: string
): Promise<{ url: string; pathname: string }> {
  const res = await put(pathname, bytes, {
    access: "private",
    contentType,
    addRandomSuffix: true,
  });
  return { url: res.url, pathname: res.pathname };
}

/** Stream a private blob's bytes (server-side; the proxy route's engine). */
export async function getBlobStream(
  pathname: string
): Promise<ReadableStream | null> {
  const res = await get(pathname, { access: "private" });
  return (res && (res.stream as unknown as ReadableStream)) || null;
}

/** Decode a data-URL's payload to bytes (the upload transport is still the
 *  ≤8 MB data-URL from the browser; only STORAGE moves to Blob). */
export function dataUrlToBytes(dataUrl: string): { bytes: Buffer; mime: string } {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) throw new Error("Not a data URL");
  const mime = m[1] || "application/octet-stream";
  const bytes = m[2]
    ? Buffer.from(m[3], "base64")
    : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { bytes, mime };
}

/**
 * True if `pathname` is safely confined under `prefix`. A plain
 * `pathname.startsWith(prefix)` is NOT enough on its own: @vercel/blob's
 * get() builds its fetch URL by string interpolation and hands it to
 * fetch, whose URL parser collapses ".." dot-segments during normalization.
 * A path like "client-packages/../part-datasheets/x.pdf" passes a bare
 * startsWith(prefix) check but resolves, post-normalization, to
 * "part-datasheets/x.pdf" — escaping the prefix entirely. This app never
 * legitimately writes blob paths containing "..", so rejecting them
 * outright is correct, not just defensive.
 */
export function isBlobPathUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname.startsWith(prefix) && !pathname.includes("..");
}

/** Safe pathname segment from a user filename. */
export function safeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file"
  );
}
