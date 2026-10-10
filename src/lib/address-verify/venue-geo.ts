/**
 * One-time, idempotent venue backfill (spec 2026-10-09): stamps
 * sites.geo_status on every row that has none, by backfillStatus (usable
 * lat/lng + a house number → verified, lat/lng without one → needs_check,
 * no usable lat/lng → unresolved). Touches only NULL rows, so a second run
 * is a no-op; leaves updatedAt alone (metadata stamp, not an edit). Called by
 * the worklist, the drive loader's cron rider and anything that filters on
 * geo_status in SQL.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { backfillStatus } from "./state";
import type { GeoStatus } from "./types";

export async function ensureVenueGeoStatus(opts?: { limit?: number }): Promise<{ stamped: number }> {
  const db = await getDb();
  const rows = await db
    .select({ id: sites.id, address: sites.address, lat: sites.lat, lng: sites.lng })
    .from(sites)
    .where(isNull(sites.geoStatus))
    .limit(opts?.limit ?? 5000);
  const byStatus = new Map<GeoStatus, string[]>();
  for (const r of rows) {
    const s = backfillStatus(r);
    const list = byStatus.get(s) ?? [];
    list.push(r.id);
    byStatus.set(s, list);
  }
  let stamped = 0;
  for (const [status, ids] of byStatus) {
    for (let i = 0; i < ids.length; i += 500) {
      const done = await db
        .update(sites)
        .set({ geoStatus: status, geoSource: status === "unresolved" ? null : "geocode" })
        .where(and(inArray(sites.id, ids.slice(i, i + 500)), isNull(sites.geoStatus)))
        .returning({ id: sites.id });
      stamped += done.length;
    }
  }
  return { stamped };
}
