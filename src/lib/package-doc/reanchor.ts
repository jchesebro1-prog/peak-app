import type { PackageDoc, PDNode } from "./types";

/**
 * #312 — a document node that is anchored to one BOM line carries
 * `attrs.{sectionId, lineKey, sku}`. When that line's key-product anchor
 * changes (editing a custom part's SKU, toggling it to an allowance…), these
 * nodes follow it. Add a later line-anchored node type HERE and nowhere else.
 */
export const LINE_ANCHORED_NODES = ["productBlock"] as const;

type Anchored = { type: string; attrs: { sectionId?: string; lineKey?: string; sku?: string }; content?: PDNode[] };

const isLineAnchored = (n: PDNode): boolean => (LINE_ANCHORED_NODES as readonly string[]).includes(n.type);

/**
 * The document with every line-anchored node of `sectionId` + `lineKey` moved
 * to `newSku`; null when nothing changed (no such node, or already there).
 * Pure; never mutates `doc`; unchanged branches keep their identity.
 */
export function reanchorDocLine(
  doc: PackageDoc | null | undefined,
  sectionId: string,
  lineKey: string,
  newSku: string,
): PackageDoc | null {
  if (!doc || !Array.isArray(doc.content) || !newSku) return null;
  let changed = false;
  const visit = (n: PDNode): PDNode => {
    let out = n;
    if (isLineAnchored(n)) {
      const a = (n as unknown as Anchored).attrs;
      if (a && a.sectionId === sectionId && a.lineKey === lineKey && a.sku !== newSku) {
        out = { ...n, attrs: { ...a, sku: newSku } } as PDNode;
        changed = true;
      }
    }
    const kids = (out as { content?: PDNode[] }).content;
    if (Array.isArray(kids)) {
      let kidsChanged = false;
      const next = kids.map((k) => {
        const v = visit(k);
        if (v !== k) kidsChanged = true;
        return v;
      });
      if (kidsChanged) out = { ...out, content: next } as PDNode;
    }
    return out;
  };
  const content = doc.content.map((b) => visit(b) as PackageDoc["content"][number]);
  return changed ? { ...doc, content } : null;
}
