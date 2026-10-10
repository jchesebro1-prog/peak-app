/**
 * Conduit riser (#321) — what still exists in a Grid project, per design
 * option: the ids `pruneConduitRiser` keeps. Shared by the store (every
 * conduit riser write prunes first), the plan writes that delete things
 * (removePlacement, removeRoute, removeSpace, …) and the server loader, so
 * all three agree on what a run may still point at. Pure — structural
 * types only, never a store import.
 */

import { DEFAULT_OPTION_ID } from "@/lib/design/grid-options";
import { normalizeRiserDoc } from "@/lib/design/grid-riser-doc";
import { normalizeConduitRiserDoc, pairKey, pruneConduitRiser, type ConduitRiserDoc, type LiveIds } from "./model";

type LivePlacement = { id: string; optionId?: string; curtain?: unknown };
type LiveRoute = { id: string; optionId?: string; fromPlacementId?: string; toPlacementId?: string };

export type ConduitLiveDoc = {
  options?: ReadonlyArray<{ id: string }>;
  placements?: ReadonlyArray<LivePlacement>;
  routes?: ReadonlyArray<LiveRoute>;
  spaces?: ReadonlyArray<{ id: string }>;
  levels?: ReadonlyArray<{ id: string }>;
  riser?: Record<string, unknown>;
  conduitRiser?: Record<string, unknown>;
};

/** The project's option ids, first first — a pre-options doc has the default one. */
export function liveOptionIds(p: Pick<ConduitLiveDoc, "options">): string[] {
  return p.options && p.options.length ? p.options.map((o) => o.id) : [DEFAULT_OPTION_ID];
}

/** A member's option, read the way ensureOptions files it (untagged or unknown → the first option). */
function memberOf(optionIds: readonly string[]): (m: { optionId?: string }) => string {
  const known = new Set(optionIds);
  return (m) => (m.optionId && known.has(m.optionId) ? m.optionId : optionIds[0]);
}

const endsKey = (a: string | undefined, b: string | undefined) => (a && b && a !== b ? pairKey(a, b) : null);

/**
 * Live ids for one option. Devices are the option's non-curtain placements
 * (a curtain never takes a riser tag or a conduit). Links are the option's
 * typed-length RiserLinks (#209). `wireEnds` holds each live wire's device
 * pair, so a member wire re-snapped to other devices leaves its run.
 */
export function conduitLiveIds(p: ConduitLiveDoc, optionId: string): LiveIds {
  const optionOf = memberOf(liveOptionIds(p));
  const placementIds = new Set((p.placements || []).filter((pl) => optionOf(pl) === optionId && !pl.curtain).map((pl) => pl.id));
  const wireEnds = new Map<string, string | null>();
  const routeIds = new Set<string>();
  for (const r of p.routes || []) {
    if (optionOf(r) !== optionId) continue;
    routeIds.add(r.id);
    wireEnds.set(`route:${r.id}`, endsKey(r.fromPlacementId, r.toPlacementId));
  }
  const linkIds = new Set<string>();
  for (const l of normalizeRiserDoc(p.riser?.[optionId]).links) {
    linkIds.add(l.id);
    const a = l.from.kind === "placement" ? l.from.placementId : undefined;
    const b = l.to.kind === "placement" ? l.to.placementId : undefined;
    wireEnds.set(`link:${l.id}`, endsKey(a, b));
  }
  return {
    placementIds,
    routeIds,
    linkIds,
    spaceIds: new Set((p.spaces || []).map((s) => s.id)),
    levelIds: new Set((p.levels || []).map((l) => l.id)),
    wireEnds,
  };
}

/** One option's stored document, normalized and pruned against the live plan. */
export function liveConduitRiser(p: ConduitLiveDoc, optionId: string): ConduitRiserDoc {
  return pruneConduitRiser(normalizeConduitRiserDoc(p.conduitRiser?.[optionId]), conduitLiveIds(p, optionId));
}

/**
 * Prune every option's conduit riser IN PLACE on a doc a patch is holding —
 * run after any plan write that can delete a device, wire, link, space or
 * level. A key for an option that no longer exists is dropped. No-op when
 * the design has no conduit riser.
 */
export function pruneConduitRisersIn(p: ConduitLiveDoc): void {
  if (!p.conduitRiser) return;
  const live = new Set(liveOptionIds(p));
  const out: Record<string, ConduitRiserDoc> = {};
  for (const k of Object.keys(p.conduitRiser)) if (live.has(k)) out[k] = liveConduitRiser(p, k);
  p.conduitRiser = out;
}
