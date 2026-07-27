# CRM Wave (①) Roadmap — 2026-07-25

Wave ① of the build order decided in
`docs/superpowers/specs/2026-07-25-remaining-items-decisions-design.md` §3.
Five plans, executed in order; each produces working, testable software on its
own. Plans are written just-in-time — each one is authored after the previous
lands, against the codebase as it then exists.

**Base-branch gate for the whole wave:** `quartzite-6-rebrand` (nav IA, brand
kit, D118 sign-on emails) must merge to `main` first. Plan 01 cites nav files
(`src/components/nav/nav-data.ts`, `Nav.tsx`) that only exist on that branch.

| # | Plan | Spec items | Status |
|---|------|-----------|--------|
| 01 | Tasks table + bell (`2026-07-25-01-crm-tasks-table.md`) | #17, item 16, quick fixes #32 + #28 comment | **BUILT & MERGED to main (`216c5ce`, 2026-07-25)** — subagent-driven, 6 tasks + final fable review; queue.ts + template-key-scoping plan gaps caught & fixed at final review |
| 02 | Boards: opportunity union + projects read-only (`2026-07-26-02-crm-boards.md`) | #18, #19 | **BUILT** (2026-07-26) — union board + filters + PO-received field + forecastAt; generic `components/board`; projects `?view=board` read-only |
| 03 | Lead → visit → survey → estimate thread (`2026-07-26-03-crm-visit-thread.md`) | #34 | **BUILT** (2026-07-26) — SiteVisit lifecycle + leadId, request/claim/schedule + invite, auto-linked survey, queue/bell surfaces, survey-gated convert (D120) |
| 04 | Customer activity timeline + real notes (`2026-07-26-04-crm-timeline-notes.md`) | #21 | **BUILT** (2026-07-26) — notes collection (migration 0010) + pure bucketed feed + customer-page Activity card w/ composer (D121) |
| 05 | Customer custom fields + Mine/All nav scoping (`2026-07-26-05-crm-fields-nav.md`) | #23, #22 | **BUILT** (2026-07-26) — customer-fields defs (Settings) + companies.custom (migration 0011) + Details authoring/display + added-7d; leads/projects `?who=` + won/lost split + My-X nav children (D122). **WAVE ① COMPLETE.** |

Known cross-plan facts discovered during 01's exploration (verified 2026-07-25):

- Domain records are **jsonb doc-collections** (`docTable()` in
  `src/db/doc-tables.ts`), not relational tables; only the identity core is
  relational. "Promote tasks to a real table" = a new doc-collection with its
  own store module.
- Leads `BoardView` (`src/app/(app)/leads/board-view.tsx`) is nearly generic
  already; plan 02 needs an injected writeback + a source discriminator
  (`L-` vs `Q-` ids) and a stage-vocabulary mapping — note quotes have **no
  "PO received" status today**; the union board's last column needs one
  (new quote status or a projects-derived pseudo-stage).
- "Forecast date" does not exist on leads — new field (plan 02).
- Survey stage `requested` **already exists** (`surveys.ts`); plan 03's work
  is SiteVisit `lifecycle` + `leadId`, the claimable open-visits queue, and
  gating `convert()` (`src/lib/stores/leads.ts:673`) on the survey.
- Notes today are inline sub-arrays (`ProjectNote`, `LeadActivity`); no
  standalone attachable note record exists (plan 04 creates one). The
  merged-feed idiom to copy is `teamActivity` in `src/app/(app)/page.tsx`.
- `companies.lifecycle` + `companies.keywords` are already stored (schema.ts)
  but never composed into `CustomerDoc` nor surfaced in UI (plan 05).
- No custom-field machinery exists anywhere (plan 05 builds from zero).
