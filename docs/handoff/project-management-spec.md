# Project Management — functional specification (handoff)

Status: written 2026-11-19 from the code in this repository, for a team that will rebuild the
feature in a different application. Project Management is being removed from this app.

How to read this document

- It describes behaviour, not implementation. Where a rule is stated as "MUST", the current code
  enforces it and a rebuild should too.
- "Peak" means the business that owns the app (Peak Systems Group, a theatrical rigging, drapery,
  lighting and AV contractor). "Staff" means signed-in team members. "Customer" means a company in
  the CRM. "Venue" means one of a customer's physical locations.
- Every section ends with a **Source** line listing the repository files it was derived from.
  Paths are relative to the repository root.
- "Not verified" means the behaviour was taken from project notes or a code comment and was not
  traced through the code. Section 18 collects all of these.
- Where project documentation and code disagree, the code is described and the disagreement is
  noted (section 17).
- All numbers (rates, limits, thresholds) are the values in the code on the date above.

Contents

1. Purpose, users and scope
2. Shared conventions
3. Install projects and sales orders
4. Schedule
5. Field Work
6. Repairs
7. Rentals
8. Consulting project management
9. Tasks, assignments and My Queue
10. Auto task calendar
11. Site-visit scheduling
12. Address verification and drive time
13. Calendar
14. Morning triage ("Start here")
15. Integrations and background jobs
16. Settings that belong to this area
17. Known gaps and doc-versus-code disagreements
18. Not verified

---

## 1. Purpose, users and scope

"Project Management" is everything that happens after a quote is won, plus the layer that plans
each person's working day.

| Area | What it does | Route |
| --- | --- | --- |
| Install projects | A won system quote becomes a project (has install labor) or a sales order (materials only). Tracks stage, procurement lines and lead times, deliveries, crew bookings, a task checklist, field notes, time logs and customer sign-off | `/projects`, `/projects/<id>` |
| Schedule | A crew board (people × days), a project timeline (lead times → install windows, plus consulting engagements), and a by-person view of all work | `/schedule` |
| Field Work | The on-site day view: today's jobs for me or the team, with tasks, notes and time, usable offline | `/field-work` |
| Repairs | Auto-priced repair quotes; a won quote becomes a repair job that is scheduled, completed and then tracked for warranty | `/repairs/...` |
| Rentals | A rentable-gear list with per-location stock, an auto-priced rental quote, and a booking board | `/rentals/...` |
| Consulting PM | Generates a consulting engagement's task dates and milestone dates from a start date, an end date and phase weights; a Schedule tab and an Activity tab on the engagement | `/design/engagements/<id>`, `/task-templates` |
| Tasks and My Queue | A cross-record task list, ad-hoc assignments, and one derived list of each person's open commitments | `/queue` |
| Auto task calendar | Places every open assigned task into the person's free work time and flags work that cannot finish by its due date | `/calendar` (Week and Day views), Home "Today" card |
| Site-visit scheduling | Booking a visit with a lead and attendees, conflict checks, nearby-day suggestions and per-person invites | booking panel on several screens |
| Drive time | Computes the drive legs between a person's stops for each day and mirrors them to Google Calendar | `/calendar`, Home |
| Calendar | Month, week and day views over Google Calendar, site visits, drive blocks and task blocks | `/calendar` |
| Morning triage | A ranked "Start here" list per person, rebuilt twice a day | Home, `/triage` |

Users are all staff. There are four roles; a role grants permissions:

| Role | Permissions |
| --- | --- |
| Admin | `manage_users`, `approve`, `create`, `send` |
| Manager | `approve`, `create`, `send` |
| Estimator | `create`, `send` |
| Reviewer | `approve` |

Nothing in this document is customer-facing except the printed repair and rental documents.
Nothing in this document uses AI. All prices, schedules and rankings are computed by fixed rules.

Out of scope here (specified elsewhere or staying in the main app): the Estimator and Quotes hub,
the CRM, flame tests and rigging inspections, the customer portal, the Inbox, Krisp meetings, the
Design tab. Where those features feed this one (for example, an inspection finding becomes a
repair), the interface is described.

**Source:** `src/components/nav/nav-data.ts`, `src/lib/team.ts`, `AGENTS.md` (phases 4, 5, 11, 12,
44, 45, 48, 49), `docs/handoff/README.md`.

---

## 2. Shared conventions

These apply to every section below.

### 2.1 Records and ids

Records are JSON documents stored one per row with a collection name, an id, a revision counter,
an `updatedAt` and a soft-delete flag. Deleting a record sets the flag; nothing is physically
removed. A soft-deleted record is invisible to every read unless the read asks for deleted rows.

| Record | Collection | Id format |
| --- | --- | --- |
| Project | `projects` | `P-####`, numbered from 3000 |
| Sales order | `projects` | `S-####`, numbered from 4000 |
| Repair job | `repair_jobs` | `RP-####`, numbered from 4000 |
| Task | `tasks` | `T-####` from 6000 (office-created); `tk-` + up to 16 lowercase letters/digits (created on a field device); `T-auto-<slug>` (system-created); `T-asr-…` (assessment reminders); `T-mtg-…` (meeting to-dos); `T-prm-…` (email promise tasks) |
| Assignment | `assignments` | `as-` + 8 random base-36 characters |
| Task template set | `task_templates` | `TT-###`, numbered from 100 |
| Rental item | `equipment_items` | `eq-#`, numbered from 0 |
| Rental location | `equipment_locations` | `loc-#`, numbered from 0 |
| Rental booking | `equipment_bookings` | `bk-#`, numbered from 0 |
| Site visit | `site_visits` | `SV-####`, numbered from 5000 |
| Consulting engagement | `consulting_engagements` | `CE-####` |
| Triage snapshot | `triage_snapshots` | `<userId>:<YYYY-MM-DD>:<morning or midday>` |
| Triage mark | `triage_marks` | `<userId>:<itemKey>` |

Numbered ids MUST be allocated atomically (insert with the next free number, retry on collision).
The code replaced several "count the rows and add one" allocators because two concurrent creates
produced the same id and the second overwrote the first.

Sub-records embedded in a parent use a prefix plus 6 random base-36 characters: procurement line
`pl-`, delivery `dl-`, crew assignment `cw-`, mobilization `mb-`, project note `nt-`, time log
`tl-`, milestone `ms-`, engagement phase `ph-`.

### 2.2 Other conventions

- Timestamps are epoch milliseconds. Dates entered in a date field are stored as local midnight
  (or local noon in the consulting screens).
- People are identified by display NAME on older records (project owner, crew person, assignment
  assignee, visit lead) and by user id on newer ones (task `assigneeUserId`). Both exist; a
  rebuild should use user ids throughout. Name comparison where it matters is trimmed and
  case-insensitive.
- "Chicago day" means a calendar day in the `America/Chicago` time zone. Drive time, the task
  planner, triage and due dates all use Chicago days so that a server in UTC and a browser in
  Wisconsin agree. Day arithmetic MUST be daylight-saving safe (a 23- or 25-hour day is one day).
- Money shown to staff is rounded to whole dollars. Markup means markup on cost:
  `sell = cost × (1 + markup)`.
- Every server action that reads or writes data MUST authenticate itself. There is a middleware
  login gate, but the code treats it as a convenience, not as the control.
- When a fallback owner is needed and none is known, the code uses the literal name
  `"Jeff Chesebro"`. A rebuild should replace this with an explicit unassigned state.

### 2.3 What happens when a quote is won

A quote has a `quoteType`. When its status changes, one router decides what to create. The router
runs inside the same database transaction as the status change.

| Quote type | On status change |
| --- | --- |
| `system` (or blank, or unknown) | On Won: create a project or sales order (section 3.3) |
| `repair` | On Won: create a repair job (section 6.3) |
| `rental` | On Won: create one confirmed booking per quote line (section 7.4) |
| `flame_test`, `inspection` | On Won: create their own job records (out of scope here). An inspection also creates a linked "shadow" project (section 3.3) |
| `consulting` | On Sent: create the engagement at stage "Proposal sent". On Won: create it at "Awarded" or advance it from "Proposal sent" to "Awarded". On Lost while "Proposal sent": close it. On Sent again while closed: reopen it to "Proposal sent" |

Rules

- Every creator MUST be idempotent on the quote id: asking twice returns the existing record.
- Every creator MUST take a per-quote lock for its check-then-insert, so two simultaneous
  approvals cannot create two records.
- A deleted downstream record MUST NOT be re-created. Projects record the quote id on a
  "dismissed" list when a quote-born project is deleted. Repair jobs and rental bookings treat a
  soft-deleted record as still covering its quote.
- A failure to obtain the per-quote lock in time MUST NOT undo the status change. It is logged, and
  a reconciliation sweep that runs when the relevant dashboard loads creates the missing record.
- Marking a system quote Won also creates one assignment for the quote's owner, titled
  "Install sold — reach out: <quote name>", linked to the quote (section 9.2).
- Re-approving an already-won quote from a repair or rental builder replays the router so a
  missing record is created.

**Source:** `src/db/doc-store.ts`, `src/db/doc-tables.ts`, `src/lib/stores/quote-spawn.ts`,
`src/lib/stores/quotes.ts` (`setStatus`), `src/lib/project-quote-types.ts`,
`src/lib/consulting-stages.ts` (`engagementSyncAction`), `src/lib/safe-sweep.ts`,
`src/lib/drive-plan/day.ts`, `src/lib/task-ids.ts`.

---

## 3. Install projects and sales orders

### 3.1 Purpose

A project is the post-sale record of a job that includes install labor. A sales order is the
same record with `kind: "order"` for a materials-only sale. Both live in one collection and share
one screen.

### 3.2 Data model

Project record

| Field | Meaning |
| --- | --- |
| `id` | `P-####` (project) or `S-####` (order) |
| `kind` | `"project"` or `"order"` |
| `quoteId` | The won quote, or null for a hand-made or imported record |
| `projectType` | The quote's type at conversion (`system`, `repair`, `inspection`, …); null on older records |
| `name` | Copied from the quote name |
| `customer`, `customerId` | Display name and CRM company id |
| `billToCompanyId` | Optional. The awarded bidder (a general or electrical contractor) Peak contracts with. The customer stays the owner |
| `locationId` | The venue |
| `owner` | Team-member name, copied from the quote owner |
| `value`, `margin` | Copied from the quote. `margin` holds a markup fraction |
| `valueUnknown` | True on an imported record whose value was not known. Such a record counts as 0 in every total and displays "UKN" |
| `performanceBonusPool` | Optional. The dollar cost of the won quote's 5 % package bonus. Present only when greater than 0 |
| `projectPricing` | Optional list of vendor project-pricing rows frozen from the won estimate's discounts (part, quantity, discount, normal and expected cost, note). Internal; shown on the Procurement tab as "Project pricing to request" |
| `createdAt`, `updatedAt`, `startedAt` | Timestamps |
| `targetDate` | Install-ready date (project) or delivery target (order) |
| `installStart`, `installEnd` | Install window; null on an order |
| `pipelineId`, `stage` | The pipeline and the stage id within it (section 3.4) |
| `stageHistory` | Append-only list of `{at, from, to, by}`. The first entry has `from: null` |
| `procurement` | Procurement lines (below) |
| `mobilizations` | Copied from the estimate: rows of `{id, type, days, crew, discipline}` |
| `deliveries` | Delivery rows (below) |
| `crew` | Crew assignments (below) |
| `tasks` | Legacy embedded task list. Tasks now live in their own collection (section 9.1); embedded rows are migrated on first read |
| `notes` | `{id, by, at, text, photo, deleted?}`, newest first |
| `timeLogs` | `{id, person, date, hours, note, deleted?}` |
| `signoff` | Null, or `{name, role, signedBy, signedAt, note, signature, scopeChecks}` |
| `trainingAt` | Unused timestamp (section 17) |
| `source`, `legacyOwner` | Set on imported history |

Procurement line: `id`, `sku`, `desc`, `vendor`, `qty`, `unit`, `cost`, `leadDays`, `status`
(`pending` → `ordered` → `shipped` → `received`), `orderedAt`, `po` (free-text purchase order
number).

Delivery: `id`, `label`, `vendor`, `eta`, `status` (`scheduled` → `in_transit` → `received`),
`receivedAt`.

Crew assignment: `id`, `person` (name), `role` (default "Installer"), `start`, `end` (inclusive
day span), `mobId` (optional mobilization it fulfils), `googleEventId` (the calendar copy).

### 3.3 Creating a project from a won quote

Rules

- Only quote types not in the excluded list (`flame_test`, `repair`, `inspection`, `consulting`,
  `rental`) become projects.
- The record is a project when the quote has install labor, otherwise an order. A quote has labor
  when any section of its estimate has kind `labor` with at least one item; failing that, when its
  `hasLabor` flag is true; failing that, it is assumed to have labor.
- Target date = now + N days, where N comes from the quote's requested install timeframe:
  "ASAP" 14, "Under 1 month" 30, "1–3 months" 90, "3–6 months" 180, "6–12 months" 365. With no
  timeframe, N is 42 for a project and 21 for an order.
- Install duration (projects only) = the sum of the estimate's mobilization days, with a minimum
  of 6 days. `installEnd` = target date. `installStart` = target date − install duration, but not
  earlier than today.
- The stage is the first stage of the pipeline for the record's kind.
- `performanceBonusPool` is set from the quote's bonus record when that cost is a finite number
  greater than 0. If the bonus record is later edited, the pool on the linked project MUST be kept
  equal to it (cleared when the cost becomes 0).
- The estimate's companies ("parties", for example the architect) are copied to the project once.
  Losing bidders are not copied. If the quote has an awarded bidder, the project's
  `billToCompanyId` is set to that bidder's company. A failure in either step MUST NOT undo the
  win; each runs separately and a failure is logged.
- One task is created: "Sold — kickoff call for <project name>", section "Follow-up", unassigned,
  due 7 days after the sale. It is created at most once per project.
- Starter procurement lines are generated from the quote value by fixed shares (see section 17.1;
  this is placeholder behaviour inherited from a prototype):

| Condition on the estimate's system names | Line | Vendor | Cost |
| --- | --- | --- | --- |
| No systems listed, or a name contains "rig" | Rigging hardware package (`JC-RIG-PKG`) | JR Clancy | 22 % of quote value |
| No systems listed, or a name contains "curt" or "drap" | Soft goods package (`RB-SG-PKG`) | Rose Brand | 18 % |
| A name contains "control", "fixture" or "light" | Control & dimming package (`ETC-CTL-PKG`) | ETC | 20 % |
| A name contains "shell" or "acoust" | Acoustical shell package (`WN-SHELL-PKG`) | Wenger | 30 % |
| Always | Field hardware & consumables (`GEN-HW`) | In-stock | 5 % |

  Each line is quantity 1, unit "lot", status `pending`, with the vendor's default lead time:
  JR Clancy 45 days, Rose Brand 32, ETC 56, Wenger 70, In-stock 10. An unknown vendor defaults to
  21 days.

Service shadow projects. A won repair or inspection quote also creates a lightweight project so
the job appears in the Projects list. It is an order, born on the order pipeline's Done stage,
with value 0 (so revenue is not double counted), no crew, no procurement and no deliveries. It
never progresses and never triggers the stage hooks in section 3.5. The repair job stores its id
in `projectId`.

Reconciliation. Opening Projects, Schedule or Field Work scans won quotes and creates any missing
project. The Projects screen also lists won quotes not yet converted under "Won — ready to start"
with a Start button. That list and the creator MUST use the same exclusion list, or a row's Start
button does nothing.

Deleting a project requires the `create` permission. If the project came from a quote, the quote
id goes on the dismissed list and no path may re-create the project.

### 3.4 Stages and pipelines

A pipeline is an ordered list of stages. Each stage has a stable id (lowercase letters, digits and
dashes), a label an admin can edit, and one fixed tag. All behaviour reads the tag, never the id
or the label, so stages can be renamed, added and reordered.

Project tags, in rank order: `backlog` (0), `scheduled` (1), `onsite` (2), `closeout` (3),
`done` (4).

Default pipelines

| Pipeline | Stage id | Label | Tag | Advances when all deliveries are received |
| --- | --- | --- | --- | --- |
| `install` | `deposit` | Deposit/PO received | backlog | |
| | `equipment-ordered` | Equipment ordered | backlog | yes |
| | `initial-contact` | Initial contact | backlog | |
| | `scheduled` | Scheduled | scheduled | |
| | `installation` | Installation | onsite | |
| | `invoice` | Invoice | closeout | |
| | `complete` | Complete | done | |
| `order` | `order-materials` | Order materials | backlog | |
| | `deliveries` | Deliveries | backlog | yes |
| | `delivered` | Delivered & accepted | closeout | |
| | `complete` | Complete | done | |

Validation rules for a project pipeline

- At least two stages. Stage ids unique within the pipeline. Every stage has a label and a known
  tag.
- Exactly one `done` stage, and it MUST be last.
- An invalid stored pipeline list is ignored and the defaults are used.

Reading rules

- A record's pipeline is the one named by `pipelineId`; if that is missing, `order` for an order
  and `install` otherwise; if that is missing too, the first pipeline.
- A stored stage id that is not in the pipeline is converted on read. Old seven-stage keys map
  as: `procurement` and `delivery` → `equipment-ordered`; `scheduled` → `scheduled`; `install`
  and `training` → `installation`; `signoff` → `invoice`; `complete` → `complete`. For orders:
  `procurement` → `order-materials`; `delivery` → `deliveries`; `signoff` → `delivered`;
  `complete` → `complete`. Anything else becomes the first stage, except that "complete" always
  lands on the Done stage.
- "Active" means tag `scheduled`, `onsite` or `closeout`. "Backlog" means tag `backlog`.
- Progress percent = stage index ÷ (stage count − 1) × 100, rounded.

The same settings screen also holds quote pipelines (Draft → Sent → Won). Those belong to the
Estimator and are not part of this specification, but they share the stage/tag model.

### 3.5 Stage changes and their side effects

- A stage can be set to any stage of the record's own pipeline. A stage id from another pipeline
  is refused.
- Every change appends `{at, from, to, by}` to `stageHistory`. Setting the same stage again is a
  no-op.
- After a change lands, two hooks run. A hook failure is logged and MUST NOT be reported as a
  failed stage change.
  1. Checklist. Entering a stage adds that stage's standard task list (below), once per project
     and stage.
  2. Completion follow-up. The first time a record reaches the Done-tagged stage, an assignment is
     created for the project owner: "Walk the completed site with the end user: <project>".

Standard checklists, keyed by stage id (a stage with no entry has no checklist)

| Stage id | Tasks (section in brackets) |
| --- | --- |
| `equipment-ordered` | Release POs for every procurement line [Procurement]; Confirm the order-by date for the longest lead-time line against the install target [Procurement]; Field-verify grid heights and existing structural attachment points before fabrication [Procurement]; Confirm vendor lead times against the target date for every line [Procurement]; Confirm delivery ETAs land at least 7 days before install [Deliveries]; Confirm site access, loading dock, and receiving hours with the facility [Mobilize]; Stage hardware and materials for the install crew [Mobilize] |
| `scheduled` | Assign rigging lead and installers, and confirm start/end dates [Scheduled]; Confirm dark week / house clearance with the venue [Mobilize]; Match the crew assignment to the estimator's mobilization plan [Scheduled]; Confirm crew headcount matches the mobilization plan's crew size [Scheduled] |
| `installation` | Complete rigging installation per line-set assignments; Hang and trim soft goods; Log daily crew hours against the job; Photo-document install progress for the job file; Run the operational/commissioning test and punch walk before training [all Install]; Train venue staff on system operation; Cover safe rigging operation and lockout procedure with the trained staff; Deliver O&M documentation / owner's manual; Record the name and role of the staff member trained, for the sign-off record [all Training] |
| `invoice` and `delivered` | Walk the completed install with the customer and capture punch items; Obtain signed customer acceptance (name, role, signature, date); Deliver flame-certification documentation for installed soft goods (NFPA 701/705), if applicable; Confirm rigging load path and hardware match the accepted design before sign-off [all Signoff] |
| `complete` | Verify signed customer acceptance is on file before closing the job; Archive POs, packing slips, and install photos to the job file [Closeout] |
| `order-materials` | The four Procurement tasks above |
| `deliveries` | The three delivery/mobilize tasks above |

The owner reviewed this list and removed two items that MUST NOT be reintroduced: a formal
receiving/damage inspection on delivery, and a closeout margin reconciliation.

### 3.6 Procurement, deliveries and risk

- Staging buffer: everything should be on site 7 days before the target date.
- Order-by date of a line = target date − (line lead days + 7) days. With no target date, the
  target is taken as today + 30 days.
- A line is late when its status is `pending` or `ordered` and its order-by date is in the past.
- The critical line is the line with the longest lead time (first one wins a tie).
- Setting a line to `ordered` stamps `orderedAt` the first time only.
- Procurement progress = average over lines of: received 1, shipped 0.75, ordered 0.4, pending 0.
  No lines counts as 1.
- When a delivery is marked received and every delivery on the record is now received and the
  record's current stage is flagged "advances when all deliveries are received", the record moves
  to the next stage. The actor recorded is "System". The stage controls can undo it.
- Risk flags (never on a Done record): one "Order overdue: <line>" per late line; and, for a
  project in a backlog stage whose target date is 0 to 14 days away with no crew,
  "No crew scheduled, install in Nd".

### 3.7 Crew, notes, time and sign-off

- Adding crew from the project screen needs only a person. Start and end default to the install
  window, or to today + 7 and today + 10 days. Orders have no crew; adding crew to an order is
  refused.
- Notes and time logs are soft-deleted by flagging the entry, never by removing it, so an offline
  device that later uploads the whole record cannot bring a deleted entry back.
- Sign-off requires: a customer name; a signature image (PNG data URL, at most 350,000
  characters); and a tick against every "scope". The scopes are derived from the procurement
  lines' vendors (JR Clancy → "Rigging hardware & hoists", Rose Brand → "Soft goods (sewn to
  order)", ETC → "Dimming, control & fixtures", Wenger → "Acoustical shell & risers", In-stock →
  "Hardware & consumables"; any other vendor uses its own name), sorted by name; a record with no
  lines has the single scope "General installation". Role defaults to "Customer".
- Sign-off is the hand-off, not the close. A record that has not yet reached a closeout stage
  moves to its pipeline's first closeout stage (Invoice, or Delivered & accepted). Reaching Done
  is a separate manual step.
- Contract value can be typed by hand ("$86,400" or "86400"; negative or unparseable input is
  refused). Saving clears `valueUnknown`. If the value was unknown, a note is added recording the
  change.

### 3.8 Screens

Projects list (`/projects`)

- Four tiles: Active (count and total known value "in delivery"), In install (records with tag
  `onsite`), At risk (active records with any risk flag), Awaiting start (won quotes not yet
  converted).
- Filter chips with counts: Active (default), At risk, Orders, Complete, All, and Value unknown
  (shown only when such records exist).
- An owner filter (`?who=mine` or a teammate's name, exact match) that applies to the tiles, the
  list, the board and the "ready to start" strip alike.
- List view (master-detail) or Board view. The board shows projects only (not orders), in columns
  by stage. Cards are not draggable; a stage is changed from the detail view.
- Each card shows a due chip: "Closed <date>" when done, "Nd overdue", "Due today" or "Due in Nd".
- A "Won — ready to start" strip with one Start button per unconverted won quote.
- `/projects?id=<id>` redirects to `/projects/<id>`.

Project detail (`/projects/<id>`), tabs

| Tab | Shows | Actions |
| --- | --- | --- |
| Overview | Target date, install window, materials progress, field progress, recent field notes, the stage tracker, tasks, companies, meetings | Set stage (click a tracker node or Advance); edit contract value; add, edit, complete and delete tasks; apply a task template set; add a note; delete the project |
| Procurement | Lines with vendor, lead time, order-by date, late flag; the critical-path line; total on order; "Project pricing to request" | Tap a status chip to advance pending → ordered → shipped → received; save a PO number |
| Deliveries | Delivery rows | Tap to advance scheduled → in transit → received |
| Crew & schedule (projects only) | Install window and crew | Assign a person; remove a booking |
| Timeline | A Gantt of each procurement line from its order date to its arrival, plus "Install & commissioning"; a marker for the target date | none |
| Handoff packet | A summary for the crew and the customer hand-off, grouped by scope | Download PDF |
| Documents | Files attached to the project (shared documents feature) | upload, download |
| Sign-off | The sign-off form, or "Customer accepted" with the confirmed scopes | Record sign-off |

All project actions need only a signed-in user, except delete (`create`).

**Source:** `src/lib/stores/projects.ts`, `src/lib/pipelines.ts`, `src/lib/pipelines-server.ts`,
`src/lib/stores/tasks.ts` (`TASK_TEMPLATE`), `src/lib/job-value.ts`,
`src/lib/project-discounts/rules.ts`, `src/app/(app)/projects/page.tsx`,
`src/app/(app)/projects/data.ts`, `src/app/(app)/projects/view.tsx`,
`src/app/(app)/projects/actions.ts`, `src/app/(app)/projects/board-lib.ts`,
`src/app/api/projects/[id]/handoff/route.ts`, `AGENTS.md` (phases 5, 12, 51, 62),
`DECISIONS.md` (D236–D243).

---

## 4. Schedule

### 4.1 Purpose

One screen, three views, chosen by `?view=`: the crew board (default), the project timeline, and
the by-person view.

### 4.2 Crew board

- Rows are people: every active user, plus anyone named on a booking who is not a user. People
  with bookings sort first.
- Columns are days. The window starts 7 days before the Sunday of the current week and runs for
  8, 12 or 16 weeks (`?zoom=`). `?week=` shifts the window by whole weeks.
- Bars are crew bookings from every project. Overlapping bars for one person stack on separate
  tracks.
- Service work is drawn on the same board as single-day bars: every flame test, inspection and
  repair that is not completed and has a scheduled date. A repair with a crew list produces one
  bar per distinct person (assignee plus crew). Unassigned service work sits on an "Unassigned"
  row. Service bars link to the record and cannot be edited here.
- A map beside the board pins every project that is not done and whose venue has coordinates
  (`?map=0` hides it).
- Actions: book a person onto a project (project, person, role, start date, number of days,
  optional mobilization); edit a booking (person, role, start, days); remove a booking. End date =
  start + (days − 1). All need only a signed-in user. Drag to reschedule is not available on this
  view.
- When the person has connected a Google Calendar, booking creates an all-day-span event titled
  "<project name> — <role>", editing updates or moves it, and removing deletes it. A calendar
  failure is logged and never fails the booking.

### 4.3 Project timeline

- One shared time window with two bands: Consulting (open engagements, stage not "closed") above
  Installs (records that are not done).
- An install row draws from its critical line's order-by date to its install window.

### 4.4 By person

- One lane per active person plus an "Unassigned" lane. Every person has a lane even when it is
  empty, because an empty lane answers "who is free".
- Bars are consulting tasks that have both a start and a due date, coloured by engagement.
  Install crew bookings and service work are merged into the same lanes.
- Consulting bars can be dragged; a drag is the same write as on the engagement's Schedule tab
  (section 8.5) and marks the task hand-scheduled.

**Source:** `src/app/(app)/schedule/page.tsx`, `src/app/(app)/schedule/actions.ts`,
`src/app/(app)/schedule/people-lib.ts`, `src/app/(app)/schedule/portfolio-gantt.tsx`,
`src/lib/operations-work.ts`, `src/lib/operations-work-server.ts`, `src/components/gantt/`,
`DECISIONS.md` (D100, D115, D172, D232).

---

## 5. Field Work

### 5.1 Purpose

The on-site view for crew. It lists today's work and lets a technician tick tasks, add punch-list
tasks, post notes and log hours with no signal.

### 5.2 Day list (`/field-work`)

- A project is "mine today" when I am on a crew booking whose inclusive day span covers today,
  the record is a project (not an order) and it is not done.
- Service work (flame test, inspection, repair) is "mine" when I am the assignee and its scheduled
  day is today or earlier and it is not completed. Overdue work therefore stays on the list.
- `?scope=team` shows everyone's work instead of mine, and names the crew on site.
- Each project card shows the stage, an "ON SITE" badge when the tag is `onsite`, tasks done over
  total, and the install start date.
- A "Download today" control caches today's jobs and their pages for offline use.

### 5.3 Job detail (`/field-work?id=<projectId>`)

Tabs: Tasks, Notes, Time and BOM (the procurement lines, read-only), under the project header.

| Action | Rule |
| --- | --- |
| Tick or untick a task | Needs `create`. The task MUST belong to a live project |
| Add a punch-list task | Needs `create`. Section "Install", assigned to me. The device supplies the id (`tk-…`); a malformed id is refused; an id already used by a different project or person is refused |
| Post a note | Text only. Photo upload is not built |
| Log time | Person = me, hours parsed as a number, optional note |
| Delete a note or time entry | Soft delete (flag) |

Offline behaviour

- Online, each action runs the server action. Offline or paused, the whole changed document is
  queued on the device and uploaded on reconnect.
- The upload endpoint accepts whole-document upserts for a fixed list of collections only. For
  this area those are `projects`, `tasks` and `repair_jobs`.
- A queued project document is normalised on arrival (arrays backfilled, stage converted).
- A task pushed from a device is subject to the same id rules as "Add a punch-list task" above.

**Source:** `src/app/(app)/field-work/page.tsx`, `src/app/(app)/field-work/controls.tsx`,
`src/app/(app)/field-work/actions.ts`, `src/lib/stores/tasks.ts` (`createFieldTask`,
`fieldTaskIdDecision`), `src/lib/sync/task-push.ts`, `src/lib/sync/today-jobs.ts`,
`src/app/api/sync/push/route.ts`, `src/app/api/sync/today/route.ts`, `AGENTS.md` (phases 5, 6).

---

## 6. Repairs

### 6.1 Purpose

A repair starts as an auto-priced quote. When the quote is approved it becomes a repair job that
is scheduled, completed, and then tracked until its warranty lapses.

### 6.2 Data model

Repair job

| Field | Meaning |
| --- | --- |
| `id` | `RP-####` from 4000 |
| `quoteId`, `projectId` | The won quote; the shadow project (section 3.3) |
| `customer`, `customerId`, `locationId`, `venue` | Who and where. `venue` is the first venue's label |
| `value`, `valueUnknown` | Quote value at approval |
| `category` | `rigging` (Rigging & counterweight), `curtains` (Curtains & soft goods), `motors` (Motors & automation), `track` (Curtain track), `firecurtain` (Fire curtain), `fallprotection` (Fall protection & access), `electrics` (Stage electrics), `structural`, `other` |
| `priority` | `emergency`, `urgent`, `standard`, `low` |
| `title`, `scope` | Short title; free-text scope notes |
| `source` | `{kind, refId?, logId?, label}`; kind is `inspection`, `survey`, `quote` or `direct` |
| `items` | Scope items `{label, qty, note}` |
| `parts` | `{name, qty, cost}` |
| `laborHours` | Total crew-hours |
| `contact` | `{name, role, email, phone}` or null |
| `venues` | `{id, label, city, state, lat, lng}` |
| `stage` | `approved` → `scheduled` → `completed` |
| `assignedTo`, `crew` | Technician name; other crew names |
| `approvedAt`, `scheduledDate`, `completedAt` | `scheduledDate` is `YYYY-MM-DD` or empty |
| `warrantyMonths` | Default 12 |
| `completion` | `{performedBy, workPerformed, partsUsed[], followUp, photos[]}` or null |
| `owner`, `createdAt`, `updatedAt` | |

### 6.3 Lifecycle rules

- A job is created from a quote only when the quote's type is `repair` and its status is `won`.
  It starts at `approved` with no technician and no date.
- Schedule: needs a date; sets date and technician and moves to `scheduled`. Scheduling again
  reschedules.
- Unschedule: back to `approved`, date cleared.
- Complete: needs a completion date. Stores the completion record, the warranty months (blank on
  the form means 12) and moves to `completed`. `completedAt` is the start of the warranty clock.
- Reopen: back to `scheduled`; `completedAt` and the completion record are cleared.
- Delete: soft delete. If the job was scheduled, its calendar event is removed first.
- All of these need only a signed-in user.
- When the technician has a connected Google Calendar, scheduling writes an event
  "<venue or customer> — Repair" on that date; changing the technician moves it; unscheduling or
  deleting removes it. A calendar failure never rejects the change.

Warranty

- Expiry = `completedAt` + warranty months × 30 days. A "month" is exactly 30 days.
- State: `none` (not completed), `expired` (expiry passed), `expiring` (45 days or fewer left),
  `active` (more than 45 days left).
- Warranty follow-ups are completed jobs in state `expired` or `expiring`, sorted by expiry.
  Imported history is excluded: jobs imported as already finished, and jobs imported as live
  whose warranty has since lapsed.

Intake from inspections

- An open inspection finding is offered for quoting when its severity is `urgent` or `necessary`,
  its status is not `closed`, and no repair job already names that inspection and finding.
- Severity maps to priority: urgent → urgent, necessary → standard, basic → low, anything else →
  standard.
- Findings from the newer Assessments feature can also start a repair quote. The quote carries
  the finding keys and the findings are linked to it on first save.

### 6.4 Repair quote engine

Default rates (editable under Estimating Rules)

| Rate | Default |
| --- | --- |
| Labor rate | $75 per hour |
| Mileage rate | $1 per mile |
| Minimum call-out | $350 |
| Service markup (labor + travel) | 43 % |
| Parts markup | 43 % |
| Emergency multiplier on the labor rate | 1.5 |
| Travel-time rounding | up to the next 15 minutes |
| Default crew when the trip flies | 2 |

Travel defaults (shared with other service quotes)

| Rate | Default |
| --- | --- |
| Fly threshold (drive cost at or above this prices as flights; 0 = never fly) | $1,000 |
| Airfare per person | $450 |
| Hotel per night | $140 |
| Per diem per day | $70 |
| Rental car per day | $75 |
| Travel hours each way when flying | 4 |
| Working hours per day when flying | 8 |
| Road factor (straight-line miles → road miles, offline fallback) | 1.25 |
| Average speed (offline fallback) | 50 mph |
| Lift rental rate | the catalog cost of part `EQP-LIFT`; $750 when that part is missing |

Calculation, in order

1. Labor cost = labor hours × labor rate. For an emergency the labor rate is multiplied by the
   emergency multiplier. Labor hours are crew-hours: hours each × crew size.
2. Drive. When every venue has coordinates and an office is known, the route is
   office → venue 1 → … → venue n → office, summing miles and minutes per leg. Otherwise an
   estimate is used: 2 × the largest one-way miles among the venues, and 2 × that venue's one-way
   minutes. Travel is counted once for the whole trip, not per venue.
   Billed minutes = minutes rounded up to the rounding step. Drive cost = miles × mileage rate +
   (billed minutes ÷ 60) × the base labor rate (never the emergency rate).
3. Travel mode. Auto mode flies when the fly threshold is above 0 and the drive cost is at or
   above it. A quote may force Drive or Fly. In drive mode travel = the drive cost exactly.
   In fly mode, with crew = the larger of the default flying crew and the job's crew size (an
   override may raise but never lower it below the job's crew):
   - work days = on-site hours ÷ (crew × hours per day), rounded up, minimum 1;
   - nights = work days unless overridden; trip days = nights + 1;
   - airfare = crew × airfare per person (overridable per quote);
   - lodging = crew × nights × hotel;
   - per diem = crew × trip days × per diem;
   - car = (crew ÷ 2, rounded up) × trip days × car rate;
   - travel labor = crew × hours each way × 2 × base labor rate;
   - travel = the sum of those five.
4. Service cost = labor cost + travel.
5. Service sell = service cost × (1 + service markup). If that is below the minimum call-out, the
   service sell is the minimum call-out and the quote is "floored".
6. Parts cost = Σ quantity × cost. Parts sell = parts cost × (1 + parts markup).
7. Lift (optional): cost = count × rate; sell = cost × (1 + service markup). It is added on top of
   the call-out floor.
8. Raw total = service sell + parts sell + lift sell.
9. Rounding. A floored quote rounds UP to the next $25. Any other quote rounds to the nearest $25,
   a half rounding up.
10. A typed total (whole dollars, $1 to $10,000,000) replaces the rounded total exactly.
11. The service line absorbs the rounding: printed service = total − parts sell − lift sell.

Rules

- The per-quote service markup comes from a slider: clamped to 5 %–100 % on the server (the
  slider itself runs 10–100). With no slider value it is the customer's pricing-tier service
  markup, or the default.
- A typed total below cost, or giving less than 11 % markup, shows a warning. It never blocks.
- The server MUST re-price on every save from the customer's venue coordinates and the stored
  rates. The browser's preview is never trusted.
- Changing the mileage or labor rate on the builder changes the global rate for every later quote.
  Markup is per quote.
- Re-saving an old quote keeps its own stored parts markup while today's global parts markup is
  the same whole percent, so an untouched re-save never moves the price.
- A customer rewards credit, when one applies, is subtracted after the total. The stored quote
  value is the net figure.

Worked examples (all default rates)

A. Two technicians, 3 hours each, one venue 60 miles and 70 minutes away one way (estimate
method), parts 2 × $40 and 1 × $120.

| Step | Figure |
| --- | --- |
| Labor | 6 h × $75 = $450.00 |
| Miles | 120 × $1 = $120.00 |
| Travel time | 140 min → 150 min billed = 2.5 h × $75 = $187.50 |
| Drive cost | $307.50 (below $1,000, so drive) |
| Service cost | $757.50 |
| Service sell | $757.50 × 1.43 = $1,083.23 (above $350, not floored) |
| Parts | cost $200.00, sell $286.00 |
| Raw total | $1,369.23 |
| Total | $1,375 (nearest $25) |
| Printed service line | $1,375 − $286 = $1,089 |
| Whole-job markup | ($1,375 − $957.50) ÷ $957.50 = 43.6 % |

B. One technician, 1 hour, venue 5 miles and 10 minutes away, no parts. Labor $75; miles $10;
20 minutes → 30 billed = $37.50; service cost $122.50; × 1.43 = $175.18, below the call-out, so
service sell = $350. Total $350.

C. The same job as A marked emergency: labor = 6 h × $112.50 = $675; travel unchanged at $307.50;
service cost $982.50; sell $1,404.98; plus parts $286 = $1,690.98; total $1,700.

D. Two technicians, 8 hours each, venue 300 miles and 330 minutes away. Drive cost = $600 +
11 h × $75 = $1,425, at or above $1,000, so the trip flies. Crew 2; work days = 16 ÷ 16 = 1;
nights 1; trip days 2. Airfare $900; lodging $280; per diem $280; car 1 × 2 × $75 = $150; travel
labor 16 h × $75 = $1,200; travel $2,810. Labor $1,200. Service cost $4,010; sell $5,734.30;
total $5,725.

### 6.5 Screens

Dashboard (`/repairs`)

- Tiles: Active repairs (approved + scheduled), Awaiting schedule (approved), Priority open
  (emergency + urgent among open jobs), Warranty follow-ups (with "N lapsed · N ending").
- "Flagged from inspections": open findings needing a quote, filter All / Urgent / Standard, each
  with a link to start a quote and a link to the inspection.
- "All repairs": filter All / Approved / Scheduled / Completed with counts; columns Repair, Status,
  Value, Updated. An approved row opens Scheduling; any other row opens Results.
- "Repair locations": a map with one pin per job that has coordinates, with per-stage show/hide.
  Completed jobs whose warranty is expired or expiring are ringed.
- "By status" bars and a "Warranty follow-ups" list with an email-the-contact link.

Quote builder (`/repairs/quote`). Opens blank, for a customer (`?customer=`), to edit
(`?id=`), from an inspection finding (`?inspection=&log=`), or from assessment findings
(`?customer=&findings=`).

- Inputs: customer; one or more of the customer's venues; contact name, role, email; quote name;
  category; priority; scope items (list of text); notes; hours each; crew size; parts rows (name,
  quantity, cost); mileage rate; labor rate; markup slider; travel mode (Auto, Drive, Fly) with
  crew, nights and airfare overrides; lift count and rate; typed total; rewards credit.
- Shows a live price breakdown that MUST match the server's result.
- Actions: Save (creates or updates a draft quote and redirects back with a saved notice);
  Approve (saves, then marks the quote Won, which creates the job). Approve bypasses the normal
  quote approval gate. Both render the proposal letter to a stored PDF.
- A save with no customer or no venue does nothing.

Scheduling (`/repairs/scheduling`): two columns, To schedule and Scheduled. Each card takes a date
and a technician. The date field shows the venue's availability when the venue has a calendar.

Results (`/repairs/results?job=`): the job's scope, then a capture form — date performed,
performed by, work performed, parts used (one per line), follow-up needed, warranty months —
and "Complete & log results". The form works offline (the completed record is queued). Also:
Reopen, Delete, and a value editor for imported jobs with an unknown value.

Documents

| Document | Route | Content |
| --- | --- | --- |
| Proposal letter | `/repairs/letter?id=<quoteId>` | Cover letter for a saved repair quote: scope, service line, parts, one "Travel (air, lodging & per diem)" line when flying, lift line, total |
| Service report | `/repairs/report?job=<id>&variant=letter|summary|report` | Completion document in three layouts; default is the formal report. Says "Results not logged yet" for an incomplete job |
| Report options | `/repairs/report/options` | The same sample rendered three ways, to compare |
| Completion letter | `/repairs/completion-letter?job=<id>` | One-page customer confirmation of completed work |
| Warranty & repair record | `/repairs/warranty-record?job=<id>` | Internal one-page tracker for a warranty callback |

The completion letter and warranty record take their wording from editable document templates
(`service_completion_letter`, `warranty_record`).

**Source:** `src/lib/repair-engine.ts`, `src/lib/service-pricing.ts`, `src/lib/travel-plan.ts`,
`src/lib/stores/pricing.ts`, `src/lib/stores/repair-jobs.ts`, `src/lib/service-calendar.ts`,
`src/lib/service-quote-inputs.ts`, `src/lib/assessments/quote-from-findings.ts`,
`src/app/(app)/repairs/page.tsx`, `src/app/(app)/repairs/actions.ts`,
`src/app/(app)/repairs/quote/actions.ts`, `src/app/(app)/repairs/quote/page.tsx`,
`src/app/(app)/repairs/scheduling/page.tsx`, `src/app/(app)/repairs/results/`,
`src/app/(app)/repairs/report/`, `src/app/(app)/repairs/letter/letter-view.tsx`,
`src/app/(app)/repairs/completion-letter/page.tsx`,
`src/app/(app)/repairs/warranty-record/page.tsx`, `AGENTS.md` (phases 4, 15, 18, 67),
`DECISIONS.md` (D51–D55, D281–D286).

---

## 7. Rentals

### 7.1 Purpose

Rent out Peak-owned gear. Staff keep a list of rentable items with stock per location, build a
priced rental quote for a date range, and track bookings from confirmed to out to returned.

### 7.2 Data model

| Record | Fields |
| --- | --- |
| Item | `id`, `sku`, `name`, `category` (`speakers`, `monitors`, `lighting`, `consoles`, `control-io`, `other`), `subcategory`, `manufacturer`, `description`, `dayRate`, `weekRate`, `monthRate`, `active`, `stock` (list of `{locationId, qty}`) |
| Location | `id`, `name`, `address` |
| Booking | `id`, `itemId`, `locationId`, `qty`, `quoteId`, `startDate`, `endDate`, `status` (`confirmed`, `out`, `returned`, `cancelled`), `rate` |

`rate` on a quote line and on a booking is the price of ONE unit for the WHOLE date range, not a
daily rate. Line price = `qty × rate`.

### 7.3 Pricing rule

For a rental of D days (inclusive: a same-day rental is 1 day), compute up to three candidates,
using only rates above 0:

- D × day rate
- (D ÷ 7, rounded up) × week rate
- (D ÷ 30, rounded up) × month rate

The price is the lowest candidate. An item with no positive rate prices at 0. A blank or zero rate
MUST never win the comparison.

Example: day $50, week $200, month $600, for 10 days → $500, $400, $600 → $400 per unit.

### 7.4 Rules

- Quoting does not reserve stock. A booking exists only once the quote is Won, and is created
  directly as `confirmed`, one per quote line, with the line's rate frozen.
- Available quantity for an item at a location over a date range = owned quantity − the summed
  quantity of bookings in status `confirmed` or `out` whose range overlaps. Ranges overlap when
  they share any day, including a shared boundary day.
- The quote builder shows availability as a warning. It never blocks a quote.
- The server MUST re-price every line from the item's current rates on save. The quote value is
  the rounded sum of `qty × rate`. Rental quotes carry no markup.
- A save needs a customer, a start date, an end date not before the start, and at least one valid
  line. Quantity is at least 1.
- Booking status may move only `confirmed` → `out` → `returned`. The server MUST check the
  booking's stored status, not the status the browser claims.
- An item or location with a booking that is `confirmed` or `out` and has not yet ended cannot be
  deleted.
- Editing an item must not erase stock: a save from a form that shows no location rows leaves
  stock unchanged.
- Permissions: item and location create, edit and delete need `create`. Changing a booking status
  needs `create`. Saving a quote needs a signed-in user. Approving a quote needs `send`.

### 7.5 Screens

- Rentals hub (`/rentals`): the item list (Item, Category, Day rate, Week rate, Month rate) with
  add, edit (including per-location stock) and delete; a Locations panel with "+ Add location"
  (create only).
- Rental quote builder (`/rentals/quote`): customer, contact, quote name, start and end dates,
  lines of item + location + quantity; live price and availability warning per line; Save;
  Approve; "Preview rental agreement".
- Rental agreement (`/rentals/quote/letter?id=<quoteId>`): a generated PDF on Peak letterhead
  listing each line with its dates, quantity and price.
- Booking board (`/rentals/board`): bookings grouped by status with "Mark out" and
  "Mark returned"; an overdue badge on bookings past their end date. Opening the board creates
  bookings for any won rental quote that has none.

**Source:** `src/lib/pricing/rental.ts`, `src/lib/stores/equipment-items.ts`,
`src/lib/stores/equipment-locations.ts`, `src/lib/stores/equipment-bookings.ts`,
`src/app/(app)/rentals/page.tsx`, `src/app/(app)/rentals/actions.ts`,
`src/app/(app)/rentals/quote/actions.ts`, `src/app/(app)/rentals/quote/page.tsx`,
`src/app/(app)/rentals/quote/letter/route.ts`, `src/app/(app)/rentals/board/page.tsx`,
`src/app/(app)/rentals/board/actions.ts`, `DECISIONS.md` (D129).

---

## 8. Consulting project management

### 8.1 Purpose

A consulting engagement (`CE-####`) is a design job sold as phases and disciplines. This feature
turns a start date, an end date and a task template into dated tasks and dated milestones, shows
them on a Gantt, and gives the engagement one Activity feed.

The engagement record itself (phases, milestones, decisions, meetings, submittals, documents,
phase reviews) belongs to the Design area. Only the scheduling fields are described here:
`startAt`, `endAt` (0 = unscheduled), `disciplines` (bought), `phases` (each with an id and name)
and `milestones` (`{id, name, targetDate, completedAt, amount, phaseId}`).

Engagement stages: Proposal sent, Awarded, Design, Out to bid, Construction admin, Closed. Open
means not Closed. Default phase menu: Assessment, Schematic Design, Design Development, Final
Documents, Bid Support, Construction Oversight.

### 8.2 Task template sets

A set is a named, reusable list of lines.

| Field | Meaning |
| --- | --- |
| `id` | `TT-###` |
| `name`, `description` | |
| `appliesTo` | Any of `project`, `quote`, `design`, `consulting` |
| `lines` | See below |
| `archived` | Hidden from "apply" pickers |

Line: `key` (stable within the set), `title`, `section`, `target`, `phase` (a phase name),
`discipline` (blank = every discipline; stored lowercase), `startPct` and `lengthPct` (0–100,
defaults 0 and 100).

Target is one of: a person (one task for that user); a role (one task per active user holding the
role); everyone (one task per active user).

Applying a set to a record

- The set MUST list the record's kind in `appliesTo`, and the record MUST exist.
- Role and everyone lines fan out to one task per matching user.
- Applying is additive: each resulting task carries a coverage key built from the set id, the
  record and the line (plus the user for fanned-out lines), and a task whose key already exists
  on the record is not created again.
- A consulting engagement MUST be given a schedule (section 8.3) when a set is applied. Applying
  without one is an error, because it would create undated tasks regardless of scope.
- Only admins (`manage_users`) can create, edit, archive or delete sets.

### 8.3 Scheduling engine

Inputs: start, end, the engagement's phases with weights, the disciplines bought, the template
lines, and the milestones.

1. Phase windows. Divide the span among the phases in proportion to their weights, in phase
   order. A weight that is missing, zero, negative or not a number counts as 1. Each boundary is
   computed from the running total, so the last window ends exactly at the end date.
2. Scope gate. A line is used only when the engagement has the line's phase (names compared
   trimmed and case-insensitive) and the line either names no discipline or names one the
   engagement bought.
3. Placement. A line's start = window start + window length × `startPct` ÷ 100. Its due date =
   start + window length × `lengthPct` ÷ 100, capped at the window's end. Percentages are clamped
   to 0–100.
4. Milestones. A milestone with a phase is dated to the END of that phase's window. A milestone
   with no phase keeps its date (0 = unscheduled, which keeps it out of the billing forecast).
   A milestone's phase defaults by exact name match to a phase; no match leaves it null.

Example: start 1 March, end 31 May (91 days), phases Assessment (weight 1) and Schematic Design
(weight 3). Assessment gets the first quarter of the span, Schematic Design the rest. A line in
Schematic Design with start 50 % and length 25 % starts halfway through that window and lasts a
quarter of it.

Validation: generation is refused unless there is a start date, an end date, and the end is after
the start.

Other rules

- Changing the span later does NOT move existing tasks. Regenerating is an explicit re-apply, and
  it only adds lines not already present.
- A task dragged by hand is marked `handScheduled` and is never moved by the app again.
- A task whose due day is after the end day is flagged "overrun". Comparison is by local calendar
  day, so a task due later the same day is not an overrun. Overrun is a flag, never a block.
- Moving a milestone opens a dialog listing tasks to move by the same number of days. Tasks in the
  milestone's phase that were not hand-scheduled are pre-ticked. A milestone with no phase
  pre-ticks nothing and lists every task unticked. Only the tasks the person confirmed move, and a
  move does not mark them hand-scheduled. The move writes a system note to the Activity feed.

### 8.4 Phase weights

An admin sets one weight per phase name in settings. A phase with no stored weight has weight 1.

### 8.5 Screens

Schedule tab on the engagement

- Unscheduled: a form with Start date, End date and Task template (a set that applies to
  Consulting), a Preview that writes nothing and shows the tasks and milestone dates that would be
  created, and a Generate button.
- Scheduled: a Gantt with one row per task, grouped by phase, with phase bands and milestone
  markers; an overrun flag on tasks past the end date; "Edit dates"; drag a bar to move a task;
  click a milestone to open the move dialog ("New date", "Move with it", "Not moved").
- All actions need only a signed-in user.

Activity tab on the engagement

- A composer that saves a note, optional file attachments and optional new tasks as one linked
  capture. Each task row has a title, an assignee (or Unassigned) and a due date. Tasks created
  here are hand-scheduled.
- If saving the note fails after tasks were created, those tasks MUST be deleted.
- Every attached file MUST be proven to belong to this engagement before anything is saved. A
  refusal returns a generic message.
- The feed below merges, newest first: composer notes, the engagement's meetings, its decisions,
  phase attachments, and milestone-move notes. The feed stores nothing of its own.
- The composer can be pre-filled from a meeting (title, attendees, notes). Nothing is turned into
  tasks automatically.

Task templates (`/task-templates`, admins only): a list of sets and an editor (name, description,
Applies to, and line rows with title, section, phase, discipline, Start %, Length %, assignee
target). Sets can also be imported and exported as CSV through the Import screen (type
`task_templates`; columns Template Set, Applies To, Phase, Discipline, Task, Section, Assign To,
Start %, Length %). Importing a set replaces all of that set's lines.

**Source:** `src/lib/consulting-schedule.ts`, `src/lib/consulting-stages.ts`,
`src/lib/stores/task-templates.ts`, `src/lib/task-template-kinds.ts`, `src/lib/settings.ts`
(`phaseWeightsFor`), `src/lib/stores/engagements.ts`, `src/lib/engagement-activity.ts`,
`src/lib/engagement-activity-write.ts`, `src/app/(app)/design/engagements/schedule-tab.tsx`,
`src/app/(app)/design/engagements/schedule-actions.ts`,
`src/app/(app)/design/engagements/activity-tab.tsx`,
`src/app/(app)/design/engagements/activity-actions.ts`, `src/app/(app)/task-templates/`,
`src/app/(app)/import/types.ts`, `AGENTS.md` (phase 11), `DECISIONS.md` (D164–D172, D175–D178).

---

## 9. Tasks, assignments and My Queue

There are two kinds of to-do record, for historical reasons. A rebuild should merge them.

### 9.1 Tasks

| Field | Meaning |
| --- | --- |
| `id` | See section 2.1 |
| `title` | Default "New task" |
| `section` | Grouping label on project screens. Default "Install"; blank on non-project tasks |
| `projectId`, `quoteId`, `designId`, `engagementId` | Optional parent. In practice at most one is set; nothing enforces it |
| `coverageKey` | Stable key for a system- or template-created task; null for a manual task |
| `assigneeUserId`, `assigneeName` | Null and blank = unassigned |
| `dueAt` | Due date, or null |
| `startAt` | Gantt bar start (consulting) |
| `schedule` | `{phaseId, startPct, lengthPct}` when placed by a template; else null |
| `handScheduled` | True once a person dragged it |
| `status` | `open`, `in_progress`, `done`, `blocked` |
| `notes`, `createdBy`, `createdAt`, `updatedAt`, `doneAt` | |
| `contactIds` (max 25), `customerId`, `siteId`, `leadId`, `threadId` | Optional CRM and email links |
| `priority`, `size` | Tier and size for the planner (section 10.2) |
| `meetingId`, `waitingOn` | Set on meeting to-dos. `waitingOn` `{contactId, name}` marks an item the customer owes |
| `threadShare` | Server-written stamp that shares one email with the assignee |

Rules

- Setting status to `done` stamps `doneAt`; any other status clears it.
- A task is overdue when it has a due date in the past and is not done.
- A system-created task has a deterministic id derived from its coverage key
  (`T-auto-` + the key lowercased with every run of other characters replaced by a dash).
  Creation MUST be insert-if-absent so that concurrent creators produce one task.
- A new assigned task with no due date gets one: 7 days ahead at 5:00 pm Chicago. Unassigned
  tasks stay undated. Tasks placed by a consulting template keep their template dates.
  Reassigning a task to a different person applies the same default.
- Reassigning or completing or deleting a task clears the previous assignee's planner pins for it
  (section 10.4).
- The bell shows me: open tasks assigned to me, plus overdue tasks nobody owns. It does not show
  other people's overdue tasks.

### 9.2 Assignments

An assignment is "somebody asked somebody to do a thing".

| Field | Meaning |
| --- | --- |
| `id` | `as-…` |
| `title`, `assignee` (name), `createdBy`, `createdAt` | Assignee defaults to the creator |
| `dueDate` | 0 = none. The same +7-day default applies when assigned |
| `link` | Null, or `{kind, id, label}` with kind `company`, `engagement`, `project` or `quote` |
| `done`, `doneAt`, `doneVia` | `doneVia` is `app`, `reminders` or `google-tasks` |
| `source` | Free-text provenance, for example "auto: quote won (#16)" |
| `priority`, `size` | As for tasks |

Any signed-in user can create, complete, edit or delete an assignment.

### 9.3 My Queue (`/queue`)

One person's open commitments. Every row except an assignment is DERIVED from another record, so
the queue cannot drift: finishing the real work removes the row.

| Row source | Shown when | Due | Links to |
| --- | --- | --- | --- |
| Assignment | Open and assigned to me | its due date | the linked record |
| Quote review | A quote is awaiting approval by me (every approver sees every quote in review that is not theirs) | when it was submitted | the quote |
| Site visit | A visit is unclaimed (shown to everyone), or claimed by me and not yet scheduled | created + 3 days | Venue Assessments |
| Phase review | A consulting phase is in review with no reviewer or with me as reviewer | when submitted | Reviews |
| Standards checklist | I am the reviewer and the phase has open checklist items | none | the engagement |
| Milestone | I am on the engagement and the milestone is incomplete and due within 30 days | its target date | the engagement |
| Project task | An open task assigned to me on a live project, not "waiting on customer" | its due date, else the project's target date | the project |
| Meeting to-do | An open task from a meeting assigned to me, not already listed as a project task | its due date | the meeting |
| Flame-test or inspection renewal | A renewal is due (shown to the whole team) | its due date | that dashboard |

Sorted by due date, undated last, then by title. `?who=<name>` shows a teammate's queue.

The screen has an "add assignment" form (title, assignee, due date), a tick to complete an
assignment, and a "recently done" list of my last 8 completed assignments with how each was
completed.

Due label: overdue "Nd overdue"; today "Today"; tomorrow "Tomorrow"; within 7 days "Nd"; else the
date. An undated row has no label and is never overdue.

**Source:** `src/lib/stores/tasks.ts`, `src/lib/stores/assignments.ts`, `src/lib/queue.ts`,
`src/lib/queue-types.ts`, `src/lib/task-plan/due.ts`, `src/app/(app)/queue/`,
`src/components/tasks-card.tsx`, `src/components/apply-template-control.tsx`,
`DECISIONS.md` (D93, D149, D787, D802).

---

## 10. Auto task calendar

### 10.1 Purpose

Place every open assigned task and assignment into the owner's free working time, so each person
sees what to work on and when, and so work that cannot be finished on time is flagged early.

The plan is COMPUTED on every view. The only thing stored is pins (section 10.4).

### 10.2 Tier and size

| Tier | Factor | | Size | Minutes |
| --- | --- | --- | --- | --- |
| High | 3 | | S | 30 |
| Normal (default) | 2 | | M (default) | 60 |
| Low | 1 | | L | 240 |

### 10.3 Planning rules

- Free time for a day = the person's work hours, minus their scheduled site visits, minus their
  drive blocks (section 12), minus their accepted timed Google Calendar events, minus pins.
  All-day, declined, tentative and unanswered events are not busy.
- Everything is on a 15-minute grid. At most 80 % of each day's free minutes is filled (rounded
  down to 15).
- A piece of work is placed in chunks of at least 30 minutes. A remainder under 30 minutes is
  placed whole.
- The horizon is 8 weeks (56 days). The plan starts at the current quarter-hour.
- Order: overdue items first, most overdue first (then higher tier). Otherwise by weight =
  tier factor ÷ (days left + 1), highest first, where days left is counted in whole Chicago days
  and 0 means due today. Ties: earlier due date, then older, then by key. Comparison MUST be
  exact (integer cross-multiplication, not floating point).
  Example: a Low task due tomorrow (1 ÷ 2 = 0.5) outranks a High task due in a week (3 ÷ 8 =
  0.375).
- Each item goes into the earliest free time at or after the later of "now" and its own earliest
  start (a consulting template's start date).
- An undated item plans as if due today + 7 days, recalculated each time. It is never overdue and
  never At risk until it gets a real date.
- A due date holds until the END of its Chicago day.
- At risk: a dated item whose planned finish is after the end of its due day, or which does not
  fit in the horizon. It is still placed, late. Label: "At risk — due <day>" where the day is a
  weekday name within 6 days and a month-and-day otherwise. An item that does not fit reads
  "Doesn't fit in the next 8 weeks".
- "Waiting on customer" tasks are not planned.
- Task blocks exist only in the app. They are not written to Google Calendar.
- If the person's Google Calendar cannot be read, the plan is still made and a note says
  "Planned without your Google calendar — may overlap meetings".
- If the roster, tasks, assignments, visits, work hours or the person's pins cannot be read, no
  plan is produced at all. A plan MUST NOT be built from a partial item list, because saving it
  would wrongly discard pins.

### 10.4 Pins

A pin fixes one block: `{itemKey, startMs, endMs, kind}` where `itemKey` is `task:<id>` or
`asg:<id>` and kind is `started` or `hand`.

- A block becomes a `started` pin when its start time has passed. Only unstarted work moves.
- A `hand` pin is a block the owner dragged to a time.
- An item marked In progress has its current block pinned.
- Unfinished started work: if an open item's pins all ended on an earlier day and together are
  shorter than its size, the rest (size minus pinned, at least 30 minutes) is placed first thing
  on the next work day and pinned for that day.
- Once an item's pins cover its whole size and it is still open, it is never pinned ahead again.
  It gets one fresh movable 30-minute chunk per day, placed after all work that still has size
  left.
- Only the owner's own page views save new `started` pins. Viewing someone else's plan, an
  "everyone" view, or a background build never locks another person's time.
- Limits: a pin is at most 8 hours; a person has at most 500 pins. Over the cap, only past pins
  the plan no longer depends on are pruned, oldest first. A current or future pin is never pruned.
- Pins belong to the person, not the record. Handing an item to someone else, completing it or
  deleting it clears the previous owner's pins for it.

### 10.5 Actions

| Action | Who | Rule |
| --- | --- | --- |
| Drag a block to a time | Owner or admin | Length is the dragged block's, bounded 30 minutes to 8 hours and capped at the item's remaining minutes. A move keeps the stored pin's length. A drop at or before now lands at the next quarter-hour. A block that has started cannot be moved: "This block has started — it stays put." |
| Unpin | Owner or admin | Removes a hand pin. Unpinning held started work also records a release so the next plan does not pin it straight back |
| Push due date | Any signed-in user | Sets a later due date |
| Hand off | Any signed-in user | Reassigns the item |
| Set tier and size | Any signed-in user | |
| Mark in progress | Any signed-in user | Sets the task's status. Lifts an earlier release only when done by the owner or an admin |

A write whose block is no longer where the browser saw it is refused with "That block moved —
refresh."

### 10.6 Where it shows

- `/calendar` Week and Day views draw the blocks, with a popover (Unpin, tier, size, mark in
  progress) and drag to pin. Month view shows task chips on their planned or due day.
- An "At risk" panel on `/calendar` with three choices per item: Push due date, Hand off, Unpin
  something.
- A "Today" card on Home: today's blocks, then anything At risk; "Nothing planned for today."
  when empty.
- Tier and size chips on every task form.
- Morning triage gives +15 points to an At-risk item (section 14.3).

One-time backfill. When the feature was introduced, each person's undated assigned items were
given due dates spread evenly, oldest first, over that person's work days in the next 4 weeks.

**Source:** `src/lib/task-plan/` (`types.ts`, `plan.ts`, `free.ts`, `urgency.ts`, `due.ts`,
`pins.ts`, `items.ts`, `load.ts`, `write.ts`, `labels.ts`, `calendar-view.ts`, `today.ts`,
`triage.ts`, `backfill.ts`), `src/lib/stores/task-pins.ts`,
`src/app/(app)/calendar/plan-actions.ts`, `src/app/(app)/calendar/at-risk-panel.tsx`,
`src/app/(app)/calendar/task-block-popover.tsx`, `src/app/(app)/home-today.tsx`,
`scripts/backfill-task-due.ts`, `AGENTS.md` (phase 49), `DECISIONS.md` (D784–D805).

---

## 11. Site-visit scheduling

### 11.1 Purpose

A site visit is a fixed appointment at a venue with a lead person and optional attendees. This
feature checks a proposed time against everyone's day, suggests days when the lead is already
nearby, and sends each person an invite. The visit record itself is also used by Venue
Assessments, which stays in the main app.

### 11.2 Data model (visit)

`id` (`SV-####`), `customerId`, `customer`, `locationId`, `venue`, `address`, `contactName`,
`contactEmail`, `contactPhone`, `reason` (from a picklist), `startAt`, `endAt` (null until
scheduled), `notes`, `assignedTo` (the lead, by name; blank until claimed), `attendees` (names;
never the lead; at most 8), `invites` (one entry per person: channel `calendar` or `ics`, the
times they were told, event or mail ids), `stage`, `leadId`, `surveyId`, `engagementId`,
`preferredTiming`.

Stages: `requested` (born unclaimed), `open` (released back to the pool), `claimed`, `scheduled`,
`done`. A scheduled visit whose end has passed reads as `done`.

Default reasons: Site survey / measure, Sales call, Punch walk, Install check-in, Warranty check,
Flame test, Rigging inspection, Service call.

### 11.3 Settings

| Setting | Default | Allowed |
| --- | --- | --- |
| Work hours | Monday–Friday, 8:00–17:00 | Days of week; start and end in minutes after midnight; end may be midnight |
| Same-area drive time | 45 minutes | 5–180 |
| Daily drive limit | 300 minutes | 30–960 |
| Nearby-days look-ahead | 21 days | 1–60 |
| Drive buffer per leg | 15 minutes | 0–120 |

Work hours and drive buffer have a company default (admin) and a per-person override (the person,
on their Account page).

### 11.4 Conflict checks

A visit is a stop on the day of the lead and of every attendee. For each person, four checks run.
Conflicts are shown and NEVER block booking.

| Conflict | Raised when |
| --- | --- |
| Double-booked | The visit, or the drive to it, overlaps another busy block. A block that ends exactly when the next starts is not an overlap |
| Tight drive | The drive to the visit would have to start before the previous stop ends. Text: "Tight — needs Xh Ym, has Xh Ym" |
| Outside work hours | The day is not one of the person's work days, or the visit falls outside their hours |
| Too much driving | The day's total drive time (buffer included) exceeds the daily drive limit |

Rules

- Busy blocks are the person's scheduled visits and their accepted (or own) timed Google events.
  All-day, declined, tentative and unanswered events, the app's own drive events, and calendar
  copies of a visit are not busy.
- Another person's Google event is described only as "a calendar event". Only the viewer's own
  events show their titles.
- When the visit's address or the drive to it could not be resolved, the result carries the note
  "Checked without drive time".
- When a person has no connected calendar, the note is "checked visits only".
- A visit's time range is valid when it starts after the epoch, ends after it starts, and spans
  at most 24 hours.

### 11.5 Nearby days

Suggests up to 5 days within the look-ahead on which the LEAD already has a verified stop within
the same-area drive time of the visit's address. Minutes come only from routed drive times, never
from straight-line distance (straight-line distance at 80 mph is used only to skip stops too far
to bother routing). Each suggestion reads like
"Tue Oct 14 · 18 min from Lone Pine Elementary · busy 9–11:30" and lists each attendee as free,
in conflict or unknown. Picking a day keeps the times already typed when they form a valid pair,
otherwise uses 9:00 for one hour.

### 11.6 Invites

- Each person gets their own invite. If the sending mailbox can write to Google Calendar, the
  person gets a calendar event; otherwise an `.ics` email. The `.ics` UID is `sv-<visit id>@peak-app`.
- A change of time, lead or attendees sends updates to those affected, cancels for those removed
  (a real calendar cancel), and adds for those new. Updates and cancels come from the mailbox that
  sent the original.
- Deleting a visit cancels everyone's invite first. Deleting a visit that is already in the past
  leaves calendars alone.
- Changing a SCHEDULED visit (edit, change lead, change time, delete) is allowed only for the
  visit's lead or a user with the `approve` permission, because it emails or cancels everyone's
  calendar copies. Refusal text: "Only the visit lead or an approver can change a scheduled
  visit." "I am the lead" means the lead name matches exactly one user on the whole roster
  (including archived users) and that user is me; an ambiguous or unknown lead name belongs to
  nobody, so only an approver can change that visit. Visits not yet scheduled keep the
  claim/release model and are not restricted.

### 11.7 Where it shows

- A booking panel (lead, attendees, date, start, end, live conflicts per person, nearby days) on
  the visit-requests scheduler in Venue Assessments, in the Inbox "schedule a visit" dialog, and
  behind Edit on the company record for scheduled visits.
- Conflict badges on the company record, on `/calendar` and on Home.
- Read endpoints: `GET /api/visits/check` (the live check while booking; one JSON parameter of at
  most 4,000 characters) and `GET /api/visits/conflicts` (badges for a company's visits, with a
  20-second budget). Both require a signed-in user.
- Nothing is stored for conflicts. They are recomputed.

**Source:** `src/lib/visit-plan/` (`settings.ts`, `hours.ts`, `check.ts`, `busy.ts`, `nearby.ts`,
`pick-day.ts`, `people.ts`, `input.ts`, `agenda.ts`, `load.ts`), `src/lib/stores/site-visits.ts`,
`src/lib/stores/schedule-prefs.ts`, `src/lib/visit-invite.ts`, `src/lib/visit-invite-plan.ts`,
`src/lib/visit-edit-rights.ts`, `src/lib/ics.ts`, `src/lib/lead-thread.ts`,
`src/components/visit-booking/`, `src/app/(app)/visit-booking-actions.ts`,
`src/app/(app)/venue-assessments/visit-actions.ts`, `src/app/api/visits/`,
`AGENTS.md` (phase 48), `DECISIONS.md` (D76, D775–D783).

---

## 12. Address verification and drive time

### 12.1 Address verification

Every address has one of three states. Only a verified address gets a drive time.

| State | Meaning |
| --- | --- |
| `verified` | A building-level point is known |
| `needs_check` | The geocoder found something, but only to town or street level, or the text is a place name |
| `unresolved` | No usable point |

Rules

- A venue stores its state, coordinates and their source (`geocode`, `pin` or `override`) on the
  venue record. Every other address (a visit's typed address, a calendar event's location) lives
  in a "place book" keyed by the normalised text.
- Normalising: lowercase; every run of characters that are not letters or digits becomes one
  space; trim. Matching is by exact key only. No abbreviation folding and no fuzzy matching.
- A geocoded free-text address is verified only when ALL hold: the typed street part starts with
  a house number; the result's house number equals it (case-insensitive; one side may carry one
  trailing letter, so "123" equals "123A" but "123A" does not equal "123B"); and the typed text
  has a locality after the street (a comma part matching the result's city, or a 5-digit ZIP
  equal to the result's postcode). A leading token that names a numbered road ("US-14", "Hwy 12",
  "County Road 12") or is an ordinal ("5th Ave") is not a house number.
- A hand-dropped pin is the only way to verify without that test.
- A geocode result never overwrites a pin. A deliberate Fix may.
- A geocoder outage writes nothing; the next live pass retries.
- A calendar event location is drivable when it is not blank, not a URL, does not mention
  Zoom/Teams/Meet/Webex, and is not a bare phone number.
- Address text longer than 1,000 normalised characters is treated as notes and stays unresolved.
- Geocoder requests MUST be paced to at most one per second across the whole process.

Fix dialog (any signed-in user): retype and retry, pick a suggestion, or drop a pin. A venue fix
writes the venue; any other fix writes the place book under the ORIGINAL key so the same text
never flags again.

"Addresses to verify" (admins): a live list of unverified venues, upcoming visits and open leads,
filterable by status, that shrinks as addresses are fixed anywhere.

### 12.2 Drive plan for a day

For one person and one Chicago day:

- Stops are the person's scheduled site visits with a start time, and their Google events with a
  drivable location. Not stops: all-day events, declined events, the app's own drive events, and
  a calendar copy of a visit.
- Legs: base → first stop; each stop → the next; last stop → base.
- The base is the person's office. If the previous day was marked "staying over", the first leg
  starts from the previous day's last stop. If today is marked "staying over", there is no leg
  back.
- Two consecutive stops at the same point produce no leg.
- Leg minutes = routed minutes + the person's drive buffer.
- A drive-to leg ends when the stop starts. The leg back starts when the last stop ends (the
  latest end among all the day's stops).
- A routed time under 3 minutes produces no leg.
- A leg is flagged instead of timed, and a flagged leg has no minutes and counts as 0 in the day
  total:

| Flag | Text | When |
| --- | --- | --- |
| No base | "No base set" | The person has no office with coordinates |
| Unverified | "Address not verified — no drive time" | Either end is not verified. Offers Fix |
| Route unavailable | "Drive time unavailable — retrying" | No routed time is known yet |
| Long route | "Over 6 h — check the address" | Routed time above 360 minutes. Offers Fix |

- Routed minutes come only from the route cache or the routing service. There is no
  straight-line fallback anywhere on this path.
- Page views read the cache only. Background syncs may geocode and route, within a time budget.

### 12.3 Google Calendar sync of drive legs

- Each timed leg becomes one Google event titled "Drive to <stop>" or "Drive back to <base>",
  marked busy, with no reminders, carrying a private tag that identifies it as the app's.
- The sync inserts, updates and deletes ONLY events carrying that tag and belonging to this
  person. It MUST never touch an event the person made.
- Window: today through today + 14 days. Past days are never written.
- Flagged legs get no event, except that a leg only waiting on a route keeps the event it has.
- A person with no connected calendar is app-only.
- One sync per person at a time (a lease). The tagged events are re-read immediately before
  comparing, so a slow plan never compares against stale data. Only days the read covered in full
  are compared.
- Triggers: scheduling, editing or deleting a visit; creating or editing an in-app calendar
  event; toggling "staying over" (that day and the next); fixing an address; opening Home or
  `/calendar` when the last sync is more than 10 minutes old; and a daily background job.
- A write failure is logged and retried at the next sync.

### 12.4 Where it shows

Drive blocks, flags and a day total on `/calendar` and on the Home calendar card; booking
warnings in the visit booking panel; an "unverified address" flag on a today's-visit row in
morning triage.

**Source:** `src/lib/address-verify/` (`types.ts`, `keys.ts`, `state.ts`, `place-book.ts`,
`fix.ts`, `targets.ts`, `worklist.ts`, `venue-geo.ts`, `triage-flags.ts`),
`src/lib/drive-plan/` (`plan.ts`, `stops.ts`, `day.ts`, `load.ts`), `src/lib/drive-sync/`
(`sync.ts`, `diff.ts`, `agenda.ts`), `src/lib/stores/schedule-prefs.ts`,
`src/app/(app)/address-actions.ts`, `src/components/address-fix/`,
`src/app/(app)/settings/addresses-to-verify.tsx`, `src/app/api/drive/sync/route.ts`,
`AGENTS.md` (phase 45), `DECISIONS.md` (D712–D724).

---

## 13. Calendar

### 13.1 Purpose

`/calendar` is a personal calendar that merges everything dated.

### 13.2 What it shows

| Layer | Source |
| --- | --- |
| Google events | The signed-in user's own Google Calendar |
| External events | Calendars from additional Google accounts the user connected only to view, each with a show/hide switch and a colour |
| Site visits | Visits where the user is lead or attendee. A visit that also exists as a Google event is shown once |
| Drive blocks and flags | Section 12 |
| Task blocks | Section 10 (Week and Day views) |
| Task chips | Month view: an open task due today or later sits on its due day; an undated open task floats on today; an overdue open task floats on today with its days overdue; done items are never shown; nothing is placed on a past day |

Views: Month (`?month=YYYY-MM`), Week and Day (`?view=week|day&date=YYYY-MM-DD`). Tasks are mine
by default; `?tasks=all` shows everyone's.

### 13.3 Actions

- Create, edit and delete an event on the user's own Google Calendar (title, time, location,
  guests chosen by a people search).
- Toggle "Staying over" for a day. Allowed from yesterday through today + 14 days.
- Connect or disconnect an additional Google account; show or hide and recolour its calendars;
  refresh a connection.
- Complete or delete a task or assignment from its chip.
- The planner actions in section 10.5.

Home also has a Calendar card showing the next 14 days from the same sources.

**Source:** `src/app/(app)/calendar/` (`page.tsx`, `calendar-client.tsx`, `event-modal.tsx`,
`calendar-filter-rail.tsx`, `task-chip.tsx`, `task-block-layer.tsx`, `task-actions.ts`),
`src/app/(app)/calendar-actions.ts`, `src/lib/agenda.ts`, `src/lib/calendar-tasks.ts`,
`src/lib/calendar-tasks-load.ts`, `src/lib/google/calendar.ts`,
`src/lib/google/calendar-connections.ts`, `src/app/(app)/home-calendar.tsx`,
`DECISIONS.md` (D77, D81, D148).

---

## 14. Morning triage ("Start here")

### 14.1 Purpose

One ranked list per person of what needs attention now, across email, calls, tasks, leads, site
visits, quotes and renewals. Home shows the top 10 in a "Start here" card; `/triage` shows the
whole list.

### 14.2 Feeds

Each feed produces candidate rows with one or more "facts". A feed that fails becomes a note
("<Feed> couldn't be read — list may be incomplete") and never fails the list.

| Feed | A row appears when | Facts |
| --- | --- | --- |
| Email | A thread is assigned to me, is waiting on us, the ball is in my court, and it is not archived, deleted or flagged as noise | Waiting 1 or more business days → "customer waiting N business days"; otherwise "customer message N h old". Plus "linked to an open quote or lead" when it is |
| Call to-do | A recording from the last 7 days has an undecided action item assigned to me, or unassigned on a recording I made | "to-do from a call"; plus "names you" when assigned to me. The row quotes the matching transcript line and links to it |
| Task / assignment | An open item of mine is overdue, due today, due tomorrow, or At risk | Those facts; plus High or Low tier |
| Lead | An open lead that is mine or unowned and: its first-response deadline has passed; or the deadline is within 4 hours; or its next action is overdue; or (if none of those) it has had no activity for 5 days | Those facts |
| Site visit | A visit today where I am lead or attendee, not done | "site visit today <time>"; plus an unverified-address flag |
| Quote | A quote awaiting my approval; a quote of mine sent back for changes; a bid I own that is due tomorrow, today or up to 14 days past due and still missing a bidder's current revision; a portal quote waiting on a Peak price | Those facts |
| Renewal | A flame-test or inspection renewal I own, not yet contacted, overdue or due soon | Those facts |

### 14.3 Ranking

A row's score is the sum of its facts' points. Ties: the older item first, then by key.

| Fact | Points |
| --- | --- |
| Lead first response overdue | 60 |
| Site visit today | 50 |
| Task overdue | 40 + 5 per day overdue, the bonus capped at 30 |
| Customer waiting (business days) | 40 + 10 per business day after the first, the bonus capped at 30 |
| Quote waiting on my approval | 35 |
| Lead first response due soon | 35 |
| Bid due | 35 when due today or past due; 25 when due tomorrow |
| Task due today; to-do from a call; portal quote to review; quote sent back; renewal past due | 30 |
| Lead follow-up overdue | 25 |
| Task At risk; renewal due soon; task due tomorrow | 15 |
| Task tier | High +15; Low −10 |
| Linked to an open deal; call names me; visit flag; new customer message; stale lead | 10 |

The reason shown under a row is its top two positive facts in words, joined by " · " (for example
"Overdue 3 days · High priority").

Business time counts only Chicago Monday–Friday. Weekends count zero.

Duplicates. A call to-do whose title (normalised) matches one of my open tasks or assignments is
dropped, and that task's row gains "Also mentioned in <meeting> (<date>)". Two call to-dos with
the same title collapse into the earliest one.

A list keeps at most 150 rows.

### 14.4 Snapshots

- There are two lists a day: morning and afternoon. The afternoon list begins at 13:45 Chicago.
- A list is a frozen snapshot per person. It is built by a background job, or on the person's
  first view if none exists yet. Creation MUST be insert-if-absent: a background build never
  replaces a list a person may already be working from.
- If the snapshot cannot be read or saved, the list is computed live and shown with
  "Showing a live list — today's saved list couldn't be built."
- Between builds the list does not change, except that a row is hidden once its source is
  finished: task or assignment done or deleted; thread no longer waiting on us, archived,
  deleted or reassigned; call to-do decided; quote no longer waiting on me. Lead, visit and
  renewal rows stay until marked or until the next snapshot.
- If that check itself fails, the rows it could have hidden are hidden (fail closed).

### 14.5 Row actions

Every action works only on a row of the signed-in user's own current snapshot.

| Action | Effect |
| --- | --- |
| Done | Task → done. Assignment → done. Email → thread closed (re-checked at action time: still mine or still assigned to me). Call to-do → opens the meeting's to-do decision. Lead, quote, visit, renewal → hidden for this snapshot only ("done for today") |
| Snooze | Hidden until the next morning's list |
| Not mine | Hidden for good, unless the item escalates afterwards (a newer inbound customer message, a resubmission for approval, a lead's deadline passing), in which case it returns |
| Reassign (email only) | Assigns the thread to a named teammate and hides the row |

An admin can view a teammate's list read-only. Email rows on someone else's list show as
"Private email".

**Source:** `src/lib/triage/` (`types.ts`, `rank.ts`, `clock.ts`, `keys.ts`, `dedupe.ts`,
`build.ts`, `service.ts`, `store.ts`, `view.ts`, `liveness.ts`, `actions-plan.ts`, `hooks.ts`,
`listed.ts`, `feeds/*.ts`), `src/app/(app)/triage/page.tsx`, `src/app/(app)/triage/actions.ts`,
`src/components/triage/`, `src/app/api/triage/build/route.ts`, `src/lib/stores/leads.ts`
(`STALE_DAYS`, `slaDeadline`), `AGENTS.md` (phase 44), `DECISIONS.md` (D707–D711).

---

## 15. Integrations and background jobs

### 15.1 Google Calendar

Used for: crew booking events (section 4.2), repair scheduling events (section 6.3), visit
invites (section 11.6), drive events (section 12.3), reading busy time for the planner and for
conflict checks, and the Calendar screen. Every write is best-effort: the app's own record is
authoritative and a Google failure never rejects the change.

### 15.2 Google Tasks

Each person's queue is mirrored to a Google Tasks list. Completing a task there completes the
matching ASSIGNMENT only (`doneVia: "google-tasks"`). Other queue rows are read-only outside the
app.

### 15.3 Reminders API

`GET /api/queue?who=<name>` returns a person's open queue as JSON; `POST /api/queue` with
`{key: "assignment:<id>", done: true}` completes an assignment. Authentication is a signed-in
session or a machine token in the `x-queue-token` header matched against a server secret. The
restriction to assignments MUST be enforced by the endpoint itself, not by the client, so that a
checkbox on a phone can never approve a quote review. It exists for a small agent on a Mac that
syncs the queue into Apple Reminders.

### 15.4 Scheduled jobs

| Time (UTC, daily) | Endpoint | What it does for this area |
| --- | --- | --- |
| 11:00 | `/api/drive/sync` | Backfills venue address status; syncs every person's drive events within a 50-second budget |
| 11:45 | `/api/gmail/sync` | Builds every person's morning triage list; syncs Google Tasks |
| 18:45 | `/api/triage/build?slot=midday` | Builds every person's afternoon triage list |

Each endpoint is called without a session and MUST check a bearer secret itself; with no secret
configured it refuses. Each stops starting new people when its deadline passes; people it skipped
are built on first view. These endpoints also carry unrelated jobs that are NOT part of this
area (assessment reminders, a daily manufacturer price sync, catalog photo sync, daily briefs).

### 15.5 Offline sync

`projects`, `tasks` and `repair_jobs` are among the collections a field device may mirror and
push (section 5.3). A push is a whole-document upsert, so embedded lists use soft-delete flags.

**Source:** `src/lib/google/calendar.ts`, `src/lib/google/tasks-sync.ts`, `src/lib/google/tasks.ts`,
`src/lib/service-calendar.ts`, `src/app/api/queue/route.ts`, `scripts/reminders-agent.ts`,
`vercel.json`, `src/middleware.ts`, `src/app/api/drive/sync/route.ts`,
`src/app/api/gmail/sync/route.ts`, `src/app/api/triage/build/route.ts`, `src/lib/triage/cron.ts`,
`src/db/doc-tables.ts` (`SYNCABLE_COLLECTIONS`), `src/lib/sync/engine.ts`.

---

## 16. Settings that belong to this area

| Where | Setting |
| --- | --- |
| Settings → Sales & Rewards → Pipelines | Project pipelines and stages (section 3.4). Stages in use can be moved to another stage before removal |
| Settings → Field & Venues | Site-visit reason picklist; company work hours, same-area minutes, daily drive limit, look-ahead days; company drive buffer |
| Settings → Consulting | Phase menu and phase weights (section 8.4); disciplines |
| Settings → Data & Tools | Addresses to verify; link to Task Templates |
| Account | My work hours; my drive buffer; notification switches for "Projects need attention", "Repairs awaiting scheduling", "Tasks assigned to you or overdue", "Site visit requests" |
| Estimating Rules | Repair rates; Travel & mileage (road factor, speed, fly rates) |
| Templates | Wording for the repair completion letter and the warranty record |
| Import / Export | CSV import and export for projects (Project Name, Customer, Kind, Value, Stage, Target Date), rental equipment (SKU, Name, Category, Manufacturer, Day/Week/Month Rate) and task templates |
| Home dashboard | Cards: My Queue, Today, Calendar. Reports widgets: Backlog value, To be billed, Expected collected, Markup at completion, Billing forecast, Backlog value by stage, Upcoming completions, Completion timeline, Project locations, Projected profit, Open projects, Backlog |

Bell groups from this area: "Projects need attention" (active projects with a risk flag),
"Repairs awaiting scheduling" (approved repairs; the nav badge also counts flagged inspection
findings), "Tasks needing attention".

**Source:** `src/app/(app)/settings/settings-sections.ts`,
`src/app/(app)/settings/pipelines-card.tsx`,
`src/app/(app)/settings/scheduling-defaults-card.tsx`, `src/app/(app)/account/page.tsx`,
`src/lib/stores/notif-prefs.ts`, `src/lib/nav-counts.ts`, `src/lib/stores/pricing.ts`,
`src/lib/templates.ts`, `src/app/(app)/import/types.ts`, `src/lib/dashboard/registry.ts`.

---

## 17. Known gaps and doc-versus-code disagreements

### 17.1 Gaps a rebuild should not copy

- Starter procurement lines are invented from fixed shares of the quote value (22 %, 18 %, 20 %,
  30 %, 5 %) and five hard-coded vendors with hard-coded lead times. They are not derived from
  the estimate's actual parts. There is no screen to add, edit or delete a procurement line or a
  delivery; only status and PO number can be changed. A rebuild should derive lines from the won
  estimate.
- There is no way to create a delivery from the project screens, so the "all deliveries received"
  auto-advance only fires on seeded or imported records.
- `trainingAt` on the project and `photo` on a project note are stored but nothing sets them.
  Field notes are text only. A repair completion's `photos` list is always saved empty.
- A warranty "month" is exactly 30 days, so a 12-month warranty lasts 360 days.
- A rental booking cannot be cancelled from any screen. The `cancelled` status exists and a code
  comment says the board cancels bookings, but the board only offers Mark out and Mark returned.
- A rental location can be created but not edited.
- Approving a repair quote needs only a signed-in user. Approving a rental quote needs `send`.
  Most project, repair and schedule actions also need only a signed-in user.
- Repair mileage and labor rates changed on one quote's builder change the global rate.
- People are matched by name in several places (crew, assignments, queue rows). The queue's
  project-task rows use an exact name match while triage uses a trimmed, case-insensitive match,
  so the two lists can differ for the same person.
- The default owner fallback is a hard-coded person's name.
- Tasks and assignments are two parallel record types with overlapping purpose.
- The crew board has no drag-to-reschedule and no time-off lanes. A source comment says both
  existed in the original prototype and were not carried over.

### 17.2 Documentation versus code

- `AGENTS.md` (phase 44) says Krisp meeting to-dos reach triage "through a second
  `CallTodoSource`". The code registers one call source only (in-app recordings). Meeting to-dos
  reach triage as ordinary tasks instead.
- `AGENTS.md` (phase 11) says "`/schedule` becomes editable". In the code only consulting task
  bars on the by-person view can be dragged; the crew board is edited through forms.
- `AGENTS.md` (phase 45) calls drive time "today → +14". The code's window is 15 days: today plus
  the next 14.
- `AGENTS.md` (phase 44) describes the two triage slots as "morning" and "midday". The stored
  slot names are still `morning` and `midday`, but the split is at 13:45 Chicago and the second
  list is labelled "Afternoon list".
- A comment in the rentals booking store says the booking board cancels bookings. It does not
  (section 17.1).

**Source:** `src/lib/stores/projects.ts` (`deriveProcurement`, `VENDORS`),
`src/lib/stores/repair-jobs.ts`, `src/app/(app)/repairs/actions.ts`,
`src/app/(app)/repairs/quote/actions.ts`, `src/app/(app)/rentals/board/actions.ts`,
`src/lib/stores/equipment-bookings.ts`, `src/app/(app)/schedule/actions.ts`,
`src/lib/triage/feeds/calls.ts`, `src/lib/triage/clock.ts`, `src/lib/drive-sync/sync.ts`,
`src/lib/queue.ts`, `src/lib/triage/feeds/tasks.ts`, `AGENTS.md`.

---

## 18. Not verified

The following were taken from project notes, code comments or file headers and were not traced
line by line.

- The exact layout and wording of the repair proposal letter, service report variants, completion
  letter and warranty record, and of the installer handoff packet PDF. Their routes, inputs and
  purpose were read; their bodies were not.
- The repair quote builder's on-screen preview. It is stated to match the server; only the server
  calculation was read.
- The per-recipient invite planner's add/update/cancel details and the `.ics` cancel behaviour in
  real mail clients (`src/lib/visit-invite-plan.ts`, `src/lib/visit-invite.ts`).
- The Google Tasks mirror (`src/lib/google/tasks-sync.ts`): list name, direction of each field,
  and conflict handling.
- The one-time removal of older auto-created travel blocks from Google Calendar that the drive
  sync also performs.
- The Calendar screen's event editor fields and the filter rail, beyond the action names.
- The Project timeline band layout and the by-person merge of install bookings, beyond the file
  header comments.
- The Projects Board view's exact column set (per stage or per tag) and card contents.
- How Daylite-imported projects and repairs are built (`src/lib/daylite/`). Only the fields they
  set on these records were noted.
- The lead first-response deadline rule used by triage. It belongs to the CRM
  (`src/lib/stores/leads.ts`) and was read only for its constants.
- The task-template CSV import's handling of unknown phases, disciplines and assignees.
- The customer rewards credit applied to repair quotes.
- Behaviour on real mobile devices and in the native app shells.
