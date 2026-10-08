"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ResolvedPackageDocView } from "@/components/package-doc/package-doc-view";
import { priceTableOf } from "@/lib/package-doc/resolve";
import { usePackageDocEnv } from "./editor-context";

/** The live price table, drawn by the same renderer the PDF uses. */
export default function PriceTableView({ selected }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  return (
    <NodeViewWrapper
      className="pd-ed-atom"
      contentEditable={false}
      data-drag-handle=""
      style={{ position: "relative", margin: "10px 0", borderRadius: 6, outline: selected ? "2px solid #6b8fd1" : "1px dashed #d5d8de", outlineOffset: 4, cursor: "grab" }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "#8c919c", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 2 }}>Price table · live</div>
      {env ? <ResolvedPackageDocView resolved={{ blocks: [priceTableOf(env.ctx)] }} /> : null}
    </NodeViewWrapper>
  );
}
