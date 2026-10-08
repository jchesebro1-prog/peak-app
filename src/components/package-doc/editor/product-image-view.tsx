"use client";

import { useState, type CSSProperties } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { lineAnchorInBom } from "@/lib/package-doc/gaps";
import { clampPhotoWidth, PHOTO_WIDTH_MAX, PHOTO_WIDTH_MIN } from "@/lib/package-doc/schema";
import type { LineAnchor, PhotoAlign } from "@/lib/package-doc/types";
import { AtomRemove } from "./atom-remove";
import { usePackageDocEnv } from "./editor-context";
import { setImageAttrs } from "./editor-commands";
import { isLineTokenSku, linePhotoPreview, withImage, type ImageAttrs } from "./editor-model";

/**
 * Estimator #312 — a product's photo as its own piece (productImage): just
 * the image, no label. Floated left / right at `width` % of the column (or
 * full width, centred) exactly like the print, so the paragraphs after it
 * wrap beside it here too. Same photo source as an older product block's
 * preview (linePhotoPreview: own photo → kind placeholder → manufacturer
 * image). Drag the image to move it anywhere in the document. Selected: a
 * small strip with Left / Right / Full, Size and Remove. Amber outline +
 * `No longer in BOM` while its line is gone (it still prints). With no photo
 * it shows a `No photo for this part` box — in the editor only; it prints
 * nothing.
 */

const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 5, padding: "3px 7px", cursor: "pointer" };
const ALIGNS: Array<[PhotoAlign, string]> = [["left", "Left"], ["right", "Right"], ["full", "Full"]];
const AMBER = "#d9a63a";

/** Where the image sits: the print's float (package-doc-view photoStyle), on the wrapper. */
function wrapperStyle(img: ImageAttrs): CSSProperties {
  if (img.align === "full") return { display: "block", width: `${img.width}%`, margin: "4px auto 10px" };
  if (img.align === "left") return { float: "left", width: `${img.width}%`, margin: "4px 14px 8px 0" };
  return { float: "right", width: `${img.width}%`, margin: "4px 0 8px 14px" };
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
  const inBom = !env || lineAnchorInBom(a, sections);
  const name = (row && row.desc) || a.sku || "Product";

  const patch = (p: Partial<ImageAttrs>) => {
    const at = getPos();
    if (typeof at === "number") setImageAttrs(editor, at, p);
  };

  const strip: CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    ...(img.align === "right" ? { right: 0 } : img.align === "left" ? { left: 0 } : { left: "50%", transform: "translateX(-50%)" }),
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
        position: "relative",
        ...wrapperStyle(img),
        borderRadius: 4,
        outline: selected ? "2px solid #6b8fd1" : !inBom ? `2px solid ${AMBER}` : hover ? "1.5px dashed #b9bec8" : "1.5px dashed transparent",
        outlineOffset: 3,
      }}
    >
      <div data-drag-handle="" title={`${name} — drag to move`} style={{ position: "relative", cursor: "grab" }}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.src}
            alt=""
            draggable={false}
            style={{ display: "block", width: "100%", maxHeight: img.align === "full" ? "4in" : "2.4in", objectFit: "contain" }}
          />
        ) : (
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 84, padding: 8, border: "1.5px dashed #cfd3da", borderRadius: 6, background: "#fafbfc", fontSize: 11, color: "#8c919c", textAlign: "center" }}
          >
            No photo for this part
          </div>
        )}
        {!inBom && (
          <span style={{ position: "absolute", top: 4, left: 4, fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 8px" }}>No longer in BOM</span>
        )}
      </div>

      {selected && (
        <div style={strip} onDragStart={(e) => e.preventDefault()}>
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
