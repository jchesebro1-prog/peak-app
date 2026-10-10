"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { CR_OP_NAMES, estimateOwnedOp, type ConduitRiserSystem, type CROp } from "@/lib/design/conduit-riser/model";
import type { Landed } from "@/lib/design/conduit-riser/edit";
import { acceptSuggestions, dismissSuggestion, isSystem, patchConduitRiser } from "@/lib/stores/grid-conduit-riser";
import { getProject } from "@/lib/stores/grid-projects";
import { riserPromptForRoute, type RiserPrompt } from "@/lib/design/conduit-riser-server";

/**
 * Conduit riser actions (#321). Same gate as every Grid edit
 * (requireUser). The store re-derives suggestions from the live plan
 * inside its own write — these actions hand it keys, never suggestion
 * objects — and loads the parts context once per call. Tags go through
 * setTagFieldsAction and levels through saveLevelsAction (../actions).
 * A write hands back the version it landed on (`landed`) so the editor can
 * carry its layout-undo stack across its own edits and drop it on anyone
 * else's.
 *
 * #328 C3: every write names its riser — `system` "lighting" (the lighting
 * control riser) or "av" (the A/V conduit riser) — checked with the store's
 * `isSystem` before anything else; a forged value is refused.
 */

type Result = { ok: true; landed?: Landed } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  "not-found": "Design not found.",
  "no-such-option": "That option was removed — refresh the page.",
  invalid: "That change doesn't fit the riser as it is now — refresh the page and try again.",
};

function fail(reason: string): { ok: false; error: string } {
  return { ok: false, error: MESSAGES[reason] || "That change couldn't be saved." };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
/** A pair key — two ids of up to 100 characters joined by "|". */
const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 201;

function revalidateConduit(projectId: string) {
  const base = `/design/grid/${encodeURIComponent(projectId)}`;
  revalidatePath(base);
  revalidatePath(`${base}/conduit-riser`);
  revalidatePath(`${base}/set`);
}

/** One layout / detail / stub / run / level / power type / note / defaults edit. */
export async function patchConduitRiserAction(projectId: string, optionId: string, system: ConduitRiserSystem, op: CROp): Promise<Result> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId) || !isSystem(system)) return fail("invalid");
  if (!op || typeof op !== "object" || !(CR_OP_NAMES as readonly string[]).includes(op.op)) return { ok: false, error: "Unknown riser edit." };
  if ((op.op === "updateRun" || op.op === "setDefaults") && (op.priceWire !== undefined || op.priceConduit !== undefined)) {
    // An estimate-owned option never prices on the riser (#314) — refuse the
    // pricing fields here, whatever the page sent; nothing left = no write.
    // Only an op that carries a pricing field costs this extra read.
    const project = await getProject(projectId);
    if (!project) return fail("not-found");
    const kept = estimateOwnedOp(op, (project.options || []).find((o) => o.id === optionId)?.estimateOwned === true);
    if (!kept) return { ok: true };
    op = kept;
  }
  const r = await patchConduitRiser(projectId, optionId, system, op);
  if (!r.ok) return fail(r.reason);
  revalidateConduit(projectId);
  return { ok: true, landed: r.landed };
}

/** Accept suggestions from the plan by key, or "all". Nothing left to
 *  accept is not an error — `accepted: 0`, and the page says so. */
export async function acceptSuggestionsAction(
  projectId: string,
  optionId: string,
  system: ConduitRiserSystem,
  keys: string[] | "all"
): Promise<{ ok: true; accepted: number; landed?: Landed } | { ok: false; error: string }> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId) || !isSystem(system)) return fail("invalid");
  const list = keys === "all" ? "all" : Array.isArray(keys) ? keys.filter(isKey).slice(0, 2000) : null;
  if (!list) return fail("invalid");
  const r = await acceptSuggestions(projectId, optionId, system, list);
  if (!r.ok) return fail(r.reason);
  if (r.accepted) revalidateConduit(projectId);
  return { ok: true, accepted: r.accepted, landed: r.landed };
}

/** Hide one suggested pair. A key no longer on offer (accepted or dismissed
 *  elsewhere, or its wires gone) is not an error — the page just refreshes. */
export async function dismissSuggestionAction(projectId: string, optionId: string, system: ConduitRiserSystem, key: string): Promise<Result> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId) || !isSystem(system) || !isKey(key)) return fail("invalid");
  const r = await dismissSuggestion(projectId, optionId, system, key);
  if (!r.ok && r.reason !== "invalid") return fail(r.reason);
  revalidateConduit(projectId);
  return { ok: true, landed: r.ok ? r.landed : undefined };
}

/**
 * Should the plan ask "Add to the … riser?" for a wire just drawn, and
 * which riser? Read-only; the server picks the riser from the wire's own
 * devices (`riserPromptForRoute`, #328 C3) — the client never names it
 * here. A failure is "no prompt".
 */
export async function riserPromptForRouteAction(projectId: string, optionId: string, routeId: string): Promise<RiserPrompt> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId) || !isStr(routeId)) return { show: false };
  try {
    const project = await getProject(projectId);
    return project ? await riserPromptForRoute(project, optionId, routeId) : { show: false };
  } catch {
    return { show: false };
  }
}
