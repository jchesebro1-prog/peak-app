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
| 2 | Flame Tests + Rigging Inspections | `programs/peak-service.html` + `flame-inspections-spec.md` | Program and spec written; code not yet removed |
| 3 | Project Management | spec, then removal | Not started |
| 4 | Krisp + Inbox | spec, then removal | Not started |
| 5 | Design tab | HTML + spec | Not started |
| 6 | Estimator revisions | in-app change | Not started |

## Peak Service program vs. the app

The offline program follows `flame-inspections-spec.md` except where a single offline file cannot:

- Travel uses the app's "estimate" method only: one-way miles and minutes typed per venue, one round trip to the farthest venue. No routing or geocoding.
- A quote's price freezes at the rates in force when it is marked sent; Revise reopens it at today's rates. (The app re-prices on each builder save.)
- Rates are edited only on the Rates tab, never from inside a quote.
- Renewal emails are text to copy; nothing is sent.
- Not included: the dashboard map, calendar holds, the customer portal, repairs flagged from inspections, the three report layout variants (one layout each), rewards credit.
- The flame result column the app stores as `retreated` is labelled IFR, as the app's letters do. The spec flags this naming as an open question for Jeff.

## Sources

Every spec ends each section with a **Source** line naming the repository files it
was derived from. Decisions above come from Jeff's answers in the 2026-11-19 session.
