# MASTER HOW-TO — running, deploying, and operating Quartzite

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
- **Home and Reports dashboards** — click **Customize** to add a curated widget, move it up or
  down, or remove it; **Done** saves your personal layout, while **Reset to default** restores the
  role-appropriate starting layout. When a dashboard includes a historical widget, its Quarter,
  6 months, and 12 months range chips apply to every historical widget on that page; forward-looking
  widgets always show their next 12 months. Layouts live in your per-user dashboard preference row,
  so changing yours never changes anyone else's.
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

**`Peak/` labels (two-way, D140/D142).** Once a mailbox is connected, the app keeps a `Peak/`
label namespace in Gmail in sync with the Inbox. Peak writes them when you link a thread to a
customer, change its status, assign it, or link it to a project/lead/quote. You can also drive Peak
*from* Gmail: apply `Peak/Customers/<name>`, `Peak/Status/Needs reply|Waiting|Done`,
`Peak/Assign/<first name>`, `Peak/Projects|Leads|Quotes/<id>`, or `Peak/New lead` (creates one lead in
the SLA queue and renames itself to `Peak/Leads/<id>`). Nothing outside `Peak/` is ever touched.
Sync runs on the same schedule as mail (open-tab tick, or the 5-minute cron once `CRON_SECRET` is set).


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

## 6. AI features — removed (2026-07-19, D89); Assist is opt-in (#334)

The model-backed features (summaries, import extraction, assistant Q&A) were
removed per `docs/superpowers/specs/2026-07-19-ai-removal-design.md` and stay
removed — the app is fully deterministic with no key set. Recover via version history.

**Turning Assist on (D869–D880).** A small opt-in layer — Suggest tasks and Draft
reply on an email thread in the Inbox, Suggest estimate (§6e; it replaced
Draft estimate, #338) and Ask AI in ⌘K search (§6f, #339) — is the one place the
app calls a model:

1. Create an API key at console.anthropic.com with billing, and set a Console
   spend limit that matches the monthly cap (default $200).
2. Paste the key in Settings → Beta → Assist pilot → Claude API key and press
   **Save key**, then **Test key** (D881: stored encrypted, never shown again;
   **Remove key** to take it out). Or set `ANTHROPIC_API_KEY` in Vercel
   production — a key saved in Settings wins over it, and preview deploys ignore
   the saved key unless `ASSIST_ALLOW_PREVIEW_KEY=true`. See `.env.example` for
   the optional `ASSIST_*` overrides; `ASSIST_DISABLED=true` is the kill switch.
   A leaked key must be revoked in the Anthropic Console — Remove only stops this
   app using it (other server instances may keep it for up to ~30 s).
3. In Settings → Beta → Assist pilot, tick the pilot users. An empty list means
   nobody. The same card has the three feature toggles, the cap and the report.
4. Try each button on a real thread. Assist only drafts: tasks need a tick,
   replies land in the composer unsent, and Suggest estimate opens a new,
   unsaved estimate with a Suggested BOM beside it — nothing is created until
   you add lines and save (§6e).
5. After about 30 days read the report (estimated cost, outcome per feature)
   and decide whether to keep it.
6. **Read the PDF (vendor quotes, #348 slice 5, D1140–D1157).** Tick it under
   Assist pilot → features. It needs the Claude key; with no key the button
   stays hidden. It reads the PDF attached to a vendor quote on the Estimator
   into the vendor quote form only: check the flagged lines, then Add and Save.
   **Try harder** re-reads with Sonnet (about 20× the cost of a Haiku read). The
   **Vendor PDFs** table shows how much people corrected. Optional env overrides:
   `ASSIST_MODEL_VENDORPDF` and `ASSIST_MODEL_VENDORPDF_HARD`.

## 6b. Inbox organization (#335, D882–D900)

Mail now sorts itself, in two layers.

**Everyone sees:**

- **Replying files the thread and takes it out of the inbox.** If the thread is
  already linked (or has a strong suggestion) it is filed first; a weak or missing
  suggestion waits in Inbox → **Organize → To file**. It comes back when the ball is
  in your court again (new customer mail or a hand-off). A teammate's reply to the
  customer no longer counts against you — but a teammate's **internal note** to you on
  the thread (nobody outside on To/Cc), or a reply that **names you** ("Jeff will be in
  touch"), puts it on you and never archives it. Mark replied and Close archive too.
  Archiving happens in Gmail as well. To turn this off, Account → **Keep threads in my
  inbox after I reply**. Emergency off for everyone: `INBOX_ORG_DISABLED=true` (D900).
- Moving a thread back to the inbox in Gmail brings it back in the app too.
- A **court chip** in the reader ("On you: …", "On Dana", "Waiting on customer",
  "Done") with **Not on me** / **On me** to correct it.
- **Looks like noise** on newsletters, promotions, no-reply and auto-replies. Known
  customers and teammates are never marked.
- **Sender rules.** After Change… or Not noise a one-line offer asks "Always file
  mail from this sender / domain under X?" Accepting it files that sender's own
  matching threads; you can list and delete your rules in Account → Sender rules.

**Assist pilot users also see** (Settings → Beta → Assist pilot: tick the user, and
turn on **Inbox organization** / **Promise tasks** — both start off):

- **Organize** (Inbox → Organize) with three tabs: **To file** (suggestion, reason,
  Strong/Weak chip: **Approve**, **Change…**, **Noise**, **Skip**, and **Approve all
  strong**), **Noise** (**Not noise**, **Archive all shown**) and **Filed** (the last
  14 days, **Undo**). Approve links the thread and archives it unless a reply is
  owed; nothing is ever sent.
- **Organize my inbox** at the top of Organize: a one-time sweep of the last 90 days
  of unfiled inbox threads, in 40-second batches ("212 of 480 checked", press again
  to continue). It only suggests; it never links or archives (noise moves to the
  Noise tab) and it creates no tasks from old mail.
- **Promise tasks.** When you or a teammate writes "I'll send the drawings Friday",
  a task is created with that due date (2 business days at 5 pm if none is named).
  The reader shows "Task created … · Undo"; the composer offers an unticked "Mark
  '…' done?" when you reply.

The AI part runs after a Send/Receive or Inbox refresh, not on the nightly Gmail
cron, so it catches up as people use the Inbox. The Assist pilot card's report shows
filings by source, % approved as suggested, corrections, noise rescues, promise-tasks
created/undone, and an admin can set Peak's own mail domain and delete company-wide
sender rules there.

## 6c. Pop-out windows (#336, D902–D913)

Put the dashboard on one screen and the work on another. Nothing to turn on: it is all
in the browser, so there is no setting, no env var and no kill switch.

**Open one**

- Click the small **⧉** (it says "Open in its own window") on the Inbox, on an email
  in the reader, on an estimate in the Estimator (once it is saved), or on a customer
  record.
- Hover **Inbox**, **Estimator** or **Customers → Companies** in the nav and click the
  ⧉ beside it.
- **Shift-click** an email row, an estimate row (Quotes hub, a customer's quotes, Home
  cards) or a company row.
- Opening the same item again just brings its window forward; whatever you were typing
  is still there. If the browser blocks the window, allow pop-ups for the site.

**In the window**

- The nav is gone; the bar at the top shows the page name, **Open in main window** and
  **✕**. Open in main window sends your main window to this page (Chrome may only flash
  its tab); if none is open, or the main window has unsaved work (an unsaved estimate,
  a field you are typing in), it uses a new tab instead.
- Each kind of window comes back at the size and place you last left it.
- On a phone, a narrow window or the app shell the ⧉ buttons are hidden.

**Keeping windows current**

- Save something in one window and every other open window refreshes about a second
  later, whatever it is showing. While someone keeps saving (typing in an autosaved
  estimate note, say), the others refresh at most every 5 seconds and once more after
  the last save.
- A window never refreshes while your cursor is in a text field in it, or within 3
  seconds of your last keystroke; it catches up after you leave the field.
- Coming back to a window that has not refreshed for 30 seconds refreshes it, a moment
  later. An estimate with unsaved changes skips this. A few buttons (changing a
  quote's status from the Quotes hub, Approve on a portal quote) rely on it instead of
  the instant refresh.
- Nothing refreshes while you are offline or on **Work offline**; windows catch up a
  couple of seconds after the connection is back, so a laptop waking up before its
  Wi-Fi never reloads a page and loses what you typed.

**Limits**

- Browsers find a window by name only from the page that opened it. Pop an item out from
  two different main tabs and you can get two windows of it. Close the extra one.
- After a Google sign-in redirect the link to old pop-outs can break; close them and
  open again.

## 6d. AI daily brief (#337, D914–D929)

A short written brief at the top of Home twice a day, with the drafts already made.
It is part of the Assist pilot, so nothing changes for anyone you have not switched on.

**Turn it on**

- Settings → Beta → Assist pilot. The Claude key must be set (see section 6) and the
  person must be ticked in the pilot list.
- Turn on **Daily brief** on that card. It starts off, like Inbox organization. Reply
  and Task suggestions need to be on too if you want the pre-made drafts; the brief
  itself works without them. Nobody gets pre-made drafts without Daily brief, even
  with Reply and Task suggestions on.
- Optional: `ASSIST_MODEL_BRIEF` in the environment changes the model (default Haiku).
  The kill switch is `ASSIST_DISABLED`.

**Read it**

- The card sits above **Start here**. It is built at **6:45 am** and **1:45 pm**
  Central. Before 6:45 you see yesterday afternoon's brief, marked as such.
- It lists the few things to do first (each links to its row), what is waiting in
  Organize, promises that became tasks, today's visits and drive time, approvals
  waiting on you, and quotes that have gone quiet. The afternoon brief adds what
  changed since the morning.
- **Rebuild** remakes the brief now (3 per hour, up to about a minute). If the model
  is unavailable you get a plainer brief built from the counts, with a note. If the
  first view of the day simply ran out of time, that plainer brief is not kept: the
  next view, or the next scheduled job, makes the real one.
- The card collapses, and it never stops Home from loading.

**Use the drafts**

- A row with **Draft ready** or **Tasks ready** has a reply or task list already made.
  Open the email: "Draft reply ready · prepared 6:52 · **Use it**" puts the reply in
  the composer. You edit and press Send; nothing sends by itself. The draft is shown
  only while it is still current: new mail, a reply from you, or a thread that is no
  longer yours makes it disappear. A thread or quote handed to someone else never
  shows them the previous person's draft; a new one is made for them.
- A quote that has been **sent**, is yours (the Lead estimator, else Prepared by) and
  has had no reply for 5 business days shows under quiet quotes. **Send nudge** opens
  the composer with a short follow-up already written. Check the recipient (it picks
  the quote's contact by name, or leaves To blank), edit it and send. A lead row shows
  **Ready to quote? → Open lead**.
- Drafts are made in the background when you open Home or the Inbox and by the
  morning and afternoon jobs, within the monthly cost cap in Settings. Background
  drafting pauses once the month's Assist spend reaches **60 % of the cap**, so the
  rest stays free for Draft reply, Suggest tasks and the brief itself. Raise the cap
  on the pilot card if drafts stop appearing late in the month.

**On the phone**

- Under 900 px wide the card shows a big-text version: the summary, what to do first
  and the counts.
- **Listen** reads the brief aloud with the phone's own voice (no cost). Press Stop to
  end it. It does not appear on a browser that cannot speak.
- **Reminders:** the app schedules two quiet notifications, "Your morning brief is
  ready" at 6:45 and "Your afternoon brief is ready" at 1:45, on the phone's clock;
  tapping one opens the brief. They are on by default; turn them off at Account →
  **Brief reminders on this phone**. They only exist after the apps are rebuilt:
  run `npx cap sync`, then rebuild and reinstall the iOS and Android apps. Until then
  everything else works and there are simply no notifications.

**Watch the cost and use**

- Assist pilot card → report: briefs built, pre-drafts made / used / discarded / not
  used, and nudges made / opened. "Opened" means the composer was opened from the
  card; the app cannot tell whether the nudge was then sent.
- Check the first morning's cost in the Anthropic Console too. The first run drafts
  every thread on each person's court; later runs only redo drafts that went stale.

## 6e. Suggest estimate (#338, D930–D942)

Assist reads an email, a lead, a site visit or a meeting and suggests the systems and
parts for an estimate. You build the estimate from the suggestion; Assist never
creates or prices a quote. It replaced #334's Draft estimate.

**Turn it on**

- Settings → Beta → Assist pilot. The Claude key must be set (section 6) and the
  person ticked in the pilot list.
- Turn on **Suggest estimate** on that card. The draft step runs on Opus, so it is the
  most expensive Assist call; watch its row in the report.

**Where the button is**

- **Inbox:** in an email thread's reader.
- **Leads:** in the lead drawer, on its own line above Convert / Lost / Delete. It is
  there on converted leads too, and the suggestion goes to the customer the lead
  became.
- **Venue assessments:** in the header. It is greyed out while you have unsaved edits
  or a save is running, because Assist reads the saved assessment. Save first.
- **Meetings** (Inbox → Meetings): in the reader's header, only when the meeting is
  linked to a company or a job. A private or unlinked meeting never goes into a
  suggestion.
- **Home → the brief:** a lead under "Do these first" shows "Ready to quote?" with the
  button.

**Use it**

1. Press **Suggest estimate**. It shows "Suggesting…" and can take a minute or two.
   If it can't run you get a short message beside the button.
2. The Estimator opens on a **new, unsaved** estimate. The header is filled in where
   Assist knows it: the company, and the venue, contact and lead when they belong to
   that company, plus a name. There are no lines yet.
3. The **Suggested BOM** panel sits beside the systems on Build. Each suggested system
   lists its parts with a quantity and a short reason. Press **+ Add system** to add
   the whole system, or **+** on a line to add just that part to the system chosen in
   "Lines go to". Parts are priced at the customer's tier, exactly as if you had added
   them yourself. A line marked **needs a part** is something Assist couldn't match in
   the catalog: it is added as a custom line with no price and the note "Suggested:
   needs a part and price", so pick the real part or price it. **✓ added** shows what
   is already in the estimate.
4. Check every line, then **Save**. The first save links the estimate to the
   suggestion. Reopen it later and the panel is there behind its "Suggested BOM" tab,
   hidden until you open it.
5. Back on the source, the button now reads **Suggestion ready → Open** (opens the
   same suggestion again on a new estimate) and **Suggest again** (asks Assist for a fresh one, which
   replaces it for that source).

**Watch the cost and use**

- Assist pilot card → report → **Suggest estimate (draft)**: runs, cost, and how the
  saved estimates compare with the suggestion — accepted (90 % or more of the
  suggested parts kept), edited, discarded (almost none kept, or its estimate was
  deleted), still pending
  (not saved yet), and **No suggestion** (nothing came of the run, or it was replaced
  by Suggest again before anyone saved it).

## 6f. Ask AI (#339, D943–D960)

Ask AI answers questions about Peak's own records from the ⌘K search box. It looks
things up the way you would — companies, venues, quotes, leads, projects, your own
email threads and meetings, the catalog, your tasks — and answers with links to what
it read. It can also propose a task, a note, an email or a suggested estimate as a
card, but it never changes anything itself: nothing happens until you press the
card's button.

**Turn it on**

- Settings → Beta → Assist pilot. The Claude key must be set (section 6) — without a
  key the Ask row never appears, even for pilot users — and the person must be ticked
  in the pilot list.
- Turn on **Ask AI** on that card (it starts off). The hint under the switches shows
  which models answer (Haiku, and Sonnet for Try harder).

**Ask a question**

1. Click the search box in the top bar (or press ⌘K) and type your question, e.g.
   "what's open with Lincoln High?" or "compare the last 3 quotes for Acme Church".
2. The first row reads **✦ Ask AI: <your question>**. Click it, or press **⌘↵**
   (Ctrl+↵ on Windows). The Ask panel opens under the search box.
3. The answer streams in. While it works you see what it is looking up ("Looking up
   quotes…"); **Stop** ends it. Record names in the answer are links: a click opens
   the record and closes the panel; Shift-click opens a thread, estimate or company in
   a pop-out window. **Looked at N records** lists what it read.
4. Ask follow-ups in the box at the bottom (Enter sends, Shift+Enter starts a new
   line). The panel remembers the conversation until you close it.
5. Not happy with an answer? **Try harder** (under the latest answer) asks the same
   question again with the stronger model and replaces that answer. It costs more, so
   use it when the first answer missed something.
6. **Esc** or **✕** closes the panel and forgets the conversation. Nothing is saved.

**"This screen"**

- Open Ask from a company, venue, quote (any builder), email thread, meeting, lead,
  project or venue assessment and the panel shows **Looking at: <name>**. Questions
  like "summarize this" or "what's still open here?" are about that record. Press ✕
  on the chip to ask without it.

**Search the web**

- Turn on **Search the web** under the input for a question that needs outside
  information (a manufacturer's spec, a venue's address). It is off by default and
  applies to that question only. The answer lists its **Sources**; they open in a new
  tab. Web search costs a little extra per search.

**Cards**

- **Task** — edit the title, due date, assignee and notes, then **Create task**. It is
  linked to the records the card shows.
- **Note** — **Add note** adds it to the company, venue, lead or project named on the
  card.
- **Email** — **Open in composer** opens the Inbox composer with the recipients,
  subject and body filled in. Nothing is sent: read it, change it, and send it yourself. Recipients come only
  from addresses on Peak's records or ones you typed.
- **Suggest estimate** — starts a suggestion from the email, lead, site visit or
  meeting (section 6e) and opens the Estimator.
- Cards can only point at records Ask actually looked up in this conversation, and
  every button re-checks your access.

**What it can and can't see**

- Only what you can already open: your own mailbox (never a teammate's), meetings you
  can see (never transcripts), and the shared company, quote, lead and project
  records. Prices come only from records; quotes read the way the customer sees them,
  and service quotes show their total but not their lines.
- It isn't available on narrow screens or phones yet — the search box, and so Ask, is
  hidden on windows 860 px wide or less.

**Watch the cost and use**

- Assist pilot card → report → **Ask AI**: questions per person, Haiku vs Sonnet, how
  often Try harder is used, cards proposed and confirmed by kind, web searches and
  cost. Each person can ask 60 questions an hour (Try harder: 15 an hour) and spend
  up to $5 a day on Ask AI ("Ask AI daily limit reached — try again tomorrow."), and
  the monthly cap applies. If the Claude key is wrong, Ask says "The Claude API key
  was rejected — check Settings → Beta → Assist pilot."

## 6g. Running a condition assessment (#340, D961–D1003)

A condition assessment is a site walk-through of a venue — stage, rigging, soft goods,
fire, lighting, audio/video, access — answered on a phone or tablet. Each problem you
find becomes a **finding** with its own printed ID (`MPSD-LIN-RIG-003`: customer, venue,
category, number). Findings from every visit land in one register, and you can quote
them, print them, or email the report to the customer.

**Before you go**

- Give the customer and the venue short codes (they show on the company and venue
  pages with an edit control). Codes are suggested from the name — the customer's initials, and the first three letters of
  the venue's first meaningful word (Wilson Middle School → `WIL`). Fix a wrong
  suggestion **before the first finding**: a code locks once a finding uses it, and
  changing it then needs the approve permission.
- You must be online to **start** an assessment. After it is open it works offline.

**Run it**

1. Start from the venue page (**Assessments** card), the company page, the site visit
   (**Start assessment →** on the visit) or **Assessments → + New**. Pick the customer
   and venue, the visit type (**Condition assessment**) and the scopes; the usual set
   is pre-selected and you can add or remove scopes, even mid-visit. Removing a scope
   with answers hides it and keeps them.
2. Answer module by module. The ⋯ menu on a question marks it **N/A** or **Unable to
   inspect** (a reason is required, and the report lists it as a follow-up). The camera
   button adds a photo. Facts the venue already has (stage size, install year…) are
   pre-filled with a **Changed?** toggle.
3. When an answer trips a rule — a fall hazard, no e-stop, a missing safety cable — a
   **Create finding?** chip appears under the question. **Create** opens the finding
   sheet with the category and a suggested rating filled in; **Dismiss** removes it. You
   can also add a finding by hand. An **Immediate attention** finding needs a photo,
   whether the hazard contact was told, the lockout state and a recommended action.
4. Photos taken offline wait on the device and upload when you reconnect; the sync chip
   counts them. The header says **Saved**, **Syncing…**, **Saved on this device — will
   sync when you're back online** or **Couldn't sync — <reason>**. Anything that couldn't
   sync appears in a banner with **Re-enter** / **Use mine**; answers this device still
   holds are sent again the next time you open the assessment.
5. **Mark complete** lists every gap: required questions, required photos, unresolved
   prompts. You can complete anyway — each gap you skip is recorded and printed in the
   report's follow-up list. Photos still uploading block it until they finish or you
   remove them. Reopening a completed assessment needs the approve permission.

**Findings, reports and quotes**

- **Findings register** (`/assessments/findings`, also linked from the venue and
  company **Findings** cards): filter by customer, venue, category, rating, status,
  priority and budget tier; Immediate items sit first. Select rows for **Triage**,
  **Quote these findings** or **Export CSV**.
- **Report:** open the assessment's **Report** to read it, **Download PDF**, or
  **Email report** — that renders the PDF, stores it, and puts it in an Inbox draft
  tied to the customer. Nothing is sent until you send the draft. (On a computer without
  file storage — local dev — only a report under 1.5 MB can be emailed; download larger
  ones.) The findings-only PDF (open
  findings across visits for a venue or company) is linked from the register and the
  venue card.
- **Quote these findings:** select findings in the register → **Quote these findings**
  → **Repair quote** (opens the repair builder with the findings as scope lines; the
  link is made when you save) or **Estimator quote** (creates a draft and links it).
  The findings move to *quoted*, and each quote line starts with the printed ID. To
  attach a finding to an existing quote open the finding from the register and use **Link existing quote** in its sheet (not available in the assessment editor).
- A finding's category can't change once it has a number: void it and create a new one.

**Not yet:** customers can't see assessments or findings in the portal, and Venue
Assessments and rigging inspections still use their own screens (later slices).

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
   named differently (e.g. "Company" → Customer name).
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

## 9. Vercel Blob — plan sheets (and datasheets) out of the database

**Why.** Without a Blob token the Grid stores every uploaded plan sheet as a
base64 blob inside the database (one doc per sheet, 4 MB cap — see #146/D173;
it read 8 MB until then, but a server action could only ever carry ~900 kB of
it). Fine for the beta; wrong at production scale — file bytes don't belong
in Postgres, and datasheet PDFs (§10) will multiply the problem. Decision D113 item 2: **Vercel Blob at
deploy time.** The app already deploys on Vercel, so this adds no new vendor.

**What you do (10 minutes, one time):**

1. Sign in at **vercel.com** and open the **peak-app** project (the one
   serving `peak-app-six.vercel.app`).
2. Go to the project's **Storage** tab → **Create** → choose **Blob** →
   name it `quartzite-files` → create.
3. When it offers to **connect the store to the project**, accept — Vercel
   adds a `BLOB_READ_WRITE_TOKEN` environment variable to Production,
   Preview, and Development automatically.
4. For local dev, copy that token once: project → Settings → Environment
   Variables → reveal `BLOB_READ_WRITE_TOKEN` → paste into
   `~/Downloads/peak-app/.env.local` as
   `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_…`
   (`.env.local` is gitignored — the token never goes in the repo).
5. Tell Claude "the Blob token is in" — that's the whole hand-off.

**What's built (2026-07-24, D116) — active the moment the token exists:**

- `POST /api/grid-sheets/upload` uploads to Blob (`@vercel/blob` `put()`,
  **private access** —
  the store you created is private, which is right for customer drawings)
  and stores the blob pathname instead of the base64 payload; browsers read
  sheets through the signed-in-only proxy `/api/grid-sheets/<sheetId>`,
  so files are never world-readable.
- **No token → exactly today's behavior** (data-URLs in the DB). The
  feature is env-gated like Gmail (§5); dev machines without the token
  keep working.
- A one-shot backfill script moves existing sheets up and rewrites their
  docs (dev-DB discipline per AGENTS.md: server stopped, `.data` backed up).
- The upload cap does NOT rise on its own. Blob takes much larger files, but
  the bytes still travel through a Vercel Function, which rejects a request
  body over ~4.5 MB before our handler sees it — so the cap is 4 MB either
  way (#146/D173). Lifting it needs the client-upload broker Recordings uses
  (`handleUpload`), whose bytes bypass the function entirely; that is a
  deliberate, still-open follow-up, not something the token switches on.
- §10's datasheet PDFs land in the same store under `datasheets/`.

**Cost reality check:** plan sheets are ~0.5–5 MB PDFs. Hundreds of designs
is a few GB — Blob storage is priced per GB-month at cents; this is
dollars-per-month territory, not a line item. Current numbers:
vercel.com/pricing → Storage → Blob.

**Rollback:** disconnect the store / remove the env var and uploads fall
back to in-database data-URLs. Already-uploaded sheets keep their URLs
until the store itself is deleted.

## 10. The Grid — device metadata authoring (ETC lighting + rigging first)

**Why.** The planning session's key insight (memory:
`projects/peak-system-designer.md`): DaVinci's moat isn't canvas code, it's
the **curated product database** — symbols, weights, accessory rules,
datasheets. The Grid's code is built; this data is what turns SKU-chip
markers into a real design tool. Decision D113 item 4: **ETC lighting +
rigging get authored first.**

**The v1 contract — four new fields per catalog part** (these become
catalog columns + import-template columns when the first sheet comes back;
nothing else is needed to start):

| Field | What it is | Example |
|---|---|---|
| `symbol` | How the marker draws on a plan. One key from the fixed list below — not free text. | `ellipsoidal` |
| `weight_lb` | Hanging weight per unit, pounds. Feeds lineset/rigging math (the same well as the auto-weights work). | `17.5` |
| `datasheet_url` | Link to the cut sheet PDF. Manufacturer URL is fine to start; once §9 exists we bulk-upload PDFs to Blob and repoint. | `https://www.etcconnect.com/...pdf` |
| `accessories` | Allowed add-ons as `SKU:maxQty` pairs, `;`-separated. Empty = none. | `S4-TOPHAT:1;S4-IRIS:1` |

**Symbol keys (v1, fixed list):** `ellipsoidal · wash · cyc · strip ·
mover · followspot · practical · speaker · sub · mic · dimmer · relay ·
panel · rack · hoist · winch · lineset · track · projector · screen ·
other`. A part with a symbol is what makes it a *paintable device*; parts
without one stay in the palette as plain dots (today's behavior). Ask for
new keys rather than improvising — every key needs a glyph drawn once.

**How we work it:**

1. **Claude generates the worksheet** from the real price book: a CSV of
   the ETC lighting + rigging rows (sku, description, manufacturer) with
   the four metadata columns blank. Template with examples:
   `docs/templates/grid-device-metadata-template.csv`.
2. **You (or whoever knows the gear) fill rows in Excel.** Skip anything
   uncertain — blank is better than guessed, especially `weight_lb`
   (it goes into rigging math; use the manufacturer's number, and when a
   range exists use the heaviest configuration).
3. **Datasheet PDFs**: drop them in a Dropbox folder named by SKU
   (`S4LED-S2.pdf`); Claude uploads the batch to Blob and fills
   `datasheet_url` — you never paste those links by hand.
4. **Claude imports the sheet** (extends the price-book importer with the
   four columns), and the editor starts drawing real symbols; datasheet
   packages (Phase 4's remaining half) become possible.

**Priority order — don't boil the catalog:** the ~50 parts that will
actually get painted first: ① ETC Source Four / ColorSource / Desire
families, ② house/cyc/work light, ③ hoists + linesets + track (the parts
whose `weight_lb` matters most), ④ dimming/power (Sensor, ThruPower,
Echo). Audio/video wait for their turn (D113: ETC lighting + rigging
first). A part is **Grid-ready** when `symbol` is set; **submittal-ready**
when `datasheet_url` is too.
