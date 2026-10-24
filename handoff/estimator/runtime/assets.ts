/**
 * Estimator handoff — where the app's server-routed image URLs point in a file:// page.
 *
 * The app's client code writes two kinds of absolute image URL the prototype has no server for:
 *
 *   /placeholders/<name>.webp      the placeholder chain (src/lib/part-image-fallback.ts PLACEHOLDER_SRC)
 *                                   → ./app/assets/placeholders/<name>.webp (build.ts copies public/placeholders)
 *   /api/part-documents/<docId>    a part document (photo, manufacturer image)
 *                                   → partDocumentSrc(docId): the packaged product photo when the package ships one
 *                                     (window.PEAK_PHOTOS, below), else the "Image coming soon" placeholder — the
 *                                     last link of the portal chain.
 *
 * `assetUrl` is the ONE rewrite; `installAssetUrlRewrite` applies it to every <img> src as it is set
 * (Element.setAttribute and the HTMLImageElement `src` setter), so the browser never requests the server
 * path (a MutationObserver would fire after the request had already failed). Plan: PR 2 Task 5.
 */
import { PLACEHOLDER_SRC, type PlaceholderName } from "@/lib/part-image-fallback";

/** Where build.ts puts public/placeholders/*.webp, relative to index.html. */
export const PLACEHOLDER_DIR = "./app/assets/placeholders/";

const PART_DOC_RE = /^\/api\/part-documents\/([^/?#]+)/;
const PLACEHOLDER_RE = /^\/placeholders\/([a-z-]+\.webp)$/;

/** The packaged copy of a placeholder image. */
export function placeholderSrc(name: PlaceholderName): string {
  return PLACEHOLDER_DIR + PLACEHOLDER_SRC[name].replace(/^\/placeholders\//, "");
}

/**
 * The packaged product photos — ONE scheme for every lookup (Task 11, photo-select.ts / handoff:slice → data/photos.js):
 *   window.PEAK_PHOTOS = { bySku: { [sku]: docId }, byDoc: { [docId]: "images/<file>" } }
 * A part's photo is bySku[sku] → byDoc[docId]. The Catalog thumbnails (partPhotoSrc), the quote document's key-product
 * photos (photoDocIdForSku → partDocumentSrc) and any /api/part-documents/<docId> URL all go through it. Absent
 * (no photos.js) or a sku/doc not in it → the "Image coming soon" placeholder.
 */
type PhotoMap = { bySku?: unknown; byDoc?: unknown };

function mapOf(table: unknown): Record<string, unknown> | null {
  return table && typeof table === "object" && !Array.isArray(table) ? (table as Record<string, unknown>) : null;
}

function lookup(table: unknown, key: string): string | null {
  const t = mapOf(table);
  if (!t || !Object.prototype.hasOwnProperty.call(t, key)) return null;
  const v = t[key];
  return typeof v === "string" && v ? v : null;
}

function photoMap(): PhotoMap {
  const g = (typeof window === "undefined" ? {} : window) as { PEAK_PHOTOS?: unknown };
  return (mapOf(g.PEAK_PHOTOS) ?? {}) as PhotoMap;
}

/** A part document's packaged image (`images/<file>`), or null when the package has none. */
export function packagedPhotoFor(docId: string): string | null {
  return lookup(photoMap().byDoc, docId);
}

/** The part document a sku shows as its photo (its primary visible image, else its manufacturer's), or null when the package has none. */
export function photoDocIdForSku(sku: string): string | null {
  const id = lookup(photoMap().bySku, sku);
  return id && packagedPhotoFor(id) ? id : null;
}

/** `/api/part-documents/<docId>` → the packaged photo, else the "coming soon" placeholder. */
export function partDocumentSrc(docId: string): string {
  return packagedPhotoFor(docId) ?? placeholderSrc("coming-soon");
}

/** A catalog part's thumbnail: its packaged photo (sku → doc → file), else the "coming soon" placeholder. */
export function partPhotoSrc(sku: string): string {
  const id = photoDocIdForSku(sku);
  return id ? partDocumentSrc(id) : placeholderSrc("coming-soon");
}

/** The prototype's URL for an app image URL; anything else comes back unchanged. */
export function assetUrl(url: string): string {
  if (typeof url !== "string" || !url.startsWith("/")) return url;
  const doc = PART_DOC_RE.exec(url);
  if (doc) {
    let id = doc[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw id */
    }
    return partDocumentSrc(id);
  }
  const ph = PLACEHOLDER_RE.exec(url);
  if (ph) return PLACEHOLDER_DIR + ph[1];
  return url;
}

let installed = false;

/** Rewrites every <img> src through assetUrl as it is set. Idempotent. Browser only. */
export function installAssetUrlRewrite(): void {
  if (installed || typeof window === "undefined" || typeof HTMLImageElement === "undefined") return;
  installed = true;
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (this instanceof HTMLImageElement && (name === "src" || name === "SRC")) value = assetUrl(String(value));
    return setAttribute.call(this, name, value);
  };
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (desc?.set && desc.get) {
    const set = desc.set;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...desc,
      set(this: HTMLImageElement, v: string) {
        set.call(this, assetUrl(String(v)));
      },
    });
  }
}
