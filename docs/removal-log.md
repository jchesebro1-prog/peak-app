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

## Stage 2 — done 2026-11-20

Scope: the Inbox email client and the thread store, the Gmail integration (connect / callback,
tokens, send, import, labels, polling, the `/api/gmail/sync` cron), mailbox identity and visibility,
Inbox organization, Krisp meetings and in-app recordings, the whole Assist / AI layer (Ask AI,
estimate suggestion, Read the PDF, AI filing, the leftover brief types), Google Calendar / Tasks /
Drive clients, and the Google Drive catalog-photo sync. Map:
`docs/handoff/removal-map-inbox-krisp-ai.md`.

State at hand-off: `tsc --noEmit` 0 errors; `eslint src --quiet` 0 errors; every `scripts/test-*.ts`
exits 0 (figures under Tests). Nothing committed by the stage-2 agent. No table, migration or
`src/db/schema.ts` change; no data script. `npm run build` was NOT run.

### Rules that changed

- **The app sends no email.** The Send & track step keeps Status (with the next-step control),
  Client link (+ link opens and client responses), Bidders, Vendors, Pipeline and the bonus card.
  The email composer, the email Activity card, Open in Inbox, the per-bidder email panel and
  "Send to all bidders" are gone. An estimate is marked sent by hand: **Send to customer →** (or the
  status select). That is the same `setStatus("sent")` an emailed send ran, so it still moves the
  status, cuts the sent revision (frozen spec + printed header; the revision's time is the sent
  time), copies the current PDF onto that revision or schedules a render when the file is behind,
  and the client link is minted on it by Copy client link. See "Mark sent" below.
- **Bidders are stamped by hand.** "Mark submitted" (which stamps the bidder with the current
  revision, who, when and an optional confirmation #) is now offered on every pending bidder, not
  only bid-website rows. Download PDF, Copy link, link opens, Award / Undo award are unchanged.
- **A box goods sale that still carries labor is refused on the manual path too** (Send to
  customer → and the Quotes-hub / Estimator status move to Sent). The email send used to be the
  path that checked this.
- **Vendor quotes are upload-only.** "Add as vendor quote…" from an email, the `?vq=` hand-off,
  "File to estimate / project…" and Read the PDF are gone. The Vendors card lists vendor companies
  and their quotes; no email threads. A posted vendor quote never stores `extracted` /
  `extractedIndex` (stripped on save and on move / copy).
- **No AI anywhere.** No Assist gate, provider, prompt, run log, key store or Settings card;
  `@anthropic-ai/sdk` is removed. ⌘K is plain search again (no Ask AI row, no thread / meeting /
  recording groups).
- **Google Drive is no longer a catalog photo source.** The Drive sync, its panel and "Sync now",
  the photos-account picker and the cron rider are gone. Photos already attached stay (their
  `Drive` source label still shows). The photo sheet still works with links and dropped files; a
  bare file name that used to resolve from Drive now reads "Drive photos are no longer a source —
  drop the file with the sheet or use a link".
- **Activity feeds** (company page, vendor page, company summary) list notes, quotes, visits,
  flame / inspection jobs and surveys — no email threads or meetings. The company page's
  Communications, Recordings and Meetings cards are gone.
- **Portal sign-in links are copied, not emailed** (the grant actions answer "Copy the link and
  send it yourself"). Portal is stage 3; this was the smallest cut.
- **Renewal one-click (flame / inspection, stage 3 code)** still mints this year's quote, then opens
  it in the Quotes hub instead of an Inbox draft.

### Deleted (269 files, 3 of them moved — see "New small modules")

- Screens / routes: `src/app/(app)/{inbox,recordings}/`, `src/app/api/{gmail,inbox,assist,recordings}/`,
  `home-inbox.tsx`, the Account signature / Krisp / Inbox-organization cards, the Settings
  Integrations group (`groups/integrations.tsx`), `groups/assist-pilot.tsx`, `groups/assist-org.tsx`,
  `settings/assist-data.ts`, `catalog/documents/drive-photos-panel.tsx`, the assessment report's
  Email action (`assessments/[id]/report/actions.ts`), and in the Estimator `send-actions.ts`,
  `assist-actions.ts`, `vendor-pdf-actions.ts`, `vendor-pdf-panel.tsx`, `suggested-bom-panel.tsx`,
  `assist-draft-banner.tsx`, `steps/{send-composer,send-activity,bidder-send-panel}.tsx`,
  `steps/use-bidder-walk.ts`.
- Libraries: `src/lib/{gmail,inbox-org,meetings,krisp,recorder,assist,brief,estimate-email,vendor-pdf,google}/`,
  the stores `comms, comms-visibility, inbox-org, meetings, recordings, assist-runs,
  estimate-suggestions, signatures`, every `src/lib/inbox-*.ts`, `mailbox-viewer, mailbox-names,
  inbox-thread-guard, comms-owner-stamp, comms-attachments, mail-attachments(-server),
  thread-pdf-read, email-signature, reply-all, quote-email, recording-deep-link, attachment-limits`,
  `vendor-quotes/{thread-attachment-server,threads-server}.ts`,
  `part-docs/{drive-photo-plan,drive-photo-sync,drive-photo-view}.ts`, `booth/followup-server.ts`.
- Components: `src/components/{ask,assist,meetings,recordings}/`,
  `vendors/{project-vendors-card,filing-target-search}.tsx`.
- Seeds / boot: `src/db/seeds/comms.ts`, `src/instrumentation.ts` (it only started the Gmail timer).
- Scripts: `comms-stamp-owners, test-inbox-org, test-ask, test-thread-visibility, test-assist,
  test-meetings-323, test-suggest, test-quote-email-regression, test-portal-invite`, with their
  `package.json` entries.

### Later-stage files deleted early

Stage 3 (Flame / Inspections / Assessments / Portal):

- `src/app/portal/meetings/page.tsx` (and its nav item) — it read Krisp meetings.
- `src/lib/portal-invite.ts`, `scripts/test-portal-invite.ts` — the invite went out through the Gmail
  bridge.

Stage 4 (Design):

- `src/lib/consulting-files-server.ts`, `src/app/api/engagement-files/` (upload + download routes) —
  engagement files lived in Google Drive, and their only screen (the Activity tab) went in stage 1.
  The pure `src/lib/consulting-files.ts` stays.

Later-stage files cut minimally (still present): `flame-tests/{page,actions,results/page}.tsx`,
`inspections/{page,actions}.ts(x)`, `inspections/[id]/{page,controls}.tsx`,
`venue-assessments/{page,[id]/page,[id]/controls}.tsx`, `assessments/[id]/report/{page,toolbar}.tsx`,
`design/engagements/[id]/page.tsx`, `src/lib/renewal-outreach.ts`, `src/app/portal/nav.ts`,
`companies/[id]/portal-access.tsx`.

### New small modules (helpers moved out of deleted directories)

- `src/lib/crypto/token.ts` — `gmail/crypto.ts`, **moved unchanged** (same AES-256-GCM format, same
  `AUTH_SECRET` key). Used by the MyETC key store, the native sign-in hand-off, portal grants and the
  (unused) Krisp / Google connection rows. No stored secret was touched.
- `src/lib/identity/placeholder.ts` — `inbox-org/placeholder.ts`, unchanged.
- `src/lib/search/link-targets.ts` — `inbox-link-targets.ts`, unchanged; its action
  `searchLinkTargetsAction` now lives in `src/app/(app)/companies/link-target-actions.ts`.
- `src/app/(app)/people/quick-add-actions.ts` — `quickAddContactAction` (vendor Contacts tab),
  without the thread re-sweep.
- `src/lib/quote-pdf/file-names.ts` — `isCoverFileName`, `isBidderFileName`, `bidderFileOf`,
  `ESTIMATE_EMAIL_ATTACH_MAX` (the 15 MB ceiling the PDF appendix merge keeps under; the name is
  historical). `src/lib/quote-pdf/request-where.ts` — `requestWhere`.
- `src/lib/estimate-steps/send-layout.ts` — `SEND_STEP_IDS`, `SendCard`, `sendStepLayout` (a draft
  leads with Status; no composer / activity cards).
- `src/lib/vendor-quotes/panel-server.ts` — `loadVendorCompanies` (the Vendors card's server half).
- `src/lib/lead-for-create.ts` — `leadIdForCreate` (a quote opened from a lead still stamps `leadId`
  on create).
- `scripts/ok-type.ts` — the `Ok` check-callback type every standalone test script imported from the
  deleted `test-inbox-org.ts`.

### Wiring

- Nav / Home: the Home "Inbox" tab, the Inbox nav badge and pop-out, the Home Inbox widget (registry,
  preset, legacy layout keys `inbox` / `calendar` / `queue`), the "meetings to file" link, the Krisp
  triggers on Home, and the Ask AI row / phone button / drawer row are gone.
- Bell: "Customers waiting on a reply" (`comms`) removed, with its Account switch.
- Pop-outs: kinds are `estimate` and `customer`; the `thread` / `inbox` kinds, `threadPopUrl`, the
  `thread` / `inbox` broadcast entities and the legacy `inbox-changed` mapping are gone.
- Settings: the Integrations group is removed (`?section=integrations` now lands on Company);
  Data & Tools lost the Recordings pilot and Assist pilot cards; Team add / rename no longer stamp
  mailbox names. Account: signature, mailbox connect, Inbox organization and Krisp cards removed.
- Cron: `vercel.json` has one job, `/api/drive/sync` (venue address stamp + ETC daily price sync).
  `/api/gmail/sync` is deleted. Middleware no longer exempts `api/gmail/sync` or
  `api/recordings/upload`.
- Offline sync: `recordings` removed from `SYNCABLE_COLLECTIONS` and `FIELD_COLLECTIONS` together.
- Go-live wipe: `comms`, `meetings`, `recordings` joined `assist_runs` on the keep-list
  (`CONFIG_COLLECTIONS`) so "Clear demo data" never empties tables of removed features. Their
  `DOC_TABLES` registrations are untouched.
- Settings type / defaults: `recordingsArchive*`, `recordingsBetaUsers`, `catalogPhotosMailbox`,
  `assistUsers`, `assistFeatures`, `assistMonthlyCapUsd` and `canRecord` removed from
  `src/lib/settings.ts` and the seed defaults. Stored values stay.
- `.env.example`: Gmail, Assist and Inbox-organization variables removed; `CRON_SECRET` kept and
  re-described. `DEPLOY.md` §5–§6 replaced by clean-up notes.
- npm: removed `@anthropic-ai/sdk`, `@capacitor/local-notifications`,
  `@capgo/capacitor-audio-recorder`, `@capawesome-team/capacitor-android-foreground-service`
  (`npm install --package-lock-only`; nothing else changed). The two generated native plugin lists
  (`ios/App/CapApp-SPM/Package.swift`, `android/{capacitor.settings.gradle,app/capacitor.build.gradle}`)
  had the recorder / foreground-service lines removed by hand, as `npx cap sync` would.

### The vendor price-list check (map risk R2)

Nothing was left to move. Stage 1 already removed the only daily work (`ensureVendorAssignments`,
which created queue assignments). The price-list status itself (`vendorStatus` in
`src/lib/vendor-status.ts`: no list / no claims / newer list / outdated / current) is computed when a
vendor or catalog page renders and is still shown there; it stores nothing and needs no cron.

### "Mark sent" (map risk R8) — trace

`Send to customer →` → `nsSendAction` → `sendQuoteToCustomer` → `setStatus(id, "sent")`; the status
select → `setQuoteStatus` → the same `setStatus`. The removed email send called exactly this
`sendQuoteToCustomer` first, then minted the link, attached the PDF and recorded the email.

| What an emailed send did | Manual path |
| --- | --- |
| status → sent, pipeline stage follows | same `setStatus` |
| sent revision cut (spec + printed header frozen, by / at) | same; there is no separate `sentAt` field — the sent revision's `at` is the sent time |
| PDF on the revision | same: copied when current, else a render is scheduled and settles onto it |
| approval gate, version check | same (`checkApprovalGate`, `expectUpdatedAt`) |
| client link | Copy client link (`ensureShareLink`), refused on a draft, as before |
| bidder revision stamp | "Mark submitted" (`markSubmitted` → `revSent = current sent revision`), now on every pending bidder |
| box sale with labor refused | **was missing — added** (`boxSaleSendProblem` in `sendQuoteToCustomer` and the status action) |
| stored per-bidder PDF copy | not stored; Download PDF and the portal render the bidder PDF on demand, as they already could |
| follow-up task | already gone (stage 1) |
| email / thread record (`estimateEmails`) | gone with the Inbox |

Test: `scripts/test-mark-sent.ts` (`npm run test:mark-sent`, 23 checks) — the approval gate still
applies, one sent revision with who / when and the frozen spec and header, no double send, the status
select does the same, the client link is refused on a draft and minted after, Mark submitted stamps
an email bidder with the sent revision and again after a revise + re-send, a box sale with labor
stays a draft.

One thing not changed: "Mark submitted" on an estimate that was never marked sent stamps the
current revision number without a frozen revision behind it (as it always did for bid-website
rows). Mark the estimate sent first.

### Judgement calls

1. Stored keys of removed features on a quote (`estimateEmails`, `emailSending`, `assistDraft`,
   `assistNudge`, `assistNudgeLeaseUntil`) stay typed as `unknown` and `update()` still drops them
   from incoming saves, so an old browser tab cannot write them back. Their writers are deleted.
2. `fromThreadId` on a stored vendor quote is still kept by the save when well-formed; nothing
   writes a new one and nothing links to it.
3. The catalog rename engine still rewrites SKUs inside the stored `drive_photo_sync` blob (the
   step and its tests are unchanged; the blob id is now a local constant).
4. Pop-out tests were ported from the removed `thread` kind to `estimate` / `customer` rather than
   cut, and the #43 layout tests from the `inbox` widget id to `my-leads`.
5. The addendum note now reads "…Mark it sent again when it's ready, then mark each bidder's new
   revision submitted." An addendum on a sent estimate still moves it back to Draft (map risk R9).
6. `src/lib/parties/bid-send.ts` lost the email-only helpers and copy (`bidderEmailNeed`,
   `bidderSendPlan`, `bidderSubject`, the addenda-since-send helpers, the walk summary). The Bidders
   view model lost `sendLabel`, `failedText`, `failedUnknown`, `noEmail`, `revisedSubject`, `plan`,
   `canSend`, `addendaAfterSend`.
7. The legacy "Dashboard defaults" keys `calendar`, `queue` and `inbox` were removed from
   `DASHBOARD_WIDGETS` (stage 1 had left the first two); a stored layout naming them is ignored.

### Tests

**Found and fixed: stage 1 had switched off most of the main harness.** `scripts/test-review-and-spec.ts`
ends in one promise chain (`seeded().then(suiteA).then(suiteB)… .finally(teardownFixtures)` and the
exit code). Stage 1's compiler-driven prune cut that whole statement, because it named suites that
were deleted. From then on only the top-level assertions ran: none of the ~330 remaining async
suites (bids, vendors, parties, booth, assessments, portal, specs, pricing, the DB-backed checks),
fixtures were never torn down, and the script exited 0 whatever failed. Stage 1's "10,674 PASS"
was that reduced run. Stage 2 restored the chain (same order, suites of deleted features left out,
each suite wrapped so one that throws is reported as a failure and the rest still run) and triaged
what it surfaced: 32 suites that only covered removed features were deleted (Daylite, Rewards,
tasks, repairs / rentals, Krisp recordings and archive, the estimate email send / track, Drive
photos), about 45 assertions that pinned stage-1 removals (won-quote spawns, "Install sold"
assignments, project pipelines, the perks line) were cut, and a handful were updated to the new
behaviour (the client-response notify no longer creates a task; the daily cron route pin).

Otherwise the same method as stage 1 (compiler-driven prune, then one suite at a time on a
throwaway `PGLITE_PATH`). Every removed, ported or restored statement is listed in
`docs/removal-stage2-pruned-tests.txt` (about 2,900 entries). `test-review-and-spec.ts` went from
66,841 to about 62,100 lines; `test-vendors.ts` from 1,267 to about 200 (it was mostly Read the PDF
and the email hand-off).

Result on 2026-11-20: `test-review-and-spec.ts` 19,764 PASS / 0 FAIL, `ALL PASSED`, exit 0; every other `scripts/test-*.ts` exits 0
(30 scripts, each run alone). New: `scripts/test-mark-sent.ts` (23 checks).

Lessons for stages 3–4:

- **After pruning the harness, check that the suite chain at the end of the file is still there**
  and that the run prints `ALL PASSED`. Drop deleted suites from the chain by name; never let the
  prune take the statement.
- Re-run `tsc` before every prune pass. A prune against a stale error file cut live code once here
  (all scripts were restored from `HEAD` and redone).
- The runtime cut tool has two traps: its crash-cut can remove a whole suite's entry call, and a
  failing message that starts like a template-literal message (`` `parties db: ${role} …` ``) makes
  it cut those too. Both happened here and were put back; check that "cut N" equals "matched N".
- The prune cuts a statement whose example value is a removed kind (`"thread"`, the `inbox` widget).
  Where the statement tested a kept feature it was ported instead: pop-outs (now `estimate` /
  `customer`), saved layouts (`my-leads`), portal nav indexes, the Settings groups, box-sale and
  discard-confirm source pins, and the portal bidder tests (a delivered revision is now stamped the
  way Mark submitted does it).

Where one assertion mixed a kept check with a removed one and could not be split cheaply, the whole
assertion went. Known cases worth re-adding in a shorter form: `#P3 send UI` (the Send step card
order — `test-mark-sent.ts` now pins the layout), bidder DB checks that walked an email send before
asserting on the row, the vendor "hand-off" pins around the vendor quote modal, and the
`pipelines-server` save checks (an invalid pipeline refused, the saved label read back) — they
exercised the project pipeline, whose input stage 1 had pruned to `{}`; a quote-pipeline version
would be worth having.

### Loose ends

- Unused code left in later-stage files: `flameLetterDoc` / `inspectionLetterDoc` and their helpers
  in `src/lib/renewal-outreach.ts` (they built the emailed renewal PDF), the renewal email
  templates in `src/lib/templates.ts`, `followUpCopy` in `src/lib/booth/capture.ts`.
- Unused but harmless in kept code: `bidderSentState` / `bidderFailedState` in
  `src/lib/parties/bids.ts`, the `track` input of the Estimator readiness badges,
  `mergeSettingsObject` in `src/lib/settings.ts` (its last caller was the Assist switches; its race
  test still runs), `DocCond` `where` on `searchDocs`.
- `ESTIMATE_EMAIL_ATTACH_MAX` keeps its name. Whether the 14 MB finished-PDF cap still matters with
  nothing emailed is Jeff's call.
- `@capacitor/filesystem` and `@capacitor/preferences` are no longer imported by `src/` (only the
  recorder used them) but are still in `package.json` and the native plugin lists. Remove them with
  the next `npx cap sync`.
- Native apps: rebuild both after `npx cap sync`; the microphone / notification permission strings
  can go, and a shipped build still schedules the two brief notifications (ids 64501 / 64502) until
  a new build cancels them.
- Secrets still at rest, unused: `gmail_connections` (OAuth refresh tokens), `krisp_connections`
  (API keys), the `assist_secrets` blob (Anthropic key). Revoke them at the source (map risk R6).
- `fileRefHref` in `src/lib/consulting-files.ts` (stage 4) still builds `/api/engagement-files/…` links; the
  routes are gone and no screen calls it.
- Portal "Resend link" now only answers with the copy-it note; the bidder portal rule still reads
  `revSent` as "delivered". Both go with stage 3.
- `AGENTS.md` got a short stage-2 note at the top of the phase list; phases 7, 8, 26 (Drive half),
  42 (Phase 3), 46, 53–58, 60, 63 still describe removed code. `MASTER-HOWTO.md` and `docs/specs/*`
  are untouched.

## Stage 3 — done 2026-11-20

Scope: Flame Tests (dashboard, scheduler, results, today sheet, quote builder, letter, report,
renewals), Rigging Inspections (inbox, capture editor, report, quote builder, pricing, renewals,
issue library), Venue Assessments / Field Survey (`FS-####`, the capture editor, ink / sketch pads,
field files, survey travel, the field-sheet PDF, `/api/surveys/*`, site visits and their request
queue), the Assessments engine (`AS-####`, findings register, venue profiles, pick lists,
`/assessments`, `/print/assessment*`, the photo queue), the customer portal (everything under
`/portal`, grants and sign-in links, carts, the portal catalog and departments, portal service
quotes and pricing, the staff Portal quotes queue, the Portal panel, bell groups, the bidder / owner
rules, document sharing) and the service engines and shared pieces that then had no caller. There
was no removal map for this stage; the scope came from the hand-off specs
(`docs/handoff/client-portal-spec.md`, `flame-inspections-spec.md`, `venue-assessments-spec.md`)
and from the import graph.

State at hand-off: `tsc --noEmit` 0 errors; `eslint src --quiet` 0 errors; every `scripts/test-*.ts`
exits 0 (figures under Tests). Nothing committed by the stage-3 agent. No table, migration or
`src/db/schema.ts` change; no data script. `npm run build` was NOT run, and the dev server was never
started — nothing here was looked at in a browser.

### Rules that changed

- **Old flame-test and inspection quotes are rows only.** Same treatment stage 1 gave repair and
  rental quotes: `quoteBuilderHref` sends all four types to their Quotes-hub row (`/quotes?id=`),
  the hub hides the "Open … quote" button (`hasNoBuilder` in `src/lib/quote-links.ts`), and they no
  longer get a saved PDF (`pdfKindForQuoteType` is `"quote"` for system estimates, else null). Status
  moves, history, value and the estimate number (`FLM-` / `RIG-`) still read. "+ New quote" and the
  guided intake no longer offer them; the hub's type filter chips for them are gone (`?type=` still
  filters).
- **A quote the portal created is an ordinary quote.** Its stored `source` (`portal-catalog`,
  `portal-service`) is kept on save, it opens and lists like any other, and nothing portal-specific
  is offered: no Portal panel, no Approve / Decline of an acceptance, no "Portal" chip. Three stored
  facts are still honoured so an old one reads the same: a price-on-request line prints "Price on
  request" until it is priced (the save then clears `por`), its "Valid until" / review / tax lines
  still print, and its prices are not rounded to $25 on load. The hub's "Accepted" chip (a customer
  accepted it in the portal; mark it Won to confirm) stays, as does the "accepted in portal" row in
  a company's activity feed.
- **Leads convert without a site survey.** The convert gate (a completed linked survey, or "Skip
  survey") is gone with surveys; Convert lead just converts. "Request site visit" and the visit /
  survey chips are gone from the lead drawer, and marking a lead lost no longer closes a visit.
- **Client goals is a plain field.** The Estimator's "From site visit ▾" menu and the automatic
  pre-fill from `?surveyId=` are gone; the per-system Client goals box and the Discipline select are
  unchanged. "Draft from survey/inspection" (More ▾) is gone.
- **The customer estimate no longer mentions a portal.** The Acceptance block on every estimate PDF
  read "To proceed, sign and return this quote — or accept it online through your <company>
  customer portal." It now reads "To proceed, sign and return this quote." Four stored document
  baselines were edited for exactly that sentence (see Tests).
- **Offline sync carries booth captures only.** `SYNCABLE_COLLECTIONS` and the device's
  `FIELD_COLLECTIONS` are both `["booth_captures"]`. "Download today's jobs" (the chip button and
  `/api/sync/today`) is gone — every job it listed was a removed record.
- **The bell** lost "Survey requests to schedule", "Site visit requests", "Inspections to
  schedule", "Flame tests due for renewal", the three portal groups and "New documents from
  customers", with their Account switches. It now holds approvals, back-from-review and lead
  follow-ups.
- **Documents are team files.** The Internal / Shared choice, the visibility filter and the Shared
  chip are gone from the Documents card; every new upload is stored `internal` / `team`. A file a
  customer once uploaded keeps its "From customer" chip (and "New" until someone downloads it or
  presses Mark seen).
- **Catalog.** The part editor's Customer visibility select (Auto / Show / Hide) and its reason
  line are gone, as is the assembly form's Portal category box and Catalog → Departments. Stored
  `portalVisibility` and `portalCategory` values are left alone: the part form no longer posts the
  key (so `mergeUpsert` keeps it) and the assembly draft still round-trips its stored category.
- **Estimating Rules** lost the Flame-test pricing and Inspection pricing groups, the seven
  flights-over-drive rates, the four portal rates and the Venue class doctrine editor. "Portal &
  freight" is now "Freight" (same group key and rate ids). "Reset all" no longer writes the flame /
  repair / inspection rate blobs, and the one-time margin → markup conversion no longer touches
  them.
- **Settings.** Field & Venues holds only Venue types (the site-intake type catalog, the site-visit
  reasons and the Final thoughts tags are gone). Review limits shows System and Consulting columns
  only; limits stored for flame / repair / inspection / rental quotes round-trip through a save
  untouched and still apply to an old quote of that kind.

### Deleted (309 files: 307 under `src/`, 2 test scripts)

- Screens / routes: `src/app/(app)/{flame-tests,inspections,venue-assessments,assessments}/`,
  `src/app/portal/`, `src/app/(app)/quotes/portal/`, `src/app/(app)/catalog/departments/`,
  `src/app/print/{letter,assessment,assessment-findings}/`,
  `src/app/api/{assessments,surveys,venue-assessments}/`, `src/app/api/sync/today/`,
  `home-venue-assessments.tsx`, `quote-builder-travel.ts`, `_letters/util.tsx`,
  `companies/[id]/portal-access.tsx`, `companies/delete-visit-button.tsx`,
  `settings/survey-tags-card.tsx`, and in the Estimator `portal-panel.tsx`, `ai-scope-modal.tsx`,
  `output-actions.ts`.
- Libraries: `src/lib/{assessments,ink,field-files}/`, every `src/lib/portal*.ts` (27 files), every
  `src/lib/survey-*.ts`, `flametest-engine, inspection-engine, renewal-outreach, service-pricing,
  service-quote-inputs, travel-plan, trip-travel, tier-seed, field-lists, lead-thread,
  venue-doctrine, venue-3d-views, venue-assessment-certs, venue-assessment-sheet,
  visit-edit-rights, visit-fields`, the stores `assessment, assessments, assessment-rows,
  assessment-picklists, findings, venue-profiles, flame-jobs, inspections, surveys, survey-intake,
  linesets, site-visits, venue-classes, portal-carts, portal-departments`,
  `parties/{portal-bid,portal-bid-server,portal-owner-bom}.ts`, `quote-pdf/portal-access.ts`,
  `estimate-output/{goals,survey-goals-server}.ts`, `address-verify/targets.ts`,
  `sync/today-jobs.ts`.
- Components: `src/components/{assessments,ink}/`, `letter/{SinglePageLetter,FitOnePage}.tsx`
  (`letter/print-button.tsx` stays — Design and cut sheets use it), `section-rail/`,
  `sync/download-today.tsx`, `quote-pdf/saved-pdf-button.tsx`, `address-fix/address-flag.tsx`,
  `service-total-field.tsx`, `travel-mode-panel.tsx`, `lift-rental-panel.tsx`,
  `tier-seed-prompt.tsx`, `venue-availability-check.tsx`.
- Seeds: `src/db/seeds/{flame-jobs,inspections,surveys}.ts`.
- Assets: the two extra copies of `peak-letterhead.jpg` under the flame-test and inspection letter
  routes. The baked letterhead is now read from `src/app/(app)/estimator/peak-letterhead.jpg` (the
  same bytes; `src/lib/letterhead-path.ts` and `next.config.ts` follow).
- Scripts: `test-assessments.ts`, `test-va-notes.ts` (neither had a `package.json` entry; both ran
  inside the harness chain).

### Later-stage files touched

Stage 4 (Design), cut minimally and still present:

- `design/engagements/data.ts` — the Oversight tab's site-visit list is always empty.
- `design/engagements/actions.ts` — `linkVisitAction` answers "Site visits are no longer part of
  this app." (the view still imports it).
- `design/engagements/letter/page.tsx` — imports the letterhead from the Estimator.
- `design/assemblies/{page,fixture-builder,fixture-form}.tsx` — the Portal category box only;
  `design/assemblies/actions.ts` — one call that dropped the portal catalog cache.
- `src/lib/design/grid-virtual-parts.ts`, `src/lib/rack/part-facts.ts` — import path of
  `isInternalCategory` only.

Nothing of stage 4 was deleted early.

### New small modules (helpers moved out of deleted files)

- `src/lib/price-rounding.ts` — from `service-pricing.ts`: `PRICE_STEP`, `PRICE_OVERRIDE_MAX`,
  `LOW_MARKUP_WARN`, `roundToStep`, `ceilToStep`, `normalizePriceOverride`, `fmtDollars`, `fmtPct`,
  `typedPriceWarning`, `PriceWarning`. Unchanged code; the Estimator's system price and the review
  limits use it. The flame / inspection / repair finish functions, the lift rental and the travel
  line split were not kept.
- `src/lib/portal-legacy.ts` — `sourceForSave`, `clearPricedPor` (what a stored portal quote still
  needs from an Estimator save).
- `src/lib/card-number.ts` — `looksLikeCardNumber` (the client-response PO guard).
- `src/lib/catalog-internal.ts` — `isInternalCategory`, the stored `PortalVisibility` type.
- `src/lib/curtain-request.ts` — the `CurtainRequest` type (`SpecItem.curtainInputs`).
- `src/lib/text-caps.ts` — `capGraphemes`, `INVISIBLE_STRIP` (assembly names).
- `src/lib/csv.ts` — `csvCell`, `toCsv` (the sourcing report's formula-safe CSV).
- `src/lib/photo-resize.ts` — the device photo shrink (Booth mode's card photo), with its own
  `PHOTO_CAPS`.
- `src/lib/identity/short-code.ts` — `CODE_RE` (the `short_code` columns on companies and venues
  stay and stay validated; nothing prints a code any more).
- `hasNoBuilder` in `src/lib/quote-links.ts`; `REVIEW_KINDS_SHOWN` in `src/lib/review-limits.ts`.
- `scripts/test-moved-helpers.ts` — the deleted suites' checks for the moved helpers, plus pins on
  this stage's wiring (see Tests).

### Wiring

- Nav: the "Service" group (Flame Tests, Rigging Inspections) is gone; Estimating lost Portal
  quotes; Customers lost Venue Assessments and Assessments. Top level is Home · Estimating ·
  Customers · Design · Knowledge.
- Home: the Venue assessments widget is gone (registry, preset, the legacy `surveys` layout key).
  A saved layout naming it is skipped.
- ⌘K: no Surveys, Inspections, Assessments or Findings groups.
- Company page: the Site surveys, Assessments, Findings, Portal access and Site visits cards and the
  "Portal activity" line are gone. Venue page: the Venue profile, Assessments and Findings cards are
  gone. Activity feeds and venue history list notes, quotes and consulting engagements. The venues
  directory's "last activity" comes from quotes and engagements.
- Settings → Data → Addresses to verify lists venues and leads (no Visits chip). The booking-form
  address check (`addressStatusAction`) is gone.
- Import / Export: `flametests`, `inspections`, `surveys` types removed. The quotes import still
  accepts `flame_test` / `inspection` as a type for history rows.
- Templates: only the consulting proposal and consulting specification remain (the flame,
  inspection, repair, renewal-email, service-completion and warranty templates are gone; overrides
  stored for them stay in the settings row).
- Middleware: `portal` is no longer exempt from the team session, so `/portal/...` now redirects to
  sign-in and then 404s. `print/`, `share/`, `d/ds/`, `c/`, `placeholders/`, the booth and lead
  intake APIs and the cron stay public as before.
- `next.config.ts`: the Chromium trace entries for `/flame-tests*`, `/inspections*`, `/repairs/quote`
  and `/portal/estimate`, the `/portal/catalog/doc/:id` frame header and the `/field-survey` →
  `/venue-assessments` redirects are removed.
- Offline sync: see above. `src/app/api/sync/push` lost its assessment / finding / survey branches;
  the generic whole-document branch stays as the seam but no collection reaches it (booth captures
  have their own path).
- Go-live wipe: `surveys`, `site_visits`, `flame_jobs`, `inspections`, `assessments`, `findings`,
  `venue_profiles`, `portal_carts` joined the keep-list (`CONFIG_COLLECTIONS`). **Stage 1's
  collections were added too** (`projects`, `repair_jobs`, `assignments`, `tasks`,
  `task_templates`, `equipment_*`, `reward_ledger`, `triage_*`) — stage 1 had left them wipeable.
  Every `DOC_TABLES` registration is untouched.
- Settings type: `intakeCatalog`, `visitReasons`, `surveyInternalTags`, `venueDoctrine` are typed
  `unknown` (stored values stay, nothing reads them). Rates: `FlametestRates`, `RepairRates`,
  `InspectionRates`, their defaults, getters and setters, the fly rates and `PORTAL_RATE_IDS` are
  gone; `TravelRates` is `{ roadFactor, mph }`.
- `vercel.json`, `.env.example`, `DEPLOY.md`: nothing in them belonged to this stage (checked).
  npm dependencies: none became unused.

### Judgement calls

1. **`"engine-owned-flow"` stays on `setStatus`.** It was the service builders' approval-gate
   bypass and no app code passes it now, but 55 places in five kept test scripts move their fixture
   quotes to sent / won with it. Removing it cut those tests; it was put back and documented as
   test-only.
   The portal's `"portal-firm"` bypass is removed.
2. **Stored portal quotes keep printing as they did** (price on request, Valid until, the two
   standing lines) rather than being normalised — `portalDocumentExtras` and `isPortalCatalog` stay
   in the document code. Only the acceptance sentence changed, for every estimate.
3. **The Scope-only stamp is dead but stored.** `Quote.bidScopeOnly` (the owner's portal showed a
   bid estimate without prices) is no longer written by `addBidder`, party revives or Move / Copy →
   New estimate, and the staff "Owner portal: Scope only" chip and note are gone. `update()` still
   drops it from incoming saves.
4. **Portal grants are not revoked.** The `portal_grants` rows and their encrypted link secrets stay
   as stored; with `/portal` gone nothing accepts them. The grant actions were deleted.
5. **Lead intake and Booth mode still offer "Flame testing" and "Inspections" as interests.** Peak
   still does that work; only the screens moved out of this app.
6. **Review limits**: the retired kinds are hidden, not deleted (see Rules).
7. **The catalog rename engine still rewrites SKUs inside stored `portal_carts`** (the stage-1 /
   stage-2 precedent for `projects` and `drive_photo_sync`).
8. **`/quotes/new?replaces=<old flame or inspection draft>`** treats the old quote as a system
   quote (the type is no longer on the intake); nothing links there for those types any more.
9. **Venue calendars stay** on the venue page (feed URL, CSV import, manual windows). The
   "is this time open?" check the schedulers called is gone from the actions; its pure helpers in
   `src/lib/venue-availability.ts` are unused but tested.

### Tests

Method as in stages 1–2, with the tooling rebuilt (it was not in the repo): a compiler-driven prune
through the TypeScript language service (imports of deleted modules, then every statement that no
longer compiles, repeated until clean), a dead-path pass (a string naming a deleted repo file),
then each script run alone on a throwaway `PGLITE_PATH` and the failures triaged by hand. Every
change is listed in `docs/removal-stage3-pruned-tests.txt`.

Result on 2026-11-20: `test-review-and-spec.ts` 15,579 PASS / 0 FAIL, `ALL PASSED`, exit 0 (stage 2:
19,764 — the difference is the removed features' assertions); every other `scripts/test-*.ts`
exits 0, each run alone. The suite chain at the end of the harness was compared before and after:
299 → 294 entries, the six removed being `assessmentChecks`, `assessmentDbChecks`, `vaNotesChecks`,
`vaNotesDbChecks`, `portalBidPureChecks`, `portalBidDbChecks`, the one added being
`movedHelperChecks`. The harness went from 62,145 to about 57,500 lines; `test-bids.ts` from 2,049
to 1,184 (the portal bidder rule and the owner's Scope-only BOM).

What was ported rather than cut:

- Imports of the nine moved helpers were re-pointed (`remap`), so the `#217` rounding checks, the
  `#245` / `#248` / `#250` `clearPricedPor` / `sourceForSave` checks, the `looksLikeCardNumber` and
  `isInternalCategory` checks all still run.
- `scripts/test-moved-helpers.ts` (new, 37 checks, in the chain as `movedHelperChecks`): the csv,
  photo-resize and short-code checks from the deleted `test-assessments.ts`, plus pins for this
  stage — old service quote types open the hub row and have no PDF, review-limit kinds, the sync
  lists, the go-live keep-list, the nav and the middleware matcher.
- Assertions that used a removed type as their example were moved to a kept one: the intake
  (`flame_test` → `consulting`), the print token "another kind" (`flame` → `cover`),
  `printPathFor`, `boxSwitchHint`, the nav shape checks, the go-live reset checks, the
  markup-settings conversion (now on the `pricing_rules` blob, with a new check that the service
  rate blobs are left as stored).

Stored baselines edited: `docs/superpowers/fixtures/293-quote-document-baseline.json`,
`364-bom-view-baseline.json`, `p2b-quote-document-no-alternates.json`,
`p5-quote-document-no-document.json` — in each, only the text
" — or accept it online through your Peak Systems Group customer portal" was removed from the
acceptance sentence (28 occurrences in all). The byte-for-byte document checks pass against them.

What this does not prove: the standalone scripts run only their pure halves when run alone; the
database halves run inside the harness. `scripts/smoke-routes.ts` had 56 routes of removed screens
taken out and was type-checked, but it needs a running dev server and was not run. No removed
feature's own behaviour is tested any more.

Lessons for stage 4:

- **Do not remove a "dead" option that tests use as a seam** without grepping `scripts/` first
  (`engine-owned-flow`). The compile prune turns one removed union member into dozens of silently
  cut kept-feature tests. After each prune, read the log for cuts whose text does not name a
  removed feature.
- The compile prune needs four companions, all used here: a **remap** pass for helpers that moved
  (before pruning), a **dead-path** pass, a **dead-dir** pass for loops like
  `for (const svc of ["flame-tests", "inspections"])` whose paths are built from a template (the
  dead-path pass cannot see them and they crash at the top level), and a **crash cut** for what is
  left. Top-level statements are not inside `runSuite`, so one bad read kills the run before any
  suite starts — loop: run, cut the outermost script frame, re-run.
- Keep "it is gone" checks: the dead-path pass must skip `!has("…")`, `existsSync` and reads inside
  `try { } catch { gone = true }` (the last one was emptied here and restored by hand).
- A dead-path string inside an array of live paths should lose only its element.
- `git stash` is not a safe way to compare against HEAD in this tree (staged deletions come back
  unstaged, and a failed `&&` chain can run the pop without the push). Use
  `git show HEAD:<path>` / `git archive HEAD`.
- An orphan check over the import graph (files unreachable from any route or script) found the
  second ring of deletions quickly; a word-count check for exports named in only one place found
  most of the third. Neither sees a pair of dead functions that reference each other.

### Loose ends

- **Before this ships, every phone or tablet must have synced.** After the deploy the push endpoint
  ignores surveys, inspections, flame jobs, assessments and findings, so anything still waiting in
  a device's outbox for those is never stored. Rebuild both native apps with the release (the
  client's `FIELD_COLLECTIONS` changed), as after stages 1 and 2.
- `public/sw.js` keeps its cache name (`quartzite-shell-v2`); a device that visited a removed
  screen can still show the cached copy while offline until the cache name is next bumped.
- Files in Blob stay: `surveys/…`, `assessments/…` photos, portal-era quote PDFs, customer uploads
  under `documents/…`. Nothing lists or serves the first two any more.
- `portal_grants` (with encrypted sign-in secrets) and `portal_carts` rows stay, unused.
- Hollow test suites: some harness suites for portal-era work (#245, #248, #288, #289 and others)
  keep their fixture setup with most assertions gone. They pass and can be deleted whole.
- Unused but harmless in kept code: `checkAvailability` / `windowsBetween` in
  `src/lib/venue-availability.ts` and `refreshIfStale` in the venue-calendar store,
  `venueAddressState` in `address-verify/state.ts`, the `visit` member of `VerifyKind`, the
  `flame` / `inspection` / `repair` / `survey` / `visit` kinds in `src/lib/venue-match.ts`,
  `ONLINE_COPY.portalUnavailable`, `roundToStep`, `revisionAwaitingPdf`, the service-credit helpers
  in `src/lib/credit-line.ts` (they still net a stored credit on an old service quote), the
  `flameTest` / `inspection` / `portal*` / `renewalOf` / `findingKeys` fields on the `Quote` type,
  the `contact-us` and `coming-soon` placeholder images.
- `src/lib/stores/pricing.ts` keeps the group key `portal` for the Freight group (a saved
  Estimating Rules view preference names it).
- `src/middleware.ts` still uses the `middleware` file name, which this Next version's docs mark as
  renamed to `proxy`. Not touched here.
- `AGENTS.md` got a short stage-3 note; phases 4, 5 (Field Survey), 6 (the capture editors), 15,
  19, 20, 22, 23, 28, 30, 59, 61 and the portal slice of 62 still describe removed code.
  `README.md`, `MASTER-HOWTO.md` and `docs/specs/*` are untouched.
