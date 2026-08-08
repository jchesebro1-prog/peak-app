/* ------------------------------------------------------------------ *
 * The Grid — BOM math (D108). Pure and dependency-free on purpose
 * (same rule as lib/annotations.ts): the editor's live BOM sidebar is
 * a client component and must not drag the doc-store, and therefore
 * PGlite, into the browser bundle. The server quote action uses the
 * same functions so the sidebar and the quote can never disagree.
 * ------------------------------------------------------------------ */

// Type-only — catalog-connect is itself pure/dependency-free, so this never
// drags anything heavier into the client bundle (erased at compile time).
import type { Port } from "@/lib/catalog-connect";
// Type-only, and curtain-geom is the CUSTOMER-SAFE mirror (no cost basis, no
// margin) - importing it here keeps this module client-safe.
import type { CurtainSpec } from "@/lib/curtain-geom";

/** The slice of a catalog part the BOM needs — structurally satisfied by
 *  stores/catalog.CatalogPart, mapped server-side and passed to the client. */
export type PartLite = {
  id: string;
  sku: string;
  desc: string;
  category: string;
  unit: string;
  list: number;
  cost: number;
  /** Device connectors (Task 4, punch #39) — present only when the catalog
   *  part has been migrated to declare ports; the Grid editor uses this to
   *  decide whether a device-wire route can be validated at all. */
  ports?: Port[];
  /** Datasheet attachment flag (Task 5, punch #39, D116) — true only when
   *  the catalog part has a datasheet blob attached. Deliberately just a
   *  boolean (not the blob key): the editor only needs to know whether to
   *  render a link to the authenticated /api/part-datasheet/<sku> proxy. */
  hasDatasheet?: boolean;
  /** Resolved beta group (Task 6, punch #39) — `groupOf(part, map)` run
   *  server-side against the admin-editable category map; null when the
   *  part's category has no group mapping (legacy taxonomy, surfaced in the
   *  palette as "Other"). Optional (like `hasDatasheet`) because the other
   *  server routes that build PartLite-shaped BOM inputs (riser/schedule
   *  pages, quote actions, the projects list) pass raw CatalogPart rows
   *  straight through and never resolve a group — only the Grid editor's
   *  palette needs it, and it treats a missing value the same as null. The
   *  editor never re-derives this — it's dumb by design; the map lives only
   *  on the server. */
  group?: string | null;
  /** Resolved trade (punch #48) - `tradeOf(part, map)` run server-side, the
   *  same deal as `group`. The Grid's scope taxonomy (grid-scopes.ts) needs
   *  it because Rigging has no beta group of its own: rigging hardware is
   *  trade-only in DEFAULT_CATEGORY_MAP, so without this every piece of track
   *  and every loft block would fall into Unscoped. Optional for the same
   *  reason as `group`: the other PartLite-shaped callers never resolve it. */
  trade?: string | null;
};

/** True for a PartLite that resolves to genuine rigging HARDWARE (pipes,
 *  battens, hoists, track, etc.) as distinct from a Curtains-GROUP part,
 *  which also resolves to the Rigging trade (Curtains -> Rigging per
 *  GROUP_TRADES in catalog-taxonomy.ts) but isn't rigging hardware. Used by
 *  the Grid editor's "Generate starting layout" seed-part resolution (#38):
 *  "Rigging" is a TRADE, never a literal `category` string, so matching on
 *  `category === "Rigging"` could never find a real catalog row. Pulled out
 *  here (rather than inlined in the editor) so the resolution rule has one
 *  place to test. */
export function isRiggingHardwarePart(p: Pick<PartLite, "trade" | "group">): boolean {
  return p.trade === "Rigging" && p.group !== "Curtains";
}

/* -------------------------------- curtains -------------------------------- */

/** Jeff's Grid set (punch #49). Three other curtain vocabularies already
 *  exist elsewhere in the codebase (quick/engine, design/goods, lineset);
 *  they are NOT unified here - this one is the Grid's, and only the Grid's. */
export const GRID_CURTAIN_TYPES = ["Border", "Draw", "Full", "Leg"] as const;
export type GridCurtainType = (typeof GRID_CURTAIN_TYPES)[number];

/** The estimator's segmented fullness set (curtain-modal), reused verbatim. */
export const GRID_FULLNESS: Array<{ label: string; pct: number }> = [
  { label: "Flat", pct: 0 },
  { label: "50%", pct: 50 },
  { label: "75%", pct: 75 },
  { label: "100%", pct: 100 },
];

/**
 * A curtain dropped onto a plan (punch #49). NOT a catalog part: it is a
 * priced line in its own right, exactly like the estimator's curtain
 * configurator, sized and specced at drop time and priced from fullness +
 * fabric through the shared two-term model. `fabricSku` is the only catalog
 * link (the Fabric row that supplies the area rate), and it is also what the
 * host placement's `partId` carries so every existing partId-keyed path
 * (marker color, revisions, space assignment) keeps working untouched.
 */
export type GridCurtain = {
  type: GridCurtainType;
  name: string;
  /** Finished width/height in feet. */
  widthFt: number;
  heightFt: number;
  /** 0 | 50 | 75 | 100. */
  fullnessPct: number;
  fabricSku: string;
};

/** Placement slice the curtain BOM needs. */
export type CurtainPlacementLite = {
  id: string;
  partId: string;
  curtain?: GridCurtain | null;
};

export function isCurtainPlacement(pl: { curtain?: GridCurtain | null }): boolean {
  return Boolean(pl.curtain);
}

/** GridCurtain -> the shared all-strings CurtainSpec the curtain pricing
 *  model (both the server's and the customer-safe mirror's) takes. Lives here
 *  rather than in grid-curtains so the client can build one without importing
 *  the server-only cost module. */
export function curtainSpecOf(c: GridCurtain): CurtainSpec {
  return {
    name: c.name,
    hang: "",
    fabric: c.fabricSku,
    qty: "1",
    width: String(c.widthFt),
    height: String(c.heightFt),
    fullness: String(c.fullnessPct),
    bottom: "",
  };
}

/** One-line human description - the BOM row, the quote line, and the marker
 *  tooltip all read the same sentence. */
export function curtainDesc(c: GridCurtain, fabricName?: string): string {
  const fullness = c.fullnessPct > 0 ? `${c.fullnessPct}% fullness` : "flat";
  const fabric = fabricName || c.fabricSku;
  return `${c.name} (${c.type}) · ${c.widthFt}×${c.heightFt} ft · ${fullness} · ${fabric}`;
}

/**
 * One BOM line per dropped curtain - never grouped, because two curtains of
 * the same fabric are different goods the moment their dimensions differ, and
 * a shop cuts each one separately.
 *
 * Prices are supplied, not computed: the authoritative cost model lives in
 * lib/design/curtain-pricing (server-only, holds the cost basis). The editor
 * passes sell prices derived from customer-safe sell numbers (lib/curtain-geom)
 * and the quote action passes the server's own authoritative figures; the two
 * agree to the cent by construction (see curtain-geom's header).
 */
export function curtainLines(
  placements: CurtainPlacementLite[],
  prices: ReadonlyMap<string, number>,
  fabricNames?: ReadonlyMap<string, string>
): BomLine[] {
  const lines: BomLine[] = [];
  for (const pl of placements) {
    if (!pl.curtain) continue;
    const price = prices.get(pl.id) || 0;
    lines.push({
      partId: pl.id,
      desc: curtainDesc(pl.curtain, fabricNames?.get(pl.curtain.fabricSku)),
      unit: "ea",
      qty: 1,
      list: price,
      ext: price,
      kind: "curtain",
      curtainName: pl.curtain.name,
    });
  }
  return lines.sort((a, b) => b.ext - a.ext || a.partId.localeCompare(b.partId));
}

export type BomLine = {
  partId: string;
  desc: string;
  unit: string;
  qty: number;
  /** Unit list price at render time. */
  list: number;
  /** qty × list. */
  ext: number;
  /** Present only on route lines (Task 4) where every contributing route
   *  agreed on the same validated connectionType — an ambiguous group
   *  (mixed types, or any route with no connectionType at all) is left
   *  unset rather than guessing. */
  connectionType?: string;
  /** Set on curtain lines (punch #49) - `partId` is the PLACEMENT id there,
   *  not a catalog id, so a consumer that would otherwise look the part up
   *  can tell the difference. */
  kind?: "curtain";
  /** Curtain lines only: the name the designer typed, for a short label. */
  curtainName?: string;
};

/**
 * Group device placements into BOM lines, priciest line first.
 *
 * A placement whose part has left the catalog is NOT dropped — hiding it
 * would silently shrink a quote. It stays visible at $0, flagged, so the
 * human deletes the markers or restores the part deliberately.
 */
export function bomLines(
  placements: Array<{ partId: string; curtain?: GridCurtain | null }>,
  parts: PartLite[]
): BomLine[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const qty = new Map<string, number>();
  // Curtains (punch #49) are priced goods, not catalog units: they carry a
  // fabric partId so the rest of the editor keeps working, and counting that
  // partId here would quietly bill the fabric row a second time.
  for (const pl of placements) {
    if (pl.curtain) continue;
    qty.set(pl.partId, (qty.get(pl.partId) || 0) + 1);
  }
  const lines: BomLine[] = [];
  for (const [partId, n] of qty) {
    const part = byId.get(partId);
    lines.push({
      partId,
      desc: part ? part.desc : `${partId} (removed part — no longer in the catalog)`,
      unit: part ? part.unit : "ea",
      qty: n,
      list: part ? part.list : 0,
      ext: n * (part ? part.list : 0),
    });
  }
  return lines.sort((a, b) => b.ext - a.ext || a.partId.localeCompare(b.partId));
}

/* --------------------------- per-space rollups --------------------------- */

import { spaceOf, type SpaceLite } from "./grid-geometry";
import { GRID_LAYERS, normalizeCategory, scopeOfPart, type GridLayer } from "./grid-scopes";

/** One slice of a space's total - by scope, or by user category. */
export type RollupSlice = {
  /** The scope name, or the user category label. */
  key: string;
  count: number;
  value: number;
};

export type SpaceRollup = {
  /** null = devices outside every space. */
  spaceId: string | null;
  name: string;
  count: number;
  value: number;
  /** Punch #48 - the same count/value split across Jeff's five scopes plus
   *  Unscoped, in GRID_LAYERS order. Only non-empty scopes appear. Jeff's
   *  "those categories should track through with the spaces as well": before
   *  this, bomBySpace dropped the part's group on the floor and a space knew
   *  only a flat count. */
  byScope: RollupSlice[];
  /** Punch #48 - the same split across user-defined categories, alphabetical.
   *  Placements with no category contribute to `count`/`value` but to no
   *  slice, so these deliberately do NOT sum to the total. */
  byCategory: RollupSlice[];
};

/** Placement slice bomBySpace needs. `id` and `curtain` are what let a
 *  curtain be valued from its own price rather than from a catalog row; both
 *  are optional so the pre-#48 callers (and the geometry tests) that pass a
 *  bare device position still type-check. */
export type RollupPlacementLite = {
  id?: string;
  sheetId: string;
  page: number;
  x: number;
  y: number;
  partId: string;
  curtain?: GridCurtain | null;
  category?: string;
};

function addSlice(slices: RollupSlice[], key: string, value: number): void {
  const hit = slices.find((s) => s.key === key);
  if (hit) {
    hit.count += 1;
    hit.value += value;
    return;
  }
  slices.push({ key, count: 1, value });
}

/**
 * Devices grouped by the space containing them (smallest-wins, computed —
 * see grid-geometry). One rollup per space that has devices, in the
 * project's space order, plus a trailing "Unassigned" bucket when any
 * placement falls in no space. Value is the same list-price basis as
 * bomLines; parts missing from the catalog contribute $0 but still count.
 *
 * `curtainPrices` (punch #49) maps placement id -> sell price for dropped
 * curtains; a curtain with no entry contributes $0 and still counts, the same
 * forgiveness a removed catalog part gets.
 */
export function bomBySpace(
  placements: RollupPlacementLite[],
  parts: PartLite[],
  spaces: Array<SpaceLite & { name: string }>,
  curtainPrices?: ReadonlyMap<string, number>
): SpaceRollup[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const blank = (spaceId: string | null, name: string): SpaceRollup => ({
    spaceId,
    name,
    count: 0,
    value: 0,
    byScope: [],
    byCategory: [],
  });
  const buckets = new Map<string | null, SpaceRollup>();
  for (const s of spaces) buckets.set(s.id, blank(s.id, s.name));
  const unassigned = blank(null, "Unassigned");
  for (const pl of placements) {
    const home = spaceOf(pl, spaces);
    const bucket = home ? buckets.get(home.id)! : unassigned;
    const value = pl.curtain
      ? (pl.id ? curtainPrices?.get(pl.id) : 0) || 0
      : byId.get(pl.partId)?.list || 0;
    bucket.count += 1;
    bucket.value += value;
    const scope: GridLayer = pl.curtain ? "Curtains" : scopeOfPart(byId.get(pl.partId));
    addSlice(bucket.byScope, scope, value);
    const category = normalizeCategory(pl.category);
    if (category) addSlice(bucket.byCategory, category, value);
  }
  const out = [...buckets.values()].filter((b) => b.count > 0);
  if (unassigned.count > 0) out.push(unassigned);
  for (const b of out) {
    b.byScope.sort(
      (x, y) =>
        GRID_LAYERS.indexOf(x.key as GridLayer) - GRID_LAYERS.indexOf(y.key as GridLayer)
    );
    b.byCategory.sort((x, y) => x.key.localeCompare(y.key));
  }
  return out;
}

/* ------------------------------ wire routes ------------------------------ */

import { polylineLength } from "./grid-geometry";
import type { Calibration } from "@/lib/annotations";

/** Units that price by run length — the wire-part predicate (D110). */
export function isPerLengthUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase().replace(/^\//, "");
  return u === "ft" || u === "lin ft" || u === "linear ft" || u === "lf";
}

export type RouteLite = {
  id: string;
  sheetId: string;
  page: number;
  points: Point[];
  /** Page height/width, stamped at draw time — a property of the page, so
   *  the length is recomputable without re-opening the sheet. */
  aspect: number;
  partId: string;
  /** Validated device-wire connectionType (Task 4), when stamped. */
  connectionType?: string;
};

// grid-geometry's Point is annotations' Point; re-declare structurally to
// keep this file dependency-light for the client bundle.
type Point = { x: number; y: number };

/** Real length in the calibration's unit, or null when the page has no
 *  scale — an unmeasured wire must be surfaced, never guessed. */
export function routeLengthFt(route: RouteLite, cals: Calibration[]): number | null {
  const cal = cals.find((c) => c.docId === route.sheetId && c.page === route.page) || null;
  if (!cal || !(route.aspect > 0)) return null;
  return polylineLength(route.points, route.aspect) * cal.scale;
}

/**
 * Wire BOM: measured routes grouped by part, total feet rounded UP per part
 * (cable is bought whole, not prorated). Routes on pages whose calibration
 * has gone missing are counted in `unmeasured` rather than silently dropped.
 */
export function routeLines(
  routes: RouteLite[],
  parts: PartLite[],
  cals: Calibration[]
): { lines: BomLine[]; value: number; cost: number; unmeasured: number } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const feet = new Map<string, number>();
  // Per-part-group connectionTypes seen (Task 4) — a line is annotated only
  // when EVERY contributing route carries a connectionType and they all
  // agree; an unstamped route (no connectionType at all) makes the group
  // just as ambiguous as a disagreeing one, so it also suppresses the
  // suffix rather than letting the stamped routes' type leak onto footage
  // that was never validated.
  const connTypes = new Map<string, Set<string>>();
  const hasUnstamped = new Set<string>();
  let unmeasured = 0;
  for (const r of routes) {
    const ft = routeLengthFt(r, cals);
    if (ft === null) {
      unmeasured++;
      continue;
    }
    feet.set(r.partId, (feet.get(r.partId) || 0) + ft);
    if (r.connectionType) {
      const set = connTypes.get(r.partId) || new Set<string>();
      set.add(r.connectionType);
      connTypes.set(r.partId, set);
    } else {
      hasUnstamped.add(r.partId);
    }
  }
  const lines: BomLine[] = [];
  let value = 0;
  let cost = 0;
  for (const [partId, ft] of feet) {
    const part = byId.get(partId);
    const qty = Math.ceil(ft);
    const types = connTypes.get(partId);
    const connectionType =
      types && types.size === 1 && !hasUnstamped.has(partId) ? [...types][0] : undefined;
    const line: BomLine = {
      partId,
      desc: part ? part.desc : `${partId} (removed part — no longer in the catalog)`,
      unit: part ? part.unit : "ft",
      qty,
      list: part ? part.list : 0,
      ext: qty * (part ? part.list : 0),
      ...(connectionType ? { connectionType } : {}),
    };
    lines.push(line);
    value += line.ext;
    cost += qty * (part ? part.cost : 0);
  }
  lines.sort((a, b) => b.ext - a.ext || a.partId.localeCompare(b.partId));
  return { lines, value, cost, unmeasured };
}

/** Sell value, internal cost, and blended margin for a set of placements. */
export function bomTotals(
  placements: Array<{ partId: string; curtain?: GridCurtain | null }>,
  parts: PartLite[]
): { value: number; cost: number; margin: number } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let value = 0;
  let cost = 0;
  for (const pl of placements) {
    if (pl.curtain) continue; // priced separately - see curtainLines
    const part = byId.get(pl.partId);
    if (!part) continue;
    value += part.list;
    cost += part.cost;
  }
  return { value, cost, margin: value > 0 ? (value - cost) / value : 0 };
}
