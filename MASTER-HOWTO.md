# MASTER HOW-TO — running, deploying, and operating Peak Backend

The one document that explains how to put every part of the finished app
into service. Written for Jeff; Claude Code executes the terminal parts.
(Living document — sections are stamped ✅ when that part of the build is
complete and verified.)

## 1. Run it locally ✅

```bash
cd ~/Downloads/peak-app
npm run dev        → http://localhost:3000
```

Sign in via **Dev sign-in** (pick Jeff Chesebro). Local data lives in
`.data/` (embedded Postgres, auto-created + auto-seeded);
`npm run db:reset-local` starts it fresh. Demo data can be toggled at
Settings → Beta → Demo data.

## 2. Put it on the internet ✅ (app is deploy-ready; needs your accounts)

Follow **[DEPLOY.md](DEPLOY.md)** once (~30 min): GitHub (code home) →
Neon (database) → Vercel (host + env vars `DATABASE_URL`, `AUTH_SECRET`) →
Google OAuth credential (`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`) →
one-time `npm run db:seed`. After that, every `git push` auto-deploys,
and migrations apply themselves during the build.

**Who can sign in:** active people on Settings → Team (email or their
`googleEmail`). Add a teammate there before inviting them.

## 2b. What's usable today (Phases 1–4 ✅)

Signed in, you can already drive the whole **Sales** side against real data:
- **Home** — live dashboard (pipeline value, win rate, inbox waiting, your
  leads to follow up, designs, needs-attention).
- **Leads** — pipeline board (drag between stages), follow-up worklist, and
  table; open a lead to log touches, set follow-ups, assign, or convert →
  customer + draft quote. Public request form at `/lead-intake`.
- **Quotes / Estimator** — the full line-item builder (catalog parts,
  curtain / fixture / labor configurators, per-section margin + freight,
  customer PDF preview). Marking a quote **Won** auto-creates its Installs
  project and, for flame-test quotes, its service job.
- **Reviews** — submit/claim/approve/request-changes for quotes & designs.
- **Quick Design** — budgetary Good/Better/Best estimator with generated
  groundplans; save as a design, promote to a quote.
- **Inbox** — the in-app email client (personal + shared mailboxes, folders,
  compose/reply/forward, link-to-work, call/meeting log). Still simulated
  send until Gmail connects (Phase 7).
- **⌘K search** across quotes, designs, surveys, inspections, threads,
  customers, catalog.

And the whole **Service** side (Phase 4):
- **Flame Tests** — dashboard (KPIs, renewals-due outreach, test-locations
  map), the scheduler (to-schedule / booked, route map), results capture, the
  auto-priced quote builder (travel + curtain-count + multi-venue bundling,
  live total), the renewal letter, and the NFPA-705 report in three variants
  (letter / summary / **Certificate of Flame Resistance**). Marking a
  flame-test quote Won still auto-creates its FT job.
- **Repairs** — dashboard with the findings **flagged from inspections**
  intake, warranty follow-ups (with ready-to-send emails), priority board,
  scheduler, and results capture. Won repair quotes now auto-create repair jobs.
- **Rigging Inspections** — the inbox (requested → scheduled → on-site →
  completed), the on-site **capture editor** (venue facts, stage/system
  measurements, the full rubric with per-item ratings, and issue logging from
  a standards library), and the client-facing **inspection report** (report /
  field-dossier / compact layouts). "Mark complete" stamps the report date.

A few service follow-ups are parked for your call in MASTER-QUESTIONS
(F9–F11: repair scheduling/results field check, no dedicated repair
quote/report screen, renovation-quote back-link; G1: unify the report
letterhead once the final logo files land).

Installs and the General tools (Projects, Scheduling, Customers, Reports,
Import…) are the next phases — their nav tabs currently open a "coming in
Phase N" placeholder.

## 3. Day-to-day operations

- **Add/remove team members:** Settings → Team (Admin only). Deactivate
  instead of remove to keep history attribution.
- **Branding:** Settings → Branding (name + accent color, app-wide).
- **Estimating rates:** Settings → Estimating Rules — live numbers used by
  the quote engines; export CSV/JSON from that screen. *(lands Phase 5)*
- **Backups:** Neon keeps point-in-time restore automatically. Monthly
  export: run `npm run db:export` *(lands Phase 9)* or download from Neon.
- **Updates:** tell Claude Code what you want changed; it commits and
  pushes; Vercel redeploys automatically.

## 4. Offline field use *(Phase 6 — pending)*

Will cover: installing the app on a phone (PWA), what works with no
signal (surveys, inspections, flame-test results, field work), how the
outbox/sync indicator behaves, and the "Work offline" toggle.

## 5. Gmail integration *(Phase 7 — pending)*

Will cover: enabling the Gmail API in the same Google Cloud project,
adding the OAuth scopes + redirect URI, connecting personal and shared
(Sales/Installs/Info) mailboxes from the Inbox screen, history import
depth, and the forward-to-log address.

## 6. AI features *(Phase 8 — pending)*

Will cover: creating an Anthropic API key, the `ANTHROPIC_API_KEY` env
var in Vercel, per-feature toggles (renewal drafts, thread summaries,
import extraction), and the "AI drafts, human sends" guardrail.

## 7. Real data migration & go-live *(Phase 9 — pending)*

Will cover: the Import screen workflow per data type (customers, projects,
quote history, compliance history, catalog), the spreadsheet templates,
dedupe rules, turning off demo data, inviting the team, and the cutover
checklist.

## 8. If something breaks

Copy the error (browser message, Vercel build log, terminal output) to
Claude Code. Useful facts for it: the app is Next.js 16 at
`~/Downloads/peak-app`; production DB is Neon (`DATABASE_URL` in Vercel);
specs for every screen live in `docs/specs/` and the original prototype in
`~/Downloads/design_handoff_claude_code/`.
