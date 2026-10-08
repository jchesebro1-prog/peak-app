"use client";

import { useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { AtomRemove } from "./atom-remove";

/** A page break: a dashed rule on screen; a real page break in the PDF. Remove deletes it. */
export default function PageBreakView({ selected, editor, getPos }: ReactNodeViewProps) {
  const [hover, setHover] = useState(false);
  return (
    <NodeViewWrapper
      className="pd-ed-atom"
      contentEditable={false}
      data-drag-handle=""
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0", cursor: "grab", outline: selected ? "2px solid #6b8fd1" : "none", outlineOffset: 3, borderRadius: 4 }}
    >
      <span style={{ flex: 1, borderTop: "1px dashed #b9bec8" }} />
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8c919c", letterSpacing: ".04em", textTransform: "uppercase" }}>Page break</span>
      <span style={{ flex: 1, borderTop: "1px dashed #b9bec8" }} />
      {(hover || selected) && <AtomRemove editor={editor} getPos={getPos} title="Remove the page break" />}
    </NodeViewWrapper>
  );
}
