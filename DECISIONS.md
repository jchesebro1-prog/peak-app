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
