# Handoff — breaking Quartzite into separate programs

Started 2026-11-19 at Jeff's direction. Goal: split the app into standalone
programs plus written specs the long-term coding team can fold into their own app.

## Decisions (Jeff, 2026-11-19, in the working session)

| Question | Answer |
| --- | --- |
| What is an "HTML program"? | One offline `.html` file: no server, no login; data saves in the browser plus an export/import backup file. |
| "Knowledge saved into the program" | Peak's rates, pricing rules, pick lists, parts and templates are built into each program. |
| Removed features | Delete the code on the branch; leave production database tables and records untouched. |
| Stays in the main app | CRM, Estimator, Venue Assessments + Assessments. |
| Leaves the main app | Project Management, Flame Tests, Rigging Inspections, Repairs, Rentals, Krisp/Meetings, Inbox, Design tab, Client Portal, Tasks/Calendar/Morning triage, AI features. |
| Estimator direction | No sending to clients (files are downloaded and sent by hand). Focus on revisions: status tracked per revision, automatic backup when edits resume after a day. Done last. |

## Deliverables

| # | Item | Output | Status |
| --- | --- | --- | --- |
| 1 | Client Portal | `client-portal-spec.md` | Spec written; code not yet removed |
| 2 | Flame Tests + Rigging Inspections | `programs/` HTML + spec | In progress |
| 3 | Project Management | spec, then removal | Not started |
| 4 | Krisp + Inbox | spec, then removal | Not started |
| 5 | Design tab | HTML + spec | Not started |
| 6 | Estimator revisions | in-app change | Not started |

## Sources

Every spec ends each section with a **Source** line naming the repository files it
was derived from. Decisions above come from Jeff's answers in the 2026-11-19 session.
