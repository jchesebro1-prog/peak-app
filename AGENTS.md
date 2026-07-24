<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Peak Backend — production rebuild

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
npm run build      # applies prod migrations when DATABASE_URL is set, then builds
npm run db:seed    # idempotent fixtures (roster + settings)
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

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
taken without asking.
