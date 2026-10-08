import type { Editor, JSONContent } from "@tiptap/react";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import { textToParagraphs } from "@/lib/package-doc/text";
import type { PhotoAttrs } from "@/lib/package-doc/types";
import { withPhoto } from "./editor-model";

/**
 * Estimator Phase 5 — editor commands shared by the toolbar and the node
 * views. Every change is one transaction, so undo reverts it in one step.
 */

/** The product block the selection is on or inside, with its position. */
export function activeProductBlock(state: EditorState): { pos: number; node: PMNode } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "productBlock") return { pos: sel.from, node: sel.node };
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "productBlock") return { pos: $from.before(d), node: n };
  }
  return null;
}

/** Patch a product block's photo (clamped like the validator). */
export function setBlockPhoto(editor: Editor, pos: number, patch: Partial<PhotoAttrs>): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "productBlock") return false;
  const photo = withPhoto(node.attrs.photo as Partial<PhotoAttrs>, patch);
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, photo });
      return true;
    })
    .run();
}

/** Revert: the block's words become the library paragraph (paragraphs as the
 *  seed makes them, so the tag reads "from product" again). */
export function revertProductBlock(editor: Editor, pos: number, text: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "productBlock") return false;
  const schema = editor.state.schema;
  const paras = textToParagraphs(text).map((p) => schema.nodeFromJSON(p));
  return editor
    .chain()
    .command(({ tr }) => {
      tr.replaceWith(pos + 1, pos + node.nodeSize - 1, Fragment.fromArray(paras));
      return true;
    })
    .run();
}

/** Delete one node (a product block's Remove). */
export function deleteNodeAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize);
      return true;
    })
    .run();
}

/** Insert a block (price table, page break…) at the cursor. Inside a plain
 *  paragraph/heading it lands at the cursor; inside a list or a product
 *  block (which can't hold it) it lands after that top-level block, never
 *  splitting it. */
export function insertBlock(editor: Editor, json: JSONContent | JSONContent[]): boolean {
  const sel = editor.state.selection;
  // A selected node (a price table, a chip…) is never replaced: insert after it.
  if (sel instanceof NodeSelection) return editor.chain().focus().insertContentAt(sel.to, json).run();
  const { $from } = sel;
  const top = $from.depth >= 1 ? $from.node(1) : null;
  if (!top || top.type.name === "paragraph" || top.type.name === "heading") return editor.chain().focus().insertContent(json).run();
  const at = $from.after(1);
  return editor.chain().focus().insertContentAt(at, json).run();
}

/** Insert blocks where a drag was dropped: ProseMirror's own dropPoint moves
 *  the position to the nearest place the blocks fit (out of a paragraph, a
 *  list or a product block — never splitting one). One command → one undo step. */
export function insertBlocksAt(editor: Editor, pos: number, json: JSONContent[]): boolean {
  const at = dropInsertPos(editor.state.doc, pos, json);
  return at !== null && editor.chain().focus().insertContentAt(at, json).run();
}

/** Where dropped blocks go: the nearest position (dropPoint) where they fit,
 *  or null when they aren't valid schema. Pure (ProseMirror only). */
export function dropInsertPos(doc: PMNode, pos: number, json: JSONContent[]): number | null {
  const at = Math.max(0, Math.min(pos, doc.content.size));
  try {
    const slice = new Slice(Fragment.fromArray(json.map((j) => doc.type.schema.nodeFromJSON(j))), 0, 0);
    return dropPoint(doc, at, slice) ?? at;
  } catch {
    return null;
  }
}

/** Append blocks at the end of the document (the Gaps list's "isn't in the document"). */
export function appendBlocks(editor: Editor, json: JSONContent[]): boolean {
  return editor.chain().focus().insertContentAt(editor.state.doc.content.size, json).scrollIntoView().run();
}

/** The first product block on this system + line (and sku, when given). */
export function findProductBlock(doc: PMNode, t: { sectionId: string; lineKey: string; sku?: string }): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.type.name !== "productBlock") return true;
    if (n.attrs.sectionId === t.sectionId && n.attrs.lineKey === t.lineKey && (!t.sku || n.attrs.sku === t.sku)) found = pos;
    return false;
  });
  return found;
}
