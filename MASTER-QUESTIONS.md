# MASTER QUESTIONS — the one form to answer

Every open question from the whole project in one place (handoff
QUESTIONS.md, docs/IDEAS.md open items, and everything that came up during
the build). **Nothing blocks on these** — every item has a working default
(marked ✦) already built in. Fill in what you can, skip the rest, answer in
any format — even one-word replies against the numbers.

Legend: ✦ = the default that's already built · ☐ = your answer

---

## A. Getting the live URL (the only section that gates anything)

These need accounts only you can create. DEPLOY.md is the click-by-click
guide; I do all terminal work.

- **A1.** Create GitHub + Neon + Vercel accounts and the Google OAuth
  credential per DEPLOY.md, pasting values back to me as you go.
  ☐ done / ☐ scheduled for: ______
- **A2.** Which Google account owns the infrastructure?
  ✦ `jchesebro1@gmail.com` (pre-authorized to sign in) ☐ other: ______
- **A3.** Custom domain? ✦ free `*.vercel.app` URL first
  ☐ buy/use: ______ (10-minute add later)
- **A4.** Monthly budget comfort. ✦ free tiers → ~$20/mo as usage grows
  ☐ cap: ______
- **A5.** Anyone besides you with admin on hosting/Google?
  ☐ names: ______

## B. Sign-in & team

- **B1.** Sign-in methods. ✦ Google only ☐ also Microsoft ☐ also
  email+password
- **B2.** Who gets in. ✦ invite list = Settings → Team (active members
  only) ☐ anyone @peaksystemsgroup.com domain
- **B3.** Roles. ✦ the prototype's four (Admin / Manager / Estimator /
  Reviewer) ☐ add field-tech-limited role: ______
- **B4.** Real roster — names, sign-in emails, roles (replaces the six
  demo people; you can also just edit Settings → Team yourself):
  ______
- **B5.** Company Google Workspace or plain Gmail?
  ☐ Workspace (`name@peaksystemsgroup.com` are real Google accounts)
  ☐ plain Gmail addresses per person ☐ mixed: ______

## C. Gmail / Inbox integration (Phase 7 — built, awaits credentials)

- **C1.** Which mailboxes connect? ✦ each person's own + shared
  Sales/Installs/Info ☐ personal only ☐ shared only
  — do the shared addresses already exist? ☐ yes: ______ ☐ no, create: ______
- **C2.** Send as. ✦ both (picker in composer: shared address or yourself)
  ☐ shared only ☐ individual only
- **C3.** History import on connect. ✦ last 90 days ☐ other: ______
- **C4.** Replies sent from the app also appear in Gmail Sent. ✦ yes ☐ no
- **C5.** Calls & meetings. ✦ manual log ☐ also sync Google Calendar
- **C6.** Forward-to-log address (mail forwarded there gets logged against
  the customer). ✦ enabled once Gmail connects; suggested
  `log@peaksystemsgroup.com` ☐ different: ______

> **Phase 7 built (2026-07-11).** The Gmail bridge is complete and env-gated —
> flip on with `GMAIL_ENABLED=true` after the ~15-min Google setup in
> **DEPLOY.md §5**; until then the Inbox stays simulated. Defaults taken:
> C1 own + all three shared boxes (connect each from Settings → Mailboxes);
> C2 send-as = the composer's existing "from" picker; C3 = 90-day import;
> C4 = yes (sends land in Gmail Sent via `gmail.send`); C5 = manual log
> (no Calendar sync yet); C6 = inbound is matched to a customer by email
> address (dedicated `log@` forward-parsing not yet built). Small follow-ups
> to confirm/prioritise:
> - **C7.** Should each teammate connect their **own** inbox themselves? If
>   yes we add a "Connect my mailbox" button on the Account page (the backend
>   route already allows it). ✦ yes ☐ admin connects all boxes centrally
> - **C8.** Want Google **Calendar** sync for calls/meetings (C5), or keep the
>   manual log? ✦ manual for now ☐ add Calendar later
> - **C9.** Do you actually use a forward-to-`log@` habit? If so we'll parse
>   the forwarded headers to attribute to the original customer (C6). ☐ yes ☐ no

## D. AI features (Phase 8 — built, awaits Anthropic API key)

Rank or tick the ones you want first; each is independently switchable.

- **D1.** ☐ Draft renewal-outreach emails (the ✉ one-click flow, quote attached)
- **D2.** ☐ Summarize long threads / customer history in the Inbox sidebar
- **D3.** ☐ Extract structured data from uploaded files during Import
- **D4.** ☐ Draft quote line items / scope text from survey & inspection findings
- **D5.** ☐ "Ask about my business data" assistant
- **D6.** Guardrails. ✦ AI drafts, human always reviews & sends; never
  auto-send ☐ stricter: ______ ☐ looser: ______
- **D7.** Create an Anthropic API key (console.anthropic.com) when ready —
  MASTER-HOWTO.md §AI shows where it goes. ☐ done
- **D8.** Built & verified 2026-07-11 (gate OFF: tsc+build clean, browser-
  checked — Assistant tab hidden, ✨ affordances absent, existing flows
  unchanged). Can't live-test AI output until a key lands — first thing to do
  once D7 is done is sanity-check each of the five features. Deliberate v1
  limits (deferred, not bugs): the Assistant answers from a compact live
  *snapshot* (no tool-use/RAG, so very specific "what did customer X say on
  date Y" questions may miss); there's no per-feature on/off toggle (the key
  turns the whole layer on — `AI_DISABLED=true` is the only kill switch);
  import extraction and quote-scope drafting are text-only (no file/PDF upload
  yet). Flag any you want changed.

## E. Pricing & estimating (numbers are editable in-app at Settings →
Estimating Rules — these just need real values before go-live)

- **E1.** Flame test: mileage $/mi ✦ 0.70 ☐ ____ · labor $/hr ✦ 30 ☐ ____ ·
  minutes per curtain ✦ per prototype ☐ ____ · bundled-venue base fee
  ✦ $150 ☐ ____ · margin ✦ 30% ☐ ____
- **E2.** Travel time billed at labor rate? ✦ yes, round-trip, rounded to
  15 min ☐ other: ______
- **E3.** Repairs: min call-out ✦ prototype value ☐ ____ · parts margin
  ✦ prototype ☐ ____ · emergency multiplier ✦ prototype ☐ ____
- **E4.** Catalog prices/costs: demo numbers stand until you import real
  ones (Import → Catalog). ☐ real price book file exists: ______
- **E5.** Quick Design tier pricing + system-sizing factors: keep demo
  values until real ones supplied. ☐ notes: ______

## F. Service-line product decisions (from IDEAS.md)

- **F1.** Inspection recurrence. ✦ Level 1 annual, Level 2 every 5 years,
  60-day renewal lead window ☐ correct? / changes: ______
- **F2.** Inspection quote gate. ✦ soft gate: inspections can be created
  freely; a linked accepted quote is flagged-for but not enforced before
  scheduling ☐ hard block until quote accepted
- **F3.** Repairs intake form fields (IDEAS #29 — you said you'd spec it):
  current build uses category, priority, venue, description, photos,
  contact, preferred timing. ☐ changes: ______
- **F4.** Should "Start new repair" replace or sit beside the
  "Go to inspections →" link on the Repairs header? ✦ beside ☐ replace
- **F5.** Service contracts (IDEAS #33). ✦ parked for v2 ☐ spec now: ______
- **F6.** Quotes hub. ✦ one Quotes list with a type filter
  (design/service/flame/inspection/repair) ☐ separate tabs per type
- **F7.** Renewals-due panel = only customers NOT yet contacted this cycle
  (IDEAS #37). ✦ yes, with a "Reached out — awaiting" secondary view
  ☐ keep pure date window
- **F8.** Flame-test renewal quote regeneration. ✦ last year's price
  verbatim (per your comment) ☐ re-price at current rates
- **F9.** Repair scheduling + results screens were **modeled on the
  flame-test scheduler/results** (the prototype only shipped a Repairs
  dashboard mock, no scheduling/results mock). Adapted fields: date
  performed, performed-by, warranty months, scope-of-work reference,
  work-performed, parts-used, follow-up. ☐ correct? / changes: ______
- **F10.** There is **no separate "Repair Quote" screen** — "New repair",
  "Quote repair", and warranty "Re-quote" all deep-link to the Estimator
  (they lose the inspection/customer pre-fill). And completed repairs show
  their logged **Results** screen rather than a standalone printable Repair
  Report. ✦ acceptable for now ☐ build a dedicated repair quote +
  report doc (needs a mock/spec): ______
- **F11.** Inspection → renovation-quote **back-link isn't persisted** (the
  typed inspection/quote records have no field for it). The button still
  creates a sourced quote and opens the Estimator, but the report won't
  later show "view existing renovation quote". ✦ fine ☐ add the link field
- **F12.** *(Jul 12 — IDEAS #44 completion)* **Repair report default
  variant:** compare at /repairs/report/options. ✦ 2c service report
  ☐ 2a letter ☐ 2b letter + service panel. **Inspection report default
  layout:** compare at /inspections/report/options. ✦ 3a report
  ☐ 3b dossier ☐ 3c compact.
- **F13.** *(Jul 12)* **Inspection pricing defaults are placeholders** —
  $95/hr labor, 15 min per line set, 2 base hrs per visit, ×1.75 for a
  Level 2, $650 job minimum, 30-pt margin. All editable in Estimating
  Rules → "Inspection pricing" (changes reprice live). ☐ real numbers:
  ______
- **F14.** *(Jul 12)* A multi-venue inspection quote spawns **one requested
  inspection per venue**, splitting the quote value evenly across venues
  (records/reports are per-venue; travel was priced once for the trip).
  ✦ even split is fine ☐ weight by line-set count instead
- **F15.** *(Jul 12 — customer portal)* **Department scoping:** v1 portal
  logins show the customer org's whole published world. Your design call was
  person → department scope → optional cross-links; to wire it I need the
  department per contact for real customers. ✦ org-wide is fine for beta
  ☐ department map: ______
- **F16.** *(Jul 12 — customer portal)* Portal access links are copied
  manually from the customer record for now. Once Gmail is connected
  (GMAIL_ENABLED), should "Create access link" also **email it to the
  contact automatically**? ✦ yes, auto-send ☐ keep manual copy.
  *(Update, same day: the non-binding "Accept quote" button shipped — D64 —
  so the remaining portal slice is photo/document uploads on requests,
  which also needs the object-storage call from IDEAS #46.)*

## G. Documents & branding

- **G1.** Company logo files — light version (dark nav) + dark version
  (documents). ☐ attached/placed at: ______ (until then: letter monogram).
  **Update Jul 12:** Settings → Branding now has upload slots for both
  (IDEAS #32) — drop the files in there and every letter, report, and the
  nav pick them up automatically; no code change needed.
  Note: flame-test **letters + reports** now use the real Peak letterhead
  image (`peak-letterhead.jpg`); the **inspection report** still uses a
  typographic letterhead (company name + tagline). Once the final logo
  files land, both should point at the same asset for one consistent look.
- **G2.** Results letter signer. ✦ the job's performing tech/owner
  ☐ always "Jeff Chesebro, Sales/Design"
- **G3.** Letters brand. ✦ app company name (Settings → Branding)
  ☐ different letterhead: ______

## H. Installs & scheduling

- **H1.** Billing forecast. ✦ simulated milestone draws (deposit →
  materials → install → final, net-30 collection) forecast-only
  ☐ real invoicing/QuickBooks integration (Phase 10+): ______
- **H2.** Crew board: keep prototype behaviors (time-off, mobilization
  chips, federal holidays toggle). ☐ changes: ______
  Note (Phase 5): the schedule/field-work screens ship as server-rendered
  forms — booking/reschedule use a popover form, **not** pointer drag-and-drop;
  **time-off lanes** and **federal-holiday shading** were omitted (time-off was
  localStorage-only in the prototype, no backing store). Confirm whether true
  drag scheduling + time-off tracking are required (each needs a client
  scheduler component + a new store field) or the form flow is sufficient.
- **H3.** Field-work note photos: post-a-note is text-only for now (the
  prototype downscaled a captured image to a data URL). ✦ enable later with
  the Phase 6 offline capture work ☐ needed sooner: ______

## I. Data migration & go-live (Phase 9 — tooling built ✅)

The whole go-live toolkit now exists and is verified: the Import/Export hub
with per-type templates + dedupe (Phase 5), AI paste-extraction (Phase 8),
a one-click **Clear demo data (go-live)** reset in Settings → Beta, and a
`npm run db:export` full backup. Step-by-step in MASTER-HOWTO §7. What's
left is *your* input — the answers below plus item A (accounts) — and a
dry run on your real files.

- **I1.** Where does current data live? Per type — customers: ______ ·
  active projects: ______ · quote history: ______ · flame-test/inspection
  compliance history: ______ · catalog/prices: ______
- **I2.** Is `Blank V.01.xlsx` (reference_documents) the real template your
  data fits? ☐ yes ☐ no — I'll shape templates around your actual files
- **I3.** History depth. ✦ active + last 3 years compliance ☐ everything
  ☐ other: ______
- **I4.** Who tests each area before the team is invited? ✦ you for
  Sales/Service ☐ field tech ______ for Field Work/Surveys
- **I5.** Backups. ✦ Neon automatic point-in-time + monthly export to
  Google Drive ☐ different: ______
- **I6.** Cutover. ✦ per-module switch as each area is verified ☐ parallel
  run ☐ hard switch
- **I7.** Phones. ✦ installable web app (PWA — built) ☐ native app later

## J. Phase 5 review — Installs + General (screens built 2026-07-11)

All nine Installs + General screens (Projects, Scheduling, Field Work,
Customers, Field Survey, Catalog, Import/Export, Reports, Estimating Rules)
plus full Settings + Account are live, verified against seed data. Items below
are deliberate deviations that touch the **data model** or need a product call —
everything else was ported faithfully.

- **J1.** Customer record shape. The ported `customers` store persists only
  `{name, type, location(s), contact(s)}`. The prototype's Customer Context also
  showed **Notes**, **"Customer since"**, and **per-venue stage dimensions**
  (W×D×H, grid clearance) — these are currently **not stored** and are omitted
  from the detail view + edit modal. ✦ add these fields to the customer store
  ☐ leave out: ______
- **J2.** Account owner is **derived** (newest linked quote/project owner), not
  a stored field — it drives the directory owner column + "My work" filter.
  ✦ keep the heuristic ☐ add an explicit owner field to the customer record
- **J3.** Data import is **lossy** for columns the store doesn't hold (customer
  phone/street/zip). Import dedupe is **name-based**. ✦ fine ☐ add those
  columns / change dedupe key: ______
- **J4.** Access gates: **Import/Export** and **Estimating Rules** are
  admin-only (`manage_users`, matching the prototype); **Catalog** is open to
  any signed-in user (prototype had no gate). ✦ keep ☐ change: ______
- **J5.** Reports "most-quoted products · projected sourcing" table was
  **synthetic demo data** in the prototype (seed quotes carry no product line
  items) — replaced with a real **"Pipeline by estimator"** breakdown. To build
  the real projected-sourcing table, quotes need product-level line items.
  ☐ product line items are a requirement: ______
- **J6.** Settings **Beta → "Clear all data"** (destructive wipe) was **not**
  ported — kept the reversible demo-seed toggle instead. There is no store-wipe
  function and mass hard-delete is out of scope. ☐ a real "clear all" is wanted
  (needs a backing function): ______
- **J7.** Field Survey **measurement check-fields** (loading bridge, HH sheet,
  brick drawing) are stored as booleans but the store types `measurements` as
  `Record<string, string>` (cast at the save boundary). Minor store-type
  imprecision — widen to `string | boolean` in `surveys.ts` at a convenient time.

## K. Phase 6 review — Offline field capture (built 2026-07-11)

The app is now an installable PWA with a durable offline outbox. Field Survey,
Rigging Inspection, Flame-test results, Repair results, and Field Work all
capture with no signal and sync when the connection returns (decisions
D26–D32). Items below are deliberate limits / product calls — everything else
follows the sync-architecture spec.

- **K1.** **App icon** is a placeholder monogram (`public/icon.svg`, dark "P").
  ✦ swap for the real logo when the G1 files land ☐ specific icon: ______
- **K2.** **Conflict policy** when a record is edited in the office *and* on an
  offline device at the same time: the office version wins and the field
  device notes it in the sync panel (no manual merge screen). ✦ keep
  ☐ want a "review my un-synced change" merge step: ______
- **K3.** **Cold open needs signal.** You can capture offline on any job you
  opened while online, and any page you visited reloads offline — but opening a
  brand-new job for the first time needs a connection. ✦ fine
  ☐ pre-download all of a tech's assigned jobs for the day (a "download for
  offline" button): ______
- **K4.** **Survey/field photos** ride on the record as downscaled data-URLs
  (as in the prototype) and sync with it in the same outbox — no separate
  blob/object-storage upload yet. ✦ fine for now ☐ move photos to cloud
  storage (needed if photo volume grows): ______ — this also unblocks
  field-work note photos (H3).
- **K5.** **Online-only actions** (need a server round-trip, so they show an
  error with no signal rather than queueing): delete, "create quote from
  survey/inspection", and office review/approve. ✦ correct — these aren't
  field operations ☐ change: ______
- **K6.** **Background sync** is a 60-second poll + on-reconnect flush (no push
  server yet). ✦ fine; live push (SSE) can come with Gmail/Phase 7
  ☐ want instant office↔field updates sooner: ______

---

*Answered items get moved into DECISIONS.md with a date. This form
supersedes QUESTIONS.md.*
