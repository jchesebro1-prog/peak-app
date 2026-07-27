/**
 * The Grid - scope taxonomy and layer keys (punch #48).
 *
 * Jeff's ask, verbatim: "we need different filters for different scopes so you
 * can drop items in for lighting, rigging, curtains, audio, video, and then
 * user defined categories". His five are a GRID-SPECIFIC list, deliberately
 * NOT a fourth catalog vocabulary: nothing here is stored on a part, and no
 * catalog row is rewritten. A scope is DERIVED from the taxonomy the catalog
 * already resolves (src/lib/catalog-taxonomy.ts) every time it is needed, so
 * an admin remapping a category in the Catalog screen re-buckets the Grid for
 * free.
 *
 * Pure and dependency-free (the grid-bom rule): the editor is a client
 * component, so nothing in this file may reach for the doc-store.
 *
 * Two independent axes ride on the same layer machinery:
 *   - SCOPE   - one of Jeff's five, or Unscoped. Every placement has exactly
 *               one, computed.
 *   - CATEGORY - an optional user-defined free-text label on a placement
 *               (punch #41's "assign now, consume later"). Orthogonal to the
 *               scope and to Spaces; a placement may have none.
 */

import {
  GROUP_TRADES,
  type CatalogGroup,
  type Trade,
} from "@/lib/catalog-taxonomy";

export const GRID_SCOPES = ["Lighting", "Rigging", "Curtains", "Audio", "Video"] as const;
export type GridScope = (typeof GRID_SCOPES)[number];

/**
 * The catch-all. Named, listed, and toggleable like any other layer: a part
 * whose category has no group and no usable trade must be VISIBLE and
 * countable, never silently dropped out of the design.
 */
export const UNSCOPED = "Unscoped";

export type GridLayer = GridScope | typeof UNSCOPED;

/** Display order for every scope filter, layer list, and rollup. */
export const GRID_LAYERS: GridLayer[] = [...GRID_SCOPES, UNSCOPED];

/**
 * Catalog group -> Grid scope. The six beta groups fold onto four of Jeff's
 * five; Rigging has no group of its own (rigging hardware is trade-only in
 * DEFAULT_CATEGORY_MAP), so it arrives through the trade fallback below.
 */
export const GROUP_SCOPES: Record<CatalogGroup, GridScope> = {
  "Lighting Controls": "Lighting",
  Fixtures: "Lighting",
  "Video Controls": "Video",
  Speakers: "Audio",
  "Audio Controls": "Audio",
  Curtains: "Curtains",
};

/**
 * Trade -> Grid scope, used only when a part has no group. "AV" is
 * DELIBERATELY absent: it forks into both Audio and Video and the trade alone
 * cannot say which, so an ungrouped AV part (racks, connectors, cable
 * assemblies, networking) lands in Unscoped rather than being guessed into the
 * wrong bucket. Mapping those categories to a group in the Catalog screen is
 * what promotes them, which is exactly the seam that already exists.
 */
const TRADE_SCOPES: Partial<Record<Trade, GridScope>> = {
  Lighting: "Lighting",
  Rigging: "Rigging",
};

/** The scope-resolvable slice of a part (PartLite satisfies it structurally). */
export type ScopedPartLite = {
  group?: string | null;
  trade?: string | null;
};

/** Group first, then trade, then Unscoped. Never throws, never guesses. */
export function scopeOfPart(part: ScopedPartLite | null | undefined): GridLayer {
  if (!part) return UNSCOPED;
  const group = part.group as CatalogGroup | null | undefined;
  if (group && group in GROUP_SCOPES) return GROUP_SCOPES[group];
  const trade = (part.trade as Trade | null | undefined) ?? (group ? GROUP_TRADES[group] : null);
  if (trade && TRADE_SCOPES[trade]) return TRADE_SCOPES[trade] as GridScope;
  return UNSCOPED;
}

/**
 * Stable swatch per scope - the layer list, the marker for a dropped curtain
 * and the per-space breakdown all read as the same five families. Deliberately
 * a fixed table, not the hashed markerColor the palette uses for catalog
 * categories: a scope is a fixed vocabulary and should never shift color.
 */
export const SCOPE_COLORS: Record<GridLayer, string> = {
  Lighting: "#e08b1f",
  Rigging: "#6b4fa1",
  Curtains: "#b0367c",
  Audio: "#2e9e6b",
  Video: "#3155a8",
  Unscoped: "#8c919c",
};

/** Swatch for a scope name that arrived as a plain string (a rollup key). */
export function scopeColor(key: string): string {
  return SCOPE_COLORS[key as GridLayer] || SCOPE_COLORS.Unscoped;
}

/* ------------------------------- layer keys ------------------------------- */

/**
 * Scopes and user categories share one hidden-layer set, so the keys are
 * namespaced - a user category literally called "Lighting" must not silently
 * toggle the Lighting scope.
 */
export function scopeLayerKey(scope: GridLayer): string {
  return `scope:${scope}`;
}

export function categoryLayerKey(category: string): string {
  return `cat:${category}`;
}

/** Trimmed label, or null when a placement carries no user category. */
export function normalizeCategory(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  return t ? t.slice(0, 40) : null;
}

/**
 * Layer visibility for one item. The two axes AND together: hiding a scope
 * hides everything in it whatever its category, and hiding a category hides
 * that label across every scope. An item with no category is never affected by
 * a category toggle - categories are opt-in labels, not a partition.
 */
export function isLayerVisible(
  scope: GridLayer,
  category: string | null,
  hidden: ReadonlySet<string>
): boolean {
  if (hidden.has(scopeLayerKey(scope))) return false;
  if (category && hidden.has(categoryLayerKey(category))) return false;
  return true;
}
