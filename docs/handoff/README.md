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

### Update, later the same day (Jeff)

- Repairs and Rentals: spec only; unlikely to be used.
- Venue Assessments move INTO the Flame Tests + Inspections program (Peak Service), not kept in the app.
- Estimator edits (revisions, backups) are on hold; focus is the spin-offs.
- Design tab split agreed: Assembly Builder, Lineset Builder and Motor Library stay with the Estimator; the Grid, Quick Design, Specs and Consulting spin off.

### Update, 2026-11-20 (Jeff)

- A won estimate is only a status change; it creates nothing.
- Tasks are removed entirely. Rewards are removed. The Daylite import is removed. Google Drive is removed as a catalog photo source. Consulting is removed (no read-only consulting quotes).
- The Assessments module (`AS-####`, findings register) is added to Peak Service.
- Flame results: IFR and Replace.
- Not answered, so Claude's recommendation applies: spec text stays editable on catalog parts; client packages no longer include a specification file; Grid-only catalog fields (riser tags, cable diameter, designator code, symbol drawings) are removed.

## Deliverables

| # | Item | Output | Status |
| --- | --- | --- | --- |
| 1 | Client Portal | `client-portal-spec.md` | Spec written; code not yet removed |
| 2 | Flame Tests + Rigging Inspections | `programs/peak-service.html` + `flame-inspections-spec.md` | Program and spec written; code not yet removed |
| 3 | Project Management (incl. Repairs, Rentals, tasks, calendar, triage) | `project-management-spec.md` + `removal-map-project-management.md` | Spec and removal map written; code not yet removed |
| 4 | Inbox, Krisp, AI | `inbox-krisp-ai-spec.md` + `removal-map-inbox-krisp-ai.md` | Spec and removal map written; code not yet removed |
| 4b | Venue Assessments | `venue-assessments-spec.md`, `venue-assessment-form.json`, tab in `programs/peak-service.html` | Spec written; form, photos, recap and field sheet in the program; sketch pads and 3D preview not ported |
| 5 | Design tab (Grid, Quick Design, Specs, Consulting) | `programs/peak-design.html`, `design-spec.md`, `design-data.json`, `removal-map-design.md` | Program, spec and removal map written; code not yet removed |
| 6 | Estimator revisions | in-app change | Not started |

## Peak Service program vs. the app

The offline program follows `flame-inspections-spec.md` except where a single offline file cannot:

- Travel uses the app's "estimate" method only: one-way miles and minutes typed per venue, one round trip to the farthest venue. No routing or geocoding.
- A quote's price freezes at the rates in force when it is marked sent; Revise reopens it at today's rates. (The app re-prices on each builder save.)
- Rates are edited only on the Rates tab, never from inside a quote.
- Renewal emails are text to copy; nothing is sent.
- Venue Assessments are drawn from `venue-assessment-form.json`, embedded in the file. Sketch pads are replaced by a photo upload per pad; the 3D preview, travel auto-fill from routing, the optional findings merge/split tools and Fill down / Mark range spare on the line set schedule are not ported.
- The Assessments module (`AS-####`, findings register, venue profiles) is included: all 9 scopes, 55 sections, 284 questions and 51 gate rules are embedded as data and read by a port of the evaluator. Not ported: offline sync, Blob photo storage, the "Quote these findings" hand-off, emailing reports, admin-added pick-list values, assessment reminders.
- Not included: the dashboard map, calendar holds, the customer portal, repairs flagged from inspections, the three report layout variants (one layout each), rewards credit.
- Flame results are counted as Passed, IFR and Replace (Jeff, 2026-11-20). They are stored in the app's fields `passed`, `retreated` (IFR) and `failed` (Replace).

## Peak Design program vs. the app

Built from `design-data.json` (embedded) and `design-spec.md`. The estimate engine reproduces the spec's worked example exactly (all 37 quantities).

- Venue plans are redrawn from the templates' area outlines and stretch rules, not the original CAD line work; doors, seats and double-line walls are not drawn. The Church Contemporary drawing and movable rooms are not included.
- Auto fill follows the spec's placement formulas; positions are stored in feet, so after changing a dimension the user presses Re-fill.
- The pairing of equipment items to device types (which sets designator codes) is the program's own table; the app derived it from catalog categories.
- No built-in prices: the Equipment map starts empty, as in the app. "Load sample map + parts" on the Backup tab loads invented `SAMPLE-` parts for demonstration only.
- Not included: plan upload and calibration, spaces and the room-shape editor, wire routing, risers and conduit fill, the multi-sheet drawing set, revisions and options, Specs, Consulting, promote-to-quote, object symbols, assemblies and racks, align / copy-paste / snap.

## Sources

Every spec ends each section with a **Source** line naming the repository files it
was derived from. Decisions above come from Jeff's answers in the 2026-11-19 session.
