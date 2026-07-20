# Daylite export audit — checklist (spec §5.1, Phase 0)

- **Status:** WAITING FOR THE EXPORT (Jeff pulls the Daylite CSV; audit runs
  the day it lands, **before any import code is written**)
- **Tool:** `npm run audit:daylite -- <folder-with-csvs>` (dev server must be
  stopped is NOT required — the tool reads files only, no database)
- **Design:** `2026-07-19-daylite-parity-design.md` §5.1

| # | Question | Finding (fill in) | Consequence |
|---|----------|-------------------|-------------|
| 1 | Is there a **relationships/links file**, or do rows carry delimited link lists? | | If neither: links are lost — reconsider CSV path (API or database export) |
| 2 | Do **roles survive**? "Participant" is on the link, not the record | | Gates the §5.2 party mapping |
| 3 | Do **notes/activity export** with parent record, timestamp and author? | | Gates Phase 5 timeline import |
| 4 | Do **custom fields** appear, with labels? Are "Legrand Changed" / "Untitled Label" populated or 2009 cruft? | | Settles open question §8.4 |
| 5 | Keywords, category, Referred by, owner, created/modified dates present? | | Maps to companies.keywords / lifecycle / referredBy / ownerUserId / timestamps |
| 6 | Attachments — present in any form? | | Expected absent; deferred to Drive integration (§5.7) |
| 7 | **Row counts per entity** (companies, people, opportunities, projects, notes, tasks, appointments) | | Sizes the reconciliation report + dry run |

## After the audit

1. Paste the tool's output below this line.
2. Review findings with Jeff; settle §5.1(1) if links are missing.
3. Only then: write the Phase 1 partial-import plan (companies, contacts,
   sites) per §5.6 — dry-run first, idempotent, reconciliation report.

---

*(audit output goes here)*
