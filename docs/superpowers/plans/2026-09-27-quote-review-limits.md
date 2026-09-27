# Quote Review Limits (#242) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each teammate approve their own quotes automatically when the quote's total is at or under a per-person, per-review-kind limit set by an Admin, with the rule shown as a chip on every builder and the quotes hub.

**Architecture:** One pure, client-safe rules module (`src/lib/review-limits.ts`) decides a quote's review kind, evaluates the owner's limit, and phrases the chip. A thin server module (`src/lib/review-limits-server.ts`) loads limits (settings blob `reviewLimits`) plus the roster. The approval decision moves into one pure `decideApprovalGate` in `src/lib/stores/quotes.ts`, which `setStatus` consults and whose auto-approval record it writes in the same patch as the status change, so every path to `sent`/`won` gets it once. Auto approvals re-check against the owner's current limit every time they are relied on.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle over PGlite/Postgres (doc-store), the `scripts/test-review-and-spec.ts` spec harness (tsx).

## Global Constraints

- Spec (the authority): `docs/superpowers/specs/2026-09-27-quote-review-limits-design.md`. Kind keys verbatim: `system_plain`, `system_labor`, `flame_auto`, `flame_typed`, `repair_auto`, `repair_typed`, `inspection_auto`, `inspection_typed`, `rental`, `consulting`.
- Settings blob key `reviewLimits`: `{ [userId]: { [kind]: number | "none" } }`. A missing key means blank, which means the quote always needs review. That is the default, so nothing changes until Jeff fills the table in.
- Review method value `"auto_limit"`, with snapshot `{ kind, limit, value }`. `decidedBy` is the quote **owner**, `decidedAt` is now.
- Copy, verbatim from the spec: chip `Within your limit — approves automatically` / `Over your $25,000 limit — needs review`; banner `Auto-approved — within Nic's $25,000 limit for system estimates without labor`.
- Deterministic only (D89). No AI and no network.
- Timestamps are epoch-ms numbers.
- This is **Next.js 16** (read `AGENTS.md`). Follow neighbouring code, not memory. Server actions live in `"use server"` files. Client components refresh with `router.refresh()`.
- A `"use client"` component must never import a **value** from `@/lib/stores/*`, `@/db*`, `@/lib/settings`, `@/lib/users` or `@/lib/review-limits-server`. Type-only imports are fine. Server-evaluated results reach clients as props.
- Harness: every assertion message carries `#242`. New sync blocks and async functions go at the **END** of `scripts/test-review-and-spec.ts`. Each async check is added as one `.then(() => …)` line placed immediately above the comment line `// Before the report and before the \`.catch\`, so a thrown suite is torn` (currently line 10529). New import aliases are prefixed `r242` (types `R242`). ES imports hoist, so mid-file placement is fine. **Never re-import an alias an earlier task already declared.** Each task lists which ones it reuses.
- Gates per task: `npx tsc --noEmit` (0 errors); `npm run test:specs` (baseline **6371 PASS / 0 FAIL**, each task states its expected PASS total); `npx eslint <every changed file>` (0 errors, and no warning that `git show HEAD:<file> | npx eslint --stdin --stdin-filename <file>` doesn't also show); `npx next build` on Tasks 2–5, which touch client/server boundaries.
- Before any `test:specs` or `next build`, run `ps aux | grep -E "tsx|next (dev|build)" | grep -v grep` and make sure nothing is running. Never start a dev server. Never open `.data/pglite`. `test:specs` uses its own `mktemp` datadir.
- Never `git stash`. Commit each task with `git commit` (no push). The message is `feat(quotes): <summary> (#242)`, a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do **not** edit `DECISIONS.md`, `PUNCHLIST.md` or `AGENTS.md`. The controller writes docs. The decisions to log are listed at the end of this plan.

## Recon landmarks (pinned 2026-09-27, branch `feat/punch-inbox-tasks` @ fce73eab)

**Approval model: `src/lib/stores/quotes.ts`**
- `ApprovalMethod` :134, `QuoteReview` :136–146, `rv()` :351, `hasApproval` :372, `requireApprovalToAdvance` :412 (the two refusal sentences), `canAttestApproval` :460, the `approvedReviewLine` re-export :492.
- `SetStatusOpts` :880. `resolveStatusGate` :894 (pure; bypasses are `engine-owned-flow` / `historical-import`).
- `setStatus` :1016. It takes the row lock, reads, does the #170 same-status early return (no gate), then `resolveStatusGate` at :1050, throws `ApprovalGateRefused`, and patches status/history/stage/revision at :1055–1070.
- `approve` :1259, `attestApproval` :1292, `requestChanges` :1311. All three mutate the existing review object.
- `buildQuote` :523 sets `preparedBy: partial.preparedBy || partial.owner`.

**Every path to `sent`/`won`.** All of them funnel through `setStatus`, so the auto-approval goes **inside `setStatus`**, applied once:
- `src/app/(app)/quotes/actions.ts:56` (hub status buttons / Send form)
- `src/app/(app)/home-actions.ts:44` (stage sheet)
- `src/app/(app)/inbox/actions.ts:414` (`completeRenewalOutreach`: renewal quote → sent after the email)
- `src/app/(app)/estimator/actions.ts`: `saveQuoteAction` :405 / :475, `setStatusAction` :720 (**pure pre-check at :735–745**), `setQuoteStageAction` :779 → `setQuoteStage` → `setStatus`, `sendToCustomerAction` :889 (**pure pre-check at :892**)
- The engine-owned `won` bypass: `flame-tests/quote/actions.ts:237`, `repairs/quote/actions.ts:298`, `inspections/quote/actions.ts:240`, `rentals/quote/actions.ts:174`
- The CSV import bypass: `import/registry.ts:1072, :1094`
- Portal acceptance (`src/app/portal/actions.ts:115`) only sets `portalAcceptance`. It never changes status, so there is nothing to gate.
- The two pure pre-checks are the only places that decide without `setStatus`. They switch to an async `checkApprovalGate` that makes the same decision.

**Labor on system quotes**
- Estimator `spec = { sections, mobs }` (`estimator/types.ts:145` `SpecSection.kind` `'materials'|'labor'`; `SpecItem` :28, with `labor?` :51, `option?` :53, `extSellOverride?` :38). `estimator/pricing.ts:200` sums `lab` from `sec.kind === "labor" || it.labor`, skipping `it.option`. `lineExtSellOf` is at :65.
- Grid: `src/lib/design/grid-quote.ts:251–276` writes one `labor:<system>` line per BOM heading, only when its amount is > 0, into `spec.lines[]` (`{sku, desc, qty, unit, price, ext}`). `isLaborSku` / `LABOR_SKU_PREFIX` are at `src/lib/design/wire-labor.ts:264–272`, and that module has type-only imports.
- Quick Design promote: `src/lib/stores/designs.ts:449–480` `designToQuotePartial` gives `spec = { venue, size, tier, width, depth, grid, systems, fromDesign }` with no lines. Its value is the Quick budget, `quick/engine.ts:662–683` `tierTotals`, which always adds `install`.
- Precedent: `stores/projects.ts:600–607` `quoteHasLabor`.

**Typed total on service quotes (#217, D363–D366)**
- `priceOverride` sits on `quote.flameTest` / `quote.repair` / `quote.inspection` (writes: `flame-tests/quote/actions.ts:192–193`, `repairs/quote/actions.ts:253–254`, `inspections/quote/actions.ts:195–196`).
- `priceOverrideSeeded: true` marks the D286 reopen-seed of an old off-grid sent price. It is not something anyone typed (`service-pricing.ts:345–430`, `deriveSeededMarker`).
- `renewal-outreach.ts:176` `priorHandSetPrice` is the existing "hand-typed?" rule: ignore seeded, else `normalizePriceOverride`. It lives in a server module, so the pure module restates it using `normalizePriceOverride` (`service-pricing.ts:69`, which has no imports).
- Flame `venues[].testingOverride` (D365) is a cost input, not a typed total.

**Owner**
- `Quote.owner` is a display-name string (estimator create writes `owner: user.name`; `attestApprovalAction` compares `cur.owner !== user.name`).
- The `users` table is at `src/db/schema.ts:32–52`, with `id` `u1…`, `name`, and `status` `active|archived|removed`. `allUsers()` is at `src/lib/users.ts:11`.
- The rule is name → id: trimmed, case-insensitive, active users only, exactly one match.

**Settings**
- `AppSettingsData` is at `src/lib/settings.ts:31–164`, with `getSettings` :264 (swallows errors to `{}`, which fails closed here) and `setSettings` :296 (merge).
- The card to mirror is `src/app/(app)/settings/document-categories-card.tsx` plus `saveDocumentCategoriesAction` (`settings/actions.ts:837`, `requirePerm("manage_users")`).
- `settings/page.tsx:193–200` passes the resolved lists. `settings-client.tsx`: props :170–224; the Team + Roles admin grid :1905–2168; the admin cards fragment :2171–2220.

**Where approval text renders**
- `src/lib/review-line.ts` `approvedReviewLine` (client-safe) is used by `estimator-client.tsx:1877` and `quotes/page.tsx:824`.
- Reviews history is `reviews/page.tsx:164–166` ("Submitted by me" filters on `review.submittedBy === me`).

**Chip surfaces**
- Estimator: `estimator/page.tsx` (server) → `EstimatorClient`. The review bar view-model is at `estimator-client.tsx:1861–1897`, the bar JSX at :2277–2336, `applySync`/`applyStageSync` at :780–798, the save handler at :853, and `ReviewSync`/`StageSync`/`SaveResult` at `estimator/actions.ts:148/177/197`.
- Service builders are server pages that render a client builder after `<ActionError/>`: `flame-tests/quote/page.tsx`, `repairs/quote/page.tsx`, `inspections/quote/page.tsx`, `rentals/quote/page.tsx`, `design/engagements/quote/page.tsx`. Each can render a hook-free chip component above the builder, which is a server-computed prop.
- Quotes hub: `quotes/page.tsx` (server). The row map is at :540, badges at :597–660, and `SelectedPanel` (`canSend` :815, `rbSub` :817–829) at :785.

## File Structure

| File | Responsibility |
|---|---|
| **Create** `src/lib/review-limits.ts` | Pure, client-safe rules: kinds and labels, `reviewKindOf`, labor and typed-total predicates, owner resolution, limit evaluation, whether an approval still holds, chip data, sanitize/parse/format, the card's cell merge. |
| **Create** `src/lib/review-limits-server.ts` | `loadReviewLimitContext()` (settings + roster) and `reviewLimitChipFor(q, viewer)`. |
| **Create** `src/components/review-limit-chip.tsx` | Hook-free presentational chip (`banner` / `inline` / `pill`), usable from server pages and the Estimator client. |
| **Create** `src/app/(app)/settings/review-limits-card.tsx` | Admin card: the person × kind table, saved as a whole map. |
| Modify `src/lib/settings.ts` | `AppSettingsData.reviewLimits`. |
| Modify `src/app/(app)/settings/actions.ts`, `page.tsx`, `settings-client.tsx` | Save action, prop, card placement. |
| Modify `src/lib/stores/quotes.ts` | `"auto_limit"` method and `auto` snapshot; `decideApprovalGate`, `autoApprovedReview`, `checkApprovalGate`; `setStatus` stamps; approve/attest/changes clear `auto`. |
| Modify `src/app/(app)/estimator/actions.ts` | Pre-checks call `checkApprovalGate` (Task 3). Syncs and the save result carry `reviewLimit` (Task 5). |
| Modify `src/lib/review-line.ts` | Auto-approval and stale sentences. |
| Modify `src/app/(app)/quotes/page.tsx`, `src/app/(app)/reviews/page.tsx`, the five builder `page.tsx` files | Chips, the hub's Send/stale handling, Reviews history text. |
| Modify `src/app/(app)/estimator/types.ts`, `page.tsx`, `estimator-client.tsx` | Estimator chip, stale banner, Send when within limit. |
| Modify `scripts/test-review-and-spec.ts` | `#242` assertions appended at the end. |

---

### Task 1: Pure review-limit rules

**Files:**
- Create: `src/lib/review-limits.ts`
- Test: `scripts/test-review-and-spec.ts` (append at END)

**Interfaces:**
- Consumes: `normalizePriceOverride` (`@/lib/service-pricing`), `isLaborSku` (`@/lib/design/wire-labor`), `firstName` (`@/lib/team`), `money` (`@/lib/format`).
- Produces (all exported from `@/lib/review-limits`):
  - `REVIEW_KINDS` (readonly tuple of `{ key, group, sub, phrase }`), `type ReviewKind`, `REVIEW_KIND_KEYS: readonly ReviewKind[]`, `isReviewKind(v: unknown): v is ReviewKind`, `reviewKindColumn(kind: ReviewKind): string`, `reviewKindPhrase(kind: string): string`
  - `REVIEW_LIMIT_MAX = 10_000_000`, `type ReviewLimit = number | "none"`, `type ReviewLimits = Record<string, Partial<Record<ReviewKind, ReviewLimit>>>`
  - `type AutoApprovalSnapshot = { kind: ReviewKind; limit: ReviewLimit; value: number }`
  - `type ReviewLike = { state: string; method?: string | null; auto?: AutoApprovalSnapshot | null }`
  - `type ReviewableQuote = { quoteType?: string | null; value: number; owner?: string | null; preparedBy?: string | null; status?: string; spec?: unknown; flameTest?: unknown; repair?: unknown; inspection?: unknown; review?: ReviewLike | null }`
  - `type RosterEntry = { id: string; name: string; status: string }`, `type ReviewLimitContext = { limits: ReviewLimits; roster: readonly RosterEntry[] }`, `NO_REVIEW_LIMITS: ReviewLimitContext`
  - `hasLaborLine(spec: unknown): boolean`, `hasTypedTotal(sub: unknown): boolean`, `reviewKindOf(q: KindInput): ReviewKind`
  - `quoteOwnerName(q): string`, `resolveOwnerId(name: string, roster: readonly RosterEntry[]): string | null`
  - `type ReviewLimitEval = { kind; ownerName; ownerId: string | null; limit: ReviewLimit | null; value: number; fits: boolean }`, `type AutoApprovalEval = ReviewLimitEval & { ownerId: string; limit: ReviewLimit; fits: true }`
  - `evaluateReviewLimit(q: ReviewableQuote, ctx): ReviewLimitEval`, `canAutoApprove(q, ctx): AutoApprovalEval | null`, `approvalHolds(q, ctx): boolean`
  - `type ReviewLimitChipData = { tone: "within" | "over"; text: string; short: string; staleAuto: boolean }`, `reviewLimitChip(q: ReviewableQuote, ctx, viewerName: string): ReviewLimitChipData | null`
  - `sanitizeReviewLimits(raw: unknown, knownUserIds: ReadonlySet<string> | null): ReviewLimits`, `reviewLimitsFrom(stored: unknown): ReviewLimits`, `parseLimitInput(text: string): { ok: true; limit: ReviewLimit | null } | { ok: false; error: string }`, `formatLimitInput(limit: ReviewLimit | null | undefined): string`

- [ ] **Step 1: Write the failing tests** by appending this block at the very END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #242 — quote review limits: pure rules (src/lib/review-limits.ts).
   ====================================================================== */
import {
  REVIEW_KIND_KEYS as r242KindKeys, reviewKindColumn as r242Column, reviewKindPhrase as r242Phrase,
  reviewKindOf as r242KindOf, hasLaborLine as r242HasLabor, hasTypedTotal as r242Typed,
  sanitizeReviewLimits as r242Sanitize, reviewLimitsFrom as r242From, parseLimitInput as r242Parse,
  formatLimitInput as r242Format, resolveOwnerId as r242Owner, evaluateReviewLimit as r242Eval,
  canAutoApprove as r242CanAuto, approvalHolds as r242Holds, reviewLimitChip as r242Chip,
  NO_REVIEW_LIMITS as r242None, type ReviewLimitContext as R242Ctx, type ReviewableQuote as R242Q,
} from "@/lib/review-limits";
{
  ok(
    r242KindKeys.join(",") ===
      "system_plain,system_labor,flame_auto,flame_typed,repair_auto,repair_typed,inspection_auto,inspection_typed,rental,consulting",
    "#242: ten review kinds, in the Settings column order"
  );
  ok(
    r242Column("system_plain") === "System estimate — no labor" && r242Column("system_labor") === "System estimate — with labor" &&
      r242Column("flame_typed") === "Flame test — typed total" && r242Column("rental") === "Rental",
    "#242: column labels match the spec table"
  );

  const est = (items: Array<Record<string, unknown>>, kind = "materials") => ({
    sections: [{ id: "s", name: "S", kind, mfr: "", freightPct: 0, items }],
    mobs: [],
  });
  ok(!r242HasLabor(est([{ sku: "A", qty: 2, price: 100, cost: 50 }])), "#242: an Estimator spec with only material lines has no labor");
  ok(r242HasLabor(est([{ sku: "LAB-RIG", qty: 10, price: 95, cost: 62 }], "labor")), "#242: an item in a kind:\"labor\" section is labor");
  ok(r242HasLabor(est([{ sku: "LAB-x", qty: 1, price: 500, cost: 300, labor: true }])), "#242: a labor:true item inside a materials section is labor (pricing.ts sums it into lab)");
  ok(!r242HasLabor(est([{ sku: "LAB-x", qty: 1, price: 500, cost: 300, labor: true, option: true }])), "#242: an optional labor line (excluded from totals) does not count");
  ok(!r242HasLabor(est([{ sku: "LAB-x", qty: 0, price: 500, cost: 300 }], "labor")), "#242: a $0 labor line does not count");
  ok(
    !r242HasLabor(est([
      { sku: "CUSTOM", qty: 1, price: 900, cost: 0, custom: true },
      { sku: "ALLOW", qty: 1, price: 2000, cost: 0, allowance: true },
      { sku: "DISC", qty: 1, price: -500, cost: 0 },
    ])),
    "#242: custom items, allowances and a discount line do not make a quote 'with labor'"
  );
  ok(r242HasLabor(est([{ sku: "LAB-x", qty: 3, price: 0, cost: 0, labor: true, extSellOverride: 750 }])), "#242: a labor line priced by an extended-sell override counts (lineExtSellOf)");
  ok(
    r242HasLabor({ kind: "grid", lines: [{ sku: "ETC-1", qty: 1, price: 10, ext: 10 }, { sku: "labor:lighting", qty: 1, price: 800, ext: 800 }] }),
    "#242: a Grid quote's labor:<system> line (#232) is labor"
  );
  ok(
    !r242HasLabor({ kind: "grid", lines: [{ sku: "ETC-1", qty: 1, price: 10, ext: 10 }, { sku: "allow:cable", qty: 1, price: 500, ext: 500, allowance: true }] }),
    "#242: a Grid quote without a labor:<system> line is plain"
  );
  ok(
    r242HasLabor({ venue: "Proscenium", size: "M", tier: "better", width: 40, depth: 30, grid: 20, systems: ["rigging"], fromDesign: "D-1" }),
    "#242: a promoted Quick design counts as labor — its budget always prices installation"
  );
  ok(!r242HasLabor(null) && !r242HasLabor(undefined) && !r242HasLabor({}), "#242: no spec / an empty spec has no labor line");

  ok(!r242Typed(null) && !r242Typed({}) && !r242Typed({ total: 1200 }), "#242: a service subdoc with no priceOverride is auto-priced");
  ok(r242Typed({ priceOverride: 1500 }), "#242: a saved priceOverride is a typed total");
  ok(!r242Typed({ priceOverride: 821, priceOverrideSeeded: true }), "#242: a D286/D366 seeded override (old off-grid sent price) is not a hand-typed total");
  ok(!r242Typed({ priceOverride: 0 }) && !r242Typed({ priceOverride: "abc" }), "#242: a zero or junk priceOverride is not a typed total (normalizePriceOverride)");

  ok(
    r242KindOf({ quoteType: "flame_test", flameTest: { priceOverride: 900 } }) === "flame_typed" &&
      r242KindOf({ quoteType: "flame_test", flameTest: { total: 900 } }) === "flame_auto",
    "#242: flame test → flame_typed / flame_auto"
  );
  ok(
    r242KindOf({ quoteType: "repair", repair: { priceOverride: 900 } }) === "repair_typed" && r242KindOf({ quoteType: "repair", repair: null }) === "repair_auto",
    "#242: repair → repair_typed / repair_auto"
  );
  ok(
    r242KindOf({ quoteType: "inspection", inspection: { priceOverride: 900 } }) === "inspection_typed" && r242KindOf({ quoteType: "inspection" }) === "inspection_auto",
    "#242: inspection → inspection_typed / inspection_auto"
  );
  ok(r242KindOf({ quoteType: "flame_test", repair: { priceOverride: 900 } }) === "flame_auto", "#242: only the quote type's OWN subdoc is read for the typed total");
  ok(r242KindOf({ quoteType: "rental" }) === "rental" && r242KindOf({ quoteType: "consulting" }) === "consulting", "#242: rental and consulting each have one kind");
  ok(
    r242KindOf({ quoteType: "system", spec: est([{ sku: "L", qty: 1, price: 1, cost: 0 }], "labor") }) === "system_labor" &&
      r242KindOf({ quoteType: undefined, spec: null }) === "system_plain" &&
      r242KindOf({ quoteType: "service", spec: est([{ sku: "L", qty: 1, price: 1, cost: 0, labor: true }]) }) === "system_labor",
    "#242: system / missing / unknown types split on labor lines"
  );

  const s = r242Sanitize(
    { u1: { system_plain: 25000.4, rental: "none", bogus: 5, flame_auto: -1, repair_auto: "12", consulting: 99_000_000 }, u9: { rental: 100 }, u2: {}, u3: "x" },
    new Set(["u1", "u2", "u3"])
  );
  ok(
    JSON.stringify(s) === JSON.stringify({ u1: { system_plain: 25000, rental: "none", consulting: 10_000_000 } }),
    `#242: sanitizer rounds, keeps "none", caps at $10M, drops negative/string/unknown kinds, unknown users and empty rows (got ${JSON.stringify(s)})`
  );
  ok(
    JSON.stringify(r242From({ u9: { rental: 5 } })) === JSON.stringify({ u9: { rental: 5 } }) && JSON.stringify(r242From(null)) === "{}" && JSON.stringify(r242From([1])) === "{}",
    "#242: reviewLimitsFrom keeps every user id (no roster filter) and reads junk as no limits"
  );

  ok(
    JSON.stringify(r242Parse("")) === JSON.stringify({ ok: true, limit: null }) && JSON.stringify(r242Parse("  ")) === JSON.stringify({ ok: true, limit: null }),
    "#242: a blank cell is 'always needs review'"
  );
  ok(
    (["No limit", "none", "UNLIMITED", "∞"] as const).every((t) => { const p = r242Parse(t); return p.ok && p.limit === "none"; }),
    "#242: No limit / none / unlimited / ∞ parse as No limit"
  );
  const p1 = r242Parse("$25,000");
  const p2 = r242Parse("1500.60");
  const p3 = r242Parse("0");
  ok(p1.ok && p1.limit === 25000 && p2.ok && p2.limit === 1501 && p3.ok && p3.limit === 0, "#242: dollar amounts parse to whole dollars ($25,000 → 25000; $0 allowed)");
  ok(!r242Parse("-5").ok && !r242Parse("25k").ok && !r242Parse("1e5").ok && !r242Parse("20000000").ok, "#242: negatives, shorthand, exponents and anything over $10M are refused");
  ok(
    r242Format(null) === "" && r242Format(undefined) === "" && r242Format("none") === "No limit" && r242Format(25000) === "$25,000" &&
      (() => { const p = r242Parse(r242Format(25000)); return p.ok && p.limit === 25000; })(),
    "#242: formatLimitInput round-trips through parseLimitInput"
  );

  const roster = [
    { id: "u1", name: "Nic Trapani", status: "active" },
    { id: "u2", name: "Jena Tolksdorf", status: "active" },
    { id: "u3", name: "Old Timer", status: "archived" },
    { id: "u4", name: "Sam Twin", status: "active" },
    { id: "u5", name: "Sam Twin", status: "active" },
  ];
  const ctx: R242Ctx = {
    roster,
    limits: { u1: { system_plain: 25000, system_labor: 10000, rental: "none" }, u3: { system_plain: 99999 }, u4: { system_plain: 99999 } },
  };
  ok(r242Owner("Nic Trapani", roster) === "u1" && r242Owner("  nic trapani ", roster) === "u1", "#242: owner name resolves to the roster id (trimmed, case-insensitive)");
  ok(
    r242Owner("Old Timer", roster) === null && r242Owner("Sam Twin", roster) === null && r242Owner("", roster) === null && r242Owner("Nobody", roster) === null,
    "#242: archived, ambiguous, blank or unknown owners resolve to nobody"
  );
  const q = (over: Partial<R242Q> = {}): R242Q => ({ quoteType: "system", value: 25000, owner: "Nic Trapani", status: "draft", spec: null, review: null, ...over });
  ok(r242Eval(q(), ctx).fits === true, "#242: a quote AT the owner's limit fits");
  ok(r242Eval(q({ value: 24999 }), ctx).fits && !r242Eval(q({ value: 25001 }), ctx).fits, "#242: under fits, over does not");
  ok(r242Eval(q({ quoteType: "rental", value: 9_000_000 }), ctx).fits, "#242: No limit fits any value");
  ok(
    !r242Eval(q({ quoteType: "consulting", value: 1 }), ctx).fits && r242Eval(q({ quoteType: "consulting", value: 1 }), ctx).limit === null,
    "#242: a blank cell never fits — always needs review"
  );
  ok(
    !r242Eval(q({ owner: "Old Timer", value: 1 }), ctx).fits && !r242Eval(q({ owner: "Sam Twin", value: 1 }), ctx).fits && !r242Eval(q({ owner: "Nobody", value: 1 }), ctx).fits,
    "#242: an owner off the active roster (archived, ambiguous, unknown) never fits"
  );
  ok(
    r242Eval(q({ owner: "", preparedBy: "Nic Trapani" }), ctx).fits && r242Eval(q({ owner: "", preparedBy: "Nic Trapani" }), ctx).ownerId === "u1",
    "#242: a blank owner falls back to preparedBy"
  );
  const withLabor = q({ spec: est([{ sku: "L", qty: 1, price: 20000, cost: 0 }], "labor"), value: 20000 });
  ok(!r242Eval(withLabor, ctx).fits && r242Eval(withLabor, ctx).kind === "system_labor", "#242: adding labor moves a quote to the with-labor limit ($10,000 here)");
  ok(!r242Eval(q(), r242None).fits, "#242: with no limits configured (the default) nothing fits — nothing changes until limits are set");
  ok(
    r242CanAuto(q({ review: { state: "changes" } }), ctx) === null && r242CanAuto(q({ review: { state: "in_review" } }), ctx)?.kind === "system_plain",
    "#242: a reviewer's 'changes requested' blocks auto-approval (as it blocks attestation); in_review does not"
  );

  ok(
    r242Holds(q({ review: { state: "approved", method: "in_app" }, value: 9_999_999 }), ctx) &&
      r242Holds(q({ review: { state: "approved", method: "attested" }, value: 9_999_999 }), r242None) &&
      r242Holds(q({ review: { state: "approved", method: null } }), r242None),
    "#242: in-app, attested and legacy approvals hold exactly as today, whatever the limits"
  );
  const auto = { state: "approved", method: "auto_limit", auto: { kind: "system_plain" as const, limit: 25000, value: 20000 } };
  ok(r242Holds(q({ review: auto, value: 20000 }), ctx), "#242: an auto_limit approval holds while the quote still fits");
  ok(!r242Holds(q({ review: auto, value: 30000 }), ctx), "#242: stale — value raised over the limit, the auto approval no longer holds");
  ok(!r242Holds(q({ review: auto, value: 20000, spec: est([{ sku: "L", qty: 1, price: 1, cost: 0 }], "labor") }), ctx), "#242: stale — labor added (now the $10,000 with-labor limit), no longer holds");
  ok(!r242Holds(q({ review: auto, value: 20000 }), { ...ctx, limits: { u1: { system_plain: 15000 } } }), "#242: stale — limit lowered, no longer holds");
  ok(!r242Holds(q({ review: { state: "in_review" } }), ctx) && !r242Holds(q({ review: null }), ctx), "#242: no approval → does not hold");

  const within = r242Chip(q({ value: 20000 }), ctx, "Nic Trapani");
  ok(!!within && within.tone === "within" && within.text === "Within your limit — approves automatically" && !within.staleAuto, `#242 chip: owner within the limit (got ${JSON.stringify(within)})`);
  const over = r242Chip(q({ value: 30000 }), ctx, "Nic Trapani");
  ok(!!over && over.tone === "over" && over.text === "Over your $25,000 limit — needs review" && over.short === "Over $25,000 limit", `#242 chip: owner over the limit (got ${JSON.stringify(over)})`);
  ok(r242Chip(q({ value: 30000 }), ctx, "Jena Tolksdorf")?.text === "Over Nic's $25,000 limit — needs review", "#242 chip: another viewer sees the owner's first name");
  ok(
    r242Chip(q({ quoteType: "consulting" }), ctx, "Nic Trapani") === null && r242Chip(q({ owner: "Nobody" }), ctx, "Nobody") === null,
    "#242 chip: nothing when the owner has no limit for the kind (or is off the roster)"
  );
  ok(
    r242Chip(q({ status: "won" }), ctx, "Nic Trapani") === null &&
      r242Chip(q({ review: { state: "approved", method: "in_app" } }), ctx, "Nic Trapani") === null &&
      r242Chip(q({ review: { state: "changes" } }), ctx, "Nic Trapani") === null,
    "#242 chip: nothing on a won quote, an in-app approval, or a changes-requested quote"
  );
  const stale = r242Chip(q({ review: auto, value: 30000 }), ctx, "Nic Trapani");
  ok(!!stale && stale.tone === "over" && stale.staleAuto === true, "#242 chip: a stale auto approval shows as over the limit, flagged staleAuto");
  const staleBlank = r242Chip(q({ review: auto, value: 20000 }), { ...ctx, limits: {} }, "Nic Trapani");
  ok(!!staleBlank && staleBlank.staleAuto && staleBlank.short === "Needs review", "#242 chip: a stale auto approval whose limit was cleared still shows 'needs review'");

  ok(r242Phrase("system_plain") === "system estimates without labor" && r242Phrase("nope") === "this kind of quote", "#242: kind phrases for the approval sentence");
  const r242Src = readFileSync(join(process.cwd(), "src/lib/review-limits.ts"), "utf8");
  ok(
    !/from "@\/(db|lib\/stores)/.test(r242Src) && !r242Src.includes("\"use client\"") && !/from "@\/lib\/(settings|users|session)"/.test(r242Src),
    "#242: review-limits.ts stays client-safe — no store, db, settings, users or session import"
  );
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: FAIL, `Cannot find module '@/lib/review-limits'`.

- [ ] **Step 3: Implement `src/lib/review-limits.ts`**

```ts
/**
 * Quote review limits (#242) — per-person self-approval.
 *
 * Jeff (2026-09-27): a quote at or under a definable limit is approved by its
 * owner automatically. Limits are per PERSON (the quote OWNER's limit is the
 * one used) and per REVIEW KIND: system estimates split on whether any labor
 * line is on the quote (custom items, allowances and discounts don't change
 * it); flame tests / repairs / inspections split on auto-priced vs a
 * hand-typed total (#217 priceOverride); rentals and consulting have one each.
 *
 * Pure and CLIENT-SAFE. The approval gate (stores/quotes.ts
 * decideApprovalGate), the builders' chips, the quotes hub, the Settings card
 * and the banner sentence all read these rules, so they cannot disagree.
 * Imports only other pure modules — never a store, @/db, settings, users or
 * session (review-limits-server.ts is the server half).
 */
import { normalizePriceOverride } from "@/lib/service-pricing";
import { isLaborSku } from "@/lib/design/wire-labor";
import { firstName } from "@/lib/team";
import { money } from "@/lib/format";

/* ---------------- kinds ---------------- */

export const REVIEW_KINDS = [
  { key: "system_plain", group: "System estimate", sub: "No labor", phrase: "system estimates without labor" },
  { key: "system_labor", group: "System estimate", sub: "With labor", phrase: "system estimates with labor" },
  { key: "flame_auto", group: "Flame test", sub: "Auto-priced", phrase: "auto-priced flame tests" },
  { key: "flame_typed", group: "Flame test", sub: "Typed total", phrase: "flame tests with a typed total" },
  { key: "repair_auto", group: "Repair", sub: "Auto-priced", phrase: "auto-priced repairs" },
  { key: "repair_typed", group: "Repair", sub: "Typed total", phrase: "repairs with a typed total" },
  { key: "inspection_auto", group: "Inspection", sub: "Auto-priced", phrase: "auto-priced inspections" },
  { key: "inspection_typed", group: "Inspection", sub: "Typed total", phrase: "inspections with a typed total" },
  { key: "rental", group: "Rental", sub: "", phrase: "rentals" },
  { key: "consulting", group: "Consulting", sub: "", phrase: "consulting quotes" },
] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number]["key"];
export const REVIEW_KIND_KEYS: readonly ReviewKind[] = REVIEW_KINDS.map((k) => k.key);

export function isReviewKind(v: unknown): v is ReviewKind {
  return typeof v === "string" && (REVIEW_KIND_KEYS as readonly string[]).includes(v);
}

/** The Settings column label, e.g. "System estimate — no labor". */
export function reviewKindColumn(kind: ReviewKind): string {
  const k = REVIEW_KINDS.find((x) => x.key === kind);
  if (!k) return kind;
  return k.sub ? `${k.group} — ${k.sub.toLowerCase()}` : k.group;
}

/** The banner phrase, e.g. "system estimates without labor". */
export function reviewKindPhrase(kind: string): string {
  return REVIEW_KINDS.find((x) => x.key === kind)?.phrase ?? "this kind of quote";
}

/* ---------------- stored shape ---------------- */

/** Same ceiling as a typed service total (#217 PRICE_OVERRIDE_MAX). */
export const REVIEW_LIMIT_MAX = 10_000_000;
/** Whole dollars (auto-approve at or under), or "none" = No limit. A
 *  missing key is blank = always needs review. */
export type ReviewLimit = number | "none";
/** Settings `reviewLimits`: { [users.id]: { [kind]: limit } }. */
export type ReviewLimits = Record<string, Partial<Record<ReviewKind, ReviewLimit>>>;
/** Written on an `auto_limit` approval: what it was granted against. */
export type AutoApprovalSnapshot = { kind: ReviewKind; limit: ReviewLimit; value: number };

/* ---------------- structural inputs (QuoteReview / Quote satisfy them) ---------------- */

export type ReviewLike = { state: string; method?: string | null; auto?: AutoApprovalSnapshot | null };
export type ReviewableQuote = {
  quoteType?: string | null;
  value: number;
  owner?: string | null;
  preparedBy?: string | null;
  status?: string;
  spec?: unknown;
  flameTest?: unknown;
  repair?: unknown;
  inspection?: unknown;
  review?: ReviewLike | null;
};
type KindInput = Pick<ReviewableQuote, "quoteType" | "spec" | "flameTest" | "repair" | "inspection">;
export type RosterEntry = { id: string; name: string; status: string };
export type ReviewLimitContext = { limits: ReviewLimits; roster: readonly RosterEntry[] };
export const NO_REVIEW_LIMITS: ReviewLimitContext = { limits: {}, roster: [] };

/* ---------------- what's on the quote ---------------- */

type LineLike = {
  sku?: unknown;
  qty?: unknown;
  price?: unknown;
  ext?: unknown;
  extSellOverride?: unknown;
  labor?: unknown;
  option?: unknown;
};
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** estimator/pricing.ts lineExtSellOf, restated so lib never imports an app route module. */
function estimatorExtSell(it: LineLike): number {
  return typeof it.extSellOverride === "number" && Number.isFinite(it.extSellOverride)
    ? Math.max(0, it.extSellOverride)
    : num(it.qty) * num(it.price);
}

/**
 * Does this quote carry any labor line? The one rule the chip and the gate share.
 * - Estimator (`spec.sections`): the lines estimator/pricing.ts totals() sums
 *   into `lab` — an item of a kind:"labor" section or a labor:true item, not
 *   an optional (`option`) line, with a positive extended sell.
 * - The Grid (`spec.lines`, incl. D94's flat lines): #232's `labor:<system>`
 *   lines, which grid-quote.ts writes only when the amount is > 0.
 * - A promoted Quick design (`spec.fromDesign`, stores/designs.ts): no lines;
 *   its budget (tierTotals) always prices installation, so it counts.
 * Custom items, allowances and discounts never count. No spec → no labor.
 */
export function hasLaborLine(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as { sections?: unknown; lines?: unknown; fromDesign?: unknown };
  if (Array.isArray(s.sections)) {
    return s.sections.some((sec) => {
      const so = (sec && typeof sec === "object" ? sec : {}) as { kind?: unknown; items?: unknown };
      const items = Array.isArray(so.items) ? (so.items as LineLike[]) : [];
      return items.some((it) => !!it && !it.option && (so.kind === "labor" || it.labor === true) && estimatorExtSell(it) > 0);
    });
  }
  if (Array.isArray(s.lines)) {
    return (s.lines as LineLike[]).some((l) => !!l && isLaborSku(l.sku) && num(l.ext) > 0);
  }
  return typeof s.fromDesign === "string" && s.fromDesign !== "";
}

/**
 * Is this service subdoc's total hand-typed (#217 priceOverride)? A
 * `priceOverrideSeeded` override is the D286 reopen-seed of an old off-grid
 * sent price — nobody typed it (D366) — so it reads as auto-priced. Same rule
 * as renewal-outreach.ts priorHandSetPrice. A flame venue's testingOverride
 * (D365) is a cost input, not a typed total.
 */
export function hasTypedTotal(sub: unknown): boolean {
  if (!sub || typeof sub !== "object") return false;
  const d = sub as { priceOverride?: unknown; priceOverrideSeeded?: unknown };
  if (d.priceOverrideSeeded === true) return false;
  return normalizePriceOverride(d.priceOverride) != null;
}

/** The review kind of a quote. Unknown / missing / "system" types are system estimates. */
export function reviewKindOf(q: KindInput): ReviewKind {
  switch (q.quoteType) {
    case "flame_test":
      return hasTypedTotal(q.flameTest) ? "flame_typed" : "flame_auto";
    case "repair":
      return hasTypedTotal(q.repair) ? "repair_typed" : "repair_auto";
    case "inspection":
      return hasTypedTotal(q.inspection) ? "inspection_typed" : "inspection_auto";
    case "rental":
      return "rental";
    case "consulting":
      return "consulting";
    default:
      return hasLaborLine(q.spec) ? "system_labor" : "system_plain";
  }
}

/* ---------------- owner ---------------- */

/** The quote's owner name, falling back to preparedBy. */
export function quoteOwnerName(q: Pick<ReviewableQuote, "owner" | "preparedBy">): string {
  return (q.owner || "").trim() || (q.preparedBy || "").trim();
}

/** Owner name → users.id: active users only, trimmed and case-insensitive,
 *  exactly one match (two active people with one name → nobody). */
export function resolveOwnerId(name: string, roster: readonly RosterEntry[]): string | null {
  const needle = (name || "").trim().toLowerCase();
  if (!needle) return null;
  const hits = roster.filter((u) => u.status === "active" && (u.name || "").trim().toLowerCase() === needle);
  return hits.length === 1 ? hits[0].id : null;
}

/* ---------------- evaluation ---------------- */

export type ReviewLimitEval = {
  kind: ReviewKind;
  ownerName: string;
  /** null = the owner is not on the active roster (or is ambiguous). */
  ownerId: string | null;
  /** null = blank (always needs review). */
  limit: ReviewLimit | null;
  value: number;
  fits: boolean;
};
export type AutoApprovalEval = ReviewLimitEval & { ownerId: string; limit: ReviewLimit; fits: true };

function limitOf(v: unknown): ReviewLimit | null {
  if (v === "none") return "none";
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** The quote against its owner's CURRENT limit for its kind. */
export function evaluateReviewLimit(q: ReviewableQuote, ctx: ReviewLimitContext): ReviewLimitEval {
  const kind = reviewKindOf(q);
  const ownerName = quoteOwnerName(q);
  const ownerId = resolveOwnerId(ownerName, ctx.roster);
  const limit = ownerId ? limitOf(ctx.limits[ownerId]?.[kind]) : null;
  const finite = typeof q.value === "number" && Number.isFinite(q.value);
  const value = finite ? q.value : 0;
  const fits = ownerId != null && limit != null && finite && (limit === "none" || value <= limit);
  return { kind, ownerName, ownerId, limit, value, fits };
}

/** The evaluation when the gate may auto-approve now: the quote fits, and no
 *  reviewer has asked for changes (an in-app "changes" decision blocks it,
 *  exactly as it blocks attestation — canAttestApproval, #60). */
export function canAutoApprove(q: ReviewableQuote, ctx: ReviewLimitContext): AutoApprovalEval | null {
  if (q.review?.state === "changes") return null;
  const ev = evaluateReviewLimit(q, ctx);
  return ev.fits ? (ev as AutoApprovalEval) : null;
}

/** Does the quote's approval count right now? In-app, attested and legacy
 *  approvals: exactly as hasApproval. An auto_limit approval: only while the
 *  quote still fits its owner's current limit (value raised, labor added or
 *  limit lowered → no longer approved). */
export function approvalHolds(q: ReviewableQuote, ctx: ReviewLimitContext): boolean {
  const r = q.review;
  if (!r || r.state !== "approved") return false;
  if (r.method !== "auto_limit") return true;
  return evaluateReviewLimit(q, ctx).fits;
}

/* ---------------- chip ---------------- */

export type ReviewLimitChipData = {
  tone: "within" | "over";
  /** The full sentence (builders, the Estimator bar, a pill's tooltip). */
  text: string;
  /** The hub-row pill label. */
  short: string;
  /** An auto_limit approval that no longer holds — read as not approved. */
  staleAuto: boolean;
};

/**
 * What the builders and the quotes hub show. Nothing on a won/lost quote, on
 * an in-app / attested / legacy approval, on a changes-requested quote, or
 * when the owner has no limit for the kind — except a stale auto approval,
 * which always shows so nobody mistakes it for an approval.
 */
export function reviewLimitChip(q: ReviewableQuote, ctx: ReviewLimitContext, viewerName: string): ReviewLimitChipData | null {
  if (q.status === "won" || q.status === "lost") return null;
  const r = q.review;
  const approved = r?.state === "approved";
  if (approved && r?.method !== "auto_limit") return null;
  if (r?.state === "changes") return null;
  const ev = evaluateReviewLimit(q, ctx);
  const staleAuto = approved && !ev.fits;
  if (ev.ownerId == null || ev.limit == null) {
    return staleAuto
      ? { tone: "over", text: "No review limit covers this quote any more — needs review", short: "Needs review", staleAuto: true }
      : null;
  }
  const mine = ev.ownerName.trim().toLowerCase() === (viewerName || "").trim().toLowerCase();
  const whose = mine ? "your" : `${firstName(ev.ownerName)}'s`;
  if (ev.fits) return { tone: "within", text: `Within ${whose} limit — approves automatically`, short: "Within limit", staleAuto: false };
  const cap = ev.limit === "none" ? "" : `${money(ev.limit)} `;
  return { tone: "over", text: `Over ${whose} ${cap}limit — needs review`, short: `Over ${cap}limit`, staleAuto };
}

/* ---------------- storage + the Settings cell text ---------------- */

/** Server-side clean-up of a stored or submitted map: whole dollars, capped at
 *  REVIEW_LIMIT_MAX, "none" kept, negatives / non-numbers / unknown kinds /
 *  empty rows dropped; with `knownUserIds`, unknown people dropped too. */
export function sanitizeReviewLimits(raw: unknown, knownUserIds: ReadonlySet<string> | null): ReviewLimits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ReviewLimits = {};
  for (const [uid, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!uid || uid.length > 64) continue;
    if (knownUserIds && !knownUserIds.has(uid)) continue;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const src = row as Record<string, unknown>;
    const clean: Partial<Record<ReviewKind, ReviewLimit>> = {};
    for (const k of REVIEW_KIND_KEYS) {
      const v = src[k];
      if (v === "none") clean[k] = "none";
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[k] = Math.min(Math.round(v), REVIEW_LIMIT_MAX);
    }
    if (Object.keys(clean).length) out[uid] = clean;
  }
  return out;
}

/** The stored blob as read (no roster filter — an archived person's row is kept). */
export function reviewLimitsFrom(stored: unknown): ReviewLimits {
  return sanitizeReviewLimits(stored, null);
}

const NO_LIMIT_RE = /^(no limit|none|unlimited|∞)$/i;

/** One Settings cell: "" → blank, "No limit" (none/unlimited/∞) → "none",
 *  "$25,000" / "1500.60" → whole dollars. Anything else is refused. */
export function parseLimitInput(text: string): { ok: true; limit: ReviewLimit | null } | { ok: false; error: string } {
  const t = (text || "").trim();
  if (!t) return { ok: true, limit: null };
  if (NO_LIMIT_RE.test(t)) return { ok: true, limit: "none" };
  const digits = t.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) {
    return { ok: false, error: `"${t}" isn't a dollar amount — type a number like 25,000, No limit, or leave it blank.` };
  }
  const n = Math.round(Number(digits));
  if (n > REVIEW_LIMIT_MAX) return { ok: false, error: `Limits top out at ${money(REVIEW_LIMIT_MAX)}.` };
  return { ok: true, limit: n };
}

export function formatLimitInput(limit: ReviewLimit | null | undefined): string {
  if (limit == null) return "";
  if (limit === "none") return "No limit";
  return money(limit);
}
```

- [ ] **Step 4: Run the gates and confirm they pass**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npm run test:specs > "$TMPDIR/r242-t1.log" 2>&1; grep -c '^PASS ' "$TMPDIR/r242-t1.log"; grep -c '^FAIL ' "$TMPDIR/r242-t1.log"; tail -1 "$TMPDIR/r242-t1.log"`
Expected: `6427`, `0`, `ALL PASSED`.
Run: `npx eslint src/lib/review-limits.ts scripts/test-review-and-spec.ts` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/review-limits.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): pure review-limit rules — kinds, labor/typed-total split, owner limit, chip (#242)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Settings storage + Admin "Review limits" card

**Files:**
- Modify: `src/lib/review-limits.ts` (add `applyLimitCells`)
- Modify: `src/lib/settings.ts` (`AppSettingsData`, after the `venueTypes?:` field ~:131)
- Modify: `src/app/(app)/settings/actions.ts` (imports; new action after `saveDocumentCategoriesAction` ~:850)
- Create: `src/app/(app)/settings/review-limits-card.tsx`
- Modify: `src/app/(app)/settings/page.tsx` (import; prop after `venueTypes=` ~:198)
- Modify: `src/app/(app)/settings/settings-client.tsx` (imports ~:51, props :170–224, render in the admin fragment at :2171)
- Test: `scripts/test-review-and-spec.ts` (append at END)

**Interfaces:**
- Consumes (Task 1): `REVIEW_KINDS`, `REVIEW_KIND_KEYS`, `reviewKindColumn`, `parseLimitInput`, `formatLimitInput`, `sanitizeReviewLimits`, `reviewLimitsFrom`, `type ReviewKind`, `type ReviewLimit`, `type ReviewLimits`.
- Produces:
  - `applyLimitCells(stored: ReviewLimits, cells: Record<string, Partial<Record<ReviewKind, string>>>, nameOf: (userId: string) => string): { ok: true; limits: ReviewLimits } | { ok: false; error: string }` in `@/lib/review-limits`
  - `AppSettingsData.reviewLimits?: ReviewLimits`
  - `saveReviewLimitsAction(input: ReviewLimits): Promise<{ ok: true } | { ok: false; error: string }>` in `src/app/(app)/settings/actions.ts`
  - `ReviewLimitsCard({ people: {id,name}[], limits: ReviewLimits })`
- Reuses harness aliases from Task 1: none needed. New aliases: `r242Apply`.

- [ ] **Step 1: Write the failing tests** by appending at the END of `scripts/test-review-and-spec.ts`:

```ts
/* --- #242 T2: Settings → Admin → Review limits (storage, action, card) --- */
import { applyLimitCells as r242Apply } from "@/lib/review-limits";
{
  const stored = { u1: { system_plain: 25000 }, u9: { rental: "none" as const } };
  const res = r242Apply(stored, { u1: { system_plain: "$30,000", rental: "No limit" }, u2: { consulting: "" } }, (id) => id);
  ok(
    res.ok && JSON.stringify(res.limits) === JSON.stringify({ u1: { system_plain: 30000, rental: "none" }, u9: { rental: "none" } }),
    `#242 card: edited rows replace, hidden rows (archived people) are kept, an all-blank row is dropped (got ${JSON.stringify(res)})`
  );
  const cleared = r242Apply(stored, { u1: { system_plain: "" } }, (id) => id);
  ok(cleared.ok && !("u1" in cleared.limits), "#242 card: clearing every cell of a row removes that person's limits (always needs review)");
  const bad = r242Apply(stored, { u1: { flame_typed: "25k" } }, () => "Nic Trapani");
  ok(!bad.ok && bad.error.startsWith("Nic Trapani · Flame test — typed total: "), `#242 card: a bad cell is refused naming the person and column (got ${JSON.stringify(bad)})`);

  const act = readFileSync(join(process.cwd(), "src/app/(app)/settings/actions.ts"), "utf8");
  const at = act.indexOf("export async function saveReviewLimitsAction");
  const body = act.slice(at, at + 1500);
  ok(
    at > 0 && body.includes('await requirePerm("manage_users")') && body.includes("sanitizeReviewLimits(") && body.includes("allUsers()") && body.includes("setSettings({ reviewLimits"),
    "#242: saveReviewLimitsAction is manage_users-gated, sanitizes against the roster, and writes the settings blob"
  );
  const st = readFileSync(join(process.cwd(), "src/lib/settings.ts"), "utf8");
  ok(st.includes('reviewLimits?: import("@/lib/review-limits").ReviewLimits;'), "#242: AppSettingsData declares reviewLimits");
  const pg = readFileSync(join(process.cwd(), "src/app/(app)/settings/page.tsx"), "utf8");
  const sc = readFileSync(join(process.cwd(), "src/app/(app)/settings/settings-client.tsx"), "utf8");
  ok(
    pg.includes("reviewLimits={reviewLimitsFrom(settings.reviewLimits)}") && sc.includes("<ReviewLimitsCard") && sc.includes("reviewLimits: ReviewLimits;"),
    "#242: Settings → Admin renders the Review limits card from the stored blob"
  );
  const card = readFileSync(join(process.cwd(), "src/app/(app)/settings/review-limits-card.tsx"), "utf8");
  ok(
    card.startsWith('"use client";') && card.includes("saveReviewLimitsAction(") && card.includes("applyLimitCells(") &&
      !/from "@\/(db|lib\/stores|lib\/settings|lib\/users)"/.test(card),
    "#242: the card is a client component over the pure rules + the server action — no store/db/settings import"
  );
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: FAIL, `Module '"@/lib/review-limits"' has no exported member 'applyLimitCells'`.

- [ ] **Step 3: Add `applyLimitCells`** at the end of `src/lib/review-limits.ts`:

```ts
/**
 * The Settings card's save: `cells` holds the rows the card showed (one per
 * active person, every kind as typed text). A shown row REPLACES that
 * person's stored row (all blank → removed); rows the card didn't show
 * (archived people) are kept as stored. A bad cell refuses the whole save,
 * naming the person and the column.
 */
export function applyLimitCells(
  stored: ReviewLimits,
  cells: Record<string, Partial<Record<ReviewKind, string>>>,
  nameOf: (userId: string) => string
): { ok: true; limits: ReviewLimits } | { ok: false; error: string } {
  const next: ReviewLimits = { ...stored };
  for (const [uid, row] of Object.entries(cells)) {
    const out: Partial<Record<ReviewKind, ReviewLimit>> = {};
    for (const k of REVIEW_KIND_KEYS) {
      const p = parseLimitInput(row[k] ?? "");
      if (!p.ok) return { ok: false, error: `${nameOf(uid)} · ${reviewKindColumn(k)}: ${p.error}` };
      if (p.limit !== null) out[k] = p.limit;
    }
    if (Object.keys(out).length) next[uid] = out;
    else delete next[uid];
  }
  return { ok: true, limits: next };
}
```

- [ ] **Step 4: Declare the settings field.** In `src/lib/settings.ts`, directly after the `venueTypes?: …VenueType[];` field, add:

```ts
  /** #242 — Settings → Admin → Review limits: per person (users.id) per
   *  review kind, a whole-dollar self-approval ceiling or "none" (No limit);
   *  a missing key = blank = always needs review. FULL REPLACEMENT on save,
   *  read through reviewLimitsFrom (lib/review-limits); absent = {}. */
  reviewLimits?: import("@/lib/review-limits").ReviewLimits;
```

- [ ] **Step 5: Add the server action.** In `src/app/(app)/settings/actions.ts`, add this import after the `venue-types` import line (~:36):

```ts
import { sanitizeReviewLimits, type ReviewLimits } from "@/lib/review-limits";
```

Append at the end of the file, after `saveDocumentCategoriesAction`:

```ts
/* ---- Review limits (#242) ---- */

/** Whole-map save of Settings → Admin → Review limits. Sanitized against the
 *  roster (unknown people and kinds dropped, whole dollars, capped at
 *  $10,000,000); the card has already refused malformed cells. */
export async function saveReviewLimitsAction(
  input: ReviewLimits
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const roster = await allUsers();
  const limits = sanitizeReviewLimits(input, new Set(roster.map((u) => u.id)));
  await setSettings({ reviewLimits: limits });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 6: Create `src/app/(app)/settings/review-limits-card.tsx`**

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  REVIEW_KINDS,
  applyLimitCells,
  formatLimitInput,
  reviewKindColumn,
  type ReviewKind,
  type ReviewLimits,
} from "@/lib/review-limits";
import { saveReviewLimitsAction } from "./actions";

/**
 * Settings → Admin → Review limits (#242). One row per active teammate, one
 * column per review kind. A cell is blank (always needs review — the
 * default), a dollar amount (the owner's own quote approves itself at or
 * under it), or No limit. The DocumentCategoriesCard idiom: seeded from the
 * server-resolved map, whole-map save, the parent re-keys the card on the
 * saved map so a save remounts it.
 */

type Person = { id: string; name: string };
type Cells = Record<string, Partial<Record<ReviewKind, string>>>;

const thS: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#5b616e",
  textAlign: "left",
  padding: "9px 8px",
  borderBottom: "1px solid #ececf0",
  verticalAlign: "bottom",
  whiteSpace: "nowrap",
};
const tdS: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f5f6f8" };
const cellS: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "6px 8px",
  background: "#fff",
  outline: "none",
  width: 96,
};

function cellsFrom(people: Person[], limits: ReviewLimits): Cells {
  const out: Cells = {};
  for (const p of people) {
    const row: Partial<Record<ReviewKind, string>> = {};
    for (const k of REVIEW_KINDS) row[k.key] = formatLimitInput(limits[p.id]?.[k.key]);
    out[p.id] = row;
  }
  return out;
}

export function ReviewLimitsCard({ people, limits }: { people: Person[]; limits: ReviewLimits }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Cells>(() => cellsFrom(people, limits));
  const [cells, setCells] = useState<Cells>(() => cellsFrom(people, limits));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(cells) !== JSON.stringify(saved);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || id;

  const edit = (uid: string, kind: ReviewKind, v: string) => {
    setJustSaved(false);
    setError(null);
    setCells((c) => ({ ...c, [uid]: { ...c[uid], [kind]: v } }));
  };

  const onSave = () => {
    const res = applyLimitCells(limits, cells, nameOf);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await saveReviewLimitsAction(res.limits);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(cells);
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Review limits</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          A quote approves itself when its owner has a limit for its kind and the total is at or under it. Leave a
          cell blank to always require review, type a dollar amount, or type No limit. Over the limit, any approver
          reviews it as today.
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 1180, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...thS, paddingLeft: 18 }}>Person</th>
              {REVIEW_KINDS.map((k) => (
                <th key={k.key} style={thS}>
                  {k.group}
                  {k.sub && <span style={{ display: "block", fontWeight: 500, color: "#9aa0ab" }}>{k.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td style={{ ...tdS, paddingLeft: 18, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{p.name}</td>
                {REVIEW_KINDS.map((k) => (
                  <td key={k.key} style={tdS}>
                    <input
                      style={cellS}
                      value={cells[p.id]?.[k.key] ?? ""}
                      list="review-limit-presets"
                      placeholder="Review"
                      aria-label={`${p.name} — ${reviewKindColumn(k.key)}`}
                      onChange={(e) => edit(p.id, k.key, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="review-limit-presets">
        <option value="No limit" />
      </datalist>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save limits"}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "#b03a2e" }}>
            {error}
          </span>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire the page and client.**

`src/app/(app)/settings/page.tsx`: add `import { reviewLimitsFrom } from "@/lib/review-limits";` beside the `venueTypesFrom` import, and add this prop after `venueTypes={venueTypesFrom(settings.venueTypes)}`:

```tsx
          reviewLimits={reviewLimitsFrom(settings.reviewLimits)}
```

`src/app/(app)/settings/settings-client.tsx`:
- Imports, after `import type { DocumentCategory } from "@/lib/document-categories";`:

```tsx
import { ReviewLimitsCard } from "./review-limits-card";
import type { ReviewLimits } from "@/lib/review-limits";
```

- Destructure `reviewLimits,` after `documentCategories,` in the parameter list. In the props type, after the `documentCategories: DocumentCategory[];` line, add:

```tsx
  /** #242 — Settings → Admin → Review limits (resolved; archived people's rows kept). */
  reviewLimits: ReviewLimits;
```

- In the second `{section === "admin" && (<>` fragment (the one that opens with the `Admin` `<section className="pk-card" …>` at ~:2173), insert as its **first** child:

```tsx
          <div style={{ marginTop: 20 }}>
            <ReviewLimitsCard
              key={JSON.stringify(reviewLimits)}
              people={users.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name }))}
              limits={reviewLimits}
            />
          </div>
```

- [ ] **Step 8: Run the gates and confirm they pass**

`npx tsc --noEmit` → 0 errors.
`npm run test:specs > "$TMPDIR/r242-t2.log" 2>&1; grep -c '^PASS ' "$TMPDIR/r242-t2.log"; grep -c '^FAIL ' "$TMPDIR/r242-t2.log"` → `6434`, `0`.
`npx eslint src/lib/review-limits.ts src/lib/settings.ts "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/review-limits-card.tsx" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" scripts/test-review-and-spec.ts` → 0 errors.
`npx next build` → exits 0. Check nothing is running first (Global Constraints).

- [ ] **Step 9: Commit**

```bash
git add src/lib/review-limits.ts src/lib/settings.ts "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/review-limits-card.tsx" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): Settings → Admin review-limits table, manage_users-gated (#242)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The approval gate auto-approves within the owner's limit (and stale auto approvals stop counting)

**Files:**
- Create: `src/lib/review-limits-server.ts`
- Modify: `src/lib/stores/quotes.ts`: imports (top), `ApprovalMethod` :120–134, `QuoteReview` :136–146, new pure fns after `resolveStatusGate` (~:906), `setStatus` gate :1050 + patch :1055, `approve` :1259, `attestApproval` :1292, `requestChanges` :1311
- Modify: `src/app/(app)/estimator/actions.ts`: import block :6–29, `setStatusAction` pre-check :735–737, `sendToCustomerAction` pre-check :891–892
- Test: `scripts/test-review-and-spec.ts` (append at END, plus one `.then` line)

**Interfaces:**
- Consumes (Task 1): `approvalHolds`, `canAutoApprove`, `reviewLimitChip`, `reviewLimitsFrom`, `NO_REVIEW_LIMITS`, `type AutoApprovalSnapshot`, `type AutoApprovalEval`, `type ReviewLimitContext`, `type ReviewableQuote`, `type ReviewLimitChipData`. (Task 2): `AppSettingsData.reviewLimits`.
- Produces:
  - `@/lib/review-limits-server`: `loadReviewLimitContext(): Promise<ReviewLimitContext>`, `reviewLimitChipFor(q: ReviewableQuote, viewerName: string): Promise<ReviewLimitChipData | null>`
  - `@/lib/stores/quotes`: `ApprovalMethod` gains `"auto_limit"`; `QuoteReview.auto?: AutoApprovalSnapshot | null`; `type GateQuote`; `type ApprovalGateDecision = { ok: true; stamp: QuoteReview | null } | { ok: false; error: string }`; `autoApprovedReview(ev: AutoApprovalEval, now: number): QuoteReview`; `decideApprovalGate(status: QuoteStatus, q: GateQuote, ctx: ReviewLimitContext, opts?: SetStatusOpts, now?: number): ApprovalGateDecision`; `checkApprovalGate(q: Quote | null, status: "sent" | "won"): Promise<ApprovalGateResult>`
- `hasApproval`, `requireApprovalToAdvance` and `resolveStatusGate` keep their signatures and behaviour. Existing #60 assertions depend on them.

- [ ] **Step 1: Write the failing tests.** Append at the END of `scripts/test-review-and-spec.ts`:

```ts
/* --- #242 T3: the approval gate — auto-approval within the owner's limit ---
 * decideApprovalGate is the one decision setStatus and the estimator
 * pre-checks make; the async block exercises the real store. */
import {
  decideApprovalGate as r242Decide, checkApprovalGate as r242Check, create as r242Create, get as r242Get,
  setStatus as r242SetStatus, approve as r242Approve, update as r242Update, isApprovalGateRefusal as r242IsRefusal,
  type QuoteReview as R242Review, type Quote as R242Quote,
} from "@/lib/stores/quotes";
import { addUser as r242AddUser, getUserByEmail as r242UserByEmail } from "@/lib/users";
import { getSettingsPatch as r242Patch, setSettings as r242SetSettings } from "@/lib/settings";
import { loadReviewLimitContext as r242LoadCtx } from "@/lib/review-limits-server";
import { fixtureId as r242Fx, registerFixture as r242Reg } from "./test-fixtures";
{
  const ctx = { roster: [{ id: "u1", name: "Nic Trapani", status: "active" }], limits: { u1: { system_plain: 25000 } } };
  const base = { quoteType: "system", value: 20000, owner: "Nic Trapani", preparedBy: "", spec: null, flameTest: null, repair: null, inspection: null };
  const rv = (o: Partial<R242Review> = {}): R242Review => ({
    state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "", method: null, ...o,
  });
  const sent = r242Decide("sent", { ...base, review: rv() }, ctx, {}, 1000);
  ok(
    sent.ok && !!sent.stamp && sent.stamp.state === "approved" && sent.stamp.method === "auto_limit" && sent.stamp.decidedBy === "Nic Trapani" &&
      sent.stamp.decidedAt === 1000 && JSON.stringify(sent.stamp.auto) === JSON.stringify({ kind: "system_plain", limit: 25000, value: 20000 }),
    "#242 gate: → sent within the owner's limit auto-approves and stamps method/decidedBy/decidedAt/snapshot"
  );
  const won = r242Decide("won", { ...base, review: rv({ state: "in_review" }) }, ctx, {}, 1000);
  ok(won.ok && won.stamp?.method === "auto_limit", "#242 gate: → won auto-approves too (an in_review quote included)");
  const overS = r242Decide("sent", { ...base, value: 30000, review: rv() }, ctx);
  ok(!overS.ok && overS.error === "This quote needs an approval on record before it can be sent to the customer.", "#242 gate: over the limit → today's send refusal, verbatim");
  const overW = r242Decide("won", { ...base, value: 30000, review: rv() }, ctx);
  ok(!overW.ok && overW.error === "This quote needs an approval on record before it can be marked Won.", "#242 gate: over the limit → today's won refusal, verbatim");
  ok(!r242Decide("sent", { ...base, review: rv({ state: "changes" }) }, ctx).ok, "#242 gate: 'changes requested' is never auto-approved past");
  const inApp = r242Decide("sent", { ...base, value: 9_000_000, review: rv({ state: "approved", method: "in_app" }) }, ctx);
  const att = r242Decide("won", { ...base, value: 9_000_000, review: rv({ state: "approved", method: "attested", note: "Teams" }) }, { limits: {}, roster: [] });
  ok(inApp.ok && inApp.stamp === null && att.ok && att.stamp === null, "#242 gate: in-app and attested approvals pass unchanged, no restamp, whatever the limits");
  const autoRev = rv({ state: "approved", method: "auto_limit", decidedBy: "Nic Trapani", auto: { kind: "system_plain", limit: 25000, value: 20000 } });
  const holds = r242Decide("won", { ...base, review: autoRev }, ctx);
  ok(holds.ok && holds.stamp === null, "#242 gate: a still-fitting auto approval passes without a restamp");
  ok(!r242Decide("won", { ...base, value: 30000, review: autoRev }, ctx).ok, "#242 gate: stale auto approval (value raised) is refused");
  ok(
    !r242Decide("won", { ...base, spec: { sections: [{ kind: "labor", items: [{ sku: "L", qty: 1, price: 100, cost: 0 }] }] }, review: autoRev }, ctx).ok,
    "#242 gate: stale auto approval (labor added, no with-labor limit) is refused"
  );
  ok(!r242Decide("won", { ...base, review: autoRev }, { ...ctx, limits: { u1: { system_plain: 10000 } } }).ok, "#242 gate: stale auto approval (limit lowered) is refused");
  ok(
    r242Decide("won", { ...base, value: 30000, review: rv() }, ctx, { bypassApprovalGate: "engine-owned-flow" }).ok &&
      r242Decide("sent", { ...base, value: 30000, review: rv() }, ctx, { bypassApprovalGate: "historical-import" }).ok,
    "#242 gate: engine-owned and historical-import bypasses unchanged"
  );
  const bypassStamp = r242Decide("won", { ...base, review: rv() }, ctx, { bypassApprovalGate: "engine-owned-flow" });
  ok(bypassStamp.ok && bypassStamp.stamp === null, "#242 gate: a bypassed transition never stamps an auto approval");
  ok(r242Decide("draft", { ...base, value: 30000, review: rv() }, ctx).ok && r242Decide("lost", { ...base, review: rv() }, ctx).ok, "#242 gate: draft/lost stay open");
  ok(r242Decide("sent", { ...base, review: rv() }, { limits: {}, roster: [] }).ok === false, "#242 gate: no limits configured → today's behaviour (needs review)");

  const qs = readFileSync(join(process.cwd(), "src/lib/stores/quotes.ts"), "utf8");
  const setStatusBody = qs.slice(qs.indexOf("export async function setStatus("), qs.indexOf("export async function setQuoteStage("));
  ok(
    setStatusBody.includes("decideApprovalGate(status, q, ") && setStatusBody.includes("doc.review = autoStamp") && !setStatusBody.includes("resolveStatusGate(status, q.review"),
    "#242: setStatus consults decideApprovalGate and writes the stamp inside the status patch"
  );
  const ea = readFileSync(join(process.cwd(), "src/app/(app)/estimator/actions.ts"), "utf8");
  ok(
    (ea.match(/checkApprovalGate\(cur/g) || []).length === 2 && !ea.includes("requireApprovalToAdvance(cur"),
    "#242: setStatusAction and sendToCustomerAction pre-check with checkApprovalGate (limits applied), not the bare review predicate"
  );
  const approveBody = qs.slice(qs.indexOf("export async function approve("), qs.indexOf("export async function resetToSeed("));
  ok((approveBody.match(/review\.auto = null/g) || []).length === 3, "#242: approve, attestApproval and requestChanges each clear a previous auto snapshot");
}

async function reviewLimits242AsyncChecks(): Promise<void> {
  const before = await r242Patch();
  const email = "r242.owner@example.test";
  const owner = (await r242UserByEmail(email)) ?? (await r242AddUser({ name: "Rae Twofortytwo", email }));
  const mk = async (slug: string, over: Partial<R242Quote> = {}) => {
    const id = r242Fx(242, slug);
    r242Reg("quotes", id);
    return r242Create({ id, name: "#242 " + slug, customer: "Spec fixture", owner: owner.name, value: 20000, ...over });
  };
  try {
    await r242SetSettings({ reviewLimits: { [owner.id]: { system_plain: 25000 } } });
    const ctx = await r242LoadCtx();
    ok(ctx.roster.some((u) => u.id === owner.id) && ctx.limits[owner.id]?.system_plain === 25000, "#242 store: loadReviewLimitContext reads the settings blob and the roster");

    const a = await mk("within");
    ok((await r242Check(a, "sent")).ok, "#242 store: checkApprovalGate passes a quote within the owner's limit");
    const sentA = await r242SetStatus(a.id, "sent", "Someone Else");
    const reA = await r242Get(a.id);
    ok(
      sentA?.status === "sent" && reA?.review.state === "approved" && reA.review.method === "auto_limit" && reA.review.decidedBy === owner.name &&
        typeof reA.review.decidedAt === "number" && JSON.stringify(reA.review.auto) === JSON.stringify({ kind: "system_plain", limit: 25000, value: 20000 }),
      "#242 store: setStatus(sent) within the limit auto-approves in the same write — stamped to the OWNER, not the actor"
    );

    const b = await mk("over", { value: 30000 });
    let refusedB = false;
    try {
      await r242SetStatus(b.id, "sent", "Test");
    } catch (e) {
      refusedB = r242IsRefusal(e) && (e as Error).message === "This quote needs an approval on record before it can be sent to the customer.";
    }
    const reB = await r242Get(b.id);
    ok(refusedB && reB?.status === "draft" && reB.review.state === "none", "#242 store: over the limit is refused with today's message and nothing is stamped");
    ok(!(await r242Check(b, "sent")).ok, "#242 store: checkApprovalGate refuses the over-limit quote");

    const c = await mk("stale");
    await r242SetStatus(c.id, "sent", "Test");
    await r242Update(c.id, { value: 40000 });
    let refusedC = false;
    try {
      await r242SetStatus(c.id, "won", "Test");
    } catch (e) {
      refusedC = r242IsRefusal(e);
    }
    ok(refusedC && (await r242Get(c.id))?.status === "sent", "#242 store: a stale auto approval (value raised) no longer lets the quote be marked Won");

    const d = await mk("lowered");
    await r242SetStatus(d.id, "sent", "Test");
    await r242SetSettings({ reviewLimits: { [owner.id]: { system_plain: 10000 } } });
    let refusedD = false;
    try {
      await r242SetStatus(d.id, "won", "Test");
    } catch (e) {
      refusedD = r242IsRefusal(e);
    }
    ok(refusedD, "#242 store: lowering the owner's limit un-approves an auto approval that no longer fits");

    const e2 = await mk("inapp", { value: 90000 });
    await r242Approve(e2.id, { by: "Jeff Chesebro" });
    await r242SetStatus(e2.id, "sent", "Test");
    const reE = await r242Get(e2.id);
    ok(reE?.status === "sent" && reE.review.method === "in_app" && reE.review.auto == null, "#242 store: an in-app approval sends exactly as today — no auto stamp");

    await r242Approve(c.id, { by: "Jeff Chesebro" });
    const reC = await r242Get(c.id);
    ok(reC?.review.method === "in_app" && reC.review.auto === null, "#242 store: approving over a stale auto approval clears its snapshot");

    const f = await mk("bypass", { value: 90000 });
    await r242SetStatus(f.id, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const reF = await r242Get(f.id);
    ok(reF?.status === "sent" && reF.review.state === "none", "#242 store: the engine-owned bypass is unchanged and never stamps an approval");
  } finally {
    await r242SetSettings({ reviewLimits: before.reviewLimits ?? {} });
  }
}
```

Then add this line immediately above `// Before the report and before the \`.catch\`, so a thrown suite is torn` (directly after `.then(() => daylite241AsyncChecks())`):

```ts
  .then(() => reviewLimits242AsyncChecks())
```

(Test won transitions are refusal-only on purpose. A successful system `won` would spawn a project and an "Install sold" assignment. The pure block covers the successful `won`.)

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: FAIL, missing exports `decideApprovalGate` / `checkApprovalGate` and missing module `@/lib/review-limits-server`.

- [ ] **Step 3: Create `src/lib/review-limits-server.ts`**

```ts
/**
 * #242 — the server half of review limits: reads Settings → Review limits and
 * the roster. Never import from a "use client" file (settings and users reach
 * the database); client components receive a ReviewLimitChipData prop.
 */
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import {
  reviewLimitChip,
  reviewLimitsFrom,
  type ReviewableQuote,
  type ReviewLimitChipData,
  type ReviewLimitContext,
} from "@/lib/review-limits";

/** Limits + roster. getSettings() reads `{}` on a DB error, which fails
 *  closed (no limits → needs review). Sequential on purpose: inside
 *  setStatus's transaction both reads share one handle. */
export async function loadReviewLimitContext(): Promise<ReviewLimitContext> {
  const settings = await getSettings();
  const users = await allUsers();
  return {
    limits: reviewLimitsFrom(settings.reviewLimits),
    roster: users.map((u) => ({ id: u.id, name: u.name, status: u.status })),
  };
}

/** The chip for one saved quote, evaluated against the owner's live limit. */
export async function reviewLimitChipFor(q: ReviewableQuote, viewerName: string): Promise<ReviewLimitChipData | null> {
  return reviewLimitChip(q, await loadReviewLimitContext(), viewerName);
}
```

- [ ] **Step 4: Extend the review model in `src/lib/stores/quotes.ts`**

Add after the `@/lib/pipelines` import block (~:29):

```ts
import {
  approvalHolds,
  canAutoApprove,
  NO_REVIEW_LIMITS,
  type AutoApprovalEval,
  type AutoApprovalSnapshot,
  type ReviewLimitContext,
} from "@/lib/review-limits";
import { loadReviewLimitContext } from "@/lib/review-limits-server";
```

In the `ApprovalMethod` doc comment, add a bullet before ` * Absent/null on legacy docs…`, and replace the type:

```ts
 * - "auto_limit" — #242: the quote fit its OWNER's review limit (Settings →
 *   Admin → Review limits) when it moved to sent/won, so the gate approved
 *   it itself. It counts only while the quote still fits — approvalHolds().
```

```ts
export type ApprovalMethod = "in_app" | "attested" | "auto_limit";
```

In `QuoteReview`, after `method?: ApprovalMethod | null;`:

```ts
  /** #242: what an `auto_limit` approval was granted against — kind, the
   *  owner's limit and the quote value at that moment. Null/absent on every
   *  other approval (approve / attest / request changes clear it). */
  auto?: AutoApprovalSnapshot | null;
```

- [ ] **Step 5: Add the pure decision.** Insert directly after the `resolveStatusGate` function (before the `APPROVAL_GATE_REFUSAL` comment):

```ts
/** The quote fields the #242 approval decision reads. */
export type GateQuote = Pick<
  Quote,
  "quoteType" | "value" | "owner" | "preparedBy" | "spec" | "flameTest" | "repair" | "inspection"
> & { review?: QuoteReview | null };

export type ApprovalGateDecision =
  | { ok: true; stamp: QuoteReview | null }
  | { ok: false; error: string };

/** #242: the review record an auto-approval writes. Pure. submittedBy/At are
 *  set too, so it lists under the owner's Reviews → "Submitted by me". */
export function autoApprovedReview(ev: AutoApprovalEval, now: number): QuoteReview {
  return {
    state: "approved",
    reviewer: null,
    submittedBy: ev.ownerName || null,
    submittedAt: now,
    decidedBy: ev.ownerName || null,
    decidedAt: now,
    note: "",
    method: "auto_limit",
    auto: { kind: ev.kind, limit: ev.limit, value: ev.value },
  };
}

/**
 * #242 — the ONE approval decision every sent/won transition makes (setStatus,
 * and the estimator's two typed pre-checks through checkApprovalGate). Pure:
 * the caller loads the limits.
 * - bypassed or ungated statuses → open (resolveStatusGate, unchanged);
 * - an approval that still holds (in-app, attested, legacy, or an auto
 *   approval the quote still fits) → open, nothing re-stamped;
 * - else the owner's review limit: fits → open, with the auto-approval
 *   record to write in the same patch; over / blank / owner off the roster /
 *   changes requested → today's refusal sentence, verbatim.
 */
export function decideApprovalGate(
  status: QuoteStatus,
  q: GateQuote,
  ctx: ReviewLimitContext,
  opts: SetStatusOpts = {},
  now: number = Date.now()
): ApprovalGateDecision {
  const open = resolveStatusGate(status, null, opts);
  if (open.ok) return { ok: true, stamp: null };
  if (approvalHolds(q, ctx)) return { ok: true, stamp: null };
  const ev = canAutoApprove(q, ctx);
  if (ev) return { ok: true, stamp: autoApprovedReview(ev, now) };
  return open;
}

/**
 * #242 — the typed pre-check for a server action that wants the refusal as
 * a value before calling setStatus (estimator setStatusAction /
 * sendToCustomerAction). Same decision setStatus makes; writes nothing —
 * setStatus stamps the approval in its own write.
 */
export async function checkApprovalGate(q: Quote | null, status: "sent" | "won"): Promise<ApprovalGateResult> {
  if (!q) return requireApprovalToAdvance(null, status === "won" ? "won" : "send");
  const d = decideApprovalGate(status, q, await loadReviewLimitContext());
  return d.ok ? { ok: true } : d;
}
```

- [ ] **Step 6: Make `setStatus` use it.** Replace the gate lines at ~:1050–1054:

```ts
  const gate = resolveStatusGate(status, q.review, opts);
  // #174: a TYPED refusal. The gate is the only throw here whose message is
  // meant for the user; everything below this line that throws is a defect,
  // and callers tell the two apart with `statusFailureMessage`.
  if (!gate.ok) throw new ApprovalGateRefused(status === "won" ? "won" : "send", gate.error);
```

with:

```ts
  // #242: the owner's review limits are read only when this transition is
  // gated at all (sent/won without a bypass).
  const gated = !resolveStatusGate(status, null, opts).ok;
  const limits = gated ? await loadReviewLimitContext() : NO_REVIEW_LIMITS;
  const gate = decideApprovalGate(status, q, limits, opts);
  // #174: a TYPED refusal. The gate is the only throw here whose message is
  // meant for the user; everything below this line that throws is a defect,
  // and callers tell the two apart with `statusFailureMessage`.
  if (!gate.ok) throw new ApprovalGateRefused(status === "won" ? "won" : "send", gate.error);
  // #242: an auto-approval lands in the SAME write as the status change.
  const autoStamp = gate.stamp;
```

In the `patchQuote(id, (doc) => { … })` callback immediately below, add as its first statement after `const t = Date.now();`:

```ts
    if (autoStamp) doc.review = autoStamp;
```

- [ ] **Step 7: Clear the snapshot on human decisions.** In `approve`, `attestApproval` and `requestChanges`, add `review.auto = null;` on the line after each function's `review.note = …;` assignment. That is three insertions: approve after `review.note = opts.note || "";`, attestApproval after `review.note = note;`, requestChanges after `review.note = opts.note || "";`.

- [ ] **Step 8: Estimator pre-checks.** In `src/app/(app)/estimator/actions.ts`:
- In the `@/lib/stores/quotes` import list, replace `requireApprovalToAdvance,` with `checkApprovalGate,`.
- In `setStatusAction`, replace

```ts
    const gate = requireApprovalToAdvance(cur?.review ?? null, status === "won" ? "won" : "send");
```

with

```ts
    // #242: the same decision setStatus makes — an approval that still holds,
    // or the quote owner's review limit.
    const gate = await checkApprovalGate(cur, status);
```

- In `sendToCustomerAction`, replace `const gate = requireApprovalToAdvance(cur?.review ?? null, "send");` with `const gate = await checkApprovalGate(cur, "sent");`.

- [ ] **Step 9: Run the gates and confirm they pass**

`npx tsc --noEmit` → 0 errors.
`npm run test:specs > "$TMPDIR/r242-t3.log" 2>&1; grep -c '^PASS ' "$TMPDIR/r242-t3.log"; grep -c '^FAIL ' "$TMPDIR/r242-t3.log"` → `6461`, `0`. All existing #60/#60-67/#77/#170/#174 assertions still pass.
`npx eslint src/lib/review-limits-server.ts src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" scripts/test-review-and-spec.ts` → 0 errors.
`npx next build` → exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/lib/review-limits-server.ts src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): sent/won auto-approve within the owner's review limit; stale auto approvals stop counting (#242)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Banner text, Reviews history, quotes-hub chips, service-builder chips

**Files:**
- Modify: `src/lib/review-line.ts`
- Create: `src/components/review-limit-chip.tsx`
- Modify: `src/app/(app)/quotes/page.tsx`: imports :1–25, `Promise.all` :119–127, row map :540–548 and the badge row :597–660, `<SelectedPanel …>` :733, `SelectedPanel` :785–829 and its approval block :902–905
- Modify: `src/app/(app)/reviews/page.tsx`: imports :1–13, metaLine :164–166
- Modify: `src/app/(app)/flame-tests/quote/page.tsx`, `repairs/quote/page.tsx`, `inspections/quote/page.tsx`, `rentals/quote/page.tsx`, `design/engagements/quote/page.tsx`
- Test: `scripts/test-review-and-spec.ts` (append at END, plus one `.then` line)

**Interfaces:**
- Consumes: Task 1 `reviewLimitChip`, `reviewKindPhrase`, `type ReviewLimitChipData`; Task 3 `loadReviewLimitContext`, `reviewLimitChipFor`, `QuoteReview.auto`.
- Produces:
  - `@/lib/review-line`: `ApprovedReviewLike` gains `method?: … | "auto_limit"` and `auto?: { kind: string; limit: number | "none"; value: number } | null`; `autoApprovalLine(review: ApprovedReviewLike): string`; `staleAutoApprovalLine(chipText: string): string`; `approvedReviewLine` returns `autoApprovalLine` for `auto_limit`.
  - `@/components/review-limit-chip`: `ReviewLimitChip({ chip: ReviewLimitChipData | null; variant?: "banner" | "inline" | "pill" })`. It has no hooks and no `"use client"`.
- Reuses harness aliases from Task 3: `r242Patch`, `r242SetSettings`, `r242UserByEmail`, `r242AddUser`, `r242Create`, `r242Fx`, `r242Reg`. **Do not re-import them.** New aliases: `r242Line`, `r242AutoLine`, `r242StaleLine`, `r242ChipFor`.

- [ ] **Step 1: Write the failing tests.** Append at the END:

```ts
/* --- #242 T4: approval sentence, Reviews history, hub + builder chips --- */
import { approvedReviewLine as r242Line, autoApprovalLine as r242AutoLine, staleAutoApprovalLine as r242StaleLine } from "@/lib/review-line";
import { reviewLimitChipFor as r242ChipFor } from "@/lib/review-limits-server";
{
  const a = {
    state: "approved", method: "auto_limit" as const, decidedBy: "Nic Trapani", reviewer: null, note: "",
    auto: { kind: "system_plain", limit: 25000 as number | "none", value: 20000 },
  };
  ok(r242Line(a) === "Auto-approved — within Nic's $25,000 limit for system estimates without labor", `#242: the approval banner reads the spec sentence (got "${r242Line(a)}")`);
  ok(r242AutoLine({ ...a, auto: { kind: "rental", limit: "none", value: 1 } }) === "Auto-approved — Nic has no review limit for rentals", "#242: a No-limit auto approval says so");
  ok(
    r242Line({ method: "in_app", decidedBy: "Jeff Chesebro", reviewer: null, note: "" }) === "Approved by Jeff — ready to send to the customer" &&
      r242Line({ method: "attested", decidedBy: "Jeff Chesebro", reviewer: null, note: "" }) === "Attested by Jeff — ready to send to the customer",
    "#242: in-app and attested banner lines unchanged"
  );
  ok(
    r242StaleLine("Over your $25,000 limit — needs review") === "Auto-approval no longer applies — over your $25,000 limit — needs review",
    "#242: stale auto approval banner line"
  );
  const rl = readFileSync(join(process.cwd(), "src/lib/review-line.ts"), "utf8");
  ok(!rl.includes("@/lib/stores") && !rl.includes("@/db"), "#242: review-line.ts stays client-safe");
  const chipSrc = readFileSync(join(process.cwd(), "src/components/review-limit-chip.tsx"), "utf8");
  ok(
    !chipSrc.includes("\"use client\"") && !/from "@\/(db|lib\/stores)/.test(chipSrc) && !/\buse(State|Effect|Transition)\b/.test(chipSrc),
    "#242: ReviewLimitChip is a hook-free, store-free component usable from server pages and the Estimator client"
  );
  const hub = readFileSync(join(process.cwd(), "src/app/(app)/quotes/page.tsx"), "utf8");
  ok(
    hub.includes("loadReviewLimitContext()") && hub.includes("reviewLimitChip(q, limitCtx, me)") && hub.includes("<ReviewLimitChip") &&
      hub.includes('const canSend = isOwner && !sentAlready && (rev.state === "approved" || reviewLimit?.tone === "within");'),
    "#242: quotes hub rows carry the chip and Send opens for a quote within the owner's limit"
  );
  const rvw = readFileSync(join(process.cwd(), "src/app/(app)/reviews/page.tsx"), "utf8");
  ok(rvw.includes("autoApprovalLine(r)"), "#242: Reviews history names an auto approval with the limit sentence");
  for (const p of ["flame-tests/quote", "repairs/quote", "inspections/quote", "rentals/quote", "design/engagements/quote"]) {
    const src = readFileSync(join(process.cwd(), `src/app/(app)/${p}/page.tsx`), "utf8");
    ok(src.includes("reviewLimitChipFor(") && src.includes("<ReviewLimitChip chip={reviewLimit}"), `#242: the ${p} builder shows the review-limit chip`);
  }
}

async function reviewLimitChips242AsyncChecks(): Promise<void> {
  const before = await r242Patch();
  const email = "r242.owner@example.test";
  const owner = (await r242UserByEmail(email)) ?? (await r242AddUser({ name: "Rae Twofortytwo", email }));
  const id = r242Fx(242, "chip");
  r242Reg("quotes", id);
  try {
    await r242SetSettings({ reviewLimits: { [owner.id]: { rental: 5000 } } });
    const q = await r242Create({ id, name: "#242 chip", customer: "Spec fixture", owner: owner.name, value: 4000, quoteType: "rental" });
    const mine = await r242ChipFor(q, owner.name);
    ok(mine?.tone === "within" && mine.text === "Within your limit — approves automatically", "#242 store: reviewLimitChipFor evaluates a saved quote against the owner's live limit");
    const theirs = await r242ChipFor({ ...q, value: 6000 }, "Jeff Chesebro");
    ok(theirs?.tone === "over" && theirs.text === "Over Rae's $5,000 limit — needs review", "#242 store: another viewer sees the owner's name and dollar limit");
  } finally {
    await r242SetSettings({ reviewLimits: before.reviewLimits ?? {} });
  }
}
```

Add this line directly below Task 3's `.then(() => reviewLimits242AsyncChecks())`, so it is still immediately above the `// Before the report…` comment:

```ts
  .then(() => reviewLimitChips242AsyncChecks())
```

- [ ] **Step 2: Run it and confirm it fails.** `npx tsc --noEmit 2>&1 | head -5` should fail on the missing `autoApprovalLine` / `staleAutoApprovalLine` exports and the missing `@/components/review-limit-chip` file.

- [ ] **Step 3: `src/lib/review-line.ts`.** Add the import below the `@/lib/team` import:

```ts
import { reviewKindPhrase } from "@/lib/review-limits";
import { money } from "@/lib/format";
```

Replace the `ApprovedReviewLike` type:

```ts
export type ApprovedReviewLike = {
  method?: "in_app" | "attested" | "auto_limit" | null;
  decidedBy: string | null;
  reviewer: string | null;
  note: string;
  /** #242: an `auto_limit` approval's snapshot (kind, limit, value). */
  auto?: { kind: string; limit: number | "none"; value: number } | null;
};
```

Make the first line of `approvedReviewLine`'s body:

```ts
  if (review.method === "auto_limit") return autoApprovalLine(review);
```

Append:

```ts
/** #242: "Auto-approved — within Nic's $25,000 limit for system estimates
 *  without labor" (or "… Nic has no review limit for rentals"). */
export function autoApprovalLine(review: ApprovedReviewLike): string {
  const who = firstName(review.decidedBy || "");
  const a = review.auto;
  if (!a) return "Auto-approved — within " + who + "'s review limit";
  const phrase = reviewKindPhrase(a.kind);
  return a.limit === "none"
    ? `Auto-approved — ${who} has no review limit for ${phrase}`
    : `Auto-approved — within ${who}'s ${money(a.limit)} limit for ${phrase}`;
}

/** #242: the banner for an auto approval that no longer holds. */
export function staleAutoApprovalLine(chipText: string): string {
  const t = chipText || "needs review";
  return "Auto-approval no longer applies — " + t.charAt(0).toLowerCase() + t.slice(1);
}
```

Also extend the doc comment's bullet list with: ` * - \`method === "auto_limit"\` — #242: autoApprovalLine (no "ready to send" suffix).`

- [ ] **Step 4: Create `src/components/review-limit-chip.tsx`**

```tsx
import type { ReviewLimitChipData } from "@/lib/review-limits";

/**
 * #242 — the review-limit chip: "Within your limit — approves automatically"
 * or "Over your $25,000 limit — needs review". No hooks and no store, so
 * server pages render it directly and the Estimator client can import it.
 * `banner` sits above a builder; `inline` sits in a bar; `pill` is a hub-row
 * badge (short label, full sentence as the tooltip).
 */
const TONE = {
  within: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", icon: "✓" },
  over: { ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", icon: "!" },
} as const;

export function ReviewLimitChip({
  chip,
  variant = "banner",
}: {
  chip: ReviewLimitChipData | null;
  variant?: "banner" | "inline" | "pill";
}) {
  if (!chip) return null;
  const t = TONE[chip.tone];
  if (variant === "pill") {
    return (
      <span
        title={chip.text}
        style={{
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          color: t.ink,
          background: t.soft,
          border: `1px solid ${t.bd}`,
          padding: "2px 6px",
          borderRadius: 4,
          whiteSpace: "nowrap",
        }}
      >
        {t.icon} {chip.short}
      </span>
    );
  }
  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        marginBottom: variant === "banner" ? 12 : 0,
        padding: "6px 11px",
        borderRadius: 8,
        background: t.soft,
        border: `1px solid ${t.bd}`,
        color: t.ink,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden>{t.icon}</span>
      {chip.text}
    </div>
  );
}
```

- [ ] **Step 5: Quotes hub (`src/app/(app)/quotes/page.tsx`).**
- Imports, after the `quote-links` import:

```tsx
import { staleAutoApprovalLine } from "@/lib/review-line";
import { reviewLimitChip, type ReviewLimitChipData } from "@/lib/review-limits";
import { loadReviewLimitContext } from "@/lib/review-limits-server";
import { ReviewLimitChip } from "@/components/review-limit-chip";
```

- The `Promise.all`: destructure a trailing `limitCtx` and add `loadReviewLimitContext(),` after `loadPipelines(),`:

```tsx
  const [user, sp, quotes, customers, users, reviewerRows, pipes, limitCtx] = await Promise.all([
```

- Row map: after `const owner = q.owner || "Unassigned";` add `const reviewLimit = reviewLimitChip(q, limitCtx, me);`. After the `{q.portalAcceptance && q.status === "sent" && (…)}` badge, add `{reviewLimit && <ReviewLimitChip chip={reviewLimit} variant="pill" />}`. Pass `reviewLimit={reviewLimit}` to `<SelectedPanel …/>`.
- `SelectedPanel`: add `reviewLimit,` to the destructure and `reviewLimit: ReviewLimitChipData | null;` to its props type. Replace the head of the view-model (from `const rev = q.review || …` through the `rbSub` if/else chain) with:

```tsx
  const stored = q.review || { state: "none" as const, reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "" };
  // #242: a stale auto approval (edited over the owner's limit, labor added,
  // limit lowered) is not an approval — read it as unsubmitted, like the gate.
  const staleAuto = !!reviewLimit?.staleAuto;
  const rev = staleAuto ? { ...stored, state: "none" as const } : stored;
  const rm = RB_META[rev.state] || RB_META.none;
  const isOwner = q.owner === me;
  const sentAlready = q.status === "sent" || q.status === "won" || q.status === "lost";
  const canSubmit = isOwner && (rev.state === "none" || rev.state === "changes") && !sentAlready;
  const canSend = isOwner && !sentAlready && (rev.state === "approved" || reviewLimit?.tone === "within");

  let rbSub: string;
  if (rev.state === "none")
    rbSub = staleAuto && reviewLimit
      ? staleAutoApprovalLine(reviewLimit.text)
      : "Submit for a reviewer’s approval before sending to the customer.";
  else if (rev.state === "in_review")
    rbSub = rev.reviewer
      ? "With " + firstName(rev.reviewer) + " for approval"
      : "In the shared queue — awaiting a reviewer";
  else if (rev.state === "approved") rbSub = approvedReviewLine(rev);
  else
    rbSub = rev.note
      ? "“" + rev.note + "” — " + firstName(rev.decidedBy || "")
      : "Returned by " + firstName(rev.decidedBy || "");
```

- In the panel's banner text block (`<div style={{ minWidth: 0, flex: 1 }}>` containing `{rbSub}`), add after the `{rbSub}` div:

```tsx
          {reviewLimit && !staleAuto && (
            <div style={{ marginTop: 6 }}>
              <ReviewLimitChip chip={reviewLimit} variant="inline" />
            </div>
          )}
```

- [ ] **Step 6: Reviews history (`src/app/(app)/reviews/page.tsx`).** Add `import { autoApprovalLine } from "@/lib/review-line";` and replace the approved branch of the "mine" `metaLine`:

```tsx
      if (r.state === "approved")
        metaLine =
          (r.method === "auto_limit"
            ? autoApprovalLine(r)
            : "Approved by " + firstName(r.decidedBy || r.reviewer || "")) +
          " · " +
          timeAgo(r.decidedAt);
```

- [ ] **Step 7: Service builders.** In each of the five pages, add:

```tsx
import { reviewLimitChipFor } from "@/lib/review-limits-server";
import { ReviewLimitChip } from "@/components/review-limit-chip";
```

Render `<ReviewLimitChip chip={reviewLimit} />` on the line after `<ActionError … />`. Compute `reviewLimit` as follows:

- `flame-tests/quote/page.tsx`: change `const [, sp, customerDocs, rates, settings, travelRates]` to `const [user, sp, …]`. After `const editQuote = editId ? await getQuote(editId) : null;` add:

```tsx
  // #242: the owner's review-limit chip for a saved quote (a new quote has no owner/value yet).
  const reviewLimit =
    editQuote && editQuote.quoteType === "flame_test" ? await reviewLimitChipFor(editQuote, user.name) : null;
```

- `repairs/quote/page.tsx`: the same, with `const [user, sp, …]` at :74 and `"repair"`.
- `inspections/quote/page.tsx`: `user` is already destructured (:60). Same block with `"inspection"`.
- `rentals/quote/page.tsx`: `const [user, sp, customerDocs, items, locations, settings]` (:70), same block with `"rental"`.
- `design/engagements/quote/page.tsx`: `const [user, sp, customerDocs, settings]` (:39). Before `let initial: BuilderInitial | null = null;` add `let reviewLimit: ReviewLimitChipData | null = null;` (plus `import type { ReviewLimitChipData } from "@/lib/review-limits";`). Inside `if (q && q.quoteType === "consulting") {`, as the first line: `reviewLimit = await reviewLimitChipFor(q, user.name);`.

- [ ] **Step 8: Run the gates and confirm they pass.** `npx tsc --noEmit` → 0 errors. `npm run test:specs > "$TMPDIR/r242-t4.log" 2>&1; grep -c '^PASS ' …; grep -c '^FAIL ' …` → `6476`, `0` (the existing #77 approvedReviewLine assertions still pass). `npx eslint` on every file above plus the harness → 0 errors. `npx next build` → exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/review-line.ts src/components/review-limit-chip.tsx "src/app/(app)/quotes/page.tsx" "src/app/(app)/reviews/page.tsx" "src/app/(app)/flame-tests/quote/page.tsx" "src/app/(app)/repairs/quote/page.tsx" "src/app/(app)/inspections/quote/page.tsx" "src/app/(app)/rentals/quote/page.tsx" "src/app/(app)/design/engagements/quote/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): review-limit chips on the hub and service builders; auto-approval sentence in banners and Reviews (#242)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Estimator chip, stale banner, Send when within the limit

**Files:**
- Modify: `src/app/(app)/estimator/actions.ts`: imports; `SaveResult` :148, `ReviewSync` :177, `syncOf` :190, `StageSync` :197, `stageSyncOf` :206; the save return ~:488; every `return syncOf(id)` / `return stageSyncOf(id)` (:762, :810, :834, :845, :854, :863, :875, :917, :979); `sendToCustomerAction` :889 and `setQuotePipelineAction` :818 (bind `user`)
- Modify: `src/app/(app)/estimator/types.ts` (`EstimatorProps` :383, after `canApprove: boolean;` :412)
- Modify: `src/app/(app)/estimator/page.tsx` (imports; before `return (` ~:348; the `EstimatorClient` props)
- Modify: `src/app/(app)/estimator/estimator-client.tsx`: imports :6; props destructure :350–370; state after `review` :395; `applySync`/`applyStageSync` :780–798; save handler :853; review view-model :1861–1897; review bar :2317
- Test: `scripts/test-review-and-spec.ts` (append at END)

**Interfaces:**
- Consumes: Task 3 `reviewLimitChipFor`; Task 1 `type ReviewLimitChipData`; Task 4 `ReviewLimitChip`, `staleAutoApprovalLine`.
- Produces: `ReviewSync.reviewLimit?`, `StageSync.reviewLimit?`, `SaveResult.reviewLimit?` (all `ReviewLimitChipData | null`); `syncOf(id: string, viewer: string)`, `stageSyncOf(id: string, viewer: string)`; `EstimatorProps.reviewLimit: ReviewLimitChipData | null`.
- New harness aliases: none (plain `readFileSync`).

- [ ] **Step 1: Write the failing tests.** Append at the END:

```ts
/* --- #242 T5: the Estimator's chip, stale banner and Send-within-limit --- */
{
  const ea = readFileSync(join(process.cwd(), "src/app/(app)/estimator/actions.ts"), "utf8");
  ok(
    ea.includes("async function syncOf(id: string, viewer: string)") && ea.includes("async function stageSyncOf(id: string, viewer: string)") &&
      (ea.match(/reviewLimitChipFor\(/g) || []).length >= 3,
    "#242 estimator: syncOf / stageSyncOf / the save result re-evaluate the chip on the server"
  );
  ok(!/return (syncOf|stageSyncOf)\(id\);/.test(ea), "#242 estimator: every sync names its viewer (the chip says 'your' only to the owner)");
  ok((ea.match(/reviewLimit\?: ReviewLimitChipData \| null;/g) || []).length === 3 && ea.includes("reviewLimit: q ? await reviewLimitChipFor(q, user.name) : null,"), "#242 estimator: SaveResult, ReviewSync and StageSync carry reviewLimit");
  const pg = readFileSync(join(process.cwd(), "src/app/(app)/estimator/page.tsx"), "utf8");
  ok(pg.includes("reviewLimitChipFor(q, user.name)") && pg.includes("reviewLimit={reviewLimit}"), "#242 estimator: the page evaluates the saved quote's chip for the viewer");
  const ty = readFileSync(join(process.cwd(), "src/app/(app)/estimator/types.ts"), "utf8");
  ok(ty.includes("reviewLimit: ReviewLimitChipData | null;"), "#242 estimator: EstimatorProps.reviewLimit");
  const ec = readFileSync(join(process.cwd(), "src/app/(app)/estimator/estimator-client.tsx"), "utf8");
  ok(
    !/from "@\/(lib\/stores|db|lib\/review-limits-server)/.test(ec.replace(/import type[^;]+;/g, "")) && ec.includes('<ReviewLimitChip chip={reviewLimit} variant="inline" />'),
    "#242 estimator: the client renders the server-evaluated chip without importing a store or the server module"
  );
  ok(
    ec.includes('const rbCanSend = isOwner && !sentAlready && (rev.state === "approved" || reviewLimit?.tone === "within");') &&
      ec.includes("if (r.reviewLimit !== undefined) setReviewLimit(r.reviewLimit);") &&
      ec.includes("if (res.reviewLimit !== undefined) setReviewLimit(res.reviewLimit);") && ec.includes("staleAutoApprovalLine(reviewLimit.text)"),
    "#242 estimator: Send opens within the limit, a stale auto approval reads as unsubmitted, every sync refreshes the chip"
  );
}
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npm run test:specs > "$TMPDIR/r242-t5a.log" 2>&1; grep -c '^FAIL ' "$TMPDIR/r242-t5a.log"`. Expected: 7 FAIL.

- [ ] **Step 3: `estimator/actions.ts`.**
- Imports, after the `@/lib/estimate-number` import:

```ts
import { reviewLimitChipFor } from "@/lib/review-limits-server";
import type { ReviewLimitChipData } from "@/lib/review-limits";
```

- Add `reviewLimit?: ReviewLimitChipData | null;` with a `/** #242 — the review-limit chip, re-evaluated on the server. */` comment to `SaveResult` (after `pdf?:`), `ReviewSync` (after `error?:`) and `StageSync` (after `error?:`).
- Replace `syncOf` and `stageSyncOf`:

```ts
async function syncOf(id: string, viewer: string): Promise<ReviewSync> {
  const q = await get(id);
  return {
    ok: !!q,
    review: q?.review ?? null,
    status: q?.status ?? null,
    reviewLimit: q ? await reviewLimitChipFor(q, viewer) : null,
  };
}
```

```ts
async function stageSyncOf(id: string, viewer: string): Promise<StageSync> {
  const q = await get(id);
  return {
    ok: !!q,
    status: q?.status ?? null,
    review: q?.review ?? null,
    pipelineId: q?.pipelineId ?? null,
    stage: q?.stage ?? null,
    reviewLimit: q ? await reviewLimitChipFor(q, viewer) : null,
  };
}
```

- In `sendToCustomerAction` and `setQuotePipelineAction`, change `await requireUser();` to `const user = await requireUser();`. Then change every `return syncOf(id);` to `return syncOf(id, user.name);` and every `return stageSyncOf(id);` to `return stageSyncOf(id, user.name);`. Each of those functions now has `user` in scope.
- In `saveQuoteAction`'s final return object, after `pdf: pdfState,`, add:

```ts
    reviewLimit: q ? await reviewLimitChipFor(q, user.name) : null,
```

- [ ] **Step 4: `estimator/types.ts`.** Add `import type { ReviewLimitChipData } from "@/lib/review-limits";` beside the other type imports. After `canApprove: boolean;` in `EstimatorProps`, add:

```ts
  /** #242 — the saved quote's review-limit chip, evaluated on the server
   *  (null for a new quote or when the owner has no limit for its kind). */
  reviewLimit: ReviewLimitChipData | null;
```

- [ ] **Step 5: `estimator/page.tsx`.** Add `import { reviewLimitChipFor } from "@/lib/review-limits-server";`. Immediately before `return (` add:

```tsx
  // #242: the owner's review-limit chip for the saved quote (none for a new one).
  const reviewLimit = q ? await reviewLimitChipFor(q, user.name) : null;
```

Add the prop `reviewLimit={reviewLimit}` after `canApprove={can("approve", user.roles)}`.

- [ ] **Step 6: `estimator-client.tsx`.**
- Imports: change `import { approvedReviewLine } from "@/lib/review-line";` to `import { approvedReviewLine, staleAutoApprovalLine } from "@/lib/review-line";`, and add:

```tsx
import { ReviewLimitChip } from "@/components/review-limit-chip";
import type { ReviewLimitChipData } from "@/lib/review-limits";
```

- Props destructure: after `canApprove,` add `reviewLimit: initialReviewLimit,`.
- State, directly after `const [review, setReview] = useState<QuoteReview>(initial.review);`:

```tsx
  /** #242 — the server-evaluated review-limit chip; every sync/save refreshes it. */
  const [reviewLimit, setReviewLimit] = useState<ReviewLimitChipData | null>(initialReviewLimit);
```

- In both `applySync` and `applyStageSync`, after `if (r.review) setReview(r.review);`:

```tsx
    if (r.reviewLimit !== undefined) setReviewLimit(r.reviewLimit);
```

- In `doSave`, after `if (res.review) setReview(res.review);`:

```tsx
          if (res.reviewLimit !== undefined) setReviewLimit(res.reviewLimit);
```

- Review view-model: replace the lines from `const rev = review || { state: "none" };` through the `rbSub` if/else chain with:

```tsx
  // #242: a stale auto approval (quote edited over the owner's limit, labor
  // added, or the limit lowered) is not an approval — the bar reads it as
  // unsubmitted so Submit / Attest reopen, exactly as the server gate does.
  const staleAuto = !!reviewLimit?.staleAuto;
  const rev = staleAuto ? { ...review, state: "none" as const } : review || { state: "none" };
  const rm = rbMeta[rev.state] || rbMeta.none;
  let rbSub: string;
  if (rev.state === "none")
    rbSub = staleAuto && reviewLimit
      ? staleAutoApprovalLine(reviewLimit.text)
      : "Submit for a reviewer’s approval before sending to the customer.";
  else if (rev.state === "in_review")
    rbSub = rev.reviewer
      ? "With " + firstName(rev.reviewer) + " for approval"
      : "In the shared queue — awaiting a reviewer";
  // Punch #77: one shared phrasing for both surfaces. When the quotes list had
  // its own copy of this, it silently dropped the attestation detail. Imported
  // from @/lib/review-line, NOT from @/lib/stores/quotes — that would pull the
  // doc store into this client bundle and 500 the page.
  else if (rev.state === "approved") rbSub = approvedReviewLine(rev);
  else
    rbSub = rev.note
      ? "“" + rev.note + "” — " + firstName(rev.decidedBy || "")
      : "Returned by " + firstName(rev.decidedBy || "");
```

- Replace `const rbCanSend = isOwner && rev.state === "approved" && !sentAlready;` with:

```tsx
  // #242: Send also opens when the quote fits the owner's review limit — the
  // server gate auto-approves it on the way to sent.
  const rbCanSend = isOwner && !sentAlready && (rev.state === "approved" || reviewLimit?.tone === "within");
```

- Review bar JSX: immediately before the `<button type="button" aria-expanded={reviewBarOpen} …>` toggle, add:

```tsx
              {reviewLimit && !staleAuto && <ReviewLimitChip chip={reviewLimit} variant="inline" />}
```

(Stale state already shows in `rbSub`, so the chip is hidden to avoid saying it twice.)

- [ ] **Step 7: Run the gates and confirm they pass.** `npx tsc --noEmit` → 0 errors. `npm run test:specs > "$TMPDIR/r242-t5.log" 2>&1; grep -c '^PASS ' …; grep -c '^FAIL ' …` → `6483`, `0`. `npx eslint "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts` → 0 errors. `npx next build` → exits 0. This is the gate that catches a client component pulling a store.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): Estimator review-limit chip, stale auto-approval banner, Send when within the owner's limit (#242)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Decisions for the controller to log (DECISIONS.md, not by task implementers)

1. **Typed total** means a saved `priceOverride` on the quote type's own subdoc that does **not** carry `priceOverrideSeeded`. The D286 reopen-seed is not hand-typed (D366), and flame `testingOverride` (D365) is a cost input, so neither makes a quote "typed". The rule is the same as `priorHandSetPrice`.
2. **Labor**:
   - Estimator: a non-optional item with extended sell > 0, either in a `kind:"labor"` section or flagged `labor:true`. This is the same rule `pricing.ts` uses to sum `lab`.
   - Grid: a `labor:<system>` line with ext > 0.
   - A promoted Quick design always counts, because its budget prices install.
   - No spec means plain.
   - Custom items, allowances and discounts never count.
3. **Owner**: `owner`, falling back to `preparedBy`. The name is matched to the active roster, trimmed and case-insensitive, exactly one match. An archived, ambiguous or unknown owner means the quote needs review.
4. **A reviewer's "changes requested" blocks auto-approval**, mirroring `canAttestApproval` (#60). Resubmitting clears it.
5. **Auto stamp**: `submittedBy`/`submittedAt` are set to the owner and now, alongside `decidedBy`/`decidedAt`, so it appears in the owner's Reviews → "Submitted by me". It is stamped to the owner even when someone else sends. It is written in the same patch as the status change. Approve, attest and request changes clear the snapshot.
6. **Compared value** is `quote.value`, the saved grand total. Limits are whole dollars, $0 is allowed, and the cap is $10,000,000 (`PRICE_OVERRIDE_MAX` parity).
7. **Chip**:
   - Shown on a saved quote only. A new, unsaved builder has no value or owner.
   - Hidden on won/lost, on in-app, attested or legacy approvals, and on changes-requested quotes.
   - The hub pill shows a short label with the full sentence as its tooltip.
   - The Estimator chip reflects the last save, not unsaved edits.
   - Another viewer sees "Nic's" where the owner sees "your".
8. **Stale auto approvals** read as unsubmitted in the Estimator and hub banners ("Auto-approval no longer applies — …"). Submit and Attest reopen, and Send stays closed until the quote fits again or someone approves it.
9. **Send within limit**: the owner's Send button opens without a prior approval when the chip says "within". The server gate approves on the way to sent.

## Self-review

- **Spec coverage:**
  - §1 table, storage, sanitize and `manage_users` gating: Task 2 (the sanitizer is in Task 1).
  - §2 `reviewKindOf`, labor and typed splits: Task 1.
  - §3 auto-approval at the gate (setStatus plus both pre-checks), the stamp fields and snapshot, today's refusal on over-limit, stale re-check (value, labor, lowered limit), in-app/attested unchanged, bypasses unchanged, owner fallback and roster: Tasks 1 and 3.
  - §4 chips (Estimator in Task 5; the flame/repair/inspection/rental/consulting builders and hub rows in Task 4) and the banner / Reviews sentence: Task 4.
  - Testing section: pure (Task 1), store/gate (Task 3), settings gating (Task 2), and the four gates plus `next build` on every task.
- **Types used across tasks:** `ReviewLimitChipData`, `reviewLimitChip`, `reviewLimitChipFor`, `loadReviewLimitContext`, `decideApprovalGate`, `checkApprovalGate`, `autoApprovedReview`, `AutoApprovalEval`, `AutoApprovalSnapshot` and `applyLimitCells` are each defined once and used with the same signatures.
- **Harness totals:** 6371 → 6427 (+56) → 6434 (+7) → 6461 (+27) → 6476 (+15) → 6483 (+7).
