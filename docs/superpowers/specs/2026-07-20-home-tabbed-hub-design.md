# Home as a Tabbed Hub — Design

**Date:** 2026-07-20
**Status:** Approved by Jeff (brainstorming session 2026-07-20)
**Scope:** Fold My Queue, Calendar, and Inbox under Home as tabs. Navigation
and one shared component. No route changes, no data changes, no redirects.

**Companion specs:** `2026-07-20-design-module-consolidation-design.md` (independent,
either order) and `2026-07-20-general-dissolution-design.md`, which **amends this
spec** to add a Reports tab.

## Problem

Jeff: *"my queue, calendar and inbox can all be combined under home and
ultimately live more on the dashboard than anything."*

The header carries 10 top-level items. My Queue, Calendar, and Inbox each take
a slot, yet Home already aggregates all three — it loads the next 14 days of
agenda (`loadHomeAgenda`), renders an inbox card with needs-reply threads and
per-mailbox counts, and links into both. The dashboard is already the hub; the
nav just doesn't reflect it.

## Nav math

| Stage | Top-level items |
|-------|-----------------|
| Today | 10 — Home, My Queue, Calendar, Inbox, Consulting, Sales, Design Studio, Installs, Service, General |
| After this spec | **7** |
| After the Design consolidation too | **6** — Home, Design, Sales, Installs, Service, General |
| After General is dissolved as well | **5** — Home, Design, Sales, Installs, Service |

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| Shape | **Home with tabs** — full working surfaces survive, dashboard stays primary |
| Default tab | **Dashboard**, with a My Queue card added to it |
| Implementation | Routes stay put; a shared tab bar renders on all five |

**Rejected:** dashboard-only with card links (discoverability rests on a small
"Open inbox →" link), and folding the screens into cards entirely (would cost
real capability — email triage and the calendar month view).

## Structure

One nav entry, **Home**. A shared `HomeTabs` component renders at the top of
five existing routes:

| Tab | Route |
|-----|-------|
| Dashboard | `/` |
| My Queue | `/queue` |
| Calendar | `/calendar` |
| Inbox | `/inbox` |
| Reports | `/reports` |

> **Amended 2026-07-20** by `2026-07-20-general-dissolution-design.md`:
> Reports joins as a fifth tab. It is two business dashboards driven by URL
> state (`?view=sales|installs`), which is the same kind of thing as the
> Dashboard tab — not admin configuration, and so not a Settings item.

**Routes do not move and the screens do not merge.** Each keeps its own file
and its own data loading; they gain a tab bar. Consequences:

- `/inbox?thread=abc`, `/inbox?box=…`, `/inbox?compose=1` keep working.
- `lib/queue.ts` hrefs and every existing bookmark keep working.
- **No redirect map is needed at all** — unlike the Design consolidation.
- No file balloons, because no code moves into `page.tsx`.

`nav-data.ts` drops the `queue`, `calendar`, and `inbox` entries (and, per the
General-dissolution spec, `reports` leaves the General group); `activeKeyFor()`
maps all five paths to `home` so the Home pill stays lit.

## The Dashboard tab

Keeps its existing cards (agenda, inbox, leads, my designs, pipeline, surveys)
and **gains a My Queue card**: open item count, overdue count, the next few
items, linking into the Queue tab.

The queue is currently the only one of the three with no dashboard presence,
which is backwards given the stated goal. With Dashboard as the landing tab,
this card carries the job of surfacing anything urgent.

## Decomposing `page.tsx` (required, not optional)

`src/app/(app)/page.tsx` is **1,800 lines**. Adding a card without splitting it
makes a bad file worse, and it is the file this change touches most.

The pattern to follow is already well established here — four sibling
components exist beside `page.tsx` (verified 2026-07-20):
`home-actions.ts`, `home-calendar.tsx`, `home-my-designs.tsx`,
`home-stage-sheet.tsx`. Extraction is the house style for this screen, not a
new idea being imposed on it.

Apply it to the remaining inline cards: each becomes its own `home-*.tsx`
component beside `page.tsx`, leaving `page.tsx` as data loading plus layout.
The new My Queue card ships as `home-queue.tsx` from the start rather than
being added inline.

Scoped deliberately: only the dashboard cards, only the files this change
already touches. No reworking of what the cards do.

## Risk

Low. No data changes, no route changes, no redirects, no migrations.

- Main failure mode is the tab bar highlighting the wrong tab on nested or
  query-carrying paths.
- **Stated behavioural cost:** My Queue goes from one click to two. Jeff chose
  Dashboard as the landing tab, so the queue card must surface urgency well —
  if it does not, the queue effectively gets quieter than it was. Worth
  checking after a week of real use.
- Second cost: muscle memory for three nav items that disappear. Mitigated by
  the tabs being immediately visible on Home.

## Testing

- Active-tab resolution for all five paths, including `/inbox?thread=X`,
  `/inbox?box=Y`, `/queue?who=Z`, and `/reports?view=installs`.
- `activeKeyFor()` returns `home` for all five.
- The new My Queue card: counts (open, overdue) match `loadQueue`, empty state
  renders, link targets the Queue tab.
- Each screen still renders standalone and its existing behaviour is intact.
- `npm run test:specs` stays green.

## Out of scope

Any change to what Inbox, Calendar, My Queue, or Reports actually do.
Thinning General is now specced separately
(`2026-07-20-general-dissolution-design.md`); a Sales + Installs merge is not
currently planned.
