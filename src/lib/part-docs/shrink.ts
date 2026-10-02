// SERVER ONLY — imports sharp (native). Never import from a "use client" file.
/**
 * #283 — every catalog image is shrunk on the way in (spec Part 1): EXIF
 * orientation applied, longest side ≤ 1600 px (never enlarged), re-encoded
 * as WebP q80. sharp drops all metadata (EXIF/GPS) unless asked to keep it.
 * HEIC (iPhone) can't be decoded by sharp's prebuilt binaries and, like any
 * corrupt file, refuses with SHRINK_UNREADABLE.
 */
import sharp from "sharp";

export const SHRINK_MAX_EDGE = 1600;
export const SHRINK_WEBP_QUALITY = 80;
export const SHRINK_MAX_INPUT_PIXELS = 100_000_000;
export const SHRINK_UNREADABLE = "Couldn't read this image — save it as JPEG, PNG or WebP.";

export type ShrinkResult =
  | { ok: true; bytes: Buffer; contentType: "image/webp"; width: number; height: number }
  | { ok: false; error: string };

/** `maxEdge` (default SHRINK_MAX_EDGE) — #292 cut sheets shrink a photo tile further before inlining it. */
export async function shrinkImage(input: Uint8Array, opts: { maxEdge?: number } = {}): Promise<ShrinkResult> {
  const edge = opts.maxEdge && opts.maxEdge > 0 ? Math.min(opts.maxEdge, SHRINK_MAX_EDGE) : SHRINK_MAX_EDGE;
  try {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: SHRINK_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, bytes: data, contentType: "image/webp", width: info.width, height: info.height };
  } catch {
    return { ok: false, error: SHRINK_UNREADABLE };
  }
}

/** "front.JPG" → "front.webp"; no extension → appended; empty → "image.webp". */
export function webpFileName(name: string): string {
  const base = String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "") || "image";
  return `${base}.webp`;
}
