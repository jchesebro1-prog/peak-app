# DaVinci → catalog enrichment: ports, datasheets and the ETC book

**Punch:** #162 · **Date:** 2026-09-23 · **Supersedes the reasoning in D187**

## 1. What this is

Peak's production catalog holds **3,959 ETC parts**, every one carrying both a
list price and a dealer cost. None of them carries a port, a datasheet link or
a symbol. ETC's own DaVinci product library — a 116 MB export sitting on Jeff's
machine — holds that missing metadata for **86.5% of them**.

This feature reads the DaVinci library, matches it against catalog rows Peak
already owns, and writes ports and document links onto the matches. It creates
no catalog rows, deletes none, and never touches a price.

It is an **enricher, not an importer**. That distinction is the whole design.
Jeff's instruction was "only import the items we have prices for" — matching on
SKU satisfies that literally and permanently: the tool enriches whatever is in
the catalog at the moment it runs, so re-running it after any future price-book
import picks up the new rows with no code change.

## 2. Measured facts

Every number below was measured against the live production database and the
DaVinci export on 2026-09-23. Nothing here is estimated.

### The catalog side (production, `catalog_parts`)

| | |
|---|---|
| Total parts | 37,403 |
| `mfr = 'ETC'` | 3,959 |
| ETC rows with both `list` and `cost` | 3,959 (100%) |
| ETC rows flagged `note` | 0 |
| **Parts anywhere in prod carrying `ports[]`** | **0** |

The last row is a separate finding and is written up in §9.

Production and local dev have diverged badly: local dev holds 14,725 parts with
10 ETC rows, production holds 37,403 with 3,959, plus Legrand AV (9,088), Draper
(8,605) and Crestron (1,633) that local dev has never seen. **This feature must
be developed against a local copy and run against production explicitly.**

### The DaVinci side

| | |
|---|---|
| Device types | 2,366 |
| …with ports | 1,381 |
| Distinct model/part numbers indexed | 15,059 |
| Documents (public `etcconnect.com` URLs) | 1,522 |
| Document types | Datasheet, Manual, Presentation, Brochure |
| Languages | English + 9 others |
| Manufacturers | ETC (1,370 ported), Echoflex (11), High End Systems |

### The match

| | rows | share of 3,959 |
|---|---|---|
| Matched a DaVinci entry | 3,424 | **86.5%** |
| …would receive ports | 2,629 | 66.4% |
| …would receive document links | 2,866 | 72.4% |
| No DaVinci entry | 535 | 13.5% |

The 535 misses are correct misses: `99XX-XX-XX` connector-strip configurator
placeholders, bare option codes (`AD`, `AO`, `BP24`), lamps (`HPL375/240X`),
clamps (`MEGA-CLAW-WH`). DaVinci does not model these as devices.

### The port vocabulary

DaVinci describes a port with three UUID references: a **protocol** (56),
a **connector type** (25) and a **direction** (5). Peak's `CONNECTION_TYPES`
(`src/lib/catalog-connect.ts`) has 22 entries.

Across the 2,629 matched parts that carry ports — **10,601 port rows**:

| | rows | share |
|---|---|---|
| Map onto Peak's existing 22 types | 8,719 | **82.2%** |
| No Peak equivalent | 1,882 | **17.8%** |
| **Parts left with zero ports if the unmapped are dropped** | **508 parts** | **19.3%** |

The unmapped 17.8% is concentrated in exactly the ETC lines Peak sells most of:

| category | pass-through port rows |
|---|---|
| ArcSystem Pro | 954 |
| Echo | 300 |
| Irideon | 210 |
| BluesSystem | 70 |
| Source Four Mini LED | 60 |

ArcSystem Pro is Peak's single largest ETC category (1,348 parts). Dropping the
unmapped protocols would import it unwireable.

### Why D187 concluded the opposite

D187 (2026-09-22) closed this idea with "the DaVinci ETC library is not
imported… It does not intersect Peak's catalog", citing four independent
verifications — including a brute-force match of 17,831 identifier-shaped
strings against 14,725 SKUs that found **9 matches**.

Every one of those checks was run against **local dev**, which holds 14,725
parts and 10 ETC rows. Production holds 37,403 parts and 3,959 ETC rows. The
measurements were accurate; the database was the wrong one. Against production
the intersection is 3,424 rows — 86.5%.

D187's factual claims about the library itself (2,366 types, 1,381 ported, 56
protocols, 25 connector types) all still hold. Only its conclusion falls. It
needs a superseding entry, and the "verify against the database the user
actually sees" lesson generalizes well beyond this feature.

## 3. Decisions

### D1 — Pass unmapped protocols through verbatim; do not collapse them

`canConnect` (`src/lib/catalog-connect.ts:138`) tests exact string equality on
`connectionType`, falling back only to an `interchangeable` wire-type family.
An imported `"EchoConnect"` therefore mates with another `"EchoConnect"` and
nothing else — correct, with zero false positives, and no engine change needed.

The alternative — collapsing `EchoConnect`, `Echoflex`, `DALI` and 0-10V into
`"contact closure"` or `"bare-end"` — would make the Grid validate an Echoflex
sensor against a DMX terminal block and report it as a good wire. That is the
same failure class as the `\bamp\b` bug in #159, which gave 61 passive speakers
four speakON NL4 outputs. **A wrong shape is worse than no shape.**

The only real cost of pass-through is that no `WireType` carries the new values,
so `compatibleWireTypes` returns `[]` and the Grid cannot offer a cable for
those runs. §5 adds the wire types that fix this.

### D2 — Key the protocol mapping on UUID, never on a name field

Neither DaVinci name field is unique:

- `constantName` collides: **`NewPortProtocol` names four distinct protocols** —
  three are ARCSYSTEM driver channels, one is an internal blank. Keying on it
  merges all four, mis-typing 350 port rows in production.
- `protocolSignalName` collides worse: 10 protocols share `F-DRIVE`, 10 share
  `""`, 5 share `POWER`, 3 each share `LINKCONNECT`, `AUXILIARY` and `REMOTE`.

The mapping table is therefore keyed on the protocol UUID, with a
human-readable label as the value. **The importer refuses to run if it meets a
protocol UUID absent from the table.** A future ETC library revision that adds
a protocol fails loudly instead of silently producing a wrong connection type.

The three ARCSYSTEM protocols stay distinct — they are different driver
families (D4 Driver CC, D2 Driver, D1HO Driver CE) and must not cross-connect:

| UUID | used by | label |
|---|---|---|
| `a39a614e-…` | D4 Driver CC, ArcSystem Pro | `ETC ArcSystem D4 driver` |
| `a9f1dd53-…` | D2 Driver, Pro One-Cell Micro | `ETC ArcSystem D2 driver` |
| `ce5efb79-…` | D1HO Driver CE, Pro One-Cell HO | `ETC ArcSystem D1HO driver` |
| `1660207c-…` | `RouteStubPrototype` only | excluded (see D5) |

### D3 — The connector field is advisory, not authoritative

DaVinci's connector data is dirty: `Power480V` appears on "MIDI Female",
`Power` on "DMX Male", and 448 DMX ports on "Terminal Block". The **protocol**
is the mapping key. The connector refines the result in exactly one place —
distinguishing powerCON from hardwired on a power port — and is otherwise
recorded only in the port's display name.

### D4 — Generic power becomes a new connection type, not a guess

1,417 power ports carry the generic connector `"Power"`, meaning "needs line
power, connector unspecified". Peak's existing power types are all specific
(Edison, stage pin, Socapex, powerCON/True1, bare-end) and deliberately not
interchangeable with each other. Calling a Source Four's pigtail "bare-end"
would be a lie on the label.

Add **`"line power (unspecified)"`** to `CONNECTION_TYPES` and to the
`powercon-power` wire type. It connects to itself — so a Source Four input
reaches a D20AF dimmer output, which is the real-world behaviour — and claims
nothing false. Jeff can refine individual rows in the #158 ports editor.

### D5 — Exclusions

- Category `Internal-DO NOT USE` and the `RouteStubPrototype` type: ETC internal
  test objects, never products.
- Non-English documents (399 Deutsch, 389 Francais, 120 Spanish, …). English
  Datasheet and Manual only; Presentation and Brochure are dropped.

### D6 — Never overwrite, never price

- A part that already has a non-empty `ports[]` is **skipped**, not merged,
  unless `--force` is passed. Manual edits from the #158 editor win.
- `list`, `cost`, `pricedAt` are never written. This tool has no opinion on price.
- `note` is never set. Jeff's "needs price" answer was given for an import that
  would create unpriced rows; this design creates none, so the flag writes
  nothing. The field stays available for the #159 rules engine's use.

### D7 — Run order against #159

DaVinci is manufacturer-authored data and outranks Peak's heuristic rules.
`applyRules` already skips any part with a non-empty `ports[]`
(`src/lib/catalog-port-apply.ts`), so enrichment first, rules second, needs no
coordination code — only this note.

### D8 — Commit a derived extract, not the 116 MB library

`data/davinci/` is gitignored and exists on one machine. The importer reads a
**compact derived extract** committed to the repo:
`data/davinci-extract.json` — for each matched-eligible model number, its
ports (already mapped), its English document links, and provenance
(`libraryTimestamp`, `typeId`).

Measured, not estimated: **1.35 MB minified** — 1,720 records, 14,108 indexed
identifiers, 6,241 ports and 2,836 document links, covering every eligible
DaVinci type. (The subset that matches today's catalog is smaller still: the
3,424 matched rows are backed by only **908 distinct types**, because one type
covers many SKU variants — `ColorSource PAR` alone covers 11 — and comes to
0.52 MB. The extract carries the full set so a future price-book import needs
no regeneration.) Small enough to commit, diff and review like any other
source file.

A separate `npm run davinci:extract` regenerates it from the full library when
ETC ships a new export. This makes the enrichment reproducible on any machine
and in CI, keeps the reviewable artifact in git, and means losing the 116 MB
blob costs a re-download rather than the feature.

## 4. Architecture

Five units, each independently testable.

```
data/davinci/source/<ts>/library.json      (116MB, gitignored, one machine)
        │
        │  npm run davinci:extract
        ▼
src/lib/davinci/protocol-map.ts   ← hand-written, UUID-keyed, reviewed
src/lib/davinci/extract.ts        ← library.json → DavinciRecord[]
        │
        ▼
data/davinci-extract.json          (2–4MB, committed, the review artifact)
        │
        │  npm run davinci:enrich
        ▼
src/lib/davinci/match.ts          ← normalized SKU → DavinciRecord
src/lib/catalog-davinci-apply.ts  ← the only writer
scripts/davinci-enrich.ts         ← report + apply CLI
```

### `src/lib/davinci/protocol-map.ts`

```ts
export type ProtocolMapping =
  | { kind: "peak"; connectionType: string }          // an existing CONNECTION_TYPES entry
  | { kind: "peak-by-connector"; powercon: string; hardwired: string; generic: string }
  | { kind: "passthrough"; connectionType: string }   // a new, ETC-specific type
  | { kind: "exclude"; why: string };

export const PROTOCOL_MAP: Readonly<Record<string, ProtocolMapping>>;
export const DIRECTION_MAP: Readonly<Record<string, PortDirection>>;
export function mapProtocol(protocolId: string, connectorLabel: string):
  { connectionType: string } | { excluded: true } ;   // throws on unknown UUID
```

Pure, no I/O, no DB. All 56 protocol UUIDs enumerated explicitly — the file is
the review artifact Jeff reads, the same way `PORT_RULES` was for #159.

Direction map: `Input → "in"`, `Output → "out"`, `Bidirectional → "io"`,
`Bus → "io"`, `Configurable → "io"`.

### `src/lib/davinci/extract.ts`

```ts
export type DavinciDoc = { kind: "datasheet" | "manual"; label: string; url: string };
export type DavinciRecord = {
  modelNumbers: string[];      // normalized, all model+part numbers of the type
  displayName: string;
  category: string;
  ports: Port[];               // already mapped through protocol-map
  docs: DavinciDoc[];          // English Datasheet + Manual only
  typeId: string;
  libraryTimestamp: string;
};
export function extractLibrary(libraryJson: unknown): DavinciRecord[];
```

### `src/lib/davinci/match.ts`

```ts
export function normalizeSku(s: string): string;   // uppercase, strip non-alphanumeric
export function buildIndex(records: DavinciRecord[]): Map<string, DavinciRecord>;
export function matchPart(part: { sku: string }, index: Map<string, DavinciRecord>):
  DavinciRecord | null;
```

`normalizeSku` must be shared by extract and match so they cannot drift — the
same lesson as `scripts/daylite-ids.ts` in #147.

### `src/lib/catalog-davinci-apply.ts`

```ts
export type EnrichPlan = {
  sku: string; displayName: string;
  ports: Port[]; docs: DavinciDoc[];
  skipped?: "has-ports" | "no-match" | "nothing-to-write";
};
export async function planEnrichment(opts: { mfr?: string; onlySkus?: string[] }):
  Promise<{ plans: EnrichPlan[]; stats: {...} }>;
export async function applyEnrichment(plans: EnrichPlan[], opts: { commit: boolean; force?: boolean }):
  Promise<{ written: number; skipped: number }>;
```

The **only** module that writes. Plan and apply are separate so the report can
render the exact rows the write would touch.

### `scripts/davinci-enrich.ts`

Follows `scripts/port-rules.ts` exactly:

```
npm run davinci:enrich                          → report, writes nothing
npm run davinci:enrich -- --mfr=ETC              → scope to one manufacturer
npm run davinci:enrich -- --apply                → dry run, writes nothing
npm run davinci:enrich -- --apply --commit       → write (hosted also needs --yes)
npm run davinci:enrich -- --unmatched            → CSV of the 535 + the DaVinci
                                                   types Peak does not stock
```

Two-flag convention via `scripts/db-target.ts` (`resolveDbTarget`,
`requireHostedConfirmation`): `--commit` means "I want to write", `--yes` means
"I know this is the live database". Preview and production share one Neon
database, so the two stay separate.

The gate in `scripts/db-target.ts` is correct as written and is reused
unchanged. The risk #159 actually hit (D202) was elsewhere and is worth
restating, because this feature has the same shape: `applyRules` walked every
row of `catalog_parts` by default, so the *test suite* — calling it with four
`TEST:` fixtures in scope — would have written **452 real catalog rows**, and
with an ambient `DATABASE_URL` would have reached Neon with no gate at all.
The lesson for this design: `planEnrichment`/`applyEnrichment` take an explicit
scope, tests pass `onlySkus`, and the suite runs on a scratch datadir. Test 11
below makes the hosted gate itself a proven behaviour rather than an assumed one.

## 5. Changes to existing files

### `src/lib/catalog-connect.ts`

Add to `CONNECTION_TYPES`:

- `"line power (unspecified)"` (D4), also added to the `powercon-power` wire type.
- The pass-through ETC families, grouped under a new `// ETC (DaVinci import)`
  comment block. The exact list is fixed by `PROTOCOL_MAP` and is the same set
  Jeff reviews there.

Add wire types for the ETC families that carry a real cable, so the Grid can
offer one: EchoConnect, LinkConnect, F-Drive (per driver family), DALI, 0-10V,
Multiverse, USB, MIDI. **None gets `interchangeable`** — `speaker-pair` remains
the only interchangeable family, for the reasons documented on the flag.

### `src/lib/stores/catalog.ts`

Add to `CatalogPart`:

```ts
/** Manufacturer document links (#162). Distinct from datasheetBlobKey, which
 *  is a Peak-uploaded PDF in Blob storage: these are the manufacturer's own
 *  public URLs, carried from the DaVinci library, and are never proxied. */
docs?: { kind: "datasheet" | "manual"; label: string; url: string }[];
/** Provenance for anything written by the DaVinci enricher (#162) — which
 *  library export and which ETC type a row's ports and docs came from, so a
 *  later run can tell its own writes from a human's. */
davinci?: { typeId: string; libraryTimestamp: string; enrichedAt: number };
```

JSONB, so no migration.

### UI

- Catalog part view: a "Documents" block linking out to `docs[]`, rendered with
  `rel="noopener noreferrer"` and an external-link affordance. These are
  third-party URLs — they are never fetched server-side and never proxied.
- The #158 ports editor gains a read-only "from ETC DaVinci" note when
  `davinci` is set, so a user knows they are about to override manufacturer data.

## 6. Testing

No jest or vitest in this repo — assertions are `ok(condition, message)` in
`scripts/test-review-and-spec.ts`. Follow that.

Pure-unit tests (no DB):

1. `normalizeSku` round-trip: `"IRWLZ-30/80-120-C-DALI-1"` and
   `"irwlz3080120cdali1"` normalize equal.
2. `mapProtocol` throws on an unknown UUID.
3. The four `NewPortProtocol` UUIDs map to four *different* connection types
   (the D2 regression guard).
4. `F-DRIVE`'s ten protocols do not collapse to one.
5. Generic `Power`/`Power` → `"line power (unspecified)"`; `Power`/`powerCON In`
   → `"powerCON/True1"`; `Power`/`Terminal Block` → `"bare-end"`.
6. Every `connectionType` produced by `PROTOCOL_MAP` is present either in
   `CONNECTION_TYPES` or in at least one `WireType` — no orphan values.
7. `canConnect` accepts ArcSystem D4 out ↔ D4 in, and **rejects** D4 out ↔ D2 in.
8. Direction: `Bus` and `Configurable` both → `"io"`.

DB tests, against a scratch datadir (`PGLITE_PATH=$(mktemp -d)`):

9. A part with existing `ports[]` is skipped without `--force`.
10. `list`, `cost` and `pricedAt` are byte-identical before and after a commit run.
11. A hosted target with `--commit` and no `--yes` exits non-zero and writes nothing.

`test:specs` must never write to a real catalog. #159 nearly shipped a suite
that would have written 452 real rows; the guards added in `b998816` and
`da106e9` stay in force and this suite inherits them.

## 7. Safety

- **Preview and production share one Neon database.** Any hosted run is a live
  write to the real catalog.
- Rollout: report → Jeff reads it → `--apply` dry run → `--apply --commit --yes`.
  Same gate as #159.
- `npm run db:export` before the first production commit run.
- The enricher is additive and idempotent: re-running writes nothing new.
- **Never open `.data/pglite` while another process may hold it** — PGlite is
  single-process and opening it runs `migrate()`. Development uses
  `PGLITE_PATH=$(mktemp -d)` or a copy.

## 8. Licensing

The DaVinci library is ETC's product data, and the document links point at
ETC's own public CDN. This design copies manufacturer specifications into a
dealer's internal catalog and links out to ETC's public datasheets — ordinary
dealer practice, and the reason ETC publishes the library. It does not
redistribute ETC's content to third parties and it does not rehost the PDFs.
Flagging it rather than deciding it: if Peak's ETC dealer agreement has a
field-of-use clause, this is worth a glance. Related open item: punch #72,
already logged for counsel.

## 9. Separate finding — production has no ported parts at all

Production returns **0** rows with a non-empty `ports[]`, out of 37,403.

That means the #39 starter set (55 ported parts) and everything #158 and #159
built exist only in local dev. **Grid wiring validation is inert in production
today.** Punch #39's status line claims the starter set was imported "to BOTH
local and prod in one run"; against production that is false.

This is not part of this feature, but it changes what shipping it means: this
enrichment would be the first port data production has ever had. Logged
separately so #39's status can be corrected.

## 10. Out of scope

- **Symbols.** DaVinci references 1,416 images but only 530 were downloaded in
  this export, and only 343 of 1,381 ported types have a product image on disk.
  Symbol import waits for a complete export. Grid palette seeding stays
  Jeff-gated as it is today.
- **Creating catalog rows.** 535 ETC parts have no DaVinci entry and ~1,381
  DaVinci types are not in Peak's book; both are reported, neither is written.
- **Non-ETC manufacturers.** The library only contains ETC, Echoflex and
  High End Systems.
- **Prices.** Never read, never written.
