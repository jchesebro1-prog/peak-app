/**
 * Travel for MANY places in a fixed number of queries (#176, D229) — the
 * punch-#90 travelForCustomerVenues pattern generalised to any list, so the
 * Venues and Companies directories can show a drive column for ~1,500 rows
 * without a query per row: offices + travel rates once, one routeCachedBulk
 * for every distinct origin→place key, then estimateFromParts per place.
 *
 * Measured from the QUOTE ORIGIN (Settings → Locations), with coordinates
 * resolved by coordsOf() — the same rules every other travel number in the
 * app uses. Reads only the route cache; it never calls OSRM.
 */
import {
  coordsOf,
  estimateFromParts,
  hasCoords,
  officesFromSettings,
  quoteOrigin,
  routeCachedBulk,
  routeKey,
} from "@/lib/geo";
import { getTravelRates } from "@/lib/stores/pricing";
import type { Drive } from "@/lib/drive-format";

export type TravelPoint = {
  id: string;
  lat?: number | string | null;
  lng?: number | string | null;
  city?: string | null;
  state?: string | null;
  travelMiles?: number | string | null;
  travelMin?: number | string | null;
};

export async function travelForPoints(
  points: TravelPoint[]
): Promise<{ originName: string | null; byId: Map<string, Drive> }> {
  const byId = new Map<string, Drive>();
  if (!points.length) return { originName: null, byId };
  const [offices, rates] = await Promise.all([officesFromSettings(), getTravelRates()]);
  const origin = quoteOrigin(offices);
  const office = origin && hasCoords(origin) ? origin : null;

  // #176 fix 4 — with no quote origin, every cell reads "—" (spec §2.1),
  // including a manual travelMiles override: estimateFromParts() would
  // otherwise honor the override even with a null office, which is right
  // for a single quote's manual entry but wrong for a directory column that
  // promises "measured from the quote origin."
  if (!office) {
    for (const p of points) byId.set(p.id, { miles: null, minutes: null, source: "none" });
    return { originName: null, byId };
  }

  const targets = points.map((p) => {
    const c = coordsOf(p);
    return { id: p.id, target: c ? { ...p, lat: c.lat, lng: c.lng } : p };
  });
  const keyOf = (t: TravelPoint) => (office && hasCoords(t) ? routeKey(office, t) : null);
  const keys = Array.from(
    new Set(targets.map((t) => keyOf(t.target)).filter((k): k is string => k != null))
  );
  const cache = await routeCachedBulk(keys);

  for (const t of targets) {
    const k = keyOf(t.target);
    const est = estimateFromParts(office, t.target, rates, k ? cache.get(k) ?? null : null);
    byId.set(t.id, { miles: est.miles, minutes: est.minutes, source: est.source });
  }
  return { originName: office ? office.name || "the quote origin" : null, byId };
}
