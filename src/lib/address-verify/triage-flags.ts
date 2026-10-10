/**
 * Morning triage's visit-flag provider for spec 1 (TRIAGE_HOOKS.visitFlags):
 * today's visits whose address isn't verified carry the drive-time flag,
 * verbatim. Cache mode only (place book + stored venue stamps) — triage never
 * geocodes; an address no one has checked yet reads as not verified, exactly
 * as the drive planner treats it.
 */
import { getVisit, type SiteVisit } from "@/lib/stores/site-visits";
import { addressStatesForVisits, type VisitAddressInput } from "./targets";
import type { AddressState } from "./types";

export const UNVERIFIED_VISIT_FLAG = "Address not verified — no drive time";

export type VisitFlagDeps = {
  getVisits: (ids: readonly string[]) => Promise<SiteVisit[]>;
  states: (visits: VisitAddressInput[]) => Promise<Map<string, AddressState>>;
};

function defaultDeps(): VisitFlagDeps {
  return {
    getVisits: async (ids) => (await Promise.all(ids.map((id) => getVisit(id)))).filter((v): v is SiteVisit => !!v),
    states: (visits) => addressStatesForVisits(visits, "cache"),
  };
}

export async function unverifiedVisitFlags(
  visitIds: readonly string[],
  _now: number,
  deps?: Partial<VisitFlagDeps>
): Promise<ReadonlyMap<string, readonly string[]>> {
  const out = new Map<string, readonly string[]>();
  const ids = [...new Set(visitIds.filter((id) => typeof id === "string" && id))];
  if (!ids.length) return out;
  const d = { ...defaultDeps(), ...deps };
  // A lookup failure drops the flags, never the visits: the triage feed runs
  // under allSettled, so a throw here would hide today's visits entirely.
  try {
    const visits = await d.getVisits(ids);
    const states = await d.states(
      visits.map((v) => ({ id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address }))
    );
    for (const v of visits) {
      const s = states.get(v.id);
      if (!s || s.status !== "verified" || !s.point) out.set(v.id, [UNVERIFIED_VISIT_FLAG]);
    }
  } catch (err) {
    console.error("[drive-time] triage visit flags failed", err);
    return new Map<string, readonly string[]>();
  }
  return out;
}
