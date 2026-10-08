"use client";

import type { CSSProperties } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { clampPhotoWidth, PHOTO_WIDTH_MAX, PHOTO_WIDTH_MIN } from "@/lib/package-doc/schema";
import type { PhotoAlign, PhotoAttrs } from "@/lib/package-doc/types";
import { activePhotoTarget, insertBlock, setBlockPhoto, setImageAttrs, type PhotoTarget } from "./editor-commands";

/**
 * Estimator Phase 5 — the document toolbar: Normal / Heading 1–3, Bold,
 * Italic, Bullet list, Numbered list, Page break, + Price table; with a
 * product image selected (#312): photo Left / Right / Full and size
 * (25–100 %); with the cursor in an older product block that still shows
 * its own photo: the same plus Hide photo. A block whose photo is hidden
 * (every block made since #312) shows no photo controls.
 */

const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  padding: "4px 9px",
  cursor: "pointer",
  minWidth: 30,
};
const on = (b: boolean): CSSProperties => (b ? { ...BTN, background: "#e8eef9", borderColor: "#b9c8e6", color: "#1f3f73" } : BTN);
const SEP: CSSProperties = { width: 1, alignSelf: "stretch", background: "#e4e7ec", margin: "0 4px" };
const ALIGNS: Array<[PhotoAlign, string]> = [["left", "Left"], ["right", "Right"], ["full", "Full"]];

type Snap = {
  style: "p" | "1" | "2" | "3";
  bold: boolean;
  italic: boolean;
  bullet: boolean;
  ordered: boolean;
  photo: PhotoTarget | null;
};

export default function DocToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState<Snap>({
    editor,
    selector: ({ editor: e }) => {
      return {
        style: e.isActive("heading", { level: 1 }) ? "1" : e.isActive("heading", { level: 2 }) ? "2" : e.isActive("heading", { level: 3 }) ? "3" : "p",
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        photo: activePhotoTarget(e.state),
      };
    },
  });

  const setStyle = (v: string) => {
    const c = editor.chain().focus();
    if (v === "1" || v === "2" || v === "3") c.setHeading({ level: Number(v) as 1 | 2 | 3 }).run();
    else c.setParagraph().run();
  };
  const t = s.photo;
  const photo = (patch: Partial<PhotoAttrs>) => {
    if (!t) return;
    if (t.kind === "image") setImageAttrs(editor, t.pos, { ...(patch.align ? { align: patch.align } : {}), ...(patch.width !== undefined ? { width: patch.width } : {}) });
    else setBlockPhoto(editor, t.pos, patch);
  };

  return (
    <div role="toolbar" aria-label="Document formatting" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, padding: "8px 12px", background: "#fafbfc", borderBottom: "1px solid #ececf0" }}>
      <select
        aria-label="Text style"
        value={s.style}
        onChange={(e) => setStyle(e.target.value)}
        style={{ ...BTN, padding: "4px 6px", fontWeight: 500 }}
      >
        <option value="p">Normal</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <span style={SEP} />
      <button type="button" aria-label="Bold" aria-pressed={s.bold} title="Bold" style={{ ...on(s.bold), fontWeight: 800 }} onClick={() => editor.chain().focus().toggleBold().run()}>
        B
      </button>
      <button type="button" aria-label="Italic" aria-pressed={s.italic} title="Italic" style={{ ...on(s.italic), fontStyle: "italic" }} onClick={() => editor.chain().focus().toggleItalic().run()}>
        I
      </button>
      <span style={SEP} />
      <button type="button" aria-pressed={s.bullet} style={on(s.bullet)} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        Bullet list
      </button>
      <button type="button" aria-pressed={s.ordered} style={on(s.ordered)} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        Numbered list
      </button>
      <span style={SEP} />
      <button type="button" style={BTN} onClick={() => insertBlock(editor, { type: "pageBreak" })}>
        Page break
      </button>
      <button type="button" style={BTN} onClick={() => insertBlock(editor, { type: "priceTable" })}>
        + Price table
      </button>
      {t && (
        <>
          <span style={SEP} />
          <span style={{ fontSize: 11.5, color: "#5b616e", fontWeight: 600 }}>Photo</span>
          {ALIGNS.map(([a, l]) => (
            <button key={a} type="button" aria-pressed={t.align === a} style={on(t.align === a)} onClick={() => photo({ align: a })}>
              {l}
            </button>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5b616e" }}>
            Size
            <input
              type="range"
              aria-label="Photo size"
              min={PHOTO_WIDTH_MIN}
              max={PHOTO_WIDTH_MAX}
              step={1}
              value={t.width}
              onChange={(e) => photo({ width: clampPhotoWidth(Number(e.target.value)) })}
              style={{ width: 100 }}
            />
            <span style={{ fontFamily: "var(--font-mono)", minWidth: 32 }}>{t.width}%</span>
          </label>
          {t.kind === "block" && (
            <button type="button" style={BTN} onClick={() => photo({ show: false })}>
              Hide photo
            </button>
          )}
        </>
      )}
    </div>
  );
}
