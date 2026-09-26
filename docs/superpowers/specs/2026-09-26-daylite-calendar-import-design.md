# Punch #219 — Import Daylite calendar events into each person's Google Calendar

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks`. Jeff asked ("Did we figure out a way to import
calendar events out of Daylite? I really want to import it to track with my calendar") and approved
queuing "one-off events into each person's Google Calendar, repeating series skipped". Jeff was away
while this was designed; the defaults below are logged as decisions.

## Source
`Calendar Events.tsv` (Dropbox, UTF-8, tab-delimited, quoted, leading blank column). Columns:
`Duration (HH:MM)`, (blank), `Category`, `Start Date` (`M/D/YY, h:mm AM|PM`, with a narrow no-break
space U+202F before AM/PM), `Status`, `Name`, (blank), `Duration` (text, "1 hour", "1 day"),
`Linked` (text), `Owner` (a person's full name), `Details` (free text / URLs). 2,288 rows,
2025-01-01 → 2028-12-25, 8 owners. ~733 rows are expanded repeats (same owner + same name ≥ 4
times: weekly meetings, rent, payroll); ~1,555 are one-offs. Categories include Service Call,
Install, TourWerks, PTO, Meeting, Training, Phone Call, blank.

## Rules (pure, `src/lib/daylite/calendar-events.ts`)
- `parseCalendarTsv(text) → { rows: DayliteEvent[]; errors: { line, reason }[] }` —
  `DayliteEvent = { line, owner, name, category, start: { y, m, d, hh, mm }, durationMin, allDay,
  linked, details, status }`. `Duration (HH:MM)` "24:00" or more with a midnight start → all-day
  (multi-day when ≥ 48:00); otherwise a timed event of that many minutes (0 → 60).
- `classify(rows) → { oneOffs, series: { owner, name, count }[] }` — a series is owner + name
  (case/space-insensitive) occurring ≥ 4 times; all its rows are skipped.
- `eventKey(e)` = stable hash of owner|name|start|durationMin — the dedup key.
- Times are wall-clock in the business time zone `America/Chicago` (Peak is in Wisconsin) and are
  sent to Google with that `timeZone`, never converted through UTC.
- Event body: summary = `name` (prefixed `[Category] ` when a category is set); description =
  `details` + (`Linked: <linked>` when set) + `Imported from Daylite`.

## Owners → calendars
- Owner name matches an app user by exact case-insensitive full name (else first + last token).
- The event goes into that user's primary Google Calendar through the existing calendar write path
  (`src/lib/google/calendar.ts` `insertEvent`, the mailbox connection that carries the
  `calendar.events` scope). An owner with no matching user, or a user whose mailbox has no calendar
  scope, is reported and skipped — never written to someone else's calendar.

## Screen: `/import/daylite/calendar` (admin, `manage_users`), linked from `/import/daylite`
1. Upload the TSV (≤ 5 MB, parsed on the server).
2. Preview: per owner — matched user / calendar connected?, one-offs to import, already imported,
   series skipped (listed with counts), parse errors. Options: "Only events from today on" (default
   **off** — history is wanted), per-owner include checkboxes (default on for owners with a
   connected calendar).
3. Import: writes in batches under a 45 s budget per request and is resumable (the page re-posts
   until done, showing progress), recording each written key → Google event id in the settings
   blob `dayliteCalendarImport` (`{ [eventKey]: { eventId, owner, at } }`). A re-run skips recorded
   keys, so importing twice never duplicates. Google errors are counted per owner and shown; a quota
   / rate error stops the batch and lets the user resume later.
- No local copy of events is kept beyond the dedup map; the calendar view already reads Google.

## Not in scope
Re-creating repeating series (Jeff sets those up once in Google as real repeating events); linking
events to companies/projects; importing Daylite tasks; deleting imported events.

## Testing
Parser (U+202F, quoted fields, all-day vs timed, bad rows), classifier (series threshold), key
stability, owner matching, batch/resume logic with an injected fake `insertEvent` (dedup on
re-run, quota stop), admin gate. Four gates + `next build`.
