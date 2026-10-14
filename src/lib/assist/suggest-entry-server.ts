/**
 * Estimate suggestion — the server half of every entry point (spec
 * 2026-10-13 §3): is the button on for this user (pilot + `estimate`, the
 * same gate the route takes), and does the source already have a suggestion
 * ("Suggestion ready → Open"). Never throws — a failed read hides the
 * button / the ready link instead of breaking the page.
 */
import { gateFor } from "./gate-server";
import { suggestionHref } from "./features/suggestion";
import type { SuggestSourceKind } from "./features/suggest-sources";
import { suggestionForSource } from "@/lib/stores/estimate-suggestions";
import type { RunDeps } from "./run";

/** Most lead rows the brief card looks up (its Do-these-first list is far shorter). */
export const SUGGEST_LOOKUP_MAX = 20;

/** Pilot + `estimate` for this user. */
export async function estimateSuggestEnabled(userId: string, deps: Pick<RunDeps, "settings" | "env"> = {}): Promise<boolean> {
  try {
    return (await gateFor("estimate", userId, deps)) === null;
  } catch (e) {
    console.error("[assist] estimate gate check failed", e instanceof Error ? e.name : "error");
    return false;
  }
}

/** The source's latest suggestion as an Estimator link, else null. */
export async function suggestionReadyHref(kind: SuggestSourceKind, id: string): Promise<string | null> {
  try {
    const s = await suggestionForSource(kind, id);
    return s ? suggestionHref(s) : null;
  } catch (e) {
    console.error(`[assist] suggestion lookup for ${kind} failed`, e instanceof Error ? e.name : "error");
    return null;
  }
}

/** Several sources of one kind (bounded by SUGGEST_LOOKUP_MAX) → id → ready link. */
export async function suggestionReadyHrefs(kind: SuggestSourceKind, ids: readonly string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(ids)].slice(0, SUGGEST_LOOKUP_MAX);
  const hrefs = await Promise.all(unique.map((id) => suggestionReadyHref(kind, id)));
  return Object.fromEntries(unique.map((id, i) => [id, hrefs[i]]));
}
