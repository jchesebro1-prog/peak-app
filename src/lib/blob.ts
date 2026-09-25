import { del, get, put } from "@vercel/blob";

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

/**
 * The first `max` bytes of a private blob, plus its stored size — enough to
 * sniff what a client-uploaded file really is (part documents, #DOC) without
 * pulling a 25 MB file through the function. Null when the blob is missing.
 */
export async function getBlobHead(
  pathname: string,
  max: number
): Promise<{ bytes: Uint8Array; size: number } | null> {
  const res = await get(pathname, { access: "private" });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const reader = res.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  const bytes = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, bytes.length - at);
    if (take <= 0) break;
    bytes.set(c.subarray(0, take), at);
    at += take;
  }
  return { bytes, size: res.blob.size };
}

/** Stream a private blob's bytes (server-side; the proxy route's engine). */
export async function getBlobStream(
  pathname: string
): Promise<ReadableStream | null> {
  const res = await get(pathname, { access: "private" });
  return (res && (res.stream as unknown as ReadableStream)) || null;
}

/**
 * Delete a blob by pathname (Recordings archive, spec §5.2 step 4): called
 * strictly AFTER Drive has returned a file id, never before. `del` resolves
 * even when the blob is already gone, so a retried archive pass is safe.
 */
export async function deleteBlob(pathname: string): Promise<void> {
  await del(pathname);
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

/** Safe pathname segment from a user filename. */
export function safeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file"
  );
}
