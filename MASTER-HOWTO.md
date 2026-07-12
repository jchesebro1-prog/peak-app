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

## 2b. What's usable today (Phases 1–5 ✅)

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

And now the whole **Installs** side + **General** tools (Phase 5):
- **Projects** — the project book (active / at-risk / orders / complete), each
  opening to procurement lines, deliveries, crew & schedule, an install
  timeline, and sign-off. Won quotes flow in automatically.
- **Schedule** — the crew board and project timeline: book/reschedule crews
  onto jobs, week/zoom navigation, route map.
- **Field Work** — the on-site day view: today's jobs, task checklists, field
  notes, and time logging for the crew.
- **Customers** — searchable directory with open/won rollups + a map, and a
  full customer record (locations with travel estimates, contacts,
  communications, and every quote / project / survey for that account).
- **Field Survey** — the survey list (requested → scheduled → on-site →
  completed) and the field **capture editor** (venue facts, measurements by
  venue type, beams/rigging/FOH, conditions, photos, notes).
- **Catalog** — browse/search/edit the parts catalog, and import a price book
  by pasting a CSV.
- **Import / Export** — move records in or out one data type at a time
  (paste-CSV import with preview→confirm; CSV/JSON export + blank templates).
- **Reports** — Sales (pipeline, win rate, top customers, by-estimator) and
  Installs (backlog, billing forecast, margin, completion timeline) dashboards.
- **Estimating Rules** — edit every rate & formula the estimators run on, with
  live/reference tags, defaults, reset, and CSV/JSON export.
- **Settings** now also manages office **Locations** (travel origins) and each
  person's **Account → to-do notifications**.

Deliberate Phase 5 deviations parked for your call are in MASTER-QUESTIONS
(H2/H3 drag-scheduling + note photos; J1–J7: customer-record fields, derived
account owner, import losslessness, access gates, Reports sourcing table,
Settings "clear all", a survey store-type tidy).

## 3. Day-to-day operations

- **Add/remove team members:** Settings → Team (Admin only). Deactivate
  instead of remove to keep history attribution.
- **Branding:** Settings → Branding (name + accent color, app-wide).
- **Estimating rates:** General → Estimating Rules — live numbers used by
  the quote engines; export CSV/JSON from that screen. ✅
- **Backups:** Neon keeps point-in-time restore automatically. For a
  portable snapshot, run `npm run db:export` (Claude Code does this for
  you) — it writes one timestamped JSON of every record to `backups/`,
  which you can drop in Google Drive. Set `DATABASE_URL=...` first to back
  up the live Neon database rather than the local one. ✅
- **Updates:** tell Claude Code what you want changed; it commits and
  pushes; Vercel redeploys automatically.

## 4. Offline field use ✅

The app is an installable web app (PWA) that keeps working with no signal.

- **Install it on a phone:** open the site in the phone's browser → **Share →
  Add to Home Screen** (iPhone) or the **Install app** prompt (Android). It
  opens full-screen like a native app. (The icon is a placeholder "P" until
  the real logo files land — see Branding.)
- **What works offline:** any page you opened while you had signal reloads
  with no signal, and you can keep capturing — **Field Survey**, **Rigging
  Inspection**, **Flame-test results**, **Repair results**, and **Field Work**
  (notes/time). Saves land **on the device** and show
  *"Saved on this device — will sync when you're back online."*
- **The sync chip** (top-right, next to search) is the status light:
  **Synced** (all captures are in the office) · **Syncing…** · **N to sync**
  (waiting to upload) · **Offline** (no connection) · **Work offline** (you
  turned syncing off). Tap it for the last-sync time, a **Sync now** button,
  and the **Work offline** toggle.
- **"Work offline"** lets a tech deliberately stop syncing (e.g. to save data
  or battery in the field); captures queue until it's turned back on. Queued
  work uploads automatically the moment the connection returns — no action
  needed. Nothing is lost if the app is closed or the phone restarts (the
  queue is stored on the device).
- **One rule to know:** work the office edits while a device is offline wins
  if the same record is changed in both places — the field device keeps a note
  of it in the sync panel rather than overwriting the office. And you can only
  *open a job for the first time* while you have signal; once opened it's
  available offline.

## 5. Gmail integration ✅ *(Phase 7 — built; flip on when you're ready)*

The Inbox is wired for real Gmail but ships **off** — it stays in simulated
mode (sends are logged, "Get mail" drops demo messages) until you enable it.
Nothing about the rest of the app depends on it.

**Turn it on** (one-time, ~15 min): the click-by-click is in **DEPLOY.md §5**
— enable the Gmail API in the same Google project, add three scopes
(`gmail.send`, `gmail.readonly`, `userinfo.email`) and the
`/api/gmail/callback` redirect URI, then set `GMAIL_ENABLED=true` in Vercel.

**Then, in the app:**
- **Settings → Mailboxes** shows a "Gmail enabled" badge and a card per
  mailbox. Click **Connect** on your own inbox and on each shared box
  (Sales / Installs / Info); sign in as that mailbox and approve.
- In the **Inbox**, **Send / Receive** imports that mailbox's **last 90 days**
  and then pulls new mail each time you click it. Mail you send from the app
  lands in the mailbox's Gmail **Sent** as well.
- The composer's "from" picker chooses which connected mailbox a message goes
  out as (yourself or a shared address).

**How it works under the hood** (for reference): tokens are encrypted at rest
with `AUTH_SECRET`; each mailbox keeps its own Gmail sync cursor; a message
carries its Gmail id once sent/imported so re-syncs never duplicate. It's
env-gated end-to-end (`lib/gmail/config.ts`) — blank `GMAIL_ENABLED` = fully
inert.

**Not yet wired (small follow-ups, see MASTER-QUESTIONS §C):** a per-user
"Connect my mailbox" button on the Account page (admins can connect any box
from Settings today; the connect link already authorizes a user for their own
box); Google Calendar sync for calls/meetings (manual log for now, C5); and
smart parsing of forward-to-`log@` messages (inbound is matched to customers
by email address today, C6).

## 6. AI features ✅ *(Phase 8 — built; flip on when you're ready)*

Five AI helpers are wired in and **completely off until you add a key** — same
"inert until the credential lands" posture as Gmail. No key = the app behaves
exactly as it does today; nothing calls Anthropic.

**The guardrail (unchangeable):** the AI only ever writes a *draft*. A person
always reviews and sends/commits. Nothing here sends an email, saves a quote,
or writes a customer record on its own.

**What you get once it's on:**
- **Renewal-outreach drafts** — on the Flame Tests "Renewals due" list, a
  "Draft ✨" button writes a personalized renewal email and drops it in your
  Inbox **Drafts** to review and send.
- **Thread & customer summaries** — in the Inbox, "Summary ✨" summarizes a
  long thread (or a customer's whole history) before you reply.
- **Import extraction** — in Import, "Extract with AI ✨" turns messy pasted
  text (a price list, an emailed spec) into clean rows in the normal preview,
  which you check and confirm as usual.
- **Quote scope & lines** — in the Estimator, draft a scope paragraph and
  suggested line items from a field survey or inspection (you set all prices —
  the AI never prices anything).
- **Assistant** — a new top-level "Assistant" tab for plain-English questions
  about your pipeline, quotes, renewals and inbox, answered from live data.

**Turn it on (one variable):**
1. Create an API key at **console.anthropic.com** → API Keys.
2. In Vercel → Project → Settings → Environment Variables, add
   `ANTHROPIC_API_KEY` = your key, then redeploy.
3. That's it — the Assistant tab appears and the ✨ buttons light up. Confirm on
   the **Settings → AI Assistant** card (it shows "AI enabled" + the model).

**Optional knobs:** `ANTHROPIC_MODEL` overrides the model (default
`claude-opus-4-8`; use `claude-haiku-4-5` for a cheaper/faster tier).
`AI_DISABLED=true` is a kill switch that turns everything off even with a key
present. `AI_TIMEOUT_MS` caps each request (default 60000).

**Cost:** you're billed by Anthropic per use (each draft/summary/question is one
short request). Usage is entirely under your control — the features only run
when someone clicks them.

## 7. Real data migration & go-live ✅ *(Phase 9 — tooling built)*

Everything you need to move Peak from demo data to your real business is in
the app. The one thing still on **you**: the source files (where your
customers, projects, and compliance history live today) and the hosting
accounts from §2 — see MASTER-QUESTIONS §I and item A.

### The import hub — General → Import / Export

One screen handles every data type. Each type has a card showing how many
records are already in Peak. For each one you:

1. **Download the template** — a blank spreadsheet (CSV) with the exact
   columns Peak expects and one example row. Open it in Excel or Google
   Sheets, paste your data under the headers, save.
2. **Bring the data in** — either **upload the CSV**, or **paste** rows
   straight from a spreadsheet. Column headers auto-map even if yours are
   named differently (e.g. "Company" → Customer name). If AI is on
   (§6), the paste box also turns *messy* text — an emailed price list, a
   copied table — into clean rows for you.
3. **Preview & confirm** — Peak shows exactly what will be created or
   updated, and flags rows with problems, **before** anything is saved.
   Nothing is written until you confirm.

The types, and what each is matched on to avoid duplicates (**dedupe key**):

| Type | Matched on (duplicate check) |
|------|------------------------------|
| Customers & contacts | customer name |
| Leads | organization + email |
| Flame-test compliance | customer + venue |
| Rigging inspections | customer + venue + date |
| Field surveys | customer + venue |
| Team members | email (or name) |
| Quotes | quote name |
| Active projects | project name |
| Catalog / price book | part number (Catalog → Import price book) |

On confirm you choose how matches are handled: **skip** them, **update**
them, or **create** anyway. Start with customers (everything else references
them by name), then leads/quotes/projects, then the compliance history.

### The go-live sequence

1. **Back up** what you have: Claude Code runs `npm run db:export`.
2. **Export a copy of the demo catalog and estimating rates** if you want a
   starting point to edit (Import/Export → Catalog, and Estimating Rules →
   Export). Your real numbers replace these in-app.
3. **Clear the demo data:** Settings → Beta → **Clear demo data (go-live)**.
   Type `CLEAR` to confirm. This permanently removes every demo customer,
   lead, quote, project, flame test, inspection, survey and catalog part so
   you start from an empty, clean database. It **keeps** your team, company
   settings (name, accent, locations), estimating rates, and any mailbox
   connections. It also turns the "Demo data" switch off so nothing
   re-seeds.
4. **Import your real data** through the hub, in the order above.
5. **Set your real estimating rates:** General → Estimating Rules.
6. **Invite the team:** Settings → Team → Add user (or import the Team
   type). Deactivate rather than remove to keep history attribution.
7. **Spot-check** each area against a few known records before the team
   starts using it.

### Cutover checklist

- [ ] Hosting live (§2) — the app is on the internet at your real URL.
- [ ] `npm run db:export` backup taken and saved off-app.
- [ ] Demo data cleared (Settings → Beta).
- [ ] Customers imported and spot-checked.
- [ ] Leads / quotes / active projects imported.
- [ ] Flame-test + inspection compliance history imported (renewal due
      dates track a year from the last test).
- [ ] Catalog / price book imported (Catalog → Import price book).
- [ ] Estimating rates set to your real numbers.
- [ ] Team invited; each person can sign in and sees the right areas.
- [ ] Phones: install the app on field devices (§4).
- [ ] One real quote and one real flame-test letter produced end-to-end.

Recommended cutover style (MASTER-QUESTIONS I6): switch area by area as each
is verified, rather than everything at once.

## 8. If something breaks

Copy the error (browser message, Vercel build log, terminal output) to
Claude Code. Useful facts for it: the app is Next.js 16 at
`~/Downloads/peak-app`; production DB is Neon (`DATABASE_URL` in Vercel);
specs for every screen live in `docs/specs/` and the original prototype in
`~/Downloads/design_handoff_claude_code/`.
