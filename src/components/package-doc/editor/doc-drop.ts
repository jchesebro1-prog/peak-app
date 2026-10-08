import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOC_NODE_MIME, parseDocNodePayload, type DocNodePayload } from "@/lib/package-doc/insert";

/**
 * Estimator Phase 5 — dropping a BOM row from the left pane into the
 * document. Only a drag carrying application/x-peak-docnode is handled: the
 * drop point (view.posAtCoords) goes to the handler registered for this
 * editor (setDocNodeDropHandler), which builds the nodes and inserts
 * them through the editor's commands (one undo step). Every other drop —
 * moving text, a product block, a chip — is left to ProseMirror.
 */

export type DocNodeDropHandler = (payload: DocNodePayload, pos: number) => void;

/** Keyed by the editor (its view may not be mounted yet when the handler is set). */
const HANDLERS = new WeakMap<Editor, DocNodeDropHandler>();

/** Register (or, with null, clear) the drop handler for one editor. */
export function setDocNodeDropHandler(editor: Editor, fn: DocNodeDropHandler | null): void {
  if (fn) HANDLERS.set(editor, fn);
  else HANDLERS.delete(editor);
}

export const DocNodeDrop = Extension.create({
  name: "docNodeDrop",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("docNodeDrop"),
        props: {
          handleDrop(view, event) {
            const dt = (event as DragEvent).dataTransfer;
            if (!dt || !Array.from(dt.types || []).includes(DOC_NODE_MIME)) return false;
            const payload = parseDocNodePayload(dt.getData(DOC_NODE_MIME));
            const onDrop = HANDLERS.get(editor);
            if (!payload || !onDrop) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            onDrop(payload, at ? at.pos : view.state.doc.content.size);
            return true;
          },
        },
      }),
    ];
  },
});
