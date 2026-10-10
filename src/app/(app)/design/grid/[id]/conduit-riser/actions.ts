"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { CR_OP_NAMES, type CROp } from "@/lib/design/conduit-riser/model";
import { acceptSuggestions, dismissSuggestion, patchConduitRiser } from "@/lib/stores/grid-conduit-riser";
import { getProject } from "@/lib/stores/grid-projects";
import { riserPromptFor, type RiserPrompt } from "@/lib/design/conduit-riser-server";

/**
 * Lighting control riser actions (#321). Same gate as every Grid edit
 * (requireUser). The store re-derives suggestions from the live plan
 * inside its own write — these actions hand it keys, never suggestion
 * objects — and loads the parts context once per call. Tags go through
 * setTagFieldsAction and levels through saveLevelsAction (../actions).
 */

type Result = { ok: true } | { ok: false; error: string };

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
export async function patchConduitRiserAction(projectId: string, optionId: string, op: CROp): Promise<Result> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId)) return fail("invalid");
  if (!op || typeof op !== "object" || !(CR_OP_NAMES as readonly string[]).includes(op.op)) return { ok: false, error: "Unknown riser edit." };
  const r = await patchConduitRiser(projectId, optionId, op);
  if (!r.ok) return fail(r.reason);
  revalidateConduit(projectId);
  return { ok: true };
}

/** Accept suggestions from the plan by key, or "all". Nothing left to
 *  accept is not an error — `accepted: 0`, and the page says so. */
export async function acceptSuggestionsAction(
  projectId: string,
  optionId: string,
  keys: string[] | "all"
): Promise<{ ok: true; accepted: number } | { ok: false; error: string }> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId)) return fail("invalid");
  const list = keys === "all" ? "all" : Array.isArray(keys) ? keys.filter(isKey).slice(0, 2000) : null;
  if (!list) return fail("invalid");
  const r = await acceptSuggestions(projectId, optionId, list);
  if (!r.ok) return fail(r.reason);
  if (r.accepted) revalidateConduit(projectId);
  return { ok: true, accepted: r.accepted };
}

/** Hide one suggested pair. A key no longer on offer (accepted or dismissed
 *  elsewhere, or its wires gone) is not an error — the page just refreshes. */
export async function dismissSuggestionAction(projectId: string, optionId: string, key: string): Promise<Result> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId) || !isKey(key)) return fail("invalid");
  const r = await dismissSuggestion(projectId, optionId, key);
  if (!r.ok && r.reason !== "invalid") return fail(r.reason);
  revalidateConduit(projectId);
  return { ok: true };
}

/**
 * Should the plan ask "Add to the lighting control riser?" for a wire just
 * drawn? Read-only; the rule is `riserPromptFor`. A failure is "no prompt".
 */
export async function riserPromptForRouteAction(projectId: string, optionId: string, routeId: string): Promise<RiserPrompt> {
  await requireUser();
  if (!isStr(projectId) || !isStr(optionId) || !isStr(routeId)) return { show: false };
  try {
    const project = await getProject(projectId);
    return project ? await riserPromptFor(project, optionId, routeId) : { show: false };
  } catch {
    return { show: false };
  }
}
