# Design Module Consolidation — Design

**Date:** 2026-07-20
**Status:** Approved by Jeff (brainstorming session 2026-07-20)
**Scope:** Merge the `Consulting` top-level link and the `Design Studio` group
into one **Design** module. Routes, navigation, and two new screens. No data
migration.

## Problem

The header carries **10 top-level items** — Home, My Queue, Calendar, Inbox,
Consulting, plus five groups (Sales, Design Studio, Installs, Service,
General). Jeff: *"the header is getting to be a lot."*

Underneath the nav complaint is a real structural one. A single job's work is
split across two modules:

- **Consulting** — paid engagements (`CE-####`) with phases, milestones,
  meetings, documents, markup, and bid specs.
- **Design Studio** — the budgetary design sandbox (`D-###`, promotes to
  quotes) plus the Steel Calculator, Lineset Builder, and Motor Library.

They are already coupled: `ConsultingEngagement.designIds` links engagements to
sandbox designs, and `consulting/letter?kind=spec` reads it. Both record types
also carry a `review` subdoc feeding the same Reviews queue. The pipeline
already flows design → quote → (won consulting quote) → engagement.

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| What overlaps | The **work**: a design and an engagement are one job at different stages. The calculators merely share the "Design" label. |
| Merge depth | **One module, both record types, linked.** No unified record, no data migration. |
| Calculators | Stay in the merged module — they are design tools, and it keeps the nav count down. |
| Name | **Design** — shortest label, which is the point in a crowded header. |

**Rejected:** making the engagement the container for designs (breaks
budgetary designs that support install quotes and have no engagement), and
collapsing both into one staged record (largest change, needs a migration, and
would rework the quote-spawn machinery D90 just built).

## Structure

New top-level nav group **Design**, replacing the `consulting` link and the
`designstudio` group:

| Child | Route | What it is |
|-------|-------|-----------|
| Overview | `/design` | Landing: active engagements + recent budgetary designs, side by side, each with status and next action |
| Engagements | `/design/engagements` | Today's `/consulting` list |
| Designs | `/design/designs` | Today's `/design` sandbox list (Design Estimator) |
| Steel Calculator | `/design/steel` | unchanged tool |
| Lineset Builder | `/design/lineset` | unchanged tool |
| Motor Library | `/design/motors` | unchanged tool |

Folding the Design Estimator into "Designs" completes the migration the
existing code comment in `design-studio/page.tsx` already anticipated ("The
existing Design estimator (Sales → Design) will move in here later").

Engagement sub-routes move with it: `/design/engagements/[id]`,
`/design/engagements/spec`, `/design/engagements/markup`,
`/design/engagements/letter`, `/design/engagements/quote`. Exact leaf paths may
be shortened during implementation provided every old path still redirects.

## Making the design↔engagement link first-class

This is the concrete payoff for "the work overlaps".

- Today `designIds` is a one-way array on the engagement, surfaced only inside
  the spec-package letter.
- After: an engagement's Overview lists its linked designs as navigable links,
  and a design shows which engagement (if any) it feeds. Linking and unlinking
  work from either side.
- Implementation note: the reverse lookup is derived by scanning engagements
  for the design id — no denormalized back-pointer, so the two sides cannot
  disagree.

## Routes and redirects

Every old path gets a **permanent redirect** to its new home:

- `/consulting` → `/design/engagements`
- `/consulting/[id]` → `/design/engagements/[id]` (preserving `?tab=`)
- `/consulting/spec`, `/consulting/markup`, `/consulting/letter`,
  `/consulting/quote` → their new equivalents (preserving query strings)
- `/design-studio`, `/design-studio/steel`, `/design-studio/lineset`,
  `/design-studio/motors` → `/design`, `/design/steel`, …
- old `/design` (sandbox list, including `?id=D-###`) → `/design/designs`

Redirects are required, not optional: the app is in beta use with saved
bookmarks, and in-app deep links already point at these paths from outside the
module. The full set of external referrers (verified 2026-07-20):

- `src/lib/queue.ts` — three hrefs: `/consulting/${id}`,
  `/consulting/${id}?tab=phases`, `/consulting/${id}?tab=milestones`
- `src/app/(app)/quotes/controls.tsx` — `/consulting/quote`
- `src/app/(app)/quotes/page.tsx` — `/consulting/quote?id=${id}`

These get updated in place. Redirects catch bookmarks and anything missed.
Implementation should re-run this grep rather than trusting the list above,
since more links may land before the work starts.

`activeKeyFor()` in `nav-data.ts` needs its map rewritten so every new path
lights the Design pill.

## What this deliberately does not fix

The merge takes the header from **10 items to 9**. It is worth doing for the
workflow reasons above, but it does not solve the header on its own.

Follow-on candidates, each its own discussion:

1. **Sales + Installs** — a quote becoming a project is one continuum.
2. **Thinning General** (8 items) — several are admin and belong in Settings.

Explicitly out of scope here so this change stays reviewable.

## Risk

- **No data migration.** Both record types, their stores, and the doc-store
  collections are untouched. Records cannot be damaged by this change.
- Main risk is **stale links**, covered by the redirect map.
- Second risk is **muscle memory** — "Consulting" disappears as a word in the
  nav. Mitigated by the redirect and by keeping "Engagements" as the child
  label and consulting language inside the records.

## Testing

- Redirect map: every old path (with query strings and `[id]` params) lands on
  the right new path.
- `activeKeyFor()` lights Design for all new paths.
- Both-way design↔engagement links render and navigate.
- Existing flows still pass: engagement detail tabs, phase reviews, markup,
  bid spec generation, design promote-to-quote.
- `npm run test:specs` stays green (it covers engine logic these routes call).

## Out of scope

Unified work records, changes to the quote-spawn machinery, moving the
calculators out of Design, and the follow-on nav merges listed above.
