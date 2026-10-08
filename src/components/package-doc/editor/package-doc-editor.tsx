"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { ParagraphSaveResponse } from "@/app/(app)/estimator/narrative";
import type { KeyProductLibrary } from "@/app/(app)/estimator/use-key-product-library";
import type { PackageDocCtx } from "@/lib/package-doc/resolve";
import type { PackageDoc } from "@/lib/package-doc/types";
import { docNodesFor, payloadLibrarySku, type DocNodePayload, type PackageDocApi } from "@/lib/package-doc/insert";
import { DocNodeDrop, setDocNodeDropHandler } from "./doc-drop";
import { appendBlocks, findProductBlock, insertBlock, insertBlocksAt } from "./editor-commands";
import { PackageDocEditorContext, type PackageDocEditorEnv } from "./editor-context";
import { docSizeState, toEditorContent, type DocSizeState } from "./editor-model";
import { editorExtensions } from "./extensions";
import DocToolbar from "./toolbar";

/**
 * Estimator Phase 5 — the Build package document editor (TipTap, MIT core
 * only). Client-only: package-step.tsx loads it through next/dynamic with
 * `ssr: false`, so TipTap never reaches a server render or another page's
 * bundle.
 *
 * Value sync:
 *  - out: every edit (re)starts a CHANGE_DEBOUNCE_MS timer; when it fires (or
 *    the editor blurs, or this unmounts) the editor JSON goes through
 *    sanitizePackageDoc (docSizeState) and, when it differs from what the
 *    editor last stood for, onChange(doc). A document over the caps is NEVER
 *    emitted — the warning bar says so — so a cut copy can't replace the
 *    stored one; onOverChange(true) tells the estimator, whose Save then
 *    refuses ("The document is too large to save — shorten it.") instead of
 *    storing the last valid copy and saying "Saved ✓".
 *  - unmount: emits what's pending, unless `discardRef` is set (Remove
 *    document unmounts the editor — its flush must not bring the document
 *    back). An over flag is kept (Save keeps refusing) together with the
 *    over-the-caps draft, which the editor restores on the next mount.
 *  - in: a `value` the editor didn't emit (Remove / Start / an outside
 *    change) re-sets the content without an update event, keeping the cursor
 *    where the new document still has room for it.
 */

export const CHANGE_DEBOUNCE_MS = 300;

export type PackageDocEditorProps = {
  value: PackageDoc;
  onChange: (doc: PackageDoc) => void;
  /** true while the editor holds more than the caps allow (nothing emitted);
   *  `draft` is that over-the-caps content, kept by the estimator so a step
   *  change and return gives it back. */
  onOverChange?: (over: boolean, draft?: unknown) => void;
  /** The over-the-caps content the estimator kept from a previous mount. */
  overDraft?: unknown;
  /** Set by Remove document: skip the unmount flush. */
  discardRef?: RefObject<boolean>;
  ctx: PackageDocCtx;
  library: KeyProductLibrary;
  canWriteLibrary: boolean;
  onSaveToProduct: (sku: string, text: string, expectUpdatedAt: number | null) => Promise<ParagraphSaveResponse>;
  /** The left pane's insert API once the editor exists (null when it goes away). */
  onReady?: (api: PackageDocApi | null) => void;
};

const PROSE_CSS = `
.pd-ed-page { background: #fff; width: 100%; max-width: 8.5in; margin: 22px auto 40px; padding: 0.7in 0.75in; box-shadow: 0 1px 3px rgba(16,24,40,.08), 0 8px 24px rgba(16,24,40,.06); border-radius: 2px; font-size: 12.5px; line-height: 1.55; color: #3a3f4a; }
@media (max-width: 720px) { .pd-ed-page { padding: 24px 18px; margin: 12px auto 24px; } }
.pd-ed-prose { outline: none; min-height: 8in; }
.pd-ed-prose p { margin: 0 0 8px; }
.pd-ed-prose h1 { font-size: 1.32em; font-weight: 700; color: #16181d; margin: 18px 0 8px; line-height: 1.25; }
.pd-ed-prose h2 { font-size: 1.14em; font-weight: 700; color: #16181d; margin: 16px 0 6px; line-height: 1.3; }
.pd-ed-prose h3 { font-size: 1em; font-weight: 700; color: #16181d; margin: 12px 0 4px; line-height: 1.35; }
.pd-ed-prose ul { list-style: disc; padding-left: 20px; margin: 0 0 8px; }
.pd-ed-prose ol { list-style: decimal; padding-left: 20px; margin: 0 0 8px; }
.pd-ed-prose li > p { margin: 0; }
.pd-ed-prose strong { font-weight: 700; color: #16181d; }
.pd-ed-prose .pd-ed-product-text p:last-child { margin-bottom: 0; }
.pd-ed-prose .ProseMirror-selectednode { outline: 2px solid #6b8fd1; }
`;

const EDITOR_PROPS = { attributes: { class: "pd-ed-prose", role: "textbox", "aria-multiline": "true", "aria-label": "Client document" } };

export default function PackageDocEditor({ value, onChange, onOverChange, overDraft, discardRef, ctx, library, canWriteLibrary, onSaveToProduct, onReady }: PackageDocEditorProps) {
  /* + DocNodeDrop: a BOM row dropped from the left pane (handler registered below). */
  const extensions = useMemo(() => [...editorExtensions(), DocNodeDrop], []);
  const onChangeRef = useRef(onChange);
  const onOverRef = useRef(onOverChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onOverRef.current = onOverChange;
  }, [onChange, onOverChange]);
  /** JSON of the stored document the editor currently stands for ("" until the editor exists). */
  const knownRef = useRef("");
  /** The latest editor JSON not yet emitted. */
  const pendingRef = useRef<JSONContent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState<DocSizeState | null>(null);
  /** The over-the-caps draft the editor starts from (fixed at mount). */
  const [initialDraft] = useState<JSONContent | null>(() => (overDraft && typeof overDraft === "object" ? (overDraft as JSONContent) : null));
  const draftShownRef = useRef(false);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const raw = pendingRef.current;
    if (!raw) return;
    pendingRef.current = null;
    const st = docSizeState(raw);
    setSize(st.level === "ok" ? null : st);
    onOverRef.current?.(st.level === "over", st.level === "over" ? raw : null);
    // Over the caps: never emit — a cut document must not replace the stored one.
    if (!st.doc) return;
    const str = JSON.stringify(st.doc);
    if (str === knownRef.current) return;
    knownRef.current = str;
    onChangeRef.current(st.doc);
  }, []);

  const editor = useEditor({
    extensions,
    content: initialDraft ?? toEditorContent(value),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: EDITOR_PROPS,
    onUpdate: ({ editor: ed }) => {
      pendingRef.current = ed.getJSON();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, CHANGE_DEBOUNCE_MS);
    },
    onBlur: () => flush(),
  });

  // Unmount (step change…): emit what's pending — never after Remove document.
  // The over flag is NOT cleared here: Save keeps refusing until the user
  // returns (the draft comes back) and shortens the document.
  useEffect(
    () => () => {
      if (discardRef?.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingRef.current = null;
      } else flush();
    },
    [flush, discardRef]
  );

  // Back on the step with an over-the-caps draft: re-show the warning bar.
  useEffect(() => {
    if (!editor || !initialDraft || draftShownRef.current) return;
    draftShownRef.current = true;
    pendingRef.current = initialDraft;
    flush();
  }, [editor, flush, initialDraft]);

  // Outside changes to `value` (not our own echo) re-set the content.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const str = JSON.stringify(value);
    if (!knownRef.current) {
      knownRef.current = str; // the editor was created from this value
      return;
    }
    if (str === knownRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    knownRef.current = str;
    const { from, to } = editor.state.selection;
    editor
      .chain()
      .setContent(toEditorContent(value), { emitUpdate: false })
      .command(({ tr }) => {
        const max = tr.doc.content.size;
        try {
          tr.setSelection(TextSelection.between(tr.doc.resolve(Math.min(from, max)), tr.doc.resolve(Math.min(to, max))));
        } catch {
          // the old cursor has no place in the new document — leave it at the start
        }
        return true;
      })
      .run();
    setSize(null);
    onOverRef.current?.(false);
  }, [editor, value]);

  /* The left pane's insert API: BOM rows (dropped or + inserted), Library
     items, Gaps actions. Nodes come from the pure builders in
     lib/package-doc/insert.ts; every insert is one editor command. */
  const sectionsRef = useRef(ctx.sections);
  const libraryRef = useRef(library);
  useEffect(() => {
    sectionsRef.current = ctx.sections;
    libraryRef.current = library;
  }, [ctx.sections, library]);
  useEffect(() => {
    if (!editor) return;
    const build = async (p: DocNodePayload) => {
      const sku = payloadLibrarySku(p, sectionsRef.current);
      let rows = libraryRef.current.rows;
      if (sku && !Object.hasOwn(rows, sku)) rows = await libraryRef.current.ensure([sku]);
      return docNodesFor(p, sectionsRef.current, (k) => (Object.hasOwn(rows, k) ? rows[k].paragraph : null));
    };
    const live = () => !editor.isDestroyed;
    setDocNodeDropHandler(editor, (p, pos) => {
      void build(p).then((nodes) => {
        if (nodes && live()) insertBlocksAt(editor, pos, nodes);
      });
    });
    const insertBlocks: PackageDocApi["insertBlocks"] = (nodes, where = "cursor") => {
      if (!live() || !nodes.length) return false;
      return where === "end" ? appendBlocks(editor, nodes) : insertBlock(editor, nodes);
    };
    const api: PackageDocApi = {
      insertBlocks,
      insertDocNode: async (p, where = "cursor") => {
        const nodes = await build(p);
        return !!nodes && insertBlocks(nodes, where);
      },
      scrollToProduct: (t) => {
        if (!live()) return false;
        const pos = findProductBlock(editor.state.doc, t);
        if (pos < 0) return false;
        editor.chain().focus().setTextSelection(pos + 2).run();
        const dom = editor.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      },
      flush,
    };
    onReady?.(api);
    return () => {
      setDocNodeDropHandler(editor, null);
      onReady?.(null);
    };
  }, [editor, onReady, flush]);

  const env = useMemo<PackageDocEditorEnv>(() => ({ ctx, library, canWriteLibrary, onSaveToProduct }), [ctx, library, canWriteLibrary, onSaveToProduct]);

  return (
    <PackageDocEditorContext.Provider value={env}>
      <style>{PROSE_CSS}</style>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        {editor ? <DocToolbar editor={editor} /> : null}
        {size && size.level !== "ok" && (
          <div
            role="status"
            style={{
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: size.level === "over" ? "#b4543a" : "#8a6d1f",
              background: size.level === "over" ? "#fbecea" : "#fbf3dd",
              borderBottom: "1px solid #ececf0",
            }}
          >
            {size.message}
          </div>
        )}
        <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#f3f4f6", padding: "0 16px" }}>
          <div className="pd-ed-page">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </PackageDocEditorContext.Provider>
  );
}
