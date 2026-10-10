import { getDoc, listDocs, patchDoc, upsertDoc } from "@/db/doc-store";
import type { MeetingRecord } from "@/lib/meetings/types";
import { emptyLinks } from "@/lib/meetings/types";
import { canSeeMeeting } from "@/lib/meetings/visibility";

const COLL = "meetings" as const;

export function normalizeMeeting(d: Partial<MeetingRecord> & { id: string }): MeetingRecord {
  const k = (d.krisp || {}) as Partial<MeetingRecord["krisp"]>;
  const l = (d.links || {}) as Partial<MeetingRecord["links"]>;
  return {
    id: d.id,
    krispMeetingId: d.krispMeetingId || d.id.replace(/^km-/, ""),
    seenBy: Array.isArray(d.seenBy) ? d.seenBy : [],
    ownerUserId: d.ownerUserId || "",
    recordingId: d.recordingId ?? null,
    krisp: {
      title: k.title || "", startedAt: k.startedAt ?? null, durationSec: k.durationSec ?? null,
      source: k.source ?? null, status: k.status || "", tags: Array.isArray(k.tags) ? k.tags : [],
      participants: Array.isArray(k.participants) ? k.participants : [],
      speakers: k.speakers && typeof k.speakers === "object" ? k.speakers : {},
      segments: Array.isArray(k.segments) ? k.segments : [],
      notes: k.notes ?? null, fetchedAt: k.fetchedAt ?? 0, detailFetchedAt: k.detailFetchedAt ?? null,
      removedAt: k.removedAt ?? null,
    },
    calendar: d.calendar ?? null,
    attendees: Array.isArray(d.attendees) ? d.attendees : [],
    speakerMap: d.speakerMap && typeof d.speakerMap === "object" ? d.speakerMap : {},
    links: {
      ...emptyLinks(),
      customerId: l.customerId ?? null, siteId: l.siteId ?? null,
      contactIds: Array.isArray(l.contactIds) ? l.contactIds : [],
      work: l.work ?? null,
      internalUserIds: Array.isArray(l.internalUserIds) ? l.internalUserIds : [],
    },
    filedAt: d.filedAt ?? null, filedBy: d.filedBy ?? null,
    suggestions: Array.isArray(d.suggestions) ? d.suggestions : [],
    noise: !!d.noise, noiseOverride: !!d.noiseOverride,
    todos: Array.isArray(d.todos) ? d.todos : [],
    share: d.share ?? null,
    createdAt: d.createdAt ?? 0, updatedAt: d.updatedAt ?? 0,
  };
}

export async function getMeeting(id: string): Promise<MeetingRecord | null> {
  const d = await getDoc<MeetingRecord>(COLL, id);
  return d ? normalizeMeeting(d) : null;
}

export async function saveMeeting(m: MeetingRecord): Promise<MeetingRecord> {
  const next = normalizeMeeting({ ...m, updatedAt: Date.now(), createdAt: m.createdAt || Date.now() });
  await upsertDoc(COLL, next);
  return next;
}

export async function patchMeeting(id: string, fn: (m: MeetingRecord) => MeetingRecord): Promise<MeetingRecord | null> {
  const res = await patchDoc<MeetingRecord>(COLL, id, (cur) => {
    return normalizeMeeting({ ...fn(normalizeMeeting(cur)), updatedAt: Date.now() });
  });
  return res ? normalizeMeeting(res) : null;
}

export async function allMeetings(): Promise<MeetingRecord[]> {
  const rows = await listDocs<MeetingRecord>(COLL);
  return rows.map(normalizeMeeting).sort((a, b) => (b.krisp.startedAt ?? 0) - (a.krisp.startedAt ?? 0));
}

export async function meetingsVisibleTo(userId: string): Promise<MeetingRecord[]> {
  return (await allMeetings()).filter((m) => canSeeMeeting(m, userId));
}

export async function meetingsLinkedTo(
  kind: "company" | "venue" | "contact" | "work", id: string, viewerId: string,
): Promise<MeetingRecord[]> {
  return (await meetingsVisibleTo(viewerId)).filter((m) =>
    kind === "company" ? m.links.customerId === id
    : kind === "venue" ? m.links.siteId === id
    : kind === "contact" ? m.links.contactIds.includes(id)
    : m.links.work?.id === id);
}
