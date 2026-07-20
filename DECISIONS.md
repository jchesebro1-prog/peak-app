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
