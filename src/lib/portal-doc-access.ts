/**
 * Portal document access rule (#242 Task 9, spec §7) — pure. A part
 * document (image, datasheet, or spec sheet) may reach a portal customer
 * ONLY when it is linked, and not hidden, to a part they can quote — or,
 * for a datasheet/spec sheet only, when it's linked (not hidden) to a
 * parent part that covers a quotable part through the accessory graph.
 * An image never serves through the accessory graph: only a datasheet or
 * spec sheet "covers" a child part in the coverage model
 * (src/lib/part-docs/coverage.ts) — a photo is always the part's own.
 *
 * `linksBySku` and `coveringParentsOf` mirror the shapes
 * src/lib/portal-catalog-index.ts already derives from `loadPartDocsState`
 * (spec §1/§3/§8), so this rule is exercised here with plain fixtures
 * rather than a live index. In production the route doesn't call this per
 * request: `portalIndex()` precomputes a `servableDocIds` set once per
 * index build (the union, over every quotable part already in the index,
 * of that part's own `imageIds` ∪ `datasheetIds` — both of which already
 * exclude hidden links and, for `datasheetIds` only, already fold in
 * covering parents) — the same rule, stated here standalone and pure so
 * it can be tested directly.
 */
export type PortalDocLinkFact = { documentId: string; kind: string; hidden?: boolean };

export function canServePortalDoc(input: {
  docId: string;
  linksBySku: Map<string, PortalDocLinkFact[]>;
  quotableSkus: Set<string>;
  coveringParentsOf: (sku: string) => string[];
}): boolean {
  const { docId, linksBySku, quotableSkus, coveringParentsOf } = input;

  const linkedNotHidden = (sku: string, allowImage: boolean): boolean => {
    for (const l of linksBySku.get(sku) ?? []) {
      if (l.documentId !== docId || l.hidden) continue;
      if (!allowImage && l.kind === "image") continue;
      return true;
    }
    return false;
  };

  for (const sku of quotableSkus) {
    // Own link on the quotable part itself: any live kind, including image.
    if (linkedNotHidden(sku, true)) return true;
    // A covering parent's datasheet/spec sheet (never image) also serves.
    for (const parent of coveringParentsOf(sku)) {
      if (linkedNotHidden(parent, false)) return true;
    }
  }
  return false;
}
