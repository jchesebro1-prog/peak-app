/* #323 Krisp meeting matcher — spec checks. Chained from test-review-and-spec.ts. */
import { registerFixture } from "./test-fixtures";
import type { MeetingRecord } from "@/lib/meetings/types";
import { emptyLinks, meetingIdFor } from "@/lib/meetings/types";
import * as MS from "@/lib/stores/meetings";

type Ok = (c: boolean, m: string) => void;

export function meetingFixture323(over: Partial<MeetingRecord> & { krispMeetingId: string }): MeetingRecord {
  const now = 1_790_000_000_000;
  return {
    id: meetingIdFor(over.krispMeetingId),
    seenBy: ["u1"], ownerUserId: "u1", recordingId: null,
    krisp: { title: "", startedAt: now, durationSec: 1200, source: null, status: "completed", tags: [],
      participants: [], speakers: {}, segments: [], notes: null, fetchedAt: now, detailFetchedAt: null, removedAt: null },
    calendar: null, attendees: [], speakerMap: {}, links: emptyLinks(), filedAt: null, filedBy: null,
    suggestions: [], noise: false, noiseOverride: false, todos: [], share: null, createdAt: now, updatedAt: now,
    ...over,
  } as MeetingRecord;
}

export async function meetings323StoreChecks(ok: Ok): Promise<void> {
  const kid = "TEST323" + "a".repeat(25);
  const m = meetingFixture323({ krispMeetingId: kid, krisp: { ...meetingFixture323({ krispMeetingId: kid }).krisp, title: "Osakis – scope" } });
  registerFixture("meetings", m.id);
  await MS.saveMeeting(m);
  const back = await MS.getMeeting(m.id);
  ok(!!back && back.id === "km-" + kid && back.krisp.title === "Osakis – scope", "#323 a meeting round-trips through the meetings doc table under km-<krispId>");
  const patched = await MS.patchMeeting(m.id, (x) => ({ ...x, links: { ...x.links, customerId: "TEST323-co" } }));
  ok(patched?.links.customerId === "TEST323-co", "#323 patchMeeting is read-modify-write");
  const norm = MS.normalizeMeeting({ id: "km-x" } as MeetingRecord);
  ok(Array.isArray(norm.seenBy) && norm.links.contactIds.length === 0 && norm.todos.length === 0 && norm.share === null,
    "#323 normalizeMeeting fills every array/object default for a sparse doc");
  ok((await MS.meetingsVisibleTo("u-nobody")).some((x) => x.id === m.id), "#323 a company-linked meeting is visible to any Peak user");
  await MS.patchMeeting(m.id, (x) => ({ ...x, links: { ...x.links, customerId: null } }));
  ok(!(await MS.meetingsVisibleTo("u-nobody")).some((x) => x.id === m.id) && (await MS.meetingsVisibleTo("u1")).some((x) => x.id === m.id),
    "#323 unlinked again → only the rep in seenBy sees it");
}
