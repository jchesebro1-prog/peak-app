// SERVER ONLY — imports sharp (native). Never import from a "use client" file.
/**
 * #283 — every catalog image is shrunk on the way in (spec Part 1): EXIF
 * orientation applied, longest side ≤ 1600 px (never enlarged), re-encoded
 * as WebP q80. sharp drops all metadata (EXIF/GPS) unless asked to keep it.
 * HEIC (iPhone) can't be decoded by sharp's prebuilt binaries and, like any
 * corrupt file, refuses with SHRINK_UNREADABLE.
 */
import sharp, { type OutputInfo } from "sharp";

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

/** #322 — a product photo is a square: the product trimmed, fitted in a content box and centred on a 1600 px canvas. */
export const SQUARE_EDGE = 1600;
export const SQUARE_MARGIN = 64;
const SQUARE_CONTENT = SQUARE_EDGE - 2 * SQUARE_MARGIN;
const TRIM_THRESHOLD = 10;
const TRIM_MIN_PX = 8;

/**
 * #322 — every catalog product photo comes out the same 1600×1600: EXIF
 * applied, uniform borders trimmed (skipped when the trim fails or leaves
 * < 8 px), the product fitted inside a 1472 px box (enlarged if small, never
 * cropped), centred on the square with a 64 px margin. Cut-outs with real
 * transparency keep it; everything else gets opaque white. WebP like
 * shrinkImage; the same refusal for an unreadable file.
 */
export async function squareProductImage(input: Uint8Array): Promise<ShrinkResult> {
  const guard = { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS } as const;
  try {
    const upright = () => sharp(input, guard).rotate();
    let raw: { data: Buffer; info: OutputInfo } | null = null;
    try {
      const t = await upright().trim({ threshold: TRIM_THRESHOLD }).raw().toBuffer({ resolveWithObject: true });
      if (t.info.width >= TRIM_MIN_PX && t.info.height >= TRIM_MIN_PX) raw = t;
    } catch {
      raw = null; // e.g. a perfectly uniform image — use it untrimmed
    }
    if (!raw) raw = await upright().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = raw.info;
    const source = () => sharp(raw!.data, { raw: { width, height, channels }, limitInputPixels: SHRINK_MAX_INPUT_PIXELS });
    const transparent = (channels === 2 || channels === 4) && !(await source().stats()).isOpaque;
    const background = { r: 255, g: 255, b: 255, alpha: transparent ? 0 : 1 };
    const { data, info } = await source()
      .resize({ width: SQUARE_CONTENT, height: SQUARE_CONTENT, fit: "contain", background })
      .extend({ top: SQUARE_MARGIN, bottom: SQUARE_MARGIN, left: SQUARE_MARGIN, right: SQUARE_MARGIN, background })
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
