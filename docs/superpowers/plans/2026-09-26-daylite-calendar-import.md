# Daylite Calendar Import (#219) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Daylite's `Calendar Events.tsv` one-off events into each owner's own primary Google Calendar (repeating series skipped). The import is admin-only, runs as a preview and then a confirmed run, resumes after a stop, and never writes the same event twice.

**Architecture:** One pure module (`src/lib/daylite/calendar-events.ts`) parses, classifies, keys and builds Google event bodies. A second module (`src/lib/daylite/calendar-batch.ts`) builds the preview, selects the pending events and runs one budgeted batch. It stays pure because `insert` / `record` / `now` are injected. A thin server module (`src/lib/daylite/calendar-import.ts`) wires in the roster, the mailbox connections, the `dayliteCalendarImport` blob and a new `insertZonedEvent` in `src/lib/google/calendar.ts`. Two admin-gated server actions and a client page at `/import/daylite/calendar` sit on top. The page re-posts the file text until the run is done, the same way the Daylite history import does.

**Tech Stack:** Next.js 16 App Router (server components and server actions), TypeScript, the doc-store `blobs` table (`getBlob`/`setBlob`), the Google Calendar v3 REST client in `src/lib/google/calendar.ts`, and the `scripts/test-review-and-spec.ts` assertion harness (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-09-26-daylite-calendar-import-design.md`

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Start every shell with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`.
- Do not run `npm run dev`, `npm run build` (it runs `scripts/migrate.mjs` first) or any `db:*` / `tsx` script. `npm run test:specs` uses its own `mktemp -d` datadir and is safe. For the build gate, use `npx next build`.
- Business time zone: `America/Chicago`. Timed events go to Google as a local `dateTime` (no offset) plus `timeZone: "America/Chicago"`. They are never converted through UTC or epoch-ms.
- Series rule: owner + name, compared case- and space-insensitively, occurring **≥ 4** times. Every row of a series is skipped.
- All-day rule: `Duration (HH:MM)` ≥ `24:00` **and** a midnight start makes an all-day event spanning `ceil(minutes / 1440)` days, with Google's `end.date` exclusive. Anything else is timed for that many minutes, and `00:00` becomes 60.
- Summary is `[Category] Name`, or just `Name` when Category is blank. Description is Details, then `Linked: <linked>` when set, then `Imported from Daylite`, with the non-empty parts joined by a blank line.
- Dedup blob: the id is `dayliteCalendarImport`, stored in the doc-store `blobs` table via `getBlob`/`setBlob`, with one top-level key per event: `{ [eventKey]: { eventId, owner, at } }`. A re-run skips recorded keys.
- An event is written only to the **matched owner's own** mailbox (`personalKey(user.id)`), and only when that mailbox's grant includes `CALENDAR_SCOPE`. Unmatched or unconnected owners are reported and skipped.
- Admin gate: every server action and the page call `requirePerm("manage_users")` as their first statement, outside any `try`.
- A `"use client"` file never imports a value from `@/lib/stores/*`, `@/db/*`, `@/lib/users`, `@/lib/daylite/calendar-import` or `@/lib/daylite/calendar-batch`. `import type` is fine, and the client takes its types from `./actions`.
- Harness assertions are labelled `#219 …`. Harness imports use `dc219` / `219`-suffixed aliases, because the file already imports `setBlob` and many other common names.
- Gates at the end of every task:
  - `npx tsc --noEmit` → 0 errors.
  - `npm run test:specs` → 0 `FAIL`; report the PASS count.
  - `npx eslint <changed files>` → 0 errors.
  - Task 3 also runs `npx next build` → exit 0.
- Commits: `feat(import): … (#219)`, then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` only the files the task names. On `index.lock`, wait 3 s and retry.
- No DECISIONS.md / PUNCHLIST.md edits.
- The test fixture copies 13 rows from the real export: 11 real rows plus 2 synthetic bad rows. Meeting-link URLs and a phone number in Details are redacted. Never commit the whole file.

## Spec ambiguities resolved (read before starting)

1. **`insertEvent` cannot keep wall-clock times.** It takes epoch-ms and sends `new Date(ms).toISOString()` (UTC). The spec says times are "sent to Google with that `timeZone`, never converted through UTC". So `calendar.ts` gains a sibling, `insertZonedEvent(mailboxKey, body)`. It uses the same `gcal()` token path and the same primary calendar, with `sendUpdates=none`. `insertEvent` is untouched.
2. **Deterministic Google event id.** Each body carries `id: "dlc" + eventKey`, where the key is 24 lowercase hex characters. All of them are in Google's base32hex alphabet `a–v0–9`. If the blob write is lost after a successful insert, the next insert gets **409**. That 409 is recorded as "already in Google", not duplicated.
3. **Resume and failed rows.** A non-quota Google error on one event is not recorded. Its key comes back in `failedKeys`, and the client sends the growing list back as `skipKeys`, so one bad event can't loop forever. A page reload clears the list, so failures are retried then.
4. **Owner stop.** After 5 consecutive failures for one owner in one batch (for example a revoked token), that owner stops for the rest of the run. The owner is returned in `stoppedOwners`, and the client drops them from `owners`.
5. **Quota.** `isRateLimit` (from `src/lib/gmail/config.ts`) also matches `quotaExceeded` and "usage limits exceeded". Either one stops the batch immediately, leaves the event unrecorded and not failed, and the client pauses with a Resume button.
6. **Budget.** Each request has 45 s. A new insert starts only while `elapsed + 7 s` (5 s call timeout plus token refresh) fits in the budget. The first insert of a request always runs. The page has `maxDuration = 60`.
7. **Upload size.** The spec says ≤ 5 MB, but the text travels in a server-action body capped at 1,200 kb (`next.config.ts`). The page therefore uses the history import's caps: 1,100,000 characters, and 1,180,000 JSON-encoded bytes on the client. The real file is 0.3 MB.
8. **Parser.** The file uses Daylite's `\"` escape inside quoted fields (4 occurrences), which `history.ts`'s `parseTsv` would mangle. `calendar-events.ts` therefore has its own `splitTsv`, which also tracks physical line numbers. `parseTsv` is not touched, because the history import depends on it.
9. **Owner matching** runs against **active** users only. The exact case-insensitive full name is tried first, then first + last token. More than one match is reported as an ambiguity and treated as no match.
10. **"Only events from today on"** compares each event's start date with today's date in `America/Chicago`.
11. **Duplicate rows.** Identical owner + name + start + duration collapses to one key, so the event is imported once. The preview counts the rest as `duplicates`.
12. **Status** (`Confirmed` / `Completed`) is parsed but does not change the import.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/daylite/calendar-events.ts` | create | pure: `splitTsv`, `parseStart`, `parseDurationHHMM`, `parseCalendarTsv`, `classify`, `eventKey`, `googleEventId`, `googleEventFor`, `addMinutes`, `ymd`, `matchOwner`, `todayYmdIn`, types |
| `src/lib/daylite/calendar-batch.ts` | create | pure with injected deps: `sanitizeImported`, `planOneOffs`, `buildPreview`, `selectPending`, `isQuotaStop`, `isAlreadyExists`, `runCalendarBatch`, constants, types |
| `src/lib/daylite/calendar-import.ts` | create | server: `loadImported`, `calendarStates`, `previewCalendarImport`, `importCalendarBatch` |
| `src/lib/google/calendar.ts` | modify (append) | `ZonedEventTime`, `ZonedEventBody`, `insertZonedEvent` |
| `src/app/(app)/import/daylite/calendar/actions.ts` | create | `"use server"`: `previewCalendarAction`, `importCalendarBatchAction` |
| `src/app/(app)/import/daylite/calendar/page.tsx` | create | admin page shell, `maxDuration = 60` |
| `src/app/(app)/import/daylite/calendar/calendar-client.tsx` | create | client: upload → preview → resumable import with progress |
| `src/app/(app)/import/daylite/page.tsx` | modify | link to `/import/daylite/calendar` |
| `scripts/test-review-and-spec.ts` | modify (append + one chain line) | `#219` blocks |

---

### Task 1: Pure parser, classifier, keys, bodies, owner matching

**Files:**
- Create: `src/lib/daylite/calendar-events.ts`
- Modify: `scripts/test-review-and-spec.ts` (append one sync block at EOF)

**Interfaces:**
- Consumes: `norm` from `src/lib/daylite/ids.ts` (`(s: string) => string`: trim, lowercase, collapse whitespace).
- Produces (all exported from `@/lib/daylite/calendar-events`):
  - `BUSINESS_TZ = "America/Chicago"`, `SERIES_MIN = 4`
  - `type WallClock = { y; m; d; hh; mm }` (numbers)
  - `type DayliteEvent = { line: number; owner: string; name: string; category: string; start: WallClock; durationMin: number; allDay: boolean; linked: string; details: string; status: string }`
  - `type ParseError = { line: number; reason: string }`
  - `type ParsedCalendar = { rows: DayliteEvent[]; errors: ParseError[] }`
  - `type SeriesGroup = { owner: string; name: string; count: number }`
  - `type RosterUser = { id: string; name: string }`
  - `type OwnerMatch = { ok: true; user: RosterUser } | { ok: false; reason: string }`
  - `type ZonedTime = { dateTime: string; timeZone: string } | { date: string }`
  - `type WallClockEventBody = { id: string; summary: string; description: string; start: ZonedTime; end: ZonedTime }`
  - `splitTsv(text: string): { line: number; cells: string[] }[]`
  - `parseStart(raw: string): WallClock | null`
  - `parseDurationHHMM(raw: string): number | null`
  - `parseCalendarTsv(text: string): ParsedCalendar`
  - `classify(rows: DayliteEvent[]): { oneOffs: DayliteEvent[]; series: SeriesGroup[] }`
  - `seriesKey(e: { owner: string; name: string }): string`
  - `ymd(w: { y: number; m: number; d: number }): string`
  - `addMinutes(w: WallClock, minutes: number): WallClock`
  - `eventKey(e: Pick<DayliteEvent, "owner" | "name" | "start" | "durationMin">): string` (24 hex)
  - `googleEventId(key: string): string` (`"dlc" + key`)
  - `googleEventFor(e: DayliteEvent, timeZone?: string): WallClockEventBody`
  - `matchOwner(owner: string, users: RosterUser[]): OwnerMatch`
  - `todayYmdIn(nowMs: number, timeZone?: string): string`

- [ ] **Step 0: Record the harness baseline**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
ps aux | grep -E "tsx|next dev" | grep -v grep || echo "no strays"
npm run test:specs > "${TMPDIR:-/tmp}/specs-219-base.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-219-base.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-219-base.log"; tail -1 "${TMPDIR:-/tmp}/specs-219-base.log"
```

Expected: `exit 0`, a PASS count (write it down as BASE), no FAIL lines, `ALL PASSED`.

- [ ] **Step 1: Write the failing tests**

Append this block to the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ====== #219 Daylite calendar import — Task 1: parser, classifier, keys, bodies, owners (pure) ======
   Fixture: 11 rows copied from Dropbox "Calendar Events.tsv" (meeting-link
   URLs and a phone number redacted) plus 2 synthetic bad rows. Physical
   lines: header 1; Weekly Sales Meeting ×4 = 2–5; Jena 6; Christmas 7;
   Lincoln 8; RCA 9; Oshkosh 10; Mike 11; Sauk 12; bad date 13; bad duration 14. */
import {
  parseCalendarTsv as dc219Parse,
  splitTsv as dc219Split,
  parseStart as dc219Start,
  classify as dc219Classify,
  eventKey as dc219Key,
  googleEventId as dc219GId,
  googleEventFor as dc219Body,
  matchOwner as dc219Match,
  todayYmdIn as dc219Today,
  addMinutes as dc219Add,
  type DayliteEvent as DC219Event,
} from "@/lib/daylite/calendar-events";

const DC219_FIXTURE =
  [
    "Duration (HH:MM)\t\tCategory\tStart Date\tStatus\tName\t\tDuration\tLinked\tOwner\tDetails\t",
    '01:00\t\t\t"12/25/28, 9:00 AM"\tConfirmed\t"Weekly Sales Meeting"\t\t"1 hour"\t\t"Jeff Chesebro"\thttps://meet.google.com/redacted\t',
    '01:00\t\t\t"12/18/28, 9:00 AM"\tConfirmed\t"Weekly Sales Meeting"\t\t"1 hour"\t\t"Jeff Chesebro"\thttps://meet.google.com/redacted\t',
    '01:00\t\t\t"12/11/28, 9:00 AM"\tConfirmed\t"Weekly Sales Meeting"\t\t"1 hour"\t\t"Jeff Chesebro"\thttps://meet.google.com/redacted\t',
    '01:00\t\t\t"12/4/28, 9:00 AM"\tConfirmed\t"Weekly Sales Meeting"\t\t"1 hour"\t\t"Jeff Chesebro"\thttps://meet.google.com/redacted\t',
    '24:00\t\tPTO\t"9/25/26, 12:00 AM"\tConfirmed\t"Jena Off"\t\t"1 day"\t\t"Jena Tolksdorf"\t\t',
    '48:00\t\t\t"12/24/26, 12:00 AM"\tConfirmed\t"Christmas Holiday"\t\t"2 days"\t\t"Jason Keagy"\t\t',
    '00:30\t\t\t"9/16/26, 2:00 PM"\tConfirmed\t"Lincoln Academy Submittal Review"\t\t"30 minutes"\t"LINCOLN  ACADEMY BELOIT (via MainStage) - Gymnatorium AV, LINCOLN  ACADEMY BELOIT (via MainStage) - Gymnatorium AV"\t"Jason Keagy"\thttps://teams.microsoft.com/meet/redacted\t',
    '32:00\t\tInstall\t"2/11/26, 8:00 AM"\tConfirmed\t"RCA Wire Pulls (Mark, Paul, AJ, Nelson)"\t\t"1 day 8 hours"\t"RICHLAND CENTER HS (via Nexus Solutions) - Auditorium AV"\t"Andrew Herschleb"\t\t',
    '01:30\t\t\t"2/11/26, 12:30 PM"\tConfirmed\t"Oshkosh North Aud & Black Box Projects - First AV Conversation including \\"Shelby\\""\t\t"1 hour 30 minutes"\t"BRAY ARCHITECTS - OSHKOSH NORTH HS - Auditorium & Black Box AV"\t"Jason Keagy"\thttps://teams.microsoft.com/meet/redacted\t',
    '01:00\t\t"Service Call"\t"5/18/26, 8:00 AM"\tConfirmed\t"Mike to Cross Of Christ 8:00 am"\t\t"1 hour"\t\t"Mike Mundth"\t\t',
    '01:00\t\t"Service Call"\t"9/16/26, 9:00 AM"\tConfirmed\t"Sauk Trail Elementary, Middleton HS "\t\t"1 hour"\t\t"Isaac Mittlesteadt"\t"Elementary - mute/unmute passcode   HS - Bluetooth issue, confirm replacement"\t',
    '01:00\t\t\t"13/45/26, 9:00 AM"\tConfirmed\t"Broken date"\t\t"1 hour"\t\t"Jeff Chesebro"\t\t',
    'soon\t\t\t"9/1/26, 9:00 AM"\tConfirmed\t"Broken duration"\t\t""\t\t"Jeff Chesebro"\t\t',
  ].join("\n") + "\n";

{
  const j = (v: unknown) => JSON.stringify(v);

  // splitTsv — tabs inside quotes, "" and \" escapes, physical line numbers.
  const t1 = dc219Split('a\t"b\tc"\n"x ""y"" \\"z\\""\tw\n"p\nq"\tr\ns\tt\n');
  ok(j(t1.map((r) => r.cells)) === j([["a", "b\tc"], ['x "y" "z"', "w"], ["p\nq", "r"], ["s", "t"]]), "#219 splitTsv: tabs in quotes, doubled and backslash-escaped quotes");
  ok(j(t1.map((r) => r.line)) === j([1, 2, 3, 5]), "#219 splitTsv: a quoted newline advances the physical line number");
  ok(dc219Split("﻿h1\th2\n\n").length === 1, "#219 splitTsv: BOM stripped, blank lines dropped");

  // parseStart — U+202F and plain spaces, 12 AM/PM, bad dates.
  ok(j(dc219Start("12/25/28, 9:00 AM")) === j({ y: 2028, m: 12, d: 25, hh: 9, mm: 0 }), "#219 parseStart: U+202F before AM");
  ok(dc219Start("12/25/28, 12:00 PM")?.hh === 12 && dc219Start("1/2/25, 12:05 AM")?.hh === 0, "#219 parseStart: 12 PM is noon, 12 AM is midnight");
  ok(j(dc219Start("3/1/2027, 7:15 pm")) === j({ y: 2027, m: 3, d: 1, hh: 19, mm: 15 }), "#219 parseStart: four-digit year and lowercase pm");
  ok(dc219Start("2/30/26, 9:00 AM") === null && dc219Start("13/45/26, 9:00 AM") === null && dc219Start("") === null, "#219 parseStart: impossible dates are null");

  // parseCalendarTsv over the fixture.
  const p = dc219Parse(DC219_FIXTURE);
  ok(p.rows.length === 11 && p.errors.length === 2, "#219 parse: 11 readable rows, 2 errors");
  ok(j(p.errors.map((e) => e.line)) === "[13,14]" && /start date/.test(p.errors[0].reason) && /duration/.test(p.errors[1].reason), "#219 parse: bad rows reported with their line and reason");
  const byName = (s: string) => p.rows.find((r) => r.name.startsWith(s))!;
  const jena = byName("Jena Off");
  ok(jena.allDay && jena.durationMin === 1440 && jena.category === "PTO" && jena.line === 6 && j(jena.start) === j({ y: 2026, m: 9, d: 25, hh: 0, mm: 0 }), "#219 parse: 24:00 at midnight is a one-day all-day event");
  const xmas = byName("Christmas");
  ok(xmas.allDay && xmas.durationMin === 2880, "#219 parse: 48:00 at midnight is a multi-day all-day event");
  const lincoln = byName("Lincoln Academy");
  ok(!lincoln.allDay && lincoln.durationMin === 30 && lincoln.start.hh === 14 && lincoln.linked.startsWith("LINCOLN  ACADEMY") && lincoln.category === "", "#219 parse: a timed 30-minute row with Linked kept verbatim and a blank Category");
  const rca = byName("RCA Wire Pulls");
  ok(!rca.allDay && rca.durationMin === 1920 && rca.category === "Install", "#219 parse: 32:00 from 8 AM stays a timed event (not midnight)");
  ok(byName("Oshkosh").name.endsWith('including "Shelby"'), "#219 parse: Daylite's \\\" escape becomes a plain quote");
  ok(byName("Mike to Cross").category === "Service Call" && byName("Mike to Cross").owner === "Mike Mundth", "#219 parse: a quoted Category is unquoted");
  const sauk = byName("Sauk Trail");
  ok(sauk.name === "Sauk Trail Elementary, Middleton HS" && sauk.details.includes("passcode   HS"), "#219 parse: cells trimmed, inner spacing in Details kept");
  const missing = dc219Parse("Start Date\tName\n1/1/26, 9:00 AM\tX\n");
  ok(missing.rows.length === 0 && missing.errors.length === 1 && /Owner/.test(missing.errors[0].reason), "#219 parse: a file without the required columns is refused by name");

  // classify — the series threshold.
  const c = dc219Classify(p.rows);
  ok(c.series.length === 1 && j(c.series[0]) === j({ owner: "Jeff Chesebro", name: "Weekly Sales Meeting", count: 4 }) && c.oneOffs.length === 7, "#219 classify: 4 × same owner + name is a series; the other 7 are one-offs");
  const ev = (over: Partial<DC219Event>): DC219Event => ({ line: 0, owner: "Pat Lee", name: "Payroll", category: "", start: { y: 2026, m: 1, d: 1, hh: 9, mm: 0 }, durationMin: 60, allDay: false, linked: "", details: "", status: "", ...over });
  const three = [ev({}), ev({ name: "payroll" }), ev({ name: " PAYROLL " })];
  ok(dc219Classify(three).series.length === 0 && dc219Classify(three).oneOffs.length === 3, "#219 classify: 3 occurrences is not a series");
  const four = [...three, ev({ owner: "pat  lee" })];
  ok(dc219Classify(four).series.length === 1 && dc219Classify(four).oneOffs.length === 0, "#219 classify: the 4th occurrence (case/space-insensitive owner + name) makes all four a series");

  // eventKey — stable, normalized, 24 hex; the Google id is base32hex.
  const weekly = p.rows.find((r) => r.name === "Weekly Sales Meeting" && r.start.d === 25)!;
  ok(dc219Key(weekly) === "07afd50421a5cd9d115777d1", "#219 eventKey: golden value (sha256 of owner|name|start|durationMin, normalized) — never change it, the dedup blob depends on it");
  ok(dc219Key({ ...weekly, name: "  weekly  SALES meeting " }) === dc219Key(weekly), "#219 eventKey: name case and spacing do not change the key");
  ok(dc219Key({ ...weekly, durationMin: 90 }) !== dc219Key(weekly) && dc219Key({ ...weekly, owner: "Jason Keagy" }) !== dc219Key(weekly) && dc219Key({ ...weekly, start: { ...weekly.start, mm: 30 } }) !== dc219Key(weekly), "#219 eventKey: owner, start and duration each change the key");
  ok(/^[a-v0-9]{5,1024}$/.test(dc219GId(dc219Key(weekly))) && dc219GId("abc").startsWith("dlc"), "#219 googleEventId: dlc + key is a valid Google event id");

  // addMinutes — wall-clock arithmetic, no zone applied.
  ok(j(dc219Add({ y: 2026, m: 3, d: 8, hh: 1, mm: 30 }, 60)) === j({ y: 2026, m: 3, d: 8, hh: 2, mm: 30 }), "#219 addMinutes: wall-clock math ignores the DST jump (Google applies the zone)");
  ok(j(dc219Add({ y: 2025, m: 12, d: 31, hh: 23, mm: 30 }, 60)) === j({ y: 2026, m: 1, d: 1, hh: 0, mm: 30 }), "#219 addMinutes: crosses a year boundary");

  // googleEventFor — summary, description, all-day vs timed.
  const bJena = dc219Body(jena);
  ok(j(bJena.start) === j({ date: "2026-09-25" }) && j(bJena.end) === j({ date: "2026-09-26" }) && bJena.summary === "[PTO] Jena Off" && bJena.description === "Imported from Daylite", "#219 body: one-day all-day, exclusive end date, [Category] prefix");
  ok(j(dc219Body(xmas).end) === j({ date: "2026-12-26" }), "#219 body: a 2-day all-day event ends (exclusive) two days later");
  const bLin = dc219Body(lincoln);
  ok(j(bLin.start) === j({ dateTime: "2026-09-16T14:00:00", timeZone: "America/Chicago" }) && j(bLin.end) === j({ dateTime: "2026-09-16T14:30:00", timeZone: "America/Chicago" }), "#219 body: timed events are local wall-clock + America/Chicago, never UTC");
  ok(bLin.summary === "Lincoln Academy Submittal Review" && bLin.description === lincoln.details + "\n\nLinked: " + lincoln.linked + "\n\nImported from Daylite", "#219 body: no category → no prefix; description = details, Linked, footer");
  ok(bLin.id === "dlc" + dc219Key(lincoln), "#219 body: carries the deterministic Google id");
  ok(dc219Body(rca).end && j(dc219Body(rca).end) === j({ dateTime: "2026-02-12T16:00:00", timeZone: "America/Chicago" }), "#219 body: a 32-hour timed event ends the next day at 16:00");

  // matchOwner — exact, then first + last, never ambiguous.
  const roster = [
    { id: "u1", name: "Jeff Chesebro" },
    { id: "u2", name: "Jason M. Keagy" },
    { id: "u3", name: "Chris Mittlesteadt" },
    { id: "u4", name: "Isaac Mittlesteadt" },
  ];
  const m1 = dc219Match("jeff  chesebro", roster);
  ok(m1.ok && m1.user.id === "u1", "#219 matchOwner: exact full name, case/space-insensitive");
  const m2 = dc219Match("Jason Keagy", roster);
  ok(m2.ok && m2.user.id === "u2", "#219 matchOwner: first + last token when the roster has a middle initial");
  const m3 = dc219Match("Isaac Mittlesteadt", roster);
  ok(m3.ok && m3.user.id === "u4", "#219 matchOwner: a shared last name does not confuse two people");
  const m4 = dc219Match("Mike Mundth", roster);
  ok(!m4.ok && /No team member/.test(m4.reason), "#219 matchOwner: no user → reported, not guessed");
  const m5 = dc219Match("Pat Lee", [{ id: "a", name: "Pat Lee" }, { id: "b", name: "pat lee" }]);
  ok(!m5.ok && /More than one/.test(m5.reason), "#219 matchOwner: two matches is a refusal, never a pick");

  // todayYmdIn — the business-zone date, not the server's.
  ok(dc219Today(Date.UTC(2026, 8, 26, 3, 0)) === "2026-09-25", "#219 todayYmdIn: 03:00 UTC is still the previous day in Chicago");
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npm run test:specs > "${TMPDIR:-/tmp}/specs-219.log" 2>&1; echo "exit $?"; grep -E "Cannot find module|ERR_MODULE_NOT_FOUND" "${TMPDIR:-/tmp}/specs-219.log" | head -3
```

Expected: `exit 1`, and a line naming `@/lib/daylite/calendar-events`.

- [ ] **Step 3: Implement `src/lib/daylite/calendar-events.ts`**

```ts
import { createHash } from "node:crypto";
import { norm } from "./ids";

/**
 * Daylite calendar events → Google Calendar (#219) — pure: no DB, no network.
 *
 * Parses Daylite's "Calendar Events" export (tab-separated; quoted cells; a
 * blank header column after "Duration (HH:MM)" and after "Name" plus a
 * trailing one; a narrow no-break space U+202F before AM/PM; Daylite's \"
 * escape inside quoted cells), splits repeating series from one-offs, derives
 * the dedup key and builds the Google event body.
 *
 * Times are WALL-CLOCK in the business zone. They go to Google as a local
 * dateTime + timeZone and are never converted through UTC. addMinutes uses
 * Date.UTC only as a zone-free calendar — no offset is ever applied.
 *
 * Spec: docs/superpowers/specs/2026-09-26-daylite-calendar-import-design.md
 */

export const BUSINESS_TZ = "America/Chicago";
/** A series is the same owner + name at least this many times (spec). */
export const SERIES_MIN = 4;
const DAY_MIN = 1440;

export type WallClock = { y: number; m: number; d: number; hh: number; mm: number };

export type DayliteEvent = {
  /** 1-based physical line in the file (header = 1). */
  line: number;
  owner: string;
  name: string;
  category: string;
  start: WallClock;
  /** Minutes. All-day rows keep the raw span (1440 per day). */
  durationMin: number;
  allDay: boolean;
  linked: string;
  details: string;
  status: string;
};

export type ParseError = { line: number; reason: string };
export type ParsedCalendar = { rows: DayliteEvent[]; errors: ParseError[] };
export type SeriesGroup = { owner: string; name: string; count: number };
export type RosterUser = { id: string; name: string };
export type OwnerMatch = { ok: true; user: RosterUser } | { ok: false; reason: string };

/** Google's view of a time: a local dateTime + its IANA zone, or an all-day date. */
export type ZonedTime = { dateTime: string; timeZone: string } | { date: string };
export type WallClockEventBody = {
  id: string;
  summary: string;
  description: string;
  start: ZonedTime;
  end: ZonedTime;
};

const COLS = {
  hhmm: "Duration (HH:MM)",
  category: "Category",
  start: "Start Date",
  status: "Status",
  name: "Name",
  linked: "Linked",
  owner: "Owner",
  details: "Details",
} as const;
type ColKey = keyof typeof COLS;
const REQUIRED: readonly string[] = [COLS.hhmm, COLS.start, COLS.name, COLS.owner];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Tab-separated rows with their 1-based physical line. A quoted cell may hold
 * tabs and newlines; inside quotes both `""` and Daylite's `\"` mean a
 * literal quote, and `\\` a literal backslash. Strips a BOM; drops rows whose
 * cells are all empty.
 */
export function splitTsv(text: string): { line: number; cells: string[] }[] {
  let s = text || "";
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(field);
    field = "";
    if (cells.some((c) => c !== "")) out.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) {
        field += s[i + 1];
        i++;
      } else if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (c === "\t") {
      cells.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      endRow();
      line++;
      rowLine = line;
      continue;
    }
    field += c;
  }
  if (field !== "" || cells.length) endRow();
  return out;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "M/D/YY, h:mm AM" (U+202F, U+00A0 or a plain space before AM/PM). */
export function parseStart(raw: string): WallClock | null {
  const s = (raw || "").replace(/[  ]/g, " ").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AaPp])[Mm]$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const h12 = Number(m[4]);
  const mm = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h12 < 1 || h12 > 12 || mm > 59) return null;
  const pm = m[6].toUpperCase() === "P";
  const hh = h12 === 12 ? (pm ? 12 : 0) : pm ? h12 + 12 : h12;
  return { y, m: mo, d, hh, mm };
}

/** "HH:MM" with any number of hours ("600:00") → minutes. */
export function parseDurationHHMM(raw: string): number | null {
  const m = /^(\d{1,4}):(\d{2})$/.exec((raw || "").trim());
  if (!m || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseCalendarTsv(text: string): ParsedCalendar {
  const table = splitTsv(text);
  if (!table.length) return { rows: [], errors: [{ line: 1, reason: "The file is empty." }] };
  const header = table[0].cells.map((h) => h.trim());
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length)
    return {
      rows: [],
      errors: [
        {
          line: table[0].line,
          reason: `Missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — is this Daylite's Calendar Events export?`,
        },
      ],
    };
  const idx = {} as Record<ColKey, number>;
  for (const k of Object.keys(COLS) as ColKey[]) idx[k] = header.indexOf(COLS[k]);
  const cell = (cells: string[], k: ColKey) => (idx[k] < 0 ? "" : cells[idx[k]] ?? "").trim();

  const rows: DayliteEvent[] = [];
  const errors: ParseError[] = [];
  for (const { line, cells } of table.slice(1)) {
    const name = cell(cells, "name");
    const owner = cell(cells, "owner");
    if (!name) {
      errors.push({ line, reason: "No event name." });
      continue;
    }
    if (!owner) {
      errors.push({ line, reason: `"${name}" has no owner.` });
      continue;
    }
    const startRaw = cell(cells, "start");
    const start = parseStart(startRaw);
    if (!start) {
      errors.push({ line, reason: `Unreadable start date "${startRaw}".` });
      continue;
    }
    const durRaw = cell(cells, "hhmm");
    const dur = parseDurationHHMM(durRaw);
    if (dur == null) {
      errors.push({ line, reason: `Unreadable duration "${durRaw}".` });
      continue;
    }
    const allDay = dur >= DAY_MIN && start.hh === 0 && start.mm === 0;
    rows.push({
      line,
      owner,
      name,
      category: cell(cells, "category"),
      start,
      durationMin: allDay ? dur : dur || 60,
      allDay,
      linked: cell(cells, "linked"),
      details: cell(cells, "details"),
      status: cell(cells, "status"),
    });
  }
  return { rows, errors };
}

export function seriesKey(e: { owner: string; name: string }): string {
  return norm(e.owner) + "|" + norm(e.name);
}

/** Owner + name (case/space-insensitive) ≥ SERIES_MIN times is a series; all its rows are skipped. */
export function classify(rows: DayliteEvent[]): { oneOffs: DayliteEvent[]; series: SeriesGroup[] } {
  const groups = new Map<string, SeriesGroup>();
  for (const e of rows) {
    const k = seriesKey(e);
    const g = groups.get(k);
    if (g) g.count++;
    else groups.set(k, { owner: e.owner, name: e.name, count: 1 });
  }
  const series = [...groups.values()]
    .filter((g) => g.count >= SERIES_MIN)
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
  const inSeries = new Set(series.map(seriesKey));
  return { oneOffs: rows.filter((e) => !inSeries.has(seriesKey(e))), series };
}

export function ymd(w: { y: number; m: number; d: number }): string {
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

function localIso(w: WallClock): string {
  return `${ymd(w)}T${pad(w.hh)}:${pad(w.mm)}:00`;
}

/** Wall-clock + minutes. Date.UTC is used as a zone-free calendar only. */
export function addMinutes(w: WallClock, minutes: number): WallClock {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm) + minutes * 60_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

/**
 * The dedup key: sha256 of normalized owner | normalized name | local start |
 * durationMin, first 24 hex characters. Stored in the dayliteCalendarImport
 * blob — changing this function re-imports everything as duplicates.
 */
export function eventKey(e: Pick<DayliteEvent, "owner" | "name" | "start" | "durationMin">): string {
  const s = e.start;
  const at = `${ymd(s)}T${pad(s.hh)}:${pad(s.mm)}`;
  return createHash("sha256")
    .update([norm(e.owner), norm(e.name), at, String(e.durationMin)].join("|"))
    .digest("hex")
    .slice(0, 24);
}

/** Google event ids are base32hex (a–v, 0–9), 5–1024 chars: "dlc" + 24 hex fits. */
export function googleEventId(key: string): string {
  return "dlc" + key;
}

export function googleEventFor(e: DayliteEvent, timeZone: string = BUSINESS_TZ): WallClockEventBody {
  const summary = (e.category ? `[${e.category}] ` : "") + e.name;
  const description = [e.details, e.linked ? `Linked: ${e.linked}` : "", "Imported from Daylite"]
    .filter(Boolean)
    .join("\n\n");
  const id = googleEventId(eventKey(e));
  if (e.allDay) {
    const days = Math.max(1, Math.ceil(e.durationMin / DAY_MIN));
    return {
      id,
      summary,
      description,
      start: { date: ymd(e.start) },
      end: { date: ymd(addMinutes(e.start, days * DAY_MIN)) },
    };
  }
  return {
    id,
    summary,
    description,
    start: { dateTime: localIso(e.start), timeZone },
    end: { dateTime: localIso(addMinutes(e.start, e.durationMin)), timeZone },
  };
}

function firstLast(n: string): string | null {
  const t = n.split(" ").filter(Boolean);
  return t.length >= 2 ? t[0] + " " + t[t.length - 1] : null;
}

/** Exact case-insensitive full name, else first + last token. Ambiguity is a refusal. */
export function matchOwner(owner: string, users: RosterUser[]): OwnerMatch {
  const n = norm(owner);
  if (!n) return { ok: false, reason: "No owner name." };
  const exact = users.filter((u) => norm(u.name) === n);
  if (exact.length === 1) return { ok: true, user: exact[0] };
  if (exact.length > 1) return { ok: false, reason: `More than one team member is named ${owner}.` };
  const fl = firstLast(n);
  const loose = fl ? users.filter((u) => firstLast(norm(u.name)) === fl) : [];
  if (loose.length === 1) return { ok: true, user: loose[0] };
  if (loose.length > 1) return { ok: false, reason: `More than one team member matches ${owner}.` };
  return { ok: false, reason: `No team member named ${owner}.` };
}

/** Today's date (YYYY-MM-DD) in the given zone. */
export function todayYmdIn(nowMs: number, timeZone: string = BUSINESS_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(nowMs)
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
```

- [ ] **Step 4: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-219.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-219.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-219.log"; grep -c '^PASS #219' "${TMPDIR:-/tmp}/specs-219.log"; tail -1 "${TMPDIR:-/tmp}/specs-219.log"
npx eslint src/lib/daylite/calendar-events.ts scripts/test-review-and-spec.ts; echo "eslint exit $?"
```

Expected:
- `tsc exit 0`.
- Specs: `exit 0`, PASS = BASE + 38, no FAIL lines, `#219` PASS count 38, `ALL PASSED`.
- `eslint exit 0`.

If a `#219` assertion fails, fix the module, not the golden key.

- [ ] **Step 5: Commit**

```bash
git add src/lib/daylite/calendar-events.ts scripts/test-review-and-spec.ts
git commit -m "feat(import): Daylite calendar events parser, series classifier and keys (#219)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Batch runner, dedup blob, zoned insert, admin-gated actions

**Files:**
- Create: `src/lib/daylite/calendar-batch.ts`
- Create: `src/lib/daylite/calendar-import.ts`
- Create: `src/app/(app)/import/daylite/calendar/actions.ts`
- Modify: `src/lib/google/calendar.ts` (append a section after `upsertManagedEvent` / `removeManagedEvent`, at EOF)
- Modify: `scripts/test-review-and-spec.ts` (append an async function at EOF, plus one line in the promise chain)

**Interfaces:**
- Consumes (Task 1): `parseCalendarTsv`, `classify`, `eventKey`, `googleEventFor`, `matchOwner`, `ymd`, `todayYmdIn`, `BUSINESS_TZ`, and the types `DayliteEvent`, `ParseError`, `ParsedCalendar`, `RosterUser`, `SeriesGroup`, `WallClockEventBody`. Also `norm` from `./ids`, and `isRateLimit(err: unknown): boolean` from `@/lib/gmail/config`.
- Existing: `getBlob<T>(id, defaults)` and `setBlob(id, patch)` from `@/db/doc-store`; `activeUsers()` from `@/lib/users`; `gmailEnabled()`, `hasCalendarScope(scope)` and `personalKey(userId)` from `@/lib/gmail/config`; `getConnectionInfo(key): Promise<{ scope: string } | null>` from `@/lib/gmail/connections`; `requirePerm` from `@/lib/session`.
- Produces from `@/lib/daylite/calendar-batch`:
  - Constants:
    - `DAYLITE_CALENDAR_BLOB = "dayliteCalendarImport"`
    - `BATCH_BUDGET_MS = 45_000`
    - `INSERT_WORST_CASE_MS = 7_000`
    - `OWNER_STOP_AFTER = 5`
  - Types:
    - `ImportedMark = { eventId: string; owner: string; at: number }`
    - `ImportedMap = Record<string, ImportedMark>`
    - `CalendarState = "connected" | "no-calendar" | "not-connected" | "gmail-off"`
    - `PlanOptions = { fromYmd: string | null }`
    - `OwnerPreview` and `CalendarPreview` (exact fields in the code below)
    - `PendingEvent = { key: string; owner: string; mailboxKey: string; body: WallClockEventBody }`
    - `BatchDeps = { insert(mailboxKey, body): Promise<{ id: string }>; record(patch: ImportedMap): Promise<void>; now(): number }`
    - `OwnerTally = { written; alreadyThere; failed: number; lastError: string }`
    - `BatchResult = { stoppedFor: "done" | "budget" | "quota"; pendingAtStart; written; alreadyThere; failed; remaining: number; failedKeys: string[]; stoppedOwners: string[]; byOwner: Record<string, OwnerTally>; quotaMessage: string }`
  - Functions:
    - `sanitizeImported(raw): ImportedMap`
    - `planOneOffs(parsed, opts)`
    - `buildPreview(parsed, users, calendarByUserId, done, opts): CalendarPreview`
    - `selectPending(parsed, users, mailboxByUserId, done, opts & { owners; skipKeys }): PendingEvent[]`
    - `isQuotaStop(err)`
    - `isAlreadyExists(err)`
    - `runCalendarBatch(pending, deps, budgetMs?): Promise<BatchResult>`
- Produces from `@/lib/daylite/calendar-import` (server):
  - `loadImported(): Promise<ImportedMap>`
  - `calendarStates(users): Promise<Record<string, CalendarState>>`
  - `previewCalendarImport(text, { fromToday, now? }): Promise<CalendarPreview>`
  - `importCalendarBatch(text, { fromToday, owners, skipKeys, now? }, deps?): Promise<BatchResult>`
- Produces from `@/lib/google/calendar`:
  - `ZonedEventTime`
  - `ZonedEventBody`
  - `insertZonedEvent(mailboxKey: string, body: ZonedEventBody): Promise<{ id: string; htmlLink: string }>`
- Produces from `src/app/(app)/import/daylite/calendar/actions.ts`:
  - `type CalendarPreviewResult = { ok: true; preview: CalendarPreview } | { ok: false; error: string }`
  - `type CalendarBatchResult = ({ ok: true } & BatchResult) | { ok: false; error: string }`
  - `previewCalendarAction(text: string, fromToday: boolean): Promise<CalendarPreviewResult>`
  - `importCalendarBatchAction(text: string, input: { fromToday: boolean; owners: string[]; skipKeys: string[] }): Promise<CalendarBatchResult>`

- [ ] **Step 1: Write the failing tests**

Append this at the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ====== #219 Daylite calendar import — Task 2: preview, pending selection, batch runner (fake insert), admin gate ======
   runCalendarBatch never touches Google here: insert/record/now are fakes.
   The DB half (previewCalendarImport / importCalendarBatch) runs on the
   harness's scratch PGlite with the seeded roster and no mailbox
   connections, so nothing can be written anywhere. */
import {
  DAYLITE_CALENDAR_BLOB as DC219_BLOB,
  OWNER_STOP_AFTER as DC219_STOP_AFTER,
  buildPreview as dc219Preview,
  isAlreadyExists as dc219Is409,
  isQuotaStop as dc219IsQuota,
  runCalendarBatch as dc219Run,
  sanitizeImported as dc219Sanitize,
  selectPending as dc219Select,
  type BatchDeps as DC219Deps,
  type ImportedMap as DC219Map,
  type PendingEvent as DC219Pending,
} from "@/lib/daylite/calendar-batch";
import { importCalendarBatch as dc219ImportBatch, previewCalendarImport as dc219PreviewDb } from "@/lib/daylite/calendar-import";
import { setBlob as setBlob219 } from "@/db/doc-store";

async function dayliteCalendarAsyncChecks219(): Promise<void> {
  const j = (v: unknown) => JSON.stringify(v);
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const parsed = dc219Parse(DC219_FIXTURE);
  const users = [
    { id: "u1", name: "Jeff Chesebro" },
    { id: "u5", name: "Jason Keagy" },
    { id: "u6", name: "Isaac Mittlesteadt" },
    { id: "u7", name: "Jena Tolksdorf" },
  ];
  const keyOf = (prefix: string) => dc219Key(parsed.rows.find((r) => r.name.startsWith(prefix))!);
  const lincolnKey = keyOf("Lincoln Academy");

  // --- buildPreview (pure)
  const pv = dc219Preview(parsed, users, { u1: "not-connected", u5: "connected", u6: "no-calendar", u7: "gmail-off" }, { [lincolnKey]: { eventId: "x", owner: "Jason Keagy", at: 1 } }, { fromYmd: null });
  const own = (name: string) => pv.owners.find((o) => o.owner === name)!;
  ok(j(pv.owners.map((o) => o.owner)) === j(["Andrew Herschleb", "Isaac Mittlesteadt", "Jason Keagy", "Jeff Chesebro", "Jena Tolksdorf", "Mike Mundth"]), "#219 preview: one row per owner, sorted");
  ok(own("Jason Keagy").oneOffs === 3 && own("Jason Keagy").alreadyImported === 1 && own("Jason Keagy").toImport === 2 && own("Jason Keagy").defaultInclude, "#219 preview: already-imported keys counted; connected owner included by default");
  ok(own("Isaac Mittlesteadt").calendar === "no-calendar" && !own("Isaac Mittlesteadt").defaultInclude, "#219 preview: a mailbox without calendar scope is not included");
  ok(own("Jeff Chesebro").oneOffs === 0 && own("Jeff Chesebro").seriesRows === 4 && j(own("Jeff Chesebro").series) === j([{ name: "Weekly Sales Meeting", count: 4 }]), "#219 preview: series listed with counts per owner");
  ok(own("Mike Mundth").calendar === "no-user" && own("Mike Mundth").userId === null && /No team member/.test(own("Mike Mundth").matchNote), "#219 preview: an unmatched owner is reported");
  ok(pv.totals.seriesCount === 1 && pv.totals.seriesRows === 4 && pv.totals.oneOffs === 7 && pv.totals.alreadyImported === 1 && pv.errors.length === 2, "#219 preview: totals and parse errors");
  const pvToday = dc219Preview(parsed, users, {}, {}, { fromYmd: "2026-09-01" });
  ok(pvToday.totals.oneOffs === 4 && pvToday.fromYmd === "2026-09-01", "#219 preview: 'from today on' drops earlier one-offs (Jena, Christmas, Lincoln, Sauk remain)");

  // --- selectPending (pure) — only the owner's own connected mailbox.
  const mailboxes = { u5: "personal:u5", u6: "personal:u6" };
  const all = dc219Select(parsed, users, mailboxes, {}, { fromYmd: null, owners: ["Jason Keagy", "Isaac Mittlesteadt", "Jena Tolksdorf", "Mike Mundth"], skipKeys: [] });
  ok(j(all.map((p) => p.body.summary)) === j(["Christmas Holiday", "Lincoln Academy Submittal Review", "Oshkosh North Aud & Black Box Projects - First AV Conversation including \"Shelby\"", "[Service Call] Sauk Trail Elementary, Middleton HS"]), "#219 pending: one-offs of included owners with a connected calendar, file order");
  ok(all.every((p) => p.mailboxKey === (p.owner === "Jason Keagy" ? "personal:u5" : "personal:u6")), "#219 pending: each event targets its own owner's mailbox — never someone else's");
  ok(dc219Select(parsed, users, mailboxes, {}, { fromYmd: null, owners: ["isaac  mittlesteadt"], skipKeys: [] }).length === 1, "#219 pending: the owners filter is case/space-insensitive");
  ok(dc219Select(parsed, users, mailboxes, {}, { fromYmd: "2026-09-01", owners: ["Jason Keagy", "Isaac Mittlesteadt"], skipKeys: [] }).length === 3, "#219 pending: the date filter applies");
  ok(dc219Select(parsed, users, mailboxes, {}, { fromYmd: null, owners: ["Jason Keagy"], skipKeys: [lincolnKey] }).length === 2, "#219 pending: skipKeys (failed this run) are left out");

  // --- runCalendarBatch with fakes
  const clock = { t: 0 };
  const make = (insert: DC219Deps["insert"], store: DC219Map): DC219Deps => ({
    insert,
    record: async (patch) => {
      Object.assign(store, patch);
    },
    now: () => clock.t,
  });
  const calls: { mailboxKey: string; id: string; start: unknown }[] = [];
  const okInsert: DC219Deps["insert"] = async (mailboxKey, body) => {
    calls.push({ mailboxKey, id: body.id, start: body.start });
    clock.t += 100;
    return { id: "g-" + calls.length };
  };

  const store1: DC219Map = {};
  const r1 = await dc219Run(all, make(okInsert, store1));
  ok(r1.stoppedFor === "done" && r1.written === 4 && r1.remaining === 0 && r1.pendingAtStart === 4 && Object.keys(store1).length === 4, "#219 batch: writes every pending event and records each key");
  ok(store1[lincolnKey]?.eventId === "g-2" && store1[lincolnKey]?.owner === "Jason Keagy", "#219 batch: the record maps key → Google event id + owner");
  ok(calls.every((c) => /^dlc[0-9a-f]{24}$/.test(c.id)) && j(calls[1].start) === j({ dateTime: "2026-09-16T14:00:00", timeZone: "America/Chicago" }), "#219 batch: bodies carry the deterministic id and wall-clock Chicago times");
  const rerun = dc219Select(parsed, users, mailboxes, store1, { fromYmd: null, owners: ["Jason Keagy", "Isaac Mittlesteadt"], skipKeys: [] });
  ok(rerun.length === 0, "#219 batch: a re-run over the recorded map selects nothing — importing twice never duplicates");

  const store409: DC219Map = {};
  const r409 = await dc219Run(all.slice(0, 1), make(async () => {
    throw new Error('Calendar API /calendars/primary/events?sendUpdates=none → 409 {"error":{"code":409,"message":"The requested identifier already exists."}}');
  }, store409));
  ok(r409.alreadyThere === 1 && r409.failed === 0 && store409[all[0].key]?.eventId === all[0].body.id, "#219 batch: a 409 on our deterministic id is recorded as already in Google");

  let n = 0;
  const storeQ: DC219Map = {};
  const rq = await dc219Run(all, make(async () => {
    n++;
    if (n === 2) throw new Error('Calendar API /calendars/primary/events?sendUpdates=none → 403 {"error":{"errors":[{"reason":"rateLimitExceeded"}]}}');
    return { id: "g" + n };
  }, storeQ));
  ok(rq.stoppedFor === "quota" && rq.written === 1 && rq.remaining === 3 && rq.failed === 0 && rq.failedKeys.length === 0 && Object.keys(storeQ).length === 1 && rq.quotaMessage.includes("rateLimitExceeded"), "#219 batch: a rate-limit error stops the batch; the event stays pending, not failed");
  ok(dc219IsQuota(new Error('→ 403 {"error":{"errors":[{"reason":"quotaExceeded","message":"Calendar usage limits exceeded."}]}}')) && dc219IsQuota(new Error("→ 429 Too Many Requests")) && !dc219IsQuota(new Error("→ 500 backend")), "#219 isQuotaStop: quotaExceeded / usage limits / 429 stop; a 500 does not");
  ok(dc219Is409(new Error("Calendar API x → 409 {}")) && !dc219Is409(new Error("Calendar API x → 404 {}")), "#219 isAlreadyExists: matches only a 409");

  clock.t = 0;
  const slow: DC219Deps["insert"] = async () => {
    clock.t += 5_000;
    return { id: "s" };
  };
  const rb = await dc219Run(all, make(slow, {}), 20_000);
  ok(rb.stoppedFor === "budget" && rb.written === 3 && rb.remaining === 1, "#219 batch: stops starting inserts when a worst-case insert no longer fits the budget");
  clock.t = 0;
  const rb1 = await dc219Run(all, make(slow, {}), 1_000);
  ok(rb1.written === 1 && rb1.stoppedFor === "budget" && rb1.remaining === 3, "#219 batch: the first insert always runs (forward progress)");

  const storeF: DC219Map = {};
  const rf = await dc219Run(all, make(async (_k, body) => {
    if (body.summary.startsWith("Lincoln")) throw new Error("Calendar API x → 500 backendError");
    return { id: "ok" };
  }, storeF));
  ok(rf.written === 3 && rf.failed === 1 && j(rf.failedKeys) === j([lincolnKey]) && rf.byOwner["Jason Keagy"].failed === 1 && rf.byOwner["Jason Keagy"].lastError.includes("500") && !storeF[lincolnKey], "#219 batch: a non-quota error is counted per owner, not recorded, and its key returned for skipKeys");

  const synth = (owner: string, i: number): DC219Pending => ({
    key: i.toString(16).padStart(24, "0"),
    owner,
    mailboxKey: "personal:" + owner,
    body: { id: "dlc" + i.toString(16).padStart(24, "0"), summary: owner + i, description: "", start: { date: "2026-01-01" }, end: { date: "2026-01-02" } },
  });
  const mixed = [...Array.from({ length: 7 }, (_, i) => synth("X", i)), synth("Y", 99)];
  const rs = await dc219Run(mixed, make(async (mailboxKey) => {
    if (mailboxKey === "personal:X") throw new Error("Mailbox not connected: personal:X");
    return { id: "y" };
  }, {}));
  ok(rs.failed === DC219_STOP_AFTER && j(rs.stoppedOwners) === j(["X"]) && rs.written === 1 && rs.stoppedFor === "done" && rs.remaining === 0, "#219 batch: 5 consecutive failures stop that owner; other owners carry on");

  let threw = false;
  try {
    await dc219Run(all.slice(0, 1), { insert: async () => ({ id: "z" }), record: async () => { throw new Error("db down"); }, now: () => 0 });
  } catch {
    threw = true;
  }
  ok(threw, "#219 batch: a failed blob write aborts the batch (a resume re-inserts → 409 → recorded)");

  ok(j(Object.keys(dc219Sanitize({ a: { eventId: "e", owner: "o", at: 1 }, b: null, c: { owner: "x" }, d: "junk" }))) === j(["a"]), "#219 sanitizeImported: drops cleared (null) and malformed entries");

  // --- DB half: the seeded roster, no mailbox connections.
  await setBlob219(DC219_BLOB, { [lincolnKey]: { eventId: "dlc-test", owner: "Jason Keagy", at: 1 } });
  const live = await dc219PreviewDb(DC219_FIXTURE, { fromToday: false });
  const jason = live.owners.find((o) => o.owner === "Jason Keagy")!;
  ok(jason.userName === "Jason Keagy" && jason.alreadyImported === 1 && ["gmail-off", "not-connected"].includes(jason.calendar) && !jason.defaultInclude, "#219 previewCalendarImport: matches the seeded roster, reads the blob, and reports no calendar");
  ok(live.owners.find((o) => o.owner === "Mike Mundth")!.calendar === "no-user", "#219 previewCalendarImport: an owner outside the roster is no-user");
  let inserted = 0;
  const liveRun = await dc219ImportBatch(DC219_FIXTURE, { fromToday: false, owners: ["Jason Keagy", "Isaac Mittlesteadt"], skipKeys: [] }, {
    insert: async () => {
      inserted++;
      return { id: "never" };
    },
    record: async () => {},
    now: () => 0,
  });
  ok(liveRun.pendingAtStart === 0 && inserted === 0 && liveRun.stoppedFor === "done", "#219 importCalendarBatch: no connected calendar → nothing is written anywhere");
  await setBlob219(DC219_BLOB, { [lincolnKey]: null });

  // --- source checks: the zoned insert and the admin gate.
  const cal = read("src/lib/google/calendar.ts");
  ok(/export async function insertZonedEvent\(\s*mailboxKey: string,\s*body: ZonedEventBody\s*\)/.test(cal) && cal.includes('"/calendars/primary/events?sendUpdates=none"'), "#219 insertZonedEvent: primary calendar, no invite emails");
  const act = read("src/app/(app)/import/daylite/calendar/actions.ts");
  ok(act.startsWith('"use server"'), "#219 actions: a server-action module");
  ok(
    (act.match(/export async function \w+\([^)]*\)[^{]*\{\s*await requirePerm\("manage_users"\);/g) || []).length === 2 &&
      (act.match(/^export async function/gm) || []).length === 2,
    "#219 actions: both actions call requirePerm(\"manage_users\") first, outside any try"
  );
  const glue = read("src/lib/daylite/calendar-import.ts");
  ok(glue.includes('if (states[u.id] === "connected") mailboxByUserId[u.id] = personalKey(u.id);'), "#219 import: only a connected owner's OWN personal mailbox is ever targeted");
}
```

Then wire it into the promise chain. In the `seeded() … .then(…)` chain near line 10527, insert one line directly after `  .then(() => specBuilderFinalFixAsyncChecks())`:

```ts
  .then(() => dayliteCalendarAsyncChecks219())
```

If that anchor line has moved, put the line directly above the comment `  // Before the report and before the \`.catch\`, so a thrown suite is torn`.

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npm run test:specs > "${TMPDIR:-/tmp}/specs-219.log" 2>&1; echo "exit $?"; grep -E "Cannot find module|ERR_MODULE_NOT_FOUND" "${TMPDIR:-/tmp}/specs-219.log" | head -3
```

Expected: `exit 1`, naming `@/lib/daylite/calendar-batch`.

- [ ] **Step 3: Append the zoned insert to `src/lib/google/calendar.ts`**

Add this at the end of the file, after `removeManagedEvent`:

```ts

/* ---- #219: wall-clock event writes (Daylite calendar import) ------------
 * insertEvent above takes epoch-ms and sends UTC ISO strings. An imported
 * Daylite event is a local wall-clock time in a named zone and must reach
 * Google exactly as written, so this sibling sends a pre-built body. */

/** A local dateTime with no offset plus its IANA zone, or an all-day date
 *  (Google's end.date is exclusive). */
export type ZonedEventTime = { dateTime: string; timeZone: string } | { date: string };

export type ZonedEventBody = {
  /** Optional caller-chosen id (base32hex, 5–1024 chars). A repeat insert
   *  with the same id fails with 409 instead of creating a duplicate. */
  id?: string;
  summary: string;
  description?: string;
  start: ZonedEventTime;
  end: ZonedEventTime;
};

/** Insert a pre-built event on the mailbox's PRIMARY calendar, never sending
 *  invite emails. Same token path and 5 s timeout as every call here. */
export async function insertZonedEvent(
  mailboxKey: string,
  body: ZonedEventBody
): Promise<{ id: string; htmlLink: string }> {
  const r = await gcal<GoogleEvent>(mailboxKey, "/calendars/primary/events?sendUpdates=none", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: r.id, htmlLink: r.htmlLink || "" };
}
```

- [ ] **Step 4: Implement `src/lib/daylite/calendar-batch.ts`**

```ts
import { isRateLimit } from "@/lib/gmail/config";
import {
  classify,
  eventKey,
  googleEventFor,
  matchOwner,
  ymd,
  type DayliteEvent,
  type ParseError,
  type ParsedCalendar,
  type RosterUser,
  type SeriesGroup,
  type WallClockEventBody,
} from "./calendar-events";
import { norm } from "./ids";

/**
 * Daylite calendar import (#219) — preview, pending selection and the
 * budgeted batch runner. No DB and no network: insert / record / now are
 * injected (calendar-import.ts passes the live ones; the spec harness passes
 * fakes), so Google is never touched by a test.
 */

/** doc-store blobs row: { [eventKey]: { eventId, owner, at } }, one top-level key per event. */
export const DAYLITE_CALENDAR_BLOB = "dayliteCalendarImport";
/** Per request; the page's maxDuration is 60 s. */
export const BATCH_BUDGET_MS = 45_000;
/** One insert's worst case: calendar.ts aborts at 5 s, plus a token refresh. */
export const INSERT_WORST_CASE_MS = 7_000;
/** Consecutive failures for one owner in one batch before that owner stops. */
export const OWNER_STOP_AFTER = 5;

export type ImportedMark = { eventId: string; owner: string; at: number };
export type ImportedMap = Record<string, ImportedMark>;
export type CalendarState = "connected" | "no-calendar" | "not-connected" | "gmail-off";
export type PlanOptions = { fromYmd: string | null };

export type OwnerPreview = {
  owner: string;
  userId: string | null;
  userName: string | null;
  /** Why no user matched ("" when one did). */
  matchNote: string;
  calendar: CalendarState | "no-user";
  oneOffs: number;
  alreadyImported: number;
  toImport: number;
  series: { name: string; count: number }[];
  seriesRows: number;
  defaultInclude: boolean;
};

export type CalendarPreview = {
  owners: OwnerPreview[];
  errors: ParseError[];
  fromYmd: string | null;
  totals: {
    rows: number;
    oneOffs: number;
    seriesCount: number;
    seriesRows: number;
    duplicates: number;
    alreadyImported: number;
    toImport: number;
  };
};

export type PendingEvent = { key: string; owner: string; mailboxKey: string; body: WallClockEventBody };

export type BatchDeps = {
  insert: (mailboxKey: string, body: WallClockEventBody) => Promise<{ id: string }>;
  record: (patch: ImportedMap) => Promise<void>;
  now: () => number;
};

export type OwnerTally = { written: number; alreadyThere: number; failed: number; lastError: string };

export type BatchResult = {
  stoppedFor: "done" | "budget" | "quota";
  pendingAtStart: number;
  written: number;
  alreadyThere: number;
  failed: number;
  /** Pending events not attempted in this call (stopped owners excluded). */
  remaining: number;
  /** Failed this call — the client sends them back as skipKeys. */
  failedKeys: string[];
  stoppedOwners: string[];
  byOwner: Record<string, OwnerTally>;
  quotaMessage: string;
};

export function sanitizeImported(raw: Record<string, unknown>): ImportedMap {
  const out: ImportedMap = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!v || typeof v !== "object") continue;
    const m = v as Partial<ImportedMark>;
    if (typeof m.eventId !== "string" || !m.eventId) continue;
    out[k] = { eventId: m.eventId, owner: typeof m.owner === "string" ? m.owner : "", at: typeof m.at === "number" ? m.at : 0 };
  }
  return out;
}

type Planned = { key: string; event: DayliteEvent };

/** One-offs after the date filter, each keyed once (a repeated key counts as a duplicate). */
export function planOneOffs(
  parsed: ParsedCalendar,
  opts: PlanOptions
): { planned: Planned[]; duplicates: number; series: SeriesGroup[]; seriesRows: number } {
  const { oneOffs, series } = classify(parsed.rows);
  const seen = new Set<string>();
  const planned: Planned[] = [];
  let duplicates = 0;
  for (const event of oneOffs) {
    if (opts.fromYmd && ymd(event.start) < opts.fromYmd) continue;
    const key = eventKey(event);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    planned.push({ key, event });
  }
  return { planned, duplicates, series, seriesRows: series.reduce((n, g) => n + g.count, 0) };
}

export function buildPreview(
  parsed: ParsedCalendar,
  users: RosterUser[],
  calendarByUserId: Record<string, CalendarState>,
  done: ImportedMap,
  opts: PlanOptions
): CalendarPreview {
  const plan = planOneOffs(parsed, opts);
  const byOwner = new Map<string, OwnerPreview>();
  const ownerRow = (name: string): OwnerPreview => {
    const k = norm(name);
    const existing = byOwner.get(k);
    if (existing) return existing;
    const m = matchOwner(name, users);
    const calendar: OwnerPreview["calendar"] = m.ok ? calendarByUserId[m.user.id] ?? "not-connected" : "no-user";
    const row: OwnerPreview = {
      owner: name,
      userId: m.ok ? m.user.id : null,
      userName: m.ok ? m.user.name : null,
      matchNote: m.ok ? "" : m.reason,
      calendar,
      oneOffs: 0,
      alreadyImported: 0,
      toImport: 0,
      series: [],
      seriesRows: 0,
      defaultInclude: calendar === "connected",
    };
    byOwner.set(k, row);
    return row;
  };
  for (const e of parsed.rows) ownerRow(e.owner);
  for (const p of plan.planned) {
    const o = ownerRow(p.event.owner);
    o.oneOffs++;
    if (done[p.key]) o.alreadyImported++;
    else o.toImport++;
  }
  for (const g of plan.series) {
    const o = ownerRow(g.owner);
    o.series.push({ name: g.name, count: g.count });
    o.seriesRows += g.count;
  }
  const owners = [...byOwner.values()].sort((a, b) => a.owner.localeCompare(b.owner));
  const sum = (f: (o: OwnerPreview) => number) => owners.reduce((n, o) => n + f(o), 0);
  return {
    owners,
    errors: parsed.errors,
    fromYmd: opts.fromYmd,
    totals: {
      rows: parsed.rows.length,
      oneOffs: plan.planned.length,
      seriesCount: plan.series.length,
      seriesRows: plan.seriesRows,
      duplicates: plan.duplicates,
      alreadyImported: sum((o) => o.alreadyImported),
      toImport: sum((o) => o.toImport),
    },
  };
}

/**
 * What a batch should write: planned one-offs of the included owners that are
 * neither recorded nor skipped, each aimed at the MATCHED owner's own mailbox.
 * An owner with no match or no entry in mailboxByUserId is dropped.
 */
export function selectPending(
  parsed: ParsedCalendar,
  users: RosterUser[],
  mailboxByUserId: Record<string, string>,
  done: ImportedMap,
  opts: PlanOptions & { owners: string[]; skipKeys: string[] }
): PendingEvent[] {
  const include = new Set(opts.owners.map(norm));
  const skip = new Set(opts.skipKeys);
  const mailboxCache = new Map<string, string | null>();
  const mailboxFor = (owner: string): string | null => {
    const k = norm(owner);
    if (!mailboxCache.has(k)) {
      const m = matchOwner(owner, users);
      mailboxCache.set(k, m.ok ? mailboxByUserId[m.user.id] ?? null : null);
    }
    return mailboxCache.get(k) ?? null;
  };
  const out: PendingEvent[] = [];
  for (const { key, event } of planOneOffs(parsed, opts).planned) {
    if (!include.has(norm(event.owner)) || done[key] || skip.has(key)) continue;
    const mailboxKey = mailboxFor(event.owner);
    if (!mailboxKey) continue;
    out.push({ key, owner: event.owner, mailboxKey, body: googleEventFor(event) });
  }
  return out;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shortText(err: unknown): string {
  const m = messageOf(err);
  return m.length > 300 ? m.slice(0, 300) + "…" : m;
}

/** Google's per-user rate limit or its calendar usage limit — stop and resume later. */
export function isQuotaStop(err: unknown): boolean {
  return isRateLimit(err) || /quotaExceeded|usageLimits|usage limits exceeded/i.test(messageOf(err));
}

/** calendar.ts formats errors as "Calendar API <path> → <status> <body>". */
export function isAlreadyExists(err: unknown): boolean {
  return /→ 409\b/.test(messageOf(err));
}

/**
 * Write `pending` in order until done, out of budget, or stopped by quota.
 * A new insert starts only while a worst-case insert still fits (the first
 * always runs). Each success — or a 409 on our deterministic id — is recorded
 * immediately; a record failure throws (the resume's 409 records it later).
 */
export async function runCalendarBatch(
  pending: PendingEvent[],
  deps: BatchDeps,
  budgetMs: number = BATCH_BUDGET_MS
): Promise<BatchResult> {
  const started = deps.now();
  const res: BatchResult = {
    stoppedFor: "done",
    pendingAtStart: pending.length,
    written: 0,
    alreadyThere: 0,
    failed: 0,
    remaining: 0,
    failedKeys: [],
    stoppedOwners: [],
    byOwner: {},
    quotaMessage: "",
  };
  const streak = new Map<string, number>();
  const stopped = new Set<string>();
  const left = (from: number) => pending.slice(from).filter((q) => !stopped.has(q.owner)).length;
  let attempted = 0;

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    if (stopped.has(p.owner)) continue;
    if (attempted > 0 && deps.now() - started + INSERT_WORST_CASE_MS > budgetMs) {
      res.stoppedFor = "budget";
      res.remaining = left(i);
      return res;
    }
    attempted++;
    const tally = res.byOwner[p.owner] || (res.byOwner[p.owner] = { written: 0, alreadyThere: 0, failed: 0, lastError: "" });
    let mark: ImportedMark;
    try {
      const r = await deps.insert(p.mailboxKey, p.body);
      mark = { eventId: r.id || p.body.id, owner: p.owner, at: deps.now() };
      tally.written++;
      res.written++;
    } catch (err) {
      if (isAlreadyExists(err)) {
        mark = { eventId: p.body.id, owner: p.owner, at: deps.now() };
        tally.alreadyThere++;
        res.alreadyThere++;
      } else if (isQuotaStop(err)) {
        res.stoppedFor = "quota";
        res.quotaMessage = shortText(err);
        res.remaining = left(i);
        return res;
      } else {
        tally.failed++;
        tally.lastError = shortText(err);
        res.failed++;
        res.failedKeys.push(p.key);
        const n = (streak.get(p.owner) ?? 0) + 1;
        streak.set(p.owner, n);
        if (n >= OWNER_STOP_AFTER) {
          stopped.add(p.owner);
          res.stoppedOwners.push(p.owner);
        }
        continue;
      }
    }
    streak.set(p.owner, 0);
    await deps.record({ [p.key]: mark });
  }
  return res;
}
```

- [ ] **Step 5: Implement `src/lib/daylite/calendar-import.ts`**

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { insertZonedEvent } from "@/lib/google/calendar";
import { activeUsers } from "@/lib/users";
import {
  DAYLITE_CALENDAR_BLOB,
  buildPreview,
  runCalendarBatch,
  sanitizeImported,
  selectPending,
  type BatchDeps,
  type BatchResult,
  type CalendarPreview,
  type CalendarState,
  type ImportedMap,
} from "./calendar-batch";
import { BUSINESS_TZ, parseCalendarTsv, todayYmdIn, type RosterUser } from "./calendar-events";

/**
 * Daylite calendar import (#219) — server glue: the active roster, each
 * user's personal mailbox grant, the dedup blob, and the live Google insert.
 * The file text arrives on every call and is re-parsed; no copy of the
 * events is kept beyond the dedup map.
 */

export async function loadImported(): Promise<ImportedMap> {
  return sanitizeImported(await getBlob<Record<string, unknown>>(DAYLITE_CALENDAR_BLOB, {}));
}

async function roster(): Promise<RosterUser[]> {
  return (await activeUsers()).map((u) => ({ id: u.id, name: u.name }));
}

/** Per user: may we write to their primary calendar? */
export async function calendarStates(users: RosterUser[]): Promise<Record<string, CalendarState>> {
  const out: Record<string, CalendarState> = {};
  if (!gmailEnabled()) {
    for (const u of users) out[u.id] = "gmail-off";
    return out;
  }
  await Promise.all(
    users.map(async (u) => {
      const info = await getConnectionInfo(personalKey(u.id));
      out[u.id] = !info ? "not-connected" : hasCalendarScope(info.scope) ? "connected" : "no-calendar";
    })
  );
  return out;
}

function fromYmdFor(fromToday: boolean, now: number): string | null {
  return fromToday ? todayYmdIn(now, BUSINESS_TZ) : null;
}

export async function previewCalendarImport(
  text: string,
  opts: { fromToday: boolean; now?: number }
): Promise<CalendarPreview> {
  const parsed = parseCalendarTsv(text);
  const users = await roster();
  const [states, done] = await Promise.all([calendarStates(users), loadImported()]);
  return buildPreview(parsed, users, states, done, { fromYmd: fromYmdFor(opts.fromToday, opts.now ?? Date.now()) });
}

const liveDeps: BatchDeps = {
  insert: (mailboxKey, body) => insertZonedEvent(mailboxKey, body),
  record: (patch) => setBlob(DAYLITE_CALENDAR_BLOB, patch),
  now: () => Date.now(),
};

export async function importCalendarBatch(
  text: string,
  opts: { fromToday: boolean; owners: string[]; skipKeys: string[]; now?: number },
  deps: BatchDeps = liveDeps
): Promise<BatchResult> {
  const parsed = parseCalendarTsv(text);
  const users = await roster();
  const [states, done] = await Promise.all([calendarStates(users), loadImported()]);
  const mailboxByUserId: Record<string, string> = {};
  for (const u of users) if (states[u.id] === "connected") mailboxByUserId[u.id] = personalKey(u.id);
  const pending = selectPending(parsed, users, mailboxByUserId, done, {
    fromYmd: fromYmdFor(opts.fromToday, opts.now ?? Date.now()),
    owners: opts.owners,
    skipKeys: opts.skipKeys,
  });
  return runCalendarBatch(pending, deps);
}
```

- [ ] **Step 6: Implement `src/app/(app)/import/daylite/calendar/actions.ts`**

```ts
"use server";

import { requirePerm } from "@/lib/session";
import type { BatchResult, CalendarPreview } from "@/lib/daylite/calendar-batch";
import { importCalendarBatch, previewCalendarImport } from "@/lib/daylite/calendar-import";

/**
 * Daylite calendar import (#219) — admin-only server seam. The TSV text
 * travels on every call (the server re-parses; nothing is cached), capped
 * under next.config's 1200 kb server-action body limit, like the history
 * import. requirePerm stays OUTSIDE the try blocks: it redirects, and a
 * caught redirect would be swallowed into an error message.
 */

const MAX_CHARS = 1_100_000;
const MAX_OWNERS = 100;
const MAX_SKIP = 5_000;
const KEY_RE = /^[0-9a-f]{24}$/;

export type CalendarPreviewResult = { ok: true; preview: CalendarPreview } | { ok: false; error: string };
export type CalendarBatchResult = ({ ok: true } & BatchResult) | { ok: false; error: string };

function checkText(text: unknown): { text: string } | { error: string } {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return { error: "Choose Daylite's Calendar Events export (.tsv) first." };
  if (t.length > MAX_CHARS)
    return { error: "That file is too large to send in one piece. Export a shorter date range from Daylite and import each part in turn." };
  return { text: t };
}

export async function previewCalendarAction(text: string, fromToday: boolean): Promise<CalendarPreviewResult> {
  await requirePerm("manage_users");
  const input = checkText(text);
  if ("error" in input) return { ok: false, error: input.error };
  try {
    return { ok: true, preview: await previewCalendarImport(input.text, { fromToday: fromToday === true }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function importCalendarBatchAction(
  text: string,
  input: { fromToday: boolean; owners: string[]; skipKeys: string[] }
): Promise<CalendarBatchResult> {
  await requirePerm("manage_users");
  const checked = checkText(text);
  if ("error" in checked) return { ok: false, error: checked.error };
  const owners = Array.isArray(input?.owners)
    ? input.owners.filter((o): o is string => typeof o === "string" && o.trim() !== "").slice(0, MAX_OWNERS).map((o) => o.slice(0, 200))
    : [];
  if (!owners.length) return { ok: false, error: "Tick at least one person to import." };
  const skipKeys = Array.isArray(input?.skipKeys)
    ? input.skipKeys.filter((k): k is string => typeof k === "string" && KEY_RE.test(k)).slice(0, MAX_SKIP)
    : [];
  try {
    const res = await importCalendarBatch(checked.text, { fromToday: input?.fromToday === true, owners, skipKeys });
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 7: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-219.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-219.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-219.log"; grep -c '^PASS #219' "${TMPDIR:-/tmp}/specs-219.log"; tail -1 "${TMPDIR:-/tmp}/specs-219.log"
npx eslint src/lib/daylite/calendar-batch.ts src/lib/daylite/calendar-import.ts src/lib/google/calendar.ts "src/app/(app)/import/daylite/calendar/actions.ts" scripts/test-review-and-spec.ts; echo "eslint exit $?"
```

Expected:
- `tsc exit 0`.
- Specs: `exit 0`, PASS = BASE + 71, no FAIL lines, `#219` PASS count 71, `ALL PASSED`.
- `eslint exit 0`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/daylite/calendar-batch.ts src/lib/daylite/calendar-import.ts src/lib/google/calendar.ts "src/app/(app)/import/daylite/calendar/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(import): resumable Daylite calendar batch runner, dedup blob and admin actions (#219)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The screen — upload → preview → resumable import, linked from /import/daylite

**Files:**
- Create: `src/app/(app)/import/daylite/calendar/page.tsx`
- Create: `src/app/(app)/import/daylite/calendar/calendar-client.tsx`
- Modify: `src/app/(app)/import/daylite/page.tsx` (add one link under the header description)
- Modify: `scripts/test-review-and-spec.ts` (append one sync block)

**Interfaces:**
- Consumes (Task 2): `previewCalendarAction`, `importCalendarBatchAction`, and the types `CalendarPreviewResult` and `CalendarBatchResult`, all from `./actions`. The client derives `Preview`, `OwnerRow` and `Batch` from them with `Extract`.
- Produces: the `DayliteCalendarImport` component (no props) and the route `/import/daylite/calendar`.

- [ ] **Step 1: Write the failing tests**

Append this at the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ====== #219 Daylite calendar import — Task 3: the screen (source checks) ====== */
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const page = read("src/app/(app)/import/daylite/calendar/page.tsx");
  ok(page.includes('await requirePerm("manage_users")') && page.includes("export const maxDuration = 60"), "#219 T3: the page is admin-gated and gets the 60 s server-action ceiling");
  const client = read("src/app/(app)/import/daylite/calendar/calendar-client.tsx");
  ok(client.startsWith('"use client"'), "#219 T3: the import screen is a client component");
  const valueImports = [...client.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gm)].map((m) => m[1]);
  ok(valueImports.length > 0 && valueImports.every((s) => s === "react" || s === "./actions"), "#219 T3: the client imports values only from react and its own actions — no store, db or server module");
  ok(client.includes("skipKeys: skipRef.current") && client.includes('b.stoppedFor === "quota"') && client.includes("b.stoppedOwners"), "#219 T3: the loop re-posts with failed keys skipped, pauses on quota, drops stopped owners");
  ok(client.includes("Only events from today on") && client.includes("Repeating series skipped"), "#219 T3: the from-today option and the skipped-series list are on the page");
  const hist = read("src/app/(app)/import/daylite/page.tsx");
  ok(hist.includes('href="/import/daylite/calendar"'), "#219 T3: /import/daylite links to the calendar import");
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npm run test:specs > "${TMPDIR:-/tmp}/specs-219.log" 2>&1; echo "exit $?"; grep -E "ENOENT|^FAIL #219" "${TMPDIR:-/tmp}/specs-219.log" | head -3
```

Expected: `exit 1` with `ENOENT … calendar/page.tsx` (the block throws on the first missing file).

- [ ] **Step 3: Create `src/app/(app)/import/daylite/calendar/page.tsx`**

```tsx
import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { DayliteCalendarImport } from "./calendar-client";

export const metadata = { title: "Daylite calendar — Quartzite-6" };

/**
 * Route segment config applies to every Server Action invoked from this page
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * 02-route-segment-config/maxDuration.md → "Server Actions"). Each import
 * call writes for at most 45 s (BATCH_BUDGET_MS) plus one worst-case insert,
 * inside the 60 s ceiling every route here uses.
 */
export const maxDuration = 60;

export default async function DayliteCalendarPage() {
  await requirePerm("manage_users");
  return (
    <div className="pk-content">
      <div style={{ marginBottom: 20 }}>
        <Link href="/import/daylite" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Daylite history
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Daylite calendar</div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".06em",
              color: "#8a6d1f",
              background: "#fbf3dd",
              border: "1px solid #f0e2bd",
              padding: "3px 9px",
              borderRadius: 6,
            }}
          >
            ADMIN
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, maxWidth: 720, lineHeight: 1.5 }}>
          One-off events from Daylite’s Calendar Events export, written into each owner’s own Google Calendar.
          Repeating series are skipped. Preview first — nothing is written until you import, and a re-run
          skips anything already imported.
        </div>
      </div>
      <DayliteCalendarImport />
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/import/daylite/calendar/calendar-client.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import {
  importCalendarBatchAction,
  previewCalendarAction,
  type CalendarBatchResult,
  type CalendarPreviewResult,
} from "./actions";

/**
 * Daylite calendar import (#219). The TSV is read in the browser as text and
 * sent with every call; the server re-parses it each time and keeps only the
 * dedup map. Import is a loop of server calls, each writing for up to 45 s.
 * A re-run skips anything recorded, so Pause, a reload, or a Google
 * rate-limit stop never duplicates an event.
 */

type Preview = Extract<CalendarPreviewResult, { ok: true }>["preview"];
type OwnerRow = Preview["owners"][number];
type Batch = Extract<CalendarBatchResult, { ok: true }>;
type Phase = "idle" | "running" | "paused" | "done";
type OwnerErr = { failed: number; lastError: string };

const ACCENT = "var(--accent)";
/** Mirrors the server's cap — under next.config's 1200 kb action body limit. */
const MAX_CHARS = 1_100_000;
/** JSON-encoded UTF-8 size of the text in the action body (tabs/quotes escape to 2 bytes). */
const MAX_BODY_BYTES = 1_180_000;
const fmt = (n: number) => n.toLocaleString("en-US");

const CAL_LABEL: Record<OwnerRow["calendar"], string> = {
  connected: "Connected",
  "no-calendar": "Mailbox connected — calendar access not granted",
  "not-connected": "No mailbox connected",
  "gmail-off": "Google isn’t enabled",
  "no-user": "—",
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 13,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  padding: "16px 18px",
  marginBottom: 16,
};
const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 8,
};
const errorBox: React.CSSProperties = {
  marginTop: 12,
  background: "#f9ece8",
  border: "1px solid #f0d6cd",
  borderRadius: 9,
  padding: "10px 12px",
  fontSize: 12.5,
  color: "#a0442b",
  lineHeight: 1.45,
};
const warnBox: React.CSSProperties = {
  background: "#fbf3dd",
  border: "1px solid #f0e2bd",
  borderRadius: 9,
  padding: "9px 12px",
  fontSize: 12.5,
  color: "#6f5716",
  lineHeight: 1.45,
  marginTop: 12,
};
const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  padding: "6px 10px",
  borderBottom: "1px solid #ececf0",
  position: "sticky",
  top: 0,
  background: "#fafbfc",
};
const td: React.CSSProperties = { fontSize: 12.5, padding: "6px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const primaryBtn = (enabled: boolean): React.CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 600,
  color: enabled ? "#fff" : "#aab0bb",
  background: enabled ? ACCENT : "#eef0f3",
  border: "none",
  padding: "9px 16px",
  borderRadius: 8,
  cursor: enabled ? "pointer" : "default",
});
const outlineBtn: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  padding: "9px 14px",
  borderRadius: 8,
  cursor: "pointer",
};

export function DayliteCalendarImport() {
  // One import loop at a time: a ref is set synchronously, so a double-click
  // can't start a second loop before React re-renders.
  const lockRef = useRef(false);
  const pauseRef = useRef(false);
  /** Keys that failed this session — sent back so a bad event can't loop. */
  const skipRef = useRef<string[]>([]);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileErr, setFileErr] = useState("");
  const [fromToday, setFromToday] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [tally, setTally] = useState({ written: 0, alreadyThere: 0, failed: 0 });
  const [ownerErrs, setOwnerErrs] = useState<Record<string, OwnerErr>>({});
  const [stoppedOwners, setStoppedOwners] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const running = phase === "running";

  function resetRun() {
    skipRef.current = [];
    setPhase("idle");
    setProgress({ done: 0, total: 0 });
    setTally({ written: 0, alreadyThere: 0, failed: 0 });
    setOwnerErrs({});
    setStoppedOwners([]);
    setNotice("");
  }

  async function pick(f: File | null) {
    setFileErr("");
    setPreview(null);
    setPreviewErr("");
    resetRun();
    if (!f) {
      setFile(null);
      return;
    }
    const text = await f.text().catch(() => "");
    if (!text.trim()) {
      setFile(null);
      setFileErr(`${f.name} is empty or unreadable.`);
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(text)).length;
    if (text.length > MAX_CHARS || bytes > MAX_BODY_BYTES) {
      setFile(null);
      setFileErr(`${f.name} is too large to send in one piece — export a shorter date range from Daylite.`);
      return;
    }
    setFile({ name: f.name, text });
  }

  async function loadPreview(nextFromToday: boolean = fromToday) {
    if (!file) return;
    setPreviewing(true);
    setPreviewErr("");
    let r: CalendarPreviewResult;
    try {
      r = await previewCalendarAction(file.text, nextFromToday);
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : "The preview request failed." };
    }
    setPreviewing(false);
    if (!r.ok) {
      setPreviewErr(r.error);
      return;
    }
    const p = r.preview;
    setPreview(p);
    setInclude((prev) =>
      Object.fromEntries(p.owners.map((o) => [o.owner, o.calendar === "connected" && (prev[o.owner] ?? o.defaultInclude)]))
    );
  }

  async function run() {
    if (!file || !preview || lockRef.current) return;
    let active = preview.owners
      .filter((o) => o.calendar === "connected" && include[o.owner] && !stoppedOwners.includes(o.owner))
      .map((o) => o.owner);
    if (!active.length) return;
    lockRef.current = true;
    pauseRef.current = false;
    setPhase("running");
    setNotice("");
    let first = progress.total === 0;
    let next: Phase = "paused";
    try {
      for (;;) {
        if (pauseRef.current) break;
        let r: CalendarBatchResult;
        try {
          r = await importCalendarBatchAction(file.text, { fromToday, owners: active, skipKeys: skipRef.current });
        } catch (e) {
          r = { ok: false, error: e instanceof Error ? e.message : "The request failed." };
        }
        if (!r.ok) {
          setNotice(`${r.error} — Resume picks up where it stopped.`);
          break;
        }
        const b: Batch = r;
        if (first) {
          setProgress({ done: 0, total: b.pendingAtStart });
          first = false;
        }
        const step = b.written + b.alreadyThere + b.failed;
        setProgress((p) => ({ ...p, done: p.done + step }));
        setTally((t) => ({
          written: t.written + b.written,
          alreadyThere: t.alreadyThere + b.alreadyThere,
          failed: t.failed + b.failed,
        }));
        skipRef.current = [...skipRef.current, ...b.failedKeys];
        setOwnerErrs((prev) => {
          const out = { ...prev };
          for (const [owner, t] of Object.entries(b.byOwner))
            if (t.failed) out[owner] = { failed: (prev[owner]?.failed ?? 0) + t.failed, lastError: t.lastError };
          return out;
        });
        if (b.stoppedOwners.length) {
          active = active.filter((o) => !b.stoppedOwners.includes(o));
          setStoppedOwners((s) => [...s, ...b.stoppedOwners]);
        }
        if (b.stoppedFor === "quota") {
          setNotice(
            `Google’s rate limit stopped the import (${b.quotaMessage}). Wait a few minutes, then Resume — nothing is imported twice.`
          );
          break;
        }
        if (b.stoppedFor === "done" || !active.length) {
          next = "done";
          break;
        }
      }
    } finally {
      lockRef.current = false;
      setPhase(next);
    }
    await loadPreview();
  }

  const selected = preview
    ? preview.owners.filter((o) => o.calendar === "connected" && include[o.owner] && !stoppedOwners.includes(o.owner))
    : [];
  const toImport = selected.reduce((n, o) => n + o.toImport, 0);
  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : phase === "done" ? 100 : 0;
  const errOwners = Object.entries(ownerErrs);

  return (
    <>
      <div style={card}>
        <div style={sectionLabel}>1 · Calendar Events export</div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px dashed #d9dce2",
            borderRadius: 10,
            padding: "11px 12px",
            fontSize: 12.5,
            cursor: running ? "default" : "pointer",
            background: running ? "#f4f5f7" : "#fafbfc",
            color: file ? "#16181d" : "#8c919c",
            maxWidth: 520,
          }}
        >
          <input
            type="file"
            accept=".tsv,.txt,text/tab-separated-values,text/plain"
            disabled={running}
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file ? `${file.name} · ${fmt(file.text.length)} characters` : "Choose Calendar Events.tsv…"}
          </span>
        </label>
        <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 5, maxWidth: 720, lineHeight: 1.45 }}>
          A repeating series (the same person and name four or more times) is skipped — set those up once in Google
          as real repeating events.
        </div>
        {fileErr && <div style={errorBox}>{fileErr}</div>}
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            style={primaryBtn(!!file && !previewing && !running)}
            disabled={!file || previewing || running}
            onClick={() => void loadPreview()}
          >
            {previewing ? "Reading…" : preview ? "Refresh preview" : "Preview"}
          </button>
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, color: "#3b3f47" }}>
            <input
              type="checkbox"
              checked={fromToday}
              disabled={running}
              onChange={(e) => {
                const v = e.target.checked;
                setFromToday(v);
                if (preview) void loadPreview(v);
              }}
            />
            Only events from today on
          </label>
        </div>
        {previewErr && <div style={errorBox}>{previewErr}</div>}
      </div>

      {preview && (
        <div style={card}>
          <div style={sectionLabel}>2 · Preview</div>
          <div style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 10, lineHeight: 1.5 }}>
            {fmt(preview.totals.rows)} events read · {fmt(preview.totals.oneOffs)} one-offs ·{" "}
            {fmt(preview.totals.seriesCount)} repeating series skipped ({fmt(preview.totals.seriesRows)} rows)
            {preview.totals.duplicates ? ` · ${fmt(preview.totals.duplicates)} duplicate rows imported once` : ""}
            {preview.fromYmd ? ` · from ${preview.fromYmd} on` : ""}
          </div>
          <div style={{ overflow: "auto", border: "1px solid #ececf0", borderRadius: 10, maxHeight: 420 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Import</th>
                  <th style={th}>Owner</th>
                  <th style={th}>Team member</th>
                  <th style={th}>Google Calendar</th>
                  <th style={thNum}>One-offs</th>
                  <th style={thNum}>Already imported</th>
                  <th style={thNum}>To import</th>
                  <th style={thNum}>Series skipped</th>
                </tr>
              </thead>
              <tbody>
                {preview.owners.map((o) => {
                  const connected = o.calendar === "connected";
                  const stopped = stoppedOwners.includes(o.owner);
                  return (
                    <tr key={o.owner}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          aria-label={`Import ${o.owner}`}
                          checked={connected && !stopped && !!include[o.owner]}
                          disabled={!connected || stopped || running}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setInclude((p) => ({ ...p, [o.owner]: v }));
                          }}
                        />
                      </td>
                      <td style={td}>{o.owner}</td>
                      <td style={td}>{o.userName ?? <span style={{ color: "#a0442b" }}>{o.matchNote}</span>}</td>
                      <td style={{ ...td, color: connected ? "#2f6b3a" : "#8a6d1f" }}>
                        {stopped ? "Stopped — see errors below" : CAL_LABEL[o.calendar]}
                      </td>
                      <td style={num}>{fmt(o.oneOffs)}</td>
                      <td style={num}>{fmt(o.alreadyImported)}</td>
                      <td style={num}>{fmt(o.toImport)}</td>
                      <td style={num}>{fmt(o.seriesRows)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.owners.some((o) => o.series.length > 0) && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12.5, cursor: "pointer", color: "#5b616e" }}>Repeating series skipped</summary>
              <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: "8px 0 0", paddingLeft: 18 }}>
                {preview.owners.flatMap((o) =>
                  o.series.map((g) => (
                    <li key={`${o.owner}|${g.name}`}>
                      {o.owner} — {g.name} <span style={{ color: "#8c919c" }}>× {fmt(g.count)}</span>
                    </li>
                  ))
                )}
              </ul>
            </details>
          )}
          {preview.owners.some((o) => o.calendar !== "connected" && o.toImport > 0) && (
            <div style={warnBox}>
              People without a connected Google Calendar are skipped. They can connect their mailbox with calendar
              access in Settings → Mailboxes; then Refresh preview. Nothing is ever written to someone else’s calendar.
            </div>
          )}
          {preview.errors.length > 0 && (
            <div style={warnBox}>
              <strong>
                {fmt(preview.errors.length)} row{preview.errors.length === 1 ? "" : "s"} couldn’t be read and will be
                skipped:
              </strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {preview.errors.slice(0, 50).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
              {preview.errors.length > 50 && <div>…and {fmt(preview.errors.length - 50)} more.</div>}
            </div>
          )}
        </div>
      )}

      {preview && (
        <div style={card}>
          <div style={sectionLabel}>3 · Import</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {running ? (
              <button
                type="button"
                style={outlineBtn}
                onClick={() => {
                  pauseRef.current = true;
                }}
              >
                Pause after this batch
              </button>
            ) : (
              <button type="button" style={primaryBtn(toImport > 0)} disabled={toImport === 0} onClick={() => void run()}>
                {phase === "paused"
                  ? `Resume (${fmt(toImport)} left)`
                  : `Import ${fmt(toImport)} event${toImport === 1 ? "" : "s"}`}
              </button>
            )}
            <span style={{ fontSize: 12.5, color: "#5b616e" }}>
              {running && `Importing… ${fmt(progress.done)} of ${fmt(progress.total)}`}
              {phase === "paused" && "Paused."}
              {phase === "done" &&
                `Done — ${fmt(tally.written)} written, ${fmt(tally.alreadyThere)} already in Google, ${fmt(tally.failed)} failed.`}
            </span>
          </div>
          {phase !== "idle" && (
            <div style={{ marginTop: 12, height: 8, borderRadius: 4, background: "#eef0f3", overflow: "hidden", maxWidth: 520 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: ACCENT, transition: "width .3s" }} />
            </div>
          )}
          {notice && <div style={errorBox}>{notice}</div>}
          {errOwners.length > 0 && (
            <div style={warnBox}>
              <strong>Google errors (these events were not imported; a later run retries them):</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {errOwners.map(([owner, e]) => (
                  <li key={owner}>
                    {owner}: {fmt(e.failed)} failed{stoppedOwners.includes(owner) ? " (stopped)" : ""} — {e.lastError}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Link from `/import/daylite`**

In `src/app/(app)/import/daylite/page.tsx`, replace:

```tsx
          imported.
        </div>
      </div>
      <DayliteHistory stageLabels={stageLabels} />
```

with:

```tsx
          imported.
        </div>
        <Link
          href="/import/daylite/calendar"
          style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
        >
          Calendar events → each person’s Google Calendar
        </Link>
      </div>
      <DayliteHistory stageLabels={stageLabels} />
```

`Link` is already imported in that file.

- [ ] **Step 6: Run the gates, including the build**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-219.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-219.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-219.log"; grep -c '^PASS #219' "${TMPDIR:-/tmp}/specs-219.log"; tail -1 "${TMPDIR:-/tmp}/specs-219.log"
npx eslint "src/app/(app)/import/daylite/calendar/page.tsx" "src/app/(app)/import/daylite/calendar/calendar-client.tsx" "src/app/(app)/import/daylite/page.tsx" scripts/test-review-and-spec.ts; echo "eslint exit $?"
ps aux | grep -E "next dev|tsx" | grep -v grep || echo "no strays"
npx next build > "${TMPDIR:-/tmp}/build-219.log" 2>&1; echo "build exit $?"; grep -E "import/daylite/calendar|Error|Failed" "${TMPDIR:-/tmp}/build-219.log" | head -10
```

Expected:
- `tsc exit 0`.
- Specs: `exit 0`, PASS = BASE + 77, no FAIL lines, `#219` PASS count 77, `ALL PASSED`.
- `eslint exit 0`.
- `build exit 0`, with the route list showing `/import/daylite/calendar`.

If the build reports a server module (for example `postgres` or `node:crypto`) in a client bundle, the client imported a value from something other than `./actions`. Fix the import; do not suppress the error.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/import/daylite/calendar/page.tsx" "src/app/(app)/import/daylite/calendar/calendar-client.tsx" "src/app/(app)/import/daylite/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(import): Daylite calendar import screen with resumable progress (#219)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

**Spec coverage:**

| Spec item | Where it is covered |
|---|---|
| Parser: U+202F, quoted fields, all-day vs timed, multi-day, `0 → 60`, bad rows | Task 1 |
| Classifier with the ≥ 4 threshold | Task 1 |
| `eventKey` as a stable hash | Task 1 (golden value) |
| America/Chicago wall clock, never UTC | Task 1 body + Task 2 `insertZonedEvent` |
| Summary and description format | Task 1 |
| Owner matching, exact then first + last | Task 1 |
| Calendar-scope check; unmatched or unconnected owners reported and skipped | Task 2 (`calendarStates`, `selectPending`) |
| Admin gate | Task 2 actions + Task 3 page |
| Screen: upload, per-owner preview, series list, parse errors, from-today option (default off), per-owner include (default on when connected) | Task 3 |
| 45 s batches, resumable, progress | Task 2 runner + Task 3 loop |
| Dedup blob `dayliteCalendarImport`; re-run skips | Task 2 |
| Google errors per owner; quota stop and resume | Task 2 + Task 3 |
| Link from `/import/daylite` | Task 3 |
| No local copy of events | Task 2 (the text is re-parsed per call) |

**Type consistency:**
- `WallClockEventBody` (Task 1) is assignable to `ZonedEventBody` (Task 2).
- `CalendarPreview` / `BatchResult` flow through `actions.ts` into the client via `Extract`.
- `pendingAtStart`, `failedKeys` and `stoppedOwners` are named identically in the runner, the tests and the client.

**Assertion counts:**
- Task 1: 38 `ok(…)` calls.
- Task 2: 33.
- Task 3: 6.
- The pure parts of Tasks 1–2 (the modules above plus 64 of these assertions) were dry-run in a scratch copy with `tsx` and strict `tsc`: all pass. If the implementer's count differs, recount the `ok(` calls in the appended blocks rather than chasing the number.
