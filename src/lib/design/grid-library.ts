import type { PartLite } from "./grid-bom";
import type { PaletteQuery } from "./grid-palette";
import { GRID_LAYERS, scopeLayerKey, typeLayerKey, type GridLayer } from "./grid-scopes";

/**
 * The Grid workspace's Product Library tree (#299): which node is selected,
 * how a selection maps onto the existing palette query, and the tree the
 * dock renders. Pure and client-safe — no server-only imports.
 */

export type LibrarySel =
  | { kind: "favorites" }
  | { kind: "recent" }
  | { kind: "all" }
  | { kind: "scope"; scope: GridLayer }
  | { kind: "type"; scope: GridLayer; typeKey: string }
  | { kind: "assemblies" }
  | { kind: "curtains" };

export type LibraryNode = {
  key: string;
  label: string;
  count?: number;
  sel: LibrarySel;
  children?: LibraryNode[];
};

/** Stable key for a selection (also the tree node key). */
export function selKey(sel: LibrarySel): string {
  switch (sel.kind) {
    case "scope":
      return scopeLayerKey(sel.scope);
    case "type":
      return typeLayerKey(sel.scope, sel.typeKey);
    default:
      return sel.kind;
  }
}

/** The palette query a selection runs, or null for Assemblies / Curtains (not palette lists). */
export function libraryQuery(sel: LibrarySel, search: string, mfr: string): PaletteQuery | null {
  switch (sel.kind) {
    case "favorites":
      return { tab: "favorites", search, scope: "", typeKey: "", mfr };
    case "recent":
      return { tab: "recent", search, scope: "", typeKey: "", mfr };
    case "all":
      return { tab: "all", search, scope: "", typeKey: "", mfr };
    case "scope":
      return { tab: "all", search, scope: sel.scope, typeKey: "", mfr };
    case "type":
      return { tab: "all", search, scope: sel.scope, typeKey: sel.typeKey, mfr };
    default:
      return null;
  }
}

export function libraryTree(input: {
  scopeCounts: Record<string, number>;
  favorites: number;
  recent: number;
  assemblies: number;
  open: LibrarySel;
  typeChips: { key: string; label: string; count: number }[];
}): LibraryNode[] {
  const node = (label: string, sel: LibrarySel, count?: number): LibraryNode => ({
    key: selKey(sel),
    label,
    sel,
    ...(count === undefined ? {} : { count }),
  });
  const openScope = input.open.kind === "scope" || input.open.kind === "type" ? input.open.scope : null;
  const out: LibraryNode[] = [
    node("Favorites", { kind: "favorites" }, input.favorites),
    node("Recent", { kind: "recent" }, input.recent),
    node("All", { kind: "all" }),
  ];
  for (const scope of GRID_LAYERS) {
    const count = input.scopeCounts[scope] || 0;
    if (count <= 0) continue;
    const n = node(scope, { kind: "scope", scope }, count);
    if (openScope === scope) {
      n.children = input.typeChips.map((t) => node(t.label, { kind: "type", scope, typeKey: t.key }, t.count));
    }
    out.push(n);
  }
  if (input.assemblies > 0) out.push(node("Assemblies", { kind: "assemblies" }, input.assemblies));
  out.push(node("Curtains", { kind: "curtains" }));
  return out;
}

/** Assembly parts for the Assemblies node: search on description / model / manufacturer, sorted by description, then sku. */
export function assemblyParts(parts: PartLite[], search: string): PartLite[] {
  const q = search.trim().toLowerCase();
  return parts
    .filter((p) => p.kind === "assembly")
    .filter(
      (p) =>
        !q ||
        [p.desc, p.modelNumber, p.manufacturer].some((s) => (s || "").toLowerCase().includes(q)),
    )
    .sort((a, b) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku));
}
