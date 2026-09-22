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
## D132. Quartzite native shell — Capacitor remote/hybrid Phase 1 (2026-09-20)

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

The Capacitor shell (D132) could not sign in: Capacitor hands any non-app host to the system
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
