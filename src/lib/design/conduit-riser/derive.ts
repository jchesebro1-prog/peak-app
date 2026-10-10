/**
 * Conduit riser (#321) — the derived view: which devices get a tag, which
 * detail each lands in, each detail's head end, each run's members and
 * signals, oriented head-end-first. Pure; no layout, no geometry.
 */

import { compareDetailN, pairKey, runPairKey, type ConduitRiserDoc, type ConduitRun, type RiserDetail, type RiserStub, type RunEnd } from "./model";
import type { CRDevice, CRLevel, CRSignal, CRWire, CRWireType } from "./input";
import { isOverfilled, overfillWarning, viewRunFill } from "./fill";

export type ViewEnd =
  | { kind: "tag"; id: string }
  | { kind: "stub"; id: string }
  /** The other end sits in another detail — drawn as "TO <label>". */
  | { kind: "ref"; key: string; label: string };

export type ViewRun = {
  run: ConduitRun;
  /** Oriented: `a` is the head-end side within the detail. */
  a: ViewEnd;
  b: ViewEnd;
  members: CRWire[];
  /** Unique by wire type, sorted by symbol. */
  signals: CRSignal[];
  /** Cables in it with no symbol (their bubble prints "?"). */
  unknownCables: string[];
  /** No member wires and not a stub run — a spare conduit. */
  empty: boolean;
};

export type ViewTag = { device: CRDevice; runCount: number };

export type ViewDetail = {
  detail: RiserDetail;
  tags: ViewTag[];
  stubs: RiserStub[];
  runs: ViewRun[];
  headEndId: string | null;
  /** Levels used in this detail, in `order`; plus a trailing unlevelled band. */
  levels: CRLevel[];
  hasUnlevelled: boolean;
};

export type CRView = { details: ViewDetail[]; warnings: string[] };

export type DeriveInput = {
  doc: ConduitRiserDoc;
  devices: readonly CRDevice[];
  wires: readonly CRWire[];
  levels: readonly CRLevel[];
  wireTypes: readonly CRWireType[];
};

export const UNLEVELLED_ID = "__unlevelled";

/** Does a member wire still join this run's two devices? (A stub run has no pair to check.) */
export function wireFits(run: ConduitRun, w: CRWire): boolean {
  const pair = runPairKey(run);
  return !pair || (!!w.from && !!w.to && pairKey(w.from, w.to) === pair);
}

/** Fixed locale so the browser editor and the server's DXF sort identically. */
export const byNumeric = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const byLabel = (a: CRDevice, b: CRDevice) => byNumeric(a.label, b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function deriveView(input: DeriveInput): CRView {
  const { doc } = input;
  const warnings: string[] = [];
  const deviceById = new Map(input.devices.map((d) => [d.id, d]));
  const wireByKey = new Map(input.wires.map((w) => [`${w.kind}:${w.id}`, w]));
  const wireTypeById = new Map(input.wireTypes.map((t) => [t.id, t]));
  const stubById = new Map(doc.stubs.map((s) => [s.id, s]));
  const levelById = new Map(input.levels.map((l) => [l.id, l]));
  const details = [...doc.details].sort((a, b) => compareDetailN(a.n, b.n) || a.id.localeCompare(b.id));

  const endLive = (e: RunEnd) => (e.kind === "placement" ? deviceById.has(e.placementId) : stubById.has(e.stubId));
  const runs = doc.runs.filter((r) => endLive(r.a) && endLive(r.b));

  // Who gets a tag.
  const tagged = new Set<string>();
  for (const r of runs) for (const e of [r.a, r.b]) if (e.kind === "placement") tagged.add(e.placementId);
  for (const d of input.devices) if (d.inSystem && d.typeKey && doc.alwaysShow.includes(d.typeKey)) tagged.add(d.id);

  // Which detail each lands in: the first (by number) covering its space.
  const detailOf = new Map<string, string>();
  for (const id of tagged) {
    const dev = deviceById.get(id)!;
    const hit = details.find((d) => d.allSpaces || (dev.spaceId !== null && d.spaceIds.includes(dev.spaceId)));
    if (hit) detailOf.set(id, hit.id);
    else warnings.push(`${dev.label} is in no detail — add its space to one`);
  }
  // A stub follows the device at its run's other end; a stub with no run
  // (or no tagged device) stays in its own detail.
  const stubDetail = new Map(doc.stubs.map((s) => [s.id, s.detailId]));
  for (const r of runs) {
    for (const [s, o] of [[r.a, r.b], [r.b, r.a]] as const) {
      if (s.kind === "stub" && o.kind === "placement" && detailOf.has(o.placementId)) stubDetail.set(s.stubId, detailOf.get(o.placementId)!);
    }
  }
  const endDetail = (e: RunEnd): string | null =>
    e.kind === "placement" ? detailOf.get(e.placementId) ?? null : stubDetail.get(e.stubId) ?? null;
  const endLabel = (e: RunEnd): string =>
    e.kind === "placement" ? deviceById.get(e.placementId)?.label ?? "?" : stubById.get(e.stubId)?.label ?? "?";

  const out: ViewDetail[] = [];
  const missing = new Set<string>();
  const fillWarned = new Set<string>();
  const fillWarnings: string[] = [];
  for (const detail of details) {
    const tagIds = [...tagged].filter((id) => detailOf.get(id) === detail.id);
    const stubs = doc.stubs.filter((s) => stubDetail.get(s.id) === detail.id);
    // A run is drawn in each detail one of its ends lives in; the far end
    // in another detail becomes a "TO <label>" ref.
    const local = runs.filter((r) => endDetail(r.a) === detail.id || endDetail(r.b) === detail.id);
    const toView = (e: RunEnd, other: RunEnd): ViewEnd => {
      // A stub already reads "TO …"; a device in another detail becomes "TO <ID>".
      if (endDetail(e) !== detail.id) return { kind: "ref", key: `${detail.id}:${endLabel(e)}:${endLabel(other)}`, label: e.kind === "stub" ? endLabel(e) : `TO ${endLabel(e)}` };
      return e.kind === "placement" ? { kind: "tag", id: e.placementId } : { kind: "stub", id: e.stubId };
    };

    const runCount = new Map<string, number>();
    for (const r of local) for (const e of [r.a, r.b]) if (e.kind === "placement" && detailOf.get(e.placementId) === detail.id) runCount.set(e.placementId, (runCount.get(e.placementId) || 0) + 1);
    const tags: ViewTag[] = tagIds.map((id) => ({ device: deviceById.get(id)!, runCount: runCount.get(id) || 0 }));
    tags.sort((x, y) => byLabel(x.device, y.device));

    // Head end: most runs; ties → racks first, then designator.
    let head: ViewTag | null = null;
    for (const t of tags) {
      if (t.runCount === 0) continue;
      if (!head) { head = t; continue; }
      const rack = (v: ViewTag) => (v.device.typeKey === "racks-cases" ? 1 : 0);
      if (t.runCount > head.runCount || (t.runCount === head.runCount && rack(t) > rack(head))) head = t;
    }
    const headEndId = head ? head.device.id : null;

    // Hop distance from the head end (BFS), to orient each run.
    const dist = new Map<string, number>();
    const endKey = (e: RunEnd) => (e.kind === "placement" ? `p:${e.placementId}` : `s:${e.stubId}`);
    if (headEndId) {
      dist.set(`p:${headEndId}`, 0);
      const queue = [`p:${headEndId}`];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const r of local) {
          const [x, y] = [endKey(r.a), endKey(r.b)];
          const next = x === cur ? y : y === cur ? x : null;
          if (next && !dist.has(next)) {
            dist.set(next, dist.get(cur)! + 1);
            queue.push(next);
          }
        }
      }
    }

    const viewRuns: ViewRun[] = local.map((run) => {
      let a = run.a;
      let b = run.b;
      const da = dist.get(endKey(a)) ?? Infinity;
      const db = dist.get(endKey(b)) ?? Infinity;
      if (db < da) [a, b] = [b, a];
      // A member re-snapped to other devices no longer belongs to this conduit.
      const members = [
        ...run.routeIds.map((id) => wireByKey.get(`route:${id}`)),
        ...run.linkIds.map((id) => wireByKey.get(`link:${id}`)),
      ].filter((w): w is CRWire => !!w && wireFits(run, w));
      const sig = new Map<string, CRSignal>();
      const unknown = new Set<string>();
      for (const w of members) {
        if (w.signal) sig.set(w.signal.wireTypeId, w.signal);
        else unknown.add(w.cable);
      }
      for (const id of run.signals || []) {
        const t = wireTypeById.get(id);
        if (t && t.symbol) sig.set(t.id, { wireTypeId: t.id, symbol: t.symbol, signal: t.signal });
      }
      unknown.forEach((c) => missing.add(c));
      // #328 B2: an overfilled conduit is a warning (editor list only) — never a block. A run in two details warns once.
      const fill = viewRunFill({ run, members });
      if (isOverfilled(fill) && !fillWarned.has(run.id)) {
        fillWarned.add(run.id);
        fillWarnings.push(overfillWarning(endLabel(run.a), endLabel(run.b), run.size, fill));
      }
      const stubRun = run.a.kind === "stub" || run.b.kind === "stub";
      return {
        run,
        a: toView(a, b),
        b: toView(b, a),
        members,
        signals: [...sig.values()].sort((x, y) => x.symbol.localeCompare(y.symbol) || x.wireTypeId.localeCompare(y.wireTypeId)),
        unknownCables: [...unknown].sort(),
        empty: members.length === 0 && !stubRun,
      };
    });
    viewRuns.sort((x, y) => x.run.id.localeCompare(y.run.id));

    const usedLevels = new Set<string>();
    let hasUnlevelled = false;
    for (const t of tags) {
      if (t.device.levelId && levelById.has(t.device.levelId)) usedLevels.add(t.device.levelId);
      else hasUnlevelled = true;
    }
    const levels = input.levels.filter((l) => usedLevels.has(l.id)).sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
    if (!tags.length && (stubs.length || viewRuns.length)) hasUnlevelled = true;
    out.push({ detail, tags, stubs, runs: viewRuns, headEndId, levels, hasUnlevelled });
  }
  // Symbols only matter when bubbles / the wire legend print.
  if (doc.showSignals !== false) for (const c of [...missing].sort()) warnings.push(`${c} has no signal symbol — set it in Settings → Wire types`);
  warnings.push(...fillWarnings);
  return { details: out, warnings };
}
