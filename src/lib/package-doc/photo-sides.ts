import type { ImageAlign, PhotoAlign } from "./types";

/**
 * Jeff 2026-10-15 #20 — the one alternation rule for a package document's
 * photos, shared by the print (resolvePackageDoc) and the editor's preview
 * (#352 review M4): an "auto" product image floats opposite the last printed
 * side photo (the first one right); an explicit Left / Right sets the side,
 * Full leaves it. Only photos that print count. Pure and client-safe.
 */
export type Side = "left" | "right";

/** An image's effective align given the last printed side. */
export function resolveAutoAlign(align: ImageAlign, last: Side | null): PhotoAlign {
  return align === "auto" ? (last === "right" ? "left" : "right") : align;
}

/** The last printed side after a photo printed with `effective`. */
export function nextLastSide(last: Side | null, effective: PhotoAlign): Side | null {
  return effective === "left" || effective === "right" ? effective : last;
}

/** Each top-level block's effective photo align, in order (null = no printed photo there). */
export function walkPhotoSides(items: ReadonlyArray<ImageAlign | null>): Array<PhotoAlign | null> {
  let last: Side | null = null;
  return items.map((a) => {
    if (a === null) return null;
    const eff = resolveAutoAlign(a, last);
    last = nextLastSide(last, eff);
    return eff;
  });
}
