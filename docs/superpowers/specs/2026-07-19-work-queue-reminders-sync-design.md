# Work Queue & Reminders Sync — Design

**Date:** 2026-07-19
**Status:** Approved by Jeff (brainstorming session 2026-07-19, memory-repo session)
**Home:** peak-app for the queue + assignments. The sync agent and pipeline
suggestions run in the Claude Memory system on the Mac mini; this spec defines
the contract between them.

## Problem / goal

Open commitments are scattered across the app (reviews, checklist items,
milestones, project tasks, renewals) and delegated asks arrive by text or in
meetings and get lost. Jeff wants them in his daily to-do without building
"yet another to-do app" — his words: there are a million of those, and adding
one is overwhelming.

Goal: every open commitment surfaces in one place per person; Jeff's also land
in Apple Reminders (list **"Peak"**) so his phone stays the single thing he
checks. The app is a task **source**, not a task destination.

## Key technical constraint (why the design looks like this)

**Apple publishes no cloud API for Reminders.** Access is local-device only —
AppleScript/osascript, EventKit, or Shortcuts, running on a signed-in Mac or
iPhone. peak-app is a hosted web app (`vercel.json`), so its server can never
write to Reminders directly. Anything that creates a reminder must run on
Jeff's Mac.

Dead ends deliberately not taken: subscribed `.ics` feeds (read-only, poor
VTODO support on Apple platforms) and iCloud CalDAV (undocumented, fragile).
Todoist/TickTick have real REST APIs but would mean switching task apps.

Existing infrastructure this builds on: `pref-action-items-to-reminders`
(2026-07-13 standing preference — push action items to the "Peak" list via the
`Control_your_Mac` osascript bridge), the scheduled morning-brief run, and the
hourly iMessage pipeline capturing Jack/Jena/Bri.

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| Shape | Derived queue + Reminders push; app is a task source, not a to-do app |
| Sync direction | Two-way for **assignments only**; derived items are one-way |
| Capture of delegated asks | In-app quick-add + pipeline *suggestions* confirmed in the daily brief (never auto-created) |

## Component A — My Queue (peak-app, derived)

A screen showing the signed-in user's open items, assembled from records that
already exist — **no new data model**, so the queue cannot drift out of sync
with reality:

- Phase reviews and quote reviews awaiting the user.
- Unchecked standards-checklist items on active phase reviews (per the review
  checklists spec, same date).
- Engagement milestones coming due.
- `ProjectTask` rows (`projects.ts` — already has `assignee`, `done`) assigned
  to the user and not done.
- Flame-test and inspection renewals due.
- Quote follow-ups.

Each row shows: what it is, what it's attached to (company / engagement /
project), due date, and a link to the record where the work happens. Each user
sees their own queue; viewing another person's queue is allowed (the shared
visibility a personal Reminders list can't provide).

Exact source list and due-window thresholds are settled at implementation; the
assembly is one server loader, projects-module pattern.

## Component B — Assignments (the one new record)

New doc-store collection `assignments`, deliberately minimal: title, assignee,
optional due date, optional link (company / engagement / project), createdBy,
createdAt, done, doneAt, doneVia (`app` | `reminders`).

Quick-add from anywhere in the app by any signed-in user (Jeff, Jack, Jason,
Jena). This is the "Jena says reach out to someone" case.

**Explicitly not included:** subtasks, sub-projects, priorities, recurrence,
tags. That restraint is the point — it keeps the app from competing with
Reminders.

## Component C — Reminders sync agent (Mac mini, scheduled)

Runs on a schedule alongside the morning brief:

1. Pull Jeff's open queue (derived items + assignments) from the app over an
   authenticated read-only endpoint (`/api/queue`, machine token). Token lives
   in the macOS keychain / local env — **never** in memory files or the repo.
   Works against `localhost:3000` today and the deployed URL once online.
2. Reconcile against the "Peak" Reminders list via the osascript bridge:
   - queue item with no reminder → create one (short imperative text, due date
     when known, link back to the record)
   - reminder whose underlying record has closed → complete it
   - everything else → no-op
3. **Write-back, assignments only:** an assignment completed in Reminders is
   marked done in the app (`doneVia: "reminders"`) on the next run. Derived
   items never write back — a phone checkbox must not approve a review or
   close a milestone.
4. Maintain an **id-map ledger** on the mini (queue item id ↔ reminder id) so
   runs are idempotent, duplicates are impossible, and reminders Jeff deleted
   by hand are not resurrected.

## Component D — Pipeline suggestions (Claude Memory side)

The existing iMessage and Krisp pipelines propose action items into the daily
brief as **suggested assignments** (source, who said it, suggested assignee and
link). Jeff confirms with one line; confirmed items are created in the app as
assignments and flow out through Component C. Nothing is auto-created — a
misparsed text must never silently become a task, or the queue stops being
trusted.

## Error handling

- Agent is reconciling and idempotent: a failed, retried, or doubled run
  cannot duplicate reminders.
- App unreachable → log and change nothing; the ledger does not advance.
- osascript/Reminders failure on one item → log, continue with the rest,
  report in the next brief.
- Write-back is restricted by type at the API layer, not just in the agent, so
  a buggy client cannot close derived records.

## Testing

- Queue assembly per source; assignee filtering; empty-queue state.
- Assignment CRUD; done via app vs via reminders write-back.
- Agent reconciliation matrix: add / complete / underlying-closed / no-op /
  hand-deleted reminder / app unreachable.
- API authorization: unauthenticated read rejected; write-back rejected for
  non-assignment item types.

## Out of scope (this phase)

Recurring tasks, subtasks, priorities, time tracking, calendar blocking, any
non-Apple task app, and pushing other people's queues to their own devices
(Jack/Jason/Jena use the in-app queue; their own Reminders sync can come later
if it proves useful).
