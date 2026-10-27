<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Quartzite — production rebuild

Production rebuild of the Peak Systems Group business app. The design +
data-model spec is the HTML prototype in
`/Users/sm/Downloads/design_handoff_claude_code/` — its `app/*.js` store
modules are authoritative for field names, lifecycles, and pricing math;
its `.dc.html` screens + `screenshots/` are the pixel spec. Extracted,
verified UI/architecture specs live in `docs/specs/*.json`.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4) — UI + server API
- **Drizzle ORM** on Postgres — prod: `DATABASE_URL` (Neon); dev: embedded
  PGlite in `.data/` (auto-created, auto-migrated, auto-seeded)
- **Auth.js v5** — Google SSO; `users` table = invite list; JWT sessions
  with per-request role refresh; dev sign-in picker via `AUTH_DEV_LOGIN`
- Deploy target: **Vercel + Neon** (see DEPLOY.md) — but host-agnostic

## Run

```bash
npm run dev        # http://localhost:3000 — no DB setup needed (PGlite)
npm run build      # applies prod migrations + the one-time spec seed when DATABASE_URL is set, then builds
npm run db:seed    # idempotent fixtures (roster + settings)
npm run specs:seed # one-time North HS spec seed into LOCAL PGlite only (stop dev first; -- --force re-runs locally; prod runs it in build, D358)
npm run db:generate     # new migration after editing src/db/schema.ts
npm run db:reset-local  # wipe local PGlite + reseed
```

Node lives at `~/.local/node/bin` on this machine (in `~/.zprofile` PATH).

### The dev database is single-process — never open it twice

PGlite is **one process at a time**, and opening it *writes* (`migrate()` runs
on every open). Two processes on `.data/pglite` corrupt it. This destroyed the
dev DB three times: `.data-corrupt-20260719`, `-20260719b`, `-20260724`.

- **Never leave a `tsx` script (seed/import/audit) running.** A hung
  `tmp-seed-*.ts` holding the DB is what made the app return
  `500 — A server error occurred` on every page on 2026-07-24. Check with
  `ps aux | grep tsx` and stop strays before starting the dev server.
- **Never run a db script while another may still be alive** — retrying a slow
  seed once spawned nine concurrent PGlite processes.
- `npm run build` is **safe as of 2026-07-24**: `next build` fans out over ~7
  worker processes, and each one used to open the dev DB. `src/db/index.ts` now
  gives every worker a throwaway datadir during `phase-production-build`. Hosted
  builds set `DATABASE_URL` and never take that path.
- Before any recovery, **copy `.data` aside first** (`.data-backup-<date>/`) —
  that snapshot is what made 2026-07-24 a restore instead of a reseed.

## Conventions

- **Port faithfully.** Keep the prototype's field names, id formats
  (`u1`, `Q-2041`, `FT-3001`…), lifecycles, and copy. Timestamps are
  epoch-ms numbers. Deviations get a DECISIONS.md entry.
- **Design tokens** are CSS variables in `src/app/globals.css` (`pk-*`
  component classes). Fonts: Public Sans (UI) + IBM Plex Mono
  (badges/emails/counts) via next/font. Accent is user-configurable
  (Settings → Branding) and flows through `--accent` set on `<html>` in the
  root layout — never hardcode accent-colored UI.
- **Nav shell:** `src/components/nav/Nav.tsx` + route map in
  `nav-data.ts`. The prototype's `active` keys are preserved; new screens
  replace their placeholder `page.tsx` under `src/app/(app)/`.
- **Auth:** `requireUser()` / `requirePerm(perm)` from `src/lib/session.ts`
  in every server component/action that touches data. Permissions come from
  `src/lib/team.ts` (`ROLE_PERMS` — port of team.js).
- **DB:** schema in `src/db/schema.ts`; after editing run
  `npm run db:generate` and commit the `drizzle/` output. Dev applies
  migrations automatically at startup; prod applies them in the build step.
- **Stores → tables:** as Phase 2 lands, each prototype store becomes a
  table + `src/lib/<store>.ts` module mirroring the store's public API
  (see docs/specs/sync-architecture.json for the seam contract, id
  conventions, and the recommended JSONB-document shape with promoted hot
  columns).
- Client components only where interactivity requires; server actions for
  mutations; `revalidatePath` + `router.refresh()` replaces the prototype's
  `rss-*` events.

## Environment (.env.local / Vercel env)

`AUTH_SECRET` (required) · `DATABASE_URL` (prod) · `AUTH_GOOGLE_ID` +
`AUTH_GOOGLE_SECRET` (Google SSO) · `AUTH_DEV_LOGIN` (never in prod).
See `.env.example`.

## Phase status

1. ✅ Scaffold, DB, Google SSO + invite list, team/roles port, nav shell,
   Settings (branding/team/roles), deploy-ready config (DEPLOY.md)
2. ✅ Core data stores + seed fixtures (all 11 collections + pricing/rates/
   catalog; doc-store + sync push/pull endpoints; live nav badges + to-do bell)
3. ✅ Sales screens (Home, Leads board/worklist/table + drawer + public
   intake, Quotes, Reviews, Estimator + 3 configurators, Quick Design,
   Design, Inbox email client, ⌘K global search)
4. ✅ Service screens — Flame Tests suite (dashboard, scheduler, results,
   auto-priced quote builder, letter, report w/ letter/summary/certificate
   variants); Repairs (dashboard, scheduler, results, flagged-from-inspections
   intake, warranty follow-ups); Inspections (inbox, capture editor with
   rubric/measurements/issue-library/findings, client report). Won repair
   quotes now auto-spawn repair jobs. Open follow-ups logged in MASTER-QUESTIONS
   F9–F11, G1.
   ✅ IDEAS #44 completion (Jul 12): Repairs gained the auto-priced quote
   builder + proposal letter + service report (letter/summary/report variants
   + options canvas); Inspections gained the full flame-style suite — pricing
   engine + Estimating Rules group, auto-priced quote builder + letter,
   accepted-quote spawn (one requested record per venue), scheduler,
   dashboard (KPIs/renewals/map/by-status), L1-annual/L2-five-year renewals,
   and a report-options canvas. Quotes hub: type badges + per-type edit
   links + all three service quotes on "+ New quote". Decisions D51–D55;
   follow-ups MASTER-QUESTIONS F12–F14.
   ✅ Wave 2 (Jul 12): quotes-hub type filter (#22), flame day-of "Log
   results" day sheet at /flame-tests/today (#34), renewal outreach
   worklists on both service dashboards (#37), and logo upload → nav +
   all documents (#32). Decisions D56–D59.
   ✅ Customer portal phase 1 (#47, Jul 12): /portal with per-person
   magic-link grants (managed from the customer record), hard tenant
   scoping outside the team login, published-quotes + venue-compliance
   dashboard, and a quote-request form that lands in the Leads SLA queue
   pre-linked to the customer. Decisions D60–D63; picks F15–F16.
   ✅ One-click renewal outreach (#36, Jul 12): the renewal-row ✉ on both
   service dashboards re-prices this year's quote at current rates over
   last year's scope (F8 updated per Jeff — D69), renders the proposal
   letter to PDF (lib/pdf.ts, zero-dep) and attaches it, lands a linked
   draft in the Sales box whose body cites last year's price + why it
   changed, and opens the Inbox composer (/inbox?draft=); sending stamps
   the #37 outreach state + quote → sent. Real attachments across
   comms/composer/reader/Gmail-MIME. Decisions D65–D69; follow-ups
   MASTER-QUESTIONS F17–F18.
5. ✅ Installs + General — Projects (book + procurement/crew/timeline/sign-off),
   Schedule (crew board + project timeline), Field Work (on-site day view),
   Customers (directory + full customer record), Field Survey (list + capture
   editor), Catalog (browse + price-book import), Import/Export (per-type CSV),
   Reports (Sales + Installs dashboards), Estimating Rules (rate/formula editor),
   full Settings (Locations) + Account (to-do notifications). Deviations logged
   in MASTER-QUESTIONS H2–H3, J1–J7.
6. ✅ Offline field capture — installable PWA (`manifest.webmanifest` +
   `public/sw.js` shell cache), a durable IndexedDB outbox + client SyncEngine
   (`src/lib/sync/`) flushing to the existing `/api/sync/push`+`/pull`, live
   Nav sync chip + "Work offline" toggle. Capture editors (Field Survey,
   Inspections, Flame/Repair results, Field Work) save through the outbox seam
   and sync on reconnect. Decisions D26–D32; deviations in MASTER-QUESTIONS.
7. ✅ Gmail integration — env-gated bridge replacing the comms
   `deliverMessage()`/`checkMail()` seam. Own OAuth flow (`/api/gmail/connect`
   + `/callback`) reusing the Auth.js Google client with Gmail scopes;
   per-mailbox tokens (encrypted) in the new `gmail_connections` table;
   `lib/gmail/*` sends via Gmail (lands in Sent) and imports 90 days + polls
   incrementally; Settings → Mailboxes connects personal + shared boxes. Inert
   unless `GMAIL_ENABLED=true`. Decisions D33–D37; follow-ups MASTER-QUESTIONS
   C7–C9.
8. ✅ AI features — env-gated Anthropic layer (renewal drafts, thread/customer
   summaries, import extraction, quote scope/line drafting, an "ask your
   business data" assistant). Decisions D38–D42. **Removed 2026-07-19 (D89) —
   the app is fully deterministic, no `ANTHROPIC_API_KEY` anywhere; renewal
   drafts and scope assembly are rules-based (D75/D86).** D89 stays — its
   deletions are not coming back — but Assist (#334, D869–D880, phase 53)
   reintroduces opt-in model calls behind a gate, and Ask AI (#339, D943,
   phase 58) is a fresh, read-and-propose assistant built on it.
9. ✅ Data migration + go-live (tooling) — the Import/Export hub (per-type
   templates, dedupe, paste + AI extraction, preview→confirm), a
   `Clear demo data (go-live)` reset (Settings → Beta) that wipes demo records
   but keeps team/settings/rates, and `npm run db:export` full backup. Guide +
   cutover checklist in MASTER-HOWTO §7. Decisions D43–D46. Remaining is
   Jeff-gated: real source files (MASTER-QUESTIONS §I) + hosting accounts
   (item A / DEPLOY.md), then a real-data dry run.

10. 🚧 **The Grid** (D108, D109) — the DaVinci-style system designer under
   Design (`/design/grid`): plan-sheet upload (PDF/image), scale calibration,
   click-to-paint catalog devices, live BOM → draft quote (`source: "grid"`).
   Phase 2 (D109): **Spaces** (room polygons; per-space BOM rollups with
   computed smallest-wins assignment) + **project revisions** (append-only,
   auto-cut on quote, non-destructive restore). Phase 3 (D110): **wire
   routing** — per-length catalog parts routed as measured polylines
   (calibration-gated, aspect stamped per route, footage ceiling-rounded
   per part into BOM + quote). Phase 4 (D111): grid quotes feed the **D94
   bid-spec generator** (flat `spec.lines` support + editor link via the
   customer's engagement). Phase 5 v1 (D112): **derived riser sketch** at
   `/design/grid/<id>/riser`. Roadmap in memory
   `projects/peak-system-designer.md`; what remains is Jeff-gated data/infra
   (symbol+datasheet metadata, palette seeding, blob storage). Suite renamed
   **Quartzite** (D107) alongside slice 1.
   ✅ Drawing set + editable riser (#209, Sep 25): a title-blocked drawing set
   at `/design/grid/<id>/set` — T-001 cover (sheet index, symbol legend,
   general notes), one plan sheet per system per source page (L/A/V/R, plus
   G-101 for unscoped devices) with a calibration-derived scale note, E-501
   riser, paginated E-60x equipment schedules — printed at 11×17 or 24×36
   through the shared `PrintButton`. The riser gained + Device, Space,
   Connect (a measured route or a typed RiserLink that prices like one),
   Conduit (annotation, never priced), draggable level lines and numbered
   notes, backed by a capped, server-canonicalized per-option riser document
   that revisions and option copies carry; its legend now builds from
   current placements. `/schedule` now names Grid-library parts and lists
   RiserLinks alongside routed wire runs. Decisions D287–D293.
11. ✅ **Consulting project management** (#145, D164–D172, D178, D175–D177) —
    task templates gain a phase/discipline scope and proportional %/%
    scheduling within phase windows; a pure scheduling engine
    (`src/lib/consulting-schedule.ts`) generates a consulting engagement's
    task dates and locked milestones from `startAt`/`endAt` and admin-set
    phase weights; a per-engagement Schedule tab (Gantt, drag, overrun
    flag, milestone-shift dialog) and one Activity tab (note + files +
    tasks in a single linked capture, with Krisp pre-fill); `/task-templates`
    CSV import/export through the existing Import hub; `/schedule` becomes
    editable and gains consulting rows plus a By-person portfolio view
    across consulting and install work alike. Install `Projects` keep their
    own stage-keyed template scheme untouched (D172) — reachable later
    through the same engine's seam. Remaining is Jeff-gated: real phase-
    weight values, first template-set content, the Drive mailbox backing
    engagement files, and Drive folder naming (PUNCHLIST #145).
12. ✅ **Daylite pipelines + history import** (#187, D236–D243) — project
    and system-quote stages are Daylite-named pipelines edited in Settings →
    Pipelines (`src/lib/pipelines.ts`); code reads a fixed stage **tag**,
    never a stage id or label. Install runs Deposit/PO received → … →
    Invoice → Complete (sign-off lands at Invoice, Complete is manual);
    quotes stop at Won, stage tag = status. Legacy stage keys convert at
    read time. UKN marks unknown job values. `/import/daylite` imports
    Daylite project/opportunity history (`src/lib/daylite/`) and
    supersedes the July script, which now imports identity only.
    Remaining: Jeff's production run (#191), follow-ups #188–#192, O1.
13. ✅ **Specs module** (#205, D254–D261, D329–D332) — Phase A (library):
    a pure outline text engine (`src/lib/specs/outline.ts`); three new
    collections (`spec_articles`, `spec_templates`, `spec_curtain_templates`)
    alongside an upgraded `spec_sections`; canonical spec fields on
    `CatalogPart` written only through `mergeUpsert`, adopting (never
    overwriting) the pre-existing Displays research metadata; a Spec panel
    in the catalog part editor, visible to anyone with `create`, with a live
    outline preview; the library index + section/template editors under
    `/design/specs`; starter formulas and curtain templates that auto-seed
    on any environment; library JSON export/import outside the columnar
    Import hub; and the catalog importer carrying the same spec columns,
    exact-header-only, gating drafts everywhere a spec prints, including the
    external Displays API. The North HS seed shipped Sep 26 (D326–D327): six
    sections' Part 1/3 + Part 2 category headers, job text as fill-ins,
    `scripts/specs-seed-northhs.py` → `docs/specs-seed/northhs-2026-07-30/`;
    its product-specs template loads back by MFR # at
    `/design/specs/library/product-specs` (D328, matched parts only).
    Phase B (D329–D332): a builder at `/design/specs` assembles a real,
    editable Word spec — one CSI section per file, saved as `spec_documents`
    (`SP-####`) reading Parts 1/3 live from the library; a fill-in form per
    `[FILL IN: …]` blank; a product picker (approved-spec parts by default,
    "Show all catalog parts" to author spec text onto a part on the spot);
    a checklist of left-out products that warns without blocking; quantities
    from a BOM behind Print quantities (off by default); and a Word download
    with one real multi-level numbering definition that renumbers itself
    when edited in Word. Quotes hub, the Grid editor and the consulting
    engagement all open the new builder instead of the D94 generator's old
    entry points; old saved D94 specs stay viewable at
    `/design/engagements/spec/[id]`. Remaining: the `spec-writer` skill,
    Grid curtains via curtain templates, a zip of several sections, and a
    real-Word numbering check on Jeff's machine. Decisions D254–D261,
    D329–D332; punch #205.
14. ✅ **Part documents** (#207, D270–D280) — datasheets and spec sheets are
    shared `part_documents` records linked to many parts through
    `part_document_links`, with accessory coverage computed in context from
    a fixture → accessory graph (`part_accessory_links`), DaVinci's model.
    **Catalog → Datasheets** (`/catalog/documents`) is the to-do list of
    every quoted part's Datasheet/Spec sheet slots (drop zones, Also
    covers…, filters, bulk Fetch/Mark not needed/Attach existing) plus
    **Upload many** (`/catalog/documents/upload`, filename matching);
    direct-to-Blob uploads (25 MB, magic-byte checked); fetch from
    manufacturer links through the shared `guardedFetchBytes` SSRF guard
    (`src/lib/venue-calendar-fetch.ts`), batched under a 45 s budget and
    resumable; the part editor's Documents section (anyone signed in)
    replaces the old admin-only single-datasheet control; the Assembly
    Builder feeds the accessory graph with per-member coverage and a
    has-its-own-datasheet toggle; a DaVinci pre-fill (admin/CLI) links
    English ETC datasheets by URL, no files downloaded; Specs coverage,
    client packages, and the Displays API (`publicDatasheets`) all read the
    one coverage rule. Closes #40 (a) and the population half of (c).
    Remaining is Jeff-gated: run the DaVinci pre-fill + link fetch on
    production, verify Blob upload on a preview deploy. Decisions
    D270–D280; punch item #207.
15. ✅ **Flights over drive** (#208, D281–D286) — a pure planner
    (`src/lib/travel-plan.ts`) prices flights instead of a drive once one
    trip's drive cost reaches a threshold (default $1,000), applied
    everywhere a flame-test, repair or inspection quote is priced: the
    three engines, their builder previews, save actions and renewal
    re-pricing. Auto · Drive · Fly override with editable crew / nights /
    airfare per quote; new Estimating Rules for the fly allowances and each
    service's default flying crew. Customer letters, quote documents and
    renewal PDFs print one "Travel (air, lodging & per diem)" line; renewals
    carry last year's travel choice, not its airfare, and call out a mode
    flip. Not in scope: the Estimator, rentals, consulting, live airfare
    lookup, per-venue split trips. Decisions D281–D286; punch item
    #208.
16. ✅ **One fixture builder** (#210, D294–D300) — the Assembly
    Builder's two tabs merged: one `FixtureRecord` type (Fixture or
    System) in the existing `subassemblies` doc table
    (`src/lib/stores/fixtures.ts`; pure model, `resolveFixture` and save
    rules in `src/lib/fixture-assemblies.ts`), one list + form at
    `/design/assemblies`, Assemblies pricing (live cost + sell, per-line
    override, qty 0 = optional add-on). A one-time, idempotent conversion
    (`src/lib/fixtures-migrate.ts`, `npm run fixtures:convert`) keeps
    `fa-…`/`SA-…` ids, leaves `settings.fixtureAssemblies` as a backup,
    and moves the accessory graph to one `fixture:<id>` scope. Estimator
    and Quick Design read fixtures through `allAssembliesFrom()` with
    identical totals. Remaining is Jeff-gated: run the conversion on
    production and review any "needs review" fixtures. Decisions
    D294–D300; punch item #210.
17. ✅ **Grid Equipment map + one intake** (#211, D301…D325) — every
    equation item (`src/lib/design/equipment-vocab.ts`, 46 `system:itemKey`
    rows) × tier maps to a catalog part, a fixture/System assembly or a
    confirmed allowance in Grid Settings → Equipment map (blob
    `grid_equipment_map`, `src/lib/design/equipment-map.ts`); the estimate
    engine carries no dollars — `src/lib/design/equipment-pricing.ts` is the
    only pricing step, and Grid Scope targets are computed server-side,
    sell-only. An incomplete estimate reads "Incomplete — N items need a
    part" instead of a bare dollar total, and Add to Quotes refuses until
    every line is priced — re-checked on the server on every promote path,
    including Home and designs saved before #211 (D319); the server
    derives a Quick design's budget too and quotes its own figure (D323). New design opens one intake — Auto (equations) or
    Blank — and Auto fills the base sheet by rule (`grid-auto-layout.ts`,
    `grid-auto-fill.ts`) with ordinary placements (lots carry `qty`;
    assemblies/allowances are virtual `asm:`/`allow:` parts, tier-priced like
    any Grid part, and a dead one refuses the quote by name; `auto` tag
    cleared by any hand edit; "Change equipment…" re-fills one scope; a
    failed fill opens the plan with a warning instead of losing the intake).
    Remaining is Jeff-gated: the map starts empty, so mapping the rows in
    Grid Settings → Equipment map is what turns "Incomplete" into a real
    estimate. Punch item #211.
18. ✅ **Sep 26 punch — Batch 1** (#212–#215, #219, #221, #224, #225,
    D333–D357) — a Grid Equipment-map allowance can carry a customer-facing
    description, and a design gains per-design custom items priced through
    the allowance path (spec.lines still print on no customer document —
    flagged, not fixed here); Catalog joins the Estimating nav group;
    Inbox gains a Link popup off each message — multi-person linking from
    From/To/Cc, one search across companies/venues/people, and a
    deterministic signature reader that pre-fills a new contact or offers
    to fill a known one's blanks — with the sidebar reduced to a read-only
    summary; tasks created from an email carry contact/customer/site/lead/
    thread links and, together with queue assignments, now place on
    `/calendar` (due day, or floating "carried"/"overdue" until done or
    deleted, Mine/Everyone toggle); `/import/daylite/calendar` imports
    Daylite's calendar history into each owner's own connected Google
    Calendar (one-offs only, repeating series skipped, deterministic event
    ids); every quote link now opens that quote's own builder instead of
    defaulting to the Estimator; company records and the companies/venues
    directories page instead of endless-scrolling; and the consulting
    proposal document drops its boilerplate header lines, gains a Dear
    line and bulleted assumptions, and prints a clean PDF with the quote's
    own terms and a contact + estimator acceptance.
    ✅ **Batch 2** (Sep 27, #216–#218, #220, #222, #223, #226–#233,
    D359–D394) — venue types become an editable list (Gym Stage seeded;
    each type "works like" a built-in kind), venue names derive as
    "Location — Type" (`sites.name_auto`, migration 0028) and one venue
    edits in its own dialog; flame/repair/inspection totals round to $25
    (floors round up), take a typed total that back-solves the margin, and
    flame testing cost is editable per venue, with renewals re-pricing and
    rounding; a `documents` collection (migration 0029) puts company/venue/
    project files in private Blob with checked direct uploads,
    attachment-only downloads and editable categories, shared both ways
    through the portal ("Send us files", a bell for new customer uploads);
    every Estimator and service-letter save renders a real headless-Chrome
    PDF (`src/lib/quote-pdf/`, signed print routes, `QUOTE_PDF_ORIGIN`)
    that the customer preview shows and the portal serves (sent copies
    only), and the portal lists all app-era estimates (Open/History) plus
    project history; every quote and lead carries an estimate number from
    one counter at 1001 (EST/FLM/RIG/REP/RNT/CON/OPP, a lead's number
    carries, `-2`/`-3` suffixes; migration 0030 renumbered everything,
    Daylite history first) while internal ids stay unchanged and
    searchable; the Grid groups parts by 25 curated device types
    (Catalog → Device types, auto-applied confident matches, a palette with
    Favorites/Recent/type chips/manufacturer filter); fabric prices by one
    flat $/sq ft of fabric plus a sewing adder in the estimators (10 %,
    Estimating Rules); and Grid packages gain Hardware
    assemblies, a "Not included" Equipment-map cell, a BOM grouped by
    heading with "+ Add accessory", wire pull (runs 0 = off) and labor as a
    % of material × tier, plus the equipment relabels with Cable Package
    moved to Lighting and sized by fixtures × per fixture × tier; Inbox
    linking moved from the Link popup into the reader's sidebar (#240). Remaining is Jeff-gated: set `QUOTE_PDF_ORIGIN` in
    production, map Cable Package (per cable)
    and the Wire pull rows, set wire-pull runs, and review the device-type
    mappings (PUNCHLIST #234–#240).
19. ✅ **Portal Catalog** (#245, D402–D417) — closes MASTER-QUESTIONS S19.
    `/portal/catalog` replaces "Estimate" in the portal nav: search +
    Manufacturer/Category facets, a "quoted before" shelf, a part sidebar
    (image gallery, price or Price on request, inline documents via
    `/portal/catalog/doc/[id]`, spec text, Goes-with accessories, Ask a
    question) that becomes a fixture configurator (included parts + toggle
    add-ons) or a no-price curtain request panel. Images join datasheets/
    spec sheets as a third `part_documents` kind (upload, URL fetch, admin
    datasheet-thumbnail render), with a per-part Auto/Show/Hide visibility
    rule and a computed browsable rule gating the bare landing grid.
    Server-only pricing (`src/lib/portal-pricing.ts`) and a new
    freight-by-distance rule (also the Estimator's own new-section
    default) feed a `portal_carts` collection — one cart per grant, no
    prices stored, no estimate number until **Generate** — which sends
    firm quotes (30-day validity, a named approval-gate bypass) or lands
    review quotes (any curtain or price-on-request line) as derived
    "Portal quotes to review" / "New portal quotes" bell groups, no lead
    record. Accept carries purchase method/notes (card-number guarded) +
    an optional PO file; expiry gives way to Refresh pricing as a new
    revision; staff Approve/Decline sits in a new Estimator Portal panel.
    Remaining is Jeff-gated: run the datasheet-thumbnail render on
    production, upload hero images, review Hide/Show and the Labor
    category list, and try the flow with a real customer grant. Decisions
    D402–D417; punch item #245.
20. ✅ **Portal service quotes** (#248, D420–D428) — customers generate firm,
    numbered flame-test and inspection (L1 annual / L2 five-year) quotes for
    one or more of their own venues at `/portal/service`, priced by the same
    engines and a shared venue-input helper (`src/lib/service-quote-inputs.ts`)
    the staff builders now use too — tier margin, live rates, travel Auto,
    $25 rounding, no overrides, sell-only per-venue lines + one Travel line +
    total. Venue counts pre-fill from each venue's latest completed
    job/record, else its latest quote of that type (inspections
    level-specific), else the customer enters it; several venues price as one
    shared trip. Repairs stay a request (no priced repair library) via the
    existing pre-filled `/portal/request` form. Source `portal-service` with
    the real `quoteType` reuses #245's whole lifecycle firm-only —
    `sendPortalFirm`, 30-day validity, Accept/Decline, Refresh pricing as a
    new revision re-priced at the quote's own customer and tier — with no
    review state (service pricing is never price-on-request) and a
    staff-recalled draft no longer listed to the customer. Entry points: nav
    Service, the compliance card's "Get a service quote" / per-chip "Quote
    it" / per-venue "Request a repair", and "Quote again" on any listed
    flame/inspection quote row. Staff get the shared Portal panel on both
    service builders — Approve runs the builder's own engine-owned approve
    for a still-`sent`, not-yet-accepted quote; an already-accepted quote
    approves at the accepted price with no re-persist, spawning the
    job/record either way — plus a per-row Portal chip in the Quotes hub,
    bell and company-activity coverage. Remaining is Jeff-gated: try the flow
    with a real grant, check a multi-venue portal quote against the builder,
    confirm letters on a real render. Decisions D420–D428, D429–D430; punch
    item #248.
21. ✅ **Venue background templates** (#249, D431–D436) — Jeff's Vectorworks
    Auditorium/PAC drawing (`docs/venue-templates/source/proscenium.dwg`),
    converted by `scripts/venue-template-convert.py` into
    `src/lib/design/venue-templates/proscenium.json` and stretched by a pure
    engine (`stretch.ts` + hand-written `proscenium.keys.ts`) to pro width,
    wings, stage depth and new house width / house depth fields — walls stay
    6", the pit follows the pit switch. One template-backed `prosGeom()`
    draws every proscenium plan (Grid base sheet, Quick Design, saved
    Designs); its labeled areas become the base sheet's starter Spaces and
    Auto fill hangs front lights on the catwalk and subs on the stage edge.
    Quick Design drags the house walls; proscenium doors are gone. Grid
    sheets drawn before #249 keep their Auto-fill frame
    (`intake.baseSheetTemplate`, `legacy-pros-geom.ts`). Remaining is
    Jeff-gated: DWGs for the other venue types (church, gym stage, black box,
    conference, arena). Punch item #249.
22. ✅ **Portal curtain configurator** (#250, D437–D440) — the portal
    catalog's "Request curtain pricing" panel is a priced configurator: the
    same inputs (name, fabric, qty, width, height, fullness) now show a
    live "$X each · $Y total", computed server-side (debounced
    `priceCurtainOptions`) through the Estimator's own curtain math
    (`curtainCost`/`curtainPrice` at the customer's tier margin, live
    sewing %) — a portal curtain opened in the Estimator shows the same
    number. A priced curtain line still carries a `review` flag distinct
    from price-on-request (staff SpecItem `portalConfirm`), so the quote
    stays a Peak-review quote — now possibly fully priced — until it's
    actually sent; the staff banner and cart copy name which of POR/
    curtain-confirm still blocks sending. "Not sure — recommend one" (or
    any fabric the index can't price) still lands price-on-request,
    unchanged. Remaining is Jeff-gated: try a curtain in the portal with a
    real grant and compare against the Estimator. Punch item #250.
23. ✅ **Portal department tree** (#252, D442–D445) — staff group catalog
    categories into named departments at Catalog → Departments
    (`/catalog/departments`, admin-only, one settings blob
    `portal_departments`, stable slug ids, a category in at most one
    department, "other" reserved); the portal catalog landing
    (`/portal/catalog`) shows a tile per department plus an automatic
    unstored Other (hidden when empty) — count of browsable items, a
    top-ranked-part thumbnail — and `?dept=<id>` scopes results, the
    Category facet and search itself to that department, with a breadcrumb
    and a "Search all departments" link on a dead-end search. Additive: a
    shop with no departments configured browses exactly as before. The
    editor is one Department `<select>` per catalog category (including the
    "Fixture assemblies" pseudo-category), not a checklist, so a
    double-assignment is structurally impossible; "Start from suggestions"
    (Rigging/Lighting/Cable & Connectors/Atmospherics/Hardware/Drapery)
    shows whenever the draft list is empty. Remaining is Jeff-gated: nothing
    shows in the portal until departments are actually set up. Punch item
    #252.
24. ✅ **Spec Library records** (#253, D446–D456) — Jeff's Spec Library
    v1 (46 individually-written specs) becomes `spec_records` + append-only
    `spec_record_revisions` (migration 0033; one write path
    `saveSpecRecord`, Restore = a new revision, kept by the go-live wipe),
    matched to BOM rows by pinned id → exact part number → `#` wildcard
    (one digit 1–5) → system match key → legacy catalog text → no match
    with candidates (`src/lib/specs/record-match.ts`); one part number →
    one ready record. The builder prints matched records under their Part 2
    article (companions once, a sixth outline level "(1)", `[bracket]` job
    values keyed `${specId}#n`, a final ITEMS NOT SPECIFIED article for
    waived rows), offers Link / Write new (saves `ready`) / Waive / Pin and
    project-only overrides vs. library updates, and flags "Library changed
    since your last download" from a per-download stamp; saved specs read
    the library live. Records are the default view of
    `/design/specs/library` (old content at `?view=sections`) with an
    editor, revision history, server-allocated `PS-…` ids and Import /
    Export .xlsx in the workbook's own layout (plus
    `scripts/import-spec-library.ts`). A Spec select sets `specKey` at the
    source on estimator custom/curtain lines, the custom-part form and the
    Grid curtain dialog ("Auto: …" shows the derived curtain key).
    Remaining is Jeff-gated: import the v1 library on production after
    `npm run db:export`, Part 1/3 boilerplate, Parking-lot specs. Punch
    item #253.
25. ✅ **Venue templates II** (#255, D458–D467) — four more of Jeff's
    drawings plus the arena, each converted once (a per-kind label overlay
    names the rooms, since the DWGs carry no text) and stretched by the one
    generalised engine (`stretch.ts` + a `<kind>.keys.ts` each): Church
    Traditional and Contemporary (platform = width/depth, the nave via the
    house fields; pews by code; church doors retired), Gym Stage (the
    `gymstage` type and Quick Design's Gym Stage, mapped like the
    proscenium), Blackbox (Black Box and Conference) and a new Quick Design
    Arena venue (even bowl, 13' round corners, a code-drawn end stage Auto
    fill turns with). Settings → Venue types gains an admin-only
    **Background** column (registry `src/lib/design/venue-templates/
    index.ts`, versioned ids); a plan draws the design's override
    (`templateId`) ?? its venue type's Background (`venueType`) ?? the kind
    default. **Movable rooms** (Gym Stage Booth, the Blackbox's four rooms,
    the Arena's Booth, Electrical Room and stage) drag in Quick Design, have
    fields on the intake, are sanitized server-side and stamped on Grid
    sheets (`intake.baseSheetMovables`); the FOH mix follows the Booth.
    Unstamped Grid sheets keep their old Auto-fill frame. Remaining is
    Jeff-gated: review the renders (`docs/venue-templates/renders/`), the
    arena corner radius and the Contemporary back-wall rule. Follow-ups
    #256–#260. Punch item #255.
26. ✅ **Catalog photos** (#283, D507–D510) — every catalog image is
    shrunk to ≤1600 px WebP q80 on the way in (`src/lib/part-docs/shrink.ts`,
    sharp; attach/replace, Add image from URL, Drive, datasheet thumbnails;
    image cap 25 MB; HEIC refuses). A read-only `drive.readonly` sync
    (`src/lib/google/drive-photos.ts`, `drive-photo-plan.ts`,
    `drive-photo-sync.ts`) attaches the "Peak Product Photos" folder to parts
    by the Upload-many filename rule — unmatched listed, never guessed; a
    Drive delete keeps the app copy; source `Drive`. Runs from Sync now
    (Catalog → Datasheets) and a rider on the daily Gmail cron; Enable Drive
    photos + account picker in Settings → Mailboxes. Remaining is Jeff-gated:
    add `drive.readonly` to the OAuth consent screen, create the folder,
    enable + pick the account, Sync now. Punch item #283.

27. ✅ **Estimate submit-for-approval** (#284, D517–D520) — one
    `QuoteNextStep` control (Estimator toolbar, Quotes hub, phone preview)
    replaces the collapsible review bar: Submit / Resubmit for approval,
    Approve · Send back…, Send to customer →, Withdraw, with a status pill
    and a gate-banner button; Claim is gone for quotes. A submission goes to
    every approver (approving claims implicitly; bell, to-dos and Home read
    `src/lib/quote-approval-rules.ts`); an owner holding `approve`
    self-approves on send (`method: "self"`); an approval goes stale when the
    gross sell or priced line set changes (`approvedAgainst`,
    `src/lib/approval-snapshot.ts`). Remaining is Jeff-gated: Settings → Team
    — who holds `approve` now decides who skips review. Punch item #284.
    ✅ Follow-up (#287, D523–D524): an approver can send any quote — Send to
    customer →, Approve & send (version-checked under the row lock) or ⋯
    Approve only on a draft — anyone with `create` can submit (the submitter
    can withdraw), and the Estimator gains Lead estimator (= `owner`; take
    over yourself, only an approver hands off) and Prepared by (= `preparedBy`,
    printed on the customer document and the hub row). Open: freeze both at
    send? Punch item #287.

28. ✅ **Portal quote names, My quotes, Portal quotes queue** (#288,
    D525–D528) — customers name a quote at Generate (default "<venue> —
    <date>", Chicago date, 120-char cap, service "+ N more") and rename it
    until accepted (30/h, PDF re-rendered); `/portal/my-quotes` lists the
    customer-built quotes (Open/Accepted/Closed), Home only Peak-sent ones,
    nav Home · Catalog · Service · My quotes · Cart. Staff
    `/quotes/portal` (Estimating → Portal quotes) is the work queue —
    status/type chips, search, Needs action default, Approve/Decline through
    the existing actions, bell links focus the row. Peak-sent acceptances
    keep their hub link. Punch item #288.

29. ✅ **Track configurator — ADC's real BOM** (#291, D529–D532) — a track
    series maps several stick lengths (`sticks`; each leg buys equal pieces,
    the shortest stick that covers its share; sanitize derives
    `stickLengthFt`/`parts.track` from the longest), four optional roles
    priced only when mapped (ceiling splice, pipe clamp per batten point,
    lap clamps on a bi-parting batten track, one-way dead end), a per-series
    operating-line tie-off allowance, and a lapped bi-part (overlap > 0) is
    two legs — sticks, splices and hanging points per leg. Estimating Rules
    → Track series edits the stick list. Researched against ADC Catalog 52
    and the series binders. Punch item #291.

30. ✅ **Portal Packages & Assemblies** (#289, D533–D535) — fixture
    assemblies carry an optional **Portal category** (Design → Assemblies;
    "Other packages" when blank); the portal catalog gains a reserved
    `packages` department — a landing tile, `?dept=packages` scoping and a
    Packages-then-Parts search split, with a "Package" badge and "Includes N
    parts" on tiles. Departments hold parts only; the "Fixture assemblies"
    pseudo-category is retired. Remaining is Jeff-gated: set a Portal
    category on each assembly. Punch item #289.

31. ✅ **Make primary photo + Manual documents** (#290, D536–D538) — the
    part editor's Images gallery gains ★ Make primary (a pure front-move,
    one order write, Primary tag); **Manual** is a third part-document slot
    (PDF only, 25 MB) with accessory coverage, a Missing manual filter,
    Datasheets-page column, manual fetch candidates, a portal sidebar entry
    and a client-package Manuals folder. A manual alone never makes a part
    portal-browsable; Displays API, DaVinci pre-fill and thumbnail targets
    stay datasheet-only. Remaining: a "Manual URL" import column. Punch
    item #290.

32. ✅ **Narrative-first client preview — Slices 1–3** (#293, D539–D545, D549–D552, D565–D572) —
    key products on a system (★ per line; `SpecSection.keyProducts`
    anchored to line id + sku, sanitized server-side, remapped on Copy
    here), write-once product paragraphs on the catalog part
    (`narrativeText`, mergeUpsert only; Save to library + the part
    editor's Narrative paragraph), a `narrative_intros` blob of reusable
    system intros, Draft narrative (copy only — D89), the customer PDF
    printing each block with the part's primary photo floated right
    (data URIs; byte-identical without blocks), and Show on PDF →
    Itemized appendix. Slice 2 adds the computed system library
    (sent/won systems from the latest sent revision; 5-minute index
    invalidated by setStatus/remove), Load system (re-priced through
    Copy system's shared `copy-pricing.ts`, vendor lines left out) and
    append-only Merge narrative. Slice 3 puts the latest SENT version online: `/portal/quotes/[id]` and a signed no-login
    `/share/quote/[id]/[token]` (HMAC over a stored nonce, 60 days, Revoke rotates; Send to copy), one
    `onlineEstimateState` rule, a server-side Narrative / BOM toggle, `layout="web"`, scoped photo routes, revisions
    freezing the printed header (`docFields`) and the sent PDF's Rev/date; the print route joins the shared loader
    after #292 merges. Spec `docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`.

33. ✅ **Curtain cut sheets** (#292, D553–D564) — every curtain type on a
    system quote gets a deterministic cut sheet (CS-1, CS-2…): front
    elevation from the finished size (marks ≤ 12" o.c.), a mounting detail,
    materials (fabric, flame rating, sewn area from `curtainCost`, weight
    from `computeSetWeight`, never guessed) and mounting hardware (the
    linked track line's components, else Estimating Rules → Curtain
    mounts, `curtain_mount_hardware`). `src/lib/curtain-cut-sheets/` reads
    Estimator (structured `curtainInputs`, legacy desc parser, the
    `ct-<line id>-<nonce>` curtain↔track key) and Grid quotes; Submittal
    (Letter landscape, title block) and Client (Letter portrait, plain
    language) styles at `/estimator/cut-sheets`, rendered through a signed
    `/print/cutsheets/[quoteId]` route into a `cutsheets/` folder in client
    packages and an off-by-default **Cut sheets** toggle on the estimate
    PDF. Fabric parts gain flame rating + weight fields. Remaining is
    Jeff-gated: confirm the mount types, fill Curtain mounts, set fabric
    oz + flame ratings (PUNCHLIST #292).

34. ✅ **Catalog photo sheet** (#294, D546–D548) — Catalog → Datasheets →
    Photo sheet (`/catalog/documents/photos`): export an .xlsx with one row
    per quoted or portal part (Manufacturer · MFR Part # · SKU · … · Photo
    1–3 · Status), fill in image links or file names (Photo 1 becomes the
    primary), upload it with any photos it names, Preview, Import, and get a
    results sheet back. Rows match on Manufacturer + MFR P/N with SKU as
    tie-break, never guessed (an MFR Part # alone needs a Manufacturer or
    SKU); a new `sheet` image source; 45 s resumable batches, rows chunked
    under 400,000 characters of JSON, sheet ≤ 800 KB / 5,000 rows with a
    photo; never deletes or replaces, and never re-adds a photo someone
    removed from a part. Remaining is Jeff-gated: try one manufacturer on
    production (file names from Drive need the #283 setup). Punch item #294.

35. ✅ **Equipment racks** (#296, D573–D582) — a fourth assembly kind,
    `rack`, in the Assembly Builder (`/design/assemblies` → Racks): a rack
    form (scope, 1–60 RU, depth, numbering, rack-level parts) beside an RU
    sidebar built on one shared, controlled `RackElevation`
    (`src/components/rack/`; arm-and-place, drag, shelves with half/third
    lanes, keyboard, undo/redo, Fill blanks, live RU/weight/W/BTU/amps with
    "at least" when data is unknown). All rules live in the pure engine
    `src/lib/rack/` (`layout.ts` placement/sanitize/reparent, `rules.ts`
    validate/totals/firstFit, `geometry.ts` + `svg.ts` — ONE elevation SVG
    used by the sidebar and the printed sheets). Catalog parts gain optional
    rack data (RU, width, depth, weight, W, max W, outlet capacity, mount
    face, airflow; absent = unknown, never zero) in the part editor and an
    additive CSV at `/catalog/rack-data`. A rack prices like any assembly
    (placements grouped by SKU for the Estimator, D574), draws on its
    scope's Grid layer, and an Estimator rack line carries `rackId`.
    Submittal: `/design/assemblies/rack/[id]` (elevation, schedule,
    power/heat), a streamed zip at `/api/racks/[id]/submittal` (Chrome PDFs
    via the signed `/print/rack/[id]`, schedule.csv, pdf-lib-merged
    datasheets with a gap cover), a `racks/` folder in client packages and an
    Equipment Racks section (27 11 16) in the package's D94 spec. Not in the
    portal. Remaining is Jeff-gated: fill rack data for the gear Peak specs
    (Rack data sheet), set the default blank/vent panels, and check a zip and
    a package .docx on a preview deploy. Punch item #296.

36. ✅ **Manufacturer images + placeholders** (#297, D583–D587) — a part with
    no photo shows a fallback instead of a blank: portal own photo →
    Allowance → Custom Device → manufacturer image → Contact Us (price on
    request) → Image Coming Soon; documents stop after the manufacturer image
    and print full width (`src/lib/part-image-fallback.ts`, four WebP files in
    `public/placeholders/`, exempt from team auth). Catalog → Manufacturers
    (`/catalog/manufacturers`) lists each `mfrKey` with part/photo counts and
    sets, replaces or removes its image (Upload many matches file names to
    names exactly); the image is an unlinked `part_documents` record, source
    `manufacturer`, kept in `manufacturers.imageHistory` (migration 0035,
    deterministic `MF-` ids, lazy). Allowance lines and custom lines with no
    real sku (blank, CUSTOM, AI) carry a key product via a `line:<id>` token
    that prints the kind's placeholder; a custom line saved to the catalog
    anchors on its sku (own photo, else Custom Device); cut sheets use the
    same fallback. Remaining is Jeff-gated: upload the
    manufacturer images. Punch item #297.

37. ✅ **Manufacturer page + analytics** (#298, D588–D594) — every manufacturer
    has a page at `/catalog/manufacturers/<key>` (alias keys redirect; records
    still lazy, unbacked keys 404): vendor claim (reuses the vendor-profile
    claim), a linked company (people/locations read-only) plus reps from any
    company, notes, and non-destructive spelling merges (`aliasKeys`/`mergedInto`,
    `canonicalKeyMap` — image lookup, list rows and portal index alias-aware).
    Quoted cost and forecast (`manufacturer-analytics.ts`: 12 calendar months,
    Chicago; Estimator quotes incl. portal catalog quotes at cost as quoted, Grid
    quotes at today's catalog cost, Quick Design quotes not counted, deleted
    quotes drop out; forecast = open × own or shop win rate) show on the page,
    the list and the vendor Overview (forecast = sum of its manufacturers').
    Remaining is Jeff-gated: merge spellings, link companies/reps. Punch item #298.

38. ✅ **The Grid workspace** (#299, D595–D604) — `/design/grid/[id]` is a full-window
    DaVinci-style docked workspace: icon toolbar, a left pane (Property Editor,
    System Status, Placed vs. target), the plan canvas with sheet tabs and a
    Plan / Spreadsheet toggle (the schedule's own builder), a right pane (Browser
    tree, Layers, Spaces, Wires, BOM, Revisions), a bottom Product Library of
    numbered symbol tiles (Favorites / Recent / scope → device type /
    Assemblies / Curtains) and a status bar; side and bottom panes resize and
    collapse per viewer (`localStorage`). `editor.tsx` became `use-grid-editor.ts`
    (state, one active tool), `plan-canvas.tsx` and `workspace/*`; the rules are
    pure modules in `src/lib/design/` (`grid-workspace-layout`, `grid-tools`,
    `grid-selection`, `grid-align`, `grid-snap`, `grid-clipboard`, `grid-undo`,
    `grid-library`, `grid-browser-tree`, `grid-system-status`). Multi-select
    (click / shift / marquee), align / distribute, bulk Set category / Replace
    part / Delete, copy / cut / paste / duplicate, snap to grid (off by default)
    and 100-deep client-side undo / redo go through six batched all-or-nothing
    actions (`movePlacementsAction` … `restoreItemsAction`, one `patchDoc` each).
    No migration; Blank designs don't Auto fill (D603, Jeff). Remaining:
    try it on a real Auto-filled, large design in production. Punch item #299.
    ✅ Follow-up (#318, D692–D694): plan sheets upload straight to Blob up to
    25 MB (the 4 MB route stays when Blob is off), and every new sheet opens in
    **Adjust sheet** — crop to the plan, turn it upright in quarter turns, per
    page, only while the page is empty — which derives a new sheet from the
    original upload (`src/lib/design/sheet-adjust*.ts`); later via the tab's ⋯ →
    Crop & rotate…. Punch item #318.
    ✅ Follow-up (#319, D696–D698): a multi-page PDF uploads as one sheet per
    page (`<file> — p.<n>`, up to 60; `grid-sheet-split*.ts`), Adjust sheet
    walks them ("Sheet 2 of 5", Skip the rest), and a real plan removes the
    generated plan when nothing is drawn on it. Punch item #319.

39. ✅ **Object symbols + size slider** (#300, D605–D612) — a Grid design saves
    its own symbol size (25–400 %) and Generic / Object mode (`symbolDisplay`,
    `grid-symbol-display.ts`; scales markers, click/snap targets, the ring and
    the drawing set's plan sheets through one `markerBox`, never the riser).
    Product drawings are part documents of two new kinds, `symbol` and
    `riser` (not coverage slots, never in the portal), per part and per device
    type (`symbolDocId`); SVG is accepted only for drawings and always
    sanitized (`svg-sanitize.ts`), drawn only as images with a sandbox CSP and
    a generic fallback (`object-symbol.tsx`, `drawing-upload.ts`). A marker
    resolves part → device type → generic, riser → plan → generic
    (`object-symbols.ts`, `object-symbols-server.ts` build the URL map). Shown
    on the plan, the drawing set, Library tiles and the riser. `npm run
    symbols:davinci` (`symbols-plan.ts` + `scripts/symbols-davinci.ts`) attaches
    ETC's DaVinci drawings: dry run by default, never replaces a hand upload,
    idempotent. No migration. Remaining is Jeff-gated: the production import
    (runbook in PUNCHLIST #300) and a fuller DaVinci export. Punch item #300.

40. ✅ **Two-prong estimate output** (#301, D613–D634) — one estimate, two client
    outputs from the same printed systems. Systems carry a discipline (blank =
    inferred, never stored), client goals (pre-filled from the site visit's new
    per-discipline **Client goals** box; From site visit) and a cover paragraph
    override (`src/lib/estimate-output/`: `fields`, `goals`, `scopes`, `cover`,
    `cover-loader`); the quote carries an overall summary and a Not included list
    (default in Settings → Sales & Rewards → Estimate output, blob
    `estimate_output_defaults`). The customer preview's **Cover & package** block
    downloads a 1–2 page Arial **Cover PDF** rendered from the LIVE quote
    (`/print/cover/[id]`, print token `cover`; `/api/quotes/[id]/cover-pdf`):
    per-scope paragraph + price, the estimate's own totals lines, add options,
    Not included, the link line and the Lead estimator's signature. Copy client
    link now mints a **v2 token pinned to a sent revision**
    (`quote-share/token.ts`, `pathV2`, `resolveSharedPackage` in `links.ts`;
    v1 links keep #293's page) that opens a frozen package page
    (`components/estimate-output/package-view.tsx` via
    `share/quote/[id]/[token]/package-page.tsx`, `estimate-output/package-loader.ts`,
    pure `package-model.ts`, `bom.ts`, `quote-share/package-view.ts`): grand
    total, summary, per-scope goals / intro / key-product photos, a Narrative /
    BOM toggle with no money, add options, Not included, superseded / revising /
    closed banners, plus per-key-product datasheet links
    (`/share/.../doc/[docId]`, scoped coverage `loadScopedCoverage`), a zip
    (`package.zip`, `package-zip-server.ts`, Blob cache `estimate-package/<q>/rev-<n>.zip`,
    production only), Plans & risers from store-owned `Quote.packageFiles`
    (`package-files.ts`, upload broker `/api/quotes/[id]/package-files/upload`,
    `/share/.../file/[fileId]`; **Generate from Grid** prints the drawing set
    through `/print/grid-set/<project>~<option>` with per-asset tokens and
    `renderPrintRouteToPdf` `waitFor`), and client actions (`responses.ts`,
    `responses-server.ts`, store-owned `Quote.clientResponses`: choose scopes /
    ask a question, JS-only forms, honeypot, rate limits, a task + note + lead
    activity, **never a status change**). Opens are a JS beacon into store-owned
    `Quote.shareOpens` (Client link panel, Quotes hub **Opened** chip, lead
    drawer). Staff side is `estimator/package-staff-panel.tsx` +
    `package-actions.ts` under Client link (gap chips, drawings, responses,
    Rebuild package). No migration, no AI. Remaining is Jeff-gated: fill
    Settings → Estimate output, the post-merge production check (PDF drawing
    under its CSP in Chrome and Safari, Generate from Grid, zip twice, a
    signed-out submit), and the open questions (Rev numbering, BOM quantities,
    cover heading). Punch item #301.

41. ✅ **Model-number SKUs** (#304, D636–D642) — Biamp/EAW/Meyer/Symetrix order-number
    SKUs (`80-0043`) become `Brand:Model` (`Symetrix:Jupiter 4`) from ChatGPT's crosswalk
    sheets via Catalog → **Model numbers** (`/catalog/model-numbers`, admin: upload →
    Preview → Apply, resumable 45 s batches, Fix references). A real rename: new doc +
    retired doc with `renamedTo` (catalog get/getMany follow it; `getManyBySku`),
    `formerSkus` on the live part, MFR P/N keeps the order #, log blob
    `catalog_sku_renames`. Pure rules in `src/lib/catalog-rename/` (`sku.ts` modelSku /
    partModel / lineModel / partSearchHaystack, `plan.ts`, `rewrite.ts`,
    `import-resolve.ts`, `steps.ts`); engine `apply.ts` rewrites every live reference
    (quotes, carts, procurement, spec docs, fixtures/racks, Grid symbols/projects,
    settings blobs, doc/accessory links) and never frozen history. Every part search
    matches Model # and former SKUs; customer documents print the Model # only;
    importers and history-copying writers follow renames. No migration. Remaining is
    Jeff-gated: back up, run Symetrix on production, then Biamp/EAW/Meyer when their
    sheets come back (PUNCHLIST #304).

42. ✅ **Estimator in four steps** (#305, D643–D678, D680–D684) — Phase 1 ✅ (the frame): the
    Estimator is Build · Build package · Customer review · Send & track on one URL
    (`?step=`, pushState, Build canonical), one shared header with a More ▾ menu, a
    readiness line under each tab (never blocking), the status select and Daylite
    pipeline on Send & track, an internal cost summary beside the Review PDF, and
    next-step navigation (Send → Send & track). State stays in one hook
    (`use-estimator-state.ts`); steps in `steps/`; pure rules in `src/lib/estimate-steps/`.
    Phase 2a ✅ (#306, D648–D652): system groups (`spec.groups`, ≤ 20, order normalised
    by one pure function), a Build rail with drag / ↑↓ reorder, rename and delete,
    ✓ Mark built & collapse (staff-only), and group heading rows on the customer PDF
    and online views.
    Phase 2b ✅ (#307, D653–D657): a group marked Alternate prices separately — `totals().alt`,
    excluded from the total, value, review limits and the other option-line consumers; the PDF/online view
    prints an Alternates block (A1…), the cover and package page list them, and the client picker offers
    them unchecked.
    Phase 3 ✅ (#308, D658–D663): the Send & track tab sends the estimate from the sender's personal Gmail
    (ordered action: preflight, claim, attachments, mark sent, link, thread, record, follow-up task; PDFs by reference),
    keeps the Open in Inbox / Mark sent / Copy link escape hatches, and tracks it in an Activity card (replies, Reply,
    Mark read, link opens) and a Send badge.
    Phase 4 ✅ (#309, D664–D668): Customer review gains client's-eye tabs (Document, Package page, BOM, Cut sheets,
    Datasheets, Drawings; Desktop/Phone) served by a saved-quote staff preview route, an internal sidebar (cost, labor,
    package checklist), store-owned numbered review comments with pins on Build / Build package, and one send-back that
    lists them.
    Phase 5 ✅ (#310, D669–D674): Build package gains a TipTap document editor (`spec.document`, one server validator,
    live price / name / quantity chips, product blocks with Save to product and photos, a Gaps / BOM-drag / Library left pane);
    a document replaces the In-total bands on the PDF and package page (itemized lines go to the appendix), and a quote
    without one prints byte-identically.
    Phase 6 ✅ (#311, D675–D678): "+ Add system" opens an Add a system modal — Blank system or one tile per category
    (Controls, Fixtures, Rigging, Video, Infrastructure, Wireless, Communications; settings blob `system_categories`, seven
    defaults, admin page at Estimating Rules → System categories). A category adds its ticked typical items, priced at add
    time from the live catalog at the tier margin, as a system named after it; catalog renames follow. Remaining is
    Jeff-gated: filling each category's typical items in Estimating Rules → System categories, and the exact repro for
    "Send → Home" (PUNCHLIST #305, #311).
    Follow-up ✅ (#312, D680–D684): the package document gains removable price tables and page breaks, a live "system price
    line" per system (`systemTotal`) and a separate `productImage` node (Left / Right / Full, 25–100 %, text wraps beside it;
    older photo'd product blocks print as before and offer Separate photo); a custom part line on Build is click-to-edit in
    place; and the per-line Spec select moved to Customer review's internal sidebar (PUNCHLIST #312).
    Follow-up ✅ (#314, D685–D690): Build package gains `Design in the Grid →` — a Grid design linked to the estimate
    (one per estimate, `estimateOwned` base option; the estimate owns parts and prices, every grid→quote write refuses and the
    Grid shows `Open estimate →`), a prefilled Blank-only intake, and a From estimate tray in the Product Library (placed /
    needed per part, arm-to-place, alternates & options collapsed). Every Grid intake gains an optional Plan view (upload, or
    a plan already on file copied Blob to Blob) that opens as the first sheet; failures open the plan with a retry (PUNCHLIST #314).

43. ✅ **Grid device designators** (#320, D699–D706) — every placed Grid device
    gets a stable, editable designator: its device type's code + a number
    (`MIC-1`; a lot of N reserves N and shows `LX-1–24`), numbered per code
    within each design option, gaps kept until Renumber…, hand duplicates
    drawn amber, curtains excluded. Rules are pure in
    `src/lib/design/designators.ts`; numbers are handed out inside every
    store write via `designatorContext` (`designators-server.ts`), and
    pre-#320 designs are numbered once on editor load (never on a Vercel
    preview). They show on the plan, the Property Editor, the Browser, a
    Spreadsheet **Devices** tab (`workspace/devices-table.tsx`, columns from
    `grid-device-rows.ts`; inline edit, filters, sort, Undo/Redo), the
    schedules and the drawing set (plan sheets replace type marks; E-60x and
    the key never truncate: wrap, "(cont.)" rows, "… see schedule"). Codes
    live on device types (Catalog → Device types, unique among active types);
    Renumber closes gaps and **Apply current type codes** re-issues in the
    current code. No migration. Not in scope: the riser, quotes, BOM and
    customer documents. Remaining is Jeff-gated: many parts are unmapped to a
    device type and number with their system letter (A-1, L-1) until their
    category is mapped in Catalog → Device types; review the default type
    codes, then Renumber → Apply current type codes on designs already
    opened; try it on a real design in production. Punch item #320.

44. ✅ **Morning triage** (#324, D707–D711) — a "Start here" card at the top of Home: each person's top 10 of one ranked list (See more → `/triage`; admins switch person, read-only) built from seven feeds under `src/lib/triage/feeds/` (email waiting ≥ 1 business day ranks higher, Recordings call to-dos behind a `CallTodoSource` with the matched transcript line linking to `/recordings/<id>?tab=transcript&seg=N`, tasks + assignments, lead SLA, today's visits, quotes awaiting you, renewals). Pure points table + reason (`rank.ts`), duplicate collapse, Chicago business-day clock. Per-user snapshots (`triage_snapshots`, `<userId>:<day>:<slot>`) built by the Gmail cron (morning, 11:45 UTC; the brief moved the slots to 6:45 and 13:45 Chicago, D914) and `/api/triage/build` (midday, 18:45 UTC) and lazily on first view, frozen between except done sources; Done / Snooze / Not mine marks (`triage_marks`). Specs 1–3 plug in through `TRIAGE_HOOKS`; Krisp #323 through a second `CallTodoSource`.

45. ✅ **Address verification + drive time** (#325, D712–D724) — every address
    is `verified` / `needs_check` / `unresolved` (only verified gets drive
    time): venues carry the stamp on four `sites` columns, every other address
    lives in the new `place_book` (exact normalized key, house-number rule;
    migration `0037_address_verification`), with the idempotent JS venue
    backfill `ensureVenueGeoStatus`. Pure rules in `src/lib/address-verify/`
    (keys, state, place book, targets, Fix, worklist) and
    `src/lib/drive-plan/` (`planDay`, stops, Chicago days); a cache-mode
    loader for page views and a live one for syncs (`geo_cache` or OSRM
    only — no straight-line fallback). `src/lib/drive-sync/` writes
    `peakDrive`-tagged Google events per leg (today → +14, leased, re-listed
    before diffing, flagged legs get none) and sweeps D144's old blocks
    (D144 retired). Triggers: visits, in-app events, stay-over, address
    fixes, stale-on-load (10 min) and the daily `/api/drive/sync` cron
    (11:00 UTC). A Fix dialog (any signed-in user), Settings → Data →
    Addresses to verify (admin), booking warnings, drive blocks / flags /
    day totals on `/calendar` and Home, a per-rep buffer (company default
    15 min, Settings → Field) and Morning triage's unverified-visit flag
    (`TRIAGE_HOOKS.visitFlags`). Specs 2–3 consume `planDay`,
    `visitPeople`, `addressStatesForVisits` and the `schedule_*` blobs.
    Free text verifies only with a typed house number; legs over 6 h are
    flagged (`long_route`), under 3 min skipped; `npm run geo:recheck-venues`
    re-checks backfilled venue verifications (D724). Remaining is
    Jeff-gated: confirm the drive cron fires (a third daily cron), run or
    waive the re-check, review the worklist, connect rep calendars. Punch
    item #325.
46. ✅ **Krisp meeting matcher** (#323, D725–D761) — every Krisp meeting,
    internal ones included, lands in the Inbox as a separate **Meetings** box
    (`/inbox?view=meetings`: To file · Filed · Noise, Sync now, Load older) backed
    by a new `meetings` collection (migration 0038; `src/lib/stores/meetings.ts`,
    `src/lib/meetings/`). A resumable 90-day first sync, then a rolling 14-day
    window (`sync.ts`; per-rep in-process guard, daily cron rider, Home
    `after()` trigger), and a deterministic matcher (`match.ts`, `names.ts`: name
    cores, calendar, attendee emails, speakers, the rep's site visits; strong ≥ 80
    and 30 ahead, weak ≥ 40) that only suggests — nothing is linked or shared
    without a tap, Confirm all files the strong rows. A reader corrects attendees
    (Krisp ∪ the calendar event ∪ manual), maps "Speaker N" to people (one-pass
    relabel), and decides each Krisp to-do: Task (deterministic `T-mtg-` id),
    Waiting on customer, or Note (`N-mtg-`). Visibility is personal until linked,
    all staff once linked externally, the portal only on an explicit Share with
    customer (never the transcript). Filed meetings show on company/venue/people/
    lead/project/engagement/survey pages, the feed, ⌘K and the portal; meeting
    tasks join the Home queue, `/queue` and Google Tasks (waiting-on-customer
    ones show on Home under Waiting on others instead). Also closes a hole:
    `/api/sync/pull` now serves only the 7 offline field collections. No AI
    (D89), no new env vars. Remaining is Jeff-gated: connect the Krisp key and
    press Sync now on production, confirm desktop auto-recorded meetings list
    with participants, review a week of suggestions, and renumber migration 0036
    at merge if another branch lands first. Punch item #323.

47. ✅ **Grid conduit riser** (#321, D763–D774) — a Bray-format lighting control
    riser derived from the Grid's devices and wires: `/design/grid/[id]/conduit-riser`
    draws device tags (ID, location, P/D, box, face, mount, height), conduit runs
    with size labels and signal bubbles, chained hops, stubs, power types, notes and
    per-level / per-space details, with a draggable lane (`laneX`), Reset layout,
    undo/redo and a Tag panel; suggestions come from plan wires between
    lighting-control devices (the plan's "Add to the lighting control riser?" bar).
    Pure engine in `src/lib/design/conduit-riser/` (model, suggest, derive, layout,
    drawing, svg, dxf, tables, pricing), server in
    `src/lib/design/conduit-riser-server.ts`, store in
    `src/lib/stores/grid-conduit-riser.ts` (the document rides the design option;
    no migration). The drawing set gains E-502… (six tables) and a DXF R12 download
    at `GET /api/grid/[id]/conduit-riser/dxf`. Designators pad to two digits by
    default, parts carry a Designator code and Riser tag defaults, devices override
    per field, levels live on spaces and `sheetLevels` on the project; wire types
    gain Symbol/Signal, and `riser_box_types` / `conduit_sizes` are settings blobs.
    Pricing: wire and conduit are both off by default per design, with a per-run
    override (unpriced wire is "by others"; refusals block promote; estimate-owned
    options ignore it). Remaining
    is Jeff-gated: fill Estimating Rules → Conduit sizes, set wire-type symbols and
    part tag defaults, set levels on a real job, open the DXF in AutoCAD/Vectorworks,
    decide 24×36 scaling and a read-only phone view. Later: AV/video risers, computed
    conduit fill. Punch item #321.
48. ✅ **Site-visit scheduling** (#326, D775–D783) — visits are fixed
    appointments with a lead + `attendees` (never the lead; each gets their own
    drive chain via `visitPeople`); per-recipient invites in `SiteVisit.invites`
    (`src/lib/visit-invite-plan.ts` plans add/update/cancel; `visit-invite.ts`
    delivers — a Google Calendar event when the mailbox has the grant, else .ics
    with a real `method=CANCEL`, UID `sv-<id>@peak-app`; a legacy single invite
    reads as the lead's entry); a pure engine `src/lib/visit-plan/` (work hours,
    busy blocks, `checkVisit`, `suggestDays`, `agendaConflicts`) behind
    `visit-plan/load.ts`, where other people's Google events read "a calendar
    event"; the booking panel (`src/components/visit-booking/`) on the
    visit-requests scheduler, the Inbox dialog and the company record's Edit
    (scheduled visits only); conflict badges on the company record (GET
    `/api/visits/conflicts`, 20 s budget), /calendar and Home; settings in
    Settings → Field + Account; the live booking check is GET `/api/visits/check`.
    Deleting a past visit leaves calendars alone; updates/cancels mail from the
    original sender's box. Nothing moves or blocks a visit; nothing is stored
    for conflicts; no migration. Remaining is Jeff-gated: the settings values, a
    real booking with attendees, and a real-mailbox CANCEL check in Gmail/Outlook/
    Apple. Punch item #326.
49. ✅ **Auto task calendar** (#327, D784–D805) — a pure planner
    (`src/lib/task-plan/`, `planPerson`) places every open assigned task and
    Queue assignment into each person's free work time (spec-2 work hours minus
    visits, spec-1 drive blocks, accepted timed Google events and pins; 80 % of
    the free time left, 15-min grid, ≥ 30-min chunks, 8 weeks) by blended
    urgency (tier × 1/(days left + 1), overdue first). Only `started`/`hand`
    pins are stored (blob `task_pins:<userId>`, `src/lib/stores/task-pins.ts`,
    500-pin cap); plans are computed on every view (`savePlanPins` in
    `after()`) and by morning triage's now-live `TRIAGE_HOOKS.atRisk`
    (`task-plan/triage.ts`, once per build). /calendar Week/Day draws blocks
    (drag pins and Unpin — owner or admin only — popover), Month chips come
    from the plan, an At risk panel (Push due date / Hand off / Unpin
    something) and a streamed Home "Today" card; tier/size chips on every task
    form; +7 default due date on new assigned items (5 pm Chicago; consulting-
    scheduled tasks skipped); one-time `npm run tasks:backfill-due`. Task
    blocks are app-only; no migration. Final-review fixes (D796–D805):
    bounded remainders (finished-size work stays movable, its daily chunk
    queued after all work with size left — D805), only the owner's
    own views lock started pins, held started pins can be Unpinned, Waiting
    on customer tasks skipped, undated = rolling today + 7 (never At risk),
    the task bell no longer shows teammates' overdue tasks (U1). Remaining is
    Jeff-gated: the production backfill, telling the reps, reviewing the 80 %
    cap and work hours, and U1. Punch item #327.
50. ✅ **Conduit riser polish + phase 2** (#321 polish D806–D811, #328
    D812–D822) — the #321 riser fits the page (up to 1.5× on 24×36), is
    read-only on a phone, gains keyboard access, busy states and undo across
    its own writes, and refuses estimate-owned price flags on the server.
    #328 piece A: **Catalog → Riser data** (`/catalog/riser-data`, admin)
    exports and imports per-part Designator code + Riser tag defaults through
    Preview/Apply. Bray-code suggestion rules live in
    `conduit-riser/suggest-tags.ts`, and Grid Settings → Wire types gains
    Fill symbols from Bray's legend. Piece B: a cable **outside diameter**
    (`CatalogPart.cableOdIn`, part editor + the sheet's Cables tab,
    datasheet-sourced suggestions only) feeds NEC EMT **conduit fill**
    (`conduit-riser/fill.ts`). It suggests a size and warns, and never
    blocks. Piece C: one **A/V conduit riser** (Bray AV1.5) per option on the
    same engine — `GridProject.avRiser` beside `conduitRiser`, walked through
    `CONDUIT_RISER_FIELDS`, `?system=av` on the page. Audio/video devices and
    wires belong to it, and a wire belongs to one riser's conduit. Bubbles and
    the wire legend are off by default, with no power tables or tag fields.
    The plan prompt picks the riser from the pair. Its sheets follow the
    lighting E-50x pages (`av-riser` exclusion; DXF `?system=av`), and
    `riserBom` prices from both risers. No migration. Remaining is Jeff-gated:
    the riser data sheet and cable diameters on production, the wire-type
    symbol fill, and trying the A/V riser on a real job. Punch item #328.

51. ✅ **Estimator bonuses** (#330, D846–D852) — the 5%-of-labor performance
    bonus is replaced by two hidden, locked auto lines per system
    (`SpecItem.bonus`, pure rules in `src/lib/estimate-bonus/`): a **5% package
    bonus** on the system's cost when it has labor, marked up at the system's
    blended margin, and a **2% estimator bonus** on the system's price (freight
    in, $25 round-up after, a typed sell kept), paid at cost. Both raise the
    price; customer surfaces fold the 5% into labor and spread the 2% across
    every row by price, and twelve other readers skip them explicitly. Applies
    to eligible Estimator system quotes that are drafts, or sent and already
    carrying a bonus line; legacy sent/won/lost are never rewritten, and the
    server re-derives the lines on save and on moving a system. Marking a quote
    Won writes a store-owned `Quote.bonusRecord` (2% split 50/50 between Lead
    estimator and Prepared by, approver-editable, taken alternates counted;
    Record now rebuilds a missing one) shown on Send & track and in Reports →
    Estimator bonuses (admins all, estimators their own; CSV), and sets the
    install project's `performanceBonusPool` to the 5% payout. No migration.
    Remaining is Jeff-gated: who holds `approve`, a real draft's new price on
    production, whether the rates become Settings, and a CSV formula-injection
    guard codebase-wide. Punch item #330.

52. ✅ **Build package tabs, assembly members, estimate letterhead** (#331–#333,
    D853–D868) — estimates (PDF, preview, online page), the client package page
    and the Cover PDF always print the full baked Peak letterhead, even with a
    Branding dark logo; letters/reports keep the D59 ladder (#331, D853). An
    assembly line carries its members (`src/lib/quote-line-members.ts`:
    `expandLine` — racks read live members and keep their quoted row when
    unresolved, add-ons/labor left out; `isAssemblyLine`/`primaryMemberSku`/
    `memberAliases` alias photos, paragraphs and key-product datasheets for
    fixture/System/Hardware assemblies only, never racks/tracks) into the
    package BOM, datasheets, book, zip, review rows, Catalog → Datasheets and
    the photo sheet; Save to library on a starred assembly writes to the member
    (`viaSku`); the zip cache version was not bumped (#332, D854–D856). Build
    package becomes Narrative · BOM quote · Client package (`?ptab=`, Narrative
    kept mounted): a live, code-split BOM view built in the browser
    (`liveBomDocumentProps`); one Client package checklist — Documents
    (Estimate/Cover PDF Send & track defaults, BOM appendix, cut sheets,
    drawings switch + tools), Systems (the one presentation editor; the Build
    card shows a read-only chip), line detail, per-product Datasheets from the
    unsaved BOM (`BomProjection` → `clientPackageDocsAction`, byte-budgeted).
    `Quote.packageSelection` has one writer (`setPackageSelection` via the
    header-meta action; Save never carries it; merged partials, over-cap
    refused, never bumps `updatedAt`), is frozen per revision only when set,
    and every datasheet consumer honours its exclusions (`datasheetExclusion`;
    covered accessories follow their fixture; datasheets only; left out of the
    book and Quotes-hub package, kept in the spec); drawings off hides Plans &
    risers; Send waits for the choices (10 s) (#333, D857–D868). No migration.
    Remaining: the #333 browser pass, then Jeff-gated — a real assembly estimate
    and a left-out datasheet on production, the letterhead on a real PDF, whether
    Specifications.docx / the Datasheets.pdf cover / client cut sheets switch to
    the full sheet too, and whether to bump the Blob zip cache. Punch items
    #331–#333.

53. ✅ **Assist layer** (#334, D869–D880) — an opt-in trial of three model-backed
    actions on an Inbox email thread, replacing nothing deterministic. **Suggest
    tasks** (Haiku 5.5) offers up to five tasks to tick, created through the #215
    path; **Draft reply** (Sonnet 5.5) fills the inline composer (never sends),
    learning tone from the sender's own sent mail and listing open quotes for the
    thread's resolved customer only; **Draft estimate** (Haiku extracts, Opus 5.5
    drafts) creates a draft Estimator quote (`source:"estimator"`, optional
    `Quote.assistDraft`) from four candidate sources with no prices shown to the
    model — prices come only from `catalogAddPrice`, systems round to $25, line ids
    are unique across the quote, unknown parts become $0 custom lines, and a banner
    carries the notes, per-line reasons and a Dismiss that doesn't bump `updatedAt`.
    **Draft estimate was replaced by Estimate suggestion (#338, phase 57):**
    nothing creates a quote any more; drafts made before keep their banner.
    The gate (`src/lib/assist/config.ts`): no `ANTHROPIC_API_KEY` (or local URL) =
    no UI and no call; `ASSIST_DISABLED=true` kills it; `settings.assistUsers`
    must include the user (**an empty list means nobody**); per-feature toggles
    (a later one, `vendorpdf` — Read the PDF on a vendor quote — is #348 slice 5, phase 62).
    Every call goes through `runAssist` (`src/lib/assist/run.ts`: gate, $200
    monthly cap, per-hour rate limit — the estimate counted once on the extract
    step — provider with a local → Haiku fallback, zod, log) over one provider
    interface (`anthropic.ts` on the official SDK, beta messages, no `thinking`,
    no forced `tool_choice`; `local.ts` for a Mac mini), and each is logged to the
    `assist_runs` doc table (migration 0039, kept by the go-live wipe) with an
    outcome (reply edit ratio, task ticks, estimate kept/changed computed at report
    time). Thread text is untrusted data in `<email_thread>`. Settings → Beta →
    **Assist pilot** holds the allow-list, feature toggles, the cap and an
    estimated-cost report (loaded only for admins on `?section=data`). The Inbox
    page has `maxDuration = 300`. Env: `.env.example`'s Assist block;
    MASTER-HOWTO §6 has the turn-on steps. D89's deletions stay deleted; the SDK
    supersedes D39 for this layer. The key can also be pasted in Settings → Beta →
    Assist pilot — encrypted in the `assist_secrets` blob, it wins over the env var
    and never reaches the browser (D881, `src/lib/assist/key-store.ts`). Remaining
    is Jeff-gated: a Console key with a $200 spend limit, pasted in Settings (or
    `ANTHROPIC_API_KEY` in Vercel production), tick Jeff and one
    estimator, try each button on a real thread, read the report after 30 days and
    keep or kill it. Draft quotes show no price in the reply prompt (only sent
    quotes do) — Jeff may opt in. Punch item #334.

54. ✅ **Inbox organization** (#335, D882–D900) — piece 1 of the AI roadmap, on top of
    Assist. Every imported message runs a pure-core pipeline
    (`src/lib/inbox-org/`, `pipeline.ts`): sender rule → identity → record number
    (`EST|FLM|RIG|REP|RNT|CON|OPP-####`) → noise rules → Haiku (pilot only), a weak
    domain guess ranked after numbers; the result is a `CommThread.filing`
    suggestion, a `court` (me / teammate / customer / nobody — a teammate's reply to
    the customer no longer counts against the owner; the rules put it on the owner for
    a teammate's forward, a teammate's internal note (To/Cc all internal; sign-off/FYI
    → nobody) and a reply naming the owner ("Jeff will be in touch", `names.ts`), the
    AI (pilot) for unnamed hand-offs and hand-offs to another teammate (D894);
    sign-offs go to nobody; `status` and Morning triage follow it) and a `noise` flag.
    **Everyone** gets
    archive-on-reply (a reply, or a teammate's reply that leaves the ball with the
    customer, files a linked/strong thread and archives it; Account → Keep threads
    in my inbox opts out; outbound messages and logged calls never un-archive; Mark
    replied / Close archive), tag-only "Looks like noise", and saved sender rules
    (`inbox_sender_rules`; accepting "always file under X" sweeps that sender's own
    unlinked or same-customer threads, everything else gets a suggestion). **Assist
    pilot users** (`file` / `promise` features, off until an admin turns on Inbox
    organization / Promise tasks — D897; Haiku, `ASSIST_MODEL_FILE|PROMISE`)
    also get AI filing from a server-built candidate list, AI court/promise reading,
    noise moved to a Noise tab, automatic promise-tasks (`T-prm-…`, due-date
    resolver, owner/teammate messages only, mail under 7 days, never backlog) and
    **Organize my inbox**, a resumable suggest-only 90-day cleanup. The AI pass runs
    in `after()` with a deadline, leases (`aiLeaseUntil`, `promisesFor`) and a
    per-owner court-first queue, and does nothing unless an owner is a pilot (D895);
    the Gmail cron runs none. Promise-tasks go only to someone the newest message names
    (D899). Quiet archive / unarchive / setStatus are key-level writes (D896); a Gmail
    re-inbox brings a thread back (D898); `INBOX_ORG_DISABLED=true` turns off the import
    hook, archive-on-reply, the Mark replied / Close archive and the AI pass (D900).
    Inbox → **Organize**
    (`?view=organize`: To file / Noise / Filed, Approve · Change… · Noise · Skip,
    Approve all strong, Undo from `filing.applied`) and the reader's court chip,
    filing line and promise-task line; changes post `inbox-changed` on
    `BroadcastChannel("peak")`. The Assist pilot card gains an own-domain override
    (replaces derived domains; Peak's domain always kept), company sender rules and a
    filing report (by source, % approved, rescues, auto-filed apart, promise-tasks,
    court overrides). Auto-filings leave the AI outcome null (`outcomeDetail.autoFiled`).
    No migration. Remaining is Jeff-gated: tell the team before deploy (replies / Mark
    replied / Close / teammate replies archive in Gmail by default; Account → Keep threads
    in my inbox; INBOX_ORG_DISABLED=true), the Assist key, tick the pilot users and turn
    on Inbox organization / Promise tasks, run Organize my inbox, review To file / Noise and the sender rules
    for a week. Follow-ups: atomic append in `recordMessage`, an AI pass on the cron,
    all three promises on `court.promise`. Next: pop-out windows → AI brief →
    estimate suggestion → AI sidebar. Punch item #335.

55. ✅ **Pop-out windows** (#336, D902–D913) — roadmap piece 1b, all client-side
    (no migration, no env var). The Inbox, a thread, an estimate or a customer
    record opens in its own named browser window (`peak-pop:<kind>:<id>`, one per
    item; popping out the same item again focuses it and never reloads it —
    `window.open("", name)` then a location replace, D904). A `<head>` script adds
    `pk-pop` to `<html>` before first paint; pop-out mode hides the nav and shows a
    header with the title, **Open in main window** (the most recently focused main
    window answers, else a new tab after 500 ms) and ✕. Ways in: a ⧉ on the Inbox,
    thread reader, Estimator and customer record; a hover ⧉ on the nav's Inbox,
    Estimator and Companies rows; shift-click on email, estimate and Companies rows.
    Hidden under 900 px and in the native shell. Size and position are remembered per
    screen type as inner size. Pure core in `src/lib/popout/` (`names`, `geometry`,
    `channel`, `guard`, `click`, `live`, `open`), `PopoutButton`, `PopHeader` and one `LiveSync`
    (replaces #335's Inbox listener): a save in one window posts `changed` on
    `BroadcastChannel("peak")` and every other window refreshes after 1 s (at most
    one per 5 s), never while a field is focused or within 3 s of a keystroke, never
    offline (a failed `router.refresh()` becomes a full reload — D910), plus a
    refresh on focus when over 30 s stale; an unsaved-work hold (`popout/hold.ts`,
    set by the Estimator) skips that and keeps Open in main window from navigating
    away (D912). Posters cover the Estimator,
    customer record and task saves; the Quotes-hub `setQuoteStatus` and the
    PortalPanel Approve rely on the focus refresh. Remaining is Jeff-gated: try it
    in Chrome and Safari, an estimate beside the dashboard, the remembered size, and
    Open in main window. Follow-ups: ⧉ on other screens, the form-action posters, a
    duplicate window from a second main tab. Next: AI brief (now shipped, #337) → estimate suggestion →
    AI sidebar. Punch item #336.

56. ✅ **AI daily brief** (#337, D914–D929) — roadmap piece 2, for Assist pilot
    users with the new opt-in **Daily brief** switch (Settings → Beta → Assist
    pilot; no migration; `ASSIST_MODEL_BRIEF` optional). A BriefCard above Start
    here at 6:45 and 13:45 Chicago (`slotAt` is minute-precise; crons `45 11` and
    `45 18` UTC, lazy build covers winter drift; before 6:45 yesterday's afternoon
    brief shows): a Haiku summary limited to the triage snapshot's rows, with a
    rule-built fallback, plus Do these first, Organize counts, new promise-tasks,
    Today, approvals, quiet quotes and an afternoon "since this morning" line.
    One blob per user and slot (`brief:<u>:<day>:<slot>`, insert-if-absent;
    Rebuild replaces it, 3/h, 90 s, and is the only path that runs the Organize AI
    pass). Pure core in `src/lib/brief/` (`slots`, `types`, `sanitize`, `prompt`,
    `quiet`, `nudge`, `speech`, `card-vm`, `reminders`), server in `build.ts` and
    `drafts.ts`. **Pre-made drafts:** `runDraftQueue` drafts a Sonnet reply and Haiku
    task suggestions for every thread on my court (`CommThread.preDraft`) and a
    Haiku follow-up note + email for each quiet quote — sent, the owner's (else
    Prepared by), ≥ 5 business days old, no inbound reply, at most 8
    (`Quote.assistNudge`); only for pilot users with Daily brief on; `countRate:
    false`, bounded by the monthly cap and paused at 60 % of it (D927);
    per-thread / per-quote leases, basis- and owner-checked key-level writes
    (`ownerId`, D929), 6 h error retry; run from Home and Inbox `after()` and the
    two cron riders (Gmail cron: meetings, then briefs + drafts by 35 s, then
    photos; midday cron ends by 50 s). A lazy brief that ran out of time is not
    stored, and the cron replaces a stored lazy brief with an error (D928). The reply and task
    calls are reusable server functions (`reply-server`, `tasks-server`) with
    per-call limits that can only shorten. In the reader, **Use it** opens a fresh
    stored draft with no model call; **Send nudge** opens `/inbox?nudge=<quoteId>`
    pre-filled (recipient resolved server-side, nothing sends). On a phone: a
    big-text view, **Listen** (`speechSynthesis`) and two repeating local
    notifications (ids 64501 / 64502, 6:45 / 13:45; `@capacitor/local-notifications`
    8.3.1; Account → Brief reminders on this phone, on by default). The Assist
    report gains a Daily brief table (nudge "opened" stands in for "sent"). The
    card never breaks Home. Remaining is Jeff-gated: turn Daily brief on for the
    pilot, `npx cap sync` and rebuild both apps, check the first morning's cost,
    try Listen in the car. Follow-ups: whole-doc writers that can clobber
    leases, per-process Rebuild limit, every user's build scanning all threads
    and quotes. Next: AI sidebar. Punch item #337.
    ✅ Follow-up (#350, D1083–D1085): the card is three blocks — Emails, Estimates,
    Tasks (`src/lib/brief/blocks.ts`) — with the Do-these-first picks as ★ in their
    own block, on the phone and in Listen too; presentation and prompt wording only.

57. ✅ **Estimate suggestion** (#338, D930–D942) — roadmap piece 3, replacing
    #334's Draft estimate, for Assist pilot users with the **Suggest estimate**
    feature on (no migration, no new env var). **Suggest estimate** on an email
    thread (Inbox reader), a lead (drawer footer, converted leads too), a site
    visit (venue assessment header, disabled while unsaved or saving) or a linked
    Krisp meeting (meeting reader header), and on the brief's lead row ("Ready to
    quote?"), POSTs to `/api/assist/suggest-estimate` (`maxDuration = 300`,
    `requireUser` + the `estimate` gate, zod body, always-200 JSON, 415 for a
    non-JSON body). `suggestEstimate(source, me, deps)`
    (`src/lib/assist/estimate-suggest-server.ts`) checks access per kind (an
    unlinked meeting is refused even for its owner; a lead's linked threads come
    from the caller's own mailbox only), builds untrusted source text
    (`features/suggest-sources.ts`, `survey-findings.ts`), extracts (Haiku),
    gathers candidates, drafts (Opus) and `sanitizeSuggestion`s it — candidate
    SKUs only, no prices, 12 systems / 60 lines — into an `EstimateSuggestion`
    stored as blobs (`estsugg:<id>`, `estsugg-src:<kind>:<id>` → latest,
    `estsugg-quote:<quoteId>`; `src/lib/stores/estimate-suggestions.ts`). Nothing
    creates a quote: the reply is an `/estimator?suggestion=…` link that opens a
    new, unsaved estimate with only the header filled (customer, then venue,
    contact and lead only when the suggestion is about that customer; the name)
    and a **Suggested BOM** panel on Build (`suggested-bom-panel.tsx`, pure
    `suggestion-panel.ts`): per system **+ Add system** (`systemFromSuggestion`,
    priced like a manual add through `catalogAddPrice`) and **+** per line into a
    chosen system, ✓ added derived from the sections, unknown parts as unpriced
    custom lines "Suggested: needs a part and price". The save stamps `leadId` on
    create only and links the suggestion on the first save (first quote kept;
    `unlinkedRetryAllowed` retries a missed link, never on a page load); the panel
    starts hidden on a saved quote, open/closed remembered per suggestion only
    when toggled. One client helper (`suggest-client.ts`, `suggest-estimate.tsx`)
    runs every entry point: busy until the Estimator opens (recovers after 15 s),
    errors inline, "Suggestion ready → Open" + "Suggest again" when the source has
    one. The Assist report scores a run off its suggestion's first quote
    (`estimateKeep`): pending until saved, discarded if that quote is deleted, and
    a No suggestion bucket for runs that saved nothing or were superseded by
    Suggest again. Old #334 drafts keep their banner. Remaining is Jeff-gated:
    the key, pilot users and the Suggest estimate toggle; try it from an email, a
    lead, a site visit and a meeting; check the Opus cost per run in the report.
    Follow-ups: site-only meetings get no hint; an offline-queued survey edit
    isn't on the server yet when Suggest reads it. Next: AI sidebar (now shipped
    as Ask AI, phase 58). Punch item #338.

58. ✅ **Ask AI** (#339, D943–D960) — roadmap piece 4, the last: a researcher
    over Peak's own data inside ⌘K search, for Assist pilot users with the new
    opt-in **Ask AI** switch **and** a Claude key (`askGateFor`; Claude-only, no
    migration; `ASSIST_MODEL_ASK` / `ASSIST_MODEL_ASK_HARD` optional). It
    deliberately reverses D89's assistant removal and the #334 brief's non-goal
    (D943) as a fresh build; the model only reads and proposes. The nav search
    gains a first row "✦ Ask AI: <query>" (⌘↵; hidden at 860 px and below with
    the search box — open question) that opens `AskPanel`
    (`src/components/ask/`): a context chip from `GET /api/assist/ask/context`
    (`{ref, title}` only), streamed answers, "Looked at N records", Sources,
    cards, **Try harder** (re-asks on Sonnet; the earlier run is discarded only
    when the retry succeeds), a Search the web toggle (off) and Stop; Esc, ✕ or
    navigating forgets the conversation. `POST /api/assist/ask`
    (`maxDuration = 120`, NDJSON) runs `runAsk` (`src/lib/assist/ask-runner.ts`):
    earlier turns packed into the first user message (no replay), ≤ 6 rounds /
    12 tool calls / 6,000-character results / 60 s Haiku · 90 s Sonnet, the final
    round keeping its tools with `tool_choice: none` (not yet verified live), web
    search `max_uses` 3 per round with the version per model, one `assist_runs`
    row per question billed from stream events. Eleven read tools
    (`ask-tools-server.ts`) use the asker's own access — threads through
    `loadThreadFor`, meetings through `canSeeMeeting` (no transcript), search via
    the extracted ⌘K core (`src/lib/search/global-search.ts`) scoped to the
    asker's mailbox, a SQL catalog pre-filter, customer-row quote lines with the
    bonus hidden; forbidden reads like missing. Four proposal tools write
    nothing: cards (pure `features/ask-cards.ts`) keep only ids this question
    exposed (≤ 20 earlier `[[kind:id]]` tokens re-checked) and recipients from
    structured fields or the user's own typing, and confirm through the app's
    own paths — `createAskTaskAction`, company / venue / lead / project note
    actions, `/inbox?compose=ask` (sessionStorage, never sends) and
    `startSuggestion` — then `recordAskCardAction` marks the run accepted.
    Answers render as text; a ref links only when the server sent it. The
    Assist report gains an Ask AI table. Remaining is Jeff-gated: turn Ask AI on
    for the pilot, try company / quote-comparison / this-screen / web questions,
    each card and Try harder, check the forced final round and Haiku web search
    live, read the report after a week, decide on narrow screens. Follow-ups:
    ⌘K listing other mailboxes' thread subjects (closed by #341), `list_quotes` without a
    company scans headers, lead/project notes post no LiveSync entity. This
    completes the AI roadmap. Punch item #339.

59. ✅ **Assessments engine — slice 1** (#340, D961–D1003) — Condition
    assessment + a findings register, from Jeff's three Oct 13 briefs
    (`docs/assessments/briefs/`; spec `docs/superpowers/specs/2026-10-13-assessments-engine-design.md`).
    Questions are code-first definitions (`src/lib/assessments/defs/`: scopes
    S0–S8, modules, pick lists, every gate rule R/F/G/L/A/H/X as data;
    `ASSESSMENT_DEF` version 1 stamped as `defVersion`, stable dotted keys,
    admin-addable pick-list values in the `assessment_picklists` blob) and one
    pure `evaluate()` (`evaluate.ts`) serves the editor, Mark complete, the
    report and the server. Three doc collections — `assessments` (`AS-####`
    from 1001), `findings` (`fd_<16 hex>`), `venue_profiles` (id = site id) —
    plus `companies.short_code` / `sites.short_code` with unique partial
    indexes (migration 0040_assessments; stores `src/lib/stores/assessments.ts`,
    `findings.ts`, `venue-profiles.ts`, row layer `assessment-rows.ts`). The
    editor (`/assessments/[id]`, phone-first) starts **online only**, then works
    offline through the outbox: answers merge per key (newest `at` wins, server
    stamps `by` and clamps `at`), invalid / late / stale pushes land in
    `syncRejects` with Re-enter / Use mine, and the push rev base is `sent − 1`.
    Photos shrink to 1,600 px, queue in IndexedDB (`photo-queue.ts`, backoff,
    terminal-failed list with Retry / Discard) and upload to private Blob
    through a prefix-checked broker; inline base64 is dev-only. The register
    (`/assessments/findings`) prints IDs `CUST-VENUE-CAT-###` (e.g.
    `MPSD-LIN-RIG-003`): the server allocates the number under an advisory
    lock, voided numbers are never reused, a code locks once used (changing it
    needs `approve`), and the category freezes after numbering; Immediate
    findings need a photo, hazard-contact and lockout; merge / split are
    transactional; statuses open → closed carry a history. **Quote these
    findings** opens the repair builder intake (`?findings=`, linked on first
    save) or creates an Estimator draft, with quote-level `findingKeys` and the
    printed ID in each line. Reports (`/assessments/[id]/report`, a findings-only
    PDF) render through signed print routes (`/print/assessment/[id]`,
    `/print/assessment-findings/[scope]`; token kinds `assessment`,
    `assessment-findings`) with photos inlined as data URIs (20 MB budget) and
    the PDF streamed, not buffered; **Email report** stores it in Blob and
    drops it into an Inbox draft by reference (inline ≤ 1.5 MB only without
    Blob). Integration: Assessments in the Customers nav group, Start
    assessment on a site visit, cards on venue / company / lead / project
    pages, a read-only Venue profile card, ⌘K for `AS-####` and printed IDs,
    `assessments` and `findings` joined the offline field collections (a push
    that throws replies `retry`; the editor folds this device's outbox entry
    before saving and its save status follows the outbox), `venue_profiles`
    kept by the go-live wipe. Tests: `scripts/test-assessments.ts` (inside test:specs) and
    new smoke routes. Code comments and the migration header still say #337
    (the pre-merge number). Not in scope: the portal, Venue Assessments / RI
    migration, flame-test and re-inspection visits (slices 2–5 in PUNCHLIST
    #340). Remaining is Jeff-gated: set real MPSD venue codes before the first
    finding, run a real Manitowoc assessment, confirm the five added flag
    prompts (D972, assumed defaults), and a production check after the merge
    deploy applies 0040 — with a throwaway customer: one Blob photo upload, two
    parallel finding pushes and the PDF render (`QUOTE_PDF_ORIGIN` / Chrome).
    Not on a preview: previews skip migrations, so their company and venue
    reads fail without `short_code`. Punch item #340.

60. ✅ **Email thread visibility** (#341, D1004–D1016) — Jeff, Oct 14: you see
    only your own information or what is deliberately linked to an entity. One
    pure rule, `canSeeThread` (`src/lib/stores/comms-visibility.ts`,
    re-exported from `comms.ts`): not in Deleted, and my mailbox, or (not
    someone else's draft) assigned to me, or linked by `customerId` / `siteId`
    / a work `link` / `linkedContactIds` **deliberately** (`hasDeliberateLink`:
    `CommThread.linkedBy` "user" | "filing", a filed #335 filing, or a legacy
    proof — never the automatic sender match or `resolvedContactId`).
    `linkThread` / app-created threads / adopts / a person's Gmail label set
    the flag, #335 filing sets "filing" and Undo restores it; a resweep a
    person triggers touches only their own mailbox. The Inbox reader opens
    only `canOpenThread` and shows a teammate's thread **read-only** (banner,
    no write control, no link / task payload, no mark-read); every Inbox
    server action that takes a thread id checks the owner first
    (`src/lib/inbox-thread-guard.ts`; the harness builds the audit list from
    the source). Start here: an assignee's Done / Reassign re-check the thread
    at action time, and an admin viewing a teammate's list sees "Private
    email" rows (redacted on the server). The company page and activity feed
    list deliberately linked threads plus my own; ⌘K cuts thread candidates in
    SQL with `canSeeThreadCond` through a new additive `searchDocs`
    `where: DocCond` (`docCondSql`); Ask AI reads through `loadThreadReadable`,
    while replies, task / estimate drafting and task thread links stay
    own-only (`loadThreadFor`). Tests: `npm run test:thread-visibility` (in
    test:specs). No migration. Tell the team: an email becomes visible to
    teammates once it's filed/linked; assigned emails are read-only +
    Done/Reassign from Start here. Remaining is Jeff-gated: tell the team,
    re-link old hand-made customer links that should be shared, try two
    accounts on production. Punch item #341.

61. ✅ **Venue Assessment notes** (#344, D1019–D1032, D1038–D1051, D1208–D1218) — Jeff's Oct 14 notes on
    the Venue Assessments (`FS-####`) editor, three slices on one branch
    (spec `docs/superpowers/specs/2026-10-14-venue-assessment-notes-design.md`).
    ✅ **Slice A (form structure & flow):** a new section order with **Kill
    questions** as the Brief's third section — Scope (rigging / curtain /
    lighting / av), one **Rigging system** answer at
    `disciplines.rigging.present` (asked once, read-only in the Rigging intake)
    and stage width / depth; the quote half of Existing materials & quote only
    for Purpose "New system design" (`isQuoteVisit`); Sign-off removed from the
    editor; new assessments assigned to the creator and scheduled today;
    collapsible sections remembered per viewer; Final thoughts internal tags
    (settings key `surveyInternalTags`, Settings → Field & Venues, staff-only,
    never printed); a customer recap in Wrap-up, "What we heard" on the field
    sheet and in the findings text. Rules are pure: `src/lib/survey-flow.ts`
    (order, `sectionVisible`, quote rule, recap), `survey-migrate.ts`
    (read-time steps that never delete a key; unmappable answers become
    derived, never-stored `legacyNotes`, shown as Older notes),
    `survey-tags.ts`; the sticky progress rail is the shared
    `src/components/section-rail/section-rail.tsx` (extracted from the
    Assessments engine, output unchanged; jumps scroll `main.pk-main`). An
    older survey with no derivable scope reads "Intake: draft" until Scope is
    answered. The field sheet is not scope-filtered. Tests:
    `scripts/test-va-notes.ts` (in test:specs). No migration, no env var.
    ✅ **Slice B (field-level changes, D1038–D1051):** fixed pick lists in
    `src/lib/field-lists.ts` (lifts, loading doors, track series / operation,
    plug, lighting and fixture positions, console location — the Assessments
    engine gains the same lists additively, version still 1); access reshaped
    (loading door, Lift needed → type / height / who supplies); travel
    auto-fill for a verified venue (`survey-travel-server.ts`, once, into empty
    fields only); measurement links (Grid height, Loading gallery, line set
    count); beams drawing checks; per-discipline scope-first chips with Other
    (`sections/scope-chips.tsx`), goals stored as lists (`goals-list.tsx`;
    `goalsFromSurvey` still returns text), curtain rows (`curtain-rows.tsx`),
    lighting positions + a Position column on the fixtures inventory
    (`lighting-positions.tsx`), the Bad→New 0–4 condition slider
    (`condition-slider.tsx`, `--cond-0…4`) and a quantity-first line set
    schedule with Fill down; a wrap-up Final questions section. Rules: the
    read-time steps in `survey-migrate.ts` fill only never-answered keys, so a
    cleared field stays cleared (write-once `…Old` keys keep unmappable text for
    Older notes); plain-text readers (sheet, findings, Assist, Ask AI, recap)
    share `survey-format.ts` and `survey-measure-fields.ts` and show only what
    the editor shows. No migration, no env var. **No instant rollback past the
    slice B merge** — a slice A build reads list goals as empty and deletes them
    on the next save; roll forward.
    ✅ **Slice C (drawing & photo capture, D1208–D1218) — merged
    2026-10-17 at Jeff's request, before his iPad + Apple Pencil test:**
    a Pencil-first ink pad (`src/components/ink/`, pure model `src/lib/ink/`;
    palm rejection, Draw with finger) saving strokes JSON + a flattened JPEG;
    sketch pads in their sections (Beams, CW elevation / Brick with
    counterweight, Stage plan / section, House section / plan, the line set
    schedule's Fill in by hand sheet) on backgrounds drawn from the
    measurements (`src/lib/ink/backgrounds.ts`; CW Elevation and the line set
    sheet are placeholders); Add photo on every section with caption and
    markup that never touches the original; files through the engine's device
    queue (kind from the `AS-` / `FS-` prefix) to private Blob at
    `surveys/<FS-id>/<p_|m_|k_|s_…>` (`src/lib/field-files/`, broker
    `/api/surveys/[id]/files/upload`, bytes `/api/surveys/[id]/files/[fileId]`);
    one merge rule (`mergeSurveyFileRefs`: a finished slot wins, delete only
    seen ids), the survey advisory lock, per-editor save stamps
    (`save-stamp.ts`, hidden `_saveSeqs` with `fullSeq`) and file-only writes
    that never bump rev; a streamed field-sheet PDF with photos and sketches
    (`/api/surveys/[id]/sheet-pdf`); 3D Orbit / Plan / Section / Elevation +
    Wireframe. Replaced files stay in Blob (D1215). No migration, no env var.
    Remaining: Jeff's iPad + Pencil test on production (script in PUNCHLIST
    #344); plus
    Jeff-gated: review the internal tag
    list and the pick lists in `field-lists.ts`, tell the reps older surveys
    ask for Scope first, send the CW Elevation and line set schedule sheets,
    try a real assessment end to end. Punch item #344.
62. 🚧 **Estimate parties — slices 1, 2a, 2b-i, 2b-ii, 3, 4, 5 + 6** (#348, D1058–D1062, D1074–D1097, D1105–D1119, D1140–D1157, D1166–D1184) — Jeff, Oct 14: an
    estimate can name more than one company. Slice 1 is the parties core: a
    `record_parties` doc collection (migration 0041; id `pty_` + sha1 of
    record type, record id, company and role) with roles owner · gc · ec ·
    architect · consultant · vendor · other (typed label), at most one owner
    per record, soft-delete and revive. Pure rules in `src/lib/parties/`
    (`rules.ts`, `vm.ts`), store `src/lib/stores/parties.ts`, server view
    `view-server.ts`. One shared editor (`src/components/parties/`) sits on
    the lead drawer, an Estimator Parties chip and the project page, and the
    company page gains a Bids & roles card (live records only). Parties carry
    lead → estimate (everything except GC/EC) on first save and on convert,
    and estimate → project on creation — all three (estimate save, lead
    convert, project spawn) run through `withSavepoint`
    (`src/db/index.ts`) so a failed copy never undoes a save or a win. The
    opportunity board skips a lead that has a non-lost estimate (they carry
    the value and inherit its forecast; a lead whose estimates are all lost
    stays on the board) and the lead drawer lists them with a total.
    A company on any live party row can't be deleted. Writes need `create`.
    Tests: `scripts/test-parties.ts` (in test:specs). Remaining: slices 2–6
    (spec §10: bids, split systems, vendors, Read the PDF, portal + reports).
    Renumber migration 0041 at merge if another branch lands one first. Not on
    a preview: do not deploy a Vercel preview of this branch — previews share
    the production Neon DB and skip migrations, so `record_parties` doesn't
    exist there and every company page (Bids & roles card), the lead drawer
    card, the project card and company delete would throw. After the merge
    deploy applies 0041, on a throwaway customer: link an owner and a GC on
    a lead, convert it / save an estimate from it (the owner carries, the GC
    doesn't), mark it Won so a project spawns, and confirm the project lists
    the owner — the only real run of the postgres-js savepoint path — then
    delete the test records.
    ✅ Slice 2a (D1074–D1078, Oct 15) — bids: `Quote.bid` `{dueAt, addenda,
    awardedPartyId}` (one writer `patchQuoteBid`; not content in 2a and never
    bumps `updatedAt` — 2b re-adds both with a PDF re-render) plus per-bidder state on the quote's GC/EC party rows (`setPartyBid`),
    composed by `src/lib/stores/bids.ts`; pure rules in `src/lib/parties/`.
    Every bid write takes the quote row lock first (`withQuoteRowLock`, the
    order `setStatus` uses). A Bid chip (due date + addenda) in the Estimator
    header and a Bidders card on Send & track: add GC/EC, submit via email or
    the bidder's own bid site (per-bidder link; a company default is deferred),
    GC bid #, **Mark submitted** (a manual Rev N stamp, the stand-in for
    emailed bids until 2b), Award / Undo award. The owner stays the customer
    (venue ids are per company); the winner is `bid.awardedPartyId`, other
    pending bidders become "Lost the award", and the project stamps
    `billToCompanyId` at Won (own savepoint); losing bidders (lost / withdrew /
    no bid) don't carry to the project. Surfaced on the Quotes hub
    ("Out to bid"), ⌘K by bidder name, Morning triage "bid due" and the
    project's Bill to. Remaining: 2b (per-bidder PDFs, client links, send to
    all), then slices 3–6; prod check adds due date → two bidders → Award →
    Won → Bill to. Punch item #348.
    ✅ Slice 2b-i (D1079–D1082, Oct 15) — addressed documents + per-bidder
    PDF: a customer document is addressed explicit bidder → awarded bidder →
    none (venue always from the owner; "Prepared for <GC>", an "Owner: …"
    line and a "Bid due … · Addenda acknowledged: …" line only when
    addressed) through the print route, document loader (web / portal /
    share), cover and package-live loaders; the in-app live BOM preview, the
    datasheet-book cover and cut sheets stay owner-addressed, and a frozen
    sent revision shows the live awarded bidder. `bid` is content only once
    awarded (`quoteContentKey`; still no `updatedAt` bump), and Award / Undo
    schedule a PDF re-render. The Bidders card's Download PDF hits
    `GET /api/quotes/[id]/bidder-pdf/[partyId]`, a signed `?bidder=` print
    variant (strict — a bad bidder is a 404) rendered on demand, named
    `Peak – <project> – <bidder> – Rev N.pdf`.
    ✅ Slice 2b-ii (D1086–D1096, Oct 15) — send to bidders: the Bidders card
    gains Send / Retry per email bidder and **Send to all bidders** (one server
    call per bidder under the per-quote claim; row failures stamp `failed` and
    the walk continues, quote-level refusals stop it, a maybe-sent Gmail result
    is `failed.unknown` with a confirmed Retry). Each email carries its own
    bidder PDF (the sent revision rendered for that bidder, stored under
    `quote-pdfs/<id>/bidder-…`) and a **v3 client link** (`<exp>.<rev>.<hex>.<mac>`,
    same nonce as v1/v2 so Revoke kills it) to a package page addressed to the
    bidder; lost / withdrew / no-bid pages open read-only as "This bid is
    closed.", responses carry `partyId`, and opens count per bidder row
    (`opens`, never `Quote.shareOpens`). Bidder revisions are sent revisions,
    a revised bid gets an "(Addendum N)" subject, and Mark submitted stays for
    website rows. Open for Jeff: owner Rewards line on bidder copies, the shared
    response budget, addendum acknowledgement after a send.
    ✅ Slice 3 (D1097, Oct 15) — split systems: Move system → New estimate
    (one system per move) puts the new estimate on the source's live lead
    and copies the source's non-bidder companies; Move → existing copies
    nothing.
    ✅ Slice 4 (D1105–D1117, Oct 15) — vendors: a vendor quote links a vendor
    company (live `vendor`/`manufacturer` or legacy spellings, validated on
    save and on move/copy; the vendor party is added once, removal refused
    while a live quote names it); Gmail attachments are listed by reference
    and served through `/api/inbox/attachments/…`; the Inbox gains **Add as
    vendor quote…** (the `?vq=<thread>~<message>~<index>` URL hand-off,
    PDF-only, copied server-side under 25 MB and stripped from the URL before
    the copy) and **File to estimate / project…**. A Vendors card (Build
    package → BOM quote, Send & track), "Quotes we've received" and project
    Procurement read vendor quotes and filed vendor threads. The broker rule:
    reads use `canSeeThread` (SQL `canSeeThreadCond`, then JS; never a body,
    snippet or count of an invisible thread), writes use `ownThread`.
    ✅ Jeff's bid follow-ups (D1118–D1119, Oct 15): each bidder gets its own
    response limit and cap, and an addendum added to a sent estimate moves it
    back to Draft, so Send revision goes to every pending bidder.
    ✅ Slice 5 (D1140–D1157, Oct 15) — **Read the PDF**: the Assist feature
    `vendorpdf` (opt-in, pilot users; Haiku 5.5, Try harder on Sonnet 5.5; env
    `ASSIST_MODEL_VENDORPDF` / `…_HARD`; 30 reads per user per hour) reads a vendor
    quote's PDF into the Estimator's vendor quote form. Documents are Claude-only
    (`ProviderRequest.document`; never the local provider; the button is hidden
    without a key). Bytes come only from a Blob path the vendor quote owns or the
    form's data-URL, size-checked first (about 23.8 MiB after base64, 100 pages),
    under a deadline of about 108 s from the action's start. Pure checks flag and
    never fix (line math, sum against total, catalog chip, exact-name vendor
    company, freight pre-tick); freight and tax stay inside the total; Description
    is prefilled when blank. `VendorQuote.extracted` is server-verified on save by
    run hash (Move / Copy verify but never score), accuracy is scored once at the
    first save, any later read replaces the earlier run, and Settings → Assist
    pilot → Vendor PDFs reports by model and vendor. Pure modules in
    `src/lib/vendor-pdf/`; tests in `scripts/test-vendors.ts`.
    ✅ Slice 6 (D1166–D1184, Oct 15) — portal + reports. **Portal bidder rule:**
    a GC/EC with a grant sees, read-only, the estimates it bid on — its own
    latest revision (delivered to it, or frozen to it after the award; a
    frozen one counts without `revSent`), result pending or awarded, Lost shown
    as "Closed", Won to the awarded bidder only, Draft "being revised". One
    gate: `portalOnlineEstimateState` in `src/lib/quote-pdf/portal-access.ts`
    composes `portalBidState` (`src/lib/parties/portal-bid.ts`) with rows passed
    explicitly (none = unavailable); `portal-bid-server.ts` is the only portal
    reader of `record_parties`; every portal write stays customer-only. The
    online page is addressed to the bidder, and its PDF renders on demand at that
    revision (`renderBidderPdf` with `rev`, 6/min per grant, `maxDuration = 60`;
    a non-404 failure shows one line and logs the reason). **Owner Scope only:**
    once an estimate has bidders, the owner's portal shows a BOM with no prices
    (`portal-owner-bom.ts`; no PDF, photos, Accept, Refresh, Copy or Rename;
    vendor lines show the description only), sticky via the store-owned
    `Quote.bidScopeOnly` stamp (`markBidScopeOnly`; set by `addBidder` and by
    re-adding a removed bidder company; soft-deleted rows count; carried by
    Move/Copy system → New estimate for the same customer, fail-closed; not by
    a Move/Copy into an existing estimate). Portal only — staff Send & track and
    the owner's client links are unchanged. **Report:** Reports → Bids by GC/EC
    (`bids-by-bidder`; `bid-report.ts`, `bid-report-server.ts`,
    `_dashboard/widgets/bids.tsx`; no perm, after Pipeline by estimator in the
    preset): Sent = delivered, Open = pending on a draft/sent estimate, GC
    awarded = awarded + lost, Awarded to us, Withdrew/no bid apart, rate =
    awarded ÷ decided ("—" if none), period = due date (a future one counts as
    now) else last send, one row per company and role, bounded to 5,000 rows.
    Tests: `scripts/test-bids.ts` (in test:specs), including the portal file
    inventory.
    Remaining: Jeff's confirms and prod checks for slices 5 and 6 (PUNCHLIST
    #348). All #348 slices are built.

63. ✅ **Mailbox identity** (#349, D1063–D1073) — mailbox ownership follows the user's id (`CommThread.mailboxOwnerId`; one rule `ownsMailbox`, stamp → Gmail key → a name only one user holds, else nobody; `ownMailboxCond` in SQL; viewers from `src/lib/mailbox-viewer.ts`), assignments carry `assignedToId`, creators refuse a blank owner, legacy threads stamp lazily in write guards and via `npm run comms:stamp-owners` (Jeff-gated prod run; shared names get the `"unresolved"` tombstone), a rename or new hire never moves mail (`src/lib/mailbox-names.ts`), and Settings → Team refuses duplicate names. Punch item #349.

64. ✅ **Move lines between systems** (#357, D1201–D1207) — on the Estimator's
    Build step, tick lines (or ⇄ one) and move them to another system, a New
    system… (inserted after the source) or Another estimate… (lands as one
    "<name> (moved)" system through `moveSystemToEstimateAction`). A preview
    lists every side effect first. Lines keep their prices byte-for-byte;
    partners travel (curtain ↔ track per `linkCurtainTracks`, whole labor
    groups); a typed system price clears on both sides; stars and labor drafts
    follow, re-minted on collision. Lines are addressed by `{ sectionId, id }`
    because ids are unique per system only. The server now re-ids colliding
    ids on any move or copy into an existing estimate (`reid.ts`), and the
    package document's anchors follow a move (`package-doc/reanchor.ts`). Pure
    rules in `src/lib/estimate-line-move/`; UI `move-lines-bar.tsx`; checks in
    `scripts/test-estimate-line-move.ts`. No migration. Remaining: Jeff tries
    it in production; follow-up for `removeItem` / `patchItem` bare-id
    matching on estimates that already hold duplicate ids. Punch item #357.

65. ✅ **Estimate photo wrap + PDF appendices** (#358, D1219–D1227) — key-product photos spread
    down each system's text (`src/lib/estimate-output/photo-spread.ts`: photo k before unit k,
    sides alternating, the system body the only float box) with a model-number tag on the outer
    bottom corner (`photo-models.ts`, `loadKeyProductModels`), in the PDF, online estimate,
    package page and the Build package document (product blocks are plain blocks now) + editor.
    The PDF (print layout only) opens on a title page (cover note there, no investment band),
    pricing follows the narratives, the BOM appendix is last; then the client's drawings merged
    with pdf-lib at their own page size (`src/lib/quote-pdf/appendix-*.ts`; 25 MB a file, the
    finished PDF kept ≤ 14 MB for email — drawings that don't fit are left out with a note and
    stay on the package page; notes on `pdf.notes`, never a failure) and a page of permanent
    datasheet links (`/d/ds/<quote>/<doc>/<sig>`,
    `src/lib/estimate-output/datasheet-link*.ts`, public in middleware).
    The print route's `?part=main|tail` splits around the drawings; `pdfAppendixKey`
    (`appendix-key.ts`) re-renders on drawing / selection changes without bumping updatedAt.
    Bidder PDFs get the order but no drawings or links. No migration. Remaining is Jeff-gated:
    `QUOTE_PDF_ORIGIN` in production, a real estimate with drawings and datasheets on
    production, and a long cover note. Punch item #358.

66. ✅ **Box goods sale** (#362, D1247–D1248) — an Estimator system estimate can be a box goods
    sale (equipment + freight only): `Quote.boxSale` (absent = false; true on system estimates only),
    set from + New quote → Box goods sale (`?box=1`) or the Quote details switch, shown as a header
    chip. Pure rules in `src/lib/estimate-box-sale/rules.ts`. Content and frozen in revision
    docFields; `quoteDocumentDataFor` returns `bomViewProps` for it (one seam), the print route prints
    #360's BOM layout with no cut sheets / links / drawings, the Cover PDF 404s and is never attached,
    and the client package page is the itemized list only (zip / datasheet book 404). Build hides the
    narrative and labor controls and adds systems Itemized; Build package is BOM quote only; Customer
    review is Document + BOM; readiness is quiet; the email says "Attached is our quote … You can also
    view it online here: {link}" (subject "quote" too). A save with any labor line is refused (server
    and browser). Nothing narrative is deleted — switching off restores it. No migration. Remaining is
    Jeff-gated: one real box-sale estimate sent to himself on production. On a box sale, the BOM quote tab carries Show prices / Show quantities, Payment terms, Terms, Options and Cover note (the Client package tab is hidden; the cover note's text stays in the header's Quote details) and hides #364's Labor switch (Jeff 2026-10-22). Punch item #362.

67. ✅ **Markup pricing** (#367, D1286–D1297) — every pricing percentage is markup on
    cost (`sell = cost × (1 + markup)`), not margin on price, with no saved sell amount
    changing. The math is rewritten (approach B), not relabelled: `src/lib/markup/` is the
    one pure converter (`sellAt`, `markupOf`, `costFromSell`, `marginToMarkup`,
    `roundMarkupPct`, `legacyTwinOf`), and the Estimator, the flame / repair / inspection
    engines, travel, renewals, portal pricing, curtains, the Grid, Quick Design and the
    dashboard price through it. Persisted fields keep their names (`margin`, `tierMargin`,
    `rates.margin`, `partsMargin`) and hold markup once stamped. `quotes` and `projects`
    convert on read exactly in `hydrateDoc` (`pricingBasis: "markup"`; builders and seeds
    stamp — a new writer that skips `buildQuote` must stamp too); settings blobs convert once
    under `updateBlob`'s row lock and round to a whole % (`_pricingBasis`, old values in
    `_marginBackup`): tiers 43/37/28/25/18/11/5, service / repair / catalog rates 43. The
    "legacy twin" rule keeps an old exact 42.857 % counting as at-the-tier-seed; same-tier
    compares use whole percents. Every screen, report and export says Markup (sliders
    0–125 %, service knob 10–100 %, rate cap 150 %, low warning under 11 %, one % column on the
    review spreadsheet). Price-parity harness (`scripts/test-markup.ts` against
    `docs/markup/parity-baseline.json`): 0 drift; only rounded defaults move (Base on $1,000
    $1,428.57 → $1,430, custom part $100 → $154, default curtain on $700 $1,000 → $1,001,
    Silver portal part on $70 $89.74 → $89.60). `test:specs` also runs `npm run
    test:markup-settings`. No migration. **No rollback past the merge; never preview-
    deploy the branch — and after the merge never preview a branch not rebased onto #367**
    (it would run margin code against the production DB, D1291). Remaining is Jeff-gated: `db:export`, a quiet-time deploy, check the
    tiers and one quote of each type, whether to set cleaner tier values. Punch item #367.

68. ✅ **ETC price sync** (#368, D1298–D1303) — Catalog → Import price book →
    **Connect a manufacturer** is a MyETC connection: an admin-only API key stored
    encrypted in the `dealer_connections` blob (`src/lib/dealer-api/connections.ts`;
    `etcSecret()` is the only decrypt), Test connection on v1 `/me/business-accounts`,
    and **Pull prices** of ETC's four v0 dealer lists (finished goods, spare parts,
    flat-rate repair, demo) into a chunked snapshot (`etc_price_pull`) with a per-list
    preview, then a resumable **Import** (`src/lib/dealer-api/etc/`: `client`, pure
    `parse` / `plan`, `apply`). Cost = netPrice, List = listPrice; new parts added;
    description / category never overwritten; ETC-only matching by P/N then a guarded
    model fallback; deleted parts never return. `CatalogPart.demoPrice` /
    `demoPricedAt` / `etcPriceList` are internal (part editor only). A daily rider on
    `/api/drive/sync` applies `price-updates/{baseline}` (new parts too) within a
    bounded budget and continues a large delta next run. Sent estimates keep their
    prices: re-pricing actions are locked until Revise (`src/lib/estimate-reprice/lock.ts`;
    server-enforced for copy / move / Load system / the tier stamp, UI-only for the
    configurators), and Revise re-prices plain catalog lines by ratio inside
    `setStatus` (`estimate-reprice/rules.ts`, the save's own `deriveEstimatorSections`),
    storing `Quote.repricedOnRevise` for a Build banner. Preview deploys and
    `ETC_SYNC_DISABLED=true` refuse every ETC action. No migration. Remaining is
    Jeff-gated: a MyETC API key, the first Pull on production (check the "new" count
    against duplicates) and Import, the next morning's sync line. Punch item #368.

69. ✅ **Curved track layout + Preliminary cut sheets** (#369, D1304–D1310) — a curved
    track is a 1–12 segment path of straight and arc segments (`src/lib/track-path/`;
    `runFt` = path length, `radiusFt` = tightest arc, legacy curves read as one left arc
    at the same price) priced per segment with a hanging point at every joint. The Track
    configurator edits it as a segment list with presets and a live plan
    (`estimator/track-segments.tsx`). A curved type gets a layout view
    (`src/lib/curtain-cut-sheets/layout.ts`; concave side to the AUDIENCE) — CS-n.1 in
    Submittal, beside "How it hangs" in Client; oversize shrinks to fit, reads NTS. Every
    cut sheet carries the always-on PRELIMINARY — NOT FOR CONSTRUCTION stamp. No migration;
    roll forward. Remaining is Jeff-gated: `curvedSectionFt` / `minRadiusFt` per series,
    then a real curved track printed on production. Punch item #369.

70. 🚧 **Grid room shape editor — slice 1** (#370, D1311–D1316) — the Grid intake gains a Shape the room step: the stretched template freezes into a `RoomShape` (`src/lib/design/room-shape/`: rooms and zones in feet, line / arc / Bezier edges, walls vs. openings read from the drawing's double lines, roles on rooms) edited in `src/components/room-shape/room-shape-editor.tsx` (corner drag + snap + glue, Add point, Curve, Free-form, Wall ↔ Opening, typed lengths / radius / arc length, undo / redo); a shaped intake locks its dimensions until Reset to template. `saveGridIntakeAction` sanitizes it (`sanitizeRoomShape`) before it writes any customer or venue (`newVenueKindFor`, shared with the quote intake), `generateBaseSheet` draws the base sheet, Spaces (`fromRoom`) and calibration from it and stamps `baseSheetShape` / `baseSheetFrame`, and Auto fill lays out on the stamp (`venueFrame` shape branch; a proscenium or Gym Stage hangs side lights and line arrays at the opening, not the wings). No migration. Remaining: slices 2 (rooms + zones, roles) and 3 (reopen after Create, DXF); Jeff reviews `docs/room-shape/renders/`. Punch item #370.

71. ✅ **Estimating-core extraction** (#359, D1228–D1230) — handoff PR 1. The Estimator's persisted
    domain types and twelve pure helpers live in `src/lib/estimating-core/` (entry `index.ts`:
    flat domain exports plus namespaced pure `src/lib` modules); the twelve old helper paths are
    `export *` shims and the route `types.ts` re-exports the core types. `npm run core:check`
    (TypeScript-API closure walk, in test:specs) keeps the core browser-pure;
    `npm run core:golden` prices export files into golden totals (fixtures in
    `docs/estimating-core/`). Quick Design types now live in `src/lib/design/quick-types.ts`.
    No behaviour change. Next: handoff PR 2, the HTML prototype package (needs Jeff's production
    export).

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
taken without asking.
