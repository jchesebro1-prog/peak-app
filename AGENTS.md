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
   drafts and scope assembly are rules-based (D75/D86).**
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

42. ✅ **Estimator in four steps** (#305, D643–D684) — Phase 1 ✅ (the frame): the
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

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
taken without asking.
