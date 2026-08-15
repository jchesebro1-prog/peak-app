import type { SortKey } from "@/lib/stores/comms";

/**
 * date-desc is now the default sort for all inbox modes (plain and CRM).
 * CRM mode changes which columns/badges are visible, not the default ordering.
 * A SortKey "matches the mode's default" — and can be safely omitted from the
 * URL — when it's "date" regardless of crmMode.
 */
export function isModeDefaultSort(sort: SortKey | string, crmMode: boolean): boolean {
  return sort === "date";
}
