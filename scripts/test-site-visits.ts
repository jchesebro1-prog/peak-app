/* Site-visit scheduling — spec checks
   (docs/superpowers/specs/2026-10-09-site-visit-scheduling-design.md).
   Chained from test-review-and-spec.ts right after the drive-time checks.
   Doc fixtures use fixtureId("visits", …) + createFixture and are dropped with
   dropFixtures("visits"); blob rows use TESTvisits: ids and are hard-deleted in
   each check's own finally. */
import { readFileSync } from "node:fs";
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { isVisitIcsCopy, stopsForDay, visitPeople } from "@/lib/drive-plan/stops";
import { buildRaw } from "@/lib/gmail/mime";
import { buildIcs, icsMimeType } from "@/lib/ics";
import { createVisit, getVisit, scheduleVisit, setVisitInvites, updateVisitBooking, type SiteVisit } from "@/lib/stores/site-visits";
import { cancelVisitInvites, dispatchVisitInvite, type InviteDeps } from "@/lib/visit-invite";
import { inviteSummary, normalizeInvites, planInviteChanges, visitEventIds, visitUid, type VisitInviteRecipient } from "@/lib/visit-invite-plan";
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
  ok(fmtClock(1440) === "12:00 AM (end of day)" && fmtWorkHours({ days: [1], startMin: 480, endMin: 1440 }) === "Mon 8:00–12:00 AM (end of day)" &&
     cleanWorkHours({ days: [1], startMin: 480, endMin: 1440 }, true)?.endMin === 1440,
    "site-visits settings: an end of midnight (1440) is kept and prints as the end of the day");
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
