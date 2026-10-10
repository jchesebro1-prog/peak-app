/* Site-visit scheduling — spec checks
   (docs/superpowers/specs/2026-10-09-site-visit-scheduling-design.md).
   Chained from test-review-and-spec.ts right after the drive-time checks.
   Doc fixtures use fixtureId("visits", …) + createFixture and are dropped with
   dropFixtures("visits"); blob rows use TESTvisits: ids and are hard-deleted in
   each check's own finally. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addressKey } from "@/lib/address-verify/keys";
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { addDays, chicagoDayStart } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveLoadDeps } from "@/lib/drive-plan/load";
import { pairKey, planDay } from "@/lib/drive-plan/plan";
import { isVisitIcsCopy, stopsForDay, visitPeople, type DriveStop } from "@/lib/drive-plan/stops";
import { toCalendarEvents, type CalendarEvent } from "@/lib/google/calendar";
import { gmailEnabled } from "@/lib/gmail/config";
import { buildRaw } from "@/lib/gmail/mime";
import { buildIcs, icsMimeType } from "@/lib/ics";
import type { Office } from "@/lib/settings";
import { createVisit, getVisit, scheduleVisit, setVisitInvites, updateVisitBooking, type SiteVisit } from "@/lib/stores/site-visits";
import { cancelVisitInvites, dispatchVisitInvite, type InviteDeps } from "@/lib/visit-invite";
import { inviteSummary, normalizeInvites, planInviteChanges, visitEventIds, visitUid, type VisitInviteRecipient } from "@/lib/visit-invite-plan";
import { busyBlocks, fmtBusy, fmtBusyRange, OTHERS_EVENT_LABEL, type BusyBlock, type BusyEvent, type BusyVisit } from "@/lib/visit-plan/busy";
import { checkVisit, stopConflicts, type StopCheckInput } from "@/lib/visit-plan/check";
import { chicagoMinuteOfDay, chicagoWallMs, fmtDayLabel, weekdayOf, workWindow } from "@/lib/visit-plan/hours";
import { attendeeStatusOn, couldBeSameArea, MAX_NEARBY_DAYS, nearbyLine, nearbyPairs, straightLineMiles, suggestDays, VISITS_ONLY_NOTE, type LeadDay } from "@/lib/visit-plan/nearby";
import { BOOKING_ROUTE_BUDGET_MS, bookingRouteMode, loadBookingCheck, NEW_VISIT_ID, readCalendarForBooking, type BookingDeps } from "@/lib/visit-plan/load";
import type { BookingCheckInput } from "@/lib/visit-plan/types";
import { cleanBookingInput } from "@/lib/visit-plan/input";
import { cleanAttendees, MAX_ATTENDEES, readAttendees } from "@/lib/visit-plan/people";
import { eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { blobs } from "@/db/schema";
import {
  getScheduleDefaults,
  getSchedulingSettings,
  getUserSchedulePrefs,
  getUserWorkHours,
  saveSchedulingSettings,
  saveUserSchedulePrefs,
  saveUserWorkHours,
  workHoursFor,
} from "@/lib/stores/schedule-prefs";
import {
  cleanSchedulingInput,
  cleanWorkHours,
  clockToMin,
  DEFAULT_SCHEDULING,
  DEFAULT_WORK_HOURS,
  fmtClock,
  fmtWorkHours,
  minToClock,
  readSchedulingSettings,
} from "@/lib/visit-plan/settings";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";

export type Ok = (c: boolean, m: string) => void;

/* ---- shared helpers (later tasks add more below these) ---- */
const DAY = "2036-10-15"; // a Wednesday, CDT (UTC-5), far in the future so "scheduled" never reads "done"; every test day stays in October
const at = (hh: number, mm = 0, plusDays = 0) => Date.UTC(2036, 9, 15 + plusDays, hh + 5, mm);
const P1: LatLng = { lat: 44.0, lng: -88.0 };
const okAddr = (p: LatLng, key: string): AddressState => ({ status: "verified", label: key, point: p, pointKey: "place:" + key, fix: null });
const sv = (id: string, over: Partial<SiteVisit>): SiteVisit => ({
  id, customerId: null, customer: "Cust " + id, locationId: null, venue: "Venue " + id, address: "addr " + id, contactName: "", contactEmail: "", contactPhone: "",
  reason: "Site survey / measure", startAt: at(9), endAt: at(10), notes: "", assignedTo: "Dana", attendees: [], invites: [], createdBy: "x", createdAt: 1, updatedAt: 1,
  stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", ...over,
}) as SiteVisit;
const rcpt = (name: string, over: Partial<VisitInviteRecipient> = {}): VisitInviteRecipient => ({
  name, to: name.toLowerCase() + "@peak.test", channel: "ics", eventId: null, sentAt: 1, startAt: at(9), endAt: at(10), sequence: 0, fromMailbox: "personal:me", gmailId: null, ...over,
});

const BASE = { name: "Madison Office", lat: 43.0731, lng: -89.4012 };
const P2: LatLng = { lat: 44.1, lng: -88.1 };
const badAddr = (key: string): AddressState => ({ status: "needs_check", label: key, point: null, pointKey: "place:" + key, fix: { kind: "place", key, label: key } });
const vStop = (key: string, start: number, end: number, address: AddressState, label = key.slice(3)): DriveStop => ({ key, kind: "visit", label, startMs: start, endMs: end, address });
const busyEv = (label: string, s: number, e: number): BusyBlock => ({ key: "g:" + label, kind: "event", label, startMs: s, endMs: e });
const FAR: LatLng = { lat: 46.0, lng: -88.0 };
const office: Office = { id: "o1", name: "Madison Office", street: "", city: "Madison", state: "WI", zip: "", lat: BASE.lat, lng: BASE.lng, quoteDefault: true };
const gEvent = (id: string, s: number, e: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, iCalUID: id + "@google.com", title: id, startMs: s, endMs: e, allDay: false, location: "", htmlLink: "", meetingUrl: "",
  selfDeclined: false, selfResponse: "", peakDriveKey: "", peakDriveDay: "", ...over,
});
function dayPlan(stops: DriveStop[], minutes: Array<[LatLng, LatLng, number]>, dayKey = DAY) {
  const routeMinutes = new Map(minutes.map(([a, b, m]) => [pairKey(a, b), m]));
  return { stops, legs: planDay({ userId: "u1", dayKey, stops, base: BASE, bufferMin: 15, routeMinutes, prevDay: { stayOver: false, lastStop: null }, stayOver: false }) };
}
function conflictsFor(stops: DriveStop[], minutes: Array<[LatLng, LatLng, number]>, busy: BusyBlock[], over: Partial<StopCheckInput> = {}) {
  const p = dayPlan(stops, minutes, over.dayKey ?? DAY);
  return stopConflicts({ stopKey: "sv:C", dayKey: DAY, stops: p.stops, legs: p.legs, busy, hours: DEFAULT_WORK_HOURS, dailyDriveLimitMin: 300, ...over });
}

/** One exported function's source, up to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}
/** True when `call` is the function body's first `await`. */
function firstAwait(body: string, call: string): boolean {
  const i = body.indexOf("await ");
  return i >= 0 && body.startsWith("await " + call, i);
}

export async function siteVisitsAttendeeChecks(ok: Ok): Promise<void> {
  const roster = ["Dana", "Jeff", "Sam"];
  ok(cleanAttendees([" Jeff ", "Dana", "Jeff", "Ghost", 7, "", "Sam"], "Dana", roster).join("|") === "Jeff|Sam",
    "site-visits: attendees are trimmed, deduped, roster-only, non-strings dropped, and never the lead");
  ok(cleanAttendees("Jeff", "Dana", roster).length === 0 && cleanAttendees(null, "Dana", roster).length === 0,
    "site-visits: attendees that aren't a list clean to none");
  const many = Array.from({ length: 12 }, (_, i) => "P" + i);
  ok(cleanAttendees(many, "", many).length === MAX_ATTENDEES && MAX_ATTENDEES === 8, "site-visits: at most 8 attendees");
  ok(readAttendees(undefined).length === 0 && readAttendees(["A", " A ", 3, "B"]).join("|") === "A|B",
    "site-visits: attendees normalize on read (missing → [], strings only, deduped)");

  const LEGACY = fixtureId("visits", "sv-legacy");
  try {
    await createFixture("site_visits", {
      id: LEGACY, customerId: null, customer: "TESTvisits Legacy", locationId: null, venue: "", address: "TESTvisits 1 Elm St",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: null, endAt: null, notes: "",
      assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1, stage: "claimed", leadId: null, surveyId: null, preferredTiming: "",
    });
    const legacy = await getVisit(LEGACY);
    ok(!!legacy && Array.isArray(legacy.attendees) && legacy.attendees.length === 0, "site-visits: a visit saved before attendees existed reads attendees as []");
    await scheduleVisit(LEGACY, at(9), at(10), ["Jeff"]);
    const s = await getVisit(LEGACY);
    ok(s?.stage === "scheduled" && s.attendees.join() === "Jeff" && visitPeople(s).join("|") === "Dana|Jeff",
      "site-visits: scheduleVisit stores attendees; visitPeople = lead + attendees");
    await scheduleVisit(LEGACY, at(11), at(12));
    ok((await getVisit(LEGACY))?.attendees.join() === "Jeff", "site-visits: scheduleVisit without attendees leaves them alone");
    const u = await updateVisitBooking(LEGACY, { startAt: at(13), endAt: at(14), assignedTo: "Sam", attendees: ["Dana", "Sam"] });
    ok(u?.assignedTo === "Sam" && u.attendees.join() === "Dana" && u.startAt === at(13) && u.endAt === at(14) && u.stage === "scheduled",
      "site-visits: updateVisitBooking sets time, lead and attendees (never the lead) and marks the visit scheduled");
    const SELF = fixtureId("visits", "sv-lead-attendee");
    await createFixture("site_visits", {
      id: SELF, customerId: null, customer: "TESTvisits Self", locationId: null, venue: "", address: "TESTvisits 2 Elm St",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: null, endAt: null, notes: "",
      assignedTo: "Dana", attendees: ["Dana", " Jeff ", "Dana"], createdBy: "x", createdAt: 1, updatedAt: 1, stage: "claimed", leadId: null, surveyId: null, preferredTiming: "",
    });
    ok((await getVisit(SELF))?.attendees.join() === "Jeff", "site-visits: a stored doc with the lead also in attendees reads without the lead");
    await scheduleVisit(SELF, at(9), at(10), ["Dana", "Sam"]);
    ok((await getVisit(SELF))?.attendees.join() === "Sam", "site-visits: scheduleVisit stores no attendee equal to the lead");
    const made = await createVisit({
      customerId: null, customer: "TESTvisits Created", locationId: null, venue: "", address: "TESTvisits 3 Elm St",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: null, endAt: null, notes: "",
      assignedTo: "Dana", createdBy: "x", stage: "claimed", leadId: null, surveyId: null, preferredTiming: "",
    });
    registerFixture("site_visits", made.id);
    ok(Array.isArray(made.attendees) && made.attendees.length === 0, "site-visits: createVisit defaults attendees to []");
    const made2 = await createVisit({
      customerId: null, customer: "TESTvisits Created 2", locationId: null, venue: "", address: "TESTvisits 4 Elm St",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: null, endAt: null, notes: "",
      assignedTo: "Dana", attendees: ["Dana", "Jeff"], createdBy: "x", stage: "claimed", leadId: null, surveyId: null, preferredTiming: "",
    });
    registerFixture("site_visits", made2.id);
    ok(made2.attendees.join() === "Jeff", "site-visits: createVisit never stores the lead as an attendee");
    ok((await updateVisitBooking(fixtureId("visits", "nope"), { startAt: at(9), endAt: at(10), assignedTo: "Dana", attendees: [] })) === null,
      "site-visits: updateVisitBooking on a missing visit returns null");
  } finally {
    await dropFixtures("visits");
  }

  const stops = stopsForDay({
    person: "Jeff",
    dayKey: DAY,
    visits: [{ id: "SV-A", label: "A", startAt: at(9), endAt: at(10), stage: "scheduled", people: visitPeople({ assignedTo: "Dana", attendees: ["Jeff"] }), address: okAddr(P1, "a") }],
    events: [],
  });
  ok(stops.map((s) => s.key).join() === "sv:SV-A", "site-visits: an attendee gets the visit as a stop on their own day (spec 1 seam)");
}

function inviteHarness(over: Partial<InviteDeps> = {}) {
  const calls: string[] = [];
  const mail: Array<{ to: string; subject: string; ics: string }> = [];
  let saved: { invites: VisitInviteRecipient[]; lead: VisitInviteRecipient | null } | null = null;
  let n = 0;
  const deps: Partial<InviteDeps> = {
    now: () => 5_000,
    gmailEnabled: () => true,
    users: async () => [
      { id: "u-dana", name: "Dana", email: "dana@peak.test" },
      { id: "u-jeff", name: "Jeff", email: "jeff@peak.test" },
      { id: "u-sam", name: "Sam", email: "sam@peak.test" },
    ],
    invitesOn: async () => true,
    calendarKeyFor: async (id) => (id === "u-dana" ? "personal:u-dana" : null),
    insertEvent: async (key) => { calls.push("insert " + key); return { id: "g-" + ++n }; },
    // Google answers an update with the event; "confirmed" = the copy is live (main's writeVisitCalendarEvent rule).
    updateEvent: async (key, id) => { calls.push(`update ${key} ${id}`); return { id, status: "confirmed" }; },
    deleteEvent: async (key, id) => { calls.push(`delete ${key} ${id}`); },
    sendIcs: async (o) => { mail.push({ to: o.toAddr, subject: o.subject, ics: o.ics("me@peak.test") }); return { gmailId: "m" + mail.length, gmailThreadId: "t", fromMailbox: "personal:me" }; },
    saveInvites: async (_id, invites, lead) => { saved = { invites, lead }; },
    log: () => {},
    ...over,
  };
  return { deps, calls, mail, saved: () => saved };
}

export async function siteVisitsInviteChecks(ok: Ok): Promise<void> {
  // The pure plan
  const cur = [rcpt("Dana"), rcpt("Jeff"), rcpt("Sam", { startAt: at(8) })];
  const p = planInviteChanges(cur, { people: ["Dana", "Sam", "Ann"], startAt: at(9), endAt: at(10) });
  ok(p.add.join() === "Ann" && p.keep.map((e) => e.name).join() === "Dana" && p.update.map((e) => e.name).join() === "Sam" && p.cancel.map((e) => e.name).join() === "Jeff",
    "site-visits invites: added → invite, removed → cancel, moved → update, unchanged → keep");
  ok(planInviteChanges(cur, null).cancel.length === 3 && planInviteChanges(cur, { people: ["Dana"], startAt: null, endAt: null }).cancel.length === 3,
    "site-visits invites: a deleted or unscheduled visit cancels everyone invited");

  // Legacy single-recipient stamps read as one entry
  const legacyIcs = normalizeInvites({ id: "SV-L", assignedTo: "Dana", startAt: at(9), endAt: at(10), invite: { sentAt: 7, to: "dana@peak.test", fromMailbox: "shared:sales", gmailId: "m9" } });
  ok(legacyIcs.length === 1 && legacyIcs[0].name === "Dana" && legacyIcs[0].channel === "ics" && legacyIcs[0].startAt === at(9) && legacyIcs[0].gmailId === "m9",
    "site-visits invites: an existing .ics stamp reads as one entry for the lead");
  const legacyCal = normalizeInvites({ id: "SV-L", assignedTo: "Dana", startAt: at(9), endAt: at(10), googleEventId: "gold" });
  ok(legacyCal.length === 1 && legacyCal[0].channel === "calendar" && legacyCal[0].eventId === "gold", "site-visits invites: an existing direct calendar event reads as one calendar entry");
  ok(normalizeInvites({ id: "x", assignedTo: "Dana", startAt: null, endAt: null }).length === 0 &&
     normalizeInvites({ id: "x", assignedTo: "Dana", startAt: null, endAt: null, invites: [{ name: "Dana", channel: "calendar" }, { name: "", channel: "ics" }, "junk"] }).length === 0,
    "site-visits invites: no stamp → none; malformed entries are dropped");
  ok(visitEventIds({ id: "x", assignedTo: "Dana", startAt: null, endAt: null, googleEventId: "g0", invites: [rcpt("Dana", { channel: "calendar", eventId: "g1" }), rcpt("Jeff")] }).join() === "g0,g1",
    "site-visits invites: visitEventIds lists every calendar copy (legacy + per recipient)");
  ok(visitUid("SV-7") === "sv-SV-7@peak-app", "site-visits invites: UID stays sv-<id>@peak-app");

  // .ics: default output unchanged; cancel = METHOD:CANCEL + STATUS:CANCELLED, same UID
  const base = { uid: "sv-SV-1@peak-app", title: "T", start: at(9), end: at(10), stampAt: 1 };
  const plain = buildIcs(base);
  ok(plain.includes("METHOD:PUBLISH") && !plain.includes("SEQUENCE:") && !plain.includes("STATUS:"), "site-visits ics: the default invite is unchanged (no SEQUENCE/STATUS)");
  const cancel = buildIcs({ ...base, method: "CANCEL", sequence: 2 });
  ok(cancel.includes("METHOD:CANCEL") && cancel.includes("STATUS:CANCELLED") && cancel.includes("SEQUENCE:2") && cancel.includes("UID:sv-SV-1@peak-app"),
    "site-visits ics: a cancellation keeps the UID and carries METHOD:CANCEL, STATUS:CANCELLED and a higher SEQUENCE");
  const who = { organizer: "me@peak.test", attendee: "jeff@peak.test" };
  const cancelTo = buildIcs({ ...base, method: "CANCEL", sequence: 2, ...who });
  ok(cancelTo.includes("\r\nORGANIZER:mailto:me@peak.test\r\n") && cancelTo.includes("\r\nATTENDEE:mailto:jeff@peak.test\r\n") &&
     cancelTo.indexOf("ORGANIZER:") > cancelTo.indexOf("BEGIN:VEVENT") && cancelTo.indexOf("ATTENDEE:") < cancelTo.indexOf("END:VEVENT"),
    "site-visits ics: a cancellation names the sending mailbox as ORGANIZER and the recipient as ATTENDEE inside the VEVENT (RFC 5546)");
  ok(buildIcs({ ...base, ...who }) === plain && buildIcs({ ...base, method: "PUBLISH", sequence: 1, ...who }) === buildIcs({ ...base, method: "PUBLISH", sequence: 1 }),
    "site-visits ics: a PUBLISH invite / update stays byte-identical (no ORGANIZER / ATTENDEE)");
  ok(icsMimeType(cancelTo) === "text/calendar; method=CANCEL" && icsMimeType(plain) === "text/calendar",
    "site-visits ics: the attachment type carries the .ics METHOD for a cancellation; PUBLISH stays text/calendar");
  const rawCancel = Buffer.from(buildRaw({ from: "me@peak.test", to: "jeff@peak.test", subject: "Cancelled: T", body: "b",
    attachments: [{ name: "site-visit.ics", mime: icsMimeType(cancelTo), dataBase64: Buffer.from(cancelTo).toString("base64") }] }), "base64url").toString("utf8");
  ok(rawCancel.includes('\r\nContent-Type: text/calendar; method=CANCEL; name="site-visit.ics"\r\n'),
    "site-visits ics: the cancellation email's MIME part is Content-Type: text/calendar; method=CANCEL");
  const bridgeSrc = readFileSync("src/lib/gmail/bridge.ts", "utf8");
  const svSend = bridgeSrc.slice(bridgeSrc.indexOf("export async function sendSiteVisitInvite("));
  ok(/const icsText = opts\.ics\(info\.address\)/.test(svSend) && /mime: icsMimeType\(icsText\)/.test(svSend),
    "site-visits: the Gmail bridge builds the .ics with the sending mailbox as ORGANIZER and sends it with the METHOD-matched type");

  // dispatch: new visit, lead with calendar grant + attendee without
  const me = { id: "u-me", name: "Me" };
  const h1 = inviteHarness();
  const v1 = sv("SV-T1", { attendees: ["Jeff"] });
  const r1 = await dispatchVisitInvite(v1, me, h1.deps);
  const s1 = h1.saved()!;
  ok(r1.status === "calendar" && h1.calls.join() === "insert personal:u-dana" && h1.mail.length === 1 && h1.mail[0].to === "jeff@peak.test" &&
     h1.mail[0].ics.includes("UID:sv-SV-T1@peak-app") && h1.mail[0].ics.includes("METHOD:PUBLISH"),
    "site-visits invites: every person gets it — a calendar event where the Calendar grant exists, else the .ics");
  ok(s1.invites.length === 2 && s1.invites[0].channel === "calendar" && s1.invites[0].eventId === "g-1" && s1.invites[1].channel === "ics" && s1.lead?.name === "Dana",
    "site-visits invites: each recipient's send is recorded (channel, event id, times)");
  ok(inviteSummary(r1.recipients) === "Added to Dana's Google Calendar. Invite emailed to Jeff.", "site-visits invites: the summary names each recipient");

  // move: update everyone, same UID, SEQUENCE + 1
  const h2 = inviteHarness();
  const v2 = sv("SV-T1", { attendees: ["Jeff"], startAt: at(13), endAt: at(14), invites: s1.invites });
  const r2 = await dispatchVisitInvite(v2, me, h2.deps);
  const s2 = h2.saved()!;
  ok(h2.calls.join() === "update personal:u-dana g-1" && h2.mail.length === 1 && h2.mail[0].ics.includes("SEQUENCE:1") && h2.mail[0].ics.includes("UID:sv-SV-T1@peak-app") &&
     h2.mail[0].subject.startsWith("Updated: ") && r2.recipients.every((x) => x.action === "update"),
    "site-visits invites: moving the visit updates every recipient (calendar PATCH; .ics with the same UID and SEQUENCE 1)");
  ok(s2.invites.every((e) => e.startAt === at(13) && e.endAt === at(14) && e.sequence === 1), "site-visits invites: the record now holds the new times and sequence");

  // A Google copy the person deleted answers the update non-confirmed: replaced, never doubled (main's drive-time rule, per recipient).
  const goneCalls: string[] = [];
  const h2b = inviteHarness({ updateEvent: async (key, id) => { goneCalls.push(`update ${key} ${id}`); return { id, status: "cancelled" }; } });
  await dispatchVisitInvite(sv("SV-T1", { startAt: at(13), endAt: at(14), invites: [{ ...s1.invites[0], eventId: "g-old" }] }), me, h2b.deps);
  ok([...goneCalls, ...h2b.calls].join() === "update personal:u-dana g-old,delete personal:u-dana g-old,insert personal:u-dana" && h2b.saved()!.invites[0].eventId === "g-1" &&
     h2b.saved()!.invites[0].startAt === at(13),
    "site-visits invites: a calendar update answered non-confirmed replaces that person's copy and records the new event id");

  // remove Jeff: METHOD:CANCEL to Jeff only
  const h3 = inviteHarness();
  const v3 = sv("SV-T1", { attendees: [], startAt: at(13), endAt: at(14), invites: s2.invites });
  await dispatchVisitInvite(v3, me, h3.deps);
  ok(h3.calls.length === 0 && h3.mail.length === 1 && h3.mail[0].to === "jeff@peak.test" && h3.mail[0].ics.includes("METHOD:CANCEL") && h3.mail[0].ics.includes("SEQUENCE:2") &&
     h3.mail[0].ics.includes("UID:sv-SV-T1@peak-app") && h3.saved()!.invites.map((e) => e.name).join() === "Dana" &&
     h3.mail[0].ics.includes("ORGANIZER:mailto:me@peak.test") && h3.mail[0].ics.includes("ATTENDEE:mailto:jeff@peak.test"),
    "site-visits invites: removing a person sends them a cancellation with the same UID; the lead is left alone");

  // delete: everyone cancelled
  const h4 = inviteHarness();
  const r4 = await cancelVisitInvites(sv("SV-T1", { invites: h3.saved()!.invites }), me, h4.deps);
  ok(h4.calls.join() === "delete personal:u-dana g-1" && h4.saved()!.invites.length === 0, "site-visits invites: deleting a visit removes it from every calendar");
  ok(r4.status === "calendar", "site-visits invites: a fully successful cancellation reports the lead's cancel status, not failed");

  // One person's throw never loses another's send: the rest go out and every send made is recorded.
  const h8 = inviteHarness({ invitesOn: async (n) => { if (n === "Dana") throw new Error("prefs down"); return true; } });
  const r8 = await dispatchVisitInvite(sv("SV-T5", { attendees: ["Jeff"] }), me, h8.deps);
  const s8 = h8.saved();
  ok(r8.recipients.find((x) => x.name === "Dana")?.status === "failed" && r8.recipients.find((x) => x.name === "Jeff")?.status === "sent" &&
     h8.mail.length === 1 && h8.mail[0].to === "jeff@peak.test" && s8?.invites.map((e) => e.name).join() === "Jeff",
    "site-visits invites: a throw for the first person still invites and records the second");
  const h9 = inviteHarness();
  await dispatchVisitInvite(sv("SV-T5", { attendees: ["Jeff"], invites: s8?.invites ?? [] }), me, h9.deps);
  ok(h9.mail.length === 0 && h9.calls.join() === "insert personal:u-dana" && h9.saved()?.invites.map((e) => e.name).sort().join() === "Dana,Jeff",
    "site-visits invites: the next save invites only the person who failed — the recorded send is never repeated");
  let gmailReads = 0;
  const h10 = inviteHarness({ gmailEnabled: () => { if (gmailReads++ === 0) throw new Error("config read failed"); return true; } });
  const r10 = await cancelVisitInvites(sv("SV-T6", { invites: [rcpt("Dana", { channel: "calendar", eventId: "g-9" }), rcpt("Jeff")] }), me, h10.deps);
  ok(r10.recipients.find((x) => x.name === "Dana")?.status === "failed" && h10.mail.length === 1 && h10.mail[0].to === "jeff@peak.test" &&
     h10.saved()?.invites.map((e) => e.name).join() === "Dana" && r10.status === "failed",
    "site-visits invites: a cancellation that throws keeps that entry (the next save retries it); the others still go out");

  // The summary: identical lines once; a calendar copy is never called an email.
  const h11 = inviteHarness({ gmailEnabled: () => false });
  const r11 = await dispatchVisitInvite(sv("SV-T7", { attendees: ["Jeff", "Sam"], startAt: at(13), endAt: at(14),
    invites: [rcpt("Dana", { channel: "calendar", eventId: "g-5" }), rcpt("Jeff"), rcpt("Sam")] }), me, h11.deps);
  ok(inviteSummary(r11.recipients) === "Calendar updates need Gmail connected. Email updates need Gmail connected.",
    "site-visits invites: the summary drops repeated lines and names a calendar update as a calendar update");

  // invites-off on add is not recorded (retried later); a failed update keeps the old entry
  const h5 = inviteHarness({ invitesOn: async (n) => n !== "Sam" });
  const r5 = await dispatchVisitInvite(sv("SV-T2", { attendees: ["Sam"] }), me, h5.deps);
  ok(r5.recipients.find((x) => x.name === "Sam")?.status === "invites-off" && !h5.saved()!.invites.some((e) => e.name === "Sam"),
    "site-visits invites: a person with invite emails off isn't recorded, so a later save retries them");
  const h6 = inviteHarness({ sendIcs: async () => { throw new Error("smtp down"); } });
  const before = [rcpt("Jeff")];
  const r6 = await dispatchVisitInvite(sv("SV-T3", { assignedTo: "Jeff", startAt: at(15), endAt: at(16), invites: before }), me, h6.deps);
  ok(r6.recipients[0].status === "failed" && h6.saved()!.invites[0].startAt === at(9), "site-visits invites: a failed update keeps the old entry so the next save retries it");
  const h7 = inviteHarness({ users: async () => { throw new Error("db down"); } });
  const r7 = await dispatchVisitInvite(sv("SV-T4", {}), me, h7.deps);
  ok(r7.status === "failed", "site-visits invites: dispatch never throws");

  // Store: a pre-spec-2 stamp is pinned to the times it was sent BEFORE a reschedule writes new ones,
  // so the first move after deploy still updates the lead's copy; the old single fields mirror the lead exactly.
  const LEG = fixtureId("visits", "sv-legacy-invite");
  try {
    await createFixture("site_visits", {
      id: LEG, customerId: null, customer: "TESTvisits Invite", locationId: null, venue: "", address: "TESTvisits 5 Elm St",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: at(9), endAt: at(10), notes: "",
      assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1, stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", googleEventId: "g-legacy",
    });
    ok((await getVisit(LEG))?.invites.map((e) => `${e.name}:${e.channel}:${e.eventId}`).join() === "Dana:calendar:g-legacy",
      "site-visits invites: a stored pre-spec-2 calendar stamp reads as the lead's entry");
    await scheduleVisit(LEG, at(13), at(14));
    const moved = await getVisit(LEG);
    ok(moved?.invites.length === 1 && moved.invites[0].startAt === at(9) && moved.invites[0].endAt === at(10) &&
       planInviteChanges(moved.invites, { people: visitPeople(moved), startAt: moved.startAt, endAt: moved.endAt }).update.length === 1,
      "site-visits invites: rescheduling a pre-spec-2 visit keeps the times the lead was told, so the move updates their copy");
    await setVisitInvites(LEG, [], null);
    const cleared = await getVisit(LEG);
    ok(!!cleared && !cleared.googleEventId && !cleared.invite && cleared.invites.length === 0 && visitEventIds(cleared).length === 0,
      "site-visits invites: once the lead holds no copy, the old googleEventId / invite fields are cleared too");
    await setVisitInvites(LEG, [rcpt("Dana", { channel: "calendar", eventId: "g-new" }), rcpt("Jeff")], rcpt("Dana", { channel: "calendar", eventId: "g-new" }));
    const mirrored = await getVisit(LEG);
    ok(mirrored?.googleEventId === "g-new" && !mirrored.invite && visitEventIds(mirrored).join() === "g-new",
      "site-visits invites: the lead's calendar entry is mirrored into googleEventId for older readers");
  } finally {
    await dropFixtures("visits");
  }

  // calendar copies dedupe on the drive chain
  ok(isVisitIcsCopy({ id: "g-77", iCalUID: "" }, [{ id: "SV-9", eventIds: ["g-77"] }]) && !isVisitIcsCopy({ id: "g-78", iCalUID: "" }, [{ id: "SV-9", eventIds: ["g-77"] }]),
    "site-visits: an attendee's direct calendar copy is recognised as the visit (counted once)");
  ok(/eventIds: visitEventIds\(v\)/.test(readFileSync("src/lib/drive-plan/load.ts", "utf8")), "site-visits: the drive loader hands every calendar copy id to the stop builder");
  const bridge = readFileSync("src/lib/gmail/bridge.ts", "utf8");
  ok(/d\.invites/.test(bridge) && /known\.add\(r\.gmailId\)/.test(bridge), "site-visits: per-recipient invite emails are skipped by the Gmail import like the old single stamp");
  const va = readFileSync("src/app/(app)/venue-assessments/visit-actions.ts", "utf8");
  const rm = va.slice(va.indexOf("export async function removeVisitAction("), va.indexOf("export async function scheduleVisitAction("));
  ok(rm.includes("await cancelVisitInvites(") && rm.indexOf("await cancelVisitInvites(") < rm.indexOf("await removeVisit(") && !rm.includes("deleteEvent("),
    "site-visits: deleting a visit cancels everyone's invite before the delete");
}

export async function siteVisitsSettingsChecks(ok: Ok): Promise<void> {
  ok(cleanWorkHours({ days: [5, 1, 1, 9, 2.5, 3], startMin: 480, endMin: 1020 })?.days.join() === "1,3,5",
    "site-visits settings: work days are whole 0–6, deduped and sorted");
  ok(cleanWorkHours({ days: [], startMin: 480, endMin: 1020 }) === null && cleanWorkHours({ days: [1], startMin: 600, endMin: 600 }) === null &&
     cleanWorkHours({ days: [1], startMin: -5, endMin: 600 }) === null && cleanWorkHours("x") === null,
    "site-visits settings: no days, an end not after the start, or junk is refused");
  ok(clockToMin("08:30") === 510 && clockToMin("24:00") === 1440 && clockToMin("24:01") === null && clockToMin("25:00") === null && clockToMin("8:5") === null && minToClock(510) === "08:30" && minToClock(1440) === "24:00",
    "site-visits settings: time inputs convert both ways; 24:00 is the end of the day, never clamped to 23:59");
  ok(fmtClock(1440) === "12:00 AM (end of day)" && fmtWorkHours({ days: [1], startMin: 480, endMin: 1440 }) === "Mon 8:00–midnight" &&
     cleanWorkHours({ days: [1], startMin: 480, endMin: 1440 }, true)?.endMin === 1440,
    "site-visits settings: an end of midnight (1440) is kept and prints as the end of the day (work hours say midnight)");
  ok(fmtClock(480) === "8:00" && fmtClock(1020) === "5:00" && fmtClock(750) === "12:30", "site-visits settings: clock times print 12-hour without am/pm");
  ok(fmtWorkHours(DEFAULT_WORK_HOURS) === "Mon–Fri 8:00–5:00" && fmtWorkHours({ days: [1, 3, 5], startMin: 450, endMin: 990 }) === "Mon, Wed, Fri 7:30–4:30" &&
     fmtWorkHours({ days: [0, 1, 2, 3, 4, 5, 6], startMin: 360, endMin: 1200 }) === "Every day 6:00–8:00",
    "site-visits settings: work hours print as the spec writes them");
  ok(JSON.stringify(readSchedulingSettings({})) === JSON.stringify(DEFAULT_SCHEDULING) &&
     DEFAULT_SCHEDULING.sameAreaMin === 45 && DEFAULT_SCHEDULING.dailyDriveLimitMin === 300 && DEFAULT_SCHEDULING.nearbyLookaheadDays === 21,
    "site-visits settings: defaults are Mon–Fri 8–5, 45 min same area, 5 h drive limit, 21 days");
  const mixed = readSchedulingSettings({ sameAreaMin: "30", dailyDriveLimitMin: 9999, nearbyLookaheadDays: 14, workHours: { days: [] } });
  ok(mixed.sameAreaMin === 30 && mixed.dailyDriveLimitMin === 300 && mixed.nearbyLookaheadDays === 14 && fmtWorkHours(mixed.workHours) === "Mon–Fri 8:00–5:00",
    "site-visits settings: a stored value out of range falls back to its default, field by field");
  const good = { workHours: { days: [1, 2, 3, 4], startMin: 420, endMin: 960 }, sameAreaMin: 30, dailyDriveLimitMin: 240, nearbyLookaheadDays: 14 };
  ok(cleanSchedulingInput(good).ok && !cleanSchedulingInput({ ...good, sameAreaMin: 0 }).ok && !cleanSchedulingInput({ ...good, dailyDriveLimitMin: "" }).ok &&
     !cleanSchedulingInput({ ...good, nearbyLookaheadDays: 90 }).ok && !cleanSchedulingInput({ ...good, workHours: { days: [], startMin: 1, endMin: 2 } }).ok,
    "site-visits settings: the admin save refuses blank or out-of-range values instead of storing a fallback");

  // Strict (save) path: a real whole number in range, nothing coerced or dropped.
  const wh = { days: [1, 2], startMin: 480, endMin: 1020 };
  ok(!cleanSchedulingInput({ ...good, workHours: { ...wh, days: [1, 9] } }).ok && !cleanSchedulingInput({ ...good, workHours: { ...wh, days: [1, 2.5] } }).ok &&
     !cleanSchedulingInput({ ...good, workHours: { ...wh, days: [1, "2"] } }).ok && !cleanSchedulingInput({ ...good, workHours: { ...wh, startMin: 480.5 } }).ok &&
     !cleanSchedulingInput({ ...good, workHours: { ...wh, endMin: 1020.5 } }).ok && !cleanSchedulingInput({ ...good, sameAreaMin: 30.5 }).ok &&
     !cleanSchedulingInput({ ...good, dailyDriveLimitMin: 240.5 }).ok && !cleanSchedulingInput({ ...good, nearbyLookaheadDays: 14.5 }).ok &&
     cleanSchedulingInput({ ...good, workHours: { ...wh, endMin: 1440 } }).ok,
    "site-visits settings: the admin save refuses an unknown weekday, a string weekday and fractional numbers (midnight is allowed)");
  ok(!cleanSchedulingInput({ ...good, sameAreaMin: "30" }).ok && !cleanSchedulingInput({ ...good, sameAreaMin: "1e1" }).ok && !cleanSchedulingInput({ ...good, sameAreaMin: "0x1A" }).ok &&
     !cleanSchedulingInput({ ...good, dailyDriveLimitMin: "240" }).ok && !cleanSchedulingInput({ ...good, nearbyLookaheadDays: "14" }).ok &&
     !cleanSchedulingInput({ ...good, workHours: { ...wh, startMin: "480" } }).ok && !cleanSchedulingInput({ ...good, sameAreaMin: NaN }).ok,
    "site-visits settings: the admin save needs real numbers — \"30\", \"1e1\", \"0x1A\" are refused");
  ok(cleanWorkHours({ days: [1, 9, 2], startMin: 480, endMin: 1020 })?.days.join() === "1,2" && cleanWorkHours({ days: [1, 9], startMin: 480, endMin: 1020 }, true) === null &&
     readSchedulingSettings({ sameAreaMin: "1e1" }).sameAreaMin === 10,
    "site-visits settings: reading stored data still drops a bad weekday and tolerates numeric strings");

  const db = await getDb();
  const U = "TESTvisits:u1";
  const [rawRow] = await db.select().from(blobs).where(eq(blobs.id, "schedule_defaults")); // the raw blob, not the default-resolved value
  const bufferBefore = (await getScheduleDefaults()).driveBufferMin;
  try {
    const saved = await saveSchedulingSettings(good);
    ok(saved.ok && JSON.stringify(await getSchedulingSettings()) === JSON.stringify(good), "site-visits settings: the company settings save and read back");
    ok((await getScheduleDefaults()).driveBufferMin === bufferBefore, "site-visits settings: saving them leaves spec 1's company buffer alone (same blob, merged)");
    const refused = await saveSchedulingSettings({ ...good, sameAreaMin: 999 });
    ok(!refused.ok && (await getSchedulingSettings()).sameAreaMin === 30, "site-visits settings: a refused save keeps the stored values");
    ok(JSON.stringify(await workHoursFor(U)) === JSON.stringify(good.workHours), "site-visits settings: a person without their own hours gets the company hours");
    const mine = { days: [2], startMin: 600, endMin: 900 };
    ok((await saveUserWorkHours(U, mine)).ok && JSON.stringify(await workHoursFor(U)) === JSON.stringify(mine), "site-visits settings: a person's own hours win");
    await saveUserSchedulePrefs(U, { driveBufferMin: 20 });
    ok(JSON.stringify(await getUserWorkHours(U)) === JSON.stringify(mine) && (await getUserSchedulePrefs(U)).driveBufferMin === 20,
      "site-visits settings: own hours and own drive buffer share the prefs blob without clobbering each other");
    ok(!(await saveUserWorkHours(U, { days: [] })).ok, "site-visits settings: bad personal hours are refused");
    const before = JSON.stringify(await getUserWorkHours(U));
    ok(!(await saveUserWorkHours(U, { days: [1, 9], startMin: 480, endMin: 1020 })).ok && !(await saveUserWorkHours(U, undefined)).ok &&
       !(await saveUserWorkHours(U, { days: [1, "2"], startMin: 480, endMin: 1020 })).ok && JSON.stringify(await getUserWorkHours(U)) === before,
      "site-visits settings: personal hours with an unknown weekday (or none given) are refused and nothing is stored");
    await saveUserWorkHours(U, null);
    ok((await getUserWorkHours(U)) === null && JSON.stringify(await workHoursFor(U)) === JSON.stringify(good.workHours),
      "site-visits settings: clearing personal hours falls back to the company default");
  } finally {
    if (rawRow) await db.update(blobs).set({ data: rawRow.data, updatedAt: rawRow.updatedAt }).where(eq(blobs.id, "schedule_defaults"));
    else await db.delete(blobs).where(eq(blobs.id, "schedule_defaults"));
    await db.delete(blobs).where(like(blobs.id, "%TESTvisits:%"));
  }

  const settingsActions = readFileSync("src/app/(app)/settings/actions.ts", "utf8");
  const accountActions = readFileSync("src/app/(app)/account/actions.ts", "utf8");
  ok(firstAwait(fnBody(settingsActions, "saveSchedulingSettingsAction"), 'requirePerm("manage_users")'), "site-visits settings: the company save is admin-only (its first await)");
  ok(firstAwait(fnBody(accountActions, "saveMyWorkHoursAction"), "requireUser()"), "site-visits settings: personal hours need a signed-in user (its first await)");
  ok(readFileSync("src/app/(app)/settings/groups/field.tsx", "utf8").includes("<SchedulingDefaultsCard") &&
     readFileSync("src/app/(app)/account/page.tsx", "utf8").includes("<WorkHoursCard"),
    "site-visits settings: Settings → Field shows the company card; Account shows personal work hours");
}

export async function siteVisitsConflictChecks(ok: Ok): Promise<void> {
  // Chicago wall clock
  ok(chicagoWallMs("2026-03-08", 480) === Date.UTC(2026, 2, 8, 13) && chicagoWallMs("2026-11-01", 480) === Date.UTC(2026, 10, 1, 14),
    "site-visits hours: 8:00 is 8:00 Chicago on both DST-change days");
  ok(chicagoWallMs(DAY, 1440) === chicagoDayStart(addDays(DAY, 1)) && chicagoWallMs("2026-03-08", 1430) === Date.UTC(2026, 2, 9, 4, 50),
    "site-visits hours: end-of-day and late-evening wall times land on the right instant");
  ok(chicagoMinuteOfDay(at(13, 30)) === 810 && weekdayOf(DAY) === 3 && fmtDayLabel(DAY) === "Wed Oct 15", "site-visits hours: minute of day, weekday and day label");
  const win = workWindow(DAY, DEFAULT_WORK_HOURS);
  ok(win?.startMs === at(8) && win.endMs === at(17) && workWindow(addDays(DAY, 3), DEFAULT_WORK_HOURS) === null,
    "site-visits hours: a work day's window is 8:00–5:00 Chicago; Saturday has none");
  const midnightWin = workWindow(DAY, { days: [3], startMin: 480, endMin: 1440 });
  ok(midnightWin?.endMs === at(24) && midnightWin.endMs - midnightWin.startMs === 16 * 3_600_000,
    "site-visits hours: an end of 1440 runs to the next Chicago midnight");
  const springWin = workWindow("2026-03-08", { days: [0], startMin: 480, endMin: 1440 });
  const fallWin = workWindow("2026-11-01", { days: [0], startMin: 480, endMin: 1440 });
  ok(springWin?.startMs === Date.UTC(2026, 2, 8, 13) && springWin.endMs === Date.UTC(2026, 2, 9, 5) &&
     fallWin?.startMs === Date.UTC(2026, 10, 1, 14) && fallWin.endMs === Date.UTC(2026, 10, 2, 6),
    "site-visits hours: a work window on a DST-change day ends at the real next midnight (23h and 25h days)");
  const lateOk = conflictsFor([vStop("sv:C", at(18), at(19), okAddr(P1, "c"))], [[BASE, P1, 30], [P1, BASE, 30]], [], { hours: { days: [3], startMin: 480, endMin: 1440 } });
  ok(!lateOk.conflicts.some((c) => c.kind === "outside_hours"), "site-visits conflicts: with hours ending at midnight, an evening visit and its drive home are inside");
  ok(chicagoMinuteOfDay(Date.UTC(2026, 2, 8, 13)) === 480 && chicagoMinuteOfDay(Date.UTC(2026, 10, 1, 14)) === 480,
    "site-visits hours: minute of day reads 8:00 on both DST-change days");

  // Busy blocks: what counts as busy
  const visits: BusyVisit[] = [
    { id: "SV-1", label: "Lone Pine", startAt: at(9), endAt: at(10), stage: "scheduled", people: ["Dana", "Jeff"], eventIds: ["gev-1"] },
    { id: "SV-2", label: "Other", startAt: at(11), endAt: at(12), stage: "scheduled", people: ["Sam"], eventIds: [] },
    { id: "SV-3", label: "Unscheduled", startAt: null, endAt: null, stage: "claimed", people: ["Dana"], eventIds: [] },
    { id: "SV-4", label: "Requested w/ time", startAt: at(13), endAt: at(14), stage: "requested", people: ["Dana"], eventIds: [] },
    { id: "SV-9", label: "Being edited", startAt: at(15), endAt: at(16), stage: "scheduled", people: ["Dana"], eventIds: [] },
  ];
  const ev = (id: string, over: Partial<BusyEvent>): BusyEvent => ({ id, iCalUID: id + "@google.com", title: id, startMs: at(15), endMs: at(16), allDay: false, selfDeclined: false, selfResponse: "", peakDriveKey: "", ...over });
  const events = [
    ev("own", {}), ev("accepted", { selfResponse: "accepted" }), ev("tentative", { selfResponse: "tentative" }), ev("needs", { selfResponse: "needsAction" }),
    ev("declined", { selfDeclined: true, selfResponse: "declined" }), ev("allday", { allDay: true }), ev("drive", { peakDriveKey: "u1|x|a|b" }),
    ev("ics", { iCalUID: "sv-SV-1@peak-app" }), ev("gev-1", {}), ev("copy-of-edited", { iCalUID: "sv-SV-9@peak-app" }),
  ];
  const blocks = busyBlocks({ person: "Dana", visits, events, excludeVisitId: "SV-9" });
  ok(blocks.map((b) => b.key).sort().join() === "g:accepted,g:own,sv:SV-1",
    "site-visits busy: my scheduled visits + my own and accepted timed events; never tentative, unanswered, declined, all-day, drive events, a visit's calendar copies, or the visit being edited");
  ok(busyBlocks({ person: "Dana", visits, events: null }).map((b) => b.key).join() === "sv:SV-1,sv:SV-9", "site-visits busy: no calendar → visits only");
  ok(fmtBusy([busyEv("a", at(9), at(10)), busyEv("b", at(9, 30), at(11, 30)), busyEv("c", at(14), at(15))]) === "9–11:30, 2–3", "site-visits busy: busy times merge and print 9–11:30, 2–3");
  ok(fmtBusyRange({ startMs: at(22), endMs: at(24) }) === "10–midnight" && fmtBusyRange({ startMs: at(0), endMs: at(2) }) === "midnight–2" &&
     fmtBusyRange({ startMs: at(0), endMs: at(24) }) === "all day" && fmtBusyRange({ startMs: at(9), endMs: at(10, 30) }) === "9–10:30",
    "site-visits busy: an end at the Chicago midnight prints 'midnight' (a block spanning the whole day, 'all day')");
  ok(fmtBusyRange({ startMs: at(22), endMs: at(26) }) === "Wed 10 – Thu 2" && fmtBusyRange({ startMs: at(22), endMs: at(24 + 24) }) === "Wed 10 – Thu midnight",
    "site-visits busy: a block that crosses midnight names both days");
  const mapped = toCalendarEvents([
    { id: "a", summary: "A", start: { dateTime: "2036-10-15T14:00:00Z" }, end: { dateTime: "2036-10-15T15:00:00Z" }, attendees: [{ email: "me@x.com", self: true, responseStatus: "tentative" }] },
    { id: "b", summary: "B", start: { dateTime: "2036-10-15T14:00:00Z" }, end: { dateTime: "2036-10-15T15:00:00Z" } },
  ]);
  ok(mapped[0].selfResponse === "tentative" && mapped[1].selfResponse === "", "site-visits calendar: my own response is read (blank on my own events)");

  // Double-booked
  const C = vStop("sv:C", at(10), at(11), okAddr(P1, "c"));
  const r60: Array<[LatLng, LatLng, number]> = [[BASE, P1, 60], [P1, BASE, 60]];
  const body = conflictsFor([C], r60, [busyEv("Board meeting", at(10, 30), at(11, 30))]);
  ok(body.driveChecked && body.conflicts.length === 1 && body.conflicts[0].kind === "double_booked" && body.conflicts[0].text === "Double-booked — overlaps Board meeting (10:30–11:30)",
    "site-visits conflicts: a visit overlapping a busy block is double-booked");
  const C11 = vStop("sv:C", at(11), at(12), okAddr(P1, "c"));
  const drive = conflictsFor([C11], r60, [busyEv("Call", at(10), at(10, 30)), busyEv("Lunch", at(12), at(13))]);
  ok(drive.conflicts.length === 1 && drive.conflicts[0].text === "Double-booked — the drive there overlaps Call (10–10:30)",
    "site-visits conflicts: an overlap caused only by the drive block counts; back-to-back doesn't");
  const unv = conflictsFor([vStop("sv:C", at(11), at(12), badAddr("c"))], r60, [busyEv("Call", at(10), at(10, 30))]);
  ok(!unv.driveChecked && unv.conflicts.length === 0, "site-visits conflicts: an unverified address is checked without drive time (no drive-block overlap)");
  // Without the driveChecked gate this day (two far verified stops around the unverified one) would read "Too much driving".
  const X1 = vStop("sv:X1", at(9), at(10), okAddr(P2, "x1"));
  const X2 = vStop("sv:X2", at(13), at(14), okAddr(P2, "x2"));
  const unvFar = conflictsFor([X1, vStop("sv:C", at(11), at(12), badAddr("c")), X2], [[BASE, P2, 150], [P2, BASE, 150]], []);
  ok(!unvFar.driveChecked && unvFar.conflicts.length === 0, "site-visits conflicts: an unverified candidate gets no drive-based flags even when the day's other legs are long");

  // Per-leg gating: a verified candidate followed by an unresolved stop still gets its drive-to checks
  const U = vStop("sv:U", at(14), at(15), badAddr("u"));
  const A0 = vStop("sv:A", at(9), at(10, 30), okAddr(P2, "a"));
  const toChecked = conflictsFor([A0, C11, U], [[BASE, P2, 30], [P2, P1, 40]], [busyEv("Call", at(10, 30), at(10, 45))]);
  ok(toChecked.driveChecked && toChecked.conflicts.some((c) => c.kind === "tight_drive" && c.text === "Tight — needs 55m, has 30m") &&
     toChecked.conflicts.some((c) => c.text === "Double-booked — the drive there overlaps Call (10:30–10:45)"),
    "site-visits conflicts: a flagged drive-out leg doesn't switch off the drive-to double-booking and tight checks");
  const earlyThenU = conflictsFor([vStop("sv:C", at(8), at(9), okAddr(P1, "c")), vStop("sv:U", at(14), at(15), badAddr("u"))], r60, []);
  ok(earlyThenU.driveChecked && earlyThenU.conflicts.some((c) => c.kind === "outside_hours"), "site-visits conflicts: the drive-to still counts toward work hours when the next stop is unresolved");
  const flaggedTo = conflictsFor([vStop("sv:A", at(9), at(10), badAddr("a")), C11], [[P1, BASE, 60]], [busyEv("Call", at(10), at(10, 30))]);
  ok(!flaggedTo.driveChecked && flaggedTo.conflicts.length === 0, "site-visits conflicts: a flagged drive-to leg means the drive-based checks are skipped and the note shows");

  // Tight drive
  const A = vStop("sv:A", at(9), at(10, 30), okAddr(P2, "a"));
  const tight = conflictsFor([A, C11], [[BASE, P2, 30], [P2, P1, 40], [P1, BASE, 60]], []);
  ok(tight.conflicts.some((c) => c.kind === "tight_drive" && c.text === "Tight — needs 55m, has 30m"), "site-visits conflicts: spec 1's tight leg shows before booking");
  const tightTwice = conflictsFor([A, C11], [[BASE, P2, 30], [P2, P1, 40], [P1, BASE, 60]], [{ ...busyEv("A", at(9), at(10, 30)), key: "sv:A", kind: "visit" }]);
  ok(tightTwice.conflicts.filter((c) => c.kind === "tight_drive").length === 1 && !tightTwice.conflicts.some((c) => c.kind === "double_booked"),
    "site-visits conflicts: a tight leg isn't also reported as the drive overlapping the stop just before it");
  const tightOther = conflictsFor([A, C11], [[BASE, P2, 30], [P2, P1, 40], [P1, BASE, 60]], [busyEv("Call", at(10, 30), at(10, 45))]);
  ok(tightOther.conflicts.some((c) => c.kind === "tight_drive") && tightOther.conflicts.some((c) => c.text === "Double-booked — the drive there overlaps Call (10:30–10:45)"),
    "site-visits conflicts: a tight leg still reports the drive overlapping something other than the stop before it");

  // Outside work hours
  const early = conflictsFor([vStop("sv:C", at(8), at(9), okAddr(P1, "c"))], r60, []);
  ok(early.conflicts.some((c) => c.kind === "outside_hours" && c.text === "Outside work hours (8:00–5:00)"), "site-visits conflicts: a drive starting before 8:00 is outside work hours");
  const sat = conflictsFor([vStop("sv:C", at(10, 0, 3), at(11, 0, 3), okAddr(P1, "c"))], r60, [], { dayKey: addDays(DAY, 3) });
  ok(sat.conflicts.some((c) => c.text === "Outside work hours — Saturday isn't a work day"), "site-visits conflicts: a visit on a non-work day is flagged");
  const late = conflictsFor([vStop("sv:C", at(15, 30), at(16, 45), okAddr(P1, "c"))], r60, []);
  ok(late.conflicts.some((c) => c.kind === "outside_hours"), "site-visits conflicts: the drive back counts toward work hours");
  const midnightHours = { days: [3], startMin: 480, endMin: 1440 };
  const beforeMidnight = conflictsFor([vStop("sv:C", at(6), at(7), okAddr(P1, "c"))], r60, [], { hours: midnightHours });
  ok(beforeMidnight.conflicts.some((c) => c.text === "Outside work hours (8:00–midnight)"), "site-visits conflicts: hours ending at 1440 print as 8:00–midnight");
  const roomy = conflictsFor([vStop("sv:C", at(8), at(9), okAddr(P1, "c"))], r60, [], { hours: { days: [0, 1, 2, 3, 4, 5, 6], startMin: 360, endMin: 1200 } });
  ok(!roomy.conflicts.some((c) => c.kind === "outside_hours"), "site-visits conflicts: a person's own hours decide");

  // Too much driving (buffer included)
  const C12 = vStop("sv:C", at(12), at(13), okAddr(P1, "c"));
  const far = conflictsFor([C12], [[BASE, P1, 150], [P1, BASE, 150]], []);
  ok(far.conflicts.some((c) => c.kind === "too_much_driving" && c.text === "Too much driving — 5h 30m of 5h"), "site-visits conflicts: a day over the drive limit is flagged as 5h 30m of 5h");
  const withBuffer = conflictsFor([C12], [[BASE, P1, 140], [P1, BASE, 140]], []);
  ok(withBuffer.conflicts.some((c) => c.text === "Too much driving — 5h 10m of 5h"), "site-visits conflicts: the limit counts the buffer (280 min of road + 30 of buffer > 5h)");
  ok(!conflictsFor([C12], [[BASE, P1, 140], [P1, BASE, 140]], [], { dailyDriveLimitMin: 330 }).conflicts.some((c) => c.kind === "too_much_driving"),
    "site-visits conflicts: under the limit → no flag");

  // checkVisit — several attendees, calendar notes
  const p = dayPlan([C], r60);
  const res = checkVisit({ key: "sv:C" }, [
    { person: "Dana", dayKey: DAY, ...p, busy: [busyEv("Board meeting", at(10, 30), at(11, 30))], hours: DEFAULT_WORK_HOURS, calendar: "ok" },
    { person: "Jeff", dayKey: DAY, ...p, busy: [], hours: DEFAULT_WORK_HOURS, calendar: "failed" },
    { person: "Sam", dayKey: DAY, ...dayPlan([{ ...C, address: badAddr("c") }], []), busy: [], hours: DEFAULT_WORK_HOURS, calendar: "no-calendar" },
  ], { dailyDriveLimitMin: 300 });
  ok(res.length === 3 && res[0].conflicts.length === 1 && res[0].notes.length === 0, "site-visits checkVisit: conflicts are per attendee");
  ok(res[1].conflicts.length === 0 && res[1].notes.includes("Couldn't check Jeff's calendar") && res[1].calendar === "failed",
    "site-visits checkVisit: an unreadable calendar says so — never reads as no conflicts");
  ok(res[2].notes.includes("Checked without drive time") && res[2].notes.includes("Sam has no connected calendar — checked visits only"),
    "site-visits checkVisit: unverified address and no calendar each leave a note");
}

export async function siteVisitsNearbyChecks(ok: Ok): Promise<void> {
  const CAND: LatLng = { lat: 44.05, lng: -88.05 };
  const d = (n: number) => addDays(DAY, n);
  const leadDays: LeadDay[] = [
    { dayKey: d(1), stops: [vStop("sv:A", at(9, 0, 1), at(10, 0, 1), okAddr(P1, "a"), "Lone Pine Elementary")], busy: [busyEv("Lone Pine", at(9, 0, 1), at(11, 30, 1))] },
    { dayKey: d(2), stops: [vStop("sv:B", at(9, 0, 2), at(10, 0, 2), okAddr(P2, "b"))], busy: [] },
    { dayKey: d(3), stops: [vStop("sv:FAR", at(9, 0, 3), at(10, 0, 3), okAddr(FAR, "far"))], busy: [] },
    { dayKey: d(4), stops: [vStop("sv:U", at(9, 0, 4), at(10, 0, 4), badAddr("u"))], busy: [] },
    { dayKey: d(5), stops: [vStop("sv:SELF", at(9, 0, 5), at(10, 0, 5), okAddr(CAND, "self"))], busy: [] },
    { dayKey: d(6), stops: [vStop("sv:B6", at(9, 0, 6), at(10, 0, 6), okAddr(P2, "b6"))], busy: [] },
  ];
  ok(straightLineMiles(P1, P1) === 0 && Math.round(straightLineMiles(P1, FAR)) === 138 && couldBeSameArea(P1, CAND, 45) && !couldBeSameArea(FAR, CAND, 45),
    "site-visits nearby: the straight-line pre-filter keeps plausible stops and drops ones 100+ miles away");
  const pairs = nearbyPairs(CAND, leadDays, 45, "sv:SELF");
  ok(pairs.length === 2 && !pairs.some((p) => p.from.lat === FAR.lat) && pairs.every((p) => p.to === CAND),
    "site-visits nearby: only verified, plausible stops are routed (far, unverified and the visit itself skipped), stop → candidate, deduped");

  const routes = new Map([[pairKey(P1, CAND), 18], [pairKey(P2, CAND), 12]]);
  const others = [
    { person: "Jeff", calendar: "ok" as const, hours: DEFAULT_WORK_HOURS, busy: [busyEv("Jeff thing", at(13, 30, 1), at(14, 0, 1))] },
    { person: "Sam", calendar: "failed" as const, hours: DEFAULT_WORK_HOURS, busy: [] },
  ];
  const res = suggestDays({ candidate: { key: "sv:SELF", point: CAND, startMs: at(13), endMs: at(14) }, leadDays, routeMinutes: routes, sameAreaMin: 45, lookaheadDays: 21, others });
  ok(res.status === "ok" && res.days.map((x) => x.dayKey).join() === [d(2), d(6), d(1)].join(),
    "site-visits nearby: ranked by nearest drive minutes, then soonest");
  const day1 = res.status === "ok" ? res.days[2] : null;
  ok(!!day1 && nearbyLine(day1) === "Thu Oct 16 · 18 min from Lone Pine Elementary · busy 9–11:30",
    "site-visits nearby: a row reads date · minutes from the nearest stop · the lead's busy times");
  ok(!!day1 && day1.others.map((o) => `${o.person}:${o.status}`).join() === "Jeff:conflict,Sam:unknown" &&
     res.status === "ok" && res.days[0].others.map((o) => `${o.person}:${o.status}`).join() === "Jeff:free,Sam:unknown",
    "site-visits nearby: each other attendee shows free / conflict at the chosen time that day (unknown when their calendar can't be read)");
  ok(res.status === "ok" && res.days.every((x) => x.nearest.minutes === 12 || x.nearest.minutes === 18),
    "site-visits nearby: every minute shown is a routed drive time, never a straight-line estimate");

  const over = suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays: leadDays.slice(0, 1), routeMinutes: new Map([[pairKey(P1, CAND), 50]]), sameAreaMin: 45, lookaheadDays: 21, others: [] });
  ok(over.status === "ok" && over.days.length === 0, "site-visits nearby: a stop more than the same-area minutes away isn't nearby");
  ok(suggestDays({ candidate: { key: "sv:X", point: null, startMs: null, endMs: null }, leadDays, routeMinutes: routes, sameAreaMin: 45, lookaheadDays: 21, others: [] }).status === "unverified",
    "site-visits nearby: an unverified candidate address asks for verification");
  ok(suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays, routeMinutes: new Map(), sameAreaMin: 45, lookaheadDays: 21, others: [] }).status === "unavailable",
    "site-visits nearby: no drive times for plausible stops (OSRM down) → unavailable, never guessed");
  const partial = suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays: leadDays.slice(0, 2), routeMinutes: new Map([[pairKey(P1, CAND), 18]]), sameAreaMin: 45, lookaheadDays: 21, others: [] });
  ok(partial.status === "ok" && partial.days.map((x) => x.dayKey).join() === d(1), "site-visits nearby: a stop without a routed time is left out, not estimated");
  ok(suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays: [leadDays[2]], routeMinutes: new Map(), sameAreaMin: 45, lookaheadDays: 21, others: [] }).status === "ok",
    "site-visits nearby: nothing plausible nearby is an empty strip, not 'unavailable'");
  const many: LeadDay[] = Array.from({ length: 7 }, (_, i) => ({ dayKey: d(i + 1), stops: [vStop("sv:M" + i, at(9, 0, i + 1), at(10, 0, i + 1), okAddr(P1, "m" + i))], busy: [] }));
  const capped = suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays: many, routeMinutes: new Map([[pairKey(P1, CAND), 10]]), sameAreaMin: 45, lookaheadDays: 21, others: [] });
  ok(capped.status === "ok" && capped.days.length === MAX_NEARBY_DAYS && MAX_NEARBY_DAYS === 5 && capped.days[4].dayKey === d(5), "site-visits nearby: at most 5 days, the soonest on a tie");
  const noTime = suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays: leadDays.slice(0, 2), routeMinutes: routes, sameAreaMin: 45, lookaheadDays: 21, others: [others[0]] });
  ok(noTime.status === "ok" && noTime.days.find((x) => x.dayKey === d(1))?.others[0].status === "conflict" && noTime.days.find((x) => x.dayKey === d(2))?.others[0].status === "free",
    "site-visits nearby: with no time picked yet, an attendee is free when nothing is booked inside their work hours that day");

  // An event running past midnight reads as ending at midnight on the day it's shown
  const overnight = suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: null, endMs: null }, leadDays: [{ ...leadDays[0], busy: [busyEv("Load-out", at(22, 0, 1), at(26, 0, 1))] }], routeMinutes: routes, sameAreaMin: 45, lookaheadDays: 21, others: [] });
  ok(overnight.status === "ok" && overnight.days[0].busyText === "10–midnight", "site-visits nearby: a busy block running past midnight shows to midnight on that day");

  // The straight-line distance is only a pre-filter: one definition, one use.
  const dir = "src/lib/visit-plan";
  const uses = readdirSync(dir).reduce((n, f) => n + (readFileSync(join(dir, f), "utf8").match(/straightLineMiles\(/g) ?? []).length, 0);
  const banned = /\b(estimate|estimateFromParts|driveMinutes|driveMiles|haversineMiles|minutesFromMiles)\b\s*\(/;
  ok(uses === 2 && !readdirSync(dir).some((f) => banned.test(readFileSync(join(dir, f), "utf8"))),
    "site-visits pin: the straight-line distance feeds only the pre-filter, and nothing in visit-plan calls a straight-line drive estimate");

  // attendeeStatusOn's other branches
  const att = (over: Partial<Parameters<typeof attendeeStatusOn>[0]> = {}) => ({ person: "Sam", calendar: "ok" as const, hours: DEFAULT_WORK_HOURS, busy: [], ...over });
  ok(weekdayOf(d(3)) === 6 && attendeeStatusOn(att(), d(3), null) === "conflict" && attendeeStatusOn(att(), d(3), { startMs: at(13, 0, 3), endMs: at(14, 0, 3) }) === "conflict",
    "site-visits nearby: a day that isn't one of the attendee's work days is a conflict");
  ok(attendeeStatusOn(att(), d(1), { startMs: at(7, 0, 1), endMs: at(8, 30, 1) }) === "conflict" && attendeeStatusOn(att(), d(1), { startMs: at(16, 30, 1), endMs: at(17, 30, 1) }) === "conflict" &&
     attendeeStatusOn(att(), d(1), { startMs: at(8, 0, 1), endMs: at(17, 0, 1) }) === "free",
    "site-visits nearby: a slot outside the attendee's own hours is a conflict (exactly their hours is free)");
  ok(attendeeStatusOn(att({ calendar: "no-calendar" }), d(1), { startMs: at(13, 0, 1), endMs: at(14, 0, 1) }) === "free" &&
     attendeeStatusOn(att({ calendar: "no-calendar", busy: [{ key: "sv:Q", kind: "visit", label: "Q", startMs: at(13, 30, 1), endMs: at(15, 0, 1) }] }), d(1), { startMs: at(13, 0, 1), endMs: at(14, 0, 1) }) === "conflict",
    "site-visits nearby: no calendar → judged on their visits alone");
  const vo = suggestDays({ candidate: { key: "sv:X", point: CAND, startMs: at(13), endMs: at(14) }, leadDays: leadDays.slice(1, 2), routeMinutes: routes, sameAreaMin: 45, lookaheadDays: 21,
    others: [att({ person: "Sam", calendar: "no-calendar" }), att({ person: "Jeff" }), att({ person: "Ann", calendar: "failed" })] });
  ok(vo.status === "ok" && vo.days[0].others.map((o) => `${o.person}:${o.status}:${o.note ?? ""}`).join() === `Sam:free:${VISITS_ONLY_NOTE},Jeff:free:,Ann:unknown:` && VISITS_ONLY_NOTE === "checked visits only",
    "site-visits nearby: an attendee with no calendar carries 'checked visits only', like the conflict panel's note");
  ok((readFileSync("src/lib/visit-plan/nearby.ts", "utf8").match(/candidateStops\(/g) ?? []).length === 3,
    "site-visits pin: nearbyPairs and suggestDays share one candidateStops filter");
}

function bookingHarness(over: Partial<BookingDeps> = {}) {
  const reads: Array<{ userId: string; timeMaxMs: number }> = [];
  const budgets: number[] = [];
  const asked: Array<{ from: LatLng; to: LatLng }> = [];
  const routeCalls: Array<Array<{ from: LatLng; to: LatLng }>> = [];
  const stateReads: string[][] = [];
  const people = [{ id: "u1", name: "Dana", status: "active" }, { id: "u2", name: "Jeff", status: "active" }, { id: "u3", name: "Sam", status: "active" }];
  const driveBase: Partial<DriveLoadDeps> = {
    getUser: async (id) => { const u = people.find((p) => p.id === id); return u ? { id: u.id, name: u.name, officeId: null } : null; },
    offices: async () => [office],
    bufferMin: async () => 15,
    stayOvers: async () => ({}),
    placeStates: async (texts) => new Map(texts.map((t) => [addressKey(t), okAddr(P2, t)])),
  };
  const deps: Partial<BookingDeps> = {
    now: () => at(8),
    users: async () => people,
    settings: async () => DEFAULT_SCHEDULING,
    workHours: async () => DEFAULT_WORK_HOURS,
    visits: async () => [
      sv("SV-V1", { address: "p1", startAt: at(10, 0, 1), endAt: at(11, 0, 1) }),
      sv("SV-E", { address: "p1", startAt: at(9, 0, 2), endAt: at(10, 0, 2) }),
      sv("SV-V3", { assignedTo: "Jeff", address: "p1", startAt: at(13, 0, 1), endAt: at(15, 0, 1) }),
      sv("SV-V4", { address: "far", startAt: at(9, 0, 3), endAt: at(10, 0, 3) }),
    ],
    visitStates: async (vs) => {
      stateReads.push(vs.map((v) => v.id));
      return new Map(vs.map((v) => [v.id, v.address === "bad" ? badAddr("bad") : v.address === "far" ? okAddr(FAR, "far") : v.address === "p2" ? okAddr(P2, "p2") : okAddr(P1, v.address)]));
    },
    readEvents: async (userId, range) => {
      reads.push({ userId, timeMaxMs: range.timeMaxMs });
      if (userId === "u1")
        return { status: "ok", events: [gEvent("zoom", at(13, 30, 1), at(14, 0, 1), { title: "Zoom call", location: "Zoom" }), gEvent("e-copy", at(9, 0, 2), at(10, 0, 2), { iCalUID: "sv-SV-E@peak-app" })] };
      if (userId === "u2") return { status: "failed", events: [] };
      return { status: "no-calendar", events: [] };
    },
    plan: (args) => planDriveDays({ ...args, deps: { ...driveBase, ...args.deps } }),
    routes: async (pairs, budgetMs) => {
      budgets.push(budgetMs);
      asked.push(...pairs);
      routeCalls.push(pairs);
      return new Map(pairs.map((p) => [pairKey(p.from, p.to), 20]));
    },
    ...over,
  };
  return { deps, reads, budgets, asked, routeCalls, stateReads };
}

export async function siteVisitsLoaderChecks(ok: Ok): Promise<void> {
  const d = (n: number) => addDays(DAY, n);
  const NEW: BookingCheckInput = { visitId: null, customerId: null, locationId: null, address: "p2", startAt: at(13, 0, 1), endAt: at(14, 0, 1), lead: "Dana", attendees: ["Jeff", "Sam"] };
  // The viewer is Dana (the lead) unless a check says otherwise — her own event titles show.
  const V = { viewerId: "u1" };

  const h = bookingHarness();
  const r = await loadBookingCheck(NEW, V, h.deps);
  const [dana, jeff, sam] = r.people;
  ok(r.people.map((p) => p.person).join() === "Dana,Jeff,Sam" && r.address.status === "verified", "site-visits loader: one row per person, lead first");
  ok(dana.conflicts.length === 1 && dana.conflicts[0].text === "Double-booked — overlaps Zoom call (1:30–2)" && dana.notes.length === 0,
    "site-visits loader: the lead's accepted Google event (a video call, not a stop) double-books the visit");
  const asJeff = await loadBookingCheck(NEW, { viewerId: "u2" }, bookingHarness().deps);
  ok(asJeff.people[0].conflicts.length === 1 && asJeff.people[0].conflicts[0].text === "Double-booked — overlaps a calendar event (1:30–2)" && OTHERS_EVENT_LABEL === "a calendar event",
    "site-visits loader: someone else's Google event is 'a calendar event' — its title never reaches the viewer");
  // Every calendar has a private title; the viewer (Jeff) sees only his own. Dana's located event is her only stop on d+4.
  const secrets = bookingHarness({
    readEvents: async (userId) => {
      if (userId === "u1")
        return { status: "ok", events: [gEvent("dz", at(13, 30, 1), at(14, 0, 1), { title: "Dana private zoom", location: "Zoom" }), gEvent("dd", at(9, 0, 4), at(10, 0, 4), { title: "Dana dentist", location: "9 Oak St, Appleton, WI" })] };
      if (userId === "u2") return { status: "ok", events: [gEvent("jo", at(13, 15, 1), at(13, 45, 1), { title: "Jeff own lunch" })] };
      return { status: "ok", events: [gEvent("so", at(13, 0, 1), at(13, 30, 1), { title: "Sam therapy" }), gEvent("sd", at(9, 0, 4), at(10, 0, 4), { title: "Sam on d4" })] };
    },
  });
  const seen = await loadBookingCheck(NEW, { viewerId: "u2" }, secrets.deps);
  const json = JSON.stringify(seen);
  const d4 = seen.nearby?.status === "ok" ? seen.nearby.days.find((x) => x.dayKey === d(4)) : undefined;
  ok(!/Dana private zoom|Dana dentist|Sam therapy|Sam on d4/.test(json) && json.includes("Jeff own lunch") && d4?.nearest.label === OTHERS_EVENT_LABEL &&
     seen.people[0].conflicts.some((c) => c.text === "Double-booked — overlaps a calendar event (1:30–2)") && seen.people[2].conflicts.some((c) => c.text === "Double-booked — overlaps a calendar event (1–1:30)"),
    "site-visits loader: no other person's event title appears anywhere in the result — the viewer's own titles do");
  const ownView = await loadBookingCheck(NEW, V, secrets.deps);
  const ownD4 = ownView.nearby?.status === "ok" ? ownView.nearby.days.find((x) => x.dayKey === d(4)) : undefined;
  ok(ownD4?.nearest.label === "Dana dentist" && !JSON.stringify(ownView).includes("Jeff own lunch"), "site-visits loader: the lead's own located event keeps its title for the lead (nearby: '18 min from …')");
  ok(r.nearby?.status === "ok" && r.nearby.leadCalendar === "ok" && !r.nearby.note, "site-visits loader: nearby days carry the lead's calendar read");
  const leadDown = await loadBookingCheck({ ...NEW, startAt: null, endAt: null }, V, bookingHarness({ readEvents: async (userId) => (userId === "u1" ? { status: "failed", events: [] } : { status: "no-calendar", events: [] }) }).deps);
  ok(leadDown.people.length === 0 && leadDown.nearby?.status === "ok" && leadDown.nearby.leadCalendar === "failed" && leadDown.nearby.note === "Couldn't check Dana's calendar",
    "site-visits loader: a failed lead calendar read is flagged on nearby days, never silent");
  ok(h.stateReads.length === 1 && h.stateReads[0][0] === NEW_VISIT_ID, "site-visits loader: addresses are read once per check, reused by every plan");
  ok(h.routeCalls.length > 1 && h.routeCalls[0].length > 0 && h.routeCalls[0].every((p) => p.to.lat === P2.lat && p.from.lat === P1.lat),
    "site-visits loader: the nearby strip is routed first, so it gets the routing budget before the per-person plans");
  ok(jeff.conflicts.some((c) => c.kind === "double_booked" && c.text.includes("Venue SV-V3")) && jeff.notes.includes("Couldn't check Jeff's calendar"),
    "site-visits loader: an unreadable calendar still checks the person's visits and says the calendar wasn't checked");
  ok(sam.conflicts.length === 0 && sam.notes.includes("Sam has no connected calendar — checked visits only"), "site-visits loader: no calendar → visits only, with a note");
  ok(h.reads.filter((x) => x.userId === "u1").length === 1 && h.reads.length === 3, "site-visits loader: each person's calendar is read once");
  ok(r.nearby?.status === "ok" && r.nearby.days.map((x) => x.dayKey).join() === [d(1), d(2)].join() && r.nearby.days[0].nearest.label === "Venue SV-V1" &&
     r.nearby.days[0].others.map((o) => `${o.person}:${o.status}`).join() === "Jeff:unknown,Sam:free",
    "site-visits loader: nearby days come from the lead's own stops, with each attendee's status");
  ok(r.nearby?.status === "ok" && r.nearby.days[0].others.find((o) => o.person === "Sam")?.note === VISITS_ONLY_NOTE && !r.nearby.days[0].others.find((o) => o.person === "Jeff")?.note,
    "site-visits loader: a nearby day says an attendee with no calendar was checked on visits only");
  ok(!h.asked.some((p) => p.from.lat === FAR.lat || p.to.lat === FAR.lat), "site-visits loader: a stop 100+ miles away is never routed");
  ok(h.budgets.length > 0 && h.budgets.every((b) => b >= 0 && b <= BOOKING_ROUTE_BUDGET_MS) && BOOKING_ROUTE_BUDGET_MS === 10_000,
    "site-visits loader: live routing shares one 10 s budget");
  let clock = at(8);
  const spent: number[] = [];
  await loadBookingCheck(NEW, V, bookingHarness({ now: () => clock, routes: async (pairs, budgetMs) => { spent.push(budgetMs); clock += 4_000; return new Map(pairs.map((p) => [pairKey(p.from, p.to), 20])); } }).deps);
  ok(spent.length >= 3 && spent[0] === BOOKING_ROUTE_BUDGET_MS && spent[1] === 6_000 && spent[2] === 2_000 && spent.slice(3).every((b) => b === 0),
    "site-visits loader: each routing call gets what's left of the one budget, never a fresh 10 s");
  ok(bookingRouteMode(10_000) === "live" && bookingRouteMode(4_999) === "cache" && bookingRouteMode(0) === "cache",
    "site-visits loader: with less than one request's timeout left, routing reads the cache only");

  // Editing a visit: it isn't its own conflict, its calendar copy isn't busy, and it isn't its own nearby day
  const EDIT: BookingCheckInput = { ...NEW, visitId: "SV-E", address: "p1", startAt: at(9, 0, 2), endAt: at(10, 0, 2), attendees: [] };
  const edit = await loadBookingCheck(EDIT, V, bookingHarness().deps);
  ok(edit.people.length === 1 && edit.people[0].conflicts.length === 0, "site-visits loader: an edited visit never conflicts with itself or its own calendar copy");
  ok(edit.nearby?.status === "ok" && edit.nearby.days.map((x) => x.dayKey).join() === d(1), "site-visits loader: …and isn't suggested as its own nearby day");
  const located = bookingHarness({
    readEvents: async (userId) =>
      userId === "u1" ? { status: "ok", events: [gEvent("e-copy", at(9, 0, 2), at(10, 0, 2), { iCalUID: "sv-SV-E@peak-app", location: "12 Main St, Appleton, WI" })] } : { status: "no-calendar", events: [] },
  });
  const editLocated = await loadBookingCheck(EDIT, V, located.deps);
  ok(editLocated.nearby?.status === "ok" && editLocated.nearby.days.map((x) => x.dayKey).join() === d(1) && editLocated.people[0].conflicts.length === 0,
    "site-visits loader: the edited visit's own calendar copy (with an address) is never a nearby day or a conflict");
  const moved = await loadBookingCheck({ ...EDIT, startAt: at(13, 0, 1), endAt: at(14, 0, 1) }, V, located.deps);
  ok(moved.people[0].conflicts.length === 0, "site-visits loader: moving a visit, its calendar copy at the old time is not busy");

  const unv = await loadBookingCheck({ ...NEW, address: "bad" }, V, bookingHarness().deps);
  ok(unv.nearby?.status === "unverified" && unv.people[0].notes.includes("Checked without drive time") && unv.address.status === "needs_check" && unv.address.fix?.kind === "place",
    "site-visits loader: an unverified address → no nearby days, checked without drive time");
  const down = await loadBookingCheck(NEW, V, bookingHarness({ routes: async () => new Map() }).deps);
  ok(down.nearby?.status === "unavailable" && down.people[0].notes.includes("Checked without drive time"), "site-visits loader: OSRM down → Nearby days unavailable");
  const thrown = await loadBookingCheck(NEW, V, bookingHarness({ routes: async () => { throw new Error("osrm"); } }).deps);
  ok(thrown.nearby?.status === "unavailable", "site-visits loader: a routing error reads as Nearby days unavailable, never a crash");
  const calThrows = await loadBookingCheck(NEW, V, bookingHarness({ readEvents: async () => { throw new Error("google"); } }).deps);
  ok(calThrows.people.every((p) => p.calendar === "failed" && p.notes.includes(`Couldn't check ${p.person}'s calendar`)),
    "site-visits loader: a calendar read that throws says it couldn't check — never 'no conflicts'");
  const untimed = await loadBookingCheck({ ...NEW, startAt: null, endAt: null }, V, bookingHarness().deps);
  ok(untimed.people.length === 0 && untimed.nearby?.status === "ok", "site-visits loader: no time yet → no conflict rows, nearby days still shown");
  const hb = bookingHarness();
  const badgeOnly = await loadBookingCheck(NEW, { ...V, nearby: false }, hb.deps);
  ok(badgeOnly.nearby === null && hb.reads.every((x) => x.timeMaxMs === chicagoDayStart(d(2))) && badgeOnly.people.length === 3,
    "site-visits loader: badge checks read and plan only the visit's own day");

  const hf = bookingHarness();
  const farOut = { ...NEW, startAt: at(13, 0, 60), endAt: at(14, 0, 60) };
  await loadBookingCheck(farOut, V, hf.deps);
  ok(hf.reads.filter((x) => x.userId === "u1").length === 2 && hf.reads.length === 6 && hf.reads.every((x) => x.timeMaxMs === chicagoDayStart(d(21)) || x.timeMaxMs === chicagoDayStart(d(61))),
    "site-visits loader: a visit months out reads its own day separately — never one calendar read stretched over months");
  // Nearby days are today … today + look-ahead only — never a past day
  const later = await loadBookingCheck(NEW, V, bookingHarness({ now: () => at(8, 0, 2) }).deps);
  ok(later.nearby?.status === "ok" && later.nearby.days.map((x) => x.dayKey).join() === d(2), "site-visits loader: a day already past is never suggested");
  const short = await loadBookingCheck(NEW, V, bookingHarness({ settings: async () => ({ ...DEFAULT_SCHEDULING, nearbyLookaheadDays: 2 }) }).deps);
  ok(short.nearby?.status === "ok" && short.nearby.days.map((x) => x.dayKey).join() === d(1) && short.nearby.lookaheadDays === 2,
    "site-visits loader: nothing past the look-ahead is suggested");

  const range = { timeMinMs: at(0), timeMaxMs: at(0, 0, 1) };
  ok(gmailEnabled() || (await readCalendarForBooking("TESTvisits:nobody", range)).status === "no-calendar", "site-visits loader: Gmail off → no calendar, never an error");
  const cal = (over: Parameters<typeof readCalendarForBooking>[2]) => readCalendarForBooking("TESTvisits:u", range, { enabled: () => true, connected: async () => true, ...over });
  const full = await cal({ list: async () => ({ events: [{ ...gEvent("a", at(9), at(10)), description: "" }], coveredThroughMs: range.timeMaxMs }) });
  const cut = await cal({ list: async () => ({ events: [{ ...gEvent("a", at(9), at(10)), description: "" }], coveredThroughMs: at(9) }) });
  const boom = await cal({ list: async () => { throw new Error("401"); } });
  const noScope = await cal({ connected: async () => false });
  const connBoom = await cal({ connected: async () => { throw new Error("db"); } });
  ok(full.status === "ok" && full.events.length === 1 && cut.status === "failed" && boom.status === "failed" && noScope.status === "no-calendar" && connBoom.status === "failed",
    "site-visits loader: a calendar read is ok only when it covers the whole window; errors and partial reads say 'couldn't check'");

  // Client-safety: only load.ts reaches the server.
  const dir = "src/lib/visit-plan";
  const serverOnly = /from "@\/(db|lib\/stores|lib\/google|lib\/gmail|lib\/users|lib\/address-verify\/targets|lib\/drive-plan\/load)/;
  const leaky = readdirSync(dir).filter((f) => f !== "load.ts" && serverOnly.test(readFileSync(join(dir, f), "utf8")));
  ok(leaky.length === 0 && serverOnly.test(readFileSync(join(dir, "load.ts"), "utf8")) && !/from "\.\/load"/.test(readFileSync(join(dir, "index.ts"), "utf8")),
    "site-visits pin: every visit-plan module but load.ts is client-safe, and the index never re-exports load" + (leaky.length ? " — " + leaky.join(", ") : ""));
  ok(!/^import (?!type)/m.test(readFileSync("src/lib/visit-invite-plan.ts", "utf8")), "site-visits pin: visit-invite-plan.ts has no runtime imports (client-safe)");
}

export async function siteVisitsActionChecks(ok: Ok): Promise<void> {
  const roster = ["Dana", "Jeff", "Sam"];
  const c = cleanBookingInput({ visitId: " SV-1 ", customerId: "C-1", locationId: "", address: "  1 Elm St ", startAt: at(9), endAt: at(10), lead: "Dana", attendees: ["Jeff", "Dana", "Ghost"] }, roster);
  ok(c.visitId === "SV-1" && c.customerId === "C-1" && c.locationId === null && c.address === "1 Elm St" && c.startAt === at(9) && c.endAt === at(10) && c.lead === "Dana" && c.attendees.join() === "Jeff",
    "site-visits input: the booking check's input is trimmed and cleaned");
  const bad = cleanBookingInput({ startAt: at(10), endAt: at(9), lead: "Ghost", attendees: "Jeff" }, roster);
  ok(bad.startAt === null && bad.endAt === null && bad.lead === "" && bad.attendees.length === 0 && bad.visitId === null,
    "site-visits input: a reversed range, an unknown lead and a non-list are dropped");
  ok(cleanBookingInput(null, roster).address === "" && cleanBookingInput({ startAt: at(9), endAt: at(9) + 25 * 3_600_000 }, roster).startAt === null,
    "site-visits input: junk is empty; a range over 24 h is untimed");

  const ba = readFileSync("src/app/(app)/visit-booking-actions.ts", "utf8");
  for (const name of ["bookingCheckAction", "updateVisitAction", "visitConflictSummariesAction"])
    ok(firstAwait(fnBody(ba, name), "requireUser()"), `site-visits actions: ${name} checks the session first`);
  const upd = fnBody(ba, "updateVisitAction");
  ok(upd.indexOf("after(") > 0 && upd.indexOf("after(") < upd.indexOf("await dispatchVisitInvite(") && /resyncForVisitChange\(prevVisit, nextVisit\)\.catch\(/.test(upd),
    "site-visits actions: editing a visit re-syncs the old and new days (in after(), before the invites)");
  ok(/cleanAttendees\(/.test(upd) && /updateVisitBooking\(/.test(upd) && /roster\.includes\(lead\)/.test(upd), "site-visits actions: an edit cleans attendees and refuses a lead not on the team");
  ok(upd.indexOf('v.stage !== "scheduled"') > 0 && upd.indexOf('v.stage !== "scheduled"') < upd.indexOf("updateVisitBooking("),
    "site-visits actions: editing refuses any visit that isn't scheduled, before updateVisitBooking (no claim-model bypass)");
  const badges = fnBody(ba, "visitConflictSummariesAction");
  ok(/Date\.now\(\) \+ BADGE_TOTAL_BUDGET_MS/.test(badges) && /BADGE_TOTAL_BUDGET_MS = 20_000/.test(ba) && badges.indexOf("Date.now() >= deadline") > 0 && badges.indexOf("Date.now() >= deadline") < badges.indexOf("loadBookingCheck("),
    "site-visits actions: conflict badges share one 20 s deadline and stop starting new visits once it is spent");
  ok(/\.slice\(0, 10\)/.test(badges) && /nearby: false/.test(badges), "site-visits actions: conflict badges check at most 10 visits and skip nearby days");
  ok(/viewerId: me\.id/.test(fnBody(ba, "bookingCheckAction")) && /viewerId: me\.id/.test(badges) && (ba.match(/viewerId:/g) ?? []).length === 2,
    "site-visits actions: the booking check always views as the signed-in user (others' event titles stay hidden)");
  const va = readFileSync("src/app/(app)/venue-assessments/visit-actions.ts", "utf8");
  const sched = fnBody(va, "scheduleVisitAction");
  ok(/cleanAttendees\(input\.attendees/.test(sched) && /scheduleVisit\(id, input\.startAt, input\.endAt, attendees\)/.test(sched),
    "site-visits actions: scheduling a request saves its cleaned attendees");
  ok(/input\.attendees == null \? undefined/.test(sched) && !/input\.attendees === undefined/.test(sched),
    "site-visits actions: null or omitted attendees leave the existing list alone (only an array changes it)");
  ok((va.match(/resyncForVisitChange\(/g) ?? []).length === 2, "site-visits actions: visit-actions still holds exactly two re-sync triggers");
  const inbox = readFileSync("src/app/(app)/inbox/site-visit-actions.ts", "utf8");
  ok(/attendees: cleanAttendees\(input\.attendees, input\.assignedTo, roster\)/.test(fnBody(inbox, "createSiteVisitAction")), "site-visits actions: the Inbox create saves cleaned attendees");
}

export async function siteVisitsBookingUiPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const hook = read("src/components/visit-booking/use-booking-check.ts");
  const debounce = Number(/BOOKING_CHECK_DEBOUNCE_MS = (\d+)/.exec(hook)?.[1]);
  ok(debounce >= 600 && hook.includes("clearTimeout") && hook.includes("bookingCheckAction") && /if \(live\)/.test(hook),
    "site-visits booking: the live check is debounced (>= 600 ms) and drops superseded answers");
  const vr = read("src/app/(app)/venue-assessments/visit-requests.tsx");
  const modal = read("src/app/(app)/inbox/site-visit-modal.tsx");
  ok(vr.includes("<BookingPanel") && modal.includes("<BookingPanel") && /onPickDay=\{/.test(vr) && /onPickDay=\{/.test(modal),
    "site-visits booking: the visit-requests scheduler and the Inbox dialog both show the booking panel; a nearby day fills the date");
  ok(vr.includes("scheduleVisitAction(row.id, { startAt: s, endAt: e, attendees })") && /createSiteVisitAction\(\{[\s\S]*?\battendees,[\s\S]*?\}\)/.test(modal),
    "site-visits booking: both save paths send the picked attendees");
  ok(!/disabled=\{[^}]*(check|conflict|nearby)/i.test(vr) && !/disabled=\{[^}]*(check|conflict|nearby)/i.test(modal),
    "site-visits booking: nothing about the check ever disables Schedule");
  const panel = read("src/components/visit-booking/conflicts-panel.tsx");
  ok(/p\.calendar !== "failed"/.test(panel) && panel.includes("No conflicts") && panel.includes("Conflicts never block scheduling"),
    "site-visits booking: an unreadable calendar never reads as 'No conflicts'");
  const strip = read("src/components/visit-booking/nearby-strip.tsx");
  ok(strip.includes("NEARBY_TEXT.unverified") && strip.includes("NEARBY_TEXT.unavailable") && strip.includes("nearbyLine("),
    "site-visits booking: the strip shows the verify / unavailable copy and the spec's row format");
  ok(strip.includes("nearby.note") && strip.includes('"no-calendar"') && strip.includes("calendarNote("),
    "site-visits booking: the strip shows the lead's failed-calendar note and 'checked visits only' for a lead with no calendar");
  const picker = read("src/components/visit-booking/attendee-picker.tsx");
  ok(/team\.filter\(\(n\) => n !== lead/.test(picker), "site-visits booking: the lead is never offered as an attendee");
  const clientFiles = [...readdirSync("src/components/visit-booking").map((f) => join("src/components/visit-booking", f)), "src/app/(app)/venue-assessments/visit-requests.tsx", "src/app/(app)/inbox/site-visit-modal.tsx"];
  const leaky = clientFiles.filter((f) => /from "@\/(db|lib\/stores|lib\/visit-plan\/load|lib\/google|lib\/gmail|lib\/users)/.test(read(f)));
  ok(leaky.length === 0, "site-visits booking: client components import nothing that reaches the database" + (leaky.length ? " — " + leaky.join(", ") : ""));
}
