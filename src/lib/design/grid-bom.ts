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
};

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
};

/**
 * Group device placements into BOM lines, priciest line first.
 *
 * A placement whose part has left the catalog is NOT dropped — hiding it
 * would silently shrink a quote. It stays visible at $0, flagged, so the
 * human deletes the markers or restores the part deliberately.
 */
export function bomLines(
  placements: Array<{ partId: string }>,
  parts: PartLite[]
): BomLine[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const qty = new Map<string, number>();
  for (const pl of placements) qty.set(pl.partId, (qty.get(pl.partId) || 0) + 1);
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

export type SpaceRollup = {
  /** null = devices outside every space. */
  spaceId: string | null;
  name: string;
  count: number;
  value: number;
};

/**
 * Devices grouped by the space containing them (smallest-wins, computed —
 * see grid-geometry). One rollup per space that has devices, in the
 * project's space order, plus a trailing "Unassigned" bucket when any
 * placement falls in no space. Value is the same list-price basis as
 * bomLines; parts missing from the catalog contribute $0 but still count.
 */
export function bomBySpace(
  placements: Array<{ sheetId: string; page: number; x: number; y: number; partId: string }>,
  parts: PartLite[],
  spaces: Array<SpaceLite & { name: string }>
): SpaceRollup[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const buckets = new Map<string | null, SpaceRollup>();
  for (const s of spaces) buckets.set(s.id, { spaceId: s.id, name: s.name, count: 0, value: 0 });
  const unassigned: SpaceRollup = { spaceId: null, name: "Unassigned", count: 0, value: 0 };
  for (const pl of placements) {
    const home = spaceOf(pl, spaces);
    const bucket = home ? buckets.get(home.id)! : unassigned;
    bucket.count += 1;
    bucket.value += byId.get(pl.partId)?.list || 0;
  }
  const out = [...buckets.values()].filter((b) => b.count > 0);
  if (unassigned.count > 0) out.push(unassigned);
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
  placements: Array<{ partId: string }>,
  parts: PartLite[]
): { value: number; cost: number; margin: number } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let value = 0;
  let cost = 0;
  for (const pl of placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    value += part.list;
    cost += part.cost;
  }
  return { value, cost, margin: value > 0 ? (value - cost) / value : 0 };
}
