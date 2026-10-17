import type { CSSProperties } from "react";

/**
 * Estimate photo wrap (spec 2026-10-16 §1, §2) — where key-product photos sit
 * in a system's text and how a photo + its model tag are drawn. Pure;
 * client-safe (type-only React import). One rule for QuoteDocument (PDF,
 * portal, share v1), the package page and the package document.
 *
 * A system's text is a list of UNITS (each narrative block, then each key
 * product as one unit). Photo k anchors before unit k; photos past the last
 * unit all anchor before the last unit (they stack); with no units every
 * photo anchors at 0. The system body is the only float container.
 */

export type PhotoAlign3 = "left" | "right" | "full";

export const PHOTO_TAG_BG = "rgba(22,24,29,.86)";

export function spreadPhotoAnchors(unitCount: number, photoCount: number): number[] {
  const units = Number.isFinite(unitCount) && unitCount > 0 ? Math.floor(unitCount) : 0;
  const n = Number.isFinite(photoCount) && photoCount > 0 ? Math.floor(photoCount) : 0;
  const last = Math.max(0, units - 1);
  return Array.from({ length: n }, (_, k) => Math.min(k, last));
}

/** The figure carries the float (or the full-width block) and is the tag's positioning box. A side (left /
 *  right) figure shrinks to the rendered picture — at most `widthPct` % of the column — so the text wraps right
 *  at the picture's edge (a tall photo no longer leaves a gap) and the corner tag sits on it. */
export function photoFigureStyle(align: PhotoAlign3, widthPct = 34): CSSProperties {
  if (align === "full") return { display: "block", width: `${widthPct}%`, margin: "0 auto 10px", position: "relative", breakInside: "avoid" };
  const box: CSSProperties = { width: "fit-content", maxWidth: `${widthPct}%`, position: "relative", breakInside: "avoid" };
  return align === "left" ? { float: "left", ...box, margin: "0 14px 8px 0" } : { float: "right", ...box, margin: "0 0 8px 14px" };
}

/** A side picture keeps its own proportions: never wider than its figure (`widthPct` %) nor taller than
 *  `maxHeight` — a square or wide photo is as big as before, a tall one is just narrower. Full: fills its figure. */
export function photoImgStyle(align: PhotoAlign3, maxHeight = "2.4in"): CSSProperties {
  if (align === "full") return { display: "block", width: "100%", maxHeight, objectFit: "contain", objectPosition: "center top" };
  return { display: "block", width: "auto", height: "auto", maxWidth: "100%", maxHeight, objectFit: "contain" };
}

/** The model tag: outer bottom corner (bottom-left on a left float, else bottom-right). */
export function photoTagStyle(align: PhotoAlign3, fontPx?: number): CSSProperties {
  return {
    position: "absolute",
    bottom: 0,
    ...(align === "left" ? { left: 0 } : { right: 0 }),
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "2px 6px",
    background: PHOTO_TAG_BG,
    color: "#fff",
    fontFamily: "var(--font-mono)",
    ...(fontPx ? { fontSize: fontPx } : {}),
    lineHeight: 1.35,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

/** Package document (print + editor) — a full-width photo's figure shrinks to the rendered picture (at most
 *  `widthPct` % of the column, centred) so its bottom-right tag sits on the picture, and clears earlier floats. */
export function photoFullFigureStyle(widthPct: number): CSSProperties {
  return { display: "block", width: "fit-content", maxWidth: `${widthPct}%`, margin: "0 auto 10px", position: "relative", breakInside: "avoid", clear: "both" };
}

/** The picture inside a full figure: its own size, never wider than the figure, height-capped. */
export function photoFullImgStyle(maxHeight = "4in"): CSSProperties {
  return { display: "block", width: "auto", maxWidth: "100%", maxHeight, objectFit: "contain" };
}

/** A package-document photo (print + editor, one rule): left/right floats shrink-wrapped to at most `widthPct` % (2.4in cap), full = the shrink-wrapped figure (4in cap). */
export function docPhotoFigureStyle(align: PhotoAlign3, widthPct: number): CSSProperties {
  return align === "full" ? photoFullFigureStyle(widthPct) : photoFigureStyle(align, widthPct);
}
export function docPhotoImgStyle(align: PhotoAlign3): CSSProperties {
  return align === "full" ? photoFullImgStyle("4in") : photoImgStyle(align, "2.4in");
}
