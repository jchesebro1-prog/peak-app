"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { CHIP_LABEL, resolveChip } from "@/lib/package-doc/chips";
import { isChipKind } from "@/lib/package-doc/schema";
import { usePackageDocEnv } from "./editor-context";

/** A live number/name in the text: the CURRENT value (resolveChip), never
 *  typed over; a chip whose system/line is gone reads amber `removed`. */
export default function ChipView({ node, selected }: ReactNodeViewProps) {
  const env = usePackageDocEnv();
  const kind = isChipKind(node.attrs.kind) ? node.attrs.kind : null;
  const value = kind && env ? resolveChip({ kind, ref: String(node.attrs.ref ?? "") }, { sections: env.ctx.sections, t: env.ctx.t, quoteId: env.ctx.quoteId, totalLabel: env.ctx.totalLabel }) : null;
  const removed = value === null;
  return (
    <NodeViewWrapper
      as="span"
      className="pd-ed-chip"
      data-removed={removed ? "true" : undefined}
      title={kind ? `${CHIP_LABEL[kind]} — live` : "Live value"}
      style={{
        display: "inline-block",
        padding: "0 5px",
        margin: "0 1px",
        borderRadius: 4,
        lineHeight: 1.35,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: removed ? "#fbf3dd" : "#eef3fb",
        color: removed ? "#8a6d1f" : "#1f3f73",
        outline: selected ? "2px solid #6b8fd1" : "none",
        cursor: "grab",
      }}
    >
      {removed ? "removed" : value || "—"}
    </NodeViewWrapper>
  );
}
