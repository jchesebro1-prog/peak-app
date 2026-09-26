# Estimate numbers: one shared counter, a prefix per type (#223) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every quote and lead gets an estimate number (`FLM-1002`, `EST-1005-2`, `OPP-1005`) from one shared Postgres sequence. Existing records are renumbered from 1001 in date order, and that number is what people see, search and print. Internal ids (`Q-2041`, `L-1050`, `Q-dl-…`) stay the keys and stay in URLs.

**Architecture:** A pure module (`src/lib/estimate-number.ts`) owns the prefix map, formatting, parsing, display fallback and search matching. It is safe in `"use client"` files. One migration creates `estimate_number_seq`, a few small indexes, and a PL/pgSQL function `assign_estimate_numbers()` that numbers every quote and lead still without an `estNo`. It works in date order, carries a lead's number to its quotes, and assigns suffixes under an advisory lock. The migration calls that function once to backfill, then runs `setval`. New records use the same function. `src/lib/stores/estimate-numbers.ts` wraps it, and every quote/lead creation path calls the wrapper right after inserting. The display sweep then routes every human-facing id through `displayQuoteNumber` / `displayLeadNumber`.

**Tech Stack:** Next.js 16 App Router (server components, `"use server"` actions, client components), TypeScript, Drizzle ORM on Postgres (Neon) / PGlite (dev + tests), JSONB doc tables (`src/db/doc-tables.ts`), the `scripts/test-review-and-spec.ts` spec harness (`npm run test:specs`).

Spec: `docs/superpowers/specs/2026-09-26-estimate-numbers-design.md`.

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Prefix every shell command with `export PATH=$HOME/.local/node/bin:$PATH &&`.
- This is Next.js 16 (AGENTS.md). This plan uses no new Next API. It uses only `"use server"` actions, `searchParams: Promise<…>` and plain server/client components, exactly as the neighbouring files do.
- Prefixes, verbatim from the spec: **EST** (system / Estimator), **FLM** (flame_test), **RIG** (inspection), **REP** (repair), **RNT** (rental), **CON** (consulting), **OPP** (a lead / an opportunity not yet quoted). An unknown or absent `quoteType` → **EST**. Numbering starts at **1001**. Suffixes are `-2`, `-3`, …; the first quote on an opportunity has none.
- Internal ids never change. Everything keyed by id stays keyed by id: `href`, `key=`, hidden form inputs, `?id=` params, Blob paths, Gmail labels, foreign keys and `getDoc` lookups. Only **text shown to people** changes.
- A number is allocated once and never changes. `estNo`/`estSuffix` are written only by `assign_estimate_numbers()` (and by `leads.create()`'s one explicit carry, Task 3). `update()` in both stores strips them.
- `"use client"` files never import a VALUE from `@/lib/stores/*` or `@/db*`. Only `next build` catches that mistake. `@/lib/estimate-number` is pure and safe anywhere. Client components get the formatted string through props, or format it themselves from `estNo`/`estSuffix`/`quoteType` props.
- Timestamps are epoch-ms numbers. Deterministic only (D89).
- Never run the dev server or any db script (`db:*`, seeds, imports) against `.data/pglite`. `npm run test:specs` is allowed because it always uses a fresh `mktemp -d` PGlite datadir. Before running it, check that `ps aux | grep -E "tsx|next dev" | grep -v grep` prints nothing.
- Never use bare `git stash` (the stash is shared across worktrees). Commit instead. If `git commit` fails on `index.lock`, wait 5 s and retry, up to 5 times. Never delete the lock file.
- Spec-harness assertions are tagged `#223` and appended at the END of `scripts/test-review-and-spec.ts` as a hoisted `import` block plus a `{ … }` block. Import aliases carry an `e223` prefix so they can't collide. Async (DB) checks are `async function estimate223…AsyncChecks()` declared at the end of the file. Each is added to the promise chain with one `.then(() => …)` line placed immediately ABOVE the comment line `// Before the report and before the \`.catch\`, so a thrown suite is torn`. Other branches append to that chain too, so anchor on the comment, not on a neighbour. DB fixtures use `fixtureId(223, "<slug>")` + `createFixture` (both already imported at the top of the harness). Rows minted by the code under test are registered with `registerFixture`, which Task 3 imports as `e223Register`.
- Gates in each task's final step: `npx tsc --noEmit` (0 errors) · `npm run test:specs` (0 FAIL; report the PASS count, which must equal the previous task's count plus this task's new assertions) · `npx eslint <changed files>` (0 errors). Tasks 3–7 also run `npx next build`, which must succeed. `next build` is safe: `src/db/index.ts` gives build workers a throwaway datadir.
- Commit messages: `feat(quotes): … (#223)`, then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the task's files. Never `git add -A`.
- Do not write DECISIONS.md or PUNCHLIST.md entries.
- Other tasks on this branch (#214 inbox popup, #216 venues, #218 documents) edit some of the same files (`inbox/*`, `leads/*`, the harness). Locate every edit by the landmark text quoted in this plan, never by line number. Line numbers below are orientation only, as of `69450de6`.

## Decisions this plan takes where the spec is open

1. **SQL function, not a TypeScript backfill.** The renumbering is one PL/pgSQL function, `assign_estimate_numbers()`. The migration creates it and calls it once. The store calls it after every insert. Why:
   - *Runs exactly once per database, before new-code writes, never on a build worker's real DB.* That is precisely what drizzle's journaled migrator already guarantees (see "How the migration meets the production guard" below). A TS backfill would need new once-only bookkeeping, plus a hook in both `scripts/migrate.mjs` and `createDb()`.
   - *Ordering by JSONB date fields is practical in SQL.* `estimate_created_at(doc, updated_at)` guards every cast with `jsonb_typeof(...) = 'number'`, so a malformed legacy doc can't abort a production migration.
   - *One algorithm, not two.* The backfill, the healing of stragglers, and new-record allocation (lead carry + suffix) are the same code path. So the rule new records follow can't drift from the rule history was renumbered by.
   - *It heals.* Any record created without a number is numbered by the next create: by the old deployment while the production build runs, by a preview deploy before production migrates, by seeds, or by the Daylite importer. The fallback display (internal id) covers the gap in between.
   - The spec's `allocateEstimateNumber()` (a bare `nextval`) is therefore not exported. `nextval` is called only inside the function, under its lock, so the sequence stays the only allocator.
2. **How a quote knows its lead.** Today the only link is `lead.convertedQuoteId` (one quote), plus `quote.consulting.leadId` on consulting proposals. Quotes gain a top-level `leadId?: string | null`, stamped by `leads.convert()` and by the consulting builder. The function resolves a quote's lead in this order: `doc.leadId` → `doc.consulting.leadId` → the lead whose `convertedQuoteId` is this quote.
3. **Backfill order when a quote predates its lead.** Records are walked in date order. A quote whose lead is not numbered yet takes a fresh number, and the lead takes that quote's number when it is reached. So one opportunity always shares one number.
4. **Suffixes count every quote ever given the number, soft-deleted included.** A displayed number is never reused. The spec's "no other live quote" is read that way, in line with its own reason for numbering soft-deleted records.
5. **Consulting auto-lead.** The builder now looks up the customer's open lead *before* creating the proposal. An existing lead → the proposal carries it (`leadId`) and so its number. No lead → the new auto-lead is created with the proposal's `estNo`, so `CON-1010` and `OPP-1010` are one opportunity.
6. **"Change type" replacement and renewals** are new quotes with new numbers. The spec says a renewal is a new estimate, and the replaced draft is retired.
7. **Daylite imports** carry no original date: `createdAt` is the import time, so they are numbered in id order within one import batch. This is a data limitation, logged under Risks, not a code gap.
8. **The quotes hub gains a search box** (`?q=`). It has no text search today, and the spec requires hub search by number and by old id. ⌘K gains exact-number lookup for quotes and a small "Opportunities" group for leads found by `OPP-` number.
9. **`was Q-2041`** shows in small type in the quotes-hub selected panel, and only when the number differs from the id.

## How the migration meets the production guard

- `scripts/migrate.mjs` (run by `npm run build`) exits 0 without migrating when `VERCEL_ENV === "preview"` (guard since 2026-09-22), or when `DATABASE_URL` is unset. On the shared Neon DB, the migration therefore runs once: in the first **production** build after this branch reaches `main`. drizzle records it in `drizzle.__drizzle_migrations` and never re-runs it.
- **Preview deploys of this branch run the new code against the un-migrated production DB.** `assignEstimateNumbers()` first probes `to_regprocedure('assign_estimate_numbers()')`. That returns NULL instead of raising, so the probe can't poison an open transaction. With no function it returns 0 and writes nothing, and records created on the preview simply have no `estNo` and display their internal id. When production migrates, the backfill numbers them with everything else.
- **During the production build, the old deployment still serves.** Any quote or lead it creates after the migration ran is unnumbered. The first create on the new code numbers it, because the function numbers every unnumbered row.
- **Local / tests.** `createDb()` runs drizzle's `migrate()` on every PGlite open. The journal makes that a no-op after the first run. `next build` workers use throwaway datadirs (`phase-production-build`), so the migration runs there on an empty DB and assigns nothing. `npm run test:specs` uses a fresh `mktemp -d` datadir, so the harness always exercises the real migration file.
- **Idempotent per D141.** `CREATE SEQUENCE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`. The backfill skips anything already numbered, and the `setval` only ever moves the sequence forward. Re-running the whole file changes nothing (Task 2 proves it).
- **drizzle selects work by timestamp** (`created_at < when`, D141). The new journal entry's `when` must be the largest in `drizzle/meta/_journal.json`, which Task 2 step 1 checks.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/estimate-number.ts` (new) | Pure: prefix map, format, parse, display fallback, search match, patch sanitizer | 1 |
| `drizzle/<N>_estimate_numbers.sql` (new) + `drizzle/meta/_journal.json` + `drizzle/meta/<N>_snapshot.json` | Sequence, indexes, `estimate_created_at()`, `assign_estimate_numbers()`, backfill, `setval` | 2 |
| `src/lib/stores/estimate-numbers.ts` (new) | Server wrapper: `assignEstimateNumbers()`, `numberNewDoc()` | 2 |
| `src/lib/stores/quotes.ts`, `src/lib/stores/leads.ts` | Types gain `estNo`/`estSuffix`/`leadId`; create/convert number; update strips | 3 |
| `src/app/(app)/design/engagements/quote/actions.ts` | Consulting lead carry | 3 |
| `src/lib/daylite/history-commit.ts`, `src/db/seed-data.ts` | Number bulk-written records | 3 |
| Sweep A: ⌘K, quotes hub (+ search), "Change type" intake, Estimator | Show and search numbers | 4 |
| Sweep B: service builders, letters, PDFs, client packages, repairs, portal | Show numbers | 5 |
| Sweep C: Grid, Designs/Home promote, Specs, consulting engagements | Show numbers; accept typed numbers | 6 |
| Sweep D: leads, opportunities, public intake, Home, reviews, queue, bell, companies, inbox, projects/schedules | Show numbers | 7 |
| `scripts/test-review-and-spec.ts` | `#223` assertions | 1–7 |

---

### Task 1: Pure estimate-number module

**Files:**
- Create: `src/lib/estimate-number.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces (exact exports, used by every later task):
  - `ESTIMATE_TYPES: readonly ["system","flame_test","inspection","repair","rental","consulting"]`, `type EstimateType`
  - `ESTIMATE_PREFIX: Record<EstimateType | "opportunity", string>`
  - `prefixForQuoteType(t: string | null | undefined): string`
  - `type QuoteNumberFields = { id?: string; estNo?: number | null; estSuffix?: number | null; quoteType?: string | null }`
  - `type LeadNumberFields = { id?: string; estNo?: number | null }`
  - `formatQuoteNumber(q: QuoteNumberFields): string | null`
  - `formatLeadNumber(l: LeadNumberFields): string | null`
  - `displayQuoteNumber(q: QuoteNumberFields & { id: string }): string`
  - `displayLeadNumber(l: LeadNumberFields & { id: string }): string`
  - `type ParsedEstimateNumber = { estNo: number; suffix: number | null; prefix: string | null }`
  - `parseEstimateNumber(raw: string | null | undefined): ParsedEstimateNumber | null`
  - `quoteNumberMatches(q: QuoteNumberFields, p: ParsedEstimateNumber): boolean`
  - `leadNumberMatches(l: LeadNumberFields, p: ParsedEstimateNumber): boolean`
  - `quoteMatchesSearch(q: QuoteNumberFields & { id: string; name?: string | null; customer?: string | null }, term: string): boolean`
  - `isEstimateNo(n: unknown): n is number`
  - `withoutEstimateFields<T extends object>(patch: T): Omit<T, "estNo" | "estSuffix">`

- [ ] **Step 1: Write the failing tests.** Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #223 — estimate numbers: the pure module (src/lib/estimate-number.ts).
   ====================================================================== */
import {
  ESTIMATE_PREFIX as e223Prefix,
  prefixForQuoteType as e223PrefixFor,
  formatQuoteNumber as e223FormatQuote,
  formatLeadNumber as e223FormatLead,
  displayQuoteNumber as e223DisplayQuote,
  displayLeadNumber as e223DisplayLead,
  parseEstimateNumber as e223Parse,
  quoteNumberMatches as e223QuoteNoMatches,
  leadNumberMatches as e223LeadNoMatches,
  quoteMatchesSearch as e223QuoteSearch,
  isEstimateNo as e223IsNo,
  withoutEstimateFields as e223Strip,
} from "@/lib/estimate-number";
{
  ok(
    e223Prefix.system === "EST" && e223Prefix.flame_test === "FLM" && e223Prefix.inspection === "RIG" &&
      e223Prefix.repair === "REP" && e223Prefix.rental === "RNT" && e223Prefix.consulting === "CON" &&
      e223Prefix.opportunity === "OPP",
    "#223 prefix map: EST/FLM/RIG/REP/RNT/CON/OPP"
  );
  ok(e223PrefixFor(undefined) === "EST" && e223PrefixFor(null) === "EST" && e223PrefixFor("") === "EST", "#223 an absent quoteType is a system quote → EST");
  ok(e223PrefixFor("mystery") === "EST" && e223PrefixFor("opportunity") === "EST", "#223 an unknown quoteType (or the lead-only key) → EST");
  ok(e223FormatQuote({ estNo: 1002, quoteType: "flame_test" }) === "FLM-1002", "#223 format: flame test");
  ok(e223FormatQuote({ estNo: 1005, estSuffix: 2, quoteType: "system" }) === "EST-1005-2", "#223 format: suffix -2");
  ok(e223FormatQuote({ estNo: 1005, estSuffix: 1, quoteType: "repair" }) === "REP-1005", "#223 format: a suffix below 2 is never printed");
  ok(e223FormatQuote({ quoteType: "rental" }) === null && e223FormatQuote({ estNo: 0 }) === null && e223FormatQuote({ estNo: 12.5 }) === null, "#223 format: no valid estNo → null");
  ok(e223FormatLead({ estNo: 1005 }) === "OPP-1005" && e223FormatLead({}) === null, "#223 format: lead → OPP");
  ok(e223DisplayQuote({ id: "Q-2041" }) === "Q-2041" && e223DisplayQuote({ id: "Q-2041", estNo: 1001, quoteType: "inspection" }) === "RIG-1001", "#223 display: falls back to the internal id, never blank");
  ok(e223DisplayLead({ id: "L-1050" }) === "L-1050" && e223DisplayLead({ id: "L-1050", estNo: 1003 }) === "OPP-1003", "#223 display: lead fallback");
  const e223Same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  ok(e223Same(e223Parse("flm-1002"), { estNo: 1002, suffix: null, prefix: "FLM" }), "#223 parse: flm-1002");
  ok(e223Same(e223Parse("FLM1002"), { estNo: 1002, suffix: null, prefix: "FLM" }), "#223 parse: FLM1002");
  ok(e223Same(e223Parse("1002"), { estNo: 1002, suffix: null, prefix: null }), "#223 parse: 1002");
  ok(e223Same(e223Parse(" #1002 "), { estNo: 1002, suffix: null, prefix: null }), "#223 parse: #1002");
  ok(e223Same(e223Parse("1005-2"), { estNo: 1005, suffix: 2, prefix: null }), "#223 parse: 1005-2");
  ok(e223Same(e223Parse("est 1005 2"), { estNo: 1005, suffix: 2, prefix: "EST" }), "#223 parse: spaces as separators");
  ok(e223Same(e223Parse("opp-1005"), { estNo: 1005, suffix: null, prefix: "OPP" }), "#223 parse: OPP");
  ok(e223Parse("Q-2041") === null && e223Parse("XYZ-1002") === null && e223Parse("") === null && e223Parse(null) === null && e223Parse("lakefront") === null, "#223 parse: old ids, unknown prefixes and words are not numbers");
  const e223Q = { id: "Q-2041", estNo: 1005, estSuffix: 2, quoteType: "flame_test", name: "Lakefront PAC", customer: "Lakefront" };
  ok(e223QuoteNoMatches(e223Q, e223Parse("1005")!) && e223QuoteNoMatches(e223Q, e223Parse("flm-1005-2")!), "#223 match: bare number and exact number both hit");
  ok(!e223QuoteNoMatches(e223Q, e223Parse("EST-1005")!) && !e223QuoteNoMatches(e223Q, e223Parse("1005-3")!), "#223 match: wrong prefix or wrong suffix misses");
  ok(e223LeadNoMatches({ estNo: 1005 }, e223Parse("OPP-1005")!) && !e223LeadNoMatches({ estNo: 1005 }, e223Parse("FLM-1005")!), "#223 match: leads answer only to OPP or a bare number");
  ok(e223QuoteSearch(e223Q, "FLM-1005-2") && e223QuoteSearch(e223Q, "q-2041") && e223QuoteSearch(e223Q, "lakefront") && e223QuoteSearch(e223Q, "flm-10"), "#223 search: number, old id, name and partial number all find the quote");
  ok(!e223QuoteSearch(e223Q, "EST-1005") && e223QuoteSearch(e223Q, "  "), "#223 search: a wrong-prefix number misses; a blank term matches everything");
  ok(e223IsNo(1001) && !e223IsNo(0) && !e223IsNo(-3) && !e223IsNo(1.5) && !e223IsNo("1001"), "#223 isEstimateNo: positive integers only");
  const e223Patched = e223Strip({ name: "x", estNo: 5, estSuffix: 2 });
  ok(e223Same(e223Patched, { name: "x" }), "#223 withoutEstimateFields drops estNo/estSuffix and keeps the rest");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | grep estimate-number | head -3`
Expected: `Cannot find module '@/lib/estimate-number'`.

- [ ] **Step 3: Write the module.** Create `src/lib/estimate-number.ts`:

```ts
/**
 * Estimate numbers (#223, docs/superpowers/specs/2026-09-26-estimate-numbers-design.md).
 *
 * The number people see, say, search and print for a quote or a lead:
 * `FLM-1002`, `EST-1005-2`, `OPP-1005`. One shared counter (`estNo`, from the
 * Postgres sequence `estimate_number_seq`) with a prefix per quote type; a
 * lead's number carries to its quotes, and extra quotes on the same
 * opportunity get `-2`, `-3` (`estSuffix`).
 *
 * Internal ids (`Q-2041`, `L-1050`, `Q-dl-…`) stay the keys — URLs, foreign
 * keys, Blob paths. This module only formats. Allocation lives in the
 * database (`assign_estimate_numbers()`, drizzle `*_estimate_numbers.sql`)
 * behind `src/lib/stores/estimate-numbers.ts`.
 *
 * Pure: no store or db import, so `"use client"` files may import it.
 */

export const ESTIMATE_TYPES = ["system", "flame_test", "inspection", "repair", "rental", "consulting"] as const;
export type EstimateType = (typeof ESTIMATE_TYPES)[number];

export const ESTIMATE_PREFIX: Record<EstimateType | "opportunity", string> = {
  system: "EST",
  flame_test: "FLM",
  inspection: "RIG",
  repair: "REP",
  rental: "RNT",
  consulting: "CON",
  opportunity: "OPP",
};

const KNOWN_PREFIXES: ReadonlySet<string> = new Set(Object.values(ESTIMATE_PREFIX));

export type QuoteNumberFields = {
  id?: string;
  estNo?: number | null;
  estSuffix?: number | null;
  quoteType?: string | null;
};

export type LeadNumberFields = { id?: string; estNo?: number | null };

/** A usable counter value: a positive integer. */
export function isEstimateNo(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

/** The quote prefix for a quoteType; absent/unknown is a system quote. */
export function prefixForQuoteType(t: string | null | undefined): string {
  const key = t || "system";
  return (ESTIMATE_TYPES as readonly string[]).includes(key)
    ? ESTIMATE_PREFIX[key as EstimateType]
    : ESTIMATE_PREFIX.system;
}

/** `FLM-1002` / `EST-1005-2`, or null when the quote has no number yet. */
export function formatQuoteNumber(q: QuoteNumberFields): string | null {
  if (!isEstimateNo(q.estNo)) return null;
  const base = `${prefixForQuoteType(q.quoteType)}-${q.estNo}`;
  return isEstimateNo(q.estSuffix) && q.estSuffix >= 2 ? `${base}-${q.estSuffix}` : base;
}

/** `OPP-1005`, or null when the lead has no number yet. */
export function formatLeadNumber(l: LeadNumberFields): string | null {
  return isEstimateNo(l.estNo) ? `${ESTIMATE_PREFIX.opportunity}-${l.estNo}` : null;
}

/** What to show for a quote — its number, else its internal id (never blank). */
export function displayQuoteNumber(q: QuoteNumberFields & { id: string }): string {
  return formatQuoteNumber(q) ?? q.id;
}

/** What to show for a lead — its number, else its internal id (never blank). */
export function displayLeadNumber(l: LeadNumberFields & { id: string }): string {
  return formatLeadNumber(l) ?? l.id;
}

export type ParsedEstimateNumber = { estNo: number; suffix: number | null; prefix: string | null };

/**
 * Read a typed estimate number, case- and separator-tolerant:
 * `flm-1002`, `FLM1002`, `1002`, `#1002`, `1005-2`, `est 1005 2`.
 * Returns null for anything else, including old internal ids (`Q-2041`: a
 * one-letter prefix is not an estimate prefix) and unknown prefixes.
 */
export function parseEstimateNumber(raw: string | null | undefined): ParsedEstimateNumber | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/^#\s*/, "");
  const m = /^(?:([A-Z]{3})[\s\-_#.]*)?(\d{1,9})(?:[\s\-_./]+(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const prefix = m[1] ?? null;
  if (prefix !== null && !KNOWN_PREFIXES.has(prefix)) return null;
  const estNo = Number(m[2]);
  if (!isEstimateNo(estNo)) return null;
  const suffixNum = m[3] ? Number(m[3]) : null;
  return { estNo, suffix: suffixNum !== null && suffixNum >= 2 ? suffixNum : null, prefix };
}

/** A parsed number names this quote: same counter value, and — when typed —
 *  the same prefix and suffix. A bare `1005` matches `EST-1005` and `EST-1005-2`. */
export function quoteNumberMatches(q: QuoteNumberFields, p: ParsedEstimateNumber): boolean {
  if (!isEstimateNo(q.estNo) || q.estNo !== p.estNo) return false;
  if (p.prefix !== null && p.prefix !== prefixForQuoteType(q.quoteType)) return false;
  if (p.suffix !== null && (isEstimateNo(q.estSuffix) ? q.estSuffix : null) !== p.suffix) return false;
  return true;
}

/** A parsed number names this lead: same counter value; prefix OPP or none; no suffix. */
export function leadNumberMatches(l: LeadNumberFields, p: ParsedEstimateNumber): boolean {
  if (!isEstimateNo(l.estNo) || l.estNo !== p.estNo) return false;
  if (p.prefix !== null && p.prefix !== ESTIMATE_PREFIX.opportunity) return false;
  return p.suffix === null;
}

/**
 * The one quote search rule (quotes hub `?q=`, ⌘K): a typed estimate number
 * (exact, via parseEstimateNumber), or a case-insensitive substring of the
 * displayed number, the OLD internal id, the name or the customer — so
 * "Q-2041" still finds the quote it always found.
 */
export function quoteMatchesSearch(
  q: QuoteNumberFields & { id: string; name?: string | null; customer?: string | null },
  term: string
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const parsed = parseEstimateNumber(t);
  if (parsed && quoteNumberMatches(q, parsed)) return true;
  // A typed prefix that isn't this quote's type rules it out ("EST-1005" never
  // finds FLM-1005). Otherwise fall through, so partial typing ("flm-10" →
  // parses as FLM + 10) still finds FLM-1005 as a substring.
  if (parsed && parsed.prefix !== null && parsed.prefix !== prefixForQuoteType(q.quoteType)) return false;
  return [q.id, formatQuoteNumber(q), q.name, q.customer].some(
    (f) => typeof f === "string" && f.toLowerCase().includes(t)
  );
}

/** A store patch minus the allocated number — numbers never change after allocation. */
export function withoutEstimateFields<T extends object>(patch: T): Omit<T, "estNo" | "estSuffix"> {
  const out = { ...patch } as Record<string, unknown>;
  delete out.estNo;
  delete out.estSuffix;
  return out as Omit<T, "estNo" | "estSuffix">;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "#223|FAIL|ALL PASSED|FAILED" | tail -40`
Expected: every `#223` line is `PASS`, and the run ends with `ALL PASSED`.

- [ ] **Step 5: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log   # record: baseline + 25
grep -c '^FAIL' /tmp/e223.log                                               # 0
npx eslint src/lib/estimate-number.ts scripts/test-review-and-spec.ts
git add src/lib/estimate-number.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): pure estimate-number module — prefixes, format, parse, search (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Record the baseline PASS count BEFORE Step 1 with the same two commands, so "baseline + 25" can be checked.

---
### Task 2: Migration — sequence, `assign_estimate_numbers()`, backfill, `setval`; the store wrapper

**Files:**
- Create: `drizzle/<N>_estimate_numbers.sql`, `drizzle/meta/<N>_snapshot.json` (a copy of the previous snapshot; the schema is unchanged)
- Modify: `drizzle/meta/_journal.json` (one appended entry)
- Create: `src/lib/stores/estimate-numbers.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

`<N>` is the next free 4-digit migration number, found in Step 1. Other tasks on this branch (#216 `sites.name_auto`, #218 `documents`) may already have taken 0028/0029.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - SQL: sequence `estimate_number_seq` (starts at 1001); functions `estimate_ms(jsonb) → numeric`, `estimate_created_at(jsonb, bigint) → numeric`, `assign_estimate_numbers() → integer` (how many records it numbered).
  - `src/lib/stores/estimate-numbers.ts`:
    - `assignEstimateNumbers(): Promise<number>`: 0 when the function doesn't exist (an un-migrated DB); never throws on that account.
    - `numberNewDoc<T extends Doc>(coll: "quotes" | "leads", doc: T): Promise<T>`: runs `assignEstimateNumbers()`, then returns the re-read doc (with `estNo`/`estSuffix`), or `doc` if the re-read finds nothing.
  - Doc fields written (JSONB, top level): `estNo: number` on quotes and leads, `estSuffix: number` (≥ 2) on quotes only.

- [ ] **Step 1: Take the next migration number (guard).**

Run: `cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks && ls drizzle/*.sql | tail -3`

Confirm `drizzle/0027_spec_documents.sql` is in the listing. **If it is not, STOP and report BLOCKED** ("origin/main's 0027 is not merged; the estimate-numbers migration must sort after it"). Otherwise `<N>` = the highest number shown + 1, zero-padded to 4 digits. Also confirm that no file is named `*_estimate_numbers.sql` yet.

- [ ] **Step 2: Write the failing tests.** Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #223 — estimate numbers: the migration (sequence, assign_estimate_numbers(),
   date-ordered backfill with lead→quote carry and suffixes, setval) and the
   store wrapper's preview safety. Runs on the harness's fresh datadir, so
   the real drizzle/<N>_estimate_numbers.sql is what is under test.
   ====================================================================== */
import { assignEstimateNumbers as e223Assign } from "@/lib/stores/estimate-numbers";
import { buildQuote as e223BuildQuote, type Quote as E223Quote } from "@/lib/stores/quotes";
import { mkLead as e223MkLead, type LeadRecord as E223Lead } from "@/lib/stores/leads";
import { getDocRows as e223GetRows, softDeleteDoc as e223SoftDelete } from "@/db/doc-store";
import { getDb as e223GetDb, withTransaction as e223Tx } from "@/db";
import { sql as e223Sql } from "drizzle-orm";
import { readFileSync as e223ReadFile, readdirSync as e223ReadDir } from "node:fs";
import { join as e223Join } from "node:path";
function e223Rows<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) return (result as { rows: T[] }).rows;
  return Array.isArray(result) ? (result as T[]) : [];
}

async function estimate223BackfillAsyncChecks(): Promise<void> {
  const db = await e223GetDb();
  const reg = e223Rows<{ seq: string | null; fn: string | null }>(
    await db.execute(e223Sql`select to_regclass('estimate_number_seq')::text as seq, to_regprocedure('assign_estimate_numbers()')::text as fn`)
  );
  ok(!!reg[0]?.seq && !!reg[0]?.fn, "#223 migration: estimate_number_seq and assign_estimate_numbers() exist on a fresh datadir");

  // Number whatever earlier suites left unnumbered, so the fixtures below
  // are the only unnumbered rows and get consecutive numbers.
  await e223Assign();

  const id = (slug: string) => fixtureId(223, slug);
  const quote = (slug: string, t: number, extra: Partial<E223Quote> = {}): E223Quote => ({
    ...e223BuildQuote(id(slug), { name: "#223 " + slug, owner: "spec" }, extra.quoteType || "system", null, t),
    ...extra,
  });
  const lead = (slug: string, t: number, extra: Partial<E223Lead> = {}): E223Lead => ({
    ...e223MkLead({ id: id(slug), org: "#223 " + slug, createdAt: t }),
    ...extra,
  });

  // No createdAt at all — dated by its earliest history entry (5).
  const hist = quote("hist", 1, { history: [{ at: 5, to: "draft" }], updatedAt: 90 });
  delete (hist as Partial<E223Quote>).createdAt;
  await createFixture("quotes", hist);
  await createFixture("leads", lead("lead1", 10, { convertedQuoteId: id("q1") }));
  await createFixture("quotes", quote("gone", 15));
  await e223SoftDelete("quotes", id("gone"));
  await createFixture("quotes", quote("q1", 20, { source: "lead" }));
  await createFixture("quotes", quote("dl", 30, { source: "daylite" }));
  await createFixture("quotes", quote("q2", 40, { leadId: id("lead1"), quoteType: "flame_test" }));
  await createFixture("quotes", quote("q3", 55, { leadId: id("lead2") }));
  await createFixture("leads", lead("lead2", 60));
  await createFixture("quotes", quote("q4", 65, { quoteType: "consulting", consulting: { leadId: id("lead1") } }));
  await createFixture("quotes", quote("tie-b", 70));
  await createFixture("quotes", quote("tie-a", 70));

  const assigned = await e223Assign();
  ok(assigned === 11, `#223 backfill: numbers all eleven unnumbered fixtures in one pass (got ${assigned})`);

  const read = async () => [
    ...(await e223GetRows("quotes", ["hist", "gone", "q1", "dl", "q2", "q3", "q4", "tie-a", "tie-b"].map(id))),
    ...(await e223GetRows("leads", ["lead1", "lead2"].map(id))),
  ];
  const rows = await read();
  const field = (slug: string, k: "estNo" | "estSuffix") =>
    (rows.find((r) => r.id === id(slug))?.doc as Record<string, unknown> | undefined)?.[k];
  const no = (slug: string) => Number(field(slug, "estNo") ?? -1);
  const b = no("hist");
  ok(b >= 1001, "#223 backfill: numbers start at 1001 or later");
  ok(
    no("lead1") === b + 1 && no("gone") === b + 2 && no("dl") === b + 3 && no("q3") === b + 4 && no("tie-a") === b + 5 && no("tie-b") === b + 6,
    "#223 backfill: leads and quotes interleave in date order (createdAt, else earliest history/activity; ties by id)"
  );
  ok(rows.find((r) => r.id === id("gone"))?.deleted === true && no("gone") > 0, "#223 backfill: a soft-deleted quote is numbered too, so no number is ever reused");
  ok(no("dl") > 0, "#223 backfill: a Daylite-imported quote is numbered");
  ok(no("q1") === no("lead1") && field("q1", "estSuffix") === undefined, "#223 backfill: the lead's converted quote carries the lead's number, no suffix");
  ok(no("q2") === no("lead1") && field("q2", "estSuffix") === 2, "#223 backfill: a second quote on the lead (leadId) gets -2");
  ok(no("q4") === no("lead1") && field("q4", "estSuffix") === 3, "#223 backfill: a consulting proposal linked by consulting.leadId gets -3");
  ok(no("lead2") === no("q3") && field("q3", "estSuffix") === undefined, "#223 backfill: a lead newer than its quote takes the quote's number");

  ok((await e223Assign()) === 0, "#223 backfill: a second pass assigns nothing");

  const snapshot = JSON.stringify(rows.map((r) => [r.id, (r.doc as Record<string, unknown>).estNo, (r.doc as Record<string, unknown>).estSuffix]));
  const file = e223ReadDir(e223Join(process.cwd(), "drizzle")).find((f) => /^\d{4}_estimate_numbers\.sql$/.test(f));
  ok(!!file, "#223 migration: drizzle/NNNN_estimate_numbers.sql exists");
  let rerunError: unknown = null;
  if (file) {
    const stmts = e223ReadFile(e223Join(process.cwd(), "drizzle", file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      for (const s of stmts) await db.execute(e223Sql.raw(s));
    } catch (e) {
      rerunError = e;
    }
  }
  ok(rerunError === null, `#223 migration: re-running every statement of the file is harmless (${String(rerunError)})`);
  const after = await read();
  ok(
    JSON.stringify(after.map((r) => [r.id, (r.doc as Record<string, unknown>).estNo, (r.doc as Record<string, unknown>).estSuffix])) === snapshot,
    "#223 migration: a re-run changes no number"
  );

  const top = e223Rows<{ top: string | number | bigint | null }>(
    await db.execute(e223Sql`select max(v)::bigint as top from (
      select (doc->>'estNo')::numeric as v from quotes where jsonb_typeof(doc->'estNo') = 'number'
      union all
      select (doc->>'estNo')::numeric from leads where jsonb_typeof(doc->'estNo') = 'number') s`)
  );
  const seq = e223Rows<{ last_value: string | number | bigint; is_called: boolean }>(
    await db.execute(e223Sql`select last_value, is_called from estimate_number_seq`)
  );
  ok(
    seq[0]?.is_called === true && Number(seq[0]?.last_value) === Number(top[0]?.top),
    "#223 setval: the sequence sits at the highest number in use, so the next record continues it"
  );

  // A preview deploy reads the shared production DB before production has
  // migrated: no function. The wrapper must answer 0, not throw (a throw
  // inside a transaction would poison it).
  const sentinel = new Error("e223-rollback");
  const seen = { n: -1 };
  try {
    await e223Tx(async () => {
      const tx = await e223GetDb();
      await tx.execute(e223Sql`drop function assign_estimate_numbers()`);
      seen.n = await e223Assign();
      throw sentinel;
    });
  } catch (e) {
    if (e !== sentinel) throw e;
  }
  ok(seen.n === 0, "#223 preview safety: with no assign_estimate_numbers() (an un-migrated DB) the wrapper returns 0 instead of throwing");
  const back = e223Rows<{ fn: string | null }>(await db.execute(e223Sql`select to_regprocedure('assign_estimate_numbers()')::text as fn`));
  ok(!!back[0]?.fn, "#223 …and rolling that transaction back restores the function");
}
```

Then add this line to the promise chain, directly ABOVE the comment line `// Before the report and before the \`.catch\`, so a thrown suite is torn`:

```ts
  .then(() => estimate223BackfillAsyncChecks())
```

(`fixtureId` and `createFixture` are already imported at the top of the harness, and `ok` is the harness's own.)

- [ ] **Step 3: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | grep -E "estimate-numbers|leadId" | head -5`
Expected: `Cannot find module '@/lib/stores/estimate-numbers'`, plus `'leadId' does not exist in type 'Partial<Quote>'`. The second error is fixed in Task 3. For now, add the field so this task compiles on its own. In `src/lib/stores/quotes.ts`, inside `export type Quote = {`, directly above the line `  review: QuoteReview;`, insert:

```ts
  /** Estimate number (#223) — the shared-counter value people see
   *  (FLM-1002; src/lib/estimate-number.ts formats it). Written only by the
   *  database's assign_estimate_numbers(); never changes once set. Absent
   *  between insert and numbering, and on a DB that predates the migration. */
  estNo?: number;
  /** 2, 3, … for additional quotes on the same opportunity (#223); absent on the first. */
  estSuffix?: number;
  /** The lead (opportunity) this quote was made from (#223) — its estNo carries here. */
  leadId?: string | null;
```

In `src/lib/stores/leads.ts`, inside `export interface LeadRecord {`, directly above the line `  createdAt: number;`, insert:

```ts
  /** Estimate number (#223) — shown as OPP-1005; its quotes carry it. Written
   *  only by assign_estimate_numbers() (or create()'s explicit carry). */
  estNo?: number;
```

- [ ] **Step 4: Write the migration.** Create the snapshot + journal entry with this script. It copies the previous snapshot with a fresh id, and appends a journal entry whose `when` is later than every existing one (drizzle selects work by timestamp, D141):

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
export PATH=$HOME/.local/node/bin:$PATH
node -e '
const fs = require("fs"), crypto = require("crypto");
const j = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
const last = j.entries[j.entries.length - 1];
const idx = last.idx + 1;
const num = String(idx).padStart(4, "0");
const tag = num + "_estimate_numbers";
const prev = JSON.parse(fs.readFileSync("drizzle/meta/" + last.tag.slice(0, 4) + "_snapshot.json", "utf8"));
fs.writeFileSync("drizzle/meta/" + num + "_snapshot.json", JSON.stringify({ ...prev, id: crypto.randomUUID(), prevId: prev.id }, null, 2));
j.entries.push({ idx, version: "7", when: Math.max(Date.now(), last.when + 1), tag, breakpoints: true });
fs.writeFileSync("drizzle/meta/_journal.json", JSON.stringify(j, null, 2));
console.log(tag);
'
```

Expected output: `<N>_estimate_numbers` with the `<N>` from Step 1. If it prints a different number, the journal and the `.sql` files disagree. STOP and report BLOCKED.

Then create `drizzle/<N>_estimate_numbers.sql` with exactly this content:

```sql
-- Estimate numbers (#223, docs/superpowers/specs/2026-09-26-estimate-numbers-design.md).
--
-- One shared counter for every quote and lead. The doc gains `estNo` (and a
-- quote on an already-numbered opportunity gains `estSuffix` 2, 3, …);
-- src/lib/estimate-number.ts prints them as FLM-1002 / EST-1005-2 / OPP-1005.
-- Internal ids (Q-2041, L-1050, Q-dl-…) are untouched.
--
-- assign_estimate_numbers() is the ONLY allocator: this migration calls it
-- once to renumber history (from 1001, date order, Daylite imports and
-- soft-deleted rows included), and src/lib/stores/estimate-numbers.ts calls
-- it after every insert — which also numbers any straggler the previous
-- deployment or a preview deploy created while this function did not exist.
--
-- Idempotent per D141 (the shared Neon DB): IF NOT EXISTS / OR REPLACE
-- everywhere, numbered rows are skipped, setval only ever moves forward.
-- Every JSONB cast is guarded by jsonb_typeof so no legacy doc can abort it.
CREATE SEQUENCE IF NOT EXISTS "estimate_number_seq" START WITH 1001;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_est_unnumbered_idx" ON "quotes" USING btree ("id") WHERE jsonb_typeof("doc"->'estNo') IS DISTINCT FROM 'number';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_est_unnumbered_idx" ON "leads" USING btree ("id") WHERE jsonb_typeof("doc"->'estNo') IS DISTINCT FROM 'number';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_est_no_idx" ON "quotes" USING btree (("doc"->>'estNo'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_est_no_idx" ON "leads" USING btree (("doc"->>'estNo'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_lead_id_idx" ON "quotes" USING btree (("doc"->>'leadId'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_consulting_lead_id_idx" ON "quotes" USING btree ((("doc"->'consulting')->>'leadId'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_converted_quote_id_idx" ON "leads" USING btree (("doc"->>'convertedQuoteId'));
--> statement-breakpoint
-- A positive epoch-ms from a JSON value, else NULL. CASE (not AND) so the
-- cast is only ever evaluated on a JSON number.
CREATE OR REPLACE FUNCTION estimate_ms(v jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'number' THEN NULLIF(GREATEST((v #>> '{}')::numeric, 0), 0) END
$$;
--> statement-breakpoint
-- When a record was created: createdAt, else its earliest dated history
-- (quotes) / activity (leads) entry, else its doc updatedAt, else the row's
-- own updated_at stamp.
CREATE OR REPLACE FUNCTION estimate_created_at(d jsonb, row_updated bigint) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    estimate_ms(d->'createdAt'),
    (SELECT min(estimate_ms(e->'at'))
       FROM jsonb_array_elements(
              (CASE WHEN jsonb_typeof(d->'history') = 'array' THEN d->'history' ELSE '[]'::jsonb END)
           || (CASE WHEN jsonb_typeof(d->'activities') = 'array' THEN d->'activities' ELSE '[]'::jsonb END)) AS e),
    estimate_ms(d->'updatedAt'),
    row_updated::numeric
  )
$$;
--> statement-breakpoint
-- Number every quote and lead that has no estNo, oldest first (ties by id),
-- leads and quotes interleaved. A quote whose lead is numbered carries the
-- lead's number (+ the next suffix when a quote already has it); a lead whose
-- quote was numbered first takes that quote's number; everything else takes
-- nextval. A quote's lead: doc.leadId, else doc.consulting.leadId, else the
-- lead whose convertedQuoteId is this quote. One pass at a time (advisory
-- lock, namespace = punch #223, held to the end of the caller's transaction).
-- Returns how many records it numbered.
CREATE OR REPLACE FUNCTION assign_estimate_numbers() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  link_lead text;
  conv_quote text;
  carry bigint;
  next_suffix integer;
  n bigint;
  assigned integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(223, 0);
  FOR r IN
    SELECT u.kind, u.id
      FROM (
        SELECT 'lead'::text AS kind, l.id, estimate_created_at(l.doc, l.updated_at) AS t
          FROM leads l
         WHERE jsonb_typeof(l.doc->'estNo') IS DISTINCT FROM 'number'
        UNION ALL
        SELECT 'quote'::text, q.id, estimate_created_at(q.doc, q.updated_at)
          FROM quotes q
         WHERE jsonb_typeof(q.doc->'estNo') IS DISTINCT FROM 'number'
      ) u
     ORDER BY u.t, u.id
  LOOP
    carry := NULL;
    next_suffix := NULL;
    IF r.kind = 'lead' THEN
      SELECT NULLIF(doc->>'convertedQuoteId', '') INTO conv_quote FROM leads WHERE id = r.id;
      SELECT CASE WHEN jsonb_typeof(q.doc->'estNo') = 'number' THEN (q.doc->>'estNo')::numeric::bigint END
        INTO carry
        FROM quotes q
       WHERE (q.id = conv_quote OR q.doc->>'leadId' = r.id OR (q.doc->'consulting')->>'leadId' = r.id)
         AND jsonb_typeof(q.doc->'estNo') = 'number'
       ORDER BY estimate_created_at(q.doc, q.updated_at), q.id
       LIMIT 1;
      IF carry IS NULL THEN
        n := nextval('estimate_number_seq');
      ELSE
        n := carry;
      END IF;
      UPDATE leads
         SET doc = doc || jsonb_build_object('estNo', n), rev = rev + 1
       WHERE id = r.id AND jsonb_typeof(doc->'estNo') IS DISTINCT FROM 'number';
    ELSE
      SELECT COALESCE(NULLIF(doc->>'leadId', ''), NULLIF((doc->'consulting')->>'leadId', ''))
        INTO link_lead FROM quotes WHERE id = r.id;
      IF link_lead IS NOT NULL THEN
        SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END
          INTO carry FROM leads WHERE id = link_lead;
      END IF;
      IF carry IS NULL THEN
        SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END
          INTO carry
          FROM leads
         WHERE doc->>'convertedQuoteId' = r.id AND jsonb_typeof(doc->'estNo') = 'number'
         ORDER BY id
         LIMIT 1;
      END IF;
      IF carry IS NULL THEN
        n := nextval('estimate_number_seq');
        UPDATE quotes
           SET doc = doc || jsonb_build_object('estNo', n), rev = rev + 1
         WHERE id = r.id AND jsonb_typeof(doc->'estNo') IS DISTINCT FROM 'number';
      ELSE
        -- Soft-deleted quotes count: a displayed number is never reused.
        SELECT CASE WHEN count(*) = 0 THEN NULL
                    ELSE GREATEST(1, COALESCE(max(CASE WHEN jsonb_typeof(doc->'estSuffix') = 'number'
                                                       THEN (doc->>'estSuffix')::numeric::integer END), 1)) + 1
               END
          INTO next_suffix
          FROM quotes
         WHERE doc->>'estNo' = carry::text;
        UPDATE quotes
           SET doc = doc || jsonb_build_object('estNo', carry)
                   || CASE WHEN next_suffix IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('estSuffix', next_suffix) END,
               rev = rev + 1
         WHERE id = r.id AND jsonb_typeof(doc->'estNo') IS DISTINCT FROM 'number';
      END IF;
    END IF;
    IF FOUND THEN
      assigned := assigned + 1;
    END IF;
  END LOOP;
  RETURN assigned;
END;
$$;
--> statement-breakpoint
-- The backfill: renumber everything that exists, from 1001, in date order.
SELECT assign_estimate_numbers();
--> statement-breakpoint
-- Continue after the highest number in use (only ever moves forward).
SELECT setval('estimate_number_seq', m.top, true)
  FROM (
    SELECT max(v) AS top FROM (
      SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END AS v FROM quotes
      UNION ALL
      SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END FROM leads
    ) s
  ) m,
  estimate_number_seq sq
 WHERE m.top IS NOT NULL
   AND m.top > CASE WHEN sq.is_called THEN sq.last_value ELSE sq.last_value - 1 END;
```

Why the backfill doesn't touch `updatedAt`: the quotes hub and the leads lists sort by the doc's `updatedAt`, and renumbering must not reorder them. `rev` is bumped, and the `_seq_bump` trigger bumps `seq`, so pull-sync still sees the change.

- [ ] **Step 5: Write the store wrapper.** Create `src/lib/stores/estimate-numbers.ts`:

```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getDoc, type Doc } from "@/db/doc-store";

/**
 * Estimate-number allocation (#223) — the server seam over the database's
 * `assign_estimate_numbers()` (drizzle `*_estimate_numbers.sql`), which is the
 * only allocator: it numbers every quote and lead still without an `estNo`,
 * oldest first, carrying a lead's number to its quotes (+ suffix).
 *
 * Every path that INSERTS a quote or lead calls this right after the insert
 * (store create()s via numberNewDoc, leads.convert, the Daylite commit, the
 * demo seed). Because it numbers every unnumbered row, it also heals
 * stragglers: records the previous deployment created while production was
 * migrating, or a preview deploy created against the shared, not-yet-migrated
 * production DB.
 *
 * Server-only (imports the db). Formatting lives in @/lib/estimate-number.
 */

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) return (result as { rows: T[] }).rows;
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * Number everything still unnumbered; returns how many records were numbered.
 * Returns 0 — without raising — when the function does not exist yet: a
 * preview deploy reads the shared production DB before production migrates
 * (scripts/migrate.mjs skips previews), and a raised "function does not
 * exist" would poison any transaction the caller is in. `to_regprocedure`
 * answers NULL instead of raising.
 */
export async function assignEstimateNumbers(): Promise<number> {
  const db = await getDb();
  const probe = rowsOf<{ ok: boolean }>(
    await db.execute(sql`select to_regprocedure('assign_estimate_numbers()') is not null as ok`)
  );
  if (!probe[0]?.ok) return 0;
  const res = rowsOf<{ n: number | string | bigint | null }>(
    await db.execute(sql`select assign_estimate_numbers() as n`)
  );
  return Number(res[0]?.n ?? 0);
}

/** Number a just-inserted quote/lead and return it as stored (with estNo). */
export async function numberNewDoc<T extends Doc>(coll: "quotes" | "leads", doc: T): Promise<T> {
  await assignEstimateNumbers();
  return (await getDoc<T>(coll, doc.id)) ?? doc;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; npx tsc --noEmit && npm run test:specs > /tmp/e223.log 2>&1; grep -E "#223" /tmp/e223.log | grep -v '^PASS'; tail -2 /tmp/e223.log`
Expected: the grep prints nothing (no `#223` FAIL), and the log ends with `ALL PASSED`.

If the migration fails to apply, the harness dies at startup with the Postgres error. Common causes: a typo in the SQL, or `--> statement-breakpoint` missing between two statements. Fix the file. It has never been applied anywhere outside this scratch run, so editing it in place is safe.

- [ ] **Step 7: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log; grep -c '^FAIL' /tmp/e223.log   # Task 1 count + 17 ; 0
npx eslint src/lib/stores/estimate-numbers.ts src/lib/stores/quotes.ts src/lib/stores/leads.ts scripts/test-review-and-spec.ts
git add drizzle/<N>_estimate_numbers.sql drizzle/meta/<N>_snapshot.json drizzle/meta/_journal.json \
  src/lib/stores/estimate-numbers.ts src/lib/stores/quotes.ts src/lib/stores/leads.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): estimate_number_seq + assign_estimate_numbers() migration with date-ordered backfill (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Allocation in every create path, lead → quote carry, lookups

**Files:**
- Modify: `src/lib/stores/estimate-numbers.ts` (add lookups)
- Modify: `src/lib/stores/quotes.ts`: `buildQuote` (~454), `create` (~501), `update` (~523)
- Modify: `src/lib/stores/leads.ts`: `LeadCreateInput` (~469), `create` (~493), `update` (~543), `convert` (~700)
- Modify: `src/app/(app)/design/engagements/quote/actions.ts`: the `const q = editingId` block and the `/* ---- #35 auto-lead with dedupe` block (~168–199)
- Modify: `src/lib/daylite/history-commit.ts`: end of `commitHistory` (~1000–1025)
- Modify: `src/db/seed-data.ts`: `seedDemoCollections` (~127)
- Test: `scripts/test-review-and-spec.ts` (append)

Creation paths and how each is numbered. This table is the recon result, so review against it:

| Path | Goes through | Numbered by |
|---|---|---|
| Estimator save/move, Grid "Create draft quote", Quick Design/Designs/Home promote, flame/repair/inspection/rental/consulting builders, renovation quote (`inspections/[id]/actions.ts`), survey→quote (`venue-assessments/*`), renewals (`renewal-outreach.ts`), inbox "+ New quote" (`gmail/linking.ts`), portal estimate (`portal/actions.ts`), CSV import (`import/registry.ts`) | `quotes.create()` | `numberNewDoc` inside `create()` |
| Website intake, quick-add, portal request, Gmail "newLead" label, CSV import, consulting auto-lead | `leads.create()` | `numberNewDoc` inside `create()` |
| `leads.convert()` (direct `insertWithPrefixedId("quotes")`) | direct | `numberNewDoc` added after the insert; the quote now carries `leadId` |
| Daylite `writeQuote` (direct `upsertDoc`) | direct | one `assignEstimateNumbers()` at the end of `commitHistory` |
| Demo seed (`seedDemoCollections`) | direct | one `assignEstimateNumbers()` after seeding |
| `quotes.resetToSeed()` | direct, **no callers** | not wired (dead). The next create heals it anyway |
| `/api/sync/push` | cannot write quotes/leads (`SYNCABLE_SET` excludes them) | n/a |

**Interfaces:**
- Consumes: Task 1 `isEstimateNo`, `displayQuoteNumber`, `displayLeadNumber`, `withoutEstimateFields`, `parseEstimateNumber`, `quoteNumberMatches`, `type QuoteNumberFields`, `type LeadNumberFields`. Task 2 `assignEstimateNumbers`, `numberNewDoc`, and the `Quote.estNo/estSuffix/leadId` / `LeadRecord.estNo` fields.
- Produces:
  - `quotes.create(partial)` returns the quote WITH `estNo` (and `estSuffix` when it carries). `partial.leadId` links it to a lead.
  - `leads.create(partial)` returns the lead WITH `estNo`. `LeadCreateInput.estNo?: number | null` carries an existing number (consulting auto-lead only).
  - `quotes.update` / `leads.update` ignore `estNo`/`estSuffix` in a patch.
  - `src/lib/stores/estimate-numbers.ts` adds:
    - `quoteNumbersFor(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>>`: id → display number, soft-deleted included, missing ids absent.
    - `leadNumbersFor(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>>`
    - `findQuoteIdByNumberOrId(input: string): Promise<string | null>`: an internal id that exists, or exactly one live quote matching a typed number; else null.

- [ ] **Step 1: Write the failing tests.** Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #223 — allocation on create: new leads, a lead's quotes (carry + suffix),
   standalone quotes, renewals, the consulting auto-lead carry, update()
   never renumbering, and the id→number lookups.
   ====================================================================== */
import * as e223Quotes from "@/lib/stores/quotes";
import * as e223Leads from "@/lib/stores/leads";
import { all as e223AllCustomers } from "@/lib/stores/customers";
import { registerFixture as e223Register } from "./test-fixtures";
import {
  quoteNumbersFor as e223QuoteNos,
  leadNumbersFor as e223LeadNos,
  findQuoteIdByNumberOrId as e223FindQuote,
} from "@/lib/stores/estimate-numbers";

async function estimate223AllocationAsyncChecks(): Promise<void> {
  const id = (slug: string) => fixtureId(223, slug);
  const cust = (await e223AllCustomers())[0];
  const lead = await e223Leads.create({ id: id("alloc-lead"), org: "#223 Alloc Co", customerId: cust?.id ?? null }, "spec");
  e223Register("leads", lead.id);
  ok(e223IsNo(lead.estNo), "#223 allocation: a new lead is numbered on create");

  const conv = await e223Leads.convert(lead.id, {}, "spec");
  if (conv?.quoteId) e223Register("quotes", conv.quoteId);
  const first = conv?.quoteId ? await e223Quotes.get(conv.quoteId) : null;
  ok(
    !!first && first.estNo === lead.estNo && first.estSuffix === undefined && first.leadId === lead.id,
    "#223 allocation: a lead's first quote carries its number with no suffix, and links back by leadId"
  );
  ok(
    !!first && !!conv && conv.lead.activities.some((a) => a.note.includes(e223DisplayQuote(first))),
    "#223 allocation: the lead's conversion activity names the quote by its number"
  );

  const second = await e223Quotes.create({ id: id("alloc-second"), name: "#223 second", owner: "spec", leadId: lead.id, quoteType: "flame_test" });
  e223Register("quotes", second.id);
  ok(
    second.estNo === lead.estNo && second.estSuffix === 2 && e223FormatQuote(second) === `FLM-${lead.estNo}-2`,
    "#223 allocation: a second quote on the same opportunity is -2, under its own type's prefix"
  );

  const solo = await e223Quotes.create({ id: id("alloc-solo"), name: "#223 solo", owner: "spec" });
  e223Register("quotes", solo.id);
  ok(e223IsNo(solo.estNo) && solo.estNo > (lead.estNo ?? 0) && solo.estSuffix === undefined, "#223 allocation: a standalone quote takes the next number");

  const renewal = await e223Quotes.create({ id: id("alloc-renewal"), name: "#223 renewal", owner: "spec", quoteType: "flame_test", renewalOf: id("job") });
  e223Register("quotes", renewal.id);
  ok(renewal.estNo === (solo.estNo ?? 0) + 1, "#223 allocation: a renewal is a new estimate with the next number");

  const kept = await e223Quotes.update(solo.id, { estNo: 1, estSuffix: 9, name: "#223 solo renamed" });
  ok(kept?.estNo === solo.estNo && kept?.estSuffix === undefined && kept?.name === "#223 solo renamed", "#223 allocation: quotes.update() never changes an allocated number");
  const keptLead = await e223Leads.update(lead.id, { estNo: 1 });
  ok(keptLead?.estNo === lead.estNo, "#223 allocation: leads.update() never changes an allocated number");

  const con = await e223Quotes.create({ id: id("alloc-con"), name: "#223 consulting", owner: "spec", quoteType: "consulting" });
  e223Register("quotes", con.id);
  const autoLead = await e223Leads.create({ id: id("alloc-autolead"), org: "#223 Auto", estNo: con.estNo ?? null }, "spec");
  e223Register("leads", autoLead.id);
  ok(autoLead.estNo === con.estNo && e223DisplayLead(autoLead) === `OPP-${con.estNo}`, "#223 allocation: the consulting auto-lead takes its proposal's number");

  const again = await e223Quotes.create({ id: id("alloc-solo"), name: "#223 solo re-created", owner: "spec" });
  ok(again.estNo === solo.estNo, "#223 allocation: create() over an existing id keeps that quote's number");

  const qn = await e223QuoteNos([solo.id, second.id, "Q-NOPE-223", null]);
  ok(qn.get(solo.id) === e223DisplayQuote(again) && qn.get(second.id) === `FLM-${lead.estNo}-2` && !qn.has("Q-NOPE-223"), "#223 lookup: quoteNumbersFor maps ids to display numbers and skips missing ids");
  const ln = await e223LeadNos([lead.id]);
  ok(ln.get(lead.id) === `OPP-${lead.estNo}`, "#223 lookup: leadNumbersFor");
  ok(
    (await e223FindQuote(solo.id)) === solo.id &&
      (await e223FindQuote(`est-${solo.estNo}`)) === solo.id &&
      (await e223FindQuote(`FLM-${lead.estNo}-2`)) === second.id &&
      (await e223FindQuote(String(lead.estNo))) === null &&
      (await e223FindQuote("nothing-223")) === null,
    "#223 lookup: findQuoteIdByNumberOrId takes an id or one exact number; an ambiguous bare number (shared by a lead's quotes) resolves to nothing"
  );
}
```

Add to the promise chain, directly ABOVE the `// Before the report and before the \`.catch\`, so a thrown suite is torn` comment:

```ts
  .then(() => estimate223AllocationAsyncChecks())
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | grep -E "quoteNumbersFor|leadNumbersFor|findQuoteIdByNumberOrId|estNo" | head -5`
Expected: missing-export errors for the three lookups, and `'estNo' does not exist in type 'LeadCreateInput'`.

- [ ] **Step 3: Add the lookups** to `src/lib/stores/estimate-numbers.ts`. Replace the import block at the top with:

```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getDoc, getDocRows, listDocsByField, type Doc } from "@/db/doc-store";
import {
  displayLeadNumber,
  displayQuoteNumber,
  parseEstimateNumber,
  quoteNumberMatches,
  type LeadNumberFields,
  type QuoteNumberFields,
} from "@/lib/estimate-number";
```

and append at the end of the file:

```ts
function cleanIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  return ids.filter((x): x is string => typeof x === "string" && x !== "");
}

/** id → display number for screens that hold only a quote id (a job's
 *  quoteId, a Grid option's quoteId, a thread link). Soft-deleted quotes are
 *  included (their number still identifies them); unknown ids are absent. */
export async function quoteNumbersFor(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const rows = await getDocRows<Doc & QuoteNumberFields>("quotes", cleanIds(ids));
  return new Map(rows.map((r) => [r.id, displayQuoteNumber(r.doc)]));
}

/** id → display number for leads (see quoteNumbersFor). */
export async function leadNumbersFor(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const rows = await getDocRows<Doc & LeadNumberFields>("leads", cleanIds(ids));
  return new Map(rows.map((r) => [r.id, displayLeadNumber(r.doc)]));
}

/**
 * What a person typed into a "quote" field → one live quote id: an internal
 * id that exists (`Q-2041` keeps working), or an estimate number that names
 * exactly one live quote (`CON-1010`, `1010` when unambiguous). Null when
 * nothing — or more than one quote — matches.
 */
export async function findQuoteIdByNumberOrId(input: string): Promise<string | null> {
  const s = String(input || "").trim();
  if (!s) return null;
  if (await getDoc("quotes", s)) return s;
  const parsed = parseEstimateNumber(s);
  if (!parsed) return null;
  const hits = (await listDocsByField<Doc & QuoteNumberFields>("quotes", "estNo", [String(parsed.estNo)])).filter((q) =>
    quoteNumberMatches(q, parsed)
  );
  return hits.length === 1 ? hits[0].id : null;
}
```

(`listDocsByField` compares `doc->>'estNo'` as text. A JSON number `1005` reads back as `'1005'`, so `String(parsed.estNo)` matches it.)

- [ ] **Step 4: Quotes store.** In `src/lib/stores/quotes.ts`:

(a) Imports: the existing `from "@/db/doc-store"` import already has `getDoc`, so leave it as is. Add two new import lines below it:

```ts
import { isEstimateNo, withoutEstimateFields } from "@/lib/estimate-number";
import { numberNewDoc } from "@/lib/stores/estimate-numbers";
```

(b) In `buildQuote`, change the last two lines of the returned object from

```ts
    history: [{ at: t, to: "draft" }],
    ...(pl ? { pipelineId: pl.id, stage: firstStage(pl).id } : {}),
```

to

```ts
    history: [{ at: t, to: "draft" }],
    ...(pl ? { pipelineId: pl.id, stage: firstStage(pl).id } : {}),
    // #223: the opportunity this quote was made from — its number carries here.
    ...(partial.leadId ? { leadId: partial.leadId } : {}),
```

(`buildQuote` never copies `estNo`/`estSuffix` from `partial`. Only the database assigns them.)

(c) Replace the body of `create` from the line `  // Explicit caller-supplied id (not a minted one) — no race to guard, keep` to the end of the function with:

```ts
  // Explicit caller-supplied id (not a minted one) — no race to guard, keep
  // the prior upsert semantics. #223: an id that already exists keeps its
  // number (the upsert replaces the whole doc, which would otherwise drop it
  // and have assign_estimate_numbers() hand out a new one).
  if (partial.id) {
    const prior = await getDoc<Quote>("quotes", partial.id);
    const q = build(partial.id);
    if (prior && isEstimateNo(prior.estNo)) {
      q.estNo = prior.estNo;
      if (isEstimateNo(prior.estSuffix)) q.estSuffix = prior.estSuffix;
    }
    await upsertDoc<Quote>("quotes", q);
    return numberNewDoc("quotes", q);
  }
  // Minted id: nextPrefixedId's max-scan lets two concurrent creates compute
  // the same Q-####; insert-if-absent + retry (D73) instead of the second
  // writer silently overwriting the first via upsertDoc. #223: numbered right
  // after the insert (lead carry + suffix happen in the database).
  return numberNewDoc("quotes", await insertWithPrefixedId<Quote>("quotes", "Q", 2041, build));
}
```

(d) In `update`, change `Object.assign(q, patch, { updatedAt: Date.now() });` to:

```ts
    // #223: an allocated number never changes — a patch cannot carry one.
    Object.assign(q, withoutEstimateFields(patch), { updatedAt: Date.now() });
```

- [ ] **Step 5: Leads store.** In `src/lib/stores/leads.ts`:

(a) Add below the `from "@/db/doc-store";` import:

```ts
import { displayQuoteNumber, isEstimateNo, withoutEstimateFields } from "@/lib/estimate-number";
import { numberNewDoc } from "@/lib/stores/estimate-numbers";
```

(b) In `export interface LeadCreateInput {`, add after `  customerId?: string | null;`:

```ts
  /** #223 — an existing estimate number to carry instead of allocating one:
   *  only for a lead made FOR a quote that already has one (the consulting
   *  auto-lead). Everything else leaves it unset. */
  estNo?: number | null;
```

(c) In `create`, replace from the line `  // mkLead defaults land syncState 'synced' / syncedAt t — the server write` to the end of the function with:

```ts
  // mkLead defaults land syncState 'synced' / syncedAt t — the server write
  // is the cloud write (prototype: 'pending' until the SyncEngine pushed).
  // #223: a carried number (consulting auto-lead) is stamped before insert;
  // otherwise the database numbers the lead right after it.
  const carry = (rec: LeadRecord): LeadRecord =>
    isEstimateNo(partial.estNo) ? { ...rec, estNo: partial.estNo } : rec;
  if (partial.id) {
    const rec = carry(build(partial.id));
    await upsertDoc("leads", rec);
    return numberNewDoc("leads", rec);
  }
  return numberNewDoc("leads", await insertWithPrefixedId<LeadRecord>("leads", "L", 1050, (id) => carry(build(id))));
}
```

(d) In `update`, change `Object.assign(l, patch || {});` to:

```ts
    // #223: an allocated number never changes — a patch cannot carry one.
    Object.assign(l, withoutEstimateFields(patch || {}));
```

(e) In `convert`, in the quote literal passed to `insertWithPrefixedId("quotes", …)`, change

```ts
    status: "draft",
    source: "lead",
```

to

```ts
    status: "draft",
    source: "lead",
    // #223: the opportunity link — the quote carries this lead's number.
    leadId: id,
```

then change

```ts
  const quoteId = quote.id;
```

to

```ts
  // #223: number it now, while the lead is the only candidate to carry from.
  const numbered = await numberNewDoc("quotes", quote);
  const quoteId = quote.id;
```

and change the activity text

```ts
      act(now(), "system", me, "Converted to customer" + (quoteId ? " + quote " + quoteId : "")),
```

to

```ts
      act(now(), "system", me, "Converted to customer" + (quoteId ? " + quote " + displayQuoteNumber(numbered) : "")),
```

- [ ] **Step 6: Consulting builder carries the opportunity.** In `src/app/(app)/design/engagements/quote/actions.ts`:

(a) Add to the imports:

```ts
import { displayQuoteNumber } from "@/lib/estimate-number";
```

(b) Replace from the line `  const q = editingId` through the closing `  }` of the `/* ---- #35 auto-lead with dedupe — CREATE path only, never edits ---- */` block (the block ends with `await updateQuote(q.id, { consulting: { ...consulting, leadId } });` then `  }`) with:

```ts
  /* ---- #35 auto-lead with dedupe — CREATE path only, never edits ----
   * #223: the customer's open lead is found BEFORE the proposal is created,
   * so the proposal carries that opportunity's estimate number (leadId). With
   * no open lead, the auto-lead is created with the proposal's number
   * instead — CON-1010 and OPP-1010 are one opportunity either way. */
  const existingLead = editingId
    ? null
    : ((await openLeads()).find((l) => l.customerId === customerId) ?? null);

  const q = editingId
    ? await updateQuote(editingId, payload)
    : await createQuote({ ...payload, leadId: existingLead?.id ?? null });
  const qid = (q && q.id) || editingId || null;

  if (!editingId && q) {
    let leadId: string;
    if (existingLead) {
      await logLeadActivity(
        existingLead.id,
        { type: "system", note: `Consulting proposal ${displayQuoteNumber(q)} created` },
        user.name
      );
      leadId = existingLead.id;
    } else {
      const lead = await createLead(
        {
          org: custName,
          source: "consulting",
          owner: user.name,
          customerId,
          interest: "Consulting — " + payload.name,
          value,
          estNo: q.estNo ?? null,
        },
        user.name
      );
      leadId = lead.id;
    }
    await updateQuote(q.id, { consulting: { ...consulting, leadId }, leadId });
  }
```

Before replacing, read the current block. If #221 or another commit changed its shape, keep their changes and apply only the three #223 deltas: the lookup moved above create with `leadId` passed in, `estNo` on the auto-lead, and `displayQuoteNumber(q)` in the activity note.

- [ ] **Step 7: Daylite commit.** In `src/lib/daylite/history-commit.ts`, add the import:

```ts
import { assignEstimateNumbers } from "@/lib/stores/estimate-numbers";
```

In `commitHistory`, directly above its final `  return { created, skippedExisting, errors, total };`, insert:

```ts
  // #223: imported quotes are written whole (writeQuote → upsertDoc), not
  // through create(), so number this chunk's new ones in one pass. Daylite
  // rows carry the import time as createdAt, so within a chunk they number
  // in id order.
  if (created.quotes > 0) await assignEstimateNumbers();
```

- [ ] **Step 8: Demo seed.** In `src/db/seed-data.ts`, add the import:

```ts
import { assignEstimateNumbers } from "@/lib/stores/estimate-numbers";
```

In `seedDemoCollections`, change the final `  return seeded;` to:

```ts
  // #223: demo quotes/leads are written whole; number them like any new record.
  if (seeded) await assignEstimateNumbers();
  return seeded;
```

(No import cycle: `estimate-numbers` → `@/db` (index), and index loads `seed-data` only through a dynamic `import()`.)

- [ ] **Step 9: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; npx tsc --noEmit && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL' /tmp/e223.log; tail -2 /tmp/e223.log`
Expected: no FAIL lines, `ALL PASSED`.

If a PRE-EXISTING assertion now fails, the likely cause is that a create now also updates other unnumbered rows (their `rev` and `seq` move). Check whether that test asserts an exact `rev`/`seq` on a quote or lead fixture it wrote with `upsertDoc`. Fix it by creating that fixture through the store, or by asserting relative to a value read after the create. Never loosen a #223 assertion to make it pass.

- [ ] **Step 10: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log; grep -c '^FAIL' /tmp/e223.log   # Task 2 count + 13 ; 0
npx eslint src/lib/stores/estimate-numbers.ts src/lib/stores/quotes.ts src/lib/stores/leads.ts "src/app/(app)/design/engagements/quote/actions.ts" src/lib/daylite/history-commit.ts src/db/seed-data.ts scripts/test-review-and-spec.ts
npx next build
git add src/lib/stores/estimate-numbers.ts src/lib/stores/quotes.ts src/lib/stores/leads.ts "src/app/(app)/design/engagements/quote/actions.ts" src/lib/daylite/history-commit.ts src/db/seed-data.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): number every new quote and lead; a lead's number carries to its quotes (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Display sweep A — search (⌘K + quotes hub), quotes hub, "Change type" intake, Estimator

**Files:**
- Modify: `src/app/api/search/route.ts`
- Modify: `src/app/(app)/quotes/page.tsx`
- Modify: `src/app/(app)/quotes/new/handoff.ts` (`IntakeReplacing`), `src/app/(app)/quotes/new/page.tsx`, `src/app/(app)/quotes/new/intake-form.tsx`
- Modify: `src/app/(app)/estimator/page.tsx`, `src/app/(app)/estimator/types.ts`, `src/app/(app)/estimator/actions.ts`, `src/app/(app)/estimator/estimator-client.tsx`, `src/app/(app)/estimator/section-card.tsx`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: Task 1 `displayQuoteNumber`, `displayLeadNumber`, `parseEstimateNumber`, `quoteNumberMatches`, `leadNumberMatches`, `quoteMatchesSearch`, `type QuoteNumberFields`. Task 3: `create()`/`update()` return quotes carrying `estNo`.
- Produces (types other code reads):
  - `SaveResult.number: string | null` (estimator/actions.ts); `MoveSystemResult` ok branch gains `targetNumber: string`
  - `QuoteLite.number: string` (estimator/types.ts)
  - `IntakeReplacing.number: string` (quotes/new/handoff.ts)
  - Quotes hub URL param `q` (search term)

- [ ] **Step 1: Write the failing tests.** Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #223 — display sweep A: search + quotes hub + intake + Estimator. The
   screens are server/client components the harness can't render, so these
   are landmark guards: the old id-as-label text is gone and the number
   helpers are wired in. Behaviour of the helpers is asserted in Task 1.
   ====================================================================== */
function e223Src(rel: string): string {
  return e223ReadFile(e223Join(process.cwd(), rel), "utf8");
}
{
  const hub = e223Src("src/app/(app)/quotes/page.tsx");
  ok(!hub.includes("{q.id} · {owner}") && hub.includes("{displayQuoteNumber(q)} · {owner}"), "#223 quotes hub: rows show the estimate number, not the internal id");
  ok(hub.includes("quoteMatchesSearch(q, searchTerm)") && hub.includes('name="q"'), "#223 quotes hub: a search box filters by number, old id, name and customer");
  ok(hub.includes("was {q.id}"), "#223 quotes hub: the selected panel shows 'was Q-…' in small type");
  const search = e223Src("src/app/api/search/route.ts");
  ok(search.includes('listDocsByField("quotes", "estNo"') && search.includes('listDocsByField("leads", "estNo"') && search.includes("quoteMatchesSearch("), "#223 ⌘K: typed numbers are looked up by value; quotes also match by old id");
  ok(!search.includes("sub: `${d.id} · "), "#223 ⌘K: result sub-lines show numbers, not ids");
  const intake = e223Src("src/app/(app)/quotes/new/intake-form.tsx");
  ok(!intake.includes("replacing.id") && intake.includes("replacing.number"), "#223 Change type intake names the quote by its number");
  const est = e223Src("src/app/(app)/estimator/estimator-client.tsx");
  ok(est.includes("setQuoteId(res.number ?? res.id)") && est.includes("({moveNotice.targetNumber})"), "#223 Estimator: header + move notice show numbers");
  ok(e223Src("src/app/(app)/estimator/page.tsx").includes("quoteId: displayQuoteNumber(q)"), "#223 Estimator: the header label starts as the quote's number");
  ok(e223Src("src/app/(app)/estimator/section-card.tsx").includes("{hit.number}"), "#223 Estimator: the move-to picker lists numbers");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL #223' /tmp/e223.log | head`
Expected: the 9 new `#223` landmark assertions FAIL.

- [ ] **Step 3: ⌘K (`src/app/api/search/route.ts`).**

Change the import `import { searchDocs } from "@/db/doc-store";` to:

```ts
import { listDocsByField, searchDocs, type Doc } from "@/db/doc-store";
import {
  displayLeadNumber,
  displayQuoteNumber,
  leadNumberMatches,
  parseEstimateNumber,
  quoteMatchesSearch,
  quoteNumberMatches,
  type QuoteNumberFields,
} from "@/lib/estimate-number";
```

Below the `function matches(…)` helper, add:

```ts
/** #223 — a doc as the estimate-number helpers read it. */
type NumberedDoc = QuoteNumberFields & { id: string; name?: string | null; customer?: string | null };
const asNumbered = (d: Doc): NumberedDoc => d as unknown as NumberedDoc;
```

Replace the whole `add(\n    "Quotes",\n    quotes\n      .filter((d) => matches(q, d.id, d.name, d.customer))` call (the one ending with `color: "var(--accent)",\n      }))\n  );`) with:

```ts
  // #223 — a quote answers to its estimate number (FLM-1002), its OLD
  // internal id (Q-2041) and its name/customer. The doc text holds
  // `"estNo": 1002`, never "FLM-1002", so a typed number is also looked up
  // by value. Leads are listed here only when a typed OPP number names them.
  const parsedNo = parseEstimateNumber(q);
  const [numberedQuotes, numberedLeads] = parsedNo
    ? await Promise.all([
        listDocsByField("quotes", "estNo", [String(parsedNo.estNo)]).then((rows) =>
          rows.filter((d) => quoteNumberMatches(asNumbered(d), parsedNo))
        ),
        listDocsByField("leads", "estNo", [String(parsedNo.estNo)]).then((rows) =>
          rows.filter((d) => leadNumberMatches(asNumbered(d), parsedNo))
        ),
      ])
    : [[], []];
  const seenQuote = new Set<string>();
  const quoteHits = [...numberedQuotes, ...quotes.filter((d) => quoteMatchesSearch(asNumbered(d), q))].filter((d) => {
    if (seenQuote.has(d.id)) return false;
    seenQuote.add(d.id);
    return true;
  });
  add(
    "Quotes",
    quoteHits.map((d) => ({
      id: d.id,
      title: String(d.name || d.id),
      sub: `${displayQuoteNumber(asNumbered(d))} · ${String(d.customer || "")}`,
      href: `/quotes?id=${encodeURIComponent(d.id)}`,
      letter: "Q",
      color: "var(--accent)",
    }))
  );
  add(
    "Opportunities",
    numberedLeads.map((d) => ({
      id: d.id,
      title: String(d.org || d.contact || d.id),
      sub: `${displayLeadNumber(asNumbered(d))} · ${String(d.interest || "")}`,
      href: `/leads?lead=${encodeURIComponent(d.id)}`,
      letter: "O",
      color: "var(--accent)",
    }))
  );
```

If #221 already changed the Quotes `href` to a helper (for example `quoteBuilderHref`), keep their `href` expression and change only the filter and `sub`.

- [ ] **Step 4: Quotes hub (`src/app/(app)/quotes/page.tsx`).**

(a) Add the import:

```ts
import { displayQuoteNumber, quoteMatchesSearch } from "@/lib/estimate-number";
```

(b) After `  const selectedId = one(sp.id);` add:

```ts
  // #223 — search by estimate number (FLM-1002, 1002), old id, name, customer.
  const searchTerm = one(sp.q).trim();
```

(c) In `hrefFor`, add `q?: string;` to the `over` parameter's type, and directly after the line `    if (ty && ty !== "all") qs.set("type", ty);` add:

```ts
    const term = over.q ?? searchTerm;
    if (term) qs.set("q", term);
```

(d) Directly above the comment `  /* ---- quote-type filter (IDEAS #22`, add:

```ts
  /* ---- #223 search (before the type counts, so the rail counts matches) ---- */
  if (searchTerm) scoped = scoped.filter((q) => quoteMatchesSearch(q, searchTerm));
```

(e) Directly after `          <OwnerSelect value={ownerSelectValue} options={ownerOptions} />`, add:

```tsx
          <form method="get" action="/quotes" style={{ display: "flex" }}>
            {scope !== "all" && <input type="hidden" name="who" value={scope} />}
            {filter !== "all" && <input type="hidden" name="status" value={filter} />}
            {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
            <input
              type="search"
              name="q"
              defaultValue={searchTerm}
              placeholder="Search FLM-1002, Q-2041, name…"
              aria-label="Search quotes by number, old id, name or customer"
              className="pk-input"
              style={{ fontSize: 12.5, padding: "6px 10px", minWidth: 0, width: 220, maxWidth: "100%" }}
            />
          </form>
```

(f) In the list row, change `{q.id} · {owner}` to `{displayQuoteNumber(q)} · {owner}`.

(g) In `SelectedPanel`'s returned JSX, directly above the comment `{/* review & approval banner (Estimator port) */}`, add:

```tsx
      {/* #223 — the estimate number, and the internal id it replaced */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "#16181d", marginBottom: 8 }}>
        {displayQuoteNumber(q)}
        {displayQuoteNumber(q) !== q.id && (
          <span style={{ fontWeight: 400, fontSize: 10.5, color: "#aab0bb", marginLeft: 8 }}>was {q.id}</span>
        )}
      </div>
```

- [ ] **Step 5: "Change type" intake.**

`src/app/(app)/quotes/new/handoff.ts`: change

```ts
export type IntakeReplacing = { id: string; type: ServiceType; lines: number; editPath: string };
```

to

```ts
/** `id` keys the replace; `number` is what the intake shows (#223). */
export type IntakeReplacing = { id: string; number: string; type: ServiceType; lines: number; editPath: string };
```

`src/app/(app)/quotes/new/page.tsx`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`, and change

```ts
      replacing = { id: old.id, type, lines: quoteLineCount(old), editPath: quoteEditPath(old) };
```

to

```ts
      replacing = { id: old.id, number: displayQuoteNumber(old), type, lines: quoteLineCount(old), editPath: quoteEditPath(old) };
```

`src/app/(app)/quotes/new/intake-form.tsx`: replace each of the four `replacing.id` text uses with `replacing.number`:
- `` `← Back to ${replacing.id}` `` → `` `← Back to ${replacing.number}` ``
- `` `Pick the new type for ${replacing.id}. It is replaced when the new quote is first saved.` `` → `` `Pick the new type for ${replacing.number}. It is replaced when the new quote is first saved.` ``
- `replaceConfirmMessage(replacing.id, replacing.lines)` → `replaceConfirmMessage(replacing.number, replacing.lines)`
- `` `Back to ${replacing.id} →` `` → `` `Back to ${replacing.number} →` ``

Then run `grep -n "replacing.id" "src/app/(app)/quotes/new/intake-form.tsx"`, which must print nothing. If it prints a line that feeds a hidden input or an href, restore `.id` on that one line. The id is still the key, and the Step 1 guard will need a matching adjustment, since it asserts that no `replacing.id` remains.

- [ ] **Step 6: Estimator.**

`src/app/(app)/estimator/page.tsx`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. In `initialFrom`'s final `return {`, change `    quoteId: q.id,` to:

```ts
    // #223: the header label — the estimate number; `loadedId` stays the key.
    quoteId: displayQuoteNumber(q),
```

`src/app/(app)/estimator/types.ts`: change `QuoteLite` to

```ts
export type QuoteLite = {
  id: string;
  /** #223 — the estimate number shown in the picker. */
  number: string;
  name: string;
  customer: string;
  status: QuoteStatus;
  updatedAt: number;
};
```

`src/app/(app)/estimator/actions.ts`:
- Add `import { displayQuoteNumber, quoteMatchesSearch } from "@/lib/estimate-number";`.
- In `export type SaveResult = {`, after `  id: string | null;` add:

```ts
  /** #223 — the saved quote's estimate number, for the header (null when nothing was saved). */
  number: string | null;
```

- In `saveQuoteAction`'s `catch (e)` return (the one with `id: null,`), add `        number: null,` after `        id: null,`.
- In its final `return {`, after `    id: q?.id ?? null,` add `    number: q ? displayQuoteNumber(q) : null,`.
- In `searchQuotesAction`, replace the `matched` computation and the `.map` with:

```ts
  const matched = q ? pool.filter((quote) => quoteMatchesSearch(quote, q)) : pool;
  return matched.slice(0, Math.max(1, limit)).map((quote) => ({
    id: quote.id,
    number: displayQuoteNumber(quote),
    name: quote.name,
    customer: quote.customer,
    status: quote.status,
    updatedAt: quote.updatedAt,
  }));
```

- Change `MoveSystemResult`'s ok branch to `| { ok: true; targetId: string; targetName: string; targetNumber: string }`. Change the two ok returns to:

```ts
    return { ok: true, targetId: updated.id, targetName: updated.name, targetNumber: displayQuoteNumber(updated) };
```

```ts
  return { ok: true, targetId: created.id, targetName: (withContact || created).name, targetNumber: displayQuoteNumber(withContact || created) };
```

`src/app/(app)/estimator/estimator-client.tsx`:
- `setQuoteId(res.id);` → `setQuoteId(res.number ?? res.id);`
- The `moveNotice` state type `{ ok: true; targetId: string; targetName: string }` → `{ ok: true; targetId: string; targetName: string; targetNumber: string }`
- `setMoveNotice({ ok: true, targetId: res.targetId, targetName: res.targetName });` → `setMoveNotice({ ok: true, targetId: res.targetId, targetName: res.targetName, targetNumber: res.targetNumber });`
- `Moved to {moveNotice.targetName} ({moveNotice.targetId}) —{" "}` → `Moved to {moveNotice.targetName} ({moveNotice.targetNumber}) —{" "}` (the `href` below it keeps `moveNotice.targetId`)

`src/app/(app)/estimator/section-card.tsx`: in the move picker, change `{hit.id}` to `{hit.number}`.

`preview-doc.tsx` needs no change. It prints the `quoteId` prop, which the client passes from the same state, and that state now holds the number.

- [ ] **Step 7: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL' /tmp/e223.log; tail -2 /tmp/e223.log`
Expected: no FAIL, `ALL PASSED`. `tsc` flags any other `QuoteLite` or `SaveResult` literal that lacks the new field. Add the field there the same way.

- [ ] **Step 8: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log; grep -c '^FAIL' /tmp/e223.log   # Task 3 count + 9 ; 0
npx eslint src/app/api/search/route.ts "src/app/(app)/quotes/page.tsx" "src/app/(app)/quotes/new/handoff.ts" "src/app/(app)/quotes/new/page.tsx" "src/app/(app)/quotes/new/intake-form.tsx" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/section-card.tsx" scripts/test-review-and-spec.ts
npx next build
git add src/app/api/search/route.ts "src/app/(app)/quotes/page.tsx" "src/app/(app)/quotes/new/handoff.ts" "src/app/(app)/quotes/new/page.tsx" "src/app/(app)/quotes/new/intake-form.tsx" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/section-card.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(quotes): search and show estimate numbers in ⌘K, the quotes hub and the Estimator (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Display sweep B — service builders, letters, PDFs, client packages, repairs, portal

**Files:**
- Modify: `src/app/(app)/{flame-tests,repairs,inspections,rentals}/quote/controls.tsx` and `…/quote/page.tsx` (4 builders)
- Modify: `src/app/(app)/design/engagements/quote/controls.tsx`, `src/app/(app)/design/engagements/quote/page.tsx`
- Modify: `src/app/(app)/flame-tests/letter/page.tsx`, `src/app/(app)/inspections/letter/page.tsx`, `src/app/(app)/design/engagements/letter/page.tsx`
- Modify: `src/app/(app)/rentals/quote/letter/route.ts`, `src/lib/renewal-outreach.ts`, `src/lib/client-package-server.ts`
- Modify: `src/app/(app)/repairs/completion-letter/page.tsx`, `src/app/(app)/repairs/warranty-record/page.tsx`, `src/lib/stores/repair-jobs.ts`, `src/app/api/projects/[id]/handoff/route.ts`
- Modify: `src/app/portal/page.tsx`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: Task 1 `displayQuoteNumber`, `type QuoteNumberFields`. Task 3 `quoteNumbersFor`.
- Produces: `BuilderInitial.savedNumber: string` in the four service-builder `controls.tsx` files; `BuilderInitial.number: string` in the consulting builder `controls.tsx`.

Rule for this task: text and filenames switch to the number. Blob paths, `package-index.json`'s `quoteId`, `engagementId: \`quote:${quote.id}\``, hidden inputs and every `href`/`?id=` keep the internal id.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
/* ======================================================================
   #223 — display sweep B: builders, letters, PDFs, packages, repairs, portal.
   ====================================================================== */
{
  for (const b of ["flame-tests", "repairs", "inspections", "rentals"]) {
    const c = e223Src(`src/app/(app)/${b}/quote/controls.tsx`);
    const p = e223Src(`src/app/(app)/${b}/quote/page.tsx`);
    ok(c.includes("Saved {savedNumber}") && !c.includes("Saved {savedId}") && p.includes("savedNumber: displayQuoteNumber(editQuote)"), `#223 ${b} builder: the saved toast names the estimate number`);
  }
  ok(e223Src("src/app/(app)/design/engagements/quote/controls.tsx").includes("`Consulting proposal ${initial.number}`"), "#223 consulting builder header shows the number");
  for (const l of ["flame-tests", "inspections"]) {
    const s = e223Src(`src/app/(app)/${l}/letter/page.tsx`);
    ok(!s.includes('v: quote.id }') && !s.includes("Work Order {quote.id}"), `#223 ${l} letter: Document + Work Order lines print the number`);
  }
  ok(e223Src("src/app/(app)/rentals/quote/letter/route.ts").includes("Rental-agreement-${displayQuoteNumber(quote)}.pdf"), "#223 rental agreement PDF is named by number");
  const ren = e223Src("src/lib/renewal-outreach.ts");
  ok(!ren.includes('renewal-" + quote.id + ".pdf'), "#223 renewal PDFs are named by number");
  const pkg = e223Src("src/lib/client-package-server.ts");
  ok(pkg.includes('{ label: "Quote", value: displayQuoteNumber(quote) }') && pkg.includes("client-packages/quote-${safeName(quote.id)}/"), "#223 client package prints the number; its Blob path keeps the id");
  ok(e223Src("src/lib/stores/repair-jobs.ts").includes('"From quote " + displayQuoteNumber(q)'), "#223 a repair job's source label names the quote's number");
  ok(e223Src("src/app/portal/page.tsx").includes('displayQuoteNumber(q) + " · "'), "#223 portal lists quotes by number");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL #223' /tmp/e223.log`
Expected: the 12 new assertions FAIL.

- [ ] **Step 3: The four service builders.** For each of `flame-tests`, `repairs`, `inspections`, `rentals`:

`…/quote/controls.tsx`: in the `BuilderInitial` type, directly under `  savedId: string;`, add:

```ts
  /** #223 — the saved quote's estimate number ("" before the first save). */
  savedNumber: string;
```

Directly under `  const savedId = initial.savedId;`, add:

```ts
  const savedNumber = initial.savedNumber || savedId;
```

and change `Saved {savedId} ·{" "}` to `Saved {savedNumber} ·{" "}`. Links built from `savedId` stay as they are.

`…/quote/page.tsx`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. Next to every `savedId: editQuote.id,` add `savedNumber: displayQuoteNumber(editQuote),`, and next to every `savedId: "",` add `savedNumber: "",`. `tsc` fails on any literal you miss, because the field is required.

- [ ] **Step 4: Consulting builder.** `src/app/(app)/design/engagements/quote/controls.tsx`: in `BuilderInitial`, under its `id: string;` add `  /** #223 — the estimate number shown in the header. */\n  number: string;`. Change `` `Consulting proposal ${initial.id}` `` to `` `Consulting proposal ${initial.number}` ``. `ChangeTypeControl`, `DeleteQuoteButton` and the hidden `editingId` keep `initial.id`.

`src/app/(app)/design/engagements/quote/page.tsx`: add the `displayQuoteNumber` import. In the initial object where `        id: q.id,` is set (~79), add `        number: displayQuoteNumber(q),` directly below it.

- [ ] **Step 5: Letters.** Add `import { displayQuoteNumber } from "@/lib/estimate-number";` to each file below.

- `flame-tests/letter/page.tsx` and `inspections/letter/page.tsx`: `{ k: "Document", v: quote.id },` → `{ k: "Document", v: displayQuoteNumber(quote) },`; `Work Order {quote.id} ·` → `Work Order {displayQuoteNumber(quote)} ·`. `backHref` keeps `quote.id`.
- `design/engagements/letter/page.tsx`: `{kind === "spec" ? eng!.id : quoteId}` → `{kind === "spec" ? eng!.id : quote ? displayQuoteNumber(quote) : quoteId}`.

- [ ] **Step 6: PDFs and packages.**

- `rentals/quote/letter/route.ts`: import it, then `` const filename = `Rental-agreement-${quote.id}.pdf`; `` → `` const filename = `Rental-agreement-${displayQuoteNumber(quote)}.pdf`; ``
- `src/lib/renewal-outreach.ts`: import it, then `"Field-flame-inspection-renewal-" + quote.id + ".pdf",` → `"Field-flame-inspection-renewal-" + displayQuoteNumber(quote) + ".pdf",`, and `"Rigging-inspection-renewal-" + quote.id + ".pdf",` → `"Rigging-inspection-renewal-" + displayQuoteNumber(quote) + ".pdf",`
- `src/lib/client-package-server.ts`: import it, then:
  - `meta: [{ label: "Package", value: packageName }, { label: "Quote", value: quote.id }],` → `meta: [{ label: "Package", value: packageName }, { label: "Quote", value: displayQuoteNumber(quote) }],`
  - `      job: quote.id,` → `      job: displayQuoteNumber(quote),`
  - `` const packageName = `${safeName(quote.name || quote.id)}-${quote.id}`; `` → `` const packageName = `${safeName(quote.name || quote.id)}-${safeName(displayQuoteNumber(quote))}`; ``
  - Leave `engagementId`, the `package-index.json` `quoteId` field and the `putBlob(\`client-packages/quote-${safeName(quote.id)}/…\`)` path unchanged. They are keys.

- [ ] **Step 7: Repairs + project handoff (screens holding only an id).**

- `src/lib/stores/repair-jobs.ts`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. In `export type RepairQuoteLike = {`, under `  id: string;` add `  estNo?: number | null;\n  estSuffix?: number | null;` (`quoteType` is already there). Change `label: "From quote " + q.id }` to `label: "From quote " + displayQuoteNumber(q) }`. Labels already stored on existing jobs stay as written: they are snapshots.
- `repairs/completion-letter/page.tsx` and `repairs/warranty-record/page.tsx`: add `import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";`. Directly after the line that loads the job (`const job = id ? await get(id) : null;`), add:

```ts
  // #223 — the source quote by its estimate number (the job holds only its id).
  const srcQuoteNo = job?.quoteId ? (await quoteNumbersFor([job.quoteId])).get(job.quoteId) : undefined;
```

then change `value: job.quoteId || job.source?.label || "—"` to `value: srcQuoteNo || job.quoteId || job.source?.label || "—"`.
- `src/app/api/projects/[id]/handoff/route.ts`: add the same `quoteNumbersFor` import. Directly above the object/array literal that contains `{ label: "Linked design package", …}`, add:

```ts
  const linkedQuoteNo = project.quoteId ? (await quoteNumbersFor([project.quoteId])).get(project.quoteId) ?? project.quoteId : null;
```

and change `` value: project.quoteId ? `Available from linked quote ${project.quoteId}` : "No linked quote" `` to `` value: linkedQuoteNo ? `Available from linked quote ${linkedQuoteNo}` : "No linked quote" ``.

- [ ] **Step 8: Portal.** `src/app/portal/page.tsx`: add `import { displayQuoteNumber } from "@/lib/estimate-number";` and change `{q.id + " · " + fmtDate(q.updatedAt)}` to `{displayQuoteNumber(q) + " · " + fmtDate(q.updatedAt)}`.

- [ ] **Step 9: #222 check.** Run `grep -rn "savedPdf\|saved-quote-pdf\|#222" src --include='*.ts' --include='*.tsx' | grep -v globals.css`. If #222 (saved quote PDFs) has landed on this branch by now and any filename or header built there uses `q.id`/`quote.id`, route that text through `displayQuoteNumber` the same way, and add the file to this task's `git add`. If nothing prints, there is nothing to do.

- [ ] **Step 10: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL' /tmp/e223.log; tail -2 /tmp/e223.log`
Expected: no FAIL, `ALL PASSED`.

- [ ] **Step 11: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log; grep -c '^FAIL' /tmp/e223.log   # Task 4 count + 12 ; 0
FILES=( "src/app/(app)/flame-tests/quote/controls.tsx" "src/app/(app)/flame-tests/quote/page.tsx" "src/app/(app)/repairs/quote/controls.tsx" "src/app/(app)/repairs/quote/page.tsx" "src/app/(app)/inspections/quote/controls.tsx" "src/app/(app)/inspections/quote/page.tsx" "src/app/(app)/rentals/quote/controls.tsx" "src/app/(app)/rentals/quote/page.tsx" "src/app/(app)/design/engagements/quote/controls.tsx" "src/app/(app)/design/engagements/quote/page.tsx" "src/app/(app)/flame-tests/letter/page.tsx" "src/app/(app)/inspections/letter/page.tsx" "src/app/(app)/design/engagements/letter/page.tsx" "src/app/(app)/rentals/quote/letter/route.ts" src/lib/renewal-outreach.ts src/lib/client-package-server.ts "src/app/(app)/repairs/completion-letter/page.tsx" "src/app/(app)/repairs/warranty-record/page.tsx" src/lib/stores/repair-jobs.ts "src/app/api/projects/[id]/handoff/route.ts" src/app/portal/page.tsx scripts/test-review-and-spec.ts )
npx eslint "${FILES[@]}"
npx next build
git add "${FILES[@]}"
git commit -m "feat(quotes): estimate numbers on builders, letters, PDFs, client packages, repairs and the portal (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Display sweep C — Grid, Designs/Home promote, Specs, consulting engagements

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`, `…/[id]/editor.tsx`, `…/[id]/set/page.tsx`, `…/[id]/actions.ts`
- Modify: `src/app/(app)/design/designs/actions.ts`, `src/app/(app)/design/designs/design-client.tsx`, `src/app/(app)/home-actions.ts`, `src/app/(app)/home-my-designs.tsx`
- Modify: `src/app/(app)/design/specs/page.tsx`, `src/app/(app)/design/specs/new/page.tsx`, `src/app/(app)/design/specs/[id]/page.tsx`, `…/[id]/builder.tsx`, `…/[id]/header-fields.tsx`
- Modify: `src/app/(app)/design/engagements/data.ts`, `…/engagements/view.tsx`, `…/engagements/actions.ts`, `src/lib/stores/engagements.ts`, `…/engagements/spec/page.tsx`, `…/engagements/spec/generator.tsx`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: Task 1 `displayQuoteNumber`. Task 3 `quoteNumbersFor`, `findQuoteIdByNumberOrId`.
- Produces: the `GridEditor` prop `quoteNumbers: Record<string, string>`; `promoteDesignAction` (designs) ok result gains `quoteNumber: string`; home `promoteDesignAction` ok result gains `number: string`; the `Builder`/`HeaderCard` prop `sourceQuoteNumber: string | null`; `sourceText(s, quoteNumber?)`; engagements `QuoteLite.number: string`.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
/* ======================================================================
   #223 — display sweep C: Grid, Designs/Home promote, Specs, engagements.
   ====================================================================== */
{
  const ed = e223Src("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("quoteNumbers[activeOption.quoteId] ?? activeOption.quoteId"), "#223 Grid editor: 'Update draft quote' names the number");
  ok(!e223Src("src/app/(app)/design/grid/[id]/actions.ts").includes("quoted as ${q.id}"), "#223 Grid revisions note the quote by number");
  ok(e223Src("src/app/(app)/design/grid/[id]/set/page.tsx").includes("optionQuoteNo"), "#223 drawing set title block prints the number");
  ok(e223Src("src/app/(app)/design/designs/design-client.tsx").includes("{promotedNo ?? promotedId}"), "#223 Designs: 'linked to quote' shows the number");
  ok(e223Src("src/app/(app)/home-my-designs.tsx").includes("{promotedNo ?? promoted}"), "#223 Home: 'Added to Quotes as' shows the number");
  ok(e223Src("src/app/(app)/design/specs/[id]/header-fields.tsx").includes("quoteNumber || s.quoteId"), "#223 Spec builder: source line names the quote's number");
  ok(e223Src("src/app/(app)/design/engagements/view.tsx").includes("Quote {q.number}"), "#223 engagement overview names the proposal by number");
  ok(e223Src("src/app/(app)/design/engagements/actions.ts").includes("findQuoteIdByNumberOrId("), "#223 engagement quote fields accept an estimate number or an old id");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL #223' /tmp/e223.log`
Expected: the 8 new assertions FAIL.

- [ ] **Step 3: Grid.**

`design/grid/[id]/page.tsx`: add `import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";`. Directly above `  return (` (the one that renders `<CanMapProvider …><GridEditor`), add:

```ts
  // #223 — each option's draft quote by its estimate number.
  const quoteNumbers = Object.fromEntries(await quoteNumbersFor((project.options || []).map((o) => o.quoteId)));
```

and add the prop `quoteNumbers={quoteNumbers}` to `<GridEditor`, directly after `canCreate={…}`.

`design/grid/[id]/editor.tsx`: in `GridEditor`'s destructured parameter list, add `quoteNumbers,`. In its props type (the `}: {` block that begins `project: ProjectLite;`), add `  /** #223 — option quoteId → estimate number. */\n  quoteNumbers: Record<string, string>;`. Change

```tsx
              {activeOption.quoteId ? `Update draft quote ${activeOption.quoteId}` : "Create draft quote"}
```

to

```tsx
              {activeOption.quoteId ? `Update draft quote ${quoteNumbers[activeOption.quoteId] ?? activeOption.quoteId}` : "Create draft quote"}
```

`design/grid/[id]/set/page.tsx`: add the `quoteNumbersFor` import. Directly above `  const tb = (d: DrawingSheetDef, i: number) =>`, add:

```ts
  // #223 — printed as the estimate number; the option still keys by id.
  const optionQuoteNo = option.quoteId ? (await quoteNumbersFor([option.quoteId])).get(option.quoteId) ?? option.quoteId : null;
```

then change `option: { name: option.name, quoteId: option.quoteId },` to `option: { name: option.name, quoteId: optionQuoteNo },` (the title block's `quoteId` is printed text only: `grid-drawing-set.ts` copies it into the block). Also change `` {`${project.id}${option.quoteId ? ` · ${option.quoteId}` : ""}`} `` to `` {`${project.id}${optionQuoteNo ? ` · ${optionQuoteNo}` : ""}`} ``.

`design/grid/[id]/actions.ts`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. Change `` note: `${option.name} quoted as ${existing.id}` `` to `` note: `${option.name} quoted as ${displayQuoteNumber(existing)}` ``, and `` note: `${option.name} quoted as ${q.id}` `` to `` note: `${option.name} quoted as ${displayQuoteNumber(q)}` ``.

- [ ] **Step 4: Designs + Home promote.**

`design/designs/actions.ts`: add `import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";`. In the promote action's return type, change `{ ok: true; quoteId: string }` to `{ ok: true; quoteId: string; quoteNumber: string }`. At each of its two ok returns, add the number:

```ts
    return { ok: true, quoteId: result.quoteId, quoteNumber: (await quoteNumbersFor([result.quoteId])).get(result.quoteId) ?? result.quoteId };
```

```ts
  return { ok: true, quoteId: q.id, quoteNumber: (await quoteNumbersFor([q.id])).get(q.id) ?? q.id };
```

(The second can use `displayQuoteNumber(q)` if `q` is a full quote there. Either is correct.)

`design/designs/design-client.tsx`: under `  const [promotedId, setPromotedId] = useState<string | null>(null);` add `  const [promotedNo, setPromotedNo] = useState<string | null>(null);`. Next to `      setPromotedId(res.quoteId);` add `      setPromotedNo(res.quoteNumber);`. Change `{promotedId}</b>` in "Design linked to quote" to `{promotedNo ?? promotedId}</b>`. The link keeps `promotedId`. Wherever the code clears `setPromotedId(null)`, also call `setPromotedNo(null)`.

`src/app/(app)/home-actions.ts`: add the `quoteNumbersFor` import. Change the return type's ok branch to `{ ok: true; id: string; number: string }`, and `return { ok: true, id: res.quoteId };` to:

```ts
  return { ok: true, id: res.quoteId, number: res.quoteNumber ?? res.quoteId };
```

If `promoteFromDesigns` is the designs action edited above, its result now carries `quoteNumber`. If it is a different function without that field, use `(await quoteNumbersFor([res.quoteId])).get(res.quoteId) ?? res.quoteId` instead.

`src/app/(app)/home-my-designs.tsx`: under `  const [promoted, setPromoted] = useState<string | null>(null);` add `  const [promotedNo, setPromotedNo] = useState<string | null>(null);`. Next to `      setPromoted(res.id);` add `      setPromotedNo(res.number);`. Add `setPromotedNo(null)` next to each `setPromoted(null)`. Change `<b style={{ fontFamily: "var(--font-mono)" }}>{promoted}</b>` to `<b style={{ fontFamily: "var(--font-mono)" }}>{promotedNo ?? promoted}</b>`. The `href` keeps `promoted`.

- [ ] **Step 5: Specs.**

`design/specs/page.tsx`: add `import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";`. Change `sourceLabel` to:

```ts
function sourceLabel(s: SpecDocSource, quoteNos: Map<string, string>): string {
  if (s.kind === "quote") {
    const qid = s.quoteId || s.id || "";
    return `Quote ${quoteNos.get(qid) ?? qid}`.trim();
  }
  if (s.kind === "grid") return `Grid: ${s.label || s.id || ""}`.trim();
  return "From scratch";
}
```

After `  const [user, docs, sections] = await Promise.all([…]);`, add:

```ts
  const specQuoteNos = await quoteNumbersFor(docs.map((d) => (d.source.kind === "quote" ? d.source.quoteId || d.source.id : d.source.quoteId)));
```

and change `{sourceLabel(d.source)}` to `{sourceLabel(d.source, specQuoteNos)}`.

`design/specs/new/page.tsx`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. In the two notice strings, change `(quote ${q.id})` to `(quote ${displayQuoteNumber(q)})` and `` `From quote ${q.id} — ${SECTION_PICK_NOTE}` `` to `` `From quote ${displayQuoteNumber(q)} — ${SECTION_PICK_NOTE}` ``. `bomFromQuote(q.id)` and `quoteId: q.id` stay.

`design/specs/[id]/page.tsx`: add the `quoteNumbersFor` import. Directly above `  return (`, add:

```ts
  // #223 — the source quote's estimate number for the header's Source line.
  const srcQuoteId = doc.source.quoteId || (doc.source.kind === "quote" ? doc.source.id : undefined);
  const sourceQuoteNumber = srcQuoteId ? (await quoteNumbersFor([srcQuoteId])).get(srcQuoteId) ?? null : null;
```

and pass `sourceQuoteNumber={sourceQuoteNumber}` to `<Builder`.

`design/specs/[id]/builder.tsx`: in `export default function Builder({`, add `sourceQuoteNumber,` to the destructured props and `  sourceQuoteNumber: string | null;` to its props type. Change `<HeaderCard doc={doc} customerOptions={customerOptions} canEdit={canEdit} />` to `<HeaderCard doc={doc} customerOptions={customerOptions} canEdit={canEdit} sourceQuoteNumber={sourceQuoteNumber} />`.

`design/specs/[id]/header-fields.tsx`: change `sourceText` to:

```ts
export function sourceText(s: SpecDocSource, quoteNumber?: string | null): string {
  if (s.kind === "quote") return `From quote ${quoteNumber || s.quoteId || s.id || ""}${s.label && s.label !== s.quoteId ? ` — ${s.label}` : ""}`;
  if (s.kind === "grid") return `From Grid design ${s.id || ""}${s.quoteId ? ` (quote ${quoteNumber || s.quoteId})` : ""}`;
```

and keep its remaining lines unchanged. In `HeaderCard`, add `sourceQuoteNumber,` to the destructured props and `  sourceQuoteNumber?: string | null;` to its props type. Change `Source: {sourceText(doc.source)}` to `Source: {sourceText(doc.source, sourceQuoteNumber)}`.

- [ ] **Step 6: Consulting engagements.**

`design/engagements/data.ts`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. Change `export type QuoteLite = { id: string; value: number; status: string; name: string };` to `export type QuoteLite = { id: string; number: string; value: number; status: string; name: string };`, and `quotesById[q.id] = { id: q.id, value: q.value || 0, status: q.status, name: q.name };` to `quotesById[q.id] = { id: q.id, number: displayQuoteNumber(q), value: q.value || 0, status: q.status, name: q.name };`.

`design/engagements/view.tsx`:
- `Quote {q.id} · {money(q.value)} ({q.status})` → `Quote {q.number} · {money(q.value)} ({q.status})`
- `                  {eng.quoteId}` (inside the "Source quote:" link) → `                  {data.quotesById[eng.quoteId]?.number ?? eng.quoteId}`
- `useState(eng.installQuoteId || "")` → `useState((eng.installQuoteId && data.quotesById[eng.installQuoteId]?.number) || eng.installQuoteId || "")`
- both `placeholder="Q-…"` → `placeholder="CON-1010 or Q-…"` (proposal) and `placeholder="EST-1005 or Q-…"` (install), and `aria-label="Consulting quote id"` → `aria-label="Consulting quote number"`

`design/engagements/actions.ts`: add `import { findQuoteIdByNumberOrId } from "@/lib/stores/estimate-numbers";`.
- In `linkInstallQuoteAction`, replace from `  const clean = quoteId ? String(quoteId).trim() : null;` through the closing `  }` of `if (clean) { … }` with:

```ts
  const typed = quoteId ? String(quoteId).trim() : "";
  // #223: accept an estimate number (EST-1005) as well as an internal id.
  const clean = typed ? await findQuoteIdByNumberOrId(typed) : null;
  if (typed) {
    // #35: validate the reference — the field used to accept any string.
    const q = clean ? await getQuote(clean) : null;
    if (!q) return { ok: false, error: `No quote ${typed} exists.` };
    if (q.quoteType === "consulting")
      return {
        ok: false,
        error: "That's a consulting quote — link the install (system) quote Peak bid on the spec.",
      };
  }
```

  (`d.installQuoteId = clean;` below stays, so the resolved id is what gets stored.)
- In `attachProposalAction`, replace

```ts
  const clean = String(quoteId || "").trim();
  if (!clean) return { ok: false, error: "Enter the consulting quote id (Q-…)." };
  const r = await attachQuoteToEngagement(engId, clean, { name: user.name });
```

  with

```ts
  const typed = String(quoteId || "").trim();
  if (!typed) return { ok: false, error: "Enter the consulting quote number (CON-…) or id (Q-…)." };
  // #223: resolve a typed estimate number to its quote id; an unknown value
  // passes through so attachQuoteToEngagement reports it as before.
  const clean = (await findQuoteIdByNumberOrId(typed)) ?? typed;
  const r = await attachQuoteToEngagement(engId, clean, { name: user.name });
```

`src/lib/stores/engagements.ts`: add `import { displayQuoteNumber } from "@/lib/estimate-number";`. In `attachQuoteToEngagement`, change `` decision: `Proposal attached: ${quoteId}`, `` to use the quote this function already loaded for its "not a consulting proposal" check. With that variable named `q`: `` decision: `Proposal attached: ${q ? displayQuoteNumber(q) : quoteId}`, ``. If it has another name, use that name.

`design/engagements/spec/page.tsx`: add the `displayQuoteNumber` import. In the `.map` that builds each `sourceQuotes` item (`{ id: q.id, name: …, customer: …, value: … }`), add `number: displayQuoteNumber(q),`.

`design/engagements/spec/generator.tsx`: change the prop type `sourceQuotes: Array<{ id: string; name: string; customer: string; value: number }>;` to `sourceQuotes: Array<{ id: string; number: string; name: string; customer: string; value: number }>;`, and the displayed `{q.id}` in the related-quotes list (the `<span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>{q.id}</span>`) to `{q.number}`. `key={q.id}` stays.

- [ ] **Step 7: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL' /tmp/e223.log; tail -2 /tmp/e223.log`
Expected: no FAIL, `ALL PASSED`.

- [ ] **Step 8: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log; grep -c '^FAIL' /tmp/e223.log   # Task 5 count + 8 ; 0
FILES=( "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/set/page.tsx" "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/designs/actions.ts" "src/app/(app)/design/designs/design-client.tsx" "src/app/(app)/home-actions.ts" "src/app/(app)/home-my-designs.tsx" "src/app/(app)/design/specs/page.tsx" "src/app/(app)/design/specs/new/page.tsx" "src/app/(app)/design/specs/[id]/page.tsx" "src/app/(app)/design/specs/[id]/builder.tsx" "src/app/(app)/design/specs/[id]/header-fields.tsx" "src/app/(app)/design/engagements/data.ts" "src/app/(app)/design/engagements/view.tsx" "src/app/(app)/design/engagements/actions.ts" src/lib/stores/engagements.ts "src/app/(app)/design/engagements/spec/page.tsx" "src/app/(app)/design/engagements/spec/generator.tsx" scripts/test-review-and-spec.ts )
npx eslint "${FILES[@]}"
npx next build
git add "${FILES[@]}"
git commit -m "feat(quotes): estimate numbers across the Grid, Designs, Specs and consulting engagements (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Display sweep D — leads, opportunities, Home, reviews, queue, bell, companies, inbox, projects/schedules; client-import guard

**Files:**
- Modify: `src/lib/estimate-number.ts` (add `relabelLinkedRecord`)
- Modify: `src/app/(app)/leads/types.ts`, `…/leads/lib.ts`, `…/leads/page.tsx`, `…/leads/lead-drawer.tsx`
- Modify: `src/app/(app)/opportunities/page.tsx`
- Modify: `src/app/api/leads/intake/route.ts`, `src/app/lead-intake/intake-form.tsx`
- Modify: `src/app/(app)/page.tsx`, `src/app/(app)/home-pipeline.tsx`, `src/lib/dashboard/home-metrics.ts`
- Modify: `src/app/(app)/reviews/page.tsx`, `src/app/(app)/reviews/review-list.tsx`, `src/lib/queue.ts`, `src/lib/nav-counts.ts`
- Modify: `src/app/(app)/companies/[id]/page.tsx`, `src/lib/customer-feed-rows.ts`, `src/lib/venue-history-server.ts`
- Modify: `src/app/(app)/inbox/page.tsx`
- Modify: `src/app/(app)/projects/view.tsx`, `src/app/(app)/inspections/scheduling/page.tsx`, `src/app/(app)/rentals/board/page.tsx`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: Task 1 helpers. Task 3 `quoteNumbersFor`, `leadNumbersFor`, `getQuote` (`get` from quotes store).
- Produces: `relabelLinkedRecord(stored: string | null | undefined, id: string, number: string | null | undefined): string` (pure); `DrawerDetailVM.number: string`, `DrawerDetailVM.quoteNumber: string`; `buildDrawerVM(l, convertedQuote?)`; `ReviewItem.displayId: string`; the intake route response gains `number`.

**Deliberately left on internal ids** (keys or diagnostics, not labels people use; reviewers should not flag them):
- Gmail labels `Peak/Quotes/<id>` / `Peak/Leads/<id>` (`gmail/peak-labels.ts`, `label-interpret.ts`). They are parsed back into ids.
- "Won quotes could not be reconciled (ids …)" admin banners (`projects/page.tsx`, `field-work/page.tsx`, `schedule/page.tsx`, `design/engagements/page.tsx`, `[id]/page.tsx`) and the Daylite import preview (`history-commit.ts` "linked to quote …"). These are support diagnostics keyed to data.
- Text already stored before this change: activity notes, revision notes, repair-job source labels, engagement decisions. They are snapshots. New writes use numbers (Tasks 3, 5, 6). Stored inbox link labels are relabelled live in Step 6.
- `src/lib/quote-email.ts` is dead code with no callers. Leave it.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
/* ======================================================================
   #223 — display sweep D + the client-import guard.
   ====================================================================== */
import { relabelLinkedRecord as e223Relabel } from "@/lib/estimate-number";
import { quoteFeedRows as e223FeedRows } from "@/lib/customer-feed-rows";
{
  ok(e223Relabel("Q-2041 · Lakefront", "Q-2041", "FLM-1002") === "FLM-1002 · Lakefront", "#223 relabel: a stored 'id · name' label shows the number");
  ok(e223Relabel("FLM-1002 · Lakefront", "Q-2041", "FLM-1002") === "FLM-1002 · Lakefront", "#223 relabel: a label already carrying the number is left alone");
  ok(e223Relabel("", "L-1050", "OPP-1003") === "OPP-1003" && e223Relabel(null, "L-1050", null) === "L-1050", "#223 relabel: blank label → number, else id");
  ok(e223Relabel("Custom text", "Q-2041", "EST-1001") === "Custom text", "#223 relabel: a hand-written label is kept");
  const fr = e223FeedRows({ id: "Q-2041", estNo: 1002, quoteType: "flame_test", name: "Riverside", history: [{ at: 1, to: "sent" }] });
  ok(fr[0]?.title === "Quote FLM-1002 sent", "#223 company feed: quote rows name the estimate number");
  const leadsPage = e223Src("src/app/(app)/leads/page.tsx");
  ok(leadsPage.includes("idContact: displayLeadNumber(l)") && leadsPage.includes("buildDrawerVM(leadRec, convertedQuote)"), "#223 leads: table + drawer use numbers");
  ok(e223Src("src/app/(app)/leads/lead-drawer.tsx").includes("Open quote {vm.quoteNumber}"), "#223 lead drawer: 'Open quote' names the number");
  ok(e223Src("src/app/(app)/opportunities/page.tsx").includes("numberOf(r)"), "#223 opportunities board cards carry the number");
  ok(e223Src("src/app/(app)/inbox/page.tsx").includes("relabelLinkedRecord("), "#223 inbox: work-link labels show live numbers");
  ok(e223Src("src/app/(app)/reviews/review-list.tsx").includes("{it.displayId}"), "#223 reviews list names quotes by number");
  // No client component may import the server-only allocator/lookup module.
  const clientImporters: string[] = [];
  for (const rel of e223ReadDir(e223Join(process.cwd(), "src"), { recursive: true }) as string[]) {
    if (!/\.(tsx?|jsx?)$/.test(rel)) continue;
    const src = e223ReadFile(e223Join(process.cwd(), "src", rel), "utf8");
    if (/^\s*["']use client["']/.test(src) && src.includes("@/lib/stores/estimate-numbers")) clientImporters.push(rel);
  }
  ok(clientImporters.length === 0, `#223 no "use client" file imports @/lib/stores/estimate-numbers (${clientImporters.join(", ")})`);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit 2>&1 | grep -c relabelLinkedRecord`
Expected: ≥ 1 (the missing export). Then `npm run test:specs` is expected to show the new `#223` assertions failing once it compiles.

- [ ] **Step 3: `relabelLinkedRecord`.** Append to `src/lib/estimate-number.ts`:

```ts
/**
 * A record link's stored label, shown with the record's CURRENT number
 * (#223). Links written before estimate numbers stored `"<internal id> · name"`;
 * new ones store `"<number> · name"`. Hand-written labels are kept.
 */
export function relabelLinkedRecord(
  stored: string | null | undefined,
  id: string,
  number: string | null | undefined
): string {
  const label = stored || id;
  if (!number || number === id) return label;
  if (label.startsWith(number)) return label;
  if (label.startsWith(id)) return number + label.slice(id.length);
  return label;
}
```

- [ ] **Step 4: Leads.**

`leads/types.ts`: in `DrawerDetailVM`, under `  id: string;` add:

```ts
  /** #223 — OPP-1005 (falls back to the id). */
  number: string;
```

and next to its existing `quoteId: string;` field add `  /** #223 — the converted quote's estimate number ("" when none). */\n  quoteNumber: string;`.

`leads/lib.ts`: add `import { displayLeadNumber, displayQuoteNumber, type QuoteNumberFields } from "@/lib/estimate-number";`. Change the signature to `export function buildDrawerVM(l: LeadRecord, convertedQuote: (QuoteNumberFields & { id: string }) | null = null): DrawerDetailVM {`. In its returned object, add `number: displayLeadNumber(l),` next to `id`, and after `    quoteId: l.convertedQuoteId || "",` add:

```ts
    quoteNumber: convertedQuote ? displayQuoteNumber(convertedQuote) : l.convertedQuoteId || "",
```

`leads/page.tsx`:
- imports: `import { displayLeadNumber } from "@/lib/estimate-number";` and `import { get as getQuote } from "@/lib/stores/quotes";`
- directly after the `const leadRec =` statement (it ends with `;`), add:

```ts
  // #223 — the converted quote, so the drawer can name it by its number.
  const convertedQuote = leadRec?.convertedQuoteId ? await getQuote(leadRec.convertedQuoteId) : null;
```

- `vm={drawerMode === "detail" && leadRec ? buildDrawerVM(leadRec) : null}` → `vm={drawerMode === "detail" && leadRec ? buildDrawerVM(leadRec, convertedQuote) : null}`
- board card: `        sub: l.interest || "New enquiry",` → `        sub: `${displayLeadNumber(l)} · ${l.interest || "New enquiry"}`,`
- worklist: in `workRow`, change `      sub,` (in the returned object) to `      sub: `${displayLeadNumber(l)} · ${sub}`,`
- table: `      idContact: l.id + (l.contact ? " · " + l.contact : ""),` → `      idContact: displayLeadNumber(l) + (l.contact ? " · " + l.contact : ""),`

`leads/lead-drawer.tsx`: `{vm.id}</span>` (the mono header span) → `{vm.number}</span>`; `Open quote {vm.quoteId} →` → `Open quote {vm.quoteNumber} →`. The `href` keeps `vm.quoteId`.

- [ ] **Step 5: Opportunities + public intake.**

`opportunities/page.tsx`: add `import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";`. Directly above `  const cardOf = (r: OppRow): BoardCardVM => {`, add:

```ts
  // #223 — every card carries its estimate number (OPP-1005 / FLM-1002).
  const leadNo = new Map(leads.map((l) => [l.id, displayLeadNumber(l)]));
  const quoteNo = new Map(quotes.map((q) => [q.id, displayQuoteNumber(q)]));
  const numberOf = (r: OppRow): string => (r.kind === "lead" ? leadNo.get(r.id) : quoteNo.get(r.id)) ?? r.id;
```

and in `cardOf`, change `      sub: r.sub,` to `      sub: r.sub ? `${numberOf(r)} · ${r.sub}` : numberOf(r),`. If the page renders a table view from `OppRow` (search the file for `r.sub` or `row.sub`), apply the same expression there.

`src/app/api/leads/intake/route.ts`: add `import { displayLeadNumber } from "@/lib/estimate-number";`, and change `return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });` to `return NextResponse.json({ ok: true, id: lead.id, number: displayLeadNumber(lead) }, { status: 201 });`.

`src/app/lead-intake/intake-form.tsx`: in the sent-state type, change `useState<{ id: string; org: string; first: string } | null>` to `useState<{ id: string; number: string; org: string; first: string } | null>`. In the success branch, change `const data: { id?: string } = …` to `const data: { id?: string; number?: string } = …`, and add `number: data.number || data.id || "OPP-—",` inside `setSent({`. Change the displayed `{sent.id}` (the "reference number" line) to `{sent.number}`.

- [ ] **Step 6: Home, reviews, queue, bell, companies, inbox.** Add `import { displayQuoteNumber } from "@/lib/estimate-number";` (or `displayLeadNumber` / both, as used) to each file.

- `src/app/(app)/page.tsx`: `` meta: `${sheetQ.id} · ${sheetQ.customer || "—"}`, `` → `` meta: `${displayQuoteNumber(sheetQ)} · ${sheetQ.customer || "—"}`, ``
- `src/app/(app)/home-pipeline.tsx`: `` const meta = `${q.id} · ${q.customer || "—"} · `` → `` const meta = `${displayQuoteNumber(q)} · ${q.customer || "—"} · `` (the rest of the template stays)
- `src/lib/dashboard/home-metrics.ts`: both `` detail: `${q.id} · ${money(q.value)} · `` → `` detail: `${displayQuoteNumber(q)} · ${money(q.value)} · `` (`id: q.id` and `key` stay)
- `src/app/(app)/reviews/page.tsx`: in `type RawItem`, add `  /** #223 — what the list shows (a quote's number; a design's id). */\n  displayId: string;`. In the quotes map, add `displayId: displayQuoteNumber(q),` after `id: q.id,`. In the designs map, add `displayId: d.id,` after `id: d.id,`. In the `items` map's returned object, add `displayId: x.displayId,`.
- `src/app/(app)/reviews/review-list.tsx`: in `ReviewItem`, add `  displayId: string;` under `  id: string;`; change the displayed `{it.id}` to `{it.displayId}`.
- `src/lib/queue.ts`: `` title: r.reviewer ? `Review quote ${q.id}` : `Unclaimed review: quote ${q.id}`, `` → `` title: r.reviewer ? `Review quote ${displayQuoteNumber(q)}` : `Unclaimed review: quote ${displayQuoteNumber(q)}`, `` (`key` stays)
- `src/lib/nav-counts.ts`: `        title: l.org || l.contact || l.id,` → `        title: l.org || l.contact || displayLeadNumber(l),`
- `src/app/(app)/companies/[id]/page.tsx`: `{qt.name || qt.id}` → `{qt.name || displayQuoteNumber(qt)}`; the mono `>{qt.id}</div>` → `>{displayQuoteNumber(qt)}</div>`. `key` stays.
- `src/lib/customer-feed-rows.ts`: add `import { displayQuoteNumber } from "@/lib/estimate-number";` and extend the header comment's "ONE allowed import" sentence with: "…and `@/lib/estimate-number` (#223), which is pure by construction." In `quoteFeedRows`' parameter type add `  estNo?: number | null;\n  estSuffix?: number | null;\n  quoteType?: string | null;` under `  id: string;`. At the top of the function body add `  const label = displayQuoteNumber(q);`, and change the three texts `` `Quote ${q.id} ${…}` ``, `` `Quote ${q.id} PO received` ``, `` `Quote ${q.id} accepted in portal` `` to use `${label}` in place of `${q.id}`. Row keys (`` `quote:${q.id}:…` ``) and `href` stay. (The existing `#21` assertions pass no `estNo`, so they still read `Quote Q-2041 …`.)
- `src/lib/venue-history-server.ts`: `title: q.name || q.id,` → `title: q.name || displayQuoteNumber(q),`
- `src/app/(app)/inbox/page.tsx`: add `import { relabelLinkedRecord, displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";` and `import { leadNumbersFor, quoteNumbersFor } from "@/lib/stores/estimate-numbers";`.
  - picker labels: `` .map((q) => ({ value: q.id, label: `${q.id} · ${q.name || "Quote"}` })), `` → `` .map((q) => ({ value: q.id, label: `${displayQuoteNumber(q)} · ${q.name || "Quote"}` })), `` and `` .map((l) => ({ value: l.id, label: `${l.id} · ${l.org || l.contact || "Lead"}` })), `` → `` .map((l) => ({ value: l.id, label: `${displayLeadNumber(l)} · ${l.org || l.contact || "Lead"}` })), ``
  - directly above `    const messages: MessageVM[] = (sel.messages || []).map((m) => ({`, add:

```ts
    // #223 — stored link labels were written as "<internal id> · name"; show
    // each linked quote/lead by its current estimate number instead.
    const linkedRefs: Array<{ type: string; id: string }> = [];
    for (const k of [sel.link, ...(sel.messages || []).map((m) => m.link)]) if (k) linkedRefs.push({ type: k.type, id: k.id });
    const [linkQuoteNos, linkLeadNos] = await Promise.all([
      quoteNumbersFor(linkedRefs.filter((k) => k.type === "quote").map((k) => k.id)),
      leadNumbersFor(linkedRefs.filter((k) => k.type === "lead").map((k) => k.id)),
    ]);
    const linkLabel = (k: { type: string; id: string; label?: string | null }) =>
      relabelLinkedRecord(
        k.label,
        k.id,
        k.type === "quote" ? linkQuoteNos.get(k.id) : k.type === "lead" ? linkLeadNos.get(k.id) : null
      );
```

  - `            label: m.link.label || m.link.id,` → `            label: linkLabel(m.link),`
  - `            label: sel.link.label || sel.link.id,` → `            label: linkLabel(sel.link),`

  If `tsc` reports that a `m.link`/`sel.link` type lacks `label` or has `label?: string` only, the `linkLabel` parameter type already accepts both. If it reports that the page's enclosing function is not async at that point, move the lookup to the nearest enclosing `async` scope that has `sel`.

- [ ] **Step 7: Projects and schedules (screens holding only an id).**

- `src/app/(app)/projects/view.tsx`: add `import { displayQuoteNumber, type QuoteNumberFields } from "@/lib/estimate-number";`, and change `{q.id} · {custName(` to `{displayQuoteNumber(q as QuoteNumberFields & { id: string })} · {custName(` (`QuoteLike` is `Record<string, unknown> & …`, so the cast only narrows `estNo`'s type). The hidden `name="quoteId"` input stays.
- `src/app/(app)/inspections/scheduling/page.tsx`: add `import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";`. After the `const [records, roster, customers] = await Promise.all([…]);` statement, add `  const recQuoteNos = await quoteNumbersFor(records.map((r) => r.quoteId));`, and change `(r.quoteId ? " · from " + r.quoteId : "")` to `(r.quoteId ? " · from " + (recQuoteNos.get(r.quoteId) ?? r.quoteId) : "")`.
- `src/app/(app)/rentals/board/page.tsx`: add the same import. After `const [bookings, items, locations] = await Promise.all([…]);`, add `  const bookingQuoteNos = await quoteNumbersFor(bookings.map((b) => b.quoteId));`, and change the link text `            {b.quoteId}` to `            {bookingQuoteNos.get(b.quoteId) ?? b.quoteId}`. The `href` stays. (`row` is declared inside the page component, so the map is in scope.)

- [ ] **Step 8: Final sweep for stragglers.** Run:

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
grep -rnE '\{(q|quote|qt|it|hit|vm|l|lead)\.id\}' src --include='*.tsx' | grep -vE 'key=|href=|value=|encodeURI|id=\{|Id=\{' | head -40
grep -rnE '`[^`]*\$\{(q|quote|l|lead)\.id\}[^`]*`' src --include='*.ts' --include='*.tsx' | grep -vE 'href|encodeURI|/api/|key|:\$\{|blob|Blob|label: `\$\{' | head -40
```

For each hit, decide whether the text is SHOWN to people as a quote/lead number and is not on the "deliberately left" list above. If so, change it the same way (`displayQuoteNumber`/`displayLeadNumber`, or `quoteNumbersFor` when only an id is in scope), and add the file to this task's commit. Record the hits you changed and the ones you left, with the reason, in the commit body.

- [ ] **Step 9: Run to verify it passes**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit && npm run test:specs > /tmp/e223.log 2>&1; grep '^FAIL' /tmp/e223.log; tail -2 /tmp/e223.log`
Expected: no FAIL, `ALL PASSED`.

- [ ] **Step 10: Gates + commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs > /tmp/e223.log 2>&1; grep -c '^PASS' /tmp/e223.log; grep -c '^FAIL' /tmp/e223.log   # Task 6 count + 11 ; 0
FILES=( src/lib/estimate-number.ts "src/app/(app)/leads/types.ts" "src/app/(app)/leads/lib.ts" "src/app/(app)/leads/page.tsx" "src/app/(app)/leads/lead-drawer.tsx" "src/app/(app)/opportunities/page.tsx" src/app/api/leads/intake/route.ts src/app/lead-intake/intake-form.tsx "src/app/(app)/page.tsx" "src/app/(app)/home-pipeline.tsx" src/lib/dashboard/home-metrics.ts "src/app/(app)/reviews/page.tsx" "src/app/(app)/reviews/review-list.tsx" src/lib/queue.ts src/lib/nav-counts.ts "src/app/(app)/companies/[id]/page.tsx" src/lib/customer-feed-rows.ts src/lib/venue-history-server.ts "src/app/(app)/inbox/page.tsx" "src/app/(app)/projects/view.tsx" "src/app/(app)/inspections/scheduling/page.tsx" "src/app/(app)/rentals/board/page.tsx" scripts/test-review-and-spec.ts )
npx eslint "${FILES[@]}"
npx next build
git add "${FILES[@]}"   # plus any file changed in Step 8
git commit -m "feat(quotes): estimate numbers on leads, opportunities, Home, reviews, inbox and the rest (#223)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Risks

1. **The production backfill runs inside the production build's migration step.** It does a few thousand single-row updates in one drizzle transaction, which should take seconds. It is guarded against malformed docs, but a genuinely unexpected shape still fails the deploy loudly (`scripts/migrate.mjs` prints the Postgres error), and nothing is half-applied, because drizzle wraps the migration in one transaction. Before merging, read the whole migration once more against D141.
2. **Old-deployment / preview stragglers** are numbered by the first create on the new code, not instantly. Until then they display their internal id (the spec's fallback). With low create volume this can last hours. If that matters, the Settings → Beta panel could get a "Number stragglers" button calling `assignEstimateNumbers()`. That is not in scope.
3. **Daylite history has no original dates** (`createdAt` = import time). Imported records therefore number together, in id (hash) order, after whatever existed before the import. "Date order" is only as good as the data. This is logged as decision 7.
4. **Read-modify-write races.** `patchDoc` writes the whole doc back. A patch that read a quote in the milliseconds before `assign_estimate_numbers()` numbered it can drop `estNo`, and the next create then gives that quote a new number. The window is creation-time only and tiny, but it can happen. The advisory lock serializes numbering, not patches.
5. **Lock interplay.** `assign_estimate_numbers()` holds advisory lock (223, 0) to the end of the caller's transaction. A create inside a long `withQuoteLock` transaction therefore serializes other creates behind it. On Postgres, a lock-order cycle with `withQuoteLock` (180, x) is theoretically possible. It would surface as Postgres's deadlock error, or as `withQuoteLock`'s own timeout, never as a silent wrong number.
6. **Other tests' fixtures now change as a side effect.** Any create numbers every unnumbered row, so their `rev` and `seq` move. Task 3 Step 9 says how to fix a pre-existing assertion that trips on that.
7. **Migration ordering across branches.** drizzle applies by `when`, so any other branch's migration must have a later `when` than this one once it lands. The journal script uses `max(now, last.when + 1)`. Re-check `drizzle/meta/_journal.json` if main gains a migration between Task 2 and merge.
8. **`drizzle-kit push` / future `generate`.** The new indexes and functions live only in SQL, not in `schema.ts`. That matches the repo's hand-written triggers (0012), but `drizzle-kit push` would try to drop them. The repo does not use `push`.

## Self-review (done while writing)

- **Spec coverage:** prefix map/format/parse/fallback → T1. `estNo`/`estSuffix` fields, sequence, sole allocator → T2. Allocation rules (new lead, lead carry, suffix, standalone, renewal, all create paths incl. importers) → T3. Backfill (date order, interleave, carry, suffixes, Daylite, soft-deleted, idempotent, setval) → T2. Display list: hub/My Quotes/drawer → T4; ⌘K + hub search by number AND old id, "was Q-2041" → T4; Estimator → T4; builders, letters, documents, PDFs, portal, renewals → T5; Grid confirmations, Designs, Specs → T6; opportunities, leads board/worklist/table/drawer, bell, Home, reviews, company, inbox links, queue → T7. Calendar chips and the task board were verified clean in recon, so they need no task. Testing section → T1 (pure), T3 (allocation), T2 (backfill), T4 (search landmarks), four gates + `next build`.
- **Types used across tasks:** `quoteNumbersFor`/`leadNumbersFor`/`findQuoteIdByNumberOrId` (T3) are used in T5–T7. `numberNewDoc`/`assignEstimateNumbers` (T2) are used in T3. `displayQuoteNumber` etc. (T1) are used everywhere. `relabelLinkedRecord` is defined and used in T7.
