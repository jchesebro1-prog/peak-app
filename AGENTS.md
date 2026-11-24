<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Quartzite — the Peak Systems Group business app

The app is CRM, the Estimator, the Catalog, the Quotes hub, Reports, Settings
and Import / Export. It was larger: on 2026-11-20 four removal stages took out
Project Management, the Inbox / Gmail / Krisp / AI layer, Flame Tests /
Inspections / Venue Assessments / the customer portal, and the Design tab (see
"What the app is now" below, and `docs/removal-log.md`).

It began as a port of an HTML prototype (`/Users/sm/Downloads/design_handoff_claude_code/`
on the original machine — not in this repository). Its `app/*.js` store
modules set the field names, id formats and pricing math that the kept code
still follows. Extracted UI/architecture specs live in `docs/specs/*.json`;
many of them describe removed screens.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4) — UI + server API
- **Drizzle ORM** on Postgres — prod: `DATABASE_URL` (Neon); dev: embedded
  PGlite in `.data/` (auto-created, auto-migrated, auto-seeded)
- **Auth.js v5** — Google SSO for sign-in only (no Gmail, Calendar or Drive
  access); `users` table = invite list; JWT sessions with per-request role
  refresh; dev sign-in picker via `AUTH_DEV_LOGIN`
- **Vercel Blob** for files (datasheets, catalog photos, documents, estimate
  drawings, saved quote PDFs); headless Chrome (`puppeteer-core` +
  `@sparticuz/chromium`) renders the PDFs
- Deploy target: **Vercel + Neon** (see DEPLOY.md) — but host-agnostic
- No AI and no email: the app is deterministic and sends nothing

## Run

```bash
npm run dev        # http://localhost:3000 — no DB setup needed (PGlite)
npm run build      # applies prod migrations when DATABASE_URL is set, then builds
npm run db:seed    # idempotent fixtures (roster + settings)
npm run db:generate     # new migration after editing src/db/schema.ts
npm run db:reset-local  # wipe local PGlite + reseed
npm run test:specs      # the main harness (scripts/test-review-and-spec.ts) on a throwaway database, then test:markup-settings
```

Every `scripts/test-*.ts` also runs alone: `PGLITE_PATH=<an empty temp dir> npx tsx scripts/<name>.ts`
(never against `.data`, and one at a time). Type-check with
`NODE_OPTIONS=--max-old-space-size=7000 npx tsc --noEmit` (the harness is large);
lint with `npx eslint src --quiet`.

Node lives at `~/.local/node/bin` on Jeff's machine (in `~/.zprofile` PATH).

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
  (`u1`, `Q-2041`, `EST-1001`…), lifecycles, and copy. Timestamps are
  epoch-ms numbers. Deviations get a DECISIONS.md entry.
- **Design tokens** are CSS variables in `src/app/globals.css` (`pk-*`
  component classes). Fonts: Public Sans (UI) + IBM Plex Mono
  (badges/emails/counts) via next/font. Accent is user-configurable
  (Settings → Branding) and flows through `--accent` set on `<html>` in the
  root layout — never hardcode accent-colored UI.
- **Nav shell:** `src/components/nav/Nav.tsx` + route map in
  `nav-data.ts` (Home · Estimating · Customers · Knowledge). Screens live
  under `src/app/(app)/`.
- **Auth:** `requireUser()` / `requirePerm(perm)` from `src/lib/session.ts`
  in every server component/action that touches data. Permissions come from
  `src/lib/team.ts` (`ROLE_PERMS` — port of team.js).
- **DB:** schema in `src/db/schema.ts`; after editing run
  `npm run db:generate` and commit the `drizzle/` output. Dev applies
  migrations automatically at startup; prod applies them in the build step.
- **Stores → tables:** each record type is a JSONB document collection
  (`src/db/doc-tables.ts`, read and written through `src/db/doc-store.ts`)
  with a `src/lib/stores/<store>.ts` module that owns its rules; companies,
  venues and people are real tables (`src/lib/identity/`). Collections of
  removed features stay registered and are never wiped
  (`CONFIG_COLLECTIONS` in `src/db/seed-data.ts`) — do not drop them.
- Client components only where interactivity requires; server actions for
  mutations; `revalidatePath` + `router.refresh()` replaces the prototype's
  `rss-*` events.

## Environment (.env.local / Vercel env)

`AUTH_SECRET` (required; also the key for stored secrets and signed links) ·
`DATABASE_URL` (prod) · `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` (Google sign-in) ·
`AUTH_DEV_LOGIN` (never in prod) · `BLOB_READ_WRITE_TOKEN` (files) ·
`QUOTE_PDF_ORIGIN` (required in production for PDFs) · `CRON_SECRET` (the daily
`/api/drive/sync` job) · `DISPLAYS_API_TOKEN` (optional). See `.env.example`.

## What the app is now

Top-level nav: **Home · Estimating · Customers · Knowledge**, plus Settings and
Account from the user menu. Everything below exists in the code today.

**Home and Reports**
- `/` — dashboard of registry widgets (my pipeline, leads, needs attention, team
  activity, catalog) and the stage sheet. `/reports`, `/reports/sourcing`,
  `/reports/estimator-bonuses`.
- `src/lib/dashboard/` (registry, layouts, metrics), `src/app/(app)/_dashboard/`,
  `src/lib/nav-counts.ts` (nav badges and the to-do bell: approvals, back from
  review, lead follow-ups).

**Customers (CRM)**
- `/opportunities` (the board), `/leads` (+ the public `/lead-intake` form),
  `/companies`, `/people`, `/venues`, `/vendors`.
- Companies, venues and people are tables: `src/lib/identity/`. Leads:
  `src/lib/stores/leads.ts`. Notes, documents, parties (the companies named on
  a lead or estimate): `src/lib/stores/{notes,documents,parties}.ts`,
  `src/lib/parties/`. Vendors and price-list status: `src/lib/stores/vendors.ts`,
  `src/lib/vendor-status.ts`. Venue types, calendars and address
  verification: `src/lib/venue-types.ts`, `src/lib/stores/venue-calendars.ts`,
  `src/lib/address-verify/`.
- **Booth capture**: `/leads/shows`, `/leads/booth`, the public contact card
  `/c/[slug]`. `src/lib/booth/`, `src/lib/stores/booth.ts`. It is the only
  offline feature: `src/lib/sync/` (outbox + SyncEngine), `/api/sync/push`,
  `public/sw.js`, and the Capacitor shells in `ios/` and `android/`.

**Estimating**
- `/estimator` — one URL, four steps (Build · Build package · Internal review ·
  Send & track). State lives in `src/app/(app)/estimator/use-estimator-state.ts`;
  pricing in `estimator/pricing.ts` and `src/lib/markup/` (every percentage is
  markup on cost). Rules by area: `src/lib/estimate-steps/`, `estimate-groups/`,
  `estimate-bonus/`, `estimate-box-sale/`, `estimate-line-move/`,
  `estimate-live-save/`, `estimate-reprice/`, `estimate-review/`,
  `project-discounts/`, `package-doc/`, `narrative/`.
- Configurators on a system: curtains (`src/lib/design/curtain-pricing.ts`),
  track (`src/lib/track-engine.ts`, `track-path/`), pipe and lineset
  (`src/lib/rigging-config/`), fixture assemblies, labor, vendor quotes
  (`src/lib/vendor-quotes/`).
- Customer output: the estimate PDF and cover PDF (`src/lib/quote-pdf/`, print
  routes `/print/quote`, `/print/cover`, `/print/cutsheets`), the client link
  and package page (`src/lib/quote-share/`, `src/lib/estimate-output/`,
  `/share/quote/[id]/[token]`), curtain cut sheets
  (`src/lib/curtain-cut-sheets/`, `/estimator/cut-sheets`), the datasheet book
  and package zip (`src/lib/part-docs/datasheet-book*.ts`,
  `estimate-output/package-zip-server.ts`). Drawings ("Plans & risers") are
  uploaded by hand. Nothing is emailed: download the PDF or copy the link, then
  mark the estimate sent.
- Bids (GC / EC bidders on an estimate): `src/lib/stores/bids.ts`, `src/lib/parties/`.
- `/quotes` (the hub), `/quotes/new` (intake: system, box goods sale, custom
  category), `/reviews`. `src/lib/stores/quotes.ts` is the one quote store
  (status moves, revisions, approval gate). Approval: `src/lib/quote-approval-rules.ts`,
  `review-limits.ts`, `quote-next-step.ts`. Numbers: `src/lib/estimate-number.ts`.
  Pipelines: `src/lib/pipelines.ts`. Old flame-test, inspection, repair, rental
  and consulting quotes are hub rows only (`hasNoBuilder` in `src/lib/quote-links.ts`).
- `/catalog` and its screens (`/catalog/documents` — datasheets, photos, manuals;
  `/catalog/manufacturers`; `/catalog/model-numbers`; `/catalog/rack-data`).
  `src/lib/stores/catalog.ts`, `src/lib/part-docs/`, `src/lib/catalog-rename/`,
  `src/lib/dealer-api/` (ETC price sync). A part's spec text is edited in the
  part editor's Spec panel (`src/lib/specs/`, the `spec-*` stores) and served
  by the read-only Displays API (`/api/v1/displays/*`, `src/lib/displays-api.ts`).
- The builders that feed the Estimator, at their old `/design/...` routes:
  **Assembly Builder** `/design/assemblies` (fixtures, systems, hardware and
  equipment racks — `src/lib/fixture-assemblies.ts`, `src/lib/stores/fixtures.ts`,
  `src/lib/rack/`, `/print/rack`, `/api/racks`), **Lineset Builder**
  `/design/lineset` (`src/lib/design/{lineset,goods,steel,venue-dims}.ts`,
  `src/lib/stores/studio-designs.ts`) and **Motor Library** `/design/motors`.
  `/design` and the other old paths redirect (`src/lib/design-routes.ts`).
- `/estimating-rules` (+ track series, pipe types, lineset types, curtain
  mounts, system categories): `src/lib/stores/pricing.ts` and the per-screen stores.

**Knowledge** — `/knowledge`, `/knowledge/steel`, `/knowledge/fixtures`.

**Settings, Account, Import / Export**
- `/settings` (Company, Sales, Field & Venues, Team & Access, Data & Tools —
  `settings-sections.ts` is the map), `/account`, `/import` (customers,
  contacts, venues, leads, team, quotes, catalog; `src/app/(app)/import/registry.ts`).
- `src/lib/settings.ts` (the one settings row), `src/lib/team.ts` (roles and
  permissions), `src/lib/session.ts`.
- One daily cron, `/api/drive/sync` (venue address stamp + the ETC price sync) —
  the path keeps its old name.

**What is gone, and where it went**
- `docs/removal-log.md` — the four removal stages: what was deleted, what rules
  changed, which helpers moved, what stored data stays, and the loose ends.
  Read it before touching anything that looks half-used.
- `docs/phase-history.md` — the old phase-by-phase build notes (many describe
  removed code).
- `docs/handoff/` — the specs and data exports for the removed features, which
  are being rebuilt as separate programs (`docs/handoff/programs/`).
- Tables and stored records of removed features were left in place. Never edit
  `src/db/schema.ts` tables or `drizzle/` to tidy them up without Jeff's say-so.

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
taken without asking.
