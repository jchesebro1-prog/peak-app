# DECISIONS.md — default decisions made without asking

Per the handoff instructions, sensible defaults were chosen and logged here.
Anything you want changed, just say so — none of these are hard to reverse.

## Phase 1 (2026-07-11)

### Where the app lives
- **D1. Project folder:** `/Users/sm/Downloads/peak-app` — the literal
  "sibling folder (`../peak-app`)" from the handoff. The `Peak Software`
  network-share folder holds a pointer README instead: running a dev server
  and `node_modules` over SMB is slow and unreliable, so the code lives on
  the local disk. The real home of the code is the git repo (push to GitHub
  when connecting the host).
- **D2. Node.js** wasn't installed on this Mac; installed Node v24.18.0 LTS
  user-locally at `~/.local/node` and added it to `~/.zprofile` PATH.

### Stack (the "pick the stack yourself" call)
- **D3. Next.js 16 (App Router) + TypeScript + Tailwind v4.** One framework
  for UI + server API + auth; first-class managed deployment on Vercel;
  clean server-side home for Gmail API + Claude API code later (never in the
  browser, so keys stay secret).
- **D4. Postgres + Drizzle ORM.** Production: any Postgres via
  `DATABASE_URL` (Neon recommended — free tier, one-click from Vercel).
  Local dev: **embedded PGlite** (real Postgres compiled to WASM, stored in
  `.data/`) — zero install, `npm run dev` just works, same SQL dialect in
  dev and prod. Migrations via drizzle-kit; dev auto-migrates + auto-seeds
  on startup; production applies migrations during `npm run build`
  (`scripts/migrate.mjs`, no-op without `DATABASE_URL`).
- **D5. Auth.js (next-auth v5) with JWT sessions.** Google is the sign-in;
  the `users` table is the **invite list** (QUESTIONS.md default): a Google
  account gets in only if its email matches an **active** team member.
  Roles are re-read from the DB on every request, so role edits and
  deactivation apply immediately without re-login.
- **D6. Dev sign-in.** With `AUTH_DEV_LOGIN=true` (or local dev before
  Google is configured) the login page shows a pick-a-team-member list, and
  the account menu keeps the prototype's "Switch user" — that affordance
  disappears in Google-only production.

### Data model
- **D7. Field names and id formats preserved** from team.js: `users`
  columns `id ('u1'…), name, email, roles[], color, initials, active,
  createdAt(ms)`. Timestamps stay epoch-ms numbers app-wide (prototype
  convention).
- **D8. Rebuild-only columns:** `users.googleEmail` (alternate email used
  for SSO matching — Jeff's row seeds `jchesebro1@gmail.com` so the owner
  can sign in before a Workspace decision, QUESTIONS #1) and
  `users.photoUrl` (Google avatar, stored but initials avatars still render,
  as designed).
- **D9. `app_settings`** is a single-row sparse patch over the settings.js
  DEFAULTS (same semantics as `rss_settings_v1`), including the two seed
  offices. The prototype's live `rss-settings` event becomes
  `revalidatePath` + `router.refresh()`.
- **D10. Server-side guards the prototype didn't need** (it was
  per-browser): you can't deactivate/remove your own account, and the team
  can never drop to zero active Admins. All team/settings mutations require
  the `manage_users` permission server-side, not just hidden UI.

### UI
- **D11. The extracted specs in `docs/specs/*.json` are the token source**
  (they corrected the handoff README: the nav is a **horizontal top bar**,
  not a left sidebar; fonts are **Public Sans + IBM Plex Mono**, not
  Barlow; default accent is **#7b3f8a**). Screens are built from those
  specs + the prototype files.
- **D12. Route map:** `.dc.html` screens → routes (`Flame Tests.dc.html` →
  `/flame-tests`, etc. — full map in `src/components/nav/nav-data.ts`).
  Every nav destination has a placeholder page stating its phase.
- **D13. Phase-1 nav simplifications:** badges and the to-do bell aggregate
  data stores that arrive in Phase 2, so they're wired but empty; the sync
  chip reflects online/offline only until the offline sync engine (Phase 6).
  "Sign out" is real (the prototype's was cosmetic).

### Deployment
- **D14. Vercel + Neon is the recommended host pair** (documented
  step-by-step in DEPLOY.md). Nothing is Vercel-specific though — any
  Node+Postgres host works. Deployment needs accounts only Jeff can create
  (Vercel, Neon, Google Cloud OAuth), so Phase 1 ships deploy-ready config +
  instructions rather than a live URL; see QUESTIONS.md "Phase 1 blockers".

## Phase 2 (2026-07-11)

- **D15. Flame-test $150 floor semantics:** the IDEAS.md sketch said
  "max($150, curtain labor) per bundled venue," but `flametest.js` (the
  authoritative code) applies the floor to a standalone job's whole cost
  including travel. Ported the code. Also settled: 5 minutes per curtain
  (both engine sources agree), not the 2 in the IDEAS sketch.
- **D16. Demo data defaults:** local dev seeds the full prototype demo book
  automatically (explorable app out of the box); hosted databases start
  clean — flip Settings → Beta → Demo data (or `SEED_DEMO=true npm run
  db:seed`) to fill empty collections. Existing records are never touched.
- **D17. Sync bookkeeping:** on the server, a write IS the office copy, so
  records are stored `synced`; the prototype's per-record pending/error
  states return on the client side with Phase 6 offline capture. The
  push/pull endpoints (rev + seq cursors, server-owned review subdoc)
  are already live.
- **D18. Soft deletes everywhere:** prototype hard-deleted locally; the
  rebuild tombstones (`deleted:true`) so offline devices converge — and
  record ids are never reused after deletion.

## Phase 3 (2026-07-11) — Sales screens

- **D19. View switchers via SegmentedToggle:** the prototype showed some
  screens' variants as separate design canvases (Leads 1a/1b/1c). Production
  needs one screen, so those became a Board/Worklist/Table segmented switch
  (URL `?view=`). Leads defaults to Table (matches the shipped
  `Leads.dc.html`).
- **D20. Estimator quote spec** persists `{ sections, mobs }` on
  `quote.spec` (prototype saved only `mobs`). Section/item field names match
  what `projects.ts` already reads, so won quotes still spawn projects with
  correct procurement lines. `contactName`/`quoteNote` ride on the quote doc
  via a typed extension (prototype did the same dynamically).
- **D21. Flame-test quotes** open in `/estimator` for now; the dedicated
  Flame Test Quote builder is a Phase 4 screen. The "+ New quote → Flame
  test" menu points at `/flame-tests` until then.
- **D22. Plan-drawing editor deferred (pre-approved):** Quick Design's and
  Design's freehand manual-layout canvas (drag-drop placements, plan import,
  line-set schedule table) shows a styled "arrives with the spatial-
  estimating work" panel — matches IDEAS #4/#9 being open scope. Everything
  auto-mode (venue → sizing formulas → tiers → BOM → generated groundplan
  with draggable walls/doors) is fully live. `placements`/plan fields still
  round-trip untouched in the design `config`.
- **D23. Global ⌘K search** (`/api/search`) ported from the Nav's search
  sources — quotes, designs, surveys, inspections, threads, customers,
  catalog — grouped results, live as-you-type.
- **D24. Public Lead Intake** lives at `/lead-intake` (outside auth), posts
  to `/api/leads/intake` (honeypot + Zod validation); budget band is folded
  into the lead message since the pipeline has no dedicated value field on
  intake.
- **D25. Tier definitions** (Quick Design Good/Better/Best specs) stay
  localStorage-per-browser like the prototype — they're a per-estimator
  preference, no shared-store contract exists for them yet.

## Phase 6 (2026-07-11) — Offline field capture (PWA + outbox)

- **D26. Durable outbox in IndexedDB, not localStorage.** The prototype's
  "outbox" was the per-record `syncState:'pending'` flag inside each
  localStorage array. The rebuild is server-authoritative, so the outbox
  becomes a real durable queue in IndexedDB (`peak-sync` DB, `src/lib/sync/`):
  `outbox` (whole docs awaiting push), `mirror` (read-cache of the field
  collections), `meta` (pull cursors, lastSyncAt). Dependency-free — no PWA
  library added, so Jeff's install stays a plain `npm install`.
- **D27. Save-seam, one line per editor.** Faithful to the spec's "the seam
  is one line per store." Capture editors save through
  `saveThroughOutbox({collection,id,doc,action})` (`src/lib/sync/save.ts`):
  online + not paused → run the normal server action (the cloud write, which
  also revalidates the SSR UI) and mirror the doc; offline / "Work offline" /
  network-drop-mid-save → queue the WHOLE resulting document and flush it to
  the existing `POST /api/sync/push` (whole-doc upsert by client id) on
  reconnect. Pull runs against `GET /api/sync/pull` (seq cursors) to bring
  office changes into the mirror and `router.refresh()` the current screen.
- **D28. Last-write-wins, office wins on conflict.** `/api/sync/push` returns
  `conflict` only when the queued rev is strictly behind the server (the
  office edited the same record while the device was offline). Policy: keep
  the server copy, drop the stale capture, and surface a count in the sync
  panel — matches the prototype's "server-owns-review, client-owns-field-data"
  merge without a manual merge UI (out of scope for v1).
- **D29. Manual "Work offline" toggle** persists under the prototype's exact
  key `rss_sync_paused_v1` (lastSync under `rss_sync_last_v1`); the live Nav
  sync chip replaces Phase 1's `navigator.onLine`-only placeholder and shows
  offline / work-offline / syncing / N-to-sync / synced with a panel to sync
  now or toggle offline.
- **D30. App shell cached by a hand-rolled service worker** (`public/sw.js`,
  `peak-shell-v1`), a direct port of the prototype's `sw.js` policy:
  network-first for same-origin GETs (path-keyed, query stripped) so any page
  visited with signal reloads offline; API routes never cached; fonts
  cache-first. App DATA lives in IndexedDB, not the SW. Installable via
  `manifest.webmanifest` + `icon.svg`.
- **D31. App icon is a temporary monogram** (`public/icon.svg`, dark "P"),
  same placeholder posture as the letterhead in G1 — swap for the real logo
  files when they land (one asset, all surfaces).
- **D32. Offline scope = the field-capture surfaces.** Made offline-capable:
  Field Survey editor, Rigging Inspection editor, Flame-test results, Repair
  results, and Field Work captures. Deliberately online-only (need a server
  round-trip / redirect / cross-record transaction, not a field operation with
  no signal): delete, "create quote from survey/inspection", won-quote
  spawning, and office review/triage. Cold-opening a record the device has
  never loaded still needs signal (the SW serves any *previously visited*
  record offline); a full pre-download of all assigned jobs is a possible
  later enhancement.

## Phase 7 — Gmail integration

- **D33. The Gmail bridge is env-gated and lazy; deliverMessage() stays the
  sync local stamp.** Real Gmail send is async, but comms's `deliverMessage()`
  runs inside doc-store *synchronous* mutate callbacks, so it can't do network
  I/O. Decision: keep `deliverMessage()` as the optimistic local stamp (queued
  cleared, at=now) — the entire simulated path when Gmail is off — and add an
  async `dispatchOutbound()` that the comms mutators call AFTER the write. It
  lazily `import()`s `lib/gmail/bridge` only when `gmailBridgeActive()` (both
  Google creds present AND `GMAIL_ENABLED=true`). The lazy import keeps Gmail
  code out of the simulated path and breaks the static cycle (bridge imports
  comms). Inbound: `checkMail()` delegates to `bridge.pollInbound()` under the
  same gate, else the canned queue. Net: with no credentials the app behaves
  exactly as Phases 1–6 did.
- **D34. One Google project, a SEPARATE consent for mailboxes.** Gmail reuses
  the Auth.js Google OAuth *client* (AUTH_GOOGLE_ID/SECRET) but runs its own
  authorization-code flow (`/api/gmail/connect` → Google → `/api/gmail/callback`)
  requesting Gmail scopes + `access_type=offline`. Sign-in keeps its minimal
  openid/email scopes; connecting a mailbox is an explicit, incremental extra
  consent, so simply enabling Google SSO never starts touching mail. Scopes are
  least-privilege: `gmail.send` (a send also lands in that account's Gmail
  Sent — satisfies C4), `gmail.readonly` (import + poll), `userinfo.email`
  (learn the connected address).
- **D35. Per-mailbox connections in a relational table; tokens encrypted at
  rest.** New `gmail_connections` table (not a doc collection — it's config,
  not business data), one row per mailbox key (`personal:<userId>` |
  `sales`/`installs`/`info`). Refresh/access tokens are AES-256-GCM encrypted
  with a key derived from AUTH_SECRET (`lib/gmail/crypto.ts`); the Settings UI
  and all reads only ever see the address + status, never token material.
  Access tokens are refreshed transparently 60s before expiry.
- **D36. No new npm dependency — Gmail over plain fetch.** Every Google call
  (OAuth token, userinfo, Gmail v1 send/list/get/history/profile) is a `fetch`
  against the documented REST endpoint; MIME is built/parsed by hand
  (`lib/gmail/mime.ts`, plain-text bodies only). Rationale: this locked-down
  machine has no Homebrew/global toolchain and we've kept the dependency
  surface tiny all along; `googleapis` would add a large tree for a handful of
  endpoints. Inbound history import runs lazily on the first "Get mail" after
  connect (90-day window, `newer_than:90d`), then incrementally via the Gmail
  `history.list` cursor stored on the connection row.
- **D37. Mailbox connection UI lives in admin Settings for v1.** The Settings
  "Mailboxes" card connects the admin's own inbox + all shared boxes. The
  `/api/gmail/connect` route already authorizes any user to connect their OWN
  personal box (self, no admin needed), so surfacing a per-user "Connect my
  mailbox" button on the Account page is a thin follow-up (MASTER-QUESTIONS
  §C) — deferred to keep Phase 7 scoped, since the go-live team is small and
  Jeff (admin) can manage connections centrally.

## Phase 8 — AI features (2026-07-11)

- **D38. AI is env-gated on `ANTHROPIC_API_KEY` alone (no separate opt-in
  flag).** Unlike Gmail — where Google SSO can be configured for sign-in
  without wanting mailbox access, hence the extra `GMAIL_ENABLED` toggle — an
  Anthropic key exists for exactly one purpose, so its presence *is* the
  opt-in. `aiEnabled()` (`lib/ai/config.ts`) is true iff the key is set and
  `AI_DISABLED !== "true"` (a kill switch for incidents). Off → every UI
  affordance is absent, the Assistant nav link and page are hidden, and every
  server action returns `{ok:false, error:"AI features are not enabled."}`
  without touching the network. Same "inert until the credential lands" posture
  as Phase 7.
- **D39. No new npm dependency — Anthropic over plain fetch.** Every model call
  is a `fetch` against `POST /v1/messages` (`lib/ai/client.ts`), mirroring the
  Gmail bridge's fetch-only Google calls (D36). Rationale identical: this
  locked-down machine has no global toolchain and we've kept the dependency
  surface tiny; the `@anthropic-ai/sdk` tree isn't worth it for a handful of
  calls. Model `claude-opus-4-8` (override via `ANTHROPIC_MODEL`); structured
  output uses `output_config.format` (json_schema); `stop_reason:"refusal"` is
  handled; a `AbortController` timeout bounds each request.
- **D40. The guardrail is structural: AI drafts, humans send (MASTER-QUESTIONS
  D6).** The `lib/ai/features.ts` functions return drafts/suggestions only and
  never import a store; each route's server action owns the write. Renewal
  drafts land in Inbox **Drafts** (never sent); import extraction feeds the
  existing paste→preview→confirm pipeline (the server re-parses the reviewed
  rows, never AI output directly); estimator line drafts carry NO price (price
  stays estimator-set); the Assistant is read-only. Nothing auto-sends,
  auto-commits, or auto-persists.
- **D41. `lib/ai/` is store-decoupled; routes gather their own data.** The AI
  layer (`config`/`client`/`features`) knows nothing about stores, so there's
  no import cycle and it's reusable. Each feature's server action reads the
  stores it needs and passes typed context in. The Assistant's live snapshot is
  built in `app/(app)/assistant/snapshot.ts` (route-local, server-only) and the
  model is instructed to answer ONLY from it and to say so when a question
  needs data the snapshot doesn't carry — no tool-use/RAG in v1.
- **D42. Assistant is a gated top-level nav link, not a Sales/General child.**
  `navEntries(aiEnabled)` inserts the "Assistant" entry after Inbox only when
  AI is on, so there's never a dead tab pointing at an inert feature; the page
  itself re-checks the gate (URL access) and shows a "not enabled" note when
  off. The snapshot is company-wide but scoped to the user's own Inbox view for
  the inbox lines, matching what they already see across the app.

## Phase 9 — Data migration & go-live (2026-07-11)

- **D43. "Clear demo data" is a hard delete, and the exact inverse of the
  seed.** `clearDemoData()` (src/db/seed-data.ts) removes every row from the
  same collection list `seedDemoCollections()` fills — customers, leads,
  quotes, surveys, comms, flame/repair jobs, inspections, projects, designs,
  and catalog parts — via a new `clearCollection()` that DELETEs rows outright
  rather than tombstoning. Rationale: go-live runs on a fresh prod DB with no
  field clients holding demo data yet, so soft-delete tombstones would only be
  noise; an empty table is the honest starting point. The two functions read
  from one `DEMO_SEEDS` list so seed and clear can never drift.
- **D44. The reset keeps configuration, wipes only demo business records.**
  Team/users, app settings (company name, accent, locations), estimating-rate
  blobs, and Gmail connections are deliberately untouched — they're real setup,
  not fixtures. So the go-live path is: keep your team + settings, clear the
  demo records, import your real data.
- **D45. Destructive action gated by a typed `CLEAR` confirmation, Admin-only.**
  `clearDemoDataAction` requires `manage_users` and the literal phrase, and it
  also flips `seedDemo` off so the collections don't re-seed on next boot. It
  lives in Settings → Beta next to the demo-data toggle (its natural pair),
  not behind a CLI, so a non-developer owner can run go-live themselves.
- **D46. `npm run db:export` is one timestamped JSON of the whole database.**
  scripts/export.ts dumps every doc collection + blobs + users + settings +
  notif prefs + Gmail connections to `backups/peak-backup-<stamp>.json`
  (gitignored — it contains encrypted tokens). One portable file is simpler for
  a non-developer to store in Google Drive (MASTER-QUESTIONS I5) than a
  per-table dump; it respects `DATABASE_URL` so the same command backs up Neon.

## Site Intake extension (built 2026-07-12)

- **D47. Site Intake ships as an extension of Field Surveys, not a new module.**
  Jeff's site-intake sketch + module spec (dictated 2026-07-11; ideas ledger
  #45) called for a tiered venue intake with discipline branches. ~60% of the
  general form already existed on the survey record, and offline capture — a
  hard requirement in the spec — was already solved by the survey outbox, so
  the intake fields live on `SurveyRecord` and the editor gains a "Site
  intake" group. Venue identity keeps riding customers/locations; no separate
  Venue table.
- **D48. Tier-1 "kill questions" are a soft gate.** Venue name, contact
  name/email/phone, stage width + depth must be answered before the four
  discipline intakes (Rigging / Curtain / Lighting / AV) unlock, but the
  record always saves as a draft — a rep in the field never loses work. The
  sketch left gate strictness open; Jeff chose soft (2026-07-12). Width/depth
  accept the venue-type-specific quick-measurement keys, so a black-box room
  width satisfies "stage width".
- **D49. Lighting + AV get structured inventories; Rigging + Curtain stay
  free-text (v1).** Inventory rows are type + quantity + attention-flag +
  note, with types from an admin-editable catalog (Settings → "Site intake —
  type catalog", stored as a settings patch over `DEFAULT_INTAKE_CATALOG`).
  Standardized types are the future join key to the quote engine — this
  module deliberately carries **no pricing** (spec decision #3).
- **D50. Intake status is derived, not hand-set — except the last step.**
  draft → general-complete → discipline-added derive from the data
  (tier-1 completeness, any discipline/inventory content); ready-for-quote is
  an explicit flag the user sets from the Kill-questions card. Status shows
  as a chip in the editor header and on survey list cards (hidden while
  draft, since every pre-intake survey is a draft). Model lives in
  `src/lib/stores/survey-intake.ts` — a pure module shared by the DB-backed
  store and the client editor.

## Repairs + Inspections buildout — IDEAS #44 completion (built 2026-07-12)

- **D51. Repair report ships in three variants — letter / summary / service
  report — defaulting to the formal service report.** Mirrors the flame-test
  report's variant pattern exactly (same toolbar tabs, same .pk-doc-page
  foundation). The completion record (work performed, parts used, follow-up)
  drives the copy; a follow-up note flips the status chip to "Follow-up
  Recommended". A three-up comparison canvas lives at /repairs/report/options
  (reference the variants as 2a / 2b / 2c when you pick a default).
- **D52. Inspection pricing is a NEW engine (no prototype existed) shaped
  after the flame/repair engines.** hours = (baseHours + lineSets ×
  lineSetMinutes/60) × (Level 2 ? ×level2Mult : 1); total = max(minFee,
  (hours × laborRate + shared trip travel) ÷ (1 − margin)). Trip math is
  IMPORTED from the repair engine so the two can never drift. Defaults are
  placeholders ($95/hr, 15 min/line set, 2 base hrs, ×1.75 L2, $650 min,
  30-pt margin) — all live-editable in Estimating Rules → "Inspection
  pricing" (blob `inspection_rates`).
- **D53. An accepted inspection quote spawns ONE `requested` record PER
  QUOTED VENUE.** Inspection records are per-venue (one report per venue),
  while the quote prices multiple venues as one shared trip — so the spawn
  fans out, splitting the quote value evenly across venues (rounding
  remainder on the first). Same accepted-quote seam as flame/repairs:
  status 'won' → createFromQuote/syncFromQuotes, wired into the Quotes hub's
  won action too.
- **D54. Renewals track BOTH cadences independently — latest completed
  inspection per customer + venue + LEVEL.** Level 1 = annual, Level 2 =
  every 5 years (Jeff's Q&A in the #44 ledger entry); the anchor is the
  inspection's surveyDate and the lead window is 60 days (same as flame,
  per MASTER-QUESTIONS Q24 default). "Start renewal" opens a prefilled
  inspection quote at the venue's level — the quote front now IS the renewal
  path (carryForward remains for pulling open logs into the new capture).
- **D55. Inspections "Report Options" compares the EXISTING report's three
  layouts** (report / dossier / compact at /inspections/report/options,
  reference 3a / 3b / 3c) rather than inventing new variants — the client
  report already shipped with layout + section toggles, so the options
  canvas is a picker over those. The quotes hub also gained type badges
  (Flame test / Repair / Inspection) and per-type "Open …" edit links, and
  the "+ New quote" menu now lists all three auto-priced service quotes.

## Wave 2 — IDEAS #22 / #32 / #34 / #37 (built 2026-07-12, same day)

- **D56. The day-of "Log results" quick-start (#34) is a day sheet, not a
  bulk form.** Jeff's ask left scope open; default taken: a green
  "Log results · N" button on the Flame Tests header opens
  /flame-tests/today — every scheduled visit due today (overdue visits that
  were never logged stay in the queue, flagged), one Log-results button per
  row, with the next five upcoming visits underneath so the sheet is never a
  dead end. Bulk one-screen entry can layer on later if the day sheet feels
  slow in the field.
- **D57. Renewal outreach (#37, per F7) is a stamp on the latest completed
  job/record — not a separate list.** "✓ Reached out" stores {at, by} on the
  flame job / inspection record whose renewal is due; completing a new
  test/inspection starts a fresh record, so every cycle naturally resets to
  un-contacted (complete() also clears the stamp on re-completion). The
  renewals panel defaults to the to-contact worklist with a
  "Reached out — awaiting" secondary view + Undo.
- **D58. The Quotes hub type filter (#22, per F6) composes owner → type →
  status.** A quote with no quoteType counts as a System quote; the status
  counts and stat tiles reflect the type slice so the pipeline numbers match
  what the list shows.
- **D59. Logos (#32) are small data-URL images in app settings.** Two slots:
  light (dark nav bar) and dark (documents), uploaded in Settings → Branding,
  capped at ~300 KB, admin-only. Every letter + report (flame, repair,
  inspection — including the inspection report's typographic letterhead)
  renders the dark logo when present and falls back to the baked-in Peak
  letterhead when not, so nothing changes until Jeff uploads the real files
  (closes the G1 gap from the app side).

## Customer portal — IDEAS #47 phase 1 + quote requests (built 2026-07-12)

- **D60. Portal sign-in = per-person magic links, no passwords.** Exactly the
  #47 design call: each contact gets their own long random access link,
  created and revoked from the customer record (Customers → Portal access
  card). Opening the link plants an httpOnly cookie scoped to /portal
  (6-month life); revoking a grant kills the link AND any signed-in session
  immediately. Until link-emailing rides the Gmail integration, the office
  copies the link into their own email — same ceremony as sharing the public
  lead-intake URL.
- **D61. Hard tenant scoping — the portal never reuses team endpoints.**
  /portal is exempted from the team-auth middleware and runs its own
  portalSession() check inside EVERY page and server action; the customerId
  always derives from the grant, never from anything the client posts. The
  portal reads through the same stores but filters to that one customer.
- **D62. Customers see PUBLISHED quotes only.** Drafts never appear; sent /
  won / lost render as "Awaiting your review" / "Accepted" / "Declined" with
  name, id, date, and total — no margins, costs, or internal notes. Venue
  compliance chips reuse the renewal math (flame annual · inspection L1/L2)
  so the portal starts nudging self-serve renewals (#31/#36/#37 thread).
- **D63. Portal quote requests land in the Leads pipeline as source
  "existing"** — unassigned, so they enter the SLA response queue (48h),
  pre-linked to the customer record with the requester, venue, service type
  and urgency in the message ("[Portal request — <name>] …"). Department
  scoping is carried structurally on grants (dept field) but v1 shows the
  customer org's whole published world — mapping people → departments needs
  Jeff's org info (MASTER-QUESTIONS F15). The #48 self-serve estimator
  stays parked on the catalog gap.

## Portal quote acceptance — IDEAS #47 P3 slice (built 2026-07-12)

- **D64. The portal "Accept quote" button is exactly Jeff's non-binding
  design.** Accepting stamps `portalAcceptance {at, by, byEmail}` on the
  quote (tenant-checked: the quote must belong to the grant's customer and
  be in the published `sent` state) and changes NOTHING else — the customer
  sees "Accepted — awaiting confirmation", the team sees a "✓ Customer
  accepted" chip on the Quotes hub plus a new "Portal acceptances to
  confirm" to-do bell group (mutable per user in Account → notifications).
  A human confirms by marking the quote Won, which runs the existing
  accepted-quote spawn machinery untouched. Verified live: Q-2045 accepted
  by the Susan Marsh grant → chip + bell → Won → flame job in the scheduler.

## One-click renewal outreach — IDEAS #36 (built 2026-07-12)

- **D65. The ✉ on a renewal row IS Jeff's one-click flow, end to end.**
  Clicking it mints this year's quote from LAST YEAR'S PRICE VERBATIM (the
  F8 default, per his Jul-3 comment), renders the proposal letter to a real
  PDF, lands a ready-to-send draft in the **Sales shared mailbox** (the
  idea's "right shared mailbox"; the From picker still lets you switch),
  linked to the renewal's job/record, and redirects to the Inbox with the
  composer open (`/inbox?draft=<id>`, a new deep-link that opens any saved
  draft). SENDING — not clicking — stamps the #37 "reached out" state and
  moves the attached quote draft → sent; "✓ Reached out" stays for phone
  outreach. Both dashboards get the same flow (flame + inspections, cadence
  per D54). When the email template has no price to cite (seed-era records
  carry value 0) the price sentence is omitted rather than quoting "$0".
- **D66. Attachments are now REAL through the whole comms pipeline** —
  `CommAttachment {name, mime, size, dataUrl}` on drafts and messages
  (data-URL storage, same approach as the D59 logos; a letter PDF runs
  ~120 KB), chips in the composer (read-only) and on reader messages
  (download via the data-URL), and multipart/mixed MIME in the Gmail bridge
  when the env gate is on. The composer's fake "Attach (demo)" button is
  gone — a cosmetic stub next to real attachments would mislead (a manual
  file-upload affordance is a logged follow-up, MASTER-QUESTIONS F17).
- **D67. PDF generation is a hand-rolled, zero-dependency renderer**
  (`lib/pdf.ts`: PDF 1.4, Helvetica/WinAnsi + real width tables, deflate
  via node:zlib) — same no-new-deps rationale as the fetch-only Gmail (D36)
  and Anthropic (D39) clients. It composes the SAME letter the on-screen
  /flame-tests/letter · /inspections/letter routes print: JPEG letterheads
  embed directly (DCTDecode — the baked Peak sheet, read from the source
  asset with a graceful skip in bundled deploys, or an uploaded logoDark
  when it's a JPEG); PNG logos can't embed without a decoder and fall back
  down the same ladder (MASTER-QUESTIONS F18 flags this for G1).
- **D68. One renewal, one quote, one draft — idempotent by keys, and the
  ✨ AI path converges.** The quote carries `renewalOf: <job/record id>`
  (reused while not lost); the draft is found by its thread link (reused
  while unsent; clicking ✉ again refreshes the PDF — so re-pricing the
  quote and re-clicking updates the attachment — but never clobbers
  hand-edited copy). The D1 "Draft ✨" button now routes through the same
  flow with AI copy replacing the template, so both buttons land on the
  same draft and D1's "quote attached" description is finally literal.
- **D70. Customer quote document redesigned past the prototype** (Jeff:
  "the quote seems very boring and needs more", Jul 12). The Estimator
  preview keeps the prototype's data contract (sections/lines/totals,
  Show-on-PDF toggles) but the sheet itself deviates: a QUOTE title block
  with issued/valid-through dates (30 days, matching the terms), the REAL
  project name + venue (the port hardcoded "Stage Systems Package / Main
  Auditorium — Phase 1"), a prepared-by column, an accent-tinted
  total-investment band, accent-edged section bars with numbering, a
  by-section summary line (that mode previously rendered bare bars), an
  "Optional additions" block for option-flagged items (previously
  invisible to the customer) behind a new Options toggle, itemized terms,
  and an acceptance/signature strip that points at the D60 customer
  portal. Branding follows the house rules: everything accent-colored
  flows from --accent/--accent-soft, and the letterhead uses the D59
  ladder (uploaded logoDark, else the baked sheet) — the estimator was
  the one document #32 missed.

- **D69. Renewal quotes RE-PRICE at current rates; the email explains the
  change (Jeff, Jul 12 — supersedes the D65/F8 "last year's price verbatim"
  default).** The ✉ flow now runs the real pricing engine (flame /
  inspection) over LAST YEAR'S scope — venues, curtain counts, line sets —
  with TODAY'S rates and directory travel data, and the quote/PDF carry
  this year's number. The email always cites last year's price ("$462,
  compared with $385 last year") and, when the prior quote stored a rate
  snapshot (every app-minted quote does), itemizes WHY in customer-safe
  terms: federal mileage rate, labor rate, per-curtain/line-set time,
  minimum fee (only when the floor actually applied), travel distance, and
  scope changes. Margin movements are never named to a customer — they fall
  back to generic "current rates"/"updated pricing" wording, as do seed-era
  renewals with no snapshot. Inspection renewals from a multi-venue prior
  quote say plainly that last year's visit combined N venues while this
  quote covers the venue alone. Unchanged prices say "unchanged from last
  year"; unknown prior prices skip the comparison. The reason builder is
  covered by a 15-case unit sweep (scratch harness) plus the live browser
  pass; re-clicking ✉ still reuses the cycle's quote + draft untouched.

- **D71. Service proposal LETTERS modernized off their imported reference
  templates** (Jeff, Jul 12 — "the quote template is based on something I
  imported, it was meant to be a reference and instead should be refreshed
  to look more modern and professional"). The flame-test
  (/flame-tests/letter) and rigging-inspection (/inspections/letter) on-
  screen proposals were pixel ports of an OLD imported Peak proposal kept
  as reference. Both now deviate into a modern proposal layout — accent-
  ruled letterhead, a large title block (proposal name + quote id +
  level/standard), a Prepared-for / Location / Scope meta grid, an accent-
  tinted TOTAL price band, a three-tile "your visit, at a glance"
  (travel each way · on-site testing/inspection · total visit, shown only
  when trip miles exist), a right-aligned venues table (replacing the
  bullet list), and a ruled sign-off with a mono doc footer. Every fact,
  figure, and load-bearing sentence is preserved (NFPA 705 quote block +
  curtain counts on flame; the OSHA/NFPA/ANSI E1 explainer + level cadence
  + line-set counts + re-inspection note on inspections), so the emailed
  PDF twin (lib/renewal-outreach.ts, its own renderer) still matches the
  on-screen copy. Accent flows from settings via color-mix, letterhead
  uses the D59 logo ladder. The Estimator quote doc got the same treatment
  in D70. The old Date/Venue/RE header lines and the "Dear … / contact me
  directly at:" epistolary framing are dropped in favor of the meta grid +
  a single greeting; the greeting only renders when a contact name exists
  (no more "Dear Sir or Madam" on unaddressed drafts).

- **D72. Flame-test quote → "Field Flame Inspection" service work order (new
  template + rebrand + spicier copy)** (Jeff, Jul 12 — "spice up the
  verbiage… change the wording on documents to say Field Flame Inspection
  instead of Flame Test… change the language for the price… I ultimately
  want a completely new layout and template"). Two changes:
  (1) RENAME — the customer-facing SERVICE is now "Field Flame Inspection"
  (was "Flame Test") on the on-screen proposal (/flame-tests/letter) and the
  emailed PDF twin + email (lib/renewal-outreach.ts: tag, RE, subject/body,
  filename, quote name, priceParagraph kind). The NFPA 705 standard is still
  cited accurately ("Recommended Practice for a Field Flame Test" is the
  standard's real name — the SERVICE is rebranded, the standard is not).
  Internal ids/routes/type keys (quoteType "flame_test", /flame-tests, badges)
  are unchanged — display copy only. The Field Flame Inspection RESULTS
  report/certificate (/flame-tests/report, all three variants) was also swept
  (see the note under the inspection rework below).
  (2) NEW TEMPLATE ("Work Order 705", chosen via a 4-way judge-panel design
  pass over editorial / spec-sheet / safety-authority / boutique directions;
  spec-sheet won for credibility-to-a-technical-director). The proposal is now
  framed as an issued NFPA 705 service work order: a document-control header
  band (title + SERVICE WORK ORDER subhead + an ENGAGEMENT-FEE price
  counterweight, and a 2×3 control grid DOCUMENT/ISSUED/VALID THROUGH/METHOD/
  REV/SHEET), an ISSUED TO / ISSUED BY parties row, a line-item SCOPE OF WORK
  table (a walk-through of the visit — field-test / mobilize / document — with
  real per-row hours and a TOTAL ON-SITE + TRAVEL footer, replacing the D71
  "visit at a glance" tiles), a METHOD callout, a bordered ENGAGEMENT FEE box
  with the total echoed as a 34pt hero numeral and a punchy headline
  ("Everything above … comes to $462, all in." — replaces "The above services
  will cost $462."), and an AUTHORIZATION / signature block. One accent only
  (color-mix tints ≤12%, meaning carried by borders/labels/mono so it survives
  B/W print); logo via the D59 ladder; body sans + mono figures per D71's font
  fix. Supersedes the D71 layout for both service proposals: the
  rigging-inspection proposal (/inspections/letter) was reworked onto the same
  Work Order 705 template (line sets instead of curtains, a LEVEL control
  field + level cadence, an OSHA/NFPA/ANSI E1 STANDARD callout + re-inspection
  note; NOT renamed — it was already "Rigging Inspection"). Its emailed PDF
  twin (inspectionLetterDoc) carries the same spicier intro/price copy.
  Finally, the flame RESULTS report/certificate (/flame-tests/report — letter,
  summary, and certificate variants + the /options compare canvas) was swept:
  the SERVICE/deliverable labels became "Field Flame Inspection" (report tag
  "Field Flame Inspection Results", the RE: line, the "Field Flame Inspection
  Summary" box, the /options eyebrow + tab titles), while the NFPA 705 standard
  name and the physical field-flame-test METHOD phrases ("passed the field
  flame test", "Recommended Practice for a Field Flame Test", the "NFPA 705 ·
  Field Flame Test" certificate eyebrow, the method explainer) are kept
  verbatim — that's what the authority having jurisdiction expects on a
  compliance record. Internal team chrome (the nav feature is still "Flame
  Tests", the report screen's not-found/back-links) is unchanged; renaming the
  whole feature/route/nav is a bigger, separate call. Note: page.tsx carries a
  pre-existing `react-hooks/static-components` lint error (an inline `Frame`
  component) unrelated to this rename.
- **D73. Inbox mirrors Gmail's INBOX state — one-way, via a per-sync
  reconcile** (PUNCHLIST #1, Jul 19). Every mailbox sync (manual Send/Receive
  and the new background auto-sync) ends with an ids-only
  `threads.list q=in:inbox` sweep that stamps `gmailInboxed: boolean` onto
  bridged comms threads: archived OR filed-to-a-label on the Gmail side drops
  the thread out of the Peak inbox (it stays findable under Archived); Gmail
  re-inboxing it (new inbound, manual move) flips it back. Full-state listing
  over history label-events on purpose: 1 call/500 threads, immune to
  event-ordering, and it also covers the two windows history can't — the
  initial 90-day import (which has no label filter, so Gmail-archived mail
  used to land in the Peak inbox) and an expired/reset history cursor.
  `gmailInboxed` is deliberately separate from the user-owned local `archived`
  flag (no flip-flop wars with Peak's own Archive button; simulated mode
  untouched). Safety: the sweep is scoped per mailbox key, skips threads
  without a `gmailThreadId`, and on a truncated listing (>20 pages) only ever
  re-inboxes, never hides. Adjacent fix, mirroring Gmail + addMessage(): a new
  INBOUND on a locally-archived thread clears `archived` so replies resurface.
  Peak→Gmail archive push stays out of scope (needs gmail.modify + re-consent
  of every mailbox; D34 least-privilege stands). "Actively": the inbox shell
  now fires a silent autoSyncAction on mount and every 3 min while visible.
  EVERY sync path claims each mailbox atomically IMMEDIATELY before syncing
  it (conditional START-stamp of last_sync_at — auto with its 2-min staleness
  window, manual Send/Receive with a 10s guard so a click always syncs unless
  that mailbox literally just started), so concurrent tabs/users/paths can't
  overlap a mailbox and a failing mailbox still advances its stamp instead of
  defeating the throttle; mailboxes whose one-time initial import hasn't run
  are skipped by the auto path (the long import stays on the manual button,
  per the connect flow). Bridge thread creation is id-collision-safe
  (insert-if-absent + full dedup redo on collision) since nextPrefixedId's
  max-scan can race. autoSyncAction deliberately does NOT revalidate (a
  server-action revalidate applies the new tree in the same roundtrip, mid-
  typing); the inbox client refreshes only when a sync actually changed
  something and never while typing — changes seen while typing are latched
  and flushed on the next tick or field blur. Hardening from the
  adversarial review: pure-outbound threads (composed in Peak / sent-only
  imports) are never demoted — absence from in:inbox carries no "archived"
  signal for a thread that was never inboxed; threads carry gmailAccountKey
  (stamped at import/send) so reconcile judges each thread against the Gmail
  account that owns its thread id, not a display-name lookup (same-name
  users, future moveTo claims); the Needs-reply view/count also excludes
  gmail-archived threads (disposed-in-Gmail shouldn't keep nagging; locally-
  archived stays included, pre-existing semantics); and the reader's Archive
  button toggles to Unarchive on locally-archived threads (the Archived
  folder is now populated, so the missing affordance had become a dead end).
  Known residual: two MANUAL Send/Receive clicks more than 10s apart during
  a single mailbox sync that runs longer than that (realistically only the
  one-time multi-minute initial import) can still overlap (pre-existing
  exposure; the button self-disables per tab, and thread creation is now
  collision-safe) — a full lease/heartbeat isn't warranted for a 6-person
  team.
- **D74. Sync is server-side and archive is two-way** (Jeff, Jul 19: "I want
  Sync to be server side so it is always current" / "Correct Two-Way
  Archive"). Server-side: three triggers now funnel into the same atomic
  per-mailbox claim throttle (shared AUTO_SYNC_MIN_AGE_MS in gmail/config) —
  the D73 inbox client tick, a new instrumentation.ts boot timer (any
  long-running Node server: next dev/start, the LAN box; singleton across HMR;
  inert without the Gmail gate), and a new GET /api/gmail/sync cron route
  (vercel.json crons every 5 min; CRON_SECRET bearer auth, 503 until the env
  var exists; exempted from the session middleware since crons have no
  session; Vercel sends the header automatically; DEPLOY.md documents the
  Hobby-plan cron limitation + external-pinger alternative). Two-way archive:
  GMAIL_SCOPES now includes gmail.modify; comms.archive()/unarchive()
  dispatch bridge.pushInboxState(), which adds/removes the Gmail thread's
  INBOX label via threads.modify and stamps gmailInboxed locally so the UI is
  right immediately. Connections whose stored grant predates the scope stay
  one-way and Settings→Mailboxes flags them "reconnect to enable two-way
  archive" (ConnectionInfo now exposes the granted scope). The reader's
  Archive/Unarchive toggle now keys on locally-archived OR gmail-archived, so
  Unarchive genuinely re-inboxes a Gmail-archived thread.
- **D75. Renewal drafts are rules-based standard language, not AI** (Jeff,
  Jul 19: "just come up with standard language that we set rules to"). The
  separate AI-draft button on Flame Tests renewals is REMOVED (renewal-ai.tsx
  + renewal-ai-actions.ts deleted, draftRenewalEmail dropped from ai/features
  and the AI_FEATURES registry). The ✉ one-click flow was already the rules
  path and is now the only one: flame_renewal_email / inspection_renewal_email
  templates (wording editable in /templates, Admin/Manager), merge fields
  incl. the auto price-comparison sentence (priceParagraph), quote re-priced
  at current rates, PDF attached, lands as an EDITABLE draft in Sales→Drafts
  — never auto-sent. The copy-override plumbing (copyIsOverride) was removed
  with it; hand-edits to an existing draft are never clobbered. Net effect vs
  the AI path: the email actually gains the price-comparison sentence the
  model was forbidden from writing.
- **D76. Site visits phase 1 — schedule from the Inbox, .ics invite to the
  assignee** (PUNCHLIST #2; all Jeff's 2026-07-19 calls: A phase-1 .ics +
  settings toggle, B Jeff-only attendees, C personal calendar, D picklist +
  add the missing fields, E sender = the scheduler's mailbox, F suppress the
  self-import, G adopt-customer first, H calendar scope later + settings
  option, I record the send). What shipped: a new site_visits doc collection
  (migration 0004, first post-rebuild collection; store in
  stores/site-visits.ts with SV-#### ids); "Site visit" action in the thread
  reader opening a modal prefilled from the resolved customer (primary venue,
  thread-matched contact, reason picklist, tomorrow 9am, me as assignee);
  scheduling an unlinked thread adopts the customer onto it (G). The invite:
  a zero-dep RFC-5545 builder (lib/ics.ts, METHOD:PUBLISH, no ATTENDEE lines
  — customers are never auto-invited, B), emailed via buildRaw+sendRaw from
  the scheduler's personal mailbox (fallback: first connected shared box, E)
  to the assignee's roster email, honoring a new per-user Account toggle
  "Calendar invites" (A; stored beside the notif prefs but deliberately NOT a
  bell category; setAll now preserves foreign keys in the prefs map). Sent
  ids are stamped on the visit record (I) and the mail carries an
  X-Peak-Site-Visit header the import poll skips — parseInbound surfaces it
  and recordMessage drops those messages, so self-addressed invites never
  reappear as inbox threads (F). Event title = "venue — reason". The reason
  picklist is Settings-editable ("Site visits — reason picklist", defaults in
  DEFAULT_VISIT_REASONS, stored as AppSettingsData.visitReasons). Supporting
  schema work (D-decision): CustomerContact.phone and
  CustomerLocation.address (street) added end-to-end — store + normalize,
  edit modal inputs, detail-page render, CSV import/export columns
  (registry now maps the long-declared phone column). Visits render on the
  customer page ("Site visits" card). Verified end-to-end in dev: modal →
  SV-5001 created, honest "Gmail not connected" invite status, card renders;
  live invite send needs Gmail creds (Q-A). Phase 2 stays open: Google
  Calendar API write (calendar.events scope on Jeff's mailbox only + a
  Settings option per H) and the in-app calendar.
- **D77. Dashboard Google Calendar — read AND write** (Jeff, Jul 19: "add a
  calendar to the dashboard that pulls from google calendar and then allow
  for direct adding to and from"). New Home-page Calendar card (top of the
  right column): the signed-in user's next 14 days, merging their Google
  Calendar primary with Peak site visits assigned to them, grouped by day IN
  THE BROWSER'S timezone (SSR renders a placeholder until hydration; all-day
  events carry UTC-midnight epochs and render via UTC getters so the
  calendar date survives any server/browser tz combo). Quick-add ("+ Add
  event") writes straight to the user's primary Google Calendar. Plumbing:
  CALENDAR_SCOPE (calendar.events) deliberately NOT in GMAIL_SCOPES — it's
  opt-in per PERSONAL mailbox via a new "Enable calendar" link on Settings→
  Mailboxes rows (re-runs consent with the scope added; include_granted_
  scopes keeps Gmail, and Google returns the union scope on any later
  reconnect so the grant is sticky). New src/lib/google/calendar.ts — plain-
  fetch Calendar v3 client (list + insert, primary only, 5s abort so a hung
  Google can never hang Home; D36 no-deps posture). Site visits now write
  DIRECTLY to the assignee's calendar when their mailbox has the grant
  (event stamped as googleEventId, .ics email skipped, still gated by the
  Account "Calendar invites" toggle whose copy now discloses both paths);
  .ics remains the fallback. Dashboard dedup is fetch-aware (a pushed visit
  whose event didn't come back this load still shows locally) and an
  accepted .ics is matched by its sv-<id>@peak-app iCalUID. Google Cloud
  prerequisite documented in DEPLOY.md: the consent screen must list
  gmail.modify + calendar.events and the Calendar API must be enabled —
  else consent fails. Known product note: a direct-written event lands on
  the assignee's calendar silently (no email); an in-app notification could
  accompany it later. The full-page in-app calendar (month/week view) stays
  open as the remaining slice of PUNCHLIST #2 item 5.
- **D78. Lineset Weights merged into the Lineset Builder** (PUNCHLIST #6,
  Jeff: "combine into one screen … everything from both can live together";
  approach agreed at intake, P1–P5 from the code review resolved). One screen
  at /design-studio/lineset: the generated schedule supplies the rows; each
  row expands (click) into a weight editor (fabric/dims/fullness/qty/gear/
  chain/track/mode/hoist — chain and track are newly editable, the old table
  never exposed them); weight, hoist/batten checks and brick combos calculate
  live; the four KPI tiles survive. P1 line identity: loads key off
  `type#ordinal` ("Electric#2"), so regenerating the layout reattaches
  weights to what a line IS, not its slot; keys that stop matching surface an
  inline orphan notice (reattach-on-return or one-click clear) — verified in
  the browser through the full lifecycle. P2: a line is "specified" only once
  its entry exists; unspecified lines show — /amber and are EXCLUDED from
  totals, and the Total tile says "M of N specified — partial total" instead
  of presenting a confident wrong number. P3 migration-on-load, no DB
  rewrite: v2 combined saves {v:2, inputs, defaults, loads, extras} under
  kind "lineset"; legacy Builder saves load as inputs; legacy Weights saves
  open with their rows as CUSTOM lines + a banner, and saving creates a NEW
  combined design (the old record stays until deleted). Both kinds appear in
  "Open saved…" (legacy marked). P4: one settings drawer, two labeled groups
  (Layout rules / Weight defaults, incl. a default-mode picker the old tools
  split). P5: the master table stays 8 narrow columns; editing happens in the
  expanding row, so nothing scrolls horizontally. Custom lines (the old
  tool's arbitrary rows — orchestra shells, screens) live on as an "extras"
  section after the generated schedule. /design-studio/weights redirects
  (preserving ?design= deep links), the landing tile and nav entry are gone,
  and the Design Studio saved-designs list opens legacy weights records
  through the Builder's adapter.
- **D79. Monday-style UI — phase 1 shipped, scope questions pending**
  (PUNCHLIST #5; Jeff: make it feel like Monday.com so adoption is seamless;
  "go ahead and start"). What shipped as the visible, low-risk first slice:
  components/ui.tsx gains MONDAY_TONE (Monday's actual status palette —
  done-green #00c875, working-orange #fdab3d, stuck-red #e2445c, blue,
  purple, gray) and a solid StatusPill (saturated fill, white text, fixed
  min-width — the signature Monday status cell), plus canonical per-record
  tone maps (QUOTE_STATUS_TONE, LEAD_STAGE_TONE) so every screen colors a
  status identically. Adopted on the three highest-traffic status surfaces:
  the Quotes table status column + detail-pane status switcher, the Home
  "My pipeline" chips, and the Leads table Stage column. The soft-tint
  Pill stays for secondary metadata (sources, follow-ups, review chips).
  Phase 2+ awaits Jeff's scoping answers (which Monday paradigms, reskin vs
  interaction patterns, reference screens) — recorded on the punch item;
  the extraction path (shared card/label/field/th/td primitives already
  exist in ui.tsx; per-screen inline copies converge as screens are
  touched) is the standing rule going forward.
- **D81. Full-page calendar module** (S13, Jeff: "yes I want a full page
  calendar module under home"). New /calendar route + nav entry directly
  after Home: a month grid (Sunday-start, today ringed, prev/next/Today
  controls via ?month=YYYY-MM) over the same merged sources as the D77
  dashboard card — the signed-in user's Google Calendar primary + their
  Peak site visits, with the same fetch-aware dedup. The agenda assembly
  moved to a shared lib (src/lib/agenda.ts, loadAgendaRange/loadHomeAgenda)
  used by both surfaces. Day placement and labels compute in the BROWSER'S
  timezone after hydration (all-day items place by UTC calendar date); the
  server fetch pads the month a week each side so edge days populate under
  any tz combination. Clicking a day arms an inline quick-add for that date
  (writes to Google Calendar; needs the calendar grant, with honest
  fallback copy otherwise). Google chips link out to Google Calendar;
  visit chips link to the customer record; +N-more overflow per day. The
  dashboard card gained an "Open calendar →" link.
- **D82. Punch 7–23 triage — the five pre-scoped standalone fixes shipped**
  (2026-07-19 evening; the collecting session flagged each as safe ahead of
  its parent item's decisions). (1) Punch #13 bug: the projects sync only
  excluded flame tests, so won REPAIR and INSPECTION quotes minted phantom
  Projects alongside their real records, polluting Projects/Schedule/Field
  Work — filter now excludes repair + inspection too (existing phantoms in a
  DB are untouched; delete manually if any). (2) Punch #12 bug: lead
  convert() dropped the contact phone on customer creation (stale comment
  claimed normalizeRecord discarded it — false since D76) — phone passes
  through now. (3) Punch #9 defect: member emails were uneditable ANYWHERE
  while auth refuses unmatched emails — a wrong seeded address was a
  lockout with no remedy. The Settings edit modal now edits name, email,
  and google sign-in email (new updateMemberAction over the existing
  updateUser); the rest of #9 (contact card, archived/removed) still needs
  its A–D. (4) Punch #8: the read-only AI status card is gone from Settings
  (Jeff: "take it out and see what happens" = option (i); feature gating
  untouched, (ii) remains item-4 territory). (5) Punch #14: the dashboard
  Catalog card was a hardcoded prototype literal ("529 parts · JR Clancy…"
  forever) — now derived from the real store grouped by mfr, which
  immediately revealed the actual imported catalog (10,729 parts across 6
  books). Age pills dropped pending decision A (no updatedAt on parts);
  SUGGEST divergence remains open under #14 B.

## Daylite parity Phase 1 — identity core (2026-07-19)

- **D85. The identity core landed** (Daylite parity Phase 1; design
  `docs/superpowers/specs/2026-07-19-daylite-parity-design.md` §4, plan
  `docs/superpowers/plans/2026-07-19-daylite-parity-phase0-1.md`). Five
  relational tables — companies, contacts, contact_emails, contact_phones,
  sites (migration 0005) — now back the directory. `src/lib/stores/customers.ts`
  keeps its public API byte-compatible but composes from the new tables, so
  its ~120 consumers were untouched; `customers` left BOTH sync-push
  allowlists (identity is server-authoritative, spec §3.2 — field staff don't
  create contacts offline). Companies + People replaced Customers in the nav;
  `/customers[/:id]` redirect. Lead convert, the five raw doc-store customer
  readers (flame/repair/inspection/design/comm stores) and ⌘K search were
  rewired. Recorded deviations: (1) **no DB-level FKs yet** — referenced ids
  also live inside jsonb docs where constraints can't reach; the converter's
  reconciliation report is the integrity gate (6 customers → 6 companies,
  8 sites, 8 contacts, 8 emails, 0 skipped, 0 warnings). (2) **`customerId`
  keeps its name on doc records** — it now means "company id" (same slug
  values); renames land with the screens that rebuild in Phases 2/3/6.
  (3) **Composed `CustomerLocation.id` = `sites.legacyLocId ?? sites.id`**
  so stored `locationId` values ('loc1', 'lf1', …) keep matching. (4)
  **`contacts.isPrimary` is transitional** until quotes designate their own
  primary contact (§4.7 / item 11). (5) Owner names that match no team
  member are dropped on write (owner is now a users FK). Conversion runs
  automatically at seed time when identity is empty; `npm run
  db:convert-identity [--force]` reruns it. Phase 0's export audit tool
  shipped (`npm run audit:daylite`) with its §5.1 checklist — **the audit
  itself waits on Jeff's Daylite CSV, and no import code exists until it
  runs.** Verified: build clean; browser pass over Companies (list/map/
  detail/portal), People (list/detail), redirects, search deep links,
  estimator, reports; scripted write-path test (upsert round-trip with
  stable site ids, D83 updatedAt semantics, two live lead conversions).
  Ops notes: the dev PGlite db was found corrupted by two concurrent
  processes (dev server + a stale tsx script) — PGlite is single-process;
  stop the dev server before running db scripts. Old data preserved at
  `.data-corrupt-20260719/`; demo data reseeded. D80/D83/D84 still have no
  entries here — their detail lives in PUNCHLIST statuses and commits
  901965f / 156fe8d / 210a43b.
- **D86. Estimate-scope drafting went rules-based; the AI "scope" feature is
  retired** (S12, Jeff 2026-07-19: intake generation = "estimate scopes only,
  items stay manual"; code written by the 7/19 punch-list session, committed
  here after verification). `draftQuoteScopeAction` no longer calls a model:
  it assembles the scope-of-work paragraph deterministically from the linked
  survey/inspection's own captured fields (same record → same text) and
  returns no suggested lines. The `aiEnabled` gate is gone from the whole
  scope path (page → props → client → action), so the draft-scope affordance
  works with or without an ANTHROPIC_API_KEY; "scope" was removed from
  AI_FEATURES and the unused `draftQuoteScope` model call was deleted
  (`DraftedLine` survives as the modal's legacy line shape). Verified:
  typecheck clean; /estimator?surveyId=FS-1042 renders the assemble-scope
  affordance against the running dev server.

## Punch-list answer batch — items 9, 13–16 + stragglers (2026-07-19)

- **D87. Jeff answered the whole OPEN-DECISIONS.md sheet** (recorded verbatim
  under each PUNCHLIST item; his framing: **store to run later** — recorded
  decisions queued for build, not a start order). The batch:
  - **9 (team members):** contact-card field list confirmed as proposed
    (title, direct phone, mobile, office assignment, cert/license numbers);
    archived-vs-removed exactly as suggested (neither hard-deletes);
    **signature phone = standard office numbers**, not the member's direct
    line (so office phones must become editable and resolve from the
    signer's office).
  - **13 (service records → projects):** dual-write/linked (inspection stays,
    gains a linked project); **customer sign-off = approval of the inspection
    QUOTE** (authorizes the inspection; the report carries a tied repair
    estimate for the found problem — spawn happens at quote approval, not
    completion); **one Gantt reads all four sources**; **Consulting tabled** —
    Jeff's sketch: design work we get paid to commit to (more paperwork, much
    more review, real path forward); brainstorming-session note filed.
  - **14 (catalog):** add `updatedAt` to catalog parts (age pills become
    real — "so we know when we last updated a price list"); retire the
    estimator's hardcoded SUGGEST strip in favour of catalog-backed
    suggestions.
  - **15 (install timeframe):** store weeks, resolve from win date; "when
    they need it" = **completion** target (triplet shifts off targetDate);
    internal-only on the PDF **but lead time gets stated in the quote's
    terms & assumptions**; silent default stays but becomes **84 days /
    12 weeks minimum** (code currently hardcodes 42); PMs can edit the date
    afterward.
  - **16 (sold/completed notifications):** task-first; email B/C moot until
    item 9 + a send log exist; **sign-off is required to complete** — the
    PM's direct stage change is gated on a signoff, giving one trigger path;
    and the big one: **projects need multiple people in roles** (Project
    Manager, Project Coordinator, Estimator, Lead Sales, Installer Lead,
    Installers, …) — a project-roles model, feeding item 20 Phase 2
    junctions and item 17's user-id assignee call; item-16 tasks assign by
    role (sold → PM, completed → Lead Sales).
  - **Stragglers:** the leads "Nothing scheduled" chip **stays display-only**
    (D83 shape is final); the four AI features **stay reachable for now** —
    Jeff wants a session to design rules-based ways around them (D75/D86
    mold), queued with the Consulting talk for the next brainstorm.
- **D88. Customer pricing tiers shipped** (punch item 11 — decisions in D87 +
  Jeff's follow-ups; built 2026-07-19). The tier lives on the PERSON
  (`contacts.pricingTier`, D85 schema), company is fallback, Base is default;
  margins are admin-editable rates in /estimating-rules → "Customer tiers"
  (Base 30 · Copper 27 · Silver 22 · Gold 20 · Platinum 15 · Reseller 10 ·
  Employee 5). `lib/pricing-tiers.ts` resolves contact → company → Base
  (design §4.7) and the resolved {tier, margin} is STAMPED onto quotes at
  creation, re-resolved when the estimator's customer/contact changes, and
  frozen into every revision snapshot (item 24/B). It SEEDS, never enforces:
  estimator labor drafts + curtain configurator default to it; the three
  service builders (flame/repair/inspection) seed their margin knob from the
  picked customer (contact's own tier wins) — and their knob is now
  PER-QUOTE: it no longer mutates the global rate blob, so one quote's
  margin stops repricing every future service quote (deliberate behavior
  change; global rates stay editable in /estimating-rules). Quick Design
  keeps its sandbox engine margins; the tier takes over at Add-to-Quotes
  promotion (requote path). Lead conversion stamps the new company at Base.
  Portal (11-D, cost + margin): the drapery preview coefficients AND the
  authoritative recompute both price at the grant customer's tier margin
  (contact-level via the grant name), and equipment prices re-derive from
  cost ÷ (1 − m), falling back to list when a part has no cost. Invisible to
  customers everywhere (E) — no tier name or discount line renders. Verified:
  scripted resolution-chain/stamp/revision/curtain tests all green; registry
  group + both tier selects + builders render against the dev server.
  **Honest gaps:** the portal catalog re-derive ran against an empty
  customer-buyable set (the reseeded 27-part seed catalog has none — the
  real price-book import repopulates it); service-builder knob seeding uses
  the picked customer's primary contact, and switching the attn contact
  after picking does not re-seed the knob (cheap follow-up if wanted).
- **D89. Full AI layer removal** (spec
  `docs/superpowers/specs/2026-07-19-ai-removal-design.md`; closes punch item 4,
  built 2026-07-19). The four inert model-backed features — thread summary,
  customer summary, import extraction, assistant Q&A — plus `src/lib/ai/` and
  the Assistant nav entry are deleted; `DraftedLine` now lives in
  `estimator/ai-scope-modal.tsx`. Zero model calls remain; no
  `ANTHROPIC_API_KEY` is needed anywhere. Supersedes D87's "the four AI
  features stay reachable for now" and item 4's revisit posture — Jeff's call
  in the 2026-07-19 brainstorm: none of the four jobs are needed day-to-day,
  strip them all out; a future return would be a fresh build, not a re-enable.
  Untouched: renewal outreach (D75), rules-based scope drafting (D86),
  `/templates`, the DB (the layer never persisted anything). Rollback =
  revert the D89 commit series. Verified: zero-hit greps (`lib/ai`,
  `aiEnabled`, `ANTHROPIC`, the four feature fns), tsc + build clean, browser
  pass — nav has no Assistant and `/assistant` 404s, inbox reader intact with
  no Summary buttons, import paste→preview→confirm intact with no
  Extract-with-AI, estimator renders clean.
- **D90. Consulting module built** (spec
  `docs/superpowers/specs/2026-07-19-consulting-module-design.md`; closes the
  PUNCHLIST Consulting IDEA and item 13-D; built 2026-07-19). Quote-first:
  new `consulting` quote type + lightweight builder (`/consulting/quote` —
  scope, fixed fee OR milestone schedule, terms, phase selection; NO pricing
  tiers, fee-based on purpose), riding the ordinary quote machinery (review
  gate, status pipeline, D84 revisions — `consulting` payload frozen into
  snapshots). Won consulting quotes spawn `ConsultingEngagement` records
  (new `consulting_engagements` doc collection, migration 0006, NOT
  sync-pushable) via a fifth idempotent on-win sync; the projects sync now
  excludes `consulting` in all three spots exactly like `flame_test`.
  **Id prefix deviation:** engagements are `CE-####` (base 1000), not the
  spec's `C-1001` — `C-` is the live comm-thread prefix and a second `C-`
  line would be ambiguous in search and letters. Module: top-level nav entry;
  list (KPIs + roll-up timeline + cards) and detail tabs Overview (links,
  people-with-roles editor — the item-16-E shape, built here first —
  per-engagement milestone/visit timeline) / Phases & Reviews (per-phase
  QuoteReview, store-enforced "no complete without approved review", surfaced
  in the Reviews queue as kind "Engagement" with composite ids) / Milestones
  & Billing (feeds the Reports billing forecast, billed at targetDate +
  net-30, forecast-only) / Meetings & Decisions / Oversight (submittals +
  RFIs, site-visit links via `siteVisits.engagementId`) / Documents (2 MB
  data-URL attachments, CommAttachment pattern). Admin phase menu in
  Settings (`consultingPhases`, defaults Assessment → Construction
  Oversight). Templates: `consulting_proposal` + `consulting_spec` letters
  at `/consulting/letter`. Nothing consulting renders on the main Gantt.
  Verified: tsc + `next build` clean (all four /consulting routes register);
  full interactive pass 2026-07-19 evening against the reseeded dev db —
  Q-2043 built in the new builder ($16,500 milestone schedule), Consulting
  hub filter/badge, submit-for-review (submitter correctly gets no
  self-approve), approve as Jack, Sent (auto-revision 1 cut), Won →
  **CE-1001 spawned** with the six phases; phase complete BLOCKED until the
  phase review was approved through the Reviews queue (kind "Engagement",
  composite id), then completed; milestones (Aug 15 / Oct 1 2026) landed in
  the Reports forecast ("installs + consulting milestones": to-be-billed =
  backlog + $16,500, $9k Sep bucket); /projects shows NO phantom project and
  awaiting-start 0; both letters render (proposal with milestone fee table;
  spec package with no-designs fallback).
  **Three bugs found & fixed by that pass:** (1) `TABS` exported from the
  "use client" view became a client-reference proxy in the server route —
  moved to `consulting/tabs.ts` (e846a40); (2) a `export type` re-export in
  the "use server" actions module broke ALL consulting server actions —
  removed, only async fns may be exported there (680aa63); (3) quotes
  `create()` enumerates payload fields and silently dropped `consulting` —
  added to the copy list (3eb3dbf; Q-2043's payload restored by re-save).
  **Ops note (repeat incident):** the dev PGlite db corrupted AGAIN on
  2026-07-19 — `npm run build` (which runs `scripts/migrate.mjs` + prerender
  workers that open PGlite) was run while a dev server from another session
  held the same `.data/pglite`. PGlite is SINGLE-process: stop every dev
  server before `npm run build` or any db script. Jeff recovered it same
  evening: corrupt copy preserved at `.data-corrupt-20260719b/`, demo data
  reseeded — same playbook as the D85 ops note.

## D91 — Per-phase review checklists + meeting notes (2026-07-19)

Spec: `docs/superpowers/specs/2026-07-19-design-review-checklists-design.md`.

- **Checklist templates live in `appSettings`, not their own collection.**
  The spec called for a `review_checklist_templates` collection; they are the
  same kind of small admin-edited picklist as `consultingPhases`,
  `visitReasons`, and `intakeCatalog`, all of which already sit in settings.
  Keeping them together avoids a collection + migration for a config list and
  puts every consulting picklist in one place. `DEFAULT_REVIEW_CHECKLISTS` in
  `stores/engagements.ts` ships defaults for the six standard phases; a phase
  mapped to `[]` deliberately has no checklist.
- **Stamped at submit, then frozen.** `submitPhaseReview` copies the template
  onto the phase only when it has no checklist yet, so a resubmission after
  changes keeps the reviewers' progress. Editing a template never rewrites a
  stamped checklist — a review is a point-in-time record.
- **The caller resolves the template.** `submitPhaseReviewAction` reads
  settings and passes the strings in; the store stays free of settings so its
  gate logic can be reasoned about (and tested) on its own.
- **Meetings gained `title`, `recordingUrl`, `phaseId`** — all optional, so
  pre-D91 meeting records still parse. Video is a LINK, never an upload:
  Zoom/Meet/Teams already host it, and an in-app recording module was
  explicitly rejected (Jeff, 2026-07-19).

## D92 — Review accountability: comments, gating, version pinning (2026-07-19)

Spec: `docs/superpowers/specs/2026-07-19-review-markup-accountability-design.md`.
Jeff's framing: *"the review screen is how we hold accountability and right now
it is the most underutilized."* It was — `QuoteReview` carried one free-text
`note` as the entire substance of a review.

- **Comments are append-only.** Resolving or waiving adds fields; the body is
  never rewritten, so history stays readable after the fact. Anchors cover
  review / document / checklist item / line item, plus an `annotation` variant
  that parses today so comments survive the markup canvas landing later.
- **Approval is gated in the STORE, not the UI** (same principle as D90's
  phase gate): every checklist item and comment must be checked/resolved or
  waived-with-reason first. Request-changes flips open comments to
  `required: true`, which is what turns a send-back into a specific list of
  edits rather than a paragraph to interpret.
- **Frozen copies live in their own `review_snapshots` collection**, not
  inline on the engagement. Attachments are data-URLs; copying them into the
  engagement document on every approval would bloat a hot record. The
  engagement keeps lightweight pointers (`ApprovalPin.docs`) and the snapshot
  id. Snapshots are written BEFORE state flips — an approval that cannot
  record what it approved should not happen.
- **Staleness is derived, not stored.** `approvalIsStale()` compares the
  phase's current attachment set (id + addedAt) against the pin; a re-upload
  produces a new id/stamp, so a swapped drawing surfaces immediately and
  blocks phase completion until re-review.
- **NOT built: the annotation canvas** (shapes, clouds, arrows, text boxes,
  highlight over PDFs). Jeff chose the full toolset and one combined spec; the
  spec stages accountability first deliberately, and only stage 1 shipped
  tonight. The canvas needs a PDF renderer plus an annotation layer and is
  sized comparably to the whole D90 module — it is the next real chunk of work.

## D93 — My Queue + assignments + Reminders sync API (2026-07-19)

Spec: `docs/superpowers/specs/2026-07-19-work-queue-reminders-sync-design.md`.

- **The app is a task SOURCE, not a to-do app.** Every queue row except
  assignments is DERIVED from existing records (quote + phase reviews, open
  standards items, milestones, `ProjectTask`, flame/inspection renewals), so
  there is no second copy of the truth to drift, and closing the real record
  closes the queue item. Jeff's stated worry was that a to-do module would be
  overwhelming next to the million that exist; deriving is what avoids that.
- **`assignments` is the one new record**, deliberately minimal — no subtasks,
  priorities, recurrence, or tags. Competing with Apple Reminders is the
  failure mode.
- **Apple publishes no cloud API for Reminders.** Access is local-device only
  (AppleScript/osascript, EventKit, Shortcuts), so a hosted app can never
  write reminders itself. `/api/queue` is therefore a contract for a Mac-side
  agent: GET a person's queue, POST back completions. Subscribed `.ics` feeds
  (read-only, poor VTODO support) and iCloud CalDAV (undocumented) were
  evaluated and rejected.
- **Write-back is refused for non-assignment items at the API layer**, not
  just in the agent: a phone checkbox must never approve a review or close a
  milestone, and a buggy client must not be able to try.
- Auth is a session OR an `x-queue-token` header matched against
  `QUEUE_API_TOKEN`. The token belongs in the Mac keychain / env — never in
  the repo or the memory files.
- The Mac-side agent itself is NOT in this repo (it is memory-system work).

## D94 — Bid specification generator (2026-07-19)

Spec: `docs/superpowers/specs/2026-07-19-bid-spec-generator-design.md`.

- **BOM-driven, not a dropdown picker.** Jeff weighed a category/dropdown
  selector and named its flaw: you still have to verify you selected
  everything. Starting from the equipment list moves that burden onto the
  machine — every row lands in exactly one bucket and the document cannot be
  saved while any row is unresolved.
- **Similarity only SUGGESTS.** Description matching (Jaccard over tokens,
  floor 0.34) offers up to four candidates for a human to confirm; it never
  auto-assigns. A wrong silent match would put the wrong product in a public
  bid document.
- **Part 2 paragraphs live on the catalog part**, not a parallel collection,
  so a product and its spec language cannot drift apart or orphan each other.
  They can be authored inline mid-match, which is how the library grows from
  the parts on real bids rather than a pre-authoring project.
- **No AI at generation time** (consistent with D89). All spec language is
  data a human wrote. Jeff may draft wording with Claude outside the app; the
  app only assembles approved text. That is what lets anyone at Peak produce a
  spec without Jeff and without an AI subscription.
- **Output is Word-openable HTML (`.doc`), not a binary `.docx`.** The spec
  asked for `.docx`; the app has no docx library and adding a dependency on
  the eve of a deploy is avoidable risk. Word opens this HTML as a fully
  editable document, which satisfies the actual need (architects paste
  sections into a project manual), and the same markup is the print/PDF view.
  **Upgrade path:** `npm i docx` and swap `renderSpecHtml` for a real
  document builder — the assembled `AssembledSpec` structure is already
  format-agnostic. Flagged for Jeff.
- Saved specs are frozen; regenerating writes a new record so what went to an
  architect stays retrievable after catalog language moves on.

## D94a — Real .docx output (2026-07-20)

Supersedes the D94 shipping-day decision to emit Word-openable HTML. Jeff
asked for the real thing once he clarified the deploy is a personal beta.

- Added the `docx` package; `lib/bid-spec-docx.ts` builds genuine OOXML from
  the same `AssembledSpec`, which was deliberately kept format-agnostic — the
  HTML renderer is untouched and still backs the print/PDF view.
- Download is a **route handler** (`/api/spec/[id]/docx`), not a client blob:
  the Packer is a Node builder and keeping it server-side keeps the OOXML
  machinery out of the browser bundle.
- **Numbering is literal text ("2.01\ttitle") with a hanging indent, not
  Word list numbering.** Architects paste these sections into a project
  manual; Word's automatic lists renumber themselves against the destination
  document's lists, which would silently corrupt the spec numbering. Literal
  numbers survive the paste.
- The `.doc` HTML export is kept as a secondary button.
- Verified: output is a valid ZIP (PK signature) containing word/document.xml
  + styles.xml, with the CSI headings, 2.01 numbering, product text, and the
  ITEMS NOT SPECIFIED section all present.

## D95 — PDF viewer + annotation canvas (2026-07-20)

Stage 2 of the D92 spec, previously deferred. Route: `/consulting/markup`.

- **Coordinates are normalized 0..1 against the page box.** This single
  choice makes zoom, window size, DPI, and PDF page dimensions irrelevant to
  storage — markup drawn at 50% on a laptop lands identically at 200% on a
  4K display. Pixel conversion happens only at paint time.
- **SVG overlay, not a second canvas**: crisp at any zoom, cheap hit-testing,
  and every mark is a real keyed element.
- Tools: box, ellipse, arrow, revision cloud, freehand, highlight, text.
  Clouds are their own tool because architects read a cloud as "this
  changed" — a dashed rectangle does not carry that meaning.
- **Markup joins the accountability trail**: an annotation can raise a review
  comment (`anchor: {kind:'annotation'}`), so the D92 approval gate counts
  it. Markup that cannot block an approval is decoration.
- Annotations live on the phase (`EngagementPhase.annotations`), optional for
  back-compat like the other D91/D92 fields.
- **pdf.js worker is served from `/pdf.worker.min.mjs`** (copied out of
  pdfjs-dist into `public/` at install), avoiding bundler worker-resolution
  problems.
- **`disableFontFace: true`** — pdf.js otherwise awaits `document.fonts`,
  which can stall in embedded browsers; glyphs render as paths instead.

### Verification note (worth keeping)

The canvas rendered blank during automated checks with **no error**, which
looked like a bug for a long stretch. Root cause was the automation harness,
not the code: **the browser pane's tab is `document.hidden`, so
`requestAnimationFrame` never fires, and pdf.js steps its paint loop with
rAF.** Patching `requestAnimationFrame` to `setTimeout` in the page made the
same code paint immediately (25,722 ink pixels, "painted 918x1188").

Lesson for future automated verification in this repo: **a hidden preview tab
cannot verify anything that depends on rAF** — canvas rendering, animation,
transitions. Patch rAF before concluding a paint bug is real.

## D96 — Markup sidebar, scale calibration, measure + count tools (2026-07-20)

Jeff's testing feedback: text boxes couldn't be added, the toolbar belonged in
a sidebar, and the viewer needed calibration, measurement, and a counter.

### The text-tool bug: `window.prompt()` is unavailable

Root cause, confirmed in the running app: **`prompt() is not supported`** in
this app's browser context — it throws rather than returning. The text tool
called `window.prompt` for its content, so clicking did nothing at all, with
no error. The same call silently broke three other flows shipped the day
before: raising a review comment from markup, waiving a standards checklist
item, and waiving a BOM row in the spec generator.

All four are now inline UI. **Rule for this codebase: never use
`window.prompt`/`confirm` — build the input into the page.** (One
pre-existing `window.confirm` remains in `estimating-rules/controls.tsx`; it
predates this work and is likely broken for the same reason — flagged, not
fixed here.)

### Scale + measurement

- `Calibration` is stored per **document + page** on the phase; one per page,
  replaced in place, because a second calibration would silently change every
  existing measurement on that page.
- **`scale` is real-world units per ONE PAGE WIDTH of normalized distance.**
  That unit choice is what keeps measurement zoom-independent, since stored
  coordinates are already normalized.
- **`pageDistance()` scales y by the page aspect ratio (height/width).**
  Normalized x and y are fractions of *different* physical dimensions, so a
  naive hypot measures a 45° line wrongly on any non-square page. Aspect is a
  property of the page, not the canvas, so it holds at every zoom level.
  Verified: a horizontal and a vertical line of equal real length measure
  equal, and a line half the reference reads exactly half (20'-0" against a
  40' reference).
- Feet render as `12'-6"` — the form drawings and shop orders actually use.

### Count tool

Single-click tally markers grouped by a label typed in the sidebar, with
running per-label totals and a grand total. Counting fixtures off a plan is a
real part of this job; the totals live beside the drawing rather than on a
separate scratch pad.

### Layout

Tools, colour, scale, counts, and the selected-mark inspector moved into a
216px sticky sidebar; the document gets the rest of the width. Zoom and page
navigation stay in the header, where they act on the whole view.

## D97 — Design module consolidation (2026-07-20)

Consulting and Design Studio were two separate top-level nav entries for the
same underlying job (a paid engagement and its budgetary designs, at
different stages). Merged into one **Design** group — Overview, Engagements,
Designs, Steel Calculator, Lineset Builder, Motor Library — with every old
path kept alive as a redirect stub (`src/lib/design-routes.ts`,
`designRedirect(pathname, query)`).

### `/design` — Overview vs. deep link

`/design` itself collides two different pasts: it's the natural URL for the
new module's landing page, but it was also Design Studio's old
`?id=`-keyed deep link into a specific sandbox design. Both had to keep
working, so the rule is param-gated, not path-gated:

- **Bare `/design`** renders the new Overview (two columns — active
  engagements, recent designs). It does **not** redirect.
- **`/design?id=D-###`** is treated as the legacy deep link and redirects to
  `/design/designs?id=D-###`, where the sandbox grid opens that design's
  detail panel.

Same function, same file, both directions covered:
`designRedirect("/design", {id}) → "/design/designs?id=..."` when `id` is
present, `null` (render normally) when it's absent. Tested both ways
(`bare /design is the Overview and must NOT redirect` /
`old sandbox deep link lands on the designs list`) and confirmed live in
Task 9.

### `/quick-design` move

Moved to `/design/quick`; the old path is kept as a stub for bookmarks. The
original task table listed this stub as taking no params — wrong. The
destination reads `?design=` to reload a saved sandbox estimate, so the stub
forwards it: `/quick-design?design=X` → `/design/quick?design=X`. Caught
while building the stub, not by the spec.

### Two-store aliasing convention

"Design" already named two unrelated record types before this task:

- `lib/stores/designs.ts` — the budgetary **sandbox** (`DesignRecord`,
  `D-###` ids), what `/design/designs` lists and what an engagement links to.
- `lib/stores/studio-designs.ts` — saved **Design Studio tool state**
  (`StudioDesign`, `DS-###` ids), what the Lineset Builder and Weights tool
  save/reload via `?design=`.

Both stores export functions that would collide under the same import name
in any file that touches both. Convention going forward: `stores/designs.ts`'s
`getAllDesigns` is imported plainly wherever only the sandbox store is in
scope (`design/designs/page.tsx`, `design/engagements/data.ts`, etc.), and
aliased to **`getSandboxDesigns`** the one place the module's Overview page
sits conceptually between both stores (`design/page.tsx`) — so a reader never
has to guess which "design" a bare `getAllDesigns()` call means.
`stores/studio-designs.ts` keeps its own names (`listDesigns`, `getDesign`)
unchanged, since its callers never import the sandbox store in the same file.

### Nav

One `design` nav group replaces the standalone Consulting link and the
Design Studio group (`components/nav/nav-data.ts`). `activeKeyFor()` maps
every `/design/*` path to the group's `designoverview` child key by
matching on path segment 1 only — it doesn't distinguish `/design/steel`
from `/design/engagements` from bare `/design`. That's deliberate (spec
`activeKeyFor()` rewrite): it's enough to light the **Design** pill correctly
on every child route, which is what matters for the top-level tab. The
tradeoff, observed in Task 9: opening the dropdown from a leaf page (e.g.
`/design/engagements`) highlights "Overview" as the active child, not the
page you're actually on. Cosmetic, not a routing defect, and covered by the
existing segment-1-matching tests — flagged here in case it's worth a
follow-up.

## D98 — Home as a tabbed hub (2026-07-20)

My Queue, Calendar, and Inbox were three more top-level nav entries pointing
at "things I need to look at today" — the same shape of problem D97 solved
for Design. Folded into a shared **Home** tab bar (`app/(app)/home-tabs.tsx`,
keys in `app/(app)/home-tabs-keys.ts`) rendered on all four routes: Dashboard,
My Queue, Calendar, Inbox. `nav-data.ts` drops the three standalone links;
`activeKeyFor()` maps `/`, `/queue`, `/calendar`, and `/inbox` to `"home"` so
the top-level pill lights correctly regardless of which tab is open. No
redirect map was needed — all three paths already worked, they just weren't
wired to a shared tab affordance.

### Four tabs, not five
Reports was in scope for a "General dissolves, its children get promoted"
rewrite, but that dissolution hasn't happened yet — Reports still lives
under General (`nav-data.ts`) with its own top-level pill. Adding it as a
fifth Home tab now would mean two different nav elements both claiming to
represent `/reports`, so it waits for that dissolution instead of shipping
half-migrated.

### The pre-existing `/calendar` gap, closed here
`activeKeyFor()` never had a `/calendar` entry before this task — the
Calendar page existed but nothing in the top-level nav lit for it (a
pre-existing bug, not something this plan introduced). Fixed here rather
than deferred: the fix is the same one-line map entry as the other two
tabs, and shipping it separately would leave a known-bad nav state live for
however long a follow-up took. Verified in Task 7: `/calendar` now lights
**Home**, where before it lit nothing.

### The Inbox badge's lost render surface (corrected — see final review)
`lib/nav-counts.ts`'s `navData()` still computes `counts.inbox = inboxUnread`
— that aggregation wasn't touched by this plan. An earlier version of this
entry said the Inbox badge "lost a visible surface," without saying which
one — that overstated it. `Nav.tsx:198-205` renders every top-level entry as
a bare `<Link>` with no badge, before and after this plan; the desktop top
nav never showed `counts.inbox` at all. The **only** surface that count ever
fed was the mobile drawer (`Nav.tsx:706`, `badge={counts[entry.key] ?? 0}`
on `DrawerLink`). Since `NAV` no longer has an entry keyed `"inbox"` (folded
into Home), that drawer badge is what's gone — there was never a desktop
badge to lose. `inboxUnread` is now dead weight computed on every page load
with no UI consumer. Left as-is here — Task 7 is verify-only — but flagged
for whoever next touches `nav-counts.ts`: restore the drawer surface only;
don't add a desktop badge that never existed.

### `page.tsx` decomposition
The Dashboard was one unreadable file before Tasks 3–4; it's now
composition plus data-fetching (~600 lines) wired to home-scoped sibling
components — `home-greeting.tsx`, `home-stats.tsx`, `home-queue.tsx`,
`home-calendar.tsx`, `home-inbox.tsx`, `home-pipeline.tsx`,
`home-catalog.tsx`, `home-my-designs.tsx`, `home-my-leads.tsx`,
`home-field-surveys.tsx`, `home-team-activity.tsx`,
`home-needs-attention.tsx`, `home-stage-sheet.tsx`. Required, not optional —
the file was already too large before this branch touched it, and burying a
new My Queue card and a tab bar in it would have made a bad file worse.

### The queue-card / queue-tab count agreement
`queueNow()` (`lib/queue.ts`, a thin `Date.now()` wrapper) is called once on
the server in `page.tsx` and the result threaded through to both
`queueCardCounts()` (the Dashboard card) and every row's `queueDueLabel()`,
so the Dashboard's own card is internally consistent. `queue/page.tsx` makes
its own separate `queueNow()` call for the Queue tab — a different request,
necessarily a different call — so the two screens agree only because both
land within the same instant, not because they share one value across
requests. Verified live in Task 7: the Dashboard's My Queue card and the
`/queue` page both read **7 open · 4 overdue** for Jeff Chesebro. No drift
observed; flagging the two-call shape here in case a future change (caching,
streaming, a slower render path on either screen) reopens the gap this task
was built to catch.

## D99 — Dissolving the General group (2026-07-20)

The catch-all **General** nav group is gone; the header drops from six
top-level items to five (Home, Design, Sales, Installs, Service). Its eight
children were redistributed by ownership, not hidden:

- **Companies, People, Field Survey → Sales.** Sales owns the customer
  relationship, and Field Survey feeds quoting today. The nav keys
  (`companies`, `people`, `field`) are preserved — this was a MOVE inside
  `nav-data.ts`, not a rename, so badge counts and the `/customers → companies`
  legacy alias keep working. Sales' dropdown grows from three to six; accepted
  over widening the header (revisit if the dropdown gets hard to scan).
- **Reports → a fifth Home tab.** Reports is two business dashboards driven by
  `?view=sales|installs`, not configuration, so it belongs beside the other
  Home views rather than behind the gear. `HOME_TABS` gains a `reports` entry
  and `activeKeyFor("/reports")` now returns `home`. Reports keeps its own
  Sales|Installs pill — an orthogonal within-Reports selector — below the shared
  tab bar. This **amends** D98's four-tab Home hub to five.
- **Catalog, Templates, Estimating Rules, Import/Export → Settings → Admin.**
  These are data administration. Settings gained a three-way section nav
  (General · Team & Roles · Admin) via a new `?section=` param (not `?tab=`,
  which `/import` already uses). The four screens keep their own routes; the
  Admin area only links to them, so no working screen was rewritten.
  `activeKeyFor` maps their paths to `settings`.

Risk stayed in pure modules: the move and the key repointing live in the
already-pure `nav-data.ts`, and Settings' section logic in a new
dependency-free `settings-sections.ts`, both covered by `test:specs`. The
Settings and Reports client wiring was verified by driving the app. No routes
moved, no data changed, no migrations.

## D100 — Operations: merging Installs and Service (2026-07-20)

The **Installs** and **Service** nav groups merged into one **Operations** group
(Projects, Schedule, Field Work, Flame Tests, Rigging Inspections, Repairs); the
header dropped from five top-level items to four (Home, Design, Sales,
Operations). Child keys were preserved, so badge counts and active-pill
highlighting followed automatically.

The nav merge was only honest with an aggregation behind it: `/schedule` and
`/field-work` had read **only** from the projects store, so a scheduled flame
test would never have appeared on the schedule. Both now aggregate all four work
types, **read-only** — scheduling still happens on each type's own screen.

- **Unified Schedule.** The crew board overlays single-day bars for live flame,
  inspection, and repair jobs on their assignee's lane (or an Unassigned lane),
  colour-coded by work type, each linking to its own record. Projects keep their
  crew bookings and the booking editor unchanged.
- **Unified Field Work.** Now the signed-in person's work due today (or overdue)
  across all four types, each row deep-linking to its capture screen.
  `/flame-tests/today` redirects here.

The risk was date normalization, isolated in a dependency-free
`src/lib/operations-work.ts`: a strict `msOf` parses `'YYYY-MM-DD'` as **local**
midnight, and `''`/malformed dates return `null` and are **excluded** (never
epoch 0, never a UTC day-shift). We deliberately did NOT use inspections'
`parseISO`, whose non-ISO fallback is UTC-prone. Inspections' fourth stage
(`onsite`) is included via a `stage !== "completed"` predicate, so in-progress
inspections still appear.

**Decision to revisit:** a repair carries both `assignedTo` and `crew: string[]`.
It renders as **one** row keyed by `assignedTo` (matching flame/inspections and
the existing repairs UI). If Jeff wants a repair on every crew member's lane,
fan out over `crew` — a one-line change in the assembler.

No data model changes, no migrations. Service and install revenue stay separate
in Reports — this merges how work is *found*, not how it is *accounted*.

## D101 — Venues directory (2026-07-20)

The D85 identity core had screens for `companies` and `contacts` but not
`sites` — yet venues are how this business thinks (work attaches to the venue,
not the district). `/venues` (directory) and `/venues/[id]` (detail) close that
gap: a venue detail aggregates one reverse-chronological history of everything
attached to it — quotes, projects, engagements, flame tests, inspections,
repairs, surveys, and site visits — with open work pulled to the top and the
owning company's contacts alongside. Venues joins the Sales nav beside
Companies and People; Field Survey now sits next to it (seven Sales children —
a watch item; if the dropdown gets hard to scan, the fix is a Directory group).

**The matching gotcha, and how it's contained.** Documents store `locationId`
as the venue's *doc-loc id* = `sites.legacyLocId ?? sites.id` — a legacy `loc1`
for every migrated venue, never the synthetic `st-…` primary key. A lookup that
matched on `sites.id` alone would silently show empty history for every migrated
venue. All matching is isolated in the dependency-free `src/lib/venue-match.ts`,
which resolves through `venueDocLocId` exactly as the stores' own `docLocId`/
`locationById` do; a regression assertion pins that a migrated venue
(`legacyLocId: "loc1"`) matches a doc with `locationId: "loc1"` and that matching
on `sites.id` alone would miss it. Engagements match on `companyId` + `siteIds`
(which also hold legacy loc ids). Leads carry no venue and are excluded.

Read-only: no new tables, no migrations, no writes; venue create/edit stays on
the company record (out of scope). The `[id]` URL is the stable `sites.id`,
resolved to the doc-loc id internally so `loc1` never appears in a URL.

## D106 — `next build` no longer corrupts the dev database (2026-07-24)

**The bug.** `npm run build` destroyed the local PGlite dev DB. Every page then
returned `500 — A server error occurred`, because `createDb()` aborts on open:

```
Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
[cause]: RuntimeError: Aborted()
```

**Root cause.** `next build` fans out over **~7 worker processes**
("Collecting page data using 7 workers", "Generating static pages using 7
workers"). Every worker that reached `src/db/index.ts` opened the *same*
`.data/pglite` directory, and opening is not read-only — `createDb()` runs
`migrate()`, which writes. PGlite is single-process, so concurrent writers
corrupted it. Reproduced twice from a verified-healthy DB with **no dev server
running**, which is why the previous standing rule ("never build with a dev
server running") was not enough: the build alone was sufficient.

This is the same failure behind `.data-corrupt-20260719` and `-20260719b`.

**Fix.** During `NEXT_PHASE === "phase-production-build"` with no
`DATABASE_URL`, each worker gets its own throwaway datadir under `os.tmpdir()`
keyed by pid, and the dev auto-seed is skipped (those DBs are disposable).
The real `.data/pglite` is never opened by a build.

**Blast radius: local builds only.** Hosted builds (Vercel) set `DATABASE_URL`
and take the postgres-js path, which never reaches this branch. Production
behaviour is unchanged.

**Verified.** Healthy DB → `npm run build` → 80/80 static pages green, worker
logs show four distinct pids each on their own datadir → DB still opens clean
(PostgreSQL 18.3, `drizzle` + 28 public tables). Before the fix the identical
sequence corrupted it every time.

**Also in this change**
- The failing `test:specs` assertion `Design has six children` was **stale**,
  not a bug: the Fixture Cross-Ref screen (`/design/fixtures`, a real shipped
  route) is a legitimate 7th child added after D97. It now asserts the exact
  child keys, so a future change names what moved instead of failing on a count.
  Suite is back to ALL PASSED.
- `.data-backup*/` added to `.gitignore` — recovery snapshots carry the same
  encrypted tokens as `/backups/` and must not be committed.

**Operational note.** The incident that started this was two hung
`scripts/tmp-seed-markup.ts` processes holding the dev DB open for four days;
the running dev server could not open it, so the app 500'd on every page. Stray
`tsx` scripts are now called out in AGENTS.md.

## D107 — The software is named Quartzite (2026-07-24)

Jeff's direct instruction (2026-07-24): "change the name of the software to
Quartzite." Quartzite was the Wisconsin wildcard in the 2026-07-24 naming
exploration — the Baraboo Range bedrock under Peak's Reedsburg HQ: the rock
too hard to be worn down, in the place the ice couldn't flatten.

What changed: every user-facing software-name surface — the ~65 page metadata
titles (`— Peak Backend` → `— Quartzite`), the root layout title + PWA
`appleWebApp` title, `manifest.webmanifest` name/short_name, the nav's beta-
feedback subject, the service-worker cache name (`peak-shell-v1` →
`quartzite-shell-v1`, which also invalidates stale shells on next activate),
and the README/AGENTS headings.

What deliberately did NOT change: the company name "Peak Systems Group"
(documents, descriptions, copyright), the repo/package name `peak-app`, the
`pk-*` CSS token prefix, id formats, and the Apple Reminders list literally
named "Peak" that the queue agent reconciles against (external data).

## D108 — The Grid: the DaVinci-style system designer, slice 1 (2026-07-24)

Jeff's instruction (2026-07-24): "start the DaVinci implementation and just
name it The Grid." The Grid is the Design-tab module recreating what ETC
DaVinci does for dealers — plan-view system layout feeding a priced BOM and a
quote — scoped by the four decisions recorded in the planning session
(memory: projects/peak-system-designer.md, DEC-PSD-1…4): multi-brand
Peak-native, first slice = plan layout + live BOM → draft quote, extend the
D95/D96 markup canvas, PDF/image backgrounds only.

**Naming note.** The 2026-07-24 naming exploration had proposed "The Grid"
for the *lineset builder* (the theatrical rigging grid). Jeff assigned the
name to the DaVinci module instead — his call supersedes the proposal; the
lineset builder keeps its plain name.

**What shipped (route `/design/grid`, nav child of Design between Designs
and Steel Calculator):**
- `grid_projects` + `grid_sheets` doc collections (migration 0008). Two
  collections deliberately: the project doc is patched on every device
  placement, so the heavy sheet dataUrls live one-doc-per-sheet in
  `grid_sheets`, written once — the D95 amplification lesson (a 1.2 MB
  background inline would make every placement rewrite megabytes). Neither
  is sync-pushable: placements feed quotes, so writes are server-action-only
  (same guardrail as quotes/catalog_parts).
- `stores/grid-projects.ts` — projects are `GRD-####` (nextPrefixedId base
  5001). Placements are normalized 0..1 points carrying a catalog SKU;
  calibrations reuse `lib/annotations.Calibration` with `docId` = sheet id.
- `lib/design/grid-bom.ts` — dependency-free BOM math (client sidebar and
  server quote action share it, so they can never disagree). A placement
  whose part left the catalog stays visible at $0 flagged "removed part"
  rather than silently shrinking the quote. Covered in test:specs.
- Editor: sheet upload (PDF/image, 8 MB cap, DWGs get printed to PDF —
  DEC-PSD-4), pdf.js render via the markup screen's PdfCanvas (moved to
  `src/components/design/pdf-canvas.tsx`), page-scale calibration with the
  markup screen's inline-entry idiom, device palette over the live catalog
  (search + category filter), click-to-paint markers (category-colored, SKU
  chip), marker select/remove, live grouped BOM.
- "Create draft quote" mints a `source: "grid"`, `quoteType: "system"` draft
  (value = list total, margin = blended (list−cost)/list) with
  `spec: { kind: "grid", gridProjectId, lines }`, and stores `quoteId` on
  the project. Re-running refreshes the same quote while it is still a
  draft; once the quote has moved past draft the action refuses — rewriting
  numbers a customer may have seen is the quote screen's revision machinery's
  job, not a side effect of moving markers.

**Bugs caught while verifying in the browser (worth remembering):**
- An `<img>` sheet's `onLoad` can fire before layout (and not at all for
  cached images), leaving the size state 0×0 → aspect NaN → calibration
  failed with a misleading "enter a positive number". Fix: read
  naturalWidth/naturalHeight via callback ref + onLoad. The markup viewer
  has the same latent pattern (its size state also starts 900×1200 and is
  set from clientWidth onLoad) — flagged as a follow-up.
- The callback-ref fix originally called setSize unconditionally — an inline
  ref runs on every commit, so that was an infinite render loop that hung
  the tab. Functional update returning the same reference when unchanged.
- `toNorm` now guards a zero-size rect (sheet still loading) — the division
  was NaN and poisoned draft geometry with no visible error.

**Deliberately NOT in slice 1** (roadmap in memory:
projects/peak-system-designer.md): wire routing, riser/one-line generation,
accessories/port rules, datasheet/submittal packages, spaces, per-part
symbol metadata (markers show the SKU chip), venue/site link on the project,
pricing-tier stamping on the minted quote, and blob storage for attachments
(grid_sheets-as-docs is the interim; real blob storage is still the Phase-0
item for backgrounds at production scale).

## D109 — The Grid Phase 2: Spaces + project revisions (2026-07-24)

Jeff: "move forward with the next phase of the grid." Phase 2 per the
roadmap (memory: projects/peak-system-designer.md): **Spaces** — room
polygons with per-space BOM rollups — and **project revisions**.

**Spaces.**
- Polygons (normalized 0..1, per sheet+page like calibrations) stored on the
  project doc. No new collections, no migration — pre-D109 docs read
  `spaces || []`.
- **Assignment is computed, never stored:** a device belongs to the smallest
  space polygon containing it (`lib/design/grid-geometry.spaceOf`, ray
  casting + shoelace, covered in test:specs). Redrawing a room reassigns
  every device instantly; deleting one can't strand stale ids; nesting works
  (a booth inside the house claims its own devices). The alternative —
  stamping a spaceId on each placement — would have needed reconciliation on
  every polygon edit.
- Editor: corner-click drawing that closes on the first corner, inline name
  entry, translucent fills under the markers, centroid label chips,
  smallest-wins click-select, rename/two-step delete in the panel. Rollups
  (count · value) per space, plus Unassigned; the geometry and pricing run
  through the same dependency-free libs on client and server.
- addSpaceAction refuses <3 corners and zero-area polygons.

**Revisions.** The QuoteRevision idiom, applied to the design: append-only
`revisions[]` snapshots (name, sheetIds, placements, calibrations, spaces),
reasons `manual | quote | restore`. Quoting auto-cuts one ("Quoted as
Q-####") so what-was-quoted is always recoverable. Restore is
non-destructive: auto-save current → apply target → record the recall.
**sheetIds are snapshotted but never applied on restore** — sheets are
write-once uploads, and restoring an old layout must not orphan a
since-added sheet.

**Input hardening found while verifying:** pointer events are now ignored
outright when the canvas rect is unmeasurable (a hidden window/mid-load
click previously normalized to (0,0) — it dropped a device or space corner
at the top-left of the sheet).

**Verified live** on GRD-5002: Stage 3 · $2,250 / House 2 · $220 rollups,
delete/redraw, manual save → device removal → restore v1 (auto-save + recall
entries) → quote update cutting v4. test:specs 15 new assertions; build green.

## D110 — The Grid Phase 3: wire routing with measured lengths (2026-07-24)

Phase 3 per the roadmap: draw wire runs on the plan, measure them from the
page's stored scale calibration, and roll the footage into the BOM and the
draft quote.

**Model.** A route is a polyline (normalized 0..1 waypoints) on one
sheet+page carrying a per-length catalog part and the page's **aspect ratio
stamped at draw time**. Aspect is a property of the page, not the viewport,
so real length — `polylineLength(points, aspect) × calibration.scale` — is
recomputable anywhere (client sidebar, server quote action) without opening
the sheet. Nothing is denormalized: **recalibrating a page reprices every
wire on it instantly.**

**Rules.**
- **Wire types are catalog parts with a per-length unit** (`ft`, `lin ft`,
  `linear ft`, `lf`, leading-slash variants) — DEC-PSD-1: the catalog is the
  library, no special wire table. The two demo parts (WIRE-SO123, WIRE-DMX)
  went in through the Catalog screen's own add-part form.
- **Routing requires the page to be calibrated** (refused server-side with a
  clear message): an unmeasurable wire is a lie in a BOM. If a calibration
  is cleared later, affected routes surface as "unmeasured" counts in the
  Wires and BOM panels — excluded from pricing, never silently guessed.
- **Footage is ceiling-rounded per part** across the whole design (cable is
  bought whole): qty = ⌈Σ measured ft⌉, ext = qty × list.
- Routes ride in revisions like everything else; restore round-trips them.
- Editor: waypoint clicks, **click the last waypoint again to finish** (the
  part is picked up front, so no popover); dashed polylines in the part's
  category color with a mid-run length chip; route click-select takes
  precedence over space select (a wire is the finer target).

**Verified live** on GRD-5002: SO run measured **39'-6"** (hand-check: 0.564
page-widths × ~70 ft/pw ≈ 39.5 ft — exact), DMX run 19'-4"; BOM gained
40 ft × $2.10 = $84 and 20 ft × $0.85 = $17 (total $2,571); quote update
cut its revision; restoring pre-wire v1 dropped the wires and restoring the
auto-save brought both back. test:specs +13 assertions; build green.

## D111 — The Grid Phase 4: bid-spec bridge into D94 (2026-07-24)

The D94 generator's "Start from a quote" only understood the estimator's
nested `spec.sections[].items[]`. `bomFromQuoteAction` now also reads the
flat `spec.lines[]` shape The Grid mints, so a Grid design flows into the
CSI submittal pipeline with no new machinery: paint → BOM → draft quote →
bid spec. The Grid editor links straight in ("Bid spec from this design →")
when the customer has a live consulting engagement — the generator stays
engagement-scoped (D94's anchor), The Grid just finds the door.

Verified live: created consulting quote Q-2044 for North Ridge, won it (the
engagement CE-1001 opened per the standard flow), generator offered Q-2043,
and its four lines (3× EQP-LIFT, 2× LIG-SUP, 40 ft WIRE-SO123, 20 ft
WIRE-DMX) loaded into the matcher with the normal write-spec/waive workflow.
Datasheet packages remain deferred — that is per-part file authoring, data
work not code.

## D112 — The Grid Phase 5 (v1): derived riser sketch (2026-07-24)

`/design/grid/<id>/riser` — a READ-ONLY one-line diagram derived on every
load: spaces are nodes (device counts grouped inside), and each wire run is
an edge between the spaces its endpoints land in (smallest-wins, same
`spaceOf` as everything else), labelled with the part and measured length.
Devices/endpoints outside every space share an "Unassigned" node — nothing
silently disappears. Derivation is pure (`lib/design/grid-riser.ts`, covered
in test:specs); layout is deliberately simple (columns + arc rail).

**Why derived-not-drawn:** DaVinci's riser is an editable document with a
real auto-layout engine — that remains the "hardest single piece" of the
roadmap and is NOT this. The sketch can never drift from the plan, which
makes it safe to show a customer today; hand-editing comes later, if ever.

**The Grid's remaining roadmap is now Jeff-gated, not code-gated:** catalog
symbol/accessory/datasheet metadata (authoring), first-seeded brands for the
palette, real blob storage for sheets (hosting account), per-space schedule
report format, DXF export. Phases 1–5 all have a working slice.

## D113 — Jeff's decision batch: The Grid + standing product questions (2026-07-24)

Twelve open items put to Jeff directly; all answered. Logged here so nothing
re-litigates them.

**The Grid**
1. Branch `quartzite-the-grid` → **merged to main** (this merge).
2. Sheet storage → **Vercel Blob at deploy time**; JSONB-per-sheet stays for
   the beta. Spec the migration before go-live.
3. **Printable per-space equipment schedule: yes** — letters-style document
   per room (the thing you hand an electrician). Next build item.
4. Device-metadata authoring starts with **ETC lighting + rigging**.
5. Labor in Grid BOMs → **auto-suggest from painted devices** (BomServices-
   style rules, editable before the quote mints). Painting labor markers
   stays possible meanwhile.
6. Grid quotes get **venue link + pricing-tier stamping** next work session
   (closes the D108 deferral; same tier resolution as estimator quotes, D87).
7. Riser sketch gets **print/PDF output** (zero-dep lib/pdf.ts path);
   editable riser stays future.

**Standing product questions**
8. Cut allowance (Decision B) → **6 inches, fix the unit** — confirmed;
   the fix had just landed on main as `fd2f768`.
9. **Repairs appear on the unified Schedule board** like flame-test visits.
10. `/flame-tests/today` → **add a team toggle**, default stays personal.
11. A **"delivered" engagement stays open** through bid support until
    oversight ends — dashboards should count delivered/bid_supported as
    active (today some filters count only `status === "active"`; sweep them
    when this is implemented).
12. Apple Reminders queue sync stays **Jeff-only** for now; Jeff sets
    `QUEUE_API_TOKEN` when ready.

Items 3, 5, 6, 7, 9, 10, 11 are the agreed build backlog, in that rough
priority order.

## D114 — The Grid: labor auto-suggest v1 (2026-07-24)

Per D113 item 5 ("auto-suggest from devices"). The rule is deliberately
small: every painted device earns `grid.laborHoursPerDevice` install hours
(pricing-rules knob, default 0.5), bucketed by discipline guessed from the
part's category (light→LIG, audio/sound→AUD, video/projection→VID, else
RIG — Peak's home discipline), priced at the catalog's own labor rows
(role "labor", matching discipline; rates are never invented — no labor
rows, no suggestions). Hours round up to the half hour. Suggestions appear
in the BOM panel default-included with a checkbox + editable hours; the
quote action re-validates and re-prices server-side (client proposes hours,
server prices). Wire, labor, and per-length rows don't count as devices.
Refine the mapping to real per-class rules when actual usage shows where
the heuristic is wrong.

## D115 — Repairs crew fan-out on the Schedule board (2026-07-24)

Jeff (D113 item 9): repairs belong on the unified Schedule like flame
visits. They already appeared — keyed by `assignedTo` only; D100 had
deliberately held the `crew` roster back. Reversed: `serviceToWorkItems`
now fans records with a crew out to one bar per distinct person (lead +
crew, deduped, trimmed), so a crew member's day never looks free while
they're on a repair. Fanned bars share the record's href with suffixed ids
(unique lanes/keys); lone-assignee and unassigned records keep their stable
id. Flame/inspection records carry no crew field and are unchanged. Covered
in test:specs.

## D116 — Vercel Blob for Grid plan sheets (2026-07-24)

D113 item 2, built the day Jeff created the store (`quartzite-files`,
connected to Production+Preview; token in `.env.local` locally — Vercel
marks store tokens *sensitive*, so the CLI can't pull the plaintext and the
dashboard copy is the one manual step).

**Seam (`src/lib/blob.ts`):** env-gated like Gmail — no
`BLOB_READ_WRITE_TOKEN`, no behavior change (sheets stay as in-database
data-URLs). With it, `addSheetAction` uploads to
`grid-sheets/<projectId>/<name>` and the sheet doc stores the blob URL +
pathname, `dataUrl` empty. **The store is PRIVATE** (Jeff created it that
way — the right call: customer venue drawings must not sit behind
world-readable URLs). Browsers therefore never fetch Blob directly: the
authenticated proxy `/api/grid-sheets/<sheetId>` (requireUser → private
`get()` stream, `cache-control: private`) serves the bytes, and the editor
points sheets at it. The transport is unchanged (browser → action as a
≤8 MB data-URL; only STORAGE moved); PdfCanvas branches data-URL vs URL,
`<img>` is native.
`scripts/backfill-blob-sheets.ts` moves pre-existing sheets (PGlite
discipline applies: server stopped, `.data` copied aside). Datasheets (§10)
will use the same store under `datasheets/`.

Upload failures fail the action loudly rather than silently falling back —
a design half-in-DB, half-in-Blob because the token expired mid-week would
be worse than an error message.

## D117 — Dealer price sheets imported to the catalog (2026-07-24)

The 52-brand dealer folder (prepped by the Cowork session, mounted at
`/Volumes/Claude/Peak Import`) is now in the LOCAL catalog: **14,674 parts
across ~60 brands** (catalog total 14,704 with the dev demo rows), imported
via `scripts/convert-dealer-sheets.py` → `scripts/import-dealer-sheets.ts`
(idempotent upserts, `Brand:Model` SKUs — same contract as the original
price-book import).

**Parsing model** (the sheets are heterogeneous, 20 of 52 PDF-derived):
stateful header walking (headers re-detected mid-sheet), prioritized fuzzy
aliases (Part Number > Item; MSRP > MAP), a generic headerless parser
(sku = first short text cell, desc = longest, prices = whole-cell money
values only — digits embedded in model names are never prices), fused-cell
splitting ("LR-ASC48 desc…" / "$3,850 $2,310"), and price-sanity gates
(sub-$10 lists rejected, implausible costs dropped-with-flag, inverted
columns swapped-with-flag, bare years rejected).

**5,206 rows carry a "verify" note** — deliberate honesty, not failure:
tier-priced sheets (Symetrix/Danley/Listen — Peak's tier per vendor is
unrecorded), Shure "+3%"/EAW "+8%" off-dealer footnotes (NOT applied —
noted instead), Chauvet list-only (its dealer discount lives in the
unconverted tiers PDF), and everything parsed headerless.

**Held out, needs Jeff:** ① Tannoy June 2023 (Music Tribe Nov 2025 carries
newer Tannoy — overrule if the dedicated sheet should win); ② Ape Riggers
2014 (OCR garbage — request a current sheet); ③ Draper (configurator size
matrices, tens of thousands of permutation rows — its own import decision).
**Weak parses to revisit or re-source:** Apex (21/244), Linea Research (3),
NETGEAR (21/144), Renkus-Heinz (33/247), LynTec (5 — amp ratings polluted
its numbers), Polar Focus (13), Visionary (37), Cloud (80).

**Local dev only so far.** Production is the same two commands with
`DATABASE_URL` set, after the main push. Converter + importer are committed;
the generated JSON is not (regenerate from the folder).

## Sign-on email pattern (2026-07-25)

- **D118. Roster emails derive as firstname + last initial**
  (`jeffc@peaksystemsgroup.com`), matching the real Google Workspace
  addresses, so Google SSO's invite-list check matches without editing each
  user. `emailFor()` flipped in `src/lib/team.ts`; the old derivation lives
  on as `legacyEmailFor()` — it is the one-time migration's "was this
  auto-derived?" test and the deterministic fallback when two people share
  a firstname+lastinitial address (also guarded in `addUser`). One-time
  rewrite: `npx tsx scripts/migrate-email-pattern.ts` — touches only rows
  still equal to the legacy derivation; custom emails/googleEmail untouched.
  **Run it once locally when the dev DB is free, and once against prod
  (DATABASE_URL) at deploy.** Note: the Google `redirect_uri_mismatch`
  error is separate — the OAuth client in Google Cloud Console must list
  the current domain's callback (`https://quartzite-six.vercel.app/api/auth/callback/google`).

## D119 — Opportunity board shape: union view, PO-as-field, all quote types (2026-07-26)

Controller calls made to unblock plan 02 (#18/#19) — **flagged for Jeff's
review**, none block later promotion to a real Opportunity record:

- **Read-time union, no Opportunity record.** The board projects leads +
  quotes through `src/lib/opportunities.ts` (pure, spec-covered). A converted
  lead is excluded — its quote carries the card. Promote to a real record
  only if the union creaks (spec §3).
- **Column mapping.** Lead: new→New, contacted→Collect Info,
  qualified→Estimate, quoted→Estimate Sent, won/lost→Won-Lost. Quote:
  draft→Estimate, sent→Estimate Sent, lost→Won-Lost, won→Won-Lost or
  PO Received (`poReceivedAt` fork).
- **PO Received is a FIELD, not a fifth status.** `Quote.poReceivedAt:
  number | null` + `setPoReceived(id, on)` (refuses unless won).
  `QuoteStatus` stays 4-state; the won/lost spawn machinery is untouched.
- **ALL quoteTypes ride the board** — flame_test / repair / inspection /
  consulting bids are pipeline too. **Product flag for Jeff:** should
  service bids be filterable out (or excluded) on the opportunity board?
- **Drag policy.** Leads move among the four open columns only — never into
  or out of Won-Lost by drag (convert flow and markLost-with-reason stay the
  only paths). Quotes drag only Won-Lost ↔ PO Received while won. Server
  re-validates every drag with the same pure policy.
- **Forecast date lives on the lead** (`forecastAt`, drawer-edited); quote
  cards inherit it from their originating lead. Quotes get NO new date field.
- **Age chip resets at conversion (product flag).** Quote cards age from
  `quote.createdAt`, not the originating lead's — only `forecastAt` is
  inherited, so an opportunity's age-in-days chip resets to 0 at lead→quote
  conversion. Daylite-style age-since-lead would be a 2-line follow-up
  (inherit `createdAt` the same way) if Jeff wants it.
- Projects board (#19): alongside-toggle, installs-only, read-only —
  Jeff's three open sub-decisions taken per the punchlist recommendations.

## D120 — Lead-thread shape: visit lifecycle, claim model, survey-gated convert (2026-07-26)

Controller calls made to unblock plan 03 (#34) — **flagged for Jeff's
review**; the spec's shape (§3 #34) is followed, these are the seams:

- **Lifecycle semantics.** `requested` = born open from a lead request;
  `open` = explicitly released back to the pool; `claimed` = assignee, no
  times; `scheduled` = has times (the inbox path lands here, unchanged);
  `done` = past. Normalize-on-read (`deriveVisitStage`, pure): legacy
  stage-less docs derive from times; stored "scheduled" past `endAt ??
  startAt` reads done. **No migration; site_visits stays non-syncable.**
- **Claim = the LEAD model** (any `requireUser`, no approver gate, no
  `claimedAt` — stage + updatedAt). Release ≠ un-request: released visits
  read "Open — unclaimed".
- **The convert gate lives in `convertLeadAction`**, not `convert()` —
  least ripple; `convert()` keeps its signature/null contract. Gate:
  `canConvertLead(survey, skip)` on the survey resolved via the lead's
  linked surveys (`surveysForLead`, newest first) — deliberately NOT the
  active visit's `surveyId` (the brief's wording): a past visit derives
  "done" and drops out of "active", which would fail the canonical
  visit-happened → survey-completed → convert path as "survey-missing"
  while the drawer preview showed green. Gate and preview share the one
  resolution path. Skip is explicit (checkbox + optional reason) and
  logged as lead activity. A lead with NO visit/survey at all also
  blocks (survey-missing) — every convert now passes the gate or ticks
  skip; that's the spec's "gated on the survey, not bypassing it".
- **Newest survey governs the gate.** `surveysForLead` resolves newest-first,
  so a re-request after a completed survey (a second site visit against the
  same lead) flips the gate back to blocked until the NEW survey completes —
  intended, not a bug: newest request = current intent, and a stale
  completed survey shouldn't wave through a convert the team just decided
  needed another look.
- **The auto-created survey** carries `leadId`/`visitId` (through blank()'s
  whitelist + SurveyPatch) and is born `requested`, so it surfaces through
  the EXISTING field badge + "Survey requests to schedule" bell — no new
  survey plumbing.
- **Queue/bell:** My Queue source `site-visit` (unclaimed for everyone —
  the unclaimed-review precedent; claimed-unscheduled for the claimer;
  due = requested + 3 days). Bell category `visits` ("Site visit
  requests"); **no nav badge** (nav-counts single-batch rule — one added
  parallel fetch only).
- **Consulting `VisitLite` filters out unscheduled visits** instead of
  going nullable — the Oversight timeline math stays untouched; a lead
  request joins the consulting surfaces once scheduled.
- **`dispatchVisitInvite`** extracted from the inbox action, behavior-
  preserving (same statuses/stamps/fallbacks, recipient = assignee only);
  both schedulers share it.
- **Lead stage is NOT coupled to visit progress** (spec left it open) —
  the drawer chips surface the thread; product flag for Jeff.
- **Final-review fix wave (`4439458`).** Three gaps closed after re-review:
  `markLostAction` now closes any still-open pool visit (`requested` /
  `open` / `claimed`) on a lost lead, and — if that visit's auto-created
  survey is still untouched at stage `requested` and still carries the
  lead's `leadId` — soft-deletes the survey too (one combined activity
  note), so a dead lead stops nagging the survey bell/field list;
  `convertLeadAction` backfills the resolved `customerId` onto the lead's
  pre-conversion visits/surveys so they join the customer's own history;
  and the lead drawer's completed-survey chip now survives visit
  completion — the "No site visit was requested." fallback is gated on
  `!thread.survey` too, so a converted lead whose visit is done but whose
  survey chip is still showing doesn't also show the contradictory
  no-visit text directly beneath it.
- **Logged, not fixed** (product/UX follow-ups, not data-integrity bugs):
  an outbox/sync race could in principle clobber the convert-time
  `customerId` backfill above — the same last-write-wins idiom used
  app-wide, not specific to this feature; `requestVisitForLead`'s
  one-active-visit-per-lead dedupe is check-then-create, not atomic (the
  doc-store's existing uniqueness-check idiom, same race class as
  elsewhere in the app); and the field-survey scheduler's `doSchedule`
  doesn't surface it to the user when `dispatchVisitInvite` returns
  `inviteStatus: "failed"` — the visit still schedules (by design, so a
  bad invite can't strand a good schedule) but the user isn't told the
  invite itself failed. All three are logged here for Jeff rather than
  fixed in this plan.

## D121 — Customer activity feed shape: notes collection, pure row builders, 60-row cap (2026-07-26)

Controller calls made to unblock plan 04 (#21) — **flagged for Jeff's
review**; the spec's v1 (§3 #21: customer-page merged feed + notes as a real
record, no field-level tracking) is followed, these are the seams:

- **`notes` is a real doc-collection** (`N-####` from base 7000, migration
  0010), **NOT syncable** (server-action writes only — the engagements/
  site_visits precedent; SYNCABLE_COLLECTIONS/FIELD_COLLECTIONS untouched).
  `NoteRecord.parentKind: customer|lead|project|quote` + `parentId` +
  denormalized `customerId` — attachable by design; only the customer
  composer exists in v1. `nextPrefixedId` + `upsertDoc` accepted for the
  single-user-ish composer (no `insertDocIfAbsent`): the v1 composer is the
  only writer of customer notes, ids are minted fresh per submit (never
  re-target an existing id), so there's no absent-vs-present race for
  `insertDocIfAbsent`'s guard to protect against — `upsertDoc` is the
  simpler primitive with identical behavior for this write shape.
- **Read-time aggregation, no source changes.** The feed renders what the
  stores already keep: quote `history[]` + the `poReceivedAt` /
  `portalAcceptance` annexes (setPoReceived writes no history — the annex
  IS the record), comm `messages[]`, visit lifecycle (plan 03), flame/
  repair `approvedAt`/`completedAt`, inspection `requestedAt` (legacy 0 →
  skipped) + `completedAtOf`, surveys at `updatedAt`, project
  `stageHistory[]` (D83) + newest-first `notes[]`. The un-stamped
  "scheduled" transitions (bare ISO day, no ms) are skipped.
- **Double-fetch accepted.** The company page's own Promise.all (quotes,
  projects, surveys, threads, visits — for the Communications / Quotes /
  Projects / Site visits cards) and `loadCustomerFeed`'s Promise.all
  independently re-read the SAME underlying stores (comms `byCustomer`,
  `getAllQuotes`, `getAllSurveys`, `getAllProjects`, `visitsForCustomer`)
  per render — no shared cache between the page and the loader. Beta-fine
  at hundreds-of-records volumes; a shared-fetch refactor is a candidate
  if per-request read cost ever matters.
- **Pure feed layer with mirrored vocab.** `customer-feed-rows.ts` /
  `feed-buckets.ts` import no stores (client-bundle + no-DB-spec rules);
  quote verbs and survey stage labels are mirrored locally with every
  literal pinned by specs (drift breaks the suite) — **and, post-review,
  the mirrors are typed `Record<QuoteStatus, string>` /
  `Record<SurveyStage, string>` via type-only imports** (erased at build,
  so the zero-store-import rule still holds at runtime) instead of
  `Record<string, string>`, so an added/renamed stage in either store now
  fails `tsc`, not just the spec suite; project stage labels are PASSED IN
  by the loader (they differ per kind), as is the inspection completion ts.
- **Buckets are local-time, Monday-start weeks**, Date-part math (DST-safe),
  same-day future stamps (clock skew) still read "Today". Vocabulary:
  Upcoming / Today / Yesterday / This week / Last week / This month /
  "<Month Year>" (en-US, the app's locale convention). The local-midnight
  bucket edge is the same app-wide idiom used elsewhere for day-boundary
  math (not a one-off invented for this feed).
- **Upcoming bucket added** (reviewer fix, 2026-07-26): timestamps at/after
  tomorrow's local midnight — e.g. a scheduled site visit with a future
  `startAt` — now bucket as "Upcoming" and lead the feed, instead of
  incorrectly sitting under "Today". Rows are already ts-desc sorted, so
  the highest-ts bucket naturally comes first; `groupRows` needed no code
  change, only `bucketFor` gained the new branch. **Companion fix:**
  `timeAgo` (`src/lib/format.ts`) previously clamped any future delta to
  0 ("just now"); it now has a symmetric future branch ("in Nm"/"in Nh"/
  "in Nd") so an Upcoming row's sub-line reads correctly instead of lying.
  All pre-existing call sites pass only past timestamps, so this is
  additive — behavior elsewhere is unchanged.
- **60-row cap** (`FEED_CAP`), "Show more" deferred — product flag. The
  card's row-count chip shows the capped total with no "+" affordance, so
  a customer at exactly 60+ rows reads identically to one at exactly 60 —
  a cosmetic gap logged as a residual, not fixed in v1.
- **Communications card kept** beside the feed (duplication accepted for
  v1) — product flag: fold it into Activity later? **Related and likewise
  flagged:** a lead-requested site visit and its auto-created survey both
  land on the feed as separate rows ("Site visit — …" and "Survey FS-####
  — Requested") stamped within moments of each other — a near-duplicate
  pair from the user's point of view, same underlying event. Not merged in
  v1; bundled with the Communications-duplication question for Jeff's call
  on whether either pairing should collapse to one row.
- **`LeadActivity` NOT migrated** — `logActivity` carries SLA side effects
  (firstContactAt/lastActivityAt) that must not be bypassed; lead notes can
  adopt `NoteRecord` (`parentKind: "lead"`) in a later plan.
- **Job/inspection feed hrefs go to the module list pages** (`/flame-tests`,
  `/repairs`, `/inspections`) — those screens have no `?id=` selection to
  deep-link; quotes (`/quotes?id=`), comms (`/inbox?thread=`), surveys
  (`/field-survey?id=`) and projects (`/projects?id=`) deep-link for real.

## D122 — Customer custom fields + Mine/All scoping: shapes and seams (2026-07-26)

Controller calls made to unblock plan 05 (#23/#22) — **flagged for Jeff's
review**; spec §3 is followed (custom fields built without waiting for the
export audit; Mine/All scoped nav entries first, per-person saved views
deferred), these are the seams:

- **Definitions vs values split:** `CustomFieldDef[]` lives in
  `AppSettingsData.customerFieldDefs` (FULL-REPLACEMENT save, the wireTypes
  idiom; `resolveFieldDefs(stored) = stored ?? []`, no code defaults, ≤30
  defs); VALUES live in `companies.custom` jsonb (migration 0011), keyed by
  def id. Ids are slugs minted server-side from the label at create and
  IMMUTABLE after (they key stored values); the kind locks once created.
  Field logic is pure + spec-covered (`lib/customer-fields.ts`, zero
  imports). Dates are epoch-ms (local midnight); text ≤500 chars; select
  values must match the def's options; unknown ids stripped server-side.
- **Write-when-provided / preserve-when-undefined** on the customers store:
  `lifecycle`/`keywords`/`custom` joined `CustomerDoc` as CONTENT fields.
  `writeRecord` backfills absent fields from the existing row BEFORE the
  D83 no-change check, and `contentKey` gives the three a canonical
  serialization slot (position + defaults + sorted custom keys) — so a
  Details-only edit registers as a change, while legacy writers (lead
  convert, CSV importer, seed) neither clear values nor advance updatedAt.
  `lib/identity/convert.ts` (D85 bootstrap) bypasses upsert entirely and is
  untouched.
- **Removing a def orphans its values silently** (they stay in the jsonb,
  stop rendering, and are stripped on the next modal save) — accepted for
  v1; an admin "purge orphaned values" pass can come later if wanted.
- **Strict owner scoping** (`?who=`, the quotes canonicalization) on leads
  and projects: `owner === name`, NOT unownedOrMine — unassigned leads keep
  their own segment + claim flow and read 0 under any owner scope. Leads
  counts are re-derived locally (metrics() stays unscoped/global);
  followUps({owner}) reuses the store's existing opt. The drawer and the
  project detail resolve deep links UNSCOPED on purpose.
- **Leads segments:** `closed` → `won` | `lost` (`leads/segs.ts`, a
  dependency-free allowlist module the spec harness pins); legacy
  `?seg=closed` falls back to "all". No hardcoded closed links existed.
- **OwnerSelect extracted** to `components/owner-select.tsx` (verbatim move;
  quotes/controls re-exports so /quotes is untouched).
- **Nav My-X children** are plain querystring hrefs; `activeKeyFor` stays
  pathname-only and the overlay-close effect stays [pathname]-keyed — both
  cosmetic limitations accepted rather than forcing useSearchParams (and
  dynamic rendering) into the layout's Nav.
- **"New (7d)"** (`?added=7d`) filters on `createdAt`, which post-D85 EVERY
  company row has (composeDoc copies the notNull column; the converter
  stamped legacy rows with the conversion run time) — legacy rows read as
  new for a week after any reseed or the prod bootstrap (documented; real
  creation dates are unrecoverable).
- **DEFAULT_ACTOR wrinkle** (flagged, not fixed): non-quote projects default
  owner "Jeff Chesebro" and no owner-editing UI exists on projects — "My
  projects" is sparse for other users until one lands.

## D123 — Consulting rebuilt: six stages, sent-spawn, structured proposals (2026-07-26)

Implements spec §1 (2026-07-25 remaining-items sheet), closing 13-D and punch
items 35 + 25. Shapes and seams:

- **Six-stage lifecycle** `proposal_sent → awarded → design → out_to_bid →
  construction_admin → closed` in the dependency-free `lib/consulting-stages.ts`
  (client-bundled + server-trusted + harness-imported). `EngagementStatus` is
  now an alias of `EngagementStage`; `ENGAGEMENT_STATUS_LABEL` kept its export
  name so consumers survived unchanged.
- **Lazy migration:** `LEGACY_STATUS_MAP` = active→design, delivered→out_to_bid,
  bid_supported→construction_admin, oversight_complete→closed. Store reads
  normalize; `patchEngagement` upgrades the stored literal on the doc's next
  write. Unknown strings land on "design". No bulk rewrite.
- **ONE open-definition** (D113.11 carry-over: everything before Closed is
  open): `isOpenEngagement` lives in consulting-stages, re-exported through
  consulting-review; venue-match's zero-import duplicate list is spec-pinned in
  agreement; the grid page's inline check now imports the rule. This also FIXED
  venue-match, which still said `["active","bid_supported"]` against D113.
- **Spawn model:** engagements are born when the consulting quote is SENT (at
  proposal_sent, `ensureEngagementForQuote` hooked in setQuoteStatus), advance
  to awarded on won (only from proposal_sent — a human-moved stage is never
  touched), and close on lost-at-proposal_sent with a "Proposal lost" decision
  entry. All routes through the idempotent `syncEngagementsFromQuotes` (rebuilt
  over the pure `engagementSyncAction`; still the fifth on-win sync), which
  `loadConsultingData` also runs as the safety net (the projects idiom) because
  estimator/inbox status paths never call syncs. `createFromQuote` deleted
  (zero callers). The SENT branch in `quotes/actions.ts` now calls
  `syncEngagementsFromQuotes()` directly (not `ensureEngagementForQuote`) so a
  proposal re-sent after "Proposal lost" reopens to Proposal sent immediately
  on that same request, instead of waiting for the next `loadConsultingData`
  safety-net pass — live-verified via the Quotes detail chip alone (which never
  runs the sweep), so the reopen is provably an action-layer effect and not
  masked by a subsequent page load.
- **Proposal payload (additive):** `scopes[]` ({id "sc-", title, description,
  fee}; quote value = scope total; engagement milestones seed name=title,
  amount=fee, targetDate 0 — the Reports billing forecast filters
  targetDate>0, so it is unaffected), `assumptions[]` (ticked library texts
  frozen at save), `leadId`. Legacy scope/feeMode/fees stay on the type;
  pre-rebuild quotes render read-only in the builder and keep their old letter
  layout.
- **Assumptions library:** `AppSettingsData.consultingAssumptions` +
  `mergedConsultingAssumptions` (visitReasons idiom), admin card in Settings,
  DRAFT 10-line seed pending Peak's real letter. Template gained the additive
  `assumptionsLead` field ("This proposal assumes:"). This is the seam the
  estimator's §4 assumptions model consumes in wave ③.
- **Auto-lead with dedupe:** proposal CREATE links the company's open lead
  (system activity "Consulting proposal Q-#### created") or creates one —
  new closed-union LeadSource literal `"consulting"` (without it, create()
  silently coerces to "manual").
- **Architect:** minimal `{company, contact} | null` on the engagement, dumb by
  design — migrates into item 20's people/roles model.
- **Peak as bidder:** `installQuoteId` kept; the link now validates existence +
  non-consulting, and status chips run both directions (Overview shows the
  install quote's stage; the Quotes detail chips the engagement via
  `getEngagementForQuoteRef`, selected row only).
- **#25:** display-string sweep only; nav already said "Consulting" (D117).
  URLs/keys/collection names unchanged.

## D124: Punch wave A (#47, #50 partial, #53, #54 partial, #55): defaults taken (2026-07-27)

Five unblocked items from Jeff's 2026-07-27 punch list, built on branch
`punch-2026-07-27-wave-a`. Each carried small calls that did not need his input;
they are recorded here rather than asked.

- **#47 Grid move, a move is NOT a revision.** `addRevision()` stays
  manual/quote/restore only; wiring drags into it would flood the snapshot array
  on every gesture.
- **#47: attached wires follow the device, by DELTA not by snap.** `GridRoute.points`
  is independent of `fromPlacementId`/`toPlacementId`, so a naive move detaches the
  drawn line. The matching endpoint is translated by the same delta inside the same
  `patchDoc`, preserving the hand-drawn offset the wire was routed with. Coordinates
  only: a move never changes `sheetId`/`page`, because a route lives on one page and
  carrying a device across pages would strand its wires.
- **#47: move does not restamp `by`/`at`.** Those record who *placed* the device.
- **#47-4 screen-pixel click/drag threshold**, measured on `clientX/Y` rather than
  normalized units: the plan zooms, and a normalized threshold would make the same
  steady hand write at one zoom and not another. Below the threshold the old
  toggle-select path runs verbatim and nothing is written.
- **#50: no invented fallback weights.** When a drape's fabric fails to resolve,
  `computeSetWeight` zeroes goods AND track. The fix NAMES the gap (row chip, grouped
  banner, red-bordered select, `FABRIC UNRESOLVED` prefix in the CSV Check column)
  and distinguishes *no Fabric parts in the catalog at all* from *this part has no
  oz/yd²*, because they need different fixes. It does not paper over it with a default.
- **#50: Track "None" added at the SELECT layer, not to the shared `TRACKS` const.**
  `steel.ts` is shared with the Steel Calculator and the Grid; a 0 lb/ft row would leak
  into both. `steel.ts` was not touched.
- **#50: per-line pipe/batten override falls back to the global** (`L.pipe || def.pipe`;
  blank batten length inherits `def.battenlen`, shown as the placeholder). Needed a new
  `OptNumF`: `NumF` coerces every keystroke, which makes 0 the only expressible "unset".
- **#50: fabric tier labels corrected to the data** (`better` = 25 oz Charisma, not the
  21 oz Marvel the UI claimed). The labels were wrong, not the mapping.
- **#53: the Sell box became `type="text"` with parse-on-blur.** A `number` input
  cannot render `$` or `,` at all. Uses the existing `fmt()` (so it matches Price/Cost/
  Freight in the same card) with `inputMode="decimal"` to keep the touch numpad; the
  parse strips `$`, commas and spaces, and empty still yields 0 exactly as before.
  Side effect worth knowing: the box now shows cents where it used to round to whole
  dollars.
- **#54: provenance rides on the rate function, not a parallel prop.** `RateFn` gained
  an OPTIONAL `.source(sku)`, so every existing `(sku) => number` caller still satisfies
  the type and `makeLaborRate`'s resolution logic is unchanged. The modal marks any rate
  that came from `LABOR_RATES_FALLBACK`, a missing or renamed catalog row was previously
  indistinguishable from a real rate. Travel/equipment rates (`TVL-*`, `EQP-LIFT`) are
  still silent: they are per-mile/night/day, not $/hr, and did not fit the strip.
- **#55: home routes now return their own child keys** (`/` → `dashboard`, `/queue` →
  `queue`, …) instead of a shared `"home"`. `parentGroupOf` only matches CHILD keys, so a
  Home group alone would still have left the pill dark on the app's most important route.
  `activeKeyFor` has one consumer and `"home"` was otherwise dead.
- **#55: the BETA chip stays outside the Home link.** It is a status badge, not a nav
  target. `nav-data.ts`'s comment claiming "the mark is the link" is now true rather than
  aspirational.
- **Rendering bug found in review:** an empty-string JSX child between two text nodes
  swallowed the space before "can't" in the #50 banner ("1 linecan't be weighed"). Fixed
  by emitting the sentence as one template literal.

**Not built, waiting on Jeff:** #50's three-input reduction (blocked on where `battenLen`
comes from: it is a hardcoded 44 ft driving batten weight, track weight and the bending
check), #54's "redo the labor estimator", and #48/#49/#51/#52/#56/#58.

## D125, Wave B: batten rule everywhere, Grid scopes/layers, Grid curtains (2026-07-27)

Jeff answered the four gating questions from D124 through the structured prompt. Two of his
answers were wider than the question asked, so they are recorded verbatim.

**Batten length, his words:** *"Keep this for all tools as I think it is wrong everywhere. It is
Pro Width, plus 2ft on each side, so 4ft total. Track that into the estimator and anywhere else
where pipe width is calculated."*

- One helper, `battenLenFt(proWidthFt) = proWidthFt + 4` with `BATTEN_OVERHANG_FT = 2`, lives in
  `src/lib/design/venue-dims.ts`. Every consumer calls it, so there is a single definition.
- Callers: `steel.ts` `DEFAULT_WEIGHTS.battenlen` (was a bare 44, which was right only for a 40 ft
  opening and wrong for every other one), the lineset builder's weight paths, and the estimator's
  Pipe BOM rows in `quick/engine.ts`. The per-line manual override still wins.
- **Scenery track now follows the pipe rule too** (Jeff's call), previously priced off raw stage
  width.
- **Deliberately NOT changed, and why:** the acoustic shell ceiling (`goods.ts shellGearLb`) is a
  panel AREA, not pipe, and a ceiling overhanging the opening would be wrong; the aircraft-cable
  run (`quick/engine.ts`) is grid geometry from loft block to head block; loft-block spacing is a
  count rule; and the Steel Calculator's Length field is a standalone engineering input with no
  venue context to derive from.
- **Non-proscenium rooms:** Jeff's call is pipe spans the entered room width with NO overhang, so
  the rule is gated on `kind === "proscenium"`. The underlying bug stays open: `venueDimsFromEstimator`
  maps `width` to `proWidthFt` for EVERY venue kind, but that field is wall-to-wall for
  church/flat/blackbox/arena and sideline-to-sideline for gym, so those rooms oversize drapes today.
  Not fixed here because it moves prices on live estimates.

**Lineset three-input reduction.** Venue inputs are now PRO width, PRO height and stage depth
(plus the depth inches remainder, kept because the 8 inch slot grid is depth-driven). `stageWidthFt`
and `stageWidthIn` are removed from `LinesetInputs` entirely rather than hidden: leaving a stored 0
behind would have frozen the status line with no input left to fix it. Saved designs load through
`normalizeInputs`, which copies key-by-key off the defaults, type-checks each value and silently
drops retired keys. The nine rule constants in the settings drawer stay: they are rules, not
venue dimensions.

**Grid scopes, his answer: his five as a Grid-specific list.** `src/lib/design/grid-scopes.ts` maps
catalog groups and trades onto Lighting / Rigging / Curtains / Audio / Video with a named `Unscoped`
catch-all. **Trade "AV" is deliberately not auto-mapped**, because it forks into both Audio and Video
and the trade alone cannot say which; those rows land in Unscoped until someone maps the category in
the Catalog screen, which is an existing seam. `PartLite` gained `trade`, without which every piece
of rigging hardware would have been Unscoped.

**Layer visibility is view state, not design state.** Hidden layers are namespaced keys
(`scope:Lighting`, `cat:Followspots`) so a user category cannot collide with a scope. Not persisted,
never in a revision. Every canvas gesture reads the visible set rather than all placements, so a
hidden marker cannot be grabbed by the #47 drag, and the selection is derived with a visibility
guard rather than cleared in an effect, which would have raced `router.refresh()`.

**Grid curtains, his answer: a priced line like the estimator.** A curtain is a `GridPlacement`
carrying a `curtain` subdoc, so drag, nudge, spaces, revisions and delete need no second code path.
Cost basis stays server-side: the editor prices through the customer-safe `curtain-geom` mirror from
precomputed sell rates, and never imports `design/curtain-pricing`. `bomLines` skips curtain
placements so the fabric part is never double-billed. On a customer-facing quote a curtain's sku is
`CURTAIN`, since a placement id in front of a client would be nonsense.

**Verification.** Browser-verified on a restored dev database with blob storage disabled: the batten
rule (PRO 60 gives 64 ft battens and every weight recalculates), the arrow-key move and its
persistence across a reload, the layer toggle (hiding Curtains removed the marker but not the BOM
line), and a 64 x 8 ft Border at 50% fullness pricing to 768 sq ft sewn / $2,788 onto the BOM.
**Not verified: the mouse-drag gesture**, because the automation cannot emit press-move-release with
intermediate motion and the 4 px threshold requires it.

## D126 — Roster corrected to the real Peak team (2026-07-29)

Jeff: *"remove all users minus myself and then reupload new users for the people including
chris and use their emails as first name and first letter of last name."* The email pattern he
describes is exactly the D118 derivation (`emailFor`: jeffc@, chrism@, …), so no email code
changed — this is a roster-content correction.

- **The prototype roster carried two prototype-era names** — "Jena Tolksdorf" and "Jack
  Hamilton" — that are not on the real team. The real roster (per the contacts source of truth
  in Jeff's memory tree) is: Jeff Chesebro (Admin/Estimator), Nic Trapani (Estimator), Jason
  Keagy (Estimator), Isaac Mittlesteadt (Reviewer), **Chris Mittlesteadt (Owner/Founder — NEW,
  seeded as Manager)**. Chris as Manager (approve/create/send, no user management) is a default
  Jeff may want to revisit; Jeff stays the sole Admin.
- **Implemented as a sync, not a literal delete-all-and-reinsert:** returning members keep
  their ids (`u2` Nic, `u5` Jason, `u6` Isaac in the live DBs) so existing assignment/review/
  queue references don't dangle or misattribute if ids were reused. Prototype-era rows are
  deleted; Chris is inserted with the next free id. End state is identical to Jeff's ask.
- `scripts/sync-team-roster.ts` applies it to a live DB (db-target rails; hosted needs
  `--yes` + a prior `db:export`). Lockout guard: aborts if Jeff's row isn't found, never
  deletes it, never touches his roles, and re-asserts his `googleEmail` so Google sign-in
  can't break mid-sync.
- Seed fixtures re-cast the retired names by permission shape: Jena→Chris (creator roles),
  Jack→Isaac (reviewer/decidedBy fields), so demo review flows still name people who hold the
  needed permissions. IDENTITY drops the retired names; Chris inherits the freed #3155a8.
- Mike and Andrew (site-visit names in contacts) are NOT added: no last names on record, so
  no D118 email can be derived. Add via Settings → Team when known.

## D127 — Row-level Remove on Team & Roles; ⏻ was masquerading as remove (2026-07-29)

Jeff: *"When I remove people they don't go away so that is the first problem."* Reproduced the
full flow live: the `removeUserAction` path works — the defect was UX, not data. The only
removal-looking control on a member row was **⏻, which DEACTIVATES** (row stays, greyed, with
a badge); actual removal was buried in the Roles modal footer. So "removing" someone visibly
did nothing.

- Each non-self row now carries a red **✕ Remove from team** button with a **two-step inline
  confirm** ("Remove {first name}?" / "Keep") — inline because `window.confirm()` throws
  silently in this app (D96) and would have reintroduced the exact do-nothing symptom.
- ⏻ keeps its deactivate semantics (the invite-list model needs it) with the tooltip now
  saying what it does: "Deactivate — keeps the row, blocks sign-in". Self-removal stays
  impossible (no ✕ on your own row; server action also refuses).
- Actions column widened 130→175px for the third button. Modal-footer Remove kept.
- Verified live end-to-end: add dummy → row ✕ → confirm → row gone, no error; Keep cancels.

## D128 — Roster is the original six PLUS Chris; everyone-but-Jeff gets every role (2026-07-29)

Corrects D126's roster call. The prod users table told the real story of Jeff's manual cleanup
attempt: he'd DEACTIVATED u2–u6 (the ⏻-as-remove problem D127 fixed), then re-added Jena
Tolksdorf and Jack Hamilton with D118 emails, a second Jeff row, and a "Chris Middlesteadt"
(misspelled) he then deactivated. So Jena and Jack are REAL team members, not prototype-era
names — D126's removal of them was wrong and is reversed (seed fixtures restored to their
original casting; IDENTITY back to six + Chris, who moves to #2f6f8a so Jack keeps #3155a8).

Jeff's explicit picks (structured prompt, 2026-07-29): roster = **all seven** (Jeff, Nic, Jena,
Jack, Jason, Isaac, Chris Mittlesteadt — contacts-verified spelling), and **everyone besides
him holds all four roles**, matching what he'd set manually. He stays Admin/Estimator.

`sync-team-roster.ts` grew duplicate handling for exactly the mess above: canonical row per
person = Jeff's own row for the owner, else the lowest-numbered id (references survive);
non-canonical rows (dupes, misspellings, off-roster names) are deleted BEFORE emails are
reassigned so unique(email) can't trip on the hand-created jeffc@/jenat@/jackh@/chrism@ rows.

## D129. Rentals module (2026-08-07)

Equipment inventory stored as doc-store collections (equipment_items,
equipment_locations, equipment_bookings), matching catalog_parts/repair_jobs —
not new relational tables as the initial design spec sketched. Permissions
reuse the existing closed create/send/approve set rather than adding
manageRentals/viewRentals — nothing else in the app perm-gates by module. See
docs/superpowers/specs/2026-08-07-rentals-module-design.md and
docs/superpowers/plans/2026-08-07-rentals-module.md.

Two implementation notes beyond the plan's own text: (1) `@/db/doc-store` has
no `mergeUpsertDoc` helper — `equipment-items.ts`'s `mergeUpsert` follows
`catalog.ts`'s existing pattern instead (get + shallow-merge + full
upsert), which is also how `catalog.ts`'s own `mergeUpsert` is built. (2) the
three new doc tables got their own `..._seq_bump` BEFORE UPDATE triggers
(migration 0014, following 0012's documented pattern for tables added after
it) — without one, `upsertDoc`'s onConflictDoUpdate branch (i.e. every
re-upsert of an existing item, e.g. a rate change) would leave `seq` stale
and silently break pull-sync's cursor query for these collections.

## D130. Rentals module — whole-branch review fix pass (2026-08-08)

Three call-outs from closing punch #93 (the pre-merge review across all nine
Rentals tasks), each a deliberate boundary rather than an oversight:

1. **Stock editing, not location editing.** The item edit form
   (`src/app/(app)/rentals/page.tsx`) gained a "Stock by location" section —
   a numeric qty input per existing `equipmentLocations.list()` row, wired
   through `actions.ts`'s `upsertEquipmentItem` into the item's
   `stock: Array<{locationId, qty}>` (both create and edit, edit still via
   `mergeUpsert` per Task 4's pattern). This closes the real gap: new items
   (hub-created or CSV-imported) were born with `stock: []` and so were
   permanently unbookable.
   **Addendum (final review round 2, punch #93):** locations had zero way
   to exist outside the demo seed — which never runs on a hosted deploy and
   gets wiped by the go-live reset even in dev — so `upsertEquipmentLocation`
   sat unused and the stock editor above never had a location to show. The
   Rentals hub now has a minimal "+ Add location" modal (name + optional
   address) that calls it directly; locations are created via the Rentals
   hub, no CSV import path (there are only 10 import types and
   `equipment_locations` isn't one — a real location-CRUD screen with
   edit/delete is still out of scope). The same pass also guarded
   `upsertEquipmentItem`'s `stock` field: it's now only included in the
   `mergeUpsert` patch when at least one location exists, so editing an
   item's rate in a location-less DB no longer silently wipes stock that
   arrived via another route (e.g. a sync pull).
2. **Task 6's PDF letter route has no reference to mirror.** As documented
   in its own header comment
   (`src/app/(app)/rentals/quote/letter/route.ts:10-27`), no existing page
   calls `renderLetterPdf()` directly — the closest analogs
   (`/flame-tests/letter`, `/inspections/letter`) are print-styled HTML, and
   the only real `renderLetterPdf`/`LetterDoc` caller is
   `lib/renewal-outreach.ts`'s `flameLetterDoc()`/`inspectionLetterDoc()`,
   built to attach to an email, never served over HTTP. The route was
   synthesized from that pattern plus the generated-Buffer-to-Response
   wiring `/api/spec/[id]/docx/route.ts` already uses, not ported from an
   assumed reference screen that turned out not to exist.
3. **`quotes.ts`'s `rental` field is in-pattern, not scope creep.** Task 5's
   file list didn't call out `src/lib/stores/quotes.ts`, but adding
   `rental?: unknown` to the `Quote`/`QuoteRevision` types and threading it
   through `create()`/`snapshotOf()` was required — `consulting` already had
   this exact shape, and a rental quote builder with nowhere to persist its
   line items isn't a working builder. `restoreQuoteRevision` was missed in
   that pass for both `rental` and pre-existing `consulting` (recalling a
   revision silently left the line items ahead of the recalled name/value);
   fixed in this same review pass.

Also fixed in this pass, all flagged by the whole-branch review: nav-data.ts's
new `rentals` PM child had no hub-facing route to reach `/rentals/board` or
`/rentals/quote` from (the hub header now links both, mirroring
`repairs/page.tsx`); `approveRentalQuote` in
`src/app/(app)/rentals/quote/actions.ts` checked `requirePerm("send")` AFTER
`persist()` had already written the quote; the three rentals stores
(`equipment-items.ts`, `equipment-locations.ts`, `equipment-bookings.ts`)
minted ids via a read-then-write `${prefix}-${all.length + 1}` count, a
concurrent-write race — swapped to `insertWithPrefixedId` (D73's helper,
same as `quotes.ts`); and the booking board's empty state linked to `/rentals`
(the inventory hub) instead of `/rentals/quote` (where quotes are actually
created).

## D131. Team member contact card + archived/removed status (2026-08-08)

Punch #9, decisions A/C/D (all answered by Jeff 2026-07-19, built now).
`users.active` (boolean) replaced with `status` ('active' | 'archived' |
'removed') — archived and removed both block sign-in and drop out of
active-roster pickers (`activeUsers()`); removed also hides the row from the
Settings team list by default (a "Show N removed" toggle is the escape
hatch — restore sets status back to 'active'). Neither ever hard-deletes:
`removeUser`'s old `db.delete` is gone, matching finding 6's own
recommendation (members are joined by NAME string all over the app; a hard
delete would orphan every historical record that named them). Migration
0015 adds the new columns and backfills `status='archived'` for existing
`active=false` rows BEFORE migration 0016 drops the old column — generated
as two separate `db:generate` passes because drizzle-kit's interactive
rename-detection prompt can't run in this environment (add-only diff, then
drop-only diff, avoids the ambiguity entirely).

Contact-card fields added: `title`, `phone`, `mobile`, `officeId`,
`certifications`. `officeId` drives decision D — the signature-block phone
on the two documents that actually show one (`repairs/report/report-doc.tsx`,
`flame-tests/report/report-doc.tsx`) now resolves from the SIGNER's assigned
office, falling back to `offices[0]` only when unassigned, instead of always
reading `offices[0]` regardless of who signed. Office phone is now editable
in Settings → Locations (was passthrough-only — the field existed on `Office`
but no UI ever wrote it).

Scope cut, deliberately: finding 1 (the `roles[0]`-as-title hack producing
"Admin" as a job title on some documents, "Estimator" on others) was NOT
promoted to an answered decision on this punch item — only decision D
(phone) was. `title` is stored and shown in the contact card, but the six
"single-page" letter templates (results/summary/completion/warranty ×
repairs/flame-tests/inspections) that use `_letters/util.tsx`'s
`officePhone(settings)` were left untouched — they don't currently resolve
a per-signer user at all, so wiring them in is a separable, larger task, not
this one's scope.

## D132. Venue Assessments unify field sheets and advisory assessment (2026-09-20)

Field Surveys is now Venue Assessments: one `FS-####` record and the
`/venue-assessments` route contain a required site-visit layer plus an
optional Condition & Needs advisory layer. The legacy route redirects and
ids remain unchanged. `venueClass` (theatre, auditorium, church, gym,
convention, other) and class-specific `venueSubtype` replace the old flat
venue-type input on read, while preserving the legacy field and all existing
measurement keys. Visit purpose likewise adopts the paper-sheet list through
read-time migration.

The five supplied field sheets are folded into the four existing discipline
branches. Each branch uses the sheet's PRESENT row as its gate; the old Tier-3
yes/no editor is retired without deleting its stored data. Theatre and
auditorium use one unified lineset table (toggleable for any class), with the
paper G/F/P/X condition legend kept distinct from the assessment's
Good/Monitor/Replace scale. Venue-class Curtains and Lighting doctrine lives
in Estimating Rules; Theatre and Church defaults remain visibly unconfirmed.
Flame-test and rigging-inspection references auto-resolve only for the exact
customer/location and allow manual override.

Monitor/Replace ratings seed one advisory finding per category; findings can
be merged or split. They do not create quotes or repair jobs automatically:
the supplied brief says budget tiers are planning guidance, not a quote, and
the existing explicit Create quote path remains authoritative. Close-out has
Peak rep, site contact, and optional technical-reviewer lines, and every
record stamps its template revision. A class-aware PDF field sheet is in
scope; the customer-facing report remains deferred until the intake has been
field-tested.

Two defaults were explicitly accepted as non-blocking: advisory findings do
not auto-spawn work, and `other` remains the sixth generic class for arenas,
outdoor/amphitheater, and venues without a dedicated paper sheet.

## D133. Offline navigation caches opened routes and fails honestly (2026-09-20)

Quartzite uses the "go back and keep working" offline model rather than
silently downloading the entire office database. Every route actually opened
by the user is snapshotted as a full HTML document, including routes reached
through Next client navigation; meaningful query state such as estimator ids
is retained. RSC transport payloads, API responses, auth redirects, and login
pages are never allowed to overwrite that document cache.

If a user attempts a route that has never been opened on the device, the app
shows an explicit offline page with **Go back** and **Try again**. It no longer
serves the cached dashboard under an unrelated URL. The sync panel states the
contract directly: captures save locally, opened pages/jobs remain available,
and Back returns to cached work.

## D134. Fixture configurations are catalog-backed assemblies (2026-09-20)

The hardcoded fixture/preset selector from IDEAS #43 is retired. The Design
area now owns an Assembly Builder whose records are full-replacement app
settings: an assembly name plus catalog SKUs, a user-facing component label,
a role, and a non-negative default quantity. Quantity zero deliberately means
"offer this option when configuring the fixture, but do not include it by
default." No sample assemblies are seeded; Jeff's production catalog import
will supply the real parts.

The Estimator selects only saved assemblies. It produces one clean customer
line named from the assembly and its user labels, while retaining an
orderable component array with SKU, role, quantity, unit, cost, and sell.
Quick Design's five auto-fixture buckets can each select one of the same
assemblies; the BOM then uses the assembly name and current catalog cost.
Missing catalog SKUs remain visible as missing rather than silently falling
back to invented fixture data.

## D135. New estimates are clean, margin-seeded material documents (2026-09-20)

Opening `/estimator` without an id now creates a clean unsaved estimate; it no
longer opens Q-2041 or sample systems. New systems begin at 2% freight, and
catalog selections seed unit sell from the customer's pricing tier or the 30%
base margin. Manufacturer remains catalog/item metadata and is no longer a
system-level estimator control.

The internal material grid uses Unit cost, Unit sell, and Ext. sell. Vendor
quotes and material lists share one client-side CSV import with a downloadable
example; each row may carry an optional product link. File selection is a
visually explicit button and imported rows report added/skipped counts.

Payment terms are one persisted choice: Deposit with terms, 100% prepay, Net
30, Net 60, or Unknown. Customer-preview line detail groups quantities,
descriptions, and prices; switching all three off removes the line rows. Quote
display controls are a left sidebar on desktop and collapse above the document
on narrow screens.

## D136. Labor uses scheduled days, crew hierarchy, and explicit adders (2026-09-20)

The labor configurator opens with Site Visit 1×1, Install 4×5, Hang 2×3,
Commissioning 2×3, and Training 1×1. Scope defaults from the system title;
Audio and Video share one scope, and unmatched systems use Other. Each
mobilization chooses 8–12 hours/day: the first eight are regular and every
additional hour is overtime for the full crew.

The first person in every non-empty crew is billed at the supervisor rate and
the remaining people at the discipline's installer rate; a supervisor is no
longer added on top of headcount. Site Lift is named Lift rental, uses one
rental per five scheduled days, and permits a per-mobilization rate override.
Drafting defaults to 2% of total regular crew hours. A visible 5% performance
bonus is calculated from pre-bonus labor cost, then added as its own priced
line so estimate totals and the configurator agree.

## D137. "Move system" — sibling of Delete system on the Estimator (2026-09-20)

Each system card gets a "Move…" control next to "Delete system" that sends
that one `SpecSection` to a brand-new estimate or an already-saved one, via
a live-search picker (substring match on name/customer; an empty query
shows the most-recently-updated estimates rather than nothing, so the
picker isn't empty on open — same judgment call as elsewhere in the file).

The moved section's id is regenerated (`"sys" + Date.now()`) so it can never
collide with an id already in the target. A new target estimate is named
"`<system name>` (moved)", status `draft`, source `estimator`, and carries
the source estimate's customer/location/contact forward — it does not start
blank, since that would silently lose which job it belongs to. An existing
target keeps its own name and mobs; the moved section is appended to its
`spec.sections` and `value`/`margin` are recomputed from the merged list.

The move never touches the source estimate server-side — removal from the
source is a local `setSections` change exactly like "Delete system", only
persisted there when the user next hits Save. On success the UI does not
navigate away (the source estimate may hold other unsaved edits); it shows
a dismissible "Moved to `<name>` — Open `<name>` →" banner instead, mirroring
the existing action-error banner pattern in `estimator-client.tsx`.
## D138. Guided "new quote" intake screen (`/quotes/new`)

The "+ New quote" split menu's six links (`quotes/controls.tsx`) now all
route through a new `/quotes/new?type=<...>` screen instead of straight into
a blank builder — same six type entries (label/sub-label/badge, ported
verbatim into `quotes/new/types.ts`'s `SERVICE_TYPES`), no new taxonomy.
`system` used to go straight to `/estimator` with nothing else pre-set;
`flame_test` used to go to `/flame-tests` (the dashboard, not even the quote
builder — an existing inconsistency with its four "Auto"-badged siblings,
now fixed as a side effect since every type routes through the same intake
first).

Three-step wizard (customer → venue → contact), reusing the catalog
manufacturer-picker's known-values-plus-trailing-sentinel `<select>` pattern
(`catalog/controls.tsx`) rather than building a new picker component:
- **Customer**: name-substring filter over the full directory (matches
  today's few-hundred-row customer list; not paginated/debounced — revisit
  if the directory grows enough for that to matter) plus a "+ Add new
  customer…" sentinel that reveals inline name + type fields. Picking a
  customer resets the venue/contact steps back to "skip" (their options
  depend on which customer is selected).
- **Venue / Contact**: only rendered once a customer is picked or being
  created. A customer with zero existing locations/contacts skips straight
  to the inline add-new fields (no picker with nothing in it). Otherwise the
  picker's sentinel options are "+ Add new venue…" / "+ Add new contact…"
  and a "Skip for now" option, selected by default — this flow's whole point
  is not to force venue/contact entry salespeople don't have yet. Quick-add
  can be submitted with only the required field filled in (venue label,
  contact name) — city/state/role/email/phone are all optional, matching
  the looser bar `saveCustomerAction` already accepts for these fields.

Submit resolves through `saveCustomerAction` (no parallel customer-creation
code path): existing customer's `locations`/`contacts` arrays are read via
`stores/customers.get`, any new venue/contact is appended (`primary` only
when the array was previously empty — never demotes an existing primary),
and the whole record round-trips through the same upsert the Companies
screen uses. The action then redirects to the type's builder with
`?customer=<id>` — same convention the other five builders already read
(`preCustomer`); `estimator/page.tsx` was the one builder that didn't
support it yet, so it gained the same handling repairs/quote/page.tsx uses
(seed `customerId`/primary `locationId`/primary `contactName` into
`initialFrom`'s `InitialQuote`, only when there's no `?id=` — an explicit
edit always wins).

## D139. Grid Manual mode's Scope panel reuses Quick Design's cost-bearing estimate engine (2026-09-20)

Manual mode's new Scope panel (D-manual-scope-targets spec) computes its
Good/Better/Best $ targets by running the SAME `compute()`/`tierSystems()`
pipeline Quick Design's Auto estimate already uses, per the design spec's
explicit direction ("Both Auto and Manual... run that input through the
same compute()/tierSystems() engine"). `engine.ts` bakes in cost data
(`SEED_FABRIC_RATES`, `TIER_SKUS`) at module scope for Quick Design's own
client bundle already; pulling `ScopeInputsPanel`/`ScopePanel` into the
Grid editor now ships that same cost data in the Grid bundle too — crossing
the sell-only boundary `grid/[id]/page.tsx` otherwise deliberately protects
("SELL numbers only - the margin and the cost basis stay on the server").

Accepted as-is rather than building a parallel sell-safe target engine:
anyone who can reach Manual mode can already reach `/design/quick` and see
the same numbers today, so this doesn't create a new exposure, only a
second place the existing one shows up. Revisit if Manual mode ever gets a
permission boundary Quick Design doesn't have.
## D174. Quartzite native shell — Capacitor remote/hybrid Phase 1 (2026-09-20)

*Renumbered 2026-09-22: this entry and D132 (Venue Assessments) were both written as D132 on
2026-09-20. D132 keeps the Venue Assessments meaning — it holds the earlier position and
`docs/superpowers/plans/2026-08-18-venue-assessments.md` cites it that way. Citations of the
native shell were repointed here.*

The mobile transition brief confirms a native wrapper via Capacitor, distributed
through TestFlight/App Store, with full offline-first field capture and mobile
work starting in parallel with the web roadmap. Phase 1 is now represented in
the repo as generated iOS + Android projects plus `capacitor.config.ts`.

- The shell loads the hosted Quartzite app (`https://quartzite-six.vercel.app`)
  through Capacitor's remote/hybrid `server.url` model. This preserves Next
  server components, server actions, Auth.js cookies, and the existing PWA
  sync engine; a static-export rewrite is explicitly out of scope.
- `CAPACITOR_SERVER_URL` is an optional local/preview override. The native
  fallback in `native-web/index.html` exists only because Capacitor requires a
  `webDir` with an `index.html`; it is never used while the remote URL is
  reachable and is not a Next route.
- The application id is `com.peaksystemsgroup.quartzite` for both platforms.
  Native-only integrations must stay behind `src/lib/platform.ts` so browser
  builds remain unchanged. BLE, camera, push, signing, and store submission
  remain later phases and require device/account decisions.

## D141. Merge-regenerated migrations are written idempotently (2026-09-21)

`0018_clever_maverick` — the migration drizzle-kit regenerated when
`session/pensive-swift-b0f7` merged into main — failed on the production
deploy of 45a7614 with a bare `Command failed: npx drizzle-kit migrate`.

Cause: on Vercel, `DATABASE_URL` is scoped to **Production, Preview and
Development** — one Neon database for all three. Every green preview build
runs `npm run build`, so it runs `scripts/migrate.mjs` against the live
production database. The session branch's preview deploys had therefore
already applied its own `0017_neat_killmonger`…`0021_true_dark_phoenix`,
creating `grid_catalog`, `subassemblies`, `sites.location_name`,
`users.last_login_at` and `users.previous_login_at` in production weeks
before main knew about them. The merge re-expressed that same DDL as one
new migration with a later `when`, and drizzle selects work by timestamp
(`drizzle-orm/pg-core/dialect.js`: `created_at < folderMillis`), not by
content — so it ran `CREATE TABLE "grid_catalog"` against a table that
already existed and died on 42P07.

Decisions taken:

- **The migration is hand-edited to `IF NOT EXISTS` DDL** rather than
  repaired by hand-inserting bookkeeping rows into Neon. The same file is
  then correct against both the production database that already has the
  objects and a fresh one (`db:reset-local`, CI, a new Neon branch), and it
  survives the partially-applied state a failed run can leave behind. It is
  safe to edit in place because the migration was never recorded as applied
  anywhere: production failed on it, and local PGlite is disposable.
- **The dropped `seq` triggers are restored in the same migration.**
  drizzle-kit does not manage triggers, so regenerating these two tables
  from `schema.ts` silently lost the `BEFORE UPDATE ..._seq_bump` triggers
  the session branch had written by hand. Any fresh database built from
  main would have had a stale `seq` on both collections, which breaks
  pull-sync's `WHERE seq > cursor` exactly as 0012 and 0014 describe —
  a data bug with no visible symptom until a client silently stops seeing
  changes. Postgres has no `CREATE TRIGGER IF NOT EXISTS`, so these are
  written drop-then-create.
- **`scripts/migrate.mjs` calls drizzle-orm's migrator directly** instead of
  shelling out to `npx drizzle-kit migrate`. Identical bookkeeping (drizzle-kit
  drives that same code path), but drizzle-kit renders the failure inside its
  spinner and exits 1 with empty stdout/stderr — the deploy was undiagnosable
  for a full cycle. The real Postgres code, message and failing statement now
  reach the build log.
- **Not changed, needs Jeff:** preview and development deployments still write
  to the production database. That sharing is what let an unmerged branch
  migrate production, and it also means any preview app is reading and writing
  live records. Giving Preview/Development their own Neon branch is a Vercel
  environment-variable change on the account, so it is left for Jeff to make.

`scripts/diagnose-prod-migrations.mjs` (read-only) prints what the target
database believes is applied and whether a pending migration's objects already
exist — run it before trusting a migration against production.

## D140 — Inbox customer linking, Wave A (2026-09-21)

PUNCHLIST #96, spec `docs/superpowers/specs/2026-09-21-inbox-customer-linking-and-label-sync-design.md`.
Defaults taken while building Tasks 1–8 (branch `feat/inbox-linking`):

- **Contact match links; domain match only suggests.** `applyResolution` never sets `customerId` from a
  domain claim — the thread lands as `suggested` until someone clicks Link. Ambiguity (two live customers
  on one address or one domain) never guesses.
- **Deleted contacts/companies never resolve.** `contactByEmail` filters `deleted`, orders by
  `updatedAt desc`, and returns *ambiguous* when live rows map to two customers (the old doc scan could
  auto-link a re-added person to their previous employer).
- **`resolution` stays inside the comms JSON document** (spec §4 said a promoted hot column). Volumes are
  hundreds of threads; the Unmatched view is a filtered scan like every other Inbox view. Promote when it
  measurably hurts.
- **`customer_domains` pk is (domain, customer_id)** so a shared district domain can legitimately have two
  owners (→ ambiguous). A learned claim is inserted with `WHERE NOT EXISTS`; under concurrent learned
  claims the worst case is two owners (ambiguous), never a wrong link.
- **Remember-address reuses before minting**: same address on a live contact wins, then a case-insensitive
  display-name match on the customer, else a new contact. The name-keyed customer save would otherwise
  soft-delete one of two same-name contacts.
- **Domain claims are undoable** from the linked card ("Stop"), and the Unknown card offers "Link thread
  only" so a consultant/architect domain that writes about several schools is never claimed by accident.
- **App-created threads resolve on `create()` too** (Compose, Log call); the sync backfill only covers
  Gmail-bridged threads, and the Unmatched view treats a missing `resolution` as unknown.
- **Per-sync backfill is batched** (two `IN` queries over the unlinked set) so it stays inside the 60 s
  route budget alongside the #97 import chunks.
- **Quote intake's `toLocationInput` dropped `locationName`** — fixed in the Inbox copy; the intake's own
  copy still does (follow-up).

## D142 — Inbox two-way Peak/* labels, Wave B (2026-09-21)

PUNCHLIST #96 Wave B, spec `docs/superpowers/specs/2026-09-21-inbox-customer-linking-and-label-sync-design.md`
(commits 5c0009c…03dc77b on `feat/inbox-linking`). Gmail labels are now a two-way command surface,
built on Wave A's linking (D140).

- **Namespace.** The app owns everything under `Peak/`; nothing outside it is read or written.
  `Peak/Customers/<name>`, `Peak/Status/{Needs reply|Waiting|Done}`, `Peak/Assign/<First>`,
  `Peak/New lead` (command only), `Peak/{Projects|Leads|Quotes}/<id>` (work links). A customer whose
  name contains `/` is written and matched with `/`→`-`; the interpreter matches back through the
  **same sanitiser** (sanitised-name comparison, never raw equality).
- **Peak → Gmail** is derived, not stamped: the "current" label set is the union of `Peak/*` names
  across every message that carries `gmailLabelIds` (never a single message), so a Peak-side reply
  can't blank the set and leave a stale `Peak/Status/*`. Labels are created lazily and sequentially
  per mailbox (one cache load, one refresh after all creates; a 409 → refresh + re-lookup), and one
  `messages.modify` per thread applies the diff. Every store mutation of customer/status/assign/link —
  and `linkThread` — funnels through a **bounded serial queue** (`queueLabelSync`) that coalesces
  repeat calls per thread and dequeues at the start of a turn so a mid-flight change re-queues one
  trailing sync. Gmail fetches carry a 20 s timeout so one hung socket can't stall the chain.
  Label writes queued from server actions are best-effort on serverless (no `waitUntil`); a
  dropped write self-heals on the thread's next mutation, and a blanket cron reconcile of label
  drift on dormant linked threads is a logged follow-up (#98).
- **Gmail → Peak.** The incremental history sync now returns `labelAdded`/`labelRemoved` events;
  the interpreter **collapses them per thread** (Gmail emits one record per message; added wins over
  removed) so labelling a whole conversation is one command, then applies it through the same store
  functions the UI uses. Only additions are commands, except a `Peak/Customers/<name>` **removal**
  matching the current customer, which unlinks. `Peak/New lead` creates exactly one lead (guarded by
  the thread's existing `lead` work-link, independent of the label swap's success) and swaps the label
  to `Peak/Leads/<id>` so it can't fire twice. Unknown/ambiguous customer or assignee → log and skip,
  never guess (assignee requires exactly one active-user first-name match).
- **Echo suppression.** An interpreter-applied change stamps `peakLabelsAppliedAt`; the writer's 2-min
  window then treats the label Gmail echoes back as already-in-sync and skips it. Commands are
  idempotent to a fixed point, so the window boundary at worst causes a redundant no-op, never a loop.
- **Conflict rule:** last write wins by timestamp; same-second collisions resolve in Gmail's favour.
- **Cadence:** the interpreter runs inside the existing sync (open-tab tick ~2 min, cron every 5 min
  once `CRON_SECRET` is set). Gmail push (Pub/Sub) remains a later phase.

## D143. A user-defined quote category is a label on a system quote, not a new quoteType (2026-09-21)

Punch #110 asked for "a service category by default and then a user defined
category" on the intake. The six service types stay the default categories;
the new "Custom category" card on `/quotes/new` produces an ordinary
`quoteType: "system"` quote with a free-text `category` on the document.
Every branch that switches on `quoteType` — edit links, the #22 type filter,
badges, the service builders — keeps working untouched, and the Quotes hub
shows the category as a neutral badge only where no service badge applies.
The field is editable from the Estimator's "Prepared for" bar and persists
through the same meta path as the customer/venue/contact picks.


## D144. `/venues` adopts the catalog page's own cap-at-200 + typeahead pattern (2026-09-21)

Punch #92 found `/venues` rendering every venue and every company with no
limit — 8.5 s / 10 MiB at 1,700 companies / 3,400 sites — and left three UX
questions open for Jeff (paginate vs. infinite-scroll vs. virtualize; a
typeahead vs. a huge company picker; whether the directory should list
everything by default at all). Rather than invent a new answer, `/venues`
takes the default this codebase already established for the identical
problem on `/catalog` (`const PAGE = 200`): existing `?q=`/`?company=`
filters narrow the set first, the result is capped to 200 rows, and a
"Showing X of Y venues" label (matching catalog's own wording) distinguishes
the truncated case from the untruncated one. No page-number links were
added — catalog's own accepted behavior is "narrow with filters," not
"click through pages" — so this stays reversible with no schema or URL-
contract change once Jeff picks a real answer.

The company filter (previously one `<Link>` chip per company, unbounded)
is now a text `<input>` bound to a native `<datalist>` of company names,
still submitting through the existing `?company=` param — no new client
component or search dependency. Because a `<datalist>` fills the typed
name rather than an id, the page resolves `?company=` against either a
known company id (old links keep working) or a case-insensitive company
name match; an unresolved value fails open to "no filter" instead of
matching zero venues or erroring.

Also removed: an unreviewed 50-per-page `?page=` paginator that had been
committed to this file from the 2026-08-11 wip snapshot (`1391cdd`) but was
never part of any reviewed change — it predates this decision and duplicated
exactly the surface #92 asks Jeff to choose between.

## D145. Punch #16 — quote-won and project-complete notify as a Home Queue task, not email (2026-09-21)

Punch #16 asked for the company to be notified when a project is sold and
when it's completed. Jeff's own alternative to automated email — "it becomes
a task/lead for an employee to follow up... for an install sale the PM
reaches out; for a project close, the salesperson follows up" — is now
built, using the existing `assignments` collection (D93, the Home Queue's
one non-derived source) rather than any email path. No new UI: an assignment
created here shows up in the Home Queue and `/api/queue` (Mac Reminders
sync) automatically.

**Assignee default: the record's `owner`.** There is no distinct PM or
salesperson role separate from `owner` anywhere in the data model (quotes
and projects both carry only `owner: string`, per PUNCHLIST #16 decision E),
so both hooks assign to the record's `owner`. This sidesteps all five of
#16's email risks (an unaudited send channel already live on a 5-minute
cron, guessed roster addresses with no correction UI, no dedupe/idempotency
marker, no email log or audit trail, and silent send failures) while still
satisfying Jeff's task-first alternative.

**Hook 1 — quote won (`src/lib/stores/quotes.ts`, `setStatus`):** fires
inside the existing one-shot guard (`if (!q || q.status === status) return
q;`), so it only runs the moment a quote actually transitions into "won,"
never on a re-save of an already-won quote. This is a genuine fix, not a
duplicate: the only prior "sold" signal (`item16:sold:<id>` in
`stores/projects.ts`, added 2026-07-25 under `724016c`) is a tasks-collection
row created lazily when a project is converted (on Projects-page load or
"Convert to project") and, per that commit, is created with **no
assignee** — invisible in the Home Queue, whose task-source filters on
`assigneeName === me`. It's left in place (still useful as a team-visible
checklist row on the project's own Tasks tab) since it never collides with
the new assignment in any shared view. The new hook is scoped to quote
types that actually become an Installs project — excludes `flame_test`,
`repair`, `inspection`, `consulting` (mirrors `syncProjectsFromQuotes`' own
exclusion list) — so a won flame-test/repair/inspection quote, which also
calls `setStatus(..., "won", ...)`, doesn't spawn a bogus "install sold"
task.

**Hook 2 — project complete (`src/app/(app)/projects/actions.ts`,
`signoffAction`):** guarded by checking the project's stage *before*
calling `setProjectStage` (`setProjectStage` has no early-return guard for
an unchanged stage the way `setStatus` does — `recordStageChange`'s
internal no-op doesn't stop the caller's side effects — so the guard lives
in the caller instead of restructuring the store function). Unlike the sold
hook, this one **replaced** rather than added to the prior mechanism: the
same `724016c` commit already spawned a tasks-collection row
(`item16:completed:<id>`) assigned to the quote's owner on entering
"complete" via `setProjectStage`, which — being assigned — already rendered
in that owner's Home Queue. Adding the new assignment alongside it would
have put two rows for the same event in front of the same person, so the
old spawn was removed from `setProjectStage` in favor of the one created by
`signoffAction`. Known trade-off: a direct stage jump to "complete" via
`setStageAction` (bypassing sign-off) no longer spawns any follow-up. That
path is PUNCHLIST #16 decision D's still-open gap — Jeff's own answer there
is that "a project must not be able to reach complete without a signoff" —
so losing notification coverage on a path that shouldn't be reachable is
preferred over duplicating it on the path that is. Enforcing that gate
(blocking `setStageAction` from setting "complete" directly) remains
unbuilt and is a natural companion to whoever picks up decision D.

**Also fixed in passing:** an assignment's Home Queue row only linked
anywhere for `link.kind === "engagement"`; `"project"` and `"quote"` fell
through to `/queue` itself. `src/lib/queue.ts` now routes `"project"` to
`/projects/<id>` and `"quote"` to `/quotes?id=<id>` (the app's existing link
convention for a quote), so both new hooks land on the actual record instead
of a dead end.

PUNCHLIST.md #16 is updated to DONE; no email, no new stores, nothing under
`src/lib/gmail/` or `src/lib/stores/comms.ts` touched.

## D146. Calendar "based out of" + auto travel-time block on scheduled meetings (2026-09-21)

Jeff: "In Calendar settings there should be an option for where you are
based out of ... when scheduling meetings with physical address it auto
adds travel time to the calendar as an event that you can remove."

- **Reused `users.officeId`** (already on the `users` table, already
  editable by an Admin in Settings -> Team) instead of a new column or a
  separate preference table. Settings -> Team's `updateMemberAction` is
  gated on `manage_users`, which most roles don't have for their own
  record, so a new self-service action — `updateMyOfficeAction` in
  `src/app/(app)/account/actions.ts` — writes `officeId` on the
  SIGNED-IN user's own row only, ever. Surfaced as a small "Based out of"
  card (`account/office-picker.tsx`) on `/account` — personal preferences
  live there, company-wide config lives in Settings.
- **Address heuristic** (`looksLikePhysicalAddress` in
  `calendar-actions.ts`): a real street address usually carries a digit
  (street number) and/or a comma (separating street/city/state); a Zoom
  link, Meet/Teams URL, or bare room name usually has neither and is
  rejected outright by an `http(s)://` / known-meeting-domain check first.
  Loose by design — false positives just mean an extra (freely-deletable)
  travel block; false negatives just mean none gets added.
- **Fallback office**: if the signed-in user has no `officeId` set, the
  travel block falls back to the quote-default office
  (`quoteOrigin()`, same office Estimating/pricing already treats as the
  default travel origin). If there is truly no office configured anywhere,
  the travel block is skipped with no error — the meeting still saves.
- **Free-text address -> coordinates**: `estimate()`'s target wants
  lat/lng, not a string, so the location is geocoded first via `geo.ts`'s
  existing `search()` (Nominatim) before calling `estimate([office],
  {lat, lng})`. `search()` already fails soft (empty array) on a network
  hiccup or an unresolvable address, which is exactly the "skip silently"
  behavior this feature needs.
- **Create only, not update.** `addCalendarEventAction` adds the travel
  block; `updateCalendarEventAction` does not regenerate one when
  `location` changes, to avoid piling up a new block on every edit with no
  reliable way to tell an address change from an unrelated edit, and no
  link from a travel block back to its meeting to find/replace the old
  one (by design — it's an ordinary, unlinked, freely-removable event).
  Logged as a known limitation, not fixed here.
- **Failure is always silent and non-blocking.** `addTravelBlock` runs
  after the real meeting event is already saved and is wrapped in its own
  try/catch — a missing office, a geocoding miss, or a Calendar API error
  never fails or blocks meeting creation.
- **`schedule/actions.ts` (crew/install board) is out of scope.** Its
  `calendarEvent()` never sets a `location` at all — those are crew shift
  bookings ("Peak crew booking for <person>. Project <id>."), not
  "meetings with a physical address" in Jeff's sense. Left untouched.

No schema/migration change — `users.officeId` already existed.

## D147. Grid Task 1 — generated base sheet (2026-09-21)

Punch #38 (Task 1 of 6, per
`docs/superpowers/plans/2026-09-21-grid-generated-base-sheet-plan.md`):
replaces the dims-blind blank-rectangle default sheet with one rendered
from the venue's actual `VenueDims`/`AState`, correctly scaled, with zero
calibration step before painting.

- **String-builder serializer, not React SSR.** New `renderPlanSvgMarkup()`
  in `plan-svg.tsx` walks the same `rects`/`lines`/`circles`/`texts`/`paths`
  arrays `<PlanSvg>` already renders and hand-builds the `<svg>…</svg>`
  markup string. Rejected `react-dom/server`'s `renderToStaticMarkup`: the
  caller is `grid-projects.ts`, a doc-store module with no request/render
  context, invoked from a plain server action at intake-save time — there's
  no natural place to renderToString into, and pulling `react-dom/server`
  into a lib module for one static `<svg>` is a heavier dependency than a
  ~40-line serializer over five already-typed primitive arrays. `handles`
  (wall/door drag affordances) are deliberately excluded — a generated base
  sheet is a static background image, like an uploaded plan; nothing on it
  drags. `var(--font-mono)` (the interactive renderer's font) can't resolve
  inside an `<img src="data:image/svg+xml…">` — that paints in its own
  isolated context with no access to the host document's CSS custom
  properties — so the static markup names `IBM Plex Mono, monospace`
  directly instead.
- **"First intake save" = `project.sheetIds.length === 0`.** `createProject()`
  no longer pre-seeds any sheet/Space at all (previously unconditional,
  before any dims existed — the literal cause of the old default being
  dims-blind); every new project now opens straight into `GridIntake`
  (`intake.complete` starts false) with an empty `sheetIds`. `saveGridIntakeAction`
  checks `sheetIds.length` on the project as it stood *before* this save:
  zero means this is the first completion, and it generates exactly one
  starting sheet — `generateBaseSheet()` (measurementBased: true) or
  `seedBlankSheet()` (measurementBased: false, "I have my own plan, skip
  measurements" — no `VenueDims` yet to render, a real upload is expected
  next). `GridIntake` has no re-entry path once `intake.complete` is true
  (confirmed by grep — `saveGridIntakeAction` has exactly one caller), so in
  practice this only ever fires once per project; the `sheetIds` check is a
  belt-and-suspenders guard rather than a state machine this build needed to
  invent.
- **Auto-calibration reuses `calibrationScale()`**, the same function the
  manual "measure a known reference" flow uses, rather than hand-deriving
  each venue kind's private pixel-per-foot constant. Every `buildPlan*`
  function's FIRST `rects[]` entry is the outer room/house floor — for a
  proscenium house that's `width + 2×wing` (the house is wider than just the
  proscenium opening); for every other kind it's exactly `width` — a
  reference that holds across venue kinds without reaching into each
  builder's private margin constants (`ML`/`MR`, not exported). The
  resulting `Calibration` is written straight onto the new sheet, so
  `findCalibration` short-circuits and nothing downstream ever prompts for
  a calibration step on it.
- **Geometry-derived starter Spaces for proscenium and church only.**
  `prosGeom()`/`churchGeom()` are already exported specifically for reuse
  (drag math), so building "Stage"/"Audience view"/"FOH · control" from
  their `.stage`/house/booth fields — normalized by the same plan `W`/`H` —
  was a genuinely small addition, and lands those three Spaces roughly where
  the real stage/house/booth actually are instead of arbitrary fixed
  fractions. The other buildable kinds (flat/conference, blackbox, gym)
  compute their room/booth geometry as private local variables inside their
  own `buildPlanFlat`/`buildPlanBlackbox`/`buildPlanGym` — there's no
  exported equivalent to reuse, and adding one for three more kinds is real
  geometry work, not a small addition. They keep the pre-existing
  fixed-fraction Spaces. **Follow-up, not built here:** export a geometry
  helper (or promote a `.stage`/room field onto `PlanData` itself) for
  flat/blackbox/gym so their starter Spaces can be geometry-derived too.
- Church's booth bottom edge (`y1 + boothH`) is recomputed locally in the
  new `starterSpaces()` rather than added to `churchGeom()`'s return shape —
  `churchGeom` already computes it as a local `yBoothBottom` it just never
  returned; changing plan-svg.tsx's own geometry function's public shape for
  one external caller felt like more churn than repeating one addition.

No schema/migration change — `generateBaseSheet`/`seedBlankSheet`/
`starterSpaces` write into the existing `grid_projects`/`grid_sheets`
doc-store collections and the existing `Calibration`/`GridSpace` shapes,
nothing new.

**Addendum (Task 3, same plan, 2026-09-21):** "real-plan-upload creates a
separate sheet" turned out to be pure UI copy, exactly as the plan's own
recon predicted — no new decision number warranted. `addSheet()`/
`addSheetAction` already append to `sheetIds` without ever touching
`placements`, and the sheet-`<select>` in `editor.tsx` already lists every
sheet by its own `name` (an uploaded sheet is already named from
`file.name` in the client's `upload()`, a generated base sheet is named
`"Generated base plan"` per `generateBaseSheet()`'s `addSheet()` call) — so
switching between a generated base sheet and an uploaded one already
worked correctly before this task touched anything. The only real gap: the
"+ Plan sheet" button gave no indication that clicking it, once a project
already has one or more sheets, adds an ADDITIONAL sheet rather than
replacing what's open. Fixed with copy only: the button now reads
"+ Additional sheet" (vs. "+ Plan sheet" when the project has none yet) and
carries a `title` tooltip spelling out that upload is additive and leaves
existing sheets/placements untouched; the sheet `<select>` gained a
`title` tooltip to the same effect once there's more than one sheet to
switch between. No stale "replace the plan" copy was found anywhere in the
Grid editor to correct — there wasn't one. No files besides `editor.tsx`
touched; no schema change.

## D148. Google Tasks two-way sync for the Home Queue (2026-09-21)

Jeff: "This needs to be implemented with google tasks... work that way [like
the Apple Reminders queue sync]." The Reminders side (D93, punch #115) only
covers Jeff's Mac; everyone else — and Jeff on days he's not near that
Mac — gets nothing. Google Tasks has a real cloud REST API, so the same
Home Queue mirror can run server-side for any team member who opts in.

- **Reuse the personal Gmail connection + incremental scope, not a new
  connection type.** `src/lib/gmail/config.ts` already has the shape for
  this exact move (D77's `CALENDAR_SCOPE`/`hasCalendarScope()`, added to an
  existing `personal:<userId>` `gmail_connections` row via
  `include_granted_scopes` so re-consenting never drops the Gmail — or
  Calendar — grant already on file). Google Tasks gets the identical
  treatment: `TASKS_SCOPE` (`.../auth/tasks`) + `hasTasksScope()`, and
  `/api/gmail/connect` now accepts `?tasks=1` alongside `?calendar=1` (both
  may be passed together). No new table, no new mailbox-key scheme — a user
  who wants Tasks sync re-runs the SAME connect flow their Gmail connection
  already uses, with one more scope appended. Shared mailboxes (sales/
  installs/info) don't get this — Tasks sync only makes sense for a person's
  own queue, and `SHARED_KEYS` is retired anyway (D-whatever retired shared
  boxes; kept empty in config.ts).
- **List naming: "Peak", matching the Reminders agent.** `scripts/
  reminders-agent.ts` defaults `QUEUE_AGENT_LIST` to "Peak". `src/lib/
  google/tasks.ts` hardcodes the same name (`PEAK_LIST_NAME`) rather than
  making it configurable — one fewer env var, and a person who ends up using
  both integrations (unlikely but possible) sees one familiar list name
  either place.
- **Two-way restricted to `source: "assignment"` items**, identically to
  the Reminders agent and for the identical reason: `/api/queue`'s own
  write-back check only allows completing `assignment:*` keys, so even a
  bug in the Tasks sync can't approve a review or close a milestone by
  checking off a mirrored task. `Assignment.doneVia` (`src/lib/stores/
  assignments.ts`) widens from `"app" | "reminders" | null` to add
  `"google-tasks"` — a type-only change, no migration; `setAssignmentDone`'s
  `via` parameter widens to match.
- **Triggered from the existing Gmail cron, not a new one.**
  `vercel.json` has exactly one cron entry today (`/api/gmail/sync`, daily
  at noon, `CRON_SECRET`-gated) — there is no 5-minute Gmail cron in this
  repo despite older doc comments describing that cadence; whatever's true
  of a hosting tier's cron limits, adding a second entry is more moving
  parts than this needs. `syncAllGoogleTasks()` (new,
  `src/lib/google/tasks-sync.ts`) runs as an extra step inside `/api/gmail/
  sync`'s existing `GET` handler, wrapped in its own try/catch so a Tasks
  failure can never fail the Gmail sync that route exists for. It fans out
  over every `gmail_connections` row with `hasTasksScope(scope)` true,
  resolving each to a team-member name via `getUser()` (the `assignee`
  convention `loadQueue()` already keys on) and calling
  `syncGoogleTasksForUser(userId)`.
- **Dedupe marker reused verbatim.** Google Tasks' `notes` field gets the
  same `peak-queue-key: <key>` line `reminders-agent.ts` writes into a
  Reminders body, re-derived from Google's list on every run — same
  debugging story across both integrations (grep the task/reminder body for
  the key).
- **Known, deliberate gap vs. Reminders: no hand-delete ledger.** The
  Reminders agent keeps a small local JSON ledger whose only job is telling
  "hand-deleted, still open" apart from "never created" (Reminders' own
  state can't distinguish them). This module has no equivalent — deleting a
  mirrored Google Task outright gets it recreated next run. Building the
  ledger equivalent here would mean a new doc-store collection (a real
  schema change) for an edge case nobody asked for; checking a task off
  (the supported, and expected, way to act on one) works correctly without
  it. Revisit if hand-deleting mirrored tasks turns out to be a real habit.
- **No schema/migration change.** Everything needed fits in the existing
  `gmail_connections.scope` string (the new scope literal) plus the
  `doneVia` type widening above (TypeScript-only). `db:generate` was not
  run.

**Files:** `src/lib/gmail/config.ts`, `src/app/api/gmail/connect/route.ts`,
`src/lib/google/tasks.ts` (new), `src/lib/google/tasks-sync.ts` (new),
`src/app/api/gmail/sync/route.ts`, `src/lib/stores/assignments.ts`,
`src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-client.tsx`.

## D149. Grid Task 2 — "generate starting layout from dims" seeds placeholder devices, not guessed SKUs (2026-09-21)

Punch #38 (Task 2 of 6, per
`docs/superpowers/plans/2026-09-21-grid-generated-base-sheet-plan.md`),
built on Task 1's generated base sheet (D147). New `seedStartingLayoutAction`
translates `compute(a)`'s real fixture/curtain quantities — the same numbers
the Quick Design BOM already prices — into real, editable `GridPlacement`s
on the base sheet, gated on `project.intake.measurementBased` and confirmed
before writing (editor.tsx's "Generate starting layout" trigger).

- **No catalog SKU is invented — placeholder placements, exactly per
  punch #52's rule.** The plan's own recon flagged this as the highest-risk
  part of the build: there is no reliable mapping from "compute() says 2
  electrics" to one specific catalog part. The Grid's own device catalog
  (`grid_catalog`/`GridSymbol`, `src/lib/stores/grid-catalog.ts`) makes this
  worse, not better — it's normally seeded 1:1 from the ~10.7k real pricing
  rows, so there is no generic "a Par" symbol to point at either (the four
  `GRID-*` generic symbols in that file only get created when the pricing
  catalog is empty, which it never is in practice). Rather than picking an
  arbitrary specific manufacturer SKU and presenting it as "the" answer,
  every seeded placement's `partId` is a stable, obviously-non-catalog
  placeholder (`grid-seed:<system-function>`, `SEED_PART_PREFIX` in the new
  `src/lib/design/grid-seed.ts`) that can never resolve against
  `parts`/`grid_catalog`. The placement's real, human label (e.g. "Par",
  "Grand drape" — reused verbatim from `compute()`'s own BOM item
  descriptions) rides on the EXISTING `category` field instead — punch
  #41/#48's "assign now, consume later" field turns out to be exactly the
  right home for "this needs a part." A user resolves one the same way they
  always fix a wrong device today: delete the placement and drop a real
  catalog part in its place (no new "reassign part" action was built — none
  existed before this task either).
  - Known, accepted rough edge from this choice: `grid-bom.ts`'s existing
    "removed part" fallback copy (`` `${partId} (removed part — no longer
    in the catalog)` ``) will show for any seeded-but-unresolved placement
    that reaches a BOM/quote screen, worded for a part that used to exist
    rather than one that never did. Not fixed here — `grid-bom.ts` and
    `createDraftQuoteAction` are Task 5's extraction target, not Task 2's,
    and copy-only. The editor's own device marker and detail panel (both
    touched by this task) DO show the friendly category label and an
    explicit "delete and drop a real catalog part here" message instead of
    that fallback — see `isSeedPlaceholder()`.
  - **Fixed on review, same day:** minting a quote before resolving every
    seeded placeholder would have gotten $0 BOM lines for them silently
    (`bomTotals` falls back to `0` for an unresolved `partId`) — the exact
    "unresolved input silently zeros a real number" shape #64 already ruled
    out for fabric weight. `createDraftQuoteAction` now hard-fails with a
    named list of the still-unresolved devices (by their `category` label)
    instead of pricing them at zero and letting a quote go out short. The
    Task-5 `grid-bom.ts`/`createDraftQuoteAction` extraction (still open)
    should carry this guard forward rather than drop it.
- **Positions reuse `buildPlanProscenium`'s own rigged-electrics/curtain
  fracs, generalized off `prosGeom`/`churchGeom`'s exported `stage` rect —
  not re-derived.** Lighting fixtures are spread across the venue's
  electrics rows at the SAME per-row fraction
  (`(electrics - j) / (electrics + 1)`) and the same within-row width
  spacing plan-svg.tsx's decorative dots use, but sized to compute()'s REAL
  per-type fixture quantity (Par/Front/Cyc/Side/Automated) instead of the
  cosmetic dot count — this is the actual "quantities become real devices"
  fix the spec asked for. Curtains reuse the exact fixed fracs
  `buildPlanProscenium` hardcodes (0.95 grand drape, 0.5 mid traveler,
  [0.74, 0.48, 0.22] border/legs, 0.05 cyc/scenery) rather than scaling with
  the BOM's depth-block-multiplied qty — those fracs are a fixed schematic
  set with no natural extension to "N more of them," and inventing new
  curtain positions would be exactly the un-founded geometry this task was
  told to avoid.
- **Scoped to Lighting + Curtains only.** Audio/Video/Rigging/Acoustical/Pit
  have no per-device position anywhere in this codebase — `buildPlan()`
  prices them as lump BOM totals, never draws an individual mark for one.
  Seeding those would mean inventing brand-new plan-view geometry from
  scratch, which is the opposite of this task's mandate. Follow-up, not
  built here.
- **Three more accepted, low-probability rough edges from review**, in the
  same spirit as the above (not fixed, since each needs meaningfully more
  machinery than this task's mandate for a cosmetic or user-recoverable
  failure mode): the curtain fracs above are copy-pasted literals rather
  than an imported reference to `plan-svg.tsx`'s own constants, so the two
  could silently drift apart if that file's schematic positions ever
  change; a dimension change followed by a re-run only ADDS the delta and
  never removes now-excess placements from a shrunk quantity (the user
  deletes the extras by hand, the same as removing any wrong device today);
  and `addPlacements()`'s single-batch `patchDoc` has no explicit item-count
  ceiling, bounded in practice only by `compute()`'s own realistic output.
- **flat/blackbox/gym/arena get a fallback stage rect, not real geometry** —
  literally the same `{x:0.2,y:0.12,w:0.6,h:0.28}` fraction
  `starterSpaces()` (D147) already uses for those kinds' "Stage" Space, for
  the identical reason D147 gave: those `buildPlan*` functions compute their
  room/platform rect as private locals with no exported equivalent to
  `prosGeom`/`churchGeom`, and reverse-engineering each one's private
  margins for a second feature is real geometry work this task didn't scope
  for either.
- **Additive re-run is a true per-instance diff, not a coarse "skip if
  anything's already seeded" guard.** Every `GridPlacement` created by this
  action carries a new `seededFrom` key (e.g. `"lighting:par:2"`,
  `"curtains:border:1"`) — stable identity independent of its position, so a
  hand-dragged seeded device is still recognized as seeded. A re-run (e.g.
  after the user edits dims and re-saves intake, changing compute()'s
  counts) diffs the freshly-derived set against every `seededFrom` already
  on the project and adds only the genuinely new keys. Never auto-deletes:
  if a dimension change means fewer fixtures are implied, the excess
  previously-seeded devices stay on the plan for the user to remove by
  hand — consistent with every other Grid mutation being an explicit,
  reversible user action (revisions are append-only; nothing here silently
  discards a prior placement).
- **New bulk `addPlacements()`, not N calls to `addPlacement()`.** A single
  seed run can place on the order of a hundred devices (fixture qty maxes
  are unbounded by the seeding logic itself, though the estimator's own
  `LIM` dimension clamps keep the real-world ceiling well under that); one
  `patchDoc` for the whole batch avoids dozens of sequential JSONB rewrites
  for one user action.
- **The client-side confirm count runs the SAME pure `deriveSeedPlacements`
  the server action does** (editor.tsx's `pendingSeed`), so the confirm
  prompt's "adds N devices" always matches what the click will actually
  write, and a no-op re-run says "already up to date" instead of silently
  doing nothing.

No schema/migration change — `GridPlacement.seededFrom` is a new optional
field inside the existing `grid_projects` JSONB doc, not a relational
column. `db:generate` was not run.

**Files:** `src/lib/design/grid-seed.ts` (new), `src/lib/stores/
grid-projects.ts` (`GridPlacement.seededFrom`, `addPlacements`),
`src/app/(app)/design/grid/[id]/actions.ts` (`seedStartingLayoutAction`),
`src/app/(app)/design/grid/[id]/editor.tsx` (trigger + confirm, placeholder-
aware marker/detail-panel labels), `src/app/(app)/design/grid/[id]/page.tsx`
(`measurementBased` passed to the editor).

## D150. Connect additional Google accounts to subscribe to their calendars — Calendar tab only (2026-09-21)

Punch #117 (new; closes the "multiple calendars" + "slide-out filter rail"
parts of #108 — the "shared team calendar" part of #108 stays open, see
below). Jeff: "We need a way to log into multiple google accounts and
subscribe to other calendars via the calendar tab only so you can sync
other calendars in one place." Distinct from D77/D76's existing "Enable
calendar" opt-in, which reads the ONE Google account already tied to a
mailbox's Gmail connection — this is about connecting EXTRA accounts (a
personal Gmail, a family calendar, a shared team calendar's owning
account, ...) purely to view their calendars, with no mail semantics.

- **New `calendar_connections` table, not a row in `gmail_connections`.**
  That table's primary key (`mailboxKey`) and shape (`historyId`,
  `initialImportDone`, `lastSyncAt`) are Gmail-inbox-import specific and
  would be actively misleading here: a calendar-only connection has no
  inbox, isn't necessarily even the signed-in user's own Peak-login
  Google account (Google's consent screen is shown with no `login_hint`,
  on purpose, so the user can pick ANY account), and is always personal to
  whoever connected it — never a shared mailbox. `calendars` (JSONB) holds
  the discovered `calendarList.list` entries plus the user's own
  visible/colorOverride prefs per sub-calendar, on the same row as the
  connection rather than a separate table: the two are always read and
  written together, and the list is small (a handful of calendars per
  account) — nothing ever needs to query one sub-calendar across users.
- **Read-only scope (`calendar.readonly`), never `calendar.events`.** This
  feature subscribes/views; it never writes an event into someone else's
  externally-connected account. `addCalendarEventAction`'s existing
  travel-time-block feature (D146) is untouched and keeps writing only to
  the signed-in user's OWN primary mailbox calendar via the existing
  `CALENDAR_SCOPE`/`gmail_connections` path.
- **OAuth mechanics reused, not reimplemented — but folded into the
  EXISTING gmail connect/callback routes with a discriminated state,
  rather than a new route pair.** `exchangeCode`/`refreshAccessToken`/
  `fetchAccountEmail` (lib/gmail/oauth.ts) are called verbatim — they were
  already generic. `authorizeUrl` gained an optional `baseScopes` param
  (defaults to `GMAIL_SCOPES`, so every existing caller is unaffected) so
  this flow can request `calendar.readonly` alone instead of the Gmail
  scope bundle. State signing is a NEW parallel type
  (`CalendarConnectState`, `signCalendarConnectState`/
  `verifyCalendarConnectState`) rather than widening the existing
  `ConnectState` — same HMAC scheme (`stateSecret()`, reused) but a
  distinct, explicit `purpose: "calendar-connect"` literal that the
  callback route checks at RUNTIME (not just via a TypeScript cast, since
  both state shapes are signed with the same secret and a valid
  gmail-connect state's bytes would otherwise also pass a naive signature
  check). `/api/gmail/connect?purpose=calendar-connect` and the existing
  `/api/gmail/callback` (which tries `verifyCalendarConnectState` FIRST,
  before its `gmailEnabled()` gate) handle both flows — deliberately no
  new redirect URI, so nothing new needs registering in Google Cloud
  Console's OAuth client; only the new scope needs adding to the consent
  screen's scope list (see "Jeff-side" note below).
- **`lib/google/calendar.ts`'s low-level fetch was generalized; its
  higher-level exports were NOT.** `gcal()`'s fetch/error-handling was
  extracted into `callGoogleCalendarApi(token, ...)`, shared by the
  existing mailbox-keyed `gcal()` and a new `gcalExternal()` that resolves
  its token from a `calendar_connections` row instead. The existing
  exported functions (`listUpcomingEvents`, `insertEvent`, `getEvent`,
  `updateEvent`, `deleteEvent`, `upsertManagedEvent`, `removeManagedEvent`)
  keep their exact signatures — widening them to accept either token
  source would have touched every caller across `schedule/actions.ts`,
  `service-calendar.ts`, `visit-invite.ts` and `calendar-actions.ts` for no
  behavior change. Instead, two new read-only exports:
  `listCalendarsForConnection`/`listCalendarsWithAccessToken`
  (`calendarList.list`) and `listEventsForExternalCalendar` (arbitrary
  `calendarId`, not hardcoded `primary`) — sharing `toCalendarEvents()`'s
  mapping logic with `listUpcomingEvents`.
- **Default visibility on connect: primary calendar on, everything else
  off.** Same "add noise gradually" reasoning as other opt-in defaults in
  this codebase — a fresh Google account can have a dozen auto-subscribed
  holiday/shared calendars, and showing all of them immediately would
  bury the one calendar the user actually wanted. `refreshCalendarList`
  (a "Refresh calendars" action in the rail) applies the same rule to any
  newly-discovered calendar on a later refresh, while calendars the user
  already toggled keep their prefs.
- **`loadAgendaRange` (`lib/agenda.ts`) gained a third `AgendaItem.source`,
  `"external"`,** carrying `{connectionId, calendarId, color}`. No dedup is
  attempted against `"google"`/`"visit"` — an externally-subscribed
  calendar is by definition not an account anything else here writes to
  or mirrors, so there's no id/iCalUID relationship to de-duplicate
  against. Independent of `gmailEnabled()`/`GMAIL_ENABLED`: a deployment
  with Gmail off entirely can still have calendar connections, since this
  feature needs only `googleConfigured()` (the shared Google OAuth client
  creds), not the Gmail opt-in.
- **Management UI: a right-side slide-out filter rail on the Calendar tab
  itself** (`calendar-filter-rail.tsx`, opened from a new "Calendars"
  button in `calendar-client.tsx`'s header) — not the Account page. Jeff's
  own phrasing ("via the calendar tab only") and punch #108's original ask
  (a slide-out filter sidebar) both pointed here directly, and the rail's
  job (connect/disconnect accounts, toggle each sub-calendar's visibility,
  pick a color) is naturally scoped to the Calendar tab rather than a
  general account setting. This closes the "toggle and add calendars" +
  "filter sidebar that slides out" parts of punch #108.
- **NOT built: a shared team calendar anyone can add events to.** Punch
  #108 also asked for "a shared calendar option that allows people to add
  the event to the shared calendar for group events" — that's a distinct,
  bigger feature (either a real shared Google Calendar someone owns, or a
  new Peak-side shared-events collection) with its own write/permission
  model, not a subscribe-only read feature. Left open; #108's entry is
  updated to reflect exactly this split.
- **Jeff-side Google Cloud action needed, same shape as every prior
  scope addition (Gmail/Calendar-events/Tasks):** the OAuth consent
  screen's scope list needs `.../auth/calendar.readonly` added before this
  works in production, the same way `calendar.events` (D77) and
  `tasks` (D148) each needed adding. No NEW redirect URI is needed (see
  above) — that part is simpler than the Gmail/Tasks scope additions were.
  For a non-Workspace ("External" user type) OAuth consent screen still in
  "Testing" mode, `calendar.readonly` is a non-sensitive/recommended scope
  Google generally allows without a verification review; if the screen has
  already gone through verification for the broader `calendar.events`
  scope, adding the narrower `calendar.readonly` alongside it should not
  trigger a new review. This is Jeff's action to confirm in his own Cloud
  console, not something verifiable from this repo.

**Files:** `src/db/schema.ts` (`calendarConnections` table,
`CalendarSubscription` type; migration `drizzle/0019_sleepy_dust.sql`),
`src/lib/gmail/oauth.ts` (`authorizeUrl` baseScopes param,
`signCalendarConnectState`/`verifyCalendarConnectState`),
`src/lib/gmail/config.ts` (`CALENDAR_READONLY_SCOPE`),
`src/lib/google/calendar-connections.ts` (new), `src/lib/google/
calendar.ts` (`callGoogleCalendarApi`/`gcalExternal`,
`listCalendarsForConnection`/`listCalendarsWithAccessToken`/
`listEventsForExternalCalendar`), `src/app/api/gmail/connect/route.ts`
(`startCalendarConnect`), `src/app/api/gmail/callback/route.ts`
(`finishCalendarConnect`), `src/lib/agenda.ts` (`AgendaItem.source`
`"external"`), `src/app/(app)/calendar-actions.ts` (connection/visibility/
color/disconnect/refresh actions), `src/app/(app)/calendar/calendar-
client.tsx` (external item rendering, "Calendars" button),
`src/app/(app)/calendar/calendar-filter-rail.tsx` (new),
`src/app/(app)/calendar/page.tsx` (fetches initial connections).

## D151. Reusable task templates for projects, quotes, and designs — assignable by person, role, or "everyone" (#118, 2026-09-21)

Jeff (verbatim): "I want to be able to add template tasks to projects, quotes, and designs that
can be assigned based on groups, people, or teams." Distinct from tasks.ts's existing
`TASK_TEMPLATE` constant, which stays completely untouched: that's a hardcoded, per-project-stage
checklist where every item is unassigned. This is a NEW, admin-editable, cross-record mechanism.

- **New doc-store collection `task_templates`** (`taskTemplates` in db/doc-tables.ts,
  `TT-###` ids from base 100), holding named, reusable `TaskTemplateSetRecord`s: `name`,
  `description`, `appliesTo` (`project`/`quote`/`design`, one set can cover more than one),
  `lines` (`{ key, title, section, target }`), and `archived` (hides a set from "Apply template"
  pickers without deleting it — a project applied months ago should keep showing where its tasks
  came from). Migration `drizzle/0020_odd_crusher_hogan.sql`, with the table's `..._seq_bump`
  trigger hand-added per the note in 0012_seq_bump_trigger.sql (drizzle-kit doesn't manage
  triggers). Not added to `SYNCABLE_COLLECTIONS`/`FIELD_COLLECTIONS` — this is admin-authored data,
  not offline field capture.
- **Assignment-target mapping — person / role / "everyone", not a real department/crew concept.**
  Grepped the `users` table (`src/db/schema.ts`) and `src/lib/team.ts` before designing this: there
  is no field grouping users into Sales/Design/Install/Service or any other "team" distinct from
  the permission-oriented `Role` enum (Admin/Manager/Estimator/Reviewer). So:
    - **person** = a specific `assigneeUserId`, exactly like a manually created task.
    - **role** = one task PER active user holding that `Role` — a fan-out, not one shared/
      unassigned task. An unassigned task shows up nowhere useful for anyone in the existing
      Home Queue / task-list model, so "assign to the Estimator role" has to mean "give every
      current Estimator their own copy," not "create one ownerless row."
    - **team / "everyone"** = the same fan-out to every active user.
  This is the closest fit to "groups, people, or teams" the real data model supports. **Genuine
  department/crew grouping is NOT built** — that's a bigger, separate ask (a new grouping field on
  `users`) and is logged here as an open follow-up needing Jeff's input on what a "team" should
  mean beyond permission roles, rather than invented silently.
- **Fan-out reuses tasks.ts's own `expandTemplate()` verbatim** — no signature change, so the
  existing per-stage project auto-apply call site (`setProjectStage` in projects.ts) is untouched.
  Each fanned-out instance (one per matching person) gets its own coverage-key: a person-target
  line keeps the line's own `key`; a role/team line suffixes the user id (`key::userId`) so N
  people never collide. The `stage` passed to `expandTemplate` is `tpl:<setId>:<kind>:<recordId>`,
  so re-applying the SAME set to the SAME record is the only case that dedups — applying two
  different sets, or the same set to two different records, never collides. This makes re-apply
  additive: a newly-hired Estimator added to a role target after the first apply gets their task
  on the next apply, and everyone else's rows are untouched (same idiom as the Grid's seeded-layout
  re-run, D149, and the per-stage project template already in production).
- **Quote task-linkage already existed** — punch #17's remainder shipped `quoteId` on `TaskRecord`
  plus a working Tasks card in the estimator (`estimator-client.tsx`, `estimator/actions.ts`)
  before this task started; the punchlist's audit note calling out "quotes have zero task UI" is
  stale (dated 2026-07-29, before that remainder landed). Nothing needed adding there beyond the
  new `applyQuoteTemplateAction` wrapper.
- **Design task-linkage did NOT exist and was added**: `TaskRecord.designId: string | null` (new
  nullable pointer, same no-FK convention as `projectId`/`quoteId`, D85) plus `tasksForDesign()`
  in tasks.ts. No migration needed — `designId` lives inside the existing `tasks` doc's JSONB, not
  a promoted column. The Design detail page (`design/designs/design-client.tsx`) gained its first
  Tasks card (reusing the shared `TasksCard` component) and its first task server actions
  (`design/designs/actions.ts`: `addDesignTaskAction`/`setDesignTaskStatusAction`/
  `updateDesignTaskAction`), FormData-shaped to match `TasksCard`'s contract even though the rest
  of that file uses typed-argument actions (`submitDesignReviewAction(id, ...)` etc.) — `TasksCard`
  requires the FormData shape regardless, same as the estimator's quote-task wrappers already do.
- **New shared `ApplyTemplateControl` component** (`src/components/apply-template-control.tsx`) —
  a plain server-action form (name-a-set, hit Apply; renders nothing when no sets apply to that
  record kind) placed next to the Tasks card on all three entry points: the project detail
  (`projects/view.tsx`), the quote builder (`estimator/estimator-client.tsx`), and the design
  detail (`design/designs/design-client.tsx`). Each parent type owns its own thin
  `applyTaskTemplate()` wrapper action (`applyProjectTemplateAction`, `applyQuoteTemplateAction`,
  `applyDesignTemplateAction`) — same "each route keeps its own use-server file" convention
  `TasksCard`'s add/status/update actions already follow. Applying a template requires only being
  signed in (`requireUser()`), matching every existing manual-task action's permission level — no
  extra gate beyond what adding a task by hand already requires.
- **Admin authoring UI lives at `/task-templates`** (new Settings → Admin screen, added to
  `ADMIN_SCREENS` in `settings-sections.ts` and the nav-highlight map in `nav-data.ts`), gated on
  `manage_users` — the closest existing permission fit (`Perm` in `lib/team.ts` has no dedicated
  "manage templates" permission, and this screen edits data every team member's tasks are minted
  from, the same sensitivity class as Estimating Rules and the team roster). Mirrors the
  design/assemblies `AssemblyBuilder` pattern (`assembly-builder.tsx`) rather than Estimating
  Rules' per-field editor: a template set is a small whole document (name/description/appliesTo/
  lines), edited entirely client-side and saved as one unit via `saveTaskTemplateSetAction`, rather
  than a form-per-field round trip.

**Files:** `src/db/doc-tables.ts` (`taskTemplates`, `task_templates` in `DOC_TABLES`),
`drizzle/0020_odd_crusher_hogan.sql` (new, + hand-added trigger), `src/lib/stores/tasks.ts`
(`TaskRecord.designId`, `tasksForDesign`), `src/lib/stores/task-templates.ts` (new — CRUD +
`applyTaskTemplate`), `src/components/apply-template-control.tsx` (new),
`src/app/(app)/task-templates/{page.tsx,actions.ts,template-sets-client.tsx}` (new),
`src/app/(app)/settings/settings-sections.ts`, `src/components/nav/nav-data.ts`,
`src/app/(app)/projects/{data.ts,view.tsx,actions.ts,page.tsx,[id]/page.tsx}`,
`src/app/(app)/estimator/{page.tsx,types.ts,estimator-client.tsx,actions.ts}`,
`src/app/(app)/design/designs/{page.tsx,design-client.tsx,actions.ts}`,
`src/app/(app)/field-work/controls.tsx` and `scripts/test-review-and-spec.ts` (fixture/assertion
updates for the new `designId` field and the fifth Admin screen).

**Open follow-up for Jeff (logged, not built):** a real department/crew grouping distinct from the
permission `Role` enum, if "team" is meant to mean something narrower than "everyone" or a
specific role (e.g. a Design crew vs. an Install crew that doesn't map to Estimator/Manager/etc.).

**Fixed on review, same day:** `applyTaskTemplate` minted tasks against whatever `target.id` a
caller passed without confirming the record actually existed (or was really the kind claimed) —
a stale/mistyped id would have silently created tasks pointed at nothing anyone would ever read,
rather than failing. It now loads the project/quote/design first and throws a named "could not be
found" error if it's missing, before any task is created. The four thin wrapper actions
(`applyProjectTemplateAction` etc.) are still void `FormData` handlers with no return channel for
that thrown error — the SAME accepted trade-off already made across this codebase for this exact
action shape (#85: "logged only, no code... the point of this entry is that the decision was made
knowingly rather than papered over"), so this fix trades a silent wrong-behavior for a loud
failure without expanding into the five-screens-of-error-UI #85 already declined to build.

## D152. Recordings — in-app site-visit audio → Krisp transcription → write-back → Drive archive (#119, 2026-09-21)

**Ask (Jeff, "Krisp API Integration Brief — Peak App Site Visits", 2026-09-21):** a rep records a
site visit and the recording, transcript, summary, and action items land on that visit's record
with no manual upload. Brainstormed and approved the same evening; the full design is
`docs/superpowers/specs/2026-09-21-krisp-recordings-design.md`. Numbered D152 (not D150) because
the main checkout already holds uncommitted D150/D151.

**Defaults taken, and why:**

1. **Generic parent, not site-visit-only.** New `recordings` doc collection (`REC-####`, base
   9000) with `parentKind` ∈ site_visit | survey | inspection | flame_job | repair_job | project |
   engagement. Jeff chose "any field record" over the brief's site-visit scope — same room, same
   walkthrough. The D91 `recordingUrl` link on engagements is untouched.
2. **Per-rep Krisp keys** (`krisp_connections`, AES-GCM via the Gmail `encryptToken`), pasted on
   the Account page. Krisp keys are personal; the rate limit and the one-import-in-flight rule are
   per account. `/me` cannot distinguish Read from Write scope, so the card says "must be a Write
   key" and a Read key fails at first import with Krisp's 403 rather than at connect.
3. **Approach A — Blob-staged single upload, server relay, poll-driven.** The phone uploads once,
   straight to Vercel Blob via `@vercel/blob/client` (`/api/recordings/upload` brokers a scoped
   token; middleware-exempt because Vercel's completion callback carries no session, so the
   token branch authenticates itself via `auth()` + ownership). The server then `POST /import`s
   and streams the Blob to Krisp's pre-signed URL. Results come back by polling (20 s client poll
   on the detail page, a Home-load stale check, a step on the daily cron route) — Krisp webhooks
   are static-header-only, per-rep manual setup, undocumented payload, so they are a follow-up
   accelerator, not the delivery path. Jeff will upgrade Vercel for cron cadence if the pilot
   works; nothing in the code depends on it.
4. **Blob is staging; Drive is retention.** Nightly `archiveRecordings()` (≤5 per run, ≥6 h after
   ready) uploads to Google Drive under `Peak Recordings/<Customer>/`, saves the link, and only
   then deletes the Blob. Jeff's explicit ask ("minimize the amount of storage"). The archive
   account is a Settings picklist over connected mailboxes with the new `drive.file` scope
   (`?drive=1` on the connect route); recommended default is the shared sales box so recordings
   stay company-owned. Dates in file names use America/Chicago.
5. **Confirm-first, insert-on-tap.** Krisp action items land `pending`; Accept creates a Home
   Queue assignment (source `Krisp REC-#### · <title>`, company link) that the existing Google
   Tasks / Reminders syncs carry onward; nothing enters the queue untouched. Summary sections
   route to Survey/Inspection fields by the deterministic `PREFILL_RULES` title table and are
   appended only on Insert with a `[from REC-####]` marker — no silent writes, no numeric
   extraction (D89: the app stays rules-based; Krisp is the only summariser).
6. **Summary → customer feed note** posted once (`feedNoteId` guard) when a customer is known.
7. **Native recorder:** `@capgo/capacitor-audio-recorder` (file output, iOS background audio) +
   `@capawesome-team/capacitor-android-foreground-service`; web MediaRecorder is the desktop
   fallback only (WKWebView mutes the mic on lock). Native project edits are documented in
   DEPLOY.md §6, not applied to ios/ or android/.
8. **Pilot gate:** `recordingsBetaUsers` (Settings → Beta) limits the Record button to named
   users; empty = everyone.

**Follow-ups (not built):** Krisp webhooks; numeric extraction into typed fields; in-app audio
playback; pull-and-match backfill of Jeff's existing Krisp mobile recordings; per-rep Drive
archives; a PGlite-backed end-to-end test (the `deps` injection points exist).

## D153. Native shell signs in through a Safari sheet and returns by `quartzite://auth` (2026-09-21)

The Capacitor shell (D174) could not sign in: Capacitor hands any non-app host to the system
browser, so Auth.js's state/PKCE cookies were set in the WebView while Google's callback landed in
Safari. Verified on the iOS 27 simulator. Jeff chose to keep OAuth in a real browser context rather
than spoof the WebView's user agent to satisfy Google's embedded-browser check.

- **The whole round trip runs in an in-app Safari sheet** (`@capacitor/browser`,
  SFSafariViewController): `GET /api/native/auth/start` calls Auth.js `signIn("google")` with the
  hand-off route as `redirectTo`, so every Auth.js cookie lives in one jar.
- **The session moves by copying the Auth.js session cookie verbatim**, chunks included, never by
  re-encoding a JWT. `GET /api/native/auth/handoff` reads its own session cookie, wraps it in a
  60-second AES-256-GCM code bound to a PKCE-style challenge, and serves a page that opens
  `quartzite://auth?code=…`. `POST /api/native/auth/exchange` verifies the app-held verifier and sets
  the same cookie in the WebView. Expiry and the per-request role refresh are unchanged.
- **Stateless by design:** the code is encrypted with the existing `lib/gmail/crypto.ts` primitive
  (key from `AUTH_SECRET`); no table, no migration, no new env var. `encryptWith`/`decryptWith`
  now take the secret explicitly so the pure module is testable without env.
- **Custom scheme, not Universal Links** — those need the paid Apple team; they are the upgrade path.
- **Degrades, never throws:** every native call sits behind `isNativePlatform()` and
  `Capacitor.isPluginAvailable`; an old binary falls back to the in-WebView `signIn`.
- Bad GET input redirects to `/login?error=native` (so `test:smoke` covers the routes and a stray
  visitor lands somewhere sensible); only the POST exchange returns JSON 400/401.
- Android gets the manifest intent-filter in the same change but is not built or tested yet.
- **Final review hardening:** the hand-off is bound to a flow that started at `/api/native/auth/start`
  (a 5-minute `qz_native_challenge` cookie set there and required to match at handoff, so a drive-by
  link to handoff can't mint a code over a visitor's session), and the exchange requires
  `Content-Type: application/json` plus a same-origin `Origin` header (so a cross-site form can't set
  a session cookie). Universal Links, once the paid Apple team lands, remove the duplicate-scheme risk
  these two mitigate and are the eventual resolution.

Spec: `docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md`.

## D156. Catalog price dates: per-line `pricedAt`, a manufacturer-level "price list effective" date, and the 18-month outdated rule (#133, #129, 2026-09-21)

Jeff asked for per-line price dates, an editable 18-month "outdated" banner by manufacturer, and an
effective date on price lists (2026-09-21). Spec: `docs/superpowers/specs/2026-09-21-catalog-price-dates-and-assemblies-design.md`.

- **`CatalogPart.pricedAt` means "when this price last moved."** The store stamps it centrally in
  `upsert`/`mergeUpsert` (`lib/stores/catalog.ts`) ONLY when `list` or `cost` actually changes —
  importers pass the file's effective date, every other write stamps now. `updatedAt` keeps its
  last-write meaning. Parts that predate the field stay undated; nothing invents a date.
- **`settings.priceListEffective[mfrKey]` is the manufacturer's book date.** Set by the Catalog
  banner's inline date input (the one-time backfill) AND by both importers when an import writes
  rows (the file's effective date IS the list's effective date, and it confirms the unchanged rows
  too). Precisely (final review, 2026-09-22): the Import hub's "Skip duplicates" mode compares
  nothing, so it never stamps; a file that carries no List/Cost column confirmed no price, so it
  updates descriptions but neither stamps the book nor touches stored prices (both importers, and
  the hub's "Create new" on an existing SKU preserves prices exactly like "Update existing"); the
  hub stamps per manufacturer group, only a group at least one of whose rows was written and none
  of whose rows errored (`commitCatalogImport` in `import/catalog-commit.ts`).
- **Partial-file caveat (open — Jeff's call).** The guard only requires that a file overlap the
  manufacturer's book by one SKU (D157), so any file that passes it re-dates the manufacturer's
  WHOLE book: with the later-of rule above, every part of that manufacturer — including the ones
  the file never mentioned — reads as effective on the file's date. That is exactly right for a
  full price-list re-import (the common case: the yearly book, most prices unchanged) but
  over-claims for a supplement — a 40-row "new products" sheet or a single-category update
  confirms nothing about the other 1,960 lines, yet they stop reading as outdated. Mitigations, none
  taken by default: (a) a "this is the complete price list" checkbox on both importers, stamping
  the book only when ticked (else only the written lines' `pricedAt` move); (b) a coverage gate —
  stamp only when the file overlaps ≥ N % of the manufacturer's parts; (c) accept the over-claim and
  rely on the banner to correct a date by hand. Logged as MASTER-QUESTIONS E6.
- **A line's effective date is the LATER of its own `pricedAt` and the book date** (`effectivePriceDate`
  in `lib/catalog-books.ts`). The spec's wording calls the book date a "fallback"; the later-of rule
  is what makes the banner's edit actually clear an outdated book whose lines carry old `pricedAt`
  (a list confirmed on day D confirms every line on it, and a line re-priced after D keeps its own
  date). Yearly re-imports where most prices don't move therefore read as current.
- **A book is dated only when every part is; oldest wins.** `priceBooks()` returns `effectiveAt` =
  the oldest effective date when all parts have one, else `null` + `unknown: true` — #14 decision
  A carried forward: a single hand-edited SKU must not make a 2,000-row book read as fresh; an
  undated part is older than anything. `outdated` = dated and ≥ 548 days (18 months). The book date
  is the one-click way to date the remainder.
- **Surfaces:** Home card pill states (age / Outdated red / Unknown grey); a Catalog banner listing
  outdated + undated manufacturers, each with a date input and a facet link (Unbranded is excluded —
  there is no manufacturer to date); the part edit modal shows the line's effective date.
  Manufacturers group by `mfrKey` (lowercase alphanumerics — the importer's `norm`), so spellings
  merge; the display name is the most common stored spelling, and the banner link filters that
  spelling.
- **Subassemblies resolve live (#129)** through `resolveSubassembly()` (`lib/fixture-assemblies.ts`),
  the legacy save-time formula (engine + lens + Σ option cost × qty) over the current catalog. The
  record keeps `snapshot: { cost, price, pricedAt }` (and the legacy cost fields) for "was $X when
  built". Both builders show "prices as of" = the NEWEST effective date among their parts.
- No schema change; parts and settings are JSON documents. `bodySizeLimit` etc. — see D157.

## D157. Catalog import guards: manufacturer required, wrong-manufacturer double check, 1 MB cap (#132, #134, 2026-09-21)

- **Manufacturer is required on both importers.** Catalog page: the picker/new-name field won't
  submit empty and the server re-checks. Import hub: the `catalog` type's `mfr` field is
  `required`, so a row without one fails per-row validation (existing rendering) and is never written.
- **Guard order** (`checkManufacturer` in `lib/catalog-import-guard.ts`, pure): blank → `missing`;
  the name normalizes (`mfrKey`) to an existing manufacturer → that spelling is used; any file SKU
  filed under a different manufacturer → `foreign-skus` (checked first — it names exactly which rows
  are wrong, up to 10 examples + "+N more"); the manufacturer already has parts and the file overlaps
  none → `no-overlap` ("None of the N SKUs in this file belong to ‹mfr›"); a new manufacturer or any
  overlap → ok. SKUs compare case/punctuation-insensitively (the hub's dedupe `norm`). Unbranded
  parts are never foreign — importing them under a manufacturer is how they get one.
- **The Import hub runs the guard twice:** per manufacturer group in the preview through
  `checkCatalogImportAction` (the ~10k-row catalog is too big to ship to the browser for a local
  check), blocking the Import button on any failure, and authoritatively in `importRecords` before
  `commitImport`; groups are normalized to the existing spelling on commit. The Catalog page runs it
  in `runCatalogImport` before any upsert, so a rejected file writes nothing.
- **1 MB = 1,048,576 bytes**, checked (a) client-side on `file.size` before any upload and on the
  paste box's UTF-8 byte length, (b) in the Catalog page action (file or paste), (c) in `importRecords`
  for the catalog type, and (d) in `/api/import/xlsx` when the client posts `type=catalog` (10 MB stays
  for every other type). Failures surface through the existing `importError=` / `err=` banners.
- **`experimental.serverActions.bodySizeLimit = "1200kb"`** in `next.config.ts`: server actions
  default to a 1 MB request body, which multipart overhead pushes a ~1 MB file past, so Next would
  reject it with an opaque error before the app's check runs. The headroom makes the app's clear
  error win; anything larger still fails closed at Next's limit.

## D154. The Grid draws a symbol per placed item type — eight curated shapes, per-entry override, per-category defaults in Settings (#131, 2026-09-21)

Every placed device was the same rounded rect coloured by a category hash; curtains were the one
special glyph. Jeff asked for selectable symbols so people can tell objects apart on a plan.

- **Vocabulary is curated, not uploaded:** `rect | circle | triangle | diamond | hexagon | speaker |
  light | camera` (`GRID_SHAPES` in `src/lib/design/grid-symbols.ts`). The last three are a rounded
  rect with a small white path glyph inside; everything else is an outline. Symbol images/uploads
  stay out of scope.
- **Resolution is `part.shape ?? default[category] ?? "rect"`** (`shapeFor`, pure). The per-entry
  override is `GridSymbol.shape` on the `grid_catalog` document — placements resolve their part
  live, so changing an entry redraws every instance on every design. Category defaults live in
  `settings.gridCategoryShapes`.
- **The category map is FULL REPLACEMENT** (the `wireTypes` idiom, not a per-key merge over the
  seed): absent = the seed `Speakers→speaker, Lighting→light, Cameras→camera, Rigging→diamond,
  Control→hexagon`; present = exactly what Settings holds, and a category left off draws as a
  rectangle. Category names match trimmed and case-insensitive because `CatalogPart.category` is
  free text (~40 imported values).
- **One renderer:** `<SymbolShape>` (`src/components/design/symbol-shape.tsx`) draws the plan
  marker, the riser's group glyphs, the riser legend and the palette rows, so the palette shows
  what the plan will draw. It takes `w`/`h` (the symbol's existing `symbolWidth`/`symbolHeight`),
  not a single `size`, so the 44×30 footprint is unchanged. Curtains keep their drape glyph; the
  selection ring and label placement are untouched. `markerColor` moved from the editor into the
  pure module so the riser and Settings colour a category exactly like the plan.
- **Where it is edited:** the placed item's context panel ("Symbol" select — per-entry, labelled
  "applies to every placed X") and the Assemblies "+ Build" form (the only grid-catalog entry
  editor that exists — entries are otherwise seeded from the pricing catalog). The category
  defaults card lives under **Settings → Admin** (the spec harness pins the sections to
  General/Team/Admin; a fourth "Grid" section is out of scope).
- **The legend** lives on the riser page (the printable derived drawing); no legend existed
  before this change.

Spec: `docs/superpowers/specs/2026-09-21-round-2-standalone-design.md` §#131.

## D155. Manual consulting engagements are never overwritten by the quote sweep (#135, 2026-09-21)

Engagements were only ever minted by `syncEngagementsFromQuotes()` from sent/won consulting
quotes; a project that skipped the fee proposal had no way in. "+ New consulting project" on the
hub now creates one by hand, and the sweep's contract was extended rather than bypassed:

- **Model:** `ConsultingEngagement.origin?: "quote" | "manual"` (absent on pre-#135 docs = quote)
  and `quoteId: string | null` (null on a manual project until a proposal is attached). A manual
  project is born `awarded`, with milestones from the fee — a fixed fee is ONE unscheduled "Fee"
  milestone carrying the amount, a schedule keeps its rows — and every phase on the Settings phase
  menu seeded pending. The phase SET is not the one a won quote gets: `fromQuote` seeds only the
  phases ticked on the proposal (`consulting.phases`, falling back to `DEFAULT_CONSULTING_PHASES`
  when the quote named none), while the manual modal has no phase picker, so
  `createManualEngagementAction` passes the whole `mergedConsultingPhases(settings.consultingPhases)`
  menu. Both paths seed whatever phases they take as pending, and a phase is removed on the project
  page in one click. Put to Jeff as MASTER-QUESTIONS E7. The creation is logged as a decision
  ("Project added manually", by the creator) so provenance is visible on the record.
- **Sweep rule (`sweepIndexesEngagement`, pure):** the sweep indexes rows by quote and skips any
  row with no quote — so a manual project is invisible to it: never created, advanced, closed or
  reopened. "Attach proposal" sets `quoteId` (validated: exists, is a consulting quote, is not
  another engagement's); from then on the row is keyed by that quote and follows
  `engagementSyncAction` like any other. Those rules only move `proposal_sent` and `closed` rows,
  so an awarded manual project is never demoted, and because the row is now indexed the sweep can
  never mint a duplicate engagement for the attached quote. Attaching never rewrites milestones.
- **Creation is `requirePerm("create")`** (the rentals-create gate); a customer is picked or
  quick-added (`EntityQuickAdd`, minted with the `c<ms>` id convention), the venue must belong to
  that customer or is dropped, and the phase menu is resolved in the action so the store stays
  settings-free (the D91 idiom).
- **Not changed:** `ensureEngagementForQuote` (the regression harness uses it), the on-win fan-out,
  the Reports billing forecast (`targetDate > 0` still gates it), consulting fee proposals (#35).

Spec: `docs/superpowers/specs/2026-09-21-round-2-standalone-design.md` §#135.

## D160. Vendors are companies; price-list freshness is a date rule; owner tasks are exactly-once (#122, 2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-vendors-module-design.md`. Jeff's decision in the
brainstorm was **date rule only** — no price-list file upload or diff. Defaults taken while
building:

- **A vendor is a company with `type === "vendor/manufacturer"`** (the `COMPANY_TYPES` value,
  `lib/identity/config.ts` `VENDOR_COMPANY_TYPE`). `PARTNER_TYPES` now carries that exact string
  (the legacy `"Vendor"` spelling stays), so vendor companies no longer get a base venue. Rows
  typed the legacy way do NOT appear on `/vendors` — retype them in the Companies edit modal, whose
  type select now keeps a stored type that isn't one of the five prototype venue segments (it used
  to render blank for any Daylite-imported type).
- **One doc per vendor, id = company id** (`vendor_profiles`, migration `0024_vendor_profiles`,
  written idempotently per D141). Manufacturer claims are `mfr` spellings matched by `mfrKey()`;
  one owner per key — claiming moves it. Not sync-pushable.
- **Status** (`lib/vendor-status.ts`, pure): `no-list` beats everything; `newer-list` when the
  newest ledger `effectiveAt` is strictly after the NEWEST `effectivePriceDate` of the claimed
  parts; `outdated` when `now − max(list, catalog) > OUTDATED_AFTER_MS` (boundary inclusive =
  current); else `current`. `catalogEffectiveAt` is the newest date (the banner's `priceBooks()`
  uses the oldest — a different question).
- **Owner tasks** are Home Queue assignments keyed by
  `source = "auto: vendor <id> <status> <at>"`; `ensureVendorAssignments()` skips when ANY
  assignment with that key exists, open or done — exactly once per (vendor, status, date), never
  re-opened. Runs after a ledger save and inside the daily `/api/gmail/sync` cron (own try/catch,
  reported as `vendors` in the JSON). Assignee = `settings.catalogOwner.userId` if active, else the
  user named Jena Tolksdorf, else the first active Admin; nobody → no task. `link.kind` stays
  `"company"` (the Krisp write-back precedent: `AssignmentLink` kinds are not extended); the queue
  row deep-links to `/vendors/<id>` anyway, gated on the source prefix — `assignmentHref()`
  (`lib/queue.ts:43,61`) sends a `"company"` link to `/vendors/<id>` only when its `source` starts
  with `"auto: vendor "`, and every other `"company"` link (which may be a customer, and that route
  404s on one) still lands on `/queue`.
- **Settings → Catalog** is the admin card on `/catalog` (Settings' Admin section only links
  there); `setCatalogOwnerAction` is gated on `manage_users` like every other Settings write.
- **"+ New vendor" is a name-only quick-add** through the customers-store upsert with the type
  preset (the same seam the Inbox quick-add uses), not the full Companies modal: its type list is
  the five venue segments and its default blank venue row would give a vendor a "Venue" site. The
  unclaimed-manufacturer claim reuses a vendor whose name normalizes to the manufacturer, else
  creates `v-<mfrKey>`; a non-vendor company with the same name is left alone.
- **Inbox:** `/inbox?customer=<id>` is an alias of the pre-existing `?new=<id>` composer entry
  (the spec's "extend `?draft=`"), and `&log=1` opens the Log call / meeting modal preset — so
  "Log call" from a vendor really logs a call. The link sidebar's picker groups Customers /
  Vendors; the compose/log modals' pickers are unchanged.
- **Claiming a manufacturer does not re-run the task check** — only a ledger save and the cron do
  (spec §2); the next daily run picks up a claim's effect on status.
- Seed: `rose-brand` (the manufacturer with the most seeded parts) with a 3-week-old ledger entry,
  so dev shows "Newer list received" and the first cron creates the owner's task.

Out of scope, logged as follow-ups: procurement lines linking to vendor records
(`ProcurementLine.vendor` stays free text); a `"vendor"` `AssignmentLink` kind of its own (the
source-prefix gate above covers the one case that exists); multi-vendor manufacturers.
## D158. Import hub — customers / contacts / venues as three importers, unmatched customers auto-created (#137, closes #82 + #83, 2026-09-21)

Jeff's decision (brainstorm 2026-09-21): a contacts or venues row whose customer isn't in Peak
**creates** the customer rather than failing. Spec:
`docs/superpowers/specs/2026-09-21-import-export-people-venues-design.md`. Defaults taken while
implementing it:

- **Link-back order** is `Customer ID` exact match → normalized-name match (the hub's `norm`:
  lowercase, alphanumerics only) → create `{ name, type: hidden "Customer Category" column ?? "" }`.
  A created customer is pushed into the commit cache, so every later row in the same file links to
  it — one file, one new record per distinct name. The preview lists "Will create N new customers"
  from the same pure resolver (`import/link.ts`), so what it shows is what commits.
- **`Customer` OR `Customer ID`** — `FieldDef.requiredUnless` lets either column satisfy the
  requirement; a row with neither fails validation before commit.
- **Embedded columns stay as hidden aliases** (`FieldDef.hidden`: auto-mapped on import, absent from
  template and export) so pre-#137 customers files keep working for one release. On such a row,
  `Phone` is the embedded contact's; on a new-format row it is the company's main phone.
- **Where a customers row's address goes:** Address/City/State/Zip merge into the customer's
  **unnamed mailing venue** — the primary venue on a customer that has no named one, which is the
  address the record page, travel estimates and quotes use, and what this importer always did —
  but now as a merge (`mergeLocation`), never the old replace-all-venues, and never onto a *named*
  venue (see the base-venue bullet below for the full symmetric rule).
  Zip also stamps `companies.zip` (the spec's "company HQ/billing" zip); Phone/Website stamp
  `companies.main_phone` / `website`. The companies row's own address/city/state columns are left
  for the Daylite import. A blank Category writes `""` (the old importer invented "Performing arts").
- **Venue category is a new nullable `sites.kind`** (hand-written migration `0023_sites_kind`): the
  spec allowed "the site row's existing free-text kind column, else the location document", but
  `venue_kind` is the controlled vocabulary the estimator and Companies modal switch on, and sites
  are relational rows, not documents. `kind` is stored as typed and shown as a pill on the customer
  record; a venue the import **creates** derives `venueKind` from it (`venueKindFromCategory`:
  church/blackbox/arena/flat, default proscenium); an existing venue keeps its `venueKind`.
- **The first imported venue claims the unnamed D85 base venue** instead of leaving an empty twin
  (a labelled row with no name match takes the first blank-label location) — but only a TRUE
  placeholder, one carrying no address/city/state/zip of its own (`mergeLocation`'s `claimBlank`,
  tightened in the final review). The customers template has no Venue column, so a customer
  imported with an Address owns an unnamed but *addressed* primary venue: that is its mailing
  address, which the companies row does not duplicate (see above), so a labelled venues row
  appends beside it rather than overwriting it. Only the customers writer claims a blank-label
  venue whatever it holds, because its own row IS that venue. **The rule is symmetric** (final
  review, round 2): a customers row with no Venue column addresses an *unnamed* venue — the
  primary one when it has no name of its own, else the unnamed one sitting beside a named venue —
  and never renames what it addresses. When every venue is named there is nothing it may address,
  so it appends its mailing address as a new unnamed location instead of overwriting a named
  venue's street address, which nothing else in the app holds. **The customer's first named venue
  becomes the primary one**, demoting that mailing placeholder (which stays, as a second
  location): `primaryLoc` feeds the record page's location line, travel estimates and quote
  defaults, and those belong on the venue where the work happens. So a customer that appears in
  both customers.csv and venues.csv ends up with the venue primary and the mailing address kept as
  a second, unnamed location.
- **Contacts:** matched by primary email, else normalized name; a hit **keeps its stored name**
  (writeRecord matches contacts by display name — renaming would mint a second row). `Title`, else
  `Role`, fills the one free-text slot (`contacts.title`, the Daylite precedent). `Mobile` is a
  second, "mobile"-labelled phone channel; `CustomerContact.phone` now composes as the non-mobile
  number (falling back to the first phone) and `mobile` as the mobile one, so a round trip through
  writeRecord targets the right row each. `Primary` = yes/y/true/1/x promotes and demotes the others;
  anything else leaves flags alone, except that the first contact on a record is always primary.
- **"Create new" never duplicates** a contact or venue — the writers are upserts; the mode only
  matters for the customers type.
- **Store seam:** `zip`/`kind` (locations), `mobile` (contacts) and `zip`/`phone`/`website` (doc)
  are write-when-provided / preserve-when-undefined, backfilled before the D83 change check exactly
  like #23's lifecycle/keywords/custom, so the Companies modal, quote intake and inbox quick-add —
  which don't carry them — neither clear them nor bump `updatedAt`. `LocationInput`/`ContactInput`
  and `saveCustomerAction` carry them anyway, and the quote-intake / inbox `toLocationInput` copies
  are replaced by one shared converter in `companies/lib.ts` that keeps `locationName` (the #96
  review follow-up: the intake copy was clearing the campus name on every save).
- **Zip cells** are trimmed; 5-digit and ZIP+4 kept as typed; a 4-digit value gets its
  Excel-stripped leading zero back.
- **Exports:** contacts and venues export one row per record with the customer's name and id (so
  export → edit → re-import links by id even after a rename); customers export gains Category + Zip
  and drops the embedded contact/venue columns; an unnamed, address-less placeholder venue is not
  exported (it would only produce a row that fails re-import). `Notes` columns are accepted and
  ignored on all three types, as the customers importer always did.

## D161. The Estimator add-part row is exclusive: one input method open at a time, switching discards the last (#142, 2026-09-22)

The six add-part methods on a system card — catalog, curtain, fixture, labor, custom part, vendor
quote / CSV — had three different ownership models. Five were nullable section ids on
`EstimatorClient` that cross-cleared each other by hand; `toggleCatalog` cleared **nothing**; and the
sixth, the CSV importer, was a local `useState` inside `SectionCard`, so one could sit open per
system and no other method could close it. Three panels could stack in one card, and every draft was
reseeded on *open* rather than discarded on *close*, so a half-typed custom part stayed alive in
memory behind a closed portal.

All six now share **one descriptor** — `openInput: { kind: InputKind; secId: string } | null` — and
one coordinator, `openInputMethod(kind, secId)`, which discards the outgoing method's draft, seeds
the incoming one, and writes the descriptor. `closeInput()` is the single close path, so the same
button clicked twice, a modal's × and its scrim all discard too. A seventh input method is now one
entry in `InputKind`, not five more setter calls — which is the point, because two more are queued
(#143).

Consequences worth naming:

- **`+ Add system` closes whatever was open.** It opens the catalog picker on the new system (kept —
  it is load-bearing UX), and under one exclusive descriptor that necessarily closes an open portal
  elsewhere. The draft was reseeded on the next open before this change too, so nothing recoverable
  is lost; what changed is that the portal now closes instead of lingering.
- **No confirm-before-discard.** Jeff asked for "close and discard", and four of the six methods
  already behaved that way. A dirty-draft guard would need a z-index ladder first — all three
  configurator modals share `zIndex: 50` (`est-ui.tsx:149`) — so it is a separate item if wanted.
- **The CSV import banner outlives its panel.** Another method can now close the importer mid-flight,
  which would have swallowed `Import failed; nothing was added`. The terminal result renders as a
  dismissible card-level notice outside the panel; the banner still clears on the way in, so a stale
  count never greets the next open.
- **The labor travel fetch is generation-stamped.** `withTravelFor` (#89 ordering untouched) resolves
  after the user may have moved on; an `openSeqRef` bumped in `openInputMethod`/`closeInput` retires
  callbacks from a previous open, which a bare kind+secId comparison could not do (close → reopen on
  the same method and system is indistinguishable without it).
- `showLink` in `SectionCard` was `useState(!!p.customDraft.link)` — set once at card mount, never
  reset — so a card that had ever revealed the optional URL field kept showing it against a reseeded
  draft. It is now derived from a `linkRevealed` flag cleared on each open.

The two resets are handler wrappers rather than `useEffect`s: `react-hooks/set-state-in-effect` is on
and **errors** in this repo, and each portal can only be opened from its own button on its own card,
so clearing on entry covers every open path.

## D162. Vendor quotes are a record with a display toggle; the catalog CSV moves under the catalog method (#143, 2026-09-22)

Jeff's punchlist asked two things of the add-part row that turn out to be one change. Asked what was
missing from the #112 CSV importer, he answered: "Vendor Quote is both a vendor quote with data and
information and adding a csv instead of manually adding the material list. a CSV catalog import is
part of adding the catalog parts" — and chose "Split it off the Vendor button". So the single
`+ Vendor quote / CSV` button split along its two jobs:

- **The catalog-parts CSV moved inside the catalog method.** It renders under the CatalogPicker when
  `+ Add part from catalog` is open, reworded "Import catalog parts from CSV". `"import"` left
  `InputKind` (D161) because it is no longer separately openable; the card-level result notice still
  renders outside the panel, now gated on `!p.catalogOpen`.
- **`+ Vendor quote` became its own input method** — a ConfigModal like the three configurators,
  registered as `"vendor"` in `InputKind`.

**Model.** `VendorQuote` — vendor, quoteNumber, description, attachment, link, lines, terms, notes,
total, includesFreight, display — lives TOP-LEVEL on the quote doc, not inside `spec`. The doc store
is JSONB with a shallow `Object.assign` merge, so this needed no migration, and the already-written
proxy route reads `quote.vendorQuotes`. `SpecItem` gained `vendorQuoteId` and `noFreight`.

**One priced line, two displays.** A vendor quote spawns exactly ONE `SpecItem` carrying the money
(`cost` = the vendor total, `price` seeded by the same `tierMargin`-else-30% rule `addPart` uses).
The materials live on the record, not as separate items, so `pricing.ts` totals stay honest, the row's
× behaves, and `display` is a pure render decision that stays live after save — Jeff said "have the
option to display", so it is a toggle on the row, not a choice frozen at add time. A previous attempt
(26d16f4, never landed) put the total on child line 0 and $0 on the rest; that is explicitly rejected,
because those $0 rows reached the customer document.

**Freight exemption, in Jeff's words:** "if the vendor quote includes freight then the freight slider
doesn't affect that particular line". Ticking *Quote includes freight* stamps `noFreight` on the line,
and the new `systemFreightBase()` excludes those lines. `systemItemsCost` is deliberately untouched —
it still counts every line for the margin readout and the cost column; only the freight base changes.

**Terms and notes are internal only** (Jeff's pick), rendered in the amber INTERNAL box beside
`internalNote`. `PreviewDoc` is rendered only inside the team-only estimator and the customer portal
never reads quote `spec`, so there is no customer surface for them at all.

**Amount is a line's extended total, never a per-unit price.** The vendor CSV mode accepts
`amount, total, line total, line amount, extended, ext, ext cost` — every one of those means the
extended figure, and a vendor PDF prints description / qty / unit / extended. The first cut multiplied
by qty, which turned a 12 × $3,480 line into $41,760; the column now reads "Line total" and
`vendorLinesTotal` sums it. qty and unit are descriptive, shown in the itemized display, carrying no
money.

**Attachments never ride the save payload when Blob is on.** `next.config.ts` pins
`serverActions.bodySizeLimit` at 1200kb and base64 inflates by 4/3, so a data-URL in the save payload
capped a vendor PDF near 600 KB per estimate — and a blown limit rejected the whole save, not just the
upload. Files now POST to `/api/vendor-quote-attachments/upload` (route handlers are not bound by that
limit), which returns a `blobPath`. The cap is 4 MB, in one shared constant used by the route, its
refusal text and the form's label, because Vercel Functions reject a body over ~4.5 MB before the
handler runs and a bigger promise would be the host's error, not ours. Above that, the Link field is
the escape hatch; the client-upload broker the recordings module uses is the documented upgrade path.
With Blob off — or when it errors — the data-URL path and its per-estimate budget remain, with an
honest message.

**A `blobPath` from the browser is untrusted.** It now round-trips through the client, so unchecked it
would be an arbitrary-read primitive over the private Blob store: a crafted save could point a vendor
quote at meeting audio or a grid plan sheet and the authenticated proxy would stream it.
`ownsVendorQuoteBlobPath()` (src/lib/vendor-quote-file.ts) binds a path to its record — under the
`vendor-quotes/` prefix, no `..`, at most one grouping segment, filename starting `<vqId>-` — and is
checked in BOTH the save action and the download proxy, so a path planted by any other writer or left
on a stale document still cannot be served. Twelve cases pin it in the spec harness.

**Margin — settled 2026-09-22.** Jeff: *"Vendor quotes should be affected by margin the same as a
catalog and manual item."* That is the shipped behaviour, so nothing changed; recording it so the
question is not reopened and so a future price-lock idea has to argue against an explicit decision.
There is **no per-item margin exclusion anywhere in the estimator** and none was added: `setMarginAll`
and `setSystemMargin` (`estimator-client.tsx:680-698`) map over `s.items` with no filter, rewriting
`price = round2(it.cost / (1 - m))` for every line, and the section's "Sell" target field back-solves
through the same handler. A vendor line seeds its price with the identical rule `addPart` uses for a
catalog part — `tierMargin` when it is in (0,1), else 0.30.

Note the asymmetry this creates with freight, which is deliberate and is the whole point of the
`includesFreight` exemption: **margin applies to every line, freight does not.** `noFreight` is read
in exactly one place — `systemFreightBase` (`pricing.ts:67`) — and `systemItemsCost` still counts
every line, so an exempt vendor quote is marked up and reported in cost and margin exactly like
anything else, and is only left out of the freight base.

Verified in the running app, not only by reading: a vendor quote and a custom part both at $1,000
cost, section margin dragged to 40% → both lines read **$1,666.67**.

**Still open / not done:** editing an existing vendor quote in place — **closed by D163 (#144)**;
`moveSystemToEstimateAction` now copies the record across, but blob garbage collection for a replaced
or abandoned file does not exist for any prefix in this repo.

## D163. A vendor quote is editable in place; editing preserves the line's current margin (#144, 2026-09-22)

Jeff, 2026-09-22: a stored vendor quote could only have its Single/Itemized display flipped or be
deleted. Changing the vendor, quote number, description, total, materials, terms, notes, link,
attachment or the freight flag meant removing the line and re-entering the whole thing — the gap D162
logged as "still open".

**Editing is an open of the same form, through the same coordinator.** There is no second open path:
the row's `Edit` sets a pending id on `vendorEditRef` and calls `openInputMethod("vendor", secId)`;
`seedDraft`'s vendor branch consumes and clears that ref, seeding the draft from the record when it is
set and `freshVendor()` when it is not. So editing obeys D161 exactly like any other method — opening
it discards whatever else was open, and closing it (×, scrim, Cancel) discards the edit draft and
leaves the stored record untouched. `discardDraft` clears the ref too, so an abandoned edit cannot
leak into the next plain `+ Vendor quote`. `openVendorEdit` closes first and seeds second, because
`openInputMethod` reads "the method already open on this system" as a toggle and would otherwise close
the form it was asked to open.

**The draft keeps the record's own id.** Never a fresh mint: with Blob on, the attachment is stored
under that id (and `ownsVendorQuoteBlobPath` binds it there), so a second id would orphan the file and
break the download. `commitVendorQuote` therefore needs no create/update flag — an id already present
in `vendorQuotes` IS the edit case. The record is replaced in place, at its position, and the SpecItem
it spawned is found by `vendorQuoteId` across all sections and updated: never a second line, never a
stale one, and never moved to the section the form happened to be opened from. `sku` and `desc` are
restamped (all three parts of `vendor · quote# — description` are editable, so a stale desc was the
likeliest bug); `qty`, `unit`, `option`, `allowance`, `comment` and `internalNote` are the
estimator's, not the vendor's, and are left alone.

**Price: the line's CURRENT margin is preserved and rescaled to the new cost.** `m = (price − cost) /
price`, new price = `cost′ / (1 − m)`, falling back to the `tierMargin`-else-30% seed rule only when
the line has no usable margin. The user may have dragged the system margin slider or typed a sell
price since the quote was added; re-seeding from the tier would silently undo that. Editing the
vendor's cost should move the price the way the slider would, not reset the margin. An unchanged cost
returns the price verbatim rather than round-tripping it, so a re-save can never move it by a cent.
This is not a per-item margin exclusion — D162 stands: margin applies to every line.

**`noFreight` can now be cleared, not only set.** The add path spreads `...(includesFreight ?
{ noFreight: true } : {})` onto a fresh item; the update path spreads an EXISTING item, so unticking
"includes freight" has to `delete` the key or the line would stay out of the freight base forever.

**Two smaller consequences, handled.** The attachment budget leaves the record being edited out of
`vendorAttachmentLoad` — its stored data-URL is about to be replaced by the draft's, so counting both
would ration the estimate against its own file twice. And the modal is keyed by the draft id: an add
switching into an edit no longer changes `InputKind`, so without a key the form would not remount and
the #143 `alive` guard would not retire an upload still in flight, dropping an abandoned file onto the
quote now open.

**Re-review (same day), three fixes.** (1) *The form's "Sell" stat now prices at the same margin the
save uses.* It was handed the tier seed unconditionally, so on a line whose margin had since been
dragged the footer showed one number and `Save changes` wrote another — $17,142.86 read against
$20,000.01 written on a 40% line, and with the total left alone the stat quoted a price the save
deliberately does not move at all. The Sell stat is the one figure Jeff reads to decide whether to
accept a vendor's new total, so it is now `vendorFormMargin`: the line's own margin when editing, the
tier seed otherwise, and it is labelled with the rate ("Sell at 40%") so a preserved margin is visible
rather than inferred. The rule itself moved into `pricing.ts` as `lineMarginOf` /
`repricedAtLineMargin`, one implementation the stat and the commit both call, and is pinned in the
spec harness. (2) *The Total field seeds blank when the stored total is just the lines' sum*
(`vendorTotalSeed`). A filled Total is a TYPED total and outranks the lines from then on, so seeding
it unconditionally converted every lines-driven quote on its first edit: the archetypal case — a
vendor revision that ADDS a line — would have left the itemized breakdown adding to more than the
customer was charged, the invariant #143 installed `vendorKeptLines` to protect. A total that
genuinely disagrees with its lines is still kept as typed, so an untouched edit re-saves the same
number either way. (3) *The form can open an attachment it did not upload*: with Blob on, a stored
record carries only a `blobPath` and the object-URL that once previewed it died with the page that
minted it, so the Download link fell away exactly when the user wanted to check which PDF they were
about to replace. The form now falls through to the authenticated proxy, the same three-step
precedence the line's own link uses — with the in-session preview still ranking ahead of it, so a
replaced file can never serve the outgoing one.

**Known and not fixed:** replacing an attachment orphans the old blob — no prefix in this repo has a
sweeper (D162's open item, unchanged). And where a record is referenced by both a live line and an
older revision, the save action's merge lets the builder's copy win, so an edit also changes what that
revision renders; making revisions immune would need a copy-on-write id, which the attachment/id
contract above forbids. Flagged rather than changed.

## D173. Plan sheets upload through a route handler, capped at an honest 4 MB (#146, 2026-09-22)

`addSheetAction` declared `MAX_SHEET_BYTES = 8 * 1024 * 1024` and took the sheet as a base64 data-URL
inside a SERVER ACTION payload. `next.config.ts` pins `serverActions.bodySizeLimit` at 1200kb and
base64 inflates by 4/3, so the real ceiling was a **~900 kB file, not 8 MB** — and going over it was
not the action returning its careful sentence: Next rejected the whole request body before the action
ran, so the user got an unhandled rejection and the entire save died, not just the upload. This is
exactly the #143/D162 defect one module over; the same reasoning and the same shapes apply.

**The upload is now `POST /api/grid-sheets/upload`.** Route handlers are not bound by
`serverActions.bodySizeLimit`, and multipart carries raw bytes, so base64's 4/3 tax is gone too.
`addSheetAction` is deleted rather than kept as a second path — one transport, one cap.

**The cap is 4 MB (`src/lib/grid-sheet-file.ts`), in one constant the route, its refusal text and the
picker's pre-check all read.** Not 8 MB: Vercel Functions reject a request body over ~4.5 MB before
the handler runs, so a larger number would be the same lie one layer up, with the browser getting a
platform error in place of this route's JSON. It is still a 4.4x rise on what the code actually
allowed yesterday.

**Why not the client-upload broker.** `handleUpload` from `@vercel/blob/client` (the recordings
module, `src/app/api/recordings/upload/route.ts`) has no body ceiling at all and is the right answer
for a genuinely large sheet — it was weighed and deliberately not taken here, because for the Grid it
costs more than it buys:

- Recordings can scope its upload token to `recordings/<REC-id>/` because the record already exists
  when the upload starts. A plan sheet is CREATED by its upload, so the broker needs a pre-minted
  empty sheet doc plus a client callback to finish it — a half-created-sheet failure state the
  action never had.
- That callback is the problem. Vercel cannot reach localhost, so `upload-completed` never fires in
  dev and the client has to confirm the write — which means the client names the stored path. See
  below for why that is the one thing this change refuses to introduce.
- It cannot be exercised on a dev machine at all (Vercel Blob refuses writes from a development
  environment: "OIDC is enabled for this project, but not for the development environment").

The broker stays the documented upgrade path, Jeff-gated, for when a real drawing exceeds 4 MB often
enough to be worth that complexity.

**The Grid has no untrusted-`blobPath` problem, and this change keeps it that way.** #143 had to add
`ownsVendorQuoteBlobPath` because a vendor quote's path round-trips through the browser. It was
checked here: the Grid's `blobPath` is minted by `putBlob` inside the server and read back off the
`grid_sheets` doc by the proxy, it never crosses the wire, and `grid_sheets` is not in `SYNCABLE_SET`
so `/api/sync/push` cannot plant one either. So the route does the WHOLE job — bytes to storage and
the doc written server-side — and returns only a sheet id. Copying #143's shape literally (route
returns a path, save action re-validates it) would have *created* an arbitrary-read primitive over
the private Blob store in order to fix an unrelated size bug. Three spec assertions pin the property.

**SVG plan sheets are refused.** Found while rewriting the type gate: `/api/grid-sheets/<id>` streams
a sheet INLINE under its stored mime with no `content-disposition` — it has to, the editor paints it
as a canvas background — so an accepted `image/svg+xml` sheet opened top-level would have run its own
script in the app's origin against the signed-in session. The vendor-quote proxy escapes this by
forcing `attachment`; a background image cannot, so the refusal lives at upload time with its own
message rather than the generic one.

**Verification.** `scripts/smoke-grid-sheet-upload.ts` (`npm run test:smoke:grid-sheet`) posts real
multi-megabyte bodies at a real `next dev` on a scratch datadir: a 2 MB sheet is accepted and read
back byte-identical, a sheet just under the cap is accepted, 5 MB is refused with our own 413, an SVG
with our own 415, and every refusal is proven to have written nothing. Only the in-database data-URL
FALLBACK branch is exercised — the Blob branch cannot be run locally (see above) and is first
exercised in production.

**Not done:** `src/app/(app)/catalog/actions.ts` carries the identical defect —
`MAX_DATASHEET_BYTES = 8 * 1024 * 1024` in a server action, with a comment saying it mirrors the
Grid's cap. It is logged as its own item rather than folded in here.

## D178. Task-template CSV import replaces a set's lines wholesale — it never appends (#145, D169, 2026-09-22)

*Renumbered 2026-09-22: written as D174 during Task 10. `origin/main` had independently claimed
D174 for "Quartzite native shell — Capacitor remote/hybrid Phase 1" (itself once renumbered off a
D132 collision, 2026-09-20) while this branch was in flight. Checked against a fresh
`git fetch origin main` before renumbering: D175–D177 (this decision's siblings, immediately below)
are free on both branches and are unchanged; D164–D172 (this item's own decisions) were unused on
both and are used as reserved. Only this one entry moved.*

D169 (spec, `docs/superpowers/specs/2026-09-22-consulting-project-management-design.md`) says
task templates import through the existing Import hub registry (`src/app/(app)/import/`), which
already had a "skip / update / create" mode for every other type. That contract does not by itself
say what "update" means for a type where MANY ROWS make ONE record — every existing writer in the
registry dedupes at the same grain it writes (one row = one contact, one venue, one catalog SKU),
so "update" always meant "patch this one row's fields." A task-template set has no such
per-row identity to patch.

**Default taken: the uploaded file is the source of truth for a set's `lines` (and, see D177,
`appliesTo`).** `find` matches an existing set by normalized name; `update` REPLACES that set's
`lines` with exactly the rows this file carries for it — not merged, not appended. Re-importing the
same file twice leaves the set exactly as it was; dropping a line from the file and re-importing
shrinks the stored set to match. The alternative (append every row that doesn't exactly match an
existing line) was rejected: a template set has no stable natural key for a line to append against
across two different uploads of "the same" spreadsheet (edited row order, a retyped title), so
append-by-default silently doubles every line on the second import of an otherwise-unchanged file —
worse than doing nothing, because nothing flags it. `WRITERS.task_templates.update` /
`ttApplyRow` in `registry.ts`.

## D175. A CSV-minted task-template set's `createdBy` defaults to the fixed string "Import" (#145, D169, 2026-09-22)

`createTaskTemplateSet(input, me)` stamps `createdBy` from `me.name` — the admin editor
(`task-templates/actions.ts`) passes the real signed-in `requireUser()`. The Import hub's server
action (`import/actions.ts`) never captured that value for any existing writer, because no other
type stamps an author from the importing session at all (customers/contacts/venues never touch
`owner` from the admin who ran the import either).

**Default taken: `CommitContext` grew an optional `me?: { name: string }`; when absent (which is
every call today, since `import/actions.ts` was left unchanged), the task_templates writer stamps
`createdBy: "Import"`** rather than threading the real session user through — matching the
existing precedent (no writer attributes authorship from the import session) rather than making
this one type the first exception. `CommitContext.me` is there, unused by `import/actions.ts`,
for a follow-up that wants the real name instead.

## D176. "Create" mode against a colliding task-template-set name always mints a second, distinct set (#145, D169, 2026-09-22)

The catalog writer's "Create new" on an existing SKU is a merge, because a SKU IS the document id —
two documents sharing one SKU is structurally impossible, so a merge is the only thing "create" CAN
mean there. A first pass at the task_templates writer copied that shape (re-look-up the set by name
on `create`, merge into whatever it found) without checking whether the same constraint holds — it
doesn't: `createTaskTemplateSet` mints an independent sequential `TT-###` id unrelated to `name`, so
two sets sharing a name is a perfectly ordinary, distinct pair of records (review, 2026-09-22:
flagged as the round's one Critical finding — an admin re-uploading an old export, or two people
naming a set the same thing, silently destroyed the existing set's lines with no error and nothing
distinguishing it from a normal successful create).

**Default taken: "create" mode never merges into a set that pre-existed before the file was
opened.** It ONLY ever merges into a record this SAME commit already started (the multi-row case —
several rows for one brand-new set in one file) — tracked by `ttCreatedThisCommit`, a set of ids
minted during the current `commitImport` call. That same set is also why `find` hides a
just-created id from the generic skip/update dispatch: without it, row 2 of a brand-new multi-line
set would "find" row 1's fresh record and — under "skip" mode — skip every row after the first,
truncating a set the file never asked to be partial. Verified for all three modes (skip/update/
create) against both a brand-new and a pre-existing set name, DB-backed, in
`scripts/test-review-and-spec.ts` (`#145 T10`).

## D177. A blank "Applies To" column on re-import preserves the set's existing value (#145, D169, 2026-09-22)

Decision D178's replace-by-set default extends naturally to `appliesTo` (also set-level, also
recomputed from the file's rows) — but unconditionally wiping it to `rec.appliesTo = []` whenever a
row's Applies To cell was blank meant a file exported for one purpose (e.g. bulk-editing every
line's Phase) and re-imported without remembering to fill in Applies To on every row silently
disabled the set: it stops appearing in every "Apply template" picker, and the failure is invisible
until someone goes looking for a set that used to be there (review, 2026-09-22, Important 3).

**Default taken: a blank Applies To column means "the file doesn't say," not "clear it."** A
per-commit accumulator (`ttAppliesAccum`, separate from the set's own `appliesTo` field) unions only
what the file's rows actually specify; if that union is still empty once a set's rows are all
processed, the set's Applies To is left exactly as it was before the commit
(`ttOriginalAppliesTo`, captured once per set before anything is touched). The moment any row in
the file DOES specify one, that replaces wholesale as D178 already does for `lines` — this only
protects the "the file never mentions it at all" case, not "the file says something different."

## D164. Consulting project management attaches to the existing `CE-####` engagement (#145, 2026-09-22)

Spec: `docs/superpowers/specs/2026-09-22-consulting-project-management-design.md`. Task templates,
scheduling, the Activity tab and per-person portfolio work all hang off the engagement record that
already exists (`src/lib/stores/engagements.ts`), not a new record and not the install `Project`.

**Why:** the engagement already carries client, sites, people-with-roles, phases, fees and the
document trail. A parallel record would duplicate all of it and force a "which one is the project"
decision on every screen that touches consulting work — the customer record, the quote, the
Activity tab, the schedule.

**Rejected alternative:** a new, dedicated project-management record for consulting engagements,
separate from `CE-####`. It lost because nothing it would hold isn't already on the engagement;
the only thing it would add is the duplication problem above.

## D165. Scope is phases × disciplines, with a blank discipline matching every discipline (#145, 2026-09-22)

A task-template line is tagged with a phase and optionally a discipline. An engagement expands only
the lines whose phase it has and whose discipline it bought. Phases already flow from the consulting
quote (`design/engagements/quote/actions.ts:69`); disciplines are new on the quote builder, reusing
the intake four (`survey-intake.ts:124`: rigging/curtain/lighting/av), and are admin-editable in
Settings (`consultingDisciplines: string[]`) the same way the phase list already is.

**A blank discipline matches every discipline**, deliberately — this is what lets a phase-only
template (an admin-authored checklist that doesn't care about trade) work on day one, before anyone
has gone through and tagged every line by discipline.

**Rejected alternative:** free-text `ConsultingScope` lines (the engagement's existing scope-of-work
strings) as the template key instead of a controlled phase/discipline pair. Rejected because free
text cannot key anything — there is no way to match "Rigging inspection and reporting" typed once
against a template line without either exact-string coupling (breaks the moment either side is
reworded) or fuzzy matching (silently wrong some of the time, in a system whose whole point is
correct fan-out).

## D166. Dates are proportional units within a phase window, not absolute days (#145, 2026-09-22)

The engagement carries a typed `startAt` and `endAt`. Selected phases carry weights
(`consultingPhaseWeights: Record<string, number>` in Settings) that divide that span into windows;
a task-template line carries a start percentage and a length percentage **within its own phase
window**, not within the whole engagement. `phaseWindows()` / `placeTask()` in the new
`src/lib/consulting-schedule.ts` (zero imports, pure) do the math:

```
window(phase)  = [ start + span × (Σweights before) / Σweights,
                   start + span × (Σweights through) / Σweights ]
task.startAt   = window.start + windowLen × startPct  / 100
task.dueAt     = task.startAt + windowLen × lengthPct / 100
```

A longer engagement gives every task proportionally more room; dropping a phase redistributes the
remainder in proportion rather than stranding tasks at stale absolute positions.

**Rejected alternative 1: whole-project percentages** (a task's position expressed as a percentage
of the entire engagement, ignoring phases). **This breaks on scope change** — the moment a phase is
added or dropped after tasks are placed, every whole-project percentage still points at the same
fraction of a span whose composition has changed underneath it; a task meant to sit at "20% into
Design Development" drifts to wherever 20%-of-the-whole-project now falls, which is a different
phase entirely once Bid Support is added or removed. Per-phase windows contain that drift inside
the one phase whose scope actually changed.

**Rejected alternative 2: task-weight chaining** (each task's start derived from the previous task's
end, engagement-wide, like a critical path with no parallelism). Rejected because it forces every
task serial and forbids rigging and curtain running the same week — two disciplines that routinely
do exactly that. Proportional placement within a phase window lets tasks in the same phase overlap
freely; only the phase boundaries are ordered.

**Degenerate inputs**, handled in the engine and pinned by tests: `endAt <= startAt` → zero-length
windows, every task lands on `startAt`, blocked at creation with a validation message rather than
generating a degenerate schedule silently; a phase with weight 0 or absent → weight 1; `Σweights = 0`
→ equal division; `startPct + lengthPct > 100` → the bar clamps to the window end rather than
spilling into the next phase.

## D167. Milestones are locked; tasks are freely draggable (#145, 2026-09-22)

Milestone dates are computed once, at schedule creation, and then fixed — editable only from the
engagement's main screen, not from the Gantt. Tasks are freely draggable on the Gantt with no
confirmation dialog.

**Why:** this replaces what would otherwise be a pin/re-flow arbitration problem (what happens when
a locked item and a movable item disagree about a date). Splitting the two into "moves only
deliberately, from one screen" and "moves casually, with no friction" means the two layers never
fight, because only one of them moves casually. A milestone that needs to move goes through D168's
explicit shift instead.

**Rejected alternative:** milestones and tasks both draggable on the Gantt, with some reconciliation
rule for when a drag would move a milestone past its own dependent tasks or vice versa. Rejected as
the more expensive path for no real gain — Jeff's billing milestones are deliberate commitments, not
things that should casually slip because someone fat-fingered a drag.

## D168. A milestone gains a `phaseId`; moving it offers to move that phase's tasks — but never ripples past it (#145, 2026-09-22)

Milestones (billing, seeded from free-text `ConsultingScope` scope lines) and phases (structure,
carrying the tasks) are different lists, so `EngagementMilestone.phaseId: string | null` makes the
link explicit rather than inferred. The shift dialog pre-ticks that milestone's phase's tasks as an
adjustable checklist. **Hand-dragged tasks are excluded from the pre-tick** — a task moved by a
person for a reason the app cannot see is never moved again by the app on the next milestone shift.

`phaseId` defaults by exact name match (case-insensitive, trimmed) against the phase list, else
`null`; a milestone with a null `phaseId` still moves, its shift dialog simply pre-ticks nothing,
degrading to the manual checklist rather than guessing which tasks belong to it. `targetDate` for a
phase-matched milestone is computed at creation from that phase window's end date — a deliverable is
due when its phase finishes; a milestone with a null `phaseId` keeps `targetDate: 0` and stays
unscheduled until dated by hand.

**Rejected alternative: rippling every later milestone and task forward when an earlier milestone
moves** (the conventional project-management default). **This moves the wrong half of the
schedule.** The work that actually slipped sits *before* the deliverable that just moved — the
milestone moving is the symptom, not the cause — and what would actually need to ripple in response
to a real-world slip is the bid schedule feeding into the *next* milestone, which is usually the one
date Peak does not control in the first place (it's the client's or the AHJ's). Rippling everything
after the moved milestone would confidently move dates Peak has no basis to move, while leaving
untouched the dates that actually caused the shift.

## D169. Task templates import by CSV through the existing import registry, not a new importer (#145, 2026-09-22)

A `task_templates` import type is added to the registry (`src/app/(app)/import/types.ts`,
`registry.ts:973`) rather than a bespoke importer for this one record type. Example-row download,
alias auto-mapping, preview→confirm and dedupe are all inherited for free. Rows are validated
against the live phase and discipline lists; unknown values are surfaced (see D178/D174–D177 for how
the "replace vs. append", authorship and blank-column defaults were resolved once the registry's
existing per-row skip/update/create contract turned out not to say what "update" means for a type
where many rows make one record).

**Rejected alternative:** a dedicated `/task-templates` CSV upload endpoint outside the import
registry, built to fit the templates' many-rows-one-record shape from scratch. Rejected because the
registry's inherited machinery (preview, dedupe, alias mapping, the CSV-template download) is exactly
what an admin authoring the first real template sets needs, and duplicating it for one type buys
nothing.

## D170. One Activity tab, with a composer that emits a note, files and tasks together as one linked action (#145, 2026-09-22)

A single composer — body text, dropped files, checkable lines that become assigned, dated tasks —
writes a `NoteRecord` carrying `attachments: FileRef[]` and `taskIds: string[]`, plus the tasks
themselves, in one server action. The three records stay linked, so a task's origin is answerable
six months later by following `taskIds` back to the note that spawned it.

The feed merges, newest first: notes (with their spawned tasks and files inline), meetings,
decisions, phase attachments, and milestone-move notes. A milestone move (D168) writes a
**system-authored note** into this same feed rather than introducing a separate history table —
one feed, one record shape, one place to look for "what happened on this engagement." Task lines
are ticked by a human; nothing is auto-extracted into them.

**Krisp/meeting pre-fill (#145 Task 8, landed as a fast-follow rather than in this composer's
original commit):** `prefillFromMeeting` (`src/lib/engagement-activity.ts`) seeds the composer's
body from a meeting's minutes, with attendees surfaced as a caption for the human to read. It's
reached from two entry points — the Meetings tab's "Capture to Activity" link, and a Krisp
recording's "Capture to engagement" action — both landing on `?tab=activity&prefill=<id>`; the
`[id]` page resolves `<id>` against `eng.meetings` first, then (only when needed) projects a linked
Krisp recording's summary into the same meeting shape via a server-computed prop, never importing
the recordings store into a client component. The prefill param is cleared with `router.replace`
once seeded, so a refresh can't re-seed over edits. Body only, matching this decision's own rule
above — the pre-fill never touches task lines; those stay ticked by a human.

**Rejected alternative:** separate, unlinked flows for adding a note, uploading a file, and creating
a task, the way most of the app's other record types already work. Rejected because it is exactly
what makes "why does this task exist" and "what was decided in this meeting" unanswerable later —
the whole point of this decision is that capture-time context is cheap to keep and expensive to
reconstruct.

## D171. Attachments write through a `FileRef` union; Drive is upload-only, no picker (#145, 2026-09-22)

```ts
type FileRef =
  | ({ kind: "drive"; fileId: string; webViewLink: string } & FileMeta)
  | ({ kind: "blob";  pathname: string }                    & FileMeta)
  | ({ kind: "data";  dataUrl: string }                     & FileMeta);
```

One union, resolved at write time by what is configured: Google Drive when connected
(`ensureFolder` building `Peak Projects / <customer> / <CE-id>`, caching the folder id on the
engagement), Vercel Blob when Drive isn't connected, a data-URL as the last-resort local fallback.

**No Drive picker in this slice** — letting a user attach an *existing* Drive file (rather than
uploading a new one through the app) needs an OAuth scope beyond `drive.file` and a Google
consent-screen change, both of which are Jeff-gated infrastructure decisions, not code. **No
vendor-quote Blob→Drive migration here either** — that migration touches live production data
behind an authenticated proxy and is deliberately its own slice (slice 3), off the critical path of
a scheduling feature.

**Rejected alternative:** build the Drive picker and the vendor-quote migration into this slice
so attachments are "done" in one pass. Rejected on scope grounds — neither blocks anything this
spec needs, and both carry their own review risk (a broadened OAuth scope; a live-data migration)
that shouldn't ride along with a scheduling feature's review.

**Verification caveat (added at merge, 2026-09-22):** the Drive leg is **not proven end to end**.
`uploadToDrive` issues the first **browser-direct** Drive PUT in this codebase — `drive.ts`'s
`uploadFileResumable`, used by the Recordings archive in production, does the equivalent transfer
server-side. A stubbed `fetch` proved the response parsing; nothing has proved Google's resumable
endpoint accepts a cross-origin browser PUT, specifically the CORS preflight on a non-simple
`Content-Type`. That needs a real OAuth connection, which does not exist locally. The Blob and
data-URL legs are verified byte-exact. If the preflight is refused in real use, the fallback is to
proxy the bytes server-side as the archive already does, accepting the ~4.5 MB function-body
ceiling. Tracked as "Open, for Jeff" item 6 on PUNCHLIST #145.

## D172. Consulting ships first, on a parent-agnostic engine; install Projects are not touched (#145, 2026-09-22)

The new scheduling engine (`src/lib/consulting-schedule.ts`) takes primitives — dates, phases,
weights, template lines — not engagements, which is what makes wiring a second parent type in later
a connection job rather than a rewrite. Install `Projects` keep their existing, separate,
stage-keyed `TASK_TEMPLATE` (`tasks.ts:67`, the shape Jeff reviewed in Aug 2026) untouched.

**Why:** phases (consulting's axis) and stages (installs' axis) are different concepts that happen
to sound similar; reconciling them into one model while simultaneously building the scheduler that
depends on the reconciliation being right is the expensive, riskiest path, and nothing about
installs asked for this feature. The engine's zero-import, primitives-in shape means Projects can
plug into it later without the engine itself changing.

**Rejected alternative:** design one unified phase/stage model spanning both consulting and install
work from the start, so the scheduler serves both from day one. Rejected because it would have
required settling a phases-vs-stages reconciliation nobody has asked for yet, as a prerequisite to
shipping the scheduler at all — the expensive path, taken on for a benefit (install scheduling) that
is out of scope for #145 (D172 itself, restated: install `Projects` are explicitly out of scope,
reachable later through this same engine's seam).

## D179. Customer addresses are recovered by re-exporting from Daylite, matched on name (#147, 2026-09-22)

The July 2026 Daylite export carried `City` and `State/Province` and no street address, in any of
its four files, so 1,550 companies landed with nothing to geocode. Jeff confirmed Daylite itself
holds the addresses — the export template simply omitted them. Rejected: the Daylite API (new
credentials and an integration for a one-time job) and hand-entry (1,550 rows). The re-export is
matched to the existing records by the deterministic company id, so it enriches rather than
re-imports.

## D180. The Daylite id helpers live in one module, imported by every tool that needs them (#147, 2026-09-22)

`norm`/`hash`/`companyId` were private to `scripts/import-daylite.ts`. Every id the import produced
is a pure function of a company NAME, so any later tool that wants to find those records has to hash
names identically. A second copy that drifted by one character would not throw — it would match zero
rows and report a clean, successful, completely empty run. They now live in `scripts/daylite-ids.ts`
and must never be "improved": 1,723 companies and their contacts, leads and projects are already
stored under these ids.

## D181. Enrichment uses targeted UPDATEs, never an upsert (#147, 2026-09-22)

`saveCompany`/`saveSite` both have an insert path (`onConflictDoUpdate`), so a company renamed in
Daylite since the export would silently gain a brand-new empty record instead of raising. A direct
`UPDATE` cannot create anything: a statement matching no row is reported by name and skipped. This
is also how the partner case surfaces — 387 of 1,723 companies have no venue at all (the import
skips partners), and they get a company mailing address while staying venue-less rather than having
a venue manufactured for them that would pollute the venue directory and the schedulers.

## D182. App-entered addresses beat the Daylite export; manual travel overrides are never touched (#147, 2026-09-22)

The export is from 2026-07-22 and anything typed into the app is newer, so the app is the system of
record: a venue that already has a street address is skipped and counted, with `--overwrite` to flip
it. Manual `travelMiles`/`travelMin` outrank everything in `estimate()`'s chain, so those venues will
not reprice no matter what coordinates are stamped — the count is reported explicitly rather than
left as a silent surprise.

## D183. The backfill warms the OSRM route cache as a distinct phase (#147, 2026-09-22)

Coordinates alone leave travel on the haversine tier (`source: "auto"`): a straight-line distance
times a road factor. Only a cached OSRM route makes it `"routed"`. So phase 2 fetches the real route
from the quote origin for every geocoded venue and writes it to `geo_cache`. It aborts up front when
Settings → Locations has no office with coordinates marked as the quote default, rather than running
for an hour to no effect. Both phases dedupe first — 990 venues collapsed to 293 distinct lookups.

## D184. Geocoding is a bounded, resumable batch job shared by the CLI and the admin UI (#147, 2026-09-22)

Nominatim's usage policy is 1 request/second and the book is ~1,300 venues, so the whole job cannot
run inside a server action. The logic lives in `src/lib/geo-backfill.ts` with a `limit`; the CLI is a
thin wrapper and Settings → Beta calls it 10 venues at a time, looping on `remaining`. Both phases
skip work already done, so an interrupted run resumes by being run again. One mechanism serves the
one-time backfill and every future import.

## D185. Geocoding is gated on state AND city, and city-only rows use Nominatim's structured query (#147, 2026-09-22)

A state-only check is not enough. In the first run against real data, free text returned **Portage
County** for `Portage, WI` (63.7 mi from the City of Portage) and **Town of Baraboo** for
`LaCrosse, WI` (79.6 mi from La Crosse) — both in Wisconsin, both waved through, travel reading
148 mi for Portage against a real 103. So the resolved city must BE the stated city, compared after
normalizing (lowercase, drop a leading "City/Town/Village of", expand `Mt.`→Mount / `St.`→Saint /
`Ft.`→Fort, strip punctuation) and compared EXACTLY — never a prefix test, since "Portage County"
starts with "Portage". City-only rows additionally use Nominatim's structured `city=`+`state=` form,
which resolves Portage to 0.2 mi and honestly returns nothing for "LaCrosse". A confident wrong
answer misprices a quote; a reported miss costs a minute with the existing address picker.

## D186. Grid options are a tag on placements/routes, not nested documents; Manual intake asks venue + dims only (2026-09-21)

Spec `docs/superpowers/specs/2026-09-21-grid-options-and-intake-branch-design.md` (Spec 1 of 3
from Jeff's 2026-09-21 Grid brainstorm — Auto branch and proposal document follow).

- **Options as first-class variants.** A Grid project holds `options[]` (Good/Better/Best or
  user-named); placements and wire routes carry `optionId`; sheets, calibration, spaces,
  intake, scope inputs and revisions are shared. Chosen over revisions (history, not variants)
  and sibling projects (no way to send three as one document). Tagging beats nesting: every
  existing store function, BOM/riser/schedule library and revision snapshot keeps its shape;
  consumers filter by `optionSlice()`.
- **Read-side migration only.** Legacy docs normalize to one option `opt-base` named
  "Design" that inherits `project.quoteId`; untagged members belong to it. `project.quoteId`
  stays as a mirror of the first option's quote so pre-spec readers are untouched.
- **One draft quote per option**, named `<project> · <option> — The Grid design` when the
  project has more than one option. Pricing moved verbatim into
  `src/lib/design/grid-quote.ts` (`buildGridQuote`) so it can be tested per option on a
  scratch DB (`npm run test:grid-options`).
- **"Generate starting layout" removed from the editor** (D149's UI). It painted placeholder
  devices and ignored the chosen tier — the thing Jeff hit on 2026-09-21. `grid-seed.ts`
  and its action stay for Spec 2's real generator; the quote guard against unresolved
  placeholders stays because the punch branch's preview deploy may have written some.
- **Manual intake = venue type + dimensions, then mode + cover page.** Systems/tier/brief
  and the "Generate from measurements" checkbox are gone; the base sheet is always generated
  from dims; the first save also seeds `scopeInputs` (venue preset ∩ the five trackable
  systems) and patches the linked DesignRecord's name/venue/size/dims. Auto-estimate is
  shown greyed ("Next release") so the flow's shape is visible before Spec 2 enables it.
- **Entry points unchanged for now** — "New design" keeps Quick canvas / Manual layout until
  the Auto branch exists (Spec 2), otherwise there'd be no way to auto-estimate a new design.
- Known, deliberately untouched: `DesignRecord.budget` is still never written for manual
  designs (pre-existing, #38 plan recon item 7).
- Revisions now snapshot the options list; on restore the option list and membership come
  back but each surviving option keeps its CURRENT quote link and `project.quoteId` is
  re-mirrored (quote links are bookkeeping, not design state).
- The Designs dashboard's "Add to Quotes" (`promoteDesignAction`) quotes the FIRST option;
  per-option quoting is done from the editor. Stated limitation until Spec 3's proposal
  document.
- The delete confirm reads "Removes N devices and their wire runs from X" (device count
  only; route count isn't tallied in the switcher). Option names are capped at 40
  characters.

Follow-ups (not blocking): a refused member write (unknown optionId) still bumps the doc's
rev/seq via `patchDoc`; a guard helper could dedupe the 4 in-callback `hasOption` checks;
`OPTION_GONE` is duplicated in `grid-quote.ts` (move to `grid-options.ts`); no automated
coverage of `createDraftQuoteAction`'s branching or the intake's DesignRecord patch
(session-bound); `optionSlice` mutates its argument (safe today, callers pass normalized
docs); whole-project device counts on the `/design` orphan list and the revisions panel;
the Rigging Scope target of $1.8M for a 46 ft Auditorium is pre-existing D139 engine math
to check.

## D187. The DaVinci ETC library is not imported (#158, 2026-09-22)

> **SUPERSEDED by D208 (2026-09-23).** The conclusion below is wrong: every check behind it ran
> against local dev (10 ETC rows), not production (3,959 ETC rows, all priced), where the
> intersection is 86.5% by entry, 73.7% by usable data. The reasoning is kept intact as the
> record of how it went wrong.

Ports for Peak's catalog are curated, not sourced from the DaVinci export
`promote-sales-compliance` proposed (`data/davinci/`, 116 MB, 2,366 device types, 1,381 with
ports, 56 port protocols, 25 connector types). It does not intersect Peak's catalog: verified
four independent ways — model-number prefixes among ported types are ETC product lines;
the only manufacturer-bearing property among 455 property types has choices like "ETC Rep";
brute-force matching of all 17,831 identifier-shaped strings in the 42 MB `library.json`
against all 14,725 SKUs found 9 matches (8 ETC, one false positive, `QSC:SP-36` ↔ `SP3-6`);
a brand-name search across 316,115 human-readable strings found `ETC 1606` and zero hits for
Shure, Biamp, JBL, RCF, EAW, QSC, Chauvet, Symetrix, Bose, Listen or AKG. Peak stocks 10 ETC
parts against a catalog that is Shure (1,303), Biamp (1,148), JBL (822), RCF (597), EAW (556),
AVPro Edge (460), QSC (389), Chauvet (382). Importing the library would add ~1,381 unpriced ETC
devices Peak does not sell while leaving all 14,725 real parts exactly as unwireable as before.
Jeff confirmed 2026-09-22 this is the full export available to him.

Recorded so this is not re-litigated: the analysis above is cheap to repeat and was repeated
twice already.

## D188. Ports are edited through a client island serializing to one hidden JSON field (#158, 2026-09-22)

Not through indexed FormData names (`port.0.name`, …). Indexed names would keep the no-JS
purity of `PartFormModal`'s plain `<form action={upsertPart}>`, but make "add a row" a server
round trip, and a device with eight ports is ordinary. The island renders the rows and keeps
them in one hidden `ports` input (JSON); `upsertPart` stays a flat FormData action that parses,
validates, and passes `ports` through to `mergeUpsert`. `CatalogPart.ports?: Port[]` already
existed and `mergeUpsert` already took it, so there is no store or schema change — the #39
importer writes this same field today.

The subtlety that motivated shipping this carefully: `mergeUpsert` is `{ ...existing, ...patch
}` — a key present in `patch` always wins, a key absent from `patch` leaves the existing value
alone. Before this work `upsertPart` never sent `ports`, so an ordinary price edit correctly
left them untouched. Now that the form owns ports it must send the field on every save,
including an empty array — the hidden input renders on every render, even at zero rows —
otherwise deleting a part's last port would silently leave the old ports in place, wiring the
part in a way the UI says it cannot.

**Deviation (AGENTS.md: "Deviations get a DECISIONS.md entry"):** the catalog row's badge
wrapper (`src/app/(app)/catalog/page.tsx`, around line 390) was gated on `(p.note ||
p.datasheetBlobKey)`; it is widened to `(p.note || p.datasheetBlobKey || (p.ports?.length ?? 0)
> 0)`, because otherwise a part with ports but no note and no datasheet would never show its
badge — defeating the §4.5 goal that "which of my parts are wireable" be answerable by looking.

## D189. Connection types are a closed vocabulary at every layer (#158, 2026-09-22)

`connectionType` is selected from `CONNECTION_TYPES`, never typed. `validateDeviceWire` and
`compatibleWireTypes` both resolve against that 22-entry taxonomy, and a typo would not merely
look wrong — it would make the device silently unwireable against everything, with no error
anywhere, the same class of failure as a confidently-wrong geocode. The select constrains, the
server re-checks membership and rejects unknown values rather than trusting the client (the
hidden field is user-editable in the DOM), and neither layer trusts the other. Invalid rows fail
the save with a message; they are never silently dropped.

## D190. Ports are user-editable, not admin-gated (#158, 2026-09-22)

Editing ports requires `requireUser()` — the same bar as editing a part's price or description.
Ports are ordinary catalog data, and the point of this work is that the team can make a device
wireable without a developer. Deliberately *not* admin-gated, unlike datasheet attach (which
writes to blob storage) and the Categories & trades card (which rewrites a shared taxonomy):
ports are per-part and correctable in place.

Reversible in one line if Jeff would rather restrict it; flagged here because it is arguable,
since ports do feed quote validation and the cable BOM.

## D191. The bulk pass is a re-runnable rules engine producing review worksheets, never a direct import (#158, 2026-09-22)

`scripts/draft-starter-set.ts` was described in an earlier spec draft as a drafting engine
"run across 68 items." That was wrong: it is a hand-curated pick list — a human chose each of
68 SKUs and read each description to pick a port shape from helpers like `consolePorts()` /
`poweredSpeakerPorts()` / `matrixPorts(inN, outN)`. There is no manufacturer filter to point at
more brands; the picks *are* the content. Extending it to eight manufacturers would mean
hand-writing several hundred `{ sku, ports }` entries against price-sheet descriptions — the
same manual work as the editor, with worse domain knowledge.

Phase 2 is therefore a ports rules engine, with its own spec: description/category → port
shape, with a confidence flag per row, applied across the catalog and re-runnable as the rules
improve, producing review worksheets rather than a direct import. It is deliberately designed
*after* Phase 1 (the editor) ships, so the rules can be derived from the shapes that actually
recur in the models Peak places rather than from guesses. Everything it produces stays
correctable in-app afterwards — #39's "Jeff reviews before import" gate holds.

## D192. Biamp and JBL are out of scope and reported, not silently skipped (#159, 2026-09-23)

Across the eight manufacturers Jeff named, Biamp (1,148 parts) and JBL (822) have no usable
`desc` field at all — it's a bare model or part number (Biamp's are `330.0057`, `650.0101`;
JBL's are `AC115S`, `PD544`). There is nothing to read, so no rules engine can classify them.
Together with the smaller description gaps at other brands, that is 2,271 parts the engine
cannot reach. They remain editor-only (#158) until their price books are re-imported with real
product names. The engine's report names the count per manufacturer every run so the gap stays
visible rather than disappearing into a denominator.

## D193. The reviewable unit is the rule, not the part (#159, 2026-09-23)

The bottleneck is not inference, it's review. July's starter worksheet was 68 rows and sat
unreviewed for two months; a thousands-of-rows version of the same artifact would be worse, not
better. So the reviewable unit is the rule:

> `/passive.*(subwoofer|sub)/i` in EAW's `SB` category → one `speakON NL2` in — **187 parts**

Approve, edit or reject the rule; the verdict applies to every part it matched. Review effort
scales with rules (~13) rather than parts (thousands).

A rule is also checkable in a way a row is not. Jeff can read "passive subwoofer → speakON NL2
in" and know from experience whether it's right, and that judgement covers 187 parts at once —
reading 187 individual rows would tell him nothing he didn't know after the first three.

It degrades honestly, too: a rule he's unsure of gets rejected and its parts stay portless — the
current state, not a regression. Rejected alternatives: a row-level worksheet (the artifact that
already went unreviewed for two months) and an in-app accept/reject queue (most of the build,
still row-by-row).

## D194. Port shapes live in one shared module (#159, 2026-09-23)

The 21 shape helpers move verbatim from `scripts/draft-starter-set.ts` into
`src/lib/catalog-port-shapes.ts`, which `draft-starter-set.ts` then imports. One copy, for the
same reason `scripts/daylite-ids.ts` exists: two drifting copies of domain knowledge produce a
clean-looking run that is quietly wrong. Pure — no DB, no React, no catalog types beyond `Port`.

## D195. Accessory exclusion is an explicit first-class rule layer, and its matches are reported as handled, not as failures (#159, 2026-09-23)

A leading accessory layer (`cover|bracket|mount|cable|barndoor|grille|case|…`) matches first and
yields no ports, deliberately. 907 of the 5,657 in-scope parts are accessories; without this
layer a bracket described as "Horizontal Bracket for MR50" can fall through to a speaker rule
and be given speaker ports. An accessory match is a success, reported separately from "no rule
matched" — conflating the two would hide real coverage gaps behind a pile of correctly-ignored
brackets.

## D196. Hand-edited ports always beat the engine, and no rule applies without being named explicitly (#159, 2026-09-23)

Nothing is applied by default. Only the rule ids named on the command line run — there is no
"apply all." A part that already has `ports[]` is skipped, always: hand edits win over the
engine, unconditionally. The engine only fills blanks, writes `ports` and nothing else — never
prices, categories or descriptions — and is idempotent, so re-running an already-applied rule is
a no-op and improving a rule and re-running costs nothing. Hosted writes go through the existing
`resolveDbTarget`/`requireHostedConfirmation` gates, like every other script that writes. #39's
"Jeff reviews before import" gate holds: the report is the review artifact, and approval is the
`--rules` list.

## D197. Three new port shapes are added deliberately as part of this work (#159, 2026-09-23)

`amplifierPorts`, `wirelessReceiverPorts` and `dspPorts`. Adding a shape stays a human act, not
something the engine does — these three are named here, reviewed alongside the rules that use
them, and cover the parts that are classifiable by device class but had nowhere to land before
this work (an earlier estimate of ~780 parts coverable by the pre-existing 21 shapes rose to
~1,170 once these three were added). Any further shape needs the same treatment: named,
reviewed, and justified against real descriptions, not invented by the engine.

## D199. The shipped rule set is corrected against the real catalog (#159, 2026-09-23)

A review of the shipped rule set (`abb0f19`) measured against the live 14,725-part catalog found
~108 of 985 proposed parts wired wrong and ~45 real devices silently filed as accessories.
Worst: `amplifier`'s bare `\bamp\b` matched "Bi-Amp" inside passive-speaker descriptions, wiring
61 passive speakers with 4× speakON NL4 outputs and a control network instead of one speakON
NL2 input; the accessory layer swallowed ~45 real devices (both PTZ cameras, 20 wireless
receivers, 13 amplifiers) for mentioning their own bundled mount or cable; and `speaker-70v`
gave 9 QSC power amplifiers a 70V speaker input, backwards. Three rule notes also asserted the
opposite of what their regex did — a spec failure in itself, since the note is what a human
reads to decide whether to approve the rule.

Fixed in `c0a4036`: `amplifier` now requires the whole word "amplifier" (or "power amp", or a
power-amp spec line), never the bare token "amp"; the accessory layer is restructured to claim a
part only when a device noun does not precede the first bundling word, rather than matched by a
flat word list; `speaker-70v` and others gained category/context guards; every rule note was
rewritten to state what its regex actually does. Measured effect: the matched-by-a-rule count
moved from 1,439 to 1,391 — 249 rows stopped receiving a wrong shape, 32 became newly correct,
and 101 accessories were restored. The total going down is the point: the rules claim less and
are right more often. 1854 PASS / 5 FAIL (baseline 1825/5; 29 new assertions, same 5
pre-existing fresh-datadir seed races).

**D198 is deliberately skipped.** The commit above (`c0a4036`) was already pushed citing "D199"
before this numbering was reconciled during bookkeeping, and commit messages can't be rewritten
— a numbering gap here is less confusing than a decisions log that disagrees with git history.

## D200. The apply CLI shares the report's eligibility filter, and `--commit`/`--yes` replace a doubled `--yes` gate (#159, 2026-09-23)

A gate review of the port-rules engine (`c0a4036`) found two independent problems and fixed both
in `458f8dc`:

1. **The apply path wrote rows the report never showed.** `isModelish()` — the check that skips
   a bare model/part-number description — lived only in `scripts/port-rules.ts`'s report, not in
   `src/lib/catalog-port-apply.ts`'s `applyRules()`. A dry run against the shipped rule set would
   have written 90 more rows than the report ever displayed for approval (1,481 vs 1,391),
   breaking the feature's whole contract: approving a rule on the strength of the report would
   not have meant what the report showed. Fixed by moving `isModelish` into
   `catalog-port-apply.ts`, exporting it, and having the script import that one copy instead of
   keeping a second. Report and dry-run apply now agree exactly, per rule, at **1,390**.
2. **The hosted-write gate was dead code.** `--yes` both triggered the write and satisfied
   `requireHostedConfirmation`'s own bypass, so a hosted `--apply --rules … --yes` had no real
   second gate against the shared Neon database (see the standing "preview writes production"
   hazard). Adopted this repo's existing two-flag convention (`scripts/enrich-addresses.ts`):
   `--commit` triggers the write, `--yes` is the separate hosted confirmation.

Also fixed in the same commit: `speaker-70v` lost its bare-`amp` exclude guard in the same D199
edit that correctly removed it from `speaker-passive`; restored on `speaker-70v` only, which
corrects the one row it affected (`Shure:MXN-AMP`, previously given a backwards 70V input). A
"Known gaps" section was added to the report itself, printed after the totals, so the caveats
below don't require reading a commit message to find. 1860 PASS / 5 FAIL (baseline 1854/5; 6 new
assertions, same 5 pre-existing fresh-datadir seed races).


## D201. Speaker connectors interoperate, by an explicit opt-in flag — not by wire-type family (#159 gate review, 2026-09-23)

A final review of the port-rules engine found the shipped shapes do not compose: `amplifierPorts`
emits `speakON NL4` **out**, `passiveSpeakerPorts` emits `speakON NL2` **in**, and
`seventyVSpeakerPorts` emits `70V pair` **in**, while `canConnect` required exact
`connectionType` equality. Nothing in the catalog could drive a ported speaker — 854 of the
1,390 proposals affected — and it was a **regression**: with both sides portless the Grid allows
the route today, so applying the rules would have hard-refused wiring an amplifier to a cabinet,
with no override.

**Decided:** speaker connectors interoperate, but narrowly. `WireType` gains an opt-in
`interchangeable?: true` flag meaning "any connector in this family physically mates with any
other in it", and it is set on **`speaker-pair` only** (`speakON NL2` / `NL4` / `NL8` /
`70V pair`). `canConnect(a, b, types = DEFAULT_WIRE_TYPES)` now checks the direction complement
as before, then exact `connectionType` match **or** both types in one flagged family;
`validateDeviceWire` threads the same optional parameter through.

**Rejected: blanket family matching.** `WireType.connectionTypes` answers "what cable carries
this signal", which is a different question from "what mates with what". Treating every family
as interchangeable would have allowed Dante audio → HDBaseT video (both `cat6`), Edison →
Socapex (both `powercon-power`), and motor power → low-voltage pendant control — three wrong
connections bought for one right one. Assertions pin all three as refused, alongside the
direction complement still being enforced *inside* a family (two NL4 outs never connect).

A family match stamps the **from/output** side's `connectionType` (an NL4 amp into an NL2
cabinet stamps `speakON NL4`), which is deliberate: the source end is what the run is terminated
to and what the cable BOM prices. Verified against the live catalog snapshot —
`AVPro Edge:AC-DANTE-AMP-2CH` → `1Sound:CM38 (BLACK)` now returns
`{ ok: true, connectionType: "speakON NL4" }`; before the change it was refused.

This is the only change to shipped #39 code, and every pre-existing `canConnect` /
`validateDeviceWire` assertion still passes unchanged.

## D202. The spec suite refuses to run without a scratch datadir, and a test may only write rows it created (#159 gate review, 2026-09-23)

The same review found `npm run test:specs` — this repo's own mandated gate — would have written
**452 real catalog rows**. `scripts/test-review-and-spec.ts` called
`applyRules(["speaker-passive"], { commit: true })` after creating four `TEST:` fixtures, but
those fixtures are not a scope: `applyRules` walks every row of `catalog_parts`, and
`speaker-passive` matches 452 real parts. The script had no `PGLITE_PATH` guard and the npm
script set none, so it resolved `.data/pglite` — and with an ambient `DATABASE_URL` it would
have written the shared Neon database with no gate at all. (Not triggered: the dev DB still has
exactly 55 ported parts.)

**Decided: guard *and* scope, because either alone leaves a real hole.**

1. **Guard.** `scripts/test-review-and-spec.ts` now throws when `PGLITE_PATH` is unset, modelled
   on `scripts/test-grid-options.ts`, with an error that says the suite writes and gives the
   correct invocation. `package.json`'s `"test:specs"` supplies the throwaway datadir itself
   (`TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" tsx …`, the existing
   `"test:review:regressions"` pattern), so anyone running the documented gate is safe by
   default rather than safe if they remember.
2. **Scope.** `applyRules` takes `opts.onlySkus?: readonly string[]`, which restricts a run to
   exactly those SKUs, and the test passes the four fixtures it created. A guard alone would
   still leave a test able to write 452 rows into whatever datadir it was handed; a test must
   only ever write rows it made. The idempotence assertion still genuinely tests idempotence —
   the second scoped run returns 0 because the fixture it ported now has `ports[]`, not because
   the scope is empty, and a companion assertion pins the skip count.

`applyRules` also gained `opts.mfr`, because `scripts/port-rules.ts` parsed `--mfr=` and then
ignored it in the `--apply` branch: `--mfr=EAW --apply --rules speaker-passive --commit`
reported one brand and wrote all thirteen. That is the same report-vs-apply divergence class
D200 was opened to close, so the flag now narrows both.

## D203. The rules report shows every distinct shape a rule proposes, and its own caveats are counted, not typed (#159 gate review, 2026-09-23)

Two ways the report was quietly lying about itself, both fixed:

1. **One sample's shape stood in for all of them.** The report rendered `proposeForPart(hits[0])`,
   but `shape()` reads the part — channel counts, HDMI vs SDI, in/out counts — so a rule
   routinely proposes several shapes across its matches: `amplifier` 9 distinct, `av-matrix` 8,
   `av-splitter` 4, `dsp` 3, `camera-ptz` 2. `camera-ptz` was the damaging case: 15 parts get
   `SDI/BNC` and 15 get `HDMI`, and the report printed only SDI, so approving that rule would
   have written a connector to half its parts that the reviewer never saw — the spec's core
   promise (review the rule, not the row) failing on its own terms. The report now groups a
   rule's matches by proposed shape and lists each distinct shape with its count and an example,
   largest first, with a single-shape rule still rendered on one line as before.
2. **The "Known gaps" text was hardcoded prose and had already drifted.** It claimed `dsp` had
   "57 rows … 46 of its rows are amplifiers"; measured against the live catalog, `dsp` matches
   **38** rows, **27** of them Powersoft/1Sound amplifier modules. Every figure in that section
   is now counted from the run that prints it — the `dsp` match count and its Powersoft/1Sound
   share, the rack kits still reaching `amplifier`, the unmatched fibre kits, and the accessory
   bucket's `c/w` and "FM Plus" rows — so only the judgement (which rows are wrong, and why)
   stays static. `AVPro Edge:AC-MXNET-POE-PSU24` was dropped from the "fibre extender kits"
   claim: it is a *"PoE Provider for MXNET Endpoints and 48v Fiber Extenders"*, i.e. a power
   supply, leaving 2 genuine unmatched fibre kits (`AC-EXO-444-KIT`, `AC-EXO-X-KIT`).

Totals are unchanged by all of this: the report still proposes for **1,390** parts.

## D204. The dev auto-seed stays fire-and-forget, but is awaitable (#148, 2026-09-23)

`getDb()` cannot await its own seed: `seedIfEmpty()` reaches `getDb()` through the doc-store
helpers, so awaiting inside `createDb()` awaits the promise it is part of. The seed therefore still
starts unawaited — but its promise is retained and exported as `seeded()`, which any caller that
READS seeded data can await. `getDb()` is unchanged, so nothing that did not block before blocks
now; only the test suite waits.

Chosen over the alternatives: making `getDb()` await the seed (deadlock, and it would slow every
dev-server cold start for a guarantee only tests need), and seeding synchronously before the app
boots (the same cost, plus it would seed throwaway build datadirs that are discarded).

The measured effect is the justification: a fresh datadir went from 5 intermittent failures to
1898 PASS / 0 FAIL, consistently. The failures themselves were never the danger — the danger was
that they taught everyone to dismiss a red `test:specs`, which five separate people had already
done before this was fixed.

## D205. Change type is drafts-only and deletes the old draft — no void status (#160, 2026-09-24)

A quote's type decides its builder, its engine subdoc and what winning spawns, so a type change is
a new quote, not an edit. "Change type" therefore exists only on a **draft** (sent/won/lost render it
disabled: "Already sent — start a new quote instead."). It reopens `/quotes/new?replaces=<id>`
pre-filled from that quote. Picking a different builder confirms with the old quote's id and line count,
then opens the new builder carrying `replaces`. The old draft is soft-deleted (`remove()`) by
`retireReplacedDraft()` **only on the replacement's first save**, and only after a server-side re-check that
it is still a draft. Backing out leaves it untouched, and a quote sent in another tab in the meantime survives.
System and custom both build in the Estimator (category is editable there), so moving between them
reopens the same quote rather than replacing it.

Rejected: a `void` status or marking the old quote `lost`. Either keeps a phantom row in the pipeline,
and `lost` would count against win-rate reports.

Two edge cases left as-is: the same-builder case (e.g. flame→flame) returns to the old quote without
applying the intake edits — the only hint is the "Back to <id> →" label. And a draft linked from a Grid
project or Quick Design that gets replaced leaves that link pointing at a deleted quote; the next
re-quote from there mints a fresh one.

## D206. Editing customer, venue or contact on a won quote warns — it doesn't block (#160, 2026-09-24)

Winning spawns a project/job that copies the customer, venue and contact at that moment. Later quote edits
do not flow into it. Every builder now confirms first ("This quote is won — its project/job keeps the old
<field>. Change the quote anyway?"), once per field per visit, and proceeds on OK. Renaming never warns.
The rental builder is exempt because a won rental's Save is already locked. Syncing edits into spawned
records stays out of scope.

Changing the customer on a won quote also resets venue and contact to the new customer's primaries,
under the single "customer" confirm — venue and contact don't get their own separate prompts in that case.

## D207. Labor opens with one mobilization; the D136 five are per-type defaults (#161, 2026-09-24)

Supersedes D136's opening rows. Labor now opens with one blank row (Select type…, 1 × 1).
Jeff: the five D136 values (Site Visit 1×1, Install 4×5, Hang 2×3, Commissioning 2×3, Training 1×1) were
always meant as crew-size × days defaults. Picking a type fills them only while the row's numbers still equal
the previous type's defaults (1 × 1 for a blank row). Numbers the user typed, and rows with a custom name,
are left alone. "+ Add mobilization" still adds exactly one row. Resolves PUNCHLIST's "Labor: single
mobilization" question.

## D208. D187 is superseded: the DaVinci library intersects the catalog by 73.7% (#162, 2026-09-23)

D187 closed the DaVinci import on 2026-09-22 with "it does not intersect Peak's catalog",
verified four independent ways — including a brute-force match of 17,831 identifier-shaped
strings against 14,725 SKUs that found 9 matches. Every one of those checks ran against **local
dev**, which holds 14,725 parts and 10 ETC rows. **Production holds 37,403 parts and 3,959 ETC
rows, every one carrying both list and dealer cost.** Measured against production on 2026-09-23:

| | rows | share of 3,959 |
|---|---|---|
| Has a DaVinci model/part number | 3,424 | 86.5% |
| …that entry has neither ports nor documents | 507 | 12.8% |
| **Will actually be enriched** | **2,917** | **73.7%** |
| …would receive `ports[]` | 2,636 | 66.6% |
| …would receive document links | 2,872 | 72.5% |
| No DaVinci entry | 535 | 13.5% |

The 535 misses are correct misses — `99XX-XX-XX` configurator placeholders, bare option codes
(`AD`, `AO`, `BP24`), lamps, clamps. DaVinci does not model those as devices.

**D187's factual claims about the library all still hold** (2,366 types, 1,381 ported, 56
protocols, 25 connector types, and that this is the full export Jeff has). Only its conclusion
falls, along with the sentence "~1,381 unpriced ETC devices Peak does not sell": Peak sells 3,959
of them and has dealer cost on all of them. D187's reasoning stays in the log intact — it gains
only a pointer to this entry — because it is the clearest record this project has of how a
careful, repeated, four-way verification still reaches a false conclusion when it measures the
wrong database.

**The generalizable lesson, and the reason this gets its own number rather than a footnote:**
local dev and production have diverged to the point where they answer catalog questions
differently. Local dev has no Legrand AV (9,088 in prod), no Draper (8,605), no Crestron (1,633),
and 10 ETC rows against 3,959. Any claim of the form "the catalog has / does not have X" is
unsound unless it names the database it measured. Jeff caught this one by looking at the deployed
app and saying he did not believe the answer.

Related, found in the same pass and logged as §9 of the #162 spec: **production has 0 parts
carrying `ports[]`, out of 37,403.** The #39 starter set and everything #158 and #159 built exist
only in local dev, so Grid wiring validation is inert in production today — #39's status line
claiming the starter set was imported "to BOTH local and prod in one run" is false against
production.

Supersedes D187. The enrichment design it unblocks is
`docs/superpowers/specs/2026-09-23-davinci-etc-catalog-enrichment-design.md` (punch #162).

## D209. The DaVinci enrichment shipped — scoped by manufacturer, ports deduped (#162, 2026-09-24)

2,917 of production's 3,959 ETC catalog rows now carry manufacturer-authored ports (2,647) and
public ETC document links (2,872), written after a full backup. All 3,959 still carry `list` and
`cost`, the catalog is still 37,403 rows, and no non-ETC row was touched. This is the first port
data production has ever held.

**It is an enricher, not an importer.** It matches on SKU, so it only ever touches rows Peak already
owns and prices; it creates no rows and has no opinion on price. Re-running it after a future
price-book import picks up the new rows with no code change. The source is a committed 1.39 MB
extract (`data/davinci-extract.json`, 1,720 records) distilled from ETC's 42 MB library, which stays
gitignored on one machine.

**Two defects the final whole-branch review caught, both of which would have shipped:**

1. **Nothing constrained a match to the right manufacturer.** Matching is by normalized SKU alone,
   and the documented write command was unscoped. Verified against the real extract: `Symetrix:4.50%`
   normalizes to `450` and matched ETC's "Source Four 50 Degree"; so did `Draper:450`, `Crestron:405`
   and `Biamp:0`. Production holds 19,326 Draper / Crestron / Legrand AV rows whose part numbers look
   exactly like that, and none had ever been run against the index. This is the same false-positive
   class D187 recorded as `QSC:SP-36` ↔ `SP3-6`, and it would have put another manufacturer's
   datasheet in front of a customer. Fixed: the extract now carries DaVinci's manufacturer, an
   explicit allowlist maps ETC / Echoflex / High End Systems onto Peak's single `ETC` book,
   `planEnrichment` **requires** a manufacturer scope and throws without one, comparison goes through
   `mfrKey()` like the rest of the codebase, and the report prints a `rejected, wrong mfr` count.

2. **62 of 1,720 records carried duplicate ports**, which `parsePortsField` rejects because the Grid
   inspector keys on `${name}-${connectionType}`. Enriching those rows would have made them
   permanently un-saveable: any later edit — even a price change — would fail validation and strand
   the row behind a `partError`. Fixed by collapsing identical ports into `count: N`, which `Port`
   already supported.

**Design decisions that survived review**, recorded because each was a real fork:

- Unmapped ETC protocols pass through verbatim as their own namespaced connection types rather than
  collapsing into the nearest Peak one. `canConnect` is exact string equality, so a passed-through
  `ETC EchoConnect` mates only with itself — no false positives. Collapsing would have let the Grid
  validate an Echoflex sensor against a DMX terminal block. 508 parts would have imported unwireable
  without this.
- The protocol map is keyed on UUID, never a name: `constantName` "NewPortProtocol" names three
  distinct ArcSystem driver channels plus an internal blank, and ten protocols share the signal name
  `F-DRIVE`. An unknown UUID throws rather than guessing.
- Voltage classes stay distinct (D4b in the spec). The draft sent every hardwired power protocol to
  `bare-end`, which would have let a low-voltage auxiliary bus validate against a 480V feeder.
- Collisions are resolved deterministically — 440 identifiers are owned by more than one DaVinci
  type — preferring an active type over a discontinued one, then the one with more ports.

**Still open, deliberately:** `RDM` remains the one connection type with no wire type (DaVinci never
emits it; whether it belongs on `dmx-5pin` is a call about Peak's own taxonomy). 1,042 ETC rows
matched nothing — configurator placeholders, bare option codes, lamps, clamps — and
`npm run davinci:enrich -- --mfr=ETC --unmatched` lists them.

Spec: `docs/superpowers/specs/2026-09-23-davinci-etc-catalog-enrichment-design.md`.
Supersedes nothing; extends D208.

## D218. The estimator's quote-details rows live in a right-hand column, not above the body (#163, 2026-09-24)

The prototype (and the port through 77c657c) stacked the customer/venue context bar, the quote
note, the assumptions block and the install timeframe as full-width rows between the estimator's
sticky header and the Systems/cards split. That was fine while assumptions was a single textarea;
#36's company-default checklist made the block ten checkbox lines tall and pushed the whole
estimating surface below the fold — Jeff's screenshot of Q-2046 showed nothing but the header and
the list. The four groups now render as an `<aside className="est-meta">` (300px, `#23262d`,
`overflow-y: auto`) as the third flex child of `.est-body`, after the section cards. This is a
deviation from the prototype's layout only: markup, state, handlers and copy are unchanged, and
nothing was made collapsible — the review bar already is (77c657c), and a second toggle would hide
fields the estimator needs on every quote. If 300px proves tight on a laptop, narrowing the
Systems rail or letting the column collapse is the next lever, not moving the fields back.

## D219. The Quote details column collapses to a tab and remembers the choice per browser (#164, 2026-09-24)

Jeff asked for the #163 column to be collapsible the hour it shipped. Three calls: (1) the
collapsed form is a 36px tab rather than nothing — the fields are needed on every quote, so the way
back has to stay visible; (2) the preference is per browser in localStorage, not per quote or per
user in the database — it is a screen-real-estate choice, and the same person wants it collapsed on
a laptop and open on a monitor; (3) the stored value is applied in a mount effect, never in the
`useState` initializer, so hydration always renders it open and a collapsed user sees a brief
settle instead of a React hydration error. D218's "nothing was made collapsible" is superseded by
this entry; its layout stays.

## D222. Maps use OpenStreetMap tiles; the geocoder skips this run's failures, strips suites, and lets a building sit up to 10 mi from its postal town (#166, 2026-09-24)

- **Basemap:** CARTO's keyless `light_all` tiles now carry an "API KEY REQUIRED" watermark. We
  stay key-free (the #147 design's stance for all of geo) and switch to OpenStreetMap's standard
  tiles, washed out with a CSS filter on the tile layer only so status pins stay the loudest
  thing. Rejected: a CARTO/Stadia/MapTiler key (a new secret and account for a cosmetic layer);
  Esri's legacy keyless canvas (licensing for commercial use is unclear). If OSM's tile policy
  ever objects to our volume, a keyed provider is a one-line URL change in `LeafletMap.tsx`.
- **Batch runner:** failures are carried as a per-run skip-list by the caller rather than marked
  on the venue row — no schema change, and a later run (after a hand fix) retries them naturally.
- **Street cleanup:** unit designators and P.O. boxes are dropped from the *query only*; the
  stored address is never rewritten.
- **Postal-city radius (10 mi):** US mailing cities are postal, not municipal, so an exact city
  match wrongly rejects real buildings (Middleton → Madison, Milwaukee → Wauwatosa). The
  exception applies to street-level hits only; city-only rows keep D185's exact gate. 10 mi
  clears the observed postal cases (≈2 mi) with wide margin under the Portage hazard (64 mi).

## D223. Printed documents keep blocks together and one-page letters scale to fit, instead of hand-paginating every page (#167, 2026-09-24)

- **CSS keep rules over per-document pagination** for browser-printed letters/reports: rows,
  signature blocks, fee boxes, callouts and header bands carry `pk-keep`; section labels carry
  `pk-keep-next`. Chrome then paginates; nothing is pre-split in React. Only the Rigging
  Inspection Report keeps its fixed-sheet model (running head/foot per sheet), so it alone
  chunks by estimated height.
- **Single-page letters scale rather than spill:** print `zoom` from a reflow-aware measurement,
  floored at 0.72 (≈9pt body); 4% safety margin because 0.985 tipped two letters onto page 2
  (the notice+footer keep block needs room). Below the floor a letter may run to 2 pages.
- **Clip nothing:** inspection sheets print with `overflow: visible`; a misestimated sheet
  spills to a following page rather than losing content.
- **pdf.ts footers appear only on multi-page output**, so a one-page PDF is byte-identical to
  before.

## D224. The Systems rail collapses the same way the Quote details column does (#168, 2026-09-24)

Same three calls as D219, applied to the left rail so the two edges of the estimator behave
identically: a 36px tab rather than nothing (the way back stays visible, and the tab carries the
system count so a hidden rail still says how many systems the quote has), a per-browser
localStorage preference under its own key (a laptop wants both rails hidden; a monitor wants both
open; the two choices are independent), and a mount-effect read so hydration always renders it
open. "+ Add" lives only in the expanded rail — adding a system while the list is hidden would
select a system the user cannot see. Deliberately not done here: restoring keyboard focus to the
counterpart control after a toggle (the pressed button unmounts, so focus falls to <body>); it
affects #164 equally and belongs in one fix for both rails.

## D225. The spawn router honours deletions, survives a replay, and stays scoped to its own quote (#169–#171, 2026-09-24)

`cfc00ad` shipped `spawnFromQuote` — create a quote's downstream record at the moment of the win, inside
`setStatus`'s transaction. Thirty-one lines, and three defects. Each was verified against the shipped code, not
inferred.

**#169 — a deleted project came back.** The project branch called `createProjectFromQuote` unconditionally.
Deleting a project created from a won quote records that quote in a dismissed list, which the page-load sweep has
always honoured and the per-quote creator never did. Any later re-save of that quote's `won` status silently
recreated what the user deleted. `dismissedQuoteIds()` is now exported and consulted before the project branch —
exported rather than the blob id duplicated, so there is one source of truth.

**#170 — re-approving an already-won quote created nothing.** The router returned early when `prevStatus === "won"`,
which was survivable only because the four builder approve actions each called `createFromQuote` themselves. The
same commit deleted all four. The real gate turned out to be a layer up: `setStatus` returns at
`q.status === status` before the router is ever reached, so relaxing the router alone would have fixed nothing. The
unchanged-status path now replays the spawn **and nothing else** — no write, no history entry, no revision, no #16
assignment — and that contract is asserted, not just commented.

**#171 — the consulting `lost` branch swept the whole book inside the transaction.** It delegated to
`syncEngagementsFromQuotes()`, which lists every engagement and every quote and patches every engagement whose rule
fires — other quotes' records, in this user's unit. One malformed row elsewhere blocked the status change the user
asked for, and a rollback discarded legitimate repairs made for others. Now scoped to this quote through the
existing pure rule `engagementSyncAction`, with all three write kinds going through one shared writer.

**Two things deliberately kept from the shipped version** rather than "fixed": an unrecognised `quoteType` still
routes to the project branch, because the CSV importer can mint `"service"` and `syncProjectsFromQuotes` expects it —
an inert default would have silently stopped service quotes becoming projects. And the sweep keeps its
`{created, skipped}` shape and per-quote `try`/`catch`.

**One behaviour convergence, not a new rule:** applying the pure rule per-quote means a re-sent consulting quote now
reopens a closed engagement at the status change instead of on the next page load. Both sweep call sites were page
loads, so no end state is reachable now that was not reachable before — only sooner.

**Recorded because it was nearly written down wrong:** no spawn opt-out was added for the CSV importer. The
importer's `update` path matches quotes by name and customer across the whole book with no type filter, so a
re-import can spawn repair jobs and rental bookings the shipped `update` path never created. The tombstone coverage
in D227 is what has to catch that, because it sits where the importer's `setStatus` reaches it.

**Left alone, on the record:** `startConversionAction` and `spawnServiceLinkedProject` still reach a quote-born
project without consulting the dismissed list. Both are explicit, user-initiated actions where "convert" means what
it says, and the UI only offers the first from a list that already filters. Noted so the choice is visible.

## D226. `outsideTransaction` — detached work must not ride the caller's transaction (#172, 2026-09-24)

`withTransaction` puts a `tx` in an `AsyncLocalStorage` that `getDb()` reads, which is what makes the whole ambient
design work. It has a sharp edge: work *started* inside a unit but resolving **after** it commits still reads the
dying `tx`, and its write throws "Transaction is closed" — into whatever catch the caller has.

`outsideTransaction(fn)` runs `fn` with the ALS context exited, so anything it starts gets the pooled handle. It is
for detached background work, and explicitly **not** a way to sneak a write past a rollback.

Applied inside `queueLabelSync`, which covers all six call sites (comms, linking ×2, bridge ×3) rather than only the
one that motivated it. The subtlety: a `.then()` continuation captures the context at **registration** time, so
registering inside the exited scope is what matters, not where the promise resolves.

**Honest scope:** this is preventative. `withTransaction` today exists only in `setStatus`, and nothing in its call
closure reaches the Gmail path — so the silent dropped label sync was not yet reachable. It becomes reachable the
first time a comms flow wraps a quote status change, which is exactly the kind of change nobody would think to audit
for this. **Named behaviour change:** a sync queued inside a unit that later rolls back will now actually run, rather than
throwing. Better, but different — and note this is a production-only property. On Neon the detached write takes a
second pooled connection immediately and is genuinely independent of the unit; on dev PGlite, which serializes the
whole process behind one connection, it simply waits, so the independence is not observable locally. "It behaved in
dev" is not evidence about this one.

## D227. A tombstone is coverage: the healing sweeps stop resurrecting deleted records (#173, 2026-09-24)

`cfc00ad` deleted `syncFromQuotes()`/`createFromQuote()` from the four builder approve actions. New wins are
transactional and fine. But wins that happened *before* it through the Estimator, Inbox or Home never swept, and the
book-wide heal that used to run on any "Won" click went with it. `system` and `consulting` orphans still self-heal on
page load; **the four service types had no repair path at all**, and their `syncFromQuotes` had zero callers.

Each is now attached through `safeSweep` on the page that owns that record type **and on its scheduling page**. The
scheduler is not decoration: a healed flame job is born `stage: "approved"`, which is precisely what the scheduling
screen lists as awaiting a date — so the screen a dispatcher would check for the missing job was otherwise the one
screen that could not create it. Bookings get `/rentals/board` only, which *is* the rentals scheduler; `/rentals` is
the item directory and is deliberately not swept.

**Reattaching a sweep to a page a delete redirects to is what makes tombstone-awareness mandatory,** not optional.
These sweeps built "already covered" from `listDocs`, which excludes soft-deleted rows — so deleting an inspection
and landing back on `/inspections` would have produced a fresh blank record with a new id. Delete would be
destructive *and* ineffective. Coverage is now built with `includeDeleted`, and the per-quote creators too, because
#170's replay reaches them. A trap worth recording: `listDocs` does not merge the `deleted` column onto the returned
doc, so a tombstone handed back looks live — collect a `Set` of quote ids, never pass the docs around.

**This reverses a documented intent.** `flame-jobs.ts` described re-creation after removal as deliberate prototype
parity. That was written when the sweep ran on a win, not on every dashboard load. The comment is corrected.

**Consequences, stated plainly:** a tombstone is coverage and there is no undelete UI — but it is not quite
permanent. For `flame_jobs`, `repair_jobs` and `inspections`, `/api/sync/push` writes `deleted: false` on every
update, so an offline device that edits a record the server has since tombstoned un-deletes it, after which the
coverage set no longer holds that quote. Narrow, but it is a resurrection path guarded by neither mechanism.
Projects are actually better protected here, because the dismissed list is a blob and never travels over sync —
worth saying, since this entry otherwise presents the blob as the weaker legacy shape. Page load is
serialized behind the sweep on seven screens. And the reattached sweeps are still read-then-insert with no
uniqueness on `quoteId` — see #180.

## D230. A policy refusal and a defect no longer look the same (#174, 2026-09-24)

`setStatus` throws for two unrelated reasons: the approval gate refusing a transition, whose message is written for
the user, and any defect in the spawn graph, which is not. Every caller rendered both identically, so a `TypeError`
from a spawner was indistinguishable from a governance decision in production.

`ApprovalGateRefused` now carries a brand field, and `isApprovalGateRefusal` reads that brand **by value rather than
`instanceof`** — a server-action bundle split can hold a second copy of the module, and an identity miss would lose
the gate's message, which is the one message that must reach the user verbatim. One shared
`statusFailureMessage(e, where, fallback?)` sits next to it: gate message verbatim, otherwise `console.error` with
the real error plus a generic line. Every caller uses it rather than carrying its own copy.

The gate's wording and conditions are unchanged. The renewal path in the Inbox still swallows by design, but now
logs the real error instead of dropping a defect silently. The Home stage sheet, which previously caught nothing at
all, now stays open showing the reason instead of closing as though it had worked.
## D228. Unlocated venues are fixed one at a time from a live worklist; the quote origin is an explicit choice (#175, 2026-09-24)

- **The worklist is a query, not the run's memory.** It lists live venues with an address or city, no usable coordinates, and no `travelMiles` override, ordered case-insensitively by company then venue. The rule matches `estimateFromParts`, where only `travelMiles` counts as manual. Reasons from the current page's batch run are shown when known and never persisted, which avoids a schema change for a transient list.
- **Three fixes, no town-centre shortcut** (Jeff declined it):
  - **Retry** reuses `geocodeVenue()`, the same gates as the batch.
  - **A human pick or pin bypasses the gates**, because a person chose the place. A pick never erases stored data: the street is replaced only by one carrying a house number, and blank fields keep their stored values. This stops a town-level suggestion from becoming a back-door town-centre fix.
  - **Precision is reported.** A city-precision result says "town centre".
- **The sidebar never writes `travelMiles`/`travelMin`.** The Companies "Route" button does, and that freezes travel as a manual override. Here travel stays live through the route cache, warmed at fix time.
- **Writes** are one targeted `UPDATE … WHERE id AND NOT deleted RETURNING`. Zero rows means `gone`.
- **Quote origin** is set explicitly per location: a pill plus *Use for quotes*. The implicit "first listed" fallback stays, but is labelled so it is visible. Calendar travel blocks still start from each person's "Based out of" office and fall back to the quote origin; per-appointment origins are a separate item.

## D229. Directory drive times measure from the quote origin; a calendar trip can start anywhere (#176, 2026-09-24)

- **One origin for the directories.** The Drive column uses the same rule as every quote: `quoteOrigin()`, `coordsOf()` and `estimateFromParts()` (manual > routed > auto > none). It reads only the route cache, and a straight-line estimate is marked `~`, so a directory page never calls OSRM. With no located quote origin, every cell is "—", even for manual overrides, so the column can't imply a distance from nowhere.
- **Companies use the primary venue** (`primaryLoc`). Nearest-of-many was rejected: it makes the row's number depend on a venue the row doesn't name.
- **Unlocated rows sort last in both directions.** "Farthest first" should not open with 200 unknowns.
- **The calendar origin is chosen per appointment:** a typed address, then a saved location with coordinates, then the person's base ("Based out of", else the quote origin). A typed miss falls back to the base and says so in the block's description; it doesn't silently drop the block. The travel block runs in `after()` so a slow geocoder can't time out the save and invite a duplicate meeting. Edits still don't regenerate the block (D144).
- **Numbering.** #175/#176 and D228/D229, not #169/#170 and D225/D226, which a parallel session claimed first.

## D231. A discipline removed from Settings is kept on an existing quote unless someone unticks it (#155, 2026-09-24)

The quote builder has always shown a discipline that is on the quote but gone from the live Settings vocabulary, and
a recent change labelled it `<Name> (removed)`. The save action still intersected against the **live** list, so it was
dropped on the next save whether or not the box was ticked.

That combination is worse than either half alone: the label makes a silent behaviour visible without making it true —
a checkbox that names itself "removed", looks tickable, and is discarded regardless. Two smaller things were wrong
underneath it: the checkbox was `disabled`, so "untick it to remove it" was literally unreachable, and its tooltip
said the opposite of what happened.

Now `resolveDisciplines(posted, live, existing)` keeps a posted value when it is in the live vocabulary **or**
already on this quote, and drops everything else. The checkbox is tickable and says so.

**The hole that intersection existed to close stays closed.** It is there to stop a hand-crafted POST stashing an
arbitrary discipline. The allowlist gained exactly one term — `existing`, read from the **stored quote**, never from
the form — so a value in neither list is still refused, pinned by its own test.

It lives in `src/lib/settings.ts` rather than beside the action, because a `"use server"` module can only export
async functions and this needs to be a pure, directly-testable helper.

## D232. `/schedule?view=timeline` gets one window, one ruler, and a noon anchor (#157, #154, 2026-09-24)

The page stacked two grids that did not agree on what a date is. Consulting rendered `GanttGrid` over its own range
as a percentage of that range; the Installs timeline computed its own `tlStart`/`tlDays`/`tlDayW` at a fixed
pixel-per-day. Both padded identically, but from **different bar sets** — so the same horizontal offset in the two
stacked sections was, in general, two different calendar dates, with no shared ruler to say so.

Both sections now take one `{ start, end, dayWidth }` computed from the **union** of their bars, positioned as a
percentage of that shared range inside one scroll container whose inner width is `days × dayWidth`. Percentage alone
would have killed zoom and horizontal scroll; converting `GanttGrid` to fixed pixels would have dragged the
engagement Schedule tab and the By-person view into the change for no benefit. The shared fixed inner width keeps
`dayWidth` meaningful and makes zoom scale both sections together.

**#154 came along with it, and the punch entry was wrong twice.** It said no fix was required because React
self-heals a style-only hydration mismatch, and it framed the fix as a rendering-strategy change. The engineering
spec said the columns must render identically; the spec is the later decision and governs — and the fix is two lines
in one pure function, not a rewrite. The punch's *mechanism* was also off: `ganttRange` only ever ran on the server
and its result is serialized, so the divergence was `GanttGrid` re-flooring those midnight boundaries client-side.
Anchoring the range to local noon — the convention every other date in this app uses — gives that re-floor ±12h of
slack. A side effect worth knowing: `?view=timeline` now has no #154 exposure at all, because it no longer renders a
client grid; the fix still matters for `?view=people`.

**Verified by measurement, not by eye:** ruler, consulting and install tracks all report `{left: 241, width: 12935}`;
every bar sits an exact integer day offset from the shared week labels; the today band is one continuous line through
both sections; and adding a scheduled engagement widened the install ruler from 131 to 143 weeks — the union working,
which the old code could not have done.

**Left deliberately:** the window is unbounded, so one garbage stored date yields a multi-decade grid, and per-day
iteration makes that roughly three times the DOM cost of the old per-week loop. Clamping it would hide real
long-lead work, which is worse.

## D233. Spec fixtures are torn down by default, and teardown means removal, not a tombstone (#149, 2026-09-24)

`scripts/test-review-and-spec.ts` wrote DB-backed fixtures that nothing deleted — a file-wide convention, not one
test's oversight. Individual tests had been fixed by hand several times and the next author still had to remember.

There is now one marker shape, `TEST<scope>:<slug>`, already the majority form in the file so the change is
convention rather than churn; a `createFixture()` that registers for teardown at the moment of creation, so cleanup
is the default; suite-level teardown in a `finally` so a mid-suite throw still cleans up; and
`npm run test:sweep-fixtures` to repair a datadir after the fact — dry run by default, `--commit` to write, `--yes`
additionally for a hosted target, and `--hard` refused on a hosted target under every flag combination.

**The finding that makes this entry worth writing: teardown cannot soft-delete.** The first attempt did, and the
suite passed at 2183 on the first run and failed with **21 errors** on the second against the same datadir. The
spawn router is now tombstone-aware (D227) — a tombstone counts as coverage precisely so a deleted record is not
recreated — so soft-deleted fixtures silently suppressed the spawns the next run was asserting. Fixture teardown
removes rows outright.

That interaction was invisible to every previous run of this suite, because each one got a fresh `mktemp -d`. Running
twice against **one** datadir is what surfaced it, and is now the check that proves teardown works.
## D235. Messy addresses get fallback lookups, gated by zip, only after the normal lookup misses (#185, 2026-09-24)

- **The primary lookup is frozen.** It uses the same query and the same gates as before, so nothing that already geocodes changes, and every new rule is confined to fallbacks. A first version put the new cleanup into `cleanStreet`. Review showed that changed the first lookup's query, and a colon rule mangled real streets on it (`"100 Main St, Suite: 4"` → `"4"`).
- **"Street + state + zip, no city" is the main fallback.** It was measured as the biggest win on real failures. Nominatim's free text often chokes on a postal city that differs from the OSM municipality, and on a typo'd city.
- **Zip gate:** a same-zip hit is trusted over a mismatched city name, but not blindly. If the stated town resolves exactly, the hit must be within 25 mi of it, which guards against a mistyped zip matching the same street name elsewhere. If the town doesn't resolve (a typo), the zip alone decides. A fallback with no city and no zip is never accepted. The Portage County trap (D185) stays closed: city-only rows get no fallbacks.
- **The town-centre cache now uses the cleaned city on the first lookup too.** `Rome (Sullivan)` and `Wisc. Dells` can resolve their centre for the existing 10-mile postal rule. This is a deliberate small widening of attempt-1 acceptance.
- **The batch budget is worst-case aware** (`elapsed + 4 × (delay + 5 s) > budget` stops before starting a query; the first query always runs). A killed server action loses its skip list, which is how #166's stall happened.

## D236. Stages are Daylite pipelines of stable ids, and code reasons only about a fixed tag (#187, 2026-09-24)

The hardcoded seven-stage `ProjectStage` list (and `PROJECT_STAGES`/`ORDER_STAGES`/`stagesFor`/`stageIndex`) is gone.
A **pipeline** is an ordered list of stages; each stage has an `id` (a slug, never shown), a `label` Jeff edits, and
one fixed **tag** — `backlog | scheduled | onsite | closeout | done` for projects, `draft | sent | won` for quotes.
Code never compares a stage id or label; it asks the tag (`isDone`, `isOnSite`, `isBacklog`, `isActive`,
`projectStageMeta`, all in `src/lib/pipelines.ts`, pure). That is what lets Jeff rename, add, remove or reorder
stages without breaking scheduling, risk flags, Field Work, metrics or reports. Records carry `pipelineId` + `stage`
and a stamped `stageMeta` for readers that have no pipelines loaded.

**Settings → Pipelines** (admin) edits them: label, reorder, tag, `advanceOnDelivered`, add, remove, and the default
quote pipeline. The validator refuses a save that breaks the model: unique ids, exactly one `done` stage and it is
last (projects); a `draft` and a `sent` stage and exactly one `won` stage, last, tags never going backwards (quotes).
**Stage ids are immutable once saved** — only labels change — because every stored record points at the id. A stage
that any record sits in **cannot be removed**; the editor shows the count and offers *Move those records to…* first,
which moves projects through `setProjectStage` (history, checklist and Done hooks, as a drag would). Quotes move
only between stages that share a tag — a different tag would change the quote's status from Settings, which stays a
deliberate action taken on the quote. A stored list that fails validation
falls back to the seeds rather than rendering a broken board. Schedule's colour lookup falls back to the tag colour
and never throws on an unknown stage.

## D237. The install pipeline is Jeff's seven Daylite stages; sign-off lands at the closeout stage and Complete is manual (#187, 2026-09-24)

Install (`kind: project`): **Deposit/PO received → Equipment ordered → Initial contact → Scheduled → Installation →
Invoice → Complete** (Jeff, J5 in the spec). Order (`kind: order`): Order materials → Deliveries → Delivered &
accepted → Complete. A won quote lands at the first stage with an opening history entry, on every path
(`createProjectFromQuote` and the page-load sweep alike).

- **Deliveries** advance the project only when **all** of them are received and the current stage has
  `advanceOnDelivered` (Equipment ordered / Deliveries).
- **Customer sign-off no longer completes the project.** It moves the job to the first `closeout` stage (Invoice /
  Delivered & accepted) if it is earlier. Complete is set by hand, when paid — as it is in Daylite.
- **The completion follow-up fires on reaching Done from any path** — manual move, board drag, import mover — through
  one post-transition hook, not only from the old sign-off→complete branch. Automatic advances expand their stage
  checklist the same way a manual move does.
- The `training → trainingAt` stamp is dropped; nothing read it.

## D238. Quotes stop at Won; only system quotes carry a pipeline, and its stage tag is the status (#187, 2026-09-24)

Post-sale steps (down payment, equipment, install, invoice) live on the project, so quote pipelines end at their
`won` stage. Only **system** quotes (and untyped ones) carry a pipeline — **Estimate/Design** (First Contact, Design,
Presentation/Delivery, Acceptance) or **BID SPEC** (Collect Information, Create BID, BID Sent, Awarded). Flame test,
inspection, repair, rental and consulting quotes keep status only.

**The stage's tag is the status, in lock-step both ways.** A stage move whose tag differs runs the real `setStatus`
— approval gate, history, revision-on-send, the #16 "Install sold" task, spawn — and a gate refusal leaves the stage
where it was (surfaced through `statusFailureMessage`, D230). Any status write from elsewhere snaps the stage inside
the same patch: forward to the status's first stage, back to it when the status moves backwards; `lost` leaves the
stage where the deal died and the pill reads "Lost".

Two readings of the spec were settled here, both deliberately:
- **Read-time normalization snaps a mismatched stage to the status.** A stored stage whose tag disagrees with the
  status (an old write, an edited pipeline) is corrected on read to the status's stage — the status is what every
  other module reads, so it wins.
- **A same-tag stage move (First Contact → Design) writes no quote history entry.** Quote `history` is the status
  log that the approval, renewal and reporting code reads; a stage-only move is not a status transition. The spec's
  wording said "with a history entry"; this deviates from it on purpose.

## D239. Legacy stage keys convert at read time — no SQL migration — and history keeps its old labels (#187, 2026-09-24)

Projects and quotes are JSONB documents with no promoted stage column, so conversion lives in the store normalizers
and persists on the next save: `procurement`/`delivery` → Equipment ordered (orders: Order materials / Deliveries),
`scheduled` → Scheduled, `install`/`training` → Installation, `signoff` → Invoice (orders: Delivered & accepted),
`complete` → Complete, missing/unknown → the first stage. `/api/sync/push` runs the same conversion, so an offline
Field Work device pushing an old key is converted, not stored raw. A system quote without a pipeline reads as
Estimate/Design with the stage its status implies.

Existing `stageHistory` entries keep their old keys; a frozen legacy label map renders them ("Crew scheduled",
"Training"…). Stage checklists are re-keyed to the new ids (procurement + delivery → equipment-ordered, install +
training → installation, signoff → invoice); a stage Jeff adds later has no checklist. **Known edge, accepted:** task
rows are never rewritten, so a legacy project re-entering a stage whose coverage key changed can expand that
checklist once more.

## D240. UKN: an unknown job value is shown as "UKN", never $0, and stays out of every total (#187, 2026-09-24)

`valueUnknown?: boolean` on projects and repair jobs (the stored value stays 0). Every value render goes through
`formatJobValue`, which prints **UKN**; metrics, dashboard and report sums skip those records. The Projects list gains
a **Value unknown** filter. The project detail gains a contract-value editor, and saving any value there clears the
flag. Only the Daylite importer sets it. **Repairs have no value editor yet**, so an imported repair's UKN can't be
filled from the app (punch #188); the "· N with unknown value" suffix is not yet on every total (#189).
The Import hub's projects CSV writes an unknown value as the cell **UKN** and reads UKN (any case) back as unknown, so
export → import round-trips; a blank Value cell still means $0.

## D241. The Daylite history import: what lands where (#187, 2026-09-24)

An Import-hub card at `/import/daylite` (admin) takes the Projects and/or Opportunities export, previews every row, and
writes nothing until Confirm. Classification and mapping are pure (`src/lib/daylite/history.ts`); the write is
`src/lib/daylite/history-commit.ts`.

- **Skipped:** Cancelled, Abandoned and Deferred projects; Lost, Suspended and Abandoned opportunities.
- **Service calls → Repairs** (Pipeline Service Call/Repair, or blank Pipeline with a Service/Component Repair
  category). A done one lands `completed` at its End Date and is **excluded from warranty follow-ups**
  (`isImportedHistory`), so fifteen years of expired warranties don't flood the worklist.
- **Custom Cables → orders.** Everything else → install projects: Done at Complete with its End Date as the close,
  New at the mapped Daylite stage.
- **Won opportunities are a value source only**, matched to a project by name + company with punctuation ignored.
  **Open opportunities → system quotes** on the pipeline their Pipeline column names; won-stage ones link to (or
  create) **exactly one project per sold job**.
- **No automation:** no spawn, no approval gate, no #16 task, no follow-ups; imported quotes are written directly,
  not through `setStatus`. They are history, not offers: the **customer portal never lists or accepts** a quote with
  `source: "daylite"` (`isImportedHistoryQuote`, through `portalListsQuote` / `portalCanAcceptQuote`).
- **Chunked, idempotent commit:** the client posts 150-row chunks (server cap 500) so each fits the page's 60 s
  `maxDuration`; ids are deterministic, a taken id is skipped as "already imported", and a failed chunk is simply
  retried. If any chunk reports row errors, finalize (which retires the July leads and companies) waits for Jeff:
  the errors show with a **Finalize anyway** button.
- **Ids.** `src/lib/daylite/ids.ts` is now the one copy of the name hashing (moved from `scripts/daylite-ids.ts`,
  which re-exports it). It adds **`RP-dl-…`** and **`Q-dl-…`** — a deviation from the `RP-4000` / `Q-2041` id formats,
  taken because an import id must be a pure function of the Daylite row to make re-runs idempotent.
- Owners match current users by exact name; anyone else is kept as `legacyOwner` text so history loads no one's
  worklist. Company cells naming several companies are split against known names, never on bare commas; an
  ambiguous row gets a picker.

Real-file run on a copy of the dev DB: 2,132 created in 13.8 s, 27.4 s end to end; a re-run reports 2,126 already
imported; warranty follow-ups 2.

## D242. The history import supersedes the July import — soft delete only, and only records nobody touched (#187, 2026-09-24)

`scripts/import-daylite.ts` ran in July and wrote 1,784 `P-dl-` projects (service calls and cancelled jobs included,
all "complete", value 0, no dates), 1,675 `L-dl-` leads and stub companies for combined names like "C.D. Smith
Construction, Muermann Engineering". Jeff decided (2026-09-24): **replace** the July projects, **retire** the July
leads, **retire** the junk combined-name companies, all in the same import.

- A **July record** is a live `P-dl-`/`L-dl-` doc with no daylite `source` marker. Only **untouched** ones
  (`updatedAt − createdAt < 60 s`) are replaced or retired; an edited one is left exactly as it is and listed.
- **A July record linked to a quote is never retired.** Overwriting one carries its `quoteId` forward, so a split
  import (Opportunities first, then Projects) still replaces it with full data.
- Before anything is retired, one batched scan of every doc table (plus settings and blobs) looks for records
  pointing at it; a hit keeps it, with the reason.
- **Every decision is checked again inside the UPDATE** (live, no marker, untouched, no `quoteId`); an UPDATE that
  matches nothing is reported as changed-since and kept.
- A combined-name company is retired only when it decomposes fully into two or more other live companies and has no
  contact, no venue but its own base venue, no email domain and no reference anywhere.
- **Every removal is a soft delete** — recoverable. July projects no row matches are counted, never removed.

The July script now imports identity only (companies, base venues, people); its project and opportunity branches are
deleted so two mappings can't drift.

## D243. Two small UI deviations from the pipelines spec (#187, 2026-09-24)

- **The company page's project badge shows the full stage label** ("Deposit/PO received"), not a short form: labels
  are Jeff-editable, and a derived abbreviation of an arbitrary label would be wrong more often than long.
- **The import result panel links plain `/projects`**, not a list filtered to `source: daylite` as the spec said —
  the Projects list has no source filter, and adding one only for this panel wasn't worth a new filter axis.

## D244. Labor overhead folds into the mobilization lines instead of riding as its own lines (#193, 2026-09-25)

Shop & engineering, the 5% performance bonus and the misc allowance used to be separate estimate lines. Jeff asked
that one click of Add labor produce one line per mobilization, so their cost and sell are split across the
mobilization lines in proportion to each one's own cost (evenly if every mobilization costs $0), the last line
absorbing rounding. Totals are unchanged to the cent; the breakdown lives in each line's internal note. If every
mobilization costs $0 the extras still become their own lines rather than being dropped. The last line also absorbs
the cent-level gap between the lines and the modal's single-rounded Price · ext, capped so a real mismatch is never
papered over. Taken without asking — easy to reverse if Jeff wants the overhead visible as separate lines again.

## D245. Typing ext. sell back-solves unit sell; the override field is retired for new edits (#194, 2026-09-25)

An edited ext. sell now sets `price = ext ÷ qty` at full precision and clears `extSellOverride`, so one number (unit
sell) drives the line and qty, margin and system repricing all keep working. Rejected: keeping the override and
back-filling unit sell (two sources of truth that disagree after any qty change). Existing saved overrides are
still honoured by `lineExtSellOf` until the line is edited — no data migration.

## D246. Venue calendars live in keyed blobs, not a `sites` column (#196, 2026-09-25)

One `app_settings` blob per venue, id `venue_calendar:<locationId>` (the id scheduled records already carry),
through `getBlob`/`setBlob` — the studio-designs / portal-grants precedent. Chosen to ship without a migration
against the one Neon database every environment shares, and because `writeRecord` rewrites every `sites` row on each
customer save and would silently drop a new column unless carried forward. Each writer patches only the keys it
owns (`windows` vs the feed's `icsWindows`/`icsFetchedAt`/`icsAttemptAt`/`icsError`), so a background feed refresh
can't clobber a window someone just added. Move it to a column or table if a query ever needs to span venues.

## D247. The venue-availability check warns and never blocks (#196, 2026-09-25)

A client's calendar is advisory — a feed can be stale, a blocked slot can be the very event Peak is booked for, and
the PM may have confirmed by phone. Every scheduler shows the check and saves regardless. Blocked overlap →
"blocked"; if the venue lists any open windows and the booking isn't fully inside them → "outside the venue's open
times". Date-only pickers check the whole local day.

## D248. The companies map filters in the browser over every located venue (#197, 2026-09-25)

Map mode ships all ~1,300 located venues once and filters in memory, rather than round-tripping each filter through
the URL like the list view: a server re-render hands Leaflet a new pin array and would reset the user's pan/zoom on
every keystroke. The list view's URL filters seed the rail's initial state. The selected company is not in the URL
for the same reason; its panel loads through a server action.

## D249. One shared two-step ConfirmButton; every delete is soft (#198, 2026-09-25)

`src/components/confirm-button.tsx` replaces the per-screen hand-rolled arm/confirm and every remaining
`window.confirm()` (#178 — suppressed in the Capacitor shells, D96/D127). All new deletes are soft (`deleted` flag /
tombstone), so any of them can be recovered from the database. Linked records are not cascaded except an
engagement's open tasks, which belong to nothing else. A customer note can be deleted only by its author or an
admin, enforced in the action, not just the UI.

## D250. Consulting engagements are tombstone-aware like projects (#198, 2026-09-25)

`getEngagementByQuote` read live rows only, so deleting an engagement meant the next re-approve or
`syncEngagementsFromQuotes` sweep rebuilt it. `coveredQuoteIds()` in `stores/engagements.ts` now reads with
`includeDeleted: true` (the #169 project idiom) and gates both create paths. Consequence: re-winning a quote whose
engagement was deliberately deleted does not bring the engagement back — same as projects.

## D251. Labor overhead is internal: separate lines in the estimate, folded into labor for the customer (#201, 2026-09-25)

Supersedes D244. Jeff wants shop & engineering and the performance bonus visible as their own estimate lines but not on
anything the customer sees. The lines are stored separately (flag `laborOverhead`; legacy SKU prefixes recognised),
and `customerLines()` folds their sell into the mobilization line(s) by cost on the customer document only, falling
back to other labor lines, then to one neutral "Project management, engineering & shop" row — never naming the bonus,
never dropping the amount. Folding at render time (not at save time) keeps the estimate honest and lets the rule change
without rewriting saved quotes.

## D252. Grid-only settings live on Design → Grid Settings, admin-gated (#202, 2026-09-25)

`/design/grid/settings` (manage_users) holds the Grid's own knobs: category symbols, the port-rule review with a
per-rule Apply, wire types and install hours per device. Catalog taxonomy, per-part ports, assemblies, lineset and
motors stay where they are (they serve more than the Grid) and are linked. The port-rule Apply writes only that rule's
matches and still skips parts that already have ports, the same safety as the CLI's `--commit`.

## D253. A Grid plan sheet can be removed only when nothing uses it, and revisions bring it back (#203, 2026-09-25)

`removeSheet` refuses while any live placement, space or route references the sheet, and only drops it from the
project's sheet list — the `grid_sheets` doc and its file are kept, because revisions store `sheetIds`. Restoring a
revision re-adds any sheet its items reference, so a restore brings back exactly what the revision had.

## D254. The Specs module ships as a library first; JSON import/export bypasses the Import hub (#205, 2026-09-25)

The module lives under `/design/specs`. Product language — the actual clauses that print in a bid spec — lives on
the catalog part (`specTitle`/`specBody`), not on the article or the section; the library holds sections, Part 2
category articles and reusable formula/curtain templates, and only `specState: "authored"` text ever prints. A
`draft` is treated exactly like missing, everywhere.

The build spec (§4) asks for a `spec-library` import type in the Import hub. It doesn't get one: `parse.ts`'s header
comment says the hub is strictly columnar, its only file input accepts `.xlsx`/`.xlsm`, and every other path is the
CSV paste box. A four-collection library document (sections + articles + templates + curtain templates) is not a
table. It lands instead as **Export library** / **Import library** controls on `/design/specs/library`, reading and
writing the same JSON shape the spec describes, so the `spec-writer` skill's output (Phase C) still loads unchanged.
The *catalog* spec columns (Task 14) stay in the Import hub exactly as specified, because those are rows.

The outline convention (spec §2), verbatim: plain text, one item per line, two spaces per level, a tab counts as
one level. Labels by depth: `A.` `1.` `a.` `1)` `a)`. Depth beyond the fifth level clamps to the fifth and raises a
warning. Blank lines are ignored. A line already starting with a label such as `A. ` or `1. ` has it stripped.
Inside a product entry the product letter consumes the first level, so a body's top level prints as `1.`; inside a
Part 1 or Part 3 article it prints as `A.`. Article numbers are `1.1` / `2.1` / `3.1` — this supersedes D94's `2.01`
for anything this module renders.

`specSameAs` resolves **one hop**. A part pointing at another part's spec language prints that target's text; a
chain (A → B → C) or a cycle (A → B → A) resolves to nothing and reports "no spec", naming the target it couldn't
follow through — because following chains would make a spec's provenance unknowable from the part alone. This is
the resolved behavior `resolveSameAs` implements for Phase B's assembly; in Phase A itself, `matchBom`, the
Displays API and the client-package manifest still print a part's own `specBody` regardless of `specSameAs` — the
pointer is recorded (and validated: self-reference, chain and cycle all refused at save time) but nothing in this
phase actually substitutes the target's text at print time. The Spec panel's copy says so explicitly.

A part's Part 2 article resolves in this order: an **explicit** `specArticleId`, else the **category default**
(the part's catalog category mapped to an article), else a **legacy** `specSectionId` (the section's first article,
for records that predate articles), else nothing. A category default is a **pre-placement** — it tells the panel
and the coverage table where a part probably belongs — not language; it never substitutes for authored text.

Rows landed by the catalog importer (Task 14) land as `draft` and are gated (they print nowhere, including the
external Displays API) until someone opens the part and saves — an explicit review step. The one exception is the
starter library's own seed rows, which land `authored`: they came from a finished bid document a human already
signed off on, so re-review would be theater.

The rest of this plan's decisions: `D255` (the `/design/specs` redirect), `D256` (starter templates
auto-seed on every environment), `D257` (spec fields on `CatalogPart`), `D258` (one set of spec pointers),
`D259` (drafts gated everywhere), `D260` (the Spec panel's `create` visibility), `D261` (no `model`
field).

Explicitly **out of scope for Phase A**, so a later reader does not think it was missed: the generator, the four
doors, docx-per-section and zip output, the print view, the `spec-writer` skill and the North HS seed — all Phase B
and Phase C of the same spec (`docs/superpowers/specs/2026-09-21-spec-from-bom-module-design.md`).

## D255. `/design/specs` redirects to `/design/specs/library` in Phase A (#205, 2026-09-25)

The Generated list (the list of assembled, printable specs) is Phase B — it doesn't exist yet. A nav entry that
points at an empty placeholder page is worse than one that points at the screen that already does something. The
redirect is a two-line `page.tsx`; Phase B replaces the file with the real index and the redirect goes away.

## D256. Starter templates auto-seed on every environment, with a Restore button (#205, 2026-09-25)

`DEMO_COLLECTIONS` is `Object.keys(DOC_TABLES)` (`src/db/seed-data.ts:148-150`), so the `Clear demo data (go-live)`
reset wipes every doc collection including `spec_templates` — but the six starter formulas and four starter
curtain templates are configuration, not demo data, and a hosted database that was never dev-seeded needs them too.
The local-only `seedIfEmpty()` hook isn't enough on its own for that case (owner decision, 2026-09-25): every read
path that needs the formulas — the Templates screen, the part editor's Spec panel, and the library export (so the
`spec-writer` skill's Phase-C input always carries them) — calls the idempotent `ensureStarterTemplates()`, which
seeds only when the collection holds no live formula at all. The dev `seedIfEmpty()` hook stays for local
convenience, and the Templates screen keeps its **Restore starter templates** button for recovering after a
deliberate wipe.

## D257. Spec fields are declared on `CatalogPart` itself (#205, 2026-09-25)

`specArticleId`, `specSectionId`, `specTitle`, `specBody`, `specSameAs`, `specSort`, `specState`, `specSource`,
`specUpdatedAt` and `specUpdatedBy` are additive JSONB fields on `CatalogPart`, written only through
`mergeUpsert(sku, patch)` (never `upsert`, which would silently wipe `ports`/`trade`/datasheet fields). `bid-spec.ts`'s
`PartSpecFields` becomes a `Pick<CatalogPart, …>` over eight of those ten fields (`specArticleId`, `specSectionId`,
`specTitle`, `specBody`, `specSameAs`, `specSort`, `specState`, `specSource` — `specUpdatedAt`/`specUpdatedBy` aren't
part of the matching/assembly contract), so `SpecCatalogPart` stays assignable and every existing D94 call site
keeps compiling with no changes. No DB migration is needed — the fields are doc-store JSON.

## D258. One set of spec pointers — legacy Displays metadata adopts into the canonical fields (#205, 2026-09-25)

Commit 2e284665 (the Displays API) had already added `productMetadata.specSection` / `.specArticle` /
`.specLanguageKey` as free text (e.g. `"11 61 13"`, `"Stage Lighting Instruments"`). Rather than carry two competing
sets of spec fields, the owner chose **one**: this plan's `specSectionId` / `specArticleId` are canonical, and the
legacy text is adopted into them, never the reverse.

| Legacy field | Example | Canonical target | Rule |
|---|---|---|---|
| `productMetadata.specSection` | `"11 61 13"` | `specSectionId` | Adopted when the value is a live section **id**, or a CSI number matching exactly **one** live section (compared via `csiKey`, which drops everything but letters/digits, so `"11-61-13"` = `"116113"`). |
| `productMetadata.specArticle` | `"Stage Lighting Instruments"` | `specArticleId` | Adopted when the value is a live article **id**, or a title (case-/whitespace-insensitive) matching exactly **one** live article, searched within the part's section when known. An adopted article with no known section also fills `specSectionId` with that article's own section (the mirror invariant). |
| `productMetadata.specLanguageKey` | `"lighting.instrument"` | — | Research tag with no canonical counterpart; stays in `productMetadata`, untouched. |

Invariants: adoption only **fills an absent** canonical key — it never overwrites one, so an authored value always
wins. It never deletes the legacy text. Running it twice is a no-op. Ambiguity never guesses: two sections sharing a
number, or one title matching in two sections with no section known, adopt nothing. Adoption happens at **read
time** inside `articleIdForPart` (so the panel, the coverage table and Phase B are always right, with no write
required) and is additionally persisted by an idempotent **Adopt legacy pointers** button
(`adoptAllLegacySpecPointers`) for readers that don't adopt at read time (the Displays API's ETag, D94's `assemble`,
the catalog exporter).

The Import hub's `Spec Section` / `Spec Article` columns become **aliases** of the canonical `specSectionId` /
`specArticleId` columns under the same headers (Task 14) — there are no duplicate columns. All seven spec columns
map by **exact header only** (`exactOnly` on their `FieldDef`s); the hub's normal fuzzy "contains" pass is skipped
for them, because a vendor sheet's `Title`/`Text`/`Heading`/`State` column would otherwise silently overwrite and
demote authored text across the ~37,400-part catalog. The catalog exporter always emits `Spec State` **blank**, even
for an authored part — state is a gate on import (see D259), not a fact worth exporting, and a blank column
means "don't change this part's state" on re-import rather than accidentally re-authoring or re-drafting rows the
sheet doesn't actually carry text for.

**Consequence — a legacy-adopted pointer can't be cleared from the Spec panel.** Because adoption runs at read time
inside `articleIdForPart` itself (not just in the exporter/API/`assemble` call sites listed above), the panel's own
"— default from category —" option can't distinguish "nothing resolves" from "a resolvable legacy Displays
pointer" — choosing it just re-resolves to whatever `articleIdForPart` would have picked anyway, which is the
category default *or*, if one exists, the adopted legacy pointer (adoption is checked first, ahead of the category
lookup, inside that function). There is currently no control that stores an explicit "no article" state that would
suppress adoption; a part with a resolvable legacy pointer cannot be made to show "nothing resolves" from the panel.
Not a bug — adoption is deliberately unconditional and un-suppressible (never overwritten, never a per-part opt
out) — but worth a Phase B/C follow-up if a part ever needs to explicitly disclaim its legacy pointer.

**Consequence — CSV imports now stamp the real importer.** `catalogPatch`'s new `by` option (this task) is threaded
from `ctx.me`, which `import/actions.ts` now populates on every `commitImport(...)` call (previously only the
catalog-specific commit path received `me`; the generic import action didn't pass it at all). Every other importer
that reads `ctx.me` inherits this for free — the task-template `create` handler in `import/registry.ts` already had
`ctx.me ?? { name: "Import" }` waiting for exactly this, so a signed-in user's CSV import of task templates now
attributes new template sets to that user instead of the literal string "Import". Intended, not a regression: the
code was already written to prefer a real user when one is available.

## D259. Drafts are gated everywhere, not just in this module (#205, 2026-09-25)

"Only `specState: "authored"` ever prints" (D94's completeness rule) is enforced by one pure predicate,
`hasPrintableSpec()` (`src/lib/specs/articles.ts`), in every consumer that used to test `specBody?.trim()` alone —
this overrides "leave the D94 actions alone" for draft gating only; their `requireUser()` permission gates are
unchanged. The full list of gated consumers: `matchBom` (`src/lib/bid-spec.ts`), `remapRowAction` and
`saveSpecAction` (`src/app/(app)/design/engagements/spec/actions.ts` — `saveSpecAction` re-reads the catalog at save
time and refuses if a part was demoted to draft between match and save), `writePartSpecAction` (same file — an
inline D94 write now stamps `specState: "authored"`, since a human writing the text there **is** the review step),
`publicProductMetadata`/`publicCatalogPart`/the `spec` object in `src/lib/displays-api.ts`, all four v1 Displays
routes (`/api/v1/displays/specs`, `/specs/[id]`, `/catalog`, `/catalog/[sku]`), and `buildClientPackageManifest`
(`src/lib/client-package.ts`, where a draft is now a `missing-spec` gap). `assemble` (`bid-spec.ts`) needed no
change — it already only accepts `bucket === "ready"`, and that bucket is now sourced from `hasPrintableSpec`
everywhere it's set. The pre-v1 `/api/displays/catalog` route is left alone; it prints no spec body at all.

## D260. The part editor's Spec panel is visible to anyone with `create` (#205, 2026-09-25)

Unlike the admin-only datasheet control beside it, the Spec panel (`src/app/(app)/catalog/spec-panel.tsx`) shows for
any user who can `create` — spec authoring is estimating/design work, not an admin function. Every write it makes
still calls `requirePerm("create")` on the server; the visibility gate and the write gate are the same permission,
so there's no UI showing controls a save would then refuse.

## D261. No `model` field on `CatalogPart` (#205, 2026-09-25)

`CatalogPart.manufacturerModelNumber` (import column `MFR M/N`, already written by `upsertPart`) already **is** the
manufacturer's model number — a new `model` field would just be a second name for the same fact, and the import
hub's alias resolution would have to arbitrate between them. A table-style Part 2 prints `manufacturerModelNumber`,
then `manufacturerPartNumber`, then the SKU, falling through only when a field is blank. Building this module
surfaced (and fixed, Task 6) a pre-existing bug in the part modal: it had no `manufacturerPartNumber` /
`manufacturerModelNumber` inputs, so `upsertPart` wrote `undefined` for both on every save, silently wiping them —
the modal now has both inputs, and `upsertPart` only patches a field the form actually submitted.


## D262. Quote spawning is serialized per quote with a Postgres advisory lock, not a unique index (#180, #181, 2026-09-25)

Concurrent sweeps and wins could mint two jobs/projects for one quote (read-then-insert). Rather than a migration
adding unique indexes on `quoteId` across six doc collections (shared production DB, tombstoned rows must stay),
every spawner runs under `withQuoteLock` — a transaction-scoped `pg_advisory_xact_lock(180, hashtext(quoteId))`
(safe behind Neon's pooler; joins an enclosing transaction; bounded 10 s wait) — and re-reads the quote and its
coverage inside the lock. Hash collisions only serialize two quotes. The Estimator's Save changes status only through
the gated `setStatus`, and only when the user changed it from the last server-confirmed status (`baseStatus`).

## D263. A user's own email signature replaces the automatic profile footer (#127, 2026-09-25)

Two signatures existed: the new per-user one and the server-side `withEmailSignature` profile footer. When the
composer handled a #127 signature (kept or removed) the server skips the footer, so there is never a double
signature and "remove signature" really removes it; users with no personal signature keep the old footer.
Signatures are stored per user name in a keyed blob (no migration), like notification prefs.

## D264. Daylite-imported live repairs with an already-lapsed warranty are history (#192, 2026-09-25)

Jeff's call. `isLapsedLiveImport` excludes a Daylite-imported repair that is still "live" at a completed/invoiced
stage but whose End Date puts its warranty in the past from warranty follow-ups. Read-time only — no data changes;
repairs created in the app always follow the normal warranty rules.

## D265. Grid stock symbols are Tabler Icons (MIT), vendored as generated path data (#206, 2026-09-25)

`@tabler/icons` 3.48.0 is a **devDependency, pinned exact**. `scripts/build-grid-icons.ts` (`npm run icons:grid`)
reads the hand-authored pick list `scripts/grid-icon-picks.json` (86 outline icons → our id, label, tags; D89 holds)
and writes `src/lib/design/grid-icons.generated.ts` plus `LICENSES/tabler-icons.txt`. The runtime ships only that
curated data. The pin is exact rather than `^3.48` because `test:specs` byte-compares the committed output against a
fresh generation — a floating minor would fail the harness on the next install for no product reason. Bumping Tabler
is a deliberate edit: change the pin, run `npm run icons:grid`, commit both.

## D266. A device's colour is group → trade → Grid scope → grey (#206, 2026-09-25)

Ten swatches: the six catalog groups, the three trades (for trade-only categories such as Track or Racks) and
`Other`. Defaults are Okabe–Ito hues darkened until a white glyph clears 3:1 (the harness pins it). One step the
spec didn't list sits before grey: the Grid entry's own `scope` (Lighting, Rigging and Curtains map to their own
swatch; Audio and Video map to AV). Without it the Grid library's own categories — Lighting, Video, Rigging,
Cameras, Control, Fixture, which are not in the catalog category map — would all draw grey, defeating "colour says
the system". Category lookups are trimmed and case-insensitive, like `shapeFor`.

## D267. Category icons and colours are sparse per-key settings; the D154 shapes become a legacy fallback (#206, 2026-09-25)

`settings.gridCategoryIcons` and `settings.gridSymbolColors` store only what differs from the shipped defaults and
merge per key (a stored key replaces the default whose trimmed, lower-cased name matches). An empty save stores
`null`; "Reset to defaults" posts that. The old whole-map `gridCategoryShapes` is read only as the step after the
category icon, and only when an admin actually stored it — the old seed is never consulted, since every seeded
category now has a real icon. A stored `"rect"` is treated the same as no stored value at all (final fix wave,
2026-09-25): the old 8-shape card always wrote an explicit `"rect"` for every custom category — it was never a real
choice, just that card's own implicit default — so honouring it literally drew the rectangle glyph for every
legacy-saved category forever, and Grid Settings' Category icons card, which computes each row's baseline with the
same resolver, couldn't tell that choosing Device was a no-op either. Any other stored shape (e.g. `"speaker"`)
is still honoured. The eight D154 shapes are registered icons (`shape-rect` … `shape-camera`: five geometric glyphs
plus the three old glyph paths scaled 0.8), so a per-entry `shape` still draws what it meant. `symbolLook().shape`
keeps the D154 answer for any back-compat caller. The 8-shape settings card and `saveGridCategoryShapesAction` are
removed; `cleanGridCategoryShapes` stays (the regressions harness pins it).

## D268. The per-entry override: an icon supersedes the shape, and a colour is applied explicitly (#206, 2026-09-25)

Setting or clearing an entry's icon also clears its legacy `shape`, so "Use the category default" really returns to
the category icon. The colour control drafts locally and applies with a button (a native colour input fires on every
drag step, which would have been one server write per step); "Use the group colour" clears it. The action keeps the
#131 gate (`requireUser`) — it edits a shared Grid library entry, the same trust level as before. The Assemblies
"+ Build" form's new-entry Symbol picker (`createGridAssemblyAction`) got the same icon-supersedes-shape treatment:
it now accepts an `icon`, validated server-side with `isGridIconId`; `shape` stays accepted for back-compat callers,
but `createGridAssembly` clears it whenever an `icon` is given, so a caller can't leave both set.

## D269. One legend builder for the plan and the riser (#206, 2026-09-25)

`legendRows` yields one row per distinct icon+colour, first-seen order; a device whose look differs from its
category default is labelled "<category> — <desc>" (the #131 riser rule). Curtains are left out of the plan legend
because they draw their own drape glyph, not a badge. The plan legend's open/closed state lives in `localStorage`
through `useSyncExternalStore` (no hydration mismatch, no setState in an effect) and its rows always print.

## D270. Part documents are shared records with deterministic link ids (#207, 2026-09-25)

A datasheet or spec sheet is one `part_documents` row linked to many parts through `part_document_links` (spec §2.5,
DaVinci's model). Ids: a new upload or fetch mints `PD-` + 12 random hex (`newDocumentId`, so the browser can mint the
id its Blob path is keyed under without a collection scan); the legacy backfill uses `PD-L` + sha1(SKU) and the
DaVinci pre-fill `PD-D` + sha1(URL), so both are idempotent. Link ids are `PDL-` + sha1(SKU, document) — one row per
part↔document, soft-deleted to detach and revived by re-attaching; accessory links are `PAL-` + sha1(source, scope,
parent, accessory). A document fetched or pre-filled from a URL is keyed by that URL: every part that referenced it
shares the one document (spec §3).

## D271. "Has its own datasheet" opts a pair out for both kinds, across sources (#207, 2026-09-25)

The Assembly Builder's toggle lives on `part_accessory_links.ownDatasheet`, set on every live link of that
parent/accessory pair (assembly and DaVinci alike), and coverage reads the pair as opted out if any of its links says
so. It excludes the pair from step 3 of the coverage rule for spec sheets too — an accessory with its own datasheet is
documented on its own. Re-saving an assembly carries the flag over.

## D272. Fetch failures are remembered on the document (#207, 2026-09-25)

Spec §6 says fetch failures are "listed with the reason" and batch fetch is resumable. `part_documents` gains an
additive `lastFetch: { at, ok, error? }`. A catalog-held URL that fails to fetch becomes a link-only document (source
`fetch`) linked to the part, carrying the failure, so the Datasheets page shows it until a retry succeeds and fills
the same document. The fetcher reuses `src/lib/venue-calendar-fetch.ts`'s shared `guardedFetchBytes` (only
`hostnameIsUnsafe` became an export) with a 25 MB streaming cap, a 30 s timeout and five redirect hops; batch fetch
and the DaVinci pre-fill both run under a 45 s wall-clock budget per server-action call and are resumable — "run
again" picks up wherever a batch left off.

## D273. Filename matching: normalizeSku keys, 4-character floor, any catalog part (#207, 2026-09-25)

Bulk drop matches each file name against every catalog part's SKU, MFR P/N and MFR M/N through the DaVinci matcher's
own `normalizeSku`; the longest matching length wins, and keys under 4 characters never match (a 3-character model
number appears by accident in too many file names). A key two parts share is "ambiguous" and nothing is pre-ticked.
Matching covers the whole catalog, not only quoted parts, and runs server-side from file names alone — the catalog
never ships to the browser.

## D274. What "quoted" means on the Datasheets page (#207, 2026-09-25)

Scope is every catalog part on any quote (any status), any Grid placement or any generated bid spec, no time window
(spec §2.1). "Times quoted" counts distinct quotes; Grid and bid-spec use break ties, then the newest quote, then the
SKU. Labor lines and `kind: "labor"` sections are skipped (the quote client package's own BOM rule), `Labor`-category
parts are excluded, and a Grid curtain placement is not a catalog product.

## D275. The part editor's Documents section replaces the admin-only datasheet control (#207, 2026-09-25)

Spec §2.4 lets anyone signed in upload, attach, replace and remove. The single-file, admin-only
`PartDatasheetControl` and its `uploadPartDatasheetAction` / `removePartDatasheetAction` (8 MB data-URL transport,
wrote `datasheetBlobKey`) are removed; the Documents section uploads direct to Blob (25 MB) into shared documents.
Nothing writes `datasheetBlobKey` any more. It stays readable: the idempotent backfill turns it into a `legacy`
document on first read, and `/api/part-datasheet/<sku>` keeps streaming it — and otherwise redirects to the part's
datasheet document — so older links (the Grid editor, the pre-v1 Displays route, bookmarks) keep working.
Final fix wave: the bridge checks the part's own live datasheet documents FIRST (a stored file, else a link-only one)
and streams `datasheetBlobKey` only when the part has no live datasheet link and its legacy document was never minted —
so after a replace or detach of the backfilled legacy document, the Grid's "Datasheet" link never opens the stale
file. The lookup is keyed by SKU in SQL, not a scan of every link and document. The catalog list's "Datasheet" marker
follows the same rule (the part's own datasheet file).

## D276. Both Assembly Builder tabs feed the accessory graph (#207, 2026-09-25)

Assemblies tab: the `fixture`-role component is the parent and every other component an accessory (default quantity
above zero = `included`), scoped `assembly:<id>`; a save syncs every assembly in one pass and soft-deletes the links of
assemblies removed from the list. Subassemblies tab: the light engine is the parent, the lens and every option an
accessory, scoped `subassembly:<id>`, synced on save and cleared on delete. The toggle is enabled once a member is
saved (the pair must exist in the graph); setting it to the value it already has is a no-op success, and only a pair
missing from the graph asks for a save first.
Final fix wave: assemblies saved before part documents shipped are brought into the graph by a one-time, idempotent
sync of every fixture assembly and subassembly (`src/lib/part-docs/assembly-sync.ts`), the same pairs and scopes a
save writes. It syncs exactly the scopes that exist and prunes nothing else — a deleted assembly's links stay the save
action's job, and a settings read that comes back empty can never wipe the graph. It runs from
`npm run part-docs:backfill -- --commit` and on the Datasheets page's first read under a 15 s budget; a blob flag
(`part_docs_graph_sync`) set only on completion makes later reads a single-row check.

## D277. DaVinci pre-fill: English datasheets keyed by URL, the graph in the committed extract (#207, 2026-09-25)

`extract.ts` now also emits `accessoryTypes` / `accessoryLinks` (6,702 links over 1,753 types from the 2026-04-21
library; records are byte-identical), growing `data/davinci-extract.json` from ~1.39 MB to ~2.65 MB — the graph needs
every type a link touches, including the lens tubes and clamps `records` drops. The pre-fill writes link-only
documents for English DaVinci **Datasheet** documents only (manuals and other languages are not a slot; `language:
"en"`), links them to every Peak ETC SKU of the type, and writes the DaVinci graph scope; both ends pass the #162
manufacturer allowlist. Nothing is downloaded. It runs from an admin button on the Datasheets page (the extract is
traced into that route with `outputFileTracingIncludes`) or `npm run part-docs:davinci -- --apply --commit`. The doc
store's new batch writers (`insertDocsIfAbsent` / `upsertDocs` / `softDeleteDocs`, 500 rows per statement) carry the
pre-fill's writes.

## D278. Client packages: every document once; only a missing datasheet is a gap (#207, 2026-09-25)

A package zips each needed document once (`datasheets/…`, `specsheets/…`) with the SKUs it serves. Coverage is
computed in the package's own context — the Grid option's placements or the quote's lines — so an accessory rides on a
fixture only when that fixture is in the same package; alone, it is a `missing-datasheet` gap there. Covered
accessories are listed as `covered: [{ sku, by, note: "covered by <fixture>" }]`. A missing spec sheet is not a gap
(the spec names only `missing-datasheet`). The manifest's old `datasheets` array (which carried private blob keys
internally) is replaced by `documents`.

## D279. A rejected upload's blob is deleted (#207, 2026-09-25)

"Nothing is ever hard-deleted" (spec §2.4) governs documents. An upload whose bytes fail the magic-number check (not a
PDF, or Word on a datasheet slot) or exceed 25 MB never became a document, so its blob is deleted rather than left
orphaned.

## D280. Displays API datasheet links come from part documents (#207, 2026-09-25)

`publicCatalogPart(...).datasheets` lists the part's linked datasheet documents through `/api/part-documents/<id>`
(which streams, or redirects a link-only document to its source), else the manufacturer URLs the catalog row carries —
never the old `/api/part-datasheet/<sku>` URL that 404'd for a part whose only datasheet was a researched link. The
catalog ETag folds in documents and links, since attaching one moves no part's `updatedAt`.

## D-FXB-1. Fixtures and systems are one record type in the `subassemblies` table, ids kept (#FXB, 2026-09-25)

`FixtureRecord` (`src/lib/fixture-assemblies.ts`, store `src/lib/stores/fixtures.ts`) replaces both builders' records
in the existing `subassemblies` doc table — no new table, no SQL migration. A one-time, idempotent conversion
(`src/lib/fixtures-migrate.ts`) inserts each `settings.fixtureAssemblies` entry under its `fa-…` id (insert-if-absent,
so a deleted one stays deleted) and rewrites each legacy subassembly row in place under its `SA-…` id; the settings
array is left untouched as a backup and no longer read. It runs on the first `listFixtures()`, on the Datasheets page,
from `npm run fixtures:convert -- --commit` and `npm run part-docs:backfill -- --commit`, under a 15 s page budget; a
blob flag (`fixtures_convert.convertedAt`) set only on completion makes later reads one single-row check. While it has
not completed, `listFixtures()` serves the settings-backed assemblies in memory so Estimator/Quick Design/Grid ids keep
resolving. The go-live reset wipes the table but keeps settings, so it re-arms the flag and the assemblies return as
they did when they lived in settings. New records mint `SA-<TS36>` with `-2`, `-3`… on a same-millisecond collision.

The runner skips entirely on a Vercel preview deploy (`VERCEL_ENV === "preview"`) — only the CLI paths
(`fixtures:convert -- --commit`, `part-docs:backfill -- --commit`) write there — and every write is additive: the
legacy `SA-…` rewrite is `additiveFixturePatch(original, converted)`, which adds only the keys the old row lacks and
never overwrites one it already has, applied through a conditional atomic `UPDATE … WHERE id = X AND rev = <read rev>
AND deleted = false AND <legacy shape>` per row — a save or delete landing between read and write loses the race
harmlessly and that row just converts on the next pass. Completion also stamps `part_docs_graph_sync.assembliesSyncedAt`
so D276's older backfill treats the moved graph as already synced (see D-FXB-4). A converted row's legacy-only fields
(`options`, `lightEngineName`, `lensName`, `lightEngineCost`, `lensCost`, `cost`, `price`, snapshot-era keys…) then ride
untouched until a human resaves that exact record through the new form: `updateFixture` preserves every field the new
`CleanFixture` value doesn't own, with an explicit optional-field list so a field the user actually cleared (e.g.
`lamp`) reads back absent rather than resurrected from the legacy copy.

## D-FXB-2. Pricing is the Assemblies rule; a missing part keeps its cost override (#FXB, 2026-09-25)

Unit cost = line cost override ?? catalog cost, unit sell = catalog list; only qty ≥ 1 lines count, qty 0 lines are
optional add-ons listed with their unit numbers. A part missing from the catalog is `found: false`, sells at 0 and costs
its override or 0 — the spec says "contributes 0", but the Assemblies resolver already applied an override to a missing
part and converted totals must not move. The list's "was $X when built" badge compares **cost**: converted
subassemblies' snapshot `price` was their cost (the old price = cost rule), so a sell comparison would flag every one.

## D-FXB-3. Light engine and lens carry optional label / qty / override (#FXB, 2026-09-25)

The spec stores `lightEngineSku` / `lensSku`; a converted Assemblies-tab fixture member can have its own label, a
quantity other than 1, or an override, and dropping those would change Estimator descriptions and totals. They live in
optional `lightEngineLine` / `lensLine` (qty defaults to 1). Parts price in form order — engine, lens, Data, Power,
Mounting, Accessories — so a converted assembly's BOM description can list parts in a different order than before;
totals, components and ids are identical (parity-tested). Converted cable/lamp/other members land in Accessories and
their Estimator component role reads `accessory`. Old stored names survive only as `legacy.names`, fallback display for a
missing part.

## D-FXB-4. The accessory graph moves to one `fixture:<id>` scope (#FXB, 2026-09-25)

Fixtures only: parent = light engine; lens and every box line (qty 0 = un-included link) are accessories. The
conversion writes the `fixture:` scopes add-only (a live row and its flag are never rewritten), then soft-deletes every
`assembly:` / `subassembly:` row — after, so the "has its own datasheet" flag carries from the old row of the same pair.
This replaces D276's two scopes and its `part_docs_graph_sync` flag (production had already set that one, so the move
needed its own flag). Saves reconcile `fixture:<id>`; deletes empty it. Systems never feed the graph.

## D-FXB-5. Consumers read fixtures; systems wait for the Grid Equipment map (#FXB, 2026-09-25)

The Estimator configurator and Quick Design list fixture records through `fixtureAssembliesFrom()`, which returns
today's `ResolvedFixtureAssembly` shape, so their code paths are unchanged. Systems are not offered there (spec §5 lists
fixtures); the Grid Equipment map is their first consumer. The Grid scope panel has no fixture picker today and its
intake carries the id map, which keeps resolving because ids are kept — no Grid code change. The Estimator shows an
optional add-on as an off switch (on = qty 1) and pre-fills a fixture's default hang position / circuit into an empty
field. The fixture BOM line moved to `estimator/fixture-bom.ts`, unchanged.

## D-FXB-6. Anyone signed in edits; kind is fixed; a human save clears needs-review (#FXB, 2026-09-25)

`requireUser()` on save / delete / the datasheet toggle (the Subassemblies tab needed `manage_users`). Every save stamps
`updatedAt` / `updatedBy`, and create also stamps `createdAt` / `createdBy`. A record cannot switch between fixture and system.
Converted assemblies with no fixture-role member are flagged "needs review" (their first part became the light engine)
until someone saves them. The save action reads only the record's SKUs from the catalog (`listDocsByField`), never the
whole book. `/design/assemblies?tab=…` and `/design/subassemblies` redirect to the one list.

The form's own part pickers (light engine, lens, every box line) never get the whole catalog either: they search
server-side through a debounced `searchAssemblyPartsAction` (`requireUser`, result-capped, wraps the Estimator's
existing `searchCatalog`) instead of filtering a client-side array. Combined with the page loading only the SKUs its
saved fixtures reference, neither the page payload nor a picker's keystroke scales with production's ~37,400-row
catalog; a part not yet on any fixture is still reachable, just through the search box instead of a preloaded list.

## D-FXB-7. Converted lines list parts in form order, with box roles; totals are unchanged (#FXB, 2026-09-25)

For a converted assembly, new Estimator lines list parts in the builder's form order (light engine, lens, Data, Power,
Mounting, Accessories), and `components[]` carry box roles — cable/lamp/other → accessory. Totals (cost, price) stay
identical to main. Saved quotes are untouched: a saved line's stored `components[]` / description are frozen at save
time and never re-derived.
