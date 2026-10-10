# Site-Visit Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Site visits become fixed appointments with one lead and optional Peak attendees. Each person gets the visit on their calendar and their own drive chain. The booking screen shows nearby days (when the lead is already in the area) and a live conflicts panel, and the visit and its calendar block carry a conflict badge. Nothing is ever moved or blocked.

**Architecture:** A new pure engine `src/lib/visit-plan/` (settings types, Chicago work hours, busy blocks, `stopConflicts`/`checkVisit`, `suggestDays`) sits on top of spec 1's `planDay`/`planDriveDays`. One server loader (`visit-plan/load.ts`, `loadBookingCheck`) reads each person's Google Calendar once, plans the candidate's day through `planDriveDays` with the candidate injected as a virtual visit, and hands the results to the pure engine. Invites move to a per-recipient record (`SiteVisit.invites`) planned by a pure diff (`visit-invite-plan.ts`) and delivered by `visit-invite.ts`. Settings live in the existing `schedule_defaults` / `schedule_prefs:<userId>` blobs. Nothing new is stored for conflicts or suggestions.

**Tech Stack:** Next.js 16 App Router (server actions, `after()` from `next/server`), TypeScript, doc-store collections + blobs (`getBlob`/`setBlob`), Google Calendar v3 (`src/lib/google/calendar.ts`), OSRM via `routeMinutesFor` (spec 1), the spec harness `scripts/test-review-and-spec.ts`.

## Global Constraints

- Specs: `docs/superpowers/specs/2026-10-09-site-visit-scheduling-design.md` (this plan) and `docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md` (spec 1, already built on this branch). Read both before Task 1.
- **Merge `origin/main` (and the finished drive-time branch) before Task 1.** The drive-time branch is getting a final fix round (a `long_route` flag, a typed-house-number rule, a shared Nominatim pacer, a cron deadline, an own-legs filter). Use only these public names from spec 1: `planDay`, `planDriveDays`, `routeMinutesFor`, `visitAddressInput`, `DriveDayPlan`, `DriveLoadDeps`, `stopsForDay`, `visitPeople`, `isVisitIcsCopy`, `dayDriveTotal`, `fmtDur`, `pairKey`, `chicagoDayKey`, `chicagoDayStart`, `addDays`, `DRIVE_TZ`, `addressStatesForVisits`, `driveAgendaLayer`, `resyncForVisitChange`, the schedule-prefs functions. If one was renamed by the fix round, follow the rename.
- Visits are **fixed start–end appointments. Nothing in the app moves one, picks a time, or blocks Schedule.** Conflicts are flagged only.
- People are **names** (app convention). `assignedTo` = the lead. New `attendees: string[]` = everyone else (never the lead). `visitPeople(v)` in `src/lib/drive-plan/stops.ts` stays the ONE place that decides who a visit is a stop for.
- Invite UID is always `sv-<id>@peak-app`. Add → invite; remove → `METHOD:CANCEL` (same UID); move → update (same UID, `SEQUENCE` + 1).
- Conflict kinds, verbatim copy:
  - `Double-booked — overlaps <label> (<9–10:30>)` / `Double-booked — the drive there overlaps <label> (<9–10:30>)`
  - spec 1's tight text (`Tight — needs 1h 40m, has 30m`)
  - `Outside work hours (8:00–5:00)` / `Outside work hours — Saturday isn't a work day`
  - `Too much driving — 5h 40m of 5h`
  - notes: `Checked without drive time` · `Couldn't check Dana's calendar` · `Dana has no connected calendar — checked visits only`
  - nearby strip: `Verify the address to see nearby days` · `Nearby days unavailable` · row `Tue Oct 14 · 18 min from Lone Pine Elementary · busy 9–11:30`
- Defaults: work hours **Mon–Fri 8:00–5:00** (company, per-person override in Account) · same area **45 drive minutes** · daily drive limit **5 h, buffer included** · look-ahead **21 days** · at most **5** suggestions, ranked nearest drive minutes then soonest.
- Double-booked counts other visits and **accepted, timed** Google events only (all-day, declined, not-yet-answered and tentative are not busy). The app's own drive events and a visit's own calendar copies are never busy.
- **A straight-line distance may pre-filter far stops before routing; it is never shown as minutes.** Shown minutes come only from `geo_cache` / OSRM (`routeMinutesFor`).
- An unverified candidate address → no drive-based checks, the panel says `Checked without drive time`; the strip says `Verify the address to see nearby days`.
- Days are **Chicago calendar days**. Timestamps are epoch-ms. No AI (D89).
- `requireUser()` / `requirePerm()` is the **first await** in every server action; every action input is untrusted.
- Client components never import a module that reaches `@/db`. Client-safe modules: everything in `src/lib/visit-plan/` **except `load.ts`**, `src/lib/visit-invite-plan.ts`, spec 1's pure files, and server-action files. (`next build` fails otherwise.)
- Next.js 16 has breaking changes: before touching a route/action/page, read the relevant guide in `node_modules/next/dist/docs/` (if missing in the worktree, read `/Users/sm/Downloads/peak-app/node_modules/next/dist/docs/` read-only).
- Design tokens: `pk-*` classes and `var(--accent)`; never hardcode accent-coloured UI.
- Doc collection, no migration: `attendees` and `invites` are normalized on read.
- Never open `.data/pglite`, never run a `tsx`/db script or a dev server against it. `npm run test:specs` makes its own temp datadir (check `df -h` first; temp `tmp.*` datadirs can fill the disk).
- Per-task gates (all must pass; report real numbers): `npx tsc --noEmit` · `env -u DATABASE_URL npm run test:specs` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts <changed files>`. UI tasks (3, 8, 9, 10) add `npm run build`. Task 11 adds `npm run test:smoke` (stop any dev server first).
- Tests live in a NEW module `scripts/test-site-visits.ts`, exporting `async function siteVisits<Name>(ok: Ok): Promise<void>`. The harness imports them on a new line right after the line that starts `import { driveTimeKeysChecks` and chains them right after `.then(() => driveTimeTriageFlagChecks(ok))`, in task order. Doc fixtures use `fixtureId("visits", …)` + `createFixture` and are dropped with `dropFixtures("visits")`; blob rows use `TESTvisits:` ids and are hard-deleted in each check's own `finally`.
- When a task says "add to the imports" and that module is already imported in the file, merge the new names into the existing import line (no duplicate imports).
- Don't edit `scripts/test-drive-time.ts` (the parallel fix round owns it). Its existing pins must keep passing — notably: `visit-actions.ts` contains exactly two `resyncForVisitChange(` calls, the Inbox create action contains `resyncForVisitChange(null, rec)`, and both schedule paths register `after(` before the text `await dispatchVisitInvite(`; `src/lib/agenda.ts` keeps exactly one `await allVisits()`.
- Don't assign D/punch numbers until Task 11, which recomputes them from `git show origin/main:DECISIONS.md` / `origin/main:PUNCHLIST.md` (expected punch **#326**, recompute anyway).

---

## File structure

**Create**

| File | Responsibility |
|---|---|
| `src/lib/visit-plan/people.ts` | Pure: `cleanAttendees`, `readAttendees`, `MAX_ATTENDEES`. |
| `src/lib/visit-plan/settings.ts` | Pure: `WorkHours`, `SchedulingSettings`, defaults, cleaners, clock/format helpers. |
| `src/lib/visit-plan/hours.ts` | Pure Chicago wall-clock helpers: `chicagoMinuteOfDay`, `chicagoWallMs`, `weekdayOf`, `workWindow`, `fmtDayLabel`, `fmtClockShort`. |
| `src/lib/visit-plan/busy.ts` | Pure: `BusyBlock`, `isBusyEvent`, `busyBlocks`, `toBusyVisit`, `busyInRange`, `fmtBusy`, `fmtBusyRange`. |
| `src/lib/visit-plan/check.ts` | Pure: `Conflict`, `stopConflicts`, `checkVisit`, `calendarNote`, `overlaps`, `fmtLimit`, `CONFLICT_LABEL`. |
| `src/lib/visit-plan/nearby.ts` | Pure: `straightLineMiles`, `couldBeSameArea`, `nearbyPairs`, `projectTime`, `attendeeStatusOn`, `suggestDays`, `nearbyLine`, `NEARBY_TEXT`. |
| `src/lib/visit-plan/types.ts` | Pure: `BookingCheckInput`, `BookingCheckResult`. |
| `src/lib/visit-plan/input.ts` | Pure: `cleanBookingInput`. |
| `src/lib/visit-plan/agenda.ts` | Pure: `agendaConflicts` (calendar/agenda badges). |
| `src/lib/visit-plan/index.ts` | Re-exports the pure engine (not `load.ts`). |
| `src/lib/visit-plan/load.ts` | Server: `loadBookingCheck`, `readCalendarForBooking`, `virtualVisit`. |
| `src/lib/visit-invite-plan.ts` | Pure: `VisitInviteRecipient`, `InviteStatus`, `normalizeInvites`, `planInviteChanges`, `visitEventIds`, `visitUid`, `inviteSummary`. |
| `src/app/(app)/visit-booking-actions.ts` | Server actions: `bookingCheckAction`, `updateVisitAction`, `visitConflictSummariesAction`. |
| `src/components/visit-booking/use-booking-check.ts` | Client hook: debounced `bookingCheckAction`. |
| `src/components/visit-booking/booking-panel.tsx` | Client: attendee picker + Nearby days strip + Conflicts panel. |
| `src/components/visit-booking/attendee-picker.tsx` | Client: people multi-picker (lead excluded). |
| `src/components/visit-booking/nearby-strip.tsx` | Client: Nearby days strip. |
| `src/components/visit-booking/conflicts-panel.tsx` | Client: live conflicts panel. |
| `src/components/visit-booking/conflict-badge.tsx` | Client-safe badge (no hooks). |
| `src/components/visit-booking/visit-edit-dialog.tsx` | Client: edit an existing visit (time, lead, attendees, booking panel). |
| `src/components/visit-booking/visit-edit-button.tsx` | Client: "Edit" button that opens the dialog. |
| `src/components/visit-booking/visit-conflict-chips.tsx` | Client: lazy conflict badges for a list of visits. |
| `src/components/visit-booking/work-hours-editor.tsx` | Client: days + start/end editor. |
| `src/app/(app)/settings/scheduling-defaults-card.tsx` | Admin card: company work hours, same area, drive limit, look-ahead. |
| `src/app/(app)/account/work-hours-card.tsx` | Per-person work hours. |
| `scripts/test-site-visits.ts` | All new spec checks. |

**Modify**

`src/lib/stores/site-visits.ts` · `src/lib/stores/schedule-prefs.ts` · `src/lib/visit-invite.ts` · `src/lib/ics.ts` · `src/lib/gmail/bridge.ts` (`buildImportDedup`) · `src/lib/google/calendar.ts` (`selfResponse`) · `src/lib/drive-plan/stops.ts` (`isVisitIcsCopy` event ids) · `src/lib/drive-plan/load.ts` (`eventIds`) · `src/lib/drive-sync/agenda.ts` (return `plans`, event ids) · `src/lib/agenda.ts` · `src/app/(app)/venue-assessments/{visit-actions.ts,visit-requests.tsx,page.tsx}` · `src/app/(app)/inbox/{site-visit-actions.ts,site-visit-modal.tsx}` · `src/app/(app)/companies/[id]/page.tsx` · `src/app/(app)/calendar/calendar-client.tsx` · `src/app/(app)/home-calendar.tsx` · `src/app/(app)/settings/{page.tsx,actions.ts,settings-client.tsx,groups/field.tsx,groups/types.ts}` · `src/app/(app)/account/{page.tsx,actions.ts}` · `scripts/test-review-and-spec.ts` · `DECISIONS.md` · `PUNCHLIST.md` · `AGENTS.md`.

---

### Task 1: Attendees on the visit record + test module

**Files:**
- Create: `src/lib/visit-plan/people.ts`, `scripts/test-site-visits.ts`
- Modify: `src/lib/stores/site-visits.ts`, `scripts/test-review-and-spec.ts` (one import line, one chain line)

**Interfaces:**
- Consumes: `visitPeople(v: { assignedTo: string; attendees?: readonly string[] | null }): string[]` and `stopsForDay` from `src/lib/drive-plan/stops.ts`; `createFixture`, `dropFixtures`, `fixtureId` from `scripts/test-fixtures.ts`.
- Produces:
  - `people.ts`: `MAX_ATTENDEES = 8`; `cleanAttendees(raw: unknown, lead: string, roster: readonly string[]): string[]` (trimmed, deduped, lead dropped, roster-only, capped); `readAttendees(raw: unknown): string[]` (normalize-on-read: strings only, trimmed, deduped).
  - `site-visits.ts`: `SiteVisit.attendees: string[]` (always an array after read); `SiteVisitInput` makes `attendees` optional; `scheduleVisit(id: string, startAt: number, endAt: number, attendees?: string[]): Promise<void>`; `type VisitBookingPatch = { startAt: number; endAt: number; assignedTo: string; attendees: string[] }`; `updateVisitBooking(id: string, patch: VisitBookingPatch): Promise<SiteVisit | null>`.
  - `scripts/test-site-visits.ts`: `export type Ok`, test helpers `DAY`, `at(hh, mm?, plusDays?)`, `P1`, `okAddr(p, key)`, and `siteVisitsAttendeeChecks(ok)`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-site-visits.ts`:

```ts
/* Site-visit scheduling — spec checks
   (docs/superpowers/specs/2026-10-09-site-visit-scheduling-design.md).
   Chained from test-review-and-spec.ts right after the drive-time checks.
   Doc fixtures use fixtureId("visits", …) + createFixture and are dropped with
   dropFixtures("visits"); blob rows use TESTvisits: ids and are hard-deleted in
   each check's own finally. */
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { stopsForDay, visitPeople } from "@/lib/drive-plan/stops";
import { getVisit, scheduleVisit, updateVisitBooking } from "@/lib/stores/site-visits";
import { cleanAttendees, MAX_ATTENDEES, readAttendees } from "@/lib/visit-plan/people";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";

export type Ok = (c: boolean, m: string) => void;

/* ---- shared helpers (later tasks add more below these) ---- */
const DAY = "2026-10-14"; // a Wednesday, CDT (UTC-5); every test day stays in October
const at = (hh: number, mm = 0, plusDays = 0) => Date.UTC(2026, 9, 14 + plusDays, hh + 5, mm);
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
```

Wire it into the harness. In `scripts/test-review-and-spec.ts`, directly after the line that starts `import { driveTimeKeysChecks`, add:

```ts
import { siteVisitsAttendeeChecks } from "./test-site-visits";
```

and directly after `.then(() => driveTimeTriageFlagChecks(ok))` add:

```ts
  .then(() => siteVisitsAttendeeChecks(ok))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/people'`, `updateVisitBooking` not exported, `attendees` not on `SiteVisit`.

- [ ] **Step 3: Implement**

Create `src/lib/visit-plan/people.ts`:

```ts
/**
 * Who's on a site visit besides its lead (spec 2026-10-09 site-visit
 * scheduling, Part 1 "Attendees"). Pure and client-safe. People are NAMES
 * (app convention). visitPeople() in src/lib/drive-plan/stops.ts stays the
 * one place that turns lead + attendees into "everyone the visit is a stop for".
 */
export const MAX_ATTENDEES = 8;

/** Write-side cleaning: trimmed, deduped, roster-only, never the lead, capped. */
export function cleanAttendees(raw: unknown, lead: string, roster: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const leadName = (lead || "").trim();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (!name || name === leadName || out.includes(name) || !roster.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_ATTENDEES) break;
  }
  return out;
}

/** Read-side normalizing for stored docs (pre-spec-2 visits have no field). */
export function readAttendees(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
```

In `src/lib/stores/site-visits.ts`:

1. Add the import under the existing imports:

```ts
import { readAttendees } from "@/lib/visit-plan/people";
```

2. In `type SiteVisit`, directly after the `assignedTo: string;` line, add:

```ts
  /** Spec 2026-10-09 site-visit scheduling — other Peak people on the visit
   *  (names; never the lead). The visit is a stop on each one's day
   *  (visitPeople). Normalized to [] on read; no migration. */
  attendees: string[];
```

3. In `normalizeVisit`, after `v.customerId = v.customerId ?? null;` add:

```ts
  v.attendees = readAttendees(v.attendees);
```

4. Replace the `SiteVisitInput` type with:

```ts
export type SiteVisitInput = Omit<
  SiteVisit,
  "id" | "createdAt" | "updatedAt" | "invite" | "attendees"
> & { attendees?: string[] };
```

5. In `createVisit`, inside the object returned to `insertWithPrefixedId`, after `...input,` add `attendees: input.attendees ?? [],`.

6. Replace `scheduleVisit` and add `updateVisitBooking` right after it:

```ts
export async function scheduleVisit(id: string, startAt: number, endAt: number, attendees?: string[]): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.startAt = startAt;
    d.endAt = endAt;
    if (attendees) d.attendees = attendees.filter((n) => n !== d.assignedTo);
    d.stage = "scheduled";
    d.updatedAt = Date.now();
  });
}

export type VisitBookingPatch = { startAt: number; endAt: number; assignedTo: string; attendees: string[] };

/** Editing a scheduled visit (spec 2026-10-09 site-visit scheduling): time,
 *  lead and attendees in one write. The caller cleans the names. */
export async function updateVisitBooking(id: string, patch: VisitBookingPatch): Promise<SiteVisit | null> {
  const saved = await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.startAt = patch.startAt;
    d.endAt = patch.endAt;
    d.assignedTo = patch.assignedTo;
    d.attendees = patch.attendees.filter((n) => n !== patch.assignedTo);
    d.stage = "scheduled";
    d.updatedAt = Date.now();
  });
  return saved ? getVisit(id) : null;
}
```

- [ ] **Step 4: Run the gates**

Run: `npx tsc --noEmit` → PASS (0 errors).
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures; every `site-visits:` line PASS.
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/people.ts src/lib/stores/site-visits.ts scripts/test-site-visits.ts` → 0 problems.

- [ ] **Step 5: Commit**

```bash
git add src/lib/visit-plan/people.ts src/lib/stores/site-visits.ts scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): attendees on the visit record, normalized on read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Per-recipient invites (add / cancel / update) + calendar-copy dedupe

**Files:**
- Create: `src/lib/visit-invite-plan.ts`
- Modify: `src/lib/ics.ts`, `src/lib/visit-invite.ts`, `src/lib/stores/site-visits.ts`, `src/lib/gmail/bridge.ts` (`buildImportDedup`), `src/lib/drive-plan/stops.ts`, `src/lib/drive-plan/load.ts`, `src/app/(app)/venue-assessments/visit-actions.ts` (`removeVisitAction`, `scheduleVisitAction` return), `src/app/(app)/inbox/site-visit-actions.ts` (return), `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `visitPeople`; `SiteVisit` (Task 1); `buildIcs` from `src/lib/ics.ts`; `EventWriteInput`, `insertEvent`, `updateEvent`, `deleteEvent` from `src/lib/google/calendar.ts`; `sendSiteVisitInvite` from `src/lib/gmail/bridge.ts`.
- Produces:
  - `visit-invite-plan.ts`: `type InviteStatus = "calendar" | "sent" | "invites-off" | "gmail-off" | "no-mailbox" | "no-email" | "failed"`; `type InviteChannel = "calendar" | "ics"`; `type VisitInviteRecipient = { name: string; to: string; channel: InviteChannel; eventId: string | null; sentAt: number; startAt: number; endAt: number; sequence: number; fromMailbox: string | null; gmailId: string | null }`; `type RecipientResult = { name: string; action: "invite" | "update" | "cancel" | "keep"; status: InviteStatus }`; `type InviteVisitShape`; `visitUid(id: string): string`; `normalizeInvites(v: InviteVisitShape): VisitInviteRecipient[]`; `type InvitePlan = { add: string[]; update: VisitInviteRecipient[]; cancel: VisitInviteRecipient[]; keep: VisitInviteRecipient[] }`; `planInviteChanges(current, target: { people: readonly string[]; startAt: number | null; endAt: number | null } | null): InvitePlan`; `visitEventIds(v: InviteVisitShape): string[]`; `recipientLine(r: RecipientResult): string`; `inviteSummary(rs: RecipientResult[]): string`.
  - `ics.ts`: `IcsEvent` gains optional `method?: "PUBLISH" | "CANCEL"` and `sequence?: number`; output without them is byte-identical to today.
  - `visit-invite.ts`: `type InviteReport = { status: InviteStatus; recipients: RecipientResult[] }`; `type InviteDeps`; `dispatchVisitInvite(rec: SiteVisit, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport>` (never throws); `cancelVisitInvites(rec: SiteVisit, me, deps?): Promise<InviteReport>`; re-exports `InviteStatus`, `RecipientResult`.
  - `site-visits.ts`: `SiteVisit.invites: VisitInviteRecipient[]` (normalized on read from the legacy `invite` / `googleEventId`); `setVisitInvites(id, invites, lead: VisitInviteRecipient | null): Promise<void>`. `stampInvite` and `stampGoogleEvent` are removed.
  - `stops.ts`: `isVisitIcsCopy(ev, visits: ReadonlyArray<{ id: string; googleEventId?: string | null; eventIds?: readonly string[] | null }>)`; `StopSourceVisit.eventIds?: string[] | null`.
  - `scheduleVisitAction` returns `{ ok: true; inviteStatus: InviteStatus; invites: RecipientResult[] }`; `createSiteVisitAction` returns `{ ok: true; id: string; inviteStatus: InviteStatus; invites: RecipientResult[] }`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-site-visits.ts`:

```ts
import { readFileSync } from "node:fs";
import { buildIcs } from "@/lib/ics";
import { isVisitIcsCopy } from "@/lib/drive-plan/stops";
import type { SiteVisit } from "@/lib/stores/site-visits";
import { cancelVisitInvites, dispatchVisitInvite, type InviteDeps } from "@/lib/visit-invite";
import { inviteSummary, normalizeInvites, planInviteChanges, visitEventIds, visitUid, type VisitInviteRecipient } from "@/lib/visit-invite-plan";
```

Append to the helpers block (below `okAddr`):

```ts
const sv = (id: string, over: Partial<SiteVisit>): SiteVisit => ({
  id, customerId: null, customer: "Cust " + id, locationId: null, venue: "Venue " + id, address: "addr " + id, contactName: "", contactEmail: "", contactPhone: "",
  reason: "Site survey / measure", startAt: at(9), endAt: at(10), notes: "", assignedTo: "Dana", attendees: [], invites: [], createdBy: "x", createdAt: 1, updatedAt: 1,
  stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", ...over,
}) as SiteVisit;
const rcpt = (name: string, over: Partial<VisitInviteRecipient> = {}): VisitInviteRecipient => ({
  name, to: name.toLowerCase() + "@peak.test", channel: "ics", eventId: null, sentAt: 1, startAt: at(9), endAt: at(10), sequence: 0, fromMailbox: "personal:me", gmailId: null, ...over,
});
```

Append the check:

```ts
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
    updateEvent: async (key, id) => { calls.push(`update ${key} ${id}`); return {}; },
    deleteEvent: async (key, id) => { calls.push(`delete ${key} ${id}`); },
    sendIcs: async (o) => { mail.push({ to: o.toAddr, subject: o.subject, ics: o.icsText }); return { gmailId: "m" + mail.length, gmailThreadId: "t", fromMailbox: "personal:me" }; },
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

  // remove Jeff: METHOD:CANCEL to Jeff only
  const h3 = inviteHarness();
  const v3 = sv("SV-T1", { attendees: [], startAt: at(13), endAt: at(14), invites: s2.invites });
  await dispatchVisitInvite(v3, me, h3.deps);
  ok(h3.calls.length === 0 && h3.mail.length === 1 && h3.mail[0].to === "jeff@peak.test" && h3.mail[0].ics.includes("METHOD:CANCEL") && h3.mail[0].ics.includes("SEQUENCE:2") &&
     h3.mail[0].ics.includes("UID:sv-SV-T1@peak-app") && h3.saved()!.invites.map((e) => e.name).join() === "Dana",
    "site-visits invites: removing a person sends them a cancellation with the same UID; the lead is left alone");

  // delete: everyone cancelled
  const h4 = inviteHarness();
  await cancelVisitInvites(sv("SV-T1", { invites: h3.saved()!.invites }), me, h4.deps);
  ok(h4.calls.join() === "delete personal:u-dana g-1" && h4.saved()!.invites.length === 0, "site-visits invites: deleting a visit removes it from every calendar");

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
```

Wire it: extend the harness import to `import { siteVisitsAttendeeChecks, siteVisitsInviteChecks } from "./test-site-visits";` and add `.then(() => siteVisitsInviteChecks(ok))` right after `.then(() => siteVisitsAttendeeChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-invite-plan'`, `cancelVisitInvites` / `InviteDeps` not exported, `invites` not on `SiteVisit`, `method` not on `IcsEvent`.

- [ ] **Step 3: Implement `src/lib/visit-invite-plan.ts`**

```ts
/**
 * Per-recipient site-visit invites (spec 2026-10-09 site-visit scheduling,
 * Part 1 "Invites"). Pure and client-safe: the record shape, the legacy read,
 * and the add / update / cancel plan. Delivery lives in src/lib/visit-invite.ts.
 *
 * Every person on a visit (lead + attendees) gets it on their calendar: a
 * direct Google Calendar event when their mailbox has the Calendar grant
 * (D77), else an emailed .ics whose UID is always sv-<id>@peak-app.
 */
export type InviteStatus = "calendar" | "sent" | "invites-off" | "gmail-off" | "no-mailbox" | "no-email" | "failed";
export type InviteChannel = "calendar" | "ics";

/** What one person was last sent: startAt/endAt are the times THEY were told,
 *  so a later save can tell a move (update) from no change (keep). */
export type VisitInviteRecipient = {
  name: string;
  to: string;
  channel: InviteChannel;
  /** the person's own Google event id (channel "calendar") */
  eventId: string | null;
  sentAt: number;
  startAt: number;
  endAt: number;
  /** .ics SEQUENCE last sent (0 for the first invite) */
  sequence: number;
  fromMailbox: string | null;
  /** the sent email's Gmail id (channel "ics") — the Gmail import skips it */
  gmailId: string | null;
};

export type RecipientResult = { name: string; action: "invite" | "update" | "cancel" | "keep"; status: InviteStatus };

export type InviteVisitShape = {
  id: string;
  assignedTo: string;
  attendees?: readonly string[] | null;
  startAt: number | null;
  endAt: number | null;
  invites?: readonly unknown[] | null;
  invite?: { sentAt?: number; to?: string; fromMailbox?: string; gmailId?: string } | null;
  googleEventId?: string | null;
};

export function visitUid(id: string): string {
  return `sv-${id}@peak-app`;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function readRecipient(raw: unknown): VisitInviteRecipient | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name).trim();
  const channel: InviteChannel | null = r.channel === "calendar" || r.channel === "ics" ? r.channel : null;
  if (!name || !channel) return null;
  const eventId = str(r.eventId) || null;
  if (channel === "calendar" && !eventId) return null;
  return {
    name,
    to: str(r.to),
    channel,
    eventId,
    sentAt: num(r.sentAt),
    startAt: num(r.startAt),
    endAt: num(r.endAt),
    sequence: Math.max(0, Math.round(num(r.sequence))),
    fromMailbox: str(r.fromMailbox) || null,
    gmailId: str(r.gmailId) || null,
  };
}

/** The visit's recipients. A visit saved before spec 2 has at most the old
 *  single stamp (`googleEventId` or `invite`) — it reads as one entry for the
 *  lead, told the visit's current times. */
export function normalizeInvites(v: InviteVisitShape): VisitInviteRecipient[] {
  if (Array.isArray(v.invites)) {
    const out: VisitInviteRecipient[] = [];
    for (const raw of v.invites) {
      const r = readRecipient(raw);
      if (r && !out.some((e) => e.name === r.name)) out.push(r);
    }
    return out;
  }
  const lead = (v.assignedTo || "").trim();
  if (!lead) return [];
  const startAt = v.startAt ?? 0;
  const endAt = v.endAt ?? 0;
  if (v.googleEventId)
    return [{ name: lead, to: str(v.invite?.to), channel: "calendar", eventId: v.googleEventId, sentAt: num(v.invite?.sentAt), startAt, endAt, sequence: 0, fromMailbox: null, gmailId: null }];
  if (v.invite && str(v.invite.to))
    return [{ name: lead, to: str(v.invite.to), channel: "ics", eventId: null, sentAt: num(v.invite.sentAt), startAt, endAt, sequence: 0, fromMailbox: str(v.invite.fromMailbox) || null, gmailId: str(v.invite.gmailId) || null }];
  return [];
}

export type InvitePlan = { add: string[]; update: VisitInviteRecipient[]; cancel: VisitInviteRecipient[]; keep: VisitInviteRecipient[] };

/** target null (deleted) or untimed (unscheduled) → cancel everyone invited. */
export function planInviteChanges(
  current: readonly VisitInviteRecipient[],
  target: { people: readonly string[]; startAt: number | null; endAt: number | null } | null
): InvitePlan {
  const timed = !!target && target.startAt != null && target.endAt != null && target.endAt > target.startAt;
  const people = timed && target ? target.people : [];
  const plan: InvitePlan = { add: [], update: [], cancel: [], keep: [] };
  for (const e of current) {
    if (!people.includes(e.name)) plan.cancel.push(e);
    else if (e.startAt !== target!.startAt || e.endAt !== target!.endAt) plan.update.push(e);
    else plan.keep.push(e);
  }
  for (const n of people) if (!current.some((e) => e.name === n)) plan.add.push(n);
  return plan;
}

/** Every Google event id that IS this visit on someone's calendar. */
export function visitEventIds(v: InviteVisitShape): string[] {
  const out: string[] = [];
  for (const id of [v.googleEventId ?? "", ...normalizeInvites(v).map((e) => e.eventId ?? "")]) if (id && !out.includes(id)) out.push(id);
  return out;
}

export function recipientLine(r: RecipientResult): string {
  if (r.action === "keep") return "";
  const noun = r.action === "cancel" ? "cancellation" : r.action === "update" ? "update" : "invite";
  switch (r.status) {
    case "calendar":
      return r.action === "cancel" ? `Removed from ${r.name}'s Google Calendar` : r.action === "update" ? `Updated on ${r.name}'s Google Calendar` : `Added to ${r.name}'s Google Calendar`;
    case "sent":
      return `${noun[0].toUpperCase()}${noun.slice(1)} emailed to ${r.name}`;
    case "invites-off":
      return `${r.name} has calendar-invite emails turned off`;
    case "gmail-off":
      return `Email ${noun}s need Gmail connected`;
    case "no-mailbox":
      return `No connected mailbox to send ${r.name}'s ${noun}`;
    case "no-email":
      return `${r.name} has no email on the team roster`;
    case "failed":
      return `${r.name}'s ${noun} failed — save again to retry`;
  }
}

export function inviteSummary(rs: readonly RecipientResult[]): string {
  const lines = rs.map(recipientLine).filter(Boolean);
  return lines.length ? lines.join(". ") + "." : "";
}
```

- [ ] **Step 4: Extend `src/lib/ics.ts`**

Replace the `IcsEvent` type and `buildIcs`:

```ts
export type IcsEvent = {
  uid: string; // globally unique, e.g. "sv-SV-5001@peak-app"
  title: string;
  description?: string;
  location?: string;
  start: number; // epoch-ms
  end: number; // epoch-ms
  stampAt: number; // epoch-ms (DTSTAMP — pass Date.now() from the caller)
  /** Spec 2026-10-09 site-visit scheduling: "CANCEL" removes the event
   *  (same UID). Omitted = PUBLISH, byte-identical to the original invite. */
  method?: "PUBLISH" | "CANCEL";
  /** RFC-5545 SEQUENCE — an update or cancel carries a higher number than
   *  the last copy sent. Omitted = no SEQUENCE line. */
  sequence?: number;
};
```

and in `buildIcs`, replace the `lines` array with:

```ts
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Peak Systems Group//Quartzite-6//EN",
    "METHOD:" + (ev.method ?? "PUBLISH"),
    "BEGIN:VEVENT",
    "UID:" + esc(ev.uid),
    "DTSTAMP:" + utc(ev.stampAt),
    ...(ev.sequence != null ? ["SEQUENCE:" + Math.max(0, Math.round(ev.sequence))] : []),
    "DTSTART:" + utc(ev.start),
    "DTEND:" + utc(ev.end),
    ...(ev.method === "CANCEL" ? ["STATUS:CANCELLED"] : []),
    "SUMMARY:" + esc(ev.title),
    ...(ev.location ? ["LOCATION:" + esc(ev.location)] : []),
    ...(ev.description ? ["DESCRIPTION:" + esc(ev.description)] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
```

Update the header comment's "METHOD:PUBLISH and no ATTENDEE lines" sentence to add: "An update re-sends PUBLISH with a higher SEQUENCE; a removal sends METHOD:CANCEL with the same UID (spec 2026-10-09 site-visit scheduling)."

- [ ] **Step 5: Store: `invites` on the record**

In `src/lib/stores/site-visits.ts`:

1. Add `import { normalizeInvites, type VisitInviteRecipient } from "@/lib/visit-invite-plan";`.
2. In `type SiteVisit`, right after `invite?: SiteVisitInvite | null;` add:

```ts
  /** Spec 2026-10-09 site-visit scheduling — what each person on the visit
   *  was sent (calendar event or .ics, and the times they were told).
   *  Normalized on read: a pre-spec-2 `invite` / `googleEventId` reads as one
   *  entry for the lead. `invite` / `googleEventId` keep mirroring the lead's
   *  entry for older readers. */
  invites: VisitInviteRecipient[];
```

3. In `normalizeVisit`, after the attendees line add `v.invites = normalizeInvites(v);`.
4. `SiteVisitInput`: add `"invites"` to the `Omit` list. In `createVisit` add `invites: [],` next to `invite: null,`.
5. Delete `stampInvite` and `stampGoogleEvent` (their only caller was `visit-invite.ts`; run `grep -rn "stampInvite\|stampGoogleEvent" src` to confirm none remain) and add:

```ts
/** Record what each person was sent (spec 2026-10-09 site-visit scheduling).
 *  The lead's entry is mirrored into the old single fields for older readers
 *  (the agenda's googleEventId dedupe, "invite sent" on the company record). */
export async function setVisitInvites(id: string, invites: VisitInviteRecipient[], lead: VisitInviteRecipient | null): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.invites = invites;
    if (lead?.channel === "calendar" && lead.eventId) d.googleEventId = lead.eventId;
    if (lead?.channel === "ics") d.invite = { sentAt: lead.sentAt, to: lead.to, fromMailbox: lead.fromMailbox ?? "", ...(lead.gmailId ? { gmailId: lead.gmailId } : {}) };
    d.updatedAt = Date.now();
  });
}
```

- [ ] **Step 6: Rewrite `src/lib/visit-invite.ts`**

Replace the whole file with:

```ts
import { buildIcs } from "@/lib/ics";
import { visitPeople } from "@/lib/drive-plan/stops";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import type { EventWriteInput } from "@/lib/google/calendar";
import { invitesOn } from "@/lib/stores/notif-prefs";
import { setVisitInvites, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";
import {
  normalizeInvites,
  planInviteChanges,
  visitUid,
  type InviteStatus,
  type RecipientResult,
  type VisitInviteRecipient,
} from "@/lib/visit-invite-plan";

/**
 * Site-visit invite delivery (D76/D77; per recipient since spec 2026-10-09
 * site-visit scheduling). Every person on the visit — lead + attendees — gets
 * it on their own calendar: a direct Google Calendar event when their mailbox
 * has the Calendar grant (D77), else an emailed .ics (UID sv-<id>@peak-app).
 * Adding a person invites them, removing one cancels theirs (calendar delete /
 * METHOD:CANCEL), moving the visit updates everyone. The customer is never
 * emailed (D76-B). Never throws: the visit is saved whatever the invites do.
 */

export type { InviteStatus, RecipientResult } from "@/lib/visit-invite-plan";
export type InviteReport = { status: InviteStatus; recipients: RecipientResult[] };

export type InviteDeps = {
  now(): number;
  gmailEnabled(): boolean;
  users(): Promise<Array<{ id: string; name: string; email: string }>>;
  invitesOn(name: string): Promise<boolean>;
  calendarKeyFor(userId: string): Promise<string | null>;
  insertEvent(key: string, ev: EventWriteInput): Promise<{ id: string }>;
  updateEvent(key: string, eventId: string, ev: EventWriteInput): Promise<unknown>;
  deleteEvent(key: string, eventId: string): Promise<void>;
  sendIcs(opts: {
    siteVisitId: string;
    schedulerUserId: string | null;
    toAddr: string;
    subject: string;
    body: string;
    icsText: string;
  }): Promise<{ gmailId: string; gmailThreadId: string; fromMailbox: string } | null>;
  saveInvites(id: string, invites: VisitInviteRecipient[], lead: VisitInviteRecipient | null): Promise<void>;
  log(msg: string, err?: unknown): void;
};

function defaultDeps(): InviteDeps {
  return {
    now: Date.now,
    gmailEnabled,
    users: async () => (await allUsers()).map((u) => ({ id: u.id, name: u.name, email: u.email })),
    invitesOn,
    calendarKeyFor: async (userId) => {
      const key = personalKey(userId);
      const info = await getConnectionInfo(key);
      return info && hasCalendarScope(info.scope) ? key : null;
    },
    insertEvent: async (key, ev) => (await import("@/lib/google/calendar")).insertEvent(key, ev),
    updateEvent: async (key, id, ev) => (await import("@/lib/google/calendar")).updateEvent(key, id, ev),
    deleteEvent: async (key, id) => (await import("@/lib/google/calendar")).deleteEvent(key, id),
    sendIcs: async (opts) => (await import("@/lib/gmail/bridge")).sendSiteVisitInvite(opts),
    saveInvites: setVisitInvites,
    log: (msg, err) => console.error(msg, err),
  };
}

function details(rec: SiteVisit, me: { name: string }) {
  // Event title = venue + reason (the punch-list formatter).
  const title = `${rec.venue || rec.customer} — ${rec.reason}`;
  const team = visitPeople(rec);
  const body = [
    `Site visit: ${rec.reason}`,
    `Customer: ${rec.customer}`,
    rec.venue ? `Venue: ${rec.venue}` : "",
    rec.address ? `Address: ${rec.address}` : "",
    rec.contactName
      ? `Contact: ${rec.contactName}` + (rec.contactPhone ? ` · ${rec.contactPhone}` : "") + (rec.contactEmail ? ` · ${rec.contactEmail}` : "")
      : "",
    team.length > 1 ? `Team: ${team[0]} (lead), ${team.slice(1).join(", ")}` : "",
    rec.notes ? `Notes: ${rec.notes}` : "",
    `Scheduled by ${me.name} in Peak (${rec.id}).`,
  ]
    .filter(Boolean)
    .join("\n");
  const location = rec.address || [rec.venue, rec.customer].filter(Boolean).join(", ");
  return { title, body, location };
}

function leadStatus(rec: SiteVisit, results: RecipientResult[]): InviteStatus {
  return (
    results.find((r) => r.name === rec.assignedTo && r.action !== "cancel")?.status ??
    results.find((r) => r.action !== "cancel")?.status ??
    "failed"
  );
}

type Target = { people: string[]; startAt: number | null; endAt: number | null } | null;

async function syncInvites(rec: SiteVisit, target: Target, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport> {
  const d: InviteDeps = { ...defaultDeps(), ...deps };
  const plan = planInviteChanges(normalizeInvites(rec), target);
  const results: RecipientResult[] = plan.keep.map((e) => ({ name: e.name, action: "keep", status: e.channel === "calendar" ? "calendar" : "sent" }));
  if (!plan.add.length && !plan.update.length && !plan.cancel.length) return { status: leadStatus(rec, results), recipients: results };

  const next: VisitInviteRecipient[] = [...plan.keep];
  const users = await d.users();
  const userOf = (name: string) => users.find((u) => u.name === name) ?? null;
  const keyOf = async (name: string): Promise<string | null> => {
    const u = userOf(name);
    if (!u || !d.gmailEnabled()) return null;
    try {
      return await d.calendarKeyFor(u.id);
    } catch {
      return null;
    }
  };
  const { title, body, location } = details(rec, me);
  const now = d.now();
  const uid = visitUid(rec.id);
  const startAt = target?.startAt ?? 0;
  const endAt = target?.endAt ?? 0;
  const write: EventWriteInput = { title, startMs: startAt, endMs: endAt, description: body, location };
  const icsFor = (method: "PUBLISH" | "CANCEL", sequence: number, s: number, e: number) =>
    buildIcs({ uid, title, description: body, location, start: s, end: e, stampAt: now, method, sequence });
  const email = (toAddr: string, subject: string, icsText: string) =>
    d.sendIcs({ siteVisitId: rec.id, schedulerUserId: me.id, toAddr, subject, body, icsText });

  for (const name of plan.add) {
    const toAddr = userOf(name)?.email || "";
    let status: InviteStatus = "failed";
    if (!d.gmailEnabled()) status = "gmail-off";
    else if (!toAddr) status = "no-email";
    else if (!(await d.invitesOn(name))) status = "invites-off";
    else {
      let placed = false;
      const key = await keyOf(name);
      if (key) {
        try {
          const ev = await d.insertEvent(key, write);
          next.push({ name, to: toAddr, channel: "calendar", eventId: ev.id, sentAt: now, startAt, endAt, sequence: 0, fromMailbox: key, gmailId: null });
          status = "calendar";
          placed = true;
        } catch (err) {
          d.log("[site-visit] calendar write failed:", err);
        }
      }
      if (!placed) {
        try {
          const sent = await email(toAddr, title, icsFor("PUBLISH", 0, startAt, endAt));
          if (sent) {
            next.push({ name, to: toAddr, channel: "ics", eventId: null, sentAt: now, startAt, endAt, sequence: 0, fromMailbox: sent.fromMailbox, gmailId: sent.gmailId });
            status = "sent";
          } else status = "no-mailbox";
        } catch (err) {
          d.log("[site-visit] invite send failed:", err);
          status = "failed";
        }
      }
    }
    results.push({ name, action: "invite", status });
  }

  // Update / cancel go to people already invited — no invites-toggle check:
  // they hold a copy that must not go stale.
  const change = async (e: VisitInviteRecipient, kind: "update" | "cancel"): Promise<{ status: InviteStatus; ok: boolean; gmailId: string | null }> => {
    if (!d.gmailEnabled()) return { status: "gmail-off", ok: false, gmailId: null };
    if (e.channel === "calendar") {
      const key = await keyOf(e.name);
      if (!key || !e.eventId) return { status: "failed", ok: false, gmailId: null };
      try {
        if (kind === "update") await d.updateEvent(key, e.eventId, write);
        else await d.deleteEvent(key, e.eventId);
        return { status: "calendar", ok: true, gmailId: null };
      } catch (err) {
        d.log(`[site-visit] calendar ${kind} failed:`, err);
        return { status: "failed", ok: false, gmailId: null };
      }
    }
    const toAddr = e.to || userOf(e.name)?.email || "";
    if (!toAddr) return { status: "no-email", ok: false, gmailId: null };
    try {
      const sent =
        kind === "cancel"
          ? await email(toAddr, `Cancelled: ${title}`, icsFor("CANCEL", e.sequence + 1, e.startAt, e.endAt))
          : await email(toAddr, `Updated: ${title}`, icsFor("PUBLISH", e.sequence + 1, startAt, endAt));
      return sent ? { status: "sent", ok: true, gmailId: sent.gmailId } : { status: "no-mailbox", ok: false, gmailId: null };
    } catch (err) {
      d.log(`[site-visit] invite ${kind} failed:`, err);
      return { status: "failed", ok: false, gmailId: null };
    }
  };

  for (const e of plan.update) {
    const r = await change(e, "update");
    next.push(r.ok ? { ...e, startAt, endAt, sentAt: now, sequence: e.sequence + 1, gmailId: r.gmailId ?? e.gmailId } : e);
    results.push({ name: e.name, action: "update", status: r.status });
  }
  for (const e of plan.cancel) {
    const r = await change(e, "cancel");
    if (!r.ok) next.push(e); // kept, so the next save retries the cancellation
    results.push({ name: e.name, action: "cancel", status: r.status });
  }

  const lead = target ? next.find((e) => e.name === rec.assignedTo) ?? null : null;
  try {
    await d.saveInvites(rec.id, next, lead);
  } catch (err) {
    d.log("[site-visit] invite stamp failed:", err);
  }
  return { status: leadStatus(rec, results), recipients: results };
}

/** Bring every person's calendar in line with the saved visit: invite the
 *  new, update the moved, cancel the removed. Pass the FRESH record. */
export async function dispatchVisitInvite(rec: SiteVisit, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport> {
  try {
    const scheduled = rec.stage === "scheduled" || rec.stage === "done";
    return await syncInvites(rec, scheduled ? { people: visitPeople(rec), startAt: rec.startAt, endAt: rec.endAt } : null, me, deps);
  } catch (err) {
    console.error("[site-visit] invite dispatch failed:", err);
    return { status: "failed", recipients: [] };
  }
}

/** The visit is being deleted: everyone invited gets a cancellation. */
export async function cancelVisitInvites(rec: SiteVisit, me: { id: string; name: string }, deps?: Partial<InviteDeps>): Promise<InviteReport> {
  try {
    return await syncInvites(rec, null, me, deps);
  } catch (err) {
    console.error("[site-visit] invite cancel failed:", err);
    return { status: "failed", recipients: [] };
  }
}
```

- [ ] **Step 7: Callers, Gmail import dedupe, drive-chain dedupe**

`src/app/(app)/venue-assessments/visit-actions.ts`:

1. Change the invite import to `import { cancelVisitInvites, dispatchVisitInvite, type InviteStatus, type RecipientResult } from "@/lib/visit-invite";`.
2. Delete the private `calendarKeyFor` helper and the now-unused imports (`gmailEnabled`, `hasCalendarScope`, `personalKey`, `getConnectionInfo`, `allUsers`).
3. In `removeVisitAction`: change the first line to `const me = await requireUser();`, replace the whole `if (v.googleEventId) { … }` block with:

```ts
  // Spec 2026-10-09 site-visit scheduling — everyone invited gets a
  // cancellation (calendar delete / METHOD:CANCEL). Never blocks the delete.
  await cancelVisitInvites(v, { id: me.id, name: me.name });
```

   and update the doc comment above the function to say so.
4. In `scheduleVisitAction`, change the return type to `Promise<{ ok: true; inviteStatus: InviteStatus; invites: RecipientResult[] } | { ok: false; error: string }>` and replace the invite lines with:

```ts
  const report = fresh ? await dispatchVisitInvite(fresh, { id: me.id, name: me.name }) : null;
  revalidatePath("/", "layout");
  return { ok: true, inviteStatus: report?.status ?? "failed", invites: report?.recipients ?? [] };
```

   (Keep the `after(` block above it exactly as is.)

`src/app/(app)/inbox/site-visit-actions.ts`: add `RecipientResult` to the type imports (`import type { InviteStatus, RecipientResult } from "@/lib/visit-invite";` and re-export `RecipientResult` next to `InviteStatus`), change the success type to `{ ok: true; id: string; inviteStatus: InviteStatus; invites: RecipientResult[] }`, and replace the dispatch lines with:

```ts
  const report = await dispatchVisitInvite(rec, {
    id: me.id,
    name: me.name,
  });

  revalidatePath("/", "layout");
  return { ok: true, id: rec.id, inviteStatus: report.status, invites: report.recipients };
```

`src/lib/gmail/bridge.ts`, in `buildImportDedup`, replace the `site_visits` loop with:

```ts
  for (const d of await listDocs<{ id: string; invite?: { gmailId?: string }; invites?: Array<{ gmailId?: string | null } | null> }>(
    "site_visits"
  )) {
    if (d.invite?.gmailId) known.add(d.invite.gmailId);
    // Spec 2026-10-09 site-visit scheduling — one sent invite per recipient.
    for (const r of Array.isArray(d.invites) ? d.invites : []) if (r?.gmailId) known.add(r.gmailId);
  }
```

`src/lib/drive-plan/stops.ts`: replace `isVisitIcsCopy` with

```ts
export function isVisitIcsCopy(
  ev: { id: string; iCalUID: string },
  visits: ReadonlyArray<{ id: string; googleEventId?: string | null; eventIds?: readonly string[] | null }>
): boolean {
  return visits.some(
    (v) => ev.iCalUID === `sv-${v.id}@peak-app` || (!!v.googleEventId && v.googleEventId === ev.id) || !!v.eventIds?.includes(ev.id)
  );
}
```

and add to `StopSourceVisit`, after `googleEventId?: string | null;`:

```ts
  /** Spec 2026-10-09 site-visit scheduling — every person's direct calendar copy of the visit. */
  eventIds?: string[] | null;
```

`src/lib/drive-plan/load.ts`: add `import { visitEventIds } from "@/lib/visit-invite-plan";` and in the `visitSrc` mapping, after `googleEventId: v.googleEventId ?? null,` add `eventIds: visitEventIds(v),`.

- [ ] **Step 8: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures (the drive-time trigger pins still pass: two `resyncForVisitChange(` calls in visit-actions, `after(` before `await dispatchVisitInvite(`).
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-invite-plan.ts src/lib/visit-invite.ts src/lib/ics.ts src/lib/stores/site-visits.ts src/lib/gmail/bridge.ts src/lib/drive-plan/stops.ts src/lib/drive-plan/load.ts "src/app/(app)/venue-assessments/visit-actions.ts" "src/app/(app)/inbox/site-visit-actions.ts" scripts/test-site-visits.ts` → 0 problems.

- [ ] **Step 9: Commit**

```bash
git add src/lib/visit-invite-plan.ts src/lib/visit-invite.ts src/lib/ics.ts src/lib/stores/site-visits.ts src/lib/gmail/bridge.ts src/lib/drive-plan/stops.ts src/lib/drive-plan/load.ts "src/app/(app)/venue-assessments/visit-actions.ts" "src/app/(app)/inbox/site-visit-actions.ts" scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): per-recipient invites — add, update, cancel with one UID

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Scheduling settings — work hours, same area, drive limit, look-ahead

**Files:**
- Create: `src/lib/visit-plan/settings.ts`, `src/components/visit-booking/work-hours-editor.tsx`, `src/app/(app)/settings/scheduling-defaults-card.tsx`, `src/app/(app)/account/work-hours-card.tsx`
- Modify: `src/lib/stores/schedule-prefs.ts`, `src/app/(app)/settings/{actions.ts,page.tsx,settings-client.tsx,groups/field.tsx,groups/types.ts}`, `src/app/(app)/account/{actions.ts,page.tsx}`, `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `getBlob`/`setBlob` (top-level merge), `SCHEDULE_DEFAULTS_BLOB`, `getScheduleDefaults`, `getUserSchedulePrefs`, `saveUserSchedulePrefs` from `schedule-prefs.ts`.
- Produces:
  - `settings.ts` (pure): `type WorkHours = { days: number[]; startMin: number; endMin: number }` (days 0 = Sun … 6 = Sat; minutes after Chicago midnight; `endMin` may be 1440); `DEFAULT_WORK_HOURS`; `type SchedulingSettings = { workHours: WorkHours; sameAreaMin: number; dailyDriveLimitMin: number; nearbyLookaheadDays: number }`; `DEFAULT_SCHEDULING`; `SCHEDULING_LIMITS`; `DAY_SHORT`; `cleanWorkHours(v: unknown): WorkHours | null`; `readSchedulingSettings(raw: Record<string, unknown>): SchedulingSettings`; `cleanSchedulingInput(input: unknown): { ok: true; value: SchedulingSettings } | { ok: false; error: string }`; `clockToMin(s: string): number | null`; `minToClock(min: number): string`; `fmtClock(min: number): string` (`480` → `"8:00"`, `1020` → `"5:00"`); `fmtWorkHours(h: WorkHours): string` (`"Mon–Fri 8:00–5:00"`).
  - `schedule-prefs.ts`: `getSchedulingSettings(): Promise<SchedulingSettings>`; `saveSchedulingSettings(input: unknown): Promise<{ ok: true; settings: SchedulingSettings } | { ok: false; error: string }>`; `getUserWorkHours(userId): Promise<WorkHours | null>`; `saveUserWorkHours(userId, input: unknown): Promise<{ ok: true; workHours: WorkHours | null } | { ok: false; error: string }>` (`null` = use the company default); `workHoursFor(userId): Promise<WorkHours>`.
  - Actions: `saveSchedulingSettingsAction(input: unknown)` (settings, `requirePerm("manage_users")`); `saveMyWorkHoursAction(input: unknown)` (account, `requireUser()`).
  - Test helpers `fnBody(src, name)` and `firstAwait(body, call)` in `scripts/test-site-visits.ts`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-site-visits.ts`:

```ts
import { like } from "drizzle-orm";
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
```

Append to the helpers block:

```ts
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
```

Append the check:

```ts
export async function siteVisitsSettingsChecks(ok: Ok): Promise<void> {
  ok(cleanWorkHours({ days: [5, 1, 1, 9, 2.5, 3], startMin: 480, endMin: 1020 })?.days.join() === "1,3,5",
    "site-visits settings: work days are whole 0–6, deduped and sorted");
  ok(cleanWorkHours({ days: [], startMin: 480, endMin: 1020 }) === null && cleanWorkHours({ days: [1], startMin: 600, endMin: 600 }) === null &&
     cleanWorkHours({ days: [1], startMin: -5, endMin: 600 }) === null && cleanWorkHours("x") === null,
    "site-visits settings: no days, an end not after the start, or junk is refused");
  ok(clockToMin("08:30") === 510 && clockToMin("24:00") === null && clockToMin("8:5") === null && minToClock(510) === "08:30" && minToClock(1440) === "23:59",
    "site-visits settings: time inputs convert both ways");
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

  const db = await getDb();
  const U = "TESTvisits:u1";
  const snapshot = await getSchedulingSettings();
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
    await saveUserWorkHours(U, null);
    ok((await getUserWorkHours(U)) === null && JSON.stringify(await workHoursFor(U)) === JSON.stringify(good.workHours),
      "site-visits settings: clearing personal hours falls back to the company default");
  } finally {
    await saveSchedulingSettings(snapshot);
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
```

Wire it: add `siteVisitsSettingsChecks` to the harness import and `.then(() => siteVisitsSettingsChecks(ok))` after `.then(() => siteVisitsInviteChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/settings'`, `getSchedulingSettings` not exported.

- [ ] **Step 3: Implement `src/lib/visit-plan/settings.ts`**

```ts
/**
 * Site-visit scheduling settings (spec 2026-10-09 site-visit scheduling,
 * Part 1 "Settings"). Pure and client-safe: types, defaults, cleaning and
 * formatting. Stored in the schedule_defaults / schedule_prefs:<userId> blobs
 * by src/lib/stores/schedule-prefs.ts.
 */
export type WorkHours = {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** minutes after Chicago midnight */
  startMin: number;
  /** minutes after Chicago midnight; 1440 = midnight at the end of the day */
  endMin: number;
};

export const DEFAULT_WORK_HOURS: WorkHours = { days: [1, 2, 3, 4, 5], startMin: 8 * 60, endMin: 17 * 60 };

export type SchedulingSettings = {
  workHours: WorkHours;
  /** a stop within this many drive minutes is "in the same area" */
  sameAreaMin: number;
  /** a day's total drive (buffer included) above this is flagged */
  dailyDriveLimitMin: number;
  /** how many days ahead Nearby days looks, from today */
  nearbyLookaheadDays: number;
};

export const DEFAULT_SCHEDULING: SchedulingSettings = {
  workHours: DEFAULT_WORK_HOURS,
  sameAreaMin: 45,
  dailyDriveLimitMin: 300,
  nearbyLookaheadDays: 21,
};

export const SCHEDULING_LIMITS = {
  sameAreaMin: [5, 180],
  dailyDriveLimitMin: [30, 960],
  nearbyLookaheadDays: [1, 60],
} as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function wholeIn(v: unknown, lo: number, hi: number): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r < lo || r > hi ? null : r;
}

export function cleanWorkHours(v: unknown): WorkHours | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const startMin = wholeIn(o.startMin, 0, 1439);
  const endMin = wholeIn(o.endMin, 1, 1440);
  if (!days.length || startMin == null || endMin == null || endMin <= startMin) return null;
  return { days, startMin, endMin };
}

/** Stored blob → settings; each bad or missing field falls back to its default. */
export function readSchedulingSettings(raw: Record<string, unknown>): SchedulingSettings {
  const [aLo, aHi] = SCHEDULING_LIMITS.sameAreaMin;
  const [lLo, lHi] = SCHEDULING_LIMITS.dailyDriveLimitMin;
  const [dLo, dHi] = SCHEDULING_LIMITS.nearbyLookaheadDays;
  return {
    workHours: cleanWorkHours(raw?.workHours) ?? DEFAULT_SCHEDULING.workHours,
    sameAreaMin: wholeIn(raw?.sameAreaMin, aLo, aHi) ?? DEFAULT_SCHEDULING.sameAreaMin,
    dailyDriveLimitMin: wholeIn(raw?.dailyDriveLimitMin, lLo, lHi) ?? DEFAULT_SCHEDULING.dailyDriveLimitMin,
    nearbyLookaheadDays: wholeIn(raw?.nearbyLookaheadDays, dLo, dHi) ?? DEFAULT_SCHEDULING.nearbyLookaheadDays,
  };
}

/** The admin save: refuses instead of storing a silent fallback. */
export function cleanSchedulingInput(input: unknown): { ok: true; value: SchedulingSettings } | { ok: false; error: string } {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const workHours = cleanWorkHours(o.workHours);
  if (!workHours) return { ok: false, error: "Work hours need at least one day and an end after the start." };
  const sameAreaMin = wholeIn(o.sameAreaMin, ...SCHEDULING_LIMITS.sameAreaMin);
  if (sameAreaMin == null) return { ok: false, error: "Same-area drive time must be 5–180 minutes." };
  const dailyDriveLimitMin = wholeIn(o.dailyDriveLimitMin, ...SCHEDULING_LIMITS.dailyDriveLimitMin);
  if (dailyDriveLimitMin == null) return { ok: false, error: "Daily drive limit must be 30 minutes to 16 hours." };
  const nearbyLookaheadDays = wholeIn(o.nearbyLookaheadDays, ...SCHEDULING_LIMITS.nearbyLookaheadDays);
  if (nearbyLookaheadDays == null) return { ok: false, error: "Nearby days must look 1–60 days ahead." };
  return { ok: true, value: { workHours, sameAreaMin, dailyDriveLimitMin, nearbyLookaheadDays } };
}

/** "HH:MM" (24 h, from <input type="time">) → minutes, or null. */
export function clockToMin(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h > 23 || mm > 59 ? null : h * 60 + mm;
}

/** minutes → "HH:MM" for <input type="time"> (1440 shows as 23:59). */
export function minToClock(min: number): string {
  const v = Math.max(0, Math.min(1439, Math.round(min)));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** 480 → "8:00", 1020 → "5:00" (12-hour, no am/pm — the spec's style). */
export function fmtClock(min: number): string {
  const h = Math.floor(min / 60) % 12 || 12;
  return `${h}:${String(Math.round(min) % 60).padStart(2, "0")}`;
}

function fmtDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  const contiguous = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  return contiguous ? `${DAY_SHORT[days[0]]}–${DAY_SHORT[days[days.length - 1]]}` : days.map((d) => DAY_SHORT[d]).join(", ");
}

export function fmtWorkHours(h: WorkHours): string {
  return `${fmtDays(h.days)} ${fmtClock(h.startMin)}–${fmtClock(h.endMin)}`;
}
```

- [ ] **Step 4: Store functions in `src/lib/stores/schedule-prefs.ts`**

Add to the header comment's blob list: `schedule_defaults` also holds `{ workHours, sameAreaMin, dailyDriveLimitMin, nearbyLookaheadDays }` and `schedule_prefs:<userId>` also holds `{ workHours | null }` (spec 2026-10-09 site-visit scheduling). Add the import and functions at the end of the "buffer" section (before `getStayOvers`):

```ts
import {
  cleanSchedulingInput,
  cleanWorkHours,
  readSchedulingSettings,
  type SchedulingSettings,
  type WorkHours,
} from "@/lib/visit-plan/settings";

/* ---- site-visit scheduling (spec 2026-10-09 site-visit scheduling) ------ */

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  return readSchedulingSettings(await getBlob<Record<string, unknown>>(SCHEDULE_DEFAULTS_BLOB, {}));
}

/** Admin save. setBlob merges top-level keys, so driveBufferMin is untouched. */
export async function saveSchedulingSettings(
  input: unknown
): Promise<{ ok: true; settings: SchedulingSettings } | { ok: false; error: string }> {
  const c = cleanSchedulingInput(input);
  if (!c.ok) return c;
  await setBlob(SCHEDULE_DEFAULTS_BLOB, { ...c.value });
  return { ok: true, settings: c.value };
}

export async function getUserWorkHours(userId: string): Promise<WorkHours | null> {
  const raw = await getBlob<Record<string, unknown>>(prefsId(userId), {});
  return cleanWorkHours(raw.workHours);
}

/** null = use the company default. */
export async function saveUserWorkHours(
  userId: string,
  input: unknown
): Promise<{ ok: true; workHours: WorkHours | null } | { ok: false; error: string }> {
  if (input === null) {
    await setBlob(prefsId(userId), { workHours: null });
    return { ok: true, workHours: null };
  }
  const h = cleanWorkHours(input);
  if (!h) return { ok: false, error: "Pick at least one day and an end after the start." };
  await setBlob(prefsId(userId), { workHours: h });
  return { ok: true, workHours: h };
}

export async function workHoursFor(userId: string): Promise<WorkHours> {
  const [s, own] = await Promise.all([getSchedulingSettings(), getUserWorkHours(userId)]);
  return own ?? s.workHours;
}
```

(Put the `import` with the other imports at the top of the file, not mid-file.)

- [ ] **Step 5: Actions**

Append to `src/app/(app)/settings/actions.ts`:

```ts
/** Spec 2026-10-09 site-visit scheduling — company work hours, same-area
 *  drive time, daily drive limit and Nearby-days look-ahead. Read live by the
 *  booking check; nothing to re-sync. */
export async function saveSchedulingSettingsAction(input: unknown) {
  await requirePerm("manage_users");
  const { saveSchedulingSettings } = await import("@/lib/stores/schedule-prefs");
  const r = await saveSchedulingSettings(input);
  if (!r.ok) return { ok: false as const, error: r.error };
  revalidatePath("/", "layout");
  return { ok: true as const, settings: r.settings };
}
```

Append to `src/app/(app)/account/actions.ts`:

```ts
/** Spec 2026-10-09 site-visit scheduling — the signed-in person's own work
 *  hours (null = company default). Only feeds conflict flags. */
export async function saveMyWorkHoursAction(input: unknown) {
  const me = await requireUser();
  const { saveUserWorkHours } = await import("@/lib/stores/schedule-prefs");
  const r = await saveUserWorkHours(me.id, input);
  if (!r.ok) return { ok: false as const, error: r.error };
  revalidatePath("/", "layout");
  return { ok: true as const, workHours: r.workHours };
}
```

- [ ] **Step 6: UI — the shared editor and two cards**

Create `src/components/visit-booking/work-hours-editor.tsx`:

```tsx
"use client";

import { clockToMin, DAY_SHORT, minToClock, type WorkHours } from "@/lib/visit-plan/settings";

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon first

/** Work days (toggle chips) + start/end times. Controlled. */
export default function WorkHoursEditor({ value, onChange, disabled = false }: { value: WorkHours; onChange: (next: WorkHours) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <div role="group" aria-label="Work days" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {ORDER.map((d) => {
          const on = value.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b) })}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: "4px 8px",
                borderRadius: 6,
                cursor: disabled ? "default" : "pointer",
                border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
                background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
                color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#5b616e",
              }}
            >
              {DAY_SHORT[d]}
            </button>
          );
        })}
      </div>
      <input
        type="time"
        aria-label="Start"
        className="pk-input"
        style={{ width: 110, fontSize: 12.5 }}
        disabled={disabled}
        value={minToClock(value.startMin)}
        onChange={(e) => {
          const m = clockToMin(e.target.value);
          if (m != null) onChange({ ...value, startMin: m });
        }}
      />
      <span style={{ fontSize: 12, color: "#9aa0ab" }}>to</span>
      <input
        type="time"
        aria-label="End"
        className="pk-input"
        style={{ width: 110, fontSize: 12.5 }}
        disabled={disabled}
        value={minToClock(value.endMin)}
        onChange={(e) => {
          const m = clockToMin(e.target.value);
          if (m != null) onChange({ ...value, endMin: m });
        }}
      />
    </div>
  );
}
```

Create `src/app/(app)/settings/scheduling-defaults-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import WorkHoursEditor from "@/components/visit-booking/work-hours-editor";
import type { SchedulingSettings } from "@/lib/visit-plan/settings";
import { saveSchedulingSettingsAction } from "./actions";

const row = { display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" } as const;
const lbl = { fontSize: 12.5, fontWeight: 600, minWidth: 150 } as const;
const unit = { fontSize: 12, color: "#9aa0ab" } as const;

/** Spec 2026-10-09 site-visit scheduling — company scheduling settings. */
export function SchedulingDefaultsCard({ initial }: { initial: SchedulingSettings }) {
  const [hours, setHours] = useState(initial.workHours);
  const [sameArea, setSameArea] = useState(String(initial.sameAreaMin));
  const [limitH, setLimitH] = useState(String(initial.dailyDriveLimitMin / 60));
  const [look, setLook] = useState(String(initial.nearbyLookaheadDays));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      setMsg("");
      setError("");
      const r = await saveSchedulingSettingsAction({
        workHours: hours,
        sameAreaMin: sameArea.trim() === "" ? "" : Number(sameArea),
        dailyDriveLimitMin: limitH.trim() === "" ? "" : Math.round(Number(limitH) * 60),
        nearbyLookaheadDays: look.trim() === "" ? "" : Number(look),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setHours(r.settings.workHours);
      setSameArea(String(r.settings.sameAreaMin));
      setLimitH(String(r.settings.dailyDriveLimitMin / 60));
      setLook(String(r.settings.nearbyLookaheadDays));
      setMsg("Saved");
    });
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Site-visit scheduling</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        Used to flag conflicts and suggest nearby days while booking. Nothing is ever moved or blocked.
      </div>
      <div style={row}>
        <span style={lbl}>Work hours (default)</span>
        <WorkHoursEditor value={hours} onChange={setHours} disabled={pending} />
      </div>
      <div style={row}>
        <span style={lbl}>Same area</span>
        <input type="number" min={5} max={180} className="pk-input" style={{ width: 80, fontSize: 12.5 }} value={sameArea} onChange={(e) => setSameArea(e.target.value)} />
        <span style={unit}>drive minutes</span>
      </div>
      <div style={row}>
        <span style={lbl}>Daily drive limit</span>
        <input type="number" min={0.5} max={16} step={0.5} className="pk-input" style={{ width: 80, fontSize: 12.5 }} value={limitH} onChange={(e) => setLimitH(e.target.value)} />
        <span style={unit}>hours, buffer included</span>
      </div>
      <div style={row}>
        <span style={lbl}>Nearby days look ahead</span>
        <input type="number" min={1} max={60} className="pk-input" style={{ width: 80, fontSize: 12.5 }} value={look} onChange={(e) => setLook(e.target.value)} />
        <span style={unit}>days</span>
      </div>
      <div style={{ ...row, marginTop: 14 }}>
        <button className="pk-btn-accent" style={{ fontSize: 12.5 }} disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <span style={{ fontSize: 11, color: "#1f7a52" }}>{msg}</span>}
        {error && <span style={{ fontSize: 11, color: "#b42318" }}>{error}</span>}
      </div>
    </div>
  );
}
```

Create `src/app/(app)/account/work-hours-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import WorkHoursEditor from "@/components/visit-booking/work-hours-editor";
import { fmtWorkHours, type WorkHours } from "@/lib/visit-plan/settings";
import { saveMyWorkHoursAction } from "./actions";

/** Spec 2026-10-09 site-visit scheduling — this person's work hours. */
export default function WorkHoursCard({ initial, companyDefault }: { initial: WorkHours | null; companyDefault: WorkHours }) {
  const router = useRouter();
  const [useDefault, setUseDefault] = useState(initial == null);
  const [hours, setHours] = useState<WorkHours>(initial ?? companyDefault);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const save = (nextUseDefault: boolean, next: WorkHours) =>
    startTransition(async () => {
      setMsg("");
      setError("");
      const r = await saveMyWorkHoursAction(nextUseDefault ? null : next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setHours(r.workHours ?? companyDefault);
      setMsg("Saved");
      router.refresh();
    });
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Work hours</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        A visit or drive outside these hours is flagged when someone books you. Nothing is blocked.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 10 }}>
        <input
          type="checkbox"
          checked={useDefault}
          disabled={pending}
          onChange={(e) => {
            setUseDefault(e.target.checked);
            if (e.target.checked) save(true, hours);
          }}
        />
        Company default ({fmtWorkHours(companyDefault)})
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <WorkHoursEditor value={hours} onChange={setHours} disabled={useDefault || pending} />
        {!useDefault && (
          <button className="pk-btn-accent" style={{ fontSize: 12.5 }} disabled={pending} onClick={() => save(false, hours)}>
            {pending ? "Saving…" : "Save"}
          </button>
        )}
        {msg && !pending && <span style={{ fontSize: 11, color: "#1f7a52" }}>{msg}</span>}
        {error && <span style={{ fontSize: 11, color: "#b42318" }}>{error}</span>}
      </div>
    </div>
  );
}
```

Thread the company card exactly the way `driveDefaults` is threaded:
- `src/app/(app)/settings/groups/types.ts`: in `SettingsData`, after the `driveDefaults` field add `/** Spec 2026-10-09 site-visit scheduling — Settings → Field. */ scheduling: SchedulingSettings;` (type-import `SchedulingSettings` from `@/lib/visit-plan/settings`).
- `src/app/(app)/settings/page.tsx`: import `getSchedulingSettings` from `@/lib/stores/schedule-prefs` and `DEFAULT_SCHEDULING` from `@/lib/visit-plan/settings`; after the `driveDefaults` line add `const scheduling = isAdmin ? await getSchedulingSettings() : DEFAULT_SCHEDULING;`; pass `scheduling={scheduling}` next to `driveDefaults={driveDefaults}`.
- `src/app/(app)/settings/settings-client.tsx`: pass `scheduling={data.scheduling}` to `<FieldGroup …>`.
- `src/app/(app)/settings/groups/field.tsx`: import `SchedulingDefaultsCard` from `../scheduling-defaults-card` and the type; add `scheduling` to the props (destructure + type `scheduling: SchedulingSettings;`); render `<SchedulingDefaultsCard initial={scheduling} />` directly after `<DriveDefaultsCard … />`.

Account page (`src/app/(app)/account/page.tsx`): import `WorkHoursCard from "./work-hours-card"` and `getSchedulingSettings, getUserWorkHours` from `@/lib/stores/schedule-prefs`; extend the `Promise.all` destructuring with `scheduling, myWorkHours` and the array with `getSchedulingSettings(), getUserWorkHours(user.id)`; render `<WorkHoursCard initial={myWorkHours} companyDefault={scheduling.workHours} />` directly after `<DriveBufferCard … />`.

- [ ] **Step 7: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures.
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/settings.ts src/lib/stores/schedule-prefs.ts src/components/visit-booking/work-hours-editor.tsx "src/app/(app)/settings/scheduling-defaults-card.tsx" "src/app/(app)/account/work-hours-card.tsx" "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" "src/app/(app)/settings/groups/field.tsx" "src/app/(app)/settings/groups/types.ts" "src/app/(app)/account/actions.ts" "src/app/(app)/account/page.tsx" scripts/test-site-visits.ts` → 0 problems.
Run: `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/visit-plan/settings.ts src/lib/stores/schedule-prefs.ts src/components/visit-booking/work-hours-editor.tsx "src/app/(app)/settings" "src/app/(app)/account" scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): work hours, same-area, drive-limit and look-ahead settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Conflict engine — Chicago work hours, busy blocks, `stopConflicts`, `checkVisit`

**Files:**
- Create: `src/lib/visit-plan/hours.ts`, `src/lib/visit-plan/busy.ts`, `src/lib/visit-plan/check.ts`
- Modify: `src/lib/google/calendar.ts` (`selfResponse`), `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `planDay`, `dayDriveTotal`, `fmtDur`, `pairKey`, `DriveLeg` (plan.ts); `DriveStop`, `isVisitIcsCopy`, `visitPeople` (stops.ts); `chicagoDayStart`, `addDays`, `DRIVE_TZ` (day.ts); `visitEventIds`, `InviteVisitShape` (Task 2); `WorkHours`, `fmtClock` (Task 3).
- Produces:
  - `hours.ts`: `chicagoMinuteOfDay(ms): number`; `chicagoWallMs(dayKey, minuteOfDay): number` (DST-safe; 1440 = next midnight); `weekdayOf(dayKey): number`; `WEEKDAY_NAMES`; `workWindow(dayKey, hours: WorkHours): { startMs: number; endMs: number } | null` (null = not a work day); `fmtDayLabel(dayKey): string` (`"Wed Oct 14"`); `fmtClockShort(min): string` (`540` → `"9"`, `690` → `"11:30"`).
  - `busy.ts`: `type BusyBlock = { key: string; kind: "visit" | "event"; label: string; startMs: number; endMs: number }`; `type BusyVisit = { id; label; startAt; endAt; stage; people: string[]; eventIds: string[] }`; `type BusyEvent = { id; iCalUID; title; startMs; endMs; allDay; selfDeclined; selfResponse?: string; peakDriveKey }`; `type VisitForBusy = InviteVisitShape & { venue: string; customer: string; stage: string }`; `toBusyVisit(v: VisitForBusy): BusyVisit`; `isBusyEvent(e: BusyEvent): boolean`; `busyBlocks({ person, visits, events, excludeVisitId? }): BusyBlock[]`; `busyInRange(blocks, minMs, maxMs): BusyBlock[]`; `fmtBusyRange(b): string` (`"9–10:30"`); `fmtBusy(blocks): string` (merged, `"9–11:30, 2–3"`).
  - `check.ts`: `type ConflictKind = "double_booked" | "tight_drive" | "outside_hours" | "too_much_driving"`; `type Conflict = { kind: ConflictKind; text: string }`; `CONFLICT_LABEL`; `CHECKED_WITHOUT_DRIVE = "Checked without drive time"`; `overlaps(a0, a1, b0, b1): boolean` (strict — back-to-back isn't an overlap); `fmtLimit(min): string` (`300` → `"5h"`); `type StopCheckInput = { stopKey; dayKey; stops: DriveStop[]; legs: DriveLeg[]; busy: BusyBlock[]; hours: WorkHours; dailyDriveLimitMin: number }`; `stopConflicts(i): { conflicts: Conflict[]; driveChecked: boolean }`; `type CalendarRead = "ok" | "no-calendar" | "failed"`; `calendarNote(person, calendar): string | null`; `type AttendeeDay = { person; dayKey; stops; legs; busy; hours; calendar: CalendarRead }`; `type PersonCheck = { person: string; conflicts: Conflict[]; notes: string[]; calendar: CalendarRead }`; `checkVisit(candidate: { key: string }, days: AttendeeDay[], opts: { dailyDriveLimitMin: number }): PersonCheck[]`.
  - `calendar.ts`: `CalendarEvent.selfResponse?: string` — the signed-in account's own `responseStatus` (`""` when it has no attendee row, i.e. its own event).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-site-visits.ts`:

```ts
import { addDays, chicagoDayStart } from "@/lib/drive-plan/day";
import { pairKey, planDay } from "@/lib/drive-plan/plan";
import type { DriveStop } from "@/lib/drive-plan/stops";
import { toCalendarEvents } from "@/lib/google/calendar";
import { busyBlocks, fmtBusy, type BusyBlock, type BusyEvent, type BusyVisit } from "@/lib/visit-plan/busy";
import { checkVisit, stopConflicts, type StopCheckInput } from "@/lib/visit-plan/check";
import { chicagoMinuteOfDay, chicagoWallMs, fmtDayLabel, weekdayOf, workWindow } from "@/lib/visit-plan/hours";
```

Append to the helpers block:

```ts
const BASE = { name: "Madison Office", lat: 43.0731, lng: -89.4012 };
const P2: LatLng = { lat: 44.1, lng: -88.1 };
const badAddr = (key: string): AddressState => ({ status: "needs_check", label: key, point: null, pointKey: "place:" + key, fix: { kind: "place", key, label: key } });
const vStop = (key: string, start: number, end: number, address: AddressState, label = key.slice(3)): DriveStop => ({ key, kind: "visit", label, startMs: start, endMs: end, address });
const busyEv = (label: string, s: number, e: number): BusyBlock => ({ key: "g:" + label, kind: "event", label, startMs: s, endMs: e });
function dayPlan(stops: DriveStop[], minutes: Array<[LatLng, LatLng, number]>, dayKey = DAY) {
  const routeMinutes = new Map(minutes.map(([a, b, m]) => [pairKey(a, b), m]));
  return { stops, legs: planDay({ userId: "u1", dayKey, stops, base: BASE, bufferMin: 15, routeMinutes, prevDay: { stayOver: false, lastStop: null }, stayOver: false }) };
}
function conflictsFor(stops: DriveStop[], minutes: Array<[LatLng, LatLng, number]>, busy: BusyBlock[], over: Partial<StopCheckInput> = {}) {
  const p = dayPlan(stops, minutes, over.dayKey ?? DAY);
  return stopConflicts({ stopKey: "sv:C", dayKey: DAY, stops: p.stops, legs: p.legs, busy, hours: DEFAULT_WORK_HOURS, dailyDriveLimitMin: 300, ...over });
}
```

Append the check:

```ts
export async function siteVisitsConflictChecks(ok: Ok): Promise<void> {
  // Chicago wall clock
  ok(chicagoWallMs("2026-03-08", 480) === Date.UTC(2026, 2, 8, 13) && chicagoWallMs("2026-11-01", 480) === Date.UTC(2026, 10, 1, 14),
    "site-visits hours: 8:00 is 8:00 Chicago on both DST-change days");
  ok(chicagoWallMs(DAY, 1440) === chicagoDayStart(addDays(DAY, 1)) && chicagoWallMs("2026-03-08", 1430) === Date.UTC(2026, 2, 9, 4, 50),
    "site-visits hours: end-of-day and late-evening wall times land on the right instant");
  ok(chicagoMinuteOfDay(at(13, 30)) === 810 && weekdayOf(DAY) === 3 && fmtDayLabel(DAY) === "Wed Oct 14", "site-visits hours: minute of day, weekday and day label");
  const win = workWindow(DAY, DEFAULT_WORK_HOURS);
  ok(win?.startMs === at(8) && win.endMs === at(17) && workWindow(addDays(DAY, 3), DEFAULT_WORK_HOURS) === null,
    "site-visits hours: a work day's window is 8:00–5:00 Chicago; Saturday has none");

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
  const mapped = toCalendarEvents([
    { id: "a", summary: "A", start: { dateTime: "2026-10-14T14:00:00Z" }, end: { dateTime: "2026-10-14T15:00:00Z" }, attendees: [{ email: "me@x.com", self: true, responseStatus: "tentative" }] },
    { id: "b", summary: "B", start: { dateTime: "2026-10-14T14:00:00Z" }, end: { dateTime: "2026-10-14T15:00:00Z" } },
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

  // Tight drive
  const A = vStop("sv:A", at(9), at(10, 30), okAddr(P2, "a"));
  const tight = conflictsFor([A, C11], [[BASE, P2, 30], [P2, P1, 40], [P1, BASE, 60]], []);
  ok(tight.conflicts.some((c) => c.kind === "tight_drive" && c.text === "Tight — needs 55m, has 30m"), "site-visits conflicts: spec 1's tight leg shows before booking");

  // Outside work hours
  const early = conflictsFor([vStop("sv:C", at(8), at(9), okAddr(P1, "c"))], r60, []);
  ok(early.conflicts.some((c) => c.kind === "outside_hours" && c.text === "Outside work hours (8:00–5:00)"), "site-visits conflicts: a drive starting before 8:00 is outside work hours");
  const sat = conflictsFor([vStop("sv:C", at(10, 0, 3), at(11, 0, 3), okAddr(P1, "c"))], r60, [], { dayKey: addDays(DAY, 3) });
  ok(sat.conflicts.some((c) => c.text === "Outside work hours — Saturday isn't a work day"), "site-visits conflicts: a visit on a non-work day is flagged");
  const late = conflictsFor([vStop("sv:C", at(15, 30), at(16, 45), okAddr(P1, "c"))], r60, []);
  ok(late.conflicts.some((c) => c.kind === "outside_hours"), "site-visits conflicts: the drive back counts toward work hours");
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
```

Wire it: add `siteVisitsConflictChecks` to the harness import and `.then(() => siteVisitsConflictChecks(ok))` after `.then(() => siteVisitsSettingsChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/busy'` (and `check`, `hours`), `selfResponse` not on `CalendarEvent`.

- [ ] **Step 3: `selfResponse` in `src/lib/google/calendar.ts`**

In `type CalendarEvent`, after `selfDeclined: boolean;` add:

```ts
  /** Spec 2026-10-09 site-visit scheduling — the signed-in account's own
   *  responseStatus ("accepted" | "tentative" | "needsAction" | "declined"),
   *  "" when it has no attendee row (its own event). Only accepted or own
   *  events count as busy. */
  selfResponse?: string;
```

In `toCalendarEvents`, inside the `.map((e) => { … })`, before `return {` add `const self = (e.attendees || []).find((a) => a.self);` and in the returned object, after the `selfDeclined:` line, add `selfResponse: self?.responseStatus || "",`.

- [ ] **Step 4: Implement `src/lib/visit-plan/hours.ts`**

```ts
/** Chicago wall-clock helpers for work hours (spec 2026-10-09 site-visit
 *  scheduling). Pure and client-safe; DST-safe. */
import { addDays, chicagoDayStart, DRIVE_TZ } from "@/lib/drive-plan/day";
import type { WorkHours } from "./settings";

const HM_FMT = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function chicagoMinuteOfDay(ms: number): number {
  const p = Object.fromEntries(HM_FMT.formatToParts(ms).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** Epoch-ms of `minuteOfDay` Chicago wall time on `dayKey`. */
export function chicagoWallMs(dayKey: string, minuteOfDay: number): number {
  if (minuteOfDay >= 1440) return chicagoDayStart(addDays(dayKey, 1));
  const guess = chicagoDayStart(dayKey) + minuteOfDay * 60_000;
  let diff = chicagoMinuteOfDay(guess) - minuteOfDay; // the DST shift since midnight, if any
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return guess - diff * 60_000;
}

export function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The day's work window, or null on a non-work day. */
export function workWindow(dayKey: string, hours: WorkHours): { startMs: number; endMs: number } | null {
  if (!hours.days.includes(weekdayOf(dayKey))) return null;
  return { startMs: chicagoWallMs(dayKey, hours.startMin), endMs: chicagoWallMs(dayKey, hours.endMin) };
}

/** "Wed Oct 14" */
export function fmtDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).replace(",", "");
}

/** 540 → "9", 690 → "11:30" (the spec's "busy 9–11:30"). */
export function fmtClockShort(min: number): string {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = Math.round(min) % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`;
}
```

- [ ] **Step 5: Implement `src/lib/visit-plan/busy.ts`**

```ts
/**
 * Busy blocks for one person (spec 2026-10-09 site-visit scheduling,
 * "Double-booked"). Pure and client-safe. Busy = their scheduled visits and
 * their accepted (or own) timed Google events. Never busy: all-day,
 * declined, unanswered or tentative events, the app's drive events, and any
 * calendar copy of a visit (the visit itself is counted once, from its record).
 */
import { isVisitIcsCopy, visitPeople } from "@/lib/drive-plan/stops";
import { visitEventIds, type InviteVisitShape } from "@/lib/visit-invite-plan";
import { chicagoMinuteOfDay, fmtClockShort } from "./hours";

export type BusyBlock = { key: string; kind: "visit" | "event"; label: string; startMs: number; endMs: number };
export type BusyVisit = { id: string; label: string; startAt: number | null; endAt: number | null; stage: string; people: string[]; eventIds: string[] };
export type BusyEvent = {
  id: string;
  iCalUID: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  selfDeclined: boolean;
  selfResponse?: string;
  peakDriveKey: string;
};
export type VisitForBusy = InviteVisitShape & { venue: string; customer: string; stage: string };

export function toBusyVisit(v: VisitForBusy): BusyVisit {
  return { id: v.id, label: v.venue || v.customer || v.id, startAt: v.startAt, endAt: v.endAt, stage: v.stage, people: visitPeople(v), eventIds: visitEventIds(v) };
}

export function isBusyEvent(e: BusyEvent): boolean {
  if (e.allDay || e.selfDeclined || e.peakDriveKey || !(e.endMs > e.startMs)) return false;
  return !e.selfResponse || e.selfResponse === "accepted";
}

/** `visits` must include the visit being edited (its calendar copies are
 *  recognised); `excludeVisitId` keeps it from being its own conflict. */
export function busyBlocks(args: {
  person: string;
  visits: readonly BusyVisit[];
  events: readonly BusyEvent[] | null;
  excludeVisitId?: string | null;
}): BusyBlock[] {
  const out: BusyBlock[] = [];
  for (const v of args.visits) {
    if (v.id === args.excludeVisitId || v.startAt == null || !v.people.includes(args.person)) continue;
    if (v.stage !== "scheduled" && v.stage !== "done") continue;
    out.push({ key: "sv:" + v.id, kind: "visit", label: v.label, startMs: v.startAt, endMs: Math.max(v.endAt ?? v.startAt, v.startAt) });
  }
  const copies = args.visits.map((v) => ({ id: v.id, eventIds: v.eventIds }));
  for (const e of args.events ?? []) {
    if (!isBusyEvent(e) || isVisitIcsCopy(e, copies)) continue;
    out.push({ key: "g:" + e.id, kind: "event", label: e.title, startMs: e.startMs, endMs: e.endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function busyInRange(blocks: readonly BusyBlock[], minMs: number, maxMs: number): BusyBlock[] {
  return blocks.filter((b) => b.endMs > minMs && b.startMs < maxMs);
}

export function fmtBusyRange(b: { startMs: number; endMs: number }): string {
  return `${fmtClockShort(chicagoMinuteOfDay(b.startMs))}–${fmtClockShort(chicagoMinuteOfDay(b.endMs))}`;
}

/** Overlapping blocks merged: "9–11:30, 2–3" ("" when free). */
export function fmtBusy(blocks: readonly BusyBlock[]): string {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && b.startMs <= last.endMs) last.endMs = Math.max(last.endMs, b.endMs);
    else merged.push({ startMs: b.startMs, endMs: b.endMs });
  }
  return merged.map(fmtBusyRange).join(", ");
}
```

- [ ] **Step 6: Implement `src/lib/visit-plan/check.ts`**

```ts
/**
 * Conflict checks for a visit on one person's day (spec 2026-10-09 site-visit
 * scheduling, Part 2 "checkVisit"). Pure and client-safe. Conflicts are
 * flagged, never resolved, and never block booking.
 */
import { dayDriveTotal, fmtDur, type DriveLeg } from "@/lib/drive-plan/plan";
import type { DriveStop } from "@/lib/drive-plan/stops";
import { fmtBusyRange, type BusyBlock } from "./busy";
import { WEEKDAY_NAMES, weekdayOf, workWindow } from "./hours";
import { fmtClock, type WorkHours } from "./settings";

export type ConflictKind = "double_booked" | "tight_drive" | "outside_hours" | "too_much_driving";
export type Conflict = { kind: ConflictKind; text: string };

export const CONFLICT_LABEL: Record<ConflictKind, string> = {
  double_booked: "Double-booked",
  tight_drive: "Tight drive",
  outside_hours: "Outside work hours",
  too_much_driving: "Too much driving",
};
export const CHECKED_WITHOUT_DRIVE = "Checked without drive time";

/** Strict: a block ending exactly when the next starts is not an overlap. */
export function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** 300 → "5h", 330 → "5h 30m". */
export function fmtLimit(min: number): string {
  return min % 60 === 0 ? `${min / 60}h` : fmtDur(min);
}

export type StopCheckInput = {
  /** the visit's stop key on this day, "sv:<id>" */
  stopKey: string;
  dayKey: string;
  /** planDay's stops + legs for this person's day, the visit included */
  stops: DriveStop[];
  legs: DriveLeg[];
  /** everything else this person is busy with (the visit itself excluded) */
  busy: BusyBlock[];
  hours: WorkHours;
  dailyDriveLimitMin: number;
};

export function stopConflicts(i: StopCheckInput): { conflicts: Conflict[]; driveChecked: boolean } {
  const stop = i.stops.find((s) => s.key === i.stopKey);
  if (!stop) return { conflicts: [], driveChecked: false };
  const driveTo = i.legs.find((l) => l.to.key === i.stopKey && l.direction === "to_stop") ?? null;
  const driveFrom = i.legs.find((l) => l.from.key === i.stopKey) ?? null;
  const driveChecked = stop.address.status === "verified" && !driveTo?.flag && !driveFrom?.flag;
  const conflicts: Conflict[] = [];

  // Double-booked: the visit, or its drive-to block, overlaps something.
  const toBlock = driveChecked && driveTo && driveTo.startMs != null && driveTo.endMs != null ? { s: driveTo.startMs, e: driveTo.endMs } : null;
  for (const b of i.busy) {
    if (overlaps(stop.startMs, stop.endMs, b.startMs, b.endMs))
      conflicts.push({ kind: "double_booked", text: `Double-booked — overlaps ${b.label} (${fmtBusyRange(b)})` });
    else if (toBlock && overlaps(toBlock.s, toBlock.e, b.startMs, b.endMs))
      conflicts.push({ kind: "double_booked", text: `Double-booked — the drive there overlaps ${b.label} (${fmtBusyRange(b)})` });
  }

  // Tight drive (spec 1's leg flag), into or out of this visit.
  if (driveChecked) for (const l of [driveTo, driveFrom]) if (l?.tight) conflicts.push({ kind: "tight_drive", text: l.tight.text });

  // Outside work hours: the visit plus its drive there, plus the drive home
  // when this visit is the day's last stop.
  const win = workWindow(i.dayKey, i.hours);
  if (!win) {
    conflicts.push({ kind: "outside_hours", text: `Outside work hours — ${WEEKDAY_NAMES[weekdayOf(i.dayKey)]} isn't a work day` });
  } else {
    const spanStart = toBlock ? Math.min(toBlock.s, stop.startMs) : stop.startMs;
    const back = driveChecked && driveFrom?.direction === "back" && driveFrom.endMs != null ? driveFrom.endMs : null;
    const spanEnd = Math.max(stop.endMs, back ?? stop.endMs);
    if (spanStart < win.startMs || spanEnd > win.endMs)
      conflicts.push({ kind: "outside_hours", text: `Outside work hours (${fmtClock(i.hours.startMin)}–${fmtClock(i.hours.endMin)})` });
  }

  // Too much driving: the day's total with this visit, buffer included.
  if (driveChecked) {
    const total = dayDriveTotal(i.legs);
    if (total > i.dailyDriveLimitMin) conflicts.push({ kind: "too_much_driving", text: `Too much driving — ${fmtDur(total)} of ${fmtLimit(i.dailyDriveLimitMin)}` });
  }
  return { conflicts, driveChecked };
}

export type CalendarRead = "ok" | "no-calendar" | "failed";

export function calendarNote(person: string, calendar: CalendarRead): string | null {
  if (calendar === "failed") return `Couldn't check ${person}'s calendar`;
  if (calendar === "no-calendar") return `${person} has no connected calendar — checked visits only`;
  return null;
}

export type AttendeeDay = {
  person: string;
  dayKey: string;
  stops: DriveStop[];
  legs: DriveLeg[];
  busy: BusyBlock[];
  hours: WorkHours;
  calendar: CalendarRead;
};
export type PersonCheck = { person: string; conflicts: Conflict[]; notes: string[]; calendar: CalendarRead };

export function checkVisit(candidate: { key: string }, days: AttendeeDay[], opts: { dailyDriveLimitMin: number }): PersonCheck[] {
  return days.map((d) => {
    const r = stopConflicts({ stopKey: candidate.key, dayKey: d.dayKey, stops: d.stops, legs: d.legs, busy: d.busy, hours: d.hours, dailyDriveLimitMin: opts.dailyDriveLimitMin });
    const notes: string[] = [];
    if (!r.driveChecked) notes.push(CHECKED_WITHOUT_DRIVE);
    const cal = calendarNote(d.person, d.calendar);
    if (cal) notes.push(cal);
    return { person: d.person, conflicts: r.conflicts, notes, calendar: d.calendar };
  });
}
```

- [ ] **Step 7: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures (the drive-time calendar mapping check still passes — `selfResponse` is additive).
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/hours.ts src/lib/visit-plan/busy.ts src/lib/visit-plan/check.ts src/lib/google/calendar.ts scripts/test-site-visits.ts` → 0 problems.

- [ ] **Step 8: Commit**

```bash
git add src/lib/visit-plan/hours.ts src/lib/visit-plan/busy.ts src/lib/visit-plan/check.ts src/lib/google/calendar.ts scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): conflict engine — double-booked, tight, work hours, drive limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Nearby days — `suggestDays`

**Files:**
- Create: `src/lib/visit-plan/nearby.ts`, `src/lib/visit-plan/index.ts`
- Modify: `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `pairKey` (plan.ts); `DriveStop` (stops.ts); `chicagoDayStart`, `addDays` (day.ts); `BusyBlock`, `busyInRange`, `fmtBusy` (Task 4); `overlaps`, `CalendarRead` (Task 4); `chicagoMinuteOfDay`, `chicagoWallMs`, `fmtDayLabel`, `workWindow` (Task 4); `WorkHours` (Task 3).
- Produces:
  - `MAX_NEARBY_DAYS = 5`; `PREFILTER_MPH = 80`; `straightLineMiles(a: LatLng, b: LatLng): number`; `couldBeSameArea(a, b, sameAreaMin): boolean` (pre-filter only — miles ≤ sameAreaMin × 80 / 60).
  - `type LeadDay = { dayKey: string; stops: DriveStop[]; busy: BusyBlock[] }`; `type OtherAttendee = { person: string; calendar: CalendarRead; hours: WorkHours; busy: BusyBlock[] }`; `type AttendeeDayStatus = { person: string; status: "free" | "conflict" | "unknown" }`; `type NearbyDay = { dayKey: string; label: string; nearest: { label: string; minutes: number }; busyText: string; others: AttendeeDayStatus[] }`; `type NearbyResult = { status: "ok"; days: NearbyDay[]; lookaheadDays: number } | { status: "unverified" } | { status: "unavailable" }`; `NEARBY_TEXT`.
  - `nearbyPairs(point: LatLng, leadDays: LeadDay[], sameAreaMin: number, excludeKey: string): Array<{ from: LatLng; to: LatLng }>` (stop → candidate; deduped by `pairKey`).
  - `projectTime(startMs, endMs, dayKey): { startMs: number; endMs: number }` (same Chicago time of day on another day).
  - `attendeeStatusOn(o: OtherAttendee, dayKey, slot: { startMs: number; endMs: number } | null)`.
  - `suggestDays({ candidate: { key; point: LatLng | null; startMs: number | null; endMs: number | null }, leadDays, routeMinutes: ReadonlyMap<string, number>, sameAreaMin, lookaheadDays, others }): NearbyResult`.
  - `nearbyLine(d: NearbyDay): string` → `"Thu Oct 15 · 18 min from Lone Pine Elementary · busy 9–11:30"`.
  - `index.ts` re-exports `people`, `settings`, `hours`, `busy`, `check`, `nearby` (never `load`).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-site-visits.ts`:

```ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { couldBeSameArea, MAX_NEARBY_DAYS, nearbyLine, nearbyPairs, straightLineMiles, suggestDays, type LeadDay } from "@/lib/visit-plan/nearby";
```

(merge `readdirSync` into the existing `node:fs` import.)

Append the check:

```ts
export async function siteVisitsNearbyChecks(ok: Ok): Promise<void> {
  const CAND: LatLng = { lat: 44.05, lng: -88.05 };
  const FAR: LatLng = { lat: 46.0, lng: -88.0 };
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
  const oct15 = res.status === "ok" ? res.days[2] : null;
  ok(!!oct15 && nearbyLine(oct15) === "Thu Oct 15 · 18 min from Lone Pine Elementary · busy 9–11:30",
    "site-visits nearby: a row reads date · minutes from the nearest stop · the lead's busy times");
  ok(!!oct15 && oct15.others.map((o) => `${o.person}:${o.status}`).join() === "Jeff:conflict,Sam:unknown" &&
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

  // The straight-line distance is only a pre-filter: one definition, one use.
  const dir = "src/lib/visit-plan";
  const uses = readdirSync(dir).reduce((n, f) => n + (readFileSync(join(dir, f), "utf8").match(/straightLineMiles\(/g) ?? []).length, 0);
  const banned = /\b(estimate|estimateFromParts|driveMinutes|driveMiles|haversineMiles|minutesFromMiles)\b\s*\(/;
  ok(uses === 2 && !readdirSync(dir).some((f) => banned.test(readFileSync(join(dir, f), "utf8"))),
    "site-visits pin: the straight-line distance feeds only the pre-filter, and nothing in visit-plan calls a straight-line drive estimate");
}
```

Wire it: add `siteVisitsNearbyChecks` to the harness import and `.then(() => siteVisitsNearbyChecks(ok))` after `.then(() => siteVisitsConflictChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/nearby'`.

- [ ] **Step 3: Implement `src/lib/visit-plan/nearby.ts`**

```ts
/**
 * Nearby days (spec 2026-10-09 site-visit scheduling, Part 2 "suggestDays").
 * Pure and client-safe. Days in the look-ahead when the LEAD already has a
 * verified stop within the same-area drive time of the candidate. Minutes
 * come only from routed drive times (geo_cache / OSRM); the straight-line
 * distance below only skips stops too far to bother routing.
 */
import type { LatLng } from "@/lib/address-verify/types";
import { addDays, chicagoDayStart } from "@/lib/drive-plan/day";
import { pairKey } from "@/lib/drive-plan/plan";
import type { DriveStop } from "@/lib/drive-plan/stops";
import { busyInRange, fmtBusy, type BusyBlock } from "./busy";
import { overlaps, type CalendarRead } from "./check";
import { chicagoMinuteOfDay, chicagoWallMs, fmtDayLabel, workWindow } from "./hours";
import type { WorkHours } from "./settings";

export const MAX_NEARBY_DAYS = 5;
/** Faster than any real drive, so the pre-filter never drops a reachable stop. */
export const PREFILTER_MPH = 80;

export const NEARBY_TEXT = {
  unverified: "Verify the address to see nearby days",
  unavailable: "Nearby days unavailable",
} as const;

export function straightLineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pre-filter only — never shown, never turned into minutes. */
export function couldBeSameArea(a: LatLng, b: LatLng, sameAreaMin: number): boolean {
  return straightLineMiles(a, b) <= (sameAreaMin * PREFILTER_MPH) / 60;
}

export type LeadDay = { dayKey: string; stops: DriveStop[]; busy: BusyBlock[] };
export type OtherAttendee = { person: string; calendar: CalendarRead; hours: WorkHours; busy: BusyBlock[] };
export type AttendeeDayStatus = { person: string; status: "free" | "conflict" | "unknown" };
export type NearbyDay = {
  dayKey: string;
  label: string;
  nearest: { label: string; minutes: number };
  /** the lead's busy times that day, "9–11:30, 2–3" ("" when free) */
  busyText: string;
  others: AttendeeDayStatus[];
};
export type NearbyResult = { status: "ok"; days: NearbyDay[]; lookaheadDays: number } | { status: "unverified" } | { status: "unavailable" };

const pointOf = (s: DriveStop): LatLng | null => (s.address.status === "verified" ? s.address.point : null);

/** The stop → candidate pairs worth routing. */
export function nearbyPairs(point: LatLng, leadDays: LeadDay[], sameAreaMin: number, excludeKey: string): Array<{ from: LatLng; to: LatLng }> {
  const out = new Map<string, { from: LatLng; to: LatLng }>();
  for (const d of leadDays)
    for (const s of d.stops) {
      if (s.key === excludeKey) continue;
      const p = pointOf(s);
      if (!p || !couldBeSameArea(p, point, sameAreaMin)) continue;
      out.set(pairKey(p, point), { from: p, to: point });
    }
  return [...out.values()];
}

/** The same Chicago time of day, moved to `dayKey`. */
export function projectTime(startMs: number, endMs: number, dayKey: string): { startMs: number; endMs: number } {
  const s = chicagoWallMs(dayKey, chicagoMinuteOfDay(startMs));
  return { startMs: s, endMs: s + Math.max(0, endMs - startMs) };
}

/** With a slot: free unless it's outside their hours or overlaps something.
 *  Without one: free when it's a work day with nothing booked in work hours. */
export function attendeeStatusOn(o: OtherAttendee, dayKey: string, slot: { startMs: number; endMs: number } | null): AttendeeDayStatus["status"] {
  if (o.calendar === "failed") return "unknown";
  const win = workWindow(dayKey, o.hours);
  if (!win) return "conflict";
  const span = slot ?? win;
  if (span.startMs < win.startMs || span.endMs > win.endMs) return "conflict";
  return o.busy.some((b) => overlaps(span.startMs, span.endMs, b.startMs, b.endMs)) ? "conflict" : "free";
}

export function suggestDays(args: {
  candidate: { key: string; point: LatLng | null; startMs: number | null; endMs: number | null };
  leadDays: LeadDay[];
  routeMinutes: ReadonlyMap<string, number>;
  sameAreaMin: number;
  lookaheadDays: number;
  others: OtherAttendee[];
}): NearbyResult {
  const { candidate } = args;
  if (!candidate.point) return { status: "unverified" };
  const point = candidate.point;
  const timed = candidate.startMs != null && candidate.endMs != null && candidate.endMs > candidate.startMs;
  const found: NearbyDay[] = [];
  let missing = 0;
  for (const d of args.leadDays) {
    let best: { label: string; minutes: number } | null = null;
    for (const s of d.stops) {
      if (s.key === candidate.key) continue;
      const p = pointOf(s);
      if (!p || !couldBeSameArea(p, point, args.sameAreaMin)) continue;
      const m = args.routeMinutes.get(pairKey(p, point));
      if (m == null || !Number.isFinite(m)) {
        missing++;
        continue;
      }
      const minutes = Math.max(0, Math.round(m));
      if (minutes > args.sameAreaMin) continue;
      if (!best || minutes < best.minutes) best = { label: s.label, minutes };
    }
    if (!best) continue;
    const slot = timed ? projectTime(candidate.startMs!, candidate.endMs!, d.dayKey) : null;
    const dayStart = chicagoDayStart(d.dayKey);
    const dayEnd = chicagoDayStart(addDays(d.dayKey, 1));
    found.push({
      dayKey: d.dayKey,
      label: fmtDayLabel(d.dayKey),
      nearest: best,
      busyText: fmtBusy(busyInRange(d.busy, dayStart, dayEnd)),
      others: args.others.map((o) => ({ person: o.person, status: attendeeStatusOn({ ...o, busy: busyInRange(o.busy, dayStart, dayEnd) }, d.dayKey, slot) })),
    });
  }
  if (!found.length && missing > 0) return { status: "unavailable" };
  found.sort((a, b) => a.nearest.minutes - b.nearest.minutes || (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  return { status: "ok", days: found.slice(0, MAX_NEARBY_DAYS), lookaheadDays: args.lookaheadDays };
}

/** "Tue Oct 14 · 18 min from Lone Pine Elementary · busy 9–11:30" */
export function nearbyLine(d: NearbyDay): string {
  return `${d.label} · ${d.nearest.minutes} min from ${d.nearest.label}${d.busyText ? " · busy " + d.busyText : ""}`;
}
```

Create `src/lib/visit-plan/index.ts`:

```ts
/** The pure site-visit scheduling engine (spec 2026-10-09). Client-safe.
 *  The server loader is ./load — import it directly, never through here. */
export * from "./people";
export * from "./settings";
export * from "./hours";
export * from "./busy";
export * from "./check";
export * from "./nearby";
```

- [ ] **Step 4: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures.
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/nearby.ts src/lib/visit-plan/index.ts scripts/test-site-visits.ts` → 0 problems.

- [ ] **Step 5: Commit**

```bash
git add src/lib/visit-plan/nearby.ts src/lib/visit-plan/index.ts scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): nearby-day suggestions from the lead's next 21 days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Booking-check loader — `loadBookingCheck`

**Files:**
- Create: `src/lib/visit-plan/types.ts`, `src/lib/visit-plan/load.ts`
- Modify: `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `planDriveDays`, `routeMinutesFor`, `visitAddressInput`, `DriveDayPlan`, `DriveLoadDeps` (spec 1 `drive-plan/load.ts`); `addressStatesForVisits`, `VisitAddressInput` (`address-verify/targets.ts`); `listEventsForSync`, `CalendarEvent`; `gmailEnabled`, `hasCalendarScope`, `personalKey`, `getConnectionInfo`; `getSchedulingSettings`, `workHoursFor` (Task 3); `busyBlocks`, `busyInRange`, `toBusyVisit` (Task 4); `checkVisit`, `CalendarRead`, `PersonCheck` (Task 4); `nearbyPairs`, `suggestDays`, `NearbyResult` (Task 5).
- Produces:
  - `types.ts`: `type BookingCheckInput = { visitId: string | null; customerId: string | null; locationId: string | null; address: string; startAt: number | null; endAt: number | null; lead: string; attendees: string[] }`; `type BookingCheckResult = { address: { status: GeoStatus; fix: FixTarget | null }; people: PersonCheck[]; nearby: NearbyResult | null; checkedAt: number }`.
  - `load.ts`: `BOOKING_ROUTE_BUDGET_MS = 10_000`; `NEW_VISIT_ID = "NEW"`; `type BookingDeps = { now; users; settings; workHours; visits; visitStates(visits: VisitAddressInput[]); readEvents(userId, range); plan; routes(pairs, budgetMs) }`; `readCalendarForBooking(userId, range): Promise<{ status: CalendarRead; events: CalendarEvent[] }>`; `virtualVisit(input, stored: SiteVisit | null): SiteVisit`; `loadBookingCheck(input: BookingCheckInput, opts?: { nearby?: boolean }, deps?: Partial<BookingDeps>): Promise<BookingCheckResult>`.

Behaviour (what the tests pin):
- The candidate is a virtual visit (`stage: "scheduled"`, key `sv:<visitId|NEW>`); when editing, the stored copy is left out of everyone's day but its calendar copies are still recognised.
- Each person (lead first, then attendees; only active roster names) gets their Google Calendar read **once** over the whole window. A read failure → `"failed"` (note `Couldn't check Dana's calendar`), no grant → `"no-calendar"`.
- People checks plan only the candidate's day per person, in `cache` mode for addresses, with live OSRM for missing pairs under **one 10 s budget for the whole check**.
- Nearby days: the lead's stops over the look-ahead (no routing for the plan itself), then only `nearbyPairs` are routed. Candidate unverified → `unverified`.
- `opts.nearby === false` (badges) reads and plans only the candidate's day.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-site-visits.ts`:

```ts
import { addressKey } from "@/lib/address-verify/keys";
import { planDriveDays, type DriveLoadDeps } from "@/lib/drive-plan/load";
import { gmailEnabled } from "@/lib/gmail/config";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { Office } from "@/lib/settings";
import { BOOKING_ROUTE_BUDGET_MS, loadBookingCheck, readCalendarForBooking, type BookingDeps } from "@/lib/visit-plan/load";
import type { BookingCheckInput } from "@/lib/visit-plan/types";
```

Append to the helpers block:

```ts
const FAR: LatLng = { lat: 46.0, lng: -88.0 };
const office: Office = { id: "o1", name: "Madison Office", street: "", city: "Madison", state: "WI", zip: "", lat: BASE.lat, lng: BASE.lng, quoteDefault: true };
const gEvent = (id: string, s: number, e: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, iCalUID: id + "@google.com", title: id, startMs: s, endMs: e, allDay: false, location: "", htmlLink: "", meetingUrl: "",
  selfDeclined: false, selfResponse: "", peakDriveKey: "", peakDriveDay: "", ...over,
});
```

Append the check:

```ts
function bookingHarness(over: Partial<BookingDeps> = {}) {
  const reads: Array<{ userId: string; timeMaxMs: number }> = [];
  const budgets: number[] = [];
  const asked: Array<{ from: LatLng; to: LatLng }> = [];
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
    visitStates: async (vs) =>
      new Map(vs.map((v) => [v.id, v.address === "bad" ? badAddr("bad") : v.address === "far" ? okAddr(FAR, "far") : v.address === "p2" ? okAddr(P2, "p2") : okAddr(P1, v.address)])),
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
      return new Map(pairs.map((p) => [pairKey(p.from, p.to), 20]));
    },
    ...over,
  };
  return { deps, reads, budgets, asked };
}

export async function siteVisitsLoaderChecks(ok: Ok): Promise<void> {
  const d = (n: number) => addDays(DAY, n);
  const NEW: BookingCheckInput = { visitId: null, customerId: null, locationId: null, address: "p2", startAt: at(13, 0, 1), endAt: at(14, 0, 1), lead: "Dana", attendees: ["Jeff", "Sam"] };

  const h = bookingHarness();
  const r = await loadBookingCheck(NEW, {}, h.deps);
  const [dana, jeff, sam] = r.people;
  ok(r.people.map((p) => p.person).join() === "Dana,Jeff,Sam" && r.address.status === "verified", "site-visits loader: one row per person, lead first");
  ok(dana.conflicts.length === 1 && dana.conflicts[0].text === "Double-booked — overlaps Zoom call (1:30–2)" && dana.notes.length === 0,
    "site-visits loader: the lead's accepted Google event (a video call, not a stop) double-books the visit");
  ok(jeff.conflicts.some((c) => c.kind === "double_booked" && c.text.includes("Venue SV-V3")) && jeff.notes.includes("Couldn't check Jeff's calendar"),
    "site-visits loader: an unreadable calendar still checks the person's visits and says the calendar wasn't checked");
  ok(sam.conflicts.length === 0 && sam.notes.includes("Sam has no connected calendar — checked visits only"), "site-visits loader: no calendar → visits only, with a note");
  ok(h.reads.filter((x) => x.userId === "u1").length === 1 && h.reads.length === 3, "site-visits loader: each person's calendar is read once");
  ok(r.nearby?.status === "ok" && r.nearby.days.map((x) => x.dayKey).join() === [d(1), d(2)].join() && r.nearby.days[0].nearest.label === "Venue SV-V1" &&
     r.nearby.days[0].others.map((o) => `${o.person}:${o.status}`).join() === "Jeff:unknown,Sam:free",
    "site-visits loader: nearby days come from the lead's own stops, with each attendee's status");
  ok(!h.asked.some((p) => p.from.lat === FAR.lat || p.to.lat === FAR.lat), "site-visits loader: a stop 100+ miles away is never routed");
  ok(h.budgets.length > 0 && h.budgets.every((b) => b >= 0 && b <= BOOKING_ROUTE_BUDGET_MS) && BOOKING_ROUTE_BUDGET_MS === 10_000,
    "site-visits loader: live routing shares one 10 s budget");

  // Editing a visit: it isn't its own conflict, its calendar copy isn't busy, and it isn't its own nearby day
  const edit = await loadBookingCheck({ ...NEW, visitId: "SV-E", address: "p1", startAt: at(9, 0, 2), endAt: at(10, 0, 2), attendees: [] }, {}, bookingHarness().deps);
  ok(edit.people.length === 1 && edit.people[0].conflicts.length === 0, "site-visits loader: an edited visit never conflicts with itself or its own calendar copy");
  ok(edit.nearby?.status === "ok" && edit.nearby.days.map((x) => x.dayKey).join() === d(1), "site-visits loader: …and isn't suggested as its own nearby day");

  const unv = await loadBookingCheck({ ...NEW, address: "bad" }, {}, bookingHarness().deps);
  ok(unv.nearby?.status === "unverified" && unv.people[0].notes.includes("Checked without drive time") && unv.address.status === "needs_check",
    "site-visits loader: an unverified address → no nearby days, checked without drive time");
  const down = await loadBookingCheck(NEW, {}, bookingHarness({ routes: async () => new Map() }).deps);
  ok(down.nearby?.status === "unavailable" && down.people[0].notes.includes("Checked without drive time"), "site-visits loader: OSRM down → Nearby days unavailable");
  const untimed = await loadBookingCheck({ ...NEW, startAt: null, endAt: null }, {}, bookingHarness().deps);
  ok(untimed.people.length === 0 && untimed.nearby?.status === "ok", "site-visits loader: no time yet → no conflict rows, nearby days still shown");
  const hb = bookingHarness();
  const badgeOnly = await loadBookingCheck(NEW, { nearby: false }, hb.deps);
  ok(badgeOnly.nearby === null && hb.reads.every((x) => x.timeMaxMs === chicagoDayStart(d(2))) && badgeOnly.people.length === 3,
    "site-visits loader: badge checks read and plan only the visit's own day");

  const range = { timeMinMs: at(0), timeMaxMs: at(0, 0, 1) };
  ok(gmailEnabled() || (await readCalendarForBooking("TESTvisits:nobody", range)).status === "no-calendar", "site-visits loader: Gmail off → no calendar, never an error");

  // Client-safety: only load.ts reaches the server.
  const dir = "src/lib/visit-plan";
  const serverOnly = /from "@\/(db|lib\/stores|lib\/google|lib\/gmail|lib\/users|lib\/address-verify\/targets|lib\/drive-plan\/load)/;
  const leaky = readdirSync(dir).filter((f) => f !== "load.ts" && serverOnly.test(readFileSync(join(dir, f), "utf8")));
  ok(leaky.length === 0 && serverOnly.test(readFileSync(join(dir, "load.ts"), "utf8")) && !/from "\.\/load"/.test(readFileSync(join(dir, "index.ts"), "utf8")),
    "site-visits pin: every visit-plan module but load.ts is client-safe, and the index never re-exports load" + (leaky.length ? " — " + leaky.join(", ") : ""));
  ok(!/^import (?!type)/m.test(readFileSync("src/lib/visit-invite-plan.ts", "utf8")), "site-visits pin: visit-invite-plan.ts has no runtime imports (client-safe)");
}
```

Wire it: add `siteVisitsLoaderChecks` to the harness import and `.then(() => siteVisitsLoaderChecks(ok))` after `.then(() => siteVisitsNearbyChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/load'` / `'@/lib/visit-plan/types'`.

- [ ] **Step 3: Implement `src/lib/visit-plan/types.ts`**

```ts
/** Booking-check shapes shared by the server loader, the action and the
 *  booking UI (spec 2026-10-09 site-visit scheduling). Types only. */
import type { FixTarget, GeoStatus } from "@/lib/address-verify/types";
import type { PersonCheck } from "./check";
import type { NearbyResult } from "./nearby";

export type BookingCheckInput = {
  /** set when editing an existing visit — it's left out of everyone's day */
  visitId: string | null;
  customerId: string | null;
  locationId: string | null;
  address: string;
  startAt: number | null;
  endAt: number | null;
  /** the lead's name ("" when none picked) */
  lead: string;
  attendees: string[];
};

export type BookingCheckResult = {
  address: { status: GeoStatus; fix: FixTarget | null };
  /** one row per person, lead first; [] until a time is picked */
  people: PersonCheck[];
  /** null when not asked for (conflict badges) */
  nearby: NearbyResult | null;
  checkedAt: number;
};
```

- [ ] **Step 4: Implement `src/lib/visit-plan/load.ts`**

```ts
/**
 * Booking-check loader (spec 2026-10-09 site-visit scheduling, Part 2) — the
 * server half of the booking screen and the visit conflict badges. Reads each
 * person's Google Calendar once, plans the candidate's day per person through
 * spec 1's planDriveDays (the candidate injected as a virtual visit), and
 * hands the pure engine everything it needs. Computed live; nothing stored.
 * Addresses are read in cache mode (the booking UI's own address check
 * geocodes); missing routes go to OSRM under one shared budget.
 */
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { addressStatesForVisits, type VisitAddressInput } from "@/lib/address-verify/targets";
import { addDays, chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { planDriveDays, routeMinutesFor, visitAddressInput, type DriveDayPlan, type DriveLoadDeps } from "@/lib/drive-plan/load";
import { visitPeople } from "@/lib/drive-plan/stops";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { listEventsForSync, type CalendarEvent } from "@/lib/google/calendar";
import { getSchedulingSettings, workHoursFor } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";
import { busyBlocks, busyInRange, toBusyVisit } from "./busy";
import { checkVisit, type CalendarRead, type PersonCheck } from "./check";
import { nearbyPairs, suggestDays, type NearbyResult } from "./nearby";
import type { SchedulingSettings, WorkHours } from "./settings";
import type { BookingCheckInput, BookingCheckResult } from "./types";

export const BOOKING_ROUTE_BUDGET_MS = 10_000;
export const NEW_VISIT_ID = "NEW";

type Range = { timeMinMs: number; timeMaxMs: number };

export type BookingDeps = {
  now(): number;
  users(): Promise<Array<{ id: string; name: string; status: string }>>;
  settings(): Promise<SchedulingSettings>;
  workHours(userId: string): Promise<WorkHours>;
  visits(): Promise<SiteVisit[]>;
  visitStates(visits: VisitAddressInput[]): Promise<Map<string, AddressState>>;
  readEvents(userId: string, range: Range): Promise<{ status: CalendarRead; events: CalendarEvent[] }>;
  plan(args: Parameters<typeof planDriveDays>[0]): Promise<DriveDayPlan[]>;
  routes(pairs: Array<{ from: LatLng; to: LatLng }>, budgetMs: number): Promise<Map<string, number>>;
};

/** One person's calendar for the booking check. Never throws. */
export async function readCalendarForBooking(userId: string, range: Range): Promise<{ status: CalendarRead; events: CalendarEvent[] }> {
  if (!gmailEnabled()) return { status: "no-calendar", events: [] };
  try {
    const key = personalKey(userId);
    const info = await getConnectionInfo(key);
    if (!info || !hasCalendarScope(info.scope)) return { status: "no-calendar", events: [] };
    const r = await listEventsForSync(key, range);
    return { status: "ok", events: r.events };
  } catch (err) {
    console.error("[visit-booking] calendar read failed:", userId, err);
    return { status: "failed", events: [] };
  }
}

function defaultDeps(): BookingDeps {
  return {
    now: Date.now,
    users: async () => (await allUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
    settings: getSchedulingSettings,
    workHours: workHoursFor,
    visits: allVisits,
    visitStates: (vs) => addressStatesForVisits(vs, "cache"),
    readEvents: readCalendarForBooking,
    plan: planDriveDays,
    routes: (pairs, budgetMs) => routeMinutesFor(pairs, "live", { budgetMs }),
  };
}

/** The visit being booked, as a scheduled SiteVisit the planner can use. */
export function virtualVisit(input: BookingCheckInput, stored: SiteVisit | null): SiteVisit {
  const id = input.visitId ?? NEW_VISIT_ID;
  const base: SiteVisit = stored ?? {
    id, customerId: null, customer: "", locationId: null, venue: "", address: "", contactName: "", contactEmail: "", contactPhone: "",
    reason: "", startAt: null, endAt: null, notes: "", assignedTo: "", attendees: [], invites: [], createdBy: "", createdAt: 0, updatedAt: 0,
    stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", engagementId: null,
  };
  return {
    ...base,
    id,
    customerId: input.customerId,
    locationId: input.locationId,
    address: input.address,
    venue: base.venue || "This visit",
    startAt: input.startAt,
    endAt: input.endAt,
    assignedTo: input.lead,
    attendees: input.attendees,
    stage: "scheduled",
  };
}

export async function loadBookingCheck(input: BookingCheckInput, opts: { nearby?: boolean } = {}, deps?: Partial<BookingDeps>): Promise<BookingCheckResult> {
  const d: BookingDeps = { ...defaultDeps(), ...deps };
  const now = d.now();
  const [settings, users, all] = await Promise.all([d.settings(), d.users(), d.visits()]);
  const stored = input.visitId ? all.find((v) => v.id === input.visitId) ?? null : null;
  const cand = virtualVisit(input, stored);
  const key = "sv:" + cand.id;
  const others = all.filter((v) => v.id !== cand.id);
  // The stored copy stays in the busy source so its calendar copies are recognised; excludeVisitId keeps it from being a block.
  const busySrc = [...others, ...(stored ? [stored] : [])].map(toBusyVisit);
  const candState: AddressState =
    (await d.visitStates([visitAddressInput(cand)])).get(cand.id) ?? { status: "unresolved", label: input.address, point: null, pointKey: null, fix: null };
  const address = { status: candState.status, fix: candState.fix };

  const people = visitPeople(cand)
    .map((name) => users.find((u) => u.name === name && u.status === "active"))
    .filter((u): u is { id: string; name: string; status: string } => !!u);
  const timed = input.startAt != null && input.endAt != null && input.endAt > input.startAt;
  const candDay = timed ? chicagoDayKey(input.startAt!) : null;
  const wantNearby = opts.nearby !== false;
  const today = chicagoDayKey(now);
  const look = Array.from({ length: settings.nearbyLookaheadDays }, (_, i) => addDays(today, i));
  const dayKeys = [...new Set([...(wantNearby ? look : []), ...(candDay ? [candDay] : [])])].sort();
  if (!dayKeys.length || !people.length) return { address, people: [], nearby: wantNearby ? { status: "ok", days: [], lookaheadDays: settings.nearbyLookaheadDays } : null, checkedAt: now };

  const range: Range = { timeMinMs: chicagoDayStart(addDays(dayKeys[0], -1)), timeMaxMs: chicagoDayStart(addDays(dayKeys[dayKeys.length - 1], 1)) };
  const reads = new Map(await Promise.all(people.map(async (u) => [u.id, await d.readEvents(u.id, range)] as const)));
  const hours = new Map(await Promise.all(people.map(async (u) => [u.id, await d.workHours(u.id)] as const)));
  const eventsOf = (userId: string): CalendarEvent[] | null => {
    const r = reads.get(userId);
    return r && r.status === "ok" ? r.events : null;
  };
  const deadline = now + BOOKING_ROUTE_BUDGET_MS;
  const routesFor = async (pairs: Array<{ from: LatLng; to: LatLng }>) => {
    try {
      return await d.routes(pairs, Math.max(0, deadline - d.now()));
    } catch (err) {
      console.error("[visit-booking] routing failed:", err);
      return new Map<string, number>();
    }
  };
  const planDeps: Partial<DriveLoadDeps> = {
    visits: async () => [...others, cand],
    visitStates: async (vs) => {
      const m = await d.visitStates(vs.filter((v) => v.id !== cand.id));
      m.set(cand.id, candState);
      return m;
    },
    routes: async (pairs) => routesFor(pairs),
  };

  const checks: PersonCheck[] = [];
  if (candDay) {
    for (const u of people) {
      const [day] = await d.plan({ userId: u.id, dayKeys: [candDay], events: eventsOf(u.id), mode: "cache", deps: planDeps });
      const busy = busyBlocks({ person: u.name, visits: busySrc, events: eventsOf(u.id), excludeVisitId: cand.id });
      checks.push(
        ...checkVisit(
          { key },
          [{ person: u.name, dayKey: candDay, stops: day?.stops ?? [], legs: day?.legs ?? [], busy, hours: hours.get(u.id)!, calendar: reads.get(u.id)!.status }],
          { dailyDriveLimitMin: settings.dailyDriveLimitMin }
        )
      );
    }
  }

  let nearby: NearbyResult | null = null;
  if (wantNearby) {
    const lead = people.find((u) => u.name === cand.assignedTo) ?? null;
    if (candState.status !== "verified" || !candState.point) nearby = { status: "unverified" };
    else if (!lead) nearby = { status: "ok", days: [], lookaheadDays: settings.nearbyLookaheadDays };
    else {
      // The lead's stops only — no routing for these plans; just the nearby pairs below.
      const leadPlans = await d.plan({ userId: lead.id, dayKeys: look, events: eventsOf(lead.id), mode: "cache", deps: { ...planDeps, visits: async () => others, routes: async () => new Map() } });
      const leadBusy = busyBlocks({ person: lead.name, visits: busySrc, events: eventsOf(lead.id), excludeVisitId: cand.id });
      const leadDays = leadPlans.map((p) => ({ dayKey: p.dayKey, stops: p.stops, busy: busyInRange(leadBusy, chicagoDayStart(p.dayKey), chicagoDayStart(addDays(p.dayKey, 1))) }));
      const pairs = nearbyPairs(candState.point, leadDays, settings.sameAreaMin, key);
      const routeMinutes = pairs.length ? await routesFor(pairs) : new Map<string, number>();
      const otherPeople = people
        .filter((u) => u.id !== lead.id)
        .map((u) => ({ person: u.name, calendar: reads.get(u.id)!.status, hours: hours.get(u.id)!, busy: busyBlocks({ person: u.name, visits: busySrc, events: eventsOf(u.id), excludeVisitId: cand.id }) }));
      nearby = suggestDays({
        candidate: { key, point: candState.point, startMs: input.startAt, endMs: input.endAt },
        leadDays,
        routeMinutes,
        sameAreaMin: settings.sameAreaMin,
        lookaheadDays: settings.nearbyLookaheadDays,
        others: otherPeople,
      });
    }
  }
  return { address, people: checks, nearby, checkedAt: now };
}
```

- [ ] **Step 5: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures.
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/types.ts src/lib/visit-plan/load.ts scripts/test-site-visits.ts` → 0 problems.

- [ ] **Step 6: Commit**

```bash
git add src/lib/visit-plan/types.ts src/lib/visit-plan/load.ts scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): booking-check loader — per-person calendars, drive days, nearby

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Server actions — booking check, edit a visit, badges; attendees on save

**Files:**
- Create: `src/lib/visit-plan/input.ts`, `src/app/(app)/visit-booking-actions.ts`
- Modify: `src/app/(app)/venue-assessments/visit-actions.ts` (`scheduleVisitAction`), `src/app/(app)/inbox/site-visit-actions.ts` (`createSiteVisitAction`), `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `cleanAttendees` (Task 1); `updateVisitBooking`, `getVisit`, `scheduleVisit` (Task 1); `dispatchVisitInvite`, `RecipientResult` (Task 2); `loadBookingCheck` (Task 6); `BookingCheckInput`, `BookingCheckResult` (Task 6); `Conflict` (Task 4); `activeUsers` (`src/lib/users.ts`).
- Produces:
  - `input.ts`: `cleanBookingInput(raw: unknown, roster: readonly string[]): BookingCheckInput` (times kept only when `0 < end − start ≤ 24 h`; lead kept only when on the roster; attendees via `cleanAttendees`).
  - `visit-booking-actions.ts`: `bookingCheckAction(raw: unknown): Promise<BookingCheckResult | { error: string }>`; `updateVisitAction(id: string, raw: unknown): Promise<{ ok: true; invites: RecipientResult[] } | { ok: false; error: string }>`; `visitConflictSummariesAction(raw: unknown): Promise<Record<string, Conflict[]>>` (≤ 10 scheduled visits, nearby skipped).
  - `scheduleVisitAction(id, input: { startAt: number; endAt: number; attendees?: unknown })`; `CreateSiteVisitInput.attendees?: string[]`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-site-visits.ts`:

```ts
import { cleanBookingInput } from "@/lib/visit-plan/input";
```

Append the check:

```ts
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
  const badges = fnBody(ba, "visitConflictSummariesAction");
  ok(/\.slice\(0, 10\)/.test(badges) && /nearby: false/.test(badges), "site-visits actions: conflict badges check at most 10 visits and skip nearby days");
  const va = readFileSync("src/app/(app)/venue-assessments/visit-actions.ts", "utf8");
  const sched = fnBody(va, "scheduleVisitAction");
  ok(/cleanAttendees\(input\.attendees/.test(sched) && /scheduleVisit\(id, input\.startAt, input\.endAt, attendees\)/.test(sched),
    "site-visits actions: scheduling a request saves its cleaned attendees");
  ok((va.match(/resyncForVisitChange\(/g) ?? []).length === 2, "site-visits actions: visit-actions still holds exactly two re-sync triggers");
  const inbox = readFileSync("src/app/(app)/inbox/site-visit-actions.ts", "utf8");
  ok(/attendees: cleanAttendees\(input\.attendees, input\.assignedTo, roster\)/.test(fnBody(inbox, "createSiteVisitAction")), "site-visits actions: the Inbox create saves cleaned attendees");
}
```

Wire it: add `siteVisitsActionChecks` to the harness import and `.then(() => siteVisitsActionChecks(ok))` after `.then(() => siteVisitsLoaderChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/input'`.

- [ ] **Step 3: Implement `src/lib/visit-plan/input.ts`**

```ts
/** Untrusted booking-check input → BookingCheckInput (spec 2026-10-09
 *  site-visit scheduling). Pure. */
import { cleanAttendees } from "./people";
import type { BookingCheckInput } from "./types";

const MAX_SPAN_MS = 24 * 3_600_000;

export function cleanBookingInput(raw: unknown, roster: readonly string[]): BookingCheckInput {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = num(r.startAt);
  const e = num(r.endAt);
  const timed = s != null && e != null && s > 0 && e > s && e - s <= MAX_SPAN_MS;
  const lead = text(r.lead, 120);
  return {
    visitId: text(r.visitId, 40) || null,
    customerId: text(r.customerId, 200) || null,
    locationId: text(r.locationId, 200) || null,
    address: text(r.address, 300),
    startAt: timed ? s : null,
    endAt: timed ? e : null,
    lead: roster.includes(lead) ? lead : "",
    attendees: cleanAttendees(r.attendees, lead, roster),
  };
}
```

- [ ] **Step 4: Implement `src/app/(app)/visit-booking-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { getVisit, updateVisitBooking } from "@/lib/stores/site-visits";
import { activeUsers } from "@/lib/users";
import { dispatchVisitInvite, type RecipientResult } from "@/lib/visit-invite";
import type { Conflict } from "@/lib/visit-plan/check";
import { cleanBookingInput } from "@/lib/visit-plan/input";
import { cleanAttendees } from "@/lib/visit-plan/people";
import type { BookingCheckResult } from "@/lib/visit-plan/types";

/**
 * Spec 2026-10-09 site-visit scheduling — the booking screen's live check
 * (nearby days + conflicts), editing a scheduled visit, and the visit
 * conflict badges. Conflicts never block a save.
 */

const CHECK_FAILED = "Couldn't check conflicts — you can still schedule.";

export async function bookingCheckAction(raw: unknown): Promise<BookingCheckResult | { error: string }> {
  await requireUser();
  const roster = (await activeUsers()).map((u) => u.name);
  const input = cleanBookingInput(raw, roster);
  try {
    const { loadBookingCheck } = await import("@/lib/visit-plan/load");
    return await loadBookingCheck(input);
  } catch (err) {
    console.error("[visit-booking] check failed:", err);
    return { error: CHECK_FAILED };
  }
}

export async function updateVisitAction(
  id: string,
  raw: unknown
): Promise<{ ok: true; invites: RecipientResult[] } | { ok: false; error: string }> {
  const me = await requireUser();
  if (typeof id !== "string" || !id || id.length > 40) return { ok: false, error: "Missing visit id." };
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const startAt = typeof r.startAt === "number" ? r.startAt : NaN;
  const endAt = typeof r.endAt === "number" ? r.endAt : NaN;
  if (!(startAt > 0) || !(endAt > startAt) || endAt - startAt > 24 * 3_600_000) return { ok: false, error: "Bad time range" };
  const roster = (await activeUsers()).map((u) => u.name);
  const lead = typeof r.assignedTo === "string" ? r.assignedTo.trim() : "";
  if (!roster.includes(lead)) return { ok: false, error: "Pick who leads the visit." };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "Visit not found" };
  if (v.stage === "done") return { ok: false, error: "Visit already completed" };
  const fresh = await updateVisitBooking(id, { startAt, endAt, assignedTo: lead, attendees: cleanAttendees(r.attendees, lead, roster) });
  if (!fresh) return { ok: false, error: "Visit not found" };
  // Spec 2026-10-09 triggers: re-sync the old and new day for everyone on
  // either version. Registered before the invites, so an invite error can't drop it.
  const prevVisit = v;
  const nextVisit = fresh;
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(prevVisit, nextVisit).catch((err) => console.error("[drive-sync] visit re-sync failed:", err));
  });
  const report = await dispatchVisitInvite(fresh, { id: me.id, name: me.name });
  revalidatePath("/", "layout");
  return { ok: true, invites: report.recipients };
}

/** Conflict badges for visits on a page (the company record). Computed on
 *  load, for every person on each visit; at most 10 visits per call. */
export async function visitConflictSummariesAction(raw: unknown): Promise<Record<string, Conflict[]>> {
  await requireUser();
  const ids = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && !!x && x.length <= 40))].slice(0, 10) : [];
  const out: Record<string, Conflict[]> = {};
  if (!ids.length) return out;
  const { loadBookingCheck } = await import("@/lib/visit-plan/load");
  for (const id of ids) {
    const v = await getVisit(id);
    if (!v || v.stage !== "scheduled" || v.startAt == null || v.endAt == null) continue;
    try {
      const r = await loadBookingCheck(
        { visitId: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address, startAt: v.startAt, endAt: v.endAt, lead: v.assignedTo, attendees: v.attendees },
        { nearby: false }
      );
      const many = r.people.length > 1;
      const list = r.people.flatMap((p) => p.conflicts.map((c) => ({ kind: c.kind, text: many ? `${p.person}: ${c.text}` : c.text })));
      if (list.length) out[id] = list;
    } catch (err) {
      console.error("[visit-booking] badge check failed:", id, err);
    }
  }
  return out;
}
```

- [ ] **Step 5: Attendees on the two existing save paths**

`src/app/(app)/venue-assessments/visit-actions.ts` — add `import { activeUsers } from "@/lib/users";` and `import { cleanAttendees } from "@/lib/visit-plan/people";`. In `scheduleVisitAction`, change the input type to `input: { startAt: number; endAt: number; attendees?: unknown }`, and replace the single `await scheduleVisit(id, input.startAt, input.endAt);` line with:

```ts
  // Spec 2026-10-09 site-visit scheduling — attendees picked while booking.
  // Omitted = leave any existing attendees alone.
  const roster = (await activeUsers()).map((u) => u.name);
  const attendees = input.attendees === undefined ? undefined : cleanAttendees(input.attendees, v.assignedTo, roster);
  await scheduleVisit(id, input.startAt, input.endAt, attendees);
```

`src/app/(app)/inbox/site-visit-actions.ts` — add the same two imports; add to `CreateSiteVisitInput`, after `assignedTo: string; // team-member name`:

```ts
  /** Spec 2026-10-09 site-visit scheduling — other Peak people on the visit. */
  attendees?: string[];
```

In `createSiteVisitAction`, before the `let rec` line add `const roster = (await activeUsers()).map((u) => u.name);` and in the `createVisit({ … })` object, after `assignedTo: input.assignedTo,` add:

```ts
      attendees: cleanAttendees(input.attendees, input.assignedTo, roster),
```

- [ ] **Step 6: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures (drive-time trigger pins included).
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/input.ts "src/app/(app)/visit-booking-actions.ts" "src/app/(app)/venue-assessments/visit-actions.ts" "src/app/(app)/inbox/site-visit-actions.ts" scripts/test-site-visits.ts` → 0 problems.

- [ ] **Step 7: Commit**

```bash
git add src/lib/visit-plan/input.ts "src/app/(app)/visit-booking-actions.ts" "src/app/(app)/venue-assessments/visit-actions.ts" "src/app/(app)/inbox/site-visit-actions.ts" scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): booking-check, edit-visit and badge actions; attendees on save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Booking screen — attendee picker, Nearby days, live conflicts (visit requests + Inbox)

**Files:**
- Create: `src/components/visit-booking/use-booking-check.ts`, `src/components/visit-booking/booking-panel.tsx`, `src/components/visit-booking/attendee-picker.tsx`, `src/components/visit-booking/nearby-strip.tsx`, `src/components/visit-booking/conflicts-panel.tsx`
- Modify: `src/app/(app)/venue-assessments/visit-requests.tsx`, `src/app/(app)/venue-assessments/page.tsx`, `src/app/(app)/inbox/site-visit-modal.tsx`, `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `bookingCheckAction` (Task 7); `BookingCheckResult` (Task 6); `PersonCheck` (Task 4); `NearbyResult`, `NEARBY_TEXT`, `nearbyLine` (Task 5); `MAX_ATTENDEES` (Task 1); `inviteSummary` (Task 2); `scheduleVisitAction(id, { startAt, endAt, attendees })`, `createSiteVisitAction({ …, attendees })` (Task 7).
- Produces:
  - `use-booking-check.ts`: `BOOKING_CHECK_DEBOUNCE_MS = 800`; `type BookingCheckArgs = { visitId: string | null; customerId: string | null; locationId: string | null; address: string; startAt: number | null; endAt: number | null; lead: string; attendees: string[] }`; `useBookingCheck(args): { loading: boolean; result: BookingCheckResult | null; error: string }`.
  - `booking-panel.tsx` (default export): `type BookingPanelProps = BookingCheckArgs & { team: string[]; onAttendeesChange(next: string[]): void; onPickDay(dayKey: string): void }`.
  - `attendee-picker.tsx`, `nearby-strip.tsx`, `conflicts-panel.tsx` (default exports, props below).
  - `VisitRequestVM` gains `customerId`, `locationId`, `address`; `<VisitRequests rows team me />`.

- [ ] **Step 1: Write the failing tests**

Append the check to `scripts/test-site-visits.ts`:

```ts
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
  const picker = read("src/components/visit-booking/attendee-picker.tsx");
  ok(/team\.filter\(\(n\) => n !== lead/.test(picker), "site-visits booking: the lead is never offered as an attendee");
  const clientFiles = [...readdirSync("src/components/visit-booking").map((f) => join("src/components/visit-booking", f)), "src/app/(app)/venue-assessments/visit-requests.tsx", "src/app/(app)/inbox/site-visit-modal.tsx"];
  const leaky = clientFiles.filter((f) => /from "@\/(db|lib\/stores|lib\/visit-plan\/load|lib\/google|lib\/gmail|lib\/users)/.test(read(f)));
  ok(leaky.length === 0, "site-visits booking: client components import nothing that reaches the database" + (leaky.length ? " — " + leaky.join(", ") : ""));
}
```

Wire it: add `siteVisitsBookingUiPins` to the harness import and `.then(() => siteVisitsBookingUiPins(ok))` after `.then(() => siteVisitsActionChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `env -u DATABASE_URL npm run test:specs`
Expected: FAIL — `ENOENT … src/components/visit-booking/use-booking-check.ts` (the suite reports the thrown check).

- [ ] **Step 3: The hook**

Create `src/components/visit-booking/use-booking-check.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { bookingCheckAction } from "@/app/(app)/visit-booking-actions";
import type { BookingCheckResult } from "@/lib/visit-plan/types";

/** Spec 2026-10-09 site-visit scheduling — the booking screen's live check.
 *  Debounced: a calendar read + routing per call, never per keystroke. */
export const BOOKING_CHECK_DEBOUNCE_MS = 800;
const FAILED = "Couldn't check conflicts — you can still schedule.";

export type BookingCheckArgs = {
  visitId: string | null;
  customerId: string | null;
  locationId: string | null;
  address: string;
  startAt: number | null;
  endAt: number | null;
  lead: string;
  attendees: string[];
};

export function useBookingCheck(args: BookingCheckArgs): { loading: boolean; result: BookingCheckResult | null; error: string } {
  const sig = JSON.stringify(args);
  const [state, setState] = useState<{ forSig: string; result: BookingCheckResult | null; error: string }>({ forSig: "", result: null, error: "" });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      bookingCheckAction(JSON.parse(sig) as BookingCheckArgs)
        .then((r) => {
          if (live) setState("error" in r ? { forSig: sig, result: null, error: r.error } : { forSig: sig, result: r, error: "" });
        })
        .catch(() => {
          if (live) setState({ forSig: sig, result: null, error: FAILED });
        });
    }, BOOKING_CHECK_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sig]);
  // The last answer stays on screen (dimmed) while a newer one is on its way.
  return { loading: state.forSig !== sig, result: state.result, error: state.error };
}
```

- [ ] **Step 4: The three parts and the panel**

Create `src/components/visit-booking/attendee-picker.tsx`:

```tsx
"use client";

import { MAX_ATTENDEES } from "@/lib/visit-plan/people";

const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 } as const;

/** Other Peak people on the visit. The lead is never offered. */
export default function AttendeePicker({ lead, team, value, onChange }: { lead: string; team: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const chosen = value.filter((n) => n !== lead);
  const options = team.filter((n) => n !== lead && !chosen.includes(n));
  return (
    <div>
      <span style={lbl}>Also going</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {chosen.map((n) => (
          <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "1px solid #e4e7ec", borderRadius: 20, padding: "2px 4px 2px 9px" }}>
            {n}
            <button type="button" aria-label={`Remove ${n}`} onClick={() => onChange(chosen.filter((x) => x !== n))} style={{ border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>
              ×
            </button>
          </span>
        ))}
        {options.length > 0 && chosen.length < MAX_ATTENDEES && (
          <select
            aria-label="Add a person"
            value=""
            onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
            className="pk-input"
            style={{ width: "auto", fontSize: 11.5, padding: "3px 6px" }}
          >
            <option value="">+ Add person</option>
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        {!chosen.length && !options.length && <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>No one else on the team.</span>}
      </div>
    </div>
  );
}
```

Create `src/components/visit-booking/nearby-strip.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { NEARBY_TEXT, nearbyLine, type NearbyResult } from "@/lib/visit-plan/nearby";

const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 } as const;
const muted = { fontSize: 11.5, color: "#9aa0ab" } as const;

/** Days the lead is already nearby. One click fills the date; the rep still picks the time. */
export default function NearbyStrip({ nearby, loading, onPick }: { nearby: NearbyResult | null; loading: boolean; onPick: (dayKey: string) => void }) {
  let body: ReactNode;
  if (!nearby) body = <span style={muted}>{loading ? "Looking for nearby days…" : ""}</span>;
  else if (nearby.status === "unverified") body = <span style={muted}>{NEARBY_TEXT.unverified}</span>;
  else if (nearby.status === "unavailable") body = <span style={muted}>{NEARBY_TEXT.unavailable}</span>;
  else if (!nearby.days.length) body = <span style={muted}>{`No days in the next ${nearby.lookaheadDays} with a stop nearby.`}</span>;
  else
    body = nearby.days.map((d) => (
      <button
        key={d.dayKey}
        type="button"
        onClick={() => onPick(d.dayKey)}
        title="Use this date — you still pick the time"
        style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 2, padding: "7px 10px", borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff", cursor: "pointer" }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "#16181d" }}>{nearbyLine(d)}</span>
        {d.others.length > 0 && (
          <span style={muted}>{d.others.map((o) => `${o.person} ${o.status === "unknown" ? "— couldn't check" : o.status}`).join(" · ")}</span>
        )}
      </button>
    ));
  return (
    <div aria-busy={loading}>
      <span style={lbl}>Nearby days</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: loading && nearby ? 0.6 : 1 }}>{body}</div>
    </div>
  );
}
```

Create `src/components/visit-booking/conflicts-panel.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import type { PersonCheck } from "@/lib/visit-plan/check";

const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 } as const;
const muted = { fontSize: 11.5, color: "#9aa0ab" } as const;

/** Live conflicts, per person. Flags only — never blocks Schedule. */
export default function ConflictsPanel({ people, timed, loading, error }: { people: PersonCheck[]; timed: boolean; loading: boolean; error: string }) {
  let body: ReactNode;
  if (!timed) body = <span style={muted}>Pick a time to check conflicts.</span>;
  else if (error) body = <span style={muted}>{error}</span>;
  else if (!people.length) body = <span style={muted}>{loading ? "Checking…" : "No one to check yet."}</span>;
  else
    body = (
      <>
        {people.map((p) => (
          <div key={p.person} style={{ fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: "#16181d" }}>{p.person}</span>{" "}
            {p.conflicts.length === 0 && p.calendar !== "failed" && <span style={{ color: "#1f7a52" }}>No conflicts</span>}
            {p.conflicts.map((c, i) => (
              <div key={i} style={{ color: "#8a3a2a", fontWeight: 600 }}>
                ⚠ {c.text}
              </div>
            ))}
            {p.notes.map((n) => (
              <div key={n} style={muted}>
                {n}
              </div>
            ))}
          </div>
        ))}
        <div style={{ ...muted, marginTop: 4 }}>Conflicts never block scheduling.</div>
      </>
    );
  return (
    <div aria-busy={loading}>
      <span style={lbl}>Conflicts</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 11px", borderRadius: 9, background: "#fafbfc", border: "1px solid #eef0f3", opacity: loading && people.length ? 0.6 : 1 }}>
        {body}
      </div>
    </div>
  );
}
```

Create `src/components/visit-booking/booking-panel.tsx`:

```tsx
"use client";

import AttendeePicker from "./attendee-picker";
import ConflictsPanel from "./conflicts-panel";
import NearbyStrip from "./nearby-strip";
import { useBookingCheck, type BookingCheckArgs } from "./use-booking-check";

export type BookingPanelProps = BookingCheckArgs & {
  team: string[];
  onAttendeesChange: (next: string[]) => void;
  onPickDay: (dayKey: string) => void;
};

/** Spec 2026-10-09 site-visit scheduling — the booking screen: attendee
 *  picker, Nearby days strip and live conflicts. Advisory only. */
export default function BookingPanel(p: BookingPanelProps) {
  const check = useBookingCheck({
    visitId: p.visitId,
    customerId: p.customerId,
    locationId: p.locationId,
    address: p.address,
    startAt: p.startAt,
    endAt: p.endAt,
    lead: p.lead,
    attendees: p.attendees,
  });
  const timed = p.startAt != null && p.endAt != null && p.endAt > p.startAt;
  return (
    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <AttendeePicker lead={p.lead} team={p.team} value={p.attendees} onChange={p.onAttendeesChange} />
      <NearbyStrip nearby={check.result?.nearby ?? null} loading={check.loading} onPick={p.onPickDay} />
      <ConflictsPanel people={check.result?.people ?? []} timed={timed} loading={check.loading} error={check.error} />
    </div>
  );
}
```

- [ ] **Step 5: Wire the visit-requests scheduler**

`src/app/(app)/venue-assessments/visit-requests.tsx`:

1. Add `import BookingPanel from "@/components/visit-booking/booking-panel";`.
2. Add to `VisitRequestVM` (after `addressFlag`):

```ts
  /** Spec 2026-10-09 site-visit scheduling — the booking check's inputs. */
  customerId: string | null;
  locationId: string | null;
  address: string;
```

3. Change `function VisitRequestRow({ row }: { row: VisitRequestVM })` to `function VisitRequestRow({ row, team, me }: { row: VisitRequestVM; team: string[]; me: string })`, and after the `err` state add:

```ts
  const [attendees, setAttendees] = useState<string[]>([]);
  const parsed = (v: string) => {
    const t = v ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const startMs = parsed(start);
  const endMs = parsed(end);
  // A nearby day fills the date; the rep's times stay (or 9–10 when blank).
  const pickDay = (dayKey: string) => {
    setStart(`${dayKey}T${start.slice(11, 16) || "09:00"}`);
    setEnd(`${dayKey}T${end.slice(11, 16) || "10:00"}`);
  };
```

4. In `doSchedule`, change the call to `scheduleVisitAction(row.id, { startAt: s, endAt: e, attendees })`.
5. Directly before `{err && …}` at the bottom of the row, add:

```tsx
      {row.mine && (
        <BookingPanel
          visitId={row.id}
          customerId={row.customerId}
          locationId={row.locationId}
          address={row.address}
          startAt={startMs}
          endAt={endMs}
          lead={me}
          team={team}
          attendees={attendees}
          onAttendeesChange={setAttendees}
          onPickDay={pickDay}
        />
      )}
```

6. Change `VisitRequests` to `export default function VisitRequests({ rows, team, me }: { rows: VisitRequestVM[]; team: string[]; me: string })` and render `<VisitRequestRow key={r.id} row={r} team={team} me={me} />`.

`src/app/(app)/venue-assessments/page.tsx`: import `activeUsers` from `@/lib/users`; in the `visitRows` mapping add `customerId: v.customerId, locationId: v.locationId, address: v.address,`; before the JSX add `const team = (await activeUsers()).map((u) => u.name);`; change the render to `<VisitRequests rows={visitRows} team={team} me={me} />`.

- [ ] **Step 6: Wire the Inbox dialog**

`src/app/(app)/inbox/site-visit-modal.tsx`:

1. Add `import BookingPanel from "@/components/visit-booking/booking-panel";` and `import { inviteSummary } from "@/lib/visit-invite-plan";`.
2. After the `assignee` state add:

```ts
  const [attendees, setAttendees] = useState<string[]>([]);
  const startMs = new Date(`${date}T${time}:00`).getTime();
  const okStart = Number.isFinite(startMs) ? startMs : null;
```

3. In `submit`'s `createSiteVisitAction({ … })` object, after `assignedTo: assignee,` add `attendees,`. Replace the `setDone(…)` call with:

```ts
      setDone(`${res.id} saved. ` + (inviteSummary(res.invites) || inviteMessage(res.inviteStatus, assignee)));
```

4. Change the "Assigned to" label text to `Lead (everyone on the visit gets the calendar invite)` and its select's `onChange` to:

```tsx
onChange={(e) => {
  const next = e.target.value;
  setAssignee(next);
  setAttendees((a) => a.filter((n) => n !== next));
}}
```

5. Directly after that `</select>`, add:

```tsx
            <BookingPanel
              visitId={null}
              customerId={customerId}
              locationId={venueId || null}
              address={visit.venues.find((v) => v.id === venueId)?.address || ""}
              startAt={okStart}
              endAt={okStart != null ? okStart + durationMin * 60_000 : null}
              lead={assignee}
              team={visit.team}
              attendees={attendees}
              onAttendeesChange={setAttendees}
              onPickDay={setDate}
            />
```

(Leave the address warning, its debounce and the overlay `zIndex` untouched — spec 1's pins read them.)

- [ ] **Step 7: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures (spec 1's booking pins included).
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/components/visit-booking "src/app/(app)/venue-assessments/visit-requests.tsx" "src/app/(app)/venue-assessments/page.tsx" "src/app/(app)/inbox/site-visit-modal.tsx" scripts/test-site-visits.ts` → 0 errors.
Run: `npm run build` → succeeds (catches a client file reaching `@/db`).

- [ ] **Step 8: Commit**

```bash
git add src/components/visit-booking "src/app/(app)/venue-assessments" "src/app/(app)/inbox/site-visit-modal.tsx" scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): booking panel — attendees, nearby days, live conflicts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Edit an existing visit + conflict badges on the company record

**Files:**
- Create: `src/components/visit-booking/conflict-badge.tsx`, `src/components/visit-booking/visit-edit-dialog.tsx`, `src/components/visit-booking/visit-edit-button.tsx`, `src/components/visit-booking/visit-conflict-chips.tsx`
- Modify: `src/app/(app)/companies/[id]/page.tsx`, `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `BookingPanel` (Task 8); `updateVisitAction`, `visitConflictSummariesAction` (Task 7); `Conflict`, `CONFLICT_LABEL` (Task 4); `inviteSummary` (Task 2).
- Produces:
  - `conflict-badge.tsx` (default export, no hooks — usable anywhere): `ConflictBadge({ conflicts: Conflict[]; compact?: boolean })`.
  - `visit-edit-dialog.tsx`: `type VisitEditVM = { id: string; customerId: string | null; locationId: string | null; address: string; title: string; startAt: number; endAt: number; assignedTo: string; attendees: string[] }`; default export `VisitEditDialog({ visit, team, onClose })`.
  - `visit-edit-button.tsx`: `EditVisitButton({ visit: VisitEditVM; team: string[] })`.
  - `visit-conflict-chips.tsx`: `VisitConflictProvider({ ids: string[]; children })`, `VisitConflictChip({ id: string })`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-site-visits.ts`:

```ts
export async function siteVisitsEditPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const page = read("src/app/(app)/companies/[id]/page.tsx");
  ok(page.includes("<EditVisitButton") && page.includes("<VisitConflictProvider") && page.includes("<VisitConflictChip"),
    "site-visits edit: the company record's visit rows get Edit and a conflict badge");
  ok(/v\.stage === "scheduled"[^?]*\?\s*\(?\s*<EditVisitButton/.test(page),
    "site-visits edit: only a scheduled (not yet done) visit offers Edit");
  ok(/\.slice\(0, 10\)/.test(page) && /v\.stage === "scheduled"/.test(page), "site-visits edit: badges are asked for at most 10 upcoming scheduled visits");
  const dialog = read("src/components/visit-booking/visit-edit-dialog.tsx");
  ok(dialog.includes("<BookingPanel") && /visitId=\{visit\.id\}/.test(dialog) && /updateVisitAction\(visit\.id, \{[^}]*attendees[^}]*\}\)/.test(dialog),
    "site-visits edit: editing shows the booking panel for that visit and saves time, lead and attendees");
  ok(!/disabled=\{[^}]*(check|conflict)/i.test(dialog), "site-visits edit: conflicts never disable Save");
  const chips = read("src/components/visit-booking/visit-conflict-chips.tsx");
  ok(chips.includes("visitConflictSummariesAction") && /if \(live\)/.test(chips), "site-visits edit: badges load once per list, after the page renders");
  const badge = read("src/components/visit-booking/conflict-badge.tsx");
  ok(/aria-label=\{all\}/.test(badge) && /title=\{all\}/.test(badge) && !badge.includes("useState"), "site-visits edit: the badge carries every conflict in its title and label, and has no hooks");
}
```

Wire it: add `siteVisitsEditPins` to the harness import and `.then(() => siteVisitsEditPins(ok))` after `.then(() => siteVisitsBookingUiPins(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `env -u DATABASE_URL npm run test:specs`
Expected: FAIL on the first `site-visits edit:` line (no `<EditVisitButton` yet).

- [ ] **Step 3: The badge**

Create `src/components/visit-booking/conflict-badge.tsx`:

```tsx
import { CONFLICT_LABEL, type Conflict } from "@/lib/visit-plan/check";

/** "⚠ Double-booked +1" — every conflict's full text in title + aria-label.
 *  No hooks: renders in server and client trees alike. */
export default function ConflictBadge({ conflicts, compact = false }: { conflicts: Conflict[]; compact?: boolean }) {
  if (!conflicts.length) return null;
  const all = conflicts.map((c) => c.text).join("\n");
  const first = conflicts[0];
  const label = compact ? CONFLICT_LABEL[first.kind] : first.text;
  return (
    <span
      role="img"
      aria-label={all}
      title={all}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: compact ? 10 : 11.5, fontWeight: 600, color: "#8a5a00", whiteSpace: compact ? "nowrap" : "normal" }}
    >
      ⚠ {label}
      {conflicts.length > 1 ? ` +${conflicts.length - 1}` : ""}
    </span>
  );
}
```

- [ ] **Step 4: The edit dialog and button**

Create `src/components/visit-booking/visit-edit-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateVisitAction } from "@/app/(app)/visit-booking-actions";
import { inviteSummary } from "@/lib/visit-invite-plan";
import BookingPanel from "./booking-panel";

export type VisitEditVM = {
  id: string;
  customerId: string | null;
  locationId: string | null;
  address: string;
  title: string;
  startAt: number;
  endAt: number;
  assignedTo: string;
  attendees: string[];
};

const inStyle: CSSProperties = { width: "100%", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, fontFamily: "var(--font-ui)", background: "#fff", color: "#16181d", outline: "none" };
const lbl: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", margin: "12px 0 5px" };
const p2 = (n: number) => String(n).padStart(2, "0");
const localDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const localTime = (ms: number) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const LENGTHS = [30, 60, 90, 120, 180, 240];

/** Spec 2026-10-09 site-visit scheduling — edit a scheduled visit: time,
 *  lead and attendees, with nearby days and live conflicts. Saving updates
 *  every invite (add / update / cancel). Nothing blocks Save. */
export default function VisitEditDialog({ visit, team, onClose }: { visit: VisitEditVM; team: string[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialLen = Math.max(15, Math.round((visit.endAt - visit.startAt) / 60_000));
  const [date, setDate] = useState(localDate(visit.startAt));
  const [time, setTime] = useState(localTime(visit.startAt));
  const [durationMin, setDurationMin] = useState(initialLen);
  const [lead, setLead] = useState(visit.assignedTo);
  const [attendees, setAttendees] = useState<string[]>(visit.attendees);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const startMs = new Date(`${date}T${time}:00`).getTime();
  const okStart = Number.isFinite(startMs) ? startMs : null;
  const lengths = LENGTHS.includes(initialLen) ? LENGTHS : [...LENGTHS, initialLen].sort((a, b) => a - b);
  const leads = team.includes(visit.assignedTo) ? team : [visit.assignedTo, ...team];

  const save = () => {
    if (okStart == null) {
      setError("Pick a date and time.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await updateVisitAction(visit.id, { startAt: okStart, endAt: okStart + durationMin * 60_000, assignedTo: lead, attendees });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(inviteSummary(res.invites) || "Saved.");
      router.refresh();
    });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(22,24,29,.4)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit site visit"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.22)", padding: "20px 22px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Edit site visit</div>
          <button onClick={onClose} title="Close" style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>{visit.title}</div>
        {done ? (
          <>
            <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "#e8f3ee", border: "1px solid #cfe6db", color: "#1f7a52", fontSize: 12.5, lineHeight: 1.5 }}>{done}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="pk-btn-accent" onClick={onClose} style={{ fontSize: 12.5 }}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label style={lbl}>Date</label>
                <input type="date" style={inStyle} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Start</label>
                <input type="time" style={inStyle} value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Length</label>
                <select style={inStyle} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
                  {lengths.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} hr${m > 60 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label style={lbl}>Lead</label>
            <select
              style={inStyle}
              value={lead}
              onChange={(e) => {
                const next = e.target.value;
                setLead(next);
                setAttendees((a) => a.filter((n) => n !== next));
              }}
            >
              {leads.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <BookingPanel
              visitId={visit.id}
              customerId={visit.customerId}
              locationId={visit.locationId}
              address={visit.address}
              startAt={okStart}
              endAt={okStart != null ? okStart + durationMin * 60_000 : null}
              lead={lead}
              team={team}
              attendees={attendees}
              onAttendeesChange={setAttendees}
              onPickDay={setDate}
            />
            {error && <div style={{ marginTop: 10, fontSize: 12, color: "#a03b2e" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="pk-btn-outline" onClick={onClose} style={{ fontSize: 12.5 }}>
                Cancel
              </button>
              <button className="pk-btn-accent" onClick={save} disabled={pending} style={{ fontSize: 12.5, opacity: pending ? 0.7 : 1 }}>
                {pending ? "Saving…" : "Save & update invites"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

Create `src/components/visit-booking/visit-edit-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import VisitEditDialog, { type VisitEditVM } from "./visit-edit-dialog";

export function EditVisitButton({ visit, team }: { visit: VisitEditVM; team: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pk-btn-outline" style={{ fontSize: 10.5, padding: "3px 8px" }} onClick={() => setOpen(true)}>
        Edit
      </button>
      {open && <VisitEditDialog visit={visit} team={team} onClose={() => setOpen(false)} />}
    </>
  );
}
```

Create `src/components/visit-booking/visit-conflict-chips.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { visitConflictSummariesAction } from "@/app/(app)/visit-booking-actions";
import type { Conflict } from "@/lib/visit-plan/check";
import ConflictBadge from "./conflict-badge";

const ConflictsCtx = createContext<Record<string, Conflict[]> | null>(null);

/** Loads conflict badges for a list of visits once, after the page renders. */
export function VisitConflictProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [map, setMap] = useState<Record<string, Conflict[]> | null>(null);
  const sig = ids.join("|");
  useEffect(() => {
    if (!sig) return;
    let live = true;
    visitConflictSummariesAction(sig.split("|"))
      .then((m) => {
        if (live) setMap(m);
      })
      // Badges are advisory: a failure just shows none.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sig]);
  return <ConflictsCtx.Provider value={map}>{children}</ConflictsCtx.Provider>;
}

export function VisitConflictChip({ id }: { id: string }) {
  const map = useContext(ConflictsCtx);
  const list = map?.[id];
  return list?.length ? <ConflictBadge conflicts={list} compact /> : null;
}
```

- [ ] **Step 5: The company record**

`src/app/(app)/companies/[id]/page.tsx`:

1. Imports: `import { EditVisitButton } from "@/components/visit-booking/visit-edit-button";` and `import { VisitConflictChip, VisitConflictProvider } from "@/components/visit-booking/visit-conflict-chips";`.
2. After the `visitRecCounts` line add:

```ts
  // Spec 2026-10-09 site-visit scheduling — Edit + conflict badges. A stored
  // "scheduled" visit past its end already reads "done" (deriveVisitStage).
  const teamNames = users.map((u) => u.name);
  const conflictIds = visits
    .filter((v) => v.stage === "scheduled" && v.startAt != null)
    .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0))
    .slice(0, 10)
    .map((v) => v.id);
```

3. Wrap the Site visits `<ShortList … />` in `<VisitConflictProvider ids={conflictIds}> … </VisitConflictProvider>`.
4. In each visit row, after `<RecordingCountBadge … />` add `<VisitConflictChip id={v.id} />`, and replace `<span style={{ marginLeft: "auto" }}><DeleteVisitButton id={v.id} /></span>` with:

```tsx
                          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                            {v.stage === "scheduled" && v.startAt != null && v.endAt != null ? (
                              <EditVisitButton
                                visit={{
                                  id: v.id,
                                  customerId: v.customerId,
                                  locationId: v.locationId,
                                  address: v.address,
                                  title: [v.reason, v.venue].filter(Boolean).join(" · "),
                                  startAt: v.startAt,
                                  endAt: v.endAt,
                                  assignedTo: v.assignedTo,
                                  attendees: v.attendees,
                                }}
                                team={teamNames}
                              />
                            ) : null}
                            <DeleteVisitButton id={v.id} />
                          </span>
```

5. In the row's second line, after `{v.assignedTo ? " · " + v.assignedTo : " · unclaimed"}` add `{v.attendees.length ? " + " + v.attendees.join(", ") : ""}`.

- [ ] **Step 6: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures.
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/components/visit-booking "src/app/(app)/companies/[id]/page.tsx" scripts/test-site-visits.ts` → 0 errors.
Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/visit-booking "src/app/(app)/companies/[id]/page.tsx" scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): edit a scheduled visit; conflict badges on the company record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Calendar + Home agenda — attendee visits and conflict badges

**Files:**
- Create: `src/lib/visit-plan/agenda.ts`
- Modify: `src/lib/agenda.ts`, `src/lib/drive-sync/agenda.ts`, `src/app/(app)/calendar/calendar-client.tsx`, `src/app/(app)/home-calendar.tsx`, `scripts/test-site-visits.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `driveAgendaLayer` (spec 1); `DriveDayPlan`; `stopConflicts`, `Conflict` (Task 4); `busyBlocks`, `toBusyVisit`, `BusyEvent`, `VisitForBusy` (Task 4); `isVisitIcsCopy` (Task 2); `visitPeople`; `visitEventIds` (Task 2); `getSchedulingSettings`, `workHoursFor` (Task 3); `ConflictBadge` (Task 9).
- Produces:
  - `visit-plan/agenda.ts` (pure): `agendaConflicts({ me, plans, visits, events, hours, dailyDriveLimitMin }): Map<string, Conflict[]>` keyed by agenda item key — `"v-<visitId>"` for the app's visit row and `"g-<eventId>"` for every calendar copy of that visit.
  - `AgendaItem.conflicts?: Conflict[]`.
  - `driveAgendaLayer` also returns `plans: DriveDayPlan[]`.
  - The agenda shows a visit to its lead **and every attendee**.

Badges on `/calendar` and Home are computed for the viewer's own day only (the plans the drive layer already built) — no other person's calendar is read on a page view.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-site-visits.ts`:

```ts
import { agendaConflicts } from "@/lib/visit-plan/agenda";
```

Append the check:

```ts
export async function siteVisitsAgendaChecks(ok: Ok): Promise<void> {
  const r60: Array<[LatLng, LatLng, number]> = [[BASE, P1, 60], [P1, BASE, 60]];
  const C = vStop("sv:SV-C", at(10), at(11), okAddr(P1, "c"));
  const Q = vStop("sv:SV-Q", at(14), at(15), okAddr(P1, "q"));
  const plan = dayPlan([C, Q], [...r60, [P1, P1, 0]]);
  const visits = [
    sv("SV-C", { startAt: at(10), endAt: at(11), invites: [rcpt("Dana", { channel: "calendar", eventId: "g-copy" })] }),
    sv("SV-Q", { startAt: at(14), endAt: at(15) }),
  ];
  const events = [
    gEvent("board", at(10, 30), at(11, 30), { title: "Board meeting" }),
    gEvent("g-copy", at(10), at(11)),
    gEvent("ics", at(10), at(11), { iCalUID: "sv-SV-C@peak-app" }),
  ];
  const m = agendaConflicts({ me: "Dana", plans: [{ dayKey: DAY, ...plan }], visits, events, hours: DEFAULT_WORK_HOURS, dailyDriveLimitMin: 300 });
  ok(m.get("v-SV-C")?.[0]?.text === "Double-booked — overlaps Board meeting (10:30–11:30)" && m.has("g-g-copy") && m.has("g-ics"),
    "site-visits agenda: a conflicting visit is badged on its own row and on every calendar copy of it");
  ok(!m.has("v-SV-Q") && !m.has("g-board"), "site-visits agenda: a visit without conflicts, and ordinary events, get no badge");
  ok(agendaConflicts({ me: "Dana", plans: [{ dayKey: DAY, ...plan }], visits, events: null, hours: DEFAULT_WORK_HOURS, dailyDriveLimitMin: 300 }).size === 0,
    "site-visits agenda: with no calendar, only visits can conflict");

  const read = (p: string) => readFileSync(p, "utf8");
  const agenda = read("src/lib/agenda.ts");
  ok(/if \(!visitPeople\(v\)\.includes\(me\)\) continue;/.test(agenda) && !agenda.includes("v.assignedTo !== me"),
    "site-visits agenda: a visit shows on its lead's and every attendee's agenda");
  ok(/visitEventIds\(v\)\.some\(\(id\) => fetchedIds\.has\(id\)\)/.test(agenda), "site-visits agenda: a visit already on my Google calendar (any copy) isn't shown twice");
  ok(/agendaConflicts\(/.test(agenda) && /it\.conflicts = /.test(agenda) && (agenda.match(/await allVisits\(\)/g) ?? []).length === 1,
    "site-visits agenda: badges come from the same plans and the one site_visits read");
  ok(/plans\b/.test(read("src/lib/drive-sync/agenda.ts").split("return {").pop() ?? ""), "site-visits agenda: the drive layer hands its plans back");
  ok(read("src/app/(app)/calendar/calendar-client.tsx").includes("<ConflictBadge") && read("src/app/(app)/home-calendar.tsx").includes("<ConflictBadge"),
    "site-visits agenda: /calendar and the Home agenda show the badge");
}
```

Wire it: add `siteVisitsAgendaChecks` to the harness import and `.then(() => siteVisitsAgendaChecks(ok))` after `.then(() => siteVisitsEditPins(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/visit-plan/agenda'`.

- [ ] **Step 3: Implement `src/lib/visit-plan/agenda.ts`**

```ts
/**
 * Conflict badges for the viewer's own agenda (spec 2026-10-09 site-visit
 * scheduling, "Calendar + visit"). Pure: works off the drive layer's plans
 * for the viewer's days, so a page view reads no one else's calendar.
 */
import type { DriveLeg } from "@/lib/drive-plan/plan";
import { isVisitIcsCopy, type DriveStop } from "@/lib/drive-plan/stops";
import { busyBlocks, toBusyVisit, type BusyEvent, type VisitForBusy } from "./busy";
import { stopConflicts, type Conflict } from "./check";
import type { WorkHours } from "./settings";

export function agendaConflicts(args: {
  me: string;
  plans: ReadonlyArray<{ dayKey: string; stops: DriveStop[]; legs: DriveLeg[] }>;
  visits: readonly VisitForBusy[];
  events: readonly BusyEvent[] | null;
  hours: WorkHours;
  dailyDriveLimitMin: number;
}): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>();
  const busyVisits = args.visits.map(toBusyVisit);
  for (const p of args.plans) {
    for (const s of p.stops) {
      if (s.kind !== "visit") continue;
      const id = s.key.slice("sv:".length);
      const busy = busyBlocks({ person: args.me, visits: busyVisits, events: args.events, excludeVisitId: id });
      const { conflicts } = stopConflicts({ stopKey: s.key, dayKey: p.dayKey, stops: p.stops, legs: p.legs, busy, hours: args.hours, dailyDriveLimitMin: args.dailyDriveLimitMin });
      if (!conflicts.length) continue;
      out.set("v-" + id, conflicts);
      const eventIds = busyVisits.find((v) => v.id === id)?.eventIds ?? [];
      for (const e of args.events ?? []) if (isVisitIcsCopy(e, [{ id, eventIds }])) out.set("g-" + e.id, conflicts);
    }
  }
  return out;
}
```

- [ ] **Step 4: The drive layer returns its plans**

`src/lib/drive-sync/agenda.ts`:
1. Import `type DriveDayPlan` alongside `planDriveDays` from `@/lib/drive-plan/load`, and `import { visitEventIds } from "@/lib/visit-invite-plan";`.
2. Change the return type of `driveAgendaLayer` to `Promise<{ items: AgendaItem[]; addressFlags: Map<string, AddressFlag>; plans: DriveDayPlan[] }>` and its final line to `return { items, addressFlags, plans };`.
3. Replace the `eventIdOf` map with every copy id:

```ts
  const copyIds = new Map<string, string[]>();
  if (needVisits) for (const v of await visits()) { const ids = visitEventIds(v); if (ids.length) copyIds.set(v.id, ids); }
```

   and in the loop change the condition to `if (e.iCalUID === \`sv-${id}@peak-app\` || (copyIds.get(id) ?? []).includes(e.id)) addressFlags.set("g-" + e.id, flag);` (also update the comment above it: "A visit pushed straight to Google shows as that event — on anyone's calendar").

- [ ] **Step 5: `src/lib/agenda.ts`**

1. Imports: `import type { Conflict } from "@/lib/visit-plan/check";`, `import { visitPeople } from "@/lib/drive-plan/stops";`, `import { visitEventIds } from "@/lib/visit-invite-plan";`.
2. `AgendaItem`: after `addressFlag?` add:

```ts
  /** Spec 2026-10-09 site-visit scheduling — conflicts on one of MY visits
   *  (set on its "v-" row and on its Google copies). Flags only. */
  conflicts?: Conflict[];
```

3. In the visit loop, replace `if (v.assignedTo !== me) continue;` with:

```ts
    // Spec 2026-10-09 site-visit scheduling — the lead's AND every attendee's agenda.
    if (!visitPeople(v).includes(me)) continue;
```

   and replace `if (v.googleEventId && fetchedIds.has(v.googleEventId)) continue;` with:

```ts
    if (visitEventIds(v).some((id) => fetchedIds.has(id))) continue;
```

4. Inside the drive-layer `try`, after the `addressFlag` loop, add:

```ts
    // Spec 2026-10-09 site-visit scheduling — conflict badges on my visits,
    // from the same plans (my own day only; no one else's calendar is read).
    try {
      const [{ agendaConflicts }, prefs] = await Promise.all([import("@/lib/visit-plan/agenda"), import("@/lib/stores/schedule-prefs")]);
      const [settings, hours] = await Promise.all([prefs.getSchedulingSettings(), prefs.workHoursFor(userId)]);
      const conflicts = agendaConflicts({
        me,
        plans: layer.plans,
        visits: allVisitsList,
        events: calendarOn ? googleEvents : null,
        hours,
        dailyDriveLimitMin: settings.dailyDriveLimitMin,
      });
      for (const it of items) {
        const c = conflicts.get(it.key);
        if (c?.length) it.conflicts = c;
      }
    } catch (err) {
      console.error("[agenda] conflict badges failed:", err);
    }
```

- [ ] **Step 6: Render the badge**

`src/app/(app)/calendar/calendar-client.tsx` — `import ConflictBadge from "@/components/visit-booking/conflict-badge";`, then:

1. Replace `renderMonthChip` with:

```tsx
  function renderMonthChip(it: AgendaItem) {
    if (isDriveFlag(it)) return renderDriveFlag(it, true);
    if (!it.addressFlag && !it.conflicts?.length) return renderMonthChipBody(it);
    return (
      <div key={it.key}>
        {renderMonthChipBody(it)}
        {it.addressFlag && (
          <div style={{ marginBottom: 3 }}>
            <AddressFlagBadge flag={it.addressFlag} compact />
          </div>
        )}
        {it.conflicts?.length ? (
          <div style={{ marginBottom: 3 }}>
            <ConflictBadge conflicts={it.conflicts} compact />
          </div>
        ) : null}
      </div>
    );
  }
```

2. In the week/day timed block, directly after `{it.addressFlag && <div><AddressFlagBadge flag={it.addressFlag} compact /></div>}` add:

```tsx
                          {it.conflicts?.length ? <div><ConflictBadge conflicts={it.conflicts} compact /></div> : null}
```

`src/app/(app)/home-calendar.tsx` — `import ConflictBadge from "@/components/visit-booking/conflict-badge";`; next to the `const flag = …` declaration add:

```tsx
              const conflict = it.conflicts?.length ? (
                <span style={{ alignSelf: "center", marginRight: 17 }}>
                  <ConflictBadge conflicts={it.conflicts} />
                </span>
              ) : null;
```

and render `{conflict}` right after `{flag}`.

- [ ] **Step 7: Run the gates**

Run: `npx tsc --noEmit` → PASS.
Run: `env -u DATABASE_URL npm run test:specs` → 0 failures (spec 1's agenda pins included: one `await allVisits()`, the flags render).
Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/visit-plan/agenda.ts src/lib/agenda.ts src/lib/drive-sync/agenda.ts "src/app/(app)/calendar/calendar-client.tsx" "src/app/(app)/home-calendar.tsx" scripts/test-site-visits.ts` → 0 errors.
Run: `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/visit-plan/agenda.ts src/lib/agenda.ts src/lib/drive-sync/agenda.ts "src/app/(app)/calendar/calendar-client.tsx" "src/app/(app)/home-calendar.tsx" scripts/test-site-visits.ts scripts/test-review-and-spec.ts
git commit -m "feat(site-visits): attendee visits on the agenda; conflict badges on /calendar and Home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Final gates + docs (DECISIONS, PUNCHLIST, AGENTS)

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the decision log, the punch item and the phase entry; a clean final gate run.

- [ ] **Step 1: Merge main and recompute numbers**

```bash
git fetch origin
git merge origin/main   # resolve conflicts keep-both; re-run every gate after
git show origin/main:DECISIONS.md | grep -oE '^#+ *D[0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1
git show origin/main:PUNCHLIST.md | grep -oE '#[0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1
```

Next decision number = the first printed number + 1 (call it `Dn`); punch number = the second + 1 (expected `#326` — use what the command says). If this branch's own merged spec-1 entries already took numbers above main's, start after the highest of either.

- [ ] **Step 2: Full gate run**

Run, and record the real numbers for the report:
- `npx tsc --noEmit` → 0 errors.
- `df -h .` (free space for temp datadirs), then `env -u DATABASE_URL npm run test:specs` → 0 failures; note the PASS count (= base + the `site-visits:` lines).
- `npx eslint --ignore-pattern scripts/test-review-and-spec.ts $(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx')` → 0 errors (compare warnings against a `git stash`-free baseline: run the same command on `origin/main` in a scratch worktree if needed — never `git stash`, it is shared across worktrees).
- `npm run build` → succeeds.
- Stop any dev server (`lsof -i :3000`), then `npm run test:smoke` → all routes pass.

- [ ] **Step 3: DECISIONS.md**

Append (replace `Dn` with the computed numbers, in order):

```markdown
### Dn — Site-visit attendees and per-recipient invites (spec 2026-10-09 site-visit scheduling)
A visit keeps one lead (`assignedTo`) and gains `attendees: string[]` (names, never the lead), normalized on read — no migration. `visitPeople()` stays the one place that decides who a visit is a stop for, so every attendee gets their own drive chain and re-sync. Invites are recorded per recipient in `SiteVisit.invites` (channel, Google event id, the times that person was told, .ics SEQUENCE); a pre-spec-2 `invite`/`googleEventId` reads as one entry for the lead, and the lead's entry keeps mirroring into those fields for older readers. Each person gets a direct Google Calendar event when their mailbox has the Calendar grant (D77 kept), else the emailed .ics — the spec said .ics for everyone; D77 means people with the grant see it instantly, and the UID stays `sv-<id>@peak-app`. Add → invite, remove → calendar delete / `METHOD:CANCEL` (same UID), move → PATCH / .ics with SEQUENCE + 1. Only a NEW recipient is subject to the Account invite toggle; updates and cancels always go to someone already holding a copy. A failed send is not recorded (retried on the next save); a failed update/cancel keeps the old entry (retried).

### Dn+1 — What counts as busy, and the calendar-read notes
Double-booked counts the person's scheduled visits and their accepted or own timed Google events. Tentative, unanswered, declined and all-day events, the app's drive events and any calendar copy of a visit are not busy (the spec said "accepted"; tentative is not accepted). An unreadable calendar says "Couldn't check Dana's calendar" and never shows "No conflicts"; a person with no connected calendar is checked against visits only and says "Dana has no connected calendar — checked visits only" (the spec named only the failure case).

### Dn+2 — Conflict rules in detail
The drive-to block counts for Double-booked; the drive home counts for work hours only when the visit is the day's last stop. Back-to-back is not an overlap. Too much driving = the day's leg minutes with this visit, buffer included; flagged legs count 0. Work hours are Chicago wall-clock (DST-safe); a non-work day reads "Outside work hours — Saturday isn't a work day".

### Dn+3 — Nearby days in detail
Days run today → today + look-ahead − 1 (Chicago). Only the lead's verified stops count; minutes are stop → candidate, routed only (geo_cache / OSRM). A straight-line distance at an 80 mph bound skips stops too far to route and is never shown. Each other attendee's free/conflict is the chosen time of day moved to that date; with no time picked yet, free = a work day with nothing booked inside their work hours. "Nearby days unavailable" when plausible stops had no drive time and nothing could be suggested.

### Dn+4 — Where the checks run and what they cost
Booking check: addresses in cache mode (the booking UI's own address check geocodes), each person's calendar read once, live OSRM under one 10 s budget, debounced 800 ms. /calendar and Home badge only the viewer's own visits from the drive layer's existing plans (no other calendar read on a page view). The company record lazy-loads badges for up to 10 upcoming scheduled visits, for every person on each. Editing lives on the company record (visits have no detail page); a visit with no customer yet gains Edit once its lead converts.

### Dn+5 — Scheduling settings
`schedule_defaults` gains `workHours` (Mon–Fri 8:00–5:00), `sameAreaMin` (45, 5–180), `dailyDriveLimitMin` (300, 30–960), `nearbyLookaheadDays` (21, 1–60); `schedule_prefs:<userId>` gains `workHours | null`. Settings → Field (admin) and Account. Admin saves refuse bad input instead of storing a fallback; a bad stored value reads as its default.
```

- [ ] **Step 4: PUNCHLIST.md and AGENTS.md**

PUNCHLIST — add under the open/shipped section matching the spec-1 entry's style:

```markdown
- [x] **#326 Site-visit scheduling** (spec `docs/superpowers/specs/2026-10-09-site-visit-scheduling-design.md`, plan `docs/superpowers/plans/2026-10-10-site-visit-scheduling.md`, Dn–Dn+5) — attendees, per-recipient invites (add/update/cancel, one UID), conflict flags (double-booked, tight, outside hours, too much driving), Nearby days from the lead's next 21 days, booking panel on visit requests / Inbox / Edit visit, badges on the company record, /calendar and Home. Jeff-gated: set company work hours and the three limits in Settings → Field; each person checks their own hours in Account; try a booking with an attendee whose calendar is connected and one whose isn't.
```

AGENTS.md — add a phase entry after the last numbered one (same voice as its neighbours):

```markdown
43. ✅ **Site-visit scheduling** (#326, Dn–Dn+5) — visits are fixed appointments with a lead + `attendees` (each gets their own drive chain via `visitPeople`); per-recipient invites in `SiteVisit.invites` (`src/lib/visit-invite-plan.ts` plans add/update/cancel; `visit-invite.ts` delivers — calendar event when granted, else .ics, UID `sv-<id>@peak-app`); a pure engine `src/lib/visit-plan/` (work hours, busy blocks, `checkVisit`, `suggestDays`, `agendaConflicts`) behind `visit-plan/load.ts`; the booking panel (`src/components/visit-booking/`) on the visit-requests scheduler, the Inbox dialog and the company record's Edit; conflict badges on the company record, /calendar and Home; settings in Settings → Field + Account. Nothing moves or blocks a visit; nothing is stored for conflicts. Remaining is Jeff-gated: the settings values and a real booking with attendees. Punch #326.
```

(Use the real phase number: one more than the last numbered phase in AGENTS.md at merge time.)

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(site-visits): decisions, punch item, phase entry for site-visit scheduling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

**Spec coverage**

| Spec requirement | Task |
|---|---|
| `assignedTo` stays lead; `attendees: string[]`, normalized on read, no migration | 1 |
| Visit is a stop on the lead's and every attendee's day | 1 (via `visitPeople`), 2 (calendar-copy dedupe), 10 (agenda) |
| `.ics` to every attendee; add → invite, remove → CANCEL same UID, move → update; UID `sv-<id>@peak-app`; per-recipient stamp; legacy stamp reads as one entry | 2 |
| Settings: work hours (admin + Account override), same area 45, drive limit 5 h incl. buffer, look-ahead 21 | 3 |
| `checkVisit`: double-booked (incl. drive block; accepted timed events; all-day ignored), tight, outside hours (incl. drive back, non-work day), too much driving ("5h 40m of 5h") | 4 |
| Unverified address: not a conflict, no drive checks, "checked without drive time" | 4, 6 |
| `suggestDays`: lead's verified stops within same-area minutes; nearest then soonest; max 5; row text; other attendees free/conflict; straight-line pre-filter never shown; unverified copy | 5, 6 |
| Computed live, nothing stored | 6, 7, 10 |
| Booking screen: attendee picker, Nearby days strip (fills the date), debounced live conflicts — on visit requests, Inbox, editing a visit; nothing blocks Schedule | 8, 9 |
| Conflict badge on the visit and its calendar block (/calendar + agenda) | 9, 10 |
| Failures: "Couldn't check Dana's calendar"; OSRM down → "Nearby days unavailable" | 4, 5, 6 |
| Tests listed in the spec | 1, 2, 4, 5, 6 |

Out of scope, as the spec says: auto-moving, auto-picking a time, backlog clustering, a conflicts bell group, arrival windows, spec 3. Triage could later show conflicts through its visit-flags hook (`src/lib/triage/hooks.ts`); not done here.

**Names used across tasks:** `cleanAttendees`/`readAttendees`/`MAX_ATTENDEES` (1) · `VisitInviteRecipient`, `normalizeInvites`, `planInviteChanges`, `visitEventIds`, `visitUid`, `inviteSummary`, `InviteStatus`, `RecipientResult` (2) · `dispatchVisitInvite(rec, me, deps?)`, `cancelVisitInvites`, `InviteDeps`, `setVisitInvites` (2) · `WorkHours`, `SchedulingSettings`, `DEFAULT_SCHEDULING`, `DEFAULT_WORK_HOURS`, `getSchedulingSettings`, `workHoursFor` (3) · `BusyBlock`, `busyBlocks`, `toBusyVisit`, `VisitForBusy`, `stopConflicts`, `checkVisit`, `Conflict`, `CONFLICT_LABEL`, `CalendarRead`, `PersonCheck` (4) · `suggestDays`, `nearbyPairs`, `NearbyResult`, `NEARBY_TEXT`, `nearbyLine` (5) · `loadBookingCheck(input, opts?, deps?)`, `BookingCheckInput`, `BookingCheckResult`, `BOOKING_ROUTE_BUDGET_MS` (6) · `cleanBookingInput`, `bookingCheckAction`, `updateVisitAction`, `visitConflictSummariesAction` (7) · `BookingPanel`, `useBookingCheck`, `BOOKING_CHECK_DEBOUNCE_MS` (8) · `ConflictBadge`, `VisitEditDialog`/`VisitEditVM`, `EditVisitButton`, `VisitConflictProvider`/`VisitConflictChip` (9) · `agendaConflicts`, `AgendaItem.conflicts` (10).
