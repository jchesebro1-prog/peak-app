import { normalizedTitle } from "./text";
import type { TriageCandidate } from "./types";

/** An open task/assignment of the user, on the list or not. Keys match the tasks feed's candidate keys. */
export type OpenWork = { key: string; title: string };

/**
 * Spec "Duplicates". Call to-dos whose normalized title matches one of the
 * user's open tasks/assignments, or an earlier call to-do, collapse into one
 * row with "Also mentioned in <meeting> (<date>)". A to-do matching open work
 * that is NOT on today's list is dropped — the work is already tracked.
 * Earliest to-do (since, then key) keeps the row. Order of survivors is kept.
 */
export function collapseDuplicates(cands: readonly TriageCandidate[], openWork: readonly OpenWork[]): TriageCandidate[] {
  const out = cands.map((c) => ({ ...c, also: [...(c.also ?? [])] }));
  const byKey = new Map(out.map((c) => [c.key, c]));
  const workByTitle = new Map<string, string>();
  for (const w of openWork) {
    const n = normalizedTitle(w.title);
    if (n && !workByTitle.has(n)) workByTitle.set(n, w.key);
  }
  const age = (c: TriageCandidate) => (c.since > 0 ? c.since : Number.MAX_SAFE_INTEGER);
  const calls = out
    .filter((c) => c.source === "call")
    .sort((a, b) => age(a) - age(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const drop = new Set<string>();
  const firstCall = new Map<string, (typeof out)[number]>();
  for (const c of calls) {
    const n = normalizedTitle(c.title);
    if (!n) continue;
    const line = `Also mentioned in ${c.mention || "a meeting"}`;
    const workKey = workByTitle.get(n);
    if (workKey) {
      drop.add(c.key);
      byKey.get(workKey)?.also?.push(line);
      continue;
    }
    const prior = firstCall.get(n);
    if (prior) {
      drop.add(c.key);
      prior.also?.push(line);
      continue;
    }
    firstCall.set(n, c);
  }
  return out.filter((c) => !drop.has(c.key));
}
