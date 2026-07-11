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
2. ⬜ Core data stores + seed fixtures (customers, quotes, leads, projects,
   flame jobs, repairs, inspections, surveys, comms, pricing)
3. ⬜ Sales screens (Home, Leads, Quotes, Estimator, Quick Design, Reviews, Inbox UI)
4. ⬜ Service screens (Flame Tests suite, Repairs, Inspections, documents)
5. ⬜ Installs + General (Projects, Scheduling, Field Work, Customers,
   Surveys, Import, Reports, Estimating Rules, full Settings)
6. ⬜ Offline field capture (PWA + outbox sync per sync-architecture spec)
7. ⬜ Gmail integration (OAuth, read/send/threads, shared boxes)
8. ⬜ AI features (Claude API: renewal drafts, thread summaries, import extraction)
9. ⬜ Data migration + go-live

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
taken without asking.
