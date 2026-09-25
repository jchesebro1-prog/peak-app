/**
 * Companies map — pure, client-safe filtering for the map view's left rail
 * (Jeff's request: a hideable search/filter sidebar + a pop-out company
 * panel on the map). No store or runtime imports — this file is imported by
 * both the server page (to type the VM it ships once) and the client map
 * (to filter ~1,700 companies / ~1,300 venues in memory on every keystroke,
 * with no round trip).
 */

/** One located venue, flattened to the slim fields the map + rail need.
 *  Built once, server-side, from EVERY company's located venues (not the
 *  URL-filtered set) — map mode always ships the whole book and filters
 *  client-side. */
export type CompanyMapPoint = {
  companyId: string;
  locId: string;
  lat: number;
  lng: number;
  name: string;
  type: string;
  owner: string;
  /** Lifecycle stage, normalized: an absent/unknown value reads "none". */
  lifecycle: string;
  keywords: string[];
  venueLabel: string;
  city: string;
  state: string;
  /** Drive time/distance from the quote origin — null when unlocated, no
   *  origin is set, or the office has no coordinates (see travelForPoints). */
  driveMin: number | null;
  driveMiles: number | null;
  /** Open (draft+sent) quote value and total quote count for the COMPANY
   *  (same rollup as the list), repeated on every one of its points. */
  openValue: number;
  quoteCount: number;
  addedAt: number;
};

export type DriveBucket = "" | "30" | "60" | "120";

export type CompanyMapFilters = {
  q: string;
  /** "all" | a CUSTOMER_TYPES value */
  type: string;
  /** "all" | "mine" | a teammate name */
  owner: string;
  /** "all" | a Lifecycle value ("none" included) */
  lifecycle: string;
  /** "all" | a keyword/tag */
  tag: string;
  /** "" (Any) | "30" | "60" | "120" — max drive minutes */
  drive: DriveBucket;
  hasOpenQuotes: boolean;
};

export const EMPTY_MAP_FILTERS: CompanyMapFilters = {
  q: "",
  type: "all",
  owner: "all",
  lifecycle: "all",
  tag: "all",
  drive: "",
  hasOpenQuotes: false,
};

/** Whether any filter differs from the empty/default state — drives the
 *  rail's "Clear filters" enablement and the collapsed-rail badge. */
export function hasActiveMapFilters(f: CompanyMapFilters): boolean {
  return (
    !!f.q.trim() ||
    (f.type !== "all" && !!f.type) ||
    (f.owner !== "all" && !!f.owner) ||
    (f.lifecycle !== "all" && !!f.lifecycle) ||
    (f.tag !== "all" && !!f.tag) ||
    !!f.drive ||
    f.hasOpenQuotes
  );
}

function haystack(p: CompanyMapPoint): string {
  return (p.name + " " + p.venueLabel + " " + p.city + " " + p.state).toLowerCase();
}

/** Filter a company's points in memory. `meName` resolves owner:"mine". */
export function filterMapPoints(
  points: CompanyMapPoint[],
  filters: CompanyMapFilters,
  meName: string
): CompanyMapPoint[] {
  const ql = filters.q.trim().toLowerCase();
  const maxDrive = filters.drive ? Number(filters.drive) : null;
  return points.filter((p) => {
    if (filters.type !== "all" && filters.type && p.type !== filters.type) return false;
    if (filters.owner === "mine") {
      if (p.owner !== meName) return false;
    } else if (filters.owner !== "all" && filters.owner) {
      if (p.owner !== filters.owner) return false;
    }
    if (filters.lifecycle !== "all" && filters.lifecycle && p.lifecycle !== filters.lifecycle) return false;
    if (filters.tag !== "all" && filters.tag && !p.keywords.includes(filters.tag)) return false;
    if (maxDrive != null && !(p.driveMin != null && p.driveMin <= maxDrive)) return false;
    if (filters.hasOpenQuotes && !(p.openValue > 0)) return false;
    if (ql && !haystack(p).includes(ql)) return false;
    return true;
  });
}

export type CompanyMapListItem = {
  companyId: string;
  name: string;
  type: string;
  city: string;
  state: string;
  venueCount: number;
};

/** Collapse filtered points to one row per company for the rail's result
 *  list — first-seen city/state (a company's primary-ish venue), sorted by
 *  name. Pure aggregation; the map itself still renders every point. */
export function groupPointsByCompany(points: CompanyMapPoint[]): CompanyMapListItem[] {
  const order: string[] = [];
  const byId = new Map<string, CompanyMapListItem>();
  for (const p of points) {
    const hit = byId.get(p.companyId);
    if (hit) {
      hit.venueCount++;
      continue;
    }
    order.push(p.companyId);
    byId.set(p.companyId, {
      companyId: p.companyId,
      name: p.name,
      type: p.type,
      city: p.city,
      state: p.state,
      venueCount: 1,
    });
  }
  return order.map((id) => byId.get(id)!).sort((a, b) => a.name.localeCompare(b.name));
}

/** Unique, sorted option lists for the rail's selects — built from the FULL
 *  point set (not the filtered one), so a select never loses an option the
 *  user just filtered away. */
export function mapFilterOptions(points: CompanyMapPoint[]): {
  types: string[];
  tags: string[];
  hasDriveData: boolean;
} {
  const types = new Set<string>();
  const tags = new Set<string>();
  let hasDriveData = false;
  for (const p of points) {
    if (p.type) types.add(p.type);
    for (const k of p.keywords) tags.add(k);
    if (p.driveMin != null) hasDriveData = true;
  }
  return {
    types: Array.from(types).sort((a, b) => a.localeCompare(b)),
    tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
    hasDriveData,
  };
}
