# Design — Daylite / Monday replacement: the identity model and CRM parity

- **Date:** 2026-07-19
- **Status:** approved in conversation; **not started**
- **Author:** Jeff Chesebro with Claude
- **Supersedes/absorbs:** the 2026-07-14 proposal in
  `knowledge/peak/backend-crm-data-model-2026-07.md` (memory), whose closing caveat —
  *"not yet reconciled with the live schema"* — this document resolves.
- **Punch list:** absorbs items 7, 12, 17, 18, 19, 20, 21, 22, 23 (see §9)

---

## 1. Why

Peak is replacing five pieces of software with one, to cut cost and stop context-switching.
This document covers three of them:

| Replace | Keep |
|---|---|
| **Daylite** — CRM | **Google Drive** — becomes Peak's file backend, integrated later, not replaced |
| **Monday** — project management | **Accounting** (QuickBooks or successor) — stays external. Export/import now, API later |
| **Estimation in QuickBooks** — move into Peak's estimator | **Sortly** — inventory, out of scope |

There is **no deadline**. This is a side project, so the sequencing in §7 is optimized so
that every phase ships something visible — a foundation-first plan with months of
invisible work is how side projects die.

**Peak currently holds demo/seed data only.** Nothing in production depends on the
customer record, so the refactor below can be destructive. This is the single biggest
simplification available and it will not be available later.

### The constraint that shapes the migration

Jason is skeptical of leaving Daylite because migrating *into* Daylite was painful. The
objection is about migration pain, not about Daylite. Therefore the migration must be the
**most evidenced** part of this plan, not the most hand-waved (see §6).

---

## 2. The core principle

**Retire "customer" as a stored field.** A company is not intrinsically a customer — that
is a *role* it plays on one specific deal.

On public-bid work the district is the end user but Peak's contract is held by a GC or
electrical contractor, so the paying party is not the district. A literal `customerId`
column forces a false choice. Instead: **model roles on the relationship, and derive
"who is the customer" from flags.**

Validated against two real jobs:

**Oshkosh North** — district = owner/end user; EC = contract holder.
**Fall Creek** — Bray = architect; district = end user; Miron = GC; B&B = EC/contract holder.

Same shape, no special-casing.

**Rice Lake / UWEC Barron County** broke an early assumption and improved the model: the
university owns the building and a resident theatre company rents it, so **there can be
two end users**. `sites.companyId` (who owns the building) and `isEndUser` (who operates
the systems) are separate facts.

---

## 3. Architecture

### 3.1 The split

**Relational core** — the identity graph, as real Drizzle tables with foreign keys and
constraints. Peak already has three relational tables (`users`, `appSettings`,
`gmailConnections`), so this extends an existing paradigm rather than introducing one.

**Doc store — unchanged.** Quotes, projects, comms, designs, flame jobs, inspections,
repairs, surveys, catalog and site visits keep their current shape and sync behavior.

**How they connect:** a doc record stores a foreign-key id **plus a denormalized display
name** (e.g. `siteId` + `siteName`). List screens render without joins, and the dozen-plus
screens that show "the customer" need a rename rather than a rewrite. **The id is truth;
the name is a cache.**

### 3.2 Why relational for the identity core

Chosen over an all-doc-store approach for two reasons that both bite hardest here:

1. **Referential integrity during migration.** Importing 17 years of another system's data
   is the worst possible moment to have none. Orphaned links and duplicate bill-tos fail
   loudly at import instead of surfacing a year later.
2. **Query shape.** "Every project Craig Radi is linked to" is an indexed lookup, not a
   full-collection scan. The activity timeline — potentially tens of thousands of imported
   rows — genuinely needs `WHERE company_id = ? ORDER BY at DESC`.

**Accepted cost:** two persistence models to reason about, and the identity core is
**server-authoritative** — it is not part of the doc-store sync engine. Confirmed
acceptable: field staff do not need to create contacts offline.

### 3.3 "Customer" becomes derived

| Question | Answer |
|---|---|
| What is this job called? | The **Site**. Named for the venue, matching Daylite's organization and Drive's foldering |
| Who do we invoice? | The company recorded as **bill-to on the quote** — a field on the quote, not a party role (see §4.5) |
| Who can see it? | **Explicitly attached contacts only** (see §3.4) |

### 3.4 Visibility

| Record | Scoped to |
|---|---|
| **Inspections** | the **Site** — anyone with venue access sees them |
| **Quotes / estimates** | **explicitly attached contacts only** |
| **Projects** | **explicitly attached contacts only** |

Access is explicit, never derived from a company role. The Rice Lake theatre company sees
a job only if someone attached them to it.

**Consequence:** `project_contact` and `opportunity_contact` are the access control list.
Because "who is involved" is a longer list than "who may see it", those junctions carry an
explicit `portalAccess` boolean **defaulting to off**.

### 3.5 Simple jobs stay simple

One company may hold every role at once — owner, end user, contract holder. A flame test
at a small church must not require modelling five parties. The UI provides a one-step path
that creates that single party; the full form appears only when a second party is added.

---

## 4. Schema

### 4.1 `companies`

| Field | Notes |
|---|---|
| `id`, `name` | |
| `type` | Default hint only; the per-deal truth is the junction role. Values: district/school, architect, engineer or AV consultant, general contractor, electrical contractor, dealer, vendor/manufacturer, house of worship, municipal/civic, other |
| `lifecycle` | `prospect` / `customer` / `past` / `none` — Daylite's "category" |
| `keywords[]` | Tags (e.g. "Non-profit"); drives the board keyword filter |
| `website`, `mainPhone`, mailing address | HQ/billing address, distinct from a venue address |
| `pricingTier` | **Fallback only** — see §4.7 |
| `ownerUserId` | **Stored, not derived.** Peak today infers owner from the newest quote, which fails for a company with no quotes |
| `referredByContactId` | Nullable FK → contacts |
| `createdAt`, `updatedAt` | New. Peak's customer record has no timestamps, which is why there is no "added recently" view |

Value lists are expected to change; they are configuration, not schema.

### 4.2 `contacts`

| Field | Notes |
|---|---|
| `id`, `firstName`, `lastName` | Split, for sorting and salutations |
| `homeCompanyId` | Nullable FK. Changes when someone moves employers; junction rows keep the historical hat |
| `title` | A real job title. Replaces the `roles[0]` hack that makes staff sign as "Admin" on letters and "Estimator" on reports |
| `pricingTier` | **The authoritative tier** — see §4.7 |
| `status` | `active` / `former` / `do_not_contact`. Replaces the "gone" note convention |
| `userId` | **Nullable FK → users.** Links a contact to a staff login, so an employee buying for themselves is an ordinary customer transaction that is still identifiable as staff |
| `ownerUserId`, `createdAt`, `updatedAt` | |

### 4.3 `contact_emails` and `contact_phones`

A contact has **many** labeled emails and phones. Daylite already models this (Mobile /
Work / "Untitled Label").

```
contact_emails (id, contactId, email, label, isPrimary)
contact_phones (id, contactId, phone, label, isPrimary)
```

This is load-bearing for the portal (§4.6), not cosmetic.

### 4.4 `sites`

| Field | Notes |
|---|---|
| `id`, `companyId` | The owning organization |
| `name`, `address`, `city`, `state`, `zip`, `lat`, `lng` | Carried from today's `CustomerLocation`, which already has stable ids |
| `venueKind`, `travelMiles`, `travelMin` | Preserved |
| `driveFolderId` | Nullable placeholder for the later Drive integration — free now, saves a migration later |
| `createdAt`, `updatedAt` | |

### 4.5 Opportunities, projects and the junctions

**A Lead becomes an Opportunity; a Quote becomes a document attached to it.** Daylite's
first stage is literally "New Lead", so this merge is natural rather than forced. It also
gives quote revisions and bid alternates a parent, which Peak has no concept of today.

Stage mapping:

| Daylite | Peak |
|---|---|
| New Lead | `new` |
| Collect Information | `contacted` |
| Create BID | `bidding` (was `qualified`) |
| BID Sent | `bid_sent` (was `quoted`) |
| Awarded | `won` |
| PO Received | **project stage** |
| Order Product | **project stage** (Peak's existing `procurement`) |

**The opportunity ends at Awarded.** PO Received and Order Product become project stages so
each phase has one source of truth.

```
opportunity_party  (opportunityId, companyId, functionalRole,
                    isContractHolder, isEndUser)
opportunity_contact(opportunityId, contactId, role, representingCompanyId, portalAccess)
project_party      (projectId, companyId, functionalRole,
                    isContractHolder, isEndUser)
project_contact    (projectId, contactId, role, representingCompanyId, portalAccess)
```

`representingCompanyId` is the hat. When a person changes employers their contact row
updates, but the historical junction still records which company they represented on that
deal.

**Functional roles** include owner, **tenant / resident company**, architect, engineer,
GC, EC, consultant, dealer.

**Constraints:**
- At most one `isContractHolder` per project (partial unique index)
- `isEndUser` is **multi-valued** — no constraint (Rice Lake)
- **`isBillTo` lives on the quote, not on a party junction.** One quote, one bill-to,
  enforced. When funding splits — roughly one job in ten — that is two estimates, not two
  payers on one estimate

**Carry-forward:** on award, opportunity parties copy to the project, then construction-only
parties are added.

**Cardinality:** an opportunity has an optional primary site; **a project has exactly one
site**; a project may reference **multiple quotes** (the split-funding case). One
referendum becomes one opportunity and several projects at several sites — the multi-venue
split previously tracked as F14.

### 4.6 Portal access

A portal grant attaches to a **contact email**, not to a contact or a company:

```
portal_grants (id, contactEmailId, scopeType, scopeId, ...)
```

One human may hold several grants through several addresses. Nicole has one contact record
with emails for the community theatre, the high school, her own business and the Duluth
space — a primary venue and contact, plus sub-accounts, each landing in its own portal.

### 4.7 Pricing tier resolution

**The tier lives on the contact.** Pricing follows the person: if Eric calls, he gets his
pricing regardless of which organization he is at. The purpose is that good people get good
pricing without anyone setting a margin per deal.

Resolution order on a quote:

1. The `pricingTier` of the quote's **designated primary contact** — the single contact
   marked primary on that quote (the "attn" contact), not merely the first attached
2. Else the `pricingTier` of that contact's home company
3. Else the system default

If a quote has no primary contact designated, resolution falls straight to step 2 using the
quote's site-owning company.

**Stamp the resolved tier and margin onto the quote at creation** so history is stable and
auditable, and so a later tier change does not silently reprice sent work. This resolves the
open retroactivity question on punch item 11.

---

## 5. Migration

### 5.1 Step 0 — audit the export first

Pull a sample export and inventory it **before any import code is written**. Specifically:

1. **Is there a relationships/links file**, or do rows carry delimited lists? If neither,
   links are lost and the CSV path must be reconsidered (API or database export).
2. **Do roles survive?** "Participant" is on the link, not the record.
3. **Do notes/activity export**, with parent record, timestamp and author?
4. **Do custom fields appear**, with their labels?
5. Keywords, category, Referred by, owner, created/modified dates.
6. Attachments — almost certainly absent from CSV.
7. Row counts per entity.

### 5.2 Entity mapping

| Daylite | Peak |
|---|---|
| Company | `companies` — **and often a `site`**, see §5.3 |
| Person | `contacts` (+ `contact_emails`, `contact_phones`) |
| Opportunity | `opportunities` |
| Project | `projects` |
| Note / activity | activity timeline |
| Task | tasks |
| Appointment | calendar / site visits |

**This mapping contains a scheduling constraint: the migration cannot complete before the
task system and the activity timeline exist.** Seventeen years of notes need somewhere to
land. They are migration prerequisites, not optional features.

### 5.3 Splitting companies from venues

Daylite is organized by end-user venue, so its company table is mixed — *Portage Center for
the Arts* is both; *Oshkosh North HS* is a venue owned by a district; *Bray Architects* is
purely an organization. **No machine can reliably tell these apart.**

**A classification pass on the exported CSV, before import.** Columns: `is_organization`,
`is_venue`, `parent_organization`.

**Pre-filled by heuristic, corrected by a human** — names containing *HS, School, Center
for the Arts, Auditorium* default to venue; *Architects, Electric, Construction, LLC*
default to organization. Reviewing a pre-filled column takes minutes; filling a blank one
takes hours, and tedium is precisely what burned Jason last time.

Unclassified rows import as a company with one same-named site. Untidy but recoverable.

### 5.4 History scope: import everything

All 17 years. "We quoted them in 2014 and they never called back" is real intelligence, and
knowing a venue's full history is a competitive asset.

**Contact noise is handled at import, not by dropping data:**

1. **Auto-classify status** — no recent activity or links ⇒ `former`.
2. **Mine the "gone" notes.** Peak's existing convention of writing "gone" in a departed
   contact's record becomes the signal that sets `status = former`. An informal habit turns
   into structured data.
3. **Pickers default to active.** Search finds everyone, clearly marked; daily dropdowns
   stay clean.

### 5.5 De-duplication

The "new contact per employer" habit means the same human appears repeatedly. The importer
produces a **candidate duplicate report** (name + email matching); **a human confirms
merges.** Same name at different companies is sometimes genuinely two people, and a wrong
merge is worse than a duplicate.

**Review is scoped to active contacts only.** Duplicates of people who left in 2011 do no
harm sitting separately.

Merged records keep both employers: home company = current; junction rows keep the
historical hat.

### 5.6 Properties of the importer

- **Dry run first** — parse, validate, report, **write nothing**.
- **Idempotent** — drop and re-import cleanly, repeatedly.
- **Transactional** with a full integrity report: orphaned links, contacts referencing
  missing companies, projects with no contract holder, quotes with no bill-to, sites with
  no owner.
- **Runs continuously through the build, not once at the end.** Import companies and
  contacts in Phase 1; re-run with opportunities in Phase 3; re-run with notes in Phase 5.
  Every screen is then built against real accounts rather than seed data, and migration
  problems surface early when they are cheap.

### 5.7 Not migrated

Email (Peak has Gmail sync; re-importing would duplicate threads), attachments (deferred to
the Drive integration), Daylite's internal settings and saved views.

---

## 6. Evidence and verification

Because the migration must convince a skeptic, the following are **deliverables, not
afterthoughts**:

1. **Dry-run report** — what *would* happen, committing nothing.
2. **Reconciliation report** — per entity: rows in the export, rows imported, rows skipped
   **and why**. Plus spot-checkable specifics: *"Portage Center for the Arts: 1 company,
   1 site, 1 contact, 47 activity entries, 1 opportunity."* This is the artifact that
   answers *"did we lose anything?"* in a form that can be audited against Daylite directly.
3. **A hand-verified record set** — an agreed list of accounts (Oshkosh North, Fall Creek,
   Rice Lake, Portage) checked field by field against Daylite by a human.
4. **Parallel running is the default posture.** Daylite keeps running throughout. Cutover is
   a separate, explicit, later decision — not a consequence of starting. There is no burned
   boat, and this should be stated plainly when the plan is presented.
5. **Nobody re-enters data by hand.** The importer does the work.

---

## 7. Sequencing

| Phase | Ships (visible outcome) | Size |
|---|---|---|
| **0 — Groundwork** | Export audit. Plus four standing bugs fixed: project stage history added (stops ongoing data loss), phantom-projects sync bug, lead-convert dropping phone/address, inverted "nothing scheduled" warning | S |
| **1 — Identity core** | **People and Companies in the nav**, populated by a **first partial import** — companies, contacts, sites only. Opportunities, notes and tasks arrive on later re-runs (§5.6) | L |
| **2 — Parties & roles** | Oshkosh and Fall Creek modelled correctly. Party chips on projects and quotes. One shared picker replacing ~12 bespoke dropdowns | M |
| **3 — Opportunities** | **The Opportunities Board.** Leads become opportunities; quotes attach; board gains header total, age chips, linked people, real toolbar | M |
| **4 — Tasks** | **Monday replacement begins.** Real tasks with due dates and assignees; Worklist / My Tasks / Delegated / Done in the nav | M |
| **5 — Activity timeline** | Timeline on every record; 17 years of history lands | M |
| **6 — Projects board & nav** | **Projects Board.** Scoped and saved views; the sidebar fills in | M |
| **7 — Cutover** | Parallel run, verify, retire Daylite | S |

**Independent, unblocked by the above:** Drive integration for files, estimation adoption,
accounting export.

### Rationale

- **Phase 0 goes first** because the export audit gates every schema decision, and the four
  bugs produce wrong data every day they sit.
- **Phase 1 is front-loaded deliberately.** It is the phase most likely to stall a side
  project — heavy schema work, heavy screen rewiring — so it ends with two visible Daylite
  modules appearing in the nav.
- **Phases 3 and 4 are independent of each other.** If momentum is lost on one, switch.
- **Phase 5 before 6** because the timeline is what makes imported history worth having;
  6 is largely polish on work already done.

No calendar estimates are given: available hours are the unknown variable, and an invented
timeline would be wrong.

---

### A note on planning granularity

**This document is too large for a single implementation plan.** Each phase in §7 should get
its own plan when it is started. The natural first plan covers **Phase 0 plus Phase 1**,
since Phase 0 is small and its export audit directly informs Phase 1's schema.

---

## 8. Open questions

Deliberately unresolved; to be settled during the build.

1. **Portal rework scope.** Grants move from `(email → customerId)` to
   `(contactEmail → scope)`. Not hard, but not yet costed, and not currently in a phase.
2. **Search, Reports and the billing forecast** all read `customerId` today and need
   rewiring in Phase 1. Mechanical; enumerate before starting.
3. **Punch item 13** (service records → projects) interacts with this design — service
   records gain `siteId` + `companyId`, which may reshape that item.
4. **Custom fields.** Deferred until the export shows whether "Legrand Changed" and
   "Untitled Label" are widely populated or 2009 cruft. If rare, they become notes.
5. **Sortly / inventory** remains out of scope.

---

## 9. Punch-list cross-reference

These items are **part of this plan** and should not be picked up standalone.

| Item | Phase | Notes |
|---|---|---|
| 7 — Per-section dashboards | 6 | Interacts with nav philosophy |
| **12 — New Lead customer linkage** | 3 | **Absorbed.** The opportunity form uses the shared picker; ceases to be its own item |
| 17 — Tasks | 4 | Migration prerequisite |
| 18 — Opportunities board | 3 | ~70% already built |
| 19 — Projects board | 6 | Generalize the existing board component |
| 20 — People/companies + multi-link | 1, 2 | The foundation |
| 21 — Activity timeline | 5 | Migration prerequisite |
| 22 — Nav parity | 6 | |
| 23 — Customer/company fields | 1 | Folded into the schema above |
| **11 — Pricing tiers** | after 1 | Unblocked: tier lives on the contact (§4.7) |
| 5 — Monday-style UI | — | **Stays tabled.** Replacing Monday functionally is not the same as imitating it |
