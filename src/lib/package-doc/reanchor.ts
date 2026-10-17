import type { PackageDoc, PDNode } from "./types";
import { lineRef, splitLineRef } from "./chips";

/**
 * #312 — a document node that is anchored to one BOM line carries
 * `attrs.{sectionId, lineKey, sku}`. When that line's key-product anchor
 * changes (editing a custom part's SKU, toggling it to an allowance…), these
 * nodes follow it. Add a later line-anchored node type HERE and nowhere else.
 */
export const LINE_ANCHORED_NODES = ["productBlock", "productImage"] as const;

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

/** One line that moved to another system (#357): its old and new system + id. */
export type MovedLineRef = { from: { sectionId: string; id: number }; to: { sectionId: string; id: number } };

/**
 * #357 — lines moved to another system of THIS estimate (and re-minted when
 * their id was taken there): every line-anchored node (LINE_ANCHORED_NODES,
 * attrs `sectionId` + `lineKey`) and every `lineQty` chip (ref
 * `sectionId:lineKey`) naming a moved line's old place is re-pointed at its
 * new one. `sku` is never touched. System-level anchors (systemPrice /
 * systemName chips, systemTotal) name a system, not a line, and stay. Returns
 * `doc` itself when nothing changed. Pure; never mutates; unchanged branches
 * keep their identity. Lines moved OUT of the estimate need no call: like a
 * deleted line, their anchors resolve to nothing (the editor's "removed").
 */
export function reanchorPackageDoc<D extends PackageDoc | null | undefined>(doc: D, moved: readonly MovedLineRef[]): D {
  if (!doc || !Array.isArray(doc.content) || !moved.length) return doc;
  const map = new Map<string, { sectionId: string; lineKey: string }>();
  for (const m of moved) {
    const from = lineRef(m.from.sectionId, m.from.id), to = { sectionId: m.to.sectionId, lineKey: String(m.to.id) };
    if (from !== lineRef(to.sectionId, to.lineKey)) map.set(from, to);
  }
  if (!map.size) return doc;
  let changed = false;
  const visit = (n: PDNode): PDNode => {
    let out = n;
    if (isLineAnchored(n)) {
      const a = (n as unknown as Anchored).attrs;
      const to = a && typeof a.sectionId === "string" && typeof a.lineKey === "string" ? map.get(lineRef(a.sectionId, a.lineKey)) : undefined;
      if (to) {
        out = { ...n, attrs: { ...a, sectionId: to.sectionId, lineKey: to.lineKey } } as PDNode;
        changed = true;
      }
    } else if (n.type === "chip") {
      const a = (n as { attrs?: { kind?: string; ref?: string } }).attrs;
      const r = a && a.kind === "lineQty" && typeof a.ref === "string" ? splitLineRef(a.ref) : null;
      const to = r ? map.get(lineRef(r.sectionId, r.lineKey)) : undefined;
      if (to) {
        out = { ...n, attrs: { ...a, ref: lineRef(to.sectionId, to.lineKey) } } as PDNode;
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
  return (changed ? { ...doc, content } : doc) as D;
}
