import type { MeetingLinks, MeetingRecord } from "./types";

export type MeetingScope = "private" | "internal" | "peak";

export function hasExternalLink(l: MeetingLinks): boolean {
  return !!(l.customerId || l.siteId || l.contactIds.length || l.work);
}

export function meetingScope(m: Pick<MeetingRecord, "links">): MeetingScope {
  if (hasExternalLink(m.links)) return "peak";
  return m.links.internalUserIds.length ? "internal" : "private";
}

export function canSeeMeeting(m: Pick<MeetingRecord, "links" | "seenBy">, userId: string): boolean {
  const scope = meetingScope(m);
  if (scope === "peak") return true;
  if (m.seenBy.includes(userId)) return true;
  return scope === "internal" && m.links.internalUserIds.includes(userId);
}

export function portalCanSee(m: Pick<MeetingRecord, "links" | "share">, customerId: string): boolean {
  return m.share != null && !!customerId && m.links.customerId === customerId;
}
