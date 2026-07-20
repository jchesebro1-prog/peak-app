# Peak Backend

The production rebuild of the Peak Systems Group business app — sales,
service (flame tests / inspections / repairs), installs, CRM, and admin —
ported phase by phase from the HTML prototype in
`design_handoff_claude_code/`.

**Status: Phase 1 complete** — sign-in (Google SSO + invite list), team &
roles, the app shell, and Settings are live. See `AGENTS.md` for the full
phase plan and conventions, `DECISIONS.md` for choices made along the way,
and `QUESTIONS.md` for the things that need Jeff.

**Daylite parity: identity core landed (2026-07-19, D85)** — the customer
directory is now relational (companies / contacts / emails / phones /
sites); **Companies** and **People** replaced Customers in the nav. Design:
`docs/superpowers/specs/2026-07-19-daylite-parity-design.md`. Next step is
Jeff's Daylite CSV export → `npm run audit:daylite -- <folder>`; no import
code gets written before that audit. ⚠️ The dev database is single-process:
**stop `npm run dev` before running any `db:*` script.**

## See it (one command)

```bash
cd ~/Downloads/peak-app
npm run dev
```

On this Mac, open **http://localhost:3000** — you'll get the sign-in
screen. While Google SSO isn't configured yet, the login page shows a
**Dev sign-in** list; pick “Jeff Chesebro” (Admin). No database setup is
needed — local dev uses an embedded database in `.data/` that creates and
seeds itself.

Sign-in works on **any address the server answers on** — `localhost:3000`,
the Mac's LAN IP, or its `SMs-Mac-mini.local:3000` name — and each keeps
you on that same address (no bounce between them). This is handled by
`AUTH_TRUST_HOST=true` in `.env.local` plus the `redirect` callback in
`src/auth.ts`; no `AUTH_URL` is pinned in dev.

### Test from another machine on the network

Any Mac, iPhone, or iPad on the **same Wi-Fi/network** can open
**http://SMs-Mac-mini.local:3000** and sign in the same way (the `.local`
name is preferred over the raw IP because it survives the Mac's network
address changing). Requirements:

- Both devices on the same network (some guest/office networks isolate
  devices from each other — if the page won't load at all, that's usually
  why, not the app).
- This Mac awake with `npm run dev` running.
- On Windows, the `.local` name needs Bonjour installed; otherwise use the
  Mac's current IP address instead.

The Dev sign-in list has **no password** — anyone on the network who opens
the URL can sign in as any role, including Admin. Fine for a trusted
network; not for public Wi-Fi. Production uses Google sign-in + the invite
list (see `DEPLOY.md`).

Try: **avatar menu → General settings** for Branding (change the accent
color — the whole app follows) and **Team members** (add someone, edit
roles, deactivate). The account menu's **Switch user** lets you see the app
as each role — e.g. non-admins get locked out of Settings.

## Put it on the internet

Follow **DEPLOY.md** — about 30 minutes the first time, mostly clicking
“create account.” It covers Vercel (hosting), Neon (database), and the
Google sign-in credentials, each with exact values to paste.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run locally — reachable at http://localhost:3000 on this Mac, or http://SMs-Mac-mini.local:3000 from other devices on the network |
| `npm run build` | Production build (applies DB migrations when `DATABASE_URL` is set) |
| `npm run db:seed` | Load the starter roster/settings into the database (safe to re-run; used once when setting up production) |
| `npm run db:export` | Write a full-database backup to `backups/*.json` (respects `DATABASE_URL` for the live DB) |
| `npm run db:reset-local` | Wipe the local dev database and start fresh |
| `npm run db:generate` | (development) create a migration after schema changes |

Note: run `db:seed`/`db:reset-local` with the dev server stopped when
targeting the local database — they share the same embedded files.

## Where things are

- `src/app/(app)/` — one folder per screen (placeholders name their phase)
- `src/components/nav/` — the shared shell (top bar, drawer, menus)
- `src/db/` — schema, client, seed fixtures
- `src/lib/` — team/roles port, users store, settings, session guards
- `docs/specs/` — exact UI + architecture specs extracted from the prototype
- `drizzle/` — database migrations (generated, committed)
