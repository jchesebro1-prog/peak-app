# Removal map — Project Management

Status: written 2026-11-19 from the code in this repository. Companion to
`project-management-spec.md`. It is a guide for the developer who will delete the Project
Management code from this app. No application code was changed to produce it.

How to read this document

- "Removed" means the Project Management scope in the spec: install Projects, Schedule, Field
  Work, Repairs, Rentals, consulting scheduling and task templates, Tasks and My Queue, the auto
  task calendar, site-visit scheduling, drive time, `/calendar`, and Morning triage.
- "Kept" means: CRM (leads, opportunities, companies, people, venues, vendors, rewards), the
  Estimator and Quotes hub, Catalog, Estimating Rules, Venue Assessments (`/venue-assessments`),
  the Assessments engine (`/assessments`), Settings, Reports, and shared infrastructure.
- "Going separately" means features being removed by other work items: Inbox and Gmail, Krisp
  meetings and recordings, the Design tab (including consulting engagements), Flame Tests,
  Inspections, the customer Portal, AI and Assist. Their references into the removed code are
  counted in section B.4 but not itemised.
- Line numbers were read on 2026-11-19. A "~" marks a line found by reading rather than by the
  import scan; re-check it before editing.
- Method: every `.ts` and `.tsx` file under `src/` was classified by path as removed, going
  separately, or kept. Every `import … from`, `export … from` and `import("…")` was resolved to a
  file. Section B.1 lists each one that goes from a kept file to a removed file. Route strings
  and collection names were then searched separately (sections B.2 and B.3).

Contents

- A. Files and directories
- B. References from kept code into removed code
- C. Wiring to remove (nav, cron, middleware, settings, bell, search, Home, Reports, import, scripts)
- D. Database tables and stored settings that become unused
- E. Suggested deletion order
- F. Risks and decisions needed
- G. Not verified

---

## A. Files and directories

### A.1 Delete outright

These have no kept caller once the edits in section B are made.

Screens and routes

| Path | What it is |
| --- | --- |
| `src/app/(app)/projects/` | Projects list, detail, actions |
| `src/app/(app)/schedule/` | Crew board, project timeline, by-person view |
| `src/app/(app)/field-work/` | On-site day view |
| `src/app/(app)/repairs/` | Dashboard, quote builder, scheduling, results, letter, report, completion letter, warranty record. Includes two `peak-letterhead.jpg` copies |
| `src/app/(app)/rentals/` | Hub, quote builder, agreement PDF route, booking board |
| `src/app/(app)/task-templates/` | Task template sets editor |
| `src/app/(app)/queue/` | My Queue |
| `src/app/(app)/calendar/` | Calendar and planner UI |
| `src/app/(app)/triage/` | Morning triage full list and row actions |
| `src/app/(app)/calendar-actions.ts` | Google Calendar event actions, stay-over, external calendar connections |
| `src/app/(app)/visit-booking-actions.ts` | Edit a scheduled visit (see risk R2) |
| `src/app/(app)/home-queue.tsx`, `home-calendar.tsx`, `home-today.tsx` | Home cards |
| `src/app/(app)/account/work-hours-card.tsx` | Account card |
| `src/app/(app)/settings/scheduling-defaults-card.tsx`, `drive-defaults-card.tsx` | Settings cards |
| `src/app/api/projects/` | Handoff packet PDF |
| `src/app/api/queue/` | Reminders API |
| `src/app/api/triage/` | Afternoon triage cron (it also runs daily briefs, which are going separately) |
| `src/app/api/visits/` | Booking check and conflict badges |

Libraries

| Path | What it is |
| --- | --- |
| `src/lib/stores/projects.ts` | Project store (see risks R1, R4, R6 first) |
| `src/lib/stores/repair-jobs.ts` | Repair job store (risks R4, R6) |
| `src/lib/stores/equipment-items.ts`, `equipment-locations.ts`, `equipment-bookings.ts` | Rentals |
| `src/lib/stores/task-templates.ts`, `src/lib/task-template-kinds.ts` | Task template sets |
| `src/lib/stores/task-pins.ts` | Planner pins |
| `src/lib/stores/schedule-prefs.ts` | Work hours, drive buffer, stay-over, drive-sync state |
| `src/lib/stores/tasks.ts`, `src/lib/stores/assignments.ts`, `src/lib/task-ids.ts` | Tasks and assignments (risk R3 first) |
| `src/lib/repair-engine.ts` | Repair pricing. `inspection-engine.ts` imports `tripTravel` from it (section E, step 2) |
| `src/lib/pricing/rental.ts` | Rental pricing (the only file in `src/lib/pricing/`) |
| `src/lib/project-quote-types.ts` | Quote types that never become projects |
| `src/lib/consulting-schedule.ts` | Consulting scheduling engine |
| `src/lib/engagement-activity.ts`, `engagement-activity-write.ts` | Engagement Activity tab |
| `src/lib/queue.ts`, `src/lib/queue-types.ts` | My Queue assembly |
| `src/lib/agenda.ts`, `src/lib/calendar-tasks.ts`, `src/lib/calendar-tasks-load.ts` | Calendar data |
| `src/lib/operations-work.ts`, `operations-work-server.ts` | Service work on the Schedule |
| `src/lib/service-calendar.ts` | Calendar events for scheduled service jobs |
| `src/lib/task-plan/` | Auto task calendar |
| `src/lib/visit-plan/` | Site-visit scheduling (move three small helpers out first, section B.1) |
| `src/lib/visit-invite.ts`, `visit-invite-plan.ts`, `src/lib/ics.ts` | Visit invites |
| `src/lib/drive-plan/` | Drive plan (move `day.ts` out first) |
| `src/lib/drive-sync/` | Drive events in Google Calendar |
| `src/lib/triage/` | Morning triage (move `clock.ts` helpers and `cron.ts` out first) |
| `src/lib/address-verify/triage-flags.ts` | Used only by triage |
| `src/lib/google/tasks-sync.ts`, `src/lib/google/tasks.ts` | Google Tasks mirror |
| `src/lib/sync/task-push.ts` | Offline task push rule |
| `src/lib/safe-sweep.ts` | Only removed and going-separately dashboards call it |
| `src/lib/job-value.ts` | "UKN" value helper; after the edits only removed code uses it |

Components

| Path | What it is |
| --- | --- |
| `src/components/gantt/` | Gantt grid (Schedule and the engagement Schedule tab) |
| `src/components/visit-booking/` | Booking panel, conflict chips, work-hours editor |
| `src/components/task-plan/` | Tier and size chips, block UI |
| `src/components/triage/` | Start here card and rows |
| `src/components/tasks-card.tsx`, `apply-template-control.tsx` | Tasks card (risk R3) |
| `src/components/project-value-editor.tsx` | Value editor for imported projects and repairs |

Seeds and scripts: `src/db/seeds/projects.ts`, `src/db/seeds/repair-jobs.ts`,
`src/db/seeds/equipment.ts`, `scripts/backfill-task-due.ts`, `scripts/reminders-agent.ts`,
`scripts/test-auto-calendar.ts`, `scripts/test-drive-time.ts`, `scripts/test-morning-triage.ts`,
`scripts/test-site-visits.ts`.

### A.2 Delete only when the "going separately" work has also landed

| Path | Still used by |
| --- | --- |
| `src/components/lift-rental-panel.tsx`, `travel-mode-panel.tsx`, `service-total-field.tsx` | Flame-test and inspection quote builders |
| `src/components/venue-availability-check.tsx` | Flame, inspection and Inbox scheduling dialogs. The venue calendar card on `/venues/<id>` uses `venue-calendar-actions.ts` directly and stays |
| `src/lib/google/calendar.ts`, `calendar-connections.ts`, `recurrence.ts`, `meeting-link.ts` | Meetings sync, Gmail OAuth callback, `src/lib/daylite/calendar-import.ts` (kept; see G) |
| `src/lib/templates.ts` and `src/app/(app)/templates/` | Flame and inspection letters, consulting letter. After those go, only `src/lib/settings.ts` imports it |
| `src/lib/travel-plan.ts`, `src/lib/service-quote-inputs.ts`, most of `src/lib/service-pricing.ts` | Flame and inspection engines, portal service quotes, `src/lib/stores/pricing.ts`. The kept files `src/app/(app)/estimator/pricing.ts`, `src/lib/review-limits.ts` and `src/components/rewards/service-credit-panel.tsx` also import from this group (the Estimator rounds system prices with `ceilToStep`), so a remnant stays |
| `src/app/print/letter/[kind]/[id]/` | Flame and inspection letters |

### A.3 Do NOT delete — shared files that look like they belong

| Path | Why it stays |
| --- | --- |
| `src/lib/pipelines.ts`, `src/lib/pipelines-server.ts` | Also hold the QUOTE pipelines the Estimator, Quotes hub and leads use. Remove only the project half (section B.1) |
| `src/lib/project-discounts/` | Estimator feature (project discounts on an estimate). `stores/projects.ts` was only a reader |
| `src/lib/stores/site-visits.ts` | Venue Assessments creates and schedules visits. It imports three removed modules (section B.1) |
| `src/lib/stores/quote-spawn.ts` | The won-quote router. Edit it (risk R1); delete it only when every branch is gone |
| `src/app/api/drive/sync/route.ts` | Despite the name, this daily cron also runs assessment reminders and the daily ETC price sync (risk R5) |
| `src/lib/sync/today-jobs.ts`, `src/app/api/sync/today/route.ts`, `src/components/sync/download-today.tsx` | "Download today" also serves venue assessments and assessments. Strip the project and repair inputs only |
| `src/lib/address-verify/` (except `triage-flags.ts`), `src/components/address-fix/`, `src/app/(app)/address-actions.ts`, `src/app/(app)/settings/addresses-to-verify.tsx` | Venue geocoding, the Fix dialog and Settings → Data → Addresses to verify are CRM venue features. They need small edits |
| `src/lib/stores/venue-calendars.ts`, `src/lib/venue-availability.ts`, `src/app/(app)/venue-calendar-actions.ts`, `src/lib/venue-calendar-fetch.ts` | Venue calendar card; `venue-calendar-fetch.ts` is also the shared SSRF guard for part-document fetches |
| `src/lib/stores/notes.ts` | Customer activity feed notes |
| `src/lib/estimate-number.ts` (`REP`, `RNT` prefixes) | Old repair and rental quotes still display their numbers |

---

## B. References from kept code into removed code

### B.1 Imports (107)

Each row is one import statement in a kept file that resolves to a removed file.

| Kept file:line | What it uses | Suggested fix |
| --- | --- | --- |
| `src/components/address-fix/address-flag.tsx:6` | `FLAG_TEXT` from `lib/drive-plan/plan.ts` | Inline the one string (`"Address not verified — no drive time"`) or move it to `src/lib/address-verify/types.ts`. |
| `src/components/documents/documents-card.tsx:4` | `getAllProjects` from `lib/stores/projects.ts` | Drop the project option from the Documents card's "attach to" picker (documents can stay on a company or venue). Existing project-linked documents remain readable by id. |
| `src/app/api/sync/push/route.ts:11` | `normalizeProject, type ProjectRecord` from `lib/stores/projects.ts` | Remove the `projects` branch (lines ~154–161) once `projects` leaves `SYNCABLE_COLLECTIONS`. |
| `src/app/api/sync/push/route.ts:20` | `taskPushDecision, TASK_PUSH_REFUSED` from `lib/sync/task-push.ts` | Remove the `tasks` branch (lines ~137–152) once `tasks` leaves `SYNCABLE_COLLECTIONS`. |
| `src/app/api/sync/push/route.ts:21` | `getProject` from `lib/stores/projects.ts` | Same as above; `projectExists` goes with the `tasks` branch. |
| `src/app/api/sync/today/route.ts:5` | `chicagoDayKey, chicagoDayStart, addDays` from `lib/drive-plan/day.ts` | Move `src/lib/drive-plan/day.ts` to a neutral path (for example `src/lib/chicago-day.ts`) BEFORE deleting `drive-plan/`, and repoint this import. It is a plain date helper with no drive logic. |
| `src/app/api/sync/today/route.ts:10` | `getAll as allRepairs` from `lib/stores/repair-jobs.ts` | Drop `repairs` from the loader and from the `todaysJobs` input. |
| `src/app/api/sync/today/route.ts:12` | `getAllProjects` from `lib/stores/projects.ts` | Drop `projects`, `loadPipelines`, `isDone` and the `done` set; pass `() => false`. |
| `src/app/(app)/page.tsx:10` | `StartHereCard (default)` from `components/triage/start-here-card.tsx` | Delete the import and `<StartHereCard user={user} />` (line ~145). |
| `src/app/(app)/page.tsx:84` | `syncDriveIfStale` from `lib/drive-sync/sync.ts` | Delete the `after()` block (lines ~83–86). |
| `src/app/(app)/address-actions.ts:32` | `resyncForAddress` from `lib/drive-sync/sync.ts` | Delete the `resyncForAddress` call; a fixed address no longer has a drive plan to refresh. |
| `src/app/(app)/venue-assessments/actions.ts:8` | `chicagoDayKey` from `lib/drive-plan/day.ts` | Move `src/lib/drive-plan/day.ts` to a neutral path (for example `src/lib/chicago-day.ts`) BEFORE deleting `drive-plan/`, and repoint this import. It is a plain date helper with no drive logic. |
| `src/app/(app)/venue-assessments/visit-actions.ts:7` | `canChangeVisit, VISIT_EDIT_REFUSAL` from `lib/visit-edit-rights.ts` | Move `visit-edit-rights.ts` out of the delete list (it is pure and has no removed imports) or inline the rule. |
| `src/app/(app)/venue-assessments/visit-actions.ts:8` | `validVisitSpan` from `lib/visit-plan/input.ts` | Move `validVisitSpan` (5 lines) next to the site-visits store. |
| `src/app/(app)/venue-assessments/visit-actions.ts:9` | `cleanAttendees` from `lib/visit-plan/people.ts` | Move `cleanAttendees` / `readAttendees` next to the site-visits store, or drop attendees. Decision needed (risk R2). Venue Assessments keeps visits but loses invites, conflicts and drive time: replace with a plain date/time/lead form. |
| `src/app/(app)/venue-assessments/visit-actions.ts:11` | `cancelVisitInvites, dispatchVisitInvite, type InviteStatus, type RecipientResult` from `lib/visit-invite.ts` | Delete the invite dispatch and cancel calls. Decision needed (risk R2). Venue Assessments keeps visits but loses invites, conflicts and drive time: replace with a plain date/time/lead form. |
| `src/app/(app)/venue-assessments/visit-actions.ts:68` | `resyncForVisitChange` from `lib/drive-sync/sync.ts` | Delete the `after()` drive re-sync. |
| `src/app/(app)/venue-assessments/visit-actions.ts:100` | `resyncForVisitChange` from `lib/drive-sync/sync.ts` | Delete the `after()` drive re-sync. |
| `src/app/(app)/venue-assessments/visit-requests.tsx:10` | `BookingPanel (default)` from `components/visit-booking/booking-panel.tsx` | Decision needed (risk R2). Venue Assessments keeps visits but loses invites, conflicts and drive time: replace with a plain date/time/lead form. |
| `src/app/(app)/venue-assessments/visit-requests.tsx:11` | `pickDayTimes` from `lib/visit-plan/pick-day.ts` | Goes with the booking panel (nearby-day picks). |
| `src/app/(app)/venue-assessments/page.tsx:27` | `FLAG_TEXT` from `lib/drive-plan/plan.ts` | Inline the one string (`"Address not verified — no drive time"`) or move it to `src/lib/address-verify/types.ts`. |
| `src/app/(app)/companies/page.tsx:8` | `listProjectActivityRows` from `lib/stores/projects.ts` | Drop the project rows from the directory's owner / last-activity rollup, or keep a 10-line local reader over the `projects` table. |
| `src/app/(app)/companies/[id]/page.tsx:6` | `canChangeVisit` from `lib/visit-edit-rights.ts` | Same as `visit-actions.ts:7`. |
| `src/app/(app)/companies/[id]/page.tsx:21` | `getAllProjects, riskFlags` from `lib/stores/projects.ts` | Delete the company record's Projects section and its risk chips (also the `/projects?id=` link at line ~679). |
| `src/app/(app)/companies/[id]/page.tsx:65` | `EditVisitButton` from `components/visit-booking/visit-edit-button.tsx` | Delete the Edit button on scheduled visits, or point it at the simplified form. Decision needed (risk R2). Venue Assessments keeps visits but loses invites, conflicts and drive time: replace with a plain date/time/lead form. |
| `src/app/(app)/companies/[id]/page.tsx:66` | `VisitConflictChip, VisitConflictProvider` from `components/visit-booking/visit-conflict-chips.tsx` | Delete the conflict chips and their provider (they call `GET /api/visits/conflicts`). |
| `src/app/(app)/companies/[id]/page.tsx:85` | `FLAG_TEXT` from `lib/drive-plan/plan.ts` | Inline the one string (`"Address not verified — no drive time"`) or move it to `src/lib/address-verify/types.ts`. |
| `src/app/(app)/estimator/actions.ts:10` | `readTierSize` from `lib/task-plan/fields.ts` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/estimator/actions.ts:144` | `createTask, setTaskStatus as setTaskStatusStore, updateTask as updateTaskStore, removeTask as removeTaskStore, STATUSES as TASK_STATUSES, type TaskStatus` from `lib/stores/tasks.ts` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/estimator/actions.ts:145` | `applyTaskTemplate` from `lib/stores/task-templates.ts` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/estimator/page.tsx:38` | `tasksForQuote` from `lib/stores/tasks.ts` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/estimator/page.tsx:40` | `taskTemplateSetsFor` from `lib/stores/task-templates.ts` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/estimator/types.ts:7` | `TaskRecord` from `lib/stores/tasks.ts` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/estimator/steps/send-step.tsx:8` | `TasksCard` from `components/tasks-card.tsx` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. Also remove `"tasks"` from `SendCard` in `src/lib/estimate-email/send-ui.ts` (lines 106–119). |
| `src/app/(app)/estimator/steps/send-step.tsx:9` | `ApplyTemplateControl` from `components/apply-template-control.tsx` | Decision needed (risk R3). Either keep a slim task store for quotes, or delete the Tasks card from the Estimator's Send & track step and these actions with it. |
| `src/app/(app)/account/actions.ts:169` | `saveUserSchedulePrefs, markDriveStale` from `lib/stores/schedule-prefs.ts` | Delete the "My drive buffer" action. |
| `src/app/(app)/account/actions.ts:180` | `saveUserWorkHours` from `lib/stores/schedule-prefs.ts` | Delete the "My work hours" action. |
| `src/app/(app)/account/page.tsx:22` | `getScheduleDefaults, getSchedulingSettings, getUserSchedulePrefs, getUserWorkHours` from `lib/stores/schedule-prefs.ts` | Delete the work-hours and drive-buffer cards and their loaders. |
| `src/app/(app)/account/work-hours-card.tsx:5` | `WorkHoursEditor (default)` from `components/visit-booking/work-hours-editor.tsx` | Delete this file. |
| `src/app/(app)/account/work-hours-card.tsx:6` | `fmtWorkHours, type WorkHours` from `lib/visit-plan/settings.ts` | Delete this file. |
| `src/app/(app)/_dashboard/widgets/installs.tsx:2` | `ProjectRecord` from `lib/stores/projects.ts` | Delete this file with the Installs report widgets (section C.6). |
| `src/app/(app)/_dashboard/widgets/bids.tsx:6` | `chicagoShortDate` from `lib/triage/clock.ts` | Move the four date helpers to the same neutral Chicago-day module (or `src/lib/format.ts`) and repoint. |
| `src/app/(app)/_dashboard/widgets/backward.tsx:3` | `fmtDate, type ProjectRecord` from `lib/stores/projects.ts` | Delete the `open-projects` and `backlog` widgets from this file; keep `equipment-sold`. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:10` | `savePlanPins` from `lib/task-plan/load.ts` | Delete the `today-plan` card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:11` | `todayRows` from `lib/task-plan/today.ts` | Delete the `today-plan` card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:23` | `queueCardCounts, queueDueLabel` from `lib/queue.ts` | Delete the `my-queue` card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:24` | `taskHref` from `lib/calendar-tasks.ts` | Used by the "Waiting on others" rows (line ~101); delete with the queue card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:30` | `HomeToday (default)` from `app/(app)/home-today.tsx` | Delete the `today-plan` card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:31` | `type QueueRow` from `app/(app)/home-queue.tsx` | Delete the `my-queue` card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:38` | `HomeCalendar (default)` from `app/(app)/home-calendar.tsx` | Delete the `calendar` card. |
| `src/app/(app)/settings/actions.ts:968` | `saveScheduleDefaults, markDriveStale` from `lib/stores/schedule-prefs.ts` | Delete the drive-buffer default action. |
| `src/app/(app)/settings/actions.ts:982` | `saveSchedulingSettings` from `lib/stores/schedule-prefs.ts` | Delete the scheduling-defaults action. |
| `src/app/(app)/settings/page.tsx:17` | `getScheduleDefaults, getSchedulingSettings, DEFAULT_DRIVE_BUFFER_MIN` from `lib/stores/schedule-prefs.ts` | Delete the loaders and the props they feed. |
| `src/app/(app)/settings/page.tsx:18` | `DEFAULT_SCHEDULING` from `lib/visit-plan/settings.ts` | Delete with the loaders above. |
| `src/app/(app)/settings/scheduling-defaults-card.tsx:4` | `WorkHoursEditor (default)` from `components/visit-booking/work-hours-editor.tsx` | Delete this file. |
| `src/app/(app)/settings/scheduling-defaults-card.tsx:5` | `SchedulingSettings` from `lib/visit-plan/settings.ts` | Delete this file. |
| `src/app/(app)/settings/groups/field.tsx:10` | `SchedulingSettings` from `lib/visit-plan/settings.ts` | Remove the scheduling-defaults and drive-defaults cards from the Field & Venues group. |
| `src/app/(app)/settings/groups/types.ts:13` | `SchedulingSettings` from `lib/visit-plan/settings.ts` | Remove the `scheduling` prop from the group props type. |
| `src/app/(app)/import/registry.ts:15` | `* as Projects` from `lib/stores/projects.ts` | Delete the `projects` import type (registry entry and `types.ts` lines ~242–258). |
| `src/app/(app)/import/registry.ts:25` | `* as Equipment` from `lib/stores/equipment-items.ts` | Delete the `equipment` import type (`types.ts` lines ~303–320). |
| `src/app/(app)/import/registry.ts:26` | `* as TaskTemplates` from `lib/stores/task-templates.ts` | Delete the `task_templates` import type (`types.ts` lines ~322–340; `controls.tsx:115`; the link at `import/page.tsx:1029`). |
| `src/app/(app)/import/daylite/page.tsx:5` | `STAGE_META as REPAIR_STAGE_META` from `lib/stores/repair-jobs.ts` | Only needed while the Daylite history import still writes repair jobs (risk R6). Inline the three stage labels or delete with that import target. |
| `src/app/print/letter/[kind]/[id]/page.tsx:4` | `RepairLetterView` from `app/(app)/repairs/letter/letter-view.tsx` | Remove the `repair` kind from this print route (lines ~33, ~41). If flame and inspection letters go too, the whole route goes. |
| `src/lib/nav-counts.ts:5` | `getAllProjects, riskFlags` from `lib/stores/projects.ts` | Delete the `projects` count and the "Projects need attention" bell group (lines ~259–270). |
| `src/lib/nav-counts.ts:12` | `getAll as allRepairs, flaggedFromInspections, priorityMeta` from `lib/stores/repair-jobs.ts` | Delete the `repairs` count and the "Repairs awaiting scheduling" bell group (lines ~283–294). |
| `src/lib/nav-counts.ts:18` | `allTasks, taskBellItems, isOverdue` from `lib/stores/tasks.ts` | Delete the "Tasks needing attention" bell group (lines ~320–331). |
| `src/lib/pipelines-server.ts:133` | `getAllProjects, setProjectStage` from `lib/stores/projects.ts` | Delete the project half of `moveStageRecords` and of `stageUsage` (line ~63); keep the quote half. |
| `src/lib/documents-upload.ts:4` | `getProject` from `lib/stores/projects.ts` | Refuse `project` as an upload parent, or check existence with a direct `getDoc("projects", id)`. |
| `src/lib/venue-history-server.ts:13` | `getAllProjects` from `lib/stores/projects.ts` | Drop project rows from the venue history (and the `/projects?id=` link at line ~150), or keep a local reader over the `projects` table. |
| `src/lib/venue-history-server.ts:17` | `getAll as getAllRepairs` from `lib/stores/repair-jobs.ts` | Drop repair rows (lines ~64, ~176–178) or keep a local reader over `repair_jobs`. |
| `src/lib/company-summary.ts:3` | `getAllProjects` from `lib/stores/projects.ts` | Drop the project lines from the company summary (link at line ~148). |
| `src/lib/customer-feed.ts:5` | `getAllProjects` from `lib/stores/projects.ts` | Drop project rows from the customer activity feed (`customer-feed-rows.ts:284`). |
| `src/lib/customer-feed.ts:8` | `getAll as getAllRepairs` from `lib/stores/repair-jobs.ts` | Drop repair rows from the feed (`customer-feed-rows.ts:206`, `:218`). |
| `src/lib/vendor-tasks.ts:10` | `allAssignments, createAssignment, type Assignment` from `lib/stores/assignments.ts` | Decision needed (risk R3). Vendor price-list reminders are assignments in My Queue. Either drop `ensureVendorAssignments` and the "owner task" column on `/vendors` (links at `vendors/page.tsx:117`, `vendors/[id]/page.tsx:128`), or keep `stores/assignments.ts`. |
| `src/lib/stores/site-visits.ts:3` | `normalizeInvites, type VisitInviteRecipient` from `lib/visit-invite-plan.ts` | Move `normalizeInvites` and its type into the store, or drop `invites` from the visit record if invites go. Decision needed (risk R2). Venue Assessments keeps visits but loses invites, conflicts and drive time: replace with a plain date/time/lead form. |
| `src/lib/stores/site-visits.ts:4` | `readAttendees` from `lib/visit-plan/people.ts` | Move `readAttendees` (10 lines) into the store. |
| `src/lib/stores/site-visits.ts:5` | `chicagoDayKey` from `lib/drive-plan/day.ts` | Move `src/lib/drive-plan/day.ts` to a neutral path (for example `src/lib/chicago-day.ts`) BEFORE deleting `drive-plan/`, and repoint this import. It is a plain date helper with no drive logic. |
| `src/lib/stores/quote-spawn.ts:58` | `createFromQuote (dynamic import)` from `lib/stores/repair-jobs.ts` | Remove the `repair` case (risk R1). |
| `src/lib/stores/quote-spawn.ts:64` | `createFromQuote (dynamic import)` from `lib/stores/equipment-bookings.ts` | Remove the `rental` case (risk R1). |
| `src/lib/stores/quote-spawn.ts:112` | `createProjectFromQuote` from `lib/stores/projects.ts` | Remove `spawnProject` and the `default` case (risk R1). With flame, inspection and consulting also gone, delete the whole file and its two call sites in `quotes.ts` (lines ~2298, ~2449). |
| `src/lib/stores/rewards.ts:3` | `normalizeProject, type ProjectRecord` from `lib/stores/projects.ts` | Risk R4. Lifetime spend counts done projects. Keep the read, with a local type and a local `done` test (stage id `complete`, or the last pipeline stage), or decide that spend is quotes only. |
| `src/lib/stores/rewards.ts:5` | `RepairJobRecord` from `lib/stores/repair-jobs.ts` | Risk R4. Only Daylite-imported repairs count; replace with a local type over the `repair_jobs` table. |
| `src/lib/stores/quotes.ts:24` | `createAssignment` from `lib/stores/assignments.ts` | Delete the "Install sold — reach out" assignment at lines ~2438–2446. |
| `src/lib/stores/quotes.ts:31` | `isProjectExcludedQuoteType` from `lib/project-quote-types.ts` | Goes with the line above. Then `project-quote-types.ts` has no kept caller. |
| `src/lib/stores/quotes.ts:2528` | `getProjectByQuote, updateProject` from `lib/stores/projects.ts` | Delete `syncProjectBonusPool` and its callers; the bonus record stays on the quote. |
| `src/lib/stores/parties.ts:8` | `ProjectRecord` from `lib/stores/projects.ts` | Replace with a local structural type holding only the fields read here; the `projects` table stays, so the read keeps working. Or drop `project` from `PartyRecordType` and from the company page's Bids & roles card (`components/parties/company-roles-card.tsx:31`, `parties/actions.ts:20`). |
| `src/lib/daylite/history-commit.ts:65` | `buildProject, normalizeProject, type ProjectNote, type ProjectRecord, type ProjectStageChange` from `lib/stores/projects.ts` | Risk R6. The Daylite history import writes projects. Either retire the project target of that import, or copy `buildProject` / `normalizeProject` into `src/lib/daylite/`. |
| `src/lib/daylite/history-commit.ts:66` | `* as Repairs` from `lib/stores/repair-jobs.ts` | Risk R6. Same for repair jobs (`buildRepairJob`, `dayliteImportSource`). |
| `src/lib/parties/bids.ts:3` | `chicagoShortDate, chicagoTime, dayDiff, dayKey` from `lib/triage/clock.ts` | Move the four date helpers to the same neutral Chicago-day module (or `src/lib/format.ts`) and repoint. |
| `src/lib/estimate-output/responses-server.ts:10` | `createTask` from `lib/stores/tasks.ts` | Risk R3. A client's response on a package page creates one task per assignee. Drop the task step (the note and lead activity remain) or keep a slim task store. |
| `src/lib/address-verify/worklist.ts:12` | `chicagoDayKey, chicagoDayStart` from `lib/drive-plan/day.ts` | Move `src/lib/drive-plan/day.ts` to a neutral path (for example `src/lib/chicago-day.ts`) BEFORE deleting `drive-plan/`, and repoint this import. It is a plain date helper with no drive logic. |
| `src/lib/dealer-api/etc/apply.ts:33` | `chicagoDayKey, chicagoDayStart` from `lib/drive-plan/day.ts` | Move `src/lib/drive-plan/day.ts` to a neutral path (for example `src/lib/chicago-day.ts`) BEFORE deleting `drive-plan/`, and repoint this import. It is a plain date helper with no drive logic. |
| `src/lib/estimate-email/send-server.ts:18` | `createTask` from `lib/stores/tasks.ts` | Risk R3. The follow-up task after sending an estimate (`addFollowUpTask`, line ~1004). The Estimator is losing "send to client" anyway; remove with it. |
| `src/lib/assessments/reminders-server.ts:9` | `createTaskOnce` from `lib/stores/tasks.ts` | Risk R3. Assessment reminders ARE tasks (`T-asr-…`). Keep a slim task store, or move reminders to their own collection. |
| `src/lib/assessments/reminder-close.ts:8` | `setTaskStatus` from `lib/stores/tasks.ts` | Same as above; this file also queries `DOC_TABLES.tasks` directly (line ~17). |
| `src/lib/sync/today-jobs.ts:24` | `RepairJobRecord` from `lib/stores/repair-jobs.ts` | Remove the `repairs` input, the `repair_job` kind and its label. |
| `src/lib/sync/today-jobs.ts:27` | `ProjectRecord` from `lib/stores/projects.ts` | Remove the `projects` input, the `project` kind and its label. |
| `src/lib/vendor-quotes/threads-server.ts:13` | `getProject` from `lib/stores/projects.ts` | Remove the project branch of "File to estimate / project…" (the Inbox side of this is leaving anyway). |
| `src/lib/dashboard/metrics.ts:7` | `ProjectRecord` from `lib/stores/projects.ts` | Delete the project metrics (lines ~96–230: `openProjects`, `backlogProjects`, `projectedProfit`, the forward book). |
| `src/lib/dashboard/data.ts:9` | `getAllProjects` from `lib/stores/projects.ts` | Delete the `projects` loader. |
| `src/lib/dashboard/data.ts:17` | `loadQueue` from `lib/queue.ts` | Delete the `queueItems` loader. |
| `src/lib/dashboard/data.ts:18` | `openWaitingTasksBy` from `lib/stores/tasks.ts` | Delete the `waitingOnOthers` loader. |
| `src/lib/dashboard/data.ts:19` | `loadHomeAgenda` from `lib/agenda.ts` | Delete the `agenda` loader. |
| `src/lib/dashboard/data.ts:21` | `loadTaskPlans, VIEW_PLAN_CALENDAR_MS, type PersonPlan` from `lib/task-plan/load.ts` | Delete the `taskPlan` loader. |
| `src/db/seed-data.ts:13` | `repairJobsSeed` from `db/seeds/repair-jobs.ts` | Delete the `repair_jobs` seed row (line ~120). |
| `src/db/seed-data.ts:15` | `projectsSeed` from `db/seeds/projects.ts` | Delete the `projects` seed row. |
| `src/db/seed-data.ts:18` | `equipmentLocationsSeed, equipmentItemsSeed` from `db/seeds/equipment.ts` | Delete the two equipment seed rows (lines ~125–126). |

Summary by removed module (how many kept import statements point at it)

| Removed module | Kept imports | Kept callers |
| --- | --- | --- |
| `stores/projects.ts` | 24 | sync push, sync today, today-jobs, companies list and record, documents (card and upload), import registry, nav counts, pipelines-server, venue history, company summary, customer feed, quote-spawn, rewards, quotes, parties, Daylite history import, vendor quote threads, dashboard data and metrics, two report widget files |
| `stores/tasks.ts` | 9 | Estimator (actions, page, types), nav counts, client response on a package page, estimate email follow-up, assessment reminders (two files), dashboard data |
| `stores/repair-jobs.ts` | 9 | sync today, today-jobs, Daylite import page and commit, nav counts, venue history, customer feed, quote-spawn, rewards |
| `stores/schedule-prefs.ts` | 6 | Account, Settings |
| `drive-plan/day.ts` | 5 | sync today, venue-assessments actions, site-visits store, address worklist, ETC price sync |
| `visit-plan/*` | 9 | Account, Settings (`settings.ts`, 5); venue-assessments and site-visits store (`people.ts`, `input.ts`, `pick-day.ts`, 4) |
| `components/visit-booking/*` | 5 | venue-assessments, company record, Account, Settings |
| `drive-sync/sync.ts` | 4 | Home page, address actions, venue-assessments visit actions |
| `drive-plan/plan.ts` (`FLAG_TEXT`) | 3 | address flag component, venue-assessments page, company record |
| `stores/task-templates.ts` | 3 | Estimator, import registry |
| `visit-edit-rights.ts`, `visit-invite.ts`, `visit-invite-plan.ts` | 4 | venue-assessments, company record, site-visits store |
| `task-plan/*`, `queue.ts`, `calendar-tasks.ts`, `agenda.ts`, the three Home card files | 10 | Home cards, dashboard data, Estimator actions (`task-plan/fields.ts`) |
| `triage/clock.ts`, `components/triage/start-here-card.tsx` | 3 | bids widget, `parties/bids.ts`, Home page |
| `stores/assignments.ts` | 2 | quotes store, vendor tasks |
| `components/tasks-card.tsx`, `apply-template-control.tsx` | 2 | Estimator Send & track step |
| `stores/equipment-items.ts`, `stores/equipment-bookings.ts` | 2 | import registry, quote-spawn |
| `project-quote-types.ts`, `sync/task-push.ts`, `repairs/letter/letter-view.tsx` | 3 | quotes store, sync push, print route |
| `db/seeds/*` | 3 | `src/db/seed-data.ts` |
| Total | 107 | |

### B.2 Route links and type strings in kept code (not imports)

These compile after the delete but become dead links or dead branches.

| Kept file:line | What it references | Suggested fix |
| --- | --- | --- |
| `src/lib/quote-links.ts:20–21`, `:26–27` | `quoteBuilderHref` returns `/repairs/quote?id=` and `/rentals/quote?id=` | Risk R7. Old repair and rental quotes still exist in the Quotes hub. Send them to a read-only view, or to `/quotes?id=` |
| `src/app/(app)/quotes/new/types.ts:11, :14, :61, :88, :118, :121, :151` | `repair` and `rental` entries on "+ New quote" | Remove both quote types from the menu and the "Change type" list |
| `src/app/(app)/quotes/new/actions.ts:25` | A quote link of type `project` → `/projects` | Remove the branch |
| `src/app/(app)/quotes/page.tsx:77, :80, :478, :481` | Type badge and type filter for `repair` and `rental` | Keep the badge for old rows; drop the filter options if no new ones can be made |
| `src/lib/quotes-hub-view.ts:13`, `src/lib/quote-won-version.ts:24`, `src/lib/quote-pdf/state.ts:8, :130`, `src/lib/review-limits.ts:36, :100, :179, :183–184`, `src/lib/venue-match.ts:30`, `src/lib/stores/quotes.ts:524, :2001`, `src/app/(app)/estimator/pricing.ts:812` | `"repair"` / `"rental"` in quote-type lists and switches | Leave them while old quotes of those types exist; they are data, not code paths into removed modules. Re-check each when the service quote types are finally retired |
| `src/lib/rewards/service-credit.ts:27`, `src/lib/rewards/spend.ts:71, :154` | Repairs in rewards credit and lifetime spend | Risk R4 |
| `src/lib/stores/pricing.ts:342, :514–523` | The "Repairs" group in Estimating Rules and the `repair_rates` blob | Remove the group and `getRepairRates` / `setRepairRates` when `repair-engine.ts` goes. `REPAIR_RATE_DEFAULTS` is also in `ENGINE_BLOBS` (line ~692) and the reset (line ~803) |
| `src/lib/assessments/quote-from-findings.ts:18, :58–60` | "Quote these findings" opens `/repairs/quote?customer=…&findings=…` | Risk R8. Keep only the Estimator-draft path |
| `src/app/(app)/assessments/findings/controls.tsx:108, :292, :396`, `findings/actions.ts:53`, `assessments/[id]/finding-sheet.tsx:39`, `src/lib/assessments/findings-model.ts:19`, `src/lib/stores/findings.ts:28, :136, :138` | The `repair` quote target for findings | Same as above |
| `src/lib/stores/assessments.ts:258` | An assessment may link a `projectId`; it reads `getDoc("projects", id)` directly | Leave (the table stays) or drop the link field from "New assessment" |
| `src/app/(app)/parties/actions.ts:20`, `src/components/parties/company-roles-card.tsx:31` | Party record type `project` → `/projects/<id>` | Drop `project` rows from the company page's Bids & roles card, or show them without a link |
| `src/components/rewards/rewards-ui.tsx:86–87` | Purchase rows link to `/projects/<id>` and `/repairs/results?job=` | Show the row without a link |
| `src/lib/company-summary.ts:148`, `src/lib/customer-feed-rows.ts:206, :218, :284`, `src/lib/customer-feed.ts:106`, `src/lib/venue-history-server.ts:150, :176–178, :196` | Project and repair rows, and a `/calendar` fallback link for visits | Remove the rows with the imports in B.1; point the visit row at the company record |
| `src/app/(app)/vendors/page.tsx:117`, `src/app/(app)/vendors/[id]/page.tsx:128` | "Owner task" links to `/queue?who=` | Risk R3 |
| `src/app/(app)/import/daylite/daylite-client.tsx:138, :796–797` | "Open Projects" / "Open Repairs" links after a Daylite import | Risk R6 |
| `src/app/(app)/import/types.ts:248, :309, :328`, `src/app/(app)/import/page.tsx:1029`, `src/app/(app)/import/controls.tsx:115` | `viewHref` and UI for the three removed import types | Delete with the types (section C.8) |
| `src/lib/estimate-email/send-ui.ts:106, :116–119` | The `"tasks"` card on Send & track | Risk R3 |
| `src/lib/stores/notif-prefs.ts:39, :41, :46` | Notification categories `projects`, `repairs`, `tasks` | Section C.5 |

### B.3 Direct reads of removed collections from kept code

These use the document store by collection name, so they do not show up as imports.

| Kept file:line | Collection | Suggested fix |
| --- | --- | --- |
| `src/db/doc-tables.ts:197–199` | `repair_jobs`, `projects`, `tasks` in `SYNCABLE_COLLECTIONS` | Remove all three. Also remove the same three names from `FIELD_COLLECTIONS` in `src/lib/sync/engine.ts:37–39`. The two lists MUST match |
| `src/app/api/sync/push/route.ts:~139, ~154` | `tasks`, `projects` branches | Remove (B.1) |
| `src/lib/pipelines-server.ts:~63` | `listDocs("projects")` in `stageUsage` | Remove the project half |
| `src/lib/stores/rewards.ts:130–134` | `projects`, `repair_jobs` | Risk R4 |
| `src/lib/stores/parties.ts:89, :94` | `projects` | B.1 |
| `src/lib/venue-history-server.ts:~64` | `activityRows("repair_jobs", …)` | Remove |
| `src/lib/catalog-rename/apply.ts:328`, `src/lib/catalog-rename/steps.ts:17` | Rewrites part SKUs inside `projects.procurement` on a catalog rename | Delete the `projects` step. Old project documents then keep old SKUs |
| `src/lib/identity/convert.ts:87` | `listDocs("projects")` in the one-time identity conversion | Leave; it is a one-time migration script path |
| `src/lib/markup/doc-basis.ts:11` | `BASIS_COLLECTIONS = {"quotes", "projects"}` | Leave while ANY code still reads `projects` (rewards, parties). Removing it while a reader remains would skip the margin-to-markup conversion on read |
| `src/lib/daylite/history-commit.ts:172–173, :185, :723, :745, :765–779, :828` | Writes `projects` and `repair_jobs` | Risk R6 |
| `src/lib/assessments/reminder-close.ts:~17` | `DOC_TABLES.tasks` | Risk R3 |
| `src/db/doc-tables.ts:70–71, :77, :84–85, :87–89, :106–107` | The table registrations themselves | Leave registered (section D). Removing a registration changes the Drizzle schema and would generate a DROP migration |

### B.4 References from "going separately" code (not itemised)

124 import statements in 64 files. They matter only for ordering (section E): if Project
Management is deleted before those features, these break the build.

| Area | Files | Main removed modules used |
| --- | --- | --- |
| Design: consulting engagements (`src/app/(app)/design/engagements/*`, `src/lib/stores/engagements.ts`), 20 imports | 9 | `consulting-schedule`, `engagement-activity*`, `stores/tasks`, `stores/task-templates`, `components/gantt` |
| Design: designs (`src/app/(app)/design/designs/*`), 8 imports | 3 | `stores/tasks`, `stores/task-templates`, `tasks-card`, `apply-template-control`, `task-plan/fields` |
| Inbox (`src/app/(app)/inbox/*` except meetings, `src/lib/inbox-*`, `src/lib/inbox-org/*`, `src/lib/gmail/bridge.ts`, `src/lib/task-thread-share.ts`), 32 imports | 18 | `stores/tasks`, `task-plan/due`, `visit-invite*`, `visit-plan/*`, `components/visit-booking`, `triage/*` |
| Meetings and recordings (`src/app/(app)/inbox/meetings/*`, `src/lib/meetings/*`, `src/lib/krisp/write-back.ts`, `src/app/(app)/recordings/*`, `src/components/meetings/*`), 14 imports | 8 | `stores/tasks`, `stores/assignments`, `stores/projects`, `queue` |
| Assist and daily brief (`src/lib/assist/*`, `src/lib/brief/*`, `src/components/brief/*`, `src/components/ask/*`, `inbox/assist-*`), 41 imports | 18 | `triage/*`, `stores/tasks`, `task-plan/*` |
| Flame tests and inspections (`flame-tests/actions.ts`, `inspections/actions.ts`, `src/lib/inspection-engine.ts`, `src/lib/stores/inspections.ts`), 4 imports | 4 | `service-calendar`, `repair-engine` (`tripTravel`), `stores/projects` (`spawnServiceLinkedProject`) |
| Portal (`src/app/portal/page.tsx`, `src/lib/portal-projects.ts`, `src/lib/portal-quotes.ts`), 3 imports | 3 | `stores/projects`, `stores/tasks` |
| Gmail cron (`src/app/api/gmail/sync/route.ts`), 2 imports | 1 | `google/tasks-sync`, `triage/service` |

---

## C. Wiring to remove

### C.1 Navigation

| File:line | Entry |
| --- | --- |
| `src/components/nav/nav-data.ts:72–75, :78–79` | Projects, My Projects, Schedule, Field Work, Repairs, Rentals in the `pm` group. Lines 76–77 (Flame Tests, Rigging Inspections) go separately; when they go, delete the whole `pm` group (~lines 66–81) |
| `src/components/nav/nav-data.ts:160–162` | `activeKeyFor` map: `/queue`, `/triage`, `/calendar` |
| `src/components/nav/nav-data.ts:171–173, :176–177, :190` | Map: `/projects`, `/schedule`, `/field-work`, `/repairs`, `/rentals`, `/task-templates` |
| `src/app/(app)/home-tabs-keys.ts:15–16` | Home tabs "My Queue" and "Calendar". `HOME_TABS` also feeds the Home nav group, so removing them here removes both |
| `src/components/nav/SyncChip.tsx` | Uses `download-today`; keep, but check the wording once projects and repairs leave today's jobs |
| `src/lib/nav-counts.ts` (the `counts` object, ~lines 175–185) | Badge counts `projects` and `repairs` |

### C.2 Cron routes (`vercel.json`)

| Entry | Action |
| --- | --- |
| `/api/triage/build?slot=midday` at `45 18 * * *` | Remove the entry and the route. It also builds daily briefs and pre-made drafts, which are going separately |
| `/api/drive/sync` at `0 11 * * *` | KEEP the entry (risk R5). Inside `src/app/api/drive/sync/route.ts`, delete only `syncAllDrivers` (and its import). Keep `runAssessmentReminders`, `ensureVenueGeoStatus` and `runEtcDailyRider`. Consider renaming the route; if renamed, update `vercel.json` and the middleware matcher together |
| `/api/gmail/sync` at `45 11 * * *` | Going separately, but it currently also runs `syncDrivePhotos` (Catalog photos, kept) and `ensureVendorAssignments` (Vendors, kept). From this document's scope, delete the `buildSlotForAll("morning", …)` call (line ~111) and `syncAllGoogleTasks()` (line ~74). Whoever removes Gmail must move the catalog photo sync to the surviving daily cron |

`cronAuthFailure` lives in `src/lib/triage/cron.ts`. The kept `/api/drive/sync` route imports it.
Move it (for example to `src/lib/cron-auth.ts`) before deleting `src/lib/triage/`.

### C.3 Middleware (`src/middleware.ts`)

Remove `api/triage/build` from the matcher's exemption list, and its sentence from the header
comment. Keep `api/drive/sync` while that route stays. `api/queue` is not in the exemption list,
so there is nothing to remove for it. The `QUEUE_API_TOKEN` environment variable is read only by
`src/app/api/queue/route.ts`; remove it from the deployment (it is not in `.env.example`).

### C.4 Settings and Account

| Where | What to remove |
| --- | --- |
| `src/app/(app)/settings/settings-sections.ts:51` and the `data` row of `GROUP_LINKS` | The "Task Templates" link tile |
| `src/app/(app)/settings/settings-sections.ts` (`SETTINGS_CARDS`) | No card key mentions scheduling or drive defaults (searched); those two cards are rendered by `groups/field.tsx` without a registry row |
| `src/app/(app)/settings/groups/field.tsx:10`, `groups/types.ts:13`, `settings/page.tsx:17–18`, `settings/actions.ts:~968, ~982` | Company work hours, same-area minutes, daily drive limit, look-ahead days, drive buffer |
| `src/app/(app)/settings/pipelines-card.tsx`, `pipeline-stage-row.tsx`, `groups/sales.tsx` | The PROJECT pipelines half of Settings → Pipelines. Keep the quote pipelines half |
| Settings → Field & Venues → "Site visits — reason picklist" | Keep; Venue Assessments uses visit reasons |
| Settings → Consulting (phase menu and weights, disciplines, assumptions) | Going with the Design tab, not here. The phase WEIGHTS field (`consultingPhaseWeights`, `phaseWeightsFor` in `src/lib/settings.ts`) has no reader once `consulting-schedule.ts` is gone |
| Settings → Data & Tools → Addresses to verify | Keep, but `worklist.ts` lists upcoming visits and open leads as well as venues; it still works |
| `src/app/(app)/account/page.tsx:22`, `account/actions.ts:~169, ~180` | "My work hours", "My drive buffer". Also "Brief reminders on this phone" if it is still there (daily brief, going separately) |
| Estimating Rules | The "Repairs" group. "Travel & mileage" stays while flame and inspection quotes exist; the Venue Assessment travel auto-fill (`src/lib/survey-travel-server.ts`) reads road factor and speed, so those two rates stay regardless |
| Templates (`/templates`) | The `service_completion_letter` and `warranty_record` templates |

### C.5 Bell and notification groups

| File:line | Group |
| --- | --- |
| `src/lib/nav-counts.ts:~258–270` | "Projects need attention" (`projects`) |
| `src/lib/nav-counts.ts:~282–294` | "Repairs awaiting scheduling" (`repairs`) |
| `src/lib/nav-counts.ts:~320–331` | "Tasks needing attention" (`tasks`); its links point at `/projects/<id>` and `/field-work` |
| `src/lib/stores/notif-prefs.ts:39, :41, :46` | The matching per-user mute switches. Stored preferences may still hold these keys; ignore unknown keys on read |
| `src/lib/stores/notif-prefs.ts:37` | "Site visit requests" stays (Venue Assessments) |

`flaggedFromInspections` (used for the Repairs badge) lives in `stores/repair-jobs.ts` and reads
inspections; it goes with repairs.

### C.6 Home dashboard cards and Reports widgets

Registry: `src/lib/dashboard/registry.ts`. Stored per-user layouts
(`dashboard_layouts:<userId>` blobs and `src/lib/dashboard/layout-store.ts:19`) may still name a
removed widget id; make sure an unknown id is skipped, not thrown on.

| Widget id | Surface | Line |
| --- | --- | --- |
| `my-queue` | Home | 41 |
| `today-plan` | Home | 42 |
| `calendar` | Home | 48 |
| `backlog-value`, `to-be-billed`, `expected-collected`, `book-margin`, `billing-forecast`, `backlog-by-stage`, `margin-donut`, `upcoming-completions`, `completion-timeline`, `project-locations` | Home and Reports ("Installs") | 65–74 |
| `projected-profit`, `open-projects`, `backlog` | Home and Reports | 77–79 |

Also: the default layout list at `registry.ts:112–113`; the Start here card rendered directly in
`src/app/(app)/page.tsx:~145`; `src/app/(app)/_dashboard/widgets/installs.tsx` (delete),
`backward.tsx` (trim), `home-cards.tsx` (trim), `src/lib/dashboard/metrics.ts` lines ~96–230,
`src/lib/dashboard/data.ts` loaders. `billing-forecast` also reads consulting milestones, which
go with the Design tab. Check `needs-attention` and `team-activity` for project rows (not read).

Reports keeps: all Sales widgets, `bids-by-bidder`, `avg-margin`, `equipment-sold`.

### C.7 ⌘K search

`src/lib/search/global-search.ts` searches `quotes`, `designs`, `surveys`, `inspections`,
`catalog_parts`, `assessments`, `findings` and the CRM. It does not search projects, repair jobs,
tasks, rentals or site visits by collection. Nothing to remove for this scope. Not checked:
whether a quote result's link uses `quoteBuilderHref` for repair and rental quotes (it would then
point at a removed builder; see B.2).

### C.8 Import / Export

| File | Remove |
| --- | --- |
| `src/app/(app)/import/types.ts:~242–258` | Type `projects` |
| `src/app/(app)/import/types.ts:~303–320` | Type `equipment` |
| `src/app/(app)/import/types.ts:~322–340` | Type `task_templates` |
| `src/app/(app)/import/registry.ts:15, :25, :26` | The three registry entries and their commit functions |
| `src/app/(app)/import/controls.tsx:115`, `import/page.tsx:1029` | Task-template validation warnings and the link |
| `src/app/(app)/import/types.ts` (`quotes` type, line ~238) | The `quoteType` enum offers service types; trim if importing new repair or rental quotes should stop |
| `src/app/(app)/import/daylite/` and `src/lib/daylite/history*.ts` | Risk R6 |
| `src/app/(app)/import/daylite/calendar` and `src/lib/daylite/calendar-import.ts` | Imports Daylite calendar history into Google Calendar. It depends on `src/lib/google/calendar.ts`. Decide with the Gmail removal (see G) |

### C.9 `package.json` scripts and `scripts/`

Remove these `package.json` scripts: `tasks:backfill-due`, `test:morning-triage`.

Delete outright (they test only removed code): `scripts/backfill-task-due.ts`,
`scripts/reminders-agent.ts`, `scripts/test-auto-calendar.ts`, `scripts/test-drive-time.ts`,
`scripts/test-morning-triage.ts`, `scripts/test-site-visits.ts`.

Edit (they import removed modules alongside kept ones). The number is how many distinct removed
modules the file imports.

| Script | Removed modules | Note |
| --- | --- | --- |
| `scripts/test-review-and-spec.ts` | 25 | The main `test:specs` harness. Largest edit: board, people-lib, gantt, calendar-tasks, consulting-schedule, engagement activity, equipment seeds, pipelines project half and more |
| `scripts/test-bids.ts` | 6 | Triage "bid due" checks and project Bill-to checks |
| `scripts/test-inbox-org.ts` | 5 | Going separately |
| `scripts/test-thread-visibility.ts` | 5 | Going separately |
| `scripts/test-batch6.ts` | 2 | `stores/tasks`, `sync/task-push` |
| `scripts/test-brief.ts` | 3 | Going separately |
| `scripts/test-review-regressions.ts` | 3 | `queue`, `repair-engine`, `stores/assignments` |
| `scripts/test-ask.ts`, `test-meetings-323.ts` | 2 each | Going separately |
| `scripts/test-markup.ts` | 2 | Repair engine parity cases and project basis cases; `docs/markup/parity-baseline.json` holds matching baseline rows |
| `scripts/test-parties.ts` | 2 | Party copy to project |
| `scripts/test-oct15-batch3.ts` | 2 | `consulting-schedule`, `visit-edit-rights` |
| `scripts/inventory.ts` | 2 | Seed rows at lines 69, 71 |
| `scripts/test-assessments.ts` | 1 | Repair quote from findings (risk R8) |
| `scripts/test-settings-race.ts` | 1 | `stores/projects` |
| `scripts/test-va-notes.ts` | 1 | `drive-plan/day` (repoint after the move) |
| `scripts/smoke-routes.ts` | routes | Lines 53, 98, 109–112, 139–140, 148, 172–173, 183–185, 296–297, 333, 336, 369–370; line 356 (engagement Schedule tab) goes with Design |
| `scripts/geo-recheck-venues.ts` (`geo:recheck-venues`) | 0 | Keep; venue geocoding |

Seed data: `src/db/seed-data.ts:13, :15, :18` and rows at `:120, :122, :125–126`.

---

## D. Database tables and stored settings that become unused

Nothing here is dropped. Per the handoff decision, production tables and records stay untouched.
Leave every table registered in `src/db/doc-tables.ts` and `src/db/schema.ts` so that
`npm run db:generate` produces no migration.

Document collections (one table each)

| Collection | Holds | After removal |
| --- | --- | --- |
| `projects` | Projects and sales orders | Still READ by rewards spend, parties, and assessments' project link unless those are changed (risks R4, R6) |
| `repair_jobs` | Repair jobs | Still read by rewards spend unless changed |
| `tasks` | Tasks | Still written by assessment reminders, client responses and estimate follow-ups unless changed (risk R3) |
| `assignments` | Assignments | Still written by quote Won and vendor price-list checks unless changed |
| `task_templates` | Task template sets | Unused |
| `equipment_items`, `equipment_locations`, `equipment_bookings` | Rentals | Unused |
| `triage_snapshots`, `triage_marks` (migration `0036_triage`) | Morning triage | Unused |
| `site_visits` | Site visits | KEPT. Fields `attendees`, `invites`, `invite`, `googleEventId`, `inviteGmailIds` become unused if invites go |
| `consulting_engagements` | Engagements | Going with Design. Fields `startAt`, `endAt`, milestone `phaseId` become unused |

Relational tables and columns

| Object | After removal |
| --- | --- |
| `place_book` (migration `0037_address_verification`) | Still used for typed (non-venue) addresses by the Fix dialog and the worklist; unused only if those go too |
| `sites.geo_status`, `geo_source` and related columns | KEPT (venue address status) |
| `geo_cache` | KEPT (geocoding and routing cache; Venue Assessment travel auto-fill uses it) |
| `notif_prefs` | KEPT; holds three dead keys (`projects`, `repairs`, `tasks`) |

Settings blobs (rows in `blobs`, keyed by id)

| Blob id | Holds |
| --- | --- |
| `projects_dismissed` | Quote ids whose project was deleted |
| `repair_rates` | Repair engine rates |
| `schedule_defaults` | Company work hours, drive buffer, same-area minutes, drive limit, look-ahead |
| `schedule_prefs:<userId>` | Per-person work hours and drive buffer |
| `stay_over:<userId>` | Per-person stay-over days |
| `drive_sync:<userId>` | Drive sync state and lease |
| `task_pins:<userId>` | Planner pins and release markers |
| `dashboard_layouts:<userId>` | KEPT; may name removed widget ids |

Fields inside the main app settings record (`app_settings`, id `main`): `projectPipelines`
(unused after removal; `quotePipelines` and `defaultQuotePipelineId` stay), `consultingPhaseWeights`.

Fields on kept records that become write-only or dead: `Quote.repair`, `Quote.rental` (old
quotes keep them), `ProjectRecord.performanceBonusPool` (no writer once `syncProjectBonusPool`
goes).

External state that is NOT in the database and will be left behind: Google Calendar events the
app created (crew bookings; repair scheduling events with ids starting `qzre`; drive events
tagged `peakDrive`; visit invites) and each person's Google Tasks mirror list. Nothing removes
them after the code is gone (risk R9).

---

## E. Suggested deletion order

Each step ends with `npx tsc --noEmit` passing. Run `npm run build` at the end: several past
failures in this codebase were bundling errors that the type checker cannot see (a server-only
store pulled into a client component).

Prerequisite: decide risks R1–R4 and R6 (section F). The order below assumes the conservative
answers: keep a slim task store, keep rewards reading old projects and repairs, retire the
Daylite project and repair import targets.

It is easier if Flame Tests, Inspections, Inbox, Meetings, Design, Portal and Assist are removed
FIRST (section B.4 then disappears). If Project Management must go first, do step 2 before
anything else.

1. Move the shared helpers out of doomed directories, repoint imports, no behaviour change:
   - `src/lib/drive-plan/day.ts` → a neutral module (6 kept importers, plus `task-plan/due.ts`
     and others inside the removed set, which do not matter).
   - `chicagoShortDate`, `chicagoTime`, `dayDiff`, `dayKey` from `src/lib/triage/clock.ts` → the
     same module (2 kept importers).
   - `cronAuthFailure` from `src/lib/triage/cron.ts` → its own module.
   - `FLAG_TEXT.unverified` → `src/lib/address-verify/types.ts` (3 kept importers).
   - `readAttendees`, `cleanAttendees` (`visit-plan/people.ts`), `validVisitSpan`
     (`visit-plan/input.ts`), `normalizeInvites` (`visit-invite-plan.ts`) and
     `src/lib/visit-edit-rights.ts` → beside `stores/site-visits.ts`, if the visit model keeps
     attendees. `WorkHours` type is not needed by kept code after step 6.
2. Only if the service features are still present: break their three links into this scope.
   Copy `tripTravel` and its types from `repair-engine.ts` into `inspection-engine.ts`; delete the
   `spawnServiceLinkedProject` call in `stores/inspections.ts:~1299`; delete the two
   `service-calendar` calls in `flame-tests/actions.ts` and `inspections/actions.ts` (or keep
   `service-calendar.ts` until they go).
3. Stop creating new records. Edit `stores/quote-spawn.ts` (remove the repair, rental and project
   branches) and `stores/quotes.ts` (remove the "Install sold" assignment and
   `syncProjectBonusPool`). Remove `repair` and `rental` from "+ New quote". From this point no
   new project, repair job, booking or auto-assignment is created.
4. Remove the leaves that nothing kept imports: `src/app/(app)/rentals/`, `repairs/`,
   `field-work/`, `schedule/`, `projects/`, `task-templates/`, `src/app/api/projects/`, and nav,
   import types, smoke routes, seeds for them. Then `pricing/rental.ts`, the equipment stores,
   `operations-work*`, `service-calendar.ts` (if step 2 freed it), `repair-engine.ts`,
   `components/gantt/` (after the engagement Schedule tab is gone or stubbed),
   `components/project-value-editor.tsx`.
5. Remove Morning triage: the Start here card on Home, `/triage`, `/api/triage`, the cron entry
   and middleware exemption, the `buildSlotForAll` call in the Gmail cron, `components/triage/`,
   `src/lib/triage/`, `address-verify/triage-flags.ts`.
6. Remove the planner, calendar and drive time together (they import each other): Home cards
   `today-plan`, `calendar`, `my-queue` and their loaders in `dashboard/data.ts`; `/calendar`;
   `calendar-actions.ts`; the two `syncDriveIfStale` / `resyncFor…` call sites in kept code; the
   `syncAllDrivers` call in the drive cron; Account and Settings scheduling cards; then
   `task-plan/`, `stores/task-pins.ts`, `drive-sync/`, `drive-plan/`, `agenda.ts`,
   `calendar-tasks*.ts`, `stores/schedule-prefs.ts`, `components/task-plan/`.
7. Remove site-visit scheduling: replace the booking panel in
   `venue-assessments/visit-requests.tsx` and the Edit button and conflict chips on the company
   record; delete the invite calls in `venue-assessments/visit-actions.ts`; then
   `components/visit-booking/`, `visit-booking-actions.ts`, `/api/visits`, `visit-plan/`,
   `visit-invite*.ts`, `ics.ts`.
8. Remove My Queue: `/queue`, `/api/queue`, `queue.ts`, `queue-types.ts`, Home tab entry,
   `google/tasks*.ts` and its call in the Gmail cron.
9. Remove the project data readers in kept code (section B.1 rows for companies, venue history,
   customer feed, company summary, documents, parties, nav counts, dashboard metrics, report
   widgets, sync push and today). Then `stores/projects.ts`, `stores/repair-jobs.ts`,
   `project-quote-types.ts`, `job-value.ts`, `safe-sweep.ts`, the project half of
   `pipelines-server.ts`, and the unused project exports in `pipelines.ts`
   (`DEFAULT_PROJECT_PIPELINES`, `projectPipelineFor`, `resolveProjectStage`, `projectStageMeta`,
   `projectTag`, `isDone`, `isOnSite`, `isBacklog`, `isActive`, `stageLabelFor`, the legacy maps).
   Keep `resolvePipelines` returning a `project` list only if a reader remains.
10. Tasks last. Remove the Estimator Tasks card and task-template apply; then either delete
    `stores/tasks.ts`, `stores/assignments.ts`, `stores/task-templates.ts`, `tasks-card.tsx`,
    `apply-template-control.tsx`, `task-ids.ts`, `sync/task-push.ts`, or reduce `stores/tasks.ts`
    to what assessment reminders need. Remove `tasks`, `projects`, `repair_jobs` from
    `SYNCABLE_COLLECTIONS` and `FIELD_COLLECTIONS` in the same commit.
11. Clean up: `package.json` scripts, `scripts/`, `AGENTS.md` phase notes, the `QUEUE_API_TOKEN`
    deployment variable, `MASTER-HOWTO.md` sections that describe these screens.

---

## F. Risks and decisions needed

| # | Risk | Detail | Options |
| --- | --- | --- | --- |
| R1 | A won quote currently creates a project | `setStatus(…, "won")` calls `spawnFromQuote`, which creates a project or order for every system quote, a repair job for a repair quote and bookings for a rental quote. It also creates an "Install sold — reach out" assignment. Screens that open Projects, Schedule or Field Work also sweep for missed ones | Recommended: Won becomes a plain status with no side effect. If the separate Project Management app needs the hand-off, emit an export (a webhook or a downloadable JSON of the won quote) at the same point in `setStatus`. Do not leave the branch calling a deleted module: the router runs inside the status-change transaction and a throw there rolls the Win back |
| R2 | Venue Assessments depends on site-visit scheduling | The kept visit-requests scheduler renders the removed booking panel; scheduling a visit sends invites and re-syncs drive time; the company record shows conflict chips | Decide the reduced visit model: lead + date + start + end only, no attendees, no invites, no conflicts. Then `stores/site-visits.ts` needs its three imports moved or removed |
| R3 | Tasks are used by kept features | Assessment reminders are tasks with ids `T-asr-…` created by a daily sweep and closed when a finding's date changes. A client's response on an estimate package page creates a task per assignee. Sending an estimate can create a follow-up task. Vendor price-list reminders are assignments. The Estimator's Send & track step has a Tasks card and template apply | Either keep a slim `stores/tasks.ts` (create-once, set status, list by parent) with no queue, bell or calendar, and accept that nobody sees those tasks unless a list is built; or give assessment reminders their own surface. Without a decision, reminders are created into a table no screen reads |
| R4 | Customer Rewards lifetime spend reads projects and repairs | `purchasesFor` in `stores/rewards.ts` counts done projects (close date = last stage change, and "done" from the pipeline tag) and Daylite-imported repairs, deduplicated against quotes | Keep the two reads with local types. The "done" test needs the project pipelines, so keep enough of `pipelines.ts` to resolve a done stage, or freeze the rule to "stage id is `complete`". Dropping the reads changes customers' reward levels |
| R5 | Cron routes carry unrelated jobs | `/api/drive/sync` also runs assessment reminders and the daily ETC price sync. `/api/gmail/sync` also runs the Catalog photo sync and vendor checks. Deleting either route silently stops those | Keep `/api/drive/sync` and strip it. Move the catalog photo sync there before the Gmail route is deleted |
| R6 | Daylite history import writes projects and repair jobs | `/import/daylite` (`src/lib/daylite/history-commit.ts`) builds project and repair records and links to `/projects` and `/repairs` afterwards. `AGENTS.md` says a production run is still pending | Decide whether that import is still wanted. If yes, it must write somewhere a kept screen can show, or be limited to quotes and identity |
| R7 | Old repair and rental quotes remain in the Quotes hub | Every quote row links to "its own builder" (`quoteBuilderHref`). The repair and rental builders will be gone, as will their proposal letter and agreement PDF routes. Stored proposal PDFs for repair quotes remain in Blob | Give those rows a read-only destination. Check the print route `/print/letter/repair/<id>` is not still scheduled by `scheduleQuotePdf` for old quotes |
| R8 | Assessments "Quote these findings" opens the repair builder | One of its two targets is `/repairs/quote?findings=…`; findings record a `repair` quote link | Keep only the Estimator-draft target. Existing findings linked to repair quotes keep their link text |
| R9 | Google data is orphaned | Drive events, crew booking events, repair events, visit invites and Google Tasks lists stay in people's Google accounts with no code left to remove them | Before deleting the code, run one last drive sync with an empty plan (or a one-off script) to delete `peakDrive`-tagged events, and tell the team the rest must be removed by hand |
| R10 | Offline devices hold queued documents | A phone with queued `projects`, `tasks` or `repair_jobs` pushes will be refused once those leave `SYNCABLE_COLLECTIONS`; the outbox parks them as errors | Ask field users to sync before the deploy. Remove the three names from the server and client lists in the same release, and rebuild the native apps so the client list matches |
| R11 | Stored per-user state names removed things | Dashboard layouts with removed widget ids; notification preferences with removed keys; a remembered Home tab of `queue` or `calendar` | Confirm unknown ids are skipped (not verified, section G) |
| R12 | Reports loses its Installs dashboard | Thirteen widgets read projects (section C.6). Reports is "kept" | Confirm with the owner that Reports becomes sales-only |
| R13 | Catalog rename no longer rewrites old project procurement SKUs | Harmless if projects are read-only history | Accept |
| R14 | `pricingBasis` conversion for `projects` | `src/lib/markup/doc-basis.ts` converts unstamped project documents from margin to markup on read. If a reader of `projects` remains (R4 reads `value` only, not `margin`), leaving `projects` in `BASIS_COLLECTIONS` is harmless; removing it is also harmless for a value-only reader | Leave it |
| R15 | No rollback of intent | Deleting code is reversible in git, but step 3 stops creating records. Quotes won between the deploy and any rollback will have no project | Deploy at a quiet time; note the deploy time |

---

## G. Not verified

- The scan resolves static and dynamic imports by path. It does not see references built from
  strings at run time, JSX that reaches a removed route through a variable, or anything under
  `android/`, `ios/`, `native-web/` or `public/sw.js` (the service worker caches page lists and
  may name removed routes).
- Classification is by path prefix. A few files were judged by reading: `today-jobs.ts`,
  `address-verify/*`, `venue-availability*`, `templates.ts`, `google/calendar*.ts`. Others in the
  "going separately" set were not opened, and some of them may in fact be wanted by a kept
  feature (for example `src/lib/daylite/calendar-import.ts`, and `src/lib/google/calendar.ts`
  through it).
- `SETTINGS_CARDS` beyond the rows printed for this document, and the bodies of
  `settings/groups/field.tsx`, `groups/data.tsx`, `groups/sales.tsx`, `pipelines-card.tsx` and
  `account/page.tsx`, were not read line by line. The cards to remove were inferred from their
  imports.
- Whether unknown dashboard widget ids, notification keys and Home tab keys are tolerated on read.
- The Home cards `needs-attention`, `team-activity`, `my-pipeline` (stage sheet) and
  `venue-assessments` were not checked for project, repair, task or visit-scheduling content.
- `src/lib/customer-feed.ts`, `company-summary.ts`, `venue-history-server.ts` and the company
  record page were read only at the lines listed; they may show removed records in more places.
- `MASTER-HOWTO.md`, `DEPLOY.md`, `docs/specs/*.json` and `docs/superpowers/specs/*` were not
  searched for text describing removed screens.
- The exact line ranges marked "~".
- That `npx tsc --noEmit` passes after each step. The order was derived from the import graph; it
  was not executed.
- Environment variables other than `QUEUE_API_TOKEN` that only removed code reads.
