# Morning triage — design

Date: 2026-10-09 · Status: approved in brainstorm (remaining details
delegated to Claude by Jeff, 2026-10-09) · Punch #: assigned at merge.

Spec 4 of 4 from Jeff's "App ideas" list. Independent of specs 1–3 except
that it reads spec 3's at-risk flag and spec 2's visit flags **when present**
(each feed degrades to its pre-spec form if that spec isn't built).

## Goals

- Each rep logs in and sees **one ranked list** — about ten items, "See
  more" for the rest — telling them what to do first.
- Every row shows its **source** and **why it's ranked there**.
- A call item shows the **transcript line it came from**, because extracted
  action items can be wrong or duplicated.
- Deterministic — no AI (D89).

## Non-goals

- A team rollup view (each person sees their own; admins can switch person).
- Push / email digests.
- Changing how any source works (the bell, My Queue, Inbox stay).

## Decisions from the brainstorm

| Question | Answer |
|---|---|
| Who gets the list | Each person their own; admins can view a teammate's |
| "Waiting" email | Unanswered customer message ≥ **1 business day** (weekends excluded) is *Waiting*; younger ones still appear, ranked lower |
| Refresh | **Morning + one midday run** — snapshot at 7:00 and 12:00 Central, frozen between |
| Where | **Top of Home** — a "Start here" card; "See more" opens the full ranked list |
| Feeds | Emails, Krisp calls, tasks + lead SLA/follow-ups, today's site visits, quotes awaiting you, renewals due |
| Ranking | **Points with a visible reason** |
| Unmatched call to-do | Shown, marked "Source line not found — open the meeting" |
| Row actions | Click opens the source; **Done**, **Snooze till tomorrow**, **Not mine / dismiss** |

## Feeds (`src/lib/triage/feeds/*`, one module per source)

Each feed returns `TriageCandidate { key, source, title, href, facts }` for
one user; `key` is stable (`email:<threadId>`, `call:<recordingId>:<itemKey>`,
`task:<id>`, `asg:<id>`, `lead:<id>`, `visit:<id>`, `quote:<id>`,
`renewal:<kind>:<id>`).

- **Email** — threads assigned to the user with `status === "waiting_us"`
  (`src/lib/stores/comms.ts`); facts: business hours waiting
  (`waitingSince`), linked open quote/lead value.
- **Calls** — Recordings (`src/lib/stores/recordings.ts`) owned by or
  attributed to the user from the last 7 days, action items with
  `disposition === "pending"`; facts: assignee match, due date, the matched
  transcript line (below). When #323 meetings land, a second adapter reads
  `MeetingTodo`s with no decision — same candidate shape.
- **Tasks / assignments** — open, assigned to the user: overdue, due today,
  due tomorrow, and (if spec 3 is built) at-risk; facts: tier, days overdue.
- **Leads** — `followUpInfo()` urgency (`src/lib/stores/leads.ts`): SLA
  breached, SLA due within 4 h, overdue next action, stale.
- **Site visits** — today's visits where the user is lead or attendee;
  facts: start time, address/conflict flags (specs 1–2 if built).
- **Quotes** — submitted for the user's approval
  (`quote-approval-rules.ts`), portal quotes to review, quotes sent back to
  the user as owner.
- **Renewals** — the user's flame/inspection renewals in their outreach
  window or past due (the #37 worklists).

## Ranking (`src/lib/triage/rank.ts`, pure)

Points per fact; a row's score is the sum; ties → older first → key.

| Fact | Points |
|---|---|
| Lead SLA breached | 60 |
| Site visit today | 50 |
| Task overdue | 40 + 5/day (cap +30) |
| Customer waiting ≥ 1 business day | 40 + 10/extra business day (cap +30) |
| Quote awaiting my approval | 35 |
| Lead SLA due within 4 h | 35 |
| Task due today | 30 |
| Call to-do (pending, ≤ 7 days) | 30 |
| Portal quote to review / quote sent back to me | 30 |
| Renewal past due | 30 |
| Lead next action overdue | 25 |
| Task at risk (spec 3) | 15 |
| Thread/to-do linked to an open quote or lead | +10 |
| Call to-do names me as assignee | +10 |
| Visit has an address or conflict flag | +10 |
| Task High tier / Low tier | +15 / −10 |
| Renewal in outreach window | 15 |
| Task due tomorrow | 15 |
| Customer message < 1 business day | 10 |
| Lead stale | 10 |

The row's **reason** is its top two contributing facts in words, e.g.
"Customer waiting 2 business days · open quote $18,400".

### Duplicates

Call to-dos whose normalized title (lowercase, stopwords and punctuation
removed) matches an open task or assignment of the user, or another call
to-do already in the list, collapse into one row: "Also mentioned in
<meeting> (<date>)". A to-do already accepted into a task is not a candidate
(its task is).

## Transcript line match (`src/lib/triage/transcript-match.ts`, pure)

For a call to-do, score each transcript segment by word overlap with the
to-do title (normalized tokens, stopwords removed): matched-token share of
the to-do's tokens. Best segment with share ≥ 0.5 and ≥ 2 matched tokens →
shown under the row as `Speaker — "line…" (12:34)` with a link to that
moment in the recording. Otherwise "Source line not found — open the
meeting".

## Snapshots and refresh

- A snapshot per user per slot (`morning` 7:00, `midday` 12:00 Central) is
  stored as a doc (`triage_snapshots`, key `<userId>:<YYYY-MM-DD>:<slot>`):
  the ranked candidate keys, scores and reasons.
- Built by the existing daily cron (morning) and a new daily cron entry at
  17:00 UTC (midday) — both once a day, Hobby-plan safe — and **lazily** on
  the first Home view after a slot boundary if the cron didn't build it.
- Between runs the list is frozen, except: rows whose source is now done
  (task done, thread replied/closed, to-do decided, quote approved) are
  hidden on render, and snoozed/dismissed rows are hidden.

## Row actions

- **Open** — click goes to the source (thread, meeting moment, task, lead,
  visit, quote, renewal row).
- **Done** — task/assignment → done; thread → closed; call to-do → opens the
  meeting's to-do decision (accept as task / dismiss) rather than guessing;
  lead/quote/visit/renewal rows → "Done for today" (hidden until the next
  snapshot that still includes it).
- **Snooze till tomorrow** — hidden until the next morning snapshot.
- **Not mine / dismiss** — hidden for good for that key; a call to-do is
  dismissed on its recording; an email thread offers Reassign.
- Marks stored per user (`triage_marks`, key `<userId>:<itemKey>`).

## Home card

"Start here" at the top of Home: the top 10 rows (rank, source icon, title,
reason, call line when present, actions), slot label ("Morning list ·
built 7:02"), and **See more** → `/triage` (the full ranked list, same
rows). Admins get a person picker on `/triage`.

## Failures

- A feed throws → the list still builds from the others and shows "Email
  couldn't be read — list may be incomplete" (per feed).
- No snapshot and lazy build fails → live-computed list with a note.

## Testing (`test:specs`)

- Business-day waiting math across weekends; < 1 day vs ≥ 1 day.
- Points table: each fact; caps; ties deterministic; reason = top two facts.
- Transcript match: hit above threshold, miss below, stopwords ignored,
  ≥ 2-token floor.
- Duplicate collapse: to-do vs open task, to-do vs to-do; accepted to-do
  excluded.
- Snapshot key per slot; lazy build when missing; done-source rows hidden;
  snooze returns next morning; dismiss permanent.
- A failing feed doesn't fail the list.
