# Two-prong estimate output — Slice A Implementation Plan (#301)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice A (spec Phases 1–2) of #301: each system carries a **discipline**, the client's **goals** (pre-filled
from the site visit's new per-discipline **Client goals** box) and an optional **cover paragraph**; the quote carries an
**overall summary** and a **Not included** list (default list in Settings → Estimate output); and staff download a one-to-two
page, Arial, letterhead **Cover PDF** of the live quote from the customer preview sidebar.

**Architecture:**
- **Pure core** (client-safe, harness-importable): `src/lib/estimate-output/fields.ts` (field vocab, caps, cleaning,
  discipline inference, settings-default sanitizing), `goals.ts` (survey goals → sections), `scopes.ts` (printed scopes,
  cover paragraph rule, add options, totals lines, Not included, summary sentence), `cover.ts` (signer, footer, link, the
  `CoverDocumentProps` builder).
- **Server:** `src/lib/stores/estimate-output-defaults.ts` (settings blob `estimate_output_defaults`),
  `src/lib/estimate-output/survey-goals-server.ts` (survey lookups), `src/lib/estimate-output/cover-loader.ts` (the same
  data path as the print route + roster + defaults + share link).
- **UI:** a Client goals box per survey discipline; a Discipline select in the system header; a `ScopeOutputFields` block
  in the narrative column (Client goals, From site visit, Cover paragraph + source chip) and **Use selection as cover**
  under the intro; a `CoverPackagePanel` in the customer preview sidebar (Overall summary, Not included + Reset to default,
  Cover PDF); an Estimate output card in Settings → Sales & Rewards.
- **Cover PDF:** `src/components/estimate-output/cover-document.tsx` (server component, pure props) printed by the signed
  route `/print/cover/[id]` (new `PrintTokenKind` `"cover"`) through the existing headless-Chrome renderer, downloaded from
  `/api/quotes/[id]/cover-pdf`.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19 server + client components, Drizzle/PGlite doc-store, tsx
harness (`scripts/test-review-and-spec.ts`), puppeteer-core (existing `renderPrintRouteToPdf`).

**Spec:** `docs/superpowers/specs/2026-10-05-two-prong-estimate-output-design.md`. This plan covers **Slice A only**: §1
(the section and quote fields, not `packageFiles` / `clientResponses` / `shareOpens`), §2 `scopes.ts` (the cover subset),
§3, §4, the Slice A rows of §11–§12. The "Spec-review corrections" R1–R20 override the earlier decisions where they conflict
(R1, R2, R3, R4, R5, R7, R14, R16, R17, R19, R20 apply here).

**Builds on:** origin/main `fd867d8b` (#300) + the spec commit `3003da41` on `feat/301-estimate-package`. Uses #293's
`QuoteDocumentProps` (`quote-document.tsx:24`), `quoteDocumentDataFor` (`quote-document-data.ts:62`),
`systemPrintsInBody` (`quote-document-view.ts:13`), `narrativeBlocks` / `printableKeyProducts` (`narrative.ts`),
`shareLinkView` / `shareSecret` (`quote-share/links.ts`), `onlineEstimateState` (`quote-share/view.ts:40`),
`printOriginFor` (`quote-pdf/origin.ts:39`), `renderPrintRouteToPdf` (`quote-pdf/render.ts:140`), `signPrintToken` /
`verifyPrintToken` (`quote-pdf/token.ts`), and the harness's `qd293Props` fixture (alias `p293Props`, module scope,
`scripts/qd293-cases.ts`).

## Spec points the shipped code forces this plan to adapt

These are deliberate. Each one is logged in DECISIONS at docs time (Task 10).

1. **Settings → Estimate output is a card in the Sales & Rewards group, not a new menu group.** Settings groups
   (`settings-sections.ts`) are pinned by the "settings cleanup" harness block (exact card lists per group, exact card
   count, one marker per card). A new card is the smallest change that matches R17; the plan updates exactly three of those
   pins (Task 5) because the spec deliberately adds a card. No other old check may be edited.
2. **The section fields ride `spec`.** `spec` is a `QUOTE_CONTENT_FIELDS` member and the whole sections array is part of the
   preview's `pdfDocKey`, so editing a system's discipline / goals / cover paragraph shows "Unsaved changes" and the next
   Save re-renders the estimate PDF — exactly like the internal `room` field (#262) does today. Not special-cased.
3. **`notIncluded` absent = the Settings default list.** `effectiveNotIncluded(q.notIncluded, defaults)`; the Estimator
   seeds its textarea with the default when the quote never stored one, so the first Save stores it (D-e "starts from").
   An explicitly emptied list (`""`) prints nothing.
4. **The two quote fields save twice:** in the Save payload (R14) and through the header autosave
   (`updateQuoteMetaAction`, 500 ms debounce, the cover-note idiom) so the Cover PDF reflects them without a full Save.
   Neither is a content field, so neither re-renders the estimate PDF.
5. **A labor scope's cover paragraph** (R2 leaves it open): override, else the intro's first paragraph, else the fixed
   "Installation, commissioning & project management." (source `labor`) — never "[needs a paragraph]".
6. **`outputScopes` carries only what the cover prints** (id, number, name, labor flag, discipline, price, client goals,
   cover paragraph). Slice B adds narrative blocks, key products and BOM rows with `bom.ts`.
7. **No toolbar ⋯ entry** (D-p). That ⋯ is `QuoteNextStep`'s server-evaluated approval menu shared with the Quotes hub
   (#293 slice 3, adaptation 7). The Cover PDF lives in the customer preview sidebar only.
8. **`CoverDocument` takes the letterhead as a prop.** The print page imports `peak-letterhead.jpg`; the component imports
   no image, so the harness can render it in Node (the D543 rule).
9. **`docFields.notIncluded` freezes as `null`** when the quote never stored one (so a later reader can tell "default" from
   "emptied"). The v1 online page prints neither field; Slice B reads them per R12.
10. **The link line's origin is `printOriginFor` on the print request** (`QUOTE_PDF_ORIGIN` in production). A cover rendered
    on a preview deploy carries the preview origin — make covers from production (same rule as client links). The line
    prints only when the v1 link is active **and** `onlineEstimateState(q).kind === "ok"`.
11. **Cover date is America/Chicago; the font stack is `Arial, Helvetica, sans-serif`.** Where Chrome has no Arial (Vercel's
    Chromium) it prints with the fallback; noted for Jeff.
12. **The footer repeats on every page** through a fixed-position footer over a repeating `<tfoot>` spacer (Chrome repeats
    both in print), not puppeteer's header/footer template (`renderPrintRouteToPdf` takes no such option).
13. **The cover route answers 404 for a service quote**, the same text as an unknown id.
14. **Survey goals don't print on the venue-assessment PDF** (`buildAssessmentSheet`) in this slice; the paper sheets are
    the spec's §9 side task.
15. **Survey goals sanitizing** runs in `saveSurvey` **and** `advanceSurveyStage` (both persist the editor draft), and again
    in `goalsFromSurvey` wherever goals are copied (R4 — the sync push path has no sanitizer).

## Global Constraints

**Workspace and environment**
- Work only in `/Users/sm/Downloads/peak-app-299`, branch `feat/301-estimate-package`. Run
  `export PATH=$HOME/.local/node/bin:$PATH` before any `npx`/`npm`. `node_modules` is present in this worktree; if
  `next-env.d.ts` or `.env.local` is missing, copy them from `/Users/sm/Downloads/peak-app/` (never symlink `node_modules`).
- Read `AGENTS.md` first. For any Next API you touch, read its doc under `node_modules/next/dist/docs/01-app/03-api-reference/`
  (`04-functions/headers.md` — `headers()` is **async**; `03-file-conventions/route.md`;
  `03-file-conventions/02-route-segment-config/maxDuration.md`; `03-file-conventions/page.md`).
- **Never `git stash`** (the stash is shared across worktrees and sessions). Commit to set work aside.
- **Never open `/Users/sm/Downloads/peak-app/.data/pglite`.** `npm run test:specs` uses its own `mktemp -d` datadir. Before it,
  `ps aux | grep -E "tsx|next dev" | grep -v grep` and stop strays.
- **Disk:** `df -h /System/Volumes/Data | tail -1` before test:specs or a build. Above ~90 %, run
  `find $TMPDIR -maxdepth 1 \( -name 'tmp.*' -o -name 'peak-build-db-*' -o -name 'peak-smoke-*' \) -type d -mmin +60 -exec rm -rf {} +`
  (keep the `-mmin` guard). `rm -rf .next` before every `next build`.

**Code rules**
- **Client components** (`"use client"`) never value-import `@/lib/stores/*`, `@/db/*`, `@/lib/session`, `@/lib/blob`,
  `@/lib/users`, `@/lib/settings`, `@/lib/narrative/(library|photos)`, `@/lib/quote-share/(token|links)`,
  `@/lib/quote-pdf/*` server modules, `@/lib/estimate-output/(cover-loader|survey-goals-server)`. Type-only imports and
  `"use server"` action files are fine. That break shows only in `next build`.
- `src/lib/estimate-output/{fields,goals,scopes,cover}.ts` are **pure and client-safe**: value imports only from
  `@/app/(app)/estimator/(pricing|narrative|quote-document-view)`, `@/lib/rewards/points`, and each other; type-only from
  anything else. Never value-import `quote-document.tsx` (it imports a `.jpg`).
- **`"use server"` files export only async functions.** Types live in `goals.ts` / `fields.ts`.
- **A page file exports only Next's page fields**; a route file only `GET` + segment config.
- **No AI and no external service** (D89). Unwritten text shows a visible placeholder and never blocks.
- **Server actions never throw into a transition.** Every client `await` of an action sits in
  `try { … } catch { setErr(FAILED) }`, `FAILED = "Could not reach the server. Try again."`.
- **No `window.confirm()`** (silent "no" in the Capacitor shells).
- **Timestamps are epoch-ms numbers.**

**Field rules (spec §1, R4, R5, R14)**
- `SpecSection.discipline?: "lighting" | "rigging" | "curtain" | "av"`; `clientGoals?: string` (≤ 1,000);
  `coverText?: string` (≤ 1,500). Plain text: CRLF → LF, control characters except tab/newline removed, trimmed, capped.
  A blank value removes the key (a section without them stays byte-identical).
- `Quote.coverSummary?: string` (≤ 3,000), `Quote.notIncluded?: string` (≤ 3,000, one item per line). **Not**
  `QUOTE_CONTENT_FIELDS`. They join the estimator save whitelist, `updateQuoteMetaAction`'s allowlist, `buildQuote` (only
  when a string) and `QuoteRevisionDocFields`.
- Survey: `disciplines[key].goals` (≤ 1,000), cleaned in `saveSurvey` and `advanceSurveyStage`.
- **Load system strips** `clientGoals` and `coverText` (beside `room`). Same-estimate Copy, Copy to another estimate and Move
  keep them (sanitized like a save).
- `inferDiscipline` (R19): word boundaries; `track` is never a keyword on its own ("Track lighting" → lighting, "Curtain
  track" → curtain, "Track" → none). Used for goal matching and display only — never stored.

**Cover rules (spec §4, R1, R2, R7, R16, R17)**
- Scopes = `sections.filter(systemPrintsInBody)` in order, numbered 1…n; price = `systemSellTotal(sec)` (freight, typed sell
  and $25 rounding included). **Invariant (R1):** `Σ scope prices − (t.credit || 0) = t.grand` (tax is 0).
- Totals print exactly as `QuoteDocument`: the credit row `rewardPointsAppliedLabel(credit)` / `−$X` when `t.credit > 0`;
  "Total (excludes items pending price)" when a portal-catalog quote still has a non-option `por` line, else "Total"; then
  `rewardsLine`, then `standingLines`.
- Add options (D-f): every `option` line in document order, "ADD OPTION 1…", description, comment as the reason, extended
  sell — only when the quote's `pdfOptions` flag is on.
- Signer (R16): `owner`, else `preparedBy`, matched to `allUsers()` by exact, case-insensitive, trimmed name, **unique only**;
  name, title, phone (`phone` else `mobile`), email. No match → the block prints the company name only.
- Footer (R17): company name · primary office (`quoteDefault`, else first) street, "city, ST zip" · office phone · website
  (Settings → Estimate output).
- Route (R7): `requireUser()`, `export const maxDuration = 60`, `printOriginFor(process.env, host, proto)`.

**Copy (verbatim)**
- Placeholder: `[needs a paragraph]`. Labor fallback: `Installation, commissioning & project management.`
- Cover source chips: `Override`, `From intro`, `From key product`, `Labor wording`, `Needs a paragraph`.
- Title fallback: `Estimate Summary`. Link line: `View the full estimate online: <url>`.
- Summary sentence: `This estimate includes N scopes: A, B and C.` (1 → `1 scope: A.`; 2 → `A and B`).
- Not included: `Not included: a; b; c.`
- Survey box label `Client goals`, placeholder `What is the client trying to solve?`.
- Estimator: `Client goals`, `From site visit ▾`, `Add the client's goals`, `Cover paragraph`, `Clear override`,
  `Use selection as cover`, `Select a sentence in the intro first.`, `Cover paragraph set from the selection.`,
  `No site-visit goals for this customer yet.`
- Preview sidebar: `Cover & package`, `Overall summary`, `Not included`, `Reset to default`, `Cover PDF`, `Open cover ↗`,
  `Save first — the cover prints the saved estimate.`, `Save to create the cover.`
- Settings card: `Estimate output`, `Not included — default list`, `Website (cover footer)`, `Save`.

**Existing harness pins — do not break them**
- `src/app/(app)/estimator/actions.ts`: the substrings
  `payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts)`,
  `withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + Date.now() })])`,
  `section = withSanitizedKeyProducts(section);` within 1,200 chars of `export async function copySystemToEstimateAction(`,
  `reconcileEstimatorValue(postedSections, { value: payload.value, margin: payload.margin })`, `value: priced.value,`,
  `margin: priced.margin,`.
- `src/app/(app)/estimator/estimator-client.tsx`: `<NarrativeColumn\s+key=\{narrSec\.id\}`, `<NarrativeColumn`,
  `onToggleKeyProduct={(itemId) => toggleKeyProductLine(sec.id, itemId)}`, `Object.hasOwn(kpLib.rows, sku)`; no value
  import from stores/db/blob/session/narrative server modules.
- `src/app/(app)/estimator/narrative-column.tsx`: every #293 string it holds today; `!Object.hasOwn(rows, s)`; no
  `window.confirm`; no server value import.
- `src/app/(app)/estimator/preview-doc.tsx`: never `className="est-doc"` or `customerLines(`; no value import from
  stores/db/quote-pdf server modules.
- `src/app/(app)/estimator/quote-document.tsx`: **not edited at all** (byte-for-byte baseline).
- `src/lib/narrative/system-library.ts`: `delete base.room;` stays.
- `src/app/(app)/settings/*`: `settings-client.tsx` stays a shell (< 400 lines, no `<section className="pk-card"`); one file per
  group in `groups/`; `<LinkTiles screens={GROUP_LINKS.sales} />`; `GROUP_LINKS` / `SETTINGS_SCREENS` unchanged.
- `src/middleware.ts`, `next.config.ts`, `public/sw.js`: not edited.

Every old check that fails means: change your new code, never the old check — except the three settings-cleanup pins named
in Task 5.

**Harness**
- Each task appends its sync checks at the **end** of `scripts/test-review-and-spec.ts` under a
  `/* ===… #301 slice A — <part> …=== */` banner. Imports use the `e301`/`E301` alias prefix (task-specific suffixes:
  `e301f` fields, `e301s` scopes, `e301g` goals, `e301u` UI, `e301d` defaults, `e301c` cover, `e301r` route) and sit right
  above their block.
- Async DB checks: Task 1 declares `async function estimateOutput301AAsyncChecks()` and chains it with
  `.then(() => estimateOutput301AAsyncChecks())` right after `.then(() => objectSymbolAsyncChecks300())` (the current last
  link, `scripts/test-review-and-spec.ts:10793`), before `.finally(() => teardownFixtures())`. Later tasks add their own
  `async function e301<Part>AsyncChecks()` and append one `await e301<Part>AsyncChecks();` line at the end of
  `estimateOutput301AAsyncChecks`'s body.
- Fixtures: `const { fixtureId } = await import("./test-fixtures");` inside the async function; `registerFixture(coll, id)` is
  already in module scope (imported at line 9376). Use `fixtureId(301, "<slug>")`.
- `readFileSync` and `join` are imported at the top of the harness. `p293Props` / `p293Sections` (from `./qd293-cases`) are
  module-scope aliases usable anywhere.

**Gates per task** (report real numbers)
- `npx tsc --noEmit` → 0 errors.
- `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`, 0 FAIL. Baseline at the #300 head: **12,152 PASS**. Re-measure in Task 1
  Step 0; every later task reports PASS = previous + its new checks.
- ESLint: **before the first edit** of each task, `npx eslint <the non-harness files that task modifies>` and note the
  counts; after, the same command plus the task's new files → no new errors or warnings. Never lint
  `scripts/test-review-and-spec.ts` (whole-file eslint crashes on it, pre-existing).
- `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20` on Tasks 3, 4, 5, 6, 8 (client
  components / routes) and again in Task 9.
- Task 9 adds `npm run test:smoke` (baseline **206/206**; this slice adds 3 routes → **209/209**).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/estimate-output/fields.ts` | create | Pure: `ScopeDiscipline`, `DISCIPLINES`, `DISCIPLINE_LABEL`, caps, `cleanPlainText`, `sanitizeDiscipline`, `inferDiscipline`, `effectiveDiscipline`, `autoDisciplineLabel`, `withDiscipline`, `withSanitizedOutputFields`, `coverTextFromSelection`, `appendGoals`, `effectiveNotIncluded`, `ESTIMATE_OUTPUT_BLOB`, `EstimateOutputDefaults`, `sanitizeEstimateOutputDefaults` |
| `src/lib/estimate-output/goals.ts` | create | Pure: `DisciplineGoals`, `sanitizeSurveyDisciplineGoals`, `withSanitizedSurveyGoals`, `goalsFromSurvey`, `fillClientGoals`, `SiteVisitOption`, `siteVisitOptions` |
| `src/lib/estimate-output/scopes.ts` | create | Pure: `MISSING_COVER`, `LABOR_COVER`, `CoverSource`, `COVER_SOURCE_LABEL`, `coverParagraphFor`, `OutputScope`, `outputScopes`, `AddOption`, `addOptions`, `coverTotals`, `notIncludedItems`, `notIncludedLine`, `coverSummaryText`, `scopePriceLabel` |
| `src/lib/estimate-output/cover.ts` | create | Pure: `CoverSigner`, `CoverUser`, `CoverOffice`, `CoverDocumentProps`, `resolveCoverSigner`, `coverFooterLine`, `coverShareUrl`, `coverPdfFileName`, `coverDocumentPropsFor` |
| `src/lib/estimate-output/survey-goals-server.ts` | create | Server: `surveyGoalsFor`, `siteVisitGoalsFor` |
| `src/lib/estimate-output/cover-loader.ts` | create | Server: `loadCoverDocumentProps` |
| `src/lib/stores/estimate-output-defaults.ts` | create | Server: `getEstimateOutputDefaults`, `saveEstimateOutputDefaults` |
| `src/app/(app)/estimator/output-actions.ts` | create | `"use server"`: `surveyGoalsAction`, `siteVisitGoalsAction` |
| `src/app/(app)/estimator/scope-output-fields.tsx` | create | Client: Client goals + From site visit + Cover paragraph |
| `src/app/(app)/estimator/cover-package-panel.tsx` | create | Client: the preview sidebar's Cover & package block |
| `src/app/(app)/settings/estimate-output-card.tsx` | create | Client: Settings → Sales & Rewards → Estimate output |
| `src/components/estimate-output/cover-document.tsx` | create | Server component: `CoverDocument`, `COVER_PRINT_CSS` |
| `src/app/print/cover/[id]/page.tsx` | create | Signed print route |
| `src/app/api/quotes/[id]/cover-pdf/route.ts` | create | Staff download |
| `src/app/(app)/estimator/types.ts` | modify | `SpecSection` fields; `InitialQuote.coverSummary/notIncluded`; `EstimatorProps.notIncludedDefault` |
| `src/lib/stores/quotes.ts` | modify | `Quote.coverSummary/notIncluded`, `buildQuote`, `QuoteRevisionDocFields`, `revisionDocFields` |
| `src/app/(app)/estimator/actions.ts` | modify | Section sanitize ×3; `SavePayload` + patch; `updateQuoteMetaAction` allowlist |
| `src/lib/narrative/system-library.ts` | modify | `librarySectionForLoad` strips `clientGoals`/`coverText` |
| `src/app/(app)/venue-assessments/[id]/sections/systems.tsx` | modify | Client goals textarea per discipline |
| `src/app/(app)/venue-assessments/[id]/actions.ts` | modify | `saveSurvey` / `advanceSurveyStage` clean goals |
| `src/app/(app)/estimator/section-card.tsx` | modify | Discipline select |
| `src/app/(app)/estimator/narrative-column.tsx` | modify | Mount `ScopeOutputFields`; Use selection as cover |
| `src/app/(app)/estimator/estimator-client.tsx` | modify | Discipline wiring, goals pre-fill, cover fields state/autosave/save, preview props |
| `src/app/(app)/estimator/preview-doc.tsx` | modify | Mount `CoverPackagePanel` |
| `src/app/(app)/estimator/page.tsx` | modify | Load defaults; initial cover fields |
| `src/app/(app)/settings/{settings-sections.ts,groups/sales.tsx,groups/types.ts,settings-client.tsx,page.tsx,actions.ts}` | modify | The Estimate output card |
| `src/lib/quote-pdf/token.ts` | modify | `PrintTokenKind` + `"cover"` |
| `scripts/smoke-routes.ts` | modify | +3 dynamic routes |
| `scripts/test-review-and-spec.ts` | modify | The `#301 slice A` blocks (+ three settings pins, Task 5) |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` | modify | Task 10 |

## Task overview

| # | Task | Depends on |
|---|---|---|
| 1 | Section + quote output fields: types, cleaning, save/move/copy sanitize, Load strip, `buildQuote`, revision `docFields` | none |
| 2 | Pure scopes module: printed scopes, cover paragraph rule, add options, totals lines, Not included, summary | 1 |
| 3 | Survey Client goals: the box, save cleaning, goals → sections rules, server lookups, actions | 1 |
| 4 | Estimator authoring: Discipline select, narrative-column fields, From site visit, Use selection as cover, load pre-fill | 1, 2, 3 |
| 5 | Settings → Estimate output: blob store, action, card (+ three settings pins) | 1 |
| 6 | Quote cover fields in the Estimator: save + autosave, page initial, Cover & package panel | 1, 5 |
| 7 | Cover document: signer, footer, link, `CoverDocumentProps`, `CoverDocument` render | 2 |
| 8 | Cover PDF delivery: token kind, cover loader, print route, download route, panel buttons, smoke | 5, 6, 7 |
| 9 | Final gates (smoke + build) and the browser + PDF check | 1–8 |
| 10 | Docs: DECISIONS, PUNCHLIST #301, AGENTS.md | 9 |

---

### Task 1: Section + quote output fields

**Files:**
- Create: `src/lib/estimate-output/fields.ts`
- Modify: `src/app/(app)/estimator/types.ts:225-259` (`SpecSection`)
- Modify: `src/lib/stores/quotes.ts` (`Quote` after `shareLink` ~`:313`; `QuoteRevisionDocFields` `:372-393`; `buildQuote`
  `:661-707`; `revisionDocFields` `:754-771`)
- Modify: `src/app/(app)/estimator/actions.ts:385`, `:738`, `:910`
- Modify: `src/lib/narrative/system-library.ts:237`
- Test: `scripts/test-review-and-spec.ts` (block `#301 slice A — fields`; `estimateOutput301AAsyncChecks`)

**Interfaces:**
- **Consumes:** `SpecSection` (types.ts); `buildQuote`, `revisionDocFields`, `QUOTE_CONTENT_FIELDS`, `create`, `get`, `update`,
  `addQuoteRevision` (quotes.ts); `librarySectionForLoad` (system-library.ts).
- **Produces** (used by Tasks 2–8):
  - `fields.ts`: `type ScopeDiscipline`; `DISCIPLINES: readonly ScopeDiscipline[]`; `DISCIPLINE_LABEL: Record<ScopeDiscipline, string>`;
    `CLIENT_GOALS_MAX = 1000`, `COVER_TEXT_MAX = 1500`, `COVER_SUMMARY_MAX = 3000`, `NOT_INCLUDED_MAX = 3000`, `WEBSITE_MAX = 200`;
    `cleanPlainText(v: unknown, max: number): string`; `sanitizeDiscipline(v: unknown): ScopeDiscipline | null`;
    `inferDiscipline(name: unknown): ScopeDiscipline | null`;
    `effectiveDiscipline(sec: Pick<SpecSection, "kind" | "name" | "discipline">): ScopeDiscipline | null`;
    `autoDisciplineLabel(name: string): string`; `withDiscipline<T extends SpecSection>(sec: T, v: unknown): T`;
    `withSanitizedOutputFields<T extends SpecSection>(sec: T): T`; `coverTextFromSelection(text: string): string`;
    `appendGoals(current: string | undefined, add: string): string`;
    `effectiveNotIncluded(stored: unknown, fallback: string): string`; `ESTIMATE_OUTPUT_BLOB = "estimate_output_defaults"`;
    `type EstimateOutputDefaults = { notIncluded: string; website: string }`;
    `sanitizeEstimateOutputDefaults(raw: unknown): EstimateOutputDefaults`.
  - `SpecSection.discipline?`, `.clientGoals?`, `.coverText?`; `Quote.coverSummary?: string`, `Quote.notIncluded?: string`;
    `QuoteRevisionDocFields.coverSummary?: string`, `.notIncluded?: string | null`.

- [ ] **Step 0: Baselines.**

```bash
cd /Users/sm/Downloads/peak-app-299 && export PATH=$HOME/.local/node/bin:$PATH
git log --oneline -1                      # 3003da41 (or later docs-only commits)
ps aux | grep -E "tsx|next dev" | grep -v grep
df -h /System/Volumes/Data | tail -1
npx tsc --noEmit && echo TSC_OK
npm run test:specs 2>&1 | tail -3         # record PASS (expected 12,152) / 0 FAIL
npx eslint "src/app/(app)/estimator/types.ts" src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" src/lib/narrative/system-library.ts
```
Record the numbers; every later gate compares against them.

- [ ] **Step 1: Write the failing harness block.** Append at the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #301 slice A — fields: discipline, client goals, cover text on a system;
   cover summary + Not included on the quote; cleaning, the Load-system
   strip, buildQuote, revision docFields, the save/move/copy sanitize.
   ====================================================================== */
import {
  DISCIPLINES as e301fDisc, DISCIPLINE_LABEL as e301fLabel, CLIENT_GOALS_MAX as e301fGoalsMax, COVER_TEXT_MAX as e301fCoverMax,
  cleanPlainText as e301fClean, sanitizeDiscipline as e301fSanDisc, inferDiscipline as e301fInfer, effectiveDiscipline as e301fEff,
  autoDisciplineLabel as e301fAuto, withDiscipline as e301fWithDisc, withSanitizedOutputFields as e301fSan,
  coverTextFromSelection as e301fSel, appendGoals as e301fAppend, effectiveNotIncluded as e301fEffNot,
  sanitizeEstimateOutputDefaults as e301fSanDefaults, ESTIMATE_OUTPUT_BLOB as e301fBlob,
} from "@/lib/estimate-output/fields";
import { DISCIPLINE_GROUPS as e301fGroups } from "@/lib/stores/survey-intake";
import { buildQuote as e301fBuild, revisionDocFields as e301fDocFields, QUOTE_CONTENT_FIELDS as e301fContent, type Quote as E301fQuote } from "@/lib/stores/quotes";
import { librarySectionForLoad as e301fForLoad } from "@/lib/narrative/system-library";
import type { SpecSection as E301fSec } from "@/app/(app)/estimator/types";
{
  const sec = (extra: Record<string, unknown> = {}): E301fSec =>
    ({ id: "s1", name: "Stage Lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }], ...extra }) as E301fSec;

  // ---- vocab ----
  ok([...e301fDisc].sort().join(",") === e301fGroups.map((g) => g.key).sort().join(","), "#301 fields: the discipline vocab is exactly the survey's DisciplineKey set");
  ok(e301fLabel.lighting === "Lighting" && e301fLabel.rigging === "Rigging" && e301fLabel.curtain === "Curtains" && e301fLabel.av === "AV", "#301 fields: discipline labels");

  // ---- cleaning ----
  ok(e301fClean("  a\r\nb\u0007  ", 100) === "a\nb" && e301fClean(42, 10) === "" && e301fClean("abcdef", 3) === "abc" && e301fClean("ab  \n cd", 4) === "ab",
    "#301 fields: plain text — CRLF → LF, control chars dropped (tab/newline kept), trimmed, capped, trailing space after the cap trimmed");
  ok(e301fSanDisc("lighting") === "lighting" && e301fSanDisc("LIGHTING") === null && e301fSanDisc("sound") === null && e301fSanDisc(null) === null, "#301 fields: discipline whitelist");

  // ---- inference (R19) ----
  const cases: Array<[string, string | null]> = [
    ["Stage Lighting", "lighting"], ["Dimming upgrade", "lighting"], ["Track lighting", "lighting"], ["Fixtures", "lighting"],
    ["Rigging", "rigging"], ["Chain hoists", "rigging"], ["Battens", "rigging"],
    ["Curtain track", "curtain"], ["Main drape & valance", "curtain"], ["Soft goods", "curtain"], ["Cyc", "curtain"],
    ["Audio / Video", "av"], ["AV system", "av"], ["Sound reinforcement", "av"], ["Projection screen", "av"],
    ["Track", null], ["Pavilion", null], ["Savings", null], ["Install", null], ["", null],
  ];
  const bad = cases.filter(([n, want]) => e301fInfer(n) !== want);
  ok(bad.length === 0, `#301 fields: inferDiscipline with word boundaries; track never on its own (wrong: ${bad.map(([n]) => n).join(", ") || "none"})`);
  ok(e301fEff(sec()) === "lighting" && e301fEff(sec({ discipline: "rigging" })) === "rigging" && e301fEff(sec({ discipline: "bogus" })) === "lighting" &&
     e301fEff(sec({ kind: "labor", name: "Lighting install", discipline: "lighting" })) === null,
    "#301 fields: effective discipline = stored, else inferred; a labor system never has one (R2)");
  ok(e301fAuto("Stage Lighting") === "Discipline: auto (Lighting)" && e301fAuto("Install") === "Discipline: —", "#301 fields: the select's blank option names the inferred discipline");
  ok(e301fWithDisc(sec(), "av").discipline === "av" && !("discipline" in e301fWithDisc(sec({ discipline: "av" }), "")), "#301 fields: withDiscipline sets or removes the key");

  // ---- section sanitize ----
  const plain = sec();
  ok(e301fSan(plain) === plain, "#301 fields: a section without the keys passes through untouched (same object)");
  const dirty = e301fSan(sec({ discipline: "x", clientGoals: "  " + "g".repeat(e301fGoalsMax + 50) + "  ", coverText: "\r\nCover\u0000 text  " }));
  ok(!("discipline" in dirty) && dirty.clientGoals?.length === e301fGoalsMax && dirty.coverText === "Cover text", "#301 fields: junk discipline dropped, goals capped at 1,000, cover cleaned");
  const blank = e301fSan(sec({ discipline: "", clientGoals: " ", coverText: "" }));
  ok(!("discipline" in blank) && !("clientGoals" in blank) && !("coverText" in blank), "#301 fields: blank values remove their keys");
  ok((e301fSan(sec({ coverText: "c".repeat(e301fCoverMax + 1) })).coverText || "").length === e301fCoverMax, "#301 fields: cover text capped at 1,500");
  ok(e301fSel("  First line\n  second line  ") === "First line second line", "#301 fields: a selection becomes one cover paragraph");
  ok(e301fAppend("", " New ") === "New" && e301fAppend("Old", "New") === "Old\n\nNew" && e301fAppend("Old\n\nNew", "New") === "Old\n\nNew" && e301fAppend("Old", "  ") === "Old",
    "#301 fields: From site visit fills blank goals, appends after a blank line, never duplicates");
  ok(e301fEffNot(undefined, "Permits") === "Permits" && e301fEffNot(null, "Permits") === "Permits" && e301fEffNot("", "Permits") === "" && e301fEffNot("Paint", "Permits") === "Paint",
    "#301 fields: Not included absent → the default list; an emptied list stays empty");
  const d = e301fSanDefaults({ notIncluded: " Permits \r\n\r\n Painting ", website: " peaksystemsgroup.com\n ", extra: 1 });
  ok(d.notIncluded === "Permits\nPainting" && d.website === "peaksystemsgroup.com" && Object.keys(d).sort().join(",") === "notIncluded,website" && e301fBlob === "estimate_output_defaults",
    "#301 fields: the Settings defaults blob is cleaned (lines trimmed, blanks dropped, one-line website, unknown keys dropped)");
  ok(e301fSanDefaults(null).notIncluded === "" && e301fSanDefaults([]).website === "", "#301 fields: junk defaults → empty");

  // ---- quote fields ----
  ok(!(e301fContent as readonly string[]).includes("coverSummary") && !(e301fContent as readonly string[]).includes("notIncluded"),
    "#301 fields: coverSummary / notIncluded are not content fields — they never print on the estimate PDF (R14)");
  const built = e301fBuild("Q-x", { coverSummary: "Sum", notIncluded: "" }, "system", null, 1);
  const bare = e301fBuild("Q-y", {}, "system", null, 1);
  ok(built.coverSummary === "Sum" && built.notIncluded === "" && !("coverSummary" in bare) && !("notIncluded" in bare),
    "#301 fields: buildQuote copies the cover fields only when they are strings (Daylite imports unchanged)");
  const df = e301fDocFields({ id: "Q", customer: "C", status: "sent", coverSummary: "Sum", notIncluded: "A\nB" } as unknown as E301fQuote);
  const dfNone = e301fDocFields({ id: "Q", customer: "C", status: "sent" } as unknown as E301fQuote);
  ok(df.coverSummary === "Sum" && df.notIncluded === "A\nB" && dfNone.coverSummary === "" && dfNone.notIncluded === null,
    "#301 fields: a revision freezes the cover summary and Not included (null = never set, so the default list applies)");

  // ---- Load system strips per-customer text (R5) ----
  const won = { id: "Q-w", status: "won", quoteType: "system", source: "estimator", revisions: [], updatedAt: 1, tierMargin: null,
    spec: { sections: [sec({ discipline: "lighting", clientGoals: "Goals", coverText: "Cover", room: "Hall" })] } } as unknown as E301fQuote;
  const loaded = e301fForLoad(won, "s1");
  ok(!!loaded && !("clientGoals" in loaded.section) && !("coverText" in loaded.section) && !("room" in loaded.section) && loaded.section.discipline === "lighting",
    "#301 fields: Load system drops client goals and the cover paragraph (and room), keeps the discipline");

  // ---- the save paths sanitize ----
  const acts = readFileSync(join(process.cwd(), "src/app/(app)/estimator/actions.ts"), "utf8");
  ok(acts.includes("payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts).map(withSanitizedOutputFields)"), "#301 save: saveQuoteAction cleans the output fields beside the key products");
  ok(acts.includes("const moved = withSanitizedOutputFields(movedRaw);"), "#301 move: a moved system's output fields are cleaned");
  const copyFn = acts.slice(acts.indexOf("export async function copySystemToEstimateAction("));
  ok(/section = withSanitizedKeyProducts\(section\);\s+section = withSanitizedOutputFields\(section\);/.test(copyFn.slice(0, 1400)), "#301 copy: a copied system's output fields are cleaned");
}
```

Then add, right after `.then(() => objectSymbolAsyncChecks300())` in the chain (line ~10793):

```ts
  .then(() => estimateOutput301AAsyncChecks())
```

And append the async function at the end of the file (after the block above):

```ts
/* #301 slice A — the store round trip (create → get → revision → update). Later
   #301 slice A tasks append one `await e301<Part>AsyncChecks();` line at the end. */
async function estimateOutput301AAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const QID = fixtureId(301, "a-fields");
  const sec = { id: "s1", name: "Stage lighting", kind: "materials", mfr: "", freightPct: 0, discipline: "lighting", clientGoals: "Brighter wash", coverText: "Cover para.",
    items: [{ id: 1, sku: "A", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
  await Q.create({ id: QID, name: "#301 fields", customer: "Spec fixture", owner: "spec", quoteType: "system", coverSummary: "Summary.", notIncluded: "Permits\nPainting",
    spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QID);
  const got = await Q.get(QID);
  ok(got?.coverSummary === "Summary." && got?.notIncluded === "Permits\nPainting", "#301 store: create keeps the cover summary and Not included (buildQuote)");
  const back = ((got?.spec as { sections?: E301fSec[] } | null)?.sections || [])[0];
  ok(back?.discipline === "lighting" && back?.clientGoals === "Brighter wash" && back?.coverText === "Cover para.", "#301 store: the section fields round-trip inside spec");
  const rev = await Q.addQuoteRevision(QID, { by: "Test", note: "#301" });
  ok(rev?.docFields?.coverSummary === "Summary." && rev?.docFields?.notIncluded === "Permits\nPainting", "#301 store: a new revision freezes both cover fields");
  const before = got?.contentChangedAt ?? null;
  const upd = await Q.update(QID, { coverSummary: "New summary." });
  ok(upd?.coverSummary === "New summary." && (upd?.contentChangedAt ?? null) === before,
    "#301 store: editing the cover summary is not a content change (the estimate PDF is not re-rendered)");
}
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: aborts with a module-not-found for `@/lib/estimate-output/fields`.

- [ ] **Step 3: Create `src/lib/estimate-output/fields.ts`.**

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";

/**
 * #301 slice A — the estimate-output fields on a system (SpecSection.discipline,
 * clientGoals, coverText) and on the quote (coverSummary, notIncluded), and
 * their cleaning. Pure and client-safe (type-only imports): the Estimator UI,
 * the save actions, the survey save and the harness all use these.
 */

export type ScopeDiscipline = NonNullable<SpecSection["discipline"]>;
/** The survey's DisciplineKey set (survey-intake.ts) — the harness pins the two equal. */
export const DISCIPLINES: readonly ScopeDiscipline[] = ["lighting", "rigging", "curtain", "av"];
export const DISCIPLINE_LABEL: Record<ScopeDiscipline, string> = { lighting: "Lighting", rigging: "Rigging", curtain: "Curtains", av: "AV" };

export const CLIENT_GOALS_MAX = 1_000;
export const COVER_TEXT_MAX = 1_500;
export const COVER_SUMMARY_MAX = 3_000;
export const NOT_INCLUDED_MAX = 3_000;
export const WEBSITE_MAX = 200;

/** Keeps tab (9), newline (10) and every printable character; drops other C0 controls and DEL. */
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += ch;
  }
  return out;
}

/** Plain text as stored: CRLF → LF, controls dropped, trimmed, capped. "" for a non-string. */
export function cleanPlainText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return stripControls(v.replace(/\r\n?/g, "\n")).trim().slice(0, max).trimEnd();
}

export function sanitizeDiscipline(v: unknown): ScopeDiscipline | null {
  return typeof v === "string" && (DISCIPLINES as readonly string[]).includes(v) ? (v as ScopeDiscipline) : null;
}

/** R19: word-boundary keywords, first rule wins. `track` is never a keyword on
 *  its own — "Track lighting" is lighting, "Curtain track" is a curtain. */
const DISCIPLINE_RULES: ReadonlyArray<readonly [ScopeDiscipline, RegExp]> = [
  ["lighting", /\blight(?:s|ing)?\b|\bdimm(?:er|ers|ing)\b|\bfixtures?\b/i],
  ["rigging", /\brigging\b|\bhoists?\b|\bbattens?\b/i],
  ["curtain", /\bcurtains?\b|\bdrape(?:s|ry)?\b|\bvalances?\b|\bcycs?\b|\bcyclorama\b|\bsoft goods\b/i],
  ["av", /\bav\b|\ba\/v\b|\baudio\b|\bvideo\b|\bsound\b|\bprojection\b/i],
];

/** For goal matching and display only — never stored by inference (D-b). */
export function inferDiscipline(name: unknown): ScopeDiscipline | null {
  if (typeof name !== "string" || !name.trim()) return null;
  for (const [d, re] of DISCIPLINE_RULES) if (re.test(name)) return d;
  return null;
}

/** Stored, else inferred from the name; a labor system never has one (R2). */
export function effectiveDiscipline(sec: Pick<SpecSection, "kind" | "name" | "discipline">): ScopeDiscipline | null {
  if (sec.kind === "labor") return null;
  return sanitizeDiscipline(sec.discipline) ?? inferDiscipline(sec.name);
}

/** The Discipline select's blank option. */
export function autoDisciplineLabel(name: string): string {
  const d = inferDiscipline(name);
  return d ? `Discipline: auto (${DISCIPLINE_LABEL[d]})` : "Discipline: —";
}

export function withDiscipline<T extends SpecSection>(sec: T, v: unknown): T {
  const out = { ...sec };
  const d = sanitizeDiscipline(v);
  if (d) out.discipline = d;
  else delete out.discipline;
  return out;
}

/** Server-side save rule (beside withSanitizedKeyProducts): a section that
 *  carries none of the three keys passes through untouched (same object);
 *  otherwise each is cleaned and a blank one is removed. */
export function withSanitizedOutputFields<T extends SpecSection>(sec: T): T {
  if (!sec || typeof sec !== "object") return sec;
  if (!("discipline" in sec) && !("clientGoals" in sec) && !("coverText" in sec)) return sec;
  const out = { ...sec };
  const d = sanitizeDiscipline(sec.discipline);
  if (d) out.discipline = d;
  else delete out.discipline;
  const g = cleanPlainText(sec.clientGoals, CLIENT_GOALS_MAX);
  if (g) out.clientGoals = g;
  else delete out.clientGoals;
  const c = cleanPlainText(sec.coverText, COVER_TEXT_MAX);
  if (c) out.coverText = c;
  else delete out.coverText;
  return out;
}

/** "Use selection as cover" — the selected intro text as one paragraph. */
export function coverTextFromSelection(text: string): string {
  return cleanPlainText(String(text || "").replace(/\s*\n\s*/g, " "), COVER_TEXT_MAX);
}

/** From site visit: fills blank goals, appends after a blank line, never duplicates. */
export function appendGoals(current: string | undefined, add: string): string {
  const cur = (current || "").trim();
  const a = cleanPlainText(add, CLIENT_GOALS_MAX);
  if (!a) return current || "";
  if (!cur) return a;
  if (cur.includes(a)) return current || "";
  return cleanPlainText(cur + "\n\n" + a, CLIENT_GOALS_MAX);
}

/** Absent (never stored) → the Settings default list; "" stays empty (D-e). */
export function effectiveNotIncluded(stored: unknown, fallback: string): string {
  return typeof stored === "string" ? stored : fallback;
}

/* ---- Settings → Estimate output (R17): one settings blob ---- */

export const ESTIMATE_OUTPUT_BLOB = "estimate_output_defaults";
export type EstimateOutputDefaults = { notIncluded: string; website: string };

export function sanitizeEstimateOutputDefaults(raw: unknown): EstimateOutputDefaults {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lines = cleanPlainText(o.notIncluded, NOT_INCLUDED_MAX)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { notIncluded: lines.join("\n"), website: cleanPlainText(o.website, WEBSITE_MAX).replace(/\s+/g, " ") };
}
```

- [ ] **Step 4: Add the `SpecSection` fields** in `src/app/(app)/estimator/types.ts`, right after `keyProducts?: KeyProduct[];`
  (the last member, `:258`):

```ts
  /** #301: the survey discipline this system answers (the Discipline select in
   *  the system header). Absent = inferred from the name for goal matching only
   *  (inferDiscipline) — never stored by inference. Cleaned on save. */
  discipline?: "lighting" | "rigging" | "curtain" | "av";
  /** #301: the client's goals for this scope (≤ 1,000, plain text). Copied
   *  from the site visit; dropped by Load system (R5). */
  clientGoals?: string;
  /** #301: the cover PDF's paragraph override (≤ 1,500). Absent = the intro's
   *  first paragraph (coverParagraphFor). Dropped by Load system (R5). */
  coverText?: string;
```

- [ ] **Step 5: Quote fields in `src/lib/stores/quotes.ts`.**

  (a) In the `Quote` type, right after `shareLink?: QuoteShareLink | null;`:

```ts
  /** #301 — the cover PDF's overall summary (≤ 3,000, plain text). Not a
   *  QUOTE_CONTENT_FIELDS member: it never prints on the estimate PDF, so an
   *  edit never re-renders it. Frozen in a revision's docFields. */
  coverSummary?: string;
  /** #301 — "Not included", one item per line (≤ 3,000). Absent = the
   *  Settings → Estimate output default list (effectiveNotIncluded); "" = none.
   *  Not a content field. Frozen in a revision's docFields. */
  notIncluded?: string;
```

  (b) In `QuoteRevisionDocFields`, after `source: string;`:

```ts
  /** #301 — the cover summary as sent ("" when none). Absent on older revisions. */
  coverSummary?: string;
  /** #301 — Not included as sent; null = the quote never stored one (the
   *  default list applied). Absent on older revisions. */
  notIncluded?: string | null;
```

  (c) In `buildQuote`, after the `leadId` spread (the last line of the returned object):

```ts
    // #301: the cover fields only when the caller set them — every other
    // creator (Daylite import, service builders) writes the doc it wrote before.
    ...(typeof partial.coverSummary === "string" ? { coverSummary: partial.coverSummary } : {}),
    ...(typeof partial.notIncluded === "string" ? { notIncluded: partial.notIncluded } : {}),
```

  (d) In `revisionDocFields`, after `source: d.source || "",`:

```ts
    coverSummary: d.coverSummary || "",
    notIncluded: typeof d.notIncluded === "string" ? d.notIncluded : null,
```

- [ ] **Step 6: Clean the fields on every estimator section write** in `src/app/(app)/estimator/actions.ts`.

  (a) Import, beside `import { withSanitizedKeyProducts } from "./narrative";` (`:28`):

```ts
import { withSanitizedOutputFields } from "@/lib/estimate-output/fields";
```

  (b) `:385` — replace the line with:

```ts
  // #301: the output fields (discipline, client goals, cover text) are cleaned the same way.
  const sellSanitized = Array.isArray(payload.sections) ? payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts).map(withSanitizedOutputFields) : payload.sections;
```

  (c) `:738` — replace `const [moved] = withoutRewardCredit([…]);` with (the inner expression unchanged):

```ts
  const [movedRaw] = withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + Date.now() })]);
  // #301: a moved system keeps its discipline, goals and cover paragraph — cleaned like a save.
  const moved = withSanitizedOutputFields(movedRaw);
```

  (d) `:910` — after `section = withSanitizedKeyProducts(section);` add:

```ts
  section = withSanitizedOutputFields(section);
```

- [ ] **Step 7: Load system strips per-customer text.** In `src/lib/narrative/system-library.ts`, right after
  `delete base.room;` (`:237`):

```ts
  // #301 (R5): the client's goals and the cover paragraph were written for
  // another customer — the discipline (what the system is) travels.
  delete base.clientGoals;
  delete base.coverText;
```

  Also extend the function's doc comment line "…blocks on dropped or missing lines, and `room` (job-specific) go." to
  "…blocks on dropped or missing lines, `room`, `clientGoals` and `coverText` (job-specific) go."

- [ ] **Step 8: Run the gates.**

```bash
npx tsc --noEmit && echo TSC_OK
npm run test:specs 2>&1 | tail -3
npx eslint src/lib/estimate-output/fields.ts "src/app/(app)/estimator/types.ts" src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" src/lib/narrative/system-library.ts
```
Expected: tsc 0; ALL PASSED with PASS = baseline + this block's checks; eslint no new findings.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/estimate-output/fields.ts "src/app/(app)/estimator/types.ts" src/lib/stores/quotes.ts "src/app/(app)/estimator/actions.ts" src/lib/narrative/system-library.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice A — system discipline/goals/cover fields, quote cover summary + Not included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure scopes module

**Files:**
- Create: `src/lib/estimate-output/scopes.ts`
- Test: `scripts/test-review-and-spec.ts` (block `#301 slice A — scopes`)

**Interfaces:**
- **Consumes:** `QuoteDocumentProps` (type, `quote-document.tsx:24`); `fmt`, `lineExtSellOf`, `round2`, `systemSellTotal`
  (`pricing.ts`); `systemPrintsInBody` (`quote-document-view.ts:13`); `narrativeBlocks`, `printableKeyProducts`,
  `NarrativeBlock` (`narrative.ts`); `rewardPointsAppliedLabel` (`@/lib/rewards/points`); `cleanPlainText`,
  `effectiveDiscipline`, `COVER_TEXT_MAX`, `ScopeDiscipline` (Task 1).
- **Produces** (Tasks 4, 7, 8):
  `MISSING_COVER = "[needs a paragraph]"`; `LABOR_COVER`; `type CoverSource = "override" | "intro" | "key-product" | "labor" | "missing"`;
  `COVER_SOURCE_LABEL: Record<CoverSource, string>`; `type CoverParagraph = { text: string; source: CoverSource }`;
  `coverParagraphFor(sec: SpecSection): CoverParagraph`;
  `type OutputScope = { id: string; num: number; name: string; isLabor: boolean; discipline: ScopeDiscipline | null; price: number; clientGoals: string; cover: CoverParagraph }`;
  `outputScopes(p: Pick<QuoteDocumentProps, "sections">): OutputScope[]`;
  `type AddOption = { num: number; label: string; desc: string; reason: string; sectionName: string; price: number }`;
  `addOptions(p: Pick<QuoteDocumentProps, "sections" | "pdfOptions">): AddOption[]`;
  `type CoverTotals = { credit: number; creditLabel: string | null; totalLabel: string; total: number; rewardsLine: string; standingLines: string[] }`;
  `coverTotals(p: Pick<QuoteDocumentProps, "t" | "sections" | "isPortalCatalog" | "rewardsLine" | "standingLines">): CoverTotals`;
  `notIncludedItems(text: string | null | undefined): string[]`; `notIncludedLine(text: string | null | undefined): string`;
  `coverSummaryText(summary: string | null | undefined, names: string[]): string`; `scopePriceLabel(name: string): string`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice A — scopes: the printed scopes, the cover paragraph rule
   (D-d + labor), add options (D-f), the totals lines (R1), Not included,
   the summary sentence.
   ====================================================================== */
import {
  MISSING_COVER as e301sMissing, LABOR_COVER as e301sLabor, COVER_SOURCE_LABEL as e301sSourceLabel, coverParagraphFor as e301sCover,
  outputScopes as e301sScopes, addOptions as e301sOptions, coverTotals as e301sTotals, notIncludedItems as e301sNotItems,
  notIncludedLine as e301sNotLine, coverSummaryText as e301sSummary, scopePriceLabel as e301sPriceLabel,
} from "@/lib/estimate-output/scopes";
import { withRewardCredit as e301sCredit } from "@/lib/rewards/credit-line";
import { round2 as e301sRound } from "@/app/(app)/estimator/pricing";
import { rewardPointsAppliedLabel as e301sPtsLabel } from "@/lib/rewards/points";
import type { SpecSection as E301sSec } from "@/app/(app)/estimator/types";
{
  // ---- cover paragraph (D-d) ----
  const base = (extra: Record<string, unknown> = {}): E301sSec =>
    ({ id: "x", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 5, sku: "SKU-5", desc: "Fresnel", qty: 1, unit: "ea", cost: 10, price: 20 }], ...extra }) as E301sSec;
  ok(e301sCover(base({ coverText: "  Override text  ", narrative: "Intro." })).text === "Override text" && e301sCover(base({ coverText: "x" })).source === "override",
    "#301 cover: the override wins");
  const intro = e301sCover(base({ narrative: "- bullet first\n\nFirst para\nline two.\n\nSecond para." }));
  ok(intro.source === "intro" && intro.text === "First para line two.", "#301 cover: else the intro's first PARAGRAPH block (bullets skipped, lines joined)");
  const kp = e301sCover(base({ keyProducts: [{ lineKey: "5", sku: "SKU-5", text: "A bright fresnel.\n\nMore.", photo: true }] }));
  ok(kp.source === "key-product" && kp.text === "A bright fresnel.", "#301 cover: else the first key product's first paragraph");
  ok(e301sCover(base()).text === e301sMissing && e301sCover(base()).source === "missing" && e301sMissing === "[needs a paragraph]", "#301 cover: else the visible placeholder");
  const lab = e301sCover(base({ kind: "labor", name: "Install" }));
  ok(lab.source === "labor" && lab.text === e301sLabor && e301sCover(base({ kind: "labor", narrative: "Crew of four." })).text === "Crew of four.",
    "#301 cover: a labor scope falls back to the fixed labor wording, never the placeholder");
  ok(e301sSourceLabel.override === "Override" && e301sSourceLabel.intro === "From intro" && e301sSourceLabel["key-product"] === "From key product" &&
     e301sSourceLabel.labor === "Labor wording" && e301sSourceLabel.missing === "Needs a paragraph", "#301 cover: chip labels");

  // ---- scopes = printed systems (D-a, R2) ----
  const p = p293Props();
  const sc = e301sScopes(p);
  ok(sc.map((s) => `${s.num}:${s.name}`).join("|") === "1:Rigging|2:Lighting|3:Install|4:Empty narrative", "#301 scopes: every printed system, in order, numbered like the document");
  ok(sc[0].discipline === "rigging" && sc[1].discipline === "lighting" && sc[2].isLabor && sc[2].discipline === null && sc[3].discipline === null,
    "#301 scopes: disciplines inferred; the labor system is a scope with no discipline (R2)");
  ok(sc[1].cover.source === "intro" && sc[1].cover.text === "Intro para." && sc[0].cover.source === "missing" && sc[2].cover.source === "labor", "#301 scopes: each carries its cover paragraph");
  const zero = [...p293Sections(), { id: "z", name: "Nothing", kind: "materials", mfr: "", freightPct: 0, items: [] } as unknown as E301sSec];
  ok(e301sScopes(p293Props({ sections: zero })).length === 4, "#301 scopes: a system with no revenue doesn't print and isn't a scope");

  // ---- totals invariant (R1) ----
  const sum = (secs: E301sSec[]) => {
    const props = p293Props({ sections: secs });
    return { props, total: e301sRound(e301sScopes(props).reduce((a, s) => a + s.price, 0) - (props.t.credit || 0)) };
  };
  const plain = sum(p293Sections());
  ok(plain.total === e301sRound(plain.props.t.grand), `#301 totals: Σ scope prices = the grand total (freight inside each scope) (${plain.total} vs ${plain.props.t.grand})`);
  const rounded = p293Sections().map((s, i) => (i === 0 ? { ...s, priceRound: 25 } : i === 1 ? { ...s, sellOverride: 777.77 } : s)) as E301sSec[];
  const r2 = sum(rounded);
  ok(r2.total === e301sRound(r2.props.t.grand), "#301 totals: the invariant holds with a typed sell and $25 rounding");
  const credited = e301sCredit(p293Sections(), 40, 999) as E301sSec[];
  const r3 = sum(credited);
  ok((r3.props.t.credit || 0) === 40 && r3.total === e301sRound(r3.props.t.grand), "#301 totals: Σ scope prices − the Rewards credit = the grand total (R1)");
  const tl = e301sTotals(r3.props);
  ok(tl.credit === 40 && tl.creditLabel === e301sPtsLabel(40) && tl.totalLabel === "Total" && tl.total === r3.props.t.grand,
    "#301 totals: the credit row label is rewardPointsAppliedLabel; Total otherwise");
  ok(e301sTotals(p).creditLabel === null && e301sTotals({ ...p, rewardsLine: "Your Gold rewards: Free freight", standingLines: ["  ", "Valid until x"] }).rewardsLine === "Your Gold rewards: Free freight" &&
     e301sTotals({ ...p, standingLines: ["  ", "Valid until x"] }).standingLines.join("|") === "Valid until x",
    "#301 totals: no credit row without a credit; the purchase-perks line and standing lines pass through");
  const por = p293Sections().map((s, i) => (i === 0 ? { ...s, items: s.items.map((it, j) => (j === 0 ? { ...it, por: true } : it)) } : s)) as E301sSec[];
  ok(e301sTotals({ ...p293Props({ sections: por }), isPortalCatalog: true }).totalLabel === "Total (excludes items pending price)" &&
     e301sTotals(p293Props({ sections: por })).totalLabel === "Total", "#301 totals: the POR wording only on a portal-catalog quote, as QuoteDocument prints it");

  // ---- add options (D-f) ----
  const withComment = p293Sections().map((s, i) => (i === 0 ? { ...s, items: s.items.map((it) => (it.option ? { ...it, comment: " If budget allows " } : it)) } : s)) as E301sSec[];
  const opts = e301sOptions(p293Props({ sections: withComment, pdfOptions: { pdfOptions: true } }));
  ok(opts.length === 1 && opts[0].label === "ADD OPTION 1" && opts[0].desc === "Line 3" && opts[0].reason === "If budget allows" && opts[0].sectionName === "Rigging" && opts[0].price === 50,
    "#301 options: option lines numbered across the quote with description, reason and extended sell");
  ok(e301sOptions(p293Props({ sections: withComment, pdfOptions: { pdfOptions: false } })).length === 0, "#301 options: printed only when the quote's Options toggle is on");

  // ---- Not included, summary, price label ----
  ok(e301sNotItems("- Permits\n\n• Painting;\n2. Electrical by others.\npermits\n  ").join("|") === "Permits|Painting|Electrical by others", "#301 not included: markers and trailing ;/. stripped, blanks and repeats dropped");
  ok(e301sNotLine("Permits\nPainting") === "Not included: Permits; Painting." && e301sNotLine("  ") === "", "#301 not included: one paragraph, or nothing");
  ok(e301sSummary("  Our summary.  ", ["A"]) === "Our summary." && e301sSummary("", ["A", "B", "C"]) === "This estimate includes 3 scopes: A, B and C." &&
     e301sSummary("", ["A", "B"]) === "This estimate includes 2 scopes: A and B." && e301sSummary("", ["A"]) === "This estimate includes 1 scope: A." && e301sSummary("", []) === "",
    "#301 summary: the typed summary, else the deterministic scope-list sentence");
  ok(e301sPriceLabel("Lighting") === "Lighting scope" && e301sPriceLabel("Rigging scope") === "Rigging scope" && e301sPriceLabel("  ") === "System scope", "#301 price label: \"<name> scope\"");
  const src = readFileSync(join(process.cwd(), "src/lib/estimate-output/scopes.ts"), "utf8");
  ok(!/^import (?!type)[^\n]*from "(?!@\/app\/\(app\)\/estimator\/(pricing|narrative|quote-document-view)"|@\/lib\/rewards\/points"|\.\/fields")/m.test(src),
    "#301 scopes: pure and client-safe — value imports only pricing, narrative, quote-document-view, rewards/points and fields");
}
```

- [ ] **Step 2: Run it to verify it fails** (`npm run test:specs 2>&1 | tail -5` → module not found
  `@/lib/estimate-output/scopes`).

- [ ] **Step 3: Create `src/lib/estimate-output/scopes.ts`.**

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { lineExtSellOf, systemSellTotal } from "@/app/(app)/estimator/pricing";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { narrativeBlocks, printableKeyProducts, type NarrativeBlock } from "@/app/(app)/estimator/narrative";
import { rewardPointsAppliedLabel } from "@/lib/rewards/points";
import { COVER_TEXT_MAX, cleanPlainText, effectiveDiscipline, type ScopeDiscipline } from "./fields";

/**
 * #301 slice A — what the cover PDF prints, from the customer document's own
 * props (QuoteDocumentProps — R20). Pure and client-safe: the narrative
 * column's source chip and the cover builder share coverParagraphFor.
 *
 * A scope is a system the document prints (systemPrintsInBody — the same set
 * and order as QuoteDocument's bands, D-a); its price is systemSellTotal
 * (freight, a typed sell and $25 rounding inside). Nothing re-prices. R1:
 * Σ scope prices − t.credit = t.grand (tax is 0).
 */

export const MISSING_COVER = "[needs a paragraph]";
export const LABOR_COVER = "Installation, commissioning & project management.";

export type CoverSource = "override" | "intro" | "key-product" | "labor" | "missing";
export const COVER_SOURCE_LABEL: Record<CoverSource, string> = {
  override: "Override",
  intro: "From intro",
  "key-product": "From key product",
  labor: "Labor wording",
  missing: "Needs a paragraph",
};
export type CoverParagraph = { text: string; source: CoverSource };

function firstParagraph(blocks: NarrativeBlock[]): string {
  const b = blocks.find((x) => x.kind === "p");
  return b && b.kind === "p" ? b.lines.map((l) => l.trim()).filter(Boolean).join(" ") : "";
}

/** D-d: the override, else the intro's first paragraph, else (labor) the
 *  labor wording, else the first key product's first paragraph, else the
 *  visible placeholder — never blocking. */
export function coverParagraphFor(sec: SpecSection): CoverParagraph {
  const o = cleanPlainText(sec.coverText, COVER_TEXT_MAX);
  if (o) return { text: o, source: "override" };
  const intro = firstParagraph(narrativeBlocks(sec.narrative));
  if (intro) return { text: intro, source: "intro" };
  if (sec.kind === "labor") return { text: LABOR_COVER, source: "labor" };
  const kp = printableKeyProducts(sec)[0];
  const kpText = kp ? firstParagraph(kp.blocks) : "";
  if (kpText) return { text: kpText, source: "key-product" };
  return { text: MISSING_COVER, source: "missing" };
}

export type OutputScope = {
  id: string;
  num: number;
  name: string;
  isLabor: boolean;
  discipline: ScopeDiscipline | null;
  price: number;
  clientGoals: string;
  cover: CoverParagraph;
};

export function outputScopes(p: Pick<QuoteDocumentProps, "sections">): OutputScope[] {
  return (p.sections || []).filter(systemPrintsInBody).map((sec, i) => ({
    id: sec.id,
    num: i + 1,
    name: sec.name || "",
    isLabor: sec.kind === "labor",
    discipline: effectiveDiscipline(sec),
    price: systemSellTotal(sec),
    clientGoals: (sec.clientGoals || "").trim(),
    cover: coverParagraphFor(sec),
  }));
}

export type AddOption = { num: number; label: string; desc: string; reason: string; sectionName: string; price: number };

/** D-f: every option line in document order (all systems, as QuoteDocument's
 *  Optional additions box), only when the quote's Options toggle is on. */
export function addOptions(p: Pick<QuoteDocumentProps, "sections" | "pdfOptions">): AddOption[] {
  if (!p.pdfOptions) return [];
  const out: AddOption[] = [];
  for (const sec of p.sections || []) {
    for (const it of sec.items || []) {
      if (!it || !it.option) continue;
      const num = out.length + 1;
      out.push({ num, label: `ADD OPTION ${num}`, desc: it.desc || "", reason: (it.comment || "").trim(), sectionName: sec.name || "", price: lineExtSellOf(it) });
    }
  }
  return out;
}

export type CoverTotals = { credit: number; creditLabel: string | null; totalLabel: string; total: number; rewardsLine: string; standingLines: string[] };

/** R1: the totals lines exactly where QuoteDocument prints them. */
export function coverTotals(p: Pick<QuoteDocumentProps, "t" | "sections" | "isPortalCatalog" | "rewardsLine" | "standingLines">): CoverTotals {
  const credit = p.t.credit || 0;
  const anyPor = !!p.isPortalCatalog && (p.sections || []).some((sec) => sec.items.some((it) => !it.option && it.por));
  return {
    credit,
    creditLabel: credit > 0 ? rewardPointsAppliedLabel(credit) : null,
    totalLabel: anyPor ? "Total (excludes items pending price)" : "Total",
    total: p.t.grand,
    rewardsLine: (p.rewardsLine || "").trim(),
    standingLines: (p.standingLines || []).map((l) => l.trim()).filter(Boolean),
  };
}

/** One item per line; list markers and trailing ; / . stripped; blanks and repeats dropped. */
export function notIncludedItems(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const item = raw.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, "").trim().replace(/[;.]+$/, "").trim();
    if (!item) continue;
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.slice(0, 40);
}

/** "Not included: a; b; c." — or "" when there is nothing. */
export function notIncludedLine(text: string | null | undefined): string {
  const items = notIncludedItems(text);
  return items.length ? `Not included: ${items.join("; ")}.` : "";
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/** The typed summary, else "This estimate includes N scopes: A, B and C." (D-e). */
export function coverSummaryText(summary: string | null | undefined, names: string[]): string {
  const s = (summary || "").trim();
  if (s) return s;
  const n = names.map((x) => x.trim()).filter(Boolean);
  if (!n.length) return "";
  return `This estimate includes ${n.length} scope${n.length === 1 ? "" : "s"}: ${listNames(n)}.`;
}

/** "Lighting scope" (a name already ending in "scope" is kept). */
export function scopePriceLabel(name: string): string {
  const n = (name || "").trim() || "System";
  return /\bscope$/i.test(n) ? n : `${n} scope`;
}
```

- [ ] **Step 4: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + this block; eslint on
  `src/lib/estimate-output/scopes.ts` clean).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/estimate-output/scopes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice A — pure scopes: cover paragraph rule, add options, totals lines, Not included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Survey Client goals

**Files:**
- Create: `src/lib/estimate-output/goals.ts`, `src/lib/estimate-output/survey-goals-server.ts`,
  `src/app/(app)/estimator/output-actions.ts`
- Modify: `src/app/(app)/venue-assessments/[id]/sections/systems.tsx` (inside `SystemsSection`'s return, before
  `<label style={labelStyle}>Present</label>`)
- Modify: `src/app/(app)/venue-assessments/[id]/actions.ts` (`saveSurvey` `:106`, `advanceSurveyStage`)
- Test: harness block `#301 slice A — goals`; `e301GoalsAsyncChecks`

**Interfaces:**
- **Consumes:** `CLIENT_GOALS_MAX`, `DISCIPLINES`, `DISCIPLINE_LABEL`, `cleanPlainText`, `effectiveDiscipline`,
  `ScopeDiscipline` (Task 1); `get`, `getAll` (`@/lib/stores/surveys`); `get` (`@/lib/stores/quotes`); `requireUser`.
- **Produces** (Task 4):
  - `goals.ts`: `type DisciplineGoals = Partial<Record<ScopeDiscipline, string>>`;
    `sanitizeSurveyDisciplineGoals(disciplines: unknown): unknown`;
    `withSanitizedSurveyGoals<T extends object>(patch: T): T` (a plain `object` bound — a weak-type bound would reject a patch with no `disciplines` key);
    `goalsFromSurvey(s: { disciplines?: unknown } | null | undefined): DisciplineGoals`;
    `fillClientGoals(sections: SpecSection[], goals: DisciplineGoals): SpecSection[]` (same array when nothing changes);
    `type SiteVisitSurvey = { id: string; venue?: string; customer?: string; customerId?: string | null; leadId?: string | null; updatedAt?: number; disciplines?: unknown }`;
    `type SiteVisitEntry = { discipline: ScopeDiscipline; label: string; text: string }`;
    `type SiteVisitOption = { surveyId: string; label: string; entries: SiteVisitEntry[] }`;
    `siteVisitOptions(surveys: SiteVisitSurvey[], ctx: { leadId?: string | null; customerId?: string | null }, limit?: number): SiteVisitOption[]`.
  - `survey-goals-server.ts`: `surveyGoalsFor(surveyId: string): Promise<{ goals: DisciplineGoals; label: string } | null>`;
    `siteVisitGoalsFor(input: { quoteId?: string | null; customerId?: string | null }): Promise<SiteVisitOption[]>`.
  - `output-actions.ts`: `surveyGoalsAction(surveyId: string): Promise<{ ok: true; goals: DisciplineGoals; label: string } | { ok: false; error: string }>`;
    `siteVisitGoalsAction(input: { quoteId: string | null; customerId: string | null }): Promise<{ ok: true; options: SiteVisitOption[] } | { ok: false; error: string }>`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice A — goals: the survey's per-discipline Client goals, cleaned
   on save, copied into matching blank systems, and the From site visit list.
   ====================================================================== */
import {
  sanitizeSurveyDisciplineGoals as e301gSan, withSanitizedSurveyGoals as e301gWith, goalsFromSurvey as e301gFrom,
  fillClientGoals as e301gFill, siteVisitOptions as e301gOptions,
} from "@/lib/estimate-output/goals";
import type { SpecSection as E301gSec } from "@/app/(app)/estimator/types";
{
  const disc = { lighting: { goals: "  Even wash \r\n  ", present: ["Dimmers"] }, av: { goals: 7 }, rigging: { notes: "n" }, curtain: "junk" };
  const clean = e301gSan(disc) as Record<string, Record<string, unknown>>;
  ok(clean.lighting.goals === "Even wash" && (clean.lighting.present as string[])[0] === "Dimmers" && !("goals" in clean.av) && clean.rigging.notes === "n" && (clean as Record<string, unknown>).curtain === "junk",
    "#301 goals: survey goals trimmed; a non-string goals key dropped; every other field untouched");
  ok(((e301gSan({ lighting: { goals: "x".repeat(1200) } }) as Record<string, { goals: string }>).lighting.goals.length) === 1000, "#301 goals: capped at 1,000");
  const patch = { notes: "n" };
  ok(e301gWith(patch) === patch && (e301gWith({ disciplines: { av: { goals: " a " } } }).disciplines as Record<string, { goals: string }>).av.goals === "a",
    "#301 goals: a patch without disciplines passes through; one with them is cleaned");
  const g = e301gFrom({ disciplines: { lighting: { goals: " Even wash " }, rigging: { goals: "" }, av: { goals: "Clear speech" }, other: { goals: "x" } } });
  ok(g.lighting === "Even wash" && g.av === "Clear speech" && !("rigging" in g) && !("other" in g) && Object.keys(e301gFrom(null)).length === 0,
    "#301 goals: goalsFromSurvey reads the four disciplines only, cleaned again (R4)");

  const s = (id: string, name: string, extra: Record<string, unknown> = {}): E301gSec => ({ id, name, kind: "materials", mfr: "", freightPct: 0, items: [], ...extra }) as E301gSec;
  const secs = [s("a", "Stage lighting"), s("b", "Rigging", { clientGoals: "Kept" }), s("c", "Misc", { discipline: "av" }), s("d", "Lighting install", { kind: "labor" }), s("e", "Track")];
  const filled = e301gFill(secs, { lighting: "Even wash", rigging: "New", av: "Clear speech" });
  ok(filled[0].clientGoals === "Even wash" && filled[1].clientGoals === "Kept" && filled[2].clientGoals === "Clear speech" && !filled[3].clientGoals && !filled[4].clientGoals,
    "#301 goals: fills only blank goals on systems whose discipline (stored, else inferred) matches; labor and unknown never (R3)");
  ok(e301gFill(secs, {}) === secs && e301gFill([s("b", "Rigging", { clientGoals: "Kept" })], { rigging: "New" }).length === 1, "#301 goals: nothing to fill → the same array (no dirty state)");

  const sv = (id: string, at: number, extra: Record<string, unknown>) => ({ id, venue: "Hall " + id, customer: "C", updatedAt: at, ...extra });
  const list = [
    sv("FS-1", 1_000, { customerId: "c1", disciplines: { lighting: { goals: "L1" } } }),
    sv("FS-2", 5_000, { leadId: "L-9", customerId: "other", disciplines: { av: { goals: "A2" }, lighting: { goals: "L2" } } }),
    sv("FS-3", 3_000, { customerId: "c1", disciplines: { rigging: { goals: "" } } }),
    sv("FS-4", 4_000, { customerId: "c2", disciplines: { lighting: { goals: "X" } } }),
    ...[5, 6, 7, 8, 9, 10].map((n) => sv("FS-" + n, n * 10_000, { customerId: "c1", disciplines: { curtain: { goals: "C" + n } } })),
  ];
  const o = e301gOptions(list, { leadId: "L-9", customerId: "c1" });
  ok(o.length === 5 && o.every((x) => x.surveyId !== "FS-3" && x.surveyId !== "FS-4") && o[0].surveyId === "FS-10",
    "#301 site visit: the lead's + the customer's visits with goals, newest five; other customers and goal-less visits never");
  const fs2 = e301gOptions(list, { leadId: "L-9" })[0];
  ok(fs2.surveyId === "FS-2" && fs2.entries.map((e) => `${e.discipline}:${e.label}:${e.text}`).join("|") === "lighting:Lighting:L2|av:AV:A2" && fs2.label.startsWith("Hall FS-2 · "),
    "#301 site visit: entries in discipline order with labels; the option label names the venue and date");
  ok(e301gOptions(list, {}).length === 0, "#301 site visit: no lead and no customer → nothing");

  const acts = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/[id]/actions.ts"), "utf8");
  const saveBody = acts.slice(acts.indexOf("export async function saveSurvey("), acts.indexOf("export async function printSurveySheet("));
  const advBody = acts.slice(acts.indexOf("export async function advanceSurveyStage("), acts.indexOf("export async function deleteSurvey("));
  ok(saveBody.includes("await update(id, withSanitizedSurveyGoals(patch) as Partial<SurveyRecord>);") && advBody.includes("await update(id, withSanitizedSurveyGoals(patch) as Partial<SurveyRecord>);"),
    "#301 goals: saveSurvey and advanceSurveyStage clean the goals before writing (R4)");
  const box = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/[id]/sections/systems.tsx"), "utf8");
  ok(box.includes(">Client goals</label>") && box.includes('placeholder="What is the client trying to solve?"') && box.includes('props.setValue(group.key, "goals", event.target.value)') &&
     box.indexOf(">Client goals</label>") < box.indexOf(">Present</label>"), "#301 goals: the box sits at the top of each discipline section (inside its lock)");
  const oa = readFileSync(join(process.cwd(), "src/app/(app)/estimator/output-actions.ts"), "utf8");
  ok(/^"use server";/.test(oa) && (oa.match(/await requireUser\(\);/g) || []).length === 2 && oa.includes("export async function surveyGoalsAction(") && oa.includes("export async function siteVisitGoalsAction("),
    "#301 goals: the two actions are signed-in only");
}

async function e301GoalsAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const S = await import("@/lib/stores/surveys");
  const Q = await import("@/lib/stores/quotes");
  const { surveyGoalsFor, siteVisitGoalsFor } = await import("@/lib/estimate-output/survey-goals-server");
  const CID = fixtureId(301, "goals-cust");
  const A = fixtureId(301, "goals-a");
  const B = fixtureId(301, "goals-b");
  const QID = fixtureId(301, "goals-quote");
  await S.create({ id: A, customer: "Spec fixture", customerId: CID, venue: "Main hall", disciplines: { lighting: { goals: "  Even wash  " }, av: { goals: "x".repeat(1200) } } });
  registerFixture("surveys", A);
  await S.create({ id: B, customer: "Spec fixture", customerId: CID, venue: "Annex", disciplines: { rigging: { goals: "" } } });
  registerFixture("surveys", B);
  const one = await surveyGoalsFor(A);
  ok(one?.label === "Main hall" && one.goals.lighting === "Even wash" && one.goals.av?.length === 1000, "#301 goals: surveyGoalsFor cleans what it copies (the push path never sanitized it)");
  ok((await surveyGoalsFor(fixtureId(301, "goals-none"))) === null, "#301 goals: an unknown survey → null");
  const byCust = await siteVisitGoalsFor({ customerId: CID });
  ok(byCust.length === 1 && byCust[0].surveyId === A, "#301 site visit: the customer's visits with goals (a goal-less visit is left out)");
  await Q.create({ id: QID, name: "#301 goals", customer: "Spec fixture", customerId: CID, owner: "spec", quoteType: "system" });
  registerFixture("quotes", QID);
  const byQuote = await siteVisitGoalsFor({ quoteId: QID, customerId: "someone-else" });
  ok(byQuote.length === 1 && byQuote[0].surveyId === A, "#301 site visit: a saved quote's own customer wins over the posted one");
  ok((await siteVisitGoalsFor({})).length === 0, "#301 site visit: nothing to match → empty");
}
```

  Append `await e301GoalsAsyncChecks();` as the last line of `estimateOutput301AAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails** (module not found `@/lib/estimate-output/goals`).

- [ ] **Step 3: Create `src/lib/estimate-output/goals.ts`.**

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import { CLIENT_GOALS_MAX, DISCIPLINES, DISCIPLINE_LABEL, cleanPlainText, effectiveDiscipline, type ScopeDiscipline } from "./fields";

/**
 * #301 slice A — the site visit's Client goals (survey `disciplines[key].goals`)
 * and how they reach a quote's systems (R3, R4). Pure and client-safe.
 */

export type DisciplineGoals = Partial<Record<ScopeDiscipline, string>>;

/** R4: each discipline's `goals` cleaned (trimmed, ≤ 1,000); a blank or
 *  non-string one removed; every other field and key untouched. */
export function sanitizeSurveyDisciplineGoals(disciplines: unknown): unknown {
  if (!disciplines || typeof disciplines !== "object" || Array.isArray(disciplines)) return disciplines;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(disciplines as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v) || !("goals" in v)) {
      out[k] = v;
      continue;
    }
    const d = { ...(v as Record<string, unknown>) };
    const g = cleanPlainText(d.goals, CLIENT_GOALS_MAX);
    if (g) d.goals = g;
    else delete d.goals;
    out[k] = d;
  }
  return out;
}

/** The survey save rule: a patch carrying `disciplines` gets them cleaned. */
export function withSanitizedSurveyGoals<T extends object>(patch: T): T {
  if (!patch || typeof patch !== "object" || !("disciplines" in patch)) return patch;
  return { ...patch, disciplines: sanitizeSurveyDisciplineGoals((patch as { disciplines?: unknown }).disciplines) } as T;
}

/** The four disciplines' goals, cleaned again (the sync push path has no sanitizer — R4). */
export function goalsFromSurvey(s: { disciplines?: unknown } | null | undefined): DisciplineGoals {
  const out: DisciplineGoals = {};
  const d = s && s.disciplines && typeof s.disciplines === "object" ? (s.disciplines as Record<string, unknown>) : {};
  for (const k of DISCIPLINES) {
    const branch = d[k];
    const g = branch && typeof branch === "object" ? cleanPlainText((branch as Record<string, unknown>).goals, CLIENT_GOALS_MAX) : "";
    if (g) out[k] = g;
  }
  return out;
}

/** R3: blank goals on a system whose discipline (stored, else inferred)
 *  matches get the visit's goals. Returns the SAME array when nothing changes. */
export function fillClientGoals(sections: SpecSection[], goals: DisciplineGoals): SpecSection[] {
  let changed = false;
  const out = sections.map((sec) => {
    if (!sec || (sec.clientGoals || "").trim()) return sec;
    const d = effectiveDiscipline(sec);
    const g = d ? goals[d] : undefined;
    if (!g) return sec;
    changed = true;
    return { ...sec, clientGoals: g };
  });
  return changed ? out : sections;
}

export type SiteVisitSurvey = {
  id: string;
  venue?: string;
  customer?: string;
  customerId?: string | null;
  leadId?: string | null;
  updatedAt?: number;
  disciplines?: unknown;
};
export type SiteVisitEntry = { discipline: ScopeDiscipline; label: string; text: string };
export type SiteVisitOption = { surveyId: string; label: string; entries: SiteVisitEntry[] };

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

/** From site visit (R3): the lead's visits + the customer's visits that have
 *  any goals, newest first, at most `limit`. */
export function siteVisitOptions(
  surveys: SiteVisitSurvey[],
  ctx: { leadId?: string | null; customerId?: string | null },
  limit = 5
): SiteVisitOption[] {
  const leadId = ctx.leadId || null;
  const customerId = ctx.customerId || null;
  if (!leadId && !customerId) return [];
  return surveys
    .filter((s) => !!s && ((leadId && s.leadId === leadId) || (customerId && s.customerId === customerId)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => {
      const g = goalsFromSurvey(s);
      const entries = DISCIPLINES.filter((k) => !!g[k]).map((k) => ({ discipline: k, label: DISCIPLINE_LABEL[k], text: g[k] as string }));
      return { surveyId: s.id, label: `${s.venue || s.customer || s.id} · ${shortDate(s.updatedAt || 0)}`, entries };
    })
    .filter((o) => o.entries.length > 0)
    .slice(0, limit);
}
```

- [ ] **Step 4: Create `src/lib/estimate-output/survey-goals-server.ts`.**

```ts
import { get as getSurvey, getAll as allSurveys } from "@/lib/stores/surveys";
import { get as getQuote } from "@/lib/stores/quotes";
import { goalsFromSurvey, siteVisitOptions, type DisciplineGoals, type SiteVisitOption } from "./goals";

/**
 * #301 slice A — server lookups behind the Estimator's goals pre-fill (R3).
 * Read-only. A saved quote's own lead and customer win over anything posted.
 */

export async function surveyGoalsFor(surveyId: string): Promise<{ goals: DisciplineGoals; label: string } | null> {
  const s = await getSurvey(surveyId);
  if (!s) return null;
  return { goals: goalsFromSurvey(s), label: s.venue || s.customer || s.id };
}

export async function siteVisitGoalsFor(input: { quoteId?: string | null; customerId?: string | null }): Promise<SiteVisitOption[]> {
  const q = input.quoteId ? await getQuote(input.quoteId) : null;
  const leadId = q?.leadId ?? null;
  const customerId = q ? q.customerId ?? null : typeof input.customerId === "string" && input.customerId ? input.customerId : null;
  if (!leadId && !customerId) return [];
  return siteVisitOptions(await allSurveys(), { leadId, customerId });
}
```

- [ ] **Step 5: Create `src/app/(app)/estimator/output-actions.ts`.**

```ts
"use server";

import { requireUser } from "@/lib/session";
import { siteVisitGoalsFor, surveyGoalsFor } from "@/lib/estimate-output/survey-goals-server";
import type { DisciplineGoals, SiteVisitOption } from "@/lib/estimate-output/goals";

/**
 * #301 slice A — the Estimator's site-visit goals (R3). Signed-in only; reads
 * only. A missing record answers with a message, never a throw.
 */

const ID_MAX = 64;

export async function surveyGoalsAction(
  surveyId: string
): Promise<{ ok: true; goals: DisciplineGoals; label: string } | { ok: false; error: string }> {
  await requireUser();
  const id = typeof surveyId === "string" ? surveyId.trim().slice(0, ID_MAX) : "";
  if (!id) return { ok: false, error: "No site visit is linked." };
  const r = await surveyGoalsFor(id);
  if (!r) return { ok: false, error: "That site visit no longer exists." };
  return { ok: true, goals: r.goals, label: r.label };
}

export async function siteVisitGoalsAction(input: {
  quoteId: string | null;
  customerId: string | null;
}): Promise<{ ok: true; options: SiteVisitOption[] } | { ok: false; error: string }> {
  await requireUser();
  const o = input && typeof input === "object" ? input : { quoteId: null, customerId: null };
  const quoteId = typeof o.quoteId === "string" && o.quoteId ? o.quoteId.slice(0, ID_MAX) : null;
  const customerId = typeof o.customerId === "string" && o.customerId ? o.customerId.slice(0, ID_MAX) : null;
  return { ok: true, options: await siteVisitGoalsFor({ quoteId, customerId }) };
}
```

- [ ] **Step 6: The survey box.** In `src/app/(app)/venue-assessments/[id]/sections/systems.tsx`, inside `SystemsSection`'s
  returned `<div>`, as its **first child** (before the venue-class guidance block and `<label style={labelStyle}>Present</label>`):

```tsx
      {/* #301: the client's goals for this discipline — copied into the matching
          scope of the quote (Estimator → narrative column → Client goals). Inside
          the discipline section, so it inherits the kill-question lock. */}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Client goals</label>
        <textarea
          value={String(props.value(group.key, "goals") || "")}
          onChange={(event) => props.setValue(group.key, "goals", event.target.value)}
          maxLength={1000}
          placeholder="What is the client trying to solve?"
          style={taStyle}
        />
      </div>
```

- [ ] **Step 7: Clean goals on the survey saves.** In `src/app/(app)/venue-assessments/[id]/actions.ts`:
  import `import { withSanitizedSurveyGoals } from "@/lib/estimate-output/goals";`, and in **both** `saveSurvey` and
  `advanceSurveyStage` replace `await update(id, patch as Partial<SurveyRecord>);` with:

```ts
  // #301 (R4): Client goals are trimmed and capped (≤ 1,000) on the way in.
  await update(id, withSanitizedSurveyGoals(patch) as Partial<SurveyRecord>);
```

- [ ] **Step 8: Run the gates** (tsc; test:specs; eslint on the five files; `next build` — `systems.tsx` is a client
  component). Expected all clean; build OK.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/estimate-output/goals.ts src/lib/estimate-output/survey-goals-server.ts "src/app/(app)/estimator/output-actions.ts" "src/app/(app)/venue-assessments/[id]/sections/systems.tsx" "src/app/(app)/venue-assessments/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice A — site-visit Client goals per discipline, cleaned on save, goal lookups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Estimator authoring — discipline, client goals, cover paragraph

**Files:**
- Create: `src/app/(app)/estimator/scope-output-fields.tsx`
- Modify: `src/app/(app)/estimator/section-card.tsx` (props type near `onSetPresentation` `:125`; the per-system controls row
  `:446-449`)
- Modify: `src/app/(app)/estimator/narrative-column.tsx` (props; mount before `<div style={LABEL}>Intro</div>`; button
  under the intro hint)
- Modify: `src/app/(app)/estimator/estimator-client.tsx` (imports; `<SectionCard` `:3838`; `<NarrativeColumn` `:4019`; the
  pre-fill effect next to `runAiDraft` `:1841`)
- Test: harness block `#301 slice A — authoring UI`

**Interfaces:**
- **Consumes:** `DISCIPLINES`, `DISCIPLINE_LABEL`, `CLIENT_GOALS_MAX`, `COVER_TEXT_MAX`, `autoDisciplineLabel`, `withDiscipline`,
  `appendGoals`, `coverTextFromSelection`, `ScopeDiscipline` (Task 1); `COVER_SOURCE_LABEL`, `MISSING_COVER`,
  `coverParagraphFor`, `CoverSource` (Task 2); `fillClientGoals`, `SiteVisitOption` (Task 3); `surveyGoalsAction`,
  `siteVisitGoalsAction` (Task 3).
- **Produces:** `ScopeOutputFields` (default export) with props
  `{ sec: SpecSection; onChange: (fn: (s: SpecSection) => SpecSection) => void; quoteId: string | null; customerId: string | null }`;
  `SectionCardProps.onSetDiscipline: (value: ScopeDiscipline | "") => void`;
  `NarrativeColumnProps.quoteId: string | null`, `.customerId: string | null`.

- [ ] **Step 1: Write the failing harness block** (client wiring by source). Append:

```ts
/* ======================================================================
   #301 slice A — authoring UI: the Discipline select, the narrative
   column's Client goals / From site visit / Cover paragraph, Use selection
   as cover, and the load-time goals pre-fill (client wiring, by source).
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const serverImport = (s: string) => /^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/session|lib\/blob|lib\/users|lib\/settings|lib\/estimate-output\/(cover-loader|survey-goals-server))/m.test(s);
  const fields = rd("src/app/(app)/estimator/scope-output-fields.tsx");
  const col = rd("src/app/(app)/estimator/narrative-column.tsx");
  const card = rd("src/app/(app)/estimator/section-card.tsx");
  const cli = rd("src/app/(app)/estimator/estimator-client.tsx");
  ok(/^"use client";/.test(fields) && !serverImport(fields) && !serverImport(col) && !serverImport(card) && !serverImport(cli),
    "#301 UI: the new block and every edited estimator client module value-import no store, db, session, users, settings or estimate-output server module");
  ok(fields.includes(">Client goals<") && fields.includes("From site visit ▾") && fields.includes("Add the client's goals") && fields.includes("siteVisitGoalsAction(") &&
     fields.includes("No site-visit goals for this customer yet.") && fields.includes("appendGoals(s.clientGoals, text)"),
    "#301 UI: Client goals with From site visit (lazy, appends) and the amber blank hint");
  ok(fields.includes(">Cover paragraph<") && fields.includes("coverParagraphFor(") && fields.includes("COVER_SOURCE_LABEL[") && fields.includes("Clear override") && fields.includes("maxLength={COVER_TEXT_MAX}"),
    "#301 UI: the Cover paragraph override with its derived placeholder and source chip");
  ok(/try \{[\s\S]{0,200}await siteVisitGoalsAction\(/.test(fields) && fields.includes('"Could not reach the server. Try again."'), "#301 UI: the action await is caught");
  ok(col.includes("<ScopeOutputFields") && col.indexOf("<ScopeOutputFields") < col.indexOf("<div style={LABEL}>Intro</div>") && col.includes("Use selection as cover") &&
     col.includes("coverTextFromSelection(") && col.includes("Select a sentence in the intro first.") && col.includes("onMouseDown={(e) => e.preventDefault()}"),
    "#301 UI: the column mounts the fields above the intro; Use selection as cover keeps the selection");
  ok(card.includes("onSetDiscipline: (value: ScopeDiscipline | \"\") => void;") && card.includes('aria-label="Discipline"') && card.includes("autoDisciplineLabel(sec.name)") && card.includes('sec.kind !== "labor"'),
    "#301 UI: the system header's Discipline select (blank = auto, hidden on labor systems)");
  ok(cli.includes("onSetDiscipline={(value) => updateSection(sec.id, (s) => withDiscipline(s, value))}") && /<NarrativeColumn\s+key=\{narrSec\.id\}/.test(cli) &&
     cli.includes("quoteId={loadedId}") && cli.includes("customerId={customerId}"), "#301 UI: the select and the column are wired");
  const effect = cli.slice(cli.indexOf("const goalsSurveyId ="), cli.indexOf("const goalsSurveyId =") + 700);
  ok(effect.includes('aiSource?.kind === "survey"') && effect.includes("surveyGoalsAction(goalsSurveyId)") && effect.includes("setSectionsState((prev) => fillClientGoals(prev, r.goals))") && effect.includes(".catch("),
    "#301 UI: a page opened from a site visit pre-fills matching blank goals once, automatically (R3)");
}
```

- [ ] **Step 2: Run it to verify it fails** (`readFileSync` ENOENT on `scope-output-fields.tsx`).

- [ ] **Step 3: Create `src/app/(app)/estimator/scope-output-fields.tsx`.**

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import type { SpecSection } from "./types";
import { CLIENT_GOALS_MAX, COVER_TEXT_MAX, appendGoals } from "@/lib/estimate-output/fields";
import { COVER_SOURCE_LABEL, MISSING_COVER, coverParagraphFor, type CoverSource } from "@/lib/estimate-output/scopes";
import type { SiteVisitOption } from "@/lib/estimate-output/goals";
import { siteVisitGoalsAction } from "./output-actions";

/**
 * #301 slice A — the active system's output fields in the narrative column:
 * Client goals (+ From site visit) and the Cover paragraph override. Every
 * edit goes through `onChange(fn)` → the Estimator's setSections, like the
 * rest of the column. Nothing here blocks: a blank shows a hint.
 */

export type ScopeOutputFieldsProps = {
  sec: SpecSection;
  onChange: (fn: (s: SpecSection) => SpecSection) => void;
  /** The saved quote id (null before the first Save) — its lead and customer find the visits. */
  quoteId: string | null;
  customerId: string | null;
};

const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase" };
const HINT: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.4 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" };
const TA: CSSProperties = { width: "100%", resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" };
const FAILED = "Could not reach the server. Try again.";
const SOURCE_TONE: Record<CoverSource, CSSProperties> = {
  override: { background: "#eef0f3", color: "#3a3f4a" },
  intro: { background: "#e7f4ee", color: "#1f7a52" },
  "key-product": { background: "#e7f4ee", color: "#1f7a52" },
  labor: { background: "#f1f2f5", color: "#8c919c" },
  missing: { background: "#fbf3dd", color: "#8a6d1f" },
};

type Menu = null | { state: "loading" } | { state: "ready"; options: SiteVisitOption[] } | { state: "error"; error: string };

export default function ScopeOutputFields(p: ScopeOutputFieldsProps) {
  const { sec } = p;
  const [menu, setMenu] = useState<Menu>(null);
  const [, start] = useTransition();
  const cover = coverParagraphFor(sec);
  const derived = coverParagraphFor({ ...sec, coverText: "" });
  const goals = sec.clientGoals || "";
  const isLabor = sec.kind === "labor";

  const openMenu = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    setMenu({ state: "loading" });
    start(async () => {
      try {
        const r = await siteVisitGoalsAction({ quoteId: p.quoteId, customerId: p.customerId });
        setMenu(r.ok ? { state: "ready", options: r.options } : { state: "error", error: r.error });
      } catch {
        setMenu({ state: "error", error: FAILED });
      }
    });
  };
  const pickGoals = (text: string) => {
    p.onChange((s) => ({ ...s, clientGoals: appendGoals(s.clientGoals, text) }));
    setMenu(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {!isLabor && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={LABEL}>Client goals</div>
            <div style={{ position: "relative" }}>
              <button type="button" style={BTN} aria-haspopup="menu" aria-expanded={!!menu} onClick={openMenu} title="Copy the client's goals from a site visit">
                From site visit ▾
              </button>
              {menu && (
                <div role="menu" style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, width: 280, maxHeight: 320, overflowY: "auto", background: "#fff", border: "1px solid #ececf0", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.1)", padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {menu.state === "loading" && <div style={HINT}>Loading…</div>}
                  {menu.state === "error" && <div style={{ ...HINT, color: "#b4543a" }}>{menu.error}</div>}
                  {menu.state === "ready" && menu.options.length === 0 && <div style={HINT}>No site-visit goals for this customer yet.</div>}
                  {menu.state === "ready" &&
                    menu.options.map((o) => (
                      <div key={o.surveyId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ ...HINT, fontWeight: 600, color: "#3a3f4a" }}>{o.label}</div>
                        {o.entries.map((e) => (
                          <button
                            key={e.discipline}
                            type="button"
                            role="menuitem"
                            style={{ ...BTN, background: "transparent", textAlign: "left", fontWeight: 500, whiteSpace: "normal" }}
                            onClick={() => pickGoals(e.text)}
                          >
                            <strong>{e.label}</strong> — {e.text.length > 90 ? e.text.slice(0, 90) + "…" : e.text}
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
          <textarea
            className="est-field"
            aria-label={"Client goals for " + (sec.name || "this system")}
            value={goals}
            maxLength={CLIENT_GOALS_MAX}
            placeholder="What is the client trying to solve?"
            onChange={(e) => {
              const v = e.target.value;
              p.onChange((s) => ({ ...s, clientGoals: v }));
            }}
            style={{ ...TA, minHeight: 64 }}
          />
          {!goals.trim() && <div style={{ ...HINT, color: "#8a6d1f" }}>Add the client&apos;s goals</div>}
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <div style={LABEL}>Cover paragraph</div>
        <span style={{ ...SOURCE_TONE[cover.source], fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
          {COVER_SOURCE_LABEL[cover.source]}
        </span>
      </div>
      <textarea
        className="est-field"
        aria-label={"Cover paragraph for " + (sec.name || "this system")}
        value={sec.coverText || ""}
        maxLength={COVER_TEXT_MAX}
        placeholder={derived.source === "missing" ? MISSING_COVER : derived.text}
        onChange={(e) => {
          const v = e.target.value;
          p.onChange((s) => ({ ...s, coverText: v }));
        }}
        style={{ ...TA, minHeight: 64 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={HINT}>Blank prints the intro&apos;s first paragraph on the cover PDF.</span>
        {!!(sec.coverText || "").trim() && (
          <button type="button" style={BTN} onClick={() => p.onChange((s) => ({ ...s, coverText: "" }))}>
            Clear override
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The narrative column.** In `src/app/(app)/estimator/narrative-column.tsx`:

  (a) Imports — add:

```ts
import ScopeOutputFields from "./scope-output-fields";
import { coverTextFromSelection } from "@/lib/estimate-output/fields";
```

  (b) `NarrativeColumnProps` — add after `onIntros`:

```ts
  /** #301: the saved quote id and its customer — From site visit finds the visits. */
  quoteId: string | null;
  customerId: string | null;
```

  (c) Inside `NarrativeColumn`, after the `applyMerge` function, add:

```ts
  /** #301: "Use selection as cover" — the intro's selected text becomes this
   *  system's cover paragraph (D-d's "flag a sentence"). The button keeps the
   *  textarea's selection (onMouseDown preventDefault). */
  const applySelectionAsCover = () => {
    const el = narrRef.current;
    const text = el ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : "";
    const clean = coverTextFromSelection(text);
    if (!clean) {
      setNotice("Select a sentence in the intro first.");
      return;
    }
    p.onChange((s) => ({ ...s, coverText: clean }));
    setNotice("Cover paragraph set from the selection.");
  };
```

  (d) Immediately **before** `<div style={LABEL}>Intro</div>` insert:

```tsx
      <ScopeOutputFields sec={sec} onChange={p.onChange} quoteId={p.quoteId} customerId={p.customerId} />
```

  (e) Replace the line `<div style={HINT}>Blank line = new paragraph · start a line with “- ” for a bullet</div>` with:

```tsx
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <div style={HINT}>Blank line = new paragraph · start a line with “- ” for a bullet</div>
        <button
          type="button"
          style={BTN}
          onMouseDown={(e) => e.preventDefault()}
          onClick={applySelectionAsCover}
          title="Copy the selected intro text into this system's cover paragraph"
        >
          Use selection as cover
        </button>
      </div>
```

- [ ] **Step 5: The Discipline select.** In `src/app/(app)/estimator/section-card.tsx`:

  (a) Imports — add:

```ts
import { DISCIPLINES, DISCIPLINE_LABEL, autoDisciplineLabel, type ScopeDiscipline } from "@/lib/estimate-output/fields";
```

  (b) `SectionCardProps` — right after `onSetPresentation: (value: "itemized" | "narrative") => void;` add:

```ts
  /** #301: the survey discipline this system answers ("" = auto, inferred from the name). */
  onSetDiscipline: (value: ScopeDiscipline | "") => void;
```

  (c) In the per-system controls row, right after the presentation `<select …>…</select>` (`:447-450`) add:

```tsx
              {/* #301: which site-visit discipline this system answers — matches the
                  survey's Client goals. Blank = inferred from the name (never stored). */}
              {sec.kind !== "labor" && (
                <select
                  value={sec.discipline || ""}
                  onChange={(e) => p.onSetDiscipline(e.target.value as ScopeDiscipline | "")}
                  aria-label="Discipline"
                  title="The site-visit discipline this system answers"
                  style={{ border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 11, color: "#5b616e", background: "#fff" }}
                >
                  <option value="">{autoDisciplineLabel(sec.name)}</option>
                  {DISCIPLINES.map((d) => (
                    <option key={d} value={d}>
                      {DISCIPLINE_LABEL[d]}
                    </option>
                  ))}
                </select>
              )}
```

- [ ] **Step 6: Wire it in `src/app/(app)/estimator/estimator-client.tsx`.**

  (a) Imports — add:

```ts
import { surveyGoalsAction } from "./output-actions";
import { withDiscipline } from "@/lib/estimate-output/fields";
import { fillClientGoals } from "@/lib/estimate-output/goals";
```

  (b) `<SectionCard …>` (`:3838`) — after `onSetPresentation={(value) => setSystemPresentation(sec.id, value)}` add:

```tsx
                  onSetDiscipline={(value) => updateSection(sec.id, (s) => withDiscipline(s, value))}
```

  (c) `<NarrativeColumn …>` (`:4019`) — after `onIntros={setIntros}` add:

```tsx
                    quoteId={loadedId}
                    customerId={customerId}
```

  (d) Right before `const runAiDraft = () => {` (`:1841`) add:

```ts
  /* #301 (R3): a page opened from a site visit (?surveyId=) copies that
     visit's Client goals into every system whose discipline (stored, else
     inferred) matches and whose goals are blank. Automatic, like the tier
     re-price, so it writes setSectionsState and leaves the #254 banner alone;
     fillClientGoals returns the same array when nothing matches (no dirty). */
  const goalsSurveyId = aiSource?.kind === "survey" ? aiSource.id : null;
  useEffect(() => {
    if (!goalsSurveyId) return;
    let live = true;
    surveyGoalsAction(goalsSurveyId)
      .then((r) => {
        if (live && r.ok) setSectionsState((prev) => fillClientGoals(prev, r.goals));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [goalsSurveyId]);
```

- [ ] **Step 7: Run the gates** (tsc; test:specs; eslint on `scope-output-fields.tsx`, `narrative-column.tsx`,
  `section-card.tsx`, `estimator-client.tsx`; `next build`). Expected all clean; build OK.

- [ ] **Step 8: Commit.**

```bash
git add "src/app/(app)/estimator/scope-output-fields.tsx" "src/app/(app)/estimator/narrative-column.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimator): #301 slice A — discipline select, client goals + From site visit, cover paragraph, goals pre-fill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Settings → Estimate output

**Files:**
- Create: `src/lib/stores/estimate-output-defaults.ts`, `src/app/(app)/settings/estimate-output-card.tsx`
- Modify: `src/app/(app)/settings/actions.ts` (append the action), `settings-sections.ts` (`SETTINGS_CARDS`),
  `groups/sales.tsx`, `groups/types.ts` (`SettingsData`), `settings-client.tsx` (`<SalesGroup`), `page.tsx`
- Modify: `scripts/test-review-and-spec.ts` — **three existing settings-cleanup pins** (`:41763-41779` and the `MARKER` map
  `:41785-41804`) + a new block + `e301DefaultsAsyncChecks`

**Interfaces:**
- **Consumes:** `ESTIMATE_OUTPUT_BLOB`, `EstimateOutputDefaults`, `sanitizeEstimateOutputDefaults`, `NOT_INCLUDED_MAX`,
  `WEBSITE_MAX` (Task 1); `getBlob`, `setBlob` (`@/db/doc-store`); `requirePerm`.
- **Produces** (Tasks 6, 8): `getEstimateOutputDefaults(): Promise<EstimateOutputDefaults>`;
  `saveEstimateOutputDefaults(input: unknown): Promise<EstimateOutputDefaults>`;
  `saveEstimateOutputDefaultsAction(input: { notIncluded: string; website: string }): Promise<{ ok: true; defaults: EstimateOutputDefaults } | { ok: false; error: string }>`;
  `SettingsData.estimateOutput: EstimateOutputDefaults`.

- [ ] **Step 1: Update the three settings-cleanup pins** (the spec adds a card — the one sanctioned edit of old checks):

  (a) Right after the `const OLD_CARDS = [ … ];` array, add
  `const ADDED_CARDS = ["estimateOutput"]; // #301 — Settings → Sales & Rewards → Estimate output`, and change the check
  that follows `ok(cardKeys.length === new Set(cardKeys).size, …)` to:

```ts
  ok([...OLD_CARDS, ...ADDED_CARDS].every((k) => cardKeys.filter((x) => x === k).length === 1) && cardKeys.length === OLD_CARDS.length + ADDED_CARDS.length,
    `settings cleanup: all ${OLD_CARDS.length} pre-cleanup cards (+ ${ADDED_CARDS.length} added since) are registered, each in exactly one group`);
```

  (b) In the "each group holds Jeff's cards in order" check, change
  `scCardsIn("sales").join(",") === "reviewLimits,pipelines,customerFields"` to
  `scCardsIn("sales").join(",") === "reviewLimits,pipelines,customerFields,estimateOutput"`.

  (c) In `MARKER`, after `customerFields: "<CustomerFieldsCard",` add `estimateOutput: "<EstimateOutputCard",`.

- [ ] **Step 2: Append the new harness block:**

```ts
/* ======================================================================
   #301 slice A — Settings → Sales & Rewards → Estimate output (R17): the
   default Not included list and the cover footer's website, one blob.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const card = rd("src/app/(app)/settings/estimate-output-card.tsx");
  ok(card.startsWith('"use client";') && card.includes("saveEstimateOutputDefaultsAction(") && !/from "@\/(db|lib\/stores|lib\/settings|lib\/users)"/.test(card) &&
     card.includes(">Estimate output<") && card.includes("Not included — default list") && card.includes("Website (cover footer)"),
    "#301 settings: the card is a client component over the action — no store/db/settings import");
  const acts = rd("src/app/(app)/settings/actions.ts");
  const fn = acts.slice(acts.indexOf("export async function saveEstimateOutputDefaultsAction("));
  ok(fn.includes('await requirePerm("manage_users");') && fn.includes("saveEstimateOutputDefaults(") && fn.includes('revalidatePath("/", "layout")'), "#301 settings: the save is admin-only");
  ok(rd("src/app/(app)/settings/groups/sales.tsx").includes("<EstimateOutputCard") && rd("src/app/(app)/settings/page.tsx").includes("estimateOutput={estimateOutput}"),
    "#301 settings: Sales & Rewards renders the card from the stored blob");
}

async function e301DefaultsAsyncChecks(): Promise<void> {
  const { getBlob, setBlob } = await import("@/db/doc-store");
  const D = await import("@/lib/stores/estimate-output-defaults");
  const saved = await getBlob<Record<string, unknown>>("estimate_output_defaults", {});
  try {
    const out = await D.saveEstimateOutputDefaults({ notIncluded: " Permits \n\n Painting ", website: " peaksystemsgroup.com " });
    const back = await D.getEstimateOutputDefaults();
    ok(out.notIncluded === "Permits\nPainting" && back.notIncluded === "Permits\nPainting" && back.website === "peaksystemsgroup.com", "#301 settings: the defaults round-trip cleaned");
  } finally {
    await setBlob("estimate_output_defaults", { notIncluded: saved.notIncluded ?? "", website: saved.website ?? "" });
  }
}
```

  Append `await e301DefaultsAsyncChecks();` at the end of `estimateOutput301AAsyncChecks`'s body.

- [ ] **Step 3: Run it to verify it fails** (ENOENT on `estimate-output-card.tsx`, plus the three updated pins FAIL).

- [ ] **Step 4: Create `src/lib/stores/estimate-output-defaults.ts`.**

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { ESTIMATE_OUTPUT_BLOB, sanitizeEstimateOutputDefaults, type EstimateOutputDefaults } from "@/lib/estimate-output/fields";

/**
 * #301 slice A — Settings → Estimate output (R17). One settings blob, no
 * table, no migration (the narrative_intros idiom):
 *   estimate_output_defaults   { notIncluded: string; website: string }
 * Survives the go-live demo wipe (it's a settings blob).
 */

export async function getEstimateOutputDefaults(): Promise<EstimateOutputDefaults> {
  return sanitizeEstimateOutputDefaults(await getBlob<Record<string, unknown>>(ESTIMATE_OUTPUT_BLOB, {}));
}

export async function saveEstimateOutputDefaults(input: unknown): Promise<EstimateOutputDefaults> {
  const clean = sanitizeEstimateOutputDefaults(input);
  await setBlob(ESTIMATE_OUTPUT_BLOB, clean);
  return clean;
}
```

- [ ] **Step 5: The action.** Append to `src/app/(app)/settings/actions.ts` (add the two imports at the top):

```ts
import { saveEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import type { EstimateOutputDefaults } from "@/lib/estimate-output/fields";
```

```ts
/** #301 — Settings → Sales & Rewards → Estimate output. Admin-only; the
 *  stored blob is the cleaned input (lines trimmed, blanks dropped). */
export async function saveEstimateOutputDefaultsAction(input: {
  notIncluded: string;
  website: string;
}): Promise<{ ok: true; defaults: EstimateOutputDefaults } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const o = input && typeof input === "object" ? input : { notIncluded: "", website: "" };
  const defaults = await saveEstimateOutputDefaults({ notIncluded: o.notIncluded, website: o.website });
  revalidatePath("/", "layout");
  return { ok: true, defaults };
}
```

- [ ] **Step 6: Create `src/app/(app)/settings/estimate-output-card.tsx`.**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NOT_INCLUDED_MAX, WEBSITE_MAX, type EstimateOutputDefaults } from "@/lib/estimate-output/fields";
import { saveEstimateOutputDefaultsAction } from "./actions";

/**
 * #301 — Settings → Sales & Rewards → Estimate output (R17): the Not included
 * list a new estimate starts from (Reset to default restores it) and the
 * website printed in the cover PDF's footer. The parent re-keys the card on
 * the saved value, so a save remounts it.
 */
export function EstimateOutputCard({ defaults }: { defaults: EstimateOutputDefaults }) {
  const router = useRouter();
  const [notIncluded, setNotIncluded] = useState(defaults.notIncluded);
  const [website, setWebsite] = useState(defaults.website);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = notIncluded !== defaults.notIncluded || website !== defaults.website;

  const onSave = () => {
    setError(null);
    start(async () => {
      try {
        const r = await saveEstimateOutputDefaultsAction({ notIncluded, website });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Estimate output</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          What a new estimate&apos;s cover PDF lists as not included (each estimate can change its own), and the website in the
          cover&apos;s footer.
        </div>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          Not included — default list
          <textarea
            className="pk-input"
            value={notIncluded}
            maxLength={NOT_INCLUDED_MAX}
            onChange={(e) => setNotIncluded(e.target.value)}
            placeholder={"One item per line, e.g.\nElectrical work by others\nPermits and fees"}
            style={{ minHeight: 120, fontWeight: 400 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          Website (cover footer)
          <input className="pk-input" value={website} maxLength={WEBSITE_MAX} onChange={(e) => setWebsite(e.target.value)} placeholder="www.example.com" style={{ fontWeight: 400 }} />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save"}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "#b03a2e" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
```

  (`.pk-input` and `.pk-btn-accent` are existing classes in `src/app/globals.css`.)

- [ ] **Step 7: Register and render the card.**
  - `settings-sections.ts` — in `SETTINGS_CARDS`, after `{ key: "customerFields", label: "Customer fields", group: "sales" },` add
    `{ key: "estimateOutput", label: "Estimate output", group: "sales" },`.
  - `groups/types.ts` — add `import type { EstimateOutputDefaults } from "@/lib/estimate-output/fields";` and, in
    `SettingsData` after `reviewLimits`, `/** #301 — Settings → Sales & Rewards → Estimate output. */ estimateOutput: EstimateOutputDefaults;`.
  - `groups/sales.tsx` — import `EstimateOutputCard` from `"../estimate-output-card"` and the type; add prop
    `estimateOutput: EstimateOutputDefaults;` to the props type and destructuring; after `<CustomerFieldsCard … />` render
    `<EstimateOutputCard key={JSON.stringify(estimateOutput)} defaults={estimateOutput} />`.
  - `settings-client.tsx` — in `<SalesGroup …>` add `estimateOutput={data.estimateOutput}`.
  - `page.tsx` — import `getEstimateOutputDefaults` and `sanitizeEstimateOutputDefaults`; after
    `const pipelineUsage = isAdmin ? await stageUsage() : {};` add
    `const estimateOutput = isAdmin ? await getEstimateOutputDefaults() : sanitizeEstimateOutputDefaults({});`; in
    `<SettingsClient …>` add `estimateOutput={estimateOutput}` after `reviewLimits={…}`.

- [ ] **Step 8: Run the gates** (tsc; test:specs — the three edited pins and the new block pass; eslint on the eight files;
  `next build`).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/stores/estimate-output-defaults.ts "src/app/(app)/settings" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(settings): #301 slice A — Settings → Sales & Rewards → Estimate output (Not included default, cover website)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Quote cover fields in the Estimator

**Files:**
- Create: `src/app/(app)/estimator/cover-package-panel.tsx`
- Modify: `src/app/(app)/estimator/types.ts` (`InitialQuote` before `pdfOptions` `:543`; `EstimatorProps` after
  `narrativeIntros` `:632`)
- Modify: `src/app/(app)/estimator/actions.ts` (`SavePayload` `:129-161`; the `patch` object in `saveQuoteAction`;
  `updateQuoteMetaAction` `:985-1031`)
- Modify: `src/app/(app)/estimator/page.tsx` (`initialFrom` both branches; the `Promise.all`; `<EstimatorClient`)
- Modify: `src/app/(app)/estimator/estimator-client.tsx` (state next to `quoteNote` `:619`; timers `:798`; handlers next to
  `onAssumptions` `:1471`; save payload `:1214`; `<PreviewDoc` `:4226`)
- Modify: `src/app/(app)/estimator/preview-doc.tsx` (`PreviewProps`; mount before `<ClientLinkPanel`)
- Test: harness block `#301 slice A — quote cover fields`

**Interfaces:**
- **Consumes:** `cleanPlainText`, `COVER_SUMMARY_MAX`, `NOT_INCLUDED_MAX` (Task 1); `getEstimateOutputDefaults` (Task 5).
- **Produces** (Task 8): `CoverPackagePanel` (named export) with props
  `{ savedQuoteId: string | null; canEdit: boolean; dirty: boolean; coverSummary: string; onCoverSummary: (v: string) => void; notIncluded: string; onNotIncluded: (v: string) => void; notIncludedDefault: string }`;
  `SavePayload.coverSummary?: string`, `.notIncluded?: string`; `InitialQuote.coverSummary: string`,
  `.notIncluded: string | null`; `EstimatorProps.notIncludedDefault: string`; `PreviewProps.coverSummary`,
  `.setCoverSummary`, `.notIncluded`, `.setNotIncluded`, `.notIncludedDefault`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice A — quote cover fields: Overall summary + Not included in the
   customer preview sidebar, saved with the quote and autosaved (R14).
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const acts = rd("src/app/(app)/estimator/actions.ts");
  const saveBody = acts.slice(acts.indexOf("export async function saveQuoteAction("), acts.indexOf("export async function searchQuotesAction("));
  ok(saveBody.includes('...(typeof payload.coverSummary === "string" ? { coverSummary: cleanPlainText(payload.coverSummary, COVER_SUMMARY_MAX) } : {}),') &&
     saveBody.includes('...(typeof payload.notIncluded === "string" ? { notIncluded: cleanPlainText(payload.notIncluded, NOT_INCLUDED_MAX) } : {}),'),
    "#301 save: the cover fields ride the Save patch, cleaned and capped (R14)");
  const meta = acts.slice(acts.indexOf("export async function updateQuoteMetaAction("), acts.indexOf("export type QuotePeopleSync"));
  ok(meta.includes('if (typeof meta.coverSummary === "string") patch.coverSummary = cleanPlainText(meta.coverSummary, COVER_SUMMARY_MAX);') &&
     meta.includes('if (typeof meta.notIncluded === "string") patch.notIncluded = cleanPlainText(meta.notIncluded, NOT_INCLUDED_MAX);'),
    "#301 autosave: the header autosave allowlists the two fields, cleaned");
  const pg = rd("src/app/(app)/estimator/page.tsx");
  ok(pg.includes("getEstimateOutputDefaults()") && pg.includes("notIncludedDefault={estimateOutputDefaults.notIncluded}") &&
     pg.includes('notIncluded: typeof q.notIncluded === "string" ? q.notIncluded : null,') && pg.includes('coverSummary: q.coverSummary || "",'),
    "#301 page: the stored fields seed the editor; a quote that never stored Not included gets the default");
  const cli = rd("src/app/(app)/estimator/estimator-client.tsx");
  ok(cli.includes("useState(initial.notIncluded ?? notIncludedDefault)") && cli.includes("persistMeta({ coverSummary: v })") && cli.includes("persistMeta({ notIncluded: v })") &&
     /saveQuoteAction\(loadedId, \{[\s\S]{0,1500}coverSummary,\s+notIncluded,/.test(cli),
    "#301 estimator: the fields autosave (500 ms) and ride every Save");
  const panel = rd("src/app/(app)/estimator/cover-package-panel.tsx");
  ok(panel.startsWith('"use client";') && panel.includes("Cover &amp; package") && panel.includes("Overall summary") && panel.includes("Not included") &&
     panel.includes("Reset to default") && panel.includes("p.onNotIncluded(p.notIncludedDefault)") && !/^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/quote-pdf)/m.test(panel),
    "#301 preview: the Cover & package block (summary, Not included, Reset to default)");
  const prev = rd("src/app/(app)/estimator/preview-doc.tsx");
  ok(prev.includes("<CoverPackagePanel") && prev.indexOf("<CoverPackagePanel") < prev.indexOf("<ClientLinkPanel") && !prev.includes('className="est-doc"') && !prev.includes("customerLines("),
    "#301 preview: mounted above the Client link block; the #222 preview pins still hold");
}
```

- [ ] **Step 2: Run it to verify it fails** (ENOENT on `cover-package-panel.tsx`).

- [ ] **Step 3: Types.** In `src/app/(app)/estimator/types.ts`:
  - `InitialQuote`, right before `pdfOptions: QuotePdfOptions;`:

```ts
  /** #301 — the cover PDF's overall summary ("" = the scope-list sentence). */
  coverSummary: string;
  /** #301 — Not included as stored; null = never stored (the editor starts
   *  from the Settings → Estimate output default list). */
  notIncluded: string | null;
```

  - `EstimatorProps`, after `narrativeIntros: SystemIntro[];`:

```ts
  /** #301 — Settings → Estimate output: the default Not included list (Reset to default). */
  notIncludedDefault: string;
```

- [ ] **Step 4: Server writes** in `src/app/(app)/estimator/actions.ts`.
  - Import: `import { COVER_SUMMARY_MAX, NOT_INCLUDED_MAX, cleanPlainText, withSanitizedOutputFields } from "@/lib/estimate-output/fields";`
    (extend Task 1's import line).
  - `SavePayload`, after `pdfOptions: QuotePdfOptions;`:

```ts
  /** #301 — the cover fields (R14). Optional so an older caller saves as before. */
  coverSummary?: string;
  notIncluded?: string;
```

  - In `saveQuoteAction`'s `patch` object, after `pdfOptions: normalizePdfOptions(payload.pdfOptions),`:

```ts
    // #301 (R14): not content fields — they never re-render the estimate PDF.
    ...(typeof payload.coverSummary === "string" ? { coverSummary: cleanPlainText(payload.coverSummary, COVER_SUMMARY_MAX) } : {}),
    ...(typeof payload.notIncluded === "string" ? { notIncluded: cleanPlainText(payload.notIncluded, NOT_INCLUDED_MAX) } : {}),
```

    (The create branch passes `patch` to `create()`, and `buildQuote` copies both — Task 1.)
  - `updateQuoteMetaAction`'s `meta` type: add `coverSummary?: string; notIncluded?: string;`; after the
    `if (typeof meta.category === "string") …` line add:

```ts
  // #301: the cover fields autosave like the cover note; neither is content, so no re-render.
  if (typeof meta.coverSummary === "string") patch.coverSummary = cleanPlainText(meta.coverSummary, COVER_SUMMARY_MAX);
  if (typeof meta.notIncluded === "string") patch.notIncluded = cleanPlainText(meta.notIncluded, NOT_INCLUDED_MAX);
```

- [ ] **Step 5: The page.** In `src/app/(app)/estimator/page.tsx`:
  - Import `import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";`.
  - `initialFrom` new-quote branch: after `pdf: null,` add `coverSummary: "",` and `notIncluded: null,`.
  - `initialFrom` loaded branch: after `pdf: pdfView(q.pdf, Date.now()),` add

```ts
    // #301: the cover fields as stored; null = never stored (the editor starts from the default list).
    coverSummary: q.coverSummary || "",
    notIncluded: typeof q.notIncluded === "string" ? q.notIncluded : null,
```

  - Extend the destructured `Promise.all` with `estimateOutputDefaults` / `getEstimateOutputDefaults()` (append to both
    lists, keeping order).
  - `<EstimatorClient …>`: after `narrativeIntros={narrativeIntros}` add
    `// #301: Reset to default in the preview's Cover & package block.` and
    `notIncludedDefault={estimateOutputDefaults.notIncluded}`.

- [ ] **Step 6: Create `src/app/(app)/estimator/cover-package-panel.tsx`** (the Cover PDF links come in Task 8):

```tsx
"use client";

import type { CSSProperties } from "react";
import { COVER_SUMMARY_MAX, NOT_INCLUDED_MAX } from "@/lib/estimate-output/fields";

/**
 * #301 slice A — the customer preview sidebar's "Cover & package" block: the
 * quote's Overall summary and Not included list (they print on the cover PDF,
 * never on the estimate PDF). Edits autosave through the Estimator's header
 * autosave and ride every Save.
 */

export type CoverPackagePanelProps = {
  savedQuoteId: string | null;
  canEdit: boolean;
  /** The editor holds changes the saved quote doesn't have yet. */
  dirty: boolean;
  coverSummary: string;
  onCoverSummary: (v: string) => void;
  notIncluded: string;
  onNotIncluded: (v: string) => void;
  notIncludedDefault: string;
};

const sideLabel: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" };
const fieldLabel: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#3a3f4a" };
const hint: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.45 };
const ta: CSSProperties = { width: "100%", minHeight: 76, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12, lineHeight: 1.45, color: "#16181d", border: "1px solid #dfe2e8", borderRadius: 7, padding: "7px 9px", background: "#fff" };
const smallBtn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer" };

export function CoverPackagePanel(p: CoverPackagePanelProps) {
  const atDefault = p.notIncluded.trim() === p.notIncludedDefault.trim();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7 }}>
      <span style={sideLabel}>Cover &amp; package</span>
      <span style={fieldLabel}>Overall summary</span>
      <textarea
        aria-label="Overall summary"
        value={p.coverSummary}
        readOnly={!p.canEdit}
        maxLength={COVER_SUMMARY_MAX}
        onChange={(e) => p.onCoverSummary(e.target.value)}
        placeholder="Blank prints “This estimate includes N scopes: …”"
        style={ta}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={fieldLabel}>Not included</span>
        <button
          type="button"
          style={{ ...smallBtn, opacity: !p.canEdit || atDefault ? 0.5 : 1, cursor: !p.canEdit || atDefault ? "default" : "pointer" }}
          disabled={!p.canEdit || atDefault}
          onClick={() => p.onNotIncluded(p.notIncludedDefault)}
          title="Put back the list from Settings → Estimate output"
        >
          Reset to default
        </button>
      </div>
      <textarea
        aria-label="Not included"
        value={p.notIncluded}
        readOnly={!p.canEdit}
        maxLength={NOT_INCLUDED_MAX}
        onChange={(e) => p.onNotIncluded(e.target.value)}
        placeholder="One item per line"
        style={ta}
      />
      <span style={hint}>One item per line — prints as one “Not included:” paragraph on the cover.</span>
    </div>
  );
}
```

- [ ] **Step 7: The preview sidebar.** In `src/app/(app)/estimator/preview-doc.tsx`:
  - `import { CoverPackagePanel } from "./cover-package-panel";`
  - `PreviewProps`, after `togglePdf`:

```ts
  /** #301 — the cover PDF's quote-level text (Cover & package block). */
  coverSummary: string;
  setCoverSummary: (v: string) => void;
  notIncluded: string;
  setNotIncluded: (v: string) => void;
  notIncludedDefault: string;
```

  - Replace `{p.savedQuoteId && <ClientLinkPanel quoteId={p.savedQuoteId} />}` with:

```tsx
          <CoverPackagePanel
            savedQuoteId={p.savedQuoteId}
            canEdit={p.canBuild}
            dirty={p.dirty}
            coverSummary={p.coverSummary}
            onCoverSummary={p.setCoverSummary}
            notIncluded={p.notIncluded}
            onNotIncluded={p.setNotIncluded}
            notIncludedDefault={p.notIncludedDefault}
          />
          {p.savedQuoteId && <ClientLinkPanel quoteId={p.savedQuoteId} />}
```

- [ ] **Step 8: The Estimator.** In `src/app/(app)/estimator/estimator-client.tsx`:
  - Destructure `notIncludedDefault,` in the props list (after `narrativeIntros,`).
  - After `const [assumptions, setAssumptions] = useState(initial.assumptions || "");` (`:620`):

```ts
  /** #301 — the cover PDF's Overall summary and Not included (never on the estimate PDF). */
  const [coverSummary, setCoverSummary] = useState(initial.coverSummary);
  const [notIncluded, setNotIncluded] = useState(initial.notIncluded ?? notIncludedDefault);
```

  - After `const assumptionsTimer = useRef<…>(null);` (`:799`):

```ts
  const coverSummaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notIncludedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

  - After the `onAssumptions` handler (`:1471-1476`):

```ts
  // #301: autosaved like the cover note so the Cover PDF reflects them without a full Save.
  const onCoverSummary = (v: string) => {
    setCoverSummary(v);
    if (!loadedId) return;
    if (coverSummaryTimer.current) clearTimeout(coverSummaryTimer.current);
    coverSummaryTimer.current = setTimeout(() => persistMeta({ coverSummary: v }), 500);
  };
  const onNotIncluded = (v: string) => {
    setNotIncluded(v);
    if (!loadedId) return;
    if (notIncludedTimer.current) clearTimeout(notIncludedTimer.current);
    notIncludedTimer.current = setTimeout(() => persistMeta({ notIncluded: v }), 500);
  };
```

  - In `saveQuoteAction(loadedId, { … })` (`:1214`), after `pdfOptions: pdfOpts,` add:

```ts
          // #301 (R14): the cover fields ride every Save.
          coverSummary,
          notIncluded,
```

  - `<PreviewDoc …>` (`:4226`): after `togglePdf={…}` add

```tsx
            coverSummary={coverSummary}
            setCoverSummary={onCoverSummary}
            notIncluded={notIncluded}
            setNotIncluded={onNotIncluded}
            notIncludedDefault={notIncludedDefault}
```

- [ ] **Step 9: Run the gates** (tsc; test:specs; eslint on the six files; `next build`).

- [ ] **Step 10: Commit.**

```bash
git add "src/app/(app)/estimator/cover-package-panel.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/preview-doc.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimator): #301 slice A — Cover & package block: Overall summary + Not included (Reset to default), saved and autosaved

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Cover document

**Files:**
- Create: `src/lib/estimate-output/cover.ts`, `src/components/estimate-output/cover-document.tsx`
- Test: harness block `#301 slice A — cover document`

**Interfaces:**
- **Consumes:** `QuoteDocumentProps` (type); `fmt` (`pricing.ts`); `ShareLinkView`, `OnlineEstimateState` (types,
  `@/lib/quote-share/view`); `outputScopes`, `addOptions`, `coverTotals`, `notIncludedLine`, `coverSummaryText`,
  `scopePriceLabel` (Task 2).
- **Produces** (Task 8):
  `type CoverSigner = { name: string; title: string; phone: string; email: string }`;
  `type CoverUser = { name: string; title?: string | null; phone?: string | null; mobile?: string | null; email?: string | null }`;
  `type CoverOffice = { street?: string; city?: string; state?: string; zip?: string; phone?: string; quoteDefault?: boolean }`;
  `type CoverDocumentProps` (below); `COVER_DEFAULT_TITLE`; `COVER_LINK_LEAD`;
  `resolveCoverSigner(owner: string | null | undefined, preparedBy: string | null | undefined, users: CoverUser[]): CoverSigner | null`;
  `coverFooterLine(input: { companyName: string; offices?: CoverOffice[]; website?: string }): string`;
  `coverShareUrl(origin: string | null, link: ShareLinkView | null, state: OnlineEstimateState["kind"]): string | null`;
  `coverPdfFileName(number: string): string`;
  `coverDocumentPropsFor(input: CoverInput): CoverDocumentProps` with
  `type CoverInput = { doc: QuoteDocumentProps; coverSummary: string; notIncluded: string; signer: CoverSigner | null; footerLine: string; shareUrl: string | null; letterhead: { src: string; full: boolean } }`;
  `CoverDocument` (default export) and `COVER_PRINT_CSS` from `cover-document.tsx`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice A — cover document: signer (R16), footer (R17), link line,
   the props builder, and a Node render of CoverDocument (no .jpg import).
   ====================================================================== */
import {
  resolveCoverSigner as e301cSigner, coverFooterLine as e301cFooter, coverShareUrl as e301cShare, coverPdfFileName as e301cFile,
  coverDocumentPropsFor as e301cProps, COVER_DEFAULT_TITLE as e301cTitle,
} from "@/lib/estimate-output/cover";
import CoverDocument301, { COVER_PRINT_CSS as e301cCss } from "@/components/estimate-output/cover-document";
import { createElement as e301cEl } from "react";
import { renderToStaticMarkup as e301cRender } from "react-dom/server";
import type { SpecSection as E301cSec } from "@/app/(app)/estimator/types";
{
  // ---- signer (R16) ----
  const users = [
    { name: "Pat Estimator", title: "Estimator", phone: "", mobile: "555-0101", email: "pat@peak.test" },
    { name: "Dup Name", title: "A", phone: "1", email: "a@x" },
    { name: "dup name ", title: "B", phone: "2", email: "b@x" },
    { name: "Robin Prep", title: "PM", phone: "555-0202", email: "robin@peak.test" },
  ];
  const s1 = e301cSigner(" pat ESTIMATOR ", "", users);
  ok(s1?.name === "Pat Estimator" && s1.title === "Estimator" && s1.phone === "555-0101" && s1.email === "pat@peak.test", "#301 signer: owner matched case-insensitively; phone falls back to mobile");
  ok(e301cSigner("Dup Name", "Robin Prep", users)?.name === "Robin Prep", "#301 signer: an ambiguous owner falls to Prepared by");
  ok(e301cSigner("Nobody", "", users) === null && e301cSigner("", null, users) === null, "#301 signer: no unique match → no signer (prints the company)");

  // ---- footer + link + file name ----
  const offices = [{ street: "1 Side St", city: "Elgin", state: "IL", zip: "60120", phone: "847-000-0000" }, { street: "500 Main St", city: "Chicago", state: "IL", zip: "60601", phone: "312-555-0100", quoteDefault: true }];
  ok(e301cFooter({ companyName: "Peak Systems Group", offices, website: "peaksystemsgroup.com" }) === "Peak Systems Group · 500 Main St, Chicago, IL 60601 · 312-555-0100 · peaksystemsgroup.com",
    "#301 footer: company · primary office address · phone · website (R17)");
  ok(e301cFooter({ companyName: "Peak", offices: [], website: "" }) === "Peak", "#301 footer: missing parts drop out");
  const link = { active: true, path: "/share/quote/Q-1/123.abc", expiresAt: 9, createdAt: 1, createdBy: "x", revokedAt: null, revokedBy: null };
  ok(e301cShare("https://app.test/", link, "ok") === "https://app.test/share/quote/Q-1/123.abc" && e301cShare(null, link, "ok") === null &&
     e301cShare("https://app.test", { ...link, active: false }, "ok") === null && e301cShare("https://app.test", link, "revising") === null && e301cShare("https://app.test", null, "ok") === null,
    "#301 link: printed only for an active link on an online-ok quote, with an absolute origin");
  ok(e301cFile("EST-1042") === "EST-1042 Cover.pdf" && e301cFile("EST/1042") === "EST_1042 Cover.pdf", "#301 file: \"EST-1042 Cover.pdf\"");

  // ---- builder ----
  const secs = p293Sections().map((s, i) => (i === 0 ? { ...s, coverText: "Rigging cover." } : s)) as E301cSec[];
  const doc = { ...p293Props({ sections: secs, pdfOptions: { pdfOptions: true } }), rewardsLine: "Your Gold rewards: Free freight" };
  const props = e301cProps({ doc, coverSummary: "", notIncluded: "Permits\nPainting", signer: s1, footerLine: "Peak · x", shareUrl: "https://app.test/share/quote/Q-293/1.x",
    letterhead: { src: "/_test/peak-letterhead.jpg", full: true } });
  ok(props.title === "Narrative test" && e301cProps({ doc: { ...doc, projectName: "  " }, coverSummary: "", notIncluded: "", signer: null, footerLine: "", shareUrl: null, letterhead: { src: "x", full: true } }).title === e301cTitle,
    "#301 cover: the quote name as the title, else \"Estimate Summary\"");
  ok(props.project.number === `${doc.quoteId} Rev ${doc.revNum}` && props.project.customer === "Walk-in" && props.scopes.length === 4 &&
     props.scopes[0].text === "Rigging cover." && props.scopes[0].priceLabel.startsWith("Rigging scope: $") && props.scopes[3].missing,
    "#301 cover: project block, one paragraph + price line per scope, missing ones flagged");
  ok(props.summary === "This estimate includes 4 scopes: Rigging, Lighting, Install and Empty narrative." && props.notIncluded === "Not included: Permits; Painting." &&
     props.options.length === 1 && props.options[0].label === "ADD OPTION 1" && props.totals.total.startsWith("$") && props.totals.rewardsLine === "Your Gold rewards: Free freight",
    "#301 cover: summary sentence, Not included, add options, totals with the purchase-perks line");

  // ---- render ----
  const html = e301cRender(e301cEl(CoverDocument301, props));
  ok(html.includes("Narrative test") && html.includes("Rigging cover.") && html.includes("[needs a paragraph]") && html.includes("ADD OPTION 1") && html.includes("Not included: Permits; Painting.") &&
     html.includes("View the full estimate online:") && html.includes("https://app.test/share/quote/Q-293/1.x") && html.includes("Pat Estimator") && html.includes("Accepted by") && html.includes("Peak · x"),
    "#301 cover: the document prints every section in the spec's order");
  const order = ["Narrative test", "Rigging cover.", "This estimate includes", ">Total<", "ADD OPTION 1", "Not included:", "View the full estimate online:", "Pat Estimator"].map((s) => html.indexOf(s));
  ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `#301 cover: §4 order — title, scopes, summary, total, options, not included, link, signature (${order.join(",")})`);
  const noSigner = e301cRender(e301cEl(CoverDocument301, { ...props, signer: null, shareUrl: null }));
  ok(!noSigner.includes("View the full estimate online:") && noSigner.includes("Peak Systems Group"), "#301 cover: no link line without a link; no signer → the company name");
  ok(e301cCss.includes("@page { size: letter; margin: 0.75in") && e301cCss.includes("font-family: Arial, Helvetica, sans-serif") && e301cCss.includes(".cov-foot { position: fixed"),
    "#301 cover: Letter, 0.75in margins, Arial, a fixed footer on every page");
  const comp = readFileSync(join(process.cwd(), "src/components/estimate-output/cover-document.tsx"), "utf8");
  ok(!comp.includes('"use client"') && !/\buse(State|Effect|Ref|Transition)\(/.test(comp) && !comp.includes("onClick=") && !comp.includes(".jpg"),
    "#301 cover: a server component with pure props — no hooks, no handlers, no image import");
}
```

- [ ] **Step 2: Run it to verify it fails** (module not found `@/lib/estimate-output/cover`).

- [ ] **Step 3: Create `src/lib/estimate-output/cover.ts`.**

```ts
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { fmt } from "@/app/(app)/estimator/pricing";
import type { OnlineEstimateState, ShareLinkView } from "@/lib/quote-share/view";
import { addOptions, coverSummaryText, coverTotals, notIncludedLine, outputScopes, scopePriceLabel } from "./scopes";

/**
 * #301 slice A — the cover PDF's props (spec §4), built from the customer
 * document's own props so prices and totals can't drift (R1, R20). Pure;
 * the server loader (cover-loader.ts) supplies the signer, footer, link and
 * letterhead.
 */

export type CoverSigner = { name: string; title: string; phone: string; email: string };
export type CoverUser = { name: string; title?: string | null; phone?: string | null; mobile?: string | null; email?: string | null };
export type CoverOffice = { street?: string; city?: string; state?: string; zip?: string; phone?: string; quoteDefault?: boolean };

export const COVER_DEFAULT_TITLE = "Estimate Summary";
export const COVER_LINK_LEAD = "View the full estimate online:";

export type CoverDocumentProps = {
  title: string;
  letterhead: { src: string; full: boolean };
  companyName: string;
  footerLine: string;
  project: { customer: string; attn: string; venue: string; project: string; number: string; date: string };
  scopes: Array<{ id: string; text: string; missing: boolean; priceLabel: string }>;
  summary: string;
  totals: { creditLabel: string | null; creditAmount: string | null; totalLabel: string; total: string; rewardsLine: string; standingLines: string[] };
  options: Array<{ label: string; desc: string; reason: string; price: string }>;
  notIncluded: string;
  shareUrl: string | null;
  signer: CoverSigner | null;
};

export type CoverInput = {
  doc: QuoteDocumentProps;
  coverSummary: string;
  notIncluded: string;
  signer: CoverSigner | null;
  footerLine: string;
  shareUrl: string | null;
  letterhead: { src: string; full: boolean };
};

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/** R16: owner, else Prepared by — exact case-insensitive name, unique only. */
export function resolveCoverSigner(owner: string | null | undefined, preparedBy: string | null | undefined, users: CoverUser[]): CoverSigner | null {
  const find = (name: string | null | undefined) => {
    const n = norm(name);
    if (!n) return null;
    const hits = users.filter((u) => norm(u.name) === n);
    return hits.length === 1 ? hits[0] : null;
  };
  const u = find(owner) ?? find(preparedBy);
  if (!u) return null;
  return { name: u.name.trim(), title: (u.title || "").trim(), phone: (u.phone || "").trim() || (u.mobile || "").trim(), email: (u.email || "").trim() };
}

/** R17: company · street, city, ST zip · office phone · website (blanks drop out). */
export function coverFooterLine(input: { companyName: string; offices?: CoverOffice[]; website?: string }): string {
  const offices = input.offices || [];
  const o = offices.find((x) => x.quoteDefault) || offices[0];
  const stateZip = o ? [o.state, o.zip].map((s) => (s || "").trim()).filter(Boolean).join(" ") : "";
  const cityLine = o ? [o.city || "", stateZip].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  const address = o ? [o.street || "", cityLine].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  return [input.companyName, address, o?.phone || "", input.website || ""].map((s) => (s || "").trim()).filter(Boolean).join(" · ");
}

/** Slice A link line: the active v1 link, only while the online page would show the estimate. */
export function coverShareUrl(origin: string | null, link: ShareLinkView | null, state: OnlineEstimateState["kind"]): string | null {
  if (!origin || !link || !link.active || !link.path || state !== "ok") return null;
  return origin.replace(/\/+$/, "") + link.path;
}

export function coverPdfFileName(number: string): string {
  return `${(number || "Estimate").replace(/[^A-Za-z0-9 _-]/g, "_")} Cover.pdf`;
}

const chicagoLong = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export function coverDocumentPropsFor(input: CoverInput): CoverDocumentProps {
  const d = input.doc;
  const scopes = outputScopes(d);
  const t = coverTotals(d);
  return {
    title: (d.projectName || "").trim() || COVER_DEFAULT_TITLE,
    letterhead: input.letterhead,
    companyName: d.companyName,
    footerLine: input.footerLine,
    project: {
      customer: d.custName,
      attn: d.hasAttn ? d.attnLine : "",
      venue: d.venueLabel,
      project: d.projectName,
      number: `${d.quoteId} Rev ${d.revNum}`,
      date: chicagoLong(d.revDateMs),
    },
    scopes: scopes.map((s) => ({ id: s.id, text: s.cover.text, missing: s.cover.source === "missing", priceLabel: `${scopePriceLabel(s.name)}: ${fmt(s.price)}` })),
    summary: coverSummaryText(input.coverSummary, scopes.map((s) => s.name)),
    totals: {
      creditLabel: t.creditLabel,
      creditAmount: t.credit > 0 ? "−" + fmt(t.credit) : null,
      totalLabel: t.totalLabel,
      total: fmt(t.total),
      rewardsLine: t.rewardsLine,
      standingLines: t.standingLines,
    },
    options: addOptions(d).map((o) => ({ label: o.label, desc: o.desc, reason: o.reason, price: fmt(o.price) })),
    notIncluded: notIncludedLine(input.notIncluded),
    shareUrl: input.shareUrl,
    signer: input.signer,
  };
}
```

- [ ] **Step 4: Create `src/components/estimate-output/cover-document.tsx`.**

```tsx
import type { CSSProperties } from "react";
import { COVER_LINK_LEAD, type CoverDocumentProps } from "@/lib/estimate-output/cover";

/**
 * #301 slice A — the cover PDF (spec §4): standalone, letterhead + footer,
 * Arial, an underlined centered title, a paragraph and a bold price line per
 * scope, the summary, the total, add options, Not included, the link line and
 * the signature block. A server component with pure props (no hooks, no
 * handlers, no image import — the print page passes the letterhead src), so
 * the harness renders it in Node. Printed by /print/cover/[id].
 *
 * The footer repeats on every page: a fixed-position footer over a repeating
 * <tfoot> spacer of the same height (Chrome repeats both when printing).
 */

export const COVER_PRINT_CSS = `
@page { size: letter; margin: 0.75in 0.75in 0.5in; }
html, body { background: #fff !important; margin: 0; height: auto !important; }
nextjs-portal { display: none !important; }
.cov { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cov-page { width: 100%; border-collapse: collapse; }
.cov-page td { padding: 0; vertical-align: top; }
.cov-foot-space { height: 0.45in; }
.cov-foot { position: fixed; left: 0; right: 0; bottom: 0; height: 0.35in; box-sizing: border-box; padding-top: 5pt; border-top: 1px solid #bbb; text-align: center; font-size: 8pt; color: #555; background: #fff; }
.cov-scope, .cov-totals, .cov-opt, .cov-sig { break-inside: avoid; page-break-inside: avoid; }
@media screen { .cov { max-width: 7in; margin: 24px auto; } .cov-foot { position: static; margin-top: 24px; } .cov-foot-space { display: none; } }
`;

const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const label: CSSProperties = { color: "#555", width: 90, flexShrink: 0 };

export default function CoverDocument(p: CoverDocumentProps) {
  const project: Array<[string, string]> = [
    ["Customer", p.project.customer],
    ["Attn", p.project.attn],
    ["Venue", p.project.venue],
    ["Project", p.project.project],
    ["Estimate", p.project.number],
    ["Date", p.project.date],
  ].filter(([, v]) => !!(v || "").trim()) as Array<[string, string]>;
  return (
    <div className="cov">
      <table className="cov-page" role="presentation">
        <tbody>
          <tr>
            <td>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.letterhead.src}
                alt={p.companyName}
                style={p.letterhead.full ? { display: "block", width: "100%", height: "auto" } : { display: "block", maxHeight: 70, maxWidth: "100%", objectFit: "contain" }}
              />
              <h1 style={{ textAlign: "center", textDecoration: "underline", fontSize: "15pt", fontWeight: 700, margin: "18pt 0 12pt" }}>{p.title}</h1>

              <div style={{ marginBottom: "14pt" }}>
                {project.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 8 }}>
                    <span style={label}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>

              {p.scopes.map((s) => (
                <div key={s.id} className="cov-scope" style={{ marginBottom: "10pt" }}>
                  <p style={{ margin: 0, whiteSpace: "pre-line", ...(s.missing ? { color: "#888", fontStyle: "italic" } : {}) }}>{s.text}</p>
                  <div style={{ textAlign: "right", fontWeight: 700, marginTop: "3pt" }}>{s.priceLabel}</div>
                </div>
              ))}

              {p.summary && <p style={{ margin: "12pt 0", whiteSpace: "pre-line" }}>{p.summary}</p>}

              <div className="cov-totals" style={{ borderTop: "1px solid #111", paddingTop: "6pt", marginTop: "6pt" }}>
                {p.totals.creditLabel && (
                  <div style={row}>
                    <span>{p.totals.creditLabel}</span>
                    <span>{p.totals.creditAmount}</span>
                  </div>
                )}
                <div style={{ ...row, fontWeight: 700, fontSize: "12pt" }}>
                  <span>{p.totals.totalLabel}</span>
                  <span>{p.totals.total}</span>
                </div>
                {p.totals.rewardsLine && <div style={{ textAlign: "right", fontSize: "9pt", color: "#333" }}>{p.totals.rewardsLine}</div>}
                {p.totals.standingLines.map((l) => (
                  <div key={l} style={{ textAlign: "right", fontSize: "9pt", color: "#333" }}>
                    {l}
                  </div>
                ))}
              </div>

              {p.options.length > 0 && (
                <div style={{ marginTop: "12pt" }}>
                  {p.options.map((o) => (
                    <div key={o.label} className="cov-opt" style={{ marginBottom: "6pt" }}>
                      <div style={row}>
                        <span>
                          <strong>{o.label}</strong> — {o.desc}
                        </span>
                        <strong>{o.price}</strong>
                      </div>
                      {o.reason && <div style={{ color: "#333", fontSize: "9.5pt" }}>{o.reason}</div>}
                    </div>
                  ))}
                </div>
              )}

              {p.notIncluded && <p style={{ margin: "12pt 0 0" }}>{p.notIncluded}</p>}

              {p.shareUrl && (
                <p style={{ margin: "12pt 0 0" }}>
                  {COVER_LINK_LEAD} <span style={{ wordBreak: "break-all" }}>{p.shareUrl}</span>
                </p>
              )}

              <div className="cov-sig" style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: "22pt" }}>
                <div>
                  {p.signer ? (
                    <>
                      <div style={{ fontWeight: 700 }}>{p.signer.name}</div>
                      {p.signer.title && <div>{p.signer.title}</div>}
                      <div>{p.companyName}</div>
                      {p.signer.phone && <div>{p.signer.phone}</div>}
                      {p.signer.email && <div>{p.signer.email}</div>}
                    </>
                  ) : (
                    <div style={{ fontWeight: 700 }}>{p.companyName}</div>
                  )}
                </div>
                <div style={{ minWidth: "2.8in" }}>
                  <div style={{ borderBottom: "1px solid #111", height: "22pt" }} />
                  <div style={{ fontSize: "9pt", color: "#333" }}>Accepted by (name, title)</div>
                  <div style={{ borderBottom: "1px solid #111", height: "22pt" }} />
                  <div style={{ fontSize: "9pt", color: "#333" }}>Date</div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>
              <div className="cov-foot-space" />
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="cov-foot">{p.footerLine}</div>
    </div>
  );
}
```

  The harness's §4 order check looks for `">Total<"`. With `t.credit = 0` and no POR, `totalLabel` is `Total`, which
  renders as `<span>Total</span>` → contains `>Total<`. Keep the label in its own `<span>`.

- [ ] **Step 5: Run the gates** (tsc; test:specs; eslint on the two new files).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/estimate-output/cover.ts src/components/estimate-output/cover-document.tsx scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice A — CoverDocument: letterhead, Arial, scopes, totals, options, Not included, link, signature

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Cover PDF delivery

**Files:**
- Modify: `src/lib/quote-pdf/token.ts:17` (`PrintTokenKind`)
- Create: `src/lib/estimate-output/cover-loader.ts`, `src/app/print/cover/[id]/page.tsx`,
  `src/app/api/quotes/[id]/cover-pdf/route.ts`
- Modify: `src/app/(app)/estimator/cover-package-panel.tsx` (the Cover PDF links)
- Modify: `scripts/smoke-routes.ts` (`DYNAMIC_ROUTES`, after the `/api/racks/SA-NOPE/submittal` entry `:343`)
- Test: harness block `#301 slice A — cover PDF route`; `e301CoverAsyncChecks`

**Interfaces:**
- **Consumes:** everything from Tasks 2, 5, 7; `quoteDocumentDataFor`; `getCustomer`; `getSettings`;
  `purchasePerksForCompany`; `purchasePerksDocLine`; `allUsers`; `shareLinkView`, `shareSecret`; `onlineEstimateState`;
  `effectiveNotIncluded`; `printOriginFor`; `signPrintToken`, `verifyPrintToken`; `renderPrintRouteToPdf`,
  `PdfRenderUnavailable`; `pdfKindForQuoteType`; `displayQuoteNumber`; `attachmentDisposition`
  (`@/lib/document-files`).
- **Produces:** `PrintTokenKind` includes `"cover"`;
  `loadCoverDocumentProps(q: Quote, opts: { origin: string | null; letterheadSrc: string; now?: number }): Promise<CoverDocumentProps>`;
  `GET /print/cover/[id]?t=<token>`; `GET /api/quotes/[id]/cover-pdf[?download=1]`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice A — cover PDF route: the "cover" print token, the signed
   print page, the staff download (R7), the panel buttons.
   ====================================================================== */
import { signPrintToken as e301rSign, verifyPrintToken as e301rVerify } from "@/lib/quote-pdf/token";
{
  const S = "test301-secret";
  const t0 = 1_800_000_000_000;
  const tok = e301rSign(S, "cover", "Q-1", t0);
  ok(e301rVerify(S, tok, "cover", "Q-1", t0 + 1000) && !e301rVerify(S, tok, "quote", "Q-1", t0) && !e301rVerify(S, tok, "cover", "Q-2", t0) &&
     !e301rVerify(S, e301rSign(S, "quote", "Q-1", t0), "cover", "Q-1", t0), "#301 route: a cover token verifies only for its kind + id (domain-separated from the quote PDF)");
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = rd("src/app/print/cover/[id]/page.tsx");
  ok(page.includes('verifyPrintToken(process.env.AUTH_SECRET || "", t, "cover", id, Date.now())') && page.includes("notFound()") && page.includes("force-dynamic") &&
     page.includes("index: false") && page.includes('pdfKindForQuoteType(q.quoteType) !== "quote"') && page.includes("await headers()") && page.includes("loadCoverDocumentProps(") &&
     page.indexOf("tokenOk(") < page.indexOf("getQuote("), "#301 route: the print page checks its token before any read, 404s otherwise, is dynamic and noindex");
  const route = rd("src/app/api/quotes/[id]/cover-pdf/route.ts");
  ok(route.includes("export const maxDuration = 60;") && route.includes("await requireUser();") && route.includes("printOriginFor(process.env,") &&
     route.includes('signPrintToken(secret, "cover", q.id, Date.now())') && route.includes("renderPrintRouteToPdf(") && route.includes("PdfRenderUnavailable") &&
     route.includes('pdfKindForQuoteType(q.quoteType) !== "quote"') && route.includes("coverPdfFileName(displayQuoteNumber(q))") && route.includes('"x-content-type-options": "nosniff"'),
    "#301 route: signed-in only, 60 s, the shared print origin, system quotes only, \"EST-#### Cover.pdf\" (R7)");
  const panel = rd("src/app/(app)/estimator/cover-package-panel.tsx");
  ok(panel.includes("/cover-pdf") && panel.includes(">Cover PDF<") && panel.includes("Open cover ↗") && panel.includes("Save first — the cover prints the saved estimate.") && panel.includes("Save to create the cover."),
    "#301 route: the preview sidebar's Cover PDF + Open cover buttons");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes('{ route: "/print/cover/Q-2041", expectNotFound: true }') && smoke.includes('{ route: "/api/quotes/Q-0/cover-pdf", expectNotFound: true }'), "#301 route: smoke covers the 404 paths");
}

async function e301CoverAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const { allUsers } = await import("@/lib/users");
  const { setBlob, getBlob } = await import("@/db/doc-store");
  const { loadCoverDocumentProps } = await import("@/lib/estimate-output/cover-loader");
  const users = await allUsers();
  const uniq = users.find((u) => users.filter((x) => x.name.trim().toLowerCase() === u.name.trim().toLowerCase()).length === 1);
  const QID = fixtureId(301, "cover");
  const saved = await getBlob<Record<string, unknown>>("estimate_output_defaults", {});
  try {
    await setBlob("estimate_output_defaults", { notIncluded: "Permits\nPainting", website: "peak.test" });
    await Q.create({ id: QID, name: "#301 cover", customer: "Spec fixture", owner: uniq?.name || "Nobody Here", quoteType: "system",
      spec: { sections: [{ id: "s1", name: "Stage lighting", kind: "materials", mfr: "", freightPct: 0, narrative: "A clean wash.", items: [{ id: 1, sku: "A", desc: "Fixture", qty: 2, unit: "ea", cost: 10, price: 25 }] }], mobs: [] } });
    registerFixture("quotes", QID);
    const q = await Q.get(QID);
    const props = q ? await loadCoverDocumentProps(q, { origin: "https://app.test", letterheadSrc: "/_test/lh.jpg" }) : null;
    ok(!!props && props.title === "#301 cover" && props.scopes.length === 1 && props.scopes[0].text === "A clean wash." && props.scopes[0].priceLabel === "Stage lighting scope: $50.00",
      "#301 loader: the live quote's scopes and prices");
    ok(props?.notIncluded === "Not included: Permits; Painting." && !!props?.footerLine.endsWith("peak.test"), "#301 loader: a quote that never stored Not included prints the Settings default; the footer carries the website");
    ok(props?.shareUrl === null, "#301 loader: no share link → no link line");
    ok(uniq ? props?.signer?.name === uniq.name : props?.signer === null, "#301 loader: the Lead estimator from the roster (R16)");
    ok(props?.letterhead.src === "/_test/lh.jpg" || props?.letterhead.full === false, "#301 loader: the baked letterhead unless Branding has a logo");
    await Q.update(QID, { notIncluded: "" });
    const q2 = await Q.get(QID);
    ok(q2 ? (await loadCoverDocumentProps(q2, { origin: null, letterheadSrc: "x" })).notIncluded === "" : false, "#301 loader: an emptied Not included prints nothing");
  } finally {
    await setBlob("estimate_output_defaults", { notIncluded: saved.notIncluded ?? "", website: saved.website ?? "" });
  }
}
```

  Append `await e301CoverAsyncChecks();` at the end of `estimateOutput301AAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails** (ENOENT on the print page; the `"cover"` kind is a type error under tsc).

- [ ] **Step 3: The token kind.** In `src/lib/quote-pdf/token.ts` change the union to
  `export type PrintTokenKind = PdfKind | "part-thumb" | "cutsheets" | "rack" | "cover";` and extend its comment:
  "…#292's cut sheets, #296's rack sheets and #301's estimate cover, none of which prints a quote document."

- [ ] **Step 4: Create `src/lib/estimate-output/cover-loader.ts`.**

```ts
import { get as getCustomer } from "@/lib/stores/customers";
import { getSettings } from "@/lib/settings";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { allUsers } from "@/lib/users";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import { shareLinkView, shareSecret } from "@/lib/quote-share/links";
import { onlineEstimateState } from "@/lib/quote-share/view";
import type { Quote } from "@/lib/stores/quotes";
import { effectiveNotIncluded } from "./fields";
import { coverDocumentPropsFor, coverFooterLine, coverShareUrl, resolveCoverSigner, type CoverDocumentProps } from "./cover";

/**
 * #301 slice A — the cover PDF's props for a LIVE quote (staff can print a
 * draft — D-p). The same data path as the print route (customer, settings,
 * purchase perks → quoteDocumentDataFor), plus the roster (signer, R16), the
 * Settings → Estimate output blob (Not included default, website) and the
 * v1 client link (printed only while it is active and the online page shows
 * the estimate). No photos: the cover prints none.
 */
export async function loadCoverDocumentProps(
  q: Quote,
  opts: { origin: string | null; letterheadSrc: string; now?: number }
): Promise<CoverDocumentProps> {
  const now = opts.now ?? Date.now();
  const [cust, settings, perks, users, defaults] = await Promise.all([
    getCustomer(q.customerId),
    getSettings(),
    purchasePerksForCompany(q.customerId),
    allUsers(),
    getEstimateOutputDefaults(),
  ]);
  const doc = { ...quoteDocumentDataFor(q, cust, settings), rewardsLine: purchasePerksDocLine(perks) };
  const link = shareLinkView(q, shareSecret(), now);
  return coverDocumentPropsFor({
    doc,
    coverSummary: q.coverSummary || "",
    notIncluded: effectiveNotIncluded(q.notIncluded, defaults.notIncluded),
    signer: resolveCoverSigner(q.owner, q.preparedBy, users),
    footerLine: coverFooterLine({ companyName: doc.companyName, offices: settings.offices, website: defaults.website }),
    shareUrl: coverShareUrl(opts.origin, link, onlineEstimateState(q).kind),
    letterhead: settings.logoDark ? { src: settings.logoDark, full: false } : { src: opts.letterheadSrc, full: true },
  });
}
```

  (If `settings.offices` items' types don't match `CoverOffice` exactly, map them:
  `settings.offices.map((o) => ({ street: o.street, city: o.city, state: o.state, zip: o.zip, phone: o.phone, quoteDefault: o.quoteDefault }))`.)

- [ ] **Step 5: Create `src/app/print/cover/[id]/page.tsx`.**

```tsx
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import CoverDocument, { COVER_PRINT_CSS } from "@/components/estimate-output/cover-document";
import { loadCoverDocumentProps } from "@/lib/estimate-output/cover-loader";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimate cover", robots: { index: false, follow: false } };

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "cover", id, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * #301 slice A — the signed print route for a system estimate's cover PDF.
 * Outside the team login (middleware exempts /print/); the token is the only
 * key, checked before any read. Renders the LIVE quote (D-p). The link
 * line's origin is this request's print origin (QUOTE_PDF_ORIGIN in prod).
 */
export default async function PrintCoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = first(sp.t);
  if (!tokenOk(t, id)) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
  const h = await headers();
  const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  const props = await loadCoverDocumentProps(q, { origin: "origin" in where ? where.origin : null, letterheadSrc: letterhead.src });
  return (
    <main>
      <style>{COVER_PRINT_CSS}</style>
      <CoverDocument {...props} />
    </main>
  );
}
```

- [ ] **Step 6: Create `src/app/api/quotes/[id]/cover-pdf/route.ts`.**

```ts
import { attachmentDisposition } from "@/lib/document-files";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

/** R7: one headless-Chrome render of a 1–2 page cover. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #301 slice A — a system estimate's cover PDF for staff (D-p, R7): rendered
 * on demand from the live quote through the signed /print/cover/[id] route.
 * `?download=1` downloads; otherwise it opens inline. A service quote and an
 * unknown id answer the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the try: a signed-out request redirects to the login page.
  await requireUser();
  try {
    const { id } = await params;
    if (!id || id.length > 64) return text("Not found", 404);
    const q = await getQuote(id);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return text("Not found", 404);
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return text("Cover PDFs aren’t set up on this server (AUTH_SECRET is missing).", 503);
    const h = request.headers;
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) return text(where.error, 503);
    const t = signPrintToken(secret, "cover", q.id, Date.now());
    const pdf = await renderPrintRouteToPdf(`${where.origin}/print/cover/${encodeURIComponent(q.id)}?t=${encodeURIComponent(t)}`);
    const disposition = attachmentDisposition(coverPdfFileName(displayQuoteNumber(q)));
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return text(e.message, 503);
    console.error("[cover] cover PDF render failed", e);
    return text("The cover PDF couldn’t be rendered — try again.", 500);
  }
}
```

- [ ] **Step 7: The Cover PDF buttons.** In `src/app/(app)/estimator/cover-package-panel.tsx`, add a style and append inside
  the returned `<div>`, after the Not included hint:

```tsx
const actionLink: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, textAlign: "center", borderRadius: 8, padding: "9px 16px", textDecoration: "none", border: "none" };
```

```tsx
      {p.savedQuoteId ? (
        <>
          <a href={`/api/quotes/${encodeURIComponent(p.savedQuoteId)}/cover-pdf?download=1`} style={{ ...actionLink, color: "#fff", background: "var(--accent)" }}>
            Cover PDF
          </a>
          <a href={`/api/quotes/${encodeURIComponent(p.savedQuoteId)}/cover-pdf`} target="_blank" rel="noopener noreferrer" style={{ ...actionLink, color: "#16181d", background: "#f1f2f5" }}>
            Open cover ↗
          </a>
          {p.dirty && <span style={hint}>Save first — the cover prints the saved estimate.</span>}
        </>
      ) : (
        <>
          <span style={{ ...actionLink, color: "#9aa0ab", background: "#f1f2f5", cursor: "default" }}>Cover PDF</span>
          <span style={hint}>Save to create the cover.</span>
        </>
      )}
```

  The harness's `>Cover PDF<` check matches the one-line disabled `<span>`; keep that span on one line.

- [ ] **Step 8: Smoke routes.** In `scripts/smoke-routes.ts`, after
  `{ route: "/api/racks/SA-NOPE/submittal", expectNotFound: true },` add:

```ts
  // #301 — the cover print route: no token / a well-formed bad token is a clean 404 before any read.
  { route: "/print/cover/Q-2041", expectNotFound: true },
  { route: "/print/cover/Q-2041?t=1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", expectNotFound: true },
  // #301 — the cover PDF download: an unknown quote is a clean 404, never a render.
  { route: "/api/quotes/Q-0/cover-pdf", expectNotFound: true },
```

- [ ] **Step 9: Run the gates** (tsc; test:specs; eslint on `token.ts`, `cover-loader.ts`, the print page, the route,
  `cover-package-panel.tsx`, `scripts/smoke-routes.ts`; `next build` — it must list `/print/cover/[id]` and
  `/api/quotes/[id]/cover-pdf`).

- [ ] **Step 10: Commit.**

```bash
git add src/lib/quote-pdf/token.ts src/lib/estimate-output/cover-loader.ts "src/app/print/cover" "src/app/api/quotes/[id]/cover-pdf" "src/app/(app)/estimator/cover-package-panel.tsx" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice A — Cover PDF: signed /print/cover route, staff download, preview sidebar buttons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Final gates and the browser + PDF check

**Files:** none (verification only; fix in the owning task's files and amend with a new commit if anything fails).

- [ ] **Step 1: Full gates on the branch.**

```bash
cd /Users/sm/Downloads/peak-app-299 && export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E "tsx|next dev" | grep -v grep          # stop strays (smoke boots its own server)
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":3000|:3100|:3301" || true
df -h /System/Volumes/Data | tail -1
npx tsc --noEmit && echo TSC_OK
npm run test:specs 2>&1 | tail -3
git diff --name-only origin/main...HEAD | grep -E '^src/.*\.(ts|tsx)$' | xargs npx eslint
npx eslint scripts/smoke-routes.ts
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20
rm -rf .next && npm run test:smoke 2>&1 | tail -15
```
Expected: tsc 0; test:specs 0 FAIL (record PASS and the slice-A count = PASS − Task 1's baseline); eslint no new findings
vs the per-task baselines; build OK; smoke **209/209 ALL PASSED**. Record every number for the docs.

- [ ] **Step 2: Browser check on a scratch datadir (never `.data/pglite`).** Follow the memory notes
  `peak-exercising-post-routes-safely` and `peak-worktree-dev-server-browser-verification-traps`: same `AUTH_SECRET` as the
  main checkout (from `.env.local`), `localhost` not `127.0.0.1`, `lsof` the port first, unregister the service worker on
  first compile, don't click any upload/import (the dev server loads the real Blob token).

```bash
SCRATCH=$(mktemp -d) && echo $SCRATCH
PGLITE_PATH=$SCRATCH NEXT_TELEMETRY_DISABLED=1 npx next dev -p 3301   # run in the background
```
  1. Sign in (dev login, an Admin). **Settings → Sales & Rewards → Estimate output:** enter
     `Electrical work by others` / `Permits and fees` and website `peaksystemsgroup.com`, Save. Reload: values stay.
  2. Open `/venue-assessments/FS-1055`, answer the kill questions if locked, open **Lighting**: the **Client goals** box is
     the first field. Type `Even, glare-free front light for speech.` Save survey.
  3. Open `/estimator?surveyId=FS-1055`, link customer `lakefront`, rename System 1 to `Stage lighting`, add one catalog
     line. Reload with the same URL after saving once (`/estimator?id=<Q>&surveyId=FS-1055`): the system's **Client goals**
     fills with the survey text (the select shows `Discipline: auto (Lighting)`).
  4. Narrative column: **From site visit ▾** lists FS-1055 · date with a Lighting entry; clicking it doesn't duplicate.
     Write an intro of two paragraphs; the **Cover paragraph** chip reads `From intro` and its placeholder is the first
     paragraph. Select a sentence in the intro → **Use selection as cover** → chip `Override`. **Clear override** → back
     to `From intro`. Add a second system named `Rigging` with a line and no text: chip `Needs a paragraph`.
  5. Set Rigging's **Discipline** select to `Rigging`; Save.
  6. Customer preview → **Cover & package**: Not included shows the default list; type an Overall summary; edit Not
     included, then **Reset to default** restores it. Wait 1 s (autosave), then **Open cover ↗**.
  7. The cover PDF: letterhead; underlined centered title; the project block with `EST-#### Rev N`; the Stage lighting
     paragraph + bold `Stage lighting scope: $…`; the Rigging scope with grey italic `[needs a paragraph]`; the summary;
     `Total` equal to the estimate PDF's Total; `Not included: …`; no link line (never sent); the signature block with the
     Lead estimator's name/title/phone/email and the Accepted by / Date lines; the footer line on every page.
  8. Turn on Show on PDF → **Options**, mark a line optional, Save, re-open the cover: `ADD OPTION 1 — … $…`.
  9. Send the quote (Approve & send) and **Copy client link**; re-open the cover: the link line prints the share URL.
     Recall to draft: the link line disappears.
  10. Download the cover with **Cover PDF** and check it in Python (memory `reference-print-pdf-verification-harness`):

```bash
python3 - <<'EOF'
import glob, os
from pypdf import PdfReader
f = max(glob.glob(os.path.expanduser("~/Downloads/*Cover*.pdf")), key=os.path.getmtime)
r = PdfReader(f)
print(f, "pages:", len(r.pages))
for i, p in enumerate(r.pages):
    t = p.extract_text() or ""
    print(i + 1, "footer" if "peaksystemsgroup.com" in t else "NO FOOTER", "| fonts:", sorted({str(v.get("/BaseFont")) for v in (p["/Resources"].get("/Font") or {}).values()}) if "/Resources" in p else "")
EOF
```
     Expected: 1–2 pages; the footer on every page; a font name containing `Arial` (or the Helvetica/Liberation fallback —
     note which for Jeff).
  11. Narrow the window to 375 px on the Estimator's customer preview: the sidebar's new block wraps, no horizontal
      scroll. No console errors on any page.
  12. Stop the dev server (`lsof -nP -iTCP:3301 -sTCP:LISTEN`, then kill that PID) and `rm -rf "$SCRATCH"`.

---

### Task 10: Docs

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: Recompute the D-number and punch-number right before writing** (other sessions' branches hold numbers;
  the spec's tentative D613… and #301 may already be taken).

```bash
git fetch origin --quiet
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git show "$r:DECISIONS.md" 2>/dev/null | grep -oE '^## D[0-9]+' | sed 's/## D//'
done | sort -n | tail -1
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git show "$r:PUNCHLIST.md" 2>/dev/null | grep -oE '^## [0-9]+\.' | tr -dc '0-9\n'
done | sort -n | tail -1
```
Let `N` = max D + 1 (max at plan time: **D612** → N = 613) and confirm punch **#301** is still free (max at plan time:
**#300**); if #301 is taken by another branch, stop and ask. Slice A uses `D{N}`…`D{N+5}`. `grep` every ref's
DECISIONS.md for `D{N}` once more just before committing.

- [ ] **Step 2: Append the six DECISIONS entries** after the current last entry (substitute the real numbers):

```markdown
## D{N}. A system carries its discipline, client goals and cover paragraph (#301 slice A, 2026-10-05)

`SpecSection.discipline` (lighting / rigging / curtain / av — the survey's DisciplineKey), `clientGoals` (≤ 1,000) and
`coverText` (≤ 1,500), cleaned server-side beside the key-product sanitize on Save, Move and both Copies
(`withSanitizedOutputFields`). A blank discipline is inferred from the name by word-boundary keywords for goal matching and
display only, never stored (R19: `track` is never a keyword alone; labor systems never have one). They ride `spec`, so like
`room` an edit asks for a Save and re-renders the estimate PDF. Load system drops `clientGoals` and `coverText` (they were
written for another customer) and keeps the discipline (R5). (Spec D-b, §1, R5, R19.)

## D{N+1}. Client goals per site-visit discipline, copied into matching systems (#301 slice A, 2026-10-05)

The venue assessment's four discipline sections start with a **Client goals** box (`disciplines[key].goals`, ≤ 1,000,
inside the kill-question lock), cleaned in `saveSurvey` and `advanceSurveyStage` and again wherever copied (the sync push
path has no sanitizer). An Estimator opened with `?surveyId=` fills blank goals on systems whose discipline (stored, else
inferred) matches — automatically, once. **From site visit ▾** in the narrative column lists the quote's lead's and
customer's visits with goals (newest five) and appends one. `draftQuoteScopeAction` is unchanged. (Spec D-c superseded by
R3; R4.)

## D{N+2}. The cover paragraph rule (#301 slice A, 2026-10-05)

Override (`coverText`, set by typing or **Use selection as cover** on the intro) → the intro's first paragraph → for a labor
system, "Installation, commissioning & project management." → the first key product's first paragraph → the visible
"[needs a paragraph]" (grey italic on the PDF; never blocks). A source chip names which one prints. Scopes are the systems
the document prints, in order; a labor system is a scope (R2). (Spec D-a, D-d, R2.)

## D{N+3}. Overall summary + Not included live on the quote, not in the estimate PDF (#301 slice A, 2026-10-05)

`Quote.coverSummary` (≤ 3,000) and `notIncluded` (≤ 3,000, one per line) save with Save and autosave like the cover note;
not `QUOTE_CONTENT_FIELDS`, so neither re-renders the estimate PDF; frozen in each new revision's `docFields` (`notIncluded`
null = never stored). Absent `notIncluded` = the Settings default (the Estimator seeds the textarea with it, so the first
Save stores it); `""` prints nothing. A blank summary prints "This estimate includes N scopes: A, B and C." (Spec D-e, R14.)

## D{N+4}. Settings → Estimate output is a Sales & Rewards card (#301 slice A, 2026-10-05)

One settings blob `estimate_output_defaults` { notIncluded, website }, admin-only, kept by the go-live wipe. A card in the
existing Sales & Rewards group rather than a new menu group; the settings-cleanup harness pins (card list, count, markers)
were updated for the added card. (Spec R17.)

## D{N+5}. The Cover PDF (#301 slice A, 2026-10-05)

Rendered on demand from the LIVE quote (drafts too) through the signed `/print/cover/[id]` (print token kind `cover`, 120 s)
and the existing headless-Chrome renderer; downloaded from `/api/quotes/[id]/cover-pdf` (signed-in, 60 s, `printOriginFor`,
system quotes only, "EST-#### Cover.pdf"), from the customer preview's **Cover & package** block (no toolbar ⋯ entry —
that menu is QuoteNextStep's). Letter, 0.75in margins, Arial (Helvetica/Liberation fallback where Chrome has no Arial),
letterhead (Branding logo ?? the baked sheet), an underlined centered title, the project block, one paragraph + bold price
per scope, the summary, the totals lines exactly as the estimate (Rewards credit row, POR wording, purchase perks, standing
lines; Σ scope prices − credit = Total), ADD OPTION n when Options is on, Not included, the v1 client link while it's
active and the estimate is online (origin = the print origin — make covers from production), and the Lead estimator's
signature block (owner → Prepared by, unique roster name match; else the company) with Accepted by / Date lines. The footer
(company · primary office · phone · website) repeats on every page via a fixed footer over a repeating tfoot spacer.
(Spec §4, D-p, R1, R7, R16, R17.)
```

- [ ] **Step 3: Add the PUNCHLIST entry** at the end of `PUNCHLIST.md`:

```markdown
## 301. Estimates — two-prong output: Cover PDF + HTML package link — Slice A DONE 2026-10-05 (D{N}–D{N+5})

**Asked by Jeff 2026-10-05** (Cowork brief "Two-Prong Estimate Output"): one estimate, two client outputs — a short cover
PDF on letterhead and an online package link — plus a Client goals box per site-visit discipline. Spec:
`docs/superpowers/specs/2026-10-05-two-prong-estimate-output-design.md`; Slice A plan:
`docs/superpowers/plans/2026-10-05-estimate-output-slice-a.md`. No migration.

**Slice A DONE (D{N}–D{N+5}).**
- **Site visit:** a **Client goals** box at the top of each discipline section.
- **Estimator:** a **Discipline** select per system (blank = auto from the name); the narrative column gains **Client
  goals** (pre-filled from a linked site visit; **From site visit ▾**), a **Cover paragraph** override with a source chip,
  and **Use selection as cover** under the intro.
- **Customer preview → Cover & package:** Overall summary, Not included (+ **Reset to default**), **Cover PDF** /
  **Open cover ↗**.
- **Settings → Sales & Rewards → Estimate output:** the default Not included list and the website for the cover footer.

Gates: tsc 0; test:specs <PASS> PASS / 0 FAIL (<n> for #301 slice A); test:smoke 209/209 ALL PASSED; `next build` OK;
eslint no new findings on the changed src files.
Browser: <one sentence from Task 9 Step 2's real result, incl. page count and the font the PDF reports>.

**Slice B** (spec Phases 3 + 6): v2 rev-pinned links, the package page, BOM rows, superseded/revising banners, opens.
**Slice C** (Phases 4 + 5): datasheet zip, drawings, client actions + responses.

**For Jeff.**
1. Fill **Settings → Sales & Rewards → Estimate output** (Not included list, website).
2. Try a cover on a real quote: Lead estimator set, a narrative intro per system, Options on if it has add-ons.
3. Make covers from **production** — a cover made on a preview deploy prints the preview's address in the link line.
4. Check the font: production Chrome may not have Arial and prints Helvetica/Liberation Sans instead — OK?
5. Spec §13 questions (typed title/PO on accept; email on accept; import starter paragraphs) stay open for Slice C.

**Rollback.** Additive JSONB only (`SpecSection.discipline/clientGoals/coverText`, `Quote.coverSummary/notIncluded`, survey
`goals`, the `estimate_output_defaults` blob, revision `docFields` keys) — older code ignores them. Rolling back removes the
cover routes and the new fields' UI; the data stays and returns on the roll-forward.
```

- [ ] **Step 4: AGENTS.md** — append after item 39 (the #300 entry), before the line `QUESTIONS.md is the standing agenda…`:

```markdown
40. 🚧 **Two-prong estimate output** (#301, D{N}–D{N+5}) — Slice A ✅: systems carry a discipline (blank = inferred,
    never stored), client goals (pre-filled from the site visit's new per-discipline **Client goals** box; From site visit)
    and a cover paragraph override (`src/lib/estimate-output/`: `fields`, `goals`, `scopes`, `cover`); the quote carries an
    overall summary and a Not included list (default in Settings → Sales & Rewards → Estimate output, blob
    `estimate_output_defaults`); the customer preview's **Cover & package** block downloads a 1–2 page Arial **Cover PDF**
    of the live quote (`/print/cover/[id]`, print token `cover`; `/api/quotes/[id]/cover-pdf`) with per-scope paragraphs
    and prices, the estimate's own totals lines, add options, Not included, the client link and the Lead estimator's
    signature. Slices B (rev-pinned package page) and C (downloads, drawings, client actions) follow.
```

- [ ] **Step 5: Commit the docs.**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #301 slice A — PUNCHLIST, DECISIONS, AGENTS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage (Slice A).** §1 section fields → Task 1; quote fields → Task 1 (store) + Task 6 (save/UI); survey goals →
  Task 3. §2 `scopes.ts` → Task 2 (cover subset; adaptation 6). §3: survey box → Task 3; Discipline select, narrative-column
  Client goals / From site visit / Cover paragraph + chip / Use selection as cover → Task 4; Cover & package → Task 6;
  Settings → Task 5; goals pre-fill (R3, replacing D-c) → Tasks 3–4. §4 → Tasks 7–8. R1 → Task 2 invariant + Task 7 totals;
  R2 → Tasks 1–2; R4 → Task 3; R5 → Task 1; R7 → Task 8; R14 → Tasks 1, 6; R16 → Task 7; R17 → Tasks 5, 7; R19 → Task 1;
  R20 → type names throughout. §11 Slice A harness rows → each task's block; smoke `/print/cover` → Task 8; browser → Task 9.
- **Placeholders.** None: every code step has the code; the two "if the type/class differs" notes name the exact fallback.
- **Type consistency.** `ScopeDiscipline`, `DisciplineGoals`, `SiteVisitOption`, `CoverParagraph`/`CoverSource`,
  `OutputScope`, `AddOption`, `CoverTotals`, `CoverSigner`/`CoverUser`/`CoverOffice`, `CoverDocumentProps`, `CoverInput`,
  `EstimateOutputDefaults` are each defined once and used with the same names. `coverDocumentPropsFor` takes `footerLine`
  (a string) and `letterhead: { src, full }` in both Task 7 and Task 8.
