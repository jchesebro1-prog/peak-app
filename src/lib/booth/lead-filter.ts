/** Leads board `?show=<id>` filter. Pure. */
export function filterByShow<T extends { eventId?: string }>(leads: T[], showId: string | null): T[] {
  return showId ? leads.filter((l) => l.eventId === showId) : leads;
}
