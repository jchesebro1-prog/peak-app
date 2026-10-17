"use client";

import { useState, type CSSProperties } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { keyProductHeading } from "@/app/(app)/estimator/narrative";
import { findLine, findSection } from "@/lib/package-doc/chips";
import { lineAnchorInBom } from "@/lib/package-doc/gaps";
import { clampPhotoWidth, PHOTO_WIDTH_MAX, PHOTO_WIDTH_MIN } from "@/lib/package-doc/schema";
import type { ImageAlign, LineAnchor } from "@/lib/package-doc/types";
import { AtomRemove } from "./atom-remove";
import { usePackageDocEnv } from "./editor-context";
import { setImageAttrs } from "./editor-commands";
import { editorPhotoTag, isLineTokenSku, linePhotoPreview, withImage, type ImageAttrs } from "./editor-model";
import { docPhotoImgStyle, photoTagStyle } from "@/lib/estimate-output/photo-spread";
import { walkPhotoSides } from "@/lib/package-doc/photo-sides";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Estimator #312 — a product's photo as its own piece (productImage): just
 * the image, no label. Floated left / right at `width` % of the column (or
 * full width, centred) exactly like the print, so the paragraphs after it
 * wrap beside it here too. Same photo source as an older product block's
 * preview (linePhotoPreview: own photo → kind placeholder → manufacturer
 * image), with its model tag on the outer bottom corner like the print
 * (editorPhotoTag). Drag the image to move it anywhere in the document. Selected: a
 * small strip with Left / Right / Full, Size and Remove. Amber outline +
 * `No longer in BOM` while its line is gone (it still prints). With no photo
 * it shows a `No photo for this part` box — in the editor only; it prints
 * nothing.
 */

const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 5, padding: "3px 7px", cursor: "pointer" };
// Jeff 2026-10-15 #20: Auto (the default) alternates right, left, right when printed; the others are explicit.
const ALIGNS: Array<[ImageAlign, string]> = [["auto", "Auto"], ["left", "Left"], ["right", "Right"], ["full", "Full"]];
const AMBER = "#d9a63a";

/** Where the image sits: the print's float (package-doc-view DocFigure), on the
 *  wrapper. `clear: both` starts each image below an earlier float (consecutive
 *  photos stack instead of sitting side by side), like `.pd-doc .pd-image`. A full
 *  image shrinks to the picture (at most `width` %, centred), so its tag sits on it. */
/** Matches the print's figure: a photo shrinks the box to the picture (at most `width` %); the "No photo" box keeps the full `width` %. */
function wrapperStyle(img: ImageAttrs, hasPhoto: boolean): CSSProperties {
  if (img.align === "full") return { display: "block", width: "fit-content", maxWidth: `${img.width}%`, margin: "4px auto 10px", clear: "both" };
  const box: CSSProperties = hasPhoto ? { width: "fit-content", maxWidth: `${img.width}%` } : { width: `${img.width}%` };
  if (img.align === "left") return { float: "left", ...box, margin: "4px 14px 8px 0", clear: "both" };
  return { float: "right", ...box, margin: "4px 0 8px 14px", clear: "both" };
}

/** The side an image at `pos` previews on: its own align, or — for Auto — the print's alternation up to it. */
function autoSide(doc: PMNode, pos: number | undefined, align: ImageAlign, hasPhoto: (a: LineAnchor) => boolean): ImageAlign {
  if (align !== "auto" || typeof pos !== "number") return align === "auto" ? "right" : align;
  const items: Array<ImageAlign | null> = [];
  let at = -1;
  doc.forEach((child, offset) => {
    if (offset === pos) at = items.length;
    const a = child.attrs as { sectionId?: unknown; lineKey?: unknown; sku?: unknown; align?: unknown; photo?: { show?: unknown; align?: unknown } };
    const anchor: LineAnchor = { sectionId: String(a.sectionId || ""), lineKey: String(a.lineKey || ""), sku: String(a.sku || "") };
    if (child.type.name === "productImage") items.push(hasPhoto(anchor) ? withImage({ align: a.align as ImageAlign }, {}).align : null);
    else if (child.type.name === "productBlock" && a.photo?.show === true) items.push(hasPhoto(anchor) ? withImage({ align: a.photo.align as ImageAlign }, {}).align : null);
    else items.push(null);
  });
  return at >= 0 ? walkPhotoSides(items)[at] ?? "right" : "right";
}

export default function ProductImageView({ node, editor, getPos, selected }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  const [hover, setHover] = useState(false);
  const a: LineAnchor = { sectionId: String(node.attrs.sectionId || ""), lineKey: String(node.attrs.lineKey || ""), sku: String(node.attrs.sku || "") };
  const img = withImage(node.attrs as Partial<ImageAttrs>, {});
  const sections = env?.ctx.sections ?? [];
  const rows = env?.library.rows;
  const row = !isLineTokenSku(a.sku) && a.sku && rows && Object.hasOwn(rows, a.sku) ? rows[a.sku] : undefined;
  const preview = linePhotoPreview(a, sections, row);
  const tag = editorPhotoTag(a, sections, row);
  const inBom = !env || lineAnchorInBom(a, sections);
  const line = inBom ? findLine(findSection(sections, a.sectionId), a.lineKey) : null;
  const name = (line && keyProductHeading(line)) || (row && row.desc) || a.sku || "Product";

  // #352 review M4: an Auto image previews on the side the print gives it — the same rule (walkPhotoSides) over the
  // document's top-level blocks, counting only the photos that print (an image or photo-on product block with a source).
  const shown = withImage({ ...img, align: autoSide(editor.state.doc, getPos(), img.align, (anchor) => {
    const r = !isLineTokenSku(anchor.sku) && anchor.sku && rows && Object.hasOwn(rows, anchor.sku) ? rows[anchor.sku] : undefined;
    return !!linePhotoPreview(anchor, sections, r);
  }) }, {});

  /** The previewed side as the print's PhotoAlign (an unresolved Auto previews right). */
  const shownAlign = shown.align === "left" ? "left" : shown.align === "full" ? "full" : "right";

  const patch = (p: Partial<ImageAttrs>) => {
    const at = getPos();
    if (typeof at === "number") setImageAttrs(editor, at, p);
  };

  const strip: CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    ...(shown.align === "right" ? { right: 0 } : shown.align === "left" ? { left: 0 } : { left: "50%", transform: "translateX(-50%)" }),
    zIndex: 4,
    display: "flex",
    alignItems: "center",
    gap: 5,
    whiteSpace: "nowrap",
    padding: "4px 6px",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 7,
    boxShadow: "0 4px 14px rgba(16,24,40,.12)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    color: "#5b616e",
    userSelect: "none",
  };

  return (
    <NodeViewWrapper
      className="pd-ed-image"
      contentEditable={false}
      data-sku={a.sku}
      data-align={img.align}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        // Above the following product block's own `position: relative` wrapper
        // (later in the DOM), which otherwise paints over the floated image and
        // swallows its clicks; the selected image (and its strip) sits higher.
        position: "relative",
        zIndex: selected ? 5 : 2,
        ...wrapperStyle(shown, !!preview),
        borderRadius: 4,
        outline: selected ? "2px solid #6b8fd1" : !inBom ? `2px solid ${AMBER}` : hover ? "1.5px dashed #b9bec8" : "1.5px dashed transparent",
        outlineOffset: 3,
      }}
    >
      <div data-drag-handle="" title={`${name} — drag to move`} style={{ position: "relative", cursor: "grab" }}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.src} alt={name} draggable={false} style={docPhotoImgStyle(shownAlign)} />
        ) : (
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 84, padding: 8, border: "1.5px dashed #cfd3da", borderRadius: 6, background: "#fafbfc", fontSize: 11, color: "#8c919c", textAlign: "center" }}
          >
            No photo for this part
          </div>
        )}
        {tag ? <span style={photoTagStyle(shownAlign, 10)}>{tag}</span> : null}
        {!inBom && (
          <span style={{ position: "absolute", top: 4, left: 4, fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 8px" }}>No longer in BOM</span>
        )}
      </div>

      {selected && (
        <div style={strip}>
          <span role="group" aria-label="Photo position" style={{ display: "inline-flex", gap: 3 }}>
            {ALIGNS.map(([al, l]) => (
              <button key={al} type="button" aria-pressed={img.align === al} style={{ ...BTN, background: img.align === al ? "#dfe6f4" : BTN.background }} onClick={() => patch({ align: al })}>
                {l}
              </button>
            ))}
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            Size
            <input
              type="range"
              aria-label="Photo size"
              min={PHOTO_WIDTH_MIN}
              max={PHOTO_WIDTH_MAX}
              step={1}
              value={img.width}
              onChange={(e) => patch({ width: clampPhotoWidth(Number(e.target.value)) })}
              style={{ width: 96 }}
            />
            <span style={{ fontFamily: "var(--font-mono)", minWidth: 32 }}>{img.width}%</span>
          </label>
          <AtomRemove editor={editor} getPos={getPos} title="Remove this photo" />
        </div>
      )}
      {selected && preview?.note && (
        <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 4, whiteSpace: "nowrap", fontSize: 10.5, color: "#8c919c", userSelect: "none" }}>{preview.note}</div>
      )}
    </NodeViewWrapper>
  );
}
