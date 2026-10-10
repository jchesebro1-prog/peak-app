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
  const out = cands.map((c) => ({ ...c, also: [...(c.also ?? [])], alsoKeys: [...(c.alsoKeys ?? [])] }));
  const byKey = new Map(out.map((c) => [c.key, c]));
  // Every open-work key per normalized title (off-list keys included), so a
  // duplicate whose first match is off the list still reaches an on-list one.
  const workByTitle = new Map<string, string[]>();
  for (const w of openWork) {
    const n = normalizedTitle(w.title);
    if (!n) continue;
    const keys = workByTitle.get(n) ?? [];
    if (!keys.includes(w.key)) keys.push(w.key);
    workByTitle.set(n, keys);
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
    // A repeat from the same meeting adds nothing the kept row doesn't already say.
    const addLine = (kept: (typeof out)[number] | undefined) => {
      // A folded CALL to-do is remembered by key even when it adds no line: dismissing the kept call row dismisses it too.
      if (kept?.source === "call") kept.alsoKeys.push(c.key);
      if (kept && c.mention && kept.mention === c.mention) return;
      kept?.also.push(line);
    };
    const workKeys = workByTitle.get(n) ?? [];
    if (workKeys.length) {
      drop.add(c.key);
      addLine(workKeys.map((k) => byKey.get(k)).find((k) => k !== undefined));
      continue;
    }
    const prior = firstCall.get(n);
    if (prior) {
      drop.add(c.key);
      addLine(prior);
      continue;
    }
    firstCall.set(n, c);
  }
  return out.filter((c) => !drop.has(c.key));
}
