# Box Goods Sale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Estimator system estimate can be flagged a **Box goods sale** (equipment + freight only): its customer PDF is the BOM view, its client link opens the itemized list, the Estimator hides the narrative/package machinery, and a save with any labor line is refused.

**Architecture:** One stored flag, `Quote.boxSale` (absent = false; stored only as `true` on a system estimate), read through one pure module, `src/lib/estimate-box-sale/rules.ts`. It is a content field and is frozen in a sent revision's `docFields`. The customer document follows from one seam: `quoteDocumentDataFor` returns `bomViewProps(props)` for a box sale (no second copy of the transform). The print route, the generator, the Cover PDF, the package page and the Estimator UI each read the flag to drop what a box sale doesn't get. Nothing narrative is ever deleted. Quotes are a JSONB doc table (`docTable("quotes")` in `src/db/doc-tables.ts`: `doc jsonb`), so there is **no migration**.

**Tech Stack:** TypeScript, Next.js 16 App Router (server components + server actions), React 19 client components, Drizzle doc-store on PGlite (dev/test) / Neon (prod), spec harness `scripts/test-review-and-spec.ts` (+ a new `scripts/test-box-sale.ts`) run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-21-box-goods-sale-design.md` (binding).

## Global Constraints

- **What's sold:** equipment and freight only. No labor, install, mobilization or travel.
- **Where it's set:** both a **Box goods sale** card on + New quote and a switch in the Estimator header. It can be turned on or off on any Estimator system estimate — `quoteType` absent or `"system"` only; the server drops it for any other quote type.
- **What the customer gets:** the BOM PDF plus the online BOM link. No Cover PDF, no narrative overview, no summary, goals or Not included. No datasheets or drawings.
- **Labor:** saving is refused while a box goods sale has any labor line. Nothing is deleted automatically. The message, verbatim: `A box goods sale can't include labor — remove the labor lines or turn off Box goods sale.`
- **2% estimator bonus:** kept, unchanged (`src/lib/estimate-bonus/` is not edited). The 5% package bonus already skips systems with no labor.
- **No new builder or quote type.** `quoteType` stays `"system"` and `source` stays `"estimator"`.
- **Nothing narrative is deleted.** Narrative text, key products, goals, cover text, the package document and the presentation settings stay stored; turning the switch off brings them all back.
- **A normal estimate prints byte-for-byte as before** (every new key/branch is conditional on the flag being `true`).
- **No migration** — `boxSale` is one optional key in the quote's JSONB `doc`.
- The email body, verbatim (box sale): `Attached is our quote … You can also view it online here: {link}` — no "full package" or alternates wording.

## Environment notes (every task)

- The **controller** sets the worktree up before Task 1: `npm ci --no-audit --no-fund`, `cp /Users/sm/Downloads/peak-app/next-env.d.ts .`, and a `.env.local` with a generated `AUTH_SECRET`, `AUTH_DEV_LOGIN=true`, `AUTH_TRUST_HOST=true`. Implementers don't repeat it.
- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/box-goods-sale`. Never touch `/Users/sm/Downloads/peak-app` itself.
- Prefix every command with `export PATH="$HOME/.local/node/bin:$PATH" &&`.
- **Never use `git stash`** (the stash is shared with other worktrees). Commit instead.
- `npm run test:specs` takes 5+ minutes — use a 600000 ms timeout and **never run two at once**. Before it, `ps aux | grep -c "[t]sx"` must print `0`.
- The fast loop is the new file on its own: `npx tsx scripts/test-box-sale.ts` (pure half, no DB). The DB half needs a **fresh temp datadir every time**: `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-box-sale.ts; rm -rf "$TEST_DB"`. Never run the DB half without `PGLITE_PATH` — it would open the real dev DB in `.data/`.
- Before `npm run test:smoke`: `rm -rf .next`, and make sure no `next dev` from this worktree is running (`ps aux | grep "[n]ext dev"`, `lsof -i :3000`).
- eslint: lint the changed source files only. Skip `scripts/test-review-and-spec.ts` (its known eslint stack overflow is #357).

## File structure

| File | Responsibility |
|---|---|
| `src/lib/estimate-box-sale/rules.ts` (new) | Pure, client-safe: the quote-type rule, `boxSaleOf` / `revisionBoxSale` / `boxSaleForSave`, the labor predicate, the refusal sentence and banner, copy, new-system presentation |
| `src/lib/stores/quotes.ts` | `Quote.boxSale`, content key, revision docFields, buildQuote / update() handling |
| `src/lib/quote-share/view.ts` | `quoteAsOfRevision` reads the revision's own flag |
| `src/lib/quote-pdf/quote-document-data.ts` | The one document seam: `bomViewProps` for a box sale |
| `src/app/(app)/estimator/{actions,page,types}.ts(x)` | Save carries + refuses; load; Move/Copy → New carries |
| `src/app/print/quote/[id]/page.tsx`, `src/lib/quote-pdf/generate.ts`, Cover files, `send-server.ts` | BOM layout, no appendices, no cover |
| Estimator UI (`use-estimator-state.ts`, `pdf-doc-key.ts`, header, section card, Build step, More menu) | Switch, chip, hidden controls, Itemized new systems, banner, client refusal |
| Build package / Customer review / readiness | BOM quote tab only + people fields; Document + BOM; quiet badges and gaps |
| Send & track, email copy, package page, share routes | No cover, box wording, itemized-only page, no downloads |
| `src/app/(app)/quotes/new/*`, `src/lib/gmail/linking.ts` | The + New quote card and its hand-off |
| `scripts/test-box-sale.ts` (new) | The feature's harness checks (pure + DB), wired into `npm run test:specs` |

---

### Task 1: Data, labor rule and the document seam

**Files:**
- Create: `src/lib/estimate-box-sale/rules.ts`
- Create: `scripts/test-box-sale.ts`
- Modify: `src/lib/stores/quotes.ts` (Quote type ~:408, `QUOTE_CONTENT_FIELDS` ~:483, `quoteContentKey` ~:514, `QuoteRevisionDocFields` ~:534, `buildQuote` ~:882, `update` ~:969, `revisionDocFields` ~:1062)
- Modify: `src/lib/quote-share/view.ts:117-131` (`quoteAsOfRevision`)
- Modify: `src/lib/quote-pdf/quote-document-data.ts:70-149`
- Modify: `src/app/(app)/estimator/actions.ts` (`SavePayload` ~:160, `saveQuoteAction` ~:418-546, `placeSystemInEstimate` ~:1028)
- Modify: `src/app/(app)/estimator/types.ts:576-649` (`InitialQuote`)
- Modify: `src/app/(app)/estimator/page.tsx` (`initialFrom` ~:124-262)
- Modify: `scripts/test-review-and-spec.ts` (import ~:11355, chain ~:11776)

**Interfaces:**
- Consumes: `isBonusItem` (`@/lib/estimate-bonus/flags`), `bomViewProps` (`@/app/(app)/estimator/quote-document-view`) — both existing.
- Produces (in `@/lib/estimate-box-sale/rules`):
  - `BOX_SALE_LABOR_MESSAGE: string`
  - `isBoxSaleQuoteType(quoteType: string | null | undefined): boolean`
  - `boxSaleOf(q: { boxSale?: unknown; quoteType?: string | null } | null | undefined): boolean`
  - `revisionBoxSale(rev: { docFields?: { boxSale?: unknown } | null } | null | undefined): boolean`
  - `boxSaleForSave(prior: { boxSale?: unknown; quoteType?: string | null } | null | undefined, posted: unknown): boolean`
  - `lineIsLabor(it): boolean`, `systemHasLabor(sec): boolean`
  - `boxSaleLaborSystems(sections): string[]`
  - `boxSaleSaveProblem(boxSale: boolean, sections): string | null`
- Produces elsewhere: `Quote.boxSale?: boolean`; `QuoteRevisionDocFields.boxSale?: boolean`; `SavePayload.boxSale?: boolean`; `InitialQuote.boxSale: boolean`.
- Produces (test file): `boxSalePureChecks(ok: Ok): Promise<void>`, `boxSaleDbChecks(ok: Ok): Promise<void>`, `quoteFixture(extra?)`, `line()`, `sys()`, `DOC`, `SET`, `FIX`, `rd()`. Later tasks add check functions to this file at the marker comments.

- [ ] **Step 1: Create the harness file with the Task 1 checks**

Create `scripts/test-box-sale.ts`:

```ts
/* Box goods sale (docs/superpowers/specs/2026-10-21-box-goods-sale-design.md) — harness checks.
   `boxSalePureChecks` needs no database; `boxSaleDbChecks` needs the test DB (test:specs runs both).
   Pure half alone: `npx tsx scripts/test-box-sale.ts`.
   Both halves: `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-box-sale.ts; rm -rf "$TEST_DB"`
   (never without PGLITE_PATH pointing at a fresh temp dir — the DB half writes quotes). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import {
  BOX_SALE_LABOR_MESSAGE,
  boxSaleForSave,
  boxSaleLaborSystems,
  boxSaleOf,
  boxSaleSaveProblem,
  isBoxSaleQuoteType,
  lineIsLabor,
  revisionBoxSale,
  systemHasLabor,
} from "../src/lib/estimate-box-sale/rules";
import { buildQuote, quoteContentKey, QUOTE_CONTENT_FIELDS, revisionDocFields, type Quote, type QuoteRevision } from "../src/lib/stores/quotes";
import { quoteAsOfRevision } from "../src/lib/quote-share/view";
import { quoteDocumentDataFor } from "../src/lib/quote-pdf/quote-document-data";
import { bomViewProps } from "../src/app/(app)/estimator/quote-document-view";
// (later tasks: imports above this line)

export const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
export const FIX = "box";
export const SET = { companyName: "Peak", logoDark: null };

type Line = Record<string, unknown>;
export const line = (id: number, extra: Line = {}): Line => ({ id, sku: "SKU-" + id, desc: "Part " + id, qty: 2, unit: "ea", cost: 50, price: 100, ...extra });
export const sys = (id: string, name: string, items: Line[], extra: Record<string, unknown> = {}) => ({ id, name, kind: "materials", mfr: "", freightPct: 0, items, ...extra });
export const DOC = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Our approach." }] }] };

/** A saved system estimate: a Narrative system with an intro, an Itemized one, a package document, sectioned + appendix on, Qty off. */
export function quoteFixture(extra: Record<string, unknown> = {}): Quote {
  return {
    id: "Q-box", name: "Gym", customer: "Walk-in", customerId: null, locationId: null, owner: "Sam Mills", status: "draft",
    source: "estimator", quoteType: "system", value: 400, margin: 0.5, createdAt: 5, updatedAt: 5, history: [], review: { state: "none" },
    pdfOptions: { detail: "sectioned", pdfQty: false, pdfNotes: false, pdfPrices: true, pdfItemizedAppendix: true },
    spec: { sections: [sys("s1", "Rigging", [line(1)], { presentation: "narrative", narrative: "Intro." }), sys("s2", "Lighting", [line(2)], { presentation: "itemized" })], mobs: [], document: DOC },
    ...extra,
  } as unknown as Quote;
}

function dataChecks(ok: Ok) {
  ok(isBoxSaleQuoteType(undefined) && isBoxSaleQuoteType(null) && isBoxSaleQuoteType("") && isBoxSaleQuoteType("system") && !isBoxSaleQuoteType("flame_test") && !isBoxSaleQuoteType("consulting"),
    "box sale: only an Estimator system estimate (quoteType absent or \"system\") can be one");
  ok(boxSaleOf({ boxSale: true }) && boxSaleOf({ boxSale: true, quoteType: "system" }) && !boxSaleOf({ boxSale: true, quoteType: "repair" }) && !boxSaleOf({ boxSale: "true" }) && !boxSaleOf({}) && !boxSaleOf(null),
    "box sale: boxSaleOf is a stored true on a system estimate; anything else reads false");
  ok(boxSaleForSave(null, true) && !boxSaleForSave(null, false) && !boxSaleForSave(null, undefined) && boxSaleForSave({ boxSale: true }, undefined) && !boxSaleForSave({ boxSale: true }, false) && !boxSaleForSave({ quoteType: "inspection" }, true),
    "box sale: a save stores what it posts, an older caller (no field) keeps the stored flag, a service quote never gets one");
  ok(lineIsLabor({ labor: true }) && lineIsLabor({ laborOverhead: "shop" }) && lineIsLabor({ laborTravel: "hotel" }) && !lineIsLabor({}) && !lineIsLabor({ labor: false }) && !lineIsLabor(null),
    "box sale labor: labor, laborOverhead or laborTravel set is labor (mobilization / travel included)");
  ok(!lineIsLabor({ bonus: "estimator" }) && !lineIsLabor({ bonus: "package", labor: true }),
    "box sale labor: the automatic bonus lines are never labor (the 2% estimator bonus stays)");
  ok(systemHasLabor({ kind: "labor", items: [] }) && systemHasLabor({ kind: "materials", items: [line(1), line(2, { labor: true })] as never }) && !systemHasLabor({ kind: "materials", items: [line(1)] as never }) && !systemHasLabor(null),
    "box sale labor: a kind \"labor\" system, or any labor line, makes a system labor");
  const secs = [sys("a", "Rigging", [line(1)]), sys("b", "Install", [line(2, { labor: true })]), sys("c", "  ", [line(3, { laborTravel: "mileage" })]), { ...sys("d", "Crew", []), kind: "labor" }, sys("e", "Freight only", [line(5, { bonus: "estimator" })])];
  ok(JSON.stringify(boxSaleLaborSystems(secs as never)) === JSON.stringify(["Install", "Untitled system", "Crew"]) && boxSaleLaborSystems(null).length === 0 && boxSaleLaborSystems("junk" as never).length === 0,
    "box sale labor: the systems with labor are named in order (blank → \"Untitled system\"); junk reads as none");
  ok(BOX_SALE_LABOR_MESSAGE === "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale.", "box sale labor: the refusal sentence, verbatim");
  ok(boxSaleSaveProblem(true, secs as never) === BOX_SALE_LABOR_MESSAGE && boxSaleSaveProblem(false, secs as never) === null && boxSaleSaveProblem(true, [sys("a", "Rigging", [line(1)])] as never) === null,
    "box sale labor: a box sale with labor is refused; without labor, or not a box sale, it saves");

  ok((QUOTE_CONTENT_FIELDS as readonly string[]).includes("boxSale"), "box sale store: boxSale is a content field (a toggle stales the PDF)");
  const plain = quoteFixture();
  ok(quoteContentKey(plain) !== quoteContentKey({ ...plain, boxSale: true }) && quoteContentKey(plain) === quoteContentKey({ ...plain, boxSale: false } as never),
    "box sale store: the content key changes with the flag; false and absent are the same document");
  ok(buildQuote("Q-x", { boxSale: true }, "system", null, 1).boxSale === true && !("boxSale" in buildQuote("Q-x", {}, "system", null, 1)) &&
     !("boxSale" in buildQuote("Q-x", { boxSale: true }, "flame_test", null, 1)) && !("boxSale" in buildQuote("Q-x", { boxSale: false }, "system", null, 1)),
    "box sale store: buildQuote keeps the flag only as true on a system quote");
  ok(revisionDocFields(quoteFixture({ boxSale: true })).boxSale === true && !("boxSale" in revisionDocFields(plain)),
    "box sale store: a revision freezes the flag; a normal estimate's docFields are byte-identical (no key)");
  const rev = (docFields: unknown) => ({ rev: 1, at: 10, by: "spec", reason: "sent", note: "", name: "Gym", value: 400, margin: 0.5, status: "sent", spec: plain.spec, docFields }) as unknown as QuoteRevision;
  const liveBox = quoteFixture({ boxSale: true, status: "sent" });
  const oldRev = rev({ ...revisionDocFields(plain) });
  const boxRev = rev(revisionDocFields(liveBox));
  ok(!("boxSale" in quoteAsOfRevision({ ...liveBox, revisions: [oldRev] } as Quote, oldRev)), "box sale revision: a revision cut without the flag reads false, even when the live quote has it");
  ok(quoteAsOfRevision({ ...plain, revisions: [boxRev] } as Quote, boxRev).boxSale === true, "box sale revision: a box-sale revision stays one after the live switch is turned off");
  ok(!("boxSale" in quoteAsOfRevision({ ...plain, revisions: [oldRev] } as Quote, oldRev)), "box sale revision: a normal estimate's as-sent quote has no key");
  ok(revisionBoxSale(boxRev) && !revisionBoxSale(oldRev) && !revisionBoxSale(null) && !revisionBoxSale({ docFields: null }), "box sale revision: revisionBoxSale reads the frozen flag only");
}

function documentChecks(ok: Ok) {
  const dPlain = quoteDocumentDataFor(quoteFixture(), null, SET);
  const boxQ = quoteFixture({ boxSale: true });
  const dBox = quoteDocumentDataFor(boxQ, null, SET);
  ok(dPlain.document !== null && dPlain.detail === "sectioned" && dPlain.pdfItemizedAppendix === true && dPlain.pdfNotes === false && dPlain.sections[0].presentation === "narrative",
    "box sale document: a normal estimate's document data is unchanged (package document, sectioned, appendix, its own Notes choice, a Narrative system)");
  ok(dBox.document === null && dBox.detail === "itemized" && dBox.pdfItemizedAppendix === false && dBox.pdfNotes === true && dBox.sections.every((s) => s.presentation === "itemized"),
    "box sale document: a box sale is the BOM view — no package document, itemized, notes on, no appendix, every system itemized");
  ok(dBox.pdfQty === false && dBox.pdfPrices === true, "box sale document: Qty and prices follow the quote's own PDF choices (bomViewProps's rule)");
  ok(JSON.stringify(dBox) === JSON.stringify(bomViewProps(dPlain)), "box sale document: the transform IS bomViewProps — one implementation");
  ok(JSON.stringify(quoteDocumentDataFor(quoteFixture({ boxSale: true, quoteType: "flame_test" }), null, SET)) === JSON.stringify(quoteDocumentDataFor(quoteFixture({ quoteType: "flame_test" }), null, SET)),
    "box sale document: a stray flag on a service quote changes nothing");
  const stored = boxQ.spec as { sections: Array<{ presentation?: string; narrative?: string }>; document: unknown };
  ok(stored.sections[0].presentation === "narrative" && stored.sections[0].narrative === "Intro." && stored.document === DOC,
    "box sale document: the stored narrative, presentation and package document are untouched (nothing is deleted)");
  const qdd = rd("src/lib/quote-pdf/quote-document-data.ts");
  ok(qdd.includes('import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";') && qdd.includes("return boxSaleOf(q) ? bomViewProps(props) : props;"),
    "box sale document (source): quoteDocumentDataFor applies bomViewProps once, at the one seam");
}

function wiringChecks(ok: Ok) {
  const act = rd("src/app/(app)/estimator/actions.ts");
  const save = act.slice(act.indexOf("export async function saveQuoteAction("), act.indexOf("async function settleRewardCredit("));
  const at = save.indexOf("const boxProblem = boxSaleSaveProblem(boxSale, Array.isArray(payload.sections) ? payload.sections : []);");
  ok(save.includes("const boxSale = boxSaleForSave(prior, payload.boxSale);") && at > save.indexOf("if (!docSave.ok) {") && at < save.indexOf("settleRewardCredit(") && at < save.indexOf("await update(") && at < save.indexOf("await create("),
    "box sale save (source): the labor refusal runs after the document check and before the Rewards credit or any write");
  ok(/if \(boxProblem\) \{\s*return \{\s*ok: false,\s*id: null,\s*number: null,/.test(save) && save.includes("error: boxProblem,"),
    "box sale save (source): a refusal returns no id — nothing is written and the edit stays unsaved");
  ok(/\n\s+boxSale,\n/.test(save.slice(save.indexOf("const patch: QuotePatch = {"), save.indexOf("patch.spec = await quoteSpecFollowingRenames"))),
    "box sale save (source): the patch carries the flag (create and update alike)");
  ok(/boxSale\?: boolean;/.test(act.slice(act.indexOf("export type SavePayload"), act.indexOf("export type SaveResult"))), "box sale save (source): SavePayload carries an optional boxSale");
  const place = act.slice(act.indexOf("async function placeSystemInEstimate("), act.indexOf("export type CopySystemTarget"));
  const carry = place.indexOf("...(boxSaleOf(sourceQuote) ? { boxSale: true } : {}),");
  ok(carry > place.indexOf("created = await create({") && carry < place.indexOf("}, { bidScopeOnly: scopeOnly.stamp });"),
    "box sale move/copy (source): Move / Copy system → New estimate creates the estimate with the STORED source's flag");
  ok(!place.slice(0, place.indexOf("// Estimator bonuses: the new draft estimate")).includes("boxSale"),
    "box sale move/copy (source): Move / Copy into an existing estimate leaves the target's flag alone");
  const page = rd("src/app/(app)/estimator/page.tsx");
  ok(page.includes("    boxSale: boxSaleOf(q),\n") && page.includes("      boxSale: false,\n") && /\n  boxSale: boolean;\n/.test(rd("src/app/(app)/estimator/types.ts")),
    "box sale load (source): initialFrom hands the Estimator the stored flag (false for a new estimate)");
}

async function storeDbChecks(ok: Ok) {
  const Q = await import("../src/lib/stores/quotes");
  const ID = fixtureId(FIX, "store"), SVC = fixtureId(FIX, "service");
  const base = { customer: "Spec fixture", owner: "spec", source: "estimator", spec: { sections: [], mobs: [] } };
  try {
    await Q.create({ ...base, id: ID, name: "Box store", quoteType: "system", boxSale: true } as never);
    registerFixture("quotes", ID);
    ok((await Q.get(ID))?.boxSale === true, "box sale store (DB): a new system estimate stores the flag");
    await Q.update(ID, { name: "Box store renamed" });
    const kept = (await Q.get(ID))!;
    ok(kept.boxSale === true, "box sale store (DB): a patch without boxSale leaves it alone");
    await new Promise((r) => setTimeout(r, 5));
    await Q.update(ID, { boxSale: false });
    const off = (await Q.get(ID))!;
    ok(!("boxSale" in off), "box sale store (DB): turning it off removes the key (a normal estimate's doc again)");
    ok((off.contentChangedAt ?? 0) > (kept.contentChangedAt ?? 0), "box sale store (DB): a toggle stamps contentChangedAt — the stored PDF goes stale");
    await Q.update(ID, { boxSale: true });
    ok((await Q.get(ID))?.boxSale === true, "box sale store (DB): turning it back on stores it again");
    await Q.create({ ...base, id: SVC, name: "Flame", quoteType: "flame_test", boxSale: true } as never);
    registerFixture("quotes", SVC);
    ok(!("boxSale" in (await Q.get(SVC))!), "box sale store (DB): create drops the flag on a service quote");
    await Q.update(SVC, { boxSale: true });
    ok(!("boxSale" in (await Q.get(SVC))!), "box sale store (DB): update drops it on a service quote too");
  } finally {
    await dropFixtures(FIX);
  }
}

// (later tasks: check functions above this line)

export async function boxSalePureChecks(ok: Ok) {
  dataChecks(ok);
  documentChecks(ok);
  wiringChecks(ok);
  // (later tasks: pure checks above this line)
}

export async function boxSaleDbChecks(ok: Ok) {
  await storeDbChecks(ok);
  // (later tasks: DB checks above this line)
}

if (process.argv[1]?.endsWith("test-box-sale.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  boxSalePureChecks(okf)
    .then(() => (db ? boxSaleDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Wire it into the spec harness**

In `scripts/test-review-and-spec.ts`, replace

```ts
import { lineMoveChecks } from "./test-estimate-line-move";
```

with

```ts
import { lineMoveChecks } from "./test-estimate-line-move";
import { boxSaleDbChecks, boxSalePureChecks } from "./test-box-sale";
```

and replace

```ts
  .then(() => lineMoveChecks(ok))
  .finally(() => teardownFixtures())
```

with

```ts
  .then(() => lineMoveChecks(ok))
  .then(() => boxSalePureChecks(ok)).then(() => boxSaleDbChecks(ok))
  .finally(() => teardownFixtures())
```

- [ ] **Step 3: Run it and watch it fail**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: FAIL — the run dies with `Cannot find module '../src/lib/estimate-box-sale/rules'` (exit 1).

- [ ] **Step 4: Create `src/lib/estimate-box-sale/rules.ts`**

```ts
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isBonusItem } from "@/lib/estimate-bonus/flags";

/**
 * Box goods sale (spec docs/superpowers/specs/2026-10-21-box-goods-sale-design.md): an Estimator system estimate
 * that sells equipment + freight only. The customer gets the itemized BOM — the estimate PDF is the BOM view and the
 * client link opens the itemized list. `Quote.boxSale` is the one stored flag (absent = false). Nothing narrative is
 * ever deleted, so turning it off brings everything back. Pure and client-safe: type-only imports plus the
 * import-free bonus flags.
 */

/** The server's save refusal, the browser's own refusal and the Build banner's first sentence — verbatim (spec). */
export const BOX_SALE_LABOR_MESSAGE = "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale.";

type FlagQuote = { boxSale?: unknown; quoteType?: string | null } | null | undefined;

/** Only an Estimator system estimate (quoteType absent or "system") can be a box goods sale. */
export function isBoxSaleQuoteType(quoteType: string | null | undefined): boolean {
  return !quoteType || quoteType === "system";
}

/** The live quote's flag: a stored `true` on a system estimate; anything else reads false. */
export function boxSaleOf(q: FlagQuote): boolean {
  return !!q && q.boxSale === true && isBoxSaleQuoteType(q.quoteType);
}

/** A sent revision's frozen flag (docFields.boxSale). A revision cut before the field existed reads false.
 *  quoteAsOfRevision (src/lib/quote-share/view.ts) applies the same rule inline — that file may import no other module. */
export function revisionBoxSale(rev: { docFields?: { boxSale?: unknown } | null } | null | undefined): boolean {
  return rev?.docFields?.boxSale === true;
}

/** What an Estimator Save stores: `posted` on a system estimate; an older caller that omits it keeps the stored
 *  flag; any other quote type never has one. */
export function boxSaleForSave(prior: FlagQuote, posted: unknown): boolean {
  if (!isBoxSaleQuoteType(prior?.quoteType)) return false;
  return posted === undefined ? prior?.boxSale === true : posted === true;
}

type LaborFlags = Pick<SpecItem, "labor" | "laborOverhead" | "laborTravel" | "bonus">;

/** Labor = `labor`, `laborOverhead` or `laborTravel` set (mobilization and travel lines count). The automatic
 *  bonus lines never count: the 2% estimator bonus stays on a box sale, and the server re-derives the 5% package
 *  bonus from the remaining lines (it exists only while the system has labor). */
export function lineIsLabor(it: LaborFlags | null | undefined): boolean {
  if (!it || isBonusItem(it)) return false;
  return it.labor === true || !!it.laborOverhead || !!it.laborTravel;
}

/** A system with labor: a `kind: "labor"` system, or any labor line. */
export function systemHasLabor(sec: Pick<SpecSection, "kind" | "items"> | null | undefined): boolean {
  if (!sec) return false;
  return sec.kind === "labor" || (Array.isArray(sec.items) ? sec.items : []).some((it) => lineIsLabor(it));
}

/** The names of the systems with labor, in order ("Untitled system" when blank). Junk reads as none. */
export function boxSaleLaborSystems(sections: ReadonlyArray<Pick<SpecSection, "name" | "kind" | "items">> | null | undefined): string[] {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => systemHasLabor(s))
    .map((s) => (typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Untitled system"));
}

/** The save refusal for a box sale with labor, else null. */
export function boxSaleSaveProblem(boxSale: boolean, sections: ReadonlyArray<Pick<SpecSection, "name" | "kind" | "items">> | null | undefined): string | null {
  return boxSale && boxSaleLaborSystems(sections).length > 0 ? BOX_SALE_LABOR_MESSAGE : null;
}
```

- [ ] **Step 5: Add `Quote.boxSale` to the store**

In `src/lib/stores/quotes.ts`:

(a) After the import `import { withoutEstimateFields } from "@/lib/estimate-number";` add:

```ts
import { isBoxSaleQuoteType } from "@/lib/estimate-box-sale/rules";
```

(b) In `export type Quote`, replace

```ts
  bidScopeOnly?: true;
```

with

```ts
  bidScopeOnly?: true;
  /** Box goods sale (spec 2026-10-21) — an Estimator system estimate that sells equipment + freight only: the
   *  customer document is the BOM view and the client link the itemized list. Absent = false; stored only as `true`
   *  (buildQuote / update() drop it on any other quote type, and update() removes it on false). Content
   *  (QUOTE_CONTENT_FIELDS — a toggle stales the PDF) and frozen in a sent revision's docFields. Nothing narrative is
   *  ever deleted for it. Read through boxSaleOf (src/lib/estimate-box-sale/rules.ts). */
  boxSale?: boolean;
```

(c) Replace

```ts
  // #348 2b-i: prints as Prepared for (awarded bidder) and the bid line.
  "bid",
] as const;
```

with

```ts
  // #348 2b-i: prints as Prepared for (awarded bidder) and the bid line.
  "bid",
  // Box goods sale (spec 2026-10-21): the whole customer document switches to the BOM view.
  "boxSale",
] as const;
```

(d) In `quoteContentKey`, replace

```ts
        return bid?.awardedPartyId ? bid : null;
      }
      return rec[k] ?? null;
```

with

```ts
        return bid?.awardedPartyId ? bid : null;
      }
      // Box goods sale: only a stored true counts — false and absent are the same document.
      if (k === "boxSale") return rec.boxSale === true ? true : null;
      return rec[k] ?? null;
```

(e) In `QuoteRevisionDocFields`, replace

```ts
  bid?: QuoteBid;
```

with

```ts
  bid?: QuoteBid;
  /** Box goods sale (spec 2026-10-21) — present (true) only when the live quote was one; absent = a normal
   *  estimate, and on every revision cut before the field existed. quoteAsOfRevision reads it, never the live flag. */
  boxSale?: boolean;
```

(f) In `buildQuote`, replace

```ts
    ...(Array.isArray(partial.findingKeys) && partial.findingKeys.length ? { findingKeys: partial.findingKeys } : {}),
  };
```

with

```ts
    ...(Array.isArray(partial.findingKeys) && partial.findingKeys.length ? { findingKeys: partial.findingKeys } : {}),
    // Box goods sale: only a true on a system quote — every other creator writes the doc it wrote before.
    ...(partial.boxSale === true && isBoxSaleQuoteType(quoteType) ? { boxSale: true } : {}),
  };
```

(g) In `update`, replace

```ts
    delete clean.assistNudgeLeaseUntil;
    Object.assign(q, clean, { updatedAt: Date.now() });
```

with

```ts
    delete clean.assistNudgeLeaseUntil;
    // Box goods sale: stored only as true on a system quote; false (or any other type) removes the key, so turning
    // it off leaves exactly a normal estimate's doc. A patch without the key leaves it alone.
    if ("boxSale" in clean) {
      const on = clean.boxSale === true && isBoxSaleQuoteType(clean.quoteType ?? q.quoteType);
      delete clean.boxSale;
      if (on) q.boxSale = true;
      else delete q.boxSale;
    }
    Object.assign(q, clean, { updatedAt: Date.now() });
```

(h) In `revisionDocFields`, replace

```ts
    ...(d.bid ? { bid: { ...d.bid, addenda: [...(d.bid.addenda || [])] } } : {}),
  };
```

with

```ts
    ...(d.bid ? { bid: { ...d.bid, addenda: [...(d.bid.addenda || [])] } } : {}),
    // Box goods sale: only when on — a normal estimate's revision is byte-identical.
    ...(d.boxSale === true ? { boxSale: true } : {}),
  };
```

- [ ] **Step 6: `quoteAsOfRevision` reads the revision's own flag**

In `src/lib/quote-share/view.ts`, replace

```ts
  return {
    ...q,
    ...headerFields(rev.docFields),
    name: rev.name,
    spec: rev.spec ?? null,
    vendorQuotes: rev.vendorQuotes ?? null,
    value: rev.value,
    updatedAt: issuedAt,
    revisions: revs.slice(0, revNo),
    // Jeff 2026-10-15 #13: documentRevStamp prints exactly this revision's Rev.
    docRevNo: revNo,
    shareLink: null,
  } as unknown as Quote;
}
```

with

```ts
  const asOf: Record<string, unknown> = {
    ...q,
    ...headerFields(rev.docFields),
    name: rev.name,
    spec: rev.spec ?? null,
    vendorQuotes: rev.vendorQuotes ?? null,
    value: rev.value,
    updatedAt: issuedAt,
    revisions: revs.slice(0, revNo),
    // Jeff 2026-10-15 #13: documentRevStamp prints exactly this revision's Rev.
    docRevNo: revNo,
    shareLink: null,
  };
  // Box goods sale (spec 2026-10-21): the revision's frozen flag, never the live one — a revision cut before the
  // field existed reads false. Same rule as estimate-box-sale/rules.ts revisionBoxSale (this file imports only state
  // + estimate-number, #293t).
  if (rev.docFields?.boxSale === true) asOf.boxSale = true;
  else delete asOf.boxSale;
  return asOf as unknown as Quote;
}
```

- [ ] **Step 7: The one document seam**

In `src/lib/quote-pdf/quote-document-data.ts`:

(a) After `import { addressedHeader, type DocAddressee } from "@/lib/parties/addressee";` add:

```ts
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
  return {
    // #223 — the document prints the estimate number (the id when unnumbered).
```

with

```ts
  const props: QuoteDocumentProps = {
    // #223 — the document prints the estimate number (the id when unnumbered).
```

(c) Replace

```ts
    isPortalCatalog: q.source === "portal-catalog",
    ...portalDocumentExtras(q, sections),
  };
}
```

with

```ts
    isPortalCatalog: q.source === "portal-catalog",
    ...portalDocumentExtras(q, sections),
  };
  // Box goods sale (spec 2026-10-21): the customer document IS the BOM view — the one transform (bomViewProps), so
  // the print route, portal, share pages and staff preview all follow. `q` is the frozen revision when one is passed.
  return boxSaleOf(q) ? bomViewProps(props) : props;
}
```

- [ ] **Step 8: Save carries and refuses; Move/Copy → New carries**

In `src/app/(app)/estimator/actions.ts`:

(a) After `import { leadIdForCreate, linkSavedQuoteToSuggestion } from "@/lib/assist/suggestion-save";` add:

```ts
import { boxSaleForSave, boxSaleOf, boxSaleSaveProblem } from "@/lib/estimate-box-sale/rules";
```

(b) In `SavePayload`, replace

```ts
  /** The `ES-…` suggestion the estimate was opened from: every successful
   *  save links the saved quote to it (idempotent; unknown ids ignored). */
  suggestionId?: string;
};
```

with

```ts
  /** The `ES-…` suggestion the estimate was opened from: every successful
   *  save links the saved quote to it (idempotent; unknown ids ignored). */
  suggestionId?: string;
  /** Box goods sale (spec 2026-10-21) — absent (an older caller) keeps the stored flag; dropped on any
   *  non-system quote (boxSaleForSave). A box sale with any labor line refuses the whole save. */
  boxSale?: boolean;
};
```

(c) In `saveQuoteAction`, replace

```ts
      error: docSave.error,
    };
  }
```

with

```ts
      error: docSave.error,
    };
  }
  // Box goods sale (spec 2026-10-21): equipment + freight only — any labor line refuses the WHOLE save before
  // anything is written (the document refusal's shape: no id, so the edit stays visibly unsaved).
  const boxSale = boxSaleForSave(prior, payload.boxSale);
  const boxProblem = boxSaleSaveProblem(boxSale, Array.isArray(payload.sections) ? payload.sections : []);
  if (boxProblem) {
    return {
      ok: false,
      id: null,
      number: null,
      revNum: documentRevStamp(prior ?? {}).revNum,
      updatedAt: prior?.updatedAt ?? Date.now(),
      review: prior?.review ?? null,
      status: prior?.status ?? null,
      pipelineId: prior?.pipelineId ?? null,
      stage: prior?.stage ?? null,
      error: boxProblem,
    };
  }
```

(d) In the `patch` object, replace

```ts
    spec: { sections: normalizeSystemOrder(savedSections, groups), mobs: payload.mobs, groups, ...(docSave.document ? { document: docSave.document } : {}) },
    pdfOptions: normalizePdfOptions(payload.pdfOptions),
```

with

```ts
    spec: { sections: normalizeSystemOrder(savedSections, groups), mobs: payload.mobs, groups, ...(docSave.document ? { document: docSave.document } : {}) },
    pdfOptions: normalizePdfOptions(payload.pdfOptions),
    // Box goods sale: content (QUOTE_CONTENT_FIELDS); create keeps it via buildQuote, update() stores only true.
    boxSale,
```

(e) In `placeSystemInEstimate`'s new-estimate branch, replace

```ts
      owner: opts.owner,
      ...(opts.tier ? { pricingTier: opts.tier.pricingTier, tierMargin: opts.tier.tierMargin } : {}),
    }, { bidScopeOnly: scopeOnly.stamp });
```

with

```ts
      owner: opts.owner,
      ...(opts.tier ? { pricingTier: opts.tier.pricingTier, tierMargin: opts.tier.tierMargin } : {}),
      // Box goods sale (spec 2026-10-21): Move / Copy → New estimate copies the STORED source's flag (an unsaved
      // source has none). The labor rule applies at the new estimate's next save.
      ...(boxSaleOf(sourceQuote) ? { boxSale: true } : {}),
    }, { bidScopeOnly: scopeOnly.stamp });
```

- [ ] **Step 9: Load the flag into the Estimator**

In `src/app/(app)/estimator/types.ts`, replace

```ts
  leadId: string | null;
};
```

with

```ts
  leadId: string | null;
  /** Box goods sale (spec 2026-10-21) — the stored flag (boxSaleOf); false for a new estimate unless the
   *  + New quote card opened it (?box=1). Rides every Save. */
  boxSale: boolean;
};
```

In `src/app/(app)/estimator/page.tsx`:

(a) After `import { sourceForSave } from "@/lib/portal-quote-mode";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
      leadId: null,
    };
  }
```

with

```ts
      leadId: null,
      boxSale: false,
    };
  }
```

(c) Replace

```ts
    leadId: q.leadId || null,
```

with

```ts
    leadId: q.leadId || null,
    // Box goods sale (spec 2026-10-21): the stored flag (a non-system quote reads false).
    boxSale: boxSaleOf(q),
```

- [ ] **Step 10: Run the new checks**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: `31 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

Run: `export PATH="$HOME/.local/node/bin:$PATH" && TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-box-sale.ts; rm -rf "$TEST_DB"`
Expected: `38 PASS, 0 FAIL`

- [ ] **Step 11: Type-check, lint, full harness**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | head -20
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint src/lib/estimate-box-sale/rules.ts src/lib/stores/quotes.ts src/lib/quote-share/view.ts src/lib/quote-pdf/quote-document-data.ts "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx"
ps aux | grep -c "[t]sx"
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -E "^FAIL" "$OUT" | head -20; rm -f "$OUT"
```

Expected: no tsc output; no eslint output; `0` stray tsx; the harness ends `ALL PASSED` and the FAIL listing is empty (if a FAIL also fails on `origin/main`, note it with its message and leave it). The `box sale` lines appear as PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/estimate-box-sale/rules.ts scripts/test-box-sale.ts scripts/test-review-and-spec.ts src/lib/stores/quotes.ts src/lib/quote-share/view.ts src/lib/quote-pdf/quote-document-data.ts "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx"
git commit -m "feat(estimator): box goods sale — the flag, the labor refusal and the BOM document seam" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Print route, generator, Cover PDF and the send's cover

**Files:**
- Modify: `src/app/print/quote/[id]/page.tsx` (the `bom` branch ~:73-123)
- Modify: `src/lib/quote-pdf/generate.ts:141-145` (`loadAppendixSources`)
- Modify: `src/lib/quote-pdf/signed-print-pdf.ts:27-54`
- Modify: `src/lib/estimate-output/cover-pdf-server.ts:25-37`
- Modify: `src/app/print/cover/[id]/page.tsx:35`
- Modify: `src/lib/estimate-email/send-server.ts:374` (`attach`)
- Modify: `scripts/test-box-sale.ts`, `scripts/test-review-and-spec.ts` (three `BOM PDF print` pins ~:70312-70329)

**Interfaces:**
- Consumes: `boxSaleOf(q)` (Task 1); `quoteFixture`, `FIX`, `rd` (test file, Task 1).
- Produces: `SignedPrintRenderOptions.refuse?: (q: Quote) => boolean` (true → 404). `renderCoverPdf` / `renderBomPdf` / `loadAppendixSources` keep their signatures.

- [ ] **Step 1: Add the Task 2 checks**

In `scripts/test-box-sale.ts`:

(a) Replace `// (later tasks: imports above this line)` with

```ts
import { loadAppendixSources } from "../src/lib/quote-pdf/generate";
import { renderCoverPdf } from "../src/lib/estimate-output/cover-pdf-server";
import { renderBomPdf } from "../src/lib/estimate-output/bom-pdf-server";
// (later tasks: imports above this line)
```

(b) Replace `// (later tasks: check functions above this line)` with

```ts
function printChecks(ok: Ok) {
  const page = rd("src/app/print/quote/[id]/page.tsx");
  const srcAt = page.indexOf("const src = revision ? quoteAsOfRevision(q, revision) : q;");
  ok(srcAt > 0 && page.indexOf("const bomLayout = bom || boxSaleOf(src);") > srcAt,
    "box sale print (source): the BOM layout is decided from the quote as printed (a sent revision's frozen flag for a bidder copy)");
  ok(page.includes('!bomLayout && part !== "tail" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets') && page.includes('!bomLayout && !bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : []') &&
     /if \(!bomLayout\) \{\s*const h = await headers\(\);/.test(page) && page.indexOf("if (bomLayout) {") > 0 && page.indexOf("if (bomLayout) {") < page.indexOf("keyProductPhotoDataUris("),
    "box sale print (source): a box sale prints #360's BOM layout — no cut sheets, no datasheet links, no photos, no print-origin read");
  ok(page.includes("if (bom && (rawBidder !== undefined || rawRev !== undefined || rawPart !== undefined)) notFound();"),
    "box sale print (source): ?view=bom's own param gate is unchanged — a box sale's bidder copy still renders");
  ok(rd("src/lib/quote-pdf/generate.ts").includes("if (boxSaleOf(q)) return { drawings: [], hasLinks: false };"), "box sale print (source): loadAppendixSources returns nothing to merge for a box sale");
  ok(rd("src/app/print/cover/[id]/page.tsx").includes('if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || boxSaleOf(q)) notFound();'), "box sale cover (source): the cover print page is a 404 for a box sale");
  ok(rd("src/lib/estimate-output/cover-pdf-server.ts").includes("refuse: boxSaleOf,") &&
     rd("src/lib/quote-pdf/signed-print-pdf.ts").includes('if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || opts.refuse?.(q)) return { ok: false, status: 404, error: "Not found" };') &&
     !rd("src/lib/estimate-output/bom-pdf-server.ts").includes("refuse"),
    "box sale cover (source): renderCoverPdf refuses a box sale through the shared render's `refuse` (404); the BOM PDF does not");
  ok(rd("src/lib/estimate-email/send-server.ts").includes("if (input.attachCover === true && !boxSaleOf(q)) {"), "box sale cover (source): the send action never attaches a cover to a box sale");
}

async function printDbChecks(ok: Ok) {
  const file = { id: "PF-0000000000b1", kind: "plan", name: "set.pdf", blobPath: "estimate-files/Q-box/UP-0123456789abcdef/set.pdf", contentType: "application/pdf", size: 2000, source: "upload", addedAt: 1, addedBy: "Pat" };
  const box = await loadAppendixSources(quoteFixture({ boxSale: true, packageFiles: [file] }), "http://localhost:3000");
  const plain = await loadAppendixSources(quoteFixture({ packageFiles: [file] }), "http://localhost:3000");
  ok(box.drawings.length === 0 && box.hasLinks === false, "box sale print (DB): the generator merges no drawings and no links page for a box sale");
  ok(plain.drawings.length === 1, "box sale print (DB): a normal estimate still merges its drawings");
  const Q = await import("../src/lib/stores/quotes");
  const BOX = fixtureId(FIX, "cover-box"), PLAIN = fixtureId(FIX, "cover-plain");
  const base = { customer: "Spec fixture", owner: "spec", source: "estimator", quoteType: "system", spec: { sections: [sys("s1", "Rigging", [line(1)])], mobs: [] } };
  const prev = process.env.AUTH_SECRET;
  try {
    // No secret: a render that gets past the quote checks stops at 503 — Chrome is never launched here.
    delete process.env.AUTH_SECRET;
    await Q.create({ ...base, id: BOX, name: "Cover box", boxSale: true } as never);
    registerFixture("quotes", BOX);
    await Q.create({ ...base, id: PLAIN, name: "Cover plain" } as never);
    registerFixture("quotes", PLAIN);
    const cBox = await renderCoverPdf(BOX, "localhost:3000", "http");
    const cPlain = await renderCoverPdf(PLAIN, "localhost:3000", "http");
    const bBox = await renderBomPdf(BOX, "localhost:3000", "http");
    ok(!cBox.ok && cBox.status === 404, "box sale cover (DB): renderCoverPdf answers 404 for a box sale");
    ok(!cPlain.ok && cPlain.status === 503, "box sale cover (DB): a normal estimate still gets past the quote checks (503 only because AUTH_SECRET is unset here)");
    ok(!bBox.ok && bBox.status === 503, "box sale cover (DB): the BOM PDF still renders for a box sale (503 only for the unset secret)");
  } finally {
    if (prev === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prev;
    await dropFixtures(FIX);
  }
}

// (later tasks: check functions above this line)
```

(c) Replace `  // (later tasks: pure checks above this line)` with

```ts
  printChecks(ok);
  // (later tasks: pure checks above this line)
```

(d) Replace `  // (later tasks: DB checks above this line)` with

```ts
  await printDbChecks(ok);
  // (later tasks: DB checks above this line)
```

- [ ] **Step 2: Retarget the three #360 print pins to `bomLayout`**

In `scripts/test-review-and-spec.ts`, replace

```ts
  ok(page.includes("!bom && part !== \"tail\" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets") && page.includes("!bom && !bidder && part !== \"main\" ? loadDatasheetLinkRows(q, origin) : []") &&
     page.indexOf("if (bom) {") > -1 && page.indexOf("if (bom) {") < page.indexOf("keyProductPhotoDataUris("),
    "BOM PDF print: the BOM view appends no cut sheets, no datasheet links and reads no key-product photos");
```

with

```ts
  ok(page.includes("!bomLayout && part !== \"tail\" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets") && page.includes("!bomLayout && !bidder && part !== \"main\" ? loadDatasheetLinkRows(q, origin) : []") &&
     page.indexOf("if (bomLayout) {") > -1 && page.indexOf("if (bomLayout) {") < page.indexOf("keyProductPhotoDataUris("),
    "BOM PDF print: the BOM view (?view=bom, or a box goods sale) appends no cut sheets, no datasheet links and reads no key-product photos");
```

replace

```ts
    const bomBranch = page.slice(page.indexOf("if (bom) {"), page.indexOf("// #293: key-product photos"));
```

with

```ts
    const bomBranch = page.slice(page.indexOf("if (bomLayout) {"), page.indexOf("// #293: key-product photos"));
```

and replace

```ts
    ok(/if \(!bom\) \{\s*const h = await headers\(\);/.test(page), "BOM PDF print: the print origin / headers() read happens only for the customer render");
```

with

```ts
    ok(/if \(!bomLayout\) \{\s*const h = await headers\(\);/.test(page), "BOM PDF print: the print origin / headers() read happens only for the customer render");
```

- [ ] **Step 3: Run it and watch it fail**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: FAIL — exit 1 with six `FAIL box sale print (source) …` / `FAIL box sale cover (source) …` lines and `32 PASS, 6 FAIL` (the `?view=bom` gate pin already passes — it guards against a regression).

- [ ] **Step 4: The print route prints the BOM layout for a box sale**

In `src/app/print/quote/[id]/page.tsx`:

(a) After `import DatasheetLinksPage from "@/components/estimate-output/datasheet-links-page";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
  const src = revision ? quoteAsOfRevision(q, revision) : q;
```

with

```ts
  const src = revision ? quoteAsOfRevision(q, revision) : q;
  // Box goods sale (spec 2026-10-21): the whole customer PDF is the BOM quote PDF's layout (#360) — no title page,
  // no cut sheets, no datasheet links, no photos. Read from the quote as printed (a revision's frozen flag).
  const bomLayout = bom || boxSaleOf(src);
```

(c) Replace

```ts
  let origin = "";
  if (!bom) {
```

with

```ts
  let origin = "";
  if (!bomLayout) {
```

(d) Replace

```ts
    !bom && part !== "tail" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets ? settleWithin(loadCutSheets(id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] estimate PDF ${id}`) : null,
```

with

```ts
    !bomLayout && part !== "tail" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets ? settleWithin(loadCutSheets(id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] estimate PDF ${id}`) : null,
```

(e) Replace

```ts
    !bom && !bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : [],
```

with

```ts
    !bomLayout && !bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : [],
```

(f) Replace

```ts
  if (bom) {
    return (
```

with

```ts
  if (bomLayout) {
    return (
```

Add one sentence to the route's doc comment, after the `?view=bom` sentence: ``A box goods sale (2026-10-21) prints that same BOM branch for its customer PDF and bidder copies.``

- [ ] **Step 5: The generator merges nothing for a box sale**

In `src/lib/quote-pdf/generate.ts`:

(a) After `import { signPrintToken } from "./token";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
export async function loadAppendixSources(q: Quote, origin: string): Promise<AppendixSources> {
  const drawings = shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection);
```

with

```ts
export async function loadAppendixSources(q: Quote, origin: string): Promise<AppendixSources> {
  // Box goods sale (spec 2026-10-21): no drawings and no datasheet-links page — one plain render of the BOM layout.
  if (boxSaleOf(q)) return { drawings: [], hasLinks: false };
  const drawings = shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection);
```

- [ ] **Step 6: The Cover PDF answers 404 for a box sale**

In `src/lib/quote-pdf/signed-print-pdf.ts`, replace

```ts
  /** Console prefix for an unexpected failure. */
  logTag: string;
};
```

with

```ts
  /** Console prefix for an unexpected failure. */
  logTag: string;
  /** A quote this render refuses (404, like a non-system quote) — the Cover PDF refuses a box goods sale. */
  refuse?: (q: Quote) => boolean;
};
```

and replace

```ts
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, status: 404, error: "Not found" };
```

with

```ts
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || opts.refuse?.(q)) return { ok: false, status: 404, error: "Not found" };
```

In `src/lib/estimate-output/cover-pdf-server.ts`:

(a) After `import { coverPdfFileName } from "./cover";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
    logTag: "cover",
  });
```

with

```ts
    logTag: "cover",
    // Box goods sale (spec 2026-10-21): no Cover PDF — a 404, as for a non-system quote.
    refuse: boxSaleOf,
  });
```

In `src/app/print/cover/[id]/page.tsx`:

(a) After `import { get as getQuote } from "@/lib/stores/quotes";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
```

with

```ts
  // Box goods sale (spec 2026-10-21): no cover — a 404, as for a non-system quote.
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || boxSaleOf(q)) notFound();
```

- [ ] **Step 7: The send never attaches a cover to a box sale**

In `src/lib/estimate-email/send-server.ts`:

(a) After `import { mailboxViewer } from "@/lib/mailbox-viewer";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
    if (input.attachCover === true) {
```

with

```ts
    // Box goods sale (spec 2026-10-21): never a cover, whatever a stale composer posts.
    if (input.attachCover === true && !boxSaleOf(q)) {
```

- [ ] **Step 8: Run the checks**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: `38 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

Run: `export PATH="$HOME/.local/node/bin:$PATH" && TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-box-sale.ts; rm -rf "$TEST_DB"`
Expected: `50 PASS, 0 FAIL`

- [ ] **Step 9: Type-check, lint, full harness**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | head -20
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint "src/app/print/quote/[id]/page.tsx" src/lib/quote-pdf/generate.ts src/lib/quote-pdf/signed-print-pdf.ts src/lib/estimate-output/cover-pdf-server.ts "src/app/print/cover/[id]/page.tsx" src/lib/estimate-email/send-server.ts
ps aux | grep -c "[t]sx"
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -E "^FAIL" "$OUT" | head -20; rm -f "$OUT"
```

Expected: no tsc or eslint output; `0`; `ALL PASSED` with an empty FAIL listing — including every existing `BOM PDF print:` and `#301 route:` pin (the Cover route pin still finds `pdfKindForQuoteType(q.quoteType) !== "quote"` in `signed-print-pdf.ts`).

- [ ] **Step 10: Commit**

```bash
git add "src/app/print/quote/[id]/page.tsx" src/lib/quote-pdf/generate.ts src/lib/quote-pdf/signed-print-pdf.ts src/lib/estimate-output/cover-pdf-server.ts "src/app/print/cover/[id]/page.tsx" src/lib/estimate-email/send-server.ts scripts/test-box-sale.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): box goods sale prints the BOM layout — no cover, cut sheets, links or drawings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Estimator Build UI — switch, chip, hidden controls, labor banner

**Files:**
- Modify: `src/lib/estimate-box-sale/rules.ts` (append copy + two helpers)
- Modify: `src/app/(app)/estimator/use-estimator-state.ts` (import :4, `freshSections` :84-87, sections init :262-268, state ~:508, `docInput` :1027-1045, `saveNow` :1388-1451, `addSystem` :2085, category/suggested adds :2105/:2132, return ~:3487)
- Modify: `src/app/(app)/estimator/pdf-doc-key.ts:16-59`
- Modify: `src/app/(app)/estimator/estimator-header.tsx` (imports, title row :210, Quote details :465-473)
- Modify: `src/app/(app)/estimator/section-card.tsx` (props ~:151, controls :523-602, star :1497, labor :1590)
- Modify: `src/app/(app)/estimator/steps/build-step.tsx` (import, banner after :477, card prop :637)
- Modify: `src/app/(app)/estimator/header-more-menu.tsx:44`
- Modify: `scripts/test-box-sale.ts`, `scripts/test-batch5.ts:165-167`

**Interfaces:**
- Consumes: `BOX_SALE_LABOR_MESSAGE`, `boxSaleLaborSystems`, `boxSaleSaveProblem`, `isBoxSaleQuoteType` (Task 1); `InitialQuote.boxSale` (Task 1); `SavePayload.boxSale` (Task 1).
- Produces (in `@/lib/estimate-box-sale/rules`):
  - `BOX_SALE_COPY: { label; switchHint; chipTitle; cardSub; laborSystems }` (strings)
  - `boxSaleLaborBanner(names: readonly string[]): string`
  - `newSystemPresentation(sections: ReadonlyArray<Pick<SpecSection, "presentation">>, boxSale: boolean): "itemized" | "narrative"`
- Produces on `EstimatorState`: `boxSale: boolean`, `setBoxSale: Dispatch<SetStateAction<boolean>>` (the `useState` setter), `canBoxSale: boolean`, `boxSaleLabor: string[]`.
- Produces: `PdfDocKeyInput.boxSale?: boolean`; `SectionCardProps.boxSale?: boolean`.

- [ ] **Step 1: Add the Task 3 checks**

In `scripts/test-box-sale.ts`:

(a) Replace `// (later tasks: imports above this line)` with

```ts
import { BOX_SALE_COPY, boxSaleLaborBanner, newSystemPresentation } from "../src/lib/estimate-box-sale/rules";
import { pdfDocKey } from "../src/app/(app)/estimator/pdf-doc-key";
import { normalizePdfOptions } from "../src/lib/quote-pdf/pdf-options";
// (later tasks: imports above this line)
```

(b) Replace `// (later tasks: check functions above this line)` with

```ts
function buildUiChecks(ok: Ok) {
  ok(newSystemPresentation([], false) === "narrative" && newSystemPresentation([], true) === "itemized" &&
     newSystemPresentation([{ presentation: "narrative" }], true) === "itemized" && newSystemPresentation([{ presentation: "narrative" }], false) === "narrative" && newSystemPresentation([{}], false) === "itemized",
    "box sale build: new systems are Itemized on a box sale; otherwise the estimate's own rule (#355 M6)");
  ok(boxSaleLaborBanner(["Install", "Crew"]) === "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale. Systems with labor: Install, Crew.",
    "box sale build: the banner is the refusal sentence plus the systems with labor");
  ok(BOX_SALE_COPY.label === "Box goods sale", "box sale build: the switch, the chip and the card all read \"Box goods sale\"");
  const keyIn = { projectName: "P", custName: "C", customerId: null, locationId: null, contactName: "", quoteNote: "", assumptions: "", paymentTerms: "Unknown", sections: [], vendorQuotes: [], pdfOptions: normalizePdfOptions(null) };
  ok(pdfDocKey(keyIn) === pdfDocKey({ ...keyIn, boxSale: false }) && pdfDocKey(keyIn) !== pdfDocKey({ ...keyIn, boxSale: true }),
    "box sale build: the switch is a document change (asks for a Save); off is the same key as before");
  const card = rd("src/app/(app)/estimator/section-card.tsx");
  ok(card.includes("  boxSale?: boolean;") && card.includes("{!p.boxSale && (\n              <a\n                href={p.presentationHref}") && card.includes('sec.kind !== "labor" && !p.boxSale && (') &&
     /\{\/\* #281: a read-only snippet[^\n]*\*\/\}\s*\{!p\.boxSale && \(\s*<button/.test(card) && card.includes('kpStar !== "none" && !p.boxSale && (') &&
     card.includes('{!p.boxSale && addBtn("+ Configure labor", p.onToggleLabor, openMethod === "labor")}'),
    "box sale build (source): the card hides the Customer chip, Discipline, Add narrative…, ★ key product and + Configure labor");
  const head = rd("src/app/(app)/estimator/estimator-header.tsx");
  ok(head.includes("{s.canBoxSale && (") && head.includes('data-testid="box-sale-switch"') && head.includes("onChange={(e) => s.setBoxSale(e.target.checked)}") && head.includes("{s.boxSale && (") && head.includes('data-testid="box-sale-chip"'),
    "box sale build (source): the header has the switch (system estimates only) and a chip while it is on");
  const step = rd("src/app/(app)/estimator/steps/build-step.tsx");
  ok(step.includes("{s.boxSaleLabor.length > 0 && (") && step.includes("{boxSaleLaborBanner(s.boxSaleLabor)}") && step.includes("boxSale={s.boxSale}"),
    "box sale build (source): Build shows the labor banner and tells each card it is a box sale");
  ok(rd("src/app/(app)/estimator/header-more-menu.tsx").includes("{s.aiSource && !s.boxSale && ("), "box sale build (source): More ▾ hides Draft from survey/inspection");
  const us = rd("src/app/(app)/estimator/use-estimator-state.ts");
  ok(us.includes("const [boxSale, setBoxSale] = useState(initial.boxSale);") && us.includes("const canBoxSale = isBoxSaleQuoteType(initial.quoteType);") &&
     us.includes("const boxSaleLabor = useMemo(() => (boxSale ? boxSaleLaborSystems(sections) : []), [boxSale, sections]);") && /\n    boxSale,\n    boxSaleLabor,\n    canBoxSale,\n    setBoxSale,\n/.test(us),
    "box sale build (source): the hook holds the flag and the systems with labor, and returns them");
  const saveNow = us.slice(us.indexOf("const saveNow = async (): Promise<number | false> => {"), us.indexOf("const doSave = () => {"));
  const refuse = saveNow.indexOf("const boxProblem = boxSaleSaveProblem(boxSale, sections);");
  ok(refuse > 0 && refuse < saveNow.indexOf("saveQuoteAction(") && /if \(boxProblem\) \{\s*setActionNotice\(null\);\s*setGateRefused\(false\);\s*setActionError\(boxProblem\);\s*return false;\s*\}/.test(saveNow),
    "box sale build (source): Save refuses a box sale with labor in the browser, with the same sentence, and sends nothing");
  ok(saveNow.includes("          boxSale,\n") && us.includes("      boxSale,\n      document: packageDoc,\n    }),") && us.includes("packageDoc, boxSale, sections, groups, vendorQuotes, pdfOpts]"),
    "box sale build (source): the flag rides every Save and is part of the document key");
  ok(us.includes("presentation: newSystemPresentation([], boxSale)") && us.includes("presentation: newSystemPresentation(ss, boxSale)") &&
     (us.match(/presentation: newSystemPresentation\(sections, boxSale\),/g) || []).length === 2 && us.includes("      : freshSections(initialFreightDefault.pct, initial.boxSale)"),
    "box sale build (source): every new system (fresh, blank, category, suggested) is Itemized on a box sale");
}

// (later tasks: check functions above this line)
```

(c) Replace `  // (later tasks: pure checks above this line)` with

```ts
  buildUiChecks(ok);
  // (later tasks: pure checks above this line)
```

- [ ] **Step 2: Retarget the #355 M6 pin**

In `scripts/test-batch5.ts`, replace

```ts
  ok(/const freshSections = [\s\S]{0,400}presentation: NEW_SYSTEM_PRESENTATION/.test(us) && (us.match(/presentation: NEW_SYSTEM_PRESENTATION/g) || []).length === 1 &&
     us.includes("presentation: presentationForNewSystem(ss)") && (us.match(/presentation: presentationForNewSystem\(sections\),/g) || []).length === 2,
    "#355 review M6: only a NEW estimate starts Narrative; + Add system (blank, category, suggestion) follows the estimate");
```

with

```ts
  ok(/const freshSections = [\s\S]{0,400}presentation: newSystemPresentation\(\[\], boxSale\)/.test(us) && !us.includes("presentation: NEW_SYSTEM_PRESENTATION") &&
     us.includes("presentation: newSystemPresentation(ss, boxSale)") && (us.match(/presentation: newSystemPresentation\(sections, boxSale\),/g) || []).length === 2,
    "#355 review M6 (+ box goods sale): only a NEW estimate starts Narrative; + Add system (blank, category, suggestion) follows the estimate — Itemized throughout on a box sale");
```

(`newSystemPresentation([], false)` is `presentationForNewSystem([])` = `NEW_SYSTEM_PRESENTATION`; the new `buildUiChecks` pins that.)

- [ ] **Step 3: Run it and watch it fail**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: FAIL — the run stops with an error naming `BOX_SALE_COPY`, `newSystemPresentation` or `boxSaleLaborBanner` (a missing export, or `… is not a function`), exit 1.

- [ ] **Step 4: Add the copy and helpers to `rules.ts`**

In `src/lib/estimate-box-sale/rules.ts`, replace

```ts
import { isBonusItem } from "@/lib/estimate-bonus/flags";
```

with

```ts
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { presentationForNewSystem } from "@/lib/estimate-output/fields";
```

and append at the end of the file:

```ts
/** The Estimator's and + New quote's copy. */
export const BOX_SALE_COPY = {
  label: "Box goods sale",
  switchHint: "Equipment + freight only. The customer gets the BOM PDF and the online BOM — no cover, narrative, datasheets or drawings. Turn it off to bring them back.",
  chipTitle: "Box goods sale — equipment + freight only; the customer gets the itemized BOM",
  cardSub: "Equipment + freight only — the customer gets the itemized BOM",
  laborSystems: "Systems with labor:",
} as const;

/** The Build banner: the refusal sentence, then the systems that carry labor. */
export function boxSaleLaborBanner(names: readonly string[]): string {
  return `${BOX_SALE_LABOR_MESSAGE} ${BOX_SALE_COPY.laborSystems} ${names.join(", ")}.`;
}

/** A new system's presentation: Itemized on a box sale, else the estimate's own rule (presentationForNewSystem —
 *  no system yet = Narrative). A system loaded From library keeps its own (it prints itemized on a box sale anyway). */
export function newSystemPresentation(sections: ReadonlyArray<Pick<SpecSection, "presentation">>, boxSale: boolean): NonNullable<SpecSection["presentation"]> {
  return boxSale ? "itemized" : presentationForNewSystem(sections);
}
```

- [ ] **Step 5: The document key knows the flag**

In `src/app/(app)/estimator/pdf-doc-key.ts`, replace

```ts
  vendorQuotes: VendorQuote[];
  pdfOptions: QuotePdfOptions;
};
```

with

```ts
  vendorQuotes: VendorQuote[];
  pdfOptions: QuotePdfOptions;
  /** Box goods sale (spec 2026-10-21) — the whole document switches to the BOM view. */
  boxSale?: boolean;
};
```

and replace

```ts
    i.pdfOptions,
    i.document ?? null,
  ]);
```

with

```ts
    i.pdfOptions,
    i.document ?? null,
    // Box goods sale: only when on, so every other estimate's key is unchanged.
    ...(i.boxSale === true ? ["boxSale"] : []),
  ]);
```

- [ ] **Step 6: The hook holds the flag, refuses labor and adds Itemized systems**

In `src/app/(app)/estimator/use-estimator-state.ts`:

(a) Replace

```ts
import { NEW_SYSTEM_PRESENTATION, presentationForNewSystem } from "@/lib/estimate-output/fields";
```

with

```ts
import { boxSaleLaborSystems, boxSaleSaveProblem, isBoxSaleQuoteType, newSystemPresentation } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
const freshSections = (freightPct: number): SpecSection[] => [
  // #267: a new system's auto price rounds up to the next $25.
  { id: "sys1", name: "New System", kind: "materials", mfr: "", freightPct, freightAuto: true, priceRound: SYSTEM_PRICE_STEP, presentation: NEW_SYSTEM_PRESENTATION, items: [] },
];
```

with

```ts
const freshSections = (freightPct: number, boxSale = false): SpecSection[] => [
  // #267: a new system's auto price rounds up to the next $25. Box goods sale: Itemized.
  { id: "sys1", name: "New System", kind: "materials", mfr: "", freightPct, freightAuto: true, priceRound: SYSTEM_PRICE_STEP, presentation: newSystemPresentation([], boxSale), items: [] },
];
```

(c) Replace

```ts
      : freshSections(initialFreightDefault.pct)
  );
```

with

```ts
      : freshSections(initialFreightDefault.pct, initial.boxSale)
  );
```

(d) Replace

```ts
  const categorySaved = useRef(initial.category);
```

with

```ts
  const categorySaved = useRef(initial.category);
  /** Box goods sale (spec 2026-10-21) — content: rides Save (never the header autosave) and is part of the
   *  document key, so a toggle reads "Unsaved changes" like any document edit. System estimates only. */
  const [boxSale, setBoxSale] = useState(initial.boxSale);
  const canBoxSale = isBoxSaleQuoteType(initial.quoteType);
  /** The systems whose labor blocks a box-sale Save — the Build banner names them. */
  const boxSaleLabor = useMemo(() => (boxSale ? boxSaleLaborSystems(sections) : []), [boxSale, sections]);
```

(e) Replace

```ts
      pdfOptions: pdfOpts,
      document: packageDoc,
    }),
    [quoteId, projectName, docCustName, customerId, locationId, contactName, quoteNote, assumptions, paymentTerms, packageDoc, sections, groups, vendorQuotes, pdfOpts]
```

with

```ts
      pdfOptions: pdfOpts,
      boxSale,
      document: packageDoc,
    }),
    [quoteId, projectName, docCustName, customerId, locationId, contactName, quoteNote, assumptions, paymentTerms, packageDoc, boxSale, sections, groups, vendorQuotes, pdfOpts]
```

(f) In `saveNow`, replace

```ts
      setActionError(PACKAGE_DOC_TOO_LARGE);
      return false;
    }
    const docAtSave = { ...docInput, document: docNow };
```

with

```ts
      setActionError(PACKAGE_DOC_TOO_LARGE);
      return false;
    }
    // Box goods sale (spec 2026-10-21): any labor line refuses the save — the server's own sentence, nothing sent.
    const boxProblem = boxSaleSaveProblem(boxSale, sections);
    if (boxProblem) {
      setActionNotice(null);
      setGateRefused(false);
      setActionError(boxProblem);
      return false;
    }
    const docAtSave = { ...docInput, document: docNow };
```

(g) In the `saveQuoteAction(loadedId, { … })` payload, replace

```ts
          pdfOptions: pdfOpts,
          // #301 (R14): the cover fields ride every Save.
```

with

```ts
          pdfOptions: pdfOpts,
          // Box goods sale: rides every Save (content; the server refuses it with labor).
          boxSale,
          // #301 (R14): the cover fields ride every Save.
```

(h) In `addSystem`, replace

```ts
presentation: presentationForNewSystem(ss)
```

with

```ts
presentation: newSystemPresentation(ss, boxSale)
```

(i) In `addSystemFromCategory` and `addSuggestedSystem` (two identical lines — use Edit with `replace_all: true`), replace

```ts
      presentation: presentationForNewSystem(sections),
```

with

```ts
      presentation: newSystemPresentation(sections, boxSale),
```

(j) In the returned object, replace

```ts
    category,
    commitCategory,
```

with

```ts
    boxSale,
    boxSaleLabor,
    canBoxSale,
    setBoxSale,
    category,
    commitCategory,
```

- [ ] **Step 7: Header switch and chip**

In `src/app/(app)/estimator/estimator-header.tsx`:

(a) After `import BidChip from "./bid-chip";` add:

```ts
import { BOX_SALE_COPY } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```tsx
              <BidChip quoteId={s.loadedId} canEdit={s.canApplyCredit} onSync={(x) => applySync({ ok: true, review: null, status: x.status, next: x.next })} />
```

with

```tsx
              <BidChip quoteId={s.loadedId} canEdit={s.canApplyCredit} onSync={(x) => applySync({ ok: true, review: null, status: x.status, next: x.next })} />
              {/* Box goods sale (spec 2026-10-21): the mode stays visible on every step. Not accent-colored. */}
              {s.boxSale && (
                <span
                  data-testid="box-sale-chip"
                  title={BOX_SALE_COPY.chipTitle}
                  style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".03em", color: "#1d2026", background: "#e3c26e", borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}
                >
                  {BOX_SALE_COPY.label}
                </span>
              )}
```

(c) Replace

```tsx
                  title="Quote category — shown on the Quotes hub"
                  style={{ ...DARK_SELECT, width: "100%", minWidth: 0, cursor: "text" }}
                />
```

with

```tsx
                  title="Quote category — shown on the Quotes hub"
                  style={{ ...DARK_SELECT, width: "100%", minWidth: 0, cursor: "text" }}
                />
                {/* Box goods sale (spec 2026-10-21): system estimates only; rides Save like any document edit. */}
                {s.canBoxSale && (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 12, fontWeight: 600, color: "#d7dae0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-checked={s.boxSale}
                        data-testid="box-sale-switch"
                        checked={s.boxSale}
                        onChange={(e) => s.setBoxSale(e.target.checked)}
                      />
                      <span>{BOX_SALE_COPY.label}</span>
                    </label>
                    <span style={META_HINT}>{BOX_SALE_COPY.switchHint}</span>
                  </>
                )}
```

- [ ] **Step 8: The system card hides the narrative and labor controls**

In `src/app/(app)/estimator/section-card.tsx`:

(a) Replace

```ts
  /** #301: the survey discipline this system answers ("" = auto, inferred from the name). */
  onSetDiscipline: (value: ScopeDiscipline | "") => void;
```

with

```ts
  /** #301: the survey discipline this system answers ("" = auto, inferred from the name). */
  onSetDiscipline: (value: ScopeDiscipline | "") => void;
  /** Box goods sale (spec 2026-10-21): hide + Configure labor, the Customer chip, Discipline, Add narrative… and ★. */
  boxSale?: boolean;
```

(b) Replace

```tsx
              <a
                href={p.presentationHref}
```

with

```tsx
              {!p.boxSale && (
              <a
                href={p.presentationHref}
```

and replace

```tsx
                Customer: {(sec.presentation || "itemized") === "narrative" ? "Narrative" : "Itemized"} ↗
              </a>
```

with

```tsx
                Customer: {(sec.presentation || "itemized") === "narrative" ? "Narrative" : "Itemized"} ↗
              </a>
              )}
```

(c) Replace

```tsx
              {sec.kind !== "labor" && (
```

with

```tsx
              {sec.kind !== "labor" && !p.boxSale && (
```

(d) Replace

```tsx
              {/* #281: a read-only snippet — the narrative itself is written in the right column. */}
              <button
```

with

```tsx
              {/* #281: a read-only snippet — the narrative itself is written in the right column. */}
              {!p.boxSale && (
              <button
```

and replace

```tsx
                {narrativeSnippet || "Add narrative…"}
              </button>
```

with

```tsx
                {narrativeSnippet || "Add narrative…"}
              </button>
              )}
```

(e) Replace

```tsx
                    {kpStar !== "none" && (
```

with

```tsx
                    {kpStar !== "none" && !p.boxSale && (
```

(f) Replace

```tsx
              {addBtn("+ Configure labor", p.onToggleLabor, openMethod === "labor")}
```

with

```tsx
              {!p.boxSale && addBtn("+ Configure labor", p.onToggleLabor, openMethod === "labor")}
```

- [ ] **Step 9: Build banner, card prop, More ▾**

In `src/app/(app)/estimator/steps/build-step.tsx`:

(a) After `import type { SuggestionParts } from "@/lib/assist/features/suggestion-panel";` add:

```ts
import { boxSaleLaborBanner } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```tsx
          <AssistDraftBanner view={assistDraft} />
```

with

```tsx
          <AssistDraftBanner view={assistDraft} />
          {/* Box goods sale (spec 2026-10-21): turning it on with labor is allowed — Save stays refused until it's gone. */}
          {s.boxSaleLabor.length > 0 && (
            <div
              role="alert"
              data-testid="box-sale-labor"
              style={{ margin: "0 0 12px", padding: "10px 14px", fontSize: 12.5, lineHeight: 1.45, color: "#9b3a2a", background: "#fdf0ee", border: "1px solid #f3cfc7", borderRadius: 10 }}
            >
              {boxSaleLaborBanner(s.boxSaleLabor)}
            </div>
          )}
```

(c) Replace

```tsx
                    onMarkBuilt={() => markBuilt(sec.id)}
```

with

```tsx
                    onMarkBuilt={() => markBuilt(sec.id)}
                    boxSale={s.boxSale}
```

In `src/app/(app)/estimator/header-more-menu.tsx`, replace

```tsx
          {s.aiSource && (
```

with

```tsx
          {/* Box goods sale: no narrative scope to draft. */}
          {s.aiSource && !s.boxSale && (
```

- [ ] **Step 10: Run the checks**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: `50 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

- [ ] **Step 11: Type-check, lint, full harness**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | head -20
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint src/lib/estimate-box-sale/rules.ts "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/pdf-doc-key.ts" "src/app/(app)/estimator/estimator-header.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/steps/build-step.tsx" "src/app/(app)/estimator/header-more-menu.tsx"
ps aux | grep -c "[t]sx"
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -E "^FAIL" "$OUT" | head -20; rm -f "$OUT"
```

Expected: no tsc or eslint output; `0`; `ALL PASSED`, empty FAIL listing — including the retargeted `#355 review M6` line, `#P5 save` (`document: packageDoc,\n    }),` still closes `docInput`; `document: docNow,` still closes the payload) and `#P2a hook` (`sections, groups, vendorQuotes, pdfOpts]`).

- [ ] **Step 12: Commit**

```bash
git add src/lib/estimate-box-sale/rules.ts "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/pdf-doc-key.ts" "src/app/(app)/estimator/estimator-header.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/steps/build-step.tsx" "src/app/(app)/estimator/header-more-menu.tsx" scripts/test-box-sale.ts scripts/test-batch5.ts
git commit -m "feat(estimator): box goods sale switch, chip and Build — labor banner, hidden narrative controls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Build package, Customer review and readiness

**Files:**
- Modify: `src/lib/estimate-steps/package-tabs.ts` (append)
- Modify: `src/app/(app)/estimator/steps/package-step.tsx:6-15, 51, 64-70, 77`
- Modify: `src/app/(app)/estimator/steps/package-bom-tab.tsx` (import, people block before the Vendors `<details>`)
- Modify: `src/lib/estimate-review/review-ui.ts:57-58, 194-202`
- Modify: `src/app/(app)/estimator/steps/review-tabs.tsx:4-7, 52-61, 126`
- Modify: `src/app/(app)/estimator/steps/review-sidebar.tsx:111`
- Modify: `src/lib/estimate-steps/readiness.ts:22-36, 69-80, 97-99, 120-125`
- Modify: `src/app/(app)/estimator/estimator-client.tsx:46-58`
- Modify: `src/lib/estimate-output/package-panel-server.ts:119`
- Modify: `scripts/test-box-sale.ts`, `scripts/test-review-and-spec.ts:57611`

**Interfaces:**
- Consumes: `EstimatorState.boxSale` (Task 3); `boxSaleOf` (Task 1); `QuotePeopleFields` (existing, `../quote-people-fields`).
- Produces:
  - `BOX_SALE_PACKAGE_TABS: readonly PackageTab[]`, `packageTabsFor(boxSale: boolean): readonly PackageTab[]`, `boxSalePackageTab(tab: PackageTab, boxSale: boolean): PackageTab`
  - `BOX_SALE_REVIEW_TABS: readonly ReviewTab[]`, `reviewTabsFor(boxSale: boolean): readonly ReviewTab[]`, `nextReviewTab(current, key, tabs = REVIEW_TABS)`
  - `ReadinessInput.boxSale?: boolean`

- [ ] **Step 1: Add the Task 4 checks**

In `scripts/test-box-sale.ts`:

(a) Replace `// (later tasks: imports above this line)` with

```ts
import { BOX_SALE_PACKAGE_TABS, boxSalePackageTab, PACKAGE_TABS, packageTabsFor, parsePackageTab } from "../src/lib/estimate-steps/package-tabs";
import { BOX_SALE_REVIEW_TABS, nextReviewTab, REVIEW_TABS, reviewTabsFor } from "../src/lib/estimate-review/review-ui";
import { estimateReadiness } from "../src/lib/estimate-steps/readiness";
// (later tasks: imports above this line)
```

(b) Replace `// (later tasks: check functions above this line)` with

```ts
function packageReviewChecks(ok: Ok) {
  ok(packageTabsFor(true).join() === "bom" && packageTabsFor(false) === PACKAGE_TABS && BOX_SALE_PACKAGE_TABS.join() === "bom", "box sale package: Build package is the BOM quote tab alone");
  ok(["narrative", "client", "bom", null, "junk"].every((raw) => boxSalePackageTab(parsePackageTab(raw), true) === "bom") &&
     boxSalePackageTab(parsePackageTab("client"), false) === "client" && boxSalePackageTab(parsePackageTab(null), false) === "narrative",
    "box sale package: ?ptab=narrative / client (or none) lands on BOM quote; a normal estimate is unchanged");
  ok(reviewTabsFor(true).join() === "document,bom" && reviewTabsFor(false) === REVIEW_TABS && BOX_SALE_REVIEW_TABS.join() === "document,bom", "box sale review: Customer review shows Document and BOM only");
  ok(nextReviewTab("document", "ArrowRight", BOX_SALE_REVIEW_TABS) === "bom" && nextReviewTab("bom", "ArrowRight", BOX_SALE_REVIEW_TABS) === "document" && nextReviewTab("document", "End", BOX_SALE_REVIEW_TABS) === "bom" &&
     nextReviewTab("document", "ArrowRight") === "package" && nextReviewTab("document", "x", BOX_SALE_REVIEW_TABS) === null,
    "box sale review: arrow keys move across the shown tabs only (the default list is unchanged)");
  const narr = sys("n", "Rigging", [line(1)], { presentation: "narrative" });
  const base = { saved: true, sections: [narr] as never[], review: null, status: "draft" as const, revNum: 1 };
  const plainR = estimateReadiness(base), boxR = estimateReadiness({ ...base, boxSale: true });
  ok(boxR.package.state === "ok" && boxR.package.label === "✓ Ready", "box sale readiness: Build package has no narrative / intro / goals / key-product gaps");
  ok(!boxR.send.label.includes("no intro text") && plainR.send.label.includes("no intro text"), "box sale readiness: Send & track drops the no-intro warning");
  ok(plainR.package.state === "gaps", "box sale readiness: a normal estimate still counts its gaps");
  const shell = rd("src/app/(app)/estimator/steps/package-step.tsx");
  ok(shell.includes('const tab = boxSalePackageTab(parsePackageTab(params.get("ptab")), s.boxSale);') && shell.includes("const tabs = packageTabsFor(s.boxSale);") &&
     shell.includes("if (!to || !tabs.includes(to)) return;") && shell.includes("{tabs.map((t) => ("),
    "box sale package (source): the shell lands a box sale on BOM quote and lists only its tabs");
  const bomTab = rd("src/app/(app)/estimator/steps/package-bom-tab.tsx");
  ok(/\{s\.boxSale && \(\s*<div[^>]*data-testid="box-sale-people"[^>]*>\s*<QuotePeopleFields s=\{s\} tone="light" \/>/.test(bomTab) && !/from "@\/lib\/stores\//.test(bomTab),
    "box sale package (source): BOM quote carries Lead estimator / Prepared by on a box sale (and still imports no store)");
  const tabsSrc = rd("src/app/(app)/estimator/steps/review-tabs.tsx");
  ok(tabsSrc.includes("const tabs = reviewTabsFor(s.boxSale);") && tabsSrc.includes('const tab: ReviewTab = tabs.includes(picked) ? picked : "document";') && tabsSrc.includes("{tabs.map((t) => (") && tabsSrc.includes("nextReviewTab(tab, e.key, tabs)"),
    "box sale review (source): the review tabs follow reviewTabsFor; a hidden tab reads as Document");
  ok(rd("src/app/(app)/estimator/steps/review-sidebar.tsx").includes("{!s.boxSale && <PackageChecklist saved={!!loadedId} docs={docs} packageBadge={packageBadge} />}"), "box sale review (source): the sidebar's package checklist is hidden");
  const client = rd("src/app/(app)/estimator/estimator-client.tsx");
  ok(client.includes("        boxSale: s.boxSale,\n") && client.includes("s.trackSummary, s.boxSale]"), "box sale readiness (source): the step badges read the live flag");
  ok(rd("src/lib/estimate-output/package-panel-server.ts").includes("gaps: boxSaleOf(q) ? [] : packageGapChips({"), "box sale readiness (source): the package panel shows no gap chips for a box sale");
}

// (later tasks: check functions above this line)
```

(c) Replace `  // (later tasks: pure checks above this line)` with

```ts
  packageReviewChecks(ok);
  // (later tasks: pure checks above this line)
```

- [ ] **Step 2: Retarget the #P4 review-tabs pin**

In `scripts/test-review-and-spec.ts`, replace

```ts
     tabsSrc.includes("onKeyDown={onTabKey}") && tabsSrc.includes("nextReviewTab(tab, e.key)") && tabsSrc.includes("tabIndex={tab === t ? 0 : -1}"),
```

with

```ts
     tabsSrc.includes("onKeyDown={onTabKey}") && tabsSrc.includes("nextReviewTab(tab, e.key, tabs)") && tabsSrc.includes("tabIndex={tab === t ? 0 : -1}"),
```

- [ ] **Step 3: Run it and watch it fail**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: FAIL — the run stops with an error naming `packageTabsFor`, `boxSalePackageTab`, `reviewTabsFor` or `BOX_SALE_REVIEW_TABS` (a missing export, or `… is not a function`), exit 1.

- [ ] **Step 4: Package tabs**

Append to `src/lib/estimate-steps/package-tabs.ts`:

```ts
/** Box goods sale (spec 2026-10-21): the client gets the BOM only, so Build package is the BOM quote tab alone. */
export const BOX_SALE_PACKAGE_TABS: readonly PackageTab[] = ["bom"];

/** The tabs Build package shows. */
export function packageTabsFor(boxSale: boolean): readonly PackageTab[] {
  return boxSale ? BOX_SALE_PACKAGE_TABS : PACKAGE_TABS;
}

/** A box sale lands on BOM quote whatever `?ptab=` says (narrative / client / none); otherwise `tab`. */
export function boxSalePackageTab(tab: PackageTab, boxSale: boolean): PackageTab {
  return boxSale ? "bom" : tab;
}
```

In `src/app/(app)/estimator/steps/package-step.tsx`:

(a) Replace

```ts
import {
  nextPackageTab,
  PACKAGE_TAB_LABEL,
  PACKAGE_TABS,
  packageTabId,
```

with

```ts
import {
  boxSalePackageTab,
  nextPackageTab,
  PACKAGE_TAB_LABEL,
  packageTabsFor,
  packageTabId,
```

(b) Replace

```ts
  const tab = parsePackageTab(params.get("ptab"));
```

with

```ts
  // Box goods sale (spec 2026-10-21): BOM quote only — ?ptab=narrative / client land on it.
  const tab = boxSalePackageTab(parsePackageTab(params.get("ptab")), s.boxSale);
  const tabs = packageTabsFor(s.boxSale);
```

(c) Replace

```ts
    if (!to) return;
    e.preventDefault();
    goTab(to, undefined, true);
```

with

```ts
    if (!to || !tabs.includes(to)) return;
    e.preventDefault();
    goTab(to, undefined, true);
```

(d) Replace

```tsx
          {PACKAGE_TABS.map((t) => (
```

with

```tsx
          {tabs.map((t) => (
```

In `src/app/(app)/estimator/steps/package-bom-tab.tsx`:

(a) After `import { VendorsCard } from "./vendors-card";` add:

```ts
import { QuotePeopleFields } from "../quote-people-fields";
```

(b) Replace

```tsx
        <details open style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
```

with

```tsx
        {/* Box goods sale (spec 2026-10-21): the Narrative tab's aside is gone, so Lead estimator / Prepared by live here. */}
        {s.boxSale && (
          <div data-testid="box-sale-people" style={{ display: "flex", flexDirection: "column", gap: 7, background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "12px 14px", marginBottom: 12, maxWidth: 360 }}>
            <QuotePeopleFields s={s} tone="light" />
          </div>
        )}
        <details open style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
```

- [ ] **Step 5: Review tabs and the sidebar**

In `src/lib/estimate-review/review-ui.ts`:

(a) Replace

```ts
export type ReviewTab = (typeof REVIEW_TABS)[number];
```

with

```ts
export type ReviewTab = (typeof REVIEW_TABS)[number];
/** Box goods sale (spec 2026-10-21): the client gets the BOM only — Document (the BOM PDF) and BOM. */
export const BOX_SALE_REVIEW_TABS: readonly ReviewTab[] = ["document", "bom"];

/** The tabs Customer review shows. */
export function reviewTabsFor(boxSale: boolean): readonly ReviewTab[] {
  return boxSale ? BOX_SALE_REVIEW_TABS : REVIEW_TABS;
}
```

(b) Replace

```ts
export function nextReviewTab(current: ReviewTab, key: string): ReviewTab | null {
  const i = REVIEW_TABS.indexOf(current);
  const n = REVIEW_TABS.length;
  if (key === "ArrowRight") return REVIEW_TABS[(i + 1) % n];
  if (key === "ArrowLeft") return REVIEW_TABS[(i - 1 + n) % n];
  if (key === "Home") return REVIEW_TABS[0];
  if (key === "End") return REVIEW_TABS[n - 1];
  return null;
}
```

with

```ts
export function nextReviewTab(current: ReviewTab, key: string, tabs: readonly ReviewTab[] = REVIEW_TABS): ReviewTab | null {
  const i = tabs.indexOf(current);
  const n = tabs.length;
  if (key === "ArrowRight") return tabs[(i + 1) % n];
  if (key === "ArrowLeft") return tabs[(i - 1 + n) % n];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[n - 1];
  return null;
}
```

In `src/app/(app)/estimator/steps/review-tabs.tsx`:

(a) Replace

```ts
  datasheetCell, frameKey, frameSrc, frameWidth, framedTab, nextReviewTab, reviewPanelId, reviewTabId, REVIEW_DEVICE_LABEL, REVIEW_DEVICES, REVIEW_TAB_LABEL, REVIEW_TABS,
```

with

```ts
  datasheetCell, frameKey, frameSrc, frameWidth, framedTab, nextReviewTab, reviewPanelId, reviewTabId, REVIEW_DEVICE_LABEL, REVIEW_DEVICES, REVIEW_TAB_LABEL, reviewTabsFor,
```

(b) Replace

```ts
  const [tab, setTab] = useState<ReviewTab>("document");
```

with

```ts
  // Box goods sale (spec 2026-10-21): Document + BOM only; a tab it doesn't offer reads as Document.
  const tabs = reviewTabsFor(s.boxSale);
  const [picked, setTab] = useState<ReviewTab>("document");
  const tab: ReviewTab = tabs.includes(picked) ? picked : "document";
```

(c) Replace

```ts
    const to = nextReviewTab(tab, e.key);
```

with

```ts
    const to = nextReviewTab(tab, e.key, tabs);
```

(d) Replace

```tsx
          {REVIEW_TABS.map((t) => (
```

with

```tsx
          {tabs.map((t) => (
```

In `src/app/(app)/estimator/steps/review-sidebar.tsx`, replace

```tsx
      <PackageChecklist saved={!!loadedId} docs={docs} packageBadge={packageBadge} />
```

with

```tsx
      {/* Box goods sale: no package to check. */}
      {!s.boxSale && <PackageChecklist saved={!!loadedId} docs={docs} packageBadge={packageBadge} />}
```

- [ ] **Step 6: Quiet readiness and gaps**

In `src/lib/estimate-steps/readiness.ts`:

(a) Replace

```ts
   *  whose system/line is gone, product blocks no longer in the BOM). */
  document?: PackageDoc | null;
};
```

with

```ts
   *  whose system/line is gone, product blocks no longer in the BOM). */
  document?: PackageDoc | null;
  /** Box goods sale (spec 2026-10-21): the client gets the BOM only — no narrative / intro / goals / key-product /
   *  document gaps. */
  boxSale?: boolean;
};
```

(b) Replace

```ts
function packageBadge(saved: boolean, sections: SpecSection[], document?: PackageDoc | null): StepBadge {
  if (!saved) return { state: "idle", label: "Save first" };
```

with

```ts
function packageBadge(saved: boolean, sections: SpecSection[], document?: PackageDoc | null, boxSale = false): StepBadge {
  if (!saved) return { state: "idle", label: "Save first" };
  if (boxSale) return { state: "ok", label: "✓ Ready" };
```

(c) Replace

```ts
  const noIntro = i.status === "draft" ? narrativeWithoutIntro(i.sections, i.document) : 0;
```

with

```ts
  const noIntro = i.status === "draft" && !i.boxSale ? narrativeWithoutIntro(i.sections, i.document) : 0;
```

(d) Replace

```ts
    package: packageBadge(i.saved, i.sections, i.document),
```

with

```ts
    package: packageBadge(i.saved, i.sections, i.document, i.boxSale === true),
```

In `src/app/(app)/estimator/estimator-client.tsx`, replace

```ts
        document: s.packageDoc,
      }),
    [s.loadedId, s.sections, s.packageDoc, s.next, s.status, s.revNum, s.trackSummary]
```

with

```ts
        document: s.packageDoc,
        boxSale: s.boxSale,
      }),
    [s.loadedId, s.sections, s.packageDoc, s.next, s.status, s.revNum, s.trackSummary, s.boxSale]
```

In `src/lib/estimate-output/package-panel-server.ts`:

(a) After `import { loadPeakHeaderDefault } from "@/lib/letterhead-server";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
    gaps: packageGapChips({
```

with

```ts
    // Box goods sale (spec 2026-10-21): the client gets the BOM only — no datasheet / drawing / narrative gaps.
    gaps: boxSaleOf(q) ? [] : packageGapChips({
```

- [ ] **Step 7: Run the checks**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: `63 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

- [ ] **Step 8: Type-check, lint, full harness**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | head -20
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint src/lib/estimate-steps/package-tabs.ts "src/app/(app)/estimator/steps/package-step.tsx" "src/app/(app)/estimator/steps/package-bom-tab.tsx" src/lib/estimate-review/review-ui.ts "src/app/(app)/estimator/steps/review-tabs.tsx" "src/app/(app)/estimator/steps/review-sidebar.tsx" src/lib/estimate-steps/readiness.ts "src/app/(app)/estimator/estimator-client.tsx" src/lib/estimate-output/package-panel-server.ts
ps aux | grep -c "[t]sx"
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -E "^FAIL" "$OUT" | head -20; rm -f "$OUT"
```

Expected: no tsc or eslint output; `0`; `ALL PASSED`, empty FAIL listing — including `#333 shell` (`parsePackageTab(params.get("ptab"))` and `nextPackageTab(tab, e.key)` are still in the shell), `#P4 review UI` and the retargeted `#P4 review UI fix` tabs line.

- [ ] **Step 9: Commit**

```bash
git add src/lib/estimate-steps/package-tabs.ts "src/app/(app)/estimator/steps/package-step.tsx" "src/app/(app)/estimator/steps/package-bom-tab.tsx" src/lib/estimate-review/review-ui.ts "src/app/(app)/estimator/steps/review-tabs.tsx" "src/app/(app)/estimator/steps/review-sidebar.tsx" src/lib/estimate-steps/readiness.ts "src/app/(app)/estimator/estimator-client.tsx" src/lib/estimate-output/package-panel-server.ts scripts/test-box-sale.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): box goods sale — BOM quote tab only, Document + BOM review, quiet readiness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Send & track, the email and the client link / package page

**Files:**
- Modify: `src/lib/estimate-email/send-ui.ts` (after `composerInitial`, ~:90)
- Modify: `src/app/(app)/estimator/steps/send-composer.tsx:4-14, 70-72, 240-246`
- Modify: `src/lib/estimate-email/compose.ts:19-63, 66-86`
- Modify: `src/app/(app)/estimator/send-actions.ts:127-140`, `src/app/(app)/estimator/bid-send-actions.ts:79`
- Modify: `src/lib/estimate-output/package-model.ts:57-198`
- Modify: `src/components/estimate-output/package-view.tsx:255-262`
- Modify: `src/lib/estimate-output/package-extras-model.ts:31`
- Modify: `src/app/share/quote/[id]/[token]/package-page.tsx:31-39`
- Modify: `src/lib/estimate-output/package-loader.ts:34-49`, `src/lib/estimate-output/package-live-loader.ts:60-85`
- Modify: `src/app/share/quote/[id]/[token]/package.zip/route.ts:28`, `src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts:32`
- Modify: `scripts/test-box-sale.ts`

**Interfaces:**
- Consumes: `boxSaleOf`, `revisionBoxSale` (Task 1); `EstimatorState.boxSale` (Task 3); `quoteFixture`, `sys`, `line`, `DOC`, `SET` (test file).
- Produces:
  - `withoutCoverForBoxSale(f: ComposerFields, boxSale: boolean): ComposerFields`
  - `EstimateEmailDefaultsInput.boxSale?: boolean`; `BidderEmailDefaultsInput.boxSale?: boolean`
  - `PackageViewInput.boxSale?: boolean`; `PackageViewProps.boxSale?: true`; `boxSalePackageView(m: PackageViewProps): PackageViewProps`
  - `boxSaleExtras(x: PackageExtras): PackageExtras`

- [ ] **Step 1: Add the Task 5 checks**

In `scripts/test-box-sale.ts`:

(a) Replace `// (later tasks: imports above this line)` with

```ts
import { composerInitial, withoutCoverForBoxSale } from "../src/lib/estimate-email/send-ui";
import { bidderEmailDefaults, estimateEmailDefaults } from "../src/lib/estimate-email/compose";
import { packageViewModel } from "../src/lib/estimate-output/package-model";
import { boxSaleExtras } from "../src/lib/estimate-output/package-extras-model";
import PackageView from "../src/components/estimate-output/package-view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// (later tasks: imports above this line)
```

(b) Replace `// (later tasks: check functions above this line)` with

```ts
function sendPackageChecks(ok: Ok) {
  const start = composerInitial(null, null);
  ok(start.attachCover === true && withoutCoverForBoxSale(start, true).attachCover === false && withoutCoverForBoxSale(start, true).attachEstimate === true && withoutCoverForBoxSale(start, false) === start,
    "box sale send: the composer starts with the Estimate PDF ticked and the Cover PDF off");
  const mail = { projectName: "Gym", estimateNumber: "EST-1042", contactName: "Pat Lee", contactEmail: "pat@school.org", senderName: "Sam Mills", senderEmail: "sam@peak.com", leadName: "", leadEmail: "" };
  ok(estimateEmailDefaults({ ...mail, boxSale: true }).body === "Hi Pat,\n\nAttached is our quote for Gym (EST-1042).\n\nYou can also view it online here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills",
    "box sale send: the email says \"Attached is our quote … You can also view it online here: {link}\" — no full package, no alternates");
  ok(estimateEmailDefaults(mail).body === "Hi Pat,\n\nAttached is our estimate for Gym (EST-1042).\n\nYou can also view the full package online, and choose any alternates, here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills",
    "box sale send: a normal estimate's email is unchanged");
  ok(estimateEmailDefaults({ ...mail, boxSale: true }).subject === estimateEmailDefaults(mail).subject, "box sale send: the subject is unchanged");
  const bid = { projectName: "Gym", estimateNumber: "EST-1042", senderName: "Sam Mills" };
  ok(bidderEmailDefaults({ ...bid, boxSale: true }).body.includes("You can also view it online here: {link}") && !bidderEmailDefaults({ ...bid, boxSale: true }).body.includes("full package"),
    "box sale send: the bidder email drops \"full package\" too");
  ok(bidderEmailDefaults(bid).body === "Hello,\n\nAttached is our bid for Gym (EST-1042).\n\nYou can also view the full package online here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills",
    "box sale send: a normal bidder email is unchanged");

  const spec = { sections: [sys("s1", "Rigging", [line(1), line(9, { option: true, desc: "Spare clamp" })], { presentation: "narrative", narrative: "Intro.", clientGoals: "Safer flying." })], mobs: [], document: DOC };
  const doc = quoteDocumentDataFor(quoteFixture({ boxSale: true, spec }), null, SET);
  const plainDoc = quoteDocumentDataFor(quoteFixture({ spec }), null, SET);
  const input = {
    photos: {}, catalog: new Map(), frozen: { coverSummary: "Our summary.", notIncluded: "Electrical\nPermits" },
    state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never, headerLine: "EST-1 · Rev 1", currentHref: null, view: "narrative" as const, base: "/b", letterheadSrc: "/lh.jpg",
  };
  const boxM = packageViewModel({ ...input, doc, boxSale: true });
  const plainM = packageViewModel({ ...input, doc: plainDoc });
  ok(boxM.boxSale === true && boxM.view === "bom" && boxM.summary === "" && boxM.notIncluded.length === 0 && !("document" in boxM) &&
     boxM.scopes.every((s) => s.goals === "" && s.intro.length === 0 && s.keyProducts.length === 0 && s.fallback === null && s.bom.length > 0),
    "box sale package page: the itemized list only — BOM view, no summary, goals, narrative, key products, document or Not included");
  ok(boxM.options.length > 0 && boxM.options.length === plainM.options.length && boxM.totals.total === plainM.totals.total && boxM.total === plainM.total,
    "box sale package page: prices, totals and add options stay");
  ok(!("boxSale" in plainM) && plainM.summary === "Our summary." && plainM.notIncluded.length === 2 && plainM.view === "narrative",
    "box sale package page: a normal estimate's page model is unchanged");
  const html = (m: typeof boxM) => renderToStaticMarkup(createElement(PackageView, { model: m }));
  ok(!html(boxM).includes('aria-label="Estimate view"') && html(plainM).includes('aria-label="Estimate view"'), "box sale package page: no Overview / Itemized toggle");
  const extras = {
    datasheets: { "SKU-1": { href: "/d", name: "DS" } }, downloads: { zipHref: "/z", datasheetsPdfHref: null, files: [], specifications: false },
    plans: [{ href: "/p", name: "P", kindLabel: "Plan", sizeLabel: "1 KB", isImage: false }], actions: { scopes: [] },
  };
  const bx = boxSaleExtras(extras);
  ok(Object.keys(bx.datasheets).length === 0 && bx.downloads === null && bx.plans.length === 0 && bx.actions === extras.actions,
    "box sale package page: no datasheet links, downloads or plans; the client actions (options, alternates, question) stay");

  const comp = rd("src/app/(app)/estimator/steps/send-composer.tsx");
  ok(comp.includes("useState<ComposerFields>(() => withoutCoverForBoxSale(composerInitial(null, packageSelection), boxSale))") && /\{!boxSale && \(\s*<label[^>]*>\s*<input type="checkbox" checked=\{fields\.attachCover\}/.test(comp),
    "box sale send (source): the composer starts without the cover and never offers it");
  ok(rd("src/app/(app)/estimator/send-actions.ts").includes("      boxSale: boxSaleOf(q),\n") && rd("src/app/(app)/estimator/bid-send-actions.ts").includes("senderName: user.name, signature, boxSale: boxSaleOf(q) }),"),
    "box sale send (source): both email defaults read the saved estimate's flag");
  const pkgPage = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
  ok(pkgPage.includes("const box = revisionBoxSale(hit.rev);") && pkgPage.includes("const cut = box ? null : await onlineCutSheets(hit.q, hit.rev);") && pkgPage.includes("buildPackageSlots(box ? boxSaleExtras(extras) : extras, {"),
    "box sale package page (source): the client link drops cut sheets, datasheet links, downloads and plans — from the revision's frozen flag");
  const live = rd("src/lib/estimate-output/package-live-loader.ts");
  ok(rd("src/lib/estimate-output/package-loader.ts").includes("boxSale: revisionBoxSale(hit.rev),") && live.includes("boxSale: boxSaleOf(q),") && live.includes("boxSaleOf(q) ? staffPackageExtras(null, false, [], q.id) : liveExtras(q),"),
    "box sale package page (source): the client page and the staff preview both build the box-sale model");
  ok(["src/app/share/quote/[id]/[token]/package.zip/route.ts", "src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts"].every((f) => rd(f).includes("if (!pkg || revisionBoxSale(pkg.rev)) return notFound();")),
    "box sale package page (source): the zip and the datasheet book are a 404 for a box sale");
  ok(/\{!m\.boxSale && \(\s*<nav aria-label="Estimate view"/.test(rd("src/components/estimate-output/package-view.tsx")), "box sale package page (source): PackageView drops the toggle when the model says so");
}

// (later tasks: check functions above this line)
```

(c) Replace `  // (later tasks: pure checks above this line)` with

```ts
  sendPackageChecks(ok);
  // (later tasks: pure checks above this line)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: FAIL — the run stops with an error naming `withoutCoverForBoxSale` or `boxSaleExtras` (a missing export, or `… is not a function`), exit 1.

- [ ] **Step 3: Send defaults and the composer**

In `src/lib/estimate-email/send-ui.ts`, replace

```ts
    followUpDays: FOLLOW_UP_DEFAULT,
  };
}
```

with

```ts
    followUpDays: FOLLOW_UP_DEFAULT,
  };
}

/** Box goods sale (spec 2026-10-21): no Cover PDF — the composer starts (and stays) without it. Same object when off. */
export function withoutCoverForBoxSale(f: ComposerFields, boxSale: boolean): ComposerFields {
  return boxSale ? { ...f, attachCover: false } : f;
}
```

In `src/app/(app)/estimator/steps/send-composer.tsx`:

(a) Replace

```ts
  type SendNotice,
} from "@/lib/estimate-email/send-ui";
```

with

```ts
  type SendNotice,
  withoutCoverForBoxSale,
} from "@/lib/estimate-email/send-ui";
```

(b) Replace

```ts
  const { applySync, loadedId, next, packageSelection, pdfDirty, saveNow, selectionSettled, setActionError, setGateRefused, status, statusChanging, tierResolving } = s;
  // #333 (Q5): the PDF ticks start from Build package → Client package; the server defaults fill the rest.
  const [fields, setFields] = useState<ComposerFields>(() => composerInitial(null, packageSelection));
```

with

```ts
  const { applySync, boxSale, loadedId, next, packageSelection, pdfDirty, saveNow, selectionSettled, setActionError, setGateRefused, status, statusChanging, tierResolving } = s;
  // #333 (Q5): the PDF ticks start from Build package → Client package; the server defaults fill the rest.
  // Box goods sale: never a cover (the send action skips one too, whatever is posted).
  const [fields, setFields] = useState<ComposerFields>(() => withoutCoverForBoxSale(composerInitial(null, packageSelection), boxSale));
```

(c) Replace

```tsx
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={fields.attachCover} disabled={disabled} onChange={(e) => set("attachCover", e.target.checked)} />
              {SEND_UI_COPY.attachCover}
            </label>
```

with

```tsx
            {!boxSale && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={fields.attachCover} disabled={disabled} onChange={(e) => set("attachCover", e.target.checked)} />
              {SEND_UI_COPY.attachCover}
            </label>
            )}
```

- [ ] **Step 4: The email wording**

In `src/lib/estimate-email/compose.ts`:

(a) Replace

```ts
  /** The sender's #127 signature (lib/stores/signatures) — seeded below a
   *  "-- " line exactly as the Inbox composer seeds it; "" = none. */
  signature?: string;
};
```

with

```ts
  /** The sender's #127 signature (lib/stores/signatures) — seeded below a
   *  "-- " line exactly as the Inbox composer seeds it; "" = none. */
  signature?: string;
  /** Box goods sale (spec 2026-10-21): "Attached is our quote … You can also view it online here: {link}" —
   *  no "full package" or alternates wording. */
  boxSale?: boolean;
};
```

(b) Replace

```ts
    `Attached is our estimate${project ? ` for ${project}` : ""}${est ? ` (${est})` : ""}.`,
    "",
    `You can also view the full package online, and choose any alternates, here: ${LINK_TOKEN}`,
```

with

```ts
    `Attached is our ${i.boxSale ? "quote" : "estimate"}${project ? ` for ${project}` : ""}${est ? ` (${est})` : ""}.`,
    "",
    i.boxSale ? `You can also view it online here: ${LINK_TOKEN}` : `You can also view the full package online, and choose any alternates, here: ${LINK_TOKEN}`,
```

(c) Replace

```ts
export type BidderEmailDefaultsInput = { projectName: string; estimateNumber: string; senderName: string; signature?: string };
```

with

```ts
/** `boxSale` (spec 2026-10-21): the link line drops "the full package". */
export type BidderEmailDefaultsInput = { projectName: string; estimateNumber: string; senderName: string; signature?: string; boxSale?: boolean };
```

(d) Replace

```ts
    `You can also view the full package online here: ${LINK_TOKEN}`,
```

with

```ts
    i.boxSale ? `You can also view it online here: ${LINK_TOKEN}` : `You can also view the full package online here: ${LINK_TOKEN}`,
```

In `src/app/(app)/estimator/send-actions.ts`:

(a) After `import { can } from "@/lib/team";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
      leadEmail: lead && lead.id !== user.id ? (lead.email || "").trim() : "",
      signature,
    }),
```

with

```ts
      leadEmail: lead && lead.id !== user.id ? (lead.email || "").trim() : "",
      signature,
      // Box goods sale: the saved estimate's flag (Send saves first).
      boxSale: boxSaleOf(q),
    }),
```

In `src/app/(app)/estimator/bid-send-actions.ts`:

(a) After `import { can } from "@/lib/team";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
    ...bidderEmailDefaults({ projectName: q.name || "", estimateNumber: displayQuoteNumber(q), senderName: user.name, signature }),
```

with

```ts
    ...bidderEmailDefaults({ projectName: q.name || "", estimateNumber: displayQuoteNumber(q), senderName: user.name, signature, boxSale: boxSaleOf(q) }),
```

- [ ] **Step 5: The package page model and view**

In `src/lib/estimate-output/package-model.ts`:

(a) Replace

```ts
   *  scope cards (the BOM view is unchanged). */
  document?: ResolvedPackageDoc;
};
```

with

```ts
   *  scope cards (the BOM view is unchanged). */
  document?: ResolvedPackageDoc;
  /** Box goods sale (spec 2026-10-21) — the itemized list only; PackageView drops the Overview / Itemized toggle.
   *  Absent on every other estimate (its props stay byte-identical). */
  boxSale?: true;
};
```

(b) Replace

```ts
  /** #348 2b-ii — a bidder's v3 link whose bid is no longer live: the banner reads "This bid is closed." */
  bidClosed?: boolean;
};
```

with

```ts
  /** #348 2b-ii — a bidder's v3 link whose bid is no longer live: the banner reads "This bid is closed." */
  bidClosed?: boolean;
  /** Box goods sale (spec 2026-10-21) — the revision's (or live quote's) flag; the page becomes the itemized list. */
  boxSale?: boolean;
};
```

(c) Replace

```ts
  const owner = ownerNameFromLine(d.ownerLine);
  return {
    // #331: the package page always prints the full baked Peak letterhead, never the Branding logo.
```

with

```ts
  const owner = ownerNameFromLine(d.ownerLine);
  const model: PackageViewProps = {
    // #331: the package page always prints the full baked Peak letterhead, never the Branding logo.
```

(d) Replace

```ts
      ? { document: resolvePackageDoc(d.document, { sections: d.sections, t: d.t, quoteId: d.quoteId, taxRatePct: d.taxRatePct, totalLabel: t.totalLabel, photos: i.photos, models: i.models }) }
      : {}),
  };
}
```

with

```ts
      ? { document: resolvePackageDoc(d.document, { sections: d.sections, t: d.t, quoteId: d.quoteId, taxRatePct: d.taxRatePct, totalLabel: t.totalLabel, photos: i.photos, models: i.models }) }
      : {}),
  };
  return i.boxSale === true ? boxSalePackageView(model) : model;
}

/** Box goods sale (spec 2026-10-21) — the package page is the itemized list only: the BOM view with no summary,
 *  goals, narrative, key products, package document or Not included. Prices, totals, add options and alternates
 *  stay (the client actions are the slots' — package-page.tsx). Pure. */
export function boxSalePackageView(m: PackageViewProps): PackageViewProps {
  const out: PackageViewProps = {
    ...m,
    boxSale: true,
    view: "bom",
    summary: "",
    notIncluded: [],
    scopes: m.scopes.map((s) => ({ ...s, goals: "", intro: [], keyProducts: [], fallback: null })),
  };
  delete out.document;
  return out;
}
```

In `src/components/estimate-output/package-view.tsx`, replace

```tsx
      <nav aria-label="Estimate view" className="pkg-toggle pk-no-print">
        <a href={m.narrativeHref} aria-current={!bom ? "page" : undefined}>
          {PACKAGE_COPY.narrative}
        </a>
        <a href={m.bomHref} aria-current={bom ? "page" : undefined}>
          {PACKAGE_COPY.bom}
        </a>
      </nav>
```

with

```tsx
      {/* Box goods sale (spec 2026-10-21): the itemized list only — no Overview / Itemized toggle. */}
      {!m.boxSale && (
      <nav aria-label="Estimate view" className="pkg-toggle pk-no-print">
        <a href={m.narrativeHref} aria-current={!bom ? "page" : undefined}>
          {PACKAGE_COPY.narrative}
        </a>
        <a href={m.bomHref} aria-current={bom ? "page" : undefined}>
          {PACKAGE_COPY.bom}
        </a>
      </nav>
      )}
```

In `src/lib/estimate-output/package-extras-model.ts`, replace

```ts
export const EMPTY_EXTRAS: PackageExtras = { datasheets: {}, downloads: null, plans: [], actions: null };
```

with

```ts
export const EMPTY_EXTRAS: PackageExtras = { datasheets: {}, downloads: null, plans: [], actions: null };

/** Box goods sale (spec 2026-10-21) — the itemized list only: no datasheet links, downloads or plans; the client
 *  actions (choose options / alternates, ask a question) stay. Pure. */
export function boxSaleExtras(x: PackageExtras): PackageExtras {
  return { datasheets: {}, downloads: null, plans: [], actions: x.actions };
}
```

- [ ] **Step 6: The client link, the staff preview and the share routes**

In `src/app/share/quote/[id]/[token]/package-page.tsx`:

(a) After `import { OnlineCutSheets } from "@/components/cutsheets/online-cut-sheets";` add:

```ts
import { revisionBoxSale } from "@/lib/estimate-box-sale/rules";
import { boxSaleExtras } from "@/lib/estimate-output/package-extras-model";
```

(b) Replace

```ts
  // Jeff 2026-10-15 #22: the cut sheets the sent PDF carries (owner-addressed, like the PDF's own).
  const cut = await onlineCutSheets(hit.q, hit.rev);
  const built = buildPackageSlots(await loadPackageExtras(hit, base), {
```

with

```ts
  // Box goods sale (spec 2026-10-21): the itemized list only — no cut sheets, datasheet links, downloads or plans;
  // the client actions stay. The revision's frozen flag, like the document's.
  const box = revisionBoxSale(hit.rev);
  // Jeff 2026-10-15 #22: the cut sheets the sent PDF carries (owner-addressed, like the PDF's own).
  const cut = box ? null : await onlineCutSheets(hit.q, hit.rev);
  const extras = await loadPackageExtras(hit, base);
  const built = buildPackageSlots(box ? boxSaleExtras(extras) : extras, {
```

In `src/lib/estimate-output/package-loader.ts`:

(a) After `import { packageFrozenFields, packagePhotoSections, packageViewModel, type PackageViewProps } from "./package-model";` add:

```ts
import { revisionBoxSale } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
    letterheadSrc: opts.letterheadSrc,
  });
```

with

```ts
    letterheadSrc: opts.letterheadSrc,
    // Box goods sale (spec 2026-10-21): the revision's frozen flag.
    boxSale: revisionBoxSale(hit.rev),
  });
```

In `src/lib/estimate-output/package-live-loader.ts`:

(a) After `import { previewHeaderLine, previewPath, staffPackageExtras, staffPartDocHref, type StaffPackageExtras } from "./package-preview";` add:

```ts
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
    liveExtras(q),
  ]);
```

with

```ts
    // Box goods sale (spec 2026-10-21): no datasheets, downloads or plans to read.
    boxSaleOf(q) ? staffPackageExtras(null, false, [], q.id) : liveExtras(q),
  ]);
```

(c) Replace

```ts
    letterheadSrc: opts.letterheadSrc,
  });
```

with

```ts
    letterheadSrc: opts.letterheadSrc,
    boxSale: boxSaleOf(q),
  });
```

In `src/app/share/quote/[id]/[token]/package.zip/route.ts` **and** `src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts` (each file):

(a) After `import { isPackageToken } from "@/lib/quote-share/token";` add:

```ts
import { revisionBoxSale } from "@/lib/estimate-box-sale/rules";
```

(b) Replace

```ts
  if (!pkg) return notFound();
```

with

```ts
  // Box goods sale (spec 2026-10-21): no downloads — the page offers none.
  if (!pkg || revisionBoxSale(pkg.rev)) return notFound();
```

- [ ] **Step 7: Run the checks**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: `80 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

- [ ] **Step 8: Type-check, lint, full harness**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | head -20
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint src/lib/estimate-email/send-ui.ts "src/app/(app)/estimator/steps/send-composer.tsx" src/lib/estimate-email/compose.ts "src/app/(app)/estimator/send-actions.ts" "src/app/(app)/estimator/bid-send-actions.ts" src/lib/estimate-output/package-model.ts src/components/estimate-output/package-view.tsx src/lib/estimate-output/package-extras-model.ts "src/app/share/quote/[id]/[token]/package-page.tsx" src/lib/estimate-output/package-loader.ts src/lib/estimate-output/package-live-loader.ts "src/app/share/quote/[id]/[token]/package.zip/route.ts" "src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts"
ps aux | grep -c "[t]sx"
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -E "^FAIL" "$OUT" | head -20; rm -f "$OUT"
```

Expected: no tsc or eslint output; `0`; `ALL PASSED`, empty FAIL listing — including `#P3 send UI` (`...composerInitial(r)`, `const input = { ...fields, asOf };`), `#333 composer` (`composerInitial(null, packageSelection)`), `#301 purity` (package-model.ts gained no value import), `oct15 #22` (`await onlineCutSheets(hit.q, hit.rev)`) and `bid-send: bidder body default`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/estimate-email/send-ui.ts "src/app/(app)/estimator/steps/send-composer.tsx" src/lib/estimate-email/compose.ts "src/app/(app)/estimator/send-actions.ts" "src/app/(app)/estimator/bid-send-actions.ts" src/lib/estimate-output/package-model.ts src/components/estimate-output/package-view.tsx src/lib/estimate-output/package-extras-model.ts "src/app/share/quote/[id]/[token]/package-page.tsx" src/lib/estimate-output/package-loader.ts src/lib/estimate-output/package-live-loader.ts "src/app/share/quote/[id]/[token]/package.zip/route.ts" "src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts" scripts/test-box-sale.ts
git commit -m "feat(estimator): box goods sale send + client link — no cover, quote wording, itemized-only package page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The + New quote "Box goods sale" card

**Files:**
- Modify: `src/app/(app)/quotes/new/types.ts` (`ServiceType` :7-14, `SERVICE_TYPES` :30-40, `BUILDER_BASE` :102-110, `builderPath` :130-145)
- Modify: `src/app/(app)/quotes/new/handoff.ts` (`Handoff` :10-29, `readHandoff` :42-55, `quoteServiceType` / `quoteEditPath` :120-128)
- Modify: `src/app/(app)/quotes/new/actions.ts:139-153`
- Modify: `src/lib/gmail/linking.ts:350-367, 488-500`
- Modify: `src/app/(app)/estimator/page.tsx:508`
- Modify: `scripts/test-box-sale.ts`

**Interfaces:**
- Consumes: `BOX_SALE_COPY` (Task 3 — copied as literals into `types.ts`, which must stay import-free, and pinned equal by the test); `InitialQuote.boxSale` (Task 1); `buildQuote`'s system-only rule (Task 1).
- Produces: `ServiceType` gains `"box_sale"`; `Handoff.boxSale: boolean`; `LinkThreadToNewQuoteInput.boxSale?: boolean`; `quoteServiceType(q: { quoteType?; category?; boxSale? })`.

- [ ] **Step 1: Add the Task 6 checks**

In `scripts/test-box-sale.ts`:

(a) Replace `// (later tasks: imports above this line)` with

```ts
import { BUILDER_BASE, builderPath, isServiceType, SERVICE_TYPES } from "../src/app/(app)/quotes/new/types";
import { quoteEditPath, quoteServiceType, readHandoff, sameBuilder } from "../src/app/(app)/quotes/new/handoff";
// (later tasks: imports above this line)
```

(b) Replace `// (later tasks: check functions above this line)` with

```ts
function intakeChecks(ok: Ok) {
  const card = SERVICE_TYPES.find((t) => t.key === "box_sale");
  ok(!!card && card.label === BOX_SALE_COPY.label && card.sub === BOX_SALE_COPY.cardSub && SERVICE_TYPES[1]?.key === "box_sale" && isServiceType("box_sale"),
    "box sale intake: + New quote has a Box goods sale card, right after System / equipment quote");
  ok(BUILDER_BASE.box_sale === "/estimator" && builderPath("box_sale", "c1") === "/estimator?customer=c1&box=1" && !new URLSearchParams(builderPath("system", "c1").split("?")[1]).has("box"),
    "box sale intake: the card opens the Estimator with ?box=1 (a system quote never carries it)");
  ok(readHandoff({ box: "1" }).boxSale === true && readHandoff({}).boxSale === false && readHandoff({ box: "yes" }).boxSale === false, "box sale intake: the Estimator reads ?box=1 and nothing else");
  ok(quoteServiceType({ quoteType: "system", boxSale: true }) === "box_sale" && quoteServiceType({ boxSale: true, category: "Gear" }) === "box_sale" && quoteServiceType({ quoteType: "repair", boxSale: true }) === "repair" &&
     quoteEditPath({ id: "Q-1", boxSale: true }) === "/estimator?id=Q-1" && sameBuilder("box_sale", "system"),
    "box sale intake: a stored box sale reads as the Box goods sale card and edits in the Estimator (switching it to System is not a replace)");
  const act = rd("src/app/(app)/quotes/new/actions.ts");
  ok(act.includes('quoteType: input.type === "custom" || input.type === "box_sale" ? "system" : input.type,') && act.includes('...(input.type === "box_sale" ? { boxSale: true } : {}),'),
    "box sale intake (source): a draft minted from an Inbox thread is a system quote with the flag");
  const link = rd("src/lib/gmail/linking.ts");
  ok(link.includes("...(input.boxSale === true ? { boxSale: true } : {}),") && /boxSale\?: boolean;/.test(link), "box sale intake (source): linkThreadToNewQuote passes the flag to create");
  ok(rd("src/app/(app)/estimator/page.tsx").includes("if (!q && handoff?.boxSale) initial.boxSale = true;"), "box sale intake (source): a new estimate opened with ?box=1 starts with the switch on");
}

// (later tasks: check functions above this line)
```

(c) Replace `  // (later tasks: pure checks above this line)` with

```ts
  intakeChecks(ok);
  // (later tasks: pure checks above this line)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: FAIL — seven `FAIL box sale intake …` lines, `80 PASS, 7 FAIL`.

- [ ] **Step 3: The card and its builder path**

In `src/app/(app)/quotes/new/types.ts`:

(a) Replace

```ts
export type ServiceType =
  | "system"
```

with

```ts
export type ServiceType =
  | "system"
  | "box_sale"
```

(b) Replace

```ts
    key: "system",
    label: "System / equipment quote",
    sub: "Full line-item estimator",
    badge: null,
    badgeInk: "",
    badgeSoft: "",
    badgeBd: "",
  },
```

with

```ts
    key: "system",
    label: "System / equipment quote",
    sub: "Full line-item estimator",
    badge: null,
    badgeInk: "",
    badgeSoft: "",
    badgeBd: "",
  },
  {
    // Box goods sale (spec 2026-10-21): an Estimator system estimate with the switch on (BOX_SALE_COPY —
    // copied, this file stays import-free; the harness pins the two equal).
    key: "box_sale",
    label: "Box goods sale",
    sub: "Equipment + freight only — the customer gets the itemized BOM",
    badge: null,
    badgeInk: "",
    badgeSoft: "",
    badgeBd: "",
  },
```

(c) Replace

```ts
  system: "/estimator",
  custom: "/estimator",
```

with

```ts
  system: "/estimator",
  box_sale: "/estimator",
  custom: "/estimator",
```

(d) Replace

```ts
  put("customer", customerId);
  if (type === "custom") put("category", opts.category);
```

with

```ts
  put("customer", customerId);
  // Box goods sale: the Estimator opens a new estimate with the switch on.
  if (type === "box_sale") p.set("box", "1");
  if (type === "custom") put("category", opts.category);
```

- [ ] **Step 4: The hand-off**

In `src/app/(app)/quotes/new/handoff.ts`:

(a) Replace

```ts
  /** The `ES-…` suggestion the Estimator opens beside the estimate; "" when
   *  absent or malformed. */
  suggestionId: string;
};
```

with

```ts
  /** The `ES-…` suggestion the Estimator opens beside the estimate; "" when
   *  absent or malformed. */
  suggestionId: string;
  /** Box goods sale (spec 2026-10-21) — `?box=1` from the + New quote card; a new estimate only. */
  boxSale: boolean;
};
```

(b) Replace

```ts
    suggestionId: matchOrBlank(first(sp.suggestion), HANDOFF_SUGGESTION_RE),
  };
```

with

```ts
    suggestionId: matchOrBlank(first(sp.suggestion), HANDOFF_SUGGESTION_RE),
    boxSale: first(sp.box) === "1",
  };
```

(c) Replace

```ts
export function quoteServiceType(q: { quoteType?: string; category?: string }): ServiceType {
  const t = q.quoteType || "";
  if (t && t !== "system" && t !== "custom" && isServiceType(t)) return t;
  return (q.category || "").trim() ? "custom" : "system";
}

export function quoteEditPath(q: { id: string; quoteType?: string; category?: string }): string {
```

with

```ts
export function quoteServiceType(q: { quoteType?: string; category?: string; boxSale?: boolean }): ServiceType {
  const t = q.quoteType || "";
  if (t && t !== "system" && t !== "custom" && isServiceType(t)) return t;
  // Box goods sale (spec 2026-10-21): a system estimate with the flag is the Box goods sale card.
  if (q.boxSale === true) return "box_sale";
  return (q.category || "").trim() ? "custom" : "system";
}

export function quoteEditPath(q: { id: string; quoteType?: string; category?: string; boxSale?: boolean }): string {
```

In `src/app/(app)/estimator/page.tsx`, replace

```ts
  if (!q) initial.leadId = handoff?.leadId || (suggSameCustomer ? sugg?.leadId : null) || null;
```

with

```ts
  if (!q) initial.leadId = handoff?.leadId || (suggSameCustomer ? sugg?.leadId : null) || null;
  // Box goods sale (spec 2026-10-21): the + New quote card (?box=1) opens a new estimate with the switch on.
  if (!q && handoff?.boxSale) initial.boxSale = true;
```

- [ ] **Step 5: The Inbox-thread intake mints a system quote with the flag**

In `src/app/(app)/quotes/new/actions.ts`, replace

```ts
        quoteType: input.type === "custom" ? "system" : input.type,
        category: input.type === "custom" ? category : "",
        owner: me.name,
        name: input.name,
      },
```

with

```ts
        quoteType: input.type === "custom" || input.type === "box_sale" ? "system" : input.type,
        category: input.type === "custom" ? category : "",
        owner: me.name,
        name: input.name,
        // Box goods sale (spec 2026-10-21): a system quote with the flag, never a "box_sale" quoteType.
        ...(input.type === "box_sale" ? { boxSale: true } : {}),
      },
```

In `src/lib/gmail/linking.ts`:

(a) Replace

```ts
  /** the intake's optional "Quote name" field; falls back to the thread
   *  subject (Re:/Fwd: stripped) when blank. */
  name?: string;
};
```

with

```ts
  /** the intake's optional "Quote name" field; falls back to the thread
   *  subject (Re:/Fwd: stripped) when blank. */
  name?: string;
  /** Box goods sale (spec 2026-10-21) — the + New quote card; buildQuote keeps it on a system quote only. */
  boxSale?: boolean;
};
```

(b) Replace

```ts
    ...(leadId ? { leadId } : {}),
    ...typeFields,
  });
```

with

```ts
    ...(leadId ? { leadId } : {}),
    ...typeFields,
    ...(input.boxSale === true ? { boxSale: true } : {}),
  });
```

- [ ] **Step 6: Run the checks**

Run: `export PATH="$HOME/.local/node/bin:$PATH" && npx tsx scripts/test-box-sale.ts`
Expected: `87 PASS, 0 FAIL (pure only — set PGLITE_PATH for the DB half)`

Run: `export PATH="$HOME/.local/node/bin:$PATH" && TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-box-sale.ts; rm -rf "$TEST_DB"`
Expected: `99 PASS, 0 FAIL`

- [ ] **Step 7: Type-check, lint, full harness**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | head -20
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint "src/app/(app)/quotes/new/types.ts" "src/app/(app)/quotes/new/handoff.ts" "src/app/(app)/quotes/new/actions.ts" src/lib/gmail/linking.ts "src/app/(app)/estimator/page.tsx"
ps aux | grep -c "[t]sx"
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -E "^FAIL" "$OUT" | head -20; rm -f "$OUT"
```

Expected: no tsc or eslint output; `0`; `ALL PASSED`, empty FAIL listing — the `#160 builderPath(box_sale)` loop lines included (it targets `/estimator`, carries customer/name/venue/contact/replaces and no category).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/quotes/new/types.ts" "src/app/(app)/quotes/new/handoff.ts" "src/app/(app)/quotes/new/actions.ts" src/lib/gmail/linking.ts "src/app/(app)/estimator/page.tsx" scripts/test-box-sale.ts
git commit -m "feat(quotes): + New quote → Box goods sale card opens the Estimator with the switch on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, the full gate and the Chrome check

**Files:**
- Modify: `DECISIONS.md` (append two entries)
- Modify: `PUNCHLIST.md` (append one item)
- Modify: `AGENTS.md` (phase 66, after phase 65 ~:1614)

**Interfaces:**
- Consumes: Tasks 1–6, committed.
- Produces: nothing code-facing.

- [ ] **Step 1: Pick the numbers right before writing**

Other sessions write these files, so recompute against the worktree, `origin/main` and every `feat/*` branch, and take the max (use `"${ref}:FILE"` — in zsh, a bare `$ref:P` is a path modifier):

```bash
git fetch -q origin && git log --oneline -1 origin/main
for ref in HEAD origin/main $(git for-each-ref --format='%(refname:short)' refs/heads/feat refs/remotes/origin/feat); do git show "${ref}:DECISIONS.md" 2>/dev/null | grep -E '^## D[0-9]+\.' | sed -E 's/^## D([0-9]+)\..*/\1/'; done | sort -n | tail -1
for ref in HEAD origin/main $(git for-each-ref --format='%(refname:short)' refs/heads/feat refs/remotes/origin/feat); do git show "${ref}:PUNCHLIST.md" 2>/dev/null | grep -E '^## [0-9]+\.' | sed -E 's/^## ([0-9]+)\..*/\1/'; done | sort -n | tail -1
grep -E '^[0-9]+\. ' AGENTS.md | tail -1 | cut -c1-12
```

D = (the D max) + 1 for the flag entry, D + 1 for the labor entry; punch # = (the punch max) + 1; phase = (the last AGENTS.md phase) + 1. At plan time these were D1246, D1247, #362 and phase 66 (`feat/estimator-handoff-prototype` already holds D1233–D1245 and #361). Below they're `D<N>`, `D<N+1>`, `#<P>`, `<K>` — substitute the real numbers everywhere.

- [ ] **Step 2: Append the DECISIONS.md entries**

Append at the end of `DECISIONS.md`:

```markdown
## D<N>. Box goods sale: one flag on the estimate, nothing deleted (#<P>, 2026-10-21)

Jeff: some estimates are box goods sales — equipment and freight only, no install — and the customer should get the itemized BOM, not the narrative package. It is a flag, not a builder or quote type: `Quote.boxSale` (absent = false; stored only as `true` on an Estimator system estimate — `buildQuote` and `update()` drop it on any other quote type and `update()` removes the key on false). It is set from + New quote → **Box goods sale** (`?box=1`; the Inbox-thread intake mints a system quote with the flag) or the switch in Quote details, and shown as a header chip. Save carries it (an older caller keeps the stored flag); it is content (`QUOTE_CONTENT_FIELDS`, so a toggle stales the PDF) and frozen in a sent revision's `docFields` (`quoteAsOfRevision` reads the revision's own flag; a revision cut before the field reads false). One document rule: `quoteDocumentDataFor` returns `bomViewProps(props)` for a box sale, so the print route, portal, share pages, staff preview and bidder copies all follow; Qty and prices follow the quote's own PDF choices (bomViewProps's rule, Jeff 2026-10-15 #14). The print route prints #360's BOM layout (`layout="web"`, no title page, the investment band kept) with no cut sheets, datasheet-links page or photos, and the generator merges no drawings. The Cover PDF and its print page are a 404 (`renderSignedQuotePrintPdf`'s new `refuse`), and the send never attaches one. The client package page is the itemized list only: no Overview / Itemized toggle, summary, goals, key products, package document, Not included, Plans & risers, downloads or datasheet links (the zip and datasheet-book routes 404); options, alternates, client actions and Accept stay. The Estimator hides + Configure labor, the Customer chip, Discipline, Add narrative…, ★ key product and Draft from survey/inspection; new systems (fresh, blank, category, suggested) are Itemized, and From library keeps its own presentation (it prints itemized anyway). Build package is BOM quote only, with Lead estimator / Prepared by; Customer review is Document + BOM without the package checklist; readiness and package gap chips are quiet. The email says "Attached is our quote … You can also view it online here: {link}" (the subject is unchanged; the bidder email's link line drops "full package" too). Move / Copy system → New estimate copies the stored source's flag; into an existing estimate it leaves the target's alone. Nothing narrative is deleted, so switching off brings it all back. The 2% estimator bonus is unchanged. No migration (quotes are a JSONB doc table). `src/lib/estimate-box-sale/rules.ts`; spec `docs/superpowers/specs/2026-10-21-box-goods-sale-design.md`; harness `box sale` (`scripts/test-box-sale.ts`).

## D<N+1>. A box goods sale refuses labor on save (#<P>, 2026-10-21)

Labor is any line with `labor`, `laborOverhead` or `laborTravel` set (mobilization and travel included), or any `kind: "labor"` system; the automatic bonus lines never count (the 2% estimator bonus stays, and the server re-derives the 5% package bonus, which needs labor). `saveQuoteAction` refuses a box sale with labor before the Rewards credit or any write, with "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale." and no id, so nothing is partially written; the Estimator refuses the same way without sending. Turning the switch on while labor exists is allowed: a Build banner repeats the sentence and names the systems with labor, and Save stays refused until it's resolved. Nothing is removed automatically. A Move / Copy into a new estimate can carry labor into a box sale; its next save refuses.
```

- [ ] **Step 3: Append the PUNCHLIST.md item**

Read the last item in `PUNCHLIST.md` (`## 360. …` on `main`) and copy its layout. Append:

```markdown
## <P>. Box goods sale — BOM-only estimates — DONE 2026-10-21 on `feat/box-goods-sale` (D<N>–D<N+1>)

Jeff: some estimates are box goods sales (equipment + freight, no install); the customer gets the itemized BOM. Spec `docs/superpowers/specs/2026-10-21-box-goods-sale-design.md`; plan `docs/superpowers/plans/2026-10-21-box-goods-sale.md`.

**Built:** + New quote → Box goods sale card and a Quote details switch (system estimates only) with a header chip. A box sale's estimate PDF is the BOM quote PDF's layout (no title page, cut sheets, datasheet links or drawings), there is no Cover PDF, the email says "Attached is our quote … You can also view it online here: {link}", and the client link opens the itemized list only (no toggle, summary, goals, Not included, plans, downloads or datasheet links; options, alternates, questions and Accept still work). The Estimator hides the narrative/labor controls, adds systems Itemized, shows Build package → BOM quote only and Customer review → Document + BOM. A save with any labor line is refused with "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale." Turning it off brings everything back; nothing is deleted.

**Gates:** tsc <E> errors (`.next` deleted first); test:specs <SPASS> PASS / <SFAIL> FAIL (includes the `box sale` harness block); test:smoke <MPASS> PASS / <MFAIL> FAIL (`.next` deleted, run alone); eslint <L> problems on the changed src files (`scripts/test-review-and-spec.ts` excluded, #357). Chrome: <CHROME>.

**Rollback:** safe. One optional JSON key (`boxSale`) on quotes and on new revisions' docFields. A build without this feature ignores it and prints those estimates as normal estimates — their narrative fields were never deleted.

**Remaining (Jeff-gated):**
- On production after merge: make one real box goods sale estimate (+ New quote → Box goods sale), add equipment and freight, send it to yourself, and check the PDF (one BOM page, no cover), the email wording and the client link (itemized list only).
- Decide whether the email subject should say "quote" instead of "estimate" for a box sale (left unchanged).
```

`<E>`, `<SPASS>`, `<SFAIL>`, `<MPASS>`, `<MFAIL>` and `<L>` are the real numbers from Step 5, and `<CHROME>` is Step 6's one-line result ("1 page, Total investment band, no title page" or the 503 message). Substitute them, like `D<N>` / `#<P>`, before the Step 7 commit.

- [ ] **Step 4: Add the AGENTS.md phase line**

In `AGENTS.md`, replace

```markdown
    production, and a long cover note. Punch item #358.

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
```

with

```markdown
    production, and a long cover note. Punch item #358.

<K>. ✅ **Box goods sale** (#<P>, D<N>–D<N+1>) — an Estimator system estimate can be a box goods
    sale (equipment + freight only): `Quote.boxSale` (absent = false; true on system estimates only),
    set from + New quote → Box goods sale (`?box=1`) or the Quote details switch, shown as a header
    chip. Pure rules in `src/lib/estimate-box-sale/rules.ts`. Content and frozen in revision
    docFields; `quoteDocumentDataFor` returns `bomViewProps` for it (one seam), the print route prints
    #360's BOM layout with no cut sheets / links / drawings, the Cover PDF 404s and is never attached,
    and the client package page is the itemized list only (zip / datasheet book 404). Build hides the
    narrative and labor controls and adds systems Itemized; Build package is BOM quote only; Customer
    review is Document + BOM; readiness is quiet; the email says "Attached is our quote … You can also
    view it online here: {link}". A save with any labor line is refused (server and browser). Nothing
    narrative is deleted — switching off restores it. No migration. Remaining is Jeff-gated: one real
    box-sale estimate sent to himself on production. Punch item #<P>.

QUESTIONS.md is the standing agenda for Jeff; DECISIONS.md logs defaults
```

- [ ] **Step 5: Run the full gate and record real numbers**

```bash
ps aux | grep -E "[t]sx|[n]ext dev"
export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p . 2>&1 | tail -3
export PATH="$HOME/.local/node/bin:$PATH" && OUT=$(mktemp) && npm run test:specs 2>&1 | tee "$OUT" | tail -3; grep -c "^PASS" "$OUT"; grep -c "^FAIL" "$OUT"; rm -f "$OUT"
rm -rf .next && export PATH="$HOME/.local/node/bin:$PATH" && npm run test:smoke 2>&1 | tail -5
export PATH="$HOME/.local/node/bin:$PATH" && npx eslint src/lib/estimate-box-sale/rules.ts src/lib/stores/quotes.ts src/lib/quote-share/view.ts src/lib/quote-pdf/quote-document-data.ts "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" "src/app/print/quote/[id]/page.tsx" src/lib/quote-pdf/generate.ts src/lib/quote-pdf/signed-print-pdf.ts src/lib/estimate-output/cover-pdf-server.ts "src/app/print/cover/[id]/page.tsx" src/lib/estimate-email/send-server.ts "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/pdf-doc-key.ts" "src/app/(app)/estimator/estimator-header.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/steps/build-step.tsx" "src/app/(app)/estimator/header-more-menu.tsx" src/lib/estimate-steps/package-tabs.ts "src/app/(app)/estimator/steps/package-step.tsx" "src/app/(app)/estimator/steps/package-bom-tab.tsx" src/lib/estimate-review/review-ui.ts "src/app/(app)/estimator/steps/review-tabs.tsx" "src/app/(app)/estimator/steps/review-sidebar.tsx" src/lib/estimate-steps/readiness.ts "src/app/(app)/estimator/estimator-client.tsx" src/lib/estimate-output/package-panel-server.ts src/lib/estimate-email/send-ui.ts "src/app/(app)/estimator/steps/send-composer.tsx" src/lib/estimate-email/compose.ts "src/app/(app)/estimator/send-actions.ts" "src/app/(app)/estimator/bid-send-actions.ts" src/lib/estimate-output/package-model.ts src/components/estimate-output/package-view.tsx src/lib/estimate-output/package-extras-model.ts "src/app/share/quote/[id]/[token]/package-page.tsx" src/lib/estimate-output/package-loader.ts src/lib/estimate-output/package-live-loader.ts "src/app/share/quote/[id]/[token]/package.zip/route.ts" "src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts" "src/app/(app)/quotes/new/types.ts" "src/app/(app)/quotes/new/handoff.ts" "src/app/(app)/quotes/new/actions.ts" src/lib/gmail/linking.ts
```

Expected:
- The first command prints nothing (no stray tsx / next dev).
- tsc prints nothing (0 errors), or only errors that also exist on `origin/main` (check against a clean `git worktree`, never `git stash`).
- `test:specs` ends `ALL PASSED`; FAIL count `0` (or only failures that already fail on `origin/main`, noted with their messages).
- smoke reports 0 failures (it starts its own server — run it alone).
- eslint prints nothing.

Report the real PASS / FAIL counts, not "all green". No smoke entry is added: every route this changes already has a GET smoke entry (`/print/quote/…`, `/api/quotes/Q-0/cover-pdf`, `/api/quotes/Q-0/bom-pdf`), and the new behaviour needs a box-sale quote, which smoke can't create.

- [ ] **Step 6 (controller): Chrome render of one box-sale PDF on a scratch DB**

The controller does this step, not the implementer (it needs the browser and a dev server). Outline:

1. `ps aux | grep -E "[t]sx|[n]ext dev"` is empty; `SCRATCH=$(mktemp -d)`.
2. Start the dev server from this worktree on the scratch datadir and its own port: `export PATH="$HOME/.local/node/bin:$PATH" && PGLITE_PATH="$SCRATCH" npx next dev -p 3100` (background). It auto-migrates and auto-seeds the scratch DB; the real `.data/` is never opened. Don't click any upload (the dev server loads the real Blob token).
3. Sign in with the dev login. Open `/quotes/new`, pick **Box goods sale**, a seeded customer, Continue. Confirm the Estimator opens with the **Box goods sale** chip and the Quote details switch on, and the system card has no + Configure labor, Customer chip, Discipline, Add narrative… or ★.
4. Add one catalog part, Save. Then check the labor rule: turn the switch off, use the system's **+ Configure labor** to add a labor line, turn the switch back on — the Build banner names the system and Save shows "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale." with nothing saved. Remove the labor line(s) and Save.
5. Wait for the PDF (Customer review → Document), then download `/api/quotes/<id>/pdf`. Check with pypdf: exactly 1 page, the text contains `Total investment`, and page 1 is not a title page (it carries the itemized lines). Screenshot the Document tab as proof.
6. Turn the switch off, Save, and confirm Build package shows Narrative · BOM quote · Client package again.
7. Stop the server and confirm no `next dev` remains; `rm -rf "$SCRATCH"`.

If the render answers 503 (no local Chrome / print origin), record the message — an environment gap, not a code failure — and check `/print/quote/<id>` without a token is still a 404.

Put the result (page count, band found, title page absent, or the 503 message) into the PUNCHLIST item's `<CHROME>` slot from Step 3.

- [ ] **Step 7: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs: D<N>–D<N+1> / #<P> — box goods sale" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan

- No push and no PR. Pushing to `origin/main` is Jeff's call after review.
- The per-datasheet route `/share/quote/[id]/[token]/doc/[docId]` is left as is: a box sale's page links no datasheets, and the route already serves only documents the revision's own coverage names.
- The v1 online estimate (#293) and the portal estimate page need no change: their Overview / Itemized toggle is shown only when `offersBomView` finds an un-itemized system, and a box sale's document is fully itemized with no package document.
- The Quotes hub gets no Box goods sale badge (not in the spec).
- The send composer's email defaults follow the **saved** estimate (`estimateEmailDefaultsAction` reads the stored quote when the composer mounts). Send saves first, and the server skips the cover from the saved flag, so a toggle made just before sending is still honoured on the attachments.
