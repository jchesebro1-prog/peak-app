# Portal Service Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal customers generate firm, numbered flame-test and inspection (L1/L2) quotes for one or more of their venues, priced by the existing service engines; repairs route to the existing request form.

**Architecture:** Two server modules wrap the existing engines — scope (pre-fill counts from each venue's last job/record/quote) and pricing (builder-identical engine input + tier margin → sell-only customer view + the builder subdoc). A generate module creates the quote (`source: "portal-service"`, real `quoteType`) and sends it through #245's `sendPortalFirm`. #245's Accept/Refresh/Decline and staff Portal panel are widened to the new source.

**Tech Stack:** Next.js 16 App Router, Drizzle doc-store, PGlite tests.

**Spec:** `docs/superpowers/specs/2026-09-28-portal-service-quotes-design.md`.

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/portal-service`, branch `feat/portal-service`. `npm ci` once if `node_modules` is absent (never symlink); copy `.env.local` + `next-env.d.ts` from the main checkout if absent. `export PATH="$HOME/.local/node/bin:$PATH"`.
- Never open `.data/pglite`; never run two DB processes; never leave `tsx`/`next dev` running; **never `git stash`** (commit `wip(...)` instead).
- Punch **#248** (recompute before docs). Test messages prefixed `#248`; aliases `d246…`; async checks `portal248XxxAsyncChecks` chained directly above `  // Before the report and before the \`.catch\``; fixtures `fixtureId(248, "slug")` + `registerFixture(coll, id)`.
- Server-action files export only cookie-reading wrappers (`portalSession()`); session-taking bodies live in `src/lib/` (the #245 pattern, e.g. `src/lib/portal-cart-actions.ts`, `src/lib/portal-quotes.ts`).
- Customers never receive rates, hours, margin, tier name, cost, travel mode/crew/airfare. Customer views are explicit whitelists (never spread).
- Verbatim copy: "All quotes are subject to Peak review and approval." · "Plus applicable sales tax." · "Your access link has expired — open the link we sent you again." · "Pick at least one venue." · "Enter the number of curtains (1–200)." · "Enter the number of line sets (1–300)."
- Counts: curtains integer 1–200; line sets integer 1–300. Rate limits: price 240/min per grant, generate 10/h per grant.
- Gates per task: `npx tsc --noEmit`; `npm run test:specs` (report PASS/FAIL counts; baseline measured in Task 1); `npx eslint <touched files>` (errors); `npx next build` when a page/component changes (check `df -h /` > 10 GB); `npm run test:smoke` when routes change (first `lsof -i :3000` must be empty, else skip and report).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Scope pre-fill + builder-identical pricing

**Files:** Create `src/lib/portal-service-scope.ts`, `src/lib/portal-service-pricing.ts`; possibly extract a shared helper from `src/app/(app)/flame-tests/quote/actions.ts` and `src/app/(app)/inspections/quote/actions.ts` (`persist()` venue→engine-input step) into `src/lib/service-quote-inputs.ts`. Tests in the harness.

**Interfaces (produces):**
```ts
export type PortalService = { kind: "flame" } | { kind: "inspection"; level: 1 | 2 };
export type VenueScope = { venueId: string; label: string; count: number | null; source: "job" | "quote" | null; sourceYear: number | null };
export async function serviceScopeFor(customerId: string, service: PortalService): Promise<VenueScope[]>; // one entry per customer venue
export function pickScopeCount(input: { job?: { count: number; at: number } | null; quote?: { count: number; at: number } | null }): { count: number | null; source: "job" | "quote" | null; sourceYear: number | null }; // pure: job wins, else quote, else null
export type ServiceRequest = { service: PortalService; venues: Array<{ venueId: string; count: number }> };
export type ServiceCustomerView = { lines: Array<{ label: string; amount: number }>; travel: number; total: number };
export async function priceServiceRequest(session: { customerId: string; name: string }, req: ServiceRequest): Promise<
  { ok: true; view: ServiceCustomerView; subdoc: unknown; total: number; margin: number; tier: string; tierMargin: number } | { ok: false; error: string }>;
export function serviceRequestProblem(req: unknown, venueIds: Set<string>): string | null; // pure validation → verbatim copy
```

- [ ] Read both builders' `persist()` and `src/lib/renewal-outreach.ts` `ensureFlameRenewalQuote` / `ensureInspectionRenewalQuote` (scope sources, `coordsOf`, office via `quoteOrigin`, `getTravelRates`, rates blobs). Read `flame-jobs.ts` `renewals` and `inspections.ts` `renewals` for "latest completed per venue (+level)".
- [ ] Write failing tests: `pickScopeCount` order; `serviceRequestProblem` (empty venues, foreign venue id, non-integer / 0 / 201 curtains, 301 line sets, bad level) with verbatim copy; DB: a customer with a completed flame job (curtains 12) and a later quote (curtains 14) → scope count 12 source "job"; inspection scope is level-specific; **parity**: for the same customer/venues/counts, `priceServiceRequest(...).total` equals what the builder engine returns via the builder's own input path at the same tier margin; `JSON.stringify(view)` has no `margin`/`rate`/`hours`/`cost`/`crew`/`airfare`/`tier` keys.
- [ ] Implement. Prefer extracting the builders' venue-input step into `service-quote-inputs.ts` and calling it from both builders and `priceServiceRequest` (no behavior change for builders — their existing tests must still pass). Customer view: per-venue lines use the engine's per-venue sell where it exists (flame `perVenue`); where the engine has no per-venue sell (inspection), print one line "Annual rigging inspection — N line sets across M venues" style and the total; travel line = the engine's travel sell portion if separable, else fold travel into lines and set `travel` = 0 — document the choice.
- [ ] Gates; commit `feat(portal): service quote scope pre-fill + builder-identical pricing (#248)`.

### Task 2: Generate, refresh, accept/decline widening

**Files:** Create `src/lib/portal-service-quotes.ts`; modify `src/lib/portal-quotes.ts` (refresh branch, decline source check), `src/lib/stores/quotes.ts` (`portalListsQuote` treats `portal-service` like `portal-catalog`), `src/lib/quote-pdf/*` letter data for `portal-service` lines.

**Interfaces:** `generateServiceQuote(session: PortalSession | null, req: ServiceRequest, opts?: { now?: number; schedulePdf?: boolean }): Promise<{ ok: true; quoteId: string } | { ok: false; error: string }>`.

- [ ] Failing DB tests: generate flame (2 venues) → `status "sent"`, `quoteType "flame_test"`, `source "portal-service"`, FLM estimate number, `portalFirm.validUntil` = +30 d, `flameTest` subdoc venues/curtains saved, owner = company owner or ""; inspection L2 → `inspection.level === 2`, RIG number; preview (`grantId "preview"`) refused; expired grant copy; rate limit 10/h; refresh an expired portal-service quote at a changed rate → new value, new revision, portal PDF source points at newest sent revision; decline works on an accepted portal-service quote; accept path unchanged (`canAcceptPortal`).
- [ ] Implement: follow `generatePortalQuote` (create → schedule PDF → `sendPortalFirm`; once created, report success even if a later step fails; in-flight guard). Name: "Flame test — <venue labels joined by ', '>" / "Inspection (Annual|Five-year) — …" (truncate to 120 chars). Letter PDF (flame/inspection letter templates via `src/lib/quote-pdf/quote-document-data.ts` or the letter data module — find where letters build their lines): for `source === "portal-service"` add the standing review line, "Plus applicable sales tax.", and "Valid until <Month D, YYYY>" when `portalFirm`.
- [ ] Gates; commit `feat(portal): generate firm flame/inspection quotes; refresh + decline cover portal service quotes (#248)`.

### Task 3: Portal UI — `/portal/service`, entry points, repair request prefill

**Files:** Create `src/app/portal/service/page.tsx`, `service-form.tsx` (client), `actions.ts` (wrappers: `priceServiceAction`, `generateServiceAction`); modify `src/app/portal/nav.ts` (+ Service), `src/app/portal/page.tsx` (card button, per-chip "Quote it", "Request a repair", row "Quote again" for portal-service quotes), `src/app/portal/request/*` (read `?service=&venue=` to pre-select), `scripts/smoke-routes.ts`.

- [ ] Page per spec §2: `resolvePortalViewer(preview)`; signed-out → the shared signed-out card; service picker (URL `?type=flame|inspection&level=1|2&venue=`), venue checklist with pre-filled counts + source hint, debounced live price (server action re-validates everything; rate-limited), standing lines, Generate (disabled with reason; preview read-only) → redirect `/portal?generated=firm&q=<id>`.
- [ ] Entry points per spec §1. "Quote again" pre-fills the form from the quote's scope (`?from=<quoteId>`; the page loads that quote only if `portalListsQuote(q, cid)` and it's `portal-service` or a flame/inspection quote of this customer).
- [ ] Tests: harness checks for any pure helpers (URL param parsing → PortalService); smoke GETs `/portal/service`, `/portal/service?type=inspection&level=2`.
- [ ] Gates incl. build + smoke; commit `feat(portal): /portal/service — pick venues, see the price, generate; entry points on the compliance card; repair requests pre-filled (#248)`.

### Task 4: Staff side

**Files:** `src/app/(app)/flame-tests/quote/*`, `src/app/(app)/inspections/quote/*` (persist keeps `portal-service`; render the Portal panel), `src/app/(app)/estimator/portal-panel.tsx` (generalize: Approve callback/action prop instead of the Quotes-hub won path when the builder supplies one), `src/lib/portal-bell.ts` + `src/app/(app)/quotes/page.tsx` + company page (include `portal-service`).

- [ ] Failing tests: builder `persist` on a loaded `portal-service` quote keeps the source (DB check through the lib-level body, or a pure `sourceForSave(prior, fallback)` helper used by the three builders + Estimator); bell "New portal quotes" and hub badge include `portal-service`; Approve from the flame builder panel → won + flame job spawned (the builder's approve action path).
- [ ] Implement; the panel's Decline reuses `declinePortalAcceptanceAction`.
- [ ] Gates incl. build; commit `feat(portal): staff Portal panel on flame/inspection builders; portal service quotes keep their source; badge/bell/company counts (#248)`.

### Task 5: Docs

- [ ] Recompute next free D/punch numbers from `origin/main`. DECISIONS (one entry per pick in the spec + build deviations from reports), PUNCHLIST #248 (what shipped, Jeff-gated: try with a real grant; check a multi-venue flame quote against the builder; follow-ups: repair pricing library, scheduling requests), AGENTS.md phase item 20, update PUNCHLIST #245 follow-up line to point at #248.
- [ ] Commit `docs: portal service quotes — punch #248, D4xx–D4yy`.
