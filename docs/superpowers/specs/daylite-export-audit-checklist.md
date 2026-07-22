# Daylite export audit — checklist (spec §5.1, Phase 0)

- **Status:** ✅ AUDIT RUN 2026-07-21 against Jeff's export (`memory/People.xlsx`
  3,801 rows, `memory/Companies.xlsx` 1,550 rows; converted to CSV for the tool).
- **Tool:** `npm run audit:daylite -- <folder-with-csvs>` (reads files only, no database)
- **Design:** `2026-07-19-daylite-parity-design.md` §5.1
- **Headline:** the export is **clean and import-ready for the identity core** (people +
  companies), **but it is People + Companies ONLY.** No links/relationships file, no roles-on-links,
  no notes/activity, no timestamps, no opportunities/projects/tasks/appointments. **§5.1(1) is
  triggered — needs Jeff's decision (see bottom).**

| # | Question | Finding (2026-07-21) | Consequence |
|---|----------|----------------------|-------------|
| 1 | Relationships/links file, or delimited link lists? | **No links file.** Only person→company as a **single company-NAME string** (`People.Company`, 98% filled) — no id, no multi-link. No opportunities/projects/notes/tasks/appointments files at all. | **§5.1(1) TRIGGERED.** Multi-linking + link-roles are NOT in this export. Identity core is importable; the richer relationship graph must come from a fuller export or be rebuilt in Peak. |
| 2 | Do roles survive? ("Participant" is on the link) | **Partially.** `Role` is a single flattened **per-person** value (50% filled, mostly blank/"Participant"), not per-relationship. | §5.2 party-role model can't be reconstructed from this export; roles get rebuilt in Peak (Phase 2). |
| 3 | Notes/activity with parent + timestamp + author? | **No.** No activity/notes file. Only free-text `Details` (7% people / 23% cos) + `Duplicate Notes` (10%). **No timestamps, no authors.** | Phase 5 timeline import not possible from this export. |
| 4 | Custom fields with labels? | **None came through.** No custom-field columns; the Daylite "Untitled Label" / "Legrand Changed" fields are **absent**. `Industry` present but 2% filled. | §8.4 settled — those custom fields were 2009 cruft; drop them. |
| 5 | Keywords / category / referred-by / owner / created-modified? | **Category 100% ✓, Owner 100% ✓.** Keywords ✗, Referred-by ✗, **created/modified dates ✗** (no timestamps anywhere). | Lifecycle + owner import cleanly. **"Added in last 7 days" (#23) can't be back-dated** — timestamps are import-time only. |
| 6 | Attachments? | **Absent.** | As expected; deferred to Drive integration (§5.7). |
| 7 | Row counts per entity | **Companies 1,550 · People 3,801.** No opportunities / projects / notes / tasks / appointments files. | Sizes the dry run; non-identity entities are out of scope for this export. |

### Extra finding — `Category` conflates two axes (relevant to #23 and #35)

`Category` (100% filled on both files) mixes **lifecycle** (Prospect / Customer-Current /
Customer-Past) with **party-type/trade**: Architect (59 people / 40 companies), Electrical
Contractor, General Contractor, Engineer, Vendor, Competitor, Consultant. The import should **split
these into two fields** (lifecycle vs. party-type) per design §8 / punch #23. **Bonus:** punch #35's
"architect" is already `Category = Architect` — not a new model.

### Link-matching note

`People.Company` (98% filled) is a company **name** that must be matched to the 1,550 company names
on import. Expect near-misses (the `Duplicate Notes` column, 10% filled, flags known dupes; 2,564
people are `Uncategorized`). The Phase 1 import needs deterministic name-matching + an
unmatched/created-anyway report.

## After the audit

1. ✅ Tool output pasted below.
2. **Review findings with Jeff; settle §5.1(1)** — links/roles/notes/opportunities/projects are not
   in this export. Decision needed (see below).
3. Only then: write the Phase 1 partial-import plan (companies, contacts, sites) per §5.6 — dry-run
   first, idempotent, reconciliation report.

### §5.1(1) DECISION FOR JEFF
The CSV/xlsx export preserves the **identity core** but loses relationships, roles, notes, and the
opportunity/project pipeline. Options:
- **(a) Import the identity core now** (people + companies + the single company link), and build the
  richer relationships/roles/timeline **fresh in Peak** going forward. Fastest; accepts that Daylite
  history beyond people/companies doesn't come across.
- **(b) Get a richer export first** (Daylite API or database-level) that carries links, roles, notes,
  and opportunities/projects — then import. Slower; preserves more history.

---

## Tool output (2026-07-21)

```
Daylite export audit — 2 file(s)
============================================================

### Companies.csv
rows: 1550 · delimiter: , · columns: 12
signals:
  ⚑ CATEGORY: category/lifecycle column → Category
  ⚑ OWNER column → Owner
columns (fill rate):
  100%  Category
  100%  Name
   75%  Phone Label 1
   75%  Phone 1
   11%  Email Label 1
   11%  Email 1
   42%  URL
   86%  City
   86%  State/Province
    2%  Industry
  100%  Owner
   23%  Details

### People.csv
rows: 3801 · delimiter: , · columns: 12
signals:
  ⚑ ROLES: link-role column ('Participant' lives on the link) → Role
  ⚑ NOTES: note/activity body column → Duplicate Notes   [false positive: "Duplicate Notes" is dedup annotation, not activity]
  ⚑ CATEGORY: category/lifecycle column → Category
  ⚑ OWNER column → Owner
columns (fill rate):
  100%  Category
   99%  First Name
   98%  Last Name
   73%  Email Label 1
   73%  Email 1
   83%  Phone Label 1
   83%  Phone 1
   98%  Company
   50%  Role
  100%  Owner
    7%  Details
   10%  Duplicate Notes

============================================================
Row counts per entity (§5.1 item 7):
  Companies.csv: 1550 rows
  People.csv: 3801 rows
```
