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
