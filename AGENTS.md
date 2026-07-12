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
7. ⬜ Gmail integration (OAuth, read/send/threads, shared boxes)
8. ⬜ AI features (Claude API: renewal drafts, thread summaries, import extraction)
9. ⬜ Data migration + go-live

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
taken without asking.
