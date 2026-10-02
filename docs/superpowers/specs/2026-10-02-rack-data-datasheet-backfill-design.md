# Rack data from datasheets — one-time backfill (+ brief for an in-app version)

Status: **design approved by Jeff 2026-10-02, parked until he is back at the computer.**
Follows #296 (equipment racks). D582 lists "datasheet extraction from Part Documents" as a v1 follow-up; this is it.

## Why

Rack totals (weight, watts, BTU, amps) read "at least …" until catalog parts carry rack data. The
Rack data sheet (`/catalog/rack-data`, `src/lib/rack/part-facts-sheet.ts`) is the import path, but
filling it by hand from datasheets is the slow part.

DaVinci does not cover it (checked 2026-10-02 against
`data/davinci/source/2026-09-02T01-37-52-850Z/library.json`): it has RU for 117 rack-mount types
(`typeInformation.enclosureOptions.rackUnits`, ETC-only, ~57 matchable), no weight / width / depth,
"Wattage" is a blank designer-entered property, and "Aux Power Draw" is ETC low-voltage aux-bus load,
not mains watts. Ports are already on the parts from #162 (D209) and the rack builder doesn't use them.

## Decisions (Jeff, 2026-10-02)

1. **One-time backfill done in a Claude session, not in the app.** No app code, no AI in the app
   (D89 stands). Re-run when new rack gear arrives.
2. **Scope: rack-mountable gear in the production catalog**, picked by me, trimmed by Jeff before
   any datasheet is read.
3. **On-file datasheets only.** Parts with no datasheet stay blank and are listed. No web lookups,
   nothing attached to the catalog.
4. **Write a brief for a later in-app, deterministic version** that runs when datasheets are
   imported (§6).

## 1. Reading production (read-only)

The real catalog and datasheets are production-only (dev catalog differs — 14,725 vs 37,403 parts).
Jeff runs the Vercel env pull **into the session scratchpad, never the repo root**
(`.env.production.local` hazard). Everything is read-only: parts, `part_document_links`,
`part_documents`, and the datasheet bytes (private Blob for uploads; the manufacturer URL for
link-only docs such as the DaVinci ETC pre-fill). The only production write is Jeff's own upload of
the finished sheet through Catalog → Rack data.

## 2. Candidate list — checkpoint 1

Pick likely rack gear by:
- category (amplifiers, DSP/processors, network switches, PDUs, power conditioners, UPS, blanks,
  vents, shelves, drawers, rack-mount controllers);
- description text (`1RU`, `2U`, `rack mount`, `rack-mount`, `rackmount`, `half rack`, `rack space`);
- DaVinci's rack-mount flag for ETC parts (`isRackMount`/`rackMount`, **not** `rackUnits` alone —
  wall-mount ERn4 enclosures carry an RU value);
- rack-heavy manufacturers (Middle Atlantic, Furman, Crestron, QSC, Shure, Biamp, Luminex, Cisco,
  Netgear, ETC).

Skip parts whose rack data is already complete. Output `candidates.csv`: SKU, Manufacturer, MFR P/N,
Description, Category, why picked, has datasheet (Y/N). **Jeff trims it before extraction starts.**

## 3. Extraction rules — never guess

- **Right model:** when a datasheet covers several models, match the part's MFR P/N; ambiguous →
  blank + note.
- **Units:** kg → lb (× 2.2046), mm → in (÷ 25.4), rounded to 0.1.
- **RU height:** from "1U / 2RU / 2 rack spaces", or height ÷ 1.75 rounded to 0.5 only when the part
  is stated to be rack-mount.
- **Rack mount:** `rack` / `shelf` / `none` per the datasheet (shelf when it needs a shelf or tray kit).
- **Rack width:** `full` unless the sheet says half (`half`), third (`third`) or 23" (`23in`).
- **Depth:** overall chassis depth as stated; if both "with handles/connectors" and body depth are
  given, use the overall figure and note it.
- **Power (W):** typical / nominal consumption. **Max power (W):** maximum / rated. BTU/hr only →
  W = BTU ÷ 3.412, noted. VA only or fuse rating only → blank + note.
- **Outlet capacity (W):** PDUs / UPS rated output only.
- **Mount face / Airflow:** only when stated (`front`/`rear`/`both`;
  `front-to-rear`/`rear-to-front`/`side`/`passive`).
- Values must pass `cleanRackFacts` (half-RU steps, ≥ 0, enum values, notes ≤ 200 chars).

Datasheets are read in batches (~25 per subagent): PDF text first, page images when specs are in a
graphic table. Every value carries its page number and the quoted sentence it came from.

## 4. Output

- `rack-data-filled.csv` — exactly the import headers (`RACK_SHEET_HEADERS`) plus `Source document`,
  `Page`, `Evidence`, `Flags`, which the importer ignores (unknown columns are skipped).
- **Never overwrite:** the import writes any non-blank cell, so a cell is left blank wherever
  production already holds a value.
- `no-datasheet.csv` — candidates with nothing on file (a to-do for Catalog → Datasheets).
- Short summary: parts covered, cells filled per field, flags.

## 5. Verification

- A second, independent pass re-reads a random ~10% of parts; any disagreement is flagged in `Flags`.
- Run the sheet through `rackSheetRows` + `rackSheetPatch` locally so zero rows come back `invalid`.
- Jeff reviews, uploads through Catalog → Rack data, and checks the importer's results sheet.

## 6. Brief — in-app version, later (deterministic, no AI)

When a datasheet is uploaded or fetched (Part Documents, #207), the app extracts its text and runs
fixed patterns for RU, weight, dimensions and power, applying the same unit and "never guess" rules
as §3. Results are **suggestions** on the Rack data page (value + the matched sentence + page), confirmed
per part; they never write on their own and never overwrite a stored value. The backfill's
evidence column (sentence → expected value) becomes the pattern library's test fixtures in
`test:specs`. Expected accuracy is well below the backfill's; that's why it only ever suggests. Add as a
PUNCHLIST item when picked up (recompute the next free # from origin/main at that time).

## To start (when Jeff is back)

1. Jeff runs the Vercel production env pull into the scratchpad path given at the time.
2. Build `candidates.csv` → Jeff trims.
3. Extract → verify → hand over `rack-data-filled.csv` + `no-datasheet.csv`.
4. Jeff uploads; then log the outcome in DECISIONS.md and file the §6 punch item.
