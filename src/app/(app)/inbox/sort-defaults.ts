import type { SortKey } from "@/lib/stores/comms";

/**
 * Punch #42 finding 1: each Inbox/CRM mode has its own default ordering when
 * no `sort` param is on the URL — plain mode's default is date-desc, CRM
 * mode's is waiting-first (see comms.ts threadsIn). A given SortKey only
 * "matches the mode's default" — and so can be safely omitted from the URL —
 * when it's "date" in plain mode. CRM mode's default (waiting-first) isn't
 * expressible as a SortKey at all, so nothing ever collapses to it: an
 * explicit `sort=date` must stay on the URL there, or it becomes
 * indistinguishable from "no sort chosen" and silently reverts to
 * waiting-first (the bug this fixes).
 */
export function isModeDefaultSort(sort: SortKey | string, crmMode: boolean): boolean {
  return !crmMode && sort === "date";
}
