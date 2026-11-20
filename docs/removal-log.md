# Removal log

Running notes for the four-stage shrink of the app. One section per stage, newest last.
The maps and Jeff's decisions live in `docs/handoff/` (not edited here).

## Stage 1 — done 2026-11-20

Scope: Project Management (install Projects, Schedule, Field Work, Repairs, Rentals, consulting
scheduling + task templates, Tasks + Queue + assignments, the auto task calendar, `/calendar`,
site-visit booking / invites, drive time + drive sync, Morning triage), plus Rewards and the
Daylite import. Map: `docs/handoff/removal-map-project-management.md`.

State at hand-off: `tsc --noEmit` 0 errors; `eslint src --quiet` 0 errors; nothing committed by
the stage-1 agent (the coordinator made WIP checkpoint commits). No table, migration or
`src/db/schema.ts` change; no data script. `npm run build` was NOT run.

### Rules that changed

- **Won is only a status.** `src/lib/stores/quote-spawn.ts` is deleted and both calls in
  `setStatus` are gone, for every quote type (system, flame test, inspection, repair, rental,
  consulting). The page-load "healing" sweeps that created missing records are gone too
  (Flame tests, Inspections and Consulting pages). The estimator bonus record on Won stays;
  `syncProjectBonusPool` is gone.
- **No tasks, assignments or reminders are created anywhere.** Estimate follow-up task, client
  package response task, portal acceptance task, vendor price-list assignment, assessment
  reminders, promise tasks, Krisp action-item accept, meeting to-do → task: all stop. The rest
  of each feature still works (a client response is still stored, noted and shown).
- **Rewards.** Screens, settings, program, ledger and perks are deleted. A quote saved while
  Rewards existed may carry a credit (a `rewardCredit` line on an Estimator quote, or
  `rewardCredit` on a service subdoc) and its stored `value` is net of it. That stored amount is
  still honoured so old quotes add up: `src/lib/credit-line.ts` (read-only helpers). Nothing
  applies a new credit; a save can never raise one; it prints as "Credit applied". The
  purchase-perks line ("Your Gold rewards: …") no longer prints anywhere.
- **Old repair / rental quotes** open their row in the Quotes hub (`/quotes?id=`); the hub hides
  the "Open … quote" button for them. They no longer get a saved PDF.

### Deleted (300 files)

Top-level directories and files:

- Screens / routes: `src/app/(app)/{projects,schedule,field-work,repairs,rentals,task-templates,queue,calendar,triage,rewards}/`,
  `src/app/(app)/settings/rewards/`, `src/app/(app)/import/daylite/`, `src/app/api/{projects,queue,triage,visits}/`,
  `calendar-actions.ts`, `visit-booking-actions.ts`, `brief-actions.ts`, `home-queue.tsx`, `home-calendar.tsx`,
  `home-today.tsx`, the Account work-hours / drive-buffer / invite / brief-reminder cards, the Settings
  scheduling- and drive-defaults cards, `_dashboard/widgets/installs.tsx`, `companies/[id]/rewards-card.tsx`,
  `estimator/reward-credit-panel.tsx`.
- Libraries: `src/lib/{triage,task-plan,visit-plan,drive-plan,drive-sync,rewards,daylite,pricing}/`, the stores
  `projects, repair-jobs, equipment-*, task-templates, task-pins, schedule-prefs, tasks, assignments, rewards,
  reward-ledger, reward-perks, quote-spawn`, and `repair-engine, project-quote-types, consulting-schedule,
  engagement-activity(-write), queue(-types), agenda, calendar-tasks(-load), operations-work(-server),
  service-calendar, visit-invite(-plan), ics, safe-sweep, job-value, task-ids, task-template-kinds,
  google/tasks(-sync), sync/task-push, address-verify/triage-flags`.
- Components: `gantt/`, `visit-booking/`, `task-plan/`, `triage/`, `rewards/`, `tasks-card.tsx`,
  `apply-template-control.tsx`, `project-value-editor.tsx`.
- Seeds: `src/db/seeds/{projects,repair-jobs,equipment}.ts`.
- Scripts: `backfill-task-due, reminders-agent, test-auto-calendar, test-drive-time, test-morning-triage,
  test-site-visits, audit-daylite-export, daylite-ids, import-daylite, pull-daylite, test-brief`, with their
  `package.json` entries.

### Later-stage files deleted early (so the next agents know)

Stage 2 (Inbox / Krisp / AI):

- The whole AI daily brief: `src/lib/brief/*` except `types.ts` (now only the stored `PreDraft` / `AssistNudge`
  shapes), `src/components/brief/*`, `src/app/(app)/brief-actions.ts`, `scripts/test-brief.ts`. It was built
  on the triage snapshot and cannot exist without it.
- Tasks-from-email: `inbox/task-dialog.tsx`, `inbox/task-actions.ts`, `inbox/thread-tasks-card.tsx`,
  `inbox/assist-tasks-dialog.tsx`, `src/lib/inbox-task.ts`, `inbox-task-write.ts`, `task-thread-share.ts`,
  `assist/tasks-server.ts`, `assist/ask-task-write.ts`, `assist/features/task-suggest.ts`.
- Site visit from an email: `inbox/site-visit-actions.ts`, `inbox/site-visit-modal.tsx`.
- `src/lib/inbox-org/due.ts`, `src/components/meetings/waiting-on-card.tsx`.

Stage 3 (Flame / Inspections / Assessments / Portal):

- `src/lib/assessments/reminders.ts`, `reminders-server.ts`, `reminder-close.ts`.
- `src/app/portal/rewards-card.tsx`, `redeem-perk-button.tsx`.

Stage 4 (Design):

- `design/engagements/schedule-tab.tsx`, `schedule-actions.ts`, `activity-tab.tsx`, `activity-actions.ts`
  (consulting project management). The engagement page keeps its other six tabs.

### New small modules (helpers moved out of deleted directories)

- `src/lib/chicago-day.ts` — was `drive-plan/day.ts`, plus `dayKey`, `dayDiff`, `chicagoTime`,
  `chicagoShortDate`, `chicagoMidnight` from `triage/clock.ts`.
- `src/lib/cron-auth.ts` — `cronAuthFailure` from `triage/cron.ts`.
- `src/lib/visit-fields.ts` — `cleanAttendees`, `readAttendees`, `validVisitSpan`.
- `src/lib/trip-travel.ts` — `tripTravel` and its types, unchanged, from the repair engine (the
  inspection engine uses it).
- `src/lib/credit-line.ts` — the read-only stored-credit helpers described above.
- `validateSpan` now lives in `src/lib/consulting-stages.ts`.
- `ADDRESS_UNVERIFIED_TEXT` in `src/lib/address-verify/types.ts` (was `FLAG_TEXT.unverified`).

### Wiring

- Nav: Projects, My Projects, Schedule, Field Work, Repairs, Rentals and Rewards removed. The old
  "Projects" group now holds only Flame Tests and Rigging Inspections and is labelled "Service".
  Home tabs: My Queue and Calendar removed.
- Home: Start here, Daily brief, My Queue, Today and Calendar cards removed. Reports: the Installs
  widgets and `projected-profit`, `open-projects`, `backlog` removed. A saved layout naming a removed
  widget id is skipped (`normalizeLayout`; covered by a test).
- Bell: "Projects need attention", "Repairs awaiting scheduling", "Tasks needing attention", "Perks to
  fulfil" removed, with their Account switches.
- Cron: `/api/triage/build` removed from `vercel.json` and the middleware matcher. `/api/drive/sync`
  keeps its path and now runs only the venue geo stamp and the ETC daily price sync. `/api/gmail/sync`
  lost the Google Tasks, vendor-assignment, triage and brief riders (mail, recordings, meetings and
  catalog photos remain).
- Settings: Task Templates and Rewards tiles, scheduling and drive defaults, and the project half of
  Pipelines removed ("Sales & Rewards" is now "Sales"). Account: work hours, drive buffer, invite and
  brief-reminder cards removed. Estimating Rules: the Repair pricing group removed.
- Import / Export: `projects`, `equipment`, `task_templates` types and the Daylite card removed.
- Offline sync: `repair_jobs`, `projects`, `tasks` removed from `SYNCABLE_COLLECTIONS` and
  `FIELD_COLLECTIONS` together. Table registrations in `src/db/doc-tables.ts` are untouched.
- "+ New quote": Repair and Rental removed.

### Judgement calls

1. Stored Rewards credits are kept as plain credits (see above) rather than stripped, so no stored
   quote total changes. There is no longer any control to remove one from a draft.
2. `rewardsLine: ""` stays as an always-empty field in the cover / package totals models so their
   stored JSON baselines stay byte-identical; nothing prints it.
3. The site-visit request queue (claim, two date inputs, Schedule, Release, Delete) stays inside Venue
   Assessments as a plain form; booking panel, attendee picker, conflict chips, Edit button, invites and
   calendar events are gone. Stored `invites` / `attendees` fields are read as-is.
4. Consulting engagements lose the Schedule and Activity tabs and the quote → engagement sweep.
5. Documents can no longer be attached to a project; a document already on one keeps its link and can
   still be edited (existence is checked straight on the `projects` table).
6. Project party rows are no longer listed on a company's Bids & roles card and no longer block
   deleting that company. `PARTY_RECORD_TYPES` still contains `project` (stored rows).
7. Meetings: deciding a Krisp to-do as Task / Waiting is refused with a message; Note and Dismiss work.
8. `src/lib/assist/ask-*`: project and task tools answer "removed"; the task card's confirm is refused.
9. Flame-test and inspection builders keep an existing stored credit for the same customer; the credit
   panel, perks banner and the letters' credit rows are gone.
10. `scripts/enrich-addresses.ts` (`npm run geo`): only its Daylite `enrich` mode was removed.

### Tests

`tsconfig.json` type-checks `scripts/**`, so every script had to compile. Pruning was compiler-driven
(TypeScript AST): an import of a deleted module is dropped; each statement that then fails to compile is
dropped; repeat until clean. Then each suite was run on a throwaway database
(`PGLITE_PATH=<temp dir>`, never `.data`), and assertions that failed because they pinned removed code or
text were dropped or updated. Every removed statement is listed in
`docs/removal-stage1-pruned-tests.txt` (about 3,200 entries; `scripts/test-review-and-spec.ts` went
from 72,161 to about 67,000 lines).

Result on 2026-11-20: `test-review-and-spec.ts` 10,674 PASS / 0 FAIL; every other `scripts/test-*.ts`
exits 0.

What this does and does not prove:

- Behaviour tests for kept features that survived the prune pass, including the byte-for-byte document
  baselines (`#P2b`, `#364`, `#365`) and the won-version reopen with a stored credit (`test-batch5`).
- The prune removes whole statements. Where one assertion mixed a kept check with a removed one, the
  whole assertion went. Known cases worth re-adding in a shorter form: the nav-group shape checks, the
  Send & track card order (`#P3 send UI`), `#305 steps`, the `#208` / `#217` formula-string checks for
  flame and inspection, and the service-builder source pins inside loops that also named `repairs`
  (`#242`, `#275`, `#282 P3`).
- `docs/superpowers/fixtures/364-bom-view-baseline.json` was edited: the credit label and the perks
  line in its `bomRewards` case. Nothing else in it changed.

### Loose ends

- `src/lib/pipelines.ts` still exports the project-pipeline helpers (`DEFAULT_PROJECT_PIPELINES`,
  `projectPipelineFor`, `isDone`, …). Dead for kept code; `venue-match.ts` still imports `isDone`.
- Vestigial names: `canApplyCredit` (it means "has `create`") in the Estimator; `followUpDays` is still
  accepted by the send action and ignored; `SEND_COPY.badFollowUp` / `taskFailed` are unused.
- Assessments UI still offers "Repair quote" as a target for findings; the server refuses it.
- Unused locals left in later-stage files that were cut minimally (`inbox/thread-reader.tsx`,
  `recordings/[id]/detail-client.tsx`, flame / inspection builders). ESLint reports them as warnings.
- `catalog-rename` still has its `projects` step (it rewrites SKUs inside old project documents).
- `AGENTS.md`, `MASTER-HOWTO.md`, `DEPLOY.md`, `docs/specs/*` still describe the removed screens,
  apart from the short note added at the top of AGENTS.md's phase list.
- Deployment: `QUEUE_API_TOKEN` is no longer read. Google Calendar events, drive events and Google
  Tasks lists the app created earlier stay in people's Google accounts (map risk R9).
- Native apps: the client `FIELD_COLLECTIONS` list changed, so rebuild them with the release; a device
  holding queued project / task / repair pushes will have them refused (map risk R10).
