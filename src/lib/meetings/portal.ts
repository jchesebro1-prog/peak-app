/**
 * #323 K3 — the customer portal's Meeting notes: only meetings staff explicitly
 * shared with this customer, and only the edited share summary, the title and
 * the date — never the transcript, attendees, to-dos or links. Selected in SQL
 * (share set + links.customerId = the customer) and re-checked through
 * `portalCanSee`. Server-only (store import); never import from a client file.
 */
import { sharedMeetingRowsFor } from "@/lib/stores/meetings";
import { portalCanSee } from "./visibility";

export type PortalMeeting = { id: string; title: string; startedAt: number | null; summary: string };

export async function portalMeetings(customerId: string): Promise<PortalMeeting[]> {
  if (!customerId) return [];
  return (await sharedMeetingRowsFor(customerId))
    .filter((m) => portalCanSee(m, customerId))
    .map((m) => ({ id: m.id, title: m.krisp.title, startedAt: m.krisp.startedAt, summary: m.share!.summary }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
