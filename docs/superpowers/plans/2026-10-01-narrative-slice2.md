# Narrative-first client preview — Slice 2 Implementation Plan (#293)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 2 of #293: a computed **system library** of every sent and won system, searchable from the
Estimator; **Load system** (a library system lands in this estimate, re-priced like Copy system); and **Merge
narrative** (append a library system's intro and key products into the active system).

**Architecture:**
- **Pure core.** `src/lib/narrative/system-library.ts` holds which quotes and systems are indexed, search and ranking,
  the browser-safe hit shape, library keys, the Load pick, client-side placement and the notices.
  `src/lib/narrative/merge.ts` holds `mergeNarrative` and its notice. Both are client-safe and harness-imported.
- **Server.** The catalog and fixture loading moves out of `copySystemToEstimateAction` into
  `estimator/copy-pricing.ts`, shared with Load. `lib/narrative/load-system.ts` is the DB-testable Load core.
  `lib/narrative/system-library-index.ts` caches the index per process for 5 minutes (the `portalIndex` idiom), and
  `setStatus` and `remove` invalidate it. `estimator/library-actions.ts` (`"use server"`) exposes search, one entry,
  and load.
- **UI.** One client modal, `estimator/system-library-modal.tsx`, serves two modes: `"load"`, opened from a new
  **+ From library…** button under **+ Add system**, and `"merge"`, opened from **Merge narrative from library…** in
  the narrative column's ⋯ menu.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19 server + client components, Drizzle/PGlite doc-store, tsx
harness (`scripts/test-review-and-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`. This plan covers Slice 2 only: §2.4,
§2.5, §4, the §6 rows that apply (library entry deleted since indexing; Daylite history and lost quotes never
indexed), §8.2, the Slice 2 parts of §9, and §10.

**Builds on Slice 1** (origin/main `72ad79dd`; D539–D545): `estimator/narrative.ts` (`KeyProduct` rules,
`remapKeyProducts`, `withKeyProducts`, `sanitizeKeyProducts`, `resolveKeyProducts`, `keyProductHeading`,
`isKeyProductEligible`, `MAX_*`), `estimator/narrative-column.tsx` (⋯ menu, `notice`, `onChange`) and
`estimator/copy-system.ts` (`copySectionForTarget`).

## Global Constraints

**Workspace and environment**
- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/narrative`, on branch `feat/293-narrative-client-preview`
  (its HEAD is origin/main `72ad79dd`, which contains Slice 1). Run `export PATH=$HOME/.local/node/bin:$PATH` before any
  `npx`/`npm`.
- **Never `git stash`.** The stash is shared across worktrees and other sessions. To set work aside, commit it instead.
- **Never open `/Users/sm/Downloads/peak-app/.data/pglite`** (the main checkout's dev DB). `npm run test:specs` uses its
  own `mktemp -d` datadir. Before you run it, check that no stray `tsx` is holding a DB: `ps aux | grep tsx`.
- **Disk is tight** (about 6–20 GB free; it was 97 % full when this plan was written). Run `df -h /System/Volumes/Data`
  before test:specs or a build. Above ~90 %, clean old temp datadirs with the guarded command
  `find $TMPDIR -maxdepth 1 \( -name 'tmp.*' -o -name 'peak-build-db-*' -o -name 'peak-smoke-*' \) -type d -mmin +60 -exec rm -rf {} +`.
  Always keep the `-mmin` guard. Run `rm -rf .next` before every `next build`.
- **A parallel branch, `feat/292-curtain-cut-sheets`, edits `estimator-client.tsx`, `section-card.tsx` and `types.ts`.**
  - Keep `estimator-client.tsx` edits small and **add-only**: one import line, one state line, one handler, one union
    member, one banner branch, one button and one modal mount.
  - Don't touch `section-card.tsx` or `types.ts` at all in this slice.

**Code rules**
- **Client components** (`"use client"`) must never value-import from `@/lib/stores/*`, `@/db/*`, `@/lib/session`,
  `@/lib/blob`, or a server-only narrative module: `lib/narrative/{library,photos,system-library-index,load-system}`.
  `estimator/copy-pricing.ts` is server-only too. Doing so breaks only `next build`. Type-only imports are fine, and so
  is importing a `"use server"` actions file. `lib/narrative/system-library.ts` and `lib/narrative/merge.ts` must stay
  client-safe: they may only value-import `estimator/narrative`, `estimator/freight-default`,
  `@/lib/quote-pdf/state`, `@/lib/estimate-number` and `@/lib/rewards/credit-line`.
- **No AI and no external service** anywhere (D89). Load and Merge only copy text that already exists.
- **Server actions never throw into a transition.** Every `await` of an action inside `startTransition` is wrapped in
  `try { … } catch { setErr(FAILED) }`, with `FAILED = "Could not reach the server. Try again."`. A throw would reach
  the error boundary and unmount the Estimator.
- **Confirms are inline, never `window.confirm()`.** It returns false with no dialog in the Capacitor shells.
- **Client-supplied section data is never trusted for Load.** The server re-reads the source quote by the library key.

**Library rules (spec §2.4, §4.1, decision 11)**
- **Indexed:** a quote whose `source` isn't `"daylite"`, whose `quoteType` is `"system"` **or absent** (absent means
  system, per the `Quote` type comment), and whose status is `sent` or `won`.
- **Spec:** the latest sent revision's `spec`. A won quote with no sent revision uses its live `spec` (`rev: null`,
  `at: updatedAt`). Anything else is skipped.
- **Systems skipped:** `kind === "labor"`, and any system with no lines once the Rewards credit line is removed.
- **Key:** `${quoteId}:${rev|"live"}:${sectionId}`.
- **Ranking:** won before sent, then `at` descending, then a `systemName` token match before a lines-only match.
  Default limit 50. Query length is capped at 200 characters.
- **Hits** sent to the browser carry no `intro`, `keyProducts`, `skus` or `descs`. They carry 140-character snippets
  and counts (`LIBRARY_SNIPPET = 140`).
- **Cache:** per process, `TTL_MS = 5 * 60 * 1000`, with a generation counter. It's invalidated after every real
  status transition (`setStatus`) and on quote `remove()`. Invalidation is per-instance, and the TTL covers the rest.

**Load rules (spec §4.2, decision 12)**
- **Source:** the server picks the snapshot by the rule **as of now**. If the quote was re-sent since indexing, the
  newest sent revision wins. A key whose quote or system is gone answers `LIBRARY_GONE` = "That estimate is no longer
  available", and invalidates the index.
- **Dropped:** vendor-quote lines (counted), the key-product blocks that pointed at them or at no line, the Rewards
  credit line, and `room`, which is job-specific.
- **Pricing:** `copyPricingFor(items)` plus `copySectionForTarget(sanitizeSystemSell(section), …)`, with the source tier
  = the snapshot's `tierMargin` and the target tier = the current estimate's `tierMargin`.
- **Client placement:** new id `"sys" + nextId()`, every item re-id'd through `nextId`, `keyProducts` remapped, auto
  freight applied when `freightAuto`, inserted after the active system, then selected.

**Merge rules (spec §2.5, decision 13)**
- **Append only.** An intro is skipped when empty or already contained, compared after whitespace normalization
  (case-sensitive).
- **Intro cap.** An intro whose append would push the narrative past `MAX_INTRO` (8,000) is skipped and counted. That's
  a plan-level addition.
- **Blocks.** A block's sku already featured here goes to `skippedPresent`. Otherwise it anchors to the first eligible
  line with that sku that has no block. With no such line, it goes to `skippedNoLine`. At `MAX_KEY_PRODUCTS` it goes
  to `skippedFull`. That's a separate list, deviating from the spec's lumping overflow into `skippedNoLine`, so the
  notice never says "add the part first" about a full system.
- **Presentation.** Merge never switches presentation; Draft narrative does.

**Copy (verbatim)**
- Buttons and menu items: "+ From library…", "Merge narrative from library…", "Load system", "Merge",
  "Has narrative".
- Modal titles: "System library", with aria-labels "Load a system from the library" and "Merge narrative from the
  library".
- Load note: "Re-priced at today's catalog and this estimate's tier. Vendor-quote lines are left out."
- Load notice: "Loaded <name> from EST-#### · N parts updated to today's cost · N lines re-priced to this estimate's
  tier · N vendor-quote lines left out". Singulars drop the "s"; zero parts are omitted.
- Merge notice: "Added intro from N systems · N key products · skipped N already featured · N not on this system (add
  the part first): SKU, SKU". Extra parts: "N over the 20-product limit" and "N intro(s) too long to append". When
  nothing applies: "Nothing to merge — this system already has it all".
- Row meta: "<customer> · EST-#### · Won|Sent · Sep 15, 2026" (America/Chicago). Counts: "N lines · N key products".
- Empty states:
  - "No sent or won systems match."
  - "Pick a system to see its intro and key products."
  - "Tick one or more systems to merge."
  - "That system is no longer in the library."
  - "No intro."
  - "No key products."
- `LIBRARY_GONE`: "That estimate is no longer available".

**Existing harness pins — do not break them**

The harness pins exact source strings in files this plan edits. Keep these substrings exactly:
- `actions.ts`:
  - `copySectionForTarget(sanitizeSystemSell(section),`
  - `newName: section.name + " (copy)"`
  - `newName: moved.name + " (moved)"`
  - `export async function copySystemToEstimateAction(`
  - `section = withSanitizedKeyProducts(section);` within the first 1,200 characters of that function
  - `payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts)`
  - `withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + Date.now() })])`
  - `quoteSearchRank(`
- `estimator-client.tsx`:
  - `remapKeyProducts(res.section.keyProducts, idMap)`
  - `<NarrativeColumn` followed by `key={narrSec.id}`
  - `onToggleKeyProduct={(itemId) => toggleKeyProductLine(sec.id, itemId)}`
  - `Object.hasOwn(kpLib.rows, sku)`
  - the two grid-template strings ending `104px"`
  - No value import from stores, db, blob, session or `lib/narrative/(library|photos)`.
- `narrative-column.tsx`:
  - `const NO_LIBRARY = "Could not load the library";`
  - `!Object.hasOwn(rows, s)`
  - the `onChange={(e) => { setIntroId(e.target.value); setDraftAsk(false);` block
  - "Save as intro", "Manage intros", "Needs the Create permission", "— none —", `upsertSystemIntroAction(`
  - the `const doSave = ` … `const onSave = ` and `const draft = ` … `const saveAsIntro = ` slices, unchanged

**One authorized change to an old check.** Spec §4.2 says the catalog and fixture loading is "a helper factored out
of `copySystemToEstimateAction`". The `#274B copy action` check (about line 38105 of the harness) reads
`ok(/if \(!it\.track\) fixtureIds\.add\(/.test(acts), …)`. Task 2 moves that code to `copy-pricing.ts`, so Task 2
retargets **only that one check's file**: keep the same regex and message, reading
`src("src/app/(app)/estimator/copy-pricing.ts")`. Every other old check that fails means: change your new code, never
the old check. If any other old check pins something this spec deliberately changes, stop and report it.

**Harness**
- Each task appends its checks at the **end** of `scripts/test-review-and-spec.ts`, under a
  `/* ===… #293 slice 2 — <part> …=== */` banner.
- Imports use the `n293s…`/`N293s…` alias prefix, distinct from Slice 1's `n293…`. They sit right above their block,
  as Slice 1's do.
- Async DB checks are `async function …293sAsyncChecks()` declarations. Each is chained with
  `.then(() => …293sAsyncChecks())` right after the line `.then(() => narrativeFinal293AsyncChecks())`, before
  `.finally(() => teardownFixtures())`.
- Fixtures use `fixtureId(293, "<slug>")` and `registerFixture(coll, id)`. Both names are in scope.

**Gates per task**
- `npx tsc --noEmit`: baseline 0 errors.
- `npm run test:specs`: baseline **10,530 PASS / 0 FAIL** (origin/main `72ad79dd`). It must stay 0 FAIL, with PASS =
  previous + new.
- `npx eslint <changed non-harness files>`. Never lint `scripts/test-review-and-spec.ts`: whole-file eslint crashes on it
  (a pre-existing problem). Expect 0 errors.
- `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` on every task that touches a client
  component (Tasks 3 and 4).
- The final task adds `npm run test:smoke`.

**Dates.** Timestamps are epoch-ms numbers.

**Merge-time watch item, not this slice's code.** #292 adds `SpecItem.curtainTrackKey` (`"ct-<line id at add
time>"`), which links a curtain to a track by string, across sections. A loaded system keeps its keys, exactly as
Copy here does, so a key can coincide with one already in the estimate. #292's `linkCurtainTracks` reports that as a
duplicate. Whoever merges second should check that Load and Copy here behave alike.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/narrative/system-library.ts` | create | Pure, client-safe: entry and hit types, `librarySourceOf`, `systemLibraryEntries`, `searchSystemLibrary`, `toLibraryHit`, `parseLibraryKey`, `librarySectionForLoad`, `placeLoadedSection`, `loadNotice`, `libraryRowMeta`, `libraryRowCounts`, the Load result types and `LIBRARY_GONE` |
| `src/lib/narrative/merge.ts` | create | Pure, client-safe: `mergeNarrative`, `mergeNotice`, `MergeOpts`, `MergeResult` |
| `src/app/(app)/estimator/copy-pricing.ts` | create | Server: `copyPricingFor(items)` — today's catalog + resolved fixtures (moved verbatim from `copySystemToEstimateAction`) |
| `src/app/(app)/estimator/actions.ts` | modify | `copySystemToEstimateAction` calls `copyPricingFor(items)`; drop the now-unused imports |
| `src/lib/narrative/system-library-index.ts` | create | Server: 5-minute per-process cache, `systemLibraryIndex()`, `invalidateSystemLibrary()` |
| `src/lib/narrative/load-system.ts` | create | Server: `loadLibrarySystem(key, targetTierMargin)` (the DB-testable Load core) |
| `src/lib/stores/quotes.ts` | modify | `invalidateSystemLibrarySafely()`, called after a real `setStatus` transition and in `remove()` |
| `src/app/(app)/estimator/library-actions.ts` | create | `"use server"`: `searchSystemLibraryAction`, `getSystemLibraryEntryAction`, `loadLibrarySystemAction` |
| `src/app/(app)/estimator/system-library-modal.tsx` | create | Client: the shared library modal (load and merge modes) |
| `src/app/(app)/estimator/estimator-client.tsx` | modify | Add-only: the + From library… button, `placeLibrarySystem`, the "Loaded" notice, the modal mount |
| `src/app/(app)/estimator/narrative-column.tsx` | modify | ⋯ → Merge narrative from library…, the merge apply and its notice |
| `scripts/test-review-and-spec.ts` | modify | The `#293 slice 2` blocks, plus the one authorized retarget |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` | modify | Final docs task |

## Task overview

| # | Task | Depends on |
|---|---|---|
| 1 | Pure core: system library + Merge narrative | none |
| 2 | Server: copy-pricing factor-out, Load core, index cache + invalidation, actions | 1 |
| 3 | Library modal (load and merge modes) + Load system wiring in the Estimator | 1, 2 |
| 4 | Merge narrative wiring in the narrative column | 1, 2, 3 |
| 5 | Final gates (smoke + build), browser check, docs | 1–4 |

---

### Task 1: Pure core — system library + Merge narrative

**Files:**
- Create: `src/lib/narrative/system-library.ts`
- Create: `src/lib/narrative/merge.ts`
- Test: `scripts/test-review-and-spec.ts` (append the block `#293 slice 2 — pure rules`)

**Interfaces:**
- **Consumes** from `@/app/(app)/estimator/narrative`: `MAX_INTRO`, `MAX_KEY_PRODUCTS`, `MAX_PARAGRAPH`,
  `isKeyProductEligible`, `keyProductHeading`, `remapKeyProducts`, `resolveKeyProducts`, `sanitizeKeyProducts` and
  `withKeyProducts`. Also `latestSentRevision` (`@/lib/quote-pdf/state`), `displayQuoteNumber`
  (`@/lib/estimate-number`), `isRewardCreditItem` (`@/lib/rewards/credit-line`) and `applyAutoFreight`
  (`@/app/(app)/estimator/freight-default`).
- **Produces** (exact names, used by Tasks 2–4):
  - Types: `LibraryKeyProduct`, `SystemLibraryEntry`, `SystemLibraryHit`, `LibrarySource`, `LoadedLibrarySystem`,
    `LoadLibrarySystemResult`.
  - Constants: `LIBRARY_SNIPPET`, `LIBRARY_SEARCH_LIMIT`, `LIBRARY_QUERY_MAX`, `LIBRARY_GONE`.
  - Functions: `librarySourceOf(q)`, `systemLibraryEntries(quotes, customerNames)`,
    `searchSystemLibrary(entries, query, opts?)`, `toLibraryHit(e)`, `parseLibraryKey(key)`,
    `librarySectionForLoad(q, sectionId)`, `placeLoadedSection(section, opts)`, `loadNotice(r)`, `libraryRowMeta(h)`
    and `libraryRowCounts(h)`.
  - From `merge.ts`: `MergeOpts`, `MergeSource`, `MergeResult`, `mergeNarrative(target, sources, opts)` and
    `mergeNotice(r)`.

- [ ] **Step 1: Write the failing harness block.** Append at the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #293 slice 2 — pure rules: the system library (which quotes and
   systems are indexed, search + ranking, hits, keys, the Load pick and
   placement, notices) and Merge narrative.
   ====================================================================== */
import {
  systemLibraryEntries as n293sEntries, searchSystemLibrary as n293sSearch, toLibraryHit as n293sHit,
  parseLibraryKey as n293sParseKey, librarySourceOf as n293sSource, librarySectionForLoad as n293sForLoad,
  placeLoadedSection as n293sPlace, loadNotice as n293sLoadNotice, libraryRowMeta as n293sRowMeta,
  libraryRowCounts as n293sRowCounts, LIBRARY_SNIPPET as n293sSnip, LIBRARY_SEARCH_LIMIT as n293sLimit,
  LIBRARY_GONE as n293sGone, type SystemLibraryEntry as N293sEntry,
} from "@/lib/narrative/system-library";
import { mergeNarrative as n293sMerge, mergeNotice as n293sMergeNotice } from "@/lib/narrative/merge";
import type { Quote as N293sQuote } from "@/lib/stores/quotes";
import type { SpecItem as N293sItem, SpecSection as N293sSec } from "@/app/(app)/estimator/types";
{
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const it = (id: number, sku: string, extra: Partial<N293sItem> = {}): N293sItem =>
    ({ id, sku, desc: "Desc " + sku, qty: 1, unit: "ea", cost: 10, price: 20, ...extra } as N293sItem);
  const sec = (id: string, name: string, items: N293sItem[], extra: Partial<N293sSec> = {}): N293sSec =>
    ({ id, name, kind: "materials", mfr: "", freightPct: 0, items, ...extra });
  const rev = (n: number, reason: "manual" | "sent", at: number, sections: N293sSec[], tierMargin = 0.3) =>
    ({ rev: n, at, by: "t", reason, note: "", name: "Rev " + n, value: 0, margin: 0, status: "sent", tierMargin, spec: { sections, mobs: [] } });
  const quote = (id: string, status: string, extra: Record<string, unknown> = {}): N293sQuote =>
    ({ id, name: "Quote " + id, customer: "Denorm " + id, customerId: null, locationId: null, value: 0, margin: 0, status,
       source: "estimator", quoteType: "system", owner: "t", createdAt: 1, updatedAt: 1000, spec: null, ...extra } as unknown as N293sQuote);

  // ---- which quotes and systems are indexed ----
  const lighting = sec("sysA", "Main Lighting", [
    it(1, "ETC-S4"),
    it(2, "CUSTOM-X", { custom: true }),
    it(3, "", { rewardCredit: true, qty: 1, price: -50 }),
    it(5, "VQ-1", { vendorQuoteId: "vq1", desc: "Vendor rig" }),
  ], {
    narrative: "  Our lighting.  ", presentation: "narrative", room: "Stage left",
    keyProducts: [
      { lineKey: "1", sku: "ETC-S4", text: "S4 para", photo: true },
      { lineKey: "9", sku: "GONE", text: "x", photo: true },
      { lineKey: "5", sku: "VQ-1", text: "Vendor para", photo: true },
    ],
  });
  const QS = quote("QS", "sent", {
    customerId: "C1", estNo: 1005, updatedAt: 9000,
    spec: { sections: [sec("sysLive", "Live only edit", [it(1, "LIVE")])], mobs: [] },
    revisions: [
      rev(1, "manual", 1000, [sec("sysOld", "Old manual", [it(1, "OLD")])]),
      rev(2, "sent", 5000, [lighting, sec("sysL", "Labor", [it(4, "LAB", { labor: true })], { kind: "labor" }), sec("sysE", "Empty", [])]),
      rev(3, "manual", 6000, [sec("sysLater", "Later manual", [it(1, "LATER")])]),
    ],
  });
  const QD = quote("QD", "draft", { revisions: [rev(1, "sent", 4000, [sec("d", "Recalled draft", [it(1, "D")])])] });
  const QL = quote("QL", "lost", { revisions: [rev(1, "sent", 4000, [sec("l", "Lost one", [it(1, "L")])])] });
  const QDL = quote("QDL", "won", { source: "daylite", spec: { sections: [sec("h", "History", [it(1, "H")])] } });
  const QF = quote("QF", "sent", { quoteType: "flame_test", revisions: [rev(1, "sent", 4000, [sec("f", "Flame", [it(1, "F")])])] });
  const QW = quote("QW", "won", { updatedAt: 3000, spec: { sections: [sec("sysW", "Rigging", [it(1, "RIG-1")])], mobs: [] } });
  const QA = quote("QA", "sent", { quoteType: undefined, revisions: [rev(1, "sent", 7000, [sec("sysA2", "Audio", [it(1, "SPK-1")])])] });
  const QX = quote("QX", "sent", { spec: { sections: [sec("x", "Never cut", [it(1, "X")])] } });
  const QJ = quote("QJ", "won", { spec: "junk" });
  const names = new Map([["C1", "Lakefront HS"]]);
  const all = n293sEntries([QS, QD, QL, QDL, QF, QW, QA, QX, QJ], names);

  ok(eq(all.map((e) => e.key), ["QW:live:sysW", "QA:1:sysA2", "QS:2:sysA"]),
    "#293s library: sent + won system quotes only (draft, lost, Daylite, flame, never-sent and junk specs skipped); won first, then newest");
  const s = all.find((e) => e.quoteId === "QS")!;
  ok(s.systemName === "Main Lighting" && s.rev === 2 && s.at === 5000 && s.status === "sent",
    "#293s library: a sent quote indexes its LATEST SENT revision — not the live edit, not a later manual revision");
  ok(s.customer === "Lakefront HS" && s.estNumber === "EST-1005" && s.quoteName === "Quote QS" && s.intro === "Our lighting." && s.presentation === "narrative",
    "#293s library: customer from the directory name, estimate number, trimmed intro, presentation");
  ok(s.lineCount === 3 && eq(s.skus, ["ETC-S4", "CUSTOM-X", "VQ-1"]),
    "#293s library: the Rewards credit line is excluded from counts and skus");
  ok(eq(s.keyProducts.map((k) => k.sku), ["ETC-S4", "VQ-1"]) && s.keyProducts[0].heading === "Desc ETC-S4",
    "#293s library: only resolved key products are indexed, with their printed heading");
  ok(!all.some((e) => e.sectionId === "sysL" || e.sectionId === "sysE"), "#293s library: labor and empty systems are skipped");
  const w = all.find((e) => e.quoteId === "QW")!;
  ok(w.rev === null && w.at === 3000 && w.status === "won" && w.customer === "Denorm QW", "#293s library: won-without-send uses the live spec and updatedAt; the denormalized customer is the fallback");
  ok(n293sSource(QD) === null && n293sSource(QL) === null && n293sSource(QDL) === null && n293sSource(QF) === null && n293sSource(QX) === null && n293sSource(QS)?.tierMargin === 0.3,
    "#293s library: librarySourceOf is null for draft / lost / Daylite / service / never-sent; a revision carries its tierMargin");

  // ---- search and ranking ----
  ok(eq(n293sSearch(all, "lighting lakefront").map((e) => e.key), ["QS:2:sysA"]), "#293s search: every token must match somewhere (name + customer)");
  ok(eq(n293sSearch(all, "etc-s4").map((e) => e.key), ["QS:2:sysA"]) && eq(n293sSearch(all, "vendor rig").map((e) => e.key), ["QS:2:sysA"]),
    "#293s search: matches a sku or a line description, case-insensitively");
  ok(n293sSearch(all, "EST-1005").length === 1 && n293sSearch(all, "quote qa").length === 1, "#293s search: matches the estimate number and the quote name");
  ok(n293sSearch(all, "lighting rigging").length === 0, "#293s search: tokens AND, they don't OR");
  ok(eq(n293sSearch(all, "").map((e) => e.key), ["QW:live:sysW", "QA:1:sysA2", "QS:2:sysA"]), "#293s search: an empty query lists everything won → sent → newest");
  const QT = quote("QT", "sent", { revisions: [rev(1, "sent", 4000, [
    sec("b", "Audio", [it(1, "CBL", { desc: "Speaker cable" })]),
    sec("a", "Speakers", [it(1, "SPK")]),
  ])] });
  ok(eq(n293sSearch(n293sEntries([QT], new Map()), "speaker").map((e) => e.sectionId), ["a", "b"]),
    "#293s search: with equal status and date, a system-name match ranks before a lines-only match");
  ok(eq(n293sSearch(all, "", { hasNarrative: true }).map((e) => e.key), ["QS:2:sysA"]), "#293s search: Has narrative keeps systems with an intro or key products");
  const many = Array.from({ length: 60 }, (_, i) => quote("QM" + i, "won", { updatedAt: i, spec: { sections: [sec("m", "Many " + i, [it(1, "M")])] } }));
  const manyEntries = n293sEntries(many, new Map());
  ok(n293sLimit === 50 && n293sSearch(manyEntries, "").length === 50 && n293sSearch(manyEntries, "", { limit: 3 }).length === 3,
    "#293s search: 50 by default, a smaller limit honored");

  // ---- hits never carry text bodies ----
  const longIntro = sec("sysLong", "Long", [it(1, "LNG")], { narrative: "word ".repeat(80) });
  const hit = n293sHit(n293sEntries([quote("QH", "won", { spec: { sections: [longIntro] } })], new Map())[0]);
  ok(!("intro" in hit) && !("keyProducts" in hit) && !("skus" in hit) && !("descs" in hit) && hit.introSnippet.length <= n293sSnip && n293sSnip === 140,
    "#293s hits: the list gets a ≤140-char intro snippet and counts — never the intro, block texts, skus or descriptions");
  const sHit = n293sHit(s);
  ok(sHit.keyProductCount === 2 && sHit.keyProductSnippets[0].sku === "ETC-S4" && sHit.keyProductSnippets[0].snippet === "S4 para" && sHit.lineCount === 3,
    "#293s hits: key-product count and per-block snippets");

  // ---- keys ----
  ok(eq(n293sParseKey("Q-2041:3:sys12"), { quoteId: "Q-2041", rev: 3, sectionId: "sys12" }) && eq(n293sParseKey("Q-dl-9:live:sysA"), { quoteId: "Q-dl-9", rev: null, sectionId: "sysA" }),
    "#293s keys: quoteId:rev:sectionId, with live for won-without-send");
  ok(n293sParseKey("bad") === null && n293sParseKey("Q:x:y") === null && n293sParseKey("") === null, "#293s keys: malformed keys parse to null");

  // ---- the Load pick ----
  const pick = n293sForLoad(QS, "sysA")!;
  ok(!!pick && eq(pick.section.items.map((x) => x.id), [1, 2]) && pick.vendorLinesDropped === 1 && pick.source.tierMargin === 0.3,
    "#293s load: vendor-quote lines and the Rewards credit are left out (counted); the snapshot's tier is the source tier");
  ok(eq(pick.section.keyProducts, [{ lineKey: "1", sku: "ETC-S4", text: "S4 para", photo: true }]) && !("room" in pick.section) && pick.section.narrative === "  Our lighting.  ",
    "#293s load: blocks on dropped or missing lines go, room (job-specific) goes, the narrative carries");
  ok(n293sForLoad(QS, "sysL") === null && n293sForLoad(QS, "nope") === null && n293sForLoad(QD, "d") === null && n293sForLoad(QS, "sysLive") === null,
    "#293s load: labor, unknown, draft and live-only-after-send systems are refused");
  ok(n293sGone === "That estimate is no longer available", "#293s load: the gone message is the spec's copy");

  // ---- placement on the client ----
  let n = 500;
  const placed = n293sPlace({ ...pick.section, freightAuto: true, freightPct: 9 }, { id: "sys777", nextId: () => ++n, autoFreightPct: 4 });
  ok(placed.id === "sys777" && eq(placed.items.map((x) => x.id), [501, 502]) && eq(placed.keyProducts, [{ lineKey: "501", sku: "ETC-S4", text: "S4 para", photo: true }]),
    "#293s place: fresh section id, items re-id'd through nextId, blocks follow their lines");
  ok(placed.freightPct === 4 && n293sPlace({ ...pick.section, freightPct: 9 }, { id: "s", nextId: () => ++n, autoFreightPct: 4 }).freightPct === 9,
    "#293s place: an auto-freight system takes this estimate's default; a hand-set freight is kept");
  ok(!("keyProducts" in n293sPlace(sec("z", "Z", [it(1, "Z")]), { id: "s", nextId: () => ++n, autoFreightPct: 0 })), "#293s place: no blocks → no key (back-compat shape)");

  // ---- notices and row text ----
  ok(n293sLoadNotice({ systemName: "Main Lighting", estNumber: "EST-1005", costsUpdated: 3, tierRepriced: 0, vendorLinesDropped: 1 }) ===
    "Loaded Main Lighting from EST-1005 · 3 parts updated to today's cost · 1 vendor-quote line left out", "#293s notice: Load reports cost moves and left-out vendor lines");
  ok(n293sLoadNotice({ systemName: "A", estNumber: "Q-1", costsUpdated: 1, tierRepriced: 2, vendorLinesDropped: 0 }) ===
    "Loaded A from Q-1 · 1 part updated to today's cost · 2 lines re-priced to this estimate's tier", "#293s notice: singular/plural and the tier move");
  const rowHit = { ...sHit, status: "won" as const, at: Date.UTC(2026, 8, 15, 18) };
  ok(n293sRowMeta(rowHit) === "Lakefront HS · EST-1005 · Won · Sep 15, 2026" && n293sRowCounts(sHit) === "3 lines · 2 key products",
    "#293s rows: customer · EST · Won|Sent · date, then line and key-product counts");

  // ---- Merge narrative ----
  const target = sec("t", "Target", [it(10, "ETC-S4"), it(11, "SPK"), it(12, "OPT", { option: true }), it(13, "SPK")], {
    narrative: "Existing intro.", keyProducts: [{ lineKey: "11", sku: "SPK", text: "mine", photo: true }],
  });
  const S1 = { systemName: "A", intro: "Our lighting.", keyProducts: [
    { sku: "ETC-S4", text: "S4 para", photo: false }, { sku: "SPK", text: "x", photo: true },
    { sku: "OPT", text: "o", photo: true }, { sku: "NOPE", text: "n", photo: true },
  ] };
  const S2 = { systemName: "B", intro: "  Our \n lighting. ", keyProducts: [{ sku: "ETC-S4", text: "again", photo: true }] };
  const S3 = { systemName: "C", intro: "Second intro.", keyProducts: [] };
  const m = n293sMerge(target, [S1, S2, S3], { intro: true, products: true });
  ok(m.section.narrative === "Existing intro.\n\nOur lighting.\n\nSecond intro." && m.introsAppended === 2,
    "#293s merge: intros append after a blank line; one already present (after whitespace normalization) is skipped");
  ok(eq(m.section.keyProducts, [{ lineKey: "11", sku: "SPK", text: "mine", photo: true }, { lineKey: "10", sku: "ETC-S4", text: "S4 para", photo: false }]) && m.productsAdded === 1,
    "#293s merge: a block anchors to the first eligible unmarked line with its sku, carrying text and photo");
  ok(eq(m.skippedPresent, ["SPK", "ETC-S4"]) && eq(m.skippedNoLine, ["OPT", "NOPE"]) && m.skippedFull.length === 0,
    "#293s merge: already featured → skippedPresent; no eligible line (an option, or absent) → skippedNoLine — never invented");
  ok(n293sMergeNotice(m) === "Added intro from 2 systems · 1 key product · skipped 2 already featured · 2 not on this system (add the part first): OPT, NOPE",
    "#293s merge: the notice reads as the spec writes it");
  ok(n293sMergeNotice({ ...m, introsAppended: 2, productsAdded: 4, skippedPresent: ["a", "b"], skippedNoLine: ["X", "Y", "Z"], skippedFull: [], introsTooLong: 0 }) ===
    "Added intro from 2 systems · 4 key products · skipped 2 already featured · 3 not on this system (add the part first): X, Y, Z", "#293s merge: the spec's example notice");
  ok(n293sMerge(sec("e", "E", [it(1, "A")]), [S3], { intro: true, products: true }).section.narrative === "Second intro.", "#293s merge: into an empty narrative, no leading blank line");
  const introOff = n293sMerge(target, [S1], { intro: false, products: true });
  const prodOff = n293sMerge(target, [S1], { intro: true, products: false });
  ok(introOff.section.narrative === "Existing intro." && introOff.productsAdded === 1 && eq(prodOff.section.keyProducts, target.keyProducts) && prodOff.introsAppended === 1,
    "#293s merge: Intro and Key products can each be turned off");
  const fullItems = Array.from({ length: 21 }, (_, i) => it(i + 1, "F" + i));
  const full = sec("f", "Full", fullItems, { keyProducts: fullItems.slice(0, 20).map((x) => ({ lineKey: String(x.id), sku: x.sku, text: "", photo: true })) });
  const fm = n293sMerge(full, [{ systemName: "X", intro: "", keyProducts: [{ sku: "F20", text: "t", photo: true }] }], { intro: true, products: true });
  ok(eq(fm.skippedFull, ["F20"]) && fm.skippedNoLine.length === 0 && !fm.changed && /over the 20-product limit/.test(n293sMergeNotice(fm)),
    "#293s merge: at MAX_KEY_PRODUCTS the overflow is reported as over the limit, not as a missing part");
  const same = n293sMerge(target, [{ systemName: "Y", intro: "Existing intro.", keyProducts: [{ sku: "SPK", text: "", photo: true }] }], { intro: true, products: true });
  ok(!same.changed && same.section === target && n293sMergeNotice({ ...same, skippedPresent: [] }) === "Nothing to merge — this system already has it all",
    "#293s merge: nothing to add → the same object, changed false");
  const long = n293sMerge(sec("g", "G", [it(1, "A")], { narrative: "x".repeat(7990) }), [{ systemName: "L", intro: "y".repeat(20), keyProducts: [] }], { intro: true, products: false });
  ok(long.introsTooLong === 1 && !long.changed, "#293s merge: an intro that would push the narrative past MAX_INTRO is skipped and counted");

  // ---- client-safety of the pure modules ----
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const serverImport = (src: string) => /^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/session|lib\/blob|lib\/narrative\/(library|photos|system-library-index|load-system))/m.test(src);
  ok(!serverImport(rd("src/lib/narrative/system-library.ts")) && !serverImport(rd("src/lib/narrative/merge.ts")),
    "#293s pure: system-library.ts and merge.ts value-import no store, db, session, blob or server-only narrative module (client-safe)");
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit 2>&1 | head -5
```

Expected: tsc fails with `Cannot find module '@/lib/narrative/system-library'` and `'@/lib/narrative/merge'`.

- [ ] **Step 3: Create `src/lib/narrative/system-library.ts`**

```ts
import type { Quote } from "@/lib/stores/quotes";
import type { KeyProduct, SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { latestSentRevision } from "@/lib/quote-pdf/state";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { applyAutoFreight } from "@/app/(app)/estimator/freight-default";
import {
  keyProductHeading,
  remapKeyProducts,
  resolveKeyProducts,
  sanitizeKeyProducts,
  withKeyProducts,
} from "@/app/(app)/estimator/narrative";

/**
 * #293 slice 2 — the system library: every system on a SENT or WON system
 * quote, read from that quote's latest sent revision (a won quote with no
 * sent revision uses its live spec). Computed, never curated — drafts,
 * post-send edits, lost quotes, Daylite history and service quotes never
 * appear. Pure and client-safe: the server index, the Load core, the
 * library modal and the harness all share it.
 */

export const LIBRARY_SNIPPET = 140;
export const LIBRARY_SEARCH_LIMIT = 50;
export const LIBRARY_QUERY_MAX = 200;
export const LIBRARY_GONE = "That estimate is no longer available";

export type LibraryKeyProduct = KeyProduct & { heading: string };

export type SystemLibraryEntry = {
  /** `${quoteId}:${rev|"live"}:${sectionId}` */
  key: string;
  quoteId: string;
  estNumber: string;
  quoteName: string;
  customer: string;
  status: "won" | "sent";
  /** The sent revision's `at`; won-without-send: the quote's updatedAt. */
  at: number;
  rev: number | null;
  sectionId: string;
  systemName: string;
  /** The section's narrative, trimmed. */
  intro: string;
  /** Resolved ("ok") blocks only, each with the heading it prints under. */
  keyProducts: LibraryKeyProduct[];
  lineCount: number;
  skus: string[];
  descs: string[];
  presentation: "itemized" | "narrative";
};

/** What the browser list gets: no intro, block text, skus or descriptions —
 *  140-char snippets and counts (spec §4.1). */
export type SystemLibraryHit = {
  key: string;
  quoteId: string;
  estNumber: string;
  quoteName: string;
  customer: string;
  status: "won" | "sent";
  at: number;
  rev: number | null;
  sectionId: string;
  systemName: string;
  lineCount: number;
  presentation: "itemized" | "narrative";
  introSnippet: string;
  keyProductCount: number;
  keyProductSnippets: Array<{ sku: string; heading: string; snippet: string }>;
};

export type LibrarySource = { spec: unknown; rev: number | null; at: number; status: "won" | "sent"; tierMargin: number | null };

/** Load system's answer (here, not in the "use server" file, so client
 *  components can name the type). */
export type LoadedLibrarySystem = {
  ok: true;
  section: SpecSection;
  systemName: string;
  estNumber: string;
  costsUpdated: number;
  tierRepriced: number;
  vendorLinesDropped: number;
};
export type LoadLibrarySystemResult = LoadedLibrarySystem | { ok: false; error: string };

/** Which snapshot of this quote the library reads, or null when the quote
 *  isn't in the library. The Daylite test mirrors isImportedHistoryQuote
 *  (stores/quotes.ts) — inlined because this module must stay client-safe. */
export function librarySourceOf(q: Quote): LibrarySource | null {
  if (!q || typeof q !== "object") return null;
  if (q.source === "daylite") return null;
  if ((q.quoteType || "system") !== "system") return null;
  if (q.status !== "sent" && q.status !== "won") return null;
  const sent = latestSentRevision(Array.isArray(q.revisions) ? q.revisions : []);
  if (sent) return { spec: sent.spec, rev: sent.rev, at: sent.at, status: q.status, tierMargin: sent.tierMargin ?? null };
  if (q.status === "won") return { spec: q.spec, rev: null, at: q.updatedAt || 0, status: "won", tierMargin: q.tierMargin ?? null };
  return null;
}

function sectionsOf(spec: unknown): SpecSection[] {
  const secs = spec && typeof spec === "object" ? (spec as { sections?: unknown }).sections : null;
  if (!Array.isArray(secs)) return [];
  return secs.filter(
    (s): s is SpecSection => !!s && typeof s === "object" && typeof (s as SpecSection).id === "string" && Array.isArray((s as SpecSection).items)
  );
}

/** A system's lines without the Rewards credit (and without junk rows). */
function linesOf(sec: SpecSection): SpecItem[] {
  return sec.items.filter((it): it is SpecItem => !!it && typeof it === "object" && !isRewardCreditItem(it));
}

const distinct = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const statusRank = (s: "won" | "sent"): number => (s === "won" ? 0 : 1);

export function systemLibraryEntries(quotes: Quote[], customerNames: ReadonlyMap<string, string>): SystemLibraryEntry[] {
  const out: SystemLibraryEntry[] = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const src = librarySourceOf(q);
    if (!src) continue;
    const customer = (q.customerId && customerNames.get(q.customerId)) || q.customer || "";
    const estNumber = displayQuoteNumber(q);
    for (const sec of sectionsOf(src.spec)) {
      if (sec.kind === "labor") continue;
      const items = linesOf(sec);
      if (!items.length) continue;
      const clean: SpecSection = { ...sec, items, keyProducts: sanitizeKeyProducts(sec.keyProducts) };
      const keyProducts = resolveKeyProducts(clean).flatMap((r) =>
        r.status === "ok" ? [{ lineKey: r.kp.lineKey, sku: r.kp.sku, text: r.kp.text, photo: r.kp.photo, heading: keyProductHeading(r.item) }] : []
      );
      out.push({
        key: `${q.id}:${src.rev ?? "live"}:${sec.id}`,
        quoteId: q.id,
        estNumber,
        quoteName: q.name || "",
        customer,
        status: src.status,
        at: src.at,
        rev: src.rev,
        sectionId: sec.id,
        systemName: typeof sec.name === "string" ? sec.name : "",
        intro: typeof sec.narrative === "string" ? sec.narrative.trim() : "",
        keyProducts,
        lineCount: items.length,
        skus: distinct(items.map((it) => (typeof it.sku === "string" ? it.sku : ""))),
        descs: distinct(items.map((it) => (typeof it.desc === "string" ? it.desc : ""))),
        presentation: sec.presentation === "narrative" ? "narrative" : "itemized",
      });
    }
  }
  // Stable: ties keep the input order (getAll is newest-first, then section order).
  return out.sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.at - a.at);
}

/** Every token must match (case-insensitively) in the system name, customer,
 *  quote name, estimate number, a sku or a line description. Ranking: won
 *  before sent, newest first, then a system-name match before a lines-only one. */
export function searchSystemLibrary(
  entries: SystemLibraryEntry[],
  query: string,
  opts: { hasNarrative?: boolean; limit?: number } = {}
): SystemLibraryEntry[] {
  const tokens = String(query ?? "").slice(0, LIBRARY_QUERY_MAX).toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.floor(opts.limit ?? LIBRARY_SEARCH_LIMIT));
  const scored: Array<{ e: SystemLibraryEntry; i: number; n: number }> = [];
  (Array.isArray(entries) ? entries : []).forEach((e, i) => {
    if (opts.hasNarrative && !e.intro && !e.keyProducts.length) return;
    const name = e.systemName.toLowerCase();
    const hay = [name, e.customer, e.quoteName, e.estNumber, ...e.skus, ...e.descs].map((s) => s.toLowerCase());
    if (!tokens.every((t) => hay.some((h) => h.includes(t)))) return;
    scored.push({ e, i, n: tokens.some((t) => name.includes(t)) ? 0 : 1 });
  });
  scored.sort((a, b) => statusRank(a.e.status) - statusRank(b.e.status) || b.e.at - a.e.at || a.n - b.n || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.e);
}

const snippet = (s: string): string => (s || "").replace(/\s+/g, " ").trim().slice(0, LIBRARY_SNIPPET);

export function toLibraryHit(e: SystemLibraryEntry): SystemLibraryHit {
  return {
    key: e.key,
    quoteId: e.quoteId,
    estNumber: e.estNumber,
    quoteName: e.quoteName,
    customer: e.customer,
    status: e.status,
    at: e.at,
    rev: e.rev,
    sectionId: e.sectionId,
    systemName: e.systemName,
    lineCount: e.lineCount,
    presentation: e.presentation,
    introSnippet: snippet(e.intro),
    keyProductCount: e.keyProducts.length,
    keyProductSnippets: e.keyProducts.map((k) => ({ sku: k.sku, heading: snippet(k.heading), snippet: snippet(k.text) })),
  };
}

const KEY_RE = /^(.{1,120}):(\d{1,6}|live):([^:]{1,120})$/;
export function parseLibraryKey(key: string): { quoteId: string; rev: number | null; sectionId: string } | null {
  const m = KEY_RE.exec(String(key ?? ""));
  if (!m) return null;
  return { quoteId: m[1], rev: m[2] === "live" ? null : Number(m[2]), sectionId: m[3] };
}

/**
 * The system Load copies, picked by the library rule AS OF NOW (a quote
 * re-sent since indexing loads its newest sent revision). Vendor-quote lines
 * are left out (their records hold job-specific files and terms, and count
 * against the per-estimate attachment budget) and counted; the Rewards
 * credit, blocks on dropped or missing lines, and `room` (job-specific) go.
 */
export function librarySectionForLoad(
  q: Quote,
  sectionId: string
): { section: SpecSection; source: LibrarySource; vendorLinesDropped: number } | null {
  const source = librarySourceOf(q);
  if (!source) return null;
  const sec = sectionsOf(source.spec).find((s) => s.id === sectionId);
  if (!sec || sec.kind === "labor") return null;
  const items = linesOf(sec);
  if (!items.length) return null;
  const kept = items.filter((it) => !it.vendorQuoteId);
  const keptIds = new Set(kept.map((it) => String(it.id)));
  const base: SpecSection = { ...sec, items: kept };
  delete base.room;
  const kps = sanitizeKeyProducts(sec.keyProducts).filter((k) => keptIds.has(k.lineKey));
  return { section: withKeyProducts(base, kps), source, vendorLinesDropped: items.length - kept.length };
}

/** Client placement of a loaded system: a fresh section id, every line
 *  re-id'd through the Estimator's counter (ids are unique per section only),
 *  blocks remapped, and auto freight set to this estimate's default. */
export function placeLoadedSection(section: SpecSection, opts: { id: string; nextId: () => number; autoFreightPct: number }): SpecSection {
  const idMap = new Map<number, number>();
  const items = section.items.map((it) => {
    const nid = opts.nextId();
    idMap.set(it.id, nid);
    return { ...it, id: nid };
  });
  const [placed] = applyAutoFreight([{ ...section, id: opts.id, items }], { pct: opts.autoFreightPct });
  return withKeyProducts(placed, remapKeyProducts(section.keyProducts, idMap));
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export function loadNotice(r: Pick<LoadedLibrarySystem, "systemName" | "estNumber" | "costsUpdated" | "tierRepriced" | "vendorLinesDropped">): string {
  const parts = [`Loaded ${r.systemName || "Untitled system"} from ${r.estNumber}`];
  if (r.costsUpdated > 0) parts.push(`${plural(r.costsUpdated, "part")} updated to today's cost`);
  if (r.tierRepriced > 0) parts.push(`${plural(r.tierRepriced, "line")} re-priced to this estimate's tier`);
  if (r.vendorLinesDropped > 0) parts.push(`${plural(r.vendorLinesDropped, "vendor-quote line")} left out`);
  return parts.join(" · ");
}

export function libraryRowMeta(h: Pick<SystemLibraryHit, "customer" | "estNumber" | "status" | "at">): string {
  const date = new Date(h.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  return `${h.customer || "—"} · ${h.estNumber} · ${h.status === "won" ? "Won" : "Sent"} · ${date}`;
}

export function libraryRowCounts(h: Pick<SystemLibraryHit, "lineCount" | "keyProductCount">): string {
  return `${plural(h.lineCount, "line")} · ${plural(h.keyProductCount, "key product")}`;
}
```

- [ ] **Step 4: Create `src/lib/narrative/merge.ts`**

```ts
import type { KeyProduct, SpecSection } from "@/app/(app)/estimator/types";
import { MAX_INTRO, MAX_KEY_PRODUCTS, MAX_PARAGRAPH, isKeyProductEligible, withKeyProducts } from "@/app/(app)/estimator/narrative";

/**
 * #293 slice 2 — Merge narrative: append library systems' intros and key
 * products into a system. Append-only, never invents a line (a block can't
 * exist without one, and adding a priced line would change the estimate).
 * Pure and client-safe: the modal previews with it, the column applies it.
 */

export type MergeOpts = { intro: boolean; products: boolean };
export type MergeSource = { systemName: string; intro: string; keyProducts: Array<Pick<KeyProduct, "sku" | "text" | "photo">> };
export type MergeResult = {
  section: SpecSection;
  changed: boolean;
  introsAppended: number;
  /** Intros skipped because appending would pass MAX_INTRO. */
  introsTooLong: number;
  productsAdded: number;
  /** Sku already a key product here. */
  skippedPresent: string[];
  /** No eligible, unmarked line with that sku here. */
  skippedNoLine: string[];
  /** A line existed but the system is at MAX_KEY_PRODUCTS. */
  skippedFull: string[];
};

const normWs = (s: string): string => s.replace(/\s+/g, " ").trim();
const pushOnce = (list: string[], sku: string): void => {
  if (!list.includes(sku)) list.push(sku);
};

export function mergeNarrative(target: SpecSection, sources: MergeSource[], opts: MergeOpts): MergeResult {
  const srcs = Array.isArray(sources) ? sources : [];
  let narrative = typeof target.narrative === "string" ? target.narrative : "";
  let introsAppended = 0;
  let introsTooLong = 0;
  if (opts.intro) {
    for (const s of srcs) {
      const t = (typeof s?.intro === "string" ? s.intro : "").replace(/\r\n?/g, "\n").trim();
      if (!t || normWs(narrative).includes(normWs(t))) continue;
      const next = narrative.trim() ? narrative.replace(/\s+$/, "") + "\n\n" + t : t;
      if (next.length > MAX_INTRO) {
        introsTooLong++;
        continue;
      }
      narrative = next;
      introsAppended++;
    }
  }

  const kps: KeyProduct[] = Array.isArray(target.keyProducts) ? [...target.keyProducts] : [];
  let productsAdded = 0;
  const skippedPresent: string[] = [];
  const skippedNoLine: string[] = [];
  const skippedFull: string[] = [];
  if (opts.products) {
    for (const s of srcs) {
      for (const b of Array.isArray(s?.keyProducts) ? s.keyProducts : []) {
        const sku = typeof b?.sku === "string" ? b.sku.trim() : "";
        if (!sku) continue;
        if (kps.some((k) => k.sku === sku)) {
          pushOnce(skippedPresent, sku);
          continue;
        }
        const used = new Set(kps.map((k) => k.lineKey));
        const line = target.items.find((it) => isKeyProductEligible(it) && (it.sku || "").trim() === sku && !used.has(String(it.id)));
        if (!line) {
          pushOnce(skippedNoLine, sku);
          continue;
        }
        if (kps.length >= MAX_KEY_PRODUCTS) {
          pushOnce(skippedFull, sku);
          continue;
        }
        kps.push({ lineKey: String(line.id), sku, text: (typeof b.text === "string" ? b.text : "").slice(0, MAX_PARAGRAPH), photo: b.photo !== false });
        productsAdded++;
      }
    }
  }

  const changed = introsAppended > 0 || productsAdded > 0;
  const result = { changed, introsAppended, introsTooLong, productsAdded, skippedPresent, skippedNoLine, skippedFull };
  if (!changed) return { section: target, ...result };
  const base: SpecSection = introsAppended ? { ...target, narrative } : target;
  return { section: productsAdded ? withKeyProducts(base, kps) : base, ...result };
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export function mergeNotice(r: Omit<MergeResult, "section" | "changed">): string {
  const parts: string[] = [];
  if (r.introsAppended) parts.push(`Added intro from ${plural(r.introsAppended, "system")}`);
  if (r.productsAdded) parts.push(parts.length ? plural(r.productsAdded, "key product") : `Added ${plural(r.productsAdded, "key product")}`);
  if (r.skippedPresent.length) parts.push(`skipped ${r.skippedPresent.length} already featured`);
  if (r.skippedNoLine.length) parts.push(`${r.skippedNoLine.length} not on this system (add the part first): ${r.skippedNoLine.join(", ")}`);
  if (r.skippedFull.length) parts.push(`${r.skippedFull.length} over the ${MAX_KEY_PRODUCTS}-product limit`);
  if (r.introsTooLong) parts.push(`${plural(r.introsTooLong, "intro")} too long to append`);
  if (!parts.length) return "Nothing to merge — this system already has it all";
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 5: Run the gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
df -h /System/Volumes/Data | tail -1; ps aux | grep -v grep | grep tsx
npx tsc --noEmit
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG"; grep '#293s' "$LOG" | grep -c '^PASS'; tail -1 "$LOG"
npx eslint src/lib/narrative/system-library.ts src/lib/narrative/merge.ts
```

Expected:
- tsc 0;
- test:specs `ALL PASSED`, 0 FAIL, PASS = 10,530 + the number of new `#293s` checks (about 45);
- eslint 0 errors.

If a `#293s` check fails, fix the module and not the check, unless the check contradicts these rules. In that case
report it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/narrative/system-library.ts src/lib/narrative/merge.ts scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 slice 2 — pure system library + Merge narrative\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 2: Server — copy-pricing factor-out, Load core, index cache + invalidation, actions

**Files:**
- Create: `src/app/(app)/estimator/copy-pricing.ts`
- Modify: `src/app/(app)/estimator/actions.ts` (`copySystemToEstimateAction`, about lines 899–1000; the imports at lines
  35–38)
- Create: `src/lib/narrative/system-library-index.ts`
- Create: `src/lib/narrative/load-system.ts`
- Modify: `src/lib/stores/quotes.ts` (`setStatus` at about line 1330; `remove` at about line 1578; a new helper beside
  `reconcileRewardsSafely`)
- Create: `src/app/(app)/estimator/library-actions.ts`
- Test: `scripts/test-review-and-spec.ts` (the one authorized retarget, plus an appended server block and a chained
  async check)

**Interfaces:**
- **Consumes** (Task 1): `systemLibraryEntries`, `searchSystemLibrary`, `toLibraryHit`, `parseLibraryKey`,
  `librarySectionForLoad`, `LIBRARY_GONE`, `LIBRARY_QUERY_MAX` and the `SystemLibraryEntry`, `SystemLibraryHit` and
  `LoadLibrarySystemResult` types. Also `copySectionForTarget`, `CopyCatalogPart` and `CopyFixture`
  (`estimator/copy-system.ts`), and `sanitizeSystemSell` (`estimator/pricing.ts`).
- **Produces:**
  - `copyPricingFor(items: readonly SpecItem[]): Promise<{ catalog: Map<string, CopyCatalogPart>; fixtures: Map<string, CopyFixture> }>`
  - `systemLibraryIndex(): Promise<SystemLibraryEntry[]>`
  - `invalidateSystemLibrary(): void`
  - `loadLibrarySystem(key: string, targetTierMargin: number | null): Promise<LoadLibrarySystemResult>`
  - The actions, used by Task 3:
    - `searchSystemLibraryAction(query: string, opts?: { hasNarrative?: boolean }): Promise<SystemLibraryHit[]>`
    - `getSystemLibraryEntryAction(key: string): Promise<SystemLibraryEntry | null>`
    - `loadLibrarySystemAction(key: string, ctx: { tierMargin: number | null }): Promise<LoadLibrarySystemResult>`

- [ ] **Step 1: Write the failing harness checks**

1. **The authorized retarget.** In the `#274B` block (search for the message `"#274B copy action: a track line's parts
   are looked up as catalog parts, never as a fixture record"`), change only the tested source:

```ts
  ok(/if \(!it\.track\) fixtureIds\.add\(/.test(src("src/app/(app)/estimator/copy-pricing.ts")), "#274B copy action: a track line's parts are looked up as catalog parts, never as a fixture record");
```

2. **Append** at the end of the harness file:

```ts
/* ======================================================================
   #293 slice 2 — server: the copy-pricing helper shared by Copy and Load,
   the Load core (re-reads the quote, re-prices, drops vendor lines), the
   index cache and its invalidation, and the three library actions.
   ====================================================================== */
import { systemLibraryIndex as n293sIndex, invalidateSystemLibrary as n293sInvalidate } from "@/lib/narrative/system-library-index";
import { loadLibrarySystem as n293sLoad } from "@/lib/narrative/load-system";
import {
  create as n293sQCreate, update as n293sQUpdate, addQuoteRevision as n293sQAddRev, remove as n293sQRemove,
} from "@/lib/stores/quotes";
import { mergeUpsert as n293sMergeUpsert } from "@/lib/stores/catalog";
import { tierSeedPrice as n293sSeed } from "@/app/(app)/estimator/tier-reprice";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const acts = rd("src/app/(app)/estimator/actions.ts");
  const copyFn = acts.slice(acts.indexOf("export async function copySystemToEstimateAction("), acts.indexOf("\n}\n", acts.indexOf("export async function copySystemToEstimateAction(")));
  ok(copyFn.includes("const { catalog, fixtures } = await copyPricingFor(items);") && !copyFn.includes("listFixtures(") && copyFn.includes("copySectionForTarget(sanitizeSystemSell(section),"),
    "#293s copy-pricing: Copy system loads today's catalog + fixtures through the shared copyPricingFor helper");
  const cp = rd("src/app/(app)/estimator/copy-pricing.ts");
  ok(cp.includes("export async function copyPricingFor(") && cp.includes("allAssembliesFrom(fixtureRecords, parts)") && cp.includes("c.found && (c.cost > 0 || c.costOverride !== undefined)"),
    "#293s copy-pricing: the helper keeps #266's fixture resolution and the missing-part fallback");
  const ls = rd("src/lib/narrative/load-system.ts");
  ok(ls.includes("copyPricingFor(picked.section.items)") && ls.includes("copySectionForTarget(sanitizeSystemSell(picked.section),") && ls.includes("invalidateSystemLibrary()"),
    "#293s load: Load re-prices through the same helper + copySectionForTarget, and a gone key invalidates the index");
  const la = rd("src/app/(app)/estimator/library-actions.ts");
  ok(/^"use server";/.test(la) && ["searchSystemLibraryAction", "getSystemLibraryEntryAction", "loadLibrarySystemAction"].every((f) => la.includes(`export async function ${f}(`)) &&
     (la.match(/await requireUser\(\);/g) || []).length === 3 && !la.includes("requirePerm("),
    "#293s actions: the three library actions are server actions, each behind requireUser (spec §4.1)");
  ok(la.includes(".map(toLibraryHit)") && la.includes("LIBRARY_QUERY_MAX"), "#293s actions: search answers hits only (no text bodies) and caps the query");
  const qs = rd("src/lib/stores/quotes.ts");
  const setStatusFn = qs.slice(qs.indexOf("export async function setStatus("), qs.indexOf("async function reconcileRewardsSafely("));
  const removeFn = qs.slice(qs.indexOf("export async function remove("), qs.indexOf("\n}\n", qs.indexOf("export async function remove(")));
  ok(setStatusFn.includes("if (out && moved.value) await invalidateSystemLibrarySafely();") && removeFn.includes("await invalidateSystemLibrarySafely();"),
    "#293s index: every real status transition and a quote delete invalidate the library");
  ok(qs.includes('await import("@/lib/narrative/system-library-index")'), "#293s index: quotes.ts reaches the index by dynamic import (no import cycle)");
  const ix = rd("src/lib/narrative/system-library-index.ts");
  ok(ix.includes("const TTL_MS = 5 * 60 * 1000;") && ix.includes("generation++"), "#293s index: a 5-minute per-process cache with a generation guard (portalIndex idiom)");
}

async function systemLibrary293sAsyncChecks(): Promise<void> {
  const P = fixtureId(293, "lib-part");
  const QID = fixtureId(293, "lib-sent");
  const QDRAFT = fixtureId(293, "lib-draft");
  const QWON = fixtureId(293, "lib-won-gone");
  await n293sMergeUpsert(P, { desc: "Test293 Lib part", category: "Test293 Cat", unit: "ea", list: 200, cost: 120 });
  registerFixture("catalog_parts", P);
  const seeded = n293sSeed({ cost: 100 }, 0.3);
  const section = {
    id: "sysLib", name: "Test293 Library Lighting", kind: "materials", mfr: "", freightPct: 5, freightAuto: true,
    presentation: "narrative", narrative: "Library intro 293.", room: "Stage left",
    items: [
      { id: 1, sku: P, desc: "Lib part", qty: 2, unit: "ea", cost: 100, price: seeded },
      { id: 2, sku: "VQ-293", desc: "Vendor gear", qty: 1, unit: "ea", cost: 50, price: 80, vendorQuoteId: "vq-293" },
    ],
    keyProducts: [{ lineKey: "1", sku: P, text: "Lib para", photo: true }, { lineKey: "2", sku: "VQ-293", text: "Vendor para", photo: true }],
  } as unknown as N293sSec;

  // A sent quote, then a post-send edit that must never reach the library.
  await n293sQCreate({ id: QID, name: "#293 lib", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", tierMargin: 0.3, spec: { sections: [section], mobs: [] } });
  registerFixture("quotes", QID);
  await n293sQUpdate(QID, { status: "sent" });
  await n293sQAddRev(QID, { by: "Test", reason: "sent", note: "Sent to customer" });
  await n293sQUpdate(QID, { spec: { sections: [{ ...section, name: "Test293 Edited after send", narrative: "Leaked" }], mobs: [] } });
  // A draft with the same system.
  await n293sQCreate({ id: QDRAFT, name: "#293 lib draft", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", spec: { sections: [{ ...section, name: "Test293 Draft only" }], mobs: [] } });
  registerFixture("quotes", QDRAFT);

  n293sInvalidate();
  const idx = await n293sIndex();
  const mine = idx.filter((e) => e.quoteId === QID);
  ok(mine.length === 1 && mine[0].key === `${QID}:1:sysLib` && mine[0].systemName === "Test293 Library Lighting" && mine[0].intro === "Library intro 293.",
    "#293s index (DB): a sent quote edited after send is indexed from its sent revision");
  ok(!idx.some((e) => e.quoteId === QDRAFT) && !idx.some((e) => e.systemName === "Test293 Edited after send"), "#293s index (DB): drafts and post-send edits never appear");

  // The cache holds until invalidated; quotes.remove() invalidates on its own.
  await n293sQCreate({ id: QWON, name: "#293 lib won", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", spec: { sections: [section], mobs: [] } });
  registerFixture("quotes", QWON);
  await n293sQUpdate(QWON, { status: "won" });
  ok(!(await n293sIndex()).some((e) => e.quoteId === QWON), "#293s index (DB): a cached index doesn't see a quote written without a status transition");
  n293sInvalidate();
  ok((await n293sIndex()).some((e) => e.key === `${QWON}:live:sysLib`), "#293s index (DB): after invalidation a won-without-send quote is indexed from its live spec");

  // Load: re-read, re-priced at today's catalog and the target tier, vendor line left out.
  const r = await n293sLoad(`${QID}:1:sysLib`, 0.2);
  ok(r.ok && r.section.items.length === 1 && r.section.items[0].cost === 120 && r.section.items[0].price === n293sSeed({ cost: 120 }, 0.2) && r.costsUpdated === 1 && r.tierRepriced === 1 && r.vendorLinesDropped === 1,
    "#293s load (DB): today's cost (100 → 120), the target tier's seed, one vendor-quote line left out");
  ok(r.ok && r.section.name === "Test293 Library Lighting" && r.section.narrative === "Library intro 293." && r.section.presentation === "narrative" &&
     JSON.stringify(r.section.keyProducts) === JSON.stringify([{ lineKey: "1", sku: P, text: "Lib para", photo: true }]) && !("room" in r.section) && r.section.id !== "sysLib",
    "#293s load (DB): the SENT system's name, narrative, presentation and key products carry; the vendor line's block and the room don't");
  ok(r.ok && (/^EST-\d+/.test(r.estNumber) || r.estNumber === QID), "#293s load (DB): the notice names the source estimate");
  const draftLoad = await n293sLoad(`${QDRAFT}:live:sysLib`, 0.2);
  ok(!draftLoad.ok && draftLoad.error === "That estimate is no longer available", "#293s load (DB): a draft's system can't be loaded");
  ok(!(await n293sLoad("garbage", 0.2)).ok, "#293s load (DB): a malformed key is refused");
  await n293sQRemove(QWON);
  ok(!(await n293sIndex()).some((e) => e.quoteId === QWON), "#293s index (DB): deleting a quote drops it from the library (remove invalidates)");
  const gone = await n293sLoad(`${QWON}:live:sysLib`, 0.2);
  ok(!gone.ok && gone.error === "That estimate is no longer available", "#293s load (DB): a deleted quote's entry is refused with the spec's message");
}
```

3. **Chain the async check.** Right after the line `.then(() => narrativeFinal293AsyncChecks())`, add:

```ts
  .then(() => systemLibrary293sAsyncChecks())
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit 2>&1 | head -5
```

Expected: `Cannot find module '@/lib/narrative/system-library-index'` and `'@/lib/narrative/load-system'`.

- [ ] **Step 3: Create `src/app/(app)/estimator/copy-pricing.ts`.** Move the code verbatim from
`copySystemToEstimateAction`, from the comment `/* Today's catalog, for only the SKUs this section names…` through the
end of the `if (fixtureRecords.length) { … }` block:

```ts
import { getMany as catalogGetMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { allAssembliesFrom, fixtureSkus, type FixtureRecord } from "@/lib/fixture-assemblies";
import type { CopyCatalogPart, CopyFixture } from "./copy-system";
import type { SpecItem } from "./types";

/**
 * #266 / #293 slice 2 — today's catalog and resolved fixtures for exactly the
 * SKUs these lines name: the data copySectionForTarget re-prices against.
 * Shared by Copy system (copySystemToEstimateAction) and Load system
 * (lib/narrative/load-system.ts). Server-only — reads the catalog and
 * fixtures stores.
 */
export async function copyPricingFor(
  items: readonly SpecItem[]
): Promise<{ catalog: Map<string, CopyCatalogPart>; fixtures: Map<string, CopyFixture> }> {
  /* Today's catalog, for only the SKUs this section names — plus, when a line
     is a catalog-backed fixture, the resolved fixture records (costOverride
     applied) and their own parts. */
  const skus = new Set<string>();
  const fixtureIds = new Set<string>();
  for (const it of items) {
    if (it?.sku) skus.add(it.sku);
    const comps = Array.isArray(it?.components) ? it.components : [];
    if (comps.length) {
      // #274: a track line's parts are plain catalog parts — no fixture record.
      if (!it.track) fixtureIds.add(it.fixtureId || it.sku);
      comps.forEach((c) => c?.sku && skus.add(c.sku));
    }
  }
  let fixtureRecords: FixtureRecord[] = [];
  if (fixtureIds.size) {
    fixtureRecords = (await listFixtures()).filter((r) => fixtureIds.has(r.id));
    fixtureRecords.forEach((r) => fixtureSkus(r).forEach((s) => skus.add(s)));
  }
  const parts = skus.size ? await catalogGetMany([...skus]) : [];
  const catalog = new Map<string, CopyCatalogPart>();
  for (const p of parts) {
    const cost = Number(p.cost);
    // A part with no real cost today is no basis for re-costing a line.
    if (!p.sku || !(Number.isFinite(cost) && cost > 0) || catalog.has(p.sku)) continue;
    catalog.set(p.sku, { sku: p.sku, cost, list: Number(p.list) || 0 });
  }
  const fixtures = new Map<string, CopyFixture>();
  if (fixtureRecords.length) {
    for (const a of allAssembliesFrom(fixtureRecords, parts)) {
      fixtures.set(a.id, {
        id: a.id,
        // A part missing from today's catalog falls back to the line's own
        // numbers rather than pricing at the resolver's 0.
        components: a.components
          .filter((c) => c.found && (c.cost > 0 || c.costOverride !== undefined))
          .map((c) => ({ sku: c.sku, cost: c.cost, list: c.list })),
      });
    }
  }
  return { catalog, fixtures };
}
```

- [ ] **Step 4: Update `copySystemToEstimateAction` in `actions.ts`.**
  - Replace the moved block (everything from `/* Today's catalog,` through the closing brace of
    `if (fixtureRecords.length) { … }`) with:

```ts
  // #293 slice 2: today's catalog + resolved fixtures — shared with Load system.
  const { catalog, fixtures } = await copyPricingFor(items);
```

  - Keep `const items = Array.isArray(section?.items) ? section.items : [];` and everything after it unchanged.
  - Imports:
    - add `import { copyPricingFor } from "./copy-pricing";`;
    - change the catalog import to `import { list as catalogList, mergeUpsert } from "@/lib/stores/catalog";`;
    - delete the `listFixtures` import line and the `@/lib/fixture-assemblies` import line;
    - change the copy-system import to `import { copySectionForTarget } from "./copy-system";`.
  - Before deleting each import, confirm it has no other use: `grep -n "\bNAME\b" "src/app/(app)/estimator/actions.ts"`
    should show exactly two hits, the import and the moved use.

- [ ] **Step 5: Create `src/lib/narrative/system-library-index.ts`**

```ts
import { getAll } from "@/lib/stores/quotes";
import { all as allCustomers } from "@/lib/stores/customers";
import { systemLibraryEntries, type SystemLibraryEntry } from "./system-library";

/**
 * #293 slice 2 — the system library, computed from every quote and cached
 * per process for 5 minutes (the portalIndex idiom, portal-catalog-index.ts).
 * Stale by up to the TTL is fine for a reference library; setStatus and
 * remove() invalidate on this instance (quotes.ts), the TTL covers the rest.
 * Server-only.
 */
const TTL_MS = 5 * 60 * 1000;

let cache: { at: number; entries: SystemLibraryEntry[] } | null = null;
let building: Promise<SystemLibraryEntry[]> | null = null;
/** Bumped by every invalidation, so a build that started before a write
 *  never lands in the cache after it. */
let generation = 0;

export function invalidateSystemLibrary(): void {
  cache = null;
  building = null;
  generation++;
}

async function build(): Promise<SystemLibraryEntry[]> {
  const [quotes, customers] = await Promise.all([getAll(), allCustomers()]);
  const names = new Map<string, string>(customers.map((c) => [c.id, c.name]));
  return systemLibraryEntries(quotes, names);
}

export async function systemLibraryIndex(): Promise<SystemLibraryEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  if (building) return building;
  const gen = generation;
  const p = build().then((entries) => {
    if (gen === generation) cache = { at: Date.now(), entries };
    return entries;
  });
  building = p;
  try {
    return await p;
  } finally {
    if (building === p) building = null;
  }
}
```

- [ ] **Step 6: Create `src/lib/narrative/load-system.ts`**

```ts
import { get as getQuote } from "@/lib/stores/quotes";
import { copySectionForTarget } from "@/app/(app)/estimator/copy-system";
import { copyPricingFor } from "@/app/(app)/estimator/copy-pricing";
import { sanitizeSystemSell } from "@/app/(app)/estimator/pricing";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { LIBRARY_GONE, librarySectionForLoad, parseLibraryKey, type LoadLibrarySystemResult } from "./system-library";
import { invalidateSystemLibrary } from "./system-library-index";

const usableTier = (m: number | null): number | null => (typeof m === "number" && Number.isFinite(m) && m > 0 && m < 1 ? m : null);

/**
 * #293 slice 2 — Load system's core (the action is a requireUser wrapper).
 * Re-reads the source quote by the library key — client-supplied section data
 * is never trusted — picks the snapshot by the library rule, leaves vendor-quote
 * lines out, then re-prices exactly as Copy system does (#266): today's catalog,
 * the snapshot's tier → this estimate's. Persists nothing; the client places
 * the section and the normal Save writes it. Server-only.
 */
export async function loadLibrarySystem(key: string, targetTierMargin: number | null): Promise<LoadLibrarySystemResult> {
  const k = parseLibraryKey(key);
  const q = k ? await getQuote(k.quoteId) : null;
  const picked = q && k ? librarySectionForLoad(q, k.sectionId) : null;
  if (!q || !picked) {
    invalidateSystemLibrary();
    return { ok: false, error: LIBRARY_GONE };
  }
  const { catalog, fixtures } = await copyPricingFor(picked.section.items);
  const copied = copySectionForTarget(sanitizeSystemSell(picked.section), {
    newSectionId: "sys" + Date.now(),
    catalog,
    fixtures,
    sourceTierMargin: picked.source.tierMargin,
    targetTierMargin: usableTier(targetTierMargin),
  });
  return {
    ok: true,
    section: copied.section,
    systemName: picked.section.name || "",
    estNumber: displayQuoteNumber(q),
    costsUpdated: copied.costsUpdated,
    tierRepriced: copied.tierRepriced,
    vendorLinesDropped: picked.vendorLinesDropped,
  };
}
```

- [ ] **Step 7: Invalidate from `quotes.ts`.**

  1. Below `reconcileRewardsSafely` (after its closing brace), add:

```ts
/** #293 slice 2: the system library indexes sent/won quotes — a real status
 *  transition or a delete can add or remove entries. Dynamic import: the
 *  index imports this store. Never throws. */
async function invalidateSystemLibrarySafely(): Promise<void> {
  try {
    (await import("@/lib/narrative/system-library-index")).invalidateSystemLibrary();
  } catch (e) {
    console.error("[system-library] invalidate failed", e);
  }
}
```

  2. In `setStatus`, right after the line
     `if (out && moved.value && opts.bypassApprovalGate !== "historical-import") await reconcileRewardsSafely(out, by);`,
     add:

```ts
  if (out && moved.value) await invalidateSystemLibrarySafely();
```

  3. In `remove`, right after `await softDeleteDoc("quotes", id);`, add:

```ts
  await invalidateSystemLibrarySafely();
```

- [ ] **Step 8: Create `src/app/(app)/estimator/library-actions.ts`**

```ts
"use server";

import { requireUser } from "@/lib/session";
import { systemLibraryIndex } from "@/lib/narrative/system-library-index";
import { loadLibrarySystem } from "@/lib/narrative/load-system";
import {
  LIBRARY_QUERY_MAX,
  searchSystemLibrary,
  toLibraryHit,
  type LoadLibrarySystemResult,
  type SystemLibraryEntry,
  type SystemLibraryHit,
} from "@/lib/narrative/system-library";

/**
 * #293 slice 2 — the system library's server actions. Any signed-in team
 * member may search and load (like searchQuotesAction); Load writes nothing —
 * the client places the re-priced system and the normal Save persists it.
 */

/** Ranked hits — never intro or block text bodies (spec §4.1). */
export async function searchSystemLibraryAction(query: string, opts?: { hasNarrative?: boolean }): Promise<SystemLibraryHit[]> {
  await requireUser();
  const entries = await systemLibraryIndex();
  return searchSystemLibrary(entries, String(query ?? "").slice(0, LIBRARY_QUERY_MAX), { hasNarrative: !!opts?.hasNarrative }).map(toLibraryHit);
}

/** One full entry, for the detail pane and the Merge preview. */
export async function getSystemLibraryEntryAction(key: string): Promise<SystemLibraryEntry | null> {
  await requireUser();
  const k = String(key ?? "");
  return (await systemLibraryIndex()).find((e) => e.key === k) ?? null;
}

/** Load system: re-read, vendor lines left out, re-priced at today's catalog
 *  and this estimate's tier. */
export async function loadLibrarySystemAction(key: string, ctx: { tierMargin: number | null }): Promise<LoadLibrarySystemResult> {
  await requireUser();
  const tm = ctx && typeof ctx.tierMargin === "number" ? ctx.tierMargin : null;
  return loadLibrarySystem(String(key ?? ""), tm);
}
```

- [ ] **Step 9: Run the gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
df -h /System/Volumes/Data | tail -1; ps aux | grep -v grep | grep tsx
npx tsc --noEmit
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG"; tail -1 "$LOG"
npx eslint "src/app/(app)/estimator/copy-pricing.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/library-actions.ts" src/lib/narrative/system-library-index.ts src/lib/narrative/load-system.ts src/lib/stores/quotes.ts
```

Expected:
- tsc 0;
- test:specs 0 FAIL, PASS = Task 1's count + the new `#293s` server checks (about 18), with the `#266`, `#274B` and
  slice 1 `#293` copy checks still passing;
- eslint 0 errors.

If `#293s load (DB): today's cost…` fails on `tierRepriced`, print `r` and compare it with `copySectionForTarget`'s
seed rule (`isAtTierSeed`) before changing anything. The fixture price is built with the same `tierSeedPrice`.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/estimator/copy-pricing.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/library-actions.ts" src/lib/narrative/system-library-index.ts src/lib/narrative/load-system.ts src/lib/stores/quotes.ts scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 slice 2 — system library index, Load core, shared copy pricing\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: Library modal + Load system wiring

**Files:**
- Create: `src/app/(app)/estimator/system-library-modal.tsx`
- Modify: `src/app/(app)/estimator/estimator-client.tsx`. **Add-only**, in seven places: an import after line 116, a
  state line beside `const [intros, setIntros]` (about line 525), the `verb` union (about line 592), a handler after
  `addSystem` (about line 1720), a banner branch (about line 3325), and a button plus the modal mount after the dashed
  "+ Add system" button (about line 3850).
- Test: `scripts/test-review-and-spec.ts` (append the block `#293 slice 2 — library modal + Load wiring`)

**Interfaces:**
- **Consumes:**
  - Task 1: `libraryRowMeta`, `libraryRowCounts`, `placeLoadedSection`, `loadNotice`, the `LoadedLibrarySystem`,
    `SystemLibraryEntry` and `SystemLibraryHit` types, and `mergeNarrative`, `mergeNotice` and `MergeOpts`.
  - Task 2: the three actions.
- **Produces:** `export default function SystemLibraryModal(p: SystemLibraryModalProps)` with

  ```ts
  type SystemLibraryModalProps =
    | { mode: "load"; tierMargin: number | null; onLoaded: (res: LoadedLibrarySystem) => void; onClose: () => void }
    | { mode: "merge"; target: SpecSection; onMerge: (sources: SystemLibraryEntry[], opts: MergeOpts) => void; onClose: () => void };
  ```

  Task 4 uses `mode: "merge"`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 2 — library modal + Load wiring (client components; proven
   by source like the other client checks — React isn't mounted here).
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const clientImportsServer = (s: string) =>
    /^import (?!type)[^\n]*from "(@\/(lib\/stores|db|lib\/blob|lib\/session|lib\/narrative\/(library|photos|system-library-index|load-system))|\.\/copy-pricing)/m.test(s);
  const modal = rd("src/app/(app)/estimator/system-library-modal.tsx");
  const cli = rd("src/app/(app)/estimator/estimator-client.tsx");
  ok(/^"use client";/.test(modal) && !clientImportsServer(modal) && !clientImportsServer(cli),
    "#293s UI: the library modal is a client module; neither it nor the Estimator value-imports a store or server-only module");
  ok(modal.includes("searchSystemLibraryAction(") && modal.includes("getSystemLibraryEntryAction(") && modal.includes("loadLibrarySystemAction(") && modal.includes("Has narrative"),
    "#293s UI: the modal searches, reads one entry for the detail pane, and loads; the Has narrative chip filters");
  ok(modal.includes("libraryRowMeta(h)") && modal.includes("libraryRowCounts(h)") && modal.includes("No sent or won systems match.") && modal.includes("Pick a system to see its intro and key products."),
    "#293s UI: rows show customer · EST · status · date and counts; empty states");
  ok(modal.includes("Re-priced at today's catalog and this estimate's tier. Vendor-quote lines are left out.") && modal.includes("Load system"),
    "#293s UI: Load says how it prices");
  ok(modal.includes("mergeNarrative(p.target, sources, opts)") && modal.includes("mergeNotice(preview)") && modal.includes("Tick one or more systems to merge.") && modal.includes(">Merge<"),
    "#293s UI: merge mode previews with mergeNarrative before applying");
  ok((modal.match(/\} catch \{/g) || []).length >= 3 && !modal.includes("window.confirm"), "#293s UI: every server await in the modal is caught (a throw can't unmount the Estimator)");
  ok(cli.includes("+ From library…") && cli.includes("<SystemLibraryModal") && cli.includes('mode="load"') && cli.includes("tierMargin={tierMargin}"),
    "#293s UI: + From library… opens the modal in load mode with this estimate's tier");
  const place = cli.slice(cli.indexOf("const placeLibrarySystem = "), cli.indexOf("const pushItems = "));
  ok(place.includes("placeLoadedSection(res.section, { id: newId, nextId, autoFreightPct: freightDefault.pct })") && place.includes("selectSystem(newId)") && place.includes('verb: "Loaded"') && place.includes("loadNotice(res)"),
    "#293s UI: a loaded system gets fresh ids (blocks remapped), lands after the active system, is selected, and the notice reports the re-price");
  ok(cli.includes('verb?: "Moved" | "Copied" | "Loaded";') && cli.includes('moveNotice.ok && moveNotice.verb === "Loaded" ?'), "#293s UI: the result banner shows the Load notice");
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; grep '^FAIL ' "$LOG" | head
```

Expected: the harness throws `ENOENT … system-library-modal.tsx`, or the `#293s UI` checks FAIL.

- [ ] **Step 3: Create `src/app/(app)/estimator/system-library-modal.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { SpecSection } from "./types";
import {
  libraryRowCounts,
  libraryRowMeta,
  type LoadedLibrarySystem,
  type SystemLibraryEntry,
  type SystemLibraryHit,
} from "@/lib/narrative/system-library";
import { mergeNarrative, mergeNotice, type MergeOpts } from "@/lib/narrative/merge";
import { getSystemLibraryEntryAction, loadLibrarySystemAction, searchSystemLibraryAction } from "./library-actions";

/**
 * #293 slice 2 — the system library: every sent and won system, computed
 * (never curated). "load": pick a row → Load system (the server re-prices it).
 * "merge": tick rows, choose Intro / Key products, preview, then append into
 * the target system. Only copies text that already exists (D89).
 */
export type SystemLibraryModalProps =
  | { mode: "load"; tierMargin: number | null; onLoaded: (res: LoadedLibrarySystem) => void; onClose: () => void }
  | { mode: "merge"; target: SpecSection; onMerge: (sources: SystemLibraryEntry[], opts: MergeOpts) => void; onClose: () => void };

const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" };
const PRIMARY: CSSProperties = { ...BTN, color: "#fff", background: "var(--accent)" };
const FIELD: CSSProperties = { flex: 1, minWidth: 0, fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 10px" };
const HINT: CSSProperties = { fontSize: 12, color: "#8c919c", lineHeight: 1.45, padding: 10 };
const META: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 2 };
const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", marginTop: 10 };
const FAILED = "Could not reach the server. Try again.";

export default function SystemLibraryModal(p: SystemLibraryModalProps) {
  const merge = p.mode === "merge";
  const [query, setQuery] = useState("");
  // Merge needs narrative content, so it starts filtered to it.
  const [hasNarrative, setHasNarrative] = useState(merge);
  const [hits, setHits] = useState<SystemLibraryHit[] | null>(null);
  const [, startSearch] = useTransition();
  const seq = useRef(0);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, SystemLibraryEntry>>({});
  const [opts, setOpts] = useState<MergeOpts>({ intro: true, products: true });
  const [err, setErr] = useState("");
  const [, startFetch] = useTransition();
  const [pending, start] = useTransition();

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      startSearch(async () => {
        try {
          const r = await searchSystemLibraryAction(query.trim(), { hasNarrative });
          if (my === seq.current) {
            setHits(r);
            setErr("");
          }
        } catch {
          if (my === seq.current) setErr(FAILED);
        }
      });
    }, 260);
    return () => clearTimeout(t);
  }, [query, hasNarrative]);

  const focus = (key: string) => {
    setFocusKey(key);
    if (Object.hasOwn(entries, key)) return;
    startFetch(async () => {
      try {
        const e = await getSystemLibraryEntryAction(key);
        if (e) setEntries((m) => ({ ...m, [key]: e }));
        else setErr("That system is no longer in the library.");
      } catch {
        setErr(FAILED);
      }
    });
  };
  const toggle = (key: string) => {
    setPicked((ks) => (ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key]));
    focus(key);
  };

  const load = () => {
    if (p.mode !== "load" || !focusKey) return;
    const key = focusKey;
    const tierMargin = p.tierMargin;
    const onLoaded = p.onLoaded;
    start(async () => {
      setErr("");
      try {
        const res = await loadLibrarySystemAction(key, { tierMargin });
        if (res.ok) onLoaded(res);
        else setErr(res.error);
      } catch {
        setErr(FAILED);
      }
    });
  };

  const sources = picked.map((k) => entries[k]).filter((e): e is SystemLibraryEntry => !!e);
  const allLoaded = sources.length === picked.length;
  const preview = p.mode === "merge" && sources.length ? mergeNarrative(p.target, sources, opts) : null;
  const detail = focusKey ? entries[focusKey] : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={merge ? "Merge narrative from the library" : "Load a system from the library"}
      onKeyDown={(e) => {
        if (e.key === "Escape") p.onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(22,24,29,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: "min(880px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>System library</div>
            <div style={{ fontSize: 12, color: "#8c919c" }}>
              {merge ? "Append intros and key products from sent and won systems into this one." : "Every system on a sent or won estimate, as it was sent."}
            </div>
          </div>
          <button type="button" style={BTN} onClick={p.onClose}>Close</button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            aria-label="Search the system library"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by system, customer, EST-#, part or description"
            style={FIELD}
          />
          <button
            type="button"
            aria-pressed={hasNarrative}
            onClick={() => setHasNarrative((v) => !v)}
            style={{ ...BTN, borderRadius: 999, background: hasNarrative ? "#e7f4ee" : "#f1f2f5", color: hasNarrative ? "#1f7a52" : "#5b616e" }}
          >
            Has narrative
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", minHeight: 0 }}>
          <div aria-label="Library systems" style={{ flex: "1 1 320px", minWidth: 0, maxHeight: "50vh", overflowY: "auto", border: "1px solid #ececf0", borderRadius: 8 }}>
            {hits === null ? (
              <div style={HINT}>Searching…</div>
            ) : !hits.length ? (
              <div style={HINT}>No sent or won systems match.</div>
            ) : (
              hits.map((h) => {
                const on = merge ? picked.includes(h.key) : focusKey === h.key;
                return (
                  <button
                    key={h.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => (merge ? toggle(h.key) : focus(h.key))}
                    style={{
                      display: "flex", gap: 8, width: "100%", textAlign: "left", fontFamily: "var(--font-ui)", cursor: "pointer",
                      background: on ? "#f4f6fb" : "#fff", border: "none", borderBottom: "1px solid #f0f1f4",
                      borderLeft: focusKey === h.key ? "3px solid var(--accent)" : "3px solid transparent", padding: "9px 10px",
                    }}
                  >
                    {merge && <span aria-hidden="true" style={{ fontSize: 14, lineHeight: "18px" }}>{on ? "☑" : "☐"}</span>}
                    <span style={{ minWidth: 0, display: "block" }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#16181d" }}>{h.systemName || "Untitled system"}</span>
                      <span style={{ ...META, display: "block" }}>{libraryRowMeta(h)}</span>
                      <span style={{ ...META, display: "block" }}>{libraryRowCounts(h)}</span>
                      {h.introSnippet && (
                        <span style={{ ...META, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.introSnippet}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div aria-label="Selected system" style={{ flex: "1 1 260px", minWidth: 0, maxHeight: "50vh", overflowY: "auto" }}>
            {!focusKey ? (
              <div style={HINT}>Pick a system to see its intro and key products.</div>
            ) : !detail ? (
              <div style={HINT}>Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{detail.systemName || "Untitled system"}</div>
                <div style={META}>{libraryRowMeta(detail)} · {detail.presentation === "narrative" ? "Narrative" : "Itemized"}</div>
                <div style={LABEL}>Intro</div>
                {detail.intro ? <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{detail.intro}</div> : <div style={META}>No intro.</div>}
                <div style={LABEL}>Key products</div>
                {detail.keyProducts.length ? (
                  detail.keyProducts.map((k) => (
                    <div key={k.sku} style={{ fontSize: 12.5 }}>
                      {k.heading} <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8c919c" }}>{k.sku}</span>
                    </div>
                  ))
                ) : (
                  <div style={META}>No key products.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {merge && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid #f0f1f4", paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 14, fontSize: 12.5 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={opts.intro} onChange={(e) => { const v = e.target.checked; setOpts((o) => ({ ...o, intro: v })); }} /> Intro
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={opts.products} onChange={(e) => { const v = e.target.checked; setOpts((o) => ({ ...o, products: v })); }} /> Key products
              </label>
            </div>
            <div style={{ fontSize: 12, color: "#3a3f4a" }}>
              {!picked.length ? "Tick one or more systems to merge." : !allLoaded || !preview ? "Loading…" : mergeNotice(preview)}
            </div>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: "#b4543a" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {p.mode === "load" ? (
            <>
              {/* Copy as a JS string (not JSX text) so the apostrophes need no &apos; — the harness matches it verbatim. */}
              <span style={{ fontSize: 11.5, color: "#8c919c", marginRight: "auto" }}>{"Re-priced at today's catalog and this estimate's tier. Vendor-quote lines are left out."}</span>
              <button type="button" style={BTN} onClick={p.onClose}>Cancel</button>
              <button type="button" style={{ ...PRIMARY, opacity: focusKey && !pending ? 1 : 0.5 }} disabled={!focusKey || pending} onClick={load}>
                {pending ? "Loading…" : "Load system"}
              </button>
            </>
          ) : (
            <>
              <button type="button" style={BTN} onClick={p.onClose}>Cancel</button>
              <button
                type="button"
                style={{ ...PRIMARY, opacity: preview?.changed && allLoaded ? 1 : 0.5 }}
                disabled={!preview?.changed || !allLoaded}
                onClick={() => p.onMerge(sources, opts)}
              >Merge</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

The Load note is a JS string, not JSX text, so the harness copy check matches it verbatim, the way Slice 1's strips do.
The `>Merge<` check matches the closing `>Merge</button>` as written.

- [ ] **Step 4: Wire Load into `estimator-client.tsx`.** Add-only.

1. **Imports**, after line 116 (`import { fillEmptyKeyProductText, … } from "./narrative";`):

```ts
import SystemLibraryModal from "./system-library-modal";
import { loadNotice, placeLoadedSection, type LoadedLibrarySystem } from "@/lib/narrative/system-library";
```

2. **State**, right after `const [intros, setIntros] = useState(narrativeIntros);`:

```ts
  /** #293 slice 2: the system library modal (Load system). */
  const [libraryOpen, setLibraryOpen] = useState(false);
```

3. **The `moveNotice` verb union** (about line 592). Change the type line, and nothing else:

```ts
        verb?: "Moved" | "Copied" | "Loaded";
```

4. **Handler**, right after the `addSystem` arrow function's closing `};`:

```ts
  /** #293 slice 2: Load system — the server re-read and re-priced the library
   *  system (today's catalog, this estimate's tier, vendor-quote lines left
   *  out). Here it gets fresh ids (blocks follow), lands after the active
   *  system like Copy here, and is selected; Save persists it. */
  const placeLibrarySystem = (res: LoadedLibrarySystem) => {
    const newId = "sys" + nextId();
    const placed = placeLoadedSection(res.section, { id: newId, nextId, autoFreightPct: freightDefault.pct });
    setSections((ss) => {
      const at = ss.findIndex((s) => s.id === activeId);
      return at < 0 ? [...ss, placed] : [...ss.slice(0, at + 1), placed, ...ss.slice(at + 1)];
    });
    setLibraryOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => selectSystem(newId)));
    setMoveNotice({ ok: true, targetId: "", targetName: "", targetNumber: "", verb: "Loaded", detail: loadNotice(res) });
  };
```

`selectSystem` is declared above `addSystem`, and `freightDefault`, `activeId` and `nextId` are in scope. Leave the
`const pushItems = ` line after it untouched; the harness slices up to it.

5. **Banner**, at about line 3325. Replace the opening of the expression `{moveNotice.ok && moveNotice.verb === "Copied" ? (`
   with a leading Loaded branch, keeping everything after it byte-identical:

```tsx
                {moveNotice.ok && moveNotice.verb === "Loaded" ? (
                  <>{moveNotice.detail}</>
                ) : moveNotice.ok && moveNotice.verb === "Copied" ? (
```

6. **Button and modal**, right after the dashed `+ Add system` `</button>` (about line 3850), inside the same column:

```tsx
              <button
                type="button"
                className="est-addsys est-addlib"
                onClick={() => setLibraryOpen(true)}
                title="Load a system from a sent or won estimate — re-priced for this one"
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: 10,
                  background: "#fff",
                  border: "1px dashed #d6d9e0",
                  borderRadius: 12,
                  color: "#8c919c",
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                + From library…
              </button>
              {libraryOpen && (
                <SystemLibraryModal mode="load" tierMargin={tierMargin} onLoaded={placeLibrarySystem} onClose={() => setLibraryOpen(false)} />
              )}
```

- [ ] **Step 5: Run the gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
df -h /System/Volumes/Data | tail -1; ps aux | grep -v grep | grep tsx
npx tsc --noEmit
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG"; tail -1 "$LOG"
npx eslint "src/app/(app)/estimator/system-library-modal.tsx" "src/app/(app)/estimator/estimator-client.tsx"
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```

Expected:
- tsc 0;
- test:specs 0 FAIL, PASS = previous + 8;
- eslint 0 errors (warnings on untouched lines are pre-existing, so record them);
- `next build` OK.

A build error naming `postgres`, `pg`, `fs` or `drizzle` means a client file value-imports a server module. Fix the
import, never the check.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/system-library-modal.tsx" "src/app/(app)/estimator/estimator-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 slice 2 — system library modal + Load system\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: Merge narrative in the narrative column

**Files:**
- Modify: `src/app/(app)/estimator/narrative-column.tsx`: imports, one state line, an `applyMerge` function, one menu
  item, the modal mount, and the ⋯ button's title.
- Test: `scripts/test-review-and-spec.ts` (append the block `#293 slice 2 — Merge narrative wiring`)

**Interfaces:**
- **Consumes:**
  - Task 3: `SystemLibraryModal` in `mode: "merge"`.
  - Task 1: `mergeNarrative`, `mergeNotice`, `MergeOpts`, `SystemLibraryEntry`.
  - Slice 1: the column's `p.onChange(fn)` (→ `setSections`, so the #254 banner rule holds) and `setNotice`.
- **Produces:** none (leaf).

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 2 — Merge narrative wiring (narrative column ⋯ menu; the
   card has no ⋯ menu, so the column that owns the narrative hosts it).
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const col = rd("src/app/(app)/estimator/narrative-column.tsx");
  ok(col.includes("Merge narrative from library…") && col.includes('<SystemLibraryModal mode="merge" target={sec}'),
    "#293s merge UI: ⋯ → Merge narrative from library… opens the library in merge mode for this system");
  const apply = col.slice(col.indexOf("const applyMerge = "), col.indexOf("return (", col.indexOf("const applyMerge = ")));
  ok(apply.includes("p.onChange((s) => mergeNarrative(s, sources, opts).section)") && apply.includes("setNotice(mergeNotice(r))") && apply.includes("if (r.changed)"),
    "#293s merge UI: applies through onChange on the live section (setSections) and reports what was added and skipped");
  ok(/^"use client";/.test(col) && !/^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/narrative\/(library|photos|system-library-index|load-system))/m.test(col),
    "#293s merge UI: the column still imports no server-only module");
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; grep '^FAIL ' "$LOG" | head
```

Expected: the two `#293s merge UI` checks FAIL.

- [ ] **Step 3: Edit `narrative-column.tsx`**

1. **Imports**, after `import NarrativeIntrosModal from "./narrative-intros-modal";`:

```ts
import SystemLibraryModal from "./system-library-modal";
import { mergeNarrative, mergeNotice, type MergeOpts } from "@/lib/narrative/merge";
import type { SystemLibraryEntry } from "@/lib/narrative/system-library";
```

2. **State**, right after `const [manageOpen, setManageOpen] = useState(false);`:

```ts
  const [mergeOpen, setMergeOpen] = useState(false);
```

3. **`applyMerge`**, directly before the component's `return (` (after `saveAsIntro`):

```ts
  /** #293 slice 2: Merge narrative — append-only; never invents a line.
   *  Applied through onChange (setSections) on the live section. */
  const applyMerge = (sources: SystemLibraryEntry[], opts: MergeOpts) => {
    const r = mergeNarrative(sec, sources, opts);
    if (r.changed) p.onChange((s) => mergeNarrative(s, sources, opts).section);
    setMergeOpen(false);
    setNotice(mergeNotice(r));
  };
```

4. **Menu.** Inside the ⋯ menu's `role="menu"` div, after the **Manage intros…** button, add (no permission needed —
   it only edits this quote):

```tsx
              <button
                type="button"
                role="menuitem"
                style={{ ...BTN, background: "transparent", textAlign: "left" }}
                onClick={() => { setMenuOpen(false); setMergeOpen(true); }}
              >
                Merge narrative from library…
              </button>
```

   Change the ⋯ button's `title="Intro library"` to `title="Narrative library"`. Nothing pins it.

5. **Modal mount**, right after the `{manageOpen && ( <NarrativeIntrosModal … /> )}` block:

```tsx
      {mergeOpen && (
        <SystemLibraryModal mode="merge" target={sec} onMerge={applyMerge} onClose={() => setMergeOpen(false)} />
      )}
```

Leave untouched the `draft`, `saveAsIntro` and `doSave` bodies, the intro `<select>` onChange, and `NO_LIBRARY`. Slice
1 pins them.

- [ ] **Step 4: Run the gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
df -h /System/Volumes/Data | tail -1; ps aux | grep -v grep | grep tsx
npx tsc --noEmit
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG"; tail -1 "$LOG"
npx eslint "src/app/(app)/estimator/narrative-column.tsx"
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```

Expected: tsc 0; test:specs 0 FAIL, PASS = previous + 3; eslint 0 errors; `next build` OK.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/estimator/narrative-column.tsx" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(estimator): #293 slice 2 — Merge narrative from the system library\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 5: Final gates, browser check, docs

**Files:**
- Modify: `PUNCHLIST.md` (the existing `## 293.` entry: its heading and a new "Slice 2 done" section), `DECISIONS.md`
  (append entries) and `AGENTS.md` (phase item 32).
- No code changes unless a gate finds a defect. A defect fix gets its own commit plus a harness check.

**Interfaces:** consumes everything above; produces the docs.

- [ ] **Step 1: Run the full gates**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/narrative && export PATH=$HOME/.local/node/bin:$PATH
df -h /System/Volumes/Data | tail -1
ps aux | grep -v grep | grep tsx    # nothing of this worktree may hold a datadir
npx tsc --noEmit
LOG=$(mktemp -t specs293s); npm run test:specs > "$LOG" 2>&1; echo "exit $?"; grep -c '^PASS ' "$LOG"; grep '^FAIL ' "$LOG"; grep '#293s' "$LOG" | grep -c '^PASS'; tail -1 "$LOG"
npx eslint $(git diff --name-only origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx')
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3000|3001)\b' || true   # the smoke port must be free
npm run test:smoke 2>&1 | tail -8
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```

Expected:
- tsc 0;
- test:specs `ALL PASSED`, 0 FAIL, PASS = 10,530 + every `#293s` check;
- eslint 0 errors;
- smoke ALL PASSED. There are no new routes: `/estimator` and `/estimator?id=Q-2041` load the modal and column bundles
  (spec §9.2);
- build OK.

Record the real numbers. If smoke shows a run of "fetch failed", check the disk first.

- [ ] **Step 2: Browser check (spec §9.3, Slice 2). The controller runs this if the environment allows.**

Use a scratch datadir, never `.data/pglite`. Read these memories first:
- `peak-worktree-dev-server-browser-verification-traps.md`;
- `peak-preview-start-reads-main-checkout-launch-json.md`;
- `peak-exercising-post-routes-safely.md`.

On seeded data:
1. Mark a quote with a narrative system (intro + one key product) Won.
2. Open a new estimate, then **+ From library…** → search for it.
   - The row shows customer · EST · Won · date.
   - The detail pane shows the intro and key-product headings.
3. **Load system.** The system lands after the active one, is selected, keeps its narrative and its key product
   (★ on), and the banner reports the re-price.
4. In another system that shares two of its parts, open ⋯ → **Merge narrative from library…**, tick the system, and
   check that the preview text matches what happens on **Merge**.
5. Save, and confirm the PDF prints the loaded system's narrative.

Stop the dev server before any further `test:specs`. If this can't run here, say so in the report and the PUNCHLIST
("not exercised in a browser").

- [ ] **Step 3: Recompute the decision numbers right before writing.** The parallel `feat/292-curtain-cut-sheets`
branch also claims D-numbers, so take the maximum across every ref:

```bash
git fetch origin --quiet
maxd=0
for ref in origin/main $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin); do
  d=$(git show "$ref:DECISIONS.md" 2>/dev/null | grep -oE '^## D[0-9]+\.' | grep -oE '[0-9]+' | sort -n | tail -1)
  [ -n "$d" ] && [ "$d" -gt "$maxd" ] && maxd=$d
done
echo "highest D$maxd → next free D$((maxd+1))"
```

The punch number stays **#293**, with no new number. Re-run the loop immediately before committing, and renumber if it
moved.

- [ ] **Step 4: Append the `DECISIONS.md` entries.** Use the file's format,
`## D<n>. <title> (#293 slice 2, 2026-10-01)` plus a paragraph, with `N` = the next free number:
  1. **D(N) The system library is computed, never curated.**
     - What's indexed: sent and won system quotes (`quoteType` "system" or absent), read from the latest sent revision.
     - Won without a send uses the live spec.
     - Never indexed: Daylite history, lost quotes, drafts, post-send edits, service quotes, labor systems, and
       systems that are empty without the Rewards credit.
     - Ranking: won → sent → newest → name match.
     - Hits carry 140-character snippets, never text bodies.
     - A 5-minute per-process cache, invalidated by every real `setStatus` transition and by `remove()`. (Spec
       decision 11, §2.4, §4.1.)
  2. **D(N+1) Load system reuses Copy system's pricing.**
     - Pricing: the catalog and fixture loading moved to `estimator/copy-pricing.ts` (`copyPricingFor`), shared by
       Copy and Load. The `#274B` source check now reads that file — the one harness pin retargeted.
     - Source: the server re-reads the quote and picks the snapshot by the rule as of now, so a re-sent quote loads
       its newest sent revision.
     - Left out: vendor-quote lines (counted), blocks on dropped or missing lines, the Rewards credit and `room`.
     - Placement: freight follows this estimate's auto default when `freightAuto`; ids are re-minted client-side with
       blocks remapped; the system lands after the active one.
     - A gone key answers "That estimate is no longer available" and invalidates the index. (Spec decision 12, §4.2.)
  3. **D(N+2) Merge narrative is append-only.**
     - Intros are deduped after whitespace normalization; an intro that would pass `MAX_INTRO` is skipped and
       counted.
     - A block anchors to the first eligible unmarked line with its sku, and is never invented.
     - Overflow at `MAX_KEY_PRODUCTS` is reported separately (`skippedFull`), a deviation from the spec's
       `skippedNoLine`, so the notice never tells staff to "add the part first" for a full system.
     - Merge never switches presentation. (Spec decision 13, §2.5.)
  4. **D(N+3) Where the library lives in the UI.**
     - **+ From library…** sits under the cards column's **+ Add system**, because the rail's own button reads
       "+ Add" and has no room.
     - **Merge narrative from library…** is in the narrative column's ⋯ menu, because the system card has no ⋯ menu
       (spec §4.2 assumed one).
     - One modal serves both modes. Has narrative starts on in merge mode.
     - The Load notice reuses the move/copy banner (`verb: "Loaded"`).

- [ ] **Step 5: Update the `PUNCHLIST.md` #293 entry.** Keep the number.
  1. Change the heading's tail from `— Slice 1 DONE 2026-10-01 (D539–D545)` to
     `— Slices 1–2 DONE 2026-10-01 (D539–D545, D<N>–D<N+3>)`.
  2. Replace the line `**Slice 2 (next).** System library, Load system, Merge narrative (spec §4, §8.2).` with:

```
**Slice 2 done (D<N>–D<N+3>).**
- **System library.** + From library… (under + Add system) searches every system on a sent or won estimate, read
  from its latest sent revision, by name, customer, EST number, sku or description. Won comes first, then newest.
  Drafts, post-send edits, lost quotes and Daylite history never appear.
- **Load system** adds the system re-priced at today's catalog and this estimate's tier (Copy system's own pricing,
  now shared through `copy-pricing.ts`). Its narrative and key products carry; vendor-quote lines are left out and
  counted.
- **Merge narrative** (narrative column ⋯) appends intros and anchors key products onto lines this system already
  has, with a preview, and reports what it skipped.
- **Plan:** `docs/superpowers/plans/2026-10-01-narrative-slice2.md`.

Gates: tsc 0; test:specs <PASS> PASS / 0 FAIL (<k> for #293 slice 2); test:smoke <n>/<n> ALL PASSED; `next build` OK.
Browser: <what was exercised, or "not exercised in a browser">.
```

  3. Under **For Jeff**, add one bullet: "Spec §12 q7 — vendor-quote lines are left out of Load system; say if you'd
     rather carry them with their files."

- [ ] **Step 6: Update `AGENTS.md` item 32.**
  - Change its title from `**Narrative-first client preview — Slice 1**` to
    `**Narrative-first client preview — Slices 1–2**`.
  - Change `(#293, D539–D545)` to `(#293, D539–D545, D<N>–D<N+3>)`.
  - Replace the sentence `Slices 2 (system library) and 3 (client link) follow.` with:

```
Slice 2 adds the computed system library
    (sent/won systems from the latest sent revision; 5-minute index
    invalidated by setStatus/remove), Load system (re-priced through
    Copy system's shared `copy-pricing.ts`, vendor lines left out) and
    append-only Merge narrative. Slice 3 (client link) follows.
```

- [ ] **Step 7: Commit the docs**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md
git commit -m "$(printf 'docs: #293 slice 2 — PUNCHLIST, DECISIONS, AGENTS phase list\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

Don't push or merge. Hand back to the controller for the final review, the merge to main and the deploy.

---

## Self-review notes (spec coverage)

| Spec section | Covered by |
|---|---|
| §2.4 `systemLibraryEntries`, `searchSystemLibrary`, source rules, ranking, `hasNarrative`, limit | Task 1 |
| §2.5 `mergeNarrative` (intro append + dedupe, anchoring, skippedPresent / skippedNoLine, cap, intro/products off) | Task 1 |
| §4.1 index + 5-minute cache + invalidation, `searchSystemLibraryAction` (hits, no bodies), `getSystemLibraryEntryAction` | Task 2 |
| §4.2 Load: server re-read, vendor lines dropped and counted, shared pricing helper, source/target tier, result counts | Task 2 |
| §4.2 Load client side: new id, re-id, remap, name kept, after active, selected, notice | Tasks 1 (`placeLoadedSection`, `loadNotice`) and 3 |
| §4.2 modal: search, Has narrative, rows, detail pane; Merge: multi-select, Intro / Key products, preview, apply, notice | Tasks 3 and 4 |
| §6 deleted quote since indexing → refused + invalidated; Daylite/lost never | Tasks 1 and 2 |
| §8.2 done criteria | Tasks 1–5 |
| §9.1 Slice 2 harness (entries, search, merge, Load pricing helper DB) | Tasks 1–4 |
| §9.2 smoke — no new routes; `/estimator` covers the bundles | Task 5 |
| §9.3 browser | Task 5 |
| §10 docs | Task 5 |

**Where the shipped Slice 1 code and the repo forced adaptations (logged in D(N+1)–D(N+3)):**
- **Merge entry point.** The system card has no ⋯ menu. Its header has Copy… / Move… buttons, and #292 edits
  `section-card.tsx`. Merge lives in the narrative column's existing ⋯ menu instead.
- **+ From library… placement.** The rail's button is "+ Add", in a 262 px header with no room, so the new button sits
  under the column's "+ Add system".
- **Factoring out the pricing helper** moves the code a `#274B` source check pins. That one check is retargeted to the
  new file, keeping the same regex.
- **Overflow list.** `MergeResult` gains `skippedFull` and `introsTooLong`, beyond the spec's shape, so the notice stays
  truthful.
- **Load keys.** A key resolves by the library rule at load time, not its stored rev.
- **What Load also drops:** `room`, and blocks on dropped or missing lines.
- **Absent `quoteType`** is read as system, per the `Quote` type comment.
