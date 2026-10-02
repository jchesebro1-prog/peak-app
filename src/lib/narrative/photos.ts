import { getMany } from "@/lib/stores/catalog";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import { getBlobStream } from "@/lib/blob";
import { photoSkusOf } from "@/app/(app)/estimator/narrative";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { PartDocument } from "@/lib/part-docs/types";

/**
 * #293 — key-product photos for the customer document. The photo is the
 * part's primary visible image (visibleImagesForParts()[sku][0] — the same
 * image the portal tile shows; a datasheet-render thumbnail only when the
 * part has no real image). Only live catalog parts (a soft-deleted part
 * prints its paragraph with no photo).
 *
 * The print route has no session, so the PDF embeds photos as data URIs —
 * no second authenticated fetch, no token in an <img> URL. PNG/JPEG/WebP
 * only (never SVG — the portal doc route's allowlist), ≤ 3 MB each, ≤ 15 MB
 * per document, ≤ 6 concurrent reads. Any failure = no photo + a warning;
 * a photo never fails the render.
 */

export const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_TOTAL_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTO_READ_CONCURRENCY = 6;

/** Every photo read shares one deadline (ms): a hung Blob GET can't hold the
 *  print route past its own render step timeout (RENDER_STEP_TIMEOUT_MS,
 *  30 s). Photos not read by then are skipped with a warning. */
export const PHOTO_INLINE_DEADLINE_MS = 8000;

export type PhotoReader = (blobKey: string, maxBytes: number, signal?: AbortSignal) => Promise<Uint8Array | null>;
export type PhotoCaps = { perImage: number; total: number; concurrency: number; deadlineMs?: number };

/** sku → primary visible image doc, for the photo-on blocks of narrative systems. */
export async function keyProductPhotoDocs(sections: SpecSection[]): Promise<Map<string, PartDocument>> {
  const skus = photoSkusOf(sections);
  const out = new Map<string, PartDocument>();
  if (!skus.length) return out;
  const [parts, images] = await Promise.all([getMany(skus), visibleImagesForParts(skus)]);
  const live = new Set(parts.map((p) => p.sku));
  for (const sku of skus) {
    const doc = live.has(sku) ? images.get(sku)?.[0] : undefined;
    if (doc) out.set(sku, doc);
  }
  return out;
}

/** Read a private blob, giving up (null) past `maxBytes`. */
export async function readBlobCapped(blobKey: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array | null> {
  const stream = await getBlobStream(blobKey, { signal });
  if (!stream) return null;
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Inline photo docs as data URIs within the caps (pure apart from `read`).
 *  Reads run in batches of `concurrency` under ONE overall deadline (a read
 *  still pending then is aborted and skipped), and a running byte total
 *  stops reading once the document budget is spent — a photo whose stored
 *  size no longer fits is never read. Never throws. */
export async function inlinePhotos(
  docs: ReadonlyMap<string, PartDocument>,
  read: PhotoReader,
  caps: PhotoCaps = { perImage: PHOTO_MAX_BYTES, total: PHOTO_TOTAL_MAX_BYTES, concurrency: PHOTO_READ_CONCURRENCY }
): Promise<Record<string, { src: string; alt: string }>> {
  const entries = [...docs].filter(([, d]) => PHOTO_TYPES.has(d.contentType) && !!d.blobKey && !(d.size > caps.perImage));
  const out: Record<string, { src: string; alt: string }> = {};
  if (!entries.length) return out;
  const abort = new AbortController();
  const TIMEOUT = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(TIMEOUT);
    }, Math.max(0, caps.deadlineMs ?? PHOTO_INLINE_DEADLINE_MS));
  });
  let total = 0;
  try {
    for (let i = 0; i < entries.length; i += caps.concurrency) {
      const batch = entries.slice(i, i + caps.concurrency);
      const remaining = caps.total - total;
      if (abort.signal.aborted || remaining <= 0) {
        for (const [sku, d] of entries.slice(i))
          console.warn(abort.signal.aborted ? "[narrative] key-product photo skipped (photo deadline reached)" : "[narrative] key-product photo skipped (document photo budget reached)", sku, d.id);
        break;
      }
      const got = await Promise.all(
        batch.map(async ([sku, d]): Promise<Uint8Array | null> => {
          if (d.size > remaining) {
            console.warn("[narrative] key-product photo skipped (document photo budget reached)", sku, d.id);
            return null;
          }
          try {
            const b = await Promise.race([read(d.blobKey as string, caps.perImage, abort.signal), expired]);
            if (b === TIMEOUT) {
              console.warn("[narrative] key-product photo skipped (photo deadline reached)", sku, d.id);
              return null;
            }
            if (b && b.byteLength <= caps.perImage) return b;
            console.warn("[narrative] key-product photo skipped (missing or over 3 MB)", sku, d.id);
          } catch (e) {
            console.warn("[narrative] key-product photo unreadable", sku, d.id, e instanceof Error ? e.message : e);
          }
          return null;
        })
      );
      batch.forEach(([sku, d], j) => {
        const b = got[j];
        if (!b) return;
        if (total + b.byteLength > caps.total) {
          console.warn("[narrative] key-product photo skipped (document photo budget reached)", sku, d.id);
          return;
        }
        total += b.byteLength;
        out[sku] = { src: `data:${d.contentType};base64,${Buffer.from(b).toString("base64")}`, alt: d.title || sku };
      });
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  return out;
}

/** The print route's call: sku → { src: data URI, alt }. Never throws. */
export async function keyProductPhotoDataUris(sections: SpecSection[]): Promise<Record<string, { src: string; alt: string }>> {
  try {
    return await inlinePhotos(await keyProductPhotoDocs(sections), readBlobCapped);
  } catch (e) {
    console.warn("[narrative] key-product photos unavailable", e instanceof Error ? e.message : e);
    return {};
  }
}
