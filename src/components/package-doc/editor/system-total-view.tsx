"use client";

import { useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { SystemTotal } from "@/components/package-doc/package-doc-view";
import { systemTotalOf } from "@/lib/package-doc/resolve";
import { AtomRemove } from "./atom-remove";
import { usePackageDocEnv } from "./editor-context";

/**
 * A system's live price line — the same row the PDF prints (SystemTotal),
 * tagged `System price · live`. A system that left the BOM reads amber
 * `removed` (it prints nothing; the Gaps list names it). Draggable; Remove
 * deletes it.
 */
export default function SystemTotalView({ node, selected, editor, getPos }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  const [hover, setHover] = useState(false);
  const row = env ? systemTotalOf(node.attrs.sectionId, env.ctx) : null;
  return (
    <NodeViewWrapper
      className="pd-ed-atom"
      contentEditable={false}
      data-drag-handle=""
      data-removed={env && !row ? "true" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative", margin: "4px 0", borderRadius: 6, outline: selected ? "2px solid #6b8fd1" : "1px dashed transparent", outlineOffset: 4, cursor: "grab" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8c919c", letterSpacing: ".04em", textTransform: "uppercase" }}>System price · live</span>
        {env && !row && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 8px" }}>removed</span>}
        {(hover || selected) && (
          <span style={{ marginLeft: "auto" }}>
            <AtomRemove editor={editor} getPos={getPos} title="Remove this system price line" />
          </span>
        )}
      </div>
      {row ? <SystemTotal b={row} /> : null}
    </NodeViewWrapper>
  );
}
