import {
  clampPhotoWidth,
  DEFAULT_IMAGE,
  DEFAULT_PHOTO,
  DOC_VERSION,
  isChipKind,
  isPhotoAlign,
  LIST_START_MAX,
  LIST_START_MIN,
  MARK_NAMES,
  MAX_BLOCK_TEXT,
  MAX_DEPTH,
  MAX_JSON_CHARS,
  MAX_LINE_KEY,
  MAX_NODES,
  MAX_RAW_VISITS,
  MAX_REF,
  MAX_SECTION_ID,
  MAX_SKU,
  SYSTEM_CHIP_KINDS,
} from "./schema";
import type { PackageDoc, PDBlock, PDMark, PDMarkType, PhotoAttrs } from "./types";

/**
 * Estimator Phase 5 — the package document validator. Everything that reads
 * or writes `spec.document` goes through here: the save action (server), the
 * print/online loaders and the editor's own output. Rules:
 *
 *  - Not a `{ type: "doc", content: [...] }` object, or a `version` other than
 *    1 → null (treated as "no document").
 *  - Unknown node types, nodes in a place the schema doesn't allow them
 *    (a heading in a list item, a block inside a paragraph, a product block
 *    inside a product block…), unknown marks and unknown attrs are dropped —
 *    a dropped node takes its children with it. The one exception: a product
 *    block whose anchors are unusable is unwrapped, so its paragraphs survive.
 *  - Bad attr VALUES are coerced: heading level → 1–3 (default 1), photo
 *    width → 25–100 (default 34), align → left/right/full (default right),
 *    show → boolean (default true). A chip with an unknown kind or an
 *    over-long ref is dropped; quoteNumber/grandTotal chips carry ref "".
 *  - Caps: nodes past MAX_NODES (document order) are dropped; text past
 *    MAX_BLOCK_TEXT characters per paragraph/heading is cut; nodes nested
 *    deeper than MAX_DEPTH are dropped; reading stops after MAX_RAW_VISITS raw
 *    nodes; a result whose JSON is longer than MAX_JSON_CHARS → null.
 *  - Structure is repaired: empty lists are dropped, a list item / product
 *    block with no paragraph gets an empty one, a list item's extra
 *    paragraphs merge into its first (joined with a hard break) so it reads
 *    `paragraph (bulletList | orderedList)*` like the editor, an empty doc
 *    gets one empty paragraph. Empty text nodes are dropped (ProseMirror rejects them).
 *  - A systemTotal (the live system price line) is an atom with one attr,
 *    `sectionId`; an empty or over-long sectionId drops the node.
 *  - A productImage (#312, a product's photo as its own piece) is a top-level
 *    atom `{ sectionId, lineKey, sku, align, width }` — the product block's
 *    anchors (unusable anchors drop it: it has no words to keep), align →
 *    left/right/full (default right), width → 25–100 (default 34); any
 *    content is dropped.
 *  - An ordered list keeps an integer `start` of 2–9999 (1 is the default, dropped).
 *
 * Iterative (an explicit stack), never recursive, so hostile nesting can't
 * blow the call stack. Pure; client-safe.
 */

type Kind = "doc" | "list" | "listItem" | "productBlock" | "textblock";
type Container = { kind: Kind; content: unknown[]; textLeft: number };
type Frame = { raw: unknown; parent: Container; depth: number; only?: "paragraph" };
type Made = { node: { type: string; content?: unknown[] }; parent: Container; kind: Kind };

const ALLOWED: Record<Kind, ReadonlySet<string>> = {
  doc: new Set(["paragraph", "heading", "bulletList", "orderedList", "pageBreak", "priceTable", "productBlock", "productImage", "systemTotal"]),
  list: new Set(["listItem"]),
  listItem: new Set(["paragraph", "bulletList", "orderedList"]),
  productBlock: new Set(["paragraph"]),
  textblock: new Set(["text", "hardBreak", "chip"]),
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strOf = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

function cleanMarks(raw: unknown): PDMark[] {
  if (!Array.isArray(raw)) return [];
  const out: PDMark[] = [];
  for (const m of raw.slice(0, 8)) {
    const t = isObj(m) ? m.type : null;
    if (typeof t === "string" && (MARK_NAMES as readonly string[]).includes(t) && !out.some((x) => x.type === t)) out.push({ type: t as PDMarkType });
  }
  return out;
}

function cleanPhoto(raw: unknown): PhotoAttrs {
  const o = isObj(raw) ? raw : {};
  return {
    show: typeof o.show === "boolean" ? o.show : DEFAULT_PHOTO.show,
    align: isPhotoAlign(o.align) ? o.align : DEFAULT_PHOTO.align,
    width: clampPhotoWidth(o.width),
  };
}

/** A block's system anchor, or null when empty / over-long. */
function sectionIdOf(attrs: unknown): string | null {
  const id = strOf(isObj(attrs) ? attrs.sectionId : null);
  return id && id.length <= MAX_SECTION_ID ? id : null;
}

/** Anchors of a product block, or null when unusable (→ unwrap). */
function productAnchors(attrs: unknown): { sectionId: string; lineKey: string; sku: string } | null {
  const a = isObj(attrs) ? attrs : {};
  const sectionId = strOf(a.sectionId);
  const lineKey = strOf(a.lineKey);
  const sku = a.sku == null ? "" : strOf(a.sku);
  if (!sectionId || sectionId.length > MAX_SECTION_ID) return null;
  if (!lineKey || lineKey.length > MAX_LINE_KEY) return null;
  if (sku == null || sku.length > MAX_SKU) return null;
  return { sectionId, lineKey, sku };
}

/** Total node count of a sanitized tree (doc excluded). Iterative. */
export function countNodes(blocks: readonly unknown[]): number {
  let n = 0;
  const stack: unknown[] = [...blocks];
  while (stack.length) {
    const x = stack.pop();
    n++;
    const c = isObj(x) && Array.isArray(x.content) ? x.content : null;
    if (c) for (const k of c) stack.push(k);
  }
  return n;
}

export function sanitizePackageDoc(raw: unknown): PackageDoc | null {
  if (!isObj(raw) || raw.type !== "doc" || !Array.isArray(raw.content)) return null;
  if (raw.version !== undefined && raw.version !== DOC_VERSION) return null;

  const root: Container = { kind: "doc", content: [], textLeft: 0 };
  const made: Made[] = [];
  const stack: Frame[] = [];
  let visits = 0;
  let count = 0;

  const pushKids = (kids: unknown, parent: Container, depth: number, only?: "paragraph") => {
    if (!Array.isArray(kids)) return;
    const n = Math.max(0, Math.min(kids.length, MAX_RAW_VISITS - visits - stack.length));
    for (let i = n - 1; i >= 0; i--) stack.push({ raw: kids[i], parent, depth, only });
  };
  const open = (node: { type: string; content?: unknown[] }, parent: Container, kind: Kind): Container => {
    const content: unknown[] = [];
    node.content = content;
    parent.content.push(node);
    made.push({ node, parent, kind });
    return { kind, content, textLeft: kind === "textblock" ? MAX_BLOCK_TEXT : 0 };
  };

  pushKids(raw.content, root, 1);
  while (stack.length) {
    const f = stack.pop()!;
    if (++visits > MAX_RAW_VISITS || count >= MAX_NODES) break;
    if (f.depth > MAX_DEPTH || !isObj(f.raw)) continue;
    const r = f.raw;
    const type = typeof r.type === "string" ? r.type : "";
    if (f.only ? type !== f.only : !ALLOWED[f.parent.kind].has(type)) continue;
    const p = f.parent;
    switch (type) {
      case "text": {
        if (p.textLeft <= 0 || typeof r.text !== "string") break;
        const text = r.text.slice(0, p.textLeft);
        if (!text) break;
        p.textLeft -= text.length;
        const marks = cleanMarks(r.marks);
        p.content.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
        count++;
        break;
      }
      case "hardBreak":
        p.content.push({ type: "hardBreak" });
        count++;
        break;
      case "chip": {
        const a = isObj(r.attrs) ? r.attrs : {};
        if (!isChipKind(a.kind)) break;
        const scoped = a.kind === "lineQty" || (SYSTEM_CHIP_KINDS as readonly string[]).includes(a.kind);
        const ref = scoped ? strOf(a.ref) ?? "" : "";
        if (ref.length > MAX_REF) break;
        p.content.push({ type: "chip", attrs: { kind: a.kind, ref } });
        count++;
        break;
      }
      case "paragraph": {
        const c = open({ type: "paragraph" }, p, "textblock");
        count++;
        pushKids(r.content, c, f.depth + 1);
        break;
      }
      case "heading": {
        const a = isObj(r.attrs) ? r.attrs : {};
        const lv = typeof a.level === "number" && Number.isFinite(a.level) ? Math.min(3, Math.max(1, Math.round(a.level))) : 1;
        const node = { type: "heading", attrs: { level: lv } } as { type: string; attrs: { level: number }; content?: unknown[] };
        const c = open(node, p, "textblock");
        count++;
        pushKids(r.content, c, f.depth + 1);
        break;
      }
      case "bulletList":
      case "orderedList": {
        const node: { type: string; attrs?: { start: number }; content?: unknown[] } = { type };
        if (type === "orderedList") {
          // An integer start 2–9999 survives (1 is the default and stays implicit).
          const st = isObj(r.attrs) ? r.attrs.start : undefined;
          if (typeof st === "number" && Number.isInteger(st) && st > LIST_START_MIN && st <= LIST_START_MAX) node.attrs = { start: st };
        }
        const c = open(node, p, "list");
        count++;
        pushKids(r.content, c, f.depth + 1);
        break;
      }
      case "listItem": {
        const c = open({ type: "listItem" }, p, "listItem");
        count++;
        pushKids(r.content, c, f.depth + 1);
        break;
      }
      case "pageBreak":
      case "priceTable":
        p.content.push({ type });
        count++;
        break;
      case "systemTotal": {
        // An atom anchored on a system; no usable sectionId → dropped.
        const sectionId = sectionIdOf(r.attrs);
        if (!sectionId) break;
        p.content.push({ type: "systemTotal", attrs: { sectionId } });
        count++;
        break;
      }
      case "productImage": {
        // An atom anchored on one BOM line; unusable anchors → dropped.
        const anchors = productAnchors(r.attrs);
        if (!anchors) break;
        const a = isObj(r.attrs) ? r.attrs : {};
        p.content.push({ type: "productImage", attrs: { ...anchors, align: isPhotoAlign(a.align) ? a.align : DEFAULT_IMAGE.align, width: clampPhotoWidth(a.width) } });
        count++;
        break;
      }
      case "productBlock": {
        const anchors = productAnchors(r.attrs);
        if (!anchors) {
          // Unusable anchors: keep the words as plain paragraphs in place.
          pushKids(r.content, p, f.depth, "paragraph");
          break;
        }
        const photo = cleanPhoto(isObj(r.attrs) ? r.attrs.photo : null);
        const node = { type: "productBlock", attrs: { ...anchors, photo } } as { type: string; attrs: unknown; content?: unknown[] };
        const c = open(node, p, "productBlock");
        count++;
        pushKids(r.content, c, f.depth + 1);
        break;
      }
    }
  }

  // Repair, children before parents (reverse creation order = post-order).
  for (let i = made.length - 1; i >= 0; i--) {
    const { node, parent, kind } = made[i];
    const content = node.content || [];
    if (kind === "textblock") {
      if (!content.length) delete node.content;
    } else if (kind === "list") {
      if (!content.length) {
        const at = parent.content.indexOf(node);
        if (at >= 0) parent.content.splice(at, 1);
      }
    } else if (kind === "listItem") {
      // The editor's list item is `paragraph (bulletList | orderedList)*`:
      // one paragraph first, then lists. Extra paragraphs merge into the
      // first, each joined with a hard break (text still capped per block).
      const paras = content.filter((k) => (k as { type?: string }).type === "paragraph") as { type: string; content?: unknown[] }[];
      const lists = content.filter((k) => (k as { type?: string }).type !== "paragraph");
      const merged: unknown[] = [];
      let left = MAX_BLOCK_TEXT;
      paras.forEach((para, i) => {
        if (i > 0) merged.push({ type: "hardBreak" });
        for (const k of para.content || []) {
          const tx = k as { type?: string; text?: string };
          if (tx.type !== "text" || typeof tx.text !== "string") {
            merged.push(k);
            continue;
          }
          if (left <= 0) continue;
          const text = tx.text.slice(0, left);
          left -= text.length;
          merged.push(text === tx.text ? k : { ...tx, text });
        }
      });
      const first: { type: string; content?: unknown[] } = { type: "paragraph" };
      if (merged.length) first.content = merged;
      content.splice(0, content.length, first, ...lists);
    } else if (kind === "productBlock") {
      if (!content.length) content.push({ type: "paragraph" });
    }
  }
  const blocks = root.content as PDBlock[];
  if (!blocks.length) blocks.push({ type: "paragraph" });
  // Repairs can add a few empty paragraphs past the cap: trim trailing blocks.
  while (blocks.length > 1 && countNodes(blocks) > MAX_NODES) blocks.pop();

  const doc: PackageDoc = { type: "doc", version: DOC_VERSION, content: blocks };
  if (JSON.stringify(doc).length > MAX_JSON_CHARS) return null;
  return doc;
}
