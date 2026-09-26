# Punch #224 (short lists on companies) and #225 (consulting proposal document fixes)

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks`. Approved in chat as presented.

Jeff (2026-09-26):

> Let's make the views on companies only show a short list and then a "show more" or Search bar
> function so you don't have to endless scroll for everything.
>
> The template for a consulting proposal can remove the top bit that says Peak Systems Group since it
> is in the header as well as the Consulting Proposal line. It does need a Dear line that has the
> Contact's name in it. I also need the PDF export option to not include links or other information
> on the top or bottom of the page. I also need the assumptions to be bullet pointed. Terms also need
> to be editable, via the terms at the bottom of the estimate — I think it is pulling in a default that
> needs to be removed. The Anticipated Phases should also be removed from the PDF. Finally the
> acceptance should just [be] the contact name, and the estimator name. Not the companies, I still
> want the date though.

## #225 — Consulting proposal (`src/app/(app)/design/engagements/letter/page.tsx`, `?kind=proposal`)
Recon (line numbers approximate):
- Header band under the letterhead: company name line (~199) and "Consulting Proposal &
  Professional Services Agreement" line (~201) → **delete both**. Keep the Quote / Customer / Venue /
  Date meta row (~203-208).
- **Dear line:** before the intro (~213): `Dear {contact?.name || "Sir or Madam"},` — the pattern in
  `repairs/letter/page.tsx` ~243/356. `contact` is already parsed (~126-129, `vars.contactName`).
- **Print without browser headers/footers:** global print CSS `@page { margin: 0.9in 1in }`
  (`src/app/globals.css` ~874-877) lets Chrome print title/URL/date in the margins. Scope a
  `@page { size: letter; margin: 0 }` to this page (in its `TOOLBAR_CSS` ~45-48 or a page-scoped
  style) and put equivalent spacing inside the sheet for print (the global rule forces
  `.pk-doc-page { padding: 0 !important }` ~826 — override it only for this document). Model: the
  inspection report `inspections/[id]/report/page.tsx` ~38. Do NOT change the global `@page`.
  No `a[href]:after` rule exists; make sure none is added.
- **Assumptions bullets:** the `<ul>` (~288-292) gets `listStyle: "disc"` + left padding (Tailwind v4
  resets lists).
- **Terms:** stop printing the template's `termsBlock` (~281). Print only the quote's own
  `consulting.terms` (the builder's Terms box, `quote/controls.tsx` ~537-545, saved
  `quote/actions.ts` ~149). Empty → omit the Terms heading and block. Leave the `termsBlock` template
  field in `src/lib/templates.ts` (~204-209) untouched but unused by the proposal (note it in a code
  comment) — removing template fields is a separate cleanup.
- **Anticipated phases:** delete the block (~244-248) from the document only.
- **Acceptance** (~296-307): keep the template `signoff` lead-in; replace the two company-name lines
  with two lines: the contact's name (`contact?.name`, fallback "Customer") and the estimator's name
  (`quote.owner`, fallback the current letter default used elsewhere, e.g. `repairs/letter` ~245),
  each labelled "{name} — signature / date".
- Assertions `#225` (source-level, the harness style): no header-band company/proposal lines; a
  `Dear ` line using the contact; the page carries a scoped `@page` margin 0; assumptions list has
  `disc`; `termsBlock` not rendered; no "Anticipated phases"; acceptance uses contact + owner, not
  `companyName`.

## #224 — Short lists on companies
- New client component `src/components/short-list.tsx`: `ShortList({ items: ReactNode[] | rows,
  initial = 5, searchText?: string[] , searchPlaceholder })` — renders the first `initial` rows and a
  "Show all N" / "Show fewer" toggle; when the row count > 10 and `searchText` is given, a filter box
  (case-insensitive substring over each row's `searchText`) appears above the list and filters across
  all rows (showing all matches). Pure helper `src/lib/short-list.ts` (`filterRows`, `visibleRows`)
  holds the logic and is tested.
- Company record (`companies/[id]/page.tsx`): Locations & venues, Communications, Activity (keep
  `FEED_CAP` 60; ShortList over the capped items, date-group headers kept with their rows),
  Projects & orders, Quotes, Site surveys, Contacts, Site visits (remove the silent `slice(0, 6)`),
  use ShortList with `initial = 5`. Server component stays a server component: rows are rendered on
  the server and passed as children/props with their search text.
- Companies directory (`companies/page.tsx`): render the first 50 sorted rows, then a "Show more"
  link that raises `?n=` by 50 (URL-driven like the existing filters; search/filters unchanged and
  apply before paging); show "Showing X of N".
- Venues (`venues/page.tsx`): replace the hard 200 cap with the same `?n=` paging (page 50).
- Assertions `#224`: pure helper behaviour; the company page no longer has `slice(0, 6)`; directory
  and venues pages page by `n`.

Gates: tsc, test:specs, eslint on changed files, `next build`.
