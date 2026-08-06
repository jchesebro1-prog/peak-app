# Dynamic Smoke Coverage, Mint Guards & Excel Catalog Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close punch #79 (smoke test covers no dynamic routes) and #81 (no Excel import for the catalog); take #80 (`insertWithPrefixedId` throws unguarded) as far as it can honestly go — 6 of 11 call sites — and log the remainder with its reasoning.

**Architecture:** #79 adds demo seed records for the collections that have none (`grid_projects`, plus a consulting quote that makes an engagement materialize through the existing sync), then extends `scripts/smoke-routes.ts` with a second pass over dynamic `[id]` routes keyed on seed constants. #80 wraps the mint call at the 6 sites that return a value a caller can act on; the 5 void FormData actions are deferred rather than half-fixed. #81 adds `exceljs` (server-side only), a `POST /api/import/xlsx` route handler that converts sheet 1 to CSV text, a `catalog` type in the import hub, and a file input that funnels the converted CSV into the existing paste/preview/confirm flow unchanged.

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7. Tasks 4–6 are strictly sequential (6 calls the route handler 4 creates; 5's writer is what 6's upload ultimately feeds). Task 3 is independent of the rest and can move if convenient.

**Tech Stack:** Next.js 16 (Turbopack), TypeScript, Drizzle ORM, PGlite (local) / Postgres (hosted), `tsx` for scripts, `exceljs` 4.4.0.

## Global Constraints

- **Never write to `.data/pglite`** from any test or script. The dev PGlite datadir is single-writer with a five-corruption history. The smoke test uses `PGLITE_PATH` pointed at a scratch temp dir and explicitly deletes `DATABASE_URL`.
- **`exceljs` is server-side only.** It must never be imported from a `"use client"` module — that drags Node stream internals into the browser bundle and 500s the page (the #78 trap). Import it only inside the route handler and the spec test.
- **Do NOT change `insertWithPrefixedId` to return `null`.** It must keep throwing; only callers change. Returning null silently reintroduces the class of bug #62 existed to fix.
- **`xlsx`/SheetJS is forbidden as a dependency** — the npm copy is abandoned at 0.18.5 with unpatched CVE-2023-30533.
- Verification commands, all run from the repo root: `npx tsc --noEmit`, `npx eslint`, `npm run test:specs`, `npm run test:smoke`.
- `npm run test:smoke` requires `next dev` NOT already running against the same repo? No — it boots its own server on a free port against a scratch datadir, so it is safe to run alongside a dev server.

---

## File Structure

**Created:**
- `src/db/seeds/grid-projects.ts` — one seeded Grid design (`GRD-5001`) so `design/grid/[id]` renders the real editor.
- `src/app/api/import/xlsx/route.ts` — auth-gated POST handler: `.xlsx` file → CSV text.
- `src/lib/import/xlsx-to-csv.ts` — pure-ish sheet→CSV conversion, importable by both the route handler and the spec test.

**Modified:**
- `src/db/seeds/quotes.ts` — add one consulting quote (`Q-2045`) so an engagement materializes via the existing sync.
- `src/db/seed-data.ts` — register the grid-projects seed in `DEMO_SEEDS`.
- `scripts/smoke-routes.ts` — add the dynamic-route pass.
- 11 server-action files (listed in Task 4) — guard the mint call.
- `src/app/(app)/import/types.ts` — add the `catalog` import type.
- `src/app/(app)/import/registry.ts` — add the `catalog` writer.
- `src/app/(app)/import/controls.tsx` — add the file input that fetches the route handler and fills the existing textarea.
- `scripts/test-review-and-spec.ts` — add xlsx round-trip + catalog-mapping assertions.
- `PUNCHLIST.md` — status updates for #79, #80, #81.

---

## Task 1: Seed a Grid design and a consulting quote

Without this, `design/grid/[id]` returns a friendly 200 for any id and never mounts the editor — a smoke check against it would pass while compiling nothing.

**Files:**
- Create: `src/db/seeds/grid-projects.ts`
- Modify: `src/db/seeds/quotes.ts`
- Modify: `src/db/seed-data.ts`

**Interfaces:**
- Consumes: `GridProject` from `@/lib/stores/grid-projects`; `Quote` from `@/lib/stores/quotes`.
- Produces: `gridProjectsSeed(): GridProject[]` exporting one record with id `GRD-5001`; a consulting quote `Q-2045` in `quotesSeed()`. Task 2 depends on both ids.

- [ ] **Step 1: Write the failing test**

**Two conventions this file enforces — match them or the run won't compile:**
- It imports through the `@/` path alias, never relative `../src/…` paths.
- `package.json` has no `"type": "module"`, so the script is **CommonJS and top-level `await` is unavailable**. It is currently fully synchronous. Any async assertion must live inside an `async function` that the file invokes — Tasks 4 and 5 add the first ones.

Add these imports at the head of the file with the others:

```ts
import { gridProjectsSeed } from "@/db/seeds/grid-projects";
import { quotesSeed } from "@/db/seeds/quotes";
```

Then append the assertions just before the file's final summary block:

```ts
/* ---- punch #79: demo seed reaches the dynamic routes ---- */
const gridSeeded = gridProjectsSeed();
ok(gridSeeded.length >= 1, "#79 grid seed produces at least one design");
ok(gridSeeded[0].id === "GRD-5001", "#79 grid seed id is GRD-5001 (base 5001 floor)");
ok(
  typeof gridSeeded[0].customer === "string" && gridSeeded[0].customer.length > 0,
  "#79 grid seed carries a customer name"
);

const consultingQuotes = quotesSeed().filter(
  (q) => (q as { quoteType?: string }).quoteType === "consulting"
);
ok(consultingQuotes.length === 1, "#79 exactly one consulting quote is seeded");
ok(
  consultingQuotes[0].status === "won",
  "#79 the consulting quote is won, so syncEngagementsFromQuotes mints an engagement"
);
```


- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module `@/db/seeds/grid-projects` not found.

- [ ] **Step 3: Create the grid seed**

Create `src/db/seeds/grid-projects.ts`:

```ts
import type { GridProject } from "@/lib/stores/grid-projects";

/**
 * Grid seed — one worked system design so the editor route has something
 * real to open. Added 2026-08-06 for punch #79: `design/grid/[id]` renders
 * a friendly "no longer exists" page (status 200) for an unknown id rather
 * than calling notFound(), so without a seeded record the route smoke test
 * would pass while never mounting GridEditor at all.
 *
 * Id is GRD-5001 — createProject()'s base is 5001 and nextPrefixedId()
 * returns base+1 for an empty collection, so seeding the floor itself keeps
 * the first minted design at GRD-5002 with no collision.
 *
 * Deliberately carries no sheets or placements: the plan background lives in
 * the separate grid_sheets collection as a base64 payload, and the editor
 * renders fine with an empty canvas. Seeding a fake image would add weight
 * for no coverage.
 */
export function gridProjectsSeed(): GridProject[] {
  const t = Date.now();
  return [
    {
      id: "GRD-5001",
      name: "Main Stage — rigging & audio layout",
      customer: "Lakefront Performing Arts Center",
      customerId: "lakefront",
      siteId: "st-lakefront-1",
      siteName: "Main Stage",
      sheetIds: [],
      placements: [],
      calibrations: [],
      spaces: [],
      routes: [],
      revisions: [],
      quoteId: null,
      createdBy: "Jeff Chesebro",
      createdAt: t,
      updatedAt: t,
    },
  ];
}
```

- [ ] **Step 4: Register it in DEMO_SEEDS**

In `src/db/seed-data.ts`, add the import beside the other seed imports:

```ts
import { gridProjectsSeed } from "./seeds/grid-projects";
```

and add the entry to `DEMO_SEEDS` (order does not matter; keep it next to `designs` for readability):

```ts
  ["designs", designsSeed as unknown as () => Doc[]],
  ["grid_projects", gridProjectsSeed as unknown as () => Doc[]],
```

- [ ] **Step 5: Add the consulting quote**

`quotesSeed()` builds from a `SeedBase[]` array and then `.map()`s each entry into a full `Quote`, attaching `customerId`/`locationId` from `SEED_CUST`, a `history` entry and a `review`. `SeedBase` has no `quoteType` field, so three edits are needed.

**(a)** Add the optional field to the `SeedBase` type (line ~103):

```ts
type SeedBase = {
  id: string;
  name: string;
  customer: string;
  value: number;
  margin: number;
  status: QuoteStatus;
  source: string;
  owner: string;
  createdAt: number;
  updatedAt: number;
  /** Absent on system quotes; "consulting" routes the quote into the
   *  engagement sync (punch #79 needs one so CE-1001 materializes). */
  quoteType?: string;
};
```

**(b)** Add the record to the `base` array, matching the existing one-line-per-quote style:

```ts
    { id: "Q-2045", name: "Lakefront PAC — Systems Consulting & Bid Support", customer: "Lakefront Performing Arts Center", value: 48500, margin: 0.42, status: "won", source: "estimator", owner: "Jack Hamilton", createdAt: ago(24), updatedAt: ago(11), quoteType: "consulting" },
```

**(c)** Add its customer link to `SEED_CUST` (line ~94), reusing the same site `Q-2041` uses:

```ts
  "Q-2045": ["lakefront", "lf1"],
```

The `.map()` already spreads `...q`, so `quoteType` carries through with no change to the mapper.

Why `status: "won"`: `syncEngagementsFromQuotes()` creates an engagement at stage `awarded` for a won consulting quote. `loadConsultingData()` runs that sync, and **both** `/design/engagements` and `/design/engagements/[id]` call it — so the engagement materializes no matter which route is hit first, with no ordering dependency in the smoke test. On an empty collection `insertWithPrefixedId("consulting_engagements", "CE", 1000, …)` yields **`CE-1001`** (base is a floor; `nextPrefixedId` returns `max + 1`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:specs`
Expected: PASS, including the five new `#79` assertions.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint`
Expected: both exit 0.

- [ ] **Step 8: Verify the routes actually render**

Run: `npm run test:smoke`
Expected: ALL PASSED (the existing 40 top-level routes; the dynamic pass arrives in Task 2). This confirms the new seed records did not break the list pages that render them.

- [ ] **Step 9: Commit**

```bash
git add src/db/seeds/grid-projects.ts src/db/seeds/quotes.ts src/db/seed-data.ts scripts/test-review-and-spec.ts
git commit -m "feat(seed): add a Grid design and a consulting quote to demo data (punch #79)

design/grid/[id] renders a friendly 200 for unknown ids instead of calling
notFound(), so a smoke check against a made-up id would pass while never
mounting GridEditor. Seeding GRD-5001 gives it a real record to open. The
consulting quote lets syncEngagementsFromQuotes mint CE-1001 through the
real builder rather than hand-authoring an engagement doc that would drift
from fromQuote()."
```

---

## Task 2: Extend the smoke test to dynamic routes

**Files:**
- Modify: `scripts/smoke-routes.ts`

**Interfaces:**
- Consumes: seed ids from Task 1 (`GRD-5001`, `CE-1001`) plus the pre-existing constants.
- Produces: a `DYNAMIC_ROUTES` array and a `bodyMustNotContain` check used by no later task.

- [ ] **Step 1: Add the dynamic route table**

In `scripts/smoke-routes.ts`, directly after the existing `ROUTES` array, add:

```ts
/**
 * Dynamic `[id]` routes (punch #79). The top-level pass above never compiles
 * these, which is where most of the app's behaviour lives — #76's
 * "use server" illegal-export bug sat in design/grid/[id]/actions.ts and
 * passed 40/40 because no route importing that module was ever built.
 *
 * Ids are seed constants, NOT discovered at runtime: PGlite is single-writer,
 * so this process cannot open the scratch datadir while `next dev` holds it.
 * That is safe because every route here except the Grid calls notFound() on
 * an unknown id, so a drifted constant fails loudly as a 404 rather than
 * silently covering nothing.
 *
 * `reject` guards the one exception: design/grid/[id] renders a friendly 200
 * "That design no longer exists" page instead of a 404, so status alone
 * cannot distinguish a rendered editor from a miss.
 */
const DYNAMIC_ROUTES: Array<{ route: string; reject?: string }> = [
  { route: "/projects/P-3001" },
  { route: "/inspections/RI-2042" },
  { route: "/field-survey/FS-1055" },
  { route: "/companies/lakefront" },
  { route: "/customers/lakefront" }, // redirects to /companies/lakefront
  { route: "/venues/st-lakefront-1" }, // identity convert: st-${docId}-${n}
  { route: "/people/ct-lakefront-1" }, // identity convert: ct-${docId}-${m}
  { route: "/estimator?id=Q-2041" },
  { route: "/design/grid/GRD-5001", reject: "no longer exists" },
  { route: "/design/engagements/CE-1001" },
];
```

- [ ] **Step 2: Teach checkRoute about the body rejection**

Replace the existing `checkRoute` signature and its `problem` line with:

```ts
async function checkRoute(
  base: string,
  route: string,
  jar: CookieJar | null,
  reject?: string
): Promise<{ route: string; ok: boolean; detail: string }> {
  try {
    const res = await fetch(base + route, {
      redirect: "follow",
      headers: jar ? { Cookie: jar.header() } : {},
    });
    const body = await res.text();
    const finalUrl = new URL(res.url);
    let problem = looksLikeErrorPage(res.status, finalUrl.pathname + finalUrl.search, body);
    if (!problem && reject && body.includes(reject)) {
      problem = `body contains "${reject}" — the route answered 200 without rendering the record`;
    }
    if (problem) {
      return { route, ok: false, detail: `status ${res.status}, final ${finalUrl.pathname}${finalUrl.search} — ${problem}` };
    }
    return { route, ok: true, detail: `status ${res.status}` };
  } catch (err) {
    return { route, ok: false, detail: `request failed: ${(err as Error).message}` };
  }
}
```

- [ ] **Step 3: Run both passes**

In `main()`, immediately after the existing `for (const route of ROUTES)` loop, add:

```ts
    console.log("[smoke] --- dynamic [id] routes ---");
    for (const d of DYNAMIC_ROUTES) {
      const r = await checkRoute(base, d.route, jar, d.reject);
      report(r.ok, `${d.route} (${r.detail})`);
    }
```

- [ ] **Step 4: Run the smoke test**

Run: `npm run test:smoke`
Expected: ALL PASSED, with 10 additional PASS lines under the `--- dynamic [id] routes ---` header.

If `/design/engagements/CE-1001` fails with a 404, the engagement id drifted — check whether another consulting quote reached the seed (which would shift the mint). If `/design/grid/GRD-5001` fails on the body rejection, the seed did not load; confirm `grid_projects` is in `DEMO_SEEDS`.

- [ ] **Step 5: Prove the new coverage actually catches the bug class it exists for**

This is the step that makes #79 real rather than assumed — #78 earned its keep by doing exactly this.

Temporarily add an illegal synchronous export to `src/app/(app)/design/grid/[id]/actions.ts` (a `"use server"` module, where Next requires every export to be async — the precise shape of the #76 bug):

```ts
export function __smokeCanary(): number {
  return 1;
}
```

Run: `npm run test:smoke`
Expected: **FAIL** on `/design/grid/GRD-5001`. Then delete the canary export and re-run to confirm ALL PASSED. Do not commit the canary.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-routes.ts
git commit -m "test(smoke): cover dynamic [id] routes (punch #79)

Adds 10 detail routes keyed on seed constants. Ids are constants rather
than runtime-discovered because PGlite is single-writer and this process
cannot open the scratch datadir while next dev holds it; every route but
the Grid calls notFound() on a bad id, so drift fails loudly.

The Grid check also rejects the 'no longer exists' body, because that route
answers 200 without mounting the editor. PROVEN: an illegal sync export in
design/grid/[id]/actions.ts (the #76 bug shape) now fails the run."
```

---

## Task 3: Guard the mint throw at the 6 call sites that can report a failure

**Scope decision (Jeff, 2026-08-06).** The 11 unguarded sites are not one homogeneous group. Six return a value to a caller that can render a failure; five are `Promise<void>` FormData actions with nowhere to put an error. **Only the six are in scope here.**

For the void five (`design/grid/actions.ts:19`, `field-work/actions.ts:38`, `projects/actions.ts:175`, `inspections/actions.ts:23`, `field-survey/actions.ts:18`), the available half-measure — redirect back with an `?err=` param — is actively harmful: **none of those destination pages render an `err` param today**, so the user would get a list page with no record and no explanation. That converts a loud crash into a silent no-op, which is the exact failure mode #62 existed to eliminate. They are deferred to a new punch entry in Task 7, with the reasoning recorded.

**Files (all six):**
- Modify: `src/app/(app)/companies/actions.ts:183` — `addCustomerNoteAction`
- Modify: `src/app/(app)/inbox/site-visit-actions.ts:62`
- Modify: `src/app/(app)/inbox/actions.ts:452` — `logInteractionAction`
- Modify: `src/app/api/leads/intake/route.ts:73`
- Modify: `src/app/(app)/design/quick/actions.ts:48` — via `persistDesign`
- Modify: `src/app/(app)/leads/actions.ts:207` — `createLeadAction`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: widened return unions on `saveDesignAction`, `saveRevisionAction` and `createLeadAction` (see Step 3). No new exported symbols.

**Reference — the already-correct pattern** is `estimator/actions.ts:123` (`saveQuoteAction`). Read it before starting and mirror its comment style and error copy.

- [ ] **Step 1: Re-verify the inventory**

Run: `grep -rn "insertWithPrefixedId" src/ | grep -v doc-store.ts`

Confirm the six above are still the guardable set, and that these remain **already guarded — do not touch**: `estimator/actions.ts` (`saveQuoteAction`) and `convertLeadAction` in `leads/actions.ts`.

Confirm `src/app/(app)/import/registry.ts` is **out of scope**: `commitImport` already wraps every row in try/catch and converts a throw into `res.errored++`. Guards there would be dead code.

- [ ] **Step 2: Guard the three sites that already have a failure variant**

These need no type changes — the failure shape exists; the mint just isn't inside a try.

`companies/actions.ts` (`addCustomerNoteAction` already returns `{ ok: false as const, error: "Write a note first." }` on bad input):

```ts
  try {
    await addNoteRecord(/* …existing arguments, unchanged… */);
  } catch (err) {
    // #80: insertWithPrefixedId throws once its 5-attempt retry budget is
    // exhausted. Report it through this action's existing failure shape
    // instead of escaping as a raw 500 from a button press.
    console.error("addCustomerNoteAction: note mint failed", err);
    return { ok: false as const, error: "Couldn’t save that note — please try again." };
  }
```

`inbox/site-visit-actions.ts` (already returns `{ ok: false, error: "Bad time range" }`):

```ts
  let rec;
  try {
    rec = await createVisit({ /* …existing arguments, unchanged… */ });
  } catch (err) {
    console.error("site-visit action: visit mint failed", err);
    return { ok: false, error: "Couldn’t schedule that visit — please try again." };
  }
```

`inbox/actions.ts` (`logInteractionAction` already returns `{ ok: false as const, id: null }`):

```ts
  let rec;
  try {
    rec = await create({ /* …existing arguments, unchanged… */ });
  } catch (err) {
    console.error("logInteractionAction: comm mint failed", err);
    return { ok: false as const, id: null };
  }
```

- [ ] **Step 3: Widen the two success-only unions**

`design/quick/actions.ts` — `persistDesign` is a private helper; the exported actions are `saveDesignAction` and `saveRevisionAction`, both currently typed success-only. Widen both and guard at the helper's call sites:

```ts
export async function saveDesignAction(
  id: string | null,
  partial: DesignPartial
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  let record: DesignRecord;
  try {
    record = await persistDesign(id, partial, user.name);
  } catch (err) {
    console.error("saveDesignAction: design mint failed", err);
    return { ok: false, error: "Couldn’t save that design — please try again." };
  }
  revalidatePath("/design/designs");
  return { ok: true, record };
}
```

Apply the same shape to `saveRevisionAction` (its success variant also carries `rev`).

`leads/actions.ts` — `createLeadAction` currently ends `return { ok: true as const, id: rec.id }`:

```ts
  let rec;
  try {
    rec = await create(/* …existing arguments, unchanged… */);
  } catch (err) {
    console.error("createLeadAction: lead mint failed", err);
    return { ok: false as const, id: null, error: "Couldn’t create that lead — please try again." };
  }
```

Widen its declared return type to the union. **`tsc` will point at every client caller that now has to handle `ok: false`** — fix each one to surface the error in whatever way that screen already reports failures. Do **not** cast the union away or return a fake success.

- [ ] **Step 4: Guard the public intake route**

`src/app/api/leads/intake/route.ts` is an external HTTP endpoint, not a server action:

```ts
  let lead;
  try {
    lead = await create({ ...fields, source: "website" });
  } catch (err) {
    console.error("leads intake: lead mint failed", err);
    return NextResponse.json(
      { ok: false, error: "Could not record that submission. Please try again." },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
```

503 (not 500): the failure is transient contention, so a well-behaved client should retry.

- [ ] **Step 5: Typecheck after each file**

Run: `npx tsc --noEmit`
Expected: exit 0. Widening a return type reliably surfaces consumers that need updating — fix them before moving to the next file.

- [ ] **Step 6: Lint**

Run: `npx eslint`
Expected: exit 0.

- [ ] **Step 7: Run the full suites**

Run: `npm run test:specs && npm run test:smoke`
Expected: both pass. The smoke test matters here — a `"use server"` module whose export signature changed shape is exactly what it catches.

- [ ] **Step 8: Commit**

```bash
git add src/app
git commit -m "fix: guard insertWithPrefixedId's throw where an error can be reported (punch #80)

insertWithPrefixedId throws once its 5-attempt retry budget is exhausted.
Only saveQuoteAction and convertLeadAction caught it. Six more call sites
return a value to a caller that can render a failure; those now do, either
through a failure variant they already had or a newly widened union.

Five sites are deliberately NOT guarded here: they are void FormData actions
whose destination pages render no error param, so redirecting with err= would
turn a loud crash into a silent no-op — the exact failure mode #62 existed to
eliminate. Logged separately rather than half-fixed.

insertWithPrefixedId itself is unchanged. Making it return null would
silently reintroduce #62's bug class.

import/registry.ts needed no change: commitImport already converts a per-row
throw into res.errored++."
```

---

## Task 4: xlsx → CSV conversion (dependency, module, route handler)

**Files:**
- Create: `src/lib/import/xlsx-to-csv.ts`
- Create: `src/app/api/import/xlsx/route.ts`
- Modify: `package.json` (adds `exceljs`)
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `xlsxToCsv(buf: ArrayBuffer | Buffer): Promise<{ ok: true; csv: string; rows: number; sheetName: string } | { ok: false; error: string }>` — consumed by the route handler and the spec test. Task 6 consumes `POST /api/import/xlsx`.

- [ ] **Step 1: Install the dependency**

```bash
npm install exceljs@4.4.0
```

Then confirm no advisory arrived with it:

```bash
npm audit --omit=dev
```

Expected: no high or critical advisory attributable to `exceljs`. **Do not install `xlsx`** — see Global Constraints.

- [ ] **Step 2: Write the failing test**

This introduces the file's **first async assertions**, and the script is CommonJS — top-level `await` is unavailable. Establish the pattern here: an `async function` holding every async check, invoked once at the end, before the summary block.

Add the imports at the head with the others:

```ts
import ExcelJS from "exceljs";
import { xlsxToCsv } from "@/lib/import/xlsx-to-csv";
```

Add the async block. **Place its invocation so the summary/exit-code block runs after it resolves** — read the file's ending first; if the summary is bare top-level statements, move them into a `.then()` on this call, or into the same async function after the awaits:

```ts
/* ---- punch #81: xlsx → CSV conversion ---- */
async function xlsxFixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Price List");
  ws.addRow(["Part Number", "Description", "MSRP", "Dealer", "Manufacturer"]);
  ws.addRow(["S4LED-S2", "Source Four LED Series 2", 1899.5, 1139.7, "ETC"]);
  ws.addRow(["CS-40", 'Curtain track, 40" carrier, "heavy" duty', 42, 25.2, "ADC"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function asyncChecks(): Promise<void> {
  const xr = await xlsxToCsv(await xlsxFixture());
  ok(xr.ok, "#81 a well-formed .xlsx converts");
  if (xr.ok) {
    const lines = xr.csv.split("\n");
    ok(lines[0] === "Part Number,Description,MSRP,Dealer,Manufacturer", "#81 header row survives");
    ok(lines[1] === "S4LED-S2,Source Four LED Series 2,1899.5,1139.7,ETC", "#81 numbers keep full precision");
    ok(
      lines[2] === 'CS-40,"Curtain track, 40"" carrier, ""heavy"" duty",42,25.2,ADC',
      "#81 commas and quotes are CSV-escaped"
    );
    ok(xr.rows === 2, "#81 row count excludes the header");
    ok(xr.sheetName === "Price List", "#81 the sheet name comes back for the UI");
  }

  const notAWorkbook = await xlsxToCsv(Buffer.from("this is not a spreadsheet"));
  ok(!notAWorkbook.ok, "#81 garbage input fails cleanly instead of throwing");
}
```

Task 5 appends its catalog checks to this same `asyncChecks()` function rather than adding a second one.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module `@/lib/import/xlsx-to-csv` not found.

- [ ] **Step 4: Write the conversion module**

Create `src/lib/import/xlsx-to-csv.ts`:

```ts
import ExcelJS from "exceljs";

/**
 * Sheet 1 of an .xlsx → CSV text (punch #81).
 *
 * SERVER-ONLY. exceljs pulls Node stream internals; importing it from a
 * "use client" module drags them into the browser bundle and 500s the page
 * — the exact trap that broke the Estimator in #78. Import this only from
 * route handlers, server actions, and scripts.
 *
 * Emitting CSV rather than a parsed table is deliberate: the import hub's
 * whole pipeline (auto-mapping, live preview, the authoritative server-side
 * re-parse in importRecords) already runs on CSV text. Converting here means
 * an uploaded workbook rejoins the existing paste path instead of forking it.
 *
 * NOT a replacement for scripts/convert-dealer-sheets.py, which handles 52
 * vendors' headerless, multi-tab, PDF-converted sheets for the one-time #39
 * build-out. This reads one ordinary sheet with a header row.
 */

export type XlsxToCsvResult =
  | { ok: true; csv: string; rows: number; sheetName: string }
  | { ok: false; error: string };

/** RFC-4180 escaping — quote when the value carries a comma, quote, CR or LF. */
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/** One cell → its text. Dates go ISO; formulas use their cached result. */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue);
    if ("text" in o) return String(o.text ?? "");
    if ("richText" in o)
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    if ("hyperlink" in o) return String(o.text ?? o.hyperlink ?? "");
    return "";
  }
  return String(value);
}

export async function xlsxToCsv(buf: ArrayBuffer | Buffer): Promise<XlsxToCsvResult> {
  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    const ab = Buffer.isBuffer(buf)
      ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      : buf;
    await wb.xlsx.load(ab as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn’t be read as an Excel workbook." };
  }

  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "That workbook has no sheets." };

  // Trailing empty columns are common in hand-edited sheets; width comes from
  // the widest row actually present rather than the sheet's declared extent.
  const grid: string[][] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    if (cells.some((c) => c.trim() !== "")) {
      grid.push(cells);
      width = Math.max(width, cells.length);
    }
  });

  if (grid.length < 2) {
    return { ok: false, error: "That sheet needs a header row and at least one data row." };
  }

  const csv = grid
    .map((r) => {
      const padded = r.slice();
      while (padded.length < width) padded.push("");
      return padded.map(csvCell).join(",");
    })
    .join("\n");

  return { ok: true, csv, rows: grid.length - 1, sheetName: ws.name };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:specs`
Expected: PASS, including all seven `#81` assertions.

- [ ] **Step 6: Write the route handler**

Create `src/app/api/import/xlsx/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/session";
import { xlsxToCsv } from "@/lib/import/xlsx-to-csv";

/**
 * .xlsx upload → CSV text (punch #81). Converts only; writes nothing. The
 * client drops the returned CSV into the import hub's existing textarea, so
 * preview, mapping and the authoritative re-parse in importRecords all run
 * unchanged.
 *
 * Gated on the same manage_users permission as importRecords — it must not
 * be an open file-parsing endpoint even though it persists nothing.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  await requirePerm("manage_users");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That file is larger than 10 MB. Split it, or export the sheet as CSV." },
      { status: 413 }
    );
  }

  const res = await xlsxToCsv(await file.arrayBuffer());
  if (!res.ok) return NextResponse.json(res, { status: 422 });

  return NextResponse.json(res);
}
```

- [ ] **Step 7: Typecheck, lint, smoke**

Run: `npx tsc --noEmit && npx eslint && npm run test:smoke`
Expected: all exit 0. The smoke run confirms the new route did not break the client bundle.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/import/xlsx-to-csv.ts src/app/api/import/xlsx/route.ts scripts/test-review-and-spec.ts
git commit -m "feat(import): server-side .xlsx → CSV conversion (punch #81)

exceljs, not xlsx/SheetJS: the npm copy of SheetJS is abandoned at 0.18.5
(2022) with unpatched CVE-2023-30533, because upstream moved distribution
to their own CDN. exceljs is MIT, on npm, maintained.

Parsing is server-side, so the client bundle doesn't grow and exceljs's Node
stream internals never reach the browser. Emitting CSV rather than a parsed
table lets an uploaded workbook rejoin the existing paste pipeline instead
of forking it.

Test builds its fixture workbook in memory and reads it back, so no binary
lands in the repo and the round-trip is what's verified."
```

---

## Task 5: Add the `catalog` import type and writer

**Files:**
- Modify: `src/app/(app)/import/types.ts`
- Modify: `src/app/(app)/import/registry.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `xlsxToCsv` (Task 4) in the test only.
- Produces: an `IMPORT_TYPES` entry keyed `"catalog"` with field keys `sku, desc, category, unit, list, cost, mfr`; a `WRITERS.catalog` entry. Task 6 consumes the type key.

- [ ] **Step 1: Write the failing test**

These checks are synchronous, but keep them beside the Task 4 block for cohesion — append them **inside** the `asyncChecks()` function Task 4 created.

Note the import aliasing: the file already imports a different `parseCsv` (from `@/app/(app)/design/engagements/spec/parse-bom`) at line 2, so the import-hub one must be renamed at the import site or it will collide.

Add at the head with the other imports:

```ts
import { getTypeMeta } from "@/app/(app)/import/types";
import {
  autoMap,
  parseCsv as parseImportCsv,
  prepareRows,
} from "@/app/(app)/import/parse";
```

Then, inside `asyncChecks()`:

```ts
/* ---- punch #81: catalog import type maps a real vendor sheet ---- */
const catType = getTypeMeta("catalog");
ok(!!catType, "#81 a catalog import type is registered");
if (catType) {
  const vendorCsv = [
    "Part Number,Description,MSRP,Dealer Net,Manufacturer",
    "S4LED-S2,Source Four LED Series 2,1899.50,1139.70,ETC",
    ",Row with no SKU,10,5,ETC",
  ].join("\n");
  const vp = parseImportCsv(vendorCsv);
  ok(vp.ok, "#81 vendor CSV parses");
  const vmap = autoMap(vp.headers, catType.fields);
  ok(vmap.sku === 0, "#81 'Part Number' auto-maps to sku");
  ok(vmap.list === 2, "#81 'MSRP' auto-maps to list");
  ok(vmap.cost === 3, "#81 'Dealer Net' auto-maps to cost");
  ok(vmap.mfr === 4, "#81 'Manufacturer' auto-maps to mfr");

  const vprep = prepareRows(vp.rows, vmap, catType.fields);
  ok(vprep.stats.valid === 1, "#81 the row with no SKU is not importable");
  ok(vprep.stats.invalid === 1, "#81 …and is counted as needing attention");
  ok(Number(vprep.rows[0].values.list) === 1899.5, "#81 list price coerces to a number");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — `getTypeMeta("catalog")` returns undefined, so `#81 a catalog import type is registered` fails.

- [ ] **Step 3: Add the type definition**

In `src/app/(app)/import/types.ts`, append to the `IMPORT_TYPES` array. Alias lists are drawn from the header vocabulary `scripts/convert-dealer-sheets.py` already learned from 52 real vendor sheets — reuse that knowledge rather than guessing:

```ts
  {
    key: "catalog",
    label: "Catalog parts",
    mono: "CA",
    color: "#2f6f8f",
    blurb: "Vendor price lists — SKU, description, list and dealer cost.",
    dedupeLabel: "SKU",
    viewHref: "/catalog",
    viewLabel: "View in Catalog",
    fields: [
      { key: "sku", header: "SKU", label: "SKU", required: true, aliases: ["sku", "part number", "part no", "part #", "part", "model", "model number", "item number", "item code", "order code", "product code", "cat no"], example: "ETC:S4LED-S2" },
      { key: "desc", header: "Description", label: "Description", aliases: ["description", "desc", "product description", "item description", "item name", "product name", "name", "details"], example: "Source Four LED Series 2" },
      { key: "category", header: "Category", label: "Category", aliases: ["category", "family", "product family", "group", "series", "line", "type", "class"], example: "Lighting" },
      { key: "unit", header: "Unit", label: "Unit", aliases: ["unit", "uom", "u/m", "um"], example: "ea" },
      { key: "list", header: "List Price", label: "List price", kind: "number", aliases: ["list", "list price", "msrp", "retail", "srp", "suggested retail", "price"], example: "1899.50" },
      { key: "cost", header: "Cost", label: "Dealer cost", kind: "number", aliases: ["cost", "dealer", "dealer net", "dealer price", "dealer cost", "net", "net price", "wholesale", "our cost"], example: "1139.70" },
      { key: "mfr", header: "Manufacturer", label: "Manufacturer", aliases: ["mfr", "manufacturer", "brand", "mfg", "vendor", "make"], example: "ETC" },
    ],
  },
```

- [ ] **Step 4: Add the writer**

In `src/app/(app)/import/registry.ts`, add the store import beside the others:

```ts
import * as Catalog from "@/lib/stores/catalog";
```

and add to `WRITERS`:

```ts
  catalog: {
    count: async () => (await Catalog.list()).length,
    load: async () => (await Catalog.list()) as unknown as Record<string, unknown>[],
    find: (v, cache) => cache.find((p) => ci(p.sku, v.sku)) || null,
    create: async (v, cache) => {
      const sku = str(v.sku);
      // mergeUpsert is the same entry point scripts/import-catalog.ts uses —
      // it preserves fields a price sheet doesn't carry (ports, trade, spec
      // text, datasheet attachments) when a SKU is re-imported.
      await Catalog.mergeUpsert(sku, {
        desc: str(v.desc) || sku,
        category: str(v.category) || "Uncategorized",
        unit: str(v.unit) || "ea",
        list: num(v.list),
        cost: num(v.cost),
        mfr: str(v.mfr) || undefined,
      });
      cache.push({ id: sku, sku });
    },
    update: async (ex, v) => {
      const sku = str(ex.sku);
      await Catalog.mergeUpsert(sku, {
        desc: str(v.desc) || str(ex.desc),
        category: str(v.category) || str(ex.category),
        unit: str(v.unit) || str(ex.unit),
        list: num(v.list),
        cost: num(v.cost),
        mfr: str(v.mfr) || (ex.mfr as string | undefined),
      });
    },
    exportObjects: async () => {
      const list = await Catalog.list();
      return list.map((p) => ({
        sku: p.sku || "",
        desc: p.desc || "",
        category: p.category || "",
        unit: p.unit || "",
        list: p.list ?? 0,
        cost: p.cost ?? 0,
        mfr: p.mfr || "",
      }));
    },
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:specs`
Expected: PASS, including all ten new `#81` catalog assertions.

- [ ] **Step 6: Typecheck, lint, smoke**

Run: `npx tsc --noEmit && npx eslint && npm run test:smoke`
Expected: all exit 0. The smoke run covers `/import` and `/catalog`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/import/types.ts" "src/app/(app)/import/registry.ts" scripts/test-review-and-spec.ts
git commit -m "feat(import): add the catalog type and writer (punch #81)

Catalog parts become the hub's 9th importable type, deduped on SKU and
written through catalog.mergeUpsert — the same entry point the CLI importer
uses, so re-importing a price sheet re-prices in place without dropping
ports, trade or spec text.

Header aliases are lifted from convert-dealer-sheets.py's vocabulary, which
was derived from 52 real vendor sheets, rather than guessed."
```

---

## Task 6: Wire the file input into the paste flow

**Files:**
- Modify: `src/app/(app)/import/controls.tsx`

**Interfaces:**
- Consumes: `POST /api/import/xlsx` (Task 4); the `catalog` type key (Task 5).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add upload state**

In `PastePreview`, beside the existing `text`/`mode` state:

```ts
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [uploadNote, setUploadNote] = useState("");
```

- [ ] **Step 2: Add the upload handler**

Inside `PastePreview`, above the `return`:

```ts
  /* punch #81 — .xlsx upload. The file is converted to CSV server-side
     (exceljs is server-only; importing it here would drag Node stream
     internals into the client bundle and 500 the page, per #78) and the
     result lands in the same `text` state the textarea binds to, so preview,
     mapping and commit all run unchanged from here. */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file) return;
    setUploading(true);
    setUploadErr("");
    setUploadNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/xlsx", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; csv: string; rows: number; sheetName: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setUploadErr(data.error);
        return;
      }
      setText(data.csv);
      setUploadNote(
        `Read ${data.rows} row${data.rows === 1 ? "" : "s"} from “${data.sheetName}” in ${file.name}. Check the preview below before importing.`
      );
    } catch {
      setUploadErr("That upload didn’t go through. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }
```

- [ ] **Step 3: Render the control**

Immediately **above** the existing `<textarea name="text" …>`, insert:

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px", flexWrap: "wrap" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "7px 11px",
            fontSize: 12,
            cursor: uploading ? "default" : "pointer",
            background: uploading ? "#f4f5f7" : "#fff",
            color: uploading ? "#aab0bb" : "#16181d",
          }}
        >
          <input
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            disabled={uploading}
            style={{ display: "none" }}
          />
          {uploading ? "Reading…" : "Choose an Excel file"}
        </label>
        <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
          .xlsx — first sheet, header row required. Or paste below.
        </span>
      </div>

      {uploadNote && (
        <div style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 9, background: "#eef4f8", border: "1px solid #d5e3ec", fontSize: 12, color: "#2f6f8f" }}>
          {uploadNote}
        </div>
      )}
      {uploadErr && (
        <div style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 9, background: "#f9ece8", border: "1px solid #f0d6cd", fontSize: 12.5, color: "#a0442b" }}>
          {uploadErr}
        </div>
      )}
```

Match the file's existing inline-style idiom — this component styles inline throughout; do not introduce a stylesheet or a class-based approach for one control.

- [ ] **Step 4: Update the four stale copy/docblock strings**

The screen currently tells users Excel is not supported. In `src/app/(app)/import/page.tsx`:
- line ~70: `CSV · paste` → `CSV · Excel · paste`
- line ~676: `Open your CSV/Excel export, copy the rows, and paste below — same result.` → `Choose an Excel file, or copy rows from any spreadsheet and paste them below — same result.`

Also correct the now-inaccurate docblock in `controls.tsx` (it says drag-drop upload "is stubbed") and the one in `parse.ts` (it says the `.xlsx` branch was dropped because "real uploads feed the same paste path" — still true, but it should now say uploads are converted to CSV server-side first).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint`
Expected: both exit 0.

- [ ] **Step 6: Verify in the running app**

This is the step that catches what `tsc` and `test:specs` cannot — a client/server bundling break (#78's second escape class).

Run: `npm run test:smoke`
Expected: ALL PASSED. `/import` returning 500 here means `exceljs` reached the client bundle — check that nothing in `controls.tsx` imports `xlsx-to-csv` directly.

Then verify the actual upload path by hand, which no automated check in this repo covers:

```bash
npm run dev
```

Open `/import`, pick the **Catalog parts** type, choose a real `.xlsx` price sheet, and confirm: the CSV appears in the textarea, the preview stats show the expected row count, the column mapping resolves SKU/list/cost, and importing lands the parts in `/catalog`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/import/controls.tsx" "src/app/(app)/import/page.tsx" "src/app/(app)/import/parse.ts"
git commit -m "feat(import): .xlsx file picker on the paste screen (punch #81)

The file posts to /api/import/xlsx, which converts it server-side, and the
returned CSV lands in the same state the textarea binds to — so preview,
mapping, dedupe and commit are literally unchanged code paths.

Also corrects three copy/docblock strings that told users Excel wasn't
supported."
```

---

## Task 7: Update the punch list

**Files:**
- Modify: `PUNCHLIST.md`

- [ ] **Step 1: Update #79, #80, #81**

For each, change the header's `— OPEN` to `— DONE 2026-08-06` with a short outcome clause, and rewrite the `**Status:**` line to record what was actually built. Match the file's established voice — read #76, #77 and #78 first; those are the model. Each status must record:

- **#79** — 10 dynamic routes now covered; ids are seed constants (explain the PGlite single-writer reason runtime discovery was rejected); demo seed gained `GRD-5001` and consulting quote `Q-2045`; the Grid check also rejects the "no longer exists" body because that route answers 200 without mounting the editor; **PROVEN** by reintroducing the #76 illegal-export shape and watching it fail.
- **#80** — mark it **PARTIAL**, not DONE. Record three corrections to the original entry: (1) the real count was **11 unguarded call sites, not ~12 of ~14 store modules** — `import/registry.ts`'s mints were already covered by `commitImport`'s per-row try/catch; (2) only **6 of those 11 were guarded**, because the other 5 are void FormData actions with nowhere to return an error, and an `?err=` redirect no destination page renders would convert a loud crash into a silent no-op (#62's bug class); (3) `insertWithPrefixedId` still throws — only callers changed. Cross-reference the new entries below for the remainder.
- **#81** — new `catalog` type in the hub (9th type), deduped on SKU through `mergeUpsert`; `.xlsx` parsed server-side by `exceljs`; **record why `xlsx`/SheetJS was rejected** (abandoned on npm at 0.18.5, unpatched CVE-2023-30533) so nobody "upgrades" to it later; aliases lifted from `convert-dealer-sheets.py`'s 52-vendor vocabulary; explicitly NOT a replacement for that script.

- [ ] **Step 2: Log the three follow-ups this work surfaced**

Add them as new numbered entries (#84 is taken by the Estimator N+1 fix, so these are **#85**, **#86**, **#87**), following the file's existing entry format — Area, Reported, Finding, Why it matters, Open questions for Jeff, Ties to, Status:

- **#85 — five void FormData actions still crash on a mint failure.** `design/grid/actions.ts:19`, `field-work/actions.ts:38`, `projects/actions.ts:175`, `inspections/actions.ts:23`, `field-survey/actions.ts:18` all return `Promise<void>`, so #80's fix shape doesn't reach them. Closing this properly means adding `?err=` handling **and** the rendering on each destination page (grid list, field-work, project detail, inspections, field-survey) — roughly five pages of UI. Record explicitly why the half-fix was refused: an `err=` param no page renders is worse than the crash, because it looks like success. Open question for Jeff: worth the five pages for a failure that needs a genuine id collision to survive five retries? Ties to #80, #62.
- **#86 — mints inside page-load sync functions are unguarded and need a different fix shape.** `syncFromQuotes` (flame), `syncProjectsFromQuotes` and `syncEngagementsFromQuotes` call `insertWithPrefixedId` from code that runs during a page *render*, not from an action — a page cannot return a typed failure, so neither #80's fix nor #85's applies. Ties to #80, #74, #16.
- **#87 — the smoke test still can't exercise a real upload.** Verification of the `.xlsx` path is manual (Task 6, Step 6). The route smoke test only issues GETs, so `POST /api/import/xlsx` and the file-picker flow have no automated coverage. Ties to #78, #79, #81.

- [ ] **Step 3: Commit**

```bash
git add PUNCHLIST.md
git commit -m "docs: close #79 and #81, mark #80 partial; log #85, #86, #87

Corrects #80's scope twice over. The entry said ~14 store modules with 2
guarded; import/registry.ts was already covered by commitImport's per-row
try/catch, making the real number 11 call sites — and only 6 of those can
report a failure at all. The other 5 are void FormData actions whose fix
needs per-page error rendering (#85) rather than an err= param no page
reads, which would read as success."
```

- [ ] **Step 4: Final full verification**

```bash
npx tsc --noEmit && npx eslint && npm run test:specs && npm run test:smoke
```

Expected: all four exit 0, with the smoke run reporting 50 PASS lines (40 top-level + 10 dynamic).

- [ ] **Step 5: Push**

```bash
git push origin punch-60-67-defect-cluster
```

**Note for whoever runs this:** pushing this branch triggers a Vercel **Preview** build, and `DATABASE_URL` is scoped to both Production and Preview — so the Preview build runs `scripts/migrate.mjs` against the **real production database**. No task in this plan adds a migration, so this push is safe. Do not add one to this branch without resolving that first.
