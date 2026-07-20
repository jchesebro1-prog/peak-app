# Consulting module — design

- **Date:** 2026-07-19
- **Decided by:** Jeff (brainstorming session; resolves the tabled item 13-D and the
  "Consulting as a project type" IDEA at the bottom of PUNCHLIST.md)
- **Status:** approved design, awaiting implementation plan

## What consulting IS (Jeff's answers, this session)

- **Definition:** design work Peak gets paid to commit to — more paperwork, much more
  review than ordinary estimating, with a real path forward.
- **How it starts:** an existing customer asks during other work; an architect/GC
  brings Peak into a new-build or renovation; or a formal RFP.
- **Deliverables (any mix per engagement):** design drawings + equipment schedule,
  spec/bid package other contractors bid against, assessment report, and/or ongoing
  owner's-rep style oversight through construction.
- **Payment:** fixed fee or phased/milestone fees. Never hourly; never folded into a
  later install price — consulting is independently paid work.
- **How it ends:** documents delivered and done; or the package goes to bid (Peak may
  bid the install too); or oversight continues to project close. **It never silently
  converts into a Peak install.**
- **Phases vary per engagement** — an assessment job has 2, a full design job has 6.
  There is no single fixed pipeline.
- **Progress gates on internal Peak review only.** Customer approvals, architect
  comments, and PE stamps happen in the world but do not gate the app's workflow.
- **Paperwork surrounding the deliverable:** professional-services agreement,
  insurance/liability certificates, meeting minutes + a decision record,
  submittals/RFIs during construction oversight.
- **Must be tracked:** review meetings with minutes, site visits, a decision log,
  milestones with dates.

## Architecture decisions (all Jeff, this session)

1. **Own top-level module** — not a Design Studio tool, not a Sales sub-screen, not a
   project kind.
2. **Quote-first entry:** new quote type `consulting`. The proposal is quoted; customer
   acceptance IS the paid commitment; the won quote spawns the engagement.
3. **Own data model:** a new `ConsultingEngagement` record type (rejected: reusing the
   projects table with a third `kind` — fixed stage lists fight per-engagement phases,
   and consulting would need hand-filtering out of every installs surface).
4. **Off the main Gantt:** consulting keeps its own schedule view inside the module
   (consistent with item 13: only the four service/install sources feed the main Gantt).
5. **Generated documents:** proposal/services agreement + spec-package boilerplate.
   Meeting minutes and milestone invoices are NOT generated (recorded/attached instead).

## Design

### Lifecycle

`consulting` quote (draft → internal review → sent → **won = commitment**) →
`ConsultingEngagement` (ids `C-1001`…) → phases run with internal review gates →
engagement closes (delivered / bid-supported / oversight complete). If Peak bids the
resulting install, that is an ordinary `system` quote cross-linked to the engagement
by id — a reference, never a conversion.

### The consulting quote

- A **lightweight builder**, not the section estimator: scope-of-work text, fixed fee
  OR a milestone fee schedule (name + amount rows), terms.
- Inherits the existing quote machinery unchanged: D84 revisions, the review gate,
  status pipeline, template letters.
- **Customer pricing tiers do not apply** (fee-based, not margin-derived).
- **Not portal-visible in v1** (neither the quote nor the engagement).
- **Sync rule:** the projects sync must skip `quoteType === "consulting"` exactly as it
  skips `flame_test` (extend the D82-fixed filter in `projects.ts:530` and the repair/
  inspection syncs' type filters are unaffected). The consulting sync spawns the
  engagement instead — same idempotent pattern as quotes→projects.
- Quotes hub: `consulting` joins the type filter (punch 27's one-hub-plus-filters).

### The ConsultingEngagement record

Links: `companyId`, contact(s), site(s) (identity-core ids per D85), a **people-with-
roles list** (engagement lead + contributors) — the same shape item 16 E requires on
projects; build the role-list component once, share it. A `quoteId` back to the source
quote; optional links to Design Studio saved designs (spec-gen source) and to any later
install quote.

Embedded content (doc-store pattern, consistent with the rest of the app):

- **`phases[]`** — chosen at creation (editable after) from an **admin-editable phase
  menu** seeded with: Assessment, Schematic Design, Design Development, Final
  Documents, Bid Support, Construction Oversight. Each phase: status
  (pending/active/complete), deliverable attachments, and an **internal review**
  object (same `none → in_review → approved/changes` shape as QuoteReview) — **a phase
  cannot complete without an approved review.** These reviews surface in the existing
  Reviews queue alongside quote/design reviews.
- **`milestones[]`** — `{name, targetDate, completedAt?, amount?}`. Amounts + dates
  feed the Reports **billing forecast** (forecast-only, like projects; no invoicing).
- **`decisions[]`** — running log `{at, by, decision, context}`.
- **`meetings[]`** — `{at, attendees, minutes, decisionIds[]}`.
- **`submittals[]`** — oversight-phase list `{kind: submittal|rfi, ref, received,
  respondedAt?, status, notes}`.
- **`documents[]`** — paperwork attachments (services agreement, insurance certs, …)
  using the app's existing embedded-attachment pattern (item 21's attachments rework
  can lift these later; not a dependency).
- Site visits: reuse the existing D76 `site_visits` records, adding an optional
  `engagementId` so oversight visits list under the engagement.

### Module UI

- **Top-level nav entry "Consulting"** (standalone entry like Home/Inbox/Calendar, not
  inside the five groups).
- List view (engagement cards: customer, active phase, next milestone, fee status) →
  detail with tabs: **Overview / Phases & Reviews / Milestones & Billing / Meetings &
  Decisions / Oversight / Documents**.
- **Own timeline view** inside the module: milestones + linked site visits on one
  horizontal timeline per engagement (and a small all-engagements roll-up). Nothing
  renders on the main Gantt.

### Document generation (templates)

Two generators, wording editable in `/templates` like every other letter:
1. **Proposal / services agreement** — filled from the consulting quote + engagement
   (parties, scope, fee/milestone schedule, standard terms).
2. **Spec-package boilerplate** — standard specification sections filled from
   engagement data and linked Design Studio designs (equipment schedules from the
   lineset/weights data where linked).

### Out of scope for v1 (explicit)

Portal visibility (quote or engagement), hourly billing, generated meeting-minutes
documents, generated invoices/billing letters, email integration for submittals/RFIs,
tasks on engagements (arrives with item 17's task table), and any main-Gantt rendering.

## Dependencies & sequencing

- **No hard blockers.** Shares the people-roles list shape with item 16 E — whichever
  builds first defines the component; the other reuses it.
- Identity core (D85) provides company/contact/site ids — already landed.
- Suggested build order: (1) quote type + lightweight builder + sync skip;
  (2) engagement record + module list/detail with phases & reviews; (3) milestones →
  billing forecast; (4) meetings/decisions/submittals + site-visit link;
  (5) timeline view; (6) the two template generators.
- At build time: new DECISIONS entry; close the PUNCHLIST Consulting IDEA and
  item 13-D's "tabled" note by pointing both here.

## Verification

- `tsc` + build clean; browser pass: create consulting quote → review → send → won →
  engagement appears with chosen phases; phase blocked from completing until its
  review is approved; milestone amounts appear in the Reports forecast; won
  consulting quote spawns NO project and nothing consulting appears on the main
  Gantt; template generators produce the two documents; site visit linked to an
  engagement lists under Oversight.

## Risk

Medium-sized additive feature. Riskiest edge: the quotes sync — a filter mistake
could mint phantom projects again (the exact D82 bug class); the verification step
above checks it explicitly. Everything else is new surface with no existing consumers.
