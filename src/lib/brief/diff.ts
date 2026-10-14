/**
 * AI daily brief — the afternoon's "Since this morning: X done · Y still open
 * · Z new" (spec §1 step 5). Pure, client-safe.
 *
 * The base is the morning brief's Do-these-first keys plus the morning
 * snapshot's row keys. Only marks made at or after the morning brief count.
 *  - done: a base key marked done, or gone from the current snapshot without
 *    a snooze / dismiss (its source was resolved);
 *  - open: a base key still on the current snapshot and not marked;
 *  - new:  a current key that wasn't in the base.
 * A snoozed or dismissed base key is neither done nor open.
 */
import type { TriageMark } from "@/lib/triage/types";
import type { Brief, BriefSince } from "./types";

export type MorningBase = Pick<Brief, "doFirst" | "builtAt"> & { snapshotKeys?: readonly string[] };

export function sinceMorning(
  morning: MorningBase,
  snapshotKeys: readonly string[],
  marks: ReadonlyArray<Pick<TriageMark, "key" | "kind" | "at">>
): BriefSince {
  const base = new Set<string>([...morning.doFirst.map((d) => d.key), ...(morning.snapshotKeys ?? [])]);
  const current = new Set(snapshotKeys);
  const markOf = new Map<string, TriageMark["kind"]>();
  for (const m of marks) if (m.at >= morning.builtAt) markOf.set(m.key, m.kind);
  let done = 0;
  let open = 0;
  for (const key of base) {
    const kind = markOf.get(key);
    if (kind === "done") done++;
    else if (kind === "snooze" || kind === "dismiss") continue;
    else if (current.has(key)) open++;
    else done++;
  }
  let fresh = 0;
  for (const key of current) if (!base.has(key)) fresh++;
  return { done, open, new: fresh };
}
