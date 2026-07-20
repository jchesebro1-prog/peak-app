# Dissolving General — Design

**Date:** 2026-07-20
**Status:** Approved by Jeff (brainstorming session 2026-07-20)
**Scope:** Redistribute all eight General items and remove the group. Nav,
Settings structure, and one Home tab. No data changes.

**Companion specs:**
`2026-07-20-design-module-consolidation-design.md`,
`2026-07-20-home-tabbed-hub-design.md` (this spec **amends** it — see §3),
`2026-07-20-venues-directory-design.md` (phase 2).

## Result

| Stage | Top-level items |
|-------|-----------------|
| Start of this restructure | 10 |
| After Design consolidation | 9 |
| After Home tabbed hub | 6 |
| **After this spec** | **5** — Home, Design, Sales, Installs, Service |

## Where the eight items go

| Item | New home | Reasoning |
|------|----------|-----------|
| Companies | Sales | Sales owns the customer relationship |
| People | Sales | Same |
| Field Survey | Sales (→ beside Venues in phase 2) | Feeds quoting today |
| Reports | **Home tab** | A dashboard, not configuration — see §3 |
| Catalog | Settings → Admin | Price-book maintenance; the estimator has its own part picker |
| Templates | Settings → Admin | Document wording config |
| Estimating Rules | Settings → Admin | Pricing rule config |
| Import / Export | Settings → Admin | Data administration |

Resulting Sales group: Leads, Quotes, Reviews, Companies, People, Field Survey.

## Settings gains an Admin area

`/settings` is currently a single screen (`settings-client.tsx`). Four more
areas need structure, so Settings gets sectioned navigation with the existing
content (branding, team, roles) plus a new **Admin** area containing Catalog,
Templates, Estimating Rules, and Import/Export.

The four moved screens keep their routes (`/catalog`, `/templates`,
`/estimating-rules`, `/import`) and are reached from Settings; they are not
rewritten into Settings' own layout. This keeps the change to navigation
rather than a rewrite of four working screens.

## §3 — This amends the Home tabbed-hub spec

`2026-07-20-home-tabbed-hub-design.md` specifies four Home tabs. **Reports
becomes a fifth**, so the Home tab bar is:

Dashboard · My Queue · Calendar · Inbox · Reports

Rationale: Reports is two business dashboards driven by URL state
(`?view=sales|installs`), not admin configuration. Settings is where you change
how the app behaves; Reports is where you see how the business is doing.
Putting it behind the gear wheel would hide a screen worth checking weekly.

`/reports` keeps its route and gains the shared tab bar, exactly like the other
four. The Home spec has been updated so the two do not contradict each other.

## Judgment calls, stated plainly

**Sales gets crowded** — 3 children to 6. Companies, People, and (later)
Venues are genuinely cross-cutting: a service tech looking up a venue for a
flame test now navigates to "Sales", which reads oddly. The alternative is a
separate Directory group, which returns the header to 6.

Decision: accept the crowded dropdown. Dropdown length costs less than header
width, which is the problem being solved. **Revisit if the Sales dropdown
becomes hard to scan in real use.**

**Catalog is the closest call.** It is reference data as much as config. Moved
to Admin on the reasoning that the estimator carries its own part picker, so
the Catalog screen is mostly price-book maintenance. **If Jeff finds himself
browsing Catalog while quoting, it belongs back in Sales.**

## Redirects

None required for the four Settings-bound screens or Reports — every route
stays where it is; only their nav placement changes.

`activeKeyFor()` needs updating so `/companies`, `/people`, `/field-survey`
light Sales; `/reports` lights Home; and `/catalog`, `/templates`,
`/estimating-rules`, `/import` light Settings.

## Risk

Low — navigation and one new Settings layout. No routes move, no data changes,
no migrations.

Main risk is **discoverability**: four screens move behind the gear wheel. The
Admin area must list them plainly rather than hiding them under sub-tabs.

## Testing

- `activeKeyFor()` returns the right pill for all eight moved paths.
- Settings → Admin lists and links all four screens; each still renders.
- Reports renders with the Home tab bar and its `?view=` state intact.
- Sales dropdown lists all six children.
- `npm run test:specs` stays green.

## Out of scope

The Venues screen (own spec), the Sales + Installs merge (not currently
planned), and any change to what the moved screens do.
