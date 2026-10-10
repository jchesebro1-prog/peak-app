/* #323 Krisp meeting matcher — spec checks. Chained from test-review-and-spec.ts. */
import { registerFixture } from "./test-fixtures";
import type { MeetingLinks, MeetingRecord } from "@/lib/meetings/types";
import { emptyLinks, meetingIdFor } from "@/lib/meetings/types";
import * as MS from "@/lib/stores/meetings";
import { nameCore, hitsCore, normalizeText } from "@/lib/meetings/names";
import { canSeeMeeting, meetingScope, portalCanSee } from "@/lib/meetings/visibility";
import { matchMeeting, type MatchIndex, type MatchInput } from "@/lib/meetings/match";

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

const T0 = Date.UTC(2026, 9, 6, 15, 0); // 2026-10-06 10:00 Chicago

function index323(over: Partial<MatchIndex> = {}): MatchIndex {
  return {
    companies: [
      { id: "osakis", name: "Osakis Public Schools", keywords: [] },
      { id: "oshkosh", name: "Oshkosh Area School District", keywords: [] },
      { id: "oshct", name: "Oshkosh Community Theatre", keywords: [] },
      { id: "monte", name: "Montevideo Public Schools", keywords: ["Monte PAC"] },
    ],
    sites: [
      { id: "st-osakis-1", companyId: "osakis", name: "Osakis High School Auditorium", locationName: null },
      { id: "st-oshkosh-1", companyId: "oshkosh", name: "Oshkosh North High School", locationName: null },
      { id: "st-oshkosh-2", companyId: "oshkosh", name: "Oshkosh West High School", locationName: null },
    ],
    contacts: [
      { id: "c-tom", companyId: "osakis", firstName: "Tom", lastName: "Ellis", emails: ["tom@osakis.k12.mn.us"] },
      { id: "c-seth", companyId: "monte", firstName: "Seth", lastName: "Berg", emails: [] },
    ],
    users: [
      { id: "u1", name: "Jeff Chesebro", emails: ["jeff@peaksystemsgroup.com"] },
      { id: "u2", name: "Jason Keagy", emails: ["jason@peaksystemsgroup.com"] },
    ],
    internalDomains: ["peaksystemsgroup.com"],
    domainCompanies: { "osakis.k12.mn.us": ["osakis"] },
    visits: [],
    openWork: [],
    ...over,
  };
}
function input323(over: Partial<MatchInput>): MatchInput {
  return { title: "", calendarTitle: null, summaryText: "", attendees: [], speakerNames: [],
    startMs: T0, endMs: T0 + 30 * 60_000, durationSec: 1800, ownerUserId: "u1", ...over };
}

export async function meetings323MatchChecks(ok: Ok): Promise<void> {
  ok(normalizeText("Osakis – Theatrical Owner's Scope!") === "osakis theatrical owner s scope", "#323 normalizeText lowercases and turns punctuation into spaces");
  ok(nameCore("Osakis Public Schools") === "osakis" && nameCore("Oshkosh North High School") === "oshkosh north" &&
     nameCore("Oshkosh Community Theatre") === "oshkosh" && nameCore("The Center") === null,
    "#323 nameCore strips generic words and refuses an empty / < 4-char core");
  ok(hitsCore("Oshkosh North - VE Engineering Meeting", "oshkosh north") && !hitsCore("Oshkoshville kickoff", "oshkosh"),
    "#323 hitsCore matches whole words only");

  const idx = index323();
  // title + calendar title → strong
  const a = matchMeeting(input323({ title: "Osakis – theatrical owner scope requests", calendarTitle: "Osakis scope review" }), idx);
  const aCo = a.suggestions.find((s) => s.kind === "company");
  ok(!a.noise && aCo?.id === "osakis" && aCo.strength === "strong" && aCo.score === 80, "#323 title + calendar title → strong company suggestion (80)");
  ok(a.suggestions.some((s) => s.kind === "venue" && s.id === "st-osakis-1") === false,
    "#323 no venue suggested when no venue core hit and no visit (Osakis HS Auditorium core 'osakis' equals the company core — counted once, not as a venue hit)");
  // title only → weak
  const b = matchMeeting(input323({ title: "Montevideo - orchestra pit discussion" }), idx);
  ok(b.suggestions.find((s) => s.kind === "company")?.strength === "weak", "#323 title only → weak");
  // keyword hit counts as title
  const kw = matchMeeting(input323({ title: "Monte PAC rigging walk" }), idx);
  ok(kw.suggestions.find((s) => s.kind === "company")?.id === "monte", "#323 a company keyword is matched like its name");
  // no signal
  const c = matchMeeting(input323({ title: "Jeff Chesebro <> Speaker_2" }), idx);
  ok(c.suggestions.length === 0 && !c.noise, "#323 'Jeff <> Speaker_2' alone → no suggestion");
  // noise
  const d = matchMeeting(input323({ title: "Osakis quick", durationSec: 45 }), idx);
  ok(d.noise && d.suggestions.length === 0, "#323 < 3 minutes → noise, no suggestions");
  // venue-core hit beats a same-name company, but within 30 → both weak, venue suggested for top
  const e = matchMeeting(input323({ title: "Oshkosh North - VE Engineering Meeting" }), idx);
  const eCos = e.suggestions.filter((s) => s.kind === "company");
  ok(eCos[0]?.id === "oshkosh" && eCos[0].score === 60 && eCos.some((s) => s.id === "oshct") && eCos.every((s) => s.strength === "weak"),
    "#323 district venue hit (60) vs same-word theatre (50): both suggested, weak, district first");
  ok(e.suggestions.some((s) => s.kind === "venue" && s.id === "st-oshkosh-1") && !e.suggestions.some((s) => s.id === "st-oshkosh-2"),
    "#323 the venue whose core hit is suggested; its sibling is not");
  // email → contact
  const f = matchMeeting(input323({ title: "Scope call", attendees: [{ name: "Tom Ellis", email: "tom@osakis.k12.mn.us" }] }), idx);
  ok(f.suggestions.find((s) => s.kind === "company")?.score === 60 && f.suggestions.some((s) => s.kind === "contact" && s.id === "c-tom"),
    "#323 attendee email → contact (60) and the contact is suggested");
  // mobile recording during an owner's scheduled visit → that visit
  const g = matchMeeting(input323({ title: "Mobile recording - October 6, 2026 9:48 AM" }), index323({
    visits: [{ kind: "site_visit", id: "SV-1001", label: "Osakis walkthrough", companyId: "osakis", siteId: "st-osakis-1",
      startMs: T0 - 15 * 60_000, endMs: T0 + 60 * 60_000, assigneeUserId: "u1" }],
  }));
  ok(g.suggestions.some((s) => s.kind === "work" && s.id === "SV-1001" && s.workType === "site_visit") &&
     g.suggestions.some((s) => s.kind === "venue" && s.id === "st-osakis-1") &&
     g.suggestions.find((s) => s.kind === "company")?.score === 40,
    "#323 a recording during the owner's scheduled site visit suggests that visit, its venue and company (40, weak)");
  // someone else's visit doesn't count
  const g2 = matchMeeting(input323({ title: "Mobile recording" }), index323({
    visits: [{ kind: "site_visit", id: "SV-1002", label: "x", companyId: "osakis", siteId: null, startMs: T0, endMs: T0 + 1, assigneeUserId: "u2" }],
  }));
  ok(g2.suggestions.length === 0, "#323 another rep's visit is not a signal for this owner");
  // unique open lead becomes the work suggestion
  const h = matchMeeting(input323({ title: "Osakis scope", calendarTitle: "Osakis" }), index323({
    openWork: [{ type: "lead", id: "L-1", label: "Osakis rigging", companyId: "osakis" }],
  }));
  ok(h.suggestions.some((s) => s.kind === "work" && s.id === "L-1" && s.strength === "strong"), "#323 the company's single open lead is the work suggestion");
  const h2 = matchMeeting(input323({ title: "Osakis scope", calendarTitle: "Osakis" }), index323({
    openWork: [{ type: "lead", id: "L-1", label: "a", companyId: "osakis" }, { type: "lead", id: "L-2", label: "b", companyId: "osakis" }],
  }));
  ok(!h2.suggestions.some((s) => s.kind === "work"), "#323 two open leads → no work suggestion (never guessed)");
  // internal
  const i = matchMeeting(input323({ title: "Weekly Design Meeting", attendees: [
    { name: "Jeff Chesebro", email: "jeff@peaksystemsgroup.com" }, { name: "Jason Keagy", email: "jason@peaksystemsgroup.com" }] }), idx);
  ok(i.suggestions.length === 1 && i.suggestions[0].kind === "internal" && i.suggestions[0].id === "u2" && i.suggestions[0].strength === "strong",
    "#323 internal-only meeting → internal link to the other Peak attendee (not the owner), strong by email");
  // speaker first name breaks nothing alone
  const j = matchMeeting(input323({ title: "Mobile recording", speakerNames: ["Seth"] }), idx);
  ok(j.suggestions.length === 0, "#323 a speaker first name alone (10) is below the bar");
  // summary text
  const k = matchMeeting(input323({ title: "Mobile recording", summaryText: "Walked the Montevideo pit with Seth", speakerNames: ["Seth"] }), idx);
  ok(k.suggestions.length === 0, "#323 summary hit (20) + speaker first name at that company (10) = 30 → below the bar, nothing suggested");
  ok(a.suggestions.find((s) => s.kind === "company")!.reasons.some((r) => r.includes("title")), "#323 suggestions carry human reasons");
}

export async function meetings323VisibilityChecks(ok: Ok): Promise<void> {
  const base = meetingFixture323({ krispMeetingId: "v1", seenBy: ["u1", "u3"] });
  ok(meetingScope(base) === "private" && canSeeMeeting(base, "u1") && canSeeMeeting(base, "u3") && !canSeeMeeting(base, "u2"),
    "#323 unlinked → private to every rep whose Krisp lists it");
  const internal = { ...base, links: { ...base.links, internalUserIds: ["u2"] } };
  ok(meetingScope(internal) === "internal" && canSeeMeeting(internal, "u2") && !canSeeMeeting(internal, "u4"),
    "#323 internal link shares with that person only");
  const externals: [string, Partial<MeetingLinks>][] = [
    ["company", { customerId: "osakis" }], ["venue", { siteId: "st-1" }], ["contact", { contactIds: ["c-1"] }],
    ["work", { work: { type: "lead", id: "L-1", label: "x" } }],
  ];
  for (const [label, links] of externals) {
    const m = { ...base, links: { ...base.links, ...links } };
    ok(meetingScope(m) === "peak" && canSeeMeeting(m, "u9"), `#323 any external link (${label}) → all of Peak`);
  }
  const linked = { ...base, links: { ...base.links, customerId: "osakis" } };
  ok(!portalCanSee(linked, "osakis"), "#323 linked but not shared → portal sees nothing");
  const shared = { ...linked, share: { sharedAt: 1, sharedBy: "Jeff", summary: "s" } };
  ok(portalCanSee(shared, "osakis") && !portalCanSee(shared, "other"), "#323 shared → only that customer's portal");
}
