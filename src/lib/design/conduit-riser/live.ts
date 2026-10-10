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
import {
  CR_CAPS,
  normalizeConduitRiserDoc,
  pairKey,
  pruneConduitRiser,
  runPairKey,
  type ConduitRiserDoc,
  type ConduitRun,
  type Dismissal,
  type LiveIds,
  type TagPos,
} from "./model";

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

/** What a batch delete took out of each option's conduit riser — what undo
 *  hands back to restoreConduitItems (the RiserRemoved idiom, #299). */
export type ConduitRemoved = Record<string, { runs: ConduitRun[]; tags: Record<string, TagPos>; dismissed: Dismissal[] }>;

/** Per option: the runs (by id), pinned tags (by device) and dismissals (by
 *  pair) in `before` but not `after`. Options with nothing removed are omitted. */
export function conduitRemovedBetween(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): ConduitRemoved {
  const out: ConduitRemoved = {};
  for (const k of Object.keys(before || {})) {
    const b = normalizeConduitRiserDoc(before![k]);
    const a = normalizeConduitRiserDoc(after?.[k]);
    const runIds = new Set(a.runs.map((r) => r.id));
    const dismissedKeys = new Set(a.dismissed.map((d) => d.key));
    const runs = b.runs.filter((r) => !runIds.has(r.id));
    const tags = Object.fromEntries(Object.entries(b.tags).filter(([id]) => !Object.prototype.hasOwnProperty.call(a.tags, id)));
    const dismissed = b.dismissed.filter((d) => !dismissedKeys.has(d.key));
    if (runs.length || Object.keys(tags).length || dismissed.length) out[k] = { runs, tags, dismissed };
  }
  return out;
}

/** Conduit run ids as the store mints them — what a restored run must carry. */
const RUN_ID = /^cr-[0-9a-f]{12}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Undo of a batch delete (#321): put back the conduit runs, pinned tags and
 * dismissals `raw` names, IN PLACE on a doc a patch is holding, AFTER the
 * placements are back. `raw` came back from the CLIENT, so it is untrusted:
 * only live option keys; every item rebuilt through the stored-doc
 * normalizer against the option's current details and stubs; a run only
 * with a store-shaped `cr-` id; every device it names must be a non-curtain
 * device of THAT option (a stub end must name a stub that still exists);
 * nothing already present comes back twice (run id, run pair, tag device,
 * dismissal pair). Ends with pruneConduitRisersIn — normalized and capped.
 */
export function restoreConduitItems(p: ConduitLiveDoc, raw: unknown): void {
  if (!isObj(raw)) return;
  const optionIds = liveOptionIds(p);
  const live = new Set(optionIds);
  const optionOf = memberOf(optionIds);
  const owner = new Map((p.placements || []).filter((pl) => !pl.curtain).map((pl) => [pl.id, optionOf(pl)]));
  let touched = false;
  for (const k of Object.keys(raw)) {
    if (!live.has(k) || !isObj(raw[k])) continue;
    const entry = raw[k] as Record<string, unknown>;
    const own = (id: string) => owner.get(id) === k;
    const current = normalizeConduitRiserDoc(p.conduitRiser?.[k]);
    const asked = normalizeConduitRiserDoc({
      details: current.details,
      stubs: current.stubs,
      runs: Array.isArray(entry.runs) ? entry.runs.slice(0, CR_CAPS.runs) : [],
      tags: isObj(entry.tags) ? Object.fromEntries(Object.entries(entry.tags).slice(0, CR_CAPS.tags)) : {},
      dismissed: Array.isArray(entry.dismissed) ? entry.dismissed.slice(0, CR_CAPS.dismissed) : [],
    });
    const runIds = new Set(current.runs.map((r) => r.id));
    const pairs = new Set(current.runs.map(runPairKey).filter((x): x is string => !!x));
    const runs: ConduitRun[] = [];
    for (const r of asked.runs) {
      const pair = runPairKey(r);
      const endsOwn = [r.a, r.b].every((e) => e.kind === "stub" || own(e.placementId));
      if (!RUN_ID.test(r.id) || runIds.has(r.id) || (pair && pairs.has(pair)) || !endsOwn) continue;
      runs.push(r);
      runIds.add(r.id);
      if (pair) pairs.add(pair);
    }
    const tags = Object.fromEntries(Object.entries(asked.tags).filter(([id]) => own(id) && !Object.prototype.hasOwnProperty.call(current.tags, id)));
    const haveKeys = new Set(current.dismissed.map((d) => d.key));
    const dismissed = asked.dismissed.filter((d) => !haveKeys.has(d.key) && d.key.split("|").every(own));
    if (!runs.length && !Object.keys(tags).length && !dismissed.length) continue;
    p.conduitRiser = {
      ...(p.conduitRiser || {}),
      [k]: { ...current, runs: [...current.runs, ...runs], tags: { ...current.tags, ...tags }, dismissed: [...current.dismissed, ...dismissed] },
    };
    touched = true;
  }
  if (touched) pruneConduitRisersIn(p);
}
