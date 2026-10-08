"use client";

import type { CSSProperties } from "react";
import type { Editor } from "@tiptap/react";
import { deleteNodeAt } from "./editor-commands";

/**
 * Estimator #312 — the `Remove` button on a block atom (price table, page
 * break, system price line, …): shown while the atom is hovered or selected,
 * deletes exactly that node in one transaction (one undo step). The wrapper
 * is contentEditable=false, so the button never lands in the text.
 */

const REMOVE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#b4543a",
  background: "#f1f2f5",
  border: "none",
  borderRadius: 5,
  padding: "3px 7px",
  cursor: "pointer",
  flexShrink: 0,
};

export function AtomRemove({ editor, getPos, title }: { editor: Editor; getPos: () => number | undefined; title: string }) {
  return (
    <button
      type="button"
      style={REMOVE}
      title={title}
      onClick={() => {
        const p = getPos();
        if (typeof p === "number") deleteNodeAt(editor, p);
      }}
    >
      Remove
    </button>
  );
}
