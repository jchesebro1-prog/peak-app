"use client";

import { useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { SystemTotal } from "@/components/package-doc/package-doc-view";
import { findSection } from "@/lib/package-doc/chips";
import { systemTotalOf } from "@/lib/package-doc/resolve";
import { AtomRemove } from "./atom-remove";
import { usePackageDocEnv } from "./editor-context";

/**
 * A system's live price line — the same row the PDF prints (SystemTotal),
 * tagged `System price · live`. A system that left the BOM reads amber
 * `removed` (it prints nothing; the Gaps list names it); one that exists but
 * doesn't print in the body (zero revenue / hidden) reads muted "Not printed". Draggable; Remove
 * deletes it.
 */
export default function SystemTotalView({ node, selected, editor, getPos }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  const [hover, setHover] = useState(false);
  const row = env ? systemTotalOf(node.attrs.sectionId, env.ctx) : null;
  // Missing system = amber `removed`; a system that exists but doesn't print in the body = a muted note.
  const exists = env ? !!findSection(env.ctx.sections, typeof node.attrs.sectionId === "string" ? node.attrs.sectionId : "") : false;
  const unprinted = !!env && !row && exists;
  return (
    <NodeViewWrapper
      className="pd-ed-atom"
      contentEditable={false}
      data-drag-handle=""
      data-removed={env && !row && !exists ? "true" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative", margin: "4px 0", borderRadius: 6, outline: selected ? "2px solid #6b8fd1" : "1px dashed transparent", outlineOffset: 4, cursor: "grab" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8c919c", letterSpacing: ".04em", textTransform: "uppercase" }}>System price · live</span>
        {env && !row && !exists && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 8px" }}>removed</span>}
        {(hover || selected) && (
          <span style={{ marginLeft: "auto" }}>
            <AtomRemove editor={editor} getPos={getPos} title="Remove this system price line" />
          </span>
        )}
      </div>
      {row ? <SystemTotal b={row} /> : null}
      {unprinted && <div style={{ fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 }}>{"Not printed — this system doesn't print in the body"}</div>}
    </NodeViewWrapper>
  );
}
