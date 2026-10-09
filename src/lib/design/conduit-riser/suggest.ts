/**
 * Conduit riser (#321) — plan → riser suggestions.
 *
 * A plan wire (route or RiserLink) joining two devices, in the riser's
 * system, suggests a run between them. Wires joining the same pair merge
 * into one suggestion. A pair that already has a run suggests "joins run"
 * for any wire not yet inside it. Dismissing hides a pair until a wire the
 * dismissal didn't see appears. Pure.
 */

import { CR_CAPS, pairKey, runPairKey, type ConduitRiserDoc, type ConduitRun, type MakeId } from "./model";
import type { CRWire } from "./input";
import { wireFits } from "./derive";

export type Suggestion = {
  key: string;
  /** Device ends, from the first wire of the pair (its from/to). */
  a: string;
  b: string;
  routeIds: string[];
  linkIds: string[];
  kind: "new" | "join";
  /** The existing run a "join" adds to. */
  runId?: string;
};

export type SuggestResult = {
  items: Suggestion[];
  /** In-system wires not snapped to two different devices — "Show on plan". */
  loose: string[];
};

/** Every wire id already inside some run, by kind. With `wires`, a member
 *  re-snapped to other devices doesn't count — it's suggestible again. */
function claimed(doc: ConduitRiserDoc, wires?: readonly CRWire[]): { routes: Set<string>; links: Set<string> } {
  const byKey = wires ? new Map(wires.map((w) => [`${w.kind}:${w.id}`, w])) : null;
  const fits = (r: ConduitRun, key: string) => {
    const w = byKey?.get(key);
    return !byKey || !w || wireFits(r, w);
  };
  const routes = new Set<string>();
  const links = new Set<string>();
  for (const r of doc.runs) {
    r.routeIds.forEach((id) => fits(r, `route:${id}`) && routes.add(id));
    r.linkIds.forEach((id) => fits(r, `link:${id}`) && links.add(id));
  }
  return { routes, links };
}

export function suggestions(doc: ConduitRiserDoc, wires: readonly CRWire[]): SuggestResult {
  const taken = claimed(doc, wires);
  const loose: string[] = [];
  const groups = new Map<string, { a: string; b: string; routeIds: string[]; linkIds: string[] }>();
  for (const w of wires) {
    if (!w.inSystem) continue;
    if (!w.from || !w.to || w.from === w.to) {
      if (w.kind === "route") loose.push(w.id);
      continue;
    }
    if (w.kind === "route" ? taken.routes.has(w.id) : taken.links.has(w.id)) continue;
    const key = pairKey(w.from, w.to);
    const g = groups.get(key) || { a: w.from, b: w.to, routeIds: [], linkIds: [] };
    (w.kind === "route" ? g.routeIds : g.linkIds).push(w.id);
    groups.set(key, g);
  }
  const runByKey = new Map<string, ConduitRun>();
  for (const r of doc.runs) {
    const k = runPairKey(r);
    if (k && !runByKey.has(k)) runByKey.set(k, r);
  }
  const items: Suggestion[] = [];
  for (const [key, g] of groups) {
    const run = runByKey.get(key);
    if (run) {
      items.push({ key, a: g.a, b: g.b, routeIds: g.routeIds, linkIds: g.linkIds, kind: "join", runId: run.id });
      continue;
    }
    const dis = doc.dismissed.find((d) => d.key === key);
    if (dis && [...g.routeIds, ...g.linkIds].every((id) => dis.ids.includes(id))) continue;
    items.push({ key, a: g.a, b: g.b, routeIds: g.routeIds, linkIds: g.linkIds, kind: "new" });
  }
  items.sort((x, y) => x.key.localeCompare(y.key));
  return { items, loose: [...loose].sort() };
}

const union = (a: readonly string[], b: readonly string[], max: number) => [...new Set([...a, ...b])].slice(0, max);
const arrOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 100) : []);

/**
 * Accept one suggestion, pure and idempotent: a wire already in any run is
 * never added twice; a "new" whose pair gained a run meanwhile joins it.
 * Clears the pair's dismissal.
 */
export function acceptSuggestion(
  doc: ConduitRiserDoc,
  s: Suggestion,
  makeId: MakeId,
  /** Live device ids — a suggestion naming anything else is refused. */
  placementIds?: ReadonlySet<string>
): { doc: ConduitRiserDoc; changed: boolean } {
  const same = { doc, changed: false };
  if (typeof s.a !== "string" || typeof s.b !== "string" || !s.a || s.a === s.b || s.key !== pairKey(s.a, s.b)) return same;
  if (placementIds && (!placementIds.has(s.a) || !placementIds.has(s.b))) return same;
  const taken = claimed(doc);
  const routeIds = [...new Set(arrOf(s.routeIds))].filter((id) => !taken.routes.has(id)).slice(0, CR_CAPS.members);
  const linkIds = [...new Set(arrOf(s.linkIds))].filter((id) => !taken.links.has(id)).slice(0, CR_CAPS.members);
  if (!routeIds.length && !linkIds.length) return same;
  const dismissed = doc.dismissed.filter((d) => d.key !== s.key);
  const existing = doc.runs.find((r) => runPairKey(r) === s.key);
  if (existing) {
    const runs = doc.runs.map((r) =>
      r.id === existing.id
        ? { ...r, routeIds: union(r.routeIds, routeIds, CR_CAPS.members), linkIds: union(r.linkIds, linkIds, CR_CAPS.members) }
        : r
    );
    return { doc: { ...doc, runs, dismissed }, changed: true };
  }
  if (doc.runs.length >= CR_CAPS.runs) return same;
  const run: ConduitRun = {
    id: makeId("cr-"),
    a: { kind: "placement", placementId: s.a },
    b: { kind: "placement", placementId: s.b },
    routeIds,
    linkIds,
    size: doc.defaults.size,
    style: "conduit",
  };
  return { doc: { ...doc, runs: [...doc.runs, run], dismissed }, changed: true };
}

/** Hide a pair until a wire this dismissal didn't see is drawn. */
export function dismissSuggestion(doc: ConduitRiserDoc, s: Suggestion): { doc: ConduitRiserDoc; changed: boolean } {
  if (s.kind !== "new") return { doc, changed: false };
  const ids = [...s.routeIds, ...s.linkIds];
  const cur = doc.dismissed.find((d) => d.key === s.key);
  if (cur) {
    const next = union(cur.ids, ids, CR_CAPS.members);
    if (next.length === cur.ids.length) return { doc, changed: false };
    return { doc: { ...doc, dismissed: doc.dismissed.map((d) => (d.key === s.key ? { key: d.key, ids: next } : d)) }, changed: true };
  }
  if (doc.dismissed.length >= CR_CAPS.dismissed) return { doc, changed: false };
  return { doc: { ...doc, dismissed: [...doc.dismissed, { key: s.key, ids: ids.slice(0, CR_CAPS.members) }] }, changed: true };
}
