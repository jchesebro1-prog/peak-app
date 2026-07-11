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

## G. Documents & branding

- **G1.** Company logo files — light version (dark nav) + dark version
  (documents). ☐ attached/placed at: ______ (until then: letter monogram)
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

## I. Data migration & go-live (Phase 9 — tooling built)

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

---

*Answered items get moved into DECISIONS.md with a date. This form
supersedes QUESTIONS.md.*
