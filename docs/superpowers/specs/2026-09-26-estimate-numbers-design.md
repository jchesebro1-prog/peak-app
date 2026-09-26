# Punch #223 — Estimate numbers: one shared counter, a prefix per type, everything renumbered

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks` (needs a migration → built after `origin/main`
contains the spec-builder branch's 0027).

Jeff (2026-09-26):

> I want the quote format to look less random. Let's just follow a simple estimate number growth so
> let's just renumber and start over but every opportunity, flame test, or really any estimate gets
> its own unique number.

Picks confirmed in chat: a **prefix per type on one shared counter**; prefixes **EST** (Estimator /
system), **FLM** (flame test), **RIG** (rigging inspection), **REP** (repair), **RNT** (rental),
**CON** (consulting), **OPP** (an opportunity not yet quoted); a lead's number **carries** to its
first quote (extra quotes on the same opportunity get `-2`, `-3`); **everything is renumbered,
including Daylite-imported history**, in date order, starting at 1001.

## Numbers are a display identity, not a new primary key
Internal ids (`Q-2041`, `L-1050`, …) stay exactly as they are: they are foreign keys in projects,
jobs, comms links, tasks, grid projects, revisions, portal, Gmail labels, URLs. Changing them is a
data migration across every collection for no user benefit. Instead every quote and lead gets an
**estimate number** that is what people see, say, search and print.

## Data
- Quotes and leads (JSONB docs) gain `estNo?: number` (the shared counter value) and quotes gain
  `estSuffix?: number` (2, 3, … for additional quotes on the same opportunity; absent for the first).
- Postgres sequence `estimate_number_seq` (migration, idempotent form) — the only allocator. A
  store helper `allocateEstimateNumber()` = `SELECT nextval('estimate_number_seq')`.
- Pure `src/lib/estimate-number.ts`:
  - `ESTIMATE_PREFIX: Record<QuoteType | "opportunity", string>` = system→EST, flame_test→FLM,
    inspection→RIG, repair→REP, rental→RNT, consulting→CON, opportunity→OPP (unknown quoteType →
    EST).
  - `formatQuoteNumber({ estNo, estSuffix, quoteType }) → "FLM-1002" | "EST-1005-2" | null`
  - `formatLeadNumber({ estNo }) → "OPP-1005" | null`
  - `displayQuoteNumber(q)` / `displayLeadNumber(l)` → the formatted number, falling back to the
    internal id when `estNo` is missing (so nothing ever renders blank).
  - `parseEstimateNumber("flm-1002") → { estNo: 1002, suffix: null, prefix: "FLM" }` (case- and
    separator-tolerant: `FLM1002`, `1002`, `#1002`, `1005-2`).

## Allocation rules (new records)
- New lead → `estNo = allocate()`.
- New quote:
  - made from a lead (the quote carries the lead's id — use whatever field links them today) whose
    `estNo` is set: `estNo = lead.estNo`; `estSuffix` = none if no other live quote shares that
    `estNo`, else the next free suffix starting at 2;
  - otherwise `estNo = allocate()`.
- Every quote-creating path goes through the store's create function, so allocation lives there
  (Estimator, Grid, Quick Design promote, flame/repair/inspection/rental/consulting builders,
  renewals, portal self-serve, inbox "+ New quote", importers). A renewal is a new estimate → new
  number.
- A quote's prefix follows its `quoteType`; the number never changes after allocation.

## Renumbering existing records (in the migration)
- The migration (after creating the sequence) assigns numbers to every existing lead and quote —
  including Daylite imports and soft-deleted records (so numbers never get reused) — in one ordered
  pass: order by the record's creation time (`createdAt`, else the earliest dated field the record
  has, else its id order), ties broken by id; leads and quotes interleaved.
  - A quote whose lead already received a number takes the lead's `estNo` (+ suffix rule above,
    suffixes assigned in date order).
  - Everything else takes the next number from 1001.
- Then `setval('estimate_number_seq', max(estNo))` so new records continue the sequence.
- Written as SQL over the JSONB doc tables (`jsonb_set`), idempotent: records that already have
  `estNo` are skipped, and re-running assigns nothing. If ordering by the JSONB date fields proves
  impractical in SQL, the planner may instead ship an idempotent TypeScript backfill that the
  migration step invokes — but it must run exactly once per database, before any new record is
  created on the new code, and never on a PGlite build worker.

## Display & search
- Every place a quote or lead number is shown to people uses `displayQuoteNumber` /
  `displayLeadNumber`: quotes hub (list, drawer, filters), My Quotes, opportunities, leads
  board/worklist/table/drawer, Estimator header, service builders, letters and quote documents,
  saved PDFs (#222), portal, email subjects/bodies the app writes (renewals), ⌘K search results,
  bell items, Home cards, reviews, company record, inbox work links, tasks/queue labels, calendar
  chips, Grid "Add to Quotes" confirmations. Internal ids stay in URLs.
- Search: ⌘K and the quotes hub search match the estimate number (via `parseEstimateNumber`) **and**
  the old internal id, so "Q-2041" still finds the quote; the quote drawer shows "was Q-2041" in
  small type.

## Not in scope
Changing internal ids or URLs; numbering projects, jobs, designs or rentals' bookings; per-type
counters.

## Testing
- Pure: prefix map, format, parse (all tolerated spellings), display fallback.
- Allocation: new lead, quote from a numbered lead (first → no suffix, second → `-2`), standalone
  quote, renewal gets a new number.
- Backfill: date-ordered interleaving, lead→quote carry, suffixes, Daylite imports included,
  idempotent re-run, sequence continues after max.
- Search by number and by old id.
- Four gates + `next build`.
