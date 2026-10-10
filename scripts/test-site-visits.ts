/* Site-visit scheduling — spec checks
   (docs/superpowers/specs/2026-10-09-site-visit-scheduling-design.md).
   Chained from test-review-and-spec.ts right after the drive-time checks.
   Doc fixtures use fixtureId("visits", …) + createFixture and are dropped with
   dropFixtures("visits"); blob rows use TESTvisits: ids and are hard-deleted in
   each check's own finally. */
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { stopsForDay, visitPeople } from "@/lib/drive-plan/stops";
import { createVisit, getVisit, scheduleVisit, updateVisitBooking } from "@/lib/stores/site-visits";
import { cleanAttendees, MAX_ATTENDEES, readAttendees } from "@/lib/visit-plan/people";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";

export type Ok = (c: boolean, m: string) => void;

/* ---- shared helpers (later tasks add more below these) ---- */
const DAY = "2036-10-15"; // a Wednesday, CDT (UTC-5), far in the future so "scheduled" never reads "done"; every test day stays in October
const at = (hh: number, mm = 0, plusDays = 0) => Date.UTC(2036, 9, 15 + plusDays, hh + 5, mm);
const P1: LatLng = { lat: 44.0, lng: -88.0 };
const okAddr = (p: LatLng, key: string): AddressState => ({ status: "verified", label: key, point: p, pointKey: "place:" + key, fix: null });

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
