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
import type { DrawingSystemKey } from "@/lib/design/grid-scopes";
import {
  CR_CAPS,
  normalizeConduitRiserDoc,
  pairKey,
  pruneConduitRiser,
  runPairKey,
  type ConduitRiserDoc,
  type ConduitRiserSystem,
  type ConduitRun,
  type Dismissal,
  type LiveIds,
  type TagPos,
} from "./model";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

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
  avRiser?: Record<string, unknown>;
};

/**
 * #328: the conduit risers a design option can carry, one storage field per
 * system. EVERY carry / prune / copy / restore / delete-undo / remove-option
 * path iterates this list, so a third system is one row. The field is
 * authoritative for the system: a doc is always read and written with the
 * system of the field it sits in (`storedConduitRiser`), never its own.
 */
export const CONDUIT_RISER_FIELDS = [
  { system: "lighting", field: "conduitRiser" },
  { system: "av", field: "avRiser" },
] as const satisfies ReadonlyArray<{ system: ConduitRiserSystem; field: keyof ConduitLiveDoc }>;

export type ConduitRiserField = (typeof CONDUIT_RISER_FIELDS)[number]["field"];

/** The storage field a system's riser lives in. */
export function conduitRiserField(system: ConduitRiserSystem): ConduitRiserField {
  return CONDUIT_RISER_FIELDS.find((f) => f.system === system)!.field;
}

/** The riser a drawing system's devices and wires belong on (#328): lighting
 *  → the lighting control riser, audio | video → the A/V conduit riser,
 *  anything else → none. */
export function riserSystemOf(key: DrawingSystemKey): ConduitRiserSystem | null {
  return key === "lighting" ? "lighting" : key === "audio" || key === "video" ? "av" : null;
}

/**
 * One stored document read as `system`'s riser: the field's system is
 * stamped over whatever the doc says before it's normalized, so a doc
 * carried into the wrong field (or a missing one) never reads as the other
 * system. Missing / malformed → that system's empty doc.
 */
export function normalizeStoredRiser(raw: unknown, system: ConduitRiserSystem): ConduitRiserDoc {
  return normalizeConduitRiserDoc(isObj(raw) ? { ...raw, system } : undefined, system);
}

/** One option's stored (unpruned) document in `system`'s field, normalized. */
export function storedConduitRiser(p: ConduitLiveDoc, optionId: string, system: ConduitRiserSystem): ConduitRiserDoc {
  return normalizeStoredRiser(p[conduitRiserField(system)]?.[optionId], system);
}

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

/** One option's stored document in `system`'s field (#328), normalized and
 *  pruned against the live plan. */
export function liveConduitRiser(p: ConduitLiveDoc, optionId: string, system: ConduitRiserSystem): ConduitRiserDoc {
  return pruneConduitRiser(storedConduitRiser(p, optionId, system), conduitLiveIds(p, optionId));
}

/**
 * Prune every option's conduit risers IN PLACE on a doc a patch is holding —
 * run after any plan write that can delete a device, wire, link, space or
 * level. Every system's field (#328, CONDUIT_RISER_FIELDS); a key for an
 * option that no longer exists is dropped. No-op for a field the design
 * doesn't have.
 */
export function pruneConduitRisersIn(p: ConduitLiveDoc): void {
  const live = new Set(liveOptionIds(p));
  for (const { system, field } of CONDUIT_RISER_FIELDS) {
    const stored = p[field];
    if (!stored) continue;
    const out: Record<string, ConduitRiserDoc> = {};
    for (const k of Object.keys(stored)) if (live.has(k)) out[k] = liveConduitRiser(p, k, system);
    p[field] = out;
  }
}

/** Deep copy of every system's stored risers — what removePlacements holds
 *  before it prunes, to diff with conduitRemovedAll. */
export function conduitRisersSnapshot(p: ConduitLiveDoc): Partial<Record<ConduitRiserField, Record<string, unknown>>> {
  const out: Partial<Record<ConduitRiserField, Record<string, unknown>>> = {};
  for (const { field } of CONDUIT_RISER_FIELDS) {
    const stored = p[field];
    if (stored) out[field] = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
  }
  return out;
}

/** What a batch delete took out of each option's conduit riser — what undo
 *  hands back to restoreConduitItems (the RiserRemoved idiom, #299). */
export type ConduitRemoved = Record<string, { runs: ConduitRun[]; tags: Record<string, TagPos>; dismissed: Dismissal[] }>;

/** #328: the same, per riser system. Systems with nothing removed are omitted. */
export type ConduitRemovedBySystem = Partial<Record<ConduitRiserSystem, ConduitRemoved>>;

/** Per option: the runs (by id), pinned tags (by device) and dismissals (by
 *  pair) in `before` but not `after`. Options with nothing removed are
 *  omitted. Both sides read as `system`'s riser. */
export function conduitRemovedBetween(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  system: ConduitRiserSystem
): ConduitRemoved {
  const out: ConduitRemoved = {};
  for (const k of Object.keys(before || {})) {
    const b = normalizeStoredRiser(before![k], system);
    const a = normalizeStoredRiser(after?.[k], system);
    const runIds = new Set(a.runs.map((r) => r.id));
    const dismissedKeys = new Set(a.dismissed.map((d) => d.key));
    const runs = b.runs.filter((r) => !runIds.has(r.id));
    const tags = Object.fromEntries(Object.entries(b.tags).filter(([id]) => !Object.prototype.hasOwnProperty.call(a.tags, id)));
    const dismissed = b.dismissed.filter((d) => !dismissedKeys.has(d.key));
    if (runs.length || Object.keys(tags).length || dismissed.length) out[k] = { runs, tags, dismissed };
  }
  return out;
}

/** #328: conduitRemovedBetween for every system — `before` from
 *  conduitRisersSnapshot, `after` the doc once pruned. */
export function conduitRemovedAll(before: Partial<Record<ConduitRiserField, Record<string, unknown>>>, after: ConduitLiveDoc): ConduitRemovedBySystem {
  const out: ConduitRemovedBySystem = {};
  for (const { system, field } of CONDUIT_RISER_FIELDS) {
    const removed = conduitRemovedBetween(before[field], after[field], system);
    if (Object.keys(removed).length) out[system] = removed;
  }
  return out;
}

/** Conduit run ids as the store mints them — what a restored run must carry. */
const RUN_ID = /^cr-[0-9a-f]{12}$/;

/**
 * Undo of a batch delete (#321): put back the conduit runs, pinned tags and
 * dismissals `raw` names, IN PLACE on a doc a patch is holding, AFTER the
 * placements are back. `raw` came back from the CLIENT, so it is untrusted:
 * only live option keys; every item rebuilt through the stored-doc
 * normalizer against the option's current details and stubs; a run only
 * with a store-shaped `cr-` id; every device it names must be a non-curtain
 * device of THAT option (a stub end must name a stub that still exists);
 * nothing already present comes back twice (run id, a pair that already
 * has a run, tag device, dismissal pair) — two runs the bundle carries for
 * one pair both come back. A wire belongs to one riser's conduit (#328): a
 * member wire already inside a run on another riser of that option is
 * stripped from the restored run (the run itself still comes back). Ends
 * with pruneConduitRisersIn — normalized and capped.
 */
export function restoreConduitItems(p: ConduitLiveDoc, raw: unknown, system: ConduitRiserSystem): void {
  if (!isObj(raw)) return;
  const field = conduitRiserField(system);
  const optionIds = liveOptionIds(p);
  const live = new Set(optionIds);
  const optionOf = memberOf(optionIds);
  const owner = new Map((p.placements || []).filter((pl) => !pl.curtain).map((pl) => [pl.id, optionOf(pl)]));
  let touched = false;
  for (const k of Object.keys(raw)) {
    if (!live.has(k) || !isObj(raw[k])) continue;
    const entry = raw[k] as Record<string, unknown>;
    const own = (id: string) => owner.get(id) === k;
    const current = storedConduitRiser(p, k, system);
    const asked = normalizeStoredRiser({
      details: current.details,
      stubs: current.stubs,
      runs: Array.isArray(entry.runs) ? entry.runs.slice(0, CR_CAPS.runs) : [],
      tags: isObj(entry.tags) ? Object.fromEntries(Object.entries(entry.tags).slice(0, CR_CAPS.tags)) : {},
      dismissed: Array.isArray(entry.dismissed) ? entry.dismissed.slice(0, CR_CAPS.dismissed) : [],
    }, system);
    const runIds = new Set(current.runs.map((r) => r.id));
    // Pairs are checked only against runs that were already there: a pair
    // that had two runs when it was deleted gets both back (#321 final
    // review). Run ids still dedupe within the bundle.
    const pairs = new Set(current.runs.map(runPairKey).filter((x): x is string => !!x));
    // #328: the wires the option's other risers already carry, as they stand now.
    const otherRuns = CONDUIT_RISER_FIELDS.filter((f) => f.system !== system).flatMap((f) => liveConduitRiser(p, k, f.system).runs);
    const otherRoutes = new Set(otherRuns.flatMap((r) => r.routeIds));
    const otherLinks = new Set(otherRuns.flatMap((r) => r.linkIds));
    const runs: ConduitRun[] = [];
    for (const r of asked.runs) {
      const pair = runPairKey(r);
      const endsOwn = [r.a, r.b].every((e) => e.kind === "stub" || own(e.placementId));
      if (!RUN_ID.test(r.id) || runIds.has(r.id) || (pair && pairs.has(pair)) || !endsOwn) continue;
      runs.push({ ...r, routeIds: r.routeIds.filter((id) => !otherRoutes.has(id)), linkIds: r.linkIds.filter((id) => !otherLinks.has(id)) });
      runIds.add(r.id);
    }
    const tags = Object.fromEntries(Object.entries(asked.tags).filter(([id]) => own(id) && !Object.prototype.hasOwnProperty.call(current.tags, id)));
    const haveKeys = new Set(current.dismissed.map((d) => d.key));
    const dismissed = asked.dismissed.filter((d) => !haveKeys.has(d.key) && d.key.split("|").every(own));
    if (!runs.length && !Object.keys(tags).length && !dismissed.length) continue;
    p[field] = {
      ...(p[field] || {}),
      [k]: { ...current, runs: [...current.runs, ...runs], tags: { ...current.tags, ...tags }, dismissed: [...current.dismissed, ...dismissed] },
    };
    touched = true;
  }
  if (touched) pruneConduitRisersIn(p);
}

const SYSTEM_KEYS = new Set<string>(CONDUIT_RISER_FIELDS.map((f) => f.system));

/**
 * #328: undo's conduit half, per system — `{ lighting?: ConduitRemoved;
 * av?: ConduitRemoved }`. A bundle cut before #328 (still in a client's
 * undo stack) is the bare lighting-only shape, keyed by option id: option
 * ids are `opt-…`, never a system name, so a bundle whose keys are all
 * system names is the new shape and anything else is lighting's. Each
 * system restores through restoreConduitItems (untrusted, cleaned there).
 */
export function restoreConduitBundle(p: ConduitLiveDoc, raw: unknown): void {
  if (!isObj(raw)) return;
  const keys = Object.keys(raw);
  if (!keys.length) return;
  if (!keys.every((k) => SYSTEM_KEYS.has(k))) {
    restoreConduitItems(p, raw, "lighting");
    return;
  }
  for (const { system } of CONDUIT_RISER_FIELDS) if (isObj(raw[system])) restoreConduitItems(p, raw[system], system);
}
