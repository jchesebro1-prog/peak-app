"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { productBlockInBom } from "@/lib/package-doc/gaps";
import { clampPhotoWidth, PHOTO_WIDTH_MAX, PHOTO_WIDTH_MIN } from "@/lib/package-doc/schema";
import { productBlockText } from "@/lib/package-doc/text";
import type { PDProductBlock, PhotoAlign, PhotoAttrs } from "@/lib/package-doc/types";
import { usePackageDocEnv } from "./editor-context";
import { deleteNodeAt, revertProductBlock, setBlockPhoto } from "./editor-commands";
import { customLineTagText, isLineTokenSku, productBlockLabel, productPhotoPreview, productTagState, productTagText, SAVED_TO_PRODUCT_MS, withPhoto } from "./editor-model";

/**
 * Estimator Phase 5 — a product-linked block: one BOM line's paragraph(s).
 * Dashed outline while hovered or holding the cursor; a tag
 * `<label> · from product` / `<label> · edited here` (a custom / allowance
 * line: `<label> · custom line`, no Save or Revert); Save to product
 * (create permission, stale-checked against the library row's stamp) and
 * Revert (the library paragraph); amber `No longer in BOM` while its line is
 * gone (kept until deleted); the photo preview with Left / Right / Full, size
 * and Show / Hide photo when selected.
 */

const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 5, padding: "3px 7px", cursor: "pointer" };
const ASK: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11.5, color: "#3a3f4a", background: "#fbf3dd", borderRadius: 6, padding: "5px 8px", marginBottom: 6 };
const FAILED = "Could not reach the server. Try again.";
const SAVED = "Saved to the product.";
const ALIGNS: Array<[PhotoAlign, string]> = [["left", "Left"], ["right", "Right"], ["full", "Full"]];

export default function ProductBlockView({ node, editor, getPos, selected, selectionInside }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  const [hover, setHover] = useState(false);
  const [ask, setAsk] = useState<null | "replace" | "stale">(null);
  const [stale, setStale] = useState<{ paragraph: string | null; updatedAt: number | null } | null>(null);
  const [msg, setMsg] = useState("");
  /** The words "Saved to the product." refers to — it shows only while the
   *  block still holds them, and for SAVED_TO_PRODUCT_MS. */
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, start] = useTransition();

  const block = node.toJSON() as PDProductBlock;
  const sku = String(node.attrs.sku || "");
  const photo = withPhoto(node.attrs.photo as Partial<PhotoAttrs>, {});
  const sections = env?.ctx.sections ?? [];
  const isLine = isLineTokenSku(sku);
  const rows = env?.library.rows;
  const row = !isLine && sku && rows && Object.hasOwn(rows, sku) ? rows[sku] : undefined;
  /** A line token, or a sku the catalog doesn't have: no library paragraph, so no Save / Revert. */
  const isCustom = isLine || (!!row && !row.inCatalog);
  const text = productBlockText(block);
  const libraryText = isLine || !sku ? null : row ? row.paragraph : undefined;
  const state = productTagState(text, libraryText);
  const label = productBlockLabel(block, sections, row);
  const inBom = productBlockInBom(block, sections);
  const preview = productPhotoPreview(block, sections, row);
  const active = selected || !!selectionInside;
  const outlined = active || hover;
  const note = msg || (savedFor !== null && savedFor === text ? SAVED : "");

  const pos = () => {
    const p = getPos();
    return typeof p === "number" ? p : null;
  };
  const patchPhoto = (patch: Partial<PhotoAttrs>) => {
    const p = pos();
    if (p !== null) setBlockPhoto(editor, p, patch);
  };

  const canSave = !!env?.canWriteLibrary && !isLine && !!row?.inCatalog && !!text;
  const saveTitle = !env?.canWriteLibrary
    ? "Needs the Create permission"
    : isLine || (row && !row.inCatalog)
    ? "Only catalog parts have a library paragraph"
    : !text
    ? "Write the paragraph first"
    : "Save this paragraph to the part — future quotes start from it";

  /** Every server await is caught: a throw inside startTransition would reach the error boundary. */
  const doSave = (expect: number | null) =>
    start(async () => {
      if (!env) return;
      setMsg("");
      setSavedFor(null);
      try {
        const out = await env.onSaveToProduct(sku, text, expect);
        if (out.ok) {
          setAsk(null);
          setSavedFor(text);
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSavedFor(null), SAVED_TO_PRODUCT_MS);
        } else if (out.stale) {
          setStale(out.stale);
          setAsk("stale");
        } else {
          setAsk(null);
          setMsg(out.error);
        }
      } catch {
        setMsg(FAILED);
      }
    });
  const onSave = () => {
    if (row?.paragraph != null && state === "edited") setAsk("replace");
    else doSave(row?.paragraphUpdatedAt ?? null);
  };
  const onRevert = () => {
    const p = pos();
    if (p !== null && row?.paragraph != null) revertProductBlock(editor, p, row.paragraph);
  };
  const onRemove = () => {
    const p = pos();
    if (p !== null) deleteNodeAt(editor, p);
  };

  const imgStyle: CSSProperties =
    photo.align === "full"
      ? { display: "block", width: `${photo.width}%`, maxHeight: "4in", objectFit: "contain", margin: "0 auto 10px" }
      : photo.align === "left"
      ? { float: "left", width: `${photo.width}%`, maxHeight: "2.4in", objectFit: "contain", margin: "0 14px 8px 0" }
      : { float: "right", width: `${photo.width}%`, maxHeight: "2.4in", objectFit: "contain", margin: "0 0 8px 14px" };

  return (
    <NodeViewWrapper
      className="pd-ed-product"
      data-sku={sku}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flow-root",
        margin: "14px -10px",
        padding: "6px 10px 8px",
        borderRadius: 6,
        outline: outlined ? `1.5px dashed ${active ? "#6b8fd1" : "#b9bec8"}` : "1.5px dashed transparent",
        background: !inBom ? "#fffaf0" : undefined,
      }}
    >
      <div contentEditable={false} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 4, userSelect: "none" }}>
        <span data-drag-handle="" title="Drag to move" aria-hidden="true" style={{ cursor: "grab", color: "#aab0bb", fontSize: 12 }}>
          ⋮⋮
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: state === "from" ? "#1f7a52" : "#5b616e" }}>{isCustom ? customLineTagText(label) : productTagText(label, state)}</span>
        {!inBom && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 8px" }}>No longer in BOM</span>
        )}
        {(outlined || ask || note) && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
            {!isCustom && (
              <button type="button" style={{ ...BTN, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave || pending} title={saveTitle} onClick={onSave}>
                {pending ? "Saving…" : "Save to product"}
              </button>
            )}
            {state === "edited" && row?.paragraph != null && (
              <button type="button" style={BTN} title="Replace these words with the product's saved paragraph" onClick={onRevert}>
                Revert
              </button>
            )}
            {preview && (
              <button type="button" style={BTN} aria-pressed={photo.show} onClick={() => patchPhoto({ show: !photo.show })}>
                {photo.show ? "Hide photo" : "Show photo"}
              </button>
            )}
            <button type="button" style={{ ...BTN, color: "#b4543a" }} title="Remove this product block" onClick={onRemove}>
              Remove
            </button>
          </span>
        )}
      </div>

      {ask === "replace" && (
        <div contentEditable={false} style={ASK}>
          <span>Replace the product&apos;s saved paragraph for {sku}?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => doSave(row?.paragraphUpdatedAt ?? null)}>Replace</button>
          <button type="button" style={BTN} onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}
      {ask === "stale" && (
        <div contentEditable={false} style={ASK}>
          <span>The product&apos;s paragraph changed since you loaded it — replace it anyway?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => doSave(stale?.updatedAt ?? null)}>Replace anyway</button>
          <button type="button" style={BTN} onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}
      {note && (
        <div contentEditable={false} style={{ fontSize: 11, marginBottom: 4, color: note === SAVED ? "#1f7a52" : "#b4543a" }}>
          {note}
        </div>
      )}

      {active && preview && photo.show && (
        <div contentEditable={false} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11, color: "#5b616e", userSelect: "none" }}>
          <span role="group" aria-label="Photo position" style={{ display: "inline-flex", gap: 3 }}>
            {ALIGNS.map(([a, l]) => (
              <button key={a} type="button" aria-pressed={photo.align === a} style={{ ...BTN, background: photo.align === a ? "#dfe6f4" : BTN.background }} onClick={() => patchPhoto({ align: a })}>
                {l}
              </button>
            ))}
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            Size
            <input
              type="range"
              min={PHOTO_WIDTH_MIN}
              max={PHOTO_WIDTH_MAX}
              step={1}
              value={photo.width}
              onChange={(e) => patchPhoto({ width: clampPhotoWidth(Number(e.target.value)) })}
              style={{ width: 110 }}
            />
            <span style={{ fontFamily: "var(--font-mono)", minWidth: 32 }}>{photo.width}%</span>
          </label>
          {preview.note && <span style={{ color: "#8c919c" }}>{preview.note}</span>}
        </div>
      )}

      {preview && photo.show && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.src} alt="" contentEditable={false} draggable={false} style={imgStyle} />
      )}
      {preview && !photo.show && active && <div contentEditable={false} style={{ fontSize: 11, color: "#8c919c", marginBottom: 4 }}>Photo hidden</div>}
      {!preview && row && active && <div contentEditable={false} style={{ fontSize: 11, color: "#8c919c", marginBottom: 4 }}>No photo for this part</div>}

      <NodeViewContent className="pd-ed-product-text" />
    </NodeViewWrapper>
  );
}
