import { put } from "@vercel/blob";

/**
 * Vercel Blob seam (D116, MASTER-HOWTO §9) — file bytes out of the
 * database. Env-gated exactly like Gmail: no BLOB_READ_WRITE_TOKEN, no
 * behavior change (callers fall back to in-database data-URLs), so dev
 * machines without the token keep working untouched.
 *
 * Server-only: the token must never reach a client bundle.
 */

export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Upload one file and return its public URL. `pathname` is the full key
 * (e.g. "grid-sheets/GRD-5002/gs-abc-plan.pdf"); addRandomSuffix guards
 * against overwriting on name collisions.
 */
export async function putBlob(
  pathname: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const res = await put(pathname, bytes, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return res.url;
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
