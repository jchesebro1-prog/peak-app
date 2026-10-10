import { patchDoc } from "@/db/doc-store";
import { ensureOptions, hasOption } from "@/lib/design/grid-options";
import {
  CR_OP_NAMES,
  crMakeId,
  normalizeConduitRiserDoc,
  patchConduitRiser as applyConduitOp,
  pruneConduitRiser,
  type ConduitRiserDoc,
  type CROp,
  type MakeId,
} from "@/lib/design/conduit-riser/model";
import { acceptSuggestion, dismissSuggestion as dismissOne, suggestions } from "@/lib/design/conduit-riser/suggest";
import { conduitLiveIds, liveConduitRiser } from "@/lib/design/conduit-riser/live";
import { loadRiserPartsContext, riserWires, type ConduitRiserDeps } from "@/lib/design/conduit-riser-server";
import { getProject, type GridProject } from "./grid-projects";

/**
 * The conduit riser's writes (#321). Each function is ONE patchDoc on the
 * Grid project, computed from the doc read inside the patch: the stored
 * document is normalized, pruned against the live plan (devices, wires,
 * RiserLinks, spaces, levels), the pure op applied, and the result pruned
 * and normalized again before it's written. Suggestions are always
 * re-derived here from the live wires — a client never hands one in.
 * Callers authenticate (the Grid's `requireUser()`).
 */

export type ConduitRiserResult = { ok: true } | { ok: false; reason: "not-found" | "no-such-option" | "invalid" };
type Refusal = "no-such-option" | "invalid";

const makeId: MakeId = crMakeId;
/** A step's answer: the next doc, null to refuse, or SAME to change nothing (no write, no refusal). */
const SAME = Symbol("same");

/** One patch: `step` gets the live, pruned doc and returns the next doc, or null to refuse. */
async function writeConduit(
  projectId: string,
  optionId: string,
  step: (p: GridProject, doc: ConduitRiserDoc, placementIds: ReadonlySet<string>) => ConduitRiserDoc | null | typeof SAME
): Promise<ConduitRiserResult> {
  let refusal: Refusal | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!hasOption(p, optionId)) {
      refusal = "no-such-option";
      return;
    }
    ensureOptions(p);
    const live = conduitLiveIds(p, optionId);
    const next = step(p, liveConduitRiser(p, optionId), live.placementIds);
    if (next === SAME) return;
    if (!next) {
      refusal = "invalid";
      return;
    }
    p.conduitRiser = { ...(p.conduitRiser || {}), [optionId]: normalizeConduitRiserDoc(pruneConduitRiser(next, live)) };
    p.updatedAt = Date.now();
  });
  if (!updated) return { ok: false, reason: "not-found" };
  const r = refusal as Refusal | null;
  return r ? { ok: false, reason: r } : { ok: true };
}

const isOp = (op: unknown): op is CROp =>
  !!op && typeof op === "object" && (CR_OP_NAMES as readonly string[]).includes((op as { op?: unknown }).op as string);

/** One layout / detail / stub / run / level / note / defaults edit. */
export async function patchConduitRiser(projectId: string, optionId: string, op: CROp): Promise<ConduitRiserResult> {
  if (!isOp(op)) return { ok: false, reason: "invalid" };
  return writeConduit(projectId, optionId, (_p, doc, placementIds) => {
    const res = applyConduitOp(doc, op, makeId, placementIds);
    return res.changed ? res.doc : null;
  });
}

/**
 * Accept suggestions by key ("all" = every one on offer). The suggestions
 * are re-derived from the live wires inside the patch; a listed key that
 * isn't on offer (forged, already accepted, gone) is ignored. Nothing
 * left to accept is not an error: `{ ok: true, accepted: 0 }`, no write.
 */
export async function acceptSuggestions(
  projectId: string,
  optionId: string,
  keys: string[] | "all",
  deps: ConduitRiserDeps = {}
): Promise<{ ok: true; accepted: number } | Extract<ConduitRiserResult, { ok: false }>> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  const ctx = await loadRiserPartsContext(project, deps);
  let accepted = 0;
  const want = keys === "all" ? null : new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : []);
  const r = await writeConduit(projectId, optionId, (p, doc, placementIds) => {
    let next = doc;
    accepted = 0;
    for (const s of suggestions(doc, riserWires(p, optionId, ctx)).items) {
      if (want && !want.has(s.key)) continue;
      const res = acceptSuggestion(next, s, makeId, placementIds);
      if (res.changed) {
        next = res.doc;
        accepted++;
      }
    }
    return accepted ? next : SAME;
  });
  return r.ok ? { ok: true, accepted } : r;
}

/** Hide one suggested pair until a wire this dismissal didn't see is drawn. */
export async function dismissSuggestion(
  projectId: string,
  optionId: string,
  key: string,
  deps: ConduitRiserDeps = {}
): Promise<ConduitRiserResult> {
  if (typeof key !== "string" || !key) return { ok: false, reason: "invalid" };
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  const ctx = await loadRiserPartsContext(project, deps);
  return writeConduit(projectId, optionId, (p, doc) => {
    const s = suggestions(doc, riserWires(p, optionId, ctx)).items.find((x) => x.key === key);
    if (!s) return null;
    const res = dismissOne(doc, s);
    return res.changed ? res.doc : null;
  });
}
