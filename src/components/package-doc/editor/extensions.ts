"use client";

import { ReactNodeViewRenderer, type AnyExtension } from "@tiptap/react";
import ChipView from "./chip-view";
import PageBreakView from "./page-break-view";
import PriceTableView from "./price-table-view";
import ProductBlockView from "./product-block-view";
import SystemTotalView from "./system-total-view";
import { buildExtensions } from "./schema-nodes";

/**
 * Estimator Phase 5 — the editor's extensions: schema-nodes.ts's ONE list
 * (StarterKit cut to the package-document schema + chip / productBlock /
 * priceTable / pageBreak / systemTotal) with the React node views attached. The harness
 * checks buildExtensions()'s schema against src/lib/package-doc/schema.ts.
 */
export function editorExtensions(): AnyExtension[] {
  return buildExtensions({
    chip: ReactNodeViewRenderer(ChipView, { as: "span" }),
    productBlock: ReactNodeViewRenderer(ProductBlockView),
    priceTable: ReactNodeViewRenderer(PriceTableView),
    pageBreak: ReactNodeViewRenderer(PageBreakView),
    systemTotal: ReactNodeViewRenderer(SystemTotalView),
  });
}
