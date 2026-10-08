"use client";

import { useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ResolvedPackageDocView } from "@/components/package-doc/package-doc-view";
import { priceTableOf } from "@/lib/package-doc/resolve";
import { AtomRemove } from "./atom-remove";
import { usePackageDocEnv } from "./editor-context";

/** The live price table, drawn by the same renderer the PDF uses. Remove deletes it. */
export default function PriceTableView({ selected, editor, getPos }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  const [hover, setHover] = useState(false);
  return (
    <NodeViewWrapper
      className="pd-ed-atom"
      contentEditable={false}
      data-drag-handle=""
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative", margin: "10px 0", borderRadius: 6, outline: selected ? "2px solid #6b8fd1" : "1px dashed #d5d8de", outlineOffset: 4, cursor: "grab" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8c919c", letterSpacing: ".04em", textTransform: "uppercase" }}>Price table · live</span>
        {(hover || selected) && (
          <span style={{ marginLeft: "auto" }}>
            <AtomRemove editor={editor} getPos={getPos} title="Remove the price table" />
          </span>
        )}
      </div>
      {env ? <ResolvedPackageDocView resolved={{ blocks: [priceTableOf(env.ctx)] }} /> : null}
    </NodeViewWrapper>
  );
}
