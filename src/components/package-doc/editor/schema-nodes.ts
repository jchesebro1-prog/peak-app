import { getSchema, mergeAttributes, Node, type AnyExtension, type Editor, type NodeViewRenderer } from "@tiptap/react";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { sinkListItem } from "@tiptap/pm/schema-list";
import { TextSelection, type Command, type Transaction } from "@tiptap/pm/state";
import StarterKit, { type StarterKitOptions } from "@tiptap/starter-kit";
import { CHIP_KINDS, clampPhotoWidth, DEFAULT_PHOTO, HEADING_LEVELS, isChipKind, isPhotoAlign } from "@/lib/package-doc/schema";
import type { PhotoAttrs } from "@/lib/package-doc/types";

/**
 * Estimator Phase 5 — the package document's TipTap schema, WITHOUT the React
 * node views (extensions.ts attaches those), so the harness can build the
 * real ProseMirror schema headless and check it against
 * src/lib/package-doc/schema.ts: the editor can never hold a node or mark the
 * server's validator would drop.
 *
 *  - StarterKit is cut down to exactly the schema: blockquote, code,
 *    codeBlock, strike, underline, link and horizontalRule are off; its own
 *    listItem is replaced by one whose content is `paragraph (bulletList |
 *    orderedList)*` (StarterKit's allows any block — a heading or a product
 *    block in a list item would be dropped on save); trailingNode is off so
 *    opening a document never appends a paragraph (that would mark the PDF
 *    stale just by looking). dropcursor / gapcursor / undoRedo / listKeymap
 *    stay — they are plugins, not nodes.
 *  - chip: inline atom { kind, ref }. productBlock: block, `paragraph+`,
 *    { sectionId, lineKey, sku, photo }. priceTable, pageBreak: block atoms.
 */

export const STARTER_KIT_OPTIONS: Partial<StarterKitOptions> = {
  blockquote: false,
  code: false,
  codeBlock: false,
  strike: false,
  underline: false,
  link: false,
  horizontalRule: false,
  listItem: false,
  trailingNode: false,
  heading: { levels: [...HEADING_LEVELS] },
};

/** Deepest list nesting the editor allows. The validator drops nodes deeper
 *  than MAX_DEPTH (12) — a 6th list level's paragraph sits at depth 13 — so
 *  Tab refuses to indent past this, and docSizeState calls a deeper (pasted)
 *  document "over". */
export const MAX_LIST_LEVELS = 5;

/** The deepest list-item nesting in a ProseMirror document (iterative). */
export function maxListLevel(doc: PMNode): number {
  let max = 0;
  const stack: [PMNode, number][] = [[doc, 0]];
  while (stack.length) {
    const [n, lv] = stack.pop()!;
    const here = n.type.name === "listItem" ? lv + 1 : lv;
    if (here > max) max = here;
    n.forEach((k) => stack.push([k, here]));
  }
  return max;
}

/** sinkListItem, refused when the result would nest lists deeper than
 *  MAX_LIST_LEVELS (the sunk item's own sub-lists count). */
export function sinkListItemCapped(itemType: NodeType): Command {
  return (state, dispatch) => {
    let out = null as Transaction | null;
    if (!sinkListItem(itemType)(state, (tr) => (out = tr))) return false;
    if (!out || maxListLevel(out.doc) > MAX_LIST_LEVELS) return false;
    if (dispatch) dispatch(out);
    return true;
  };
}

/** List item: a paragraph, then nested lists only. Tab indents up to
 *  MAX_LIST_LEVELS (a refused Tab inside a list is swallowed, not focus-moving). */
export const PDListItem = Node.create({
  name: "listItem",
  content: "paragraph (bulletList | orderedList)*",
  defining: true,
  parseHTML() {
    return [{ tag: "li" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", mergeAttributes(HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => {
        const { view } = this.editor;
        return sinkListItemCapped(this.type)(view.state, view.dispatch) || this.editor.isActive(this.name);
      },
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});

export const ChipNode = Node.create({
  name: "chip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      kind: {
        default: CHIP_KINDS[0],
        parseHTML: (el) => {
          const k = el.getAttribute("data-pd-chip");
          return isChipKind(k) ? k : CHIP_KINDS[0];
        },
        renderHTML: (a) => ({ "data-pd-chip": a.kind }),
      },
      ref: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-ref") || "",
        renderHTML: (a) => ({ "data-ref": a.ref }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-pd-chip]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes)];
  },
  renderText() {
    return "";
  },
});

function parsePhoto(raw: string | null): PhotoAttrs {
  try {
    const o = raw ? (JSON.parse(raw) as Partial<PhotoAttrs>) : {};
    return {
      show: typeof o.show === "boolean" ? o.show : DEFAULT_PHOTO.show,
      align: isPhotoAlign(o.align) ? o.align : DEFAULT_PHOTO.align,
      width: clampPhotoWidth(o.width),
    };
  } catch {
    return { ...DEFAULT_PHOTO };
  }
}

/** Is the cursor on an empty LAST paragraph of a product block? Enter there
 *  leaves the block (drops that empty line, opens a paragraph after it). */
export function exitProductBlockOnEmptyLine(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 2) return false;
  const block = $from.node($from.depth - 1);
  const para = $from.parent;
  if (block.type.name !== "productBlock" || para.type.name !== "paragraph" || para.content.size !== 0) return false;
  if ($from.index($from.depth - 1) !== block.childCount - 1 || block.childCount < 2) return false;
  const paraStart = $from.before();
  const after = $from.after($from.depth - 1);
  return editor
    .chain()
    .command(({ tr }) => {
      tr.delete(paraStart, paraStart + para.nodeSize);
      const at = tr.mapping.map(after);
      tr.insert(at, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at + 1));
      return true;
    })
    .run();
}

export const ProductBlockNode = Node.create({
  name: "productBlock",
  group: "block",
  content: "paragraph+",
  defining: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      sectionId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-section-id") || "",
        renderHTML: (a) => ({ "data-section-id": a.sectionId }),
      },
      lineKey: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-line-key") || "",
        renderHTML: (a) => ({ "data-line-key": a.lineKey }),
      },
      sku: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-sku") || "",
        renderHTML: (a) => ({ "data-sku": a.sku }),
      },
      photo: {
        default: { ...DEFAULT_PHOTO },
        parseHTML: (el) => parsePhoto(el.getAttribute("data-photo")),
        renderHTML: (a) => ({ "data-photo": JSON.stringify(a.photo) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-pd-product]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-pd-product": "" }, HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return { Enter: () => exitProductBlockOnEmptyLine(this.editor) };
  },
});

const atomBlock = (name: "priceTable" | "pageBreak", attr: string) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    parseHTML() {
      return [{ tag: `div[${attr}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes({ [attr]: "" }, HTMLAttributes)];
    },
  });

export const PriceTableNode = atomBlock("priceTable", "data-pd-price-table");
export const PageBreakNode = atomBlock("pageBreak", "data-pd-page-break");

export type DocNodeViews = Partial<Record<"chip" | "productBlock" | "priceTable" | "pageBreak", NodeViewRenderer>>;

/** The ONE extension list (extensions.ts passes the React node views). */
export function buildExtensions(views: DocNodeViews = {}): AnyExtension[] {
  const withView = (n: Node, view: NodeViewRenderer | undefined) => (view ? n.extend({ addNodeView: () => view }) : n);
  return [
    StarterKit.configure(STARTER_KIT_OPTIONS),
    PDListItem,
    withView(ChipNode, views.chip),
    withView(ProductBlockNode, views.productBlock),
    withView(PriceTableNode, views.priceTable),
    withView(PageBreakNode, views.pageBreak),
  ];
}

/** The node and mark names the editor's schema registers (sorted). */
export function editorSchemaNames(extensions: AnyExtension[] = buildExtensions()): { nodes: string[]; marks: string[] } {
  const s = getSchema(extensions);
  return { nodes: Object.keys(s.nodes).sort(), marks: Object.keys(s.marks).sort() };
}
